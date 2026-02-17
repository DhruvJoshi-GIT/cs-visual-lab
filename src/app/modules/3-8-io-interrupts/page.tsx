'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, RotateCcw, Cpu, HardDrive, ChevronRight, Zap,
  ArrowRight, Info, Monitor
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

// Types
interface InterruptEvent {
  id: number;
  type: 'keyboard' | 'disk' | 'timer' | 'network';
  label: string;
  priority: number;
  vector: number;
  handler: string;
  description: string;
}

interface CpuState {
  mode: 'user' | 'kernel';
  currentProcess: string;
  pc: number;
  savedState: { pc: number; process: string } | null;
  handlingInterrupt: InterruptEvent | null;
  dmaActive: boolean;
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  events: InterruptEvent[];
  useDMA: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'basic-interrupt',
    name: 'Basic Interrupt Flow',
    description: 'A keyboard interrupt arrives while CPU executes user code. Watch the full interrupt dispatch cycle.',
    useDMA: false,
    events: [
      { id: 1, type: 'keyboard', label: 'Keyboard IRQ', priority: 2, vector: 0x21, handler: 'kbd_handler()', description: 'Key press detected' },
      { id: 2, type: 'timer', label: 'Timer IRQ', priority: 0, vector: 0x20, handler: 'timer_handler()', description: 'Scheduler tick (10ms)' },
    ],
  },
  {
    id: 'nested',
    name: 'Nested Interrupts',
    description: 'Higher-priority interrupt arrives during a lower-priority handler.',
    useDMA: false,
    events: [
      { id: 1, type: 'disk', label: 'Disk IRQ', priority: 3, vector: 0x2E, handler: 'disk_handler()', description: 'Disk read complete' },
      { id: 2, type: 'timer', label: 'Timer IRQ', priority: 0, vector: 0x20, handler: 'timer_handler()', description: 'High-priority timer tick' },
      { id: 3, type: 'keyboard', label: 'Keyboard IRQ', priority: 2, vector: 0x21, handler: 'kbd_handler()', description: 'Key press event' },
    ],
  },
  {
    id: 'dma-transfer',
    name: 'DMA Transfer',
    description: 'DMA controller transfers disk data to memory, bypassing the CPU. CPU gets interrupt only when done.',
    useDMA: true,
    events: [
      { id: 1, type: 'disk', label: 'DMA Start', priority: 3, vector: 0x2E, handler: 'dma_complete()', description: 'DMA disk→memory transfer' },
      { id: 2, type: 'keyboard', label: 'Keyboard IRQ', priority: 2, vector: 0x21, handler: 'kbd_handler()', description: 'Key press during DMA' },
    ],
  },
  {
    id: 'polling-vs-interrupt',
    name: 'Polling vs Interrupt',
    description: 'Compare polling (CPU checks device repeatedly) vs interrupt-driven I/O.',
    useDMA: false,
    events: [
      { id: 1, type: 'disk', label: 'Disk I/O', priority: 3, vector: 0x2E, handler: 'disk_handler()', description: 'Disk read with interrupt' },
      { id: 2, type: 'network', label: 'Network Packet', priority: 1, vector: 0x2B, handler: 'net_handler()', description: 'Incoming network packet' },
    ],
  },
];

const DEVICE_COLORS: Record<string, string> = {
  keyboard: '#06b6d4',
  disk: '#8b5cf6',
  timer: '#f59e0b',
  network: '#10b981',
};

const DEVICE_ICONS: Record<string, string> = {
  keyboard: '⌨️',
  disk: '💾',
  timer: '⏱️',
  network: '🌐',
};

interface StepInfo {
  phase: string;
  description: string;
  cpuMode: 'user' | 'kernel';
  activeDevice: string | null;
  dmaProgress: number;
  handlingEvent: InterruptEvent | null;
  idtLookup: boolean;
  stackPush: boolean;
  stackPop: boolean;
}

