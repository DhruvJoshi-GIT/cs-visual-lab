"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, Plus, Minus, AlertTriangle, RotateCcw, ChevronDown, Info, CircleDot, Cpu, Binary, ArrowRight, Hash } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

type OperationType =
  | "twos-complement"
  | "addition"
  | "subtraction"
  | "overflow";

type AnimationPhase =
  | "idle"
  | "flip-bits"
  | "add-one"
  | "complete"
  | "carry-propagate"
  | "result-show"
  | "negate"
  | "add-step"
  | "overflow-check";

interface ScenarioPreset {
  id: string;
  label: string;
  operation: OperationType;
  operandA: number[];
  operandB: number[];
  description: string;
}

interface StepInfo {
  phase: AnimationPhase;
  bitPosition: number;
  description: string;
}

interface OperationInfo {
  title: string;
  description: string;
  details: string[];
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
};

const BIT_WIDTH = 8;

const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: "simple-addition",
    label: "Simple Addition",
    operation: "addition",
    operandA: [0, 0, 0, 0, 0, 1, 0, 1], // 5
    operandB: [0, 0, 0, 0, 0, 0, 1, 1], // 3
    description: "5 + 3 = 8, basic binary addition with no carry chain",
  },
  {
    id: "carry-chain",
    label: "Carry Chain",
    operation: "addition",
    operandA: [0, 0, 1, 1, 1, 1, 1, 1], // 63
    operandB: [0, 0, 0, 0, 0, 0, 0, 1], // 1
    description: "63 + 1 = 64, demonstrates ripple carry through multiple bits",
  },
  {
    id: "twos-complement",
    label: "Two's Complement",
    operation: "twos-complement",
    operandA: [0, 0, 0, 0, 0, 1, 0, 1], // 5
    operandB: [0, 0, 0, 0, 0, 0, 0, 0],
    description: "Convert +5 to -5 using two's complement: flip all bits then add 1",
  },
  {
    id: "overflow-demo",
    label: "Overflow Demo",
    operation: "overflow",
    operandA: [0, 1, 1, 1, 1, 1, 1, 1], // 127
    operandB: [0, 0, 0, 0, 0, 0, 0, 1], // 1
    description: "127 + 1 causes signed overflow: result appears negative",
  },
];

const OPERATION_INFO: Record<OperationType, OperationInfo> = {
  "twos-complement": {
    title: "Two's Complement Representation",
    description: "Two's complement is the standard method for representing signed integers in binary. To negate a number: invert all bits (one's complement), then add 1. The MSB (leftmost bit) serves as the sign bit: 0 for positive, 1 for negative.",
    details: [
      "Range for 8 bits: -128 to +127 (asymmetric because of zero). MSB (bit 7) is the sign bit.",
      "Step 1: Flip every bit (0 becomes 1, 1 becomes 0) -- this is the one's complement",
      "Step 2: Add 1 to the result to get the two's complement (the negation)",
      "Advantage: Addition and subtraction use the same hardware circuit",
    ],
  },
  addition: {
    title: "Binary Addition",
    description: "Binary addition follows the same column-by-column process as decimal addition, but with only two digits (0 and 1). When the sum of a column exceeds 1, a carry is generated to the next column.",
    details: [
      "Rules: 0+0=0, 0+1=1, 1+0=1, 1+1=10 (0 carry 1), 1+1+1=11 (1 carry 1)",
      "Carry propagation goes from LSB (rightmost) to MSB (leftmost)",
      "The ripple carry adder processes one bit at a time, cascading carries",
      "Faster adders (carry-lookahead) predict carries to speed up addition",
    ],
  },
  subtraction: {
    title: "Binary Subtraction via Two's Complement",
    description: "Binary subtraction is performed by converting the subtrahend to its two's complement (negation) and then adding. This allows the same adder hardware to perform both addition and subtraction.",
    details: [
      "A - B is computed as A + (-B), where -B is the two's complement of B",
      "Step 1: Find two's complement of B (flip bits, add 1). Step 2: Add result to A",
      "The hardware only needs an adder and an inverter (XOR gates)",
      "Any carry out of the MSB is discarded in fixed-width arithmetic",
    ],
  },
  overflow: {
    title: "Overflow Detection",
    description: "Overflow occurs when the result of an arithmetic operation exceeds the range representable by the number of bits. For signed numbers, overflow is detected when the carry into the MSB differs from the carry out of the MSB.",
    details: [
      "Signed 8-bit range: -128 to +127; unsigned: 0 to 255",
      "Signed overflow: adding two positive numbers gives a negative, or vice versa",
      "Detection rule: overflow = carry_in_to_MSB XOR carry_out_of_MSB",
      "CPUs set separate flags: Overflow (V) for signed, Carry (C) for unsigned",
    ],
  },
};

// ─── Helper Functions ─────────────────────────────────────────────────────────

function bitsToUnsigned(bits: number[]): number {
  let value = 0;
  for (let i = 0; i < bits.length; i++) {
    value = (value << 1) | bits[i];
  }
  return value;
}

function bitsToSigned(bits: number[]): number {
  if (bits[0] === 0) return bitsToUnsigned(bits);
  // Negative: find two's complement
  const flipped = bits.map((b) => (b === 0 ? 1 : 0));
  let value = bitsToUnsigned(flipped) + 1;
  return -value;
}

function unsignedToBits(value: number, width: number): number[] {
  const bits: number[] = [];
  const mask = (1 << width) - 1;
  const v = value & mask;
  for (let i = width - 1; i >= 0; i--) {
    bits.push((v >> i) & 1);
  }
  return bits;
}

function flipBits(bits: number[]): number[] {
  return bits.map((b) => (b === 0 ? 1 : 0));
}

function addBits(a: number[], b: number[]): { result: number[]; carries: number[]; carryOut: number } {
  const n = a.length;
  const result: number[] = new Array(n).fill(0);
  const carries: number[] = new Array(n + 1).fill(0);

  for (let i = n - 1; i >= 0; i--) {
    const sum = a[i] + b[i] + carries[i + 1];
    result[i] = sum % 2;
    carries[i] = Math.floor(sum / 2);
  }

  return { result, carries, carryOut: carries[0] };
}

