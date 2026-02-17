"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ArrowRight,
  Check,
  X,
  Layers,
  Activity,
  Clock,
  Info,
  Lightbulb,
  Server,
  User,
  Zap,
  AlertTriangle,
  Timer,
  BarChart3,
  CircleDot,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

type CircuitState = "closed" | "open" | "half-open";

interface RequestResult {
  id: number;
  timestamp: number;
  success: boolean;
  rejected: boolean; // rejected by circuit breaker (not sent to service)
  label: string;
}

interface LogEntry {
  id: number;
  timestamp: number;
  message: string;
  type: "info" | "success" | "warning" | "error";
}

interface BreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  rejectedCount: number;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  totalRejections: number;
  stateEnteredAt: number;
  halfOpenSuccesses: number;
  halfOpenAttempts: number;
}

type ScenarioKey = "healthy" | "failure" | "recovery" | "intermittent";

interface Scenario {
  id: ScenarioKey;
  label: string;
  description: string;
  serviceHealthPattern: (tick: number) => number; // probability of success (0-1)
  requestPattern: (tick: number) => boolean; // should a request come in?
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = {
  bg: "#0a0a0f",
  card: "#111118",
  border: "#1e1e2e",
  primary: "#6366f1",
  secondary: "#06b6d4",
  success: "#10b981",
  danger: "#ef4444",
  accent: "#f59e0b",
  muted: "#71717a",
  lime: "#84cc16",
  closed: "#10b981",
  open: "#ef4444",
  halfOpen: "#f59e0b",
};

const STATE_LABELS: Record<CircuitState, string> = {
  closed: "Closed",
  open: "Open",
  "half-open": "Half-Open",
};

const STATE_COLORS: Record<CircuitState, string> = {
  closed: COLORS.closed,
  open: COLORS.open,
  "half-open": COLORS.halfOpen,
};

const STATE_DESCRIPTIONS: Record<CircuitState, string> = {
  closed: "Requests pass through normally. The failure counter tracks errors. If failures exceed the threshold, the breaker trips to Open.",
  open: "All requests are immediately rejected without contacting the service. A timeout countdown is active. When the timer expires, the breaker transitions to Half-Open.",
  "half-open": "A limited number of probe requests are allowed through. If they succeed, the breaker closes. If any fails, it trips back to Open.",
};

// ─── Scenarios ────────────────────────────────────────────────────────────────

const SCENARIOS: Scenario[] = [
  {
    id: "healthy",
    label: "Healthy Service",
    description: "Service is healthy with occasional random failures",
    serviceHealthPattern: () => 0.95,
    requestPattern: (tick) => tick % 2 === 0,
  },
  {
    id: "failure",
    label: "Service Failure",
    description: "Service starts healthy then fails completely",
    serviceHealthPattern: (tick) => (tick < 20 ? 0.95 : 0.05),
    requestPattern: (tick) => tick % 2 === 0,
  },
  {
    id: "recovery",
    label: "Recovery Cycle",
    description: "Service fails, then gradually recovers",
    serviceHealthPattern: (tick) => {
      if (tick < 15) return 0.95; // healthy
      if (tick < 35) return 0.05; // down
      if (tick < 55) return 0.6; // recovering
      return 0.95; // recovered
    },
    requestPattern: (tick) => tick % 2 === 0,
  },
  {
    id: "intermittent",
    label: "Intermittent Failures",
    description: "Service alternates between healthy and failing periods",
    serviceHealthPattern: (tick) => {
      const cycle = tick % 40;
      if (cycle < 15) return 0.95;
      if (cycle < 25) return 0.1;
      return 0.95;
    },
    requestPattern: (tick) => tick % 2 === 0,
  },
];

// ─── Initial state ────────────────────────────────────────────────────────────

function createInitialBreakerState(): BreakerState {
  return {
    state: "closed",
    failureCount: 0,
    successCount: 0,
    rejectedCount: 0,
    totalRequests: 0,
    totalSuccesses: 0,
    totalFailures: 0,
    totalRejections: 0,
    stateEnteredAt: 0,
    halfOpenSuccesses: 0,
    halfOpenAttempts: 0,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CircuitBreakerModule() {
  // ── Configuration ──
  const [failureThreshold, setFailureThreshold] = useState(3);
  const [recoveryTimeout, setRecoveryTimeout] = useState(10);
  const [halfOpenMaxProbes, setHalfOpenMaxProbes] = useState(2);
  const [activeScenario, setActiveScenario] = useState<ScenarioKey>("recovery");
  const [serviceHealthy, setServiceHealthy] = useState(true);
  const [manualMode, setManualMode] = useState(false);

  // ── Simulation state ──
  const [tick, setTick] = useState(0);
  const [breaker, setBreaker] = useState<BreakerState>(createInitialBreakerState);
  const [events, setEvents] = useState<RequestResult[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [stateHistory, setStateHistory] = useState<
    { tick: number; state: CircuitState }[]
  >([{ tick: 0, state: "closed" }]);

  // ── Playback ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);

  // ── Animation ──
  const [lastResult, setLastResult] = useState<RequestResult | null>(null);
  const [stateTransition, setStateTransition] = useState(false);

  // ── Refs ──
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const tickRef = useRef(tick);
  const breakerRef = useRef(breaker);
  const nextId = useRef(0);
  const logId = useRef(0);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);
  useEffect(() => {
    breakerRef.current = breaker;
  }, [breaker]);

  // ── Add log entry ──
  const addLog = useCallback(
    (message: string, type: LogEntry["type"], ts: number) => {
      const entry: LogEntry = {
        id: logId.current++,
        timestamp: ts,
        message,
        type,
      };
      setLog((prev) => [entry, ...prev].slice(0, 100));
    },
    []
  );

  // ── Determine service health ──
  const isServiceHealthyAtTick = useCallback(
    (currentTick: number): boolean => {
      if (manualMode) return serviceHealthy;
      const scenario = SCENARIOS.find((s) => s.id === activeScenario);
      if (!scenario) return true;
      const prob = scenario.serviceHealthPattern(currentTick);
      return Math.random() < prob;
    },
    [manualMode, serviceHealthy, activeScenario]
  );

  // ── Should a request arrive? ──
  const shouldRequestArrive = useCallback(
    (currentTick: number): boolean => {
      const scenario = SCENARIOS.find((s) => s.id === activeScenario);
      if (!scenario) return currentTick % 2 === 0;
      return scenario.requestPattern(currentTick);
    },
    [activeScenario]
  );

  // ── Step forward ──
  const stepForward = useCallback(() => {
    const currentTick = tickRef.current;
    const currentBreaker = breakerRef.current;

    // Check if open timeout expired
    if (currentBreaker.state === "open") {
      const ticksInOpen = currentTick - currentBreaker.stateEnteredAt;
      if (ticksInOpen >= recoveryTimeout) {
        const newBreaker: BreakerState = {
          ...currentBreaker,
          state: "half-open",
          stateEnteredAt: currentTick,
          halfOpenSuccesses: 0,
          halfOpenAttempts: 0,
        };
        setBreaker(newBreaker);
        breakerRef.current = newBreaker;
        addLog("Circuit breaker transitioned to HALF-OPEN (timeout expired)", "warning", currentTick);
        setStateHistory((prev) => [...prev, { tick: currentTick, state: "half-open" }]);
        setStateTransition(true);
        setTimeout(() => setStateTransition(false), 500);
      }
    }

    // Process incoming request
    const hasRequest = shouldRequestArrive(currentTick);

    if (hasRequest) {
      const cb = breakerRef.current; // re-read after potential state change
      let result: RequestResult;

      if (cb.state === "open") {
        // Reject immediately
        result = {
          id: nextId.current++,
          timestamp: currentTick,
          success: false,
          rejected: true,
          label: `REQ-${nextId.current}`,
        };
        const newBreaker: BreakerState = {
          ...cb,
          totalRequests: cb.totalRequests + 1,
          totalRejections: cb.totalRejections + 1,
          rejectedCount: cb.rejectedCount + 1,
        };
        setBreaker(newBreaker);
        breakerRef.current = newBreaker;
        addLog(`Request ${result.label} REJECTED (circuit is OPEN)`, "error", currentTick);
      } else if (cb.state === "half-open") {
        // Allow limited probes
        if (cb.halfOpenAttempts >= halfOpenMaxProbes) {
          // Exceeded probe limit, reject
          result = {
            id: nextId.current++,
            timestamp: currentTick,
            success: false,
            rejected: true,
            label: `REQ-${nextId.current}`,
          };
          const newBreaker: BreakerState = {
            ...cb,
            totalRequests: cb.totalRequests + 1,
            totalRejections: cb.totalRejections + 1,
            rejectedCount: cb.rejectedCount + 1,
          };
          setBreaker(newBreaker);
          breakerRef.current = newBreaker;
          addLog(
            `Request ${result.label} REJECTED (half-open probe limit reached)`,
            "error",
            currentTick
          );
        } else {
          // Send probe request
          const success = isServiceHealthyAtTick(currentTick);
          result = {
            id: nextId.current++,
            timestamp: currentTick,
            success,
            rejected: false,
            label: `REQ-${nextId.current}`,
          };

          if (success) {
            const newHalfOpenSuccesses = cb.halfOpenSuccesses + 1;
            const newHalfOpenAttempts = cb.halfOpenAttempts + 1;

            if (newHalfOpenSuccesses >= halfOpenMaxProbes) {
              // Enough successes, close the circuit
              const newBreaker: BreakerState = {
                ...cb,
                state: "closed",
                failureCount: 0,
                successCount: 0,
                totalRequests: cb.totalRequests + 1,
                totalSuccesses: cb.totalSuccesses + 1,
                stateEnteredAt: currentTick,
                halfOpenSuccesses: newHalfOpenSuccesses,
                halfOpenAttempts: newHalfOpenAttempts,
              };
              setBreaker(newBreaker);
              breakerRef.current = newBreaker;
              addLog(
                `Probe ${result.label} SUCCEEDED. Circuit breaker CLOSED (service recovered)`,
                "success",
                currentTick
              );
              setStateHistory((prev) => [
                ...prev,
                { tick: currentTick, state: "closed" },
              ]);
              setStateTransition(true);
              setTimeout(() => setStateTransition(false), 500);
            } else {
              const newBreaker: BreakerState = {
                ...cb,
                totalRequests: cb.totalRequests + 1,
                totalSuccesses: cb.totalSuccesses + 1,
                halfOpenSuccesses: newHalfOpenSuccesses,
                halfOpenAttempts: newHalfOpenAttempts,
              };
              setBreaker(newBreaker);
              breakerRef.current = newBreaker;
              addLog(
                `Probe ${result.label} SUCCEEDED (${newHalfOpenSuccesses}/${halfOpenMaxProbes})`,
                "success",
                currentTick
              );
            }
          } else {
            // Probe failed, trip back to open
            const newBreaker: BreakerState = {
              ...cb,
              state: "open",
              totalRequests: cb.totalRequests + 1,
              totalFailures: cb.totalFailures + 1,
              stateEnteredAt: currentTick,
              halfOpenSuccesses: 0,
              halfOpenAttempts: cb.halfOpenAttempts + 1,
            };
            setBreaker(newBreaker);
            breakerRef.current = newBreaker;
            addLog(
              `Probe ${result.label} FAILED. Circuit breaker OPENED (service still failing)`,
              "error",
              currentTick
            );
            setStateHistory((prev) => [
              ...prev,
              { tick: currentTick, state: "open" },
            ]);
            setStateTransition(true);
            setTimeout(() => setStateTransition(false), 500);
          }
        }
      } else {
        // Closed state: send request to service
        const success = isServiceHealthyAtTick(currentTick);
        result = {
          id: nextId.current++,
          timestamp: currentTick,
          success,
          rejected: false,
          label: `REQ-${nextId.current}`,
        };

        if (success) {
          const newBreaker: BreakerState = {
            ...cb,
            failureCount: Math.max(0, cb.failureCount - 1), // decrement on success
            successCount: cb.successCount + 1,
            totalRequests: cb.totalRequests + 1,
            totalSuccesses: cb.totalSuccesses + 1,
          };
          setBreaker(newBreaker);
          breakerRef.current = newBreaker;
          addLog(`Request ${result.label} succeeded`, "success", currentTick);
        } else {
          const newFailCount = cb.failureCount + 1;
          if (newFailCount >= failureThreshold) {
            // Trip to open
            const newBreaker: BreakerState = {
              ...cb,
              state: "open",
              failureCount: newFailCount,
              totalRequests: cb.totalRequests + 1,
              totalFailures: cb.totalFailures + 1,
              stateEnteredAt: currentTick,
            };
            setBreaker(newBreaker);
            breakerRef.current = newBreaker;
            addLog(
              `Request ${result.label} FAILED. Threshold reached (${newFailCount}/${failureThreshold}). Circuit OPENED!`,
              "error",
              currentTick
            );
            setStateHistory((prev) => [
              ...prev,
              { tick: currentTick, state: "open" },
            ]);
            setStateTransition(true);
            setTimeout(() => setStateTransition(false), 500);
          } else {
            const newBreaker: BreakerState = {
              ...cb,
              failureCount: newFailCount,
              totalRequests: cb.totalRequests + 1,
              totalFailures: cb.totalFailures + 1,
            };
            setBreaker(newBreaker);
            breakerRef.current = newBreaker;
            addLog(
              `Request ${result.label} FAILED (failures: ${newFailCount}/${failureThreshold})`,
              "warning",
              currentTick
            );
          }
        }
      }

      setEvents((prev) => [result, ...prev].slice(0, 100));
      setLastResult(result);
    }

    setTick((prev) => prev + 1);
    tickRef.current = currentTick + 1;
  }, [
    recoveryTimeout,
    halfOpenMaxProbes,
    failureThreshold,
    shouldRequestArrive,
    isServiceHealthyAtTick,
    addLog,
  ]);

  // ── Animation loop ──
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(10, 200 / speedRef.current);
      if (timestamp - lastTickRef.current >= interval) {
        lastTickRef.current = timestamp;
        stepForward();
      }
      animationRef.current = requestAnimationFrame(animationLoop);
    },
    [stepForward]
  );

  useEffect(
    () => () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    },
    []
  );

