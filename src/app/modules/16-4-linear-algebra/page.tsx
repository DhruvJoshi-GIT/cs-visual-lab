"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Info,
  Lightbulb,
  Hash,
  Activity,
  RotateCw,
  Maximize2,
  Minimize2,
  FlipHorizontal,
  Layers,
  Grid3X3,
  Sigma,
  MoveHorizontal,
  Binary,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

type TransformType = "rotation" | "scaling" | "shear" | "reflection" | "composition";

type ReflectionAxis = "x" | "y" | "y=x";

type ScenarioKey = "rotation-45" | "scale-2x" | "shear-x" | "composition";

interface Matrix2x2 {
  a: number;
  b: number;
  c: number;
  d: number;
}

interface Vec2 {
  x: number;
  y: number;
}

interface TransformState {
  type: TransformType;
  angle: number;
  scaleX: number;
  scaleY: number;
  shearX: number;
  shearY: number;
  reflectionAxis: ReflectionAxis;
}

interface Scenario {
  key: ScenarioKey;
  label: string;
  description: string;
  transforms: TransformState[];
}

interface CompositionEntry {
  transform: TransformState;
  matrix: Matrix2x2;
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
  iHat: "#ef4444",
  jHat: "#6366f1",
  eigen: "#10b981",
  originalShape: "#52525b",
  transformedShape: "#6366f1",
};

const GRID_RANGE = 5;
const GRID_STEP = 1;
const VIEW_SIZE = 440;
const ORIGIN = VIEW_SIZE / 2;
const SCALE_FACTOR = VIEW_SIZE / (GRID_RANGE * 2 + 2);

const DEFAULT_TRANSFORM: TransformState = {
  type: "rotation",
  angle: 0,
  scaleX: 1,
  scaleY: 1,
  shearX: 0,
  shearY: 0,
  reflectionAxis: "x",
};

