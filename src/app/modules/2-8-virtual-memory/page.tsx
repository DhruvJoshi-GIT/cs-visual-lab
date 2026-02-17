'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HardDrive,
  Info,
  Play,
  RotateCcw,
  ArrowRight,
  Zap,
  Layers,
  CheckCircle,
  XCircle,
  Clock,
  BarChart3,
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

// ──────────────────────────── Types ────────────────────────────

interface PageTableEntry {
  valid: boolean;
  frameNumber: number;
  accessed: boolean;
  dirty: boolean;
  lastUsed: number;
}

interface TLBEntry {
  valid: boolean;
  vpn: number;
  frameNumber: number;
  lastUsed: number;
}

interface AccessRecord {
  step: number;
  virtualAddress: number;
  vpn: number;
  offset: number;
  tlbHit: boolean;
  pageHit: boolean;
  physicalAddress: number;
  frameNumber: number;
  pageFault: boolean;
}

interface ScenarioPreset {
  label: string;
  desc: string;
  addresses: number[];
}

// ──────────────────────────── Constants ────────────────────────────

const DOMAIN_COLOR = '#8b5cf6';
const PAGE_SIZE_BITS = 8; // 256 bytes per page
const PAGE_SIZE = 1 << PAGE_SIZE_BITS;
const VIRTUAL_PAGES = 16;
const PHYSICAL_FRAMES = 8;
const TLB_SIZE = 4;

const SCENARIOS: Record<string, ScenarioPreset> = {
  sequential: {
    label: 'Sequential Access',
    desc: 'Sequential page access — good spatial locality',
    addresses: [0x000, 0x010, 0x020, 0x100, 0x110, 0x120, 0x200, 0x210, 0x300, 0x310, 0x400, 0x410, 0x000, 0x010, 0x100, 0x110],
  },
  locality: {
    label: 'Temporal Locality',
    desc: 'Repeated access to same pages — high TLB hit rate',
    addresses: [0x000, 0x100, 0x000, 0x100, 0x200, 0x000, 0x100, 0x200, 0x000, 0x100, 0x300, 0x000, 0x100, 0x200, 0x300, 0x000],
  },
  thrashing: {
    label: 'Page Thrashing',
    desc: 'Access more pages than frames — constant page faults',
    addresses: [0x000, 0x100, 0x200, 0x300, 0x400, 0x500, 0x600, 0x700, 0x800, 0x900, 0xA00, 0x000, 0x100, 0x200, 0x300, 0x400],
  },
  tlb_miss: {
    label: 'TLB Thrashing',
    desc: 'Access more pages than TLB entries — TLB misses but page hits',
    addresses: [0x000, 0x100, 0x200, 0x300, 0x400, 0x000, 0x100, 0x200, 0x300, 0x400, 0x500, 0x000, 0x100, 0x200, 0x300, 0x400],
  },
};

// ──────────────────────────── Component ────────────────────────────

