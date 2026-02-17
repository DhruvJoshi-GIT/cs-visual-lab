"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Skull,
  HeartPulse,
  Send,
  Unplug,
  Cable,
  Zap,
  Crown,
  Activity,
  Server,
  AlertTriangle,
  Network,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

/* ═══════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════ */

type NodeState = "follower" | "candidate" | "leader";

interface LogEntry {
  index: number;
  term: number;
  command: string;
}

interface RaftNode {
  id: string;
  state: NodeState;
  currentTerm: number;
  votedFor: string | null;
  log: LogEntry[];
  commitIndex: number;
  alive: boolean;
  electionTimer: number;
  heartbeatTimer: number;
  votesReceived: Set<string>;
  nextIndex: Record<string, number>;
  matchIndex: Record<string, number>;
}

type MessageType =
  | "request-vote"
  | "vote-granted"
  | "vote-denied"
  | "append-entries"
  | "append-ack"
  | "append-nack"
  | "heartbeat";

interface RaftMessage {
  id: string;
  from: string;
  to: string;
  type: MessageType;
  term: number;
  data?: {
    entries?: LogEntry[];
    prevLogIndex?: number;
    prevLogTerm?: number;
    leaderCommit?: number;
    lastLogIndex?: number;
    lastLogTerm?: number;
    matchIndex?: number;
  };
  progress: number; // 0 to 1 for animation
  createdAt: number;
}

interface EventLogEntry {
  id: string;
  tick: number;
  message: string;
  type: "election" | "vote" | "replication" | "commit" | "failure" | "info";
}

interface Partition {
  groupA: Set<string>;
  groupB: Set<string>;
}

const NODE_IDS = ["S1", "S2", "S3", "S4", "S5"];
const MAJORITY = 3;
const BASE_ELECTION_TIMEOUT_MIN = 8;
const BASE_ELECTION_TIMEOUT_MAX = 16;
const BASE_HEARTBEAT_INTERVAL = 3;
const MESSAGE_TRAVEL_TICKS = 2;

const STATE_COLORS: Record<NodeState, string> = {
  follower: "#71717a",
  candidate: "#f59e0b",
  leader: "#6366f1",
};

const STATE_GLOW: Record<NodeState, string> = {
  follower: "rgba(113,113,122,0.2)",
  candidate: "rgba(245,158,11,0.3)",
  leader: "rgba(99,102,241,0.4)",
};

const MSG_COLORS: Record<string, string> = {
  "request-vote": "#f59e0b",
  "vote-granted": "#10b981",
  "vote-denied": "#ef4444",
  "append-entries": "#06b6d4",
  "append-ack": "#10b981",
  "append-nack": "#ef4444",
  heartbeat: "#71717a",
};

const EVENT_COLORS: Record<string, string> = {
  election: "#f59e0b",
  vote: "#06b6d4",
  replication: "#6366f1",
  commit: "#10b981",
  failure: "#ef4444",
  info: "#a1a1aa",
};

/* ═══════════════════════════════════════════════════════════
   HELPER FUNCTIONS
   ═══════════════════════════════════════════════════════════ */

let globalMsgId = 0;
let globalEventId = 0;

function makeId(prefix: string): string {
  return `${prefix}-${++globalMsgId}`;
}

function makeEventId(): string {
  return `evt-${++globalEventId}`;
}

function randomElectionTimeout(): number {
  return (
    BASE_ELECTION_TIMEOUT_MIN +
    Math.floor(
      Math.random() * (BASE_ELECTION_TIMEOUT_MAX - BASE_ELECTION_TIMEOUT_MIN)
    )
  );
}

function cloneNode(n: RaftNode): RaftNode {
  return {
    ...n,
    log: n.log.map((e) => ({ ...e })),
    votesReceived: new Set(n.votesReceived),
    nextIndex: { ...n.nextIndex },
    matchIndex: { ...n.matchIndex },
  };
}

function lastLogIndex(node: RaftNode): number {
  return node.log.length;
}

function lastLogTerm(node: RaftNode): number {
  if (node.log.length === 0) return 0;
  return node.log[node.log.length - 1].term;
}

