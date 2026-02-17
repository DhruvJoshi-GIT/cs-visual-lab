'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Plus,
  Cpu,
  Info,
  ArrowRight,
  RefreshCw,
  Layers,
  Activity,
  Clock,
  Zap,
  XCircle,
  ChevronDown,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import ModuleControls from '@/components/ui/ModuleControls';

// ──────────────────────────── Types ────────────────────────────

type ProcessState = 'New' | 'Ready' | 'Running' | 'Waiting' | 'Terminated';

interface PCB {
  pid: number;
  name: string;
  state: ProcessState;
  pc: number;
  registers: number[];
  priority: number;
  memoryBase: number;
  memoryLimit: number;
  burstRemaining: number;
  ioRemaining: number;
  totalBurst: number;
  totalIo: number;
  color: string;
  createdAt: number;
  terminatedAt: number | null;
}

interface TransitionEvent {
  id: number;
  pid: number;
  from: ProcessState;
  to: ProcessState;
  reason: string;
  tick: number;
}

interface ContextSwitchAnim {
  savingPid: number | null;
  loadingPid: number | null;
  phase: 'saving' | 'loading' | 'done';
  tick: number;
}

// ──────────────────────────── Constants ────────────────────────────

const STATE_COLORS: Record<ProcessState, string> = {
  New: '#71717a',
  Ready: '#f59e0b',
  Running: '#10b981',
  Waiting: '#ef4444',
  Terminated: '#6366f1',
};

const PROCESS_COLORS = [
  '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
  '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#3b82f6',
];

const STATE_LIST: ProcessState[] = ['New', 'Ready', 'Running', 'Waiting', 'Terminated'];

const TRANSITIONS: { from: ProcessState; to: ProcessState; label: string }[] = [
  { from: 'New', to: 'Ready', label: 'Admitted' },
  { from: 'Ready', to: 'Running', label: 'CPU Assigned' },
  { from: 'Running', to: 'Waiting', label: 'I/O Request' },
  { from: 'Waiting', to: 'Ready', label: 'I/O Complete' },
  { from: 'Running', to: 'Ready', label: 'Interrupt' },
  { from: 'Running', to: 'Terminated', label: 'Exit' },
];

// State diagram positions (circle centers) for SVG
const STATE_POSITIONS: Record<ProcessState, { x: number; y: number }> = {
  New: { x: 80, y: 140 },
  Ready: { x: 240, y: 60 },
  Running: { x: 440, y: 60 },
  Waiting: { x: 440, y: 220 },
  Terminated: { x: 620, y: 140 },
};

interface ScenarioPreset {
  label: string;
  desc: string;
  processes: Omit<PCB, 'pid' | 'color' | 'createdAt' | 'terminatedAt' | 'state' | 'pc' | 'registers' | 'memoryBase' | 'memoryLimit'>[];
}

const SCENARIO_PRESETS: Record<string, ScenarioPreset> = {
  single_lifecycle: {
    label: 'Single Process Lifecycle',
    desc: 'Watch one process go through all states',
    processes: [
      { name: 'P1', priority: 5, burstRemaining: 6, ioRemaining: 3, totalBurst: 6, totalIo: 3 },
    ],
  },
  io_bound_mix: {
    label: 'I/O Bound Mix',
    desc: 'Multiple processes with heavy I/O',
    processes: [
      { name: 'P1', priority: 3, burstRemaining: 3, ioRemaining: 5, totalBurst: 3, totalIo: 5 },
      { name: 'P2', priority: 4, burstRemaining: 2, ioRemaining: 6, totalBurst: 2, totalIo: 6 },
      { name: 'P3', priority: 2, burstRemaining: 4, ioRemaining: 4, totalBurst: 4, totalIo: 4 },
      { name: 'P4', priority: 5, burstRemaining: 2, ioRemaining: 7, totalBurst: 2, totalIo: 7 },
    ],
  },
  cpu_bound_mix: {
    label: 'CPU Bound Mix',
    desc: 'Multiple processes with heavy computation',
    processes: [
      { name: 'P1', priority: 5, burstRemaining: 8, ioRemaining: 1, totalBurst: 8, totalIo: 1 },
      { name: 'P2', priority: 3, burstRemaining: 10, ioRemaining: 0, totalBurst: 10, totalIo: 0 },
      { name: 'P3', priority: 4, burstRemaining: 7, ioRemaining: 2, totalBurst: 7, totalIo: 2 },
      { name: 'P4', priority: 2, burstRemaining: 9, ioRemaining: 1, totalBurst: 9, totalIo: 1 },
    ],
  },
  fork_bomb: {
    label: 'Fork Bomb',
    desc: 'Rapid process creation overwhelming the scheduler',
    processes: [
      { name: 'P1', priority: 1, burstRemaining: 3, ioRemaining: 0, totalBurst: 3, totalIo: 0 },
      { name: 'P2', priority: 1, burstRemaining: 3, ioRemaining: 0, totalBurst: 3, totalIo: 0 },
      { name: 'P3', priority: 1, burstRemaining: 3, ioRemaining: 0, totalBurst: 3, totalIo: 0 },
      { name: 'P4', priority: 1, burstRemaining: 3, ioRemaining: 0, totalBurst: 3, totalIo: 0 },
      { name: 'P5', priority: 1, burstRemaining: 3, ioRemaining: 0, totalBurst: 3, totalIo: 0 },
    ],
  },
};

