"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  ChevronDown,
  Activity,
  Layers,
  GitBranch,
  Clock,
  Cpu,
  AlertTriangle,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ──────────────────────────────────────────────────────────────────

type ScenarioName = "no-divergence" | "if-else" | "scheduling" | "memory-stall";

type LaneState = "active" | "masked" | "idle";

type WarpState = "active" | "eligible" | "stalled" | "completed";

type InstructionType =
  | "compute"
  | "branch-if"
  | "branch-else"
  | "memory-load"
  | "memory-store"
  | "converge"
  | "nop";

interface Instruction {
  id: number;
  type: InstructionType;
  label: string;
  activeMask: boolean[]; // 32 booleans
  stallCycles: number;
  branchPath?: "if" | "else";
}

interface WarpData {
  id: number;
  state: WarpState;
  currentInstrIdx: number;
  instructions: Instruction[];
  lanes: LaneState[];
  activeMask: boolean[];
  stallCyclesRemaining: number;
  instructionsExecuted: number;
  totalCycles: number;
  switchCount: number;
}

interface TimelineEntry {
  cycle: number;
  warpId: number;
  instrLabel: string;
  instrType: InstructionType;
  activeLanes: number;
  state: WarpState;
}

interface SimState {
  warps: WarpData[];
  currentWarpIdx: number;
  cycle: number;
  timeline: TimelineEntry[];
  divergentBranches: number;
  totalWarpSwitches: number;
  totalInstructionsExecuted: number;
  finished: boolean;
}

