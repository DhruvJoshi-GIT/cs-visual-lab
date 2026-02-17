"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Shuffle,
  Target,
  Zap,
  ArrowDown,
  Info,
  ChevronDown,
  Eye,
  Layers,
  GitCompareArrows,
  Hash,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

type CellState =
  | "default"
  | "active"
  | "eliminated"
  | "low"
  | "mid"
  | "high"
  | "found"
  | "not-found";

interface SearchStep {
  low: number;
  mid: number;
  high: number;
  comparison: string;
  action: string;
  phase: "calculate-mid" | "compare" | "eliminate" | "found" | "not-found";
}

interface SearchState {
  array: number[];
  cellStates: CellState[];
  low: number;
  mid: number;
  high: number;
  target: number;
  comparisons: number;
  depth: number;
  elementsRemaining: number;
  log: string[];
  phase: SearchStep["phase"] | "idle" | "complete";
  found: boolean;
  foundIndex: number;
}

interface ScenarioPreset {
  name: string;
  label: string;
  size: number;
  targetMode: "random" | "not-found" | "first" | "last" | "middle";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DOMAIN_COLOR = "#10b981";
const LOW_COLOR = "#06b6d4";
const MID_COLOR = "#6366f1";
const HIGH_COLOR = "#f59e0b";
const FOUND_COLOR = "#10b981";
const ELIMINATED_COLOR = "#2a2a3e";
const ACTIVE_COLOR = "#3a3a5e";
const DEFAULT_COLOR = "#1e1e2e";

const SCENARIO_PRESETS: ScenarioPreset[] = [
  { name: "small", label: "Small Array (16)", size: 16, targetMode: "random" },
  { name: "medium", label: "Medium Array (32)", size: 32, targetMode: "random" },
  { name: "large", label: "Large Array (64)", size: 64, targetMode: "random" },
  { name: "not-found", label: "Not Found", size: 16, targetMode: "not-found" },
];

// ─── Array generation ─────────────────────────────────────────────────────────

function generateSortedArray(size: number): number[] {
  const set = new Set<number>();
  while (set.size < size) {
    set.add(Math.floor(Math.random() * 990) + 10);
  }
  return Array.from(set).sort((a, b) => a - b);
}

function pickTarget(
  arr: number[],
  mode: ScenarioPreset["targetMode"]
): number {
  switch (mode) {
    case "first":
      return arr[0];
    case "last":
      return arr[arr.length - 1];
    case "middle":
      return arr[Math.floor(arr.length / 2)];
    case "not-found": {
      // pick a value not in array
      let val: number;
      do {
        val = Math.floor(Math.random() * 990) + 10;
      } while (arr.includes(val));
      return val;
    }
    case "random":
    default:
      return arr[Math.floor(Math.random() * arr.length)];
  }
}

// ─── Binary search step generator ─────────────────────────────────────────────

function* binarySearchGenerator(
  arr: number[],
  target: number
): Generator<SearchState> {
  const n = arr.length;
  let low = 0;
  let high = n - 1;
  let comparisons = 0;
  let depth = 0;
  const log: string[] = [];

  // Initial state
  const initialStates: CellState[] = new Array(n).fill("active");
  yield {
    array: arr,
    cellStates: initialStates,
    low,
    mid: -1,
    high,
    target,
    comparisons,
    depth,
    elementsRemaining: high - low + 1,
    log: [`Searching for ${target} in array of ${n} elements`],
    phase: "idle",
    found: false,
    foundIndex: -1,
  };

  while (low <= high) {
    depth++;
    const mid = Math.floor((low + high) / 2);

    // Phase 1: Calculate mid
    const calcStates: CellState[] = new Array(n).fill("eliminated");
    for (let i = low; i <= high; i++) calcStates[i] = "active";
    calcStates[low] = "low";
    calcStates[high] = "high";
    calcStates[mid] = "mid";

    const calcLog = [...log, `Step ${depth}: mid = floor((${low} + ${high}) / 2) = ${mid}`];

    yield {
      array: arr,
      cellStates: calcStates,
      low,
      mid,
      high,
      target,
      comparisons,
      depth,
      elementsRemaining: high - low + 1,
      log: calcLog,
      phase: "calculate-mid",
      found: false,
      foundIndex: -1,
    };

    // Phase 2: Compare
    comparisons++;
    const compStates: CellState[] = [...calcStates];
    let compMessage: string;
    if (arr[mid] === target) {
      compMessage = `arr[${mid}] = ${arr[mid]} == target ${target}. Found!`;
    } else if (arr[mid] < target) {
      compMessage = `arr[${mid}] = ${arr[mid]} < target ${target}, search right half`;
    } else {
      compMessage = `arr[${mid}] = ${arr[mid]} > target ${target}, search left half`;
    }
    const compLog = [...calcLog, compMessage];

    yield {
      array: arr,
      cellStates: compStates,
      low,
      mid,
      high,
      target,
      comparisons,
      depth,
      elementsRemaining: high - low + 1,
      log: compLog,
      phase: "compare",
      found: false,
      foundIndex: -1,
    };

    if (arr[mid] === target) {
      // Phase: Found
      const foundStates: CellState[] = new Array(n).fill("eliminated");
      foundStates[mid] = "found";
      const foundLog = [...compLog, `Target ${target} found at index ${mid}!`];

      yield {
        array: arr,
        cellStates: foundStates,
        low,
        mid,
        high,
        target,
        comparisons,
        depth,
        elementsRemaining: 1,
        log: foundLog,
        phase: "found",
        found: true,
        foundIndex: mid,
      };
      return;
    }

    // Phase 3: Eliminate half
    if (arr[mid] < target) {
      const elimStates: CellState[] = new Array(n).fill("eliminated");
      const newLow = mid + 1;
      for (let i = newLow; i <= high; i++) elimStates[i] = "active";
      if (newLow <= high) {
        elimStates[newLow] = "low";
        elimStates[high] = "high";
      }

      log.push(
        `Step ${depth}: mid=${mid}, arr[${mid}]=${arr[mid]} < ${target} -> low=${newLow}`
      );

      yield {
        array: arr,
        cellStates: elimStates,
        low: newLow,
        mid: -1,
        high,
        target,
        comparisons,
        depth,
        elementsRemaining: high - newLow + 1,
        log: [...log],
        phase: "eliminate",
        found: false,
        foundIndex: -1,
      };

      low = newLow;
    } else {
      const elimStates: CellState[] = new Array(n).fill("eliminated");
      const newHigh = mid - 1;
      for (let i = low; i <= newHigh; i++) elimStates[i] = "active";
      if (low <= newHigh) {
        elimStates[low] = "low";
        elimStates[newHigh] = "high";
      }

      log.push(
        `Step ${depth}: mid=${mid}, arr[${mid}]=${arr[mid]} > ${target} -> high=${newHigh}`
      );

      yield {
        array: arr,
        cellStates: elimStates,
        low,
        mid: -1,
        high: newHigh,
        target,
        comparisons,
        depth,
        elementsRemaining: newHigh - low + 1,
        log: [...log],
        phase: "eliminate",
        found: false,
        foundIndex: -1,
      };

      high = newHigh;
    }
  }

  // Not found
  const notFoundStates: CellState[] = new Array(n).fill("eliminated");
  log.push(`Target ${target} not found after ${comparisons} comparisons`);

  yield {
    array: arr,
    cellStates: notFoundStates,
    low,
    mid: -1,
    high,
    target,
    comparisons,
    depth,
    elementsRemaining: 0,
    log: [...log],
    phase: "not-found",
    found: false,
    foundIndex: -1,
  };
}

// ─── Cell component ───────────────────────────────────────────────────────────

function ArrayCell({
  value,
  index,
  state,
  isLow,
  isMid,
  isHigh,
  totalCells,
}: {
  value: number;
  index: number;
  state: CellState;
  isLow: boolean;
  isMid: boolean;
  isHigh: boolean;
  totalCells: number;
}) {
  const compact = totalCells > 32;
  const tiny = totalCells > 48;

  const getBg = (): string => {
    switch (state) {
      case "found":
        return FOUND_COLOR;
      case "mid":
        return MID_COLOR;
      case "low":
        return LOW_COLOR;
      case "high":
        return HIGH_COLOR;
      case "eliminated":
        return ELIMINATED_COLOR;
      case "active":
        return ACTIVE_COLOR;
      default:
        return DEFAULT_COLOR;
    }
  };

  const getBorder = (): string => {
    switch (state) {
      case "found":
        return "#059669";
      case "mid":
        return "#4f46e5";
      case "low":
        return "#0891b2";
      case "high":
        return "#d97706";
      case "eliminated":
        return "#1e1e2e";
      case "active":
        return "#4a4a6e";
      default:
        return "#2a2a3e";
    }
  };

  const getTextColor = (): string => {
    switch (state) {
      case "found":
      case "mid":
      case "low":
      case "high":
        return "#ffffff";
      case "eliminated":
        return "#4a4a5e";
      default:
        return "#a1a1aa";
    }
  };

  const getGlow = (): string => {
    switch (state) {
      case "found":
        return "0 0 20px rgba(16,185,129,0.5), 0 0 40px rgba(16,185,129,0.2)";
      case "mid":
        return "0 0 12px rgba(99,102,241,0.4)";
      case "low":
        return "0 0 10px rgba(6,182,212,0.3)";
      case "high":
        return "0 0 10px rgba(245,158,11,0.3)";
      default:
        return "none";
    }
  };

  return (
    <div className="flex flex-col items-center" style={{ gap: tiny ? "2px" : "4px" }}>
      {/* Index label */}
      {!tiny && (
        <span
          className="font-mono tabular-nums"
          style={{
            fontSize: compact ? "8px" : "10px",
            color: "#4a4a5e",
          }}
        >
          {index}
        </span>
      )}

      {/* Cell box */}
      <motion.div
        layout
        className="flex items-center justify-center rounded-lg font-mono font-semibold tabular-nums"
        style={{
          width: tiny ? "28px" : compact ? "36px" : "48px",
          height: tiny ? "28px" : compact ? "36px" : "48px",
          fontSize: tiny ? "9px" : compact ? "11px" : "13px",
          background: getBg(),
          border: `1.5px solid ${getBorder()}`,
          color: getTextColor(),
          boxShadow: getGlow(),
          transition: "all 200ms ease-out",
        }}
      >
        {value}
      </motion.div>

      {/* Pointer arrows */}
      <div
        className="flex flex-col items-center"
        style={{ minHeight: tiny ? "16px" : "24px" }}
      >
        {isMid && state === "mid" && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center"
          >
            <ArrowDown size={tiny ? 10 : 14} style={{ color: MID_COLOR }} />
            <span
              className="font-mono font-bold"
              style={{
                fontSize: tiny ? "7px" : compact ? "8px" : "10px",
                color: MID_COLOR,
              }}
            >
              mid
            </span>
          </motion.div>
        )}
        {isLow && state !== "mid" && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center"
          >
            <ArrowDown size={tiny ? 10 : 14} style={{ color: LOW_COLOR }} />
            <span
              className="font-mono font-bold"
              style={{
                fontSize: tiny ? "7px" : compact ? "8px" : "10px",
                color: LOW_COLOR,
              }}
            >
              low
            </span>
          </motion.div>
        )}
        {isHigh && state !== "mid" && !isLow && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center"
          >
            <ArrowDown size={tiny ? 10 : 14} style={{ color: HIGH_COLOR }} />
            <span
              className="font-mono font-bold"
              style={{
                fontSize: tiny ? "7px" : compact ? "8px" : "10px",
                color: HIGH_COLOR,
              }}
            >
              high
            </span>
          </motion.div>
        )}
        {state === "found" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center"
          >
            <Target size={tiny ? 10 : 14} style={{ color: FOUND_COLOR }} />
            <span
              className="font-mono font-bold"
              style={{
                fontSize: tiny ? "7px" : compact ? "8px" : "10px",
                color: FOUND_COLOR,
              }}
            >
              found
            </span>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ─── Metric badge ─────────────────────────────────────────────────────────────

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
        <span
          className="text-[9px] uppercase tracking-wider"
          style={{ color: "#71717a" }}
        >
          {label}
        </span>
        <span
          className="text-xs font-mono font-semibold tabular-nums"
          style={{ color }}
        >
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
      </div>
    </div>
  );
}

