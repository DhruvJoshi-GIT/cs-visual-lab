"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu,
  ArrowRight,
  Zap,
  Activity,
  Lightbulb,
  ChevronRight,
  Circle,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

type ALUOperation = "ADD" | "SUB" | "AND" | "OR" | "XOR" | "NOT" | "SHL" | "SHR";

interface ALUFlags {
  zero: boolean;
  carry: boolean;
  overflow: boolean;
  negative: boolean;
}

interface ALUResult {
  result: number;
  flags: ALUFlags;
  carryBits?: number[];
  intermediateSteps?: string[];
}

type SimulationPhase =
  | "idle"
  | "load-a"
  | "load-b"
  | "select-op"
  | "compute"
  | "output";

interface Scenario {
  id: string;
  label: string;
  description: string;
}

interface OperationInfo {
  name: ALUOperation;
  label: string;
  opcode: string;
  symbol: string;
  description: string;
  category: "arithmetic" | "logic" | "shift";
}

interface AutoPlayStep {
  a: number;
  b: number;
  op: ALUOperation;
  label: string;
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
  inputA: "#6366f1",
  inputB: "#06b6d4",
  result: "#10b981",
  flagActive: "#f59e0b",
};

const OPERATIONS: Record<ALUOperation, OperationInfo> = {
  ADD: { name: "ADD", label: "Add", opcode: "000", symbol: "+", description: "A + B", category: "arithmetic" },
  SUB: { name: "SUB", label: "Subtract", opcode: "001", symbol: "-", description: "A - B", category: "arithmetic" },
  AND: { name: "AND", label: "AND", opcode: "010", symbol: "&", description: "A AND B", category: "logic" },
  OR: { name: "OR", label: "OR", opcode: "011", symbol: "|", description: "A OR B", category: "logic" },
  XOR: { name: "XOR", label: "XOR", opcode: "100", symbol: "^", description: "A XOR B", category: "logic" },
  NOT: { name: "NOT", label: "NOT", opcode: "101", symbol: "~", description: "NOT A", category: "logic" },
  SHL: { name: "SHL", label: "Shift Left", opcode: "110", symbol: "<<", description: "A << B", category: "shift" },
  SHR: { name: "SHR", label: "Shift Right", opcode: "111", symbol: ">>", description: "A >> B", category: "shift" },
};

const OPERATION_KEYS: ALUOperation[] = ["ADD", "SUB", "AND", "OR", "XOR", "NOT", "SHL", "SHR"];

const SCENARIOS: Scenario[] = [
  { id: "arithmetic", label: "Arithmetic", description: "ADD, SUB operations" },
  { id: "logic", label: "Logic", description: "AND, OR, XOR operations" },
  { id: "shifts", label: "Shifts", description: "SHL, SHR operations" },
  { id: "flags", label: "Flag Demo", description: "Overflow, carry, zero, negative" },
];

const AUTOPLAY_SEQUENCES: Record<string, AutoPlayStep[]> = {
  arithmetic: [
    { a: 15, b: 10, op: "ADD", label: "15 + 10 = 25" },
    { a: 200, b: 100, op: "ADD", label: "200 + 100 = 300 (carry!)" },
    { a: 50, b: 30, op: "SUB", label: "50 - 30 = 20" },
    { a: 10, b: 20, op: "SUB", label: "10 - 20 = -10 (negative!)" },
    { a: 127, b: 1, op: "ADD", label: "127 + 1 = 128 (signed overflow)" },
    { a: 0, b: 0, op: "ADD", label: "0 + 0 = 0 (zero flag)" },
  ],
  logic: [
    { a: 0b11001100, b: 0b10101010, op: "AND", label: "0xCC AND 0xAA" },
    { a: 0b11001100, b: 0b10101010, op: "OR", label: "0xCC OR 0xAA" },
    { a: 0b11001100, b: 0b10101010, op: "XOR", label: "0xCC XOR 0xAA" },
    { a: 0b11110000, b: 0, op: "NOT", label: "NOT 0xF0" },
    { a: 0b01010101, b: 0b01010101, op: "XOR", label: "Self XOR = 0" },
    { a: 0xFF, b: 0, op: "NOT", label: "NOT 0xFF = 0" },
  ],
  shifts: [
    { a: 1, b: 1, op: "SHL", label: "1 << 1 = 2" },
    { a: 1, b: 4, op: "SHL", label: "1 << 4 = 16" },
    { a: 128, b: 1, op: "SHR", label: "128 >> 1 = 64" },
    { a: 0b10110100, b: 2, op: "SHL", label: "Shift left by 2" },
    { a: 0b10110100, b: 2, op: "SHR", label: "Shift right by 2" },
    { a: 3, b: 5, op: "SHL", label: "3 << 5 = 96 (multiply)" },
  ],
  flags: [
    { a: 0, b: 0, op: "ADD", label: "Zero flag: 0 + 0" },
    { a: 200, b: 100, op: "ADD", label: "Carry flag: 200 + 100" },
    { a: 127, b: 1, op: "ADD", label: "Overflow: 127 + 1 (signed)" },
    { a: 0b10000000, b: 0, op: "ADD", label: "Negative flag: MSB set" },
    { a: 5, b: 10, op: "SUB", label: "Negative + Carry: 5 - 10" },
    { a: 255, b: 1, op: "ADD", label: "Carry + Zero: 255 + 1" },
  ],
};

// ─── ALU Computation Logic ────────────────────────────────────────────────────

function numberToBits(value: number, width: number = 8): number[] {
  const bits: number[] = [];
  for (let i = width - 1; i >= 0; i--) {
    bits.push((value >>> i) & 1);
  }
  return bits;
}

function bitsToNumber(bits: number[]): number {
  let value = 0;
  for (let i = 0; i < bits.length; i++) {
    value = (value << 1) | (bits[i] & 1);
  }
  return value >>> 0;
}

