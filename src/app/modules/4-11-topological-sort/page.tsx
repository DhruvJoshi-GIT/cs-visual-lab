'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Play, Pause, RotateCcw, ChevronRight, Info, ArrowDown
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

interface DAGNode { id: number; label: string; x: number; y: number; }
interface DAGEdge { from: number; to: number; }

interface TopoStep {
  output: number[];
  inDegree?: number[];
  queue?: number[];
  processing?: number;
  description: string;
}

interface GraphPreset { id: string; name: string; nodes: DAGNode[]; edges: DAGEdge[]; }

const PRESETS: GraphPreset[] = [
  {
    id: 'courses',
    name: 'Course Prerequisites',
    nodes: [
      { id: 0, label: 'Math', x: 100, y: 50 },
      { id: 1, label: 'CS101', x: 300, y: 50 },
      { id: 2, label: 'Stats', x: 200, y: 150 },
      { id: 3, label: 'CS201', x: 400, y: 150 },
      { id: 4, label: 'ML', x: 300, y: 260 },
      { id: 5, label: 'DB', x: 500, y: 260 },
    ],
    edges: [
      { from: 0, to: 2 }, { from: 1, to: 2 }, { from: 1, to: 3 },
      { from: 2, to: 4 }, { from: 3, to: 4 }, { from: 3, to: 5 },
    ],
  },
  {
    id: 'build',
    name: 'Build System',
    nodes: [
      { id: 0, label: 'lib-a', x: 100, y: 50 },
      { id: 1, label: 'lib-b', x: 300, y: 50 },
      { id: 2, label: 'lib-c', x: 500, y: 50 },
      { id: 3, label: 'pkg-x', x: 200, y: 160 },
      { id: 4, label: 'pkg-y', x: 400, y: 160 },
      { id: 5, label: 'app', x: 300, y: 270 },
    ],
    edges: [
      { from: 0, to: 3 }, { from: 1, to: 3 }, { from: 1, to: 4 },
      { from: 2, to: 4 }, { from: 3, to: 5 }, { from: 4, to: 5 },
    ],
  },
  {
    id: 'complex',
    name: 'Complex DAG',
    nodes: [
      { id: 0, label: 'A', x: 100, y: 40 },
      { id: 1, label: 'B', x: 300, y: 40 },
      { id: 2, label: 'C', x: 500, y: 40 },
      { id: 3, label: 'D', x: 150, y: 150 },
      { id: 4, label: 'E', x: 350, y: 150 },
      { id: 5, label: 'F', x: 550, y: 150 },
      { id: 6, label: 'G', x: 250, y: 270 },
      { id: 7, label: 'H', x: 450, y: 270 },
    ],
    edges: [
      { from: 0, to: 3 }, { from: 0, to: 4 }, { from: 1, to: 4 },
      { from: 2, to: 5 }, { from: 3, to: 6 }, { from: 4, to: 6 },
      { from: 4, to: 7 }, { from: 5, to: 7 },
    ],
  },
];

function kahnAlgorithm(nodes: DAGNode[], edges: DAGEdge[]): TopoStep[] {
  const n = nodes.length;
  const inDeg = Array(n).fill(0);
  const adj = new Map<number, number[]>();
  nodes.forEach(nd => adj.set(nd.id, []));
  edges.forEach(e => { adj.get(e.from)!.push(e.to); inDeg[e.to]++; });

  const steps: TopoStep[] = [];
  const queue: number[] = [];
  const output: number[] = [];

  steps.push({ output: [], inDegree: [...inDeg], description: "Kahn's: Calculate in-degrees for all nodes" });

  for (let i = 0; i < n; i++) {
    if (inDeg[i] === 0) queue.push(i);
  }

  steps.push({
    output: [],
    inDegree: [...inDeg],
    queue: [...queue],
    description: `Enqueue nodes with in-degree 0: [${queue.map(q => nodes[q].label).join(', ')}]`,
  });

  while (queue.length > 0) {
    const u = queue.shift()!;
    output.push(u);

    steps.push({
      output: [...output],
      inDegree: [...inDeg],
      queue: [...queue],
      processing: u,
      description: `Dequeue ${nodes[u].label} → output. Reduce neighbors' in-degrees.`,
    });

    for (const v of adj.get(u)!) {
      inDeg[v]--;
      if (inDeg[v] === 0) queue.push(v);
    }

    steps.push({
      output: [...output],
      inDegree: [...inDeg],
      queue: [...queue],
      description: `Updated in-degrees. Queue: [${queue.map(q => nodes[q].label).join(', ')}]`,
    });
  }

  if (output.length < n) {
    steps.push({ output: [...output], description: 'Cycle detected! Not all nodes processed.' });
  } else {
    steps.push({ output: [...output], description: `Topological order: ${output.map(i => nodes[i].label).join(' → ')}` });
  }

  return steps;
}

