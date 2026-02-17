"use client";

import { motion, AnimatePresence } from "framer-motion";

interface Metric {
  label: string;
  value: string | number;
  color?: string;
  icon?: React.ReactNode;
}

interface MetricsPanelProps {
  metrics: Metric[];
  visible: boolean;
}

export default function MetricsPanel({ metrics, visible }: MetricsPanelProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex flex-wrap gap-3"
        >
          {metrics.map((metric, i) => (
            <div
              key={metric.label}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e]"
            >
              {metric.icon && (
                <span className="text-[#71717a]">{metric.icon}</span>
              )}
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                  {metric.label}
                </span>
                <span
                  className="text-sm font-mono font-semibold"
                  style={{ color: metric.color || "#e4e4e7" }}
                >
                  {metric.value}
                </span>
              </div>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
