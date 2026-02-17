'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Binary,
  ChevronDown,
  Cpu,
  Info,
  ArrowRight,
  ArrowLeftRight,
  Code2,
  Layers,
  BookOpen,
  Hash,
  Zap,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import ModuleControls from '@/components/ui/ModuleControls';

// ──────────────────────────── Types ────────────────────────────

type InstructionFormat = 'R' | 'I' | 'J';

interface FieldDef {
  name: string;
  bits: number;
  bitRange: [number, number]; // [high, low] bit positions
  color: string;
  description: string;
}

interface InstructionDef {
  mnemonic: string;
  format: InstructionFormat;
  opcode: string;  // 6-bit binary string
  funct?: string;  // 6-bit binary string for R-type
  assembly: string;
  fields: Record<string, string>; // field name -> binary value
  description: string;
}

interface EncodingStep {
  fieldIndex: number;
  phase: 'highlight' | 'fill';
}

interface DecodingStep {
  phase: 'identify-format' | 'extract-field' | 'assemble';
  fieldIndex: number;
}

interface ProgramLine {
  address: number;
  instruction: InstructionDef;
  binary: string;
}

type AnimationMode = 'encode' | 'decode';

// ──────────────────────────── Constants ────────────────────────────

const FIELD_COLORS: Record<string, string> = {
  opcode: '#ef4444',
  rs: '#6366f1',
  rt: '#06b6d4',
  rd: '#10b981',
  shamt: '#f59e0b',
  funct: '#a855f7',
  immediate: '#f59e0b',
  address: '#06b6d4',
};

const R_TYPE_FIELDS: FieldDef[] = [
  { name: 'opcode', bits: 6, bitRange: [31, 26], color: FIELD_COLORS.opcode, description: 'Operation code (000000 for R-type)' },
  { name: 'rs', bits: 5, bitRange: [25, 21], color: FIELD_COLORS.rs, description: 'First source register' },
  { name: 'rt', bits: 5, bitRange: [20, 16], color: FIELD_COLORS.rt, description: 'Second source register' },
  { name: 'rd', bits: 5, bitRange: [15, 11], color: FIELD_COLORS.rd, description: 'Destination register' },
  { name: 'shamt', bits: 5, bitRange: [10, 6], color: FIELD_COLORS.shamt, description: 'Shift amount' },
  { name: 'funct', bits: 6, bitRange: [5, 0], color: FIELD_COLORS.funct, description: 'Function code (specifies operation)' },
];

const I_TYPE_FIELDS: FieldDef[] = [
  { name: 'opcode', bits: 6, bitRange: [31, 26], color: FIELD_COLORS.opcode, description: 'Operation code' },
  { name: 'rs', bits: 5, bitRange: [25, 21], color: FIELD_COLORS.rs, description: 'Source register / base address' },
  { name: 'rt', bits: 5, bitRange: [20, 16], color: FIELD_COLORS.rt, description: 'Destination register / branch compare' },
  { name: 'immediate', bits: 16, bitRange: [15, 0], color: FIELD_COLORS.immediate, description: '16-bit immediate value / offset' },
];

const J_TYPE_FIELDS: FieldDef[] = [
  { name: 'opcode', bits: 6, bitRange: [31, 26], color: FIELD_COLORS.opcode, description: 'Operation code' },
  { name: 'address', bits: 26, bitRange: [25, 0], color: FIELD_COLORS.address, description: '26-bit jump target address' },
];

const FORMAT_FIELDS: Record<InstructionFormat, FieldDef[]> = {
  R: R_TYPE_FIELDS,
  I: I_TYPE_FIELDS,
  J: J_TYPE_FIELDS,
};

const REGISTER_MAP: Record<string, string> = {
  '$zero': '00000', '$at': '00001',
  '$v0': '00010', '$v1': '00011',
  '$a0': '00100', '$a1': '00101', '$a2': '00110', '$a3': '00111',
  '$t0': '01000', '$t1': '01001', '$t2': '01010', '$t3': '01011',
  '$t4': '01100', '$t5': '01101', '$t6': '01110', '$t7': '01111',
  '$s0': '10000', '$s1': '10001', '$s2': '10010', '$s3': '10011',
  '$s4': '10100', '$s5': '10101', '$s6': '10110', '$s7': '10111',
  '$t8': '11000', '$t9': '11001',
  '$k0': '11010', '$k1': '11011',
  '$gp': '11100', '$sp': '11101', '$fp': '11110', '$ra': '11111',
};

const REGISTER_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(REGISTER_MAP).map(([name, bin]) => [bin, name])
);

function regNumToBin(num: number): string {
  return num.toString(2).padStart(5, '0');
}

function immToBin(val: number, bits: number): string {
  if (val < 0) {
    return ((1 << bits) + val).toString(2).padStart(bits, '0');
  }
  return val.toString(2).padStart(bits, '0');
}

// ──────────────────────────── Instruction Definitions ────────────────────────────