function generateSteps(scenario: Scenario): StepInfo[] {
  const steps: StepInfo[] = [
    { phase: 'Running User Code', description: 'CPU executing user process instructions', cpuMode: 'user', activeDevice: null, dmaProgress: 0, handlingEvent: null, idtLookup: false, stackPush: false, stackPop: false },
  ];

  if (scenario.useDMA) {
    steps.push(
      { phase: 'DMA Request', description: 'CPU programs DMA controller with source, destination, and byte count', cpuMode: 'kernel', activeDevice: 'disk', dmaProgress: 0, handlingEvent: null, idtLookup: false, stackPush: false, stackPop: false },
      { phase: 'DMA Transfer (25%)', description: 'DMA controller transfers data directly from disk to memory — CPU is free', cpuMode: 'user', activeDevice: 'disk', dmaProgress: 25, handlingEvent: null, idtLookup: false, stackPush: false, stackPop: false },
      { phase: 'DMA Transfer (50%)', description: 'Transfer continues. CPU executes other instructions in parallel', cpuMode: 'user', activeDevice: 'disk', dmaProgress: 50, handlingEvent: null, idtLookup: false, stackPush: false, stackPop: false },
      { phase: 'DMA Transfer (75%)', description: 'Nearly done. No CPU involvement needed for the data transfer', cpuMode: 'user', activeDevice: 'disk', dmaProgress: 75, handlingEvent: null, idtLookup: false, stackPush: false, stackPop: false },
      { phase: 'DMA Complete → IRQ', description: 'DMA controller raises interrupt to signal transfer is complete', cpuMode: 'user', activeDevice: 'disk', dmaProgress: 100, handlingEvent: scenario.events[0], idtLookup: false, stackPush: false, stackPop: false },
    );
  }

  for (const event of scenario.events) {
    if (scenario.useDMA && event.id === 1) continue; // DMA already handled
    steps.push(
      { phase: `${event.label} Raised`, description: `Device signals interrupt: ${event.description}`, cpuMode: 'user', activeDevice: event.type, dmaProgress: scenario.useDMA ? 100 : 0, handlingEvent: event, idtLookup: false, stackPush: false, stackPop: false },
      { phase: 'Save CPU State', description: 'Push PC, flags, and registers onto kernel stack', cpuMode: 'kernel', activeDevice: event.type, dmaProgress: scenario.useDMA ? 100 : 0, handlingEvent: event, idtLookup: false, stackPush: true, stackPop: false },
      { phase: 'IDT Lookup', description: `Look up vector 0x${event.vector.toString(16).toUpperCase()} in Interrupt Descriptor Table`, cpuMode: 'kernel', activeDevice: event.type, dmaProgress: scenario.useDMA ? 100 : 0, handlingEvent: event, idtLookup: true, stackPush: false, stackPop: false },
      { phase: `Execute ${event.handler}`, description: `Running interrupt service routine for ${event.type}`, cpuMode: 'kernel', activeDevice: event.type, dmaProgress: scenario.useDMA ? 100 : 0, handlingEvent: event, idtLookup: false, stackPush: false, stackPop: false },
      { phase: 'Restore State (IRET)', description: 'Pop saved state from stack, return to user mode', cpuMode: 'kernel', activeDevice: event.type, dmaProgress: scenario.useDMA ? 100 : 0, handlingEvent: event, idtLookup: false, stackPush: false, stackPop: true },
      { phase: 'Resume User Code', description: 'CPU resumes user process from saved PC', cpuMode: 'user', activeDevice: null, dmaProgress: scenario.useDMA ? 100 : 0, handlingEvent: null, idtLookup: false, stackPush: false, stackPop: false },
    );
  }

  return steps;
}

