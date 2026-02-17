"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Filter,
  Plus,
  Search,
  Hash,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Layers,
  Sparkles,
  BarChart3,
  ArrowRight,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

/* ═══════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════ */

interface BloomState {
  bitArray: boolean[];
  elements: string[];
  hashFunctions: number;
  bitSize: number;
  queries: QueryResult[];
  insertAnimations: InsertAnimation[];
  queryAnimation: QueryAnimation | null;
  falsePositives: number;
  trueNegatives: number;
  truePositives: number;
}

interface QueryResult {
  id: number;
  element: string;
  result: "probably-yes" | "definitely-no";
  actuallyInSet: boolean;
  isFalsePositive: boolean;
  hashPositions: number[];
}

interface InsertAnimation {
  id: number;
  element: string;
  hashPositions: number[];
  currentHashIndex: number;
  complete: boolean;
}

interface QueryAnimation {
  id: number;
  element: string;
  hashPositions: number[];
  currentHashIndex: number;
  result: "probably-yes" | "definitely-no" | "pending";
  complete: boolean;
}

interface AutoPlayStep {
  type: "insert" | "query";
  element: string;
}

interface Scenario {
  id: string;
  label: string;
  description: string;
  bitSize: number;
  hashFunctions: number;
  steps: AutoPlayStep[];
}

const HASH_COLORS = [
  "#6366f1",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ec4899",
];

const SCENARIOS: Scenario[] = [
  {
    id: "basic",
    label: "Basic Insert & Query",
    description: "Insert a few elements and query for them",
    bitSize: 32,
    hashFunctions: 3,
    steps: [
      { type: "insert", element: "apple" },
      { type: "insert", element: "banana" },
      { type: "insert", element: "cherry" },
      { type: "query", element: "apple" },
      { type: "query", element: "banana" },
      { type: "query", element: "grape" },
      { type: "query", element: "melon" },
    ],
  },
  {
    id: "false-positive",
    label: "False Positive Demo",
    description: "Demonstrate how false positives occur",
    bitSize: 16,
    hashFunctions: 2,
    steps: [
      { type: "insert", element: "cat" },
      { type: "insert", element: "dog" },
      { type: "insert", element: "bird" },
      { type: "insert", element: "fish" },
      { type: "insert", element: "frog" },
      { type: "query", element: "cat" },
      { type: "query", element: "wolf" },
      { type: "query", element: "bear" },
      { type: "query", element: "deer" },
      { type: "query", element: "lynx" },
      { type: "query", element: "hawk" },
      { type: "query", element: "toad" },
      { type: "query", element: "newt" },
    ],
  },
  {
    id: "saturation",
    label: "Saturation",
    description: "Watch the bit array fill up",
    bitSize: 32,
    hashFunctions: 3,
    steps: [
      { type: "insert", element: "alpha" },
      { type: "insert", element: "bravo" },
      { type: "insert", element: "charlie" },
      { type: "insert", element: "delta" },
      { type: "insert", element: "echo" },
      { type: "insert", element: "foxtrot" },
      { type: "insert", element: "golf" },
      { type: "insert", element: "hotel" },
      { type: "insert", element: "india" },
      { type: "insert", element: "juliet" },
      { type: "query", element: "kilo" },
      { type: "query", element: "lima" },
      { type: "query", element: "mike" },
    ],
  },
  {
    id: "optimal",
    label: "Optimal Parameters",
    description: "Larger array with more hash functions",
    bitSize: 64,
    hashFunctions: 4,
    steps: [
      { type: "insert", element: "react" },
      { type: "insert", element: "vue" },
      { type: "insert", element: "angular" },
      { type: "insert", element: "svelte" },
      { type: "insert", element: "next" },
      { type: "query", element: "react" },
      { type: "query", element: "ember" },
      { type: "query", element: "nuxt" },
      { type: "query", element: "remix" },
      { type: "query", element: "vue" },
      { type: "query", element: "solid" },
    ],
  },
];

/* ═══════════════════════════════════════════════════════════
   HASH FUNCTIONS
   ═══════════════════════════════════════════════════════════ */

function hashString(str: string, seed: number, size: number): number {
  let hash = seed;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
    hash = ((hash << 5) - hash + str.charCodeAt(i)) & 0xffffffff;
  }
  // Additional mixing
  hash = (hash ^ (hash >>> 16)) & 0xffffffff;
  hash = (hash * 0x45d9f3b) & 0xffffffff;
  hash = (hash ^ (hash >>> 16)) & 0xffffffff;
  return Math.abs(hash) % size;
}

function getHashPositions(
  element: string,
  numHashes: number,
  bitSize: number
): number[] {
  const positions: number[] = [];
  for (let i = 0; i < numHashes; i++) {
    const seed = (i + 1) * 0x9e3779b9 + i * 7919;
    positions.push(hashString(element, seed, bitSize));
  }
  return positions;
}