const INSTRUCTIONS: Record<string, InstructionDef> = {
  'ADD $t0, $t1, $t2': {
    mnemonic: 'ADD',
    format: 'R',
    opcode: '000000',
    funct: '100000',
    assembly: 'ADD $t0, $t1, $t2',
    fields: { opcode: '000000', rs: '01001', rt: '01010', rd: '01000', shamt: '00000', funct: '100000' },
    description: 'Add: $t0 = $t1 + $t2',
  },
  'SUB $t0, $t1, $t2': {
    mnemonic: 'SUB',
    format: 'R',
    opcode: '000000',
    funct: '100010',
    assembly: 'SUB $t0, $t1, $t2',
    fields: { opcode: '000000', rs: '01001', rt: '01010', rd: '01000', shamt: '00000', funct: '100010' },
    description: 'Subtract: $t0 = $t1 - $t2',
  },
  'AND $t0, $t1, $t2': {
    mnemonic: 'AND',
    format: 'R',
    opcode: '000000',
    funct: '100100',
    assembly: 'AND $t0, $t1, $t2',
    fields: { opcode: '000000', rs: '01001', rt: '01010', rd: '01000', shamt: '00000', funct: '100100' },
    description: 'Bitwise AND: $t0 = $t1 & $t2',
  },
  'OR $t0, $t1, $t2': {
    mnemonic: 'OR',
    format: 'R',
    opcode: '000000',
    funct: '100101',
    assembly: 'OR $t0, $t1, $t2',
    fields: { opcode: '000000', rs: '01001', rt: '01010', rd: '01000', shamt: '00000', funct: '100101' },
    description: 'Bitwise OR: $t0 = $t1 | $t2',
  },
  'SLT $t0, $t1, $t2': {
    mnemonic: 'SLT',
    format: 'R',
    opcode: '000000',
    funct: '101010',
    assembly: 'SLT $t0, $t1, $t2',
    fields: { opcode: '000000', rs: '01001', rt: '01010', rd: '01000', shamt: '00000', funct: '101010' },
    description: 'Set on Less Than: $t0 = ($t1 < $t2) ? 1 : 0',
  },
  'SLL $t0, $t1, 2': {
    mnemonic: 'SLL',
    format: 'R',
    opcode: '000000',
    funct: '000000',
    assembly: 'SLL $t0, $t1, 2',
    fields: { opcode: '000000', rs: '00000', rt: '01001', rd: '01000', shamt: '00010', funct: '000000' },
    description: 'Shift Left Logical: $t0 = $t1 << 2',
  },
  'LW $t0, 4($t1)': {
    mnemonic: 'LW',
    format: 'I',
    opcode: '100011',
    assembly: 'LW $t0, 4($t1)',
    fields: { opcode: '100011', rs: '01001', rt: '01000', immediate: '0000000000000100' },
    description: 'Load Word: $t0 = Memory[$t1 + 4]',
  },
  'SW $t0, 8($t1)': {
    mnemonic: 'SW',
    format: 'I',
    opcode: '101011',
    assembly: 'SW $t0, 8($t1)',
    fields: { opcode: '101011', rs: '01001', rt: '01000', immediate: '0000000000001000' },
    description: 'Store Word: Memory[$t1 + 8] = $t0',
  },
  'ADDI $t0, $t1, 10': {
    mnemonic: 'ADDI',
    format: 'I',
    opcode: '001000',
    assembly: 'ADDI $t0, $t1, 10',
    fields: { opcode: '001000', rs: '01001', rt: '01000', immediate: '0000000000001010' },
    description: 'Add Immediate: $t0 = $t1 + 10',
  },
  'BEQ $t0, $t1, 3': {
    mnemonic: 'BEQ',
    format: 'I',
    opcode: '000100',
    assembly: 'BEQ $t0, $t1, 3',
    fields: { opcode: '000100', rs: '01000', rt: '01001', immediate: '0000000000000011' },
    description: 'Branch if Equal: if ($t0 == $t1) PC += 3 * 4',
  },
  'BNE $t0, $t1, 5': {
    mnemonic: 'BNE',
    format: 'I',
    opcode: '000101',
    assembly: 'BNE $t0, $t1, 5',
    fields: { opcode: '000101', rs: '01000', rt: '01001', immediate: '0000000000000101' },
    description: 'Branch if Not Equal: if ($t0 != $t1) PC += 5 * 4',
  },
  'J 1024': {
    mnemonic: 'J',
    format: 'J',
    opcode: '000010',
    assembly: 'J 1024',
    fields: { opcode: '000010', address: '00000000000000010000000000' },
    description: 'Jump: PC = 1024',
  },
  'JAL 2048': {
    mnemonic: 'JAL',
    format: 'J',
    opcode: '000011',
    assembly: 'JAL 2048',
    fields: { opcode: '000011', address: '00000000000000100000000000' },
    description: 'Jump and Link: $ra = PC + 4; PC = 2048',
  },
};

function getFieldsForFormat(format: InstructionFormat): FieldDef[] {
  return FORMAT_FIELDS[format];
}

function instructionToBinary(instr: InstructionDef): string {
  const fields = getFieldsForFormat(instr.format);
  return fields.map(f => instr.fields[f.name] || '0'.repeat(f.bits)).join('');
}

function binaryToGrouped(binary: string, format: InstructionFormat): { value: string; color: string; name: string }[] {
  const fields = getFieldsForFormat(format);
  const groups: { value: string; color: string; name: string }[] = [];
  let offset = 0;
  for (const field of fields) {
    groups.push({
      value: binary.slice(offset, offset + field.bits),
      color: field.color,
      name: field.name,
    });
    offset += field.bits;
  }
  return groups;
}

// ──────────────────────────── Preset Scenarios ────────────────────────────

interface Scenario {
  label: string;
  desc: string;
  instructions: string[];
  mode: AnimationMode;
}

const PRESET_SCENARIOS: Record<string, Scenario> = {
  r_type: {
    label: 'R-Type Arithmetic',
    desc: 'Encode R-type instructions: ADD, SUB, AND, OR',
    instructions: ['ADD $t0, $t1, $t2', 'SUB $t0, $t1, $t2', 'AND $t0, $t1, $t2', 'OR $t0, $t1, $t2'],
    mode: 'encode',
  },
  i_type: {
    label: 'I-Type Load/Store',
    desc: 'Encode I-type instructions: LW, SW, ADDI, BEQ',
    instructions: ['LW $t0, 4($t1)', 'SW $t0, 8($t1)', 'ADDI $t0, $t1, 10', 'BEQ $t0, $t1, 3'],
    mode: 'encode',
  },
  j_type: {
    label: 'J-Type Jump',
    desc: 'Encode J-type instructions: J, JAL',
    instructions: ['J 1024', 'JAL 2048', 'ADD $t0, $t1, $t2', 'BEQ $t0, $t1, 3'],
    mode: 'encode',
  },
  full_program: {
    label: 'Full Program',
    desc: 'A mixed program with all instruction formats',
    instructions: ['ADDI $t0, $t1, 10', 'ADD $t0, $t1, $t2', 'SW $t0, 8($t1)', 'LW $t0, 4($t1)', 'BEQ $t0, $t1, 3', 'J 1024'],
    mode: 'encode',
  },
  decode_r: {
    label: 'Decode R-Type',
    desc: 'Decode binary R-type instructions back to assembly',
    instructions: ['ADD $t0, $t1, $t2', 'SLT $t0, $t1, $t2'],
    mode: 'decode',
  },
  decode_mixed: {
    label: 'Decode Mixed',
    desc: 'Decode a mix of binary instructions',
    instructions: ['LW $t0, 4($t1)', 'ADD $t0, $t1, $t2', 'J 1024', 'BNE $t0, $t1, 5'],
    mode: 'decode',
  },
};

// ──────────────────────────── Field Education Info ────────────────────────────

