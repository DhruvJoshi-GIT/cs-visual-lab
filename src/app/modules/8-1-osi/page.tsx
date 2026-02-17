"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers,
  ArrowDown,
  ArrowUp,
  Network,
  Monitor,
  Server,
  Zap,
  Activity,
  Send,
  Shield,
  Info,
  ChevronRight,
  Globe,
  Wifi,
  Cable,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

/* ═══════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════ */

interface OSILayer {
  id: number;
  name: string;
  tcpipName: string;
  tcpipLayer: number;
  protocols: string[];
  dataUnit: string;
  color: string;
  headerLabel: string;
  headerSize: number;
  description: string;
  responsibility: string;
}

type SimPhase =
  | "idle"
  | "encapsulating"
  | "transferring"
  | "decapsulating"
  | "complete";

type ScenarioName = "http-request" | "tcp-handshake" | "ip-routing" | "full-stack";

interface SimState {
  phase: SimPhase;
  currentLayer: number;
  senderHeaders: boolean[];
  receiverHeaders: boolean[];
  transferProgress: number;
  highlightedProtocol: string | null;
  step: number;
  totalSteps: number;
  scenarioData: ScenarioData | null;
}

interface ScenarioData {
  name: string;
  description: string;
  activeProtocols: string[];
  packetContent: string;
}

interface EventLogItem {
  id: number;
  message: string;
  layer: number;
  phase: SimPhase;
  color: string;
}

const OSI_LAYERS: OSILayer[] = [
  {
    id: 7,
    name: "Application",
    tcpipName: "Application",
    tcpipLayer: 4,
    protocols: ["HTTP", "FTP", "SMTP", "DNS", "SSH"],
    dataUnit: "Data",
    color: "#6366f1",
    headerLabel: "HTTP",
    headerSize: 40,
    description: "User-facing network services and APIs",
    responsibility: "Provides network services directly to end-user applications",
  },
  {
    id: 6,
    name: "Presentation",
    tcpipName: "Application",
    tcpipLayer: 4,
    protocols: ["SSL/TLS", "JPEG", "MPEG", "ASCII"],
    dataUnit: "Data",
    color: "#8b5cf6",
    headerLabel: "SSL",
    headerSize: 32,
    description: "Data translation, encryption, compression",
    responsibility: "Translates data between application and network formats",
  },
  {
    id: 5,
    name: "Session",
    tcpipName: "Application",
    tcpipLayer: 4,
    protocols: ["NetBIOS", "RPC", "PPTP"],
    dataUnit: "Data",
    color: "#a855f7",
    headerLabel: "SES",
    headerSize: 28,
    description: "Connection management and session control",
    responsibility: "Establishes, manages, and terminates sessions",
  },
  {
    id: 4,
    name: "Transport",
    tcpipName: "Transport",
    tcpipLayer: 3,
    protocols: ["TCP", "UDP", "SCTP"],
    dataUnit: "Segment",
    color: "#06b6d4",
    headerLabel: "TCP",
    headerSize: 36,
    description: "End-to-end delivery with flow and error control",
    responsibility: "Provides reliable or unreliable end-to-end data delivery",
  },
  {
    id: 3,
    name: "Network",
    tcpipName: "Internet",
    tcpipLayer: 2,
    protocols: ["IP", "ICMP", "ARP", "OSPF"],
    dataUnit: "Packet",
    color: "#10b981",
    headerLabel: "IP",
    headerSize: 32,
    description: "Logical addressing and routing across networks",
    responsibility: "Routes packets from source to destination across networks",
  },
  {
    id: 2,
    name: "Data Link",
    tcpipName: "Network Access",
    tcpipLayer: 1,
    protocols: ["Ethernet", "WiFi", "PPP", "MAC"],
    dataUnit: "Frame",
    color: "#f59e0b",
    headerLabel: "ETH",
    headerSize: 28,
    description: "Physical addressing and media access control",
    responsibility: "Transfers frames between adjacent network nodes",
  },
  {
    id: 1,
    name: "Physical",
    tcpipName: "Network Access",
    tcpipLayer: 1,
    protocols: ["USB", "Bluetooth", "DSL", "Fiber"],
    dataUnit: "Bits",
    color: "#ef4444",
    headerLabel: "PHY",
    headerSize: 24,
    description: "Raw bit transmission over physical medium",
    responsibility: "Transmits raw bitstreams over a physical channel",
  },
];

const TCPIP_LAYERS = [
  { id: 4, name: "Application", color: "#6366f1", osiLayers: [7, 6, 5], description: "HTTP, FTP, SMTP, DNS" },
  { id: 3, name: "Transport", color: "#06b6d4", osiLayers: [4], description: "TCP, UDP" },
  { id: 2, name: "Internet", color: "#10b981", osiLayers: [3], description: "IP, ICMP, ARP" },
  { id: 1, name: "Network Access", color: "#f59e0b", osiLayers: [2, 1], description: "Ethernet, WiFi, PPP" },
];

