'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Play, Pause, RotateCcw, ChevronRight, Info, Route
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

interface WNode {
  id: number;
  label: string;
  x: number;
  y: number;
}

interface WEdge {
  from: number;
  to: number;
  weight: number;
}

interface PathStep {
  current: number;
  distances: number[];
  visited: number[];
  relaxing?: { from: number; to: number; newDist: number };
  description: string;
  pq?: { node: number; dist: number }[];
}

interface GraphPreset {
  id: string;
  name: string;
  nodes: WNode[];
  edges: WEdge[];
}

const PRESETS: GraphPreset[] = [
  {
    id: 'simple',
    name: 'Simple',
    nodes: [
      { id: 0, label: 'A', x: 80, y: 160 },
      { id: 1, label: 'B', x: 230, y: 60 },
      { id: 2, label: 'C', x: 230, y: 260 },
      { id: 3, label: 'D', x: 420, y: 60 },
      { id: 4, label: 'E', x: 420, y: 260 },
      { id: 5, label: 'F', x: 600, y: 160 },
    ],
    edges: [
      { from: 0, to: 1, weight: 4 }, { from: 0, to: 2, weight: 2 },
      { from: 1, to: 3, weight: 5 }, { from: 2, to: 1, weight: 1 },
      { from: 2, to: 4, weight: 8 }, { from: 3, to: 5, weight: 2 },
      { from: 4, to: 3, weight: 1 }, { from: 4, to: 5, weight: 6 },
    ],
  },
  {
    id: 'dense',
    name: 'Dense Graph',
    nodes: [
      { id: 0, label: 'S', x: 80, y: 160 },
      { id: 1, label: '1', x: 220, y: 60 },
      { id: 2, label: '2', x: 220, y: 260 },
      { id: 3, label: '3', x: 380, y: 160 },
      { id: 4, label: '4', x: 520, y: 60 },
      { id: 5, label: 'T', x: 620, y: 160 },
    ],
    edges: [
      { from: 0, to: 1, weight: 7 }, { from: 0, to: 2, weight: 3 },
      { from: 0, to: 3, weight: 9 }, { from: 1, to: 3, weight: 2 },
      { from: 1, to: 4, weight: 4 }, { from: 2, to: 3, weight: 5 },
      { from: 2, to: 1, weight: 2 }, { from: 3, to: 4, weight: 1 },
      { from: 3, to: 5, weight: 8 }, { from: 4, to: 5, weight: 3 },
    ],
  },
  {
    id: 'negative',
    name: 'Negative Edges',
    nodes: [
      { id: 0, label: 'A', x: 80, y: 160 },
      { id: 1, label: 'B', x: 250, y: 60 },
      { id: 2, label: 'C', x: 250, y: 260 },
      { id: 3, label: 'D', x: 450, y: 60 },
      { id: 4, label: 'E', x: 600, y: 160 },
    ],
    edges: [
      { from: 0, to: 1, weight: 6 }, { from: 0, to: 2, weight: 7 },
      { from: 1, to: 3, weight: 5 }, { from: 1, to: 2, weight: 8 },
      { from: 2, to: 3, weight: -3 }, { from: 2, to: 4, weight: 9 },
      { from: 3, to: 4, weight: 2 },
    ],
  },
];

function dijkstra(nodes: WNode[], edges: WEdge[], source: number): PathStep[] {
  const n = nodes.length;
  const dist = Array(n).fill(Infinity);
  const visited: boolean[] = Array(n).fill(false);
  const steps: PathStep[] = [];
  dist[source] = 0;

  const pq: { node: number; dist: number }[] = [{ node: source, dist: 0 }];

  steps.push({
    current: source,
    distances: [...dist],
    visited: [],
    description: `Initialize: dist[${nodes[source].label}] = 0, all others = ∞`,
    pq: [...pq],
  });

  while (pq.length > 0) {
    pq.sort((a, b) => a.dist - b.dist);
    const { node: u } = pq.shift()!;
    if (visited[u]) continue;
    visited[u] = true;

    const visitedNodes = Array.from({ length: n }, (_, i) => i).filter(i => visited[i]);

    for (const edge of edges) {
      if (edge.from !== u) continue;
      const v = edge.to;
      if (visited[v]) continue;
      const newDist = dist[u] + edge.weight;
      if (newDist < dist[v]) {
        dist[v] = newDist;
        pq.push({ node: v, dist: newDist });
        steps.push({
          current: u,
          distances: [...dist],
          visited: visitedNodes,
          relaxing: { from: u, to: v, newDist },
          description: `Relax edge ${nodes[u].label}→${nodes[v].label}: dist[${nodes[v].label}] = ${newDist} (was ${dist[v] === newDist ? '∞' : dist[v]})`,
          pq: [...pq],
        });
      }
    }

    steps.push({
      current: u,
      distances: [...dist],
      visited: visitedNodes,
      description: `Finalize ${nodes[u].label} with distance ${dist[u]}`,
      pq: [...pq],
    });
  }

  return steps;
}

