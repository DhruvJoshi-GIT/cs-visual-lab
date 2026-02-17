'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  Cpu,
  Info,
  Layers,
  Activity,
  HardDrive,
  ChevronDown,
  Zap,
  XCircle,
  CheckCircle,
  Database,
  Grid3X3,
  Hash,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import ModuleControls from '@/components/ui/ModuleControls';

// ──────────────────────────── Types ────────────────────────────

type Mode = 'paging' | 'fifo' | 'lru' | 'optimal';

interface PageTableEntry {
  pageNumber: number;
  frameNumber: number | null;
  valid: boolean;
  dirty: boolean;
  referenced: boolean;
}

interface FrameInfo {
  frameNumber: number;
  pageNumber: number | null;
  loadedAt: number;
  lastUsedAt: number;
  highlight: 'none' | 'hit' | 'fault' | 'victim' | 'loaded';
}

interface PageReplacementState {
  frames: FrameInfo[];
  referenceString: number[];
  currentPosition: number;
  pageFaults: number;
  pageHits: number;
  history: PageReplacementHistoryEntry[];
  fifoQueue: number[]; // page numbers in FIFO order
}

interface PageReplacementHistoryEntry {
  step: number;
  page: number;
  frames: (number | null)[];
  isFault: boolean;
  victimPage: number | null;
}

interface PagingDemoState {
  virtualAddress: number;
  pageSize: number;
  pageTable: PageTableEntry[];
  physicalMemoryFrames: number;
  currentStep: 'input' | 'page_number' | 'table_lookup' | 'frame_resolve' | 'physical_address';
  pageNumber: number;
  offset: number;
  frameNumber: number | null;
  physicalAddress: number | null;
  addressHistory: {
    virtual: number;
    physical: number | null;
    fault: boolean;
  }[];
}

// ──────────────────────────── Constants ────────────────────────────

const MODE_INFO: Record<Mode, { label: string; desc: string }> = {
  paging: { label: 'Paging Basics', desc: 'Virtual to physical address translation via page table' },
  fifo: { label: 'FIFO Replacement', desc: 'First-In First-Out page replacement algorithm' },
  lru: { label: 'LRU Replacement', desc: 'Least Recently Used page replacement algorithm' },
  optimal: { label: 'Optimal Replacement', desc: 'Replaces page not needed for longest time (Belady\'s)' },
};

const MODE_LIST: Mode[] = ['paging', 'fifo', 'lru', 'optimal'];

interface ScenarioPreset {
  label: string;
  desc: string;
  mode: Mode;
  referenceString?: number[];
  numFrames?: number;
}

const SCENARIO_PRESETS: Record<string, ScenarioPreset> = {
  simple_paging: {
    label: 'Simple Paging',
    desc: 'Basic virtual address translation',
    mode: 'paging',
  },
  fifo_anomaly: {
    label: 'FIFO Anomaly',
    desc: 'Belady\'s anomaly: more frames can mean more faults',
    mode: 'fifo',
    referenceString: [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5],
    numFrames: 3,
  },
  lru_vs_fifo: {
    label: 'LRU vs FIFO',
    desc: 'Compare LRU behavior on the same reference string',
    mode: 'lru',
    referenceString: [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2],
    numFrames: 4,
  },
  optimal_baseline: {
    label: 'Optimal Baseline',
    desc: 'The theoretically optimal replacement strategy',
    mode: 'optimal',
    referenceString: [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2],
    numFrames: 3,
  },
};

const FAULT_COLOR = '#ef4444';
const HIT_COLOR = '#10b981';
const VICTIM_COLOR = '#f59e0b';
const LOADED_COLOR = '#06b6d4';

// ──────────────────────────── Helpers ────────────────────────────

function initFrames(count: number): FrameInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    frameNumber: i,
    pageNumber: null,
    loadedAt: -1,
    lastUsedAt: -1,
    highlight: 'none',
  }));
}

function initPageTable(numPages: number, numFrames: number): PageTableEntry[] {
  return Array.from({ length: numPages }, (_, i) => {
    const hasMapping = i < numFrames && Math.random() > 0.3;
    return {
      pageNumber: i,
      frameNumber: hasMapping ? Math.floor(Math.random() * numFrames) : null,
      valid: hasMapping,
      dirty: hasMapping && Math.random() > 0.6,
      referenced: false,
    };
  });
}

function findFIFOVictim(frames: FrameInfo[]): number {
  let oldestIdx = 0;
  let oldestTime = Infinity;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].pageNumber !== null && frames[i].loadedAt < oldestTime) {
      oldestTime = frames[i].loadedAt;
      oldestIdx = i;
    }
  }
  return oldestIdx;
}

function findLRUVictim(frames: FrameInfo[]): number {
  let lruIdx = 0;
  let lruTime = Infinity;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].pageNumber !== null && frames[i].lastUsedAt < lruTime) {
      lruTime = frames[i].lastUsedAt;
      lruIdx = i;
    }
  }
  return lruIdx;
}

function findOptimalVictim(frames: FrameInfo[], referenceString: number[], currentPos: number): number {
  let farthestIdx = 0;
  let farthestNext = -1;

  for (let i = 0; i < frames.length; i++) {
    const page = frames[i].pageNumber;
    if (page === null) continue;

    // Find next occurrence of this page in reference string
    let nextUse = Infinity;
    for (let j = currentPos + 1; j < referenceString.length; j++) {
      if (referenceString[j] === page) {
        nextUse = j;
        break;
      }
    }

    if (nextUse > farthestNext) {
      farthestNext = nextUse;
      farthestIdx = i;
    }
  }

  return farthestIdx;
}

// ──────────────────────────── Component ────────────────────────────

