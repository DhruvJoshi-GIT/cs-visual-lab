'use client';

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, Trash2, RotateCcw, Info, Type
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';

interface TrieNode {
  children: Map<string, TrieNode>;
  isEnd: boolean;
  word?: string;
}

interface VisualNode {
  id: string;
  char: string;
  isEnd: boolean;
  x: number;
  y: number;
  parentId: string | null;
  highlight: 'none' | 'path' | 'match' | 'insert';
  depth: number;
}

function createTrieNode(): TrieNode {
  return { children: new Map(), isEnd: false };
}

function insertWord(root: TrieNode, word: string): void {
  let node = root;
  for (const char of word.toLowerCase()) {
    if (!node.children.has(char)) {
      node.children.set(char, createTrieNode());
    }
    node = node.children.get(char)!;
  }
  node.isEnd = true;
  node.word = word.toLowerCase();
}

function searchPrefix(root: TrieNode, prefix: string): { found: boolean; path: string[]; completions: string[] } {
  let node = root;
  const path: string[] = ['root'];
  for (const char of prefix.toLowerCase()) {
    if (!node.children.has(char)) {
      return { found: false, path, completions: [] };
    }
    node = node.children.get(char)!;
    path.push(char);
  }

  const completions: string[] = [];
  const collect = (n: TrieNode, current: string) => {
    if (n.isEnd && n.word) completions.push(n.word);
    for (const [ch, child] of n.children) {
      collect(child, current + ch);
    }
  };
  collect(node, prefix);

  return { found: true, path, completions };
}

function trieToVisualNodes(root: TrieNode, highlightPath: Set<string>): { nodes: VisualNode[]; edges: { from: string; to: string }[] } {
  const nodes: VisualNode[] = [];
  const edges: { from: string; to: string }[] = [];

  const queue: { node: TrieNode; id: string; char: string; parentId: string | null; depth: number; siblingIdx: number; totalSiblings: number }[] = [];
  queue.push({ node: root, id: 'root', char: '∅', parentId: null, depth: 0, siblingIdx: 0, totalSiblings: 1 });

  // BFS to assign positions
  const levelWidths: number[] = [];
  const levelNodes: { node: TrieNode; id: string; char: string; parentId: string | null; depth: number }[][] = [];

  // First pass: collect nodes by level
  const bfsQueue = [{ node: root, id: 'root', char: '∅', parentId: null as string | null, depth: 0 }];
  while (bfsQueue.length > 0) {
    const item = bfsQueue.shift()!;
    if (!levelNodes[item.depth]) levelNodes[item.depth] = [];
    levelNodes[item.depth].push(item);

    const children = Array.from(item.node.children.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [ch, child] of children) {
      const childId = `${item.id}-${ch}`;
      bfsQueue.push({ node: child, id: childId, char: ch, parentId: item.id, depth: item.depth + 1 });
    }
  }

  // Second pass: assign x positions
  const totalWidth = 700;
  for (const level of levelNodes) {
    if (!level) continue;
    const spacing = totalWidth / (level.length + 1);
    level.forEach((item, i) => {
      const highlight = highlightPath.has(item.id)
        ? (item.node.isEnd && highlightPath.has(item.id) ? 'match' : 'path')
        : 'none';
      nodes.push({
        id: item.id,
        char: item.char,
        isEnd: item.node.isEnd,
        x: spacing * (i + 1),
        y: item.depth * 60 + 40,
        parentId: item.parentId,
        highlight: highlight as 'none' | 'path' | 'match' | 'insert',
        depth: item.depth,
      });
      if (item.parentId) {
        edges.push({ from: item.parentId, to: item.id });
      }
    });
  }

  return { nodes, edges };
}

const WORD_SETS = [
  { name: 'Animals', words: ['cat', 'car', 'card', 'care', 'cart', 'dog', 'dot', 'dove'] },
  { name: 'Tech', words: ['app', 'api', 'apt', 'array', 'async', 'await', 'byte', 'bit'] },
  { name: 'Simple', words: ['to', 'tea', 'ten', 'inn', 'in', 'i', 'a', 'at'] },
];

