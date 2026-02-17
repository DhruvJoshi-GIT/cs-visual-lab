"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  Clock,
  RotateCw,
  ArrowRight,
  ArrowDown,
  ChevronDown,
  Activity,
  Cpu,
  CircleDot,
  Binary,
  Info,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

type CircuitType =
  | "shift-register"
  | "up-counter"
  | "down-counter"
  | "ring-counter"
  | "fsm-traffic";

interface ScenarioPreset {
  id: string;
  label: string;
  circuitType: CircuitType;
  description: string;
}

interface FlipFlopState {
  bits: number[];
  label: string;
}

interface FSMState {
  id: string;
  label: string;
  color: string;
  output: string;
  x: number;
  y: number;
}

interface FSMTransition {
  from: string;
  to: string;
  label: string;
}

interface HistoryEntry {
  step: number;
  bits: number[];
  decimal: number;
  state?: string;
}

interface CircuitInfo {
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

const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: "shift-register",
    label: "Shift Register",
    circuitType: "shift-register",
    description: "4-bit serial-in shift register with clock-driven data movement",
  },
  {
    id: "up-counter",
    label: "Up Counter",
    circuitType: "up-counter",
    description: "4-bit binary up counter incrementing on each clock edge",
  },
  {
    id: "ring-counter",
    label: "Ring Counter",
    circuitType: "ring-counter",
    description: "4-bit ring counter with a single rotating hot bit",
  },
  {
    id: "fsm-traffic",
    label: "Traffic Light FSM",
    circuitType: "fsm-traffic",
    description: "Finite state machine controlling a traffic light sequence",
  },
];

const FSM_STATES: FSMState[] = [
  { id: "GREEN", label: "GREEN", color: "#10b981", output: "Go", x: 120, y: 180 },
  { id: "YELLOW", label: "YELLOW", color: "#f59e0b", output: "Caution", x: 340, y: 80 },
  { id: "RED", label: "RED", color: "#ef4444", output: "Stop", x: 560, y: 180 },
  { id: "RED_WAIT", label: "RED WAIT", color: "#ef4444", output: "Stop (wait)", x: 340, y: 300 },
];

const FSM_TRANSITIONS: FSMTransition[] = [
  { from: "GREEN", to: "YELLOW", label: "timer=5" },
  { from: "YELLOW", to: "RED", label: "timer=2" },
  { from: "RED", to: "RED_WAIT", label: "timer=5" },
  { from: "RED_WAIT", to: "GREEN", label: "timer=2" },
];

const FSM_SEQUENCE = ["GREEN", "GREEN", "GREEN", "GREEN", "GREEN", "YELLOW", "YELLOW", "RED", "RED", "RED", "RED", "RED", "RED_WAIT", "RED_WAIT"];

const CIRCUIT_INFO: Record<CircuitType, CircuitInfo> = {
  "shift-register": {
    title: "4-Bit Shift Register",
    description:
      "A shift register is a cascade of flip-flops sharing the same clock, where the output of each flip-flop is connected to the input of the next. Data shifts one position per clock cycle.",
    details: [
      "Serial-In: A new bit enters from the left on each clock edge",
      "Serial-Out: The rightmost bit exits on each shift",
      "Applications: Serial-to-parallel conversion, delay lines, data buffering",
      "Each D flip-flop captures its input only on the rising edge of the clock",
    ],
  },
  "up-counter": {
    title: "4-Bit Binary Up Counter",
    description:
      "A binary up counter increments its stored value by 1 on each clock pulse. It counts from 0 to 15 (2^4 - 1) and then wraps around to 0.",
    details: [
      "Uses T (toggle) flip-flops connected in ripple configuration",
      "The LSB toggles every clock cycle; each subsequent bit toggles when all lower bits are 1",
      "Counts: 0000 -> 0001 -> 0010 -> ... -> 1111 -> 0000",
      "Applications: Event counting, frequency division, address generation",
    ],
  },
  "down-counter": {
    title: "4-Bit Binary Down Counter",
    description:
      "A binary down counter decrements its stored value by 1 on each clock pulse. It counts from 15 down to 0 and wraps around.",
    details: [
      "Similar to up counter but with inverted carry logic",
      "The LSB still toggles every cycle; subsequent bits toggle when all lower bits are 0",
      "Counts: 1111 -> 1110 -> 1101 -> ... -> 0000 -> 1111",
      "Applications: Countdown timers, PWM generation, watchdog timers",
    ],
  },
  "ring-counter": {
    title: "4-Bit Ring Counter",
    description:
      "A ring counter is a shift register where the output of the last flip-flop feeds back to the input of the first. Exactly one bit is '1' at any time, rotating through positions.",
    details: [
      "Initialized with a single '1' bit (e.g., 1000)",
      "On each clock edge, the hot bit shifts one position right and wraps around",
      "Provides N distinct states for N flip-flops (vs 2^N for binary counter)",
      "Applications: Sequence generation, stepper motor control, one-hot encoding",
    ],
  },
  "fsm-traffic": {
    title: "Traffic Light FSM",
    description:
      "A finite state machine (FSM) is a computation model with a finite number of states, transitions between those states, and actions. This FSM models a traffic light controller.",
    details: [
      "States: GREEN (go), YELLOW (caution), RED (stop), RED_WAIT (stop with wait)",
      "Each state has a defined duration controlled by an internal timer",
      "Transitions occur when the timer expires, moving to the next state",
      "The output (light color) is determined by the current state (Moore machine)",
    ],
  },
};

