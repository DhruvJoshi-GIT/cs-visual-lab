'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu,
  ChevronDown,
  Info,
  ArrowRight,
  Zap,
  Database,
  MemoryStick,
  Binary,
  CircuitBoard,
  BookOpen,
  Hash,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import ModuleControls from '@/components/ui/ModuleControls';

// ──────────────────────────── Types ────────────────────────────

type MIPSOp = 'ADD' | 'SUB' | 'AND' | 'OR' | 'LW' | 'SW' | 'BEQ' | 'SLT';

interface InstructionDef {
  op: MIPSOp;
  assembly: string;
  format: 'R' | 'I';
  rs: string;
  rt: string;
  rd: string;
  imm: number;
  description: string;
}

interface ControlSignals {
  RegDst: number;
  ALUSrc: number;
  MemToReg: number;
  RegWrite: number;
  MemRead: number;
  MemWrite: number;
  Branch: number;
  ALUOp: [number, number];
}

type DatapathPhase = 'idle' | 'fetch' | 'decode' | 'execute' | 'memory' | 'writeback' | 'complete';

interface ComponentDef {
  id: string;
  label: string;
  shortLabel: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  description: string;
}

interface WireDef {
  id: string;
  from: string;
  to: string;
  label: string;
  path: [number, number][];
  phases: DatapathPhase[];
  color: string;
  dataLabel?: string;
}

interface RegisterFile {
  [key: string]: number;
}

interface DataMemory {
  [address: number]: number;
}

// ──────────────────────────── Constants ────────────────────────────

const PHASE_NAMES: Record<DatapathPhase, string> = {
  idle: 'Ready',
  fetch: '1. Instruction Fetch',
  decode: '2. Decode / Register Read',
  execute: '3. Execute / ALU',
  memory: '4. Memory Access',
  writeback: '5. Write Back',
  complete: 'Complete',
};

const PHASE_COLORS: Record<DatapathPhase, string> = {
  idle: '#71717a',
  fetch: '#6366f1',
  decode: '#06b6d4',
  execute: '#f59e0b',
  memory: '#10b981',
  writeback: '#ec4899',
  complete: '#10b981',
};

const ACTIVE_WIRE_COLOR = '#10b981';
const INACTIVE_WIRE_COLOR = '#2a2a3e';
const HIGHLIGHT_BORDER_COLOR = '#10b981';

// Datapath component positions (SVG coordinates)
const COMPONENTS: ComponentDef[] = [
  { id: 'pc', label: 'Program Counter', shortLabel: 'PC', x: 30, y: 180, width: 60, height: 70, color: '#6366f1', description: 'Holds address of current instruction' },
  { id: 'imem', label: 'Instruction Memory', shortLabel: 'Instr\nMem', x: 130, y: 155, width: 80, height: 120, color: '#6366f1', description: 'Stores the program instructions' },
  { id: 'control', label: 'Control Unit', shortLabel: 'Control', x: 260, y: 50, width: 80, height: 80, color: '#a855f7', description: 'Generates control signals from opcode' },
  { id: 'regfile', label: 'Register File', shortLabel: 'Reg\nFile', x: 280, y: 175, width: 80, height: 120, color: '#06b6d4', description: 'Contains 32 general-purpose registers' },
  { id: 'signext', label: 'Sign Extend', shortLabel: 'Sign\nExt', x: 290, y: 340, width: 70, height: 50, color: '#f59e0b', description: 'Sign-extends 16-bit immediate to 32 bits' },
  { id: 'mux_alusrc', label: 'ALU Src MUX', shortLabel: 'MUX', x: 410, y: 250, width: 30, height: 60, color: '#71717a', description: 'Selects ALU second input: register or immediate' },
  { id: 'alu', label: 'ALU', shortLabel: 'ALU', x: 470, y: 190, width: 70, height: 100, color: '#f59e0b', description: 'Performs arithmetic/logic operations' },
  { id: 'dmem', label: 'Data Memory', shortLabel: 'Data\nMem', x: 580, y: 175, width: 80, height: 120, color: '#10b981', description: 'Stores and loads data words' },
  { id: 'mux_memtoreg', label: 'MemToReg MUX', shortLabel: 'MUX', x: 700, y: 210, width: 30, height: 60, color: '#71717a', description: 'Selects write data: ALU result or memory data' },
  { id: 'mux_regdst', label: 'RegDst MUX', shortLabel: 'MUX', x: 240, y: 305, width: 30, height: 40, color: '#71717a', description: 'Selects destination register: rt or rd' },
  { id: 'add_pc4', label: 'PC + 4 Adder', shortLabel: 'Add\n+4', x: 130, y: 50, width: 55, height: 45, color: '#6366f1', description: 'Computes PC + 4 for next sequential instruction' },
  { id: 'add_branch', label: 'Branch Adder', shortLabel: 'Branch\nAdd', x: 420, y: 50, width: 60, height: 45, color: '#ec4899', description: 'Computes branch target: PC+4 + offset*4' },
  { id: 'mux_branch', label: 'Branch MUX', shortLabel: 'MUX', x: 520, y: 55, width: 30, height: 40, color: '#71717a', description: 'Selects next PC: PC+4 or branch target' },
  { id: 'and_branch', label: 'AND Gate', shortLabel: 'AND', x: 500, y: 115, width: 40, height: 30, color: '#ec4899', description: 'Branch taken = Branch signal AND ALU Zero' },
];

// Generate control signals for each instruction type
function getControlSignals(op: MIPSOp): ControlSignals {
  switch (op) {
    case 'ADD': case 'SUB': case 'AND': case 'OR': case 'SLT':
      return { RegDst: 1, ALUSrc: 0, MemToReg: 0, RegWrite: 1, MemRead: 0, MemWrite: 0, Branch: 0, ALUOp: [1, 0] };
    case 'LW':
      return { RegDst: 0, ALUSrc: 1, MemToReg: 1, RegWrite: 1, MemRead: 1, MemWrite: 0, Branch: 0, ALUOp: [0, 0] };
    case 'SW':
      return { RegDst: 0, ALUSrc: 1, MemToReg: 0, RegWrite: 0, MemRead: 0, MemWrite: 1, Branch: 0, ALUOp: [0, 0] };
    case 'BEQ':
      return { RegDst: 0, ALUSrc: 0, MemToReg: 0, RegWrite: 0, MemRead: 0, MemWrite: 0, Branch: 1, ALUOp: [0, 1] };
    default:
      return { RegDst: 0, ALUSrc: 0, MemToReg: 0, RegWrite: 0, MemRead: 0, MemWrite: 0, Branch: 0, ALUOp: [0, 0] };
  }
}

function getALUOperation(op: MIPSOp): string {
  switch (op) {
    case 'ADD': case 'LW': case 'SW': return 'ADD';
    case 'SUB': case 'BEQ': return 'SUB';
    case 'AND': return 'AND';
    case 'OR': return 'OR';
    case 'SLT': return 'SLT';
    default: return 'ADD';
  }
}

function computeALU(aluOp: string, a: number, b: number): { result: number; zero: boolean } {
  let result = 0;
  switch (aluOp) {
    case 'ADD': result = a + b; break;
    case 'SUB': result = a - b; break;
    case 'AND': result = a & b; break;
    case 'OR': result = a | b; break;
    case 'SLT': result = a < b ? 1 : 0; break;
  }
  return { result, zero: result === 0 };
}

