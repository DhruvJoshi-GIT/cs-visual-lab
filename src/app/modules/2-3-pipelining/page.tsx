"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  ArrowDown,
  ChevronDown,
  Plus,
  Zap,
  GitBranch,
  Cpu,
  X,
  Info,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ──────────────────────────── Types ────────────────────────────

type OpCode = "ADD" | "SUB" | "AND" | "OR" | "LW" | "SW" | "BEQ";

interface Instruction {
  id: number;
  op: OpCode;
  text: string;
  rd: string;  // destination register
  rs: string;  // source register 1
  rt: string;  // source register 2
  color: string;
}

type StageSlot = {
  instruction: Instruction | null;
  isStall: boolean;
  isFlushed: boolean;
};

interface ForwardingPath {
  fromStage: number; // index into stages (0=IF..4=WB)
  toStage: number;
  register: string;
  fromInstr: Instruction;
  toInstr: Instruction;
}

interface HazardInfo {
  type: "RAW" | "LOAD_USE" | "CONTROL";
  stageIndex: number;
  register: string;
  instruction: Instruction;
}

interface PipelineHistoryRow {
  cycle: number;
  slots: (
    | { instrId: number; instrText: string; color: string; isStall: boolean; isFlushed: boolean }
    | null
  )[];
}

// ──────────────────────────── Constants ────────────────────────────

const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;

const STAGE_DESCRIPTIONS = [
  "Instruction Fetch",
  "Instruction Decode",
  "Execute",
  "Memory Access",
  "Write Back",
];

const STAGE_COLORS = [
  "#6366f1", // IF - indigo
  "#06b6d4", // ID - cyan
  "#f59e0b", // EX - amber
  "#10b981", // MEM - emerald
  "#ec4899", // WB - pink
];

const INSTRUCTION_COLORS = [
  "#6366f1",
  "#06b6d4",
  "#f59e0b",
  "#10b981",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
  "#ef4444",
  "#3b82f6",
  "#a855f7",
  "#22d3ee",
];

const REGISTERS = [
  "R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7",
  "R8", "R9", "R10", "R11", "R12",
];

interface PresetInstr {
  op: OpCode;
  text: string;
  rd: string;
  rs: string;
  rt: string;
}

const PRESET_SCENARIOS: Record<string, { label: string; desc: string; instructions: PresetInstr[] }> = {
  no_hazards: {
    label: "No Hazards",
    desc: "Independent instructions with no conflicts",
    instructions: [
      { op: "ADD", text: "ADD R1, R2, R3", rd: "R1", rs: "R2", rt: "R3" },
      { op: "SUB", text: "SUB R4, R5, R6", rd: "R4", rs: "R5", rt: "R6" },
      { op: "AND", text: "AND R7, R8, R9", rd: "R7", rs: "R8", rt: "R9" },
      { op: "OR", text: "OR R10, R11, R12", rd: "R10", rs: "R11", rt: "R12" },
    ],
  },
  data_hazard: {
    label: "Data Hazard (RAW)",
    desc: "R1 written by ADD, read by SUB - forwarding can resolve",
    instructions: [
      { op: "ADD", text: "ADD R1, R2, R3", rd: "R1", rs: "R2", rt: "R3" },
      { op: "SUB", text: "SUB R4, R1, R5", rd: "R4", rs: "R1", rt: "R5" },
      { op: "AND", text: "AND R6, R1, R7", rd: "R6", rs: "R1", rt: "R7" },
      { op: "OR", text: "OR R8, R9, R10", rd: "R8", rs: "R9", rt: "R10" },
    ],
  },
  load_use: {
    label: "Load-Use Hazard",
    desc: "LW loads R1, next instruction reads R1 - needs stall even with forwarding",
    instructions: [
      { op: "LW", text: "LW R1, 0(R2)", rd: "R1", rs: "R2", rt: "" },
      { op: "SUB", text: "SUB R4, R1, R5", rd: "R4", rs: "R1", rt: "R5" },
      { op: "AND", text: "AND R6, R4, R7", rd: "R6", rs: "R4", rt: "R7" },
      { op: "OR", text: "OR R8, R9, R10", rd: "R8", rs: "R9", rt: "R10" },
    ],
  },
  control_hazard: {
    label: "Control Hazard",
    desc: "Branch flushes pipeline after evaluation in EX stage",
    instructions: [
      { op: "ADD", text: "ADD R1, R2, R3", rd: "R1", rs: "R2", rt: "R3" },
      { op: "BEQ", text: "BEQ R1, R0, L1", rd: "", rs: "R1", rt: "R0" },
      { op: "SUB", text: "SUB R4, R5, R6", rd: "R4", rs: "R5", rt: "R6" },
      { op: "AND", text: "AND R7, R8, R9", rd: "R7", rs: "R8", rt: "R9" },
      { op: "OR", text: "OR R10, R11, R12", rd: "R10", rs: "R11", rt: "R12" },
    ],
  },
};

const INSTRUCTION_TEMPLATES: PresetInstr[] = [
  { op: "ADD", text: "ADD", rd: "", rs: "", rt: "" },
  { op: "SUB", text: "SUB", rd: "", rs: "", rt: "" },
  { op: "AND", text: "AND", rd: "", rs: "", rt: "" },
  { op: "OR", text: "OR", rd: "", rs: "", rt: "" },
  { op: "LW", text: "LW", rd: "", rs: "", rt: "" },
  { op: "SW", text: "SW", rd: "", rs: "", rt: "" },
  { op: "BEQ", text: "BEQ", rd: "", rs: "", rt: "" },
];

// ──────────────────────────── Helpers ────────────────────────────