// ──────────────────────────── Helpers ────────────────────────────

function createPCB(
  pid: number,
  name: string,
  priority: number,
  burstRemaining: number,
  ioRemaining: number,
  totalBurst: number,
  totalIo: number,
  tick: number,
): PCB {
  return {
    pid,
    name,
    state: 'New',
    pc: Math.floor(Math.random() * 0xffff),
    registers: Array.from({ length: 8 }, () => Math.floor(Math.random() * 256)),
    priority,
    memoryBase: pid * 0x1000,
    memoryLimit: 0x1000,
    burstRemaining,
    ioRemaining,
    totalBurst,
    totalIo,
    color: PROCESS_COLORS[(pid - 1) % PROCESS_COLORS.length],
    createdAt: tick,
    terminatedAt: null,
  };
}

// ──────────────────────────── Arrow paths for state diagram ────────────────────────────

function getArrowPath(from: ProcessState, to: ProcessState): string {
  const fp = STATE_POSITIONS[from];
  const tp = STATE_POSITIONS[to];
  const r = 32; // circle radius

  // Compute angle between centers
  const dx = tp.x - fp.x;
  const dy = tp.y - fp.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const nx = dx / dist;
  const ny = dy / dist;

  // Start and end points on circle edges
  const sx = fp.x + nx * r;
  const sy = fp.y + ny * r;
  const ex = tp.x - nx * r;
  const ey = tp.y - ny * r;

  // Special curved paths for some transitions
  if (from === 'Running' && to === 'Ready') {
    // Curve upward (interrupt path)
    const mx = (sx + ex) / 2;
    const my = Math.min(sy, ey) - 40;
    return `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
  }
  if (from === 'Running' && to === 'Waiting') {
    return `M ${sx} ${sy} L ${ex} ${ey}`;
  }
  if (from === 'Waiting' && to === 'Ready') {
    const mx = (sx + ex) / 2 - 30;
    const my = (sy + ey) / 2 + 20;
    return `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
  }

  return `M ${sx} ${sy} L ${ex} ${ey}`;
}

// ──────────────────────────── Component ────────────────────────────

