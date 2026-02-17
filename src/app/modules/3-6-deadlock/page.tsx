'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Info,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  Lock,
  Unlock,
  ArrowRight,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

// ──────────────────────────── Types ────────────────────────────

interface Process {
  id: number;
  name: string;
  color: string;
  holding: number[];
  waiting: number | null;
}

interface Resource {
  id: number;
  name: string;
  total: number;
  available: number;
  heldBy: number[];
}

interface ScenarioPreset {
  label: string;
  desc: string;
  processes: Process[];
  resources: Resource[];
  isDeadlocked: boolean;
}

// ──────────────────────────── Constants ────────────────────────────

const DOMAIN_COLOR = '#06b6d4';

const SCENARIOS: Record<string, ScenarioPreset> = {
  classic_deadlock: {
    label: 'Classic Deadlock',
    desc: 'Two processes each hold one resource and wait for the other',
    processes: [
      { id: 0, name: 'P1', color: '#8b5cf6', holding: [0], waiting: 1 },
      { id: 1, name: 'P2', color: '#10b981', holding: [1], waiting: 0 },
    ],
    resources: [
      { id: 0, name: 'R1', total: 1, available: 0, heldBy: [0] },
      { id: 1, name: 'R2', total: 1, available: 0, heldBy: [1] },
    ],
    isDeadlocked: true,
  },
  three_way: {
    label: 'Three-Way Deadlock',
    desc: 'Circular wait among three processes',
    processes: [
      { id: 0, name: 'P1', color: '#8b5cf6', holding: [0], waiting: 1 },
      { id: 1, name: 'P2', color: '#10b981', holding: [1], waiting: 2 },
      { id: 2, name: 'P3', color: '#f59e0b', holding: [2], waiting: 0 },
    ],
    resources: [
      { id: 0, name: 'R1', total: 1, available: 0, heldBy: [0] },
      { id: 1, name: 'R2', total: 1, available: 0, heldBy: [1] },
      { id: 2, name: 'R3', total: 1, available: 0, heldBy: [2] },
    ],
    isDeadlocked: true,
  },
  no_deadlock: {
    label: 'No Deadlock',
    desc: 'Processes can complete — no circular wait',
    processes: [
      { id: 0, name: 'P1', color: '#8b5cf6', holding: [0], waiting: 1 },
      { id: 1, name: 'P2', color: '#10b981', holding: [], waiting: 1 },
      { id: 2, name: 'P3', color: '#f59e0b', holding: [1], waiting: null },
    ],
    resources: [
      { id: 0, name: 'R1', total: 1, available: 0, heldBy: [0] },
      { id: 1, name: 'R2', total: 1, available: 0, heldBy: [2] },
    ],
    isDeadlocked: false,
  },
  banker_safe: {
    label: "Banker's Safe State",
    desc: "System is in a safe state — a safe sequence exists",
    processes: [
      { id: 0, name: 'P1', color: '#8b5cf6', holding: [0], waiting: 1 },
      { id: 1, name: 'P2', color: '#10b981', holding: [1], waiting: null },
      { id: 2, name: 'P3', color: '#f59e0b', holding: [], waiting: 0 },
    ],
    resources: [
      { id: 0, name: 'R1', total: 2, available: 1, heldBy: [0] },
      { id: 1, name: 'R2', total: 1, available: 0, heldBy: [1] },
    ],
    isDeadlocked: false,
  },
};

function detectCycle(processes: Process[]): number[] {
  // Find cycle in wait-for graph
  const visited = new Set<number>();
  const inStack = new Set<number>();
  const path: number[] = [];

  function dfs(pid: number): number[] | null {
    visited.add(pid);
    inStack.add(pid);
    path.push(pid);

    const proc = processes.find((p) => p.id === pid);
    if (proc?.waiting !== null && proc?.waiting !== undefined) {
      // Find who holds the resource this process is waiting for
      const holder = processes.find((p) => p.holding.includes(proc.waiting!));
      if (holder) {
        if (inStack.has(holder.id)) {
          const cycleStart = path.indexOf(holder.id);
          return path.slice(cycleStart);
        }
        if (!visited.has(holder.id)) {
          const cycle = dfs(holder.id);
          if (cycle) return cycle;
        }
      }
    }

    path.pop();
    inStack.delete(pid);
    return null;
  }

  for (const p of processes) {
    if (!visited.has(p.id)) {
      const cycle = dfs(p.id);
      if (cycle) return cycle;
    }
  }
  return [];
}

