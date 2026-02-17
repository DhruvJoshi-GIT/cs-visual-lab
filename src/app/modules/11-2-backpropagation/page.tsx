"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shuffle,
  Zap,
  TrendingDown,
  Layers,
  Activity,
  Target,
  ChevronDown,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ───────────────────────────────────────────────────────────────────

type ActivationFn = "relu" | "sigmoid" | "tanh";

type Phase = "idle" | "forward" | "loss" | "backward" | "update";

type Dataset = "xor" | "and" | "or" | "circle";

interface Neuron {
  id: string;
  layer: number;
  index: number;
  value: number; // activation output
  preActivation: number; // z = sum(w*x) + b
  gradient: number; // dL/da
  bias: number;
  biasGradient: number;
}

interface Connection {
  from: string;
  to: string;
  weight: number;
  gradient: number;
  deltaWeight: number;
}

interface TrainingSample {
  inputs: number[];
  target: number[];
}

interface HoverInfo {
  neuron: Neuron;
  x: number;
  y: number;
  incomingWeights: { weight: number; inputValue: number; fromId: string }[];
  outgoingGradients: { gradient: number; toId: string }[];
}

// ─── Neural Network Engine ───────────────────────────────────────────────────

function xavierInit(fanIn: number, fanOut: number): number {
  const std = Math.sqrt(2.0 / (fanIn + fanOut));
  return randn() * std;
}

