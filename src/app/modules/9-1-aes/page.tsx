"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lock,
  Shield,
  Activity,
  Zap,
  Grid3X3,
  KeyRound,
  ArrowRight,
  RotateCcw,
  ChevronRight,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

/* ═══════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════ */

type AESOperation = "idle" | "sub-bytes" | "shift-rows" | "mix-columns" | "add-round-key";
type ScenarioName = "simple-text" | "all-zeros" | "round-details" | "full-encryption";
type CellState = "unchanged" | "active" | "changed";

interface AESState {
  stateMatrix: number[][];
  prevMatrix: number[][];
  cellStates: CellState[][];
  round: number;
  operation: AESOperation;
  subStep: number;
  totalRounds: number;
  roundsCompleted: number;
  bytesChanged: number;
  key: number[];
  roundKeys: number[][][];
  plaintext: number[];
  phase: "idle" | "running" | "complete";
}

// AES S-Box
const SBOX: number[] = [
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
];

// Rcon values
const RCON: number[] = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

// GF(2^8) multiplication
function gmul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

// Convert flat 16-byte array to 4x4 column-major matrix
function toMatrix(bytes: number[]): number[][] {
  const matrix: number[][] = Array.from({ length: 4 }, () => Array(4).fill(0));
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      matrix[r][c] = bytes[c * 4 + r];
    }
  }
  return matrix;
}

// Key expansion
function expandKey(key: number[]): number[][][] {
  const w: number[][] = [];
  // Initial key words
  for (let i = 0; i < 4; i++) {
    w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
  }
  // Expand
  for (let i = 4; i < 44; i++) {
    let temp = [...w[i - 1]];
    if (i % 4 === 0) {
      temp = [temp[1], temp[2], temp[3], temp[0]]; // RotWord
      temp = temp.map((b) => SBOX[b]); // SubWord
      temp[0] ^= RCON[i / 4 - 1]; // XOR Rcon
    }
    w.push(w[i - 4].map((b, j) => b ^ temp[j]));
  }
  // Convert to round key matrices
  const roundKeys: number[][][] = [];
  for (let r = 0; r <= 10; r++) {
    const rkMatrix: number[][] = Array.from({ length: 4 }, () => Array(4).fill(0));
    for (let c = 0; c < 4; c++) {
      for (let row = 0; row < 4; row++) {
        rkMatrix[row][c] = w[r * 4 + c][row];
      }
    }
    roundKeys.push(rkMatrix);
  }
  return roundKeys;
}

// AES operations
function subBytes(matrix: number[][]): number[][] {
  return matrix.map((row) => row.map((b) => SBOX[b]));
}

function shiftRows(matrix: number[][]): number[][] {
  const result = matrix.map((row) => [...row]);
  for (let r = 1; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      result[r][c] = matrix[r][(c + r) % 4];
    }
  }
  return result;
}

function mixColumns(matrix: number[][]): number[][] {
  const result: number[][] = Array.from({ length: 4 }, () => Array(4).fill(0));
  for (let c = 0; c < 4; c++) {
    result[0][c] = gmul(2, matrix[0][c]) ^ gmul(3, matrix[1][c]) ^ matrix[2][c] ^ matrix[3][c];
    result[1][c] = matrix[0][c] ^ gmul(2, matrix[1][c]) ^ gmul(3, matrix[2][c]) ^ matrix[3][c];
    result[2][c] = matrix[0][c] ^ matrix[1][c] ^ gmul(2, matrix[2][c]) ^ gmul(3, matrix[3][c]);
    result[3][c] = gmul(3, matrix[0][c]) ^ matrix[1][c] ^ matrix[2][c] ^ gmul(2, matrix[3][c]);
  }
  return result;
}

function addRoundKey(matrix: number[][], roundKey: number[][]): number[][] {
  return matrix.map((row, r) => row.map((b, c) => b ^ roundKey[r][c]));
}

function computeCellStates(prev: number[][], next: number[][]): CellState[][] {
  return prev.map((row, r) =>
    row.map((_, c) => (prev[r][c] !== next[r][c] ? "changed" : "unchanged"))
  );
}

const OPERATION_NAMES: Record<AESOperation, string> = {
  "idle": "Idle",
  "sub-bytes": "SubBytes",
  "shift-rows": "ShiftRows",
  "mix-columns": "MixColumns",
  "add-round-key": "AddRoundKey",
};

const OPERATION_ORDER: AESOperation[] = ["sub-bytes", "shift-rows", "mix-columns", "add-round-key"];
const LAST_ROUND_OPS: AESOperation[] = ["sub-bytes", "shift-rows", "add-round-key"];

