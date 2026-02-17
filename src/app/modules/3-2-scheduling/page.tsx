'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  Cpu,
  Info,
  Layers,
  Activity,
  Clock,
  BarChart3,
  ChevronDown,
  Timer,
  Zap,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import ModuleControls from '@/components/ui/ModuleControls';

// ──────────────────────────── Types ────────────────────────────

type Algorithm = 'FCFS' | 'SJF' | 'SRTF' | 'RR' | 'Priority' | 'MLFQ';

interface ProcessDef {
  id: number;
  name: string;
  arrivalTime: number;
  burstTime: number;
  priority: number;
  color: string;
}

interface ProcessState {
  id: number;
  name: string;
  arrivalTime: number;
  burstTime: number;
  remainingTime: number;
  priority: number;
  color: string;
  startTime: number | null;
  finishTime: number | null;
  waitingTime: number;
  responseTime: number | null;
  // MLFQ specific
  currentQueue: number;
  quantumUsed: number;
}

interface GanttEntry {
  processId: number | null; // null = idle
  processName: string;
  color: string;
  startTime: number;
  endTime: number;
}

interface MLFQQueue {
  level: number;
  quantum: number;
  processes: number[]; // process IDs
}

// ──────────────────────────── Constants ────────────────────────────

const PROCESS_COLORS = [
  '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#a855f7',
];

const ALGORITHM_INFO: Record<Algorithm, { label: string; desc: string }> = {
  FCFS: { label: 'First Come First Served', desc: 'Processes execute in arrival order. Non-preemptive.' },
  SJF: { label: 'Shortest Job First', desc: 'Shortest burst runs first. Non-preemptive.' },
  SRTF: { label: 'Shortest Remaining Time First', desc: 'Preemptive SJF. Shortest remaining time runs.' },
  RR: { label: 'Round Robin', desc: 'Each process gets a time quantum, then rotates.' },
  Priority: { label: 'Priority Scheduling', desc: 'Highest priority (lowest number) runs first. Preemptive.' },
  MLFQ: { label: 'Multi-Level Feedback Queue', desc: 'Multiple queues with different quanta. Processes demoted after using quantum.' },
};

const ALGORITHM_LIST: Algorithm[] = ['FCFS', 'SJF', 'SRTF', 'RR', 'Priority', 'MLFQ'];

interface ScenarioPreset {
  label: string;
  desc: string;
  processes: Omit<ProcessDef, 'id' | 'color'>[];
}

const SCENARIO_PRESETS: Record<string, ScenarioPreset> = {
  equal_burst: {
    label: 'Equal Burst',
    desc: 'All processes have the same burst time',
    processes: [
      { name: 'P1', arrivalTime: 0, burstTime: 4, priority: 2 },
      { name: 'P2', arrivalTime: 0, burstTime: 4, priority: 3 },
      { name: 'P3', arrivalTime: 0, burstTime: 4, priority: 1 },
      { name: 'P4', arrivalTime: 0, burstTime: 4, priority: 4 },
    ],
  },
  varied_arrival: {
    label: 'Varied Arrival',
    desc: 'Processes arrive at different times',
    processes: [
      { name: 'P1', arrivalTime: 0, burstTime: 5, priority: 3 },
      { name: 'P2', arrivalTime: 1, burstTime: 3, priority: 1 },
      { name: 'P3', arrivalTime: 2, burstTime: 8, priority: 4 },
      { name: 'P4', arrivalTime: 3, burstTime: 2, priority: 2 },
      { name: 'P5', arrivalTime: 5, burstTime: 4, priority: 5 },
    ],
  },
  priority_inversion: {
    label: 'Priority Inversion',
    desc: 'High priority process arrives after low priority ones',
    processes: [
      { name: 'P1', arrivalTime: 0, burstTime: 8, priority: 4 },
      { name: 'P2', arrivalTime: 0, burstTime: 6, priority: 3 },
      { name: 'P3', arrivalTime: 2, burstTime: 3, priority: 1 },
      { name: 'P4', arrivalTime: 4, burstTime: 4, priority: 2 },
    ],
  },
  long_vs_short: {
    label: 'Long vs Short',
    desc: 'Mix of long and short burst processes',
    processes: [
      { name: 'P1', arrivalTime: 0, burstTime: 12, priority: 2 },
      { name: 'P2', arrivalTime: 1, burstTime: 2, priority: 3 },
      { name: 'P3', arrivalTime: 2, burstTime: 1, priority: 4 },
      { name: 'P4', arrivalTime: 3, burstTime: 10, priority: 1 },
      { name: 'P5', arrivalTime: 4, burstTime: 3, priority: 5 },
      { name: 'P6', arrivalTime: 6, burstTime: 2, priority: 2 },
    ],
  },
};

const MLFQ_LEVELS = 3;
const MLFQ_QUANTA = [2, 4, 8];

// ──────────────────────────── Simulation Engine ────────────────────────────