  // ── Handlers ──
  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const handleStep = useCallback(() => {
    if (isPlaying) handlePause();
    stepForward();
  }, [isPlaying, handlePause, stepForward]);

  const handleReset = useCallback(() => {
    handlePause();
    setTick(0);
    tickRef.current = 0;
    const newBreaker = createInitialBreakerState();
    setBreaker(newBreaker);
    breakerRef.current = newBreaker;
    setEvents([]);
    setLog([]);
    setLastResult(null);
    setStateHistory([{ tick: 0, state: "closed" }]);
    nextId.current = 0;
    logId.current = 0;
  }, [handlePause]);

  const handleScenarioChange = useCallback(
    (scenarioId: string) => {
      setManualMode(false);
      setActiveScenario(scenarioId as ScenarioKey);
      handleReset();
    },
    [handleReset]
  );

  // ── Computed values ──
  const timeInState = tick - breaker.stateEnteredAt;
  const openTimeRemaining =
    breaker.state === "open"
      ? Math.max(0, recoveryTimeout - timeInState)
      : 0;
  const failureRate =
    breaker.totalRequests > 0
      ? (
          ((breaker.totalFailures + breaker.totalRejections) /
            breaker.totalRequests) *
          100
        ).toFixed(1)
      : "0.0";

  // ── Metrics ──
  const metrics = [
    { label: "Total Requests", value: breaker.totalRequests, color: COLORS.secondary },
    { label: "Successes", value: breaker.totalSuccesses, color: COLORS.success },
    { label: "Failures", value: breaker.totalFailures, color: COLORS.danger },
    { label: "Rejections", value: breaker.totalRejections, color: COLORS.accent },
    {
      label: "State",
      value: STATE_LABELS[breaker.state],
      color: STATE_COLORS[breaker.state],
    },
    {
      label: "Time in State",
      value: `${timeInState} ticks`,
      color: COLORS.muted,
    },
    { label: "Failure Rate", value: `${failureRate}%`, color: COLORS.danger },
  ];