const SCENARIOS: { key: ScenarioName; label: string; icon: React.ReactNode }[] = [
  { key: "simple-text", label: "Simple Text", icon: <Grid3X3 size={13} /> },
  { key: "all-zeros", label: "All Zeros", icon: <RotateCcw size={13} /> },
  { key: "round-details", label: "Round Details", icon: <KeyRound size={13} /> },
  { key: "full-encryption", label: "Full Encryption", icon: <Lock size={13} /> },
];

const DEFAULT_PLAINTEXT = [0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64, 0x21, 0x00, 0x00, 0x00, 0x00]; // "Hello World!"
const DEFAULT_KEY = [0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6, 0xab, 0xf7, 0x15, 0x88, 0x09, 0xcf, 0x4f, 0x3c];

function createInitialState(plaintext?: number[], key?: number[]): AESState {
  const pt = plaintext || DEFAULT_PLAINTEXT;
  const k = key || DEFAULT_KEY;
  const roundKeys = expandKey(k);
  const initialMatrix = addRoundKey(toMatrix(pt), roundKeys[0]);
  const cellStates: CellState[][] = Array.from({ length: 4 }, () => Array(4).fill("unchanged"));

  return {
    stateMatrix: initialMatrix,
    prevMatrix: toMatrix(pt),
    cellStates,
    round: 1,
    operation: "idle",
    subStep: 0,
    totalRounds: 10,
    roundsCompleted: 0,
    bytesChanged: 0,
    key: k,
    roundKeys,
    plaintext: pt,
    phase: "idle",
  };
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function AESEncryptionPage() {
  /* ─── State ─── */
  const [aesState, setAesState] = useState<AESState>(createInitialState);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioName>("simple-text");
  const [selectedRound, setSelectedRound] = useState(1);
  const [inputText, setInputText] = useState("Hello World!");
  const [inputKey, setInputKey] = useState("2b7e151628aed2a6abf7158809cf4f3c");
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [showKeySchedule, setShowKeySchedule] = useState(false);
  const [eventLog, setEventLog] = useState<{ time: number; round: number; op: string; changed: number }[]>([]);

  /* ─── Refs ─── */
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  /* ─── Step forward ─── */
  const stepForward = useCallback(() => {
    setAesState((prev) => {
      if (prev.phase === "complete") return prev;

      const next: AESState = {
        ...prev,
        stateMatrix: prev.stateMatrix.map((row) => [...row]),
        prevMatrix: prev.prevMatrix.map((row) => [...row]),
        cellStates: prev.cellStates.map((row) => [...row]),
        phase: "running",
      };

      const isLastRound = prev.round === 10;
      const ops = isLastRound ? LAST_ROUND_OPS : OPERATION_ORDER;

      if (prev.operation === "idle") {
        // Start first operation of current round
        next.operation = ops[0];
        next.subStep = 0;

        // Set cells active
        next.cellStates = Array.from({ length: 4 }, () => Array(4).fill("active" as CellState));
        return next;
      }

      // Apply current operation
      const prevMatrix = prev.stateMatrix.map((row) => [...row]);
      let newMatrix: number[][];

      switch (prev.operation) {
        case "sub-bytes":
          newMatrix = subBytes(prev.stateMatrix);
          break;
        case "shift-rows":
          newMatrix = shiftRows(prev.stateMatrix);
          break;
        case "mix-columns":
          newMatrix = mixColumns(prev.stateMatrix);
          break;
        case "add-round-key":
          newMatrix = addRoundKey(prev.stateMatrix, prev.roundKeys[prev.round]);
          break;
        default:
          newMatrix = prev.stateMatrix.map((r) => [...r]);
      }

      next.stateMatrix = newMatrix;
      next.prevMatrix = prevMatrix;
      next.cellStates = computeCellStates(prevMatrix, newMatrix);

      // Count changed bytes
      let changed = 0;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          if (prevMatrix[r][c] !== newMatrix[r][c]) changed++;
        }
      }
      next.bytesChanged = changed;

      // Log event
      setEventLog((prevLog) => [
        { time: Date.now(), round: prev.round, op: OPERATION_NAMES[prev.operation], changed },
        ...prevLog.slice(0, 49),
      ]);

      // Advance to next operation or round
      const currentOpIdx = ops.indexOf(prev.operation);
      if (currentOpIdx < ops.length - 1) {
        next.operation = ops[currentOpIdx + 1];
        next.subStep = currentOpIdx + 1;
      } else {
        // Round complete
        next.roundsCompleted = prev.round;

        if (prev.round < 10) {
          next.round = prev.round + 1;
          next.operation = "idle";
          next.subStep = 0;
          next.cellStates = Array.from({ length: 4 }, () => Array(4).fill("unchanged" as CellState));
        } else {
          next.phase = "complete";
          next.operation = "idle";
        }
      }

      return next;
    });
  }, []);

  /* ─── Animation loop ─── */
  const animationLoop = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) return;
    const interval = Math.max(10, 400 / speedRef.current);
    if (timestamp - lastTickRef.current >= interval) {
      lastTickRef.current = timestamp;
      stepForward();
    }
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [stepForward]);

  useEffect(() => () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); }, []);

  /* ─── Controls ─── */
  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    isPlayingRef.current = true;
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const handleStep = useCallback(() => {
    handlePause();
    stepForward();
  }, [handlePause, stepForward]);

  const handleReset = useCallback(() => {
    handlePause();
    // Parse input
    const pt: number[] = [];
    for (let i = 0; i < 16; i++) {
      pt.push(i < inputText.length ? inputText.charCodeAt(i) & 0xff : 0);
    }
    const k: number[] = [];
    const cleanHex = inputKey.replace(/\s/g, "");
    for (let i = 0; i < 16; i++) {
      const hex = cleanHex.substring(i * 2, i * 2 + 2);
      k.push(hex ? parseInt(hex, 16) || 0 : 0);
    }
    setAesState(createInitialState(pt, k));
    setEventLog([]);
  }, [handlePause, inputText, inputKey]);

  /* ─── Stop on complete ─── */
  useEffect(() => {
    if (aesState.phase === "complete" && isPlaying) {
      handlePause();
    }
  }, [aesState.phase, isPlaying, handlePause]);

  /* ─── Scenarios ─── */
  const runScenario = useCallback((scenario: ScenarioName) => {
    handlePause();
    setSelectedScenario(scenario);

    let pt: number[];
    let k = DEFAULT_KEY;

    switch (scenario) {
      case "simple-text":
        pt = DEFAULT_PLAINTEXT;
        setInputText("Hello World!");
        break;
      case "all-zeros":
        pt = Array(16).fill(0);
        setInputText("\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0");
        break;
      case "round-details":
        pt = DEFAULT_PLAINTEXT;
        setInputText("Hello World!");
        break;
      case "full-encryption":
        pt = DEFAULT_PLAINTEXT;
        setInputText("Hello World!");
        break;
    }

    setAesState(createInitialState(pt!, k));
    setEventLog([]);

    setTimeout(() => {
      setIsPlaying(true);
      isPlayingRef.current = true;
      lastTickRef.current = 0;
      animationRef.current = requestAnimationFrame(animationLoop);
    }, 50);
  }, [handlePause, animationLoop]);

  /* ─── Track selected round ─── */
  useEffect(() => {
    setSelectedRound(aesState.round);
  }, [aesState.round]);

  /* ─── Operation color ─── */
  const getOpColor = (op: AESOperation): string => {
    switch (op) {
      case "sub-bytes": return "#f59e0b";
      case "shift-rows": return "#06b6d4";
      case "mix-columns": return "#a855f7";
      case "add-round-key": return "#10b981";
      default: return "#71717a";
    }
  };

  const getCellColor = (state: CellState): string => {
    switch (state) {
      case "active": return "#f59e0b";
      case "changed": return "#6366f1";
      default: return "#71717a";
    }
  };

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />

      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* ── Header ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs font-mono font-medium px-2 py-1 rounded bg-[#f97316]/15 text-[#f97316] border border-[#f97316]/20">
                9.1
              </span>
              <div className="flex items-center gap-1.5 text-xs text-[#71717a]">
                <Shield size={12} />
                <span>Cryptography & Security</span>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Symmetric Encryption (AES)</h1>
            <p className="mt-1.5 text-[#a1a1aa] text-sm sm:text-base max-w-2xl">
              Watch AES-128 encrypt data through 10 rounds of SubBytes, ShiftRows, MixColumns,
              and AddRoundKey transformations on a 4x4 state matrix.
            </p>
          </motion.div>

          {/* ── Input section ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex flex-wrap items-end gap-3 mb-4"
          >
            <div className="flex-1 min-w-[200px]">
              <label className="text-[10px] text-[#71717a] uppercase tracking-wider block mb-1">Plaintext (ASCII)</label>
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value.slice(0, 16))}
                maxLength={16}
                className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-xs font-mono text-white focus:border-[#6366f1] focus:outline-none transition-colors"
                placeholder="16 chars max"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-[10px] text-[#71717a] uppercase tracking-wider block mb-1">Key (hex, 32 chars)</label>
              <input
                type="text"
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 32))}
                maxLength={32}
                className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-xs font-mono text-white focus:border-[#6366f1] focus:outline-none transition-colors"
                placeholder="2b7e151628aed2a6..."
              />
            </div>

            <div className="flex items-center gap-2">
              {SCENARIOS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => runScenario(s.key)}
                  className={`flex items-center gap-1 px-2.5 py-2 text-xs rounded-lg transition-all duration-200 ${
                    selectedScenario === s.key
                      ? "bg-[#f97316]/15 border border-[#f97316]/30 text-[#f97316]"
                      : "bg-[#1e1e2e] border border-[#1e1e2e] text-[#71717a] hover:bg-[#2a2a3e] hover:text-[#a1a1aa]"
                  }`}
                >
                  {s.icon}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              ))}
            </div>
          </motion.div>

          {/* ── Main visualization ── */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 mb-4">
            <div className="space-y-4">
              {/* ── Round progress ── */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <ArrowRight size={14} className="text-[#f97316]" />
                  <span className="text-sm font-semibold">Round Progress</span>
                  <span className="text-xs text-[#71717a] font-mono ml-auto">
                    Round {aesState.round}/10
                  </span>
                </div>

                {/* Round indicators */}
                <div className="flex items-center gap-1 mb-3">
                  <div
                    className="px-2 py-1 rounded text-[9px] font-mono font-bold bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/20"
                  >
                    Init
                  </div>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((r) => {
                    const isCurrent = r === aesState.round && aesState.phase !== "complete";
                    const isCompleted = r < aesState.round || aesState.phase === "complete";

                    return (
                      <motion.button
                        key={r}
                        onClick={() => setSelectedRound(r)}
                        className="px-2 py-1 rounded text-[9px] font-mono font-bold transition-all duration-150"
                        style={{
                          backgroundColor: isCurrent ? "#6366f130" : isCompleted ? "#10b98115" : "#1e1e2e",
                          color: isCurrent ? "#6366f1" : isCompleted ? "#10b981" : "#3a3a4e",
                          border: `1px solid ${isCurrent ? "#6366f1" : isCompleted ? "#10b98130" : "#1e1e2e"}`,
                        }}
                        animate={isCurrent ? { scale: [1, 1.1, 1] } : {}}
                        transition={{ duration: 0.8, repeat: isCurrent ? Infinity : 0 }}
                      >
                        R{r}
                      </motion.button>
                    );
                  })}
                </div>

                {/* Operation steps */}
                <div className="flex items-center gap-1">
                  {(aesState.round === 10 ? LAST_ROUND_OPS : OPERATION_ORDER).map((op, idx) => {
                    const isCurrent = op === aesState.operation;
                    const isCompleted = aesState.operation === "idle"
                      ? false
                      : (aesState.round === 10 ? LAST_ROUND_OPS : OPERATION_ORDER).indexOf(aesState.operation) > idx;
                    const opColor = getOpColor(op);

                    return (
                      <div key={op} className="flex items-center gap-1">
                        {idx > 0 && <ChevronRight size={10} className="text-[#2a2a3e]" />}
                        <div
                          className="px-2.5 py-1.5 rounded-lg text-[10px] font-mono font-bold transition-all duration-200"
                          style={{
                            backgroundColor: isCurrent ? `${opColor}20` : isCompleted ? `${opColor}10` : "#0a0a0f",
                            color: isCurrent ? opColor : isCompleted ? `${opColor}80` : "#3a3a4e",
                            border: `1px solid ${isCurrent ? opColor : "#1e1e2e"}`,
                            boxShadow: isCurrent ? `0 0 12px ${opColor}20` : "none",
                          }}
                        >
                          {OPERATION_NAMES[op]}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>

              {/* ── State matrix ── */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
              >
                <div className="flex items-center gap-2 mb-4">
                  <Grid3X3 size={14} className="text-[#6366f1]" />
                  <span className="text-sm font-semibold">State Matrix</span>
                  <span className="text-xs text-[#71717a] font-mono ml-auto">
                    {OPERATION_NAMES[aesState.operation]}
                    {aesState.operation !== "idle" && (
                      <span style={{ color: getOpColor(aesState.operation) }}>
                        {" "}active
                      </span>
                    )}
                  </span>
                </div>

                {/* 4x4 grid */}
                <div className="flex justify-center">
                  <div className="inline-grid grid-cols-4 gap-2">
                    {aesState.stateMatrix.map((row, r) =>
                      row.map((byte, c) => {
                        const cellState = aesState.cellStates[r][c];
                        const cellColor = getCellColor(cellState);
                        const isActive = cellState === "active";
                        const isChanged = cellState === "changed";

                        return (
                          <motion.div
                            key={`${r}-${c}`}
                            className="w-16 h-16 rounded-lg flex flex-col items-center justify-center font-mono border-2 relative"
                            style={{
                              backgroundColor: isChanged ? "#6366f115" : isActive ? "#f59e0b08" : "#0a0a0f",
                              borderColor: isChanged ? "#6366f1" : isActive ? "#f59e0b40" : "#1e1e2e",
                            }}
                            animate={{
                              boxShadow: isChanged
                                ? `0 0 15px ${cellColor}30`
                                : isActive
                                ? `0 0 8px ${cellColor}15`
                                : "none",
                              scale: isChanged ? 1.05 : 1,
                            }}
                            transition={{ duration: 0.2 }}
                          >
                            <span
                              className="text-lg font-bold"
                              style={{ color: isChanged ? "#6366f1" : isActive ? "#f59e0b" : "#a1a1aa" }}
                            >
                              {byte.toString(16).padStart(2, "0").toUpperCase()}
                            </span>
                            <span className="text-[8px] text-[#3a3a4e] mt-0.5">
                              [{r},{c}]
                            </span>
                          </motion.div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Operation description */}
                <div className="mt-4 p-3 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]">
                  <div className="text-xs text-[#71717a]">
                    {aesState.operation === "idle" && "Press Step or Play to advance through AES operations."}
                    {aesState.operation === "sub-bytes" && (
                      <span>
                        <span className="text-[#f59e0b] font-semibold">SubBytes:</span> Each byte is replaced by its corresponding value in the S-Box lookup table.
                        This provides non-linearity in the cipher.
                      </span>
                    )}
                    {aesState.operation === "shift-rows" && (
                      <span>
                        <span className="text-[#06b6d4] font-semibold">ShiftRows:</span> Row 0 unchanged, Row 1 shifts left by 1, Row 2 by 2, Row 3 by 3.
                        This provides diffusion across columns.
                      </span>
                    )}
                    {aesState.operation === "mix-columns" && (
                      <span>
                        <span className="text-[#a855f7] font-semibold">MixColumns:</span> Each column is multiplied by a fixed matrix in GF(2^8).
                        This mixes bytes within each column for diffusion.
                      </span>
                    )}
                    {aesState.operation === "add-round-key" && (
                      <span>
                        <span className="text-[#10b981] font-semibold">AddRoundKey:</span> Each byte is XORed with the corresponding byte of the round key.
                        This is the only step that introduces key material.
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>

              {/* ── Round key schedule ── */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.25 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden"
              >
                <button
                  onClick={() => setShowKeySchedule(!showKeySchedule)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold hover:bg-[#1e1e2e]/30 transition-colors"
                >
                  <KeyRound size={14} className="text-[#10b981]" />
                  Round Key Schedule
                  <ChevronRight
                    size={14}
                    className="text-[#71717a] ml-auto transition-transform duration-200"
                    style={{ transform: showKeySchedule ? "rotate(90deg)" : "rotate(0deg)" }}
                  />
                </button>

                <AnimatePresence>
                  {showKeySchedule && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 space-y-2 max-h-64 overflow-y-auto">
                        {aesState.roundKeys.map((rk, r) => {
                          const isCurrent = r === aesState.round;
                          return (
                            <div
                              key={r}
                              className="flex items-center gap-2 p-2 rounded-lg"
                              style={{
                                backgroundColor: isCurrent ? "#6366f110" : "transparent",
                                border: `1px solid ${isCurrent ? "#6366f130" : "transparent"}`,
                              }}
                            >
                              <span className="text-[10px] font-mono font-bold w-6 shrink-0"
                                    style={{ color: isCurrent ? "#6366f1" : "#71717a" }}>
                                {r === 0 ? "K0" : `K${r}`}
                              </span>
                              <div className="flex gap-0.5 flex-wrap">
                                {rk.flat().map((b, i) => (
                                  <span key={i} className="text-[9px] font-mono px-1 py-0.5 rounded bg-[#0a0a0f]"
                                        style={{ color: isCurrent ? "#6366f1" : "#71717a" }}>
                                    {b.toString(16).padStart(2, "0")}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>

            {/* ── Right column: Metrics & Info ── */}
            <div className="space-y-4">
              <AnimatePresence>
                {showMetrics && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Activity size={14} className="text-[#f97316]" />
                        <span className="text-sm font-medium text-[#a1a1aa]">Encryption Metrics</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <MetricCard label="Round" value={`${aesState.round}/10`} color="#6366f1" />
                        <MetricCard label="Operation" value={OPERATION_NAMES[aesState.operation]} color={getOpColor(aesState.operation)} />
                        <MetricCard label="Bytes Changed" value={String(aesState.bytesChanged)} color="#f59e0b" />
                        <MetricCard label="Rounds Done" value={String(aesState.roundsCompleted)} color="#10b981" />
                      </div>

                      {/* Phase indicator */}
                      <div className="flex items-center gap-2 mt-1">
                        <div className={`w-2 h-2 rounded-full ${
                          aesState.phase === "complete" ? "bg-[#10b981]" :
                          aesState.phase === "running" ? "bg-[#f59e0b] animate-pulse" :
                          "bg-[#71717a]"
                        }`} />
                        <span className="text-xs text-[#a1a1aa] capitalize">{aesState.phase}</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Legend ── */}
              <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4">
                <div className="text-xs font-medium text-[#a1a1aa] mb-2">Cell Colors</div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded border-2 border-[#71717a] bg-[#0a0a0f]" />
                    <span className="text-[10px] text-[#71717a]">Unchanged byte</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded border-2 border-[#f59e0b] bg-[#f59e0b15]" />
                    <span className="text-[10px] text-[#f59e0b]">Active operation glow</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded border-2 border-[#6366f1] bg-[#6366f115]" />
                    <span className="text-[10px] text-[#6366f1]">Changed by operation</span>
                  </div>
                </div>

                <div className="text-xs font-medium text-[#a1a1aa] mt-3 mb-2">Operations</div>
                <div className="space-y-1.5">
                  {OPERATION_ORDER.map((op) => (
                    <div key={op} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getOpColor(op) }} />
                      <span className="text-[10px]" style={{ color: getOpColor(op) }}>{OPERATION_NAMES[op]}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Plaintext & Ciphertext ── */}
              <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4 space-y-3">
                <div className="text-xs font-medium text-[#a1a1aa]">Plaintext</div>
                <div className="flex gap-0.5 flex-wrap">
                  {aesState.plaintext.map((b, i) => (
                    <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#06b6d4]/10 text-[#06b6d4] border border-[#06b6d4]/20">
                      {b.toString(16).padStart(2, "0")}
                    </span>
                  ))}
                </div>

                {aesState.phase === "complete" && (
                  <>
                    <div className="text-xs font-medium text-[#a1a1aa] mt-2">Ciphertext</div>
                    <div className="flex gap-0.5 flex-wrap">
                      {aesState.stateMatrix.map((_, c) =>
                        aesState.stateMatrix.map((row, r) => (
                          <span key={`${c}-${r}`} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/20">
                            {aesState.stateMatrix[r][c].toString(16).padStart(2, "0")}
                          </span>
                        ))
                      ).flat()}
                    </div>
                  </>
                )}
              </div>

              {/* ── How AES works ── */}
              <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap size={14} className="text-[#f97316]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">About AES-128</span>
                </div>
                <div className="text-xs text-[#71717a] space-y-1.5">
                  <p>AES (Advanced Encryption Standard) is a symmetric block cipher that operates on 128-bit blocks.</p>
                  <p>AES-128 uses a 128-bit key and performs 10 rounds of transformation on a 4x4 byte state matrix.</p>
                  <p>Each round applies four operations to achieve confusion (SubBytes, AddRoundKey) and diffusion (ShiftRows, MixColumns).</p>
                </div>
              </div>

              {/* ── Event log ── */}
              <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity size={14} className="text-[#06b6d4]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">Event Log</span>
                  <span className="text-[9px] text-[#71717a] ml-auto font-mono">{eventLog.length} events</span>
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {eventLog.length === 0 ? (
                    <div className="text-[10px] text-[#3a3a4e] text-center py-3">
                      No operations performed yet. Press Step or Play to begin.
                    </div>
                  ) : (
                    eventLog.map((evt, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-[10px] font-mono py-0.5 px-2 rounded"
                        style={{
                          backgroundColor: i === 0 ? "#6366f108" : "transparent",
                          borderLeft: i === 0 ? "2px solid #6366f1" : "2px solid transparent",
                        }}
                      >
                        <span className="text-[#71717a] shrink-0">R{evt.round}</span>
                        <span style={{ color: getOpColor(
                          evt.op === "SubBytes" ? "sub-bytes" :
                          evt.op === "ShiftRows" ? "shift-rows" :
                          evt.op === "MixColumns" ? "mix-columns" :
                          evt.op === "AddRoundKey" ? "add-round-key" : "idle"
                        ) }}>{evt.op}</span>
                        <span className="text-[#3a3a4e] ml-auto">{evt.changed}/16 changed</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* ── GF(2^8) Arithmetic ── */}
              <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Grid3X3 size={14} className="text-[#a855f7]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">Galois Field GF(2^8)</span>
                </div>
                <div className="text-[10px] text-[#71717a] space-y-1.5">
                  <p>AES operates in the Galois field GF(2^8) with the irreducible polynomial:</p>
                  <div className="p-2 rounded bg-[#0a0a0f] border border-[#1e1e2e]">
                    <span className="text-[9px] font-mono text-[#a855f7]">x^8 + x^4 + x^3 + x + 1 (0x11B)</span>
                  </div>
                  <p>MixColumns uses multiplication by 2 and 3 in this field. Multiplication by 2 is a left shift with conditional XOR by 0x1B if the MSB was set.</p>
                  <p>This field arithmetic ensures every operation is invertible, which is essential for decryption.</p>
                </div>
              </div>

              {/* ── Security notes ── */}
              <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield size={14} className="text-[#10b981]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">Security Properties</span>
                </div>
                <div className="text-[10px] text-[#71717a] space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#10b981] mt-1 shrink-0" />
                    <span><span className="text-[#10b981] font-medium">Brute force resistance:</span> 2^128 possible keys means ~3.4 x 10^38 attempts needed</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#10b981] mt-1 shrink-0" />
                    <span><span className="text-[#10b981] font-medium">Avalanche effect:</span> Changing one input bit affects roughly half the output bits</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#10b981] mt-1 shrink-0" />
                    <span><span className="text-[#10b981] font-medium">No known practical attacks:</span> Best theoretical attack on full AES-128 requires 2^126.1 operations</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] mt-1 shrink-0" />
                    <span><span className="text-[#f59e0b] font-medium">Mode of operation matters:</span> AES is a block cipher; ECB, CBC, CTR, GCM modes determine how blocks are chained</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Controls ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
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
              <AnimatePresence>
                {aesState.phase === "complete" && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#10b981]/15 border border-[#10b981]/20"
                  >
                    <Lock size={12} className="text-[#10b981]" />
                    <span className="text-xs font-medium text-[#10b981]">Encryption Complete</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </ModuleControls>
          </motion.div>

          {/* ── Detailed operation explanations ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
            className="mt-4 rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Grid3X3 size={14} className="text-[#f97316]" />
              <span className="text-sm font-medium text-[#a1a1aa]">AES Round Operations</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* SubBytes */}
              <div className="p-3 rounded-lg bg-[#f59e0b]/5 border border-[#f59e0b]/15">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-[#f59e0b]" />
                  <span className="text-xs font-semibold text-[#f59e0b]">SubBytes</span>
                  <span className="text-[9px] text-[#71717a] ml-auto">Non-linearity</span>
                </div>
                <p className="text-[10px] text-[#71717a] mb-2">
                  Each byte in the state is replaced by its corresponding value in the S-Box lookup table.
                  The S-Box is derived from the multiplicative inverse in GF(2^8) followed by an affine transformation.
                </p>
                <div className="p-2 rounded bg-[#0a0a0f] border border-[#1e1e2e]">
                  <span className="text-[9px] font-mono text-[#f59e0b]">
                    state[r][c] = SBox[state[r][c]]
                  </span>
                </div>
                <div className="mt-2 text-[9px] text-[#71717a]">
                  Purpose: Provides confusion by making relationship between key and ciphertext complex.
                </div>
              </div>

              {/* ShiftRows */}
              <div className="p-3 rounded-lg bg-[#06b6d4]/5 border border-[#06b6d4]/15">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-[#06b6d4]" />
                  <span className="text-xs font-semibold text-[#06b6d4]">ShiftRows</span>
                  <span className="text-[9px] text-[#71717a] ml-auto">Diffusion</span>
                </div>
                <p className="text-[10px] text-[#71717a] mb-2">
                  Each row of the state is cyclically shifted to the left by a different offset.
                  Row 0 stays, Row 1 shifts by 1, Row 2 by 2, Row 3 by 3 positions.
                </p>
                <div className="p-2 rounded bg-[#0a0a0f] border border-[#1e1e2e] space-y-0.5">
                  <div className="text-[9px] font-mono text-[#06b6d4]">Row 0: no shift</div>
                  <div className="text-[9px] font-mono text-[#06b6d4]">Row 1: shift left 1</div>
                  <div className="text-[9px] font-mono text-[#06b6d4]">Row 2: shift left 2</div>
                  <div className="text-[9px] font-mono text-[#06b6d4]">Row 3: shift left 3</div>
                </div>
                <div className="mt-2 text-[9px] text-[#71717a]">
                  Purpose: Spreads influence of each byte across different columns.
                </div>
              </div>

              {/* MixColumns */}
              <div className="p-3 rounded-lg bg-[#a855f7]/5 border border-[#a855f7]/15">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-[#a855f7]" />
                  <span className="text-xs font-semibold text-[#a855f7]">MixColumns</span>
                  <span className="text-[9px] text-[#71717a] ml-auto">Diffusion</span>
                </div>
                <p className="text-[10px] text-[#71717a] mb-2">
                  Each column is multiplied by a fixed polynomial matrix in GF(2^8).
                  This mixes all four bytes within each column together.
                </p>
                <div className="p-2 rounded bg-[#0a0a0f] border border-[#1e1e2e]">
                  <div className="text-[9px] font-mono text-[#a855f7]">
                    [2 3 1 1]   [s0]
                  </div>
                  <div className="text-[9px] font-mono text-[#a855f7]">
                    [1 2 3 1] x [s1]
                  </div>
                  <div className="text-[9px] font-mono text-[#a855f7]">
                    [1 1 2 3]   [s2]
                  </div>
                  <div className="text-[9px] font-mono text-[#a855f7]">
                    [3 1 1 2]   [s3]
                  </div>
                </div>
                <div className="mt-2 text-[9px] text-[#71717a]">
                  Purpose: Combined with ShiftRows, ensures complete diffusion after two rounds.
                  Skipped in the final round (Round 10).
                </div>
              </div>

              {/* AddRoundKey */}
              <div className="p-3 rounded-lg bg-[#10b981]/5 border border-[#10b981]/15">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-[#10b981]" />
                  <span className="text-xs font-semibold text-[#10b981]">AddRoundKey</span>
                  <span className="text-[9px] text-[#71717a] ml-auto">Key mixing</span>
                </div>
                <p className="text-[10px] text-[#71717a] mb-2">
                  Each byte of the state is XORed with the corresponding byte of the round key.
                  This is the only operation that incorporates the secret key material.
                </p>
                <div className="p-2 rounded bg-[#0a0a0f] border border-[#1e1e2e]">
                  <span className="text-[9px] font-mono text-[#10b981]">
                    state[r][c] = state[r][c] XOR roundKey[r][c]
                  </span>
                </div>
                <div className="mt-2 text-[9px] text-[#71717a]">
                  Purpose: Without key mixing, the cipher would be a fixed permutation with no secret.
                  XOR is its own inverse, enabling decryption.
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── AES variants comparison ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-4 rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-2">
                <Lock size={14} className="text-[#6366f1]" />
                <span className="text-sm font-semibold text-white">AES Variants</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1e1e2e]">
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Variant</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Key Size</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Block Size</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Rounds</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Security Level</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { variant: "AES-128", keySize: "128 bits", blockSize: "128 bits", rounds: "10", security: "128-bit", active: true },
                    { variant: "AES-192", keySize: "192 bits", blockSize: "128 bits", rounds: "12", security: "192-bit", active: false },
                    { variant: "AES-256", keySize: "256 bits", blockSize: "128 bits", rounds: "14", security: "256-bit", active: false },
                  ].map((row) => (
                    <tr
                      key={row.variant}
                      className="border-b border-[#1e1e2e]/50"
                      style={{ backgroundColor: row.active ? "rgba(99,102,241,0.04)" : "transparent" }}
                    >
                      <td className="px-4 py-2 font-medium" style={{ color: row.active ? "#6366f1" : "#a1a1aa" }}>
                        {row.variant}
                        {row.active && (
                          <span className="ml-1.5 text-[8px] px-1.5 py-0.5 rounded bg-[#6366f1]/15 text-[#6366f1]">current</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-[#06b6d4]">{row.keySize}</td>
                      <td className="px-4 py-2 font-mono text-[#a1a1aa]">{row.blockSize}</td>
                      <td className="px-4 py-2 font-mono text-[#f59e0b]">{row.rounds}</td>
                      <td className="px-4 py-2 text-[#10b981]">{row.security}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>

          {/* ── S-Box sample ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.45 }}
            className="mt-4 rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Shield size={14} className="text-[#f59e0b]" />
              <span className="text-sm font-medium text-[#a1a1aa]">S-Box (first 4 rows)</span>
            </div>

            <div className="overflow-x-auto">
              <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: "auto repeat(16, 1fr)" }}>
                {/* Header row */}
                <div className="w-8 h-6 flex items-center justify-center text-[8px] font-mono text-[#71717a]" />
                {Array.from({ length: 16 }, (_, i) => (
                  <div key={i} className="w-8 h-6 flex items-center justify-center text-[8px] font-mono text-[#f59e0b]">
                    .{i.toString(16)}
                  </div>
                ))}

                {/* S-Box rows (first 4) */}
                {[0, 1, 2, 3].map((row) => (
                  <>
                    <div key={`label-${row}`} className="w-8 h-6 flex items-center justify-center text-[8px] font-mono text-[#f59e0b]">
                      {row.toString(16)}.
                    </div>
                    {Array.from({ length: 16 }, (_, col) => {
                      const val = SBOX[row * 16 + col];
                      return (
                        <div
                          key={`${row}-${col}`}
                          className="w-8 h-6 flex items-center justify-center text-[7px] font-mono rounded"
                          style={{
                            backgroundColor: "#0a0a0f",
                            color: "#a1a1aa",
                            border: "1px solid #1e1e2e",
                          }}
                        >
                          {val.toString(16).padStart(2, "0")}
                        </div>
                      );
                    })}
                  </>
                ))}
              </div>
            </div>
            <div className="text-[9px] text-[#71717a] mt-2">
              The full S-Box contains 256 entries. Each byte b is replaced by SBox[b].
              The S-Box provides the non-linear substitution step crucial for AES security.
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════ */

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-[#71717a] mb-0.5">{label}</div>
      <div className="text-sm font-bold font-mono truncate" style={{ color }}>{value}</div>
    </div>
  );
}
