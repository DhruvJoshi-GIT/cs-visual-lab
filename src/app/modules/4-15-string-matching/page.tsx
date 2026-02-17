'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Play, Pause, RotateCcw, ChevronRight, Info, Search
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

interface MatchStep {
  textIdx: number;
  patIdx: number;
  comparing: [number, number]; // [text idx, pattern idx]
  matched: number[]; // indices in text that are matched
  description: string;
  isMatch: boolean;
  foundAt?: number;
  skip?: number;
  failureTable?: number[];
}

function naiveSearch(text: string, pattern: string): MatchStep[] {
  const steps: MatchStep[] = [];
  for (let i = 0; i <= text.length - pattern.length; i++) {
    let j = 0;
    while (j < pattern.length) {
      const isMatch = text[i + j] === pattern[j];
      steps.push({
        textIdx: i,
        patIdx: j,
        comparing: [i + j, j],
        matched: Array.from({ length: j }, (_, k) => i + k),
        description: `Compare text[${i + j}]='${text[i + j]}' with pattern[${j}]='${pattern[j]}': ${isMatch ? 'Match!' : 'Mismatch'}`,
        isMatch,
      });
      if (!isMatch) break;
      j++;
    }
    if (j === pattern.length) {
      steps.push({
        textIdx: i, patIdx: j - 1,
        comparing: [i, 0],
        matched: Array.from({ length: pattern.length }, (_, k) => i + k),
        description: `Pattern found at index ${i}!`,
        isMatch: true,
        foundAt: i,
      });
    }
  }
  return steps;
}

function buildFailureTable(pattern: string): number[] {
  const table = Array(pattern.length).fill(0);
  let len = 0;
  let i = 1;
  while (i < pattern.length) {
    if (pattern[i] === pattern[len]) {
      len++;
      table[i] = len;
      i++;
    } else if (len > 0) {
      len = table[len - 1];
    } else {
      table[i] = 0;
      i++;
    }
  }
  return table;
}

function kmpSearch(text: string, pattern: string): MatchStep[] {
  const failure = buildFailureTable(pattern);
  const steps: MatchStep[] = [];
  let i = 0, j = 0;

  while (i < text.length) {
    const isMatch = text[i] === pattern[j];
    steps.push({
      textIdx: i - j,
      patIdx: j,
      comparing: [i, j],
      matched: Array.from({ length: j }, (_, k) => i - j + k),
      description: isMatch
        ? `Compare text[${i}]='${text[i]}' == pattern[${j}]='${pattern[j]}': Match!`
        : `Mismatch at text[${i}]='${text[i]}' vs pattern[${j}]='${pattern[j]}'. Failure table[${j - 1}]=${j > 0 ? failure[j - 1] : 0}`,
      isMatch,
      failureTable: failure,
      skip: !isMatch && j > 0 ? j - failure[j - 1] : undefined,
    });

    if (isMatch) {
      i++;
      j++;
      if (j === pattern.length) {
        steps.push({
          textIdx: i - j, patIdx: j - 1,
          comparing: [i - j, 0],
          matched: Array.from({ length: pattern.length }, (_, k) => i - j + k),
          description: `Pattern found at index ${i - j}!`,
          isMatch: true,
          foundAt: i - j,
          failureTable: failure,
        });
        j = failure[j - 1];
      }
    } else {
      if (j > 0) {
        j = failure[j - 1];
      } else {
        i++;
      }
    }
  }

  return steps;
}

type Algorithm = 'naive' | 'kmp';

const PRESETS = [
  { text: 'ABABDABACDABABCABAB', pattern: 'ABABCABAB' },
  { text: 'AAAAAAAAB', pattern: 'AAAB' },
  { text: 'ABCXABCDABXABCDABCDABCY', pattern: 'ABCDABCY' },
  { text: 'THE QUICK BROWN FOX', pattern: 'BROWN' },
];