export default function MemoryManagementModule() {
  // ── Mode ──
  const [mode, setMode] = useState<Mode>('paging');
  const [numFrames, setNumFrames] = useState(3);

  // ── Paging demo state ──
  const [pagingState, setPagingState] = useState<PagingDemoState>({
    virtualAddress: 0x1A3C,
    pageSize: 4096,
    pageTable: initPageTable(8, 4),
    physicalMemoryFrames: 4,
    currentStep: 'input',
    pageNumber: 0,
    offset: 0,
    frameNumber: null,
    physicalAddress: null,
    addressHistory: [],
  });

  // ── Page replacement state ──
  const [prState, setPRState] = useState<PageReplacementState>({
    frames: initFrames(3),
    referenceString: [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2],
    currentPosition: -1,
    pageFaults: 0,
    pageHits: 0,
    history: [],
    fifoQueue: [],
  });

  // ── UI state ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);

  // ── Animation refs ──
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // ── Derived metrics ──
  const totalReferences = prState.currentPosition + 1;
  const hitRate = totalReferences > 0
    ? ((prState.pageHits / totalReferences) * 100).toFixed(1)
    : '0.0';
  const framesUsed = prState.frames.filter(f => f.pageNumber !== null).length;

  // ── Step forward ──
  const stepForward = useCallback(() => {
    if (mode === 'paging') {
      stepPaging();
    } else {
      stepPageReplacement();
    }
  }, [mode]);

  // ── Paging step ──
  const stepPaging = useCallback(() => {
    setPagingState(prev => {
      const next = { ...prev, pageTable: prev.pageTable.map(e => ({ ...e })), addressHistory: [...prev.addressHistory] };
      const pageBits = Math.log2(next.pageSize);

      switch (next.currentStep) {
        case 'input': {
          // Generate a random virtual address
          const va = Math.floor(Math.random() * 0xFFFF);
          next.virtualAddress = va;
          next.currentStep = 'page_number';
          next.frameNumber = null;
          next.physicalAddress = null;
          break;
        }
        case 'page_number': {
          const pn = Math.floor(next.virtualAddress / next.pageSize);
          const off = next.virtualAddress % next.pageSize;
          next.pageNumber = pn;
          next.offset = off;
          next.currentStep = 'table_lookup';
          break;
        }
        case 'table_lookup': {
          const entry = next.pageTable.find(e => e.pageNumber === next.pageNumber);
          if (entry && entry.valid) {
            next.frameNumber = entry.frameNumber;
            entry.referenced = true;
          } else {
            // Page fault - load into a random frame
            const frameNum = Math.floor(Math.random() * next.physicalMemoryFrames);
            // Invalidate old mapping for this frame
            for (const e of next.pageTable) {
              if (e.frameNumber === frameNum) {
                e.valid = false;
                e.frameNumber = null;
              }
            }
            if (entry) {
              entry.frameNumber = frameNum;
              entry.valid = true;
              entry.referenced = true;
              entry.dirty = false;
            }
            next.frameNumber = frameNum;
          }
          next.currentStep = 'frame_resolve';
          break;
        }
        case 'frame_resolve': {
          if (next.frameNumber !== null) {
            next.physicalAddress = next.frameNumber * next.pageSize + next.offset;
          }
          next.currentStep = 'physical_address';
          break;
        }
        case 'physical_address': {
          next.addressHistory.push({
            virtual: next.virtualAddress,
            physical: next.physicalAddress,
            fault: next.pageTable.find(e => e.pageNumber === next.pageNumber)?.referenced === false,
          });
          if (next.addressHistory.length > 10) {
            next.addressHistory = next.addressHistory.slice(-10);
          }
          next.currentStep = 'input';
          break;
        }
      }

      return next;
    });
  }, []);

  // ── Page Replacement step ──
  const stepPageReplacement = useCallback(() => {
    setPRState(prev => {
      if (prev.currentPosition >= prev.referenceString.length - 1) {
        setIsPlaying(false);
        return prev;
      }

      const next: PageReplacementState = {
        ...prev,
        frames: prev.frames.map(f => ({ ...f, highlight: 'none' as const })),
        history: [...prev.history],
        fifoQueue: [...prev.fifoQueue],
      };

      const newPos = prev.currentPosition + 1;
      next.currentPosition = newPos;
      const requestedPage = next.referenceString[newPos];

      // Check if page is already in frames (hit)
      const existingFrame = next.frames.find(f => f.pageNumber === requestedPage);

      if (existingFrame) {
        // Page Hit
        next.pageHits++;
        existingFrame.lastUsedAt = newPos;
        existingFrame.highlight = 'hit';

        next.history.push({
          step: newPos,
          page: requestedPage,
          frames: next.frames.map(f => f.pageNumber),
          isFault: false,
          victimPage: null,
        });
      } else {
        // Page Fault
        next.pageFaults++;

        // Find empty frame first
        const emptyFrame = next.frames.find(f => f.pageNumber === null);

        if (emptyFrame) {
          // Load into empty frame
          emptyFrame.pageNumber = requestedPage;
          emptyFrame.loadedAt = newPos;
          emptyFrame.lastUsedAt = newPos;
          emptyFrame.highlight = 'loaded';
          next.fifoQueue.push(requestedPage);

          next.history.push({
            step: newPos,
            page: requestedPage,
            frames: next.frames.map(f => f.pageNumber),
            isFault: true,
            victimPage: null,
          });
        } else {
          // Need to evict
          let victimIdx: number;

          switch (mode) {
            case 'fifo':
              victimIdx = findFIFOVictim(next.frames);
              break;
            case 'lru':
              victimIdx = findLRUVictim(next.frames);
              break;
            case 'optimal':
              victimIdx = findOptimalVictim(next.frames, next.referenceString, newPos);
              break;
            default:
              victimIdx = 0;
          }

          const victimPage = next.frames[victimIdx].pageNumber;

          // Remove from FIFO queue
          if (mode === 'fifo') {
            next.fifoQueue = next.fifoQueue.filter(p => p !== victimPage);
          }

          // Evict and load
          next.frames[victimIdx] = {
            ...next.frames[victimIdx],
            pageNumber: requestedPage,
            loadedAt: newPos,
            lastUsedAt: newPos,
            highlight: 'loaded',
          };

          next.fifoQueue.push(requestedPage);

          // Mark other frames that were victim
          // We handle highlighting separately since we already replaced

          next.history.push({
            step: newPos,
            page: requestedPage,
            frames: next.frames.map(f => f.pageNumber),
            isFault: true,
            victimPage,
          });
        }
      }

      return next;
    });
  }, [mode]);

  // ── Animation loop ──
  const animationLoop = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) return;
    const interval = Math.max(10, 200 / speedRef.current);
    if (timestamp - lastTickRef.current >= interval) {
      lastTickRef.current = timestamp;
      stepForward();
    }
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [stepForward]);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const handleStep = useCallback(() => {
    if (isPlaying) handlePause();
    stepForward();
  }, [isPlaying, handlePause, stepForward]);

  const handleReset = useCallback(() => {
    handlePause();
    if (mode === 'paging') {
      setPagingState({
        virtualAddress: 0x1A3C,
        pageSize: 4096,
        pageTable: initPageTable(8, 4),
        physicalMemoryFrames: 4,
        currentStep: 'input',
        pageNumber: 0,
        offset: 0,
        frameNumber: null,
        physicalAddress: null,
        addressHistory: [],
      });
    } else {
      setPRState(prev => ({
        ...prev,
        frames: initFrames(numFrames),
        currentPosition: -1,
        pageFaults: 0,
        pageHits: 0,
        history: [],
        fifoQueue: [],
      }));
    }
  }, [handlePause, mode, numFrames]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // ── Mode change ──
  const handleModeChange = useCallback((newMode: Mode) => {
    handlePause();
    setMode(newMode);
    if (newMode === 'paging') {
      setPagingState({
        virtualAddress: 0x1A3C,
        pageSize: 4096,
        pageTable: initPageTable(8, 4),
        physicalMemoryFrames: 4,
        currentStep: 'input',
        pageNumber: 0,
        offset: 0,
        frameNumber: null,
        physicalAddress: null,
        addressHistory: [],
      });
    } else {
      setPRState(prev => ({
        ...prev,
        frames: initFrames(numFrames),
        currentPosition: -1,
        pageFaults: 0,
        pageHits: 0,
        history: [],
        fifoQueue: [],
      }));
    }
  }, [handlePause, numFrames]);

  // ── Load scenario ──
  const loadScenario = useCallback((key: string) => {
    handlePause();
    const scenario = SCENARIO_PRESETS[key];
    if (!scenario) return;
    setMode(scenario.mode);
    if (scenario.mode === 'paging') {
      setPagingState({
        virtualAddress: 0x1A3C,
        pageSize: 4096,
        pageTable: initPageTable(8, 4),
        physicalMemoryFrames: 4,
        currentStep: 'input',
        pageNumber: 0,
        offset: 0,
        frameNumber: null,
        physicalAddress: null,
        addressHistory: [],
      });
    } else {
      const nf = scenario.numFrames || 3;
      setNumFrames(nf);
      setPRState({
        frames: initFrames(nf),
        referenceString: scenario.referenceString || [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2],
        currentPosition: -1,
        pageFaults: 0,
        pageHits: 0,
        history: [],
        fifoQueue: [],
      });
    }
  }, [handlePause]);

  // ── Frame count change ──
  const handleFrameCountChange = useCallback((count: number) => {
    setNumFrames(count);
    setPRState(prev => ({
      ...prev,
      frames: initFrames(count),
      currentPosition: -1,
      pageFaults: 0,
      pageHits: 0,
      history: [],
      fifoQueue: [],
    }));
  }, []);

  // Load default on mount
  useEffect(() => {
    loadScenario('fifo_anomaly');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Is page replacement mode ──
  const isPageReplacement = mode !== 'paging';
  const simulationDone = isPageReplacement && prState.currentPosition >= prState.referenceString.length - 1;

  // ──────────────────────────── Render ────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />

      <main className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* ── Header ── */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-0.5 rounded-md bg-[#06b6d4]/15 border border-[#06b6d4]/25 text-[#06b6d4] text-xs font-mono font-semibold">
                3.3
              </span>
              <h1 className="text-2xl font-bold tracking-tight">
                Memory Management{' '}
                <span className="text-[#71717a] font-normal">& Paging</span>
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Explore virtual memory paging and page replacement algorithms.{' '}
              Watch how{' '}
              <span className="text-[#ef4444] font-mono">FIFO</span>,{' '}
              <span className="text-[#10b981] font-mono">LRU</span>, and{' '}
              <span className="text-[#06b6d4] font-mono">Optimal</span>{' '}
              handle page faults with configurable frame counts.
            </p>
          </div>

          {/* ── Controls Bar ── */}
          <div className="mb-6">
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
            >
              {/* Mode selector */}
              <div className="relative">
                <select
                  value={mode}
                  onChange={(e) => handleModeChange(e.target.value as Mode)}
                  className="appearance-none px-3 py-2 pr-8 rounded-lg bg-[#06b6d4]/10 border border-[#06b6d4]/30 text-xs text-[#06b6d4] font-mono font-medium focus:outline-none focus:border-[#06b6d4] cursor-pointer"
                >
                  {MODE_LIST.map(m => (
                    <option key={m} value={m} className="bg-[#111118] text-white">{MODE_INFO[m].label}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#06b6d4] pointer-events-none" />
              </div>

              {/* Frame count for replacement modes */}
              {isPageReplacement && (
                <div className="flex items-center gap-2">
                  <Grid3X3 size={14} className="text-[#f59e0b]" />
                  <span className="text-[10px] text-[#71717a] uppercase tracking-wider">Frames:</span>
                  <input
                    type="range"
                    min={2}
                    max={6}
                    value={numFrames}
                    onChange={(e) => handleFrameCountChange(parseInt(e.target.value))}
                    className="w-16 h-1.5 accent-[#f59e0b] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f59e0b]"
                  />
                  <span className="text-xs font-mono text-[#f59e0b]">{numFrames}</span>
                </div>
              )}
            </ModuleControls>
          </div>

          {/* ── Scenarios ── */}
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className="text-xs text-[#71717a] mr-1 font-medium uppercase tracking-wider">
              Presets:
            </span>
            {Object.entries(SCENARIO_PRESETS).map(([key, scenario]) => (
              <button
                key={key}
                onClick={() => loadScenario(key)}
                className="px-3 py-1.5 rounded-lg bg-[#111118] border border-[#1e1e2e] hover:border-[#2a2a3e] text-xs text-[#a1a1aa] hover:text-white transition-all duration-200 hover:bg-[#16161f]"
                title={scenario.desc}
              >
                {scenario.label}
              </button>
            ))}
          </div>

          {/* ── Metrics Bar ── */}
          <AnimatePresence>
            {showMetrics && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden mb-6"
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {isPageReplacement ? (
                    <>
                      {[
                        { label: 'Page Faults', value: prState.pageFaults.toString(), color: FAULT_COLOR },
                        { label: 'Hit Rate', value: `${hitRate}%`, color: HIT_COLOR },
                        { label: 'Frames Used', value: `${framesUsed}/${numFrames}`, color: LOADED_COLOR },
                        { label: 'Position', value: `${prState.currentPosition + 1}/${prState.referenceString.length}`, color: '#71717a' },
                      ].map((metric) => (
                        <div key={metric.label} className="p-3 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: metric.color }}>
                            {metric.label}
                          </div>
                          <div className="text-xl font-bold font-mono text-white">{metric.value}</div>
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      {[
                        { label: 'Virtual Addr', value: `0x${pagingState.virtualAddress.toString(16).toUpperCase().padStart(4, '0')}`, color: '#6366f1' },
                        { label: 'Page Number', value: pagingState.currentStep !== 'input' ? pagingState.pageNumber.toString() : '--', color: '#06b6d4' },
                        { label: 'Frame Number', value: pagingState.frameNumber !== null ? pagingState.frameNumber.toString() : '--', color: '#10b981' },
                        { label: 'Physical Addr', value: pagingState.physicalAddress !== null ? `0x${pagingState.physicalAddress.toString(16).toUpperCase().padStart(4, '0')}` : '--', color: '#f59e0b' },
                      ].map((metric) => (
                        <div key={metric.label} className="p-3 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: metric.color }}>
                            {metric.label}
                          </div>
                          <div className="text-xl font-bold font-mono text-white">{metric.value}</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Mode Info Bar ── */}
          <div className="p-3 rounded-xl bg-[#06b6d4]/5 border border-[#06b6d4]/20 mb-6">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-[#06b6d4] shrink-0" />
              <span className="text-sm font-semibold text-[#06b6d4]">{MODE_INFO[mode].label}</span>
              <span className="text-xs text-[#a1a1aa] ml-2">{MODE_INFO[mode].desc}</span>
            </div>
          </div>

          {/* ── Main Content ── */}
          {mode === 'paging' ? (
            <PagingVisualization state={pagingState} />
          ) : (
            <PageReplacementVisualization
              state={prState}
              mode={mode}
              numFrames={numFrames}
              simulationDone={simulationDone}
            />
          )}
        </div>
      </main>
    </div>
  );
}

// ──────────────────────────── Paging Visualization ────────────────────────────

function PagingVisualization({ state }: { state: PagingDemoState }) {
  const steps = ['input', 'page_number', 'table_lookup', 'frame_resolve', 'physical_address'] as const;
  const stepLabels = ['Virtual Address', 'Page + Offset', 'Page Table Lookup', 'Frame Resolution', 'Physical Address'];
  const currentStepIdx = steps.indexOf(state.currentStep);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
      <div className="space-y-6 min-w-0">
        {/* ── Address Translation Pipeline ── */}
        <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
          <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
            <ArrowRight size={14} className="text-[#06b6d4]" />
            Address Translation Pipeline
          </h3>

          {/* Step indicators */}
          <div className="flex items-center gap-2 mb-6">
            {steps.map((step, idx) => {
              const isActive = idx === currentStepIdx;
              const isDone = idx < currentStepIdx;

              return (
                <div key={step} className="flex items-center gap-2 flex-1">
                  <motion.div
                    className="flex-1 flex items-center justify-center px-2 py-2 rounded-lg border transition-all duration-300"
                    style={{
                      backgroundColor: isActive ? '#06b6d410' : isDone ? '#10b98108' : '#0f0f17',
                      borderColor: isActive ? '#06b6d440' : isDone ? '#10b98125' : '#1e1e2e',
                    }}
                    animate={{
                      scale: isActive ? 1.02 : 1,
                    }}
                  >
                    <div className="text-center">
                      <div
                        className="text-[9px] uppercase tracking-wider font-bold"
                        style={{ color: isActive ? '#06b6d4' : isDone ? '#10b981' : '#71717a' }}
                      >
                        {stepLabels[idx]}
                      </div>
                    </div>
                  </motion.div>
                  {idx < steps.length - 1 && (
                    <ArrowRight size={12} className="text-[#2a2a3e] shrink-0" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Address decomposition */}
          <div className="p-4 rounded-lg bg-[#0f0f17] border border-[#1e1e2e] mb-4">
            <div className="flex items-center gap-4 justify-center flex-wrap">
              {/* Virtual Address */}
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-[#6366f1] font-semibold mb-1">Virtual Address</div>
                <div className="px-4 py-2 rounded-lg bg-[#6366f1]/10 border border-[#6366f1]/30">
                  <span className="text-lg font-mono font-bold text-[#6366f1]">
                    0x{state.virtualAddress.toString(16).toUpperCase().padStart(4, '0')}
                  </span>
                </div>
              </div>

              <ArrowRight size={20} className="text-[#2a2a3e]" />

              {/* Page Number */}
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-[#06b6d4] font-semibold mb-1">Page Number</div>
                <motion.div
                  className="px-4 py-2 rounded-lg border"
                  animate={{
                    backgroundColor: currentStepIdx >= 1 ? 'rgba(6, 182, 212, 0.1)' : 'rgba(30, 30, 46, 0.3)',
                    borderColor: currentStepIdx >= 1 ? 'rgba(6, 182, 212, 0.3)' : 'rgba(30, 30, 46, 1)',
                  }}
                >
                  <span className="text-lg font-mono font-bold" style={{ color: currentStepIdx >= 1 ? '#06b6d4' : '#71717a' }}>
                    {currentStepIdx >= 1 ? state.pageNumber : '--'}
                  </span>
                </motion.div>
              </div>

              <span className="text-[#71717a] font-mono text-lg">+</span>

              {/* Offset */}
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-[#f59e0b] font-semibold mb-1">Offset</div>
                <motion.div
                  className="px-4 py-2 rounded-lg border"
                  animate={{
                    backgroundColor: currentStepIdx >= 1 ? 'rgba(245, 158, 11, 0.1)' : 'rgba(30, 30, 46, 0.3)',
                    borderColor: currentStepIdx >= 1 ? 'rgba(245, 158, 11, 0.3)' : 'rgba(30, 30, 46, 1)',
                  }}
                >
                  <span className="text-lg font-mono font-bold" style={{ color: currentStepIdx >= 1 ? '#f59e0b' : '#71717a' }}>
                    {currentStepIdx >= 1 ? `0x${state.offset.toString(16).toUpperCase().padStart(3, '0')}` : '--'}
                  </span>
                </motion.div>
              </div>

              <ArrowRight size={20} className="text-[#2a2a3e]" />

              {/* Physical Address */}
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-[#10b981] font-semibold mb-1">Physical Address</div>
                <motion.div
                  className="px-4 py-2 rounded-lg border"
                  animate={{
                    backgroundColor: currentStepIdx >= 4 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(30, 30, 46, 0.3)',
                    borderColor: currentStepIdx >= 4 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(30, 30, 46, 1)',
                  }}
                >
                  <span className="text-lg font-mono font-bold" style={{ color: currentStepIdx >= 4 ? '#10b981' : '#71717a' }}>
                    {state.physicalAddress !== null ? `0x${state.physicalAddress.toString(16).toUpperCase().padStart(4, '0')}` : '--'}
                  </span>
                </motion.div>
              </div>
            </div>
          </div>

          {/* Explanation text */}
          <div className="text-center text-xs text-[#a1a1aa]">
            {state.currentStep === 'input' && 'Step forward to generate a virtual address and begin translation.'}
            {state.currentStep === 'page_number' && `Splitting virtual address into page number (${Math.ceil(Math.log2(state.pageSize))} high bits) and offset (${Math.floor(Math.log2(state.pageSize))} low bits).`}
            {state.currentStep === 'table_lookup' && `Looking up page ${state.pageNumber} in the page table to find the corresponding frame number.`}
            {state.currentStep === 'frame_resolve' && `Frame ${state.frameNumber} found. Combining frame number with offset to form physical address.`}
            {state.currentStep === 'physical_address' && `Translation complete. Physical address = frame ${state.frameNumber} * ${state.pageSize} + offset ${state.offset}.`}
          </div>
        </div>

        {/* ── Page Table ── */}
        <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
          <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
            <Database size={14} className="text-[#06b6d4]" />
            Page Table
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Page #', 'Frame #', 'Valid', 'Dirty', 'Referenced'].map(h => (
                    <th key={h} className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 px-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.pageTable.map(entry => {
                  const isCurrentPage = entry.pageNumber === state.pageNumber && currentStepIdx >= 2;

                  return (
                    <motion.tr
                      key={entry.pageNumber}
                      className="border-t border-[#1e1e2e]/40"
                      animate={{
                        backgroundColor: isCurrentPage ? 'rgba(6, 182, 212, 0.08)' : 'transparent',
                      }}
                    >
                      <td className="py-2 px-3">
                        <span className={`text-xs font-mono ${isCurrentPage ? 'text-[#06b6d4] font-bold' : 'text-[#a1a1aa]'}`}>
                          {entry.pageNumber}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs font-mono ${entry.valid ? 'text-[#10b981]' : 'text-[#71717a]'}`}>
                          {entry.frameNumber !== null ? entry.frameNumber : '--'}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        {entry.valid ? (
                          <CheckCircle size={14} className="text-[#10b981]" />
                        ) : (
                          <XCircle size={14} className="text-[#ef4444]" />
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs font-mono ${entry.dirty ? 'text-[#f59e0b]' : 'text-[#71717a]'}`}>
                          {entry.dirty ? '1' : '0'}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs font-mono ${entry.referenced ? 'text-[#06b6d4]' : 'text-[#71717a]'}`}>
                          {entry.referenced ? '1' : '0'}
                        </span>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Physical Memory Frames ── */}
        <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
          <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
            <HardDrive size={14} className="text-[#10b981]" />
            Physical Memory Frames
          </h3>

          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: state.physicalMemoryFrames }, (_, frameIdx) => {
              const mappedPage = state.pageTable.find(e => e.frameNumber === frameIdx && e.valid);
              const isCurrentFrame = state.frameNumber === frameIdx && currentStepIdx >= 3;

              return (
                <motion.div
                  key={frameIdx}
                  className="p-3 rounded-lg border text-center"
                  animate={{
                    borderColor: isCurrentFrame ? '#10b98150' : mappedPage ? '#06b6d420' : '#1e1e2e',
                    backgroundColor: isCurrentFrame ? 'rgba(16, 185, 129, 0.08)' : mappedPage ? 'rgba(6, 182, 212, 0.05)' : '#0f0f17',
                  }}
                >
                  <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1">Frame {frameIdx}</div>
                  {mappedPage ? (
                    <div>
                      <div className="text-sm font-mono font-bold text-[#06b6d4]">Page {mappedPage.pageNumber}</div>
                      {isCurrentFrame && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="mt-1 text-[8px] px-1.5 py-0.5 rounded bg-[#10b981]/20 text-[#10b981] font-mono inline-block"
                        >
                          ACCESSED
                        </motion.div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs font-mono text-[#71717a]/40">empty</div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right sidebar for paging */}
      <div className="space-y-4">
        <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
          <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
            <Activity size={14} className="text-[#06b6d4]" />
            Address History
          </h3>

          {state.addressHistory.length === 0 ? (
            <p className="text-xs text-[#71717a] italic py-2 text-center">No translations yet</p>
          ) : (
            <div className="space-y-1.5">
              {[...state.addressHistory].reverse().map((entry, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#0f0f17] border border-[#1e1e2e]/50">
                  <span className="text-[10px] font-mono text-[#6366f1]">
                    0x{entry.virtual.toString(16).toUpperCase().padStart(4, '0')}
                  </span>
                  <ArrowRight size={10} className="text-[#71717a]" />
                  <span className="text-[10px] font-mono text-[#10b981]">
                    {entry.physical !== null ? `0x${entry.physical.toString(16).toUpperCase().padStart(4, '0')}` : 'FAULT'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Info ── */}
        <div className="p-4 rounded-xl bg-[#0f0f17] border border-[#1e1e2e]/50">
          <div className="flex items-start gap-2">
            <Info size={14} className="text-[#06b6d4] mt-0.5 shrink-0" />
            <div className="text-[11px] text-[#71717a] leading-relaxed">
              <p className="mb-1.5">
                <strong className="text-[#a1a1aa]">Page Table:</strong>{' '}
                Maps virtual page numbers to physical frame numbers.
              </p>
              <p className="mb-1.5">
                <strong className="text-[#a1a1aa]">Valid Bit:</strong>{' '}
                Indicates if the page is currently in physical memory.
              </p>
              <p className="mb-1.5">
                <strong className="text-[#a1a1aa]">Dirty Bit:</strong>{' '}
                Set when the page has been modified in memory.
              </p>
              <p>
                <strong className="text-[#a1a1aa]">Translation:</strong>{' '}
                Virtual address = page_number * page_size + offset.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────── Page Replacement Visualization ────────────────────────────

function PageReplacementVisualization({
  state,
  mode,
  numFrames,
  simulationDone,
}: {
  state: PageReplacementState;
  mode: Mode;
  numFrames: number;
  simulationDone: boolean;
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
      <div className="space-y-6 min-w-0">
        {/* ── Reference String ── */}
        <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
          <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
            <Hash size={14} className="text-[#06b6d4]" />
            Reference String
          </h3>

          <div className="flex flex-wrap gap-1.5">
            {state.referenceString.map((page, idx) => {
              const isCurrent = idx === state.currentPosition;
              const isPast = idx < state.currentPosition;
              const histEntry = state.history.find(h => h.step === idx);
              const wasFault = histEntry?.isFault;

              return (
                <motion.div
                  key={idx}
                  className="relative w-10 h-10 rounded-lg border flex items-center justify-center font-mono text-sm font-bold transition-all duration-200"
                  style={{
                    backgroundColor: isCurrent
                      ? (wasFault ? `${FAULT_COLOR}15` : `${HIT_COLOR}15`)
                      : isPast
                        ? (wasFault ? `${FAULT_COLOR}08` : `${HIT_COLOR}08`)
                        : '#0f0f17',
                    borderColor: isCurrent
                      ? (wasFault ? `${FAULT_COLOR}50` : `${HIT_COLOR}50`)
                      : isPast
                        ? (wasFault ? `${FAULT_COLOR}20` : `${HIT_COLOR}20`)
                        : '#1e1e2e',
                    color: isCurrent
                      ? '#ffffff'
                      : isPast
                        ? (wasFault ? FAULT_COLOR : HIT_COLOR)
                        : '#71717a',
                  }}
                  animate={{
                    scale: isCurrent ? 1.1 : 1,
                  }}
                >
                  {page}
                  {isCurrent && (
                    <motion.div
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#06b6d4]"
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ repeat: Infinity, duration: 1 }}
                    />
                  )}
                  {isPast && wasFault && (
                    <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[#ef4444] flex items-center justify-center">
                      <span className="text-[6px] text-white font-bold">F</span>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* ── Frame Contents ── */}
        <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
          <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
            <Grid3X3 size={14} className="text-[#06b6d4]" />
            Physical Frames ({numFrames})
          </h3>

          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(numFrames, 6)}, 1fr)` }}>
            {state.frames.map((frame, idx) => {
              const highlightColor = frame.highlight === 'hit' ? HIT_COLOR
                : frame.highlight === 'fault' ? FAULT_COLOR
                : frame.highlight === 'victim' ? VICTIM_COLOR
                : frame.highlight === 'loaded' ? LOADED_COLOR
                : null;

              return (
                <motion.div
                  key={idx}
                  className="p-4 rounded-xl border text-center min-h-[100px] flex flex-col items-center justify-center"
                  animate={{
                    borderColor: highlightColor ? `${highlightColor}60` : frame.pageNumber !== null ? '#06b6d420' : '#1e1e2e',
                    backgroundColor: highlightColor ? `${highlightColor}10` : frame.pageNumber !== null ? 'rgba(6, 182, 212, 0.03)' : '#0f0f17',
                  }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-2">Frame {idx}</div>

                  <AnimatePresence mode="wait">
                    {frame.pageNumber !== null ? (
                      <motion.div
                        key={frame.pageNumber}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        className="text-center"
                      >
                        <div
                          className="text-2xl font-mono font-bold mb-1"
                          style={{ color: highlightColor || LOADED_COLOR }}
                        >
                          {frame.pageNumber}
                        </div>

                        {frame.highlight === 'hit' && (
                          <motion.span
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-[8px] px-1.5 py-0.5 rounded bg-[#10b981]/20 text-[#10b981] font-mono font-bold"
                          >
                            HIT
                          </motion.span>
                        )}
                        {frame.highlight === 'loaded' && (
                          <motion.span
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-[8px] px-1.5 py-0.5 rounded bg-[#06b6d4]/20 text-[#06b6d4] font-mono font-bold"
                          >
                            LOADED
                          </motion.span>
                        )}

                        {/* Algorithm-specific info */}
                        <div className="mt-2 space-y-0.5">
                          {mode === 'fifo' && (
                            <div className="text-[8px] text-[#71717a] font-mono">
                              loaded: t={frame.loadedAt}
                            </div>
                          )}
                          {mode === 'lru' && (
                            <div className="text-[8px] text-[#71717a] font-mono">
                              last used: t={frame.lastUsedAt}
                            </div>
                          )}
                          {mode === 'optimal' && (
                            <div className="text-[8px] text-[#71717a] font-mono">
                              {(() => {
                                const nextUse = state.referenceString.findIndex(
                                  (p, i) => i > state.currentPosition && p === frame.pageNumber
                                );
                                return nextUse >= 0 ? `next use: t=${nextUse}` : 'no future use';
                              })()}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-xs font-mono text-[#71717a]/30"
                      >
                        empty
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* ── FIFO Queue Visualization (for FIFO mode) ── */}
        {mode === 'fifo' && state.fifoQueue.length > 0 && (
          <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
            <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
              <Layers size={14} className="text-[#f59e0b]" />
              FIFO Queue (front = next victim)
            </h3>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-[#f59e0b] font-mono mr-1">OUT</span>
              <ArrowRight size={12} className="text-[#f59e0b]" />
              {state.fifoQueue.map((page, idx) => (
                <motion.div
                  key={`${page}-${idx}`}
                  layout
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="w-9 h-9 rounded-lg border flex items-center justify-center font-mono text-sm font-bold"
                  style={{
                    backgroundColor: idx === 0 ? `${VICTIM_COLOR}15` : '#0f0f17',
                    borderColor: idx === 0 ? `${VICTIM_COLOR}40` : '#1e1e2e',
                    color: idx === 0 ? VICTIM_COLOR : '#a1a1aa',
                  }}
                >
                  {page}
                </motion.div>
              ))}
              <ArrowRight size={12} className="text-[#71717a]" />
              <span className="text-[10px] text-[#71717a] font-mono ml-1">IN</span>
            </div>
          </div>
        )}

        {/* ── History Table ── */}
        <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
          <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
            <Activity size={14} className="text-[#06b6d4]" />
            Replacement History
          </h3>

          {state.history.length === 0 ? (
            <div className="py-8 text-center">
              <HardDrive size={32} className="mx-auto text-[#71717a]/30 mb-3" />
              <p className="text-sm text-[#71717a]">
                Press <span className="font-mono text-[#06b6d4]">Play</span> or{' '}
                <span className="font-mono text-[#06b6d4]">Step</span> to process reference string
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 px-2">Step</th>
                    <th className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 px-2">Page</th>
                    {Array.from({ length: numFrames }, (_, i) => (
                      <th key={i} className="text-center text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 px-2">F{i}</th>
                    ))}
                    <th className="text-center text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 px-2">Result</th>
                    <th className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 px-2">Victim</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {state.history.map((entry, i) => (
                      <motion.tr
                        key={entry.step}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`border-t border-[#1e1e2e]/40 ${
                          entry.step === state.currentPosition ? 'bg-[#06b6d4]/5' : ''
                        }`}
                      >
                        <td className="py-1.5 px-2 text-xs font-mono text-[#71717a]">{entry.step + 1}</td>
                        <td className="py-1.5 px-2">
                          <span className="text-xs font-mono font-bold text-white">{entry.page}</span>
                        </td>
                        {entry.frames.map((pageNum, fi) => (
                          <td key={fi} className="py-1.5 px-2 text-center">
                            <span className={`text-xs font-mono ${pageNum !== null ? 'text-[#06b6d4]' : 'text-[#71717a]/30'}`}>
                              {pageNum !== null ? pageNum : '-'}
                            </span>
                          </td>
                        ))}
                        <td className="py-1.5 px-2 text-center">
                          {entry.isFault ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ef4444]/15 text-[#ef4444] font-mono font-bold">
                              FAULT
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#10b981]/15 text-[#10b981] font-mono font-bold">
                              HIT
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-2">
                          {entry.victimPage !== null ? (
                            <span className="text-xs font-mono text-[#f59e0b]">Page {entry.victimPage}</span>
                          ) : (
                            <span className="text-xs font-mono text-[#71717a]/30">--</span>
                          )}
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}

          {/* Simulation complete */}
          <AnimatePresence>
            {simulationDone && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-3 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20 flex items-center gap-2"
              >
                <div className="w-2 h-2 rounded-full bg-[#10b981]" />
                <span className="text-xs text-[#10b981] font-medium">
                  Complete. {state.pageFaults} faults, {state.pageHits} hits.
                  Hit rate: {((state.pageHits / state.referenceString.length) * 100).toFixed(1)}%.
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Right Sidebar ── */}
      <div className="space-y-4">
        {/* ── Fault/Hit Summary ── */}
        <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
          <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
            <Activity size={14} className="text-[#06b6d4]" />
            Performance
          </h3>

          <div className="space-y-3">
            {/* Fault rate bar */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-[#ef4444] font-semibold">Page Faults</span>
                <span className="text-xs font-mono text-white">{state.pageFaults}</span>
              </div>
              <div className="h-2 bg-[#1e1e2e] rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-[#ef4444]"
                  animate={{
                    width: state.referenceString.length > 0 && state.currentPosition >= 0
                      ? `${(state.pageFaults / (state.currentPosition + 1)) * 100}%`
                      : '0%'
                  }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>

            {/* Hit rate bar */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-[#10b981] font-semibold">Page Hits</span>
                <span className="text-xs font-mono text-white">{state.pageHits}</span>
              </div>
              <div className="h-2 bg-[#1e1e2e] rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-[#10b981]"
                  animate={{
                    width: state.referenceString.length > 0 && state.currentPosition >= 0
                      ? `${(state.pageHits / (state.currentPosition + 1)) * 100}%`
                      : '0%'
                  }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>

            {/* Hit rate percentage */}
            <div className="pt-2 border-t border-[#1e1e2e]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[#06b6d4] font-semibold">Hit Rate</span>
                <span className="text-lg font-mono font-bold text-white">
                  {state.currentPosition >= 0 ? `${((state.pageHits / (state.currentPosition + 1)) * 100).toFixed(1)}%` : '--'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Algorithm Explanation ── */}
        <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
          <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
            <Cpu size={14} className="text-[#06b6d4]" />
            Algorithm Details
          </h3>

          <div className="text-[11px] text-[#71717a] leading-relaxed space-y-2">
            {mode === 'fifo' && (
              <>
                <p>
                  <strong className="text-[#a1a1aa]">FIFO</strong> replaces the page that has been in memory the longest.
                </p>
                <p>
                  Simple to implement with a queue. Subject to <strong className="text-[#f59e0b]">Belady&apos;s anomaly</strong> where increasing frames can increase faults.
                </p>
                <p>
                  The front of the FIFO queue is always the next victim.
                </p>
              </>
            )}
            {mode === 'lru' && (
              <>
                <p>
                  <strong className="text-[#a1a1aa]">LRU</strong> replaces the page that hasn&apos;t been used for the longest time.
                </p>
                <p>
                  Based on temporal locality: recently used pages are likely to be used again soon.
                </p>
                <p>
                  Requires tracking last-access timestamps. Not subject to Belady&apos;s anomaly.
                </p>
              </>
            )}
            {mode === 'optimal' && (
              <>
                <p>
                  <strong className="text-[#a1a1aa]">Optimal (Belady&apos;s)</strong> replaces the page not needed for the longest time in the future.
                </p>
                <p>
                  Theoretically optimal but <strong className="text-[#ef4444]">impossible to implement</strong> in practice since it requires future knowledge.
                </p>
                <p>
                  Used as a benchmark to compare other algorithms against.
                </p>
              </>
            )}
          </div>
        </div>

        {/* ── Reference String Config ── */}
        <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
          <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
            <Hash size={14} className="text-[#f59e0b]" />
            Reference String
          </h3>

          <div className="text-[11px] text-[#71717a] leading-relaxed mb-2">
            Sequence of {state.referenceString.length} page references.
            Current position: {state.currentPosition + 1}/{state.referenceString.length}
          </div>

          <div className="h-2 bg-[#1e1e2e] rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-[#06b6d4]"
              animate={{
                width: `${((state.currentPosition + 1) / state.referenceString.length) * 100}%`
              }}
              transition={{ duration: 0.2 }}
            />
          </div>
        </div>

        {/* ── Info ── */}
        <div className="p-4 rounded-xl bg-[#0f0f17] border border-[#1e1e2e]/50">
          <div className="flex items-start gap-2">
            <Info size={14} className="text-[#06b6d4] mt-0.5 shrink-0" />
            <div className="text-[11px] text-[#71717a] leading-relaxed">
              <p className="mb-1.5">
                <strong className="text-[#ef4444]">Page Fault:</strong>{' '}
                Requested page not in any frame. Must load from disk.
              </p>
              <p className="mb-1.5">
                <strong className="text-[#10b981]">Page Hit:</strong>{' '}
                Requested page already in a frame. Fast access.
              </p>
              <p className="mb-1.5">
                <strong className="text-[#f59e0b]">Victim:</strong>{' '}
                Page selected for eviction when all frames are full.
              </p>
              <p>
                <strong className="text-[#06b6d4]">Goal:</strong>{' '}
                Minimize page faults to reduce expensive disk I/O.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