// ──────────────────────────── Wire Definitions ────────────────────────────

function buildWires(): WireDef[] {
  return [
    // Fetch phase wires
    { id: 'pc-to-imem', from: 'pc', to: 'imem', label: 'PC Address', path: [[90, 215], [130, 215]], phases: ['fetch'], color: '#6366f1' },
    { id: 'pc-to-add4', from: 'pc', to: 'add_pc4', label: 'PC', path: [[60, 180], [60, 72], [130, 72]], phases: ['fetch'], color: '#6366f1' },
    { id: 'imem-out', from: 'imem', to: 'control', label: 'Instruction[31:0]', path: [[210, 215], [230, 215], [230, 90], [260, 90]], phases: ['fetch', 'decode'], color: '#6366f1' },

    // Decode phase wires
    { id: 'imem-to-regfile-rs', from: 'imem', to: 'regfile', label: 'rs [25:21]', path: [[210, 200], [280, 200]], phases: ['decode'], color: '#6366f1' },
    { id: 'imem-to-regfile-rt', from: 'imem', to: 'regfile', label: 'rt [20:16]', path: [[210, 230], [280, 230]], phases: ['decode'], color: '#06b6d4' },
    { id: 'imem-to-signext', from: 'imem', to: 'signext', label: 'imm [15:0]', path: [[210, 260], [250, 260], [250, 365], [290, 365]], phases: ['decode'], color: '#f59e0b' },
    { id: 'imem-to-mux-rd', from: 'imem', to: 'mux_regdst', label: 'rd [15:11]', path: [[210, 245], [235, 245], [235, 325], [240, 325]], phases: ['decode'], color: '#10b981' },
    { id: 'imem-to-mux-rt2', from: 'imem', to: 'mux_regdst', label: 'rt [20:16]', path: [[210, 255], [225, 255], [225, 315], [240, 315]], phases: ['decode'], color: '#06b6d4' },

    // Register file outputs
    { id: 'regfile-rd1', from: 'regfile', to: 'alu', label: 'Read Data 1', path: [[360, 210], [470, 210]], phases: ['execute'], color: '#06b6d4' },
    { id: 'regfile-rd2-alu', from: 'regfile', to: 'mux_alusrc', label: 'Read Data 2', path: [[360, 250], [410, 260]], phases: ['execute'], color: '#06b6d4' },
    { id: 'regfile-rd2-dmem', from: 'regfile', to: 'dmem', label: 'Write Data', path: [[360, 270], [390, 270], [390, 310], [570, 310], [570, 270], [580, 270]], phases: ['memory'], color: '#06b6d4' },

    // Sign extend to MUX
    { id: 'signext-to-mux', from: 'signext', to: 'mux_alusrc', label: 'Sign-Extended', path: [[360, 365], [425, 365], [425, 310]], phases: ['execute'], color: '#f59e0b' },
    { id: 'signext-to-branchadd', from: 'signext', to: 'add_branch', label: 'Offset <<2', path: [[360, 350], [400, 350], [400, 85], [420, 85]], phases: ['execute'], color: '#f59e0b' },

    // ALU MUX to ALU
    { id: 'mux-to-alu', from: 'mux_alusrc', to: 'alu', label: 'ALU Input B', path: [[440, 280], [455, 280], [455, 260], [470, 260]], phases: ['execute'], color: '#f59e0b' },

    // ALU outputs
    { id: 'alu-result', from: 'alu', to: 'dmem', label: 'ALU Result', path: [[540, 230], [580, 230]], phases: ['execute', 'memory'], color: '#f59e0b' },
    { id: 'alu-result-to-mux', from: 'alu', to: 'mux_memtoreg', label: 'ALU Result', path: [[540, 250], [560, 250], [560, 225], [700, 225]], phases: ['writeback'], color: '#f59e0b' },
    { id: 'alu-zero', from: 'alu', to: 'and_branch', label: 'Zero', path: [[540, 210], [555, 210], [555, 135], [520, 135]], phases: ['execute'], color: '#f59e0b' },

    // Data Memory output
    { id: 'dmem-to-mux', from: 'dmem', to: 'mux_memtoreg', label: 'Read Data', path: [[660, 245], [700, 245]], phases: ['memory', 'writeback'], color: '#10b981' },

    // MemToReg MUX output (write back to register file)
    { id: 'mux-memtoreg-out', from: 'mux_memtoreg', to: 'regfile', label: 'Write Data', path: [[730, 240], [750, 240], [750, 400], [320, 400], [320, 295]], phases: ['writeback'], color: '#ec4899' },

    // RegDst MUX output
    { id: 'mux-regdst-out', from: 'mux_regdst', to: 'regfile', label: 'Write Reg', path: [[270, 325], [275, 325], [275, 295]], phases: ['decode', 'writeback'], color: '#10b981' },

    // PC+4 adder output
    { id: 'add4-to-branchmux', from: 'add_pc4', to: 'mux_branch', label: 'PC + 4', path: [[185, 72], [520, 62]], phases: ['fetch'], color: '#6366f1' },
    { id: 'add4-to-branchadd', from: 'add_pc4', to: 'add_branch', label: 'PC + 4', path: [[185, 65], [420, 65]], phases: ['execute'], color: '#6366f1' },

    // Branch adder output
    { id: 'branchadd-to-mux', from: 'add_branch', to: 'mux_branch', label: 'Branch Target', path: [[480, 72], [520, 82]], phases: ['execute'], color: '#ec4899' },

    // Branch MUX output to PC
    { id: 'branchmux-to-pc', from: 'mux_branch', to: 'pc', label: 'Next PC', path: [[550, 75], [560, 75], [560, 25], [20, 25], [20, 215], [30, 215]], phases: ['fetch', 'writeback'], color: '#6366f1' },

    // AND gate wires
    { id: 'branch-to-and', from: 'control', to: 'and_branch', label: 'Branch', path: [[340, 80], [510, 80], [510, 115]], phases: ['execute'], color: '#a855f7' },

    // Control signal wires (simplified)
    { id: 'ctrl-regdst', from: 'control', to: 'mux_regdst', label: 'RegDst', path: [[260, 100], [255, 100], [255, 305]], phases: ['decode'], color: '#a855f7' },
    { id: 'ctrl-alusrc', from: 'control', to: 'mux_alusrc', label: 'ALUSrc', path: [[340, 65], [405, 65], [405, 245], [410, 250]], phases: ['execute'], color: '#a855f7' },
    { id: 'ctrl-memtoreg', from: 'control', to: 'mux_memtoreg', label: 'MemToReg', path: [[340, 75], [690, 75], [690, 210]], phases: ['writeback'], color: '#a855f7' },
    { id: 'ctrl-regwrite', from: 'control', to: 'regfile', label: 'RegWrite', path: [[340, 85], [365, 85], [365, 175]], phases: ['writeback'], color: '#a855f7' },
    { id: 'ctrl-memread', from: 'control', to: 'dmem', label: 'MemRead', path: [[340, 55], [620, 55], [620, 175]], phases: ['memory'], color: '#a855f7' },
    { id: 'ctrl-memwrite', from: 'control', to: 'dmem', label: 'MemWrite', path: [[340, 60], [610, 60], [610, 175]], phases: ['memory'], color: '#a855f7' },
  ];
}