interface ScenarioConfig {
  name: string;
  label: string;
  description: string;
  warpCount: number;
  instructions: Instruction[][];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function allActive(): boolean[] {
  return Array(32).fill(true);
}

function evenLanes(): boolean[] {
  return Array.from({ length: 32 }, (_, i) => i % 2 === 0);
}

function oddLanes(): boolean[] {
  return Array.from({ length: 32 }, (_, i) => i % 2 !== 0);
}

function countActive(mask: boolean[]): number {
  return mask.filter(Boolean).length;
}

// ─── Scenario Definitions ───────────────────────────────────────────────────

function buildScenarios(): Record<ScenarioName, ScenarioConfig> {
  return {
    "no-divergence": {
      name: "no-divergence",
      label: "No Divergence",
      description:
        "All 32 lanes execute the same path. Maximum SIMT efficiency with full lane utilization.",
      warpCount: 1,
      instructions: [
        [
          { id: 0, type: "compute", label: "LOAD x[tid]", activeMask: allActive(), stallCycles: 0 },
          { id: 1, type: "compute", label: "MUL x, 2.0", activeMask: allActive(), stallCycles: 0 },
          { id: 2, type: "compute", label: "ADD x, bias", activeMask: allActive(), stallCycles: 0 },
          { id: 3, type: "compute", label: "STORE y[tid]", activeMask: allActive(), stallCycles: 0 },
          { id: 4, type: "compute", label: "LOAD z[tid]", activeMask: allActive(), stallCycles: 0 },
          { id: 5, type: "compute", label: "ADD y, z", activeMask: allActive(), stallCycles: 0 },
          { id: 6, type: "compute", label: "STORE out[tid]", activeMask: allActive(), stallCycles: 0 },
        ],
      ],
    },
    "if-else": {
      name: "if-else",
      label: "If-Else Divergence",
      description:
        "Threads diverge at a branch: even-indexed threads take the if-path, odd threads take else-path. Both paths are executed serially with different active masks.",
      warpCount: 1,
      instructions: [
        [
          { id: 0, type: "compute", label: "LOAD val[tid]", activeMask: allActive(), stallCycles: 0 },
          { id: 1, type: "compute", label: "CMP val > 0", activeMask: allActive(), stallCycles: 0 },
          { id: 2, type: "branch-if", label: "BRA if_path", activeMask: allActive(), stallCycles: 0 },
          { id: 3, type: "compute", label: "  ADD val, 10", activeMask: evenLanes(), stallCycles: 0, branchPath: "if" },
          { id: 4, type: "compute", label: "  MUL val, 2", activeMask: evenLanes(), stallCycles: 0, branchPath: "if" },
          { id: 5, type: "branch-else", label: "BRA else_path", activeMask: evenLanes(), stallCycles: 0 },
          { id: 6, type: "compute", label: "  SUB val, 5", activeMask: oddLanes(), stallCycles: 0, branchPath: "else" },
          { id: 7, type: "compute", label: "  DIV val, 3", activeMask: oddLanes(), stallCycles: 0, branchPath: "else" },
          { id: 8, type: "converge", label: "CONVERGE", activeMask: allActive(), stallCycles: 0 },
          { id: 9, type: "compute", label: "STORE out[tid]", activeMask: allActive(), stallCycles: 0 },
        ],
      ],
    },
    scheduling: {
      name: "scheduling",
      label: "Warp Scheduling",
      description:
        "Multiple warps compete for execution. The scheduler picks an eligible warp each cycle, switching between warps to hide latency.",
      warpCount: 4,
      instructions: [
        [
          { id: 0, type: "compute", label: "W0: LOAD a", activeMask: allActive(), stallCycles: 0 },
          { id: 1, type: "memory-load", label: "W0: MEM_LOAD", activeMask: allActive(), stallCycles: 3 },
          { id: 2, type: "compute", label: "W0: ADD a, b", activeMask: allActive(), stallCycles: 0 },
          { id: 3, type: "compute", label: "W0: STORE c", activeMask: allActive(), stallCycles: 0 },
        ],
        [
          { id: 0, type: "compute", label: "W1: LOAD d", activeMask: allActive(), stallCycles: 0 },
          { id: 1, type: "compute", label: "W1: MUL d, e", activeMask: allActive(), stallCycles: 0 },
          { id: 2, type: "memory-load", label: "W1: MEM_LOAD", activeMask: allActive(), stallCycles: 3 },
          { id: 3, type: "compute", label: "W1: ADD d, f", activeMask: allActive(), stallCycles: 0 },
          { id: 4, type: "compute", label: "W1: STORE g", activeMask: allActive(), stallCycles: 0 },
        ],
        [
          { id: 0, type: "compute", label: "W2: LOAD h", activeMask: allActive(), stallCycles: 0 },
          { id: 1, type: "compute", label: "W2: SUB h, i", activeMask: allActive(), stallCycles: 0 },
          { id: 2, type: "compute", label: "W2: MUL h, 3", activeMask: allActive(), stallCycles: 0 },
          { id: 3, type: "memory-load", label: "W2: MEM_LOAD", activeMask: allActive(), stallCycles: 2 },
          { id: 4, type: "compute", label: "W2: STORE j", activeMask: allActive(), stallCycles: 0 },
        ],
        [
          { id: 0, type: "compute", label: "W3: LOAD k", activeMask: allActive(), stallCycles: 0 },
          { id: 1, type: "compute", label: "W3: ADD k, 1", activeMask: allActive(), stallCycles: 0 },
          { id: 2, type: "compute", label: "W3: STORE l", activeMask: allActive(), stallCycles: 0 },
        ],
      ],
    },
    "memory-stall": {
      name: "memory-stall",
      label: "Memory Stall",
      description:
        "A single warp hits multiple memory stalls. Without other warps to switch to, the SM sits idle, showing why occupancy matters.",
      warpCount: 1,
      instructions: [
        [
          { id: 0, type: "compute", label: "LOAD addr", activeMask: allActive(), stallCycles: 0 },
          { id: 1, type: "memory-load", label: "MEM_LOAD [global]", activeMask: allActive(), stallCycles: 4 },
          { id: 2, type: "compute", label: "COMPUTE val", activeMask: allActive(), stallCycles: 0 },
          { id: 3, type: "memory-load", label: "MEM_LOAD [global]", activeMask: allActive(), stallCycles: 4 },
          { id: 4, type: "compute", label: "ADD val, tmp", activeMask: allActive(), stallCycles: 0 },
          { id: 5, type: "memory-store", label: "MEM_STORE [global]", activeMask: allActive(), stallCycles: 3 },
          { id: 6, type: "compute", label: "DONE", activeMask: allActive(), stallCycles: 0 },
        ],
      ],
    },
  };
}

const SCENARIOS = buildScenarios();

const WARP_COLORS = ["#10b981", "#6366f1", "#f59e0b", "#ec4899"];

// ─── Simulation Engine ─────────────────────────────────────────────────────

function initSimState(scenario: ScenarioName): SimState {
  const config = SCENARIOS[scenario];

  const warps: WarpData[] = config.instructions.map((instrs, i) => ({
    id: i,
    state: i === 0 ? "active" : "eligible",
    currentInstrIdx: 0,
    instructions: instrs.map((instr) => ({ ...instr })),
    lanes: Array(32).fill("active") as LaneState[],
    activeMask: allActive(),
    stallCyclesRemaining: 0,
    instructionsExecuted: 0,
    totalCycles: 0,
    switchCount: 0,
  }));

  return {
    warps,
    currentWarpIdx: 0,
    cycle: 0,
    timeline: [],
    divergentBranches: 0,
    totalWarpSwitches: 0,
    totalInstructionsExecuted: 0,
    finished: false,
  };
}

function stepSimState(state: SimState): SimState {
  if (state.finished) return state;

  const ns: SimState = {
    ...state,
    warps: state.warps.map((w) => ({
      ...w,
      lanes: [...w.lanes],
      activeMask: [...w.activeMask],
      instructions: w.instructions.map((i) => ({ ...i, activeMask: [...i.activeMask] })),
    })),
    timeline: [...state.timeline],
    cycle: state.cycle + 1,
  };

  // Decrement stall counters
  for (const warp of ns.warps) {
    if (warp.state === "stalled" && warp.stallCyclesRemaining > 0) {
      warp.stallCyclesRemaining--;
      if (warp.stallCyclesRemaining <= 0) {
        warp.state = "eligible";
      }
    }
  }

  // Find current warp (try current, then pick eligible)
  let currentWarp = ns.warps[ns.currentWarpIdx];

  // If current warp is done or stalled, find next eligible
  if (
    !currentWarp ||
    currentWarp.state === "stalled" ||
    currentWarp.state === "completed"
  ) {
    const eligibleIdx = ns.warps.findIndex(
      (w) => w.state === "eligible" || w.state === "active"
    );
    if (eligibleIdx !== -1) {
      if (eligibleIdx !== ns.currentWarpIdx) {
        ns.totalWarpSwitches++;
        if (ns.warps[eligibleIdx]) {
          ns.warps[eligibleIdx].switchCount++;
        }
      }
      ns.currentWarpIdx = eligibleIdx;
      currentWarp = ns.warps[eligibleIdx];
      currentWarp.state = "active";
    } else {
      // All warps stalled or done - add stall entry
      ns.timeline.push({
        cycle: ns.cycle,
        warpId: -1,
        instrLabel: "STALL (all warps)",
        instrType: "nop",
        activeLanes: 0,
        state: "stalled",
      });

      // Check if truly finished (all completed)
      const allDone = ns.warps.every((w) => w.state === "completed");
      if (allDone) ns.finished = true;
      return ns;
    }
  }

  // Execute current instruction
  if (currentWarp.currentInstrIdx < currentWarp.instructions.length) {
    const instr = currentWarp.instructions[currentWarp.currentInstrIdx];

    // Update active mask based on instruction
    currentWarp.activeMask = [...instr.activeMask];
    currentWarp.lanes = currentWarp.activeMask.map((active) =>
      active ? "active" : "masked"
    );

    // Track divergence
    if (instr.type === "branch-if" || instr.type === "branch-else") {
      ns.divergentBranches++;
    }

    // Add timeline entry
    ns.timeline.push({
      cycle: ns.cycle,
      warpId: currentWarp.id,
      instrLabel: instr.label,
      instrType: instr.type,
      activeLanes: countActive(instr.activeMask),
      state: "active",
    });

    currentWarp.instructionsExecuted++;
    ns.totalInstructionsExecuted++;
    currentWarp.currentInstrIdx++;

    // Handle stalls from memory operations
    if (instr.stallCycles > 0) {
      currentWarp.state = "stalled";
      currentWarp.stallCyclesRemaining = instr.stallCycles;

      // Try to switch to next eligible warp
      const nextEligible = ns.warps.findIndex(
        (w, idx) =>
          idx !== ns.currentWarpIdx &&
          (w.state === "eligible" || w.state === "active")
      );
      if (nextEligible !== -1) {
        ns.totalWarpSwitches++;
        ns.warps[nextEligible].switchCount++;
        ns.currentWarpIdx = nextEligible;
        ns.warps[nextEligible].state = "active";
      }
    }

    // Check if warp finished
    if (currentWarp.currentInstrIdx >= currentWarp.instructions.length) {
      currentWarp.state = "completed";
      currentWarp.lanes = Array(32).fill("idle");
    }
  }

  // Check overall completion
  const allDone = ns.warps.every((w) => w.state === "completed");
  if (allDone) ns.finished = true;

  return ns;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function WarpExecutionPage() {
  const [scenario, setScenario] = useState<ScenarioName>("no-divergence");
  const [simState, setSimState] = useState<SimState>(() => initSimState("no-divergence"));
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedWarp, setSelectedWarp] = useState(0);

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
    setSimState((prev) => stepSimState(prev));
  }, []);

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

  // Auto-pause when finished
  useEffect(() => {
    if (simState.finished && isPlaying) {
      setIsPlaying(false);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
  }, [simState.finished, isPlaying]);

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
    setSimState(initSimState(scenario));
    setSelectedWarp(0);
  }, [scenario]);

  const handleScenarioChange = useCallback((s: ScenarioName) => {
    setIsPlaying(false);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    setScenario(s);
    setSimState(initSimState(s));
    setSelectedWarp(0);
    setDropdownOpen(false);
  }, []);

  // Derived metrics
  const currentWarp = simState.warps[selectedWarp] || simState.warps[0];
  const activeLaneCount = currentWarp
    ? countActive(currentWarp.activeMask)
    : 0;
  const laneUtilization = (activeLaneCount / 32) * 100;

  const overallUtilization = useMemo(() => {
    if (simState.timeline.length === 0) return 0;
    const totalLanes = simState.timeline.reduce(
      (acc, t) => acc + t.activeLanes,
      0
    );
    return (totalLanes / (simState.timeline.length * 32)) * 100;
  }, [simState.timeline]);

  // Timeline display (last 20 entries)
  const timelineDisplay = useMemo(() => {
    return simState.timeline.slice(-24);
  }, [simState.timeline]);

  // Occupancy bar data
  const maxWarps = 4;
  const occupancy = (simState.warps.length / maxWarps) * 100;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />
      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-1 rounded-md bg-[#a855f7]/15 text-[#a855f7] text-xs font-mono font-semibold tracking-wide">
                10.3
              </span>
              <h1 className="text-2xl font-bold tracking-tight">
                Warp Execution
              </h1>
            </div>
            <p className="text-[#a1a1aa] text-sm max-w-2xl">
              Visualize how GPU warps of 32 threads execute instructions in
              lockstep (SIMT), handle branch divergence with active masks, and
              get scheduled by the warp scheduler.
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
                  className="absolute z-50 mt-1 w-80 bg-[#111118] border border-[#1e1e2e] rounded-lg shadow-xl overflow-hidden"
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

          {/* Warp Selector (for multi-warp scenarios) */}
          {simState.warps.length > 1 && (
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs text-[#71717a] font-mono">
                View Warp:
              </span>
              {simState.warps.map((w, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedWarp(i)}
                  className={`px-3 py-1 rounded-md text-xs font-mono transition-all ${
                    selectedWarp === i
                      ? "text-white border"
                      : "text-[#71717a] bg-[#111118] border border-[#1e1e2e] hover:border-[#2a2a3e]"
                  }`}
                  style={{
                    borderColor:
                      selectedWarp === i ? WARP_COLORS[i] : undefined,
                    backgroundColor:
                      selectedWarp === i
                        ? `${WARP_COLORS[i]}15`
                        : undefined,
                    color: selectedWarp === i ? WARP_COLORS[i] : undefined,
                  }}
                >
                  W{i}
                  <span className="ml-1 text-[9px]">
                    ({w.state === "completed" ? "done" : w.state})
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Main Visualization */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 mb-4">
            {/* Left: Warp Lanes + Instructions */}
            <div className="space-y-4">
              {/* Lane Visualization (32 lanes) */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Layers size={14} className="text-[#10b981]" />
                  <span className="text-sm font-semibold text-white">
                    Warp {selectedWarp} Lanes (32 threads)
                  </span>
                  <span className="text-[10px] text-[#71717a] ml-auto font-mono">
                    {activeLaneCount}/32 active
                  </span>
                </div>

                {/* Thread ID Row */}
                <div className="flex gap-[2px] mb-1">
                  {Array.from({ length: 32 }, (_, i) => (
                    <div
                      key={i}
                      className="flex-1 text-center"
                    >
                      <span className="text-[7px] font-mono text-[#4a4a5a]">
                        {i}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Lane Squares */}
                <div className="flex gap-[2px]">
                  {currentWarp &&
                    currentWarp.lanes.map((lane, i) => {
                      const isActive = currentWarp.activeMask[i];
                      let bgColor = "#1e1e2e"; // idle
                      if (currentWarp.state === "completed") {
                        bgColor = "#1a1a2e";
                      } else if (lane === "active" && isActive) {
                        bgColor = "#10b981";
                      } else if (lane === "masked" || !isActive) {
                        bgColor = "#2a2a3e";
                      }

                      return (
                        <motion.div
                          key={i}
                          className="flex-1 aspect-square rounded-[2px] flex items-center justify-center"
                          style={{ backgroundColor: bgColor }}
                          animate={{
                            opacity:
                              isActive && currentWarp.state === "active"
                                ? [0.7, 1, 0.7]
                                : 1,
                          }}
                          transition={{
                            duration: 0.6,
                            repeat:
                              isActive && currentWarp.state === "active"
                                ? Infinity
                                : 0,
                          }}
                        >
                          {currentWarp.state !== "completed" && (
                            <span className="text-[6px] font-mono text-white/50">
                              {isActive ? "1" : "0"}
                            </span>
                          )}
                        </motion.div>
                      );
                    })}
                </div>

                {/* Active Mask Display */}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[9px] text-[#71717a] font-mono">
                    Active Mask:
                  </span>
                  <span className="text-[9px] font-mono text-[#a1a1aa] break-all">
                    {currentWarp
                      ? currentWarp.activeMask
                          .map((b) => (b ? "1" : "0"))
                          .join("")
                      : "".padStart(32, "0")}
                  </span>
                </div>

                {/* Legend */}
                <div className="flex items-center gap-3 mt-2">
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded-sm bg-[#10b981]" />
                    <span className="text-[9px] text-[#71717a]">Active</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded-sm bg-[#2a2a3e]" />
                    <span className="text-[9px] text-[#71717a]">Masked</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded-sm bg-[#1e1e2e]" />
                    <span className="text-[9px] text-[#71717a]">Idle</span>
                  </div>
                </div>
              </div>

              {/* Instruction List */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Cpu size={14} className="text-[#6366f1]" />
                  <span className="text-sm font-semibold text-white">
                    Instruction Stream (Warp {selectedWarp})
                  </span>
                </div>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {currentWarp &&
                    currentWarp.instructions.map((instr, idx) => {
                      const isCurrent =
                        idx === currentWarp.currentInstrIdx &&
                        currentWarp.state !== "completed";
                      const isExecuted = idx < currentWarp.currentInstrIdx;
                      const isNext =
                        idx === currentWarp.currentInstrIdx + 1 &&
                        currentWarp.state !== "completed";

                      let borderColor = "#1e1e2e";
                      let bgColor = "transparent";
                      let textColor = "#71717a";

                      if (isCurrent) {
                        borderColor = "#10b981";
                        bgColor = "rgba(16,185,129,0.08)";
                        textColor = "#10b981";
                      } else if (isExecuted) {
                        textColor = "#4a4a5a";
                      } else if (isNext) {
                        borderColor = "#2a2a3e";
                        textColor = "#a1a1aa";
                      }

                      // Branch path coloring
                      if (instr.branchPath === "if") {
                        bgColor = isCurrent
                          ? "rgba(99,102,241,0.1)"
                          : isExecuted
                            ? "rgba(99,102,241,0.03)"
                            : "transparent";
                        if (isCurrent) borderColor = "#6366f1";
                      } else if (instr.branchPath === "else") {
                        bgColor = isCurrent
                          ? "rgba(245,158,11,0.1)"
                          : isExecuted
                            ? "rgba(245,158,11,0.03)"
                            : "transparent";
                        if (isCurrent) borderColor = "#f59e0b";
                      }

                      return (
                        <motion.div
                          key={idx}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-mono transition-all"
                          style={{
                            borderColor,
                            backgroundColor: bgColor,
                            color: textColor,
                          }}
                          animate={{
                            x: isCurrent ? 4 : 0,
                          }}
                        >
                          <span className="w-5 text-[9px] text-[#4a4a5a]">
                            {idx}
                          </span>
                          {isCurrent && (
                            <motion.div
                              className="w-1.5 h-1.5 rounded-full bg-[#10b981]"
                              animate={{ opacity: [1, 0.3, 1] }}
                              transition={{
                                duration: 0.8,
                                repeat: Infinity,
                              }}
                            />
                          )}
                          {isExecuted && (
                            <div className="w-1.5 h-1.5 rounded-full bg-[#4a4a5a]" />
                          )}
                          <span
                            className={
                              isExecuted ? "line-through opacity-50" : ""
                            }
                          >
                            {instr.label}
                          </span>
                          {instr.stallCycles > 0 && (
                            <span className="text-[9px] text-[#ef4444] ml-auto">
                              +{instr.stallCycles} stall
                            </span>
                          )}
                          {instr.branchPath && (
                            <span
                              className="text-[9px] ml-auto"
                              style={{
                                color:
                                  instr.branchPath === "if"
                                    ? "#6366f1"
                                    : "#f59e0b",
                              }}
                            >
                              {instr.branchPath}
                            </span>
                          )}
                          {/* Active lane count for this instruction */}
                          <span className="text-[8px] text-[#4a4a5a] ml-auto">
                            {countActive(instr.activeMask)}/32
                          </span>
                        </motion.div>
                      );
                    })}
                </div>
              </div>

              {/* Instruction Timeline */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Clock size={14} className="text-[#06b6d4]" />
                  <span className="text-sm font-semibold text-white">
                    Execution Timeline
                  </span>
                  <span className="text-[10px] text-[#71717a] ml-auto font-mono">
                    Cycle: {simState.cycle}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <div className="flex gap-[2px] min-w-[600px]">
                    {timelineDisplay.map((entry, i) => {
                      const color =
                        entry.warpId >= 0
                          ? WARP_COLORS[entry.warpId % WARP_COLORS.length]
                          : "#ef4444";
                      const isStall = entry.warpId < 0;
                      const utilPercent = (entry.activeLanes / 32) * 100;

                      return (
                        <motion.div
                          key={`${entry.cycle}-${i}`}
                          className="flex-1 min-w-[24px] rounded-sm relative group"
                          style={{
                            backgroundColor: isStall
                              ? "rgba(239,68,68,0.15)"
                              : `${color}20`,
                            borderBottom: `2px solid ${isStall ? "#ef4444" : color}`,
                          }}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          title={`Cycle ${entry.cycle}: ${entry.instrLabel} (${entry.activeLanes}/32 lanes)`}
                        >
                          <div className="py-2 px-1 text-center">
                            <div
                              className="text-[7px] font-mono mb-0.5"
                              style={{ color }}
                            >
                              {isStall ? "X" : `W${entry.warpId}`}
                            </div>
                            <div className="text-[6px] font-mono text-[#4a4a5a]">
                              C{entry.cycle}
                            </div>
                          </div>
                          {/* Utilization bar */}
                          {!isStall && (
                            <div className="absolute bottom-0 left-0 right-0 h-[2px]">
                              <div
                                className="h-full rounded-sm"
                                style={{
                                  width: `${utilPercent}%`,
                                  backgroundColor: color,
                                }}
                              />
                            </div>
                          )}
                          {/* Hover tooltip */}
                          <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-10 bg-[#1e1e2e] border border-[#2a2a3e] rounded px-2 py-1 text-[8px] font-mono text-[#a1a1aa] whitespace-nowrap">
                            {entry.instrLabel}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
                {/* Timeline legend */}
                <div className="flex items-center gap-3 mt-2">
                  {simState.warps.map((w, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <div
                        className="w-2 h-2 rounded-sm"
                        style={{ backgroundColor: WARP_COLORS[i] }}
                      />
                      <span className="text-[9px] text-[#71717a]">
                        Warp {i}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-sm bg-[#ef4444]" />
                    <span className="text-[9px] text-[#71717a]">Stall</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Sidebar */}
            <div className="space-y-4">
              {/* Warp Scheduler */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Activity size={14} className="text-[#f59e0b]" />
                  <span className="text-sm font-semibold text-white">
                    Warp Scheduler
                  </span>
                </div>
                <div className="space-y-2">
                  {simState.warps.map((warp, i) => {
                    const color = WARP_COLORS[i % WARP_COLORS.length];
                    let stateColor = "#71717a";
                    let stateLabel: string = warp.state;
                    let stateBg = "transparent";

                    switch (warp.state) {
                      case "active":
                        stateColor = "#10b981";
                        stateBg = "rgba(16,185,129,0.1)";
                        break;
                      case "eligible":
                        stateColor = "#6366f1";
                        stateBg = "rgba(99,102,241,0.1)";
                        break;
                      case "stalled":
                        stateColor = "#ef4444";
                        stateBg = "rgba(239,68,68,0.1)";
                        stateLabel = `stalled (${warp.stallCyclesRemaining})`;
                        break;
                      case "completed":
                        stateColor = "#4a4a5a";
                        break;
                    }

                    const progress =
                      warp.instructions.length > 0
                        ? (warp.currentInstrIdx / warp.instructions.length) *
                          100
                        : 0;

                    return (
                      <motion.div
                        key={i}
                        className="p-2 rounded-lg border"
                        style={{
                          borderColor:
                            simState.currentWarpIdx === i && warp.state === "active"
                              ? color
                              : "#1e1e2e",
                          backgroundColor: stateBg,
                        }}
                        animate={{
                          boxShadow:
                            simState.currentWarpIdx === i && warp.state === "active"
                              ? `0 0 8px ${color}40`
                              : "none",
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-2.5 h-2.5 rounded-full"
                              style={{
                                backgroundColor: color,
                                boxShadow:
                                  warp.state === "active"
                                    ? `0 0 6px ${color}80`
                                    : "none",
                              }}
                            />
                            <span className="text-xs font-mono text-white">
                              Warp {i}
                            </span>
                          </div>
                          <span
                            className="text-[9px] font-mono"
                            style={{ color: stateColor }}
                          >
                            {stateLabel}
                          </span>
                        </div>
                        {/* Progress bar */}
                        <div className="h-1.5 bg-[#0a0a0f] rounded-full overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: color }}
                            animate={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-[8px] text-[#4a4a5a] font-mono">
                            {warp.currentInstrIdx}/{warp.instructions.length}{" "}
                            instrs
                          </span>
                          <span className="text-[8px] text-[#4a4a5a] font-mono">
                            {warp.switchCount} switches
                          </span>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* Occupancy */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Layers size={14} className="text-[#06b6d4]" />
                  <span className="text-sm font-semibold text-white">
                    SM Occupancy
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#71717a] font-mono">
                      Warps Loaded
                    </span>
                    <span className="text-[#06b6d4] font-mono font-bold">
                      {simState.warps.length}/{maxWarps}
                    </span>
                  </div>
                  <div className="h-3 bg-[#0a0a0f] rounded-full overflow-hidden flex gap-[1px]">
                    {Array.from({ length: maxWarps }, (_, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-sm"
                        style={{
                          backgroundColor:
                            i < simState.warps.length
                              ? WARP_COLORS[i % WARP_COLORS.length]
                              : "#1e1e2e",
                          opacity:
                            i < simState.warps.length
                              ? simState.warps[i].state === "completed"
                                ? 0.3
                                : 1
                              : 1,
                        }}
                      />
                    ))}
                  </div>
                  <div className="text-[10px] text-[#71717a]">
                    Occupancy: {occupancy.toFixed(0)}%
                    {occupancy < 75 && (
                      <span className="text-[#f59e0b] ml-1">
                        (low - stalls cannot be hidden)
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Divergence Info */}
              {(scenario === "if-else") && (
                <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <GitBranch size={14} className="text-[#f59e0b]" />
                    <span className="text-sm font-semibold text-white">
                      Divergence
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="p-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]">
                      <div className="text-[9px] text-[#71717a] font-mono mb-1">
                        IF PATH
                      </div>
                      <div className="flex gap-[1px]">
                        {evenLanes().map((active, i) => (
                          <div
                            key={i}
                            className="flex-1 h-2 rounded-[1px]"
                            style={{
                              backgroundColor: active
                                ? "#6366f1"
                                : "#1e1e2e",
                            }}
                          />
                        ))}
                      </div>
                      <div className="text-[8px] text-[#6366f1] font-mono mt-0.5">
                        {countActive(evenLanes())} lanes active
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]">
                      <div className="text-[9px] text-[#71717a] font-mono mb-1">
                        ELSE PATH
                      </div>
                      <div className="flex gap-[1px]">
                        {oddLanes().map((active, i) => (
                          <div
                            key={i}
                            className="flex-1 h-2 rounded-[1px]"
                            style={{
                              backgroundColor: active
                                ? "#f59e0b"
                                : "#1e1e2e",
                            }}
                          />
                        ))}
                      </div>
                      <div className="text-[8px] text-[#f59e0b] font-mono mt-0.5">
                        {countActive(oddLanes())} lanes active
                      </div>
                    </div>
                    <div className="text-[10px] text-[#71717a] mt-1">
                      Both paths execute serially. Utilization drops to 50%
                      during diverged sections.
                    </div>
                  </div>
                </div>
              )}

              {/* Memory Stall Warning */}
              {scenario === "memory-stall" && (
                <div className="bg-[#111118] border border-[#ef4444]/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle size={14} className="text-[#ef4444]" />
                    <span className="text-sm font-semibold text-[#ef4444]">
                      Low Occupancy
                    </span>
                  </div>
                  <p className="text-xs text-[#71717a]">
                    With only 1 warp, memory stalls cause the SM to sit idle.
                    With more warps, the scheduler would switch to another warp
                    during stalls, keeping the SM busy.
                  </p>
                </div>
              )}
            </div>
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

          {/* Metrics */}
          <AnimatePresence>
            {showMetrics && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
                  <MetricCard
                    label="Active Lanes"
                    value={`${activeLaneCount}/32`}
                    color="#10b981"
                  />
                  <MetricCard
                    label="Lane Util"
                    value={`${laneUtilization.toFixed(0)}%`}
                    color="#06b6d4"
                  />
                  <MetricCard
                    label="Avg Util"
                    value={`${overallUtilization.toFixed(1)}%`}
                    color="#6366f1"
                  />
                  <MetricCard
                    label="Divergences"
                    value={simState.divergentBranches.toString()}
                    color="#f59e0b"
                  />
                  <MetricCard
                    label="Warp Switches"
                    value={simState.totalWarpSwitches.toString()}
                    color="#a855f7"
                  />
                  <MetricCard
                    label="Instrs Exec"
                    value={simState.totalInstructionsExecuted.toString()}
                    color="#10b981"
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-[#a1a1aa]">
              <div>
                <div className="text-[#10b981] font-semibold mb-1">
                  SIMT Execution
                </div>
                <ul className="space-y-1 list-disc list-inside text-[#71717a]">
                  <li>32 threads in a warp execute in lockstep</li>
                  <li>All active lanes run the same instruction</li>
                  <li>Maximum efficiency when all 32 lanes are active</li>
                </ul>
              </div>
              <div>
                <div className="text-[#f59e0b] font-semibold mb-1">
                  Branch Divergence
                </div>
                <ul className="space-y-1 list-disc list-inside text-[#71717a]">
                  <li>If/else causes some lanes to be masked off</li>
                  <li>Both paths executed serially, not in parallel</li>
                  <li>Reconverge after the branch completes</li>
                </ul>
              </div>
              <div>
                <div className="text-[#6366f1] font-semibold mb-1">
                  Warp Scheduling
                </div>
                <ul className="space-y-1 list-disc list-inside text-[#71717a]">
                  <li>SM schedules warps to hide memory latency</li>
                  <li>Stalled warps yield to eligible ones</li>
                  <li>Higher occupancy = better latency hiding</li>
                </ul>
              </div>
            </div>

            {/* Scenario explanation */}
            <div className="mt-4 p-3 bg-[#0a0a0f] rounded-lg border border-[#1e1e2e]">
              <div className="text-[#a855f7] text-xs font-semibold mb-1">
                {config.label}
              </div>
              <p className="text-xs text-[#71717a]">{config.description}</p>
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
