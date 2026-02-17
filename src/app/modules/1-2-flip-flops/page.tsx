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
  Clock,
  ArrowUpDown,
  BarChart3,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

type FlipFlopType = "SR" | "D" | "JK" | "T";

interface FlipFlopInfo {
  name: FlipFlopType;
  label: string;
  description: string;
  inputs: string[];
  realWorld: string;
  evaluate: (inputs: Record<string, number>, currentQ: number) => { q: number; invalid: boolean };
}

type ScenarioKey = "sr-latch" | "d-flipflop" | "jk-toggle" | "t-counter";

interface Scenario {
  key: ScenarioKey;
  label: string;
  flipFlop: FlipFlopType;
  description: string;
  sequence: Record<string, number>[];
}

interface TimingEntry {
  cycle: number;
  clock: number;
  inputs: Record<string, number>;
  q: number;
  qBar: number;
  invalid: boolean;
}

interface TransitionRow {
  inputs: Record<string, number>;
  currentQ: number;
  nextQ: string;
  description: string;
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
  clock: "#06b6d4",
  qHigh: "#10b981",
  qLow: "#71717a",
  invalid: "#ef4444",
};

const FLIP_FLOPS: Record<FlipFlopType, FlipFlopInfo> = {
  SR: {
    name: "SR",
    label: "SR Latch",
    description:
      "The Set-Reset latch is the simplest memory element. Setting S=1 stores a 1 (sets Q=1), setting R=1 stores a 0 (resets Q=0). When both S and R are 0, the latch holds its previous state. S=1, R=1 is an invalid/forbidden condition that leads to an unpredictable state.",
    inputs: ["S", "R"],
    realWorld:
      "Used in debouncing circuits for mechanical switches, alarm systems (set by trigger, reset manually), and as building blocks for more complex flip-flops.",
    evaluate: (inputs, currentQ) => {
      const s = inputs["S"] || 0;
      const r = inputs["R"] || 0;
      if (s === 1 && r === 1) return { q: currentQ, invalid: true };
      if (s === 1) return { q: 1, invalid: false };
      if (r === 1) return { q: 0, invalid: false };
      return { q: currentQ, invalid: false };
    },
  },
  D: {
    name: "D",
    label: "D Flip-Flop",
    description:
      "The Data flip-flop captures the value of the D input at the moment of a clock edge. Whatever value D has when the clock transitions, that value is stored in Q. It eliminates the invalid state problem of the SR latch by ensuring S and R are always complementary.",
    inputs: ["D"],
    realWorld:
      "The most widely used flip-flop in digital design. Found in registers, shift registers, data pipelines, and virtually every synchronous digital circuit.",
    evaluate: (inputs, _currentQ) => {
      const d = inputs["D"] || 0;
      return { q: d, invalid: false };
    },
  },
  JK: {
    name: "JK",
    label: "JK Flip-Flop",
    description:
      "The JK flip-flop is an improved version of the SR flip-flop that resolves the invalid state. J acts like Set and K acts like Reset. When both J=1 and K=1, instead of being invalid, the output toggles to its complement.",
    inputs: ["J", "K"],
    realWorld:
      "Used in frequency dividers, counters, and toggle circuits. The toggle mode (J=K=1) makes it ideal for building binary counters.",
    evaluate: (inputs, currentQ) => {
      const j = inputs["J"] || 0;
      const k = inputs["K"] || 0;
      if (j === 0 && k === 0) return { q: currentQ, invalid: false };
      if (j === 0 && k === 1) return { q: 0, invalid: false };
      if (j === 1 && k === 0) return { q: 1, invalid: false };
      // j === 1 && k === 1: toggle
      return { q: currentQ === 0 ? 1 : 0, invalid: false };
    },
  },
  T: {
    name: "T",
    label: "T Flip-Flop",
    description:
      "The Toggle flip-flop has a single input T. When T=1, the output toggles on each clock edge (0 becomes 1, 1 becomes 0). When T=0, the output holds its current state. It is equivalent to a JK flip-flop with J and K tied together.",
    inputs: ["T"],
    realWorld:
      "Essential for building binary counters and frequency dividers. A chain of T flip-flops with T=1 creates a binary counter that counts clock pulses.",
    evaluate: (inputs, currentQ) => {
      const t = inputs["T"] || 0;
      if (t === 1) return { q: currentQ === 0 ? 1 : 0, invalid: false };
      return { q: currentQ, invalid: false };
    },
  },
};

const FLIP_FLOP_KEYS: FlipFlopType[] = ["SR", "D", "JK", "T"];

