'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch,
  Target,
  TrendingUp,
  Zap,
  BarChart3,
  Info,
  ChevronDown,
  Cpu,
  CheckCircle,
  XCircle,
  ArrowRight,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import ModuleControls from '@/components/ui/ModuleControls';

// ──────────────────────────── Types ────────────────────────────

type BranchOutcome = 'T' | 'NT';

type PredictorType =
  | 'always-taken'
  | 'always-not-taken'
  | '1-bit'
  | '2-bit'
  | 'tournament';

type TwoBitState = 'SN' | 'WN' | 'WT' | 'ST';

interface PredictionRecord {
  step: number;
  pc: number;
  actual: BranchOutcome;
  predicted: BranchOutcome;
  correct: boolean;
  predictorState: string;
}

interface BHTEntry {
  tag: number;
  state1Bit: boolean; // true = Predict Taken
  state2Bit: TwoBitState;
  // Tournament sub-states
  localState: TwoBitState;
  globalState: TwoBitState;
  chooser: number; // 0-3: 0,1 => use local, 2,3 => use global
  accessCount: number;
  lastAccess: number;
}

interface ScenarioPreset {
  label: string;
  desc: string;
  pattern: BranchOutcome[];
  pcSequence?: number[];
}

// ──────────────────────────── Constants ────────────────────────────

const DOMAIN_COLOR = '#8b5cf6';

const PREDICTOR_TYPES: { value: PredictorType; label: string; desc: string }[] = [
  { value: 'always-taken', label: 'Always Taken', desc: 'Always predicts branch is taken' },
  { value: 'always-not-taken', label: 'Always Not Taken', desc: 'Always predicts branch is not taken' },
  { value: '1-bit', label: '1-Bit Predictor', desc: 'Two-state FSM: last outcome becomes prediction' },
  { value: '2-bit', label: '2-Bit Saturating', desc: 'Four-state saturating counter with hysteresis' },
  { value: 'tournament', label: 'Tournament', desc: 'Two sub-predictors with a chooser that selects the better one' },
];

const TWO_BIT_STATES: TwoBitState[] = ['SN', 'WN', 'WT', 'ST'];

const TWO_BIT_LABELS: Record<TwoBitState, string> = {
  SN: 'Strongly\nNot Taken',
  WN: 'Weakly\nNot Taken',
  WT: 'Weakly\nTaken',
  ST: 'Strongly\nTaken',
};

const TWO_BIT_SHORT: Record<TwoBitState, string> = {
  SN: 'Strongly NT',
  WN: 'Weakly NT',
  WT: 'Weakly T',
  ST: 'Strongly T',
};

const TWO_BIT_PREDICT: Record<TwoBitState, BranchOutcome> = {
  SN: 'NT',
  WN: 'NT',
  WT: 'T',
  ST: 'T',
};

const SCENARIO_PRESETS: Record<string, ScenarioPreset> = {
  loop: {
    label: 'Loop Pattern (TTTTNT)',
    desc: 'Typical loop: taken many times, then falls through',
    pattern: ['T', 'T', 'T', 'T', 'N' + 'T' === 'NT' ? 'NT' : 'NT', 'T', 'T', 'T', 'T', 'NT', 'T', 'T', 'T', 'T', 'NT', 'T', 'T', 'T', 'T', 'NT'] as BranchOutcome[],
  },
  alternating: {
    label: 'Alternating (TNTN)',
    desc: 'Branch alternates between taken and not taken',
    pattern: ['T', 'NT', 'T', 'NT', 'T', 'NT', 'T', 'NT', 'T', 'NT', 'T', 'NT', 'T', 'NT', 'T', 'NT', 'T', 'NT', 'T', 'NT'],
  },
  random: {
    label: 'Random',
    desc: 'Randomly generated branch outcomes',
    pattern: [],
  },
  nested_loop: {
    label: 'Nested Loop',
    desc: 'Inner loop (TTT NT) repeated by outer loop',
    pattern: ['T', 'T', 'T', 'NT', 'T', 'T', 'T', 'NT', 'T', 'T', 'T', 'NT', 'T', 'T', 'T', 'NT', 'T', 'T', 'T', 'NT'],
  },
  mostly_taken: {
    label: 'Mostly Taken',
    desc: 'Branches are mostly taken with rare not-taken',
    pattern: ['T', 'T', 'T', 'T', 'T', 'T', 'T', 'NT', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'NT', 'T', 'T', 'T', 'T'],
  },
};

// Fix the loop pattern (was a weird expression)
SCENARIO_PRESETS.loop.pattern = ['T', 'T', 'T', 'T', 'NT', 'T', 'T', 'T', 'T', 'NT', 'T', 'T', 'T', 'T', 'NT', 'T', 'T', 'T', 'T', 'NT'];

const BHT_SIZE = 8; // 8 entries, indexed by PC[4:2]
const MISPREDICTION_PENALTY = 3; // cycles

// ──────────────────────────── Simulation Logic ────────────────────────────

function createDefaultBHTEntry(): BHTEntry {
  return {
    tag: 0,
    state1Bit: false, // Predict Not Taken initially
    state2Bit: 'WN',
    localState: 'WN',
    globalState: 'WN',
    chooser: 1, // slightly prefer local
    accessCount: 0,
    lastAccess: -1,
  };
}

function createDefaultBHT(): BHTEntry[] {
  return Array.from({ length: BHT_SIZE }, () => createDefaultBHTEntry());
}

function getBHTIndex(pc: number): number {
  return (pc >> 2) & (BHT_SIZE - 1);
}

function next2BitState(state: TwoBitState, taken: boolean): TwoBitState {
  const idx = TWO_BIT_STATES.indexOf(state);
  if (taken) {
    return TWO_BIT_STATES[Math.min(idx + 1, 3)];
  } else {
    return TWO_BIT_STATES[Math.max(idx - 1, 0)];
  }
}

function predict(
  type: PredictorType,
  entry: BHTEntry
): { prediction: BranchOutcome; detail: string } {
  switch (type) {
    case 'always-taken':
      return { prediction: 'T', detail: 'Always Taken' };
    case 'always-not-taken':
      return { prediction: 'NT', detail: 'Always Not Taken' };
    case '1-bit':
      return {
        prediction: entry.state1Bit ? 'T' : 'NT',
        detail: entry.state1Bit ? 'Predict Taken' : 'Predict Not Taken',
      };
    case '2-bit':
      return {
        prediction: TWO_BIT_PREDICT[entry.state2Bit],
        detail: TWO_BIT_SHORT[entry.state2Bit],
      };
    case 'tournament': {
      const localPred = TWO_BIT_PREDICT[entry.localState];
      const globalPred = TWO_BIT_PREDICT[entry.globalState];
      const useGlobal = entry.chooser >= 2;
      const prediction = useGlobal ? globalPred : localPred;
      return {
        prediction,
        detail: `${useGlobal ? 'Global' : 'Local'} selected (chooser=${entry.chooser})`,
      };
    }
  }
}

