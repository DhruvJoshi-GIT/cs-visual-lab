'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Play, Pause, RotateCcw, Power, ChevronRight, Cpu,
  HardDrive, Monitor, Info, Layers
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

interface BootStage {
  id: string;
  name: string;
  phase: string;
  description: string;
  details: string[];
  memoryRange: string;
  cpuMode: string;
  duration: string;
  color: string;
}

const BOOT_STAGES: BootStage[] = [
  {
    id: 'power-on',
    name: 'Power On',
    phase: 'Hardware',
    description: 'Power supply sends power-good signal. CPU reset vector jumps to firmware.',
    details: [
      'PSU stabilizes voltages (3.3V, 5V, 12V)',
      'CPU reset pin deasserted',
      'Instruction pointer set to 0xFFFFFFF0',
      'CPU starts in real mode (16-bit)',
    ],
    memoryRange: '0xFFFFFFF0',
    cpuMode: 'Real Mode (16-bit)',
    duration: '~0ms',
    color: '#ef4444',
  },
  {
    id: 'post',
    name: 'POST',
    phase: 'Firmware',
    description: 'Power-On Self-Test. Firmware checks RAM, CPU, and basic hardware.',
    details: [
      'Test CPU registers and ALU',
      'Check first 64KB of RAM',
      'Initialize interrupt vector table',
      'Detect and initialize video card',
      'Full memory test (if enabled)',
    ],
    memoryRange: '0x00000-0xFFFFF',
    cpuMode: 'Real Mode (16-bit)',
    duration: '~1-5s',
    color: '#f59e0b',
  },
  {
    id: 'uefi',
    name: 'UEFI/BIOS',
    phase: 'Firmware',
    description: 'Firmware initializes hardware, enumerates devices, finds boot device.',
    details: [
      'Initialize PCI bus and enumerate devices',
      'Set up ACPI tables',
      'Configure memory map (E820)',
      'Read boot order from NVRAM',
      'Load bootloader from EFI System Partition',
    ],
    memoryRange: '0x00000-0xFFFFF',
    cpuMode: 'Real Mode → Protected',
    duration: '~2-10s',
    color: '#f97316',
  },
  {
    id: 'bootloader',
    name: 'Bootloader (GRUB)',
    phase: 'Bootloader',
    description: 'GRUB Stage 1 loads Stage 2 from disk. Shows boot menu, loads kernel image.',
    details: [
      'Stage 1: 512 bytes in MBR sector 0',
      'Stage 1.5: filesystem drivers',
      'Stage 2: full GRUB with menu',
      'Parse grub.cfg for kernel options',
      'Load vmlinuz + initramfs into memory',
    ],
    memoryRange: '0x100000+',
    cpuMode: 'Protected Mode (32-bit)',
    duration: '~1-3s',
    color: '#84cc16',
  },
  {
    id: 'kernel-decompress',
    name: 'Kernel Decompression',
    phase: 'Kernel Early',
    description: 'Compressed kernel image (vmlinuz) decompresses itself into memory.',
    details: [
      'Self-extracting header runs decompressor',
      'Decompress bzImage → vmlinux',
      'Set up temporary page tables',
      'Switch to long mode (64-bit)',
      'Jump to start_kernel()',
    ],
    memoryRange: '0x1000000+',
    cpuMode: '32-bit → 64-bit Long Mode',
    duration: '~100ms',
    color: '#06b6d4',
  },
  {
    id: 'kernel-init',
    name: 'Kernel Initialization',
    phase: 'Kernel',
    description: 'start_kernel() initializes all core subsystems.',
    details: [
      'Initialize memory management (page allocator)',
      'Set up interrupt handlers (IDT)',
      'Initialize scheduler',
      'Detect and initialize CPUs (SMP)',
      'Mount root filesystem',
      'Initialize device drivers',
      'Create kernel threads (kworker, ksoftirqd)',
    ],
    memoryRange: 'Full address space',
    cpuMode: '64-bit Long Mode',
    duration: '~500ms-2s',
    color: '#8b5cf6',
  },
  {
    id: 'initramfs',
    name: 'initramfs',
    phase: 'Early Userspace',
    description: 'Temporary root filesystem loads essential drivers to mount real root.',
    details: [
      'Unpack initramfs (cpio archive)',
      'Run /init script',
      'Load storage drivers (NVMe, RAID)',
      'Assemble RAID / unlock LUKS',
      'Mount real root filesystem',
      'pivot_root to real rootfs',
    ],
    memoryRange: 'Userspace',
    cpuMode: '64-bit (User Mode)',
    duration: '~1-3s',
    color: '#a855f7',
  },
  {
    id: 'systemd',
    name: 'systemd (PID 1)',
    phase: 'Userspace',
    description: 'First userspace process. Manages all services and brings system to target.',
    details: [
      'Kernel exec\'s /sbin/init → systemd',
      'Parse unit files and build dependency tree',
      'Start services in parallel',
      'Mount remaining filesystems',
      'Start networking, logging, D-Bus',
      'Reach default.target (multi-user or graphical)',
    ],
    memoryRange: 'Userspace',
    cpuMode: '64-bit (User Mode)',
    duration: '~2-10s',
    color: '#ec4899',
  },
  {
    id: 'login',
    name: 'Login Prompt',
    phase: 'Userspace',
    description: 'System ready. Getty or display manager presents login.',
    details: [
      'getty spawns on virtual consoles',
      'Display manager (GDM/SDDM) starts',
      'PAM authenticates user',
      'User shell or desktop session starts',
      'System fully operational',
    ],
    memoryRange: 'Userspace',
    cpuMode: '64-bit (User Mode)',
    duration: '~1-2s',
    color: '#10b981',
  },
];

