'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, RotateCcw, Box, ChevronRight, Layers,
  Network, Shield, Info, Plus, Trash2, Cpu
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

interface Namespace {
  type: 'pid' | 'net' | 'mnt' | 'uts' | 'ipc' | 'user';
  label: string;
  description: string;
  hostValue: string;
  containerValue: string;
  color: string;
}

const NAMESPACES: Namespace[] = [
  { type: 'pid', label: 'PID', description: 'Process ID isolation. PID 1 inside = different PID on host.', hostValue: 'PID 4821', containerValue: 'PID 1', color: '#06b6d4' },
  { type: 'net', label: 'Network', description: 'Isolated network stack. Own IP, ports, routing table.', hostValue: 'eth0: 192.168.1.5', containerValue: 'eth0: 172.17.0.2', color: '#10b981' },
  { type: 'mnt', label: 'Mount', description: 'Isolated filesystem view. Overlay of image layers.', hostValue: '/home/user/...', containerValue: '/app (overlay)', color: '#f59e0b' },
  { type: 'uts', label: 'UTS', description: 'Isolated hostname and domain name.', hostValue: 'host-server', containerValue: 'container-abc', color: '#8b5cf6' },
  { type: 'ipc', label: 'IPC', description: 'Isolated System V IPC and POSIX message queues.', hostValue: 'Shared memory segments', containerValue: 'Isolated IPC', color: '#ec4899' },
  { type: 'user', label: 'User', description: 'UID/GID mapping. Root in container = non-root on host.', hostValue: 'uid=1000', containerValue: 'uid=0 (root)', color: '#ef4444' },
];

interface CgroupLimit {
  resource: string;
  limit: number;
  used: number;
  unit: string;
  color: string;
}

interface Container {
  id: string;
  name: string;
  image: string;
  status: 'creating' | 'running' | 'stopped';
  pid: number;
  namespaces: Namespace[];
  cgroups: CgroupLimit[];
  layers: string[];
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  focus: 'namespaces' | 'cgroups' | 'overlay' | 'full';
}

const SCENARIOS: Scenario[] = [
  { id: 'namespaces', name: 'Namespace Isolation', description: 'See how each namespace type isolates container from host.', focus: 'namespaces' },
  { id: 'cgroups', name: 'Cgroup Resource Limits', description: 'CPU and memory limits enforced by cgroups.', focus: 'cgroups' },
  { id: 'overlay', name: 'Overlay Filesystem', description: 'Image layers stacked with copy-on-write.', focus: 'overlay' },
  { id: 'full', name: 'Container Lifecycle', description: 'Create, run, and stop a container step by step.', focus: 'full' },
];

const IMAGE_LAYERS = [
  { name: 'ubuntu:22.04 base', size: '77 MB', color: '#1e40af' },
  { name: 'apt install python3', size: '45 MB', color: '#2563eb' },
  { name: 'pip install flask', size: '12 MB', color: '#3b82f6' },
  { name: 'COPY app.py /app/', size: '2 KB', color: '#60a5fa' },
  { name: 'Container R/W Layer', size: '0 KB', color: '#93c5fd' },
];

