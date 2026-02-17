"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

interface ModuleHeaderProps {
  moduleNumber: string;
  title: string;
  description: string;
  domain: string;
  domainColor: string;
  prerequisites?: { label: string; href: string }[];
  usedIn?: { label: string; href: string }[];
}

export default function ModuleHeader({
  moduleNumber,
  title,
  description,
  domain,
  domainColor,
  prerequisites = [],
  usedIn = [],
}: ModuleHeaderProps) {
  return (
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
            backgroundColor: `${domainColor}15`,
            color: domainColor,
            border: `1px solid ${domainColor}30`,
          }}
        >
          {moduleNumber}
        </span>
        <span className="text-xs text-[#71717a]">{domain}</span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
        {title}
      </h1>
      <p className="text-[#a1a1aa] text-base max-w-2xl">{description}</p>

      {(prerequisites.length > 0 || usedIn.length > 0) && (
        <div className="flex flex-wrap gap-4 pt-1">
          {prerequisites.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-[#71717a]">
              <span className="text-[#71717a]/60">Built on:</span>
              {prerequisites.map((p) => (
                <a
                  key={p.href}
                  href={p.href}
                  className="text-[#6366f1] hover:text-[#818cf8] transition-colors"
                >
                  {p.label}
                </a>
              ))}
            </div>
          )}
          {usedIn.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-[#71717a]">
              <span className="text-[#71717a]/60">Used in:</span>
              {usedIn.map((u) => (
                <a
                  key={u.href}
                  href={u.href}
                  className="text-[#06b6d4] hover:text-[#22d3ee] transition-colors flex items-center gap-1"
                >
                  {u.label} <ArrowRight size={10} />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
