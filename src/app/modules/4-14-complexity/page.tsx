'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Info, BarChart3 } from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

interface ComplexityClass {
  name: string;
  notation: string;
  color: string;
  fn: (n: number) => number;
  examples: string[];
}

const COMPLEXITIES: ComplexityClass[] = [
  { name: 'Constant', notation: 'O(1)', color: '#10b981', fn: () => 1, examples: ['Array access', 'Hash lookup'] },
  { name: 'Logarithmic', notation: 'O(log n)', color: '#06b6d4', fn: n => Math.log2(n), examples: ['Binary search', 'BST lookup'] },
  { name: 'Linear', notation: 'O(n)', color: '#8b5cf6', fn: n => n, examples: ['Linear search', 'Array sum'] },
  { name: 'Linearithmic', notation: 'O(n log n)', color: '#f59e0b', fn: n => n * Math.log2(n), examples: ['Merge sort', 'Heap sort'] },
  { name: 'Quadratic', notation: 'O(n²)', color: '#ef4444', fn: n => n * n, examples: ['Bubble sort', 'Nested loops'] },
  { name: 'Cubic', notation: 'O(n³)', color: '#ec4899', fn: n => n * n * n, examples: ['Matrix multiply', 'Floyd-Warshall'] },
  { name: 'Exponential', notation: 'O(2ⁿ)', color: '#f97316', fn: n => Math.pow(2, n), examples: ['Subsets', 'Naive Fibonacci'] },
];

const INPUT_SIZES = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

