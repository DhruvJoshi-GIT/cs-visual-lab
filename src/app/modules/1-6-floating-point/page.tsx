"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Binary,
  Hash,
  AlertTriangle,
  Infinity as InfinityIcon,
  Calculator,
  ArrowRight,
  ToggleLeft,
  ToggleRight,
  Info,
  Zap,
  Lightbulb,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BitField {
  bits: number[];
  label: string;
  color: string;
  borderColor: string;
  glowColor: string;
}

interface FloatBreakdown {
  sign: number;
  exponent: number;
  mantissa: number;
  biasedExponent: number;
  implicitMantissa: number;
  decimalValue: number;
  hexValue: string;
  isSpecial: boolean;
  specialLabel: string;
  isDenormalized: boolean;
  precisionError: number;
  formula: string;
}

interface Scenario {
  id: string;
  label: string;
  description: string;
}

interface InterestingNumber {
  value: number;
  label: string;
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
  sign: "#ef4444",
  exponent: "#f59e0b",
  mantissa: "#06b6d4",
};

const SCENARIOS: Scenario[] = [
  { id: "common", label: "Common Values", description: "1, -1, 0.5, 2.0" },
  { id: "precision", label: "Precision Issues", description: "0.1, 0.2, 0.3" },
  { id: "special", label: "Special Values", description: "Inf, NaN, 0, -0" },
  { id: "powers", label: "Powers of 2", description: "2, 4, 8, 0.25" },
];

const INTERESTING_NUMBERS: Record<string, InterestingNumber[]> = {
  common: [
    { value: 1.0, label: "1.0", description: "The simplest normalized float" },
    { value: -1.0, label: "-1.0", description: "Negative one - only the sign bit differs" },
    { value: 0.5, label: "0.5", description: "One-half: 2^(-1)" },
    { value: 2.0, label: "2.0", description: "Two: 2^1" },
    { value: 3.14159, label: "Pi", description: "Pi approximation in 32-bit float" },
    { value: 42.0, label: "42", description: "The answer to everything" },
  ],
  precision: [
    { value: 0.1, label: "0.1", description: "Cannot be exactly represented in binary" },
    { value: 0.2, label: "0.2", description: "Also cannot be exactly represented" },
    { value: 0.3, label: "0.3", description: "0.1 + 0.2 does not equal this!" },
    { value: 0.1 + 0.2, label: "0.1+0.2", description: "The actual result of 0.1 + 0.2" },
    { value: 1.0000001, label: "1.0000001", description: "Near the limit of float32 precision" },
    { value: 16777216, label: "2^24", description: "Integers above this lose precision" },
    { value: 16777217, label: "2^24+1", description: "This rounds to 2^24 in float32!" },
  ],
  special: [
    { value: 0, label: "+0", description: "Positive zero: all bits zero" },
    { value: -0, label: "-0", description: "Negative zero: only sign bit set (exists in IEEE 754!)" },
    { value: Infinity, label: "+Inf", description: "Positive infinity: exponent all 1s, mantissa all 0s" },
    { value: -Infinity, label: "-Inf", description: "Negative infinity" },
    { value: NaN, label: "NaN", description: "Not a Number: exponent all 1s, mantissa non-zero" },
    { value: 1.1754944e-38, label: "Min Normal", description: "Smallest normalized positive float" },
    { value: 3.4028235e38, label: "Max Float", description: "Largest representable finite float" },
  ],
  powers: [
    { value: 0.25, label: "0.25", description: "2^(-2)" },
    { value: 0.5, label: "0.5", description: "2^(-1)" },
    { value: 1, label: "1", description: "2^0" },
    { value: 2, label: "2", description: "2^1" },
    { value: 4, label: "4", description: "2^2" },
    { value: 8, label: "8", description: "2^3" },
    { value: 1024, label: "1024", description: "2^10" },
    { value: 0.125, label: "0.125", description: "2^(-3)" },
  ],
};

// ─── IEEE 754 Conversion Logic ────────────────────────────────────────────────

function floatToBits(value: number): number[] {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value, false);
  const intVal = view.getUint32(0, false);
  const bits: number[] = [];
  for (let i = 31; i >= 0; i--) {
    bits.push((intVal >>> i) & 1);
  }
  return bits;
}

function bitsToFloat(bits: number[]): number {
  let intVal = 0;
  for (let i = 0; i < 32; i++) {
    intVal = (intVal << 1) | (bits[i] & 1);
  }
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, intVal >>> 0, false);
  return view.getFloat32(0, false);
}

