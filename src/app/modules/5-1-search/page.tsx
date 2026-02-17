"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Shuffle,
  Target,
  Zap,
  Trophy,
  ArrowRight,
  Hash,
  Minus,
  ChevronRight,
  ChevronDown,
  Info,
  Eye,
  BarChart3,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ============================================================================
// Types
// ============================================================================

type CellState =
  | "default"
  | "current"
  | "checked"
  | "eliminated"
  | "found"
  | "low"
  | "mid"
  | "high"
  | "target";

interface SearchState {
  array: number[];
  linearStates: CellState[];
  binaryStates: CellState[];
  linearIndex: number;
  binaryLow: number;
  binaryHigh: number;
  binaryMid: number;
  linearComparisons: number;
  binaryComparisons: number;
  linearDone: boolean;
  binaryDone: boolean;
  linearFound: boolean;
  binaryFound: boolean;
  target: number;
  message: string;
}

type ScenarioId = "start" | "end" | "middle" | "not-found";

interface Scenario {
  id: ScenarioId;
  label: string;
  description: string;
}

// ============================================================================
// Constants
// ============================================================================

const SCENARIOS: Scenario[] = [
  { id: "start", label: "Target at Start", description: "Target is the first element" },
  { id: "end", label: "Target at End", description: "Target is the last element" },
  { id: "middle", label: "Target in Middle", description: "Target is near the middle" },
  { id: "not-found", label: "Not Found", description: "Target does not exist in the array" },
];

const CELL_COLORS: Record<CellState, { bg: string; border: string; text: string }> = {
  default: { bg: "#1e1e2e", border: "#2a2a3e", text: "#a1a1aa" },
  current: { bg: "#f59e0b", border: "#d97706", text: "#ffffff" },
  checked: { bg: "#2a2a3e", border: "#3a3a4e", text: "#71717a" },
  eliminated: { bg: "#111118", border: "#1a1a24", text: "#3f3f5e" },
  found: { bg: "#10b981", border: "#059669", text: "#ffffff" },
  low: { bg: "#6366f1", border: "#4f46e5", text: "#ffffff" },
  mid: { bg: "#f59e0b", border: "#d97706", text: "#ffffff" },
  high: { bg: "#06b6d4", border: "#0891b2", text: "#ffffff" },
  target: { bg: "#6366f1", border: "#4f46e5", text: "#ffffff" },
};

// ============================================================================
// Array generation
// ============================================================================

function generateSortedArray(size: number): number[] {
  const arr: number[] = [];
  let val = Math.floor(Math.random() * 5) + 1;
  for (let i = 0; i < size; i++) {
    arr.push(val);
    val += Math.floor(Math.random() * 5) + 1;
  }
  return arr;
}

function makeDefaultStates(n: number): CellState[] {
  return new Array(n).fill("default");
}

// ============================================================================
// Search generators
// ============================================================================

function* linearSearchGenerator(
  array: number[],
  target: number
): Generator<{
  index: number;
  comparisons: number;
  done: boolean;
  found: boolean;
  states: CellState[];
  message: string;
}> {
  const n = array.length;
  let comparisons = 0;

  for (let i = 0; i < n; i++) {
    comparisons++;
    const states = makeDefaultStates(n);
    // Mark previously checked
    for (let j = 0; j < i; j++) states[j] = "checked";
    states[i] = "current";

    if (array[i] === target) {
      states[i] = "found";
      yield {
        index: i,
        comparisons,
        done: true,
        found: true,
        states,
        message: `Linear: Found ${target} at index ${i}!`,
      };
      return;
    }

    yield {
      index: i,
      comparisons,
      done: false,
      found: false,
      states,
      message: `Linear: Checking index ${i}, value ${array[i]} ${array[i] < target ? "<" : ">"} ${target}`,
    };
  }

  const finalStates = makeDefaultStates(n);
  for (let i = 0; i < n; i++) finalStates[i] = "checked";
  yield {
    index: n - 1,
    comparisons,
    done: true,
    found: false,
    states: finalStates,
    message: `Linear: ${target} not found after ${comparisons} comparisons`,
  };
}

