'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Info,
  Play,
  RotateCcw,
  Zap,
  BarChart3,
  ArrowRight,
  Cpu,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

// ──────────────────────────── Types ────────────────────────────

type SimdOp = 'ADD' | 'MUL' | 'SUB' | 'MAX' | 'MIN';
type SimdWidth = 1 | 4 | 8 | 16;

interface LaneState {
  a: number;
  b: number;
  result: number | null;
  active: boolean;
  completed: boolean;
}

// ──────────────────────────── Constants ────────────────────────────

const DOMAIN_COLOR = '#8b5cf6';

const OPS: { value: SimdOp; label: string; fn: (a: number, b: number) => number }[] = [
  { value: 'ADD', label: 'Add', fn: (a, b) => a + b },
  { value: 'MUL', label: 'Multiply', fn: (a, b) => a * b },
  { value: 'SUB', label: 'Subtract', fn: (a, b) => a - b },
  { value: 'MAX', label: 'Max', fn: (a, b) => Math.max(a, b) },
  { value: 'MIN', label: 'Min', fn: (a, b) => Math.min(a, b) },
];

const WIDTHS: { value: SimdWidth; label: string }[] = [
  { value: 1, label: 'Scalar (1)' },
  { value: 4, label: 'SSE (4)' },
  { value: 8, label: 'AVX (8)' },
  { value: 16, label: 'AVX-512 (16)' },
];

function generateArray(size: number): number[] {
  return Array.from({ length: size }, () => Math.floor(Math.random() * 100));
}

// ──────────────────────────── Component ────────────────────────────

