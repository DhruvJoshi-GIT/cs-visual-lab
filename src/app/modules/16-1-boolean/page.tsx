"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Info,
  Lightbulb,
  Hash,
  Activity,
  ToggleLeft,
  ToggleRight,
  Table2,
  Grid3X3,
  Minimize2,
  Binary,
  ChevronRight,
  Sigma,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

type ModeType = "truth-table" | "karnaugh-map" | "minimization";

type ScenarioKey = "2-variable" | "3-variable" | "4-variable" | "demorgan";

interface Scenario {
  key: ScenarioKey;
  label: string;
  description: string;
  mode: ModeType;
  numVars: number;
  outputs?: number[];
  expression?: string;
}

interface KMapGroup {
  cells: number[];
  color: string;
  term: string;
}

interface SimplificationStep {
  expression: string;
  law: string;
  description: string;
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
  stone: "#78716c",
};

const GROUP_COLORS = [
  "#6366f1", // indigo
  "#06b6d4", // cyan
  "#10b981", // green
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
];

const VARIABLE_NAMES = ["A", "B", "C", "D"];

const SCENARIOS: Scenario[] = [
  {
    key: "2-variable",
    label: "2-Variable",
    description: "Simple 2-variable boolean function",
    mode: "karnaugh-map",
    numVars: 2,
    outputs: [0, 1, 1, 1],
  },
  {
    key: "3-variable",
    label: "3-Variable",
    description: "3-variable function with grouping",
    mode: "karnaugh-map",
    numVars: 3,
    outputs: [0, 1, 0, 1, 0, 1, 1, 1],
  },
  {
    key: "4-variable",
    label: "4-Var Minimize",
    description: "4-variable Karnaugh map minimization",
    mode: "karnaugh-map",
    numVars: 4,
    outputs: [1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1],
  },
  {
    key: "demorgan",
    label: "De Morgan's Demo",
    description: "Step-by-step simplification using De Morgan's laws",
    mode: "minimization",
    numVars: 2,
    expression: "(A'B')' + AB'",
  },
];

// ─── Gray Code Helpers ────────────────────────────────────────────────────────

function grayCode(bits: number): number[] {
  if (bits === 0) return [0];
  if (bits === 1) return [0, 1];
  const prev = grayCode(bits - 1);
  const result: number[] = [];
  for (const v of prev) result.push(v);
  for (let i = prev.length - 1; i >= 0; i--) result.push(prev[i] | (1 << (bits - 1)));
  return result;
}

function bitsToStr(val: number, numBits: number): string {
  return val.toString(2).padStart(numBits, "0");
}

// ─── K-Map Layout Helpers ─────────────────────────────────────────────────────

function getKMapLayout(numVars: number): {
  rowVars: number;
  colVars: number;
  rowLabels: number[];
  colLabels: number[];
  rowVarNames: string;
  colVarNames: string;
} {
  if (numVars === 2) {
    return {
      rowVars: 1,
      colVars: 1,
      rowLabels: grayCode(1),
      colLabels: grayCode(1),
      rowVarNames: "A",
      colVarNames: "B",
    };
  }
  if (numVars === 3) {
    return {
      rowVars: 1,
      colVars: 2,
      rowLabels: grayCode(1),
      colLabels: grayCode(2),
      rowVarNames: "A",
      colVarNames: "BC",
    };
  }
  // 4 variables
  return {
    rowVars: 2,
    colVars: 2,
    rowLabels: grayCode(2),
    colLabels: grayCode(2),
    rowVarNames: "AB",
    colVarNames: "CD",
  };
}

function mintermToKMapPosition(
  minterm: number,
  numVars: number
): { row: number; col: number } {
  const layout = getKMapLayout(numVars);
  const rowBits = numVars === 2 ? 1 : numVars === 3 ? 1 : 2;
  const colBits = numVars - rowBits;

  const rowVal = minterm >> colBits;
  const colVal = minterm & ((1 << colBits) - 1);

  const row = layout.rowLabels.indexOf(rowVal);
  const col = layout.colLabels.indexOf(colVal);

  return { row, col };
}

function kMapPositionToMinterm(
  row: number,
  col: number,
  numVars: number
): number {
  const layout = getKMapLayout(numVars);
  const colBits = numVars === 2 ? 1 : numVars === 3 ? 2 : 2;
  const rowVal = layout.rowLabels[row];
  const colVal = layout.colLabels[col];
  return (rowVal << colBits) | colVal;
}

// ─── SOP Expression Generation ───────────────────────────────────────────────

function outputsToSOP(outputs: number[], numVars: number): string {
  const terms: string[] = [];
  for (let i = 0; i < outputs.length; i++) {
    if (outputs[i] === 1) {
      const bits = bitsToStr(i, numVars);
      let term = "";
      for (let b = 0; b < numVars; b++) {
        term += bits[b] === "1" ? VARIABLE_NAMES[b] : VARIABLE_NAMES[b] + "'";
      }
      terms.push(term);
    }
  }
  return terms.length > 0 ? terms.join(" + ") : "0";
}

// ─── K-Map Grouping Algorithm ─────────────────────────────────────────────────