// ──────────────────────────── Component ────────────────────────────

export default function DeadlockModule() {
  const [processes, setProcesses] = useState<Process[]>(SCENARIOS.classic_deadlock.processes);
  const [resources, setResources] = useState<Resource[]>(SCENARIOS.classic_deadlock.resources);
  const [activeScenario, setActiveScenario] = useState('classic_deadlock');
  const [showCycle, setShowCycle] = useState(false);

  const cycle = detectCycle(processes);
  const hasDeadlock = cycle.length > 0;

  const loadScenario = useCallback((key: string) => {
    setActiveScenario(key);
    setShowCycle(false);
    const scenario = SCENARIOS[key];
    if (!scenario) return;
    setProcesses(scenario.processes.map((p) => ({ ...p, holding: [...p.holding] })));
    setResources(scenario.resources.map((r) => ({ ...r, heldBy: [...r.heldBy] })));
  }, []);

  const handleDetect = useCallback(() => {
    setShowCycle(true);
  }, []);

  const handleResolve = useCallback(() => {
    if (cycle.length === 0) return;
    // Kill the last process in the cycle to break it
    const victimId = cycle[cycle.length - 1];
    setProcesses((prev) => prev.map((p) => {
      if (p.id === victimId) {
        return { ...p, holding: [], waiting: null };
      }
      return p;
    }));
    setResources((prev) => prev.map((r) => ({
      ...r,
      heldBy: r.heldBy.filter((h) => h !== victimId),
      available: r.available + (r.heldBy.includes(victimId) ? 1 : 0),
    })));
    setShowCycle(false);
  }, [cycle]);

  // SVG positions for RAG
  const pPositions = processes.map((_, i) => {
    const angle = (i * (2 * Math.PI)) / Math.max(processes.length, 1) - Math.PI / 2;
    const radius = 120;
    return { x: 200 + radius * Math.cos(angle), y: 160 + radius * Math.sin(angle) };
  });

  const rPositions = resources.map((_, i) => {
    const angle = (i * (2 * Math.PI)) / Math.max(resources.length, 1);
    const radius = 70;
    return { x: 200 + radius * Math.cos(angle), y: 160 + radius * Math.sin(angle) };
  });

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
                3.6
              </span>
              <span className="text-xs text-[#71717a]">Operating Systems</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Deadlock{' '}
              <span className="text-[#71717a] font-normal">Visualizer</span>
            </h1>
            <p className="text-sm text-[#a1a1aa] max-w-2xl mt-1">
              Explore resource allocation graphs, detect deadlocks via cycle detection,
              and resolve them. Compare safe and unsafe states.
            </p>
          </div>

          {/* Scenarios */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs text-[#71717a] mr-1 font-medium uppercase tracking-wider">Scenarios:</span>
            {Object.entries(SCENARIOS).map(([key, scenario]) => (
              <button key={key} onClick={() => loadScenario(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 border ${
                  activeScenario === key
                    ? 'bg-[#06b6d4]/15 text-[#06b6d4] border-[#06b6d4]/30'
                    : 'bg-[#111118] text-[#a1a1aa] border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white'
                }`} title={scenario.desc}>
                {scenario.label}
              </button>
            ))}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <button onClick={handleDetect}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#f59e0b] text-black text-sm font-medium hover:bg-[#d97706] transition-all">
              <AlertTriangle size={14} /> Detect Deadlock
            </button>
            {hasDeadlock && showCycle && (
              <button onClick={handleResolve}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#ef4444] text-white text-sm font-medium hover:bg-[#dc2626] transition-all">
                Resolve (Kill P{cycle[cycle.length - 1] + 1})
              </button>
            )}
            <button onClick={() => loadScenario(activeScenario)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#111118] text-[#a1a1aa] text-sm border border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white transition-all">
              <RotateCcw size={14} /> Reset
            </button>
          </div>

          {/* Detection Result */}
          <AnimatePresence>
            {showCycle && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                className={`mb-6 p-4 rounded-xl border flex items-center gap-3 ${
                  hasDeadlock
                    ? 'bg-[#ef4444]/10 border-[#ef4444]/20'
                    : 'bg-[#10b981]/10 border-[#10b981]/20'
                }`}>
                {hasDeadlock ? (
                  <>
                    <AlertTriangle size={18} className="text-[#ef4444]" />
                    <div>
                      <span className="text-sm text-[#ef4444] font-bold">Deadlock Detected!</span>
                      <span className="text-sm text-[#a1a1aa] ml-2">
                        Cycle: {cycle.map((id) => `P${id + 1}`).join(' → ')} → P{cycle[0] + 1}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} className="text-[#10b981]" />
                    <span className="text-sm text-[#10b981] font-bold">No deadlock — system is safe.</span>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-6">
            {/* Resource Allocation Graph */}
            <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
              <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4">
                Resource Allocation Graph
              </h3>
              <div className="flex justify-center">
                <svg width="400" height="320" className="overflow-visible">
                  <defs>
                    <marker id="arrow-rag" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M0,0 L8,4 L0,8" fill="#a1a1aa" />
                    </marker>
                    <marker id="arrow-rag-red" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M0,0 L8,4 L0,8" fill="#ef4444" />
                    </marker>
                  </defs>

                  {/* Assignment edges: Resource -> Process (who holds it) */}
                  {resources.map((r, ri) =>
                    r.heldBy.map((pid) => {
                      const pi = processes.findIndex((p) => p.id === pid);
                      if (pi < 0) return null;
                      const rPos = rPositions[ri];
                      const pPos = pPositions[pi];
                      const inCycle = showCycle && hasDeadlock && cycle.includes(pid);
                      return (
                        <line key={`hold-${r.id}-${pid}`}
                          x1={rPos.x} y1={rPos.y} x2={pPos.x} y2={pPos.y}
                          stroke={inCycle ? '#ef4444' : '#10b981'}
                          strokeWidth={inCycle ? 2.5 : 1.5}
                          markerEnd={inCycle ? 'url(#arrow-rag-red)' : 'url(#arrow-rag)'}
                          opacity={0.7}
                        />
                      );
                    })
                  )}

                  {/* Request edges: Process -> Resource (what it wants) */}
                  {processes.map((p, pi) => {
                    if (p.waiting === null) return null;
                    const ri = resources.findIndex((r) => r.id === p.waiting);
                    if (ri < 0) return null;
                    const pPos = pPositions[pi];
                    const rPos = rPositions[ri];
                    const inCycle = showCycle && hasDeadlock && cycle.includes(p.id);
                    return (
                      <line key={`wait-${p.id}-${p.waiting}`}
                        x1={pPos.x} y1={pPos.y} x2={rPos.x} y2={rPos.y}
                        stroke={inCycle ? '#ef4444' : '#f59e0b'}
                        strokeWidth={inCycle ? 2.5 : 1.5}
                        strokeDasharray={inCycle ? 'none' : '6,3'}
                        markerEnd={inCycle ? 'url(#arrow-rag-red)' : 'url(#arrow-rag)'}
                        opacity={0.7}
                      />
                    );
                  })}

                  {/* Process nodes (circles) */}
                  {processes.map((p, i) => {
                    const pos = pPositions[i];
                    const inCycle = showCycle && hasDeadlock && cycle.includes(p.id);
                    return (
                      <g key={`p-${p.id}`}>
                        <motion.circle
                          cx={pos.x} cy={pos.y} r={30}
                          fill={inCycle ? '#ef444420' : `${p.color}15`}
                          stroke={inCycle ? '#ef4444' : p.color}
                          strokeWidth={inCycle ? 3 : 2}
                          animate={{ scale: inCycle ? [1, 1.05, 1] : 1 }}
                          transition={{ duration: 1, repeat: inCycle ? Infinity : 0 }}
                        />
                        <text x={pos.x} y={pos.y + 5} textAnchor="middle" fill={inCycle ? '#ef4444' : p.color}
                          fontSize="14" fontWeight="bold" fontFamily="monospace">
                          {p.name}
                        </text>
                      </g>
                    );
                  })}

                  {/* Resource nodes (squares) */}
                  {resources.map((r, i) => {
                    const pos = rPositions[i];
                    return (
                      <g key={`r-${r.id}`}>
                        <rect x={pos.x - 22} y={pos.y - 22} width={44} height={44} rx={6}
                          fill="#f59e0b10" stroke="#f59e0b" strokeWidth={1.5} />
                        <text x={pos.x} y={pos.y + 5} textAnchor="middle" fill="#f59e0b"
                          fontSize="12" fontWeight="bold" fontFamily="monospace">
                          {r.name}
                        </text>
                        {/* Instance dots */}
                        {Array.from({ length: r.total }, (_, d) => (
                          <circle key={d} cx={pos.x - (r.total - 1) * 5 + d * 10} cy={pos.y + 16}
                            r={3} fill={d < r.total - r.available ? '#f59e0b' : '#71717a'} />
                        ))}
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-[#1e1e2e] justify-center">
                <span className="flex items-center gap-1.5 text-[10px] text-[#71717a]">
                  <div className="w-3 h-3 rounded-full border-2 border-[#8b5cf6]" /> Process
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-[#71717a]">
                  <div className="w-3 h-3 rounded border border-[#f59e0b]" /> Resource
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-[#71717a]">
                  <div className="w-6 h-0 border-t-2 border-[#10b981]" /> Holds
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-[#71717a]">
                  <div className="w-6 h-0 border-t-2 border-dashed border-[#f59e0b]" /> Waits for
                </span>
              </div>
            </div>

            {/* Right Sidebar */}
            <div className="space-y-4">
              {/* Process Details */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3">Processes</h3>
                <div className="space-y-2">
                  {processes.map((p) => (
                    <div key={p.id} className="p-3 rounded-lg bg-[#0f0f17] border border-[#1e1e2e]">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="text-sm font-mono font-bold" style={{ color: p.color }}>{p.name}</span>
                      </div>
                      <div className="text-[10px] font-mono text-[#a1a1aa] space-y-1">
                        <div className="flex items-center gap-2">
                          <Lock size={10} className="text-[#10b981]" />
                          Holds: {p.holding.length > 0 ? p.holding.map((r) => resources.find((res) => res.id === r)?.name).join(', ') : 'none'}
                        </div>
                        <div className="flex items-center gap-2">
                          {p.waiting !== null ? <AlertTriangle size={10} className="text-[#f59e0b]" /> : <CheckCircle size={10} className="text-[#71717a]" />}
                          Waiting: {p.waiting !== null ? resources.find((r) => r.id === p.waiting)?.name : 'nothing'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Resource Details */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3">Resources</h3>
                <div className="space-y-2">
                  {resources.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-[#0f0f17] border border-[#1e1e2e]">
                      <span className="text-sm font-mono font-bold text-[#f59e0b]">{r.name}</span>
                      <div className="flex gap-1 ml-auto">
                        {Array.from({ length: r.total }, (_, d) => (
                          <div key={d} className={`w-4 h-4 rounded-sm border ${
                            d < r.total - r.available
                              ? 'bg-[#f59e0b]/20 border-[#f59e0b]/40'
                              : 'bg-[#0f0f17] border-[#1e1e2e]'
                          }`}>
                            <span className="text-[7px] flex items-center justify-center h-full font-mono text-[#71717a]">
                              {d < r.total - r.available ? 'U' : 'F'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Deadlock Conditions */}
              <div className="p-4 rounded-xl bg-[#0f0f17] border border-[#1e1e2e]/50">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-[#06b6d4] mt-0.5 shrink-0" />
                  <div className="text-[11px] text-[#71717a] leading-relaxed">
                    <p className="font-semibold text-[#a1a1aa] mb-1">Four conditions for deadlock:</p>
                    <p>1. <strong className="text-[#a1a1aa]">Mutual Exclusion:</strong> Resources can&apos;t be shared</p>
                    <p>2. <strong className="text-[#a1a1aa]">Hold & Wait:</strong> Processes hold resources while waiting</p>
                    <p>3. <strong className="text-[#a1a1aa]">No Preemption:</strong> Can&apos;t forcibly take resources</p>
                    <p>4. <strong className="text-[#a1a1aa]">Circular Wait:</strong> Cycle in wait-for graph</p>
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