function randn(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function activate(x: number, fn: ActivationFn): number {
  switch (fn) {
    case "relu":
      return Math.max(0, x);
    case "sigmoid":
      return 1 / (1 + Math.exp(-clamp(x, -500, 500)));
    case "tanh":
      return Math.tanh(x);
  }
}

function activateDerivative(x: number, fn: ActivationFn): number {
  switch (fn) {
    case "relu":
      return x > 0 ? 1 : 0;
    case "sigmoid": {
      const s = activate(x, "sigmoid");
      return s * (1 - s);
    }
    case "tanh": {
      const t = Math.tanh(x);
      return 1 - t * t;
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function buildNetwork(
  layerSizes: number[]
): { neurons: Neuron[]; connections: Connection[] } {
  const neurons: Neuron[] = [];
  const connections: Connection[] = [];

  for (let l = 0; l < layerSizes.length; l++) {
    for (let i = 0; i < layerSizes[l]; i++) {
      neurons.push({
        id: `${l}-${i}`,
        layer: l,
        index: i,
        value: 0,
        preActivation: 0,
        gradient: 0,
        bias: l === 0 ? 0 : (Math.random() - 0.5) * 0.1,
        biasGradient: 0,
      });
    }
  }

  for (let l = 1; l < layerSizes.length; l++) {
    const fanIn = layerSizes[l - 1];
    const fanOut = layerSizes[l];
    for (let i = 0; i < layerSizes[l - 1]; i++) {
      for (let j = 0; j < layerSizes[l]; j++) {
        connections.push({
          from: `${l - 1}-${i}`,
          to: `${l}-${j}`,
          weight: xavierInit(fanIn, fanOut),
          gradient: 0,
          deltaWeight: 0,
        });
      }
    }
  }

  return { neurons, connections };
}

function forwardPass(
  neurons: Neuron[],
  connections: Connection[],
  inputs: number[],
  activation: ActivationFn,
  layerSizes: number[]
): Neuron[] {
  const updated = neurons.map((n) => ({ ...n }));
  const neuronMap = new Map(updated.map((n) => [n.id, n]));

  // Set input values
  for (let i = 0; i < layerSizes[0]; i++) {
    const n = neuronMap.get(`0-${i}`)!;
    n.value = inputs[i] ?? 0;
    n.preActivation = n.value;
  }

  // Forward through hidden + output layers
  for (let l = 1; l < layerSizes.length; l++) {
    const isOutput = l === layerSizes.length - 1;
    for (let j = 0; j < layerSizes[l]; j++) {
      const n = neuronMap.get(`${l}-${j}`)!;
      let z = n.bias;
      for (const c of connections) {
        if (c.to === n.id) {
          const from = neuronMap.get(c.from)!;
          z += from.value * c.weight;
        }
      }
      n.preActivation = z;
      // Output layer uses sigmoid for binary classification
      n.value = isOutput ? activate(z, "sigmoid") : activate(z, activation);
    }
  }

  return updated;
}

function computeLoss(neurons: Neuron[], targets: number[], layerSizes: number[]): number {
  const outputLayer = layerSizes.length - 1;
  let loss = 0;
  for (let i = 0; i < layerSizes[outputLayer]; i++) {
    const n = neurons.find((n) => n.id === `${outputLayer}-${i}`)!;
    const diff = n.value - targets[i];
    loss += diff * diff;
  }
  return loss / layerSizes[outputLayer];
}

function backwardPass(
  neurons: Neuron[],
  connections: Connection[],
  targets: number[],
  activation: ActivationFn,
  layerSizes: number[]
): { neurons: Neuron[]; connections: Connection[] } {
  const nMap = new Map(neurons.map((n) => [n.id, { ...n, gradient: 0, biasGradient: 0 }]));
  const conns = connections.map((c) => ({ ...c, gradient: 0 }));
  const outputLayer = layerSizes.length - 1;

  // Output layer gradients (MSE + sigmoid derivative)
  for (let i = 0; i < layerSizes[outputLayer]; i++) {
    const n = nMap.get(`${outputLayer}-${i}`)!;
    const dLoss = (2 * (n.value - targets[i])) / layerSizes[outputLayer];
    const dSigmoid = n.value * (1 - n.value); // sigmoid derivative
    n.gradient = dLoss * dSigmoid;
    n.biasGradient = n.gradient;
  }

  // Hidden layers gradients (backpropagate)
  for (let l = outputLayer - 1; l >= 1; l--) {
    for (let i = 0; i < layerSizes[l]; i++) {
      const n = nMap.get(`${l}-${i}`)!;
      let gradSum = 0;
      for (const c of conns) {
        if (c.from === n.id) {
          const toN = nMap.get(c.to)!;
          gradSum += toN.gradient * c.weight;
        }
      }
      n.gradient = gradSum * activateDerivative(n.preActivation, activation);
      n.biasGradient = n.gradient;
    }
  }

  // Compute weight gradients
  for (const c of conns) {
    const fromN = nMap.get(c.from)!;
    const toN = nMap.get(c.to)!;
    c.gradient = toN.gradient * fromN.value;
  }

  return { neurons: Array.from(nMap.values()), connections: conns };
}

function updateWeights(
  neurons: Neuron[],
  connections: Connection[],
  lr: number
): { neurons: Neuron[]; connections: Connection[] } {
  const updatedNeurons = neurons.map((n) => ({
    ...n,
    bias: n.bias - lr * n.biasGradient,
  }));
  const updatedConns = connections.map((c) => ({
    ...c,
    deltaWeight: -lr * c.gradient,
    weight: c.weight - lr * c.gradient,
  }));
  return { neurons: updatedNeurons, connections: updatedConns };
}

// ─── Datasets ────────────────────────────────────────────────────────────────

const DATASETS: Record<Dataset, { name: string; samples: TrainingSample[] }> = {
  xor: {
    name: "XOR",
    samples: [
      { inputs: [0, 0], target: [0] },
      { inputs: [0, 1], target: [1] },
      { inputs: [1, 0], target: [1] },
      { inputs: [1, 1], target: [0] },
    ],
  },
  and: {
    name: "AND",
    samples: [
      { inputs: [0, 0], target: [0] },
      { inputs: [0, 1], target: [0] },
      { inputs: [1, 0], target: [0] },
      { inputs: [1, 1], target: [1] },
    ],
  },
  or: {
    name: "OR",
    samples: [
      { inputs: [0, 0], target: [0] },
      { inputs: [0, 1], target: [1] },
      { inputs: [1, 0], target: [1] },
      { inputs: [1, 1], target: [1] },
    ],
  },
  circle: {
    name: "Circle",
    samples: (() => {
      const s: TrainingSample[] = [];
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const r = 0.3 + Math.random() * 0.1;
        s.push({ inputs: [0.5 + r * Math.cos(angle), 0.5 + r * Math.sin(angle)], target: [1] });
      }
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const r = 0.7 + Math.random() * 0.1;
        s.push({
          inputs: [
            clamp(0.5 + r * Math.cos(angle), 0, 1),
            clamp(0.5 + r * Math.sin(angle), 0, 1),
          ],
          target: [0],
        });
      }
      return s;
    })(),
  },
};

// ─── Phase Colors & Labels ───────────────────────────────────────────────────

const PHASE_CONFIG: Record<Phase, { label: string; color: string; bgColor: string }> = {
  idle: { label: "Ready", color: "#71717a", bgColor: "#71717a20" },
  forward: { label: "Forward Pass", color: "#06b6d4", bgColor: "#06b6d420" },
  loss: { label: "Loss Computation", color: "#f59e0b", bgColor: "#f59e0b20" },
  backward: { label: "Backward Pass", color: "#ef4444", bgColor: "#ef444420" },
  update: { label: "Weight Update", color: "#10b981", bgColor: "#10b98120" },
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function BackpropagationPage() {
  // Network config
  const [hiddenLayerCount, setHiddenLayerCount] = useState(2);
  const [neuronsPerHidden, setNeuronsPerHidden] = useState(4);
  const [learningRate, setLearningRate] = useState(0.5);
  const [activationFn, setActivationFn] = useState<ActivationFn>("tanh");
  const [dataset, setDataset] = useState<Dataset>("xor");

  // Build layer sizes
  const layerSizes = useMemo(() => {
    const sizes = [2]; // input
    for (let i = 0; i < hiddenLayerCount; i++) sizes.push(neuronsPerHidden);
    sizes.push(1); // output
    return sizes;
  }, [hiddenLayerCount, neuronsPerHidden]);

  // Network state
  const [neurons, setNeurons] = useState<Neuron[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [currentSampleIdx, setCurrentSampleIdx] = useState(0);
  const [lossHistory, setLossHistory] = useState<number[]>([]);
  const [stepCount, setStepCount] = useState(0);
  const [currentLoss, setCurrentLoss] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [animProgress, setAnimProgress] = useState(0);
  const [activeLayerIdx, setActiveLayerIdx] = useState(-1);
  const [showDatasetDropdown, setShowDatasetDropdown] = useState(false);
  const [showActivationDropdown, setShowActivationDropdown] = useState(false);

  const playIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const phaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize network
  const initNetwork = useCallback(() => {
    const { neurons: n, connections: c } = buildNetwork(layerSizes);
    setNeurons(n);
    setConnections(c);
    setPhase("idle");
    setLossHistory([]);
    setStepCount(0);
    setCurrentLoss(0);
    setCurrentSampleIdx(0);
    setActiveLayerIdx(-1);
    setAnimProgress(0);
    setIsPlaying(false);
    if (playIntervalRef.current) clearTimeout(playIntervalRef.current);
    if (phaseTimeoutRef.current) clearTimeout(phaseTimeoutRef.current);
  }, [layerSizes]);

  useEffect(() => {
    initNetwork();
  }, [initNetwork]);

  // Training step logic (phases animated sequentially)
  const runTrainingStep = useCallback(() => {
    const samples = DATASETS[dataset].samples;
    const sample = samples[currentSampleIdx % samples.length];
    const phaseDuration = Math.max(200, 800 / speed);

    // Phase 1: Forward
    setPhase("forward");
    setAnimProgress(0);

    // Animate forward pass layer by layer
    const totalLayers = layerSizes.length;
    let layerDelay = 0;
    const layerDuration = phaseDuration / totalLayers;

    for (let l = 0; l < totalLayers; l++) {
      setTimeout(() => {
        setActiveLayerIdx(l);
        setAnimProgress((l + 1) / totalLayers);
      }, layerDelay);
      layerDelay += layerDuration;
    }

    setTimeout(() => {
      const fwdNeurons = forwardPass(neurons, connections, sample.inputs, activationFn, layerSizes);
      setNeurons(fwdNeurons);

      // Phase 2: Loss
      setPhase("loss");
      setActiveLayerIdx(layerSizes.length - 1);
      const loss = computeLoss(fwdNeurons, sample.target, layerSizes);
      setCurrentLoss(loss);

      setTimeout(() => {
        // Phase 3: Backward
        setPhase("backward");
        setAnimProgress(0);

        const { neurons: bwdNeurons, connections: bwdConns } = backwardPass(
          fwdNeurons,
          connections,
          sample.target,
          activationFn,
          layerSizes
        );
        setNeurons(bwdNeurons);
        setConnections(bwdConns);

        // Animate backward layer by layer
        let bwdDelay = 0;
        for (let l = totalLayers - 1; l >= 0; l--) {
          setTimeout(() => {
            setActiveLayerIdx(l);
            setAnimProgress(1 - l / totalLayers);
          }, bwdDelay);
          bwdDelay += layerDuration;
        }

        setTimeout(() => {
          // Phase 4: Update
          setPhase("update");
          setAnimProgress(1);

          const { neurons: updNeurons, connections: updConns } = updateWeights(
            bwdNeurons,
            bwdConns,
            learningRate
          );
          setNeurons(updNeurons);
          setConnections(updConns);

          // Record loss
          setLossHistory((prev) => [...prev.slice(-199), loss]);
          setStepCount((prev) => prev + 1);
          setCurrentSampleIdx((prev) => (prev + 1) % samples.length);

          setTimeout(() => {
            setPhase("idle");
            setActiveLayerIdx(-1);
            setAnimProgress(0);
          }, phaseDuration * 0.3);
        }, phaseDuration);
      }, phaseDuration * 0.5);
    }, phaseDuration);
  }, [neurons, connections, dataset, currentSampleIdx, activationFn, layerSizes, learningRate, speed]);

  // Quick train epoch (no animation)
  const trainEpoch = useCallback(() => {
    const samples = DATASETS[dataset].samples;
    let currentNeurons = [...neurons.map((n) => ({ ...n }))];
    let currentConns = [...connections.map((c) => ({ ...c }))];
    let totalLoss = 0;

    for (const sample of samples) {
      currentNeurons = forwardPass(currentNeurons, currentConns, sample.inputs, activationFn, layerSizes);
      totalLoss += computeLoss(currentNeurons, sample.target, layerSizes);

      const bwd = backwardPass(currentNeurons, currentConns, sample.target, activationFn, layerSizes);
      currentNeurons = bwd.neurons;
      currentConns = bwd.connections;

      const upd = updateWeights(currentNeurons, currentConns, learningRate);
      currentNeurons = upd.neurons;
      currentConns = upd.connections;
    }

    const avgLoss = totalLoss / samples.length;
    setNeurons(currentNeurons);
    setConnections(currentConns);
    setCurrentLoss(avgLoss);
    setLossHistory((prev) => [...prev.slice(-199), avgLoss]);
    setStepCount((prev) => prev + 1);
  }, [neurons, connections, dataset, activationFn, layerSizes, learningRate]);

  // Auto-play
  useEffect(() => {
    if (isPlaying && phase === "idle") {
      playIntervalRef.current = setTimeout(() => {
        runTrainingStep();
      }, 100);
    }
    return () => {
      if (playIntervalRef.current) clearTimeout(playIntervalRef.current);
    };
  }, [isPlaying, phase, runTrainingStep]);

  // SVG layout
  const svgWidth = 900;
  const svgHeight = 500;
  const layerSpacing = svgWidth / (layerSizes.length + 1);

  const getNeuronPos = useCallback(
    (layerIdx: number, neuronIdx: number): { x: number; y: number } => {
      const x = (layerIdx + 1) * layerSpacing;
      const count = layerSizes[layerIdx];
      const totalHeight = (count - 1) * 70;
      const startY = svgHeight / 2 - totalHeight / 2;
      const y = startY + neuronIdx * 70;
      return { x, y };
    },
    [layerSizes, layerSpacing, svgHeight]
  );

  const neuronRadius = 24;

  // Compute accuracy
  const accuracy = useMemo(() => {
    if (neurons.length === 0 || connections.length === 0) return 0;
    const samples = DATASETS[dataset].samples;
    let correct = 0;
    for (const sample of samples) {
      const fwd = forwardPass(neurons, connections, sample.inputs, activationFn, layerSizes);
      const outputLayer = layerSizes.length - 1;
      const output = fwd.find((n) => n.id === `${outputLayer}-0`)!;
      const predicted = output.value >= 0.5 ? 1 : 0;
      if (predicted === sample.target[0]) correct++;
    }
    return correct / samples.length;
  }, [neurons, connections, dataset, activationFn, layerSizes]);

  // Avg gradient magnitude
  const avgGradMag = useMemo(() => {
    if (connections.length === 0) return 0;
    const sum = connections.reduce((acc, c) => acc + Math.abs(c.gradient), 0);
    return sum / connections.length;
  }, [connections]);

  // Hover handler
  const handleNeuronHover = useCallback(
    (neuron: Neuron, event: React.MouseEvent) => {
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (!svgRect) return;

      const incomingWeights = connections
        .filter((c) => c.to === neuron.id)
        .map((c) => ({
          weight: c.weight,
          inputValue: neurons.find((n) => n.id === c.from)?.value ?? 0,
          fromId: c.from,
        }));

      const outgoingGradients = connections
        .filter((c) => c.from === neuron.id)
        .map((c) => ({
          gradient: c.gradient,
          toId: c.to,
        }));

      setHoverInfo({
        neuron,
        x: event.clientX,
        y: event.clientY,
        incomingWeights,
        outgoingGradients,
      });
    },
    [connections, neurons]
  );

  // Loss sparkline
  const lossSparkline = useMemo(() => {
    if (lossHistory.length < 2) return "";
    const maxLoss = Math.max(...lossHistory, 0.01);
    const w = 260;
    const h = 80;
    const points = lossHistory.map((l, i) => {
      const x = (i / (lossHistory.length - 1)) * w;
      const y = h - (l / maxLoss) * (h - 8);
      return `${x},${y}`;
    });
    return points.join(" ");
  }, [lossHistory]);

  const lossAreaPath = useMemo(() => {
    if (lossHistory.length < 2) return "";
    const maxLoss = Math.max(...lossHistory, 0.01);
    const w = 260;
    const h = 80;
    const points = lossHistory.map((l, i) => {
      const x = (i / (lossHistory.length - 1)) * w;
      const y = h - (l / maxLoss) * (h - 8);
      return `${x},${y}`;
    });
    return `M0,${h} L${points.join(" L")} L${w},${h} Z`;
  }, [lossHistory]);

  // Connection bezier curve
  const getConnectionPath = useCallback(
    (fromId: string, toId: string): string => {
      const fromNeuron = neurons.find((n) => n.id === fromId);
      const toNeuron = neurons.find((n) => n.id === toId);
      if (!fromNeuron || !toNeuron) return "";
      const from = getNeuronPos(fromNeuron.layer, fromNeuron.index);
      const to = getNeuronPos(toNeuron.layer, toNeuron.index);
      const cx = (from.x + to.x) / 2;
      return `M${from.x + neuronRadius},${from.y} Q${cx},${from.y} ${cx},${(from.y + to.y) / 2} Q${cx},${to.y} ${to.x - neuronRadius},${to.y}`;
    },
    [neurons, getNeuronPos]
  );

  // Get neuron color based on phase and value
  const getNeuronFill = useCallback(
    (neuron: Neuron): string => {
      if (neuron.layer === 0) {
        const intensity = clamp(Math.abs(neuron.value), 0, 1);
        const r = Math.round(6 + intensity * 93);
        const g = Math.round(6 + intensity * 176);
        const b = Math.round(15 + intensity * 197);
        return `rgb(${r},${g},${b})`;
      }

      if (phase === "backward" || phase === "update") {
        const gradMag = clamp(Math.abs(neuron.gradient) * 3, 0, 1);
        // amber to red
        const r = Math.round(245 - gradMag * 6);
        const g = Math.round(158 - gradMag * 114);
        const b = Math.round(11 + gradMag * 57);
        return `rgb(${r},${g},${b})`;
      }

      const act = clamp(Math.abs(neuron.value), 0, 1);
      const r = Math.round(17 + act * 82);
      const g = Math.round(17 + act * 85);
      const b = Math.round(24 + act * 217);
      return `rgb(${r},${g},${b})`;
    },
    [phase]
  );

  // Get neuron glow
  const getNeuronGlow = useCallback(
    (neuron: Neuron): string => {
      if (phase === "forward" && neuron.layer === activeLayerIdx) {
        return "0 0 20px rgba(6,182,212,0.6)";
      }
      if (phase === "backward" && neuron.layer === activeLayerIdx) {
        return "0 0 20px rgba(239,68,68,0.6)";
      }
      if (phase === "update") {
        return "0 0 16px rgba(16,185,129,0.4)";
      }
      const act = Math.abs(neuron.value);
      if (act > 0.5) {
        return `0 0 ${12 * act}px rgba(99,102,241,${0.3 * act})`;
      }
      return "none";
    },
    [phase, activeLayerIdx]
  );

  // Connection color
  const getConnectionColor = useCallback(
    (conn: Connection): string => {
      if (phase === "backward" || phase === "update") {
        const gradMag = clamp(Math.abs(conn.gradient) * 5, 0, 1);
        if (conn.gradient >= 0) {
          return `rgba(245,158,11,${0.15 + gradMag * 0.7})`;
        }
        return `rgba(239,68,68,${0.15 + gradMag * 0.7})`;
      }
      const mag = clamp(Math.abs(conn.weight) * 2, 0, 1);
      if (conn.weight >= 0) {
        return `rgba(6,182,212,${0.1 + mag * 0.6})`;
      }
      return `rgba(244,63,94,${0.1 + mag * 0.6})`;
    },
    [phase]
  );

  const getConnectionWidth = useCallback((conn: Connection): number => {
    return clamp(Math.abs(conn.weight) * 3, 0.5, 4);
  }, []);

  // Phase indicator circles
  const phases: Phase[] = ["forward", "loss", "backward", "update"];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />
      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-1 rounded-md bg-[#6366f1]/15 text-[#6366f1] text-xs font-mono font-semibold tracking-wide">
                11.2
              </span>
              <h1 className="text-2xl font-bold tracking-tight">Backpropagation</h1>
            </div>
            <p className="text-[#a1a1aa] text-sm max-w-2xl">
              Watch data flow forward through a neural network, then gradients flow backward.
              The network learns by adjusting its weights to minimize the loss.
            </p>
          </div>

          {/* Phase Indicator */}
          <div className="flex items-center gap-2 mb-4">
            {phases.map((p) => {
              const config = PHASE_CONFIG[p];
              const isActive = phase === p;
              return (
                <motion.div
                  key={p}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                  style={{
                    backgroundColor: isActive ? config.bgColor : "transparent",
                    borderColor: isActive ? config.color + "40" : "#1e1e2e",
                    color: isActive ? config.color : "#71717a",
                  }}
                  animate={{ scale: isActive ? 1.05 : 1 }}
                  transition={{ duration: 0.2 }}
                >
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: isActive ? config.color : "#2a2a3e",
                      boxShadow: isActive ? `0 0 8px ${config.color}60` : "none",
                    }}
                  />
                  {config.label}
                </motion.div>
              );
            })}
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">
            {/* Neural Network SVG */}
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 relative overflow-hidden">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                className="w-full h-auto"
                style={{ minHeight: 400 }}
                onMouseLeave={() => setHoverInfo(null)}
              >
                <defs>
                  {/* Radial gradient for neurons */}
                  <radialGradient id="neuronGradBase" cx="35%" cy="35%" r="65%">
                    <stop offset="0%" stopColor="#2a2a3e" />
                    <stop offset="100%" stopColor="#111118" />
                  </radialGradient>

                  {/* Glow filter */}
                  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>

                  <filter id="glowStrong" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="8" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>

                  {/* Gradient for loss sparkline */}
                  <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
                  </linearGradient>

                  {/* Animated dash for backward pass */}
                  <pattern
                    id="backwardDash"
                    patternUnits="userSpaceOnUse"
                    width="12"
                    height="1"
                  >
                    <rect width="6" height="1" fill="#f59e0b" />
                  </pattern>

                  {/* Marker for gradient flow arrow */}
                  <marker
                    id="arrowBackward"
                    markerWidth="6"
                    markerHeight="6"
                    refX="3"
                    refY="3"
                    orient="auto-start-reverse"
                  >
                    <path d="M0,1 L6,3 L0,5" fill="#f59e0b" opacity="0.6" />
                  </marker>

                  {/* Animated flow particle gradient */}
                  <radialGradient id="flowParticle">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity="1" />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                  </radialGradient>

                  <radialGradient id="backflowParticle">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="1" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
                  </radialGradient>
                </defs>

                {/* Background grid */}
                <g opacity="0.05">
                  {Array.from({ length: Math.floor(svgWidth / 30) + 1 }, (_, i) => (
                    <line
                      key={`vg${i}`}
                      x1={i * 30}
                      y1={0}
                      x2={i * 30}
                      y2={svgHeight}
                      stroke="#6366f1"
                      strokeWidth="0.5"
                    />
                  ))}
                  {Array.from({ length: Math.floor(svgHeight / 30) + 1 }, (_, i) => (
                    <line
                      key={`hg${i}`}
                      x1={0}
                      y1={i * 30}
                      x2={svgWidth}
                      y2={i * 30}
                      stroke="#6366f1"
                      strokeWidth="0.5"
                    />
                  ))}
                </g>

                {/* Layer labels */}
                {layerSizes.map((_, l) => {
                  const x = (l + 1) * layerSpacing;
                  const label =
                    l === 0
                      ? "Input"
                      : l === layerSizes.length - 1
                        ? "Output"
                        : `Hidden ${l}`;
                  return (
                    <text
                      key={`label-${l}`}
                      x={x}
                      y={28}
                      textAnchor="middle"
                      fill="#71717a"
                      fontSize="11"
                      fontFamily="monospace"
                    >
                      {label}
                    </text>
                  );
                })}

                {/* Connections */}
                {connections.map((conn) => {
                  const path = getConnectionPath(conn.from, conn.to);
                  if (!path) return null;
                  const isBackward = phase === "backward" || phase === "update";
                  const color = getConnectionColor(conn);
                  const width = getConnectionWidth(conn);

                  return (
                    <g key={`${conn.from}-${conn.to}`}>
                      {/* Base connection */}
                      <motion.path
                        d={path}
                        fill="none"
                        stroke={color}
                        strokeWidth={width}
                        strokeLinecap="round"
                        initial={false}
                        animate={{
                          strokeWidth: phase === "update" ? width + 1 : width,
                          opacity: 1,
                        }}
                        transition={{ duration: 0.3 }}
                      />

                      {/* Backward pass animated dashes */}
                      {isBackward && Math.abs(conn.gradient) > 0.001 && (
                        <motion.path
                          d={path}
                          fill="none"
                          stroke={conn.gradient >= 0 ? "#f59e0b" : "#ef4444"}
                          strokeWidth={clamp(Math.abs(conn.gradient) * 8, 0.5, 3)}
                          strokeLinecap="round"
                          strokeDasharray="4 8"
                          initial={{ strokeDashoffset: 0 }}
                          animate={{ strokeDashoffset: -48 }}
                          transition={{
                            duration: 1.5 / speed,
                            repeat: Infinity,
                            ease: "linear",
                          }}
                          opacity={0.7}
                        />
                      )}

                      {/* Forward pass flow particles */}
                      {phase === "forward" && (
                        <motion.circle
                          r={3}
                          fill={conn.weight >= 0 ? "#06b6d4" : "#f43f5e"}
                          filter="url(#glow)"
                          opacity={0}
                          initial={{ opacity: 0 }}
                          animate={{
                            opacity: [0, 0.9, 0],
                          }}
                          transition={{
                            duration: 1.2 / speed,
                            repeat: Infinity,
                            delay: Math.random() * 0.5,
                          }}
                        >
                          <animateMotion
                            dur={`${1.2 / speed}s`}
                            repeatCount="indefinite"
                            path={path}
                          />
                        </motion.circle>
                      )}

                      {/* Backward pass flow particles */}
                      {isBackward && Math.abs(conn.gradient) > 0.01 && (
                        <motion.circle
                          r={2.5}
                          fill={conn.gradient >= 0 ? "#f59e0b" : "#ef4444"}
                          filter="url(#glow)"
                          opacity={0}
                          initial={{ opacity: 0 }}
                          animate={{
                            opacity: [0, 0.8, 0],
                          }}
                          transition={{
                            duration: 1.0 / speed,
                            repeat: Infinity,
                            delay: Math.random() * 0.4,
                          }}
                        >
                          <animateMotion
                            dur={`${1.0 / speed}s`}
                            repeatCount="indefinite"
                            path={path}
                            keyPoints="1;0"
                            keyTimes="0;1"
                          />
                        </motion.circle>
                      )}

                      {/* Update phase flash */}
                      {phase === "update" && Math.abs(conn.deltaWeight) > 0.001 && (
                        <motion.path
                          d={path}
                          fill="none"
                          stroke="#10b981"
                          strokeWidth={width + 2}
                          strokeLinecap="round"
                          initial={{ opacity: 0.8 }}
                          animate={{ opacity: 0 }}
                          transition={{ duration: 0.6 }}
                        />
                      )}
                    </g>
                  );
                })}

                {/* Neurons */}
                {neurons.map((neuron) => {
                  const pos = getNeuronPos(neuron.layer, neuron.index);
                  const isActiveLayer = neuron.layer === activeLayerIdx;
                  const fillColor = getNeuronFill(neuron);

                  return (
                    <g
                      key={neuron.id}
                      onMouseEnter={(e) => handleNeuronHover(neuron, e)}
                      onMouseMove={(e) => handleNeuronHover(neuron, e)}
                      onMouseLeave={() => setHoverInfo(null)}
                      style={{ cursor: "pointer" }}
                    >
                      {/* Outer glow ring */}
                      {(isActiveLayer || Math.abs(neuron.value) > 0.5) && (
                        <motion.circle
                          cx={pos.x}
                          cy={pos.y}
                          r={neuronRadius + 6}
                          fill="none"
                          stroke={
                            phase === "backward" && isActiveLayer
                              ? "#ef4444"
                              : phase === "forward" && isActiveLayer
                                ? "#06b6d4"
                                : phase === "update"
                                  ? "#10b981"
                                  : "#6366f1"
                          }
                          strokeWidth="1.5"
                          opacity={0}
                          initial={false}
                          animate={{
                            opacity: isActiveLayer ? [0.2, 0.6, 0.2] : Math.abs(neuron.value) > 0.7 ? 0.2 : 0,
                            r: isActiveLayer ? [neuronRadius + 6, neuronRadius + 10, neuronRadius + 6] : neuronRadius + 6,
                          }}
                          transition={{
                            duration: 1 / speed,
                            repeat: isActiveLayer ? Infinity : 0,
                          }}
                        />
                      )}

                      {/* Neuron body */}
                      <motion.circle
                        cx={pos.x}
                        cy={pos.y}
                        r={neuronRadius}
                        fill={fillColor}
                        stroke={
                          isActiveLayer
                            ? phase === "backward"
                              ? "#ef4444"
                              : phase === "forward"
                                ? "#06b6d4"
                                : "#10b981"
                            : "#2a2a3e"
                        }
                        strokeWidth={isActiveLayer ? 2 : 1}
                        initial={false}
                        animate={{
                          scale: isActiveLayer ? 1.1 : 1,
                        }}
                        transition={{ duration: 0.2 }}
                        style={{
                          filter: isActiveLayer ? "url(#glow)" : "none",
                          transformOrigin: `${pos.x}px ${pos.y}px`,
                        }}
                      />

                      {/* Inner highlight for 3D effect */}
                      <circle
                        cx={pos.x - 6}
                        cy={pos.y - 6}
                        r={neuronRadius * 0.45}
                        fill="white"
                        opacity={0.06}
                      />

                      {/* Value text */}
                      <text
                        x={pos.x}
                        y={pos.y + 1}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="white"
                        fontSize="10"
                        fontFamily="monospace"
                        fontWeight="600"
                        opacity={0.9}
                      >
                        {neuron.value.toFixed(2)}
                      </text>

                      {/* Gradient value (during backprop) */}
                      {(phase === "backward" || phase === "update") && neuron.layer > 0 && (
                        <motion.text
                          x={pos.x}
                          y={pos.y + neuronRadius + 14}
                          textAnchor="middle"
                          fill="#f59e0b"
                          fontSize="8"
                          fontFamily="monospace"
                          initial={{ opacity: 0, y: pos.y + neuronRadius + 8 }}
                          animate={{ opacity: 0.8, y: pos.y + neuronRadius + 14 }}
                          transition={{ duration: 0.3 }}
                        >
                          {"\u2207"}{neuron.gradient.toFixed(3)}
                        </motion.text>
                      )}
                    </g>
                  );
                })}

                {/* Input labels */}
                {layerSizes[0] > 0 &&
                  Array.from({ length: layerSizes[0] }, (_, i) => {
                    const pos = getNeuronPos(0, i);
                    return (
                      <text
                        key={`in-label-${i}`}
                        x={pos.x - neuronRadius - 14}
                        y={pos.y + 1}
                        textAnchor="end"
                        dominantBaseline="middle"
                        fill="#71717a"
                        fontSize="10"
                        fontFamily="monospace"
                      >
                        x{i + 1}
                      </text>
                    );
                  })}

                {/* Output label */}
                {(() => {
                  const outLayer = layerSizes.length - 1;
                  const pos = getNeuronPos(outLayer, 0);
                  return (
                    <text
                      x={pos.x + neuronRadius + 14}
                      y={pos.y + 1}
                      textAnchor="start"
                      dominantBaseline="middle"
                      fill="#71717a"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {"\u0177"}
                    </text>
                  );
                })()}
              </svg>

              {/* Loss display overlay */}
              <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
                <div className="px-3 py-1.5 rounded-lg bg-[#0a0a0f]/80 border border-[#1e1e2e] backdrop-blur">
                  <span className="text-[10px] text-[#71717a] font-mono block">LOSS</span>
                  <span className="text-lg font-bold font-mono text-[#f59e0b]">
                    {currentLoss.toFixed(4)}
                  </span>
                </div>
                <div className="px-3 py-1.5 rounded-lg bg-[#0a0a0f]/80 border border-[#1e1e2e] backdrop-blur">
                  <span className="text-[10px] text-[#71717a] font-mono block">STEP</span>
                  <span className="text-sm font-bold font-mono text-[#6366f1]">{stepCount}</span>
                </div>
              </div>

              {/* Current sample display */}
              <div className="absolute bottom-4 left-4 px-3 py-1.5 rounded-lg bg-[#0a0a0f]/80 border border-[#1e1e2e] backdrop-blur">
                <span className="text-[10px] text-[#71717a] font-mono">SAMPLE: </span>
                <span className="text-xs font-mono text-[#a1a1aa]">
                  [{DATASETS[dataset].samples[currentSampleIdx % DATASETS[dataset].samples.length]?.inputs.join(", ")}]
                  {" \u2192 "}
                  [{DATASETS[dataset].samples[currentSampleIdx % DATASETS[dataset].samples.length]?.target.join(", ")}]
                </span>
              </div>
            </div>

            {/* Right Sidebar */}
            <div className="flex flex-col gap-3">
              {/* Loss Chart */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingDown size={14} className="text-[#6366f1]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] tracking-wide uppercase">
                    Loss History
                  </span>
                </div>
                <div className="relative w-full" style={{ height: 80 }}>
                  <svg viewBox="0 0 260 80" className="w-full h-full">
                    {lossAreaPath && (
                      <path d={lossAreaPath} fill="url(#lossGrad)" />
                    )}
                    {lossSparkline && (
                      <polyline
                        points={lossSparkline}
                        fill="none"
                        stroke="#6366f1"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    )}
                    {lossHistory.length > 0 && (
                      <circle
                        cx={260}
                        cy={
                          80 -
                          (lossHistory[lossHistory.length - 1] / Math.max(...lossHistory, 0.01)) *
                            72
                        }
                        r="3"
                        fill="#6366f1"
                      >
                        <animate
                          attributeName="opacity"
                          values="1;0.4;1"
                          dur="1.5s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    )}
                  </svg>
                  {lossHistory.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-[#71717a] text-xs font-mono">
                      No training data yet
                    </div>
                  )}
                </div>
              </div>

              {/* Network Config */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Layers size={14} className="text-[#06b6d4]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] tracking-wide uppercase">
                    Network
                  </span>
                </div>

                {/* Hidden layers */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] text-[#71717a] font-mono">HIDDEN LAYERS</label>
                    <span className="text-xs text-white font-mono">{hiddenLayerCount}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={1}
                    value={hiddenLayerCount}
                    onChange={(e) => setHiddenLayerCount(parseInt(e.target.value))}
                    className="w-full h-1.5 accent-[#06b6d4] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#06b6d4]"
                  />
                </div>

                {/* Neurons per layer */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] text-[#71717a] font-mono">NEURONS / HIDDEN</label>
                    <span className="text-xs text-white font-mono">{neuronsPerHidden}</span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={8}
                    step={1}
                    value={neuronsPerHidden}
                    onChange={(e) => setNeuronsPerHidden(parseInt(e.target.value))}
                    className="w-full h-1.5 accent-[#06b6d4] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#06b6d4]"
                  />
                </div>

                {/* Learning rate (log scale) */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] text-[#71717a] font-mono">LEARNING RATE</label>
                    <span className="text-xs text-white font-mono">{learningRate.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min={-3}
                    max={0}
                    step={0.05}
                    value={Math.log10(learningRate)}
                    onChange={(e) =>
                      setLearningRate(Math.pow(10, parseFloat(e.target.value)))
                    }
                    className="w-full h-1.5 accent-[#06b6d4] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#06b6d4]"
                  />
                </div>

                {/* Activation function */}
                <div className="relative">
                  <label className="text-[10px] text-[#71717a] font-mono block mb-1">
                    ACTIVATION
                  </label>
                  <button
                    onClick={() => setShowActivationDropdown(!showActivationDropdown)}
                    className="w-full flex items-center justify-between px-3 py-1.5 bg-[#1e1e2e] border border-[#2a2a3e] rounded-lg text-xs font-mono text-white hover:bg-[#16161f] transition-colors"
                  >
                    {activationFn.toUpperCase()}
                    <ChevronDown size={12} className="text-[#71717a]" />
                  </button>
                  <AnimatePresence>
                    {showActivationDropdown && (
                      <motion.div
                        className="absolute top-full left-0 right-0 mt-1 z-20 bg-[#111118] border border-[#2a2a3e] rounded-lg overflow-hidden shadow-xl"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                      >
                        {(["relu", "sigmoid", "tanh"] as ActivationFn[]).map((fn) => (
                          <button
                            key={fn}
                            onClick={() => {
                              setActivationFn(fn);
                              setShowActivationDropdown(false);
                            }}
                            className={`w-full px-3 py-1.5 text-left text-xs font-mono transition-colors ${
                              activationFn === fn
                                ? "bg-[#6366f1]/20 text-[#6366f1]"
                                : "text-[#a1a1aa] hover:bg-[#1e1e2e]"
                            }`}
                          >
                            {fn.toUpperCase()}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Dataset */}
                <div className="relative">
                  <label className="text-[10px] text-[#71717a] font-mono block mb-1">
                    DATASET
                  </label>
                  <button
                    onClick={() => setShowDatasetDropdown(!showDatasetDropdown)}
                    className="w-full flex items-center justify-between px-3 py-1.5 bg-[#1e1e2e] border border-[#2a2a3e] rounded-lg text-xs font-mono text-white hover:bg-[#16161f] transition-colors"
                  >
                    {DATASETS[dataset].name}
                    <ChevronDown size={12} className="text-[#71717a]" />
                  </button>
                  <AnimatePresence>
                    {showDatasetDropdown && (
                      <motion.div
                        className="absolute top-full left-0 right-0 mt-1 z-20 bg-[#111118] border border-[#2a2a3e] rounded-lg overflow-hidden shadow-xl"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                      >
                        {(Object.keys(DATASETS) as Dataset[]).map((d) => (
                          <button
                            key={d}
                            onClick={() => {
                              setDataset(d);
                              setShowDatasetDropdown(false);
                            }}
                            className={`w-full px-3 py-1.5 text-left text-xs font-mono transition-colors ${
                              dataset === d
                                ? "bg-[#6366f1]/20 text-[#6366f1]"
                                : "text-[#a1a1aa] hover:bg-[#1e1e2e]"
                            }`}
                          >
                            {DATASETS[d].name}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={initNetwork}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#1e1e2e] hover:bg-[#2a2a3e] border border-[#2a2a3e] rounded-lg text-xs text-[#a1a1aa] hover:text-white transition-all"
                  >
                    <Shuffle size={12} />
                    Randomize
                  </button>
                  <button
                    onClick={trainEpoch}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#6366f1]/15 hover:bg-[#6366f1]/25 border border-[#6366f1]/30 rounded-lg text-xs text-[#6366f1] hover:text-white transition-all"
                  >
                    <Zap size={12} />
                    Train Epoch
                  </button>
                </div>
              </div>

              {/* Metrics */}
              <AnimatePresence>
                {showMetrics && (
                  <motion.div
                    className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 space-y-2"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Activity size={14} className="text-[#10b981]" />
                      <span className="text-xs font-semibold text-[#a1a1aa] tracking-wide uppercase">
                        Metrics
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <MetricCard label="Loss" value={currentLoss.toFixed(4)} color="#f59e0b" />
                      <MetricCard label="Steps" value={stepCount.toString()} color="#6366f1" />
                      <MetricCard label="LR" value={learningRate.toFixed(4)} color="#06b6d4" />
                      <MetricCard
                        label="Avg |grad|"
                        value={avgGradMag.toFixed(4)}
                        color="#ef4444"
                      />
                      <MetricCard
                        label="Accuracy"
                        value={`${(accuracy * 100).toFixed(0)}%`}
                        color="#10b981"
                      />
                      <MetricCard
                        label="Arch"
                        value={layerSizes.join("-")}
                        color="#a1a1aa"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Controls */}
          <div className="mt-4">
            <ModuleControls
              isPlaying={isPlaying}
              onPlay={() => setIsPlaying(true)}
              onPause={() => {
                setIsPlaying(false);
                if (playIntervalRef.current) clearTimeout(playIntervalRef.current);
              }}
              onStep={() => {
                if (phase === "idle") runTrainingStep();
              }}
              onReset={initNetwork}
              speed={speed}
              onSpeedChange={setSpeed}
              showMetrics={showMetrics}
              onToggleMetrics={() => setShowMetrics(!showMetrics)}
            >
              {/* Extra controls in the bar */}
              <button
                onClick={trainEpoch}
                className="flex items-center gap-1.5 px-3 h-10 rounded-lg bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#a1a1aa] hover:text-white text-xs font-medium transition-all"
              >
                <Target size={14} />
                Train Epoch
              </button>
            </ModuleControls>
          </div>
        </div>
      </div>

      {/* Neuron Hover Tooltip */}
      <AnimatePresence>
        {hoverInfo && (
          <motion.div
            className="fixed z-50 pointer-events-none"
            style={{
              left: Math.min(hoverInfo.x + 16, (typeof window !== "undefined" ? window.innerWidth : 1200) - 300),
              top: Math.min(hoverInfo.y - 10, (typeof window !== "undefined" ? window.innerHeight : 800) - 300),
            }}
            initial={{ opacity: 0, scale: 0.95, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ duration: 0.15 }}
          >
            <div className="bg-[#111118]/95 border border-[#2a2a3e] rounded-xl p-3 backdrop-blur-xl shadow-2xl min-w-[220px] max-w-[280px]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-[#71717a] font-mono uppercase">
                  {hoverInfo.neuron.layer === 0
                    ? "Input"
                    : hoverInfo.neuron.layer === layerSizes.length - 1
                      ? "Output"
                      : `Hidden L${hoverInfo.neuron.layer}`}
                  {" ["}
                  {hoverInfo.neuron.index}
                  {"]"}
                </span>
                <span className="text-xs text-white font-mono font-bold">
                  {hoverInfo.neuron.id}
                </span>
              </div>

              {/* Activation output */}
              <div className="flex justify-between items-center py-1 border-b border-[#1e1e2e]">
                <span className="text-[10px] text-[#71717a] font-mono">Output</span>
                <span className="text-xs text-[#06b6d4] font-mono font-bold">
                  {hoverInfo.neuron.value.toFixed(4)}
                </span>
              </div>

              {/* Pre-activation */}
              {hoverInfo.neuron.layer > 0 && (
                <div className="flex justify-between items-center py-1 border-b border-[#1e1e2e]">
                  <span className="text-[10px] text-[#71717a] font-mono">Pre-act (z)</span>
                  <span className="text-xs text-[#a1a1aa] font-mono">
                    {hoverInfo.neuron.preActivation.toFixed(4)}
                  </span>
                </div>
              )}

              {/* Bias */}
              {hoverInfo.neuron.layer > 0 && (
                <div className="flex justify-between items-center py-1 border-b border-[#1e1e2e]">
                  <span className="text-[10px] text-[#71717a] font-mono">Bias</span>
                  <span className="text-xs text-[#a1a1aa] font-mono">
                    {hoverInfo.neuron.bias.toFixed(4)}
                  </span>
                </div>
              )}

              {/* Gradient (if backward pass happened) */}
              {hoverInfo.neuron.layer > 0 && (
                <div className="flex justify-between items-center py-1 border-b border-[#1e1e2e]">
                  <span className="text-[10px] text-[#71717a] font-mono">{"\u2207"} gradient</span>
                  <span className="text-xs text-[#f59e0b] font-mono">
                    {hoverInfo.neuron.gradient.toFixed(4)}
                  </span>
                </div>
              )}

              {/* Incoming weights */}
              {hoverInfo.incomingWeights.length > 0 && (
                <div className="mt-2">
                  <span className="text-[9px] text-[#71717a] font-mono block mb-1">INPUTS:</span>
                  <div className="space-y-0.5 max-h-24 overflow-y-auto">
                    {hoverInfo.incomingWeights.map((iw, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-[9px] font-mono"
                      >
                        <span className="text-[#71717a] w-8">{iw.fromId}</span>
                        <span className="text-[#a1a1aa]">{iw.inputValue.toFixed(2)}</span>
                        <span className="text-[#71717a]">{"\u00D7"}</span>
                        <span
                          style={{
                            color: iw.weight >= 0 ? "#06b6d4" : "#f43f5e",
                          }}
                        >
                          {iw.weight.toFixed(3)}
                        </span>
                        <span className="text-[#71717a]">=</span>
                        <span className="text-white">
                          {(iw.inputValue * iw.weight).toFixed(3)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Activation function note */}
              {hoverInfo.neuron.layer > 0 && (
                <div className="mt-2 pt-1 border-t border-[#1e1e2e]">
                  <span className="text-[9px] text-[#71717a] font-mono">
                    {hoverInfo.neuron.layer === layerSizes.length - 1
                      ? "sigmoid"
                      : activationFn}
                    ({hoverInfo.neuron.preActivation.toFixed(3)}) ={" "}
                    <span className="text-white">{hoverInfo.neuron.value.toFixed(4)}</span>
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

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
      <span
        className="text-sm font-bold font-mono"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  );
}