export default function ProcessModelModule() {
  // ── State ──
  const [processes, setProcesses] = useState<PCB[]>([]);
  const [events, setEvents] = useState<TransitionEvent[]>([]);
  const [tick, setTick] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [contextSwitch, setContextSwitch] = useState<ContextSwitchAnim | null>(null);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [activeTransition, setActiveTransition] = useState<{ from: ProcessState; to: ProcessState } | null>(null);
  const [contextSwitchCount, setContextSwitchCount] = useState(0);
  const [forkCount, setForkCount] = useState(0);

  const nextPidRef = useRef(1);
  const nextEventIdRef = useRef(1);

  // ── Animation refs ──
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // ── Derived metrics ──
  const totalProcesses = processes.length;
  const runningCount = processes.filter(p => p.state === 'Running').length;
  const readyCount = processes.filter(p => p.state === 'Ready').length;
  const waitingCount = processes.filter(p => p.state === 'Waiting').length;
  const terminatedCount = processes.filter(p => p.state === 'Terminated').length;
  const throughput = tick > 0 ? (terminatedCount / tick).toFixed(3) : '0.000';

  // ── Step forward simulation logic ──
  const stepForward = useCallback(() => {
    setTick(prev => {
      const currentTick = prev + 1;

      setProcesses(prevProcs => {
        const procs = prevProcs.map(p => ({ ...p, registers: [...p.registers] }));
        const newEvents: TransitionEvent[] = [];
        let csCount = 0;

        // Phase 1: Admit New processes to Ready
        for (const p of procs) {
          if (p.state === 'New') {
            p.state = 'Ready';
            newEvents.push({
              id: nextEventIdRef.current++,
              pid: p.pid,
              from: 'New',
              to: 'Ready',
              reason: 'Admitted',
              tick: currentTick,
            });
          }
        }

        // Phase 2: Complete I/O for Waiting processes
        for (const p of procs) {
          if (p.state === 'Waiting') {
            p.ioRemaining--;
            if (p.ioRemaining <= 0) {
              p.state = 'Ready';
              p.ioRemaining = 0;
              newEvents.push({
                id: nextEventIdRef.current++,
                pid: p.pid,
                from: 'Waiting',
                to: 'Ready',
                reason: 'I/O Complete',
                tick: currentTick,
              });
            }
          }
        }

        // Phase 3: Handle Running process
        const running = procs.find(p => p.state === 'Running');
        if (running) {
          running.burstRemaining--;
          running.pc += 4;
          // Randomize register updates for visual effect
          const regIdx = Math.floor(Math.random() * running.registers.length);
          running.registers[regIdx] = (running.registers[regIdx] + Math.floor(Math.random() * 16)) & 0xff;

          if (running.burstRemaining <= 0) {
            // Process has finished CPU burst
            if (running.ioRemaining > 0) {
              // Needs I/O
              running.state = 'Waiting';
              running.burstRemaining = Math.max(1, Math.floor(running.totalBurst / 2));
              newEvents.push({
                id: nextEventIdRef.current++,
                pid: running.pid,
                from: 'Running',
                to: 'Waiting',
                reason: 'I/O Request',
                tick: currentTick,
              });
            } else {
              // All done
              running.state = 'Terminated';
              running.terminatedAt = currentTick;
              newEvents.push({
                id: nextEventIdRef.current++,
                pid: running.pid,
                from: 'Running',
                to: 'Terminated',
                reason: 'Exit',
                tick: currentTick,
              });
            }
          } else if (currentTick % 4 === 0 && procs.some(p => p.state === 'Ready')) {
            // Time slice expired - interrupt (preempt)
            running.state = 'Ready';
            newEvents.push({
              id: nextEventIdRef.current++,
              pid: running.pid,
              from: 'Running',
              to: 'Ready',
              reason: 'Interrupt (Time Slice)',
              tick: currentTick,
            });
            csCount++;
          }
        }

        // Phase 4: Schedule a Ready process if no one is Running
        const nowRunning = procs.find(p => p.state === 'Running');
        if (!nowRunning) {
          const readyProcs = procs.filter(p => p.state === 'Ready');
          if (readyProcs.length > 0) {
            // Pick highest priority (lowest number), then FCFS
            readyProcs.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
            const chosen = readyProcs[0];
            const prevRunning = procs.find(p => p.pid !== chosen.pid && newEvents.some(e => e.pid === p.pid && e.from === 'Running'));

            if (prevRunning) {
              csCount++;
              setContextSwitch({
                savingPid: prevRunning.pid,
                loadingPid: chosen.pid,
                phase: 'saving',
                tick: currentTick,
              });
              setTimeout(() => {
                setContextSwitch(cs => cs && cs.tick === currentTick ? { ...cs, phase: 'loading' } : cs);
              }, 300);
              setTimeout(() => {
                setContextSwitch(cs => cs && cs.tick === currentTick ? { ...cs, phase: 'done' } : cs);
              }, 600);
              setTimeout(() => {
                setContextSwitch(cs => cs && cs.tick === currentTick ? null : cs);
              }, 900);
            } else if (running) {
              // There was a running process that transitioned away
              setContextSwitch({
                savingPid: running.pid,
                loadingPid: chosen.pid,
                phase: 'saving',
                tick: currentTick,
              });
              setTimeout(() => {
                setContextSwitch(cs => cs && cs.tick === currentTick ? { ...cs, phase: 'loading' } : cs);
              }, 300);
              setTimeout(() => {
                setContextSwitch(cs => cs && cs.tick === currentTick ? { ...cs, phase: 'done' } : cs);
              }, 600);
              setTimeout(() => {
                setContextSwitch(cs => cs && cs.tick === currentTick ? null : cs);
              }, 900);
            }

            chosen.state = 'Running';
            newEvents.push({
              id: nextEventIdRef.current++,
              pid: chosen.pid,
              from: 'Ready',
              to: 'Running',
              reason: 'CPU Assigned',
              tick: currentTick,
            });
          }
        }

        // Update active transition for diagram animation
        if (newEvents.length > 0) {
          const lastEvt = newEvents[newEvents.length - 1];
          setActiveTransition({ from: lastEvt.from, to: lastEvt.to });
          setTimeout(() => setActiveTransition(null), 600);
        }

        setEvents(prev => [...prev, ...newEvents]);
        setContextSwitchCount(prev => prev + csCount);

        return procs;
      });

      return currentTick;
    });
  }, []);

  // ── Animation loop ──
  const animationLoop = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) return;
    const interval = Math.max(10, 200 / speedRef.current);
    if (timestamp - lastTickRef.current >= interval) {
      lastTickRef.current = timestamp;
      stepForward();
    }
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [stepForward]);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const handleStep = useCallback(() => {
    if (isPlaying) handlePause();
    stepForward();
  }, [isPlaying, handlePause, stepForward]);

  const handleReset = useCallback(() => {
    handlePause();
    setProcesses([]);
    setEvents([]);
    setTick(0);
    setContextSwitch(null);
    setSelectedPid(null);
    setActiveTransition(null);
    setContextSwitchCount(0);
    setForkCount(0);
    nextPidRef.current = 1;
    nextEventIdRef.current = 1;
  }, [handlePause]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // ── Fork new process ──
  const forkProcess = useCallback(() => {
    const pid = nextPidRef.current++;
    const name = `P${pid}`;
    const priority = Math.floor(Math.random() * 5) + 1;
    const burst = Math.floor(Math.random() * 6) + 3;
    const io = Math.floor(Math.random() * 4) + 1;
    const pcb = createPCB(pid, name, priority, burst, io, burst, io, tick);
    setProcesses(prev => [...prev, pcb]);
    setForkCount(prev => prev + 1);
  }, [tick]);

  // ── Load scenario ──
  const loadScenario = useCallback((key: string) => {
    handleReset();
    const scenario = SCENARIO_PRESETS[key];
    if (!scenario) return;
    const newProcs: PCB[] = scenario.processes.map((sp, i) => {
      const pid = nextPidRef.current++;
      return createPCB(pid, sp.name, sp.priority, sp.burstRemaining, sp.ioRemaining, sp.totalBurst, sp.totalIo, 0);
    });
    setProcesses(newProcs);
  }, [handleReset]);

  // Load default on mount
  useEffect(() => {
    loadScenario('io_bound_mix');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Get selected process ──
  const selectedProcess = selectedPid !== null ? processes.find(p => p.pid === selectedPid) : null;

  // ──────────────────────────── Render ────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />

      <main className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* ── Header ── */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-0.5 rounded-md bg-[#06b6d4]/15 border border-[#06b6d4]/25 text-[#06b6d4] text-xs font-mono font-semibold">
                3.1
              </span>
              <h1 className="text-2xl font-bold tracking-tight">
                Process Model{' '}
                <span className="text-[#71717a] font-normal">& PCB Structure</span>
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Visualize process state transitions between{' '}
              <span className="text-[#71717a] font-mono">New</span>{' '}
              <ArrowRight size={12} className="inline text-[#71717a]" />{' '}
              <span className="text-[#f59e0b] font-mono">Ready</span>{' '}
              <ArrowRight size={12} className="inline text-[#71717a]" />{' '}
              <span className="text-[#10b981] font-mono">Running</span>{' '}
              <ArrowRight size={12} className="inline text-[#71717a]" />{' '}
              <span className="text-[#ef4444] font-mono">Waiting</span>{' '}
              <ArrowRight size={12} className="inline text-[#71717a]" />{' '}
              <span className="text-[#6366f1] font-mono">Terminated</span>
              {' '}with context switch animations and PCB inspection.
            </p>
          </div>

          {/* ── Controls Bar ── */}
          <div className="mb-6">
            <ModuleControls
              isPlaying={isPlaying}
              onPlay={handlePlay}
              onPause={handlePause}
              onStep={handleStep}
              onReset={handleReset}
              speed={speed}
              onSpeedChange={setSpeed}
              showMetrics={showMetrics}
              onToggleMetrics={() => setShowMetrics(!showMetrics)}
            >
              <button
                onClick={forkProcess}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#06b6d4]/15 text-[#06b6d4] border border-[#06b6d4]/30 text-xs font-medium hover:bg-[#06b6d4]/25 transition-all duration-200"
              >
                <Plus size={14} />
                Fork Process
              </button>
            </ModuleControls>
          </div>

          {/* ── Scenarios ── */}
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className="text-xs text-[#71717a] mr-1 font-medium uppercase tracking-wider">
              Presets:
            </span>
            {Object.entries(SCENARIO_PRESETS).map(([key, scenario]) => (
              <button
                key={key}
                onClick={() => loadScenario(key)}
                className="px-3 py-1.5 rounded-lg bg-[#111118] border border-[#1e1e2e] hover:border-[#2a2a3e] text-xs text-[#a1a1aa] hover:text-white transition-all duration-200 hover:bg-[#16161f]"
                title={scenario.desc}
              >
                {scenario.label}
              </button>
            ))}
          </div>

          {/* ── Metrics Bar ── */}
          <AnimatePresence>
            {showMetrics && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden mb-6"
              >
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
                  {[
                    { label: 'Total', value: totalProcesses.toString(), color: '#06b6d4' },
                    { label: 'Running', value: runningCount.toString(), color: '#10b981' },
                    { label: 'Ready', value: readyCount.toString(), color: '#f59e0b' },
                    { label: 'Waiting', value: waitingCount.toString(), color: '#ef4444' },
                    { label: 'Ctx Switches', value: contextSwitchCount.toString(), color: '#a855f7' },
                    { label: 'Throughput', value: throughput, color: '#ec4899' },
                    { label: 'Tick', value: tick.toString(), color: '#71717a' },
                  ].map((metric) => (
                    <div key={metric.label} className="p-3 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                      <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: metric.color }}>
                        {metric.label}
                      </div>
                      <div className="text-xl font-bold font-mono text-white">{metric.value}</div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Main Grid ── */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
            {/* ── Left: Visualization ── */}
            <div className="space-y-6 min-w-0">
              {/* ── Process State Diagram ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <Activity size={14} className="text-[#06b6d4]" />
                  Process State Diagram
                </h3>

                <div className="overflow-x-auto">
                  <svg viewBox="0 0 720 280" className="w-full max-w-[720px] mx-auto" style={{ minWidth: '500px' }}>
                    <defs>
                      <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                        <polygon points="0 0, 8 3, 0 6" fill="#71717a" />
                      </marker>
                      <marker id="arrowhead-active" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                        <polygon points="0 0, 8 3, 0 6" fill="#06b6d4" />
                      </marker>
                      {STATE_LIST.map(state => (
                        <filter key={state} id={`glow-${state}`} x="-50%" y="-50%" width="200%" height="200%">
                          <feGaussianBlur stdDeviation="6" result="coloredBlur" />
                          <feMerge>
                            <feMergeNode in="coloredBlur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      ))}
                    </defs>

                    {/* Transition arrows */}
                    {TRANSITIONS.map(({ from, to, label }) => {
                      const isActive = activeTransition?.from === from && activeTransition?.to === to;
                      const path = getArrowPath(from, to);

                      // Compute midpoint for label
                      const fp = STATE_POSITIONS[from];
                      const tp = STATE_POSITIONS[to];
                      let labelX = (fp.x + tp.x) / 2;
                      let labelY = (fp.y + tp.y) / 2;

                      if (from === 'Running' && to === 'Ready') {
                        labelY = Math.min(fp.y, tp.y) - 35;
                      }
                      if (from === 'Waiting' && to === 'Ready') {
                        labelX -= 30;
                        labelY += 15;
                      }

                      return (
                        <g key={`${from}-${to}`}>
                          <path
                            d={path}
                            fill="none"
                            stroke={isActive ? '#06b6d4' : '#2a2a3e'}
                            strokeWidth={isActive ? 2.5 : 1.5}
                            markerEnd={isActive ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
                            style={{
                              transition: 'stroke 0.3s, stroke-width 0.3s',
                            }}
                          />
                          {isActive && (
                            <path
                              d={path}
                              fill="none"
                              stroke="#06b6d4"
                              strokeWidth={2.5}
                              strokeDasharray="8 4"
                              markerEnd="url(#arrowhead-active)"
                              opacity={0.6}
                            >
                              <animate
                                attributeName="stroke-dashoffset"
                                from="24"
                                to="0"
                                dur="0.5s"
                                repeatCount="indefinite"
                              />
                            </path>
                          )}
                          <text
                            x={labelX}
                            y={labelY - 6}
                            textAnchor="middle"
                            fill={isActive ? '#06b6d4' : '#71717a'}
                            fontSize="9"
                            fontFamily="monospace"
                            style={{ transition: 'fill 0.3s' }}
                          >
                            {label}
                          </text>
                        </g>
                      );
                    })}

                    {/* State circles */}
                    {STATE_LIST.map(state => {
                      const pos = STATE_POSITIONS[state];
                      const color = STATE_COLORS[state];
                      const processesInState = processes.filter(p => p.state === state);
                      const hasProcesses = processesInState.length > 0;

                      return (
                        <g key={state}>
                          {/* Glow background */}
                          {hasProcesses && (
                            <circle
                              cx={pos.x}
                              cy={pos.y}
                              r={36}
                              fill={`${color}15`}
                              stroke="none"
                              filter={`url(#glow-${state})`}
                            />
                          )}

                          {/* Main circle */}
                          <circle
                            cx={pos.x}
                            cy={pos.y}
                            r={32}
                            fill={hasProcesses ? `${color}20` : '#0f0f17'}
                            stroke={hasProcesses ? color : '#2a2a3e'}
                            strokeWidth={hasProcesses ? 2 : 1}
                            style={{ transition: 'all 0.3s' }}
                          />

                          {/* State label */}
                          <text
                            x={pos.x}
                            y={pos.y - 4}
                            textAnchor="middle"
                            fill={hasProcesses ? color : '#71717a'}
                            fontSize="11"
                            fontWeight="bold"
                            fontFamily="monospace"
                            style={{ transition: 'fill 0.3s' }}
                          >
                            {state}
                          </text>

                          {/* Process count */}
                          <text
                            x={pos.x}
                            y={pos.y + 12}
                            textAnchor="middle"
                            fill={hasProcesses ? '#e4e4e7' : '#3a3a4e'}
                            fontSize="10"
                            fontFamily="monospace"
                          >
                            {processesInState.length > 0 ? `(${processesInState.length})` : ''}
                          </text>

                          {/* Process dots inside circle */}
                          {processesInState.slice(0, 5).map((p, i) => {
                            const angle = (i / Math.min(processesInState.length, 5)) * Math.PI * 2 - Math.PI / 2;
                            const dotR = 16;
                            const dx = pos.x + Math.cos(angle) * dotR;
                            const dy = pos.y + Math.sin(angle) * dotR + 2;
                            return (
                              <circle
                                key={p.pid}
                                cx={dx}
                                cy={dy}
                                r={3}
                                fill={p.color}
                                stroke={selectedPid === p.pid ? '#fff' : 'none'}
                                strokeWidth={1}
                                style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                                onClick={() => setSelectedPid(p.pid)}
                              />
                            );
                          })}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* ── Context Switch Animation ── */}
              <AnimatePresence>
                {contextSwitch && contextSwitch.phase !== 'done' && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="p-4 rounded-xl bg-[#111118] border border-[#a855f7]/30"
                  >
                    <h3 className="text-xs uppercase tracking-wider text-[#a855f7] font-semibold mb-3 flex items-center gap-2">
                      <RefreshCw size={14} className={contextSwitch.phase === 'saving' ? 'animate-spin' : ''} />
                      Context Switch in Progress
                    </h3>
                    <div className="flex items-center gap-4">
                      <div className={`flex-1 p-3 rounded-lg border transition-all duration-300 ${
                        contextSwitch.phase === 'saving'
                          ? 'bg-[#ef4444]/10 border-[#ef4444]/30'
                          : 'bg-[#1e1e2e]/50 border-[#1e1e2e]'
                      }`}>
                        <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1">Saving PCB</div>
                        <div className="text-sm font-mono text-white">
                          PID {contextSwitch.savingPid}
                        </div>
                        {contextSwitch.phase === 'saving' && (
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: '100%' }}
                            transition={{ duration: 0.3 }}
                            className="h-1 bg-[#ef4444] rounded-full mt-2"
                          />
                        )}
                      </div>

                      <ArrowRight size={20} className="text-[#a855f7] shrink-0" />

                      <div className={`flex-1 p-3 rounded-lg border transition-all duration-300 ${
                        contextSwitch.phase === 'loading'
                          ? 'bg-[#10b981]/10 border-[#10b981]/30'
                          : 'bg-[#1e1e2e]/50 border-[#1e1e2e]'
                      }`}>
                        <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1">Loading PCB</div>
                        <div className="text-sm font-mono text-white">
                          PID {contextSwitch.loadingPid}
                        </div>
                        {contextSwitch.phase === 'loading' && (
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: '100%' }}
                            transition={{ duration: 0.3 }}
                            className="h-1 bg-[#10b981] rounded-full mt-2"
                          />
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Process Table ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <Layers size={14} className="text-[#06b6d4]" />
                  Process Table
                </h3>

                {processes.length === 0 ? (
                  <div className="py-8 text-center">
                    <Cpu size={32} className="mx-auto text-[#71717a]/30 mb-3" />
                    <p className="text-sm text-[#71717a]">
                      No processes. Choose a preset or <span className="text-[#06b6d4] font-mono">Fork</span> a new process.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          {['PID', 'Name', 'State', 'Priority', 'PC', 'CPU Burst', 'I/O Rem', 'Memory'].map(h => (
                            <th key={h} className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 px-2">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <AnimatePresence>
                          {processes.map(proc => {
                            const stateColor = STATE_COLORS[proc.state];
                            const isSelected = selectedPid === proc.pid;

                            return (
                              <motion.tr
                                key={proc.pid}
                                initial={{ opacity: 0, x: -12 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 12 }}
                                onClick={() => setSelectedPid(isSelected ? null : proc.pid)}
                                className={`border-t border-[#1e1e2e]/40 cursor-pointer transition-all duration-200 ${
                                  isSelected ? 'bg-[#06b6d4]/5' : 'hover:bg-[#1e1e2e]/30'
                                }`}
                              >
                                <td className="py-2 px-2">
                                  <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: proc.color }} />
                                    <span className="text-xs font-mono text-white">{proc.pid}</span>
                                  </div>
                                </td>
                                <td className="py-2 px-2">
                                  <span className="text-xs font-mono text-[#e4e4e7]">{proc.name}</span>
                                </td>
                                <td className="py-2 px-2">
                                  <span
                                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold"
                                    style={{
                                      backgroundColor: `${stateColor}15`,
                                      color: stateColor,
                                      border: `1px solid ${stateColor}30`,
                                    }}
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stateColor }} />
                                    {proc.state}
                                  </span>
                                </td>
                                <td className="py-2 px-2">
                                  <span className="text-xs font-mono text-[#a1a1aa]">{proc.priority}</span>
                                </td>
                                <td className="py-2 px-2">
                                  <span className="text-xs font-mono text-[#a1a1aa]">0x{proc.pc.toString(16).toUpperCase().padStart(4, '0')}</span>
                                </td>
                                <td className="py-2 px-2">
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden max-w-[60px]">
                                      <div
                                        className="h-full rounded-full transition-all duration-300"
                                        style={{
                                          width: `${proc.totalBurst > 0 ? (proc.burstRemaining / proc.totalBurst) * 100 : 0}%`,
                                          backgroundColor: '#10b981',
                                        }}
                                      />
                                    </div>
                                    <span className="text-[10px] font-mono text-[#71717a]">{proc.burstRemaining}</span>
                                  </div>
                                </td>
                                <td className="py-2 px-2">
                                  <span className="text-xs font-mono text-[#a1a1aa]">{proc.ioRemaining}</span>
                                </td>
                                <td className="py-2 px-2">
                                  <span className="text-[10px] font-mono text-[#71717a]">
                                    0x{proc.memoryBase.toString(16).toUpperCase()}-0x{(proc.memoryBase + proc.memoryLimit).toString(16).toUpperCase()}
                                  </span>
                                </td>
                              </motion.tr>
                            );
                          })}
                        </AnimatePresence>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ── Event Log ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <Clock size={14} className="text-[#06b6d4]" />
                  Transition Event Log
                </h3>

                {events.length === 0 ? (
                  <p className="text-xs text-[#71717a] italic py-4 text-center">
                    No events yet. Start the simulation.
                  </p>
                ) : (
                  <div className="max-h-[240px] overflow-y-auto space-y-1">
                    <AnimatePresence>
                      {[...events].reverse().slice(0, 30).map(evt => {
                        const fromColor = STATE_COLORS[evt.from];
                        const toColor = STATE_COLORS[evt.to];
                        const proc = processes.find(p => p.pid === evt.pid);

                        return (
                          <motion.div
                            key={evt.id}
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0f0f17] border border-[#1e1e2e]/50"
                          >
                            <span className="text-[10px] font-mono text-[#71717a] w-8 shrink-0">t={evt.tick}</span>
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: proc?.color || '#71717a' }} />
                            <span className="text-[10px] font-mono text-[#a1a1aa] shrink-0">P{evt.pid}</span>
                            <span className="text-[10px] font-mono font-bold shrink-0" style={{ color: fromColor }}>{evt.from}</span>
                            <ArrowRight size={10} className="text-[#71717a] shrink-0" />
                            <span className="text-[10px] font-mono font-bold shrink-0" style={{ color: toColor }}>{evt.to}</span>
                            <span className="text-[10px] text-[#71717a] ml-auto truncate">{evt.reason}</span>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </div>

            {/* ── Right Sidebar: PCB Inspector ── */}
            <div className="space-y-4">
              {/* ── PCB Display ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Cpu size={14} className="text-[#06b6d4]" />
                  PCB Inspector
                </h3>

                {selectedProcess ? (
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-center gap-3 pb-3 border-b border-[#1e1e2e]">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center font-mono text-sm font-bold"
                        style={{
                          backgroundColor: `${selectedProcess.color}20`,
                          color: selectedProcess.color,
                          border: `1px solid ${selectedProcess.color}40`,
                        }}
                      >
                        {selectedProcess.pid}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">{selectedProcess.name}</div>
                        <div
                          className="text-[10px] font-mono font-bold"
                          style={{ color: STATE_COLORS[selectedProcess.state] }}
                        >
                          {selectedProcess.state}
                        </div>
                      </div>
                    </div>

                    {/* PCB Fields */}
                    <div className="space-y-2">
                      {[
                        { label: 'PID', value: selectedProcess.pid.toString() },
                        { label: 'State', value: selectedProcess.state },
                        { label: 'Program Counter', value: `0x${selectedProcess.pc.toString(16).toUpperCase().padStart(4, '0')}` },
                        { label: 'Priority', value: selectedProcess.priority.toString() },
                        { label: 'Memory Base', value: `0x${selectedProcess.memoryBase.toString(16).toUpperCase()}` },
                        { label: 'Memory Limit', value: `0x${selectedProcess.memoryLimit.toString(16).toUpperCase()}` },
                        { label: 'CPU Burst Remaining', value: selectedProcess.burstRemaining.toString() },
                        { label: 'I/O Remaining', value: selectedProcess.ioRemaining.toString() },
                        { label: 'Created At', value: `t=${selectedProcess.createdAt}` },
                        { label: 'Terminated At', value: selectedProcess.terminatedAt !== null ? `t=${selectedProcess.terminatedAt}` : '--' },
                      ].map(field => (
                        <div key={field.label} className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-[#0f0f17] border border-[#1e1e2e]/50">
                          <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">{field.label}</span>
                          <span className="text-xs font-mono text-[#e4e4e7]">{field.value}</span>
                        </div>
                      ))}
                    </div>

                    {/* Registers */}
                    <div className="pt-2 border-t border-[#1e1e2e]">
                      <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-semibold mb-2">Registers</div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {selectedProcess.registers.map((val, i) => (
                          <motion.div
                            key={i}
                            className="px-2 py-1.5 rounded-lg bg-[#0f0f17] border border-[#1e1e2e]/50 text-center"
                            animate={{
                              borderColor: val > 200 ? '#06b6d420' : '#1e1e2e80',
                            }}
                          >
                            <div className="text-[8px] text-[#71717a] font-mono">R{i}</div>
                            <div className="text-[10px] font-mono text-[#e4e4e7]">
                              0x{val.toString(16).toUpperCase().padStart(2, '0')}
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center">
                    <Cpu size={24} className="mx-auto text-[#71717a]/30 mb-2" />
                    <p className="text-xs text-[#71717a]">
                      Click a process in the table or state diagram to inspect its PCB
                    </p>
                  </div>
                )}
              </div>

              {/* ── Ready Queue ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Layers size={14} className="text-[#f59e0b]" />
                  Ready Queue
                </h3>

                {(() => {
                  const readyProcs = processes
                    .filter(p => p.state === 'Ready')
                    .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);

                  if (readyProcs.length === 0) {
                    return (
                      <p className="text-xs text-[#71717a] italic py-2 text-center">Empty</p>
                    );
                  }

                  return (
                    <div className="space-y-1.5">
                      {readyProcs.map((proc, idx) => (
                        <motion.div
                          key={proc.pid}
                          layout
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -8 }}
                          onClick={() => setSelectedPid(proc.pid)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all duration-200 ${
                            selectedPid === proc.pid
                              ? 'border-[#06b6d4]/40 bg-[#06b6d4]/10'
                              : 'border-[#1e1e2e] bg-[#0f0f17] hover:border-[#2a2a3e]'
                          }`}
                        >
                          <span className="text-[10px] font-mono text-[#f59e0b] shrink-0 w-4">{idx + 1}.</span>
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: proc.color }} />
                          <span className="text-xs font-mono text-[#e4e4e7] flex-1">{proc.name}</span>
                          <span className="text-[10px] font-mono text-[#71717a]">pri={proc.priority}</span>
                        </motion.div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* ── State Summary ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Activity size={14} className="text-[#10b981]" />
                  State Summary
                </h3>

                <div className="space-y-2">
                  {STATE_LIST.map(state => {
                    const count = processes.filter(p => p.state === state).length;
                    const pct = totalProcesses > 0 ? (count / totalProcesses) * 100 : 0;

                    return (
                      <div key={state} className="flex items-center gap-3">
                        <div className="flex items-center gap-2 w-24">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STATE_COLORS[state] }} />
                          <span className="text-[10px] font-mono" style={{ color: STATE_COLORS[state] }}>{state}</span>
                        </div>
                        <div className="flex-1 h-2 bg-[#1e1e2e] rounded-full overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: STATE_COLORS[state] }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.3 }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-[#71717a] w-6 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Waiting Processes ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Clock size={14} className="text-[#ef4444]" />
                  Waiting (I/O Blocked)
                </h3>

                {(() => {
                  const waitingProcs = processes.filter(p => p.state === 'Waiting');
                  if (waitingProcs.length === 0) {
                    return (
                      <p className="text-xs text-[#71717a] italic py-2 text-center">No blocked processes</p>
                    );
                  }

                  return (
                    <div className="space-y-1.5">
                      {waitingProcs.map(proc => (
                        <motion.div
                          key={proc.pid}
                          layout
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -8 }}
                          onClick={() => setSelectedPid(proc.pid)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all duration-200 ${
                            selectedPid === proc.pid
                              ? 'border-[#06b6d4]/40 bg-[#06b6d4]/10'
                              : 'border-[#1e1e2e] bg-[#0f0f17] hover:border-[#2a2a3e]'
                          }`}
                        >
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: proc.color }} />
                          <span className="text-xs font-mono text-[#e4e4e7] flex-1">{proc.name}</span>
                          <div className="flex items-center gap-1.5">
                            <div className="w-12 h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
                              <motion.div
                                className="h-full rounded-full bg-[#ef4444]"
                                animate={{ width: `${proc.totalIo > 0 ? ((proc.totalIo - proc.ioRemaining) / proc.totalIo) * 100 : 0}%` }}
                                transition={{ duration: 0.3 }}
                              />
                            </div>
                            <span className="text-[10px] font-mono text-[#ef4444]">io={proc.ioRemaining}</span>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* ── CPU Utilization ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Cpu size={14} className="text-[#10b981]" />
                  CPU Utilization
                </h3>

                {tick > 0 ? (() => {
                  // Calculate CPU utilization from events
                  const runningTicks = events.filter(e => e.to === 'Running').length;
                  const utilization = Math.min(100, (runningCount / Math.max(1, totalProcesses - terminatedCount)) * 100);

                  return (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-[#71717a]">Utilization</span>
                        <span className="text-lg font-mono font-bold text-[#10b981]">
                          {runningCount > 0 ? '100%' : '0%'}
                        </span>
                      </div>
                      <div className="h-3 bg-[#1e1e2e] rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-[#10b981] to-[#06b6d4]"
                          animate={{ width: runningCount > 0 ? '100%' : '0%' }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="p-2 rounded-lg bg-[#0f0f17] border border-[#1e1e2e]/50">
                          <div className="text-[8px] text-[#71717a] uppercase">Active</div>
                          <div className="text-xs font-mono text-[#10b981]">{runningCount > 0 ? 'Yes' : 'Idle'}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-[#0f0f17] border border-[#1e1e2e]/50">
                          <div className="text-[8px] text-[#71717a] uppercase">Forks</div>
                          <div className="text-xs font-mono text-[#06b6d4]">{forkCount}</div>
                        </div>
                      </div>
                    </div>
                  );
                })() : (
                  <p className="text-xs text-[#71717a] italic py-2 text-center">Start simulation to track</p>
                )}
              </div>

              {/* ── Process Lifecycle Timeline ── */}
              {processes.length > 0 && tick > 0 && (
                <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                  <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                    <Activity size={14} className="text-[#06b6d4]" />
                    Lifecycle Overview
                  </h3>

                  <div className="space-y-2">
                    {processes.map(proc => {
                      const lifespan = proc.terminatedAt !== null
                        ? proc.terminatedAt - proc.createdAt
                        : tick - proc.createdAt;
                      const maxLife = Math.max(tick, 1);

                      return (
                        <div key={proc.pid} className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 w-12 shrink-0">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: proc.color }} />
                            <span className="text-[10px] font-mono" style={{ color: proc.color }}>{proc.name}</span>
                          </div>
                          <div className="flex-1 h-4 bg-[#1e1e2e] rounded-full overflow-hidden relative">
                            <motion.div
                              className="absolute top-0 left-0 h-full rounded-full"
                              style={{
                                backgroundColor: STATE_COLORS[proc.state],
                                opacity: 0.6,
                              }}
                              animate={{ width: `${(lifespan / maxLife) * 100}%` }}
                              transition={{ duration: 0.3 }}
                            />
                            <div
                              className="absolute top-0 right-1 h-full flex items-center"
                            >
                              <span className="text-[7px] font-mono text-[#a1a1aa]">{proc.state}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Info ── */}
              <div className="p-4 rounded-xl bg-[#0f0f17] border border-[#1e1e2e]/50">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-[#06b6d4] mt-0.5 shrink-0" />
                  <div className="text-[11px] text-[#71717a] leading-relaxed">
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">New:</strong>{' '}
                      Process just created, awaiting admission to the ready queue.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Ready:</strong>{' '}
                      Waiting for CPU time in the ready queue, ordered by priority.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Running:</strong>{' '}
                      Currently executing instructions on the CPU.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Waiting:</strong>{' '}
                      Blocked on I/O or event completion. Cannot run until I/O finishes.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Terminated:</strong>{' '}
                      Finished execution, resources being reclaimed by the OS.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Context Switch:</strong>{' '}
                      Saving the PCB of the current process and loading another. Involves
                      saving/restoring registers, program counter, and memory mappings.
                    </p>
                    <p>
                      <strong className="text-[#a1a1aa]">PCB:</strong>{' '}
                      Process Control Block stores all information needed to manage a process:
                      PID, state, registers, memory bounds, scheduling info.
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