function bellmanFord(nodes: WNode[], edges: WEdge[], source: number): PathStep[] {
  const n = nodes.length;
  const dist = Array(n).fill(Infinity);
  const steps: PathStep[] = [];
  dist[source] = 0;

  steps.push({
    current: source,
    distances: [...dist],
    visited: [],
    description: `Initialize: dist[${nodes[source].label}] = 0`,
  });

  for (let iter = 0; iter < n - 1; iter++) {
    let changed = false;
    for (const edge of edges) {
      if (dist[edge.from] === Infinity) continue;
      const newDist = dist[edge.from] + edge.weight;
      if (newDist < dist[edge.to]) {
        dist[edge.to] = newDist;
        changed = true;
        steps.push({
          current: edge.from,
          distances: [...dist],
          visited: [],
          relaxing: { from: edge.from, to: edge.to, newDist },
          description: `Iteration ${iter + 1}: Relax ${nodes[edge.from].label}→${nodes[edge.to].label}: dist = ${newDist}`,
        });
      }
    }
    if (!changed) {
      steps.push({
        current: -1,
        distances: [...dist],
        visited: Array.from({ length: n }, (_, i) => i),
        description: `Iteration ${iter + 1}: No changes — converged early!`,
      });
      break;
    }
  }

  return steps;
}

type Algorithm = 'dijkstra' | 'bellman-ford';