export default function BootSequencePage() {
  const [currentStage, setCurrentStage] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isPlaying && currentStage < BOOT_STAGES.length - 1) {
      timerRef.current = setTimeout(() => {
        setCurrentStage(s => s + 1);
      }, 1800 / speed);
    } else if (currentStage >= BOOT_STAGES.length - 1) {
      setIsPlaying(false);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, currentStage, speed]);

  const handlePlayPause = () => {
    if (currentStage >= BOOT_STAGES.length - 1) {
      setCurrentStage(0);
      setTimeout(() => setIsPlaying(true), 50);
      return;
    }
    setIsPlaying(!isPlaying);
  };

  const stage = BOOT_STAGES[currentStage];

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <Power className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Linux Boot Sequence</h1>
              <p className="text-sm text-gray-400">Module 3.10 — From power button to login prompt</p>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <button onClick={handlePlayPause}
            className="w-10 h-10 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center hover:bg-cyan-500/30">
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={() => { setIsPlaying(false); if (currentStage < BOOT_STAGES.length - 1) setCurrentStage(s => s + 1); }}
            className="px-3 py-2 rounded-lg bg-[#1e1e2e] text-gray-300 text-sm hover:text-white flex items-center gap-1">
            <ChevronRight className="w-4 h-4" /> Step
          </button>
          <button onClick={() => { setIsPlaying(false); setCurrentStage(0); }}
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
            Stage {currentStage + 1} / {BOOT_STAGES.length}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main - Boot Timeline */}
          <div className="lg:col-span-2 space-y-4">
            {/* Current Stage Banner */}
            <motion.div
              key={stage.id}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-lg border"
              style={{ backgroundColor: stage.color + '15', borderColor: stage.color + '40' }}
            >
              <div className="flex items-center gap-3 mb-1">
                <div className="px-2 py-0.5 rounded text-xs font-bold" style={{ color: stage.color, backgroundColor: stage.color + '20' }}>
                  {stage.phase.toUpperCase()}
                </div>
                <span className="text-white font-medium text-lg">{stage.name}</span>
              </div>
              <p className="text-sm text-gray-400">{stage.description}</p>
            </motion.div>

            {/* Boot Progress Bar */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-medium text-white">Boot Progress</h3>
              </div>
              <div className="space-y-2">
                {BOOT_STAGES.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => { setIsPlaying(false); setCurrentStage(i); }}
                    className="w-full flex items-center gap-3 group"
                  >
                    {/* Connector line */}
                    <div className="flex flex-col items-center w-6">
                      <motion.div
                        className="w-4 h-4 rounded-full border-2 flex-shrink-0"
                        style={{
                          borderColor: i <= currentStage ? s.color : '#2a2a3a',
                          backgroundColor: i <= currentStage ? s.color + '40' : 'transparent',
                        }}
                        animate={i === currentStage ? { scale: [1, 1.2, 1] } : {}}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                      />
                      {i < BOOT_STAGES.length - 1 && (
                        <div className="w-0.5 h-4" style={{ backgroundColor: i < currentStage ? s.color + '60' : '#2a2a3a' }} />
                      )}
                    </div>

                    {/* Stage info */}
                    <div className={`flex-1 text-left px-3 py-2 rounded-lg transition-colors ${
                      i === currentStage ? 'bg-[#1e1e2e]' : 'hover:bg-[#1e1e2e]/50'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-medium ${i <= currentStage ? 'text-white' : 'text-gray-500'}`}>
                          {s.name}
                        </span>
                        <span className="text-xs text-gray-600">{s.duration}</span>
                      </div>
                      {i === currentStage && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="text-xs text-gray-400 mt-1"
                        >
                          {s.description}
                        </motion.p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Console Output Simulation */}
            <div className="bg-[#0a0a0f] rounded-lg border border-[#1e1e2e] p-4 font-mono text-xs">
              <div className="flex items-center gap-2 mb-3">
                <Monitor className="w-4 h-4 text-gray-400" />
                <span className="text-gray-400 text-sm font-sans">Boot Console</span>
              </div>
              <div className="space-y-0.5 text-green-400/80">
                {BOOT_STAGES.slice(0, currentStage + 1).map((s, i) => (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex"
                  >
                    <span className="text-gray-600 mr-2">[{(i * 0.8).toFixed(3)}]</span>
                    <span style={{ color: s.color }}>
                      {s.id === 'power-on' && 'CPU reset vector → 0xFFFFFFF0'}
                      {s.id === 'post' && 'POST: RAM OK, CPU OK, VGA OK'}
                      {s.id === 'uefi' && 'EFI: Boot device /dev/nvme0n1p1'}
                      {s.id === 'bootloader' && 'GRUB: Loading vmlinuz-6.1.0 ...'}
                      {s.id === 'kernel-decompress' && 'Decompressing Linux... done. Booting the kernel.'}
                      {s.id === 'kernel-init' && 'Linux version 6.1.0 (root@build) SMP PREEMPT_DYNAMIC'}
                      {s.id === 'initramfs' && 'Loading initial ramdisk... pivot_root to /mnt/root'}
                      {s.id === 'systemd' && 'systemd[1]: Reached target Multi-User System.'}
                      {s.id === 'login' && 'login: _'}
                    </span>
                  </motion.div>
                ))}
                {currentStage < BOOT_STAGES.length - 1 && (
                  <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ repeat: Infinity, duration: 0.8 }}
                    className="text-green-400"
                  >▊</motion.span>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel */}
          <div className="space-y-4">
            {/* Stage Details */}
            <motion.div
              key={stage.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4"
            >
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-cyan-400" /> Stage Details
              </h3>
              <div className="space-y-2">
                {stage.details.map((detail, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex gap-2 text-xs"
                  >
                    <span style={{ color: stage.color }}>→</span>
                    <span className="text-gray-400">{detail}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* System State */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" /> System State
              </h3>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1.5">
                  <span className="text-gray-500">CPU Mode</span>
                  <span className="text-cyan-400">{stage.cpuMode}</span>
                </div>
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1.5">
                  <span className="text-gray-500">Memory</span>
                  <span className="text-cyan-400">{stage.memoryRange}</span>
                </div>
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1.5">
                  <span className="text-gray-500">Duration</span>
                  <span className="text-yellow-400">{stage.duration}</span>
                </div>
              </div>
            </div>

            {/* Memory Map */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-cyan-400" /> Memory Layout
              </h3>
              <div className="space-y-1">
                {[
                  { range: '0x0000-0x03FF', label: 'IVT', active: currentStage >= 1, color: '#ef4444' },
                  { range: '0x7C00-0x7DFF', label: 'MBR/Boot', active: currentStage >= 3, color: '#84cc16' },
                  { range: '0x100000+', label: 'Kernel', active: currentStage >= 4, color: '#8b5cf6' },
                  { range: 'High memory', label: 'initramfs', active: currentStage >= 6, color: '#a855f7' },
                  { range: 'Userspace', label: 'systemd', active: currentStage >= 7, color: '#ec4899' },
                ].map(region => (
                  <div key={region.label}
                    className={`flex items-center justify-between px-2 py-1 rounded text-xs font-mono ${
                      region.active ? '' : 'opacity-30'
                    }`}
                    style={{ backgroundColor: region.active ? region.color + '15' : '#0a0a0f' }}
                  >
                    <span className="text-gray-500">{region.range}</span>
                    <span style={{ color: region.active ? region.color : '#444' }}>{region.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Key Transitions */}
            <div className="bg-[#111118] rounded-lg border border-cyan-500/20 p-4">
              <h3 className="text-sm font-medium text-cyan-400 mb-2">Key Transitions</h3>
              <div className="space-y-2 text-xs text-gray-400">
                <div className="flex gap-2">
                  <span className="text-red-400">→</span>
                  Real Mode (16-bit, 1MB)
                </div>
                <div className="flex gap-2">
                  <span className="text-yellow-400">→</span>
                  Protected Mode (32-bit, 4GB)
                </div>
                <div className="flex gap-2">
                  <span className="text-cyan-400">→</span>
                  Long Mode (64-bit, 256TB)
                </div>
                <div className="flex gap-2">
                  <span className="text-purple-400">→</span>
                  Ring 0 → Ring 3 (init/systemd)
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}