const FORMAT_INFO: Record<InstructionFormat, { title: string; description: string; usage: string }> = {
  R: {
    title: 'R-Type (Register)',
    description: 'Used for arithmetic and logical operations between registers. All operands come from registers.',
    usage: 'ADD, SUB, AND, OR, SLT, SLL, SRL',
  },
  I: {
    title: 'I-Type (Immediate)',
    description: 'Used for operations with a constant value, memory access (load/store), and conditional branches.',
    usage: 'ADDI, LW, SW, BEQ, BNE, SLTI',
  },
  J: {
    title: 'J-Type (Jump)',
    description: 'Used for unconditional jumps. Provides a 26-bit address field for the jump target.',
    usage: 'J, JAL',
  },
};

// ──────────────────────────── Main Component ────────────────────────────

export default function ISAModule() {
  // ── Core State ──
  const [program, setProgram] = useState<ProgramLine[]>([]);
  const [currentInstrIndex, setCurrentInstrIndex] = useState(0);
  const [animationMode, setAnimationMode] = useState<AnimationMode>('encode');
  const [activeFieldIndex, setActiveFieldIndex] = useState(-1);
  const [fieldPhase, setFieldPhase] = useState<'idle' | 'highlight' | 'fill' | 'complete'>('idle');
  const [decodingPhase, setDecodingPhase] = useState<'idle' | 'identify-format' | 'extract-field' | 'assemble' | 'complete'>('idle');
  const [revealedFields, setRevealedFields] = useState<Set<number>>(new Set());
  const [decodedText, setDecodedText] = useState('');
  const [instructionComplete, setInstructionComplete] = useState(false);
  const [allComplete, setAllComplete] = useState(false);

  // ── UI State ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [selectedScenario, setSelectedScenario] = useState('r_type');
  const [showScenarioDropdown, setShowScenarioDropdown] = useState(false);
  const [showEducation, setShowEducation] = useState(true);

  // ── Refs ──
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const stepCountRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // ── Derived Values ──
  const currentInstr = program[currentInstrIndex]?.instruction ?? null;
  const currentBinary = currentInstr ? instructionToBinary(currentInstr) : '';
  const currentFields = currentInstr ? getFieldsForFormat(currentInstr.format) : [];
  const totalFieldSteps = currentFields.length * 2; // highlight + fill per field

  // ── Step Forward Logic ──
  const stepForward = useCallback(() => {
    if (program.length === 0) return;
    if (allComplete) {
      setIsPlaying(false);
      return;
    }

    const instr = program[currentInstrIndex]?.instruction;
    if (!instr) return;

    const fields = getFieldsForFormat(instr.format);

    if (animationMode === 'encode') {
      // Encoding animation: highlight field, then fill binary
      if (fieldPhase === 'idle' || fieldPhase === 'complete') {
        // Start with first field or move to next instruction
        if (fieldPhase === 'complete' || instructionComplete) {
          // Move to next instruction
          if (currentInstrIndex < program.length - 1) {
            setCurrentInstrIndex(prev => prev + 1);
            setActiveFieldIndex(-1);
            setFieldPhase('idle');
            setRevealedFields(new Set());
            setInstructionComplete(false);
            stepCountRef.current += 1;
            return;
          } else {
            setAllComplete(true);
            setIsPlaying(false);
            return;
          }
        }
        // Start highlighting first field
        setActiveFieldIndex(0);
        setFieldPhase('highlight');
        stepCountRef.current += 1;
      } else if (fieldPhase === 'highlight') {
        // Fill in the highlighted field
        setFieldPhase('fill');
        setRevealedFields(prev => new Set([...prev, activeFieldIndex]));
        stepCountRef.current += 1;
      } else if (fieldPhase === 'fill') {
        // Move to next field or mark complete
        if (activeFieldIndex < fields.length - 1) {
          setActiveFieldIndex(prev => prev + 1);
          setFieldPhase('highlight');
          stepCountRef.current += 1;
        } else {
          // All fields encoded
          setFieldPhase('complete');
          setInstructionComplete(true);
          stepCountRef.current += 1;
        }
      }
    } else {
      // Decoding animation: identify format, extract fields, assemble
      if (decodingPhase === 'idle' || decodingPhase === 'complete') {
        if (decodingPhase === 'complete' || instructionComplete) {
          if (currentInstrIndex < program.length - 1) {
            setCurrentInstrIndex(prev => prev + 1);
            setActiveFieldIndex(-1);
            setDecodingPhase('idle');
            setRevealedFields(new Set());
            setDecodedText('');
            setInstructionComplete(false);
            stepCountRef.current += 1;
            return;
          } else {
            setAllComplete(true);
            setIsPlaying(false);
            return;
          }
        }
        setDecodingPhase('identify-format');
        setRevealedFields(new Set([0])); // Reveal opcode
        stepCountRef.current += 1;
      } else if (decodingPhase === 'identify-format') {
        setActiveFieldIndex(1);
        setDecodingPhase('extract-field');
        setRevealedFields(prev => new Set([...prev, 1]));
        stepCountRef.current += 1;
      } else if (decodingPhase === 'extract-field') {
        if (activeFieldIndex < fields.length - 1) {
          const nextIdx = activeFieldIndex + 1;
          setActiveFieldIndex(nextIdx);
          setRevealedFields(prev => new Set([...prev, nextIdx]));
          stepCountRef.current += 1;
        } else {
          setDecodingPhase('assemble');
          setDecodedText(instr.assembly);
          stepCountRef.current += 1;
        }
      } else if (decodingPhase === 'assemble') {
        setDecodingPhase('complete');
        setInstructionComplete(true);
        stepCountRef.current += 1;
      }
    }
  }, [program, currentInstrIndex, animationMode, fieldPhase, activeFieldIndex, decodingPhase, instructionComplete, allComplete]);

  // ── Animation Loop ──
  const animationLoop = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) return;
    const interval = Math.max(10, 400 / speedRef.current);
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
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
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
    setCurrentInstrIndex(0);
    setActiveFieldIndex(-1);
    setFieldPhase('idle');
    setDecodingPhase('idle');
    setRevealedFields(new Set());
    setDecodedText('');
    setInstructionComplete(false);
    setAllComplete(false);
    stepCountRef.current = 0;
  }, []);

  const loadScenario = useCallback((key: string) => {
    handleReset();
    const scenario = PRESET_SCENARIOS[key];
    if (!scenario) return;
    setSelectedScenario(key);
    setAnimationMode(scenario.mode);
    const lines: ProgramLine[] = scenario.instructions.map((asm, i) => {
      const instr = INSTRUCTIONS[asm];
      return {
        address: i * 4,
        instruction: instr,
        binary: instructionToBinary(instr),
      };
    });
    setProgram(lines);
    setShowScenarioDropdown(false);
  }, [handleReset]);

  // ── Load default on mount ──
  useEffect(() => {
    loadScenario('r_type');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helper: render bit-level binary display ──
  const renderBitDisplay = (binary: string, format: InstructionFormat, highlightFieldIdx: number, revealed: Set<number>) => {
    const fields = getFieldsForFormat(format);
    let bitOffset = 0;

    return (
      <div className="flex items-stretch gap-0 rounded-lg overflow-hidden border border-[#1e1e2e]">
        {fields.map((field, fIdx) => {
          const fieldBits = binary.slice(bitOffset, bitOffset + field.bits);
          bitOffset += field.bits;
          const isHighlighted = fIdx === highlightFieldIdx;
          const isRevealed = revealed.has(fIdx);
          const isActive = isHighlighted || isRevealed;

          return (
            <motion.div
              key={field.name}
              className="relative flex flex-col"
              animate={{
                scale: isHighlighted ? 1.02 : 1,
              }}
              transition={{ duration: 0.2 }}
            >
              {/* Field label */}
              <div
                className="px-2 py-1 text-[10px] font-mono font-bold text-center uppercase tracking-wider border-b"
                style={{
                  backgroundColor: isActive ? `${field.color}20` : '#111118',
                  color: isActive ? field.color : '#71717a',
                  borderColor: isActive ? `${field.color}40` : '#1e1e2e',
                }}
              >
                {field.name}
              </div>
              {/* Bits */}
              <div className="flex">
                {fieldBits.split('').map((bit, bIdx) => (
                  <motion.div
                    key={bIdx}
                    className="w-[18px] sm:w-[22px] h-8 flex items-center justify-center font-mono text-xs border-r last:border-r-0"
                    style={{
                      backgroundColor: isRevealed
                        ? `${field.color}15`
                        : isHighlighted
                        ? `${field.color}08`
                        : '#0d0d14',
                      color: isRevealed ? field.color : isHighlighted ? `${field.color}80` : '#2a2a3e',
                      borderColor: '#1e1e2e',
                    }}
                    initial={false}
                    animate={{
                      opacity: isRevealed ? 1 : isHighlighted ? 0.7 : 0.3,
                    }}
                    transition={{ duration: 0.15, delay: isRevealed ? bIdx * 0.02 : 0 }}
                  >
                    {isRevealed ? bit : isHighlighted ? bit : '\u2022'}
                  </motion.div>
                ))}
              </div>
              {/* Bit range */}
              <div
                className="px-1 py-0.5 text-[9px] font-mono text-center"
                style={{ color: isActive ? `${field.color}90` : '#3a3a4e' }}
              >
                [{field.bitRange[0]}:{field.bitRange[1]}]
              </div>
              {/* Highlight glow */}
              {isHighlighted && (
                <motion.div
                  className="absolute inset-0 pointer-events-none rounded-sm"
                  style={{ boxShadow: `inset 0 0 12px ${field.color}30, 0 0 8px ${field.color}15` }}
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
              )}
            </motion.div>
          );
        })}
      </div>
    );
  };

  // ── Render Format Diagram ──
  const renderFormatDiagram = (format: InstructionFormat) => {
    const fields = getFieldsForFormat(format);
    const totalBits = 32;

    return (
      <div className="flex items-center gap-0 w-full">
        {fields.map((field) => {
          const widthPercent = (field.bits / totalBits) * 100;
          return (
            <div
              key={field.name}
              className="flex flex-col items-center border border-[#1e1e2e] first:rounded-l-md last:rounded-r-md"
              style={{ width: `${widthPercent}%` }}
            >
              <div
                className="w-full py-1.5 text-center text-[10px] sm:text-xs font-mono font-bold uppercase"
                style={{ backgroundColor: `${field.color}15`, color: field.color }}
              >
                {field.name}
              </div>
              <div className="w-full py-1 text-center text-[10px] font-mono text-[#71717a] border-t border-[#1e1e2e]">
                {field.bits} bits
              </div>
            </div>
          );
        })}
      </div>
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
                2.1
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Instruction Set Architecture
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Explore MIPS instruction encoding and decoding. See how assembly instructions
              are translated into 32-bit binary machine code across R-type, I-type, and J-type formats.
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
            >
              {/* Mode toggle */}
              <button
                onClick={() => {
                  if (stepCountRef.current === 0) {
                    const newMode = animationMode === 'encode' ? 'decode' : 'encode';
                    setAnimationMode(newMode);
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                  animationMode === 'encode'
                    ? 'bg-[#8b5cf6]/15 text-[#8b5cf6] border border-[#8b5cf6]/30'
                    : 'bg-[#06b6d4]/15 text-[#06b6d4] border border-[#06b6d4]/30'
                } ${stepCountRef.current > 0 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <ArrowLeftRight size={14} />
                {animationMode === 'encode' ? 'Encoding' : 'Decoding'}
              </button>
            </ModuleControls>
          </div>

          {/* ── Main Visualization Area ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* ── Left Column: Instruction Memory / Program ── */}
            <motion.div
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              className="lg:col-span-1"
            >
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1e1e2e] flex items-center gap-2">
                  <Layers size={14} className="text-[#8b5cf6]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Instruction Memory
                  </span>
                </div>
                <div className="divide-y divide-[#1e1e2e]">
                  {program.map((line, idx) => {
                    const isCurrent = idx === currentInstrIndex;
                    const isPast = idx < currentInstrIndex;
                    const isDone = isPast || (isCurrent && instructionComplete);

                    return (
                      <motion.div
                        key={idx}
                        className={`px-4 py-3 transition-all duration-300 ${
                          isCurrent ? 'bg-[#8b5cf6]/8' : ''
                        }`}
                        animate={{
                          backgroundColor: isCurrent ? 'rgba(139,92,246,0.08)' : 'transparent',
                        }}
                      >
                        <div className="flex items-center gap-3">
                          {/* Address */}
                          <span className="text-[10px] font-mono text-[#71717a] w-10 flex-shrink-0">
                            0x{line.address.toString(16).padStart(4, '0')}
                          </span>
                          {/* Current indicator */}
                          <div className="w-1.5 flex-shrink-0">
                            {isCurrent && (
                              <motion.div
                                className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6]"
                                animate={{ scale: [1, 1.3, 1] }}
                                transition={{ duration: 1, repeat: Infinity }}
                              />
                            )}
                            {isDone && !isCurrent && (
                              <div className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                            )}
                          </div>
                          {/* Assembly */}
                          <div className="flex-1 min-w-0">
                            <div
                              className={`text-xs font-mono truncate ${
                                isCurrent ? 'text-white font-semibold' : isPast ? 'text-[#71717a]' : 'text-[#a1a1aa]'
                              }`}
                            >
                              {line.instruction.assembly}
                            </div>
                            <div className="text-[10px] font-mono text-[#3a3a4e] mt-0.5 truncate">
                              {isDone ? line.binary : animationMode === 'decode' && isCurrent
                                ? line.binary
                                : '???????????????????????????????????????????'}
                            </div>
                          </div>
                          {/* Format badge */}
                          <span
                            className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{
                              backgroundColor: line.instruction.format === 'R' ? '#10b98115' :
                                line.instruction.format === 'I' ? '#f59e0b15' : '#06b6d415',
                              color: line.instruction.format === 'R' ? '#10b981' :
                                line.instruction.format === 'I' ? '#f59e0b' : '#06b6d4',
                            }}
                          >
                            {line.instruction.format}-type
                          </span>
                        </div>
                      </motion.div>
                    );
                  })}
                  {program.length === 0 && (
                    <div className="px-4 py-8 text-center text-xs text-[#71717a]">
                      Select a preset to load instructions
                    </div>
                  )}
                </div>
              </div>
            </motion.div>

            {/* ── Right Column: Encoding/Decoding Visualization ── */}
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.2 }}
              className="lg:col-span-2"
            >
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
                {/* Current instruction header */}
                <div className="px-4 py-3 border-b border-[#1e1e2e] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {animationMode === 'encode' ? (
                      <Code2 size={14} className="text-[#8b5cf6]" />
                    ) : (
                      <Binary size={14} className="text-[#06b6d4]" />
                    )}
                    <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                      {animationMode === 'encode' ? 'Assembly → Binary Encoding' : 'Binary → Assembly Decoding'}
                    </span>
                  </div>
                  {currentInstr && (
                    <span
                      className="text-[10px] font-mono font-bold px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: currentInstr.format === 'R' ? '#10b98115' :
                          currentInstr.format === 'I' ? '#f59e0b15' : '#06b6d415',
                        color: currentInstr.format === 'R' ? '#10b981' :
                          currentInstr.format === 'I' ? '#f59e0b' : '#06b6d4',
                      }}
                    >
                      {currentInstr.format}-Type Format
                    </span>
                  )}
                </div>

                {currentInstr ? (
                  <div className="p-4 sm:p-6 space-y-6">
                    {/* ── Assembly Text ── */}
                    <div className="text-center">
                      {animationMode === 'encode' ? (
                        <motion.div
                          key={`asm-${currentInstrIndex}`}
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-2"
                        >
                          <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                            Assembly Instruction
                          </div>
                          <div className="text-xl sm:text-2xl font-mono font-bold text-white">
                            {currentInstr.assembly}
                          </div>
                          <div className="text-xs text-[#71717a]">
                            {currentInstr.description}
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key={`decode-${currentInstrIndex}`}
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-2"
                        >
                          <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                            32-bit Machine Code
                          </div>
                          <div className="text-sm sm:text-base font-mono font-bold text-[#06b6d4] break-all">
                            {currentBinary}
                          </div>
                        </motion.div>
                      )}
                    </div>

                    {/* ── Direction Arrow ── */}
                    <div className="flex items-center justify-center">
                      <motion.div
                        animate={{ y: [0, 4, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        className="flex items-center gap-2 text-[#71717a]"
                      >
                        <div className="h-px w-8 bg-[#2a2a3e]" />
                        {animationMode === 'encode' ? (
                          <ArrowRight size={16} className="text-[#8b5cf6]" />
                        ) : (
                          <ArrowRight size={16} className="text-[#06b6d4] rotate-180" />
                        )}
                        <div className="h-px w-8 bg-[#2a2a3e]" />
                      </motion.div>
                    </div>

                    {/* ── Format Structure Diagram ── */}
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium mb-2 text-center">
                        {currentInstr.format}-Type Format Structure (32 bits)
                      </div>
                      {renderFormatDiagram(currentInstr.format)}
                    </div>

                    {/* ── Bit-level Display ── */}
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium mb-2 text-center">
                        Encoded Instruction Word
                      </div>
                      <div className="flex justify-center overflow-x-auto pb-2">
                        {renderBitDisplay(
                          currentBinary,
                          currentInstr.format,
                          activeFieldIndex,
                          revealedFields
                        )}
                      </div>
                    </div>

                    {/* ── Field Breakdown ── */}
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium mb-3 text-center">
                        Field Values
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {currentFields.map((field, fIdx) => {
                          const isHighlighted = fIdx === activeFieldIndex;
                          const isRevealed = revealedFields.has(fIdx);
                          const fieldValue = currentInstr.fields[field.name] || '';

                          return (
                            <motion.div
                              key={field.name}
                              className="relative p-3 rounded-lg border transition-all duration-300"
                              style={{
                                backgroundColor: isRevealed
                                  ? `${field.color}10`
                                  : isHighlighted
                                  ? `${field.color}08`
                                  : '#0d0d14',
                                borderColor: isRevealed
                                  ? `${field.color}40`
                                  : isHighlighted
                                  ? `${field.color}25`
                                  : '#1e1e2e',
                              }}
                              animate={{
                                scale: isHighlighted ? 1.03 : 1,
                              }}
                              transition={{ duration: 0.2 }}
                            >
                              <div
                                className="text-[10px] font-mono font-bold uppercase mb-1"
                                style={{ color: isRevealed || isHighlighted ? field.color : '#71717a' }}
                              >
                                {field.name}
                              </div>
                              <div className="text-xs font-mono text-white mb-1">
                                {isRevealed ? fieldValue : isHighlighted ? '...' : '---'}
                              </div>
                              {isRevealed && (
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  className="text-[10px] text-[#71717a]"
                                >
                                  {field.name === 'rs' || field.name === 'rt' || field.name === 'rd' ? (
                                    <span>
                                      {REGISTER_NAMES[fieldValue] || `$${parseInt(fieldValue, 2)}`} (#{parseInt(fieldValue, 2)})
                                    </span>
                                  ) : field.name === 'immediate' ? (
                                    <span>= {parseInt(fieldValue, 2)}</span>
                                  ) : field.name === 'address' ? (
                                    <span>= {parseInt(fieldValue, 2)}</span>
                                  ) : field.name === 'shamt' ? (
                                    <span>= {parseInt(fieldValue, 2)}</span>
                                  ) : field.name === 'opcode' ? (
                                    <span>{currentInstr.format === 'R' ? 'R-type (0)' : `= ${parseInt(fieldValue, 2)}`}</span>
                                  ) : field.name === 'funct' ? (
                                    <span>{currentInstr.mnemonic} (= {parseInt(fieldValue, 2)})</span>
                                  ) : null}
                                </motion.div>
                              )}
                              {/* Pulsing highlight */}
                              {isHighlighted && (
                                <motion.div
                                  className="absolute inset-0 rounded-lg pointer-events-none"
                                  style={{ boxShadow: `0 0 12px ${field.color}20` }}
                                  animate={{ opacity: [0.3, 0.8, 0.3] }}
                                  transition={{ duration: 1.2, repeat: Infinity }}
                                />
                              )}
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Decoded Assembly (decode mode) ── */}
                    {animationMode === 'decode' && decodedText && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center p-4 bg-[#10b981]/10 border border-[#10b981]/20 rounded-lg"
                      >
                        <div className="text-[10px] uppercase tracking-wider text-[#10b981] font-medium mb-1">
                          Decoded Assembly
                        </div>
                        <div className="text-xl font-mono font-bold text-[#10b981]">
                          {decodedText}
                        </div>
                      </motion.div>
                    )}

                    {/* ── Completion ── */}
                    {instructionComplete && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center"
                      >
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20">
                          <Zap size={12} className="text-[#10b981]" />
                          <span className="text-xs text-[#10b981] font-medium">
                            {animationMode === 'encode' ? 'Encoding Complete' : 'Decoding Complete'}
                            {currentInstrIndex < program.length - 1 ? ' - Next instruction...' : ' - All done!'}
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </div>
                ) : (
                  <div className="p-8 text-center text-[#71717a] text-sm">
                    Select a preset to begin encoding/decoding
                  </div>
                )}
              </div>
            </motion.div>
          </div>

          {/* ── Bottom Section: Format Reference + Metrics + Education ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* ── Format Reference Cards ── */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.25 }}
              className="lg:col-span-1"
            >
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1e1e2e] flex items-center gap-2">
                  <BookOpen size={14} className="text-[#8b5cf6]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Format Reference
                  </span>
                </div>
                <div className="p-4 space-y-4">
                  {(['R', 'I', 'J'] as InstructionFormat[]).map((fmt) => {
                    const info = FORMAT_INFO[fmt];
                    const isActive = currentInstr?.format === fmt;
                    return (
                      <div
                        key={fmt}
                        className={`p-3 rounded-lg border transition-all duration-300 ${
                          isActive ? 'border-[#8b5cf6]/30 bg-[#8b5cf6]/5' : 'border-[#1e1e2e] bg-[#0d0d14]'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span
                            className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: fmt === 'R' ? '#10b98115' : fmt === 'I' ? '#f59e0b15' : '#06b6d415',
                              color: fmt === 'R' ? '#10b981' : fmt === 'I' ? '#f59e0b' : '#06b6d4',
                            }}
                          >
                            {fmt}
                          </span>
                          <span className={`text-xs font-semibold ${isActive ? 'text-white' : 'text-[#a1a1aa]'}`}>
                            {info.title}
                          </span>
                        </div>
                        <p className="text-[10px] text-[#71717a] mb-1.5">{info.description}</p>
                        {/* Mini format diagram */}
                        <div className="mb-1.5">
                          {renderFormatDiagram(fmt)}
                        </div>
                        <div className="text-[10px] text-[#71717a]">
                          <span className="text-[#a1a1aa] font-medium">Examples: </span>
                          {info.usage}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>

            {/* ── Metrics + Education ── */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
              className="lg:col-span-2"
            >
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
                          Metrics
                        </span>
                      </div>
                      <div className="p-4">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {/* Instruction count */}
                          <div className="p-3 rounded-lg bg-[#0d0d14] border border-[#1e1e2e]">
                            <div className="text-[10px] text-[#71717a] uppercase tracking-wider mb-1">
                              Instructions
                            </div>
                            <div className="text-lg font-mono font-bold text-white">
                              {currentInstrIndex + (instructionComplete ? 1 : 0)}/{program.length}
                            </div>
                          </div>
                          {/* Current format */}
                          <div className="p-3 rounded-lg bg-[#0d0d14] border border-[#1e1e2e]">
                            <div className="text-[10px] text-[#71717a] uppercase tracking-wider mb-1">
                              Current Format
                            </div>
                            <div className="text-lg font-mono font-bold"
                              style={{
                                color: currentInstr
                                  ? currentInstr.format === 'R' ? '#10b981' : currentInstr.format === 'I' ? '#f59e0b' : '#06b6d4'
                                  : '#71717a'
                              }}
                            >
                              {currentInstr ? `${currentInstr.format}-Type` : '--'}
                            </div>
                          </div>
                          {/* Field being processed */}
                          <div className="p-3 rounded-lg bg-[#0d0d14] border border-[#1e1e2e]">
                            <div className="text-[10px] text-[#71717a] uppercase tracking-wider mb-1">
                              Active Field
                            </div>
                            <div className="text-lg font-mono font-bold"
                              style={{
                                color: activeFieldIndex >= 0 && currentFields[activeFieldIndex]
                                  ? currentFields[activeFieldIndex].color
                                  : '#71717a'
                              }}
                            >
                              {activeFieldIndex >= 0 && currentFields[activeFieldIndex]
                                ? currentFields[activeFieldIndex].name
                                : '--'}
                            </div>
                          </div>
                          {/* Mode */}
                          <div className="p-3 rounded-lg bg-[#0d0d14] border border-[#1e1e2e]">
                            <div className="text-[10px] text-[#71717a] uppercase tracking-wider mb-1">
                              Mode
                            </div>
                            <div className="text-lg font-mono font-bold"
                              style={{ color: animationMode === 'encode' ? '#8b5cf6' : '#06b6d4' }}
                            >
                              {animationMode === 'encode' ? 'Encode' : 'Decode'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Educational Panel ── */}
              <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowEducation(!showEducation)}
                  className="w-full px-4 py-3 border-b border-[#1e1e2e] flex items-center justify-between hover:bg-[#16161f] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Info size={14} className="text-[#8b5cf6]" />
                    <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                      Understanding ISA Fields
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
                        {/* Opcode */}
                        <div className="flex gap-3">
                          <div className="w-1 rounded-full flex-shrink-0" style={{ backgroundColor: '#ef4444' }} />
                          <div>
                            <div className="text-xs font-semibold text-white mb-0.5">Opcode (6 bits)</div>
                            <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                              The operation code tells the CPU what type of instruction to execute. For R-type
                              instructions, the opcode is always 000000 and the actual operation is determined by the
                              funct field. For I-type and J-type, the opcode directly specifies the instruction.
                            </p>
                          </div>
                        </div>

                        {/* Register Fields */}
                        <div className="flex gap-3">
                          <div className="w-1 rounded-full flex-shrink-0" style={{ backgroundColor: '#6366f1' }} />
                          <div>
                            <div className="text-xs font-semibold text-white mb-0.5">Register Fields: rs, rt, rd (5 bits each)</div>
                            <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                              MIPS has 32 registers ($0-$31), each addressed with 5 bits. <span className="text-[#6366f1]">rs</span> is
                              the first source register, <span className="text-[#06b6d4]">rt</span> is the second source (or destination
                              in I-type), and <span className="text-[#10b981]">rd</span> is the destination register in R-type instructions.
                            </p>
                          </div>
                        </div>

                        {/* Shamt */}
                        <div className="flex gap-3">
                          <div className="w-1 rounded-full flex-shrink-0" style={{ backgroundColor: '#f59e0b' }} />
                          <div>
                            <div className="text-xs font-semibold text-white mb-0.5">Shift Amount (5 bits)</div>
                            <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                              Used only by shift instructions (SLL, SRL) to specify how many bit positions to shift.
                              For all other R-type instructions, this field is 00000.
                            </p>
                          </div>
                        </div>

                        {/* Funct */}
                        <div className="flex gap-3">
                          <div className="w-1 rounded-full flex-shrink-0" style={{ backgroundColor: '#a855f7' }} />
                          <div>
                            <div className="text-xs font-semibold text-white mb-0.5">Function Code (6 bits)</div>
                            <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                              The funct field distinguishes between R-type operations. Since all R-type instructions share
                              opcode 000000, this field specifies ADD (100000), SUB (100010), AND (100100), OR (100101), etc.
                            </p>
                          </div>
                        </div>

                        {/* Immediate */}
                        <div className="flex gap-3">
                          <div className="w-1 rounded-full flex-shrink-0" style={{ backgroundColor: '#f59e0b' }} />
                          <div>
                            <div className="text-xs font-semibold text-white mb-0.5">Immediate (16 bits)</div>
                            <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                              I-type instructions include a 16-bit constant value. This can be a memory offset
                              (for LW/SW), an arithmetic operand (ADDI), or a branch offset (BEQ/BNE).
                              The value is sign-extended to 32 bits before use.
                            </p>
                          </div>
                        </div>

                        {/* Address */}
                        <div className="flex gap-3">
                          <div className="w-1 rounded-full flex-shrink-0" style={{ backgroundColor: '#06b6d4' }} />
                          <div>
                            <div className="text-xs font-semibold text-white mb-0.5">Jump Address (26 bits)</div>
                            <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                              J-type instructions provide 26 bits for the target address. The full 32-bit address is
                              formed by taking the upper 4 bits of PC+4 and appending the 26-bit address shifted left by 2
                              (word-aligned), giving a 256 MB jump range.
                            </p>
                          </div>
                        </div>

                        {/* Key Concepts */}
                        <div className="mt-4 p-3 rounded-lg bg-[#8b5cf6]/5 border border-[#8b5cf6]/15">
                          <div className="text-xs font-semibold text-[#8b5cf6] mb-2">Key Concepts</div>
                          <ul className="space-y-1.5">
                            <li className="text-[11px] text-[#a1a1aa] flex items-start gap-2">
                              <span className="text-[#8b5cf6] mt-0.5">*</span>
                              <span>All MIPS instructions are exactly 32 bits (fixed-length encoding), simplifying fetch and decode hardware.</span>
                            </li>
                            <li className="text-[11px] text-[#a1a1aa] flex items-start gap-2">
                              <span className="text-[#8b5cf6] mt-0.5">*</span>
                              <span>The opcode is always in bits [31:26], allowing the control unit to quickly determine the format.</span>
                            </li>
                            <li className="text-[11px] text-[#a1a1aa] flex items-start gap-2">
                              <span className="text-[#8b5cf6] mt-0.5">*</span>
                              <span>R-type uses 3 register addresses + funct; I-type uses 2 registers + 16-bit immediate; J-type uses 26-bit address.</span>
                            </li>
                            <li className="text-[11px] text-[#a1a1aa] flex items-start gap-2">
                              <span className="text-[#8b5cf6] mt-0.5">*</span>
                              <span>ISA design balances instruction expressiveness against fixed-width encoding constraints.</span>
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

          {/* ── All Formats Comparison Table ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.35 }}
            className="mb-6"
          >
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1e1e2e] flex items-center gap-2">
                <Cpu size={14} className="text-[#8b5cf6]" />
                <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                  Complete Encoding Table
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#1e1e2e]">
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#71717a] uppercase tracking-wider">Assembly</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#71717a] uppercase tracking-wider">Format</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#71717a] uppercase tracking-wider">
                        <span style={{ color: '#ef4444' }}>Opcode</span>
                      </th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#71717a] uppercase tracking-wider">
                        <span style={{ color: '#6366f1' }}>rs</span>
                      </th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#71717a] uppercase tracking-wider">
                        <span style={{ color: '#06b6d4' }}>rt</span>
                      </th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#71717a] uppercase tracking-wider">
                        <span style={{ color: '#10b981' }}>rd</span> / <span style={{ color: '#f59e0b' }}>imm</span> / <span style={{ color: '#06b6d4' }}>addr</span>
                      </th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#71717a] uppercase tracking-wider">
                        <span style={{ color: '#a855f7' }}>funct</span>
                      </th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#71717a] uppercase tracking-wider">Binary (32-bit)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e1e2e]">
                    {program.map((line, idx) => {
                      const instr = line.instruction;
                      const isCurrent = idx === currentInstrIndex;
                      const fields = instr.fields;

                      return (
                        <tr
                          key={idx}
                          className={`transition-colors duration-200 ${
                            isCurrent ? 'bg-[#8b5cf6]/8' : 'hover:bg-[#16161f]'
                          }`}
                        >
                          <td className="px-4 py-2.5 font-mono font-semibold text-white whitespace-nowrap">
                            {instr.assembly}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: instr.format === 'R' ? '#10b98115' : instr.format === 'I' ? '#f59e0b15' : '#06b6d415',
                                color: instr.format === 'R' ? '#10b981' : instr.format === 'I' ? '#f59e0b' : '#06b6d4',
                              }}
                            >
                              {instr.format}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-mono" style={{ color: '#ef4444' }}>
                            {fields.opcode}
                          </td>
                          <td className="px-4 py-2.5 font-mono" style={{ color: '#6366f1' }}>
                            {fields.rs || '--'}
                          </td>
                          <td className="px-4 py-2.5 font-mono" style={{ color: '#06b6d4' }}>
                            {fields.rt || '--'}
                          </td>
                          <td className="px-4 py-2.5 font-mono">
                            {instr.format === 'R' ? (
                              <span>
                                <span style={{ color: '#10b981' }}>{fields.rd}</span>
                                {' '}
                                <span style={{ color: '#f59e0b' }}>{fields.shamt}</span>
                              </span>
                            ) : instr.format === 'I' ? (
                              <span style={{ color: '#f59e0b' }}>{fields.immediate}</span>
                            ) : (
                              <span style={{ color: '#06b6d4' }}>{fields.address}</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 font-mono" style={{ color: '#a855f7' }}>
                            {instr.format === 'R' ? fields.funct : '--'}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[#71717a] text-[10px]">
                            {line.binary}
                          </td>
                        </tr>
                      );
                    })}
                    {program.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-6 text-center text-[#71717a]">
                          Load a preset to see the encoding table
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>

          {/* ── Register Quick Reference ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.4 }}
            className="mb-6"
          >
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1e1e2e] flex items-center gap-2">
                <Binary size={14} className="text-[#8b5cf6]" />
                <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                  MIPS Register Reference
                </span>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                  {[
                    { name: '$zero', num: 0, desc: 'Constant 0' },
                    { name: '$at', num: 1, desc: 'Assembler temp' },
                    { name: '$v0', num: 2, desc: 'Return value' },
                    { name: '$v1', num: 3, desc: 'Return value' },
                    { name: '$a0', num: 4, desc: 'Argument' },
                    { name: '$a1', num: 5, desc: 'Argument' },
                    { name: '$a2', num: 6, desc: 'Argument' },
                    { name: '$a3', num: 7, desc: 'Argument' },
                    { name: '$t0', num: 8, desc: 'Temporary' },
                    { name: '$t1', num: 9, desc: 'Temporary' },
                    { name: '$t2', num: 10, desc: 'Temporary' },
                    { name: '$t3', num: 11, desc: 'Temporary' },
                    { name: '$t4', num: 12, desc: 'Temporary' },
                    { name: '$t5', num: 13, desc: 'Temporary' },
                    { name: '$t6', num: 14, desc: 'Temporary' },
                    { name: '$t7', num: 15, desc: 'Temporary' },
                    { name: '$s0', num: 16, desc: 'Saved' },
                    { name: '$s1', num: 17, desc: 'Saved' },
                    { name: '$s2', num: 18, desc: 'Saved' },
                    { name: '$s3', num: 19, desc: 'Saved' },
                    { name: '$s4', num: 20, desc: 'Saved' },
                    { name: '$s5', num: 21, desc: 'Saved' },
                    { name: '$s6', num: 22, desc: 'Saved' },
                    { name: '$s7', num: 23, desc: 'Saved' },
                    { name: '$t8', num: 24, desc: 'Temporary' },
                    { name: '$t9', num: 25, desc: 'Temporary' },
                    { name: '$gp', num: 28, desc: 'Global ptr' },
                    { name: '$sp', num: 29, desc: 'Stack ptr' },
                    { name: '$fp', num: 30, desc: 'Frame ptr' },
                    { name: '$ra', num: 31, desc: 'Return addr' },
                  ].map((reg) => {
                    // Highlight registers used in current instruction
                    const isUsed = currentInstr && (
                      REGISTER_NAMES[currentInstr.fields.rs] === reg.name ||
                      REGISTER_NAMES[currentInstr.fields.rt] === reg.name ||
                      REGISTER_NAMES[currentInstr.fields.rd] === reg.name
                    );

                    return (
                      <div
                        key={reg.name}
                        className={`p-2 rounded-lg border text-center transition-all duration-200 ${
                          isUsed
                            ? 'border-[#8b5cf6]/30 bg-[#8b5cf6]/8'
                            : 'border-[#1e1e2e] bg-[#0d0d14]'
                        }`}
                      >
                        <div className={`text-[10px] font-mono font-bold ${isUsed ? 'text-[#8b5cf6]' : 'text-[#a1a1aa]'}`}>
                          {reg.name}
                        </div>
                        <div className="text-[9px] font-mono text-[#3a3a4e]">
                          #{reg.num} ({regNumToBin(reg.num)})
                        </div>
                        <div className="text-[9px] text-[#71717a] mt-0.5">{reg.desc}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Instruction Set Summary ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.45 }}
            className="mb-6"
          >
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1e1e2e] flex items-center gap-2">
                <Layers size={14} className="text-[#8b5cf6]" />
                <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                  Supported Instruction Set
                </span>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Object.values(INSTRUCTIONS).map((instr) => (
                    <div
                      key={instr.assembly}
                      className="p-3 rounded-lg bg-[#0d0d14] border border-[#1e1e2e] hover:border-[#2a2a3e] transition-all duration-200"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-mono font-bold text-white">{instr.mnemonic}</span>
                        <span
                          className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: instr.format === 'R' ? '#10b98115' : instr.format === 'I' ? '#f59e0b15' : '#06b6d415',
                            color: instr.format === 'R' ? '#10b981' : instr.format === 'I' ? '#f59e0b' : '#06b6d4',
                          }}
                        >
                          {instr.format}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-[#a1a1aa] mb-1">{instr.assembly}</div>
                      <div className="text-[10px] text-[#71717a]">{instr.description}</div>
                      <div className="mt-1.5 text-[9px] font-mono text-[#3a3a4e] break-all">
                        {instructionToBinary(instr)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>

        </div>
      </main>
    </div>
  );
}