function updatePredictor(
  type: PredictorType,
  entry: BHTEntry,
  actual: BranchOutcome,
  step: number
): BHTEntry {
  const taken = actual === 'T';
  const newEntry = { ...entry, accessCount: entry.accessCount + 1, lastAccess: step };

  switch (type) {
    case 'always-taken':
    case 'always-not-taken':
      return newEntry;
    case '1-bit':
      newEntry.state1Bit = taken;
      return newEntry;
    case '2-bit':
      newEntry.state2Bit = next2BitState(entry.state2Bit, taken);
      return newEntry;
    case 'tournament': {
      const localPred = TWO_BIT_PREDICT[entry.localState];
      const globalPred = TWO_BIT_PREDICT[entry.globalState];
      const localCorrect = localPred === actual;
      const globalCorrect = globalPred === actual;

      // Update chooser: if they disagree, shift towards the one that was right
      if (localCorrect && !globalCorrect) {
        newEntry.chooser = Math.max(0, entry.chooser - 1);
      } else if (!localCorrect && globalCorrect) {
        newEntry.chooser = Math.min(3, entry.chooser + 1);
      }

      // Update both sub-predictors
      newEntry.localState = next2BitState(entry.localState, taken);
      newEntry.globalState = next2BitState(entry.globalState, taken);
      return newEntry;
    }
  }
}

function generateRandomPattern(length: number): BranchOutcome[] {
  const pattern: BranchOutcome[] = [];
  for (let i = 0; i < length; i++) {
    pattern.push(Math.random() < 0.55 ? 'T' : 'NT');
  }
  return pattern;
}

function generatePCSequence(length: number): number[] {
  // Generate varied PC addresses for BHT indexing
  const pcs: number[] = [];
  const basePCs = [0x100, 0x120, 0x148, 0x170];
  for (let i = 0; i < length; i++) {
    pcs.push(basePCs[i % basePCs.length]);
  }
  return pcs;
}

// ──────────────────────────── Component ────────────────────────────