function getNodePosition(
  index: number,
  cx: number,
  cy: number,
  radius: number
): { x: number; y: number } {
  const angle = (index * 2 * Math.PI) / 5 - Math.PI / 2;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function canCommunicate(
  from: string,
  to: string,
  partition: Partition | null
): boolean {
  if (!partition) return true;
  const inA1 = partition.groupA.has(from);
  const inA2 = partition.groupA.has(to);
  const inB1 = partition.groupB.has(from);
  const inB2 = partition.groupB.has(to);
  return (inA1 && inA2) || (inB1 && inB2);
}

/* ═══════════════════════════════════════════════════════════
   INITIAL STATE FACTORY
   ═══════════════════════════════════════════════════════════ */

function createInitialNodes(): Record<string, RaftNode> {
  const nodes: Record<string, RaftNode> = {};
  NODE_IDS.forEach((id) => {
    const nextIndex: Record<string, number> = {};
    const matchIndex: Record<string, number> = {};
    NODE_IDS.forEach((other) => {
      if (other !== id) {
        nextIndex[other] = 1;
        matchIndex[other] = 0;
      }
    });
    nodes[id] = {
      id,
      state: "follower",
      currentTerm: 0,
      votedFor: null,
      log: [],
      commitIndex: 0,
      alive: true,
      electionTimer: randomElectionTimeout(),
      heartbeatTimer: 0,
      votesReceived: new Set(),
      nextIndex,
      matchIndex,
    };
  });
  return nodes;
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function RaftConsensusPage() {
  /* ─── Core simulation state ─── */
  const [nodes, setNodes] = useState<Record<string, RaftNode>>(
    createInitialNodes
  );
  const [messages, setMessages] = useState<RaftMessage[]>([]);
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [tick, setTick] = useState(0);
  const [partition, setPartition] = useState<Partition | null>(null);
  const [clientRequestCounter, setClientRequestCounter] = useState(0);

  /* ─── UI state ─── */
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [partitionMode, setPartitionMode] = useState(false);
  const [partitionSelection, setPartitionSelection] = useState<Set<string>>(
    new Set()
  );

  /* ─── Refs ─── */
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(nodes);
  const messagesRef = useRef(messages);
  const eventsRef = useRef(events);
  const tickRef = useRef(tick);
  const partitionRef = useRef(partition);
  const clientCounterRef = useRef(clientRequestCounter);

  nodesRef.current = nodes;
  messagesRef.current = messages;
  eventsRef.current = events;
  tickRef.current = tick;
  partitionRef.current = partition;
  clientCounterRef.current = clientRequestCounter;

  /* Auto-scroll event log */
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  /* ─── Simulation step ─── */
  const simulationStep = useCallback(() => {
    const currentNodes = { ...nodesRef.current };
    const currentMessages = [...messagesRef.current];
    const newMessages: RaftMessage[] = [];
    const newEvents: EventLogEntry[] = [];
    const currentTick = tickRef.current + 1;
    const currentPartition = partitionRef.current;

    const updatedNodes: Record<string, RaftNode> = {};
    NODE_IDS.forEach((id) => {
      updatedNodes[id] = cloneNode(currentNodes[id]);
    });

    function addEvent(
      message: string,
      type: EventLogEntry["type"]
    ) {
      newEvents.push({
        id: makeEventId(),
        tick: currentTick,
        message,
        type,
      });
    }

    function sendMsg(
      from: string,
      to: string,
      type: MessageType,
      term: number,
      data?: RaftMessage["data"]
    ) {
      if (
        !updatedNodes[from].alive ||
        !updatedNodes[to].alive ||
        !canCommunicate(from, to, currentPartition)
      )
        return;
      newMessages.push({
        id: makeId("msg"),
        from,
        to,
        type,
        term,
        data,
        progress: 0,
        createdAt: currentTick,
      });
    }

    function stepDownToFollower(node: RaftNode, newTerm: number) {
      node.state = "follower";
      node.currentTerm = newTerm;
      node.votedFor = null;
      node.votesReceived = new Set();
      node.electionTimer = randomElectionTimeout();
    }

    /* --- Process delivered messages --- */
    const stillInFlight: RaftMessage[] = [];
    for (const msg of currentMessages) {
      const newProgress = msg.progress + 1 / MESSAGE_TRAVEL_TICKS;
      if (newProgress >= 1) {
        // Message delivered
        const target = updatedNodes[msg.to];
        const sender = updatedNodes[msg.from];
        if (!target.alive || !sender.alive) continue;
        if (!canCommunicate(msg.from, msg.to, currentPartition)) continue;

        switch (msg.type) {
          case "request-vote": {
            if (msg.term > target.currentTerm) {
              stepDownToFollower(target, msg.term);
            }
            if (msg.term < target.currentTerm) {
              sendMsg(msg.to, msg.from, "vote-denied", target.currentTerm);
              break;
            }
            const senderLastIdx = msg.data?.lastLogIndex ?? 0;
            const senderLastTerm = msg.data?.lastLogTerm ?? 0;
            const logOk =
              senderLastTerm > lastLogTerm(target) ||
              (senderLastTerm === lastLogTerm(target) &&
                senderLastIdx >= lastLogIndex(target));

            if (
              (target.votedFor === null || target.votedFor === msg.from) &&
              logOk
            ) {
              target.votedFor = msg.from;
              target.electionTimer = randomElectionTimeout();
              sendMsg(msg.to, msg.from, "vote-granted", target.currentTerm);
              addEvent(
                `${msg.to} voted for ${msg.from} in term ${target.currentTerm}`,
                "vote"
              );
            } else {
              sendMsg(msg.to, msg.from, "vote-denied", target.currentTerm);
            }
            break;
          }

          case "vote-granted": {
            if (
              target.state === "candidate" &&
              msg.term === target.currentTerm
            ) {
              target.votesReceived.add(msg.from);
              const totalVotes = target.votesReceived.size + 1; // +1 self
              if (totalVotes >= MAJORITY) {
                target.state = "leader";
                target.heartbeatTimer = 0;
                addEvent(
                  `${msg.to} became leader for term ${target.currentTerm}`,
                  "election"
                );
                // Initialize nextIndex and matchIndex
                NODE_IDS.forEach((peerId) => {
                  if (peerId !== msg.to) {
                    target.nextIndex[peerId] = lastLogIndex(target) + 1;
                    target.matchIndex[peerId] = 0;
                  }
                });
                // Send immediate heartbeat
                NODE_IDS.forEach((peerId) => {
                  if (peerId !== msg.to) {
                    sendMsg(
                      msg.to,
                      peerId,
                      "heartbeat",
                      target.currentTerm,
                      { leaderCommit: target.commitIndex }
                    );
                  }
                });
              }
            }
            if (msg.term > target.currentTerm) {
              stepDownToFollower(target, msg.term);
            }
            break;
          }

          case "vote-denied": {
            if (msg.term > target.currentTerm) {
              stepDownToFollower(target, msg.term);
              addEvent(
                `${msg.to} stepped down: discovered higher term ${msg.term}`,
                "info"
              );
            }
            break;
          }

          case "heartbeat": {
            if (msg.term >= target.currentTerm) {
              if (msg.term > target.currentTerm) {
                stepDownToFollower(target, msg.term);
              }
              target.state = "follower";
              target.votedFor = msg.from;
              target.electionTimer = randomElectionTimeout();
              // Advance commit index if leader's is ahead
              if (
                msg.data?.leaderCommit &&
                msg.data.leaderCommit > target.commitIndex
              ) {
                target.commitIndex = Math.min(
                  msg.data.leaderCommit,
                  lastLogIndex(target)
                );
              }
            }
            break;
          }

          case "append-entries": {
            if (msg.term > target.currentTerm) {
              stepDownToFollower(target, msg.term);
            }
            if (msg.term < target.currentTerm) {
              sendMsg(msg.to, msg.from, "append-nack", target.currentTerm, {
                matchIndex: 0,
              });
              break;
            }
            target.state = "follower";
            target.votedFor = msg.from;
            target.electionTimer = randomElectionTimeout();

            const prevIdx = msg.data?.prevLogIndex ?? 0;
            const prevTrm = msg.data?.prevLogTerm ?? 0;

            // Log consistency check
            if (prevIdx > 0) {
              if (prevIdx > target.log.length) {
                sendMsg(msg.to, msg.from, "append-nack", target.currentTerm, {
                  matchIndex: lastLogIndex(target),
                });
                break;
              }
              if (target.log[prevIdx - 1].term !== prevTrm) {
                // Truncate conflicting entries
                target.log = target.log.slice(0, prevIdx - 1);
                sendMsg(msg.to, msg.from, "append-nack", target.currentTerm, {
                  matchIndex: lastLogIndex(target),
                });
                break;
              }
            }

            // Append new entries
            if (msg.data?.entries) {
              for (const entry of msg.data.entries) {
                const idx = entry.index - 1;
                if (idx < target.log.length) {
                  if (target.log[idx].term !== entry.term) {
                    target.log = target.log.slice(0, idx);
                    target.log.push({ ...entry });
                  }
                } else {
                  target.log.push({ ...entry });
                }
              }
              addEvent(
                `${msg.from} replicated entry [${msg.data.entries.map((e) => e.index).join(",")}] to ${msg.to}`,
                "replication"
              );
            }

            // Update commit index
            if (
              msg.data?.leaderCommit &&
              msg.data.leaderCommit > target.commitIndex
            ) {
              target.commitIndex = Math.min(
                msg.data.leaderCommit,
                lastLogIndex(target)
              );
            }

            sendMsg(msg.to, msg.from, "append-ack", target.currentTerm, {
              matchIndex: lastLogIndex(target),
            });
            break;
          }

          case "append-ack": {
            if (msg.term > target.currentTerm) {
              stepDownToFollower(target, msg.term);
              break;
            }
            if (target.state === "leader") {
              const mi = msg.data?.matchIndex ?? 0;
              target.matchIndex[msg.from] = Math.max(
                target.matchIndex[msg.from],
                mi
              );
              target.nextIndex[msg.from] = mi + 1;

              // Try to advance commit index
              for (let n = lastLogIndex(target); n > target.commitIndex; n--) {
                if (target.log[n - 1].term === target.currentTerm) {
                  let replicatedCount = 1; // self
                  NODE_IDS.forEach((peerId) => {
                    if (
                      peerId !== target.id &&
                      target.matchIndex[peerId] >= n
                    ) {
                      replicatedCount++;
                    }
                  });
                  if (replicatedCount >= MAJORITY) {
                    if (n > target.commitIndex) {
                      addEvent(
                        `Entry [${n}] committed (replicated to majority)`,
                        "commit"
                      );
                    }
                    target.commitIndex = n;
                    break;
                  }
                }
              }
            }
            break;
          }

          case "append-nack": {
            if (msg.term > target.currentTerm) {
              stepDownToFollower(target, msg.term);
              break;
            }
            if (target.state === "leader") {
              // Decrement nextIndex for this follower
              target.nextIndex[msg.from] = Math.max(
                1,
                target.nextIndex[msg.from] - 1
              );
            }
            break;
          }
        }
      } else {
        stillInFlight.push({ ...msg, progress: newProgress });
      }
    }

    /* --- Node tick logic: timers --- */
    NODE_IDS.forEach((id) => {
      const node = updatedNodes[id];
      if (!node.alive) return;

      if (node.state === "follower" || node.state === "candidate") {
        node.electionTimer--;

        if (node.electionTimer <= 0) {
          // Start election
          node.state = "candidate";
          node.currentTerm++;
          node.votedFor = id;
          node.votesReceived = new Set();
          node.electionTimer = randomElectionTimeout();

          addEvent(
            `${id} started election for term ${node.currentTerm}`,
            "election"
          );

          NODE_IDS.forEach((peerId) => {
            if (peerId !== id) {
              sendMsg(id, peerId, "request-vote", node.currentTerm, {
                lastLogIndex: lastLogIndex(node),
                lastLogTerm: lastLogTerm(node),
              });
            }
          });
        }
      }

      if (node.state === "leader") {
        node.heartbeatTimer--;
        if (node.heartbeatTimer <= 0) {
          node.heartbeatTimer = BASE_HEARTBEAT_INTERVAL;

          NODE_IDS.forEach((peerId) => {
            if (peerId !== id) {
              const ni = node.nextIndex[peerId];
              if (ni <= lastLogIndex(node)) {
                // Send missing entries
                const entries = node.log.slice(ni - 1);
                const prevIdx = ni - 1;
                const prevTrm =
                  prevIdx > 0 ? node.log[prevIdx - 1].term : 0;
                sendMsg(id, peerId, "append-entries", node.currentTerm, {
                  prevLogIndex: prevIdx,
                  prevLogTerm: prevTrm,
                  entries,
                  leaderCommit: node.commitIndex,
                });
              } else {
                // Heartbeat only
                sendMsg(id, peerId, "heartbeat", node.currentTerm, {
                  leaderCommit: node.commitIndex,
                });
              }
            }
          });
        }
      }
    });

    /* --- Propagate commit index from leader to all --- */
    const leader = NODE_IDS.find((id) => updatedNodes[id].state === "leader" && updatedNodes[id].alive);
    if (leader) {
      const leaderCommit = updatedNodes[leader].commitIndex;
      NODE_IDS.forEach((id) => {
        if (id !== leader && updatedNodes[id].alive && updatedNodes[id].commitIndex < leaderCommit) {
          updatedNodes[id].commitIndex = Math.min(leaderCommit, lastLogIndex(updatedNodes[id]));
        }
      });
    }

    /* --- Apply updates --- */
    setNodes(updatedNodes);
    setMessages([...stillInFlight, ...newMessages]);
    setTick(currentTick);
    if (newEvents.length > 0) {
      setEvents((prev) => [...prev, ...newEvents].slice(-200));
    }
  }, []);

  /* ─── Auto-play ─── */
  useEffect(() => {
    if (isPlaying) {
      const ms = Math.max(40, 300 / speed);
      intervalRef.current = setInterval(simulationStep, ms);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, speed, simulationStep]);

  /* ─── Controls ─── */
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleStep = useCallback(() => simulationStep(), [simulationStep]);
  const handleReset = useCallback(() => {
    setIsPlaying(false);
    globalMsgId = 0;
    globalEventId = 0;
    setNodes(createInitialNodes());
    setMessages([]);
    setEvents([]);
    setTick(0);
    setPartition(null);
    setClientRequestCounter(0);
    setSelectedNode(null);
    setPartitionMode(false);
    setPartitionSelection(new Set());
  }, []);

  /* ─── User actions ─── */
  const toggleNodeAlive = useCallback((nodeId: string) => {
    setNodes((prev) => {
      const updated = { ...prev };
      const node = cloneNode(updated[nodeId]);
      node.alive = !node.alive;
      if (!node.alive) {
        node.state = "follower";
        node.votedFor = null;
        node.votesReceived = new Set();
      } else {
        node.electionTimer = randomElectionTimeout();
      }
      updated[nodeId] = node;
      return updated;
    });
    setEvents((prev) => [
      ...prev,
      {
        id: makeEventId(),
        tick: tickRef.current,
        message: `${nodeId} ${nodesRef.current[nodeId].alive ? "killed" : "revived"}`,
        type: "failure" as const,
      },
    ]);
  }, []);

  const sendClientRequest = useCallback(() => {
    const leaderNode = NODE_IDS.find(
      (id) =>
        nodesRef.current[id].state === "leader" && nodesRef.current[id].alive
    );
    if (!leaderNode) {
      setEvents((prev) => [
        ...prev,
        {
          id: makeEventId(),
          tick: tickRef.current,
          message: "No leader available - request dropped",
          type: "failure",
        },
      ]);
      return;
    }

    const counter = clientCounterRef.current + 1;
    setClientRequestCounter(counter);

    setNodes((prev) => {
      const updated = { ...prev };
      const leader = cloneNode(updated[leaderNode]);
      const entry: LogEntry = {
        index: leader.log.length + 1,
        term: leader.currentTerm,
        command: `SET x=${counter}`,
      };
      leader.log.push(entry);
      leader.heartbeatTimer = 0; // trigger immediate replication
      updated[leaderNode] = leader;
      return updated;
    });

    setEvents((prev) => [
      ...prev,
      {
        id: makeEventId(),
        tick: tickRef.current,
        message: `Client request: SET x=${counter} -> ${leaderNode}`,
        type: "replication",
      },
    ]);
  }, []);

  const createPartition = useCallback(() => {
    if (partitionSelection.size === 0 || partitionSelection.size === 5) return;
    const groupA = new Set(partitionSelection);
    const groupB = new Set(NODE_IDS.filter((id) => !groupA.has(id)));
    const newPartition = { groupA, groupB };
    setPartition(newPartition);
    setPartitionMode(false);
    setPartitionSelection(new Set());
    setEvents((prev) => [
      ...prev,
      {
        id: makeEventId(),
        tick: tickRef.current,
        message: `Network partitioned: [${[...groupA].join(",")}] | [${[...groupB].join(",")}]`,
        type: "failure",
      },
    ]);
  }, [partitionSelection]);

  const healPartition = useCallback(() => {
    setPartition(null);
    setEvents((prev) => [
      ...prev,
      {
        id: makeEventId(),
        tick: tickRef.current,
        message: "Network partition healed",
        type: "info",
      },
    ]);
  }, []);

  /* ─── Preset scenarios ─── */
  const runScenario = useCallback(
    (scenario: string) => {
      handleReset();
      setTimeout(() => {
        switch (scenario) {
          case "leader-failure": {
            // Immediately start with a quick election, then kill leader after a bit
            setEvents((prev) => [
              ...prev,
              {
                id: makeEventId(),
                tick: 0,
                message:
                  "Scenario: Leader Failure - wait for election then leader will be killed",
                type: "info",
              },
            ]);
            // Force S1 to timeout quickly
            setNodes((prev) => {
              const updated = { ...prev };
              updated["S1"] = cloneNode(updated["S1"]);
              updated["S1"].electionTimer = 1;
              return updated;
            });
            setIsPlaying(true);
            // Kill leader after some ticks
            setTimeout(() => {
              const leaderNode = NODE_IDS.find(
                (id) => nodesRef.current[id].state === "leader"
              );
              if (leaderNode) {
                toggleNodeAlive(leaderNode);
              }
            }, 3000 / speed);
            break;
          }
          case "network-partition": {
            setEvents((prev) => [
              ...prev,
              {
                id: makeEventId(),
                tick: 0,
                message:
                  "Scenario: Network Partition - electing leader then splitting [S1,S2] | [S3,S4,S5]",
                type: "info",
              },
            ]);
            setNodes((prev) => {
              const updated = { ...prev };
              updated["S1"] = cloneNode(updated["S1"]);
              updated["S1"].electionTimer = 1;
              return updated;
            });
            setIsPlaying(true);
            setTimeout(() => {
              const groupA = new Set(["S1", "S2"]);
              const groupB = new Set(["S3", "S4", "S5"]);
              setPartition({ groupA, groupB });
              setEvents((prev) => [
                ...prev,
                {
                  id: makeEventId(),
                  tick: tickRef.current,
                  message: "Network partitioned: [S1,S2] | [S3,S4,S5]",
                  type: "failure",
                },
              ]);
            }, 3000 / speed);
            break;
          }
          case "split-brain": {
            setEvents((prev) => [
              ...prev,
              {
                id: makeEventId(),
                tick: 0,
                message:
                  "Scenario: Split Brain - two groups each try to elect a leader",
                type: "info",
              },
            ]);
            const groupA = new Set(["S1", "S2"]);
            const groupB = new Set(["S3", "S4", "S5"]);
            setPartition({ groupA, groupB });
            // Force quick elections on both sides
            setNodes((prev) => {
              const updated = { ...prev };
              updated["S1"] = cloneNode(updated["S1"]);
              updated["S1"].electionTimer = 2;
              updated["S3"] = cloneNode(updated["S3"]);
              updated["S3"].electionTimer = 3;
              return updated;
            });
            setIsPlaying(true);
            break;
          }
          default: {
            // Normal operation
            setEvents((prev) => [
              ...prev,
              {
                id: makeEventId(),
                tick: 0,
                message: "Scenario: Normal Operation - watch election and replication",
                type: "info",
              },
            ]);
            setNodes((prev) => {
              const updated = { ...prev };
              updated["S1"] = cloneNode(updated["S1"]);
              updated["S1"].electionTimer = 2;
              return updated;
            });
            setIsPlaying(true);
            break;
          }
        }
      }, 50);
    },
    [handleReset, speed, toggleNodeAlive]
  );

  /* ─── Metrics ─── */
  const metrics = useMemo(() => {
    const currentLeader = NODE_IDS.find(
      (id) => nodes[id].state === "leader" && nodes[id].alive
    );
    const maxTerm = Math.max(...NODE_IDS.map((id) => nodes[id].currentTerm));
    const maxCommit = Math.max(...NODE_IDS.map((id) => nodes[id].commitIndex));
    const totalElections = events.filter(
      (e) => e.type === "election" && e.message.includes("started election")
    ).length;
    const totalMessages = events.length;
    return { currentLeader, maxTerm, maxCommit, totalElections, totalMessages };
  }, [nodes, events]);

  /* ─── SVG layout ─── */
  const svgWidth = 560;
  const svgHeight = 480;
  const centerX = svgWidth / 2;
  const centerY = svgHeight / 2;
  const orbitRadius = 160;
  const nodeRadius = 48;

  const nodePositions = useMemo(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    NODE_IDS.forEach((id, i) => {
      positions[id] = getNodePosition(i, centerX, centerY, orbitRadius);
    });
    return positions;
  }, [centerX, centerY]);

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
              <span className="text-xs font-mono font-medium px-2 py-1 rounded bg-[#6366f1]/15 text-[#6366f1] border border-[#6366f1]/20">
                7.1
              </span>
              <div className="flex items-center gap-1.5 text-xs text-[#71717a]">
                <Network size={12} />
                <span>Distributed Systems</span>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Raft Consensus
            </h1>
            <p className="mt-1.5 text-[#a1a1aa] text-sm sm:text-base max-w-2xl">
              Leader election, log replication, and fault tolerance in a 5-node
              cluster
            </p>
          </motion.div>
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
            onToggleMetrics={() => setShowMetrics((v) => !v)}
          >
            {/* Scenario Buttons */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => runScenario("normal")}
                className="px-2.5 py-1.5 text-xs rounded-lg bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#a1a1aa] hover:text-white transition-all duration-200 whitespace-nowrap"
                title="Normal Operation"
              >
                <Zap size={13} className="inline mr-1 -mt-0.5" />
                Normal
              </button>
              <button
                onClick={() => runScenario("leader-failure")}
                className="px-2.5 py-1.5 text-xs rounded-lg bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#a1a1aa] hover:text-white transition-all duration-200 whitespace-nowrap"
                title="Leader Failure"
              >
                <Skull size={13} className="inline mr-1 -mt-0.5" />
                Leader Fail
              </button>
              <button
                onClick={() => runScenario("network-partition")}
                className="px-2.5 py-1.5 text-xs rounded-lg bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#a1a1aa] hover:text-white transition-all duration-200 whitespace-nowrap"
                title="Network Partition"
              >
                <Unplug size={13} className="inline mr-1 -mt-0.5" />
                Partition
              </button>
              <button
                onClick={() => runScenario("split-brain")}
                className="px-2.5 py-1.5 text-xs rounded-lg bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#a1a1aa] hover:text-white transition-all duration-200 whitespace-nowrap"
                title="Split Brain"
              >
                <AlertTriangle size={13} className="inline mr-1 -mt-0.5" />
                Split Brain
              </button>
            </div>
          </ModuleControls>
        </div>

        {/* ── Main Layout ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
            {/* ── Left Column: Cluster + Logs ── */}
            <div className="space-y-4">
              {/* ── Cluster Visualization ── */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="relative rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden"
              >
                {/* Partition overlay label */}
                {partition && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-[#ef4444]/15 border border-[#ef4444]/30 text-[#ef4444] text-xs font-medium flex items-center gap-1.5">
                    <Unplug size={12} />
                    Network Partitioned
                  </div>
                )}

                {/* Tick counter */}
                <div className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-lg bg-[#0a0a0f]/80 border border-[#1e1e2e] text-xs font-mono text-[#71717a]">
                  tick {tick}
                </div>

                <svg
                  viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                  className="w-full"
                  style={{ maxHeight: "520px" }}
                >
                  <defs>
                    {/* Glow filters for each state */}
                    {(["follower", "candidate", "leader"] as NodeState[]).map(
                      (state) => (
                        <filter
                          key={state}
                          id={`glow-${state}`}
                          x="-50%"
                          y="-50%"
                          width="200%"
                          height="200%"
                        >
                          <feGaussianBlur
                            stdDeviation="6"
                            result="coloredBlur"
                          />
                          <feMerge>
                            <feMergeNode in="coloredBlur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      )
                    )}
                    <filter id="glow-dead" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                      <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>

                    {/* Arrow markers */}
                    {Object.entries(MSG_COLORS).map(([type, color]) => (
                      <marker
                        key={type}
                        id={`arrow-${type}`}
                        viewBox="0 0 10 10"
                        refX="8"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path
                          d="M 0 0 L 10 5 L 0 10 z"
                          fill={color}
                          opacity={0.8}
                        />
                      </marker>
                    ))}
                  </defs>

                  {/* Background grid */}
                  <pattern
                    id="grid"
                    width="30"
                    height="30"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 30 0 L 0 0 0 30"
                      fill="none"
                      stroke="#1e1e2e"
                      strokeWidth="0.5"
                      opacity="0.3"
                    />
                  </pattern>
                  <rect width="100%" height="100%" fill="url(#grid)" />

                  {/* Orbit ring */}
                  <circle
                    cx={centerX}
                    cy={centerY}
                    r={orbitRadius}
                    fill="none"
                    stroke="#1e1e2e"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                    opacity="0.4"
                  />

                  {/* Partition line */}
                  {partition && (
                    <line
                      x1={centerX}
                      y1={centerY - orbitRadius - 40}
                      x2={centerX}
                      y2={centerY + orbitRadius + 40}
                      stroke="#ef4444"
                      strokeWidth="2"
                      strokeDasharray="8 4"
                      opacity="0.5"
                    >
                      <animate
                        attributeName="stroke-dashoffset"
                        from="0"
                        to="24"
                        dur="1s"
                        repeatCount="indefinite"
                      />
                    </line>
                  )}

                  {/* Message animations */}
                  <AnimatePresence>
                    {messages.map((msg) => {
                      const from = nodePositions[msg.from];
                      const to = nodePositions[msg.to];
                      if (!from || !to) return null;

                      const dx = to.x - from.x;
                      const dy = to.y - from.y;
                      const len = Math.sqrt(dx * dx + dy * dy);
                      const nx = dx / len;
                      const ny = dy / len;

                      // Offset start/end from node center
                      const startX = from.x + nx * (nodeRadius + 4);
                      const startY = from.y + ny * (nodeRadius + 4);
                      const endX = to.x - nx * (nodeRadius + 4);
                      const endY = to.y - ny * (nodeRadius + 4);

                      // Perpendicular offset to avoid overlap
                      const px = -ny * 6;
                      const py = nx * 6;

                      const x = startX + (endX - startX) * msg.progress + px;
                      const y = startY + (endY - startY) * msg.progress + py;

                      const color = MSG_COLORS[msg.type] || "#71717a";
                      const isHeartbeat = msg.type === "heartbeat";
                      const isVote =
                        msg.type === "request-vote" ||
                        msg.type === "vote-granted" ||
                        msg.type === "vote-denied";
                      const r = isHeartbeat ? 3 : isVote ? 4.5 : 5;

                      return (
                        <motion.g
                          key={msg.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.1 }}
                        >
                          {/* Trail line */}
                          <line
                            x1={startX + px}
                            y1={startY + py}
                            x2={x}
                            y2={y}
                            stroke={color}
                            strokeWidth={isHeartbeat ? 0.8 : 1.5}
                            strokeDasharray={
                              isVote ? "4 3" : isHeartbeat ? "2 3" : "none"
                            }
                            opacity={0.4}
                            markerEnd={`url(#arrow-${msg.type})`}
                          />
                          {/* Message dot */}
                          <circle cx={x} cy={y} r={r + 3} fill={color} opacity={0.15} />
                          <circle cx={x} cy={y} r={r} fill={color} opacity={0.9} />
                          <circle cx={x} cy={y} r={r - 1.5} fill="white" opacity={0.3} />
                        </motion.g>
                      );
                    })}
                  </AnimatePresence>

                  {/* Nodes */}
                  {NODE_IDS.map((id, idx) => {
                    const node = nodes[id];
                    const pos = nodePositions[id];
                    const color = node.alive
                      ? STATE_COLORS[node.state]
                      : "#ef4444";
                    const glow = node.alive
                      ? STATE_GLOW[node.state]
                      : "rgba(239,68,68,0.2)";
                    const isInPartitionA = partition?.groupA.has(id);
                    const partitionOffset =
                      partition
                        ? isInPartitionA
                          ? -14
                          : 14
                        : 0;

                    return (
                      <motion.g
                        key={id}
                        animate={{
                          x: partitionOffset,
                          opacity: node.alive ? 1 : 0.35,
                        }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                        style={{ cursor: "pointer" }}
                        onClick={() => {
                          if (partitionMode) {
                            setPartitionSelection((prev) => {
                              const next = new Set(prev);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            });
                          } else {
                            setSelectedNode(
                              selectedNode === id ? null : id
                            );
                          }
                        }}
                      >
                        {/* Outer glow */}
                        {node.alive && node.state === "leader" && (
                          <motion.circle
                            cx={pos.x}
                            cy={pos.y}
                            r={nodeRadius + 8}
                            fill="none"
                            stroke="#6366f1"
                            strokeWidth="2"
                            opacity={0.3}
                            animate={{
                              r: [nodeRadius + 6, nodeRadius + 14, nodeRadius + 6],
                              opacity: [0.2, 0.4, 0.2],
                            }}
                            transition={{
                              duration: 2,
                              repeat: Infinity,
                              ease: "easeInOut",
                            }}
                          />
                        )}

                        {/* Election selection ring */}
                        {partitionMode && partitionSelection.has(id) && (
                          <circle
                            cx={pos.x}
                            cy={pos.y}
                            r={nodeRadius + 6}
                            fill="none"
                            stroke="#f59e0b"
                            strokeWidth="2"
                            strokeDasharray="4 2"
                          />
                        )}

                        {/* Main node circle */}
                        <circle
                          cx={pos.x}
                          cy={pos.y}
                          r={nodeRadius}
                          fill="#0a0a0f"
                          stroke={color}
                          strokeWidth={node.state === "leader" ? 3 : 2}
                          strokeDasharray={
                            !node.alive ? "6 4" : "none"
                          }
                          filter={
                            node.alive
                              ? `url(#glow-${node.state})`
                              : "url(#glow-dead)"
                          }
                        />

                        {/* Inner fill gradient */}
                        <circle
                          cx={pos.x}
                          cy={pos.y}
                          r={nodeRadius - 2}
                          fill={color}
                          opacity={0.08}
                        />

                        {/* Leader crown */}
                        {node.alive && node.state === "leader" && (
                          <g
                            transform={`translate(${pos.x - 8}, ${pos.y - nodeRadius - 16})`}
                          >
                            <Crown
                              size={16}
                              color="#f59e0b"
                              strokeWidth={2}
                            />
                          </g>
                        )}

                        {/* Node ID */}
                        <text
                          x={pos.x}
                          y={pos.y - 8}
                          textAnchor="middle"
                          fill="white"
                          fontSize="16"
                          fontWeight="700"
                          fontFamily="monospace"
                        >
                          {id}
                        </text>

                        {/* State label */}
                        <text
                          x={pos.x}
                          y={pos.y + 8}
                          textAnchor="middle"
                          fill={color}
                          fontSize="10"
                          fontWeight="500"
                          fontFamily="sans-serif"
                          style={{ textTransform: "uppercase" }}
                        >
                          {node.alive
                            ? node.state.charAt(0).toUpperCase() +
                              node.state.slice(1)
                            : "Dead"}
                        </text>

                        {/* Term */}
                        <text
                          x={pos.x}
                          y={pos.y + 22}
                          textAnchor="middle"
                          fill="#71717a"
                          fontSize="9"
                          fontFamily="monospace"
                        >
                          term {node.currentTerm}
                        </text>

                        {/* Dead X overlay */}
                        {!node.alive && (
                          <>
                            <line
                              x1={pos.x - 16}
                              y1={pos.y - 16}
                              x2={pos.x + 16}
                              y2={pos.y + 16}
                              stroke="#ef4444"
                              strokeWidth="3"
                              strokeLinecap="round"
                              opacity="0.7"
                            />
                            <line
                              x1={pos.x + 16}
                              y1={pos.y - 16}
                              x2={pos.x - 16}
                              y2={pos.y + 16}
                              stroke="#ef4444"
                              strokeWidth="3"
                              strokeLinecap="round"
                              opacity="0.7"
                            />
                          </>
                        )}

                        {/* Commit indicator dot */}
                        {node.alive && node.commitIndex > 0 && (
                          <circle
                            cx={pos.x + nodeRadius - 8}
                            cy={pos.y - nodeRadius + 8}
                            r={8}
                            fill="#10b981"
                            opacity={0.9}
                          >
                            <title>Commit: {node.commitIndex}</title>
                          </circle>
                        )}
                        {node.alive && node.commitIndex > 0 && (
                          <text
                            x={pos.x + nodeRadius - 8}
                            y={pos.y - nodeRadius + 12}
                            textAnchor="middle"
                            fill="white"
                            fontSize="9"
                            fontWeight="700"
                            fontFamily="monospace"
                          >
                            {node.commitIndex}
                          </text>
                        )}
                      </motion.g>
                    );
                  })}

                  {/* Center legend */}
                  <g transform={`translate(${centerX - 44}, ${centerY + orbitRadius + 30})`}>
                    <circle cx={0} cy={0} r={4} fill="#71717a" />
                    <text x={10} y={4} fill="#71717a" fontSize="9" fontFamily="sans-serif">
                      Follower
                    </text>
                    <circle cx={70} cy={0} r={4} fill="#f59e0b" />
                    <text x={80} y={4} fill="#f59e0b" fontSize="9" fontFamily="sans-serif">
                      Candidate
                    </text>
                    <circle cx={152} cy={0} r={4} fill="#6366f1" />
                    <text x={162} y={4} fill="#6366f1" fontSize="9" fontFamily="sans-serif">
                      Leader
                    </text>
                  </g>
                </svg>
              </motion.div>

              {/* ── Action Buttons ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
                className="flex flex-wrap items-center gap-2"
              >
                <button
                  onClick={sendClientRequest}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-[#6366f1]/15 border border-[#6366f1]/30 text-[#6366f1] hover:bg-[#6366f1]/25 hover:border-[#6366f1]/50 transition-all duration-200"
                >
                  <Send size={13} />
                  Send Client Request
                </button>

                {selectedNode && (
                  <button
                    onClick={() => toggleNodeAlive(selectedNode)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                      nodes[selectedNode].alive
                        ? "bg-[#ef4444]/15 border border-[#ef4444]/30 text-[#ef4444] hover:bg-[#ef4444]/25"
                        : "bg-[#10b981]/15 border border-[#10b981]/30 text-[#10b981] hover:bg-[#10b981]/25"
                    }`}
                  >
                    {nodes[selectedNode].alive ? (
                      <>
                        <Skull size={13} />
                        Kill {selectedNode}
                      </>
                    ) : (
                      <>
                        <HeartPulse size={13} />
                        Revive {selectedNode}
                      </>
                    )}
                  </button>
                )}

                {!partition && !partitionMode && (
                  <button
                    onClick={() => setPartitionMode(true)}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-[#f59e0b]/15 border border-[#f59e0b]/30 text-[#f59e0b] hover:bg-[#f59e0b]/25 hover:border-[#f59e0b]/50 transition-all duration-200"
                  >
                    <Unplug size={13} />
                    Partition Network
                  </button>
                )}

                {partitionMode && (
                  <>
                    <span className="text-xs text-[#f59e0b]">
                      Click nodes for Group A, then:
                    </span>
                    <button
                      onClick={createPartition}
                      disabled={
                        partitionSelection.size === 0 ||
                        partitionSelection.size === 5
                      }
                      className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-[#f59e0b]/15 border border-[#f59e0b]/30 text-[#f59e0b] hover:bg-[#f59e0b]/25 transition-all duration-200 disabled:opacity-40"
                    >
                      Apply Partition
                    </button>
                    <button
                      onClick={() => {
                        setPartitionMode(false);
                        setPartitionSelection(new Set());
                      }}
                      className="px-3 py-2 text-xs text-[#71717a] hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                )}

                {partition && (
                  <button
                    onClick={healPartition}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-[#10b981]/15 border border-[#10b981]/30 text-[#10b981] hover:bg-[#10b981]/25 hover:border-[#10b981]/50 transition-all duration-200"
                  >
                    <Cable size={13} />
                    Heal Partition
                  </button>
                )}

                {!selectedNode && !partitionMode && (
                  <span className="text-xs text-[#71717a] ml-2">
                    Click a node to select it
                  </span>
                )}
              </motion.div>

              {/* ── Log Visualization ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.3 }}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4 overflow-x-auto"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Server size={14} className="text-[#6366f1]" />
                  <span className="text-sm font-medium text-[#a1a1aa]">
                    Replicated Logs
                  </span>
                  <div className="flex items-center gap-3 ml-auto text-[10px] text-[#71717a]">
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded border-2 border-[#10b981] bg-[#10b981]/20" />
                      Committed
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded border-2 border-dashed border-[#f59e0b] bg-[#f59e0b]/10" />
                      Uncommitted
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded border-2 border-dashed border-[#1e1e2e]" />
                      Empty
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {NODE_IDS.map((id) => {
                    const node = nodes[id];
                    const maxLogLen = Math.max(
                      ...NODE_IDS.map((nid) => nodes[nid].log.length),
                      1
                    );

                    return (
                      <div key={id} className="flex items-center gap-2">
                        {/* Node label */}
                        <div
                          className="flex items-center justify-center shrink-0 w-10 h-7 rounded text-xs font-mono font-bold"
                          style={{
                            color: node.alive
                              ? STATE_COLORS[node.state]
                              : "#ef4444",
                            backgroundColor: node.alive
                              ? `${STATE_COLORS[node.state]}15`
                              : "#ef444415",
                          }}
                        >
                          {id}
                        </div>

                        {/* Log entries */}
                        <div className="flex items-center gap-1 min-h-[28px]">
                          {Array.from({ length: maxLogLen }).map((_, i) => {
                            const entry = node.log[i];
                            if (!entry) {
                              return (
                                <div
                                  key={i}
                                  className="flex items-center justify-center w-16 h-7 rounded border-2 border-dashed border-[#1e1e2e] text-[#1e1e2e]"
                                >
                                  <span className="text-[9px] font-mono">
                                    ---
                                  </span>
                                </div>
                              );
                            }
                            const committed = i + 1 <= node.commitIndex;
                            return (
                              <motion.div
                                key={i}
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className={`flex flex-col items-center justify-center w-16 h-7 rounded text-[9px] font-mono leading-tight ${
                                  committed
                                    ? "border-2 border-[#10b981] bg-[#10b981]/10 text-[#10b981]"
                                    : "border-2 border-dashed border-[#f59e0b] bg-[#f59e0b]/5 text-[#f59e0b]"
                                }`}
                              >
                                <span className="leading-none">
                                  {entry.command.replace("SET ", "")}
                                </span>
                                <span
                                  className="leading-none"
                                  style={{
                                    fontSize: "7px",
                                    opacity: 0.6,
                                  }}
                                >
                                  t{entry.term} i{entry.index}
                                </span>
                              </motion.div>
                            );
                          })}
                          {maxLogLen === 0 && (
                            <span className="text-[10px] text-[#71717a] font-mono italic ml-1">
                              empty
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            </div>

            {/* ── Right Column: Metrics + Event Log ── */}
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
                      <div className="flex items-center gap-2 mb-1">
                        <Activity size={14} className="text-[#6366f1]" />
                        <span className="text-sm font-medium text-[#a1a1aa]">
                          Cluster Metrics
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <MetricCard
                          label="Current Term"
                          value={String(metrics.maxTerm)}
                          color="#6366f1"
                        />
                        <MetricCard
                          label="Leader"
                          value={metrics.currentLeader || "None"}
                          color={metrics.currentLeader ? "#10b981" : "#ef4444"}
                        />
                        <MetricCard
                          label="Elections"
                          value={String(metrics.totalElections)}
                          color="#f59e0b"
                        />
                        <MetricCard
                          label="Commit Index"
                          value={String(metrics.maxCommit)}
                          color="#06b6d4"
                        />
                        <MetricCard
                          label="Events"
                          value={String(events.length)}
                          color="#a1a1aa"
                        />
                        <MetricCard
                          label="Alive Nodes"
                          value={`${NODE_IDS.filter((id) => nodes[id].alive).length}/5`}
                          color={
                            NODE_IDS.filter((id) => nodes[id].alive).length >=
                            MAJORITY
                              ? "#10b981"
                              : "#ef4444"
                          }
                        />
                      </div>

                      {/* Node status row */}
                      <div className="flex items-center gap-1.5 pt-1">
                        {NODE_IDS.map((id) => {
                          const node = nodes[id];
                          return (
                            <div
                              key={id}
                              className="flex flex-col items-center gap-0.5 flex-1"
                            >
                              <div
                                className="w-full h-1.5 rounded-full transition-all duration-300"
                                style={{
                                  backgroundColor: node.alive
                                    ? STATE_COLORS[node.state]
                                    : "#ef4444",
                                  opacity: node.alive ? 1 : 0.3,
                                }}
                              />
                              <span className="text-[8px] font-mono text-[#71717a]">
                                {id}
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
                style={{ height: showMetrics ? "420px" : "620px" }}
              >
                <div className="flex items-center gap-2 p-3 border-b border-[#1e1e2e]">
                  <div className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
                  <span className="text-sm font-medium text-[#a1a1aa]">
                    Event Log
                  </span>
                  <span className="text-[10px] font-mono text-[#71717a] ml-auto">
                    {events.length} events
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-0.5 scrollbar-thin">
                  {events.length === 0 && (
                    <div className="flex items-center justify-center h-full text-xs text-[#71717a]">
                      Press Play or Step to begin
                    </div>
                  )}
                  {events.map((evt) => (
                    <motion.div
                      key={evt.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.15 }}
                      className="flex items-start gap-2 px-2 py-1 rounded hover:bg-[#ffffff04] group"
                    >
                      <span className="text-[9px] font-mono text-[#71717a] shrink-0 mt-0.5 w-6 text-right opacity-50 group-hover:opacity-100">
                        {evt.tick}
                      </span>
                      <div
                        className="w-1 h-1 rounded-full shrink-0 mt-1.5"
                        style={{
                          backgroundColor: EVENT_COLORS[evt.type],
                        }}
                      />
                      <span
                        className="text-[11px] font-mono leading-snug break-all"
                        style={{ color: EVENT_COLORS[evt.type] }}
                      >
                        {evt.message}
                      </span>
                    </motion.div>
                  ))}
                  <div ref={eventsEndRef} />
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
      <div
        className="text-base font-bold font-mono"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}
