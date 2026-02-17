'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, RotateCcw, Terminal, ChevronRight, ArrowDown,
  ArrowUp, Shield, Info, Cpu
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

interface SyscallStep {
  phase: string;
  description: string;
  layer: 'user' | 'transition' | 'kernel';
  register?: { name: string; value: string }[];
  highlight?: string;
}

interface SyscallScenario {
  id: string;
  name: string;
  syscall: string;
  number: number;
  description: string;
  args: { name: string; value: string }[];
  steps: SyscallStep[];
}

const SCENARIOS: SyscallScenario[] = [
  {
    id: 'open',
    name: 'open()',
    syscall: 'open',
    number: 2,
    description: 'Open a file descriptor. Traverses VFS, finds inode, allocates fd.',
    args: [
      { name: 'pathname', value: '"/etc/hosts"' },
      { name: 'flags', value: 'O_RDONLY' },
      { name: 'mode', value: '0644' },
    ],
    steps: [
      { phase: 'User Code', description: 'Application calls open("/etc/hosts", O_RDONLY)', layer: 'user', highlight: 'app' },
      { phase: 'libc Wrapper', description: 'glibc wrapper loads syscall number into RAX, args into RDI/RSI/RDX', layer: 'user', register: [{ name: 'RAX', value: '2 (sys_open)' }, { name: 'RDI', value: '→ "/etc/hosts"' }, { name: 'RSI', value: 'O_RDONLY' }], highlight: 'libc' },
      { phase: 'SYSCALL Instruction', description: 'CPU switches from Ring 3 → Ring 0. Saves RIP to RCX, RFLAGS to R11.', layer: 'transition', highlight: 'syscall' },
      { phase: 'Syscall Table Lookup', description: 'Kernel indexes sys_call_table[2] → finds sys_open handler', layer: 'kernel', highlight: 'table' },
      { phase: 'VFS: Path Resolution', description: 'Walk path components: / → etc → hosts. Check permissions at each step.', layer: 'kernel', highlight: 'vfs' },
      { phase: 'Inode Lookup', description: 'Find inode for "hosts". Load from disk cache or read from filesystem.', layer: 'kernel', highlight: 'inode' },
      { phase: 'Allocate File Descriptor', description: 'Find lowest available fd in process file table. Create file struct.', layer: 'kernel', highlight: 'fd' },
      { phase: 'SYSRET Instruction', description: 'Return to Ring 3. Result (fd=3) in RAX. Restore saved RIP and RFLAGS.', layer: 'transition', register: [{ name: 'RAX', value: '3 (fd)' }], highlight: 'sysret' },
      { phase: 'Return to User', description: 'open() returns 3 (file descriptor) to application', layer: 'user', highlight: 'app' },
    ],
  },
  {
    id: 'read',
    name: 'read()',
    syscall: 'read',
    number: 0,
    description: 'Read bytes from a file descriptor into a buffer.',
    args: [
      { name: 'fd', value: '3' },
      { name: 'buf', value: '0x7fff5000' },
      { name: 'count', value: '4096' },
    ],
    steps: [
      { phase: 'User Code', description: 'Application calls read(3, buf, 4096)', layer: 'user', highlight: 'app' },
      { phase: 'libc Wrapper', description: 'Load RAX=0 (sys_read), RDI=3, RSI=buf, RDX=4096', layer: 'user', register: [{ name: 'RAX', value: '0 (sys_read)' }, { name: 'RDI', value: '3 (fd)' }, { name: 'RDX', value: '4096' }], highlight: 'libc' },
      { phase: 'SYSCALL Instruction', description: 'Ring 3 → Ring 0 transition', layer: 'transition', highlight: 'syscall' },
      { phase: 'Syscall Table Lookup', description: 'sys_call_table[0] → sys_read', layer: 'kernel', highlight: 'table' },
      { phase: 'fd → File Struct', description: 'Look up fd 3 in process file descriptor table → file struct', layer: 'kernel', highlight: 'fd' },
      { phase: 'Page Cache Check', description: 'Check if requested data is in page cache. If yes, copy directly.', layer: 'kernel', highlight: 'cache' },
      { phase: 'Copy to User Buffer', description: 'copy_to_user(): safely copy kernel buffer → user-space buf', layer: 'kernel', highlight: 'copy' },
      { phase: 'SYSRET', description: 'Return bytes_read in RAX', layer: 'transition', register: [{ name: 'RAX', value: '512 (bytes read)' }], highlight: 'sysret' },
      { phase: 'Return to User', description: 'read() returns 512 to application', layer: 'user', highlight: 'app' },
    ],
  },
  {
    id: 'write',
    name: 'write()',
    syscall: 'write',
    number: 1,
    description: 'Write bytes from a buffer to a file descriptor.',
    args: [
      { name: 'fd', value: '1 (stdout)' },
      { name: 'buf', value: '"Hello\\n"' },
      { name: 'count', value: '6' },
    ],
    steps: [
      { phase: 'User Code', description: 'Application calls write(1, "Hello\\n", 6)', layer: 'user', highlight: 'app' },
      { phase: 'libc Wrapper', description: 'Load RAX=1, RDI=1 (stdout), RSI=→"Hello\\n", RDX=6', layer: 'user', register: [{ name: 'RAX', value: '1 (sys_write)' }, { name: 'RDI', value: '1 (stdout)' }, { name: 'RDX', value: '6' }], highlight: 'libc' },
      { phase: 'SYSCALL', description: 'Ring 3 → Ring 0', layer: 'transition', highlight: 'syscall' },
      { phase: 'Table Lookup', description: 'sys_call_table[1] → sys_write', layer: 'kernel', highlight: 'table' },
      { phase: 'fd → TTY Driver', description: 'fd 1 → stdout → tty driver → display output', layer: 'kernel', highlight: 'driver' },
      { phase: 'Copy from User', description: 'copy_from_user(): safely copy user buffer to kernel', layer: 'kernel', highlight: 'copy' },
      { phase: 'Driver Write', description: 'TTY driver writes bytes to terminal output buffer', layer: 'kernel', highlight: 'write' },
      { phase: 'SYSRET', description: 'Return 6 (bytes written) in RAX', layer: 'transition', register: [{ name: 'RAX', value: '6 (written)' }], highlight: 'sysret' },
      { phase: 'Return to User', description: 'write() returns 6', layer: 'user', highlight: 'app' },
    ],
  },
  {
    id: 'fork',
    name: 'fork()',
    syscall: 'fork',
    number: 57,
    description: 'Create a child process. Duplicates the entire address space (copy-on-write).',
    args: [],
    steps: [
      { phase: 'User Code', description: 'Application calls fork()', layer: 'user', highlight: 'app' },
      { phase: 'libc Wrapper', description: 'Load RAX=57 (sys_fork)', layer: 'user', register: [{ name: 'RAX', value: '57 (sys_fork)' }], highlight: 'libc' },
      { phase: 'SYSCALL', description: 'Ring 3 → Ring 0', layer: 'transition', highlight: 'syscall' },
      { phase: 'Table Lookup', description: 'sys_call_table[57] → sys_fork → do_fork()', layer: 'kernel', highlight: 'table' },
      { phase: 'Allocate task_struct', description: 'Create new task_struct for child. Copy parent\'s PCB.', layer: 'kernel', highlight: 'task' },
      { phase: 'Copy Page Tables (CoW)', description: 'Mark parent pages as read-only. Share physical frames. Copy on write.', layer: 'kernel', highlight: 'cow' },
      { phase: 'Copy File Descriptors', description: 'Duplicate open file descriptor table for child process', layer: 'kernel', highlight: 'fd' },
      { phase: 'Set Child PID', description: 'Assign new PID. Add to scheduler run queue.', layer: 'kernel', highlight: 'pid' },
      { phase: 'SYSRET (Parent)', description: 'Parent gets child PID. Child gets 0.', layer: 'transition', register: [{ name: 'RAX (parent)', value: '1234 (child pid)' }, { name: 'RAX (child)', value: '0' }], highlight: 'sysret' },
      { phase: 'Return to User', description: 'Both processes resume from same point. Fork returns different values.', layer: 'user', highlight: 'app' },
    ],
  },
];