function* binarySearchGenerator(
  array: number[],
  target: number
): Generator<{
  low: number;
  high: number;
  mid: number;
  comparisons: number;
  done: boolean;
  found: boolean;
  states: CellState[];
  message: string;
}> {
  const n = array.length;
  let low = 0;
  let high = n - 1;
  let comparisons = 0;
  const eliminated = new Set<number>();

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    comparisons++;

    const states = makeDefaultStates(n);
    // Mark eliminated
    eliminated.forEach((i) => (states[i] = "eliminated"));
    // Mark range
    for (let i = low; i <= high; i++) {
      if (!eliminated.has(i)) states[i] = "default";
    }
    states[low] = "low";
    states[high] = "high";
    states[mid] = "mid";

    if (array[mid] === target) {
      states[mid] = "found";
      yield {
        low, high, mid, comparisons,
        done: true, found: true, states,
        message: `Binary: Found ${target} at index ${mid}!`,
      };
      return;
    }

    yield {
      low, high, mid, comparisons,
      done: false, found: false, states,
      message: `Binary: mid=${mid}, value ${array[mid]} ${array[mid] < target ? "<" : ">"} ${target}`,
    };

    if (array[mid] < target) {
      for (let i = low; i <= mid; i++) eliminated.add(i);
      low = mid + 1;
    } else {
      for (let i = mid; i <= high; i++) eliminated.add(i);
      high = mid - 1;
    }
  }

  const finalStates = makeDefaultStates(n);
  eliminated.forEach((i) => (finalStates[i] = "eliminated"));
  for (let i = 0; i < n; i++) {
    if (finalStates[i] !== "eliminated") finalStates[i] = "eliminated";
  }
  yield {
    low, high, mid: -1, comparisons,
    done: true, found: false, states: finalStates,
    message: `Binary: ${target} not found after ${comparisons} comparisons`,
  };
}

// ============================================================================
// Cell component
// ============================================================================

function ArrayCell({
  value,
  index,
  state,
  label,
  showIndex,
  compact,
}: {
  value: number;
  index: number;
  state: CellState;
  label?: string;
  showIndex?: boolean;
  compact?: boolean;
}) {
  const colors = CELL_COLORS[state];
  const size = compact ? "w-8 h-8" : "w-10 h-10";
  const fontSize = compact ? "text-[10px]" : "text-xs";
  const glow =
    state === "current" ? "0 0 12px rgba(245,158,11,0.4)" :
    state === "found" ? "0 0 12px rgba(16,185,129,0.5)" :
    state === "mid" ? "0 0 12px rgba(245,158,11,0.4)" :
    state === "low" ? "0 0 8px rgba(99,102,241,0.3)" :
    state === "high" ? "0 0 8px rgba(6,182,212,0.3)" :
    "none";

  return (
    <div className="flex flex-col items-center gap-0.5">
      {label && (
        <motion.span
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[9px] font-mono font-bold uppercase tracking-wider"
          style={{
            color:
              label === "L" ? "#6366f1" :
              label === "M" ? "#f59e0b" :
              label === "H" ? "#06b6d4" :
              label === "i" ? "#f59e0b" :
              "#71717a",
          }}
        >
          {label}
        </motion.span>
      )}
      <motion.div
        layout
        className={`${size} flex items-center justify-center rounded-lg ${fontSize} font-mono font-semibold transition-colors duration-150`}
        style={{
          background: colors.bg,
          border: `1.5px solid ${colors.border}`,
          color: colors.text,
          boxShadow: glow,
        }}
      >
        {value}
      </motion.div>
      {showIndex && (
        <span className="text-[9px] font-mono text-[#3f3f5e]">{index}</span>
      )}
    </div>
  );
}

// ============================================================================
// Winner badge
// ============================================================================

