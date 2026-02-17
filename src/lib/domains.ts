export interface Module {
  id: string;
  number: string;
  title: string;
  description: string;
  status: "available" | "coming-soon";
  href: string;
}

export interface Domain {
  id: number;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  gradient: string;
  modules: Module[];
}

export const domains: Domain[] = [
  {
    id: 1,
    title: "Digital Logic Foundations",
    subtitle: "From electrons to bits",
    icon: "Cpu",
    color: "#6366f1",
    gradient: "from-indigo-500 to-violet-600",
    modules: [
      { id: "1.1", number: "1.1", title: "Transistors & Logic Gates", description: "MOSFET switching animation with signal propagation", status: "available", href: "/modules/1-1-logic-gates" },
      { id: "1.2", number: "1.2", title: "Flip-Flops & Latches", description: "SR, D, JK flip-flop state diagrams", status: "available", href: "/modules/1-2-flip-flops" },
      { id: "1.3", number: "1.3", title: "Combinational Circuits", description: "Mux, decoder, full adder", status: "available", href: "/modules/1-3-combinational" },
      { id: "1.4", number: "1.4", title: "Sequential Circuits", description: "Registers, counters, FSMs", status: "available", href: "/modules/1-4-sequential" },
      { id: "1.5", number: "1.5", title: "Binary Arithmetic", description: "Two's complement, addition, overflow", status: "available", href: "/modules/1-5-binary-arithmetic" },
      { id: "1.6", number: "1.6", title: "Floating Point Demystifier", description: "IEEE 754 bit decomposition", status: "available", href: "/modules/1-6-floating-point" },
      { id: "1.7", number: "1.7", title: "ALU Design", description: "Full ALU data path visualization", status: "available", href: "/modules/1-7-alu" },
    ],
  },
  {
    id: 2,
    title: "CPU Architecture",
    subtitle: "How a processor executes instructions",
    icon: "Microchip",
    color: "#8b5cf6",
    gradient: "from-violet-500 to-purple-600",
    modules: [
      { id: "2.1", number: "2.1", title: "Instruction Set Architecture", description: "Instruction encoding/decoding", status: "available", href: "/modules/2-1-isa" },
      { id: "2.2", number: "2.2", title: "Single-Cycle Datapath", description: "Full datapath with highlighted paths", status: "available", href: "/modules/2-2-single-cycle" },
      { id: "2.3", number: "2.3", title: "Pipelining (5-Stage)", description: "IF/ID/EX/MEM/WB pipeline with hazards", status: "available", href: "/modules/2-3-pipelining" },
      { id: "2.4", number: "2.4", title: "Branch Prediction", description: "1-bit, 2-bit, tournament predictors", status: "available", href: "/modules/2-4-branch-prediction" },
      { id: "2.5", number: "2.5", title: "Cache Hierarchy", description: "Direct-mapped, set-associative caches", status: "available", href: "/modules/2-5-cache" },
      { id: "2.6", number: "2.6", title: "CPU Cache Simulator", description: "Nested loop cache behavior, stride visualization", status: "available", href: "/modules/2-6-cache-simulator" },
      { id: "2.7", number: "2.7", title: "Out-of-Order Execution", description: "Reservation stations, ROB, Tomasulo's algorithm", status: "available", href: "/modules/2-7-ooo-execution" },
      { id: "2.8", number: "2.8", title: "Virtual Memory & TLB", description: "Page table walk, TLB lookup, page fault handling", status: "available", href: "/modules/2-8-virtual-memory" },
      { id: "2.9", number: "2.9", title: "Memory Ordering & Barriers", description: "Store buffers, memory fences, TSO vs relaxed", status: "available", href: "/modules/2-9-memory-ordering" },
      { id: "2.10", number: "2.10", title: "SIMD / Vector Processing", description: "Scalar vs SIMD throughput comparison", status: "available", href: "/modules/2-10-simd" },
    ],
  },
  {
    id: 3,
    title: "Operating Systems",
    subtitle: "The software that manages hardware",
    icon: "Monitor",
    color: "#06b6d4",
    gradient: "from-cyan-500 to-teal-600",
    modules: [
      { id: "3.1", number: "3.1", title: "Process Model", description: "PCB structure and state transitions", status: "available", href: "/modules/3-1-processes" },
      { id: "3.2", number: "3.2", title: "CPU Scheduling", description: "FCFS, SJF, Round Robin, MLFQ", status: "available", href: "/modules/3-2-scheduling" },
      { id: "3.3", number: "3.3", title: "Memory Management", description: "Paging, segmentation, page replacement", status: "available", href: "/modules/3-3-memory" },
      { id: "3.4", number: "3.4", title: "Memory Allocator Playground", description: "malloc/free with first-fit, best-fit, buddy system", status: "available", href: "/modules/3-4-allocator" },
      { id: "3.5", number: "3.5", title: "Concurrency & Synchronization", description: "Race conditions, mutexes, thread interleaving", status: "available", href: "/modules/3-5-concurrency" },
      { id: "3.6", number: "3.6", title: "Deadlock Visualizer", description: "Resource allocation graph, cycle detection, Banker's algorithm", status: "available", href: "/modules/3-6-deadlock" },
      { id: "3.7", number: "3.7", title: "File Systems", description: "Inode structure, directory tree, block allocation strategies", status: "available", href: "/modules/3-7-filesystems" },
      { id: "3.8", number: "3.8", title: "I/O & Interrupts", description: "Interrupt handling flow, DMA transfer, device driver model", status: "available", href: "/modules/3-8-io-interrupts" },
      { id: "3.9", number: "3.9", title: "System Calls", description: "User-space to kernel-space transition, syscall table lookup", status: "available", href: "/modules/3-9-syscalls" },
      { id: "3.10", number: "3.10", title: "Linux Boot Sequence", description: "BIOS/UEFI to bootloader to kernel to systemd", status: "available", href: "/modules/3-10-boot" },
      { id: "3.11", number: "3.11", title: "Containers & Namespaces", description: "Process isolation, cgroups, overlay filesystems", status: "available", href: "/modules/3-11-containers" },
    ],
  },
  {
    id: 4,
    title: "Algorithms & Data Structures",
    subtitle: "The building blocks of computation",
    icon: "GitBranch",
    color: "#10b981",
    gradient: "from-emerald-500 to-green-600",
    modules: [
      { id: "4.1", number: "4.1", title: "Sorting Algorithms", description: "Side-by-side animated sorting comparison", status: "available", href: "/modules/4-1-sorting" },
      { id: "4.2", number: "4.2", title: "Binary Search", description: "Search space narrowing animation", status: "available", href: "/modules/4-2-binary-search" },
      { id: "4.3", number: "4.3", title: "Hash Tables", description: "Collision resolution strategies", status: "available", href: "/modules/4-3-hash-tables" },
      { id: "4.4", number: "4.4", title: "Trees: BST, AVL, Red-Black", description: "Insertion, deletion, rotation animations", status: "available", href: "/modules/4-4-trees" },
      { id: "4.5", number: "4.5", title: "B-Trees & B+ Trees", description: "Node splits, merges, range queries", status: "available", href: "/modules/4-5-btrees" },
      { id: "4.6", number: "4.6", title: "Heaps & Priority Queues", description: "Binary heap with bubble-up/down animation", status: "available", href: "/modules/4-6-heaps" },
      { id: "4.7", number: "4.7", title: "Tries & Suffix Trees", description: "Prefix tree construction and search", status: "available", href: "/modules/4-7-tries" },
    ],
  },
  {
    id: 5,
    title: "Search Algorithms & Systems",
    subtitle: "Every type of search",
    icon: "Search",
    color: "#f59e0b",
    gradient: "from-amber-500 to-orange-600",
    modules: [
      { id: "5.1", number: "5.1", title: "Linear & Binary Search", description: "Search space visualization", status: "available", href: "/modules/5-1-search" },
      { id: "5.8", number: "5.8", title: "Inverted Index", description: "Document indexing pipeline", status: "available", href: "/modules/5-8-inverted-index" },
    ],
  },
  {
    id: 6,
    title: "Database Internals",
    subtitle: "How databases store and retrieve data",
    icon: "Database",
    color: "#ec4899",
    gradient: "from-pink-500 to-rose-600",
    modules: [
      { id: "6.1", number: "6.1", title: "Storage Engine Fundamentals", description: "Row vs column store page layout", status: "available", href: "/modules/6-1-storage" },
      { id: "6.2", number: "6.2", title: "B+ Tree Indexing", description: "Interactive B+ tree with splits and merges", status: "available", href: "/modules/6-2-bplus-tree" },
      { id: "6.3", number: "6.3", title: "LSM Trees", description: "Memtable, SSTables, compaction", status: "available", href: "/modules/6-3-lsm" },
    ],
  },
  {
    id: 7,
    title: "Distributed Systems",
    subtitle: "Coordination across multiple machines",
    icon: "Network",
    color: "#ef4444",
    gradient: "from-red-500 to-rose-600",
    modules: [
      { id: "7.1", number: "7.1", title: "Raft Consensus", description: "Leader election, log replication, fault tolerance", status: "available", href: "/modules/7-1-raft" },
      { id: "7.4", number: "7.4", title: "Consistent Hashing", description: "Token ring with virtual nodes", status: "available", href: "/modules/7-4-consistent-hashing" },
      { id: "7.6", number: "7.6", title: "Vector Clocks", description: "Causality tracking in distributed systems", status: "available", href: "/modules/7-6-vector-clocks" },
    ],
  },
  {
    id: 8,
    title: "Networking & Protocols",
    subtitle: "How data moves between machines",
    icon: "Globe",
    color: "#14b8a6",
    gradient: "from-teal-500 to-cyan-600",
    modules: [
      { id: "8.1", number: "8.1", title: "OSI / TCP-IP Model", description: "Packet encapsulation through layers", status: "available", href: "/modules/8-1-osi" },
      { id: "8.3", number: "8.3", title: "TCP Flow Control", description: "Sliding window, congestion control", status: "available", href: "/modules/8-3-tcp" },
    ],
  },
  {
    id: 9,
    title: "Cryptography & Security",
    subtitle: "How data is protected",
    icon: "Shield",
    color: "#f97316",
    gradient: "from-orange-500 to-amber-600",
    modules: [
      { id: "9.1", number: "9.1", title: "Symmetric Encryption (AES)", description: "Round-by-round encryption", status: "available", href: "/modules/9-1-aes" },
      { id: "9.2", number: "9.2", title: "Hashing (SHA-256)", description: "Avalanche effect visualization", status: "available", href: "/modules/9-2-sha256" },
    ],
  },
  {
    id: 10,
    title: "GPU Architecture & CUDA",
    subtitle: "Massively parallel computation",
    icon: "Zap",
    color: "#a855f7",
    gradient: "from-purple-500 to-fuchsia-600",
    modules: [
      { id: "10.1", number: "10.1", title: "GPU vs CPU Architecture", description: "Die layout comparison", status: "available", href: "/modules/10-1-gpu-vs-cpu" },
      { id: "10.3", number: "10.3", title: "Warp Execution", description: "SIMT execution and divergence", status: "available", href: "/modules/10-3-warp" },
    ],
  },
  {
    id: 11,
    title: "AI/ML Internals",
    subtitle: "How machine learning works under the hood",
    icon: "Brain",
    color: "#e879f9",
    gradient: "from-fuchsia-500 to-pink-600",
    modules: [
      { id: "11.1", number: "11.1", title: "Perceptron & Linear Models", description: "Decision boundary animation", status: "available", href: "/modules/11-1-perceptron" },
      { id: "11.2", number: "11.2", title: "Backpropagation", description: "Forward pass, gradient flow, weight updates", status: "available", href: "/modules/11-2-backpropagation" },
      { id: "11.3", number: "11.3", title: "Gradient Descent Variants", description: "SGD, Momentum, Adam comparison", status: "available", href: "/modules/11-3-gradient-descent" },
      { id: "11.7", number: "11.7", title: "Transformer Architecture", description: "Full transformer with attention", status: "available", href: "/modules/11-7-transformer" },
    ],
  },
  {
    id: 12,
    title: "Compiler & Language Internals",
    subtitle: "From source code to machine code",
    icon: "Code",
    color: "#64748b",
    gradient: "from-slate-500 to-gray-600",
    modules: [
      { id: "12.1", number: "12.1", title: "Lexical Analysis", description: "Source code to token stream", status: "available", href: "/modules/12-1-lexer" },
      { id: "12.10", number: "12.10", title: "JavaScript Event Loop", description: "Call stack, microtask, macrotask queues", status: "available", href: "/modules/12-10-event-loop" },
    ],
  },
  {
    id: 13,
    title: "Data Engineering",
    subtitle: "Storage, streaming, data movement at scale",
    icon: "Layers",
    color: "#0ea5e9",
    gradient: "from-sky-500 to-blue-600",
    modules: [
      { id: "13.1", number: "13.1", title: "Bloom Filters", description: "Probabilistic membership testing", status: "available", href: "/modules/13-1-bloom" },
      { id: "13.3", number: "13.3", title: "HyperLogLog", description: "Cardinality estimation", status: "available", href: "/modules/13-3-hyperloglog" },
    ],
  },
  {
    id: 14,
    title: "System Design Building Blocks",
    subtitle: "Patterns in every system design",
    icon: "Blocks",
    color: "#84cc16",
    gradient: "from-lime-500 to-green-600",
    modules: [
      { id: "14.1", number: "14.1", title: "Rate Limiter", description: "Token bucket, leaky bucket, sliding window", status: "available", href: "/modules/14-1-rate-limiter" },
      { id: "14.2", number: "14.2", title: "Circuit Breaker", description: "Failure detection and recovery", status: "available", href: "/modules/14-2-circuit-breaker" },
    ],
  },
  {
    id: 15,
    title: "Computer Graphics",
    subtitle: "How pixels appear on screen",
    icon: "Palette",
    color: "#f43f5e",
    gradient: "from-rose-500 to-red-600",
    modules: [
      { id: "15.1", number: "15.1", title: "Rasterization Pipeline", description: "Vertex to pixel transformation", status: "available", href: "/modules/15-1-rasterization" },
    ],
  },
  {
    id: 16,
    title: "Math Foundations for CS",
    subtitle: "Mathematical primitives powering everything",
    icon: "Calculator",
    color: "#78716c",
    gradient: "from-stone-500 to-gray-600",
    modules: [
      { id: "16.1", number: "16.1", title: "Boolean Algebra & Logic", description: "Truth tables, K-maps, minimization", status: "available", href: "/modules/16-1-boolean" },
      { id: "16.4", number: "16.4", title: "Linear Algebra Visualizer", description: "Geometric transformations, SVD", status: "available", href: "/modules/16-4-linear-algebra" },
    ],
  },
];

export function getDomain(id: number): Domain | undefined {
  return domains.find((d) => d.id === id);
}

export function getModule(moduleId: string): { domain: Domain; module: Module } | undefined {
  for (const domain of domains) {
    const mod = domain.modules.find((m) => m.id === moduleId);
    if (mod) return { domain, module: mod };
  }
  return undefined;
}

export const availableModules = domains.flatMap((d) =>
  d.modules.filter((m) => m.status === "available").map((m) => ({ ...m, domain: d }))
);
