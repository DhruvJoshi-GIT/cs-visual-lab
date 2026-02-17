'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Info,
  Play,
  RotateCcw,
  Zap,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

// ──────────────────────────── Types ────────────────────────────

type ThreadState = 'ready' | 'running' | 'waiting' | 'done';

interface Thread {
  id: number;
  name: string;
  color: string;
  state: ThreadState;
  operations: ThreadOp[];
  currentOp: number;
  localValue: number;
}

interface ThreadOp {
  type: 'read' | 'write' | 'increment' | 'lock' | 'unlock' | 'delay';
  variable: string;
  description: string;
  executed: boolean;
}

interface SharedVariable {
  name: string;
  value: number;
  lastWriter: string;
  accessCount: number;
}

interface MutexState {
  locked: boolean;
  owner: string | null;
  waitQueue: string[];
}

interface ScenarioPreset {
  label: string;
  desc: string;
  threads: Omit<Thread, 'state' | 'currentOp' | 'localValue'>[];
  variables: SharedVariable[];
  hasMutex: boolean;
  expectedIssue: string;
}

// ──────────────────────────── Constants ────────────────────────────

const DOMAIN_COLOR = '#06b6d4';

const SCENARIOS: Record<string, ScenarioPreset> = {
  race_condition: {
    label: 'Race Condition',
    desc: 'Two threads increment a shared counter without synchronization',
    threads: [
      {
        id: 0, name: 'Thread A', color: '#8b5cf6',
        operations: [
          { type: 'read', variable: 'counter', description: 'Read counter into local', executed: false },
          { type: 'increment', variable: 'local', description: 'Increment local value', executed: false },
          { type: 'write', variable: 'counter', description: 'Write local back to counter', executed: false },
          { type: 'read', variable: 'counter', description: 'Read counter again', executed: false },
          { type: 'increment', variable: 'local', description: 'Increment local value', executed: false },
          { type: 'write', variable: 'counter', description: 'Write local back to counter', executed: false },
        ],
      },
      {
        id: 1, name: 'Thread B', color: '#10b981',
        operations: [
          { type: 'read', variable: 'counter', description: 'Read counter into local', executed: false },
          { type: 'increment', variable: 'local', description: 'Increment local value', executed: false },
          { type: 'write', variable: 'counter', description: 'Write local back to counter', executed: false },
          { type: 'read', variable: 'counter', description: 'Read counter again', executed: false },
          { type: 'increment', variable: 'local', description: 'Increment local value', executed: false },
          { type: 'write', variable: 'counter', description: 'Write local back to counter', executed: false },
        ],
      },
    ],
    variables: [{ name: 'counter', value: 0, lastWriter: '-', accessCount: 0 }],
    hasMutex: false,
    expectedIssue: 'Expected: counter=4. Race condition may produce counter=2 or 3!',
  },
  with_mutex: {
    label: 'With Mutex',
    desc: 'Same operation but protected by a mutex — no race condition',
    threads: [
      {
        id: 0, name: 'Thread A', color: '#8b5cf6',
        operations: [
          { type: 'lock', variable: 'mutex', description: 'Acquire mutex', executed: false },
          { type: 'read', variable: 'counter', description: 'Read counter', executed: false },
          { type: 'increment', variable: 'local', description: 'Increment local', executed: false },
          { type: 'write', variable: 'counter', description: 'Write back', executed: false },
          { type: 'unlock', variable: 'mutex', description: 'Release mutex', executed: false },
          { type: 'lock', variable: 'mutex', description: 'Acquire mutex', executed: false },
          { type: 'read', variable: 'counter', description: 'Read counter', executed: false },
          { type: 'increment', variable: 'local', description: 'Increment local', executed: false },
          { type: 'write', variable: 'counter', description: 'Write back', executed: false },
          { type: 'unlock', variable: 'mutex', description: 'Release mutex', executed: false },
        ],
      },
      {
        id: 1, name: 'Thread B', color: '#10b981',
        operations: [
          { type: 'lock', variable: 'mutex', description: 'Acquire mutex', executed: false },
          { type: 'read', variable: 'counter', description: 'Read counter', executed: false },
          { type: 'increment', variable: 'local', description: 'Increment local', executed: false },
          { type: 'write', variable: 'counter', description: 'Write back', executed: false },
          { type: 'unlock', variable: 'mutex', description: 'Release mutex', executed: false },
          { type: 'lock', variable: 'mutex', description: 'Acquire mutex', executed: false },
          { type: 'read', variable: 'counter', description: 'Read counter', executed: false },
          { type: 'increment', variable: 'local', description: 'Increment local', executed: false },
          { type: 'write', variable: 'counter', description: 'Write back', executed: false },
          { type: 'unlock', variable: 'mutex', description: 'Release mutex', executed: false },
        ],
      },
    ],
    variables: [{ name: 'counter', value: 0, lastWriter: '-', accessCount: 0 }],
    hasMutex: true,
    expectedIssue: 'With mutex: counter always reaches 4 correctly.',
  },
  lost_update: {
    label: 'Lost Update',
    desc: 'Two threads read the same value, both write — one update is lost',
    threads: [
      {
        id: 0, name: 'Thread A', color: '#8b5cf6',
        operations: [
          { type: 'read', variable: 'balance', description: 'Read balance', executed: false },
          { type: 'delay', variable: '', description: 'Processing...', executed: false },
          { type: 'increment', variable: 'local', description: 'Add 100 to local', executed: false },
          { type: 'write', variable: 'balance', description: 'Write new balance', executed: false },
        ],
      },
      {
        id: 1, name: 'Thread B', color: '#10b981',
        operations: [
          { type: 'read', variable: 'balance', description: 'Read balance', executed: false },
          { type: 'increment', variable: 'local', description: 'Add 50 to local', executed: false },
          { type: 'write', variable: 'balance', description: 'Write new balance', executed: false },
        ],
      },
    ],
    variables: [{ name: 'balance', value: 1000, lastWriter: '-', accessCount: 0 }],
    hasMutex: false,
    expectedIssue: 'Expected: 1150. Thread A\'s update may be lost, giving only 1050 or 1100!',
  },
};

