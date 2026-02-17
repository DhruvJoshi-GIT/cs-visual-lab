'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database,
  Cpu,
  HardDrive,
  Layers,
  Target,
  TrendingUp,
  Info,
  ArrowRight,
  ArrowDown,
  CheckCircle,
  XCircle,
  Zap,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import ModuleControls from '@/components/ui/ModuleControls';

// ──────────────────────────── Types ────────────────────────────

type CacheType = 'direct-mapped' | '2-way' | '4-way' | 'fully-associative';

type AccessResult = 'hit' | 'miss';

interface CacheBlock {
  valid: boolean;
  tag: number;
  data: string;
  lastAccess: number; // for LRU
  loadedAt: number; // when this block was loaded
  dirty: boolean;
}

interface CacheSet {
  blocks: CacheBlock[];
}

interface AccessRecord {
  step: number;
  address: number;
  tag: number;
  setIndex: number;
  blockOffset: number;
  result: AccessResult;
  evictedTag: number | null;
  wayHit: number; // which way was hit or -1
  wayLoaded: number; // which way was loaded on miss
}

interface AddressDecomposition {
  address: number;
  tag: number;
  tagBits: number;
  setIndex: number;
  setIndexBits: number;
  blockOffset: number;
  offsetBits: number;
  binaryStr: string;
}

interface ScenarioPreset {
  label: string;
  desc: string;
  addresses: number[];
}

// ──────────────────────────── Constants ────────────────────────────

const DOMAIN_COLOR = '#8b5cf6';

const CACHE_TYPES: { value: CacheType; label: string; desc: string; ways: number }[] = [
  { value: 'direct-mapped', label: 'Direct-Mapped', desc: '1-way: each set has one block', ways: 1 },
  { value: '2-way', label: '2-Way Set Assoc.', desc: '2-way: each set has two blocks', ways: 2 },
  { value: '4-way', label: '4-Way Set Assoc.', desc: '4-way: each set has four blocks', ways: 4 },
  { value: 'fully-associative', label: 'Fully Associative', desc: 'Any block in any slot', ways: 0 }, // ways determined by cache size
];

const CACHE_SIZE = 256; // bytes
const BLOCK_SIZE = 16; // bytes per block
const TOTAL_BLOCKS = CACHE_SIZE / BLOCK_SIZE; // 16 blocks
const ADDRESS_BITS = 16; // 16-bit addresses

// Access latencies (in cycles)
const L1_LATENCY = 1;
const L2_LATENCY = 10;
const MEM_LATENCY = 100;

const SCENARIO_PRESETS: Record<string, ScenarioPreset> = {
  sequential: {
    label: 'Sequential Access',
    desc: 'Accesses consecutive memory addresses showing spatial locality',
    addresses: [
      0x0000, 0x0004, 0x0008, 0x000C,
      0x0010, 0x0014, 0x0018, 0x001C,
      0x0020, 0x0024, 0x0028, 0x002C,
      0x0030, 0x0034, 0x0038, 0x003C,
      0x0040, 0x0044, 0x0048, 0x004C,
    ],
  },
  strided: {
    label: 'Strided Access',
    desc: 'Accesses every 64 bytes, hitting different cache sets',
    addresses: [
      0x0000, 0x0040, 0x0080, 0x00C0,
      0x0100, 0x0140, 0x0180, 0x01C0,
      0x0000, 0x0040, 0x0080, 0x00C0,
      0x0100, 0x0140, 0x0180, 0x01C0,
      0x0000, 0x0040, 0x0080, 0x00C0,
    ],
  },
  thrashing: {
    label: 'Thrashing',
    desc: 'Accesses that map to the same set, causing continuous evictions',
    addresses: [
      0x0000, 0x0100, 0x0200, 0x0300, 0x0400,
      0x0000, 0x0100, 0x0200, 0x0300, 0x0400,
      0x0000, 0x0100, 0x0200, 0x0300, 0x0400,
      0x0000, 0x0100, 0x0200, 0x0300, 0x0400,
    ],
  },
  spatial: {
    label: 'Spatial Locality',
    desc: 'Nearby accesses within the same block, then moves to next block',
    addresses: [
      0x0000, 0x0002, 0x0004, 0x0006, 0x0008, 0x000A,
      0x0010, 0x0012, 0x0014, 0x0016, 0x0018,
      0x0000, 0x0002, 0x0004,
      0x0010, 0x0012, 0x0014,
      0x0020, 0x0022, 0x0024, 0x0026,
    ],
  },
  temporal: {
    label: 'Temporal Locality',
    desc: 'Repeatedly accesses the same addresses showing temporal locality',
    addresses: [
      0x0000, 0x0100, 0x0200,
      0x0000, 0x0100, 0x0200,
      0x0000, 0x0100, 0x0200,
      0x0000, 0x0100, 0x0200,
      0x0000, 0x0100, 0x0200,
      0x0000, 0x0100, 0x0200,
      0x0300, 0x0300,
    ],
  },
};

