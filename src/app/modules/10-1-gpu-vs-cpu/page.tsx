"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu,
  Zap,
  ChevronDown,
  Activity,
  Layers,
  Grid3X3,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ──────────────────────────────────────────────────────────────────

type ScenarioName = "vector-add" | "matrix-multiply" | "sequential" | "mixed";

type TaskState = "pending" | "running" | "done";

interface Task {
  id: number;
  state: TaskState;
  dependency: number | null; // id of task that must finish first
  group: number; // for visual grouping
}

interface CoreState {
  id: number;
  busy: boolean;
  taskId: number | null;
  progress: number; // 0-1
  cyclesLeft: number;
}

interface SimulationState {
  cpuCores: CoreState[];
  gpuCores: CoreState[];
  tasks: Task[];
  cpuCompleted: number;
  gpuCompleted: number;
  cpuCycle: number;
  gpuCycle: number;
  cpuFinished: boolean;
  gpuFinished: boolean;
  totalTasks: number;
}

interface ScenarioConfig {
  name: string;
  label: string;
  description: string;
  totalTasks: number;
  cpuCoreCount: number;
  gpuCoreCount: number;
  taskCycles: number; // cycles per task on CPU
  gpuTaskCycles: number; // cycles per task on GPU
  hasSequentialDeps: boolean;
  sequentialChainLength: number;
  parallelFraction: number; // fraction of tasks that are parallel
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SCENARIOS: Record<ScenarioName, ScenarioConfig> = {
  "vector-add": {
    name: "vector-add",
    label: "Vector Add (1024)",
    description:
      "Embarrassingly parallel: each element computed independently. GPU massively outperforms CPU.",
    totalTasks: 1024,
    cpuCoreCount: 8,
    gpuCoreCount: 256,
    taskCycles: 2,
    gpuTaskCycles: 1,
    hasSequentialDeps: false,
    sequentialChainLength: 0,
    parallelFraction: 1.0,
  },
  "matrix-multiply": {
    name: "matrix-multiply",
    label: "Matrix Multiply",
    description:
      "Each output element requires a dot product. High parallelism with some shared memory access patterns.",
    totalTasks: 512,
    cpuCoreCount: 8,
    gpuCoreCount: 256,
    taskCycles: 4,
    gpuTaskCycles: 2,
    hasSequentialDeps: false,
    sequentialChainLength: 0,
    parallelFraction: 1.0,
  },
  sequential: {
    name: "sequential",
    label: "Sequential Chain",
    description:
      "Each task depends on the previous result. GPU cannot parallelize dependency chains and its higher latency per task makes it slower.",
    totalTasks: 64,
    cpuCoreCount: 8,
    gpuCoreCount: 256,
    taskCycles: 2,
    gpuTaskCycles: 4,
    hasSequentialDeps: true,
    sequentialChainLength: 64,
    parallelFraction: 0.0,
  },
  mixed: {
    name: "mixed",
    label: "Mixed Workload",
    description:
      "Some tasks are parallel, some have sequential dependencies. Real workloads often look like this.",
    totalTasks: 256,
    cpuCoreCount: 8,
    gpuCoreCount: 256,
    taskCycles: 3,
    gpuTaskCycles: 2,
    hasSequentialDeps: true,
    sequentialChainLength: 16,
    parallelFraction: 0.75,
  },
};

// ─── Simulation Engine ─────────────────────────────────────────────────────

function createTasks(config: ScenarioConfig): Task[] {
  const tasks: Task[] = [];
  const parallelCount = Math.floor(config.totalTasks * config.parallelFraction);
  const sequentialCount = config.totalTasks - parallelCount;

  // Parallel tasks (no dependencies)
  for (let i = 0; i < parallelCount; i++) {
    tasks.push({
      id: i,
      state: "pending",
      dependency: null,
      group: Math.floor(i / 32),
    });
  }

  // Sequential tasks (chain dependency)
  for (let i = 0; i < sequentialCount; i++) {
    const taskId = parallelCount + i;
    tasks.push({
      id: taskId,
      state: "pending",
      dependency: i === 0 ? null : taskId - 1,
      group: Math.floor(parallelCount / 32) + 1 + Math.floor(i / 16),
    });
  }

  return tasks;
}

function initSimulation(scenario: ScenarioName): SimulationState {
  const config = SCENARIOS[scenario];
  const tasks = createTasks(config);

  const cpuCores: CoreState[] = Array.from(
    { length: config.cpuCoreCount },
    (_, i) => ({
      id: i,
      busy: false,
      taskId: null,
      progress: 0,
      cyclesLeft: 0,
    })
  );

  const gpuCores: CoreState[] = Array.from(
    { length: config.gpuCoreCount },
    (_, i) => ({
      id: i,
      busy: false,
      taskId: null,
      progress: 0,
      cyclesLeft: 0,
    })
  );

  return {
    cpuCores,
    gpuCores,
    tasks,
    cpuCompleted: 0,
    gpuCompleted: 0,
    cpuCycle: 0,
    gpuCycle: 0,
    cpuFinished: false,
    gpuFinished: false,
    totalTasks: config.totalTasks,
  };
}

function canRunTask(task: Task, completedIds: Set<number>): boolean {
  if (task.state !== "pending") return false;
  if (task.dependency !== null && !completedIds.has(task.dependency)) return false;
  return true;
}

function stepSimulation(
  state: SimulationState,
  config: ScenarioConfig
): SimulationState {
  const newState = {
    ...state,
    cpuCores: state.cpuCores.map((c) => ({ ...c })),
    gpuCores: state.gpuCores.map((c) => ({ ...c })),
    tasks: state.tasks.map((t) => ({ ...t })),
  };

  // Track completed tasks for dependency resolution
  const cpuCompletedIds = new Set<number>();
  const gpuCompletedIds = new Set<number>();
  for (const t of newState.tasks) {
    if (t.state === "done") {
      cpuCompletedIds.add(t.id);
      gpuCompletedIds.add(t.id);
    }
  }

  // ── CPU step ──
  if (!newState.cpuFinished) {
    newState.cpuCycle++;

    // Finish running tasks
    for (const core of newState.cpuCores) {
      if (core.busy && core.taskId !== null) {
        core.cyclesLeft--;
        core.progress = 1 - core.cyclesLeft / config.taskCycles;
        if (core.cyclesLeft <= 0) {
          core.busy = false;
          const task = newState.tasks.find((t) => t.id === core.taskId);
          if (task && task.state === "running") {
            task.state = "done";
            newState.cpuCompleted++;
            cpuCompletedIds.add(task.id);
          }
          core.taskId = null;
          core.progress = 0;
        }
      }
    }

    // Assign new tasks to idle CPU cores
    for (const core of newState.cpuCores) {
      if (!core.busy) {
        const nextTask = newState.tasks.find(
          (t) => canRunTask(t, cpuCompletedIds)
        );
        if (nextTask) {
          core.busy = true;
          core.taskId = nextTask.id;
          core.cyclesLeft = config.taskCycles;
          core.progress = 0;
          nextTask.state = "running";
        }
      }
    }

    if (newState.cpuCompleted >= newState.totalTasks) {
      newState.cpuFinished = true;
    }
  }

  // ── GPU step ──
  if (!newState.gpuFinished) {
    newState.gpuCycle++;

    // Finish running tasks on GPU
    for (const core of newState.gpuCores) {
      if (core.busy && core.taskId !== null) {
        core.cyclesLeft--;
        core.progress = 1 - core.cyclesLeft / config.gpuTaskCycles;
        if (core.cyclesLeft <= 0) {
          core.busy = false;
          const task = newState.tasks.find((t) => t.id === core.taskId);
          if (task && task.state === "running") {
            task.state = "done";
            newState.gpuCompleted++;
            gpuCompletedIds.add(task.id);
          }
          core.taskId = null;
          core.progress = 0;
        }
      }
    }

    // Assign new tasks to idle GPU cores
    for (const core of newState.gpuCores) {
      if (!core.busy) {
        const nextTask = newState.tasks.find(
          (t) => canRunTask(t, gpuCompletedIds)
        );
        if (nextTask) {
          core.busy = true;
          core.taskId = nextTask.id;
          core.cyclesLeft = config.gpuTaskCycles;
          core.progress = 0;
          nextTask.state = "running";
        }
      }
    }

    if (newState.gpuCompleted >= newState.totalTasks) {
      newState.gpuFinished = true;
    }
  }

  return newState;
}

// We need separate task arrays for CPU and GPU since they run independently
function initDualSimulation(scenario: ScenarioName): {
  cpuSim: SimulationState;
  gpuSim: SimulationState;
} {
  const config = SCENARIOS[scenario];
  const cpuTasks = createTasks(config);
  const gpuTasks = createTasks(config);

  const cpuCores: CoreState[] = Array.from(
    { length: config.cpuCoreCount },
    (_, i) => ({
      id: i,
      busy: false,
      taskId: null,
      progress: 0,
      cyclesLeft: 0,
    })
  );

  const gpuCores: CoreState[] = Array.from(
    { length: config.gpuCoreCount },
    (_, i) => ({
      id: i,
      busy: false,
      taskId: null,
      progress: 0,
      cyclesLeft: 0,
    })
  );

  return {
    cpuSim: {
      cpuCores,
      gpuCores: [],
      tasks: cpuTasks,
      cpuCompleted: 0,
      gpuCompleted: 0,
      cpuCycle: 0,
      gpuCycle: 0,
      cpuFinished: false,
      gpuFinished: false,
      totalTasks: config.totalTasks,
    },
    gpuSim: {
      cpuCores: [],
      gpuCores: gpuCores,
      tasks: gpuTasks,
      cpuCompleted: 0,
      gpuCompleted: 0,
      cpuCycle: 0,
      gpuCycle: 0,
      cpuFinished: false,
      gpuFinished: false,
      totalTasks: config.totalTasks,
    },
  };
}

function stepCpuSim(
  state: SimulationState,
  config: ScenarioConfig
): SimulationState {
  if (state.cpuFinished) return state;

  const ns = {
    ...state,
    cpuCores: state.cpuCores.map((c) => ({ ...c })),
    tasks: state.tasks.map((t) => ({ ...t })),
  };

  ns.cpuCycle++;

  const completedIds = new Set<number>();
  for (const t of ns.tasks) {
    if (t.state === "done") completedIds.add(t.id);
  }

  // Process running cores
  for (const core of ns.cpuCores) {
    if (core.busy && core.taskId !== null) {
      core.cyclesLeft--;
      core.progress = 1 - core.cyclesLeft / config.taskCycles;
      if (core.cyclesLeft <= 0) {
        core.busy = false;
        const task = ns.tasks.find((t) => t.id === core.taskId);
        if (task && task.state === "running") {
          task.state = "done";
          ns.cpuCompleted++;
          completedIds.add(task.id);
        }
        core.taskId = null;
        core.progress = 0;
      }
    }
  }

  // Assign idle cores
  for (const core of ns.cpuCores) {
    if (!core.busy) {
      const nextTask = ns.tasks.find((t) => canRunTask(t, completedIds));
      if (nextTask) {
        core.busy = true;
        core.taskId = nextTask.id;
        core.cyclesLeft = config.taskCycles;
        core.progress = 0;
        nextTask.state = "running";
      }
    }
  }

  if (ns.cpuCompleted >= ns.totalTasks) {
    ns.cpuFinished = true;
  }

  return ns;
}

function stepGpuSim(
  state: SimulationState,
  config: ScenarioConfig
): SimulationState {
  if (state.gpuFinished) return state;

  const ns = {
    ...state,
    gpuCores: state.gpuCores.map((c) => ({ ...c })),
    tasks: state.tasks.map((t) => ({ ...t })),
  };

  ns.gpuCycle++;

  const completedIds = new Set<number>();
  for (const t of ns.tasks) {
    if (t.state === "done") completedIds.add(t.id);
  }

  // Process running cores
  for (const core of ns.gpuCores) {
    if (core.busy && core.taskId !== null) {
      core.cyclesLeft--;
      core.progress = 1 - core.cyclesLeft / config.gpuTaskCycles;
      if (core.cyclesLeft <= 0) {
        core.busy = false;
        const task = ns.tasks.find((t) => t.id === core.taskId);
        if (task && task.state === "running") {
          task.state = "done";
          ns.gpuCompleted++;
          completedIds.add(task.id);
        }
        core.taskId = null;
        core.progress = 0;
      }
    }
  }

  // Assign idle cores
  for (const core of ns.gpuCores) {
    if (!core.busy) {
      const nextTask = ns.tasks.find((t) => canRunTask(t, completedIds));
      if (nextTask) {
        core.busy = true;
        core.taskId = nextTask.id;
        core.cyclesLeft = config.gpuTaskCycles;
        core.progress = 0;
        nextTask.state = "running";
      }
    }
  }

  if (ns.gpuCompleted >= ns.totalTasks) {
    ns.gpuFinished = true;
  }

  return ns;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function GpuVsCpuPage() {
  const [scenario, setScenario] = useState<ScenarioName>("vector-add");
  const [cpuSim, setCpuSim] = useState<SimulationState>(() => initDualSimulation("vector-add").cpuSim);
  const [gpuSim, setGpuSim] = useState<SimulationState>(() => initDualSimulation("vector-add").gpuSim);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const config = SCENARIOS[scenario];

  const stepForward = useCallback(() => {
    const cfg = SCENARIOS[scenario];
    setCpuSim((prev) => stepCpuSim(prev, cfg));
    setGpuSim((prev) => stepGpuSim(prev, cfg));
  }, [scenario]);

  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(10, 200 / speedRef.current);
      if (timestamp - lastTickRef.current >= interval) {
        lastTickRef.current = timestamp;
        stepForward();
      }
      animationRef.current = requestAnimationFrame(animationLoop);
    },
    [stepForward]
  );

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Auto-pause when both finished
  useEffect(() => {
    if (cpuSim.cpuFinished && gpuSim.gpuFinished && isPlaying) {
      setIsPlaying(false);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
  }, [cpuSim.cpuFinished, gpuSim.gpuFinished, isPlaying]);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
  }, []);

  const handleStep = useCallback(() => {
    if (isPlaying) return;
    stepForward();
  }, [isPlaying, stepForward]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    const { cpuSim: cs, gpuSim: gs } = initDualSimulation(scenario);
    setCpuSim(cs);
    setGpuSim(gs);
  }, [scenario]);

  const handleScenarioChange = useCallback((s: ScenarioName) => {
    setIsPlaying(false);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    setScenario(s);
    const { cpuSim: cs, gpuSim: gs } = initDualSimulation(s);
    setCpuSim(cs);
    setGpuSim(gs);
    setDropdownOpen(false);
  }, []);

  // Derived metrics
  const cpuProgress = cpuSim.totalTasks > 0 ? (cpuSim.cpuCompleted / cpuSim.totalTasks) * 100 : 0;
  const gpuProgress = gpuSim.totalTasks > 0 ? (gpuSim.gpuCompleted / gpuSim.totalTasks) * 100 : 0;
  const cpuBusyCores = cpuSim.cpuCores.filter((c) => c.busy).length;
  const gpuBusyCores = gpuSim.gpuCores.filter((c) => c.busy).length;
  const cpuUtilization = config.cpuCoreCount > 0 ? (cpuBusyCores / config.cpuCoreCount) * 100 : 0;
  const gpuUtilization = config.gpuCoreCount > 0 ? (gpuBusyCores / config.gpuCoreCount) * 100 : 0;

  const speedupFactor = useMemo(() => {
    if (cpuSim.cpuFinished && gpuSim.gpuFinished) {
      if (gpuSim.gpuCycle === 0) return 0;
      return cpuSim.cpuCycle / gpuSim.gpuCycle;
    }
    if (gpuSim.gpuCycle === 0 || cpuSim.cpuCycle === 0) return 0;
    // Estimate based on current progress
    const cpuRate = cpuSim.cpuCompleted / cpuSim.cpuCycle;
    const gpuRate = gpuSim.gpuCompleted / gpuSim.gpuCycle;
    if (cpuRate === 0 || gpuRate === 0) return 0;
    return gpuRate / cpuRate;
  }, [cpuSim, gpuSim]);

  // For task grid visualization, show a sampled subset
  const cpuTaskDisplay = useMemo(() => {
    const maxDisplay = 256;
    const step = Math.max(1, Math.floor(cpuSim.tasks.length / maxDisplay));
    const sampled: Task[] = [];
    for (let i = 0; i < cpuSim.tasks.length; i += step) {
      sampled.push(cpuSim.tasks[i]);
    }
    return sampled;
  }, [cpuSim.tasks]);

  const gpuTaskDisplay = useMemo(() => {
    const maxDisplay = 256;
    const step = Math.max(1, Math.floor(gpuSim.tasks.length / maxDisplay));
    const sampled: Task[] = [];
    for (let i = 0; i < gpuSim.tasks.length; i += step) {
      sampled.push(gpuSim.tasks[i]);
    }
    return sampled;
  }, [gpuSim.tasks]);

  // Grid columns for task display
  const gridCols = useMemo(() => {
    const count = cpuTaskDisplay.length;
    if (count <= 64) return 8;
    if (count <= 128) return 16;
    return 16;
  }, [cpuTaskDisplay.length]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />
      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-1 rounded-md bg-[#a855f7]/15 text-[#a855f7] text-xs font-mono font-semibold tracking-wide">
                10.1
              </span>
              <h1 className="text-2xl font-bold tracking-tight">
                GPU vs CPU Architecture
              </h1>
            </div>
            <p className="text-[#a1a1aa] text-sm max-w-2xl">
              Compare how CPUs and GPUs process workloads. CPUs have few powerful
              cores optimized for sequential tasks with low latency. GPUs have
              thousands of simple cores optimized for massive parallelism and
              high throughput.
            </p>
          </div>

          {/* Scenario Selector */}
          <div className="relative mb-4 inline-block">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e] hover:border-[#a855f7]/40 transition-all text-sm"
            >
              <Zap size={14} className="text-[#a855f7]" />
              <span className="text-white font-medium">{config.label}</span>
              <ChevronDown
                size={14}
                className={`text-[#71717a] transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
              />
            </button>
            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute z-50 mt-1 w-72 bg-[#111118] border border-[#1e1e2e] rounded-lg shadow-xl overflow-hidden"
                >
                  {(Object.keys(SCENARIOS) as ScenarioName[]).map((s) => {
                    const sc = SCENARIOS[s];
                    return (
                      <button
                        key={s}
                        onClick={() => handleScenarioChange(s)}
                        className={`w-full text-left px-4 py-3 hover:bg-[#1e1e2e] transition-colors ${
                          s === scenario ? "bg-[#a855f7]/10" : ""
                        }`}
                      >
                        <div className="text-sm font-medium text-white">
                          {sc.label}
                        </div>
                        <div className="text-xs text-[#71717a] mt-0.5">
                          {sc.description.slice(0, 80)}...
                        </div>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Architecture Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {/* CPU Architecture */}
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Cpu size={16} className="text-[#6366f1]" />
                <span className="text-sm font-semibold text-white">CPU</span>
                <span className="text-xs text-[#71717a] ml-auto font-mono">
                  {config.cpuCoreCount} cores
                </span>
              </div>

              {/* CPU Die Layout */}
              <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg p-3 mb-3">
                <div className="grid grid-cols-4 gap-2">
                  {cpuSim.cpuCores.map((core, i) => (
                    <motion.div
                      key={core.id}
                      className="relative rounded-lg border p-2 min-h-[80px]"
                      style={{
                        borderColor: core.busy ? "#6366f1" : "#1e1e2e",
                        backgroundColor: core.busy
                          ? "rgba(99,102,241,0.08)"
                          : "#111118",
                      }}
                      animate={{
                        boxShadow: core.busy
                          ? "0 0 12px rgba(99,102,241,0.3)"
                          : "none",
                      }}
                    >
                      <div className="text-[9px] font-mono text-[#71717a] mb-1">
                        Core {i}
                      </div>
                      {/* Large ALU */}
                      <div
                        className="rounded h-5 mb-1 flex items-center justify-center"
                        style={{
                          backgroundColor: core.busy
                            ? "rgba(99,102,241,0.25)"
                            : "#1e1e2e",
                        }}
                      >
                        <span className="text-[8px] font-mono text-[#a1a1aa]">
                          ALU
                        </span>
                      </div>
                      {/* Control Unit */}
                      <div className="rounded h-3 mb-1 bg-[#1e1e2e] flex items-center justify-center">
                        <span className="text-[7px] font-mono text-[#71717a]">
                          CTRL
                        </span>
                      </div>
                      {/* Cache */}
                      <div className="rounded h-3 bg-[#1e1e2e] flex items-center justify-center">
                        <span className="text-[7px] font-mono text-[#71717a]">
                          L1/L2
                        </span>
                      </div>
                      {/* Progress overlay */}
                      {core.busy && (
                        <motion.div
                          className="absolute bottom-0 left-0 right-0 h-1 rounded-b-lg bg-[#6366f1]"
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: core.progress }}
                          style={{ transformOrigin: "left" }}
                        />
                      )}
                      {/* Task ID */}
                      {core.taskId !== null && (
                        <div className="absolute top-1 right-1.5 text-[8px] font-mono text-[#6366f1]">
                          T{core.taskId}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
                {/* L3 Cache */}
                <div className="mt-2 rounded h-4 bg-[#1e1e2e] flex items-center justify-center">
                  <span className="text-[8px] font-mono text-[#71717a]">
                    Shared L3 Cache (large)
                  </span>
                </div>
              </div>

              {/* CPU Progress */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#71717a] font-mono">Progress</span>
                  <span className="text-[#6366f1] font-mono font-bold">
                    {cpuProgress.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 bg-[#1e1e2e] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-[#6366f1] to-[#818cf8]"
                    animate={{ width: `${cpuProgress}%` }}
                    transition={{ duration: 0.1 }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-[#71717a] font-mono">
                  <span>Cycle: {cpuSim.cpuCycle}</span>
                  <span>
                    Done: {cpuSim.cpuCompleted}/{cpuSim.totalTasks}
                  </span>
                </div>
              </div>
            </div>

            {/* GPU Architecture */}
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Grid3X3 size={16} className="text-[#a855f7]" />
                <span className="text-sm font-semibold text-white">GPU</span>
                <span className="text-xs text-[#71717a] ml-auto font-mono">
                  {config.gpuCoreCount} cores
                </span>
              </div>

              {/* GPU Die Layout - Grid of SMs */}
              <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg p-3 mb-3">
                <div className="text-[9px] font-mono text-[#71717a] mb-2">
                  Streaming Multiprocessors (SMs)
                </div>
                <div className="grid grid-cols-16 gap-[2px]">
                  {gpuSim.gpuCores.slice(0, 256).map((core, i) => (
                    <motion.div
                      key={core.id}
                      className="aspect-square rounded-[2px]"
                      style={{
                        backgroundColor: core.busy
                          ? "#a855f7"
                          : core.taskId !== null
                            ? "#a855f740"
                            : "#1e1e2e",
                      }}
                      animate={{
                        opacity: core.busy ? [0.7, 1, 0.7] : 1,
                      }}
                      transition={{
                        duration: 0.5,
                        repeat: core.busy ? Infinity : 0,
                      }}
                      title={`Core ${i}${core.taskId !== null ? ` - Task ${core.taskId}` : ""}`}
                    />
                  ))}
                </div>
                {/* Shared Memory */}
                <div className="mt-2 rounded h-3 bg-[#1e1e2e] flex items-center justify-center">
                  <span className="text-[7px] font-mono text-[#71717a]">
                    Global Memory (DRAM)
                  </span>
                </div>
              </div>

              {/* GPU Progress */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#71717a] font-mono">Progress</span>
                  <span className="text-[#a855f7] font-mono font-bold">
                    {gpuProgress.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 bg-[#1e1e2e] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-[#a855f7] to-[#c084fc]"
                    animate={{ width: `${gpuProgress}%` }}
                    transition={{ duration: 0.1 }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-[#71717a] font-mono">
                  <span>Cycle: {gpuSim.gpuCycle}</span>
                  <span>
                    Done: {gpuSim.gpuCompleted}/{gpuSim.totalTasks}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Task Execution Visualization */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {/* CPU Tasks Grid */}
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Layers size={14} className="text-[#6366f1]" />
                <span className="text-xs font-semibold text-white">
                  CPU Task Queue
                </span>
                <span className="text-[10px] text-[#71717a] ml-auto font-mono">
                  {config.cpuCoreCount} at a time
                </span>
              </div>
              <div
                className="grid gap-[2px]"
                style={{
                  gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
                }}
              >
                {cpuTaskDisplay.map((task) => (
                  <motion.div
                    key={task.id}
                    className="aspect-square rounded-[2px]"
                    style={{
                      backgroundColor:
                        task.state === "done"
                          ? "#10b981"
                          : task.state === "running"
                            ? "#6366f1"
                            : task.dependency !== null
                              ? "#2a1a1a"
                              : "#1e1e2e",
                    }}
                    animate={{
                      scale: task.state === "running" ? [1, 1.15, 1] : 1,
                    }}
                    transition={{
                      duration: 0.3,
                      repeat: task.state === "running" ? Infinity : 0,
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-sm bg-[#1e1e2e]" />
                  <span className="text-[9px] text-[#71717a]">Pending</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-sm bg-[#6366f1]" />
                  <span className="text-[9px] text-[#71717a]">Running</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-sm bg-[#10b981]" />
                  <span className="text-[9px] text-[#71717a]">Done</span>
                </div>
                {config.hasSequentialDeps && (
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-sm bg-[#2a1a1a]" />
                    <span className="text-[9px] text-[#71717a]">
                      Dependency
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* GPU Tasks Grid */}
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Layers size={14} className="text-[#a855f7]" />
                <span className="text-xs font-semibold text-white">
                  GPU Task Queue
                </span>
                <span className="text-[10px] text-[#71717a] ml-auto font-mono">
                  {config.gpuCoreCount} at a time
                </span>
              </div>
              <div
                className="grid gap-[2px]"
                style={{
                  gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
                }}
              >
                {gpuTaskDisplay.map((task) => (
                  <motion.div
                    key={task.id}
                    className="aspect-square rounded-[2px]"
                    style={{
                      backgroundColor:
                        task.state === "done"
                          ? "#10b981"
                          : task.state === "running"
                            ? "#a855f7"
                            : task.dependency !== null
                              ? "#2a1a1a"
                              : "#1e1e2e",
                    }}
                    animate={{
                      scale: task.state === "running" ? [1, 1.15, 1] : 1,
                    }}
                    transition={{
                      duration: 0.3,
                      repeat: task.state === "running" ? Infinity : 0,
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-sm bg-[#1e1e2e]" />
                  <span className="text-[9px] text-[#71717a]">Pending</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-sm bg-[#a855f7]" />
                  <span className="text-[9px] text-[#71717a]">Running</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-sm bg-[#10b981]" />
                  <span className="text-[9px] text-[#71717a]">Done</span>
                </div>
              </div>
            </div>
          </div>

          {/* Latency vs Throughput Comparison */}
          <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <Activity size={14} className="text-[#f59e0b]" />
              <span className="text-sm font-semibold text-white">
                Latency vs Throughput
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Latency comparison */}
              <div className="space-y-2">
                <div className="text-xs text-[#71717a] font-mono mb-1">
                  Latency (cycles per task)
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#6366f1] font-mono w-8">
                    CPU
                  </span>
                  <div className="flex-1 h-4 bg-[#0a0a0f] rounded overflow-hidden relative">
                    <motion.div
                      className="h-full bg-[#6366f1] rounded"
                      style={{
                        width: `${(config.taskCycles / Math.max(config.taskCycles, config.gpuTaskCycles)) * 100}%`,
                      }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-white">
                      {config.taskCycles} cycles
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#a855f7] font-mono w-8">
                    GPU
                  </span>
                  <div className="flex-1 h-4 bg-[#0a0a0f] rounded overflow-hidden relative">
                    <motion.div
                      className="h-full bg-[#a855f7] rounded"
                      style={{
                        width: `${(config.gpuTaskCycles / Math.max(config.taskCycles, config.gpuTaskCycles)) * 100}%`,
                      }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-white">
                      {config.gpuTaskCycles} cycles
                    </span>
                  </div>
                </div>
                <div className="text-[10px] text-[#71717a] mt-1">
                  {config.taskCycles <= config.gpuTaskCycles
                    ? "CPU has lower per-task latency"
                    : "GPU has lower per-task latency"}
                </div>
              </div>

              {/* Throughput comparison */}
              <div className="space-y-2">
                <div className="text-xs text-[#71717a] font-mono mb-1">
                  Throughput (tasks per cycle)
                </div>
                {(() => {
                  const cpuThroughput = config.cpuCoreCount / config.taskCycles;
                  const gpuThroughput =
                    (config.gpuCoreCount * config.parallelFraction) / config.gpuTaskCycles;
                  const maxThroughput = Math.max(cpuThroughput, gpuThroughput);
                  return (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[#6366f1] font-mono w-8">
                          CPU
                        </span>
                        <div className="flex-1 h-4 bg-[#0a0a0f] rounded overflow-hidden relative">
                          <motion.div
                            className="h-full bg-[#6366f1] rounded"
                            style={{
                              width: `${(cpuThroughput / maxThroughput) * 100}%`,
                            }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-white">
                            {cpuThroughput.toFixed(1)} tasks/cycle
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[#a855f7] font-mono w-8">
                          GPU
                        </span>
                        <div className="flex-1 h-4 bg-[#0a0a0f] rounded overflow-hidden relative">
                          <motion.div
                            className="h-full bg-[#a855f7] rounded"
                            style={{
                              width: `${(gpuThroughput / maxThroughput) * 100}%`,
                            }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-white">
                            {gpuThroughput.toFixed(1)} tasks/cycle
                          </span>
                        </div>
                      </div>
                      <div className="text-[10px] text-[#71717a] mt-1">
                        {gpuThroughput > cpuThroughput
                          ? `GPU has ${(gpuThroughput / cpuThroughput).toFixed(1)}x higher throughput`
                          : `CPU has ${(cpuThroughput / gpuThroughput).toFixed(1)}x higher effective throughput`}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Speedup Factor Display */}
          <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Zap size={16} className="text-[#f59e0b]" />
                <div>
                  <div className="text-sm font-semibold text-white">
                    Speedup Factor
                  </div>
                  <div className="text-[10px] text-[#71717a] font-mono">
                    {cpuSim.cpuFinished && gpuSim.gpuFinished
                      ? "Final result"
                      : "Estimated from current progress"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <motion.span
                  className="text-3xl font-bold font-mono"
                  style={{
                    color:
                      speedupFactor > 1
                        ? "#10b981"
                        : speedupFactor < 1 && speedupFactor > 0
                          ? "#ef4444"
                          : "#71717a",
                  }}
                  key={speedupFactor.toFixed(1)}
                  initial={{ scale: 1.2 }}
                  animate={{ scale: 1 }}
                >
                  {speedupFactor > 0 ? speedupFactor.toFixed(1) : "--"}x
                </motion.span>
                <div className="text-xs text-[#71717a]">
                  {speedupFactor > 1
                    ? "GPU faster"
                    : speedupFactor < 1 && speedupFactor > 0
                      ? "CPU faster"
                      : ""}
                </div>
              </div>
            </div>

            {/* Visual speedup bar */}
            {speedupFactor > 0 && (
              <div className="mt-3 relative h-6 bg-[#0a0a0f] rounded-lg overflow-hidden">
                <motion.div
                  className="absolute top-0 bottom-0 left-0 rounded-lg"
                  style={{
                    backgroundColor:
                      speedupFactor > 1
                        ? "rgba(16,185,129,0.2)"
                        : "rgba(239,68,68,0.2)",
                  }}
                  animate={{
                    width: `${Math.min(100, (speedupFactor / Math.max(speedupFactor, 1)) * 100)}%`,
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] font-mono text-[#a1a1aa]">
                    {speedupFactor > 1
                      ? `GPU completes in ${((1 / speedupFactor) * 100).toFixed(0)}% of CPU time`
                      : speedupFactor < 1 && speedupFactor > 0
                        ? `GPU takes ${((1 / speedupFactor) * 100).toFixed(0)}% more time than CPU`
                        : "Running..."}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="mb-4">
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
            />
          </div>

          {/* Metrics Panel */}
          <AnimatePresence>
            {showMetrics && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
                  <MetricCard
                    label="CPU Cores"
                    value={config.cpuCoreCount.toString()}
                    color="#6366f1"
                  />
                  <MetricCard
                    label="GPU Cores"
                    value={config.gpuCoreCount.toString()}
                    color="#a855f7"
                  />
                  <MetricCard
                    label="CPU Done"
                    value={`${cpuSim.cpuCompleted}/${cpuSim.totalTasks}`}
                    color="#6366f1"
                  />
                  <MetricCard
                    label="GPU Done"
                    value={`${gpuSim.gpuCompleted}/${gpuSim.totalTasks}`}
                    color="#a855f7"
                  />
                  <MetricCard
                    label="CPU Util"
                    value={`${cpuUtilization.toFixed(0)}%`}
                    color="#06b6d4"
                  />
                  <MetricCard
                    label="GPU Util"
                    value={`${gpuUtilization.toFixed(0)}%`}
                    color="#06b6d4"
                  />
                  <MetricCard
                    label="Speedup"
                    value={
                      speedupFactor > 0
                        ? `${speedupFactor.toFixed(1)}x`
                        : "--"
                    }
                    color="#10b981"
                  />
                  <MetricCard
                    label="Parallel %"
                    value={`${(config.parallelFraction * 100).toFixed(0)}%`}
                    color="#f59e0b"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Info Section */}
          <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
            <div className="text-sm font-semibold text-white mb-2">
              Key Concepts
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-[#a1a1aa]">
              <div>
                <div className="text-[#6366f1] font-semibold mb-1">
                  CPU Architecture
                </div>
                <ul className="space-y-1 list-disc list-inside text-[#71717a]">
                  <li>Few cores (4-16) with complex control logic</li>
                  <li>Large caches (L1/L2/L3) for low memory latency</li>
                  <li>Out-of-order execution, branch prediction</li>
                  <li>Optimized for single-thread performance</li>
                  <li>Best for sequential, branching workloads</li>
                </ul>
              </div>
              <div>
                <div className="text-[#a855f7] font-semibold mb-1">
                  GPU Architecture
                </div>
                <ul className="space-y-1 list-disc list-inside text-[#71717a]">
                  <li>Thousands of simple cores (CUDA cores / SMs)</li>
                  <li>Small caches, rely on massive parallelism to hide latency</li>
                  <li>SIMT: Single Instruction, Multiple Threads</li>
                  <li>Optimized for throughput over latency</li>
                  <li>Best for data-parallel, regular workloads</li>
                </ul>
              </div>
            </div>

            {/* Scenario explanation */}
            <div className="mt-4 p-3 bg-[#0a0a0f] rounded-lg border border-[#1e1e2e]">
              <div className="text-[#f59e0b] text-xs font-semibold mb-1">
                {config.label}
              </div>
              <p className="text-xs text-[#71717a]">{config.description}</p>
              {scenario === "sequential" && (
                <p className="text-xs text-[#ef4444] mt-1">
                  Note: Sequential dependencies prevent GPU from utilizing its
                  parallelism. The GPU&apos;s higher per-task latency makes it slower
                  here.
                </p>
              )}
              {scenario === "mixed" && (
                <p className="text-xs text-[#f59e0b] mt-1">
                  Amdahl&apos;s Law: the sequential portion limits the overall
                  speedup, even with infinite parallel processors.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Metric Card ────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="px-2.5 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]">
      <span className="text-[9px] text-[#71717a] font-mono block">{label}</span>
      <span className="text-sm font-bold font-mono" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
