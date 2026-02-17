"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Monitor,
  Info,
  Lightbulb,
  Hash,
  Activity,
  Layers,
  Grid3X3,
  Triangle,
  Palette,
  ChevronRight,
  Eye,
  Cpu,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Vec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface Color {
  r: number;
  g: number;
  b: number;
}

interface Vertex {
  position: Vec3;
  color: Color;
  clipPos?: Vec4;
  ndcPos?: Vec3;
  screenPos?: { x: number; y: number };
}

type PipelineStage =
  | "vertex-input"
  | "vertex-shader"
  | "clipping"
  | "projection"
  | "rasterization"
  | "fragment-shader"
  | "framebuffer";

type ScenarioKey = "single-triangle" | "vertex-transform" | "pixel-coverage" | "color-interpolation";

interface Scenario {
  key: ScenarioKey;
  label: string;
  description: string;
  vertices: Vertex[];
  cameraAngle: number;
}

interface PixelData {
  covered: boolean;
  color: Color;
  bary: { u: number; v: number; w: number } | null;
  fragmentProcessed: boolean;
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
  rose: "#f43f5e",
};

const GRID_SIZE = 20;

const PIPELINE_STAGES: { id: PipelineStage; label: string; short: string }[] = [
  { id: "vertex-input", label: "Vertex Input", short: "VIn" },
  { id: "vertex-shader", label: "Vertex Shader", short: "VS" },
  { id: "clipping", label: "Clipping", short: "Clip" },
  { id: "projection", label: "Projection", short: "Proj" },
  { id: "rasterization", label: "Rasterization", short: "Rast" },
  { id: "fragment-shader", label: "Fragment Shader", short: "FS" },
  { id: "framebuffer", label: "Framebuffer", short: "FB" },
];

const STAGE_INDEX: Record<PipelineStage, number> = {
  "vertex-input": 0,
  "vertex-shader": 1,
  clipping: 2,
  projection: 3,
  rasterization: 4,
  "fragment-shader": 5,
  framebuffer: 6,
};

const DEFAULT_VERTICES: Vertex[] = [
  { position: { x: 0, y: 1.2, z: 0 }, color: { r: 239, g: 68, b: 68 } },
  { position: { x: -1.0, y: -0.8, z: 0 }, color: { r: 34, g: 197, b: 94 } },
  { position: { x: 1.0, y: -0.8, z: 0 }, color: { r: 59, g: 130, b: 246 } },
];

const SCENARIOS: Scenario[] = [
  {
    key: "single-triangle",
    label: "Single Triangle",
    description: "A basic triangle through the full pipeline",
    vertices: DEFAULT_VERTICES,
    cameraAngle: 0,
  },
  {
    key: "vertex-transform",
    label: "Vertex Transform",
    description: "See how vertex positions are transformed",
    vertices: [
      { position: { x: -0.3, y: 1.4, z: 0.2 }, color: { r: 239, g: 68, b: 68 } },
      { position: { x: -1.2, y: -0.6, z: -0.3 }, color: { r: 34, g: 197, b: 94 } },
      { position: { x: 0.8, y: -0.9, z: 0.1 }, color: { r: 59, g: 130, b: 246 } },
    ],
    cameraAngle: 15,
  },
  {
    key: "pixel-coverage",
    label: "Pixel Coverage",
    description: "Focus on which pixels the triangle covers",
    vertices: [
      { position: { x: 0, y: 0.6, z: 0 }, color: { r: 245, g: 158, b: 11 } },
      { position: { x: -0.5, y: -0.5, z: 0 }, color: { r: 245, g: 158, b: 11 } },
      { position: { x: 0.5, y: -0.5, z: 0 }, color: { r: 245, g: 158, b: 11 } },
    ],
    cameraAngle: 0,
  },
  {
    key: "color-interpolation",
    label: "Color Interpolation",
    description: "Watch how vertex colors blend across the triangle",
    vertices: [
      { position: { x: 0, y: 1.0, z: 0 }, color: { r: 255, g: 0, b: 0 } },
      { position: { x: -0.9, y: -0.7, z: 0 }, color: { r: 0, g: 255, b: 0 } },
      { position: { x: 0.9, y: -0.7, z: 0 }, color: { r: 0, g: 0, b: 255 } },
    ],
    cameraAngle: 0,
  },
];

// ─── Simulation Helpers ───────────────────────────────────────────────────────

function mat4Multiply(a: number[], b: number[]): number[] {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) {
        r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
      }
    }
  }
  return r;
}