const WIRES = buildWires();

// ──────────────────────────── Preset Scenarios ────────────────────────────

interface ProgramScenario {
  label: string;
  desc: string;
  instructions: InstructionDef[];
  registers: RegisterFile;
  memory: DataMemory;
}

const PRESET_SCENARIOS: Record<string, ProgramScenario> = {
  r_type_add: {
    label: 'R-Type (ADD)',
    desc: 'ADD $t2, $t0, $t1 - adds two registers',
    instructions: [
      { op: 'ADD', assembly: 'ADD $t2, $t0, $t1', format: 'R', rs: '$t0', rt: '$t1', rd: '$t2', imm: 0, description: '$t2 = $t0 + $t1' },
      { op: 'SUB', assembly: 'SUB $t3, $t2, $t0', format: 'R', rs: '$t2', rt: '$t0', rd: '$t3', imm: 0, description: '$t3 = $t2 - $t0' },
      { op: 'AND', assembly: 'AND $t4, $t0, $t1', format: 'R', rs: '$t0', rt: '$t1', rd: '$t4', imm: 0, description: '$t4 = $t0 & $t1' },
      { op: 'OR', assembly: 'OR $t5, $t0, $t1', format: 'R', rs: '$t0', rt: '$t1', rd: '$t5', imm: 0, description: '$t5 = $t0 | $t1' },
    ],
    registers: { '$t0': 5, '$t1': 3, '$t2': 0, '$t3': 0, '$t4': 0, '$t5': 0 },
    memory: {},
  },
  load_word: {
    label: 'Load Word',
    desc: 'LW $t0, 0($t1) - loads from memory into register',
    instructions: [
      { op: 'LW', assembly: 'LW $t0, 0($t1)', format: 'I', rs: '$t1', rt: '$t0', rd: '', imm: 0, description: '$t0 = Memory[$t1 + 0]' },
      { op: 'LW', assembly: 'LW $t2, 4($t1)', format: 'I', rs: '$t1', rt: '$t2', rd: '', imm: 4, description: '$t2 = Memory[$t1 + 4]' },
      { op: 'ADD', assembly: 'ADD $t3, $t0, $t2', format: 'R', rs: '$t0', rt: '$t2', rd: '$t3', imm: 0, description: '$t3 = $t0 + $t2' },
      { op: 'SW', assembly: 'SW $t3, 8($t1)', format: 'I', rs: '$t1', rt: '$t3', rd: '', imm: 8, description: 'Memory[$t1 + 8] = $t3' },
    ],
    registers: { '$t0': 0, '$t1': 100, '$t2': 0, '$t3': 0 },
    memory: { 100: 42, 104: 18, 108: 0 },
  },
  store_word: {
    label: 'Store Word',
    desc: 'SW $t0, 0($t1) - stores register value into memory',
    instructions: [
      { op: 'ADD', assembly: 'ADD $t0, $t1, $t2', format: 'R', rs: '$t1', rt: '$t2', rd: '$t0', imm: 0, description: '$t0 = $t1 + $t2' },
      { op: 'SW', assembly: 'SW $t0, 0($t3)', format: 'I', rs: '$t3', rt: '$t0', rd: '', imm: 0, description: 'Memory[$t3 + 0] = $t0' },
      { op: 'SW', assembly: 'SW $t1, 4($t3)', format: 'I', rs: '$t3', rt: '$t1', rd: '', imm: 4, description: 'Memory[$t3 + 4] = $t1' },
      { op: 'LW', assembly: 'LW $t4, 0($t3)', format: 'I', rs: '$t3', rt: '$t4', rd: '', imm: 0, description: '$t4 = Memory[$t3 + 0]' },
    ],
    registers: { '$t0': 0, '$t1': 7, '$t2': 13, '$t3': 200, '$t4': 0 },
    memory: { 200: 0, 204: 0 },
  },
  branch: {
    label: 'Branch (BEQ)',
    desc: 'BEQ $t0, $t1, 2 - branches if registers are equal',
    instructions: [
      { op: 'ADD', assembly: 'ADD $t0, $t1, $t2', format: 'R', rs: '$t1', rt: '$t2', rd: '$t0', imm: 0, description: '$t0 = $t1 + $t2' },
      { op: 'BEQ', assembly: 'BEQ $t0, $t3, 2', format: 'I', rs: '$t0', rt: '$t3', rd: '', imm: 2, description: 'if ($t0 == $t3) PC += 2*4' },
      { op: 'SUB', assembly: 'SUB $t4, $t0, $t1', format: 'R', rs: '$t0', rt: '$t1', rd: '$t4', imm: 0, description: '$t4 = $t0 - $t1' },
      { op: 'SLT', assembly: 'SLT $t5, $t0, $t1', format: 'R', rs: '$t0', rt: '$t1', rd: '$t5', imm: 0, description: '$t5 = ($t0 < $t1) ? 1 : 0' },
    ],
    registers: { '$t0': 0, '$t1': 5, '$t2': 3, '$t3': 8, '$t4': 0, '$t5': 0 },
    memory: {},
  },
};

// ──────────────────────────── Helpers ────────────────────────────

function getActiveComponents(phase: DatapathPhase, op: MIPSOp): Set<string> {
  const active = new Set<string>();
  switch (phase) {
    case 'fetch':
      active.add('pc'); active.add('imem'); active.add('add_pc4'); active.add('mux_branch');
      break;
    case 'decode':
      active.add('imem'); active.add('control'); active.add('regfile'); active.add('signext'); active.add('mux_regdst');
      break;
    case 'execute':
      active.add('alu'); active.add('mux_alusrc'); active.add('and_branch'); active.add('add_branch');
      if (op === 'BEQ') active.add('mux_branch');
      break;
    case 'memory':
      if (op === 'LW' || op === 'SW') active.add('dmem');
      if (op === 'SW') active.add('regfile');
      break;
    case 'writeback':
      if (op !== 'SW' && op !== 'BEQ') { active.add('mux_memtoreg'); active.add('regfile'); }
      break;
  }
  return active;
}

function getActiveWires(phase: DatapathPhase, op: MIPSOp): Set<string> {
  const active = new Set<string>();
  const ctrl = getControlSignals(op);

  for (const wire of WIRES) {
    if (wire.phases.includes(phase)) {
      // Filter out wires not relevant to current instruction
      if (phase === 'memory') {
        if (wire.id === 'ctrl-memread' && ctrl.MemRead === 0) continue;
        if (wire.id === 'ctrl-memwrite' && ctrl.MemWrite === 0) continue;
        if (wire.id === 'dmem-to-mux' && ctrl.MemRead === 0) continue;
        if (wire.id === 'regfile-rd2-dmem' && ctrl.MemWrite === 0) continue;
      }
      if (phase === 'writeback') {
        if ((wire.id === 'mux-memtoreg-out' || wire.id === 'ctrl-regwrite' || wire.id === 'ctrl-memtoreg') && ctrl.RegWrite === 0) continue;
      }
      if (phase === 'execute') {
        if ((wire.id === 'branch-to-and' || wire.id === 'branchadd-to-mux') && ctrl.Branch === 0) continue;
      }
      active.add(wire.id);
    }
  }
  return active;
}