/* ═══════════════════════════════════════════════════════════
   INITIAL STATE FACTORY
   ═══════════════════════════════════════════════════════════ */

function createInitialState(
  bitSize: number = 32,
  hashFunctions: number = 3
): BloomState {
  return {
    bitArray: new Array(bitSize).fill(false),
    elements: [],
    hashFunctions,
    bitSize,
    queries: [],
    insertAnimations: [],
    queryAnimation: null,
    falsePositives: 0,
    trueNegatives: 0,
    truePositives: 0,
  };
}

let globalAnimId = 0;

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function BloomFilterPage() {
  /* ─── Core simulation state ─── */
  const [state, setState] = useState<BloomState>(() => createInitialState());
  const [activeScenario, setActiveScenario] = useState(SCENARIOS[0].id);
  const [autoPlaySteps, setAutoPlaySteps] = useState<AutoPlayStep[]>([]);
  const [autoPlayIndex, setAutoPlayIndex] = useState(0);
  const [autoPlayPhase, setAutoPlayPhase] = useState<
    "idle" | "animating-insert" | "animating-query" | "waiting"
  >("idle");

  /* ─── UI state ─── */
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [inputValue, setInputValue] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [bitSize, setBitSize] = useState(32);
  const [hashCount, setHashCount] = useState(3);

  /* ─── Refs for animation loop ─── */
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const stateRef = useRef(state);
  const autoPlayStepsRef = useRef(autoPlaySteps);
  const autoPlayIndexRef = useRef(autoPlayIndex);
  const autoPlayPhaseRef = useRef(autoPlayPhase);

  stateRef.current = state;
  autoPlayStepsRef.current = autoPlaySteps;
  autoPlayIndexRef.current = autoPlayIndex;
  autoPlayPhaseRef.current = autoPlayPhase;

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  /* ─── Insert element ─── */
  const insertElement = useCallback((element: string) => {
    setState((prev) => {
      if (prev.elements.includes(element)) return prev;
      const positions = getHashPositions(
        element,
        prev.hashFunctions,
        prev.bitSize
      );
      const newBitArray = [...prev.bitArray];
      positions.forEach((pos) => {
        newBitArray[pos] = true;
      });
      const animId = ++globalAnimId;
      return {
        ...prev,
        bitArray: newBitArray,
        elements: [...prev.elements, element],
        insertAnimations: [
          ...prev.insertAnimations,
          {
            id: animId,
            element,
            hashPositions: positions,
            currentHashIndex: 0,
            complete: false,
          },
        ],
      };
    });
  }, []);

  /* ─── Advance insert animation ─── */
  const advanceInsertAnimation = useCallback(() => {
    setState((prev) => {
      const lastAnim = prev.insertAnimations[prev.insertAnimations.length - 1];
      if (!lastAnim || lastAnim.complete) return prev;

      const nextIndex = lastAnim.currentHashIndex + 1;
      const complete = nextIndex >= lastAnim.hashPositions.length;
      const updatedAnims = [...prev.insertAnimations];
      updatedAnims[updatedAnims.length - 1] = {
        ...lastAnim,
        currentHashIndex: complete
          ? lastAnim.hashPositions.length - 1
          : nextIndex,
        complete,
      };
      return { ...prev, insertAnimations: updatedAnims };
    });
  }, []);

  /* ─── Query element ─── */
  const queryElement = useCallback((element: string) => {
    setState((prev) => {
      const positions = getHashPositions(
        element,
        prev.hashFunctions,
        prev.bitSize
      );
      const animId = ++globalAnimId;
      return {
        ...prev,
        queryAnimation: {
          id: animId,
          element,
          hashPositions: positions,
          currentHashIndex: 0,
          result: "pending",
          complete: false,
        },
      };
    });
  }, []);

  /* ─── Advance query animation ─── */
  const advanceQueryAnimation = useCallback(() => {
    setState((prev) => {
      const qa = prev.queryAnimation;
      if (!qa || qa.complete) return prev;

      const nextIndex = qa.currentHashIndex + 1;
      const currentPos = qa.hashPositions[qa.currentHashIndex];
      const bitIsSet = prev.bitArray[currentPos];

      // If any bit is 0, it's definitely not in the set
      if (!bitIsSet) {
        const actuallyInSet = prev.elements.includes(qa.element);
        const queryResult: QueryResult = {
          id: qa.id,
          element: qa.element,
          result: "definitely-no",
          actuallyInSet,
          isFalsePositive: false,
          hashPositions: qa.hashPositions,
        };
        return {
          ...prev,
          queryAnimation: {
            ...qa,
            result: "definitely-no",
            complete: true,
          },
          queries: [...prev.queries, queryResult],
          trueNegatives: prev.trueNegatives + (actuallyInSet ? 0 : 1),
        };
      }

      // If we've checked all positions and all are set
      if (nextIndex >= qa.hashPositions.length) {
        const actuallyInSet = prev.elements.includes(qa.element);
        const isFalsePositive = !actuallyInSet;
        const queryResult: QueryResult = {
          id: qa.id,
          element: qa.element,
          result: "probably-yes",
          actuallyInSet,
          isFalsePositive,
          hashPositions: qa.hashPositions,
        };
        return {
          ...prev,
          queryAnimation: {
            ...qa,
            currentHashIndex: qa.hashPositions.length - 1,
            result: "probably-yes",
            complete: true,
          },
          queries: [...prev.queries, queryResult],
          falsePositives: prev.falsePositives + (isFalsePositive ? 1 : 0),
          truePositives: prev.truePositives + (actuallyInSet ? 1 : 0),
        };
      }

      // Continue checking
      return {
        ...prev,
        queryAnimation: {
          ...qa,
          currentHashIndex: nextIndex,
        },
      };
    });
  }, []);

  /* ─── Step forward (auto-play) ─── */
  const stepForward = useCallback(() => {
    const phase = autoPlayPhaseRef.current;
    const steps = autoPlayStepsRef.current;
    const idx = autoPlayIndexRef.current;
    const st = stateRef.current;

    if (phase === "idle" || phase === "waiting") {
      // Start next step
      if (idx >= steps.length) {
        setIsPlaying(false);
        setAutoPlayPhase("idle");
        return;
      }

      const step = steps[idx];
      if (step.type === "insert") {
        insertElement(step.element);
        setAutoPlayPhase("animating-insert");
      } else {
        queryElement(step.element);
        setAutoPlayPhase("animating-query");
      }
    } else if (phase === "animating-insert") {
      const lastAnim =
        st.insertAnimations[st.insertAnimations.length - 1];
      if (lastAnim && !lastAnim.complete) {
        advanceInsertAnimation();
      } else {
        setAutoPlayPhase("waiting");
        setAutoPlayIndex((prev) => prev + 1);
      }
    } else if (phase === "animating-query") {
      const qa = st.queryAnimation;
      if (qa && !qa.complete) {
        advanceQueryAnimation();
      } else {
        setAutoPlayPhase("waiting");
        setAutoPlayIndex((prev) => prev + 1);
      }
    }
  }, [insertElement, queryElement, advanceInsertAnimation, advanceQueryAnimation]);

  /* ─── Animation loop ─── */
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(10, 400 / speedRef.current);
      if (timestamp - lastTickRef.current >= interval) {
        lastTickRef.current = timestamp;
        stepForward();
      }
      animationRef.current = requestAnimationFrame(animationLoop);
    },
    [stepForward]
  );

  useEffect(() => {
    if (isPlaying) {
      lastTickRef.current = 0;
      animationRef.current = requestAnimationFrame(animationLoop);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, animationLoop]);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  /* ─── Controls ─── */
  const handlePlay = useCallback(() => {
    if (autoPlayStepsRef.current.length === 0) {
      // Use current scenario
      const scenario = SCENARIOS.find(
        (s) => s.id === activeScenario
      );
      if (scenario) {
        setAutoPlaySteps(scenario.steps);
        setAutoPlayIndex(0);
        setAutoPlayPhase("idle");
      }
    }
    setIsPlaying(true);
  }, [activeScenario]);

  const handlePause = useCallback(() => setIsPlaying(false), []);

  const handleStep = useCallback(() => {
    if (autoPlayStepsRef.current.length === 0) {
      const scenario = SCENARIOS.find(
        (s) => s.id === activeScenario
      );
      if (scenario) {
        setAutoPlaySteps(scenario.steps);
        setAutoPlayIndex(0);
        setAutoPlayPhase("idle");
      }
    }
    stepForward();
  }, [activeScenario, stepForward]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    globalAnimId = 0;
    setState(createInitialState(bitSize, hashCount));
    setAutoPlaySteps([]);
    setAutoPlayIndex(0);
    setAutoPlayPhase("idle");
  }, [bitSize, hashCount]);

  const handleScenarioSelect = useCallback(
    (scenarioId: string) => {
      setIsPlaying(false);
      globalAnimId = 0;
      setActiveScenario(scenarioId);
      const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
      setBitSize(scenario.bitSize);
      setHashCount(scenario.hashFunctions);
      setState(createInitialState(scenario.bitSize, scenario.hashFunctions));
      setAutoPlaySteps(scenario.steps);
      setAutoPlayIndex(0);
      setAutoPlayPhase("idle");
    },
    []
  );

  const handleManualInsert = useCallback(() => {
    if (!inputValue.trim()) return;
    insertElement(inputValue.trim());
    setInputValue("");
    // Start animation
    setAutoPlayPhase("animating-insert");
  }, [inputValue, insertElement]);

  const handleManualQuery = useCallback(() => {
    if (!queryInput.trim()) return;
    queryElement(queryInput.trim());
    setQueryInput("");
    setAutoPlayPhase("animating-query");
  }, [queryInput, queryElement]);

  const handleBitSizeChange = useCallback((newSize: number) => {
    setBitSize(newSize);
    setIsPlaying(false);
    globalAnimId = 0;
    setState((prev) => createInitialState(newSize, prev.hashFunctions));
    setAutoPlaySteps([]);
    setAutoPlayIndex(0);
    setAutoPlayPhase("idle");
  }, []);

  const handleHashCountChange = useCallback((newCount: number) => {
    setHashCount(newCount);
    setIsPlaying(false);
    globalAnimId = 0;
    setState((prev) => createInitialState(prev.bitSize, newCount));
    setAutoPlaySteps([]);
    setAutoPlayIndex(0);
    setAutoPlayPhase("idle");
  }, []);

  /* ─── Metrics ─── */
  const metrics = useMemo(() => {
    const bitsSet = state.bitArray.filter(Boolean).length;
    const fillRatio = state.bitSize > 0 ? bitsSet / state.bitSize : 0;
    const totalQueries =
      state.falsePositives + state.trueNegatives + state.truePositives;
    // Theoretical false positive rate: (1 - e^(-kn/m))^k
    const n = state.elements.length;
    const m = state.bitSize;
    const k = state.hashFunctions;
    const theoreticalFPR =
      n > 0 ? Math.pow(1 - Math.exp((-k * n) / m), k) : 0;
    const observedFPR =
      totalQueries - state.truePositives > 0
        ? state.falsePositives /
          (totalQueries - state.truePositives)
        : 0;

    return {
      elementsInserted: state.elements.length,
      bitsSet,
      fillRatio,
      theoreticalFPR,
      observedFPR,
      totalQueries,
      falsePositives: state.falsePositives,
      truePositives: state.truePositives,
      trueNegatives: state.trueNegatives,
    };
  }, [state]);

  /* ─── Currently highlighted bit positions ─── */
  const highlightedBits = useMemo(() => {
    const map = new Map<number, { color: string; type: "insert" | "query" }>();

    // Insert animation
    const lastInsert =
      state.insertAnimations[state.insertAnimations.length - 1];
    if (lastInsert && !lastInsert.complete) {
      lastInsert.hashPositions.forEach((pos, i) => {
        if (i <= lastInsert.currentHashIndex) {
          map.set(pos, {
            color: HASH_COLORS[i % HASH_COLORS.length],
            type: "insert",
          });
        }
      });
    }

    // Query animation
    if (state.queryAnimation && !state.queryAnimation.complete) {
      state.queryAnimation.hashPositions.forEach((pos, i) => {
        if (i <= state.queryAnimation!.currentHashIndex) {
          const bitSet = state.bitArray[pos];
          map.set(pos, {
            color: bitSet ? "#10b981" : "#ef4444",
            type: "query",
          });
        }
      });
    }

    return map;
  }, [state]);

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />

      <div className="pt-14">
        {/* ── Header ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs font-mono font-medium px-2 py-1 rounded bg-[#0ea5e9]/15 text-[#0ea5e9] border border-[#0ea5e9]/20">
                13.1
              </span>
              <div className="flex items-center gap-1.5 text-xs text-[#71717a]">
                <Filter size={12} />
                <span>Data Engineering</span>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Bloom Filters
            </h1>
            <p className="mt-1.5 text-[#a1a1aa] text-sm sm:text-base max-w-2xl">
              A space-efficient probabilistic data structure that tells you
              either &quot;definitely not in set&quot; or &quot;probably in set&quot; using
              multiple hash functions and a bit array
            </p>
          </motion.div>
        </div>

        {/* ── Scenario selector ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-[#71717a] mr-1">
              <Sparkles size={14} />
              <span>Presets</span>
            </div>
            {SCENARIOS.map((scenario) => (
              <button
                key={scenario.id}
                onClick={() => handleScenarioSelect(scenario.id)}
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

        {/* ── Controls bar ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4">
          <ModuleControls
            isPlaying={isPlaying}
            onPlay={handlePlay}
            onPause={handlePause}
            onStep={handleStep}
            onReset={handleReset}
            speed={speed}
            onSpeedChange={setSpeed}
            showMetrics={showMetrics}
            onToggleMetrics={() => setShowMetrics((v) => !v)}
          />
        </div>

        {/* ── Metrics ── */}
        <AnimatePresence>
          {showMetrics && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4"
            >
              <div className="flex flex-wrap gap-3">
                <MetricCard
                  label="Elements"
                  value={String(metrics.elementsInserted)}
                  color="#6366f1"
                />
                <MetricCard
                  label="Bits Set"
                  value={`${metrics.bitsSet}/${state.bitSize}`}
                  color="#06b6d4"
                />
                <MetricCard
                  label="Fill Ratio"
                  value={`${(metrics.fillRatio * 100).toFixed(1)}%`}
                  color={
                    metrics.fillRatio > 0.5
                      ? "#f59e0b"
                      : "#10b981"
                  }
                />
                <MetricCard
                  label="Hash Functions"
                  value={String(state.hashFunctions)}
                  color="#a855f7"
                />
                <MetricCard
                  label="Theoretical FPR"
                  value={`${(metrics.theoreticalFPR * 100).toFixed(1)}%`}
                  color="#ef4444"
                />
                <MetricCard
                  label="Observed FPR"
                  value={
                    metrics.totalQueries > metrics.truePositives
                      ? `${(metrics.observedFPR * 100).toFixed(1)}%`
                      : "N/A"
                  }
                  color="#ef4444"
                />
                <MetricCard
                  label="False Positives"
                  value={String(metrics.falsePositives)}
                  color="#ef4444"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Main Layout ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <div className="space-y-4">
            {/* ── Bit Array Visualization ── */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
                <div className="flex items-center gap-2">
                  <Layers size={14} className="text-[#6366f1]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Bit Array
                  </span>
                  <span className="text-[10px] font-mono text-[#71717a]">
                    ({state.bitSize} bits)
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  {/* Bit size slider */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[#71717a]">Size:</span>
                    <input
                      type="range"
                      min={16}
                      max={128}
                      step={8}
                      value={bitSize}
                      onChange={(e) =>
                        handleBitSizeChange(parseInt(e.target.value))
                      }
                      className="w-20 h-1.5 accent-[#6366f1] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#6366f1]"
                    />
                    <span className="text-[10px] font-mono text-[#a1a1aa] w-6">
                      {bitSize}
                    </span>
                  </div>
                  {/* Hash count */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[#71717a]">
                      Hashes:
                    </span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => handleHashCountChange(n)}
                          className={`w-6 h-6 rounded text-[10px] font-mono font-bold transition-all ${
                            hashCount === n
                              ? "bg-[#6366f1] text-white"
                              : "bg-[#1e1e2e] text-[#71717a] hover:bg-[#2a2a3e] hover:text-white"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4">
                {/* Bit array grid */}
                <div className="flex flex-wrap gap-1 justify-center">
                  {state.bitArray.map((bit, i) => {
                    const highlight = highlightedBits.get(i);
                    const isSet = bit;

                    return (
                      <motion.div
                        key={i}
                        className="relative flex items-center justify-center rounded"
                        style={{
                          width:
                            state.bitSize <= 32
                              ? 32
                              : state.bitSize <= 64
                              ? 24
                              : 18,
                          height:
                            state.bitSize <= 32
                              ? 32
                              : state.bitSize <= 64
                              ? 24
                              : 18,
                          backgroundColor: highlight
                            ? `${highlight.color}30`
                            : isSet
                            ? "#6366f120"
                            : "#1e1e2e",
                          border: highlight
                            ? `2px solid ${highlight.color}`
                            : isSet
                            ? "1px solid #6366f140"
                            : "1px solid #2a2a3e",
                          boxShadow: highlight
                            ? `0 0 12px ${highlight.color}40`
                            : isSet
                            ? "0 0 8px #6366f115"
                            : "none",
                          transition: "all 0.3s ease",
                        }}
                        animate={
                          highlight
                            ? {
                                scale: [1, 1.15, 1],
                                transition: { duration: 0.3 },
                              }
                            : {}
                        }
                      >
                        <span
                          className="font-mono font-bold"
                          style={{
                            fontSize:
                              state.bitSize <= 32
                                ? 11
                                : state.bitSize <= 64
                                ? 9
                                : 7,
                            color: highlight
                              ? highlight.color
                              : isSet
                              ? "#6366f1"
                              : "#4a4a5a",
                          }}
                        >
                          {isSet ? "1" : "0"}
                        </span>
                        {/* Index number */}
                        {state.bitSize <= 64 && (
                          <span
                            className="absolute -bottom-0.5 text-center font-mono"
                            style={{
                              fontSize: 6,
                              color: "#71717a50",
                            }}
                          >
                            {i}
                          </span>
                        )}
                      </motion.div>
                    );
                  })}
                </div>

                {/* Fill ratio bar */}
                <div className="mt-4 flex items-center gap-3">
                  <span className="text-[10px] text-[#71717a] shrink-0">
                    Saturation
                  </span>
                  <div className="flex-1 h-2 bg-[#1e1e2e] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{
                        background:
                          metrics.fillRatio > 0.7
                            ? "linear-gradient(90deg, #f59e0b, #ef4444)"
                            : metrics.fillRatio > 0.4
                            ? "linear-gradient(90deg, #10b981, #f59e0b)"
                            : "linear-gradient(90deg, #6366f1, #06b6d4)",
                      }}
                      animate={{
                        width: `${metrics.fillRatio * 100}%`,
                      }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-[#a1a1aa] shrink-0">
                    {(metrics.fillRatio * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </motion.div>

            {/* ── Hash function visualization + Controls ── */}
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
              {/* Hash Function Arrows */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <Hash size={14} className="text-[#f59e0b]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Hash Functions
                  </span>
                </div>

                <div className="p-4 space-y-3">
                  {/* Show current insert or query hash computation */}
                  {(() => {
                    const lastInsert =
                      state.insertAnimations[
                        state.insertAnimations.length - 1
                      ];
                    const qa = state.queryAnimation;
                    const activeAnim =
                      qa && !qa.complete
                        ? {
                            element: qa.element,
                            positions: qa.hashPositions,
                            currentIdx: qa.currentHashIndex,
                            type: "query" as const,
                          }
                        : lastInsert && !lastInsert.complete
                        ? {
                            element: lastInsert.element,
                            positions: lastInsert.hashPositions,
                            currentIdx: lastInsert.currentHashIndex,
                            type: "insert" as const,
                          }
                        : null;

                    if (!activeAnim) {
                      return (
                        <div className="text-xs text-[#71717a] italic text-center py-6">
                          Insert or query an element to see hash computations
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-xs text-[#71717a]">
                            {activeAnim.type === "insert"
                              ? "Inserting"
                              : "Querying"}
                            :
                          </span>
                          <span className="px-2 py-1 rounded bg-[#6366f1]/10 border border-[#6366f1]/20 text-[#6366f1] text-xs font-mono font-bold">
                            &quot;{activeAnim.element}&quot;
                          </span>
                        </div>

                        {activeAnim.positions.map((pos, i) => {
                          const isProcessed = i <= activeAnim.currentIdx;
                          const isCurrent = i === activeAnim.currentIdx;
                          const color = HASH_COLORS[i % HASH_COLORS.length];
                          const bitIsSet = state.bitArray[pos];

                          return (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{
                                opacity: isProcessed ? 1 : 0.3,
                                x: 0,
                              }}
                              className="flex items-center gap-3"
                            >
                              {/* Hash function label */}
                              <div
                                className="px-2 py-1 rounded text-[10px] font-mono font-bold shrink-0"
                                style={{
                                  backgroundColor: `${color}15`,
                                  color: color,
                                  border: `1px solid ${color}30`,
                                }}
                              >
                                h{i + 1}
                              </div>

                              {/* Arrow */}
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-mono text-[#71717a]">
                                  h{i + 1}(&quot;{activeAnim.element}&quot;)
                                </span>
                                <ArrowRight
                                  size={12}
                                  style={{ color }}
                                  className={
                                    isCurrent ? "animate-pulse" : ""
                                  }
                                />
                              </div>

                              {/* Position */}
                              <div
                                className="px-2 py-1 rounded text-[10px] font-mono font-bold"
                                style={{
                                  backgroundColor: isProcessed
                                    ? `${color}15`
                                    : "#1e1e2e",
                                  color: isProcessed ? color : "#71717a",
                                  border: isCurrent
                                    ? `2px solid ${color}`
                                    : `1px solid ${
                                        isProcessed
                                          ? `${color}30`
                                          : "#2a2a3e"
                                      }`,
                                  boxShadow: isCurrent
                                    ? `0 0 8px ${color}30`
                                    : "none",
                                }}
                              >
                                bit[{pos}]
                              </div>

                              {/* Query result for this bit */}
                              {activeAnim.type === "query" &&
                                isProcessed && (
                                  <span
                                    className="text-[10px] font-bold"
                                    style={{
                                      color: bitIsSet
                                        ? "#10b981"
                                        : "#ef4444",
                                    }}
                                  >
                                    = {bitIsSet ? "1" : "0"}{" "}
                                    {bitIsSet ? "" : "MISS!"}
                                  </span>
                                )}
                            </motion.div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </motion.div>

              {/* Right side: Insert/Query controls + Element list */}
              <div className="space-y-4">
                {/* Manual Insert */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                    <Plus size={14} className="text-[#10b981]" />
                    <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                      Insert Element
                    </span>
                  </div>
                  <div className="p-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && handleManualInsert()
                        }
                        className="flex-1 px-3 py-1.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-xs font-mono text-[#e4e4e7] focus:border-[#6366f1]/50 focus:outline-none"
                        placeholder="Type element name..."
                      />
                      <button
                        onClick={handleManualInsert}
                        className="px-3 py-1.5 rounded-lg bg-[#10b981] hover:bg-[#34d399] text-white text-xs font-medium transition-all"
                      >
                        Insert
                      </button>
                    </div>
                  </div>
                </motion.div>

                {/* Manual Query */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                  className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                    <Search size={14} className="text-[#06b6d4]" />
                    <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                      Query Element
                    </span>
                  </div>
                  <div className="p-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={queryInput}
                        onChange={(e) => setQueryInput(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && handleManualQuery()
                        }
                        className="flex-1 px-3 py-1.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-xs font-mono text-[#e4e4e7] focus:border-[#6366f1]/50 focus:outline-none"
                        placeholder="Check if element exists..."
                      />
                      <button
                        onClick={handleManualQuery}
                        className="px-3 py-1.5 rounded-lg bg-[#06b6d4] hover:bg-[#22d3ee] text-white text-xs font-medium transition-all"
                      >
                        Query
                      </button>
                    </div>
                  </div>
                </motion.div>

                {/* Inserted Elements */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
                    <div className="flex items-center gap-2">
                      <Filter size={14} className="text-[#a855f7]" />
                      <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                        Inserted Elements
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[#71717a]">
                      {state.elements.length} items
                    </span>
                  </div>
                  <div className="p-3 max-h-[140px] overflow-y-auto scrollbar-thin">
                    <div className="flex flex-wrap gap-1.5">
                      <AnimatePresence mode="popLayout">
                        {state.elements.map((el) => (
                          <motion.span
                            key={el}
                            initial={{ opacity: 0, scale: 0.7 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="px-2 py-1 rounded text-[10px] font-mono font-medium bg-[#6366f1]/10 text-[#6366f1] border border-[#6366f1]/20"
                          >
                            {el}
                          </motion.span>
                        ))}
                      </AnimatePresence>
                    </div>
                    {state.elements.length === 0 && (
                      <div className="text-[10px] text-[#71717a] italic text-center py-3">
                        No elements inserted yet
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>
            </div>

            {/* ── Query Results + Info ── */}
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
              {/* Query Results */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
                  <div className="flex items-center gap-2">
                    <Search size={14} className="text-[#06b6d4]" />
                    <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                      Query Results
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-[#71717a]">
                    {state.queries.length} queries
                  </span>
                </div>

                <div className="max-h-[300px] overflow-y-auto scrollbar-thin">
                  {state.queries.length === 0 ? (
                    <div className="text-xs text-[#71717a] italic text-center py-8">
                      No queries yet. Insert elements first, then query!
                    </div>
                  ) : (
                    <div className="divide-y divide-[#1e1e2e]/50">
                      <AnimatePresence mode="popLayout">
                        {state.queries.map((q) => (
                          <motion.div
                            key={q.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="px-4 py-2.5 flex items-center gap-3"
                          >
                            {/* Result icon */}
                            {q.result === "probably-yes" ? (
                              q.isFalsePositive ? (
                                <AlertTriangle
                                  size={14}
                                  className="text-[#ef4444] shrink-0"
                                />
                              ) : (
                                <CheckCircle
                                  size={14}
                                  className="text-[#10b981] shrink-0"
                                />
                              )
                            ) : (
                              <XCircle
                                size={14}
                                className="text-[#ef4444] shrink-0"
                              />
                            )}

                            {/* Element name */}
                            <span className="text-xs font-mono font-medium text-[#e4e4e7] min-w-[60px]">
                              &quot;{q.element}&quot;
                            </span>

                            {/* Result badge */}
                            <span
                              className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                              style={{
                                backgroundColor:
                                  q.result === "probably-yes"
                                    ? q.isFalsePositive
                                      ? "#ef444420"
                                      : "#10b98120"
                                    : "#ef444415",
                                color:
                                  q.result === "probably-yes"
                                    ? q.isFalsePositive
                                      ? "#ef4444"
                                      : "#10b981"
                                    : "#ef4444",
                                border: `1px solid ${
                                  q.result === "probably-yes"
                                    ? q.isFalsePositive
                                      ? "#ef444430"
                                      : "#10b98130"
                                    : "#ef444420"
                                }`,
                              }}
                            >
                              {q.result === "probably-yes"
                                ? "Probably Yes"
                                : "Definitely No"}
                            </span>

                            {/* False positive indicator */}
                            {q.isFalsePositive && (
                              <span className="text-[10px] font-bold text-[#ef4444] bg-[#ef4444]/10 px-1.5 py-0.5 rounded border border-[#ef4444]/20">
                                FALSE POSITIVE
                              </span>
                            )}

                            {/* Hash positions */}
                            <div className="flex gap-1 ml-auto">
                              {q.hashPositions.map((pos, i) => (
                                <span
                                  key={i}
                                  className="text-[9px] font-mono px-1 py-0.5 rounded"
                                  style={{
                                    backgroundColor: `${HASH_COLORS[i % HASH_COLORS.length]}15`,
                                    color:
                                      HASH_COLORS[
                                        i % HASH_COLORS.length
                                      ],
                                  }}
                                >
                                  [{pos}]
                                </span>
                              ))}
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>

                {/* Current query animation result */}
                <AnimatePresence>
                  {state.queryAnimation &&
                    state.queryAnimation.complete && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="mx-4 mb-3 px-3 py-2 rounded-lg border"
                        style={{
                          backgroundColor:
                            state.queryAnimation.result === "probably-yes"
                              ? "#10b98110"
                              : "#ef444410",
                          borderColor:
                            state.queryAnimation.result === "probably-yes"
                              ? "#10b98130"
                              : "#ef444430",
                        }}
                      >
                        <span
                          className="text-xs font-bold"
                          style={{
                            color:
                              state.queryAnimation.result === "probably-yes"
                                ? "#10b981"
                                : "#ef4444",
                          }}
                        >
                          {state.queryAnimation.result === "probably-yes"
                            ? 'Result: "Probably in set" - all hash positions are set to 1'
                            : 'Result: "Definitely not in set" - at least one bit is 0'}
                        </span>
                      </motion.div>
                    )}
                </AnimatePresence>
              </motion.div>

              {/* How It Works */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <BarChart3 size={14} className="text-[#71717a]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    How Bloom Filters Work
                  </span>
                </div>

                <div className="p-4 space-y-3 text-xs text-[#a1a1aa] leading-relaxed">
                  <p>
                    A <strong className="text-white">Bloom filter</strong> is a
                    probabilistic data structure that tests set membership using{" "}
                    <strong className="text-[#6366f1]">k hash functions</strong>{" "}
                    and an{" "}
                    <strong className="text-[#06b6d4]">
                      m-bit array
                    </strong>.
                  </p>
                  <div className="space-y-1.5">
                    <p className="text-[#71717a] font-semibold uppercase tracking-wider text-[10px]">
                      Operations:
                    </p>
                    <div className="space-y-1 ml-1">
                      <div>
                        <strong className="text-[#10b981]">Insert:</strong>{" "}
                        Hash element with k functions, set k bits to 1
                      </div>
                      <div>
                        <strong className="text-[#06b6d4]">Query:</strong>{" "}
                        Hash element, check k bits. All 1?{" "}
                        <span className="text-[#10b981]">Probably yes</span>.
                        Any 0?{" "}
                        <span className="text-[#ef4444]">
                          Definitely no
                        </span>.
                      </div>
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-[#ef4444]/5 border border-[#ef4444]/10">
                    <div className="text-[10px] font-bold text-[#ef4444] mb-1">
                      False Positives
                    </div>
                    <div className="text-[10px] text-[#a1a1aa]">
                      Different elements can set overlapping bits. When all k
                      positions for a non-member happen to be set by other
                      elements, we get a false positive. The rate depends on m
                      (bits), n (elements), and k (hash functions).
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-[#6366f1]/5 border border-[#6366f1]/10">
                    <div className="text-[10px] font-bold text-[#6366f1] mb-1">
                      Optimal k
                    </div>
                    <div className="text-[10px] text-[#a1a1aa] font-mono">
                      k = (m/n) * ln(2)
                    </div>
                    <div className="text-[10px] text-[#a1a1aa] mt-0.5">
                      Too few hash functions means more collisions. Too many
                      means the array fills up faster.
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="p-2 rounded-lg bg-[#10b981]/5 border border-[#10b981]/10 text-center">
                      <div className="text-[10px] font-bold text-[#10b981]">
                        No False Negatives
                      </div>
                      <div className="text-[9px] text-[#71717a]">
                        If it says &quot;no&quot;, it is 100% certain
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-[#f59e0b]/5 border border-[#f59e0b]/10 text-center">
                      <div className="text-[10px] font-bold text-[#f59e0b]">
                        No Deletion
                      </div>
                      <div className="text-[9px] text-[#71717a]">
                        Cannot unset bits (use counting BF)
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px]">
                    <strong className="text-[#06b6d4]">
                      Common uses:
                    </strong>{" "}
                    Spell checkers, database query optimization, network
                    routers, cache filtering, cryptocurrency wallets (BIP37).
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════ */

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
    <div className="rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-[#71717a] mb-0.5">
        {label}
      </div>
      <div className="text-base font-bold font-mono" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