export default function IOInterruptsPage() {
  const [scenario, setScenario] = useState<Scenario>(SCENARIOS[0]);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [steps, setSteps] = useState<StepInfo[]>(() => generateSteps(SCENARIOS[0]));
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setSteps(generateSteps(scenario));
    setCurrentStep(0);
    setIsPlaying(false);
  }, [scenario]);

  useEffect(() => {
    if (isPlaying && currentStep < steps.length - 1) {
      timerRef.current = setTimeout(() => {
        setCurrentStep(s => s + 1);
      }, 1200 / speed);
    } else if (currentStep >= steps.length - 1) {
      setIsPlaying(false);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, currentStep, speed, steps.length]);

  const handlePlayPause = () => {
    if (currentStep >= steps.length - 1) {
      setCurrentStep(0);
      setTimeout(() => setIsPlaying(true), 50);
      return;
    }
    setIsPlaying(!isPlaying);
  };

  const step = steps[currentStep] || steps[0];

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">I/O & Interrupts</h1>
              <p className="text-sm text-gray-400">Module 3.8 — Interrupt handling, DMA transfers, device driver model</p>
            </div>
          </div>
        </div>

        {/* Scenario Selector */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {SCENARIOS.map(sc => (
            <button
              key={sc.id}
              onClick={() => setScenario(sc)}
              className={`p-3 rounded-lg border text-left transition-all ${
                scenario.id === sc.id
                  ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-400'
                  : 'bg-[#111118] border-[#1e1e2e] text-gray-400 hover:border-cyan-500/30'
              }`}
            >
              <div className="text-sm font-medium">{sc.name}</div>
              <div className="text-xs mt-1 opacity-70">{sc.description.slice(0, 50)}...</div>
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <button onClick={handlePlayPause}
            className="w-10 h-10 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center hover:bg-cyan-500/30">
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={() => { setIsPlaying(false); if (currentStep < steps.length - 1) setCurrentStep(s => s + 1); }}
            className="px-3 py-2 rounded-lg bg-[#1e1e2e] text-gray-300 text-sm hover:text-white flex items-center gap-1">
            <ChevronRight className="w-4 h-4" /> Step
          </button>
          <button onClick={() => { setIsPlaying(false); setCurrentStep(0); }}
            className="px-3 py-2 rounded-lg bg-[#1e1e2e] text-gray-300 text-sm hover:text-white flex items-center gap-1">
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-gray-500">Speed:</span>
            {[0.5, 1, 2].map(s => (
              <button key={s} onClick={() => setSpeed(s)}
                className={`px-2 py-1 rounded text-xs ${speed === s ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}>
                {s}x
              </button>
            ))}
          </div>
          <div className="text-xs text-gray-500">
            Step {currentStep + 1} / {steps.length}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Visualization */}
          <div className="lg:col-span-2 space-y-4">
            {/* Current Phase Banner */}
            <motion.div
              key={step.phase}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`p-4 rounded-lg border ${
                step.cpuMode === 'kernel'
                  ? 'bg-red-500/10 border-red-500/30'
                  : 'bg-green-500/10 border-green-500/30'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`px-2 py-0.5 rounded text-xs font-bold ${
                  step.cpuMode === 'kernel' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                }`}>
                  {step.cpuMode.toUpperCase()} MODE
                </div>
                <span className="text-white font-medium">{step.phase}</span>
              </div>
              <p className="text-sm text-gray-400 mt-1">{step.description}</p>
            </motion.div>

            {/* Hardware Diagram */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-6">
              <div className="flex items-start justify-between gap-8">
                {/* CPU */}
                <div className="flex-1">
                  <div className={`rounded-lg p-4 border-2 transition-colors ${
                    step.cpuMode === 'kernel'
                      ? 'border-red-500/50 bg-red-500/5'
                      : 'border-green-500/50 bg-green-500/5'
                  }`}>
                    <div className="flex items-center gap-2 mb-3">
                      <Cpu className="w-5 h-5 text-cyan-400" />
                      <span className="text-sm font-medium text-white">CPU</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        step.cpuMode === 'kernel' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                      }`}>{step.cpuMode}</span>
                    </div>

                    {/* Registers */}
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="bg-[#0a0a0f] rounded p-1.5">
                        <span className="text-gray-500">PC: </span>
                        <span className="text-cyan-400">0x{(0x4000 + currentStep * 4).toString(16)}</span>
                      </div>
                      <div className="bg-[#0a0a0f] rounded p-1.5">
                        <span className="text-gray-500">SP: </span>
                        <span className="text-cyan-400">0x{(step.stackPush ? 0x7FF0 : 0x8000).toString(16)}</span>
                      </div>
                      <div className="bg-[#0a0a0f] rounded p-1.5">
                        <span className="text-gray-500">IF: </span>
                        <span className={step.cpuMode === 'kernel' ? 'text-red-400' : 'text-green-400'}>
                          {step.cpuMode === 'kernel' ? '0 (disabled)' : '1 (enabled)'}
                        </span>
                      </div>
                      <div className="bg-[#0a0a0f] rounded p-1.5">
                        <span className="text-gray-500">CPL: </span>
                        <span className="text-yellow-400">{step.cpuMode === 'kernel' ? '0 (ring 0)' : '3 (ring 3)'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Kernel Stack */}
                  <div className="mt-4 rounded-lg p-3 bg-[#0a0a0f] border border-[#1e1e2e]">
                    <div className="text-xs text-gray-500 mb-2">Kernel Stack</div>
                    <AnimatePresence>
                      {step.stackPush && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="space-y-1"
                        >
                          {['FLAGS', 'CS', 'RIP', 'ErrorCode'].map((reg, i) => (
                            <motion.div
                              key={reg}
                              initial={{ x: -20, opacity: 0 }}
                              animate={{ x: 0, opacity: 1 }}
                              transition={{ delay: i * 0.1 }}
                              className="bg-yellow-500/10 border border-yellow-500/30 rounded px-2 py-0.5 text-xs text-yellow-400 font-mono"
                            >
                              {reg}
                            </motion.div>
                          ))}
                        </motion.div>
                      )}
                      {step.stackPop && (
                        <motion.div
                          initial={{ opacity: 1 }}
                          animate={{ opacity: 0.3 }}
                          className="text-xs text-gray-600 font-mono"
                        >
                          (restoring saved state...)
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {!step.stackPush && !step.stackPop && (
                      <div className="text-xs text-gray-600 font-mono">(empty)</div>
                    )}
                  </div>
                </div>

                {/* Interrupt Flow Arrow */}
                <div className="flex flex-col items-center gap-2 pt-8">
                  {step.handlingEvent && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center"
                    >
                      <div className="text-2xl">{DEVICE_ICONS[step.handlingEvent.type]}</div>
                      <motion.div
                        animate={{ y: [0, 5, 0] }}
                        transition={{ repeat: Infinity, duration: 0.8 }}
                      >
                        <ArrowRight className="w-6 h-6 text-cyan-400 rotate-180" />
                      </motion.div>
                      <div className="text-xs text-cyan-400 font-mono mt-1">
                        IRQ {step.handlingEvent.vector}
                      </div>
                    </motion.div>
                  )}
                  {step.dmaProgress > 0 && step.dmaProgress < 100 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center"
                    >
                      <div className="text-xs text-purple-400 font-medium">DMA</div>
                      <div className="w-16 h-2 bg-[#1e1e2e] rounded-full mt-1">
                        <motion.div
                          className="h-full bg-purple-500 rounded-full"
                          animate={{ width: `${step.dmaProgress}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{step.dmaProgress}%</div>
                    </motion.div>
                  )}
                </div>

                {/* Devices */}
                <div className="flex-1">
                  <div className="space-y-3">
                    {scenario.events.map(event => {
                      const isActive = step.activeDevice === event.type;
                      const color = DEVICE_COLORS[event.type];
                      return (
                        <motion.div
                          key={event.id}
                          className="rounded-lg p-3 border transition-colors"
                          style={{
                            backgroundColor: isActive ? color + '15' : '#0a0a0f',
                            borderColor: isActive ? color + '50' : '#1e1e2e',
                          }}
                          animate={isActive ? { scale: [1, 1.02, 1] } : {}}
                          transition={{ duration: 0.3 }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{DEVICE_ICONS[event.type]}</span>
                            <div>
                              <div className="text-sm text-white">{event.label}</div>
                              <div className="text-xs text-gray-500">Vector: 0x{event.vector.toString(16).toUpperCase()} | Priority: {event.priority}</div>
                            </div>
                            {isActive && (
                              <motion.div
                                className="ml-auto w-2 h-2 rounded-full"
                                style={{ backgroundColor: color }}
                                animate={{ opacity: [1, 0.3, 1] }}
                                transition={{ repeat: Infinity, duration: 0.6 }}
                              />
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* IDT Table */}
              {step.idtLookup && step.handlingEvent && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 p-3 bg-[#0a0a0f] rounded-lg border border-cyan-500/30"
                >
                  <div className="text-xs font-medium text-cyan-400 mb-2">Interrupt Descriptor Table (IDT)</div>
                  <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                    {[0x20, 0x21, 0x2B, 0x2E].map(vec => (
                      <div
                        key={vec}
                        className={`px-2 py-1 rounded ${
                          vec === step.handlingEvent!.vector
                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                            : 'bg-[#111118] text-gray-500'
                        }`}
                      >
                        0x{vec.toString(16).toUpperCase()} → {
                          vec === 0x20 ? 'timer_handler'
                          : vec === 0x21 ? 'kbd_handler'
                          : vec === 0x2B ? 'net_handler'
                          : 'disk_handler'
                        }
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Timeline */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Interrupt Timeline</h3>
              <div className="flex gap-1 overflow-x-auto pb-2">
                {steps.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => { setIsPlaying(false); setCurrentStep(i); }}
                    className={`flex-shrink-0 px-2 py-1.5 rounded text-xs font-mono whitespace-nowrap transition-colors ${
                      i === currentStep
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                        : i < currentStep
                        ? 'bg-[#1e1e2e] text-gray-500'
                        : 'bg-[#0a0a0f] text-gray-600 border border-[#1e1e2e]'
                    }`}
                  >
                    {s.phase.length > 20 ? s.phase.slice(0, 18) + '…' : s.phase}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Panel */}
          <div className="space-y-4">
            {/* Interrupt Info */}
            {step.handlingEvent && (
              <motion.div
                key={step.handlingEvent.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4"
              >
                <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-cyan-400" /> Current Interrupt
                </h3>
                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Type</span>
                    <span className="text-gray-300">{step.handlingEvent.type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Vector</span>
                    <span className="text-cyan-400">0x{step.handlingEvent.vector.toString(16).toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Priority</span>
                    <span className="text-yellow-400">{step.handlingEvent.priority}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Handler</span>
                    <span className="text-green-400">{step.handlingEvent.handler}</span>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Concept Explanation */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-cyan-400" /> How It Works
              </h3>
              <div className="space-y-3 text-xs text-gray-400 leading-relaxed">
                <div>
                  <div className="text-cyan-400 font-medium mb-1">Interrupt Flow</div>
                  <div>1. Device raises IRQ signal</div>
                  <div>2. CPU finishes current instruction</div>
                  <div>3. Save state (PC, flags) to kernel stack</div>
                  <div>4. Look up handler in IDT</div>
                  <div>5. Jump to handler (kernel mode)</div>
                  <div>6. IRET: restore state, return to user mode</div>
                </div>
                {scenario.useDMA && (
                  <div>
                    <div className="text-purple-400 font-medium mb-1">DMA Transfer</div>
                    <div>DMA controller copies data between device and memory without CPU involvement. CPU only handles the completion interrupt.</div>
                  </div>
                )}
              </div>
            </div>

            {/* Mode Comparison */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">User vs Kernel Mode</h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-2">
                  <div className="text-green-400 font-medium mb-1">User (Ring 3)</div>
                  <div className="text-gray-500">Limited access</div>
                  <div className="text-gray-500">No I/O ports</div>
                  <div className="text-gray-500">No privileged ops</div>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-2">
                  <div className="text-red-400 font-medium mb-1">Kernel (Ring 0)</div>
                  <div className="text-gray-500">Full hardware access</div>
                  <div className="text-gray-500">I/O port access</div>
                  <div className="text-gray-500">Interrupt handling</div>
                </div>
              </div>
            </div>

            {/* Scenario Info */}
            <div className="bg-[#111118] rounded-lg border border-cyan-500/20 p-4">
              <h3 className="text-sm font-medium text-cyan-400 mb-2">{scenario.name}</h3>
              <p className="text-xs text-gray-400 leading-relaxed">{scenario.description}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}