const LAYER_COLORS = {
  user: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-400', label: 'USER SPACE' },
  transition: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', label: 'MODE SWITCH' },
  kernel: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', label: 'KERNEL SPACE' },
};

export default function SyscallsPage() {
  const [scenario, setScenario] = useState<SyscallScenario>(SCENARIOS[0]);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setCurrentStep(0);
    setIsPlaying(false);
  }, [scenario]);

  useEffect(() => {
    if (isPlaying && currentStep < scenario.steps.length - 1) {
      timerRef.current = setTimeout(() => {
        setCurrentStep(s => s + 1);
      }, 1200 / speed);
    } else if (currentStep >= scenario.steps.length - 1) {
      setIsPlaying(false);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, currentStep, speed, scenario.steps.length]);

  const handlePlayPause = () => {
    if (currentStep >= scenario.steps.length - 1) {
      setCurrentStep(0);
      setTimeout(() => setIsPlaying(true), 50);
      return;
    }
    setIsPlaying(!isPlaying);
  };

  const step = scenario.steps[currentStep];
  const layerStyle = LAYER_COLORS[step.layer];

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">System Calls</h1>
              <p className="text-sm text-gray-400">Module 3.9 — User-space to kernel-space transition, syscall table lookup</p>
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
              <div className="text-sm font-medium font-mono">{sc.name}</div>
              <div className="text-xs mt-1 opacity-70">syscall #{sc.number}</div>
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <button onClick={handlePlayPause}
            className="w-10 h-10 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center hover:bg-cyan-500/30">
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={() => { setIsPlaying(false); if (currentStep < scenario.steps.length - 1) setCurrentStep(s => s + 1); }}
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
            Step {currentStep + 1} / {scenario.steps.length}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Visualization */}
          <div className="lg:col-span-2 space-y-4">
            {/* Current Phase */}
            <motion.div
              key={`${scenario.id}-${currentStep}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`p-4 rounded-lg border ${layerStyle.bg} ${layerStyle.border}`}
            >
              <div className="flex items-center gap-3">
                <div className={`px-2 py-0.5 rounded text-xs font-bold ${layerStyle.text} bg-black/20`}>
                  {layerStyle.label}
                </div>
                <span className="text-white font-medium">{step.phase}</span>
              </div>
              <p className="text-sm text-gray-400 mt-1">{step.description}</p>
              {step.register && (
                <div className="flex gap-3 mt-2">
                  {step.register.map(r => (
                    <div key={r.name} className="bg-black/20 rounded px-2 py-1 text-xs font-mono">
                      <span className="text-gray-500">{r.name}: </span>
                      <span className="text-cyan-400">{r.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Layer Diagram */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-6">
              {/* User Space */}
              <div className={`rounded-lg p-4 border-2 mb-2 transition-all ${
                step.layer === 'user'
                  ? 'border-green-500/50 bg-green-500/5'
                  : 'border-[#1e1e2e] bg-[#0a0a0f]'
              }`}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-sm font-medium text-green-400">User Space (Ring 3)</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className={`rounded-lg p-3 border ${
                    step.highlight === 'app' ? 'border-green-500/50 bg-green-500/10' : 'border-[#1e1e2e] bg-[#111118]'
                  }`}>
                    <div className="text-xs text-gray-400 mb-1">Application</div>
                    <div className="text-xs font-mono text-white">
                      {scenario.syscall}({scenario.args.map(a => a.value).join(', ')})
                    </div>
                  </div>
                  <div className={`rounded-lg p-3 border ${
                    step.highlight === 'libc' ? 'border-green-500/50 bg-green-500/10' : 'border-[#1e1e2e] bg-[#111118]'
                  }`}>
                    <div className="text-xs text-gray-400 mb-1">libc Wrapper</div>
                    <div className="text-xs font-mono text-gray-500">
                      mov rax, {scenario.number}
                      <br />syscall
                    </div>
                  </div>
                </div>
              </div>

              {/* Transition */}
              <div className="flex justify-center py-2">
                <motion.div
                  animate={step.layer === 'transition' ? { y: [0, 4, 0] } : {}}
                  transition={{ repeat: Infinity, duration: 0.6 }}
                >
                  {step.highlight === 'syscall' ? (
                    <ArrowDown className="w-6 h-6 text-yellow-400" />
                  ) : step.highlight === 'sysret' ? (
                    <ArrowUp className="w-6 h-6 text-yellow-400" />
                  ) : (
                    <div className="w-6 h-0.5 bg-[#1e1e2e] rounded" />
                  )}
                </motion.div>
              </div>

              {/* Kernel Boundary */}
              <div className={`relative rounded-lg p-4 border-2 transition-all ${
                step.layer === 'kernel'
                  ? 'border-red-500/50 bg-red-500/5'
                  : 'border-[#1e1e2e] bg-[#0a0a0f]'
              }`}>
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-medium text-red-400">Kernel Space (Ring 0)</span>
                </div>

                {/* Syscall Table */}
                <div className={`rounded-lg p-3 border mb-3 ${
                  step.highlight === 'table' ? 'border-red-500/50 bg-red-500/10' : 'border-[#1e1e2e] bg-[#111118]'
                }`}>
                  <div className="text-xs text-gray-400 mb-2">sys_call_table[]</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { num: 0, name: 'read' },
                      { num: 1, name: 'write' },
                      { num: 2, name: 'open' },
                      { num: 3, name: 'close' },
                      { num: 57, name: 'fork' },
                      { num: 59, name: 'execve' },
                      { num: 60, name: 'exit' },
                    ].map(entry => (
                      <div key={entry.num}
                        className={`px-2 py-0.5 rounded text-xs font-mono ${
                          entry.num === scenario.number && step.highlight === 'table'
                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                            : 'bg-[#0a0a0f] text-gray-500'
                        }`}
                      >
                        [{entry.num}] {entry.name}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Handler details */}
                <div className="grid grid-cols-2 gap-3">
                  {['vfs', 'inode', 'fd', 'cache', 'copy', 'driver', 'write', 'task', 'cow', 'pid'].map(h => {
                    const labels: Record<string, string> = {
                      vfs: 'VFS Layer', inode: 'Inode Lookup', fd: 'File Descriptors',
                      cache: 'Page Cache', copy: 'copy_to/from_user', driver: 'Device Driver',
                      write: 'Driver Write', task: 'task_struct', cow: 'Copy-on-Write', pid: 'PID Alloc',
                    };
                    if (!labels[h]) return null;
                    // Only show relevant boxes for this scenario
                    const relevantHighlights = scenario.steps.map(s => s.highlight).filter(Boolean);
                    if (!relevantHighlights.includes(h)) return null;

                    return (
                      <div key={h}
                        className={`rounded-lg p-2 border text-xs ${
                          step.highlight === h
                            ? 'border-red-500/50 bg-red-500/10 text-red-400'
                            : 'border-[#1e1e2e] bg-[#111118] text-gray-500'
                        }`}
                      >
                        {labels[h]}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Step Timeline */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Execution Timeline</h3>
              <div className="space-y-1">
                {scenario.steps.map((s, i) => {
                  const style = LAYER_COLORS[s.layer];
                  return (
                    <button
                      key={i}
                      onClick={() => { setIsPlaying(false); setCurrentStep(i); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs text-left transition-colors ${
                        i === currentStep
                          ? `${style.bg} ${style.border} border ${style.text}`
                          : i < currentStep
                          ? 'bg-[#1e1e2e]/50 text-gray-500'
                          : 'text-gray-600 hover:text-gray-400'
                      }`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        s.layer === 'user' ? 'bg-green-500' : s.layer === 'kernel' ? 'bg-red-500' : 'bg-yellow-500'
                      }`} />
                      <span className="font-mono">{s.phase}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Panel */}
          <div className="space-y-4">
            {/* Syscall Info */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" /> {scenario.name}
              </h3>
              <p className="text-xs text-gray-400 mb-3">{scenario.description}</p>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-gray-500">Syscall #</span>
                  <span className="text-cyan-400">{scenario.number}</span>
                </div>
                {scenario.args.map(arg => (
                  <div key={arg.name} className="flex justify-between">
                    <span className="text-gray-500">{arg.name}</span>
                    <span className="text-gray-300">{arg.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Register State */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" /> CPU Registers
              </h3>
              <div className="space-y-1.5 text-xs font-mono">
                {[
                  { name: 'RAX', value: step.register?.find(r => r.name.startsWith('RAX'))?.value || (step.layer === 'user' ? '—' : `${scenario.number}`) },
                  { name: 'RDI', value: scenario.args[0]?.value || '—' },
                  { name: 'RSI', value: scenario.args[1]?.value || '—' },
                  { name: 'RDX', value: scenario.args[2]?.value || '—' },
                  { name: 'CPL', value: step.layer === 'kernel' ? '0 (Ring 0)' : '3 (Ring 3)' },
                ].map(reg => (
                  <div key={reg.name} className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1">
                    <span className="text-gray-500">{reg.name}</span>
                    <span className="text-cyan-400">{reg.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* How it Works */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-cyan-400" /> System Call Flow
              </h3>
              <div className="space-y-2 text-xs text-gray-400">
                <div className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 flex-shrink-0" />
                  <div>App calls libc wrapper (e.g., open())</div>
                </div>
                <div className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 flex-shrink-0" />
                  <div>Wrapper puts syscall # in RAX, args in RDI/RSI/RDX</div>
                </div>
                <div className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 mt-1.5 flex-shrink-0" />
                  <div>SYSCALL instruction: Ring 3 → Ring 0</div>
                </div>
                <div className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                  <div>Kernel looks up handler in sys_call_table</div>
                </div>
                <div className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                  <div>Handler executes, result goes in RAX</div>
                </div>
                <div className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 mt-1.5 flex-shrink-0" />
                  <div>SYSRET: Ring 0 → Ring 3, resume user code</div>
                </div>
              </div>
            </div>

            {/* x86-64 Calling Convention */}
            <div className="bg-[#111118] rounded-lg border border-cyan-500/20 p-4">
              <h3 className="text-sm font-medium text-cyan-400 mb-2">x86-64 Syscall Convention</h3>
              <div className="space-y-1 text-xs font-mono text-gray-400">
                <div>RAX = syscall number</div>
                <div>RDI = arg1, RSI = arg2</div>
                <div>RDX = arg3, R10 = arg4</div>
                <div>R8 = arg5, R9 = arg6</div>
                <div className="text-gray-600 mt-2">Return value in RAX</div>
                <div className="text-gray-600">Negative = -errno</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}