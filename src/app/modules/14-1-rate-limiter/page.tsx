"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Droplets,
  Timer,
  SlidersHorizontal,
  Info,
  Lightbulb,
  ArrowRight,
  Check,
  X,
  Layers,
  Activity,
  Gauge,
  Clock,
  Zap,
  BarChart3,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

type AlgorithmType =
  | "token-bucket"
  | "leaky-bucket"
  | "fixed-window"
  | "sliding-window-log"
  | "sliding-window-counter";

interface AlgorithmInfo {
  id: AlgorithmType;
  label: string;
  shortLabel: string;
  description: string;
  pros: string[];
  cons: string[];
}

interface RequestEvent {
  id: number;
  timestamp: number;
  accepted: boolean;
  label: string;
}

interface TokenBucketState {
  tokens: number;
  capacity: number;
  refillRate: number; // tokens per tick
  lastRefillTick: number;
}

interface LeakyBucketState {
  queue: number; // current queue size
  capacity: number;
  leakRate: number; // items per tick
  lastLeakTick: number;
}

interface FixedWindowState {
  count: number;
  windowStart: number;
  windowSize: number; // in ticks
  maxRequests: number;
}

interface SlidingWindowLogState {
  timestamps: number[];
  windowSize: number; // in ticks
  maxRequests: number;
}

interface SlidingWindowCounterState {
  currentCount: number;
  previousCount: number;
  windowStart: number;
  windowSize: number; // in ticks
  maxRequests: number;
}

type ScenarioKey = "steady" | "burst" | "ramp" | "spike-recovery";

interface Scenario {
  id: ScenarioKey;
  label: string;
  description: string;
  pattern: (tick: number) => boolean; // should a request arrive at this tick?
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
  lime: "#84cc16",
  accepted: "#10b981",
  rejected: "#ef4444",
  token: "#f59e0b",
  bucket: "#6366f1",
  window: "#06b6d4",
};

const ALGORITHMS: AlgorithmInfo[] = [
  {
    id: "token-bucket",
    label: "Token Bucket",
    shortLabel: "Token",
    description:
      "Tokens are added to a bucket at a fixed rate. Each request consumes one token. Requests are rejected when the bucket is empty. Allows bursts up to bucket capacity.",
    pros: ["Allows controlled bursts", "Simple to implement", "Memory efficient"],
    cons: ["Burst size limited by bucket capacity", "No guarantee of smooth rate"],
  },
  {
    id: "leaky-bucket",
    label: "Leaky Bucket",
    shortLabel: "Leaky",
    description:
      "Requests are added to a queue (bucket). The bucket processes requests at a fixed rate, like water leaking from a hole. Overflow is rejected.",
    pros: ["Smooths out bursts", "Constant output rate", "Predictable"],
    cons: ["No burst tolerance", "Recent requests may wait", "Queue management overhead"],
  },
  {
    id: "fixed-window",
    label: "Fixed Window",
    shortLabel: "Fixed",
    description:
      "Time is divided into fixed windows. A counter tracks requests per window. Counter resets at window boundaries. Simple but has boundary burst issues.",
    pros: ["Very simple", "Low memory", "Easy to reason about"],
    cons: ["Boundary burst problem", "Up to 2x rate at window edges"],
  },
  {
    id: "sliding-window-log",
    label: "Sliding Window Log",
    shortLabel: "Log",
    description:
      "Stores timestamp of every request. The window slides continuously. Counts requests within the window. Most accurate but memory-intensive.",
    pros: ["Most accurate", "No boundary issues", "Smooth limiting"],
    cons: ["High memory usage", "Expensive computation", "Stores all timestamps"],
  },
  {
    id: "sliding-window-counter",
    label: "Sliding Window Counter",
    shortLabel: "Counter",
    description:
      "Combines fixed window efficiency with sliding window accuracy. Uses weighted average of current and previous window counts based on overlap.",
    pros: ["Good accuracy", "Low memory", "Smooth transitions"],
    cons: ["Approximate", "Slightly complex", "Not perfectly accurate at boundaries"],
  },
];

// ─── Traffic Patterns ─────────────────────────────────────────────────────────

const SCENARIOS: Scenario[] = [
  {
    id: "steady",
    label: "Steady Traffic",
    description: "Consistent request rate of ~1 per 2 ticks",
    pattern: (tick: number) => tick % 2 === 0,
  },
  {
    id: "burst",
    label: "Burst Traffic",
    description: "Bursts of rapid requests followed by quiet periods",
    pattern: (tick: number) => {
      const cycle = tick % 30;
      return cycle < 10; // 10 rapid requests, then 20 ticks quiet
    },
  },
  {
    id: "ramp",
    label: "Gradual Ramp",
    description: "Request rate gradually increases over time",
    pattern: (tick: number) => {
      const period = Math.max(1, Math.floor(10 - tick / 20));
      return tick % period === 0;
    },
  },
  {
    id: "spike-recovery",
    label: "Spike & Recovery",
    description: "Normal traffic, sudden spike, then return to normal",
    pattern: (tick: number) => {
      if (tick < 40) return tick % 3 === 0; // normal
      if (tick < 60) return true; // spike - every tick
      return tick % 3 === 0; // recover
    },
  },
];