export default function ShortestPathPage() {
  const [preset, setPreset] = useState<GraphPreset>(PRESETS[0]);
  const [algorithm, setAlgorithm] = useState<Algorithm>('dijkstra');
  const [steps, setSteps] = useState<PathStep[]>([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const generate = useCallback(() => {
    const s = algorithm === 'dijkstra'
      ? dijkstra(preset.nodes, preset.edges, 0)
      : bellmanFord(preset.nodes, preset.edges, 0);
    setSteps(s);
    setCurrentStep(-1);
    setIsPlaying(false);
  }, [preset, algorithm]);

  useEffect(() => { generate(); }, [generate]);

  useEffect(() => {
    if (isPlaying && currentStep < steps.length - 1) {
      timerRef.current = setTimeout(() => setCurrentStep(s => s + 1), 1000 / speed);
    } else if (currentStep >= steps.length - 1) setIsPlaying(false);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, currentStep, speed, steps.length]);

  const handlePlayPause = () => {
    if (currentStep >= steps.length - 1) { setCurrentStep(-1); setTimeout(() => setIsPlaying(true), 50); return; }
    setIsPlaying(!isPlaying);
  };

  const step = currentStep >= 0 ? steps[currentStep] : null;
  const distances = step ? step.distances : preset.nodes.map(() => Infinity);
  const visitedSet = step ? new Set(step.visited) : new Set<number>();

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Route className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Shortest Path Algorithms</h1>
              <p className="text-sm text-gray-400">Module 4.9 — Dijkstra &amp; Bellman-Ford with edge relaxation</p>
            </div>
          </div>
        </div>

        {/* Config */}
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
            {([
              { id: 'dijkstra' as Algorithm, label: 'Dijkstra' },
              { id: 'bellman-ford' as Algorithm, label: 'Bellman-Ford' },
            ]).map(a => (
              <button key={a.id} onClick={() => setAlgorithm(a.id)}
                className={`px-3 py-1 rounded text-xs font-medium ${algorithm === a.id ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400'}`}>
                {a.label}
              </button>
            ))}
          </div>
          {preset.id === 'negative' && algorithm === 'dijkstra' && (
            <span className="text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded">
              Warning: Dijkstra may give wrong results with negative edges!
            </span>
          )}
        </div>

        {/* Controls */}
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
          {/* Main */}
          <div className="lg:col-span-2 space-y-4">
            {step && (
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-400"
              >
                {step.description}
              </motion.div>
            )}

            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <svg width="100%" viewBox="0 0 700 320" className="overflow-visible">
                {/* Edges */}
                {preset.edges.map((edge, i) => {
                  const from = preset.nodes[edge.from];
                  const to = preset.nodes[edge.to];
                  const isRelaxing = step?.relaxing?.from === edge.from && step?.relaxing?.to === edge.to;
                  const dx = to.x - from.x;
                  const dy = to.y - from.y;
                  const len = Math.sqrt(dx * dx + dy * dy);
                  const mx = (from.x + to.x) / 2;
                  const my = (from.y + to.y) / 2;
                  const offsetX = (-dy / len) * 12;
                  const offsetY = (dx / len) * 12;

                  return (
                    <g key={i}>
                      <defs>
                        <marker id={`arrow-${i}`} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                          <path d="M0,0 L8,3 L0,6" fill={isRelaxing ? '#10b981' : '#3a3a4a'} />
                        </marker>
                      </defs>
                      <line
                        x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                        stroke={isRelaxing ? '#10b981' : '#2a2a3a'}
                        strokeWidth={isRelaxing ? 2.5 : 1.5}
                        markerEnd={`url(#arrow-${i})`}
                      />
                      <text x={mx + offsetX} y={my + offsetY}
                        textAnchor="middle" fill={edge.weight < 0 ? '#ef4444' : '#888'}
                        fontSize={11} fontFamily="monospace" fontWeight="bold">
                        {edge.weight}
                      </text>
                    </g>
                  );
                })}

                {/* Nodes */}
                {preset.nodes.map(node => {
                  const isCurrent = step?.current === node.id;
                  const isVisited = visitedSet.has(node.id);
                  const dist = distances[node.id];

                  let fill = '#1e1e2e';
                  let stroke = '#3a3a4a';
                  if (isCurrent) { fill = '#10b98133'; stroke = '#10b981'; }
                  else if (isVisited) { fill = '#06b6d433'; stroke = '#06b6d4'; }

                  return (
                    <g key={node.id}>
                      <motion.circle
                        cx={node.x} cy={node.y} r={24}
                        fill={fill} stroke={stroke} strokeWidth={2.5}
                        animate={isCurrent ? { r: [24, 28, 24] } : {}}
                        transition={{ duration: 0.4 }}
                      />
                      <text x={node.x} y={node.y + 1}
                        textAnchor="middle" fill={isCurrent ? '#10b981' : isVisited ? '#06b6d4' : '#fff'}
                        fontSize={13} fontWeight="bold" fontFamily="monospace">
                        {node.label}
                      </text>
                      <text x={node.x} y={node.y + 42}
                        textAnchor="middle" fill="#f59e0b"
                        fontSize={11} fontFamily="monospace">
                        {dist === Infinity ? '∞' : dist}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Distance Table */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Distance Table</h3>
              <div className="flex gap-2 flex-wrap">
                {preset.nodes.map(node => (
                  <div key={node.id}
                    className={`px-3 py-2 rounded-lg border text-center min-w-[60px] ${
                      step?.current === node.id
                        ? 'bg-emerald-500/10 border-emerald-500/40'
                        : visitedSet.has(node.id)
                        ? 'bg-cyan-500/10 border-cyan-500/40'
                        : 'bg-[#0a0a0f] border-[#1e1e2e]'
                    }`}
                  >
                    <div className="text-xs text-gray-400 font-mono">{node.label}</div>
                    <div className="text-sm font-bold font-mono text-yellow-400">
                      {distances[node.id] === Infinity ? '∞' : distances[node.id]}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Panel */}
          <div className="space-y-4">
            {/* Priority Queue */}
            {algorithm === 'dijkstra' && step?.pq && (
              <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
                <h3 className="text-sm font-medium text-white mb-3">Priority Queue</h3>
                <div className="space-y-1">
                  {step.pq.sort((a, b) => a.dist - b.dist).map((item, i) => (
                    <div key={`${item.node}-${i}`}
                      className="flex justify-between px-2 py-1 rounded bg-[#0a0a0f] text-xs font-mono">
                      <span className="text-gray-400">{preset.nodes[item.node].label}</span>
                      <span className="text-yellow-400">{item.dist}</span>
                    </div>
                  ))}
                  {step.pq.length === 0 && <span className="text-xs text-gray-600">(empty)</span>}
                </div>
              </div>
            )}

            {/* Algorithm Info */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-400" /> Algorithm Comparison
              </h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className={`p-2 rounded-lg border ${algorithm === 'dijkstra' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-[#0a0a0f] border-[#1e1e2e]'}`}>
                  <div className="text-emerald-400 font-medium mb-1">Dijkstra</div>
                  <div className="text-gray-500">O((V+E) log V)</div>
                  <div className="text-gray-500">Greedy + PQ</div>
                  <div className="text-red-400/70">No negative edges</div>
                </div>
                <div className={`p-2 rounded-lg border ${algorithm === 'bellman-ford' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-[#0a0a0f] border-[#1e1e2e]'}`}>
                  <div className="text-emerald-400 font-medium mb-1">Bellman-Ford</div>
                  <div className="text-gray-500">O(V * E)</div>
                  <div className="text-gray-500">V-1 iterations</div>
                  <div className="text-green-400/70">Handles negatives</div>
                </div>
              </div>
            </div>

            {/* Relaxation */}
            <div className="bg-[#111118] rounded-lg border border-emerald-500/20 p-4">
              <h3 className="text-sm font-medium text-emerald-400 mb-2">Edge Relaxation</h3>
              <div className="text-xs text-gray-400 font-mono bg-[#0a0a0f] rounded p-2">
                if dist[u] + w(u,v) &lt; dist[v]:<br />
                &nbsp;&nbsp;dist[v] = dist[u] + w(u,v)
              </div>
              <p className="text-xs text-gray-500 mt-2">
                If going through u gives a shorter path to v, update the distance.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}