function mat4Vec4(m: number[], v: Vec4): Vec4 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z + m[3] * v.w,
    y: m[4] * v.x + m[5] * v.y + m[6] * v.z + m[7] * v.w,
    z: m[8] * v.x + m[9] * v.y + m[10] * v.z + m[11] * v.w,
    w: m[12] * v.x + m[13] * v.y + m[14] * v.z + m[15] * v.w,
  };
}

function buildModelMatrix(angleY: number): number[] {
  const c = Math.cos((angleY * Math.PI) / 180);
  const s = Math.sin((angleY * Math.PI) / 180);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}

function buildViewMatrix(): number[] {
  // Camera at (0, 0, 3) looking at origin
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -3, 0, 0, 0, 1];
}

function buildProjectionMatrix(): number[] {
  const fov = 60;
  const aspect = 1;
  const near = 0.1;
  const far = 100;
  const f = 1 / Math.tan((fov * Math.PI) / 360);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), (2 * far * near) / (near - far),
    0, 0, -1, 0,
  ];
}

function transformVertices(vertices: Vertex[], cameraAngle: number): Vertex[] {
  const model = buildModelMatrix(cameraAngle);
  const view = buildViewMatrix();
  const proj = buildProjectionMatrix();
  const mvp = mat4Multiply(proj, mat4Multiply(view, model));

  return vertices.map((v) => {
    const clipPos = mat4Vec4(mvp, { x: v.position.x, y: v.position.y, z: v.position.z, w: 1 });
    const ndcPos = {
      x: clipPos.x / clipPos.w,
      y: clipPos.y / clipPos.w,
      z: clipPos.z / clipPos.w,
    };
    const screenPos = {
      x: (ndcPos.x + 1) * 0.5 * GRID_SIZE,
      y: (1 - ndcPos.y) * 0.5 * GRID_SIZE,
    };
    return { ...v, clipPos, ndcPos, screenPos };
  });
}

function isInsideTriangle(
  px: number,
  py: number,
  v0: { x: number; y: number },
  v1: { x: number; y: number },
  v2: { x: number; y: number }
): { inside: boolean; u: number; v: number; w: number } {
  const denom = (v1.y - v2.y) * (v0.x - v2.x) + (v2.x - v1.x) * (v0.y - v2.y);
  if (Math.abs(denom) < 0.0001) return { inside: false, u: 0, v: 0, w: 0 };

  const u = ((v1.y - v2.y) * (px - v2.x) + (v2.x - v1.x) * (py - v2.y)) / denom;
  const v = ((v2.y - v0.y) * (px - v2.x) + (v0.x - v2.x) * (py - v2.y)) / denom;
  const w = 1 - u - v;

  return { inside: u >= -0.01 && v >= -0.01 && w >= -0.01, u, v, w };
}

function interpolateColor(c0: Color, c1: Color, c2: Color, u: number, v: number, w: number): Color {
  return {
    r: Math.round(Math.max(0, Math.min(255, c0.r * u + c1.r * v + c2.r * w))),
    g: Math.round(Math.max(0, Math.min(255, c0.g * u + c1.g * v + c2.g * w))),
    b: Math.round(Math.max(0, Math.min(255, c0.b * u + c1.b * v + c2.b * w))),
  };
}