export default function SimdModule() {
  const ARRAY_SIZE = 16;

  const [arrayA, setArrayA] = useState<number[]>(() => generateArray(ARRAY_SIZE));
  const [arrayB, setArrayB] = useState<number[]>(() => generateArray(ARRAY_SIZE));
  const [results, setResults] = useState<(number | null)[]>(() => Array(ARRAY_SIZE).fill(null));
  const [op, setOp] = useState<SimdOp>('ADD');
  const [simdWidth, setSimdWidth] = useState<SimdWidth>(4);
  const [scalarStep, setScalarStep] = useState(0);
  const [simdStep, setSimdStep] = useState(0);
  const [scalarCycles, setScalarCycles] = useState(0);
  const [simdCycles, setSimdCycles] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<'scalar' | 'simd'>('simd');
  const [activeLanes, setActiveLanes] = useState<number[]>([]);

  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const opFn = OPS.find((o) => o.value === op)!.fn;
  const scalarDone = scalarStep >= ARRAY_SIZE;
  const simdDone = simdStep * simdWidth >= ARRAY_SIZE;
  const allDone = mode === 'scalar' ? scalarDone : simdDone;
  const totalSimdSteps = Math.ceil(ARRAY_SIZE / simdWidth);
  const speedup = simdWidth;

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    setScalarStep(0);
    setSimdStep(0);
    setScalarCycles(0);
    setSimdCycles(0);
    setResults(Array(ARRAY_SIZE).fill(null));
    setActiveLanes([]);
  }, []);

  const handleNewData = useCallback(() => {
    handleReset();
    setArrayA(generateArray(ARRAY_SIZE));
    setArrayB(generateArray(ARRAY_SIZE));
  }, [handleReset]);

  const stepForward = useCallback(() => {
    if (allDone) {
      setIsPlaying(false);
      return;
    }

    if (mode === 'scalar') {
      if (scalarStep < ARRAY_SIZE) {
        const newResults = [...results];
        newResults[scalarStep] = opFn(arrayA[scalarStep], arrayB[scalarStep]);
        setResults(newResults);
        setActiveLanes([scalarStep]);
        setScalarStep((s) => s + 1);
        setScalarCycles((c) => c + 1);
      }
    } else {
      // SIMD: process `simdWidth` elements at once
      const start = simdStep * simdWidth;
      const newResults = [...results];
      const lanes: number[] = [];
      for (let i = start; i < Math.min(start + simdWidth, ARRAY_SIZE); i++) {
        newResults[i] = opFn(arrayA[i], arrayB[i]);
        lanes.push(i);
      }
      setResults(newResults);
      setActiveLanes(lanes);
      setSimdStep((s) => s + 1);
      setSimdCycles((c) => c + 1);
    }
  }, [allDone, mode, scalarStep, simdStep, simdWidth, results, arrayA, arrayB, opFn]);

  // Animation loop
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

  useEffect(() => {
    if (isPlaying) {
      lastTickRef.current = performance.now();
      animationRef.current = requestAnimationFrame(animationLoop);
    } else {
      if (animationRef.current) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }
    }
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [isPlaying, animationLoop]);

  useEffect(() => { if (allDone) setIsPlaying(false); }, [allDone]);

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
                2.10
              </span>
              <span className="text-xs text-[#71717a]">CPU Architecture</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              SIMD / Vector Processing{' '}
              <span className="text-[#71717a] font-normal">Visualizer</span>
            </h1>
            <p className="text-sm text-[#a1a1aa] max-w-2xl mt-1">
              Compare scalar (one element at a time) vs SIMD (multiple elements in one instruction).
              See the throughput advantage of SSE, AVX, and AVX-512 vector widths.
            </p>
          </div>

          {/* Config Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {/* Operation */}
            <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
              <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-semibold mb-2">Operation</div>
              <div className="flex flex-wrap gap-2">
                {OPS.map((o) => (
                  <button key={o.value} onClick={() => { setOp(o.value); handleReset(); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      op === o.value
                        ? 'bg-[#8b5cf6]/15 text-[#8b5cf6] border-[#8b5cf6]/30'
                        : 'bg-[#0f0f17] text-[#a1a1aa] border-[#1e1e2e] hover:text-white'
                    }`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mode */}
            <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
              <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-semibold mb-2">Mode</div>
              <div className="flex gap-2">
                {(['scalar', 'simd'] as const).map((m) => (
                  <button key={m} onClick={() => { setMode(m); handleReset(); }}
                    className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      mode === m
                        ? m === 'scalar'
                          ? 'bg-[#f59e0b]/15 text-[#f59e0b] border-[#f59e0b]/30'
                          : 'bg-[#10b981]/15 text-[#10b981] border-[#10b981]/30'
                        : 'bg-[#0f0f17] text-[#a1a1aa] border-[#1e1e2e] hover:text-white'
                    }`}>
                    {m === 'scalar' ? 'Scalar' : 'SIMD'}
                  </button>
                ))}
              </div>
            </div>

            {/* Width (SIMD only) */}
            <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
              <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-semibold mb-2">SIMD Width</div>
              <div className="flex flex-wrap gap-2">
                {WIDTHS.filter((w) => w.value > 1).map((w) => (
                  <button key={w.value} onClick={() => { setSimdWidth(w.value); handleReset(); }}
                    disabled={mode === 'scalar'}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      simdWidth === w.value && mode === 'simd'
                        ? 'bg-[#10b981]/15 text-[#10b981] border-[#10b981]/30'
                        : 'bg-[#0f0f17] text-[#a1a1aa] border-[#1e1e2e] hover:text-white disabled:opacity-30'
                    }`}>
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => isPlaying ? setIsPlaying(false) : setIsPlaying(true)}
              disabled={allDone}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8b5cf6] text-white text-sm font-medium hover:bg-[#7c3aed] disabled:opacity-40 transition-all">
              {isPlaying ? (
                <><div className="flex gap-0.5"><div className="w-1 h-3 bg-white rounded-sm" /><div className="w-1 h-3 bg-white rounded-sm" /></div> Pause</>
              ) : (
                <><Play size={14} fill="white" /> {allDone ? 'Done' : 'Play'}</>
              )}
            </button>
            <button onClick={stepForward} disabled={allDone}
              className="px-4 py-2 rounded-lg bg-[#111118] text-[#a1a1aa] text-sm border border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white disabled:opacity-40 transition-all">
              Step
            </button>
            <button onClick={handleReset}
              className="px-4 py-2 rounded-lg bg-[#111118] text-[#a1a1aa] text-sm border border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white transition-all">
              <RotateCcw size={14} />
            </button>
            <button onClick={handleNewData}
              className="px-4 py-2 rounded-lg bg-[#111118] text-[#a1a1aa] text-sm border border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white transition-all">
              New Data
            </button>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px] text-[#71717a] uppercase tracking-wider">Speed</span>
              <input type="range" min={0.5} max={4} step={0.5} value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))} className="w-24 accent-[#8b5cf6]" />
              <span className="text-xs font-mono text-[#a1a1aa] w-8">{speed}x</span>
            </div>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Mode', value: mode === 'scalar' ? 'Scalar' : `SIMD x${simdWidth}`, color: mode === 'scalar' ? '#f59e0b' : '#10b981' },
              { label: 'Cycles Used', value: (mode === 'scalar' ? scalarCycles : simdCycles).toString(), color: '#8b5cf6' },
              { label: 'Elements Done', value: `${results.filter((r) => r !== null).length}/${ARRAY_SIZE}`, color: '#06b6d4' },
              { label: 'Speedup', value: mode === 'simd' ? `${speedup}x` : '1x', color: '#10b981' },
            ].map((m) => (
              <div key={m.label} className="p-3 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: m.color }}>{m.label}</div>
                <div className="text-xl font-bold font-mono text-white">{m.value}</div>
              </div>
            ))}
          </div>

          {/* Main Visualization */}
          <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e] mb-6">
            <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
              <Cpu size={14} className="text-[#8b5cf6]" />
              {mode === 'scalar' ? 'Scalar Processing' : `SIMD Processing (${simdWidth}-wide)`}
            </h3>

            {/* Lane headers */}
            <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: `repeat(${ARRAY_SIZE}, 1fr)` }}>
              {Array.from({ length: ARRAY_SIZE }, (_, i) => (
                <div key={i} className="text-center text-[8px] font-mono text-[#71717a]">[{i}]</div>
              ))}
            </div>

            {/* Array A */}
            <div className="grid gap-2 mb-1" style={{ gridTemplateColumns: `repeat(${ARRAY_SIZE}, 1fr)` }}>
              {arrayA.map((val, i) => {
                const isActive = activeLanes.includes(i);
                const isDone = results[i] !== null;
                return (
                  <motion.div key={i}
                    animate={{
                      backgroundColor: isActive ? 'rgba(139,92,246,0.2)' : isDone ? 'rgba(16,185,129,0.05)' : 'rgba(15,15,23,0.5)',
                      borderColor: isActive ? '#8b5cf6' : '#1e1e2e',
                    }}
                    className="p-1.5 rounded border text-center text-[10px] font-mono text-white">
                    {val}
                  </motion.div>
                );
              })}
            </div>

            {/* Operation indicator */}
            <div className="grid gap-2 mb-1" style={{ gridTemplateColumns: `repeat(${ARRAY_SIZE}, 1fr)` }}>
              {Array.from({ length: ARRAY_SIZE }, (_, i) => (
                <div key={i} className="text-center text-[10px] font-mono" style={{ color: activeLanes.includes(i) ? '#8b5cf6' : '#71717a30' }}>
                  {op}
                </div>
              ))}
            </div>

            {/* Array B */}
            <div className="grid gap-2 mb-1" style={{ gridTemplateColumns: `repeat(${ARRAY_SIZE}, 1fr)` }}>
              {arrayB.map((val, i) => {
                const isActive = activeLanes.includes(i);
                const isDone = results[i] !== null;
                return (
                  <motion.div key={i}
                    animate={{
                      backgroundColor: isActive ? 'rgba(139,92,246,0.2)' : isDone ? 'rgba(16,185,129,0.05)' : 'rgba(15,15,23,0.5)',
                      borderColor: isActive ? '#8b5cf6' : '#1e1e2e',
                    }}
                    className="p-1.5 rounded border text-center text-[10px] font-mono text-white">
                    {val}
                  </motion.div>
                );
              })}
            </div>

            {/* Separator */}
            <div className="grid gap-2 my-1" style={{ gridTemplateColumns: `repeat(${ARRAY_SIZE}, 1fr)` }}>
              {Array.from({ length: ARRAY_SIZE }, (_, i) => (
                <div key={i} className="border-t border-[#1e1e2e] mx-1" />
              ))}
            </div>

            {/* Results */}
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${ARRAY_SIZE}, 1fr)` }}>
              {results.map((val, i) => {
                const isActive = activeLanes.includes(i);
                return (
                  <motion.div key={i}
                    animate={{
                      backgroundColor: val !== null ? 'rgba(16,185,129,0.1)' : 'rgba(15,15,23,0.3)',
                      borderColor: isActive ? '#10b981' : val !== null ? '#10b981' + '30' : '#1e1e2e',
                    }}
                    className="p-1.5 rounded border text-center text-[10px] font-mono">
                    <span className={val !== null ? 'text-[#10b981] font-bold' : 'text-[#71717a]/30'}>
                      {val !== null ? val : '?'}
                    </span>
                  </motion.div>
                );
              })}
            </div>

            {/* SIMD group brackets */}
            {mode === 'simd' && (
              <div className="mt-3 flex gap-1">
                {Array.from({ length: totalSimdSteps }, (_, g) => {
                  const start = g * simdWidth;
                  const end = Math.min(start + simdWidth, ARRAY_SIZE);
                  const isCurrentGroup = g === simdStep - 1;
                  const isDoneGroup = g < simdStep;
                  return (
                    <div
                      key={g}
                      className={`flex-1 h-2 rounded-full transition-all ${
                        isCurrentGroup
                          ? 'bg-[#8b5cf6]'
                          : isDoneGroup
                          ? 'bg-[#10b981]/40'
                          : 'bg-[#1e1e2e]'
                      }`}
                      title={`Group ${g}: elements [${start}..${end - 1}]`}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Cycle Comparison */}
          <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e] mb-6">
            <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
              <BarChart3 size={14} className="text-[#06b6d4]" />
              Throughput Comparison
            </h3>
            <div className="space-y-3">
              {/* Scalar bar */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-[#f59e0b] w-20 shrink-0">Scalar</span>
                <div className="flex-1 h-8 rounded-lg bg-[#0f0f17] border border-[#1e1e2e] overflow-hidden relative">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-lg bg-[#f59e0b]/30"
                    animate={{ width: `${100}%` }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center text-xs font-mono font-bold text-[#f59e0b]">
                    {ARRAY_SIZE} cycles
                  </div>
                </div>
              </div>
              {/* SIMD bars */}
              {WIDTHS.filter((w) => w.value > 1).map((w) => {
                const cycles = Math.ceil(ARRAY_SIZE / w.value);
                const pct = (cycles / ARRAY_SIZE) * 100;
                return (
                  <div key={w.value} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-[#10b981] w-20 shrink-0">{w.label}</span>
                    <div className="flex-1 h-8 rounded-lg bg-[#0f0f17] border border-[#1e1e2e] overflow-hidden relative">
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded-lg bg-[#10b981]/30"
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.5 }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center text-xs font-mono font-bold text-[#10b981]">
                        {cycles} cycles ({w.value}x speedup)
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Completion */}
          <AnimatePresence>
            {allDone && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-xl bg-[#10b981]/10 border border-[#10b981]/20 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-[#10b981]" />
                <span className="text-sm text-[#10b981] font-medium">
                  All {ARRAY_SIZE} elements processed in {mode === 'scalar' ? scalarCycles : simdCycles} cycles
                  {mode === 'simd' && ` (${speedup}x faster than scalar)`}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Info */}
          <div className="mt-6 p-4 rounded-xl bg-[#0f0f17] border border-[#1e1e2e]/50">
            <div className="flex items-start gap-2">
              <Info size={14} className="text-[#8b5cf6] mt-0.5 shrink-0" />
              <div className="text-[11px] text-[#71717a] leading-relaxed">
                <p className="mb-1.5">
                  <strong className="text-[#f59e0b]">Scalar:</strong> Processes one element per clock cycle. Simple but slow for data-parallel operations.
                </p>
                <p className="mb-1.5">
                  <strong className="text-[#10b981]">SIMD:</strong> Single Instruction, Multiple Data — processes 4/8/16 elements simultaneously using wide vector registers.
                </p>
                <p>
                  <strong className="text-[#a1a1aa]">Real-world:</strong> SSE (128-bit, 4 floats), AVX2 (256-bit, 8 floats), AVX-512 (512-bit, 16 floats). Used in image processing, scientific computing, and ML inference.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