function initProcessStates(defs: ProcessDef[]): ProcessState[] {
  return defs.map(d => ({
    id: d.id,
    name: d.name,
    arrivalTime: d.arrivalTime,
    burstTime: d.burstTime,
    remainingTime: d.burstTime,
    priority: d.priority,
    color: d.color,
    startTime: null,
    finishTime: null,
    waitingTime: 0,
    responseTime: null,
    currentQueue: 0,
    quantumUsed: 0,
  }));
}

function getReadyProcesses(states: ProcessState[], currentTime: number): ProcessState[] {
  return states.filter(
    p => p.arrivalTime <= currentTime && p.remainingTime > 0 && p.finishTime === null
  );
}

function selectProcess(
  algorithm: Algorithm,
  readyQueue: ProcessState[],
  currentRunning: number | null,
  timeQuantum: number,
  quantumCounter: number,
  mlfqQueues: MLFQQueue[],
): { selectedId: number | null; preempt: boolean } {
  if (readyQueue.length === 0) return { selectedId: null, preempt: false };

  switch (algorithm) {
    case 'FCFS': {
      if (currentRunning !== null && readyQueue.some(p => p.id === currentRunning && p.remainingTime > 0)) {
        return { selectedId: currentRunning, preempt: false };
      }
      const sorted = [...readyQueue].sort((a, b) => a.arrivalTime - b.arrivalTime || a.id - b.id);
      return { selectedId: sorted[0].id, preempt: false };
    }
    case 'SJF': {
      if (currentRunning !== null && readyQueue.some(p => p.id === currentRunning && p.remainingTime > 0)) {
        return { selectedId: currentRunning, preempt: false };
      }
      const sorted = [...readyQueue].sort((a, b) => a.burstTime - b.burstTime || a.arrivalTime - b.arrivalTime);
      return { selectedId: sorted[0].id, preempt: false };
    }
    case 'SRTF': {
      const sorted = [...readyQueue].sort((a, b) => a.remainingTime - b.remainingTime || a.arrivalTime - b.arrivalTime);
      const selected = sorted[0].id;
      return { selectedId: selected, preempt: selected !== currentRunning };
    }
    case 'RR': {
      if (currentRunning !== null && readyQueue.some(p => p.id === currentRunning && p.remainingTime > 0)) {
        if (quantumCounter < timeQuantum) {
          return { selectedId: currentRunning, preempt: false };
        }
        // Quantum expired, pick next in round-robin order
        const currentIdx = readyQueue.findIndex(p => p.id === currentRunning);
        const nextIdx = (currentIdx + 1) % readyQueue.length;
        return { selectedId: readyQueue[nextIdx].id, preempt: true };
      }
      return { selectedId: readyQueue[0].id, preempt: false };
    }
    case 'Priority': {
      const sorted = [...readyQueue].sort((a, b) => a.priority - b.priority || a.arrivalTime - b.arrivalTime);
      const selected = sorted[0].id;
      return { selectedId: selected, preempt: selected !== currentRunning };
    }
    case 'MLFQ': {
      // Pick from highest priority queue that has ready processes
      for (let level = 0; level < MLFQ_LEVELS; level++) {
        const queuePids = mlfqQueues[level]?.processes || [];
        const inQueue = readyQueue.filter(p => queuePids.includes(p.id));
        if (inQueue.length > 0) {
          // Within a queue, use round-robin
          if (currentRunning !== null && inQueue.some(p => p.id === currentRunning)) {
            const currentProc = inQueue.find(p => p.id === currentRunning)!;
            if (currentProc.quantumUsed < MLFQ_QUANTA[level]) {
              return { selectedId: currentRunning, preempt: false };
            }
            // Quantum used up, round robin within queue
            const idx = inQueue.findIndex(p => p.id === currentRunning);
            const nextIdx = (idx + 1) % inQueue.length;
            return { selectedId: inQueue[nextIdx].id, preempt: true };
          }
          return { selectedId: inQueue[0].id, preempt: false };
        }
      }
      return { selectedId: null, preempt: false };
    }
    default:
      return { selectedId: null, preempt: false };
  }
}

// ──────────────────────────── Component ────────────────────────────