export default function ComplexityPage() {
  const [selected, setSelected] = useState<Set<string>>(new Set(['O(1)', 'O(log n)', 'O(n)', 'O(n log n)', 'O(n²)']));
  const [maxN, setMaxN] = useState(64);
  const [hoverN, setHoverN] = useState<number | null>(null);

  const toggleClass = (notation: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(notation)) next.delete(notation);
      else next.add(notation);
      return next;
    });
  };

  const activeClasses = COMPLEXITIES.filter(c => selected.has(c.notation));
  const maxVal = useMemo(() => {
    let max = 0;
    for (const cls of activeClasses) {
      const v = cls.fn(maxN);
      if (v > max && v < 1e8) max = v;
    }
    return Math.max(max, 10);
  }, [activeClasses, maxN]);

  const chartWidth = 600;
  const chartHeight = 350;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const plotW = chartWidth - padding.left - padding.right;
  const plotH = chartHeight - padding.top - padding.bottom;

  const scaleX = (n: number) => padding.left + (n / maxN) * plotW;
  const scaleY = (v: number) => {
    const capped = Math.min(v, maxVal);
    return padding.top + plotH - (capped / maxVal) * plotH;
  };

  // Time estimates at different input sizes
  const timeEstimate = (ops: number): string => {
    const opsPerSec = 1e9;
    const seconds = ops / opsPerSec;
    if (seconds < 1e-6) return '<1μs';
    if (seconds < 1e-3) return `${(seconds * 1e6).toFixed(0)}μs`;
    if (seconds < 1) return `${(seconds * 1e3).toFixed(0)}ms`;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(0)}min`;
    if (seconds < 86400) return `${(seconds / 3600).toFixed(0)}hr`;
    if (seconds < 31536000) return `${(seconds / 86400).toFixed(0)}days`;
    return `${(seconds / 31536000).toFixed(0)}yr`;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Complexity Analysis</h1>
              <p className="text-sm text-gray-400">Module 4.14 — Big-O growth curves and time estimates</p>
            </div>
          </div>
        </div>

        {/* Complexity Toggles */}
        <div className="flex flex-wrap gap-2 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          {COMPLEXITIES.map(c => (
            <button
              key={c.notation}
              onClick={() => toggleClass(c.notation)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all border ${
                selected.has(c.notation)
                  ? 'border-opacity-50'
                  : 'opacity-30 border-[#1e1e2e]'
              }`}
              style={{
                backgroundColor: selected.has(c.notation) ? c.color + '20' : '#0a0a0f',
                color: c.color,
                borderColor: selected.has(c.notation) ? c.color + '60' : '#1e1e2e',
              }}
            >
              {c.notation}
            </button>
          ))}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-gray-500">Max n:</span>
            {[32, 64, 128, 256, 512].map(n => (
              <button key={n} onClick={() => setMaxN(n)}
                className={`px-2 py-1 rounded text-xs ${maxN === n ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-500'}`}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Growth Rate Comparison</h3>
              <svg width="100%" viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = (e.clientX - rect.left) / rect.width * chartWidth;
                  const n = Math.round(((x - padding.left) / plotW) * maxN);
                  if (n >= 0 && n <= maxN) setHoverN(n);
                }}
                onMouseLeave={() => setHoverN(null)}
              >
                {/* Grid */}
                {[0, 0.25, 0.5, 0.75, 1].map(frac => (
                  <g key={frac}>
                    <line x1={padding.left} y1={padding.top + plotH * (1 - frac)}
                      x2={padding.left + plotW} y2={padding.top + plotH * (1 - frac)}
                      stroke="#1e1e2e" strokeWidth={0.5} />
                    <text x={padding.left - 5} y={padding.top + plotH * (1 - frac) + 4}
                      textAnchor="end" fill="#666" fontSize={9} fontFamily="monospace">
                      {Math.round(maxVal * frac)}
                    </text>
                  </g>
                ))}

                {/* X axis labels */}
                {[0, 0.25, 0.5, 0.75, 1].map(frac => (
                  <text key={frac} x={padding.left + plotW * frac} y={chartHeight - 5}
                    textAnchor="middle" fill="#666" fontSize={9} fontFamily="monospace">
                    {Math.round(maxN * frac)}
                  </text>
                ))}

                {/* Curves */}
                {activeClasses.map(cls => {
                  const points: string[] = [];
                  for (let n = 0; n <= maxN; n += Math.max(1, maxN / 200)) {
                    const v = cls.fn(n);
                    if (v > maxVal * 2) break;
                    points.push(`${scaleX(n)},${scaleY(v)}`);
                  }
                  return (
                    <polyline
                      key={cls.notation}
                      points={points.join(' ')}
                      fill="none"
                      stroke={cls.color}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  );
                })}

                {/* Hover line */}
                {hoverN !== null && (
                  <g>
                    <line x1={scaleX(hoverN)} y1={padding.top} x2={scaleX(hoverN)} y2={padding.top + plotH}
                      stroke="#444" strokeWidth={1} strokeDasharray="3,3" />
                    {activeClasses.map(cls => {
                      const v = cls.fn(hoverN);
                      if (v > maxVal * 2) return null;
                      return (
                        <circle key={cls.notation} cx={scaleX(hoverN)} cy={scaleY(v)} r={4}
                          fill={cls.color} stroke="#0a0a0f" strokeWidth={1.5} />
                      );
                    })}
                    <text x={scaleX(hoverN)} y={padding.top - 5}
                      textAnchor="middle" fill="#aaa" fontSize={10} fontFamily="monospace">
                      n={hoverN}
                    </text>
                  </g>
                )}

                {/* Axes */}
                <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotH}
                  stroke="#333" strokeWidth={1} />
                <line x1={padding.left} y1={padding.top + plotH} x2={padding.left + plotW} y2={padding.top + plotH}
                  stroke="#333" strokeWidth={1} />

                <text x={chartWidth / 2} y={chartHeight - 15} textAnchor="middle" fill="#666" fontSize={10}>
                  Input Size (n)
                </text>
              </svg>

              {/* Hover values */}
              {hoverN !== null && (
                <div className="flex gap-3 mt-2 flex-wrap">
                  {activeClasses.map(cls => (
                    <div key={cls.notation} className="text-xs font-mono" style={{ color: cls.color }}>
                      {cls.notation}: {cls.fn(hoverN) < 1000 ? cls.fn(hoverN).toFixed(1) : cls.fn(hoverN).toExponential(1)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Comparison Table */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4 overflow-x-auto">
              <h3 className="text-sm font-medium text-white mb-3">Time Estimates (at 10⁹ ops/sec)</h3>
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr>
                    <th className="text-left text-gray-500 py-1 px-2">n</th>
                    {activeClasses.map(c => (
                      <th key={c.notation} className="text-right py-1 px-2" style={{ color: c.color }}>{c.notation}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {INPUT_SIZES.filter(n => n <= maxN * 2).map(n => (
                    <tr key={n} className="border-t border-[#1e1e2e]">
                      <td className="py-1 px-2 text-gray-400">{n}</td>
                      {activeClasses.map(c => {
                        const ops = c.fn(n);
                        const est = timeEstimate(ops);
                        const isSlow = ops > 1e12;
                        return (
                          <td key={c.notation} className={`text-right py-1 px-2 ${isSlow ? 'text-red-400' : 'text-gray-300'}`}>
                            {est}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Panel */}
          <div className="space-y-4">
            {/* Complexity Classes */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-400" /> Complexity Classes
              </h3>
              <div className="space-y-3">
                {COMPLEXITIES.map(c => (
                  <div key={c.notation} className={`p-2 rounded-lg border transition-opacity ${
                    selected.has(c.notation) ? 'opacity-100' : 'opacity-30'
                  }`}
                  style={{ borderColor: c.color + '30', backgroundColor: c.color + '08' }}>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold font-mono" style={{ color: c.color }}>{c.notation}</span>
                      <span className="text-xs text-gray-500">{c.name}</span>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-1">
                      {c.examples.join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Rules */}
            <div className="bg-[#111118] rounded-lg border border-emerald-500/20 p-4">
              <h3 className="text-sm font-medium text-emerald-400 mb-2">Big-O Rules</h3>
              <div className="space-y-1.5 text-xs text-gray-400 font-mono">
                <div>• Drop constants: 2n → O(n)</div>
                <div>• Drop lower terms: n²+n → O(n²)</div>
                <div>• Nested loops multiply: O(n·m)</div>
                <div>• Sequential add: O(n)+O(m)=O(n+m)</div>
                <div>• Log base doesn&apos;t matter</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}