const UNIT_SQUARE: Vec2[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const SCENARIOS: Scenario[] = [
  {
    key: "rotation-45",
    label: "Rotation 45\u00b0",
    description: "Rotate the plane by 45 degrees",
    transforms: [{ ...DEFAULT_TRANSFORM, type: "rotation", angle: 45 }],
  },
  {
    key: "scale-2x",
    label: "Scale 2x",
    description: "Scale uniformly by factor of 2",
    transforms: [{ ...DEFAULT_TRANSFORM, type: "scaling", scaleX: 2, scaleY: 2 }],
  },
  {
    key: "shear-x",
    label: "Shear X",
    description: "Shear along the X axis",
    transforms: [{ ...DEFAULT_TRANSFORM, type: "shear", shearX: 1 }],
  },
  {
    key: "composition",
    label: "Composition",
    description: "Chain rotation then scaling",
    transforms: [
      { ...DEFAULT_TRANSFORM, type: "rotation", angle: 30 },
      { ...DEFAULT_TRANSFORM, type: "scaling", scaleX: 1.5, scaleY: 0.8 },
    ],
  },
];

// ─── Math Helpers ─────────────────────────────────────────────────────────────

function transformToMatrix(t: TransformState): Matrix2x2 {
  switch (t.type) {
    case "rotation": {
      const rad = (t.angle * Math.PI) / 180;
      return {
        a: Math.cos(rad),
        b: -Math.sin(rad),
        c: Math.sin(rad),
        d: Math.cos(rad),
      };
    }
    case "scaling":
      return { a: t.scaleX, b: 0, c: 0, d: t.scaleY };
    case "shear":
      return { a: 1, b: t.shearX, c: t.shearY, d: 1 };
    case "reflection": {
      switch (t.reflectionAxis) {
        case "x":
          return { a: 1, b: 0, c: 0, d: -1 };
        case "y":
          return { a: -1, b: 0, c: 0, d: 1 };
        case "y=x":
          return { a: 0, b: 1, c: 1, d: 0 };
      }
      break;
    }
    case "composition":
      return { a: 1, b: 0, c: 0, d: 1 };
  }
  return { a: 1, b: 0, c: 0, d: 1 };
}

function multiplyMatrices(m1: Matrix2x2, m2: Matrix2x2): Matrix2x2 {
  return {
    a: m1.a * m2.a + m1.b * m2.c,
    b: m1.a * m2.b + m1.b * m2.d,
    c: m1.c * m2.a + m1.d * m2.c,
    d: m1.c * m2.b + m1.d * m2.d,
  };
}

function applyMatrix(m: Matrix2x2, v: Vec2): Vec2 {
  return {
    x: m.a * v.x + m.b * v.y,
    y: m.c * v.x + m.d * v.y,
  };
}

function determinant(m: Matrix2x2): number {
  return m.a * m.d - m.b * m.c;
}

function lerpMatrix(m1: Matrix2x2, m2: Matrix2x2, t: number): Matrix2x2 {
  return {
    a: m1.a + (m2.a - m1.a) * t,
    b: m1.b + (m2.b - m1.b) * t,
    c: m1.c + (m2.c - m1.c) * t,
    d: m1.d + (m2.d - m1.d) * t,
  };
}

function computeEigenvalues(m: Matrix2x2): { l1: { re: number; im: number }; l2: { re: number; im: number } } {
  const trace = m.a + m.d;
  const det = determinant(m);
  const discriminant = trace * trace - 4 * det;

  if (discriminant >= 0) {
    const sqrtD = Math.sqrt(discriminant);
    return {
      l1: { re: (trace + sqrtD) / 2, im: 0 },
      l2: { re: (trace - sqrtD) / 2, im: 0 },
    };
  } else {
    const sqrtD = Math.sqrt(-discriminant);
    return {
      l1: { re: trace / 2, im: sqrtD / 2 },
      l2: { re: trace / 2, im: -sqrtD / 2 },
    };
  }
}

function computeEigenvectors(m: Matrix2x2): Vec2[] {
  const eig = computeEigenvalues(m);
  const vectors: Vec2[] = [];

  if (eig.l1.im !== 0) return vectors; // Complex eigenvalues, no real eigenvectors

  for (const lambda of [eig.l1.re, eig.l2.re]) {
    // (M - lambda*I) * v = 0
    const a = m.a - lambda;
    const b = m.b;
    const c = m.c;
    const d = m.d - lambda;

    let vx: number, vy: number;

    if (Math.abs(a) > 0.0001 || Math.abs(b) > 0.0001) {
      if (Math.abs(a) > Math.abs(b)) {
        vx = -b / a;
        vy = 1;
      } else {
        vx = 1;
        vy = -a / b;
      }
    } else if (Math.abs(c) > 0.0001 || Math.abs(d) > 0.0001) {
      if (Math.abs(c) > Math.abs(d)) {
        vx = -d / c;
        vy = 1;
      } else {
        vx = 1;
        vy = -c / d;
      }
    } else {
      continue;
    }

    // Normalize
    const len = Math.sqrt(vx * vx + vy * vy);
    if (len > 0.0001) {
      vectors.push({ x: vx / len, y: vy / len });
    }
  }

  return vectors;
}

function worldToScreen(v: Vec2): { x: number; y: number } {
  return {
    x: ORIGIN + v.x * SCALE_FACTOR,
    y: ORIGIN - v.y * SCALE_FACTOR,
  };
}

function formatNum(n: number): string {
  return Math.abs(n) < 0.005 ? "0" : n.toFixed(2);
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

function MatrixDisplay({
  matrix,
  label,
  color,
  editable,
  onChange,
}: {
  matrix: Matrix2x2;
  label: string;
  color: string;
  editable?: boolean;
  onChange?: (m: Matrix2x2) => void;
}) {
  const cellStyle = (val: number): React.CSSProperties => ({
    color: Math.abs(val) < 0.005 ? COLORS.muted : "#ffffff",
  });

  return (
    <div
      className="rounded-xl p-3"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Sigma size={12} style={{ color }} />
        <span className="text-xs font-semibold text-white">{label}</span>
      </div>

      <div className="flex items-center gap-1 justify-center">
        {/* Left bracket */}
        <div
          className="w-1.5 h-16 rounded-l-sm"
          style={{ borderLeft: `2px solid ${color}`, borderTop: `2px solid ${color}`, borderBottom: `2px solid ${color}` }}
        />

        <div className="grid grid-cols-2 gap-1 px-2">
          {[
            { key: "a", val: matrix.a },
            { key: "b", val: matrix.b },
            { key: "c", val: matrix.c },
            { key: "d", val: matrix.d },
          ].map((entry) =>
            editable && onChange ? (
              <input
                key={entry.key}
                type="number"
                step="0.1"
                value={parseFloat(entry.val.toFixed(2))}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0;
                  onChange({ ...matrix, [entry.key]: v });
                }}
                className="w-14 h-7 text-center font-mono text-sm font-bold bg-[#0a0a0f] rounded border border-[#1e1e2e] text-white focus:outline-none focus:border-[#6366f1] transition-colors"
              />
            ) : (
              <div
                key={entry.key}
                className="w-14 h-7 flex items-center justify-center font-mono text-sm font-bold"
                style={cellStyle(entry.val)}
              >
                {formatNum(entry.val)}
              </div>
            )
          )}
        </div>

        {/* Right bracket */}
        <div
          className="w-1.5 h-16 rounded-r-sm"
          style={{ borderRight: `2px solid ${color}`, borderTop: `2px solid ${color}`, borderBottom: `2px solid ${color}` }}
        />
      </div>
    </div>
  );
}

