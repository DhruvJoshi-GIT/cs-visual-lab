"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  ChevronDown,
  Activity,
  Target,
  TrendingDown,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ──────────────────────────────────────────────────────────────────

type ScenarioName = "and" | "or" | "xor" | "custom";

type ActivationFn = "step" | "sigmoid" | "relu";

interface DataPoint {
  x1: number;
  x2: number;
  label: number; // 0 or 1
  predicted?: number;
  correct?: boolean;
}

interface PerceptronState {
  w1: number;
  w2: number;
  bias: number;
  learningRate: number;
}

interface TrainingStep {
  point: DataPoint;
  output: number;
  error: number;
  deltaW1: number;
  deltaW2: number;
  deltaBias: number;
  preActivation: number;
}

interface SimState {
  perceptron: PerceptronState;
  data: DataPoint[];
  epoch: number;
  sampleIdx: number;
  totalSteps: number;
  lossHistory: number[];
  accuracyHistory: number[];
  currentStep: TrainingStep | null;
  converged: boolean;
}

interface ScenarioConfig {
  name: string;
  label: string;
  description: string;
  data: DataPoint[];
  solvable: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SCENARIOS: Record<ScenarioName, ScenarioConfig> = {
  and: {
    name: "and",
    label: "AND Gate",
    description:
      "Linearly separable: only (1,1) outputs 1. The perceptron can learn a line separating the classes.",
    data: [
      { x1: 0, x2: 0, label: 0 },
      { x1: 0, x2: 1, label: 0 },
      { x1: 1, x2: 0, label: 0 },
      { x1: 1, x2: 1, label: 1 },
    ],
    solvable: true,
  },
  or: {
    name: "or",
    label: "OR Gate",
    description:
      "Linearly separable: only (0,0) outputs 0. A single line can separate the two classes.",
    data: [
      { x1: 0, x2: 0, label: 0 },
      { x1: 0, x2: 1, label: 1 },
      { x1: 1, x2: 0, label: 1 },
      { x1: 1, x2: 1, label: 1 },
    ],
    solvable: true,
  },
  xor: {
    name: "xor",
    label: "XOR (Impossible)",
    description:
      "NOT linearly separable: no single line can separate (0,0),(1,1) from (0,1),(1,0). This is the famous limitation of single perceptrons, proven by Minsky & Papert (1969).",
    data: [
      { x1: 0, x2: 0, label: 0 },
      { x1: 0, x2: 1, label: 1 },
      { x1: 1, x2: 0, label: 1 },
      { x1: 1, x2: 1, label: 0 },
    ],
    solvable: false,
  },
  custom: {
    name: "custom",
    label: "Custom Points",
    description:
      "Click on the 2D plane to add your own data points. Left-click for class 0 (indigo), right-click or shift-click for class 1 (rose).",
    data: [],
    solvable: true,
  },
};

const PLOT_SIZE = 400;
const PLOT_PADDING = 40;
const PLOT_RANGE = { min: -0.5, max: 1.5 }; // data range for gate problems

// ─── Activation Functions ───────────────────────────────────────────────────

function activate(z: number, fn: ActivationFn): number {
  switch (fn) {
    case "step":
      return z >= 0 ? 1 : 0;
    case "sigmoid":
      return 1 / (1 + Math.exp(-clamp(z, -500, 500)));
    case "relu":
      return Math.max(0, z);
  }
}

function activateDerivative(z: number, output: number, fn: ActivationFn): number {
  switch (fn) {
    case "step":
      return 1; // Perceptron learning rule uses error directly
    case "sigmoid": {
      const s = activate(z, "sigmoid");
      return s * (1 - s);
    }
    case "relu":
      return z > 0 ? 1 : 0;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── Perceptron Engine ──────────────────────────────────────────────────────

function initPerceptron(lr: number): PerceptronState {
  return {
    w1: (Math.random() - 0.5) * 0.5,
    w2: (Math.random() - 0.5) * 0.5,
    bias: (Math.random() - 0.5) * 0.5,
    learningRate: lr,
  };
}

function predict(
  p: PerceptronState,
  x1: number,
  x2: number,
  fn: ActivationFn
): { output: number; preActivation: number } {
  const z = p.w1 * x1 + p.w2 * x2 + p.bias;
  const output = activate(z, fn);
  return { output, preActivation: z };
}

function trainStep(
  p: PerceptronState,
  point: DataPoint,
  fn: ActivationFn
): { newState: PerceptronState; step: TrainingStep } {
  const { output, preActivation } = predict(p, point.x1, point.x2, fn);

  // For step function: use perceptron learning rule (error = target - output)
  // For sigmoid/relu: use gradient-based update
  const error = point.label - output;

  let deriv: number;
  if (fn === "step") {
    deriv = 1; // Perceptron rule
  } else {
    deriv = activateDerivative(preActivation, output, fn);
  }

  const deltaW1 = p.learningRate * error * deriv * point.x1;
  const deltaW2 = p.learningRate * error * deriv * point.x2;
  const deltaBias = p.learningRate * error * deriv;

  const newState: PerceptronState = {
    ...p,
    w1: p.w1 + deltaW1,
    w2: p.w2 + deltaW2,
    bias: p.bias + deltaBias,
  };

  const step: TrainingStep = {
    point,
    output,
    error,
    deltaW1,
    deltaW2,
    deltaBias,
    preActivation,
  };

  return { newState, step };
}

function computeAccuracy(
  p: PerceptronState,
  data: DataPoint[],
  fn: ActivationFn
): number {
  if (data.length === 0) return 0;
  let correct = 0;
  for (const d of data) {
    const { output } = predict(p, d.x1, d.x2, fn);
    const predicted = fn === "step" ? output : output >= 0.5 ? 1 : 0;
    if (predicted === d.label) correct++;
  }
  return correct / data.length;
}

function computeLoss(
  p: PerceptronState,
  data: DataPoint[],
  fn: ActivationFn
): number {
  if (data.length === 0) return 0;
  let totalLoss = 0;
  for (const d of data) {
    const { output } = predict(p, d.x1, d.x2, fn);
    const diff = d.label - output;
    totalLoss += diff * diff;
  }
  return totalLoss / data.length;
}

function classifyAllPoints(
  p: PerceptronState,
  data: DataPoint[],
  fn: ActivationFn
): DataPoint[] {
  return data.map((d) => {
    const { output } = predict(p, d.x1, d.x2, fn);
    const predicted = fn === "step" ? output : output >= 0.5 ? 1 : 0;
    return { ...d, predicted, correct: predicted === d.label };
  });
}

// ─── Init Simulation ────────────────────────────────────────────────────────

function initSimState(
  scenario: ScenarioName,
  lr: number,
  activationFn: ActivationFn
): SimState {
  const config = SCENARIOS[scenario];
  const perceptron = initPerceptron(lr);
  const data = config.data.map((d) => ({ ...d }));

  return {
    perceptron,
    data,
    epoch: 0,
    sampleIdx: 0,
    totalSteps: 0,
    lossHistory: [],
    accuracyHistory: [],
    currentStep: null,
    converged: false,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function PerceptronPage() {
  const [scenario, setScenario] = useState<ScenarioName>("and");
  const [activationFn, setActivationFn] = useState<ActivationFn>("step");
  const [learningRate, setLearningRate] = useState(0.1);
  const [simState, setSimState] = useState<SimState>(() =>
    initSimState("and", 0.1, "step")
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const activationFnRef = useRef(activationFn);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    activationFnRef.current = activationFn;
  }, [activationFn]);

  const config = SCENARIOS[scenario];

  const stepForward = useCallback(() => {
    setSimState((prev) => {
      if (prev.data.length === 0) return prev;
      if (prev.converged) return prev;

      const fn = activationFnRef.current;
      const point = prev.data[prev.sampleIdx % prev.data.length];
      const { newState, step } = trainStep(prev.perceptron, point, fn);

      const nextSampleIdx = (prev.sampleIdx + 1) % prev.data.length;
      const newEpoch =
        nextSampleIdx === 0 ? prev.epoch + 1 : prev.epoch;

      const loss = computeLoss(newState, prev.data, fn);
      const accuracy = computeAccuracy(newState, prev.data, fn);

      // Check convergence (accuracy = 100% for 2 consecutive epochs)
      const isConverged =
        accuracy === 1.0 &&
        prev.accuracyHistory.length > 0 &&
        prev.accuracyHistory[prev.accuracyHistory.length - 1] === 1.0;

      return {
        ...prev,
        perceptron: newState,
        sampleIdx: nextSampleIdx,
        epoch: newEpoch,
        totalSteps: prev.totalSteps + 1,
        lossHistory:
          nextSampleIdx === 0
            ? [...prev.lossHistory.slice(-99), loss]
            : prev.lossHistory,
        accuracyHistory:
          nextSampleIdx === 0
            ? [...prev.accuracyHistory.slice(-99), accuracy]
            : prev.accuracyHistory,
        currentStep: step,
        converged: isConverged,
      };
    });
  }, []);

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

  // Auto-pause when converged
  useEffect(() => {
    if (simState.converged && isPlaying) {
      setIsPlaying(false);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
  }, [simState.converged, isPlaying]);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
  }, []);

  const handleStep = useCallback(() => {
    if (isPlaying) return;
    stepForward();
  }, [isPlaying, stepForward]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    setSimState(initSimState(scenario, learningRate, activationFn));
  }, [scenario, learningRate, activationFn]);

  const handleScenarioChange = useCallback(
    (s: ScenarioName) => {
      setIsPlaying(false);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      setScenario(s);
      setSimState(initSimState(s, learningRate, activationFn));
      setDropdownOpen(false);
    },
    [learningRate, activationFn]
  );

  const handleActivationChange = useCallback(
    (fn: ActivationFn) => {
      setActivationFn(fn);
      setIsPlaying(false);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      setSimState(initSimState(scenario, learningRate, fn));
    },
    [scenario, learningRate]
  );

  // Add custom point by clicking
  const handlePlotClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (scenario !== "custom") return;
      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * PLOT_SIZE;
      const svgY = ((e.clientY - rect.top) / rect.height) * PLOT_SIZE;

      // Convert SVG coords to data coords
      const range = PLOT_RANGE.max - PLOT_RANGE.min;
      const x1 =
        ((svgX - PLOT_PADDING) / (PLOT_SIZE - 2 * PLOT_PADDING)) * range +
        PLOT_RANGE.min;
      const x2 =
        ((PLOT_SIZE - PLOT_PADDING - svgY) / (PLOT_SIZE - 2 * PLOT_PADDING)) *
          range +
        PLOT_RANGE.min;

      if (
        x1 < PLOT_RANGE.min ||
        x1 > PLOT_RANGE.max ||
        x2 < PLOT_RANGE.min ||
        x2 > PLOT_RANGE.max
      )
        return;

      const label = e.shiftKey ? 1 : 0;

      setSimState((prev) => ({
        ...prev,
        data: [
          ...prev.data,
          { x1: parseFloat(x1.toFixed(2)), x2: parseFloat(x2.toFixed(2)), label },
        ],
        converged: false,
      }));
    },
    [scenario]
  );