export default function TopologicalSortPage() {
  const [preset, setPreset] = useState<GraphPreset>(PRESETS[0]);
  const [steps, setSteps] = useState<TopoStep[]>([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const generate = useCallback(() => {
    setSteps(kahnAlgorithm(preset.nodes, preset.edges));
    setCurrentStep(-1);
    setIsPlaying(false);
  }, [preset]);

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
  const outputSet = new Set(step?.output || []);
  const queueSet = new Set(step?.queue || []);

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <ArrowDown className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Topological Sort</h1>
              <p className="text-sm text-gray-400">Module 4.11 — Kahn&apos;s algorithm (BFS-based) on DAGs</p>
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
              <motion.div key={currentStep} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-400">
                {step.description}
              </motion.div>
            )}

            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <svg width="100%" viewBox="0 0 650 310" className="overflow-visible">
                {/* Edges with arrows */}
                {preset.edges.map((edge, i) => {
                  const from = preset.nodes[edge.from];
                  const to = preset.nodes[edge.to];
                  const dx = to.x - from.x;
                  const dy = to.y - from.y;
                  const len = Math.sqrt(dx * dx + dy * dy);
                  const ex = to.x - (dx / len) * 22;
                  const ey = to.y - (dy / len) * 22;
                  const sx = from.x + (dx / len) * 22;
                  const sy = from.y + (dy / len) * 22;
                  const fromDone = outputSet.has(edge.from);
                  const toDone = outputSet.has(edge.to);

                  return (
                    <g key={i}>
                      <defs>
                        <marker id={`topo-arrow-${i}`} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                          <path d="M0,0 L8,3 L0,6" fill={fromDone && toDone ? '#10b98188' : '#3a3a4a'} />
                        </marker>
                      </defs>
                      <line x1={sx} y1={sy} x2={ex} y2={ey}
                        stroke={fromDone && toDone ? '#10b98188' : '#2a2a3a'}
                        strokeWidth={1.5} markerEnd={`url(#topo-arrow-${i})`} />
                    </g>
                  );
                })}

                {/* Nodes */}
                {preset.nodes.map(node => {
                  const isDone = outputSet.has(node.id);
                  const isQueued = queueSet.has(node.id);
                  const isProcessing = step?.processing === node.id;
                  const inDeg = step?.inDegree?.[node.id];

                  let fill = '#1e1e2e';
                  let stroke = '#3a3a4a';
                  let textColor = '#fff';

                  if (isProcessing) { fill = '#f59e0b33'; stroke = '#f59e0b'; textColor = '#f59e0b'; }
                  else if (isDone) { fill = '#10b98133'; stroke = '#10b981'; textColor = '#10b981'; }
                  else if (isQueued) { fill = '#06b6d433'; stroke = '#06b6d4'; textColor = '#06b6d4'; }

                  return (
                    <g key={node.id}>
                      <motion.circle
                        cx={node.x} cy={node.y} r={22}
                        fill={fill} stroke={stroke} strokeWidth={2.5}
                        animate={isProcessing ? { r: [22, 26, 22] } : {}}
                        transition={{ duration: 0.4 }}
                      />
                      <text x={node.x} y={node.y + 5} textAnchor="middle"
                        fill={textColor} fontSize={12} fontWeight="bold" fontFamily="monospace">
                        {node.label}
                      </text>
                      {inDeg !== undefined && !isDone && (
                        <text x={node.x + 24} y={node.y - 16} textAnchor="middle"
                          fill="#f59e0b" fontSize={10} fontFamily="monospace">
                          {inDeg}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>

              <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-[#1e1e2e] border border-[#3a3a4a]" /> Unprocessed
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-cyan-500/20 border border-cyan-500" /> In Queue
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500" /> Processing
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500" /> Done
                </div>
                <div className="text-yellow-400 ml-2">Number = in-degree</div>
              </div>
            </div>

            {/* Output Order */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Topological Order</h3>
              <div className="flex gap-2 items-center flex-wrap">
                {(step?.output || []).map((nodeId, i) => (
                  <motion.div key={`${nodeId}-${i}`} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-1">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-mono font-bold text-sm">
                      {preset.nodes[nodeId].label}
                    </div>
                    {i < (step?.output || []).length - 1 && <span className="text-gray-600">→</span>}
                  </motion.div>
                ))}
                {(!step || step.output.length === 0) && <span className="text-xs text-gray-600">Press Play to start</span>}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {/* Queue */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Queue (in-degree = 0)</h3>
              <div className="flex gap-1.5 flex-wrap min-h-[32px]">
                {(step?.queue || []).map((nodeId, i) => (
                  <div key={`q-${nodeId}-${i}`}
                    className="w-8 h-8 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-mono text-xs">
                    {preset.nodes[nodeId].label}
                  </div>
                ))}
                {(!step || (step.queue || []).length === 0) && <span className="text-xs text-gray-600">(empty)</span>}
              </div>
            </div>

            {/* In-degree table */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">In-Degree Table</h3>
              <div className="space-y-1">
                {preset.nodes.map(node => {
                  const deg = step?.inDegree?.[node.id];
                  const isDone = outputSet.has(node.id);
                  return (
                    <div key={node.id} className={`flex justify-between px-2 py-1 rounded text-xs font-mono ${
                      isDone ? 'bg-emerald-500/10 text-emerald-400' : deg === 0 ? 'bg-cyan-500/10 text-cyan-400' : 'text-gray-400'
                    }`}>
                      <span>{node.label}</span>
                      <span>{isDone ? '✓' : (deg ?? '—')}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-400" /> Kahn&apos;s Algorithm
              </h3>
              <div className="space-y-2 text-xs text-gray-400">
                <div>1. Calculate in-degree of all vertices</div>
                <div>2. Enqueue all vertices with in-degree 0</div>
                <div>3. While queue not empty:</div>
                <div className="ml-4">a. Dequeue vertex u → output</div>
                <div className="ml-4">b. For each neighbor v: in-degree[v]--</div>
                <div className="ml-4">c. If in-degree[v] == 0: enqueue v</div>
                <div>4. If output.length &lt; V → cycle exists!</div>
              </div>
            </div>

            <div className="bg-[#111118] rounded-lg border border-emerald-500/20 p-4">
              <h3 className="text-sm font-medium text-emerald-400 mb-2">Use Cases</h3>
              <div className="space-y-1 text-xs text-gray-400">
                <div>• Course prerequisite ordering</div>
                <div>• Build dependency resolution</div>
                <div>• Task scheduling</div>
                <div>• Package manager installs</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}