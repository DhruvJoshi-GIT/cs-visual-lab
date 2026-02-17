'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Info,
  Plus,
  Trash2,
  RotateCcw,
  BarChart3,
  Layers,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

// ──────────────────────────── Types ────────────────────────────

type AllocStrategy = 'first-fit' | 'best-fit' | 'worst-fit' | 'buddy';

interface MemBlock {
  id: number;
  start: number;
  size: number;
  allocated: boolean;
  label: string;
  color: string;
}

// ──────────────────────────── Constants ────────────────────────────

const DOMAIN_COLOR = '#06b6d4';
const HEAP_SIZE = 256;

const COLORS = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#a855f7'];

const STRATEGIES: { value: AllocStrategy; label: string; desc: string }[] = [
  { value: 'first-fit', label: 'First Fit', desc: 'Use the first free block that is large enough' },
  { value: 'best-fit', label: 'Best Fit', desc: 'Use the smallest free block that fits' },
  { value: 'worst-fit', label: 'Worst Fit', desc: 'Use the largest free block available' },
  { value: 'buddy', label: 'Buddy System', desc: 'Split power-of-2 blocks; merge buddies on free' },
];

// ──────────────────────────── Component ────────────────────────────

export default function AllocatorModule() {
  const [blocks, setBlocks] = useState<MemBlock[]>([
    { id: 0, start: 0, size: HEAP_SIZE, allocated: false, label: 'free', color: '#71717a' },
  ]);
  const [strategy, setStrategy] = useState<AllocStrategy>('first-fit');
  const [allocSize, setAllocSize] = useState(32);
  const [nextId, setNextId] = useState(1);
  const [colorIndex, setColorIndex] = useState(0);
  const [log, setLog] = useState<string[]>([]);

  const allocatedBytes = blocks.filter((b) => b.allocated).reduce((s, b) => s + b.size, 0);
  const freeBytes = HEAP_SIZE - allocatedBytes;
  const fragmentation = blocks.filter((b) => !b.allocated).length;
  const externalFrag = freeBytes > 0 ? ((fragmentation - 1) / Math.max(1, fragmentation)) * 100 : 0;

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [msg, ...prev].slice(0, 30));
  }, []);

  const handleAlloc = useCallback(() => {
    const size = allocSize;

    if (strategy === 'buddy') {
      // Buddy: round up to power of 2
      let buddySize = 1;
      while (buddySize < size) buddySize *= 2;

      setBlocks((prev) => {
        const newBlocks = [...prev];
        // Find smallest free power-of-2 block >= buddySize
        let targetIdx = -1;
        let targetBlock: MemBlock | null = null;
        for (let i = 0; i < newBlocks.length; i++) {
          if (!newBlocks[i].allocated && newBlocks[i].size >= buddySize) {
            if (!targetBlock || newBlocks[i].size < targetBlock.size) {
              targetIdx = i;
              targetBlock = newBlocks[i];
            }
          }
        }
        if (targetIdx < 0 || !targetBlock) {
          addLog(`FAIL: Cannot allocate ${size} bytes (buddy: ${buddySize})`);
          return prev;
        }

        // Split until we reach buddySize
        let currentIdx = targetIdx;
        while (newBlocks[currentIdx].size > buddySize) {
          const block = newBlocks[currentIdx];
          const halfSize = block.size / 2;
          newBlocks.splice(currentIdx, 1,
            { ...block, size: halfSize },
            { id: nextId + 100 + currentIdx, start: block.start + halfSize, size: halfSize, allocated: false, label: 'free', color: '#71717a' }
          );
          addLog(`Split block at ${block.start} (${block.size}) into two ${halfSize}-byte blocks`);
        }

        const color = COLORS[colorIndex % COLORS.length];
        const label = `P${nextId}`;
        newBlocks[currentIdx] = { ...newBlocks[currentIdx], allocated: true, label, color, id: nextId };
        setNextId((n) => n + 1);
        setColorIndex((c) => c + 1);
        addLog(`Allocated ${label}: ${buddySize} bytes at offset ${newBlocks[currentIdx].start}`);
        return newBlocks;
      });
      return;
    }

    // Non-buddy strategies
    setBlocks((prev) => {
      const freeBlocks = prev.map((b, i) => ({ block: b, idx: i })).filter((e) => !e.block.allocated && e.block.size >= size);

      if (freeBlocks.length === 0) {
        addLog(`FAIL: Cannot allocate ${size} bytes — no suitable free block`);
        return prev;
      }

      let chosen: { block: MemBlock; idx: number };
      if (strategy === 'first-fit') {
        chosen = freeBlocks[0];
      } else if (strategy === 'best-fit') {
        chosen = freeBlocks.reduce((best, curr) => curr.block.size < best.block.size ? curr : best);
      } else {
        chosen = freeBlocks.reduce((worst, curr) => curr.block.size > worst.block.size ? curr : worst);
      }

      const newBlocks = [...prev];
      const color = COLORS[colorIndex % COLORS.length];
      const label = `P${nextId}`;

      if (chosen.block.size === size) {
        newBlocks[chosen.idx] = { ...chosen.block, allocated: true, label, color, id: nextId };
      } else {
        // Split: allocated part + remaining free
        newBlocks.splice(chosen.idx, 1,
          { id: nextId, start: chosen.block.start, size, allocated: true, label, color },
          { id: chosen.block.id + 1000, start: chosen.block.start + size, size: chosen.block.size - size, allocated: false, label: 'free', color: '#71717a' }
        );
      }

      setNextId((n) => n + 1);
      setColorIndex((c) => c + 1);
      addLog(`Allocated ${label}: ${size} bytes at offset ${chosen.block.start} (${strategy})`);
      return newBlocks;
    });
  }, [allocSize, strategy, nextId, colorIndex, addLog]);

  const handleFree = useCallback((blockId: number) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      if (idx < 0) return prev;

      const newBlocks = [...prev];
      const block = newBlocks[idx];
      addLog(`Freed ${block.label}: ${block.size} bytes at offset ${block.start}`);
      newBlocks[idx] = { ...block, allocated: false, label: 'free', color: '#71717a' };

      // Coalesce adjacent free blocks
      const coalesced: MemBlock[] = [];
      for (const b of newBlocks) {
        if (coalesced.length > 0 && !coalesced[coalesced.length - 1].allocated && !b.allocated) {
          coalesced[coalesced.length - 1] = {
            ...coalesced[coalesced.length - 1],
            size: coalesced[coalesced.length - 1].size + b.size,
          };
          addLog(`Coalesced free blocks at ${coalesced[coalesced.length - 1].start} (now ${coalesced[coalesced.length - 1].size} bytes)`);
        } else {
          coalesced.push({ ...b });
        }
      }
      return coalesced;
    });
  }, [addLog]);

  const handleReset = useCallback(() => {
    setBlocks([{ id: 0, start: 0, size: HEAP_SIZE, allocated: false, label: 'free', color: '#71717a' }]);
    setNextId(1);
    setColorIndex(0);
    setLog([]);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />
      <main className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-semibold"
                style={{ backgroundColor: `${DOMAIN_COLOR}15`, color: DOMAIN_COLOR, border: `1px solid ${DOMAIN_COLOR}30` }}>
                3.4
              </span>
              <span className="text-xs text-[#71717a]">Operating Systems</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Memory Allocator{' '}
              <span className="text-[#71717a] font-normal">Playground</span>
            </h1>
            <p className="text-sm text-[#a1a1aa] max-w-2xl mt-1">
              Allocate and free memory blocks using different strategies.
              Watch fragmentation build up and compare first-fit, best-fit, worst-fit, and buddy system.
            </p>
          </div>

          {/* Strategy Selector */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs text-[#71717a] mr-1 font-medium uppercase tracking-wider">Strategy:</span>
            {STRATEGIES.map((s) => (
              <button key={s.value} onClick={() => { setStrategy(s.value); handleReset(); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 border ${
                  strategy === s.value
                    ? 'bg-[#06b6d4]/15 text-[#06b6d4] border-[#06b6d4]/30'
                    : 'bg-[#111118] text-[#a1a1aa] border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white'
                }`} title={s.desc}>
                {s.label}
              </button>
            ))}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#71717a]">Size:</span>
              <select value={allocSize} onChange={(e) => setAllocSize(Number(e.target.value))}
                className="bg-[#111118] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-white">
                {[8, 16, 24, 32, 48, 64, 96, 128].map((s) => (
                  <option key={s} value={s}>{s} bytes</option>
                ))}
              </select>
            </div>
            <button onClick={handleAlloc}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#10b981] text-white text-sm font-medium hover:bg-[#059669] transition-all">
              <Plus size={14} /> malloc({allocSize})
            </button>
            <button onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#111118] text-[#a1a1aa] text-sm border border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white transition-all">
              <RotateCcw size={14} /> Reset
            </button>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Allocated', value: `${allocatedBytes}B`, color: '#10b981' },
              { label: 'Free', value: `${freeBytes}B`, color: '#71717a' },
              { label: 'Free Chunks', value: fragmentation.toString(), color: '#f59e0b' },
              { label: 'Utilization', value: `${((allocatedBytes / HEAP_SIZE) * 100).toFixed(0)}%`, color: '#8b5cf6' },
            ].map((m) => (
              <div key={m.label} className="p-3 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: m.color }}>{m.label}</div>
                <div className="text-xl font-bold font-mono text-white">{m.value}</div>
              </div>
            ))}
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
            <div className="space-y-6">
              {/* Heap Visualization */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <Layers size={14} className="text-[#06b6d4]" />
                  Heap ({HEAP_SIZE} bytes)
                </h3>

                {/* Linear heap view */}
                <div className="flex rounded-lg overflow-hidden border border-[#1e1e2e] h-16">
                  {blocks.map((block) => {
                    const widthPct = (block.size / HEAP_SIZE) * 100;
                    return (
                      <motion.div
                        key={`${block.start}-${block.id}`}
                        layout
                        className={`relative flex items-center justify-center border-r border-[#0a0a0f] cursor-pointer group transition-all ${
                          block.allocated ? 'hover:brightness-110' : ''
                        }`}
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: block.allocated ? `${block.color}25` : '#0f0f17',
                          borderBottom: `3px solid ${block.allocated ? block.color : '#1e1e2e'}`,
                        }}
                        onClick={() => block.allocated && handleFree(block.id)}
                        title={block.allocated ? `${block.label}: ${block.size}B at ${block.start} (click to free)` : `Free: ${block.size}B at ${block.start}`}
                      >
                        {widthPct > 8 && (
                          <div className="text-center">
                            <div className="text-[10px] font-mono font-bold" style={{ color: block.allocated ? block.color : '#71717a40' }}>
                              {block.label}
                            </div>
                            <div className="text-[8px] font-mono text-[#71717a]">{block.size}B</div>
                          </div>
                        )}
                        {block.allocated && (
                          <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 size={10} className="text-[#ef4444]" />
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>

                {/* Address ruler */}
                <div className="flex mt-1">
                  {blocks.map((block) => {
                    const widthPct = (block.size / HEAP_SIZE) * 100;
                    return (
                      <div key={`addr-${block.start}`} className="text-[8px] font-mono text-[#71717a]" style={{ width: `${widthPct}%` }}>
                        {block.start}
                      </div>
                    );
                  })}
                  <div className="text-[8px] font-mono text-[#71717a]">{HEAP_SIZE}</div>
                </div>

                {/* Block detail view */}
                <div className="mt-4 space-y-1.5">
                  {blocks.map((block) => (
                    <motion.div
                      key={`detail-${block.start}-${block.id}`}
                      layout
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all ${
                        block.allocated
                          ? 'border-[#1e1e2e] bg-[#0f0f17] hover:border-[#ef4444]/30 cursor-pointer'
                          : 'border-[#1e1e2e]/50 bg-[#0f0f17]/50'
                      }`}
                      onClick={() => block.allocated && handleFree(block.id)}
                    >
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: block.allocated ? block.color : '#1e1e2e' }} />
                      <span className="text-xs font-mono text-[#a1a1aa] w-12">{block.label}</span>
                      <span className="text-[10px] font-mono text-[#71717a]">
                        [{block.start}..{block.start + block.size - 1}]
                      </span>
                      <span className="text-[10px] font-mono text-[#71717a] ml-auto">{block.size}B</span>
                      {block.allocated && (
                        <button className="text-[#ef4444]/50 hover:text-[#ef4444] transition-colors" title="Free this block">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Sidebar */}
            <div className="space-y-4">
              {/* Action Log */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <BarChart3 size={14} className="text-[#06b6d4]" />
                  Activity Log
                </h3>
                <div className="max-h-[300px] overflow-y-auto space-y-1">
                  {log.length === 0 ? (
                    <p className="text-xs text-[#71717a] italic">No activity yet. Allocate some memory!</p>
                  ) : (
                    log.map((entry, i) => (
                      <div key={i} className={`text-[10px] font-mono py-1 px-2 rounded ${
                        entry.startsWith('FAIL') ? 'text-[#ef4444] bg-[#ef4444]/5' :
                        entry.startsWith('Freed') ? 'text-[#f59e0b] bg-[#f59e0b]/5' :
                        entry.startsWith('Coalesced') ? 'text-[#06b6d4] bg-[#06b6d4]/5' :
                        entry.startsWith('Split') ? 'text-[#8b5cf6] bg-[#8b5cf6]/5' :
                        'text-[#10b981] bg-[#10b981]/5'
                      }`}>
                        {entry}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3">Quick Actions</h3>
                <div className="space-y-2">
                  <button onClick={() => {
                    handleReset();
                    setTimeout(() => {
                      const sizes = [32, 64, 16, 48, 32];
                      let delay = 0;
                      sizes.forEach((s) => {
                        setTimeout(() => { setAllocSize(s); }, delay);
                        setTimeout(() => { handleAlloc(); }, delay + 50);
                        delay += 150;
                      });
                    }, 100);
                  }}
                    className="w-full px-3 py-2 rounded-lg text-xs font-medium bg-[#0f0f17] text-[#a1a1aa] border border-[#1e1e2e] hover:text-white hover:border-[#2a2a3e] transition-all text-left">
                    Fill with mixed sizes
                  </button>
                  <button onClick={() => {
                    const allocatedBlocks = blocks.filter((b) => b.allocated);
                    if (allocatedBlocks.length > 0) {
                      const randomBlock = allocatedBlocks[Math.floor(Math.random() * allocatedBlocks.length)];
                      handleFree(randomBlock.id);
                    }
                  }}
                    className="w-full px-3 py-2 rounded-lg text-xs font-medium bg-[#0f0f17] text-[#a1a1aa] border border-[#1e1e2e] hover:text-white hover:border-[#2a2a3e] transition-all text-left">
                    Free random block
                  </button>
                </div>
              </div>

              {/* Info */}
              <div className="p-4 rounded-xl bg-[#0f0f17] border border-[#1e1e2e]/50">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-[#06b6d4] mt-0.5 shrink-0" />
                  <div className="text-[11px] text-[#71717a] leading-relaxed">
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">First Fit:</strong> Fast allocation, but causes fragmentation at the start of the heap.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Best Fit:</strong> Minimizes wasted space per allocation, but leaves many tiny unusable holes.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Worst Fit:</strong> Leaves largest remaining block, but wastes space.
                    </p>
                    <p>
                      <strong className="text-[#a1a1aa]">Buddy:</strong> Power-of-2 splits enable fast coalescing, used in Linux kernel.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
