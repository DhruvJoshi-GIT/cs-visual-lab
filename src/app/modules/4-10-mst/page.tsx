'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Play, Pause, RotateCcw, ChevronRight, Info, GitBranch
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

interface MSTNode { id: number; label: string; x: number; y: number; }
interface MSTEdge { from: number; to: number; weight: number; }

interface MSTStep {
  selectedEdges: { from: number; to: number; weight: number }[];
  considering?: { from: number; to: number; weight: number };
  description: string;
  components?: number[][];
  totalWeight: number;
}

interface GraphPreset { id: string; name: string; nodes: MSTNode[]; edges: MSTEdge[]; }

const PRESETS: GraphPreset[] = [
  {
    id: 'simple',
    name: '6-Node Graph',
    nodes: [
      { id: 0, label: 'A', x: 100, y: 60 }, { id: 1, label: 'B', x: 350, y: 40 },
      { id: 2, label: 'C', x: 580, y: 80 }, { id: 3, label: 'D', x: 120, y: 250 },
      { id: 4, label: 'E', x: 350, y: 270 }, { id: 5, label: 'F', x: 560, y: 240 },
    ],
    edges: [
      { from: 0, to: 1, weight: 4 }, { from: 0, to: 3, weight: 2 },
      { from: 1, to: 2, weight: 6 }, { from: 1, to: 3, weight: 5 },
      { from: 1, to: 4, weight: 10 }, { from: 2, to: 4, weight: 3 },
      { from: 2, to: 5, weight: 1 }, { from: 3, to: 4, weight: 8 },
      { from: 4, to: 5, weight: 7 },
    ],
  },
  {
    id: 'dense',
    name: 'Dense Graph',
    nodes: [
      { id: 0, label: '0', x: 100, y: 150 }, { id: 1, label: '1', x: 250, y: 50 },
      { id: 2, label: '2', x: 450, y: 50 }, { id: 3, label: '3', x: 600, y: 150 },
      { id: 4, label: '4', x: 450, y: 270 }, { id: 5, label: '5', x: 250, y: 270 },
    ],
    edges: [
      { from: 0, to: 1, weight: 3 }, { from: 0, to: 5, weight: 1 },
      { from: 1, to: 2, weight: 5 }, { from: 1, to: 5, weight: 4 },
      { from: 2, to: 3, weight: 2 }, { from: 2, to: 4, weight: 7 },
      { from: 3, to: 4, weight: 4 }, { from: 4, to: 5, weight: 6 },
      { from: 0, to: 3, weight: 9 }, { from: 1, to: 4, weight: 8 },
    ],
  },
];