  return (
    <div className="min-h-screen" style={{ background: COLORS.bg }}>
      <Navbar />
      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          {/* ── Header ─────────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="space-y-3"
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className="px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider"
                style={{
                  backgroundColor: `${COLORS.lime}15`,
                  color: COLORS.lime,
                  border: `1px solid ${COLORS.lime}30`,
                }}
              >
                14.2
              </span>
              <span className="text-xs text-[#71717a]">
                System Design Building Blocks
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Circuit Breaker
            </h1>
            <p className="text-[#a1a1aa] text-base max-w-2xl">
              Protect your system from cascading failures with the Circuit
              Breaker pattern. Watch the three-state finite state machine
              (Closed, Open, Half-Open) respond to service health changes.
            </p>
          </motion.div>

          {/* ── Scenario + config ──────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
            className="flex flex-wrap items-center gap-4"
          >
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-[#71717a] mr-1">
                <Layers size={14} />
                <span>Presets</span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {SCENARIOS.map((scenario) => (
                  <button
                    key={scenario.id}
                    onClick={() => handleScenarioChange(scenario.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                      activeScenario === scenario.id && !manualMode
                        ? "bg-[#6366f1]/15 text-[#6366f1] border border-[#6366f1]/30"
                        : "bg-[#1e1e2e] text-[#a1a1aa] border border-transparent hover:bg-[#2a2a3e] hover:text-white"
                    }`}
                    title={scenario.description}
                  >
                    {scenario.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Configuration */}
            <div className="flex items-center gap-4 ml-auto flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#71717a]">Threshold:</span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={failureThreshold}
                  onChange={(e) => setFailureThreshold(parseInt(e.target.value))}
                  className="w-14 h-1.5 accent-[#ef4444] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#ef4444]"
                />
                <span className="text-xs font-mono text-[#a1a1aa]">{failureThreshold}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#71717a]">Timeout:</span>
                <input
                  type="range"
                  min={3}
                  max={30}
                  step={1}
                  value={recoveryTimeout}
                  onChange={(e) => setRecoveryTimeout(parseInt(e.target.value))}
                  className="w-14 h-1.5 accent-[#f59e0b] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f59e0b]"
                />
                <span className="text-xs font-mono text-[#a1a1aa]">{recoveryTimeout}t</span>
              </div>
              {/* Manual service toggle */}
              <button
                onClick={() => {
                  setManualMode(true);
                  setServiceHealthy(!serviceHealthy);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-1.5 ${
                  manualMode
                    ? serviceHealthy
                      ? "bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30"
                      : "bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/30"
                    : "bg-[#1e1e2e] text-[#a1a1aa] border border-transparent hover:bg-[#2a2a3e] hover:text-white"
                }`}
              >
                <Server size={12} />
                {manualMode
                  ? serviceHealthy
                    ? "Service: Healthy"
                    : "Service: Failing"
                  : "Manual Toggle"}
              </button>
            </div>
          </motion.div>

          {/* ── Main visualization ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-4"
          >
            {/* ── Left: FSM diagram + Service flow ── */}
            <div className="lg:col-span-1 space-y-4">
              {/* Three-state FSM visualization */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <CircleDot size={14} style={{ color: COLORS.primary }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    State Machine
                  </span>
                </div>

                {/* FSM circles */}
                <div className="relative" style={{ height: 280 }}>
                  {/* Closed state - top */}
                  <motion.div
                    className="absolute flex flex-col items-center"
                    style={{ top: 0, left: "50%", transform: "translateX(-50%)" }}
                    animate={{
                      scale: breaker.state === "closed" ? 1.08 : 0.95,
                      opacity: breaker.state === "closed" ? 1 : 0.5,
                    }}
                    transition={{ duration: 0.3 }}
                  >
                    <div
                      className="w-20 h-20 rounded-full flex items-center justify-center"
                      style={{
                        background:
                          breaker.state === "closed"
                            ? `${COLORS.closed}20`
                            : `${COLORS.closed}08`,
                        border: `3px solid ${
                          breaker.state === "closed"
                            ? COLORS.closed
                            : `${COLORS.closed}30`
                        }`,
                        boxShadow:
                          breaker.state === "closed"
                            ? `0 0 20px ${COLORS.closed}30`
                            : "none",
                      }}
                    >
                      <ShieldCheck
                        size={28}
                        style={{
                          color:
                            breaker.state === "closed"
                              ? COLORS.closed
                              : `${COLORS.closed}50`,
                        }}
                      />
                    </div>
                    <span
                      className="text-xs font-bold mt-1"
                      style={{
                        color:
                          breaker.state === "closed"
                            ? COLORS.closed
                            : COLORS.muted,
                      }}
                    >
                      CLOSED
                    </span>
                    {breaker.state === "closed" && (
                      <span className="text-[10px] text-[#71717a] font-mono">
                        fails: {breaker.failureCount}/{failureThreshold}
                      </span>
                    )}
                  </motion.div>

                  {/* Open state - bottom left */}
                  <motion.div
                    className="absolute flex flex-col items-center"
                    style={{ bottom: 0, left: "10%" }}
                    animate={{
                      scale: breaker.state === "open" ? 1.08 : 0.95,
                      opacity: breaker.state === "open" ? 1 : 0.5,
                    }}
                    transition={{ duration: 0.3 }}
                  >
                    <div
                      className="w-20 h-20 rounded-full flex items-center justify-center"
                      style={{
                        background:
                          breaker.state === "open"
                            ? `${COLORS.open}20`
                            : `${COLORS.open}08`,
                        border: `3px solid ${
                          breaker.state === "open"
                            ? COLORS.open
                            : `${COLORS.open}30`
                        }`,
                        boxShadow:
                          breaker.state === "open"
                            ? `0 0 20px ${COLORS.open}30`
                            : "none",
                      }}
                    >
                      <ShieldAlert
                        size={28}
                        style={{
                          color:
                            breaker.state === "open"
                              ? COLORS.open
                              : `${COLORS.open}50`,
                        }}
                      />
                    </div>
                    <span
                      className="text-xs font-bold mt-1"
                      style={{
                        color:
                          breaker.state === "open"
                            ? COLORS.open
                            : COLORS.muted,
                      }}
                    >
                      OPEN
                    </span>
                    {breaker.state === "open" && (
                      <span className="text-[10px] font-mono" style={{ color: COLORS.accent }}>
                        timeout: {openTimeRemaining}
                      </span>
                    )}
                  </motion.div>

                  {/* Half-Open state - bottom right */}
                  <motion.div
                    className="absolute flex flex-col items-center"
                    style={{ bottom: 0, right: "10%" }}
                    animate={{
                      scale: breaker.state === "half-open" ? 1.08 : 0.95,
                      opacity: breaker.state === "half-open" ? 1 : 0.5,
                    }}
                    transition={{ duration: 0.3 }}
                  >
                    <div
                      className="w-20 h-20 rounded-full flex items-center justify-center"
                      style={{
                        background:
                          breaker.state === "half-open"
                            ? `${COLORS.halfOpen}20`
                            : `${COLORS.halfOpen}08`,
                        border: `3px solid ${
                          breaker.state === "half-open"
                            ? COLORS.halfOpen
                            : `${COLORS.halfOpen}30`
                        }`,
                        boxShadow:
                          breaker.state === "half-open"
                            ? `0 0 20px ${COLORS.halfOpen}30`
                            : "none",
                      }}
                    >
                      <ShieldQuestion
                        size={28}
                        style={{
                          color:
                            breaker.state === "half-open"
                              ? COLORS.halfOpen
                              : `${COLORS.halfOpen}50`,
                        }}
                      />
                    </div>
                    <span
                      className="text-xs font-bold mt-1"
                      style={{
                        color:
                          breaker.state === "half-open"
                            ? COLORS.halfOpen
                            : COLORS.muted,
                      }}
                    >
                      HALF-OPEN
                    </span>
                    {breaker.state === "half-open" && (
                      <span className="text-[10px] font-mono" style={{ color: COLORS.halfOpen }}>
                        probes: {breaker.halfOpenSuccesses}/{halfOpenMaxProbes}
                      </span>
                    )}
                  </motion.div>

                  {/* Transition arrows (SVG) */}
                  <svg
                    className="absolute inset-0 w-full h-full"
                    viewBox="0 0 300 280"
                    fill="none"
                    style={{ pointerEvents: "none" }}
                  >
                    {/* Closed -> Open (threshold reached) */}
                    <path
                      d="M 120 60 C 80 120, 60 160, 80 190"
                      stroke={`${COLORS.open}40`}
                      strokeWidth="1.5"
                      strokeDasharray="4 3"
                      fill="none"
                      markerEnd="url(#arrowRed)"
                    />
                    <text x="40" y="135" fill={`${COLORS.open}60`} fontSize="8" fontFamily="monospace">
                      fails &gt;= {failureThreshold}
                    </text>

                    {/* Open -> Half-Open (timeout) */}
                    <path
                      d="M 135 220 L 185 220"
                      stroke={`${COLORS.halfOpen}40`}
                      strokeWidth="1.5"
                      strokeDasharray="4 3"
                      fill="none"
                      markerEnd="url(#arrowAmber)"
                    />
                    <text x="140" y="242" fill={`${COLORS.halfOpen}60`} fontSize="8" fontFamily="monospace">
                      timeout
                    </text>

                    {/* Half-Open -> Closed (success) */}
                    <path
                      d="M 230 190 C 240 140, 220 80, 185 60"
                      stroke={`${COLORS.closed}40`}
                      strokeWidth="1.5"
                      strokeDasharray="4 3"
                      fill="none"
                      markerEnd="url(#arrowGreen)"
                    />
                    <text x="230" y="125" fill={`${COLORS.closed}60`} fontSize="8" fontFamily="monospace">
                      success
                    </text>

                    {/* Half-Open -> Open (failure) */}
                    <path
                      d="M 195 230 C 170 260, 130 260, 105 230"
                      stroke={`${COLORS.open}40`}
                      strokeWidth="1.5"
                      strokeDasharray="4 3"
                      fill="none"
                      markerEnd="url(#arrowRed)"
                    />
                    <text x="130" y="268" fill={`${COLORS.open}60`} fontSize="8" fontFamily="monospace">
                      failure
                    </text>

                    {/* Arrow markers */}
                    <defs>
                      <marker id="arrowRed" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                        <path d="M 0 0 L 8 3 L 0 6 Z" fill={`${COLORS.open}60`} />
                      </marker>
                      <marker id="arrowAmber" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                        <path d="M 0 0 L 8 3 L 0 6 Z" fill={`${COLORS.halfOpen}60`} />
                      </marker>
                      <marker id="arrowGreen" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                        <path d="M 0 0 L 8 3 L 0 6 Z" fill={`${COLORS.closed}60`} />
                      </marker>
                    </defs>
                  </svg>
                </div>
              </div>

              {/* Service flow: Client → CB → Service */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Zap size={14} style={{ color: COLORS.accent }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Request Flow
                  </span>
                </div>

                <div className="flex items-center justify-between py-3">
                  {/* Client */}
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center"
                      style={{
                        background: `${COLORS.secondary}15`,
                        border: `1px solid ${COLORS.secondary}30`,
                      }}
                    >
                      <User size={18} style={{ color: COLORS.secondary }} />
                    </div>
                    <span className="text-[10px] text-[#71717a]">Client</span>
                  </div>

                  {/* Arrow */}
                  <div className="flex-1 flex items-center justify-center px-1">
                    <AnimatePresence>
                      {lastResult && tick - lastResult.timestamp < 3 && (
                        <motion.div
                          key={lastResult.id}
                          initial={{ x: -15, opacity: 0 }}
                          animate={{ x: 0, opacity: 1 }}
                          exit={{ x: 15, opacity: 0 }}
                        >
                          <ArrowRight
                            size={14}
                            style={{
                              color: lastResult.success
                                ? COLORS.success
                                : lastResult.rejected
                                ? COLORS.muted
                                : COLORS.danger,
                            }}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Circuit Breaker */}
                  <motion.div
                    className="flex flex-col items-center gap-1"
                    animate={{
                      scale: stateTransition ? 1.1 : 1,
                    }}
                    transition={{ duration: 0.3 }}
                  >
                    <div
                      className="w-14 h-14 rounded-xl flex items-center justify-center"
                      style={{
                        background: `${STATE_COLORS[breaker.state]}15`,
                        border: `2px solid ${STATE_COLORS[breaker.state]}`,
                        boxShadow: `0 0 15px ${STATE_COLORS[breaker.state]}20`,
                      }}
                    >
                      <Shield
                        size={22}
                        style={{ color: STATE_COLORS[breaker.state] }}
                      />
                    </div>
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: STATE_COLORS[breaker.state] }}
                    >
                      {STATE_LABELS[breaker.state]}
                    </span>
                  </motion.div>

                  {/* Arrow */}
                  <div className="flex-1 flex items-center justify-center px-1">
                    <AnimatePresence>
                      {lastResult &&
                        !lastResult.rejected &&
                        tick - lastResult.timestamp < 3 && (
                          <motion.div
                            key={`pass-${lastResult.id}`}
                            initial={{ x: -15, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: 15, opacity: 0 }}
                          >
                            <ArrowRight
                              size={14}
                              style={{
                                color: lastResult.success
                                  ? COLORS.success
                                  : COLORS.danger,
                              }}
                            />
                          </motion.div>
                        )}
                    </AnimatePresence>
                  </div>

                  {/* Service */}
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center"
                      style={{
                        background: manualMode
                          ? serviceHealthy
                            ? `${COLORS.success}15`
                            : `${COLORS.danger}15`
                          : `${COLORS.primary}15`,
                        border: `1px solid ${
                          manualMode
                            ? serviceHealthy
                              ? `${COLORS.success}30`
                              : `${COLORS.danger}30`
                            : `${COLORS.primary}30`
                        }`,
                      }}
                    >
                      <Server
                        size={18}
                        style={{
                          color: manualMode
                            ? serviceHealthy
                              ? COLORS.success
                              : COLORS.danger
                            : COLORS.primary,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-[#71717a]">Service</span>
                  </div>
                </div>

                {/* Last result indicator */}
                <AnimatePresence mode="wait">
                  {lastResult && (
                    <motion.div
                      key={lastResult.id}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center justify-center gap-2 py-2 rounded-lg"
                      style={{
                        background: lastResult.rejected
                          ? `${COLORS.muted}08`
                          : lastResult.success
                          ? `${COLORS.success}08`
                          : `${COLORS.danger}08`,
                        border: `1px solid ${
                          lastResult.rejected
                            ? `${COLORS.muted}20`
                            : lastResult.success
                            ? `${COLORS.success}20`
                            : `${COLORS.danger}20`
                        }`,
                      }}
                    >
                      {lastResult.rejected ? (
                        <Shield size={14} style={{ color: COLORS.muted }} />
                      ) : lastResult.success ? (
                        <Check size={14} style={{ color: COLORS.success }} />
                      ) : (
                        <X size={14} style={{ color: COLORS.danger }} />
                      )}
                      <span
                        className="text-xs font-medium"
                        style={{
                          color: lastResult.rejected
                            ? COLORS.muted
                            : lastResult.success
                            ? COLORS.success
                            : COLORS.danger,
                        }}
                      >
                        {lastResult.label}:{" "}
                        {lastResult.rejected
                          ? "Rejected (circuit open)"
                          : lastResult.success
                          ? "Success"
                          : "Failed"}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Failure counter display */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={14} style={{ color: COLORS.danger }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Failure Counter
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {Array.from({ length: failureThreshold }, (_, i) => (
                    <motion.div
                      key={i}
                      className="flex-1 h-8 rounded-md flex items-center justify-center"
                      animate={{
                        background:
                          i < breaker.failureCount
                            ? `${COLORS.danger}25`
                            : COLORS.border,
                        borderColor:
                          i < breaker.failureCount
                            ? COLORS.danger
                            : `${COLORS.border}`,
                      }}
                      style={{ border: "1px solid" }}
                      transition={{ duration: 0.2 }}
                    >
                      {i < breaker.failureCount && (
                        <X size={14} style={{ color: COLORS.danger }} />
                      )}
                    </motion.div>
                  ))}
                </div>
                <div className="flex justify-between mt-2 text-[10px]">
                  <span style={{ color: COLORS.danger }}>
                    {breaker.failureCount} / {failureThreshold} failures
                  </span>
                  {breaker.state === "open" && (
                    <span style={{ color: COLORS.accent }}>
                      <Timer size={10} className="inline mr-1" />
                      Recovery in {openTimeRemaining} ticks
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ── Center + Right: State timeline + Event log ── */}
            <div className="lg:col-span-2 space-y-4">
              {/* State description */}
              <motion.div
                className="rounded-xl p-4"
                animate={{
                  borderColor: STATE_COLORS[breaker.state],
                }}
                style={{
                  background: COLORS.card,
                  border: `1px solid`,
                }}
                transition={{ duration: 0.3 }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <motion.div
                    className="w-3 h-3 rounded-full"
                    animate={{
                      background: STATE_COLORS[breaker.state],
                      boxShadow: `0 0 10px ${STATE_COLORS[breaker.state]}60`,
                    }}
                    transition={{ duration: 0.3 }}
                  />
                  <span
                    className="text-sm font-bold"
                    style={{ color: STATE_COLORS[breaker.state] }}
                  >
                    {STATE_LABELS[breaker.state]} State
                  </span>
                  <span className="text-xs text-[#71717a] ml-auto font-mono">
                    t={tick}
                  </span>
                </div>
                <p className="text-xs text-[#a1a1aa] leading-relaxed">
                  {STATE_DESCRIPTIONS[breaker.state]}
                </p>
              </motion.div>

              {/* State history timeline */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Clock size={14} style={{ color: COLORS.secondary }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    State Timeline
                  </span>
                </div>

                <div className="relative h-16 rounded-lg overflow-hidden" style={{ background: COLORS.border }}>
                  {tick > 0 && stateHistory.map((sh, i) => {
                    const nextTick =
                      i < stateHistory.length - 1
                        ? stateHistory[i + 1].tick
                        : tick;
                    const startPct = (sh.tick / tick) * 100;
                    const widthPct = ((nextTick - sh.tick) / tick) * 100;
                    return (
                      <div
                        key={`${sh.tick}-${sh.state}`}
                        className="absolute top-0 bottom-0 flex items-center justify-center"
                        style={{
                          left: `${startPct}%`,
                          width: `${Math.max(widthPct, 0.5)}%`,
                          background: `${STATE_COLORS[sh.state]}20`,
                          borderRight: `1px solid ${COLORS.border}`,
                        }}
                      >
                        {widthPct > 8 && (
                          <span
                            className="text-[9px] font-mono font-bold"
                            style={{ color: STATE_COLORS[sh.state] }}
                          >
                            {STATE_LABELS[sh.state]}
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {/* Event dots on timeline */}
                  {events
                    .filter((e) => tick > 0)
                    .slice(0, 60)
                    .map((event) => {
                      const x = tick > 0 ? (event.timestamp / tick) * 100 : 0;
                      return (
                        <div
                          key={event.id}
                          className="absolute w-1.5 h-1.5 rounded-full"
                          style={{
                            left: `${x}%`,
                            top: event.success ? "25%" : event.rejected ? "65%" : "45%",
                            background: event.rejected
                              ? COLORS.muted
                              : event.success
                              ? COLORS.success
                              : COLORS.danger,
                          }}
                        />
                      );
                    })}

                  {tick === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-[#71717a]">
                      State transitions will appear here
                    </div>
                  )}
                </div>

                {/* Legend */}
                <div className="flex items-center gap-4 mt-2 text-[10px]">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: COLORS.success }} />
                    <span style={{ color: COLORS.success }}>Success</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: COLORS.danger }} />
                    <span style={{ color: COLORS.danger }}>Failure</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: COLORS.muted }} />
                    <span style={{ color: COLORS.muted }}>Rejected</span>
                  </span>
                </div>
              </div>

              {/* Stats bars */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 size={14} style={{ color: COLORS.primary }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Request Outcomes
                  </span>
                </div>

                <div className="h-6 rounded-md overflow-hidden flex" style={{ background: COLORS.border }}>
                  {breaker.totalRequests > 0 && (
                    <>
                      <motion.div
                        className="h-full"
                        animate={{
                          width: `${(breaker.totalSuccesses / breaker.totalRequests) * 100}%`,
                        }}
                        style={{ background: COLORS.success }}
                        transition={{ duration: 0.3 }}
                      />
                      <motion.div
                        className="h-full"
                        animate={{
                          width: `${(breaker.totalFailures / breaker.totalRequests) * 100}%`,
                        }}
                        style={{ background: COLORS.danger }}
                        transition={{ duration: 0.3 }}
                      />
                      <motion.div
                        className="h-full"
                        animate={{
                          width: `${(breaker.totalRejections / breaker.totalRequests) * 100}%`,
                        }}
                        style={{ background: `${COLORS.muted}80` }}
                        transition={{ duration: 0.3 }}
                      />
                    </>
                  )}
                </div>
                <div className="flex justify-between mt-1 text-[10px]">
                  <span style={{ color: COLORS.success }}>
                    Success: {breaker.totalSuccesses}
                  </span>
                  <span style={{ color: COLORS.danger }}>
                    Failures: {breaker.totalFailures}
                  </span>
                  <span style={{ color: COLORS.muted }}>
                    Rejected: {breaker.totalRejections}
                  </span>
                </div>
              </div>

              {/* Event log */}
              <div
                className="rounded-xl overflow-hidden"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div
                  className="px-4 py-3 border-b flex items-center gap-2"
                  style={{ borderColor: COLORS.border }}
                >
                  <Activity size={14} style={{ color: COLORS.muted }} />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Event Log
                  </span>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {log.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-[#71717a]">
                      Events will appear here. Press Play or Step to begin.
                    </div>
                  ) : (
                    log.slice(0, 30).map((entry, i) => (
                      <motion.div
                        key={entry.id}
                        initial={i === 0 ? { opacity: 0, x: -8 } : false}
                        animate={{ opacity: 1, x: 0 }}
                        className="px-4 py-2 border-b flex items-start gap-2 text-xs"
                        style={{
                          borderColor: `${COLORS.border}50`,
                          background:
                            i === 0
                              ? entry.type === "error"
                                ? `${COLORS.danger}05`
                                : entry.type === "success"
                                ? `${COLORS.success}05`
                                : entry.type === "warning"
                                ? `${COLORS.accent}05`
                                : "transparent"
                              : "transparent",
                        }}
                      >
                        <span className="font-mono text-[#71717a] shrink-0 w-8">
                          t={entry.timestamp}
                        </span>
                        <div className="flex items-start gap-1.5">
                          {entry.type === "error" && (
                            <X
                              size={12}
                              className="mt-0.5 shrink-0"
                              style={{ color: COLORS.danger }}
                            />
                          )}
                          {entry.type === "success" && (
                            <Check
                              size={12}
                              className="mt-0.5 shrink-0"
                              style={{ color: COLORS.success }}
                            />
                          )}
                          {entry.type === "warning" && (
                            <AlertTriangle
                              size={12}
                              className="mt-0.5 shrink-0"
                              style={{ color: COLORS.accent }}
                            />
                          )}
                          {entry.type === "info" && (
                            <Info
                              size={12}
                              className="mt-0.5 shrink-0"
                              style={{ color: COLORS.secondary }}
                            />
                          )}
                          <span
                            style={{
                              color:
                                entry.type === "error"
                                  ? "#fca5a5"
                                  : entry.type === "success"
                                  ? "#6ee7b7"
                                  : entry.type === "warning"
                                  ? "#fcd34d"
                                  : "#a1a1aa",
                            }}
                          >
                            {entry.message}
                          </span>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Controls ───────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3, ease: [0.23, 1, 0.32, 1] }}
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
            />
          </motion.div>

          {/* ── Metrics panel ──────────────────────────────────────────── */}
          <AnimatePresence>
            {showMetrics && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="flex flex-wrap gap-3"
              >
                {metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e]"
                  >
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                        {metric.label}
                      </span>
                      <span
                        className="text-sm font-mono font-semibold"
                        style={{ color: metric.color }}
                      >
                        {metric.value}
                      </span>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Educational info panel ─────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="rounded-2xl overflow-hidden"
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <div
              className="px-5 py-3.5 border-b flex items-center gap-2"
              style={{ borderColor: COLORS.border }}
            >
              <Info size={14} style={{ color: COLORS.lime }} />
              <span className="text-sm font-semibold text-white">
                Understanding the Circuit Breaker Pattern
              </span>
            </div>

            <div className="p-5 space-y-4">
              {/* How it works */}
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.secondary }}
                >
                  How It Works
                </h3>
                <p className="text-sm leading-relaxed text-[#a1a1aa]">
                  The Circuit Breaker pattern prevents cascading failures in
                  distributed systems. It wraps calls to an external service and
                  monitors for failures. Like an electrical circuit breaker that
                  trips to prevent damage, it stops sending requests to a failing
                  service, giving it time to recover. The pattern uses a three-state
                  finite state machine: Closed (normal), Open (rejecting), and
                  Half-Open (testing).
                </p>
              </div>

              {/* State explanations */}
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.accent }}
                >
                  The Three States
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(
                    [
                      {
                        state: "closed" as CircuitState,
                        icon: ShieldCheck,
                        desc: "Normal operation. Requests pass through. Failures are counted. Trips to Open when threshold is exceeded.",
                      },
                      {
                        state: "open" as CircuitState,
                        icon: ShieldAlert,
                        desc: "Fail-fast mode. All requests are immediately rejected. A timeout timer runs. Transitions to Half-Open when timer expires.",
                      },
                      {
                        state: "half-open" as CircuitState,
                        icon: ShieldQuestion,
                        desc: "Testing mode. Limited probe requests are sent. Success closes the breaker. Failure re-opens it.",
                      },
                    ] as const
                  ).map(({ state, icon: Icon, desc }) => (
                    <div
                      key={state}
                      className="rounded-lg p-3"
                      style={{
                        background: `${STATE_COLORS[state]}06`,
                        border: `1px solid ${STATE_COLORS[state]}15`,
                      }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Icon size={14} style={{ color: STATE_COLORS[state] }} />
                        <span
                          className="text-xs font-bold"
                          style={{ color: STATE_COLORS[state] }}
                        >
                          {STATE_LABELS[state]}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                        {desc}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Key insight */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: `${COLORS.lime}05`,
                  border: `1px solid ${COLORS.lime}10`,
                }}
              >
                <div className="flex items-start gap-2">
                  <Lightbulb
                    size={16}
                    className="mt-0.5 flex-shrink-0"
                    style={{ color: COLORS.lime }}
                  />
                  <div>
                    <span className="text-xs font-semibold text-white block mb-1">
                      Key Insight
                    </span>
                    <span className="text-xs leading-relaxed text-[#a1a1aa]">
                      Without a circuit breaker, when a downstream service fails,
                      every upstream caller keeps sending requests, consuming threads,
                      sockets, and memory while waiting for timeouts. This cascading
                      failure can bring down the entire system. The circuit breaker
                      &quot;fails fast&quot; during outages, preserving resources and
                      giving the failing service time to recover. Netflix Hystrix
                      popularized this pattern, and it is now implemented in Resilience4j
                      (Java), Polly (.NET), and built into service meshes like Istio
                      and Envoy.
                    </span>
                  </div>
                </div>
              </div>

              {/* Configuration guide */}
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-3"
                  style={{ color: COLORS.muted }}
                >
                  Configuration Parameters
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr
                        className="border-b"
                        style={{ borderColor: COLORS.border }}
                      >
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>
                          Parameter
                        </th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>
                          Current
                        </th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>
                          Typical
                        </th>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>
                          Description
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        {
                          name: "Failure Threshold",
                          current: failureThreshold,
                          typical: "3-5",
                          desc: "Number of failures before tripping to Open",
                          color: COLORS.danger,
                        },
                        {
                          name: "Recovery Timeout",
                          current: `${recoveryTimeout}t`,
                          typical: "30-60s",
                          desc: "Time in Open before transitioning to Half-Open",
                          color: COLORS.accent,
                        },
                        {
                          name: "Half-Open Probes",
                          current: halfOpenMaxProbes,
                          typical: "1-3",
                          desc: "Successful probes needed to close the circuit",
                          color: COLORS.halfOpen,
                        },
                      ].map((row) => (
                        <tr
                          key={row.name}
                          className="border-b"
                          style={{ borderColor: `${COLORS.border}50` }}
                        >
                          <td className="px-3 py-2 font-semibold" style={{ color: "#e4e4e7" }}>
                            {row.name}
                          </td>
                          <td className="px-3 py-2 text-center font-mono font-bold" style={{ color: row.color }}>
                            {row.current}
                          </td>
                          <td className="px-3 py-2 text-center font-mono" style={{ color: COLORS.muted }}>
                            {row.typical}
                          </td>
                          <td className="px-3 py-2" style={{ color: "#a1a1aa" }}>
                            {row.desc}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Real-world applications */}
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.success }}
                >
                  Real-World Applications
                </h3>
                <p className="text-sm leading-relaxed text-[#a1a1aa]">
                  The Circuit Breaker pattern was popularized by Michael Nygard in
                  &quot;Release It!&quot; and later by Netflix Hystrix. It is now a
                  standard pattern in microservices architectures. Spring Cloud
                  Circuit Breaker, Resilience4j, Polly (.NET), and gobreaker (Go)
                  are popular implementations. Service meshes like Istio and Envoy
                  provide circuit breaking at the infrastructure level, and
                  cloud providers like AWS offer circuit breaker support in their
                  App Mesh and API Gateway services. It is commonly used for
                  database connections, HTTP calls, message queue producers, and
                  any external service dependency.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