const SCENARIOS: { key: ScenarioName; label: string; icon: React.ReactNode; description: string; protocols: string[]; content: string }[] = [
  { key: "http-request", label: "HTTP Request", icon: <Globe size={13} />, description: "Web browser fetching a page via HTTP over TCP/IP", protocols: ["HTTP", "TCP", "IP", "Ethernet"], content: "GET /index.html HTTP/1.1" },
  { key: "tcp-handshake", label: "TCP Handshake", icon: <Send size={13} />, description: "Three-way handshake: SYN, SYN-ACK, ACK", protocols: ["TCP", "IP", "Ethernet"], content: "SYN seq=100" },
  { key: "ip-routing", label: "IP Routing", icon: <Network size={13} />, description: "Packet routed across multiple networks via IP", protocols: ["IP", "ICMP", "Ethernet"], content: "ICMP Echo Request" },
  { key: "full-stack", label: "Full Stack", icon: <Layers size={13} />, description: "Complete encapsulation through all 7 OSI layers", protocols: ["HTTP", "SSL/TLS", "NetBIOS", "TCP", "IP", "Ethernet", "Fiber"], content: "Application Data" },
];

const PROTOCOL_LAYER_MAP: Record<string, number> = {
  HTTP: 7, FTP: 7, SMTP: 7, DNS: 7, SSH: 7,
  "SSL/TLS": 6, JPEG: 6, MPEG: 6,
  NetBIOS: 5, RPC: 5, PPTP: 5,
  TCP: 4, UDP: 4, SCTP: 4,
  IP: 3, ICMP: 3, ARP: 3, OSPF: 3,
  Ethernet: 2, WiFi: 2, PPP: 2, MAC: 2,
  USB: 1, Bluetooth: 1, DSL: 1, Fiber: 1,
};

let eventIdCounter = 0;

function createInitialSimState(): SimState {
  return {
    phase: "idle",
    currentLayer: -1,
    senderHeaders: [false, false, false, false, false, false, false],
    receiverHeaders: [true, true, true, true, true, true, true],
    transferProgress: 0,
    highlightedProtocol: null,
    step: 0,
    totalSteps: 0,
    scenarioData: null,
  };
}

/* ═══════════════════════════════════════════════════════════
   HELPER: Layer detail panel
   ═══════════════════════════════════════════════════════════ */