function findKMapGroups(outputs: number[], numVars: number): KMapGroup[] {
  const layout = getKMapLayout(numVars);
  const rows = layout.rowLabels.length;
  const cols = layout.colLabels.length;
  const totalCells = outputs.length;
  const groups: KMapGroup[] = [];
  const covered = new Set<number>();

  // Get all minterms (1-cells)
  const minterms = new Set<number>();
  for (let i = 0; i < totalCells; i++) {
    if (outputs[i] === 1) minterms.add(i);
  }

  if (minterms.size === 0) return [];
  if (minterms.size === totalCells) {
    return [{
      cells: Array.from(minterms),
      color: GROUP_COLORS[0],
      term: "1",
    }];
  }

  // Try to find groups of decreasing size: 8, 4, 2, 1
  const groupSizes = numVars === 4 ? [8, 4, 2, 1] : numVars === 3 ? [4, 2, 1] : [2, 1];

  for (const size of groupSizes) {
    // Generate all possible rectangular groups of this size
    const possibleGroups = generatePossibleGroups(rows, cols, size, numVars);

    for (const group of possibleGroups) {
      // Check if all cells in group are 1-cells
      const allOnes = group.every((m) => minterms.has(m));
      if (!allOnes) continue;

      // Check if this group covers at least one uncovered cell
      const coversNew = group.some((m) => !covered.has(m));
      if (!coversNew) continue;

      const term = groupToTerm(group, numVars);
      groups.push({
        cells: group,
        color: GROUP_COLORS[groups.length % GROUP_COLORS.length],
        term,
      });

      group.forEach((m) => covered.add(m));

      // If all minterms are covered, stop
      if ([...minterms].every((m) => covered.has(m))) break;
    }

    if ([...minterms].every((m) => covered.has(m))) break;
  }

  return groups;
}

function generatePossibleGroups(
  rows: number,
  cols: number,
  size: number,
  numVars: number
): number[][] {
  const groups: number[][] = [];

  // Find rectangular dimensions that multiply to size
  const dimensions: [number, number][] = [];
  for (let h = 1; h <= rows; h++) {
    for (let w = 1; w <= cols; w++) {
      if (h * w === size && isPowerOf2(h) && isPowerOf2(w)) {
        dimensions.push([h, w]);
      }
    }
  }

  for (const [h, w] of dimensions) {
    for (let startRow = 0; startRow < rows; startRow++) {
      for (let startCol = 0; startCol < cols; startCol++) {
        const cells: number[] = [];
        for (let dr = 0; dr < h; dr++) {
          for (let dc = 0; dc < w; dc++) {
            const r = (startRow + dr) % rows;
            const c = (startCol + dc) % cols;
            const minterm = kMapPositionToMinterm(r, c, numVars);
            cells.push(minterm);
          }
        }
        groups.push(cells);
      }
    }
  }

  return groups;
}

function isPowerOf2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function groupToTerm(group: number[], numVars: number): string {
  // Find which variables are constant across the group
  let term = "";
  for (let bit = 0; bit < numVars; bit++) {
    const bitPos = numVars - 1 - bit;
    const values = group.map((m) => (m >> bitPos) & 1);
    const allZero = values.every((v) => v === 0);
    const allOne = values.every((v) => v === 1);

    if (allOne) {
      term += VARIABLE_NAMES[bit];
    } else if (allZero) {
      term += VARIABLE_NAMES[bit] + "'";
    }
    // If mixed, variable is eliminated
  }
  return term || "1";
}

// ─── Simplification Steps ─────────────────────────────────────────────────────

function generateSimplificationSteps(expression: string): SimplificationStep[] {
  // Predefined simplification for De Morgan's demo
  if (expression === "(A'B')' + AB'") {
    return [
      { expression: "(A'B')' + AB'", law: "Original", description: "Starting expression" },
      { expression: "(A'' + B'') + AB'", law: "De Morgan's Law", description: "(XY)' = X' + Y'" },
      { expression: "(A + B) + AB'", law: "Double Negation", description: "X'' = X" },
      { expression: "A + B + AB'", law: "Associativity", description: "Remove parentheses" },
      { expression: "A(1 + B') + B", law: "Factoring", description: "Factor out A from first and third terms" },
      { expression: "A(1) + B", law: "Complement Law", description: "1 + X = 1" },
      { expression: "A + B", law: "Identity Law", description: "X * 1 = X (final result)" },
    ];
  }

  // Generate generic SOP simplification
  return [
    { expression, law: "Original", description: "Starting expression" },
    { expression: expression + " (simplified)", law: "Applied Laws", description: "Result after simplification" },
  ];
}

function generateRandomOutputs(numVars: number): number[] {
  const size = Math.pow(2, numVars);
  return Array.from({ length: size }, () => (Math.random() > 0.5 ? 1 : 0));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricBadge({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border backdrop-blur-md"
      style={{
        backgroundColor: "rgba(17,17,24,0.85)",
        borderColor: `${color}33`,
      }}
    >
      <span style={{ color }}>{icon}</span>
      <div className="flex flex-col">
        <span className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.muted }}>
          {label}
        </span>
        <span className="text-xs font-mono font-semibold tabular-nums" style={{ color }}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
      </div>
    </div>
  );
}