export default function ContainersPage() {
  const [scenario, setScenario] = useState<Scenario>(SCENARIOS[0]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [selectedNs, setSelectedNs] = useState<Namespace | null>(NAMESPACES[0]);
  const [cpuUsage, setCpuUsage] = useState(30);
  const [memUsage, setMemUsage] = useState(256);
  const [isPlaying, setIsPlaying] = useState(false);
  const [lifecycleStep, setLifecycleStep] = useState(0);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const createContainer = useCallback(() => {
    const id = Math.random().toString(36).slice(2, 8);
    const newContainer: Container = {
      id,
      name: `app-${id}`,
      image: 'myapp:latest',
      status: 'running',
      pid: 4000 + Math.floor(Math.random() * 1000),
      namespaces: NAMESPACES,
      cgroups: [
        { resource: 'CPU', limit: 100, used: cpuUsage, unit: '%', color: '#06b6d4' },
        { resource: 'Memory', limit: 512, used: memUsage, unit: 'MB', color: '#8b5cf6' },
        { resource: 'PIDs', limit: 100, used: 12, unit: '', color: '#f59e0b' },
        { resource: 'I/O', limit: 50, used: 8, unit: 'MB/s', color: '#10b981' },
      ],
      layers: IMAGE_LAYERS.map(l => l.name),
    };
    setContainers(prev => [...prev, newContainer]);
  }, [cpuUsage, memUsage]);

  const removeContainer = useCallback((id: string) => {
    setContainers(prev => prev.filter(c => c.id !== id));
  }, []);

  // Lifecycle animation
  const LIFECYCLE_STEPS = [
    { phase: 'docker run', description: 'CLI sends request to Docker daemon' },
    { phase: 'Pull Image', description: 'Download image layers from registry' },
    { phase: 'Create Namespaces', description: 'clone() with CLONE_NEWPID | CLONE_NEWNET | CLONE_NEWNS' },
    { phase: 'Setup Cgroups', description: 'Create cgroup, set CPU/memory limits' },
    { phase: 'Mount Overlay FS', description: 'Stack image layers + writable layer' },
    { phase: 'Start Process', description: 'exec() entrypoint inside container (PID 1)' },
    { phase: 'Running', description: 'Container is operational' },
  ];

  useEffect(() => {
    if (scenario.focus === 'full' && isPlaying) {
      if (lifecycleStep < LIFECYCLE_STEPS.length - 1) {
        timerRef.current = setTimeout(() => {
          setLifecycleStep(s => s + 1);
        }, 1500 / speed);
      } else {
        setIsPlaying(false);
      }
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, lifecycleStep, speed, scenario.focus]);

  // Simulate usage changes
  useEffect(() => {
    const interval = setInterval(() => {
      setCpuUsage(v => Math.max(10, Math.min(95, v + (Math.random() - 0.5) * 20)));
      setMemUsage(v => Math.max(128, Math.min(480, v + (Math.random() - 0.5) * 40)));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <Box className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Containers & Namespaces</h1>
              <p className="text-sm text-gray-400">Module 3.11 — Process isolation, cgroups, overlay filesystems</p>
            </div>
          </div>
        </div>

        {/* Scenario Selector */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {SCENARIOS.map(sc => (
            <button
              key={sc.id}
              onClick={() => { setScenario(sc); setLifecycleStep(0); setIsPlaying(false); }}
              className={`p-3 rounded-lg border text-left transition-all ${
                scenario.id === sc.id
                  ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-400'
                  : 'bg-[#111118] border-[#1e1e2e] text-gray-400 hover:border-cyan-500/30'
              }`}
            >
              <div className="text-sm font-medium">{sc.name}</div>
              <div className="text-xs mt-1 opacity-70">{sc.description.slice(0, 45)}...</div>
            </button>
          ))}
        </div>

        {/* Controls for lifecycle */}
        {scenario.focus === 'full' && (
          <div className="flex items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
            <button onClick={() => {
              if (lifecycleStep >= LIFECYCLE_STEPS.length - 1) {
                setLifecycleStep(0);
                setTimeout(() => setIsPlaying(true), 50);
              } else setIsPlaying(!isPlaying);
            }}
              className="w-10 h-10 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center hover:bg-cyan-500/30">
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button onClick={() => { setIsPlaying(false); if (lifecycleStep < LIFECYCLE_STEPS.length - 1) setLifecycleStep(s => s + 1); }}
              className="px-3 py-2 rounded-lg bg-[#1e1e2e] text-gray-300 text-sm hover:text-white flex items-center gap-1">
              <ChevronRight className="w-4 h-4" /> Step
            </button>
            <button onClick={() => { setIsPlaying(false); setLifecycleStep(0); }}
              className="px-3 py-2 rounded-lg bg-[#1e1e2e] text-gray-300 text-sm hover:text-white flex items-center gap-1">
              <RotateCcw className="w-4 h-4" /> Reset
            </button>
            <div className="ml-auto text-xs text-gray-500">
              Step {lifecycleStep + 1} / {LIFECYCLE_STEPS.length}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-4">
            {/* Namespace View */}
            {scenario.focus === 'namespaces' && (
              <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-6">
                <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-cyan-400" /> Linux Namespaces
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Host side */}
                  <div className="rounded-lg border-2 border-green-500/30 bg-green-500/5 p-4">
                    <div className="text-sm font-medium text-green-400 mb-3">Host</div>
                    <div className="space-y-2">
                      {NAMESPACES.map(ns => (
                        <button
                          key={ns.type}
                          onClick={() => setSelectedNs(ns)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-mono ${
                            selectedNs?.type === ns.type
                              ? 'bg-[#111118] border border-cyan-500/40'
                              : 'bg-[#0a0a0f] border border-transparent hover:border-[#2a2a3a]'
                          }`}
                        >
                          <span style={{ color: ns.color }}>{ns.label}</span>
                          <span className="text-gray-400">{ns.hostValue}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Container side */}
                  <div className="rounded-lg border-2 border-cyan-500/30 bg-cyan-500/5 p-4">
                    <div className="text-sm font-medium text-cyan-400 mb-3">Container</div>
                    <div className="space-y-2">
                      {NAMESPACES.map(ns => (
                        <div
                          key={ns.type}
                          className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-mono ${
                            selectedNs?.type === ns.type
                              ? 'bg-[#111118] border border-cyan-500/40'
                              : 'bg-[#0a0a0f]'
                          }`}
                        >
                          <span style={{ color: ns.color }}>{ns.label}</span>
                          <span className="text-gray-400">{ns.containerValue}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {selectedNs && (
                  <motion.div
                    key={selectedNs.type}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 p-3 rounded-lg border"
                    style={{ backgroundColor: selectedNs.color + '10', borderColor: selectedNs.color + '30' }}
                  >
                    <div className="text-sm font-medium" style={{ color: selectedNs.color }}>{selectedNs.label} Namespace</div>
                    <p className="text-xs text-gray-400 mt-1">{selectedNs.description}</p>
                  </motion.div>
                )}
              </div>
            )}

            {/* Cgroups View */}
            {scenario.focus === 'cgroups' && (
              <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-white flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-cyan-400" /> Control Groups (cgroups v2)
                  </h3>
                  <button onClick={createContainer}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 text-xs hover:bg-cyan-500/30 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add Container
                  </button>
                </div>

                {/* Resource gauges */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  {[
                    { label: 'CPU', limit: 100, used: Math.round(cpuUsage), unit: '%', color: '#06b6d4' },
                    { label: 'Memory', limit: 512, used: Math.round(memUsage), unit: 'MB', color: '#8b5cf6' },
                    { label: 'PIDs', limit: 100, used: 12 + containers.length * 5, unit: '', color: '#f59e0b' },
                    { label: 'Block I/O', limit: 50, used: 8, unit: 'MB/s', color: '#10b981' },
                  ].map(cg => (
                    <div key={cg.label} className="bg-[#0a0a0f] rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium" style={{ color: cg.color }}>{cg.label}</span>
                        <span className="text-xs text-gray-500">{cg.used}{cg.unit} / {cg.limit}{cg.unit}</span>
                      </div>
                      <div className="w-full h-3 bg-[#1e1e2e] rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: cg.used / cg.limit > 0.8 ? '#ef4444' : cg.color }}
                          animate={{ width: `${Math.min(100, (cg.used / cg.limit) * 100)}%` }}
                          transition={{ duration: 0.5 }}
                        />
                      </div>
                      {cg.used / cg.limit > 0.8 && (
                        <div className="text-xs text-red-400 mt-1">Warning: Near limit!</div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Container list */}
                <AnimatePresence>
                  {containers.map(c => (
                    <motion.div
                      key={c.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-center justify-between p-3 bg-[#0a0a0f] rounded-lg mb-2 border border-[#1e1e2e]"
                    >
                      <div className="flex items-center gap-2">
                        <Box className="w-4 h-4 text-cyan-400" />
                        <span className="text-sm text-white font-mono">{c.name}</span>
                        <span className="text-xs text-green-400 px-1.5 py-0.5 bg-green-500/10 rounded">running</span>
                      </div>
                      <button onClick={() => removeContainer(c.id)}
                        className="text-gray-500 hover:text-red-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {containers.length === 0 && (
                  <div className="text-center py-4 text-xs text-gray-500">
                    Click &quot;Add Container&quot; to see resource allocation
                  </div>
                )}
              </div>
            )}

            {/* Overlay FS View */}
            {scenario.focus === 'overlay' && (
              <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-6">
                <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-cyan-400" /> Overlay Filesystem (OverlayFS)
                </h3>
                <div className="space-y-2">
                  {IMAGE_LAYERS.map((layer, i) => (
                    <motion.div
                      key={layer.name}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="flex items-center gap-3 p-3 rounded-lg border"
                      style={{ backgroundColor: layer.color + '15', borderColor: layer.color + '40' }}
                    >
                      <div className="w-8 text-center text-xs text-gray-500">L{i}</div>
                      <div className="flex-1">
                        <div className="text-sm text-white">{layer.name}</div>
                        <div className="text-xs text-gray-500">{layer.size}</div>
                      </div>
                      <div className={`text-xs px-2 py-0.5 rounded ${
                        i === IMAGE_LAYERS.length - 1
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-[#0a0a0f] text-gray-500'
                      }`}>
                        {i === IMAGE_LAYERS.length - 1 ? 'Read-Write' : 'Read-Only'}
                      </div>
                    </motion.div>
                  ))}
                </div>

                <div className="mt-4 p-3 bg-[#0a0a0f] rounded-lg border border-[#1e1e2e]">
                  <div className="text-xs text-gray-400 mb-2">How it works:</div>
                  <div className="space-y-1 text-xs text-gray-500">
                    <div>• Lower layers are <span className="text-blue-400">read-only</span> (shared between containers)</div>
                    <div>• Top layer is <span className="text-yellow-400">read-write</span> (per container)</div>
                    <div>• <span className="text-cyan-400">Copy-on-write:</span> modifying a lower layer file copies it to R/W layer</div>
                    <div>• Deleting creates a <span className="text-red-400">whiteout</span> file in R/W layer</div>
                  </div>
                </div>
              </div>
            )}

            {/* Lifecycle View */}
            {scenario.focus === 'full' && (
              <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-6">
                <h3 className="text-sm font-medium text-white mb-4">Container Lifecycle</h3>
                <div className="space-y-2">
                  {LIFECYCLE_STEPS.map((ls, i) => (
                    <motion.div
                      key={ls.phase}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                        i === lifecycleStep
                          ? 'bg-cyan-500/10 border-cyan-500/40'
                          : i < lifecycleStep
                          ? 'bg-[#1e1e2e]/50 border-[#1e1e2e]'
                          : 'bg-[#0a0a0f] border-[#1e1e2e] opacity-50'
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        i <= lifecycleStep ? 'bg-cyan-500/20 text-cyan-400' : 'bg-[#1e1e2e] text-gray-600'
                      }`}>
                        {i < lifecycleStep ? '✓' : i + 1}
                      </div>
                      <div>
                        <div className={`text-sm font-medium ${i <= lifecycleStep ? 'text-white' : 'text-gray-500'}`}>
                          {ls.phase}
                        </div>
                        <div className="text-xs text-gray-500">{ls.description}</div>
                      </div>
                      {i === lifecycleStep && (
                        <motion.div
                          className="ml-auto w-2 h-2 rounded-full bg-cyan-400"
                          animate={{ opacity: [1, 0.3, 1] }}
                          transition={{ repeat: Infinity, duration: 0.6 }}
                        />
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Panel */}
          <div className="space-y-4">
            {/* Docker Architecture */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-cyan-400" /> Container Architecture
              </h3>
              <div className="space-y-3 text-xs">
                <div className="p-2 rounded bg-cyan-500/10 border border-cyan-500/20">
                  <div className="text-cyan-400 font-medium">Containers are NOT VMs</div>
                  <div className="text-gray-400 mt-1">They share the host kernel. Isolation comes from Linux namespaces + cgroups.</div>
                </div>
                <div className="space-y-1.5 text-gray-400">
                  <div className="flex gap-2"><span className="text-cyan-400">•</span> Namespaces: what you can see</div>
                  <div className="flex gap-2"><span className="text-cyan-400">•</span> Cgroups: what you can use</div>
                  <div className="flex gap-2"><span className="text-cyan-400">•</span> OverlayFS: filesystem layering</div>
                  <div className="flex gap-2"><span className="text-cyan-400">•</span> seccomp: syscall filtering</div>
                </div>
              </div>
            </div>

            {/* Key Syscalls */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Key Syscalls</h3>
              <div className="space-y-1.5 text-xs font-mono">
                {[
                  { call: 'clone(CLONE_NEWPID)', desc: 'New PID namespace' },
                  { call: 'clone(CLONE_NEWNET)', desc: 'New network namespace' },
                  { call: 'clone(CLONE_NEWNS)', desc: 'New mount namespace' },
                  { call: 'unshare()', desc: 'Detach from namespace' },
                  { call: 'setns()', desc: 'Join existing namespace' },
                  { call: 'pivot_root()', desc: 'Change root filesystem' },
                ].map(s => (
                  <div key={s.call} className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1">
                    <span className="text-cyan-400">{s.call}</span>
                    <span className="text-gray-500">{s.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Network diagram */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Network className="w-4 h-4 text-cyan-400" /> Container Networking
              </h3>
              <div className="space-y-2 text-xs">
                <div className="bg-[#0a0a0f] rounded p-2 border border-[#1e1e2e]">
                  <div className="text-green-400">Host: eth0 (192.168.1.5)</div>
                </div>
                <div className="flex justify-center">
                  <div className="w-0.5 h-4 bg-cyan-500/30" />
                </div>
                <div className="bg-[#0a0a0f] rounded p-2 border border-cyan-500/20">
                  <div className="text-cyan-400">docker0 bridge (172.17.0.1)</div>
                </div>
                <div className="flex justify-center gap-8">
                  <div className="w-0.5 h-4 bg-cyan-500/30" />
                  <div className="w-0.5 h-4 bg-cyan-500/30" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[#0a0a0f] rounded p-2 border border-[#1e1e2e] text-center">
                    <div className="text-gray-400">veth → 172.17.0.2</div>
                  </div>
                  <div className="bg-[#0a0a0f] rounded p-2 border border-[#1e1e2e] text-center">
                    <div className="text-gray-400">veth → 172.17.0.3</div>
                  </div>
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