"use client";

import Link from "next/link";
import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import {
  Cpu,
  Microchip,
  Monitor,
  GitBranch,
  Search,
  Database,
  Network,
  Globe,
  Shield,
  Zap,
  Brain,
  Code,
  Layers,
  Blocks,
  Palette,
  Calculator,
  ArrowRight,
  Github,
  ChevronRight,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import { domains } from "@/lib/domains";

const iconMap: Record<string, LucideIcon> = {
  Cpu,
  Microchip,
  Monitor,
  GitBranch,
  Search,
  Database,
  Network,
  Globe,
  Shield,
  Zap,
  Brain,
  Code,
  Layers,
  Blocks,
  Palette,
  Calculator,
};

const totalModules = domains.reduce((sum, d) => sum + d.modules.length, 0);
const liveModules = domains.reduce(
  (sum, d) => sum + d.modules.filter((m) => m.status === "available").length,
  0
);

export default function HomePage() {
  const domainsRef = useRef<HTMLDivElement>(null);

  const scrollToDomains = () => {
    domainsRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* ── Hero ── */}
      <section className="relative pt-14 overflow-hidden">
        {/* Background layers */}
        <div className="absolute inset-0 bg-grid opacity-60" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.08)_0%,transparent_70%)]" />
        <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-background to-transparent" />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20 sm:pt-32 sm:pb-28">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.25, 0.4, 0.25, 1] }}
            className="flex flex-col items-center text-center"
          >
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card/50 backdrop-blur-sm mb-8">
              <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <span className="text-xs font-medium text-muted-foreground">
                {liveModules} interactive modules live
              </span>
            </div>

            {/* Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] max-w-4xl">
              <span className="text-foreground">The Interactive Encyclopedia</span>
              <br />
              <span className="text-foreground">of </span>
              <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                Computer Science
              </span>
            </h1>

            {/* Subtitle */}
            <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl leading-relaxed">
              Explore 120+ interactive, animated visualizations covering the
              complete landscape of CS — from transistors to distributed systems.
            </p>

            {/* CTAs */}
            <div className="mt-10 flex flex-col sm:flex-row items-center gap-3">
              <button
                onClick={scrollToDomains}
                className="group flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-white text-sm font-medium transition-all duration-200 hover:bg-primary-hover hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98]"
              >
                Start Exploring
                <ArrowRight
                  size={16}
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                />
              </button>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2 px-6 py-3 rounded-xl border border-border text-muted-foreground text-sm font-medium transition-all duration-200 hover:border-border-hover hover:text-foreground hover:bg-card/50"
              >
                <Github size={16} />
                View on GitHub
              </a>
            </div>

            {/* Stats bar */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3, ease: [0.25, 0.4, 0.25, 1] }}
              className="mt-16 flex items-center gap-6 sm:gap-8 text-sm text-muted"
            >
              <div className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-primary" />
                <span className="font-mono">{domains.length} Domains</span>
              </div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-secondary" />
                <span className="font-mono">{totalModules} Modules</span>
              </div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-success" />
                <span className="font-mono">{liveModules} Live Now</span>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── Domain Cards ── */}
      <section ref={domainsRef} className="relative py-20 sm:py-28">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section header */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5 }}
            className="mb-14"
          >
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              All Domains
            </h2>
            <p className="mt-2 text-muted-foreground">
              {domains.length} domains spanning the entire CS curriculum.
            </p>
          </motion.div>

          {/* Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {domains.map((domain, index) => (
              <DomainCard key={domain.id} domain={domain} index={index} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted">
              CS Visual Lab — An open-source project
            </p>
            <p className="text-sm text-muted/60">
              Built for learners, by learners.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── Domain Card Component ── */

function DomainCard({
  domain,
  index,
}: {
  domain: (typeof domains)[number];
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });

  const Icon = iconMap[domain.icon];
  const availableModules = domain.modules.filter(
    (m) => m.status === "available"
  );
  const comingSoonModules = domain.modules.filter(
    (m) => m.status === "coming-soon"
  );

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      transition={{
        duration: 0.45,
        delay: (index % 2) * 0.1,
        ease: [0.25, 0.4, 0.25, 1],
      }}
    >
      <div className="group relative rounded-xl border border-border bg-card transition-all duration-300 hover:border-border-hover hover:bg-card-hover overflow-hidden">
        {/* Colored top accent */}
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{
            background: `linear-gradient(90deg, ${domain.color}40, ${domain.color}, ${domain.color}40)`,
          }}
        />

        {/* Subtle glow on hover */}
        <div
          className="absolute top-0 left-0 right-0 h-24 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: `radial-gradient(ellipse at top, ${domain.color}08, transparent)`,
          }}
        />

        <div className="relative p-5 sm:p-6">
          {/* Header row */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className="flex items-center justify-center w-9 h-9 rounded-lg"
                style={{ backgroundColor: `${domain.color}15` }}
              >
                {Icon && (
                  <Icon
                    size={18}
                    style={{ color: domain.color }}
                    strokeWidth={1.75}
                  />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-[11px] font-mono font-medium px-1.5 py-0.5 rounded"
                    style={{
                      color: domain.color,
                      backgroundColor: `${domain.color}12`,
                    }}
                  >
                    {String(domain.id).padStart(2, "0")}
                  </span>
                  <h3 className="text-[15px] font-semibold text-foreground leading-snug">
                    {domain.title}
                  </h3>
                </div>
                <p className="text-xs text-muted mt-0.5">{domain.subtitle}</p>
              </div>
            </div>

            {/* Module count badge */}
            <div className="flex items-center gap-1.5 text-xs text-muted shrink-0 mt-1">
              <BookOpen size={12} />
              <span className="font-mono">
                {availableModules.length}/{domain.modules.length}
              </span>
            </div>
          </div>

          {/* Module list */}
          <div className="space-y-1">
            {availableModules.map((mod) => (
              <Link
                key={mod.id}
                href={mod.href}
                className="group/link flex items-center gap-2 px-2.5 py-1.5 -mx-1 rounded-lg transition-colors duration-150 hover:bg-[#ffffff06]"
              >
                <div
                  className="w-1 h-1 rounded-full shrink-0"
                  style={{ backgroundColor: domain.color }}
                />
                <span className="text-sm text-muted-foreground group-hover/link:text-foreground transition-colors duration-150 truncate">
                  {mod.number} &middot; {mod.title}
                </span>
                <ChevronRight
                  size={12}
                  className="ml-auto shrink-0 text-muted/0 group-hover/link:text-muted transition-all duration-150"
                />
              </Link>
            ))}

            {comingSoonModules.length > 0 && (
              <div className="flex items-center gap-2 px-2.5 py-1.5 -mx-1">
                <div className="w-1 h-1 rounded-full bg-border shrink-0" />
                <span className="text-sm text-muted/50">
                  {comingSoonModules.length} more coming soon
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
