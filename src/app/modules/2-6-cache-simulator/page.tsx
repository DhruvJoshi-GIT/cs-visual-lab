'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu,
  BarChart3,
  Info,
  Play,
  RotateCcw,
  Layers,
  ArrowRight,
  Zap,
  Grid3X3,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

// ──────────────────────────── Types ────────────────────────────

interface CacheLine {
  valid: boolean;
  tag: number;
  lastUsed: number;
  data: number[]; // which array indices are in this line
}

interface AccessRecord {
  step: number;
  address: number;
  arrayIndex: number;
  hit: boolean;
  setIndex: number;
  evicted: boolean;
}

interface SimConfig {
  arraySize: number;
  cacheLines: number;
  lineSize: number; // elements per cache line
  associativity: number;
}

interface LoopPattern {
  label: string;
  description: string;
  generateAccesses: (config: SimConfig) => number[];
}

// ──────────────────────────── Constants ────────────────────────────

const DOMAIN_COLOR = '#8b5cf6';

const DEFAULT_CONFIG: SimConfig = {
  arraySize: 64,
  cacheLines: 8,
  lineSize: 4,
  associativity: 1,
};

const LOOP_PATTERNS: Record<string, LoopPattern> = {
  sequential: {
    label: 'Sequential Access',
    description: 'A[0], A[1], A[2], ... — best case for spatial locality',
    generateAccesses: (config) => {
      const accesses: number[] = [];
      for (let i = 0; i < config.arraySize; i++) {
        accesses.push(i);
      }
      return accesses;
    },
  },
  stride2: {
    label: 'Stride-2',
    description: 'A[0], A[2], A[4], ... — every other element',
    generateAccesses: (config) => {
      const accesses: number[] = [];
      for (let i = 0; i < config.arraySize; i += 2) {
        accesses.push(i);
      }
      return accesses;
    },
  },
  stride4: {
    label: 'Stride-4',
    description: 'A[0], A[4], A[8], ... — skips cache line elements',
    generateAccesses: (config) => {
      const accesses: number[] = [];
      for (let i = 0; i < config.arraySize; i += 4) {
        accesses.push(i);
      }
      return accesses;
    },
  },
  stride8: {
    label: 'Stride-8',
    description: 'A[0], A[8], A[16], ... — poor spatial locality',
    generateAccesses: (config) => {
      const accesses: number[] = [];
      for (let i = 0; i < config.arraySize; i += 8) {
        accesses.push(i);
      }
      return accesses;
    },
  },
  rowMajor: {
    label: 'Row-Major (Good)',
    description: '2D array traversal: row by row — cache-friendly',
    generateAccesses: (config) => {
      const dim = Math.floor(Math.sqrt(config.arraySize));
      const accesses: number[] = [];
      for (let row = 0; row < dim; row++) {
        for (let col = 0; col < dim; col++) {
          accesses.push(row * dim + col);
        }
      }
      return accesses;
    },
  },
  colMajor: {
    label: 'Column-Major (Bad)',
    description: '2D array traversal: column by column — cache-unfriendly',
    generateAccesses: (config) => {
      const dim = Math.floor(Math.sqrt(config.arraySize));
      const accesses: number[] = [];
      for (let col = 0; col < dim; col++) {
        for (let row = 0; row < dim; row++) {
          accesses.push(row * dim + col);
        }
      }
      return accesses;
    },
  },
  thrashing: {
    label: 'Thrashing',
    description: 'Repeated access to addresses that map to the same set — worst case',
    generateAccesses: (config) => {
      const numSets = config.cacheLines / config.associativity;
      const stride = numSets * config.lineSize;
      const accesses: number[] = [];
      // Access addresses that all map to set 0, repeated
      for (let rep = 0; rep < 4; rep++) {
        for (let i = 0; i < config.associativity + 2; i++) {
          const addr = (i * stride) % config.arraySize;
          accesses.push(addr);
        }
      }
      return accesses;
    },
  },
};

// ──────────────────────────── Simulation Logic ────────────────────────────