// ─── Initial States ───────────────────────────────────────────────────────────

function createTokenBucketState(): TokenBucketState {
  return { tokens: 10, capacity: 10, refillRate: 1, lastRefillTick: 0 };
}

function createLeakyBucketState(): LeakyBucketState {
  return { queue: 0, capacity: 10, leakRate: 1, lastLeakTick: 0 };
}

function createFixedWindowState(): FixedWindowState {
  return { count: 0, windowStart: 0, windowSize: 10, maxRequests: 5 };
}

function createSlidingWindowLogState(): SlidingWindowLogState {
  return { timestamps: [], windowSize: 10, maxRequests: 5 };
}

function createSlidingWindowCounterState(): SlidingWindowCounterState {
  return {
    currentCount: 0,
    previousCount: 0,
    windowStart: 0,
    windowSize: 10,
    maxRequests: 5,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RateLimiterModule() {
  // ── Configuration ──
  const [selectedAlgorithm, setSelectedAlgorithm] =
    useState<AlgorithmType>("token-bucket");
  const [activeScenario, setActiveScenario] = useState<ScenarioKey>("steady");
  const [rateLimit, setRateLimit] = useState(5); // max requests per window / bucket capacity
  const [refillRate, setRefillRate] = useState(1); // token refill rate / leak rate

  // ── Simulation state ──
  const [tick, setTick] = useState(0);
  const [events, setEvents] = useState<RequestEvent[]>([]);
  const [totalRequests, setTotalRequests] = useState(0);
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);

  // ── Algorithm-specific state ──
  const [tokenBucket, setTokenBucket] = useState(createTokenBucketState);
  const [leakyBucket, setLeakyBucket] = useState(createLeakyBucketState);
  const [fixedWindow, setFixedWindow] = useState(createFixedWindowState);
  const [slidingLog, setSlidingLog] = useState(createSlidingWindowLogState);
  const [slidingCounter, setSlidingCounter] = useState(createSlidingWindowCounterState);

  // ── Playback ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);

  // ── Animation ──
  const [lastEvent, setLastEvent] = useState<RequestEvent | null>(null);

  // ── Refs ──
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const tickRef = useRef(tick);
  const nextEventId = useRef(0);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  // ── Get current scenario pattern ──
  const getScenarioPattern = useCallback(() => {
    return SCENARIOS.find((s) => s.id === activeScenario)?.pattern ?? (() => false);
  }, [activeScenario]);

  // ── Process a request through the selected algorithm ──
  const processRequest = useCallback(
    (currentTick: number): boolean => {
      switch (selectedAlgorithm) {
        case "token-bucket": {
          setTokenBucket((prev) => {
            // Refill tokens
            const ticksSinceRefill = currentTick - prev.lastRefillTick;
            const newTokens = Math.min(
              prev.capacity,
              prev.tokens + ticksSinceRefill * refillRate
            );
            if (newTokens >= 1) {
              return {
                ...prev,
                tokens: newTokens - 1,
                lastRefillTick: currentTick,
              };
            }
            return { ...prev, tokens: newTokens, lastRefillTick: currentTick };
          });
          // Read the current state synchronously for decision
          const tb = tokenBucket;
          const ticksSinceRefill = currentTick - tb.lastRefillTick;
          const currentTokens = Math.min(
            rateLimit,
            tb.tokens + ticksSinceRefill * refillRate
          );
          return currentTokens >= 1;
        }
        case "leaky-bucket": {
          setLeakyBucket((prev) => {
            const ticksSinceLeak = currentTick - prev.lastLeakTick;
            const leaked = Math.min(prev.queue, ticksSinceLeak * refillRate);
            const newQueue = prev.queue - leaked;
            if (newQueue < rateLimit) {
              return {
                ...prev,
                queue: newQueue + 1,
                lastLeakTick: currentTick,
              };
            }
            return { ...prev, queue: newQueue, lastLeakTick: currentTick };
          });
          const lb = leakyBucket;
          const ticksSinceLeak = currentTick - lb.lastLeakTick;
          const leaked = Math.min(lb.queue, ticksSinceLeak * refillRate);
          const currentQueue = lb.queue - leaked;
          return currentQueue < rateLimit;
        }
        case "fixed-window": {
          setFixedWindow((prev) => {
            let newState = { ...prev };
            const windowSize = 10;
            if (currentTick - prev.windowStart >= windowSize) {
              newState = {
                ...newState,
                count: 0,
                windowStart:
                  Math.floor(currentTick / windowSize) * windowSize,
                windowSize,
              };
            }
            if (newState.count < rateLimit) {
              return { ...newState, count: newState.count + 1, maxRequests: rateLimit };
            }
            return { ...newState, maxRequests: rateLimit };
          });
          const fw = fixedWindow;
          const windowSize = 10;
          let count = fw.count;
          if (currentTick - fw.windowStart >= windowSize) {
            count = 0;
          }
          return count < rateLimit;
        }
        case "sliding-window-log": {
          setSlidingLog((prev) => {
            const windowSize = 10;
            const filtered = prev.timestamps.filter(
              (t) => currentTick - t < windowSize
            );
            if (filtered.length < rateLimit) {
              return {
                ...prev,
                timestamps: [...filtered, currentTick],
                maxRequests: rateLimit,
              };
            }
            return { ...prev, timestamps: filtered, maxRequests: rateLimit };
          });
          const sl = slidingLog;
          const windowSize = 10;
          const filtered = sl.timestamps.filter(
            (t) => currentTick - t < windowSize
          );
          return filtered.length < rateLimit;
        }
        case "sliding-window-counter": {
          setSlidingCounter((prev) => {
            const windowSize = 10;
            let newState = { ...prev, maxRequests: rateLimit };
            if (currentTick - prev.windowStart >= windowSize) {
              newState = {
                ...newState,
                previousCount: prev.currentCount,
                currentCount: 0,
                windowStart:
                  Math.floor(currentTick / windowSize) * windowSize,
              };
            }
            const elapsed = currentTick - newState.windowStart;
            const weight = 1 - elapsed / windowSize;
            const estimatedCount =
              newState.currentCount + newState.previousCount * weight;
            if (estimatedCount < rateLimit) {
              return {
                ...newState,
                currentCount: newState.currentCount + 1,
              };
            }
            return newState;
          });
          const sc = slidingCounter;
          const windowSize = 10;
          let currentCount = sc.currentCount;
          let previousCount = sc.previousCount;
          let windowStart = sc.windowStart;
          if (currentTick - sc.windowStart >= windowSize) {
            previousCount = currentCount;
            currentCount = 0;
            windowStart = Math.floor(currentTick / windowSize) * windowSize;
          }
          const elapsed = currentTick - windowStart;
          const weight = 1 - elapsed / windowSize;
          const estimatedCount = currentCount + previousCount * weight;
          return estimatedCount < rateLimit;
        }
        default:
          return false;
      }
    },
    [
      selectedAlgorithm,
      rateLimit,
      refillRate,
      tokenBucket,
      leakyBucket,
      fixedWindow,
      slidingLog,
      slidingCounter,
    ]
  );

  // ── Step forward ──
  const stepForward = useCallback(() => {
    const currentTick = tickRef.current;
    const pattern = getScenarioPattern();
    const shouldRequest = pattern(currentTick);

    if (shouldRequest) {
      const accepted = processRequest(currentTick);
      const event: RequestEvent = {
        id: nextEventId.current++,
        timestamp: currentTick,
        accepted,
        label: `REQ-${nextEventId.current}`,
      };
      setEvents((prev) => [event, ...prev].slice(0, 100));
      setLastEvent(event);
      setTotalRequests((prev) => prev + 1);
      if (accepted) {
        setAcceptedCount((prev) => prev + 1);
      } else {
        setRejectedCount((prev) => prev + 1);
      }
    } else {
      // Still refill tokens / leak bucket even without a request
      if (selectedAlgorithm === "token-bucket") {
        setTokenBucket((prev) => {
          const newTokens = Math.min(prev.capacity, prev.tokens + refillRate);
          return { ...prev, tokens: newTokens, lastRefillTick: currentTick };
        });
      }
      if (selectedAlgorithm === "leaky-bucket") {
        setLeakyBucket((prev) => {
          const leaked = Math.min(prev.queue, refillRate);
          return {
            ...prev,
            queue: Math.max(0, prev.queue - leaked),
            lastLeakTick: currentTick,
          };
        });
      }
    }

    setTick((prev) => prev + 1);
    tickRef.current = currentTick + 1;
  }, [getScenarioPattern, processRequest, selectedAlgorithm, refillRate]);

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
    setTick(0);
    tickRef.current = 0;
    setEvents([]);
    setTotalRequests(0);
    setAcceptedCount(0);
    setRejectedCount(0);
    setLastEvent(null);
    nextEventId.current = 0;
    setTokenBucket({ ...createTokenBucketState(), capacity: rateLimit });
    setLeakyBucket({ ...createLeakyBucketState(), capacity: rateLimit });
    setFixedWindow({ ...createFixedWindowState(), maxRequests: rateLimit });
    setSlidingLog({ ...createSlidingWindowLogState(), maxRequests: rateLimit });
    setSlidingCounter({
      ...createSlidingWindowCounterState(),
      maxRequests: rateLimit,
    });
  }, [handlePause, rateLimit]);

  const handleAlgorithmChange = useCallback(
    (algo: AlgorithmType) => {
      handleReset();
      setSelectedAlgorithm(algo);
    },
    [handleReset]
  );

  const handleScenarioChange = useCallback(
    (scenarioId: string) => {
      handleReset();
      setActiveScenario(scenarioId as ScenarioKey);
    },
    [handleReset]
  );

  // ── Computed values ──
  const acceptanceRate =
    totalRequests > 0 ? ((acceptedCount / totalRequests) * 100).toFixed(1) : "0.0";
  const currentAlgoInfo = ALGORITHMS.find((a) => a.id === selectedAlgorithm)!;

  // Get current fill level for bucket visualization
  const getBucketFill = (): { current: number; max: number; label: string } => {
    switch (selectedAlgorithm) {
      case "token-bucket":
        return {
          current: Math.max(0, Math.round(tokenBucket.tokens * 10) / 10),
          max: rateLimit,
          label: "Tokens",
        };
      case "leaky-bucket":
        return {
          current: leakyBucket.queue,
          max: rateLimit,
          label: "Queue",
        };
      case "fixed-window":
        return {
          current: fixedWindow.count,
          max: rateLimit,
          label: "Count",
        };
      case "sliding-window-log":
        return {
          current: slidingLog.timestamps.filter(
            (t) => tick - t < 10
          ).length,
          max: rateLimit,
          label: "In Window",
        };
      case "sliding-window-counter": {
        const windowSize = 10;
        const elapsed = tick - slidingCounter.windowStart;
        const weight = elapsed < windowSize ? 1 - elapsed / windowSize : 0;
        const estimated =
          slidingCounter.currentCount +
          slidingCounter.previousCount * weight;
        return {
          current: Math.round(estimated * 10) / 10,
          max: rateLimit,
          label: "Weighted",
        };
      }
      default:
        return { current: 0, max: rateLimit, label: "Count" };
    }
  };

  const bucketFill = getBucketFill();

  // ── Metrics ──
  const metrics = [
    { label: "Total Requests", value: totalRequests, color: COLORS.secondary },
    { label: "Accepted", value: acceptedCount, color: COLORS.accepted },
    { label: "Rejected", value: rejectedCount, color: COLORS.rejected },
    {
      label: bucketFill.label,
      value: bucketFill.current,
      color: COLORS.token,
    },
    { label: "Acceptance Rate", value: `${acceptanceRate}%`, color: COLORS.success },
    { label: "Tick", value: tick, color: COLORS.muted },
  ];

  // Timeline: last 60 ticks
  const timelineEvents = events.filter((e) => tick - e.timestamp < 60);

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
                  backgroundColor: `${COLORS.lime}15`,
                  color: COLORS.lime,
                  border: `1px solid ${COLORS.lime}30`,
                }}
              >
                14.1
              </span>
              <span className="text-xs text-[#71717a]">
                System Design Building Blocks
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Rate Limiter
            </h1>
            <p className="text-[#a1a1aa] text-base max-w-2xl">
              Control the rate of incoming requests using different algorithms.
              Compare Token Bucket, Leaky Bucket, Fixed Window, Sliding Window
              Log, and Sliding Window Counter approaches.
            </p>
          </motion.div>

          {/* ── Algorithm selector ──────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
            className="flex flex-wrap items-center gap-2"
          >
            <div className="flex items-center gap-1.5 text-xs text-[#71717a] mr-1">
              <Shield size={14} />
              <span>Algorithm</span>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {ALGORITHMS.map((algo) => (
                <button
                  key={algo.id}
                  onClick={() => handleAlgorithmChange(algo.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                    selectedAlgorithm === algo.id
                      ? "bg-[#6366f1]/15 text-[#6366f1] border border-[#6366f1]/30"
                      : "bg-[#1e1e2e] text-[#a1a1aa] border border-transparent hover:bg-[#2a2a3e] hover:text-white"
                  }`}
                >
                  {algo.shortLabel}
                </button>
              ))}
            </div>
          </motion.div>

          {/* ── Scenario selector + config ─────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: [0.23, 1, 0.32, 1] }}
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

            {/* Config controls */}
            <div className="flex items-center gap-4 ml-auto">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#71717a]">Limit:</span>
                <input
                  type="range"
                  min={2}
                  max={15}
                  step={1}
                  value={rateLimit}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    setRateLimit(v);
                  }}
                  className="w-16 h-1.5 accent-[#6366f1] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#6366f1]"
                />
                <span className="text-xs font-mono text-[#a1a1aa]">{rateLimit}</span>
              </div>
              {(selectedAlgorithm === "token-bucket" || selectedAlgorithm === "leaky-bucket") && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#71717a]">
                    {selectedAlgorithm === "token-bucket" ? "Refill:" : "Leak:"}
                  </span>
                  <input
                    type="range"
                    min={0.5}
                    max={3}
                    step={0.5}
                    value={refillRate}
                    onChange={(e) => setRefillRate(parseFloat(e.target.value))}
                    className="w-16 h-1.5 accent-[#f59e0b] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f59e0b]"
                  />
                  <span className="text-xs font-mono text-[#a1a1aa]">
                    {refillRate}/tick
                  </span>
                </div>
              )}
            </div>
          </motion.div>

          {/* ── Main visualization ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-4"
          >
            {/* ── Left: Bucket / Window visualization ── */}
            <div className="lg:col-span-1 space-y-4">
              {/* Bucket visualization */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-4">
                  {selectedAlgorithm === "token-bucket" ? (
                    <Droplets size={14} style={{ color: COLORS.token }} />
                  ) : selectedAlgorithm === "leaky-bucket" ? (
                    <Droplets size={14} style={{ color: COLORS.bucket }} />
                  ) : (
                    <Timer size={14} style={{ color: COLORS.window }} />
                  )}
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    {currentAlgoInfo.label}
                  </span>
                </div>

                {/* Visual bucket container */}
                <div className="flex flex-col items-center">
                  <div
                    className="relative w-40 rounded-xl overflow-hidden"
                    style={{
                      height: 200,
                      background: `${COLORS.border}`,
                      border: `2px solid ${COLORS.border}`,
                    }}
                  >
                    {/* Capacity marker */}
                    <div
                      className="absolute left-0 right-0 border-t border-dashed"
                      style={{
                        top: 0,
                        borderColor: `${COLORS.danger}40`,
                      }}
                    />

                    {/* Fill level */}
                    <motion.div
                      className="absolute bottom-0 left-0 right-0"
                      animate={{
                        height: `${Math.min(
                          100,
                          (bucketFill.current / Math.max(bucketFill.max, 1)) * 100
                        )}%`,
                      }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                      style={{
                        background:
                          selectedAlgorithm === "token-bucket"
                            ? `linear-gradient(to top, ${COLORS.token}40, ${COLORS.token}20)`
                            : selectedAlgorithm === "leaky-bucket"
                            ? `linear-gradient(to top, ${COLORS.bucket}40, ${COLORS.bucket}20)`
                            : `linear-gradient(to top, ${COLORS.window}40, ${COLORS.window}20)`,
                        borderTop:
                          selectedAlgorithm === "token-bucket"
                            ? `2px solid ${COLORS.token}`
                            : selectedAlgorithm === "leaky-bucket"
                            ? `2px solid ${COLORS.bucket}`
                            : `2px solid ${COLORS.window}`,
                      }}
                    />

                    {/* Token dots for token bucket */}
                    {selectedAlgorithm === "token-bucket" && (
                      <div className="absolute inset-0 flex flex-wrap content-end p-2 gap-1.5">
                        {Array.from(
                          { length: Math.min(Math.floor(tokenBucket.tokens), rateLimit) },
                          (_, i) => (
                            <motion.div
                              key={i}
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="w-4 h-4 rounded-full"
                              style={{
                                background: COLORS.token,
                                boxShadow: `0 0 6px ${COLORS.token}40`,
                              }}
                            />
                          )
                        )}
                      </div>
                    )}

                    {/* Leak indicator for leaky bucket */}
                    {selectedAlgorithm === "leaky-bucket" && leakyBucket.queue > 0 && (
                      <motion.div
                        className="absolute bottom-0 left-1/2 transform -translate-x-1/2"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity }}
                      >
                        <Droplets size={16} style={{ color: COLORS.bucket }} />
                      </motion.div>
                    )}

                    {/* Level text */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <div className="font-mono text-2xl font-bold text-white" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
                          {typeof bucketFill.current === "number"
                            ? Math.round(bucketFill.current * 10) / 10
                            : bucketFill.current}
                        </div>
                        <div className="text-[10px] text-[#a1a1aa] font-mono">
                          / {bucketFill.max}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 text-xs text-[#71717a] text-center">
                    {selectedAlgorithm === "token-bucket" &&
                      `Refill rate: ${refillRate} token/tick`}
                    {selectedAlgorithm === "leaky-bucket" &&
                      `Leak rate: ${refillRate} req/tick`}
                    {selectedAlgorithm === "fixed-window" &&
                      `Window: resets every 10 ticks`}
                    {selectedAlgorithm === "sliding-window-log" &&
                      `Window: last 10 ticks`}
                    {selectedAlgorithm === "sliding-window-counter" &&
                      `Weighted window: last 10 ticks`}
                  </div>
                </div>
              </div>

              {/* Request flow visualization */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Zap size={14} style={{ color: COLORS.accent }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Request Flow
                  </span>
                </div>

                {/* Flow diagram: Client → Rate Limiter → Service */}
                <div className="flex items-center justify-between py-4">
                  {/* Client */}
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center"
                      style={{ background: `${COLORS.secondary}15`, border: `1px solid ${COLORS.secondary}30` }}
                    >
                      <Activity size={18} style={{ color: COLORS.secondary }} />
                    </div>
                    <span className="text-[10px] text-[#71717a]">Client</span>
                  </div>

                  {/* Arrow with request indicator */}
                  <div className="flex-1 flex items-center justify-center px-2">
                    <AnimatePresence>
                      {lastEvent && tick - lastEvent.timestamp < 3 && (
                        <motion.div
                          key={lastEvent.id}
                          initial={{ x: -20, opacity: 0 }}
                          animate={{ x: 0, opacity: 1 }}
                          exit={{ x: 20, opacity: 0 }}
                          className="flex items-center gap-1"
                        >
                          <ArrowRight
                            size={16}
                            style={{
                              color: lastEvent.accepted
                                ? COLORS.accepted
                                : COLORS.rejected,
                            }}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Rate Limiter */}
                  <div className="flex flex-col items-center gap-1">
                    <motion.div
                      className="w-12 h-12 rounded-lg flex items-center justify-center"
                      animate={{
                        borderColor:
                          lastEvent && tick - lastEvent.timestamp < 2
                            ? lastEvent.accepted
                              ? COLORS.accepted
                              : COLORS.rejected
                            : COLORS.bucket + "30",
                        background:
                          lastEvent && tick - lastEvent.timestamp < 2
                            ? lastEvent.accepted
                              ? `${COLORS.accepted}15`
                              : `${COLORS.rejected}15`
                            : `${COLORS.bucket}15`,
                      }}
                      style={{ border: `1px solid` }}
                      transition={{ duration: 0.2 }}
                    >
                      <Shield size={18} style={{ color: COLORS.bucket }} />
                    </motion.div>
                    <span className="text-[10px] text-[#71717a]">Limiter</span>
                  </div>

                  {/* Arrow */}
                  <div className="flex-1 flex items-center justify-center px-2">
                    <AnimatePresence>
                      {lastEvent &&
                        lastEvent.accepted &&
                        tick - lastEvent.timestamp < 3 && (
                          <motion.div
                            key={`pass-${lastEvent.id}`}
                            initial={{ x: -20, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: 20, opacity: 0 }}
                          >
                            <ArrowRight
                              size={16}
                              style={{ color: COLORS.accepted }}
                            />
                          </motion.div>
                        )}
                    </AnimatePresence>
                  </div>

                  {/* Service */}
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center"
                      style={{ background: `${COLORS.success}15`, border: `1px solid ${COLORS.success}30` }}
                    >
                      <Gauge size={18} style={{ color: COLORS.success }} />
                    </div>
                    <span className="text-[10px] text-[#71717a]">Service</span>
                  </div>
                </div>

                {/* Last request status */}
                <AnimatePresence mode="wait">
                  {lastEvent && (
                    <motion.div
                      key={lastEvent.id}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center justify-center gap-2 py-2 rounded-lg"
                      style={{
                        background: lastEvent.accepted
                          ? `${COLORS.accepted}08`
                          : `${COLORS.rejected}08`,
                        border: `1px solid ${
                          lastEvent.accepted
                            ? `${COLORS.accepted}20`
                            : `${COLORS.rejected}20`
                        }`,
                      }}
                    >
                      {lastEvent.accepted ? (
                        <Check size={14} style={{ color: COLORS.accepted }} />
                      ) : (
                        <X size={14} style={{ color: COLORS.rejected }} />
                      )}
                      <span
                        className="text-xs font-medium"
                        style={{
                          color: lastEvent.accepted
                            ? COLORS.accepted
                            : COLORS.rejected,
                        }}
                      >
                        {lastEvent.label}:{" "}
                        {lastEvent.accepted ? "Accepted" : "Rejected"}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* ── Center + Right: Timeline + Event log ── */}
            <div className="lg:col-span-2 space-y-4">
              {/* Timeline view */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Clock size={14} style={{ color: COLORS.window }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Timeline (last 60 ticks)
                  </span>
                  <div className="flex items-center gap-3 ml-auto text-[10px]">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: COLORS.accepted }} />
                      <span style={{ color: COLORS.accepted }}>Accepted</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: COLORS.rejected }} />
                      <span style={{ color: COLORS.rejected }}>Rejected</span>
                    </span>
                  </div>
                </div>

                {/* Timeline bars */}
                <div className="relative h-24 rounded-lg overflow-hidden" style={{ background: COLORS.border }}>
                  {/* Window markers for fixed/sliding window */}
                  {(selectedAlgorithm === "fixed-window" ||
                    selectedAlgorithm === "sliding-window-log" ||
                    selectedAlgorithm === "sliding-window-counter") && (
                    <>
                      {Array.from({ length: 7 }, (_, i) => {
                        const windowTick =
                          Math.floor(tick / 10) * 10 - i * 10;
                        if (windowTick < tick - 60 || windowTick < 0) return null;
                        const x = ((tick - windowTick) / 60) * 100;
                        return (
                          <div
                            key={windowTick}
                            className="absolute top-0 bottom-0"
                            style={{
                              right: `${x}%`,
                              borderLeft: `1px dashed ${COLORS.window}30`,
                            }}
                          >
                            <span className="absolute top-1 left-1 text-[8px] font-mono" style={{ color: `${COLORS.window}60` }}>
                              {windowTick}
                            </span>
                          </div>
                        );
                      })}
                    </>
                  )}

                  {/* Event markers */}
                  {timelineEvents.map((event) => {
                    const age = tick - event.timestamp;
                    const x = (age / 60) * 100;
                    return (
                      <motion.div
                        key={event.id}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 - age / 80 }}
                        className="absolute"
                        style={{
                          right: `${x}%`,
                          top: event.accepted ? "20%" : "55%",
                          transform: "translate(50%, 0)",
                        }}
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{
                            background: event.accepted
                              ? COLORS.accepted
                              : COLORS.rejected,
                            boxShadow: `0 0 4px ${
                              event.accepted
                                ? COLORS.accepted
                                : COLORS.rejected
                            }40`,
                          }}
                        />
                      </motion.div>
                    );
                  })}

                  {/* Current tick indicator */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5"
                    style={{
                      right: 0,
                      background: COLORS.accent,
                      boxShadow: `0 0 8px ${COLORS.accent}`,
                    }}
                  />

                  {timelineEvents.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-[#71717a]">
                      Timeline events will appear here
                    </div>
                  )}
                </div>

                {/* Tick labels */}
                <div className="flex justify-between mt-1 text-[9px] font-mono text-[#71717a]">
                  <span>{Math.max(0, tick - 60)}</span>
                  <span>now ({tick})</span>
                </div>
              </div>

              {/* Acceptance rate bar */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 size={14} style={{ color: COLORS.success }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Acceptance Rate
                  </span>
                  <span className="text-sm font-mono font-bold ml-auto" style={{ color: COLORS.success }}>
                    {acceptanceRate}%
                  </span>
                </div>

                <div className="h-6 rounded-md overflow-hidden flex" style={{ background: COLORS.border }}>
                  {totalRequests > 0 && (
                    <>
                      <motion.div
                        className="h-full"
                        animate={{
                          width: `${(acceptedCount / totalRequests) * 100}%`,
                        }}
                        style={{ background: COLORS.accepted }}
                        transition={{ duration: 0.3 }}
                      />
                      <motion.div
                        className="h-full"
                        animate={{
                          width: `${(rejectedCount / totalRequests) * 100}%`,
                        }}
                        style={{ background: COLORS.rejected }}
                        transition={{ duration: 0.3 }}
                      />
                    </>
                  )}
                </div>
                <div className="flex justify-between mt-1 text-[10px]">
                  <span style={{ color: COLORS.accepted }}>
                    Accepted: {acceptedCount}
                  </span>
                  <span style={{ color: COLORS.rejected }}>
                    Rejected: {rejectedCount}
                  </span>
                </div>
              </div>

              {/* Event log */}
              <div
                className="rounded-xl overflow-hidden"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div
                  className="px-4 py-3 border-b flex items-center gap-2"
                  style={{ borderColor: COLORS.border }}
                >
                  <Activity size={14} style={{ color: COLORS.muted }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Event Log
                  </span>
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {events.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-[#71717a]">
                      No events yet. Press Play or Step to begin.
                    </div>
                  ) : (
                    events.slice(0, 25).map((event, i) => (
                      <motion.div
                        key={event.id}
                        initial={i === 0 ? { opacity: 0, x: -8 } : false}
                        animate={{ opacity: 1, x: 0 }}
                        className="px-4 py-2 border-b flex items-center justify-between text-xs"
                        style={{
                          borderColor: `${COLORS.border}50`,
                          background: i === 0 ? (event.accepted ? `${COLORS.accepted}05` : `${COLORS.rejected}05`) : "transparent",
                        }}
                      >
                        <div className="flex items-center gap-2">
                          {event.accepted ? (
                            <Check size={12} style={{ color: COLORS.accepted }} />
                          ) : (
                            <X size={12} style={{ color: COLORS.rejected }} />
                          )}
                          <span className="font-mono text-[#a1a1aa]">
                            {event.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[#71717a]">
                            t={event.timestamp}
                          </span>
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                            style={{
                              background: event.accepted
                                ? `${COLORS.accepted}15`
                                : `${COLORS.rejected}15`,
                              color: event.accepted
                                ? COLORS.accepted
                                : COLORS.rejected,
                            }}
                          >
                            {event.accepted ? "OK" : "DENY"}
                          </span>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              </div>
            </div>
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
              <Info size={14} style={{ color: COLORS.lime }} />
              <span className="text-sm font-semibold text-white">
                Understanding {currentAlgoInfo.label}
              </span>
            </div>

            <div className="p-5 space-y-4">
              {/* Description */}
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.secondary }}
                >
                  How It Works
                </h3>
                <p className="text-sm leading-relaxed text-[#a1a1aa]">
                  {currentAlgoInfo.description}
                </p>
              </div>

              {/* Pros and cons */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3
                    className="text-xs font-semibold uppercase tracking-wider mb-2"
                    style={{ color: COLORS.success }}
                  >
                    Advantages
                  </h3>
                  <ul className="space-y-1">
                    {currentAlgoInfo.pros.map((pro) => (
                      <li
                        key={pro}
                        className="flex items-start gap-2 text-xs text-[#a1a1aa]"
                      >
                        <Check
                          size={12}
                          className="mt-0.5 flex-shrink-0"
                          style={{ color: COLORS.success }}
                        />
                        {pro}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3
                    className="text-xs font-semibold uppercase tracking-wider mb-2"
                    style={{ color: COLORS.danger }}
                  >
                    Limitations
                  </h3>
                  <ul className="space-y-1">
                    {currentAlgoInfo.cons.map((con) => (
                      <li
                        key={con}
                        className="flex items-start gap-2 text-xs text-[#a1a1aa]"
                      >
                        <X
                          size={12}
                          className="mt-0.5 flex-shrink-0"
                          style={{ color: COLORS.danger }}
                        />
                        {con}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Key insight */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: `${COLORS.lime}05`,
                  border: `1px solid ${COLORS.lime}10`,
                }}
              >
                <div className="flex items-start gap-2">
                  <Lightbulb
                    size={16}
                    className="mt-0.5 flex-shrink-0"
                    style={{ color: COLORS.lime }}
                  />
                  <div>
                    <span className="text-xs font-semibold text-white block mb-1">
                      Key Insight
                    </span>
                    <span className="text-xs leading-relaxed text-[#a1a1aa]">
                      {selectedAlgorithm === "token-bucket"
                        ? "Token Bucket is used by AWS API Gateway, Stripe, and most cloud providers. It naturally handles bursty traffic by accumulating tokens during quiet periods. The burst capacity equals the bucket size, and the sustained rate equals the refill rate."
                        : selectedAlgorithm === "leaky-bucket"
                        ? "Leaky Bucket acts as a traffic shaper, converting bursty input into smooth output. It is used in network traffic policing (ATM networks) and NGINX uses a variation for request rate limiting. The constant output rate makes it predictable for downstream services."
                        : selectedAlgorithm === "fixed-window"
                        ? "Fixed Window's main flaw is the boundary burst problem: a user can make max requests at the end of one window and immediately make max requests at the start of the next, effectively doubling the rate. Redis INCR + EXPIRE implements this pattern efficiently."
                        : selectedAlgorithm === "sliding-window-log"
                        ? "Sliding Window Log provides the most accurate rate limiting because it tracks every request timestamp. However, it requires O(n) memory per user where n is the max requests per window. It is used when accuracy is critical, such as in financial APIs."
                        : "Sliding Window Counter combines the best of both approaches: the memory efficiency of Fixed Window (just two counters) with the smooth limiting of Sliding Window. The weighted average formula ensures no burst at window boundaries. It is used by Cloudflare for their global rate limiting."}
                    </span>
                  </div>
                </div>
              </div>

              {/* Algorithm comparison table */}
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-3"
                  style={{ color: COLORS.muted }}
                >
                  Algorithm Comparison
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr
                        className="border-b"
                        style={{ borderColor: COLORS.border }}
                      >
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>
                          Algorithm
                        </th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>
                          Memory
                        </th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>
                          Burst
                        </th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>
                          Accuracy
                        </th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>
                          Used By
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        {
                          name: "Token Bucket",
                          id: "token-bucket",
                          mem: "O(1)",
                          burst: "Yes",
                          accuracy: "Good",
                          used: "AWS, Stripe",
                        },
                        {
                          name: "Leaky Bucket",
                          id: "leaky-bucket",
                          mem: "O(1)",
                          burst: "No",
                          accuracy: "Good",
                          used: "NGINX",
                        },
                        {
                          name: "Fixed Window",
                          id: "fixed-window",
                          mem: "O(1)",
                          burst: "Edge",
                          accuracy: "Low",
                          used: "Redis",
                        },
                        {
                          name: "Sliding Log",
                          id: "sliding-window-log",
                          mem: "O(n)",
                          burst: "No",
                          accuracy: "Exact",
                          used: "Finance",
                        },
                        {
                          name: "Sliding Counter",
                          id: "sliding-window-counter",
                          mem: "O(1)",
                          burst: "No",
                          accuracy: "High",
                          used: "Cloudflare",
                        },
                      ].map((row) => (
                        <tr
                          key={row.id}
                          className="border-b cursor-pointer transition-colors"
                          style={{
                            borderColor: `${COLORS.border}50`,
                            background:
                              row.id === selectedAlgorithm
                                ? `${COLORS.primary}06`
                                : "transparent",
                          }}
                          onClick={() =>
                            handleAlgorithmChange(row.id as AlgorithmType)
                          }
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              {row.id === selectedAlgorithm && (
                                <div
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ background: COLORS.primary }}
                                />
                              )}
                              <span
                                className="font-semibold"
                                style={{
                                  color:
                                    row.id === selectedAlgorithm
                                      ? "#ffffff"
                                      : "#a1a1aa",
                                }}
                              >
                                {row.name}
                              </span>
                            </div>
                          </td>
                          <td
                            className="px-3 py-2 text-center font-mono"
                            style={{ color: COLORS.secondary }}
                          >
                            {row.mem}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span
                              style={{
                                color:
                                  row.burst === "Yes"
                                    ? COLORS.success
                                    : row.burst === "Edge"
                                    ? COLORS.accent
                                    : COLORS.muted,
                              }}
                            >
                              {row.burst}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span
                              style={{
                                color:
                                  row.accuracy === "Exact"
                                    ? COLORS.success
                                    : row.accuracy === "High"
                                    ? COLORS.secondary
                                    : row.accuracy === "Good"
                                    ? COLORS.accent
                                    : COLORS.danger,
                              }}
                            >
                              {row.accuracy}
                            </span>
                          </td>
                          <td
                            className="px-3 py-2 text-center"
                            style={{ color: "#a1a1aa" }}
                          >
                            {row.used}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Real-world */}
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.success }}
                >
                  Real-World Applications
                </h3>
                <p className="text-sm leading-relaxed text-[#a1a1aa]">
                  Rate limiting is essential in API gateways (Kong, AWS API Gateway),
                  CDNs (Cloudflare, Akamai), social media platforms (Twitter/X rate limits),
                  payment processors (Stripe), and any public-facing service. It prevents
                  abuse, ensures fair usage, protects against DDoS attacks, and helps maintain
                  service reliability under load. Most implementations use a combination of
                  algorithms at different layers: token bucket for per-user limits and
                  sliding window for global rate limiting.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
