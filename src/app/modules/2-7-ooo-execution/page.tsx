'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu,
  Info,
  Play,
  RotateCcw,
  ArrowRight,
  Zap,
  Layers,
  CheckCircle,
  Clock,
  BarChart3,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

// ──────────────────────────── Types ────────────────────────────

type InstrOp = 'ADD' | 'SUB' | 'MUL' | 'DIV' | 'LD';
type InstrStage = 'waiting' | 'issued' | 'executing' | 'write-back' | 'committed';

interface Instruction {
  id: number;
  op: InstrOp;
  dest: string;
  src1: string;
  src2: string;
  stage: InstrStage;
  issueAt: number;
  execStart: number;
  execEnd: number;
  writeBackAt: number;
  commitAt: number;
  latency: number;
  execRemaining: number;
}

interface RSEntry {
  busy: boolean;
  op: InstrOp;
  instrId: number;
  vj: number | null;
  vk: number | null;
  qj: string | null; // waiting for this RS
  qk: string | null;
  dest: string;
}

interface ROBEntry {
  instrId: number;
  op: InstrOp;
  dest: string;
  value: number | null;
  ready: boolean;
  committed: boolean;
}

interface ScenarioPreset {
  label: string;
  desc: string;
  instructions: Omit<Instruction, 'id' | 'stage' | 'issueAt' | 'execStart' | 'execEnd' | 'writeBackAt' | 'commitAt' | 'execRemaining'>[];
}

// ──────────────────────────── Constants ────────────────────────────

const DOMAIN_COLOR = '#8b5cf6';

const OP_LATENCIES: Record<InstrOp, number> = {
  ADD: 2,
  SUB: 2,
  MUL: 4,
  DIV: 8,
  LD: 3,
};

const OP_COLORS: Record<InstrOp, string> = {
  ADD: '#10b981',
  SUB: '#06b6d4',
  MUL: '#f59e0b',
  DIV: '#ef4444',
  LD: '#8b5cf6',
};

const SCENARIOS: Record<string, ScenarioPreset> = {
  basic: {
    label: 'Basic Dependencies',
    desc: 'Simple RAW hazards between instructions',
    instructions: [
      { op: 'LD', dest: 'R1', src1: 'MEM[0]', src2: '', latency: 3 },
      { op: 'ADD', dest: 'R2', src1: 'R1', src2: 'R3', latency: 2 },
      { op: 'SUB', dest: 'R4', src1: 'R2', src2: 'R5', latency: 2 },
      { op: 'MUL', dest: 'R6', src1: 'R1', src2: 'R4', latency: 4 },
      { op: 'ADD', dest: 'R7', src1: 'R6', src2: 'R3', latency: 2 },
    ],
  },
  independent: {
    label: 'Independent Instructions',
    desc: 'No dependencies — can all execute in parallel',
    instructions: [
      { op: 'ADD', dest: 'R1', src1: 'R2', src2: 'R3', latency: 2 },
      { op: 'SUB', dest: 'R4', src1: 'R5', src2: 'R6', latency: 2 },
      { op: 'MUL', dest: 'R7', src1: 'R8', src2: 'R9', latency: 4 },
      { op: 'ADD', dest: 'R10', src1: 'R11', src2: 'R12', latency: 2 },
      { op: 'LD', dest: 'R13', src1: 'MEM[4]', src2: '', latency: 3 },
    ],
  },
  long_chain: {
    label: 'Long Dependency Chain',
    desc: 'Each instruction depends on the previous — serialized execution',
    instructions: [
      { op: 'LD', dest: 'R1', src1: 'MEM[0]', src2: '', latency: 3 },
      { op: 'MUL', dest: 'R2', src1: 'R1', src2: 'R1', latency: 4 },
      { op: 'ADD', dest: 'R3', src1: 'R2', src2: 'R1', latency: 2 },
      { op: 'DIV', dest: 'R4', src1: 'R3', src2: 'R2', latency: 8 },
      { op: 'SUB', dest: 'R5', src1: 'R4', src2: 'R3', latency: 2 },
    ],
  },
  mixed: {
    label: 'Mixed Dependencies',
    desc: 'Some independent, some dependent — shows OoO advantage',
    instructions: [
      { op: 'LD', dest: 'R1', src1: 'MEM[0]', src2: '', latency: 3 },
      { op: 'ADD', dest: 'R2', src1: 'R5', src2: 'R6', latency: 2 },
      { op: 'MUL', dest: 'R3', src1: 'R1', src2: 'R2', latency: 4 },
      { op: 'SUB', dest: 'R4', src1: 'R7', src2: 'R8', latency: 2 },
      { op: 'ADD', dest: 'R9', src1: 'R3', src2: 'R4', latency: 2 },
      { op: 'DIV', dest: 'R10', src1: 'R9', src2: 'R2', latency: 8 },
    ],
  },
};