function TransformControls({
  transform,
  onChange,
}: {
  transform: TransformState;
  onChange: (t: TransformState) => void;
}) {
  return (
    <div
      className="rounded-xl p-3 space-y-3"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
    >
      <div className="flex items-center gap-2">
        <MoveHorizontal size={12} style={{ color: COLORS.accent }} />
        <span className="text-xs font-semibold text-white">Transform Controls</span>
      </div>

      {/* Transform type selector */}
      <div className="flex flex-wrap gap-1">
        {(["rotation", "scaling", "shear", "reflection", "composition"] as TransformType[]).map((type) => {
          const icons: Record<TransformType, React.ReactNode> = {
            rotation: <RotateCw size={10} />,
            scaling: <Maximize2 size={10} />,
            shear: <MoveHorizontal size={10} />,
            reflection: <FlipHorizontal size={10} />,
            composition: <Layers size={10} />,
          };
          return (
            <button
              key={type}
              onClick={() => onChange({ ...transform, type })}
              className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-medium transition-all duration-200"
              style={{
                background: transform.type === type ? `${COLORS.primary}15` : "transparent",
                color: transform.type === type ? COLORS.primary : COLORS.muted,
                border: transform.type === type ? `1px solid ${COLORS.primary}30` : `1px solid ${COLORS.border}`,
              }}
            >
              {icons[type]}
              <span className="capitalize">{type}</span>
            </button>
          );
        })}
      </div>

      {/* Type-specific controls */}
      {transform.type === "rotation" && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px]" style={{ color: COLORS.muted }}>Angle</span>
            <span className="text-[10px] font-mono font-bold" style={{ color: COLORS.primary }}>
              {transform.angle.toFixed(0)}\u00b0
            </span>
          </div>
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={transform.angle}
            onChange={(e) => onChange({ ...transform, angle: parseFloat(e.target.value) })}
            className="w-full h-1.5 accent-[#6366f1] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#6366f1]"
          />
        </div>
      )}

      {transform.type === "scaling" && (
        <>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px]" style={{ color: COLORS.muted }}>Scale X</span>
              <span className="text-[10px] font-mono font-bold" style={{ color: COLORS.iHat }}>
                {transform.scaleX.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min={-3}
              max={3}
              step={0.1}
              value={transform.scaleX}
              onChange={(e) => onChange({ ...transform, scaleX: parseFloat(e.target.value) })}
              className="w-full h-1.5 accent-[#ef4444] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#ef4444]"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px]" style={{ color: COLORS.muted }}>Scale Y</span>
              <span className="text-[10px] font-mono font-bold" style={{ color: COLORS.jHat }}>
                {transform.scaleY.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min={-3}
              max={3}
              step={0.1}
              value={transform.scaleY}
              onChange={(e) => onChange({ ...transform, scaleY: parseFloat(e.target.value) })}
              className="w-full h-1.5 accent-[#6366f1] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#6366f1]"
            />
          </div>
        </>
      )}

      {transform.type === "shear" && (
        <>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px]" style={{ color: COLORS.muted }}>Shear X</span>
              <span className="text-[10px] font-mono font-bold" style={{ color: COLORS.accent }}>
                {transform.shearX.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min={-3}
              max={3}
              step={0.1}
              value={transform.shearX}
              onChange={(e) => onChange({ ...transform, shearX: parseFloat(e.target.value) })}
              className="w-full h-1.5 accent-[#f59e0b] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f59e0b]"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px]" style={{ color: COLORS.muted }}>Shear Y</span>
              <span className="text-[10px] font-mono font-bold" style={{ color: COLORS.accent }}>
                {transform.shearY.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min={-3}
              max={3}
              step={0.1}
              value={transform.shearY}
              onChange={(e) => onChange({ ...transform, shearY: parseFloat(e.target.value) })}
              className="w-full h-1.5 accent-[#f59e0b] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f59e0b]"
            />
          </div>
        </>
      )}

      {transform.type === "reflection" && (
        <div className="flex gap-2">
          {(["x", "y", "y=x"] as ReflectionAxis[]).map((axis) => (
            <button
              key={axis}
              onClick={() => onChange({ ...transform, reflectionAxis: axis })}
              className="flex-1 px-2 py-2 rounded-lg text-xs font-mono font-bold transition-all duration-200 text-center"
              style={{
                background: transform.reflectionAxis === axis ? `${COLORS.primary}15` : "transparent",
                color: transform.reflectionAxis === axis ? COLORS.primary : COLORS.muted,
                border: transform.reflectionAxis === axis
                  ? `1px solid ${COLORS.primary}30`
                  : `1px solid ${COLORS.border}`,
              }}
            >
              {axis === "x" ? "X axis" : axis === "y" ? "Y axis" : "y = x"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CoordinatePlane({
  currentMatrix,
  animProgress,
  targetMatrix,
  eigenvectors,
  showEigen,
}: {
  currentMatrix: Matrix2x2;
  animProgress: number;
  targetMatrix: Matrix2x2;
  eigenvectors: Vec2[];
  showEigen: boolean;
}) {
  const identity: Matrix2x2 = { a: 1, b: 0, c: 0, d: 1 };
  const interpMatrix = lerpMatrix(identity, targetMatrix, animProgress);
  const displayMatrix = animProgress < 1 ? interpMatrix : currentMatrix;

  // Transform unit square
  const originalScreenPoints = UNIT_SQUARE.map(worldToScreen);
  const transformedPoints = UNIT_SQUARE.map((v) => applyMatrix(displayMatrix, v));
  const transformedScreenPoints = transformedPoints.map(worldToScreen);

  // Basis vectors
  const iHatOrig = worldToScreen({ x: 1, y: 0 });
  const jHatOrig = worldToScreen({ x: 0, y: 1 });
  const iHatTransformed = worldToScreen(applyMatrix(displayMatrix, { x: 1, y: 0 }));
  const jHatTransformed = worldToScreen(applyMatrix(displayMatrix, { x: 0, y: 1 }));

  const originScreen = worldToScreen({ x: 0, y: 0 });

  // Determinant area - area of transformed unit square
  const det = determinant(displayMatrix);

  return (
    <div
      className="relative rounded-2xl overflow-hidden"
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        width: "100%",
        maxWidth: `${VIEW_SIZE + 32}px`,
      }}
    >
      <div
        className="relative mx-auto"
        style={{
          width: `${VIEW_SIZE}px`,
          height: `${VIEW_SIZE}px`,
          margin: "16px auto",
        }}
      >
        {/* Grid lines */}
        {Array.from({ length: GRID_RANGE * 2 + 1 }, (_, i) => {
          const val = i - GRID_RANGE;
          const pos = ORIGIN + val * SCALE_FACTOR;
          const isAxis = val === 0;

          return (
            <div key={`grid-${i}`}>
              {/* Vertical line */}
              <div
                className="absolute top-0"
                style={{
                  left: `${pos}px`,
                  width: isAxis ? "1.5px" : "1px",
                  height: `${VIEW_SIZE}px`,
                  backgroundColor: isAxis ? "#2a2a3e" : "#151520",
                }}
              />
              {/* Horizontal line */}
              <div
                className="absolute left-0"
                style={{
                  top: `${pos}px`,
                  height: isAxis ? "1.5px" : "1px",
                  width: `${VIEW_SIZE}px`,
                  backgroundColor: isAxis ? "#2a2a3e" : "#151520",
                }}
              />

              {/* Axis labels */}
              {val !== 0 && (
                <>
                  <div
                    className="absolute text-[8px] font-mono"
                    style={{
                      left: `${pos - 4}px`,
                      top: `${ORIGIN + 4}px`,
                      color: COLORS.muted,
                    }}
                  >
                    {val}
                  </div>
                  <div
                    className="absolute text-[8px] font-mono"
                    style={{
                      left: `${ORIGIN + 4}px`,
                      top: `${ORIGIN - val * SCALE_FACTOR - 4}px`,
                      color: COLORS.muted,
                    }}
                  >
                    {val}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Axis labels */}
        <div
          className="absolute text-[10px] font-mono font-bold"
          style={{ right: "4px", top: `${ORIGIN - 14}px`, color: COLORS.muted }}
        >
          x
        </div>
        <div
          className="absolute text-[10px] font-mono font-bold"
          style={{ left: `${ORIGIN + 6}px`, top: "2px", color: COLORS.muted }}
        >
          y
        </div>

        {/* SVG overlay for shapes and vectors */}
        <svg
          className="absolute top-0 left-0"
          width={VIEW_SIZE}
          height={VIEW_SIZE}
          style={{ pointerEvents: "none" }}
        >
          {/* Transformed grid lines (subtle) */}
          {Array.from({ length: GRID_RANGE * 2 + 1 }, (_, i) => {
            const val = i - GRID_RANGE;
            // Vertical line in transformed space
            const bottom = applyMatrix(displayMatrix, { x: val, y: -GRID_RANGE });
            const top = applyMatrix(displayMatrix, { x: val, y: GRID_RANGE });
            const bScreen = worldToScreen(bottom);
            const tScreen = worldToScreen(top);

            // Horizontal line in transformed space
            const left = applyMatrix(displayMatrix, { x: -GRID_RANGE, y: val });
            const right = applyMatrix(displayMatrix, { x: GRID_RANGE, y: val });
            const lScreen = worldToScreen(left);
            const rScreen = worldToScreen(right);

            return (
              <g key={`tgrid-${i}`} opacity={0.15}>
                <line
                  x1={bScreen.x}
                  y1={bScreen.y}
                  x2={tScreen.x}
                  y2={tScreen.y}
                  stroke={COLORS.primary}
                  strokeWidth={0.5}
                />
                <line
                  x1={lScreen.x}
                  y1={lScreen.y}
                  x2={rScreen.x}
                  y2={rScreen.y}
                  stroke={COLORS.primary}
                  strokeWidth={0.5}
                />
              </g>
            );
          })}

          {/* Original unit square (semi-transparent) */}
          <polygon
            points={originalScreenPoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill={`${COLORS.originalShape}20`}
            stroke={COLORS.originalShape}
            strokeWidth={1.5}
            strokeDasharray="4,3"
          />

          {/* Transformed unit square */}
          <polygon
            points={transformedScreenPoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill={`${COLORS.transformedShape}18`}
            stroke={COLORS.transformedShape}
            strokeWidth={2}
          />

          {/* Determinant area label */}
          {animProgress >= 1 && (
            <text
              x={
                (transformedScreenPoints[0].x +
                  transformedScreenPoints[1].x +
                  transformedScreenPoints[2].x +
                  transformedScreenPoints[3].x) /
                4
              }
              y={
                (transformedScreenPoints[0].y +
                  transformedScreenPoints[1].y +
                  transformedScreenPoints[2].y +
                  transformedScreenPoints[3].y) /
                4
              }
              fill={COLORS.transformedShape}
              fontSize={10}
              fontFamily="monospace"
              fontWeight="bold"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              det={formatNum(det)}
            </text>
          )}

          {/* Original i-hat (faded) */}
          <line
            x1={originScreen.x}
            y1={originScreen.y}
            x2={iHatOrig.x}
            y2={iHatOrig.y}
            stroke={COLORS.iHat}
            strokeWidth={1}
            opacity={0.3}
            strokeDasharray="3,2"
          />

          {/* Original j-hat (faded) */}
          <line
            x1={originScreen.x}
            y1={originScreen.y}
            x2={jHatOrig.x}
            y2={jHatOrig.y}
            stroke={COLORS.jHat}
            strokeWidth={1}
            opacity={0.3}
            strokeDasharray="3,2"
          />

          {/* Transformed i-hat */}
          <line
            x1={originScreen.x}
            y1={originScreen.y}
            x2={iHatTransformed.x}
            y2={iHatTransformed.y}
            stroke={COLORS.iHat}
            strokeWidth={2.5}
          />
          <polygon
            points={arrowHead(originScreen, iHatTransformed)}
            fill={COLORS.iHat}
          />
          <text
            x={iHatTransformed.x + 6}
            y={iHatTransformed.y - 6}
            fill={COLORS.iHat}
            fontSize={10}
            fontFamily="monospace"
            fontWeight="bold"
          >
            i&#x0302;
          </text>

          {/* Transformed j-hat */}
          <line
            x1={originScreen.x}
            y1={originScreen.y}
            x2={jHatTransformed.x}
            y2={jHatTransformed.y}
            stroke={COLORS.jHat}
            strokeWidth={2.5}
          />
          <polygon
            points={arrowHead(originScreen, jHatTransformed)}
            fill={COLORS.jHat}
          />
          <text
            x={jHatTransformed.x + 6}
            y={jHatTransformed.y - 6}
            fill={COLORS.jHat}
            fontSize={10}
            fontFamily="monospace"
            fontWeight="bold"
          >
            j&#x0302;
          </text>

          {/* Eigenvectors */}
          {showEigen &&
            animProgress >= 1 &&
            eigenvectors.map((ev, i) => {
              const tip = worldToScreen({ x: ev.x * 3, y: ev.y * 3 });
              const tipNeg = worldToScreen({ x: -ev.x * 3, y: -ev.y * 3 });

              return (
                <g key={`eigen-${i}`}>
                  <line
                    x1={tipNeg.x}
                    y1={tipNeg.y}
                    x2={tip.x}
                    y2={tip.y}
                    stroke={COLORS.eigen}
                    strokeWidth={1.5}
                    strokeDasharray="6,3"
                    opacity={0.7}
                  />
                  <circle
                    cx={tip.x}
                    cy={tip.y}
                    r={4}
                    fill={COLORS.eigen}
                    stroke="white"
                    strokeWidth={0.5}
                  />
                  <text
                    x={tip.x + 8}
                    y={tip.y - 4}
                    fill={COLORS.eigen}
                    fontSize={9}
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    e{i + 1}
                  </text>
                </g>
              );
            })}

          {/* Origin dot */}
          <circle
            cx={originScreen.x}
            cy={originScreen.y}
            r={3}
            fill="#ffffff"
            stroke={COLORS.border}
            strokeWidth={1}
          />
        </svg>
      </div>
    </div>
  );
}

function arrowHead(
  from: { x: number; y: number },
  to: { x: number; y: number }
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return `${to.x},${to.y} ${to.x},${to.y} ${to.x},${to.y}`;

  const ux = dx / len;
  const uy = dy / len;
  const size = 8;

  const tip = to;
  const left = {
    x: to.x - ux * size + uy * size * 0.4,
    y: to.y - uy * size - ux * size * 0.4,
  };
  const right = {
    x: to.x - ux * size - uy * size * 0.4,
    y: to.y - uy * size + ux * size * 0.4,
  };

  return `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`;
}

function CompositionPanel({
  entries,
  resultMatrix,
}: {
  entries: CompositionEntry[];
  resultMatrix: Matrix2x2;
}) {
  return (
    <div
      className="rounded-xl p-3 space-y-2"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
    >
      <div className="flex items-center gap-2">
        <Layers size={12} style={{ color: COLORS.accent }} />
        <span className="text-xs font-semibold text-white">Composition Chain</span>
      </div>

      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[10px] font-mono" style={{ color: COLORS.muted }}>
            T{i + 1}: {entry.transform.type}
          </span>
          <span className="text-[10px] font-mono font-bold" style={{ color: "#e4e4e7" }}>
            [{formatNum(entry.matrix.a)}, {formatNum(entry.matrix.b)}; {formatNum(entry.matrix.c)},{" "}
            {formatNum(entry.matrix.d)}]
          </span>
        </div>
      ))}

      {entries.length > 1 && (
        <div className="pt-2 border-t" style={{ borderColor: COLORS.border }}>
          <span className="text-[10px] font-mono" style={{ color: COLORS.success }}>
            Result: [{formatNum(resultMatrix.a)}, {formatNum(resultMatrix.b)};{" "}
            {formatNum(resultMatrix.c)}, {formatNum(resultMatrix.d)}]
          </span>
        </div>
      )}
    </div>
  );
}

function VectorMultiplicationViz({
  matrix,
}: {
  matrix: Matrix2x2;
}) {
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Sigma size={12} style={{ color: COLORS.secondary }} />
        <span className="text-xs font-semibold text-white">Matrix x Vector</span>
      </div>

      <div className="flex items-center justify-center gap-1 text-[10px] font-mono">
        {/* Matrix */}
        <div className="flex flex-col items-center">
          <div className="flex gap-2 px-1.5 py-0.5 rounded" style={{ border: `1px solid ${COLORS.primary}40` }}>
            <div className="flex flex-col items-center">
              <span style={{ color: "#e4e4e7" }}>{formatNum(matrix.a)}</span>
              <span style={{ color: "#e4e4e7" }}>{formatNum(matrix.c)}</span>
            </div>
            <div className="flex flex-col items-center">
              <span style={{ color: "#e4e4e7" }}>{formatNum(matrix.b)}</span>
              <span style={{ color: "#e4e4e7" }}>{formatNum(matrix.d)}</span>
            </div>
          </div>
        </div>

        <span style={{ color: COLORS.muted }}>*</span>

        {/* Vector */}
        <div className="flex flex-col items-center px-1.5 py-0.5 rounded" style={{ border: `1px solid ${COLORS.accent}40` }}>
          <span style={{ color: COLORS.accent }}>x</span>
          <span style={{ color: COLORS.accent }}>y</span>
        </div>

        <span style={{ color: COLORS.muted }}>=</span>

        {/* Result */}
        <div className="flex flex-col items-center px-1.5 py-0.5 rounded" style={{ border: `1px solid ${COLORS.success}40` }}>
          <span style={{ color: COLORS.success }}>
            {formatNum(matrix.a)}x + {formatNum(matrix.b)}y
          </span>
          <span style={{ color: COLORS.success }}>
            {formatNum(matrix.c)}x + {formatNum(matrix.d)}y
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LinearAlgebraPage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [transform, setTransform] = useState<TransformState>({ ...DEFAULT_TRANSFORM });
  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey>("rotation-45");
  const [showMetrics, setShowMetrics] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [showEigen, setShowEigen] = useState(true);

  // ── Animation state ─────────────────────────────────────────────────────────
  const [animProgress, setAnimProgress] = useState(0);
  const [stepCount, setStepCount] = useState(0);
  const [compositionEntries, setCompositionEntries] = useState<CompositionEntry[]>([]);
  const [autoScenarioStep, setAutoScenarioStep] = useState(0);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // ── Derived data ────────────────────────────────────────────────────────────
  const currentMatrix = transformToMatrix(transform);

  // For composition, compute the combined matrix
  const scenario = SCENARIOS.find((s) => s.key === selectedScenario)!;
  const isComposition = scenario.transforms.length > 1;

  const effectiveMatrix = isComposition
    ? compositionEntries.reduce<Matrix2x2>(
        (acc, entry) => multiplyMatrices(entry.matrix, acc),
        { a: 1, b: 0, c: 0, d: 1 }
      )
    : currentMatrix;

  const det = determinant(effectiveMatrix);
  const eigenvalues = computeEigenvalues(effectiveMatrix);
  const eigenvectors = computeEigenvectors(effectiveMatrix);

  // ── Step forward ────────────────────────────────────────────────────────────
  const stepForward = useCallback(() => {
    const increment = 0.04;

    if (isComposition) {
      // For composition scenarios, animate each transform in sequence
      const totalTransforms = scenario.transforms.length;

      if (autoScenarioStep < totalTransforms) {
        if (animProgress < 1) {
          setAnimProgress((prev) => Math.min(prev + increment, 1));
          setStepCount((prev) => prev + 1);
          return true;
        }

        // Current transform done, move to next
        const currentT = scenario.transforms[autoScenarioStep];
        const matrix = transformToMatrix(currentT);
        setCompositionEntries((prev) => [...prev, { transform: currentT, matrix }]);
        setAutoScenarioStep((prev) => prev + 1);
        setAnimProgress(0);

        if (autoScenarioStep + 1 < totalTransforms) {
          setTransform(scenario.transforms[autoScenarioStep + 1]);
        }

        setStepCount((prev) => prev + 1);
        return true;
      }

      setIsComplete(true);
      setIsPlaying(false);
      return false;
    }

    // Single transform animation
    if (animProgress < 1) {
      setAnimProgress((prev) => Math.min(prev + increment, 1));
      setStepCount((prev) => prev + 1);
      return true;
    }

    setIsComplete(true);
    setIsPlaying(false);
    return false;
  }, [animProgress, isComposition, scenario, autoScenarioStep]);

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
    setAnimProgress(0);
    setStepCount(0);
    setIsComplete(false);
    setAutoScenarioStep(0);
    setCompositionEntries([]);
    const sc = SCENARIOS.find((s) => s.key === selectedScenario)!;
    setTransform({ ...sc.transforms[0] });
  }, [handlePause, selectedScenario]);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const handleScenarioChange = useCallback(
    (key: ScenarioKey) => {
      handlePause();
      setSelectedScenario(key);
      const sc = SCENARIOS.find((s) => s.key === key)!;
      setTransform({ ...sc.transforms[0] });
      setAnimProgress(0);
      setStepCount(0);
      setIsComplete(false);
      setAutoScenarioStep(0);
      setCompositionEntries([]);
    },
    [handlePause]
  );

  // When transform changes via controls, reset animation
  const handleTransformChange = useCallback((t: TransformState) => {
    setTransform(t);
    setAnimProgress(1); // Instantly show result for manual control
    setIsComplete(false);
  }, []);

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
                16.4
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Linear Algebra Visualizer
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Visualize 2D linear transformations interactively. See how matrices transform
              space by watching basis vectors, the unit square, and eigenvectors respond to
              rotations, scaling, shearing, and reflections.
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

            <div className="flex-1" />

            <button
              onClick={() => setShowEigen(!showEigen)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
              style={{
                background: showEigen ? `${COLORS.eigen}15` : "transparent",
                color: showEigen ? COLORS.eigen : COLORS.muted,
                border: showEigen ? `1px solid ${COLORS.eigen}30` : `1px solid ${COLORS.border}`,
              }}
            >
              Eigenvectors
            </button>
          </motion.div>

          {/* ── Main visualization area ─────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4"
          >
            {/* Coordinate Plane */}
            <div className="lg:col-span-2 relative">
              <CoordinatePlane
                currentMatrix={effectiveMatrix}
                animProgress={animProgress}
                targetMatrix={isComposition ? effectiveMatrix : currentMatrix}
                eigenvectors={eigenvectors}
                showEigen={showEigen}
              />

              {/* Legend overlay */}
              <div
                className="absolute bottom-4 left-4 flex flex-col gap-1 px-2.5 py-2 rounded-lg"
                style={{ background: "rgba(17,17,24,0.9)", border: `1px solid ${COLORS.border}` }}
              >
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-[2px]" style={{ backgroundColor: COLORS.iHat }} />
                  <span className="text-[9px] font-mono" style={{ color: COLORS.iHat }}>
                    i-hat (1,0)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-[2px]" style={{ backgroundColor: COLORS.jHat }} />
                  <span className="text-[9px] font-mono" style={{ color: COLORS.jHat }}>
                    j-hat (0,1)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-[2px] border-t border-dashed" style={{ borderColor: COLORS.originalShape }} />
                  <span className="text-[9px] font-mono" style={{ color: COLORS.originalShape }}>
                    Original
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-[2px]" style={{ backgroundColor: COLORS.transformedShape }} />
                  <span className="text-[9px] font-mono" style={{ color: COLORS.transformedShape }}>
                    Transformed
                  </span>
                </div>
                {showEigen && eigenvectors.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-[2px] border-t border-dashed" style={{ borderColor: COLORS.eigen }} />
                    <span className="text-[9px] font-mono" style={{ color: COLORS.eigen }}>
                      Eigenvector
                    </span>
                  </div>
                )}
              </div>

              {/* Metrics overlay */}
              <AnimatePresence>
                {showMetrics && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.2 }}
                    className="absolute top-4 right-4 flex flex-wrap gap-2"
                  >
                    <MetricBadge
                      icon={<Hash size={12} />}
                      label="Determinant"
                      value={formatNum(det)}
                      color={Math.abs(det) < 0.01 ? COLORS.danger : COLORS.primary}
                    />
                    <MetricBadge
                      icon={<RotateCw size={12} />}
                      label="Angle"
                      value={`${transform.angle.toFixed(0)}\u00b0`}
                      color={COLORS.accent}
                    />
                    <MetricBadge
                      icon={<Maximize2 size={12} />}
                      label="Scale"
                      value={`${Math.abs(det).toFixed(2)}x`}
                      color={COLORS.secondary}
                    />
                    <MetricBadge
                      icon={<Activity size={12} />}
                      label="Steps"
                      value={stepCount}
                      color={COLORS.success}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Side panel */}
            <div className="lg:col-span-1 space-y-3">
              <TransformControls transform={transform} onChange={handleTransformChange} />

              <MatrixDisplay
                matrix={effectiveMatrix}
                label="Transformation Matrix"
                color={COLORS.primary}
              />

              <VectorMultiplicationViz matrix={effectiveMatrix} />

              {isComposition && compositionEntries.length > 0 && (
                <CompositionPanel entries={compositionEntries} resultMatrix={effectiveMatrix} />
              )}

              {/* Eigenvalue display */}
              <div
                className="rounded-xl p-3"
                style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Minimize2 size={12} style={{ color: COLORS.eigen }} />
                  <span className="text-xs font-semibold text-white">Eigenvalues</span>
                </div>

                <div className="space-y-1.5 text-[10px] font-mono">
                  <div className="flex items-center gap-2">
                    <span style={{ color: COLORS.muted }}>lambda_1 =</span>
                    <span style={{ color: eigenvalues.l1.im === 0 ? COLORS.eigen : COLORS.accent }}>
                      {eigenvalues.l1.im === 0
                        ? formatNum(eigenvalues.l1.re)
                        : `${formatNum(eigenvalues.l1.re)} + ${formatNum(eigenvalues.l1.im)}i`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span style={{ color: COLORS.muted }}>lambda_2 =</span>
                    <span style={{ color: eigenvalues.l2.im === 0 ? COLORS.eigen : COLORS.accent }}>
                      {eigenvalues.l2.im === 0
                        ? formatNum(eigenvalues.l2.re)
                        : `${formatNum(eigenvalues.l2.re)} + ${formatNum(eigenvalues.l2.im)}i`}
                    </span>
                  </div>

                  {eigenvectors.length > 0 && (
                    <div className="pt-1.5 border-t mt-1.5" style={{ borderColor: COLORS.border }}>
                      <span className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.muted }}>
                        Eigenvectors
                      </span>
                      {eigenvectors.map((ev, i) => (
                        <div key={i} className="flex items-center gap-2 mt-1">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.eigen }} />
                          <span style={{ color: COLORS.eigen }}>
                            ({formatNum(ev.x)}, {formatNum(ev.y)})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {eigenvectors.length === 0 && eigenvalues.l1.im !== 0 && (
                    <div className="pt-1.5 border-t mt-1.5" style={{ borderColor: COLORS.border }}>
                      <span className="text-[9px]" style={{ color: COLORS.accent }}>
                        Complex eigenvalues: no real eigenvectors (rotation component)
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Determinant explanation */}
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
                    <span className="text-xs font-semibold text-white block mb-1">Determinant = {formatNum(det)}</span>
                    <span className="text-[10px] leading-relaxed" style={{ color: "#a1a1aa" }}>
                      {Math.abs(det) < 0.01
                        ? "The determinant is zero! The transformation collapses the plane to a line or point (singular matrix, not invertible)."
                        : det < 0
                        ? `The negative determinant (${formatNum(det)}) means the transformation reverses orientation. The area is scaled by |det| = ${formatNum(Math.abs(det))}.`
                        : `The determinant (${formatNum(det)}) represents how much the transformation scales area. The unit square's area goes from 1 to ${formatNum(Math.abs(det))}.`}
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
                    <span className="text-xs font-medium text-[#10b981]">Transform complete</span>
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
                Understanding Linear Transformations
              </span>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.secondary }}
                >
                  Core Idea
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#a1a1aa" }}>
                  A 2x2 matrix represents a linear transformation of 2D space. The columns of the
                  matrix tell you where the basis vectors i-hat (1,0) and j-hat (0,1) land after
                  the transformation. Every other point in space follows accordingly, maintaining
                  the grid lines parallel and evenly spaced.
                </p>
              </div>

              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.accent }}
                >
                  Transformations
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    {
                      name: "Rotation",
                      matrix: "[cos\u03b8, -sin\u03b8; sin\u03b8, cos\u03b8]",
                      desc: "Preserves lengths and angles. det = 1.",
                    },
                    {
                      name: "Scaling",
                      matrix: "[sx, 0; 0, sy]",
                      desc: "Stretches/compresses along axes. det = sx*sy.",
                    },
                    {
                      name: "Shear",
                      matrix: "[1, k; 0, 1]",
                      desc: "Slides along one axis. det = 1 (area preserved).",
                    },
                    {
                      name: "Reflection",
                      matrix: "[1, 0; 0, -1]",
                      desc: "Mirrors across an axis. det = -1 (flips orientation).",
                    },
                  ].map((t) => (
                    <div
                      key={t.name}
                      className="p-3 rounded-lg"
                      style={{ background: "rgba(30,30,46,0.3)", border: `1px solid ${COLORS.border}` }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-white">{t.name}</span>
                        <span className="text-[9px] font-mono" style={{ color: COLORS.primary }}>
                          {t.matrix}
                        </span>
                      </div>
                      <span className="text-[10px]" style={{ color: "#a1a1aa" }}>
                        {t.desc}
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
                      Eigenvectors are the special directions that do not change direction under a
                      transformation -- they only get scaled by their eigenvalue. For a rotation
                      matrix (except 0 and 180 degrees), eigenvalues are complex numbers, meaning
                      no direction remains unchanged. This is why pure rotations have no real
                      eigenvectors. Understanding eigenvalues is crucial for stability analysis
                      in dynamical systems, principal component analysis (PCA) in machine learning,
                      and Google&apos;s PageRank algorithm.
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-3"
                  style={{ color: COLORS.muted }}
                >
                  Key Properties
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b" style={{ borderColor: COLORS.border }}>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>
                          Property
                        </th>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>
                          Formula
                        </th>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>
                          Geometric Meaning
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        {
                          prop: "Determinant",
                          formula: "ad - bc",
                          meaning: "Area scaling factor; sign = orientation",
                        },
                        {
                          prop: "Trace",
                          formula: "a + d",
                          meaning: "Sum of eigenvalues",
                        },
                        {
                          prop: "Inverse",
                          formula: "(1/det)[d,-b;-c,a]",
                          meaning: "Undo the transformation",
                        },
                        {
                          prop: "Eigenvalues",
                          formula: "(tr +/- sqrt(tr^2-4det))/2",
                          meaning: "Scale factors along invariant directions",
                        },
                        {
                          prop: "Singular",
                          formula: "det = 0",
                          meaning: "Collapses dimension; not invertible",
                        },
                        {
                          prop: "Orthogonal",
                          formula: "M^T * M = I",
                          meaning: "Preserves lengths and angles",
                        },
                      ].map((row, idx) => (
                        <tr
                          key={idx}
                          className="border-b"
                          style={{ borderColor: `${COLORS.border}50` }}
                        >
                          <td className="px-3 py-2 font-mono font-semibold" style={{ color: "#e4e4e7" }}>
                            {row.prop}
                          </td>
                          <td className="px-3 py-2 font-mono" style={{ color: COLORS.secondary }}>
                            {row.formula}
                          </td>
                          <td className="px-3 py-2" style={{ color: "#a1a1aa" }}>
                            {row.meaning}
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
