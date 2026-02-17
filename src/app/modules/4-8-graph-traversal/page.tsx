'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Play, Pause, RotateCcw, ChevronRight, Info, GitBranch
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

interface GraphNode {
  id: number;
  label: string;
  x: number;
  y: number;
}

interface GraphEdge {
  from: number;
  to: number;
}

interface TraversalStep {
  visiting: number;
  frontier: number[];
  visited: number[];
  edge?: { from: number; to: number };
  description: string;
}

interface GraphPreset {
  id: string;
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const PRESETS: GraphPreset[] = [
  {
    id: 'tree',
    name: 'Binary Tree',
    nodes: [
      { id: 0, label: 'A', x: 350, y: 40 },
      { id: 1, label: 'B', x: 200, y: 120 },
      { id: 2, label: 'C', x: 500, y: 120 },
      { id: 3, label: 'D', x: 130, y: 210 },
      { id: 4, label: 'E', x: 270, y: 210 },
      { id: 5, label: 'F', x: 430, y: 210 },
      { id: 6, label: 'G', x: 570, y: 210 },
    ],
    edges: [
      { from: 0, to: 1 }, { from: 0, to: 2 },
      { from: 1, to: 3 }, { from: 1, to: 4 },
      { from: 2, to: 5 }, { from: 2, to: 6 },
    ],
  },
  {
    id: 'graph',
    name: 'General Graph',
    nodes: [
      { id: 0, label: '0', x: 100, y: 80 },
      { id: 1, label: '1', x: 300, y: 40 },
      { id: 2, label: '2', x: 500, y: 80 },
      { id: 3, label: '3', x: 150, y: 200 },
      { id: 4, label: '4', x: 350, y: 180 },
      { id: 5, label: '5', x: 550, y: 200 },
      { id: 6, label: '6', x: 250, y: 290 },
      { id: 7, label: '7', x: 450, y: 290 },
    ],
    edges: [
      { from: 0, to: 1 }, { from: 0, to: 3 },
      { from: 1, to: 2 }, { from: 1, to: 4 },
      { from: 2, to: 5 }, { from: 3, to: 4 },
      { from: 3, to: 6 }, { from: 4, to: 5 },
      { from: 4, to: 7 }, { from: 6, to: 7 },
    ],
  },
  {
    id: 'cycle',
    name: 'Cyclic Graph',
    nodes: [
      { id: 0, label: '0', x: 350, y: 50 },
      { id: 1, label: '1', x: 180, y: 140 },
      { id: 2, label: '2', x: 520, y: 140 },
      { id: 3, label: '3', x: 120, y: 260 },
      { id: 4, label: '4', x: 350, y: 230 },
      { id: 5, label: '5', x: 580, y: 260 },
    ],
    edges: [
      { from: 0, to: 1 }, { from: 0, to: 2 },
      { from: 1, to: 3 }, { from: 1, to: 4 },
      { from: 2, to: 4 }, { from: 2, to: 5 },
      { from: 3, to: 4 }, { from: 4, to: 5 },
      { from: 5, to: 0 },
    ],
  },
];

function generateBFS(nodes: GraphNode[], edges: GraphEdge[], start: number): TraversalStep[] {
  const adj = new Map<number, number[]>();
  nodes.forEach(n => adj.set(n.id, []));
  edges.forEach(e => {
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  });

  const steps: TraversalStep[] = [];
  const visited = new Set<number>();
  const queue: number[] = [start];
  visited.add(start);

  steps.push({ visiting: start, frontier: [...queue], visited: [start], description: `Start BFS from node ${nodes[start].label}` });

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adj.get(current) || [];

    for (const neighbor of neighbors.sort((a, b) => a - b)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
        steps.push({
          visiting: neighbor,
          frontier: [...queue],
          visited: [...visited],
          edge: { from: current, to: neighbor },
          description: `Visit ${nodes[neighbor].label} (from ${nodes[current].label}). Queue: [${queue.map(q => nodes[q].label).join(', ')}]`,
        });
      }
    }
  }

  return steps;
}

function generateDFS(nodes: GraphNode[], edges: GraphEdge[], start: number): TraversalStep[] {
  const adj = new Map<number, number[]>();
  nodes.forEach(n => adj.set(n.id, []));
  edges.forEach(e => {
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  });

  const steps: TraversalStep[] = [];
  const visited = new Set<number>();
  const stack: number[] = [start];

  steps.push({ visiting: start, frontier: [start], visited: [], description: `Start DFS from node ${nodes[start].label}` });

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    steps.push({
      visiting: current,
      frontier: [...stack],
      visited: [...visited],
      description: `Visit ${nodes[current].label}. Stack: [${stack.map(s => nodes[s].label).join(', ')}]`,
    });

    const neighbors = (adj.get(current) || []).sort((a, b) => b - a);
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        stack.push(neighbor);
      }
    }
  }

  return steps;
}