function WinnerBadge({ winner, linearSteps, binarySteps }: { winner: string | null; linearSteps: number; binarySteps: number }) {
  if (!winner) return null;

  const ratio = linearSteps > 0 && binarySteps > 0
    ? (linearSteps / binarySteps).toFixed(1)
    : "N/A";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
      style={{
        background: "rgba(16,185,129,0.08)",
        border: "1px solid rgba(16,185,129,0.2)",
      }}
    >
      <Trophy size={16} className="text-[#f59e0b]" />
      <span className="text-sm text-white font-medium">
        {winner === "tie" ? (
          "It's a tie!"
        ) : (
          <>
            <span className="text-[#10b981]">{winner === "binary" ? "Binary Search" : "Linear Search"}</span>
            {" wins!"}
          </>
        )}
      </span>
      {winner !== "tie" && ratio !== "N/A" && (
        <span className="text-xs font-mono text-[#71717a]">
          {winner === "binary" ? `${ratio}x faster` : "Linear was faster this time"}
        </span>
      )}
    </motion.div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function SearchPage() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [arraySize, setArraySize] = useState(20);
  const [array, setArray] = useState<number[]>(() => generateSortedArray(20));
  const [target, setTarget] = useState<number | null>(null);
  const [targetInput, setTargetInput] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [activeScenario, setActiveScenario] = useState<ScenarioId | "">("");

  // Linear search state
  const [linearStates, setLinearStates] = useState<CellState[]>(() => makeDefaultStates(20));
  const [linearIndex, setLinearIndex] = useState(-1);
  const [linearComparisons, setLinearComparisons] = useState(0);
  const [linearDone, setLinearDone] = useState(false);
  const [linearFound, setLinearFound] = useState(false);

  // Binary search state
  const [binaryStates, setBinaryStates] = useState<CellState[]>(() => makeDefaultStates(20));
  const [binaryLow, setBinaryLow] = useState(0);
  const [binaryHigh, setBinaryHigh] = useState(19);
  const [binaryMid, setBinaryMid] = useState(-1);
  const [binaryComparisons, setBinaryComparisons] = useState(0);
  const [binaryDone, setBinaryDone] = useState(false);
  const [binaryFound, setBinaryFound] = useState(false);

  const [linearMessage, setLinearMessage] = useState("Waiting for target...");
  const [binaryMessage, setBinaryMessage] = useState("Waiting for target...");
  const [winner, setWinner] = useState<string | null>(null);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const linearGenRef = useRef<ReturnType<typeof linearSearchGenerator> | null>(null);
  const binaryGenRef = useRef<ReturnType<typeof binarySearchGenerator> | null>(null);
  const linearDoneRef = useRef(false);
  const binaryDoneRef = useRef(false);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // ── Array regeneration ─────────────────────────────────────────────────────
  const regenerateArray = useCallback((size: number) => {
    const newArr = generateSortedArray(size);
    setArray(newArr);
    setLinearStates(makeDefaultStates(size));
    setBinaryStates(makeDefaultStates(size));
    setLinearIndex(-1);
    setLinearComparisons(0);
    setLinearDone(false);
    setLinearFound(false);
    setBinaryLow(0);
    setBinaryHigh(size - 1);
    setBinaryMid(-1);
    setBinaryComparisons(0);
    setBinaryDone(false);
    setBinaryFound(false);
    setTarget(null);
    setTargetInput("");
    setLinearMessage("Waiting for target...");
    setBinaryMessage("Waiting for target...");
    setWinner(null);
    linearGenRef.current = null;
    binaryGenRef.current = null;
    linearDoneRef.current = false;
    binaryDoneRef.current = false;
    return newArr;
  }, []);

  useEffect(() => {
    regenerateArray(arraySize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arraySize]);

  // ── Step forward ───────────────────────────────────────────────────────────
  const stepForward = useCallback(() => {
    let anyActive = false;

    // Linear step
    if (linearGenRef.current && !linearDoneRef.current) {
      const result = linearGenRef.current.next();
      if (!result.done) {
        anyActive = true;
        const val = result.value;
        setLinearStates(val.states);
        setLinearIndex(val.index);
        setLinearComparisons(val.comparisons);
        setLinearDone(val.done);
        setLinearFound(val.found);
        setLinearMessage(val.message);
        if (val.done) linearDoneRef.current = true;
      } else {
        linearDoneRef.current = true;
      }
    }

    // Binary step
    if (binaryGenRef.current && !binaryDoneRef.current) {
      const result = binaryGenRef.current.next();
      if (!result.done) {
        anyActive = true;
        const val = result.value;
        setBinaryStates(val.states);
        setBinaryLow(val.low);
        setBinaryHigh(val.high);
        setBinaryMid(val.mid);
        setBinaryComparisons(val.comparisons);
        setBinaryDone(val.done);
        setBinaryFound(val.found);
        setBinaryMessage(val.message);
        if (val.done) binaryDoneRef.current = true;
      } else {
        binaryDoneRef.current = true;
      }
    }

    // Check for winner
    if (linearDoneRef.current && binaryDoneRef.current) {
      anyActive = false;
    }

    return anyActive;
  }, []);

  // Determine winner when both done
  useEffect(() => {
    if (linearDone && binaryDone && !winner) {
      if (linearFound && !binaryFound) setWinner("linear");
      else if (binaryFound && !linearFound) setWinner("binary");
      else if (linearComparisons < binaryComparisons) setWinner("linear");
      else if (binaryComparisons < linearComparisons) setWinner("binary");
      else setWinner("tie");
      setIsPlaying(false);
    }
  }, [linearDone, binaryDone, linearFound, binaryFound, linearComparisons, binaryComparisons, winner]);

  // ── Animation loop ─────────────────────────────────────────────────────────
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(10, 200 / speedRef.current);
      if (timestamp - lastTickRef.current >= interval) {
        lastTickRef.current = timestamp;
        const active = stepForward();
        if (!active) {
          setIsPlaying(false);
          return;
        }
      }
      animationRef.current = requestAnimationFrame(animationLoop);
    },
    [stepForward]
  );

  const handlePlay = useCallback(() => {
    if (linearDone && binaryDone) return;
    if (!target && target !== 0) return;
    setIsPlaying(true);
    isPlayingRef.current = true;
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop, linearDone, binaryDone, target]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const handleStep = useCallback(() => {
    if (linearDone && binaryDone) return;
    handlePause();
    stepForward();
  }, [handlePause, stepForward, linearDone, binaryDone]);

  const handleReset = useCallback(() => {
    handlePause();
    setLinearStates(makeDefaultStates(array.length));
    setBinaryStates(makeDefaultStates(array.length));
    setLinearIndex(-1);
    setLinearComparisons(0);
    setLinearDone(false);
    setLinearFound(false);
    setBinaryLow(0);
    setBinaryHigh(array.length - 1);
    setBinaryMid(-1);
    setBinaryComparisons(0);
    setBinaryDone(false);
    setBinaryFound(false);
    setLinearMessage("Waiting for target...");
    setBinaryMessage("Waiting for target...");
    setWinner(null);
    linearGenRef.current = null;
    binaryGenRef.current = null;
    linearDoneRef.current = false;
    binaryDoneRef.current = false;
    if (target !== null) {
      linearGenRef.current = linearSearchGenerator(array, target);
      binaryGenRef.current = binarySearchGenerator(array, target);
      setLinearMessage(`Linear: Ready to search for ${target}`);
      setBinaryMessage(`Binary: Ready to search for ${target}`);
    }
  }, [handlePause, array, target]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // ── Set target ─────────────────────────────────────────────────────────────
  const startSearch = useCallback(
    (searchTarget: number) => {
      handlePause();
      setTarget(searchTarget);
      setTargetInput(String(searchTarget));
      setLinearStates(makeDefaultStates(array.length));
      setBinaryStates(makeDefaultStates(array.length));
      setLinearIndex(-1);
      setLinearComparisons(0);
      setLinearDone(false);
      setLinearFound(false);
      setBinaryLow(0);
      setBinaryHigh(array.length - 1);
      setBinaryMid(-1);
      setBinaryComparisons(0);
      setBinaryDone(false);
      setBinaryFound(false);
      setWinner(null);
      linearDoneRef.current = false;
      binaryDoneRef.current = false;
      linearGenRef.current = linearSearchGenerator(array, searchTarget);
      binaryGenRef.current = binarySearchGenerator(array, searchTarget);
      setLinearMessage(`Linear: Ready to search for ${searchTarget}`);
      setBinaryMessage(`Binary: Ready to search for ${searchTarget}`);
    },
    [array, handlePause]
  );

  const handleSetTarget = useCallback(() => {
    const val = parseInt(targetInput);
    if (isNaN(val)) return;
    startSearch(val);
  }, [targetInput, startSearch]);

  const handleRandomTarget = useCallback(() => {
    const idx = Math.floor(Math.random() * array.length);
    startSearch(array[idx]);
  }, [array, startSearch]);

  // ── Scenario handling ──────────────────────────────────────────────────────
  const handleScenario = useCallback(
    (id: ScenarioId) => {
      setActiveScenario(id);
      const newArr = regenerateArray(arraySize);

      let searchTarget: number;
      switch (id) {
        case "start":
          searchTarget = newArr[0];
          break;
        case "end":
          searchTarget = newArr[newArr.length - 1];
          break;
        case "middle":
          searchTarget = newArr[Math.floor(newArr.length / 2)];
          break;
        case "not-found":
          searchTarget = newArr[newArr.length - 1] + 1;
          break;
        default:
          searchTarget = newArr[0];
      }

      // Need to set up generators after state updates
      setTimeout(() => {
        startSearch(searchTarget);
      }, 50);
    },
    [arraySize, regenerateArray, startSearch]
  );

  // ── Determine compact mode ─────────────────────────────────────────────────
  const compact = arraySize > 25;

  // ── Speedup ratio ──────────────────────────────────────────────────────────
  const speedupRatio =
    linearComparisons > 0 && binaryComparisons > 0
      ? (linearComparisons / binaryComparisons).toFixed(1)
      : "-";

  // ── Binary search pointer labels ──────────────────────────────────────────
  function getBinaryLabel(index: number): string | undefined {
    if (binaryDone) return undefined;
    const labels: string[] = [];
    if (index === binaryLow) labels.push("L");
    if (index === binaryMid) labels.push("M");
    if (index === binaryHigh) labels.push("H");
    return labels.length > 0 ? labels.join("/") : undefined;
  }

  function getLinearLabel(index: number): string | undefined {
    if (linearDone) return undefined;
    if (index === linearIndex) return "i";
    return undefined;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: "#0a0a0f" }}>
      <Navbar />

      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* ── Header ──────────────────────────────────────────────── */}
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
                  background: "rgba(245,158,11,0.1)",
                  color: "#f59e0b",
                  border: "1px solid rgba(245,158,11,0.2)",
                }}
              >
                5.1
              </span>
              <span className="text-xs text-[#71717a]">Search Algorithms & Systems</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Linear & Binary Search
            </h1>
            <p className="text-sm text-[#a1a1aa] max-w-2xl mt-2">
              Compare linear and binary search side by side on the same sorted array. Watch
              how binary search eliminates half the remaining elements each step, dramatically
              reducing comparisons compared to linear scanning.
            </p>
          </motion.div>

          {/* ── Scenario Presets ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex flex-wrap items-center gap-2 mb-4"
          >
            <div className="flex items-center gap-1.5 text-xs text-[#71717a] mr-1">
              <Target size={14} />
              <span>Presets</span>
            </div>
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => handleScenario(s.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                style={{
                  background: activeScenario === s.id ? "rgba(245,158,11,0.12)" : "#1e1e2e",
                  color: activeScenario === s.id ? "#f59e0b" : "#a1a1aa",
                  border: activeScenario === s.id ? "1px solid rgba(245,158,11,0.3)" : "1px solid transparent",
                }}
                title={s.description}
              >
                {s.label}
              </button>
            ))}
          </motion.div>

          {/* ── Controls Row: Array Size + Target ───────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="flex flex-wrap items-center gap-4 mb-4"
          >
            {/* Array size slider */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#71717a] font-medium whitespace-nowrap">Array Size</span>
              <input
                type="range"
                min={10}
                max={50}
                step={1}
                value={arraySize}
                onChange={(e) => setArraySize(parseInt(e.target.value))}
                className="w-32 h-1.5 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f59e0b] [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-[#f59e0b]/30"
                style={{ background: "#1e1e2e" }}
              />
              <span className="text-xs font-mono font-semibold tabular-nums min-w-[2rem] text-center" style={{ color: "#f59e0b" }}>
                {arraySize}
              </span>
            </div>

            <div className="w-px h-8 bg-[#1e1e2e]" />

            {/* Target input */}
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSetTarget(); }}
                placeholder="Target value..."
                className="w-32 px-3 py-2 rounded-lg text-sm font-mono bg-[#111118] border border-[#1e1e2e] text-white placeholder-[#71717a] focus:outline-none focus:border-[#f59e0b] transition-colors"
              />
              <button
                onClick={handleSetTarget}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                style={{
                  background: "rgba(245,158,11,0.15)",
                  color: "#f59e0b",
                  border: "1px solid rgba(245,158,11,0.3)",
                }}
              >
                <Search size={14} />
                Search
              </button>
              <button
                onClick={handleRandomTarget}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[#1e1e2e] text-[#a1a1aa] hover:text-white hover:bg-[#2a2a3e] transition-all duration-200"
              >
                <Shuffle size={12} />
                Random
              </button>
              <button
                onClick={() => regenerateArray(arraySize)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[#1e1e2e] text-[#a1a1aa] hover:text-white hover:bg-[#2a2a3e] transition-all duration-200"
              >
                <Shuffle size={12} />
                New Array
              </button>
            </div>
          </motion.div>

          {/* ── Target indicator ──────────────────────────────────── */}
          {target !== null && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 mb-4"
            >
              <Target size={14} className="text-[#6366f1]" />
              <span className="text-sm text-[#a1a1aa]">
                Searching for: <span className="text-[#6366f1] font-mono font-bold">{target}</span>
              </span>
            </motion.div>
          )}

          {/* ── Side-by-side visualization ──────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4"
          >
            {/* Linear Search Panel */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: "#111118",
                border: "1px solid #1e1e2e",
                boxShadow: "0 0 0 1px rgba(245,158,11,0.03), 0 20px 50px -12px rgba(0,0,0,0.5)",
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
                <div className="flex items-center gap-2">
                  <ChevronRight size={14} className="text-[#f59e0b]" />
                  <span className="text-sm font-semibold text-white">Linear Search</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-[#71717a]">
                    Time: <span className="text-[#ef4444]">O(n)</span>
                  </span>
                  {linearDone && (
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                      style={{
                        background: linearFound ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
                        color: linearFound ? "#10b981" : "#ef4444",
                        border: `1px solid ${linearFound ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
                      }}
                    >
                      {linearFound ? "FOUND" : "NOT FOUND"}
                    </span>
                  )}
                </div>
              </div>

              {/* Array visualization */}
              <div className="p-4 min-h-[120px]">
                <div className="flex flex-wrap gap-1 justify-center">
                  {array.map((val, i) => (
                    <ArrayCell
                      key={i}
                      value={val}
                      index={i}
                      state={linearStates[i]}
                      label={getLinearLabel(i)}
                      showIndex={!compact}
                      compact={compact}
                    />
                  ))}
                </div>
              </div>

              {/* Status */}
              <div className="px-4 py-2.5 border-t border-[#1e1e2e]">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#a1a1aa]">{linearMessage}</span>
                  <span className="text-xs font-mono text-[#f59e0b]">
                    {linearComparisons} comparisons
                  </span>
                </div>
              </div>
            </div>

            {/* Binary Search Panel */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: "#111118",
                border: "1px solid #1e1e2e",
                boxShadow: "0 0 0 1px rgba(99,102,241,0.03), 0 20px 50px -12px rgba(0,0,0,0.5)",
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
                <div className="flex items-center gap-2">
                  <ChevronDown size={14} className="text-[#6366f1]" />
                  <span className="text-sm font-semibold text-white">Binary Search</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-[#71717a]">
                    Time: <span className="text-[#10b981]">O(log n)</span>
                  </span>
                  {binaryDone && (
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                      style={{
                        background: binaryFound ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
                        color: binaryFound ? "#10b981" : "#ef4444",
                        border: `1px solid ${binaryFound ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
                      }}
                    >
                      {binaryFound ? "FOUND" : "NOT FOUND"}
                    </span>
                  )}
                </div>
              </div>

              {/* Array visualization */}
              <div className="p-4 min-h-[120px]">
                <div className="flex flex-wrap gap-1 justify-center">
                  {array.map((val, i) => (
                    <ArrayCell
                      key={i}
                      value={val}
                      index={i}
                      state={binaryStates[i]}
                      label={getBinaryLabel(i)}
                      showIndex={!compact}
                      compact={compact}
                    />
                  ))}
                </div>
              </div>

              {/* Status */}
              <div className="px-4 py-2.5 border-t border-[#1e1e2e]">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#a1a1aa]">{binaryMessage}</span>
                  <span className="text-xs font-mono text-[#6366f1]">
                    {binaryComparisons} comparisons
                  </span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Winner indicator ──────────────────────────────────── */}
          <AnimatePresence>
            {winner && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-4"
              >
                <WinnerBadge
                  winner={winner}
                  linearSteps={linearComparisons}
                  binarySteps={binaryComparisons}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Legend ──────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
            className="flex flex-wrap items-center justify-center gap-5 mb-4 py-2"
          >
            {[
              { state: "current" as CellState, label: "Checking" },
              { state: "checked" as CellState, label: "Checked" },
              { state: "eliminated" as CellState, label: "Eliminated" },
              { state: "found" as CellState, label: "Found" },
              { state: "low" as CellState, label: "Low (L)" },
              { state: "mid" as CellState, label: "Mid (M)" },
              { state: "high" as CellState, label: "High (H)" },
            ].map(({ state, label }) => (
              <div key={state} className="flex items-center gap-1.5">
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{
                    background: CELL_COLORS[state].bg,
                    border: `1px solid ${CELL_COLORS[state].border}`,
                  }}
                />
                <span className="text-[11px] text-[#71717a]">{label}</span>
              </div>
            ))}
          </motion.div>

          {/* ── Controls ────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
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

          {/* ── Metrics ─────────────────────────────────────────────── */}
          <AnimatePresence>
            {showMetrics && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="flex flex-wrap gap-3 mt-4"
              >
                {[
                  { label: "Linear Steps", value: linearComparisons, color: "#f59e0b", icon: <Eye size={14} /> },
                  { label: "Binary Steps", value: binaryComparisons, color: "#6366f1", icon: <Eye size={14} /> },
                  { label: "Speedup Ratio", value: speedupRatio + "x", color: "#10b981", icon: <Zap size={14} /> },
                  { label: "Array Size", value: arraySize, color: "#06b6d4", icon: <Hash size={14} /> },
                  {
                    label: "Theoretical Max",
                    value: `${arraySize} vs ${Math.ceil(Math.log2(arraySize + 1))}`,
                    color: "#a855f7",
                    icon: <BarChart3 size={14} />,
                  },
                ].map((metric) => (
                  <div
                    key={metric.label}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e]"
                  >
                    <span style={{ color: metric.color }}>{metric.icon}</span>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                        {metric.label}
                      </span>
                      <span className="text-sm font-mono font-semibold" style={{ color: metric.color }}>
                        {metric.value}
                      </span>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Info Panel ──────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-6 rounded-2xl overflow-hidden"
            style={{ background: "#111118", border: "1px solid #1e1e2e" }}
          >
            <div className="px-5 py-3.5 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-2">
                <Info size={14} className="text-[#f59e0b]" />
                <span className="text-sm font-semibold text-white">Comparison</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1e1e2e]">
                    <th className="px-5 py-2.5 text-left font-medium text-[#71717a]">Property</th>
                    <th className="px-5 py-2.5 text-left font-medium text-[#f59e0b]">Linear Search</th>
                    <th className="px-5 py-2.5 text-left font-medium text-[#6366f1]">Binary Search</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { prop: "Time (Best)", linear: "O(1)", binary: "O(1)" },
                    { prop: "Time (Average)", linear: "O(n)", binary: "O(log n)" },
                    { prop: "Time (Worst)", linear: "O(n)", binary: "O(log n)" },
                    { prop: "Space", linear: "O(1)", binary: "O(1)" },
                    { prop: "Requires Sorted?", linear: "No", binary: "Yes" },
                    { prop: "Approach", linear: "Sequential scan", binary: "Divide & conquer" },
                  ].map((row) => (
                    <tr key={row.prop} className="border-b border-[#1e1e2e]/50">
                      <td className="px-5 py-2.5 font-medium text-[#a1a1aa]">{row.prop}</td>
                      <td className="px-5 py-2.5 font-mono text-[#f59e0b]">{row.linear}</td>
                      <td className="px-5 py-2.5 font-mono text-[#6366f1]">{row.binary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Explanation cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5 border-t border-[#1e1e2e]">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-[#f59e0b] uppercase tracking-wider">Linear Search</h3>
                <p className="text-xs text-[#a1a1aa] leading-relaxed">
                  Scans every element from left to right until the target is found or the
                  end of the array is reached. Simple but inefficient for large arrays.
                  Works on both sorted and unsorted arrays.
                </p>
                <div className="flex items-center gap-1 text-[10px] text-[#71717a] font-mono">
                  <span>for i = 0 to n-1:</span>
                  <ArrowRight size={10} />
                  <span>if arr[i] == target: return i</span>
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-[#6366f1] uppercase tracking-wider">Binary Search</h3>
                <p className="text-xs text-[#a1a1aa] leading-relaxed">
                  Repeatedly divides the search space in half by comparing the target
                  with the middle element. Requires a sorted array but achieves
                  logarithmic time complexity, making it vastly superior for large datasets.
                </p>
                <div className="flex items-center gap-1 text-[10px] text-[#71717a] font-mono">
                  <span>mid = (low+high)/2</span>
                  <ArrowRight size={10} />
                  <span>eliminate half each step</span>
                </div>
              </div>
            </div>

            {/* Practical examples */}
            <div className="px-5 pb-5">
              <div className="rounded-xl p-4" style={{ background: "#0a0a0f", border: "1px solid #1e1e2e" }}>
                <h3 className="text-xs font-semibold text-[#06b6d4] uppercase tracking-wider mb-2">
                  Why Does It Matter?
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-[#a1a1aa]">
                  <div className="flex items-start gap-2">
                    <span className="text-[#f59e0b] mt-0.5 font-mono">n=100</span>
                    <span>Linear: up to 100 steps. Binary: up to 7 steps.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[#f59e0b] mt-0.5 font-mono">n=1M</span>
                    <span>Linear: up to 1,000,000 steps. Binary: up to 20 steps.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[#f59e0b] mt-0.5 font-mono">n=1B</span>
                    <span>Linear: up to 1,000,000,000 steps. Binary: up to 30 steps.</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Pseudocode Panel ──────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="mt-4 rounded-2xl overflow-hidden"
            style={{ background: "#111118", border: "1px solid #1e1e2e" }}
          >
            <div className="px-5 py-3.5 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-2">
                <Hash size={14} className="text-[#a855f7]" />
                <span className="text-sm font-semibold text-white">Pseudocode</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-x divide-[#1e1e2e]">
              {/* Linear Search Pseudocode */}
              <div className="p-4">
                <h4 className="text-xs font-semibold text-[#f59e0b] uppercase tracking-wider mb-3">
                  Linear Search
                </h4>
                <div className="space-y-0.5 font-mono text-[11px] leading-relaxed">
                  <div className="text-[#71717a]">
                    <span className="text-[#a855f7]">function</span>{" "}
                    <span className="text-[#f59e0b]">linearSearch</span>
                    <span className="text-[#a1a1aa]">(arr, target):</span>
                  </div>
                  <div className="pl-4 text-[#71717a]">
                    <span className="text-[#a855f7]">for</span>{" "}
                    <span className="text-[#06b6d4]">i</span>{" "}
                    <span className="text-[#a855f7]">=</span>{" "}
                    <span className="text-[#10b981]">0</span>{" "}
                    <span className="text-[#a855f7]">to</span>{" "}
                    <span className="text-[#06b6d4]">arr.length - 1</span>:
                  </div>
                  <div className="pl-8 text-[#71717a]">
                    <span className="text-[#a855f7]">if</span>{" "}
                    <span className="text-[#06b6d4]">arr[i]</span>{" "}
                    <span className="text-[#a855f7]">==</span>{" "}
                    <span className="text-[#06b6d4]">target</span>:
                  </div>
                  <div className="pl-12 text-[#71717a]">
                    <span className="text-[#a855f7]">return</span>{" "}
                    <span className="text-[#06b6d4]">i</span>
                    <span className="text-[#3f3f5e]">  // found</span>
                  </div>
                  <div className="pl-4 text-[#71717a]">
                    <span className="text-[#a855f7]">return</span>{" "}
                    <span className="text-[#ef4444]">-1</span>
                    <span className="text-[#3f3f5e]">  // not found</span>
                  </div>
                </div>
              </div>

              {/* Binary Search Pseudocode */}
              <div className="p-4">
                <h4 className="text-xs font-semibold text-[#6366f1] uppercase tracking-wider mb-3">
                  Binary Search
                </h4>
                <div className="space-y-0.5 font-mono text-[11px] leading-relaxed">
                  <div className="text-[#71717a]">
                    <span className="text-[#a855f7]">function</span>{" "}
                    <span className="text-[#6366f1]">binarySearch</span>
                    <span className="text-[#a1a1aa]">(arr, target):</span>
                  </div>
                  <div className="pl-4 text-[#71717a]">
                    <span className="text-[#06b6d4]">low</span>{" "}
                    <span className="text-[#a855f7]">=</span>{" "}
                    <span className="text-[#10b981]">0</span>,{" "}
                    <span className="text-[#06b6d4]">high</span>{" "}
                    <span className="text-[#a855f7]">=</span>{" "}
                    <span className="text-[#06b6d4]">arr.length - 1</span>
                  </div>
                  <div className="pl-4 text-[#71717a]">
                    <span className="text-[#a855f7]">while</span>{" "}
                    <span className="text-[#06b6d4]">low</span>{" "}
                    <span className="text-[#a855f7]">&lt;=</span>{" "}
                    <span className="text-[#06b6d4]">high</span>:
                  </div>
                  <div className="pl-8 text-[#71717a]">
                    <span className="text-[#06b6d4]">mid</span>{" "}
                    <span className="text-[#a855f7]">=</span>{" "}
                    <span className="text-[#a1a1aa]">(low + high) / 2</span>
                  </div>
                  <div className="pl-8 text-[#71717a]">
                    <span className="text-[#a855f7]">if</span>{" "}
                    <span className="text-[#06b6d4]">arr[mid]</span>{" "}
                    <span className="text-[#a855f7]">==</span>{" "}
                    <span className="text-[#06b6d4]">target</span>:
                  </div>
                  <div className="pl-12 text-[#71717a]">
                    <span className="text-[#a855f7]">return</span>{" "}
                    <span className="text-[#06b6d4]">mid</span>
                    <span className="text-[#3f3f5e]">  // found</span>
                  </div>
                  <div className="pl-8 text-[#71717a]">
                    <span className="text-[#a855f7]">else if</span>{" "}
                    <span className="text-[#06b6d4]">arr[mid]</span>{" "}
                    <span className="text-[#a855f7]">&lt;</span>{" "}
                    <span className="text-[#06b6d4]">target</span>:
                  </div>
                  <div className="pl-12 text-[#71717a]">
                    <span className="text-[#06b6d4]">low</span>{" "}
                    <span className="text-[#a855f7]">=</span>{" "}
                    <span className="text-[#06b6d4]">mid + 1</span>
                    <span className="text-[#3f3f5e]">  // search right</span>
                  </div>
                  <div className="pl-8 text-[#71717a]">
                    <span className="text-[#a855f7]">else</span>:
                  </div>
                  <div className="pl-12 text-[#71717a]">
                    <span className="text-[#06b6d4]">high</span>{" "}
                    <span className="text-[#a855f7]">=</span>{" "}
                    <span className="text-[#06b6d4]">mid - 1</span>
                    <span className="text-[#3f3f5e]">  // search left</span>
                  </div>
                  <div className="pl-4 text-[#71717a]">
                    <span className="text-[#a855f7]">return</span>{" "}
                    <span className="text-[#ef4444]">-1</span>
                    <span className="text-[#3f3f5e]">  // not found</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Variants & Applications ───────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.55 }}
            className="mt-4 rounded-2xl overflow-hidden"
            style={{ background: "#111118", border: "1px solid #1e1e2e" }}
          >
            <div className="px-5 py-3.5 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-2">
                <Zap size={14} className="text-[#06b6d4]" />
                <span className="text-sm font-semibold text-white">Variants & Applications</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-[#10b981] uppercase tracking-wider">
                  Binary Search Variants
                </h3>
                <ul className="space-y-1.5 text-[11px] text-[#a1a1aa]">
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span><span className="text-white font-medium">Lower Bound:</span> Find first occurrence of target or first element greater than target</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span><span className="text-white font-medium">Upper Bound:</span> Find first element strictly greater than target</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span><span className="text-white font-medium">Exponential Search:</span> Combine with binary search for unbounded arrays</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span><span className="text-white font-medium">Interpolation Search:</span> Estimate position using value distribution for O(log log n) average case</span>
                  </li>
                </ul>
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-[#f59e0b] uppercase tracking-wider">
                  Real-World Uses
                </h3>
                <ul className="space-y-1.5 text-[11px] text-[#a1a1aa]">
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span><span className="text-white font-medium">Database Indexing:</span> B-trees use binary search within nodes for key lookup</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span><span className="text-white font-medium">Git Bisect:</span> Binary search through commits to find the one that introduced a bug</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span><span className="text-white font-medium">Dictionary Lookup:</span> Physical dictionaries use alphabetical binary search</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span><span className="text-white font-medium">IP Routing:</span> Longest prefix matching uses binary search on routing tables</span>
                  </li>
                </ul>
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-[#ef4444] uppercase tracking-wider">
                  Common Pitfalls
                </h3>
                <ul className="space-y-1.5 text-[11px] text-[#a1a1aa]">
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span><span className="text-white font-medium">Integer Overflow:</span> Using (low + high) / 2 can overflow; use low + (high - low) / 2 instead</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span><span className="text-white font-medium">Off-by-One:</span> Incorrect boundary updates (low = mid vs low = mid + 1) cause infinite loops</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span><span className="text-white font-medium">Unsorted Input:</span> Binary search on unsorted arrays gives incorrect results silently</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span><span className="text-white font-medium">Floating Point:</span> For continuous domains, use epsilon-based termination condition</span>
                  </li>
                </ul>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
