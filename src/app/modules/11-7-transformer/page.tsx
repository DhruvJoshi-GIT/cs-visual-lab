"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers,
  ChevronDown,
  Zap,
  ArrowRight,
  Activity,
  GitMerge,
  Brain,
  Hash,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ───────────────────────────────────────────────────────────────────

type TransformerStep =
  | "idle"
  | "embed"
  | "positional"
  | "qkv"
  | "attention"
  | "weighted_sum"
  | "ffn"
  | "output";

type ScenarioType = "simple" | "attention_patterns" | "multihead" | "full_pass";

interface Token {
  text: string;
  id: number;
}

interface EmbeddingVec {
  values: number[];
}

interface AttentionHead {
  id: number;
  queries: number[][]; // [seq_len x dk]
  keys: number[][]; // [seq_len x dk]
  values: number[][]; // [seq_len x dk]
  scores: number[][]; // [seq_len x seq_len] raw QK^T
  weights: number[][]; // [seq_len x seq_len] after softmax
  output: number[][]; // [seq_len x dk]
}

interface TransformerState {
  tokens: Token[];
  embeddings: number[][]; // [seq_len x d_model]
  posEncoding: number[][]; // [seq_len x d_model]
  combinedEmbedding: number[][]; // embedding + positional
  heads: AttentionHead[];
  attentionOutput: number[][]; // concatenated multi-head output
  addNorm1: number[][]; // after first residual + norm
  ffnHidden: number[][]; // FFN intermediate
  ffnOutput: number[][]; // FFN output
  addNorm2: number[][]; // after second residual + norm
  finalOutput: number[][]; // final output vectors
}