function bitsToHex(bits: number[]): string {
  let intVal = 0;
  for (let i = 0; i < 32; i++) {
    intVal = (intVal << 1) | (bits[i] & 1);
  }
  return "0x" + (intVal >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

function analyzeFloat(bits: number[]): FloatBreakdown {
  const sign = bits[0];
  let exponentBits = 0;
  for (let i = 1; i <= 8; i++) {
    exponentBits = (exponentBits << 1) | bits[i];
  }
  let mantissaBits = 0;
  for (let i = 9; i <= 31; i++) {
    mantissaBits = (mantissaBits << 1) | bits[i];
  }

  const biasedExponent = exponentBits - 127;
  const decimalValue = bitsToFloat(bits);
  const hexValue = bitsToHex(bits);

  let mantissaFraction = 0;
  for (let i = 0; i < 23; i++) {
    if (bits[9 + i]) {
      mantissaFraction += Math.pow(2, -(i + 1));
    }
  }

  let isSpecial = false;
  let specialLabel = "";
  let isDenormalized = false;

  if (exponentBits === 255) {
    isSpecial = true;
    if (mantissaBits === 0) {
      specialLabel = sign === 0 ? "+Infinity" : "-Infinity";
    } else {
      specialLabel = "NaN";
    }
  } else if (exponentBits === 0) {
    if (mantissaBits === 0) {
      isSpecial = true;
      specialLabel = sign === 0 ? "+0" : "-0";
    } else {
      isDenormalized = true;
      specialLabel = "Denormalized";
    }
  }

  const implicitMantissa = isDenormalized ? mantissaFraction : 1 + mantissaFraction;

  let precisionError = 0;
  if (!isSpecial && !isNaN(decimalValue) && isFinite(decimalValue)) {
    const roundTrip = decimalValue;
    precisionError = Math.abs(roundTrip - decimalValue);
  }

  let formula = "";
  if (isSpecial) {
    formula = specialLabel;
  } else if (isDenormalized) {
    formula = `(-1)^${sign} x 0.${mantissaFraction.toString().split(".")[1] || "0"} x 2^(-126)`;
  } else {
    formula = `(-1)^${sign} x 1.${mantissaFraction.toString().split(".")[1] || "0"} x 2^(${biasedExponent})`;
  }

  return {
    sign,
    exponent: exponentBits,
    mantissa: mantissaBits,
    biasedExponent,
    implicitMantissa,
    decimalValue,
    hexValue,
    isSpecial,
    specialLabel,
    isDenormalized,
    precisionError,
    formula,
  };
}

// ─── Bit Box Component ────────────────────────────────────────────────────────

function BitBox({
  bit,
  index,
  color,
  borderColor,
  glowColor,
  onClick,
  isAnimating,
  label,
}: {
  bit: number;
  index: number;
  color: string;
  borderColor: string;
  glowColor: string;
  onClick: () => void;
  isAnimating: boolean;
  label?: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      className="relative flex items-center justify-center font-mono font-bold text-sm select-none"
      style={{
        width: 28,
        height: 36,
        borderRadius: 6,
        background: bit === 1 ? `${color}25` : "rgba(30,30,46,0.5)",
        border: `1px solid ${bit === 1 ? borderColor : "#1e1e2e"}`,
        color: bit === 1 ? color : "#4a4a5a",
        boxShadow: bit === 1 ? `0 0 8px ${glowColor}` : "none",
        cursor: "pointer",
        transition: "background 150ms, border-color 150ms, color 150ms, box-shadow 150ms",
      }}
      whileTap={{ scale: 0.9 }}
      animate={isAnimating ? { scale: [1, 1.2, 1] } : { scale: 1 }}
      transition={{ duration: 0.2 }}
      title={`Bit ${31 - index}: ${bit}`}
    >
      {bit}
      {label && (
        <span
          className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-normal whitespace-nowrap"
          style={{ color: "#71717a" }}
        >
          {label}
        </span>
      )}
    </motion.button>
  );
}

// ─── Precision Demo Component ─────────────────────────────────────────────────

function PrecisionDemo({ visible }: { visible: boolean }) {
  const val01 = 0.1;
  const val02 = 0.2;
  const sum = val01 + val02;
  const val03 = 0.3;
  const diff = sum - val03;

  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="rounded-xl p-4"
      style={{
        background: "rgba(239,68,68,0.05)",
        border: "1px solid rgba(239,68,68,0.15)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={14} style={{ color: COLORS.danger }} />
        <span className="text-sm font-semibold" style={{ color: COLORS.danger }}>
          Floating Point Precision Trap
        </span>
      </div>
      <div className="space-y-2 font-mono text-xs">
        <div className="flex items-center gap-2">
          <span style={{ color: "#a1a1aa" }}>0.1 =</span>
          <span style={{ color: COLORS.accent }}>{val01.toPrecision(20)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ color: "#a1a1aa" }}>0.2 =</span>
          <span style={{ color: COLORS.accent }}>{val02.toPrecision(20)}</span>
        </div>
        <div
          className="flex items-center gap-2 py-1.5 px-2 rounded-lg"
          style={{ background: "rgba(239,68,68,0.08)" }}
        >
          <span style={{ color: "#a1a1aa" }}>0.1 + 0.2 =</span>
          <span style={{ color: COLORS.danger }}>{sum.toPrecision(20)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ color: "#a1a1aa" }}>0.3 =</span>
          <span style={{ color: COLORS.success }}>{val03.toPrecision(20)}</span>
        </div>
        <div
          className="flex items-center gap-2 mt-2 pt-2"
          style={{ borderTop: "1px solid rgba(239,68,68,0.15)" }}
        >
          <span style={{ color: COLORS.danger }}>
            0.1 + 0.2 === 0.3 ?{" "}
            <span className="font-bold">{(sum === val03).toString()}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ color: "#71717a" }}>Difference:</span>
          <span style={{ color: COLORS.accent }}>{diff.toExponential(10)}</span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Breakdown Panel Component ────────────────────────────────────────────────

function BreakdownPanel({ breakdown }: { breakdown: FloatBreakdown }) {
  return (
    <div className="space-y-3">
      {/* Sign interpretation */}
      <div
        className="rounded-lg p-3"
        style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.12)" }}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: COLORS.sign }} />
          <span className="text-xs font-semibold" style={{ color: COLORS.sign }}>
            Sign Bit
          </span>
        </div>
        <div className="font-mono text-xs" style={{ color: "#a1a1aa" }}>
          <span style={{ color: COLORS.sign }}>{breakdown.sign}</span>
          {" → "}
          (-1)^{breakdown.sign} = {breakdown.sign === 0 ? "+1" : "-1"}
          {" → "}
          <span className="font-semibold text-white">
            {breakdown.sign === 0 ? "Positive" : "Negative"}
          </span>
        </div>
      </div>

      {/* Exponent interpretation */}
      <div
        className="rounded-lg p-3"
        style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.12)" }}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: COLORS.exponent }} />
          <span className="text-xs font-semibold" style={{ color: COLORS.exponent }}>
            Exponent (8 bits)
          </span>
        </div>
        <div className="font-mono text-xs space-y-1" style={{ color: "#a1a1aa" }}>
          <div>
            Stored value:{" "}
            <span style={{ color: COLORS.exponent }}>{breakdown.exponent}</span>
          </div>
          <div>
            Bias: <span style={{ color: "#71717a" }}>127</span>
          </div>
          <div>
            Actual exponent: {breakdown.exponent} - 127 ={" "}
            <span className="font-semibold text-white">{breakdown.biasedExponent}</span>
          </div>
          {breakdown.exponent === 0 && (
            <div style={{ color: COLORS.accent }}>
              {breakdown.mantissa === 0
                ? "Zero exponent + zero mantissa = Zero"
                : "Zero exponent = Denormalized number (uses 2^(-126))"}
            </div>
          )}
          {breakdown.exponent === 255 && (
            <div style={{ color: COLORS.danger }}>
              All 1s exponent = Special value ({breakdown.specialLabel})
            </div>
          )}
        </div>
      </div>

      {/* Mantissa interpretation */}
      <div
        className="rounded-lg p-3"
        style={{ background: "rgba(6,182,212,0.05)", border: "1px solid rgba(6,182,212,0.12)" }}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: COLORS.mantissa }} />
          <span className="text-xs font-semibold" style={{ color: COLORS.mantissa }}>
            Mantissa (23 bits)
          </span>
        </div>
        <div className="font-mono text-xs space-y-1" style={{ color: "#a1a1aa" }}>
          <div>
            Stored bits: <span style={{ color: COLORS.mantissa }}>{breakdown.mantissa}</span>
          </div>
          {!breakdown.isSpecial && (
            <>
              <div>
                {breakdown.isDenormalized ? (
                  <>
                    Implicit leading <span style={{ color: COLORS.accent }}>0</span> (denormalized)
                  </>
                ) : (
                  <>
                    Implicit leading <span style={{ color: COLORS.success }}>1</span> (normalized)
                  </>
                )}
              </div>
              <div>
                Effective significand:{" "}
                <span className="font-semibold text-white">
                  {breakdown.implicitMantissa.toPrecision(8)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Formula */}
      {!breakdown.isSpecial && (
        <div
          className="rounded-lg p-3"
          style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.12)" }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <Calculator size={12} style={{ color: COLORS.primary }} />
            <span className="text-xs font-semibold" style={{ color: COLORS.primary }}>
              Formula
            </span>
          </div>
          <div className="font-mono text-xs" style={{ color: "#a1a1aa" }}>
            <div className="mb-1">
              <span style={{ color: COLORS.sign }}>(-1)^{breakdown.sign}</span>
              {" × "}
              <span style={{ color: COLORS.mantissa }}>
                {breakdown.implicitMantissa.toPrecision(8)}
              </span>
              {" × "}
              <span style={{ color: COLORS.exponent }}>
                2^({breakdown.isDenormalized ? "-126" : breakdown.biasedExponent.toString()})
              </span>
            </div>
            <div>
              {"= "}
              <span className="text-base font-bold text-white">
                {isNaN(breakdown.decimalValue)
                  ? "NaN"
                  : !isFinite(breakdown.decimalValue)
                  ? breakdown.decimalValue > 0
                    ? "+Infinity"
                    : "-Infinity"
                  : breakdown.decimalValue.toPrecision(9)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Special value */}
      {breakdown.isSpecial && (
        <div
          className="rounded-lg p-3"
          style={{
            background: "rgba(239,68,68,0.05)",
            border: "1px solid rgba(239,68,68,0.12)",
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle size={12} style={{ color: COLORS.danger }} />
            <span className="text-xs font-semibold" style={{ color: COLORS.danger }}>
              Special Value
            </span>
          </div>
          <div className="font-mono text-lg font-bold text-white">{breakdown.specialLabel}</div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function FloatingPointPage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [bits, setBits] = useState<number[]>(() => floatToBits(1.0));
  const [decimalInput, setDecimalInput] = useState("1");
  const [showMetrics, setShowMetrics] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeScenario, setActiveScenario] = useState("common");
  const [autoPlayIndex, setAutoPlayIndex] = useState(0);
  const [animatingBits, setAnimatingBits] = useState<Set<number>>(new Set());
  const [showPrecisionDemo, setShowPrecisionDemo] = useState(false);
  const [inputMode, setInputMode] = useState<"bits" | "decimal">("bits");

  // ── Refs ────────────────────────────────────────────────────────────────────
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const autoPlayIndexRef = useRef(0);
  const activeScenarioRef = useRef(activeScenario);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    autoPlayIndexRef.current = autoPlayIndex;
  }, [autoPlayIndex]);
  useEffect(() => {
    activeScenarioRef.current = activeScenario;
  }, [activeScenario]);

  // ── Derived state ───────────────────────────────────────────────────────────
  const breakdown = analyzeFloat(bits);
  const currentNumbers = INTERESTING_NUMBERS[activeScenario] || INTERESTING_NUMBERS.common;

  // ── Bit toggle with animation ───────────────────────────────────────────────
  const toggleBit = useCallback(
    (index: number) => {
      const newBits = [...bits];
      newBits[index] = newBits[index] === 0 ? 1 : 0;
      setBits(newBits);
      const value = bitsToFloat(newBits);
      if (isNaN(value)) {
        setDecimalInput("NaN");
      } else if (!isFinite(value)) {
        setDecimalInput(value > 0 ? "Infinity" : "-Infinity");
      } else {
        setDecimalInput(value.toString());
      }
      setAnimatingBits(new Set([index]));
      setTimeout(() => setAnimatingBits(new Set()), 250);
    },
    [bits]
  );

  // ── Set value from decimal ──────────────────────────────────────────────────
  const setValueFromDecimal = useCallback((value: number) => {
    const newBits = floatToBits(value);
    const changedIndices = new Set<number>();
    setBits((prev) => {
      for (let i = 0; i < 32; i++) {
        if (prev[i] !== newBits[i]) changedIndices.add(i);
      }
      return newBits;
    });
    if (isNaN(value)) {
      setDecimalInput("NaN");
    } else if (!isFinite(value)) {
      setDecimalInput(value > 0 ? "Infinity" : "-Infinity");
    } else {
      setDecimalInput(value.toString());
    }
    setAnimatingBits(changedIndices);
    setTimeout(() => setAnimatingBits(new Set()), 250);
  }, []);

  // ── Handle decimal input change ─────────────────────────────────────────────
  const handleDecimalChange = useCallback(
    (input: string) => {
      setDecimalInput(input);
      if (input === "" || input === "-" || input === ".") return;
      if (input.toLowerCase() === "nan") {
        setValueFromDecimal(NaN);
        return;
      }
      if (input.toLowerCase() === "infinity" || input.toLowerCase() === "inf") {
        setValueFromDecimal(Infinity);
        return;
      }
      if (input.toLowerCase() === "-infinity" || input.toLowerCase() === "-inf") {
        setValueFromDecimal(-Infinity);
        return;
      }
      const num = parseFloat(input);
      if (!isNaN(num)) {
        setValueFromDecimal(num);
      }
    },
    [setValueFromDecimal]
  );

  // ── Step forward (auto-play cycles through interesting numbers) ─────────────
  const stepForward = useCallback(() => {
    const nums = INTERESTING_NUMBERS[activeScenarioRef.current] || INTERESTING_NUMBERS.common;
    const idx = autoPlayIndexRef.current;
    if (idx < nums.length) {
      setValueFromDecimal(nums[idx].value);
      setAutoPlayIndex(idx + 1);
      autoPlayIndexRef.current = idx + 1;
    } else {
      setAutoPlayIndex(0);
      autoPlayIndexRef.current = 0;
      setIsPlaying(false);
      isPlayingRef.current = false;
    }
  }, [setValueFromDecimal]);

  // ── Animation loop ──────────────────────────────────────────────────────────
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(200, 1500 / speedRef.current);
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
    setAutoPlayIndex(0);
    autoPlayIndexRef.current = 0;
    setValueFromDecimal(1.0);
  }, [handlePause, setValueFromDecimal]);

  // ── Scenario change ─────────────────────────────────────────────────────────
  const handleScenarioChange = useCallback(
    (scenarioId: string) => {
      handlePause();
      setActiveScenario(scenarioId);
      activeScenarioRef.current = scenarioId;
      setAutoPlayIndex(0);
      autoPlayIndexRef.current = 0;
      const nums = INTERESTING_NUMBERS[scenarioId];
      if (nums && nums.length > 0) {
        setValueFromDecimal(nums[0].value);
      }
      setShowPrecisionDemo(scenarioId === "precision");
    },
    [handlePause, setValueFromDecimal]
  );

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // ── Bit field definitions ───────────────────────────────────────────────────
  const signField: BitField = {
    bits: bits.slice(0, 1),
    label: "Sign",
    color: COLORS.sign,
    borderColor: "rgba(239,68,68,0.4)",
    glowColor: "rgba(239,68,68,0.2)",
  };
  const exponentField: BitField = {
    bits: bits.slice(1, 9),
    label: "Exponent",
    color: COLORS.exponent,
    borderColor: "rgba(245,158,11,0.4)",
    glowColor: "rgba(245,158,11,0.2)",
  };
  const mantissaField: BitField = {
    bits: bits.slice(9, 32),
    label: "Mantissa",
    color: COLORS.mantissa,
    borderColor: "rgba(6,182,212,0.4)",
    glowColor: "rgba(6,182,212,0.2)",
  };

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
                1.6
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Floating Point Demystifier
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Explore how computers represent decimal numbers using IEEE 754 single-precision
              floating point. Click any bit to toggle it and watch the decimal value change
              in real time, or type a number to see its binary representation.
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
                <Binary size={11} />
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
            {/* Decimal input / value display */}
            <div className="p-4 border-b" style={{ borderColor: COLORS.border }}>
              <div className="flex items-center gap-4 flex-wrap">
                {/* Input mode toggle */}
                <button
                  onClick={() => setInputMode(inputMode === "bits" ? "decimal" : "bits")}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200"
                  style={{
                    background: "rgba(99,102,241,0.08)",
                    border: "1px solid rgba(99,102,241,0.2)",
                    color: COLORS.primary,
                  }}
                >
                  {inputMode === "bits" ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}
                  {inputMode === "bits" ? "Bit Editing" : "Decimal Input"}
                </button>

                {/* Decimal input */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#71717a]">Decimal:</span>
                  <input
                    type="text"
                    value={decimalInput}
                    onChange={(e) => handleDecimalChange(e.target.value)}
                    className="px-3 py-1.5 rounded-lg text-sm font-mono font-semibold text-white outline-none transition-all duration-200 focus:ring-1 focus:ring-[#6366f1]/50"
                    style={{
                      background: "#1e1e2e",
                      border: "1px solid #2a2a3e",
                      width: 200,
                    }}
                    placeholder="Enter a number..."
                  />
                </div>

                {/* Current value display */}
                <div className="flex items-center gap-4 ml-auto">
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-[#71717a]">Value</div>
                    <div className="text-lg font-mono font-bold text-white">
                      {breakdown.isSpecial
                        ? breakdown.specialLabel
                        : isNaN(breakdown.decimalValue)
                        ? "NaN"
                        : !isFinite(breakdown.decimalValue)
                        ? breakdown.decimalValue > 0
                          ? "+Infinity"
                          : "-Infinity"
                        : Number(breakdown.decimalValue.toPrecision(9))}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-[#71717a]">Hex</div>
                    <div className="text-sm font-mono font-semibold" style={{ color: COLORS.primary }}>
                      {breakdown.hexValue}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 32-bit display */}
            <div className="p-5">
              {/* Field labels */}
              <div className="flex items-center gap-4 mb-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: COLORS.sign }} />
                  <span className="text-[11px] font-medium" style={{ color: COLORS.sign }}>
                    Sign (1 bit)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: COLORS.exponent }} />
                  <span className="text-[11px] font-medium" style={{ color: COLORS.exponent }}>
                    Exponent (8 bits)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: COLORS.mantissa }} />
                  <span className="text-[11px] font-medium" style={{ color: COLORS.mantissa }}>
                    Mantissa (23 bits)
                  </span>
                </div>
              </div>

              {/* Bit boxes */}
              <div className="flex gap-1 flex-wrap items-end pt-5">
                {/* Sign bit */}
                <div className="flex gap-0.5 mr-2">
                  <BitBox
                    bit={signField.bits[0]}
                    index={0}
                    color={signField.color}
                    borderColor={signField.borderColor}
                    glowColor={signField.glowColor}
                    onClick={() => toggleBit(0)}
                    isAnimating={animatingBits.has(0)}
                    label="31"
                  />
                </div>

                {/* Exponent bits */}
                <div
                  className="flex gap-0.5 mr-2 px-1.5 py-1 rounded-lg"
                  style={{
                    background: "rgba(245,158,11,0.04)",
                    border: "1px solid rgba(245,158,11,0.08)",
                  }}
                >
                  {exponentField.bits.map((bit, i) => (
                    <BitBox
                      key={`exp-${i}`}
                      bit={bit}
                      index={1 + i}
                      color={exponentField.color}
                      borderColor={exponentField.borderColor}
                      glowColor={exponentField.glowColor}
                      onClick={() => toggleBit(1 + i)}
                      isAnimating={animatingBits.has(1 + i)}
                      label={i === 0 ? "30" : i === 7 ? "23" : undefined}
                    />
                  ))}
                </div>

                {/* Mantissa bits */}
                <div
                  className="flex gap-0.5 flex-wrap px-1.5 py-1 rounded-lg"
                  style={{
                    background: "rgba(6,182,212,0.04)",
                    border: "1px solid rgba(6,182,212,0.08)",
                  }}
                >
                  {mantissaField.bits.map((bit, i) => (
                    <BitBox
                      key={`man-${i}`}
                      bit={bit}
                      index={9 + i}
                      color={mantissaField.color}
                      borderColor={mantissaField.borderColor}
                      glowColor={mantissaField.glowColor}
                      onClick={() => toggleBit(9 + i)}
                      isAnimating={animatingBits.has(9 + i)}
                      label={i === 0 ? "22" : i === 22 ? "0" : undefined}
                    />
                  ))}
                </div>
              </div>

              {/* Bit position ruler */}
              <div className="flex items-center gap-2 mt-3 px-1">
                <ArrowRight size={12} style={{ color: "#71717a" }} />
                <span className="text-[10px] text-[#71717a]">
                  MSB (bit 31) to LSB (bit 0) — Click any bit to toggle
                </span>
              </div>
            </div>

            {/* Quick value buttons */}
            <div
              className="px-5 pb-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] uppercase tracking-wider text-[#71717a]">
                  Quick Values
                </span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {currentNumbers.map((num) => (
                  <button
                    key={num.label}
                    onClick={() => setValueFromDecimal(num.value)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium transition-all duration-200 hover:scale-105 active:scale-95"
                    style={{
                      background: "#1e1e2e",
                      border: "1px solid #2a2a3e",
                      color: "#a1a1aa",
                    }}
                    title={num.description}
                  >
                    {num.label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>

          {/* ── Breakdown + Metrics Grid ────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25, ease: [0.23, 1, 0.32, 1] }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4"
          >
            {/* Step-by-step breakdown panel */}
            <div
              className="rounded-2xl p-4"
              style={{
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Info size={14} style={{ color: COLORS.primary }} />
                <span className="text-sm font-semibold text-white">Step-by-Step Breakdown</span>
              </div>
              <BreakdownPanel breakdown={breakdown} />
            </div>

            {/* Metrics + Precision demo */}
            <div className="space-y-4">
              {/* Metrics */}
              <AnimatePresence>
                {showMetrics && (
                  <motion.div
                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="rounded-2xl p-4"
                    style={{
                      background: COLORS.card,
                      border: `1px solid ${COLORS.border}`,
                    }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Hash size={14} style={{ color: COLORS.secondary }} />
                      <span className="text-sm font-semibold text-white">Metrics</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div
                        className="rounded-lg p-3"
                        style={{ background: "#1e1e2e" }}
                      >
                        <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1">
                          Decimal Value
                        </div>
                        <div className="font-mono text-sm font-semibold text-white">
                          {breakdown.isSpecial
                            ? breakdown.specialLabel
                            : isNaN(breakdown.decimalValue)
                            ? "NaN"
                            : !isFinite(breakdown.decimalValue)
                            ? breakdown.decimalValue > 0
                              ? "+Infinity"
                              : "-Infinity"
                            : breakdown.decimalValue.toPrecision(9)}
                        </div>
                      </div>
                      <div
                        className="rounded-lg p-3"
                        style={{ background: "#1e1e2e" }}
                      >
                        <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1">
                          Hex Representation
                        </div>
                        <div className="font-mono text-sm font-semibold" style={{ color: COLORS.primary }}>
                          {breakdown.hexValue}
                        </div>
                      </div>
                      <div
                        className="rounded-lg p-3"
                        style={{ background: "#1e1e2e" }}
                      >
                        <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1">
                          Biased Exponent
                        </div>
                        <div className="font-mono text-sm font-semibold" style={{ color: COLORS.exponent }}>
                          {breakdown.exponent} (actual: {breakdown.biasedExponent})
                        </div>
                      </div>
                      <div
                        className="rounded-lg p-3"
                        style={{ background: "#1e1e2e" }}
                      >
                        <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1">
                          Type
                        </div>
                        <div className="font-mono text-sm font-semibold" style={{
                          color: breakdown.isSpecial
                            ? COLORS.danger
                            : breakdown.isDenormalized
                            ? COLORS.accent
                            : COLORS.success,
                        }}>
                          {breakdown.isSpecial
                            ? breakdown.specialLabel
                            : breakdown.isDenormalized
                            ? "Denormalized"
                            : "Normalized"}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Precision demonstration */}
              <AnimatePresence>
                {showPrecisionDemo && <PrecisionDemo visible={true} />}
              </AnimatePresence>

              {/* Auto-play progress */}
              {isPlaying && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="rounded-xl p-3"
                  style={{
                    background: "rgba(99,102,241,0.05)",
                    border: "1px solid rgba(99,102,241,0.12)",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium" style={{ color: COLORS.primary }}>
                      Auto-playing: {SCENARIOS.find((s) => s.id === activeScenario)?.label}
                    </span>
                    <span className="text-xs font-mono" style={{ color: "#71717a" }}>
                      {autoPlayIndex} / {currentNumbers.length}
                    </span>
                  </div>
                  <div
                    className="h-1.5 rounded-full overflow-hidden"
                    style={{ background: "#1e1e2e" }}
                  >
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: COLORS.primary }}
                      animate={{
                        width: `${(autoPlayIndex / currentNumbers.length) * 100}%`,
                      }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  {autoPlayIndex > 0 && autoPlayIndex <= currentNumbers.length && (
                    <div className="mt-2 text-xs" style={{ color: "#a1a1aa" }}>
                      <span className="font-semibold text-white">
                        {currentNumbers[autoPlayIndex - 1]?.label}
                      </span>
                      {" — "}
                      {currentNumbers[autoPlayIndex - 1]?.description}
                    </div>
                  )}
                </motion.div>
              )}
            </div>
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
              {/* Precision demo toggle */}
              <button
                onClick={() => setShowPrecisionDemo(!showPrecisionDemo)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                style={{
                  background: showPrecisionDemo
                    ? "rgba(239,68,68,0.1)"
                    : "#1e1e2e",
                  color: showPrecisionDemo ? COLORS.danger : "#a1a1aa",
                  border: showPrecisionDemo
                    ? "1px solid rgba(239,68,68,0.2)"
                    : "1px solid transparent",
                }}
              >
                <AlertTriangle size={12} />
                0.1+0.2
              </button>
            </ModuleControls>
          </motion.div>

          {/* ── Educational Info ────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"
          >
            {/* IEEE 754 Format */}
            <div
              className="rounded-2xl p-5"
              style={{
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Binary size={14} style={{ color: COLORS.primary }} />
                <span className="text-sm font-semibold text-white">
                  IEEE 754 Single-Precision Format
                </span>
              </div>
              <div className="space-y-3 text-xs" style={{ color: "#a1a1aa" }}>
                <div className="font-mono">
                  <span style={{ color: COLORS.sign }}>S</span>
                  {" "}
                  <span style={{ color: COLORS.exponent }}>EEEEEEEE</span>
                  {" "}
                  <span style={{ color: COLORS.mantissa }}>MMMMMMMMMMMMMMMMMMMMMMM</span>
                </div>
                <div>
                  <span className="font-semibold text-white">32 bits total:</span>
                </div>
                <ul className="space-y-1.5 ml-2">
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ background: COLORS.sign }} />
                    <span>
                      <span style={{ color: COLORS.sign }} className="font-semibold">1 sign bit</span> — 0 = positive, 1 = negative
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ background: COLORS.exponent }} />
                    <span>
                      <span style={{ color: COLORS.exponent }} className="font-semibold">8 exponent bits</span> — biased by 127 (stored = actual + 127)
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ background: COLORS.mantissa }} />
                    <span>
                      <span style={{ color: COLORS.mantissa }} className="font-semibold">23 mantissa bits</span> — fractional part with implicit leading 1
                    </span>
                  </li>
                </ul>
                <div className="pt-2 border-t" style={{ borderColor: COLORS.border }}>
                  <span className="font-semibold text-white">Value = </span>
                  <span style={{ color: COLORS.sign }}>(-1)^S</span>
                  {" × "}
                  <span style={{ color: COLORS.mantissa }}>1.M</span>
                  {" × "}
                  <span style={{ color: COLORS.exponent }}>2^(E-127)</span>
                </div>
              </div>
            </div>

            {/* Special values reference */}
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
                  Special Values in IEEE 754
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b" style={{ borderColor: COLORS.border }}>
                      <th className="px-2 py-2 text-left font-medium text-[#71717a]">Value</th>
                      <th className="px-2 py-2 text-left font-medium text-[#71717a]">Exponent</th>
                      <th className="px-2 py-2 text-left font-medium text-[#71717a]">Mantissa</th>
                      <th className="px-2 py-2 text-left font-medium text-[#71717a]">Sign</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { value: "+0", exp: "00000000", man: "All 0s", sign: "0" },
                      { value: "-0", exp: "00000000", man: "All 0s", sign: "1" },
                      { value: "+Inf", exp: "11111111", man: "All 0s", sign: "0" },
                      { value: "-Inf", exp: "11111111", man: "All 0s", sign: "1" },
                      { value: "NaN", exp: "11111111", man: "Non-zero", sign: "Any" },
                      { value: "Denorm", exp: "00000000", man: "Non-zero", sign: "Any" },
                    ].map((row) => (
                      <tr
                        key={row.value}
                        className="border-b"
                        style={{ borderColor: "rgba(30,30,46,0.5)" }}
                      >
                        <td className="px-2 py-2 font-mono font-semibold text-white">
                          {row.value}
                        </td>
                        <td className="px-2 py-2 font-mono" style={{ color: COLORS.exponent }}>
                          {row.exp}
                        </td>
                        <td className="px-2 py-2 font-mono" style={{ color: COLORS.mantissa }}>
                          {row.man}
                        </td>
                        <td className="px-2 py-2 font-mono" style={{ color: COLORS.sign }}>
                          {row.sign}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 p-2.5 rounded-lg" style={{ background: "#1e1e2e" }}>
                <div className="flex items-start gap-2">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" style={{ color: COLORS.accent }} />
                  <span className="text-[11px]" style={{ color: "#a1a1aa" }}>
                    <span className="font-semibold text-white">Precision:</span> Float32 has about
                    7 decimal digits of precision. Numbers like 0.1 cannot be exactly represented
                    because they have infinite binary expansions (like 1/3 in decimal).
                  </span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Interesting Comparisons ─────────────────────────────────── */}
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
                <InfinityIcon size={14} style={{ color: COLORS.secondary }} />
                <span className="text-sm font-semibold text-white">
                  Float32 Range & Properties
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-px" style={{ background: COLORS.border }}>
              {[
                {
                  label: "Smallest Positive Normal",
                  value: "1.175 × 10^-38",
                  color: COLORS.success,
                },
                {
                  label: "Largest Finite",
                  value: "3.403 × 10^38",
                  color: COLORS.danger,
                },
                {
                  label: "Machine Epsilon",
                  value: "1.192 × 10^-7",
                  color: COLORS.accent,
                },
                {
                  label: "Decimal Precision",
                  value: "~7.2 digits",
                  color: COLORS.primary,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="p-4"
                  style={{ background: COLORS.card }}
                >
                  <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1">
                    {item.label}
                  </div>
                  <div className="font-mono text-sm font-semibold" style={{ color: item.color }}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