const SCENARIOS: Scenario[] = [
  {
    key: "sr-latch",
    label: "SR Latch",
    flipFlop: "SR",
    description: "Set-Reset behavior with forbidden state",
    sequence: [
      { S: 1, R: 0 },
      { S: 0, R: 0 },
      { S: 0, R: 1 },
      { S: 0, R: 0 },
      { S: 1, R: 0 },
      { S: 1, R: 1 },
      { S: 0, R: 1 },
      { S: 0, R: 0 },
    ],
  },
  {
    key: "d-flipflop",
    label: "D Flip-Flop",
    flipFlop: "D",
    description: "Data capture on clock edge",
    sequence: [
      { D: 1 },
      { D: 0 },
      { D: 1 },
      { D: 1 },
      { D: 0 },
      { D: 0 },
      { D: 1 },
      { D: 0 },
    ],
  },
  {
    key: "jk-toggle",
    label: "JK Toggle",
    flipFlop: "JK",
    description: "Toggle mode and all JK combinations",
    sequence: [
      { J: 1, K: 0 },
      { J: 0, K: 0 },
      { J: 1, K: 1 },
      { J: 1, K: 1 },
      { J: 0, K: 1 },
      { J: 0, K: 0 },
      { J: 1, K: 1 },
      { J: 1, K: 0 },
    ],
  },
  {
    key: "t-counter",
    label: "T Counter",
    flipFlop: "T",
    description: "Binary counting with toggle flip-flop",
    sequence: [
      { T: 1 },
      { T: 1 },
      { T: 1 },
      { T: 1 },
      { T: 0 },
      { T: 1 },
      { T: 1 },
      { T: 0 },
    ],
  },
];

function getTransitionTable(ffType: FlipFlopType): TransitionRow[] {
  switch (ffType) {
    case "SR":
      return [
        { inputs: { S: 0, R: 0 }, currentQ: 0, nextQ: "0 (Hold)", description: "No change" },
        { inputs: { S: 0, R: 0 }, currentQ: 1, nextQ: "1 (Hold)", description: "No change" },
        { inputs: { S: 0, R: 1 }, currentQ: 0, nextQ: "0 (Reset)", description: "Reset to 0" },
        { inputs: { S: 0, R: 1 }, currentQ: 1, nextQ: "0 (Reset)", description: "Reset to 0" },
        { inputs: { S: 1, R: 0 }, currentQ: 0, nextQ: "1 (Set)", description: "Set to 1" },
        { inputs: { S: 1, R: 0 }, currentQ: 1, nextQ: "1 (Set)", description: "Set to 1" },
        { inputs: { S: 1, R: 1 }, currentQ: 0, nextQ: "X (Invalid)", description: "Forbidden" },
        { inputs: { S: 1, R: 1 }, currentQ: 1, nextQ: "X (Invalid)", description: "Forbidden" },
      ];
    case "D":
      return [
        { inputs: { D: 0 }, currentQ: 0, nextQ: "0", description: "Capture 0" },
        { inputs: { D: 0 }, currentQ: 1, nextQ: "0", description: "Capture 0" },
        { inputs: { D: 1 }, currentQ: 0, nextQ: "1", description: "Capture 1" },
        { inputs: { D: 1 }, currentQ: 1, nextQ: "1", description: "Capture 1" },
      ];
    case "JK":
      return [
        { inputs: { J: 0, K: 0 }, currentQ: 0, nextQ: "0 (Hold)", description: "No change" },
        { inputs: { J: 0, K: 0 }, currentQ: 1, nextQ: "1 (Hold)", description: "No change" },
        { inputs: { J: 0, K: 1 }, currentQ: 0, nextQ: "0 (Reset)", description: "Reset" },
        { inputs: { J: 0, K: 1 }, currentQ: 1, nextQ: "0 (Reset)", description: "Reset" },
        { inputs: { J: 1, K: 0 }, currentQ: 0, nextQ: "1 (Set)", description: "Set" },
        { inputs: { J: 1, K: 0 }, currentQ: 1, nextQ: "1 (Set)", description: "Set" },
        { inputs: { J: 1, K: 1 }, currentQ: 0, nextQ: "1 (Toggle)", description: "Toggle" },
        { inputs: { J: 1, K: 1 }, currentQ: 1, nextQ: "0 (Toggle)", description: "Toggle" },
      ];
    case "T":
      return [
        { inputs: { T: 0 }, currentQ: 0, nextQ: "0 (Hold)", description: "No change" },
        { inputs: { T: 0 }, currentQ: 1, nextQ: "1 (Hold)", description: "No change" },
        { inputs: { T: 1 }, currentQ: 0, nextQ: "1 (Toggle)", description: "Toggle" },
        { inputs: { T: 1 }, currentQ: 1, nextQ: "0 (Toggle)", description: "Toggle" },
      ];
  }
}

// ─── Timing Diagram Component ─────────────────────────────────────────────────