function createEmptyCache(config: SimConfig): CacheLine[][] {
  const numSets = config.cacheLines / config.associativity;
  const cache: CacheLine[][] = [];
  for (let s = 0; s < numSets; s++) {
    const set: CacheLine[] = [];
    for (let w = 0; w < config.associativity; w++) {
      set.push({ valid: false, tag: -1, lastUsed: -1, data: [] });
    }
    cache.push(set);
  }
  return cache;
}

function simulateAccess(
  cache: CacheLine[][],
  address: number,
  config: SimConfig,
  step: number
): { hit: boolean; setIndex: number; evicted: boolean; newCache: CacheLine[][] } {
  const lineAddr = Math.floor(address / config.lineSize);
  const numSets = cache.length;
  const setIndex = lineAddr % numSets;
  const tag = Math.floor(lineAddr / numSets);

  const set = cache[setIndex];
  const newCache = cache.map((s) => s.map((line) => ({ ...line, data: [...line.data] })));
  const newSet = newCache[setIndex];

  // Check for hit
  for (let w = 0; w < set.length; w++) {
    if (set[w].valid && set[w].tag === tag) {
      newSet[w] = {
        ...newSet[w],
        lastUsed: step,
      };
      return { hit: true, setIndex, evicted: false, newCache };
    }
  }

  // Miss — find empty line or evict LRU
  let targetWay = -1;
  for (let w = 0; w < set.length; w++) {
    if (!set[w].valid) {
      targetWay = w;
      break;
    }
  }

  let evicted = false;
  if (targetWay === -1) {
    // Evict LRU
    let minUsed = Infinity;
    targetWay = 0;
    for (let w = 0; w < set.length; w++) {
      if (set[w].lastUsed < minUsed) {
        minUsed = set[w].lastUsed;
        targetWay = w;
      }
    }
    evicted = true;
  }

  const lineStart = lineAddr * config.lineSize;
  const lineData: number[] = [];
  for (let i = 0; i < config.lineSize; i++) {
    lineData.push(lineStart + i);
  }

  newSet[targetWay] = {
    valid: true,
    tag,
    lastUsed: step,
    data: lineData,
  };

  return { hit: false, setIndex, evicted, newCache };
}

// ──────────────────────────── Component ────────────────────────────

