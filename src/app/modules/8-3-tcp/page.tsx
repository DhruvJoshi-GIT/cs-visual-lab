"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Network,
  Activity,
  Zap,
  AlertTriangle,
  TrendingUp,
  Timer,
  BarChart3,
  ChevronRight,
  Layers,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

/* ═══════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════ */

type TCPMode = "sliding-window" | "slow-start" | "congestion-avoidance" | "fast-retransmit";
type SegmentStatus = "unsent" | "sent-unacked" | "sent-acked" | "outside-window" | "lost" | "retransmitted";
type ScenarioName = "normal-transfer" | "packet-loss" | "slow-start-growth" | "congestion-event";

interface Segment {
  seq: number;
  status: SegmentStatus;
}

interface InFlightPacket {
  id: string;
  seq: number;
  isAck: boolean;
  progress: number;
  lost: boolean;
}

interface CwndHistoryPoint {
  tick: number;
  cwnd: number;
  ssthresh: number;
  event?: string;
}

interface TCPState {
  segments: Segment[];
  windowStart: number;
  windowSize: number;
  cwnd: number;
  ssthresh: number;
  nextSeqToSend: number;
  lastAcked: number;
  dupAckCount: number;
  rtt: number;
  tick: number;
  inFlight: InFlightPacket[];
  cwndHistory: CwndHistoryPoint[];
  segmentsSent: number;
  segmentsAcked: number;
  segmentsRetransmitted: number;
  lossSeq: number;
  phase: "sending" | "waiting" | "acking" | "retransmitting" | "done";
}

const TOTAL_SEGMENTS = 32;
const VISIBLE_SEGMENTS = 20;
const INITIAL_CWND = 1;
const INITIAL_SSTHRESH = 16;

const STATUS_COLORS: Record<SegmentStatus, { bg: string; border: string; text: string }> = {
  "unsent": { bg: "#1e1e2e", border: "#2a2a3e", text: "#71717a" },
  "sent-unacked": { bg: "#f59e0b20", border: "#f59e0b", text: "#f59e0b" },
  "sent-acked": { bg: "#10b98120", border: "#10b981", text: "#10b981" },
  "outside-window": { bg: "#0a0a0f", border: "#1e1e2e", text: "#3a3a4e" },
  "lost": { bg: "#ef444420", border: "#ef4444", text: "#ef4444" },
  "retransmitted": { bg: "#6366f120", border: "#6366f1", text: "#6366f1" },
};

const MODES: { key: TCPMode; label: string; description: string }[] = [
  { key: "sliding-window", label: "Sliding Window", description: "Window-based flow control" },
  { key: "slow-start", label: "Slow Start", description: "Exponential cwnd growth" },
  { key: "congestion-avoidance", label: "Congestion Avoidance", description: "Linear cwnd increase" },
  { key: "fast-retransmit", label: "Fast Retransmit", description: "Triple dup ACK recovery" },
];

const SCENARIOS: { key: ScenarioName; label: string; icon: React.ReactNode }[] = [
  { key: "normal-transfer", label: "Normal Transfer", icon: <ArrowRight size={13} /> },
  { key: "packet-loss", label: "Packet Loss", icon: <AlertTriangle size={13} /> },
  { key: "slow-start-growth", label: "Slow Start Growth", icon: <TrendingUp size={13} /> },
  { key: "congestion-event", label: "Congestion Event", icon: <Zap size={13} /> },
];

let packetIdCounter = 0;
function nextPacketId(): string {
  return `pkt-${++packetIdCounter}`;
}