function LayerDetailPanel({ layer, isActive }: { layer: OSILayer; isActive: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="px-3 pb-2 overflow-hidden"
    >
      <div className="p-2 rounded bg-[#0a0a0f] border border-[#1e1e2e] mt-1">
        <p className="text-[10px] text-[#71717a] mb-1">{layer.description}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {layer.protocols.map((p) => (
            <span
              key={p}
              className="text-[8px] font-mono px-1.5 py-0.5 rounded"
              style={{ backgroundColor: `${layer.color}15`, color: `${layer.color}cc` }}
            >
              {p}
            </span>
          ))}
        </div>
        <div className="mt-1.5 text-[9px] text-[#71717a]">
          <span className="font-medium" style={{ color: layer.color }}>PDU:</span> {layer.dataUnit}
          <span className="mx-2">|</span>
          <span className="font-medium" style={{ color: layer.color }}>Header:</span> ~{layer.headerSize}B
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function OSIModelPage() {
  /* ─── State ─── */
  const [simState, setSimState] = useState<SimState>(createInitialSimState);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioName>("full-stack");
  const [selectedProtocol, setSelectedProtocol] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [hoveredLayer, setHoveredLayer] = useState<number | null>(null);
  const [expandedLayer, setExpandedLayer] = useState<number | null>(null);
  const [eventLog, setEventLog] = useState<EventLogItem[]>([]);
  const [showLayerDetails, setShowLayerDetails] = useState(false);

  /* ─── Refs ─── */
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const eventLogEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  /* Auto-scroll event log */
  useEffect(() => {
    eventLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [eventLog.length]);

  /* ─── Add event log entry ─── */
  const addEvent = useCallback((message: string, layer: number, phase: SimPhase, color: string) => {
    setEventLog((prev) => [
      ...prev.slice(-100),
      { id: ++eventIdCounter, message, layer, phase, color },
    ]);
  }, []);

  /* ─── Step forward logic ─── */
  const stepForward = useCallback(() => {
    setSimState((prev) => {
      const next = { ...prev };
      next.senderHeaders = [...prev.senderHeaders];
      next.receiverHeaders = [...prev.receiverHeaders];
      next.step = prev.step + 1;

      if (prev.phase === "idle") {
        next.phase = "encapsulating";
        next.currentLayer = 0;
        next.senderHeaders = [false, false, false, false, false, false, false];
        next.receiverHeaders = [true, true, true, true, true, true, true];
        next.transferProgress = 0;
        next.totalSteps = 7 + 10 + 7 + 1;
        addEvent("Starting encapsulation at Application layer", 7, "encapsulating", "#6366f1");
        return next;
      }

      if (prev.phase === "encapsulating") {
        const layerIdx = prev.currentLayer;
        if (layerIdx < 7) {
          next.senderHeaders[layerIdx] = true;
          const layer = OSI_LAYERS[layerIdx];
          addEvent(
            `Layer ${layer.id} (${layer.name}): Added ${layer.headerLabel} header (+${layer.headerSize}B)`,
            layer.id,
            "encapsulating",
            layer.color
          );
          next.currentLayer = layerIdx + 1;
          if (layerIdx + 1 >= 7) {
            next.phase = "transferring";
            next.currentLayer = -1;
            next.transferProgress = 0;
            addEvent("Encapsulation complete. Transmitting over physical medium...", 1, "transferring", "#ef4444");
          }
          return next;
        }
      }

      if (prev.phase === "transferring") {
        const newProgress = prev.transferProgress + 0.1;
        if (newProgress >= 1) {
          next.phase = "decapsulating";
          next.currentLayer = 6;
          next.transferProgress = 1;
          addEvent("Packet received. Starting decapsulation at Physical layer.", 1, "decapsulating", "#ef4444");
          return next;
        }
        next.transferProgress = newProgress;
        return next;
      }

      if (prev.phase === "decapsulating") {
        const layerIdx = prev.currentLayer;
        if (layerIdx >= 0) {
          next.receiverHeaders[layerIdx] = false;
          const layer = OSI_LAYERS[layerIdx];
          addEvent(
            `Layer ${layer.id} (${layer.name}): Stripped ${layer.headerLabel} header`,
            layer.id,
            "decapsulating",
            layer.color
          );
          next.currentLayer = layerIdx - 1;
          if (layerIdx - 1 < 0) {
            next.phase = "complete";
            addEvent("Decapsulation complete. Original data delivered to Application.", 7, "complete", "#10b981");
          }
          return next;
        }
      }

      return next;
    });
  }, [addEvent]);

  /* ─── Animation loop ─── */
  const animationLoop = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) return;
    const interval = Math.max(10, 300 / speedRef.current);
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
    eventIdCounter = 0;
    setSimState(createInitialSimState());
    setEventLog([]);
  }, [handlePause]);

  /* ─── Auto-loop on complete ─── */
  useEffect(() => {
    if (simState.phase === "complete" && isPlaying) {
      const timer = setTimeout(() => {
        setSimState(createInitialSimState());
      }, 1500 / speed);
      return () => clearTimeout(timer);
    }
  }, [simState.phase, isPlaying, speed]);

  /* ─── Scenario presets ─── */
  const runScenario = useCallback((scenario: ScenarioName) => {
    handleReset();
    setSelectedScenario(scenario);
    const scenarioInfo = SCENARIOS.find((s) => s.key === scenario)!;
    setTimeout(() => {
      setSimState((prev) => ({
        ...prev,
        scenarioData: {
          name: scenarioInfo.label,
          description: scenarioInfo.description,
          activeProtocols: scenarioInfo.protocols,
          packetContent: scenarioInfo.content,
        },
      }));

      switch (scenario) {
        case "http-request":
          setSelectedProtocol("HTTP");
          break;
        case "tcp-handshake":
          setSelectedProtocol("TCP");
          break;
        case "ip-routing":
          setSelectedProtocol("IP");
          break;
        case "full-stack":
          setSelectedProtocol(null);
          break;
      }

      addEvent(`Scenario: ${scenarioInfo.label} - ${scenarioInfo.description}`, 0, "idle", "#14b8a6");

      setIsPlaying(true);
      isPlayingRef.current = true;
      lastTickRef.current = 0;
      animationRef.current = requestAnimationFrame(animationLoop);
    }, 50);
  }, [handleReset, animationLoop, addEvent]);

  /* ─── Metrics ─── */
  const metrics = useMemo(() => {
    const activeHeaders = simState.senderHeaders.filter(Boolean).length;
    let totalPacketSize = 64; // base data
    for (let i = 0; i < simState.senderHeaders.length; i++) {
      if (simState.senderHeaders[i]) {
        totalPacketSize += OSI_LAYERS[i].headerSize;
      }
    }
    const currentLayerName = simState.currentLayer >= 0 && simState.currentLayer < 7
      ? OSI_LAYERS[simState.phase === "decapsulating" ? simState.currentLayer : Math.min(simState.currentLayer, 6)].name
      : simState.phase === "transferring" ? "In Transit" : simState.phase === "complete" ? "Done" : "Ready";
    const protocolStack = OSI_LAYERS
      .filter((_, i) => simState.senderHeaders[i])
      .map((l) => l.headerLabel)
      .reverse()
      .join(" > ");

    return { activeHeaders, totalPacketSize, currentLayerName, protocolStack: protocolStack || "None" };
  }, [simState]);

  /* ─── Get active layer index for highlight ─── */
  const activeLayerHighlight = useMemo(() => {
    if (selectedProtocol) {
      const layerNum = PROTOCOL_LAYER_MAP[selectedProtocol];
      if (layerNum) {
        return OSI_LAYERS.findIndex((l) => l.id === layerNum);
      }
    }
    if (simState.phase === "encapsulating" && simState.currentLayer > 0) {
      return simState.currentLayer - 1;
    }
    if (simState.phase === "decapsulating" && simState.currentLayer >= 0 && simState.currentLayer < 7) {
      return simState.currentLayer;
    }
    return -1;
  }, [selectedProtocol, simState.phase, simState.currentLayer]);

  /* ─── Overhead calculation ─── */
  const overheadPercentage = useMemo(() => {
    const dataSize = 64;
    const headerTotal = metrics.totalPacketSize - dataSize;
    return ((headerTotal / metrics.totalPacketSize) * 100).toFixed(1);
  }, [metrics.totalPacketSize]);

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
                8.1
              </span>
              <div className="flex items-center gap-1.5 text-xs text-[#71717a]">
                <Network size={12} />
                <span>Networking & Protocols</span>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              OSI / TCP-IP Model
            </h1>
            <p className="mt-1.5 text-[#a1a1aa] text-sm sm:text-base max-w-2xl">
              Visualize the 7-layer OSI model and 4-layer TCP/IP model. Watch data encapsulation
              as it travels down the sender stack, across the network, and up the receiver stack.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#f59e0b]/8 text-[#f59e0b] border border-[#f59e0b]/15">
                <Zap size={11} />
                Prerequisite: Basic Networking Concepts
              </span>
            </div>
          </motion.div>

          {/* ── Scenario selector ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex flex-wrap items-center gap-2 mb-4"
          >
            {SCENARIOS.map((s) => (
              <button
                key={s.key}
                onClick={() => runScenario(s.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                  selectedScenario === s.key
                    ? "bg-[#14b8a6]/15 border border-[#14b8a6]/30 text-[#14b8a6]"
                    : "bg-[#1e1e2e] border border-[#1e1e2e] text-[#a1a1aa] hover:bg-[#2a2a3e] hover:text-white"
                }`}
                title={s.description}
              >
                {s.icon}
                {s.label}
              </button>
            ))}

            <div className="w-px h-8 bg-[#1e1e2e] mx-1" />

            {/* Protocol selector */}
            <div className="flex items-center gap-1">
              <span className="text-xs text-[#71717a] mr-1">Protocol:</span>
              {["HTTP", "TCP", "IP", "Ethernet"].map((proto) => (
                <button
                  key={proto}
                  onClick={() => setSelectedProtocol(selectedProtocol === proto ? null : proto)}
                  className={`px-2.5 py-1.5 text-xs font-mono rounded-lg transition-all duration-200 ${
                    selectedProtocol === proto
                      ? "bg-[#6366f1]/15 border border-[#6366f1]/30 text-[#6366f1]"
                      : "bg-[#111118] border border-[#1e1e2e] text-[#71717a] hover:text-white"
                  }`}
                >
                  {proto}
                </button>
              ))}
            </div>

            <div className="w-px h-8 bg-[#1e1e2e] mx-1" />

            {/* Layer details toggle */}
            <button
              onClick={() => setShowLayerDetails(!showLayerDetails)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                showLayerDetails
                  ? "bg-[#6366f1]/15 border border-[#6366f1]/30 text-[#6366f1]"
                  : "bg-[#1e1e2e] border border-[#1e1e2e] text-[#71717a] hover:bg-[#2a2a3e]"
              }`}
            >
              <Info size={13} />
              Details
            </button>
          </motion.div>

          {/* ── Scenario info banner ─── */}
          <AnimatePresence>
            {simState.scenarioData && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 overflow-hidden"
              >
                <div className="p-3 rounded-xl bg-[#14b8a6]/8 border border-[#14b8a6]/20">
                  <div className="flex items-center gap-2 mb-1">
                    <Globe size={13} className="text-[#14b8a6]" />
                    <span className="text-xs font-semibold text-[#14b8a6]">{simState.scenarioData.name}</span>
                  </div>
                  <p className="text-[11px] text-[#14b8a6]/70">{simState.scenarioData.description}</p>
                  <div className="flex items-center gap-1 mt-1.5">
                    <span className="text-[9px] text-[#71717a]">Content:</span>
                    <span className="text-[10px] font-mono text-[#a1a1aa] px-1.5 py-0.5 rounded bg-[#0a0a0f]/50">
                      {simState.scenarioData.packetContent}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Main visualization ── */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
            {/* Left column */}
            <div className="space-y-4">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden"
              >
                {/* Phase indicator bar */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      simState.phase === "idle" ? "bg-[#71717a]" :
                      simState.phase === "complete" ? "bg-[#10b981]" :
                      "bg-[#f59e0b] animate-pulse"
                    }`} />
                    <span className="text-xs font-medium text-[#a1a1aa] capitalize">
                      {simState.phase === "idle" ? "Ready" : simState.phase}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-[#71717a]">
                      Overhead: {overheadPercentage}%
                    </span>
                    <span className="text-xs font-mono text-[#71717a]">
                      Step {simState.step}
                    </span>
                  </div>
                </div>

                <div className="p-4 sm:p-6">
                  {/* Sender / Transfer / Receiver layout */}
                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_180px_1fr] gap-4 lg:gap-6">
                    {/* ── Sender Side ── */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Monitor size={14} className="text-[#6366f1]" />
                        <span className="text-sm font-semibold">Sender</span>
                        <ArrowDown size={12} className="text-[#71717a] ml-auto" />
                        <span className="text-[10px] text-[#71717a]">Encapsulate</span>
                      </div>

                      <div className="space-y-1">
                        {OSI_LAYERS.map((layer, idx) => {
                          const isActive = simState.phase === "encapsulating" && simState.currentLayer === idx + 1;
                          const hasHeader = simState.senderHeaders[idx];
                          const isHighlighted = activeLayerHighlight === idx;
                          const isHovered = hoveredLayer === layer.id;
                          const isExpanded = expandedLayer === layer.id;

                          return (
                            <div key={layer.id}>
                              <motion.div
                                className="relative rounded-lg border overflow-hidden cursor-pointer"
                                style={{
                                  borderColor: isActive ? layer.color : isHighlighted ? `${layer.color}80` : "#1e1e2e",
                                  backgroundColor: isActive
                                    ? `${layer.color}15`
                                    : isHovered ? `${layer.color}08` : "#0a0a0f",
                                }}
                                animate={{
                                  scale: isActive ? 1.02 : 1,
                                  boxShadow: isActive
                                    ? `0 0 20px ${layer.color}30`
                                    : "none",
                                }}
                                transition={{ duration: 0.2 }}
                                onMouseEnter={() => setHoveredLayer(layer.id)}
                                onMouseLeave={() => setHoveredLayer(null)}
                                onClick={() => setExpandedLayer(isExpanded ? null : layer.id)}
                              >
                                <div className="flex items-center gap-2 px-3 py-2">
                                  {/* Layer number */}
                                  <span
                                    className="flex items-center justify-center w-6 h-6 rounded text-xs font-bold font-mono shrink-0"
                                    style={{ backgroundColor: `${layer.color}20`, color: layer.color }}
                                  >
                                    {layer.id}
                                  </span>

                                  {/* Layer info */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-semibold text-white truncate">{layer.name}</span>
                                      <span className="text-[10px] text-[#71717a] font-mono">{layer.dataUnit}</span>
                                    </div>
                                    <div className="flex items-center gap-1 mt-0.5">
                                      {layer.protocols.slice(0, 3).map((p) => (
                                        <span
                                          key={p}
                                          className="text-[9px] font-mono px-1 py-0.5 rounded"
                                          style={{
                                            backgroundColor: selectedProtocol === p ? `${layer.color}30` : `${layer.color}10`,
                                            color: selectedProtocol === p ? layer.color : `${layer.color}90`,
                                          }}
                                        >
                                          {p}
                                        </span>
                                      ))}
                                      {showLayerDetails && (
                                        <ChevronRight
                                          size={10}
                                          className="text-[#3a3a4e] ml-auto transition-transform"
                                          style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                                        />
                                      )}
                                    </div>
                                  </div>

                                  {/* Header indicator */}
                                  <AnimatePresence>
                                    {hasHeader && (
                                      <motion.div
                                        initial={{ opacity: 0, scale: 0.5, x: 10 }}
                                        animate={{ opacity: 1, scale: 1, x: 0 }}
                                        exit={{ opacity: 0, scale: 0.5, x: 10 }}
                                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-bold shrink-0"
                                        style={{ backgroundColor: `${layer.color}25`, color: layer.color }}
                                      >
                                        <Shield size={10} />
                                        {layer.headerLabel}
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              </motion.div>

                              {/* Expanded layer detail */}
                              <AnimatePresence>
                                {showLayerDetails && isExpanded && (
                                  <LayerDetailPanel layer={layer} isActive={isActive} />
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Transfer Animation ── */}
                    <div className="flex flex-col items-center justify-center">
                      <div className="text-xs text-[#71717a] mb-3 font-medium text-center">Network Transfer</div>

                      {/* Vertical transfer line */}
                      <div className="relative w-px h-64 bg-[#1e1e2e]">
                        {/* Animated dots along line */}
                        {simState.phase === "transferring" && (
                          <>
                            {[0, 0.25, 0.5, 0.75].map((offset) => (
                              <motion.div
                                key={offset}
                                className="absolute left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#6366f1]"
                                animate={{
                                  top: ["0%", "100%"],
                                  opacity: [0, 1, 1, 0],
                                }}
                                transition={{
                                  duration: 2,
                                  repeat: Infinity,
                                  delay: offset * 0.5,
                                  ease: "linear",
                                }}
                              />
                            ))}
                          </>
                        )}

                        {/* Transfer packet */}
                        <AnimatePresence>
                          {simState.phase === "transferring" && (
                            <motion.div
                              className="absolute left-1/2 -translate-x-1/2"
                              style={{ top: `${simState.transferProgress * 100}%` }}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                            >
                              <div className="relative">
                                <motion.div
                                  className="w-12 h-12 rounded-lg border-2 border-[#6366f1] flex items-center justify-center"
                                  style={{
                                    backgroundColor: "#6366f120",
                                    boxShadow: "0 0 20px rgba(99,102,241,0.3)",
                                  }}
                                  animate={{
                                    boxShadow: [
                                      "0 0 15px rgba(99,102,241,0.2)",
                                      "0 0 25px rgba(99,102,241,0.4)",
                                      "0 0 15px rgba(99,102,241,0.2)",
                                    ],
                                  }}
                                  transition={{ duration: 1, repeat: Infinity }}
                                >
                                  <Send size={16} className="text-[#6366f1]" />
                                </motion.div>

                                {/* Trail */}
                                <div
                                  className="absolute left-1/2 -translate-x-1/2 w-0.5 bg-gradient-to-t from-transparent to-[#6366f1]"
                                  style={{ bottom: "100%", height: "40px", opacity: 0.3 }}
                                />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Sender label */}
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2">
                          <Monitor size={14} className="text-[#6366f1]" />
                        </div>

                        {/* Receiver label */}
                        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2">
                          <Server size={14} className="text-[#10b981]" />
                        </div>
                      </div>

                      {/* Encapsulated data block */}
                      <div className="mt-6 w-full">
                        <div className="text-[10px] text-[#71717a] text-center mb-1.5">Packet Structure</div>
                        <div className="flex items-center justify-center gap-0.5 flex-wrap">
                          {OSI_LAYERS.slice().reverse().map((layer, idx) => {
                            const originalIdx = 6 - idx;
                            const hasHeader = simState.senderHeaders[originalIdx];
                            return (
                              <AnimatePresence key={layer.id}>
                                {hasHeader && (
                                  <motion.div
                                    initial={{ width: 0, opacity: 0 }}
                                    animate={{ width: "auto", opacity: 1 }}
                                    exit={{ width: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="flex items-center justify-center px-1.5 py-1 rounded text-[8px] font-mono font-bold overflow-hidden whitespace-nowrap"
                                    style={{
                                      backgroundColor: `${layer.color}20`,
                                      color: layer.color,
                                      border: `1px solid ${layer.color}40`,
                                    }}
                                  >
                                    {layer.headerLabel}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            );
                          })}
                          <div className="flex items-center justify-center px-2 py-1 rounded text-[8px] font-mono font-bold bg-[#1e1e2e] text-[#a1a1aa]">
                            DATA
                          </div>
                        </div>
                        {/* Size bar */}
                        <div className="mt-2">
                          <div className="h-1 rounded-full bg-[#1e1e2e] overflow-hidden">
                            <motion.div
                              className="h-full rounded-full bg-gradient-to-r from-[#6366f1] to-[#ef4444]"
                              animate={{ width: `${Math.min(100, (metrics.totalPacketSize / 300) * 100)}%` }}
                              transition={{ duration: 0.2 }}
                            />
                          </div>
                          <div className="text-[8px] font-mono text-[#71717a] text-center mt-0.5">
                            {metrics.totalPacketSize}B total
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ── Receiver Side ── */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Server size={14} className="text-[#10b981]" />
                        <span className="text-sm font-semibold">Receiver</span>
                        <ArrowUp size={12} className="text-[#71717a] ml-auto" />
                        <span className="text-[10px] text-[#71717a]">Decapsulate</span>
                      </div>

                      <div className="space-y-1">
                        {OSI_LAYERS.map((layer, idx) => {
                          const isActive = simState.phase === "decapsulating" && simState.currentLayer === idx;
                          const hasHeader = simState.receiverHeaders[idx];
                          const isHighlighted = activeLayerHighlight === idx;

                          return (
                            <motion.div
                              key={layer.id}
                              className="relative rounded-lg border overflow-hidden"
                              style={{
                                borderColor: isActive ? layer.color : isHighlighted ? `${layer.color}80` : "#1e1e2e",
                                backgroundColor: isActive ? `${layer.color}15` : "#0a0a0f",
                              }}
                              animate={{
                                scale: isActive ? 1.02 : 1,
                                boxShadow: isActive ? `0 0 20px ${layer.color}30` : "none",
                              }}
                              transition={{ duration: 0.2 }}
                            >
                              <div className="flex items-center gap-2 px-3 py-2">
                                <span
                                  className="flex items-center justify-center w-6 h-6 rounded text-xs font-bold font-mono shrink-0"
                                  style={{ backgroundColor: `${layer.color}20`, color: layer.color }}
                                >
                                  {layer.id}
                                </span>

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-white truncate">{layer.name}</span>
                                    <span className="text-[10px] text-[#71717a] font-mono">{layer.dataUnit}</span>
                                  </div>
                                </div>

                                {/* Header being stripped */}
                                <AnimatePresence>
                                  {hasHeader && (
                                    <motion.div
                                      initial={{ opacity: 1, scale: 1, x: 0 }}
                                      exit={{ opacity: 0, scale: 0.5, x: 20 }}
                                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-bold shrink-0"
                                      style={{ backgroundColor: `${layer.color}25`, color: layer.color }}
                                    >
                                      <Shield size={10} />
                                      {layer.headerLabel}
                                    </motion.div>
                                  )}
                                </AnimatePresence>

                                {/* Stripped indicator */}
                                {!hasHeader && simState.phase !== "idle" && (
                                  <motion.span
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="text-[10px] text-[#10b981] font-mono"
                                  >
                                    stripped
                                  </motion.span>
                                )}
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* ── OSI vs TCP/IP comparison ── */}
                  <div className="mt-8 pt-6 border-t border-[#1e1e2e]">
                    <div className="flex items-center gap-2 mb-4">
                      <Layers size={14} className="text-[#06b6d4]" />
                      <span className="text-sm font-semibold">OSI vs TCP/IP Comparison</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* OSI Model */}
                      <div>
                        <div className="text-xs text-[#71717a] font-medium mb-2 text-center">OSI Model (7 Layers)</div>
                        <div className="space-y-0.5">
                          {OSI_LAYERS.map((layer, idx) => (
                            <motion.div
                              key={layer.id}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg border"
                              style={{
                                borderColor: activeLayerHighlight === idx ? layer.color : "#1e1e2e",
                                backgroundColor: activeLayerHighlight === idx ? `${layer.color}10` : "#0a0a0f",
                              }}
                              animate={{ scale: activeLayerHighlight === idx ? 1.02 : 1 }}
                              transition={{ duration: 0.15 }}
                            >
                              <span
                                className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold font-mono"
                                style={{ backgroundColor: `${layer.color}20`, color: layer.color }}
                              >
                                {layer.id}
                              </span>
                              <span className="text-xs font-medium flex-1" style={{ color: layer.color }}>
                                {layer.name}
                              </span>
                              <span className="text-[9px] font-mono text-[#71717a]">{layer.dataUnit}</span>
                            </motion.div>
                          ))}
                        </div>
                      </div>

                      {/* TCP/IP Model */}
                      <div>
                        <div className="text-xs text-[#71717a] font-medium mb-2 text-center">TCP/IP Model (4 Layers)</div>
                        <div className="space-y-0.5">
                          {TCPIP_LAYERS.map((tcpLayer) => {
                            const layerHeight = tcpLayer.osiLayers.length;
                            const isActive = tcpLayer.osiLayers.some((id) => {
                              const osiIdx = OSI_LAYERS.findIndex((l) => l.id === id);
                              return activeLayerHighlight === osiIdx;
                            });

                            return (
                              <motion.div
                                key={tcpLayer.id}
                                className="flex items-center gap-2 px-3 rounded-lg border"
                                style={{
                                  borderColor: isActive ? tcpLayer.color : "#1e1e2e",
                                  backgroundColor: isActive ? `${tcpLayer.color}10` : "#0a0a0f",
                                  paddingTop: `${layerHeight * 8 + 8}px`,
                                  paddingBottom: `${layerHeight * 8 + 8}px`,
                                }}
                                animate={{ scale: isActive ? 1.02 : 1 }}
                                transition={{ duration: 0.15 }}
                              >
                                <span
                                  className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold font-mono shrink-0"
                                  style={{ backgroundColor: `${tcpLayer.color}20`, color: tcpLayer.color }}
                                >
                                  {tcpLayer.id}
                                </span>
                                <div className="flex-1">
                                  <span className="text-xs font-medium" style={{ color: tcpLayer.color }}>
                                    {tcpLayer.name}
                                  </span>
                                  <div className="text-[9px] text-[#71717a] mt-0.5">
                                    {tcpLayer.description}
                                  </div>
                                </div>
                                <span className="text-[9px] font-mono text-[#71717a] shrink-0">
                                  L{tcpLayer.osiLayers.join(",")}
                                </span>
                              </motion.div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Mapping lines visual */}
                    <div className="mt-4 p-3 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]">
                      <div className="text-[10px] text-[#71717a] mb-2 font-medium">Layer Mapping</div>
                      <div className="grid grid-cols-7 gap-1">
                        {OSI_LAYERS.map((layer) => (
                          <div key={layer.id} className="text-center">
                            <div
                              className="h-1 rounded-full mb-1"
                              style={{ backgroundColor: layer.color }}
                            />
                            <span className="text-[8px] font-mono" style={{ color: layer.color }}>
                              L{layer.id}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-1 mt-2 text-[8px] text-[#71717a]">
                        <Cable size={9} className="shrink-0" />
                        <span>OSI Layers 5-7 map to TCP/IP Application | L4 to Transport | L3 to Internet | L1-2 to Network Access</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* ── Right column: Metrics + Event Log ── */}
            <div className="space-y-4">
              {/* ── Metrics Panel ── */}
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
                        <span className="text-sm font-medium text-[#a1a1aa]">Metrics</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <MetricCard label="Current Layer" value={metrics.currentLayerName} color="#6366f1" />
                        <MetricCard label="Headers Added" value={`${metrics.activeHeaders}/7`} color="#f59e0b" />
                        <MetricCard label="Packet Size" value={`${metrics.totalPacketSize}B`} color="#06b6d4" />
                        <MetricCard label="Overhead" value={`${overheadPercentage}%`} color="#ef4444" />
                      </div>

                      {/* Protocol stack display */}
                      <div className="mt-1">
                        <div className="text-[9px] text-[#71717a] uppercase tracking-wider mb-1">Protocol Stack</div>
                        <div className="p-2 rounded bg-[#0a0a0f] border border-[#1e1e2e]">
                          <span className="text-[10px] font-mono text-[#10b981]">
                            {metrics.protocolStack}
                          </span>
                        </div>
                      </div>

                      {/* Layer progress bar */}
                      <div>
                        <div className="text-[9px] text-[#71717a] uppercase tracking-wider mb-1">Encapsulation Progress</div>
                        <div className="flex items-center gap-0.5">
                          {OSI_LAYERS.map((layer, idx) => (
                            <motion.div
                              key={layer.id}
                              className="flex-1 h-2 rounded-sm"
                              style={{
                                backgroundColor: simState.senderHeaders[idx] ? layer.color : "#1e1e2e",
                              }}
                              animate={{
                                opacity: simState.senderHeaders[idx] ? 1 : 0.3,
                              }}
                              transition={{ duration: 0.2 }}
                            />
                          ))}
                        </div>
                        <div className="flex justify-between mt-0.5">
                          <span className="text-[7px] font-mono text-[#6366f1]">L7</span>
                          <span className="text-[7px] font-mono text-[#ef4444]">L1</span>
                        </div>
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
                style={{ height: showMetrics ? "380px" : "560px" }}
              >
                <div className="flex items-center gap-2 p-3 border-b border-[#1e1e2e]">
                  <div className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
                  <span className="text-sm font-medium text-[#a1a1aa]">Event Log</span>
                  <span className="text-[10px] font-mono text-[#71717a] ml-auto">
                    {eventLog.length} events
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-0.5 scrollbar-thin">
                  {eventLog.length === 0 && (
                    <div className="flex items-center justify-center h-full text-xs text-[#71717a]">
                      Press Play or select a scenario to begin
                    </div>
                  )}
                  {eventLog.map((evt) => (
                    <motion.div
                      key={evt.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.15 }}
                      className="flex items-start gap-2 px-2 py-1 rounded hover:bg-[#ffffff04] group"
                    >
                      <div
                        className="w-1.5 h-1.5 rounded-full shrink-0 mt-1"
                        style={{ backgroundColor: evt.color }}
                      />
                      <span
                        className="text-[10px] font-mono leading-snug break-all"
                        style={{ color: evt.color }}
                      >
                        {evt.message}
                      </span>
                    </motion.div>
                  ))}
                  <div ref={eventLogEndRef} />
                </div>
              </motion.div>
            </div>
          </div>

          {/* ── Controls ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-4 mb-4"
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
              {/* Phase badge */}
              <div className="flex items-center gap-1.5">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={simState.phase}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg ${
                      simState.phase === "complete"
                        ? "bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/20"
                        : simState.phase === "idle"
                        ? "bg-[#1e1e2e] text-[#71717a] border border-[#1e1e2e]"
                        : "bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/20"
                    }`}
                  >
                    {simState.phase === "idle" ? "Ready" : simState.phase}
                  </motion.span>
                </AnimatePresence>
              </div>
            </ModuleControls>
          </motion.div>

          {/* ── Info Section ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4 mb-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} className="text-[#14b8a6]" />
              <span className="text-sm font-medium text-[#a1a1aa]">How It Works</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-[#71717a]">
              <div>
                <div className="text-white font-medium mb-1 flex items-center gap-1.5">
                  <ArrowDown size={11} className="text-[#6366f1]" />
                  Encapsulation
                </div>
                <p>Data starts at the Application layer. Each layer adds its own header (and sometimes trailer)
                  as it moves down the stack. By the Physical layer, the original data is wrapped in all protocol headers.</p>
              </div>
              <div>
                <div className="text-white font-medium mb-1 flex items-center gap-1.5">
                  <Wifi size={11} className="text-[#f59e0b]" />
                  Transfer
                </div>
                <p>The fully encapsulated packet (now a frame at Layer 2, then bits at Layer 1) travels across the
                  physical medium -- copper wire, fiber optic cable, or wireless signals.</p>
              </div>
              <div>
                <div className="text-white font-medium mb-1 flex items-center gap-1.5">
                  <ArrowUp size={11} className="text-[#10b981]" />
                  Decapsulation
                </div>
                <p>At the receiver, each layer strips its corresponding header as data moves up the stack. The
                  Application layer receives the original data, now fully unpacked.</p>
              </div>
            </div>
          </motion.div>

          {/* ── Layer reference table ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
            className="rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-2">
                <Info size={14} className="text-[#6366f1]" />
                <span className="text-sm font-semibold text-white">Layer Reference</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1e1e2e]">
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Layer</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Name</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">PDU</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">TCP/IP</th>
                    <th className="px-4 py-2 text-left font-medium text-[#71717a]">Responsibility</th>
                  </tr>
                </thead>
                <tbody>
                  {OSI_LAYERS.map((layer, idx) => {
                    const isActive = activeLayerHighlight === idx;
                    return (
                      <tr
                        key={layer.id}
                        className="border-b border-[#1e1e2e]/50"
                        style={{
                          backgroundColor: isActive ? `${layer.color}08` : "transparent",
                        }}
                      >
                        <td className="px-4 py-2">
                          <span
                            className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold font-mono"
                            style={{ backgroundColor: `${layer.color}20`, color: layer.color }}
                          >
                            {layer.id}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-medium" style={{ color: layer.color }}>
                          {layer.name}
                        </td>
                        <td className="px-4 py-2 font-mono text-[#a1a1aa]">{layer.dataUnit}</td>
                        <td className="px-4 py-2 text-[#71717a]">{layer.tcpipName}</td>
                        <td className="px-4 py-2 text-[#71717a] max-w-xs">{layer.responsibility}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