function computeALU(a: number, b: number, op: ALUOperation): ALUResult {
  const aVal = a & 0xFF;
  const bVal = b & 0xFF;
  let rawResult: number;
  let carry = false;
  const carryBits: number[] = [];
  const intermediateSteps: string[] = [];

  switch (op) {
    case "ADD": {
      rawResult = aVal + bVal;
      carry = rawResult > 255;
      // Compute carry bits for ripple carry visualization
      let c = 0;
      for (let i = 0; i < 8; i++) {
        const aBit = (aVal >> i) & 1;
        const bBit = (bVal >> i) & 1;
        const sum = aBit + bBit + c;
        carryBits[i] = c;
        c = sum > 1 ? 1 : 0;
        intermediateSteps.push(
          `Bit ${i}: ${aBit} + ${bBit} + carry(${carryBits[i]}) = ${sum & 1}, carry-out = ${c}`
        );
      }
      carryBits[8] = c;
      rawResult = rawResult & 0xFF;
      break;
    }
    case "SUB": {
      // Two's complement subtraction: A + (~B + 1)
      const bComplement = (~bVal & 0xFF) + 1;
      rawResult = aVal + (bComplement & 0xFF);
      carry = aVal < bVal; // borrow
      let c = 1; // initial carry for two's complement
      for (let i = 0; i < 8; i++) {
        const aBit = (aVal >> i) & 1;
        const bBitInv = ((~bVal) >> i) & 1;
        const sum = aBit + bBitInv + c;
        carryBits[i] = c;
        c = sum > 1 ? 1 : 0;
        intermediateSteps.push(
          `Bit ${i}: ${aBit} + ~${(bVal >> i) & 1}(=${bBitInv}) + carry(${carryBits[i]}) = ${sum & 1}, carry-out = ${c}`
        );
      }
      carryBits[8] = c;
      rawResult = rawResult & 0xFF;
      break;
    }
    case "AND":
      rawResult = aVal & bVal;
      for (let i = 7; i >= 0; i--) {
        intermediateSteps.push(
          `Bit ${i}: ${(aVal >> i) & 1} AND ${(bVal >> i) & 1} = ${(rawResult >> i) & 1}`
        );
      }
      break;
    case "OR":
      rawResult = aVal | bVal;
      for (let i = 7; i >= 0; i--) {
        intermediateSteps.push(
          `Bit ${i}: ${(aVal >> i) & 1} OR ${(bVal >> i) & 1} = ${(rawResult >> i) & 1}`
        );
      }
      break;
    case "XOR":
      rawResult = aVal ^ bVal;
      for (let i = 7; i >= 0; i--) {
        intermediateSteps.push(
          `Bit ${i}: ${(aVal >> i) & 1} XOR ${(bVal >> i) & 1} = ${(rawResult >> i) & 1}`
        );
      }
      break;
    case "NOT":
      rawResult = ~aVal & 0xFF;
      for (let i = 7; i >= 0; i--) {
        intermediateSteps.push(
          `Bit ${i}: NOT ${(aVal >> i) & 1} = ${(rawResult >> i) & 1}`
        );
      }
      break;
    case "SHL":
      rawResult = (aVal << (bVal & 7)) & 0xFF;
      carry = bVal > 0 && ((aVal >> (8 - (bVal & 7))) & 1) === 1;
      intermediateSteps.push(`Shift ${numberToBits(aVal).join("")} left by ${bVal & 7} positions`);
      intermediateSteps.push(`Result: ${numberToBits(rawResult).join("")}`);
      intermediateSteps.push(`Bits shifted out from the left are lost`);
      break;
    case "SHR":
      rawResult = (aVal >>> (bVal & 7)) & 0xFF;
      carry = bVal > 0 && ((aVal >> ((bVal & 7) - 1)) & 1) === 1;
      intermediateSteps.push(`Shift ${numberToBits(aVal).join("")} right by ${bVal & 7} positions`);
      intermediateSteps.push(`Result: ${numberToBits(rawResult).join("")}`);
      intermediateSteps.push(`Bits shifted out from the right are lost`);
      break;
    default:
      rawResult = 0;
  }

  const result = rawResult & 0xFF;

  // Compute flags
  const zero = result === 0;
  const negative = (result & 0x80) !== 0;
  let overflow = false;
  if (op === "ADD") {
    const aSign = (aVal & 0x80) !== 0;
    const bSign = (bVal & 0x80) !== 0;
    const rSign = (result & 0x80) !== 0;
    overflow = (!aSign && !bSign && rSign) || (aSign && bSign && !rSign);
  } else if (op === "SUB") {
    const aSign = (aVal & 0x80) !== 0;
    const bSign = (bVal & 0x80) !== 0;
    const rSign = (result & 0x80) !== 0;
    overflow = (!aSign && bSign && rSign) || (aSign && !bSign && !rSign);
  }

  return {
    result,
    flags: { zero, carry, overflow, negative },
    carryBits,
    intermediateSteps,
  };
}

// ─── Bit Toggle Component ─────────────────────────────────────────────────────