export default function BranchPredictionModule() {
  // ── Core State ──
  const [predictorType, setPredictorType] = useState<PredictorType>('2-bit');
  const [branchPattern, setBranchPattern] = useState<BranchOutcome[]>([]);
  const [pcSequence, setPCSequence] = useState<number[]>([]);
  const [bht, setBht] = useState<BHTEntry[]>(createDefaultBHT);
  const [currentStep, setCurrentStep] = useState(0);
  const [history, setHistory] = useState<PredictionRecord[]>([]);
  const [activeScenario, setActiveScenario] = useState('loop');

  // ── Animation State ──
  const [lastPrediction, setLastPrediction] = useState<PredictionRecord | null>(null);
  const [flashResult, setFlashResult] = useState<'correct' | 'incorrect' | null>(null);

  // ── Controls State ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);

  // ── Animation Refs ──
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // ── Derived Metrics ──
  const totalPredictions = history.length;
  const correctPredictions = history.filter((h) => h.correct).length;
  const incorrectPredictions = totalPredictions - correctPredictions;
  const accuracy = totalPredictions > 0 ? (correctPredictions / totalPredictions) * 100 : 0;
  const totalPenaltyCycles = incorrectPredictions * MISPREDICTION_PENALTY;
  const simulationDone = currentStep >= branchPattern.length && branchPattern.length > 0;

  // ── Step Forward ──
  const stepForward = useCallback(() => {
    setBranchPattern((pattern) => {
      if (currentStep >= pattern.length) {
        setIsPlaying(false);
        return pattern;
      }

      const pc = pcSequence[currentStep] || 0x100;
      const bhtIdx = getBHTIndex(pc);

      setBht((prevBht) => {
        const entry = prevBht[bhtIdx];
        const { prediction, detail } = predict(predictorType, entry);
        const actual = pattern[currentStep];
        const correct = prediction === actual;

        const record: PredictionRecord = {
          step: currentStep,
          pc,
          actual,
          predicted: prediction,
          correct,
          predictorState: detail,
        };

        setHistory((prev) => [...prev, record]);
        setLastPrediction(record);
        setFlashResult(correct ? 'correct' : 'incorrect');
        setTimeout(() => setFlashResult(null), 600);

        const updatedBht = [...prevBht];
        updatedBht[bhtIdx] = updatePredictor(predictorType, entry, actual, currentStep);
        return updatedBht;
      });

      setCurrentStep((s) => s + 1);
      return pattern;
    });
  }, [currentStep, pcSequence, predictorType]);

  // ── Animation Loop ──
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

  // ── Play/Pause Effects ──
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
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, animationLoop]);

  // ── Stop when done ──
  useEffect(() => {
    if (simulationDone) {
      setIsPlaying(false);
    }
  }, [simulationDone]);

  // ── Handlers ──
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleStep = useCallback(() => {
    if (!simulationDone) stepForward();
  }, [stepForward, simulationDone]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    setCurrentStep(0);
    setHistory([]);
    setBht(createDefaultBHT());
    setLastPrediction(null);
    setFlashResult(null);
  }, []);

  const loadScenario = useCallback(
    (key: string) => {
      handleReset();
      setActiveScenario(key);
      const scenario = SCENARIO_PRESETS[key];
      if (!scenario) return;

      let pattern: BranchOutcome[];
      if (key === 'random') {
        pattern = generateRandomPattern(20);
      } else {
        pattern = [...scenario.pattern];
      }
      setBranchPattern(pattern);
      setPCSequence(generatePCSequence(pattern.length));
    },
    [handleReset]
  );

  const handlePredictorChange = useCallback(
    (type: PredictorType) => {
      setPredictorType(type);
      handleReset();
    },
    [handleReset]
  );

  // ── Load default scenario on mount ──
  useEffect(() => {
    loadScenario('loop');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scroll history into view ──
  const historyEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [history]);

  // ──────────────────────────── FSM Diagram Helpers ────────────────────────────

  const get1BitCurrentState = (): boolean => {
    if (history.length === 0) return false;
    const lastEntry = bht[getBHTIndex(pcSequence[currentStep - 1] || 0x100)];
    return lastEntry?.state1Bit ?? false;
  };

  const get2BitCurrentState = (): TwoBitState => {
    if (history.length === 0) return 'WN';
    const lastEntry = bht[getBHTIndex(pcSequence[currentStep - 1] || 0x100)];
    return lastEntry?.state2Bit ?? 'WN';
  };

  // ──────────────────────────── Render ────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />

      <main className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* ── Header ── */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span
                className="px-2.5 py-0.5 rounded-md text-xs font-mono font-semibold"
                style={{
                  backgroundColor: `${DOMAIN_COLOR}15`,
                  color: DOMAIN_COLOR,
                  border: `1px solid ${DOMAIN_COLOR}30`,
                }}
              >
                2.4
              </span>
              <span className="text-xs text-[#71717a]">CPU Architecture</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Branch Prediction{' '}
              <span className="text-[#71717a] font-normal">Simulator</span>
            </h1>
            <p className="text-sm text-[#a1a1aa] max-w-2xl mt-1">
              Explore how CPUs predict branch outcomes to keep pipelines full.
              Compare static, 1-bit, 2-bit saturating, and tournament predictors
              with real-time accuracy tracking and state machine visualization.
            </p>
          </div>

          {/* ── Predictor Type Selector ── */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Target size={14} className="text-[#8b5cf6]" />
              <span className="text-xs uppercase tracking-wider text-[#71717a] font-semibold">
                Predictor Type
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {PREDICTOR_TYPES.map((pt) => (
                <button
                  key={pt.value}
                  onClick={() => handlePredictorChange(pt.value)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 border ${
                    predictorType === pt.value
                      ? 'bg-[#8b5cf6]/15 text-[#8b5cf6] border-[#8b5cf6]/30'
                      : 'bg-[#111118] text-[#a1a1aa] border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white'
                  }`}
                  title={pt.desc}
                >
                  {pt.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Controls Bar ── */}
          <div className="mb-6">
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

          {/* ── Scenario Presets ── */}
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className="text-xs text-[#71717a] mr-1 font-medium uppercase tracking-wider">
              Presets:
            </span>
            {Object.entries(SCENARIO_PRESETS).map(([key, scenario]) => (
              <button
                key={key}
                onClick={() => loadScenario(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 border ${
                  activeScenario === key
                    ? 'bg-[#8b5cf6]/15 text-[#8b5cf6] border-[#8b5cf6]/30'
                    : 'bg-[#111118] text-[#a1a1aa] border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white'
                }`}
                title={scenario.desc}
              >
                {scenario.label}
              </button>
            ))}
          </div>

          {/* ── Main Grid ── */}
          <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
            {/* ── Left Sidebar ── */}
            <div className="space-y-4">
              {/* Branch History Chips */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <GitBranch size={14} className="text-[#8b5cf6]" />
                  Branch Sequence
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {branchPattern.map((outcome, i) => {
                    const isPast = i < currentStep;
                    const isCurrent = i === currentStep;
                    const record = history[i];

                    return (
                      <motion.div
                        key={i}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: i * 0.02 }}
                        className={`relative w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold border transition-all duration-200 ${
                          isCurrent
                            ? 'border-[#8b5cf6] bg-[#8b5cf6]/20 ring-2 ring-[#8b5cf6]/30'
                            : isPast
                            ? record?.correct
                              ? 'border-[#10b981]/40 bg-[#10b981]/10'
                              : 'border-[#ef4444]/40 bg-[#ef4444]/10'
                            : 'border-[#1e1e2e] bg-[#0f0f17]'
                        }`}
                        title={`Branch ${i + 1}: ${outcome}${isPast && record ? ` (Predicted: ${record.predicted}, ${record.correct ? 'Correct' : 'Wrong'})` : ''}`}
                      >
                        <span
                          className={
                            isPast
                              ? record?.correct
                                ? 'text-[#10b981]'
                                : 'text-[#ef4444]'
                              : isCurrent
                              ? 'text-[#8b5cf6]'
                              : 'text-[#71717a]'
                          }
                        >
                          {outcome}
                        </span>
                        {isPast && record && (
                          <div
                            className={`absolute -top-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center ${
                              record.correct ? 'bg-[#10b981]' : 'bg-[#ef4444]'
                            }`}
                          >
                            {record.correct ? (
                              <CheckCircle size={8} className="text-white" />
                            ) : (
                              <XCircle size={8} className="text-white" />
                            )}
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                  {branchPattern.length === 0 && (
                    <p className="text-xs text-[#71717a] italic py-2">
                      Choose a scenario preset to load a branch pattern.
                    </p>
                  )}
                </div>
              </div>

              {/* Last Prediction Result */}
              <AnimatePresence mode="wait">
                {lastPrediction && (
                  <motion.div
                    key={lastPrediction.step}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className={`p-4 rounded-xl border transition-all duration-300 ${
                      flashResult === 'correct'
                        ? 'bg-[#10b981]/10 border-[#10b981]/30'
                        : flashResult === 'incorrect'
                        ? 'bg-[#ef4444]/10 border-[#ef4444]/30'
                        : 'bg-[#111118] border-[#1e1e2e]'
                    }`}
                  >
                    <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                      <Zap size={14} className="text-[#f59e0b]" />
                      Last Prediction
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1">
                          Predicted
                        </div>
                        <div
                          className={`text-lg font-bold font-mono ${
                            lastPrediction.predicted === 'T'
                              ? 'text-[#10b981]'
                              : 'text-[#ef4444]'
                          }`}
                        >
                          {lastPrediction.predicted === 'T' ? 'Taken' : 'Not Taken'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1">
                          Actual
                        </div>
                        <div
                          className={`text-lg font-bold font-mono ${
                            lastPrediction.actual === 'T'
                              ? 'text-[#10b981]'
                              : 'text-[#ef4444]'
                          }`}
                        >
                          {lastPrediction.actual === 'T' ? 'Taken' : 'Not Taken'}
                        </div>
                      </div>
                    </div>
                    <motion.div
                      initial={{ scale: 0.8 }}
                      animate={{ scale: 1 }}
                      className={`mt-3 px-3 py-1.5 rounded-lg text-center text-sm font-semibold ${
                        lastPrediction.correct
                          ? 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/25'
                          : 'bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/25'
                      }`}
                    >
                      {lastPrediction.correct ? 'CORRECT' : `MISPREDICTION (+${MISPREDICTION_PENALTY} cycle penalty)`}
                    </motion.div>
                    <div className="mt-2 text-[10px] text-[#71717a] font-mono">
                      State: {lastPrediction.predictorState}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Branch History Table (BHT) */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <BarChart3 size={14} className="text-[#06b6d4]" />
                  Branch History Table
                </h3>
                <div className="space-y-1">
                  <div className="grid grid-cols-[40px_1fr_60px_40px] gap-2 px-2 py-1 text-[9px] uppercase tracking-wider text-[#71717a] font-semibold">
                    <span>Idx</span>
                    <span>State</span>
                    <span>Pred</span>
                    <span>Hits</span>
                  </div>
                  {bht.map((entry, idx) => {
                    const isActive =
                      currentStep > 0 &&
                      getBHTIndex(pcSequence[currentStep - 1] || 0x100) === idx;
                    const predResult = predict(predictorType, entry);

                    return (
                      <motion.div
                        key={idx}
                        animate={{
                          backgroundColor: isActive
                            ? 'rgba(139, 92, 246, 0.1)'
                            : 'rgba(15, 15, 23, 0.5)',
                        }}
                        className={`grid grid-cols-[40px_1fr_60px_40px] gap-2 px-2 py-1.5 rounded-lg border transition-all duration-200 ${
                          isActive
                            ? 'border-[#8b5cf6]/30'
                            : 'border-transparent'
                        }`}
                      >
                        <span className="text-[10px] font-mono text-[#71717a]">
                          [{idx}]
                        </span>
                        <span className="text-[10px] font-mono text-[#a1a1aa] truncate">
                          {predictorType === '1-bit'
                            ? entry.state1Bit
                              ? 'PT'
                              : 'PNT'
                            : predictorType === '2-bit'
                            ? TWO_BIT_SHORT[entry.state2Bit]
                            : predictorType === 'tournament'
                            ? `L:${entry.localState} G:${entry.globalState}`
                            : '--'}
                        </span>
                        <span
                          className={`text-[10px] font-mono font-bold ${
                            predResult.prediction === 'T'
                              ? 'text-[#10b981]'
                              : 'text-[#ef4444]'
                          }`}
                        >
                          {predResult.prediction}
                        </span>
                        <span className="text-[10px] font-mono text-[#71717a]">
                          {entry.accessCount}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* Info Panel */}
              <div className="p-4 rounded-xl bg-[#0f0f17] border border-[#1e1e2e]/50">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-[#8b5cf6] mt-0.5 shrink-0" />
                  <div className="text-[11px] text-[#71717a] leading-relaxed">
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">1-Bit:</strong>{' '}
                      Predicts based on last outcome. Mispredicts twice per loop exit.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#a1a1aa]">2-Bit Saturating:</strong>{' '}
                      Needs two consecutive wrong outcomes to change prediction. Better for loops.
                    </p>
                    <p>
                      <strong className="text-[#a1a1aa]">Tournament:</strong>{' '}
                      Runs local and global predictors in parallel; a chooser counter selects the more accurate one.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Right: Main Visualization ── */}
            <div className="space-y-6 min-w-0">
              {/* ── Metrics Bar ── */}
              <AnimatePresence>
                {showMetrics && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                      {[
                        { label: 'Predictions', value: totalPredictions.toString(), color: '#8b5cf6' },
                        { label: 'Correct', value: correctPredictions.toString(), color: '#10b981' },
                        { label: 'Incorrect', value: incorrectPredictions.toString(), color: '#ef4444' },
                        { label: 'Accuracy', value: `${accuracy.toFixed(1)}%`, color: '#06b6d4' },
                        { label: 'Penalty Cycles', value: totalPenaltyCycles.toString(), color: '#f59e0b' },
                        { label: 'Misp. Penalty', value: `${MISPREDICTION_PENALTY} cyc`, color: '#71717a' },
                      ].map((metric) => (
                        <div
                          key={metric.label}
                          className="p-3 rounded-xl bg-[#111118] border border-[#1e1e2e]"
                        >
                          <div
                            className="text-[10px] uppercase tracking-wider font-medium mb-1"
                            style={{ color: metric.color }}
                          >
                            {metric.label}
                          </div>
                          <div className="text-xl font-bold font-mono text-white">
                            {metric.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── FSM Diagram ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <Cpu size={14} className="text-[#8b5cf6]" />
                  Predictor State Machine
                </h3>

                {predictorType === 'always-taken' || predictorType === 'always-not-taken' ? (
                  <StaticPredictorDiagram type={predictorType} />
                ) : predictorType === '1-bit' ? (
                  <OneBitFSM currentState={get1BitCurrentState()} lastPrediction={lastPrediction} />
                ) : predictorType === '2-bit' ? (
                  <TwoBitFSM currentState={get2BitCurrentState()} lastPrediction={lastPrediction} />
                ) : (
                  <TournamentDiagram
                    bht={bht}
                    pcSequence={pcSequence}
                    currentStep={currentStep}
                    lastPrediction={lastPrediction}
                  />
                )}
              </div>

              {/* ── Accuracy Bar Chart ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp size={14} className="text-[#10b981]" />
                  Running Accuracy
                </h3>

                {history.length === 0 ? (
                  <div className="py-8 text-center">
                    <TrendingUp size={32} className="mx-auto text-[#71717a]/20 mb-2" />
                    <p className="text-sm text-[#71717a]">
                      Press <span className="font-mono text-[#8b5cf6]">Play</span> or{' '}
                      <span className="font-mono text-[#8b5cf6]">Step</span> to begin
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Accuracy progress bar */}
                    <div className="relative h-8 rounded-lg bg-[#0f0f17] border border-[#1e1e2e] overflow-hidden">
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded-lg"
                        style={{ backgroundColor: accuracy >= 70 ? '#10b981' : accuracy >= 40 ? '#f59e0b' : '#ef4444' }}
                        animate={{ width: `${accuracy}%` }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center text-xs font-mono font-bold text-white">
                        {accuracy.toFixed(1)}% accuracy
                      </div>
                    </div>

                    {/* Per-step accuracy chart */}
                    <div className="flex items-end gap-[2px] h-24 px-1">
                      {history.map((record, i) => {
                        // Running accuracy at this point
                        const runningCorrect = history
                          .slice(0, i + 1)
                          .filter((r) => r.correct).length;
                        const runningAcc = (runningCorrect / (i + 1)) * 100;

                        return (
                          <motion.div
                            key={i}
                            initial={{ height: 0 }}
                            animate={{ height: `${runningAcc}%` }}
                            transition={{ duration: 0.2, delay: 0.02 }}
                            className="flex-1 min-w-[4px] max-w-[20px] rounded-t-sm relative group cursor-default"
                            style={{
                              backgroundColor: record.correct ? '#10b981' : '#ef4444',
                              opacity: 0.7,
                            }}
                            title={`Step ${i + 1}: ${record.correct ? 'Correct' : 'Wrong'} (Running: ${runningAcc.toFixed(0)}%)`}
                          >
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block px-1.5 py-0.5 rounded bg-[#1e1e2e] text-[8px] font-mono text-white whitespace-nowrap z-10">
                              {runningAcc.toFixed(0)}%
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[9px] text-[#71717a] font-mono px-1">
                      <span>Step 1</span>
                      <span>Step {history.length}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Prediction History Table ── */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <GitBranch size={14} className="text-[#06b6d4]" />
                  Prediction History
                </h3>

                {history.length === 0 ? (
                  <div className="py-8 text-center">
                    <GitBranch size={32} className="mx-auto text-[#71717a]/20 mb-2" />
                    <p className="text-sm text-[#71717a]">
                      No predictions yet. Start the simulation.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                    <table className="w-full border-collapse">
                      <thead className="sticky top-0 bg-[#111118] z-10">
                        <tr>
                          <th className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">
                            Step
                          </th>
                          <th className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">
                            PC
                          </th>
                          <th className="text-center text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">
                            Predicted
                          </th>
                          <th className="text-center text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">
                            Actual
                          </th>
                          <th className="text-center text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2 pr-3">
                            Result
                          </th>
                          <th className="text-left text-[10px] uppercase tracking-wider text-[#71717a] font-semibold pb-2">
                            State
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <AnimatePresence>
                          {history.map((record) => (
                            <motion.tr
                              key={record.step}
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.15 }}
                              className="border-t border-[#1e1e2e]/40"
                            >
                              <td className="py-1.5 pr-3 text-xs font-mono text-[#71717a]">
                                {record.step + 1}
                              </td>
                              <td className="py-1.5 pr-3 text-xs font-mono text-[#a1a1aa]">
                                0x{record.pc.toString(16).toUpperCase()}
                              </td>
                              <td className="py-1.5 pr-3 text-center">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                                    record.predicted === 'T'
                                      ? 'bg-[#10b981]/10 text-[#10b981]'
                                      : 'bg-[#ef4444]/10 text-[#ef4444]'
                                  }`}
                                >
                                  {record.predicted}
                                </span>
                              </td>
                              <td className="py-1.5 pr-3 text-center">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                                    record.actual === 'T'
                                      ? 'bg-[#10b981]/10 text-[#10b981]'
                                      : 'bg-[#ef4444]/10 text-[#ef4444]'
                                  }`}
                                >
                                  {record.actual}
                                </span>
                              </td>
                              <td className="py-1.5 pr-3 text-center">
                                {record.correct ? (
                                  <CheckCircle size={14} className="inline text-[#10b981]" />
                                ) : (
                                  <XCircle size={14} className="inline text-[#ef4444]" />
                                )}
                              </td>
                              <td className="py-1.5 text-[10px] font-mono text-[#71717a]">
                                {record.predictorState}
                              </td>
                            </motion.tr>
                          ))}
                        </AnimatePresence>
                      </tbody>
                    </table>
                    <div ref={historyEndRef} />
                  </div>
                )}

                {/* Simulation complete */}
                <AnimatePresence>
                  {simulationDone && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-4 p-3 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20 flex items-center gap-2"
                    >
                      <div className="w-2 h-2 rounded-full bg-[#10b981]" />
                      <span className="text-xs text-[#10b981] font-medium">
                        Simulation complete &mdash; {correctPredictions}/{totalPredictions} correct
                        ({accuracy.toFixed(1)}% accuracy, {totalPenaltyCycles} penalty cycles)
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ──────────────────────────── Sub-Components ────────────────────────────

// Static predictor diagram (Always Taken / Always Not Taken)
function StaticPredictorDiagram({ type }: { type: 'always-taken' | 'always-not-taken' }) {
  const isTaken = type === 'always-taken';

  return (
    <div className="flex items-center justify-center py-8">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex flex-col items-center gap-4"
      >
        <div
          className={`w-32 h-32 rounded-full border-4 flex items-center justify-center ${
            isTaken
              ? 'border-[#10b981] bg-[#10b981]/10'
              : 'border-[#ef4444] bg-[#ef4444]/10'
          }`}
        >
          <div className="text-center">
            <div
              className={`text-lg font-bold ${
                isTaken ? 'text-[#10b981]' : 'text-[#ef4444]'
              }`}
            >
              {isTaken ? 'TAKEN' : 'NOT TAKEN'}
            </div>
            <div className="text-[10px] text-[#71717a] mt-1">Always</div>
          </div>
        </div>
        <div className="text-xs text-[#71717a] max-w-xs text-center">
          Static predictor: always predicts{' '}
          <span className={isTaken ? 'text-[#10b981] font-bold' : 'text-[#ef4444] font-bold'}>
            {isTaken ? 'Taken' : 'Not Taken'}
          </span>
          . No learning, no state changes.
        </div>

        {/* Self-loop arrow */}
        <svg width="180" height="50" className="overflow-visible">
          <defs>
            <marker id="arrow-static" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6" fill={isTaken ? '#10b981' : '#ef4444'} />
            </marker>
          </defs>
          <path
            d="M50,30 C50,0 130,0 130,30"
            fill="none"
            stroke={isTaken ? '#10b981' : '#ef4444'}
            strokeWidth="2"
            markerEnd="url(#arrow-static)"
            opacity="0.5"
          />
          <text x="90" y="12" textAnchor="middle" fill="#71717a" fontSize="9" fontFamily="monospace">
            T / NT
          </text>
        </svg>
      </motion.div>
    </div>
  );
}

// 1-Bit FSM diagram
function OneBitFSM({
  currentState,
  lastPrediction,
}: {
  currentState: boolean;
  lastPrediction: PredictionRecord | null;
}) {
  const states = [
    { id: 'pnt', label: 'Predict\nNot Taken', x: 120, y: 100, active: !currentState, color: '#ef4444' },
    { id: 'pt', label: 'Predict\nTaken', x: 360, y: 100, active: currentState, color: '#10b981' },
  ];

  return (
    <div className="flex justify-center py-4">
      <svg width="480" height="200" className="overflow-visible">
        <defs>
          <marker id="arrow-1b" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8" fill="#8b5cf6" />
          </marker>
          <marker id="arrow-1b-dim" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8" fill="#71717a" />
          </marker>
        </defs>

        {/* Transition arrows */}
        {/* PNT -> PT (on Taken) */}
        <path
          d="M175,80 C240,30 300,30 340,80"
          fill="none"
          stroke={lastPrediction && !lastPrediction.correct && lastPrediction.actual === 'T' ? '#8b5cf6' : '#71717a'}
          strokeWidth={lastPrediction && !lastPrediction.correct && lastPrediction.actual === 'T' ? 2.5 : 1.5}
          strokeDasharray={lastPrediction && !lastPrediction.correct && lastPrediction.actual === 'T' ? 'none' : '4,4'}
          markerEnd={lastPrediction && !lastPrediction.correct && lastPrediction.actual === 'T' ? 'url(#arrow-1b)' : 'url(#arrow-1b-dim)'}
        />
        <text x="250" y="40" textAnchor="middle" fill="#10b981" fontSize="10" fontFamily="monospace">
          Taken
        </text>

        {/* PT -> PNT (on Not Taken) */}
        <path
          d="M305,120 C260,170 200,170 165,120"
          fill="none"
          stroke={lastPrediction && !lastPrediction.correct && lastPrediction.actual === 'NT' ? '#8b5cf6' : '#71717a'}
          strokeWidth={lastPrediction && !lastPrediction.correct && lastPrediction.actual === 'NT' ? 2.5 : 1.5}
          strokeDasharray={lastPrediction && !lastPrediction.correct && lastPrediction.actual === 'NT' ? 'none' : '4,4'}
          markerEnd={lastPrediction && !lastPrediction.correct && lastPrediction.actual === 'NT' ? 'url(#arrow-1b)' : 'url(#arrow-1b-dim)'}
        />
        <text x="240" y="178" textAnchor="middle" fill="#ef4444" fontSize="10" fontFamily="monospace">
          Not Taken
        </text>

        {/* Self-loop PNT (on Not Taken stays) */}
        <path
          d="M80,80 C40,30 40,170 80,120"
          fill="none"
          stroke={lastPrediction && lastPrediction.correct && lastPrediction.actual === 'NT' ? '#8b5cf6' : '#71717a'}
          strokeWidth={lastPrediction && lastPrediction.correct && lastPrediction.actual === 'NT' ? 2.5 : 1.5}
          strokeDasharray={lastPrediction && lastPrediction.correct && lastPrediction.actual === 'NT' ? 'none' : '4,4'}
          markerEnd={lastPrediction && lastPrediction.correct && lastPrediction.actual === 'NT' ? 'url(#arrow-1b)' : 'url(#arrow-1b-dim)'}
        />
        <text x="28" y="105" textAnchor="middle" fill="#71717a" fontSize="9" fontFamily="monospace">
          NT
        </text>

        {/* Self-loop PT (on Taken stays) */}
        <path
          d="M400,80 C440,30 440,170 400,120"
          fill="none"
          stroke={lastPrediction && lastPrediction.correct && lastPrediction.actual === 'T' ? '#8b5cf6' : '#71717a'}
          strokeWidth={lastPrediction && lastPrediction.correct && lastPrediction.actual === 'T' ? 2.5 : 1.5}
          strokeDasharray={lastPrediction && lastPrediction.correct && lastPrediction.actual === 'T' ? 'none' : '4,4'}
          markerEnd={lastPrediction && lastPrediction.correct && lastPrediction.actual === 'T' ? 'url(#arrow-1b)' : 'url(#arrow-1b-dim)'}
        />
        <text x="455" y="105" textAnchor="middle" fill="#71717a" fontSize="9" fontFamily="monospace">
          T
        </text>

        {/* State circles */}
        {states.map((s) => (
          <g key={s.id}>
            <motion.circle
              cx={s.x}
              cy={s.y}
              r={45}
              fill={s.active ? `${s.color}20` : '#0f0f17'}
              stroke={s.active ? s.color : '#1e1e2e'}
              strokeWidth={s.active ? 3 : 1.5}
              animate={{
                scale: s.active ? [1, 1.05, 1] : 1,
              }}
              transition={{ duration: 0.5 }}
            />
            {s.active && (
              <motion.circle
                cx={s.x}
                cy={s.y}
                r={48}
                fill="none"
                stroke={s.color}
                strokeWidth={1}
                opacity={0.3}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1.1, opacity: [0, 0.4, 0] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            )}
            {s.label.split('\n').map((line, i) => (
              <text
                key={i}
                x={s.x}
                y={s.y + (i - 0.5) * 14}
                textAnchor="middle"
                fill={s.active ? s.color : '#71717a'}
                fontSize="11"
                fontWeight={s.active ? 'bold' : 'normal'}
                fontFamily="monospace"
              >
                {line}
              </text>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

// 2-Bit FSM diagram
function TwoBitFSM({
  currentState,
  lastPrediction,
}: {
  currentState: TwoBitState;
  lastPrediction: PredictionRecord | null;
}) {
  const statePositions: Record<TwoBitState, { x: number; y: number }> = {
    SN: { x: 100, y: 100 },
    WN: { x: 260, y: 100 },
    WT: { x: 420, y: 100 },
    ST: { x: 580, y: 100 },
  };

  const stateColors: Record<TwoBitState, string> = {
    SN: '#ef4444',
    WN: '#f59e0b',
    WT: '#06b6d4',
    ST: '#10b981',
  };

  // Transitions: [from, to, label, taken]
  const transitions: [TwoBitState, TwoBitState, string, boolean][] = [
    ['SN', 'WN', 'T', true],
    ['WN', 'WT', 'T', true],
    ['WT', 'ST', 'T', true],
    ['ST', 'ST', 'T', true],
    ['ST', 'WT', 'NT', false],
    ['WT', 'WN', 'NT', false],
    ['WN', 'SN', 'NT', false],
    ['SN', 'SN', 'NT', false],
  ];

  return (
    <div className="flex justify-center py-4 overflow-x-auto">
      <svg width="680" height="220" className="overflow-visible">
        <defs>
          <marker id="arrow-2b" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8" fill="#8b5cf6" />
          </marker>
          <marker id="arrow-2b-dim" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8" fill="#71717a" />
          </marker>
          <marker id="arrow-2b-green" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8" fill="#10b981" />
          </marker>
          <marker id="arrow-2b-red" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8" fill="#ef4444" />
          </marker>
        </defs>

        {/* Forward transitions (Taken) - arcs above */}
        {transitions
          .filter(([from, to, , taken]) => taken && from !== to)
          .map(([from, to, label], i) => {
            const fx = statePositions[from].x;
            const tx = statePositions[to].x;
            const midX = (fx + tx) / 2;
            const isActive =
              lastPrediction &&
              currentState === to &&
              lastPrediction.actual === 'T';

            return (
              <g key={`t-fwd-${i}`}>
                <path
                  d={`M${fx + 35},${80} Q${midX},${30} ${tx - 35},${80}`}
                  fill="none"
                  stroke={isActive ? '#10b981' : '#71717a'}
                  strokeWidth={isActive ? 2.5 : 1}
                  strokeDasharray={isActive ? 'none' : '3,3'}
                  markerEnd={isActive ? 'url(#arrow-2b-green)' : 'url(#arrow-2b-dim)'}
                  opacity={isActive ? 1 : 0.4}
                />
                <text x={midX} y={38} textAnchor="middle" fill="#10b981" fontSize="9" fontFamily="monospace" opacity={isActive ? 1 : 0.5}>
                  {label}
                </text>
              </g>
            );
          })}

        {/* Backward transitions (Not Taken) - arcs below */}
        {transitions
          .filter(([from, to, , taken]) => !taken && from !== to)
          .map(([from, to, label], i) => {
            const fx = statePositions[from].x;
            const tx = statePositions[to].x;
            const midX = (fx + tx) / 2;
            const isActive =
              lastPrediction &&
              currentState === to &&
              lastPrediction.actual === 'NT';

            return (
              <g key={`t-bwd-${i}`}>
                <path
                  d={`M${fx - 35},${120} Q${midX},${185} ${tx + 35},${120}`}
                  fill="none"
                  stroke={isActive ? '#ef4444' : '#71717a'}
                  strokeWidth={isActive ? 2.5 : 1}
                  strokeDasharray={isActive ? 'none' : '3,3'}
                  markerEnd={isActive ? 'url(#arrow-2b-red)' : 'url(#arrow-2b-dim)'}
                  opacity={isActive ? 1 : 0.4}
                />
                <text x={midX} y={195} textAnchor="middle" fill="#ef4444" fontSize="9" fontFamily="monospace" opacity={isActive ? 1 : 0.5}>
                  {label}
                </text>
              </g>
            );
          })}

        {/* Self-loops for SN (NT) and ST (T) */}
        {/* SN self-loop */}
        <path
          d="M60,80 C20,30 20,170 60,120"
          fill="none"
          stroke={currentState === 'SN' && lastPrediction?.actual === 'NT' ? '#ef4444' : '#71717a'}
          strokeWidth={currentState === 'SN' && lastPrediction?.actual === 'NT' ? 2 : 1}
          strokeDasharray={currentState === 'SN' && lastPrediction?.actual === 'NT' ? 'none' : '3,3'}
          markerEnd={currentState === 'SN' && lastPrediction?.actual === 'NT' ? 'url(#arrow-2b-red)' : 'url(#arrow-2b-dim)'}
          opacity={currentState === 'SN' && lastPrediction?.actual === 'NT' ? 1 : 0.3}
        />
        <text x="15" y="105" textAnchor="middle" fill="#71717a" fontSize="8" fontFamily="monospace">
          NT
        </text>

        {/* ST self-loop */}
        <path
          d="M620,80 C660,30 660,170 620,120"
          fill="none"
          stroke={currentState === 'ST' && lastPrediction?.actual === 'T' ? '#10b981' : '#71717a'}
          strokeWidth={currentState === 'ST' && lastPrediction?.actual === 'T' ? 2 : 1}
          strokeDasharray={currentState === 'ST' && lastPrediction?.actual === 'T' ? 'none' : '3,3'}
          markerEnd={currentState === 'ST' && lastPrediction?.actual === 'T' ? 'url(#arrow-2b-green)' : 'url(#arrow-2b-dim)'}
          opacity={currentState === 'ST' && lastPrediction?.actual === 'T' ? 1 : 0.3}
        />
        <text x="668" y="105" textAnchor="middle" fill="#71717a" fontSize="8" fontFamily="monospace">
          T
        </text>

        {/* State circles */}
        {TWO_BIT_STATES.map((state) => {
          const pos = statePositions[state];
          const isActive = currentState === state;
          const color = stateColors[state];
          const predLabel = TWO_BIT_PREDICT[state] === 'T' ? 'Predict T' : 'Predict NT';

          return (
            <g key={state}>
              <motion.circle
                cx={pos.x}
                cy={pos.y}
                r={40}
                fill={isActive ? `${color}20` : '#0f0f17'}
                stroke={isActive ? color : '#1e1e2e'}
                strokeWidth={isActive ? 3 : 1.5}
                animate={{
                  scale: isActive ? [1, 1.05, 1] : 1,
                }}
                transition={{ duration: 0.5 }}
              />
              {isActive && (
                <motion.circle
                  cx={pos.x}
                  cy={pos.y}
                  r={44}
                  fill="none"
                  stroke={color}
                  strokeWidth={1}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.5, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}
              <text
                x={pos.x}
                y={pos.y - 8}
                textAnchor="middle"
                fill={isActive ? color : '#a1a1aa'}
                fontSize="12"
                fontWeight="bold"
                fontFamily="monospace"
              >
                {state}
              </text>
              <text
                x={pos.x}
                y={pos.y + 10}
                textAnchor="middle"
                fill={isActive ? color : '#71717a'}
                fontSize="8"
                fontFamily="monospace"
              >
                {predLabel}
              </text>
            </g>
          );
        })}

        {/* "Not Taken" / "Taken" region labels */}
        <rect x={60} y={155} width={160} height={20} rx={4} fill="#ef4444" opacity={0.08} />
        <text x={140} y={169} textAnchor="middle" fill="#ef4444" fontSize="9" fontWeight="bold" opacity={0.6}>
          Predict Not Taken
        </text>
        <rect x={380} y={155} width={160} height={20} rx={4} fill="#10b981" opacity={0.08} />
        <text x={460} y={169} textAnchor="middle" fill="#10b981" fontSize="9" fontWeight="bold" opacity={0.6}>
          Predict Taken
        </text>
      </svg>
    </div>
  );
}

// Tournament Predictor Diagram
function TournamentDiagram({
  bht,
  pcSequence,
  currentStep,
  lastPrediction,
}: {
  bht: BHTEntry[];
  pcSequence: number[];
  currentStep: number;
  lastPrediction: PredictionRecord | null;
}) {
  const activeIdx =
    currentStep > 0 ? getBHTIndex(pcSequence[currentStep - 1] || 0x100) : 0;
  const entry = bht[activeIdx];

  const localPred = TWO_BIT_PREDICT[entry.localState];
  const globalPred = TWO_BIT_PREDICT[entry.globalState];
  const useGlobal = entry.chooser >= 2;
  const selectedPred = useGlobal ? globalPred : localPred;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Local Predictor */}
        <div
          className={`p-4 rounded-xl border ${
            !useGlobal
              ? 'border-[#8b5cf6]/40 bg-[#8b5cf6]/5'
              : 'border-[#1e1e2e] bg-[#0f0f17]'
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            <div
              className={`w-2 h-2 rounded-full ${
                !useGlobal ? 'bg-[#8b5cf6]' : 'bg-[#71717a]'
              }`}
            />
            <span
              className={`text-xs font-semibold uppercase tracking-wider ${
                !useGlobal ? 'text-[#8b5cf6]' : 'text-[#71717a]'
              }`}
            >
              Local Predictor
            </span>
            {!useGlobal && (
              <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#8b5cf6]/20 text-[#8b5cf6]">
                SELECTED
              </span>
            )}
          </div>

          <div className="flex justify-center py-2">
            <MiniTwoBitFSM state={entry.localState} label="Local" />
          </div>

          <div className="text-center mt-2">
            <span
              className={`text-xs font-mono font-bold ${
                localPred === 'T' ? 'text-[#10b981]' : 'text-[#ef4444]'
              }`}
            >
              Predicts: {localPred === 'T' ? 'Taken' : 'Not Taken'}
            </span>
          </div>
        </div>

        {/* Chooser */}
        <div className="p-4 rounded-xl border border-[#f59e0b]/30 bg-[#f59e0b]/5">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={12} className="text-[#f59e0b]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[#f59e0b]">
              Chooser Counter
            </span>
          </div>

          <div className="flex justify-center gap-2 py-3">
            {[0, 1, 2, 3].map((val) => (
              <motion.div
                key={val}
                animate={{
                  scale: entry.chooser === val ? 1.15 : 1,
                  backgroundColor:
                    entry.chooser === val
                      ? val < 2
                        ? 'rgba(139, 92, 246, 0.3)'
                        : 'rgba(6, 182, 212, 0.3)'
                      : 'rgba(30, 30, 46, 0.5)',
                }}
                className={`w-12 h-12 rounded-lg flex flex-col items-center justify-center border ${
                  entry.chooser === val
                    ? val < 2
                      ? 'border-[#8b5cf6]/50'
                      : 'border-[#06b6d4]/50'
                    : 'border-[#1e1e2e]'
                }`}
              >
                <span
                  className={`text-lg font-bold font-mono ${
                    entry.chooser === val ? 'text-white' : 'text-[#71717a]'
                  }`}
                >
                  {val}
                </span>
                <span className="text-[7px] text-[#71717a] font-mono">
                  {val < 2 ? 'Local' : 'Global'}
                </span>
              </motion.div>
            ))}
          </div>

          <div className="flex justify-between text-[9px] text-[#71717a] mt-1 px-2">
            <span>Prefer Local</span>
            <span>Prefer Global</span>
          </div>

          <div className="text-center mt-3">
            <ArrowRight size={16} className="inline text-[#f59e0b] mb-1" />
            <div className="text-xs font-mono font-bold text-[#f59e0b]">
              Using: {useGlobal ? 'Global' : 'Local'}
            </div>
          </div>
        </div>

        {/* Global Predictor */}
        <div
          className={`p-4 rounded-xl border ${
            useGlobal
              ? 'border-[#06b6d4]/40 bg-[#06b6d4]/5'
              : 'border-[#1e1e2e] bg-[#0f0f17]'
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            <div
              className={`w-2 h-2 rounded-full ${
                useGlobal ? 'bg-[#06b6d4]' : 'bg-[#71717a]'
              }`}
            />
            <span
              className={`text-xs font-semibold uppercase tracking-wider ${
                useGlobal ? 'text-[#06b6d4]' : 'text-[#71717a]'
              }`}
            >
              Global Predictor
            </span>
            {useGlobal && (
              <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#06b6d4]/20 text-[#06b6d4]">
                SELECTED
              </span>
            )}
          </div>

          <div className="flex justify-center py-2">
            <MiniTwoBitFSM state={entry.globalState} label="Global" />
          </div>

          <div className="text-center mt-2">
            <span
              className={`text-xs font-mono font-bold ${
                globalPred === 'T' ? 'text-[#10b981]' : 'text-[#ef4444]'
              }`}
            >
              Predicts: {globalPred === 'T' ? 'Taken' : 'Not Taken'}
            </span>
          </div>
        </div>
      </div>

      {/* Final Prediction */}
      {lastPrediction && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-2"
        >
          <span className="text-xs text-[#71717a]">
            Tournament Output:{' '}
          </span>
          <span
            className={`text-sm font-bold font-mono ${
              selectedPred === 'T' ? 'text-[#10b981]' : 'text-[#ef4444]'
            }`}
          >
            {selectedPred === 'T' ? 'Taken' : 'Not Taken'}
          </span>
        </motion.div>
      )}
    </div>
  );
}

// Mini 2-bit FSM for tournament sub-predictors
function MiniTwoBitFSM({ state, label }: { state: TwoBitState; label: string }) {
  const stateColors: Record<TwoBitState, string> = {
    SN: '#ef4444',
    WN: '#f59e0b',
    WT: '#06b6d4',
    ST: '#10b981',
  };

  return (
    <div className="flex gap-1.5">
      {TWO_BIT_STATES.map((s) => {
        const isActive = state === s;
        const color = stateColors[s];

        return (
          <motion.div
            key={s}
            animate={{
              scale: isActive ? 1.1 : 1,
              borderColor: isActive ? color : '#1e1e2e',
              backgroundColor: isActive ? `${color}20` : '#0f0f17',
            }}
            className="w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all"
          >
            <span
              className="text-[9px] font-mono font-bold"
              style={{ color: isActive ? color : '#71717a' }}
            >
              {s}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}