function kruskal(nodes: MSTNode[], edges: MSTEdge[]): MSTStep[] {
  const sorted = [...edges].sort((a, b) => a.weight - b.weight);
  const parent = Array.from({ length: nodes.length }, (_, i) => i);
  const rank = Array(nodes.length).fill(0);
  const steps: MSTStep[] = [];
  const selected: MSTEdge[] = [];

  function find(x: number): number { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
  function union(x: number, y: number): boolean {
    const px = find(x), py = find(y);
    if (px === py) return false;
    if (rank[px] < rank[py]) parent[px] = py;
    else if (rank[px] > rank[py]) parent[py] = px;
    else { parent[py] = px; rank[px]++; }
    return true;
  }

  steps.push({ selectedEdges: [], description: `Kruskal's: Sort ${edges.length} edges by weight`, totalWeight: 0 });

  for (const edge of sorted) {
    steps.push({
      selectedEdges: [...selected],
      considering: edge,
      description: `Consider edge ${nodes[edge.from].label}—${nodes[edge.to].label} (weight ${edge.weight})`,
      totalWeight: selected.reduce((s, e) => s + e.weight, 0),
    });

    if (union(edge.from, edge.to)) {
      selected.push(edge);
      steps.push({
        selectedEdges: [...selected],
        description: `Accept ${nodes[edge.from].label}—${nodes[edge.to].label}: different components → add to MST`,
        totalWeight: selected.reduce((s, e) => s + e.weight, 0),
      });
    } else {
      steps.push({
        selectedEdges: [...selected],
        description: `Reject ${nodes[edge.from].label}—${nodes[edge.to].label}: same component → would create cycle`,
        totalWeight: selected.reduce((s, e) => s + e.weight, 0),
      });
    }

    if (selected.length === nodes.length - 1) break;
  }

  steps.push({
    selectedEdges: [...selected],
    description: `MST complete! Total weight: ${selected.reduce((s, e) => s + e.weight, 0)}`,
    totalWeight: selected.reduce((s, e) => s + e.weight, 0),
  });

  return steps;
}

function prim(nodes: MSTNode[], edges: MSTEdge[]): MSTStep[] {
  const adj = new Map<number, { to: number; weight: number }[]>();
  nodes.forEach(n => adj.set(n.id, []));
  edges.forEach(e => {
    adj.get(e.from)!.push({ to: e.to, weight: e.weight });
    adj.get(e.to)!.push({ to: e.from, weight: e.weight });
  });

  const inMST = new Set<number>();
  const selected: MSTEdge[] = [];
  const steps: MSTStep[] = [];
  inMST.add(0);

  steps.push({ selectedEdges: [], description: `Prim's: Start from node ${nodes[0].label}`, totalWeight: 0 });

  while (inMST.size < nodes.length) {
    let bestEdge: MSTEdge | null = null;
    let bestWeight = Infinity;

    for (const u of inMST) {
      for (const { to: v, weight } of adj.get(u)!) {
        if (!inMST.has(v) && weight < bestWeight) {
          bestWeight = weight;
          bestEdge = { from: u, to: v, weight };
        }
      }
    }

    if (!bestEdge) break;

    steps.push({
      selectedEdges: [...selected],
      considering: bestEdge,
      description: `Cheapest cross-edge: ${nodes[bestEdge.from].label}—${nodes[bestEdge.to].label} (weight ${bestEdge.weight})`,
      totalWeight: selected.reduce((s, e) => s + e.weight, 0),
    });

    selected.push(bestEdge);
    inMST.add(bestEdge.to);

    steps.push({
      selectedEdges: [...selected],
      description: `Add ${nodes[bestEdge.to].label} to MST. Tree now has ${inMST.size} nodes.`,
      totalWeight: selected.reduce((s, e) => s + e.weight, 0),
    });
  }

  steps.push({
    selectedEdges: [...selected],
    description: `MST complete! Total weight: ${selected.reduce((s, e) => s + e.weight, 0)}`,
    totalWeight: selected.reduce((s, e) => s + e.weight, 0),
  });

  return steps;
}

type Algorithm = 'kruskal' | 'prim';

export default function MSTPage() {
  const [preset, setPreset] = useState<GraphPreset>(PRESETS[0]);
  const [algorithm, setAlgorithm] = useState<Algorithm>('kruskal');
  const [steps, setSteps] = useState<MSTStep[]>([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const generate = useCallback(() => {
    const s = algorithm === 'kruskal' ? kruskal(preset.nodes, preset.edges) : prim(preset.nodes, preset.edges);
    setSteps(s); setCurrentStep(-1); setIsPlaying(false);
  }, [preset, algorithm]);

  useEffect(() => { generate(); }, [generate]);

  useEffect(() => {
    if (isPlaying && currentStep < steps.length - 1)
      timerRef.current = setTimeout(() => setCurrentStep(s => s + 1), 1000 / speed);
    else if (currentStep >= steps.length - 1) setIsPlaying(false);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, currentStep, speed, steps.length]);

  const handlePlayPause = () => {
    if (currentStep >= steps.length - 1) { setCurrentStep(-1); setTimeout(() => setIsPlaying(true), 50); return; }
    setIsPlaying(!isPlaying);
  };

  const step = currentStep >= 0 ? steps[currentStep] : null;
  const selectedEdgeSet = new Set(
    (step?.selectedEdges || []).map(e => `${Math.min(e.from, e.to)}-${Math.max(e.from, e.to)}`)
  );
  const consideringKey = step?.considering
    ? `${Math.min(step.considering.from, step.considering.to)}-${Math.max(step.considering.from, step.considering.to)}`
    : null;

  const inMST = new Set<number>();
  (step?.selectedEdges || []).forEach(e => { inMST.add(e.from); inMST.add(e.to); });

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <GitBranch className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Minimum Spanning Tree</h1>
              <p className="text-sm text-gray-400">Module 4.10 — Kruskal&apos;s and Prim&apos;s algorithms</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Graph:</span>
            {PRESETS.map(p => (
              <button key={p.id} onClick={() => setPreset(p)}
                className={`px-2 py-1 rounded text-xs ${preset.id === p.id ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400 bg-[#1e1e2e]'}`}>
                {p.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Algorithm:</span>
            {(['kruskal', 'prim'] as Algorithm[]).map(a => (
              <button key={a} onClick={() => setAlgorithm(a)}
                className={`px-3 py-1 rounded text-xs font-medium capitalize ${algorithm === a ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400'}`}>
                {a === 'kruskal' ? "Kruskal's" : "Prim's"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <button onClick={handlePlayPause}
            className="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center hover:bg-emerald-500/30">
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={() => { setIsPlaying(false); if (currentStep < steps.length - 1) setCurrentStep(s => s + 1); }}
            className="px-3 py-2 rounded-lg bg-[#1e1e2e] text-gray-300 text-sm hover:text-white flex items-center gap-1">
            <ChevronRight className="w-4 h-4" /> Step
          </button>
          <button onClick={() => { setIsPlaying(false); setCurrentStep(-1); }}
            className="px-3 py-2 rounded-lg bg-[#1e1e2e] text-gray-300 text-sm hover:text-white flex items-center gap-1">
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-gray-500">Speed:</span>
            {[0.5, 1, 2].map(s => (
              <button key={s} onClick={() => setSpeed(s)}
                className={`px-2 py-1 rounded text-xs ${speed === s ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-500'}`}>
                {s}x
              </button>
            ))}
          </div>
          <div className="text-xs text-gray-500">Step {currentStep + 1} / {steps.length}</div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {step && (
              <motion.div key={currentStep} initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
                className={`p-3 rounded-lg text-sm border ${
                  step.description.includes('Reject') ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : step.description.includes('Accept') || step.description.includes('Add') ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                }`}>
                {step.description}
              </motion.div>
            )}

            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <svg width="100%" viewBox="0 0 700 320" className="overflow-visible">
                {preset.edges.map((edge, i) => {
                  const from = preset.nodes[edge.from];
                  const to = preset.nodes[edge.to];
                  const key = `${Math.min(edge.from, edge.to)}-${Math.max(edge.from, edge.to)}`;
                  const isSelected = selectedEdgeSet.has(key);
                  const isConsidering = key === consideringKey;
                  const mx = (from.x + to.x) / 2;
                  const my = (from.y + to.y) / 2;

                  return (
                    <g key={i}>
                      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                        stroke={isSelected ? '#10b981' : isConsidering ? '#f59e0b' : '#2a2a3a'}
                        strokeWidth={isSelected ? 3 : isConsidering ? 2.5 : 1.5}
                        strokeDasharray={isConsidering ? '5,5' : undefined}
                      />
                      <rect x={mx - 12} y={my - 9} width={24} height={18} rx={4}
                        fill={isSelected ? '#10b98133' : isConsidering ? '#f59e0b33' : '#111118'}
                        stroke={isSelected ? '#10b981' : isConsidering ? '#f59e0b' : '#2a2a3a'}
                        strokeWidth={1}
                      />
                      <text x={mx} y={my + 4} textAnchor="middle"
                        fill={isSelected ? '#10b981' : isConsidering ? '#f59e0b' : '#666'}
                        fontSize={10} fontFamily="monospace" fontWeight="bold">
                        {edge.weight}
                      </text>
                    </g>
                  );
                })}
                {preset.nodes.map(node => {
                  const isInTree = inMST.has(node.id);
                  return (
                    <g key={node.id}>
                      <circle cx={node.x} cy={node.y} r={22}
                        fill={isInTree ? '#10b98133' : '#1e1e2e'}
                        stroke={isInTree ? '#10b981' : '#3a3a4a'} strokeWidth={2.5} />
                      <text x={node.x} y={node.y + 5} textAnchor="middle"
                        fill={isInTree ? '#10b981' : '#fff'}
                        fontSize={13} fontWeight="bold" fontFamily="monospace">
                        {node.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* MST Edges */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">
                MST Edges ({step?.selectedEdges.length || 0}/{preset.nodes.length - 1})
                <span className="text-yellow-400 ml-2">Total: {step?.totalWeight || 0}</span>
              </h3>
              <div className="flex gap-2 flex-wrap">
                {(step?.selectedEdges || []).map((e, i) => (
                  <motion.div key={i} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
                    {preset.nodes[e.from].label}—{preset.nodes[e.to].label} ({e.weight})
                  </motion.div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {/* Sorted edges for Kruskal */}
            {algorithm === 'kruskal' && (
              <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
                <h3 className="text-sm font-medium text-white mb-3">Sorted Edges</h3>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {[...preset.edges].sort((a, b) => a.weight - b.weight).map((e, i) => {
                    const key = `${Math.min(e.from, e.to)}-${Math.max(e.from, e.to)}`;
                    const isSelected = selectedEdgeSet.has(key);
                    const isConsidering = key === consideringKey;
                    return (
                      <div key={i} className={`flex justify-between px-2 py-1 rounded text-xs font-mono ${
                        isSelected ? 'bg-emerald-500/10 text-emerald-400'
                        : isConsidering ? 'bg-yellow-500/10 text-yellow-400'
                        : 'text-gray-500'
                      }`}>
                        <span>{preset.nodes[e.from].label}—{preset.nodes[e.to].label}</span>
                        <span>{e.weight}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-400" /> Comparison
              </h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className={`p-2 rounded-lg border ${algorithm === 'kruskal' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-[#0a0a0f] border-[#1e1e2e]'}`}>
                  <div className="text-emerald-400 font-medium mb-1">Kruskal&apos;s</div>
                  <div className="text-gray-500">O(E log E)</div>
                  <div className="text-gray-500">Sort + Union-Find</div>
                  <div className="text-gray-500">Edge-centric</div>
                </div>
                <div className={`p-2 rounded-lg border ${algorithm === 'prim' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-[#0a0a0f] border-[#1e1e2e]'}`}>
                  <div className="text-emerald-400 font-medium mb-1">Prim&apos;s</div>
                  <div className="text-gray-500">O((V+E) log V)</div>
                  <div className="text-gray-500">Priority queue</div>
                  <div className="text-gray-500">Vertex-centric</div>
                </div>
              </div>
            </div>

            <div className="bg-[#111118] rounded-lg border border-emerald-500/20 p-4">
              <h3 className="text-sm font-medium text-emerald-400 mb-2">MST Properties</h3>
              <div className="space-y-1.5 text-xs text-gray-400">
                <div>• Connects all V vertices with V-1 edges</div>
                <div>• Minimum total edge weight</div>
                <div>• No cycles</div>
                <div>• May not be unique if equal-weight edges exist</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}