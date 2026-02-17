'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RotateCcw, Info, GitMerge, Plus, Search
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

interface UFNode {
  id: number;
  parent: number;
  rank: number;
}

interface LogEntry {
  text: string;
  type: 'union' | 'find' | 'info' | 'compress';
}

const PRESETS = [
  { name: '8 Elements', count: 8 },
  { name: '10 Elements', count: 10 },
  { name: '12 Elements', count: 12 },
];

export default function UnionFindPage() {
  const [nodes, setNodes] = useState<UFNode[]>(() =>
    Array.from({ length: 8 }, (_, i) => ({ id: i, parent: i, rank: 0 }))
  );
  const [log, setLog] = useState<LogEntry[]>([{ text: 'Union-Find initialized. Each element is its own set.', type: 'info' }]);
  const [unionA, setUnionA] = useState('');
  const [unionB, setUnionB] = useState('');
  const [findVal, setFindVal] = useState('');
  const [highlightPath, setHighlightPath] = useState<Set<number>>(new Set());
  const [highlightRoot, setHighlightRoot] = useState<number | null>(null);
  const [useCompression, setUseCompression] = useState(true);
  const [useRank, setUseRank] = useState(true);

  const findRoot = useCallback((nodeArr: UFNode[], x: number): { root: number; path: number[] } => {
    const path: number[] = [x];
    let current = x;
    while (nodeArr[current].parent !== current) {
      current = nodeArr[current].parent;
      path.push(current);
    }
    return { root: current, path };
  }, []);

  const handleFind = useCallback((x: number) => {
    if (x < 0 || x >= nodes.length) return;
    const newNodes = [...nodes.map(n => ({ ...n }))];
    const { root, path } = findRoot(newNodes, x);
    const logs: LogEntry[] = [];
    logs.push({ text: `Find(${x}): path = ${path.join(' → ')} → root = ${root}`, type: 'find' });

    if (useCompression && path.length > 2) {
      for (const nodeId of path) {
        if (nodeId !== root) {
          newNodes[nodeId].parent = root;
        }
      }
      logs.push({ text: `Path compression: all nodes on path now point to ${root}`, type: 'compress' });
      setNodes(newNodes);
    }

    setHighlightPath(new Set(path));
    setHighlightRoot(root);
    setLog(prev => [...prev, ...logs]);
    setTimeout(() => { setHighlightPath(new Set()); setHighlightRoot(null); }, 2000);
  }, [nodes, findRoot, useCompression]);

  const handleUnion = useCallback((a: number, b: number) => {
    if (a < 0 || a >= nodes.length || b < 0 || b >= nodes.length || a === b) return;
    const newNodes = [...nodes.map(n => ({ ...n }))];
    const { root: rootA } = findRoot(newNodes, a);
    const { root: rootB } = findRoot(newNodes, b);
    const logs: LogEntry[] = [];

    if (rootA === rootB) {
      logs.push({ text: `Union(${a}, ${b}): Already in same set (root = ${rootA})`, type: 'info' });
      setLog(prev => [...prev, ...logs]);
      return;
    }

    if (useRank) {
      if (newNodes[rootA].rank < newNodes[rootB].rank) {
        newNodes[rootA].parent = rootB;
        logs.push({ text: `Union(${a}, ${b}): rank[${rootA}]=${newNodes[rootA].rank} < rank[${rootB}]=${newNodes[rootB].rank}, attach ${rootA} → ${rootB}`, type: 'union' });
      } else if (newNodes[rootA].rank > newNodes[rootB].rank) {
        newNodes[rootB].parent = rootA;
        logs.push({ text: `Union(${a}, ${b}): rank[${rootA}]=${newNodes[rootA].rank} > rank[${rootB}]=${newNodes[rootB].rank}, attach ${rootB} → ${rootA}`, type: 'union' });
      } else {
        newNodes[rootB].parent = rootA;
        newNodes[rootA].rank++;
        logs.push({ text: `Union(${a}, ${b}): equal rank, attach ${rootB} → ${rootA}, rank[${rootA}]++`, type: 'union' });
      }
    } else {
      newNodes[rootB].parent = rootA;
      logs.push({ text: `Union(${a}, ${b}): attach root ${rootB} → ${rootA}`, type: 'union' });
    }

    if (useCompression) {
      // Compress both paths
      const { path: pathA } = findRoot(nodes, a);
      const { path: pathB } = findRoot(nodes, b);
      const newRoot = newNodes[rootA].parent === rootA ? rootA : rootB;
      for (const id of [...pathA, ...pathB]) {
        if (id !== newRoot) newNodes[id].parent = newRoot;
      }
    }

    setNodes(newNodes);
    setLog(prev => [...prev, ...logs]);
  }, [nodes, findRoot, useRank, useCompression]);

  const handleReset = (count: number) => {
    setNodes(Array.from({ length: count }, (_, i) => ({ id: i, parent: i, rank: 0 })));
    setLog([{ text: `Reset: ${count} elements, each in its own set.`, type: 'info' }]);
    setHighlightPath(new Set());
    setHighlightRoot(null);
  };

  // Build tree structure for visualization
  const roots = nodes.filter(n => n.parent === n.id);
  const getChildren = (parentId: number): number[] =>
    nodes.filter(n => n.parent === parentId && n.id !== parentId).map(n => n.id);

  const numSets = roots.length;

  // Tree positions
  interface TreePos { id: number; x: number; y: number; }
  const treePositions: TreePos[] = [];
  const treeEdges: { from: number; to: number }[] = [];

  let xOffset = 0;
  for (const root of roots) {
    const buildPositions = (nodeId: number, x: number, y: number, spread: number) => {
      treePositions.push({ id: nodeId, x, y });
      const children = getChildren(nodeId);
      const startX = x - (spread * (children.length - 1)) / 2;
      children.forEach((childId, i) => {
        treeEdges.push({ from: nodeId, to: childId });
        buildPositions(childId, startX + i * spread, y + 60, spread * 0.6);
      });
    };
    const treeSize = (() => {
      let count = 0;
      const visit = (id: number) => { count++; getChildren(id).forEach(visit); };
      visit(root.id);
      return count;
    })();
    const width = Math.max(80, treeSize * 50);
    buildPositions(root.id, xOffset + width / 2, 30, 50);
    xOffset += width + 20;
  }

  const svgWidth = Math.max(600, xOffset);

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <GitMerge className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Union-Find (Disjoint Sets)</h1>
              <p className="text-sm text-gray-400">Module 4.13 — Path compression and union by rank</p>
            </div>
          </div>
        </div>

        {/* Config */}
        <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Size:</span>
            {PRESETS.map(p => (
              <button key={p.name} onClick={() => handleReset(p.count)}
                className={`px-2 py-1 rounded text-xs ${nodes.length === p.count ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400 bg-[#1e1e2e]'}`}>
                {p.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={useCompression} onChange={e => setUseCompression(e.target.checked)}
                className="rounded border-gray-600 bg-[#0a0a0f] text-emerald-500" />
              <span className="text-gray-400">Path Compression</span>
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={useRank} onChange={e => setUseRank(e.target.checked)}
                className="rounded border-gray-600 bg-[#0a0a0f] text-emerald-500" />
              <span className="text-gray-400">Union by Rank</span>
            </label>
          </div>
        </div>

        {/* Operations */}
        <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Union:</span>
            <input type="number" min={0} max={nodes.length - 1} value={unionA} onChange={e => setUnionA(e.target.value)}
              placeholder="a" className="w-14 px-2 py-1.5 rounded bg-[#0a0a0f] border border-[#1e1e2e] text-white text-xs outline-none" />
            <input type="number" min={0} max={nodes.length - 1} value={unionB} onChange={e => setUnionB(e.target.value)}
              placeholder="b" className="w-14 px-2 py-1.5 rounded bg-[#0a0a0f] border border-[#1e1e2e] text-white text-xs outline-none" />
            <button onClick={() => { handleUnion(parseInt(unionA), parseInt(unionB)); setUnionA(''); setUnionB(''); }}
              className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-400 text-xs hover:bg-emerald-500/30 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Union
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Find:</span>
            <input type="number" min={0} max={nodes.length - 1} value={findVal} onChange={e => setFindVal(e.target.value)}
              placeholder="x" className="w-14 px-2 py-1.5 rounded bg-[#0a0a0f] border border-[#1e1e2e] text-white text-xs outline-none" />
            <button onClick={() => { handleFind(parseInt(findVal)); setFindVal(''); }}
              className="px-3 py-1.5 rounded bg-cyan-500/20 text-cyan-400 text-xs hover:bg-cyan-500/30 flex items-center gap-1">
              <Search className="w-3 h-3" /> Find
            </button>
          </div>
          <button onClick={() => handleReset(nodes.length)}
            className="px-3 py-1.5 rounded bg-[#1e1e2e] text-gray-400 text-xs hover:text-white flex items-center gap-1 ml-auto">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {/* Forest View */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Forest View ({numSets} sets)</h3>
              <svg width="100%" viewBox={`0 0 ${svgWidth} ${Math.max(100, treePositions.length > 0 ? Math.max(...treePositions.map(p => p.y)) + 60 : 100)}`} className="overflow-visible">
                {treeEdges.map((edge, i) => {
                  const from = treePositions.find(p => p.id === edge.from);
                  const to = treePositions.find(p => p.id === edge.to);
                  if (!from || !to) return null;
                  return (
                    <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke={highlightPath.has(edge.from) && highlightPath.has(edge.to) ? '#10b981' : '#2a2a3a'}
                      strokeWidth={highlightPath.has(edge.from) && highlightPath.has(edge.to) ? 2.5 : 1.5}
                    />
                  );
                })}

                {treePositions.map(pos => {
                  const node = nodes[pos.id];
                  const isRoot = node.parent === node.id;
                  const isHighlighted = highlightPath.has(pos.id);
                  const isFoundRoot = highlightRoot === pos.id;

                  let fill = '#1e1e2e';
                  let stroke = '#3a3a4a';
                  if (isFoundRoot) { fill = '#f59e0b33'; stroke = '#f59e0b'; }
                  else if (isHighlighted) { fill = '#10b98133'; stroke = '#10b981'; }
                  else if (isRoot) { fill = '#06b6d422'; stroke = '#06b6d4'; }

                  return (
                    <g key={pos.id}>
                      <motion.circle
                        cx={pos.x} cy={pos.y} r={18}
                        fill={fill} stroke={stroke} strokeWidth={isRoot ? 2.5 : 1.5}
                        animate={isHighlighted ? { r: [18, 22, 18] } : {}}
                        transition={{ duration: 0.4 }}
                      />
                      <text x={pos.x} y={pos.y + 5} textAnchor="middle"
                        fill={isFoundRoot ? '#f59e0b' : isHighlighted ? '#10b981' : isRoot ? '#06b6d4' : '#fff'}
                        fontSize={12} fontWeight="bold" fontFamily="monospace">
                        {pos.id}
                      </text>
                      {isRoot && (
                        <text x={pos.x} y={pos.y - 24} textAnchor="middle"
                          fill="#666" fontSize={9} fontFamily="monospace">
                          r={node.rank}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Parent Array */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Parent Array</h3>
              <div className="flex gap-1 flex-wrap">
                {nodes.map(n => (
                  <div key={n.id} className={`w-14 rounded-lg border p-1.5 text-center ${
                    n.parent === n.id ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-[#0a0a0f] border-[#1e1e2e]'
                  }`}>
                    <div className="text-[10px] text-gray-500">id={n.id}</div>
                    <div className="text-xs font-mono font-bold text-white">p={n.parent}</div>
                    <div className="text-[10px] text-gray-600">r={n.rank}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Activity Log</h3>
              <div className="space-y-1 max-h-48 overflow-y-auto text-xs font-mono">
                {log.slice(-12).map((entry, i) => (
                  <div key={i} className={
                    entry.type === 'union' ? 'text-emerald-400'
                    : entry.type === 'find' ? 'text-cyan-400'
                    : entry.type === 'compress' ? 'text-yellow-400'
                    : 'text-gray-400'
                  }>
                    {entry.text}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Complexity</h3>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1">
                  <span className="text-gray-400">Find</span>
                  <span className="text-emerald-400">α(n) ≈ O(1)</span>
                </div>
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1">
                  <span className="text-gray-400">Union</span>
                  <span className="text-emerald-400">α(n) ≈ O(1)</span>
                </div>
                <div className="text-gray-600 mt-2 text-[10px]">
                  α(n) = inverse Ackermann, practically constant
                </div>
              </div>
            </div>

            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-400" /> Optimizations
              </h3>
              <div className="space-y-2 text-xs text-gray-400">
                <div>
                  <span className="text-cyan-400 font-medium">Path Compression:</span> During Find, make every node point directly to root. Flattens tree.
                </div>
                <div>
                  <span className="text-yellow-400 font-medium">Union by Rank:</span> Attach smaller tree under root of larger tree. Keeps height low.
                </div>
              </div>
            </div>

            <div className="bg-[#111118] rounded-lg border border-emerald-500/20 p-4">
              <h3 className="text-sm font-medium text-emerald-400 mb-2">Use Cases</h3>
              <div className="space-y-1 text-xs text-gray-400">
                <div>• Kruskal&apos;s MST algorithm</div>
                <div>• Connected components</div>
                <div>• Network connectivity</div>
                <div>• Image segmentation</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}