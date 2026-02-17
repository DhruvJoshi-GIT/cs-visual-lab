"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Server,
  Plus,
  Minus,
  Key,
  Network,
  Activity,
  Zap,
  BarChart3,
  Hash,
  Circle,
  RefreshCw,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

/* ═══════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════ */

interface ServerNode {
  id: string;
  label: string;
  color: string;
  hashPosition: number; // 0 to 1 (normalized from 0 to 2^32-1)
  virtualNodes: VirtualNode[];
  alive: boolean;
}

interface VirtualNode {
  id: string;
  parentId: string;
  label: string;
  hashPosition: number;
  color: string;
}

interface KeyItem {
  id: string;
  key: string;
  hashPosition: number;
  assignedNode: string;
  color: string;
  justMoved: boolean;
}

interface EventLogEntry {
  id: number;
  message: string;
  type: "add-node" | "remove-node" | "add-key" | "move-key" | "info";
}

interface SimulationState {
  phase: "idle" | "running" | "complete";
  step: number;
  autoActions: AutoAction[];
  autoIndex: number;
}

type AutoAction =
  | { type: "add-key"; key: string }
  | { type: "add-node"; label: string }
  | { type: "remove-node"; label: string }
  | { type: "toggle-vnodes" };

const HASH_SPACE = Math.pow(2, 32);

const SERVER_COLORS = [
  "#6366f1", // indigo
  "#06b6d4", // cyan
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#14b8a6", // teal
];

const SCENARIOS = [
  { id: "3-nodes", label: "3 Nodes", description: "Basic 3-node ring" },
  { id: "add-node", label: "Add Node", description: "Add a node and watch redistribution" },
  { id: "remove-node", label: "Remove Node", description: "Remove a node and see key migration" },
  { id: "virtual-nodes", label: "Virtual Nodes", description: "Enable virtual nodes for better balance" },
];

const SAMPLE_KEYS = [
  "user:1001", "user:1002", "user:1003", "session:abc", "session:def",
  "cache:img1", "cache:img2", "data:pageA", "data:pageB", "data:pageC",
  "user:1004", "session:ghi", "cache:img3", "data:pageD", "user:1005",
];

const VNODES_PER_SERVER = 3;
const DOMAIN_COLOR = "#ef4444";

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */

let eventIdCounter = 0;

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash) / 2147483647; // normalize to 0-1
}

function hashToAngle(pos: number): number {
  return pos * 360;
}

