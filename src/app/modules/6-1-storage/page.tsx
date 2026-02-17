"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database,
  HardDrive,
  Table,
  Columns,
  ArrowRight,
  Search,
  PenLine,
  Zap,
  Activity,
  Layers,
  BarChart3,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

/* ═══════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════ */

type StoreMode = "row-store" | "column-store" | "read-path" | "write-path";

interface TableRow {
  id: number;
  name: string;
  age: number;
  city: string;
  salary: number;
}

interface DiskPage {
  id: string;
  label: string;
  contents: string[];
  storeType: "row" | "column";
  columnName?: string;
  highlighted: boolean;
  justRead: boolean;
}

interface BufferEntry {
  pageId: string;
  label: string;
  hits: number;
  justLoaded: boolean;
}

interface QueryStep {
  description: string;
  pagesAccessed: string[];
  storeType: "row" | "column";
  ioCost: number;
  cacheHit: boolean;
}

interface SimulationState {
  step: number;
  totalSteps: number;
  querySteps: QueryStep[];
  currentStepIndex: number;
  rowPagesRead: number;
  colPagesRead: number;
  rowCacheHits: number;
  colCacheHits: number;
  phase: "idle" | "running" | "complete";
  activeQuery: string;
  animatingPageId: string | null;
  insertedRow: TableRow | null;
}

interface EventLogEntry {
  id: number;
  message: string;
  type: "read" | "write" | "cache-hit" | "cache-miss" | "info" | "compare";
}

const SAMPLE_DATA: TableRow[] = [
  { id: 1, name: "Alice", age: 28, city: "NYC", salary: 85000 },
  { id: 2, name: "Bob", age: 34, city: "SF", salary: 120000 },
  { id: 3, name: "Carol", age: 25, city: "LA", salary: 72000 },
  { id: 4, name: "Dave", age: 41, city: "CHI", salary: 95000 },
  { id: 5, name: "Eve", age: 31, city: "SEA", salary: 110000 },
  { id: 6, name: "Frank", age: 29, city: "NYC", salary: 88000 },
  { id: 7, name: "Grace", age: 37, city: "BOS", salary: 102000 },
  { id: 8, name: "Hank", age: 45, city: "DEN", salary: 78000 },
];

const NEW_ROWS: TableRow[] = [
  { id: 9, name: "Ivy", age: 26, city: "ATL", salary: 91000 },
  { id: 10, name: "Jack", age: 33, city: "MIA", salary: 105000 },
  { id: 11, name: "Kate", age: 30, city: "PDX", salary: 97000 },
  { id: 12, name: "Leo", age: 38, city: "DAL", salary: 115000 },
];

const COLUMNS = ["id", "name", "age", "city", "salary"] as const;
type ColumnKey = (typeof COLUMNS)[number];

const PAGE_SIZE = 4; // rows per page in row store, or values per page in column store

const SCENARIOS = [
  { id: "full-scan", label: "Full Row Scan", description: "SELECT * FROM users" },
  { id: "col-projection", label: "Column Projection", description: "SELECT name, age FROM users" },
  { id: "single-lookup", label: "Single Row Lookup", description: "SELECT * FROM users WHERE id=3" },
  { id: "bulk-insert", label: "Bulk Insert", description: "INSERT 4 new rows" },
];

const DOMAIN_COLOR = "#ec4899";

/* ═══════════════════════════════════════════════════════════
   HELPER FUNCTIONS
   ═══════════════════════════════════════════════════════════ */

let eventIdCounter = 0;

function buildRowPages(data: TableRow[]): DiskPage[] {
  const pages: DiskPage[] = [];
  for (let i = 0; i < data.length; i += PAGE_SIZE) {
    const chunk = data.slice(i, i + PAGE_SIZE);
    const pageIdx = Math.floor(i / PAGE_SIZE);
    pages.push({
      id: `row-page-${pageIdx}`,
      label: `Page ${pageIdx}`,
      contents: chunk.map(
        (r) => `[${r.id}|${r.name}|${r.age}|${r.city}|${r.salary}]`
      ),
      storeType: "row",
      highlighted: false,
      justRead: false,
    });
  }
  return pages;
}

