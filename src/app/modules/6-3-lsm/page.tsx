"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database,
  ArrowDown,
  ArrowRight,
  Search,
  PenLine,
  Trash2,
  Layers,
  Activity,
  Zap,
  Merge,
  Filter,
  FileDown,
  ChevronDown,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

/* ═══════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════ */

interface KVPair {
  key: string;
  value: string;
  tombstone?: boolean;
}

interface SSTable {
  id: string;
  level: number;
  entries: KVPair[];
  minKey: string;
  maxKey: string;
  highlighted: boolean;
  merging: boolean;
  bloomFilter: Set<string>;
}

interface BloomResult {
  level: number;
  sstableId: string;
  result: "probably-yes" | "definitely-no";
  checked: boolean;
}

interface ReadProbe {
  key: string;
  phase: "memtable" | "l0" | "l1" | "l2" | "found" | "not-found";
  found: boolean;
  value: string | null;
  bloomResults: BloomResult[];
  currentLevelIndex: number;
}

interface EventLogEntry {
  id: number;
  message: string;
  type: "write" | "flush" | "compact" | "read" | "bloom" | "info" | "delete";
}

interface SimulationState {
  phase: "idle" | "writing" | "flushing" | "compacting" | "reading" | "complete";
  step: number;
  autoWriteQueue: KVPair[];
  autoWriteIndex: number;
  readProbe: ReadProbe | null;
  flushAnimating: boolean;
  compactAnimating: boolean;
}

const MEMTABLE_CAPACITY = 4;
const L0_COMPACT_THRESHOLD = 3;
const L1_COMPACT_THRESHOLD = 4;

const SCENARIOS = [
  { id: "write-heavy", label: "Write Heavy", description: "Rapid writes filling memtable" },
  { id: "read-after-write", label: "Read After Write", description: "Write then read same key" },
  { id: "compaction-trigger", label: "Compaction Trigger", description: "Fill L0 to trigger compaction" },
  { id: "range-query", label: "Range Query", description: "Sequential key writes for range" },
];

const WRITE_HEAVY_DATA: KVPair[] = [
  { key: "a", value: "1" },
  { key: "d", value: "4" },
  { key: "b", value: "2" },
  { key: "f", value: "6" },
  { key: "c", value: "3" },
  { key: "e", value: "5" },
  { key: "g", value: "7" },
  { key: "h", value: "8" },
  { key: "a", value: "10" },
  { key: "i", value: "9" },
  { key: "j", value: "11" },
  { key: "b", value: "20" },
  { key: "k", value: "12" },
  { key: "l", value: "13" },
  { key: "c", value: "30" },
  { key: "m", value: "14" },
  { key: "n", value: "15" },
  { key: "d", value: "40" },
  { key: "o", value: "16" },
  { key: "p", value: "17" },
];

const COMPACTION_DATA: KVPair[] = [
  { key: "a", value: "1" }, { key: "c", value: "3" }, { key: "e", value: "5" }, { key: "g", value: "7" },
  { key: "b", value: "2" }, { key: "d", value: "4" }, { key: "f", value: "6" }, { key: "h", value: "8" },
  { key: "i", value: "9" }, { key: "k", value: "11" }, { key: "m", value: "13" }, { key: "o", value: "15" },
  { key: "j", value: "10" }, { key: "l", value: "12" }, { key: "n", value: "14" }, { key: "p", value: "16" },
  { key: "a", value: "100" }, { key: "b", value: "200" }, { key: "c", value: "300" }, { key: "d", value: "400" },
];

const RANGE_DATA: KVPair[] = [
  { key: "key01", value: "v1" }, { key: "key02", value: "v2" }, { key: "key03", value: "v3" }, { key: "key04", value: "v4" },
  { key: "key05", value: "v5" }, { key: "key06", value: "v6" }, { key: "key07", value: "v7" }, { key: "key08", value: "v8" },
  { key: "key09", value: "v9" }, { key: "key10", value: "v10" }, { key: "key11", value: "v11" }, { key: "key12", value: "v12" },
];

const DOMAIN_COLOR = "#ec4899";

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */

let globalSstId = 0;
let globalEventId = 0;

function createSSTable(level: number, entries: KVPair[]): SSTable {
  const sorted = [...entries].sort((a, b) => a.key.localeCompare(b.key));
  const bloom = new Set(sorted.map((e) => e.key));
  return {
    id: `sst-${++globalSstId}`,
    level,
    entries: sorted,
    minKey: sorted[0]?.key || "",
    maxKey: sorted[sorted.length - 1]?.key || "",
    highlighted: false,
    merging: false,
    bloomFilter: bloom,
  };
}

function bloomCheck(sst: SSTable, key: string): boolean {
  return sst.bloomFilter.has(key);
}

