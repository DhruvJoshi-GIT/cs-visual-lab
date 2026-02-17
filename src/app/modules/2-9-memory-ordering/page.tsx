'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Info,
  Play,
  RotateCcw,
  ArrowRight,
  Zap,
  Shield,
  Layers,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

// ──────────────────────────── Types ────────────────────────────

type MemOp = 'STORE' | 'LOAD';
type OpStatus = 'pending' | 'in-store-buffer' | 'executing' | 'completed' | 'reordered';

interface MemoryOperation {
  id: number;
  cpu: number;
  op: MemOp;
  address: string;
  value: number;
  originalOrder: number;
  executionOrder: number;
  status: OpStatus;
  hasFence: boolean;
}

interface StoreBufferEntry {
  address: string;
  value: number;
  flushed: boolean;
}

interface ScenarioPreset {
  label: string;
  desc: string;
  operations: Omit<MemoryOperation, 'id' | 'executionOrder' | 'status'>[];
  expectation: string;
  hasReordering: boolean;
}

// ──────────────────────────── Constants ────────────────────────────

const DOMAIN_COLOR = '#8b5cf6';

const SCENARIOS: Record<string, ScenarioPreset> = {
  store_store: {
    label: 'Store-Store Reorder',
    desc: 'Two stores can be reordered by the CPU in relaxed memory models',
    operations: [
      { cpu: 0, op: 'STORE', address: 'X', value: 1, originalOrder: 0, hasFence: false },
      { cpu: 0, op: 'STORE', address: 'Y', value: 1, originalOrder: 1, hasFence: false },
      { cpu: 1, op: 'LOAD', address: 'Y', value: 0, originalOrder: 2, hasFence: false },
      { cpu: 1, op: 'LOAD', address: 'X', value: 0, originalOrder: 3, hasFence: false },
    ],
    expectation: 'CPU 1 might see Y=1 but X=0 (store reordering)',
    hasReordering: true,
  },
  store_load: {
    label: 'Store-Load Reorder',
    desc: 'A load can bypass an earlier store to a different address (TSO allows this)',
    operations: [
      { cpu: 0, op: 'STORE', address: 'X', value: 1, originalOrder: 0, hasFence: false },
      { cpu: 0, op: 'LOAD', address: 'Y', value: 0, originalOrder: 1, hasFence: false },
      { cpu: 1, op: 'STORE', address: 'Y', value: 1, originalOrder: 2, hasFence: false },
      { cpu: 1, op: 'LOAD', address: 'X', value: 0, originalOrder: 3, hasFence: false },
    ],
    expectation: 'Both loads might return 0 (store-load reordering)',
    hasReordering: true,
  },
  with_fence: {
    label: 'With Memory Fence',
    desc: 'Memory fences prevent reordering — operations are ordered',
    operations: [
      { cpu: 0, op: 'STORE', address: 'X', value: 1, originalOrder: 0, hasFence: false },
      { cpu: 0, op: 'STORE', address: 'Y', value: 1, originalOrder: 1, hasFence: true },
      { cpu: 1, op: 'LOAD', address: 'Y', value: 0, originalOrder: 2, hasFence: false },
      { cpu: 1, op: 'LOAD', address: 'X', value: 0, originalOrder: 3, hasFence: true },
    ],
    expectation: 'If CPU 1 sees Y=1, it MUST see X=1 (fences enforce ordering)',
    hasReordering: false,
  },
  sequential: {
    label: 'Sequential Consistency',
    desc: 'All operations appear in program order — no reordering possible',
    operations: [
      { cpu: 0, op: 'STORE', address: 'X', value: 42, originalOrder: 0, hasFence: true },
      { cpu: 0, op: 'LOAD', address: 'X', value: 0, originalOrder: 1, hasFence: true },
      { cpu: 1, op: 'STORE', address: 'Y', value: 7, originalOrder: 2, hasFence: true },
      { cpu: 1, op: 'LOAD', address: 'Y', value: 0, originalOrder: 3, hasFence: true },
    ],
    expectation: 'All operations execute in strict program order',
    hasReordering: false,
  },
};

const MEMORY_MODELS = [
  { id: 'relaxed', label: 'Relaxed', desc: 'Any reordering allowed (ARM, RISC-V)', color: '#ef4444' },
  { id: 'tso', label: 'TSO', desc: 'Only store-load reordering allowed (x86)', color: '#f59e0b' },
  { id: 'sc', label: 'Seq. Consistent', desc: 'No reordering allowed', color: '#10b981' },
];

// ──────────────────────────── Component ────────────────────────────