  const handlePlotRightClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      e.preventDefault();
      if (scenario !== "custom") return;
      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * PLOT_SIZE;
      const svgY = ((e.clientY - rect.top) / rect.height) * PLOT_SIZE;

      const range = PLOT_RANGE.max - PLOT_RANGE.min;
      const x1 =
        ((svgX - PLOT_PADDING) / (PLOT_SIZE - 2 * PLOT_PADDING)) * range +
        PLOT_RANGE.min;
      const x2 =
        ((PLOT_SIZE - PLOT_PADDING - svgY) / (PLOT_SIZE - 2 * PLOT_PADDING)) *
          range +
        PLOT_RANGE.min;

      if (
        x1 < PLOT_RANGE.min ||
        x1 > PLOT_RANGE.max ||
        x2 < PLOT_RANGE.min ||
        x2 > PLOT_RANGE.max
      )
        return;

      setSimState((prev) => ({
        ...prev,
        data: [
          ...prev.data,
          { x1: parseFloat(x1.toFixed(2)), x2: parseFloat(x2.toFixed(2)), label: 1 },
        ],
        converged: false,
      }));
    },
    [scenario]
  );

  // Coordinate transforms
  const dataToSvg = useCallback((x1: number, x2: number) => {
    const range = PLOT_RANGE.max - PLOT_RANGE.min;
    const sx =
      PLOT_PADDING +
      ((x1 - PLOT_RANGE.min) / range) * (PLOT_SIZE - 2 * PLOT_PADDING);
    const sy =
      PLOT_SIZE -
      PLOT_PADDING -
      ((x2 - PLOT_RANGE.min) / range) * (PLOT_SIZE - 2 * PLOT_PADDING);
    return { sx, sy };
  }, []);

  // Decision boundary line
  const decisionLine = useMemo(() => {
    const { w1, w2, bias } = simState.perceptron;
    if (Math.abs(w2) < 1e-8 && Math.abs(w1) < 1e-8) return null;

    // Decision boundary: w1*x1 + w2*x2 + bias = 0
    // => x2 = -(w1*x1 + bias) / w2
    const points: { x1: number; x2: number }[] = [];

    if (Math.abs(w2) > 1e-8) {
      // Standard case: solve for x2 given x1
      const x1Start = PLOT_RANGE.min - 0.5;
      const x1End = PLOT_RANGE.max + 0.5;
      const x2Start = -(w1 * x1Start + bias) / w2;
      const x2End = -(w1 * x1End + bias) / w2;
      points.push({ x1: x1Start, x2: x2Start });
      points.push({ x1: x1End, x2: x2End });
    } else {
      // Vertical line: x1 = -bias / w1
      const x1Val = -bias / w1;
      points.push({ x1: x1Val, x2: PLOT_RANGE.min - 0.5 });
      points.push({ x1: x1Val, x2: PLOT_RANGE.max + 0.5 });
    }

    const p1 = dataToSvg(points[0].x1, points[0].x2);
    const p2 = dataToSvg(points[1].x1, points[1].x2);

    return { x1: p1.sx, y1: p1.sy, x2: p2.sx, y2: p2.sy };
  }, [simState.perceptron, dataToSvg]);

  // Classified data points
  const classifiedData = useMemo(() => {
    return classifyAllPoints(simState.perceptron, simState.data, activationFn);
  }, [simState.perceptron, simState.data, activationFn]);

  // Accuracy and Loss
  const currentAccuracy = useMemo(() => {
    return computeAccuracy(simState.perceptron, simState.data, activationFn);
  }, [simState.perceptron, simState.data, activationFn]);

  const currentLoss = useMemo(() => {
    return computeLoss(simState.perceptron, simState.data, activationFn);
  }, [simState.perceptron, simState.data, activationFn]);

  // Loss sparkline
  const lossSparkline = useMemo(() => {
    if (simState.lossHistory.length < 2) return "";
    const maxLoss = Math.max(...simState.lossHistory, 0.01);
    const w = 260;
    const h = 70;
    const points = simState.lossHistory.map((l, i) => {
      const x = (i / (simState.lossHistory.length - 1)) * w;
      const y = h - (l / maxLoss) * (h - 8);
      return `${x},${y}`;
    });
    return points.join(" ");
  }, [simState.lossHistory]);

  const lossAreaPath = useMemo(() => {
    if (simState.lossHistory.length < 2) return "";
    const maxLoss = Math.max(...simState.lossHistory, 0.01);
    const w = 260;
    const h = 70;
    const points = simState.lossHistory.map((l, i) => {
      const x = (i / (simState.lossHistory.length - 1)) * w;
      const y = h - (l / maxLoss) * (h - 8);
      return `${x},${y}`;
    });
    return `M0,${h} L${points.join(" L")} L${w},${h} Z`;
  }, [simState.lossHistory]);

  // Activation function graph data
  const activationCurve = useMemo(() => {
    const points: string[] = [];
    const w = 120;
    const h = 60;
    for (let i = 0; i <= 50; i++) {
      const z = ((i / 50) * 10 - 5);
      const val = activate(z, activationFn);
      const x = (i / 50) * w;
      const y = h - clamp(val, -0.1, 1.1) * (h - 4) - 2;
      points.push(`${x},${y}`);
    }
    return points.join(" ");
  }, [activationFn]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />
      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-1 rounded-md bg-[#e879f9]/15 text-[#e879f9] text-xs font-mono font-semibold tracking-wide">
                11.1
              </span>
              <h1 className="text-2xl font-bold tracking-tight">
                Perceptron & Linear Models
              </h1>
            </div>
            <p className="text-[#a1a1aa] text-sm max-w-2xl">
              Watch a single perceptron learn a decision boundary. Two inputs
              connect through weighted edges to a summation node and activation
              function. See how the decision line shifts as weights update.
            </p>
          </div>

          {/* Scenario Selector + Activation + LR */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {/* Scenario dropdown */}
            <div className="relative inline-block">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e] hover:border-[#e879f9]/40 transition-all text-sm"
              >
                <Zap size={14} className="text-[#e879f9]" />
                <span className="text-white font-medium">{config.label}</span>
                <ChevronDown
                  size={14}
                  className={`text-[#71717a] transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                />
              </button>
              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute z-50 mt-1 w-72 bg-[#111118] border border-[#1e1e2e] rounded-lg shadow-xl overflow-hidden"
                  >
                    {(Object.keys(SCENARIOS) as ScenarioName[]).map((s) => {
                      const sc = SCENARIOS[s];
                      return (
                        <button
                          key={s}
                          onClick={() => handleScenarioChange(s)}
                          className={`w-full text-left px-4 py-3 hover:bg-[#1e1e2e] transition-colors ${
                            s === scenario ? "bg-[#e879f9]/10" : ""
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-white">
                              {sc.label}
                            </div>
                            {!sc.solvable && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#ef4444]/15 text-[#ef4444]">
                                unsolvable
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[#71717a] mt-0.5">
                            {sc.description.slice(0, 80)}...
                          </div>
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Activation selector */}
            <div className="flex items-center gap-1 bg-[#111118] border border-[#1e1e2e] rounded-lg p-1">
              {(["step", "sigmoid", "relu"] as ActivationFn[]).map((fn) => (
                <button
                  key={fn}
                  onClick={() => handleActivationChange(fn)}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono transition-all ${
                    activationFn === fn
                      ? "bg-[#e879f9]/15 text-[#e879f9] border border-[#e879f9]/30"
                      : "text-[#71717a] hover:text-white border border-transparent"
                  }`}
                >
                  {fn}
                </button>
              ))}
            </div>

            {/* Learning rate */}
            <div className="flex items-center gap-2 bg-[#111118] border border-[#1e1e2e] rounded-lg px-3 py-1.5">
              <span className="text-[10px] text-[#71717a] font-mono">LR:</span>
              <input
                type="range"
                min={-3}
                max={0}
                step={0.1}
                value={Math.log10(learningRate)}
                onChange={(e) => {
                  const lr = Math.pow(10, parseFloat(e.target.value));
                  setLearningRate(lr);
                }}
                className="w-20 h-1.5 accent-[#e879f9] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#e879f9]"
              />
              <span className="text-xs text-[#e879f9] font-mono w-12">
                {learningRate.toFixed(3)}
              </span>
            </div>
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 mb-4">
            {/* Left: Perceptron Diagram + 2D Plot */}
            <div className="space-y-4">
              {/* Perceptron Diagram */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Activity size={14} className="text-[#e879f9]" />
                  <span className="text-sm font-semibold text-white">
                    Perceptron Architecture
                  </span>
                </div>
                <svg
                  viewBox="0 0 600 200"
                  className="w-full h-auto"
                  style={{ minHeight: 160 }}
                >
                  <defs>
                    <filter
                      id="percGlow"
                      x="-50%"
                      y="-50%"
                      width="200%"
                      height="200%"
                    >
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feComposite
                        in="SourceGraphic"
                        in2="blur"
                        operator="over"
                      />
                    </filter>
                    <linearGradient
                      id="connGrad1"
                      x1="0"
                      y1="0"
                      x2="1"
                      y2="0"
                    >
                      <stop offset="0%" stopColor="#6366f1" stopOpacity="0.8" />
                      <stop
                        offset="100%"
                        stopColor="#e879f9"
                        stopOpacity="0.8"
                      />
                    </linearGradient>
                    <linearGradient
                      id="connGrad2"
                      x1="0"
                      y1="0"
                      x2="1"
                      y2="0"
                    >
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.8" />
                      <stop
                        offset="100%"
                        stopColor="#e879f9"
                        stopOpacity="0.8"
                      />
                    </linearGradient>
                  </defs>

                  {/* Input nodes */}
                  <g>
                    {/* x1 */}
                    <circle cx="80" cy="65" r="24" fill="#111118" stroke="#6366f1" strokeWidth="2" />
                    <text x="80" y="62" textAnchor="middle" fill="#6366f1" fontSize="11" fontFamily="monospace" fontWeight="bold">
                      x1
                    </text>
                    <text x="80" y="76" textAnchor="middle" fill="#71717a" fontSize="9" fontFamily="monospace">
                      {simState.currentStep
                        ? simState.currentStep.point.x1.toFixed(1)
                        : "?"}
                    </text>

                    {/* x2 */}
                    <circle cx="80" cy="145" r="24" fill="#111118" stroke="#f43f5e" strokeWidth="2" />
                    <text x="80" y="142" textAnchor="middle" fill="#f43f5e" fontSize="11" fontFamily="monospace" fontWeight="bold">
                      x2
                    </text>
                    <text x="80" y="156" textAnchor="middle" fill="#71717a" fontSize="9" fontFamily="monospace">
                      {simState.currentStep
                        ? simState.currentStep.point.x2.toFixed(1)
                        : "?"}
                    </text>
                  </g>

                  {/* Weighted connections */}
                  <g>
                    {/* w1 line */}
                    <line
                      x1="104" y1="65" x2="246" y2="95"
                      stroke={simState.perceptron.w1 >= 0 ? "#6366f1" : "#f43f5e"}
                      strokeWidth={Math.max(1, Math.min(4, Math.abs(simState.perceptron.w1) * 3))}
                      opacity="0.7"
                    />
                    <rect
                      x="155" y="65" width="44" height="18" rx="4"
                      fill="#0a0a0f"
                      stroke={simState.perceptron.w1 >= 0 ? "#6366f1" : "#f43f5e"}
                      strokeWidth="1"
                      opacity="0.9"
                    />
                    <text x="177" y="78" textAnchor="middle" fill={simState.perceptron.w1 >= 0 ? "#6366f1" : "#f43f5e"} fontSize="9" fontFamily="monospace" fontWeight="bold">
                      {simState.perceptron.w1.toFixed(2)}
                    </text>

                    {/* w2 line */}
                    <line
                      x1="104" y1="145" x2="246" y2="115"
                      stroke={simState.perceptron.w2 >= 0 ? "#6366f1" : "#f43f5e"}
                      strokeWidth={Math.max(1, Math.min(4, Math.abs(simState.perceptron.w2) * 3))}
                      opacity="0.7"
                    />
                    <rect
                      x="155" y="120" width="44" height="18" rx="4"
                      fill="#0a0a0f"
                      stroke={simState.perceptron.w2 >= 0 ? "#6366f1" : "#f43f5e"}
                      strokeWidth="1"
                      opacity="0.9"
                    />
                    <text x="177" y="133" textAnchor="middle" fill={simState.perceptron.w2 >= 0 ? "#6366f1" : "#f43f5e"} fontSize="9" fontFamily="monospace" fontWeight="bold">
                      {simState.perceptron.w2.toFixed(2)}
                    </text>
                  </g>

                  {/* Summation node */}
                  <circle cx="270" cy="105" r="28" fill="#111118" stroke="#e879f9" strokeWidth="2" filter="url(#percGlow)" />
                  <text x="270" y="102" textAnchor="middle" fill="#e879f9" fontSize="16" fontFamily="serif">
                    {"\u03A3"}
                  </text>
                  <text x="270" y="118" textAnchor="middle" fill="#71717a" fontSize="8" fontFamily="monospace">
                    {simState.currentStep
                      ? simState.currentStep.preActivation.toFixed(2)
                      : "?"}
                  </text>

                  {/* Bias */}
                  <line x1="270" y1="40" x2="270" y2="77" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4,3" opacity="0.7" />
                  <rect x="248" y="20" width="44" height="18" rx="4" fill="#0a0a0f" stroke="#f59e0b" strokeWidth="1" opacity="0.9" />
                  <text x="270" y="33" textAnchor="middle" fill="#f59e0b" fontSize="9" fontFamily="monospace" fontWeight="bold">
                    b={simState.perceptron.bias.toFixed(2)}
                  </text>

                  {/* Arrow to activation */}
                  <line x1="298" y1="105" x2="360" y2="105" stroke="#a1a1aa" strokeWidth="1.5" markerEnd="url(#arrowFwd)" />
                  <defs>
                    <marker id="arrowFwd" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                      <path d="M0,1 L6,4 L0,7" fill="#a1a1aa" />
                    </marker>
                  </defs>

                  {/* Activation function box */}
                  <rect x="365" y="80" width="80" height="50" rx="8" fill="#111118" stroke="#e879f9" strokeWidth="1.5" />
                  <text x="405" y="100" textAnchor="middle" fill="#e879f9" fontSize="10" fontFamily="monospace" fontWeight="bold">
                    {activationFn}
                  </text>
                  {/* Mini activation curve */}
                  <polyline
                    points={(() => {
                      const pts: string[] = [];
                      for (let i = 0; i <= 30; i++) {
                        const z = (i / 30) * 6 - 3;
                        const v = activate(z, activationFn);
                        const x = 375 + (i / 30) * 60;
                        const y = 125 - clamp(v, -0.1, 1.1) * 18;
                        pts.push(`${x},${y}`);
                      }
                      return pts.join(" ");
                    })()}
                    fill="none"
                    stroke="#e879f9"
                    strokeWidth="1.5"
                    opacity="0.6"
                  />

                  {/* Arrow to output */}
                  <line x1="445" y1="105" x2="490" y2="105" stroke="#a1a1aa" strokeWidth="1.5" markerEnd="url(#arrowFwd)" />

                  {/* Output node */}
                  <circle
                    cx="520" cy="105" r="24"
                    fill={
                      simState.currentStep
                        ? simState.currentStep.output >= 0.5
                          ? "rgba(16,185,129,0.2)"
                          : "rgba(239,68,68,0.1)"
                        : "#111118"
                    }
                    stroke={
                      simState.currentStep
                        ? simState.currentStep.output >= 0.5
                          ? "#10b981"
                          : "#ef4444"
                        : "#71717a"
                    }
                    strokeWidth="2"
                  />
                  <text x="520" y="102" textAnchor="middle" fill="white" fontSize="10" fontFamily="monospace" fontWeight="bold">
                    out
                  </text>
                  <text x="520" y="116" textAnchor="middle" fill="#a1a1aa" fontSize="9" fontFamily="monospace">
                    {simState.currentStep
                      ? simState.currentStep.output.toFixed(2)
                      : "?"}
                  </text>

                  {/* Error display */}
                  {simState.currentStep && (
                    <g>
                      <text x="520" y="150" textAnchor="middle" fill="#71717a" fontSize="8" fontFamily="monospace">
                        error: {simState.currentStep.error.toFixed(3)}
                      </text>
                      <text x="520" y="162" textAnchor="middle" fill={simState.currentStep.error === 0 ? "#10b981" : "#ef4444"} fontSize="8" fontFamily="monospace">
                        {simState.currentStep.error === 0 ? "CORRECT" : "WRONG"}
                      </text>
                    </g>
                  )}

                  {/* Weight update arrows */}
                  {simState.currentStep &&
                    Math.abs(simState.currentStep.deltaW1) > 0.001 && (
                      <g>
                        <text x="177" y="56" textAnchor="middle" fill="#10b981" fontSize="8" fontFamily="monospace">
                          {"\u0394"}w1: {simState.currentStep.deltaW1 > 0 ? "+" : ""}
                          {simState.currentStep.deltaW1.toFixed(3)}
                        </text>
                      </g>
                    )}
                  {simState.currentStep &&
                    Math.abs(simState.currentStep.deltaW2) > 0.001 && (
                      <g>
                        <text x="177" y="150" textAnchor="middle" fill="#10b981" fontSize="8" fontFamily="monospace">
                          {"\u0394"}w2: {simState.currentStep.deltaW2 > 0 ? "+" : ""}
                          {simState.currentStep.deltaW2.toFixed(3)}
                        </text>
                      </g>
                    )}
                </svg>
              </div>

              {/* 2D Decision Boundary Plot */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Target size={14} className="text-[#f59e0b]" />
                  <span className="text-sm font-semibold text-white">
                    2D Decision Boundary
                  </span>
                  {scenario === "custom" && (
                    <span className="text-[10px] text-[#71717a] ml-auto">
                      Click = class 0, Shift+Click / Right-click = class 1
                    </span>
                  )}
                </div>
                <div className="flex justify-center">
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${PLOT_SIZE} ${PLOT_SIZE}`}
                    className="w-full max-w-[480px] h-auto bg-[#0a0a0f] rounded-lg border border-[#1e1e2e]"
                    onClick={handlePlotClick}
                    onContextMenu={handlePlotRightClick}
                    style={{ cursor: scenario === "custom" ? "crosshair" : "default" }}
                  >
                    <defs>
                      <linearGradient id="boundaryGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.8" />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.8" />
                      </linearGradient>
                      <clipPath id="plotClip">
                        <rect x={PLOT_PADDING} y={PLOT_PADDING} width={PLOT_SIZE - 2 * PLOT_PADDING} height={PLOT_SIZE - 2 * PLOT_PADDING} />
                      </clipPath>
                    </defs>

                    {/* Grid lines */}
                    {[0, 0.5, 1].map((v) => {
                      const { sx, sy } = dataToSvg(v, v);
                      const { sx: sx0 } = dataToSvg(PLOT_RANGE.min, 0);
                      const { sx: sx1 } = dataToSvg(PLOT_RANGE.max, 0);
                      const { sy: sy0 } = dataToSvg(0, PLOT_RANGE.min);
                      const { sy: sy1 } = dataToSvg(0, PLOT_RANGE.max);
                      return (
                        <g key={v}>
                          <line x1={sx} y1={PLOT_PADDING} x2={sx} y2={PLOT_SIZE - PLOT_PADDING} stroke="#1e1e2e" strokeWidth="1" />
                          <line x1={PLOT_PADDING} y1={sy} x2={PLOT_SIZE - PLOT_PADDING} y2={sy} stroke="#1e1e2e" strokeWidth="1" />
                          <text x={sx} y={PLOT_SIZE - PLOT_PADDING + 14} textAnchor="middle" fill="#4a4a5a" fontSize="9" fontFamily="monospace">
                            {v}
                          </text>
                          <text x={PLOT_PADDING - 8} y={sy + 3} textAnchor="end" fill="#4a4a5a" fontSize="9" fontFamily="monospace">
                            {v}
                          </text>
                        </g>
                      );
                    })}

                    {/* Axes labels */}
                    <text x={PLOT_SIZE / 2} y={PLOT_SIZE - 8} textAnchor="middle" fill="#71717a" fontSize="10" fontFamily="monospace">
                      x1
                    </text>
                    <text x={12} y={PLOT_SIZE / 2} textAnchor="middle" fill="#71717a" fontSize="10" fontFamily="monospace" transform={`rotate(-90, 12, ${PLOT_SIZE / 2})`}>
                      x2
                    </text>

                    {/* Decision boundary regions (color fill) */}
                    {decisionLine && (
                      <g clipPath="url(#plotClip)" opacity="0.08">
                        {/* Shade the positive region */}
                        {(() => {
                          const { w1, w2, bias } = simState.perceptron;
                          // Create a polygon for the positive half-plane
                          const corners = [
                            { x1: PLOT_RANGE.min, x2: PLOT_RANGE.min },
                            { x1: PLOT_RANGE.max, x2: PLOT_RANGE.min },
                            { x1: PLOT_RANGE.max, x2: PLOT_RANGE.max },
                            { x1: PLOT_RANGE.min, x2: PLOT_RANGE.max },
                          ];
                          const positiveCorners = corners.filter(
                            (c) => w1 * c.x1 + w2 * c.x2 + bias >= 0
                          );
                          if (positiveCorners.length === 0) return null;

                          // Build polygon from positive corners + intersection points
                          const pts = positiveCorners.map((c) => {
                            const { sx, sy } = dataToSvg(c.x1, c.x2);
                            return `${sx},${sy}`;
                          });

                          return (
                            <polygon
                              points={pts.join(" ")}
                              fill="#6366f1"
                            />
                          );
                        })()}
                      </g>
                    )}

                    {/* Decision boundary line */}
                    {decisionLine && (
                      <g clipPath="url(#plotClip)">
                        <line
                          x1={decisionLine.x1}
                          y1={decisionLine.y1}
                          x2={decisionLine.x2}
                          y2={decisionLine.y2}
                          stroke="#f59e0b"
                          strokeWidth="2.5"
                          strokeDasharray="6,4"
                          opacity="0.8"
                        />
                        {/* Glow */}
                        <line
                          x1={decisionLine.x1}
                          y1={decisionLine.y1}
                          x2={decisionLine.x2}
                          y2={decisionLine.y2}
                          stroke="#f59e0b"
                          strokeWidth="6"
                          opacity="0.15"
                        />
                      </g>
                    )}

                    {/* Data points */}
                    {classifiedData.map((point, i) => {
                      const { sx, sy } = dataToSvg(point.x1, point.x2);
                      const isClass1 = point.label === 1;
                      const isCorrect = point.correct;
                      const isCurrentSample =
                        simState.currentStep &&
                        simState.currentStep.point.x1 === point.x1 &&
                        simState.currentStep.point.x2 === point.x2;

                      const fillColor = isClass1 ? "#f43f5e" : "#6366f1";
                      const strokeColor =
                        isCurrentSample
                          ? "#ffffff"
                          : isCorrect === false
                            ? "#ef4444"
                            : isCorrect === true
                              ? "#10b981"
                              : "#71717a";

                      return (
                        <g key={i}>
                          {/* Highlight ring for current sample */}
                          {isCurrentSample && (
                            <circle
                              cx={sx}
                              cy={sy}
                              r="14"
                              fill="none"
                              stroke="#ffffff"
                              strokeWidth="1.5"
                              opacity="0.4"
                            >
                              <animate
                                attributeName="r"
                                values="12;16;12"
                                dur="1s"
                                repeatCount="indefinite"
                              />
                              <animate
                                attributeName="opacity"
                                values="0.4;0.1;0.4"
                                dur="1s"
                                repeatCount="indefinite"
                              />
                            </circle>
                          )}
                          {/* Point */}
                          <circle
                            cx={sx}
                            cy={sy}
                            r={isCurrentSample ? 8 : 6}
                            fill={fillColor}
                            stroke={strokeColor}
                            strokeWidth={isCurrentSample ? 2.5 : 1.5}
                            opacity={isCorrect === false ? 0.9 : 0.85}
                          />
                          {/* Wrong X marker */}
                          {isCorrect === false && !isCurrentSample && (
                            <g>
                              <line
                                x1={sx - 4}
                                y1={sy - 4}
                                x2={sx + 4}
                                y2={sy + 4}
                                stroke="#ef4444"
                                strokeWidth="1.5"
                              />
                              <line
                                x1={sx + 4}
                                y1={sy - 4}
                                x2={sx - 4}
                                y2={sy + 4}
                                stroke="#ef4444"
                                strokeWidth="1.5"
                              />
                            </g>
                          )}
                        </g>
                      );
                    })}

                    {/* Legend */}
                    <g>
                      <circle cx={PLOT_PADDING + 8} cy={PLOT_PADDING + 10} r="4" fill="#6366f1" />
                      <text x={PLOT_PADDING + 16} y={PLOT_PADDING + 13} fill="#71717a" fontSize="8" fontFamily="monospace">
                        Class 0
                      </text>
                      <circle cx={PLOT_PADDING + 60} cy={PLOT_PADDING + 10} r="4" fill="#f43f5e" />
                      <text x={PLOT_PADDING + 68} y={PLOT_PADDING + 13} fill="#71717a" fontSize="8" fontFamily="monospace">
                        Class 1
                      </text>
                      <line x1={PLOT_PADDING + 110} y1={PLOT_PADDING + 10} x2={PLOT_PADDING + 126} y2={PLOT_PADDING + 10} stroke="#f59e0b" strokeWidth="2" strokeDasharray="4,2" />
                      <text x={PLOT_PADDING + 130} y={PLOT_PADDING + 13} fill="#71717a" fontSize="8" fontFamily="monospace">
                        Decision
                      </text>
                    </g>
                  </svg>
                </div>

                {/* Equation display */}
                <div className="mt-3 p-2 bg-[#0a0a0f] rounded-lg border border-[#1e1e2e] text-center">
                  <span className="text-xs font-mono text-[#a1a1aa]">
                    Decision boundary:{" "}
                    <span className="text-[#6366f1]">
                      {simState.perceptron.w1.toFixed(3)}
                    </span>
                    {"\u00B7"}x1 +{" "}
                    <span className="text-[#f43f5e]">
                      {simState.perceptron.w2.toFixed(3)}
                    </span>
                    {"\u00B7"}x2 +{" "}
                    <span className="text-[#f59e0b]">
                      {simState.perceptron.bias.toFixed(3)}
                    </span>{" "}
                    = 0
                  </span>
                </div>
              </div>
            </div>

            {/* Right Sidebar */}
            <div className="space-y-4">
              {/* Weight Update Visualization */}
              {simState.currentStep && (
                <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Zap size={14} className="text-[#10b981]" />
                    <span className="text-sm font-semibold text-white">
                      Weight Update
                    </span>
                  </div>
                  <div className="space-y-2 text-xs font-mono">
                    <div className="p-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]">
                      <div className="text-[9px] text-[#71717a] mb-1">
                        INPUT
                      </div>
                      <div className="flex gap-4">
                        <span>
                          x1={" "}
                          <span className="text-[#6366f1]">
                            {simState.currentStep.point.x1.toFixed(1)}
                          </span>
                        </span>
                        <span>
                          x2={" "}
                          <span className="text-[#f43f5e]">
                            {simState.currentStep.point.x2.toFixed(1)}
                          </span>
                        </span>
                        <span>
                          target={" "}
                          <span className="text-white">
                            {simState.currentStep.point.label}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="p-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]">
                      <div className="text-[9px] text-[#71717a] mb-1">
                        FORWARD
                      </div>
                      <div className="text-[#a1a1aa]">
                        z = {simState.currentStep.preActivation.toFixed(3)}
                      </div>
                      <div className="text-[#a1a1aa]">
                        {activationFn}(z) ={" "}
                        <span className="text-white">
                          {simState.currentStep.output.toFixed(3)}
                        </span>
                      </div>
                    </div>

                    <div className="p-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]">
                      <div className="text-[9px] text-[#71717a] mb-1">
                        ERROR
                      </div>
                      <div
                        style={{
                          color:
                            simState.currentStep.error === 0
                              ? "#10b981"
                              : "#ef4444",
                        }}
                      >
                        error = target - output ={" "}
                        {simState.currentStep.error.toFixed(3)}
                      </div>
                    </div>

                    <div className="p-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]">
                      <div className="text-[9px] text-[#71717a] mb-1">
                        WEIGHT DELTAS
                      </div>
                      <div className="space-y-0.5 text-[#a1a1aa]">
                        <div>
                          {"\u0394"}w1 ={" "}
                          <span className="text-[#10b981]">
                            {simState.currentStep.deltaW1 > 0 ? "+" : ""}
                            {simState.currentStep.deltaW1.toFixed(4)}
                          </span>
                        </div>
                        <div>
                          {"\u0394"}w2 ={" "}
                          <span className="text-[#10b981]">
                            {simState.currentStep.deltaW2 > 0 ? "+" : ""}
                            {simState.currentStep.deltaW2.toFixed(4)}
                          </span>
                        </div>
                        <div>
                          {"\u0394"}b ={" "}
                          <span className="text-[#10b981]">
                            {simState.currentStep.deltaBias > 0 ? "+" : ""}
                            {simState.currentStep.deltaBias.toFixed(4)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Weights Display */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Activity size={14} className="text-[#6366f1]" />
                  <span className="text-sm font-semibold text-white">
                    Current Weights
                  </span>
                </div>
                <div className="space-y-2">
                  {[
                    { label: "w1", value: simState.perceptron.w1, color: "#6366f1" },
                    { label: "w2", value: simState.perceptron.w2, color: "#f43f5e" },
                    { label: "bias", value: simState.perceptron.bias, color: "#f59e0b" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span
                        className="text-xs font-mono w-8"
                        style={{ color }}
                      >
                        {label}
                      </span>
                      <div className="flex-1 h-3 bg-[#0a0a0f] rounded-full relative overflow-hidden">
                        <motion.div
                          className="absolute top-0 h-full rounded-full"
                          style={{
                            backgroundColor: color,
                            left: value >= 0 ? "50%" : undefined,
                            right: value < 0 ? "50%" : undefined,
                            width: `${Math.min(50, Math.abs(value) * 25)}%`,
                          }}
                          animate={{
                            width: `${Math.min(50, Math.abs(value) * 25)}%`,
                          }}
                          transition={{ duration: 0.15 }}
                        />
                        {/* Center mark */}
                        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#2a2a3e]" />
                      </div>
                      <span
                        className="text-xs font-mono w-14 text-right"
                        style={{ color }}
                      >
                        {value.toFixed(3)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Loss Graph */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingDown size={14} className="text-[#06b6d4]" />
                  <span className="text-sm font-semibold text-white">
                    Loss (MSE)
                  </span>
                  <span className="text-[10px] text-[#71717a] ml-auto font-mono">
                    {currentLoss.toFixed(4)}
                  </span>
                </div>
                <svg viewBox="0 0 260 70" className="w-full h-auto">
                  {simState.lossHistory.length >= 2 ? (
                    <>
                      <path d={lossAreaPath} fill="url(#lossGradPerc)" opacity="0.3" />
                      <polyline
                        points={lossSparkline}
                        fill="none"
                        stroke="#06b6d4"
                        strokeWidth="1.5"
                      />
                      <defs>
                        <linearGradient
                          id="lossGradPerc"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                    </>
                  ) : (
                    <text x="130" y="40" textAnchor="middle" fill="#4a4a5a" fontSize="10" fontFamily="monospace">
                      Train to see loss curve
                    </text>
                  )}
                </svg>
              </div>

              {/* Activation Function Preview */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap size={14} className="text-[#e879f9]" />
                  <span className="text-sm font-semibold text-white">
                    Activation: {activationFn}
                  </span>
                </div>
                <svg viewBox="0 0 120 60" className="w-full h-auto">
                  {/* Axes */}
                  <line x1="0" y1="58" x2="120" y2="58" stroke="#1e1e2e" strokeWidth="0.5" />
                  <line x1="60" y1="0" x2="60" y2="60" stroke="#1e1e2e" strokeWidth="0.5" />
                  {/* Curve */}
                  <polyline
                    points={activationCurve}
                    fill="none"
                    stroke="#e879f9"
                    strokeWidth="2"
                  />
                  {/* Labels */}
                  <text x="4" y="56" fill="#4a4a5a" fontSize="6" fontFamily="monospace">-5</text>
                  <text x="110" y="56" fill="#4a4a5a" fontSize="6" fontFamily="monospace">5</text>
                  <text x="62" y="8" fill="#4a4a5a" fontSize="6" fontFamily="monospace">1</text>
                </svg>
                <div className="text-[10px] text-[#71717a] mt-1">
                  {activationFn === "step" &&
                    "Hard threshold at z=0. Classic perceptron."}
                  {activationFn === "sigmoid" &&
                    "Smooth output in [0,1]. Differentiable everywhere."}
                  {activationFn === "relu" &&
                    "Linear for z>0, zero otherwise. Sparse activation."}
                </div>
              </div>

              {/* XOR Warning */}
              {scenario === "xor" && (
                <div className="bg-[#111118] border border-[#ef4444]/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Target size={14} className="text-[#ef4444]" />
                    <span className="text-sm font-semibold text-[#ef4444]">
                      XOR is Unsolvable
                    </span>
                  </div>
                  <p className="text-xs text-[#71717a]">
                    No single line can separate XOR classes. The perceptron will
                    oscillate and never converge. This limitation led to the
                    development of multi-layer perceptrons (neural networks).
                  </p>
                </div>
              )}

              {/* Convergence indicator */}
              {simState.converged && (
                <motion.div
                  className="bg-[#111118] border border-[#10b981]/30 rounded-xl p-4"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Target size={14} className="text-[#10b981]" />
                    <span className="text-sm font-semibold text-[#10b981]">
                      Converged!
                    </span>
                  </div>
                  <p className="text-xs text-[#71717a]">
                    The perceptron has learned to classify all training points
                    correctly. The decision boundary separates the two classes.
                  </p>
                  <p className="text-xs text-[#a1a1aa] font-mono mt-1">
                    Epochs: {simState.epoch} | Steps: {simState.totalSteps}
                  </p>
                </motion.div>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="mb-4">
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

          {/* Metrics */}
          <AnimatePresence>
            {showMetrics && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-4">
                  <MetricCard
                    label="Epoch"
                    value={simState.epoch.toString()}
                    color="#e879f9"
                  />
                  <MetricCard
                    label="Accuracy"
                    value={`${(currentAccuracy * 100).toFixed(0)}%`}
                    color={currentAccuracy === 1 ? "#10b981" : "#f59e0b"}
                  />
                  <MetricCard
                    label="Loss (MSE)"
                    value={currentLoss.toFixed(4)}
                    color="#06b6d4"
                  />
                  <MetricCard
                    label="w1"
                    value={simState.perceptron.w1.toFixed(3)}
                    color="#6366f1"
                  />
                  <MetricCard
                    label="w2"
                    value={simState.perceptron.w2.toFixed(3)}
                    color="#f43f5e"
                  />
                  <MetricCard
                    label="bias"
                    value={simState.perceptron.bias.toFixed(3)}
                    color="#f59e0b"
                  />
                  <MetricCard
                    label="LR"
                    value={learningRate.toFixed(3)}
                    color="#a855f7"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Info Section */}
          <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
            <div className="text-sm font-semibold text-white mb-2">
              Key Concepts
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-[#a1a1aa]">
              <div>
                <div className="text-[#e879f9] font-semibold mb-1">
                  Perceptron Model
                </div>
                <ul className="space-y-1 list-disc list-inside text-[#71717a]">
                  <li>
                    output = activation(w1{"\u00B7"}x1 + w2{"\u00B7"}x2 + b)
                  </li>
                  <li>Linear decision boundary in input space</li>
                  <li>Can only solve linearly separable problems</li>
                  <li>Foundation of all neural networks</li>
                </ul>
              </div>
              <div>
                <div className="text-[#10b981] font-semibold mb-1">
                  Learning Rule
                </div>
                <ul className="space-y-1 list-disc list-inside text-[#71717a]">
                  <li>Compute error = target - predicted</li>
                  <li>
                    {"\u0394"}w = learning_rate {"\u00D7"} error {"\u00D7"}{" "}
                    input
                  </li>
                  <li>Update weights to reduce the error</li>
                  <li>Guaranteed convergence if linearly separable</li>
                </ul>
              </div>
              <div>
                <div className="text-[#ef4444] font-semibold mb-1">
                  Limitations
                </div>
                <ul className="space-y-1 list-disc list-inside text-[#71717a]">
                  <li>Cannot solve XOR (Minsky & Papert, 1969)</li>
                  <li>Only linear decision boundaries</li>
                  <li>Single layer = single hyperplane</li>
                  <li>Need multi-layer networks for nonlinear problems</li>
                </ul>
              </div>
            </div>

            {/* Scenario explanation */}
            <div className="mt-4 p-3 bg-[#0a0a0f] rounded-lg border border-[#1e1e2e]">
              <div className="flex items-center gap-2">
                <div className="text-[#e879f9] text-xs font-semibold">
                  {config.label}
                </div>
                {!config.solvable && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#ef4444]/15 text-[#ef4444]">
                    not linearly separable
                  </span>
                )}
              </div>
              <p className="text-xs text-[#71717a] mt-1">
                {config.description}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Metric Card ────────────────────────────────────────────────────────────

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
    <div className="px-2.5 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]">
      <span className="text-[9px] text-[#71717a] font-mono block">{label}</span>
      <span className="text-sm font-bold font-mono" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