function TimingDiagram({ entries, maxVisible }: { entries: TimingEntry[]; maxVisible: number }) {
  const visible = entries.slice(-maxVisible);
  const cellWidth = 60;
  const rowHeight = 32;
  const labelWidth = 50;

  const rows = [
    { label: "CLK", key: "clock" as const, color: COLORS.clock },
    { label: "Q", key: "q" as const, color: COLORS.qHigh },
    { label: "Q'", key: "qBar" as const, color: COLORS.muted },
  ];

  // Determine input labels from entries
  const inputKeys: string[] = visible.length > 0 ? Object.keys(visible[0].inputs) : [];

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: `${labelWidth + visible.length * cellWidth + 20}px` }}>
        {/* Input signal rows */}
        {inputKeys.map((inputKey) => (
          <div key={inputKey} className="flex items-center" style={{ height: rowHeight }}>
            <div
              className="flex-shrink-0 text-xs font-mono font-semibold text-right pr-2"
              style={{ width: labelWidth, color: COLORS.accent }}
            >
              {inputKey}
            </div>
            <div className="flex">
              {visible.map((entry, idx) => {
                const val = entry.inputs[inputKey] || 0;
                const prevVal = idx > 0 ? (visible[idx - 1].inputs[inputKey] || 0) : 0;
                const hasTransition = idx > 0 && val !== prevVal;
                return (
                  <div
                    key={idx}
                    className="relative flex-shrink-0"
                    style={{ width: cellWidth, height: rowHeight }}
                  >
                    {/* Transition line */}
                    {hasTransition && (
                      <div
                        className="absolute left-0 w-[2px]"
                        style={{
                          top: "4px",
                          height: rowHeight - 8,
                          backgroundColor: COLORS.accent,
                        }}
                      />
                    )}
                    {/* Signal level */}
                    <div
                      className="absolute left-0 right-0 h-[2px]"
                      style={{
                        top: val ? "4px" : `${rowHeight - 6}px`,
                        backgroundColor: val ? COLORS.accent : `${COLORS.accent}50`,
                      }}
                    />
                    {/* Value label */}
                    <div
                      className="absolute text-[9px] font-mono"
                      style={{
                        left: cellWidth / 2 - 4,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: val ? COLORS.accent : COLORS.muted,
                      }}
                    >
                      {val}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Clock, Q, Q' rows */}
        {rows.map((row) => (
          <div key={row.key} className="flex items-center" style={{ height: rowHeight }}>
            <div
              className="flex-shrink-0 text-xs font-mono font-semibold text-right pr-2"
              style={{ width: labelWidth, color: row.color }}
            >
              {row.label}
            </div>
            <div className="flex">
              {visible.map((entry, idx) => {
                const val = entry[row.key];
                const prevVal = idx > 0 ? visible[idx - 1][row.key] : 0;
                const hasTransition = idx > 0 && val !== prevVal;
                const isInvalid = entry.invalid && (row.key === "q" || row.key === "qBar");

                const signalColor = isInvalid
                  ? COLORS.invalid
                  : row.key === "clock"
                  ? COLORS.clock
                  : val
                  ? COLORS.qHigh
                  : COLORS.qLow;

                return (
                  <div
                    key={idx}
                    className="relative flex-shrink-0"
                    style={{ width: cellWidth, height: rowHeight }}
                  >
                    {hasTransition && (
                      <div
                        className="absolute left-0 w-[2px]"
                        style={{
                          top: "4px",
                          height: rowHeight - 8,
                          backgroundColor: signalColor,
                        }}
                      />
                    )}
                    <div
                      className="absolute left-0 right-0 h-[2px]"
                      style={{
                        top: val ? "4px" : `${rowHeight - 6}px`,
                        backgroundColor: isInvalid ? COLORS.invalid : val ? signalColor : `${signalColor}50`,
                      }}
                    />
                    {isInvalid && (
                      <div
                        className="absolute text-[9px] font-mono font-bold"
                        style={{
                          left: cellWidth / 2 - 3,
                          top: "50%",
                          transform: "translateY(-50%)",
                          color: COLORS.invalid,
                        }}
                      >
                        X
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Cycle numbers */}
        <div className="flex items-center" style={{ height: 20 }}>
          <div style={{ width: labelWidth }} />
          <div className="flex">
            {visible.map((entry, idx) => (
              <div
                key={idx}
                className="flex-shrink-0 text-center text-[9px] font-mono"
                style={{ width: cellWidth, color: COLORS.muted }}
              >
                {entry.cycle}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Flip-Flop Visualization Component ────────────────────────────────────────

function FlipFlopDiagram({
  ffType,
  inputs,
  q,
  qBar,
  invalid,
  clockPhase,
}: {
  ffType: FlipFlopType;
  inputs: Record<string, number>;
  q: number;
  qBar: number;
  invalid: boolean;
  clockPhase: number; // 0=low, 1=rising, 2=high, 3=falling
}) {
  const ffInfo = FLIP_FLOPS[ffType];
  const inputNames = ffInfo.inputs;

  const clockColor =
    clockPhase === 1 || clockPhase === 2
      ? COLORS.clock
      : `${COLORS.clock}60`;

  const qColor = invalid ? COLORS.invalid : q ? COLORS.qHigh : COLORS.qLow;
  const qBarColor = invalid ? COLORS.invalid : qBar ? COLORS.qHigh : COLORS.qLow;

  return (
    <div className="relative w-full" style={{ height: "240px" }}>
      {/* Input wires and labels */}
      {inputNames.map((name, idx) => {
        const yPercent = inputNames.length === 1 ? 35 : 25 + idx * 25;
        const val = inputs[name] || 0;
        const wireColor = val ? COLORS.success : COLORS.muted;

        return (
          <div key={name}>
            {/* Input label */}
            <div
              className="absolute flex items-center justify-center w-9 h-9 rounded-lg font-mono font-bold text-sm transition-all duration-300"
              style={{
                left: "2%",
                top: `${yPercent}%`,
                transform: "translateY(-50%)",
                backgroundColor: val ? "rgba(16,185,129,0.15)" : "rgba(113,113,122,0.1)",
                border: `2px solid ${val ? "rgba(16,185,129,0.4)" : "rgba(113,113,122,0.2)"}`,
                color: wireColor,
              }}
            >
              {val}
            </div>
            {/* Label */}
            <div
              className="absolute text-[10px] font-mono font-semibold"
              style={{
                left: "3.5%",
                top: `${yPercent - 10}%`,
                color: COLORS.accent,
              }}
            >
              {name}
            </div>
            {/* Wire */}
            <div
              className="absolute h-[3px] rounded-full transition-colors duration-300"
              style={{
                left: "11%",
                top: `${yPercent}%`,
                transform: "translateY(-50%)",
                width: "17%",
                backgroundColor: wireColor,
              }}
            />
          </div>
        );
      })}

      {/* Clock input */}
      <div
        className="absolute flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200"
        style={{
          left: "2%",
          top: "70%",
          transform: "translateY(-50%)",
          backgroundColor: clockPhase >= 1 && clockPhase <= 2 ? "rgba(6,182,212,0.15)" : "rgba(6,182,212,0.05)",
          border: `2px solid ${clockPhase >= 1 && clockPhase <= 2 ? "rgba(6,182,212,0.4)" : "rgba(6,182,212,0.15)"}`,
        }}
      >
        <Clock size={16} style={{ color: clockColor }} />
      </div>
      <div
        className="absolute text-[10px] font-mono font-semibold"
        style={{ left: "2.5%", top: "58%", color: COLORS.clock }}
      >
        CLK
      </div>
      <div
        className="absolute h-[3px] rounded-full transition-colors duration-300"
        style={{
          left: "11%",
          top: "70%",
          transform: "translateY(-50%)",
          width: "17%",
          backgroundColor: clockColor,
        }}
      />

      {/* Flip-flop body */}
      <motion.div
        className="absolute flex flex-col items-center justify-center rounded-2xl transition-all duration-300"
        style={{
          left: "30%",
          top: "50%",
          transform: "translateY(-50%)",
          width: "36%",
          height: "190px",
          backgroundColor: invalid
            ? "rgba(239,68,68,0.08)"
            : clockPhase === 1
            ? "rgba(6,182,212,0.08)"
            : "rgba(30,30,46,0.6)",
          border: `2px solid ${
            invalid
              ? "rgba(239,68,68,0.3)"
              : clockPhase === 1
              ? "rgba(6,182,212,0.3)"
              : "#2a2a3e"
          }`,
          boxShadow: clockPhase === 1 ? "0 0 20px rgba(6,182,212,0.15)" : "none",
        }}
        animate={clockPhase === 1 ? { scale: [1, 1.02, 1] } : {}}
        transition={{ duration: 0.2 }}
      >
        <span className="text-2xl font-bold text-white">{ffType}</span>
        <span className="text-xs mt-1" style={{ color: COLORS.muted }}>Flip-Flop</span>

        {/* Clock triangle indicator */}
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2"
          style={{
            width: 0,
            height: 0,
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            borderBottom: `10px solid ${clockColor}`,
          }}
        />

        {/* Input port labels */}
        {inputNames.map((name, idx) => {
          const yPercent = inputNames.length === 1 ? 30 : 20 + idx * 22;
          return (
            <div
              key={name}
              className="absolute text-[10px] font-mono font-semibold"
              style={{ left: "8px", top: `${yPercent}%`, color: COLORS.accent }}
            >
              {name}
            </div>
          );
        })}

        {/* Output port labels */}
        <div
          className="absolute text-[10px] font-mono font-semibold"
          style={{ right: "8px", top: "25%", color: qColor }}
        >
          Q
        </div>
        <div
          className="absolute text-[10px] font-mono font-semibold"
          style={{ right: "8px", top: "60%", color: qBarColor }}
        >
          Q&apos;
        </div>

        {invalid && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[10px] font-bold"
            style={{ backgroundColor: "rgba(239,68,68,0.2)", color: COLORS.invalid, border: "1px solid rgba(239,68,68,0.3)" }}
          >
            INVALID
          </motion.div>
        )}
      </motion.div>

      {/* Output Q wire */}
      <div
        className="absolute h-[3px] rounded-full transition-colors duration-300"
        style={{
          left: "68%",
          top: "37%",
          transform: "translateY(-50%)",
          width: "17%",
          backgroundColor: qColor,
        }}
      />
      <motion.div
        className="absolute flex items-center justify-center w-9 h-9 rounded-lg font-mono font-bold text-sm transition-all duration-300"
        style={{
          right: "3%",
          top: "37%",
          transform: "translateY(-50%)",
          backgroundColor: invalid ? "rgba(239,68,68,0.15)" : q ? "rgba(16,185,129,0.15)" : "rgba(113,113,122,0.1)",
          border: `2px solid ${invalid ? "rgba(239,68,68,0.4)" : q ? "rgba(16,185,129,0.4)" : "rgba(113,113,122,0.2)"}`,
          color: qColor,
        }}
        animate={clockPhase === 1 ? { scale: [1, 1.1, 1] } : {}}
        transition={{ duration: 0.2 }}
      >
        {invalid ? "X" : q}
      </motion.div>
      <div
        className="absolute text-[10px] font-mono font-semibold"
        style={{ right: "5%", top: "25%", color: COLORS.muted }}
      >
        Q
      </div>

      {/* Output Q' wire */}
      <div
        className="absolute h-[3px] rounded-full transition-colors duration-300"
        style={{
          left: "68%",
          top: "63%",
          transform: "translateY(-50%)",
          width: "17%",
          backgroundColor: qBarColor,
        }}
      />
      <div
        className="absolute flex items-center justify-center w-9 h-9 rounded-lg font-mono font-bold text-sm transition-all duration-300"
        style={{
          right: "3%",
          top: "63%",
          transform: "translateY(-50%)",
          backgroundColor: invalid ? "rgba(239,68,68,0.15)" : qBar ? "rgba(16,185,129,0.15)" : "rgba(113,113,122,0.1)",
          border: `2px solid ${invalid ? "rgba(239,68,68,0.4)" : qBar ? "rgba(16,185,129,0.4)" : "rgba(113,113,122,0.2)"}`,
          color: qBarColor,
        }}
      >
        {invalid ? "X" : qBar}
      </div>
      <div
        className="absolute text-[10px] font-mono font-semibold"
        style={{ right: "5%", top: "75%", color: COLORS.muted }}
      >
        Q&apos;
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

export default function FlipFlopsPage() {
  // ── Core state ────────────────────────────────────────────────────────────
  const [selectedFF, setSelectedFF] = useState<FlipFlopType>("SR");
  const [inputs, setInputs] = useState<Record<string, number>>({ S: 0, R: 0 });
  const [q, setQ] = useState(0);
  const [qBar, setQBar] = useState(1);
  const [invalid, setInvalid] = useState(false);
  const [clockPhase, setClockPhase] = useState(0);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey>("sr-latch");
  const [showMetrics, setShowMetrics] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  // ── Timing state ──────────────────────────────────────────────────────────
  const [timingEntries, setTimingEntries] = useState<TimingEntry[]>([]);
  const [clockCycles, setClockCycles] = useState(0);
  const [transitions, setTransitions] = useState(0);

  // ── Auto-play state ───────────────────────────────────────────────────────
  const [autoPlayIndex, setAutoPlayIndex] = useState(0);
  const [autoPlaySubPhase, setAutoPlaySubPhase] = useState(0);
  // Sub-phases: 0=set inputs, 1=clock low, 2=clock rising, 3=clock high (evaluate), 4=clock falling

  // ── Refs ───────────────────────────────────────────────────────────────────
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const qRef = useRef(0);

  // Keep refs in sync
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    qRef.current = q;
  }, [q]);

  // ── Input toggling ────────────────────────────────────────────────────────
  const handleToggleInput = useCallback((name: string) => {
    setInputs((prev) => ({
      ...prev,
      [name]: prev[name] === 0 ? 1 : 0,
    }));
  }, []);

  // ── Manual clock trigger ──────────────────────────────────────────────────
  const handleClockPulse = useCallback(() => {
    const ffInfo = FLIP_FLOPS[selectedFF];

    // Rising edge
    setClockPhase(1);
    setTimeout(() => {
      // Evaluate on rising edge
      const result = ffInfo.evaluate(inputs, qRef.current);
      const newQ = result.q;
      const newQBar = result.invalid ? qRef.current : (newQ === 0 ? 1 : 0);
      const prevQ = qRef.current;

      setQ(newQ);
      setQBar(result.invalid ? (prevQ === 0 ? 1 : 0) : newQBar);
      setInvalid(result.invalid);
      qRef.current = newQ;

      if (newQ !== prevQ && !result.invalid) {
        setTransitions((prev) => prev + 1);
      }

      setClockCycles((prev) => prev + 1);
      setClockPhase(2);

      setTimingEntries((prev) => [
        ...prev,
        {
          cycle: prev.length + 1,
          clock: 1,
          inputs: { ...inputs },
          q: newQ,
          qBar: result.invalid ? prevQ : newQBar,
          invalid: result.invalid,
        },
      ]);

      // Falling edge
      setTimeout(() => {
        setClockPhase(3);
        setTimeout(() => {
          setClockPhase(0);
        }, 150);
      }, 300);
    }, 150);
  }, [selectedFF, inputs]);

  // ── Flip-flop selection ───────────────────────────────────────────────────
  const handleSelectFF = useCallback((ff: FlipFlopType) => {
    setSelectedFF(ff);
    const ffInfo = FLIP_FLOPS[ff];
    const newInputs: Record<string, number> = {};
    ffInfo.inputs.forEach((name) => {
      newInputs[name] = 0;
    });
    setInputs(newInputs);
    setQ(0);
    setQBar(1);
    setInvalid(false);
    setClockPhase(0);
    setTimingEntries([]);
    setClockCycles(0);
    setTransitions(0);
    qRef.current = 0;
  }, []);

  // ── Step forward (auto-play logic) ────────────────────────────────────────
  const stepForward = useCallback(() => {
    const scenario = SCENARIOS.find((s) => s.key === selectedScenario)!;
    const sequence = scenario.sequence;
    const ffInfo = FLIP_FLOPS[scenario.flipFlop];

    if (autoPlayIndex >= sequence.length) {
      setIsComplete(true);
      setIsPlaying(false);
      return false;
    }

    const currentInputs = sequence[autoPlayIndex];

    switch (autoPlaySubPhase) {
      case 0: {
        // Set inputs
        setInputs(currentInputs);
        setAutoPlaySubPhase(1);
        return true;
      }
      case 1: {
        // Clock low phase
        setClockPhase(0);
        setAutoPlaySubPhase(2);
        return true;
      }
      case 2: {
        // Clock rising edge
        setClockPhase(1);
        setAutoPlaySubPhase(3);
        return true;
      }
      case 3: {
        // Evaluate on rising edge
        const result = ffInfo.evaluate(currentInputs, qRef.current);
        const newQ = result.q;
        const prevQ = qRef.current;
        const newQBar = result.invalid ? (prevQ === 0 ? 1 : 0) : (newQ === 0 ? 1 : 0);

        setQ(newQ);
        setQBar(newQBar);
        setInvalid(result.invalid);
        qRef.current = newQ;

        if (newQ !== prevQ && !result.invalid) {
          setTransitions((prev) => prev + 1);
        }

        setClockCycles((prev) => prev + 1);
        setClockPhase(2);

        setTimingEntries((prev) => [
          ...prev,
          {
            cycle: prev.length + 1,
            clock: 1,
            inputs: { ...currentInputs },
            q: newQ,
            qBar: newQBar,
            invalid: result.invalid,
          },
        ]);

        setAutoPlaySubPhase(4);
        return true;
      }
      case 4: {
        // Clock falling edge
        setClockPhase(0);
        setAutoPlaySubPhase(0);
        setAutoPlayIndex((prev) => prev + 1);

        if (autoPlayIndex + 1 >= sequence.length) {
          setIsComplete(true);
          setIsPlaying(false);
          return false;
        }
        return true;
      }
      default:
        return false;
    }
  }, [selectedScenario, autoPlayIndex, autoPlaySubPhase]);

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

    // Ensure correct flip-flop selected
    const scenario = SCENARIOS.find((s) => s.key === selectedScenario)!;
    if (selectedFF !== scenario.flipFlop) {
      handleSelectFF(scenario.flipFlop);
    }

    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop, isComplete, selectedScenario, selectedFF, handleSelectFF]);

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
    if (selectedFF !== scenario.flipFlop) {
      handleSelectFF(scenario.flipFlop);
    }

    stepForward();
  }, [handlePause, stepForward, isComplete, selectedScenario, selectedFF, handleSelectFF]);

  const handleReset = useCallback(() => {
    handlePause();
    const scenario = SCENARIOS.find((s) => s.key === selectedScenario)!;
    setSelectedFF(scenario.flipFlop);
    const ffInfo = FLIP_FLOPS[scenario.flipFlop];
    const newInputs: Record<string, number> = {};
    ffInfo.inputs.forEach((name) => {
      newInputs[name] = 0;
    });
    setInputs(newInputs);
    setQ(0);
    setQBar(1);
    setInvalid(false);
    setClockPhase(0);
    setTimingEntries([]);
    setClockCycles(0);
    setTransitions(0);
    setAutoPlayIndex(0);
    setAutoPlaySubPhase(0);
    setIsComplete(false);
    qRef.current = 0;
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
    setSelectedFF(scenario.flipFlop);
    const ffInfo = FLIP_FLOPS[scenario.flipFlop];
    const newInputs: Record<string, number> = {};
    ffInfo.inputs.forEach((name) => {
      newInputs[name] = 0;
    });
    setInputs(newInputs);
    setQ(0);
    setQBar(1);
    setInvalid(false);
    setClockPhase(0);
    setTimingEntries([]);
    setClockCycles(0);
    setTransitions(0);
    setAutoPlayIndex(0);
    setAutoPlaySubPhase(0);
    setIsComplete(false);
    qRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScenario]);

  // ── Derived values ────────────────────────────────────────────────────────
  const currentFFInfo = FLIP_FLOPS[selectedFF];
  const transitionTable = getTransitionTable(selectedFF);

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
                1.2
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Flip-Flops & Latches
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Discover how digital circuits remember information. Watch clock signals trigger state changes in
              flip-flops, the fundamental building blocks of registers, counters, and computer memory.
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

            {/* Flip-flop type selector */}
            <div className="flex items-center gap-1">
              {FLIP_FLOP_KEYS.map((ff) => (
                <button
                  key={ff}
                  onClick={() => handleSelectFF(ff)}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: selectedFF === ff ? "rgba(99,102,241,0.15)" : COLORS.card,
                    color: selectedFF === ff ? COLORS.primary : "#a1a1aa",
                    border: selectedFF === ff ? "1px solid rgba(99,102,241,0.3)" : `1px solid ${COLORS.border}`,
                  }}
                >
                  {ff}
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
            {/* Flip-flop visualization */}
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
                  <span className="text-sm font-semibold text-white">{currentFFInfo.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono" style={{ color: COLORS.secondary }}>
                    State: Q={q}
                  </span>
                  {invalid && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ color: COLORS.invalid, background: "rgba(239,68,68,0.1)" }}>
                      INVALID
                    </span>
                  )}
                </div>
              </div>

              {/* Diagram */}
              <div className="px-6 py-4">
                <FlipFlopDiagram
                  ffType={selectedFF}
                  inputs={inputs}
                  q={q}
                  qBar={qBar}
                  invalid={invalid}
                  clockPhase={clockPhase}
                />
              </div>

              {/* Input controls */}
              <div className="flex items-center justify-center gap-4 px-5 py-4 border-t" style={{ borderColor: COLORS.border }}>
                {currentFFInfo.inputs.map((name) => (
                  <button
                    key={name}
                    onClick={() => handleToggleInput(name)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                    style={{
                      background: inputs[name] ? "rgba(16,185,129,0.1)" : "rgba(113,113,122,0.08)",
                      border: `1px solid ${inputs[name] ? "rgba(16,185,129,0.3)" : "rgba(113,113,122,0.15)"}`,
                      color: inputs[name] ? COLORS.success : COLORS.muted,
                    }}
                  >
                    {inputs[name] ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    {name}: {inputs[name]}
                  </button>
                ))}

                <button
                  onClick={handleClockPulse}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: "rgba(6,182,212,0.1)",
                    border: "1px solid rgba(6,182,212,0.3)",
                    color: COLORS.clock,
                  }}
                >
                  <Clock size={16} />
                  Clock Pulse
                </button>

                <div
                  className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
                  style={{ background: "rgba(30,30,46,0.5)", border: `1px solid ${COLORS.border}` }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono" style={{ color: COLORS.muted }}>Q:</span>
                    <span className="font-mono font-bold" style={{ color: invalid ? COLORS.invalid : q ? COLORS.qHigh : COLORS.qLow }}>
                      {invalid ? "X" : q}
                    </span>
                  </div>
                  <div className="w-px h-4" style={{ backgroundColor: COLORS.border }} />
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono" style={{ color: COLORS.muted }}>Q&apos;:</span>
                    <span className="font-mono font-bold" style={{ color: invalid ? COLORS.invalid : qBar ? COLORS.qHigh : COLORS.qLow }}>
                      {invalid ? "X" : qBar}
                    </span>
                  </div>
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
                    <MetricBadge icon={<Clock size={12} />} label="Clock Cycles" value={clockCycles} color={COLORS.clock} />
                    <MetricBadge icon={<ArrowUpDown size={12} />} label="Transitions" value={transitions} color={COLORS.accent} />
                    <MetricBadge icon={<Activity size={12} />} label="Current State" value={`Q=${invalid ? "X" : q}`} color={COLORS.primary} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Right panel: transition table + timing */}
            <div className="lg:col-span-1 space-y-3">
              {/* State transition table */}
              <div className="rounded-xl overflow-hidden" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
                <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: COLORS.border }}>
                  <Table2 size={14} style={{ color: COLORS.secondary }} />
                  <span className="text-sm font-semibold text-white">State Transitions</span>
                </div>
                <div className="overflow-x-auto" style={{ maxHeight: "260px" }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b" style={{ borderColor: COLORS.border }}>
                        {currentFFInfo.inputs.map((name) => (
                          <th key={name} className="px-3 py-2 text-center font-mono font-medium" style={{ color: COLORS.accent }}>
                            {name}
                          </th>
                        ))}
                        <th className="px-3 py-2 text-center font-mono font-medium" style={{ color: COLORS.muted }}>Q(t)</th>
                        <th className="px-3 py-2 text-center font-mono font-medium" style={{ color: COLORS.secondary }}>Q(t+1)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transitionTable.map((row, idx) => {
                        const isActive =
                          currentFFInfo.inputs.every(
                            (name) => (row.inputs[name] || 0) === (inputs[name] || 0)
                          ) && row.currentQ === q;

                        const isInvalidRow = row.nextQ.includes("Invalid");

                        return (
                          <tr
                            key={idx}
                            className="border-b transition-colors duration-150"
                            style={{
                              borderColor: `${COLORS.border}50`,
                              background: isActive ? "rgba(99,102,241,0.08)" : "transparent",
                            }}
                          >
                            {currentFFInfo.inputs.map((name) => (
                              <td key={name} className="px-3 py-2 text-center font-mono font-bold" style={{ color: (row.inputs[name] || 0) ? COLORS.success : COLORS.muted }}>
                                {row.inputs[name] || 0}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-center font-mono" style={{ color: "#a1a1aa" }}>{row.currentQ}</td>
                            <td className="px-3 py-2 text-center font-mono font-bold" style={{ color: isInvalidRow ? COLORS.invalid : COLORS.secondary }}>
                              {row.nextQ}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Signal legend */}
              <div className="rounded-xl p-3" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb size={12} style={{ color: COLORS.accent }} />
                  <span className="text-xs font-semibold text-white">Signal Colors</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.clock }} />
                    <span className="text-[11px]" style={{ color: COLORS.muted }}>Clock</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.qHigh }} />
                    <span className="text-[11px]" style={{ color: COLORS.muted }}>Q High</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.qLow }} />
                    <span className="text-[11px]" style={{ color: COLORS.muted }}>Q Low</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.invalid }} />
                    <span className="text-[11px]" style={{ color: COLORS.muted }}>Invalid</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Timing diagram ────────────────────────────────────────── */}
          {timingEntries.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="mb-4 rounded-2xl overflow-hidden"
              style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
            >
              <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: COLORS.border }}>
                <div className="flex items-center gap-2">
                  <BarChart3 size={14} style={{ color: COLORS.clock }} />
                  <span className="text-sm font-semibold text-white">Timing Diagram</span>
                </div>
                <span className="text-xs font-mono" style={{ color: COLORS.muted }}>
                  {timingEntries.length} cycle{timingEntries.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="p-4">
                <TimingDiagram entries={timingEntries} maxVisible={12} />
              </div>
            </motion.div>
          )}

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
                    <span className="text-xs font-medium text-[#10b981]">Sequence complete</span>
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
                Understanding the {currentFFInfo.label}
              </span>
            </div>

            <div className="p-5 space-y-4">
              {/* Description */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: COLORS.secondary }}>
                  How It Works
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#a1a1aa" }}>
                  {currentFFInfo.description}
                </p>
              </div>

              {/* Real-world uses */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: COLORS.success }}>
                  Real-World Applications
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#a1a1aa" }}>
                  {currentFFInfo.realWorld}
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
                      {selectedFF === "SR"
                        ? "The SR latch is the most basic memory element but has a critical flaw: the S=1, R=1 condition is invalid because it tries to simultaneously set and reset the output, leading to an unpredictable race condition when both inputs return to 0."
                        : selectedFF === "D"
                        ? "The D flip-flop is the workhorse of digital design. By capturing data only on clock edges (edge-triggered), it prevents glitches from propagating and enables reliable synchronous circuits. Almost every register in a CPU is built from D flip-flops."
                        : selectedFF === "JK"
                        ? "The JK flip-flop solves the SR latch's invalid state problem. When both J and K are 1, instead of being undefined, the output toggles. This makes it the most versatile flip-flop, capable of set, reset, hold, and toggle operations."
                        : "The T flip-flop is a simplified JK flip-flop with J and K tied together. When T=1, it toggles on every clock edge, making it perfect for binary counters. A chain of T flip-flops divides frequency by powers of 2."}
                    </span>
                  </div>
                </div>
              </div>

              {/* Comparison table */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: COLORS.muted }}>
                  Flip-Flop Comparison
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b" style={{ borderColor: COLORS.border }}>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>Type</th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>Inputs</th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>Has Invalid?</th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>Can Toggle?</th>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>Primary Use</th>
                      </tr>
                    </thead>
                    <tbody>
                      {FLIP_FLOP_KEYS.map((ff) => {
                        const isActive = ff === selectedFF;
                        return (
                          <tr
                            key={ff}
                            className="border-b transition-colors duration-150 cursor-pointer"
                            style={{
                              borderColor: `${COLORS.border}50`,
                              background: isActive ? "rgba(99,102,241,0.04)" : "transparent",
                            }}
                            onClick={() => handleSelectFF(ff)}
                          >
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                {isActive && <div className="w-1.5 h-1.5 rounded-full" style={{ background: COLORS.primary }} />}
                                <span className="font-mono font-semibold" style={{ color: isActive ? "#ffffff" : "#a1a1aa" }}>
                                  {ff}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center font-mono" style={{ color: COLORS.accent }}>
                              {FLIP_FLOPS[ff].inputs.join(", ")}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {ff === "SR" ? (
                                <span style={{ color: COLORS.invalid }}>Yes (S=R=1)</span>
                              ) : (
                                <span style={{ color: COLORS.success }}>No</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {ff === "JK" || ff === "T" ? (
                                <span style={{ color: COLORS.success }}>Yes</span>
                              ) : (
                                <span style={{ color: COLORS.muted }}>No</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-sm" style={{ color: "#a1a1aa" }}>
                              {ff === "SR" ? "Basic storage" : ff === "D" ? "Data registers" : ff === "JK" ? "Versatile logic" : "Counters"}
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
