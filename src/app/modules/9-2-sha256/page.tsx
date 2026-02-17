"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Hash,
  Shield,
  Activity,
  Zap,
  Binary,
  GitCompareArrows,
  Layers,
  ChevronRight,
  Eye,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

/* ═══════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════ */

type ViewMode = "processing" | "avalanche";
type ScenarioName = "hello-world" | "single-bit-flip" | "empty-message" | "block-processing";
type ProcessingPhase = "idle" | "padding" | "scheduling" | "compressing" | "complete";

interface SHA256State {
  message: string;
  messageBytes: number[];
  paddedBytes: number[];
  blocks: number[][];
  currentBlock: number;
  schedule: number[];
  workingVars: number[];
  initialHash: number[];
  round: number;
  phase: ProcessingPhase;
  step: number;
  prevVars: number[];
  changedVarsMask: boolean[];
  finalHash: number[];
}

// SHA-256 constants K
const K: number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

// Initial hash values H
const H0: number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const VAR_NAMES = ["a", "b", "c", "d", "e", "f", "g", "h"];

// 32-bit operations
function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function shr(x: number, n: number): number {
  return (x >>> n) >>> 0;
}

function ch(x: number, y: number, z: number): number {
  return ((x & y) ^ (~x & z)) >>> 0;
}

function maj(x: number, y: number, z: number): number {
  return ((x & y) ^ (x & z) ^ (y & z)) >>> 0;
}

function sigma0(x: number): number {
  return (rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22)) >>> 0;
}

function sigma1(x: number): number {
  return (rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25)) >>> 0;
}

function lsigma0(x: number): number {
  return (rotr(x, 7) ^ rotr(x, 18) ^ shr(x, 3)) >>> 0;
}

function lsigma1(x: number): number {
  return (rotr(x, 17) ^ rotr(x, 19) ^ shr(x, 10)) >>> 0;
}

function add32(...vals: number[]): number {
  let sum = 0;
  for (const v of vals) sum = (sum + v) >>> 0;
  return sum;
}

// Message padding
function padMessage(bytes: number[]): number[] {
  const L = bytes.length;
  const padded = [...bytes];
  padded.push(0x80); // append 1 bit
  while ((padded.length % 64) !== 56) {
    padded.push(0x00);
  }
  // Append 64-bit big-endian length in bits
  const bitLen = L * 8;
  for (let i = 7; i >= 0; i--) {
    padded.push((bitLen / Math.pow(256, i)) & 0xff);
  }
  return padded;
}

// Parse into 512-bit blocks (16 32-bit words each)
function parseBlocks(padded: number[]): number[][] {
  const blocks: number[][] = [];
  for (let i = 0; i < padded.length; i += 64) {
    const block: number[] = [];
    for (let j = 0; j < 16; j++) {
      const word = (padded[i + j * 4] << 24) | (padded[i + j * 4 + 1] << 16) | (padded[i + j * 4 + 2] << 8) | padded[i + j * 4 + 3];
      block.push(word >>> 0);
    }
    blocks.push(block);
  }
  return blocks;
}

// Compute message schedule W[0..63]
function computeSchedule(block: number[]): number[] {
  const W: number[] = [...block]; // W[0..15]
  for (let t = 16; t < 64; t++) {
    W.push(add32(lsigma1(W[t - 2]), W[t - 7], lsigma0(W[t - 15]), W[t - 16]));
  }
  return W;
}

// Full SHA-256 hash
function sha256(message: string): number[] {
  const bytes = Array.from(message).map((c) => c.charCodeAt(0) & 0xff);
  const padded = padMessage(bytes);
  const blocks = parseBlocks(padded);

  let hash = [...H0];

  for (const block of blocks) {
    const W = computeSchedule(block);
    let [a, b, c, d, e, f, g, h] = hash;

    for (let t = 0; t < 64; t++) {
      const T1 = add32(h, sigma1(e), ch(e, f, g), K[t], W[t]);
      const T2 = add32(sigma0(a), maj(a, b, c));
      h = g;
      g = f;
      f = e;
      e = add32(d, T1);
      d = c;
      c = b;
      b = a;
      a = add32(T1, T2);
    }

    hash = [add32(hash[0], a), add32(hash[1], b), add32(hash[2], c), add32(hash[3], d),
            add32(hash[4], e), add32(hash[5], f), add32(hash[6], g), add32(hash[7], h)];
  }

  return hash;
}

function hashToHex(hash: number[]): string {
  return hash.map((h) => h.toString(16).padStart(8, "0")).join("");
}

