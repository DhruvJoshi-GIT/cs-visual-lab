"use client";

import { Play, Pause, SkipForward, RotateCcw, Share2, BarChart3 } from "lucide-react";

interface ModuleControlsProps {
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  showMetrics?: boolean;
  onToggleMetrics?: () => void;
  children?: React.ReactNode;
}

export default function ModuleControls({
  isPlaying,
  onPlay,
  onPause,
  onStep,
  onReset,
  speed,
  onSpeedChange,
  showMetrics,
  onToggleMetrics,
  children,
}: ModuleControlsProps) {
  return (
    <div className="flex items-center gap-2 p-3 bg-[#111118] border border-[#1e1e2e] rounded-xl">
      {/* Play/Pause */}
      <button
        onClick={isPlaying ? onPause : onPlay}
        className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#6366f1] hover:bg-[#818cf8] text-white transition-all duration-200 hover:scale-105 active:scale-95"
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
      </button>

      {/* Step */}
      <button
        onClick={onStep}
        className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#a1a1aa] hover:text-white transition-all duration-200"
        title="Step Forward"
      >
        <SkipForward size={18} />
      </button>

      {/* Reset */}
      <button
        onClick={onReset}
        className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#a1a1aa] hover:text-white transition-all duration-200"
        title="Reset"
      >
        <RotateCcw size={18} />
      </button>

      {/* Divider */}
      <div className="w-px h-8 bg-[#1e1e2e] mx-1" />

      {/* Speed Control */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[#71717a] font-mono whitespace-nowrap">{speed.toFixed(1)}x</span>
        <input
          type="range"
          min={-1}
          max={3}
          step={0.1}
          value={Math.log2(speed)}
          onChange={(e) => onSpeedChange(Math.pow(2, parseFloat(e.target.value)))}
          className="w-20 h-1.5 accent-[#6366f1] bg-[#1e1e2e] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#6366f1]"
        />
      </div>

      {/* Divider */}
      <div className="w-px h-8 bg-[#1e1e2e] mx-1" />

      {/* Additional controls */}
      {children}

      {/* Metrics toggle */}
      {onToggleMetrics && (
        <button
          onClick={onToggleMetrics}
          className={`flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200 ${
            showMetrics
              ? "bg-[#6366f1]/20 text-[#6366f1]"
              : "bg-[#1e1e2e] text-[#71717a] hover:bg-[#2a2a3e] hover:text-white"
          }`}
          title="Toggle Metrics"
        >
          <BarChart3 size={18} />
        </button>
      )}

      {/* Share */}
      <button
        onClick={() => navigator.clipboard?.writeText(window.location.href)}
        className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#71717a] hover:text-white transition-all duration-200 ml-auto"
        title="Copy Link"
      >
        <Share2 size={16} />
      </button>
    </div>
  );
}