export default function CacheSimulatorModule() {
  const [config, setConfig] = useState<SimConfig>(DEFAULT_CONFIG);
  const [activePattern, setActivePattern] = useState('sequential');
  const [cache, setCache] = useState<CacheLine[][]>(() => createEmptyCache(DEFAULT_CONFIG));
  const [accessSequence, setAccessSequence] = useState<number[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [history, setHistory] = useState<AccessRecord[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [highlightedSet, setHighlightedSet] = useState<number | null>(null);

  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const hits = history.filter((h) => h.hit).length;
  const misses = history.filter((h) => !h.hit).length;
  const hitRate = history.length > 0 ? (hits / history.length) * 100 : 0;
  const simulationDone = currentStep >= accessSequence.length && accessSequence.length > 0;

  // Initialize
  useEffect(() => {
    loadPattern('sequential');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPattern = useCallback((key: string) => {
    setActivePattern(key);
    setIsPlaying(false);
    setCurrentStep(0);
    setHistory([]);
    setHighlightedSet(null);
    const pattern = LOOP_PATTERNS[key];
    if (pattern) {
      const accesses = pattern.generateAccesses(config);
      setAccessSequence(accesses);
    }
    setCache(createEmptyCache(config));
  }, [config]);

  const updateConfig = useCallback((newConfig: SimConfig) => {
    setConfig(newConfig);
    setIsPlaying(false);
    setCurrentStep(0);
    setHistory([]);
    setHighlightedSet(null);
    setCache(createEmptyCache(newConfig));
    const pattern = LOOP_PATTERNS[activePattern];
    if (pattern) {
      const accesses = pattern.generateAccesses(newConfig);
      setAccessSequence(accesses);
    }
  }, [activePattern]);

  const stepForward = useCallback(() => {
    if (currentStep >= accessSequence.length) {
      setIsPlaying(false);
      return;
    }

    const address = accessSequence[currentStep];
    const result = simulateAccess(cache, address, config, currentStep);

    setCache(result.newCache);
    setHighlightedSet(result.setIndex);
    setHistory((prev) => [
      ...prev,
      {
        step: currentStep,
        address,
        arrayIndex: address,
        hit: result.hit,
        setIndex: result.setIndex,
        evicted: result.evicted,
      },
    ]);
    setCurrentStep((s) => s + 1);
  }, [currentStep, accessSequence, cache, config]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    setCurrentStep(0);
    setHistory([]);
    setHighlightedSet(null);
    setCache(createEmptyCache(config));
  }, [config]);

  // Animation loop
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(10, 600 / speedRef.current);
      if (timestamp - lastTickRef.current >= interval) {
        lastTickRef.current = timestamp;
        stepForward();
      }
      animationRef.current = requestAnimationFrame(animationLoop);
    },
    [stepForward]
  );

  useEffect(() => {
    if (isPlaying) {
      lastTickRef.current = performance.now();
      animationRef.current = requestAnimationFrame(animationLoop);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, animationLoop]);

  useEffect(() => {
    if (simulationDone) setIsPlaying(false);
  }, [simulationDone]);

  const numSets = config.cacheLines / config.associativity;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />

      <main className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span
                className="px-2.5 py-0.5 rounded-md text-xs font-mono font-semibold"
                style={{ backgroundColor: `${DOMAIN_COLOR}15`, color: DOMAIN_COLOR, border: `1px solid ${DOMAIN_COLOR}30` }}
              >
                2.6
              </span>
              <span className="text-xs text-[#71717a]">CPU Architecture</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              CPU Cache Simulator{' '}
              <span className="text-[#71717a] font-normal">Advanced</span>
            </h1>
            <p className="text-sm text-[#a1a1aa] max-w-2xl mt-1">
              Explore how loop patterns, array strides, and access order affect cache performance.
              Modify loop order, array size, and stride to see miss rate change in real time.
            </p>
          </div>

          {/* Config Panel */}
          <div className="mb-6 p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
            <div className="flex items-center gap-2 mb-3">
              <Layers size={14} className="text-[#8b5cf6]" />
              <span className="text-xs uppercase tracking-wider text-[#71717a] font-semibold">
                Cache Configuration
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#71717a] block mb-1">
                  Array Size
                </label>
                <select
                  value={config.arraySize}
                  onChange={(e) => updateConfig({ ...config, arraySize: Number(e.target.value) })}
                  className="w-full bg-[#0f0f17] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-white"
                >
                  {[32, 64, 128, 256].map((v) => (
                    <option key={v} value={v}>{v} elements</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#71717a] block mb-1">
                  Cache Lines
                </label>
                <select
                  value={config.cacheLines}
                  onChange={(e) => updateConfig({ ...config, cacheLines: Number(e.target.value) })}
                  className="w-full bg-[#0f0f17] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-white"
                >
                  {[4, 8, 16, 32].map((v) => (
                    <option key={v} value={v}>{v} lines</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#71717a] block mb-1">
                  Line Size
                </label>
                <select
                  value={config.lineSize}
                  onChange={(e) => updateConfig({ ...config, lineSize: Number(e.target.value) })}
                  className="w-full bg-[#0f0f17] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-white"
                >
                  {[2, 4, 8].map((v) => (
                    <option key={v} value={v}>{v} elements/line</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#71717a] block mb-1">
                  Associativity
                </label>
                <select
                  value={config.associativity}
                  onChange={(e) => updateConfig({ ...config, associativity: Number(e.target.value) })}
                  className="w-full bg-[#0f0f17] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-white"
                >
                  {[1, 2, 4].filter((v) => v <= config.cacheLines).map((v) => (
                    <option key={v} value={v}>{v === 1 ? 'Direct-Mapped' : `${v}-Way`}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Pattern Selector + Controls */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs text-[#71717a] mr-1 font-medium uppercase tracking-wider">
              Access Pattern:
            </span>
            {Object.entries(LOOP_PATTERNS).map(([key, pattern]) => (
              <button
                key={key}
                onClick={() => loadPattern(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 border ${
                  activePattern === key
                    ? 'bg-[#8b5cf6]/15 text-[#8b5cf6] border-[#8b5cf6]/30'
                    : 'bg-[#111118] text-[#a1a1aa] border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white'
                }`}
                title={pattern.description}
              >
                {pattern.label}
              </button>
            ))}
          </div>

          {/* Playback Controls */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => isPlaying ? setIsPlaying(false) : setIsPlaying(true)}
              disabled={simulationDone}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8b5cf6] text-white text-sm font-medium hover:bg-[#7c3aed] disabled:opacity-40 transition-all"
            >
              {isPlaying ? (
                <>
                  <div className="flex gap-0.5">
                    <div className="w-1 h-3 bg-white rounded-sm" />
                    <div className="w-1 h-3 bg-white rounded-sm" />
                  </div>
                  Pause
                </>
              ) : (
                <>
                  <Play size={14} fill="white" />
                  {simulationDone ? 'Done' : 'Play'}
                </>
              )}
            </button>
            <button
              onClick={stepForward}
              disabled={simulationDone}
              className="px-4 py-2 rounded-lg bg-[#111118] text-[#a1a1aa] text-sm border border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white disabled:opacity-40 transition-all"
            >
              Step
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 rounded-lg bg-[#111118] text-[#a1a1aa] text-sm border border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white transition-all"
            >
              <RotateCcw size={14} />
            </button>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px] text-[#71717a] uppercase tracking-wider">Speed</span>
              <input
                type="range"
                min={0.5}
                max={8}
                step={0.5}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="w-24 accent-[#8b5cf6]"
              />
              <span className="text-xs font-mono text-[#a1a1aa] w-8">{speed}x</span>
            </div>
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
            {/* Left: Visualization */}
            <div className="space-y-6">
              {/* Metrics Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { label: 'Accesses', value: history.length.toString(), color: '#8b5cf6' },
                  { label: 'Hits', value: hits.toString(), color: '#10b981' },
                  { label: 'Misses', value: misses.toString(), color: '#ef4444' },
                  { label: 'Hit Rate', value: `${hitRate.toFixed(1)}%`, color: '#06b6d4' },
                  { label: 'Sets', value: `${numSets}`, color: '#71717a' },
                ].map((m) => (
                  <div key={m.label} className="p-3 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                    <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: m.color }}>
                      {m.label}
                    </div>
                    <div className="text-xl font-bold font-mono text-white">{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Cache Visualization */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <Grid3X3 size={14} className="text-[#8b5cf6]" />
                  Cache State
                </h3>
                <div className="space-y-2">
                  {/* Header */}
                  <div className="grid gap-2" style={{ gridTemplateColumns: `60px repeat(${config.associativity}, 1fr)` }}>
                    <div className="text-[9px] uppercase tracking-wider text-[#71717a] font-semibold">Set</div>
                    {Array.from({ length: config.associativity }, (_, w) => (
                      <div key={w} className="text-[9px] uppercase tracking-wider text-[#71717a] font-semibold text-center">
                        Way {w}
                      </div>
                    ))}
                  </div>
                  {/* Cache sets */}
                  {cache.map((set, setIdx) => (
                    <motion.div
                      key={setIdx}
                      animate={{
                        backgroundColor: highlightedSet === setIdx ? 'rgba(139, 92, 246, 0.08)' : 'rgba(0,0,0,0)',
                      }}
                      className="grid gap-2 rounded-lg p-1.5 transition-all duration-200"
                      style={{ gridTemplateColumns: `60px repeat(${config.associativity}, 1fr)` }}
                    >
                      <div className="flex items-center">
                        <span
                          className={`text-xs font-mono font-bold px-2 py-1 rounded ${
                            highlightedSet === setIdx
                              ? 'text-[#8b5cf6] bg-[#8b5cf6]/10'
                              : 'text-[#71717a]'
                          }`}
                        >
                          [{setIdx}]
                        </span>
                      </div>
                      {set.map((line, wayIdx) => (
                        <motion.div
                          key={wayIdx}
                          animate={{
                            borderColor: line.valid
                              ? highlightedSet === setIdx
                                ? '#8b5cf6'
                                : '#1e1e2e'
                              : '#1e1e2e',
                          }}
                          className={`p-2 rounded-lg border text-center transition-all duration-200 ${
                            line.valid
                              ? 'bg-[#10b981]/5 border-[#10b981]/20'
                              : 'bg-[#0f0f17] border-[#1e1e2e]'
                          }`}
                        >
                          {line.valid ? (
                            <div>
                              <div className="text-[9px] text-[#71717a] mb-0.5">
                                tag={line.tag}
                              </div>
                              <div className="text-[10px] font-mono text-[#10b981]">
                                [{line.data[0]}..{line.data[line.data.length - 1]}]
                              </div>
                            </div>
                          ) : (
                            <div className="text-[10px] text-[#71717a]/40 font-mono">
                              empty
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Hit Rate Over Time */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <BarChart3 size={14} className="text-[#10b981]" />
                  Hit Rate Over Time
                </h3>
                {history.length === 0 ? (
                  <div className="py-8 text-center">
                    <BarChart3 size={32} className="mx-auto text-[#71717a]/20 mb-2" />
                    <p className="text-sm text-[#71717a]">Start the simulation to see hit rate trends</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Hit rate bar */}
                    <div className="relative h-8 rounded-lg bg-[#0f0f17] border border-[#1e1e2e] overflow-hidden">
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded-lg"
                        style={{ backgroundColor: hitRate >= 70 ? '#10b981' : hitRate >= 40 ? '#f59e0b' : '#ef4444' }}
                        animate={{ width: `${hitRate}%` }}
                        transition={{ duration: 0.3 }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center text-xs font-mono font-bold text-white">
                        {hitRate.toFixed(1)}% hit rate
                      </div>
                    </div>

                    {/* Per-access chart */}
                    <div className="flex items-end gap-[1px] h-20 px-1">
                      {history.map((record, i) => {
                        const runningHits = history.slice(0, i + 1).filter((r) => r.hit).length;
                        const runningRate = (runningHits / (i + 1)) * 100;
                        return (
                          <motion.div
                            key={i}
                            initial={{ height: 0 }}
                            animate={{ height: `${Math.max(runningRate, 2)}%` }}
                            transition={{ duration: 0.15 }}
                            className="flex-1 min-w-[2px] max-w-[12px] rounded-t-sm cursor-default group relative"
                            style={{ backgroundColor: record.hit ? '#10b981' : '#ef4444', opacity: 0.7 }}
                            title={`Step ${i + 1}: A[${record.arrayIndex}] — ${record.hit ? 'HIT' : 'MISS'} (Running: ${runningRate.toFixed(0)}%)`}
                          />
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[9px] text-[#71717a] font-mono px-1">
                      <span>Step 1</span>
                      <span>Step {history.length}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Sidebar */}
            <div className="space-y-4">
              {/* Current Access */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Zap size={14} className="text-[#f59e0b]" />
                  Current Access
                </h3>
                {currentStep > 0 && history.length > 0 ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1">Array Index</div>
                        <div className="text-lg font-bold font-mono text-white">
                          A[{history[history.length - 1].arrayIndex}]
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1">Maps to Set</div>
                        <div className="text-lg font-bold font-mono text-[#8b5cf6]">
                          Set {history[history.length - 1].setIndex}
                        </div>
                      </div>
                    </div>
                    <motion.div
                      key={currentStep}
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className={`px-3 py-2 rounded-lg text-center text-sm font-semibold ${
                        history[history.length - 1].hit
                          ? 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/25'
                          : 'bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/25'
                      }`}
                    >
                      {history[history.length - 1].hit ? 'CACHE HIT' : 'CACHE MISS'}
                      {history[history.length - 1].evicted && ' (evicted)'}
                    </motion.div>
                  </div>
                ) : (
                  <p className="text-xs text-[#71717a] italic">
                    Press Play or Step to begin simulation.
                  </p>
                )}
              </div>

              {/* Memory Array View */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Grid3X3 size={14} className="text-[#06b6d4]" />
                  Memory Array
                </h3>
                <div className="flex flex-wrap gap-[3px]">
                  {Array.from({ length: Math.min(config.arraySize, 128) }, (_, i) => {
                    const isAccessed = history.some((h) => h.arrayIndex === i);
                    const isCurrent = history.length > 0 && history[history.length - 1].arrayIndex === i;
                    const isInCache = cache.some((set) =>
                      set.some((line) => line.valid && line.data.includes(i))
                    );

                    return (
                      <motion.div
                        key={i}
                        animate={{
                          backgroundColor: isCurrent
                            ? '#8b5cf6'
                            : isInCache
                            ? '#10b98130'
                            : isAccessed
                            ? '#f59e0b20'
                            : '#0f0f17',
                          borderColor: isCurrent
                            ? '#8b5cf6'
                            : isInCache
                            ? '#10b98140'
                            : '#1e1e2e',
                        }}
                        className="w-5 h-5 rounded-sm border flex items-center justify-center"
                        title={`A[${i}]${isInCache ? ' (in cache)' : ''}`}
                      >
                        <span
                          className={`text-[7px] font-mono ${
                            isCurrent ? 'text-white font-bold' : isInCache ? 'text-[#10b981]' : 'text-[#71717a]/40'
                          }`}
                        >
                          {i}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-[9px] text-[#71717a]">
                  <span className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded-sm bg-[#8b5cf6]" /> Current
                  </span>
                  <span className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded-sm bg-[#10b981]/30 border border-[#10b981]/40" /> In Cache
                  </span>
                </div>
              </div>

              {/* Access Log */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <ArrowRight size={14} className="text-[#06b6d4]" />
                  Access Log
                </h3>
                <div className="max-h-[200px] overflow-y-auto space-y-1">
                  {history.length === 0 ? (
                    <p className="text-xs text-[#71717a] italic">No accesses yet.</p>
                  ) : (
                    [...history].reverse().slice(0, 30).map((record) => (
                      <div
                        key={record.step}
                        className="flex items-center gap-2 text-[10px] font-mono"
                      >
                        <span className="text-[#71717a] w-8 shrink-0">#{record.step + 1}</span>
                        <span className="text-[#a1a1aa]">A[{record.arrayIndex}]</span>
                        <ArrowRight size={8} className="text-[#71717a]" />
                        <span className="text-[#8b5cf6]">S{record.setIndex}</span>
                        <span
                          className={`ml-auto font-bold ${
                            record.hit ? 'text-[#10b981]' : 'text-[#ef4444]'
                          }`}
                        >
                          {record.hit ? 'HIT' : 'MISS'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Info */}
              <div className="p-4 rounded-xl bg-[#0f0f17] border border-[#1e1e2e]/50">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-[#8b5cf6] mt-0.5 shrink-0" />
                  <div className="text-[11px] text-[#71717a] leading-relaxed">
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Sequential</strong> access achieves best hit rate
                      due to spatial locality — each cache line fill serves multiple accesses.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Stride</strong> patterns skip elements,
                      wasting loaded cache lines. Stride = line size means every access is a miss.
                    </p>
                    <p>
                      <strong className="text-[#a1a1aa]">Row vs Column</strong> major shows why loop
                      order matters for 2D arrays — row-major matches memory layout.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Completion */}
          <AnimatePresence>
            {simulationDone && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-4 rounded-xl bg-[#10b981]/10 border border-[#10b981]/20 flex items-center gap-3"
              >
                <div className="w-2 h-2 rounded-full bg-[#10b981]" />
                <span className="text-sm text-[#10b981] font-medium">
                  Simulation complete &mdash; {hits}/{history.length} hits ({hitRate.toFixed(1)}% hit rate), {misses} misses
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