function makeInstruction(
  preset: PresetInstr,
  id: number,
  colorIdx: number
): Instruction {
  return {
    id,
    op: preset.op,
    text: preset.text,
    rd: preset.rd,
    rs: preset.rs,
    rt: preset.rt,
    color: INSTRUCTION_COLORS[colorIdx % INSTRUCTION_COLORS.length],
  };
}

function initPipelineSlots(): StageSlot[] {
  return Array.from({ length: 5 }, () => ({
    instruction: null,
    isStall: false,
    isFlushed: false,
  }));
}

// ──────────────────────────── Pipeline Engine ────────────────────────────

interface StepResult {
  newPipeline: StageSlot[];
  completedInstr: Instruction | null;
  hazards: HazardInfo[];
  forwarding: ForwardingPath[];
  stallInserted: boolean;
  flushed: boolean;
  branchTaken: boolean;
}

function simulateStep(
  pipeline: StageSlot[],
  nextInstr: Instruction | null,
  forwardingEnabled: boolean
): StepResult {
  const hazards: HazardInfo[] = [];
  const forwarding: ForwardingPath[] = [];
  let stallInserted = false;
  let flushed = false;
  let branchTaken = false;

  // The instruction currently in ID is checking for hazards
  const idSlot = pipeline[1];
  const exSlot = pipeline[2];
  const memSlot = pipeline[3];
  const wbSlot = pipeline[4]; // about to retire

  // ── Check for control hazard: BEQ in EX is resolved ──
  if (exSlot.instruction && exSlot.instruction.op === "BEQ" && !exSlot.isStall && !exSlot.isFlushed) {
    // Branch evaluated in EX — we simulate always-taken for demonstration
    branchTaken = true;
    flushed = true;
  }

  // ── Check for data hazards on instruction in ID ──
  let needStall = false;

  if (idSlot.instruction && !idSlot.isStall && !idSlot.isFlushed) {
    const idInstr = idSlot.instruction;
    const srcRegs = [idInstr.rs, idInstr.rt].filter((r) => r && r !== "");

    // Check EX stage for RAW hazard
    if (exSlot.instruction && !exSlot.isStall && !exSlot.isFlushed && exSlot.instruction.rd) {
      const exDest = exSlot.instruction.rd;
      for (const src of srcRegs) {
        if (src === exDest) {
          // EX hazard
          if (exSlot.instruction.op === "LW") {
            // Load-use hazard: data not available until end of MEM
            // Even with forwarding we need 1 stall
            hazards.push({
              type: "LOAD_USE",
              stageIndex: 2,
              register: src,
              instruction: exSlot.instruction,
            });
            needStall = true;
          } else {
            // ALU-ALU RAW: EX result forwarded to EX input
            hazards.push({
              type: "RAW",
              stageIndex: 2,
              register: src,
              instruction: exSlot.instruction,
            });
            if (forwardingEnabled) {
              forwarding.push({
                fromStage: 2,
                toStage: 1,
                register: src,
                fromInstr: exSlot.instruction,
                toInstr: idInstr,
              });
            } else {
              needStall = true;
            }
          }
        }
      }
    }

    // Check MEM stage for RAW hazard (if not already stalling)
    if (!needStall && memSlot.instruction && !memSlot.isStall && !memSlot.isFlushed && memSlot.instruction.rd) {
      const memDest = memSlot.instruction.rd;
      for (const src of srcRegs) {
        if (src === memDest) {
          hazards.push({
            type: memSlot.instruction.op === "LW" ? "LOAD_USE" : "RAW",
            stageIndex: 3,
            register: src,
            instruction: memSlot.instruction,
          });
          if (forwardingEnabled) {
            forwarding.push({
              fromStage: 3,
              toStage: 1,
              register: src,
              fromInstr: memSlot.instruction,
              toInstr: idInstr,
            });
          } else {
            needStall = true;
          }
        }
      }
    }

    // Check if we still need a second stall (without forwarding, EX hazard needs 2 stalls)
    // Simplified: without forwarding, any RAW from EX needs 2 stalls, from MEM needs 1 stall.
    // We handle this by re-checking on next cycle since the stall keeps the ID instruction.
  }

  // ── Build new pipeline state ──
  const newPipeline: StageSlot[] = initPipelineSlots();
  let completedInstr: Instruction | null = null;

  // WB stage completes
  if (wbSlot.instruction && !wbSlot.isStall && !wbSlot.isFlushed) {
    completedInstr = wbSlot.instruction;
  }

  if (needStall) {
    stallInserted = true;

    // WB <- MEM
    newPipeline[4] = { ...memSlot };
    // MEM <- EX
    newPipeline[3] = { ...exSlot };
    // EX <- bubble (stall)
    newPipeline[2] = { instruction: null, isStall: true, isFlushed: false };
    // ID stays (stalled)
    newPipeline[1] = { ...idSlot };
    // IF stays (stalled) — hold the same next instruction
    newPipeline[0] = { ...pipeline[0] };
  } else if (flushed) {
    // WB <- MEM
    newPipeline[4] = { ...memSlot };
    // MEM <- EX (branch in EX completes normally)
    newPipeline[3] = { ...exSlot };
    // Flush IF and ID
    newPipeline[2] = { instruction: null, isStall: false, isFlushed: false };
    newPipeline[1] = {
      instruction: pipeline[1].instruction,
      isStall: false,
      isFlushed: pipeline[1].instruction ? true : false,
    };
    newPipeline[0] = {
      instruction: pipeline[0].instruction,
      isStall: false,
      isFlushed: pipeline[0].instruction ? true : false,
    };
  } else {
    // Normal advancement
    // WB <- MEM
    newPipeline[4] = { ...memSlot };
    // MEM <- EX
    newPipeline[3] = { ...exSlot };
    // EX <- ID
    newPipeline[2] = { ...idSlot };
    // ID <- IF
    newPipeline[1] = { ...pipeline[0] };
    // IF <- next instruction
    newPipeline[0] = nextInstr
      ? { instruction: nextInstr, isStall: false, isFlushed: false }
      : { instruction: null, isStall: false, isFlushed: false };
  }

  return {
    newPipeline,
    completedInstr,
    hazards,
    forwarding,
    stallInserted,
    flushed,
    branchTaken,
  };
}