// ──────────────────────────── Main Component ────────────────────────────

export default function SingleCycleModule() {
  // ── State ──
  const [program, setProgram] = useState<InstructionDef[]>([]);
  const [pc, setPc] = useState(0);
  const [registers, setRegisters] = useState<RegisterFile>({});
  const [dataMemory, setDataMemory] = useState<DataMemory>({});
  const [phase, setPhase] = useState<DatapathPhase>('idle');
  const [currentInstrIndex, setCurrentInstrIndex] = useState(0);
  const [aluResult, setAluResult] = useState(0);
  const [aluZero, setAluZero] = useState(false);
  const [controlSignals, setControlSignals] = useState<ControlSignals | null>(null);
  const [instructionsCompleted, setInstructionsCompleted] = useState(0);
  const [allComplete, setAllComplete] = useState(false);
  const [phaseLog, setPhaseLog] = useState<string[]>([]);

  // ── UI State ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [selectedScenario, setSelectedScenario] = useState('r_type_add');
  const [showEducation, setShowEducation] = useState(true);

  // ── Refs ──
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // ── Auto-scroll log ──
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [phaseLog]);

  // ── Derived ──
  const currentInstr = program[currentInstrIndex] ?? null;
  const activeComponents = currentInstr ? getActiveComponents(phase, currentInstr.op) : new Set<string>();
  const activeWires = currentInstr ? getActiveWires(phase, currentInstr.op) : new Set<string>();

  // ── Step Logic ──
  const stepForward = useCallback(() => {
    if (allComplete) {
      setIsPlaying(false);
      return;
    }
    if (program.length === 0) return;

    const instr = program[currentInstrIndex];
    if (!instr) {
      setAllComplete(true);
      setIsPlaying(false);
      return;
    }

    const ctrl = getControlSignals(instr.op);

    switch (phase) {
      case 'idle':
      case 'complete': {
        if (phase === 'complete') {
          // Move to next instruction
          if (currentInstrIndex >= program.length - 1) {
            setAllComplete(true);
            setIsPlaying(false);
            return;
          }
          setCurrentInstrIndex(prev => prev + 1);
        }
        // Start fetch
        setPhase('fetch');
        setControlSignals(null);
        setAluResult(0);
        setAluZero(false);
        setPhaseLog(prev => [...prev, `--- Instruction ${currentInstrIndex + (phase === 'complete' ? 2 : 1)}: ${phase === 'complete' ? program[currentInstrIndex + 1]?.assembly : instr.assembly} ---`]);
        setPhaseLog(prev => [...prev, `FETCH: Reading instruction at PC = ${pc}`]);
        break;
      }

      case 'fetch': {
        setPhase('decode');
        setControlSignals(ctrl);
        setPhaseLog(prev => [...prev, `DECODE: Instruction = ${instr.assembly}, Format = ${instr.format}-type`]);
        setPhaseLog(prev => [...prev, `CONTROL: RegDst=${ctrl.RegDst} ALUSrc=${ctrl.ALUSrc} MemToReg=${ctrl.MemToReg} RegWrite=${ctrl.RegWrite} MemRead=${ctrl.MemRead} MemWrite=${ctrl.MemWrite} Branch=${ctrl.Branch}`]);
        if (instr.format === 'R') {
          setPhaseLog(prev => [...prev, `READ REGS: ${instr.rs} = ${registers[instr.rs] ?? 0}, ${instr.rt} = ${registers[instr.rt] ?? 0}`]);
        } else if (instr.op === 'BEQ') {
          setPhaseLog(prev => [...prev, `READ REGS: ${instr.rs} = ${registers[instr.rs] ?? 0}, ${instr.rt} = ${registers[instr.rt] ?? 0}, imm = ${instr.imm}`]);
        } else {
          setPhaseLog(prev => [...prev, `READ REGS: ${instr.rs} = ${registers[instr.rs] ?? 0}, imm = ${instr.imm}`]);
        }
        break;
      }

      case 'decode': {
        setPhase('execute');
        const aVal = registers[instr.rs] ?? 0;
        const bVal = ctrl.ALUSrc === 1 ? instr.imm : (registers[instr.rt] ?? 0);
        const aluOp = getALUOperation(instr.op);
        const { result, zero } = computeALU(aluOp, aVal, bVal);
        setAluResult(result);
        setAluZero(zero);
        setPhaseLog(prev => [...prev, `EXECUTE: ALU ${aluOp}(${aVal}, ${bVal}) = ${result}, Zero = ${zero}`]);
        if (instr.op === 'BEQ') {
          setPhaseLog(prev => [...prev, `BRANCH: ${zero ? 'TAKEN' : 'NOT TAKEN'} (${instr.rs}=${aVal} ${zero ? '==' : '!='} ${instr.rt}=${registers[instr.rt] ?? 0})`]);
        }
        break;
      }

      case 'execute': {
        setPhase('memory');
        if (instr.op === 'LW') {
          const addr = aluResult;
          const value = dataMemory[addr] ?? 0;
          setPhaseLog(prev => [...prev, `MEMORY: Load from address ${addr}, value = ${value}`]);
        } else if (instr.op === 'SW') {
          const addr = aluResult;
          const value = registers[instr.rt] ?? 0;
          setDataMemory(prev => ({ ...prev, [addr]: value }));
          setPhaseLog(prev => [...prev, `MEMORY: Store ${value} to address ${addr}`]);
        } else {
          setPhaseLog(prev => [...prev, `MEMORY: No memory operation (pass-through)`]);
        }
        break;
      }

      case 'memory': {
        setPhase('writeback');
        if (ctrl.RegWrite === 1) {
          let writeData = aluResult;
          if (ctrl.MemToReg === 1) {
            // LW: write data from memory
            writeData = dataMemory[aluResult] ?? 0;
          }
          const destReg = instr.format === 'R' ? instr.rd : instr.rt;
          setRegisters(prev => ({ ...prev, [destReg]: writeData }));
          setPhaseLog(prev => [...prev, `WRITEBACK: ${destReg} = ${writeData}`]);
        } else {
          setPhaseLog(prev => [...prev, `WRITEBACK: No register write`]);
        }

        // Update PC
        const newPc = pc + 4;
        if (instr.op === 'BEQ' && aluZero) {
          const branchPc = newPc + instr.imm * 4;
          setPc(branchPc);
          setPhaseLog(prev => [...prev, `PC: Branch taken, PC = ${branchPc}`]);
        } else {
          setPc(newPc);
        }

        setInstructionsCompleted(prev => prev + 1);
        setPhase('complete');
        break;
      }

      default:
        break;
    }
  }, [phase, program, currentInstrIndex, pc, registers, dataMemory, aluResult, aluZero, allComplete]);

  // ── Animation Loop ──
  const animationLoop = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) return;
    const interval = Math.max(10, 600 / speedRef.current);
    if (timestamp - lastTickRef.current >= interval) {
      lastTickRef.current = timestamp;
      stepForward();
    }
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [stepForward]);

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

  // ── Handlers ──
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleStep = useCallback(() => {
    setIsPlaying(false);
    stepForward();
  }, [stepForward]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    setPc(0);
    setPhase('idle');
    setCurrentInstrIndex(0);
    setAluResult(0);
    setAluZero(false);
    setControlSignals(null);
    setInstructionsCompleted(0);
    setAllComplete(false);
    setPhaseLog([]);
  }, []);

  const loadScenario = useCallback((key: string) => {
    handleReset();
    const scenario = PRESET_SCENARIOS[key];
    if (!scenario) return;
    setSelectedScenario(key);
    setProgram(scenario.instructions);
    setRegisters({ ...scenario.registers });
    setDataMemory({ ...scenario.memory });
  }, [handleReset]);

  // ── Load default on mount ──
  useEffect(() => {
    loadScenario('r_type_add');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── SVG Datapath Rendering ──
  const renderDatapath = () => {
    const svgWidth = 780;
    const svgHeight = 430;

    return (
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full h-auto"
        style={{ minHeight: 300 }}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="6"
            markerHeight="4"
            refX="6"
            refY="2"
            orient="auto"
          >
            <polygon points="0 0, 6 2, 0 4" fill={ACTIVE_WIRE_COLOR} />
          </marker>
          <marker
            id="arrowhead-inactive"
            markerWidth="6"
            markerHeight="4"
            refX="6"
            refY="2"
            orient="auto"
          >
            <polygon points="0 0, 6 2, 0 4" fill={INACTIVE_WIRE_COLOR} />
          </marker>
          {/* Glow filter */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background grid */}
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1e1e2e" strokeWidth="0.3" />
        </pattern>
        <rect width="100%" height="100%" fill="url(#grid)" />

        {/* ── Wires ── */}
        {WIRES.map((wire) => {
          const isActive = activeWires.has(wire.id);
          const points = wire.path.map(p => p.join(',')).join(' ');

          return (
            <g key={wire.id}>
              <polyline
                points={points}
                fill="none"
                stroke={isActive ? ACTIVE_WIRE_COLOR : INACTIVE_WIRE_COLOR}
                strokeWidth={isActive ? 2 : 1}
                strokeLinecap="round"
                strokeLinejoin="round"
                markerEnd={isActive ? 'url(#arrowhead)' : 'url(#arrowhead-inactive)'}
                opacity={isActive ? 1 : 0.4}
                filter={isActive ? 'url(#glow)' : undefined}
              >
                {isActive && (
                  <animate
                    attributeName="stroke-dashoffset"
                    from="20"
                    to="0"
                    dur="0.8s"
                    repeatCount="indefinite"
                  />
                )}
              </polyline>
              {isActive && (
                <polyline
                  points={points}
                  fill="none"
                  stroke={ACTIVE_WIRE_COLOR}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="4 4"
                  opacity={0.6}
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    from="8"
                    to="0"
                    dur="0.5s"
                    repeatCount="indefinite"
                  />
                </polyline>
              )}
              {/* Wire label */}
              {isActive && wire.path.length >= 2 && (
                <text
                  x={(wire.path[0][0] + wire.path[Math.min(1, wire.path.length - 1)][0]) / 2}
                  y={(wire.path[0][1] + wire.path[Math.min(1, wire.path.length - 1)][1]) / 2 - 5}
                  textAnchor="middle"
                  fontSize="7"
                  fill={ACTIVE_WIRE_COLOR}
                  fontFamily="monospace"
                  opacity={0.8}
                >
                  {wire.label}
                </text>
              )}
            </g>
          );
        })}

        {/* ── Components ── */}
        {COMPONENTS.map((comp) => {
          const isActive = activeComponents.has(comp.id);
          const isMux = comp.id.startsWith('mux_');
          const isAdder = comp.id.startsWith('add_');

          return (
            <g key={comp.id}>
              {/* Component box */}
              {comp.id === 'alu' ? (
                // ALU trapezoid shape
                <polygon
                  points={`${comp.x},${comp.y} ${comp.x + comp.width},${comp.y + 20} ${comp.x + comp.width},${comp.y + comp.height - 20} ${comp.x},${comp.y + comp.height}`}
                  fill={isActive ? `${comp.color}20` : '#0d0d14'}
                  stroke={isActive ? comp.color : '#1e1e2e'}
                  strokeWidth={isActive ? 2 : 1}
                  rx={4}
                  filter={isActive ? 'url(#glow)' : undefined}
                />
              ) : isMux ? (
                // MUX trapezoid
                <polygon
                  points={`${comp.x},${comp.y} ${comp.x + comp.width},${comp.y + 8} ${comp.x + comp.width},${comp.y + comp.height - 8} ${comp.x},${comp.y + comp.height}`}
                  fill={isActive ? '#10b98120' : '#0d0d14'}
                  stroke={isActive ? '#10b981' : '#1e1e2e'}
                  strokeWidth={isActive ? 2 : 1}
                  filter={isActive ? 'url(#glow)' : undefined}
                />
              ) : comp.id === 'and_branch' ? (
                // AND gate (circle-ish)
                <ellipse
                  cx={comp.x + comp.width / 2}
                  cy={comp.y + comp.height / 2}
                  rx={comp.width / 2}
                  ry={comp.height / 2}
                  fill={isActive ? `${comp.color}20` : '#0d0d14'}
                  stroke={isActive ? comp.color : '#1e1e2e'}
                  strokeWidth={isActive ? 2 : 1}
                  filter={isActive ? 'url(#glow)' : undefined}
                />
              ) : (
                <rect
                  x={comp.x}
                  y={comp.y}
                  width={comp.width}
                  height={comp.height}
                  rx={6}
                  fill={isActive ? `${comp.color}15` : '#0d0d14'}
                  stroke={isActive ? comp.color : '#1e1e2e'}
                  strokeWidth={isActive ? 2 : 1}
                  filter={isActive ? 'url(#glow)' : undefined}
                />
              )}

              {/* Component label */}
              <text
                x={comp.x + comp.width / 2}
                y={comp.y + comp.height / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={comp.id === 'and_branch' || isMux ? 7 : 9}
                fontWeight="bold"
                fill={isActive ? comp.color : '#71717a'}
                fontFamily="monospace"
              >
                {comp.shortLabel.split('\n').map((line, i, arr) => (
                  <tspan
                    key={i}
                    x={comp.x + comp.width / 2}
                    dy={i === 0 ? `${-(arr.length - 1) * 0.5}em` : '1.1em'}
                  >
                    {line}
                  </tspan>
                ))}
              </text>

              {/* Active pulse indicator */}
              {isActive && (
                <circle
                  cx={comp.x + comp.width - 4}
                  cy={comp.y + 4}
                  r={3}
                  fill={comp.color}
                  opacity={0.8}
                >
                  <animate
                    attributeName="r"
                    values="2;4;2"
                    dur="1s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="1;0.4;1"
                    dur="1s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}

              {/* PC value display */}
              {comp.id === 'pc' && (
                <text
                  x={comp.x + comp.width / 2}
                  y={comp.y + comp.height - 8}
                  textAnchor="middle"
                  fontSize="8"
                  fill="#6366f1"
                  fontFamily="monospace"
                >
                  {pc}
                </text>
              )}
            </g>
          );
        })}

        {/* ── Phase Label ── */}
        <rect x={svgWidth - 180} y={svgHeight - 35} width={170} height={25} rx={6} fill={`${PHASE_COLORS[phase]}20`} stroke={PHASE_COLORS[phase]} strokeWidth={1} />
        <text x={svgWidth - 95} y={svgHeight - 19} textAnchor="middle" fontSize="10" fontWeight="bold" fill={PHASE_COLORS[phase]} fontFamily="monospace">
          {PHASE_NAMES[phase]}
        </text>
      </svg>
    );
  };

  // ──────────────────────────── Render ────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />

      <main className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* ── Header ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
            className="mb-6"
          >
            <div className="flex items-center gap-3 mb-2">
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-semibold"
                style={{ background: 'rgba(139,92,246,0.1)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.2)' }}
              >
                2.2
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Single-Cycle Datapath
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Visualize the complete MIPS single-cycle processor datapath. Watch data flow through
              PC, Instruction Memory, Register File, ALU, and Data Memory as each instruction executes
              in five phases: Fetch, Decode, Execute, Memory, and Write Back.
            </p>
          </motion.div>

          {/* ── Scenario Selector ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="mb-6"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[#71717a] mr-1 font-medium uppercase tracking-wider">
                Presets:
              </span>
              {Object.entries(PRESET_SCENARIOS).map(([key, scenario]) => (
                <button
                  key={key}
                  onClick={() => loadScenario(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-all duration-200 ${
                    selectedScenario === key
                      ? 'bg-[#8b5cf6]/15 border border-[#8b5cf6]/30 text-[#8b5cf6]'
                      : 'bg-[#111118] border border-[#1e1e2e] hover:border-[#2a2a3e] text-[#a1a1aa] hover:text-white'
                  }`}
                  title={scenario.desc}
                >
                  {scenario.label}
                </button>
              ))}
            </div>
          </motion.div>

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

          {/* ── Main Datapath Visualization ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="mb-6"
          >
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1e1e2e] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CircuitBoard size={14} className="text-[#8b5cf6]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    MIPS Single-Cycle Datapath
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {/* Phase indicator */}
                  <div className="flex items-center gap-1.5">
                    {(['fetch', 'decode', 'execute', 'memory', 'writeback'] as DatapathPhase[]).map((p) => (
                      <div
                        key={p}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono transition-all duration-300"
                        style={{
                          backgroundColor: phase === p ? `${PHASE_COLORS[p]}20` : 'transparent',
                          color: phase === p ? PHASE_COLORS[p] : '#3a3a4e',
                          border: phase === p ? `1px solid ${PHASE_COLORS[p]}40` : '1px solid transparent',
                        }}
                      >
                        {p === 'fetch' ? 'IF' : p === 'decode' ? 'ID' : p === 'execute' ? 'EX' : p === 'memory' ? 'MEM' : 'WB'}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="p-4">
                {renderDatapath()}
              </div>
            </div>
          </motion.div>

          {/* ── Middle Section: Program + Registers + Memory ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* ── Instruction Memory ── */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2 }}
            >
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden h-full">
                <div className="px-4 py-3 border-b border-[#1e1e2e] flex items-center gap-2">
                  <Database size={14} className="text-[#6366f1]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Instruction Memory
                  </span>
                </div>
                <div className="divide-y divide-[#1e1e2e]">
                  {program.map((instr, idx) => {
                    const isCurrent = idx === currentInstrIndex && !allComplete;
                    const isPast = idx < currentInstrIndex;

                    return (
                      <div
                        key={idx}
                        className={`px-4 py-2.5 transition-all duration-300 ${
                          isCurrent ? 'bg-[#8b5cf6]/8' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-[#71717a] w-8 flex-shrink-0">
                            {(idx * 4).toString().padStart(3, '0')}
                          </span>
                          <div className="w-2 flex-shrink-0">
                            {isCurrent && (
                              <motion.div
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: PHASE_COLORS[phase] }}
                                animate={{ scale: [1, 1.3, 1] }}
                                transition={{ duration: 1, repeat: Infinity }}
                              />
                            )}
                            {isPast && (
                              <div className="w-2 h-2 rounded-full bg-[#10b981]" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span
                              className={`text-xs font-mono ${
                                isCurrent ? 'text-white font-bold' : isPast ? 'text-[#71717a]' : 'text-[#a1a1aa]'
                              }`}
                            >
                              {instr.assembly}
                            </span>
                          </div>
                          <span
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{
                              backgroundColor: instr.format === 'R' ? '#10b98115' : '#f59e0b15',
                              color: instr.format === 'R' ? '#10b981' : '#f59e0b',
                            }}
                          >
                            {instr.format}
                          </span>
                        </div>
                        {isCurrent && (
                          <div className="mt-1 ml-[52px] text-[10px] text-[#71717a]">
                            {instr.description}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>

            {/* ── Register File ── */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.25 }}
            >
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden h-full">
                <div className="px-4 py-3 border-b border-[#1e1e2e] flex items-center gap-2">
                  <MemoryStick size={14} className="text-[#06b6d4]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Register File
                  </span>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(registers).map(([name, value]) => {
                      const isSource = currentInstr && (currentInstr.rs === name || currentInstr.rt === name);
                      const isDest = currentInstr && (
                        (currentInstr.format === 'R' && currentInstr.rd === name) ||
                        (currentInstr.format === 'I' && currentInstr.op !== 'SW' && currentInstr.op !== 'BEQ' && currentInstr.rt === name)
                      );
                      const isWriting = isDest && phase === 'writeback';

                      return (
                        <motion.div
                          key={name}
                          className={`p-2.5 rounded-lg border transition-all duration-300 ${
                            isWriting
                              ? 'border-[#ec4899]/40 bg-[#ec4899]/10'
                              : isSource && (phase === 'decode' || phase === 'execute')
                              ? 'border-[#06b6d4]/30 bg-[#06b6d4]/5'
                              : isDest
                              ? 'border-[#10b981]/20 bg-[#10b981]/5'
                              : 'border-[#1e1e2e] bg-[#0d0d14]'
                          }`}
                          animate={{
                            scale: isWriting ? 1.02 : 1,
                          }}
                          transition={{ duration: 0.2 }}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-[10px] font-mono font-bold ${
                                isWriting ? 'text-[#ec4899]' : isSource ? 'text-[#06b6d4]' : isDest ? 'text-[#10b981]' : 'text-[#a1a1aa]'
                              }`}
                            >
                              {name}
                            </span>
                            {isSource && !isWriting && (
                              <span className="text-[8px] text-[#06b6d4] font-mono">READ</span>
                            )}
                            {isWriting && (
                              <span className="text-[8px] text-[#ec4899] font-mono">WRITE</span>
                            )}
                          </div>
                          <div className={`text-sm font-mono font-bold mt-1 ${
                            isWriting ? 'text-[#ec4899]' : 'text-white'
                          }`}>
                            {value}
                          </div>
                          <div className="text-[9px] font-mono text-[#3a3a4e] mt-0.5">
                            0x{(value >>> 0).toString(16).padStart(8, '0')}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>

            {/* ── Data Memory + Control Signals ── */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
              className="space-y-4"
            >
              {/* Data Memory */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1e1e2e] flex items-center gap-2">
                  <Database size={14} className="text-[#10b981]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Data Memory
                  </span>
                </div>
                <div className="p-4">
                  {Object.keys(dataMemory).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(dataMemory).sort(([a], [b]) => Number(a) - Number(b)).map(([addr, val]) => {
                        const addrNum = Number(addr);
                        const isAccessed = currentInstr && (phase === 'memory') && aluResult === addrNum &&
                          (currentInstr.op === 'LW' || currentInstr.op === 'SW');

                        return (
                          <div
                            key={addr}
                            className={`flex items-center justify-between p-2 rounded-lg border transition-all duration-300 ${
                              isAccessed
                                ? currentInstr?.op === 'LW' ? 'border-[#06b6d4]/30 bg-[#06b6d4]/8' : 'border-[#ef4444]/30 bg-[#ef4444]/8'
                                : 'border-[#1e1e2e] bg-[#0d0d14]'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] font-mono text-[#71717a]">
                                [{addr}]
                              </span>
                              <span className="text-xs font-mono font-bold text-white">
                                {val}
                              </span>
                            </div>
                            {isAccessed && (
                              <span className={`text-[8px] font-mono ${
                                currentInstr?.op === 'LW' ? 'text-[#06b6d4]' : 'text-[#ef4444]'
                              }`}>
                                {currentInstr?.op === 'LW' ? 'READING' : 'WRITING'}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-[#71717a] text-center py-2">No memory locations used</div>
                  )}
                </div>
              </div>

              {/* Control Signals */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1e1e2e] flex items-center gap-2">
                  <Zap size={14} className="text-[#a855f7]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Control Signals
                  </span>
                </div>
                <div className="p-4">
                  {controlSignals ? (
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { name: 'RegDst', val: controlSignals.RegDst, desc: 'Select dest reg' },
                        { name: 'ALUSrc', val: controlSignals.ALUSrc, desc: 'ALU input B src' },
                        { name: 'MemToReg', val: controlSignals.MemToReg, desc: 'Write data src' },
                        { name: 'RegWrite', val: controlSignals.RegWrite, desc: 'Enable reg write' },
                        { name: 'MemRead', val: controlSignals.MemRead, desc: 'Read from mem' },
                        { name: 'MemWrite', val: controlSignals.MemWrite, desc: 'Write to mem' },
                        { name: 'Branch', val: controlSignals.Branch, desc: 'Branch instr' },
                        { name: 'ALUOp', val: controlSignals.ALUOp.join(''), desc: 'ALU operation' },
                      ] as { name: string; val: number | string; desc: string }[]).map((sig) => {
                        const isHigh = sig.val === 1 || sig.val === '1' || sig.val === '10' || sig.val === '01';
                        return (
                          <div
                            key={sig.name}
                            className={`p-2 rounded-lg border text-center transition-all duration-200 ${
                              isHigh
                                ? 'border-[#a855f7]/30 bg-[#a855f7]/10'
                                : 'border-[#1e1e2e] bg-[#0d0d14]'
                            }`}
                          >
                            <div className={`text-[10px] font-mono font-bold ${isHigh ? 'text-[#a855f7]' : 'text-[#71717a]'}`}>
                              {sig.name}
                            </div>
                            <div className={`text-sm font-mono font-bold ${isHigh ? 'text-white' : 'text-[#3a3a4e]'}`}>
                              {typeof sig.val === 'number' ? sig.val : sig.val}
                            </div>
                            <div className="text-[8px] text-[#71717a] mt-0.5">{sig.desc}</div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-[#71717a] text-center py-2">
                      Execute an instruction to see control signals
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>

          {/* ── Metrics Panel ── */}
          <AnimatePresence>
            {showMetrics && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-6"
              >
                <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#1e1e2e] flex items-center gap-2">
                    <Hash size={14} className="text-[#8b5cf6]" />
                    <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                      Execution Metrics
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      <div className="p-3 rounded-lg bg-[#0d0d14] border border-[#1e1e2e]">
                        <div className="text-[10px] text-[#71717a] uppercase tracking-wider mb-1">PC</div>
                        <div className="text-lg font-mono font-bold text-[#6366f1]">{pc}</div>
                      </div>
                      <div className="p-3 rounded-lg bg-[#0d0d14] border border-[#1e1e2e]">
                        <div className="text-[10px] text-[#71717a] uppercase tracking-wider mb-1">Current Phase</div>
                        <div className="text-lg font-mono font-bold" style={{ color: PHASE_COLORS[phase] }}>
                          {phase === 'idle' ? '--' : phase.toUpperCase()}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-[#0d0d14] border border-[#1e1e2e]">
                        <div className="text-[10px] text-[#71717a] uppercase tracking-wider mb-1">Instruction</div>
                        <div className="text-sm font-mono font-bold text-white truncate">
                          {currentInstr?.assembly ?? '--'}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-[#0d0d14] border border-[#1e1e2e]">
                        <div className="text-[10px] text-[#71717a] uppercase tracking-wider mb-1">ALU Result</div>
                        <div className="text-lg font-mono font-bold text-[#f59e0b]">
                          {phase !== 'idle' && phase !== 'fetch' ? aluResult : '--'}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-[#0d0d14] border border-[#1e1e2e]">
                        <div className="text-[10px] text-[#71717a] uppercase tracking-wider mb-1">Completed</div>
                        <div className="text-lg font-mono font-bold text-[#10b981]">
                          {instructionsCompleted}/{program.length}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Execution Log ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.35 }}
            className="mb-6"
          >
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1e1e2e] flex items-center gap-2">
                <Binary size={14} className="text-[#8b5cf6]" />
                <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                  Execution Log
                </span>
              </div>
              <div className="p-4 max-h-48 overflow-y-auto font-mono text-[11px] space-y-0.5">
                {phaseLog.length > 0 ? (
                  phaseLog.map((entry, idx) => {
                    const isHeader = entry.startsWith('---');
                    const isPhase = entry.match(/^(FETCH|DECODE|CONTROL|READ REGS|EXECUTE|MEMORY|WRITEBACK|BRANCH|PC):/);
                    let color = '#a1a1aa';
                    if (isHeader) color = '#8b5cf6';
                    else if (isPhase) {
                      const phaseName = isPhase[1];
                      if (phaseName === 'FETCH') color = '#6366f1';
                      else if (phaseName === 'DECODE' || phaseName === 'CONTROL' || phaseName === 'READ REGS') color = '#06b6d4';
                      else if (phaseName === 'EXECUTE' || phaseName === 'BRANCH') color = '#f59e0b';
                      else if (phaseName === 'MEMORY') color = '#10b981';
                      else if (phaseName === 'WRITEBACK') color = '#ec4899';
                      else if (phaseName === 'PC') color = '#6366f1';
                    }

                    return (
                      <div key={idx} style={{ color }} className={isHeader ? 'pt-2 font-bold' : ''}>
                        {entry}
                      </div>
                    );
                  })
                ) : (
                  <div className="text-[#71717a] text-center py-4">
                    Press Play or Step to begin execution
                  </div>
                )}
                <div ref={logEndRef} />
              </div>
            </div>
          </motion.div>

          {/* ── Educational Panel ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.4 }}
            className="mb-6"
          >
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
              <button
                onClick={() => setShowEducation(!showEducation)}
                className="w-full px-4 py-3 border-b border-[#1e1e2e] flex items-center justify-between hover:bg-[#16161f] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Info size={14} className="text-[#8b5cf6]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Understanding the Single-Cycle Datapath
                  </span>
                </div>
                <ChevronDown
                  size={14}
                  className={`text-[#71717a] transition-transform duration-200 ${showEducation ? 'rotate-180' : ''}`}
                />
              </button>
              <AnimatePresence>
                {showEducation && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 space-y-4">
                      {/* Five Phases */}
                      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                        {([
                          { phase: 'Fetch', color: '#6366f1', abbrev: 'IF', desc: 'Read the instruction from Instruction Memory using the PC value. PC+4 is computed for next instruction.' },
                          { phase: 'Decode', color: '#06b6d4', abbrev: 'ID', desc: 'Control unit generates signals from the opcode. Register file reads source registers rs and rt. Sign-extend produces 32-bit immediate.' },
                          { phase: 'Execute', color: '#f59e0b', abbrev: 'EX', desc: 'ALU performs the operation. For R-type: arithmetic on register values. For I-type: add base + offset. For BEQ: subtract to check equality.' },
                          { phase: 'Memory', color: '#10b981', abbrev: 'MEM', desc: 'Data Memory is accessed. LW reads a word from the computed address. SW writes a word to memory. R-type instructions pass through.' },
                          { phase: 'Write Back', color: '#ec4899', abbrev: 'WB', desc: 'Results are written back to the Register File. R-type writes ALU result. LW writes memory data. SW and BEQ do not write.' },
                        ]).map((p) => (
                          <div
                            key={p.phase}
                            className="p-3 rounded-lg border border-[#1e1e2e] bg-[#0d0d14]"
                          >
                            <div className="flex items-center gap-2 mb-1.5">
                              <span
                                className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: `${p.color}15`, color: p.color }}
                              >
                                {p.abbrev}
                              </span>
                              <span className="text-xs font-semibold text-white">{p.phase}</span>
                            </div>
                            <p className="text-[10px] text-[#a1a1aa] leading-relaxed">{p.desc}</p>
                          </div>
                        ))}
                      </div>

                      {/* Datapath Components */}
                      <div>
                        <div className="text-xs font-semibold text-white mb-2">Key Components</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {[
                            { name: 'Program Counter (PC)', color: '#6366f1', desc: 'A register holding the memory address of the current instruction. Updated every cycle to PC+4 or branch target.' },
                            { name: 'Instruction Memory', color: '#6366f1', desc: 'Read-only memory storing the program. Addressed by PC, outputs the 32-bit instruction word.' },
                            { name: 'Register File', color: '#06b6d4', desc: '32 general-purpose 32-bit registers. Has two read ports (rs, rt) and one write port. Reads are combinational; writes occur on clock edge.' },
                            { name: 'ALU', color: '#f59e0b', desc: 'Arithmetic Logic Unit performs ADD, SUB, AND, OR, SLT. Outputs the result and a Zero flag for branch decisions.' },
                            { name: 'Data Memory', color: '#10b981', desc: 'Stores data values. Addressed by ALU result. MemRead enables load, MemWrite enables store operations.' },
                            { name: 'Control Unit', color: '#a855f7', desc: 'Decodes the opcode field [31:26] and generates all control signals that orchestrate the datapath multiplexers and enables.' },
                          ].map((comp) => (
                            <div key={comp.name} className="flex gap-2.5">
                              <div className="w-1 rounded-full flex-shrink-0" style={{ backgroundColor: comp.color }} />
                              <div>
                                <div className="text-[11px] font-semibold text-white mb-0.5">{comp.name}</div>
                                <p className="text-[10px] text-[#a1a1aa] leading-relaxed">{comp.desc}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Control Signal Table */}
                      <div>
                        <div className="text-xs font-semibold text-white mb-2">Control Signal Truth Table</div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr className="border-b border-[#1e1e2e]">
                                <th className="px-2 py-1.5 text-left text-[#71717a] font-semibold">Instruction</th>
                                <th className="px-2 py-1.5 text-center text-[#71717a]">RegDst</th>
                                <th className="px-2 py-1.5 text-center text-[#71717a]">ALUSrc</th>
                                <th className="px-2 py-1.5 text-center text-[#71717a]">MemToReg</th>
                                <th className="px-2 py-1.5 text-center text-[#71717a]">RegWrite</th>
                                <th className="px-2 py-1.5 text-center text-[#71717a]">MemRead</th>
                                <th className="px-2 py-1.5 text-center text-[#71717a]">MemWrite</th>
                                <th className="px-2 py-1.5 text-center text-[#71717a]">Branch</th>
                                <th className="px-2 py-1.5 text-center text-[#71717a]">ALUOp</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#1e1e2e]">
                              {([
                                { name: 'R-type', signals: [1, 0, 0, 1, 0, 0, 0, '10'] },
                                { name: 'LW', signals: [0, 1, 1, 1, 1, 0, 0, '00'] },
                                { name: 'SW', signals: ['X', 1, 'X', 0, 0, 1, 0, '00'] },
                                { name: 'BEQ', signals: ['X', 0, 'X', 0, 0, 0, 1, '01'] },
                              ]).map((row) => (
                                <tr key={row.name} className="hover:bg-[#16161f]">
                                  <td className="px-2 py-1.5 font-mono font-bold text-white">{row.name}</td>
                                  {row.signals.map((sig, i) => (
                                    <td
                                      key={i}
                                      className={`px-2 py-1.5 text-center font-mono ${
                                        sig === 1 ? 'text-[#10b981] font-bold' :
                                        sig === 0 ? 'text-[#3a3a4e]' :
                                        sig === 'X' ? 'text-[#71717a]' :
                                        'text-[#a855f7] font-bold'
                                      }`}
                                    >
                                      {sig.toString()}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Key Insights */}
                      <div className="p-3 rounded-lg bg-[#8b5cf6]/5 border border-[#8b5cf6]/15">
                        <div className="text-xs font-semibold text-[#8b5cf6] mb-2">Key Insights</div>
                        <ul className="space-y-1.5">
                          <li className="text-[11px] text-[#a1a1aa] flex items-start gap-2">
                            <span className="text-[#8b5cf6] mt-0.5">*</span>
                            <span>In a single-cycle design, every instruction completes in one clock cycle. The clock period must be long enough for the slowest instruction (typically LW).</span>
                          </li>
                          <li className="text-[11px] text-[#a1a1aa] flex items-start gap-2">
                            <span className="text-[#8b5cf6] mt-0.5">*</span>
                            <span>The critical path for LW goes through: PC, Instruction Memory, Register File, ALU, Data Memory, and back to Register File write.</span>
                          </li>
                          <li className="text-[11px] text-[#a1a1aa] flex items-start gap-2">
                            <span className="text-[#8b5cf6] mt-0.5">*</span>
                            <span>MUXes are controlled by single-bit signals that select between two data sources (e.g., RegDst selects between rt and rd for the write register).</span>
                          </li>
                          <li className="text-[11px] text-[#a1a1aa] flex items-start gap-2">
                            <span className="text-[#8b5cf6] mt-0.5">*</span>
                            <span>The single-cycle design is simple but inefficient: resources like the ALU sit idle during memory access. Pipelining solves this by overlapping instruction execution.</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

        </div>
      </main>
    </div>
  );
}