interface Scenario {
  name: string;
  type: ScenarioType;
  sentence: string;
  numHeads: number;
  description: string;
  focusStep: TransformerStep | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const D_MODEL = 8;
const D_K = 4; // dimension per head
const D_FF = 16; // FFN hidden dim

const STEP_CONFIG: Record<
  TransformerStep,
  { label: string; color: string; description: string; index: number }
> = {
  idle: {
    label: "Ready",
    color: "#71717a",
    description: "Waiting to begin",
    index: -1,
  },
  embed: {
    label: "Token Embedding",
    color: "#6366f1",
    description: "Convert tokens to dense vectors",
    index: 0,
  },
  positional: {
    label: "Positional Encoding",
    color: "#e879f9",
    description: "Add position information via sin/cos patterns",
    index: 1,
  },
  qkv: {
    label: "Q, K, V Projection",
    color: "#f59e0b",
    description: "Project embeddings into Query, Key, and Value spaces",
    index: 2,
  },
  attention: {
    label: "Attention Scores",
    color: "#06b6d4",
    description: "Compute QK^T / sqrt(dk) then softmax for attention weights",
    index: 3,
  },
  weighted_sum: {
    label: "Weighted Sum + Residual",
    color: "#10b981",
    description: "Weighted sum of values, then add & normalize",
    index: 4,
  },
  ffn: {
    label: "Feed-Forward Network",
    color: "#a855f7",
    description: "Two linear layers with ReLU activation",
    index: 5,
  },
  output: {
    label: "Output + Residual",
    color: "#ef4444",
    description: "Final add & norm produces the encoder output",
    index: 6,
  },
};

const STEP_ORDER: TransformerStep[] = [
  "embed",
  "positional",
  "qkv",
  "attention",
  "weighted_sum",
  "ffn",
  "output",
];

const SCENARIOS: Scenario[] = [
  {
    name: "Simple Sentence",
    type: "simple",
    sentence: "The cat sat on the mat",
    numHeads: 2,
    description: "Step through a basic transformer encoder block",
    focusStep: null,
  },
  {
    name: "Attention Patterns",
    type: "attention_patterns",
    sentence: "The cat sat on the mat",
    numHeads: 2,
    description: "Focus on attention weights between tokens",
    focusStep: "attention",
  },
  {
    name: "Multi-Head View",
    type: "multihead",
    sentence: "The cat sat on the mat",
    numHeads: 4,
    description: "Compare attention patterns across 4 heads",
    focusStep: "attention",
  },
  {
    name: "Full Forward Pass",
    type: "full_pass",
    sentence: "I love deep learning",
    numHeads: 2,
    description: "Watch data flow through the complete encoder block",
    focusStep: null,
  },
];

const COLOR_Q = "#6366f1";
const COLOR_K = "#f59e0b";
const COLOR_V = "#10b981";
const COLOR_ATTN = "#06b6d4";
const COLOR_FFN = "#a855f7";

const HEAD_COLORS = ["#06b6d4", "#f59e0b", "#10b981", "#e879f9"];

// ─── Math Helpers ────────────────────────────────────────────────────────────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function softmax(arr: number[]): number[] {
  const max = Math.max(...arr);
  const exps = arr.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function matMul(a: number[][], b: number[][]): number[][] {
  const rows = a.length;
  const cols = b[0].length;
  const inner = b.length;
  const result: number[][] = [];
  for (let i = 0; i < rows; i++) {
    result[i] = [];
    for (let j = 0; j < cols; j++) {
      let sum = 0;
      for (let k = 0; k < inner; k++) {
        sum += a[i][k] * b[k][j];
      }
      result[i][j] = sum;
    }
  }
  return result;
}

function transpose(m: number[][]): number[][] {
  if (m.length === 0) return [];
  const rows = m.length;
  const cols = m[0].length;
  const result: number[][] = [];
  for (let j = 0; j < cols; j++) {
    result[j] = [];
    for (let i = 0; i < rows; i++) {
      result[j][i] = m[i][j];
    }
  }
  return result;
}

function relu(x: number): number {
  return Math.max(0, x);
}

function layerNorm(vecs: number[][]): number[][] {
  return vecs.map((vec) => {
    const mean = vec.reduce((a, b) => a + b, 0) / vec.length;
    const variance =
      vec.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vec.length;
    const std = Math.sqrt(variance + 1e-6);
    return vec.map((v) => (v - mean) / std);
  });
}

function addVectors(a: number[][], b: number[][]): number[][] {
  return a.map((row, i) => row.map((v, j) => v + b[i][j]));
}

function generateWeightMatrix(
  rows: number,
  cols: number,
  seed: number
): number[][] {
  const rng = seededRandom(seed);
  const scale = Math.sqrt(2.0 / (rows + cols));
  const matrix: number[][] = [];
  for (let i = 0; i < rows; i++) {
    matrix[i] = [];
    for (let j = 0; j < cols; j++) {
      matrix[i][j] = (rng() * 2 - 1) * scale;
    }
  }
  return matrix;
}

// ─── Transformer Engine ──────────────────────────────────────────────────────

function tokenize(sentence: string): Token[] {
  return sentence.split(" ").map((word, i) => ({
    text: word,
    id: i,
  }));
}

function generateEmbeddings(tokens: Token[], seed: number): number[][] {
  const rng = seededRandom(seed + 42);
  return tokens.map((_, ti) => {
    const vec: number[] = [];
    for (let d = 0; d < D_MODEL; d++) {
      // Create somewhat meaningful embeddings (different tokens get different vectors)
      vec.push((rng() * 2 - 1) * 0.5 + Math.sin((ti + 1) * (d + 1) * 0.3) * 0.3);
    }
    return vec;
  });
}

function generatePositionalEncoding(seqLen: number): number[][] {
  const pe: number[][] = [];
  for (let pos = 0; pos < seqLen; pos++) {
    pe[pos] = [];
    for (let d = 0; d < D_MODEL; d++) {
      const angle = pos / Math.pow(10000, (2 * Math.floor(d / 2)) / D_MODEL);
      pe[pos][d] = d % 2 === 0 ? Math.sin(angle) : Math.cos(angle);
    }
  }
  return pe;
}

function computeAttentionHead(
  embeddings: number[][],
  headId: number,
  seed: number
): AttentionHead {
  const seqLen = embeddings.length;

  // Weight matrices for Q, K, V projections
  const Wq = generateWeightMatrix(D_MODEL, D_K, seed + headId * 100);
  const Wk = generateWeightMatrix(D_MODEL, D_K, seed + headId * 100 + 33);
  const Wv = generateWeightMatrix(D_MODEL, D_K, seed + headId * 100 + 66);

  // Q = X * Wq, K = X * Wk, V = X * Wv
  const queries = matMul(embeddings, Wq);
  const keys = matMul(embeddings, Wk);
  const values = matMul(embeddings, Wv);

  // Scores = Q * K^T / sqrt(dk)
  const kT = transpose(keys);
  const rawScores = matMul(queries, kT);
  const scaleFactor = Math.sqrt(D_K);
  const scaledScores = rawScores.map((row) =>
    row.map((v) => v / scaleFactor)
  );

  // Softmax per row
  const weights = scaledScores.map((row) => softmax(row));

  // Output = weights * V
  const output = matMul(weights, values);

  return {
    id: headId,
    queries,
    keys,
    values,
    scores: scaledScores,
    weights,
    output,
  };
}

function buildTransformerState(
  sentence: string,
  numHeads: number,
  seed: number
): TransformerState {
  const tokens = tokenize(sentence);
  const seqLen = tokens.length;

  // Step 1: Embeddings
  const embeddings = generateEmbeddings(tokens, seed);

  // Step 2: Positional Encoding
  const posEncoding = generatePositionalEncoding(seqLen);

  // Step 3: Combined
  const combinedEmbedding = addVectors(embeddings, posEncoding);

  // Step 4: Multi-head attention
  const heads: AttentionHead[] = [];
  for (let h = 0; h < numHeads; h++) {
    heads.push(computeAttentionHead(combinedEmbedding, h, seed));
  }

  // Concatenate head outputs
  const concatOutput: number[][] = [];
  for (let i = 0; i < seqLen; i++) {
    let row: number[] = [];
    for (const head of heads) {
      row = [...row, ...head.output[i]];
    }
    // Project back to d_model if needed (just truncate/pad for visualization)
    while (row.length < D_MODEL) row.push(0);
    concatOutput.push(row.slice(0, D_MODEL));
  }

  const attentionOutput = concatOutput;

  // Add & Norm 1 (residual connection)
  const residual1 = addVectors(combinedEmbedding, attentionOutput);
  const addNorm1 = layerNorm(residual1);

  // FFN: Linear(d_model, d_ff) -> ReLU -> Linear(d_ff, d_model)
  const W1 = generateWeightMatrix(D_MODEL, D_FF, seed + 500);
  const W2 = generateWeightMatrix(D_FF, D_MODEL, seed + 600);

  const ffnHidden = matMul(addNorm1, W1).map((row) => row.map(relu));
  const ffnOutput = matMul(ffnHidden, W2);

  // Add & Norm 2
  const residual2 = addVectors(addNorm1, ffnOutput);
  const addNorm2 = layerNorm(residual2);

  return {
    tokens,
    embeddings,
    posEncoding,
    combinedEmbedding,
    heads,
    attentionOutput,
    addNorm1,
    ffnHidden,
    ffnOutput,
    addNorm2,
    finalOutput: addNorm2,
  };
}

// ─── Visualization Helpers ───────────────────────────────────────────────────

function valueToColor(
  value: number,
  baseColor: string,
  intensity: number = 1
): string {
  const clamped = Math.max(-1, Math.min(1, value));
  const alpha = Math.abs(clamped) * 0.8 * intensity;
  if (clamped >= 0) {
    return `rgba(${hexToRgb(baseColor)}, ${alpha.toFixed(2)})`;
  } else {
    return `rgba(239, 68, 68, ${alpha.toFixed(2)})`;
  }
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function hexToRgba(hex: string, alpha: number): string {
  return `rgba(${hexToRgb(hex)}, ${alpha})`;
}

function weightToOpacity(w: number): number {
  return Math.max(0.05, Math.min(0.95, w));
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TransformerPage() {
  // State
  const [currentStep, setCurrentStep] = useState<TransformerStep>("idle");
  const [selectedScenario, setSelectedScenario] = useState(0);
  const [sentence, setSentence] = useState("The cat sat on the mat");
  const [numHeads, setNumHeads] = useState(2);
  const [activeHead, setActiveHead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [showScenarioDropdown, setShowScenarioDropdown] = useState(false);
  const [hoveredToken, setHoveredToken] = useState<number | null>(null);
  const [seed] = useState(12345);

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

  // Build transformer state
  const transformerState = useMemo(
    () => buildTransformerState(sentence, numHeads, seed),
    [sentence, numHeads, seed]
  );

  const seqLen = transformerState.tokens.length;
  const currentStepIndex = STEP_CONFIG[currentStep].index;

  // Step forward
  const stepForward = useCallback(() => {
    setCurrentStep((prev) => {
      const idx = STEP_ORDER.indexOf(prev as (typeof STEP_ORDER)[number]);
      if (idx === -1) return STEP_ORDER[0];
      if (idx >= STEP_ORDER.length - 1) return "output"; // stay at last
      return STEP_ORDER[idx + 1];
    });
  }, []);

  // Animation loop
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(10, 1500 / speedRef.current);
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
    if (currentStep === "output") setCurrentStep("idle");
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop, currentStep]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const handleStep = useCallback(() => {
    if (isPlaying) handlePause();
    if (currentStep === "output") {
      setCurrentStep("idle");
      setTimeout(() => stepForward(), 50);
    } else {
      stepForward();
    }
  }, [isPlaying, handlePause, stepForward, currentStep]);

  const handleReset = useCallback(() => {
    handlePause();
    setCurrentStep("idle");
  }, [handlePause]);

  const handleScenarioSelect = useCallback(
    (idx: number) => {
      handlePause();
      const scenario = SCENARIOS[idx];
      setSelectedScenario(idx);
      setSentence(scenario.sentence);
      setNumHeads(scenario.numHeads);
      setCurrentStep("idle");
      if (scenario.focusStep) {
        setTimeout(() => setCurrentStep(scenario.focusStep!), 100);
      }
      setShowScenarioDropdown(false);
    },
    [handlePause]
  );

  // Auto-stop at end
  useEffect(() => {
    if (currentStep === "output" && isPlaying) {
      const timer = setTimeout(() => handlePause(), 2000 / speed);
      return () => clearTimeout(timer);
    }
  }, [currentStep, isPlaying, handlePause, speed]);

  // Matrix grid cell renderer
  const MatrixCell = useCallback(
    ({
      value,
      color,
      size = "sm",
    }: {
      value: number;
      color: string;
      size?: "sm" | "md" | "lg";
    }) => {
      const sizeClass =
        size === "lg" ? "w-8 h-8" : size === "md" ? "w-6 h-6" : "w-4 h-4";
      return (
        <div
          className={`${sizeClass} rounded-sm flex items-center justify-center`}
          style={{
            backgroundColor: valueToColor(value, color),
            border: `1px solid ${hexToRgba(color, 0.15)}`,
          }}
          title={value.toFixed(4)}
        >
          {size === "lg" && (
            <span className="text-[7px] font-mono text-white/70">
              {value.toFixed(1)}
            </span>
          )}
        </div>
      );
    },
    []
  );

  // Heatmap cell for attention weights
  const AttentionCell = useCallback(
    ({ value, maxVal }: { value: number; maxVal: number }) => {
      const intensity = maxVal > 0 ? value / maxVal : 0;
      return (
        <div
          className="w-full h-full rounded-sm"
          style={{
            backgroundColor: hexToRgba(COLOR_ATTN, weightToOpacity(intensity)),
            border: `1px solid ${hexToRgba(COLOR_ATTN, 0.1)}`,
          }}
          title={value.toFixed(4)}
        />
      );
    },
    []
  );

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />
      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-1 rounded-md bg-[#e879f9]/15 text-[#e879f9] text-xs font-mono font-semibold tracking-wide">
                11.7
              </span>
              <h1 className="text-2xl font-bold tracking-tight">
                Transformer Architecture
              </h1>
            </div>
            <p className="text-[#a1a1aa] text-sm max-w-2xl">
              Step through a transformer encoder block. Watch tokens get embedded,
              attend to each other via multi-head attention, and pass through
              feed-forward layers.
            </p>
          </div>

          {/* Scenario Selector & Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {/* Scenario Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowScenarioDropdown(!showScenarioDropdown)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e] hover:border-[#e879f9]/40 text-sm transition-all"
              >
                <Brain size={14} className="text-[#e879f9]" />
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

            {/* Head count selector */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e]">
              <Layers size={14} className="text-[#06b6d4]" />
              <span className="text-xs text-[#71717a]">Heads:</span>
              {[2, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    handlePause();
                    setNumHeads(n);
                    setCurrentStep("idle");
                  }}
                  className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${
                    numHeads === n
                      ? "bg-[#06b6d4]/20 text-[#06b6d4] border border-[#06b6d4]/30"
                      : "text-[#71717a] hover:text-white"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>

            {/* Current step indicator */}
            {currentStep !== "idle" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border"
                style={{
                  backgroundColor: hexToRgba(STEP_CONFIG[currentStep].color, 0.1),
                  borderColor: hexToRgba(STEP_CONFIG[currentStep].color, 0.3),
                }}
              >
                <div
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{
                    backgroundColor: STEP_CONFIG[currentStep].color,
                  }}
                />
                <span
                  className="text-xs font-medium"
                  style={{ color: STEP_CONFIG[currentStep].color }}
                >
                  {STEP_CONFIG[currentStep].label}
                </span>
              </motion.div>
            )}
          </div>

          {/* Step Progress Bar */}
          <div className="flex items-center gap-1 mb-4">
            {STEP_ORDER.map((step, idx) => {
              const config = STEP_CONFIG[step];
              const isActive = currentStep === step;
              const isPast = currentStepIndex > config.index;
              return (
                <div key={step} className="flex items-center flex-1">
                  <button
                    onClick={() => {
                      if (isPlaying) handlePause();
                      setCurrentStep(step);
                    }}
                    className={`flex-1 flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                      isActive
                        ? "border-opacity-50"
                        : isPast
                          ? "border-[#1e1e2e] opacity-70"
                          : "border-[#1e1e2e] opacity-40"
                    }`}
                    style={{
                      backgroundColor: isActive
                        ? hexToRgba(config.color, 0.15)
                        : isPast
                          ? hexToRgba(config.color, 0.05)
                          : "transparent",
                      borderColor: isActive
                        ? hexToRgba(config.color, 0.4)
                        : "#1e1e2e",
                      color: isActive || isPast ? config.color : "#71717a",
                    }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor:
                          isActive || isPast ? config.color : "#2a2a3e",
                      }}
                    />
                    <span className="truncate">{config.label}</span>
                  </button>
                  {idx < STEP_ORDER.length - 1 && (
                    <ArrowRight
                      size={10}
                      className="flex-shrink-0 mx-0.5"
                      style={{
                        color: isPast ? config.color : "#2a2a3e",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
            {/* Visualization Area */}
            <div className="space-y-4">
              {/* Block Diagram */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3">
                  Encoder Block Architecture
                </h3>
                <div className="flex items-center justify-center gap-1 overflow-x-auto pb-2">
                  {/* Input */}
                  <div className="flex flex-col items-center min-w-[70px]">
                    <div
                      className="px-2 py-1.5 rounded-lg border text-[10px] font-medium text-center"
                      style={{
                        backgroundColor:
                          currentStepIndex >= 0
                            ? hexToRgba("#6366f1", 0.1)
                            : "transparent",
                        borderColor:
                          currentStepIndex >= 0
                            ? hexToRgba("#6366f1", 0.3)
                            : "#1e1e2e",
                        color: currentStepIndex >= 0 ? "#6366f1" : "#71717a",
                      }}
                    >
                      Input
                      <br />
                      Embed
                    </div>
                  </div>
                  <ArrowRight
                    size={12}
                    className="flex-shrink-0"
                    style={{ color: currentStepIndex >= 1 ? "#e879f9" : "#2a2a3e" }}
                  />

                  {/* Positional */}
                  <div className="flex flex-col items-center min-w-[70px]">
                    <div
                      className="px-2 py-1.5 rounded-lg border text-[10px] font-medium text-center"
                      style={{
                        backgroundColor:
                          currentStepIndex >= 1
                            ? hexToRgba("#e879f9", 0.1)
                            : "transparent",
                        borderColor:
                          currentStepIndex >= 1
                            ? hexToRgba("#e879f9", 0.3)
                            : "#1e1e2e",
                        color: currentStepIndex >= 1 ? "#e879f9" : "#71717a",
                      }}
                    >
                      + Pos
                      <br />
                      Enc
                    </div>
                  </div>
                  <ArrowRight
                    size={12}
                    className="flex-shrink-0"
                    style={{ color: currentStepIndex >= 2 ? "#f59e0b" : "#2a2a3e" }}
                  />

                  {/* Multi-Head Attention block */}
                  <div className="flex flex-col items-center min-w-[100px]">
                    <div
                      className="px-3 py-2 rounded-lg border text-[10px] font-medium text-center relative"
                      style={{
                        backgroundColor:
                          currentStepIndex >= 2 && currentStepIndex <= 4
                            ? hexToRgba(COLOR_ATTN, 0.1)
                            : "transparent",
                        borderColor:
                          currentStepIndex >= 2 && currentStepIndex <= 4
                            ? hexToRgba(COLOR_ATTN, 0.4)
                            : "#1e1e2e",
                        color:
                          currentStepIndex >= 2 && currentStepIndex <= 4
                            ? COLOR_ATTN
                            : "#71717a",
                      }}
                    >
                      Multi-Head
                      <br />
                      Attention
                      {currentStepIndex >= 2 && currentStepIndex <= 4 && (
                        <motion.div
                          className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
                          style={{ backgroundColor: COLOR_ATTN }}
                          animate={{ scale: [1, 1.3, 1] }}
                          transition={{ repeat: Infinity, duration: 1.5 }}
                        />
                      )}
                    </div>
                    {/* Skip connection arrow */}
                    <div className="text-[8px] text-[#71717a] mt-0.5">
                      + residual
                    </div>
                  </div>
                  <ArrowRight
                    size={12}
                    className="flex-shrink-0"
                    style={{ color: currentStepIndex >= 4 ? "#10b981" : "#2a2a3e" }}
                  />

                  {/* Add & Norm 1 */}
                  <div className="flex flex-col items-center min-w-[70px]">
                    <div
                      className="px-2 py-1.5 rounded-lg border text-[10px] font-medium text-center"
                      style={{
                        backgroundColor:
                          currentStepIndex >= 4
                            ? hexToRgba("#10b981", 0.1)
                            : "transparent",
                        borderColor:
                          currentStepIndex >= 4
                            ? hexToRgba("#10b981", 0.3)
                            : "#1e1e2e",
                        color: currentStepIndex >= 4 ? "#10b981" : "#71717a",
                      }}
                    >
                      Add &
                      <br />
                      Norm
                    </div>
                  </div>
                  <ArrowRight
                    size={12}
                    className="flex-shrink-0"
                    style={{ color: currentStepIndex >= 5 ? COLOR_FFN : "#2a2a3e" }}
                  />

                  {/* FFN */}
                  <div className="flex flex-col items-center min-w-[80px]">
                    <div
                      className="px-2 py-2 rounded-lg border text-[10px] font-medium text-center relative"
                      style={{
                        backgroundColor:
                          currentStepIndex >= 5
                            ? hexToRgba(COLOR_FFN, 0.1)
                            : "transparent",
                        borderColor:
                          currentStepIndex >= 5
                            ? hexToRgba(COLOR_FFN, 0.4)
                            : "#1e1e2e",
                        color: currentStepIndex >= 5 ? COLOR_FFN : "#71717a",
                      }}
                    >
                      Feed
                      <br />
                      Forward
                      {currentStepIndex === 5 && (
                        <motion.div
                          className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
                          style={{ backgroundColor: COLOR_FFN }}
                          animate={{ scale: [1, 1.3, 1] }}
                          transition={{ repeat: Infinity, duration: 1.5 }}
                        />
                      )}
                    </div>
                    <div className="text-[8px] text-[#71717a] mt-0.5">
                      + residual
                    </div>
                  </div>
                  <ArrowRight
                    size={12}
                    className="flex-shrink-0"
                    style={{ color: currentStepIndex >= 6 ? "#ef4444" : "#2a2a3e" }}
                  />

                  {/* Output */}
                  <div className="flex flex-col items-center min-w-[70px]">
                    <div
                      className="px-2 py-1.5 rounded-lg border text-[10px] font-medium text-center"
                      style={{
                        backgroundColor:
                          currentStepIndex >= 6
                            ? hexToRgba("#ef4444", 0.1)
                            : "transparent",
                        borderColor:
                          currentStepIndex >= 6
                            ? hexToRgba("#ef4444", 0.3)
                            : "#1e1e2e",
                        color: currentStepIndex >= 6 ? "#ef4444" : "#71717a",
                      }}
                    >
                      Add &
                      <br />
                      Norm
                    </div>
                  </div>
                </div>
              </div>

              {/* Token Input Display */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3">
                  Input Tokens
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  {transformerState.tokens.map((token, i) => (
                    <motion.div
                      key={i}
                      className="relative"
                      onMouseEnter={() => setHoveredToken(i)}
                      onMouseLeave={() => setHoveredToken(null)}
                    >
                      <motion.div
                        className="px-3 py-2 rounded-lg border text-sm font-medium cursor-pointer"
                        style={{
                          backgroundColor:
                            hoveredToken === i
                              ? hexToRgba("#6366f1", 0.2)
                              : hexToRgba("#6366f1", 0.08),
                          borderColor:
                            hoveredToken === i
                              ? hexToRgba("#6366f1", 0.5)
                              : hexToRgba("#6366f1", 0.2),
                          color: "#6366f1",
                        }}
                        whileHover={{ scale: 1.05 }}
                      >
                        {token.text}
                        <span className="ml-1.5 text-[9px] text-[#71717a]">
                          [{i}]
                        </span>
                      </motion.div>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Step-specific visualization */}
              <AnimatePresence mode="wait">
                {/* Step 1: Embeddings */}
                {(currentStep === "embed" || currentStepIndex >= 0) &&
                  currentStep !== "idle" && (
                    <motion.div
                      key="embed"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: "#6366f1" }}
                        />
                        <h3 className="text-sm font-semibold text-[#a1a1aa]">
                          Token Embeddings
                          <span className="text-[10px] text-[#71717a] ml-2">
                            ({seqLen} tokens x {D_MODEL} dims)
                          </span>
                        </h3>
                      </div>
                      <div className="overflow-x-auto">
                        <div className="flex gap-2 min-w-fit">
                          {transformerState.tokens.map((token, ti) => (
                            <div key={ti} className="flex flex-col items-center gap-1">
                              <span className="text-[10px] text-[#6366f1] font-medium">
                                {token.text}
                              </span>
                              <div className="flex gap-px">
                                {transformerState.embeddings[ti].map((val, di) => (
                                  <MatrixCell
                                    key={di}
                                    value={val}
                                    color="#6366f1"
                                    size="sm"
                                  />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}

                {/* Step 2: Positional Encoding */}
                {currentStepIndex >= 1 && currentStep !== "idle" && (
                  <motion.div
                    key="positional"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: "#e879f9" }}
                      />
                      <h3 className="text-sm font-semibold text-[#a1a1aa]">
                        Positional Encoding
                        <span className="text-[10px] text-[#71717a] ml-2">
                          sin/cos patterns
                        </span>
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <div className="flex gap-2 min-w-fit">
                        {transformerState.tokens.map((token, ti) => (
                          <div key={ti} className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-[#e879f9] font-medium">
                              pos={ti}
                            </span>
                            <div className="flex gap-px">
                              {transformerState.posEncoding[ti].map((val, di) => (
                                <MatrixCell
                                  key={di}
                                  value={val}
                                  color="#e879f9"
                                  size="sm"
                                />
                              ))}
                            </div>
                            {/* Show sin/cos pattern */}
                            <div className="text-[8px] text-[#71717a] font-mono">
                              {transformerState.posEncoding[ti]
                                .slice(0, 3)
                                .map((v) => v.toFixed(1))
                                .join(", ")}
                              ...
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Combined: Embedding + Positional */}
                    <div className="mt-3 pt-3 border-t border-[#1e1e2e]">
                      <h4 className="text-xs text-[#71717a] mb-2">
                        Combined (Embedding + Position)
                      </h4>
                      <div className="flex gap-2 overflow-x-auto">
                        {transformerState.tokens.map((token, ti) => (
                          <div key={ti} className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-white font-medium">
                              {token.text}
                            </span>
                            <div className="flex gap-px">
                              {transformerState.combinedEmbedding[ti].map(
                                (val, di) => (
                                  <MatrixCell
                                    key={di}
                                    value={val}
                                    color="#a855f7"
                                    size="sm"
                                  />
                                )
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Step 3: Q, K, V Matrices */}
                {currentStepIndex >= 2 && currentStep !== "idle" && (
                  <motion.div
                    key="qkv"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: "#f59e0b" }}
                      />
                      <h3 className="text-sm font-semibold text-[#a1a1aa]">
                        Q, K, V Projections
                        <span className="text-[10px] text-[#71717a] ml-2">
                          Head {activeHead + 1}/{numHeads}
                        </span>
                      </h3>
                      {/* Head selector */}
                      <div className="flex gap-1 ml-auto">
                        {transformerState.heads.map((_, hi) => (
                          <button
                            key={hi}
                            onClick={() => setActiveHead(hi)}
                            className={`w-6 h-6 rounded text-[10px] font-medium transition-all ${
                              activeHead === hi
                                ? "text-white"
                                : "text-[#71717a] hover:text-white"
                            }`}
                            style={{
                              backgroundColor:
                                activeHead === hi
                                  ? hexToRgba(HEAD_COLORS[hi % HEAD_COLORS.length], 0.3)
                                  : "transparent",
                              borderColor:
                                activeHead === hi
                                  ? hexToRgba(HEAD_COLORS[hi % HEAD_COLORS.length], 0.5)
                                  : "#1e1e2e",
                              border: "1px solid",
                            }}
                          >
                            {hi + 1}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Q, K, V grids side by side */}
                    <div className="grid grid-cols-3 gap-4">
                      {/* Queries */}
                      <div>
                        <div className="flex items-center gap-1 mb-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: COLOR_Q }}
                          />
                          <span
                            className="text-xs font-semibold"
                            style={{ color: COLOR_Q }}
                          >
                            Query (Q)
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          {transformerState.heads[activeHead]?.queries.map(
                            (row, ri) => (
                              <div key={ri} className="flex items-center gap-1">
                                <span className="text-[8px] text-[#71717a] w-8 truncate">
                                  {transformerState.tokens[ri]?.text}
                                </span>
                                <div className="flex gap-px">
                                  {row.map((val, ci) => (
                                    <MatrixCell
                                      key={ci}
                                      value={val}
                                      color={COLOR_Q}
                                      size="md"
                                    />
                                  ))}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>

                      {/* Keys */}
                      <div>
                        <div className="flex items-center gap-1 mb-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: COLOR_K }}
                          />
                          <span
                            className="text-xs font-semibold"
                            style={{ color: COLOR_K }}
                          >
                            Key (K)
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          {transformerState.heads[activeHead]?.keys.map(
                            (row, ri) => (
                              <div key={ri} className="flex items-center gap-1">
                                <span className="text-[8px] text-[#71717a] w-8 truncate">
                                  {transformerState.tokens[ri]?.text}
                                </span>
                                <div className="flex gap-px">
                                  {row.map((val, ci) => (
                                    <MatrixCell
                                      key={ci}
                                      value={val}
                                      color={COLOR_K}
                                      size="md"
                                    />
                                  ))}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>

                      {/* Values */}
                      <div>
                        <div className="flex items-center gap-1 mb-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: COLOR_V }}
                          />
                          <span
                            className="text-xs font-semibold"
                            style={{ color: COLOR_V }}
                          >
                            Value (V)
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          {transformerState.heads[activeHead]?.values.map(
                            (row, ri) => (
                              <div key={ri} className="flex items-center gap-1">
                                <span className="text-[8px] text-[#71717a] w-8 truncate">
                                  {transformerState.tokens[ri]?.text}
                                </span>
                                <div className="flex gap-px">
                                  {row.map((val, ci) => (
                                    <MatrixCell
                                      key={ci}
                                      value={val}
                                      color={COLOR_V}
                                      size="md"
                                    />
                                  ))}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Step 4: Attention Scores & Weights */}
                {currentStepIndex >= 3 && currentStep !== "idle" && (
                  <motion.div
                    key="attention"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: COLOR_ATTN }}
                      />
                      <h3 className="text-sm font-semibold text-[#a1a1aa]">
                        Attention Weights
                        <span className="text-[10px] text-[#71717a] ml-2">
                          softmax(QK^T / sqrt(d_k))
                        </span>
                      </h3>
                    </div>

                    {/* Multi-head attention heatmaps */}
                    <div
                      className="grid gap-4"
                      style={{
                        gridTemplateColumns: `repeat(${Math.min(numHeads, 4)}, 1fr)`,
                      }}
                    >
                      {transformerState.heads.map((head, hi) => {
                        const maxWeight = Math.max(
                          ...head.weights.flat()
                        );
                        return (
                          <div key={hi}>
                            <div className="flex items-center gap-1 mb-2">
                              <div
                                className="w-2 h-2 rounded-full"
                                style={{
                                  backgroundColor:
                                    HEAD_COLORS[hi % HEAD_COLORS.length],
                                }}
                              />
                              <span
                                className="text-xs font-semibold"
                                style={{
                                  color: HEAD_COLORS[hi % HEAD_COLORS.length],
                                }}
                              >
                                Head {hi + 1}
                              </span>
                            </div>

                            {/* Heatmap grid */}
                            <div className="relative">
                              {/* Column labels (keys) */}
                              <div className="flex ml-10 mb-0.5">
                                {transformerState.tokens.map((t, i) => (
                                  <div
                                    key={i}
                                    className="flex-1 text-center text-[7px] text-[#71717a] truncate"
                                    style={{
                                      color:
                                        hoveredToken === i
                                          ? COLOR_K
                                          : "#71717a",
                                    }}
                                  >
                                    {t.text}
                                  </div>
                                ))}
                              </div>

                              {/* Rows */}
                              {head.weights.map((row, ri) => (
                                <div key={ri} className="flex items-center">
                                  <span
                                    className="text-[7px] w-10 text-right pr-1 truncate"
                                    style={{
                                      color:
                                        hoveredToken === ri
                                          ? COLOR_Q
                                          : "#71717a",
                                    }}
                                  >
                                    {transformerState.tokens[ri]?.text}
                                  </span>
                                  <div className="flex flex-1 gap-px">
                                    {row.map((val, ci) => (
                                      <div key={ci} className="flex-1 aspect-square">
                                        <AttentionCell
                                          value={val}
                                          maxVal={maxWeight}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Attention flow lines */}
                    {hoveredToken !== null && (
                      <div className="mt-3 pt-3 border-t border-[#1e1e2e]">
                        <h4 className="text-xs text-[#71717a] mb-2">
                          Token &quot;{transformerState.tokens[hoveredToken]?.text}&quot;
                          attends to:
                        </h4>
                        <div className="flex items-end gap-1 h-16">
                          {transformerState.heads[activeHead]?.weights[
                            hoveredToken
                          ]?.map((w, ti) => (
                            <div
                              key={ti}
                              className="flex-1 flex flex-col items-center gap-0.5"
                            >
                              <motion.div
                                className="w-full rounded-t"
                                style={{
                                  backgroundColor: COLOR_ATTN,
                                  opacity: 0.3 + w * 0.7,
                                }}
                                animate={{ height: `${Math.max(4, w * 60)}px` }}
                                transition={{ duration: 0.3 }}
                              />
                              <span className="text-[7px] text-[#71717a] truncate w-full text-center">
                                {transformerState.tokens[ti]?.text}
                              </span>
                              <span className="text-[7px] font-mono text-[#06b6d4]">
                                {(w * 100).toFixed(0)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* Step 5: Weighted Sum + Residual */}
                {currentStepIndex >= 4 && currentStep !== "idle" && (
                  <motion.div
                    key="weighted_sum"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: "#10b981" }}
                      />
                      <h3 className="text-sm font-semibold text-[#a1a1aa]">
                        Attention Output + Residual & LayerNorm
                      </h3>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {/* Attention output */}
                      <div>
                        <h4 className="text-xs text-[#71717a] mb-2">
                          Multi-Head Output (concatenated)
                        </h4>
                        <div className="space-y-0.5">
                          {transformerState.tokens.map((token, ti) => (
                            <div key={ti} className="flex items-center gap-1">
                              <span className="text-[8px] text-[#71717a] w-8 truncate">
                                {token.text}
                              </span>
                              <div className="flex gap-px">
                                {transformerState.attentionOutput[ti]?.map(
                                  (val, di) => (
                                    <MatrixCell
                                      key={di}
                                      value={val}
                                      color={COLOR_ATTN}
                                      size="sm"
                                    />
                                  )
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* After Add & Norm */}
                      <div>
                        <h4 className="text-xs text-[#71717a] mb-2">
                          After Add & Norm
                        </h4>
                        <div className="space-y-0.5">
                          {transformerState.tokens.map((token, ti) => (
                            <div key={ti} className="flex items-center gap-1">
                              <span className="text-[8px] text-[#71717a] w-8 truncate">
                                {token.text}
                              </span>
                              <div className="flex gap-px">
                                {transformerState.addNorm1[ti]?.map(
                                  (val, di) => (
                                    <MatrixCell
                                      key={di}
                                      value={val}
                                      color="#10b981"
                                      size="sm"
                                    />
                                  )
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Residual connection explanation */}
                    <div className="mt-3 pt-3 border-t border-[#1e1e2e]">
                      <div className="flex items-center gap-2 text-[10px] text-[#71717a]">
                        <GitMerge size={12} className="text-[#10b981]" />
                        <span>
                          Residual connection adds the input to the attention
                          output, then layer normalization stabilizes values.
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Step 6: Feed-Forward Network */}
                {currentStepIndex >= 5 && currentStep !== "idle" && (
                  <motion.div
                    key="ffn"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: COLOR_FFN }}
                      />
                      <h3 className="text-sm font-semibold text-[#a1a1aa]">
                        Feed-Forward Network
                        <span className="text-[10px] text-[#71717a] ml-2">
                          Linear({D_MODEL},{D_FF}) → ReLU → Linear({D_FF},{D_MODEL})
                        </span>
                      </h3>
                    </div>

                    {/* FFN visualization: input → hidden → output */}
                    <div className="flex items-center gap-4 overflow-x-auto">
                      {/* Input (Add&Norm1) */}
                      <div className="min-w-fit">
                        <h4 className="text-[10px] text-[#71717a] mb-1 text-center">
                          Input ({D_MODEL}d)
                        </h4>
                        <div className="space-y-0.5">
                          {transformerState.tokens.map((token, ti) => (
                            <div key={ti} className="flex items-center gap-1">
                              <span className="text-[7px] text-[#71717a] w-6 truncate">
                                {token.text}
                              </span>
                              <div className="flex gap-px">
                                {transformerState.addNorm1[ti]
                                  ?.slice(0, D_MODEL)
                                  .map((val, di) => (
                                    <MatrixCell
                                      key={di}
                                      value={val}
                                      color="#10b981"
                                      size="sm"
                                    />
                                  ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <ArrowRight size={16} className="text-[#71717a] flex-shrink-0" />

                      {/* Hidden layer (wider) */}
                      <div className="min-w-fit">
                        <h4 className="text-[10px] text-[#71717a] mb-1 text-center">
                          Hidden + ReLU ({D_FF}d)
                        </h4>
                        <div className="space-y-0.5">
                          {transformerState.tokens.map((token, ti) => (
                            <div key={ti} className="flex gap-px">
                              {transformerState.ffnHidden[ti]
                                ?.slice(0, D_FF)
                                .map((val, di) => (
                                  <MatrixCell
                                    key={di}
                                    value={val}
                                    color={COLOR_FFN}
                                    size="sm"
                                  />
                                ))}
                            </div>
                          ))}
                        </div>
                      </div>

                      <ArrowRight size={16} className="text-[#71717a] flex-shrink-0" />

                      {/* Output */}
                      <div className="min-w-fit">
                        <h4 className="text-[10px] text-[#71717a] mb-1 text-center">
                          Output ({D_MODEL}d)
                        </h4>
                        <div className="space-y-0.5">
                          {transformerState.tokens.map((token, ti) => (
                            <div key={ti} className="flex items-center gap-1">
                              <div className="flex gap-px">
                                {transformerState.ffnOutput[ti]
                                  ?.slice(0, D_MODEL)
                                  .map((val, di) => (
                                    <MatrixCell
                                      key={di}
                                      value={val}
                                      color={COLOR_FFN}
                                      size="sm"
                                    />
                                  ))}
                              </div>
                              <span className="text-[7px] text-[#71717a] w-6 truncate">
                                {token.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Step 7: Final Output */}
                {currentStepIndex >= 6 && currentStep !== "idle" && (
                  <motion.div
                    key="output"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: "#ef4444" }}
                      />
                      <h3 className="text-sm font-semibold text-[#a1a1aa]">
                        Encoder Output
                        <span className="text-[10px] text-[#71717a] ml-2">
                          Final representations after Add & Norm
                        </span>
                      </h3>
                    </div>

                    <div className="space-y-1">
                      {transformerState.tokens.map((token, ti) => (
                        <motion.div
                          key={ti}
                          className="flex items-center gap-2 p-2 rounded-lg"
                          style={{
                            backgroundColor: hexToRgba(
                              "#ef4444",
                              hoveredToken === ti ? 0.1 : 0.03
                            ),
                            border: `1px solid ${hexToRgba("#ef4444", hoveredToken === ti ? 0.3 : 0.1)}`,
                          }}
                          onMouseEnter={() => setHoveredToken(ti)}
                          onMouseLeave={() => setHoveredToken(null)}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: ti * 0.1 }}
                        >
                          <span className="text-xs font-medium text-[#ef4444] w-12">
                            {token.text}
                          </span>
                          <div className="flex gap-px flex-1">
                            {transformerState.finalOutput[ti]?.map((val, di) => (
                              <div
                                key={di}
                                className="flex-1 h-6 rounded-sm flex items-center justify-center"
                                style={{
                                  backgroundColor: valueToColor(
                                    val,
                                    "#ef4444",
                                    1
                                  ),
                                  border: `1px solid ${hexToRgba("#ef4444", 0.15)}`,
                                }}
                              >
                                <span className="text-[7px] font-mono text-white/60">
                                  {val.toFixed(2)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    {/* Success banner */}
                    <motion.div
                      className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.5 }}
                    >
                      <Zap size={14} className="text-[#10b981]" />
                      <span className="text-xs text-[#10b981]">
                        Forward pass complete! Each token now has a context-aware
                        representation.
                      </span>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

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
              {/* Current Step Info */}
              <AnimatePresence>
                {showMetrics && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-3"
                  >
                    {/* Step details */}
                    <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-3">
                      <h3 className="text-xs font-semibold text-[#71717a] mb-2 uppercase tracking-wider">
                        Current Step
                      </h3>
                      <div
                        className="px-3 py-2 rounded-lg border mb-2"
                        style={{
                          backgroundColor: hexToRgba(
                            STEP_CONFIG[currentStep].color,
                            0.1
                          ),
                          borderColor: hexToRgba(
                            STEP_CONFIG[currentStep].color,
                            0.3
                          ),
                        }}
                      >
                        <div
                          className="text-sm font-semibold"
                          style={{
                            color: STEP_CONFIG[currentStep].color,
                          }}
                        >
                          {STEP_CONFIG[currentStep].label}
                        </div>
                        <div className="text-[10px] text-[#71717a] mt-0.5">
                          {STEP_CONFIG[currentStep].description}
                        </div>
                      </div>

                      {/* Step counter */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#71717a]">Progress:</span>
                        <div className="flex-1 h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
                          <motion.div
                            className="h-full rounded-full bg-[#e879f9]"
                            animate={{
                              width: `${((currentStepIndex + 1) / STEP_ORDER.length) * 100}%`,
                            }}
                            transition={{ duration: 0.3 }}
                          />
                        </div>
                        <span className="text-xs font-mono text-[#a1a1aa]">
                          {Math.max(0, currentStepIndex + 1)}/{STEP_ORDER.length}
                        </span>
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-3">
                      <h3 className="text-xs font-semibold text-[#71717a] mb-2 uppercase tracking-wider">
                        Model Metrics
                      </h3>
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-[#71717a]">
                            Sequence Length
                          </span>
                          <span className="text-xs font-mono text-white">
                            {seqLen}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-[#71717a]">
                            Embedding Dim (d_model)
                          </span>
                          <span className="text-xs font-mono text-[#6366f1]">
                            {D_MODEL}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-[#71717a]">
                            Key/Query Dim (d_k)
                          </span>
                          <span className="text-xs font-mono text-[#f59e0b]">
                            {D_K}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-[#71717a]">
                            Attention Heads
                          </span>
                          <span className="text-xs font-mono text-[#06b6d4]">
                            {numHeads}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-[#71717a]">
                            FFN Hidden Dim
                          </span>
                          <span className="text-xs font-mono text-[#a855f7]">
                            {D_FF}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-[#71717a]">
                            Active Head
                          </span>
                          <span
                            className="text-xs font-mono"
                            style={{
                              color:
                                HEAD_COLORS[activeHead % HEAD_COLORS.length],
                            }}
                          >
                            Head {activeHead + 1}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-[#71717a]">
                            Total Params (approx)
                          </span>
                          <span className="text-xs font-mono text-[#e879f9]">
                            {(
                              numHeads * 3 * D_MODEL * D_K +
                              D_MODEL * D_FF +
                              D_FF * D_MODEL +
                              4 * D_MODEL
                            ).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Attention Head Patterns */}
                    {currentStepIndex >= 3 && (
                      <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-3">
                        <h3 className="text-xs font-semibold text-[#71717a] mb-2 uppercase tracking-wider">
                          Head Patterns
                        </h3>
                        <div className="space-y-2">
                          {transformerState.heads.map((head, hi) => {
                            // Compute dominant pattern
                            const diagScore = head.weights.reduce(
                              (sum, row, i) => sum + (row[i] || 0),
                              0
                            ) / seqLen;
                            const uniformity =
                              1 -
                              head.weights.reduce(
                                (sum, row) =>
                                  sum +
                                  row.reduce(
                                    (s, w) =>
                                      s +
                                      Math.abs(w - 1 / seqLen),
                                    0
                                  ),
                                0
                              ) /
                                (seqLen * seqLen);

                            return (
                              <div
                                key={hi}
                                className="flex items-center gap-2 p-1.5 rounded-lg cursor-pointer transition-all"
                                style={{
                                  backgroundColor:
                                    activeHead === hi
                                      ? hexToRgba(
                                          HEAD_COLORS[hi % HEAD_COLORS.length],
                                          0.1
                                        )
                                      : "transparent",
                                }}
                                onClick={() => setActiveHead(hi)}
                              >
                                <div
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{
                                    backgroundColor:
                                      HEAD_COLORS[hi % HEAD_COLORS.length],
                                  }}
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="text-[10px] font-medium text-[#a1a1aa]">
                                    Head {hi + 1}
                                  </div>
                                  <div className="text-[9px] text-[#71717a]">
                                    Self-attn: {(diagScore * 100).toFixed(0)}% |
                                    Spread: {(uniformity * 100).toFixed(0)}%
                                  </div>
                                </div>
                                {/* Mini heatmap preview */}
                                <div className="flex-shrink-0">
                                  <div
                                    className="grid gap-px"
                                    style={{
                                      gridTemplateColumns: `repeat(${seqLen}, 4px)`,
                                      gridTemplateRows: `repeat(${seqLen}, 4px)`,
                                    }}
                                  >
                                    {head.weights.flatMap((row, ri) =>
                                      row.map((w, ci) => (
                                        <div
                                          key={`${ri}-${ci}`}
                                          className="rounded-[1px]"
                                          style={{
                                            backgroundColor: hexToRgba(
                                              HEAD_COLORS[
                                                hi % HEAD_COLORS.length
                                              ],
                                              weightToOpacity(w)
                                            ),
                                          }}
                                        />
                                      ))
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Sentence input */}
                    <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-3">
                      <h3 className="text-xs font-semibold text-[#71717a] mb-2 uppercase tracking-wider">
                        Input Sentence
                      </h3>
                      <input
                        type="text"
                        value={sentence}
                        onChange={(e) => {
                          handlePause();
                          setSentence(e.target.value);
                          setCurrentStep("idle");
                        }}
                        className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-sm text-white focus:outline-none focus:border-[#6366f1]/50 transition-colors"
                        placeholder="Enter a sentence..."
                      />
                      <div className="text-[10px] text-[#71717a] mt-1">
                        Tokens: {sentence.split(" ").filter(Boolean).length} |
                        Press reset after changing
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Info Section */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[#6366f1]/15 flex items-center justify-center">
                  <Hash size={16} className="text-[#6366f1]" />
                </div>
                <h4 className="text-sm font-semibold">Embeddings</h4>
              </div>
              <p className="text-xs text-[#71717a] leading-relaxed">
                Each token is mapped to a dense vector. Positional encoding adds
                sin/cos signals so the model knows token order. These combine to
                form the input representation.
              </p>
            </div>

            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[#06b6d4]/15 flex items-center justify-center">
                  <Activity size={16} className="text-[#06b6d4]" />
                </div>
                <h4 className="text-sm font-semibold">Self-Attention</h4>
              </div>
              <p className="text-xs text-[#71717a] leading-relaxed">
                Each token computes Query, Key, Value vectors. Attention scores
                (QK^T) determine how much each token attends to others. Softmax
                normalizes these into weights.
              </p>
            </div>

            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[#f59e0b]/15 flex items-center justify-center">
                  <Layers size={16} className="text-[#f59e0b]" />
                </div>
                <h4 className="text-sm font-semibold">Multi-Head</h4>
              </div>
              <p className="text-xs text-[#71717a] leading-relaxed">
                Multiple attention heads run in parallel, each learning different
                relationship patterns. Their outputs are concatenated and projected
                back to the model dimension.
              </p>
            </div>

            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[#a855f7]/15 flex items-center justify-center">
                  <Brain size={16} className="text-[#a855f7]" />
                </div>
                <h4 className="text-sm font-semibold">FFN & Residuals</h4>
              </div>
              <p className="text-xs text-[#71717a] leading-relaxed">
                A two-layer feed-forward network processes each position
                independently. Residual connections and layer normalization around
                each sub-layer enable deep stacking.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