function hashToBits(hash: number[]): string {
  return hash.map((h) => h.toString(2).padStart(32, "0")).join("");
}

function hammingDistance(a: string, b: string): number {
  let count = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) count++;
  }
  return count;
}

const SCENARIOS: { key: ScenarioName; label: string; icon: React.ReactNode }[] = [
  { key: "hello-world", label: "Hello World", icon: <Hash size={13} /> },
  { key: "single-bit-flip", label: "Single Bit Flip", icon: <Binary size={13} /> },
  { key: "empty-message", label: "Empty Message", icon: <Layers size={13} /> },
  { key: "block-processing", label: "Block Processing", icon: <Zap size={13} /> },
];

function createInitialState(message: string): SHA256State {
  const bytes = Array.from(message).map((c) => c.charCodeAt(0) & 0xff);
  const padded = padMessage(bytes);
  const blocks = parseBlocks(padded);

  return {
    message,
    messageBytes: bytes,
    paddedBytes: padded,
    blocks,
    currentBlock: 0,
    schedule: [],
    workingVars: [...H0],
    initialHash: [...H0],
    round: 0,
    phase: "idle",
    step: 0,
    prevVars: [...H0],
    changedVarsMask: Array(8).fill(false),
    finalHash: [],
  };
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function SHA256Page() {
  /* ─── State ─── */
  const [shaState, setShaState] = useState<SHA256State>(() => createInitialState("Hello World"));
  const [viewMode, setViewMode] = useState<ViewMode>("processing");
  const [selectedScenario, setSelectedScenario] = useState<ScenarioName>("hello-world");
  const [inputMessage, setInputMessage] = useState("Hello World");
  const [avalancheMsg1, setAvalancheMsg1] = useState("Hello World");
  const [avalancheMsg2, setAvalancheMsg2] = useState("Hello Worle");
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);

  /* ─── Refs ─── */
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  /* ─── Step forward ─── */
  const stepForward = useCallback(() => {
    setShaState((prev) => {
      if (prev.phase === "complete") return prev;

      const next: SHA256State = {
        ...prev,
        workingVars: [...prev.workingVars],
        prevVars: [...prev.prevVars],
        changedVarsMask: [...prev.changedVarsMask],
        schedule: [...prev.schedule],
        step: prev.step + 1,
      };

      if (prev.phase === "idle") {
        // Move to padding phase
        next.phase = "padding";
        return next;
      }

      if (prev.phase === "padding") {
        // Move to scheduling phase
        if (prev.currentBlock < prev.blocks.length) {
          next.schedule = computeSchedule(prev.blocks[prev.currentBlock]);
          next.phase = "scheduling";
          next.workingVars = [...prev.initialHash];
          next.prevVars = [...prev.initialHash];
          next.round = 0;
        } else {
          next.phase = "complete";
          next.finalHash = [...prev.initialHash];
        }
        return next;
      }

      if (prev.phase === "scheduling") {
        // Move to compressing
        next.phase = "compressing";
        next.round = 0;
        return next;
      }

      if (prev.phase === "compressing") {
        if (prev.round < 64) {
          // One compression round
          const [a, b, c, d, e, f, g, h] = prev.workingVars;
          const W = prev.schedule;

          const T1 = add32(h, sigma1(e), ch(e, f, g), K[prev.round], W[prev.round]);
          const T2 = add32(sigma0(a), maj(a, b, c));

          const newVars = [
            add32(T1, T2), // a
            a,              // b
            b,              // c
            c,              // d
            add32(d, T1),   // e
            e,              // f
            f,              // g
            g,              // h
          ];

          next.prevVars = [...prev.workingVars];
          next.workingVars = newVars;
          next.changedVarsMask = newVars.map((v, i) => v !== prev.workingVars[i]);
          next.round = prev.round + 1;

          // After all 64 rounds, add to hash
          if (next.round >= 64) {
            const newHash = prev.initialHash.map((h, i) => add32(h, newVars[i]));
            next.initialHash = newHash;
            next.currentBlock = prev.currentBlock + 1;

            if (next.currentBlock < prev.blocks.length) {
              next.phase = "scheduling";
              next.round = 0;
              next.schedule = computeSchedule(prev.blocks[next.currentBlock]);
              next.workingVars = [...newHash];
              next.prevVars = [...newHash];
            } else {
              next.phase = "complete";
              next.finalHash = newHash;
            }
          }
        }
        return next;
      }

      return next;
    });
  }, []);

  /* ─── Animation loop ─── */
  const animationLoop = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) return;
    const interval = Math.max(10, 150 / speedRef.current);
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
    setShaState(createInitialState(inputMessage));
  }, [handlePause, inputMessage]);

  /* ─── Stop on complete ─── */
  useEffect(() => {
    if (shaState.phase === "complete" && isPlaying) {
      handlePause();
    }
  }, [shaState.phase, isPlaying, handlePause]);

  /* ─── Scenarios ─── */
  const runScenario = useCallback((scenario: ScenarioName) => {
    handlePause();
    setSelectedScenario(scenario);

    let msg: string;
    switch (scenario) {
      case "hello-world":
        msg = "Hello World";
        setViewMode("processing");
        break;
      case "single-bit-flip":
        msg = "Hello World";
        setAvalancheMsg1("Hello World");
        setAvalancheMsg2("Hello Worle");
        setViewMode("avalanche");
        break;
      case "empty-message":
        msg = "";
        setViewMode("processing");
        break;
      case "block-processing":
        msg = "The quick brown fox jumps over the lazy dog. Extra padding needed!";
        setViewMode("processing");
        break;
    }

    setInputMessage(msg!);
    setShaState(createInitialState(msg!));

    if (scenario !== "single-bit-flip") {
      setTimeout(() => {
        setIsPlaying(true);
        isPlayingRef.current = true;
        lastTickRef.current = 0;
        animationRef.current = requestAnimationFrame(animationLoop);
      }, 50);
    }
  }, [handlePause, animationLoop]);

  /* ─── Avalanche data ─── */
  const avalancheData = useMemo(() => {
    if (viewMode !== "avalanche") return null;

    const hash1 = sha256(avalancheMsg1);
    const hash2 = sha256(avalancheMsg2);
    const hex1 = hashToHex(hash1);
    const hex2 = hashToHex(hash2);
    const bits1 = hashToBits(hash1);
    const bits2 = hashToBits(hash2);
    const distance = hammingDistance(bits1, bits2);
    const diffPercent = ((distance / 256) * 100).toFixed(1);

    // Bit diff array
    const bitDiffs: boolean[] = [];
    for (let i = 0; i < 256; i++) {
      bitDiffs.push(bits1[i] !== bits2[i]);
    }

    return { hash1, hash2, hex1, hex2, bits1, bits2, distance, diffPercent, bitDiffs };
  }, [viewMode, avalancheMsg1, avalancheMsg2]);

  /* ─── Visible schedule range ─── */
  const scheduleViewStart = Math.max(0, shaState.round - 4);
  const scheduleViewEnd = Math.min(64, scheduleViewStart + 12);

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
                9.2
              </span>
              <div className="flex items-center gap-1.5 text-xs text-[#71717a]">
                <Shield size={12} />
                <span>Cryptography & Security</span>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Hashing (SHA-256)</h1>
            <p className="mt-1.5 text-[#a1a1aa] text-sm sm:text-base max-w-2xl">
              Explore SHA-256 message processing: padding, scheduling, 64 rounds of compression,
              and the avalanche effect where a single bit change alters half the hash.
            </p>
          </motion.div>

          {/* ── View mode & scenarios ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex flex-wrap items-center gap-2 mb-4"
          >
            {/* View mode toggle */}
            <div className="flex items-center rounded-lg bg-[#111118] border border-[#1e1e2e] p-0.5">
              <button
                onClick={() => setViewMode("processing")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                  viewMode === "processing"
                    ? "bg-[#6366f1]/15 text-[#6366f1]"
                    : "text-[#71717a] hover:text-white"
                }`}
              >
                Message Processing
              </button>
              <button
                onClick={() => setViewMode("avalanche")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                  viewMode === "avalanche"
                    ? "bg-[#ef4444]/15 text-[#ef4444]"
                    : "text-[#71717a] hover:text-white"
                }`}
              >
                Avalanche Effect
              </button>
            </div>

            <div className="w-px h-8 bg-[#1e1e2e] mx-1" />

            {SCENARIOS.map((s) => (
              <button
                key={s.key}
                onClick={() => runScenario(s.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                  selectedScenario === s.key
                    ? "bg-[#f97316]/15 border border-[#f97316]/30 text-[#f97316]"
                    : "bg-[#1e1e2e] border border-[#1e1e2e] text-[#71717a] hover:bg-[#2a2a3e] hover:text-[#a1a1aa]"
                }`}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </motion.div>

          {/* ── Processing view ── */}
          {viewMode === "processing" && (
            <>
              {/* Input */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.12 }}
                className="mb-4"
              >
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="text-[10px] text-[#71717a] uppercase tracking-wider block mb-1">Message Input</label>
                    <input
                      type="text"
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e] text-xs font-mono text-white focus:border-[#6366f1] focus:outline-none transition-colors"
                      placeholder="Enter message to hash..."
                    />
                  </div>
                  <button
                    onClick={handleReset}
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-[#6366f1]/15 border border-[#6366f1]/30 text-[#6366f1] hover:bg-[#6366f1]/25 transition-all"
                  >
                    Update
                  </button>
                </div>
              </motion.div>

              <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 mb-4">
                <div className="space-y-4">
                  {/* ── Step 1: Padding ── */}
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.15 }}
                    className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Layers size={14} className="text-[#06b6d4]" />
                      <span className="text-sm font-semibold">Step 1: Message Padding</span>
                      <span className={`text-[10px] font-mono ml-auto px-2 py-0.5 rounded ${
                        shaState.phase === "padding" || shaState.phase !== "idle"
                          ? "bg-[#10b981]/15 text-[#10b981]"
                          : "bg-[#1e1e2e] text-[#71717a]"
                      }`}>
                        {shaState.messageBytes.length} bytes → {shaState.paddedBytes.length} bytes
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-0.5 max-h-32 overflow-y-auto">
                      {shaState.paddedBytes.map((byte, i) => {
                        const isMessage = i < shaState.messageBytes.length;
                        const isOneBit = i === shaState.messageBytes.length;
                        const isLength = i >= shaState.paddedBytes.length - 8;
                        const isPadZero = !isMessage && !isOneBit && !isLength;

                        let bgColor = "#1e1e2e";
                        let textColor = "#71717a";
                        if (isMessage) { bgColor = "#06b6d420"; textColor = "#06b6d4"; }
                        else if (isOneBit) { bgColor = "#f59e0b20"; textColor = "#f59e0b"; }
                        else if (isLength) { bgColor = "#6366f120"; textColor = "#6366f1"; }

                        return (
                          <motion.span
                            key={i}
                            className="text-[8px] font-mono px-1 py-0.5 rounded"
                            style={{ backgroundColor: bgColor, color: textColor }}
                            initial={shaState.phase !== "idle" ? { opacity: 0, scale: 0.8 } : {}}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.005 }}
                          >
                            {byte.toString(16).padStart(2, "0")}
                          </motion.span>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-[#06b6d4]" /><span className="text-[9px] text-[#71717a]">Message</span></div>
                      <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-[#f59e0b]" /><span className="text-[9px] text-[#71717a]">0x80 bit</span></div>
                      <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-[#1e1e2e]" /><span className="text-[9px] text-[#71717a]">Zero padding</span></div>
                      <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-[#6366f1]" /><span className="text-[9px] text-[#71717a]">Length (64-bit)</span></div>
                    </div>
                  </motion.div>

                  {/* ── Step 2: Blocks ── */}
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Binary size={14} className="text-[#f59e0b]" />
                      <span className="text-sm font-semibold">Step 2: 512-bit Blocks</span>
                      <span className="text-xs text-[#71717a] font-mono ml-auto">
                        {shaState.blocks.length} block{shaState.blocks.length !== 1 ? "s" : ""}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {shaState.blocks.map((block, bIdx) => {
                        const isCurrent = bIdx === shaState.currentBlock && shaState.phase !== "complete" && shaState.phase !== "idle";
                        return (
                          <div
                            key={bIdx}
                            className="p-2 rounded-lg border"
                            style={{
                              borderColor: isCurrent ? "#f59e0b" : "#1e1e2e",
                              backgroundColor: isCurrent ? "#f59e0b08" : "#0a0a0f",
                            }}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-mono font-bold" style={{ color: isCurrent ? "#f59e0b" : "#71717a" }}>
                                Block {bIdx}
                              </span>
                              {isCurrent && (
                                <span className="text-[9px] text-[#f59e0b] animate-pulse">processing</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-0.5">
                              {block.map((word, wIdx) => (
                                <span
                                  key={wIdx}
                                  className="text-[8px] font-mono px-1 py-0.5 rounded bg-[#1e1e2e]"
                                  style={{ color: isCurrent ? "#f59e0b" : "#71717a" }}
                                >
                                  {word.toString(16).padStart(8, "0")}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>

                  {/* ── Step 3: Schedule ── */}
                  {shaState.schedule.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.22 }}
                      className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <Layers size={14} className="text-[#a855f7]" />
                        <span className="text-sm font-semibold">Step 3: Message Schedule W[0..63]</span>
                      </div>

                      <div className="flex flex-wrap gap-0.5 max-h-24 overflow-y-auto">
                        {shaState.schedule.slice(scheduleViewStart, scheduleViewEnd).map((w, i) => {
                          const actualIdx = scheduleViewStart + i;
                          const isCurrent = actualIdx === shaState.round;
                          return (
                            <div
                              key={actualIdx}
                              className="flex flex-col items-center px-1.5 py-1 rounded"
                              style={{
                                backgroundColor: isCurrent ? "#6366f115" : "#0a0a0f",
                                border: `1px solid ${isCurrent ? "#6366f1" : "#1e1e2e"}`,
                              }}
                            >
                              <span className="text-[8px] text-[#71717a] font-mono">W[{actualIdx}]</span>
                              <span className="text-[9px] font-mono font-bold" style={{ color: isCurrent ? "#6366f1" : "#a1a1aa" }}>
                                {w.toString(16).padStart(8, "0")}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}

                  {/* ── Step 4: Compression ── */}
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.25 }}
                    className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Activity size={14} className="text-[#6366f1]" />
                      <span className="text-sm font-semibold">Step 4: Compression (Round {shaState.round}/64)</span>
                    </div>

                    {/* Working variables */}
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                      {shaState.workingVars.map((v, i) => {
                        const changed = shaState.changedVarsMask[i];
                        return (
                          <motion.div
                            key={i}
                            className="flex flex-col items-center p-2 rounded-lg border"
                            style={{
                              backgroundColor: changed ? "#6366f115" : "#0a0a0f",
                              borderColor: changed ? "#6366f1" : "#1e1e2e",
                            }}
                            animate={{
                              scale: changed ? 1.05 : 1,
                              boxShadow: changed ? "0 0 12px rgba(99,102,241,0.2)" : "none",
                            }}
                            transition={{ duration: 0.15 }}
                          >
                            <span className="text-[10px] font-mono font-bold" style={{ color: changed ? "#6366f1" : "#71717a" }}>
                              {VAR_NAMES[i]}
                            </span>
                            <span className="text-[8px] font-mono mt-0.5" style={{ color: changed ? "#6366f1" : "#a1a1aa" }}>
                              {v.toString(16).padStart(8, "0")}
                            </span>
                          </motion.div>
                        );
                      })}
                    </div>

                    {/* Round progress bar */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] text-[#71717a]">Round Progress</span>
                        <span className="text-[10px] font-mono text-[#6366f1]">{shaState.round}/64</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[#1e1e2e] overflow-hidden">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-[#6366f1] to-[#a855f7]"
                          style={{ width: `${(shaState.round / 64) * 100}%` }}
                          transition={{ duration: 0.1 }}
                        />
                      </div>
                    </div>
                  </motion.div>
                </div>

                {/* ── Right column ── */}
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
                            <span className="text-sm font-medium text-[#a1a1aa]">Metrics</span>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <MetricCard label="Message Length" value={`${shaState.messageBytes.length}B`} color="#06b6d4" />
                            <MetricCard label="Blocks" value={String(shaState.blocks.length)} color="#f59e0b" />
                            <MetricCard label="Current Round" value={`${shaState.round}/64`} color="#6366f1" />
                            <MetricCard label="Phase" value={shaState.phase} color={
                              shaState.phase === "complete" ? "#10b981" : "#f59e0b"
                            } />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Hash output */}
                  <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Hash size={14} className="text-[#10b981]" />
                      <span className="text-sm font-medium text-[#a1a1aa]">Hash Output</span>
                    </div>

                    {shaState.phase === "complete" ? (
                      <div className="space-y-2">
                        <div className="p-2 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20">
                          <span className="text-[10px] font-mono text-[#10b981] break-all leading-relaxed">
                            {hashToHex(shaState.finalHash)}
                          </span>
                        </div>
                        <div className="text-[9px] text-[#71717a]">256 bits = 32 bytes = 64 hex chars</div>
                      </div>
                    ) : (
                      <div className="p-2 rounded-lg bg-[#1e1e2e] border border-[#1e1e2e]">
                        <span className="text-[10px] font-mono text-[#71717a] italic">
                          Processing...
                        </span>
                      </div>
                    )}

                    {/* Current hash state */}
                    <div className="mt-3">
                      <div className="text-[9px] text-[#71717a] mb-1">Current H values</div>
                      <div className="flex flex-wrap gap-0.5">
                        {shaState.initialHash.map((h, i) => (
                          <span key={i} className="text-[8px] font-mono px-1 py-0.5 rounded bg-[#0a0a0f] text-[#6366f1] border border-[#1e1e2e]">
                            H{i}={h.toString(16).padStart(8, "0")}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap size={14} className="text-[#f97316]" />
                      <span className="text-sm font-medium text-[#a1a1aa]">SHA-256 Steps</span>
                    </div>
                    <div className="text-xs text-[#71717a] space-y-1.5">
                      <div className="flex items-start gap-1.5">
                        <ChevronRight size={10} className="text-[#06b6d4] shrink-0 mt-0.5" />
                        <span><span className="text-[#06b6d4]">Pad</span> message to multiple of 512 bits</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <ChevronRight size={10} className="text-[#f59e0b] shrink-0 mt-0.5" />
                        <span><span className="text-[#f59e0b]">Parse</span> into 512-bit blocks</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <ChevronRight size={10} className="text-[#a855f7] shrink-0 mt-0.5" />
                        <span><span className="text-[#a855f7]">Expand</span> 16 words to 64-word schedule</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <ChevronRight size={10} className="text-[#6366f1] shrink-0 mt-0.5" />
                        <span><span className="text-[#6366f1]">Compress</span> through 64 rounds</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Avalanche view ── */}
          {viewMode === "avalanche" && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="space-y-4 mb-4"
            >
              {/* Input messages */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-[#71717a] uppercase tracking-wider block mb-1">Message 1</label>
                  <input
                    type="text"
                    value={avalancheMsg1}
                    onChange={(e) => setAvalancheMsg1(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e] text-xs font-mono text-[#06b6d4] focus:border-[#06b6d4] focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#71717a] uppercase tracking-wider block mb-1">Message 2 (1 char different)</label>
                  <input
                    type="text"
                    value={avalancheMsg2}
                    onChange={(e) => setAvalancheMsg2(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e] text-xs font-mono text-[#ef4444] focus:border-[#ef4444] focus:outline-none transition-colors"
                  />
                </div>
              </div>

              {avalancheData && (
                <>
                  {/* Side-by-side hashes */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-[#06b6d4]/20 bg-[#111118] p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Hash size={14} className="text-[#06b6d4]" />
                        <span className="text-xs font-medium text-[#06b6d4]">Hash 1</span>
                      </div>
                      <div className="text-[10px] font-mono text-[#06b6d4] break-all leading-relaxed p-2 rounded bg-[#06b6d4]/5">
                        {avalancheData.hex1}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#ef4444]/20 bg-[#111118] p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Hash size={14} className="text-[#ef4444]" />
                        <span className="text-xs font-medium text-[#ef4444]">Hash 2</span>
                      </div>
                      <div className="text-[10px] font-mono text-[#ef4444] break-all leading-relaxed p-2 rounded bg-[#ef4444]/5">
                        {avalancheData.hex2}
                      </div>
                    </div>
                  </div>

                  {/* Bit difference visualization */}
                  <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <GitCompareArrows size={14} className="text-[#ef4444]" />
                      <span className="text-sm font-semibold">Bit Difference Visualization</span>
                      <span className="text-xs font-mono ml-auto">
                        <span className="text-[#ef4444]">{avalancheData.distance}</span>
                        <span className="text-[#71717a]">/256 bits differ ({avalancheData.diffPercent}%)</span>
                      </span>
                    </div>

                    {/* Bit grid */}
                    <div className="flex flex-wrap gap-px">
                      {avalancheData.bitDiffs.map((isDiff, i) => (
                        <motion.div
                          key={i}
                          className="w-2 h-2 rounded-sm"
                          style={{
                            backgroundColor: isDiff ? "#ef4444" : "#1e1e2e",
                          }}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.002 }}
                        />
                      ))}
                    </div>

                    <div className="flex items-center gap-3 mt-3">
                      <div className="flex items-center gap-1">
                        <div className="w-2.5 h-2.5 rounded-sm bg-[#ef4444]" />
                        <span className="text-[9px] text-[#71717a]">Different bit</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2.5 h-2.5 rounded-sm bg-[#1e1e2e]" />
                        <span className="text-[9px] text-[#71717a]">Same bit</span>
                      </div>
                    </div>
                  </div>

                  {/* Hamming distance */}
                  <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Eye size={14} className="text-[#f59e0b]" />
                      <span className="text-sm font-semibold">Avalanche Statistics</span>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold font-mono text-[#ef4444]">{avalancheData.distance}</div>
                        <div className="text-[10px] text-[#71717a]">Hamming Distance</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold font-mono text-[#f59e0b]">{avalancheData.diffPercent}%</div>
                        <div className="text-[10px] text-[#71717a]">Bits Changed</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold font-mono text-[#10b981]">50%</div>
                        <div className="text-[10px] text-[#71717a]">Expected (ideal)</div>
                      </div>
                    </div>

                    <div className="mt-3 p-3 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]">
                      <p className="text-xs text-[#71717a]">
                        The <span className="text-[#ef4444] font-medium">avalanche effect</span> is a desirable property of
                        cryptographic hash functions: changing even a single bit of input should change approximately 50%
                        of the output bits. SHA-256 achieves this through its carefully designed compression function.
                      </p>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}

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
                {shaState.phase === "complete" && viewMode === "processing" && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#10b981]/15 border border-[#10b981]/20"
                  >
                    <Hash size={12} className="text-[#10b981]" />
                    <span className="text-xs font-medium text-[#10b981]">Hash Complete</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </ModuleControls>
          </motion.div>

          {/* ── Info ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
            className="mt-4 rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} className="text-[#f97316]" />
              <span className="text-sm font-medium text-[#a1a1aa]">About SHA-256</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-[#71717a]">
              <div>
                <div className="text-white font-medium mb-1">One-Way Function</div>
                <p>SHA-256 is computationally infeasible to reverse. Given a hash, you cannot determine
                  the original message. This makes it ideal for password storage and digital signatures.</p>
              </div>
              <div>
                <div className="text-white font-medium mb-1">Collision Resistance</div>
                <p>Finding two different messages that produce the same hash is computationally infeasible.
                  With 2^256 possible outputs, the birthday attack requires ~2^128 attempts.</p>
              </div>
              <div>
                <div className="text-white font-medium mb-1">Deterministic</div>
                <p>The same input always produces the same 256-bit output. This property is essential for
                  verification: you can check integrity by comparing hashes without revealing the data.</p>
              </div>
            </div>
          </motion.div>

          {/* ── Compression function details ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-4 rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Activity size={14} className="text-[#6366f1]" />
              <span className="text-sm font-medium text-[#a1a1aa]">Compression Function Detail</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Round operations */}
              <div className="p-3 rounded-lg bg-[#6366f1]/5 border border-[#6366f1]/15">
                <div className="text-xs font-semibold text-[#6366f1] mb-2">Round Computation</div>
                <div className="space-y-1.5 text-[10px] text-[#71717a]">
                  <p>Each of the 64 rounds computes two temporary values:</p>
                  <div className="p-2 rounded bg-[#0a0a0f] border border-[#1e1e2e] space-y-1">
                    <div className="font-mono text-[9px] text-[#6366f1]">
                      T1 = h + Sigma1(e) + Ch(e,f,g) + K[t] + W[t]
                    </div>
                    <div className="font-mono text-[9px] text-[#6366f1]">
                      T2 = Sigma0(a) + Maj(a,b,c)
                    </div>
                  </div>
                  <p className="mt-1.5">Then the working variables shift:</p>
                  <div className="p-2 rounded bg-[#0a0a0f] border border-[#1e1e2e] space-y-0.5">
                    <div className="font-mono text-[8px] text-[#a1a1aa]">h=g, g=f, f=e, e=d+T1</div>
                    <div className="font-mono text-[8px] text-[#a1a1aa]">d=c, c=b, b=a, a=T1+T2</div>
                  </div>
                </div>
              </div>

              {/* Logical functions */}
              <div className="p-3 rounded-lg bg-[#f59e0b]/5 border border-[#f59e0b]/15">
                <div className="text-xs font-semibold text-[#f59e0b] mb-2">Logical Functions</div>
                <div className="space-y-2 text-[10px]">
                  <div>
                    <span className="text-[#f59e0b] font-mono font-bold">Ch(x,y,z)</span>
                    <span className="text-[#71717a]"> = (x AND y) XOR (NOT x AND z)</span>
                    <div className="text-[9px] text-[#3a3a4e] mt-0.5">Choose: x picks bits from y or z</div>
                  </div>
                  <div>
                    <span className="text-[#f59e0b] font-mono font-bold">Maj(x,y,z)</span>
                    <span className="text-[#71717a]"> = (x AND y) XOR (x AND z) XOR (y AND z)</span>
                    <div className="text-[9px] text-[#3a3a4e] mt-0.5">Majority: output matches majority of inputs</div>
                  </div>
                  <div>
                    <span className="text-[#f59e0b] font-mono font-bold">Sigma0(x)</span>
                    <span className="text-[#71717a]"> = ROTR2 XOR ROTR13 XOR ROTR22</span>
                  </div>
                  <div>
                    <span className="text-[#f59e0b] font-mono font-bold">Sigma1(x)</span>
                    <span className="text-[#71717a]"> = ROTR6 XOR ROTR11 XOR ROTR25</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── SHA family comparison ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.45 }}
            className="mt-4 rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-2">
                <Hash size={14} className="text-[#6366f1]" />
                <span className="text-sm font-semibold text-white">SHA Family Comparison</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1e1e2e]">
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Algorithm</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Digest Size</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Block Size</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Rounds</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "MD5", digest: "128 bits", block: "512 bits", rounds: "64", status: "Broken", statusColor: "#ef4444" },
                    { name: "SHA-1", digest: "160 bits", block: "512 bits", rounds: "80", status: "Deprecated", statusColor: "#f59e0b" },
                    { name: "SHA-256", digest: "256 bits", block: "512 bits", rounds: "64", status: "Secure", statusColor: "#10b981", active: true },
                    { name: "SHA-384", digest: "384 bits", block: "1024 bits", rounds: "80", status: "Secure", statusColor: "#10b981" },
                    { name: "SHA-512", digest: "512 bits", block: "1024 bits", rounds: "80", status: "Secure", statusColor: "#10b981" },
                    { name: "SHA-3", digest: "Variable", block: "Variable", rounds: "24", status: "Secure", statusColor: "#10b981" },
                  ].map((row) => (
                    <tr
                      key={row.name}
                      className="border-b border-[#1e1e2e]/50"
                      style={{ backgroundColor: row.active ? "rgba(99,102,241,0.04)" : "transparent" }}
                    >
                      <td className="px-4 py-2 font-medium" style={{ color: row.active ? "#6366f1" : "#a1a1aa" }}>
                        {row.name}
                        {row.active && (
                          <span className="ml-1.5 text-[8px] px-1.5 py-0.5 rounded bg-[#6366f1]/15 text-[#6366f1]">current</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-[#06b6d4]">{row.digest}</td>
                      <td className="px-4 py-2 font-mono text-[#a1a1aa]">{row.block}</td>
                      <td className="px-4 py-2 font-mono text-[#f59e0b]">{row.rounds}</td>
                      <td className="px-4 py-2">
                        <span className="text-[10px] font-medium" style={{ color: row.statusColor }}>{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>

          {/* ── Real-world applications ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="mt-4 rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Shield size={14} className="text-[#10b981]" />
              <span className="text-sm font-medium text-[#a1a1aa]">Real-World Applications</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {[
                { title: "Bitcoin Mining", desc: "SHA-256 is used in Bitcoin's proof-of-work. Miners compute double-SHA-256 to find valid block hashes.", color: "#f59e0b" },
                { title: "TLS Certificates", desc: "Digital certificates use SHA-256 to create signatures that verify authenticity of HTTPS connections.", color: "#6366f1" },
                { title: "Git Commits", desc: "Git uses SHA-1 (migrating to SHA-256) to create unique identifiers for every commit and object.", color: "#06b6d4" },
                { title: "Password Storage", desc: "Passwords are hashed with SHA-256 (plus salt) before storage so plaintext is never kept.", color: "#10b981" },
              ].map((app) => (
                <div key={app.title} className="p-3 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]">
                  <div className="text-xs font-semibold mb-1" style={{ color: app.color }}>{app.title}</div>
                  <p className="text-[10px] text-[#71717a]">{app.desc}</p>
                </div>
              ))}
            </div>
          </motion.div>

          {/* ── Initial hash values & constants ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.55 }}
            className="mt-4 rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Binary size={14} className="text-[#a855f7]" />
              <span className="text-sm font-medium text-[#a1a1aa]">Initial Hash Values (H0..H7)</span>
            </div>

            <div className="flex flex-wrap gap-1 mb-3">
              {H0.map((h, i) => (
                <div key={i} className="p-2 rounded bg-[#0a0a0f] border border-[#1e1e2e]">
                  <span className="text-[8px] font-mono text-[#71717a]">H{i} = </span>
                  <span className="text-[9px] font-mono text-[#a855f7]">{h.toString(16).padStart(8, "0")}</span>
                </div>
              ))}
            </div>

            <div className="text-[10px] text-[#71717a]">
              These are the first 32 bits of the fractional parts of the square roots of the first 8 primes (2, 3, 5, 7, 11, 13, 17, 19).
              The 64 round constants K are derived similarly from cube roots of the first 64 primes.
            </div>

            <div className="mt-3">
              <div className="text-[9px] text-[#71717a] font-medium mb-1">First 16 Round Constants (K[0..15])</div>
              <div className="flex flex-wrap gap-0.5">
                {K.slice(0, 16).map((k, i) => (
                  <span key={i} className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-[#0a0a0f] text-[#71717a] border border-[#1e1e2e]">
                    {k.toString(16).padStart(8, "0")}
                  </span>
                ))}
              </div>
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
