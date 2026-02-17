'use client';

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, RotateCcw, ChevronRight, ArrowUp, ArrowDown,
  Plus, Minus, Info, Layers
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

interface HeapNode {
  value: number;
  highlight: 'none' | 'active' | 'swapping' | 'done' | 'extracted';
}

interface LogEntry {
  text: string;
  type: 'insert' | 'extract' | 'swap' | 'info';
}

type HeapType = 'min' | 'max';

const PRESETS = [
  { name: 'Random', values: [45, 20, 35, 15, 10, 50, 25, 30, 5, 40] },
  { name: 'Sorted', values: [10, 20, 30, 40, 50, 60, 70, 80, 90] },
  { name: 'Reversed', values: [90, 80, 70, 60, 50, 40, 30, 20, 10] },
  { name: 'Small', values: [3, 1, 4, 1, 5, 9, 2, 6] },
];

export default function HeapsPage() {
  const [heap, setHeap] = useState<HeapNode[]>([]);
  const [heapType, setHeapType] = useState<HeapType>('min');
  const [log, setLog] = useState<LogEntry[]>([{ text: 'Heap initialized. Add elements or load a preset.', type: 'info' }]);
  const [inputValue, setInputValue] = useState('');
  const [animatingIndex, setAnimatingIndex] = useState<number | null>(null);
  const [swapPair, setSwapPair] = useState<[number, number] | null>(null);
  const animRef = useRef<NodeJS.Timeout | null>(null);

  const compare = useCallback((a: number, b: number) => {
    return heapType === 'min' ? a < b : a > b;
  }, [heapType]);

  const bubbleUp = useCallback((arr: HeapNode[], index: number, logs: LogEntry[]): HeapNode[] => {
    const newArr = [...arr];
    let i = index;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (compare(newArr[i].value, newArr[parent].value)) {
        logs.push({ text: `Swap ${newArr[i].value} ↔ ${newArr[parent].value} (child ${heapType === 'min' ? '<' : '>'} parent)`, type: 'swap' });
        [newArr[i], newArr[parent]] = [newArr[parent], newArr[i]];
        i = parent;
      } else {
        break;
      }
    }
    newArr[i] = { ...newArr[i], highlight: 'done' };
    return newArr;
  }, [compare, heapType]);

  const bubbleDown = useCallback((arr: HeapNode[], index: number, logs: LogEntry[]): HeapNode[] => {
    const newArr = [...arr];
    let i = index;
    const n = newArr.length;
    while (true) {
      let target = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && compare(newArr[left].value, newArr[target].value)) target = left;
      if (right < n && compare(newArr[right].value, newArr[target].value)) target = right;
      if (target !== i) {
        logs.push({ text: `Swap ${newArr[i].value} ↔ ${newArr[target].value} (bubble down)`, type: 'swap' });
        [newArr[i], newArr[target]] = [newArr[target], newArr[i]];
        i = target;
      } else {
        break;
      }
    }
    return newArr;
  }, [compare]);

  const handleInsert = useCallback((value: number) => {
    const newLogs: LogEntry[] = [];
    newLogs.push({ text: `Insert ${value}`, type: 'insert' });

    let newHeap = [...heap, { value, highlight: 'active' as const }];
    newHeap = bubbleUp(newHeap, newHeap.length - 1, newLogs);

    setHeap(newHeap);
    setLog(prev => [...prev, ...newLogs]);
  }, [heap, bubbleUp]);

  const handleExtract = useCallback(() => {
    if (heap.length === 0) return;
    const newLogs: LogEntry[] = [];
    const extracted = heap[0].value;
    newLogs.push({ text: `Extract ${heapType}: ${extracted}`, type: 'extract' });

    if (heap.length === 1) {
      setHeap([]);
      setLog(prev => [...prev, ...newLogs]);
      return;
    }

    let newHeap = [...heap];
    newHeap[0] = { ...newHeap[newHeap.length - 1], highlight: 'active' };
    newHeap.pop();
    newHeap = bubbleDown(newHeap, 0, newLogs);

    setHeap(newHeap);
    setLog(prev => [...prev, ...newLogs]);
  }, [heap, heapType, bubbleDown]);

  const handleLoadPreset = useCallback((values: number[]) => {
    const newLogs: LogEntry[] = [{ text: `Building heap from [${values.join(', ')}]`, type: 'info' }];
    let newHeap: HeapNode[] = [];

    for (const v of values) {
      newHeap.push({ value: v, highlight: 'none' });
      newHeap = bubbleUp([...newHeap], newHeap.length - 1, newLogs);
    }

    newHeap = newHeap.map(n => ({ ...n, highlight: 'none' }));
    setHeap(newHeap);
    setLog(newLogs);
  }, [bubbleUp]);

  const handleReset = () => {
    setHeap([]);
    setLog([{ text: 'Heap cleared.', type: 'info' }]);
  };

  // Tree layout calculation
  const getNodePosition = (index: number, totalLevels: number) => {
    const level = Math.floor(Math.log2(index + 1));
    const posInLevel = index - (Math.pow(2, level) - 1);
    const nodesInLevel = Math.pow(2, level);
    const totalWidth = 700;
    const spacing = totalWidth / (nodesInLevel + 1);
    const x = spacing * (posInLevel + 1);
    const y = level * 70 + 40;
    return { x, y };
  };

  const totalLevels = heap.length > 0 ? Math.floor(Math.log2(heap.length)) + 1 : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Layers className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Heaps & Priority Queues</h1>
              <p className="text-sm text-gray-400">Module 4.6 — Binary heap with bubble-up/down animation</p>
            </div>
          </div>
        </div>

        {/* Config Row */}
        <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          {/* Heap Type */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Type:</span>
            {(['min', 'max'] as HeapType[]).map(t => (
              <button key={t} onClick={() => { setHeapType(t); handleReset(); }}
                className={`px-3 py-1.5 rounded text-xs font-medium ${
                  heapType === t ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-500 hover:text-gray-300'
                }`}>
                {t === 'min' ? 'Min-Heap' : 'Max-Heap'}
              </button>
            ))}
          </div>

          {/* Presets */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Preset:</span>
            {PRESETS.map(p => (
              <button key={p.name} onClick={() => handleLoadPreset(p.values)}
                className="px-2 py-1 rounded text-xs text-gray-400 hover:text-emerald-400 bg-[#1e1e2e] hover:bg-emerald-500/10">
                {p.name}
              </button>
            ))}
          </div>

          {/* Insert */}
          <div className="flex items-center gap-2 ml-auto">
            <input
              type="number"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && inputValue) { handleInsert(parseInt(inputValue)); setInputValue(''); } }}
              placeholder="Value"
              className="w-20 px-2 py-1.5 rounded bg-[#0a0a0f] border border-[#1e1e2e] text-white text-xs focus:border-emerald-500/50 outline-none"
            />
            <button onClick={() => { if (inputValue) { handleInsert(parseInt(inputValue)); setInputValue(''); } }}
              className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-400 text-xs hover:bg-emerald-500/30 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Insert
            </button>
            <button onClick={handleExtract}
              className="px-3 py-1.5 rounded bg-red-500/20 text-red-400 text-xs hover:bg-red-500/30 flex items-center gap-1">
              <Minus className="w-3 h-3" /> Extract {heapType}
            </button>
            <button onClick={handleReset}
              className="px-3 py-1.5 rounded bg-[#1e1e2e] text-gray-400 text-xs hover:text-white flex items-center gap-1">
              <RotateCcw className="w-3 h-3" /> Clear
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Visualization */}
          <div className="lg:col-span-2 space-y-4">
            {/* Tree View */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Heap Tree</h3>
              <svg width="100%" viewBox={`0 0 700 ${Math.max(120, totalLevels * 70 + 40)}`} className="overflow-visible">
                {/* Edges */}
                {heap.map((_, i) => {
                  if (i === 0) return null;
                  const parentIdx = Math.floor((i - 1) / 2);
                  const parentPos = getNodePosition(parentIdx, totalLevels);
                  const childPos = getNodePosition(i, totalLevels);
                  return (
                    <motion.line
                      key={`edge-${i}`}
                      x1={parentPos.x} y1={parentPos.y}
                      x2={childPos.x} y2={childPos.y}
                      stroke="#2a2a3a"
                      strokeWidth={1.5}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    />
                  );
                })}

                {/* Nodes */}
                {heap.map((node, i) => {
                  const pos = getNodePosition(i, totalLevels);
                  const colors = {
                    none: { fill: '#1e1e2e', stroke: '#3a3a4a', text: '#ffffff' },
                    active: { fill: '#10b98133', stroke: '#10b981', text: '#10b981' },
                    swapping: { fill: '#f59e0b33', stroke: '#f59e0b', text: '#f59e0b' },
                    done: { fill: '#06b6d433', stroke: '#06b6d4', text: '#06b6d4' },
                    extracted: { fill: '#ef444433', stroke: '#ef4444', text: '#ef4444' },
                  };
                  const c = colors[node.highlight];
                  return (
                    <motion.g key={`node-${i}`}
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                    >
                      <circle cx={pos.x} cy={pos.y} r={20}
                        fill={c.fill} stroke={c.stroke} strokeWidth={2} />
                      <text x={pos.x} y={pos.y + 5}
                        textAnchor="middle" fill={c.text}
                        fontSize={12} fontWeight="bold" fontFamily="monospace">
                        {node.value}
                      </text>
                      <text x={pos.x} y={pos.y + 32}
                        textAnchor="middle" fill="#666"
                        fontSize={9} fontFamily="monospace">
                        [{i}]
                      </text>
                    </motion.g>
                  );
                })}

                {heap.length === 0 && (
                  <text x={350} y={60} textAnchor="middle" fill="#666" fontSize={14}>
                    Insert elements or load a preset
                  </text>
                )}
              </svg>
            </div>

            {/* Array Representation */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Array Representation</h3>
              <div className="flex gap-1.5 flex-wrap">
                {heap.map((node, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`w-12 h-12 rounded-lg flex flex-col items-center justify-center text-xs font-mono border ${
                      node.highlight === 'active' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                      : node.highlight === 'done' ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
                      : 'bg-[#1e1e2e] border-[#2a2a3a] text-white'
                    }`}
                  >
                    <span className="font-bold">{node.value}</span>
                    <span className="text-gray-600 text-[10px]">[{i}]</span>
                  </motion.div>
                ))}
              </div>
              {heap.length > 0 && (
                <div className="mt-3 text-xs text-gray-500 font-mono">
                  Parent(i) = ⌊(i-1)/2⌋ | Left(i) = 2i+1 | Right(i) = 2i+2
                </div>
              )}
            </div>
          </div>

          {/* Right Panel */}
          <div className="space-y-4">
            {/* Heap Properties */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-400" /> Heap Properties
              </h3>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1.5">
                  <span className="text-gray-500">Size</span>
                  <span className="text-emerald-400">{heap.length}</span>
                </div>
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1.5">
                  <span className="text-gray-500">Height</span>
                  <span className="text-emerald-400">{heap.length > 0 ? Math.floor(Math.log2(heap.length)) : 0}</span>
                </div>
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1.5">
                  <span className="text-gray-500">Root ({heapType})</span>
                  <span className="text-cyan-400">{heap.length > 0 ? heap[0].value : '—'}</span>
                </div>
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1.5">
                  <span className="text-gray-500">Type</span>
                  <span className="text-yellow-400">{heapType === 'min' ? 'Min-Heap' : 'Max-Heap'}</span>
                </div>
              </div>
            </div>

            {/* Complexity */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Time Complexity</h3>
              <div className="space-y-1.5 text-xs font-mono">
                {[
                  { op: 'Insert', time: 'O(log n)', desc: 'Bubble up' },
                  { op: 'Extract', time: 'O(log n)', desc: 'Bubble down' },
                  { op: 'Peek', time: 'O(1)', desc: 'Root element' },
                  { op: 'Heapify', time: 'O(n)', desc: 'Build from array' },
                ].map(c => (
                  <div key={c.op} className="flex items-center justify-between bg-[#0a0a0f] rounded px-2 py-1">
                    <span className="text-gray-400">{c.op}</span>
                    <span className="text-emerald-400">{c.time}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Activity Log */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Activity Log</h3>
              <div className="space-y-1 max-h-48 overflow-y-auto text-xs font-mono">
                {log.slice(-15).map((entry, i) => (
                  <div key={i} className={
                    entry.type === 'insert' ? 'text-green-400'
                    : entry.type === 'extract' ? 'text-red-400'
                    : entry.type === 'swap' ? 'text-yellow-400'
                    : 'text-gray-400'
                  }>
                    {entry.text}
                  </div>
                ))}
              </div>
            </div>

            {/* How it works */}
            <div className="bg-[#111118] rounded-lg border border-emerald-500/20 p-4">
              <h3 className="text-sm font-medium text-emerald-400 mb-2">How Binary Heaps Work</h3>
              <div className="space-y-2 text-xs text-gray-400">
                <div>
                  <span className="text-emerald-400 font-medium">Insert:</span> Add at end, bubble up by swapping with parent if heap property violated.
                </div>
                <div>
                  <span className="text-red-400 font-medium">Extract:</span> Remove root, move last to root, bubble down by swapping with smaller (min) / larger (max) child.
                </div>
                <div>
                  <span className="text-cyan-400 font-medium">Property:</span> {heapType === 'min'
                    ? 'Every parent ≤ both children.'
                    : 'Every parent ≥ both children.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}