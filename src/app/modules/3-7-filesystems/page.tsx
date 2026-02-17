'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, RotateCcw, HardDrive, FolderTree, File, Trash2,
  Plus, ChevronRight, Info, Layers
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

// Types
interface Inode {
  id: number;
  name: string;
  type: 'file' | 'directory';
  size: number;
  blocks: number[];
  children?: number[]; // inode IDs for directories
  parent: number | null;
  created: number;
}

interface Block {
  id: number;
  status: 'free' | 'used' | 'metadata';
  inodeId: number | null;
  highlight: boolean;
}

interface FileOp {
  type: 'create' | 'delete' | 'resize';
  name: string;
  size?: number;
  parentId: number;
  step: number;
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  allocation: 'contiguous' | 'linked' | 'indexed' | 'extent';
  totalBlocks: number;
  operations: FileOp[];
}

const SCENARIOS: Scenario[] = [
  {
    id: 'contiguous',
    name: 'Contiguous Allocation',
    description: 'Files occupy consecutive blocks. Fast reads but external fragmentation.',
    allocation: 'contiguous',
    totalBlocks: 64,
    operations: [
      { type: 'create', name: 'readme.txt', size: 3, parentId: 0, step: 0 },
      { type: 'create', name: 'data.csv', size: 5, parentId: 0, step: 1 },
      { type: 'create', name: 'image.png', size: 8, parentId: 0, step: 2 },
      { type: 'delete', name: 'data.csv', parentId: 0, step: 3 },
      { type: 'create', name: 'log.txt', size: 4, parentId: 0, step: 4 },
      { type: 'create', name: 'big.bin', size: 7, parentId: 0, step: 5 },
    ],
  },
  {
    id: 'linked',
    name: 'Linked Allocation',
    description: 'Each block points to the next. No external fragmentation but slow random access.',
    allocation: 'linked',
    totalBlocks: 64,
    operations: [
      { type: 'create', name: 'notes.md', size: 4, parentId: 0, step: 0 },
      { type: 'create', name: 'report.pdf', size: 6, parentId: 0, step: 1 },
      { type: 'delete', name: 'notes.md', parentId: 0, step: 2 },
      { type: 'create', name: 'archive.zip', size: 5, parentId: 0, step: 3 },
      { type: 'create', name: 'backup.tar', size: 8, parentId: 0, step: 4 },
    ],
  },
  {
    id: 'indexed',
    name: 'Indexed Allocation',
    description: 'Index block holds all block pointers. Supports direct access without fragmentation.',
    allocation: 'indexed',
    totalBlocks: 64,
    operations: [
      { type: 'create', name: 'app.js', size: 3, parentId: 0, step: 0 },
      { type: 'create', name: 'styles.css', size: 4, parentId: 0, step: 1 },
      { type: 'create', name: 'bundle.js', size: 7, parentId: 0, step: 2 },
      { type: 'delete', name: 'styles.css', parentId: 0, step: 3 },
      { type: 'create', name: 'index.html', size: 2, parentId: 0, step: 4 },
      { type: 'create', name: 'assets.bin', size: 6, parentId: 0, step: 5 },
    ],
  },
  {
    id: 'extent',
    name: 'Extent-Based (ext4)',
    description: 'Extents describe contiguous runs. Efficient for large files, used by ext4.',
    allocation: 'extent',
    totalBlocks: 64,
    operations: [
      { type: 'create', name: 'video.mp4', size: 12, parentId: 0, step: 0 },
      { type: 'create', name: 'song.mp3', size: 6, parentId: 0, step: 1 },
      { type: 'create', name: 'photo.jpg', size: 4, parentId: 0, step: 2 },
      { type: 'delete', name: 'song.mp3', parentId: 0, step: 3 },
      { type: 'create', name: 'doc.pdf', size: 8, parentId: 0, step: 4 },
    ],
  },
];

const FILE_COLORS: Record<string, string> = {
  'readme.txt': '#06b6d4',
  'data.csv': '#8b5cf6',
  'image.png': '#f59e0b',
  'log.txt': '#10b981',
  'big.bin': '#ef4444',
  'notes.md': '#06b6d4',
  'report.pdf': '#8b5cf6',
  'archive.zip': '#f59e0b',
  'backup.tar': '#10b981',
  'app.js': '#06b6d4',
  'styles.css': '#8b5cf6',
  'bundle.js': '#f59e0b',
  'index.html': '#10b981',
  'assets.bin': '#ef4444',
  'video.mp4': '#06b6d4',
  'song.mp3': '#8b5cf6',
  'photo.jpg': '#f59e0b',
  'doc.pdf': '#10b981',
};

