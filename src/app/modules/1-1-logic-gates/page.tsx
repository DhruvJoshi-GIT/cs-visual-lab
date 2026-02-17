"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  ToggleLeft,
  ToggleRight,
  Info,
  CircuitBoard,
  Table2,
  Lightbulb,
  Hash,
  Activity,
  ChevronRight,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

type GateType = "AND" | "OR" | "NOT" | "NAND" | "NOR" | "XOR" | "XNOR";

interface GateInfo {
  name: GateType;
  label: string;
  description: string;
  expression: string;
  inputs: number;
  realWorld: string;
  evaluate: (a: number, b: number) => number;
}

interface TruthTableRow {
  a: number;
  b: number;
  output: number;
}

type ScenarioKey = "basic" | "universal" | "xor-family";

interface Scenario {
  key: ScenarioKey;
  label: string;
  gates: GateType[];
  description: string;
}

interface SignalState {
  inputA: number;
  inputB: number;
  output: number;
  propagationPhase: number; // 0=idle, 1=inputs active, 2=gate processing, 3=output ready
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = {
  bg: "#0a0a0f",
  card: "#111118",
  border: "#1e1e2e",
  primary: "#6366f1",
  secondary: "#06b6d4",
  success: "#10b981",
  danger: "#ef4444",
  accent: "#f59e0b",
  muted: "#71717a",
  wireHigh: "#10b981",
  wireLow: "#71717a",
  gateBody: "#1e1e2e",
  gateBorder: "#2a2a3e",
};

const GATES: Record<GateType, GateInfo> = {
  AND: {
    name: "AND",
    label: "AND Gate",
    description:
      "Outputs 1 only when ALL inputs are 1. The AND gate performs logical conjunction -- both conditions must be true for the result to be true.",
    expression: "Y = A . B",
    inputs: 2,
    realWorld:
      "Used in security systems where multiple conditions must be met (e.g., both key card AND PIN required), alarm systems, and enable circuits.",
    evaluate: (a, b) => a & b,
  },
  OR: {
    name: "OR",
    label: "OR Gate",
    description:
      "Outputs 1 when ANY input is 1. The OR gate performs logical disjunction -- at least one condition must be true for the result to be true.",
    expression: "Y = A + B",
    inputs: 2,
    realWorld:
      "Used in systems where any one trigger should activate output, like doorbell circuits (front OR back door), emergency alarm systems.",
    evaluate: (a, b) => a | b,
  },
  NOT: {
    name: "NOT",
    label: "NOT Gate (Inverter)",
    description:
      "Inverts the input signal. If input is 1, output is 0 and vice versa. The NOT gate performs logical negation.",
    expression: "Y = A'",
    inputs: 1,
    realWorld:
      "Used in toggle switches, signal inversion in communication systems, creating complementary signals in digital circuits.",
    evaluate: (a, _b) => a === 0 ? 1 : 0,
  },
  NAND: {
    name: "NAND",
    label: "NAND Gate",
    description:
      "Outputs 0 only when ALL inputs are 1. NAND is a universal gate -- any digital circuit can be built using only NAND gates.",
    expression: "Y = (A . B)'",
    inputs: 2,
    realWorld:
      "Universal gate used to build entire processors. Flash memory (NAND flash) in SSDs and USB drives is built from NAND gates.",
    evaluate: (a, b) => (a & b) === 0 ? 1 : 0,
  },
  NOR: {
    name: "NOR",
    label: "NOR Gate",
    description:
      "Outputs 1 only when ALL inputs are 0. NOR is also a universal gate -- any logic function can be implemented using only NOR gates.",
    expression: "Y = (A + B)'",
    inputs: 2,
    realWorld:
      "Used in the Apollo Guidance Computer (built entirely from NOR gates), SR latches for memory storage, and power-down detection circuits.",
    evaluate: (a, b) => (a | b) === 0 ? 1 : 0,
  },
  XOR: {
    name: "XOR",
    label: "XOR Gate",
    description:
      "Outputs 1 when inputs are DIFFERENT. XOR (exclusive OR) is true when exactly one input is true, but not both.",
    expression: "Y = A ^ B",
    inputs: 2,
    realWorld:
      "Essential in arithmetic circuits (half/full adders), parity checking in error detection, encryption algorithms, and comparators.",
    evaluate: (a, b) => a ^ b,
  },
  XNOR: {
    name: "XNOR",
    label: "XNOR Gate",
    description:
      "Outputs 1 when inputs are the SAME. XNOR (exclusive NOR) acts as an equality detector -- true when both inputs match.",
    expression: "Y = (A ^ B)'",
    inputs: 2,
    realWorld:
      "Used in equality comparators, bit-matching circuits, and digital systems that need to check if two signals are identical.",
    evaluate: (a, b) => (a ^ b) === 0 ? 1 : 0,
  },
};

const GATE_KEYS: GateType[] = ["AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR"];

const SCENARIOS: Scenario[] = [
  {
    key: "basic",
    label: "Basic Gates",
    gates: ["AND", "OR", "NOT"],
    description: "Fundamental logic gates",
  },
  {
    key: "universal",
    label: "Universal Gates",
    gates: ["NAND", "NOR"],
    description: "Gates that can implement any logic function",
  },
  {
    key: "xor-family",
    label: "XOR Family",
    gates: ["XOR", "XNOR"],
    description: "Exclusive OR and its complement",
  },
];

function generateTruthTable(gate: GateType): TruthTableRow[] {
  const gateInfo = GATES[gate];
  if (gate === "NOT") {
    return [
      { a: 0, b: 0, output: gateInfo.evaluate(0, 0) },
      { a: 1, b: 0, output: gateInfo.evaluate(1, 0) },
    ];
  }
  return [
    { a: 0, b: 0, output: gateInfo.evaluate(0, 0) },
    { a: 0, b: 1, output: gateInfo.evaluate(0, 1) },
    { a: 1, b: 0, output: gateInfo.evaluate(1, 0) },
    { a: 1, b: 1, output: gateInfo.evaluate(1, 1) },
  ];
}

// ─── Gate Symbol Component ────────────────────────────────────────────────────

function GateSymbol({
  gate,
  inputA,
  inputB,
  output,
  propagationPhase,
}: {
  gate: GateType;
  inputA: number;
  inputB: number;
  output: number;
  propagationPhase: number;
}) {
  const gateInfo = GATES[gate];
  const isNot = gate === "NOT";

  const wireColorA = propagationPhase >= 1 ? (inputA ? COLORS.wireHigh : COLORS.wireLow) : "#2a2a3e";
  const wireColorB = propagationPhase >= 1 ? (inputB ? COLORS.wireHigh : COLORS.wireLow) : "#2a2a3e";
  const gateColor =
    propagationPhase >= 2
      ? output
        ? "rgba(16,185,129,0.15)"
        : "rgba(113,113,122,0.1)"
      : "rgba(30,30,46,0.8)";
  const gateBorderColor =
    propagationPhase >= 2
      ? output
        ? "rgba(16,185,129,0.4)"
        : "rgba(113,113,122,0.3)"
      : "#2a2a3e";
  const outputWireColor =
    propagationPhase >= 3 ? (output ? COLORS.wireHigh : COLORS.wireLow) : "#2a2a3e";

  const gateGlow =
    propagationPhase >= 2 && output
      ? "0 0 20px rgba(16,185,129,0.2), 0 0 40px rgba(16,185,129,0.1)"
      : "none";

  return (
    <div className="relative w-full" style={{ height: "220px" }}>
      {/* Input A wire */}
      <div className="absolute flex items-center" style={{ left: "8%", top: isNot ? "50%" : "35%", transform: "translateY(-50%)", width: "18%" }}>
        <div
          className="h-[3px] w-full rounded-full transition-colors duration-300"
          style={{ backgroundColor: wireColorA }}
        />
        {propagationPhase >= 1 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute right-0 w-2 h-2 rounded-full"
            style={{ backgroundColor: wireColorA, boxShadow: inputA ? `0 0 8px ${COLORS.wireHigh}` : "none" }}
          />
        )}
      </div>

      {/* Input A label */}
      <div
        className="absolute flex items-center justify-center w-10 h-10 rounded-lg font-mono font-bold text-lg transition-all duration-300"
        style={{
          left: "0%",
          top: isNot ? "50%" : "35%",
          transform: "translateY(-50%)",
          backgroundColor: inputA ? "rgba(16,185,129,0.15)" : "rgba(113,113,122,0.1)",
          border: `2px solid ${inputA ? "rgba(16,185,129,0.4)" : "rgba(113,113,122,0.2)"}`,
          color: inputA ? COLORS.wireHigh : COLORS.wireLow,
        }}
      >
        {inputA}
      </div>

      {/* Input B wire (not for NOT gate) */}
      {!isNot && (
        <>
          <div className="absolute flex items-center" style={{ left: "8%", top: "65%", transform: "translateY(-50%)", width: "18%" }}>
            <div
              className="h-[3px] w-full rounded-full transition-colors duration-300"
              style={{ backgroundColor: wireColorB }}
            />
            {propagationPhase >= 1 && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute right-0 w-2 h-2 rounded-full"
                style={{ backgroundColor: wireColorB, boxShadow: inputB ? `0 0 8px ${COLORS.wireHigh}` : "none" }}
              />
            )}
          </div>

          {/* Input B label */}
          <div
            className="absolute flex items-center justify-center w-10 h-10 rounded-lg font-mono font-bold text-lg transition-all duration-300"
            style={{
              left: "0%",
              top: "65%",
              transform: "translateY(-50%)",
              backgroundColor: inputB ? "rgba(16,185,129,0.15)" : "rgba(113,113,122,0.1)",
              border: `2px solid ${inputB ? "rgba(16,185,129,0.4)" : "rgba(113,113,122,0.2)"}`,
              color: inputB ? COLORS.wireHigh : COLORS.wireLow,
            }}
          >
            {inputB}
          </div>
        </>
      )}