export default function VirtualMemoryModule() {
  const [pageTable, setPageTable] = useState<PageTableEntry[]>(() =>
    Array.from({ length: VIRTUAL_PAGES }, () => ({
      valid: false, frameNumber: -1, accessed: false, dirty: false, lastUsed: -1,
    }))
  );
  const [tlb, setTlb] = useState<TLBEntry[]>(() =>
    Array.from({ length: TLB_SIZE }, () => ({ valid: false, vpn: -1, frameNumber: -1, lastUsed: -1 }))
  );
  const [nextFreeFrame, setNextFreeFrame] = useState(0);
  const [addresses, setAddresses] = useState<number[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [history, setHistory] = useState<AccessRecord[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [activeScenario, setActiveScenario] = useState('sequential');
  const [highlightedVPN, setHighlightedVPN] = useState<number | null>(null);
  const [highlightedFrame, setHighlightedFrame] = useState<number | null>(null);

  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const tlbHits = history.filter((h) => h.tlbHit).length;
  const pageFaults = history.filter((h) => h.pageFault).length;
  const tlbHitRate = history.length > 0 ? (tlbHits / history.length) * 100 : 0;
  const pageFaultRate = history.length > 0 ? (pageFaults / history.length) * 100 : 0;
  const simulationDone = currentStep >= addresses.length && addresses.length > 0;

  useEffect(() => {
    loadScenario('sequential');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadScenario = useCallback((key: string) => {
    setActiveScenario(key);
    setIsPlaying(false);
    setCurrentStep(0);
    setHistory([]);
    setHighlightedVPN(null);
    setHighlightedFrame(null);
    setNextFreeFrame(0);
    const scenario = SCENARIOS[key];
    if (scenario) setAddresses([...scenario.addresses]);
    setPageTable(Array.from({ length: VIRTUAL_PAGES }, () => ({
      valid: false, frameNumber: -1, accessed: false, dirty: false, lastUsed: -1,
    })));
    setTlb(Array.from({ length: TLB_SIZE }, () => ({ valid: false, vpn: -1, frameNumber: -1, lastUsed: -1 })));
  }, []);

  const stepForward = useCallback(() => {
    if (currentStep >= addresses.length) {
      setIsPlaying(false);
      return;
    }

    const va = addresses[currentStep];
    const vpn = (va >> PAGE_SIZE_BITS) & 0xF;
    const offset = va & (PAGE_SIZE - 1);

    setHighlightedVPN(vpn);

    // Check TLB
    const newTlb = tlb.map((e) => ({ ...e }));
    const newPT = pageTable.map((e) => ({ ...e }));
    let tlbHit = false;
    let pageFault = false;
    let frameNumber = -1;

    const tlbIdx = newTlb.findIndex((e) => e.valid && e.vpn === vpn);
    if (tlbIdx >= 0) {
      tlbHit = true;
      frameNumber = newTlb[tlbIdx].frameNumber;
      newTlb[tlbIdx].lastUsed = currentStep;
    } else {
      // TLB miss — check page table
      if (newPT[vpn].valid) {
        frameNumber = newPT[vpn].frameNumber;
      } else {
        // Page fault
        pageFault = true;
        let nff = nextFreeFrame;
        if (nff < PHYSICAL_FRAMES) {
          frameNumber = nff;
          setNextFreeFrame(nff + 1);
        } else {
          // Evict LRU page
          let lruVPN = -1;
          let lruTime = Infinity;
          for (let i = 0; i < VIRTUAL_PAGES; i++) {
            if (newPT[i].valid && newPT[i].lastUsed < lruTime) {
              lruTime = newPT[i].lastUsed;
              lruVPN = i;
            }
          }
          if (lruVPN >= 0) {
            frameNumber = newPT[lruVPN].frameNumber;
            newPT[lruVPN].valid = false;
            newPT[lruVPN].frameNumber = -1;
            // Invalidate TLB entry for evicted page
            const evictTlb = newTlb.findIndex((e) => e.valid && e.vpn === lruVPN);
            if (evictTlb >= 0) {
              newTlb[evictTlb].valid = false;
            }
          }
        }
        newPT[vpn].valid = true;
        newPT[vpn].frameNumber = frameNumber;
      }

      // Update TLB (LRU replacement)
      let tlbTarget = newTlb.findIndex((e) => !e.valid);
      if (tlbTarget < 0) {
        let minUsed = Infinity;
        tlbTarget = 0;
        for (let i = 0; i < TLB_SIZE; i++) {
          if (newTlb[i].lastUsed < minUsed) {
            minUsed = newTlb[i].lastUsed;
            tlbTarget = i;
          }
        }
      }
      newTlb[tlbTarget] = { valid: true, vpn, frameNumber, lastUsed: currentStep };
    }

    newPT[vpn].accessed = true;
    newPT[vpn].lastUsed = currentStep;

    const physicalAddress = (frameNumber << PAGE_SIZE_BITS) | offset;
    setHighlightedFrame(frameNumber);

    const record: AccessRecord = {
      step: currentStep,
      virtualAddress: va,
      vpn,
      offset,
      tlbHit,
      pageHit: !pageFault,
      physicalAddress,
      frameNumber,
      pageFault,
    };

    setTlb(newTlb);
    setPageTable(newPT);
    setHistory((prev) => [...prev, record]);
    setCurrentStep((s) => s + 1);
  }, [currentStep, addresses, tlb, pageTable, nextFreeFrame]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    loadScenario(activeScenario);
  }, [activeScenario, loadScenario]);

  // Animation loop
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(10, 800 / speedRef.current);
      if (timestamp - lastTickRef.current >= interval) {
        lastTickRef.current = timestamp;
        stepForward();
      }
      animationRef.current = requestAnimationFrame(animationLoop);
    },
    [stepForward]
  );

  useEffect(() => {
    if (isPlaying) {
      lastTickRef.current = performance.now();
      animationRef.current = requestAnimationFrame(animationLoop);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, animationLoop]);

  useEffect(() => {
    if (simulationDone) setIsPlaying(false);
  }, [simulationDone]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />
      <main className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-semibold"
                style={{ backgroundColor: `${DOMAIN_COLOR}15`, color: DOMAIN_COLOR, border: `1px solid ${DOMAIN_COLOR}30` }}>
                2.8
              </span>
              <span className="text-xs text-[#71717a]">CPU Architecture</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Virtual Memory & TLB{' '}
              <span className="text-[#71717a] font-normal">Simulator</span>
            </h1>
            <p className="text-sm text-[#a1a1aa] max-w-2xl mt-1">
              Visualize address translation from virtual to physical addresses through TLB lookup
              and page table walk. See page faults, TLB misses, and LRU replacement in action.
            </p>
          </div>

          {/* Scenarios */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs text-[#71717a] mr-1 font-medium uppercase tracking-wider">Scenarios:</span>
            {Object.entries(SCENARIOS).map(([key, scenario]) => (
              <button key={key} onClick={() => loadScenario(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 border ${
                  activeScenario === key
                    ? 'bg-[#8b5cf6]/15 text-[#8b5cf6] border-[#8b5cf6]/30'
                    : 'bg-[#111118] text-[#a1a1aa] border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white'
                }`} title={scenario.desc}>
                {scenario.label}
              </button>
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => isPlaying ? setIsPlaying(false) : setIsPlaying(true)}
              disabled={simulationDone}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8b5cf6] text-white text-sm font-medium hover:bg-[#7c3aed] disabled:opacity-40 transition-all">
              {isPlaying ? (
                <><div className="flex gap-0.5"><div className="w-1 h-3 bg-white rounded-sm" /><div className="w-1 h-3 bg-white rounded-sm" /></div> Pause</>
              ) : (
                <><Play size={14} fill="white" /> {simulationDone ? 'Done' : 'Play'}</>
              )}
            </button>
            <button onClick={stepForward} disabled={simulationDone}
              className="px-4 py-2 rounded-lg bg-[#111118] text-[#a1a1aa] text-sm border border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white disabled:opacity-40 transition-all">
              Step
            </button>
            <button onClick={handleReset}
              className="px-4 py-2 rounded-lg bg-[#111118] text-[#a1a1aa] text-sm border border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-white transition-all">
              <RotateCcw size={14} />
            </button>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px] text-[#71717a] uppercase tracking-wider">Speed</span>
              <input type="range" min={0.5} max={4} step={0.5} value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))} className="w-24 accent-[#8b5cf6]" />
              <span className="text-xs font-mono text-[#a1a1aa] w-8">{speed}x</span>
            </div>
          </div>

          {/* Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
            {[
              { label: 'Accesses', value: history.length.toString(), color: '#8b5cf6' },
              { label: 'TLB Hits', value: tlbHits.toString(), color: '#10b981' },
              { label: 'TLB Hit Rate', value: `${tlbHitRate.toFixed(0)}%`, color: '#06b6d4' },
              { label: 'Page Faults', value: pageFaults.toString(), color: '#ef4444' },
              { label: 'Fault Rate', value: `${pageFaultRate.toFixed(0)}%`, color: '#f59e0b' },
            ].map((m) => (
              <div key={m.label} className="p-3 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: m.color }}>{m.label}</div>
                <div className="text-xl font-bold font-mono text-white">{m.value}</div>
              </div>
            ))}
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
            <div className="space-y-6">
              {/* Address Translation Flow */}
              {history.length > 0 && (
                <motion.div
                  key={currentStep}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]"
                >
                  <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                    <Zap size={14} className="text-[#f59e0b]" />
                    Address Translation (Step {currentStep})
                  </h3>
                  {(() => {
                    const last = history[history.length - 1];
                    return (
                      <div className="flex flex-wrap items-center gap-3">
                        {/* Virtual Address */}
                        <div className="p-3 rounded-lg bg-[#8b5cf6]/10 border border-[#8b5cf6]/20">
                          <div className="text-[9px] text-[#8b5cf6] uppercase tracking-wider mb-1">Virtual Address</div>
                          <div className="text-lg font-mono font-bold text-[#8b5cf6]">0x{last.virtualAddress.toString(16).toUpperCase().padStart(3, '0')}</div>
                          <div className="text-[9px] text-[#71717a] mt-1">
                            VPN={last.vpn} | Offset={last.offset}
                          </div>
                        </div>

                        <ArrowRight size={20} className="text-[#71717a]" />

                        {/* TLB Check */}
                        <div className={`p-3 rounded-lg border ${
                          last.tlbHit
                            ? 'bg-[#10b981]/10 border-[#10b981]/20'
                            : 'bg-[#ef4444]/10 border-[#ef4444]/20'
                        }`}>
                          <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: last.tlbHit ? '#10b981' : '#ef4444' }}>
                            TLB {last.tlbHit ? 'HIT' : 'MISS'}
                          </div>
                          <div className="flex items-center gap-1">
                            {last.tlbHit ? <CheckCircle size={16} className="text-[#10b981]" /> : <XCircle size={16} className="text-[#ef4444]" />}
                          </div>
                        </div>

                        {!last.tlbHit && (
                          <>
                            <ArrowRight size={20} className="text-[#71717a]" />
                            <div className={`p-3 rounded-lg border ${
                              last.pageFault
                                ? 'bg-[#ef4444]/10 border-[#ef4444]/20'
                                : 'bg-[#f59e0b]/10 border-[#f59e0b]/20'
                            }`}>
                              <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: last.pageFault ? '#ef4444' : '#f59e0b' }}>
                                Page Table {last.pageFault ? 'FAULT' : 'HIT'}
                              </div>
                              {last.pageFault ? <XCircle size={16} className="text-[#ef4444]" /> : <CheckCircle size={16} className="text-[#f59e0b]" />}
                            </div>
                          </>
                        )}

                        <ArrowRight size={20} className="text-[#71717a]" />

                        {/* Physical Address */}
                        <div className="p-3 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20">
                          <div className="text-[9px] text-[#10b981] uppercase tracking-wider mb-1">Physical Address</div>
                          <div className="text-lg font-mono font-bold text-[#10b981]">0x{last.physicalAddress.toString(16).toUpperCase().padStart(3, '0')}</div>
                          <div className="text-[9px] text-[#71717a] mt-1">
                            Frame={last.frameNumber} | Offset={last.offset}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </motion.div>
              )}

              {/* TLB Table */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <Zap size={14} className="text-[#06b6d4]" />
                  Translation Lookaside Buffer ({TLB_SIZE} entries)
                </h3>
                <div className="grid grid-cols-4 gap-2">
                  {tlb.map((entry, idx) => (
                    <motion.div
                      key={idx}
                      animate={{
                        borderColor: entry.valid && entry.vpn === highlightedVPN ? '#06b6d4' : entry.valid ? '#1e1e2e' : '#1e1e2e',
                        backgroundColor: entry.valid && entry.vpn === highlightedVPN ? 'rgba(6,182,212,0.08)' : 'rgba(15,15,23,0.5)',
                      }}
                      className="p-3 rounded-lg border text-center"
                    >
                      <div className="text-[9px] text-[#71717a] mb-1">TLB [{idx}]</div>
                      {entry.valid ? (
                        <>
                          <div className="text-sm font-mono font-bold text-[#06b6d4]">VPN {entry.vpn}</div>
                          <ArrowRight size={10} className="mx-auto text-[#71717a] my-0.5" />
                          <div className="text-sm font-mono font-bold text-[#10b981]">Frame {entry.frameNumber}</div>
                        </>
                      ) : (
                        <div className="text-xs text-[#71717a]/40 font-mono py-2">empty</div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Page Table */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <Layers size={14} className="text-[#8b5cf6]" />
                  Page Table ({VIRTUAL_PAGES} entries)
                </h3>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                  {pageTable.map((entry, vpn) => (
                    <motion.div
                      key={vpn}
                      animate={{
                        borderColor: vpn === highlightedVPN ? '#8b5cf6' : entry.valid ? '#1e1e2e' : '#1e1e2e',
                        backgroundColor: vpn === highlightedVPN
                          ? 'rgba(139,92,246,0.08)'
                          : entry.valid
                          ? 'rgba(16,185,129,0.03)'
                          : 'rgba(15,15,23,0.5)',
                      }}
                      className="p-2 rounded-lg border text-center"
                    >
                      <div className="text-[9px] text-[#71717a]">VPN {vpn}</div>
                      {entry.valid ? (
                        <div className="text-xs font-mono font-bold text-[#10b981] mt-1">
                          F{entry.frameNumber}
                        </div>
                      ) : (
                        <div className="text-[10px] text-[#71717a]/30 mt-1">-</div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Physical Memory (Frames) */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-xs uppercase tracking-wider text-[#71717a] font-semibold mb-4 flex items-center gap-2">
                  <HardDrive size={14} className="text-[#10b981]" />
                  Physical Frames ({PHYSICAL_FRAMES})
                </h3>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                  {Array.from({ length: PHYSICAL_FRAMES }, (_, frame) => {
                    const mappedVPN = pageTable.findIndex((pt) => pt.valid && pt.frameNumber === frame);
                    const isHighlighted = frame === highlightedFrame;

                    return (
                      <motion.div
                        key={frame}
                        animate={{
                          borderColor: isHighlighted ? '#10b981' : '#1e1e2e',
                          backgroundColor: isHighlighted ? 'rgba(16,185,129,0.08)' : mappedVPN >= 0 ? 'rgba(16,185,129,0.03)' : 'rgba(15,15,23,0.5)',
                        }}
                        className="p-2 rounded-lg border text-center"
                      >
                        <div className="text-[9px] text-[#71717a]">Frame {frame}</div>
                        {mappedVPN >= 0 ? (
                          <div className="text-xs font-mono font-bold text-[#10b981] mt-1">
                            VP{mappedVPN}
                          </div>
                        ) : (
                          <div className="text-[10px] text-[#71717a]/30 mt-1">free</div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right Sidebar */}
            <div className="space-y-4">
              {/* Address Sequence */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <BarChart3 size={14} className="text-[#8b5cf6]" />
                  Address Sequence
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {addresses.map((addr, i) => {
                    const isPast = i < currentStep;
                    const isCurrent = i === currentStep;
                    const record = history[i];

                    return (
                      <motion.div key={i}
                        className={`px-2 py-1 rounded text-[10px] font-mono border transition-all ${
                          isCurrent ? 'border-[#8b5cf6] bg-[#8b5cf6]/20 text-[#8b5cf6] font-bold'
                          : isPast
                            ? record?.tlbHit
                              ? 'border-[#10b981]/30 bg-[#10b981]/10 text-[#10b981]'
                              : record?.pageFault
                              ? 'border-[#ef4444]/30 bg-[#ef4444]/10 text-[#ef4444]'
                              : 'border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[#f59e0b]'
                            : 'border-[#1e1e2e] text-[#71717a]'
                        }`}
                        title={`0x${addr.toString(16).toUpperCase()} (VPN ${(addr >> PAGE_SIZE_BITS) & 0xF})`}
                      >
                        0x{addr.toString(16).toUpperCase().padStart(3, '0')}
                      </motion.div>
                    );
                  })}
                </div>
                <div className="flex gap-3 mt-3 text-[9px] text-[#71717a]">
                  <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-[#10b981]/30" /> TLB Hit</span>
                  <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-[#f59e0b]/30" /> PT Hit</span>
                  <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-[#ef4444]/30" /> Page Fault</span>
                </div>
              </div>

              {/* Access Log */}
              <div className="p-4 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3 flex items-center gap-2">
                  <Clock size={14} className="text-[#06b6d4]" />
                  Access Log
                </h3>
                <div className="max-h-[250px] overflow-y-auto space-y-1">
                  {history.length === 0 ? (
                    <p className="text-xs text-[#71717a] italic">No accesses yet.</p>
                  ) : (
                    [...history].reverse().slice(0, 20).map((r) => (
                      <div key={r.step} className="flex items-center gap-2 text-[10px] font-mono">
                        <span className="text-[#71717a] w-6">#{r.step + 1}</span>
                        <span className="text-[#8b5cf6]">0x{r.virtualAddress.toString(16).toUpperCase().padStart(3, '0')}</span>
                        <ArrowRight size={8} className="text-[#71717a]" />
                        <span className="text-[#10b981]">0x{r.physicalAddress.toString(16).toUpperCase().padStart(3, '0')}</span>
                        <span className={`ml-auto font-bold ${
                          r.tlbHit ? 'text-[#10b981]' : r.pageFault ? 'text-[#ef4444]' : 'text-[#f59e0b]'
                        }`}>
                          {r.tlbHit ? 'TLB' : r.pageFault ? 'FAULT' : 'PT'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Info */}
              <div className="p-4 rounded-xl bg-[#0f0f17] border border-[#1e1e2e]/50">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-[#8b5cf6] mt-0.5 shrink-0" />
                  <div className="text-[11px] text-[#71717a] leading-relaxed">
                    <p className="mb-1.5">
                      <strong className="text-[#10b981]">TLB Hit:</strong> Fastest — address translated directly from TLB cache.
                    </p>
                    <p className="mb-1.5">
                      <strong className="text-[#f59e0b]">Page Table Hit:</strong> TLB miss but page is in memory — walk the page table.
                    </p>
                    <p>
                      <strong className="text-[#ef4444]">Page Fault:</strong> Page not in memory — must load from disk (expensive!).
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Completion */}
          <AnimatePresence>
            {simulationDone && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-4 rounded-xl bg-[#10b981]/10 border border-[#10b981]/20 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-[#10b981]" />
                <span className="text-sm text-[#10b981] font-medium">
                  Complete &mdash; TLB hit rate: {tlbHitRate.toFixed(0)}%, Page faults: {pageFaults}/{history.length}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