// ──────────────────────────── Cache Simulation Logic ────────────────────────────

function getWays(cacheType: CacheType): number {
  switch (cacheType) {
    case 'direct-mapped':
      return 1;
    case '2-way':
      return 2;
    case '4-way':
      return 4;
    case 'fully-associative':
      return TOTAL_BLOCKS;
  }
}

function getNumSets(cacheType: CacheType): number {
  const ways = getWays(cacheType);
  return TOTAL_BLOCKS / ways;
}

function getOffsetBits(): number {
  return Math.log2(BLOCK_SIZE);
}

function getSetIndexBits(cacheType: CacheType): number {
  const numSets = getNumSets(cacheType);
  return numSets > 1 ? Math.log2(numSets) : 0;
}

function getTagBits(cacheType: CacheType): number {
  return ADDRESS_BITS - getSetIndexBits(cacheType) - getOffsetBits();
}

function decomposeAddress(address: number, cacheType: CacheType): AddressDecomposition {
  const offsetBits = getOffsetBits();
  const setIndexBits = getSetIndexBits(cacheType);
  const tagBits = getTagBits(cacheType);

  const blockOffset = address & ((1 << offsetBits) - 1);
  const setIndex = (address >> offsetBits) & ((1 << setIndexBits) - 1);
  const tag = address >> (offsetBits + setIndexBits);

  const binaryStr = address.toString(2).padStart(ADDRESS_BITS, '0');

  return {
    address,
    tag,
    tagBits,
    setIndex,
    setIndexBits,
    blockOffset,
    offsetBits,
    binaryStr,
  };
}

function createEmptyCache(cacheType: CacheType): CacheSet[] {
  const numSets = getNumSets(cacheType);
  const ways = getWays(cacheType);

  return Array.from({ length: numSets }, () => ({
    blocks: Array.from({ length: ways }, () => ({
      valid: false,
      tag: 0,
      data: '',
      lastAccess: -1,
      loadedAt: -1,
      dirty: false,
    })),
  }));
}

function accessCache(
  cache: CacheSet[],
  address: number,
  cacheType: CacheType,
  step: number
): {
  newCache: CacheSet[];
  result: AccessResult;
  evictedTag: number | null;
  wayHit: number;
  wayLoaded: number;
  decomp: AddressDecomposition;
} {
  const decomp = decomposeAddress(address, cacheType);
  const { tag, setIndex } = decomp;

  const newCache = cache.map((set) => ({
    blocks: set.blocks.map((b) => ({ ...b })),
  }));

  const set = newCache[setIndex];

  // Check for hit
  for (let w = 0; w < set.blocks.length; w++) {
    if (set.blocks[w].valid && set.blocks[w].tag === tag) {
      // HIT
      set.blocks[w].lastAccess = step;
      return {
        newCache,
        result: 'hit',
        evictedTag: null,
        wayHit: w,
        wayLoaded: w,
        decomp,
      };
    }
  }

  // MISS - find block to replace
  let replaceWay = -1;
  let evictedTag: number | null = null;

  // First try to find an invalid (empty) block
  for (let w = 0; w < set.blocks.length; w++) {
    if (!set.blocks[w].valid) {
      replaceWay = w;
      break;
    }
  }

  // If no empty block, use LRU
  if (replaceWay === -1) {
    let oldestAccess = Infinity;
    for (let w = 0; w < set.blocks.length; w++) {
      if (set.blocks[w].lastAccess < oldestAccess) {
        oldestAccess = set.blocks[w].lastAccess;
        replaceWay = w;
      }
    }
    evictedTag = set.blocks[replaceWay].tag;
  }

  // Load the new block
  set.blocks[replaceWay] = {
    valid: true,
    tag,
    data: `[${address.toString(16).toUpperCase().padStart(4, '0')}]`,
    lastAccess: step,
    loadedAt: step,
    dirty: false,
  };

  return {
    newCache,
    result: 'miss',
    evictedTag,
    wayHit: -1,
    wayLoaded: replaceWay,
    decomp,
  };
}

function generateRandomAddresses(count: number): number[] {
  const addresses: number[] = [];
  const ranges = [0x0000, 0x0100, 0x0200, 0x0300, 0x0400];
  for (let i = 0; i < count; i++) {
    const base = ranges[Math.floor(Math.random() * ranges.length)];
    const offset = Math.floor(Math.random() * 16) * 4;
    addresses.push(base + offset);
  }
  return addresses;
}

// ──────────────────────────── Component ────────────────────────────