const NUM_RS = 6; // Reservation stations

// ──────────────────────────── Simulation ────────────────────────────

function createInstruction(
  template: ScenarioPreset['instructions'][0],
  id: number
): Instruction {
  return {
    ...template,
    id,
    stage: 'waiting',
    issueAt: -1,
    execStart: -1,
    execEnd: -1,
    writeBackAt: -1,
    commitAt: -1,
    execRemaining: template.latency,
  };
}

function isRegister(name: string): boolean {
  return name.startsWith('R');
}

function instrProducesReg(instructions: Instruction[], reg: string, beforeId: number): Instruction | null {
  // Find the latest instruction before beforeId that writes to reg
  for (let i = beforeId - 1; i >= 0; i--) {
    if (instructions[i].dest === reg && instructions[i].stage !== 'committed') {
      return instructions[i];
    }
  }
  return null;
}

// ──────────────────────────── Component ────────────────────────────

export default function OutOfOrderModule() {
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [cycle, setCycle] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [activeScenario, setActiveScenario] = useState('basic');
  const [rs, setRs] = useState<RSEntry[]>([]);
  const [rob, setRob] = useState<ROBEntry[]>([]);

  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const allDone = instructions.length > 0 && instructions.every((i) => i.stage === 'committed');

  // Initialize
  useEffect(() => {
    loadScenario('basic');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadScenario = useCallback((key: string) => {
    setActiveScenario(key);
    setIsPlaying(false);
    setCycle(0);
    const scenario = SCENARIOS[key];
    if (!scenario) return;
    const instrs = scenario.instructions.map((t, i) => createInstruction(t, i));
    setInstructions(instrs);
    setRs(Array.from({ length: NUM_RS }, () => ({
      busy: false, op: 'ADD', instrId: -1, vj: null, vk: null, qj: null, qk: null, dest: '',
    })));
    setRob([]);
  }, []);

  const stepForward = useCallback(() => {
    if (allDone) {
      setIsPlaying(false);
      return;
    }

    const newCycle = cycle + 1;
    setCycle(newCycle);

    setInstructions((prev) => {
      const instrs = prev.map((i) => ({ ...i }));
      const newRs = rs.map((r) => ({ ...r }));
      const newRob = [...rob.map((r) => ({ ...r }))];

      // Phase 1: Commit (in order)
      for (const instr of instrs) {
        if (instr.stage === 'write-back') {
          // Check if all earlier instructions are committed
          const allEarlierCommitted = instrs
            .filter((i) => i.id < instr.id)
            .every((i) => i.stage === 'committed');
          if (allEarlierCommitted) {
            instr.stage = 'committed';
            instr.commitAt = newCycle;
            // Update ROB
            const robEntry = newRob.find((r) => r.instrId === instr.id);
            if (robEntry) robEntry.committed = true;
          }
        }
      }

      // Phase 2: Write-back (complete execution)
      for (const instr of instrs) {
        if (instr.stage === 'executing' && instr.execRemaining <= 0) {
          instr.stage = 'write-back';
          instr.writeBackAt = newCycle;
          // Free RS
          const rsIdx = newRs.findIndex((r) => r.instrId === instr.id);
          if (rsIdx >= 0) newRs[rsIdx] = { busy: false, op: 'ADD', instrId: -1, vj: null, vk: null, qj: null, qk: null, dest: '' };
          // Update ROB
          const robEntry = newRob.find((r) => r.instrId === instr.id);
          if (robEntry) {
            robEntry.ready = true;
            robEntry.value = Math.floor(Math.random() * 100);
          }
          // Wake up dependent RS entries
          for (const r of newRs) {
            if (r.qj === `RS${newRs.findIndex((x) => x.instrId === instr.id)}` || r.qj === instr.dest) {
              r.qj = null;
              r.vj = Math.floor(Math.random() * 100);
            }
            if (r.qk === `RS${newRs.findIndex((x) => x.instrId === instr.id)}` || r.qk === instr.dest) {
              r.qk = null;
              r.vk = Math.floor(Math.random() * 100);
            }
          }
        }
      }

      // Phase 3: Execute (decrement remaining)
      for (const instr of instrs) {
        if (instr.stage === 'executing' && instr.execRemaining > 0) {
          instr.execRemaining--;
        }
      }

      // Phase 4: Start execution for issued instructions with operands ready
      for (const instr of instrs) {
        if (instr.stage === 'issued') {
          const rsEntry = newRs.find((r) => r.instrId === instr.id);
          if (rsEntry && rsEntry.qj === null && rsEntry.qk === null) {
            instr.stage = 'executing';
            instr.execStart = newCycle;
            instr.execEnd = newCycle + instr.latency - 1;
            instr.execRemaining = instr.latency;
          }
        }
      }

      // Phase 5: Issue (in order, 1 per cycle)
      const nextToIssue = instrs.find((i) => i.stage === 'waiting');
      if (nextToIssue) {
        const freeRS = newRs.findIndex((r) => !r.busy);
        if (freeRS >= 0) {
          nextToIssue.stage = 'issued';
          nextToIssue.issueAt = newCycle;

          // Check operand dependencies
          let qj: string | null = null;
          let qk: string | null = null;
          let vj: number | null = Math.floor(Math.random() * 100);
          let vk: number | null = nextToIssue.src2 ? Math.floor(Math.random() * 100) : null;

          if (isRegister(nextToIssue.src1)) {
            const producer = instrProducesReg(instrs, nextToIssue.src1, nextToIssue.id);
            if (producer && producer.stage !== 'write-back' && producer.stage !== 'committed') {
              qj = producer.dest;
              vj = null;
            }
          }
          if (nextToIssue.src2 && isRegister(nextToIssue.src2)) {
            const producer = instrProducesReg(instrs, nextToIssue.src2, nextToIssue.id);
            if (producer && producer.stage !== 'write-back' && producer.stage !== 'committed') {
              qk = producer.dest;
              vk = null;
            }
          }

          newRs[freeRS] = {
            busy: true,
            op: nextToIssue.op,
            instrId: nextToIssue.id,
            vj,
            vk,
            qj,
            qk,
            dest: nextToIssue.dest,
          };

          // Add to ROB
          newRob.push({
            instrId: nextToIssue.id,
            op: nextToIssue.op,
            dest: nextToIssue.dest,
            value: null,
            ready: false,
            committed: false,
          });
        }
      }

      setRs(newRs);
      setRob(newRob);
      return instrs;
    });
  }, [cycle, rs, rob, allDone]);

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
    if (allDone) setIsPlaying(false);
  }, [allDone]);

  const stageColor = (stage: InstrStage) => {
    switch (stage) {
      case 'waiting': return '#71717a';
      case 'issued': return '#f59e0b';
      case 'executing': return '#06b6d4';
      case 'write-back': return '#8b5cf6';
      case 'committed': return '#10b981';
    }
  };

  const maxCycle = Math.max(cycle, 1);

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
                2.7
              </span>
              <span className="text-xs text-[#71717a]">CPU Architecture</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Out-of-Order Execution{' '}
              <span className="text-[#71717a] font-normal">Visualizer</span>
            </h1>
            <p className="text-sm text-[#a1a1aa] max-w-2xl mt-1">
              Step through Tomasulo&apos;s algorithm with reservation stations and a reorder buffer.
              Watch instructions issue, execute out of order, and commit in order.
            </p>
          </div>

          {/* Scenario Presets */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs text-[#71717a] mr-1 font-medium uppercase tracking-wider">Scenarios:</span>
            {Object.entries(SCENARIOS).map(([key, scenario]) => (
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

          {/* Controls */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => isPlaying ? setIsPlaying(false) : setIsPlaying(true)}
              disabled={allDone}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8b5cf6] text-white text-sm font-medium hover:bg-[#7c3aed] disabled:opacity-40 transition-all"
            >
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
            <div className="flex items-center gap-2 ml-4">
              <Clock size={14} className="text-[#71717a]" />
              <span className="text-sm font-mono text-white font-bold">Cycle {cycle}</span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px] text-[#71717a] uppercase tracking-wider">Speed</span>
              <input type="range" min={0.5} max={4} step={0.5} value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="w-24 accent-[#8b5cf6]" />
              <span className="text-xs font-mono text-[#a1a1aa] w-8">{speed}x</span>
            </div>
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
            <div className="space-y-6">
              {/* Instruction Table */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <Cpu size={14} className="text-[#8b5cf6]" />
                  Instruction Pipeline
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">#</th>
                        <th className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">Instruction</th>
                        <th className="text-center text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">Issue</th>
                        <th className="text-center text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">Exec Start</th>
                        <th className="text-center text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">Exec End</th>
                        <th className="text-center text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">WB</th>
                        <th className="text-center text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">Commit</th>
                        <th className="text-center text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2">Stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {instructions.map((instr) => (
                        <motion.tr
                          key={instr.id}
                          animate={{ backgroundColor: instr.stage === 'executing' ? 'rgba(6, 182, 212, 0.05)' : 'rgba(0,0,0,0)' }}
                          className="border-t border-[#1e1e2e]/40"
                        >
                          <td className="py-2 pr-3 font-mono text-[#71717a]">{instr.id + 1}</td>
                          <td className="py-2 pr-3">
                            <span className="font-mono">
                              <span className="font-bold" style={{ color: OP_COLORS[instr.op] }}>{instr.op}</span>
                              {' '}<span className="text-white">{instr.dest}</span>
                              {' '}<span className="text-[#71717a]">&larr;</span>
                              {' '}<span className="text-[#a1a1aa]">{instr.src1}</span>
                              {instr.src2 && <span className="text-[#a1a1aa]">, {instr.src2}</span>}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-center font-mono text-[#a1a1aa]">
                            {instr.issueAt >= 0 ? instr.issueAt : '-'}
                          </td>
                          <td className="py-2 pr-3 text-center font-mono text-[#a1a1aa]">
                            {instr.execStart >= 0 ? instr.execStart : '-'}
                          </td>
                          <td className="py-2 pr-3 text-center font-mono text-[#a1a1aa]">
                            {instr.execEnd >= 0 ? instr.execEnd : '-'}
                          </td>
                          <td className="py-2 pr-3 text-center font-mono text-[#a1a1aa]">
                            {instr.writeBackAt >= 0 ? instr.writeBackAt : '-'}
                          </td>
                          <td className="py-2 pr-3 text-center font-mono text-[#a1a1aa]">
                            {instr.commitAt >= 0 ? instr.commitAt : '-'}
                          </td>
                          <td className="py-2 text-center">
                            <span
                              className="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                              style={{ color: stageColor(instr.stage), backgroundColor: `${stageColor(instr.stage)}15` }}
                            >
                              {instr.stage.toUpperCase()}
                            </span>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Timing Diagram */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <BarChart3 size={14} className="text-[#06b6d4]" />
                  Execution Timeline
                </h3>
                <div className="overflow-x-auto">
                  <div className="min-w-[600px]">
                    {/* Cycle headers */}
                    <div className="flex items-center mb-2">
                      <div className="w-32 shrink-0 text-[9px] text-[#71717a] font-mono">Instruction</div>
                      <div className="flex-1 flex">
                        {Array.from({ length: maxCycle + 2 }, (_, i) => (
                          <div
                            key={i}
                            className={`flex-1 min-w-[28px] text-center text-[9px] font-mono ${
                              i + 1 === cycle ? 'text-[#8b5cf6] font-bold' : 'text-[#71717a]'
                            }`}
                          >
                            {i + 1}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Instruction timelines */}
                    {instructions.map((instr) => (
                      <div key={instr.id} className="flex items-center mb-1">
                        <div className="w-32 shrink-0 text-[10px] font-mono truncate">
                          <span style={{ color: OP_COLORS[instr.op] }}>{instr.op}</span>
                          {' '}<span className="text-[#a1a1aa]">{instr.dest}</span>
                        </div>
                        <div className="flex-1 flex">
                          {Array.from({ length: maxCycle + 2 }, (_, i) => {
                            const c = i + 1;
                            let color = 'transparent';
                            let label = '';

                            if (c === instr.issueAt) {
                              color = '#f59e0b';
                              label = 'IS';
                            } else if (c >= instr.execStart && c <= instr.execEnd && instr.execStart > 0) {
                              color = '#06b6d4';
                              label = 'EX';
                            } else if (c === instr.writeBackAt) {
                              color = '#8b5cf6';
                              label = 'WB';
                            } else if (c === instr.commitAt) {
                              color = '#10b981';
                              label = 'CM';
                            }

                            return (
                              <div
                                key={i}
                                className="flex-1 min-w-[28px] h-6 flex items-center justify-center rounded-sm mx-[1px]"
                                style={{ backgroundColor: color !== 'transparent' ? `${color}30` : 'transparent' }}
                              >
                                {label && (
                                  <span className="text-[8px] font-mono font-bold" style={{ color }}>
                                    {label}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    {/* Legend */}
                    <div className="flex gap-4 mt-3 pt-2 border-t border-[#1e1e2e]">
                      {[
                        { label: 'Issue', color: '#f59e0b' },
                        { label: 'Execute', color: '#06b6d4' },
                        { label: 'Write-Back', color: '#8b5cf6' },
                        { label: 'Commit', color: '#10b981' },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center gap-1.5 text-[9px] text-[#71717a]">
                          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: `${item.color}30` }} />
                          {item.label}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Sidebar */}
            <div className="space-y-4">
              {/* Reservation Stations */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Layers size={14} className="text-[#f59e0b]" />
                  Reservation Stations
                </h3>
                <div className="space-y-1.5">
                  {rs.map((entry, idx) => (
                    <motion.div
                      key={idx}
                      animate={{
                        borderColor: entry.busy ? '#f59e0b30' : '#1e1e2e',
                        backgroundColor: entry.busy ? 'rgba(245, 158, 11, 0.03)' : 'rgba(15,15,23,0.5)',
                      }}
                      className="p-2 rounded-lg border text-[10px] font-mono"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[#71717a]">RS{idx}</span>
                        {entry.busy ? (
                          <span style={{ color: OP_COLORS[entry.op] }} className="font-bold">
                            {entry.op} → {entry.dest}
                          </span>
                        ) : (
                          <span className="text-[#71717a]/40">empty</span>
                        )}
                      </div>
                      {entry.busy && (
                        <div className="mt-1 flex gap-3 text-[9px]">
                          <span className={entry.qj ? 'text-[#ef4444]' : 'text-[#10b981]'}>
                            Vj:{entry.vj ?? '?'} {entry.qj && `(wait ${entry.qj})`}
                          </span>
                          {entry.qk !== undefined && (
                            <span className={entry.qk ? 'text-[#ef4444]' : 'text-[#10b981]'}>
                              Vk:{entry.vk ?? '?'} {entry.qk && `(wait ${entry.qk})`}
                            </span>
                          )}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Reorder Buffer */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Zap size={14} className="text-[#8b5cf6]" />
                  Reorder Buffer
                </h3>
                {rob.length === 0 ? (
                  <p className="text-xs text-[#71717a] italic">Empty — no instructions issued yet.</p>
                ) : (
                  <div className="space-y-1">
                    {rob.map((entry, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-[10px] font-mono ${
                          entry.committed
                            ? 'border-[#10b981]/20 bg-[#10b981]/5'
                            : entry.ready
                            ? 'border-[#8b5cf6]/20 bg-[#8b5cf6]/5'
                            : 'border-[#1e1e2e] bg-[#0f0f17]'
                        }`}
                      >
                        <span className="text-[#71717a] w-8">#{entry.instrId + 1}</span>
                        <span style={{ color: OP_COLORS[entry.op] }} className="font-bold">{entry.op}</span>
                        <span className="text-white">{entry.dest}</span>
                        <span className="ml-auto">
                          {entry.committed ? (
                            <CheckCircle size={12} className="text-[#10b981]" />
                          ) : entry.ready ? (
                            <span className="text-[#8b5cf6]">= {entry.value}</span>
                          ) : (
                            <span className="text-[#71717a]/40">pending</span>
                          )}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-4 rounded-xl bg-[#0f0f17] border border-[#1e1e2e]/50">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-[#8b5cf6] mt-0.5 shrink-0" />
                  <div className="text-[11px] text-[#71717a] leading-relaxed">
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Issue:</strong> Instructions enter reservation stations in order.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Execute:</strong> Instructions begin when operands are ready — out of program order.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">Write-Back:</strong> Results broadcast to waiting stations via CDB.
                    </p>
                    <p>
                      <strong className="text-[#a1a1aa]">Commit:</strong> Instructions retire from ROB in program order for precise exceptions.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Completion */}
          <AnimatePresence>
            {allDone && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-4 rounded-xl bg-[#10b981]/10 border border-[#10b981]/20 flex items-center gap-3"
              >
                <div className="w-2 h-2 rounded-full bg-[#10b981]" />
                <span className="text-sm text-[#10b981] font-medium">
                  All {instructions.length} instructions committed in {cycle} cycles
                  (IPC: {(instructions.length / cycle).toFixed(2)})
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