function detectOverflow(a: number[], b: number[], result: number[]): boolean {
  // Signed overflow: if both operands have the same sign but result has different sign
  return (a[0] === b[0]) && (result[0] !== a[0]);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BinaryArithmeticPage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [operation, setOperation] = useState<OperationType>("addition");
  const [operandA, setOperandA] = useState<number[]>([0, 0, 0, 0, 0, 1, 0, 1]); // 5
  const [operandB, setOperandB] = useState<number[]>([0, 0, 0, 0, 0, 0, 1, 1]); // 3
  const [resultBits, setResultBits] = useState<number[]>(new Array(BIT_WIDTH).fill(0));
  const [carries, setCarries] = useState<number[]>(new Array(BIT_WIDTH + 1).fill(0));
  const [flippedBits, setFlippedBits] = useState<number[]>(new Array(BIT_WIDTH).fill(0));
  const [currentBitPos, setCurrentBitPos] = useState(-1);
  const [phase, setPhase] = useState<AnimationPhase>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const [carryCount, setCarryCount] = useState(0);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [stepDescription, setStepDescription] = useState("Ready. Press Play or Step to begin.");
  const [negatedBits, setNegatedBits] = useState<number[]>(new Array(BIT_WIDTH).fill(0));
  const [showSubtractionIntermediate, setShowSubtractionIntermediate] = useState(false);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const stepsRef = useRef<StepInfo[]>([]);
  const stepIndexRef = useRef(0);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // ── Build steps for current operation ───────────────────────────────────────
  const buildSteps = useCallback((): StepInfo[] => {
    const steps: StepInfo[] = [];

    switch (operation) {
      case "twos-complement": {
        // Phase 1: Flip each bit one by one
        for (let i = 0; i < BIT_WIDTH; i++) {
          steps.push({
            phase: "flip-bits",
            bitPosition: i,
            description: `Flip bit ${BIT_WIDTH - 1 - i}: ${operandA[i]} becomes ${operandA[i] === 0 ? 1 : 0}`,
          });
        }
        // Phase 2: Add 1 (carry propagation from LSB)
        const flipped = flipBits(operandA);
        const one = new Array(BIT_WIDTH).fill(0);
        one[BIT_WIDTH - 1] = 1;
        let carry = 0;
        for (let i = BIT_WIDTH - 1; i >= 0; i--) {
          const addVal = i === BIT_WIDTH - 1 ? 1 : 0;
          const sum = flipped[i] + addVal + carry;
          carry = Math.floor(sum / 2);
          steps.push({
            phase: "add-one",
            bitPosition: i,
            description: `Add 1: position ${BIT_WIDTH - 1 - i}, ${flipped[i]} + ${addVal} + carry(${carry > 0 && i < BIT_WIDTH - 1 ? 1 : 0}) = ${sum % 2}${Math.floor(sum / 2) > 0 ? " (carry)" : ""}`,
          });
          if (carry === 0 && i < BIT_WIDTH - 1) break;
        }
        steps.push({
          phase: "complete",
          bitPosition: -1,
          description: "Two's complement complete! The result is the negation of the original number.",
        });
        break;
      }
      case "addition":
      case "overflow": {
        // Carry propagation right to left
        for (let i = BIT_WIDTH - 1; i >= 0; i--) {
          steps.push({
            phase: "carry-propagate",
            bitPosition: i,
            description: `Add bit position ${BIT_WIDTH - 1 - i}: ${operandA[i]} + ${operandB[i]}`,
          });
        }
        steps.push({
          phase: operation === "overflow" ? "overflow-check" : "result-show",
          bitPosition: -1,
          description: operation === "overflow"
            ? "Checking for signed overflow..."
            : "Addition complete! Result is ready.",
        });
        steps.push({
          phase: "complete",
          bitPosition: -1,
          description: operation === "overflow"
            ? "Overflow detection complete."
            : "Binary addition complete.",
        });
        break;
      }
      case "subtraction": {
        // Phase 1: Negate B (flip bits)
        for (let i = 0; i < BIT_WIDTH; i++) {
          steps.push({
            phase: "negate",
            bitPosition: i,
            description: `Negate B: flip bit ${BIT_WIDTH - 1 - i}: ${operandB[i]} becomes ${operandB[i] === 0 ? 1 : 0}`,
          });
        }
        // Phase 1b: Add 1 to complete two's complement
        steps.push({
          phase: "add-one",
          bitPosition: BIT_WIDTH - 1,
          description: "Add 1 to complete two's complement of B",
        });
        // Phase 2: Add A + (-B)
        for (let i = BIT_WIDTH - 1; i >= 0; i--) {
          steps.push({
            phase: "add-step",
            bitPosition: i,
            description: `Add: A[${BIT_WIDTH - 1 - i}] + (-B)[${BIT_WIDTH - 1 - i}]`,
          });
        }
        steps.push({
          phase: "result-show",
          bitPosition: -1,
          description: "Subtraction complete! A - B computed as A + two's complement(B).",
        });
        steps.push({
          phase: "complete",
          bitPosition: -1,
          description: "Binary subtraction complete.",
        });
        break;
      }
    }

    return steps;
  }, [operation, operandA, operandB]);

  // ── Execute a single step ───────────────────────────────────────────────────
  const executeStep = useCallback((step: StepInfo, idx: number) => {
    setStepDescription(step.description);
    setCurrentBitPos(step.bitPosition);
    setPhase(step.phase);
    setStepIndex(idx);

    switch (step.phase) {
      case "flip-bits": {
        // Flip one bit at a time for two's complement
        setFlippedBits((prev) => {
          const next = [...prev];
          next[step.bitPosition] = operandA[step.bitPosition] === 0 ? 1 : 0;
          return next;
        });
        break;
      }
      case "add-one": {
        if (operation === "twos-complement") {
          // Add 1 to flipped bits
          setFlippedBits((prevFlipped) => {
            const one = new Array(BIT_WIDTH).fill(0);
            one[BIT_WIDTH - 1] = 1;
            const { result: addResult } = addBits(prevFlipped, one);
            setResultBits(addResult);
            return prevFlipped;
          });
        } else if (operation === "subtraction") {
          // Complete two's complement of B
          const flippedB = flipBits(operandB);
          const one = new Array(BIT_WIDTH).fill(0);
          one[BIT_WIDTH - 1] = 1;
          const { result: negB } = addBits(flippedB, one);
          setNegatedBits(negB);
          setShowSubtractionIntermediate(true);
        }
        break;
      }
      case "carry-propagate": {
        // Process one bit column at a time
        const pos = step.bitPosition;
        setCarries((prevCarries) => {
          const newCarries = [...prevCarries];
          const carryIn = pos < BIT_WIDTH - 1 ? newCarries[pos + 1] : 0;
          const sum = operandA[pos] + operandB[pos] + carryIn;
          newCarries[pos] = Math.floor(sum / 2);

          setResultBits((prevResult) => {
            const r = [...prevResult];
            r[pos] = sum % 2;
            return r;
          });

          if (Math.floor(sum / 2) > 0) {
            setCarryCount((c) => c + 1);
          }

          return newCarries;
        });
        break;
      }
      case "negate": {
        // Flip B bits one at a time
        setFlippedBits((prev) => {
          const next = [...prev];
          next[step.bitPosition] = operandB[step.bitPosition] === 0 ? 1 : 0;
          return next;
        });
        break;
      }
      case "add-step": {
        // Add A + negated B, one bit at a time
        const pos = step.bitPosition;
        setCarries((prevCarries) => {
          const newCarries = [...prevCarries];
          const carryIn = pos < BIT_WIDTH - 1 ? newCarries[pos + 1] : 0;
          const bVal = negatedBits[pos];
          const sum = operandA[pos] + bVal + carryIn;
          newCarries[pos] = Math.floor(sum / 2);

          setResultBits((prevResult) => {
            const r = [...prevResult];
            r[pos] = sum % 2;
            return r;
          });

          if (Math.floor(sum / 2) > 0) {
            setCarryCount((c) => c + 1);
          }

          return newCarries;
        });
        break;
      }
      case "overflow-check": {
        // Check for signed overflow
        setResultBits((prevResult) => {
          const overflow = detectOverflow(operandA, operandB, prevResult);
          setHasOverflow(overflow);
          return prevResult;
        });
        break;
      }
      case "result-show":
      case "complete": {
        if (step.phase === "complete") {
          setIsComplete(true);
          setIsPlaying(false);
          isPlayingRef.current = false;
          if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
          }
        }
        break;
      }
    }
  }, [operation, operandA, operandB, negatedBits]);

  // ── Step forward ────────────────────────────────────────────────────────────
  const stepForward = useCallback(() => {
    const steps = stepsRef.current;
    const idx = stepIndexRef.current;

    if (idx >= steps.length) {
      setIsComplete(true);
      setIsPlaying(false);
      isPlayingRef.current = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    executeStep(steps[idx], idx);
    stepIndexRef.current = idx + 1;
  }, [executeStep]);

  // ── Initialize steps when operation or operands change ──────────────────────
  useEffect(() => {
    const steps = buildSteps();
    stepsRef.current = steps;
    setTotalSteps(steps.length);
  }, [buildSteps]);

  // ── Animation loop ──────────────────────────────────────────────────────────
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

  // ── Playback controls ──────────────────────────────────────────────────────
  const handlePlay = useCallback(() => {
    if (isComplete) return;
    setIsPlaying(true);
    isPlayingRef.current = true;
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop, isComplete]);

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
    stepForward();
  }, [handlePause, stepForward, isComplete]);

  const handleReset = useCallback(() => {
    handlePause();
    setResultBits(new Array(BIT_WIDTH).fill(0));
    setCarries(new Array(BIT_WIDTH + 1).fill(0));
    setFlippedBits(new Array(BIT_WIDTH).fill(0));
    setNegatedBits(new Array(BIT_WIDTH).fill(0));
    setCurrentBitPos(-1);
    setPhase("idle");
    setStepIndex(0);
    stepIndexRef.current = 0;
    setCarryCount(0);
    setHasOverflow(false);
    setIsComplete(false);
    setShowSubtractionIntermediate(false);
    setStepDescription("Ready. Press Play or Step to begin.");
    // Rebuild steps
    const steps = buildSteps();
    stepsRef.current = steps;
    setTotalSteps(steps.length);
  }, [handlePause, buildSteps]);

  // Toggle individual bit
  const toggleBit = useCallback((operand: "A" | "B", index: number) => {
    if (isPlaying || isComplete) return;
    if (operand === "A") {
      setOperandA((prev) => {
        const next = [...prev];
        next[index] = next[index] === 0 ? 1 : 0;
        return next;
      });
    } else {
      setOperandB((prev) => {
        const next = [...prev];
        next[index] = next[index] === 0 ? 1 : 0;
        return next;
      });
    }
  }, [isPlaying, isComplete]);

  // Apply scenario preset
  const applyPreset = useCallback(
    (preset: ScenarioPreset) => {
      handlePause();
      setOperation(preset.operation);
      setOperandA([...preset.operandA]);
      setOperandB([...preset.operandB]);
      setResultBits(new Array(BIT_WIDTH).fill(0));
      setCarries(new Array(BIT_WIDTH + 1).fill(0));
      setFlippedBits(new Array(BIT_WIDTH).fill(0));
      setNegatedBits(new Array(BIT_WIDTH).fill(0));
      setCurrentBitPos(-1);
      setPhase("idle");
      setStepIndex(0);
      stepIndexRef.current = 0;
      setCarryCount(0);
      setHasOverflow(false);
      setIsComplete(false);
      setShowSubtractionIntermediate(false);
      setStepDescription("Ready. Press Play or Step to begin.");
    },
    [handlePause]
  );

  // Reset when operation changes
  useEffect(() => {
    handleReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operation]);

  // Reset when operands change
  useEffect(() => {
    if (phase !== "idle") {
      handleReset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operandA, operandB]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const decimalA = bitsToUnsigned(operandA);
  const signedA = bitsToSigned(operandA);
  const decimalB = bitsToUnsigned(operandB);
  const signedB = bitsToSigned(operandB);
  const decimalResult = bitsToUnsigned(resultBits);
  const signedResult = bitsToSigned(resultBits);
  const info = OPERATION_INFO[operation];

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
                1.5
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Binary Arithmetic
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Visualize binary number operations step by step. Watch carry chains propagate,
              two&apos;s complement negation unfold, and understand how computers perform
              arithmetic at the bit level.
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
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium"
                style={{
                  background: "rgba(245,158,11,0.08)",
                  color: "#f59e0b",
                  border: "1px solid rgba(245,158,11,0.15)",
                }}
              >
                <Zap size={11} />
                Prerequisite: Number Systems & Logic Gates
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
            {/* Operation dropdown */}
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <Binary size={14} className="text-[#6366f1]" />
                {operation === "twos-complement"
                  ? "Two's Complement"
                  : operation === "addition"
                  ? "Binary Addition"
                  : operation === "subtraction"
                  ? "Binary Subtraction"
                  : "Overflow Detection"}
                <ChevronDown
                  size={14}
                  className="text-[#71717a]"
                  style={{
                    transform: dropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 200ms ease",
                  }}
                />
              </button>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 mt-1.5 z-50 rounded-xl overflow-hidden"
                    style={{
                      background: COLORS.card,
                      border: `1px solid ${COLORS.border}`,
                      boxShadow: "0 20px 40px rgba(0,0,0,0.5), 0 0 1px rgba(99,102,241,0.1)",
                      minWidth: "240px",
                    }}
                  >
                    {(["twos-complement", "addition", "subtraction", "overflow"] as OperationType[]).map((op) => {
                      const labels: Record<OperationType, string> = {
                        "twos-complement": "Two's Complement",
                        addition: "Binary Addition",
                        subtraction: "Binary Subtraction",
                        overflow: "Overflow Detection",
                      };
                      return (
                        <button
                          key={op}
                          onClick={() => {
                            setOperation(op);
                            setDropdownOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-all duration-150"
                          style={{
                            color: operation === op ? "#6366f1" : "#a1a1aa",
                            background: operation === op ? "rgba(99,102,241,0.08)" : "transparent",
                          }}
                          onMouseEnter={(e) => {
                            if (operation !== op) e.currentTarget.style.background = "#16161f";
                          }}
                          onMouseLeave={(e) => {
                            if (operation !== op) e.currentTarget.style.background = "transparent";
                          }}
                        >
                          <span className="font-medium">{labels[op]}</span>
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex-1" />

            {/* Preset buttons */}
            <div className="flex items-center gap-1">
              {SCENARIO_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                  style={{
                    background:
                      operation === preset.operation &&
                      JSON.stringify(operandA) === JSON.stringify(preset.operandA) &&
                      JSON.stringify(operandB) === JSON.stringify(preset.operandB)
                        ? "rgba(99,102,241,0.12)"
                        : "transparent",
                    color:
                      operation === preset.operation &&
                      JSON.stringify(operandA) === JSON.stringify(preset.operandA)
                        ? "#6366f1"
                        : "#71717a",
                    border:
                      operation === preset.operation &&
                      JSON.stringify(operandA) === JSON.stringify(preset.operandA) &&
                      JSON.stringify(operandB) === JSON.stringify(preset.operandB)
                        ? "1px solid rgba(99,102,241,0.2)"
                        : "1px solid transparent",
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
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
            {/* Step description bar */}
            <div
              className="flex items-center gap-3 px-5 py-3 border-b"
              style={{ borderColor: COLORS.border }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  background: isComplete
                    ? COLORS.success
                    : phase === "idle"
                    ? COLORS.muted
                    : COLORS.secondary,
                  boxShadow: isComplete
                    ? `0 0 8px ${COLORS.success}60`
                    : phase !== "idle"
                    ? `0 0 8px ${COLORS.secondary}60`
                    : "none",
                }}
              />
              <span className="text-xs font-mono text-[#a1a1aa] flex-1">{stepDescription}</span>
              <span className="text-[10px] font-mono text-[#71717a]">
                Step {stepIndex}/{totalSteps}
              </span>
            </div>

            {/* Visualization area */}
            <div className="p-6" style={{ minHeight: "420px" }}>
              {operation === "twos-complement" ? (
                <TwosComplementViz
                  operandA={operandA}
                  flippedBits={flippedBits}
                  resultBits={resultBits}
                  currentBitPos={currentBitPos}
                  phase={phase}
                  toggleBit={toggleBit}
                />
              ) : operation === "addition" || operation === "overflow" ? (
                <AdditionViz
                  operandA={operandA}
                  operandB={operandB}
                  resultBits={resultBits}
                  carries={carries}
                  currentBitPos={currentBitPos}
                  phase={phase}
                  hasOverflow={hasOverflow}
                  isOverflowMode={operation === "overflow"}
                  toggleBit={toggleBit}
                />
              ) : (
                <SubtractionViz
                  operandA={operandA}
                  operandB={operandB}
                  flippedBits={flippedBits}
                  negatedBits={negatedBits}
                  resultBits={resultBits}
                  carries={carries}
                  currentBitPos={currentBitPos}
                  phase={phase}
                  showIntermediate={showSubtractionIntermediate}
                  toggleBit={toggleBit}
                />
              )}
            </div>

            {/* Decimal conversion display */}
            <div
              className="flex items-center justify-center gap-6 px-5 py-3 border-t flex-wrap"
              style={{ borderColor: COLORS.border }}
            >
              <DecimalDisplay label="A" bits={operandA} />
              {(operation === "addition" || operation === "subtraction" || operation === "overflow") && (
                <DecimalDisplay label="B" bits={operandB} />
              )}
              {(phase === "complete" || phase === "result-show" || phase === "overflow-check") && (
                <>
                  <div className="w-px h-4" style={{ background: COLORS.border }} />
                  <DecimalDisplay label="Result" bits={resultBits} highlight />
                </>
              )}
            </div>

            {/* Color legend */}
            <div
              className="flex items-center justify-center gap-5 px-4 py-2.5 border-t"
              style={{ borderColor: COLORS.border }}
            >
              {[
                { color: COLORS.secondary, label: "Active Bit" },
                { color: COLORS.accent, label: "Carry" },
                { color: COLORS.success, label: "Result" },
                { color: COLORS.danger, label: "Overflow" },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ background: color, border: `1px solid ${color}80` }}
                  />
                  <span className="text-[11px] text-[#71717a]">{label}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* ── Controls ──────────────────────────────────────────────── */}
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
              {/* Completion badge */}
              <AnimatePresence>
                {isComplete && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                    style={{
                      background: hasOverflow ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)",
                      border: hasOverflow
                        ? "1px solid rgba(239,68,68,0.2)"
                        : "1px solid rgba(16,185,129,0.2)",
                    }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: hasOverflow ? "#ef4444" : "#10b981" }}
                    />
                    <span
                      className="text-xs font-medium"
                      style={{ color: hasOverflow ? "#ef4444" : "#10b981" }}
                    >
                      {hasOverflow ? "Overflow!" : "Complete"}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </ModuleControls>
          </motion.div>

          {/* ── Metrics panel ──────────────────────────────────────────── */}
          <AnimatePresence>
            {showMetrics && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-4"
              >
                <div
                  className="rounded-2xl p-5"
                  style={{
                    background: COLORS.card,
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <Hash size={14} className="text-[#6366f1]" />
                    <span className="text-sm font-semibold text-white">Metrics</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <MetricCard label="Carry Count" value={carryCount.toString()} color="#f59e0b" />
                    <MetricCard
                      label="Current Bit"
                      value={currentBitPos >= 0 ? `Pos ${BIT_WIDTH - 1 - currentBitPos}` : "--"}
                      color="#06b6d4"
                    />
                    <MetricCard
                      label="Result (unsigned)"
                      value={
                        phase === "complete" || phase === "result-show" || phase === "overflow-check"
                          ? decimalResult.toString()
                          : "--"
                      }
                      color="#10b981"
                    />
                    <MetricCard
                      label="Result (signed)"
                      value={
                        phase === "complete" || phase === "result-show" || phase === "overflow-check"
                          ? signedResult.toString()
                          : "--"
                      }
                      color={hasOverflow ? "#ef4444" : "#6366f1"}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Educational info ───────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="mt-6 rounded-2xl overflow-hidden"
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <div className="px-5 py-3.5 border-b" style={{ borderColor: COLORS.border }}>
              <div className="flex items-center gap-2">
                <Info size={14} className="text-[#6366f1]" />
                <span className="text-sm font-semibold text-white">{info.title}</span>
              </div>
            </div>
            <div className="p-5">
              <p className="text-sm text-[#a1a1aa] mb-4">{info.description}</p>
              <div className="space-y-2">
                {info.details.map((detail, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <CircleDot size={10} className="text-[#6366f1] mt-1.5 flex-shrink-0" />
                    <span className="text-xs text-[#a1a1aa]">{detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Close dropdown overlay */}
      {dropdownOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
      )}
    </div>
  );
}

// ─── Bit Box Component ────────────────────────────────────────────────────────

function BitBox({
  value,
  index,
  isActive,
  color,
  onClick,
  label,
  glow,
  size = "normal",
}: {
  value: number;
  index: number;
  isActive: boolean;
  color: string;
  onClick?: () => void;
  label?: string;
  glow?: boolean;
  size?: "normal" | "small";
}) {
  const isSmall = size === "small";
  const boxSize = isSmall ? "w-9 h-9" : "w-12 h-12";
  const fontSize = isSmall ? "text-sm" : "text-lg";

  return (
    <div className="flex flex-col items-center gap-1">
      {label && (
        <span className="text-[8px] font-mono text-[#71717a] uppercase">{label}</span>
      )}
      <motion.button
        animate={{
          scale: isActive ? 1.1 : 1,
          borderColor: isActive ? color : value === 1 ? "#3a3a4e" : "#2a2a3e",
          boxShadow: glow || isActive
            ? `0 0 16px ${color}40`
            : "none",
        }}
        transition={{ duration: 0.15 }}
        onClick={onClick}
        className={`${boxSize} rounded-lg border-2 flex items-center justify-center ${fontSize} font-mono font-bold transition-colors cursor-pointer hover:border-[#4a4a5e]`}
        style={{
          background: isActive
            ? `${color}18`
            : value === 1
            ? "rgba(99,102,241,0.08)"
            : "rgba(30,30,46,0.5)",
          color: isActive ? color : value === 1 ? "#ffffff" : "#71717a",
        }}
      >
        <motion.span
          key={`${index}-${value}`}
          initial={{ scale: 1.4 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.15 }}
        >
          {value}
        </motion.span>
      </motion.button>
      <span className="text-[8px] font-mono text-[#52525b]">
        2^{BIT_WIDTH - 1 - index}
      </span>
    </div>
  );
}

// ─── Two's Complement Visualization ───────────────────────────────────────────

function TwosComplementViz({
  operandA,
  flippedBits,
  resultBits,
  currentBitPos,
  phase,
  toggleBit,
}: {
  operandA: number[];
  flippedBits: number[];
  resultBits: number[];
  currentBitPos: number;
  phase: AnimationPhase;
  toggleBit: (operand: "A" | "B", index: number) => void;
}) {
  const showFlipped = phase === "flip-bits" || phase === "add-one" || phase === "complete";
  const showResult = phase === "add-one" || phase === "complete";

  return (
    <div className="flex flex-col items-center gap-8">
      <h3 className="text-lg font-semibold text-white">Two&apos;s Complement Conversion</h3>

      {/* Step 0: Original number */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-[#71717a] w-24 text-right">Original:</span>
          <div className="flex items-center gap-1.5">
            {operandA.map((bit, idx) => (
              <BitBox
                key={idx}
                value={bit}
                index={idx}
                isActive={false}
                color={COLORS.primary}
                onClick={() => toggleBit("A", idx)}
              />
            ))}
          </div>
          <span className="text-xs font-mono text-[#71717a] ml-3">
            = {bitsToUnsigned(operandA)} (unsigned) / {bitsToSigned(operandA)} (signed)
          </span>
        </div>
      </div>

      {/* Step 1: Flip bits */}
      <AnimatePresence>
        {showFlipped && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="flex flex-col items-center gap-2"
          >
            <div className="flex items-center gap-2 mb-2">
              <RotateCcw size={12} className="text-[#f59e0b]" />
              <span className="text-xs font-semibold text-[#f59e0b]">Step 1: Flip All Bits (One&apos;s Complement)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-[#71717a] w-24 text-right">Flipped:</span>
              <div className="flex items-center gap-1.5">
                {flippedBits.map((bit, idx) => {
                  const isFlipping = phase === "flip-bits" && idx === currentBitPos;
                  const wasFlipped = phase === "flip-bits" ? idx < currentBitPos : true;
                  return (
                    <BitBox
                      key={idx}
                      value={wasFlipped || (phase !== "flip-bits") ? bit : operandA[idx]}
                      index={idx}
                      isActive={isFlipping}
                      color={COLORS.accent}
                      glow={isFlipping}
                    />
                  );
                })}
              </div>
              <span className="text-xs font-mono text-[#71717a] ml-3">
                (inverted)
              </span>
            </div>

            {/* Arrow */}
            <div className="flex items-center gap-1 text-[#71717a]">
              <ArrowRight size={12} />
              <span className="text-[10px] font-mono">each 0 becomes 1, each 1 becomes 0</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Step 2: Add 1 */}
      <AnimatePresence>
        {showResult && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="flex flex-col items-center gap-2"
          >
            <div className="flex items-center gap-2 mb-2">
              <Plus size={12} className="text-[#10b981]" />
              <span className="text-xs font-semibold text-[#10b981]">Step 2: Add 1</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-[#71717a] w-24 text-right">+ 1:</span>
              <div className="flex items-center gap-1.5">
                {new Array(BIT_WIDTH).fill(0).map((_, idx) => (
                  <BitBox
                    key={idx}
                    value={idx === BIT_WIDTH - 1 ? 1 : 0}
                    index={idx}
                    isActive={false}
                    color={COLORS.muted}
                    size="small"
                  />
                ))}
              </div>
            </div>

            {/* Separator line */}
            <div
              className="w-full max-w-lg h-px my-1"
              style={{ background: "rgba(99,102,241,0.3)" }}
            />

            {/* Result */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-[#10b981] w-24 text-right font-semibold">Result:</span>
              <div className="flex items-center gap-1.5">
                {resultBits.map((bit, idx) => {
                  const isCarrying = phase === "add-one" && idx === currentBitPos;
                  return (
                    <BitBox
                      key={idx}
                      value={bit}
                      index={idx}
                      isActive={isCarrying}
                      color={COLORS.success}
                      glow={isCarrying}
                    />
                  );
                })}
              </div>
              <span className="text-xs font-mono text-[#10b981] ml-3">
                = {bitsToUnsigned(resultBits)} (unsigned) / {bitsToSigned(resultBits)} (signed)
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Completion message */}
      <AnimatePresence>
        {phase === "complete" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="px-4 py-3 rounded-xl text-center"
            style={{
              background: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.2)",
            }}
          >
            <span className="text-sm text-[#10b981]">
              Two&apos;s complement of {bitsToSigned(operandA)} is{" "}
              <span className="font-bold">{bitsToSigned(resultBits)}</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Addition Visualization ───────────────────────────────────────────────────

function AdditionViz({
  operandA,
  operandB,
  resultBits,
  carries,
  currentBitPos,
  phase,
  hasOverflow,
  isOverflowMode,
  toggleBit,
}: {
  operandA: number[];
  operandB: number[];
  resultBits: number[];
  carries: number[];
  currentBitPos: number;
  phase: AnimationPhase;
  hasOverflow: boolean;
  isOverflowMode: boolean;
  toggleBit: (operand: "A" | "B", index: number) => void;
}) {
  const showResult = phase === "carry-propagate" || phase === "result-show" || phase === "complete" || phase === "overflow-check";

  return (
    <div className="flex flex-col items-center gap-6">
      <h3 className="text-lg font-semibold text-white">
        {isOverflowMode ? "Addition with Overflow Detection" : "Binary Addition"}
      </h3>

      {/* Carry row */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-[#71717a] w-24 text-right">Carry:</span>
        <div className="flex items-center gap-1.5">
          {/* Extra carry out box */}
          <motion.div
            animate={{
              opacity: carries[0] > 0 ? 1 : 0.3,
              scale: carries[0] > 0 ? 1.05 : 1,
              borderColor: carries[0] > 0 ? COLORS.accent : "#2a2a3e",
            }}
            className="w-9 h-9 rounded-lg border-2 flex items-center justify-center text-sm font-mono font-bold"
            style={{
              background: carries[0] > 0 ? "rgba(245,158,11,0.15)" : "rgba(30,30,46,0.3)",
              color: carries[0] > 0 ? COLORS.accent : "#52525b",
            }}
          >
            {carries[0]}
          </motion.div>
          <div className="w-px h-6" style={{ background: COLORS.border }} />
          {carries.slice(1).map((carry, idx) => {
            const isActiveCarry = phase === "carry-propagate" && idx === currentBitPos;
            return (
              <motion.div
                key={idx}
                animate={{
                  opacity: carry > 0 || isActiveCarry ? 1 : 0.3,
                  scale: isActiveCarry ? 1.1 : 1,
                  borderColor: carry > 0
                    ? COLORS.accent
                    : isActiveCarry
                    ? COLORS.secondary
                    : "#2a2a3e",
                  boxShadow: isActiveCarry ? `0 0 12px ${COLORS.accent}40` : "none",
                }}
                transition={{ duration: 0.15 }}
                className="w-9 h-9 rounded-lg border flex items-center justify-center text-sm font-mono font-bold"
                style={{
                  background: carry > 0 ? "rgba(245,158,11,0.1)" : "rgba(30,30,46,0.3)",
                  color: carry > 0 ? COLORS.accent : "#52525b",
                }}
              >
                {carry}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Operand A */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-[#71717a] w-24 text-right">A:</span>
        <div className="flex items-center gap-1.5 ml-[calc(2.25rem+1px+0.5rem)]">
          {operandA.map((bit, idx) => {
            const isCurrent = phase === "carry-propagate" && idx === currentBitPos;
            return (
              <BitBox
                key={idx}
                value={bit}
                index={idx}
                isActive={isCurrent}
                color={COLORS.secondary}
                onClick={() => toggleBit("A", idx)}
                glow={isCurrent}
              />
            );
          })}
        </div>
        <span className="text-xs font-mono text-[#71717a] ml-3">
          = {bitsToUnsigned(operandA)}
        </span>
      </div>

      {/* Plus sign + Operand B */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-[#71717a] w-24 text-right">
          <Plus size={14} className="inline text-[#6366f1]" /> B:
        </span>
        <div className="flex items-center gap-1.5 ml-[calc(2.25rem+1px+0.5rem)]">
          {operandB.map((bit, idx) => {
            const isCurrent = phase === "carry-propagate" && idx === currentBitPos;
            return (
              <BitBox
                key={idx}
                value={bit}
                index={idx}
                isActive={isCurrent}
                color={COLORS.secondary}
                onClick={() => toggleBit("B", idx)}
                glow={isCurrent}
              />
            );
          })}
        </div>
        <span className="text-xs font-mono text-[#71717a] ml-3">
          = {bitsToUnsigned(operandB)}
        </span>
      </div>

      {/* Separator */}
      <div
        className="w-full max-w-2xl h-px"
        style={{ background: "rgba(99,102,241,0.3)" }}
      />

      {/* Result row */}
      <AnimatePresence>
        {showResult && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2"
          >
            <span className="text-xs font-mono text-[#10b981] w-24 text-right font-semibold">Result:</span>
            <div className="flex items-center gap-1.5 ml-[calc(2.25rem+1px+0.5rem)]">
              {resultBits.map((bit, idx) => {
                const isJustComputed = phase === "carry-propagate" && idx === currentBitPos;
                const wasComputed = phase === "carry-propagate" ? idx > currentBitPos : true;
                return (
                  <BitBox
                    key={idx}
                    value={wasComputed ? bit : 0}
                    index={idx}
                    isActive={isJustComputed}
                    color={hasOverflow && idx === 0 ? COLORS.danger : COLORS.success}
                    glow={isJustComputed}
                  />
                );
              })}
            </div>
            <span
              className="text-xs font-mono ml-3"
              style={{ color: hasOverflow ? COLORS.danger : "#10b981" }}
            >
              = {bitsToUnsigned(resultBits)} (u) / {bitsToSigned(resultBits)} (s)
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Overflow detection panel */}
      <AnimatePresence>
        {isOverflowMode && (phase === "overflow-check" || phase === "complete") && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-2xl"
          >
            <div
              className="rounded-xl p-4"
              style={{
                background: hasOverflow ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)",
                border: `1px solid ${hasOverflow ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)"}`,
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                {hasOverflow ? (
                  <AlertTriangle size={16} className="text-[#ef4444]" />
                ) : (
                  <div className="w-4 h-4 rounded-full bg-[#10b981] flex items-center justify-center">
                    <span className="text-[8px] text-white font-bold">OK</span>
                  </div>
                )}
                <span
                  className="text-sm font-semibold"
                  style={{ color: hasOverflow ? "#ef4444" : "#10b981" }}
                >
                  {hasOverflow ? "Signed Overflow Detected!" : "No Overflow"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-[#71717a]">Unsigned interpretation:</span>
                  <div className="font-mono text-white mt-1">
                    {bitsToUnsigned(operandA)} + {bitsToUnsigned(operandB)} ={" "}
                    {bitsToUnsigned(resultBits)}
                    <span className="text-[#71717a] ml-1">(range 0-255)</span>
                  </div>
                </div>
                <div>
                  <span className="text-[#71717a]">Signed interpretation:</span>
                  <div className="font-mono mt-1" style={{ color: hasOverflow ? "#ef4444" : "white" }}>
                    {bitsToSigned(operandA)} + {bitsToSigned(operandB)} ={" "}
                    {bitsToSigned(resultBits)}
                    <span className="text-[#71717a] ml-1">(range -128 to 127)</span>
                    {hasOverflow && (
                      <span className="text-[#ef4444] ml-1 font-semibold">WRONG!</span>
                    )}
                  </div>
                </div>
              </div>

              {hasOverflow && (
                <div className="mt-3 text-xs text-[#ef4444]">
                  Both operands have sign bit = {operandA[0]}, but result has sign bit = {resultBits[0]}.
                  The carry into the MSB differs from the carry out, triggering the overflow flag.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Subtraction Visualization ────────────────────────────────────────────────

function SubtractionViz({
  operandA, operandB, flippedBits, negatedBits, resultBits, carries,
  currentBitPos, phase, showIntermediate, toggleBit,
}: {
  operandA: number[]; operandB: number[]; flippedBits: number[];
  negatedBits: number[]; resultBits: number[]; carries: number[];
  currentBitPos: number; phase: AnimationPhase; showIntermediate: boolean;
  toggleBit: (operand: "A" | "B", index: number) => void;
}) {
  const showNegation = phase === "negate" || phase === "add-one" || phase === "add-step" || phase === "result-show" || phase === "complete";
  const showAddition = phase === "add-step" || phase === "result-show" || phase === "complete";
  const showResult = phase === "result-show" || phase === "complete";

  return (
    <div className="flex flex-col items-center gap-6">
      <h3 className="text-lg font-semibold text-white">Binary Subtraction (A - B = A + (-B))</h3>
      {/* Original operands */}
      <div className="flex flex-col items-center gap-3">
        <BitRow label="A:" bits={operandA} onToggle={(i) => toggleBit("A", i)} suffix={`= ${bitsToSigned(operandA)}`} />
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-[#71717a] w-20 text-right">
            <Minus size={12} className="inline text-[#ef4444]" /> B:
          </span>
          <div className="flex items-center gap-1.5">
            {operandB.map((bit, idx) => (
              <BitBox key={idx} value={bit} index={idx} isActive={false} color={COLORS.primary} onClick={() => toggleBit("B", idx)} />
            ))}
          </div>
          <span className="text-xs font-mono text-[#71717a] ml-3">= {bitsToSigned(operandB)}</span>
        </div>
      </div>
      {/* Step 1: Negate B */}
      <AnimatePresence>
        {showNegation && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-2 w-full">
            <div className="flex items-center gap-2 mb-1">
              <RotateCcw size={12} className="text-[#f59e0b]" />
              <span className="text-xs font-semibold text-[#f59e0b]">Step 1: Negate B (Two&apos;s Complement)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-[#71717a] w-20 text-right">~B:</span>
              <div className="flex items-center gap-1.5">
                {flippedBits.map((bit, idx) => {
                  const isFlipping = phase === "negate" && idx === currentBitPos;
                  return <BitBox key={idx} value={phase === "negate" && idx > currentBitPos ? operandB[idx] : bit} index={idx} isActive={isFlipping} color={COLORS.accent} size="small" glow={isFlipping} />;
                })}
              </div>
              <span className="text-xs font-mono text-[#71717a] ml-3">(flipped)</span>
            </div>
            {showIntermediate && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2">
                <span className="text-xs font-mono text-[#10b981] w-20 text-right">-B:</span>
                <div className="flex items-center gap-1.5">
                  {negatedBits.map((bit, idx) => (
                    <BitBox key={idx} value={bit} index={idx} isActive={false} color={COLORS.success} size="small" />
                  ))}
                </div>
                <span className="text-xs font-mono text-[#10b981] ml-3">= {bitsToSigned(negatedBits)} (~B + 1)</span>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Step 2: Add A + (-B) */}
      <AnimatePresence>
        {showAddition && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-3 w-full">
            <div className="flex items-center gap-2 mb-1">
              <Plus size={12} className="text-[#06b6d4]" />
              <span className="text-xs font-semibold text-[#06b6d4]">Step 2: Add A + (-B)</span>
            </div>
            <CarryRow carries={carries.slice(1)} />
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-[#71717a] w-20 text-right">A:</span>
              <div className="flex items-center gap-1.5">
                {operandA.map((bit, idx) => {
                  const isCurrent = phase === "add-step" && idx === currentBitPos;
                  return <BitBox key={idx} value={bit} index={idx} isActive={isCurrent} color={COLORS.secondary} size="small" glow={isCurrent} />;
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-[#71717a] w-20 text-right">+ (-B):</span>
              <div className="flex items-center gap-1.5">
                {negatedBits.map((bit, idx) => {
                  const isCurrent = phase === "add-step" && idx === currentBitPos;
                  return <BitBox key={idx} value={bit} index={idx} isActive={isCurrent} color={COLORS.secondary} size="small" glow={isCurrent} />;
                })}
              </div>
            </div>
            <div className="w-full max-w-lg h-px" style={{ background: "rgba(99,102,241,0.3)" }} />
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-[#10b981] w-20 text-right font-semibold">Result:</span>
              <div className="flex items-center gap-1.5">
                {resultBits.map((bit, idx) => {
                  const isJustComputed = phase === "add-step" && idx === currentBitPos;
                  const wasComputed = phase === "add-step" ? idx > currentBitPos : true;
                  return <BitBox key={idx} value={wasComputed ? bit : 0} index={idx} isActive={isJustComputed} color={COLORS.success} size="small" glow={isJustComputed} />;
                })}
              </div>
              {showResult && <span className="text-xs font-mono text-[#10b981] ml-3">= {bitsToSigned(resultBits)}</span>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Completion */}
      <AnimatePresence>
        {phase === "complete" && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="px-4 py-3 rounded-xl text-center" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
            <span className="text-sm text-[#10b981]">
              {bitsToSigned(operandA)} - {bitsToSigned(operandB)} = <span className="font-bold">{bitsToSigned(resultBits)}</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Shared Row Helpers ───────────────────────────────────────────────────────

function BitRow({ label, bits, onToggle, suffix }: { label: string; bits: number[]; onToggle?: (i: number) => void; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono text-[#71717a] w-20 text-right">{label}</span>
      <div className="flex items-center gap-1.5">
        {bits.map((bit, idx) => (
          <BitBox key={idx} value={bit} index={idx} isActive={false} color={COLORS.primary} onClick={onToggle ? () => onToggle(idx) : undefined} />
        ))}
      </div>
      {suffix && <span className="text-xs font-mono text-[#71717a] ml-3">{suffix}</span>}
    </div>
  );
}

function CarryRow({ carries }: { carries: number[] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono text-[#71717a] w-20 text-right">Carry:</span>
      <div className="flex items-center gap-1.5">
        {carries.map((carry, idx) => (
          <motion.div key={idx} animate={{ opacity: carry > 0 ? 1 : 0.3, borderColor: carry > 0 ? COLORS.accent : "#2a2a3e" }}
            className="w-9 h-9 rounded-lg border flex items-center justify-center text-sm font-mono font-bold"
            style={{ background: carry > 0 ? "rgba(245,158,11,0.1)" : "rgba(30,30,46,0.3)", color: carry > 0 ? COLORS.accent : "#52525b" }}>
            {carry}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─── Decimal Display ──────────────────────────────────────────────────────────

function DecimalDisplay({
  label,
  bits,
  highlight,
}: {
  label: string;
  bits: number[];
  highlight?: boolean;
}) {
  const unsigned = bitsToUnsigned(bits);
  const signed = bitsToSigned(bits);

  return (
    <div className="flex items-center gap-2">
      <span
        className="text-[10px] font-mono uppercase tracking-wider"
        style={{ color: highlight ? "#10b981" : "#71717a" }}
      >
        {label}:
      </span>
      <span className="text-xs font-mono text-white">{bits.join("")}</span>
      <span className="text-[10px] font-mono text-[#71717a]">=</span>
      <span
        className="text-xs font-mono font-semibold"
        style={{ color: highlight ? "#10b981" : "#06b6d4" }}
      >
        {unsigned}
      </span>
      <span className="text-[10px] font-mono text-[#71717a]">(u)</span>
      <span
        className="text-xs font-mono font-semibold"
        style={{ color: signed < 0 ? "#ef4444" : highlight ? "#10b981" : "#6366f1" }}
      >
        {signed}
      </span>
      <span className="text-[10px] font-mono text-[#71717a]">(s)</span>
    </div>
  );
}

// ─── Metric Card ──────────────────────────────────────────────────────────────

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
    <div
      className="rounded-xl p-3 border"
      style={{
        background: `${color}08`,
        borderColor: `${color}20`,
      }}
    >
      <div className="text-[10px] font-mono uppercase tracking-wider text-[#71717a] mb-1">
        {label}
      </div>
      <motion.div
        key={value}
        initial={{ scale: 1.1 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.2 }}
        className="text-lg font-mono font-bold tabular-nums"
        style={{ color }}
      >
        {value}
      </motion.div>
    </div>
  );
}