function rasterizeTriangle(
  vertices: Vertex[]
): PixelData[][] {
  const grid: PixelData[][] = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({
      covered: false,
      color: { r: 0, g: 0, b: 0 },
      bary: null,
      fragmentProcessed: false,
    }))
  );

  if (!vertices[0].screenPos || !vertices[1].screenPos || !vertices[2].screenPos) return grid;

  const v0 = vertices[0].screenPos;
  const v1 = vertices[1].screenPos;
  const v2 = vertices[2].screenPos;

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const result = isInsideTriangle(cx, cy, v0, v1, v2);
      if (result.inside) {
        const color = interpolateColor(
          vertices[0].color,
          vertices[1].color,
          vertices[2].color,
          result.u,
          result.v,
          result.w
        );
        grid[y][x] = {
          covered: true,
          color,
          bary: { u: result.u, v: result.v, w: result.w },
          fragmentProcessed: false,
        };
      }
    }
  }

  return grid;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PipelineFlow({
  activeStage,
  completedStages,
}: {
  activeStage: PipelineStage;
  completedStages: Set<PipelineStage>;
}) {
  const activeIdx = STAGE_INDEX[activeStage];

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {PIPELINE_STAGES.map((stage, idx) => {
        const isActive = stage.id === activeStage;
        const isCompleted = completedStages.has(stage.id);
        const isPast = idx < activeIdx;

        return (
          <div key={stage.id} className="flex items-center">
            <motion.div
              animate={{
                scale: isActive ? 1.05 : 1,
                borderColor: isActive
                  ? COLORS.rose
                  : isCompleted || isPast
                  ? `${COLORS.success}60`
                  : `${COLORS.border}`,
                backgroundColor: isActive
                  ? `${COLORS.rose}18`
                  : isCompleted || isPast
                  ? `${COLORS.success}10`
                  : COLORS.card,
              }}
              transition={{ duration: 0.3 }}
              className="px-2.5 py-2 rounded-lg border text-center min-w-[72px] relative"
            >
              {isActive && (
                <motion.div
                  className="absolute inset-0 rounded-lg"
                  style={{
                    background: `${COLORS.rose}08`,
                    boxShadow: `0 0 16px ${COLORS.rose}25, inset 0 0 16px ${COLORS.rose}08`,
                  }}
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              )}
              <div
                className="text-[10px] font-mono font-bold relative z-10"
                style={{
                  color: isActive
                    ? COLORS.rose
                    : isCompleted || isPast
                    ? COLORS.success
                    : COLORS.muted,
                }}
              >
                {stage.short}
              </div>
              <div
                className="text-[8px] mt-0.5 relative z-10 whitespace-nowrap"
                style={{
                  color: isActive ? "#ffffff" : COLORS.muted,
                }}
              >
                {stage.label}
              </div>
            </motion.div>
            {idx < PIPELINE_STAGES.length - 1 && (
              <div className="flex items-center px-0.5">
                <ChevronRight
                  size={12}
                  style={{
                    color:
                      idx < activeIdx
                        ? COLORS.success
                        : idx === activeIdx
                        ? COLORS.rose
                        : `${COLORS.muted}40`,
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function VertexInfoPanel({
  vertices,
  stage,
  transformedVertices,
}: {
  vertices: Vertex[];
  stage: PipelineStage;
  transformedVertices: Vertex[];
}) {
  const stageIdx = STAGE_INDEX[stage];

  return (
    <div
      className="rounded-xl p-3 space-y-2"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Triangle size={12} style={{ color: COLORS.rose }} />
        <span className="text-xs font-semibold text-white">Vertex Data</span>
      </div>

      {vertices.map((v, i) => {
        const tv = transformedVertices[i];
        const labels = ["V0", "V1", "V2"];
        const colorStr = `rgb(${v.color.r},${v.color.g},${v.color.b})`;

        return (
          <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
            <div
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ backgroundColor: colorStr }}
            />
            <span className="text-white font-bold w-6">{labels[i]}</span>

            {stageIdx <= 0 && (
              <span style={{ color: COLORS.muted }}>
                ({v.position.x.toFixed(1)}, {v.position.y.toFixed(1)}, {v.position.z.toFixed(1)})
              </span>
            )}

            {stageIdx >= 1 && stageIdx <= 2 && tv.clipPos && (
              <span style={{ color: COLORS.secondary }}>
                clip: ({tv.clipPos.x.toFixed(2)}, {tv.clipPos.y.toFixed(2)}, {tv.clipPos.z.toFixed(2)}, {tv.clipPos.w.toFixed(2)})
              </span>
            )}

            {stageIdx === 3 && tv.ndcPos && (
              <span style={{ color: COLORS.accent }}>
                ndc: ({tv.ndcPos.x.toFixed(2)}, {tv.ndcPos.y.toFixed(2)})
              </span>
            )}

            {stageIdx >= 4 && tv.screenPos && (
              <span style={{ color: COLORS.success }}>
                px: ({tv.screenPos.x.toFixed(1)}, {tv.screenPos.y.toFixed(1)})
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PixelGrid({
  grid,
  stage,
  rasterProgress,
  fragmentProgress,
  transformedVertices,
}: {
  grid: PixelData[][];
  stage: PipelineStage;
  rasterProgress: number;
  fragmentProgress: number;
  transformedVertices: Vertex[];
}) {
  const stageIdx = STAGE_INDEX[stage];
  const showCoverage = stageIdx >= 4;
  const showColors = stageIdx >= 5;
  const showFinal = stageIdx >= 6;

  const cellSize = Math.floor(320 / GRID_SIZE);

  return (
    <div className="relative">
      <div
        className="grid gap-[1px] rounded-lg overflow-hidden mx-auto"
        style={{
          gridTemplateColumns: `repeat(${GRID_SIZE}, ${cellSize}px)`,
          background: "#0d0d14",
          width: `${GRID_SIZE * (cellSize + 1) - 1}px`,
        }}
      >
        {grid.map((row, y) =>
          row.map((pixel, x) => {
            const pixelIndex = y * GRID_SIZE + x;
            const isRasterized = showCoverage && pixel.covered && pixelIndex <= rasterProgress;
            const isFragmented = showColors && pixel.covered && pixelIndex <= fragmentProgress;
            const isFinal = showFinal && pixel.covered;

            let bgColor = "#111118";
            let borderStyle = "none";

            if (isFinal || isFragmented) {
              bgColor = `rgb(${pixel.color.r},${pixel.color.g},${pixel.color.b})`;
            } else if (isRasterized) {
              bgColor = `${COLORS.rose}40`;
              borderStyle = `1px solid ${COLORS.rose}50`;
            }

            return (
              <div
                key={`${x}-${y}`}
                style={{
                  width: `${cellSize}px`,
                  height: `${cellSize}px`,
                  backgroundColor: bgColor,
                  border: borderStyle,
                  transition: "background-color 0.15s, border 0.15s",
                }}
              />
            );
          })
        )}
      </div>

      {/* Triangle overlay for early stages */}
      {stageIdx >= 3 && stageIdx < 6 && transformedVertices[0].screenPos && (
        <svg
          className="absolute top-0 left-0 pointer-events-none"
          style={{
            width: `${GRID_SIZE * (cellSize + 1) - 1}px`,
            height: `${GRID_SIZE * (cellSize + 1) - 1}px`,
          }}
          viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
        >
          <polygon
            points={transformedVertices
              .map((v) => `${v.screenPos!.x},${v.screenPos!.y}`)
              .join(" ")}
            fill="none"
            stroke={COLORS.rose}
            strokeWidth={0.15}
            strokeDasharray="0.3,0.15"
            opacity={0.8}
          />
          {transformedVertices.map((v, i) => (
            <circle
              key={i}
              cx={v.screenPos!.x}
              cy={v.screenPos!.y}
              r={0.35}
              fill={`rgb(${v.color.r},${v.color.g},${v.color.b})`}
              stroke="white"
              strokeWidth={0.08}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

function StageDescription({ stage }: { stage: PipelineStage }) {
  const descriptions: Record<PipelineStage, { title: string; desc: string }> = {
    "vertex-input": {
      title: "Vertex Input",
      desc: "Raw vertex data is loaded from memory. Each vertex has a 3D position (x, y, z) and attributes like color. The GPU reads this data from vertex buffers.",
    },
    "vertex-shader": {
      title: "Vertex Shader",
      desc: "Each vertex is transformed by the Model-View-Projection matrix. This converts 3D world coordinates to clip space (4D homogeneous coordinates). The vertex shader runs once per vertex in parallel on the GPU.",
    },
    clipping: {
      title: "Clipping",
      desc: "Primitives are tested against the view frustum. Triangles fully outside are discarded. Triangles partially outside are clipped to produce new vertices at the frustum boundaries.",
    },
    projection: {
      title: "Perspective Projection",
      desc: "The perspective divide converts clip coordinates to NDC (Normalized Device Coordinates) by dividing x, y, z by w. Then viewport transform maps NDC to screen pixel coordinates.",
    },
    rasterization: {
      title: "Rasterization",
      desc: "The triangle is sampled against the pixel grid. For each pixel center, a coverage test determines if it falls inside the triangle using edge functions or barycentric coordinates.",
    },
    "fragment-shader": {
      title: "Fragment Shader",
      desc: "Each covered pixel becomes a fragment. The fragment shader interpolates vertex attributes (color, normals, UVs) using barycentric coordinates, producing the final per-pixel color.",
    },
    framebuffer: {
      title: "Framebuffer Output",
      desc: "Fragment colors are written to the framebuffer. Depth testing, blending, and stencil operations happen here. The result is the final image displayed on screen.",
    },
  };

  const info = descriptions[stage];

  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: `${COLORS.rose}08`,
        border: `1px solid ${COLORS.rose}20`,
      }}
    >
      <div className="flex items-start gap-2">
        <Cpu size={14} className="mt-0.5 flex-shrink-0" style={{ color: COLORS.rose }} />
        <div>
          <span className="text-xs font-semibold text-white block mb-1">{info.title}</span>
          <span className="text-[11px] leading-relaxed" style={{ color: "#a1a1aa" }}>
            {info.desc}
          </span>
        </div>
      </div>
    </div>
  );
}

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

function FramebufferPreview({ grid }: { grid: PixelData[][] }) {
  const cellSize = 6;
  return (
    <div
      className="rounded-lg overflow-hidden mx-auto"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${GRID_SIZE}, ${cellSize}px)`,
        gap: "0px",
        width: `${GRID_SIZE * cellSize}px`,
      }}
    >
      {grid.map((row, y) =>
        row.map((pixel, x) => (
          <div
            key={`fb-${x}-${y}`}
            style={{
              width: `${cellSize}px`,
              height: `${cellSize}px`,
              backgroundColor: pixel.covered
                ? `rgb(${pixel.color.r},${pixel.color.g},${pixel.color.b})`
                : "#0a0a0f",
            }}
          />
        ))
      )}
    </div>
  );
}

function ClippingVisualization({ transformedVertices }: { transformedVertices: Vertex[] }) {
  const size = 160;
  const padding = 20;
  const inner = size - padding * 2;

  return (
    <div
      className="rounded-xl p-3"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Eye size={12} style={{ color: COLORS.accent }} />
        <span className="text-xs font-semibold text-white">View Frustum (Top-Down)</span>
      </div>
      <svg width={size} height={size} className="mx-auto">
        {/* Frustum boundary */}
        <rect
          x={padding}
          y={padding}
          width={inner}
          height={inner}
          fill="none"
          stroke={COLORS.border}
          strokeWidth={1}
          strokeDasharray="4,2"
        />
        <text x={padding + 2} y={padding - 4} fill={COLORS.muted} fontSize={8} fontFamily="monospace">
          -1,1
        </text>
        <text x={padding + inner - 16} y={padding + inner + 10} fill={COLORS.muted} fontSize={8} fontFamily="monospace">
          1,-1
        </text>

        {/* Triangle in NDC space */}
        {transformedVertices[0].ndcPos && (
          <>
            <polygon
              points={transformedVertices
                .map((v) => {
                  const sx = padding + ((v.ndcPos!.x + 1) / 2) * inner;
                  const sy = padding + ((1 - v.ndcPos!.y) / 2) * inner;
                  return `${sx},${sy}`;
                })
                .join(" ")}
              fill={`${COLORS.rose}20`}
              stroke={COLORS.rose}
              strokeWidth={1.5}
            />
            {transformedVertices.map((v, i) => {
              const sx = padding + ((v.ndcPos!.x + 1) / 2) * inner;
              const sy = padding + ((1 - v.ndcPos!.y) / 2) * inner;
              return (
                <circle
                  key={i}
                  cx={sx}
                  cy={sy}
                  r={4}
                  fill={`rgb(${v.color.r},${v.color.g},${v.color.b})`}
                  stroke="white"
                  strokeWidth={0.5}
                />
              );
            })}
          </>
        )}

        {/* Labels */}
        <text x={size / 2} y={size - 2} fill={COLORS.muted} fontSize={8} fontFamily="monospace" textAnchor="middle">
          NDC Space
        </text>
      </svg>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RasterizationPage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [activeStage, setActiveStage] = useState<PipelineStage>("vertex-input");
  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey>("single-triangle");
  const [showMetrics, setShowMetrics] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  // ── Simulation state ────────────────────────────────────────────────────────
  const [completedStages, setCompletedStages] = useState<Set<PipelineStage>>(new Set());
  const [rasterProgress, setRasterProgress] = useState(-1);
  const [fragmentProgress, setFragmentProgress] = useState(-1);
  const [stepCount, setStepCount] = useState(0);
  const [subStep, setSubStep] = useState(0);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // ── Derived data ────────────────────────────────────────────────────────────
  const scenario = SCENARIOS.find((s) => s.key === selectedScenario)!;
  const transformedVertices = transformVertices(scenario.vertices, scenario.cameraAngle);
  const pixelGrid = rasterizeTriangle(transformedVertices);

  const coveredPixelCount = pixelGrid.flat().filter((p) => p.covered).length;
  const totalPixels = GRID_SIZE * GRID_SIZE;

  // ── Step forward ────────────────────────────────────────────────────────────
  const stepForward = useCallback(() => {
    const stageIdx = STAGE_INDEX[activeStage];

    // For rasterization stage, step through pixels
    if (activeStage === "rasterization") {
      const maxPixelIdx = totalPixels - 1;
      if (rasterProgress < maxPixelIdx) {
        // Advance by a chunk of pixels per step
        const chunkSize = Math.max(1, Math.floor(GRID_SIZE / 2));
        setRasterProgress((prev) => Math.min(prev + chunkSize, maxPixelIdx));
        setStepCount((prev) => prev + 1);
        return true;
      }
      // Rasterization complete, move to next stage
      setCompletedStages((prev) => new Set([...prev, "rasterization"]));
      setActiveStage("fragment-shader");
      setStepCount((prev) => prev + 1);
      return true;
    }

    // For fragment shader stage, step through fragments
    if (activeStage === "fragment-shader") {
      const maxPixelIdx = totalPixels - 1;
      if (fragmentProgress < maxPixelIdx) {
        const chunkSize = Math.max(1, Math.floor(GRID_SIZE / 2));
        setFragmentProgress((prev) => Math.min(prev + chunkSize, maxPixelIdx));
        setStepCount((prev) => prev + 1);
        return true;
      }
      // Fragment shader complete
      setCompletedStages((prev) => new Set([...prev, "fragment-shader"]));
      setActiveStage("framebuffer");
      setStepCount((prev) => prev + 1);
      return true;
    }

    // For framebuffer — complete
    if (activeStage === "framebuffer") {
      if (subStep === 0) {
        setSubStep(1);
        setCompletedStages((prev) => new Set([...prev, "framebuffer"]));
        setStepCount((prev) => prev + 1);
        return true;
      }
      setIsComplete(true);
      setIsPlaying(false);
      return false;
    }

    // For other stages, advance to next stage
    const nextStageId = PIPELINE_STAGES[stageIdx + 1]?.id;
    if (nextStageId) {
      setCompletedStages((prev) => new Set([...prev, activeStage]));
      setActiveStage(nextStageId);
      setStepCount((prev) => prev + 1);

      if (nextStageId === "rasterization") {
        setRasterProgress(-1);
      }
      if (nextStageId === "fragment-shader") {
        setFragmentProgress(-1);
      }
      if (nextStageId === "framebuffer") {
        setSubStep(0);
      }
      return true;
    }

    return false;
  }, [activeStage, rasterProgress, fragmentProgress, subStep, totalPixels]);

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

  // ── Play / Pause / Step / Reset ─────────────────────────────────────────────
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
    setActiveStage("vertex-input");
    setCompletedStages(new Set());
    setRasterProgress(-1);
    setFragmentProgress(-1);
    setStepCount(0);
    setSubStep(0);
    setIsComplete(false);
  }, [handlePause]);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  useEffect(() => {
    handleReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScenario]);

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
                  background: `${COLORS.rose}15`,
                  color: COLORS.rose,
                  border: `1px solid ${COLORS.rose}30`,
                }}
              >
                15.1
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Rasterization Pipeline
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Step through the graphics pipeline from vertex input to final pixel output.
              Watch how 3D triangles are transformed, clipped, and rasterized into colored
              pixels on a framebuffer grid.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium"
                style={{
                  background: `${COLORS.rose}10`,
                  color: COLORS.rose,
                  border: `1px solid ${COLORS.rose}20`,
                }}
              >
                <Monitor size={11} />
                Computer Graphics
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
                onClick={() => setSelectedScenario(s.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                style={{
                  background: selectedScenario === s.key ? `${COLORS.rose}15` : "transparent",
                  color: selectedScenario === s.key ? COLORS.rose : COLORS.muted,
                  border:
                    selectedScenario === s.key
                      ? `1px solid ${COLORS.rose}30`
                      : "1px solid transparent",
                }}
                title={s.description}
              >
                {s.label}
              </button>
            ))}
          </motion.div>

          {/* ── Pipeline flow ───────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: [0.23, 1, 0.32, 1] }}
            className="mb-4 p-3 rounded-xl"
            style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
          >
            <PipelineFlow activeStage={activeStage} completedStages={completedStages} />
          </motion.div>

          {/* ── Main visualization area ─────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4"
          >
            {/* Pixel Grid */}
            <div
              className="lg:col-span-2 rounded-2xl overflow-hidden relative"
              style={{
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
                boxShadow: `0 0 0 1px ${COLORS.rose}05, 0 20px 50px -12px rgba(0,0,0,0.5)`,
              }}
            >
              <div
                className="flex items-center justify-between px-5 py-3 border-b"
                style={{ borderColor: COLORS.border }}
              >
                <div className="flex items-center gap-2">
                  <Grid3X3 size={14} style={{ color: COLORS.rose }} />
                  <span className="text-sm font-semibold text-white">
                    Pixel Grid ({GRID_SIZE}x{GRID_SIZE})
                  </span>
                </div>
                <span className="text-xs font-mono" style={{ color: COLORS.muted }}>
                  Stage: {PIPELINE_STAGES[STAGE_INDEX[activeStage]].label}
                </span>
              </div>

              <div className="flex items-center justify-center p-6">
                <PixelGrid
                  grid={pixelGrid}
                  stage={activeStage}
                  rasterProgress={rasterProgress}
                  fragmentProgress={fragmentProgress}
                  transformedVertices={transformedVertices}
                />
              </div>

              {/* Pixel legend */}
              <div
                className="flex items-center justify-center gap-4 px-5 py-3 border-t"
                style={{ borderColor: COLORS.border }}
              >
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#111118" }} />
                  <span className="text-[10px]" style={{ color: COLORS.muted }}>Empty</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: `${COLORS.rose}40` }} />
                  <span className="text-[10px]" style={{ color: COLORS.muted }}>Covered</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ background: "linear-gradient(135deg, #ef4444, #22c55e, #3b82f6)" }} />
                  <span className="text-[10px]" style={{ color: COLORS.muted }}>Interpolated</span>
                </div>
              </div>

              {/* Metrics overlay */}
              <AnimatePresence>
                {showMetrics && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.2 }}
                    className="absolute top-14 right-3 flex flex-wrap gap-2"
                  >
                    <MetricBadge
                      icon={<Layers size={12} />}
                      label="Stage"
                      value={PIPELINE_STAGES[STAGE_INDEX[activeStage]].short}
                      color={COLORS.rose}
                    />
                    <MetricBadge
                      icon={<Triangle size={12} />}
                      label="Vertices"
                      value={3}
                      color={COLORS.primary}
                    />
                    <MetricBadge
                      icon={<Grid3X3 size={12} />}
                      label="Pixels Hit"
                      value={coveredPixelCount}
                      color={COLORS.success}
                    />
                    <MetricBadge
                      icon={<Activity size={12} />}
                      label="Steps"
                      value={stepCount}
                      color={COLORS.secondary}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Side panel */}
            <div className="lg:col-span-1 space-y-3">
              <VertexInfoPanel
                vertices={scenario.vertices}
                stage={activeStage}
                transformedVertices={transformedVertices}
              />

              {STAGE_INDEX[activeStage] >= 2 && STAGE_INDEX[activeStage] <= 3 && (
                <ClippingVisualization transformedVertices={transformedVertices} />
              )}

              {STAGE_INDEX[activeStage] >= 6 && (
                <div
                  className="rounded-xl p-3"
                  style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Monitor size={12} style={{ color: COLORS.success }} />
                    <span className="text-xs font-semibold text-white">Framebuffer Output</span>
                  </div>
                  <FramebufferPreview grid={pixelGrid} />
                  <div className="mt-2 text-center">
                    <span className="text-[10px] font-mono" style={{ color: COLORS.muted }}>
                      {coveredPixelCount} / {totalPixels} pixels ({((coveredPixelCount / totalPixels) * 100).toFixed(1)}%)
                    </span>
                  </div>
                </div>
              )}

              <StageDescription stage={activeStage} />

              {/* Color legend for vertices */}
              <div
                className="rounded-xl p-3"
                style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Palette size={12} style={{ color: COLORS.accent }} />
                  <span className="text-xs font-semibold text-white">Vertex Colors</span>
                </div>
                <div className="space-y-1.5">
                  {scenario.vertices.map((v, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div
                        className="w-4 h-4 rounded-sm"
                        style={{
                          backgroundColor: `rgb(${v.color.r},${v.color.g},${v.color.b})`,
                        }}
                      />
                      <span className="text-[10px] font-mono" style={{ color: COLORS.muted }}>
                        V{i}: rgb({v.color.r}, {v.color.g}, {v.color.b})
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Barycentric coordinate explanation */}
              {STAGE_INDEX[activeStage] >= 4 && (
                <div
                  className="rounded-xl p-3"
                  style={{
                    background: `${COLORS.primary}08`,
                    border: `1px solid ${COLORS.primary}20`,
                  }}
                >
                  <div className="flex items-start gap-2">
                    <Lightbulb size={14} className="mt-0.5 flex-shrink-0" style={{ color: COLORS.primary }} />
                    <div>
                      <span className="text-xs font-semibold text-white block mb-1">
                        Barycentric Coordinates
                      </span>
                      <span className="text-[10px] leading-relaxed" style={{ color: "#a1a1aa" }}>
                        Each pixel inside the triangle has barycentric coordinates (u, v, w) that
                        represent its relative position to the three vertices. These are used to
                        interpolate colors: pixel_color = u*C0 + v*C1 + w*C2. Values u+v+w = 1.
                      </span>
                    </div>
                  </div>
                </div>
              )}
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
                    <span className="text-xs font-medium text-[#10b981]">Pipeline complete</span>
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
              <Info size={14} style={{ color: COLORS.rose }} />
              <span className="text-sm font-semibold text-white">
                Understanding the Rasterization Pipeline
              </span>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.secondary }}
                >
                  How It Works
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#a1a1aa" }}>
                  The rasterization pipeline is the process by which 3D geometry is converted into 2D
                  pixels on your screen. Every frame in a real-time graphics application (games, UI)
                  goes through these stages. Modern GPUs execute this pipeline billions of times per
                  second, processing millions of triangles in parallel.
                </p>
              </div>

              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: COLORS.accent }}
                >
                  Pipeline Stages
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PIPELINE_STAGES.map((stage) => (
                    <div
                      key={stage.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg"
                      style={{
                        background:
                          stage.id === activeStage
                            ? `${COLORS.rose}10`
                            : "rgba(30,30,46,0.3)",
                        border: `1px solid ${
                          stage.id === activeStage ? `${COLORS.rose}30` : COLORS.border
                        }`,
                      }}
                    >
                      <Hash
                        size={10}
                        style={{
                          color: stage.id === activeStage ? COLORS.rose : COLORS.muted,
                        }}
                      />
                      <span
                        className="text-xs font-medium"
                        style={{
                          color: stage.id === activeStage ? COLORS.rose : "#a1a1aa",
                        }}
                      >
                        {stage.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div
                className="rounded-xl p-4"
                style={{
                  background: `${COLORS.rose}05`,
                  border: `1px solid ${COLORS.rose}15`,
                }}
              >
                <div className="flex items-start gap-2">
                  <Lightbulb size={16} className="mt-0.5 flex-shrink-0" style={{ color: COLORS.rose }} />
                  <div>
                    <span className="text-xs font-semibold text-white block mb-1">Key Insight</span>
                    <span className="text-xs leading-relaxed" style={{ color: "#a1a1aa" }}>
                      Rasterization is fundamentally different from ray tracing. While ray tracing
                      traces rays from the camera through each pixel into the scene, rasterization
                      projects each triangle onto the screen and fills in covered pixels. This
                      &quot;object-order&quot; approach is much faster for most scenes, which is why
                      real-time graphics (games) primarily use rasterization. Modern GPUs have
                      dedicated fixed-function hardware for the rasterization stage.
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-3"
                  style={{ color: COLORS.muted }}
                >
                  Stage Summary
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b" style={{ borderColor: COLORS.border }}>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>
                          Stage
                        </th>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>
                          Input
                        </th>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: COLORS.muted }}>
                          Output
                        </th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: COLORS.muted }}>
                          Programmable
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { stage: "Vertex Input", input: "Vertex buffers", output: "Raw vertices", prog: false },
                        { stage: "Vertex Shader", input: "3D positions", output: "Clip coordinates", prog: true },
                        { stage: "Clipping", input: "Clip coords", output: "Clipped primitives", prog: false },
                        { stage: "Projection", input: "Clip coords", output: "Screen coords", prog: false },
                        { stage: "Rasterization", input: "Screen triangles", output: "Fragments", prog: false },
                        { stage: "Fragment Shader", input: "Fragments", output: "Pixel colors", prog: true },
                        { stage: "Framebuffer", input: "Pixel colors", output: "Final image", prog: false },
                      ].map((row, idx) => (
                        <tr
                          key={idx}
                          className="border-b"
                          style={{ borderColor: `${COLORS.border}50` }}
                        >
                          <td className="px-3 py-2 font-mono font-semibold" style={{ color: "#e4e4e7" }}>
                            {row.stage}
                          </td>
                          <td className="px-3 py-2" style={{ color: "#a1a1aa" }}>
                            {row.input}
                          </td>
                          <td className="px-3 py-2" style={{ color: "#a1a1aa" }}>
                            {row.output}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span
                              style={{
                                color: row.prog ? COLORS.success : COLORS.muted,
                              }}
                            >
                              {row.prog ? "Yes" : "Fixed"}
                            </span>
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