function createInitialState(mode: TCPMode): TCPState {
  const segments: Segment[] = Array.from({ length: TOTAL_SEGMENTS }, (_, i) => ({
    seq: i + 1,
    status: "unsent" as SegmentStatus,
  }));

  const initialCwnd = mode === "slow-start" || mode === "fast-retransmit" ? INITIAL_CWND :
    mode === "congestion-avoidance" ? INITIAL_SSTHRESH : 4;
  const initialSsthresh = mode === "congestion-avoidance" ? INITIAL_SSTHRESH : INITIAL_SSTHRESH;

  return {
    segments,
    windowStart: 0,
    windowSize: mode === "sliding-window" ? 4 : initialCwnd,
    cwnd: initialCwnd,
    ssthresh: initialSsthresh,
    nextSeqToSend: 0,
    lastAcked: -1,
    dupAckCount: 0,
    rtt: 4,
    tick: 0,
    inFlight: [],
    cwndHistory: [{ tick: 0, cwnd: initialCwnd, ssthresh: initialSsthresh }],
    segmentsSent: 0,
    segmentsAcked: 0,
    segmentsRetransmitted: 0,
    lossSeq: -1,
    phase: "sending",
  };
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function TCPFlowControlPage() {
  /* ─── State ─── */
  const [mode, setMode] = useState<TCPMode>("sliding-window");
  const [tcpState, setTcpState] = useState<TCPState>(() => createInitialState("sliding-window"));
  const [selectedScenario, setSelectedScenario] = useState<ScenarioName>("normal-transfer");
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);

  /* ─── Refs ─── */
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const modeRef = useRef(mode);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  /* ─── Step forward ─── */
  const stepForward = useCallback(() => {
    setTcpState((prev) => {
      const next: TCPState = {
        ...prev,
        segments: prev.segments.map((s) => ({ ...s })),
        inFlight: prev.inFlight.map((p) => ({ ...p })),
        cwndHistory: [...prev.cwndHistory],
        tick: prev.tick + 1,
      };

      const currentMode = modeRef.current;

      // Advance in-flight packets
      next.inFlight = next.inFlight
        .map((p) => ({ ...p, progress: p.progress + 0.25 }))
        .filter((p) => {
          if (p.progress >= 1) {
            if (p.isAck && !p.lost) {
              // ACK received by sender
              const segIdx = p.seq - 1;
              if (segIdx >= 0 && segIdx < next.segments.length) {
                if (next.segments[segIdx].status === "sent-unacked" || next.segments[segIdx].status === "retransmitted") {
                  next.segments[segIdx].status = "sent-acked";
                  next.segmentsAcked++;

                  // Advance window
                  while (next.windowStart < next.segments.length && next.segments[next.windowStart].status === "sent-acked") {
                    next.windowStart++;
                    next.lastAcked = next.windowStart - 1;
                  }

                  // Cwnd logic for slow-start / congestion-avoidance
                  if (currentMode === "slow-start") {
                    if (next.cwnd < next.ssthresh) {
                      next.cwnd = Math.min(next.cwnd + 1, TOTAL_SEGMENTS);
                    } else {
                      next.cwnd = Math.min(next.cwnd + 1 / next.cwnd, TOTAL_SEGMENTS);
                    }
                    next.windowSize = Math.floor(next.cwnd);
                  } else if (currentMode === "congestion-avoidance") {
                    next.cwnd = Math.min(next.cwnd + 1 / Math.max(1, Math.floor(next.cwnd)), TOTAL_SEGMENTS);
                    next.windowSize = Math.floor(next.cwnd);
                  } else if (currentMode === "fast-retransmit") {
                    if (next.cwnd < next.ssthresh) {
                      next.cwnd = Math.min(next.cwnd + 1, TOTAL_SEGMENTS);
                    } else {
                      next.cwnd = Math.min(next.cwnd + 1 / Math.max(1, Math.floor(next.cwnd)), TOTAL_SEGMENTS);
                    }
                    next.windowSize = Math.floor(next.cwnd);
                    next.dupAckCount = 0;
                  }
                } else if (next.segments[segIdx].status === "sent-acked") {
                  // Duplicate ACK for fast retransmit mode
                  if (currentMode === "fast-retransmit") {
                    next.dupAckCount++;
                    if (next.dupAckCount >= 3) {
                      // Triple dup ACK -> fast retransmit
                      next.ssthresh = Math.max(2, Math.floor(next.cwnd / 2));
                      next.cwnd = next.ssthresh + 3;
                      next.windowSize = Math.floor(next.cwnd);
                      next.dupAckCount = 0;

                      // Find first unacked segment and retransmit
                      for (let i = next.windowStart; i < next.segments.length; i++) {
                        if (next.segments[i].status === "sent-unacked" || next.segments[i].status === "lost") {
                          next.segments[i].status = "retransmitted";
                          next.segmentsRetransmitted++;
                          next.inFlight.push({
                            id: nextPacketId(),
                            seq: i + 1,
                            isAck: false,
                            progress: 0,
                            lost: false,
                          });
                          break;
                        }
                      }

                      next.cwndHistory.push({
                        tick: next.tick,
                        cwnd: next.cwnd,
                        ssthresh: next.ssthresh,
                        event: "fast-retransmit",
                      });
                    }
                  }
                }
              }
            } else if (!p.isAck && !p.lost) {
              // Data packet arrived at receiver, send ACK back
              next.inFlight.push({
                id: nextPacketId(),
                seq: p.seq,
                isAck: true,
                progress: 0,
                lost: false,
              });
            }
            // Drop lost packets silently
            return false;
          }
          return true;
        });

      // Send new segments within window
      const windowEnd = Math.min(next.windowStart + next.windowSize, TOTAL_SEGMENTS);
      let sentThisTick = 0;
      const maxPerTick = 2;

      for (let i = next.windowStart; i < windowEnd && sentThisTick < maxPerTick; i++) {
        if (next.segments[i].status === "unsent") {
          const shouldLose = next.lossSeq === i + 1;
          next.segments[i].status = shouldLose ? "lost" : "sent-unacked";
          next.segmentsSent++;
          sentThisTick++;

          next.inFlight.push({
            id: nextPacketId(),
            seq: i + 1,
            isAck: false,
            progress: 0,
            lost: shouldLose,
          });
        }
      }

      // Update segment display status
      for (let i = 0; i < next.segments.length; i++) {
        if (i < next.windowStart && next.segments[i].status !== "sent-acked") {
          next.segments[i].status = "sent-acked";
        }
        if (i >= windowEnd && next.segments[i].status === "unsent") {
          next.segments[i].status = "outside-window";
        }
        if (i >= next.windowStart && i < windowEnd && next.segments[i].status === "outside-window") {
          next.segments[i].status = "unsent";
        }
      }

      // Record cwnd history
      if (next.tick % 2 === 0) {
        const lastHistory = next.cwndHistory[next.cwndHistory.length - 1];
        if (!lastHistory || Math.abs(lastHistory.cwnd - next.cwnd) > 0.01) {
          next.cwndHistory.push({ tick: next.tick, cwnd: next.cwnd, ssthresh: next.ssthresh });
        }
      }

      // Check completion
      if (next.segments.every((s) => s.status === "sent-acked") && next.inFlight.length === 0) {
        next.phase = "done";
      }

      return next;
    });
  }, []);

  /* ─── Animation loop ─── */
  const animationLoop = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) return;
    const interval = Math.max(10, 200 / speedRef.current);
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
    packetIdCounter = 0;
    setTcpState(createInitialState(modeRef.current));
  }, [handlePause]);

  /* ─── Mode change ─── */
  const handleModeChange = useCallback((newMode: TCPMode) => {
    handlePause();
    setMode(newMode);
    modeRef.current = newMode;
    packetIdCounter = 0;
    setTcpState(createInitialState(newMode));
  }, [handlePause]);

  /* ─── Scenarios ─── */
  const runScenario = useCallback((scenario: ScenarioName) => {
    handlePause();
    setSelectedScenario(scenario);
    packetIdCounter = 0;

    let newMode: TCPMode = "sliding-window";
    let state: TCPState;

    switch (scenario) {
      case "normal-transfer":
        newMode = "sliding-window";
        state = createInitialState(newMode);
        break;
      case "packet-loss":
        newMode = "sliding-window";
        state = createInitialState(newMode);
        state.lossSeq = 5;
        break;
      case "slow-start-growth":
        newMode = "slow-start";
        state = createInitialState(newMode);
        break;
      case "congestion-event":
        newMode = "fast-retransmit";
        state = createInitialState(newMode);
        state.lossSeq = 8;
        break;
    }

    setMode(newMode);
    modeRef.current = newMode;
    setTcpState(state!);

    setTimeout(() => {
      setIsPlaying(true);
      isPlayingRef.current = true;
      lastTickRef.current = 0;
      animationRef.current = requestAnimationFrame(animationLoop);
    }, 50);
  }, [handlePause, animationLoop]);

  /* ─── Derived state ─── */
  const visibleStart = Math.max(0, tcpState.windowStart - 2);
  const visibleEnd = Math.min(TOTAL_SEGMENTS, visibleStart + VISIBLE_SEGMENTS);
  const visibleSegments = tcpState.segments.slice(visibleStart, visibleEnd);

  /* ─── Cwnd chart data ─── */
  const chartData = useMemo(() => {
    const history = tcpState.cwndHistory;
    if (history.length < 2) return null;

    const maxTick = Math.max(...history.map((h) => h.tick), 1);
    const maxCwnd = Math.max(...history.map((h) => Math.max(h.cwnd, h.ssthresh)), 4);
    const chartWidth = 500;
    const chartHeight = 180;
    const padding = { top: 20, right: 20, bottom: 30, left: 40 };
    const plotWidth = chartWidth - padding.left - padding.right;
    const plotHeight = chartHeight - padding.top - padding.bottom;

    const cwndPath = history.map((h, i) => {
      const x = padding.left + (h.tick / maxTick) * plotWidth;
      const y = padding.top + plotHeight - (h.cwnd / maxCwnd) * plotHeight;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    }).join(" ");

    const ssthreshPath = history.map((h, i) => {
      const x = padding.left + (h.tick / maxTick) * plotWidth;
      const y = padding.top + plotHeight - (h.ssthresh / maxCwnd) * plotHeight;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    }).join(" ");

    const events = history.filter((h) => h.event).map((h) => ({
      x: padding.left + (h.tick / maxTick) * plotWidth,
      y: padding.top + plotHeight - (h.cwnd / maxCwnd) * plotHeight,
      event: h.event!,
    }));

    return { cwndPath, ssthreshPath, events, chartWidth, chartHeight, padding, plotWidth, plotHeight, maxCwnd, maxTick };
  }, [tcpState.cwndHistory]);

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
              <span className="text-xs font-mono font-medium px-2 py-1 rounded bg-[#14b8a6]/15 text-[#14b8a6] border border-[#14b8a6]/20">
                8.3
              </span>
              <div className="flex items-center gap-1.5 text-xs text-[#71717a]">
                <Network size={12} />
                <span>Networking & Protocols</span>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">TCP Flow Control</h1>
            <p className="mt-1.5 text-[#a1a1aa] text-sm sm:text-base max-w-2xl">
              Explore TCP's sliding window, slow start, congestion avoidance, and fast retransmit mechanisms.
              Watch segments travel between sender and receiver with realistic timing.
            </p>
          </motion.div>

          {/* ── Mode selector ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex flex-wrap items-center gap-2 mb-4"
          >
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => handleModeChange(m.key)}
                className={`px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                  mode === m.key
                    ? "bg-[#14b8a6]/15 border border-[#14b8a6]/30 text-[#14b8a6]"
                    : "bg-[#1e1e2e] border border-[#1e1e2e] text-[#a1a1aa] hover:bg-[#2a2a3e] hover:text-white"
                }`}
              >
                {m.label}
              </button>
            ))}

            <div className="w-px h-8 bg-[#1e1e2e] mx-1" />

            {SCENARIOS.map((s) => (
              <button
                key={s.key}
                onClick={() => runScenario(s.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                  selectedScenario === s.key
                    ? "bg-[#6366f1]/15 border border-[#6366f1]/30 text-[#6366f1]"
                    : "bg-[#1e1e2e] border border-[#1e1e2e] text-[#71717a] hover:bg-[#2a2a3e] hover:text-[#a1a1aa]"
                }`}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </motion.div>

          {/* ── Main visualization ── */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 mb-4">
            <div className="space-y-4">
              {/* ── Sender buffer ── */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 size={14} className="text-[#06b6d4]" />
                  <span className="text-sm font-semibold">Sender Buffer</span>
                  <span className="text-xs text-[#71717a] font-mono ml-auto">
                    Window: [{tcpState.windowStart + 1}..{Math.min(tcpState.windowStart + tcpState.windowSize, TOTAL_SEGMENTS)}]
                    {" "}Size: {tcpState.windowSize}
                  </span>
                </div>

                {/* Segment array */}
                <div className="flex items-end gap-0.5 overflow-x-auto pb-2">
                  {visibleSegments.map((seg, displayIdx) => {
                    const actualIdx = visibleStart + displayIdx;
                    const isInWindow = actualIdx >= tcpState.windowStart && actualIdx < tcpState.windowStart + tcpState.windowSize;
                    const colors = STATUS_COLORS[seg.status];

                    return (
                      <motion.div
                        key={seg.seq}
                        className="flex flex-col items-center gap-0.5 shrink-0"
                        animate={{
                          scale: seg.status === "sent-unacked" || seg.status === "retransmitted" ? 1.05 : 1,
                        }}
                        transition={{ duration: 0.15 }}
                      >
                        {/* Window bracket indicator */}
                        {isInWindow && actualIdx === tcpState.windowStart && (
                          <div className="text-[8px] text-[#06b6d4] font-mono">[</div>
                        )}

                        <div
                          className="w-8 h-10 rounded flex flex-col items-center justify-center border-2 transition-all duration-150"
                          style={{
                            backgroundColor: colors.bg,
                            borderColor: isInWindow ? colors.border : "#1e1e2e",
                            borderStyle: isInWindow ? "solid" : "dashed",
                          }}
                        >
                          <span className="text-[10px] font-mono font-bold" style={{ color: colors.text }}>
                            {seg.seq}
                          </span>
                        </div>

                        {/* Window end bracket */}
                        {isInWindow && actualIdx === Math.min(tcpState.windowStart + tcpState.windowSize - 1, TOTAL_SEGMENTS - 1) && (
                          <div className="text-[8px] text-[#06b6d4] font-mono">]</div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  {[
                    { status: "sent-acked", label: "Acked" },
                    { status: "sent-unacked", label: "Sent (unacked)" },
                    { status: "unsent", label: "In window" },
                    { status: "outside-window", label: "Outside window" },
                    { status: "lost", label: "Lost" },
                    { status: "retransmitted", label: "Retransmitted" },
                  ].map(({ status, label }) => (
                    <div key={status} className="flex items-center gap-1">
                      <div
                        className="w-2.5 h-2.5 rounded-sm border"
                        style={{
                          backgroundColor: STATUS_COLORS[status as SegmentStatus].bg,
                          borderColor: STATUS_COLORS[status as SegmentStatus].border,
                        }}
                      />
                      <span className="text-[9px] text-[#71717a]">{label}</span>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* ── Sender / Receiver transfer visualization ── */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden"
              >
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ArrowRight size={14} className="text-[#f59e0b]" />
                      <span className="text-sm font-semibold">Segment Transfer</span>
                    </div>
                    <span className="text-xs font-mono text-[#71717a]">
                      tick {tcpState.tick} | RTT ~{tcpState.rtt} ticks
                    </span>
                  </div>

                  {/* Transfer SVG */}
                  <svg viewBox="0 0 600 200" className="w-full" style={{ maxHeight: "220px" }}>
                    <defs>
                      <marker id="arrow-data" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" opacity={0.8} />
                      </marker>
                      <marker id="arrow-ack" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" opacity={0.8} />
                      </marker>
                      <marker id="arrow-lost" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" opacity={0.8} />
                      </marker>
                    </defs>

                    {/* Background grid */}
                    <pattern id="tcp-grid" width="30" height="30" patternUnits="userSpaceOnUse">
                      <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e1e2e" strokeWidth="0.5" opacity="0.3" />
                    </pattern>
                    <rect width="100%" height="100%" fill="url(#tcp-grid)" />

                    {/* Sender line */}
                    <line x1="60" y1="20" x2="60" y2="180" stroke="#f59e0b" strokeWidth="2" opacity="0.3" />
                    <text x="60" y="15" textAnchor="middle" fill="#f59e0b" fontSize="11" fontWeight="600">Sender</text>

                    {/* Receiver line */}
                    <line x1="540" y1="20" x2="540" y2="180" stroke="#10b981" strokeWidth="2" opacity="0.3" />
                    <text x="540" y="15" textAnchor="middle" fill="#10b981" fontSize="11" fontWeight="600">Receiver</text>

                    {/* In-flight packets */}
                    {tcpState.inFlight.map((pkt) => {
                      const startX = pkt.isAck ? 540 : 60;
                      const endX = pkt.isAck ? 60 : 540;
                      const x = startX + (endX - startX) * pkt.progress;

                      // Stagger y position based on seq number
                      const yBase = 40 + ((pkt.seq % 8) * 16);
                      const y = Math.min(yBase, 170);

                      const color = pkt.lost ? "#ef4444" : pkt.isAck ? "#10b981" : "#f59e0b";
                      const markerEnd = pkt.lost ? "url(#arrow-lost)" : pkt.isAck ? "url(#arrow-ack)" : "url(#arrow-data)";

                      return (
                        <g key={pkt.id}>
                          {/* Trail line */}
                          <line
                            x1={startX}
                            y1={y}
                            x2={x}
                            y2={y}
                            stroke={color}
                            strokeWidth={1.5}
                            strokeDasharray={pkt.lost ? "4 3" : "none"}
                            opacity={0.4}
                            markerEnd={markerEnd}
                          />

                          {/* Packet dot */}
                          <circle cx={x} cy={y} r={pkt.lost ? 3 : 4} fill={color} opacity={pkt.lost ? 0.5 : 0.9} />

                          {/* X for lost packets */}
                          {pkt.lost && pkt.progress > 0.3 && pkt.progress < 0.7 && (
                            <>
                              <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y + 5} stroke="#ef4444" strokeWidth="2" />
                              <line x1={x + 5} y1={y - 5} x2={x - 5} y2={y + 5} stroke="#ef4444" strokeWidth="2" />
                            </>
                          )}

                          {/* Seq number label */}
                          <text
                            x={x}
                            y={y - 8}
                            textAnchor="middle"
                            fill={color}
                            fontSize="9"
                            fontFamily="monospace"
                            fontWeight="700"
                          >
                            {pkt.isAck ? `ACK ${pkt.seq}` : `SEQ ${pkt.seq}`}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </motion.div>

              {/* ── Cwnd Graph ── */}
              {(mode === "slow-start" || mode === "congestion-avoidance" || mode === "fast-retransmit") && chartData && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.25 }}
                  className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp size={14} className="text-[#6366f1]" />
                    <span className="text-sm font-semibold">Congestion Window Over Time</span>
                    <div className="flex items-center gap-3 ml-auto">
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-0.5 bg-[#6366f1] rounded-full" />
                        <span className="text-[9px] text-[#71717a]">cwnd</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-0.5 bg-[#ef4444] rounded-full" style={{ borderTop: "1px dashed #ef4444" }} />
                        <span className="text-[9px] text-[#71717a]">ssthresh</span>
                      </div>
                    </div>
                  </div>

                  <svg viewBox={`0 0 ${chartData.chartWidth} ${chartData.chartHeight}`} className="w-full">
                    {/* Y axis */}
                    <line
                      x1={chartData.padding.left}
                      y1={chartData.padding.top}
                      x2={chartData.padding.left}
                      y2={chartData.padding.top + chartData.plotHeight}
                      stroke="#1e1e2e"
                      strokeWidth="1"
                    />
                    {/* X axis */}
                    <line
                      x1={chartData.padding.left}
                      y1={chartData.padding.top + chartData.plotHeight}
                      x2={chartData.padding.left + chartData.plotWidth}
                      y2={chartData.padding.top + chartData.plotHeight}
                      stroke="#1e1e2e"
                      strokeWidth="1"
                    />

                    {/* Y axis labels */}
                    {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                      const y = chartData.padding.top + chartData.plotHeight * (1 - frac);
                      const val = Math.round(chartData.maxCwnd * frac);
                      return (
                        <g key={frac}>
                          <line
                            x1={chartData.padding.left}
                            y1={y}
                            x2={chartData.padding.left + chartData.plotWidth}
                            y2={y}
                            stroke="#1e1e2e"
                            strokeWidth="0.5"
                            strokeDasharray="4 4"
                          />
                          <text x={chartData.padding.left - 5} y={y + 3} textAnchor="end" fill="#71717a" fontSize="9" fontFamily="monospace">
                            {val}
                          </text>
                        </g>
                      );
                    })}

                    {/* X axis label */}
                    <text
                      x={chartData.padding.left + chartData.plotWidth / 2}
                      y={chartData.chartHeight - 5}
                      textAnchor="middle"
                      fill="#71717a"
                      fontSize="9"
                    >
                      Time (ticks)
                    </text>

                    {/* Y axis label */}
                    <text
                      x={10}
                      y={chartData.padding.top + chartData.plotHeight / 2}
                      textAnchor="middle"
                      fill="#71717a"
                      fontSize="9"
                      transform={`rotate(-90, 10, ${chartData.padding.top + chartData.plotHeight / 2})`}
                    >
                      cwnd
                    </text>

                    {/* Ssthresh line */}
                    <path
                      d={chartData.ssthreshPath}
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="1.5"
                      strokeDasharray="6 3"
                      opacity="0.6"
                    />

                    {/* Cwnd line */}
                    <path
                      d={chartData.cwndPath}
                      fill="none"
                      stroke="#6366f1"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {/* Event markers */}
                    {chartData.events.map((evt, i) => (
                      <g key={i}>
                        <circle cx={evt.x} cy={evt.y} r={5} fill="#ef4444" opacity={0.8} />
                        <text x={evt.x} y={evt.y - 8} textAnchor="middle" fill="#ef4444" fontSize="8" fontWeight="600">
                          {evt.event}
                        </text>
                      </g>
                    ))}
                  </svg>
                </motion.div>
              )}
            </div>

            {/* ── Right column: Metrics ── */}
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
                        <Activity size={14} className="text-[#14b8a6]" />
                        <span className="text-sm font-medium text-[#a1a1aa]">TCP Metrics</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <MetricCard label="cwnd" value={tcpState.cwnd.toFixed(1)} color="#6366f1" />
                        <MetricCard label="ssthresh" value={String(tcpState.ssthresh)} color="#ef4444" />
                        <MetricCard label="Segments Sent" value={String(tcpState.segmentsSent)} color="#f59e0b" />
                        <MetricCard label="Acknowledged" value={String(tcpState.segmentsAcked)} color="#10b981" />
                        <MetricCard label="Retransmitted" value={String(tcpState.segmentsRetransmitted)} color="#ef4444" />
                        <MetricCard label="RTT" value={`${tcpState.rtt} ticks`} color="#06b6d4" />
                        <MetricCard label="Window Start" value={String(tcpState.windowStart + 1)} color="#a1a1aa" />
                        <MetricCard label="Window Size" value={String(tcpState.windowSize)} color="#06b6d4" />
                      </div>

                      {/* Progress bar */}
                      <div className="mt-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-[#71717a] uppercase tracking-wider">Transfer Progress</span>
                          <span className="text-[10px] font-mono text-[#6366f1]">
                            {tcpState.segmentsAcked}/{TOTAL_SEGMENTS}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-[#1e1e2e] overflow-hidden">
                          <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-[#6366f1] to-[#06b6d4]"
                            style={{ width: `${(tcpState.segmentsAcked / TOTAL_SEGMENTS) * 100}%` }}
                            transition={{ duration: 0.2 }}
                          />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Mode description ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.25 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Zap size={14} className="text-[#14b8a6]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">
                    {MODES.find((m) => m.key === mode)?.label}
                  </span>
                </div>

                <div className="text-xs text-[#71717a] space-y-2">
                  {mode === "sliding-window" && (
                    <>
                      <p>The sliding window protocol allows the sender to transmit multiple segments
                        before receiving acknowledgments. The window slides right as ACKs arrive.</p>
                      <div className="space-y-1 mt-2">
                        <div className="flex items-center gap-2">
                          <ChevronRight size={10} className="text-[#10b981] shrink-0" />
                          <span>Green segments are acknowledged</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ChevronRight size={10} className="text-[#f59e0b] shrink-0" />
                          <span>Amber segments are sent but unacknowledged</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ChevronRight size={10} className="text-[#06b6d4] shrink-0" />
                          <span>Cyan segments are within the window but unsent</span>
                        </div>
                      </div>
                    </>
                  )}
                  {mode === "slow-start" && (
                    <>
                      <p>Slow Start begins with a small congestion window (cwnd=1) and doubles it
                        each RTT. Growth is exponential until reaching ssthresh.</p>
                      <p className="text-[#6366f1]">cwnd doubles: 1 → 2 → 4 → 8 → 16...</p>
                      <p>After reaching ssthresh, switches to congestion avoidance (linear growth).</p>
                    </>
                  )}
                  {mode === "congestion-avoidance" && (
                    <>
                      <p>After ssthresh is reached, TCP switches to linear growth. The cwnd increases
                        by 1/cwnd for each ACK, resulting in roughly +1 per RTT.</p>
                      <p className="text-[#06b6d4]">cwnd grows linearly: +1 MSS per RTT</p>
                      <p>This conservative approach probes for available bandwidth without overwhelming the network.</p>
                    </>
                  )}
                  {mode === "fast-retransmit" && (
                    <>
                      <p>When a sender receives 3 duplicate ACKs, it infers packet loss without
                        waiting for a timeout. It immediately retransmits the missing segment.</p>
                      <p className="text-[#ef4444]">3 dup ACKs → ssthresh = cwnd/2, cwnd = ssthresh + 3</p>
                      <p>This avoids the expensive timeout-based recovery and keeps throughput higher.</p>
                    </>
                  )}
                </div>
              </motion.div>

              {/* ── Phase status ── */}
              <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Timer size={14} className="text-[#f59e0b]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">Status</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    tcpState.phase === "done" ? "bg-[#10b981]" : "bg-[#f59e0b] animate-pulse"
                  }`} />
                  <span className="text-xs text-white font-medium capitalize">{tcpState.phase}</span>
                </div>
                <div className="text-[10px] text-[#71717a] mt-1 font-mono">
                  Tick: {tcpState.tick} | In-flight: {tcpState.inFlight.length} packets
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
                {tcpState.phase === "done" && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#10b981]/15 border border-[#10b981]/20"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                    <span className="text-xs font-medium text-[#10b981]">Transfer Complete</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </ModuleControls>
          </motion.div>

          {/* ── Info Section ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
            className="mt-4 rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} className="text-[#14b8a6]" />
              <span className="text-sm font-medium text-[#a1a1aa]">Key Concepts</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs text-[#71717a]">
              <div>
                <div className="text-white font-medium mb-1">Sliding Window</div>
                <p>Allows multiple segments in-flight without individual ACKs. Window size controls throughput.</p>
                <div className="mt-2 p-2 rounded bg-[#0a0a0f] border border-[#1e1e2e]">
                  <span className="text-[9px] font-mono text-[#06b6d4]">effective_window = min(cwnd, rwnd)</span>
                </div>
              </div>
              <div>
                <div className="text-white font-medium mb-1">Slow Start</div>
                <p>Exponential cwnd growth from 1 MSS. Probes network capacity quickly but carefully.</p>
                <div className="mt-2 p-2 rounded bg-[#0a0a0f] border border-[#1e1e2e]">
                  <span className="text-[9px] font-mono text-[#06b6d4]">cwnd += 1 MSS per ACK</span>
                </div>
              </div>
              <div>
                <div className="text-white font-medium mb-1">Congestion Avoidance</div>
                <p>Linear cwnd growth after ssthresh. Additive increase, multiplicative decrease (AIMD).</p>
                <div className="mt-2 p-2 rounded bg-[#0a0a0f] border border-[#1e1e2e]">
                  <span className="text-[9px] font-mono text-[#06b6d4]">cwnd += 1/cwnd per ACK</span>
                </div>
              </div>
              <div>
                <div className="text-white font-medium mb-1">Fast Retransmit</div>
                <p>3 duplicate ACKs trigger immediate retransmission, bypassing expensive timeout recovery.</p>
                <div className="mt-2 p-2 rounded bg-[#0a0a0f] border border-[#1e1e2e]">
                  <span className="text-[9px] font-mono text-[#ef4444]">ssthresh = cwnd/2</span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── TCP Segment header structure ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-4 rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Layers size={14} className="text-[#06b6d4]" />
              <span className="text-sm font-medium text-[#a1a1aa]">TCP Segment Header</span>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[480px]">
                {/* Bit scale */}
                <div className="flex items-center mb-1">
                  {[0, 4, 8, 12, 16, 20, 24, 28, 31].map((bit) => (
                    <div key={bit} className="flex-1 text-center">
                      <span className="text-[7px] font-mono text-[#3a3a4e]">{bit}</span>
                    </div>
                  ))}
                </div>

                {/* Header fields */}
                <div className="space-y-0.5">
                  <div className="flex gap-0.5">
                    <div className="flex-1 rounded px-2 py-1.5 text-center text-[9px] font-mono bg-[#06b6d4]/10 border border-[#06b6d4]/20 text-[#06b6d4]">
                      Source Port (16 bits)
                    </div>
                    <div className="flex-1 rounded px-2 py-1.5 text-center text-[9px] font-mono bg-[#06b6d4]/10 border border-[#06b6d4]/20 text-[#06b6d4]">
                      Destination Port (16 bits)
                    </div>
                  </div>
                  <div className="rounded px-2 py-1.5 text-center text-[9px] font-mono bg-[#6366f1]/10 border border-[#6366f1]/20 text-[#6366f1]">
                    Sequence Number (32 bits)
                  </div>
                  <div className="rounded px-2 py-1.5 text-center text-[9px] font-mono bg-[#10b981]/10 border border-[#10b981]/20 text-[#10b981]">
                    Acknowledgment Number (32 bits)
                  </div>
                  <div className="flex gap-0.5">
                    <div className="w-16 rounded px-1 py-1.5 text-center text-[8px] font-mono bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b]">
                      Offset
                    </div>
                    <div className="w-12 rounded px-1 py-1.5 text-center text-[8px] font-mono bg-[#71717a]/10 border border-[#71717a]/20 text-[#71717a]">
                      Rsv
                    </div>
                    <div className="flex-1 flex gap-0.5">
                      {["URG", "ACK", "PSH", "RST", "SYN", "FIN"].map((flag) => (
                        <div key={flag} className="flex-1 rounded px-0.5 py-1.5 text-center text-[7px] font-mono bg-[#ef4444]/10 border border-[#ef4444]/20 text-[#ef4444]">
                          {flag}
                        </div>
                      ))}
                    </div>
                    <div className="flex-1 rounded px-1 py-1.5 text-center text-[8px] font-mono bg-[#a855f7]/10 border border-[#a855f7]/20 text-[#a855f7]">
                      Window Size
                    </div>
                  </div>
                  <div className="flex gap-0.5">
                    <div className="flex-1 rounded px-2 py-1.5 text-center text-[9px] font-mono bg-[#71717a]/10 border border-[#71717a]/20 text-[#71717a]">
                      Checksum (16 bits)
                    </div>
                    <div className="flex-1 rounded px-2 py-1.5 text-center text-[9px] font-mono bg-[#71717a]/10 border border-[#71717a]/20 text-[#71717a]">
                      Urgent Pointer (16 bits)
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Algorithm comparison table ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.45 }}
            className="mt-4 rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-2">
                <BarChart3 size={14} className="text-[#6366f1]" />
                <span className="text-sm font-semibold text-white">Congestion Control Algorithms</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1e1e2e]">
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Phase</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Trigger</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">cwnd Change</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">ssthresh Change</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Growth Pattern</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { phase: "Slow Start", trigger: "Connection open", cwnd: "+1 per ACK", ssthresh: "Unchanged", growth: "Exponential" },
                    { phase: "Congestion Avoidance", trigger: "cwnd >= ssthresh", cwnd: "+1/cwnd per ACK", ssthresh: "Unchanged", growth: "Linear" },
                    { phase: "Fast Retransmit", trigger: "3 dup ACKs", cwnd: "ssthresh + 3", ssthresh: "cwnd / 2", growth: "Step down" },
                    { phase: "Timeout", trigger: "RTO expires", cwnd: "1 MSS", ssthresh: "cwnd / 2", growth: "Reset to SS" },
                  ].map((row) => (
                    <tr key={row.phase} className="border-b border-[#1e1e2e]/50 hover:bg-[#1e1e2e]/20 transition-colors">
                      <td className="px-4 py-2 font-medium text-white">{row.phase}</td>
                      <td className="px-4 py-2 text-[#a1a1aa]">{row.trigger}</td>
                      <td className="px-4 py-2 font-mono text-[#06b6d4]">{row.cwnd}</td>
                      <td className="px-4 py-2 font-mono text-[#ef4444]">{row.ssthresh}</td>
                      <td className="px-4 py-2 text-[#f59e0b]">{row.growth}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>

          {/* ── TCP vs UDP comparison ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="mt-4 rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Network size={14} className="text-[#14b8a6]" />
              <span className="text-sm font-medium text-[#a1a1aa]">TCP vs UDP</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg bg-[#06b6d4]/5 border border-[#06b6d4]/15">
                <div className="text-xs font-semibold text-[#06b6d4] mb-2">TCP (Transmission Control Protocol)</div>
                <ul className="text-[10px] text-[#71717a] space-y-1">
                  <li className="flex items-start gap-1.5"><ChevronRight size={9} className="text-[#10b981] mt-0.5 shrink-0" /><span>Connection-oriented (3-way handshake)</span></li>
                  <li className="flex items-start gap-1.5"><ChevronRight size={9} className="text-[#10b981] mt-0.5 shrink-0" /><span>Reliable delivery with ACKs</span></li>
                  <li className="flex items-start gap-1.5"><ChevronRight size={9} className="text-[#10b981] mt-0.5 shrink-0" /><span>Flow control via sliding window</span></li>
                  <li className="flex items-start gap-1.5"><ChevronRight size={9} className="text-[#10b981] mt-0.5 shrink-0" /><span>Congestion control (slow start, AIMD)</span></li>
                  <li className="flex items-start gap-1.5"><ChevronRight size={9} className="text-[#10b981] mt-0.5 shrink-0" /><span>Ordered delivery guaranteed</span></li>
                  <li className="flex items-start gap-1.5"><ChevronRight size={9} className="text-[#10b981] mt-0.5 shrink-0" /><span>Use: HTTP, FTP, SSH, Email</span></li>
                </ul>
              </div>
              <div className="p-3 rounded-lg bg-[#f59e0b]/5 border border-[#f59e0b]/15">
                <div className="text-xs font-semibold text-[#f59e0b] mb-2">UDP (User Datagram Protocol)</div>
                <ul className="text-[10px] text-[#71717a] space-y-1">
                  <li className="flex items-start gap-1.5"><ChevronRight size={9} className="text-[#f59e0b] mt-0.5 shrink-0" /><span>Connectionless (fire and forget)</span></li>
                  <li className="flex items-start gap-1.5"><ChevronRight size={9} className="text-[#f59e0b] mt-0.5 shrink-0" /><span>Unreliable, no acknowledgments</span></li>
                  <li className="flex items-start gap-1.5"><ChevronRight size={9} className="text-[#f59e0b] mt-0.5 shrink-0" /><span>No flow or congestion control</span></li>
                  <li className="flex items-start gap-1.5"><ChevronRight size={9} className="text-[#f59e0b] mt-0.5 shrink-0" /><span>Minimal overhead (8-byte header)</span></li>
                  <li className="flex items-start gap-1.5"><ChevronRight size={9} className="text-[#f59e0b] mt-0.5 shrink-0" /><span>No ordering guarantee</span></li>
                  <li className="flex items-start gap-1.5"><ChevronRight size={9} className="text-[#f59e0b] mt-0.5 shrink-0" /><span>Use: DNS, Video, VoIP, Gaming</span></li>
                </ul>
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
      <div className="text-sm font-bold font-mono" style={{ color }}>{value}</div>
    </div>
  );
}