// ──────────────────────────── Main Component ────────────────────────────

export default function PipeliningModule() {
  // ── State ──
  const [instructionQueue, setInstructionQueue] = useState<Instruction[]>([]);
  const [pipeline, setPipeline] = useState<StageSlot[]>(initPipelineSlots);
  const [cycle, setCycle] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [stallCount, setStallCount] = useState(0);
  const [forwardCount, setForwardCount] = useState(0);
  const [history, setHistory] = useState<PipelineHistoryRow[]>([]);
  const [hazards, setHazards] = useState<HazardInfo[]>([]);
  const [forwardingPaths, setForwardingPaths] = useState<ForwardingPath[]>([]);

  const [forwardingEnabled, setForwardingEnabled] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [showInstrPicker, setShowInstrPicker] = useState(false);

  // Instruction picker state
  const [pickerOp, setPickerOp] = useState<OpCode>("ADD");
  const [pickerRd, setPickerRd] = useState("R1");
  const [pickerRs, setPickerRs] = useState("R2");
  const [pickerRt, setPickerRt] = useState("R3");

  const nextIdRef = useRef(1);
  const queueIndexRef = useRef(0); // tracks which instruction to fetch next
  const isStallHoldRef = useRef(false); // when stalling, don't advance queue

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);

  // ── Derived ──
  const cpi = completedCount > 0 ? (cycle / completedCount).toFixed(2) : "--";
  const pipelineIsEmpty =
    pipeline.every((s) => !s.instruction) && queueIndexRef.current >= instructionQueue.length;
  const simulationDone = pipelineIsEmpty && cycle > 0;

  // ── Auto-scroll history ──
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [history]);

  // ── Auto-play ──
  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    const delay = Math.max(150, 1200 / speed);
    timerRef.current = setTimeout(() => {
      stepOnce();
    }, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, speed, cycle]);

  // ── Step logic ──
  const stepOnce = useCallback(() => {
    setPipeline((prevPipeline) => {
      // Determine next instruction to fetch
      let nextInstr: Instruction | null = null;
      if (!isStallHoldRef.current && queueIndexRef.current < instructionQueue.length) {
        nextInstr = instructionQueue[queueIndexRef.current];
      }

      const result = simulateStep(prevPipeline, nextInstr, forwardingEnabled);

      // Update queue index
      if (result.stallInserted) {
        // Stall: don't advance fetch pointer
        isStallHoldRef.current = true;
      } else if (result.flushed) {
        // Flush: the instructions in IF/ID that were flushed don't count.
        // We need to skip ahead (branch target). For simplicity, we advance
        // the queue index past any flushed instructions and continue.
        // The flushed instructions in IF/ID won't complete.
        // In our model, instructions that were in IF and ID are flushed.
        // The queue pointer was already advanced when those were fetched.
        // On next cycle, we fetch the next instruction after the flushed ones.
        isStallHoldRef.current = false;
      } else {
        if (isStallHoldRef.current) {
          isStallHoldRef.current = false;
        }
        // Advance if we actually fetched
        if (nextInstr) {
          queueIndexRef.current += 1;
        }
      }

      // Update other state
      setCycle((c) => c + 1);

      if (result.completedInstr) {
        setCompletedCount((c) => c + 1);
      }
      if (result.stallInserted) {
        setStallCount((c) => c + 1);
      }
      setForwardCount((c) => c + result.forwarding.length);

      setHazards(result.hazards);
      setForwardingPaths(result.forwarding);

      // Add to history
      setHistory((prev) => [
        ...prev,
        {
          cycle: prev.length + 1,
          slots: result.newPipeline.map((slot) =>
            slot.instruction
              ? {
                  instrId: slot.instruction.id,
                  instrText: slot.instruction.text,
                  color: slot.instruction.color,
                  isStall: slot.isStall,
                  isFlushed: slot.isFlushed,
                }
              : slot.isStall
              ? { instrId: -1, instrText: "STALL", color: "#71717a", isStall: true, isFlushed: false }
              : null
          ),
        },
      ]);

      // Check if simulation is done
      const newPipeEmpty =
        result.newPipeline.every((s) => !s.instruction || s.isFlushed) &&
        queueIndexRef.current >= instructionQueue.length;
      if (newPipeEmpty && !result.newPipeline.some((s) => s.instruction && !s.isFlushed)) {
        setIsPlaying(false);
      }

      return result.newPipeline;
    });
  }, [instructionQueue, forwardingEnabled]);

  // ── Reset ──
  const handleReset = useCallback(() => {
    setIsPlaying(false);
    setPipeline(initPipelineSlots());
    setCycle(0);
    setCompletedCount(0);
    setStallCount(0);
    setForwardCount(0);
    setHistory([]);
    setHazards([]);
    setForwardingPaths([]);
    queueIndexRef.current = 0;
    isStallHoldRef.current = false;
  }, []);

  // ── Load scenario ──
  const loadScenario = useCallback(
    (key: string) => {
      handleReset();
      const scenario = PRESET_SCENARIOS[key];
      if (!scenario) return;
      const instructions: Instruction[] = scenario.instructions.map((p, i) =>
        makeInstruction(p, nextIdRef.current + i, i)
      );
      nextIdRef.current += instructions.length;
      setInstructionQueue(instructions);
    },
    [handleReset]
  );

  // ── Add single instruction ──
  const addInstruction = useCallback(() => {
    const id = nextIdRef.current++;
    const colorIdx = instructionQueue.length;

    let text = "";
    let rd = pickerRd;
    let rs = pickerRs;
    let rt = pickerRt;

    if (pickerOp === "LW") {
      text = `LW ${rd}, 0(${rs})`;
      rt = "";
    } else if (pickerOp === "SW") {
      text = `SW ${rs}, 0(${rt})`;
      rd = "";
    } else if (pickerOp === "BEQ") {
      text = `BEQ ${rs}, ${rt}, L1`;
      rd = "";
    } else {
      text = `${pickerOp} ${rd}, ${rs}, ${rt}`;
    }

    const instr: Instruction = {
      id,
      op: pickerOp,
      text,
      rd,
      rs,
      rt,
      color: INSTRUCTION_COLORS[colorIdx % INSTRUCTION_COLORS.length],
    };

    setInstructionQueue((q) => [...q, instr]);
    setShowInstrPicker(false);
  }, [instructionQueue.length, pickerOp, pickerRd, pickerRs, pickerRt]);

  // ── Remove instruction (only before simulation starts) ──
  const removeInstruction = useCallback(
    (id: number) => {
      if (cycle > 0) return;
      setInstructionQueue((q) => q.filter((i) => i.id !== id));
    },
    [cycle]
  );

  // Load default scenario on first mount
  useEffect(() => {
    loadScenario("data_hazard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ──────────────────────────── Render ────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />

      <main className="pt-14">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* ── Header ── */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-0.5 rounded-md bg-[#6366f1]/15 border border-[#6366f1]/25 text-[#6366f1] text-xs font-mono font-semibold">
                2.3
              </span>
              <h1 className="text-2xl font-bold tracking-tight">
                CPU Pipelining{" "}
                <span className="text-[#71717a] font-normal">(5-Stage)</span>
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Watch instructions flow through{" "}
              <span className="text-[#6366f1] font-mono">IF</span>{" "}
              <ArrowRight size={12} className="inline text-[#71717a]" />{" "}
              <span className="text-[#06b6d4] font-mono">ID</span>{" "}
              <ArrowRight size={12} className="inline text-[#71717a]" />{" "}
              <span className="text-[#f59e0b] font-mono">EX</span>{" "}
              <ArrowRight size={12} className="inline text-[#71717a]" />{" "}
              <span className="text-[#10b981] font-mono">MEM</span>{" "}
              <ArrowRight size={12} className="inline text-[#71717a]" />{" "}
              <span className="text-[#ec4899] font-mono">WB</span>{" "}
              stages with hazard detection
            </p>
          </div>

          {/* ── Controls Bar ── */}
          <div className="mb-6">
            <ModuleControls
              isPlaying={isPlaying}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onStep={stepOnce}
              onReset={handleReset}
              speed={speed}
              onSpeedChange={setSpeed}
              showMetrics={showMetrics}
              onToggleMetrics={() => setShowMetrics((s) => !s)}
            >
              {/* Forwarding toggle */}
              <button
                onClick={() => {
                  if (cycle === 0) setForwardingEnabled((f) => !f);
                }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                  forwardingEnabled
                    ? "bg-[#06b6d4]/15 text-[#06b6d4] border border-[#06b6d4]/30"
                    : "bg-[#1e1e2e] text-[#71717a] border border-[#1e1e2e] hover:border-[#2a2a3e]"
                } ${cycle > 0 ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                title={cycle > 0 ? "Reset to change forwarding mode" : "Toggle forwarding"}
              >
                <Zap size={14} />
                Forwarding {forwardingEnabled ? "ON" : "OFF"}
              </button>
            </ModuleControls>
          </div>

          {/* ── Scenarios + Add Instruction ── */}
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className="text-xs text-[#71717a] mr-1 font-medium uppercase tracking-wider">
              Presets:
            </span>
            {Object.entries(PRESET_SCENARIOS).map(([key, scenario]) => (
              <button
                key={key}
                onClick={() => loadScenario(key)}
                className="px-3 py-1.5 rounded-lg bg-[#111118] border border-[#1e1e2e] hover:border-[#2a2a3e] text-xs text-[#a1a1aa] hover:text-white transition-all duration-200 hover:bg-[#16161f]"
                title={scenario.desc}
              >
                {scenario.label}
              </button>
            ))}

            <div className="w-px h-6 bg-[#1e1e2e] mx-1" />

            <button
              onClick={() => setShowInstrPicker(!showInstrPicker)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6366f1]/10 border border-[#6366f1]/25 text-[#6366f1] text-xs font-medium hover:bg-[#6366f1]/20 transition-all duration-200"
            >
              <Plus size={14} />
              Add Instruction
            </button>
          </div>

          {/* ── Instruction Picker Dropdown ── */}
          <AnimatePresence>
            {showInstrPicker && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="mb-6 p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]"
              >
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-[#71717a] mb-1.5">
                      Operation
                    </label>
                    <div className="relative">
                      <select
                        value={pickerOp}
                        onChange={(e) => setPickerOp(e.target.value as OpCode)}
                        className="appearance-none px-3 py-2 pr-8 rounded-lg bg-[#0f0f17] border border-[#1e1e2e] text-sm text-white font-mono focus:outline-none focus:border-[#6366f1]"
                      >
                        {INSTRUCTION_TEMPLATES.map((t) => (
                          <option key={t.op} value={t.op}>
                            {t.op}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={14}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#71717a] pointer-events-none"
                      />
                    </div>
                  </div>

                  {pickerOp !== "SW" && pickerOp !== "BEQ" && (
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-[#71717a] mb-1.5">
                        Dest (rd)
                      </label>
                      <div className="relative">
                        <select
                          value={pickerRd}
                          onChange={(e) => setPickerRd(e.target.value)}
                          className="appearance-none px-3 py-2 pr-8 rounded-lg bg-[#0f0f17] border border-[#1e1e2e] text-sm text-white font-mono focus:outline-none focus:border-[#6366f1]"
                        >
                          {REGISTERS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={14}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[#71717a] pointer-events-none"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-[#71717a] mb-1.5">
                      {pickerOp === "SW" ? "Src (rs)" : pickerOp === "BEQ" ? "Rs" : "Src1 (rs)"}
                    </label>
                    <div className="relative">
                      <select
                        value={pickerRs}
                        onChange={(e) => setPickerRs(e.target.value)}
                        className="appearance-none px-3 py-2 pr-8 rounded-lg bg-[#0f0f17] border border-[#1e1e2e] text-sm text-white font-mono focus:outline-none focus:border-[#6366f1]"
                      >
                        {REGISTERS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={14}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#71717a] pointer-events-none"
                      />
                    </div>
                  </div>

                  {pickerOp !== "LW" && (
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-[#71717a] mb-1.5">
                        {pickerOp === "SW" ? "Base (rt)" : pickerOp === "BEQ" ? "Rt" : "Src2 (rt)"}
                      </label>
                      <div className="relative">
                        <select
                          value={pickerRt}
                          onChange={(e) => setPickerRt(e.target.value)}
                          className="appearance-none px-3 py-2 pr-8 rounded-lg bg-[#0f0f17] border border-[#1e1e2e] text-sm text-white font-mono focus:outline-none focus:border-[#6366f1]"
                        >
                          {REGISTERS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={14}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[#71717a] pointer-events-none"
                        />
                      </div>
                    </div>
                  )}

                  <button
                    onClick={addInstruction}
                    className="px-4 py-2 rounded-lg bg-[#6366f1] hover:bg-[#818cf8] text-white text-sm font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  >
                    Add
                  </button>

                  <button
                    onClick={() => setShowInstrPicker(false)}
                    className="px-3 py-2 rounded-lg bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#71717a] hover:text-white text-sm transition-all duration-200"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Main Grid Layout ── */}
          <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-6">
            {/* ── Left Sidebar: Instruction Queue ── */}
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Cpu size={14} className="text-[#6366f1]" />
                  Instruction Queue
                </h3>

                {instructionQueue.length === 0 ? (
                  <p className="text-xs text-[#71717a] italic py-4 text-center">
                    No instructions. Choose a preset or add instructions.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {instructionQueue.map((instr, i) => {
                      const fetched = queueIndexRef.current > i || cycle > 0;
                      const isCurrent =
                        queueIndexRef.current === i && cycle > 0;

                      return (
                        <motion.div
                          key={instr.id}
                          layout
                          initial={{ opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -12 }}
                          className={`group flex items-center gap-2 px-3 py-2 rounded-lg border transition-all duration-200 ${
                            isCurrent
                              ? "border-[#6366f1]/40 bg-[#6366f1]/10"
                              : fetched && cycle > 0
                              ? "border-[#1e1e2e]/50 bg-[#0f0f17]/50 opacity-50"
                              : "border-[#1e1e2e] bg-[#0f0f17] hover:border-[#2a2a3e]"
                          }`}
                        >
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: instr.color }}
                          />
                          <span className="text-xs font-mono text-[#e4e4e7] flex-1 truncate">
                            {instr.text}
                          </span>
                          {isCurrent && (
                            <ArrowRight size={12} className="text-[#6366f1] animate-pulse shrink-0" />
                          )}
                          {cycle === 0 && (
                            <button
                              onClick={() => removeInstruction(instr.id)}
                              className="opacity-0 group-hover:opacity-100 shrink-0 text-[#71717a] hover:text-[#ef4444] transition-all"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Hazards Panel ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <AlertTriangle size={14} className="text-[#f59e0b]" />
                  Hazards Detected
                </h3>

                <AnimatePresence mode="popLayout">
                  {hazards.length === 0 ? (
                    <motion.p
                      key="none"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-xs text-[#71717a] italic py-2 text-center"
                    >
                      {cycle === 0 ? "Start simulation to detect" : "No hazards this cycle"}
                    </motion.p>
                  ) : (
                    hazards.map((h, i) => (
                      <motion.div
                        key={`${h.type}-${h.register}-${i}`}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="flex items-start gap-2 p-2.5 mb-1.5 rounded-lg bg-[#f59e0b]/5 border border-[#f59e0b]/15"
                      >
                        <AlertTriangle size={12} className="text-[#f59e0b] mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[10px] font-mono font-bold text-[#f59e0b] uppercase">
                            {h.type === "LOAD_USE" ? "Load-Use" : h.type}
                          </span>
                          <p className="text-[11px] text-[#a1a1aa] mt-0.5">
                            Register{" "}
                            <span className="font-mono text-[#f59e0b]">{h.register}</span> from{" "}
                            <span className="font-mono text-white">
                              {h.instruction.text}
                            </span>{" "}
                            in {STAGE_NAMES[h.stageIndex]}
                          </p>
                        </div>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>

                {/* Forwarding paths */}
                <AnimatePresence>
                  {forwardingPaths.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="mt-3 pt-3 border-t border-[#1e1e2e]"
                    >
                      <h4 className="text-[10px] uppercase tracking-wider text-[#06b6d4] font-semibold mb-2 flex items-center gap-1.5">
                        <Zap size={10} />
                        Forwarding Active
                      </h4>
                      {forwardingPaths.map((fp, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1.5 p-2 mb-1 rounded-lg bg-[#06b6d4]/5 border border-[#06b6d4]/15"
                        >
                          <span className="text-[10px] font-mono text-[#06b6d4]">
                            {STAGE_NAMES[fp.fromStage]}
                          </span>
                          <ArrowRight size={10} className="text-[#06b6d4]" />
                          <span className="text-[10px] font-mono text-[#06b6d4]">
                            {STAGE_NAMES[fp.toStage]}
                          </span>
                          <span className="text-[10px] text-[#71717a] ml-auto font-mono">
                            {fp.register}
                          </span>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Info ── */}
              <div className="p-4 rounded-xl bg-[#0f0f17] border border-[#1e1e2e]/50">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-[#6366f1] mt-0.5 shrink-0" />
                  <div className="text-[11px] text-[#71717a] leading-relaxed">
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Data Hazard:</strong>{" "}
                      RAW dependency between instructions on same register.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Load-Use:</strong>{" "}
                      LW followed by read of same register needs 1 stall even with forwarding.
                    </p>
                    <p>
                      <strong className="text-[#a1a1aa]">Control:</strong>{" "}
                      Branch evaluated in EX; instructions in IF/ID are flushed.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Right: Main Visualization Area ── */}
            <div className="space-y-6 min-w-0">
              {/* ── Metrics Bar ── */}
              <AnimatePresence>
                {showMetrics && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {[
                        {
                          label: "Clock Cycle",
                          value: cycle.toString(),
                          color: "#6366f1",
                        },
                        {
                          label: "Completed",
                          value: completedCount.toString(),
                          color: "#10b981",
                        },
                        { label: "CPI", value: cpi, color: "#06b6d4" },
                        {
                          label: "Stalls",
                          value: stallCount.toString(),
                          color: "#f59e0b",
                        },
                        {
                          label: "Forwards",
                          value: forwardCount.toString(),
                          color: "#ec4899",
                        },
                      ].map((metric) => (
                        <div
                          key={metric.label}
                          className="p-3 rounded-xl bg-[#111118] border border-[#1e1e2e]"
                        >
                          <div
                            className="text-[10px] uppercase tracking-wider font-medium mb-1"
                            style={{ color: metric.color }}
                          >
                            {metric.label}
                          </div>
                          <div className="text-xl font-bold font-mono text-white">
                            {metric.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Pipeline Stage Boxes ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4">
                  Current Pipeline State
                </h3>

                <div className="grid grid-cols-5 gap-3">
                  {STAGE_NAMES.map((name, idx) => {
                    const slot = pipeline[idx];
                    const hasInstr = slot.instruction && !slot.isFlushed;
                    const stageColor = STAGE_COLORS[idx];

                    // Check if there's a forwarding path involving this stage
                    const hasForward = forwardingPaths.some(
                      (f) => f.fromStage === idx || f.toStage === idx
                    );

                    // Check if there's a hazard at this stage
                    const hasHazard = hazards.some((h) => h.stageIndex === idx);

                    return (
                      <motion.div
                        key={name}
                        className="relative"
                        layout
                      >
                        {/* Stage container */}
                        <div
                          className="relative rounded-xl border overflow-hidden transition-all duration-300"
                          style={{
                            borderColor: hasHazard
                              ? "#f59e0b"
                              : hasForward
                              ? "#06b6d4"
                              : hasInstr
                              ? `${stageColor}40`
                              : "#1e1e2e",
                            backgroundColor: hasInstr
                              ? `${slot.instruction!.color}08`
                              : slot.isStall
                              ? "#71717a08"
                              : "#0f0f17",
                          }}
                        >
                          {/* Stage header */}
                          <div
                            className="px-3 py-1.5 text-center border-b"
                            style={{
                              backgroundColor: `${stageColor}15`,
                              borderColor: `${stageColor}20`,
                            }}
                          >
                            <span
                              className="text-xs font-bold font-mono tracking-wider"
                              style={{ color: stageColor }}
                            >
                              {name}
                            </span>
                            <div className="text-[9px] text-[#71717a] mt-0.5">
                              {STAGE_DESCRIPTIONS[idx]}
                            </div>
                          </div>

                          {/* Stage content */}
                          <div className="px-3 py-4 min-h-[80px] flex flex-col items-center justify-center">
                            <AnimatePresence mode="wait">
                              {slot.isFlushed ? (
                                <motion.div
                                  key="flushed"
                                  initial={{ opacity: 0, scale: 0.8 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.8 }}
                                  className="text-center"
                                >
                                  <div className="text-[10px] font-mono text-[#ef4444] font-bold uppercase">
                                    FLUSHED
                                  </div>
                                  <div className="text-[9px] text-[#ef4444]/60 mt-1 font-mono truncate max-w-full">
                                    {slot.instruction?.text}
                                  </div>
                                </motion.div>
                              ) : slot.isStall ? (
                                <motion.div
                                  key="stall"
                                  initial={{ opacity: 0, scale: 0.8 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.8 }}
                                  className="text-center"
                                >
                                  <div className="w-8 h-1 rounded-full bg-[#71717a]/40 mb-2 mx-auto" />
                                  <div className="text-[10px] font-mono text-[#71717a] font-bold uppercase">
                                    BUBBLE
                                  </div>
                                </motion.div>
                              ) : hasInstr ? (
                                <motion.div
                                  key={slot.instruction!.id}
                                  initial={{ opacity: 0, x: -20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, x: 20 }}
                                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                                  className="text-center w-full"
                                >
                                  <div
                                    className="w-3 h-3 rounded-full mx-auto mb-2"
                                    style={{
                                      backgroundColor: slot.instruction!.color,
                                      boxShadow: `0 0 12px ${slot.instruction!.color}40`,
                                    }}
                                  />
                                  <div
                                    className="text-[11px] font-mono font-semibold truncate"
                                    style={{ color: slot.instruction!.color }}
                                  >
                                    {slot.instruction!.op}
                                  </div>
                                  <div className="text-[9px] font-mono text-[#a1a1aa] mt-1 truncate max-w-full">
                                    {slot.instruction!.text}
                                  </div>
                                  {/* Show registers being processed at this stage */}
                                  <div className="text-[8px] font-mono text-[#71717a] mt-2 space-x-1">
                                    {idx === 0 && <span>PC fetch</span>}
                                    {idx === 1 && (
                                      <>
                                        {slot.instruction!.rs && (
                                          <span className="px-1 py-0.5 rounded bg-[#1e1e2e]">
                                            {slot.instruction!.rs}
                                          </span>
                                        )}
                                        {slot.instruction!.rt && (
                                          <span className="px-1 py-0.5 rounded bg-[#1e1e2e]">
                                            {slot.instruction!.rt}
                                          </span>
                                        )}
                                      </>
                                    )}
                                    {idx === 2 && (
                                      <span className="px-1 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b]">
                                        ALU
                                      </span>
                                    )}
                                    {idx === 3 &&
                                      (slot.instruction!.op === "LW" || slot.instruction!.op === "SW" ? (
                                        <span className="px-1 py-0.5 rounded bg-[#10b981]/10 text-[#10b981]">
                                          MEM R/W
                                        </span>
                                      ) : (
                                        <span>pass</span>
                                      ))}
                                    {idx === 4 && slot.instruction!.rd && (
                                      <span className="px-1 py-0.5 rounded bg-[#ec4899]/10 text-[#ec4899]">
                                        {slot.instruction!.rd} &larr;
                                      </span>
                                    )}
                                  </div>
                                </motion.div>
                              ) : (
                                <motion.div
                                  key="empty"
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  className="text-[10px] text-[#71717a]/40 font-mono"
                                >
                                  empty
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>

                          {/* Hazard indicator */}
                          {hasHazard && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#f59e0b] flex items-center justify-center shadow-lg shadow-[#f59e0b]/30"
                            >
                              <AlertTriangle size={10} className="text-black" />
                            </motion.div>
                          )}

                          {/* Forwarding indicator */}
                          {hasForward && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-[#06b6d4] flex items-center justify-center shadow-lg shadow-[#06b6d4]/30"
                            >
                              <Zap size={10} className="text-black" />
                            </motion.div>
                          )}
                        </div>

                        {/* Arrow between stages */}
                        {idx < 4 && (
                          <div className="hidden sm:block absolute -right-[14px] top-1/2 -translate-y-1/2 z-10">
                            <ArrowRight
                              size={14}
                              className="text-[#2a2a3e]"
                            />
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>

                {/* ── Forwarding path visualization (SVG overlay arrows) ── */}
                <AnimatePresence>
                  {forwardingPaths.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="mt-3 pt-3 border-t border-[#1e1e2e]"
                    >
                      <div className="flex items-center justify-center gap-2 text-xs text-[#06b6d4]">
                        <Zap size={12} />
                        <span className="font-mono">
                          Forwarding:{" "}
                          {forwardingPaths.map((fp, i) => (
                            <span key={i}>
                              {i > 0 && ", "}
                              <span className="font-bold">{fp.register}</span>{" "}
                              <span className="text-[#71717a]">
                                ({STAGE_NAMES[fp.fromStage]} &rarr; {STAGE_NAMES[fp.toStage]})
                              </span>
                            </span>
                          ))}
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Pipeline Timing Diagram ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <GitBranch size={14} className="text-[#6366f1]" />
                  Pipeline Timing Diagram
                </h3>

                {history.length === 0 ? (
                  <div className="py-12 text-center">
                    <div className="text-[#71717a]/30 mb-3">
                      <Cpu size={40} className="mx-auto" />
                    </div>
                    <p className="text-sm text-[#71717a]">
                      Press <span className="font-mono text-[#6366f1]">Play</span> or{" "}
                      <span className="font-mono text-[#6366f1]">Step</span> to begin simulation
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3 w-16 sticky left-0 bg-[#111118] z-10">
                            Cycle
                          </th>
                          {STAGE_NAMES.map((name, idx) => (
                            <th
                              key={name}
                              className="text-center text-[10px] uppercase tracking-wider font-semibold pb-2 px-1 min-w-[100px]"
                              style={{ color: STAGE_COLORS[idx] }}
                            >
                              {name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <AnimatePresence>
                          {history.map((row) => (
                            <motion.tr
                              key={row.cycle}
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.2 }}
                              className="border-t border-[#1e1e2e]/40"
                            >
                              <td className="py-1.5 pr-3 text-xs font-mono text-[#71717a] sticky left-0 bg-[#111118] z-10">
                                {row.cycle}
                              </td>
                              {row.slots.map((cell, colIdx) => (
                                <td key={colIdx} className="py-1.5 px-1">
                                  {cell ? (
                                    <motion.div
                                      initial={{ scale: 0.7, opacity: 0 }}
                                      animate={{ scale: 1, opacity: 1 }}
                                      transition={{
                                        type: "spring",
                                        stiffness: 400,
                                        damping: 25,
                                        delay: colIdx * 0.04,
                                      }}
                                      className="px-2 py-1.5 rounded-lg text-center border transition-colors"
                                      style={{
                                        backgroundColor: cell.isFlushed
                                          ? "#ef44440a"
                                          : cell.isStall
                                          ? "#71717a0a"
                                          : `${cell.color}12`,
                                        borderColor: cell.isFlushed
                                          ? "#ef444425"
                                          : cell.isStall
                                          ? "#71717a20"
                                          : `${cell.color}30`,
                                      }}
                                    >
                                      {cell.isFlushed ? (
                                        <span className="text-[10px] font-mono text-[#ef4444]/70 line-through">
                                          {cell.instrText}
                                        </span>
                                      ) : cell.isStall && cell.instrId === -1 ? (
                                        <span className="text-[10px] font-mono text-[#71717a] uppercase">
                                          Bubble
                                        </span>
                                      ) : (
                                        <span
                                          className="text-[10px] font-mono font-medium block truncate"
                                          style={{ color: cell.color }}
                                        >
                                          {cell.instrText}
                                        </span>
                                      )}
                                    </motion.div>
                                  ) : (
                                    <div className="px-2 py-1.5 text-center">
                                      <span className="text-[10px] text-[#71717a]/20 font-mono">
                                        &mdash;
                                      </span>
                                    </div>
                                  )}
                                </td>
                              ))}
                            </motion.tr>
                          ))}
                        </AnimatePresence>
                      </tbody>
                    </table>
                    <div ref={historyEndRef} />
                  </div>
                )}

                {/* Simulation complete banner */}
                <AnimatePresence>
                  {simulationDone && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-4 p-3 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20 flex items-center gap-2"
                    >
                      <div className="w-2 h-2 rounded-full bg-[#10b981]" />
                      <span className="text-xs text-[#10b981] font-medium">
                        Simulation complete &mdash; {completedCount} instructions in{" "}
                        {cycle} cycles (CPI = {cpi})
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Instruction-centric Timeline View ── */}
              {history.length > 0 && (
                <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                  <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                    <ArrowDown size={14} className="text-[#06b6d4]" />
                    Instruction Timeline
                  </h3>

                  <div className="overflow-x-auto">
                    <InstructionTimeline
                      instructions={instructionQueue}
                      history={history}
                      cycle={cycle}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ──────────────────────────── Instruction Timeline Sub-component ────────────────────────────

function InstructionTimeline({
  instructions,
  history,
  cycle,
}: {
  instructions: Instruction[];
  history: PipelineHistoryRow[];
  cycle: number;
}) {
  // Build per-instruction timeline: for each instruction, which cycles was it in which stage?
  const instrTimelines = new Map<
    number,
    { cycle: number; stage: number; isStall: boolean; isFlushed: boolean }[]
  >();

  for (const instr of instructions) {
    instrTimelines.set(instr.id, []);
  }

  for (const row of history) {
    for (let stageIdx = 0; stageIdx < 5; stageIdx++) {
      const cell = row.slots[stageIdx];
      if (cell && cell.instrId > 0) {
        const timeline = instrTimelines.get(cell.instrId);
        if (timeline) {
          timeline.push({
            cycle: row.cycle,
            stage: stageIdx,
            isStall: cell.isStall,
            isFlushed: cell.isFlushed,
          });
        }
      }
    }
  }

  const maxCycle = Math.max(cycle, 1);
  const colCount = Math.min(maxCycle, 30); // cap visible columns

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3 min-w-[140px] sticky left-0 bg-[#111118] z-10">
            Instruction
          </th>
          {Array.from({ length: colCount }, (_, i) => (
            <th
              key={i + 1}
              className="text-center text-[10px] font-mono text-[#71717a] pb-2 px-0.5 min-w-[40px]"
            >
              {i + 1}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {instructions.map((instr) => {
          const timeline = instrTimelines.get(instr.id) || [];

          return (
            <tr key={instr.id} className="border-t border-[#1e1e2e]/30">
              <td className="py-1.5 pr-3 sticky left-0 bg-[#111118] z-10">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: instr.color }}
                  />
                  <span
                    className="text-[10px] font-mono font-medium truncate"
                    style={{ color: instr.color }}
                  >
                    {instr.text}
                  </span>
                </div>
              </td>
              {Array.from({ length: colCount }, (_, colI) => {
                const cycleNum = colI + 1;
                const entry = timeline.find((t) => t.cycle === cycleNum);

                if (!entry) {
                  return (
                    <td key={colI} className="py-1.5 px-0.5">
                      <div className="h-6" />
                    </td>
                  );
                }

                const stageColor = STAGE_COLORS[entry.stage];

                return (
                  <td key={colI} className="py-1.5 px-0.5">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="h-6 rounded flex items-center justify-center"
                      style={{
                        backgroundColor: entry.isFlushed
                          ? "#ef44441a"
                          : `${stageColor}25`,
                        border: `1px solid ${
                          entry.isFlushed ? "#ef444440" : `${stageColor}50`
                        }`,
                      }}
                    >
                      <span
                        className="text-[8px] font-mono font-bold"
                        style={{
                          color: entry.isFlushed ? "#ef4444" : stageColor,
                          textDecoration: entry.isFlushed ? "line-through" : "none",
                        }}
                      >
                        {entry.isFlushed ? "X" : STAGE_NAMES[entry.stage]}
                      </span>
                    </motion.div>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