function BitToggle({
  bit,
  index,
  color,
  onClick,
  isAnimating,
  label,
}: {
  bit: number;
  index: number;
  color: string;
  onClick: () => void;
  isAnimating: boolean;
  label?: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      className="relative flex items-center justify-center font-mono font-bold text-sm select-none"
      style={{
        width: 32,
        height: 38,
        borderRadius: 6,
        background: bit === 1 ? `${color}25` : "rgba(30,30,46,0.5)",
        border: `1px solid ${bit === 1 ? `${color}66` : "#1e1e2e"}`,
        color: bit === 1 ? color : "#4a4a5a",
        boxShadow: bit === 1 ? `0 0 8px ${color}33` : "none",
        cursor: "pointer",
        transition: "background 150ms, border-color 150ms, color 150ms, box-shadow 150ms",
      }}
      whileTap={{ scale: 0.9 }}
      animate={isAnimating ? { scale: [1, 1.15, 1] } : { scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      {bit}
      {label && (
        <span
          className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] font-normal"
          style={{ color: "#71717a" }}
        >
          {label}
        </span>
      )}
    </motion.button>
  );
}

// ─── Flag Indicator Component ─────────────────────────────────────────────────

function FlagIndicator({
  label,
  shortLabel,
  active,
  description,
}: {
  label: string;
  shortLabel: string;
  active: boolean;
  description: string;
}) {
  return (
    <motion.div
      className="flex items-center gap-2 px-3 py-2 rounded-lg"
      style={{
        background: active ? "rgba(245,158,11,0.08)" : "rgba(30,30,46,0.5)",
        border: `1px solid ${active ? "rgba(245,158,11,0.25)" : "#1e1e2e"}`,
      }}
      animate={{
        scale: active ? [1, 1.05, 1] : 1,
      }}
      transition={{ duration: 0.3 }}
      title={description}
    >
      <motion.div
        className="w-3 h-3 rounded-full"
        style={{
          background: active ? COLORS.flagActive : "#2a2a3e",
          boxShadow: active ? `0 0 8px ${COLORS.flagActive}66` : "none",
        }}
        animate={active ? { opacity: [1, 0.6, 1] } : { opacity: 1 }}
        transition={active ? { duration: 1.5, repeat: Infinity } : {}}
      />
      <div className="flex flex-col">
        <span
          className="text-xs font-semibold font-mono"
          style={{ color: active ? COLORS.flagActive : "#4a4a5a" }}
        >
          {shortLabel}
        </span>
        <span className="text-[9px]" style={{ color: active ? "#a1a1aa" : "#3a3a4a" }}>
          {label}
        </span>
      </div>
    </motion.div>
  );
}

// ─── ALU Block Diagram ────────────────────────────────────────────────────────

function ALUDiagram({
  phase,
  operation,
  inputA,
  inputB,
  result,
  flags,
}: {
  phase: SimulationPhase;
  operation: ALUOperation;
  inputA: number;
  inputB: number;
  result: number;
  flags: ALUFlags;
}) {
  const isActiveA = phase === "load-a" || phase === "compute" || phase === "output";
  const isActiveB = phase === "load-b" || phase === "compute" || phase === "output";
  const isComputing = phase === "compute";
  const isOutput = phase === "output";
  const isOpSelected = phase === "select-op" || phase === "compute" || phase === "output";

  return (
    <div className="relative w-full" style={{ height: 340 }}>
      <svg width="100%" height="100%" viewBox="0 0 700 340" className="overflow-visible">
        {/* Input A bus */}
        <motion.g animate={{ opacity: isActiveA ? 1 : 0.3 }} transition={{ duration: 0.3 }}>
          {/* A label */}
          <rect x="80" y="20" width="100" height="40" rx="8" fill={isActiveA ? `${COLORS.inputA}20` : "#1e1e2e"} stroke={isActiveA ? COLORS.inputA : "#2a2a3e"} strokeWidth="1.5" />
          <text x="130" y="36" textAnchor="middle" fill={isActiveA ? COLORS.inputA : "#4a4a5a"} fontSize="11" fontWeight="600" fontFamily="monospace">Input A</text>
          <text x="130" y="52" textAnchor="middle" fill={isActiveA ? "#ffffff" : "#4a4a5a"} fontSize="13" fontWeight="700" fontFamily="monospace">{inputA.toString(10).padStart(3, " ")} ({numberToBits(inputA).join("")})</text>

          {/* A bus line */}
          <motion.line
            x1="130" y1="60" x2="130" y2="120"
            stroke={isActiveA ? COLORS.inputA : "#2a2a3e"}
            strokeWidth="2.5"
            strokeDasharray={isActiveA ? "0" : "4 4"}
            animate={phase === "load-a" ? { strokeDashoffset: [0, -20] } : {}}
            transition={phase === "load-a" ? { duration: 0.8, repeat: Infinity, ease: "linear" } : {}}
          />
          <motion.polygon
            points="122,115 138,115 130,128"
            fill={isActiveA ? COLORS.inputA : "#2a2a3e"}
            animate={phase === "load-a" ? { y: [0, 5, 0] } : {}}
            transition={phase === "load-a" ? { duration: 0.6, repeat: Infinity } : {}}
          />
        </motion.g>

        {/* Input B bus */}
        <motion.g animate={{ opacity: isActiveB ? 1 : 0.3 }} transition={{ duration: 0.3 }}>
          <rect x="520" y="20" width="100" height="40" rx="8" fill={isActiveB ? `${COLORS.inputB}20` : "#1e1e2e"} stroke={isActiveB ? COLORS.inputB : "#2a2a3e"} strokeWidth="1.5" />
          <text x="570" y="36" textAnchor="middle" fill={isActiveB ? COLORS.inputB : "#4a4a5a"} fontSize="11" fontWeight="600" fontFamily="monospace">Input B</text>
          <text x="570" y="52" textAnchor="middle" fill={isActiveB ? "#ffffff" : "#4a4a5a"} fontSize="13" fontWeight="700" fontFamily="monospace">{inputB.toString(10).padStart(3, " ")} ({numberToBits(inputB).join("")})</text>

          <motion.line
            x1="570" y1="60" x2="570" y2="120"
            stroke={isActiveB ? COLORS.inputB : "#2a2a3e"}
            strokeWidth="2.5"
            strokeDasharray={isActiveB ? "0" : "4 4"}
            animate={phase === "load-b" ? { strokeDashoffset: [0, -20] } : {}}
            transition={phase === "load-b" ? { duration: 0.8, repeat: Infinity, ease: "linear" } : {}}
          />
          <motion.polygon
            points="562,115 578,115 570,128"
            fill={isActiveB ? COLORS.inputB : "#2a2a3e"}
            animate={phase === "load-b" ? { y: [0, 5, 0] } : {}}
            transition={phase === "load-b" ? { duration: 0.6, repeat: Infinity } : {}}
          />
        </motion.g>

        {/* ALU trapezoid */}
        <motion.g
          animate={
            isComputing
              ? { filter: "drop-shadow(0 0 12px rgba(99,102,241,0.4))" }
              : { filter: "drop-shadow(0 0 0px rgba(99,102,241,0))" }
          }
          transition={{ duration: 0.3 }}
        >
          <motion.polygon
            points="100,130 600,130 520,240 180,240"
            fill={isComputing ? "#1a1a2e" : COLORS.card}
            stroke={isComputing ? COLORS.primary : "#2a2a3e"}
            strokeWidth="2"
            animate={isComputing ? { fill: ["#1a1a2e", "#1e1e3e", "#1a1a2e"] } : {}}
            transition={isComputing ? { duration: 0.8, repeat: Infinity } : {}}
          />
          <text x="350" y="172" textAnchor="middle" fill={isComputing ? "#ffffff" : "#a1a1aa"} fontSize="20" fontWeight="800" fontFamily="monospace">ALU</text>

          {/* Operation display inside ALU */}
          <rect x="305" y="185" width="90" height="28" rx="6" fill={isOpSelected ? `${COLORS.primary}25` : "#1e1e2e"} stroke={isOpSelected ? `${COLORS.primary}66` : "#2a2a3e"} strokeWidth="1" />
          <text x="350" y="204" textAnchor="middle" fill={isOpSelected ? COLORS.primary : "#4a4a5a"} fontSize="12" fontWeight="700" fontFamily="monospace">{OPERATIONS[operation].opcode} {operation}</text>
        </motion.g>

        {/* Operation selector arrow */}
        <motion.g animate={{ opacity: isOpSelected ? 1 : 0.3 }} transition={{ duration: 0.3 }}>
          <motion.line
            x1="350" y1="130" x2="350" y2="90"
            stroke={isOpSelected ? COLORS.primary : "#2a2a3e"}
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          <rect x="310" y="68" width="80" height="24" rx="6" fill={isOpSelected ? `${COLORS.primary}15` : "#1e1e2e"} stroke={isOpSelected ? `${COLORS.primary}40` : "#2a2a3e"} strokeWidth="1" />
          <text x="350" y="84" textAnchor="middle" fill={isOpSelected ? COLORS.primary : "#4a4a5a"} fontSize="10" fontWeight="600" fontFamily="monospace">OP: {OPERATIONS[operation].opcode}</text>
        </motion.g>

        {/* Result output bus */}
        <motion.g animate={{ opacity: isOutput ? 1 : 0.3 }} transition={{ duration: 0.3 }}>
          <motion.line
            x1="350" y1="240" x2="350" y2="280"
            stroke={isOutput ? COLORS.result : "#2a2a3e"}
            strokeWidth="2.5"
            strokeDasharray={isOutput ? "0" : "4 4"}
            animate={isOutput ? { strokeDashoffset: [0, -20] } : {}}
            transition={isOutput ? { duration: 0.8, repeat: Infinity, ease: "linear" } : {}}
          />
          <motion.polygon
            points="342,275 358,275 350,288"
            fill={isOutput ? COLORS.result : "#2a2a3e"}
            animate={isOutput ? { y: [0, 5, 0] } : {}}
            transition={isOutput ? { duration: 0.6, repeat: Infinity } : {}}
          />

          <rect x="270" y="290" width="160" height="40" rx="8" fill={isOutput ? `${COLORS.result}20` : "#1e1e2e"} stroke={isOutput ? COLORS.result : "#2a2a3e"} strokeWidth="1.5" />
          <text x="350" y="306" textAnchor="middle" fill={isOutput ? COLORS.result : "#4a4a5a"} fontSize="11" fontWeight="600" fontFamily="monospace">Result</text>
          <text x="350" y="322" textAnchor="middle" fill={isOutput ? "#ffffff" : "#4a4a5a"} fontSize="13" fontWeight="700" fontFamily="monospace">{result.toString(10).padStart(3, " ")} ({numberToBits(result).join("")})</text>
        </motion.g>

        {/* Flag outputs - on the right side */}
        <motion.g animate={{ opacity: isOutput ? 1 : 0.3 }} transition={{ duration: 0.3 }}>
          <motion.line
            x1="520" y1="230" x2="600" y2="230"
            stroke={isOutput ? COLORS.flagActive : "#2a2a3e"}
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          <text x="610" y="225" fill={isOutput ? "#a1a1aa" : "#3a3a4a"} fontSize="9" fontWeight="600" fontFamily="monospace">FLAGS</text>
          {[
            { flag: flags.zero, label: "Z", y: 240 },
            { flag: flags.carry, label: "C", y: 258 },
            { flag: flags.overflow, label: "V", y: 276 },
            { flag: flags.negative, label: "N", y: 294 },
          ].map((f) => (
            <g key={f.label}>
              <motion.circle
                cx="615"
                cy={f.y}
                r="8"
                fill={f.flag && isOutput ? `${COLORS.flagActive}40` : "#1e1e2e"}
                stroke={f.flag && isOutput ? COLORS.flagActive : "#2a2a3e"}
                strokeWidth="1.5"
                animate={f.flag && isOutput ? { r: [8, 9, 8] } : {}}
                transition={f.flag && isOutput ? { duration: 1, repeat: Infinity } : {}}
              />
              <text
                x="615"
                y={f.y + 4}
                textAnchor="middle"
                fill={f.flag && isOutput ? COLORS.flagActive : "#4a4a5a"}
                fontSize="9"
                fontWeight="700"
                fontFamily="monospace"
              >
                {f.label}
              </text>
              <motion.circle
                cx="635"
                cy={f.y}
                r="3"
                fill={f.flag && isOutput ? COLORS.flagActive : "#2a2a3e"}
                animate={f.flag && isOutput ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
                transition={f.flag && isOutput ? { duration: 1.2, repeat: Infinity } : {}}
              />
            </g>
          ))}
        </motion.g>

        {/* Phase indicator */}
        <rect x="10" y="300" width="110" height="28" rx="6" fill={`${COLORS.primary}15`} stroke={`${COLORS.primary}30`} strokeWidth="1" />
        <text x="65" y="318" textAnchor="middle" fill={COLORS.primary} fontSize="10" fontWeight="600" fontFamily="monospace">
          {phase === "idle" ? "READY" : phase.toUpperCase()}
        </text>
      </svg>
    </div>
  );
}

// ─── Internal Detail View (Ripple Carry for ADD) ──────────────────────────────

function InternalDetailView({
  operation,
  inputA,
  inputB,
  aluResult,
  visible,
}: {
  operation: ALUOperation;
  inputA: number;
  inputB: number;
  aluResult: ALUResult;
  visible: boolean;
}) {
  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl p-4 overflow-hidden"
      style={{
        background: "rgba(99,102,241,0.04)",
        border: "1px solid rgba(99,102,241,0.12)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Cpu size={14} style={{ color: COLORS.primary }} />
        <span className="text-xs font-semibold" style={{ color: COLORS.primary }}>
          Internal Computation: {OPERATIONS[operation].label}
        </span>
      </div>

      {(operation === "ADD" || operation === "SUB") && aluResult.carryBits && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-2">
            {operation === "ADD" ? "Ripple Carry Adder" : "Two's Complement Subtraction"}
          </div>
          <div className="font-mono text-xs space-y-1">
            {/* Carry row */}
            <div className="flex items-center gap-1">
              <span className="w-16 text-right text-[#71717a]">Carry:</span>
              <div className="flex gap-0.5">
                {Array.from({ length: 8 }, (_, i) => 7 - i).map((bitPos) => (
                  <span
                    key={bitPos}
                    className="w-7 text-center"
                    style={{
                      color: aluResult.carryBits![bitPos] ? COLORS.accent : "#3a3a4a",
                    }}
                  >
                    {aluResult.carryBits![bitPos] ?? 0}
                  </span>
                ))}
              </div>
            </div>
            {/* A row */}
            <div className="flex items-center gap-1">
              <span className="w-16 text-right" style={{ color: COLORS.inputA }}>A:</span>
              <div className="flex gap-0.5">
                {numberToBits(inputA).map((bit, i) => (
                  <span key={i} className="w-7 text-center" style={{ color: COLORS.inputA }}>
                    {bit}
                  </span>
                ))}
              </div>
            </div>
            {/* B row */}
            <div className="flex items-center gap-1">
              <span className="w-16 text-right" style={{ color: COLORS.inputB }}>
                {operation === "SUB" ? "~B+1:" : "B:"}
              </span>
              <div className="flex gap-0.5">
                {numberToBits(operation === "SUB" ? (~inputB & 0xFF) + 1 & 0xFF : inputB).map((bit, i) => (
                  <span key={i} className="w-7 text-center" style={{ color: COLORS.inputB }}>
                    {bit}
                  </span>
                ))}
              </div>
            </div>
            {/* Separator */}
            <div className="flex items-center gap-1">
              <span className="w-16" />
              <div className="border-t w-[232px]" style={{ borderColor: "#3a3a4a" }} />
            </div>
            {/* Result row */}
            <div className="flex items-center gap-1">
              <span className="w-16 text-right" style={{ color: COLORS.result }}>Result:</span>
              <div className="flex gap-0.5">
                {numberToBits(aluResult.result).map((bit, i) => (
                  <span key={i} className="w-7 text-center font-bold" style={{ color: COLORS.result }}>
                    {bit}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step-by-step details */}
      {aluResult.intermediateSteps && aluResult.intermediateSteps.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-2">
            Bit-by-Bit Detail
          </div>
          <div className="space-y-0.5 max-h-48 overflow-y-auto pr-2">
            {aluResult.intermediateSteps.map((step, i) => (
              <div
                key={i}
                className="font-mono text-[11px] px-2 py-1 rounded"
                style={{
                  color: "#a1a1aa",
                  background: i % 2 === 0 ? "transparent" : "rgba(30,30,46,0.3)",
                }}
              >
                {step}
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function ALUPage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [inputA, setInputA] = useState(15);
  const [inputB, setInputB] = useState(10);
  const [operation, setOperation] = useState<ALUOperation>("ADD");
  const [phase, setPhase] = useState<SimulationPhase>("idle");
  const [showMetrics, setShowMetrics] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeScenario, setActiveScenario] = useState("arithmetic");
  const [autoPlayIndex, setAutoPlayIndex] = useState(0);
  const [operationCount, setOperationCount] = useState(0);
  const [showInternalDetail, setShowInternalDetail] = useState(true);
  const [animatingBitsA, setAnimatingBitsA] = useState<Set<number>>(new Set());
  const [animatingBitsB, setAnimatingBitsB] = useState<Set<number>>(new Set());

  // ── Refs ────────────────────────────────────────────────────────────────────
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const autoPlayIndexRef = useRef(0);
  const activeScenarioRef = useRef(activeScenario);
  const phaseRef = useRef<SimulationPhase>("idle");
  const pendingStepRef = useRef<AutoPlayStep | null>(null);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { autoPlayIndexRef.current = autoPlayIndex; }, [autoPlayIndex]);
  useEffect(() => { activeScenarioRef.current = activeScenario; }, [activeScenario]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // ── Computed ALU result ─────────────────────────────────────────────────────
  const aluResult = computeALU(inputA, inputB, operation);
  const displayResult = phase === "output" || phase === "idle" ? aluResult.result : 0;
  const displayFlags: ALUFlags =
    phase === "output" || phase === "idle"
      ? aluResult.flags
      : { zero: false, carry: false, overflow: false, negative: false };

  // ── Input bit arrays ────────────────────────────────────────────────────────
  const bitsA = numberToBits(inputA);
  const bitsB = numberToBits(inputB);
  const bitsResult = numberToBits(displayResult);

  // ── Toggle input bits ───────────────────────────────────────────────────────
  const toggleBitA = useCallback(
    (index: number) => {
      const newBits = [...bitsA];
      newBits[index] = newBits[index] === 0 ? 1 : 0;
      setInputA(bitsToNumber(newBits));
      setAnimatingBitsA(new Set([index]));
      setTimeout(() => setAnimatingBitsA(new Set()), 250);
    },
    [bitsA]
  );

  const toggleBitB = useCallback(
    (index: number) => {
      const newBits = [...bitsB];
      newBits[index] = newBits[index] === 0 ? 1 : 0;
      setInputB(bitsToNumber(newBits));
      setAnimatingBitsB(new Set([index]));
      setTimeout(() => setAnimatingBitsB(new Set()), 250);
    },
    [bitsB]
  );

  // ── Phase progression ───────────────────────────────────────────────────────
  const PHASE_SEQUENCE: SimulationPhase[] = [
    "load-a",
    "load-b",
    "select-op",
    "compute",
    "output",
  ];

  const stepForward = useCallback(() => {
    const currentPhase = phaseRef.current;

    if (currentPhase === "idle" || currentPhase === "output") {
      // Check if there is a pending auto-play step to load
      const sequence = AUTOPLAY_SEQUENCES[activeScenarioRef.current] || AUTOPLAY_SEQUENCES.arithmetic;
      const idx = autoPlayIndexRef.current;

      if (currentPhase === "output" && isPlayingRef.current) {
        // Move to next auto-play step
        if (idx < sequence.length) {
          const step = sequence[idx];
          setInputA(step.a);
          setInputB(step.b);
          setOperation(step.op);
          setAutoPlayIndex(idx + 1);
          autoPlayIndexRef.current = idx + 1;
        } else {
          // Loop back
          setAutoPlayIndex(0);
          autoPlayIndexRef.current = 0;
          if (sequence.length > 0) {
            const step = sequence[0];
            setInputA(step.a);
            setInputB(step.b);
            setOperation(step.op);
            setAutoPlayIndex(1);
            autoPlayIndexRef.current = 1;
          }
        }
      }
      // Start new cycle
      setPhase("load-a");
      phaseRef.current = "load-a";
      return;
    }

    const currentIdx = PHASE_SEQUENCE.indexOf(currentPhase);
    if (currentIdx < PHASE_SEQUENCE.length - 1) {
      const nextPhase = PHASE_SEQUENCE[currentIdx + 1];
      setPhase(nextPhase);
      phaseRef.current = nextPhase;
      if (nextPhase === "output") {
        setOperationCount((c) => c + 1);
      }
    }
  }, []);

  // ── Animation loop ──────────────────────────────────────────────────────────
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(100, 800 / speedRef.current);
      if (timestamp - lastTickRef.current >= interval) {
        lastTickRef.current = timestamp;
        stepForward();
      }
      animationRef.current = requestAnimationFrame(animationLoop);
    },
    [stepForward]
  );

  // ── Play / Pause / Step / Reset ─────────────────────────────────────────────
  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    isPlayingRef.current = true;
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const handleStep = useCallback(() => {
    handlePause();
    stepForward();
  }, [handlePause, stepForward]);

  const handleReset = useCallback(() => {
    handlePause();
    setPhase("idle");
    phaseRef.current = "idle";
    setAutoPlayIndex(0);
    autoPlayIndexRef.current = 0;
    setOperationCount(0);
  }, [handlePause]);

  // ── Scenario change ─────────────────────────────────────────────────────────
  const handleScenarioChange = useCallback(
    (scenarioId: string) => {
      handlePause();
      setActiveScenario(scenarioId);
      activeScenarioRef.current = scenarioId;
      setAutoPlayIndex(0);
      autoPlayIndexRef.current = 0;
      setPhase("idle");
      phaseRef.current = "idle";
      const sequence = AUTOPLAY_SEQUENCES[scenarioId];
      if (sequence && sequence.length > 0) {
        setInputA(sequence[0].a);
        setInputB(sequence[0].b);
        setOperation(sequence[0].op);
      }
    },
    [handlePause]
  );

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────
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
                  color: "#6366f1",
                  border: "1px solid rgba(99,102,241,0.2)",
                }}
              >
                1.7
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                ALU Design
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Explore the Arithmetic Logic Unit, the computational heart of every processor.
              Watch how 8-bit inputs flow through the ALU datapath, operations are selected,
              and results with status flags are produced step by step.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium"
                style={{
                  background: "rgba(99,102,241,0.08)",
                  color: "#6366f1",
                  border: "1px solid rgba(99,102,241,0.15)",
                }}
              >
                <Cpu size={11} />
                Digital Logic Foundations
              </span>
            </div>
          </motion.div>

          {/* ── Scenario Selector ──────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
            className="flex items-center gap-2 mb-4"
          >
            <div className="flex items-center gap-1.5 text-xs text-[#71717a] mr-1">
              <Zap size={14} />
              <span>Presets</span>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {SCENARIOS.map((scenario) => (
                <button
                  key={scenario.id}
                  onClick={() => handleScenarioChange(scenario.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                  style={{
                    background:
                      activeScenario === scenario.id
                        ? "rgba(99,102,241,0.12)"
                        : "#1e1e2e",
                    color: activeScenario === scenario.id ? "#6366f1" : "#a1a1aa",
                    border:
                      activeScenario === scenario.id
                        ? "1px solid rgba(99,102,241,0.3)"
                        : "1px solid transparent",
                  }}
                  title={scenario.description}
                >
                  {scenario.label}
                </button>
              ))}
            </div>
          </motion.div>

          {/* ── Operation Selector ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: [0.23, 1, 0.32, 1] }}
            className="flex items-center gap-2 mb-4 flex-wrap"
          >
            <span className="text-xs text-[#71717a] font-medium mr-1">Operation:</span>
            {OPERATION_KEYS.map((op) => {
              const info = OPERATIONS[op];
              const isActive = operation === op;
              const categoryColor =
                info.category === "arithmetic"
                  ? COLORS.primary
                  : info.category === "logic"
                  ? COLORS.secondary
                  : COLORS.accent;

              return (
                <button
                  key={op}
                  onClick={() => {
                    setOperation(op);
                    if (phase !== "idle") {
                      setPhase("idle");
                      phaseRef.current = "idle";
                    }
                  }}
                  className="px-3 py-2 rounded-lg text-xs font-mono font-medium transition-all duration-200 hover:scale-105 active:scale-95"
                  style={{
                    background: isActive ? `${categoryColor}15` : "#1e1e2e",
                    border: `1px solid ${isActive ? `${categoryColor}40` : "#2a2a3e"}`,
                    color: isActive ? categoryColor : "#71717a",
                  }}
                >
                  <span className="font-bold">{op}</span>
                  <span className="ml-1 opacity-60">{info.symbol}</span>
                </button>
              );
            })}
          </motion.div>

          {/* ── Main Visualization ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="rounded-2xl overflow-hidden mb-4"
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              boxShadow: "0 0 0 1px rgba(99,102,241,0.03), 0 20px 50px -12px rgba(0,0,0,0.5)",
            }}
          >
            {/* Input controls row */}
            <div className="p-4 border-b" style={{ borderColor: COLORS.border }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Input A */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: COLORS.inputA }} />
                    <span className="text-xs font-semibold" style={{ color: COLORS.inputA }}>
                      Input A
                    </span>
                    <span className="ml-auto font-mono text-xs" style={{ color: "#a1a1aa" }}>
                      {inputA} (0x{inputA.toString(16).toUpperCase().padStart(2, "0")})
                    </span>
                  </div>
                  <div className="flex gap-1 pt-4">
                    {bitsA.map((bit, i) => (
                      <BitToggle
                        key={`a-${i}`}
                        bit={bit}
                        index={i}
                        color={COLORS.inputA}
                        onClick={() => toggleBitA(i)}
                        isAnimating={animatingBitsA.has(i)}
                        label={i === 0 ? "7" : i === 7 ? "0" : undefined}
                      />
                    ))}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={255}
                    value={inputA}
                    onChange={(e) => setInputA(parseInt(e.target.value))}
                    className="w-full mt-2 h-1.5 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#6366f1]"
                    style={{ background: "#1e1e2e" }}
                  />
                </div>

                {/* Input B */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: COLORS.inputB }} />
                    <span className="text-xs font-semibold" style={{ color: COLORS.inputB }}>
                      Input B {operation === "NOT" && "(unused)"}
                    </span>
                    <span className="ml-auto font-mono text-xs" style={{ color: "#a1a1aa" }}>
                      {inputB} (0x{inputB.toString(16).toUpperCase().padStart(2, "0")})
                    </span>
                  </div>
                  <div className="flex gap-1 pt-4" style={{ opacity: operation === "NOT" ? 0.3 : 1 }}>
                    {bitsB.map((bit, i) => (
                      <BitToggle
                        key={`b-${i}`}
                        bit={bit}
                        index={i}
                        color={COLORS.inputB}
                        onClick={() => operation !== "NOT" && toggleBitB(i)}
                        isAnimating={animatingBitsB.has(i)}
                        label={i === 0 ? "7" : i === 7 ? "0" : undefined}
                      />
                    ))}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={operation === "SHL" || operation === "SHR" ? 7 : 255}
                    value={inputB}
                    onChange={(e) => setInputB(parseInt(e.target.value))}
                    className="w-full mt-2 h-1.5 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#06b6d4]"
                    style={{ background: "#1e1e2e", opacity: operation === "NOT" ? 0.3 : 1 }}
                    disabled={operation === "NOT"}
                  />
                </div>
              </div>
            </div>

            {/* ALU block diagram */}
            <div className="p-4">
              <ALUDiagram
                phase={phase}
                operation={operation}
                inputA={inputA}
                inputB={inputB}
                result={displayResult}
                flags={displayFlags}
              />
            </div>

            {/* Result and Flags bar */}
            <div
              className="px-4 py-3 border-t flex items-center gap-4 flex-wrap"
              style={{ borderColor: COLORS.border }}
            >
              {/* Result display */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: COLORS.result }} />
                  <span className="text-xs font-semibold" style={{ color: COLORS.result }}>
                    Result
                  </span>
                </div>
                <div className="flex gap-0.5">
                  {bitsResult.map((bit, i) => (
                    <span
                      key={i}
                      className="w-6 h-6 flex items-center justify-center rounded text-xs font-mono font-bold"
                      style={{
                        background: bit === 1 ? `${COLORS.result}25` : "rgba(30,30,46,0.5)",
                        color: bit === 1 ? COLORS.result : "#4a4a5a",
                        border: `1px solid ${bit === 1 ? `${COLORS.result}40` : "#1e1e2e"}`,
                      }}
                    >
                      {bit}
                    </span>
                  ))}
                </div>
                <span className="font-mono text-sm font-semibold text-white">
                  = {displayResult}
                </span>
                <span className="font-mono text-xs" style={{ color: "#71717a" }}>
                  (0x{displayResult.toString(16).toUpperCase().padStart(2, "0")})
                </span>
              </div>

              {/* Divider */}
              <div className="w-px h-8" style={{ background: COLORS.border }} />

              {/* Flags */}
              <div className="flex items-center gap-2 flex-wrap">
                <FlagIndicator
                  label="Zero"
                  shortLabel="Z"
                  active={displayFlags.zero}
                  description="Set when result is 0"
                />
                <FlagIndicator
                  label="Carry"
                  shortLabel="C"
                  active={displayFlags.carry}
                  description="Set on unsigned overflow/borrow"
                />
                <FlagIndicator
                  label="Overflow"
                  shortLabel="V"
                  active={displayFlags.overflow}
                  description="Set on signed overflow"
                />
                <FlagIndicator
                  label="Negative"
                  shortLabel="N"
                  active={displayFlags.negative}
                  description="Set when MSB of result is 1"
                />
              </div>
            </div>
          </motion.div>

          {/* ── Internal detail view ───────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25, ease: [0.23, 1, 0.32, 1] }}
            className="mb-4"
          >
            <AnimatePresence>
              <InternalDetailView
                operation={operation}
                inputA={inputA}
                inputB={inputB}
                aluResult={aluResult}
                visible={showInternalDetail}
              />
            </AnimatePresence>
          </motion.div>

          {/* ── Controls ───────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="mb-4"
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
              {/* Internal detail toggle */}
              <button
                onClick={() => setShowInternalDetail(!showInternalDetail)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                style={{
                  background: showInternalDetail
                    ? "rgba(99,102,241,0.1)"
                    : "#1e1e2e",
                  color: showInternalDetail ? COLORS.primary : "#a1a1aa",
                  border: showInternalDetail
                    ? "1px solid rgba(99,102,241,0.2)"
                    : "1px solid transparent",
                }}
              >
                <Cpu size={12} />
                Internal
              </button>

              {/* Phase badge */}
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                style={{
                  background:
                    phase === "output"
                      ? "rgba(16,185,129,0.1)"
                      : phase === "idle"
                      ? "rgba(113,113,122,0.1)"
                      : "rgba(99,102,241,0.1)",
                  border: `1px solid ${
                    phase === "output"
                      ? "rgba(16,185,129,0.2)"
                      : phase === "idle"
                      ? "rgba(113,113,122,0.2)"
                      : "rgba(99,102,241,0.2)"
                  }`,
                }}
              >
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background:
                      phase === "output"
                        ? COLORS.success
                        : phase === "idle"
                        ? COLORS.muted
                        : COLORS.primary,
                  }}
                />
                <span
                  className="text-xs font-mono font-medium"
                  style={{
                    color:
                      phase === "output"
                        ? COLORS.success
                        : phase === "idle"
                        ? COLORS.muted
                        : COLORS.primary,
                  }}
                >
                  {phase === "idle" ? "Ready" : phase.replace("-", " ").toUpperCase()}
                </span>
              </div>
            </ModuleControls>
          </motion.div>

          {/* ── Metrics Panel ──────────────────────────────────────────── */}
          <AnimatePresence>
            {showMetrics && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="flex flex-wrap gap-3 mb-4"
              >
                {[
                  {
                    label: "Operations",
                    value: operationCount.toString(),
                    color: COLORS.primary,
                  },
                  {
                    label: "Current Op",
                    value: `${OPERATIONS[operation].label} (${OPERATIONS[operation].opcode})`,
                    color: COLORS.secondary,
                  },
                  {
                    label: "Result (Dec)",
                    value: displayResult.toString(),
                    color: COLORS.success,
                  },
                  {
                    label: "Result (Bin)",
                    value: numberToBits(displayResult).join(""),
                    color: COLORS.success,
                  },
                  {
                    label: "Active Flags",
                    value: [
                      displayFlags.zero && "Z",
                      displayFlags.carry && "C",
                      displayFlags.overflow && "V",
                      displayFlags.negative && "N",
                    ]
                      .filter(Boolean)
                      .join(" ") || "None",
                    color: COLORS.accent,
                  },
                ].map((metric) => (
                  <div
                    key={metric.label}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{
                      background: COLORS.card,
                      border: `1px solid ${COLORS.border}`,
                    }}
                  >
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                        {metric.label}
                      </span>
                      <span
                        className="text-sm font-mono font-semibold"
                        style={{ color: metric.color }}
                      >
                        {metric.value}
                      </span>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Educational Info ────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"
          >
            {/* ALU Operations Reference */}
            <div
              className="rounded-2xl p-5"
              style={{
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Activity size={14} style={{ color: COLORS.primary }} />
                <span className="text-sm font-semibold text-white">
                  ALU Operations Reference
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b" style={{ borderColor: COLORS.border }}>
                      <th className="px-2 py-2 text-left font-medium text-[#71717a]">Op</th>
                      <th className="px-2 py-2 text-left font-medium text-[#71717a]">Opcode</th>
                      <th className="px-2 py-2 text-left font-medium text-[#71717a]">Symbol</th>
                      <th className="px-2 py-2 text-left font-medium text-[#71717a]">Function</th>
                      <th className="px-2 py-2 text-left font-medium text-[#71717a]">Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {OPERATION_KEYS.map((op) => {
                      const info = OPERATIONS[op];
                      const isActive = operation === op;
                      const categoryColor =
                        info.category === "arithmetic"
                          ? COLORS.primary
                          : info.category === "logic"
                          ? COLORS.secondary
                          : COLORS.accent;

                      return (
                        <tr
                          key={op}
                          className="border-b cursor-pointer transition-colors duration-150"
                          style={{
                            borderColor: "rgba(30,30,46,0.5)",
                            background: isActive ? "rgba(99,102,241,0.04)" : "transparent",
                          }}
                          onClick={() => {
                            setOperation(op);
                            if (phase !== "idle") {
                              setPhase("idle");
                              phaseRef.current = "idle";
                            }
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive) e.currentTarget.style.background = "#16161f";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = isActive
                              ? "rgba(99,102,241,0.04)"
                              : "transparent";
                          }}
                        >
                          <td className="px-2 py-2 font-mono font-semibold" style={{ color: isActive ? "#ffffff" : "#a1a1aa" }}>
                            {info.label}
                          </td>
                          <td className="px-2 py-2 font-mono" style={{ color: COLORS.primary }}>
                            {info.opcode}
                          </td>
                          <td className="px-2 py-2 font-mono font-bold" style={{ color: categoryColor }}>
                            {info.symbol}
                          </td>
                          <td className="px-2 py-2 font-mono" style={{ color: "#a1a1aa" }}>
                            {info.description}
                          </td>
                          <td className="px-2 py-2">
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                              style={{
                                background: `${categoryColor}15`,
                                color: categoryColor,
                                border: `1px solid ${categoryColor}30`,
                              }}
                            >
                              {info.category}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Flags Explanation */}
            <div
              className="rounded-2xl p-5"
              style={{
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb size={14} style={{ color: COLORS.accent }} />
                <span className="text-sm font-semibold text-white">
                  Status Flags Explained
                </span>
              </div>
              <div className="space-y-3">
                {[
                  {
                    flag: "Z (Zero)",
                    color: COLORS.accent,
                    desc: "Set when the result is exactly 0. Used for equality comparisons (if A - B = 0, then A == B).",
                    example: "5 - 5 = 0 → Z=1",
                  },
                  {
                    flag: "C (Carry)",
                    color: COLORS.danger,
                    desc: "Set when an unsigned operation produces a result larger than 8 bits (carry out) or a borrow in subtraction.",
                    example: "200 + 100 = 300 → C=1 (300 > 255)",
                  },
                  {
                    flag: "V (Overflow)",
                    color: COLORS.primary,
                    desc: "Set when a signed operation produces a result outside the -128 to 127 range. Detected when the sign of the result contradicts the signs of the operands.",
                    example: "127 + 1 = -128 → V=1",
                  },
                  {
                    flag: "N (Negative)",
                    color: COLORS.secondary,
                    desc: "Set when the most significant bit (bit 7) of the result is 1, indicating a negative number in two's complement.",
                    example: "5 - 10 = -5 → N=1",
                  },
                ].map((item) => (
                  <div
                    key={item.flag}
                    className="rounded-lg p-3"
                    style={{ background: "#1e1e2e" }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="font-mono text-xs font-bold"
                        style={{ color: item.color }}
                      >
                        {item.flag}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#a1a1aa] mb-1">{item.desc}</p>
                    <p className="text-[10px] font-mono" style={{ color: item.color }}>
                      {item.example}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* ── Step-by-Step Pipeline ───────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.45, ease: [0.23, 1, 0.32, 1] }}
            className="rounded-2xl overflow-hidden mb-6"
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <div className="px-5 py-3.5 border-b" style={{ borderColor: COLORS.border }}>
              <div className="flex items-center gap-2">
                <ArrowRight size={14} style={{ color: COLORS.secondary }} />
                <span className="text-sm font-semibold text-white">
                  ALU Pipeline Stages
                </span>
              </div>
            </div>
            <div className="p-5">
              <div className="flex items-center gap-2 flex-wrap">
                {PHASE_SEQUENCE.map((p, i) => {
                  const phaseIndex = PHASE_SEQUENCE.indexOf(phase);
                  const currentIndex = PHASE_SEQUENCE.indexOf(p);
                  const isActive = p === phase;
                  const isPast = phase !== "idle" && currentIndex < phaseIndex;
                  const isFuture = phase === "idle" || currentIndex > phaseIndex;

                  const phaseLabels: Record<SimulationPhase, string> = {
                    idle: "Ready",
                    "load-a": "1. Load A",
                    "load-b": "2. Load B",
                    "select-op": "3. Select Op",
                    compute: "4. Compute",
                    output: "5. Output",
                  };

                  const phaseColors: Record<SimulationPhase, string> = {
                    idle: COLORS.muted,
                    "load-a": COLORS.inputA,
                    "load-b": COLORS.inputB,
                    "select-op": COLORS.primary,
                    compute: COLORS.accent,
                    output: COLORS.success,
                  };

                  return (
                    <div key={p} className="flex items-center gap-2">
                      <motion.div
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg"
                        style={{
                          background: isActive
                            ? `${phaseColors[p]}15`
                            : isPast
                            ? `${COLORS.success}08`
                            : "#1e1e2e",
                          border: `1px solid ${
                            isActive
                              ? `${phaseColors[p]}40`
                              : isPast
                              ? `${COLORS.success}20`
                              : "#2a2a3e"
                          }`,
                        }}
                        animate={isActive ? { scale: [1, 1.02, 1] } : {}}
                        transition={isActive ? { duration: 1, repeat: Infinity } : {}}
                      >
                        <Circle
                          size={8}
                          fill={
                            isActive
                              ? phaseColors[p]
                              : isPast
                              ? COLORS.success
                              : "#3a3a4a"
                          }
                          style={{
                            color: isActive
                              ? phaseColors[p]
                              : isPast
                              ? COLORS.success
                              : "#3a3a4a",
                          }}
                        />
                        <span
                          className="text-xs font-medium"
                          style={{
                            color: isActive
                              ? phaseColors[p]
                              : isPast
                              ? COLORS.success
                              : "#4a4a5a",
                          }}
                        >
                          {phaseLabels[p]}
                        </span>
                      </motion.div>
                      {i < PHASE_SEQUENCE.length - 1 && (
                        <ChevronRight
                          size={14}
                          style={{
                            color: isPast ? `${COLORS.success}60` : "#2a2a3e",
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 text-xs" style={{ color: "#71717a" }}>
                {phase === "idle" && "Press Play or Step to begin the ALU cycle."}
                {phase === "load-a" && `Loading input A (${inputA}) into the ALU...`}
                {phase === "load-b" &&
                  (operation === "NOT"
                    ? "Input B not needed for NOT operation."
                    : `Loading input B (${inputB}) into the ALU...`)}
                {phase === "select-op" &&
                  `Selecting operation: ${OPERATIONS[operation].label} (opcode ${OPERATIONS[operation].opcode})...`}
                {phase === "compute" &&
                  `Computing ${inputA} ${OPERATIONS[operation].symbol} ${operation === "NOT" ? "" : inputB}...`}
                {phase === "output" &&
                  `Result: ${displayResult} | Flags: ${
                    [
                      displayFlags.zero && "Zero",
                      displayFlags.carry && "Carry",
                      displayFlags.overflow && "Overflow",
                      displayFlags.negative && "Negative",
                    ]
                      .filter(Boolean)
                      .join(", ") || "None"
                  }`}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
