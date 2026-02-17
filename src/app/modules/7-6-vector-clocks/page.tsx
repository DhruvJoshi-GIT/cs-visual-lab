"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Network,
  Activity,
  Zap,
  Send,
  Clock,
  ArrowRight,
  GitBranch,
  Waypoints,
  MessageSquare,
  CircleDot,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

/* ═══════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════ */

type ProcessId = "A" | "B" | "C";

type VectorClock = [number, number, number]; // [A, B, C]

interface ProcessEvent {
  id: string;
  processId: ProcessId;
  type: "internal" | "send" | "receive";
  vectorClock: VectorClock;
  timestamp: number; // logical position on timeline
  linkedMessageId?: string;
  linkedFrom?: ProcessId;
  linkedTo?: ProcessId;
}

interface InFlightMessage {
  id: string;
  from: ProcessId;
  to: ProcessId;
  vectorClock: VectorClock;
  sendEventId: string;
  progress: number; // 0 to 1 animation
  sendTimestamp: number;
}

interface EventLogEntry {
  id: number;
  message: string;
  type: "internal" | "send" | "receive" | "concurrent" | "causal" | "info";
}

interface ConcurrentPair {
  eventA: string;
  eventB: string;
}

interface SimulationState {
  phase: "idle" | "running" | "complete";
  step: number;
  autoActions: AutoAction[];
  autoIndex: number;
}

type AutoAction =
  | { type: "internal"; process: ProcessId }
  | { type: "send"; from: ProcessId; to: ProcessId }
  | { type: "deliver"; messageId?: string };

const PROCESS_IDS: ProcessId[] = ["A", "B", "C"];
const PROCESS_COLORS: Record<ProcessId, string> = {
  A: "#6366f1",
  B: "#06b6d4",
  C: "#10b981",
};

const SCENARIOS = [
  { id: "simple", label: "Simple Send/Receive", description: "Basic message passing between two processes" },
  { id: "concurrent", label: "Concurrent Events", description: "Two processes act independently" },
  { id: "causal-chain", label: "Causal Chain", description: "Chain of causally related events" },
  { id: "three-way", label: "Three-Way Communication", description: "All three processes exchange messages" },
];

const DOMAIN_COLOR = "#ef4444";

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */

let globalEventId = 0;
let globalMsgId = 0;
let globalLogId = 0;

function processIndex(pid: ProcessId): number {
  return PROCESS_IDS.indexOf(pid);
}

function cloneVC(vc: VectorClock): VectorClock {
  return [vc[0], vc[1], vc[2]];
}

function incrementVC(vc: VectorClock, pid: ProcessId): VectorClock {
  const newVC = cloneVC(vc);
  newVC[processIndex(pid)]++;
  return newVC;
}

function mergeVC(local: VectorClock, received: VectorClock): VectorClock {
  return [
    Math.max(local[0], received[0]),
    Math.max(local[1], received[1]),
    Math.max(local[2], received[2]),
  ];
}

function vcToString(vc: VectorClock): string {
  return `[${vc[0]}, ${vc[1]}, ${vc[2]}]`;
}

function happensBefore(a: VectorClock, b: VectorClock): boolean {
  let atLeastOneLess = false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return false;
    if (a[i] < b[i]) atLeastOneLess = true;
  }
  return atLeastOneLess;
}