// ─── Simulation Logic ─────────────────────────────────────────────────────────

function bitsToDecimal(bits: number[]): number {
  let value = 0;
  for (let i = 0; i < bits.length; i++) {
    value = (value << 1) | bits[i];
  }
  return value;
}

function decimalToBits(value: number, width: number): number[] {
  const bits: number[] = [];
  for (let i = width - 1; i >= 0; i--) {
    bits.push((value >> i) & 1);
  }
  return bits;
}

function stepShiftRegister(bits: number[], serialInput: number): number[] {
  const newBits = [serialInput, ...bits.slice(0, bits.length - 1)];
  return newBits;
}

function stepUpCounter(bits: number[]): number[] {
  const value = bitsToDecimal(bits);
  const next = (value + 1) % (1 << bits.length);
  return decimalToBits(next, bits.length);
}

function stepDownCounter(bits: number[]): number[] {
  const value = bitsToDecimal(bits);
  const next = (value - 1 + (1 << bits.length)) % (1 << bits.length);
  return decimalToBits(next, bits.length);
}

function stepRingCounter(bits: number[]): number[] {
  const last = bits[bits.length - 1];
  return [last, ...bits.slice(0, bits.length - 1)];
}

function getNextFSMState(current: string, step: number): string {
  const idx = step % FSM_SEQUENCE.length;
  return FSM_SEQUENCE[idx];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SequentialCircuitsPage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [circuitType, setCircuitType] = useState<CircuitType>("shift-register");
  const [bits, setBits] = useState<number[]>([0, 0, 0, 0]);
  const [serialInput, setSerialInput] = useState(1);
  const [fsmCurrentState, setFsmCurrentState] = useState("GREEN");
  const [clockCycles, setClockCycles] = useState(0);
  const [clockHigh, setClockHigh] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([
    { step: 0, bits: [0, 0, 0, 0], decimal: 0, state: "GREEN" },
  ]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [shiftDirection, setShiftDirection] = useState<"left" | "right">("right");
  const [animatingBit, setAnimatingBit] = useState<number | null>(null);
  const [prevBits, setPrevBits] = useState<number[]>([0, 0, 0, 0]);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const clockCyclesRef = useRef(0);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // ── Step forward ────────────────────────────────────────────────────────────
  const stepForward = useCallback(() => {
    setClockHigh(true);
    setTimeout(() => setClockHigh(false), 150);

    setBits((prevBitsState) => {
      let newBits: number[];
      setPrevBits(prevBitsState);

      switch (circuitType) {
        case "shift-register":
          if (shiftDirection === "right") {
            newBits = stepShiftRegister(prevBitsState, serialInput);
          } else {
            const reversed = [...prevBitsState].reverse();
            const shifted = stepShiftRegister(reversed, serialInput);
            newBits = shifted.reverse();
          }
          break;
        case "up-counter":
          newBits = stepUpCounter(prevBitsState);
          break;
        case "down-counter":
          newBits = stepDownCounter(prevBitsState);
          break;
        case "ring-counter":
          newBits = stepRingCounter(prevBitsState);
          break;
        case "fsm-traffic": {
          clockCyclesRef.current += 1;
          const nextState = getNextFSMState(fsmCurrentState, clockCyclesRef.current);
          setFsmCurrentState(nextState);
          newBits = prevBitsState;
          setClockCycles((c) => c + 1);
          setHistory((h) => {
            const entry: HistoryEntry = {
              step: clockCyclesRef.current,
              bits: newBits,
              decimal: bitsToDecimal(newBits),
              state: nextState,
            };
            return [...h.slice(-11), entry];
          });
          return newBits;
        }
        default:
          newBits = prevBitsState;
      }

      // find which bit changed for animation
      for (let i = 0; i < newBits.length; i++) {
        if (newBits[i] !== prevBitsState[i]) {
          setAnimatingBit(i);
          setTimeout(() => setAnimatingBit(null), 300);
          break;
        }
      }

      clockCyclesRef.current += 1;
      setClockCycles((c) => c + 1);
      setHistory((h) => {
        const entry: HistoryEntry = {
          step: clockCyclesRef.current,
          bits: [...newBits],
          decimal: bitsToDecimal(newBits),
          state: undefined,
        };
        return [...h.slice(-11), entry];
      });

      return newBits;
    });
  }, [circuitType, serialInput, shiftDirection, fsmCurrentState]);

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
    if (circuitType === "ring-counter") {
      setBits([1, 0, 0, 0]);
      setPrevBits([1, 0, 0, 0]);
      setHistory([{ step: 0, bits: [1, 0, 0, 0], decimal: 8 }]);
    } else {
      setBits([0, 0, 0, 0]);
      setPrevBits([0, 0, 0, 0]);
      setHistory([{ step: 0, bits: [0, 0, 0, 0], decimal: 0, state: "GREEN" }]);
    }
    setClockCycles(0);
    clockCyclesRef.current = 0;
    setFsmCurrentState("GREEN");
    setAnimatingBit(null);
  }, [handlePause, circuitType]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Reset when circuit type changes
  useEffect(() => {
    handlePause();
    if (circuitType === "ring-counter") {
      setBits([1, 0, 0, 0]);
      setPrevBits([1, 0, 0, 0]);
      setHistory([{ step: 0, bits: [1, 0, 0, 0], decimal: 8 }]);
    } else {
      setBits([0, 0, 0, 0]);
      setPrevBits([0, 0, 0, 0]);
      setHistory([{ step: 0, bits: [0, 0, 0, 0], decimal: 0, state: "GREEN" }]);
    }
    setClockCycles(0);
    clockCyclesRef.current = 0;
    setFsmCurrentState("GREEN");
    setAnimatingBit(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuitType]);

  const currentDecimal = bitsToDecimal(bits);
  const info = CIRCUIT_INFO[circuitType];

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
                1.4
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Sequential Circuits
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Explore registers, counters, and finite state machines. Watch how
              sequential circuits store and transform data on each clock edge,
              building the foundation for processors and memory.
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
                Prerequisite: Flip-Flops & Combinational Logic
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
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <Activity size={14} className="text-[#6366f1]" />
                {SCENARIO_PRESETS.find((p) => p.circuitType === circuitType)?.label || "Select Circuit"}
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
                      minWidth: "280px",
                    }}
                  >
                    {SCENARIO_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => {
                          setCircuitType(preset.circuitType);
                          setDropdownOpen(false);
                        }}
                        className="w-full flex flex-col px-4 py-3 text-left transition-all duration-150"
                        style={{
                          color: circuitType === preset.circuitType ? "#6366f1" : "#a1a1aa",
                          background:
                            circuitType === preset.circuitType
                              ? "rgba(99,102,241,0.08)"
                              : "transparent",
                        }}
                        onMouseEnter={(e) => {
                          if (circuitType !== preset.circuitType)
                            e.currentTarget.style.background = "#16161f";
                        }}
                        onMouseLeave={(e) => {
                          if (circuitType !== preset.circuitType)
                            e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <span className="text-sm font-medium">{preset.label}</span>
                        <span className="text-[11px] text-[#71717a] mt-0.5">
                          {preset.description}
                        </span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Shift register direction toggle */}
            {circuitType === "shift-register" && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShiftDirection("right")}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                  style={{
                    background: shiftDirection === "right" ? "rgba(99,102,241,0.12)" : "transparent",
                    color: shiftDirection === "right" ? "#6366f1" : "#71717a",
                    border: shiftDirection === "right" ? "1px solid rgba(99,102,241,0.2)" : "1px solid transparent",
                  }}
                >
                  Shift Right
                </button>
                <button
                  onClick={() => setShiftDirection("left")}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                  style={{
                    background: shiftDirection === "left" ? "rgba(99,102,241,0.12)" : "transparent",
                    color: shiftDirection === "left" ? "#6366f1" : "#71717a",
                    border: shiftDirection === "left" ? "1px solid rgba(99,102,241,0.2)" : "1px solid transparent",
                  }}
                >
                  Shift Left
                </button>
              </div>
            )}

            {/* Serial input toggle for shift register */}
            {circuitType === "shift-register" && (
              <button
                onClick={() => setSerialInput((s) => (s === 0 ? 1 : 0))}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: serialInput === 1 ? "rgba(6,182,212,0.1)" : COLORS.card,
                  border: serialInput === 1 ? "1px solid rgba(6,182,212,0.3)" : `1px solid ${COLORS.border}`,
                  color: serialInput === 1 ? "#06b6d4" : "#a1a1aa",
                }}
              >
                <Binary size={14} />
                Serial In: {serialInput}
              </button>
            )}

            <div className="flex-1" />

            {/* Quick presets */}
            <div className="flex items-center gap-1">
              {SCENARIO_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setCircuitType(preset.circuitType)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                  style={{
                    background:
                      circuitType === preset.circuitType
                        ? "rgba(99,102,241,0.12)"
                        : "transparent",
                    color: circuitType === preset.circuitType ? "#6366f1" : "#71717a",
                    border:
                      circuitType === preset.circuitType
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
            {/* Clock signal */}
            <div
              className="flex items-center gap-3 px-5 py-3 border-b"
              style={{ borderColor: COLORS.border }}
            >
              <Clock size={14} className="text-[#06b6d4]" />
              <span className="text-xs font-mono text-[#71717a]">CLK</span>
              <div className="flex-1 flex items-center gap-0.5">
                {Array.from({ length: 32 }).map((_, i) => {
                  const isCurrentPulse = i === clockCycles % 32;
                  const isPast = i < clockCycles % 32;
                  const isHigh = i % 2 === 0;
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-sm transition-all duration-100"
                      style={{
                        height: isHigh ? "16px" : "6px",
                        marginTop: isHigh ? "0px" : "10px",
                        background:
                          isCurrentPulse && clockHigh
                            ? "#06b6d4"
                            : isPast
                            ? "rgba(6,182,212,0.3)"
                            : "rgba(30,30,46,0.8)",
                        boxShadow:
                          isCurrentPulse && clockHigh
                            ? "0 0 8px rgba(6,182,212,0.5)"
                            : "none",
                      }}
                    />
                  );
                })}
              </div>
              <motion.div
                animate={{
                  scale: clockHigh ? 1.3 : 1,
                  opacity: clockHigh ? 1 : 0.4,
                }}
                transition={{ duration: 0.15 }}
                className="w-3 h-3 rounded-full"
                style={{
                  background: clockHigh ? "#06b6d4" : "#1e1e2e",
                  boxShadow: clockHigh ? "0 0 12px rgba(6,182,212,0.6)" : "none",
                }}
              />
            </div>

            {/* Circuit visualization area */}
            <div style={{ minHeight: "380px" }} className="relative p-6">
              {circuitType === "fsm-traffic" ? (
                <FSMVisualization
                  currentState={fsmCurrentState}
                  clockCycles={clockCycles}
                />
              ) : (
                <RegisterVisualization
                  bits={bits}
                  prevBits={prevBits}
                  circuitType={circuitType}
                  animatingBit={animatingBit}
                  serialInput={serialInput}
                  shiftDirection={shiftDirection}
                  clockHigh={clockHigh}
                />
              )}
            </div>

            {/* Decimal value display */}
            {circuitType !== "fsm-traffic" && (
              <div
                className="flex items-center justify-center gap-4 px-5 py-3 border-t"
                style={{ borderColor: COLORS.border }}
              >
                <span className="text-xs text-[#71717a] font-mono">Binary:</span>
                <span className="text-sm font-mono font-bold text-white tracking-widest">
                  {bits.join("")}
                </span>
                <div className="w-px h-4" style={{ background: COLORS.border }} />
                <span className="text-xs text-[#71717a] font-mono">Decimal:</span>
                <motion.span
                  key={currentDecimal}
                  initial={{ scale: 1.3, color: "#06b6d4" }}
                  animate={{ scale: 1, color: "#ffffff" }}
                  transition={{ duration: 0.3 }}
                  className="text-sm font-mono font-bold"
                >
                  {currentDecimal}
                </motion.span>
              </div>
            )}

            {/* FSM output display */}
            {circuitType === "fsm-traffic" && (
              <div
                className="flex items-center justify-center gap-4 px-5 py-3 border-t"
                style={{ borderColor: COLORS.border }}
              >
                <span className="text-xs text-[#71717a] font-mono">Current State:</span>
                <span
                  className="text-sm font-mono font-bold"
                  style={{
                    color: FSM_STATES.find((s) => s.id === fsmCurrentState)?.color || "#fff",
                  }}
                >
                  {fsmCurrentState}
                </span>
                <div className="w-px h-4" style={{ background: COLORS.border }} />
                <span className="text-xs text-[#71717a] font-mono">Output:</span>
                <span className="text-sm font-mono font-bold text-white">
                  {FSM_STATES.find((s) => s.id === fsmCurrentState)?.output || ""}
                </span>
              </div>
            )}
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
            />
          </motion.div>

          {/* ── Metrics & History ──────────────────────────────────────── */}
          <AnimatePresence>
            {showMetrics && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4"
              >
                {/* Metrics panel */}
                <div
                  className="rounded-2xl p-5"
                  style={{
                    background: COLORS.card,
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <RotateCw size={14} className="text-[#6366f1]" />
                    <span className="text-sm font-semibold text-white">Metrics</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <MetricCard
                      label="Clock Cycles"
                      value={clockCycles.toString()}
                      color="#06b6d4"
                    />
                    <MetricCard
                      label={circuitType === "fsm-traffic" ? "Current State" : "Decimal Value"}
                      value={
                        circuitType === "fsm-traffic"
                          ? fsmCurrentState
                          : currentDecimal.toString()
                      }
                      color="#6366f1"
                    />
                    <MetricCard
                      label={circuitType === "fsm-traffic" ? "Output" : "Binary Value"}
                      value={
                        circuitType === "fsm-traffic"
                          ? FSM_STATES.find((s) => s.id === fsmCurrentState)?.output || ""
                          : bits.join("")
                      }
                      color="#10b981"
                    />
                  </div>
                </div>

                {/* State history timeline */}
                <div
                  className="rounded-2xl p-5"
                  style={{
                    background: COLORS.card,
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <Clock size={14} className="text-[#f59e0b]" />
                    <span className="text-sm font-semibold text-white">State History</span>
                  </div>
                  <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
                    {history.map((entry, idx) => (
                      <motion.div
                        key={`${entry.step}-${idx}`}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2 }}
                        className="flex items-center gap-3 px-3 py-1.5 rounded-lg"
                        style={{
                          background:
                            idx === history.length - 1
                              ? "rgba(99,102,241,0.08)"
                              : "transparent",
                          border:
                            idx === history.length - 1
                              ? "1px solid rgba(99,102,241,0.15)"
                              : "1px solid transparent",
                        }}
                      >
                        <span className="text-[10px] font-mono text-[#71717a] w-8">
                          T={entry.step}
                        </span>
                        <span className="text-xs font-mono text-white tracking-wider">
                          {entry.bits.join("")}
                        </span>
                        <span className="text-xs font-mono text-[#06b6d4]">
                          = {entry.decimal}
                        </span>
                        {entry.state && (
                          <span
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                            style={{
                              color: FSM_STATES.find((s) => s.id === entry.state)?.color || "#71717a",
                              background: `${FSM_STATES.find((s) => s.id === entry.state)?.color || "#71717a"}15`,
                            }}
                          >
                            {entry.state}
                          </span>
                        )}
                      </motion.div>
                    ))}
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
        <div
          className="fixed inset-0 z-40"
          onClick={() => setDropdownOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Register / Counter Visualization ─────────────────────────────────────────

function RegisterVisualization({
  bits,
  prevBits,
  circuitType,
  animatingBit,
  serialInput,
  shiftDirection,
  clockHigh,
}: {
  bits: number[];
  prevBits: number[];
  circuitType: CircuitType;
  animatingBit: number | null;
  serialInput: number;
  shiftDirection: "left" | "right";
  clockHigh: boolean;
}) {
  const isCounter = circuitType === "up-counter" || circuitType === "down-counter";
  const isRing = circuitType === "ring-counter";
  const isShift = circuitType === "shift-register";

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8">
      {/* Circuit title */}
      <div className="text-center">
        <h3 className="text-lg font-semibold text-white mb-1">
          {circuitType === "shift-register"
            ? `4-Bit Shift Register (${shiftDirection === "right" ? "Right" : "Left"})`
            : circuitType === "up-counter"
            ? "4-Bit Up Counter"
            : circuitType === "down-counter"
            ? "4-Bit Down Counter"
            : "4-Bit Ring Counter"}
        </h3>
        <p className="text-xs text-[#71717a]">
          {isShift
            ? "Data shifts through flip-flops on each clock edge"
            : isCounter
            ? "Binary value changes on each clock edge"
            : "Single hot bit rotates through positions"}
        </p>
      </div>

      {/* Serial input indicator for shift register */}
      {isShift && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-[#71717a] uppercase">Serial In</span>
            <motion.div
              animate={{
                background: serialInput === 1 ? "#06b6d4" : "#1e1e2e",
                boxShadow: serialInput === 1 ? "0 0 12px rgba(6,182,212,0.4)" : "none",
              }}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-mono font-bold text-white border"
              style={{ borderColor: serialInput === 1 ? "#06b6d4" : "#2a2a3e" }}
            >
              {serialInput}
            </motion.div>
          </div>
          <ArrowRight size={16} className="text-[#71717a]" />
        </div>
      )}

      {/* Flip-flop boxes */}
      <div className="flex items-center gap-4">
        {bits.map((bit, idx) => {
          const changed = bit !== prevBits[idx];
          const isAnimating = animatingBit === idx;
          const isHot = isRing && bit === 1;
          const bitLabel = `Q${idx}`;
          const weight = Math.pow(2, bits.length - 1 - idx);

          return (
            <div key={idx} className="flex flex-col items-center gap-2">
              {/* Bit weight label */}
              <span className="text-[10px] font-mono text-[#71717a]">2^{bits.length - 1 - idx}</span>

              {/* Flip-flop box */}
              <motion.div
                animate={{
                  scale: isAnimating ? 1.08 : 1,
                  borderColor: isAnimating
                    ? "#06b6d4"
                    : isHot
                    ? "#f59e0b"
                    : bit === 1
                    ? "#6366f1"
                    : "#2a2a3e",
                  boxShadow: isAnimating
                    ? "0 0 20px rgba(6,182,212,0.4)"
                    : isHot
                    ? "0 0 16px rgba(245,158,11,0.3)"
                    : bit === 1
                    ? "0 0 12px rgba(99,102,241,0.2)"
                    : "none",
                }}
                transition={{ duration: 0.2 }}
                className="relative w-20 h-20 rounded-xl border-2 flex flex-col items-center justify-center"
                style={{
                  background: bit === 1
                    ? isHot
                      ? "rgba(245,158,11,0.1)"
                      : "rgba(99,102,241,0.1)"
                    : "rgba(30,30,46,0.5)",
                }}
              >
                {/* D Flip-Flop label */}
                <span className="absolute top-1 left-2 text-[8px] font-mono text-[#71717a]">
                  D-FF
                </span>

                {/* Bit value */}
                <motion.span
                  key={`${idx}-${bit}`}
                  initial={changed ? { scale: 1.5, color: "#06b6d4" } : {}}
                  animate={{ scale: 1, color: bit === 1 ? "#ffffff" : "#71717a" }}
                  transition={{ duration: 0.3 }}
                  className="text-2xl font-mono font-bold"
                >
                  {bit}
                </motion.span>

                {/* Q label */}
                <span className="text-[9px] font-mono text-[#71717a] mt-1">{bitLabel}</span>

                {/* Clock edge indicator */}
                <motion.div
                  animate={{ opacity: clockHigh ? 1 : 0 }}
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full"
                  style={{ background: "#06b6d4" }}
                />
              </motion.div>

              {/* Weight value */}
              <span className="text-[10px] font-mono text-[#71717a]">{weight}</span>

              {/* Connection arrow to next flip-flop */}
              {idx < bits.length - 1 && isShift && (
                <div className="absolute" style={{ left: `calc(${(idx + 1) * 25}% - 8px)` }}>
                  <ArrowRight size={12} className="text-[#71717a]" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Connection lines between flip-flops */}
      <div className="flex items-center gap-2">
        {isShift && (
          <div className="flex items-center gap-1 text-[10px] font-mono text-[#71717a]">
            <ArrowRight size={14} className="text-[#06b6d4]" />
            <span>Data flows {shiftDirection === "right" ? "left to right" : "right to left"}</span>
          </div>
        )}
        {isRing && (
          <div className="flex items-center gap-1 text-[10px] font-mono text-[#71717a]">
            <RotateCw size={14} className="text-[#f59e0b]" />
            <span>Output feeds back to input (circular)</span>
          </div>
        )}
        {isCounter && (
          <div className="flex items-center gap-1 text-[10px] font-mono text-[#71717a]">
            {circuitType === "up-counter" ? (
              <>
                <ArrowRight size={14} className="text-[#10b981]" />
                <span>Counting up: {bitsToDecimal(bits)} / 15</span>
              </>
            ) : (
              <>
                <ArrowDown size={14} className="text-[#ef4444]" />
                <span>Counting down: {bitsToDecimal(bits)} / 15</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Counter progress bar */}
      {(isCounter || isRing) && (
        <div className="w-full max-w-md">
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ background: "rgba(30,30,46,0.8)" }}
          >
            <motion.div
              animate={{
                width: isRing
                  ? `${(bits.indexOf(1) / (bits.length - 1)) * 100}%`
                  : `${(bitsToDecimal(bits) / 15) * 100}%`,
              }}
              transition={{ duration: 0.2 }}
              className="h-full rounded-full"
              style={{
                background:
                  circuitType === "up-counter"
                    ? "linear-gradient(to right, #6366f1, #10b981)"
                    : circuitType === "down-counter"
                    ? "linear-gradient(to right, #ef4444, #6366f1)"
                    : "linear-gradient(to right, #f59e0b, #06b6d4)",
              }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[9px] font-mono text-[#71717a]">0</span>
            <span className="text-[9px] font-mono text-[#71717a]">15</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FSM Visualization ────────────────────────────────────────────────────────

function FSMVisualization({
  currentState,
  clockCycles,
}: {
  currentState: string;
  clockCycles: number;
}) {
  const svgWidth = 700;
  const svgHeight = 380;
  const stateRadius = 45;

  // Find active transition
  const activeTransition = FSM_TRANSITIONS.find((t) => t.from === currentState);

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <h3 className="text-lg font-semibold text-white mb-2">Traffic Light FSM</h3>
      <p className="text-xs text-[#71717a] mb-4">Moore machine: output depends only on current state</p>

      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full max-w-2xl"
        style={{ maxHeight: "300px" }}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="10"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#71717a" />
          </marker>
          <marker
            id="arrowhead-active"
            markerWidth="10"
            markerHeight="7"
            refX="10"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#06b6d4" />
          </marker>
          {/* Glow filters for each state color */}
          <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feFlood floodColor="#10b981" floodOpacity="0.5" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="shadow" />
            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-yellow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feFlood floodColor="#f59e0b" floodOpacity="0.5" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="shadow" />
            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-red" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feFlood floodColor="#ef4444" floodOpacity="0.5" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="shadow" />
            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Transitions (arrows) */}
        {FSM_TRANSITIONS.map((transition, idx) => {
          const fromState = FSM_STATES.find((s) => s.id === transition.from)!;
          const toState = FSM_STATES.find((s) => s.id === transition.to)!;
          const isActive = transition.from === currentState;

          // Calculate arrow path
          const dx = toState.x - fromState.x;
          const dy = toState.y - fromState.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const nx = dx / dist;
          const ny = dy / dist;

          const startX = fromState.x + nx * (stateRadius + 2);
          const startY = fromState.y + ny * (stateRadius + 2);
          const endX = toState.x - nx * (stateRadius + 12);
          const endY = toState.y - ny * (stateRadius + 12);

          // Curve the arrow
          const midX = (startX + endX) / 2;
          const midY = (startY + endY) / 2;
          const perpX = -ny * 30;
          const perpY = nx * 30;
          const ctrlX = midX + perpX;
          const ctrlY = midY + perpY;

          const labelX = midX + perpX * 0.7;
          const labelY = midY + perpY * 0.7;

          return (
            <g key={idx}>
              <path
                d={`M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`}
                fill="none"
                stroke={isActive ? "#06b6d4" : "#3a3a4e"}
                strokeWidth={isActive ? 2.5 : 1.5}
                markerEnd={isActive ? "url(#arrowhead-active)" : "url(#arrowhead)"}
                strokeDasharray={isActive ? "none" : "none"}
                opacity={isActive ? 1 : 0.5}
              />
              <rect
                x={labelX - 28}
                y={labelY - 10}
                width={56}
                height={20}
                rx={4}
                fill={isActive ? "rgba(6,182,212,0.15)" : "rgba(17,17,24,0.9)"}
                stroke={isActive ? "rgba(6,182,212,0.3)" : "rgba(30,30,46,0.5)"}
                strokeWidth={1}
              />
              <text
                x={labelX}
                y={labelY + 4}
                textAnchor="middle"
                fill={isActive ? "#06b6d4" : "#71717a"}
                fontSize={10}
                fontFamily="monospace"
              >
                {transition.label}
              </text>
            </g>
          );
        })}

        {/* States (circles) */}
        {FSM_STATES.map((state) => {
          const isCurrent = state.id === currentState;
          const glowFilter =
            state.color === "#10b981"
              ? "url(#glow-green)"
              : state.color === "#f59e0b"
              ? "url(#glow-yellow)"
              : "url(#glow-red)";

          return (
            <g key={state.id}>
              {/* State circle */}
              <circle
                cx={state.x}
                cy={state.y}
                r={stateRadius}
                fill={isCurrent ? `${state.color}20` : "rgba(17,17,24,0.8)"}
                stroke={isCurrent ? state.color : "#3a3a4e"}
                strokeWidth={isCurrent ? 3 : 1.5}
                filter={isCurrent ? glowFilter : undefined}
              />
              {/* Inner circle for double-circle effect */}
              <circle
                cx={state.x}
                cy={state.y}
                r={stateRadius - 5}
                fill="none"
                stroke={isCurrent ? `${state.color}60` : "#2a2a3e"}
                strokeWidth={1}
              />
              {/* State label */}
              <text
                x={state.x}
                y={state.y - 6}
                textAnchor="middle"
                fill={isCurrent ? state.color : "#71717a"}
                fontSize={12}
                fontWeight="bold"
                fontFamily="monospace"
              >
                {state.label}
              </text>
              {/* Output label */}
              <text
                x={state.x}
                y={state.y + 12}
                textAnchor="middle"
                fill={isCurrent ? "#a1a1aa" : "#52525b"}
                fontSize={10}
                fontFamily="monospace"
              >
                {state.output}
              </text>

              {/* Current state indicator dot */}
              {isCurrent && (
                <circle
                  cx={state.x}
                  cy={state.y - stateRadius - 12}
                  r={4}
                  fill={state.color}
                >
                  <animate
                    attributeName="opacity"
                    values="1;0.4;1"
                    dur="1.5s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
            </g>
          );
        })}
      </svg>

      {/* Traffic light visualization */}
      <div className="flex items-center gap-6 mt-4">
        <div className="flex flex-col items-center gap-2">
          <div
            className="w-16 h-44 rounded-xl flex flex-col items-center justify-center gap-2 p-2"
            style={{
              background: "#1a1a24",
              border: "2px solid #2a2a3e",
            }}
          >
            {/* Red light */}
            <motion.div
              animate={{
                background:
                  currentState === "RED" || currentState === "RED_WAIT"
                    ? "#ef4444"
                    : "#2a2a2a",
                boxShadow:
                  currentState === "RED" || currentState === "RED_WAIT"
                    ? "0 0 20px rgba(239,68,68,0.6)"
                    : "none",
              }}
              className="w-10 h-10 rounded-full"
            />
            {/* Yellow light */}
            <motion.div
              animate={{
                background: currentState === "YELLOW" ? "#f59e0b" : "#2a2a2a",
                boxShadow:
                  currentState === "YELLOW"
                    ? "0 0 20px rgba(245,158,11,0.6)"
                    : "none",
              }}
              className="w-10 h-10 rounded-full"
            />
            {/* Green light */}
            <motion.div
              animate={{
                background: currentState === "GREEN" ? "#10b981" : "#2a2a2a",
                boxShadow:
                  currentState === "GREEN"
                    ? "0 0 20px rgba(16,185,129,0.6)"
                    : "none",
              }}
              className="w-10 h-10 rounded-full"
            />
          </div>
        </div>

        {/* State transition table */}
        <div className="text-xs">
          <table>
            <thead>
              <tr>
                <th className="px-3 py-1.5 text-left font-medium text-[#71717a]">Current</th>
                <th className="px-3 py-1.5 text-left font-medium text-[#71717a]">Condition</th>
                <th className="px-3 py-1.5 text-left font-medium text-[#71717a]">Next</th>
              </tr>
            </thead>
            <tbody>
              {FSM_TRANSITIONS.map((t, idx) => {
                const isActive = t.from === currentState;
                return (
                  <tr
                    key={idx}
                    style={{
                      background: isActive ? "rgba(6,182,212,0.08)" : "transparent",
                    }}
                  >
                    <td className="px-3 py-1.5">
                      <span
                        className="font-mono"
                        style={{
                          color: FSM_STATES.find((s) => s.id === t.from)?.color || "#71717a",
                        }}
                      >
                        {t.from}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[#71717a]">{t.label}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className="font-mono"
                        style={{
                          color: FSM_STATES.find((s) => s.id === t.to)?.color || "#71717a",
                        }}
                      >
                        {t.to}
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