export default function MemoryOrderingModule() {
  const [operations, setOperations] = useState<MemoryOperation[]>([]);
  const [storeBuffer0, setStoreBuffer0] = useState<StoreBufferEntry[]>([]);
  const [storeBuffer1, setStoreBuffer1] = useState<StoreBufferEntry[]>([]);
  const [memory, setMemory] = useState<Record<string, number>>({ X: 0, Y: 0 });
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [activeScenario, setActiveScenario] = useState('store_store');
  const [memoryModel, setMemoryModel] = useState('relaxed');
  const [reorderingDetected, setReorderingDetected] = useState(false);

  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const allDone = operations.length > 0 && operations.every((o) => o.status === 'completed' || o.status === 'reordered');

  useEffect(() => {
    loadScenario('store_store');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadScenario = useCallback((key: string) => {
    setActiveScenario(key);
    setIsPlaying(false);
    setCurrentStep(0);
    setReorderingDetected(false);
    const scenario = SCENARIOS[key];
    if (!scenario) return;
    const ops = scenario.operations.map((o, i) => ({
      ...o,
      id: i,
      executionOrder: -1,
      status: 'pending' as OpStatus,
    }));
    setOperations(ops);
    setStoreBuffer0([]);
    setStoreBuffer1([]);
    setMemory({ X: 0, Y: 0 });
  }, []);

  const canReorder = useCallback((op: MemoryOperation, prevOp: MemoryOperation | undefined): boolean => {
    if (!prevOp) return false;
    if (op.hasFence || prevOp.hasFence) return false;
    if (op.cpu !== prevOp.cpu) return false;
    if (op.address === prevOp.address) return false;

    if (memoryModel === 'sc') return false;
    if (memoryModel === 'tso') {
      // TSO only allows store-load reordering
      return prevOp.op === 'STORE' && op.op === 'LOAD';
    }
    // Relaxed: any reordering
    return true;
  }, [memoryModel]);

  const stepForward = useCallback(() => {
    if (allDone) {
      setIsPlaying(false);
      return;
    }

    setOperations((prev) => {
      const ops = prev.map((o) => ({ ...o }));
      const newMem = { ...memory };
      const newSB0 = [...storeBuffer0];
      const newSB1 = [...storeBuffer1];

      // Find next pending operation for each CPU
      const nextOps: (MemoryOperation | undefined)[] = [
        ops.find((o) => o.cpu === 0 && o.status === 'pending'),
        ops.find((o) => o.cpu === 1 && o.status === 'pending'),
      ];

      // Process one operation per CPU per step
      for (let cpu = 0; cpu < 2; cpu++) {
        const op = nextOps[cpu];
        if (!op) continue;

        // Check if previous same-CPU op has a fence
        const prevSameCpu = ops
          .filter((o) => o.cpu === cpu && o.id < op.id)
          .find((o) => o.status === 'pending' || o.status === 'in-store-buffer');
        if (prevSameCpu) continue; // Must wait for previous op

        const cpuOps = ops.filter((o) => o.cpu === cpu && o.status !== 'pending');
        const lastCpuOp = cpuOps.length > 0 ? cpuOps[cpuOps.length - 1] : undefined;

        const reordered = canReorder(op, lastCpuOp);

        if (op.op === 'STORE') {
          const sb = cpu === 0 ? newSB0 : newSB1;
          sb.push({ address: op.address, value: op.value, flushed: false });
          // In relaxed model, stores may not be visible immediately
          if (memoryModel !== 'relaxed' || op.hasFence || !reordered) {
            newMem[op.address] = op.value;
            sb[sb.length - 1].flushed = true;
          }
          op.status = 'completed';
          op.executionOrder = currentStep;
        } else {
          // LOAD
          // Check store buffer forwarding first
          const sb = cpu === 0 ? newSB0 : newSB1;
          const forwarded = [...sb].reverse().find((e) => e.address === op.address);
          if (forwarded && !forwarded.flushed) {
            op.value = forwarded.value;
          } else {
            op.value = newMem[op.address] ?? 0;
          }
          op.status = reordered ? 'reordered' : 'completed';
          op.executionOrder = currentStep;
          if (reordered) setReorderingDetected(true);
        }
      }

      // Flush store buffers for non-relaxed
      if (memoryModel !== 'relaxed') {
        for (const entry of newSB0) {
          if (!entry.flushed) {
            newMem[entry.address] = entry.value;
            entry.flushed = true;
          }
        }
        for (const entry of newSB1) {
          if (!entry.flushed) {
            newMem[entry.address] = entry.value;
            entry.flushed = true;
          }
        }
      }

      setMemory(newMem);
      setStoreBuffer0(newSB0);
      setStoreBuffer1(newSB1);
      setCurrentStep((s) => s + 1);
      return ops;
    });
  }, [allDone, memory, storeBuffer0, storeBuffer1, currentStep, canReorder, memoryModel]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    loadScenario(activeScenario);
  }, [activeScenario, loadScenario]);

  // Animation loop
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(10, 1000 / speedRef.current);
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

  const statusColor = (s: OpStatus) => {
    switch (s) {
      case 'pending': return '#71717a';
      case 'in-store-buffer': return '#f59e0b';
      case 'executing': return '#06b6d4';
      case 'completed': return '#10b981';
      case 'reordered': return '#ef4444';
    }
  };

  const currentScenario = SCENARIOS[activeScenario];

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
                2.9
              </span>
              <span className="text-xs text-[#71717a]">CPU Architecture</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Memory Ordering & Barriers{' '}
              <span className="text-[#71717a] font-normal">Visualizer</span>
            </h1>
            <p className="text-sm text-[#a1a1aa] max-w-2xl mt-1">
              See how CPUs reorder memory operations and how memory fences prevent it.
              Compare relaxed, TSO (x86), and sequential consistency models.
            </p>
          </div>

          {/* Memory Model Selector */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Shield size={14} className="text-[#8b5cf6]" />
              <span className="text-xs uppercase tracking-wider text-[#71717a] font-semibold">Memory Model</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {MEMORY_MODELS.map((model) => (
                <button key={model.id} onClick={() => { setMemoryModel(model.id); handleReset(); }}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 border ${
                    memoryModel === model.id
                      ? `border-[${model.color}]/30 text-white`
                      : 'bg-[#111118] text-[#a1a1aa] border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white'
                  }`}
                  style={memoryModel === model.id ? { backgroundColor: `${model.color}15`, borderColor: `${model.color}40`, color: model.color } : {}}
                  title={model.desc}>
                  {model.label}
                  <span className="text-[9px] ml-1 opacity-60">({model.desc})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Scenarios */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs text-[#71717a] mr-1 font-medium uppercase tracking-wider">Scenarios:</span>
            {Object.entries(SCENARIOS).map(([key, scenario]) => (
              <button key={key} onClick={() => loadScenario(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 border ${
                  activeScenario === key
                    ? 'bg-[#8b5cf6]/15 text-[#8b5cf6] border-[#8b5cf6]/30'
                    : 'bg-[#111118] text-[#a1a1aa] border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white'
                }`} title={scenario.desc}>
                {scenario.label}
              </button>
            ))}
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
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px] text-[#71717a] uppercase tracking-wider">Speed</span>
              <input type="range" min={0.5} max={4} step={0.5} value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))} className="w-24 accent-[#8b5cf6]" />
              <span className="text-xs font-mono text-[#a1a1aa] w-8">{speed}x</span>
            </div>
          </div>

          {/* Expectation Banner */}
          <div className={`mb-6 p-3 rounded-lg border ${
            currentScenario.hasReordering && memoryModel === 'relaxed'
              ? 'bg-[#ef4444]/5 border-[#ef4444]/20'
              : 'bg-[#10b981]/5 border-[#10b981]/20'
          }`}>
            <div className="flex items-start gap-2">
              {currentScenario.hasReordering && memoryModel === 'relaxed' ? (
                <AlertTriangle size={14} className="text-[#ef4444] mt-0.5 shrink-0" />
              ) : (
                <CheckCircle size={14} className="text-[#10b981] mt-0.5 shrink-0" />
              )}
              <span className="text-xs text-[#a1a1aa]">
                {currentScenario.expectation}
              </span>
            </div>
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* CPU 0 */}
            <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
              <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                <Zap size={14} className="text-[#06b6d4]" />
                CPU 0 — Operations
              </h3>
              <div className="space-y-2">
                {operations.filter((o) => o.cpu === 0).map((op) => (
                  <motion.div key={op.id}
                    animate={{
                      borderColor: op.status === 'completed' ? '#10b981' + '30' : op.status === 'reordered' ? '#ef4444' + '30' : '#1e1e2e',
                    }}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-[#0f0f17]">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      op.op === 'STORE' ? 'bg-[#f59e0b]/10 text-[#f59e0b]' : 'bg-[#06b6d4]/10 text-[#06b6d4]'
                    }`}>
                      {op.op}
                    </span>
                    <span className="text-sm font-mono text-white">
                      {op.op === 'STORE' ? `${op.address} = ${op.value}` : `${op.address}`}
                    </span>
                    {op.hasFence && (
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#8b5cf6]/15 text-[#8b5cf6] border border-[#8b5cf6]/30">
                        FENCE
                      </span>
                    )}
                    <span className="ml-auto px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                      style={{ color: statusColor(op.status), backgroundColor: `${statusColor(op.status)}15` }}>
                      {op.status === 'completed' ? (op.op === 'LOAD' ? `= ${op.value}` : 'DONE') : op.status.toUpperCase()}
                    </span>
                  </motion.div>
                ))}
              </div>
              {/* Store Buffer */}
              <div className="mt-4 pt-3 border-t border-[#1e1e2e]">
                <div className="text-[9px] uppercase tracking-wider text-[#71717a] font-semibold mb-2">Store Buffer</div>
                <div className="flex gap-2">
                  {storeBuffer0.length === 0 ? (
                    <span className="text-[10px] text-[#71717a]/40 italic">empty</span>
                  ) : storeBuffer0.map((e, i) => (
                    <div key={i} className={`px-2 py-1 rounded text-[10px] font-mono border ${
                      e.flushed ? 'border-[#10b981]/20 text-[#10b981]' : 'border-[#f59e0b]/20 text-[#f59e0b]'
                    }`}>
                      {e.address}={e.value} {e.flushed ? '(flushed)' : '(buffered)'}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* CPU 1 */}
            <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
              <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                <Zap size={14} className="text-[#8b5cf6]" />
                CPU 1 — Operations
              </h3>
              <div className="space-y-2">
                {operations.filter((o) => o.cpu === 1).map((op) => (
                  <motion.div key={op.id}
                    animate={{
                      borderColor: op.status === 'completed' ? '#10b981' + '30' : op.status === 'reordered' ? '#ef4444' + '30' : '#1e1e2e',
                    }}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-[#0f0f17]">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      op.op === 'STORE' ? 'bg-[#f59e0b]/10 text-[#f59e0b]' : 'bg-[#06b6d4]/10 text-[#06b6d4]'
                    }`}>
                      {op.op}
                    </span>
                    <span className="text-sm font-mono text-white">
                      {op.op === 'STORE' ? `${op.address} = ${op.value}` : `${op.address}`}
                    </span>
                    {op.hasFence && (
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#8b5cf6]/15 text-[#8b5cf6] border border-[#8b5cf6]/30">
                        FENCE
                      </span>
                    )}
                    <span className="ml-auto px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                      style={{ color: statusColor(op.status), backgroundColor: `${statusColor(op.status)}15` }}>
                      {op.status === 'completed' ? (op.op === 'LOAD' ? `= ${op.value}` : 'DONE') : op.status.toUpperCase()}
                    </span>
                  </motion.div>
                ))}
              </div>
              {/* Store Buffer */}
              <div className="mt-4 pt-3 border-t border-[#1e1e2e]">
                <div className="text-[9px] uppercase tracking-wider text-[#71717a] font-semibold mb-2">Store Buffer</div>
                <div className="flex gap-2">
                  {storeBuffer1.length === 0 ? (
                    <span className="text-[10px] text-[#71717a]/40 italic">empty</span>
                  ) : storeBuffer1.map((e, i) => (
                    <div key={i} className={`px-2 py-1 rounded text-[10px] font-mono border ${
                      e.flushed ? 'border-[#10b981]/20 text-[#10b981]' : 'border-[#f59e0b]/20 text-[#f59e0b]'
                    }`}>
                      {e.address}={e.value} {e.flushed ? '(flushed)' : '(buffered)'}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Shared Memory */}
          <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e] mb-6">
            <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
              <Layers size={14} className="text-[#10b981]" />
              Shared Memory
            </h3>
            <div className="flex gap-6">
              {Object.entries(memory).map(([addr, value]) => (
                <motion.div key={addr}
                  animate={{ borderColor: value !== 0 ? '#10b981' + '40' : '#1e1e2e' }}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-[#0f0f17] min-w-[120px]">
                  <span className="text-sm font-mono text-[#a1a1aa]">{addr}</span>
                  <span className="text-xl font-mono font-bold text-[#10b981]">= {value}</span>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Reordering Alert */}
          <AnimatePresence>
            {reorderingDetected && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="mb-6 p-4 rounded-xl bg-[#ef4444]/10 border border-[#ef4444]/20 flex items-center gap-3">
                <AlertTriangle size={18} className="text-[#ef4444]" />
                <span className="text-sm text-[#ef4444] font-medium">
                  Memory reordering detected! A load observed a stale value due to out-of-order execution.
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Completion */}
          <AnimatePresence>
            {allDone && !reorderingDetected && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-xl bg-[#10b981]/10 border border-[#10b981]/20 flex items-center gap-3">
                <CheckCircle size={18} className="text-[#10b981]" />
                <span className="text-sm text-[#10b981] font-medium">
                  All operations completed. Memory is consistent under {memoryModel.toUpperCase()} model.
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
                  <strong className="text-[#ef4444]">Relaxed (ARM/RISC-V):</strong> Any reordering is allowed. Requires explicit fences for ordering.
                </p>
                <p className="mb-1.5">
                  <strong className="text-[#f59e0b]">TSO (x86):</strong> Only store-load reordering allowed. Stores to different addresses can be seen in different orders by other CPUs.
                </p>
                <p>
                  <strong className="text-[#10b981]">Sequential Consistency:</strong> All operations appear in program order. Simplest to reason about, but most restrictive.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