function buildColumnPages(data: TableRow[]): DiskPage[] {
  const pages: DiskPage[] = [];
  for (const col of COLUMNS) {
    const values = data.map((r) => String(r[col]));
    for (let i = 0; i < values.length; i += PAGE_SIZE) {
      const chunk = values.slice(i, i + PAGE_SIZE);
      const pageIdx = Math.floor(i / PAGE_SIZE);
      pages.push({
        id: `col-${col}-page-${pageIdx}`,
        label: `${col}[${pageIdx}]`,
        contents: chunk,
        storeType: "column",
        columnName: col,
        highlighted: false,
        justRead: false,
      });
    }
  }
  return pages;
}

function buildQuerySteps(
  scenario: string,
  data: TableRow[]
): { rowSteps: QueryStep[]; colSteps: QueryStep[] } {
  const numRowPages = Math.ceil(data.length / PAGE_SIZE);
  const numColPagesPerCol = Math.ceil(data.length / PAGE_SIZE);

  switch (scenario) {
    case "full-scan": {
      const rowSteps: QueryStep[] = [];
      for (let i = 0; i < numRowPages; i++) {
        rowSteps.push({
          description: `Read row page ${i} (rows ${i * PAGE_SIZE + 1}-${Math.min((i + 1) * PAGE_SIZE, data.length)})`,
          pagesAccessed: [`row-page-${i}`],
          storeType: "row",
          ioCost: 1,
          cacheHit: false,
        });
      }
      const colSteps: QueryStep[] = [];
      for (const col of COLUMNS) {
        for (let i = 0; i < numColPagesPerCol; i++) {
          colSteps.push({
            description: `Read ${col} column page ${i}`,
            pagesAccessed: [`col-${col}-page-${i}`],
            storeType: "column",
            ioCost: 1,
            cacheHit: false,
          });
        }
      }
      return { rowSteps, colSteps };
    }
    case "col-projection": {
      const rowSteps: QueryStep[] = [];
      for (let i = 0; i < numRowPages; i++) {
        rowSteps.push({
          description: `Read row page ${i} (need name,age but load entire rows)`,
          pagesAccessed: [`row-page-${i}`],
          storeType: "row",
          ioCost: 1,
          cacheHit: false,
        });
      }
      const colSteps: QueryStep[] = [];
      for (const col of ["name", "age"] as ColumnKey[]) {
        for (let i = 0; i < numColPagesPerCol; i++) {
          colSteps.push({
            description: `Read ${col} column page ${i}`,
            pagesAccessed: [`col-${col}-page-${i}`],
            storeType: "column",
            ioCost: 1,
            cacheHit: false,
          });
        }
      }
      return { rowSteps, colSteps };
    }
    case "single-lookup": {
      const targetPage = 0; // id=3 is in first page
      const rowSteps: QueryStep[] = [
        {
          description: `Read row page ${targetPage} (contains id=3)`,
          pagesAccessed: [`row-page-${targetPage}`],
          storeType: "row",
          ioCost: 1,
          cacheHit: false,
        },
      ];
      const colSteps: QueryStep[] = [];
      for (const col of COLUMNS) {
        colSteps.push({
          description: `Read ${col} column page 0 (row 3 offset)`,
          pagesAccessed: [`col-${col}-page-0`],
          storeType: "column",
          ioCost: 1,
          cacheHit: false,
        });
      }
      return { rowSteps, colSteps };
    }
    case "bulk-insert": {
      const newPageIdx = numRowPages;
      const rowSteps: QueryStep[] = [
        {
          description: `Write new row page ${newPageIdx} (4 rows contiguous)`,
          pagesAccessed: [`row-page-${newPageIdx}`],
          storeType: "row",
          ioCost: 1,
          cacheHit: false,
        },
      ];
      const colSteps: QueryStep[] = [];
      for (const col of COLUMNS) {
        colSteps.push({
          description: `Append to ${col} column page ${numColPagesPerCol}`,
          pagesAccessed: [`col-${col}-page-${numColPagesPerCol}`],
          storeType: "column",
          ioCost: 1,
          cacheHit: false,
        });
      }
      return { rowSteps, colSteps };
    }
    default:
      return { rowSteps: [], colSteps: [] };
  }
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function StorageEnginePage() {
  /* ─── Core state ─── */
  const [data, setData] = useState<TableRow[]>(SAMPLE_DATA);
  const [mode, setMode] = useState<StoreMode>("row-store");
  const [activeScenario, setActiveScenario] = useState("full-scan");
  const [rowPages, setRowPages] = useState<DiskPage[]>(() => buildRowPages(SAMPLE_DATA));
  const [colPages, setColPages] = useState<DiskPage[]>(() => buildColumnPages(SAMPLE_DATA));
  const [bufferPool, setBufferPool] = useState<BufferEntry[]>([]);
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [sim, setSim] = useState<SimulationState>({
    step: 0,
    totalSteps: 0,
    querySteps: [],
    currentStepIndex: -1,
    rowPagesRead: 0,
    colPagesRead: 0,
    rowCacheHits: 0,
    colCacheHits: 0,
    phase: "idle",
    activeQuery: "",
    animatingPageId: null,
    insertedRow: null,
  });

  /* ─── UI state ─── */
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);

  /* ─── Refs for animation loop ─── */
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const newRowIndexRef = useRef(0);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const eventsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  /* ─── Add event helper ─── */
  const addEvent = useCallback(
    (message: string, type: EventLogEntry["type"]) => {
      setEvents((prev) => [
        ...prev,
        { id: ++eventIdCounter, message, type },
      ].slice(-150));
    },
    []
  );

  /* ─── Step forward logic ─── */
  const stepForward = useCallback(() => {
    setSim((prev) => {
      if (prev.phase === "complete" || prev.phase === "idle") {
        // Auto-play: start a scenario sequence
        if (prev.phase === "idle") {
          const scenario = activeScenario;
          const { rowSteps, colSteps } = buildQuerySteps(scenario, data);
          const allSteps = [...rowSteps, ...colSteps];
          const queryLabel = SCENARIOS.find((s) => s.id === scenario)?.description || scenario;
          addEvent(`Starting query: ${queryLabel}`, "info");
          return {
            ...prev,
            phase: "running",
            querySteps: allSteps,
            totalSteps: allSteps.length,
            currentStepIndex: -1,
            step: prev.step + 1,
            activeQuery: queryLabel,
          };
        }
        return prev;
      }

      const nextIdx = prev.currentStepIndex + 1;
      if (nextIdx >= prev.querySteps.length) {
        addEvent(
          `Query complete. Row I/O: ${prev.rowPagesRead}, Column I/O: ${prev.colPagesRead}`,
          "compare"
        );
        return { ...prev, phase: "complete", animatingPageId: null };
      }

      const currentStep = prev.querySteps[nextIdx];
      const pageId = currentStep.pagesAccessed[0];
      const isRow = currentStep.storeType === "row";

      // Check buffer pool for cache hit
      const inCache = bufferPool.some((b) => b.pageId === pageId);

      if (inCache) {
        addEvent(`Cache HIT: ${pageId}`, "cache-hit");
        setBufferPool((bp) =>
          bp.map((b) =>
            b.pageId === pageId
              ? { ...b, hits: b.hits + 1, justLoaded: true }
              : { ...b, justLoaded: false }
          )
        );
      } else {
        const isWrite = activeScenario === "bulk-insert";
        addEvent(
          `${isWrite ? "Write" : "Read"} page: ${pageId} (${currentStep.description})`,
          isWrite ? "write" : "read"
        );
        addEvent(`Cache MISS: ${pageId} loaded into buffer pool`, "cache-miss");

        // Add to buffer pool (max 6 entries, LRU eviction)
        setBufferPool((bp) => {
          const newEntry: BufferEntry = {
            pageId,
            label: pageId,
            hits: 1,
            justLoaded: true,
          };
          const updated = bp.map((b) => ({ ...b, justLoaded: false }));
          if (updated.length >= 6) {
            updated.shift();
          }
          return [...updated, newEntry];
        });
      }

      // Highlight the accessed page
      if (isRow) {
        setRowPages((pages) =>
          pages.map((p) => ({
            ...p,
            highlighted: p.id === pageId,
            justRead: p.id === pageId,
          }))
        );
        setColPages((pages) =>
          pages.map((p) => ({ ...p, highlighted: false, justRead: false }))
        );
      } else {
        setColPages((pages) =>
          pages.map((p) => ({
            ...p,
            highlighted: p.id === pageId,
            justRead: p.id === pageId,
          }))
        );
        setRowPages((pages) =>
          pages.map((p) => ({ ...p, highlighted: false, justRead: false }))
        );
      }

      // Handle bulk insert: add new rows
      if (activeScenario === "bulk-insert" && nextIdx === 0 && isRow) {
        const newRows = NEW_ROWS.slice(0, 4);
        const updatedData = [...data, ...newRows];
        setData(updatedData);
        setRowPages(buildRowPages(updatedData));
        setColPages(buildColumnPages(updatedData));
        addEvent(`Inserted 4 new rows (ids 9-12)`, "write");
      }

      return {
        ...prev,
        currentStepIndex: nextIdx,
        step: prev.step + 1,
        rowPagesRead: prev.rowPagesRead + (isRow && !inCache ? 1 : 0),
        colPagesRead: prev.colPagesRead + (!isRow && !inCache ? 1 : 0),
        rowCacheHits: prev.rowCacheHits + (isRow && inCache ? 1 : 0),
        colCacheHits: prev.colCacheHits + (!isRow && inCache ? 1 : 0),
        animatingPageId: pageId,
      };
    });
  }, [activeScenario, data, bufferPool, addEvent]);

  /* ─── Animation loop ─── */
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
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, animationLoop]);

  /* ─── Controls ─── */
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleStep = useCallback(() => {
    stepForward();
  }, [stepForward]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    eventIdCounter = 0;
    const baseData = SAMPLE_DATA;
    setData(baseData);
    setRowPages(buildRowPages(baseData));
    setColPages(buildColumnPages(baseData));
    setBufferPool([]);
    setEvents([]);
    setSim({
      step: 0,
      totalSteps: 0,
      querySteps: [],
      currentStepIndex: -1,
      rowPagesRead: 0,
      colPagesRead: 0,
      rowCacheHits: 0,
      colCacheHits: 0,
      phase: "idle",
      activeQuery: "",
      animatingPageId: null,
      insertedRow: null,
    });
    newRowIndexRef.current = 0;
  }, []);

  /* ─── Scenario selection ─── */
  const handleScenarioSelect = useCallback(
    (scenarioId: string) => {
      handleReset();
      setActiveScenario(scenarioId);
      const scenarioObj = SCENARIOS.find((s) => s.id === scenarioId);
      if (scenarioObj) {
        setTimeout(() => {
          addEvent(`Scenario loaded: ${scenarioObj.description}`, "info");
        }, 50);
      }
    },
    [handleReset, addEvent]
  );

  /* ─── Metrics ─── */
  const metrics = useMemo(() => {
    const totalRowIO = sim.rowPagesRead;
    const totalColIO = sim.colPagesRead;
    const totalCacheHits = sim.rowCacheHits + sim.colCacheHits;
    const totalIO = totalRowIO + totalColIO;
    return {
      totalRowIO,
      totalColIO,
      totalCacheHits,
      totalIO,
      bufferSize: bufferPool.length,
      dataRows: data.length,
      phase: sim.phase,
      query: sim.activeQuery,
    };
  }, [sim, bufferPool.length, data.length]);

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */

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
                6.1
              </span>
              <div className="flex items-center gap-1.5 text-xs text-[#71717a]">
                <Database size={12} />
                <span>Database Internals</span>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Storage Engine Fundamentals
            </h1>
            <p className="mt-1.5 text-[#a1a1aa] text-sm sm:text-base max-w-2xl">
              Compare row-oriented vs column-oriented storage, page layout, I/O cost, and buffer pool caching
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
                title={s.description}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Mode selector ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#71717a] mr-1">View</span>
            {(
              [
                { id: "row-store", label: "Row Store", icon: Table },
                { id: "column-store", label: "Column Store", icon: Columns },
                { id: "read-path", label: "Read Path", icon: Search },
                { id: "write-path", label: "Write Path", icon: PenLine },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setMode(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                  mode === id
                    ? "bg-[#6366f1]/15 text-[#6366f1] border border-[#6366f1]/30"
                    : "bg-[#1e1e2e] text-[#a1a1aa] border border-transparent hover:bg-[#2a2a3e] hover:text-white"
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Controls bar ── */}
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
              {/* ── Source Table ── */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Table size={14} className="text-[#ec4899]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">
                    users Table ({data.length} rows)
                  </span>
                  {sim.activeQuery && (
                    <span className="ml-auto text-xs font-mono text-[#6366f1] bg-[#6366f1]/10 px-2 py-0.5 rounded">
                      {sim.activeQuery}
                    </span>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr>
                        {COLUMNS.map((col) => (
                          <th
                            key={col}
                            className="px-3 py-1.5 text-left text-[#71717a] uppercase tracking-wider border-b border-[#1e1e2e] font-medium"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((row, idx) => {
                        const isNew = idx >= SAMPLE_DATA.length;
                        return (
                          <motion.tr
                            key={row.id}
                            initial={isNew ? { opacity: 0, backgroundColor: "rgba(16,185,129,0.2)" } : {}}
                            animate={{ opacity: 1, backgroundColor: "transparent" }}
                            transition={{ duration: 1 }}
                            className="border-b border-[#1e1e2e]/50 hover:bg-[#ffffff04]"
                          >
                            <td className="px-3 py-1.5 text-[#a1a1aa]">{row.id}</td>
                            <td className="px-3 py-1.5 text-white">{row.name}</td>
                            <td className="px-3 py-1.5 text-[#06b6d4]">{row.age}</td>
                            <td className="px-3 py-1.5 text-[#f59e0b]">{row.city}</td>
                            <td className="px-3 py-1.5 text-[#10b981]">{row.salary.toLocaleString()}</td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </motion.div>

              {/* ── Disk Page Visualization ── */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
              >
                <div className="flex items-center gap-2 mb-4">
                  <HardDrive size={14} className="text-[#ec4899]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">
                    Disk Pages (4KB blocks)
                  </span>
                  <div className="ml-auto flex items-center gap-3 text-[10px] text-[#71717a]">
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded border-2 border-[#ec4899] bg-[#ec4899]/20" />
                      Active
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded border-2 border-[#1e1e2e] bg-[#0a0a0f]" />
                      Idle
                    </span>
                  </div>
                </div>

                {/* Row Store Pages */}
                {(mode === "row-store" || mode === "read-path" || mode === "write-path") && (
                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-2">
                      <Table size={12} className="text-[#6366f1]" />
                      <span className="text-xs font-medium text-[#6366f1]">
                        Row Store Layout
                      </span>
                      <span className="text-[10px] text-[#71717a]">
                        ({rowPages.length} pages)
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {rowPages.map((page) => (
                        <motion.div
                          key={page.id}
                          animate={{
                            borderColor: page.highlighted ? "#ec4899" : "#1e1e2e",
                            backgroundColor: page.highlighted
                              ? "rgba(236,72,153,0.08)"
                              : "#0a0a0f",
                            scale: page.justRead ? 1.02 : 1,
                          }}
                          transition={{ duration: 0.3 }}
                          className="rounded-lg border-2 p-2 min-w-[180px]"
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-mono font-bold text-[#a1a1aa]">
                              {page.label}
                            </span>
                            <span className="text-[8px] font-mono text-[#71717a]">4KB</span>
                          </div>
                          <div className="space-y-0.5">
                            {page.contents.map((content, i) => (
                              <div
                                key={i}
                                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#111118] text-[#a1a1aa] truncate"
                              >
                                {content}
                              </div>
                            ))}
                          </div>
                          {page.highlighted && (
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: "100%" }}
                              transition={{ duration: 0.5 }}
                              className="h-0.5 bg-[#ec4899] rounded-full mt-1.5"
                            />
                          )}
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Column Store Pages */}
                {(mode === "column-store" || mode === "read-path" || mode === "write-path") && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Columns size={12} className="text-[#06b6d4]" />
                      <span className="text-xs font-medium text-[#06b6d4]">
                        Column Store Layout
                      </span>
                      <span className="text-[10px] text-[#71717a]">
                        ({colPages.length} pages)
                      </span>
                    </div>
                    <div className="space-y-3">
                      {COLUMNS.map((col) => {
                        const columnPages = colPages.filter(
                          (p) => p.columnName === col
                        );
                        const colColor =
                          col === "id"
                            ? "#a1a1aa"
                            : col === "name"
                              ? "#ffffff"
                              : col === "age"
                                ? "#06b6d4"
                                : col === "city"
                                  ? "#f59e0b"
                                  : "#10b981";
                        return (
                          <div key={col}>
                            <span
                              className="text-[10px] font-mono font-bold uppercase tracking-wider mb-1 block"
                              style={{ color: colColor }}
                            >
                              {col}
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {columnPages.map((page) => (
                                <motion.div
                                  key={page.id}
                                  animate={{
                                    borderColor: page.highlighted
                                      ? "#ec4899"
                                      : "#1e1e2e",
                                    backgroundColor: page.highlighted
                                      ? "rgba(236,72,153,0.08)"
                                      : "#0a0a0f",
                                    scale: page.justRead ? 1.02 : 1,
                                  }}
                                  transition={{ duration: 0.3 }}
                                  className="rounded-lg border-2 p-2 min-w-[100px]"
                                >
                                  <div className="text-[10px] font-mono font-bold text-[#71717a] mb-1">
                                    {page.label}
                                  </div>
                                  <div className="flex flex-col gap-0.5">
                                    {page.contents.map((val, i) => (
                                      <span
                                        key={i}
                                        className="text-[9px] font-mono px-1 py-0.5 rounded bg-[#111118]"
                                        style={{ color: colColor }}
                                      >
                                        {val}
                                      </span>
                                    ))}
                                  </div>
                                  {page.highlighted && (
                                    <motion.div
                                      initial={{ width: 0 }}
                                      animate={{ width: "100%" }}
                                      transition={{ duration: 0.5 }}
                                      className="h-0.5 bg-[#ec4899] rounded-full mt-1.5"
                                    />
                                  )}
                                </motion.div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </motion.div>

              {/* ── Buffer Pool ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Layers size={14} className="text-[#f59e0b]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">
                    Buffer Pool (Cache)
                  </span>
                  <span className="text-[10px] text-[#71717a] ml-auto">
                    {bufferPool.length}/6 slots
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 min-h-[40px]">
                  <AnimatePresence mode="popLayout">
                    {bufferPool.length === 0 && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-xs text-[#71717a] italic"
                      >
                        Empty - pages will be cached here on access
                      </motion.span>
                    )}
                    {bufferPool.map((entry) => (
                      <motion.div
                        key={entry.pageId}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{
                          scale: 1,
                          opacity: 1,
                          borderColor: entry.justLoaded ? "#f59e0b" : "#1e1e2e",
                        }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border-2 bg-[#0a0a0f]"
                      >
                        <span className="text-[10px] font-mono text-[#a1a1aa]">
                          {entry.label}
                        </span>
                        {entry.hits > 1 && (
                          <span className="text-[9px] font-mono px-1 rounded bg-[#10b981]/15 text-[#10b981]">
                            {entry.hits}x
                          </span>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>

              {/* ── I/O Comparison Bar ── */}
              {(mode === "read-path" || mode === "write-path") && sim.phase !== "idle" && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 size={14} className="text-[#ec4899]" />
                    <span className="text-sm font-medium text-[#a1a1aa]">
                      I/O Cost Comparison
                    </span>
                  </div>

                  <div className="space-y-3">
                    {/* Row Store bar */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-[#6366f1]">Row Store</span>
                        <span className="text-xs font-mono text-[#6366f1]">
                          {sim.rowPagesRead} pages
                        </span>
                      </div>
                      <div className="w-full h-4 rounded-full bg-[#0a0a0f] overflow-hidden">
                        <motion.div
                          animate={{
                            width: `${Math.max(
                              4,
                              (sim.rowPagesRead / Math.max(sim.rowPagesRead + sim.colPagesRead, 1)) * 100
                            )}%`,
                          }}
                          transition={{ duration: 0.4 }}
                          className="h-full rounded-full bg-[#6366f1]"
                        />
                      </div>
                    </div>

                    {/* Column Store bar */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-[#06b6d4]">Column Store</span>
                        <span className="text-xs font-mono text-[#06b6d4]">
                          {sim.colPagesRead} pages
                        </span>
                      </div>
                      <div className="w-full h-4 rounded-full bg-[#0a0a0f] overflow-hidden">
                        <motion.div
                          animate={{
                            width: `${Math.max(
                              4,
                              (sim.colPagesRead / Math.max(sim.rowPagesRead + sim.colPagesRead, 1)) * 100
                            )}%`,
                          }}
                          transition={{ duration: 0.4 }}
                          className="h-full rounded-full bg-[#06b6d4]"
                        />
                      </div>
                    </div>

                    <div className="text-[10px] text-[#71717a] pt-1">
                      {activeScenario === "col-projection" && (
                        <span>Column store wins: reads only needed columns (name, age), skipping id/city/salary pages</span>
                      )}
                      {activeScenario === "full-scan" && (
                        <span>Full scan: both read all data, but column store reads each column separately</span>
                      )}
                      {activeScenario === "single-lookup" && (
                        <span>Single row: row store reads 1 page (all columns together). Column store reads 1 page per column.</span>
                      )}
                      {activeScenario === "bulk-insert" && (
                        <span>Write: row store appends 1 page. Column store appends to each column file separately.</span>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            {/* ── Right Column: Metrics + Event Log ── */}
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
                        <span className="text-sm font-medium text-[#a1a1aa]">
                          Metrics
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <MetricCard
                          label="Row Pages Read"
                          value={String(metrics.totalRowIO)}
                          color="#6366f1"
                        />
                        <MetricCard
                          label="Col Pages Read"
                          value={String(metrics.totalColIO)}
                          color="#06b6d4"
                        />
                        <MetricCard
                          label="Cache Hits"
                          value={String(metrics.totalCacheHits)}
                          color="#10b981"
                        />
                        <MetricCard
                          label="Total I/O"
                          value={String(metrics.totalIO)}
                          color="#f59e0b"
                        />
                        <MetricCard
                          label="Buffer Pool"
                          value={`${metrics.bufferSize}/6`}
                          color="#a1a1aa"
                        />
                        <MetricCard
                          label="Query"
                          value={
                            activeScenario === "full-scan"
                              ? "SELECT *"
                              : activeScenario === "col-projection"
                                ? "SELECT 2col"
                                : activeScenario === "single-lookup"
                                  ? "WHERE id=3"
                                  : "INSERT"
                          }
                          color="#ec4899"
                        />
                      </div>

                      {/* Progress */}
                      {sim.phase !== "idle" && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-[#71717a]">Progress</span>
                            <span className="text-[10px] font-mono text-[#71717a]">
                              {sim.currentStepIndex + 1}/{sim.totalSteps}
                            </span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-[#0a0a0f] overflow-hidden">
                            <motion.div
                              animate={{
                                width: `${((sim.currentStepIndex + 1) / Math.max(sim.totalSteps, 1)) * 100}%`,
                              }}
                              className="h-full rounded-full bg-[#ec4899]"
                            />
                          </div>
                        </div>
                      )}
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
                style={{ height: showMetrics ? "400px" : "600px" }}
              >
                <div className="flex items-center gap-2 p-3 border-b border-[#1e1e2e]">
                  <div className="w-2 h-2 rounded-full bg-[#ec4899] animate-pulse" />
                  <span className="text-sm font-medium text-[#a1a1aa]">
                    I/O Log
                  </span>
                  <span className="text-[10px] font-mono text-[#71717a] ml-auto">
                    {events.length} ops
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-0.5 scrollbar-thin">
                  {events.length === 0 && (
                    <div className="flex items-center justify-center h-full text-xs text-[#71717a]">
                      Press Play or Step to begin
                    </div>
                  )}
                  {events.map((evt) => {
                    const color =
                      evt.type === "read"
                        ? "#6366f1"
                        : evt.type === "write"
                          ? "#10b981"
                          : evt.type === "cache-hit"
                            ? "#10b981"
                            : evt.type === "cache-miss"
                              ? "#f59e0b"
                              : evt.type === "compare"
                                ? "#ec4899"
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

              {/* ── Concept Info ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.3 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Zap size={14} className="text-[#f59e0b]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">
                    Key Insight
                  </span>
                </div>
                <div className="text-xs text-[#71717a] space-y-1.5">
                  {mode === "row-store" && (
                    <>
                      <p>
                        <strong className="text-white">Row Store</strong> stores entire rows contiguously on disk pages. Great for OLTP (transactional) workloads where you frequently read/write complete rows.
                      </p>
                      <p>A single page read retrieves all columns for several rows.</p>
                    </>
                  )}
                  {mode === "column-store" && (
                    <>
                      <p>
                        <strong className="text-white">Column Store</strong> stores each column in a separate file. Great for OLAP (analytical) workloads that aggregate over few columns.
                      </p>
                      <p>Reading just 2 columns from a billion-row table only touches 2 column files.</p>
                    </>
                  )}
                  {mode === "read-path" && (
                    <>
                      <p>
                        <strong className="text-white">Read Path</strong>: The query planner determines which pages to load. Column stores skip irrelevant column files for projection queries.
                      </p>
                      <p>The buffer pool caches recently accessed pages to avoid repeated disk I/O.</p>
                    </>
                  )}
                  {mode === "write-path" && (
                    <>
                      <p>
                        <strong className="text-white">Write Path</strong>: Row stores append rows contiguously (1 page write). Column stores must write to each column file separately.
                      </p>
                      <p>Row stores have lower write amplification for transactional inserts.</p>
                    </>
                  )}
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