function ModeSelector({
  mode,
  onModeChange,
}: {
  mode: ModeType;
  onModeChange: (m: ModeType) => void;
}) {
  const modes: { id: ModeType; label: string; icon: React.ReactNode }[] = [
    { id: "truth-table", label: "Truth Table", icon: <Table2 size={12} /> },
    { id: "karnaugh-map", label: "K-Map", icon: <Grid3X3 size={12} /> },
    { id: "minimization", label: "Minimize", icon: <Minimize2 size={12} /> },
  ];

  return (
    <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: "#0d0d14" }}>
      {modes.map((m) => (
        <button
          key={m.id}
          onClick={() => onModeChange(m.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200"
          style={{
            background: mode === m.id ? `${COLORS.stone}20` : "transparent",
            color: mode === m.id ? "#ffffff" : COLORS.muted,
            border: mode === m.id ? `1px solid ${COLORS.stone}40` : "1px solid transparent",
          }}
        >
          {m.icon}
          {m.label}
        </button>
      ))}
    </div>
  );
}

function TruthTableView({
  numVars,
  outputs,
  onToggleOutput,
  highlightRow,
}: {
  numVars: number;
  outputs: number[];
  onToggleOutput: (idx: number) => void;
  highlightRow: number;
}) {
  const totalRows = Math.pow(2, numVars);
  const varNames = VARIABLE_NAMES.slice(0, numVars);

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
    >
      <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: COLORS.border }}>
        <Table2 size={14} style={{ color: COLORS.secondary }} />
        <span className="text-sm font-semibold text-white">Truth Table</span>
        <span className="text-[10px] ml-auto font-mono" style={{ color: COLORS.muted }}>
          {numVars} variables, {totalRows} rows
        </span>
      </div>
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10" style={{ background: COLORS.card }}>
            <tr className="border-b" style={{ borderColor: COLORS.border }}>
              <th className="px-2 py-2 text-center font-mono font-medium text-[10px]" style={{ color: COLORS.muted }}>
                #
              </th>
              {varNames.map((v) => (
                <th key={v} className="px-3 py-2 text-center font-mono font-medium" style={{ color: COLORS.muted }}>
                  {v}
                </th>
              ))}
              <th className="px-3 py-2 text-center font-mono font-medium" style={{ color: COLORS.secondary }}>
                F
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: totalRows }, (_, idx) => {
              const bits = bitsToStr(idx, numVars);
              const isHighlighted = idx === highlightRow;

              return (
                <tr
                  key={idx}
                  className="border-b transition-all duration-200"
                  style={{
                    borderColor: `${COLORS.border}50`,
                    backgroundColor: isHighlighted ? `${COLORS.primary}12` : "transparent",
                  }}
                >
                  <td className="px-2 py-2 text-center font-mono text-[10px]" style={{ color: COLORS.muted }}>
                    m{idx}
                  </td>
                  {bits.split("").map((bit, b) => (
                    <td
                      key={b}
                      className="px-3 py-2 text-center font-mono font-bold"
                      style={{ color: bit === "1" ? COLORS.success : COLORS.muted }}
                    >
                      {bit}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => onToggleOutput(idx)}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md font-mono font-bold text-sm transition-all duration-150 hover:scale-110"
                      style={{
                        backgroundColor: outputs[idx] === 1 ? "rgba(255,255,255,0.12)" : "rgba(113,113,122,0.1)",
                        color: outputs[idx] === 1 ? "#ffffff" : COLORS.muted,
                        border: isHighlighted
                          ? `1px solid ${COLORS.primary}`
                          : `1px solid ${outputs[idx] === 1 ? "rgba(255,255,255,0.2)" : "transparent"}`,
                      }}
                    >
                      {outputs[idx]}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KarnaughMapView({
  numVars,
  outputs,
  onToggleOutput,
  groups,
  visibleGroupCount,
}: {
  numVars: number;
  outputs: number[];
  onToggleOutput: (minterm: number) => void;
  groups: KMapGroup[];
  visibleGroupCount: number;
}) {
  const layout = getKMapLayout(numVars);
  const rows = layout.rowLabels.length;
  const cols = layout.colLabels.length;

  const cellSize = numVars <= 3 ? 56 : 48;

  // Build a map of cell -> group colors for highlighting
  const cellGroupColors: Record<number, string[]> = {};
  groups.slice(0, visibleGroupCount).forEach((group) => {
    group.cells.forEach((cell) => {
      if (!cellGroupColors[cell]) cellGroupColors[cell] = [];
      cellGroupColors[cell].push(group.color);
    });
  });

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
    >
      <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: COLORS.border }}>
        <Grid3X3 size={14} style={{ color: COLORS.primary }} />
        <span className="text-sm font-semibold text-white">Karnaugh Map</span>
        <span className="text-[10px] ml-auto font-mono" style={{ color: COLORS.muted }}>
          {numVars}-variable
        </span>
      </div>

      <div className="p-4">
        {/* Variable labels */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-mono font-bold" style={{ color: COLORS.accent }}>
            {layout.colVarNames} →
          </span>
        </div>

        <div className="flex">
          {/* Row labels area */}
          <div className="flex flex-col items-end justify-center mr-2" style={{ marginTop: `${cellSize + 4}px` }}>
            {layout.rowLabels.map((rv, ri) => (
              <div
                key={ri}
                className="flex items-center justify-end font-mono text-[10px] font-bold"
                style={{
                  height: `${cellSize + 2}px`,
                  color: COLORS.secondary,
                }}
              >
                {bitsToStr(rv, layout.rowVars)}
              </div>
            ))}
            <div className="text-[10px] font-mono font-bold mt-1" style={{ color: COLORS.accent }}>
              ↑ {layout.rowVarNames}
            </div>
          </div>

          {/* K-Map grid */}
          <div>
            {/* Column labels */}
            <div className="flex" style={{ marginLeft: 0 }}>
              {layout.colLabels.map((cv, ci) => (
                <div
                  key={ci}
                  className="flex items-center justify-center font-mono text-[10px] font-bold"
                  style={{
                    width: `${cellSize + 2}px`,
                    height: `${cellSize * 0.6}px`,
                    color: COLORS.secondary,
                  }}
                >
                  {bitsToStr(cv, layout.colVars)}
                </div>
              ))}
            </div>

            {/* Cells */}
            <div className="relative">
              <div
                className="grid gap-[2px]"
                style={{
                  gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
                }}
              >
                {Array.from({ length: rows }, (_, ri) =>
                  Array.from({ length: cols }, (_, ci) => {
                    const minterm = kMapPositionToMinterm(ri, ci, numVars);
                    const val = outputs[minterm];
                    const groupCols = cellGroupColors[minterm] || [];
                    const hasGroup = groupCols.length > 0;
                    const primaryGroupColor = groupCols[0];

                    return (
                      <button
                        key={`${ri}-${ci}`}
                        onClick={() => onToggleOutput(minterm)}
                        className="flex items-center justify-center rounded-md font-mono font-bold text-sm transition-all duration-150 hover:scale-105"
                        style={{
                          width: `${cellSize}px`,
                          height: `${cellSize}px`,
                          backgroundColor: hasGroup
                            ? `${primaryGroupColor}20`
                            : val === 1
                            ? "rgba(255,255,255,0.08)"
                            : "rgba(17,17,24,0.6)",
                          border: hasGroup
                            ? `2px solid ${primaryGroupColor}60`
                            : `1px solid ${COLORS.border}`,
                          color: val === 1 ? "#ffffff" : COLORS.muted,
                          boxShadow: hasGroup
                            ? `0 0 8px ${primaryGroupColor}20`
                            : "none",
                        }}
                      >
                        <div className="flex flex-col items-center">
                          <span>{val}</span>
                          <span className="text-[8px] opacity-50">m{minterm}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Group overlays - rendered as rounded rectangles */}
              {groups.slice(0, visibleGroupCount).map((group, gi) => {
                // Find bounding box in grid coordinates
                const positions = group.cells.map((m) => mintermToKMapPosition(m, numVars));
                const minRow = Math.min(...positions.map((p) => p.row));
                const maxRow = Math.max(...positions.map((p) => p.row));
                const minCol = Math.min(...positions.map((p) => p.col));
                const maxCol = Math.max(...positions.map((p) => p.col));

                // Check if group wraps around
                const wrapsRow = maxRow - minRow > rows / 2;
                const wrapsCol = maxCol - minCol > cols / 2;

                if (wrapsRow || wrapsCol) {
                  // Don't render overlay for wrapping groups (cells already highlighted)
                  return null;
                }

                const top = minRow * (cellSize + 2) - 2;
                const left = minCol * (cellSize + 2) - 2;
                const width = (maxCol - minCol + 1) * (cellSize + 2) + 2;
                const height = (maxRow - minRow + 1) * (cellSize + 2) + 2;

                return (
                  <motion.div
                    key={gi}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: gi * 0.15 }}
                    className="absolute pointer-events-none rounded-lg"
                    style={{
                      top: `${top}px`,
                      left: `${left}px`,
                      width: `${width}px`,
                      height: `${height}px`,
                      border: `2px solid ${group.color}80`,
                      borderRadius: "10px",
                      boxShadow: `0 0 12px ${group.color}30`,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Groups legend */}
        {groups.length > 0 && visibleGroupCount > 0 && (
          <div className="mt-4 space-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: COLORS.muted }}>
              Groups Found:
            </span>
            <div className="flex flex-wrap gap-2">
              {groups.slice(0, visibleGroupCount).map((group, gi) => (
                <motion.div
                  key={gi}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: gi * 0.1 }}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md"
                  style={{
                    background: `${group.color}15`,
                    border: `1px solid ${group.color}30`,
                  }}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: group.color }}
                  />
                  <span className="text-[10px] font-mono font-bold" style={{ color: group.color }}>
                    {group.term}
                  </span>
                  <span className="text-[9px]" style={{ color: COLORS.muted }}>
                    ({group.cells.length} cells)
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MinimizationView({
  steps,
  visibleStepCount,
}: {
  steps: SimplificationStep[];
  visibleStepCount: number;
}) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
    >
      <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: COLORS.border }}>
        <Minimize2 size={14} style={{ color: COLORS.accent }} />
        <span className="text-sm font-semibold text-white">Expression Minimization</span>
      </div>

      <div className="p-4 space-y-2">
        {steps.slice(0, visibleStepCount).map((step, idx) => {
          const isLast = idx === visibleStepCount - 1;
          const isFinal = idx === steps.length - 1;

          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.05 }}
            >
              <div
                className="flex items-start gap-3 p-3 rounded-lg"
                style={{
                  background: isLast
                    ? isFinal
                      ? `${COLORS.success}10`
                      : `${COLORS.primary}08`
                    : "transparent",
                  border: isLast
                    ? `1px solid ${isFinal ? `${COLORS.success}30` : `${COLORS.primary}20`}`
                    : `1px solid transparent`,
                }}
              >
                {/* Step number */}
                <div
                  className="flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0 text-[10px] font-bold"
                  style={{
                    background: isFinal && isLast ? `${COLORS.success}20` : `${COLORS.primary}15`,
                    color: isFinal && isLast ? COLORS.success : COLORS.primary,
                  }}
                >
                  {idx + 1}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Expression */}
                  <div
                    className="font-mono text-sm font-bold break-all"
                    style={{ color: isFinal && isLast ? COLORS.success : "#ffffff" }}
                  >
                    F = {step.expression}
                  </div>

                  {/* Law */}
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{
                        background: `${COLORS.accent}15`,
                        color: COLORS.accent,
                      }}
                    >
                      {step.law}
                    </span>
                    <span className="text-[10px]" style={{ color: COLORS.muted }}>
                      {step.description}
                    </span>
                  </div>
                </div>

                {/* Arrow to next */}
                {idx < visibleStepCount - 1 && (
                  <ChevronRight size={14} style={{ color: COLORS.muted }} className="mt-1 flex-shrink-0" />
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function ExpressionDisplay({
  outputs,
  numVars,
  groups,
  visibleGroupCount,
}: {
  outputs: number[];
  numVars: number;
  groups: KMapGroup[];
  visibleGroupCount: number;
}) {
  const sopExpression = outputsToSOP(outputs, numVars);
  const minimizedTerms = groups.slice(0, visibleGroupCount).map((g) => g.term);
  const minimizedExpression = minimizedTerms.length > 0 ? minimizedTerms.join(" + ") : "0";

  const mintermCount = outputs.filter((o) => o === 1).length;
  const sopTermCount = mintermCount;
  const minTermCount = minimizedTerms.length;
  const reduction = sopTermCount > 0 ? Math.round((1 - minTermCount / sopTermCount) * 100) : 0;

  return (
    <div
      className="rounded-xl p-3 space-y-3"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
    >
      <div className="flex items-center gap-2">
        <Sigma size={12} style={{ color: COLORS.accent }} />
        <span className="text-xs font-semibold text-white">Expressions</span>
      </div>

      {/* SOP */}
      <div>
        <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: COLORS.muted }}>
          Sum of Products (SOP)
        </span>
        <div
          className="mt-1 px-3 py-2 rounded-lg font-mono text-xs break-all"
          style={{
            background: "rgba(30,30,46,0.5)",
            border: `1px solid ${COLORS.border}`,
            color: "#e4e4e7",
          }}
        >
          F = {sopExpression}
        </div>
      </div>

      {/* Minimized */}
      {visibleGroupCount > 0 && (
        <div>
          <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: COLORS.success }}>
            Minimized
          </span>
          <div
            className="mt-1 px-3 py-2 rounded-lg font-mono text-xs font-bold break-all"
            style={{
              background: `${COLORS.success}08`,
              border: `1px solid ${COLORS.success}25`,
              color: COLORS.success,
            }}
          >
            F = {minimizedExpression}
          </div>
        </div>
      )}

      {/* Reduction metric */}
      {visibleGroupCount > 0 && visibleGroupCount >= groups.length && (
        <div className="flex items-center gap-3 text-[10px]">
          <span style={{ color: COLORS.muted }}>
            {sopTermCount} terms → {minTermCount} terms
          </span>
          <span
            className="font-bold px-1.5 py-0.5 rounded"
            style={{
              background: `${COLORS.success}15`,
              color: COLORS.success,
            }}
          >
            {reduction}% reduction
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BooleanAlgebraPage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<ModeType>("karnaugh-map");
  const [numVars, setNumVars] = useState(3);
  const [outputs, setOutputs] = useState<number[]>([0, 1, 0, 1, 0, 1, 1, 1]);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey>("3-variable");
  const [showMetrics, setShowMetrics] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  // ── Simulation state ────────────────────────────────────────────────────────
  const [visibleGroupCount, setVisibleGroupCount] = useState(0);
  const [visibleStepCount, setVisibleStepCount] = useState(0);
  const [autoPlayPhase, setAutoPlayPhase] = useState(0);
  // Phase 0: truth table highlight, Phase 1: K-map groups, Phase 2: expression minimization
  const [highlightRow, setHighlightRow] = useState(-1);
  const [stepCount, setStepCount] = useState(0);

  // ── Minimization state ──────────────────────────────────────────────────────
  const [simplificationSteps, setSimplificationSteps] = useState<SimplificationStep[]>([]);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // ── Derived data ────────────────────────────────────────────────────────────
  const groups = findKMapGroups(outputs, numVars);
  const mintermCount = outputs.filter((o) => o === 1).length;
  const scenario = SCENARIOS.find((s) => s.key === selectedScenario)!;

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleToggleOutput = useCallback((idx: number) => {
    setOutputs((prev) => {
      const next = [...prev];
      next[idx] = next[idx] === 1 ? 0 : 1;
      return next;
    });
    setVisibleGroupCount(0);
  }, []);

  const handleNumVarsChange = useCallback((nv: number) => {
    setNumVars(nv);
    const size = Math.pow(2, nv);
    setOutputs(new Array(size).fill(0));
    setVisibleGroupCount(0);
    setVisibleStepCount(0);
    setHighlightRow(-1);
  }, []);

  const handleModeChange = useCallback((m: ModeType) => {
    setMode(m);
    if (m === "minimization") {
      const expression = outputsToSOP(outputs, numVars);
      if (selectedScenario === "demorgan") {
        setSimplificationSteps(generateSimplificationSteps("(A'B')' + AB'"));
      } else {
        setSimplificationSteps(generateSimplificationSteps(expression));
      }
    }
  }, [outputs, numVars, selectedScenario]);

  // ── Step forward ────────────────────────────────────────────────────────────
  const stepForward = useCallback(() => {
    const totalRows = Math.pow(2, numVars);

    if (mode === "truth-table" || (mode === "karnaugh-map" && autoPlayPhase === 0)) {
      // Phase 0: highlight truth table rows
      if (highlightRow < totalRows - 1) {
        setHighlightRow((prev) => prev + 1);
        setStepCount((prev) => prev + 1);
        return true;
      }
      // Move to K-map grouping phase
      if (mode === "karnaugh-map") {
        setAutoPlayPhase(1);
        setStepCount((prev) => prev + 1);
        return true;
      }
      // Truth table mode complete
      setIsComplete(true);
      setIsPlaying(false);
      return false;
    }

    if (mode === "karnaugh-map" && autoPlayPhase === 1) {
      // Phase 1: reveal groups one at a time
      if (visibleGroupCount < groups.length) {
        setVisibleGroupCount((prev) => prev + 1);
        setStepCount((prev) => prev + 1);
        return true;
      }
      // All groups revealed
      setAutoPlayPhase(2);
      setStepCount((prev) => prev + 1);
      return true;
    }

    if (mode === "karnaugh-map" && autoPlayPhase === 2) {
      // Phase 2: done
      setIsComplete(true);
      setIsPlaying(false);
      return false;
    }

    if (mode === "minimization") {
      // Reveal simplification steps
      if (visibleStepCount < simplificationSteps.length) {
        setVisibleStepCount((prev) => prev + 1);
        setStepCount((prev) => prev + 1);
        return true;
      }
      setIsComplete(true);
      setIsPlaying(false);
      return false;
    }

    return false;
  }, [mode, numVars, highlightRow, autoPlayPhase, visibleGroupCount, groups.length, visibleStepCount, simplificationSteps.length]);

  // ── Animation loop ──────────────────────────────────────────────────────────
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(10, 200 / speedRef.current);
      if (timestamp - lastTickRef.current >= interval) {
        lastTickRef.current = timestamp;
        const active = stepForward();
        if (!active) return;
      }
      animationRef.current = requestAnimationFrame(animationLoop);
    },
    [stepForward]
  );

  const handlePlay = useCallback(() => {
    if (isComplete) return;
    setIsPlaying(true);
    isPlayingRef.current = true;
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop, isComplete]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const handleStep = useCallback(() => {
    if (isComplete) return;
    handlePause();
    stepForward();
  }, [handlePause, stepForward, isComplete]);

  const handleReset = useCallback(() => {
    handlePause();
    setVisibleGroupCount(0);
    setVisibleStepCount(0);
    setAutoPlayPhase(0);
    setHighlightRow(-1);
    setStepCount(0);
    setIsComplete(false);
  }, [handlePause]);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Scenario change handler
  const handleScenarioChange = useCallback((key: ScenarioKey) => {
    setSelectedScenario(key);
    const sc = SCENARIOS.find((s) => s.key === key)!;
    setMode(sc.mode);
    setNumVars(sc.numVars);
    if (sc.outputs) {
      setOutputs([...sc.outputs]);
    } else {
      setOutputs(new Array(Math.pow(2, sc.numVars)).fill(0));
    }
    if (sc.mode === "minimization" && sc.expression) {
      setSimplificationSteps(generateSimplificationSteps(sc.expression));
    }
    setVisibleGroupCount(0);
    setVisibleStepCount(0);
    setAutoPlayPhase(0);
    setHighlightRow(-1);
    setStepCount(0);
    setIsComplete(false);
    handlePause();
  }, [handlePause]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: COLORS.bg }}>
      <Navbar />

      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* ── Header ──────────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
            className="mb-6"
          >
            <div className="flex items-center gap-3 mb-2">
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-semibold"
                style={{
                  background: `${COLORS.stone}15`,
                  color: COLORS.stone,
                  border: `1px solid ${COLORS.stone}30`,
                }}
              >
                16.1
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Boolean Algebra & Logic
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Explore truth tables, Karnaugh maps, and boolean expression minimization.
              Build boolean functions interactively, watch optimal groupings form, and
              see step-by-step simplification using algebraic laws.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium"
                style={{
                  background: `${COLORS.stone}10`,
                  color: COLORS.stone,
                  border: `1px solid ${COLORS.stone}20`,
                }}
              >
                <Binary size={11} />
                Math Foundations for CS
              </span>
            </div>
          </motion.div>

          {/* ── Scenario selector ───────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
            className="flex flex-wrap items-center gap-3 mb-4"
          >
            <span className="text-xs text-[#71717a] font-medium">Scenarios:</span>
            {SCENARIOS.map((s) => (
              <button
                key={s.key}
                onClick={() => handleScenarioChange(s.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                style={{
                  background: selectedScenario === s.key ? `${COLORS.stone}20` : "transparent",
                  color: selectedScenario === s.key ? "#ffffff" : COLORS.muted,
                  border:
                    selectedScenario === s.key
                      ? `1px solid ${COLORS.stone}40`
                      : "1px solid transparent",
                }}
                title={s.description}
              >
                {s.label}
              </button>
            ))}
          </motion.div>

          {/* ── Mode selector and variable count ───────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: [0.23, 1, 0.32, 1] }}
            className="flex flex-wrap items-center gap-4 mb-4"
          >
            <ModeSelector mode={mode} onModeChange={handleModeChange} />

            {mode !== "minimization" && (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: COLORS.muted }}>Variables:</span>
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => handleNumVarsChange(n)}
                    className="w-8 h-8 rounded-lg text-xs font-bold font-mono transition-all duration-200"
                    style={{
                      background: numVars === n ? `${COLORS.primary}15` : "transparent",
                      color: numVars === n ? COLORS.primary : COLORS.muted,
                      border: numVars === n ? `1px solid ${COLORS.primary}30` : `1px solid ${COLORS.border}`,
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}

            {mode !== "minimization" && (
              <button
                onClick={() => {
                  setOutputs(generateRandomOutputs(numVars));
                  setVisibleGroupCount(0);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                style={{
                  background: `${COLORS.accent}10`,
                  color: COLORS.accent,
                  border: `1px solid ${COLORS.accent}25`,
                }}
              >
                Random Function
              </button>
            )}
          </motion.div>

          {/* ── Main visualization area ─────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4"
          >
            {/* Main view */}
            <div className="lg:col-span-2 space-y-4 relative">
              {mode === "truth-table" && (
                <TruthTableView
                  numVars={numVars}
                  outputs={outputs}
                  onToggleOutput={handleToggleOutput}
                  highlightRow={highlightRow}
                />
              )}

              {mode === "karnaugh-map" && (
                <>
                  <KarnaughMapView
                    numVars={numVars}
                    outputs={outputs}
                    onToggleOutput={handleToggleOutput}
                    groups={groups}
                    visibleGroupCount={visibleGroupCount}
                  />
                </>
              )}

              {mode === "minimization" && (
                <MinimizationView
                  steps={simplificationSteps}
                  visibleStepCount={visibleStepCount}
                />
              )}

              {/* Metrics overlay */}
              <AnimatePresence>
                {showMetrics && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-wrap gap-2"
                  >
                    <MetricBadge
                      icon={<Hash size={12} />}
                      label="Variables"
                      value={numVars}
                      color={COLORS.primary}
                    />
                    <MetricBadge
                      icon={<ToggleRight size={12} />}
                      label="Minterms"
                      value={mintermCount}
                      color={COLORS.success}
                    />
                    <MetricBadge
                      icon={<Grid3X3 size={12} />}
                      label="Groups"
                      value={`${visibleGroupCount}/${groups.length}`}
                      color={COLORS.secondary}
                    />
                    <MetricBadge
                      icon={<Activity size={12} />}
                      label="Steps"
                      value={stepCount}
                      color={COLORS.accent}
                    />
                    {visibleGroupCount >= groups.length && groups.length > 0 && (
                      <MetricBadge
                        icon={<Minimize2 size={12} />}
                        label="Reduction"
                        value={`${mintermCount > 0 ? Math.round((1 - groups.length / mintermCount) * 100) : 0}%`}
                        color={COLORS.success}
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Side panel */}
            <div className="lg:col-span-1 space-y-3">
              {/* Truth table (shown in K-map / minimization mode) */}
              {mode !== "truth-table" && (
                <TruthTableView
                  numVars={numVars}
                  outputs={outputs}
                  onToggleOutput={handleToggleOutput}
                  highlightRow={highlightRow}
                />
              )}

              {/* Expression display */}
              <ExpressionDisplay
                outputs={outputs}
                numVars={numVars}
                groups={groups}
                visibleGroupCount={visibleGroupCount}
              />

              {/* Boolean algebra laws reference */}
              <div
                className="rounded-xl p-3"
                style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb size={12} style={{ color: COLORS.accent }} />
                  <span className="text-xs font-semibold text-white">Boolean Laws</span>
                </div>
                <div className="space-y-1 text-[10px] font-mono">
                  {[
                    { law: "Identity", formula: "A + 0 = A, A . 1 = A" },
                    { law: "Null", formula: "A + 1 = 1, A . 0 = 0" },
                    { law: "Complement", formula: "A + A' = 1, A . A' = 0" },
                    { law: "Idempotent", formula: "A + A = A, A . A = A" },
                    { law: "Absorption", formula: "A + AB = A" },
                    { law: "De Morgan", formula: "(AB)' = A'+B'" },
                    { law: "Consensus", formula: "AB + A'C + BC = AB + A'C" },
                  ].map((item) => (
                    <div key={item.law} className="flex items-start gap-2">
                      <span className="text-[9px] font-semibold w-20 flex-shrink-0" style={{ color: COLORS.accent }}>
                        {item.law}
                      </span>
                      <span style={{ color: "#a1a1aa" }}>{item.formula}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* K-map explanation */}
              {mode === "karnaugh-map" && (
                <div
                  className="rounded-xl p-3"
                  style={{
                    background: `${COLORS.primary}08`,
                    border: `1px solid ${COLORS.primary}20`,
                  }}
                >
                  <div className="flex items-start gap-2">
                    <Info size={14} className="mt-0.5 flex-shrink-0" style={{ color: COLORS.primary }} />
                    <div>
                      <span className="text-xs font-semibold text-white block mb-1">K-Map Grouping Rules</span>
                      <ul className="text-[10px] leading-relaxed space-y-0.5" style={{ color: "#a1a1aa" }}>
                        <li>Groups must be powers of 2 (1, 2, 4, 8)</li>
                        <li>Groups must be rectangular</li>
                        <li>Groups can wrap around edges</li>
                        <li>Larger groups = simpler terms</li>
                        <li>Every 1-cell must be in at least one group</li>
                        <li>Overlapping groups are allowed</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Interactive hint */}
              <div
                className="rounded-xl p-3"
                style={{
                  background: `${COLORS.success}06`,
                  border: `1px solid ${COLORS.success}18`,
                }}
              >
                <div className="flex items-start gap-2">
                  <ToggleLeft size={14} className="mt-0.5 flex-shrink-0" style={{ color: COLORS.success }} />
                  <div>
                    <span className="text-xs font-semibold text-white block mb-1">Interactive</span>
                    <span className="text-[10px] leading-relaxed" style={{ color: "#a1a1aa" }}>
                      Click any output cell in the truth table or K-map to toggle between 0 and 1.
                      The boolean expression and K-map groupings will update automatically.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Controls panel ──────────────────────────────────────────── */}
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
            >
              <AnimatePresence>
                {isComplete && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                    style={{
                      background: "rgba(16,185,129,0.1)",
                      border: "1px solid rgba(16,185,129,0.2)",
                    }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                    <span className="text-xs font-medium text-[#10b981]">
                      {mode === "karnaugh-map" ? "All groups found" : mode === "minimization" ? "Simplification complete" : "All rows shown"}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </ModuleControls>
          </motion.div>

          {/* ── Educational info panel ──────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="mt-6 rounded-2xl overflow-hidden"
            style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
          >
            <div
              className="px-5 py-3.5 border-b flex items-center gap-2"
              style={{ borderColor: COLORS.border }}
            >
              <Info size={14} style={{ color: COLORS.stone }} />
              <span className="text-sm font-semibold text-white">
                Understanding Boolean Algebra
              </span>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.secondary }}
                >
                  Why Boolean Minimization Matters
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#a1a1aa" }}>
                  Every digital circuit implements a boolean function. Minimizing the boolean
                  expression directly reduces the number of logic gates needed, resulting in
                  smaller, faster, and more power-efficient circuits. This optimization is
                  fundamental to chip design, from simple microcontrollers to modern CPUs.
                </p>
              </div>

              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.accent }}
                >
                  Approaches to Minimization
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    {
                      title: "Algebraic",
                      desc: "Apply boolean algebra laws step by step. Good for learning, but can miss optimal solutions.",
                    },
                    {
                      title: "Karnaugh Maps",
                      desc: "Visual method for up to 4-6 variables. Group adjacent 1-cells to find minimal product terms.",
                    },
                    {
                      title: "Quine-McCluskey",
                      desc: "Algorithmic method for any number of variables. Guaranteed optimal but computationally expensive.",
                    },
                  ].map((method) => (
                    <div
                      key={method.title}
                      className="p-3 rounded-lg"
                      style={{ background: "rgba(30,30,46,0.3)", border: `1px solid ${COLORS.border}` }}
                    >
                      <span className="text-xs font-semibold text-white block mb-1">{method.title}</span>
                      <span className="text-[10px] leading-relaxed" style={{ color: "#a1a1aa" }}>
                        {method.desc}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div
                className="rounded-xl p-4"
                style={{
                  background: `${COLORS.stone}08`,
                  border: `1px solid ${COLORS.stone}18`,
                }}
              >
                <div className="flex items-start gap-2">
                  <Lightbulb size={16} className="mt-0.5 flex-shrink-0" style={{ color: COLORS.stone }} />
                  <div>
                    <span className="text-xs font-semibold text-white block mb-1">Key Insight</span>
                    <span className="text-xs leading-relaxed" style={{ color: "#a1a1aa" }}>
                      In a Karnaugh map, adjacent cells differ by exactly one variable (Gray code ordering).
                      When two adjacent cells are both 1, the differing variable can be eliminated from the
                      product term. This is why larger groups yield simpler expressions: a group of 4 cells
                      in a 3-variable K-map eliminates 2 variables, leaving just 1 variable in the term.
                      This visual insight is exactly what the algebraic Consensus theorem captures formally.
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-3"
                  style={{ color: COLORS.muted }}
                >
                  Key Concepts
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b" style={{ borderColor: COLORS.border }}>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>
                          Concept
                        </th>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>
                          Description
                        </th>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>
                          Example
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { concept: "Minterm", desc: "Product term where all variables appear", example: "ABC' (m5)" },
                        { concept: "Maxterm", desc: "Sum term where all variables appear", example: "A+B+C' (M2)" },
                        { concept: "SOP", desc: "Sum of Products canonical form", example: "AB + A'C + BC" },
                        { concept: "POS", desc: "Product of Sums canonical form", example: "(A+B)(A'+C)" },
                        { concept: "Don't Care", desc: "Output undefined for some inputs", example: "X in truth table" },
                        { concept: "Prime Implicant", desc: "Largest possible group in K-map", example: "Group of 4 cells" },
                      ].map((row, idx) => (
                        <tr
                          key={idx}
                          className="border-b"
                          style={{ borderColor: `${COLORS.border}50` }}
                        >
                          <td className="px-3 py-2 font-mono font-semibold" style={{ color: "#e4e4e7" }}>
                            {row.concept}
                          </td>
                          <td className="px-3 py-2" style={{ color: "#a1a1aa" }}>
                            {row.desc}
                          </td>
                          <td className="px-3 py-2 font-mono" style={{ color: COLORS.secondary }}>
                            {row.example}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