export default function StringMatchingPage() {
  const [text, setText] = useState(PRESETS[0].text);
  const [pattern, setPattern] = useState(PRESETS[0].pattern);
  const [algorithm, setAlgorithm] = useState<Algorithm>('kmp');
  const [steps, setSteps] = useState<MatchStep[]>([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const generate = useCallback(() => {
    const s = algorithm === 'kmp' ? kmpSearch(text, pattern) : naiveSearch(text, pattern);
    setSteps(s);
    setCurrentStep(-1);
    setIsPlaying(false);
  }, [text, pattern, algorithm]);

  useEffect(() => { generate(); }, [generate]);

  useEffect(() => {
    if (isPlaying && currentStep < steps.length - 1)
      timerRef.current = setTimeout(() => setCurrentStep(s => s + 1), 500 / speed);
    else if (currentStep >= steps.length - 1) setIsPlaying(false);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, currentStep, speed, steps.length]);

  const handlePlayPause = () => {
    if (currentStep >= steps.length - 1) { setCurrentStep(-1); setTimeout(() => setIsPlaying(true), 50); return; }
    setIsPlaying(!isPlaying);
  };

  const step = currentStep >= 0 ? steps[currentStep] : null;
  const matchedSet = new Set(step?.matched || []);
  const foundPositions = steps.filter(s => s.foundAt !== undefined).map(s => s.foundAt!);
  const comparisons = currentStep + 1;

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Search className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">String Matching</h1>
              <p className="text-sm text-gray-400">Module 4.15 — KMP and Naive pattern matching</p>
            </div>
          </div>
        </div>

        {/* Config */}
        <div className="space-y-3 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Preset:</span>
              {PRESETS.map((p, i) => (
                <button key={i} onClick={() => { setText(p.text); setPattern(p.pattern); }}
                  className="px-2 py-1 rounded text-xs text-gray-400 hover:text-emerald-400 bg-[#1e1e2e]">
                  {i + 1}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Algorithm:</span>
              {(['kmp', 'naive'] as Algorithm[]).map(a => (
                <button key={a} onClick={() => setAlgorithm(a)}
                  className={`px-3 py-1 rounded text-xs font-medium uppercase ${algorithm === a ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400'}`}>
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500">Text</label>
              <input type="text" value={text} onChange={e => setText(e.target.value.toUpperCase())}
                className="w-full mt-1 px-3 py-1.5 rounded bg-[#0a0a0f] border border-[#1e1e2e] text-white text-xs font-mono outline-none focus:border-emerald-500/50" />
            </div>
            <div className="w-48">
              <label className="text-xs text-gray-500">Pattern</label>
              <input type="text" value={pattern} onChange={e => setPattern(e.target.value.toUpperCase())}
                className="w-full mt-1 px-3 py-1.5 rounded bg-[#0a0a0f] border border-[#1e1e2e] text-white text-xs font-mono outline-none focus:border-emerald-500/50" />
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <button onClick={handlePlayPause}
            className="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center hover:bg-emerald-500/30">
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={() => { setIsPlaying(false); if (currentStep < steps.length - 1) setCurrentStep(s => s + 1); }}
            className="px-3 py-2 rounded-lg bg-[#1e1e2e] text-gray-300 text-sm hover:text-white flex items-center gap-1">
            <ChevronRight className="w-4 h-4" /> Step
          </button>
          <button onClick={() => { setIsPlaying(false); setCurrentStep(-1); }}
            className="px-3 py-2 rounded-lg bg-[#1e1e2e] text-gray-300 text-sm hover:text-white flex items-center gap-1">
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-gray-500">Speed:</span>
            {[0.5, 1, 2, 4].map(s => (
              <button key={s} onClick={() => setSpeed(s)}
                className={`px-2 py-1 rounded text-xs ${speed === s ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-500'}`}>
                {s}x
              </button>
            ))}
          </div>
          <div className="text-xs text-gray-500">Step {currentStep + 1} / {steps.length}</div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {step && (
              <motion.div key={currentStep} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className={`p-3 rounded-lg text-sm border font-mono ${
                  step.foundAt !== undefined ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : step.isMatch ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}>
                {step.description}
              </motion.div>
            )}

            {/* Text + Pattern Alignment */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4 overflow-x-auto">
              <h3 className="text-sm font-medium text-white mb-4">Character Comparison</h3>

              {/* Index row */}
              <div className="flex gap-0.5 mb-1">
                {text.split('').map((_, i) => (
                  <div key={i} className="w-8 text-center text-[9px] text-gray-600 font-mono">{i}</div>
                ))}
              </div>

              {/* Text row */}
              <div className="flex gap-0.5 mb-2">
                {text.split('').map((ch, i) => {
                  const isComparing = step?.comparing[0] === i;
                  const isMatched = matchedSet.has(i);
                  const isFound = foundPositions.some(f => i >= f && i < f + pattern.length);

                  return (
                    <motion.div
                      key={i}
                      className={`w-8 h-8 rounded flex items-center justify-center text-xs font-mono font-bold border ${
                        isComparing ? (step?.isMatch ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-red-500/20 border-red-500/50 text-red-400')
                        : isFound ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : isMatched ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                        : 'bg-[#0a0a0f] border-[#1e1e2e] text-gray-300'
                      }`}
                      animate={isComparing ? { scale: [1, 1.15, 1] } : {}}
                      transition={{ duration: 0.2 }}
                    >
                      {ch}
                    </motion.div>
                  );
                })}
              </div>

              {/* Pattern row (aligned) */}
              <div className="flex gap-0.5">
                {text.split('').map((_, i) => {
                  const patStart = step?.textIdx ?? 0;
                  const patCharIdx = i - patStart;
                  const isInPattern = patCharIdx >= 0 && patCharIdx < pattern.length;
                  const isComparing = step?.comparing[0] === i && isInPattern;

                  return (
                    <div key={i} className={`w-8 h-8 rounded flex items-center justify-center text-xs font-mono font-bold border ${
                      isInPattern
                        ? isComparing
                          ? (step?.isMatch ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-red-500/20 border-red-500/50 text-red-400')
                          : patCharIdx < (step?.patIdx ?? 0) ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                          : 'bg-[#1e1e2e] border-[#2a2a3a] text-white'
                        : 'bg-transparent border-transparent'
                    }`}>
                      {isInPattern ? pattern[patCharIdx] : ''}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* KMP Failure Table */}
            {algorithm === 'kmp' && (
              <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
                <h3 className="text-sm font-medium text-white mb-3">KMP Failure Table</h3>
                <div className="flex gap-0.5 mb-1">
                  {pattern.split('').map((ch, i) => (
                    <div key={i} className="w-10 text-center">
                      <div className="text-xs font-mono text-white font-bold">{ch}</div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-0.5">
                  {buildFailureTable(pattern).map((v, i) => (
                    <div key={i} className="w-10 h-7 rounded bg-[#0a0a0f] border border-[#1e1e2e] flex items-center justify-center text-xs font-mono text-cyan-400">
                      {v}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  failure[i] = length of longest proper prefix that is also a suffix of pattern[0..i]
                </p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Stats</h3>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1">
                  <span className="text-gray-500">Comparisons</span>
                  <span className="text-emerald-400">{comparisons}</span>
                </div>
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1">
                  <span className="text-gray-500">Text length</span>
                  <span className="text-cyan-400">{text.length}</span>
                </div>
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1">
                  <span className="text-gray-500">Pattern length</span>
                  <span className="text-cyan-400">{pattern.length}</span>
                </div>
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1">
                  <span className="text-gray-500">Matches found</span>
                  <span className="text-yellow-400">{foundPositions.length}</span>
                </div>
              </div>
            </div>

            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-400" /> Algorithm Comparison
              </h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className={`p-2 rounded-lg border ${algorithm === 'naive' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-[#0a0a0f] border-[#1e1e2e]'}`}>
                  <div className="text-emerald-400 font-medium mb-1">Naive</div>
                  <div className="text-gray-500">O(n·m) worst</div>
                  <div className="text-gray-500">No preprocessing</div>
                  <div className="text-gray-500">Shift by 1</div>
                </div>
                <div className={`p-2 rounded-lg border ${algorithm === 'kmp' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-[#0a0a0f] border-[#1e1e2e]'}`}>
                  <div className="text-emerald-400 font-medium mb-1">KMP</div>
                  <div className="text-gray-500">O(n+m) always</div>
                  <div className="text-gray-500">O(m) preprocess</div>
                  <div className="text-gray-500">Smart skip</div>
                </div>
              </div>
            </div>

            <div className="bg-[#111118] rounded-lg border border-emerald-500/20 p-4">
              <h3 className="text-sm font-medium text-emerald-400 mb-2">KMP Key Insight</h3>
              <p className="text-xs text-gray-400">
                When a mismatch occurs at pattern[j], the failure table tells us the longest prefix of pattern[0..j-1]
                that is also a suffix. We skip to that position instead of restarting from scratch.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}