function hashToXY(pos: number, cx: number, cy: number, radius: number): { x: number; y: number } {
  const angle = (pos * 2 * Math.PI) - Math.PI / 2; // start from top
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function findAssignedNode(
  keyPos: number,
  allPositions: { id: string; parentId: string; position: number }[]
): string {
  if (allPositions.length === 0) return "";
  // Sort positions
  const sorted = [...allPositions].sort((a, b) => a.position - b.position);
  // Find first position >= keyPos (clockwise)
  for (const p of sorted) {
    if (p.position >= keyPos) return p.parentId;
  }
  // Wrap around to first
  return sorted[0].parentId;
}

function createServer(
  id: string,
  label: string,
  colorIndex: number,
  useVirtualNodes: boolean
): ServerNode {
  const color = SERVER_COLORS[colorIndex % SERVER_COLORS.length];
  const hashPosition = simpleHash(label);
  const virtualNodes: VirtualNode[] = [];

  if (useVirtualNodes) {
    for (let i = 0; i < VNODES_PER_SERVER; i++) {
      virtualNodes.push({
        id: `${id}-vn${i}`,
        parentId: id,
        label: `${label}-vn${i}`,
        hashPosition: simpleHash(`${label}-vnode-${i}`),
        color,
      });
    }
  }

  return {
    id,
    label,
    color,
    hashPosition,
    virtualNodes,
    alive: true,
  };
}

function getAllPositions(servers: ServerNode[]): { id: string; parentId: string; position: number }[] {
  const positions: { id: string; parentId: string; position: number }[] = [];
  for (const server of servers) {
    if (!server.alive) continue;
    positions.push({ id: server.id, parentId: server.id, position: server.hashPosition });
    for (const vn of server.virtualNodes) {
      positions.push({ id: vn.id, parentId: server.id, position: vn.hashPosition });
    }
  }
  return positions;
}

function reassignKeys(keys: KeyItem[], servers: ServerNode[]): KeyItem[] {
  const positions = getAllPositions(servers);
  return keys.map((key) => {
    const newAssigned = findAssignedNode(key.hashPosition, positions);
    const server = servers.find((s) => s.id === newAssigned);
    return {
      ...key,
      assignedNode: newAssigned,
      color: server?.color || "#71717a",
      justMoved: key.assignedNode !== "" && key.assignedNode !== newAssigned,
    };
  });
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function ConsistentHashingPage() {
  /* ─── Core state ─── */
  const [servers, setServers] = useState<ServerNode[]>([]);
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [useVirtualNodes, setUseVirtualNodes] = useState(false);
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [activeScenario, setActiveScenario] = useState("3-nodes");
  const [keyInput, setKeyInput] = useState("");
  const [keysRedistributed, setKeysRedistributed] = useState(0);
  const [totalKeysEverAdded, setTotalKeysEverAdded] = useState(0);
  const [serverCounter, setServerCounter] = useState(0);
  const [sim, setSim] = useState<SimulationState>({
    phase: "idle",
    step: 0,
    autoActions: [],
    autoIndex: 0,
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
  const serversRef = useRef(servers);
  const keysRef = useRef(keys);
  const simRef = useRef(sim);
  const serverCounterRef = useRef(serverCounter);
  const useVirtualNodesRef = useRef(useVirtualNodes);

  serversRef.current = servers;
  keysRef.current = keys;
  simRef.current = sim;
  serverCounterRef.current = serverCounter;
  useVirtualNodesRef.current = useVirtualNodes;

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { eventsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [events.length]);

  /* ─── Add event ─── */
  const addEvent = useCallback((message: string, type: EventLogEntry["type"]) => {
    setEvents((prev) => [...prev, { id: ++eventIdCounter, message, type }].slice(-200));
  }, []);

  /* ─── Add server ─── */
  const addServer = useCallback((label?: string) => {
    const count = serverCounterRef.current + 1;
    setServerCounter(count);
    const serverLabel = label || `S${count}`;
    const newServer = createServer(
      `server-${count}`,
      serverLabel,
      count - 1,
      useVirtualNodesRef.current
    );

    setServers((prev) => {
      const updated = [...prev, newServer];
      // Reassign keys
      setKeys((prevKeys) => {
        const reassigned = reassignKeys(prevKeys, updated);
        const moved = reassigned.filter((k) => k.justMoved).length;
        if (moved > 0) {
          setKeysRedistributed((r) => r + moved);
          addEvent(`${moved} key(s) redistributed due to new node ${serverLabel}`, "move-key");
        }
        setTimeout(() => {
          setKeys((k) => k.map((kk) => ({ ...kk, justMoved: false })));
        }, 1500);
        return reassigned;
      });
      return updated;
    });

    addEvent(
      `Added node ${serverLabel} at position ${(newServer.hashPosition * 100).toFixed(1)}%${
        newServer.virtualNodes.length > 0
          ? ` (+${newServer.virtualNodes.length} virtual nodes)`
          : ""
      }`,
      "add-node"
    );
  }, [addEvent]);

  /* ─── Remove server ─── */
  const removeServer = useCallback((serverId: string) => {
    setServers((prev) => {
      const serverToRemove = prev.find((s) => s.id === serverId);
      if (!serverToRemove) return prev;
      const updated = prev.filter((s) => s.id !== serverId);
      addEvent(`Removed node ${serverToRemove.label}`, "remove-node");

      // Reassign keys
      setKeys((prevKeys) => {
        const reassigned = reassignKeys(prevKeys, updated);
        const moved = reassigned.filter((k) => k.justMoved).length;
        if (moved > 0) {
          setKeysRedistributed((r) => r + moved);
          addEvent(
            `${moved} key(s) migrated from ${serverToRemove.label} to next clockwise node`,
            "move-key"
          );
        }
        setTimeout(() => {
          setKeys((k) => k.map((kk) => ({ ...kk, justMoved: false })));
        }, 1500);
        return reassigned;
      });

      return updated;
    });
  }, [addEvent]);

  /* ─── Add key ─── */
  const addKey = useCallback((keyStr: string) => {
    const currentServers = serversRef.current;
    if (currentServers.length === 0) {
      addEvent(`Cannot add key "${keyStr}": no servers on ring`, "info");
      return;
    }

    const hashPos = simpleHash(keyStr);
    const positions = getAllPositions(currentServers);
    const assignedId = findAssignedNode(hashPos, positions);
    const assignedServer = currentServers.find((s) => s.id === assignedId);

    const newKey: KeyItem = {
      id: `key-${Date.now()}-${keyStr}`,
      key: keyStr,
      hashPosition: hashPos,
      assignedNode: assignedId,
      color: assignedServer?.color || "#71717a",
      justMoved: false,
    };

    setKeys((prev) => [...prev, newKey]);
    setTotalKeysEverAdded((t) => t + 1);
    addEvent(
      `Key "${keyStr}" -> hash ${(hashPos * 100).toFixed(1)}% -> assigned to ${assignedServer?.label || "?"}`,
      "add-key"
    );
  }, [addEvent]);

  /* ─── Toggle virtual nodes ─── */
  const toggleVirtualNodes = useCallback(() => {
    setUseVirtualNodes((prev) => {
      const next = !prev;
      // Rebuild all servers with/without virtual nodes
      setServers((prevServers) => {
        const updated = prevServers.map((s, i) => {
          const vns: VirtualNode[] = [];
          if (next) {
            for (let j = 0; j < VNODES_PER_SERVER; j++) {
              vns.push({
                id: `${s.id}-vn${j}`,
                parentId: s.id,
                label: `${s.label}-vn${j}`,
                hashPosition: simpleHash(`${s.label}-vnode-${j}`),
                color: s.color,
              });
            }
          }
          return { ...s, virtualNodes: vns };
        });

        // Reassign keys
        setKeys((prevKeys) => {
          const reassigned = reassignKeys(prevKeys, updated);
          const moved = reassigned.filter((k) => k.justMoved).length;
          if (moved > 0) {
            setKeysRedistributed((r) => r + moved);
            addEvent(
              `Virtual nodes ${next ? "enabled" : "disabled"}: ${moved} key(s) redistributed`,
              "move-key"
            );
          }
          setTimeout(() => {
            setKeys((k) => k.map((kk) => ({ ...kk, justMoved: false })));
          }, 1500);
          return reassigned;
        });

        return updated;
      });
      addEvent(`Virtual nodes ${next ? "enabled" : "disabled"} (${VNODES_PER_SERVER} per server)`, "info");
      return next;
    });
  }, [addEvent]);

  /* ─── Step forward ─── */
  const stepForward = useCallback(() => {
    const currentSim = simRef.current;

    if (currentSim.phase === "idle") {
      // Build action queue based on scenario
      let actions: AutoAction[] = [];
      switch (activeScenario) {
        case "3-nodes":
          actions = [
            { type: "add-node", label: "S1" },
            { type: "add-node", label: "S2" },
            { type: "add-node", label: "S3" },
            ...SAMPLE_KEYS.slice(0, 8).map((k) => ({ type: "add-key" as const, key: k })),
          ];
          break;
        case "add-node":
          actions = [
            { type: "add-node", label: "S1" },
            { type: "add-node", label: "S2" },
            { type: "add-node", label: "S3" },
            ...SAMPLE_KEYS.slice(0, 10).map((k) => ({ type: "add-key" as const, key: k })),
            { type: "add-node", label: "S4" },
            ...SAMPLE_KEYS.slice(10, 13).map((k) => ({ type: "add-key" as const, key: k })),
          ];
          break;
        case "remove-node":
          actions = [
            { type: "add-node", label: "S1" },
            { type: "add-node", label: "S2" },
            { type: "add-node", label: "S3" },
            { type: "add-node", label: "S4" },
            ...SAMPLE_KEYS.slice(0, 12).map((k) => ({ type: "add-key" as const, key: k })),
            { type: "remove-node", label: "S2" },
          ];
          break;
        case "virtual-nodes":
          actions = [
            { type: "add-node", label: "S1" },
            { type: "add-node", label: "S2" },
            { type: "add-node", label: "S3" },
            ...SAMPLE_KEYS.slice(0, 10).map((k) => ({ type: "add-key" as const, key: k })),
            { type: "toggle-vnodes" },
            ...SAMPLE_KEYS.slice(10, 15).map((k) => ({ type: "add-key" as const, key: k })),
          ];
          break;
      }
      setSim({
        phase: "running",
        step: 0,
        autoActions: actions,
        autoIndex: 0,
      });
      addEvent(`Scenario: ${SCENARIOS.find((s) => s.id === activeScenario)?.label}`, "info");
      return;
    }

    if (currentSim.phase === "complete") return;

    const idx = currentSim.autoIndex;
    if (idx >= currentSim.autoActions.length) {
      setSim((prev) => ({ ...prev, phase: "complete" }));
      setIsPlaying(false);
      return;
    }

    const action = currentSim.autoActions[idx];
    switch (action.type) {
      case "add-node":
        addServer(action.label);
        break;
      case "remove-node": {
        const server = serversRef.current.find((s) => s.label === action.label);
        if (server) removeServer(server.id);
        break;
      }
      case "add-key":
        addKey(action.key);
        break;
      case "toggle-vnodes":
        toggleVirtualNodes();
        break;
    }

    setSim((prev) => ({ ...prev, autoIndex: prev.autoIndex + 1, step: prev.step + 1 }));
  }, [activeScenario, addServer, removeServer, addKey, toggleVirtualNodes, addEvent]);

  /* ─── Animation loop ─── */
  const animationLoop = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) return;
    const interval = Math.max(10, 700 / speedRef.current);
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
    eventIdCounter = 0;
    setServers([]);
    setKeys([]);
    setUseVirtualNodes(false);
    setEvents([]);
    setKeysRedistributed(0);
    setTotalKeysEverAdded(0);
    setServerCounter(0);
    setSim({ phase: "idle", step: 0, autoActions: [], autoIndex: 0 });
    setKeyInput("");
  }, []);

  const handleScenarioSelect = useCallback((id: string) => {
    handleReset();
    setActiveScenario(id);
  }, [handleReset]);

  /* ─── Manual add key ─── */
  const handleAddKey = useCallback(() => {
    if (!keyInput.trim()) return;
    addKey(keyInput.trim());
    setKeyInput("");
  }, [keyInput, addKey]);

  /* ─── Computed metrics ─── */
  const metrics = useMemo(() => {
    const keysPerNode: Record<string, number> = {};
    for (const s of servers) {
      keysPerNode[s.id] = 0;
    }
    for (const k of keys) {
      if (keysPerNode[k.assignedNode] !== undefined) {
        keysPerNode[k.assignedNode]++;
      }
    }
    const counts = Object.values(keysPerNode);
    const min = counts.length > 0 ? Math.min(...counts) : 0;
    const max = counts.length > 0 ? Math.max(...counts) : 0;
    const avg = counts.length > 0 ? (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1) : "0";

    return {
      nodeCount: servers.length,
      keyCount: keys.length,
      min,
      max,
      avg,
      keysPerNode,
      redistributed: keysRedistributed,
      virtualNodes: useVirtualNodes,
    };
  }, [servers, keys, keysRedistributed, useVirtualNodes]);

  /* ─── SVG dimensions ─── */
  const svgSize = 480;
  const cx = svgSize / 2;
  const cy = svgSize / 2;
  const ringRadius = 180;
  const nodeRadius = 16;
  const keyRadius = 6;

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
                7.4
              </span>
              <div className="flex items-center gap-1.5 text-xs text-[#71717a]">
                <Network size={12} />
                <span>Distributed Systems</span>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Consistent Hashing
            </h1>
            <p className="mt-1.5 text-[#a1a1aa] text-sm sm:text-base max-w-2xl">
              Hash ring, key assignment, minimal redistribution on node changes, and virtual nodes for load balancing
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
                <input
                  type="text"
                  placeholder="Key name"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddKey()}
                  className="px-3 py-1.5 rounded-lg bg-[#111118] border border-[#1e1e2e] text-sm font-mono text-white placeholder-[#71717a] w-32 focus:outline-none focus:border-[#6366f1]"
                />
                <button
                  onClick={handleAddKey}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#06b6d4]/15 border border-[#06b6d4]/30 text-[#06b6d4] hover:bg-[#06b6d4]/25 transition-all"
                >
                  <Key size={12} />
                  Add Key
                </button>
                <button
                  onClick={() => addServer()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#10b981]/15 border border-[#10b981]/30 text-[#10b981] hover:bg-[#10b981]/25 transition-all"
                >
                  <Plus size={12} />
                  Add Node
                </button>
                {servers.length > 0 && (
                  <button
                    onClick={() => removeServer(servers[servers.length - 1].id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#ef4444]/15 border border-[#ef4444]/30 text-[#ef4444] hover:bg-[#ef4444]/25 transition-all"
                  >
                    <Minus size={12} />
                    Remove Node
                  </button>
                )}
                <button
                  onClick={toggleVirtualNodes}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    useVirtualNodes
                      ? "bg-[#f59e0b]/15 border border-[#f59e0b]/30 text-[#f59e0b]"
                      : "bg-[#1e1e2e] border border-transparent text-[#71717a] hover:bg-[#2a2a3e] hover:text-white"
                  }`}
                >
                  <RefreshCw size={12} />
                  Virtual Nodes {useVirtualNodes ? "ON" : "OFF"}
                </button>
              </motion.div>

              {/* ── Hash Ring Visualization ── */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden"
              >
                <svg viewBox={`0 0 ${svgSize} ${svgSize}`} className="w-full" style={{ maxHeight: "520px" }}>
                  <defs>
                    <filter id="glow-ring" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                      <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  {/* Background grid */}
                  <pattern id="ch-grid" width="30" height="30" patternUnits="userSpaceOnUse">
                    <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e1e2e" strokeWidth="0.5" opacity="0.3" />
                  </pattern>
                  <rect width="100%" height="100%" fill="url(#ch-grid)" />

                  {/* Ring */}
                  <circle cx={cx} cy={cy} r={ringRadius} fill="none" stroke="#1e1e2e" strokeWidth="2" />

                  {/* Hash position markers (subtle ticks every 25%) */}
                  {[0, 0.25, 0.5, 0.75].map((pos) => {
                    const p = hashToXY(pos, cx, cy, ringRadius);
                    const outer = hashToXY(pos, cx, cy, ringRadius + 8);
                    return (
                      <g key={pos}>
                        <line x1={p.x} y1={p.y} x2={outer.x} y2={outer.y} stroke="#71717a" strokeWidth="1" opacity="0.3" />
                        <text
                          x={hashToXY(pos, cx, cy, ringRadius + 18).x}
                          y={hashToXY(pos, cx, cy, ringRadius + 18).y + 3}
                          textAnchor="middle"
                          fill="#71717a"
                          fontSize="8"
                          fontFamily="monospace"
                          opacity="0.5"
                        >
                          {(pos * 100).toFixed(0)}%
                        </text>
                      </g>
                    );
                  })}

                  {/* Key-to-node assignment arcs */}
                  {keys.map((key) => {
                    const keyXY = hashToXY(key.hashPosition, cx, cy, ringRadius);
                    const server = servers.find((s) => s.id === key.assignedNode);
                    if (!server) return null;
                    const positions = getAllPositions(servers);
                    const assignedPos = positions.find(
                      (p) => p.parentId === key.assignedNode &&
                        p.position >= key.hashPosition
                    ) || positions.sort((a, b) => a.position - b.position)[0];
                    if (!assignedPos) return null;

                    return (
                      <motion.line
                        key={key.id}
                        x1={keyXY.x}
                        y1={keyXY.y}
                        x2={hashToXY(assignedPos.position, cx, cy, ringRadius).x}
                        y2={hashToXY(assignedPos.position, cx, cy, ringRadius).y}
                        stroke={server.color}
                        strokeWidth="0.5"
                        opacity="0.2"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.5 }}
                      />
                    );
                  })}

                  {/* Virtual nodes */}
                  <AnimatePresence>
                    {servers.map((server) =>
                      server.virtualNodes.map((vn) => {
                        const pos = hashToXY(vn.hashPosition, cx, cy, ringRadius);
                        return (
                          <motion.g
                            key={vn.id}
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                          >
                            <circle cx={pos.x} cy={pos.y} r={6} fill="#0a0a0f" stroke={server.color} strokeWidth="1.5" strokeDasharray="2 2" />
                            <text
                              x={pos.x}
                              y={pos.y + 3}
                              textAnchor="middle"
                              fill={server.color}
                              fontSize="5"
                              fontFamily="monospace"
                              fontWeight="bold"
                            >
                              v
                            </text>
                          </motion.g>
                        );
                      })
                    )}
                  </AnimatePresence>

                  {/* Keys */}
                  <AnimatePresence>
                    {keys.map((key) => {
                      const pos = hashToXY(key.hashPosition, cx, cy, ringRadius);
                      return (
                        <motion.g
                          key={key.id}
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{
                            scale: 1,
                            opacity: 1,
                          }}
                          exit={{ scale: 0, opacity: 0 }}
                          transition={{ duration: 0.3 }}
                        >
                          {key.justMoved && (
                            <motion.circle
                              cx={pos.x}
                              cy={pos.y}
                              r={keyRadius + 6}
                              fill="none"
                              stroke="#f59e0b"
                              strokeWidth="2"
                              initial={{ scale: 0.5, opacity: 1 }}
                              animate={{ scale: 2, opacity: 0 }}
                              transition={{ duration: 1 }}
                            />
                          )}
                          <circle
                            cx={pos.x}
                            cy={pos.y}
                            r={keyRadius}
                            fill={key.color}
                            opacity={0.8}
                          />
                          <circle cx={pos.x} cy={pos.y} r={keyRadius - 2} fill="white" opacity={0.2} />
                        </motion.g>
                      );
                    })}
                  </AnimatePresence>

                  {/* Server nodes */}
                  <AnimatePresence>
                    {servers.map((server) => {
                      const pos = hashToXY(server.hashPosition, cx, cy, ringRadius);
                      return (
                        <motion.g
                          key={server.id}
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                          transition={{ duration: 0.4, type: "spring" }}
                        >
                          {/* Glow */}
                          <circle cx={pos.x} cy={pos.y} r={nodeRadius + 4} fill={server.color} opacity={0.15} />
                          {/* Node */}
                          <circle cx={pos.x} cy={pos.y} r={nodeRadius} fill="#0a0a0f" stroke={server.color} strokeWidth="2.5" filter="url(#glow-ring)" />
                          <circle cx={pos.x} cy={pos.y} r={nodeRadius - 2} fill={server.color} opacity={0.1} />
                          {/* Label */}
                          <text
                            x={pos.x}
                            y={pos.y + 1}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fill="white"
                            fontSize="11"
                            fontWeight="700"
                            fontFamily="monospace"
                          >
                            {server.label}
                          </text>
                          {/* Key count badge */}
                          {metrics.keysPerNode[server.id] > 0 && (
                            <>
                              <circle cx={pos.x + nodeRadius - 2} cy={pos.y - nodeRadius + 2} r={7} fill={server.color} />
                              <text
                                x={pos.x + nodeRadius - 2}
                                y={pos.y - nodeRadius + 5.5}
                                textAnchor="middle"
                                fill="white"
                                fontSize="8"
                                fontWeight="700"
                                fontFamily="monospace"
                              >
                                {metrics.keysPerNode[server.id]}
                              </text>
                            </>
                          )}
                        </motion.g>
                      );
                    })}
                  </AnimatePresence>

                  {/* Center label */}
                  <text x={cx} y={cy - 6} textAnchor="middle" fill="#71717a" fontSize="10" fontFamily="sans-serif" opacity="0.6">
                    Hash Ring
                  </text>
                  <text x={cx} y={cy + 8} textAnchor="middle" fill="#71717a" fontSize="8" fontFamily="monospace" opacity="0.4">
                    0 ... 2^32
                  </text>
                </svg>
              </motion.div>

              {/* ── Key Distribution Bar Chart ── */}
              {servers.length > 0 && keys.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.15 }}
                  className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 size={14} className="text-[#ef4444]" />
                    <span className="text-sm font-medium text-[#a1a1aa]">
                      Key Distribution
                    </span>
                    <span className="text-[10px] text-[#71717a] ml-auto">
                      {useVirtualNodes ? `with ${VNODES_PER_SERVER} vnodes each` : "no virtual nodes"}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {servers.map((server) => {
                      const count = metrics.keysPerNode[server.id] || 0;
                      const maxCount = Math.max(...Object.values(metrics.keysPerNode), 1);
                      return (
                        <div key={server.id} className="flex items-center gap-2">
                          <span
                            className="text-[10px] font-mono font-bold w-8 shrink-0"
                            style={{ color: server.color }}
                          >
                            {server.label}
                          </span>
                          <div className="flex-1 h-4 rounded bg-[#0a0a0f] overflow-hidden">
                            <motion.div
                              animate={{ width: `${(count / maxCount) * 100}%` }}
                              transition={{ duration: 0.4 }}
                              className="h-full rounded"
                              style={{ backgroundColor: server.color, minWidth: count > 0 ? "8px" : "0px" }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-[#a1a1aa] w-6 text-right">
                            {count}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
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
                        <MetricCard label="Nodes" value={String(metrics.nodeCount)} color="#10b981" />
                        <MetricCard label="Keys" value={String(metrics.keyCount)} color="#06b6d4" />
                        <MetricCard label="Min Keys" value={String(metrics.min)} color="#6366f1" />
                        <MetricCard label="Max Keys" value={String(metrics.max)} color="#f59e0b" />
                        <MetricCard label="Avg Keys" value={metrics.avg} color="#a1a1aa" />
                        <MetricCard label="Redistributed" value={String(metrics.redistributed)} color="#ef4444" />
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
                  <div className="w-2 h-2 rounded-full bg-[#ef4444] animate-pulse" />
                  <span className="text-sm font-medium text-[#a1a1aa]">Event Log</span>
                  <span className="text-[10px] font-mono text-[#71717a] ml-auto">{events.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-0.5 scrollbar-thin">
                  {events.length === 0 && (
                    <div className="flex items-center justify-center h-full text-xs text-[#71717a]">
                      Press Play or add nodes/keys
                    </div>
                  )}
                  {events.map((evt) => {
                    const color =
                      evt.type === "add-node" ? "#10b981"
                        : evt.type === "remove-node" ? "#ef4444"
                          : evt.type === "add-key" ? "#06b6d4"
                            : evt.type === "move-key" ? "#f59e0b"
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

              {/* ── Key Assignment Table ── */}
              {keys.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.28 }}
                  className="rounded-xl border border-[#1e1e2e] bg-[#111118] flex flex-col"
                  style={{ maxHeight: "260px" }}
                >
                  <div className="flex items-center gap-2 p-3 border-b border-[#1e1e2e]">
                    <Key size={14} className="text-[#06b6d4]" />
                    <span className="text-sm font-medium text-[#a1a1aa]">
                      Key Assignments
                    </span>
                    <span className="text-[10px] font-mono text-[#71717a] ml-auto">
                      {keys.length} keys
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2">
                    <table className="w-full text-[10px] font-mono">
                      <thead>
                        <tr className="text-[#71717a]">
                          <th className="text-left px-2 py-1">Key</th>
                          <th className="text-left px-2 py-1">Hash %</th>
                          <th className="text-left px-2 py-1">Node</th>
                        </tr>
                      </thead>
                      <tbody>
                        {keys.map((key) => {
                          const server = servers.find((s) => s.id === key.assignedNode);
                          return (
                            <motion.tr
                              key={key.id}
                              animate={{
                                backgroundColor: key.justMoved
                                  ? "rgba(245,158,11,0.1)"
                                  : "transparent",
                              }}
                              className="border-b border-[#1e1e2e]/30"
                            >
                              <td className="px-2 py-1 text-[#a1a1aa]">{key.key}</td>
                              <td className="px-2 py-1 text-[#71717a]">
                                {(key.hashPosition * 100).toFixed(1)}%
                              </td>
                              <td className="px-2 py-1" style={{ color: server?.color || "#71717a" }}>
                                {server?.label || "?"}
                                {key.justMoved && (
                                  <span className="ml-1 text-[#f59e0b]">moved</span>
                                )}
                              </td>
                            </motion.tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}

              {/* ── Node Positions ── */}
              {servers.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.29 }}
                  className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Server size={14} className="text-[#10b981]" />
                    <span className="text-sm font-medium text-[#a1a1aa]">
                      Node Positions
                    </span>
                  </div>
                  <div className="space-y-2">
                    {servers.map((server) => (
                      <div key={server.id} className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: server.color }}
                        />
                        <span
                          className="text-xs font-mono font-bold w-8"
                          style={{ color: server.color }}
                        >
                          {server.label}
                        </span>
                        <span className="text-[10px] font-mono text-[#71717a]">
                          @ {(server.hashPosition * 100).toFixed(1)}%
                        </span>
                        {server.virtualNodes.length > 0 && (
                          <span className="text-[9px] text-[#f59e0b] ml-auto">
                            +{server.virtualNodes.length} vnodes (
                            {server.virtualNodes.map((vn) => `${(vn.hashPosition * 100).toFixed(0)}%`).join(", ")}
                            )
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* ── Load Balance Analysis ── */}
              {servers.length >= 2 && keys.length >= 3 && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.3 }}
                  className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 size={14} className="text-[#f59e0b]" />
                    <span className="text-sm font-medium text-[#a1a1aa]">
                      Load Balance Analysis
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[#71717a]">Standard Deviation</span>
                      <span className="font-mono text-[#f59e0b]">
                        {(() => {
                          const counts = servers.map((s) => metrics.keysPerNode[s.id] || 0);
                          const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
                          const variance = counts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / counts.length;
                          return Math.sqrt(variance).toFixed(2);
                        })()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#71717a]">Ideal (uniform)</span>
                      <span className="font-mono text-[#10b981]">
                        {(keys.length / servers.length).toFixed(1)} keys/node
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#71717a]">Imbalance ratio</span>
                      <span
                        className="font-mono"
                        style={{
                          color: metrics.min > 0 && metrics.max / metrics.min <= 2
                            ? "#10b981"
                            : "#ef4444",
                        }}
                      >
                        {metrics.min > 0 ? (metrics.max / metrics.min).toFixed(1) : "inf"}x
                      </span>
                    </div>
                    <p className="text-[10px] text-[#71717a] pt-1">
                      {useVirtualNodes
                        ? "Virtual nodes spread each server across multiple ring positions, reducing hotspots."
                        : "Without virtual nodes, distribution can be uneven. Enable vnodes for better balance."}
                    </p>
                  </div>
                </motion.div>
              )}

              {/* ── Concept Info ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.32 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Hash size={14} className="text-[#f59e0b]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">How It Works</span>
                </div>
                <div className="text-xs text-[#71717a] space-y-1.5">
                  <p>
                    <strong className="text-[#10b981]">Hash Ring:</strong> Both servers and keys are hashed onto a circular ring (0 to 2^32). Each key is assigned to the first server found clockwise from its hash position.
                  </p>
                  <p>
                    <strong className="text-[#f59e0b]">Minimal Redistribution:</strong> Adding or removing a node only affects keys between it and its counter-clockwise predecessor. Other keys stay on their current node.
                  </p>
                  <p>
                    <strong className="text-[#6366f1]">Virtual Nodes:</strong> Each physical server maps to multiple ring positions, improving load balance and reducing hotspots. With N virtual nodes, each server owns N arcs on the ring.
                  </p>
                  <p>
                    <strong className="text-[#ef4444]">Real-World Usage:</strong> Used by Amazon DynamoDB, Apache Cassandra, Discord, and Akamai CDN for distributing data across cluster nodes.
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