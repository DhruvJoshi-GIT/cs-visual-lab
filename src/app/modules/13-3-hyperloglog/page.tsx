"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Hash,
  Binary,
  Database,
  BarChart3,
  Info,
  Lightbulb,
  Fingerprint,
  Plus,
  Layers,
  TrendingDown,
  HardDrive,
  Activity,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RegisterState {
  index: number;
  value: number;
  lastUpdatedAt: number;
  highlighted: boolean;
}

interface ProcessedElement {
  element: string;
  hashBinary: string;
  bucketBits: string;
  bucketIndex: number;
  remainderBits: string;
  leadingZeros: number;
  updatedRegister: boolean;
  timestamp: number;
}

interface SimulationState {
  registers: RegisterState[];
  processedElements: ProcessedElement[];
  uniqueElements: Set<string>;
  allElements: string[];
  currentStep: number;
  estimatedCardinality: number;
  actualCardinality: number;
  errorHistory: { step: number; error: number }[];
}

type ScenarioKey = "small" | "medium" | "duplicate-heavy" | "unique-heavy";

interface Scenario {
  id: ScenarioKey;
  label: string;
  description: string;
  generator: () => string[];
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
  sky: "#0ea5e9",
  register: "#6366f1",
  hashBit: "#06b6d4",
  leadingZero: "#10b981",
  bucket: "#f59e0b",
};

const WORD_POOL = [
  "apple", "banana", "cherry", "date", "elderberry", "fig", "grape", "honeydew",
  "kiwi", "lemon", "mango", "nectarine", "orange", "papaya", "quince", "raspberry",
  "strawberry", "tangerine", "ugli", "vanilla", "watermelon", "xigua", "yam", "zucchini",
  "avocado", "blueberry", "coconut", "dragonfruit", "eggplant", "fennel", "ginger",
  "hazelnut", "jackfruit", "kumquat", "lime", "mulberry", "nutmeg", "olive", "peach",
  "radish", "sage", "thyme", "turnip", "walnut", "arugula", "basil", "celery", "dill",
  "endive", "falafel", "garlic", "horseradish", "iceberg", "jalapeno", "kale", "leek",
  "mint", "nori", "oregano", "parsley", "quinoa", "rosemary", "spinach", "tarragon",
  "ube", "vinegar", "wasabi", "ximenia", "yuzu", "za'atar", "almond", "broccoli",
  "carrot", "daikon", "edamame", "flaxseed", "gooseberry", "hemp", "inca", "jicama",
  "kohlrabi", "lentil", "millet", "naan", "oat", "pea", "rye", "soy", "tofu", "umami",
  "vetch", "wheat", "xanthum", "yeast", "zest",
];

// ─── Hash Function ────────────────────────────────────────────────────────────

function simpleHash(str: string, totalBits: number): string {
  // Deterministic hash function that produces a binary string
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  // Mix bits further
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;

  // Convert to unsigned and then to binary string
  const unsigned = h >>> 0;
  let binary = unsigned.toString(2);
  // Pad to totalBits
  while (binary.length < totalBits) {
    binary = "0" + binary;
  }
  return binary.slice(0, totalBits);
}

function countLeadingZeros(bits: string): number {
  let count = 0;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === "0") {
      count++;
    } else {
      break;
    }
  }
  return count + 1; // +1 convention for HyperLogLog (position of first 1)
}

// ─── Estimation ───────────────────────────────────────────────────────────────