export default function FileSystemsPage() {
  const [scenario, setScenario] = useState<Scenario>(SCENARIOS[0]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [inodes, setInodes] = useState<Map<number, Inode>>(new Map());
  const [currentStep, setCurrentStep] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedInode, setSelectedInode] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [highlightBlocks, setHighlightBlocks] = useState<Set<number>>(new Set());
  const nextInodeId = useRef(1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const initState = useCallback((sc: Scenario) => {
    const newBlocks: Block[] = Array.from({ length: sc.totalBlocks }, (_, i) => ({
      id: i,
      status: i < 2 ? 'metadata' : 'free',
      inodeId: null,
      highlight: false,
    }));
    const rootInode: Inode = {
      id: 0,
      name: '/',
      type: 'directory',
      size: 0,
      blocks: [0],
      children: [],
      parent: null,
      created: 0,
    };
    const map = new Map<number, Inode>();
    map.set(0, rootInode);
    nextInodeId.current = 1;
    setBlocks(newBlocks);
    setInodes(map);
    setCurrentStep(-1);
    setSelectedInode(null);
    setLog(['File system initialized. Root inode created.']);
    setHighlightBlocks(new Set());
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    initState(scenario);
  }, [scenario, initState]);

  const findFreeBlocks = useCallback((blockArr: Block[], count: number, allocation: string): number[] => {
    const freeIndices = blockArr.map((b, i) => (b.status === 'free' ? i : -1)).filter(i => i >= 0);

    if (allocation === 'contiguous') {
      for (let i = 0; i <= freeIndices.length - count; i++) {
        let contiguous = true;
        for (let j = 1; j < count; j++) {
          if (freeIndices[i + j] !== freeIndices[i] + j) {
            contiguous = false;
            break;
          }
        }
        if (contiguous) return freeIndices.slice(i, i + count);
      }
      return [];
    }

    if (freeIndices.length < count) return [];

    if (allocation === 'indexed') {
      // Need count + 1 blocks (1 for index block)
      if (freeIndices.length < count + 1) return [];
      return freeIndices.slice(0, count + 1);
    }

    return freeIndices.slice(0, count);
  }, []);

  const executeStep = useCallback((stepIndex: number) => {
    if (stepIndex >= scenario.operations.length) {
      setIsPlaying(false);
      return;
    }

    const op = scenario.operations[stepIndex];

    setBlocks(prev => {
      const newBlocks = [...prev];
      setInodes(prevInodes => {
        const newInodes = new Map(prevInodes);

        if (op.type === 'create' && op.size) {
          const allocated = findFreeBlocks(newBlocks, op.size, scenario.allocation);
          if (allocated.length === 0) {
            setLog(l => [...l, `FAILED: Cannot allocate ${op.size} blocks for ${op.name} (fragmentation!)`]);
            return newInodes;
          }

          const inodeId = nextInodeId.current++;
          let dataBlocks = allocated;
          let indexBlock: number | undefined;

          if (scenario.allocation === 'indexed') {
            indexBlock = allocated[0];
            dataBlocks = allocated.slice(1);
            newBlocks[indexBlock] = { ...newBlocks[indexBlock], status: 'metadata', inodeId };
          }

          dataBlocks.forEach(bi => {
            newBlocks[bi] = { ...newBlocks[bi], status: 'used', inodeId };
          });

          const newInode: Inode = {
            id: inodeId,
            name: op.name,
            type: 'file',
            size: op.size,
            blocks: scenario.allocation === 'indexed' ? [indexBlock!, ...dataBlocks] : dataBlocks,
            parent: op.parentId,
            created: stepIndex,
          };
          newInodes.set(inodeId, newInode);

          const parent = newInodes.get(op.parentId);
          if (parent) {
            newInodes.set(op.parentId, {
              ...parent,
              children: [...(parent.children || []), inodeId],
            });
          }

          setHighlightBlocks(new Set(allocated));
          const allocStr = scenario.allocation === 'indexed'
            ? `blocks ${dataBlocks.join(',')} (index: ${indexBlock})`
            : `blocks ${dataBlocks.join(',')}`;
          setLog(l => [...l, `CREATE ${op.name} → inode ${inodeId}, ${allocStr}`]);
        }

        if (op.type === 'delete') {
          let targetId: number | null = null;
          for (const [id, inode] of newInodes) {
            if (inode.name === op.name) {
              targetId = id;
              break;
            }
          }
          if (targetId !== null) {
            const inode = newInodes.get(targetId)!;
            const freedBlocks = inode.blocks;
            freedBlocks.forEach(bi => {
              newBlocks[bi] = { ...newBlocks[bi], status: 'free', inodeId: null };
            });
            setHighlightBlocks(new Set(freedBlocks));

            if (inode.parent !== null) {
              const parent = newInodes.get(inode.parent);
              if (parent) {
                newInodes.set(inode.parent, {
                  ...parent,
                  children: (parent.children || []).filter(c => c !== targetId),
                });
              }
            }
            newInodes.delete(targetId);
            setLog(l => [...l, `DELETE ${op.name} → freed blocks ${freedBlocks.join(',')}`]);
          }
        }

        return newInodes;
      });
      return newBlocks;
    });

    setCurrentStep(stepIndex);
  }, [scenario, findFreeBlocks]);

  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setTimeout(() => {
        executeStep(currentStep + 1);
      }, 1200 / speed);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, currentStep, speed, executeStep]);

  const handlePlayPause = () => {
    if (currentStep >= scenario.operations.length - 1) {
      initState(scenario);
      setTimeout(() => setIsPlaying(true), 100);
      return;
    }
    setIsPlaying(!isPlaying);
  };

  const handleStep = () => {
    setIsPlaying(false);
    if (currentStep < scenario.operations.length - 1) {
      executeStep(currentStep + 1);
    }
  };

  const handleReset = () => {
    setIsPlaying(false);
    initState(scenario);
  };

  const usedBlocks = blocks.filter(b => b.status === 'used').length;
  const metaBlocks = blocks.filter(b => b.status === 'metadata').length;
  const freeBlocks = blocks.filter(b => b.status === 'free').length;

  // Calculate fragmentation
  const freeRuns: number[] = [];
  let runLen = 0;
  blocks.forEach(b => {
    if (b.status === 'free') { runLen++; }
    else { if (runLen > 0) freeRuns.push(runLen); runLen = 0; }
  });
  if (runLen > 0) freeRuns.push(runLen);
  const fragmentation = freeRuns.length > 1 ? ((freeRuns.length - 1) / freeRuns.length * 100).toFixed(0) : '0';

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <HardDrive className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">File Systems</h1>
              <p className="text-sm text-gray-400">Module 3.7 — Inode structure, directory tree, block allocation strategies</p>
            </div>
          </div>
        </div>

        {/* Scenario Selector */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {SCENARIOS.map(sc => (
            <button
              key={sc.id}
              onClick={() => { setScenario(sc); setIsPlaying(false); }}
              className={`p-3 rounded-lg border text-left transition-all ${
                scenario.id === sc.id
                  ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-400'
                  : 'bg-[#111118] border-[#1e1e2e] text-gray-400 hover:border-cyan-500/30'
              }`}
            >
              <div className="text-sm font-medium">{sc.name}</div>
              <div className="text-xs mt-1 opacity-70">{sc.description.slice(0, 50)}...</div>
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <button onClick={handlePlayPause}
            className="w-10 h-10 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center hover:bg-cyan-500/30">
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={handleStep}
            className="px-3 py-2 rounded-lg bg-[#1e1e2e] text-gray-300 text-sm hover:text-white flex items-center gap-1">
            <ChevronRight className="w-4 h-4" /> Step
          </button>
          <button onClick={handleReset}
            className="px-3 py-2 rounded-lg bg-[#1e1e2e] text-gray-300 text-sm hover:text-white flex items-center gap-1">
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-gray-500">Speed:</span>
            {[0.5, 1, 2].map(s => (
              <button key={s} onClick={() => setSpeed(s)}
                className={`px-2 py-1 rounded text-xs ${speed === s ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}>
                {s}x
              </button>
            ))}
          </div>
          <div className="text-xs text-gray-500">
            Step {currentStep + 1} / {scenario.operations.length}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Block Map */}
          <div className="lg:col-span-2">
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" /> Disk Block Map
              </h3>
              <div className="grid grid-cols-8 gap-1.5">
                {blocks.map(block => {
                  const fileColor = block.inodeId !== null
                    ? (() => {
                        const inode = inodes.get(block.inodeId);
                        return inode ? (FILE_COLORS[inode.name] || '#06b6d4') : '#444';
                      })()
                    : undefined;
                  const isHighlighted = highlightBlocks.has(block.id);

                  return (
                    <motion.div
                      key={block.id}
                      className={`aspect-square rounded-md flex items-center justify-center text-[10px] font-mono cursor-pointer relative ${
                        block.status === 'free'
                          ? 'bg-[#1e1e2e] text-gray-600'
                          : block.status === 'metadata'
                          ? 'text-white'
                          : 'text-white'
                      }`}
                      style={{
                        backgroundColor: block.status === 'used' ? fileColor + '33'
                          : block.status === 'metadata' ? (fileColor ? fileColor + '55' : '#06b6d455')
                          : undefined,
                        borderWidth: 1,
                        borderColor: block.status === 'used' ? fileColor + '88'
                          : block.status === 'metadata' ? (fileColor ? fileColor + '88' : '#06b6d488')
                          : '#2a2a3a',
                      }}
                      animate={{
                        scale: isHighlighted ? [1, 1.15, 1] : 1,
                        boxShadow: isHighlighted ? `0 0 8px ${fileColor || '#06b6d4'}66` : 'none',
                      }}
                      transition={{ duration: 0.4 }}
                      onClick={() => {
                        if (block.inodeId !== null) {
                          setSelectedInode(block.inodeId);
                          const inode = inodes.get(block.inodeId);
                          if (inode) setHighlightBlocks(new Set(inode.blocks));
                        }
                      }}
                    >
                      {block.id}
                    </motion.div>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-4 text-xs text-gray-400">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded bg-[#1e1e2e] border border-[#2a2a3a]" />
                  Free
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded bg-cyan-500/30 border border-cyan-500/50" />
                  Metadata
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded bg-purple-500/30 border border-purple-500/50" />
                  Data
                </div>
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-4 gap-3 mt-4">
                {[
                  { label: 'Used', value: usedBlocks, color: 'text-cyan-400' },
                  { label: 'Metadata', value: metaBlocks, color: 'text-yellow-400' },
                  { label: 'Free', value: freeBlocks, color: 'text-green-400' },
                  { label: 'Fragmentation', value: `${fragmentation}%`, color: 'text-red-400' },
                ].map(m => (
                  <div key={m.label} className="bg-[#0a0a0f] rounded-lg p-2 text-center">
                    <div className={`text-lg font-bold ${m.color}`}>{m.value}</div>
                    <div className="text-xs text-gray-500">{m.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Operations Queue */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4 mt-4">
              <h3 className="text-sm font-medium text-white mb-3">Operations Queue</h3>
              <div className="flex flex-wrap gap-2">
                {scenario.operations.map((op, i) => (
                  <div
                    key={i}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono flex items-center gap-1.5 ${
                      i <= currentStep
                        ? i === currentStep
                          ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                          : 'bg-[#1e1e2e] text-gray-500'
                        : 'bg-[#0a0a0f] text-gray-400 border border-[#1e1e2e]'
                    }`}
                  >
                    {op.type === 'create' ? <Plus className="w-3 h-3" /> :
                     op.type === 'delete' ? <Trash2 className="w-3 h-3" /> : null}
                    {op.type} {op.name} {op.size ? `(${op.size}B)` : ''}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Panel */}
          <div className="space-y-4">
            {/* Directory Tree */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-cyan-400" /> Directory Tree
              </h3>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-sm text-yellow-400 font-mono">
                  <FolderTree className="w-3.5 h-3.5" /> /
                </div>
                <AnimatePresence>
                  {Array.from(inodes.values())
                    .filter(i => i.type === 'file')
                    .map(inode => (
                      <motion.div
                        key={inode.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        className={`flex items-center gap-1.5 text-sm font-mono ml-4 pl-2 py-0.5 rounded cursor-pointer ${
                          selectedInode === inode.id
                            ? 'bg-cyan-500/10 text-cyan-400'
                            : 'text-gray-400 hover:text-gray-200'
                        }`}
                        onClick={() => {
                          setSelectedInode(inode.id);
                          setHighlightBlocks(new Set(inode.blocks));
                        }}
                      >
                        <File className="w-3.5 h-3.5" style={{ color: FILE_COLORS[inode.name] || '#06b6d4' }} />
                        {inode.name}
                        <span className="text-xs text-gray-600 ml-auto">{inode.size}B</span>
                      </motion.div>
                    ))}
                </AnimatePresence>
              </div>
            </div>

            {/* Inode Details */}
            {selectedInode !== null && inodes.get(selectedInode) && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4"
              >
                <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                  <Info className="w-4 h-4 text-cyan-400" /> Inode {selectedInode}
                </h3>
                {(() => {
                  const inode = inodes.get(selectedInode)!;
                  return (
                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Name</span>
                        <span className="text-gray-300">{inode.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Type</span>
                        <span className="text-gray-300">{inode.type}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Size</span>
                        <span className="text-gray-300">{inode.size} blocks</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Blocks:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {inode.blocks.map((b, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">
                              {scenario.allocation === 'indexed' && i === 0 ? `[${b}]` : b}
                            </span>
                          ))}
                        </div>
                      </div>
                      {scenario.allocation === 'linked' && (
                        <div className="mt-2 text-gray-500">
                          Chain: {inode.blocks.join(' → ')} → NULL
                        </div>
                      )}
                      {scenario.allocation === 'indexed' && inode.blocks.length > 0 && (
                        <div className="mt-2 text-gray-500">
                          Index block [{inode.blocks[0]}] → {inode.blocks.slice(1).join(', ')}
                        </div>
                      )}
                      {scenario.allocation === 'extent' && (
                        <div className="mt-2 text-gray-500">
                          Extent: start={inode.blocks[0]}, length={inode.blocks.length}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </motion.div>
            )}

            {/* Activity Log */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Activity Log</h3>
              <div className="space-y-1 max-h-48 overflow-y-auto text-xs font-mono">
                {log.map((entry, i) => (
                  <div key={i} className={`py-0.5 ${
                    entry.includes('FAILED') ? 'text-red-400' :
                    entry.includes('CREATE') ? 'text-green-400' :
                    entry.includes('DELETE') ? 'text-yellow-400' :
                    'text-gray-400'
                  }`}>
                    {entry}
                  </div>
                ))}
              </div>
            </div>

            {/* Allocation Info */}
            <div className="bg-[#111118] rounded-lg border border-cyan-500/20 p-4">
              <h3 className="text-sm font-medium text-cyan-400 mb-2">{scenario.name}</h3>
              <p className="text-xs text-gray-400 leading-relaxed">{scenario.description}</p>
              <div className="mt-3 space-y-1.5 text-xs">
                {scenario.allocation === 'contiguous' && (
                  <>
                    <div className="text-gray-500">+ Fast sequential read</div>
                    <div className="text-gray-500">+ Simple implementation</div>
                    <div className="text-red-400/70">- External fragmentation</div>
                    <div className="text-red-400/70">- Needs compaction</div>
                  </>
                )}
                {scenario.allocation === 'linked' && (
                  <>
                    <div className="text-gray-500">+ No external fragmentation</div>
                    <div className="text-gray-500">+ Easy to grow files</div>
                    <div className="text-red-400/70">- Slow random access</div>
                    <div className="text-red-400/70">- Pointer overhead per block</div>
                  </>
                )}
                {scenario.allocation === 'indexed' && (
                  <>
                    <div className="text-gray-500">+ Direct random access</div>
                    <div className="text-gray-500">+ No external fragmentation</div>
                    <div className="text-red-400/70">- Index block overhead</div>
                    <div className="text-red-400/70">- Max file size limited</div>
                  </>
                )}
                {scenario.allocation === 'extent' && (
                  <>
                    <div className="text-gray-500">+ Best for large files</div>
                    <div className="text-gray-500">+ Compact metadata</div>
                    <div className="text-gray-500">+ Used by ext4, NTFS, XFS</div>
                    <div className="text-red-400/70">- Complex implementation</div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}