      {/* Gate body */}
      <motion.div
        className="absolute flex flex-col items-center justify-center rounded-2xl transition-all duration-300"
        style={{
          left: "28%",
          top: "50%",
          transform: "translateY(-50%)",
          width: "40%",
          height: "140px",
          backgroundColor: gateColor,
          border: `2px solid ${gateBorderColor}`,
          boxShadow: gateGlow,
        }}
        animate={propagationPhase === 2 ? { scale: [1, 1.03, 1] } : {}}
        transition={{ duration: 0.3 }}
      >
        <span className="text-2xl font-bold text-white tracking-wide">{gate}</span>
        <span className="text-xs font-mono mt-1" style={{ color: COLORS.muted }}>
          {gateInfo.expression}
        </span>

        {/* Inversion bubble for NAND, NOR, NOT, XNOR */}
        {(gate === "NAND" || gate === "NOR" || gate === "NOT" || gate === "XNOR") && (
          <div
            className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 transition-all duration-300"
            style={{
              backgroundColor: propagationPhase >= 2 ? (output ? "rgba(16,185,129,0.3)" : "rgba(113,113,122,0.2)") : "#0a0a0f",
              borderColor: gateBorderColor,
            }}
          />
        )}
      </motion.div>

      {/* Output wire */}
      <div className="absolute flex items-center" style={{ left: "70%", top: "50%", transform: "translateY(-50%)", width: "18%" }}>
        <div
          className="h-[3px] w-full rounded-full transition-colors duration-300"
          style={{ backgroundColor: outputWireColor }}
        />
        {propagationPhase >= 3 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute left-0 w-2 h-2 rounded-full"
            style={{ backgroundColor: outputWireColor, boxShadow: output ? `0 0 8px ${COLORS.wireHigh}` : "none" }}
          />
        )}
      </div>

      {/* Output label */}
      <motion.div
        className="absolute flex items-center justify-center w-10 h-10 rounded-lg font-mono font-bold text-lg transition-all duration-300"
        style={{
          right: "0%",
          top: "50%",
          transform: "translateY(-50%)",
          backgroundColor: propagationPhase >= 3 ? (output ? "rgba(16,185,129,0.15)" : "rgba(113,113,122,0.1)") : "rgba(30,30,46,0.5)",
          border: `2px solid ${propagationPhase >= 3 ? (output ? "rgba(16,185,129,0.4)" : "rgba(113,113,122,0.2)") : "#2a2a3e"}`,
          color: propagationPhase >= 3 ? (output ? COLORS.wireHigh : COLORS.wireLow) : "#2a2a3e",
        }}
        animate={propagationPhase === 3 ? { scale: [1, 1.15, 1] } : {}}
        transition={{ duration: 0.3 }}
      >
        {propagationPhase >= 3 ? output : "?"}
      </motion.div>

      {/* Input labels */}
      <div
        className="absolute text-xs font-mono font-semibold"
        style={{ left: "1%", top: isNot ? "37%" : "22%", color: COLORS.muted }}
      >
        A
      </div>
      {!isNot && (
        <div
          className="absolute text-xs font-mono font-semibold"
          style={{ left: "1%", top: "78%", color: COLORS.muted }}
        >
          B
        </div>
      )}
      <div
        className="absolute text-xs font-mono font-semibold"
        style={{ right: "1%", top: "37%", color: COLORS.muted }}
      >
        Y
      </div>

      {/* Signal flow arrows */}
      {propagationPhase >= 1 && propagationPhase < 3 && (
        <motion.div
          className="absolute"
          style={{ left: "24%", top: "50%", transform: "translateY(-50%)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 0.6, repeat: Infinity }}
        >
          <ChevronRight size={16} style={{ color: COLORS.accent }} />
        </motion.div>
      )}
      {propagationPhase >= 2 && propagationPhase < 3 && (
        <motion.div
          className="absolute"
          style={{ left: "66%", top: "50%", transform: "translateY(-50%)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 0.6, repeat: Infinity }}
        >
          <ChevronRight size={16} style={{ color: COLORS.accent }} />
        </motion.div>
      )}
    </div>
  );
}

// ─── Truth Table Component ────────────────────────────────────────────────────

function TruthTableDisplay({
  gate,
  currentA,
  currentB,
  highlightRow,
}: {
  gate: GateType;
  currentA: number;
  currentB: number;
  highlightRow: boolean;
}) {
  const isNot = gate === "NOT";
  const rows = generateTruthTable(gate);

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
      <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: COLORS.border }}>
        <Table2 size={14} style={{ color: COLORS.secondary }} />
        <span className="text-sm font-semibold text-white">Truth Table</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: COLORS.border }}>
              <th className="px-4 py-2 text-center font-mono font-medium" style={{ color: COLORS.muted }}>A</th>
              {!isNot && <th className="px-4 py-2 text-center font-mono font-medium" style={{ color: COLORS.muted }}>B</th>}
              <th className="px-4 py-2 text-center font-mono font-medium" style={{ color: COLORS.secondary }}>Y</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const isActive =
                highlightRow &&
                row.a === currentA &&
                (isNot || row.b === currentB);

              return (
                <tr
                  key={idx}
                  className="border-b transition-all duration-200"
                  style={{
                    borderColor: `${COLORS.border}50`,
                    backgroundColor: isActive ? "rgba(99,102,241,0.08)" : "transparent",
                  }}
                >
                  <td className="px-4 py-2.5 text-center font-mono font-bold" style={{ color: row.a ? COLORS.wireHigh : COLORS.wireLow }}>
                    {row.a}
                  </td>
                  {!isNot && (
                    <td className="px-4 py-2.5 text-center font-mono font-bold" style={{ color: row.b ? COLORS.wireHigh : COLORS.wireLow }}>
                      {row.b}
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md font-mono font-bold text-sm"
                      style={{
                        backgroundColor: row.output ? "rgba(16,185,129,0.15)" : "rgba(113,113,122,0.1)",
                        color: row.output ? COLORS.wireHigh : COLORS.wireLow,
                        border: isActive ? `1px solid ${COLORS.primary}` : "1px solid transparent",
                      }}
                    >
                      {row.output}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Metric Badge Component ──────────────────────────────────────────────────

function MetricBadge({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border backdrop-blur-md"
      style={{
        backgroundColor: "rgba(17,17,24,0.85)",
        borderColor: `${color}33`,
      }}
    >
      <span style={{ color }}>{icon}</span>
      <div className="flex flex-col">
        <span className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.muted }}>
          {label}
        </span>
        <span className="text-xs font-mono font-semibold tabular-nums" style={{ color }}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
      </div>
    </div>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function LogicGatesPage() {
  // ── Core state ────────────────────────────────────────────────────────────
  const [selectedGate, setSelectedGate] = useState<GateType>("AND");
  const [inputA, setInputA] = useState(0);
  const [inputB, setInputB] = useState(0);
  const [propagationPhase, setPropagationPhase] = useState(3);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey>("basic");
  const [showMetrics, setShowMetrics] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  // ── Metrics state ─────────────────────────────────────────────────────────
  const [totalGatesTested, setTotalGatesTested] = useState(0);
  const [stepCount, setStepCount] = useState(0);

  // ── Auto-play state ───────────────────────────────────────────────────────
  const [autoPlayGateIndex, setAutoPlayGateIndex] = useState(0);
  const [autoPlayRowIndex, setAutoPlayRowIndex] = useState(0);
  const [autoPlayPhase, setAutoPlayPhase] = useState(0); // 0-3 propagation phases

  // ── Refs ───────────────────────────────────────────────────────────────────
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  // Keep refs in sync
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // ── Derived values ────────────────────────────────────────────────────────
  const currentGateInfo = GATES[selectedGate];
  const currentOutput = currentGateInfo.evaluate(inputA, inputB);
  const currentScenario = SCENARIOS.find((s) => s.key === selectedScenario)!;

  // ── Propagation animation on input change ─────────────────────────────────
  const triggerPropagation = useCallback(() => {
    setPropagationPhase(0);
    setTimeout(() => setPropagationPhase(1), 100);
    setTimeout(() => setPropagationPhase(2), 350);
    setTimeout(() => setPropagationPhase(3), 600);
  }, []);

  const handleToggleA = useCallback(() => {
    setInputA((prev) => (prev === 0 ? 1 : 0));
    triggerPropagation();
  }, [triggerPropagation]);

  const handleToggleB = useCallback(() => {
    setInputB((prev) => (prev === 0 ? 1 : 0));
    triggerPropagation();
  }, [triggerPropagation]);

  const handleSelectGate = useCallback((gate: GateType) => {
    setSelectedGate(gate);
    setPropagationPhase(3);
    setTotalGatesTested((prev) => prev + 1);
  }, []);

  // ── Step forward (auto-play logic) ────────────────────────────────────────
  const stepForward = useCallback(() => {
    const scenarioGates = currentScenario.gates;
    const currentAutoGate = scenarioGates[autoPlayGateIndex];
    const truthTable = generateTruthTable(currentAutoGate);

    if (autoPlayPhase < 3) {
      // Advance propagation phase
      const nextPhase = autoPlayPhase + 1;
      setAutoPlayPhase(nextPhase);
      setPropagationPhase(nextPhase);
      setStepCount((prev) => prev + 1);
      return true;
    }

    // Phase is 3, advance to next row
    const nextRowIndex = autoPlayRowIndex + 1;

    if (nextRowIndex < truthTable.length) {
      // Move to next truth table row
      setAutoPlayRowIndex(nextRowIndex);
      const row = truthTable[nextRowIndex];
      setInputA(row.a);
      setInputB(row.b);
      setSelectedGate(currentAutoGate);
      setAutoPlayPhase(0);
      setPropagationPhase(0);
      setStepCount((prev) => prev + 1);
      return true;
    }

    // All rows done for this gate, move to next gate
    const nextGateIndex = autoPlayGateIndex + 1;

    if (nextGateIndex < scenarioGates.length) {
      setAutoPlayGateIndex(nextGateIndex);
      setAutoPlayRowIndex(0);
      setAutoPlayPhase(0);
      const nextGate = scenarioGates[nextGateIndex];
      const nextTruthTable = generateTruthTable(nextGate);
      setSelectedGate(nextGate);
      setInputA(nextTruthTable[0].a);
      setInputB(nextTruthTable[0].b);
      setPropagationPhase(0);
      setTotalGatesTested((prev) => prev + 1);
      setStepCount((prev) => prev + 1);
      return true;
    }

    // All gates and rows exhausted
    setIsComplete(true);
    setIsPlaying(false);
    return false;
  }, [currentScenario, autoPlayGateIndex, autoPlayRowIndex, autoPlayPhase]);

  // ── Animation loop ────────────────────────────────────────────────────────
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;

      const interval = Math.max(10, 200 / speedRef.current);

      if (timestamp - lastTickRef.current >= interval) {
        lastTickRef.current = timestamp;
        const active = stepForward();
        if (!active) return;
      }

      animationRef.current = requestAnimationFrame(animationLoop);
    },
    [stepForward]
  );

  // ── Play / Pause / Step / Reset ───────────────────────────────────────────
  const handlePlay = useCallback(() => {
    if (isComplete) return;
    setIsPlaying(true);
    isPlayingRef.current = true;
    lastTickRef.current = 0;

    // Initialize auto-play if not started yet
    if (autoPlayPhase === 0 && autoPlayRowIndex === 0 && autoPlayGateIndex === 0) {
      const scenarioGates = currentScenario.gates;
      const firstGate = scenarioGates[0];
      const firstTable = generateTruthTable(firstGate);
      setSelectedGate(firstGate);
      setInputA(firstTable[0].a);
      setInputB(firstTable[0].b);
      setPropagationPhase(0);
      setTotalGatesTested((prev) => prev + 1);
    }

    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop, isComplete, autoPlayPhase, autoPlayRowIndex, autoPlayGateIndex, currentScenario]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const handleStep = useCallback(() => {
    if (isComplete) return;
    handlePause();

    // Initialize on first step
    if (stepCount === 0) {
      const scenarioGates = currentScenario.gates;
      const firstGate = scenarioGates[0];
      const firstTable = generateTruthTable(firstGate);
      setSelectedGate(firstGate);
      setInputA(firstTable[0].a);
      setInputB(firstTable[0].b);
      setPropagationPhase(0);
      setTotalGatesTested((prev) => prev + 1);
    }

    stepForward();
  }, [handlePause, stepForward, isComplete, stepCount, currentScenario]);

  const handleReset = useCallback(() => {
    handlePause();
    setInputA(0);
    setInputB(0);
    setPropagationPhase(3);
    setAutoPlayGateIndex(0);
    setAutoPlayRowIndex(0);
    setAutoPlayPhase(0);
    setStepCount(0);
    setTotalGatesTested(0);
    setIsComplete(false);
    const firstGate = currentScenario.gates[0];
    setSelectedGate(firstGate);
  }, [handlePause, currentScenario]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Reset when scenario changes
  useEffect(() => {
    handlePause();
    setAutoPlayGateIndex(0);
    setAutoPlayRowIndex(0);
    setAutoPlayPhase(0);
    setStepCount(0);
    setIsComplete(false);
    const firstGate = SCENARIOS.find((s) => s.key === selectedScenario)!.gates[0];
    setSelectedGate(firstGate);
    setInputA(0);
    setInputB(0);
    setPropagationPhase(3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScenario]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: COLORS.bg }}>
      <Navbar />

      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* ── Header ────────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
            className="mb-6"
          >
            <div className="flex items-center gap-3 mb-2">
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-semibold"
                style={{
                  background: "rgba(99,102,241,0.1)",
                  color: COLORS.primary,
                  border: "1px solid rgba(99,102,241,0.2)",
                }}
              >
                1.1
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Transistors & Logic Gates
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Explore the fundamental building blocks of digital electronics. Toggle inputs, watch signals
              propagate through gates, and understand how simple logic operations power every computer.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium"
                style={{
                  background: "rgba(99,102,241,0.08)",
                  color: COLORS.primary,
                  border: "1px solid rgba(99,102,241,0.15)",
                }}
              >
                <CircuitBoard size={11} />
                Digital Logic Foundations
              </span>
            </div>
          </motion.div>

          {/* ── Scenario selector ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
            className="flex flex-wrap items-center gap-3 mb-4"
          >
            <span className="text-xs text-[#71717a] font-medium">Scenarios:</span>
            {SCENARIOS.map((scenario) => (
              <button
                key={scenario.key}
                onClick={() => setSelectedScenario(scenario.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                style={{
                  background: selectedScenario === scenario.key ? "rgba(99,102,241,0.12)" : "transparent",
                  color: selectedScenario === scenario.key ? COLORS.primary : COLORS.muted,
                  border: selectedScenario === scenario.key ? "1px solid rgba(99,102,241,0.2)" : "1px solid transparent",
                }}
              >
                {scenario.label}
              </button>
            ))}

            <div className="flex-1" />

            {/* Gate selector buttons */}
            <div className="flex items-center gap-1">
              {GATE_KEYS.map((gate) => (
                <button
                  key={gate}
                  onClick={() => handleSelectGate(gate)}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: selectedGate === gate ? "rgba(99,102,241,0.15)" : COLORS.card,
                    color: selectedGate === gate ? COLORS.primary : "#a1a1aa",
                    border: selectedGate === gate ? `1px solid rgba(99,102,241,0.3)` : `1px solid ${COLORS.border}`,
                  }}
                >
                  {gate}
                </button>
              ))}
            </div>
          </motion.div>

          {/* ── Main visualization area ───────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4"
          >
            {/* Gate visualization */}
            <div
              className="lg:col-span-2 rounded-2xl overflow-hidden relative"
              style={{
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
                boxShadow: "0 0 0 1px rgba(99,102,241,0.03), 0 20px 50px -12px rgba(0,0,0,0.5)",
              }}
            >
              {/* Gate name header */}
              <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: COLORS.border }}>
                <div className="flex items-center gap-2">
                  <CircuitBoard size={14} style={{ color: COLORS.primary }} />
                  <span className="text-sm font-semibold text-white">{currentGateInfo.label}</span>
                </div>
                <span className="text-xs font-mono" style={{ color: COLORS.secondary }}>
                  {currentGateInfo.expression}
                </span>
              </div>

              {/* Gate diagram */}
              <div className="px-6 py-4">
                <GateSymbol
                  gate={selectedGate}
                  inputA={inputA}
                  inputB={inputB}
                  output={currentOutput}
                  propagationPhase={propagationPhase}
                />
              </div>

              {/* Input toggles */}
              <div className="flex items-center justify-center gap-6 px-5 py-4 border-t" style={{ borderColor: COLORS.border }}>
                <button
                  onClick={handleToggleA}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: inputA ? "rgba(16,185,129,0.1)" : "rgba(113,113,122,0.08)",
                    border: `1px solid ${inputA ? "rgba(16,185,129,0.3)" : "rgba(113,113,122,0.15)"}`,
                    color: inputA ? COLORS.wireHigh : COLORS.wireLow,
                  }}
                >
                  {inputA ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  Input A: {inputA}
                </button>

                {selectedGate !== "NOT" && (
                  <button
                    onClick={handleToggleB}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                    style={{
                      background: inputB ? "rgba(16,185,129,0.1)" : "rgba(113,113,122,0.08)",
                      border: `1px solid ${inputB ? "rgba(16,185,129,0.3)" : "rgba(113,113,122,0.15)"}`,
                      color: inputB ? COLORS.wireHigh : COLORS.wireLow,
                    }}
                  >
                    {inputB ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    Input B: {inputB}
                  </button>
                )}

                <div
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-mono font-bold"
                  style={{
                    background: currentOutput ? "rgba(16,185,129,0.15)" : "rgba(113,113,122,0.08)",
                    border: `1px solid ${currentOutput ? "rgba(16,185,129,0.3)" : "rgba(113,113,122,0.15)"}`,
                    color: currentOutput ? COLORS.wireHigh : COLORS.wireLow,
                  }}
                >
                  <Activity size={14} />
                  Output: {currentOutput}
                </div>
              </div>

              {/* Metrics overlay */}
              <AnimatePresence>
                {showMetrics && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.2 }}
                    className="absolute top-14 right-3 flex gap-2"
                  >
                    <MetricBadge
                      icon={<Hash size={12} />}
                      label="Gates Tested"
                      value={totalGatesTested}
                      color={COLORS.accent}
                    />
                    <MetricBadge
                      icon={<CircuitBoard size={12} />}
                      label="Current Gate"
                      value={selectedGate}
                      color={COLORS.primary}
                    />
                    <MetricBadge
                      icon={<Activity size={12} />}
                      label="Steps"
                      value={stepCount}
                      color={COLORS.secondary}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Truth table */}
            <div className="lg:col-span-1">
              <TruthTableDisplay
                gate={selectedGate}
                currentA={inputA}
                currentB={inputB}
                highlightRow={propagationPhase >= 3}
              />

              {/* Signal legend */}
              <div
                className="mt-3 rounded-xl p-3"
                style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb size={12} style={{ color: COLORS.accent }} />
                  <span className="text-xs font-semibold text-white">Signal Legend</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-[3px] rounded-full" style={{ backgroundColor: COLORS.wireHigh }} />
                    <span className="text-[11px]" style={{ color: COLORS.muted }}>High (1)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-[3px] rounded-full" style={{ backgroundColor: COLORS.wireLow }} />
                    <span className="text-[11px]" style={{ color: COLORS.muted }}>Low (0)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-[3px] rounded-full" style={{ backgroundColor: "#2a2a3e" }} />
                    <span className="text-[11px]" style={{ color: COLORS.muted }}>Inactive</span>
                  </div>
                </div>
              </div>

              {/* All gates quick reference */}
              <div
                className="mt-3 rounded-xl overflow-hidden"
                style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
              >
                <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: COLORS.border }}>
                  <Zap size={12} style={{ color: COLORS.accent }} />
                  <span className="text-xs font-semibold text-white">Quick Reference</span>
                </div>
                <div className="p-2">
                  {GATE_KEYS.map((gate) => {
                    const gInfo = GATES[gate];
                    const isActive = gate === selectedGate;
                    return (
                      <button
                        key={gate}
                        onClick={() => handleSelectGate(gate)}
                        className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-all duration-150"
                        style={{
                          background: isActive ? "rgba(99,102,241,0.08)" : "transparent",
                          color: isActive ? COLORS.primary : "#a1a1aa",
                        }}
                      >
                        <span className="text-xs font-mono font-semibold">{gate}</span>
                        <span className="text-[10px] font-mono" style={{ color: COLORS.muted }}>
                          {gInfo.expression}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Controls panel ────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3, ease: [0.23, 1, 0.32, 1] }}
          >
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
              <AnimatePresence>
                {isComplete && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                    style={{
                      background: "rgba(16,185,129,0.1)",
                      border: "1px solid rgba(16,185,129,0.2)",
                    }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                    <span className="text-xs font-medium text-[#10b981]">All combinations tested</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </ModuleControls>
          </motion.div>

          {/* ── Educational info panel ────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="mt-6 rounded-2xl overflow-hidden"
            style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
          >
            <div className="px-5 py-3.5 border-b flex items-center gap-2" style={{ borderColor: COLORS.border }}>
              <Info size={14} style={{ color: COLORS.primary }} />
              <span className="text-sm font-semibold text-white">
                Understanding the {currentGateInfo.label}
              </span>
            </div>

            <div className="p-5 space-y-4">
              {/* Description */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: COLORS.secondary }}>
                  How It Works
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#a1a1aa" }}>
                  {currentGateInfo.description}
                </p>
              </div>

              {/* Boolean Expression */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: COLORS.accent }}>
                  Boolean Expression
                </h3>
                <div
                  className="inline-flex items-center px-4 py-2 rounded-lg font-mono text-lg font-bold"
                  style={{
                    background: "rgba(245,158,11,0.08)",
                    border: "1px solid rgba(245,158,11,0.15)",
                    color: COLORS.accent,
                  }}
                >
                  {currentGateInfo.expression}
                </div>
              </div>

              {/* Real-world uses */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: COLORS.wireHigh }}>
                  Real-World Applications
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#a1a1aa" }}>
                  {currentGateInfo.realWorld}
                </p>
              </div>

              {/* Key insight */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: "rgba(99,102,241,0.05)",
                  border: "1px solid rgba(99,102,241,0.1)",
                }}
              >
                <div className="flex items-start gap-2">
                  <Lightbulb size={16} className="mt-0.5 flex-shrink-0" style={{ color: COLORS.primary }} />
                  <div>
                    <span className="text-xs font-semibold text-white block mb-1">Key Insight</span>
                    <span className="text-xs leading-relaxed" style={{ color: "#a1a1aa" }}>
                      {selectedGate === "NAND" || selectedGate === "NOR"
                        ? `${selectedGate} is a universal gate. This means you can build ANY other logic gate (AND, OR, NOT, XOR, etc.) using only ${selectedGate} gates. This is why ${selectedGate} gates are the most commonly used in integrated circuit manufacturing.`
                        : selectedGate === "NOT"
                        ? "The NOT gate (inverter) is the simplest gate with just one input. Combined with AND/OR gates, it can create any logic function. Two NOT gates in series produce a buffer (identity function)."
                        : selectedGate === "XOR"
                        ? "XOR is essential for arithmetic circuits. In a half adder, XOR computes the sum bit while AND computes the carry. XOR is also its own inverse: A XOR B XOR B = A, which is used in encryption and error correction."
                        : selectedGate === "XNOR"
                        ? "XNOR acts as an equality detector. It outputs 1 when both inputs match. This makes it valuable in comparator circuits that need to check if two binary numbers are equal, bit by bit."
                        : selectedGate === "AND"
                        ? "The AND gate is often called an 'enable gate' because one input can enable or disable the other signal. When the enable input is 0, the output is always 0 regardless of the data input."
                        : "The OR gate is used in interrupt handling in CPUs. When any device signals an interrupt (sets its line to 1), the OR of all interrupt lines tells the CPU that at least one interrupt needs attention."}
                    </span>
                  </div>
                </div>
              </div>

              {/* Gate comparison table */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: COLORS.muted }}>
                  Gate Comparison
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b" style={{ borderColor: COLORS.border }}>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>Gate</th>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>Expression</th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>Inputs</th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>Universal</th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>Output for 0,0</th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>Output for 1,1</th>
                      </tr>
                    </thead>
                    <tbody>
                      {GATE_KEYS.map((gate) => {
                        const gInfo = GATES[gate];
                        const isActive = gate === selectedGate;
                        const out00 = gInfo.evaluate(0, 0);
                        const out11 = gInfo.evaluate(1, 1);

                        return (
                          <tr
                            key={gate}
                            className="border-b transition-colors duration-150 cursor-pointer"
                            style={{
                              borderColor: `${COLORS.border}50`,
                              background: isActive ? "rgba(99,102,241,0.04)" : "transparent",
                            }}
                            onClick={() => handleSelectGate(gate)}
                          >
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                {isActive && <div className="w-1.5 h-1.5 rounded-full" style={{ background: COLORS.primary }} />}
                                <span className="font-mono font-semibold" style={{ color: isActive ? "#ffffff" : "#a1a1aa" }}>
                                  {gate}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono" style={{ color: COLORS.secondary }}>{gInfo.expression}</td>
                            <td className="px-3 py-2 text-center font-mono" style={{ color: "#a1a1aa" }}>{gInfo.inputs}</td>
                            <td className="px-3 py-2 text-center">
                              {gate === "NAND" || gate === "NOR" ? (
                                <span style={{ color: COLORS.wireHigh }}>Yes</span>
                              ) : (
                                <span style={{ color: COLORS.muted }}>No</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className="font-mono font-bold" style={{ color: out00 ? COLORS.wireHigh : COLORS.wireLow }}>
                                {out00}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className="font-mono font-bold" style={{ color: out11 ? COLORS.wireHigh : COLORS.wireLow }}>
                                {gate === "NOT" ? "-" : out11}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