export default function CPUSchedulingModule() {
  // ── Process definitions ──
  const [processDefs, setProcessDefs] = useState<ProcessDef[]>([]);
  const [algorithm, setAlgorithm] = useState<Algorithm>('FCFS');
  const [timeQuantum, setTimeQuantum] = useState(3);

  // ── Simulation state ──
  const [processStates, setProcessStates] = useState<ProcessState[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [ganttChart, setGanttChart] = useState<GanttEntry[]>([]);
  const [currentRunningId, setCurrentRunningId] = useState<number | null>(null);
  const [quantumCounter, setQuantumCounter] = useState(0);
  const [simulationStarted, setSimulationStarted] = useState(false);
  const [simulationDone, setSimulationDone] = useState(false);
  const [mlfqQueues, setMlfqQueues] = useState<MLFQQueue[]>([]);

  // ── UI state ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);

  // ── Animation refs ──
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // ── Derived metrics ──
  const completedProcesses = processStates.filter(p => p.finishTime !== null);
  const avgWaitingTime = completedProcesses.length > 0
    ? (completedProcesses.reduce((sum, p) => sum + p.waitingTime, 0) / completedProcesses.length).toFixed(2)
    : '--';
  const avgTurnaroundTime = completedProcesses.length > 0
    ? (completedProcesses.reduce((sum, p) => sum + ((p.finishTime || 0) - p.arrivalTime), 0) / completedProcesses.length).toFixed(2)
    : '--';
  const avgResponseTime = completedProcesses.length > 0
    ? (completedProcesses.reduce((sum, p) => sum + (p.responseTime ?? 0), 0) / completedProcesses.length).toFixed(2)
    : '--';
  const cpuBusyTime = ganttChart.filter(g => g.processId !== null).reduce((sum, g) => sum + (g.endTime - g.startTime), 0);
  const cpuUtilization = currentTime > 0 ? ((cpuBusyTime / currentTime) * 100).toFixed(1) : '0.0';
  const throughput = currentTime > 0 ? (completedProcesses.length / currentTime).toFixed(3) : '0.000';

  // ── Initialize MLFQ queues ──
  const initMLFQ = useCallback((procs: ProcessState[]) => {
    const queues: MLFQQueue[] = Array.from({ length: MLFQ_LEVELS }, (_, i) => ({
      level: i,
      quantum: MLFQ_QUANTA[i],
      processes: i === 0 ? procs.map(p => p.id) : [],
    }));
    setMlfqQueues(queues);
  }, []);

  // ── Step forward simulation logic ──
  const stepForward = useCallback(() => {
    if (simulationDone) return;

    setCurrentTime(prev => {
      const ct = simulationStarted ? prev + 1 : prev;

      setProcessStates(prevStates => {
        const states = prevStates.map(s => ({ ...s }));
        const time = simulationStarted ? ct : 0;

        if (!simulationStarted) {
          setSimulationStarted(true);
        }

        // Get ready processes
        const ready = getReadyProcesses(states, time);

        if (ready.length === 0 && states.every(s => s.finishTime !== null || s.arrivalTime > time)) {
          // Check if all done
          if (states.every(s => s.finishTime !== null)) {
            setSimulationDone(true);
            setIsPlaying(false);
            return states;
          }
          // Idle time
          setGanttChart(prev => {
            const last = prev[prev.length - 1];
            if (last && last.processId === null && last.endTime === time) {
              return [...prev.slice(0, -1), { ...last, endTime: time + 1 }];
            }
            return [...prev, { processId: null, processName: 'Idle', color: '#2a2a3e', startTime: time, endTime: time + 1 }];
          });
          return states;
        }

        // Select process
        const { selectedId, preempt } = selectProcess(
          algorithm, ready, currentRunningId, timeQuantum, quantumCounter, mlfqQueues
        );

        if (selectedId === null) {
          // All done check
          if (states.every(s => s.finishTime !== null)) {
            setSimulationDone(true);
            setIsPlaying(false);
          } else {
            setGanttChart(prev => {
              const last = prev[prev.length - 1];
              if (last && last.processId === null && last.endTime === time) {
                return [...prev.slice(0, -1), { ...last, endTime: time + 1 }];
              }
              return [...prev, { processId: null, processName: 'Idle', color: '#2a2a3e', startTime: time, endTime: time + 1 }];
            });
          }
          setCurrentRunningId(null);
          setQuantumCounter(0);
          return states;
        }

        const proc = states.find(s => s.id === selectedId)!;

        // Record response time
        if (proc.responseTime === null) {
          proc.responseTime = time - proc.arrivalTime;
        }

        // Record start time
        if (proc.startTime === null) {
          proc.startTime = time;
        }

        // Handle quantum counter
        let newQuantumCounter = quantumCounter;
        if (selectedId !== currentRunningId || preempt) {
          newQuantumCounter = 0;
          // MLFQ: reset quantum used for new process
          if (algorithm === 'MLFQ') {
            proc.quantumUsed = 0;
          }
        }

        // Execute for 1 time unit
        proc.remainingTime--;
        newQuantumCounter++;

        if (algorithm === 'MLFQ') {
          proc.quantumUsed++;
        }

        // Update waiting time for all other ready processes
        for (const s of states) {
          if (s.id !== selectedId && s.arrivalTime <= time && s.remainingTime > 0 && s.finishTime === null) {
            s.waitingTime++;
          }
        }

        // Check if process completed
        if (proc.remainingTime <= 0) {
          proc.finishTime = time + 1;
          proc.remainingTime = 0;
          setCurrentRunningId(null);
          newQuantumCounter = 0;

          // MLFQ: remove from queues
          if (algorithm === 'MLFQ') {
            setMlfqQueues(prev => prev.map(q => ({
              ...q,
              processes: q.processes.filter(pid => pid !== selectedId),
            })));
          }
        } else {
          // MLFQ: check if quantum expired, demote
          if (algorithm === 'MLFQ') {
            const currentQ = proc.currentQueue;
            if (proc.quantumUsed >= MLFQ_QUANTA[currentQ]) {
              const newLevel = Math.min(currentQ + 1, MLFQ_LEVELS - 1);
              if (newLevel !== currentQ) {
                proc.currentQueue = newLevel;
                proc.quantumUsed = 0;
                setMlfqQueues(prev => {
                  const updated = prev.map(q => ({ ...q, processes: [...q.processes] }));
                  updated[currentQ].processes = updated[currentQ].processes.filter(pid => pid !== selectedId);
                  if (!updated[newLevel].processes.includes(selectedId)) {
                    updated[newLevel].processes.push(selectedId);
                  }
                  return updated;
                });
              }
            }
          }

          setCurrentRunningId(selectedId);
        }

        setQuantumCounter(newQuantumCounter);

        // Update Gantt chart
        setGanttChart(prev => {
          const last = prev[prev.length - 1];
          if (last && last.processId === selectedId && last.endTime === time) {
            return [...prev.slice(0, -1), { ...last, endTime: time + 1 }];
          }
          return [...prev, {
            processId: selectedId,
            processName: proc.name,
            color: proc.color,
            startTime: time,
            endTime: time + 1,
          }];
        });

        // Check if all done
        if (states.every(s => s.finishTime !== null)) {
          setSimulationDone(true);
          setIsPlaying(false);
        }

        return states;
      });

      return simulationStarted ? ct : 0;
    });
  }, [algorithm, currentRunningId, quantumCounter, simulationDone, simulationStarted, timeQuantum, mlfqQueues]);

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
    const freshStates = initProcessStates(processDefs);
    setProcessStates(freshStates);
    setCurrentTime(0);
    setGanttChart([]);
    setCurrentRunningId(null);
    setQuantumCounter(0);
    setSimulationStarted(false);
    setSimulationDone(false);
    if (algorithm === 'MLFQ') {
      initMLFQ(freshStates);
    }
  }, [handlePause, processDefs, algorithm, initMLFQ]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // ── Load scenario ──
  const loadScenario = useCallback((key: string) => {
    handlePause();
    const scenario = SCENARIO_PRESETS[key];
    if (!scenario) return;
    const defs: ProcessDef[] = scenario.processes.map((sp, i) => ({
      id: i + 1,
      name: sp.name,
      arrivalTime: sp.arrivalTime,
      burstTime: sp.burstTime,
      priority: sp.priority,
      color: PROCESS_COLORS[i % PROCESS_COLORS.length],
    }));
    setProcessDefs(defs);
    const freshStates = initProcessStates(defs);
    setProcessStates(freshStates);
    setCurrentTime(0);
    setGanttChart([]);
    setCurrentRunningId(null);
    setQuantumCounter(0);
    setSimulationStarted(false);
    setSimulationDone(false);
    if (algorithm === 'MLFQ') {
      initMLFQ(freshStates);
    }
  }, [handlePause, algorithm, initMLFQ]);

  // ── Algorithm change ──
  const handleAlgorithmChange = useCallback((algo: Algorithm) => {
    setAlgorithm(algo);
    // Reset simulation when changing algorithm
    const freshStates = initProcessStates(processDefs);
    setProcessStates(freshStates);
    setCurrentTime(0);
    setGanttChart([]);
    setCurrentRunningId(null);
    setQuantumCounter(0);
    setSimulationStarted(false);
    setSimulationDone(false);
    handlePause();
    if (algo === 'MLFQ') {
      initMLFQ(freshStates);
    }
  }, [processDefs, handlePause, initMLFQ]);

  // Load default on mount
  useEffect(() => {
    loadScenario('varied_arrival');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Ready queue display order ──
  const readyQueue = processStates
    .filter(p => p.arrivalTime <= currentTime && p.remainingTime > 0 && p.finishTime === null && p.id !== currentRunningId)
    .sort((a, b) => {
      switch (algorithm) {
        case 'SJF':
        case 'SRTF':
          return a.remainingTime - b.remainingTime || a.arrivalTime - b.arrivalTime;
        case 'Priority':
          return a.priority - b.priority || a.arrivalTime - b.arrivalTime;
        default:
          return a.arrivalTime - b.arrivalTime || a.id - b.id;
      }
    });

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
                3.2
              </span>
              <h1 className="text-2xl font-bold tracking-tight">
                CPU Scheduling{' '}
                <span className="text-[#71717a] font-normal">Algorithms</span>
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Compare scheduling algorithms with interactive Gantt charts. Observe how{' '}
              <span className="text-[#6366f1] font-mono">FCFS</span>,{' '}
              <span className="text-[#06b6d4] font-mono">SJF</span>,{' '}
              <span className="text-[#10b981] font-mono">SRTF</span>,{' '}
              <span className="text-[#f59e0b] font-mono">Round Robin</span>,{' '}
              <span className="text-[#ef4444] font-mono">Priority</span>, and{' '}
              <span className="text-[#a855f7] font-mono">MLFQ</span>{' '}
              affect waiting and turnaround times.
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
              {/* Algorithm selector */}
              <div className="relative">
                <select
                  value={algorithm}
                  onChange={(e) => handleAlgorithmChange(e.target.value as Algorithm)}
                  className="appearance-none px-3 py-2 pr-8 rounded-lg bg-[#06b6d4]/10 border border-[#06b6d4]/30 text-xs text-[#06b6d4] font-mono font-medium focus:outline-none focus:border-[#06b6d4] cursor-pointer"
                >
                  {ALGORITHM_LIST.map(a => (
                    <option key={a} value={a} className="bg-[#111118] text-white">{a}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#06b6d4] pointer-events-none" />
              </div>

              {/* Time Quantum for RR */}
              {(algorithm === 'RR') && (
                <div className="flex items-center gap-2">
                  <Timer size={14} className="text-[#f59e0b]" />
                  <span className="text-[10px] text-[#71717a] uppercase tracking-wider">Q=</span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={timeQuantum}
                    onChange={(e) => {
                      setTimeQuantum(parseInt(e.target.value));
                      handleReset();
                    }}
                    className="w-16 h-1.5 accent-[#f59e0b] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f59e0b]"
                  />
                  <span className="text-xs font-mono text-[#f59e0b]">{timeQuantum}</span>
                </div>
              )}
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
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { label: 'Current Time', value: currentTime.toString(), color: '#06b6d4' },
                    { label: 'CPU Util.', value: `${cpuUtilization}%`, color: '#10b981' },
                    { label: 'Avg Wait', value: avgWaitingTime, color: '#f59e0b' },
                    { label: 'Avg Turnaround', value: avgTurnaroundTime, color: '#6366f1' },
                    { label: 'Avg Response', value: avgResponseTime, color: '#ef4444' },
                    { label: 'Throughput', value: throughput, color: '#a855f7' },
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
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
            {/* ── Left: Visualization ── */}
            <div className="space-y-6 min-w-0">
              {/* ── Algorithm Info ── */}
              <div className="p-3 rounded-xl bg-[#06b6d4]/5 border border-[#06b6d4]/20">
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-[#06b6d4] shrink-0" />
                  <span className="text-sm font-semibold text-[#06b6d4]">{ALGORITHM_INFO[algorithm].label}</span>
                  <span className="text-xs text-[#a1a1aa] ml-2">{ALGORITHM_INFO[algorithm].desc}</span>
                </div>
              </div>

              {/* ── Process Input Table ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <Layers size={14} className="text-[#06b6d4]" />
                  Process Table
                </h3>

                {processDefs.length === 0 ? (
                  <div className="py-8 text-center">
                    <Cpu size={32} className="mx-auto text-[#71717a]/30 mb-3" />
                    <p className="text-sm text-[#71717a]">No processes loaded. Choose a preset.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          {['Process', 'Arrival', 'Burst', 'Priority', 'Remaining', 'Waiting', 'Turnaround', 'Response'].map(h => (
                            <th key={h} className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 px-2">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {processStates.map(proc => {
                          const isRunning = proc.id === currentRunningId;
                          const isDone = proc.finishTime !== null;
                          const turnaround = isDone ? (proc.finishTime! - proc.arrivalTime) : '--';

                          return (
                            <motion.tr
                              key={proc.id}
                              className={`border-t border-[#1e1e2e]/40 transition-all duration-200 ${
                                isRunning ? 'bg-[#10b981]/5' : isDone ? 'opacity-50' : ''
                              }`}
                              animate={{
                                backgroundColor: isRunning ? 'rgba(16, 185, 129, 0.05)' : 'transparent',
                              }}
                            >
                              <td className="py-2 px-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: proc.color }} />
                                  <span className="text-xs font-mono text-white font-semibold">{proc.name}</span>
                                  {isRunning && (
                                    <motion.span
                                      initial={{ scale: 0 }}
                                      animate={{ scale: 1 }}
                                      className="text-[8px] px-1.5 py-0.5 rounded bg-[#10b981]/20 text-[#10b981] font-mono font-bold"
                                    >
                                      CPU
                                    </motion.span>
                                  )}
                                  {isDone && (
                                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#6366f1]/20 text-[#6366f1] font-mono font-bold">
                                      DONE
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-2 text-xs font-mono text-[#a1a1aa]">{proc.arrivalTime}</td>
                              <td className="py-2 px-2 text-xs font-mono text-[#a1a1aa]">{proc.burstTime}</td>
                              <td className="py-2 px-2 text-xs font-mono text-[#a1a1aa]">{proc.priority}</td>
                              <td className="py-2 px-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-12 h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
                                    <motion.div
                                      className="h-full rounded-full"
                                      style={{ backgroundColor: proc.color }}
                                      animate={{ width: `${proc.burstTime > 0 ? (proc.remainingTime / proc.burstTime) * 100 : 0}%` }}
                                      transition={{ duration: 0.2 }}
                                    />
                                  </div>
                                  <span className="text-[10px] font-mono text-[#71717a]">{proc.remainingTime}</span>
                                </div>
                              </td>
                              <td className="py-2 px-2 text-xs font-mono text-[#f59e0b]">{proc.waitingTime}</td>
                              <td className="py-2 px-2 text-xs font-mono text-[#6366f1]">{turnaround.toString()}</td>
                              <td className="py-2 px-2 text-xs font-mono text-[#ef4444]">{proc.responseTime !== null ? proc.responseTime : '--'}</td>
                            </motion.tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ── Gantt Chart ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <BarChart3 size={14} className="text-[#06b6d4]" />
                  Gantt Chart
                </h3>

                {ganttChart.length === 0 ? (
                  <div className="py-12 text-center">
                    <Clock size={40} className="mx-auto text-[#71717a]/30 mb-3" />
                    <p className="text-sm text-[#71717a]">
                      Press <span className="font-mono text-[#06b6d4]">Play</span> or{' '}
                      <span className="font-mono text-[#06b6d4]">Step</span> to begin scheduling
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto pb-2">
                    {/* Timeline scale */}
                    <div className="flex items-end mb-1 min-w-fit">
                      <div className="w-0 shrink-0" />
                      {Array.from({ length: Math.max(currentTime + 1, 1) }, (_, i) => (
                        <div
                          key={i}
                          className="text-[9px] font-mono text-[#71717a] text-center shrink-0"
                          style={{ width: '36px' }}
                        >
                          {i}
                        </div>
                      ))}
                    </div>

                    {/* Gantt bars */}
                    <div className="flex items-stretch min-h-[48px] min-w-fit rounded-lg overflow-hidden border border-[#1e1e2e]">
                      {ganttChart.map((entry, i) => {
                        const width = (entry.endTime - entry.startTime) * 36;
                        const isIdle = entry.processId === null;

                        return (
                          <motion.div
                            key={`${entry.startTime}-${entry.processId}`}
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width, opacity: 1 }}
                            transition={{ duration: 0.15 }}
                            className="relative flex items-center justify-center shrink-0 border-r border-[#0a0a0f]/30"
                            style={{
                              backgroundColor: isIdle ? '#1a1a24' : `${entry.color}25`,
                              borderBottom: isIdle ? 'none' : `3px solid ${entry.color}`,
                              minHeight: '48px',
                            }}
                          >
                            <span
                              className="text-[10px] font-mono font-bold truncate px-1"
                              style={{ color: isIdle ? '#71717a' : entry.color }}
                            >
                              {isIdle ? '--' : entry.processName}
                            </span>
                          </motion.div>
                        );
                      })}
                    </div>

                    {/* Current time cursor */}
                    <div className="relative h-4 min-w-fit">
                      <motion.div
                        className="absolute top-0 w-0.5 h-4 bg-[#06b6d4]"
                        animate={{ left: `${currentTime * 36}px` }}
                        transition={{ duration: 0.15 }}
                      />
                      <motion.div
                        className="absolute top-4 text-[9px] font-mono text-[#06b6d4] -translate-x-1/2"
                        animate={{ left: `${currentTime * 36}px` }}
                        transition={{ duration: 0.15 }}
                      >
                        t={currentTime}
                      </motion.div>
                    </div>
                  </div>
                )}

                {/* Simulation complete */}
                <AnimatePresence>
                  {simulationDone && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-4 p-3 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20 flex items-center gap-2"
                    >
                      <div className="w-2 h-2 rounded-full bg-[#10b981]" />
                      <span className="text-xs text-[#10b981] font-medium">
                        Scheduling complete at t={currentTime}. Avg turnaround: {avgTurnaroundTime}, Avg waiting: {avgWaitingTime}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── MLFQ Queue Visualization ── */}
              <AnimatePresence>
                {algorithm === 'MLFQ' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
                  >
                    <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                      <Layers size={14} className="text-[#a855f7]" />
                      MLFQ Queue Levels
                    </h3>

                    <div className="space-y-3">
                      {mlfqQueues.map((queue, level) => {
                        const queueProcs = processStates.filter(
                          p => queue.processes.includes(p.id) && p.remainingTime > 0 && p.finishTime === null
                        );
                        const levelColors = ['#10b981', '#f59e0b', '#ef4444'];

                        return (
                          <div key={level} className="flex items-center gap-3">
                            <div className="shrink-0 w-24">
                              <div className="text-[10px] font-mono font-bold" style={{ color: levelColors[level] }}>
                                Queue {level}
                              </div>
                              <div className="text-[9px] text-[#71717a]">Q={queue.quantum}</div>
                            </div>
                            <div
                              className="flex-1 flex items-center gap-1.5 px-3 py-2 rounded-lg border min-h-[40px]"
                              style={{
                                backgroundColor: `${levelColors[level]}05`,
                                borderColor: `${levelColors[level]}20`,
                              }}
                            >
                              {queueProcs.length === 0 ? (
                                <span className="text-[10px] text-[#71717a] italic">empty</span>
                              ) : (
                                queueProcs.map(proc => (
                                  <motion.div
                                    key={proc.id}
                                    layout
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="px-2 py-1 rounded-md text-[10px] font-mono font-bold border"
                                    style={{
                                      backgroundColor: `${proc.color}15`,
                                      borderColor: `${proc.color}30`,
                                      color: proc.color,
                                    }}
                                  >
                                    {proc.name}
                                    {proc.id === currentRunningId && (
                                      <span className="ml-1 text-[8px]">(running)</span>
                                    )}
                                  </motion.div>
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Per-Process Timeline ── */}
              {ganttChart.length > 0 && (
                <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                  <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                    <Activity size={14} className="text-[#06b6d4]" />
                    Per-Process Timeline
                  </h3>

                  <div className="overflow-x-auto">
                    <div className="min-w-fit">
                      {/* Time header */}
                      <div className="flex items-end mb-1">
                        <div className="w-20 shrink-0" />
                        {Array.from({ length: Math.max(currentTime + 1, 1) }, (_, i) => (
                          <div
                            key={i}
                            className="text-[9px] font-mono text-[#71717a] text-center shrink-0"
                            style={{ width: '28px' }}
                          >
                            {i}
                          </div>
                        ))}
                      </div>

                      {/* Process rows */}
                      {processStates.map(proc => (
                        <div key={proc.id} className="flex items-center mb-1">
                          <div className="w-20 shrink-0 flex items-center gap-1.5 pr-2">
                            <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: proc.color }} />
                            <span className="text-[10px] font-mono font-medium truncate" style={{ color: proc.color }}>
                              {proc.name}
                            </span>
                          </div>
                          {Array.from({ length: Math.max(currentTime, 1) }, (_, t) => {
                            const entry = ganttChart.find(
                              g => g.processId === proc.id && t >= g.startTime && t < g.endTime
                            );
                            const isWaiting = proc.arrivalTime <= t && t < currentTime && !entry && proc.finishTime === null;
                            const notArrived = t < proc.arrivalTime;
                            const isDone = proc.finishTime !== null && t >= proc.finishTime;

                            return (
                              <div
                                key={t}
                                className="shrink-0 h-6 flex items-center justify-center"
                                style={{ width: '28px' }}
                              >
                                {entry ? (
                                  <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="w-6 h-5 rounded-sm flex items-center justify-center"
                                    style={{
                                      backgroundColor: `${proc.color}30`,
                                      border: `1px solid ${proc.color}50`,
                                    }}
                                  >
                                    <span className="text-[7px] font-mono font-bold" style={{ color: proc.color }}>
                                      R
                                    </span>
                                  </motion.div>
                                ) : isWaiting && !isDone && !notArrived ? (
                                  <div className="w-6 h-5 rounded-sm bg-[#f59e0b]/10 border border-[#f59e0b]/20 flex items-center justify-center">
                                    <span className="text-[7px] font-mono text-[#f59e0b]">W</span>
                                  </div>
                                ) : (
                                  <div className="w-6 h-5" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Right Sidebar ── */}
            <div className="space-y-4">
              {/* ── Ready Queue ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Layers size={14} className="text-[#f59e0b]" />
                  Ready Queue
                </h3>

                {readyQueue.length === 0 ? (
                  <p className="text-xs text-[#71717a] italic py-2 text-center">
                    {simulationStarted ? 'Empty' : 'Start simulation'}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {readyQueue.map((proc, idx) => (
                      <motion.div
                        key={proc.id}
                        layout
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -8 }}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0f0f17] border border-[#1e1e2e]"
                      >
                        <span className="text-[10px] font-mono text-[#f59e0b] w-4 shrink-0">{idx + 1}.</span>
                        <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: proc.color }} />
                        <span className="text-xs font-mono text-[#e4e4e7] flex-1">{proc.name}</span>
                        <span className="text-[10px] font-mono text-[#71717a]">
                          rem={proc.remainingTime}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Currently Running ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Cpu size={14} className="text-[#10b981]" />
                  Running
                </h3>

                {currentRunningId !== null ? (() => {
                  const proc = processStates.find(p => p.id === currentRunningId);
                  if (!proc) return null;

                  return (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="p-3 rounded-lg border"
                      style={{
                        backgroundColor: `${proc.color}10`,
                        borderColor: `${proc.color}30`,
                      }}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center font-mono text-sm font-bold"
                          style={{
                            backgroundColor: `${proc.color}20`,
                            color: proc.color,
                          }}
                        >
                          {proc.name}
                        </div>
                        <div>
                          <div className="text-xs text-white font-semibold">{proc.name}</div>
                          <div className="text-[10px] text-[#10b981] font-mono">RUNNING</div>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-[#71717a]">Remaining</span>
                          <span className="font-mono text-white">{proc.remainingTime}/{proc.burstTime}</span>
                        </div>
                        <div className="h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: proc.color }}
                            animate={{ width: `${((proc.burstTime - proc.remainingTime) / proc.burstTime) * 100}%` }}
                            transition={{ duration: 0.2 }}
                          />
                        </div>
                        {(algorithm === 'RR') && (
                          <div className="flex items-center justify-between text-[10px] pt-1">
                            <span className="text-[#71717a]">Quantum used</span>
                            <span className="font-mono text-[#f59e0b]">{quantumCounter}/{timeQuantum}</span>
                          </div>
                        )}
                        {algorithm === 'MLFQ' && (
                          <div className="flex items-center justify-between text-[10px] pt-1">
                            <span className="text-[#71717a]">Queue Level</span>
                            <span className="font-mono text-[#a855f7]">{proc.currentQueue}</span>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })() : (
                  <div className="py-4 text-center">
                    <Cpu size={20} className="mx-auto text-[#71717a]/30 mb-1" />
                    <p className="text-xs text-[#71717a] italic">Idle</p>
                  </div>
                )}
              </div>

              {/* ── Completed Processes ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Activity size={14} className="text-[#6366f1]" />
                  Completed ({completedProcesses.length}/{processStates.length})
                </h3>

                {completedProcesses.length === 0 ? (
                  <p className="text-xs text-[#71717a] italic py-2 text-center">None yet</p>
                ) : (
                  <div className="space-y-1.5">
                    {completedProcesses.map(proc => (
                      <div
                        key={proc.id}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0f0f17] border border-[#1e1e2e]/50"
                      >
                        <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: proc.color }} />
                        <span className="text-[10px] font-mono text-[#e4e4e7] flex-1">{proc.name}</span>
                        <span className="text-[10px] font-mono text-[#6366f1]">
                          TT={proc.finishTime! - proc.arrivalTime}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Algorithm Summary ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <BarChart3 size={14} className="text-[#06b6d4]" />
                  Performance Summary
                </h3>

                {completedProcesses.length > 0 ? (
                  <div className="space-y-2">
                    {completedProcesses.map(proc => {
                      const turnaround = proc.finishTime! - proc.arrivalTime;

                      return (
                        <div key={proc.id} className="p-2 rounded-lg bg-[#0f0f17] border border-[#1e1e2e]/50">
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: proc.color }} />
                            <span className="text-[10px] font-mono font-bold" style={{ color: proc.color }}>{proc.name}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-1">
                            <div>
                              <div className="text-[8px] text-[#71717a] uppercase">Wait</div>
                              <div className="text-[10px] font-mono text-[#f59e0b]">{proc.waitingTime}</div>
                            </div>
                            <div>
                              <div className="text-[8px] text-[#71717a] uppercase">Turn</div>
                              <div className="text-[10px] font-mono text-[#6366f1]">{turnaround}</div>
                            </div>
                            <div>
                              <div className="text-[8px] text-[#71717a] uppercase">Resp</div>
                              <div className="text-[10px] font-mono text-[#ef4444]">{proc.responseTime ?? '--'}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Averages */}
                    <div className="pt-2 mt-2 border-t border-[#1e1e2e]">
                      <div className="grid grid-cols-3 gap-1 p-2 rounded-lg bg-[#06b6d4]/5 border border-[#06b6d4]/20">
                        <div>
                          <div className="text-[8px] text-[#06b6d4] uppercase font-bold">Avg Wait</div>
                          <div className="text-xs font-mono text-white font-bold">{avgWaitingTime}</div>
                        </div>
                        <div>
                          <div className="text-[8px] text-[#06b6d4] uppercase font-bold">Avg Turn</div>
                          <div className="text-xs font-mono text-white font-bold">{avgTurnaroundTime}</div>
                        </div>
                        <div>
                          <div className="text-[8px] text-[#06b6d4] uppercase font-bold">Avg Resp</div>
                          <div className="text-xs font-mono text-white font-bold">{avgResponseTime}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[#71717a] italic py-2 text-center">
                    Run simulation to see results
                  </p>
                )}
              </div>

              {/* ── Info ── */}
              <div className="p-4 rounded-xl bg-[#0f0f17] border border-[#1e1e2e]/50">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-[#06b6d4] mt-0.5 shrink-0" />
                  <div className="text-[11px] text-[#71717a] leading-relaxed">
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Waiting Time:</strong>{' '}
                      Time spent in ready queue waiting for CPU.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Turnaround:</strong>{' '}
                      Total time from arrival to completion.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Response:</strong>{' '}
                      Time from arrival to first CPU execution.
                    </p>
                    <p>
                      <strong className="text-[#a1a1aa]">MLFQ:</strong>{' '}
                      Processes start in Q0 and are demoted after using their quantum.
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
