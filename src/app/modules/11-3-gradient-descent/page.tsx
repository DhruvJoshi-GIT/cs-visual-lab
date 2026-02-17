"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingDown,
  Zap,
  Activity,
  Target,
  ChevronDown,
  Gauge,
  Mountain,
  Waves,
  CircleDot,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ───────────────────────────────────────────────────────────────────

type OptimizerType = "sgd" | "momentum" | "rmsprop" | "adam";

type LandscapeType = "bowl" | "valley" | "saddle" | "multiminima";

interface Vec2 {
  x: number;
  y: number;
}

interface OptimizerState {
  type: OptimizerType;
  pos: Vec2;
  velocity: Vec2;
  sSquared: Vec2; // RMSProp / Adam second moment
  mFirst: Vec2; // Adam first moment
  trail: Vec2[];
  loss: number;
  gradMag: number;
  step: number;
  converged: boolean;
  active: boolean;
}

interface Scenario {
  name: string;
  landscape: LandscapeType;
  optimizers: OptimizerType[];
  learningRate: number;
  startPos: Vec2;
  description: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const OPTIMIZER_CONFIG: Record<
  OptimizerType,
  { label: string; color: string; description: string }
> = {
  sgd: {
    label: "SGD",
    color: "#6366f1",
    description: "Vanilla gradient descent — simple but can oscillate",
  },
  momentum: {
    label: "SGD + Momentum",
    color: "#06b6d4",
    description: "Accumulates velocity for smoother, faster convergence",
  },
  rmsprop: {
    label: "RMSProp",
    color: "#f59e0b",
    description: "Adapts learning rate per parameter using running average of squared gradients",
  },
  adam: {
    label: "Adam",
    color: "#10b981",
    description: "Combines momentum and RMSProp — the most popular optimizer",
  },
};

const ALL_OPTIMIZERS: OptimizerType[] = ["sgd", "momentum", "rmsprop", "adam"];

const LANDSCAPE_CONFIG: Record<
  LandscapeType,
  { label: string; icon: React.ReactNode; description: string }
> = {
  bowl: {
    label: "Simple Bowl",
    icon: <Target size={14} />,
    description: "Standard quadratic — all optimizers converge easily",
  },
  valley: {
    label: "Narrow Valley",
    icon: <Waves size={14} />,
    description: "Elongated valley — SGD oscillates, momentum helps",
  },
  saddle: {
    label: "Saddle Point",
    icon: <Mountain size={14} />,
    description: "Saddle point — flat in one direction, curved in another",
  },
  multiminima: {
    label: "Multiple Minima",
    icon: <CircleDot size={14} />,
    description: "Multiple local minima — optimizers may find different solutions",
  },
};

const SCENARIOS: Scenario[] = [
  {
    name: "Simple Bowl",
    landscape: "bowl",
    optimizers: ["sgd", "momentum", "adam"],
    learningRate: 0.05,
    startPos: { x: 3.5, y: 3.5 },
    description: "Compare basic optimizers on a clean quadratic surface",
  },
  {
    name: "Narrow Valley",
    landscape: "valley",
    optimizers: ["sgd", "momentum", "rmsprop", "adam"],
    learningRate: 0.02,
    startPos: { x: 3.8, y: 0.5 },
    description: "SGD oscillates in valleys — momentum and adaptive methods shine",
  },
  {
    name: "Saddle Point",
    landscape: "saddle",
    optimizers: ["sgd", "momentum", "adam"],
    learningRate: 0.03,
    startPos: { x: 0.05, y: 0.05 },
    description: "Saddle points trap SGD — momentum helps escape",
  },
  {
    name: "Multiple Minima",
    landscape: "multiminima",
    optimizers: ["sgd", "momentum", "rmsprop", "adam"],
    learningRate: 0.04,
    startPos: { x: 3.0, y: 3.5 },
    description: "Different optimizers may converge to different local minima",
  },
];

const GRID_SIZE = 60;
const DOMAIN_MIN = -5;
const DOMAIN_MAX = 5;
const CONVERGENCE_THRESHOLD = 0.001;
const MOMENTUM_BETA = 0.9;
const RMSPROP_BETA = 0.999;
const ADAM_BETA1 = 0.9;
const ADAM_BETA2 = 0.999;
const ADAM_EPSILON = 1e-8;

// ─── Loss Functions ──────────────────────────────────────────────────────────

function lossFunction(x: number, y: number, landscape: LandscapeType): number {
  switch (landscape) {
    case "bowl":
      return 0.5 * (x * x + y * y);
    case "valley":
      return 0.5 * (10 * x * x + y * y);
    case "saddle":
      return x * x - y * y + 0.1 * (x * x + y * y) * (x * x + y * y);
    case "multiminima": {
      const base = 0.05 * (x * x + y * y);
      const sinusoidal = -Math.cos(1.5 * x) * Math.cos(1.5 * y);
      return base + sinusoidal + 2;
    }
  }
}

function gradient(x: number, y: number, landscape: LandscapeType): Vec2 {
  switch (landscape) {
    case "bowl":
      return { x: x, y: y };
    case "valley":
      return { x: 10 * x, y: y };
    case "saddle": {
      const r2 = x * x + y * y;
      return {
        x: 2 * x + 0.4 * x * r2,
        y: -2 * y + 0.4 * y * r2,
      };
    }
    case "multiminima": {
      return {
        x: 0.1 * x + 1.5 * Math.sin(1.5 * x) * Math.cos(1.5 * y),
        y: 0.1 * y + 1.5 * Math.cos(1.5 * x) * Math.sin(1.5 * y),
      };
    }
  }
}

// ─── Optimizer Step Logic ────────────────────────────────────────────────────

function optimizerStep(
  state: OptimizerState,
  landscape: LandscapeType,
  lr: number
): OptimizerState {
  if (state.converged) return state;

  const grad = gradient(state.pos.x, state.pos.y, landscape);
  const gradMag = Math.sqrt(grad.x * grad.x + grad.y * grad.y);

  if (gradMag < CONVERGENCE_THRESHOLD) {
    return { ...state, gradMag, converged: true };
  }

  let newPos: Vec2;
  let newVelocity = state.velocity;
  let newS = state.sSquared;
  let newM = state.mFirst;
  const t = state.step + 1;

  switch (state.type) {
    case "sgd": {
      newPos = {
        x: state.pos.x - lr * grad.x,
        y: state.pos.y - lr * grad.y,
      };
      break;
    }
    case "momentum": {
      newVelocity = {
        x: MOMENTUM_BETA * state.velocity.x + lr * grad.x,
        y: MOMENTUM_BETA * state.velocity.y + lr * grad.y,
      };
      newPos = {
        x: state.pos.x - newVelocity.x,
        y: state.pos.y - newVelocity.y,
      };
      break;
    }
    case "rmsprop": {
      newS = {
        x: RMSPROP_BETA * state.sSquared.x + (1 - RMSPROP_BETA) * grad.x * grad.x,
        y: RMSPROP_BETA * state.sSquared.y + (1 - RMSPROP_BETA) * grad.y * grad.y,
      };
      newPos = {
        x: state.pos.x - (lr / (Math.sqrt(newS.x) + ADAM_EPSILON)) * grad.x,
        y: state.pos.y - (lr / (Math.sqrt(newS.y) + ADAM_EPSILON)) * grad.y,
      };
      break;
    }
    case "adam": {
      newM = {
        x: ADAM_BETA1 * state.mFirst.x + (1 - ADAM_BETA1) * grad.x,
        y: ADAM_BETA1 * state.mFirst.y + (1 - ADAM_BETA1) * grad.y,
      };
      newS = {
        x: ADAM_BETA2 * state.sSquared.x + (1 - ADAM_BETA2) * grad.x * grad.x,
        y: ADAM_BETA2 * state.sSquared.y + (1 - ADAM_BETA2) * grad.y * grad.y,
      };
      const mHat = {
        x: newM.x / (1 - Math.pow(ADAM_BETA1, t)),
        y: newM.y / (1 - Math.pow(ADAM_BETA1, t)),
      };
      const sHat = {
        x: newS.x / (1 - Math.pow(ADAM_BETA2, t)),
        y: newS.y / (1 - Math.pow(ADAM_BETA2, t)),
      };
      newPos = {
        x: state.pos.x - (lr / (Math.sqrt(sHat.x) + ADAM_EPSILON)) * mHat.x,
        y: state.pos.y - (lr / (Math.sqrt(sHat.y) + ADAM_EPSILON)) * mHat.y,
      };
      break;
    }
  }

  // Clamp positions
  newPos.x = Math.max(DOMAIN_MIN, Math.min(DOMAIN_MAX, newPos.x));
  newPos.y = Math.max(DOMAIN_MIN, Math.min(DOMAIN_MAX, newPos.y));

  const newLoss = lossFunction(newPos.x, newPos.y, landscape);
  const newTrail = [...state.trail, { ...state.pos }].slice(-300);

  return {
    ...state,
    pos: newPos,
    velocity: newVelocity,
    sSquared: newS,
    mFirst: newM,
    trail: newTrail,
    loss: newLoss,
    gradMag,
    step: t,
    converged: gradMag < CONVERGENCE_THRESHOLD,
  };
}

// ─── Initialize Optimizers ───────────────────────────────────────────────────

function initOptimizer(
  type: OptimizerType,
  startPos: Vec2,
  landscape: LandscapeType
): OptimizerState {
  return {
    type,
    pos: { ...startPos },
    velocity: { x: 0, y: 0 },
    sSquared: { x: 0, y: 0 },
    mFirst: { x: 0, y: 0 },
    trail: [],
    loss: lossFunction(startPos.x, startPos.y, landscape),
    gradMag: 0,
    step: 0,
    converged: false,
    active: true,
  };
}

// ─── Color Helpers ───────────────────────────────────────────────────────────

function lossToColor(value: number, minVal: number, maxVal: number): string {
  const t = Math.max(0, Math.min(1, (value - minVal) / (maxVal - minVal + 0.001)));
  // Dark blue (low) → cyan → green → yellow → red (high)
  if (t < 0.2) {
    const s = t / 0.2;
    return `rgb(${Math.round(10 + s * 5)}, ${Math.round(12 + s * 40)}, ${Math.round(40 + s * 60)})`;
  } else if (t < 0.4) {
    const s = (t - 0.2) / 0.2;
    return `rgb(${Math.round(15 + s * 5)}, ${Math.round(52 + s * 70)}, ${Math.round(100 - s * 30)})`;
  } else if (t < 0.6) {
    const s = (t - 0.4) / 0.2;
    return `rgb(${Math.round(20 + s * 60)}, ${Math.round(122 + s * 38)}, ${Math.round(70 - s * 40)})`;
  } else if (t < 0.8) {
    const s = (t - 0.6) / 0.2;
    return `rgb(${Math.round(80 + s * 120)}, ${Math.round(160 - s * 30)}, ${Math.round(30 - s * 10)})`;
  } else {
    const s = (t - 0.8) / 0.2;
    return `rgb(${Math.round(200 + s * 45)}, ${Math.round(130 - s * 90)}, ${Math.round(20 - s * 10)})`;
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function GradientDescentPage() {
  // State
  const [landscape, setLandscape] = useState<LandscapeType>("bowl");
  const [activeOptimizers, setActiveOptimizers] = useState<OptimizerType[]>([
    "sgd",
    "momentum",
    "adam",
  ]);
  const [optimizers, setOptimizers] = useState<OptimizerState[]>([]);
  const [learningRate, setLearningRate] = useState(0.05);
  const [startPos, setStartPos] = useState<Vec2>({ x: 3.5, y: 3.5 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [selectedScenario, setSelectedScenario] = useState(0);
  const [showLandscapeDropdown, setShowLandscapeDropdown] = useState(false);
  const [showScenarioDropdown, setShowScenarioDropdown] = useState(false);
  const [hoveredOptimizer, setHoveredOptimizer] = useState<OptimizerType | null>(null);
  const [lossHistory, setLossHistory] = useState<Record<OptimizerType, number[]>>({
    sgd: [],
    momentum: [],
    rmsprop: [],
    adam: [],
  });
  const [totalSteps, setTotalSteps] = useState(0);

  // Refs for animation loop
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // Precompute loss grid for heatmap
  const lossGrid = useMemo(() => {
    const grid: number[][] = [];
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let row = 0; row < GRID_SIZE; row++) {
      grid[row] = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        const x = DOMAIN_MIN + (col / (GRID_SIZE - 1)) * (DOMAIN_MAX - DOMAIN_MIN);
        const y = DOMAIN_MIN + (row / (GRID_SIZE - 1)) * (DOMAIN_MAX - DOMAIN_MIN);
        const val = lossFunction(x, y, landscape);
        grid[row][col] = val;
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
      }
    }
    return { grid, minVal, maxVal };
  }, [landscape]);

  // Initialize optimizers
  const initAllOptimizers = useCallback(() => {
    const newOptimizers = activeOptimizers.map((type) =>
      initOptimizer(type, startPos, landscape)
    );
    setOptimizers(newOptimizers);
    setLossHistory({
      sgd: [],
      momentum: [],
      rmsprop: [],
      adam: [],
    });
    setTotalSteps(0);
    setIsPlaying(false);
  }, [activeOptimizers, startPos, landscape]);

  useEffect(() => {
    initAllOptimizers();
  }, [initAllOptimizers]);

  // Step forward function
  const stepForward = useCallback(() => {
    setOptimizers((prev) => {
      const updated = prev.map((opt) => optimizerStep(opt, landscape, learningRate));
      // Update loss history
      setLossHistory((prevHistory) => {
        const newHistory = { ...prevHistory };
        for (const opt of updated) {
          newHistory[opt.type] = [...(prevHistory[opt.type] || []).slice(-199), opt.loss];
        }
        return newHistory;
      });
      setTotalSteps((prev) => prev + 1);
      return updated;
    });
  }, [landscape, learningRate]);

  // Animation loop
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

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Handlers
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
    initAllOptimizers();
  }, [handlePause, initAllOptimizers]);

  const handleScenarioSelect = useCallback(
    (idx: number) => {
      handlePause();
      const scenario = SCENARIOS[idx];
      setSelectedScenario(idx);
      setLandscape(scenario.landscape);
      setActiveOptimizers(scenario.optimizers);
      setLearningRate(scenario.learningRate);
      setStartPos(scenario.startPos);
      setShowScenarioDropdown(false);
    },
    [handlePause]
  );

  const toggleOptimizer = useCallback(
    (type: OptimizerType) => {
      handlePause();
      setActiveOptimizers((prev) => {
        if (prev.includes(type)) {
          if (prev.length <= 1) return prev;
          return prev.filter((t) => t !== type);
        }
        return [...prev, type];
      });
    },
    [handlePause]
  );

  // Map coordinates to grid pixel positions
  const domainToGrid = useCallback((pos: Vec2): { px: number; py: number } => {
    const px =
      ((pos.x - DOMAIN_MIN) / (DOMAIN_MAX - DOMAIN_MIN)) * 100;
    const py =
      ((pos.y - DOMAIN_MIN) / (DOMAIN_MAX - DOMAIN_MIN)) * 100;
    return { px, py };
  }, []);

  // All converged?
  const allConverged = useMemo(
    () => optimizers.length > 0 && optimizers.every((o) => o.converged),
    [optimizers]
  );

  // Best optimizer (lowest loss)
  const bestOptimizer = useMemo(() => {
    if (optimizers.length === 0) return null;
    return optimizers.reduce((best, o) => (o.loss < best.loss ? o : best));
  }, [optimizers]);

  // Loss sparkline SVG path
  const buildSparkline = useCallback(
    (history: number[]): string => {
      if (history.length < 2) return "";
      const allLosses = Object.values(lossHistory).flat();
      const maxLoss = Math.max(...allLosses, 0.01);
      const w = 240;
      const h = 60;
      return history
        .map((l, i) => {
          const x = (i / (history.length - 1)) * w;
          const y = h - (Math.min(l, maxLoss) / maxLoss) * (h - 4);
          return `${i === 0 ? "M" : "L"}${x},${y}`;
        })
        .join(" ");
    },
    [lossHistory]
  );

  // Contour lines: generate iso-value outlines
  const contourLevels = useMemo(() => {
    const { minVal, maxVal } = lossGrid;
    const range = maxVal - minVal;
    const levels: number[] = [];
    const numLevels = 12;
    for (let i = 0; i <= numLevels; i++) {
      levels.push(minVal + (i / numLevels) * range);
    }
    return levels;
  }, [lossGrid]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />
      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-1 rounded-md bg-[#e879f9]/15 text-[#e879f9] text-xs font-mono font-semibold tracking-wide">
                11.3
              </span>
              <h1 className="text-2xl font-bold tracking-tight">
                Gradient Descent Variants
              </h1>
            </div>
            <p className="text-[#a1a1aa] text-sm max-w-2xl">
              Watch different optimizers navigate a loss landscape. Compare how SGD,
              Momentum, RMSProp, and Adam handle hills, valleys, and saddle points.
            </p>
          </div>

          {/* Scenario Selector */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {/* Scenario Dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowScenarioDropdown(!showScenarioDropdown);
                  setShowLandscapeDropdown(false);
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e] hover:border-[#e879f9]/40 text-sm transition-all"
              >
                <Mountain size={14} className="text-[#e879f9]" />
                <span>{SCENARIOS[selectedScenario].name}</span>
                <ChevronDown size={14} className="text-[#71717a]" />
              </button>
              <AnimatePresence>
                {showScenarioDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="absolute z-50 top-full mt-1 left-0 w-72 bg-[#111118] border border-[#1e1e2e] rounded-lg shadow-xl overflow-hidden"
                  >
                    {SCENARIOS.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleScenarioSelect(i)}
                        className={`w-full text-left px-3 py-2.5 text-sm hover:bg-[#1e1e2e] transition-colors ${
                          i === selectedScenario
                            ? "bg-[#e879f9]/10 text-[#e879f9]"
                            : "text-[#a1a1aa]"
                        }`}
                      >
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-[#71717a] mt-0.5">
                          {s.description}
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Landscape Dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowLandscapeDropdown(!showLandscapeDropdown);
                  setShowScenarioDropdown(false);
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e] hover:border-[#6366f1]/40 text-sm transition-all"
              >
                {LANDSCAPE_CONFIG[landscape].icon}
                <span>{LANDSCAPE_CONFIG[landscape].label}</span>
                <ChevronDown size={14} className="text-[#71717a]" />
              </button>
              <AnimatePresence>
                {showLandscapeDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="absolute z-50 top-full mt-1 left-0 w-64 bg-[#111118] border border-[#1e1e2e] rounded-lg shadow-xl overflow-hidden"
                  >
                    {(Object.keys(LANDSCAPE_CONFIG) as LandscapeType[]).map((lType) => (
                      <button
                        key={lType}
                        onClick={() => {
                          handlePause();
                          setLandscape(lType);
                          setShowLandscapeDropdown(false);
                        }}
                        className={`w-full text-left px-3 py-2.5 text-sm hover:bg-[#1e1e2e] transition-colors flex items-center gap-2 ${
                          landscape === lType
                            ? "bg-[#6366f1]/10 text-[#6366f1]"
                            : "text-[#a1a1aa]"
                        }`}
                      >
                        {LANDSCAPE_CONFIG[lType].icon}
                        <div>
                          <div className="font-medium">
                            {LANDSCAPE_CONFIG[lType].label}
                          </div>
                          <div className="text-xs text-[#71717a]">
                            {LANDSCAPE_CONFIG[lType].description}
                          </div>
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Learning Rate Slider */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e]">
              <Gauge size={14} className="text-[#f59e0b]" />
              <span className="text-xs text-[#71717a]">LR:</span>
              <input
                type="range"
                min={-4}
                max={-0.3}
                step={0.1}
                value={Math.log10(learningRate)}
                onChange={(e) => {
                  setLearningRate(Math.pow(10, parseFloat(e.target.value)));
                }}
                className="w-20 h-1.5 accent-[#f59e0b] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f59e0b]"
              />
              <span className="text-xs font-mono text-[#f59e0b] w-14 text-right">
                {learningRate.toFixed(4)}
              </span>
            </div>

            {/* Convergence status */}
            {allConverged && totalSteps > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20"
              >
                <div className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
                <span className="text-xs text-[#10b981] font-medium">
                  All converged
                </span>
              </motion.div>
            )}
          </div>

          {/* Optimizer Toggles */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs text-[#71717a] font-medium mr-1">
              Optimizers:
            </span>
            {ALL_OPTIMIZERS.map((type) => {
              const config = OPTIMIZER_CONFIG[type];
              const isActive = activeOptimizers.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleOptimizer(type)}
                  onMouseEnter={() => setHoveredOptimizer(type)}
                  onMouseLeave={() => setHoveredOptimizer(null)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                    isActive
                      ? "border-opacity-40"
                      : "border-[#1e1e2e] text-[#71717a] opacity-50 hover:opacity-75"
                  }`}
                  style={{
                    backgroundColor: isActive
                      ? hexToRgba(config.color, 0.1)
                      : "transparent",
                    borderColor: isActive
                      ? hexToRgba(config.color, 0.4)
                      : undefined,
                    color: isActive ? config.color : undefined,
                  }}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: config.color, opacity: isActive ? 1 : 0.3 }}
                  />
                  {config.label}
                </button>
              );
            })}
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
            {/* Visualization Area */}
            <div className="space-y-4">
              {/* Loss Landscape Heatmap */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 relative overflow-hidden">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-[#a1a1aa]">
                    Loss Landscape
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#71717a] font-mono">
                      Step: {totalSteps}
                    </span>
                  </div>
                </div>

                {/* Heatmap Grid */}
                <div className="relative w-full aspect-square max-w-[560px] mx-auto">
                  {/* Background grid cells */}
                  <div
                    className="absolute inset-0 grid"
                    style={{
                      gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
                      gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`,
                    }}
                  >
                    {lossGrid.grid.map((row, rowIdx) =>
                      row.map((val, colIdx) => (
                        <div
                          key={`${rowIdx}-${colIdx}`}
                          style={{
                            backgroundColor: lossToColor(
                              val,
                              lossGrid.minVal,
                              lossGrid.maxVal
                            ),
                          }}
                        />
                      ))
                    )}
                  </div>

                  {/* Contour lines overlay (SVG) */}
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
                    preserveAspectRatio="none"
                  >
                    {contourLevels.map((level, levelIdx) => {
                      // Simple marching squares for contour lines
                      const segments: string[] = [];
                      for (let row = 0; row < GRID_SIZE - 1; row++) {
                        for (let col = 0; col < GRID_SIZE - 1; col++) {
                          const tl = lossGrid.grid[row][col];
                          const tr = lossGrid.grid[row][col + 1];
                          const bl = lossGrid.grid[row + 1][col];
                          const br = lossGrid.grid[row + 1][col + 1];

                          const tlAbove = tl >= level ? 1 : 0;
                          const trAbove = tr >= level ? 1 : 0;
                          const blAbove = bl >= level ? 1 : 0;
                          const brAbove = br >= level ? 1 : 0;
                          const caseIdx = tlAbove * 8 + trAbove * 4 + brAbove * 2 + blAbove;

                          if (caseIdx === 0 || caseIdx === 15) continue;

                          const interp = (v1: number, v2: number) => {
                            if (Math.abs(v2 - v1) < 0.0001) return 0.5;
                            return (level - v1) / (v2 - v1);
                          };

                          const top = col + interp(tl, tr);
                          const right = row + interp(tr, br);
                          const bottom = col + interp(bl, br);
                          const left = row + interp(tl, bl);

                          const edges: [number, number, number, number][] = [];

                          switch (caseIdx) {
                            case 1:
                            case 14:
                              edges.push([bottom, row + 1, col, left]);
                              break;
                            case 2:
                            case 13:
                              edges.push([col + 1, right, bottom, row + 1]);
                              break;
                            case 3:
                            case 12:
                              edges.push([col + 1, right, col, left]);
                              break;
                            case 4:
                            case 11:
                              edges.push([top, row, col + 1, right]);
                              break;
                            case 5:
                              edges.push([top, row, col, left]);
                              edges.push([col + 1, right, bottom, row + 1]);
                              break;
                            case 6:
                            case 9:
                              edges.push([top, row, bottom, row + 1]);
                              break;
                            case 7:
                            case 8:
                              edges.push([top, row, col, left]);
                              break;
                            case 10:
                              edges.push([top, row, col + 1, right]);
                              edges.push([col, left, bottom, row + 1]);
                              break;
                          }

                          for (const [x1, y1, x2, y2] of edges) {
                            segments.push(
                              `M${x1.toFixed(2)},${y1.toFixed(2)} L${x2.toFixed(2)},${y2.toFixed(2)}`
                            );
                          }
                        }
                      }

                      if (segments.length === 0) return null;
                      return (
                        <path
                          key={levelIdx}
                          d={segments.join(" ")}
                          fill="none"
                          stroke="rgba(255,255,255,0.12)"
                          strokeWidth="0.3"
                        />
                      );
                    })}
                  </svg>

                  {/* Trails overlay (SVG) */}
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    {optimizers.map((opt) => {
                      if (opt.trail.length < 2) return null;
                      const config = OPTIMIZER_CONFIG[opt.type];
                      const pathData = opt.trail
                        .map((p, i) => {
                          const { px, py } = domainToGrid(p);
                          return `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`;
                        })
                        .join(" ");
                      // Add current position
                      const cur = domainToGrid(opt.pos);
                      const fullPath = `${pathData} L${cur.px.toFixed(2)},${cur.py.toFixed(2)}`;
                      return (
                        <g key={opt.type}>
                          <path
                            d={fullPath}
                            fill="none"
                            stroke={config.color}
                            strokeWidth="1.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity={
                              hoveredOptimizer === null ||
                              hoveredOptimizer === opt.type
                                ? 0.8
                                : 0.2
                            }
                          />
                          {/* Glow trail */}
                          <path
                            d={fullPath}
                            fill="none"
                            stroke={config.color}
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity={
                              hoveredOptimizer === null ||
                              hoveredOptimizer === opt.type
                                ? 0.15
                                : 0.03
                            }
                          />
                        </g>
                      );
                    })}
                  </svg>

                  {/* Optimizer balls overlay */}
                  <div className="absolute inset-0 pointer-events-none">
                    {optimizers.map((opt) => {
                      const config = OPTIMIZER_CONFIG[opt.type];
                      const { px, py } = domainToGrid(opt.pos);
                      const grad = gradient(opt.pos.x, opt.pos.y, landscape);
                      const gradScale = Math.min(
                        8,
                        Math.sqrt(grad.x * grad.x + grad.y * grad.y) * 3
                      );

                      return (
                        <motion.div
                          key={opt.type}
                          className="absolute"
                          style={{
                            left: `${px}%`,
                            top: `${py}%`,
                            transform: "translate(-50%, -50%)",
                          }}
                          animate={{
                            left: `${px}%`,
                            top: `${py}%`,
                          }}
                          transition={{ duration: 0.15, ease: "linear" }}
                        >
                          {/* Gradient arrow */}
                          {gradScale > 0.3 && (
                            <svg
                              className="absolute"
                              style={{
                                left: "50%",
                                top: "50%",
                                transform: "translate(-50%, -50%)",
                                width: `${gradScale * 8}px`,
                                height: `${gradScale * 8}px`,
                                overflow: "visible",
                              }}
                              viewBox="-20 -20 40 40"
                            >
                              <line
                                x1={0}
                                y1={0}
                                x2={
                                  (-grad.x /
                                    (Math.sqrt(
                                      grad.x * grad.x + grad.y * grad.y
                                    ) + 0.001)) *
                                  15
                                }
                                y2={
                                  (-grad.y /
                                    (Math.sqrt(
                                      grad.x * grad.x + grad.y * grad.y
                                    ) + 0.001)) *
                                  15
                                }
                                stroke={config.color}
                                strokeWidth="2"
                                opacity={0.6}
                                markerEnd="none"
                              />
                              {/* Arrow head */}
                              <circle
                                cx={
                                  (-grad.x /
                                    (Math.sqrt(
                                      grad.x * grad.x + grad.y * grad.y
                                    ) + 0.001)) *
                                  15
                                }
                                cy={
                                  (-grad.y /
                                    (Math.sqrt(
                                      grad.x * grad.x + grad.y * grad.y
                                    ) + 0.001)) *
                                  15
                                }
                                r="2"
                                fill={config.color}
                                opacity={0.6}
                              />
                            </svg>
                          )}

                          {/* Momentum vector for momentum/adam */}
                          {(opt.type === "momentum" || opt.type === "adam") &&
                            (Math.abs(opt.velocity.x) > 0.001 ||
                              Math.abs(opt.velocity.y) > 0.001) && (
                              <svg
                                className="absolute"
                                style={{
                                  left: "50%",
                                  top: "50%",
                                  transform: "translate(-50%, -50%)",
                                  width: "60px",
                                  height: "60px",
                                  overflow: "visible",
                                }}
                                viewBox="-20 -20 40 40"
                              >
                                <line
                                  x1={0}
                                  y1={0}
                                  x2={Math.max(-15, Math.min(15, -opt.velocity.x * 40))}
                                  y2={Math.max(-15, Math.min(15, -opt.velocity.y * 40))}
                                  stroke="#e879f9"
                                  strokeWidth="1.5"
                                  strokeDasharray="3,2"
                                  opacity={0.5}
                                />
                              </svg>
                            )}

                          {/* Ball */}
                          <div
                            className="w-4 h-4 rounded-full border-2"
                            style={{
                              backgroundColor: config.color,
                              borderColor: "white",
                              boxShadow: `0 0 12px ${hexToRgba(config.color, 0.7)}, 0 0 24px ${hexToRgba(config.color, 0.3)}`,
                              opacity:
                                hoveredOptimizer === null ||
                                hoveredOptimizer === opt.type
                                  ? 1
                                  : 0.3,
                            }}
                          />

                          {/* Label */}
                          <div
                            className="absolute whitespace-nowrap text-[9px] font-bold tracking-wide"
                            style={{
                              top: "-18px",
                              left: "50%",
                              transform: "translateX(-50%)",
                              color: config.color,
                              textShadow: `0 0 8px ${hexToRgba(config.color, 0.5)}`,
                              opacity:
                                hoveredOptimizer === null ||
                                hoveredOptimizer === opt.type
                                  ? 1
                                  : 0.3,
                            }}
                          >
                            {config.label}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>

                  {/* Axis labels */}
                  <div className="absolute -bottom-5 left-0 right-0 flex justify-between text-[10px] text-[#71717a] font-mono">
                    <span>{DOMAIN_MIN}</span>
                    <span>x</span>
                    <span>{DOMAIN_MAX}</span>
                  </div>
                  <div className="absolute -left-5 top-0 bottom-0 flex flex-col justify-between text-[10px] text-[#71717a] font-mono">
                    <span>{DOMAIN_MIN}</span>
                    <span className="-rotate-90">y</span>
                    <span>{DOMAIN_MAX}</span>
                  </div>
                </div>

                {/* Color legend */}
                <div className="mt-8 flex items-center gap-2">
                  <span className="text-[10px] text-[#71717a]">Low loss</span>
                  <div className="flex h-3 rounded overflow-hidden flex-1 max-w-[200px]">
                    {Array.from({ length: 20 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex-1"
                        style={{
                          backgroundColor: lossToColor(
                            lossGrid.minVal +
                              (i / 19) * (lossGrid.maxVal - lossGrid.minVal),
                            lossGrid.minVal,
                            lossGrid.maxVal
                          ),
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] text-[#71717a]">High loss</span>
                </div>
              </div>

              {/* Loss History Chart */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3">
                  Loss Over Time
                </h3>
                <div className="relative">
                  <svg
                    viewBox="0 0 240 60"
                    className="w-full h-auto"
                    style={{ minHeight: 60 }}
                    preserveAspectRatio="none"
                  >
                    {/* Grid lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
                      <line
                        key={frac}
                        x1={0}
                        y1={frac * 60}
                        x2={240}
                        y2={frac * 60}
                        stroke="#1e1e2e"
                        strokeWidth="0.5"
                      />
                    ))}
                    {/* Loss curves */}
                    {optimizers.map((opt) => {
                      const history = lossHistory[opt.type];
                      if (!history || history.length < 2) return null;
                      const config = OPTIMIZER_CONFIG[opt.type];
                      const path = buildSparkline(history);
                      return (
                        <g key={opt.type}>
                          <path
                            d={path}
                            fill="none"
                            stroke={config.color}
                            strokeWidth="1.5"
                            opacity={
                              hoveredOptimizer === null ||
                              hoveredOptimizer === opt.type
                                ? 0.9
                                : 0.2
                            }
                          />
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {/* Legend */}
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  {optimizers.map((opt) => {
                    const config = OPTIMIZER_CONFIG[opt.type];
                    return (
                      <div
                        key={opt.type}
                        className="flex items-center gap-1.5 cursor-pointer"
                        onMouseEnter={() => setHoveredOptimizer(opt.type)}
                        onMouseLeave={() => setHoveredOptimizer(null)}
                      >
                        <div
                          className="w-3 h-0.5 rounded"
                          style={{ backgroundColor: config.color }}
                        />
                        <span
                          className="text-[10px] font-medium"
                          style={{ color: config.color }}
                        >
                          {config.label}: {opt.loss.toFixed(4)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Controls */}
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
            </div>

            {/* Right Sidebar */}
            <div className="space-y-4">
              {/* Optimizer Details */}
              <AnimatePresence>
                {showMetrics && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-3"
                  >
                    {optimizers.map((opt) => {
                      const config = OPTIMIZER_CONFIG[opt.type];
                      const grad = gradient(opt.pos.x, opt.pos.y, landscape);
                      const effLr =
                        opt.type === "rmsprop" || opt.type === "adam"
                          ? learningRate /
                            (Math.sqrt(
                              Math.max(opt.sSquared.x, opt.sSquared.y)
                            ) +
                              ADAM_EPSILON)
                          : learningRate;

                      return (
                        <motion.div
                          key={opt.type}
                          className="bg-[#111118] border rounded-xl p-3 transition-all"
                          style={{
                            borderColor:
                              hoveredOptimizer === opt.type
                                ? hexToRgba(config.color, 0.5)
                                : "#1e1e2e",
                          }}
                          onMouseEnter={() => setHoveredOptimizer(opt.type)}
                          onMouseLeave={() => setHoveredOptimizer(null)}
                          layout
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{
                                backgroundColor: config.color,
                                boxShadow: `0 0 8px ${hexToRgba(config.color, 0.5)}`,
                              }}
                            />
                            <span
                              className="text-sm font-semibold"
                              style={{ color: config.color }}
                            >
                              {config.label}
                            </span>
                            {opt.converged && (
                              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[#10b981]/15 text-[#10b981] font-medium">
                                Converged
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                            <div>
                              <div className="text-[10px] text-[#71717a]">
                                Position
                              </div>
                              <div className="text-xs font-mono text-[#a1a1aa]">
                                ({opt.pos.x.toFixed(3)}, {opt.pos.y.toFixed(3)})
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-[#71717a]">
                                Loss
                              </div>
                              <div className="text-xs font-mono text-[#a1a1aa]">
                                {opt.loss.toFixed(6)}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-[#71717a]">
                                |Gradient|
                              </div>
                              <div className="text-xs font-mono text-[#a1a1aa]">
                                {opt.gradMag.toFixed(6)}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-[#71717a]">
                                Steps
                              </div>
                              <div className="text-xs font-mono text-[#a1a1aa]">
                                {opt.step}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-[#71717a]">
                                Effective LR
                              </div>
                              <div className="text-xs font-mono text-[#a1a1aa]">
                                {effLr.toFixed(6)}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-[#71717a]">
                                Gradient
                              </div>
                              <div className="text-xs font-mono text-[#a1a1aa]">
                                ({grad.x.toFixed(3)}, {grad.y.toFixed(3)})
                              </div>
                            </div>

                            {/* Momentum-specific */}
                            {(opt.type === "momentum" || opt.type === "adam") && (
                              <div className="col-span-2">
                                <div className="text-[10px] text-[#71717a]">
                                  Velocity
                                </div>
                                <div className="text-xs font-mono text-[#a1a1aa]">
                                  ({opt.velocity.x.toFixed(4)},{" "}
                                  {opt.velocity.y.toFixed(4)})
                                </div>
                              </div>
                            )}

                            {/* RMSProp/Adam-specific */}
                            {(opt.type === "rmsprop" || opt.type === "adam") && (
                              <div className="col-span-2">
                                <div className="text-[10px] text-[#71717a]">
                                  Sq. Gradient Avg
                                </div>
                                <div className="text-xs font-mono text-[#a1a1aa]">
                                  ({opt.sSquared.x.toFixed(6)},{" "}
                                  {opt.sSquared.y.toFixed(6)})
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Mini loss bar */}
                          <div className="mt-2">
                            <div className="h-1 bg-[#1e1e2e] rounded-full overflow-hidden">
                              <motion.div
                                className="h-full rounded-full"
                                style={{ backgroundColor: config.color }}
                                animate={{
                                  width: `${Math.max(2, 100 - Math.min(100, opt.loss * 10))}%`,
                                }}
                                transition={{ duration: 0.3 }}
                              />
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Summary Metrics */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-3">
                <h3 className="text-xs font-semibold text-[#71717a] mb-2 uppercase tracking-wider">
                  Summary
                </h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-[#71717a]">Total Steps</span>
                    <span className="text-xs font-mono text-white">
                      {totalSteps}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-[#71717a]">Learning Rate</span>
                    <span className="text-xs font-mono text-[#f59e0b]">
                      {learningRate.toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-[#71717a]">Landscape</span>
                    <span className="text-xs font-mono text-[#e879f9]">
                      {LANDSCAPE_CONFIG[landscape].label}
                    </span>
                  </div>
                  {bestOptimizer && totalSteps > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#71717a]">Best Loss</span>
                      <span
                        className="text-xs font-mono"
                        style={{
                          color: OPTIMIZER_CONFIG[bestOptimizer.type].color,
                        }}
                      >
                        {bestOptimizer.loss.toFixed(6)} (
                        {OPTIMIZER_CONFIG[bestOptimizer.type].label})
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-[#71717a]">Converged</span>
                    <span className="text-xs font-mono text-white">
                      {optimizers.filter((o) => o.converged).length}/
                      {optimizers.length}
                    </span>
                  </div>
                </div>
              </div>

              {/* Optimizer Descriptions Info */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-3">
                <h3 className="text-xs font-semibold text-[#71717a] mb-2 uppercase tracking-wider">
                  How It Works
                </h3>
                <div className="space-y-2">
                  {optimizers.map((opt) => {
                    const config = OPTIMIZER_CONFIG[opt.type];
                    return (
                      <div
                        key={opt.type}
                        className="text-[11px] text-[#71717a] leading-relaxed"
                        onMouseEnter={() => setHoveredOptimizer(opt.type)}
                        onMouseLeave={() => setHoveredOptimizer(null)}
                      >
                        <span
                          className="font-semibold"
                          style={{ color: config.color }}
                        >
                          {config.label}:
                        </span>{" "}
                        {config.description}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Update Rules */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-3">
                <h3 className="text-xs font-semibold text-[#71717a] mb-2 uppercase tracking-wider">
                  Update Rules
                </h3>
                <div className="space-y-2 font-mono text-[10px] text-[#a1a1aa]">
                  {activeOptimizers.includes("sgd") && (
                    <div>
                      <span className="text-[#6366f1]">SGD:</span>{" "}
                      <span className="text-[#71717a]">
                        w = w - lr * grad
                      </span>
                    </div>
                  )}
                  {activeOptimizers.includes("momentum") && (
                    <div>
                      <span className="text-[#06b6d4]">Momentum:</span>{" "}
                      <span className="text-[#71717a]">
                        v = beta*v + lr*grad; w = w - v
                      </span>
                    </div>
                  )}
                  {activeOptimizers.includes("rmsprop") && (
                    <div>
                      <span className="text-[#f59e0b]">RMSProp:</span>{" "}
                      <span className="text-[#71717a]">
                        s = beta*s + (1-beta)*grad^2; w -= lr*grad/sqrt(s)
                      </span>
                    </div>
                  )}
                  {activeOptimizers.includes("adam") && (
                    <div>
                      <span className="text-[#10b981]">Adam:</span>{" "}
                      <span className="text-[#71717a]">
                        m = b1*m + (1-b1)*g; v = b2*v + (1-b2)*g^2; w -= lr*m_hat/sqrt(v_hat)
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Start Position */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-3">
                <h3 className="text-xs font-semibold text-[#71717a] mb-2 uppercase tracking-wider">
                  Start Position
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#71717a] w-6">X:</span>
                    <input
                      type="range"
                      min={DOMAIN_MIN}
                      max={DOMAIN_MAX}
                      step={0.1}
                      value={startPos.x}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setStartPos((prev) => ({ ...prev, x: val }));
                      }}
                      className="flex-1 h-1.5 accent-[#e879f9] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#e879f9]"
                    />
                    <span className="text-xs font-mono text-[#a1a1aa] w-10 text-right">
                      {startPos.x.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#71717a] w-6">Y:</span>
                    <input
                      type="range"
                      min={DOMAIN_MIN}
                      max={DOMAIN_MAX}
                      step={0.1}
                      value={startPos.y}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setStartPos((prev) => ({ ...prev, y: val }));
                      }}
                      className="flex-1 h-1.5 accent-[#e879f9] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#e879f9]"
                    />
                    <span className="text-xs font-mono text-[#a1a1aa] w-10 text-right">
                      {startPos.y.toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Info Section */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[#6366f1]/15 flex items-center justify-center">
                  <TrendingDown size={16} className="text-[#6366f1]" />
                </div>
                <h4 className="text-sm font-semibold">SGD</h4>
              </div>
              <p className="text-xs text-[#71717a] leading-relaxed">
                Stochastic Gradient Descent updates parameters directly proportional
                to the gradient. Simple but can oscillate in narrow valleys and get
                stuck at saddle points.
              </p>
            </div>

            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[#06b6d4]/15 flex items-center justify-center">
                  <Zap size={16} className="text-[#06b6d4]" />
                </div>
                <h4 className="text-sm font-semibold">Momentum</h4>
              </div>
              <p className="text-xs text-[#71717a] leading-relaxed">
                Adds a velocity term that accumulates past gradients. This smooths
                oscillations and helps accelerate through flat regions and narrow
                valleys.
              </p>
            </div>

            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[#f59e0b]/15 flex items-center justify-center">
                  <Activity size={16} className="text-[#f59e0b]" />
                </div>
                <h4 className="text-sm font-semibold">RMSProp</h4>
              </div>
              <p className="text-xs text-[#71717a] leading-relaxed">
                Adapts the learning rate for each parameter using a running average
                of squared gradients. Parameters with large gradients get smaller
                effective learning rates.
              </p>
            </div>

            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[#10b981]/15 flex items-center justify-center">
                  <Target size={16} className="text-[#10b981]" />
                </div>
                <h4 className="text-sm font-semibold">Adam</h4>
              </div>
              <p className="text-xs text-[#71717a] leading-relaxed">
                Combines momentum (first moment) and RMSProp (second moment) with
                bias correction. The most widely used optimizer in modern deep
                learning.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