// ──────────────────────────── Component ────────────────────────────

export default function ConcurrencyModule() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [variables, setVariables] = useState<SharedVariable[]>([]);
  const [mutex, setMutex] = useState<MutexState>({ locked: false, owner: null, waitQueue: [] });
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [activeScenario, setActiveScenario] = useState('race_condition');
  const [cycle, setCycle] = useState(0);
  const [raceDetected, setRaceDetected] = useState(false);
  const [executionLog, setExecutionLog] = useState<string[]>([]);

  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const allDone = threads.length > 0 && threads.every((t) => t.state === 'done');

  useEffect(() => {
    loadScenario('race_condition');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadScenario = useCallback((key: string) => {
    setActiveScenario(key);
    setIsPlaying(false);
    setCycle(0);
    setRaceDetected(false);
    setExecutionLog([]);
    const scenario = SCENARIOS[key];
    if (!scenario) return;
    setThreads(scenario.threads.map((t) => ({
      ...t,
      state: 'ready' as ThreadState,
      currentOp: 0,
      localValue: 0,
      operations: t.operations.map((op) => ({ ...op, executed: false })),
    })));
    setVariables(scenario.variables.map((v) => ({ ...v })));
    setMutex({ locked: false, owner: null, waitQueue: [] });
  }, []);

  const stepForward = useCallback(() => {
    if (allDone) { setIsPlaying(false); return; }

    setCycle((c) => c + 1);

    setThreads((prev) => {
      const newThreads = prev.map((t) => ({
        ...t,
        operations: t.operations.map((op) => ({ ...op })),
      }));
      const newVars = variables.map((v) => ({ ...v }));
      const newMutex = { ...mutex, waitQueue: [...mutex.waitQueue] };

      // Pick a random active thread (simulates scheduler non-determinism)
      const activeThreads = newThreads.filter((t) => t.state !== 'done' && t.state !== 'waiting');
      if (activeThreads.length === 0) {
        // Check if any waiting threads can be unblocked
        if (newMutex.waitQueue.length > 0 && !newMutex.locked) {
          const nextName = newMutex.waitQueue.shift()!;
          const t = newThreads.find((t) => t.name === nextName);
          if (t) {
            t.state = 'ready';
            newMutex.locked = true;
            newMutex.owner = t.name;
            setExecutionLog((log) => [`[Cycle ${cycle + 1}] ${t.name}: acquired mutex`, ...log].slice(0, 30));
          }
        }
        setMutex(newMutex);
        setVariables(newVars);
        return newThreads;
      }

      const thread = activeThreads[Math.floor(Math.random() * activeThreads.length)];
      if (thread.currentOp >= thread.operations.length) {
        thread.state = 'done';
        setMutex(newMutex);
        setVariables(newVars);
        return newThreads;
      }

      const op = thread.operations[thread.currentOp];
      thread.state = 'running';

      switch (op.type) {
        case 'read': {
          const v = newVars.find((v) => v.name === op.variable);
          if (v) {
            thread.localValue = v.value;
            v.accessCount++;
            setExecutionLog((log) => [`[Cycle ${cycle + 1}] ${thread.name}: read ${op.variable} = ${v.value}`, ...log].slice(0, 30));
          }
          break;
        }
        case 'write': {
          const v = newVars.find((v) => v.name === op.variable);
          if (v) {
            v.value = thread.localValue;
            v.lastWriter = thread.name;
            v.accessCount++;
            setExecutionLog((log) => [`[Cycle ${cycle + 1}] ${thread.name}: write ${op.variable} = ${thread.localValue}`, ...log].slice(0, 30));
          }
          break;
        }
        case 'increment': {
          const incAmount = activeScenario === 'lost_update'
            ? (thread.id === 0 ? 100 : 50)
            : 1;
          thread.localValue += incAmount;
          setExecutionLog((log) => [`[Cycle ${cycle + 1}] ${thread.name}: local += ${incAmount} (now ${thread.localValue})`, ...log].slice(0, 30));
          break;
        }
        case 'lock': {
          if (!newMutex.locked) {
            newMutex.locked = true;
            newMutex.owner = thread.name;
            setExecutionLog((log) => [`[Cycle ${cycle + 1}] ${thread.name}: acquired mutex`, ...log].slice(0, 30));
          } else {
            thread.state = 'waiting';
            newMutex.waitQueue.push(thread.name);
            setExecutionLog((log) => [`[Cycle ${cycle + 1}] ${thread.name}: BLOCKED on mutex (held by ${newMutex.owner})`, ...log].slice(0, 30));
            setMutex(newMutex);
            setVariables(newVars);
            return newThreads; // Don't advance op
          }
          break;
        }
        case 'unlock': {
          newMutex.locked = false;
          newMutex.owner = null;
          setExecutionLog((log) => [`[Cycle ${cycle + 1}] ${thread.name}: released mutex`, ...log].slice(0, 30));
          // Wake up next waiter
          if (newMutex.waitQueue.length > 0) {
            const nextName = newMutex.waitQueue.shift()!;
            const waiter = newThreads.find((t) => t.name === nextName);
            if (waiter) waiter.state = 'ready';
          }
          break;
        }
        case 'delay': {
          setExecutionLog((log) => [`[Cycle ${cycle + 1}] ${thread.name}: processing...`, ...log].slice(0, 30));
          break;
        }
      }

      op.executed = true;
      thread.currentOp++;
      if (thread.currentOp >= thread.operations.length) {
        thread.state = 'done';
      }

      // Detect race condition
      if (!SCENARIOS[activeScenario].hasMutex) {
        const hasMultipleWriters = newVars.some((v) => {
          const writers = newThreads.filter((t) =>
            t.operations.some((op) => op.type === 'write' && op.variable === v.name && op.executed)
          );
          return writers.length > 1;
        });
        if (hasMultipleWriters) setRaceDetected(true);
      }

      setMutex(newMutex);
      setVariables(newVars);
      return newThreads;
    });
  }, [allDone, variables, mutex, cycle, activeScenario]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    loadScenario(activeScenario);
  }, [activeScenario, loadScenario]);

  // Animation loop
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(10, 800 / speedRef.current);
      if (timestamp - lastTickRef.current >= interval) {
        lastTickRef.current = timestamp;
        stepForward();
      }
      animationRef.current = requestAnimationFrame(animationLoop);
    },
    [stepForward]
  );

  useEffect(() => {
    if (isPlaying) {
      lastTickRef.current = performance.now();
      animationRef.current = requestAnimationFrame(animationLoop);
    } else {
      if (animationRef.current) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }
    }
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [isPlaying, animationLoop]);

  useEffect(() => { if (allDone) setIsPlaying(false); }, [allDone]);

  const stateColor = (s: ThreadState) => {
    switch (s) { case 'ready': return '#f59e0b'; case 'running': return '#10b981'; case 'waiting': return '#ef4444'; case 'done': return '#71717a'; }
  };

  const currentScenario = SCENARIOS[activeScenario];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />
      <main className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-semibold"
                style={{ backgroundColor: `${DOMAIN_COLOR}15`, color: DOMAIN_COLOR, border: `1px solid ${DOMAIN_COLOR}30` }}>
                3.5
              </span>
              <span className="text-xs text-[#71717a]">Operating Systems</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Concurrency & Synchronization{' '}
              <span className="text-[#71717a] font-normal">Visualizer</span>
            </h1>
            <p className="text-sm text-[#a1a1aa] max-w-2xl mt-1">
              See race conditions in action. Watch threads interleave operations on shared data,
              then add mutexes to see how synchronization prevents data corruption.
            </p>
          </div>

          {/* Scenarios */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs text-[#71717a] mr-1 font-medium uppercase tracking-wider">Scenarios:</span>
            {Object.entries(SCENARIOS).map(([key, scenario]) => (
              <button key={key} onClick={() => loadScenario(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 border ${
                  activeScenario === key
                    ? 'bg-[#06b6d4]/15 text-[#06b6d4] border-[#06b6d4]/30'
                    : 'bg-[#111118] text-[#a1a1aa] border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white'
                }`} title={scenario.desc}>
                {scenario.label}
              </button>
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => isPlaying ? setIsPlaying(false) : setIsPlaying(true)}
              disabled={allDone}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#06b6d4] text-white text-sm font-medium hover:bg-[#0891b2] disabled:opacity-40 transition-all">
              {isPlaying ? (
                <><div className="flex gap-0.5"><div className="w-1 h-3 bg-white rounded-sm" /><div className="w-1 h-3 bg-white rounded-sm" /></div> Pause</>
              ) : (
                <><Play size={14} fill="white" /> {allDone ? 'Done' : 'Play'}</>
              )}
            </button>
            <button onClick={stepForward} disabled={allDone}
              className="px-4 py-2 rounded-lg bg-[#111118] text-[#a1a1aa] text-sm border border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white disabled:opacity-40 transition-all">
              Step
            </button>
            <button onClick={handleReset}
              className="px-4 py-2 rounded-lg bg-[#111118] text-[#a1a1aa] text-sm border border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white transition-all">
              <RotateCcw size={14} />
            </button>
            <span className="text-xs font-mono text-[#71717a] ml-2">Cycle {cycle}</span>
            <div className="flex items-center gap-2 ml-auto">
              <input type="range" min={0.5} max={4} step={0.5} value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))} className="w-24 accent-[#06b6d4]" />
              <span className="text-xs font-mono text-[#a1a1aa] w-8">{speed}x</span>
            </div>
          </div>

          {/* Expected outcome */}
          <div className={`mb-6 p-3 rounded-lg border ${
            raceDetected ? 'bg-[#ef4444]/5 border-[#ef4444]/20' : 'bg-[#06b6d4]/5 border-[#06b6d4]/20'
          }`}>
            <div className="flex items-start gap-2">
              {raceDetected ? <AlertTriangle size={14} className="text-[#ef4444] mt-0.5" /> : <Info size={14} className="text-[#06b6d4] mt-0.5" />}
              <span className="text-xs text-[#a1a1aa]">{currentScenario.expectedIssue}</span>
            </div>
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
            <div className="space-y-6">
              {/* Shared Variables */}
              <div className="flex gap-4">
                {variables.map((v) => (
                  <motion.div key={v.name}
                    animate={{ borderColor: v.accessCount > 0 ? '#10b981' + '40' : '#1e1e2e' }}
                    className="flex-1 p-4 rounded-xl bg-[#111118] border border-[#1e1e2e] text-center">
                    <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-semibold mb-1">{v.name}</div>
                    <div className="text-3xl font-mono font-bold text-white">{v.value}</div>
                    <div className="text-[9px] text-[#71717a] mt-1">Last write: {v.lastWriter}</div>
                  </motion.div>
                ))}
                {currentScenario.hasMutex && (
                  <div className={`flex-1 p-4 rounded-xl border text-center ${
                    mutex.locked ? 'bg-[#ef4444]/5 border-[#ef4444]/20' : 'bg-[#10b981]/5 border-[#10b981]/20'
                  }`}>
                    <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-semibold mb-1">Mutex</div>
                    <div className="flex items-center justify-center gap-2">
                      {mutex.locked ? <Lock size={24} className="text-[#ef4444]" /> : <Unlock size={24} className="text-[#10b981]" />}
                    </div>
                    <div className="text-[9px] text-[#71717a] mt-1">
                      {mutex.locked ? `Held by ${mutex.owner}` : 'Available'}
                    </div>
                  </div>
                )}
              </div>

              {/* Thread timelines */}
              {threads.map((thread) => (
                <div key={thread.id} className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: thread.color }} />
                    <span className="text-sm font-semibold" style={{ color: thread.color }}>{thread.name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                      style={{ color: stateColor(thread.state), backgroundColor: `${stateColor(thread.state)}15` }}>
                      {thread.state.toUpperCase()}
                    </span>
                    <span className="text-[10px] text-[#71717a] ml-auto font-mono">local = {thread.localValue}</span>
                  </div>

                  <div className="flex gap-1.5">
                    {thread.operations.map((op, i) => {
                      const isCurrent = i === thread.currentOp;
                      const isDone = op.executed;

                      return (
                        <motion.div
                          key={i}
                          animate={{
                            borderColor: isCurrent ? thread.color : isDone ? '#10b981' + '30' : '#1e1e2e',
                            backgroundColor: isCurrent ? `${thread.color}15` : isDone ? '#10b981' + '08' : '#0f0f17',
                          }}
                          className="flex-1 p-2 rounded-lg border text-center"
                          title={op.description}
                        >
                          <div className={`text-[9px] font-mono font-bold ${
                            op.type === 'lock' || op.type === 'unlock' ? 'text-[#f59e0b]' :
                            op.type === 'read' ? 'text-[#06b6d4]' :
                            op.type === 'write' ? 'text-[#ef4444]' :
                            'text-[#a1a1aa]'
                          }`}>
                            {op.type.toUpperCase()}
                          </div>
                          <div className="text-[8px] text-[#71717a] mt-0.5 truncate">{op.variable || '...'}</div>
                          {isDone && <CheckCircle size={8} className="mx-auto mt-0.5 text-[#10b981]" />}
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Right Sidebar: Execution Log */}
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Zap size={14} className="text-[#06b6d4]" />
                  Execution Log
                </h3>
                <div className="max-h-[400px] overflow-y-auto space-y-1">
                  {executionLog.length === 0 ? (
                    <p className="text-xs text-[#71717a] italic">No operations yet.</p>
                  ) : (
                    executionLog.map((entry, i) => (
                      <div key={i} className={`text-[10px] font-mono py-1 px-2 rounded ${
                        entry.includes('BLOCKED') ? 'text-[#ef4444] bg-[#ef4444]/5' :
                        entry.includes('write') ? 'text-[#f59e0b] bg-[#f59e0b]/5' :
                        entry.includes('mutex') ? 'text-[#8b5cf6] bg-[#8b5cf6]/5' :
                        'text-[#a1a1aa] bg-[#ffffff03]'
                      }`}>
                        {entry}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Info */}
              <div className="p-4 rounded-xl bg-[#0f0f17] border border-[#1e1e2e]/50">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-[#06b6d4] mt-0.5 shrink-0" />
                  <div className="text-[11px] text-[#71717a] leading-relaxed">
                    <p className="mb-1.5">
                      <strong className="text-[#ef4444]">Race condition:</strong> When threads read-modify-write without synchronization, updates can be lost.
                    </p>
                    <p>
                      <strong className="text-[#10b981]">Mutex:</strong> Ensures only one thread accesses the critical section at a time. Others block until it is released.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
