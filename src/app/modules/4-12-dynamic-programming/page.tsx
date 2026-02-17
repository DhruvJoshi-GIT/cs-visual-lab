'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Play, Pause, RotateCcw, ChevronRight, Info, Grid3X3
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

interface DPStep {
  row: number;
  col: number;
  value: number;
  description: string;
  highlight?: [number, number][];
}

interface DPProblem {
  id: string;
  name: string;
  description: string;
  generateSteps: () => { steps: DPStep[]; table: number[][]; rowLabels: string[]; colLabels: string[]; answer: string };
}

const PROBLEMS: DPProblem[] = [
  {
    id: 'fibonacci',
    name: 'Fibonacci',
    description: 'Classic bottom-up fibonacci with tabulation.',
    generateSteps: () => {
      const n = 10;
      const dp = Array(n + 1).fill(0);
      dp[1] = 1;
      const steps: DPStep[] = [
        { row: 0, col: 0, value: 0, description: 'Base case: F(0) = 0' },
        { row: 0, col: 1, value: 1, description: 'Base case: F(1) = 1' },
      ];
      for (let i = 2; i <= n; i++) {
        dp[i] = dp[i - 1] + dp[i - 2];
        steps.push({
          row: 0, col: i, value: dp[i],
          description: `F(${i}) = F(${i - 1}) + F(${i - 2}) = ${dp[i - 1]} + ${dp[i - 2]} = ${dp[i]}`,
          highlight: [[0, i - 1], [0, i - 2]],
        });
      }
      return {
        steps,
        table: [dp],
        rowLabels: ['F(n)'],
        colLabels: Array.from({ length: n + 1 }, (_, i) => `${i}`),
        answer: `F(${n}) = ${dp[n]}`,
      };
    },
  },
  {
    id: 'knapsack',
    name: '0/1 Knapsack',
    description: 'Maximize value for given weight capacity.',
    generateSteps: () => {
      const items = [
        { name: 'A', weight: 2, value: 3 },
        { name: 'B', weight: 3, value: 4 },
        { name: 'C', weight: 4, value: 5 },
        { name: 'D', weight: 5, value: 7 },
      ];
      const W = 7;
      const n = items.length;
      const dp: number[][] = Array.from({ length: n + 1 }, () => Array(W + 1).fill(0));
      const steps: DPStep[] = [];

      for (let i = 1; i <= n; i++) {
        for (let w = 1; w <= W; w++) {
          const item = items[i - 1];
          if (item.weight <= w) {
            const include = item.value + dp[i - 1][w - item.weight];
            const exclude = dp[i - 1][w];
            dp[i][w] = Math.max(include, exclude);
            steps.push({
              row: i, col: w, value: dp[i][w],
              description: `Item ${item.name}(w=${item.weight},v=${item.value}), cap=${w}: max(${exclude}, ${item.value}+${dp[i - 1][w - item.weight]}) = ${dp[i][w]}`,
              highlight: [[i - 1, w], [i - 1, w - item.weight]],
            });
          } else {
            dp[i][w] = dp[i - 1][w];
            steps.push({
              row: i, col: w, value: dp[i][w],
              description: `Item ${item.name} too heavy (${item.weight} > ${w}), skip: ${dp[i][w]}`,
              highlight: [[i - 1, w]],
            });
          }
        }
      }

      return {
        steps,
        table: dp,
        rowLabels: ['∅', ...items.map(it => `${it.name}(${it.weight},${it.value})`)],
        colLabels: Array.from({ length: W + 1 }, (_, i) => `${i}`),
        answer: `Max value = ${dp[n][W]}`,
      };
    },
  },
  {
    id: 'lcs',
    name: 'Longest Common Subsequence',
    description: 'Find the longest subsequence common to two strings.',
    generateSteps: () => {
      const s1 = 'ABCBD';
      const s2 = 'BDCB';
      const m = s1.length, n = s2.length;
      const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
      const steps: DPStep[] = [];

      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          if (s1[i - 1] === s2[j - 1]) {
            dp[i][j] = dp[i - 1][j - 1] + 1;
            steps.push({
              row: i, col: j, value: dp[i][j],
              description: `'${s1[i - 1]}' == '${s2[j - 1]}': dp[${i}][${j}] = dp[${i - 1}][${j - 1}] + 1 = ${dp[i][j]}`,
              highlight: [[i - 1, j - 1]],
            });
          } else {
            dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            steps.push({
              row: i, col: j, value: dp[i][j],
              description: `'${s1[i - 1]}' ≠ '${s2[j - 1]}': max(${dp[i - 1][j]}, ${dp[i][j - 1]}) = ${dp[i][j]}`,
              highlight: [[i - 1, j], [i, j - 1]],
            });
          }
        }
      }

      return {
        steps,
        table: dp,
        rowLabels: ['∅', ...s1.split('')],
        colLabels: ['∅', ...s2.split('')],
        answer: `LCS length = ${dp[m][n]}`,
      };
    },
  },
  {
    id: 'edit-distance',
    name: 'Edit Distance',
    description: 'Minimum operations to transform one string to another.',
    generateSteps: () => {
      const s1 = 'kitten';
      const s2 = 'sitting';
      const m = s1.length, n = s2.length;
      const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
      );
      const steps: DPStep[] = [];

      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          if (s1[i - 1] === s2[j - 1]) {
            dp[i][j] = dp[i - 1][j - 1];
            steps.push({
              row: i, col: j, value: dp[i][j],
              description: `'${s1[i - 1]}' == '${s2[j - 1]}': no op, dp[${i}][${j}] = ${dp[i][j]}`,
              highlight: [[i - 1, j - 1]],
            });
          } else {
            dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
            const ops = [`replace(${dp[i - 1][j - 1]})`, `delete(${dp[i - 1][j]})`, `insert(${dp[i][j - 1]})`];
            steps.push({
              row: i, col: j, value: dp[i][j],
              description: `'${s1[i - 1]}' ≠ '${s2[j - 1]}': 1 + min(${ops.join(', ')}) = ${dp[i][j]}`,
              highlight: [[i - 1, j - 1], [i - 1, j], [i, j - 1]],
            });
          }
        }
      }

      return {
        steps,
        table: dp,
        rowLabels: ['∅', ...s1.split('')],
        colLabels: ['∅', ...s2.split('')],
        answer: `Edit distance = ${dp[m][n]}`,
      };
    },
  },
];

