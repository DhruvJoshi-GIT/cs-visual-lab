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
  Layers,
  ChevronRight,
  Timer,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

type CircuitType =
  | "MUX_2_1"
  | "MUX_4_1"
  | "DECODER_2_4"
  | "DECODER_3_8"
  | "HALF_ADDER"
  | "FULL_ADDER";

interface CircuitInfo {
  name: CircuitType;
  label: string;
  shortLabel: string;
  description: string;
  inputLabels: string[];
  outputLabels: string[];
  gateDelay: number;
  realWorld: string;
  evaluate: (inputs: number[]) => number[];
}

type ScenarioKey = "mux-2-1" | "mux-4-1" | "decoder-2-4" | "full-adder";

interface Scenario {
  key: ScenarioKey;
  label: string;
  circuit: CircuitType;
  description: string;
}

interface TruthTableEntry {
  inputs: number[];
  outputs: number[];
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
};

const CIRCUITS: Record<CircuitType, CircuitInfo> = {
  MUX_2_1: {
    name: "MUX_2_1",
    label: "2:1 Multiplexer",
    shortLabel: "2:1 MUX",
    description:
      "A 2:1 multiplexer selects one of two data inputs (D0, D1) based on a single select line (S). When S=0, output equals D0. When S=1, output equals D1. It acts as a digital switch.",
    inputLabels: ["D0", "D1", "S"],
    outputLabels: ["Y"],
    gateDelay: 2,
    realWorld:
      "Used in data routing, bus selection, ALU operand selection, and memory address multiplexing. CPUs use multiplexers extensively to route data between registers and functional units.",
    evaluate: (inputs) => {
      const [d0, d1, s] = inputs;
      return [s === 0 ? d0 : d1];
    },
  },
  MUX_4_1: {
    name: "MUX_4_1",
    label: "4:1 Multiplexer",
    shortLabel: "4:1 MUX",
    description:
      "A 4:1 multiplexer selects one of four data inputs (D0-D3) based on two select lines (S0, S1). The binary value of the select lines determines which input is passed to the output.",
    inputLabels: ["D0", "D1", "D2", "D3", "S0", "S1"],
    outputLabels: ["Y"],
    gateDelay: 3,
    realWorld:
      "Used in larger data routing systems, lookup tables in FPGAs (which are essentially chains of MUXes), and implementing arbitrary logic functions. Any Boolean function can be implemented with a sufficiently large MUX.",
    evaluate: (inputs) => {
      const [d0, d1, d2, d3, s0, s1] = inputs;
      const sel = s1 * 2 + s0;
      const data = [d0, d1, d2, d3];
      return [data[sel]];
    },
  },
  DECODER_2_4: {
    name: "DECODER_2_4",
    label: "2:4 Decoder",
    shortLabel: "2:4 DEC",
    description:
      "A 2:4 decoder converts a 2-bit binary input (A0, A1) into one of four output lines. Exactly one output line goes high based on the binary value of the inputs. An enable (E) input must be high for any output to be active.",
    inputLabels: ["A0", "A1", "E"],
    outputLabels: ["Y0", "Y1", "Y2", "Y3"],
    gateDelay: 2,
    realWorld:
      "Essential for memory address decoding (selecting which chip/row to activate), instruction decoding in CPUs, and generating chip select signals. Every time your CPU reads memory, decoders determine which memory location to access.",
    evaluate: (inputs) => {
      const [a0, a1, e] = inputs;
      const outputs = [0, 0, 0, 0];
      if (e === 1) {
        const sel = a1 * 2 + a0;
        outputs[sel] = 1;
      }
      return outputs;
    },
  },
  DECODER_3_8: {
    name: "DECODER_3_8",
    label: "3:8 Decoder",
    shortLabel: "3:8 DEC",
    description:
      "A 3:8 decoder converts a 3-bit binary input (A0, A1, A2) into one of eight output lines. With enable active, exactly one of the eight outputs goes high. Built by combining two 2:4 decoders.",
    inputLabels: ["A0", "A1", "A2", "E"],
    outputLabels: ["Y0", "Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "Y7"],
    gateDelay: 3,
    realWorld:
      "Used for larger memory address decoding, I/O port selection, and implementing any combinational logic function. A 3:8 decoder with OR gates can implement any 3-variable Boolean function.",
    evaluate: (inputs) => {
      const [a0, a1, a2, e] = inputs;
      const outputs = [0, 0, 0, 0, 0, 0, 0, 0];
      if (e === 1) {
        const sel = a2 * 4 + a1 * 2 + a0;
        outputs[sel] = 1;
      }
      return outputs;
    },
  },
  HALF_ADDER: {
    name: "HALF_ADDER",
    label: "Half Adder",
    shortLabel: "Half Add",
    description:
      "A half adder adds two single-bit inputs (A, B) and produces a Sum and Carry output. Sum = A XOR B, Carry = A AND B. It cannot handle a carry input from a previous stage.",
    inputLabels: ["A", "B"],
    outputLabels: ["Sum", "Cout"],
    gateDelay: 2,
    realWorld:
      "Used as the least significant bit adder in multi-bit addition circuits, and in simple increment operations. It is the foundation for understanding arithmetic circuits.",
    evaluate: (inputs) => {
      const [a, b] = inputs;
      const sum = a ^ b;
      const carry = a & b;
      return [sum, carry];
    },
  },
  FULL_ADDER: {
    name: "FULL_ADDER",
    label: "Full Adder",
    shortLabel: "Full Add",
    description:
      "A full adder adds three single-bit inputs: A, B, and a Carry-in (Cin) from a previous stage. It produces a Sum and Carry-out (Cout). Multiple full adders chain together to form a ripple-carry adder.",
    inputLabels: ["A", "B", "Cin"],
    outputLabels: ["Sum", "Cout"],
    gateDelay: 3,
    realWorld:
      "The fundamental building block of ALUs (Arithmetic Logic Units). Chain N full adders to create an N-bit adder. Every addition operation in your CPU ultimately uses full adders at the gate level.",
    evaluate: (inputs) => {
      const [a, b, cin] = inputs;
      const sum = a ^ b ^ cin;
      const cout = (a & b) | (b & cin) | (a & cin);
      return [sum, cout];
    },
  },
};

const CIRCUIT_KEYS: CircuitType[] = [
  "MUX_2_1",
  "MUX_4_1",
  "DECODER_2_4",
  "DECODER_3_8",
  "HALF_ADDER",
  "FULL_ADDER",
];

const SCENARIOS: Scenario[] = [
  { key: "mux-2-1", label: "2:1 MUX", circuit: "MUX_2_1", description: "Basic data selection" },
  { key: "mux-4-1", label: "4:1 MUX", circuit: "MUX_4_1", description: "Multi-input selection" },
  { key: "decoder-2-4", label: "2:4 Decoder", circuit: "DECODER_2_4", description: "Address decoding" },
  { key: "full-adder", label: "Full Adder", circuit: "FULL_ADDER", description: "Binary addition" },
];

function generateTruthTable(circuit: CircuitType): TruthTableEntry[] {
  const info = CIRCUITS[circuit];
  const numInputs = info.inputLabels.length;
  const totalCombinations = Math.pow(2, numInputs);
  const entries: TruthTableEntry[] = [];

  for (let i = 0; i < totalCombinations; i++) {
    const inputs: number[] = [];
    for (let j = 0; j < numInputs; j++) {
      inputs.push((i >> j) & 1);
    }
    const outputs = info.evaluate(inputs);
    entries.push({ inputs, outputs });
  }

  return entries;
}

// ─── Circuit Visualization Component ──────────────────────────────────────────

function CircuitDiagram({
  circuit,
  inputs,
  outputs,
  propagationStep,
  maxPropagation,
}: {
  circuit: CircuitType;
  inputs: number[];
  outputs: number[];
  propagationStep: number;
  maxPropagation: number;
}) {
  const info = CIRCUITS[circuit];
  const inputsActive = propagationStep >= 1;
  const bodyActive = propagationStep >= 2;
  const outputsActive = propagationStep >= maxPropagation;

  const numInputs = info.inputLabels.length;
  const numOutputs = info.outputLabels.length;

  // Determine if this is a MUX, decoder, or adder for layout variations
  const isMux = circuit === "MUX_2_1" || circuit === "MUX_4_1";
  const isDecoder = circuit === "DECODER_2_4" || circuit === "DECODER_3_8";
  const isAdder = circuit === "HALF_ADDER" || circuit === "FULL_ADDER";

  // Categorize inputs for MUX
  const dataInputCount = isMux ? (circuit === "MUX_2_1" ? 2 : 4) : 0;
  const selectInputCount = isMux ? (circuit === "MUX_2_1" ? 1 : 2) : 0;

  const bodyColor = bodyActive
    ? outputs.some((o) => o === 1)
      ? "rgba(16,185,129,0.1)"
      : "rgba(113,113,122,0.06)"
    : "rgba(30,30,46,0.6)";
  const bodyBorder = bodyActive
    ? outputs.some((o) => o === 1)
      ? "rgba(16,185,129,0.3)"
      : "rgba(113,113,122,0.2)"
    : "#2a2a3e";
  const bodyGlow = bodyActive && outputs.some((o) => o === 1)
    ? "0 0 20px rgba(16,185,129,0.15)"
    : "none";

  const bodyHeight = Math.max(180, numInputs * 36, numOutputs * 36);

  return (
    <div className="relative w-full" style={{ height: `${bodyHeight + 40}px` }}>
      {/* Input wires and labels */}
      {info.inputLabels.map((label, idx) => {
        const val = inputs[idx];
        const yPx = 30 + idx * (bodyHeight / numInputs) + (bodyHeight / numInputs) / 2 - 10;
        const wireColor = inputsActive
          ? val
            ? COLORS.wireHigh
            : COLORS.wireLow
          : "#2a2a3e";

        const isSel = isMux && idx >= dataInputCount;
        const labelColor = isSel ? COLORS.secondary : COLORS.accent;

        return (
          <div key={label}>
            {/* Input value bubble */}
            <div
              className="absolute flex items-center justify-center w-8 h-8 rounded-lg font-mono font-bold text-sm transition-all duration-300"
              style={{
                left: "1%",
                top: `${yPx}px`,
                backgroundColor: inputsActive
                  ? val
                    ? "rgba(16,185,129,0.15)"
                    : "rgba(113,113,122,0.1)"
                  : "rgba(30,30,46,0.5)",
                border: `2px solid ${inputsActive ? (val ? "rgba(16,185,129,0.4)" : "rgba(113,113,122,0.2)") : "#2a2a3e"}`,
                color: inputsActive ? (val ? COLORS.wireHigh : COLORS.wireLow) : "#2a2a3e",
              }}
            >
              {val}
            </div>

            {/* Label */}
            <div
              className="absolute text-[10px] font-mono font-semibold"
              style={{ left: "2%", top: `${yPx - 14}px`, color: labelColor }}
            >
              {label}
            </div>

            {/* Wire */}
            <div
              className="absolute h-[3px] rounded-full transition-colors duration-300"
              style={{
                left: "8%",
                top: `${yPx + 14}px`,
                width: "20%",
                backgroundColor: wireColor,
              }}
            />

            {/* Flow indicator */}
            {inputsActive && !bodyActive && (
              <motion.div
                className="absolute"
                style={{ left: "26%", top: `${yPx + 8}px` }}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              >
                <ChevronRight size={14} style={{ color: COLORS.accent }} />
              </motion.div>
            )}
          </div>
        );
      })}

      {/* Circuit body */}
      <motion.div
        className="absolute flex flex-col items-center justify-center rounded-2xl transition-all duration-300"
        style={{
          left: "30%",
          top: "20px",
          width: "36%",
          height: `${bodyHeight}px`,
          backgroundColor: bodyColor,
          border: `2px solid ${bodyBorder}`,
          boxShadow: bodyGlow,
        }}
        animate={bodyActive && !outputsActive ? { scale: [1, 1.02, 1] } : {}}
        transition={{ duration: 0.3 }}
      >
        <span className="text-xl font-bold text-white">{info.shortLabel}</span>
        <span className="text-[10px] mt-1" style={{ color: COLORS.muted }}>
          {isAdder ? "Arithmetic" : isMux ? "Selector" : "Decoder"}
        </span>

        {/* Gate delay indicator */}
        <div className="absolute bottom-3 flex items-center gap-1">
          <Timer size={10} style={{ color: COLORS.muted }} />
          <span className="text-[9px] font-mono" style={{ color: COLORS.muted }}>
            {info.gateDelay} gate delay{info.gateDelay > 1 ? "s" : ""}
          </span>
        </div>

        {/* Internal gate labels */}
        {isAdder && (
          <div className="mt-2 flex flex-col items-center gap-1">
            <div className="px-2 py-0.5 rounded text-[9px] font-mono" style={{ backgroundColor: "rgba(99,102,241,0.1)", color: COLORS.primary, border: "1px solid rgba(99,102,241,0.2)" }}>
              XOR + AND
            </div>
            {circuit === "FULL_ADDER" && (
              <div className="px-2 py-0.5 rounded text-[9px] font-mono" style={{ backgroundColor: "rgba(6,182,212,0.1)", color: COLORS.secondary, border: "1px solid rgba(6,182,212,0.2)" }}>
                + OR
              </div>
            )}
          </div>
        )}

        {isMux && (
          <div className="mt-2 flex flex-col items-center gap-1">
            <div className="px-2 py-0.5 rounded text-[9px] font-mono" style={{ backgroundColor: "rgba(99,102,241,0.1)", color: COLORS.primary, border: "1px solid rgba(99,102,241,0.2)" }}>
              AND + OR
            </div>
          </div>
        )}

        {isDecoder && (
          <div className="mt-2 flex flex-col items-center gap-1">
            <div className="px-2 py-0.5 rounded text-[9px] font-mono" style={{ backgroundColor: "rgba(99,102,241,0.1)", color: COLORS.primary, border: "1px solid rgba(99,102,241,0.2)" }}>
              NOT + AND
            </div>
          </div>
        )}

        {/* MUX select indicator at bottom */}
        {isMux && (
          <div
            className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[9px] font-mono"
            style={{
              backgroundColor: "rgba(6,182,212,0.1)",
              color: COLORS.secondary,
              border: "1px solid rgba(6,182,212,0.2)",
            }}
          >
            SEL
          </div>
        )}

        {/* Input port labels on body */}
        {info.inputLabels.map((label, idx) => {
          const yPx = idx * (bodyHeight / numInputs) + (bodyHeight / numInputs) / 2 - 6;
          return (
            <div
              key={`port-${label}`}
              className="absolute text-[8px] font-mono"
              style={{ left: "6px", top: `${yPx}px`, color: `${COLORS.muted}80` }}
            >
              {label}
            </div>
          );
        })}

        {/* Output port labels on body */}
        {info.outputLabels.map((label, idx) => {
          const yPx = idx * (bodyHeight / numOutputs) + (bodyHeight / numOutputs) / 2 - 6;
          return (
            <div
              key={`port-${label}`}
              className="absolute text-[8px] font-mono"
              style={{ right: "6px", top: `${yPx}px`, color: `${COLORS.muted}80` }}
            >
              {label}
            </div>
          );
        })}
      </motion.div>

      {/* Output wires and labels */}
      {info.outputLabels.map((label, idx) => {
        const val = outputs[idx];
        const yPx = 20 + idx * (bodyHeight / numOutputs) + (bodyHeight / numOutputs) / 2 - 4;
        const wireColor = outputsActive
          ? val
            ? COLORS.wireHigh
            : COLORS.wireLow
          : "#2a2a3e";

        return (
          <div key={label}>
            {/* Wire */}
            <div
              className="absolute h-[3px] rounded-full transition-colors duration-300"
              style={{
                left: "68%",
                top: `${yPx + 4}px`,
                width: "20%",
                backgroundColor: wireColor,
              }}
            />

            {/* Flow indicator */}
            {bodyActive && !outputsActive && (
              <motion.div
                className="absolute"
                style={{ left: "66%", top: `${yPx - 2}px` }}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              >
                <ChevronRight size={14} style={{ color: COLORS.accent }} />
              </motion.div>
            )}

            {/* Output value bubble */}
            <motion.div
              className="absolute flex items-center justify-center w-8 h-8 rounded-lg font-mono font-bold text-sm transition-all duration-300"
              style={{
                right: "1%",
                top: `${yPx - 10}px`,
                backgroundColor: outputsActive
                  ? val
                    ? "rgba(16,185,129,0.15)"
                    : "rgba(113,113,122,0.1)"
                  : "rgba(30,30,46,0.5)",
                border: `2px solid ${outputsActive ? (val ? "rgba(16,185,129,0.4)" : "rgba(113,113,122,0.2)") : "#2a2a3e"}`,
                color: outputsActive ? (val ? COLORS.wireHigh : COLORS.wireLow) : "#2a2a3e",
              }}
              animate={outputsActive && propagationStep === maxPropagation ? { scale: [1, 1.1, 1] } : {}}
              transition={{ duration: 0.3 }}
            >
              {outputsActive ? val : "?"}
            </motion.div>

            {/* Label */}
            <div
              className="absolute text-[10px] font-mono font-semibold"
              style={{ right: "2%", top: `${yPx - 22}px`, color: COLORS.success }}
            >
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Truth Table Component ────────────────────────────────────────────────────

function TruthTableDisplay({
  circuit,
  currentInputs,
  highlight,
}: {
  circuit: CircuitType;
  currentInputs: number[];
  highlight: boolean;
}) {
  const info = CIRCUITS[circuit];
  const entries = generateTruthTable(circuit);

  // Limit displayed rows for large truth tables
  const maxDisplayed = 16;
  const displayed = entries.slice(0, maxDisplayed);
  const hasMore = entries.length > maxDisplayed;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: COLORS.border }}>
        <div className="flex items-center gap-2">
          <Table2 size={14} style={{ color: COLORS.secondary }} />
          <span className="text-sm font-semibold text-white">Truth Table</span>
        </div>
        <span className="text-[10px] font-mono" style={{ color: COLORS.muted }}>
          {entries.length} rows
        </span>
      </div>
      <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "320px" }}>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b" style={{ borderColor: COLORS.border }}>
              {info.inputLabels.map((label) => (
                <th key={label} className="px-2 py-1.5 text-center font-mono font-medium" style={{ color: COLORS.accent }}>
                  {label}
                </th>
              ))}
              <th className="px-1 py-1.5 text-center" style={{ color: COLORS.border }}>|</th>
              {info.outputLabels.map((label) => (
                <th key={label} className="px-2 py-1.5 text-center font-mono font-medium" style={{ color: COLORS.success }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map((entry, idx) => {
              const isActive =
                highlight &&
                entry.inputs.every((v, i) => v === currentInputs[i]);

              return (
                <tr
                  key={idx}
                  className="border-b transition-colors duration-150"
                  style={{
                    borderColor: `${COLORS.border}50`,
                    background: isActive ? "rgba(99,102,241,0.08)" : "transparent",
                  }}
                >
                  {entry.inputs.map((val, i) => (
                    <td key={i} className="px-2 py-1.5 text-center font-mono font-bold" style={{ color: val ? COLORS.wireHigh : COLORS.wireLow }}>
                      {val}
                    </td>
                  ))}
                  <td className="px-1 py-1.5 text-center" style={{ color: COLORS.border }}>|</td>
                  {entry.outputs.map((val, i) => (
                    <td key={i} className="px-2 py-1.5 text-center">
                      <span
                        className="inline-flex items-center justify-center w-5 h-5 rounded font-mono font-bold text-[10px]"
                        style={{
                          backgroundColor: val ? "rgba(16,185,129,0.15)" : "rgba(113,113,122,0.08)",
                          color: val ? COLORS.wireHigh : COLORS.wireLow,
                          border: isActive ? `1px solid ${COLORS.primary}` : "1px solid transparent",
                        }}
                      >
                        {val}
                      </span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {hasMore && (
          <div className="px-3 py-2 text-center text-[10px]" style={{ color: COLORS.muted }}>
            ... and {entries.length - maxDisplayed} more rows
          </div>
        )}
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

export default function CombinationalPage() {
  // ── Core state ────────────────────────────────────────────────────────────
  const [selectedCircuit, setSelectedCircuit] = useState<CircuitType>("MUX_2_1");
  const [inputs, setInputs] = useState<number[]>([0, 0, 0]);
  const [outputs, setOutputs] = useState<number[]>([0]);
  const [propagationStep, setPropagationStep] = useState(3);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey>("mux-2-1");
  const [showMetrics, setShowMetrics] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  // ── Metrics state ─────────────────────────────────────────────────────────
  const [stepCount, setStepCount] = useState(0);
  const [combinationIndex, setCombinationIndex] = useState(0);

  // ── Auto-play state ───────────────────────────────────────────────────────
  const [autoPlayComboIndex, setAutoPlayComboIndex] = useState(0);
  const [autoPlayPhase, setAutoPlayPhase] = useState(0);

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
  const currentCircuitInfo = CIRCUITS[selectedCircuit];
  const maxPropagation = currentCircuitInfo.gateDelay + 1; // +1 for output phase

  // ── Input toggling ────────────────────────────────────────────────────────
  const handleToggleInput = useCallback(
    (idx: number) => {
      setInputs((prev) => {
        const next = [...prev];
        next[idx] = next[idx] === 0 ? 1 : 0;
        return next;
      });
      // Trigger propagation animation
      setPropagationStep(0);
      setTimeout(() => setPropagationStep(1), 80);
      setTimeout(() => setPropagationStep(2), 250);
      setTimeout(() => {
        setPropagationStep(maxPropagation);
      }, 450);
    },
    [maxPropagation]
  );

  // Recompute outputs when inputs change
  useEffect(() => {
    const newOutputs = currentCircuitInfo.evaluate(inputs);
    setOutputs(newOutputs);
  }, [inputs, currentCircuitInfo]);

  // ── Select circuit ────────────────────────────────────────────────────────
  const handleSelectCircuit = useCallback((circuit: CircuitType) => {
    setSelectedCircuit(circuit);
    const info = CIRCUITS[circuit];
    const newInputs = new Array(info.inputLabels.length).fill(0);
    setInputs(newInputs);
    setOutputs(info.evaluate(newInputs));
    setPropagationStep(maxPropagation);
    setCombinationIndex(0);
  }, [maxPropagation]);

  // ── Step forward (auto-play logic) ────────────────────────────────────────
  const stepForward = useCallback(() => {
    const scenario = SCENARIOS.find((s) => s.key === selectedScenario)!;
    const circuitInfo = CIRCUITS[scenario.circuit];
    const numInputs = circuitInfo.inputLabels.length;
    const totalCombinations = Math.pow(2, numInputs);
    const maxProp = circuitInfo.gateDelay + 1;

    if (autoPlayComboIndex >= totalCombinations) {
      setIsComplete(true);
      setIsPlaying(false);
      return false;
    }

    if (autoPlayPhase === 0) {
      // Set inputs for current combination
      const newInputs: number[] = [];
      for (let j = 0; j < numInputs; j++) {
        newInputs.push((autoPlayComboIndex >> j) & 1);
      }
      setInputs(newInputs);
      setOutputs(circuitInfo.evaluate(newInputs));
      setPropagationStep(0);
      setCombinationIndex(autoPlayComboIndex + 1);
      setAutoPlayPhase(1);
      setStepCount((prev) => prev + 1);
      return true;
    }

    if (autoPlayPhase <= maxProp) {
      // Advance propagation
      setPropagationStep(autoPlayPhase);
      setAutoPlayPhase((prev) => prev + 1);
      setStepCount((prev) => prev + 1);
      return true;
    }

    // Propagation complete, move to next combination
    setAutoPlayComboIndex((prev) => prev + 1);
    setAutoPlayPhase(0);

    if (autoPlayComboIndex + 1 >= totalCombinations) {
      setIsComplete(true);
      setIsPlaying(false);
      return false;
    }
    return true;
  }, [selectedScenario, autoPlayComboIndex, autoPlayPhase]);

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

    // Ensure correct circuit selected
    const scenario = SCENARIOS.find((s) => s.key === selectedScenario)!;
    if (selectedCircuit !== scenario.circuit) {
      handleSelectCircuit(scenario.circuit);
    }

    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop, isComplete, selectedScenario, selectedCircuit, handleSelectCircuit]);

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

    const scenario = SCENARIOS.find((s) => s.key === selectedScenario)!;
    if (selectedCircuit !== scenario.circuit) {
      handleSelectCircuit(scenario.circuit);
    }

    stepForward();
  }, [handlePause, stepForward, isComplete, selectedScenario, selectedCircuit, handleSelectCircuit]);

  const handleReset = useCallback(() => {
    handlePause();
    const scenario = SCENARIOS.find((s) => s.key === selectedScenario)!;
    const circuitInfo = CIRCUITS[scenario.circuit];
    setSelectedCircuit(scenario.circuit);
    const newInputs = new Array(circuitInfo.inputLabels.length).fill(0);
    setInputs(newInputs);
    setOutputs(circuitInfo.evaluate(newInputs));
    setPropagationStep(circuitInfo.gateDelay + 1);
    setAutoPlayComboIndex(0);
    setAutoPlayPhase(0);
    setStepCount(0);
    setCombinationIndex(0);
    setIsComplete(false);
  }, [handlePause, selectedScenario]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Reset when scenario changes
  useEffect(() => {
    handlePause();
    const scenario = SCENARIOS.find((s) => s.key === selectedScenario)!;
    const circuitInfo = CIRCUITS[scenario.circuit];
    setSelectedCircuit(scenario.circuit);
    const newInputs = new Array(circuitInfo.inputLabels.length).fill(0);
    setInputs(newInputs);
    setOutputs(circuitInfo.evaluate(newInputs));
    setPropagationStep(circuitInfo.gateDelay + 1);
    setAutoPlayComboIndex(0);
    setAutoPlayPhase(0);
    setStepCount(0);
    setCombinationIndex(0);
    setIsComplete(false);
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
                1.3
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Combinational Circuits
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Explore circuits where the output depends only on the current inputs. Watch signals propagate through
              multiplexers, decoders, and adders -- the building blocks that route data and perform arithmetic in every processor.
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
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium"
                style={{
                  background: "rgba(245,158,11,0.08)",
                  color: COLORS.accent,
                  border: "1px solid rgba(245,158,11,0.15)",
                }}
              >
                <Zap size={11} />
                Prerequisite: Logic Gates
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

            {/* Circuit selector buttons */}
            <div className="flex items-center gap-1 flex-wrap">
              {CIRCUIT_KEYS.map((circuit) => (
                <button
                  key={circuit}
                  onClick={() => handleSelectCircuit(circuit)}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: selectedCircuit === circuit ? "rgba(99,102,241,0.15)" : COLORS.card,
                    color: selectedCircuit === circuit ? COLORS.primary : "#a1a1aa",
                    border: selectedCircuit === circuit ? "1px solid rgba(99,102,241,0.3)" : `1px solid ${COLORS.border}`,
                  }}
                >
                  {CIRCUITS[circuit].shortLabel}
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
            {/* Circuit visualization */}
            <div
              className="lg:col-span-2 rounded-2xl overflow-hidden relative"
              style={{
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
                boxShadow: "0 0 0 1px rgba(99,102,241,0.03), 0 20px 50px -12px rgba(0,0,0,0.5)",
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: COLORS.border }}>
                <div className="flex items-center gap-2">
                  <CircuitBoard size={14} style={{ color: COLORS.primary }} />
                  <span className="text-sm font-semibold text-white">{currentCircuitInfo.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono" style={{ color: COLORS.secondary }}>
                    Gate Delay: {currentCircuitInfo.gateDelay}
                  </span>
                  <span className="text-xs font-mono" style={{ color: COLORS.muted }}>
                    {currentCircuitInfo.inputLabels.length} in / {currentCircuitInfo.outputLabels.length} out
                  </span>
                </div>
              </div>

              {/* Diagram */}
              <div className="px-6 py-4">
                <CircuitDiagram
                  circuit={selectedCircuit}
                  inputs={inputs}
                  outputs={outputs}
                  propagationStep={propagationStep}
                  maxPropagation={maxPropagation}
                />
              </div>

              {/* Input toggles */}
              <div className="flex items-center justify-center gap-3 flex-wrap px-5 py-4 border-t" style={{ borderColor: COLORS.border }}>
                {currentCircuitInfo.inputLabels.map((label, idx) => {
                  const isMux = selectedCircuit === "MUX_2_1" || selectedCircuit === "MUX_4_1";
                  const dataCount = selectedCircuit === "MUX_2_1" ? 2 : selectedCircuit === "MUX_4_1" ? 4 : 0;
                  const isSelect = isMux && idx >= dataCount;
                  const isEnable = (selectedCircuit === "DECODER_2_4" || selectedCircuit === "DECODER_3_8") && label === "E";

                  const btnColor = isSelect
                    ? COLORS.secondary
                    : isEnable
                    ? COLORS.accent
                    : inputs[idx]
                    ? COLORS.wireHigh
                    : COLORS.wireLow;

                  return (
                    <button
                      key={label}
                      onClick={() => handleToggleInput(idx)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                      style={{
                        background: inputs[idx]
                          ? isSelect
                            ? "rgba(6,182,212,0.1)"
                            : isEnable
                            ? "rgba(245,158,11,0.1)"
                            : "rgba(16,185,129,0.1)"
                          : "rgba(113,113,122,0.08)",
                        border: `1px solid ${inputs[idx]
                          ? isSelect
                            ? "rgba(6,182,212,0.3)"
                            : isEnable
                            ? "rgba(245,158,11,0.3)"
                            : "rgba(16,185,129,0.3)"
                          : "rgba(113,113,122,0.15)"
                        }`,
                        color: btnColor,
                      }}
                    >
                      {inputs[idx] ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      {label}: {inputs[idx]}
                    </button>
                  );
                })}

                <div className="w-px h-6" style={{ backgroundColor: COLORS.border }} />

                {/* Output display */}
                {currentCircuitInfo.outputLabels.map((label, idx) => (
                  <div
                    key={label}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-mono font-bold"
                    style={{
                      background: outputs[idx] ? "rgba(16,185,129,0.12)" : "rgba(113,113,122,0.06)",
                      border: `1px solid ${outputs[idx] ? "rgba(16,185,129,0.25)" : "rgba(113,113,122,0.12)"}`,
                      color: outputs[idx] ? COLORS.wireHigh : COLORS.wireLow,
                    }}
                  >
                    <Activity size={12} />
                    {label}: {outputs[idx]}
                  </div>
                ))}
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
                      label="Input Combo"
                      value={`${combinationIndex} / ${Math.pow(2, currentCircuitInfo.inputLabels.length)}`}
                      color={COLORS.accent}
                    />
                    <MetricBadge
                      icon={<Timer size={12} />}
                      label="Gate Delay"
                      value={currentCircuitInfo.gateDelay}
                      color={COLORS.secondary}
                    />
                    <MetricBadge
                      icon={<Layers size={12} />}
                      label="Prop. Steps"
                      value={stepCount}
                      color={COLORS.primary}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Right panel: truth table + info */}
            <div className="lg:col-span-1 space-y-3">
              <TruthTableDisplay
                circuit={selectedCircuit}
                currentInputs={inputs}
                highlight={propagationStep >= maxPropagation}
              />

              {/* Circuit info card */}
              <div className="rounded-xl p-3" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
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
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.secondary }} />
                    <span className="text-[11px]" style={{ color: COLORS.muted }}>Select</span>
                  </div>
                </div>
              </div>

              {/* Quick circuit selector */}
              <div className="rounded-xl overflow-hidden" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
                <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: COLORS.border }}>
                  <CircuitBoard size={12} style={{ color: COLORS.primary }} />
                  <span className="text-xs font-semibold text-white">All Circuits</span>
                </div>
                <div className="p-2">
                  {CIRCUIT_KEYS.map((circuit) => {
                    const cInfo = CIRCUITS[circuit];
                    const isActive = circuit === selectedCircuit;
                    return (
                      <button
                        key={circuit}
                        onClick={() => handleSelectCircuit(circuit)}
                        className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-all duration-150"
                        style={{
                          background: isActive ? "rgba(99,102,241,0.08)" : "transparent",
                          color: isActive ? COLORS.primary : "#a1a1aa",
                        }}
                      >
                        <span className="text-xs font-semibold">{cInfo.shortLabel}</span>
                        <span className="text-[9px] font-mono" style={{ color: COLORS.muted }}>
                          {cInfo.inputLabels.length}in/{cInfo.outputLabels.length}out
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
                Understanding the {currentCircuitInfo.label}
              </span>
            </div>

            <div className="p-5 space-y-4">
              {/* Description */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: COLORS.secondary }}>
                  How It Works
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#a1a1aa" }}>
                  {currentCircuitInfo.description}
                </p>
              </div>

              {/* Computation details */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: COLORS.accent }}>
                  Current Computation
                </h3>
                <div
                  className="rounded-xl p-4 font-mono text-sm"
                  style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.1)" }}
                >
                  <div className="flex flex-wrap gap-4">
                    <div>
                      <span style={{ color: COLORS.muted }}>Inputs: </span>
                      {currentCircuitInfo.inputLabels.map((label, idx) => (
                        <span key={label}>
                          <span style={{ color: COLORS.accent }}>{label}</span>
                          <span style={{ color: inputs[idx] ? COLORS.wireHigh : COLORS.wireLow }}>={inputs[idx]}</span>
                          {idx < currentCircuitInfo.inputLabels.length - 1 && <span style={{ color: COLORS.muted }}>, </span>}
                        </span>
                      ))}
                    </div>
                    <div>
                      <span style={{ color: COLORS.muted }}>Outputs: </span>
                      {currentCircuitInfo.outputLabels.map((label, idx) => (
                        <span key={label}>
                          <span style={{ color: COLORS.success }}>{label}</span>
                          <span style={{ color: outputs[idx] ? COLORS.wireHigh : COLORS.wireLow }}>={outputs[idx]}</span>
                          {idx < currentCircuitInfo.outputLabels.length - 1 && <span style={{ color: COLORS.muted }}>, </span>}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Circuit-specific explanation */}
                  <div className="mt-3 text-xs" style={{ color: "#a1a1aa" }}>
                    {(selectedCircuit === "MUX_2_1" || selectedCircuit === "MUX_4_1") && (
                      <>
                        Select lines choose input D
                        {selectedCircuit === "MUX_2_1"
                          ? inputs[2]
                          : inputs[5] * 2 + inputs[4]}
                        {" = "}
                        <span style={{ color: COLORS.wireHigh }}>
                          {selectedCircuit === "MUX_2_1"
                            ? inputs[inputs[2]]
                            : inputs[inputs[5] * 2 + inputs[4]]}
                        </span>
                        {" as output"}
                      </>
                    )}
                    {selectedCircuit === "DECODER_2_4" && (
                      <>
                        {inputs[2] === 1
                          ? `Enable=1, binary input ${inputs[1]}${inputs[0]} = ${inputs[1] * 2 + inputs[0]}, so Y${inputs[1] * 2 + inputs[0]}=1`
                          : "Enable=0, all outputs disabled"}
                      </>
                    )}
                    {selectedCircuit === "DECODER_3_8" && (
                      <>
                        {inputs[3] === 1
                          ? `Enable=1, binary input ${inputs[2]}${inputs[1]}${inputs[0]} = ${inputs[2] * 4 + inputs[1] * 2 + inputs[0]}, so Y${inputs[2] * 4 + inputs[1] * 2 + inputs[0]}=1`
                          : "Enable=0, all outputs disabled"}
                      </>
                    )}
                    {selectedCircuit === "HALF_ADDER" && (
                      <>
                        {inputs[0]} + {inputs[1]} = Sum:{inputs[0] ^ inputs[1]}, Carry:{inputs[0] & inputs[1]}
                        {" (decimal: "}
                        {inputs[0] + inputs[1]}
                        {")"}
                      </>
                    )}
                    {selectedCircuit === "FULL_ADDER" && (
                      <>
                        {inputs[0]} + {inputs[1]} + Cin:{inputs[2]} = Sum:{inputs[0] ^ inputs[1] ^ inputs[2]},
                        Cout:{((inputs[0] & inputs[1]) | (inputs[1] & inputs[2]) | (inputs[0] & inputs[2]))}
                        {" (decimal: "}
                        {inputs[0] + inputs[1] + inputs[2]}
                        {")"}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Real-world uses */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: COLORS.success }}>
                  Real-World Applications
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#a1a1aa" }}>
                  {currentCircuitInfo.realWorld}
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
                      {selectedCircuit === "MUX_2_1"
                        ? "A 2:1 MUX can implement ANY single-variable Boolean function. The select line acts as the variable, and the data inputs define the function's output for each value. This is why FPGAs use MUX-based lookup tables."
                        : selectedCircuit === "MUX_4_1"
                        ? "A 4:1 MUX can implement ANY two-variable Boolean function without additional gates. Set the data inputs to the desired truth table outputs and use the select lines as variables. This is the basis of FPGA LUT architecture."
                        : selectedCircuit === "DECODER_2_4"
                        ? "A decoder generates all minterms of its input variables. Combined with OR gates, a decoder can implement ANY Boolean function. This 'decoder + OR' approach is a systematic way to build any combinational circuit."
                        : selectedCircuit === "DECODER_3_8"
                        ? "Larger decoders are built hierarchically. A 3:8 decoder uses two 2:4 decoders where the extra input controls which sub-decoder is enabled. This tree structure scales to any size needed for memory systems."
                        : selectedCircuit === "HALF_ADDER"
                        ? "The half adder reveals a fundamental relationship: addition at the bit level is just XOR (for the sum) and AND (for the carry). This is why XOR gates are essential in arithmetic circuits."
                        : "The full adder is the core of all multi-bit arithmetic. Chain N full adders, connecting each Cout to the next Cin, to create an N-bit ripple-carry adder. The propagation delay grows linearly, which is why real CPUs use carry-lookahead adders for speed."}
                    </span>
                  </div>
                </div>
              </div>

              {/* Circuit comparison table */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: COLORS.muted }}>
                  Circuit Comparison
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b" style={{ borderColor: COLORS.border }}>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>Circuit</th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>Inputs</th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>Outputs</th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>Gate Delay</th>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CIRCUIT_KEYS.map((circuit) => {
                        const cInfo = CIRCUITS[circuit];
                        const isActive = circuit === selectedCircuit;
                        const category =
                          circuit === "MUX_2_1" || circuit === "MUX_4_1"
                            ? "Data Routing"
                            : circuit === "DECODER_2_4" || circuit === "DECODER_3_8"
                            ? "Address Decoding"
                            : "Arithmetic";

                        return (
                          <tr
                            key={circuit}
                            className="border-b transition-colors duration-150 cursor-pointer"
                            style={{
                              borderColor: `${COLORS.border}50`,
                              background: isActive ? "rgba(99,102,241,0.04)" : "transparent",
                            }}
                            onClick={() => handleSelectCircuit(circuit)}
                          >
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                {isActive && <div className="w-1.5 h-1.5 rounded-full" style={{ background: COLORS.primary }} />}
                                <span className="font-semibold" style={{ color: isActive ? "#ffffff" : "#a1a1aa" }}>
                                  {cInfo.shortLabel}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center font-mono" style={{ color: COLORS.accent }}>
                              {cInfo.inputLabels.length}
                            </td>
                            <td className="px-3 py-2 text-center font-mono" style={{ color: COLORS.success }}>
                              {cInfo.outputLabels.length}
                            </td>
                            <td className="px-3 py-2 text-center font-mono" style={{ color: COLORS.secondary }}>
                              {cInfo.gateDelay}
                            </td>
                            <td className="px-3 py-2" style={{ color: "#a1a1aa" }}>
                              {category}
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