function mergeSSTables(tables: SSTable[]): KVPair[] {
  const allEntries: KVPair[] = [];
  for (const t of tables) {
    allEntries.push(...t.entries);
  }
  allEntries.sort((a, b) => {
    const cmp = a.key.localeCompare(b.key);
    if (cmp !== 0) return cmp;
    return 0;
  });
  const deduped: KVPair[] = [];
  const seen = new Map<string, KVPair>();
  for (const entry of allEntries) {
    seen.set(entry.key, entry);
  }
  for (const [, entry] of seen) {
    if (!entry.tombstone) {
      deduped.push(entry);
    }
  }
  deduped.sort((a, b) => a.key.localeCompare(b.key));
  return deduped;
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function LSMTreePage() {
  /* ─── Core state ─── */
  const [memtable, setMemtable] = useState<KVPair[]>([]);
  const [sstables, setSstables] = useState<SSTable[]>([]);
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [sim, setSim] = useState<SimulationState>({
    phase: "idle",
    step: 0,
    autoWriteQueue: [],
    autoWriteIndex: 0,
    readProbe: null,
    flushAnimating: false,
    compactAnimating: false,
  });
  const [totalBytesWritten, setTotalBytesWritten] = useState(0);
  const [totalBytesReceived, setTotalBytesReceived] = useState(0);
  const [activeScenario, setActiveScenario] = useState("write-heavy");
  const [inputKey, setInputKey] = useState("");
  const [inputValue, setInputValue] = useState("");

  /* ─── UI state ─── */
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);

  /* ─── Refs ─── */
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { eventsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [events.length]);

  /* ─── Refs for accessing latest state in callbacks ─── */
  const memtableRef = useRef(memtable);
  const sstablesRef = useRef(sstables);
  const simRef = useRef(sim);
  memtableRef.current = memtable;
  sstablesRef.current = sstables;
  simRef.current = sim;

  /* ─── Add event ─── */
  const addEvent = useCallback((message: string, type: EventLogEntry["type"]) => {
    setEvents((prev) => [...prev, { id: ++globalEventId, message, type }].slice(-200));
  }, []);

  /* ─── Write to memtable ─── */
  const writeToMemtable = useCallback((key: string, value: string, tombstone = false) => {
    setTotalBytesReceived((b) => b + key.length + value.length);
    setMemtable((prev) => {
      const existing = prev.findIndex((e) => e.key === key);
      let updated: KVPair[];
      if (existing >= 0) {
        updated = [...prev];
        updated[existing] = { key, value, tombstone };
      } else {
        updated = [...prev, { key, value, tombstone }];
      }
      updated.sort((a, b) => a.key.localeCompare(b.key));
      return updated;
    });
    addEvent(
      tombstone
        ? `DELETE ${key} (tombstone written to memtable)`
        : `WRITE ${key}=${value} to memtable`,
      tombstone ? "delete" : "write"
    );
  }, [addEvent]);

  /* ─── Flush memtable to L0 ─── */
  const flushMemtable = useCallback(() => {
    const currentMem = memtableRef.current;
    if (currentMem.length === 0) return;

    const newSST = createSSTable(0, currentMem);
    setTotalBytesWritten((b) => b + currentMem.reduce((s, e) => s + e.key.length + e.value.length, 0));
    setSstables((prev) => [...prev, newSST]);
    setMemtable([]);
    addEvent(
      `FLUSH memtable -> L0 SSTable [${newSST.minKey}..${newSST.maxKey}] (${newSST.entries.length} keys)`,
      "flush"
    );
    setSim((prev) => ({ ...prev, flushAnimating: true }));
    setTimeout(() => setSim((prev) => ({ ...prev, flushAnimating: false })), 600);
  }, [addEvent]);

  /* ─── Compaction ─── */
  const runCompaction = useCallback((fromLevel: number) => {
    const currentSSTs = sstablesRef.current;
    const tablesAtLevel = currentSSTs.filter((s) => s.level === fromLevel);
    if (tablesAtLevel.length < 2) return;

    const targetLevel = fromLevel + 1;
    const tablesAtTarget = currentSSTs.filter((s) => s.level === targetLevel);

    // Mark as merging
    setSstables((prev) =>
      prev.map((s) =>
        tablesAtLevel.includes(s) || tablesAtTarget.includes(s)
          ? { ...s, merging: true }
          : s
      )
    );

    addEvent(
      `COMPACTION L${fromLevel} (${tablesAtLevel.length} SSTables) + L${targetLevel} (${tablesAtTarget.length} SSTables)`,
      "compact"
    );

    const allToMerge = [...tablesAtLevel, ...tablesAtTarget];
    const merged = mergeSSTables(allToMerge);
    const bytesWritten = merged.reduce((s, e) => s + e.key.length + e.value.length, 0);
    setTotalBytesWritten((b) => b + bytesWritten);

    // Split merged entries into SSTables of size MEMTABLE_CAPACITY at target level
    const newSSTables: SSTable[] = [];
    for (let i = 0; i < merged.length; i += MEMTABLE_CAPACITY) {
      const chunk = merged.slice(i, i + MEMTABLE_CAPACITY);
      newSSTables.push(createSSTable(targetLevel, chunk));
    }

    setSim((prev) => ({ ...prev, compactAnimating: true }));

    setTimeout(() => {
      setSstables((prev) => {
        const remaining = prev.filter(
          (s) => !allToMerge.some((m) => m.id === s.id)
        );
        return [...remaining, ...newSSTables];
      });
      addEvent(
        `COMPACTION complete -> L${targetLevel}: ${newSSTables.length} SSTables [${newSSTables.map((s) => `${s.minKey}..${s.maxKey}`).join(", ")}]`,
        "compact"
      );
      setSim((prev) => ({ ...prev, compactAnimating: false }));
    }, 400);
  }, [addEvent]);

  /* ─── Read key ─── */
  const readKey = useCallback((key: string) => {
    const mem = memtableRef.current;
    const ssts = sstablesRef.current;

    addEvent(`READ ${key}: checking memtable...`, "read");

    // Check memtable
    const memResult = mem.find((e) => e.key === key);
    if (memResult) {
      if (memResult.tombstone) {
        addEvent(`READ ${key}: found TOMBSTONE in memtable (deleted)`, "read");
      } else {
        addEvent(`READ ${key}: FOUND in memtable -> ${memResult.value}`, "read");
      }
      setSim((prev) => ({
        ...prev,
        readProbe: {
          key,
          phase: "found",
          found: !memResult.tombstone,
          value: memResult.tombstone ? null : memResult.value,
          bloomResults: [],
          currentLevelIndex: -1,
        },
      }));
      return;
    }

    addEvent(`READ ${key}: not in memtable, checking SSTables...`, "read");

    // Check each level L0, L1, L2
    const bloomResults: BloomResult[] = [];
    for (let level = 0; level <= 2; level++) {
      const levelSSTs = ssts
        .filter((s) => s.level === level)
        .sort((a, b) => parseInt(b.id.split("-")[1]) - parseInt(a.id.split("-")[1]));

      for (const sst of levelSSTs) {
        const bloomHit = bloomCheck(sst, key);
        bloomResults.push({
          level,
          sstableId: sst.id,
          result: bloomHit ? "probably-yes" : "definitely-no",
          checked: true,
        });

        if (bloomHit) {
          addEvent(
            `READ ${key}: Bloom filter L${level}/${sst.id} -> probably yes, checking...`,
            "bloom"
          );
          const found = sst.entries.find((e) => e.key === key);
          if (found) {
            if (found.tombstone) {
              addEvent(`READ ${key}: found TOMBSTONE in L${level} (deleted)`, "read");
              setSim((prev) => ({
                ...prev,
                readProbe: { key, phase: "found", found: false, value: null, bloomResults, currentLevelIndex: level },
              }));
            } else {
              addEvent(`READ ${key}: FOUND in L${level} -> ${found.value}`, "read");
              setSim((prev) => ({
                ...prev,
                readProbe: { key, phase: "found", found: true, value: found.value, bloomResults, currentLevelIndex: level },
              }));
            }
            return;
          } else {
            addEvent(`READ ${key}: Bloom false positive at L${level}/${sst.id}`, "bloom");
          }
        } else {
          addEvent(
            `READ ${key}: Bloom filter L${level}/${sst.id} -> definitely no, skipping`,
            "bloom"
          );
        }
      }
    }

    addEvent(`READ ${key}: NOT FOUND in any level`, "read");
    setSim((prev) => ({
      ...prev,
      readProbe: { key, phase: "not-found", found: false, value: null, bloomResults, currentLevelIndex: -1 },
    }));
  }, [addEvent]);

  /* ─── Step forward ─── */
  const stepForward = useCallback(() => {
    const currentSim = simRef.current;
    const currentMem = memtableRef.current;
    const currentSSTs = sstablesRef.current;

    // Check if we need to flush
    if (currentMem.length >= MEMTABLE_CAPACITY) {
      flushMemtable();
      return;
    }

    // Check if we need to compact
    const l0Count = currentSSTs.filter((s) => s.level === 0).length;
    const l1Count = currentSSTs.filter((s) => s.level === 1).length;
    if (l0Count >= L0_COMPACT_THRESHOLD) {
      runCompaction(0);
      return;
    }
    if (l1Count >= L1_COMPACT_THRESHOLD) {
      runCompaction(1);
      return;
    }

    // Auto-write from queue
    if (currentSim.autoWriteQueue.length > 0 && currentSim.autoWriteIndex < currentSim.autoWriteQueue.length) {
      const entry = currentSim.autoWriteQueue[currentSim.autoWriteIndex];
      writeToMemtable(entry.key, entry.value, entry.tombstone);
      setSim((prev) => ({ ...prev, autoWriteIndex: prev.autoWriteIndex + 1, step: prev.step + 1 }));
      return;
    }

    // If scenario is read-after-write and queue exhausted, do a read
    if (activeScenario === "read-after-write" && currentSim.autoWriteIndex >= currentSim.autoWriteQueue.length && !currentSim.readProbe) {
      readKey("a");
      setSim((prev) => ({ ...prev, phase: "complete" }));
      return;
    }

    // Mark complete
    if (currentSim.autoWriteIndex >= currentSim.autoWriteQueue.length) {
      setSim((prev) => ({ ...prev, phase: "complete" }));
      setIsPlaying(false);
    }
  }, [flushMemtable, runCompaction, writeToMemtable, readKey, activeScenario]);

  /* ─── Animation loop ─── */
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
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [isPlaying, animationLoop]);

  /* ─── Controls ─── */
  const handlePlay = useCallback(() => {
    if (simRef.current.phase === "idle" || simRef.current.phase === "complete") {
      // Start scenario
      let queue: KVPair[] = [];
      switch (activeScenario) {
        case "write-heavy":
          queue = WRITE_HEAVY_DATA;
          break;
        case "read-after-write":
          queue = [
            { key: "a", value: "1" }, { key: "b", value: "2" },
            { key: "c", value: "3" }, { key: "a", value: "100" },
            { key: "d", value: "4" }, { key: "e", value: "5" },
            { key: "f", value: "6" }, { key: "a", value: "999" },
          ];
          break;
        case "compaction-trigger":
          queue = COMPACTION_DATA;
          break;
        case "range-query":
          queue = RANGE_DATA;
          break;
      }
      setSim((prev) => ({
        ...prev,
        phase: "writing",
        autoWriteQueue: queue,
        autoWriteIndex: 0,
        readProbe: null,
      }));
      addEvent(`Scenario started: ${SCENARIOS.find((s) => s.id === activeScenario)?.label}`, "info");
    }
    setIsPlaying(true);
  }, [activeScenario, addEvent]);

  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleStep = useCallback(() => stepForward(), [stepForward]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    globalSstId = 0;
    globalEventId = 0;
    setMemtable([]);
    setSstables([]);
    setEvents([]);
    setTotalBytesWritten(0);
    setTotalBytesReceived(0);
    setSim({
      phase: "idle",
      step: 0,
      autoWriteQueue: [],
      autoWriteIndex: 0,
      readProbe: null,
      flushAnimating: false,
      compactAnimating: false,
    });
    setInputKey("");
    setInputValue("");
  }, []);

  /* ─── Scenario selection ─── */
  const handleScenarioSelect = useCallback((id: string) => {
    handleReset();
    setActiveScenario(id);
  }, [handleReset]);

  /* ─── Manual operations ─── */
  const handleManualWrite = useCallback(() => {
    if (!inputKey.trim()) return;
    writeToMemtable(inputKey.trim(), inputValue.trim() || "null");
    setInputKey("");
    setInputValue("");
    // Auto flush if full
    if (memtableRef.current.length >= MEMTABLE_CAPACITY) {
      setTimeout(() => flushMemtable(), 300);
    }
  }, [inputKey, inputValue, writeToMemtable, flushMemtable]);

  const handleManualRead = useCallback(() => {
    if (!inputKey.trim()) return;
    readKey(inputKey.trim());
  }, [inputKey, readKey]);

  const handleManualDelete = useCallback(() => {
    if (!inputKey.trim()) return;
    writeToMemtable(inputKey.trim(), "", true);
    setInputKey("");
    setInputValue("");
  }, [inputKey, writeToMemtable]);

  /* ─── Computed metrics ─── */
  const metrics = useMemo(() => {
    const l0Count = sstables.filter((s) => s.level === 0).length;
    const l1Count = sstables.filter((s) => s.level === 1).length;
    const l2Count = sstables.filter((s) => s.level === 2).length;
    const writeAmp = totalBytesReceived > 0
      ? (totalBytesWritten / totalBytesReceived).toFixed(1)
      : "0";
    return {
      memSize: memtable.length,
      memCapacity: MEMTABLE_CAPACITY,
      l0Count,
      l1Count,
      l2Count,
      totalSSTs: sstables.length,
      writeAmplification: writeAmp,
      totalBytesWritten,
      totalBytesReceived,
    };
  }, [memtable.length, sstables, totalBytesWritten, totalBytesReceived]);

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */

  const levelColors = ["#6366f1", "#06b6d4", "#10b981"];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />

      <div className="pt-14">
        {/* ── Header ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-3 mb-2">
              <span
                className="text-xs font-mono font-medium px-2 py-1 rounded border"
                style={{
                  backgroundColor: `${DOMAIN_COLOR}15`,
                  color: DOMAIN_COLOR,
                  borderColor: `${DOMAIN_COLOR}30`,
                }}
              >
                6.3
              </span>
              <div className="flex items-center gap-1.5 text-xs text-[#71717a]">
                <Database size={12} />
                <span>Database Internals</span>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              LSM Trees
            </h1>
            <p className="mt-1.5 text-[#a1a1aa] text-sm sm:text-base max-w-2xl">
              Log-Structured Merge Trees: memtable writes, SSTable flushes, compaction, bloom filters, and read/write amplification
            </p>
          </motion.div>
        </div>

        {/* ── Scenario selector ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[#71717a] mr-1">Presets</span>
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => handleScenarioSelect(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                  activeScenario === s.id
                    ? "bg-[#ec4899]/15 text-[#ec4899] border border-[#ec4899]/30"
                    : "bg-[#1e1e2e] text-[#a1a1aa] border border-transparent hover:bg-[#2a2a3e] hover:text-white"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4">
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

        {/* ── Main Layout ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
            {/* ── Left Column ── */}
            <div className="space-y-4">
              {/* ── Manual input ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="flex items-center gap-2 flex-wrap"
              >
                <input
                  type="text"
                  placeholder="Key"
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-[#111118] border border-[#1e1e2e] text-sm font-mono text-white placeholder-[#71717a] w-24 focus:outline-none focus:border-[#6366f1]"
                />
                <input
                  type="text"
                  placeholder="Value"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-[#111118] border border-[#1e1e2e] text-sm font-mono text-white placeholder-[#71717a] w-24 focus:outline-none focus:border-[#6366f1]"
                />
                <button
                  onClick={handleManualWrite}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#6366f1]/15 border border-[#6366f1]/30 text-[#6366f1] hover:bg-[#6366f1]/25 transition-all"
                >
                  <PenLine size={12} />
                  Write
                </button>
                <button
                  onClick={handleManualRead}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#06b6d4]/15 border border-[#06b6d4]/30 text-[#06b6d4] hover:bg-[#06b6d4]/25 transition-all"
                >
                  <Search size={12} />
                  Read
                </button>
                <button
                  onClick={handleManualDelete}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#ef4444]/15 border border-[#ef4444]/30 text-[#ef4444] hover:bg-[#ef4444]/25 transition-all"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              </motion.div>

              {/* ── LSM Tree Visualization ── */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4 space-y-4"
              >
                {/* Memtable */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-[#f59e0b]" />
                    <span className="text-xs font-medium text-[#f59e0b]">
                      Memtable (In-Memory, Sorted)
                    </span>
                    <span className="text-[10px] font-mono text-[#71717a] ml-auto">
                      {memtable.length}/{MEMTABLE_CAPACITY}
                    </span>
                    {memtable.length >= MEMTABLE_CAPACITY && (
                      <span className="text-[10px] text-[#ef4444] font-medium animate-pulse">
                        FULL
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 min-h-[40px] px-2 py-1.5 rounded-lg bg-[#0a0a0f] border border-[#f59e0b]/20">
                    <AnimatePresence mode="popLayout">
                      {memtable.length === 0 && (
                        <motion.span
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="text-[10px] text-[#71717a] italic"
                        >
                          Empty
                        </motion.span>
                      )}
                      {memtable.map((entry) => (
                        <motion.div
                          key={entry.key}
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.8, opacity: 0, y: 20 }}
                          transition={{ duration: 0.2 }}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono border ${
                            entry.tombstone
                              ? "bg-[#ef4444]/10 border-[#ef4444]/30 text-[#ef4444]"
                              : "bg-[#f59e0b]/10 border-[#f59e0b]/30 text-[#f59e0b]"
                          }`}
                        >
                          <span className="font-bold">{entry.key}</span>
                          <span className="text-[#71717a]">:</span>
                          <span>{entry.tombstone ? "DEL" : entry.value}</span>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>

                  {/* Flush arrow */}
                  <AnimatePresence>
                    {sim.flushAnimating && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center justify-center py-1"
                      >
                        <FileDown size={16} className="text-[#f59e0b] animate-bounce" />
                        <span className="text-[10px] text-[#f59e0b] ml-1">Flushing to L0</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* SSTable Levels */}
                {[0, 1, 2].map((level) => {
                  const levelSSTs = sstables
                    .filter((s) => s.level === level)
                    .sort((a, b) => parseInt(b.id.split("-")[1]) - parseInt(a.id.split("-")[1]));
                  const color = levelColors[level];
                  const threshold = level === 0 ? L0_COMPACT_THRESHOLD : level === 1 ? L1_COMPACT_THRESHOLD : 99;

                  return (
                    <div key={level}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                        <span className="text-xs font-medium" style={{ color }}>
                          Level {level} SSTables
                        </span>
                        <span className="text-[10px] font-mono text-[#71717a] ml-auto">
                          {levelSSTs.length} tables
                        </span>
                        {levelSSTs.length >= threshold && level < 2 && (
                          <span className="text-[10px] text-[#ef4444] font-medium animate-pulse">
                            COMPACT
                          </span>
                        )}
                      </div>

                      <div className="space-y-1.5 min-h-[32px]">
                        {levelSSTs.length === 0 && (
                          <div className="text-[10px] text-[#71717a] italic px-2 py-1">
                            Empty
                          </div>
                        )}
                        <AnimatePresence mode="popLayout">
                          {levelSSTs.map((sst) => (
                            <motion.div
                              key={sst.id}
                              initial={{ scale: 0.9, opacity: 0 }}
                              animate={{
                                scale: 1,
                                opacity: sst.merging ? 0.5 : 1,
                                borderColor: sst.merging ? "#ef4444" : sst.highlighted ? "#ec4899" : `${color}40`,
                              }}
                              exit={{ scale: 0.8, opacity: 0, x: 20 }}
                              transition={{ duration: 0.3 }}
                              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[#0a0a0f] border"
                            >
                              <span className="text-[9px] font-mono text-[#71717a] shrink-0 w-12">
                                {sst.id}
                              </span>
                              <div className="flex items-center gap-0.5 flex-wrap flex-1">
                                {sst.entries.map((entry, idx) => (
                                  <span
                                    key={idx}
                                    className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                                      entry.tombstone
                                        ? "bg-[#ef4444]/10 text-[#ef4444]"
                                        : "bg-[#1e1e2e] text-[#a1a1aa]"
                                    }`}
                                  >
                                    {entry.key}:{entry.tombstone ? "X" : entry.value}
                                  </span>
                                ))}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Filter size={10} className="text-[#71717a]" />
                                <span className="text-[8px] text-[#71717a]">bloom</span>
                              </div>
                              {sst.merging && (
                                <Merge size={12} className="text-[#ef4444] animate-spin shrink-0" />
                              )}
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>

                      {/* Compaction arrow */}
                      {level < 2 && sim.compactAnimating && levelSSTs.some((s) => s.merging) && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex items-center justify-center py-1"
                        >
                          <ChevronDown size={14} className="text-[#ef4444] animate-bounce" />
                          <span className="text-[10px] text-[#ef4444] ml-1">
                            Merging to L{level + 1}
                          </span>
                        </motion.div>
                      )}
                    </div>
                  );
                })}

                {/* Read Probe Result */}
                <AnimatePresence>
                  {sim.readProbe && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={`rounded-lg border p-3 ${
                        sim.readProbe.found
                          ? "bg-[#10b981]/10 border-[#10b981]/30"
                          : "bg-[#ef4444]/10 border-[#ef4444]/30"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {sim.readProbe.found ? (
                          <CheckCircle2 size={14} className="text-[#10b981]" />
                        ) : (
                          <XCircle size={14} className="text-[#ef4444]" />
                        )}
                        <span className="text-xs font-medium">
                          {sim.readProbe.found ? (
                            <span className="text-[#10b981]">
                              Found: {sim.readProbe.key} = {sim.readProbe.value}
                            </span>
                          ) : (
                            <span className="text-[#ef4444]">
                              Key &quot;{sim.readProbe.key}&quot; not found
                            </span>
                          )}
                        </span>
                      </div>
                      {sim.readProbe.bloomResults.length > 0 && (
                        <div className="mt-2 space-y-0.5">
                          {sim.readProbe.bloomResults.map((br, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-2 text-[10px] font-mono"
                            >
                              <span className="text-[#71717a]">L{br.level}/{br.sstableId}</span>
                              <span
                                className={
                                  br.result === "probably-yes"
                                    ? "text-[#f59e0b]"
                                    : "text-[#10b981]"
                                }
                              >
                                {br.result === "probably-yes"
                                  ? "probably yes"
                                  : "definitely no"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* ── Write Amplification Visualization ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Zap size={14} className="text-[#f59e0b]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">
                    Write Amplification
                  </span>
                  <span className="text-xs font-mono ml-auto" style={{ color: "#f59e0b" }}>
                    {metrics.writeAmplification}x
                  </span>
                </div>

                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-[#71717a]">Bytes Received (client writes)</span>
                      <span className="text-[10px] font-mono text-[#06b6d4]">{metrics.totalBytesReceived}B</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[#0a0a0f] overflow-hidden">
                      <motion.div
                        animate={{
                          width: `${Math.min(100, (metrics.totalBytesReceived / Math.max(metrics.totalBytesWritten, 1)) * 100)}%`,
                        }}
                        className="h-full rounded-full bg-[#06b6d4]"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-[#71717a]">Total Bytes Written (disk)</span>
                      <span className="text-[10px] font-mono text-[#f59e0b]">{metrics.totalBytesWritten}B</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[#0a0a0f] overflow-hidden">
                      <motion.div
                        animate={{ width: "100%" }}
                        className="h-full rounded-full bg-[#f59e0b]"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-[#71717a] pt-1">
                    Compaction rewrites data to lower levels, multiplying total disk writes beyond what the client sent.
                  </p>
                </div>
              </motion.div>
            </div>

            {/* ── Right Column ── */}
            <div className="space-y-4">
              {/* ── Metrics ── */}
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
                      <div className="flex items-center gap-2 mb-1">
                        <Activity size={14} className="text-[#ec4899]" />
                        <span className="text-sm font-medium text-[#a1a1aa]">Metrics</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <MetricCard
                          label="Memtable"
                          value={`${metrics.memSize}/${metrics.memCapacity}`}
                          color={metrics.memSize >= metrics.memCapacity ? "#ef4444" : "#f59e0b"}
                        />
                        <MetricCard
                          label="L0 SSTables"
                          value={String(metrics.l0Count)}
                          color="#6366f1"
                        />
                        <MetricCard
                          label="L1 SSTables"
                          value={String(metrics.l1Count)}
                          color="#06b6d4"
                        />
                        <MetricCard
                          label="L2 SSTables"
                          value={String(metrics.l2Count)}
                          color="#10b981"
                        />
                        <MetricCard
                          label="Write Amp"
                          value={`${metrics.writeAmplification}x`}
                          color="#f59e0b"
                        />
                        <MetricCard
                          label="Total SSTables"
                          value={String(metrics.totalSSTs)}
                          color="#a1a1aa"
                        />
                      </div>

                      {/* Level fill indicators */}
                      <div className="space-y-1 pt-1">
                        {[0, 1, 2].map((level) => {
                          const count = sstables.filter((s) => s.level === level).length;
                          const threshold = level === 0 ? L0_COMPACT_THRESHOLD : level === 1 ? L1_COMPACT_THRESHOLD : 8;
                          return (
                            <div key={level} className="flex items-center gap-2">
                              <span className="text-[9px] font-mono text-[#71717a] w-6">L{level}</span>
                              <div className="flex-1 h-1.5 rounded-full bg-[#0a0a0f] overflow-hidden">
                                <motion.div
                                  animate={{ width: `${Math.min(100, (count / threshold) * 100)}%` }}
                                  className="h-full rounded-full"
                                  style={{ backgroundColor: levelColors[level] }}
                                />
                              </div>
                              <span className="text-[9px] font-mono text-[#71717a]">
                                {count}/{threshold}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Event Log ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.25 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] flex flex-col"
                style={{ height: showMetrics ? "380px" : "580px" }}
              >
                <div className="flex items-center gap-2 p-3 border-b border-[#1e1e2e]">
                  <div className="w-2 h-2 rounded-full bg-[#ec4899] animate-pulse" />
                  <span className="text-sm font-medium text-[#a1a1aa]">
                    Operation Log
                  </span>
                  <span className="text-[10px] font-mono text-[#71717a] ml-auto">
                    {events.length} ops
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-0.5 scrollbar-thin">
                  {events.length === 0 && (
                    <div className="flex items-center justify-center h-full text-xs text-[#71717a]">
                      Press Play or use manual controls
                    </div>
                  )}
                  {events.map((evt) => {
                    const color =
                      evt.type === "write" ? "#6366f1"
                        : evt.type === "flush" ? "#f59e0b"
                          : evt.type === "compact" ? "#ef4444"
                            : evt.type === "read" ? "#06b6d4"
                              : evt.type === "bloom" ? "#10b981"
                                : evt.type === "delete" ? "#ef4444"
                                  : "#a1a1aa";
                    return (
                      <motion.div
                        key={evt.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.15 }}
                        className="flex items-start gap-2 px-2 py-1 rounded hover:bg-[#ffffff04]"
                      >
                        <div
                          className="w-1 h-1 rounded-full shrink-0 mt-1.5"
                          style={{ backgroundColor: color }}
                        />
                        <span
                          className="text-[11px] font-mono leading-snug break-all"
                          style={{ color }}
                        >
                          {evt.message}
                        </span>
                      </motion.div>
                    );
                  })}
                  <div ref={eventsEndRef} />
                </div>
              </motion.div>

              {/* ── Read Amplification Visualization ── */}
              {sim.readProbe && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.28 }}
                  className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Search size={14} className="text-[#06b6d4]" />
                    <span className="text-sm font-medium text-[#a1a1aa]">
                      Read Path Detail
                    </span>
                    <span className="text-xs font-mono text-[#06b6d4] ml-auto">
                      key: &quot;{sim.readProbe.key}&quot;
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {/* Memtable check */}
                    <div className="flex items-center gap-2 text-[10px] font-mono px-2 py-1 rounded bg-[#0a0a0f]">
                      <div className="w-2 h-2 rounded-full bg-[#f59e0b]" />
                      <span className="text-[#f59e0b]">Memtable</span>
                      <span className="text-[#71717a] ml-auto">
                        {sim.readProbe.phase === "found" && sim.readProbe.bloomResults.length === 0
                          ? "HIT"
                          : "MISS"}
                      </span>
                    </div>
                    {/* Bloom filter results per SSTable */}
                    {sim.readProbe.bloomResults.map((br, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-[10px] font-mono px-2 py-1 rounded bg-[#0a0a0f]"
                      >
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{
                            backgroundColor:
                              br.result === "probably-yes" ? "#f59e0b" : "#10b981",
                          }}
                        />
                        <span className="text-[#71717a]">
                          L{br.level}/{br.sstableId}
                        </span>
                        <Filter size={10} className="text-[#71717a]" />
                        <span
                          style={{
                            color: br.result === "probably-yes" ? "#f59e0b" : "#10b981",
                          }}
                        >
                          {br.result === "probably-yes" ? "probably yes" : "definitely no"}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* ── SSTable Key Summary ── */}
              {sstables.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.29 }}
                  className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Database size={14} className="text-[#a1a1aa]" />
                    <span className="text-sm font-medium text-[#a1a1aa]">
                      SSTable Summary
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {[0, 1, 2].map((level) => {
                      const levelSSTs = sstables.filter((s) => s.level === level);
                      if (levelSSTs.length === 0) return null;
                      const totalKeys = levelSSTs.reduce(
                        (sum, s) => sum + s.entries.length,
                        0
                      );
                      const allKeys = new Set(
                        levelSSTs.flatMap((s) => s.entries.map((e) => e.key))
                      );
                      return (
                        <div
                          key={level}
                          className="flex items-center gap-2 text-[10px] font-mono px-2 py-1.5 rounded bg-[#0a0a0f]"
                        >
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: levelColors[level] }}
                          />
                          <span style={{ color: levelColors[level] }}>
                            L{level}
                          </span>
                          <span className="text-[#71717a]">
                            {levelSSTs.length} tables, {totalKeys} entries, {allKeys.size} unique keys
                          </span>
                          <span className="text-[#71717a] ml-auto">
                            [{levelSSTs[0]?.minKey}..{levelSSTs[levelSSTs.length - 1]?.maxKey}]
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* ── Concept Info ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.3 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Layers size={14} className="text-[#f59e0b]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">
                    How LSM Trees Work
                  </span>
                </div>
                <div className="text-xs text-[#71717a] space-y-1.5">
                  <p>
                    <strong className="text-[#f59e0b]">Write path:</strong> All writes go to an in-memory sorted structure (memtable). When the memtable reaches capacity ({MEMTABLE_CAPACITY} entries), it is flushed as an immutable SSTable to Level 0.
                  </p>
                  <p>
                    <strong className="text-[#6366f1]">Compaction:</strong> When L0 accumulates {L0_COMPACT_THRESHOLD} SSTables, they are merge-sorted into L1, deduplicating keys. L1 compacts similarly to L2 at {L1_COMPACT_THRESHOLD} tables.
                  </p>
                  <p>
                    <strong className="text-[#06b6d4]">Read path:</strong> Check memtable first (newest writes), then L0 (newest first), then L1, then L2. Bloom filters let us skip SSTables that definitely do not contain the target key.
                  </p>
                  <p>
                    <strong className="text-[#ef4444]">Deletes:</strong> Write a tombstone marker instead of removing. Actual key removal happens during compaction when tombstones are garbage-collected.
                  </p>
                  <p>
                    <strong className="text-[#10b981]">Bloom filters:</strong> Probabilistic data structure. Returns &quot;definitely not here&quot; or &quot;probably here&quot;. False positives possible but false negatives impossible. Saves disk I/O by avoiding unnecessary SSTable reads.
                  </p>
                  <p>
                    <strong className="text-white">Write amplification:</strong> Total bytes written to disk divided by bytes received from clients. Compaction rewrites data multiple times as it moves down levels. Typical LSM trees have 10-30x write amplification.
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════ */

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-[#71717a] mb-0.5">
        {label}
      </div>
      <div className="text-base font-bold font-mono" style={{ color }}>
        {value}
      </div>
    </div>
  );
}