export default function CacheHierarchyModule() {
  // ── Core State ──
  const [cacheType, setCacheType] = useState<CacheType>('direct-mapped');
  const [cache, setCache] = useState<CacheSet[]>(() => createEmptyCache('direct-mapped'));
  const [addressSequence, setAddressSequence] = useState<number[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [history, setHistory] = useState<AccessRecord[]>([]);
  const [activeScenario, setActiveScenario] = useState('sequential');

  // ── Animation State ──
  const [lastAccess, setLastAccess] = useState<AccessRecord | null>(null);
  const [lastDecomp, setLastDecomp] = useState<AddressDecomposition | null>(null);
  const [flashResult, setFlashResult] = useState<'hit' | 'miss' | null>(null);
  const [highlightedSet, setHighlightedSet] = useState<number | null>(null);
  const [highlightedWay, setHighlightedWay] = useState<number | null>(null);

  // ── Controls State ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);

  // ── Animation Refs ──
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // ── Derived Metrics ──
  const totalAccesses = history.length;
  const hits = history.filter((h) => h.result === 'hit').length;
  const misses = totalAccesses - hits;
  const hitRate = totalAccesses > 0 ? (hits / totalAccesses) * 100 : 0;
  const missRate = totalAccesses > 0 ? (misses / totalAccesses) * 100 : 0;
  const avgAccessTime =
    totalAccesses > 0
      ? (hits * L1_LATENCY + misses * (L1_LATENCY + MEM_LATENCY)) / totalAccesses
      : 0;
  const simulationDone = currentStep >= addressSequence.length && addressSequence.length > 0;

  const numSets = getNumSets(cacheType);
  const ways = getWays(cacheType);
  const offsetBits = getOffsetBits();
  const setIndexBits = getSetIndexBits(cacheType);
  const tagBits = getTagBits(cacheType);

  // ── Step Forward ──
  const stepForward = useCallback(() => {
    setAddressSequence((seq) => {
      if (currentStep >= seq.length) {
        setIsPlaying(false);
        return seq;
      }

      const address = seq[currentStep];

      setCache((prevCache) => {
        const { newCache, result, evictedTag, wayHit, wayLoaded, decomp } = accessCache(
          prevCache,
          address,
          cacheType,
          currentStep
        );

        const record: AccessRecord = {
          step: currentStep,
          address,
          tag: decomp.tag,
          setIndex: decomp.setIndex,
          blockOffset: decomp.blockOffset,
          result,
          evictedTag,
          wayHit,
          wayLoaded,
        };

        setHistory((prev) => [...prev, record]);
        setLastAccess(record);
        setLastDecomp(decomp);
        setHighlightedSet(decomp.setIndex);
        setHighlightedWay(result === 'hit' ? wayHit : wayLoaded);
        setFlashResult(result);
        setTimeout(() => {
          setFlashResult(null);
        }, 600);

        return newCache;
      });

      setCurrentStep((s) => s + 1);
      return seq;
    });
  }, [currentStep, cacheType]);

  // ── Animation Loop ──
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(10, 800 / speedRef.current);
      if (timestamp - lastTickRef.current >= interval) {
        lastTickRef.current = timestamp;
        stepForward();
      }
      animationRef.current = requestAnimationFrame(animationLoop);
    },
    [stepForward]
  );

  // ── Play/Pause Effects ──
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
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, animationLoop]);

  // ── Stop when done ──
  useEffect(() => {
    if (simulationDone) {
      setIsPlaying(false);
    }
  }, [simulationDone]);

  // ── Handlers ──
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleStep = useCallback(() => {
    if (!simulationDone) stepForward();
  }, [stepForward, simulationDone]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    setCurrentStep(0);
    setHistory([]);
    setCache(createEmptyCache(cacheType));
    setLastAccess(null);
    setLastDecomp(null);
    setFlashResult(null);
    setHighlightedSet(null);
    setHighlightedWay(null);
  }, [cacheType]);

  const loadScenario = useCallback(
    (key: string) => {
      handleReset();
      setActiveScenario(key);
      const scenario = SCENARIO_PRESETS[key];
      if (!scenario) return;
      setAddressSequence([...scenario.addresses]);
    },
    [handleReset]
  );

  const handleCacheTypeChange = useCallback(
    (type: CacheType) => {
      setCacheType(type);
      setCurrentStep(0);
      setHistory([]);
      setCache(createEmptyCache(type));
      setLastAccess(null);
      setLastDecomp(null);
      setFlashResult(null);
      setHighlightedSet(null);
      setHighlightedWay(null);
      setIsPlaying(false);
    },
    []
  );

  // ── Load default scenario on mount ──
  useEffect(() => {
    loadScenario('sequential');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scroll history ──
  const historyEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [history]);

  // ──────────────────────────── Render ────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />

      <main className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* ── Header ── */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span
                className="px-2.5 py-0.5 rounded-md text-xs font-mono font-semibold"
                style={{
                  backgroundColor: `${DOMAIN_COLOR}15`,
                  color: DOMAIN_COLOR,
                  border: `1px solid ${DOMAIN_COLOR}30`,
                }}
              >
                2.5
              </span>
              <span className="text-xs text-[#71717a]">CPU Architecture</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Cache Hierarchy{' '}
              <span className="text-[#71717a] font-normal">Simulator</span>
            </h1>
            <p className="text-sm text-[#a1a1aa] max-w-2xl mt-1">
              Visualize how CPU caches work with direct-mapped, set-associative, and fully
              associative organizations. Watch addresses decompose into tag, set index, and
              offset fields with hit/miss animations and LRU replacement.
            </p>
          </div>

          {/* ── Cache Type Selector ── */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Layers size={14} className="text-[#8b5cf6]" />
              <span className="text-xs uppercase tracking-wider text-[#71717a] font-semibold">
                Cache Organization
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {CACHE_TYPES.map((ct) => (
                <button
                  key={ct.value}
                  onClick={() => handleCacheTypeChange(ct.value)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 border ${
                    cacheType === ct.value
                      ? 'bg-[#8b5cf6]/15 text-[#8b5cf6] border-[#8b5cf6]/30'
                      : 'bg-[#111118] text-[#a1a1aa] border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white'
                  }`}
                  title={ct.desc}
                >
                  {ct.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Cache Parameters ── */}
          <div className="flex flex-wrap gap-4 mb-6 p-3 rounded-xl bg-[#111118] border border-[#1e1e2e]">
            {[
              { label: 'Cache Size', value: `${CACHE_SIZE} B` },
              { label: 'Block Size', value: `${BLOCK_SIZE} B` },
              { label: 'Total Blocks', value: TOTAL_BLOCKS.toString() },
              { label: 'Sets', value: numSets.toString() },
              { label: 'Ways', value: ways.toString() },
              { label: 'Tag Bits', value: tagBits.toString() },
              { label: 'Index Bits', value: setIndexBits.toString() },
              { label: 'Offset Bits', value: offsetBits.toString() },
            ].map((param) => (
              <div key={param.label} className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                  {param.label}:
                </span>
                <span className="text-xs font-mono font-bold text-[#a1a1aa]">
                  {param.value}
                </span>
              </div>
            ))}
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
            />
          </div>

          {/* ── Scenario Presets ── */}
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className="text-xs text-[#71717a] mr-1 font-medium uppercase tracking-wider">
              Presets:
            </span>
            {Object.entries(SCENARIO_PRESETS).map(([key, scenario]) => (
              <button
                key={key}
                onClick={() => loadScenario(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 border ${
                  activeScenario === key
                    ? 'bg-[#8b5cf6]/15 text-[#8b5cf6] border-[#8b5cf6]/30'
                    : 'bg-[#111118] text-[#a1a1aa] border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white'
                }`}
                title={scenario.desc}
              >
                {scenario.label}
              </button>
            ))}
          </div>

          {/* ── Main Grid ── */}
          <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
            {/* ── Left Sidebar ── */}
            <div className="space-y-4">
              {/* Memory Hierarchy Diagram */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Layers size={14} className="text-[#8b5cf6]" />
                  Memory Hierarchy
                </h3>
                <div className="space-y-2">
                  {[
                    { label: 'CPU', latency: '--', color: '#8b5cf6', icon: Cpu, size: 'w-full' },
                    { label: 'L1 Cache', latency: `${L1_LATENCY} cycle`, color: '#10b981', icon: Zap, size: 'w-[85%] mx-auto' },
                    { label: 'L2 Cache', latency: `${L2_LATENCY} cycles`, color: '#06b6d4', icon: Database, size: 'w-[70%] mx-auto' },
                    { label: 'Main Memory', latency: `${MEM_LATENCY} cycles`, color: '#f59e0b', icon: HardDrive, size: 'w-[55%] mx-auto' },
                  ].map((level, i) => (
                    <div key={level.label}>
                      <motion.div
                        className={`${level.size} p-2.5 rounded-lg border flex items-center gap-2`}
                        style={{
                          borderColor: `${level.color}30`,
                          backgroundColor: `${level.color}08`,
                        }}
                        animate={{
                          borderColor:
                            flashResult && i === 1
                              ? flashResult === 'hit'
                                ? '#10b981'
                                : '#ef4444'
                              : flashResult && i === 3 && flashResult === 'miss'
                              ? '#f59e0b'
                              : `${level.color}30`,
                        }}
                        transition={{ duration: 0.3 }}
                      >
                        <level.icon size={14} style={{ color: level.color }} />
                        <span className="text-xs font-medium" style={{ color: level.color }}>
                          {level.label}
                        </span>
                        <span className="text-[10px] font-mono text-[#71717a] ml-auto">
                          {level.latency}
                        </span>
                      </motion.div>
                      {i < 3 && (
                        <div className="flex justify-center py-0.5">
                          <ArrowDown size={12} className="text-[#1e1e2e]" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Address Decomposition */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Target size={14} className="text-[#06b6d4]" />
                  Address Decomposition
                </h3>

                {lastDecomp ? (
                  <div className="space-y-3">
                    <div className="text-center">
                      <span className="text-[10px] uppercase tracking-wider text-[#71717a]">
                        Address:
                      </span>
                      <div className="text-lg font-mono font-bold text-white mt-0.5">
                        0x{lastDecomp.address.toString(16).toUpperCase().padStart(4, '0')}
                      </div>
                    </div>

                    {/* Binary representation */}
                    <div className="text-center">
                      <span className="text-[10px] uppercase tracking-wider text-[#71717a]">
                        Binary:
                      </span>
                      <div className="font-mono text-xs mt-1 flex justify-center flex-wrap">
                        {/* Tag bits */}
                        <span className="px-1 py-0.5 rounded bg-[#8b5cf6]/15 text-[#8b5cf6] border border-[#8b5cf6]/25">
                          {lastDecomp.binaryStr.slice(0, tagBits)}
                        </span>
                        {/* Set index bits */}
                        {setIndexBits > 0 && (
                          <span className="px-1 py-0.5 rounded bg-[#06b6d4]/15 text-[#06b6d4] border border-[#06b6d4]/25 ml-0.5">
                            {lastDecomp.binaryStr.slice(tagBits, tagBits + setIndexBits)}
                          </span>
                        )}
                        {/* Offset bits */}
                        <span className="px-1 py-0.5 rounded bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/25 ml-0.5">
                          {lastDecomp.binaryStr.slice(tagBits + setIndexBits)}
                        </span>
                      </div>
                    </div>

                    {/* Fields */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-2 rounded-lg bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[#8b5cf6] font-semibold">
                          Tag ({tagBits}b)
                        </div>
                        <div className="text-sm font-mono font-bold text-white mt-1">
                          {lastDecomp.tag}
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-[#06b6d4]/10 border border-[#06b6d4]/20 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[#06b6d4] font-semibold">
                          Set ({setIndexBits}b)
                        </div>
                        <div className="text-sm font-mono font-bold text-white mt-1">
                          {setIndexBits > 0 ? lastDecomp.setIndex : '--'}
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[#f59e0b] font-semibold">
                          Offset ({offsetBits}b)
                        </div>
                        <div className="text-sm font-mono font-bold text-white mt-1">
                          {lastDecomp.blockOffset}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[#71717a] italic py-4 text-center">
                    Start the simulation to see address decomposition.
                  </p>
                )}
              </div>

              {/* Last Access Result */}
              <AnimatePresence mode="wait">
                {lastAccess && (
                  <motion.div
                    key={lastAccess.step}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className={`p-4 rounded-xl border transition-all duration-300 ${
                      flashResult === 'hit'
                        ? 'bg-[#10b981]/10 border-[#10b981]/30'
                        : flashResult === 'miss'
                        ? 'bg-[#ef4444]/10 border-[#ef4444]/30'
                        : 'bg-[#111118] border-[#1e1e2e]'
                    }`}
                  >
                    <h3 className="text-sm font-semibold text-[#a1a1aa] mb-2 flex items-center gap-2">
                      <Zap size={14} className="text-[#f59e0b]" />
                      Last Access
                    </h3>
                    <div className="flex items-center gap-3">
                      <div className="text-xs font-mono text-[#a1a1aa]">
                        0x{lastAccess.address.toString(16).toUpperCase().padStart(4, '0')}
                      </div>
                      <ArrowRight size={12} className="text-[#71717a]" />
                      <div className="text-xs font-mono text-[#71717a]">
                        Set {lastAccess.setIndex}
                      </div>
                      <ArrowRight size={12} className="text-[#71717a]" />
                      <motion.div
                        initial={{ scale: 0.8 }}
                        animate={{ scale: 1 }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                          lastAccess.result === 'hit'
                            ? 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/25'
                            : 'bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/25'
                        }`}
                      >
                        {lastAccess.result === 'hit' ? 'HIT' : 'MISS'}
                      </motion.div>
                    </div>
                    {lastAccess.result === 'miss' && lastAccess.evictedTag !== null && (
                      <div className="mt-2 text-[10px] text-[#ef4444]/70 font-mono">
                        Evicted tag {lastAccess.evictedTag} from way {lastAccess.wayLoaded}
                      </div>
                    )}
                    {lastAccess.result === 'hit' && (
                      <div className="mt-2 text-[10px] text-[#10b981]/70 font-mono">
                        Found in way {lastAccess.wayHit} ({L1_LATENCY} cycle latency)
                      </div>
                    )}
                    {lastAccess.result === 'miss' && (
                      <div className="mt-2 text-[10px] text-[#ef4444]/70 font-mono">
                        Fetching from memory (+{MEM_LATENCY} cycle penalty)
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Access Pattern Trace */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Database size={14} className="text-[#f59e0b]" />
                  Address Sequence
                </h3>
                <div className="flex flex-wrap gap-1.5 max-h-[200px] overflow-y-auto">
                  {addressSequence.map((addr, i) => {
                    const isPast = i < currentStep;
                    const isCurrent = i === currentStep;
                    const record = history[i];

                    return (
                      <motion.div
                        key={i}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: i * 0.015 }}
                        className={`px-2 py-1 rounded text-[10px] font-mono border transition-all duration-200 ${
                          isCurrent
                            ? 'border-[#8b5cf6] bg-[#8b5cf6]/20 text-white ring-1 ring-[#8b5cf6]/30'
                            : isPast
                            ? record?.result === 'hit'
                              ? 'border-[#10b981]/30 bg-[#10b981]/10 text-[#10b981]'
                              : 'border-[#ef4444]/30 bg-[#ef4444]/10 text-[#ef4444]'
                            : 'border-[#1e1e2e] bg-[#0f0f17] text-[#71717a]'
                        }`}
                      >
                        {addr.toString(16).toUpperCase().padStart(4, '0')}
                      </motion.div>
                    );
                  })}
                  {addressSequence.length === 0 && (
                    <p className="text-xs text-[#71717a] italic py-2">
                      Choose a scenario preset.
                    </p>
                  )}
                </div>
              </div>

              {/* Info */}
              <div className="p-4 rounded-xl bg-[#0f0f17] border border-[#1e1e2e]/50">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-[#8b5cf6] mt-0.5 shrink-0" />
                  <div className="text-[11px] text-[#71717a] leading-relaxed">
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Direct-Mapped:</strong>{' '}
                      Each block maps to exactly one set. Fast but susceptible to conflict misses.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Set Associative:</strong>{' '}
                      Multiple blocks per set reduces conflict misses. Uses LRU replacement.
                    </p>
                    <p>
                      <strong className="text-[#a1a1aa]">Fully Associative:</strong>{' '}
                      Any block can go anywhere. Most flexible but expensive to search.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Right: Main Visualization ── */}
            <div className="space-y-6 min-w-0">
              {/* ── Metrics Bar ── */}
              <AnimatePresence>
                {showMetrics && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                      {[
                        { label: 'Accesses', value: totalAccesses.toString(), color: '#8b5cf6' },
                        { label: 'Hits', value: hits.toString(), color: '#10b981' },
                        { label: 'Misses', value: misses.toString(), color: '#ef4444' },
                        { label: 'Hit Rate', value: `${hitRate.toFixed(1)}%`, color: '#06b6d4' },
                        { label: 'Miss Rate', value: `${missRate.toFixed(1)}%`, color: '#f59e0b' },
                        {
                          label: 'Avg Latency',
                          value: avgAccessTime > 0 ? `${avgAccessTime.toFixed(1)}c` : '--',
                          color: '#71717a',
                        },
                      ].map((metric) => (
                        <div
                          key={metric.label}
                          className="p-3 rounded-xl bg-[#111118] border border-[#1e1e2e]"
                        >
                          <div
                            className="text-[10px] uppercase tracking-wider font-medium mb-1"
                            style={{ color: metric.color }}
                          >
                            {metric.label}
                          </div>
                          <div className="text-xl font-bold font-mono text-white">
                            {metric.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Cache Table Visualization ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <Database size={14} className="text-[#8b5cf6]" />
                  Cache Contents
                  <span className="text-[10px] font-normal text-[#71717a] ml-2">
                    ({numSets} sets x {ways} way{ways > 1 ? 's' : ''})
                  </span>
                </h3>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-2 sticky left-0 bg-[#111118] z-10 w-16">
                          Set
                        </th>
                        {Array.from({ length: ways }, (_, w) => (
                          <th
                            key={w}
                            className="text-center text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 px-1"
                            style={{ minWidth: ways <= 4 ? '140px' : '100px' }}
                          >
                            Way {w}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cache.map((set, setIdx) => {
                        const isHighlightedSet = highlightedSet === setIdx;

                        return (
                          <motion.tr
                            key={setIdx}
                            animate={{
                              backgroundColor: isHighlightedSet
                                ? flashResult === 'hit'
                                  ? 'rgba(16, 185, 129, 0.05)'
                                  : flashResult === 'miss'
                                  ? 'rgba(239, 68, 68, 0.05)'
                                  : 'rgba(139, 92, 246, 0.05)'
                                : 'transparent',
                            }}
                            className="border-t border-[#1e1e2e]/30"
                          >
                            <td
                              className={`py-2 pr-2 text-xs font-mono sticky left-0 z-10 ${
                                isHighlightedSet
                                  ? 'text-[#8b5cf6] font-bold bg-[#111118]'
                                  : 'text-[#71717a] bg-[#111118]'
                              }`}
                            >
                              [{setIdx}]
                            </td>
                            {set.blocks.map((block, wayIdx) => {
                              const isHighlightedBlock =
                                isHighlightedSet && highlightedWay === wayIdx;

                              return (
                                <td key={wayIdx} className="py-2 px-1">
                                  <motion.div
                                    animate={{
                                      borderColor: isHighlightedBlock
                                        ? flashResult === 'hit'
                                          ? '#10b981'
                                          : flashResult === 'miss'
                                          ? '#ef4444'
                                          : '#8b5cf6'
                                        : block.valid
                                        ? '#1e1e2e'
                                        : '#1e1e2e50',
                                      backgroundColor: isHighlightedBlock
                                        ? flashResult === 'hit'
                                          ? 'rgba(16, 185, 129, 0.1)'
                                          : 'rgba(239, 68, 68, 0.1)'
                                        : block.valid
                                        ? 'rgba(15, 15, 23, 0.8)'
                                        : 'rgba(15, 15, 23, 0.3)',
                                      scale: isHighlightedBlock ? 1.02 : 1,
                                    }}
                                    transition={{ duration: 0.2 }}
                                    className="p-2 rounded-lg border"
                                  >
                                    {block.valid ? (
                                      <div className="space-y-1">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[9px] uppercase text-[#10b981] font-bold">
                                            V
                                          </span>
                                          <span className="text-[9px] font-mono text-[#8b5cf6]">
                                            Tag: {block.tag}
                                          </span>
                                        </div>
                                        <div className="text-[10px] font-mono text-[#a1a1aa] truncate">
                                          {block.data}
                                        </div>
                                        {ways > 1 && (
                                          <div className="text-[8px] font-mono text-[#71717a]">
                                            LRU: {block.lastAccess}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="text-center py-1">
                                        <span className="text-[9px] text-[#71717a]/40 font-mono">
                                          empty
                                        </span>
                                      </div>
                                    )}
                                  </motion.div>
                                </td>
                              );
                            })}
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Hit Rate Chart ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp size={14} className="text-[#10b981]" />
                  Running Hit Rate
                </h3>

                {history.length === 0 ? (
                  <div className="py-8 text-center">
                    <TrendingUp size={32} className="mx-auto text-[#71717a]/20 mb-2" />
                    <p className="text-sm text-[#71717a]">
                      Press <span className="font-mono text-[#8b5cf6]">Play</span> or{' '}
                      <span className="font-mono text-[#8b5cf6]">Step</span> to begin
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Hit rate progress bar */}
                    <div className="relative h-8 rounded-lg bg-[#0f0f17] border border-[#1e1e2e] overflow-hidden">
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded-lg"
                        style={{
                          backgroundColor:
                            hitRate >= 70 ? '#10b981' : hitRate >= 40 ? '#f59e0b' : '#ef4444',
                        }}
                        animate={{ width: `${hitRate}%` }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center text-xs font-mono font-bold text-white">
                        {hitRate.toFixed(1)}% hit rate
                      </div>
                    </div>

                    {/* Per-access chart */}
                    <div className="flex items-end gap-[2px] h-24 px-1">
                      {history.map((record, i) => {
                        const runningHits = history
                          .slice(0, i + 1)
                          .filter((r) => r.result === 'hit').length;
                        const runningRate = (runningHits / (i + 1)) * 100;

                        return (
                          <motion.div
                            key={i}
                            initial={{ height: 0 }}
                            animate={{ height: `${Math.max(runningRate, 2)}%` }}
                            transition={{ duration: 0.2, delay: 0.02 }}
                            className="flex-1 min-w-[4px] max-w-[20px] rounded-t-sm relative group cursor-default"
                            style={{
                              backgroundColor:
                                record.result === 'hit' ? '#10b981' : '#ef4444',
                              opacity: 0.7,
                            }}
                            title={`Access ${i + 1}: ${record.result.toUpperCase()} (Running: ${runningRate.toFixed(0)}%)`}
                          >
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block px-1.5 py-0.5 rounded bg-[#1e1e2e] text-[8px] font-mono text-white whitespace-nowrap z-10">
                              {runningRate.toFixed(0)}%
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[9px] text-[#71717a] font-mono px-1">
                      <span>Access 1</span>
                      <span>Access {history.length}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Access History Table ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <Database size={14} className="text-[#06b6d4]" />
                  Access Trace
                </h3>

                {history.length === 0 ? (
                  <div className="py-8 text-center">
                    <Database size={32} className="mx-auto text-[#71717a]/20 mb-2" />
                    <p className="text-sm text-[#71717a]">
                      No accesses yet. Start the simulation.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                    <table className="w-full border-collapse">
                      <thead className="sticky top-0 bg-[#111118] z-10">
                        <tr>
                          <th className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">
                            #
                          </th>
                          <th className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">
                            Address
                          </th>
                          <th className="text-center text-[10px] uppercase tracking-wider text-[#8b5cf6] font-semibold pb-2 pr-3">
                            Tag
                          </th>
                          <th className="text-center text-[10px] uppercase tracking-wider text-[#06b6d4] font-semibold pb-2 pr-3">
                            Set
                          </th>
                          <th className="text-center text-[10px] uppercase tracking-wider text-[#f59e0b] font-semibold pb-2 pr-3">
                            Offset
                          </th>
                          <th className="text-center text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">
                            Result
                          </th>
                          <th className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2">
                            Detail
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <AnimatePresence>
                          {history.map((record) => (
                            <motion.tr
                              key={record.step}
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.15 }}
                              className="border-t border-[#1e1e2e]/40"
                            >
                              <td className="py-1.5 pr-3 text-xs font-mono text-[#71717a]">
                                {record.step + 1}
                              </td>
                              <td className="py-1.5 pr-3 text-xs font-mono text-[#a1a1aa]">
                                0x{record.address.toString(16).toUpperCase().padStart(4, '0')}
                              </td>
                              <td className="py-1.5 pr-3 text-center text-xs font-mono text-[#8b5cf6]">
                                {record.tag}
                              </td>
                              <td className="py-1.5 pr-3 text-center text-xs font-mono text-[#06b6d4]">
                                {record.setIndex}
                              </td>
                              <td className="py-1.5 pr-3 text-center text-xs font-mono text-[#f59e0b]">
                                {record.blockOffset}
                              </td>
                              <td className="py-1.5 pr-3 text-center">
                                {record.result === 'hit' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/20">
                                    <CheckCircle size={10} />
                                    HIT
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/20">
                                    <XCircle size={10} />
                                    MISS
                                  </span>
                                )}
                              </td>
                              <td className="py-1.5 text-[10px] font-mono text-[#71717a]">
                                {record.result === 'hit'
                                  ? `Way ${record.wayHit}`
                                  : record.evictedTag !== null
                                  ? `Evict tag ${record.evictedTag} -> Way ${record.wayLoaded}`
                                  : `Load -> Way ${record.wayLoaded}`}
                              </td>
                            </motion.tr>
                          ))}
                        </AnimatePresence>
                      </tbody>
                    </table>
                    <div ref={historyEndRef} />
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
                        Simulation complete &mdash; {hits}/{totalAccesses} hits ({hitRate.toFixed(1)}%
                        hit rate, avg latency {avgAccessTime.toFixed(1)} cycles)
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── LRU Replacement Visualization (for set-associative) ── */}
              {ways > 1 && history.length > 0 && (
                <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                  <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                    <Layers size={14} className="text-[#f59e0b]" />
                    LRU Order per Set
                    <span className="text-[10px] font-normal text-[#71717a] ml-1">
                      (most recent first)
                    </span>
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {cache.map((set, setIdx) => {
                      // Sort blocks by lastAccess descending (most recent first)
                      const sortedBlocks = set.blocks
                        .map((block, wayIdx) => ({ ...block, wayIdx }))
                        .filter((b) => b.valid)
                        .sort((a, b) => b.lastAccess - a.lastAccess);

                      if (sortedBlocks.length === 0) return null;

                      return (
                        <div
                          key={setIdx}
                          className={`p-2.5 rounded-lg border ${
                            highlightedSet === setIdx
                              ? 'border-[#8b5cf6]/30 bg-[#8b5cf6]/5'
                              : 'border-[#1e1e2e] bg-[#0f0f17]'
                          }`}
                        >
                          <div className="text-[10px] font-mono font-semibold text-[#71717a] mb-2">
                            Set [{setIdx}]
                          </div>
                          <div className="space-y-1">
                            {sortedBlocks.map((block, order) => (
                              <div
                                key={block.wayIdx}
                                className="flex items-center gap-2 px-2 py-1 rounded"
                                style={{
                                  backgroundColor:
                                    order === 0
                                      ? 'rgba(16, 185, 129, 0.1)'
                                      : 'rgba(30, 30, 46, 0.3)',
                                }}
                              >
                                <span
                                  className={`text-[9px] font-mono ${
                                    order === 0 ? 'text-[#10b981]' : 'text-[#71717a]'
                                  }`}
                                >
                                  {order === 0 ? 'MRU' : order === sortedBlocks.length - 1 ? 'LRU' : ` ${order + 1} `}
                                </span>
                                <span className="text-[10px] font-mono text-[#a1a1aa]">
                                  W{block.wayIdx}
                                </span>
                                <span className="text-[9px] font-mono text-[#8b5cf6] ml-auto">
                                  T:{block.tag}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