type Algorithm = 'bfs' | 'dfs';

export default function GraphTraversalPage() {
  const [preset, setPreset] = useState<GraphPreset>(PRESETS[0]);
  const [algorithm, setAlgorithm] = useState<Algorithm>('bfs');
  const [startNode, setStartNode] = useState(0);
  const [steps, setSteps] = useState<TraversalStep[]>([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const generateSteps = useCallback(() => {
    const s = algorithm === 'bfs'
      ? generateBFS(preset.nodes, preset.edges, startNode)
      : generateDFS(preset.nodes, preset.edges, startNode);
    setSteps(s);
    setCurrentStep(-1);
    setIsPlaying(false);
  }, [preset, algorithm, startNode]);

  useEffect(() => {
    generateSteps();
  }, [generateSteps]);

  useEffect(() => {
    if (isPlaying && currentStep < steps.length - 1) {
      timerRef.current = setTimeout(() => {
        setCurrentStep(s => s + 1);
      }, 1000 / speed);
    } else if (currentStep >= steps.length - 1) {
      setIsPlaying(false);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, currentStep, speed, steps.length]);

  const handlePlayPause = () => {
    if (currentStep >= steps.length - 1) {
      setCurrentStep(-1);
      setTimeout(() => setIsPlaying(true), 50);
      return;
    }
    setIsPlaying(!isPlaying);
  };

  const step = currentStep >= 0 ? steps[currentStep] : null;
  const visitedSet = step ? new Set(step.visited) : new Set<number>();
  const frontierSet = step ? new Set(step.frontier) : new Set<number>();
  const visitedEdges = new Set<string>();
  if (step) {
    for (let i = 0; i <= currentStep; i++) {
      if (steps[i].edge) {
        visitedEdges.add(`${steps[i].edge!.from}-${steps[i].edge!.to}`);
        visitedEdges.add(`${steps[i].edge!.to}-${steps[i].edge!.from}`);
      }
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <GitBranch className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Graphs: BFS & DFS</h1>
              <p className="text-sm text-gray-400">Module 4.8 — Node-by-node traversal with frontier/visited coloring</p>
            </div>
          </div>
        </div>

        {/* Config */}
        <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Graph:</span>
            {PRESETS.map(p => (
              <button key={p.id} onClick={() => { setPreset(p); setStartNode(0); }}
                className={`px-2 py-1 rounded text-xs ${preset.id === p.id ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400 hover:text-gray-300 bg-[#1e1e2e]'}`}>
                {p.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Algorithm:</span>
            {(['bfs', 'dfs'] as Algorithm[]).map(a => (
              <button key={a} onClick={() => setAlgorithm(a)}
                className={`px-3 py-1 rounded text-xs font-medium ${algorithm === a ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400 hover:text-gray-300'}`}>
                {a.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Start:</span>
            {preset.nodes.map(n => (
              <button key={n.id} onClick={() => setStartNode(n.id)}
                className={`w-7 h-7 rounded text-xs font-mono ${startNode === n.id ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' : 'text-gray-400 bg-[#1e1e2e]'}`}>
                {n.label}
              </button>
            ))}
          </div>
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
                className={`px-2 py-1 rounded text-xs ${speed === s ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-500 hover:text-gray-300'}`}>
                {s}x
              </button>
            ))}
          </div>
          <div className="text-xs text-gray-500">
            Step {currentStep + 1} / {steps.length}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Graph Visualization */}
          <div className="lg:col-span-2 space-y-4">
            {/* Current step info */}
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
                  const isVisited = visitedEdges.has(`${edge.from}-${edge.to}`);
                  return (
                    <line
                      key={i}
                      x1={from.x} y1={from.y}
                      x2={to.x} y2={to.y}
                      stroke={isVisited ? '#10b981' : '#2a2a3a'}
                      strokeWidth={isVisited ? 2.5 : 1.5}
                    />
                  );
                })}

                {/* Nodes */}
                {preset.nodes.map(node => {
                  const isVisiting = step?.visiting === node.id;
                  const isVisited = visitedSet.has(node.id);
                  const isFrontier = frontierSet.has(node.id) && !isVisited;

                  let fill = '#1e1e2e';
                  let stroke = '#3a3a4a';
                  let textColor = '#ffffff';

                  if (isVisiting) {
                    fill = '#10b98133';
                    stroke = '#10b981';
                    textColor = '#10b981';
                  } else if (isVisited) {
                    fill = '#06b6d433';
                    stroke = '#06b6d4';
                    textColor = '#06b6d4';
                  } else if (isFrontier) {
                    fill = '#f59e0b33';
                    stroke = '#f59e0b';
                    textColor = '#f59e0b';
                  }

                  return (
                    <g key={node.id}>
                      <motion.circle
                        cx={node.x} cy={node.y} r={22}
                        fill={fill} stroke={stroke} strokeWidth={2.5}
                        animate={isVisiting ? { r: [22, 26, 22] } : {}}
                        transition={{ duration: 0.4 }}
                      />
                      <text x={node.x} y={node.y + 5}
                        textAnchor="middle" fill={textColor}
                        fontSize={14} fontWeight="bold" fontFamily="monospace">
                        {node.label}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-[#1e1e2e] border border-[#3a3a4a]" />
                  Unvisited
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500" />
                  Frontier
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500" />
                  Visiting
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-cyan-500/20 border border-cyan-500" />
                  Visited
                </div>
              </div>
            </div>

            {/* Traversal Order */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">
                Traversal Order ({algorithm.toUpperCase()})
              </h3>
              <div className="flex gap-2 flex-wrap">
                {step && step.visited.map((nodeId, i) => (
                  <motion.div
                    key={`${nodeId}-${i}`}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-10 h-10 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-mono font-bold text-sm"
                  >
                    {preset.nodes[nodeId].label}
                  </motion.div>
                ))}
                {!step && <span className="text-xs text-gray-600">Press Play to start</span>}
              </div>
            </div>
          </div>

          {/* Right Panel */}
          <div className="space-y-4">
            {/* Data Structure State */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">
                {algorithm === 'bfs' ? 'Queue (FIFO)' : 'Stack (LIFO)'}
              </h3>
              <div className="flex gap-1.5 flex-wrap min-h-[40px]">
                {step && step.frontier.map((nodeId, i) => (
                  <motion.div
                    key={`f-${nodeId}-${i}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="w-8 h-8 rounded bg-yellow-500/20 border border-yellow-500/40 flex items-center justify-center text-yellow-400 font-mono text-xs"
                  >
                    {preset.nodes[nodeId].label}
                  </motion.div>
                ))}
                {(!step || step.frontier.length === 0) && (
                  <span className="text-xs text-gray-600">(empty)</span>
                )}
              </div>
            </div>

            {/* Algorithm Comparison */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-400" /> BFS vs DFS
              </h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className={`p-2 rounded-lg border ${algorithm === 'bfs' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-[#0a0a0f] border-[#1e1e2e]'}`}>
                  <div className="text-emerald-400 font-medium mb-1">BFS</div>
                  <div className="text-gray-500">Uses Queue (FIFO)</div>
                  <div className="text-gray-500">Level by level</div>
                  <div className="text-gray-500">Shortest path</div>
                  <div className="text-gray-500">O(V + E)</div>
                </div>
                <div className={`p-2 rounded-lg border ${algorithm === 'dfs' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-[#0a0a0f] border-[#1e1e2e]'}`}>
                  <div className="text-emerald-400 font-medium mb-1">DFS</div>
                  <div className="text-gray-500">Uses Stack (LIFO)</div>
                  <div className="text-gray-500">Deep first</div>
                  <div className="text-gray-500">Cycle detection</div>
                  <div className="text-gray-500">O(V + E)</div>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Graph Stats</h3>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1">
                  <span className="text-gray-500">Vertices</span>
                  <span className="text-emerald-400">{preset.nodes.length}</span>
                </div>
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1">
                  <span className="text-gray-500">Edges</span>
                  <span className="text-emerald-400">{preset.edges.length}</span>
                </div>
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1">
                  <span className="text-gray-500">Visited</span>
                  <span className="text-cyan-400">{step ? step.visited.length : 0} / {preset.nodes.length}</span>
                </div>
              </div>
            </div>

            {/* Use Cases */}
            <div className="bg-[#111118] rounded-lg border border-emerald-500/20 p-4">
              <h3 className="text-sm font-medium text-emerald-400 mb-2">Use Cases</h3>
              <div className="space-y-1.5 text-xs text-gray-400">
                <div><span className="text-emerald-400">BFS:</span> Shortest path, level-order, web crawling, social network distance</div>
                <div><span className="text-emerald-400">DFS:</span> Topological sort, cycle detection, maze solving, connected components</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}