export default function TriesPage() {
  const [trie, setTrie] = useState<TrieNode>(createTrieNode());
  const [words, setWords] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [searchResult, setSearchResult] = useState<{ found: boolean; path: string[]; completions: string[] } | null>(null);
  const [highlightPath, setHighlightPath] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState(0);

  const handleInsert = useCallback((word: string) => {
    if (!word.trim()) return;
    const w = word.trim().toLowerCase();
    if (words.includes(w)) return;
    insertWord(trie, w);
    setWords(prev => [...prev, w]);
    setVersion(v => v + 1);

    // Highlight insertion path
    const path = new Set<string>();
    let id = 'root';
    path.add(id);
    for (const char of w) {
      id = `${id}-${char}`;
      path.add(id);
    }
    setHighlightPath(path);
    setTimeout(() => setHighlightPath(new Set()), 1500);
  }, [trie, words]);

  const handleSearch = useCallback((prefix: string) => {
    setSearchValue(prefix);
    if (!prefix) {
      setSearchResult(null);
      setHighlightPath(new Set());
      return;
    }
    const result = searchPrefix(trie, prefix);
    setSearchResult(result);

    // Build highlight path
    const path = new Set<string>();
    let id = 'root';
    path.add(id);
    for (const char of prefix.toLowerCase()) {
      id = `${id}-${char}`;
      path.add(id);
    }
    setHighlightPath(path);
  }, [trie]);

  const handleLoadPreset = useCallback((wordList: string[]) => {
    const newTrie = createTrieNode();
    for (const w of wordList) insertWord(newTrie, w);
    setTrie(newTrie);
    setWords(wordList);
    setSearchResult(null);
    setSearchValue('');
    setHighlightPath(new Set());
    setVersion(v => v + 1);
  }, []);

  const handleReset = () => {
    setTrie(createTrieNode());
    setWords([]);
    setSearchResult(null);
    setSearchValue('');
    setHighlightPath(new Set());
    setVersion(v => v + 1);
  };

  const { nodes, edges } = trieToVisualNodes(trie, highlightPath);
  const svgHeight = Math.max(150, (nodes.length > 0 ? Math.max(...nodes.map(n => n.y)) + 60 : 150));

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Type className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Tries & Suffix Trees</h1>
              <p className="text-sm text-gray-400">Module 4.7 — Prefix tree construction and search</p>
            </div>
          </div>
        </div>

        {/* Config */}
        <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Preset:</span>
            {WORD_SETS.map(ws => (
              <button key={ws.name} onClick={() => handleLoadPreset(ws.words)}
                className="px-2 py-1 rounded text-xs text-gray-400 hover:text-emerald-400 bg-[#1e1e2e] hover:bg-emerald-500/10">
                {ws.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <input
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { handleInsert(inputValue); setInputValue(''); } }}
              placeholder="Word..."
              className="w-28 px-2 py-1.5 rounded bg-[#0a0a0f] border border-[#1e1e2e] text-white text-xs focus:border-emerald-500/50 outline-none"
            />
            <button onClick={() => { handleInsert(inputValue); setInputValue(''); }}
              className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-400 text-xs hover:bg-emerald-500/30 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Insert
            </button>
            <button onClick={handleReset}
              className="px-3 py-1.5 rounded bg-[#1e1e2e] text-gray-400 text-xs hover:text-white flex items-center gap-1">
              <RotateCcw className="w-3 h-3" /> Clear
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="flex items-center gap-3 mb-6 p-4 bg-[#111118] rounded-lg border border-[#1e1e2e]">
          <Search className="w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchValue}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search prefix... (type to see autocomplete)"
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-gray-600"
          />
          {searchResult && (
            <span className={`text-xs px-2 py-0.5 rounded ${
              searchResult.found ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }`}>
              {searchResult.found ? `${searchResult.completions.length} matches` : 'Not found'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Trie Visualization */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Trie Structure</h3>
              <svg width="100%" viewBox={`0 0 700 ${svgHeight}`} className="overflow-visible">
                {/* Edges */}
                {edges.map(edge => {
                  const from = nodes.find(n => n.id === edge.from);
                  const to = nodes.find(n => n.id === edge.to);
                  if (!from || !to) return null;
                  const isHighlighted = highlightPath.has(edge.from) && highlightPath.has(edge.to);
                  return (
                    <motion.line
                      key={`${edge.from}-${edge.to}`}
                      x1={from.x} y1={from.y}
                      x2={to.x} y2={to.y}
                      stroke={isHighlighted ? '#10b981' : '#2a2a3a'}
                      strokeWidth={isHighlighted ? 2 : 1}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    />
                  );
                })}

                {/* Nodes */}
                {nodes.map(node => {
                  const isHighlighted = node.highlight !== 'none';
                  const fillColor = node.highlight === 'match' ? '#10b98133'
                    : node.highlight === 'path' ? '#06b6d433'
                    : node.isEnd ? '#f59e0b22'
                    : '#1e1e2e';
                  const strokeColor = node.highlight === 'match' ? '#10b981'
                    : node.highlight === 'path' ? '#06b6d4'
                    : node.isEnd ? '#f59e0b'
                    : '#3a3a4a';

                  return (
                    <motion.g key={node.id}
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                    >
                      <circle cx={node.x} cy={node.y} r={18}
                        fill={fillColor} stroke={strokeColor} strokeWidth={node.isEnd ? 2.5 : 1.5} />
                      <text x={node.x} y={node.y + 5}
                        textAnchor="middle"
                        fill={isHighlighted ? '#10b981' : node.isEnd ? '#f59e0b' : '#fff'}
                        fontSize={13} fontWeight="bold" fontFamily="monospace">
                        {node.char}
                      </text>
                      {node.isEnd && (
                        <circle cx={node.x + 14} cy={node.y - 14} r={4}
                          fill="#f59e0b" />
                      )}
                    </motion.g>
                  );
                })}

                {nodes.length === 0 && (
                  <text x={350} y={75} textAnchor="middle" fill="#666" fontSize={14}>
                    Insert words or load a preset to build the trie
                  </text>
                )}
              </svg>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full border border-[#3a3a4a] bg-[#1e1e2e]" />
                  Internal
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full border-2 border-yellow-500 bg-yellow-500/10" />
                  End of word
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full border border-emerald-500 bg-emerald-500/20" />
                  Search match
                </div>
              </div>
            </div>

            {/* Autocomplete Results */}
            {searchResult && searchResult.completions.length > 0 && (
              <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
                <h3 className="text-sm font-medium text-white mb-3">Autocomplete: &quot;{searchValue}&quot;</h3>
                <div className="flex flex-wrap gap-2">
                  {searchResult.completions.map(word => (
                    <span key={word}
                      className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Panel */}
          <div className="space-y-4">
            {/* Word List */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Words ({words.length})</h3>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {words.map(w => (
                  <span key={w} className="px-2 py-0.5 rounded bg-[#1e1e2e] text-gray-300 text-xs font-mono">
                    {w}
                  </span>
                ))}
                {words.length === 0 && (
                  <span className="text-xs text-gray-600">No words inserted</span>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-400" /> Trie Stats
              </h3>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1.5">
                  <span className="text-gray-500">Words</span>
                  <span className="text-emerald-400">{words.length}</span>
                </div>
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1.5">
                  <span className="text-gray-500">Nodes</span>
                  <span className="text-emerald-400">{nodes.length}</span>
                </div>
                <div className="flex justify-between bg-[#0a0a0f] rounded px-2 py-1.5">
                  <span className="text-gray-500">Max Depth</span>
                  <span className="text-cyan-400">{nodes.length > 0 ? Math.max(...nodes.map(n => n.depth)) : 0}</span>
                </div>
              </div>
            </div>

            {/* Complexity */}
            <div className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-4">
              <h3 className="text-sm font-medium text-white mb-3">Time Complexity</h3>
              <div className="space-y-1.5 text-xs font-mono">
                {[
                  { op: 'Insert', time: 'O(m)', desc: 'm = word length' },
                  { op: 'Search', time: 'O(m)', desc: 'm = word length' },
                  { op: 'Prefix', time: 'O(m + k)', desc: 'k = matches' },
                  { op: 'Delete', time: 'O(m)', desc: 'm = word length' },
                ].map(c => (
                  <div key={c.op} className="flex items-center justify-between bg-[#0a0a0f] rounded px-2 py-1">
                    <span className="text-gray-400">{c.op}</span>
                    <span className="text-emerald-400">{c.time}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* How it Works */}
            <div className="bg-[#111118] rounded-lg border border-emerald-500/20 p-4">
              <h3 className="text-sm font-medium text-emerald-400 mb-2">How Tries Work</h3>
              <div className="space-y-2 text-xs text-gray-400">
                <div>Each node represents a character. Paths from root to marked nodes form words.</div>
                <div><span className="text-yellow-400">Yellow nodes</span> mark end of a valid word.</div>
                <div>Common prefixes share the same path, saving space.</div>
                <div>Used in: autocomplete, spell-check, IP routing, DNA sequencing.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}