function estimateCardinality(registers: RegisterState[], numRegisters: number): number {
  const m = numRegisters;
  // Alpha constant for bias correction
  let alpha: number;
  if (m === 16) alpha = 0.673;
  else if (m === 32) alpha = 0.697;
  else if (m === 64) alpha = 0.709;
  else alpha = 0.7213 / (1 + 1.079 / m);

  // Harmonic mean of 2^(-register[j])
  let harmonicSum = 0;
  for (let i = 0; i < m; i++) {
    harmonicSum += Math.pow(2, -registers[i].value);
  }

  let estimate = alpha * m * m / harmonicSum;

  // Small range correction (linear counting)
  if (estimate <= 2.5 * m) {
    const zeros = registers.filter((r) => r.value === 0).length;
    if (zeros > 0) {
      estimate = m * Math.log(m / zeros);
    }
  }

  return Math.round(estimate);
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

function generateSmallSet(): string[] {
  const elements: string[] = [];
  const pool = [...WORD_POOL];
  for (let i = 0; i < 100; i++) {
    elements.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return elements;
}

function generateMediumSet(): string[] {
  const elements: string[] = [];
  for (let i = 0; i < 1000; i++) {
    elements.push(`item_${Math.floor(Math.random() * 700)}`);
  }
  return elements;
}

function generateDuplicateHeavy(): string[] {
  const elements: string[] = [];
  const small = WORD_POOL.slice(0, 10);
  for (let i = 0; i < 500; i++) {
    elements.push(small[Math.floor(Math.random() * small.length)]);
  }
  return elements;
}

function generateUniqueHeavy(): string[] {
  const elements: string[] = [];
  for (let i = 0; i < 500; i++) {
    elements.push(`unique_element_${i}`);
  }
  // Shuffle
  for (let i = elements.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [elements[i], elements[j]] = [elements[j], elements[i]];
  }
  return elements;
}

const SCENARIOS: Scenario[] = [
  {
    id: "small",
    label: "Small Set (100)",
    description: "100 random elements from a word pool",
    generator: generateSmallSet,
  },
  {
    id: "medium",
    label: "Medium Set (1000)",
    description: "1000 elements with ~700 unique",
    generator: generateMediumSet,
  },
  {
    id: "duplicate-heavy",
    label: "Duplicate Heavy",
    description: "500 elements from only 10 unique values",
    generator: generateDuplicateHeavy,
  },
  {
    id: "unique-heavy",
    label: "Unique Heavy",
    description: "500 completely unique elements",
    generator: generateUniqueHeavy,
  },
];

// ─── Helper: Create initial state ────────────────────────────────────────────

function createInitialRegisters(numRegisters: number): RegisterState[] {
  return Array.from({ length: numRegisters }, (_, i) => ({
    index: i,
    value: 0,
    lastUpdatedAt: -1,
    highlighted: false,
  }));
}

function createInitialState(numRegisters: number): SimulationState {
  return {
    registers: createInitialRegisters(numRegisters),
    processedElements: [],
    uniqueElements: new Set(),
    allElements: [],
    currentStep: 0,
    estimatedCardinality: 0,
    actualCardinality: 0,
    errorHistory: [],
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HyperLogLogModule() {
  // ── Configuration ──
  const [numRegisters, setNumRegisters] = useState(16);
  const [activeScenario, setActiveScenario] = useState<ScenarioKey>("small");

  // ── Simulation state ──
  const [state, setState] = useState<SimulationState>(() => createInitialState(16));
  const [elementQueue, setElementQueue] = useState<string[]>(() =>
    SCENARIOS[0].generator()
  );
  const [customInput, setCustomInput] = useState("");

  // ── Playback state ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);

  // ── Animation state ──
  const [lastProcessed, setLastProcessed] = useState<ProcessedElement | null>(null);
  const [flashRegister, setFlashRegister] = useState<number | null>(null);

  // ── Refs ──
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const stateRef = useRef(state);
  const elementQueueRef = useRef(elementQueue);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    elementQueueRef.current = elementQueue;
  }, [elementQueue]);

  // ── Derived values ──
  const bucketBits = Math.log2(numRegisters);
  const totalBits = 32;
  const remainderBits = totalBits - bucketBits;

  // ── Process single element ──
  const processElement = useCallback(
    (element: string) => {
      const currentState = stateRef.current;
      const hashBin = simpleHash(element, totalBits);
      const bBits = Math.log2(numRegisters);
      const bucketStr = hashBin.slice(0, bBits);
      const bucketIdx = parseInt(bucketStr, 2);
      const remainder = hashBin.slice(bBits);
      const lz = countLeadingZeros(remainder);

      const newRegisters = currentState.registers.map((r) => ({
        ...r,
        highlighted: false,
      }));

      let updated = false;
      if (lz > newRegisters[bucketIdx].value) {
        newRegisters[bucketIdx] = {
          ...newRegisters[bucketIdx],
          value: lz,
          lastUpdatedAt: currentState.currentStep,
          highlighted: true,
        };
        updated = true;
      } else {
        newRegisters[bucketIdx] = {
          ...newRegisters[bucketIdx],
          highlighted: true,
        };
      }

      const newUnique = new Set(currentState.uniqueElements);
      newUnique.add(element);

      const newEstimate = estimateCardinality(newRegisters, numRegisters);
      const newActual = newUnique.size;
      const newStep = currentState.currentStep + 1;
      const errorPct =
        newActual > 0
          ? Math.abs(((newEstimate - newActual) / newActual) * 100)
          : 0;

      const processed: ProcessedElement = {
        element,
        hashBinary: hashBin,
        bucketBits: bucketStr,
        bucketIndex: bucketIdx,
        remainderBits: remainder,
        leadingZeros: lz,
        updatedRegister: updated,
        timestamp: newStep,
      };

      setLastProcessed(processed);
      setFlashRegister(bucketIdx);
      setTimeout(() => setFlashRegister(null), 400);

      const newState: SimulationState = {
        registers: newRegisters,
        processedElements: [processed, ...currentState.processedElements].slice(
          0,
          50
        ),
        uniqueElements: newUnique,
        allElements: [...currentState.allElements, element],
        currentStep: newStep,
        estimatedCardinality: newEstimate,
        actualCardinality: newActual,
        errorHistory: [
          ...currentState.errorHistory,
          { step: newStep, error: errorPct },
        ],
      };

      setState(newState);
      stateRef.current = newState;
    },
    [numRegisters, totalBits]
  );

  // ── Step forward ──
  const stepForward = useCallback(() => {
    const queue = elementQueueRef.current;
    const currentState = stateRef.current;
    if (currentState.currentStep >= queue.length) {
      setIsPlaying(false);
      return;
    }
    const element = queue[currentState.currentStep];
    processElement(element);
  }, [processElement]);

  // ── Animation loop ──
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

  useEffect(
    () => () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    },
    []
  );

  // ── Handlers ──
  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const handleStep = useCallback(() => {
    if (isPlaying) handlePause();
    stepForward();
  }, [isPlaying, handlePause, stepForward]);

  const handleReset = useCallback(() => {
    handlePause();
    const newState = createInitialState(numRegisters);
    setState(newState);
    stateRef.current = newState;
    setLastProcessed(null);
    setFlashRegister(null);
  }, [handlePause, numRegisters]);

  const handleScenarioChange = useCallback(
    (scenarioId: string) => {
      handlePause();
      const scenario = SCENARIOS.find((s) => s.id === scenarioId);
      if (!scenario) return;
      setActiveScenario(scenarioId as ScenarioKey);
      const elements = scenario.generator();
      setElementQueue(elements);
      elementQueueRef.current = elements;
      const newState = createInitialState(numRegisters);
      setState(newState);
      stateRef.current = newState;
      setLastProcessed(null);
    },
    [handlePause, numRegisters]
  );

  const handleRegisterCountChange = useCallback(
    (count: number) => {
      handlePause();
      setNumRegisters(count);
      const scenario = SCENARIOS.find((s) => s.id === activeScenario);
      const elements = scenario ? scenario.generator() : elementQueue;
      setElementQueue(elements);
      elementQueueRef.current = elements;
      const newState = createInitialState(count);
      setState(newState);
      stateRef.current = newState;
      setLastProcessed(null);
    },
    [handlePause, activeScenario, elementQueue]
  );

  const handleAddCustomElement = useCallback(() => {
    if (!customInput.trim()) return;
    processElement(customInput.trim());
    setCustomInput("");
  }, [customInput, processElement]);

  // ── Computed values ──
  const maxRegValue = Math.max(...state.registers.map((r) => r.value), 1);
  const memoryHLL = numRegisters * 6; // 6 bits per register
  const memoryExact = state.actualCardinality * 20; // ~20 bytes per stored element avg
  const errorPct =
    state.actualCardinality > 0
      ? Math.abs(
          ((state.estimatedCardinality - state.actualCardinality) /
            state.actualCardinality) *
            100
        )
      : 0;
  const progress =
    elementQueue.length > 0
      ? (state.currentStep / elementQueue.length) * 100
      : 0;

  // ── Metrics ──
  const metrics = [
    {
      label: "Elements Processed",
      value: state.currentStep,
      color: COLORS.secondary,
    },
    {
      label: "Estimated Cardinality",
      value: state.estimatedCardinality,
      color: COLORS.register,
    },
    {
      label: "Actual Cardinality",
      value: state.actualCardinality,
      color: COLORS.success,
    },
    {
      label: "Error %",
      value: `${errorPct.toFixed(1)}%`,
      color: errorPct < 10 ? COLORS.success : errorPct < 25 ? COLORS.accent : COLORS.danger,
    },
    {
      label: "HLL Memory",
      value: `${(memoryHLL / 8).toFixed(0)} B`,
      color: COLORS.sky,
    },
    {
      label: "Exact Memory",
      value:
        memoryExact > 1024
          ? `${(memoryExact / 1024).toFixed(1)} KB`
          : `${memoryExact} B`,
      color: COLORS.danger,
    },
  ];

  return (
    <div className="min-h-screen" style={{ background: COLORS.bg }}>
      <Navbar />
      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          {/* ── Header ─────────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="space-y-3"
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className="px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider"
                style={{
                  backgroundColor: `${COLORS.sky}15`,
                  color: COLORS.sky,
                  border: `1px solid ${COLORS.sky}30`,
                }}
              >
                13.3
              </span>
              <span className="text-xs text-[#71717a]">Data Engineering</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              HyperLogLog
            </h1>
            <p className="text-[#a1a1aa] text-base max-w-2xl">
              Estimate the cardinality (count of distinct elements) of massive
              datasets using only a few bytes of memory. Watch how leading zeros
              in hash values enable probabilistic counting.
            </p>
          </motion.div>

          {/* ── Scenario selector + config ─────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
            className="flex flex-wrap items-center gap-4"
          >
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-[#71717a] mr-1">
                <Layers size={14} />
                <span>Presets</span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {SCENARIOS.map((scenario) => (
                  <button
                    key={scenario.id}
                    onClick={() => handleScenarioChange(scenario.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                      activeScenario === scenario.id
                        ? "bg-[#6366f1]/15 text-[#6366f1] border border-[#6366f1]/30"
                        : "bg-[#1e1e2e] text-[#a1a1aa] border border-transparent hover:bg-[#2a2a3e] hover:text-white"
                    }`}
                    title={scenario.description}
                  >
                    {scenario.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Register count */}
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-[#71717a]">Registers:</span>
              {[16, 32, 64].map((count) => (
                <button
                  key={count}
                  onClick={() => handleRegisterCountChange(count)}
                  className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium transition-all duration-200 ${
                    numRegisters === count
                      ? "bg-[#0ea5e9]/15 text-[#0ea5e9] border border-[#0ea5e9]/30"
                      : "bg-[#1e1e2e] text-[#a1a1aa] border border-transparent hover:bg-[#2a2a3e] hover:text-white"
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </motion.div>

          {/* ── Main visualization ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-4"
          >
            {/* ── Left: Hash visualization + input ── */}
            <div className="lg:col-span-1 space-y-4">
              {/* Custom input */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Plus size={14} style={{ color: COLORS.secondary }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Add Element
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddCustomElement()}
                    placeholder="Type a string..."
                    className="flex-1 px-3 py-2 rounded-lg text-sm bg-[#1e1e2e] border border-[#2a2a3e] text-white placeholder-[#71717a] focus:outline-none focus:border-[#6366f1]/50"
                  />
                  <button
                    onClick={handleAddCustomElement}
                    className="px-3 py-2 rounded-lg text-xs font-medium bg-[#6366f1] hover:bg-[#818cf8] text-white transition-all"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Last processed element */}
              <AnimatePresence mode="wait">
                {lastProcessed && (
                  <motion.div
                    key={lastProcessed.timestamp}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.25 }}
                    className="rounded-xl p-4 space-y-3"
                    style={{
                      background: COLORS.card,
                      border: `1px solid ${COLORS.border}`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Hash size={14} style={{ color: COLORS.secondary }} />
                      <span className="text-xs font-semibold text-white uppercase tracking-wider">
                        Hash Breakdown
                      </span>
                    </div>

                    {/* Element name */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#71717a]">Input:</span>
                      <span className="font-mono text-sm text-white font-semibold">
                        &quot;{lastProcessed.element}&quot;
                      </span>
                    </div>

                    {/* Full hash binary */}
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-[#71717a] block mb-1">
                        Hash ({totalBits}-bit binary)
                      </span>
                      <div className="flex flex-wrap gap-px font-mono text-xs">
                        {lastProcessed.hashBinary.split("").map((bit, i) => {
                          const isBucket = i < bucketBits;
                          const isLeadingZero =
                            !isBucket &&
                            i - bucketBits <
                              lastProcessed.leadingZeros - 1;
                          const isFirstOne =
                            !isBucket &&
                            i - bucketBits ===
                              lastProcessed.leadingZeros - 1;
                          return (
                            <span
                              key={i}
                              className="w-5 h-6 flex items-center justify-center rounded-sm"
                              style={{
                                background: isBucket
                                  ? `${COLORS.bucket}20`
                                  : isLeadingZero
                                  ? `${COLORS.leadingZero}15`
                                  : isFirstOne
                                  ? `${COLORS.register}20`
                                  : `${COLORS.border}`,
                                color: isBucket
                                  ? COLORS.bucket
                                  : isLeadingZero
                                  ? COLORS.leadingZero
                                  : isFirstOne
                                  ? COLORS.register
                                  : "#a1a1aa",
                                fontWeight:
                                  isBucket || isFirstOne ? 700 : 400,
                              }}
                            >
                              {bit}
                            </span>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-[10px]">
                        <span className="flex items-center gap-1">
                          <span
                            className="w-2 h-2 rounded-sm"
                            style={{ background: `${COLORS.bucket}40` }}
                          />
                          <span style={{ color: COLORS.bucket }}>
                            Bucket bits
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span
                            className="w-2 h-2 rounded-sm"
                            style={{ background: `${COLORS.leadingZero}30` }}
                          />
                          <span style={{ color: COLORS.leadingZero }}>
                            Leading zeros
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span
                            className="w-2 h-2 rounded-sm"
                            style={{ background: `${COLORS.register}30` }}
                          />
                          <span style={{ color: COLORS.register }}>
                            First 1-bit
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Bucket + Leading zeros summary */}
                    <div className="grid grid-cols-2 gap-3">
                      <div
                        className="rounded-lg p-2.5"
                        style={{
                          background: `${COLORS.bucket}08`,
                          border: `1px solid ${COLORS.bucket}20`,
                        }}
                      >
                        <span className="text-[10px] uppercase tracking-wider block mb-0.5" style={{ color: COLORS.bucket }}>
                          Bucket
                        </span>
                        <span className="font-mono text-sm font-bold" style={{ color: COLORS.bucket }}>
                          {lastProcessed.bucketBits} = #{lastProcessed.bucketIndex}
                        </span>
                      </div>
                      <div
                        className="rounded-lg p-2.5"
                        style={{
                          background: `${COLORS.leadingZero}08`,
                          border: `1px solid ${COLORS.leadingZero}20`,
                        }}
                      >
                        <span className="text-[10px] uppercase tracking-wider block mb-0.5" style={{ color: COLORS.leadingZero }}>
                          Leading Zeros + 1
                        </span>
                        <span className="font-mono text-sm font-bold" style={{ color: COLORS.leadingZero }}>
                          {lastProcessed.leadingZeros}
                        </span>
                      </div>
                    </div>

                    {/* Update status */}
                    <div
                      className="rounded-lg px-3 py-2 text-xs font-medium"
                      style={{
                        background: lastProcessed.updatedRegister
                          ? `${COLORS.success}10`
                          : `${COLORS.muted}10`,
                        border: `1px solid ${
                          lastProcessed.updatedRegister
                            ? `${COLORS.success}25`
                            : `${COLORS.muted}20`
                        }`,
                        color: lastProcessed.updatedRegister
                          ? COLORS.success
                          : COLORS.muted,
                      }}
                    >
                      {lastProcessed.updatedRegister
                        ? `Register[${lastProcessed.bucketIndex}] updated to ${lastProcessed.leadingZeros}`
                        : `Register[${lastProcessed.bucketIndex}] unchanged (current value >= ${lastProcessed.leadingZeros})`}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Recent elements log */}
              <div
                className="rounded-xl overflow-hidden"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: COLORS.border }}>
                  <Activity size={14} style={{ color: COLORS.muted }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Recent Elements
                  </span>
                  <span className="text-[10px] text-[#71717a] ml-auto font-mono">
                    {state.currentStep} / {elementQueue.length}
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {state.processedElements.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-[#71717a]">
                      No elements processed yet. Press Play or Step to begin.
                    </div>
                  ) : (
                    state.processedElements.slice(0, 15).map((pe, i) => (
                      <div
                        key={`${pe.element}-${pe.timestamp}`}
                        className="px-4 py-2 border-b flex items-center justify-between text-xs"
                        style={{
                          borderColor: `${COLORS.border}50`,
                          background: i === 0 ? `${COLORS.register}05` : "transparent",
                        }}
                      >
                        <span className="font-mono text-[#a1a1aa] truncate max-w-[120px]">
                          {pe.element}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono" style={{ color: COLORS.bucket }}>
                            R[{pe.bucketIndex}]
                          </span>
                          {pe.updatedRegister && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                              style={{
                                background: `${COLORS.success}15`,
                                color: COLORS.success,
                              }}
                            >
                              UPD
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* ── Center + Right: Registers + Estimation ── */}
            <div className="lg:col-span-2 space-y-4">
              {/* Register array visualization */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <Database size={14} style={{ color: COLORS.register }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Register Array
                  </span>
                  <span className="text-[10px] text-[#71717a] ml-auto font-mono">
                    {numRegisters} registers x 6 bits = {(numRegisters * 6 / 8).toFixed(0)} bytes
                  </span>
                </div>

                <div
                  className="grid gap-1.5"
                  style={{
                    gridTemplateColumns: `repeat(${
                      numRegisters <= 16 ? numRegisters : numRegisters <= 32 ? 16 : 16
                    }, 1fr)`,
                  }}
                >
                  {state.registers.map((reg) => {
                    const heightPct = maxRegValue > 0 ? (reg.value / maxRegValue) * 100 : 0;
                    const isFlashing = flashRegister === reg.index;
                    return (
                      <motion.div
                        key={reg.index}
                        className="flex flex-col items-center"
                        animate={{
                          scale: isFlashing ? 1.15 : 1,
                        }}
                        transition={{ duration: 0.2 }}
                      >
                        {/* Bar */}
                        <div
                          className="relative w-full rounded-t-sm overflow-hidden"
                          style={{
                            height: numRegisters <= 16 ? 80 : numRegisters <= 32 ? 60 : 44,
                            background: `${COLORS.border}`,
                          }}
                        >
                          <motion.div
                            className="absolute bottom-0 left-0 right-0 rounded-t-sm"
                            animate={{
                              height: `${heightPct}%`,
                              background: isFlashing
                                ? COLORS.success
                                : reg.highlighted
                                ? COLORS.sky
                                : COLORS.register,
                            }}
                            transition={{ duration: 0.3 }}
                          />
                          {/* Value label */}
                          {numRegisters <= 32 && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span
                                className="font-mono font-bold text-white"
                                style={{
                                  fontSize: numRegisters <= 16 ? "12px" : "10px",
                                  textShadow: "0 1px 3px rgba(0,0,0,0.8)",
                                }}
                              >
                                {reg.value}
                              </span>
                            </div>
                          )}
                        </div>
                        {/* Index label */}
                        <div
                          className="w-full text-center py-0.5 rounded-b-sm font-mono"
                          style={{
                            fontSize: numRegisters <= 16 ? "9px" : "7px",
                            color: reg.highlighted ? COLORS.sky : COLORS.muted,
                            background: reg.highlighted
                              ? `${COLORS.sky}10`
                              : `${COLORS.border}80`,
                          }}
                        >
                          {reg.index}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* Estimation comparison */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 size={14} style={{ color: COLORS.accent }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Estimation vs Actual
                  </span>
                </div>

                <div className="space-y-3">
                  {/* Estimated bar */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[#a1a1aa]">
                        HyperLogLog Estimate
                      </span>
                      <span
                        className="font-mono text-sm font-bold"
                        style={{ color: COLORS.register }}
                      >
                        {state.estimatedCardinality}
                      </span>
                    </div>
                    <div
                      className="h-6 rounded-md overflow-hidden"
                      style={{ background: COLORS.border }}
                    >
                      <motion.div
                        className="h-full rounded-md"
                        animate={{
                          width: `${
                            state.estimatedCardinality > 0
                              ? Math.min(
                                  (state.estimatedCardinality /
                                    Math.max(
                                      state.estimatedCardinality,
                                      state.actualCardinality,
                                      1
                                    )) *
                                    100,
                                  100
                                )
                              : 0
                          }%`,
                        }}
                        style={{ background: COLORS.register }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </div>

                  {/* Actual bar */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[#a1a1aa]">
                        Actual Distinct Count
                      </span>
                      <span
                        className="font-mono text-sm font-bold"
                        style={{ color: COLORS.success }}
                      >
                        {state.actualCardinality}
                      </span>
                    </div>
                    <div
                      className="h-6 rounded-md overflow-hidden"
                      style={{ background: COLORS.border }}
                    >
                      <motion.div
                        className="h-full rounded-md"
                        animate={{
                          width: `${
                            state.actualCardinality > 0
                              ? Math.min(
                                  (state.actualCardinality /
                                    Math.max(
                                      state.estimatedCardinality,
                                      state.actualCardinality,
                                      1
                                    )) *
                                    100,
                                  100
                                )
                              : 0
                          }%`,
                        }}
                        style={{ background: COLORS.success }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </div>

                  {/* Error indicator */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#71717a]">Error</span>
                    <span
                      className="font-mono text-sm font-bold"
                      style={{
                        color:
                          errorPct < 10
                            ? COLORS.success
                            : errorPct < 25
                            ? COLORS.accent
                            : COLORS.danger,
                      }}
                    >
                      {errorPct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Error convergence chart */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <TrendingDown size={14} style={{ color: COLORS.success }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Error Over Time
                  </span>
                </div>

                <div className="relative h-32">
                  {/* Y axis labels */}
                  <div className="absolute left-0 top-0 bottom-0 w-8 flex flex-col justify-between text-[9px] font-mono text-[#71717a]">
                    <span>100%</span>
                    <span>50%</span>
                    <span>0%</span>
                  </div>
                  {/* Chart area */}
                  <div className="ml-10 h-full relative overflow-hidden rounded-md" style={{ background: COLORS.border }}>
                    {/* Grid lines */}
                    <div className="absolute inset-0">
                      <div
                        className="absolute left-0 right-0"
                        style={{
                          top: "50%",
                          borderTop: `1px dashed ${COLORS.muted}20`,
                        }}
                      />
                      <div
                        className="absolute left-0 right-0"
                        style={{
                          top: "75%",
                          borderTop: `1px dashed ${COLORS.muted}15`,
                        }}
                      />
                    </div>
                    {/* Error line */}
                    {state.errorHistory.length > 1 && (
                      <svg className="absolute inset-0 w-full h-full">
                        <polyline
                          fill="none"
                          stroke={COLORS.secondary}
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={state.errorHistory
                            .filter((_, i) => {
                              // Sample points if too many
                              const total = state.errorHistory.length;
                              if (total <= 200) return true;
                              return i % Math.ceil(total / 200) === 0 || i === total - 1;
                            })
                            .map((h) => {
                              const x =
                                (h.step / Math.max(elementQueue.length, 1)) *
                                100;
                              const y = Math.max(
                                0,
                                Math.min(100, 100 - h.error)
                              );
                              return `${x}%,${y}%`;
                            })
                            .join(" ")}
                        />
                      </svg>
                    )}
                    {state.errorHistory.length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-[#71717a]">
                        Error will appear here as elements are processed
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Memory comparison */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <HardDrive size={14} style={{ color: COLORS.sky }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Memory Comparison
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div
                    className="rounded-lg p-3 text-center"
                    style={{
                      background: `${COLORS.sky}08`,
                      border: `1px solid ${COLORS.sky}20`,
                    }}
                  >
                    <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.sky }}>
                      HyperLogLog
                    </div>
                    <div className="font-mono text-lg font-bold" style={{ color: COLORS.sky }}>
                      {(memoryHLL / 8).toFixed(0)} B
                    </div>
                    <div className="text-[10px] text-[#71717a] mt-1">
                      {numRegisters} registers x 6 bits
                    </div>
                  </div>
                  <div
                    className="rounded-lg p-3 text-center"
                    style={{
                      background: `${COLORS.danger}08`,
                      border: `1px solid ${COLORS.danger}20`,
                    }}
                  >
                    <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.danger }}>
                      Exact (HashSet)
                    </div>
                    <div className="font-mono text-lg font-bold" style={{ color: COLORS.danger }}>
                      {memoryExact > 1024
                        ? `${(memoryExact / 1024).toFixed(1)} KB`
                        : `${memoryExact} B`}
                    </div>
                    <div className="text-[10px] text-[#71717a] mt-1">
                      ~20 bytes x {state.actualCardinality} elements
                    </div>
                  </div>
                </div>
                {state.actualCardinality > 0 && (
                  <div className="mt-2 text-center text-xs" style={{ color: COLORS.success }}>
                    HyperLogLog uses{" "}
                    <span className="font-bold font-mono">
                      {Math.max(1, Math.round(memoryExact / Math.max(memoryHLL / 8, 1)))}x
                    </span>{" "}
                    less memory
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* ── Progress bar ───────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
            className="relative h-1.5 rounded-full overflow-hidden"
            style={{ background: COLORS.border }}
          >
            <motion.div
              className="h-full rounded-full"
              animate={{ width: `${progress}%` }}
              style={{ background: COLORS.sky }}
              transition={{ duration: 0.2 }}
            />
          </motion.div>

          {/* ── Controls ───────────────────────────────────────────────── */}
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

          {/* ── Metrics panel ──────────────────────────────────────────── */}
          <AnimatePresence>
            {showMetrics && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="flex flex-wrap gap-3"
              >
                {metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e]"
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

          {/* ── Educational info panel ─────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="rounded-2xl overflow-hidden"
            style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
          >
            <div
              className="px-5 py-3.5 border-b flex items-center gap-2"
              style={{ borderColor: COLORS.border }}
            >
              <Info size={14} style={{ color: COLORS.sky }} />
              <span className="text-sm font-semibold text-white">
                Understanding HyperLogLog
              </span>
            </div>

            <div className="p-5 space-y-4">
              {/* How it works */}
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.secondary }}
                >
                  How It Works
                </h3>
                <p className="text-sm leading-relaxed text-[#a1a1aa]">
                  HyperLogLog estimates the number of distinct elements in a stream by
                  exploiting a statistical property of hash functions: in a random binary
                  string, the probability of seeing <span className="font-mono text-[#06b6d4]">k</span> leading
                  zeros is <span className="font-mono text-[#06b6d4]">1/2^k</span>. If the
                  longest run of leading zeros observed is <span className="font-mono text-[#06b6d4]">k</span>,
                  the estimated number of distinct elements is approximately <span className="font-mono text-[#06b6d4]">2^k</span>.
                </p>
              </div>

              {/* Algorithm steps */}
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.accent }}
                >
                  Algorithm Steps
                </h3>
                <div className="space-y-2">
                  {[
                    {
                      step: "1. Hash",
                      desc: `Each input element is hashed to a ${totalBits}-bit binary string.`,
                    },
                    {
                      step: "2. Bucket",
                      desc: `The first ${bucketBits} bits determine which of the ${numRegisters} registers (buckets) to use.`,
                    },
                    {
                      step: "3. Count",
                      desc: `Count the position of the first 1-bit in the remaining ${remainderBits} bits (leading zeros + 1).`,
                    },
                    {
                      step: "4. Update",
                      desc: "Store the maximum value seen for each register. Only update if the new count exceeds the stored value.",
                    },
                    {
                      step: "5. Estimate",
                      desc: "Combine all registers using harmonic mean to produce the cardinality estimate with bias correction.",
                    },
                  ].map((item) => (
                    <div key={item.step} className="flex gap-3 text-xs">
                      <span
                        className="font-mono font-bold shrink-0"
                        style={{ color: COLORS.sky }}
                      >
                        {item.step}
                      </span>
                      <span className="text-[#a1a1aa]">{item.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Formula */}
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.register }}
                >
                  Estimation Formula
                </h3>
                <div
                  className="inline-flex items-center px-4 py-2.5 rounded-lg font-mono text-sm"
                  style={{
                    background: `${COLORS.register}08`,
                    border: `1px solid ${COLORS.register}15`,
                    color: COLORS.register,
                  }}
                >
                  E = alpha_m * m^2 * (SUM 2^(-M[j]))^(-1)
                </div>
                <p className="text-xs text-[#71717a] mt-2">
                  Where <span className="font-mono">alpha_m</span> is a bias correction constant,{" "}
                  <span className="font-mono">m</span> is the number of registers, and{" "}
                  <span className="font-mono">M[j]</span> is the value stored in register j.
                </p>
              </div>

              {/* Key insight */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: `${COLORS.sky}05`,
                  border: `1px solid ${COLORS.sky}10`,
                }}
              >
                <div className="flex items-start gap-2">
                  <Lightbulb
                    size={16}
                    className="mt-0.5 flex-shrink-0"
                    style={{ color: COLORS.sky }}
                  />
                  <div>
                    <span className="text-xs font-semibold text-white block mb-1">
                      Key Insight
                    </span>
                    <span className="text-xs leading-relaxed text-[#a1a1aa]">
                      HyperLogLog can count billions of distinct elements using only ~1.5 KB
                      of memory (with 16,384 registers), achieving a standard error of about
                      0.81%. Redis, BigQuery, Presto, and many databases use HyperLogLog
                      internally for COUNT(DISTINCT) operations. The algorithm was published
                      by Philippe Flajolet et al. in 2007 and has become a cornerstone of
                      big data analytics.
                    </span>
                  </div>
                </div>
              </div>

              {/* Accuracy table */}
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-3"
                  style={{ color: COLORS.muted }}
                >
                  Register Count vs Accuracy
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr
                        className="border-b"
                        style={{ borderColor: COLORS.border }}
                      >
                        <th
                          className="px-3 py-2 text-left font-medium"
                          style={{ color: COLORS.muted }}
                        >
                          Registers (m)
                        </th>
                        <th
                          className="px-3 py-2 text-center font-medium"
                          style={{ color: COLORS.muted }}
                        >
                          Memory
                        </th>
                        <th
                          className="px-3 py-2 text-center font-medium"
                          style={{ color: COLORS.muted }}
                        >
                          Std Error
                        </th>
                        <th
                          className="px-3 py-2 text-center font-medium"
                          style={{ color: COLORS.muted }}
                        >
                          Use Case
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { m: 16, mem: "12 B", err: "26%", use: "Demo / Learning" },
                        { m: 64, mem: "48 B", err: "13%", use: "Low precision" },
                        { m: 256, mem: "192 B", err: "6.5%", use: "Moderate precision" },
                        { m: 1024, mem: "768 B", err: "3.25%", use: "Good precision" },
                        { m: 16384, mem: "12 KB", err: "0.81%", use: "Production (Redis)" },
                      ].map((row, i) => (
                        <tr
                          key={row.m}
                          className="border-b"
                          style={{
                            borderColor: `${COLORS.border}50`,
                            background:
                              row.m === numRegisters
                                ? `${COLORS.sky}06`
                                : "transparent",
                          }}
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              {row.m === numRegisters && (
                                <div
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ background: COLORS.sky }}
                                />
                              )}
                              <span
                                className="font-mono font-semibold"
                                style={{
                                  color:
                                    row.m === numRegisters
                                      ? "#ffffff"
                                      : "#a1a1aa",
                                }}
                              >
                                {row.m.toLocaleString()}
                              </span>
                            </div>
                          </td>
                          <td
                            className="px-3 py-2 text-center font-mono"
                            style={{ color: COLORS.sky }}
                          >
                            {row.mem}
                          </td>
                          <td
                            className="px-3 py-2 text-center font-mono"
                            style={{ color: COLORS.accent }}
                          >
                            {row.err}
                          </td>
                          <td
                            className="px-3 py-2 text-center"
                            style={{ color: "#a1a1aa" }}
                          >
                            {row.use}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Real-world applications */}
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.success }}
                >
                  Real-World Applications
                </h3>
                <p className="text-sm leading-relaxed text-[#a1a1aa]">
                  Redis provides the PFADD and PFCOUNT commands for HyperLogLog.
                  Google BigQuery uses HyperLogLog++ (an improved variant) for
                  APPROX_COUNT_DISTINCT. Apache Spark, Presto, and Druid all
                  implement HyperLogLog for fast approximate distinct counts on
                  massive datasets. Common use cases include counting unique
                  visitors, unique search queries, unique IP addresses, and
                  distinct event types in streaming analytics.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