export default function DynamicProgrammingPage() {
  const [problem, setProblem] = useState(PROBLEMS[0]);
  const [data, setData] = useState<ReturnType<typeof PROBLEMS[0]['generateSteps']> | null>(null);
  const [currentStep, setCurrentStep] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setData(problem.generateSteps());
    setCurrentStep(-1);
    setIsPlaying(false);
  }, [problem]);

  useEffect(() => {
    if (!data) return;
    if (isPlaying && currentStep < data.steps.length - 1)
      timerRef.current = setTimeout(() => setCurrentStep(s => s + 1), 600 / speed);
    else if (data && currentStep >= data.steps.length - 1) setIsPlaying(false);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, currentStep, speed, data]);

  const handlePlayPause = () => {
    if (!data) return;
    if (currentStep >= data.steps.length - 1) { setCurrentStep(-1); setTimeout(() => setIsPlaying(true), 50); return; }
    setIsPlaying(!isPlaying);
  };

  if (!data) return null;

  const step = currentStep >= 0 ? data.steps[currentStep] : null;
  const filledCells = new Set<string>();
  const cellValues = new Map<string, number>();
  for (let i = 0; i <= currentStep && i < data.steps.length; i++) {
    const s = data.steps[i];
    const key = `${s.row}-${s.col}`;
    filledCells.add(key);
    cellValues.set(key, s.value);
  }

  const highlightSet = new Set<string>(
    (step?.highlight || []).map(([r, c]) => `${r}-${c}`)
  );
  const currentKey = step ? `${step.row}-${step.col}` : null;

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Grid3X3 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Dynamic Programming</h1>
              <p className="text-sm text-gray-400">Module 4.12 — DP table filling animation with traceback</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Problem:</span>
            {PROBLEMS.map(p => (
              <button key={p.id} onClick={() => setProblem(p)}
                className={`px-2 py-1 rounded text-xs ${problem.id === p.id ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400 bg-[#1e1e2e]'}`}>
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <button onClick={handlePlayPause}
            className="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center hover:bg-emerald-500/30">
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={() => { setIsPlaying(false); if (currentStep < data.steps.length - 1) setCurrentStep(s => s + 1); }}
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
          <div className="text-xs text-gray-500">Step {currentStep + 1} / {data.steps.length}</div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {step && (
              <motion.div key={currentStep} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-400 font-mono">
                {step.description}
              </motion.div>
            )}

            {/* DP Table */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="p-1.5 text-xs text-gray-500 font-mono"></th>
                    {data.colLabels.map((label, j) => (
                      <th key={j} className="p-1.5 text-xs text-gray-400 font-mono text-center min-w-[40px]">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.table.map((row, i) => (
                    <tr key={i}>
                      <td className="p-1.5 text-xs text-gray-400 font-mono whitespace-nowrap pr-2">
                        {data.rowLabels[i]}
                      </td>
                      {row.map((_, j) => {
                        const key = `${i}-${j}`;
                        const isFilled = filledCells.has(key);
                        const isCurrent = key === currentKey;
                        const isHighlight = highlightSet.has(key);
                        const val = cellValues.get(key);

                        return (
                          <td key={j} className="p-0.5">
                            <motion.div
                              className={`h-9 min-w-[36px] rounded flex items-center justify-center text-xs font-mono font-bold border ${
                                isCurrent ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                                : isHighlight ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-400'
                                : isFilled ? 'bg-[#1e1e2e] border-[#2a2a3a] text-white'
                                : 'bg-[#0a0a0f] border-[#1a1a2a] text-gray-700'
                              }`}
                              animate={isCurrent ? { scale: [1, 1.1, 1] } : {}}
                              transition={{ duration: 0.3 }}
                            >
                              {isFilled ? val : (i === 0 || j === 0 ? data.table[i][j] : '')}
                            </motion.div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Answer */}
            {currentStep >= data.steps.length - 1 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-center">
                <div className="text-lg font-bold text-emerald-400 font-mono">{data.answer}</div>
              </motion.div>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-2">{problem.name}</h3>
              <p className="text-xs text-gray-400">{problem.description}</p>
            </div>

            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-400" /> DP Approach
              </h3>
              <div className="space-y-2 text-xs text-gray-400">
                <div><span className="text-emerald-400 font-medium">Optimal substructure:</span> Optimal solution contains optimal sub-solutions.</div>
                <div><span className="text-yellow-400 font-medium">Overlapping subproblems:</span> Same subproblems recur; cache results in table.</div>
                <div><span className="text-cyan-400 font-medium">Bottom-up:</span> Fill table from base cases → build up to answer.</div>
              </div>
            </div>

            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Cell Legend</h3>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-emerald-500/20 border border-emerald-500/50" />
                  <span className="text-gray-400">Currently computing</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-yellow-500/15 border border-yellow-500/40" />
                  <span className="text-gray-400">Referenced cells</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-[#1e1e2e] border border-[#2a2a3a]" />
                  <span className="text-gray-400">Already filled</span>
                </div>
              </div>
            </div>

            <div className="bg-[#111118] rounded-lg border border-emerald-500/20 p-4">
              <h3 className="text-sm font-medium text-emerald-400 mb-2">Complexity</h3>
              <div className="space-y-1 text-xs text-gray-400 font-mono">
                {problem.id === 'fibonacci' && <div>Time: O(n) | Space: O(n)</div>}
                {problem.id === 'knapsack' && <div>Time: O(n·W) | Space: O(n·W)</div>}
                {problem.id === 'lcs' && <div>Time: O(m·n) | Space: O(m·n)</div>}
                {problem.id === 'edit-distance' && <div>Time: O(m·n) | Space: O(m·n)</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}