// ─── Halving visualization ────────────────────────────────────────────────────

function HalvingDiagram({ arraySize, depth }: { arraySize: number; depth: number }) {
  const maxSteps = Math.ceil(Math.log2(arraySize)) + 1;
  const steps: number[] = [];
  let remaining = arraySize;
  for (let i = 0; i < maxSteps; i++) {
    steps.push(remaining);
    remaining = Math.floor(remaining / 2);
    if (remaining < 1) break;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {steps.map((count, i) => {
        const width = Math.max(10, (count / arraySize) * 100);
        const isActive = i < depth;
        const isCurrent = i === depth;
        return (
          <div key={i} className="flex items-center gap-2">
            <span
              className="text-[10px] font-mono w-8 text-right tabular-nums"
              style={{ color: isCurrent ? MID_COLOR : isActive ? FOUND_COLOR : "#4a4a5e" }}
            >
              {count}
            </span>
            <motion.div
              className="h-3 rounded-sm"
              style={{
                width: `${width}%`,
                background: isCurrent
                  ? MID_COLOR
                  : isActive
                  ? `${FOUND_COLOR}60`
                  : "#2a2a3e",
                border: isCurrent
                  ? `1px solid ${MID_COLOR}`
                  : isActive
                  ? `1px solid ${FOUND_COLOR}40`
                  : "1px solid #1e1e2e",
                transition: "all 300ms ease-out",
              }}
              initial={false}
              animate={{
                opacity: isCurrent ? 1 : isActive ? 0.7 : 0.3,
              }}
            />
            <span
              className="text-[9px] font-mono"
              style={{ color: isCurrent ? "#a1a1aa" : "#4a4a5e" }}
            >
              {i === 0 ? "n" : `n/${Math.pow(2, i)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function BinarySearchPage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [arraySize, setArraySize] = useState(16);
  const [showMetrics, setShowMetrics] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [activeScenario, setActiveScenario] = useState("small");
  const [targetInput, setTargetInput] = useState("");

  // ── Search state ────────────────────────────────────────────────────────────
  const [searchState, setSearchState] = useState<SearchState>(() => {
    const arr = generateSortedArray(16);
    const target = pickTarget(arr, "random");
    return {
      array: arr,
      cellStates: new Array(16).fill("default"),
      low: 0,
      mid: -1,
      high: 15,
      target,
      comparisons: 0,
      depth: 0,
      elementsRemaining: 16,
      log: [],
      phase: "idle",
      found: false,
      foundIndex: -1,
    };
  });

  // ── Refs ────────────────────────────────────────────────────────────────────
  const generatorRef = useRef<Generator<SearchState> | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const arrayRef = useRef<number[]>(searchState.array);
  const targetRef = useRef<number>(searchState.target);

  // Keep refs in sync
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // ── Initialize a new search ─────────────────────────────────────────────────
  const initSearch = useCallback(
    (size: number, targetMode: ScenarioPreset["targetMode"]) => {
      // Stop any running animation
      setIsPlaying(false);
      isPlayingRef.current = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }

      const arr = generateSortedArray(size);
      const target = pickTarget(arr, targetMode);
      arrayRef.current = arr;
      targetRef.current = target;
      generatorRef.current = null;
      setIsComplete(false);
      setTargetInput(String(target));

      setSearchState({
        array: arr,
        cellStates: new Array(size).fill("default"),
        low: 0,
        mid: -1,
        high: size - 1,
        target,
        comparisons: 0,
        depth: 0,
        elementsRemaining: size,
        log: [],
        phase: "idle",
        found: false,
        foundIndex: -1,
      });
    },
    []
  );

  // ── Step forward ────────────────────────────────────────────────────────────
  const stepForward = useCallback((): boolean => {
    if (!generatorRef.current) {
      generatorRef.current = binarySearchGenerator(
        arrayRef.current,
        targetRef.current
      );
    }

    const result = generatorRef.current.next();
    if (!result.done) {
      setSearchState(result.value);
      if (result.value.phase === "found" || result.value.phase === "not-found") {
        setIsComplete(true);
        setIsPlaying(false);
        isPlayingRef.current = false;
        return false;
      }
      return true;
    }

    setIsComplete(true);
    setIsPlaying(false);
    isPlayingRef.current = false;
    return false;
  }, []);

  // ── Animation loop ──────────────────────────────────────────────────────────
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

  // ── Play / pause / step / reset ─────────────────────────────────────────────
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
    generatorRef.current = null;
    setIsComplete(false);

    const arr = arrayRef.current;
    const target = targetRef.current;
    setSearchState({
      array: arr,
      cellStates: new Array(arr.length).fill("default"),
      low: 0,
      mid: -1,
      high: arr.length - 1,
      target,
      comparisons: 0,
      depth: 0,
      elementsRemaining: arr.length,
      log: [],
      phase: "idle",
      found: false,
      foundIndex: -1,
    });
  }, [handlePause]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // ── Handle scenario change ──────────────────────────────────────────────────
  const handleScenarioChange = useCallback(
    (scenarioName: string) => {
      setActiveScenario(scenarioName);
      const scenario = SCENARIO_PRESETS.find((s) => s.name === scenarioName);
      if (scenario) {
        setArraySize(scenario.size);
        initSearch(scenario.size, scenario.targetMode);
      }
    },
    [initSearch]
  );

  // ── Handle target change ────────────────────────────────────────────────────
  const handleTargetSubmit = useCallback(() => {
    const val = parseInt(targetInput);
    if (!isNaN(val)) {
      handlePause();
      targetRef.current = val;
      generatorRef.current = null;
      setIsComplete(false);
      setSearchState((prev) => ({
        ...prev,
        cellStates: new Array(prev.array.length).fill("default"),
        low: 0,
        mid: -1,
        high: prev.array.length - 1,
        target: val,
        comparisons: 0,
        depth: 0,
        elementsRemaining: prev.array.length,
        log: [],
        phase: "idle",
        found: false,
        foundIndex: -1,
      }));
    }
  }, [targetInput, handlePause]);

  const handleRandomTarget = useCallback(() => {
    handlePause();
    const arr = arrayRef.current;
    const target = arr[Math.floor(Math.random() * arr.length)];
    targetRef.current = target;
    generatorRef.current = null;
    setIsComplete(false);
    setTargetInput(String(target));
    setSearchState((prev) => ({
      ...prev,
      cellStates: new Array(prev.array.length).fill("default"),
      low: 0,
      mid: -1,
      high: prev.array.length - 1,
      target,
      comparisons: 0,
      depth: 0,
      elementsRemaining: prev.array.length,
      log: [],
      phase: "idle",
      found: false,
      foundIndex: -1,
    }));
  }, [handlePause]);

  // ── Handle array size change ────────────────────────────────────────────────
  const handleArraySizeChange = useCallback(
    (newSize: number) => {
      setArraySize(newSize);
      initSearch(newSize, "random");
    },
    [initSearch]
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: "#0a0a0f" }}>
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
                  background: `${DOMAIN_COLOR}15`,
                  color: DOMAIN_COLOR,
                  border: `1px solid ${DOMAIN_COLOR}30`,
                }}
              >
                4.2
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Binary Search
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Watch binary search divide and conquer a sorted array, eliminating
              half the remaining elements with each comparison. Understand why
              this gives O(log n) time complexity.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium"
                style={{
                  background: "rgba(245,158,11,0.08)",
                  color: "#f59e0b",
                  border: "1px solid rgba(245,158,11,0.15)",
                }}
              >
                <Zap size={11} />
                Prerequisite: Sorted Arrays
              </span>
            </div>
          </motion.div>

          {/* ── Controls row ────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.1,
              ease: [0.23, 1, 0.32, 1],
            }}
            className="flex flex-wrap items-center gap-3 mb-4"
          >
            {/* Target input */}
            <div className="flex items-center gap-2">
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm"
                style={{
                  background: "#111118",
                  border: "1px solid #1e1e2e",
                }}
              >
                <Target size={14} className="text-[#6366f1]" />
                <span className="text-xs text-[#71717a]">Target:</span>
                <input
                  type="number"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleTargetSubmit();
                  }}
                  className="w-16 bg-transparent text-white text-sm font-mono outline-none border-b border-[#2a2a3e] focus:border-[#6366f1] transition-colors text-center"
                />
                <button
                  onClick={handleTargetSubmit}
                  className="px-2 py-1 rounded-lg text-xs font-medium text-[#6366f1] hover:bg-[#6366f1]/10 transition-colors"
                >
                  Set
                </button>
              </div>

              <button
                onClick={handleRandomTarget}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium text-[#a1a1aa] hover:text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: "#111118",
                  border: "1px solid #1e1e2e",
                }}
              >
                <Shuffle size={14} />
                Random
              </button>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Scenario presets */}
            <div className="flex items-center gap-1">
              {SCENARIO_PRESETS.map((s) => (
                <button
                  key={s.name}
                  onClick={() => handleScenarioChange(s.name)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                  style={{
                    background:
                      activeScenario === s.name
                        ? `${DOMAIN_COLOR}18`
                        : "transparent",
                    color: activeScenario === s.name ? DOMAIN_COLOR : "#71717a",
                    border:
                      activeScenario === s.name
                        ? `1px solid ${DOMAIN_COLOR}30`
                        : "1px solid transparent",
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* New array */}
            <button
              onClick={() => initSearch(arraySize, "random")}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-[#a1a1aa] hover:text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: "#111118",
                border: "1px solid #1e1e2e",
              }}
            >
              <Shuffle size={14} />
              New Array
            </button>
          </motion.div>

          {/* ── Array size slider ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.15,
              ease: [0.23, 1, 0.32, 1],
            }}
            className="flex items-center gap-4 mb-4 px-1"
          >
            <span className="text-xs text-[#71717a] font-medium whitespace-nowrap">
              Array Size
            </span>
            <input
              type="range"
              min={8}
              max={64}
              step={1}
              value={arraySize}
              onChange={(e) => handleArraySizeChange(parseInt(e.target.value))}
              className="flex-1 max-w-xs h-1.5 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#10b981] [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-[#10b981]/30"
              style={{ background: "#1e1e2e" }}
            />
            <span
              className="text-xs font-mono font-semibold tabular-nums min-w-[2.5rem] text-center"
              style={{ color: DOMAIN_COLOR }}
            >
              {arraySize}
            </span>
          </motion.div>

          {/* ── Visualization area ────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.6,
              delay: 0.2,
              ease: [0.23, 1, 0.32, 1],
            }}
            className="rounded-2xl overflow-hidden mb-4"
            style={{
              background: "#111118",
              border: "1px solid #1e1e2e",
              boxShadow:
                "0 0 0 1px rgba(16,185,129,0.03), 0 20px 50px -12px rgba(0,0,0,0.5)",
            }}
          >
            {/* Target display */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-3">
                <Search size={14} style={{ color: MID_COLOR }} />
                <span className="text-sm font-medium text-white">
                  Searching for:{" "}
                  <span className="font-mono font-bold" style={{ color: MID_COLOR }}>
                    {searchState.target}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-[#71717a]">
                  Phase:{" "}
                  <span
                    style={{
                      color:
                        searchState.phase === "found"
                          ? FOUND_COLOR
                          : searchState.phase === "not-found"
                          ? "#ef4444"
                          : MID_COLOR,
                    }}
                  >
                    {searchState.phase === "idle"
                      ? "Ready"
                      : searchState.phase === "calculate-mid"
                      ? "Calculate Mid"
                      : searchState.phase === "compare"
                      ? "Compare"
                      : searchState.phase === "eliminate"
                      ? "Eliminate Half"
                      : searchState.phase === "found"
                      ? "Found!"
                      : searchState.phase === "not-found"
                      ? "Not Found"
                      : searchState.phase}
                  </span>
                </span>
              </div>
            </div>

            {/* Array visualization */}
            <div
              className="flex items-start justify-center gap-1 px-4 py-6 overflow-x-auto"
              style={{ minHeight: arraySize > 32 ? "160px" : "200px" }}
            >
              {searchState.array.map((value, index) => (
                <ArrayCell
                  key={`${index}-${value}`}
                  value={value}
                  index={index}
                  state={searchState.cellStates[index] || "default"}
                  isLow={index === searchState.low}
                  isMid={index === searchState.mid}
                  isHigh={index === searchState.high}
                  totalCells={searchState.array.length}
                />
              ))}
            </div>

            {/* Status messages */}
            <AnimatePresence>
              {searchState.phase === "found" && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center justify-center gap-2 px-4 py-3 mx-4 mb-4 rounded-xl"
                  style={{
                    background: `${FOUND_COLOR}15`,
                    border: `1px solid ${FOUND_COLOR}30`,
                  }}
                >
                  <Target size={16} style={{ color: FOUND_COLOR }} />
                  <span
                    className="text-sm font-semibold"
                    style={{ color: FOUND_COLOR }}
                  >
                    Target {searchState.target} found at index{" "}
                    {searchState.foundIndex} in {searchState.comparisons}{" "}
                    comparison{searchState.comparisons !== 1 ? "s" : ""}!
                  </span>
                </motion.div>
              )}
              {searchState.phase === "not-found" && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center justify-center gap-2 px-4 py-3 mx-4 mb-4 rounded-xl"
                  style={{
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.2)",
                  }}
                >
                  <Search size={16} style={{ color: "#ef4444" }} />
                  <span className="text-sm font-semibold" style={{ color: "#ef4444" }}>
                    Target {searchState.target} not found after{" "}
                    {searchState.comparisons} comparison
                    {searchState.comparisons !== 1 ? "s" : ""}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Pointer legend */}
            <div
              className="flex items-center justify-center gap-6 px-4 py-2.5 border-t"
              style={{ borderColor: "#1e1e2e" }}
            >
              {[
                { color: LOW_COLOR, label: "Low Pointer" },
                { color: MID_COLOR, label: "Mid Pointer" },
                { color: HIGH_COLOR, label: "High Pointer" },
                { color: ACTIVE_COLOR, label: "Search Space" },
                { color: ELIMINATED_COLOR, label: "Eliminated" },
                { color: FOUND_COLOR, label: "Found" },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{
                      background: color,
                      border: `1px solid ${color}`,
                    }}
                  />
                  <span className="text-[11px] text-[#71717a]">{label}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* ── Controls panel ────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.3,
              ease: [0.23, 1, 0.32, 1],
            }}
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
                      background: searchState.found
                        ? `${FOUND_COLOR}15`
                        : "rgba(239,68,68,0.1)",
                      border: searchState.found
                        ? `1px solid ${FOUND_COLOR}30`
                        : "1px solid rgba(239,68,68,0.2)",
                    }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background: searchState.found ? FOUND_COLOR : "#ef4444",
                      }}
                    />
                    <span
                      className="text-xs font-medium"
                      style={{
                        color: searchState.found ? FOUND_COLOR : "#ef4444",
                      }}
                    >
                      {searchState.found ? "Found" : "Not Found"}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </ModuleControls>
          </motion.div>

          {/* ── Metrics + Log + Educational panel ──────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.35,
              ease: [0.23, 1, 0.32, 1],
            }}
            className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4"
          >
            {/* Metrics panel */}
            <AnimatePresence>
              {showMetrics && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="rounded-2xl overflow-hidden"
                  style={{
                    background: "#111118",
                    border: "1px solid #1e1e2e",
                  }}
                >
                  <div className="px-5 py-3.5 border-b border-[#1e1e2e]">
                    <div className="flex items-center gap-2">
                      <Eye size={14} style={{ color: DOMAIN_COLOR }} />
                      <span className="text-sm font-semibold text-white">
                        Metrics
                      </span>
                    </div>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-3">
                    <MetricBadge
                      icon={<Eye size={12} />}
                      label="Comparisons"
                      value={searchState.comparisons}
                      color="#f59e0b"
                    />
                    <MetricBadge
                      icon={<Layers size={12} />}
                      label="Remaining"
                      value={searchState.elementsRemaining}
                      color="#06b6d4"
                    />
                    <MetricBadge
                      icon={<GitCompareArrows size={12} />}
                      label="Search Depth"
                      value={searchState.depth}
                      color="#6366f1"
                    />
                    <MetricBadge
                      icon={<Hash size={12} />}
                      label="Range"
                      value={
                        searchState.low <= searchState.high
                          ? `[${searchState.low}..${searchState.high}]`
                          : "empty"
                      }
                      color={DOMAIN_COLOR}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Comparison log */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: "#111118",
                border: "1px solid #1e1e2e",
              }}
            >
              <div className="px-5 py-3.5 border-b border-[#1e1e2e]">
                <div className="flex items-center gap-2">
                  <Search size={14} style={{ color: MID_COLOR }} />
                  <span className="text-sm font-semibold text-white">
                    Comparison Log
                  </span>
                </div>
              </div>
              <div
                className="p-4 overflow-y-auto space-y-1.5"
                style={{ maxHeight: "220px" }}
              >
                {searchState.log.length === 0 ? (
                  <span className="text-xs text-[#4a4a5e] italic">
                    Press Play or Step to begin the search...
                  </span>
                ) : (
                  searchState.log.map((entry, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="text-xs font-mono leading-relaxed px-2.5 py-1.5 rounded-lg"
                      style={{
                        background:
                          i === searchState.log.length - 1
                            ? "rgba(99,102,241,0.08)"
                            : "transparent",
                        color:
                          i === searchState.log.length - 1
                            ? "#a1a1aa"
                            : "#5a5a6e",
                        borderLeft:
                          i === searchState.log.length - 1
                            ? `2px solid ${MID_COLOR}`
                            : "2px solid transparent",
                      }}
                    >
                      {entry}
                    </motion.div>
                  ))
                )}
              </div>
            </div>

            {/* Educational panel */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: "#111118",
                border: "1px solid #1e1e2e",
              }}
            >
              <div className="px-5 py-3.5 border-b border-[#1e1e2e]">
                <div className="flex items-center gap-2">
                  <Info size={14} style={{ color: DOMAIN_COLOR }} />
                  <span className="text-sm font-semibold text-white">
                    O(log n) Explained
                  </span>
                </div>
              </div>
              <div className="p-4 space-y-4">
                {/* Halving diagram */}
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                    Elements remaining after each step
                  </span>
                  <div className="mt-2">
                    <HalvingDiagram
                      arraySize={searchState.array.length}
                      depth={searchState.depth}
                    />
                  </div>
                </div>

                {/* Key insight */}
                <div
                  className="p-3 rounded-xl"
                  style={{
                    background: `${DOMAIN_COLOR}08`,
                    border: `1px solid ${DOMAIN_COLOR}20`,
                  }}
                >
                  <div className="flex items-start gap-2">
                    <Zap
                      size={12}
                      style={{ color: DOMAIN_COLOR, marginTop: "2px" }}
                    />
                    <div>
                      <span
                        className="text-xs font-semibold"
                        style={{ color: DOMAIN_COLOR }}
                      >
                        Key Insight
                      </span>
                      <p className="text-[11px] text-[#a1a1aa] mt-1 leading-relaxed">
                        Binary search eliminates half the remaining elements
                        with each comparison. For n = {searchState.array.length},
                        at most{" "}
                        <span className="font-mono font-bold" style={{ color: MID_COLOR }}>
                          {Math.ceil(Math.log2(searchState.array.length + 1))}
                        </span>{" "}
                        comparisons are needed (log
                        <sub>2</sub>
                        {searchState.array.length} ={" "}
                        {Math.log2(searchState.array.length).toFixed(1)}).
                      </p>
                    </div>
                  </div>
                </div>

                {/* Complexity table */}
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                    Complexity
                  </span>
                  <div className="mt-2 space-y-1">
                    {[
                      { label: "Best", value: "O(1)", color: FOUND_COLOR, note: "Target is at mid" },
                      { label: "Average", value: "O(log n)", color: "#f59e0b", note: "Halving each step" },
                      { label: "Worst", value: "O(log n)", color: "#ef4444", note: "Search to a leaf" },
                      { label: "Space", value: "O(1)", color: "#06b6d4", note: "Iterative approach" },
                    ].map(({ label, value, color, note }) => (
                      <div
                        key={label}
                        className="flex items-center justify-between px-2.5 py-1.5 rounded-lg"
                        style={{ background: "#0d0d14" }}
                      >
                        <span className="text-[11px] text-[#71717a]">
                          {label}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-[#4a4a5e]">
                            {note}
                          </span>
                          <span
                            className="text-xs font-mono font-semibold"
                            style={{ color }}
                          >
                            {value}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
