# CS Visual Lab

An interactive visualization platform for Computer Science concepts. Explore algorithms, data structures, CPU architecture, distributed systems, and more through step-by-step animations and real-time metrics.

**Live:** [cs-visual-lab.vercel.app](https://cs-visual-lab.vercel.app)

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss)

## What's Inside

**16 domains** covering the full CS curriculum, with **50 planned modules** across:

| Domain | Topics |
|---|---|
| Digital Logic | Gates, flip-flops, ALU design |
| CPU Architecture | Pipelining, branch prediction, caches |
| Operating Systems | Scheduling, virtual memory, file systems |
| Algorithms | Sorting, graph traversal, dynamic programming |
| Databases | B+ trees, query optimization, transactions |
| Distributed Systems | Raft consensus, MapReduce, consistent hashing |
| Networking | TCP/IP, routing, congestion control |
| AI / ML | Backpropagation, gradient descent, attention |
| ...and 8 more | Cryptography, GPU, compilers, graphics, math |

## Live Modules

Currently **5 interactive modules** are fully built:

- **CPU Pipelining** — 5-stage pipeline (IF/ID/EX/MEM/WB) with hazard detection and forwarding
- **Sorting Algorithms** — Bubble, Selection, Insertion, Merge, Quick, Heap with real-time comparisons/swaps
- **B+ Tree Indexing** — Insert, delete, search with node splitting/merging visualization
- **Raft Consensus** — Leader election, log replication, and fault tolerance simulation
- **Backpropagation** — Neural network forward/backward pass with gradient flow visualization

Each module features:
- Step-by-step animation with play/pause/speed controls
- Real-time metrics (comparisons, swaps, time complexity)
- Multiple scenarios and input configurations
- SVG + D3.js visualizations with Framer Motion transitions

## Tech Stack

- **Next.js 16** (App Router) with React 19
- **TypeScript** with strict mode
- **Tailwind CSS v4** for styling
- **Framer Motion** for animations
- **D3.js** for data visualizations
- **KaTeX** for mathematical notation
- **Zustand** for state management

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to explore.

## Project Structure

```
src/
├── app/
│   ├── page.tsx                      # Home — domain catalog
│   └── modules/
│       ├── 2-3-pipelining/           # CPU pipeline visualization
│       ├── 4-1-sorting/              # Sorting algorithm comparisons
│       ├── 6-2-bplus-tree/           # B+ tree operations
│       ├── 7-1-raft/                 # Raft consensus protocol
│       └── 11-2-backpropagation/     # Neural network training
├── components/
│   ├── layout/Navbar.tsx             # Navigation
│   └── ui/                           # Shared controls & panels
└── lib/
    └── domains.ts                    # Domain & module configuration
```

## License

MIT

---

## Author

**Dhruv Joshi**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/dhruv-joshi-52769b265/)
[![X](https://img.shields.io/badge/X-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/mdhruvjoshi)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:mdhruvjoshi@gmail.com)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/users/dhruvjoshi.28)