function areConcurrent(a: VectorClock, b: VectorClock): boolean {
  return !happensBefore(a, b) && !happensBefore(b, a) && !(a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function VectorClocksPage() {
  /* ─── Core state ─── */
  const [processClocks, setProcessClocks] = useState<Record<ProcessId, VectorClock>>({
    A: [0, 0, 0],
    B: [0, 0, 0],
    C: [0, 0, 0],
  });
  const [processEvents, setProcessEvents] = useState<Record<ProcessId, ProcessEvent[]>>({
    A: [],
    B: [],
    C: [],
  });
  const [inFlightMessages, setInFlightMessages] = useState<InFlightMessage[]>([]);
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [allEvents, setAllEvents] = useState<ProcessEvent[]>([]);
  const [activeScenario, setActiveScenario] = useState("simple");
  const [sim, setSim] = useState<SimulationState>({
    phase: "idle",
    step: 0,
    autoActions: [],
    autoIndex: 0,
  });
  const [processTimestamps, setProcessTimestamps] = useState<Record<ProcessId, number>>({
    A: 0,
    B: 0,
    C: 0,
  });

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
  const processClocksRef = useRef(processClocks);
  const processEventsRef = useRef(processEvents);
  const inFlightRef = useRef(inFlightMessages);
  const simRef = useRef(sim);
  const processTimestampsRef = useRef(processTimestamps);
  const allEventsRef = useRef(allEvents);

  processClocksRef.current = processClocks;
  processEventsRef.current = processEvents;
  inFlightRef.current = inFlightMessages;
  simRef.current = sim;
  processTimestampsRef.current = processTimestamps;
  allEventsRef.current = allEvents;

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { eventsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [events.length]);

  /* ─── Add log event ─── */
  const addLog = useCallback((message: string, type: EventLogEntry["type"]) => {
    setEvents((prev) => [...prev, { id: ++globalLogId, message, type }].slice(-200));
  }, []);

  /* ─── Internal event ─── */
  const doInternalEvent = useCallback((pid: ProcessId) => {
    const currentClock = processClocksRef.current[pid];
    const newClock = incrementVC(currentClock, pid);
    const ts = processTimestampsRef.current[pid] + 1;

    const evt: ProcessEvent = {
      id: `evt-${++globalEventId}`,
      processId: pid,
      type: "internal",
      vectorClock: cloneVC(newClock),
      timestamp: ts,
    };

    setProcessClocks((prev) => ({ ...prev, [pid]: newClock }));
    setProcessTimestamps((prev) => ({ ...prev, [pid]: ts }));
    setProcessEvents((prev) => ({
      ...prev,
      [pid]: [...prev[pid], evt],
    }));
    setAllEvents((prev) => [...prev, evt]);
    addLog(`Process ${pid}: internal event -> ${vcToString(newClock)}`, "internal");
  }, [addLog]);

  /* ─── Send message ─── */
  const doSendMessage = useCallback((from: ProcessId, to: ProcessId) => {
    const currentClock = processClocksRef.current[from];
    const newClock = incrementVC(currentClock, from);
    const ts = processTimestampsRef.current[from] + 1;

    const msgId = `msg-${++globalMsgId}`;
    const evt: ProcessEvent = {
      id: `evt-${++globalEventId}`,
      processId: from,
      type: "send",
      vectorClock: cloneVC(newClock),
      timestamp: ts,
      linkedMessageId: msgId,
      linkedTo: to,
    };

    const msg: InFlightMessage = {
      id: msgId,
      from,
      to,
      vectorClock: cloneVC(newClock),
      sendEventId: evt.id,
      progress: 0,
      sendTimestamp: ts,
    };

    setProcessClocks((prev) => ({ ...prev, [from]: newClock }));
    setProcessTimestamps((prev) => ({ ...prev, [from]: ts }));
    setProcessEvents((prev) => ({
      ...prev,
      [from]: [...prev[from], evt],
    }));
    setAllEvents((prev) => [...prev, evt]);
    setInFlightMessages((prev) => [...prev, msg]);
    addLog(`Process ${from} -> ${to}: send message ${vcToString(newClock)}`, "send");
  }, [addLog]);

  /* ─── Deliver message ─── */
  const deliverMessage = useCallback((messageId?: string) => {
    const msgs = inFlightRef.current;
    if (msgs.length === 0) return;

    const msg = messageId ? msgs.find((m) => m.id === messageId) : msgs[0];
    if (!msg) return;

    const currentClock = processClocksRef.current[msg.to];
    const merged = mergeVC(currentClock, msg.vectorClock);
    const newClock = incrementVC(merged, msg.to);
    const ts = processTimestampsRef.current[msg.to] + 1;

    const evt: ProcessEvent = {
      id: `evt-${++globalEventId}`,
      processId: msg.to,
      type: "receive",
      vectorClock: cloneVC(newClock),
      timestamp: ts,
      linkedMessageId: msg.id,
      linkedFrom: msg.from,
    };

    setProcessClocks((prev) => ({ ...prev, [msg.to]: newClock }));
    setProcessTimestamps((prev) => ({ ...prev, [msg.to]: ts }));
    setProcessEvents((prev) => ({
      ...prev,
      [msg.to]: [...prev[msg.to], evt],
    }));
    setAllEvents((prev) => [...prev, evt]);
    setInFlightMessages((prev) => prev.filter((m) => m.id !== msg.id));
    addLog(
      `Process ${msg.to}: receive from ${msg.from}, merge ${vcToString(currentClock)} with ${vcToString(msg.vectorClock)} -> ${vcToString(newClock)}`,
      "receive"
    );
  }, [addLog]);

  /* ─── Advance in-flight messages ─── */
  const advanceMessages = useCallback(() => {
    setInFlightMessages((prev) =>
      prev.map((m) => ({
        ...m,
        progress: Math.min(1, m.progress + 0.25),
      }))
    );
  }, []);

  /* ─── Step forward ─── */
  const stepForward = useCallback(() => {
    const currentSim = simRef.current;

    if (currentSim.phase === "idle") {
      let actions: AutoAction[] = [];
      switch (activeScenario) {
        case "simple":
          actions = [
            { type: "internal", process: "A" },
            { type: "send", from: "A", to: "B" },
            { type: "deliver" },
            { type: "internal", process: "B" },
            { type: "send", from: "B", to: "A" },
            { type: "deliver" },
            { type: "internal", process: "A" },
          ];
          break;
        case "concurrent":
          actions = [
            { type: "internal", process: "A" },
            { type: "internal", process: "B" },
            { type: "internal", process: "C" },
            { type: "internal", process: "A" },
            { type: "internal", process: "B" },
            { type: "send", from: "A", to: "C" },
            { type: "send", from: "B", to: "C" },
            { type: "deliver" },
            { type: "deliver" },
            { type: "internal", process: "C" },
          ];
          break;
        case "causal-chain":
          actions = [
            { type: "internal", process: "A" },
            { type: "send", from: "A", to: "B" },
            { type: "deliver" },
            { type: "internal", process: "B" },
            { type: "send", from: "B", to: "C" },
            { type: "deliver" },
            { type: "internal", process: "C" },
            { type: "send", from: "C", to: "A" },
            { type: "deliver" },
            { type: "internal", process: "A" },
          ];
          break;
        case "three-way":
          actions = [
            { type: "internal", process: "A" },
            { type: "internal", process: "B" },
            { type: "internal", process: "C" },
            { type: "send", from: "A", to: "B" },
            { type: "send", from: "B", to: "C" },
            { type: "send", from: "C", to: "A" },
            { type: "deliver" },
            { type: "deliver" },
            { type: "deliver" },
            { type: "internal", process: "A" },
            { type: "internal", process: "B" },
            { type: "internal", process: "C" },
            { type: "send", from: "A", to: "C" },
            { type: "send", from: "C", to: "B" },
            { type: "deliver" },
            { type: "deliver" },
          ];
          break;
      }
      setSim({
        phase: "running",
        step: 0,
        autoActions: actions,
        autoIndex: 0,
      });
      addLog(`Scenario: ${SCENARIOS.find((s) => s.id === activeScenario)?.label}`, "info");
      return;
    }

    if (currentSim.phase === "complete") return;

    // Advance in-flight messages
    advanceMessages();

    const idx = currentSim.autoIndex;
    if (idx >= currentSim.autoActions.length) {
      setSim((prev) => ({ ...prev, phase: "complete" }));
      setIsPlaying(false);
      return;
    }

    const action = currentSim.autoActions[idx];
    switch (action.type) {
      case "internal":
        doInternalEvent(action.process);
        break;
      case "send":
        doSendMessage(action.from, action.to);
        break;
      case "deliver":
        deliverMessage(action.messageId);
        break;
    }

    setSim((prev) => ({ ...prev, autoIndex: prev.autoIndex + 1, step: prev.step + 1 }));
  }, [activeScenario, doInternalEvent, doSendMessage, deliverMessage, advanceMessages, addLog]);

  /* ─── Animation loop ─── */
  const animationLoop = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) return;
    const interval = Math.max(10, 800 / speedRef.current);
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
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleStep = useCallback(() => stepForward(), [stepForward]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    globalEventId = 0;
    globalMsgId = 0;
    globalLogId = 0;
    setProcessClocks({ A: [0, 0, 0], B: [0, 0, 0], C: [0, 0, 0] });
    setProcessEvents({ A: [], B: [], C: [] });
    setInFlightMessages([]);
    setEvents([]);
    setAllEvents([]);
    setProcessTimestamps({ A: 0, B: 0, C: 0 });
    setSim({ phase: "idle", step: 0, autoActions: [], autoIndex: 0 });
  }, []);

  const handleScenarioSelect = useCallback((id: string) => {
    handleReset();
    setActiveScenario(id);
  }, [handleReset]);

  /* ─── Computed metrics ─── */
  const metrics = useMemo(() => {
    const totalEvents = allEvents.length;
    const totalMessages = allEvents.filter((e) => e.type === "send").length;

    // Find concurrent pairs
    const concurrentPairs: ConcurrentPair[] = [];
    const causalPairs: { from: string; to: string }[] = [];

    for (let i = 0; i < allEvents.length; i++) {
      for (let j = i + 1; j < allEvents.length; j++) {
        const a = allEvents[i];
        const b = allEvents[j];
        if (a.processId === b.processId) continue;
        if (areConcurrent(a.vectorClock, b.vectorClock)) {
          concurrentPairs.push({ eventA: a.id, eventB: b.id });
        } else if (happensBefore(a.vectorClock, b.vectorClock)) {
          causalPairs.push({ from: a.id, to: b.id });
        } else if (happensBefore(b.vectorClock, a.vectorClock)) {
          causalPairs.push({ from: b.id, to: a.id });
        }
      }
    }

    return {
      totalEvents,
      totalMessages,
      concurrentPairs: concurrentPairs.length,
      causalOrderings: causalPairs.length,
      clockA: processClocks.A,
      clockB: processClocks.B,
      clockC: processClocks.C,
    };
  }, [allEvents, processClocks]);

  /* ─── Timeline SVG layout ─── */
  const svgWidth = 700;
  const svgHeight = 340;
  const timelineY: Record<ProcessId, number> = { A: 70, B: 170, C: 270 };
  const timelineStartX = 80;
  const timelineEndX = svgWidth - 30;
  const maxTimestamp = Math.max(
    ...PROCESS_IDS.map((pid) => processTimestamps[pid]),
    6
  );
  const xScale = (ts: number) =>
    timelineStartX + ((ts) / (maxTimestamp + 1)) * (timelineEndX - timelineStartX);

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
                7.6
              </span>
              <div className="flex items-center gap-1.5 text-xs text-[#71717a]">
                <Network size={12} />
                <span>Distributed Systems</span>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Vector Clocks
            </h1>
            <p className="mt-1.5 text-[#a1a1aa] text-sm sm:text-base max-w-2xl">
              Track causality in distributed systems with vector timestamps, message passing, and concurrency detection
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
                    ? "bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/30"
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
              {/* ── Manual controls ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="flex items-center gap-2 flex-wrap"
              >
                {PROCESS_IDS.map((pid) => (
                  <button
                    key={`int-${pid}`}
                    onClick={() => doInternalEvent(pid)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{
                      backgroundColor: `${PROCESS_COLORS[pid]}15`,
                      borderWidth: 1,
                      borderColor: `${PROCESS_COLORS[pid]}30`,
                      color: PROCESS_COLORS[pid],
                    }}
                  >
                    <CircleDot size={12} />
                    {pid} Event
                  </button>
                ))}
                <div className="w-px h-6 bg-[#1e1e2e] mx-1" />
                {(
                  [
                    ["A", "B"],
                    ["B", "C"],
                    ["C", "A"],
                    ["A", "C"],
                    ["B", "A"],
                    ["C", "B"],
                  ] as [ProcessId, ProcessId][]
                ).map(([from, to]) => (
                  <button
                    key={`send-${from}-${to}`}
                    onClick={() => doSendMessage(from, to)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#1e1e2e] text-[#a1a1aa] hover:bg-[#2a2a3e] hover:text-white transition-all"
                  >
                    <span style={{ color: PROCESS_COLORS[from] }}>{from}</span>
                    <ArrowRight size={10} />
                    <span style={{ color: PROCESS_COLORS[to] }}>{to}</span>
                  </button>
                ))}
                {inFlightMessages.length > 0 && (
                  <button
                    onClick={() => deliverMessage()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#f59e0b]/15 border border-[#f59e0b]/30 text-[#f59e0b] hover:bg-[#f59e0b]/25 transition-all"
                  >
                    <Send size={12} />
                    Deliver ({inFlightMessages.length})
                  </button>
                )}
              </motion.div>

              {/* ── Timeline Visualization ── */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden"
              >
                <svg
                  viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                  className="w-full"
                  style={{ minHeight: "300px" }}
                >
                  <defs>
                    <filter id="vc-glow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                      <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <marker id="arrow-msg" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" opacity="0.8" />
                    </marker>
                  </defs>

                  {/* Background grid */}
                  <pattern id="vc-grid" width="30" height="30" patternUnits="userSpaceOnUse">
                    <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e1e2e" strokeWidth="0.5" opacity="0.3" />
                  </pattern>
                  <rect width="100%" height="100%" fill="url(#vc-grid)" />

                  {/* Process timelines */}
                  {PROCESS_IDS.map((pid) => {
                    const y = timelineY[pid];
                    const color = PROCESS_COLORS[pid];
                    return (
                      <g key={pid}>
                        {/* Timeline label */}
                        <text
                          x={20}
                          y={y + 5}
                          textAnchor="middle"
                          fill={color}
                          fontSize="14"
                          fontWeight="700"
                          fontFamily="monospace"
                        >
                          {pid}
                        </text>
                        {/* Current vector clock */}
                        <text
                          x={50}
                          y={y + 4}
                          textAnchor="start"
                          fill={color}
                          fontSize="8"
                          fontFamily="monospace"
                          opacity="0.6"
                        >
                          {vcToString(processClocks[pid])}
                        </text>

                        {/* Timeline line */}
                        <line
                          x1={timelineStartX}
                          y1={y}
                          x2={timelineEndX}
                          y2={y}
                          stroke={color}
                          strokeWidth="2"
                          opacity="0.3"
                        />
                        {/* Timeline arrow */}
                        <polygon
                          points={`${timelineEndX},${y - 4} ${timelineEndX + 8},${y} ${timelineEndX},${y + 4}`}
                          fill={color}
                          opacity="0.3"
                        />
                      </g>
                    );
                  })}

                  {/* Message arrows between timelines */}
                  {allEvents
                    .filter((e) => e.type === "send" && e.linkedTo)
                    .map((sendEvt) => {
                      const receiveEvt = allEvents.find(
                        (e) =>
                          e.type === "receive" &&
                          e.linkedMessageId === sendEvt.linkedMessageId
                      );
                      if (!receiveEvt) return null;

                      const x1 = xScale(sendEvt.timestamp);
                      const y1 = timelineY[sendEvt.processId];
                      const x2 = xScale(receiveEvt.timestamp);
                      const y2 = timelineY[receiveEvt.processId];

                      return (
                        <motion.line
                          key={`arrow-${sendEvt.id}`}
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke="#f59e0b"
                          strokeWidth="1.5"
                          strokeDasharray="4 3"
                          opacity="0.5"
                          markerEnd="url(#arrow-msg)"
                          initial={{ pathLength: 0, opacity: 0 }}
                          animate={{ pathLength: 1, opacity: 0.5 }}
                          transition={{ duration: 0.5 }}
                        />
                      );
                    })}

                  {/* In-flight message animations */}
                  <AnimatePresence>
                    {inFlightMessages.map((msg) => {
                      const fromY = timelineY[msg.from];
                      const toY = timelineY[msg.to];
                      const fromX = xScale(msg.sendTimestamp);
                      const currentX = fromX + 30 * msg.progress;
                      const currentY = fromY + (toY - fromY) * msg.progress;

                      return (
                        <motion.g
                          key={msg.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                        >
                          <circle cx={currentX} cy={currentY} r={5} fill="#f59e0b" opacity={0.8} />
                          <circle cx={currentX} cy={currentY} r={3} fill="white" opacity={0.3} />
                          <text
                            x={currentX + 8}
                            y={currentY + 3}
                            fill="#f59e0b"
                            fontSize="7"
                            fontFamily="monospace"
                            opacity="0.8"
                          >
                            {vcToString(msg.vectorClock)}
                          </text>
                        </motion.g>
                      );
                    })}
                  </AnimatePresence>

                  {/* Events on timelines */}
                  {PROCESS_IDS.map((pid) =>
                    processEvents[pid].map((evt) => {
                      const x = xScale(evt.timestamp);
                      const y = timelineY[pid];
                      const color = PROCESS_COLORS[pid];
                      const isInternal = evt.type === "internal";
                      const isSend = evt.type === "send";
                      const isReceive = evt.type === "receive";

                      return (
                        <motion.g
                          key={evt.id}
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.3, type: "spring" }}
                        >
                          {/* Event circle */}
                          <circle
                            cx={x}
                            cy={y}
                            r={isInternal ? 6 : 8}
                            fill={isInternal ? color : isSend ? color : "#f59e0b"}
                            opacity={0.9}
                            filter="url(#vc-glow)"
                          />
                          <circle
                            cx={x}
                            cy={y}
                            r={isInternal ? 3 : 4}
                            fill="white"
                            opacity={0.3}
                          />

                          {/* Send/receive indicator */}
                          {isSend && (
                            <text x={x} y={y + 3} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">
                              S
                            </text>
                          )}
                          {isReceive && (
                            <text x={x} y={y + 3} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">
                              R
                            </text>
                          )}

                          {/* Vector clock label */}
                          <text
                            x={x}
                            y={y - 14}
                            textAnchor="middle"
                            fill={color}
                            fontSize="8"
                            fontFamily="monospace"
                            fontWeight="600"
                          >
                            {vcToString(evt.vectorClock)}
                          </text>
                        </motion.g>
                      );
                    })
                  )}

                  {/* Legend */}
                  <g transform="translate(100, 320)">
                    <circle cx={0} cy={0} r={4} fill="#6366f1" />
                    <text x={8} y={3} fill="#71717a" fontSize="8" fontFamily="sans-serif">Internal</text>
                    <circle cx={60} cy={0} r={4} fill="#6366f1" />
                    <text x={64} y={0} textAnchor="middle" fill="white" fontSize="5" fontWeight="bold">S</text>
                    <text x={70} y={3} fill="#71717a" fontSize="8" fontFamily="sans-serif">Send</text>
                    <circle cx={110} cy={0} r={4} fill="#f59e0b" />
                    <text x={114} y={0} textAnchor="middle" fill="white" fontSize="5" fontWeight="bold">R</text>
                    <text x={120} y={3} fill="#71717a" fontSize="8" fontFamily="sans-serif">Receive</text>
                    <line x1={166} y1={0} x2={186} y2={0} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.6" />
                    <text x={192} y={3} fill="#71717a" fontSize="8" fontFamily="sans-serif">Message</text>
                  </g>
                </svg>
              </motion.div>

              {/* ── Causality Analysis ── */}
              {allEvents.length >= 2 && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.15 }}
                  className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <GitBranch size={14} className="text-[#ec4899]" />
                    <span className="text-sm font-medium text-[#a1a1aa]">
                      Causality Analysis
                    </span>
                  </div>

                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {(() => {
                      const pairs: { a: ProcessEvent; b: ProcessEvent; relation: string; color: string }[] = [];
                      for (let i = 0; i < allEvents.length && pairs.length < 20; i++) {
                        for (let j = i + 1; j < allEvents.length && pairs.length < 20; j++) {
                          const a = allEvents[i];
                          const b = allEvents[j];
                          if (a.processId === b.processId) continue;
                          if (areConcurrent(a.vectorClock, b.vectorClock)) {
                            pairs.push({ a, b, relation: "concurrent", color: "#f59e0b" });
                          } else if (happensBefore(a.vectorClock, b.vectorClock)) {
                            pairs.push({ a, b, relation: "happens-before", color: "#10b981" });
                          } else if (happensBefore(b.vectorClock, a.vectorClock)) {
                            pairs.push({ a: b, b: a, relation: "happens-before", color: "#10b981" });
                          }
                        }
                      }
                      return pairs.map((p, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 text-[10px] font-mono px-2 py-1 rounded bg-[#0a0a0f]"
                        >
                          <span style={{ color: PROCESS_COLORS[p.a.processId] }}>
                            {p.a.processId}:{vcToString(p.a.vectorClock)}
                          </span>
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                            style={{
                              color: p.color,
                              backgroundColor: `${p.color}15`,
                            }}
                          >
                            {p.relation === "concurrent" ? "||" : "->"}
                          </span>
                          <span style={{ color: PROCESS_COLORS[p.b.processId] }}>
                            {p.b.processId}:{vcToString(p.b.vectorClock)}
                          </span>
                        </div>
                      ));
                    })()}
                  </div>
                </motion.div>
              )}

              {/* ── Current Vector Clocks ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Clock size={14} className="text-[#6366f1]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">
                    Current Vector Clocks
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {PROCESS_IDS.map((pid) => (
                    <div
                      key={pid}
                      className="rounded-lg border p-3 text-center"
                      style={{
                        borderColor: `${PROCESS_COLORS[pid]}30`,
                        backgroundColor: `${PROCESS_COLORS[pid]}08`,
                      }}
                    >
                      <div
                        className="text-lg font-bold font-mono mb-1"
                        style={{ color: PROCESS_COLORS[pid] }}
                      >
                        {pid}
                      </div>
                      <div className="text-sm font-mono text-[#a1a1aa]">
                        {vcToString(processClocks[pid])}
                      </div>
                      <div className="text-[9px] text-[#71717a] mt-1">
                        {processEvents[pid].length} events
                      </div>
                    </div>
                  ))}
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
                        <Activity size={14} className="text-[#ef4444]" />
                        <span className="text-sm font-medium text-[#a1a1aa]">Metrics</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <MetricCard label="Total Events" value={String(metrics.totalEvents)} color="#6366f1" />
                        <MetricCard label="Messages" value={String(metrics.totalMessages)} color="#f59e0b" />
                        <MetricCard label="Concurrent" value={String(metrics.concurrentPairs)} color="#ef4444" />
                        <MetricCard label="Causal" value={String(metrics.causalOrderings)} color="#10b981" />
                      </div>

                      {/* Process event counts */}
                      <div className="space-y-1 pt-1">
                        {PROCESS_IDS.map((pid) => (
                          <div key={pid} className="flex items-center gap-2">
                            <span
                              className="text-[9px] font-mono font-bold w-4"
                              style={{ color: PROCESS_COLORS[pid] }}
                            >
                              {pid}
                            </span>
                            <div className="flex-1 h-1.5 rounded-full bg-[#0a0a0f] overflow-hidden">
                              <motion.div
                                animate={{
                                  width: `${(processEvents[pid].length / Math.max(metrics.totalEvents, 1)) * 100}%`,
                                }}
                                className="h-full rounded-full"
                                style={{ backgroundColor: PROCESS_COLORS[pid] }}
                              />
                            </div>
                            <span className="text-[9px] font-mono text-[#71717a]">
                              {processEvents[pid].length}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Chronological Event Table ── */}
              {allEvents.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.24 }}
                  className="rounded-xl border border-[#1e1e2e] bg-[#111118] flex flex-col"
                  style={{ maxHeight: "220px" }}
                >
                  <div className="flex items-center gap-2 p-3 border-b border-[#1e1e2e]">
                    <Clock size={14} className="text-[#06b6d4]" />
                    <span className="text-sm font-medium text-[#a1a1aa]">
                      All Events (Chronological)
                    </span>
                    <span className="text-[10px] font-mono text-[#71717a] ml-auto">
                      {allEvents.length} total
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2">
                    <table className="w-full text-[10px] font-mono">
                      <thead>
                        <tr className="text-[#71717a]">
                          <th className="text-left px-2 py-1">#</th>
                          <th className="text-left px-2 py-1">Process</th>
                          <th className="text-left px-2 py-1">Type</th>
                          <th className="text-left px-2 py-1">Vector Clock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allEvents.map((evt, idx) => {
                          const typeLabel =
                            evt.type === "internal"
                              ? "internal"
                              : evt.type === "send"
                                ? `send -> ${evt.linkedTo}`
                                : `recv <- ${evt.linkedFrom}`;
                          const typeColor =
                            evt.type === "internal"
                              ? "#71717a"
                              : evt.type === "send"
                                ? "#f59e0b"
                                : "#10b981";
                          return (
                            <motion.tr
                              key={evt.id}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="border-b border-[#1e1e2e]/30 hover:bg-[#ffffff04]"
                            >
                              <td className="px-2 py-1 text-[#71717a]">{idx + 1}</td>
                              <td
                                className="px-2 py-1 font-bold"
                                style={{ color: PROCESS_COLORS[evt.processId] }}
                              >
                                {evt.processId}
                              </td>
                              <td className="px-2 py-1" style={{ color: typeColor }}>
                                {typeLabel}
                              </td>
                              <td className="px-2 py-1 text-[#a1a1aa]">
                                {vcToString(evt.vectorClock)}
                              </td>
                            </motion.tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}

              {/* ── In-Flight Messages ── */}
              {inFlightMessages.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="rounded-xl border border-[#f59e0b]/20 bg-[#f59e0b]/5 p-3"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare size={12} className="text-[#f59e0b]" />
                    <span className="text-xs font-medium text-[#f59e0b]">
                      In-Flight Messages ({inFlightMessages.length})
                    </span>
                  </div>
                  <div className="space-y-1">
                    {inFlightMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className="flex items-center gap-2 text-[10px] font-mono"
                      >
                        <span style={{ color: PROCESS_COLORS[msg.from] }}>{msg.from}</span>
                        <ArrowRight size={10} className="text-[#f59e0b]" />
                        <span style={{ color: PROCESS_COLORS[msg.to] }}>{msg.to}</span>
                        <span className="text-[#71717a] ml-1">
                          carrying {vcToString(msg.vectorClock)}
                        </span>
                        <button
                          onClick={() => deliverMessage(msg.id)}
                          className="ml-auto px-1.5 py-0.5 rounded text-[9px] bg-[#f59e0b]/20 text-[#f59e0b] hover:bg-[#f59e0b]/30 transition-all"
                        >
                          deliver
                        </button>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* ── Event Log ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.25 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] flex flex-col"
                style={{ height: showMetrics ? "340px" : "540px" }}
              >
                <div className="flex items-center gap-2 p-3 border-b border-[#1e1e2e]">
                  <div className="w-2 h-2 rounded-full bg-[#ef4444] animate-pulse" />
                  <span className="text-sm font-medium text-[#a1a1aa]">Event Log</span>
                  <span className="text-[10px] font-mono text-[#71717a] ml-auto">{events.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-0.5 scrollbar-thin">
                  {events.length === 0 && (
                    <div className="flex items-center justify-center h-full text-xs text-[#71717a]">
                      Press Play or use manual controls
                    </div>
                  )}
                  {events.map((evt) => {
                    const color =
                      evt.type === "internal" ? "#6366f1"
                        : evt.type === "send" ? "#f59e0b"
                          : evt.type === "receive" ? "#10b981"
                            : evt.type === "concurrent" ? "#ef4444"
                              : evt.type === "causal" ? "#06b6d4"
                                : "#a1a1aa";
                    return (
                      <motion.div
                        key={evt.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.15 }}
                        className="flex items-start gap-2 px-2 py-1 rounded hover:bg-[#ffffff04]"
                      >
                        <div className="w-1 h-1 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: color }} />
                        <span className="text-[11px] font-mono leading-snug break-all" style={{ color }}>
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
                  <Waypoints size={14} className="text-[#f59e0b]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">
                    How Vector Clocks Work
                  </span>
                </div>
                <div className="text-xs text-[#71717a] space-y-1.5">
                  <p>
                    <strong className="text-[#6366f1]">Internal event:</strong> Process increments its own entry in the vector clock. For process B with clock [1, 2, 0], an internal event yields [1, 3, 0].
                  </p>
                  <p>
                    <strong className="text-[#f59e0b]">Send:</strong> Increment own entry, then attach the updated vector clock to the outgoing message.
                  </p>
                  <p>
                    <strong className="text-[#10b981]">Receive:</strong> Take element-wise max of the local clock and the received clock, then increment own entry. This captures causal knowledge from the sender.
                  </p>
                  <p>
                    <strong className="text-[#ef4444]">Concurrent (||):</strong> Events where neither happens-before the other. Example: A:[2,0,0] and B:[0,1,0] are concurrent because neither dominates.
                  </p>
                  <p>
                    <strong className="text-white">Happens-before (→):</strong> VC(a) &lt; VC(b) means a causally precedes b. Every entry in a&apos;s clock is &le; the corresponding entry in b&apos;s clock, with at least one strictly less.
                  </p>
                  <p>
                    <strong className="text-[#06b6d4]">Comparison rules:</strong> If VC(a) &lt; VC(b), a happened before b. If VC(b) &lt; VC(a), b happened before a. Otherwise, a and b are concurrent.
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