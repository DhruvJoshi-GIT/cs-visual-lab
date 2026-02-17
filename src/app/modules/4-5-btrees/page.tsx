"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Plus,
  Trash2,
  Shuffle,
  TreePine,
  Split,
  Merge,
  Layers,
  Hash,
  ArrowUp,
  Info,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ============================================================================
// Types
// ============================================================================

interface BTreeNode {
  id: string;
  keys: number[];
  children: BTreeNode[];
  parent: BTreeNode | null;
}

type NodeHighlight = "default" | "active" | "split" | "merge" | "found" | "search" | "promote";

interface HighlightMap {
  [nodeId: string]: {
    node: NodeHighlight;
    keys: { [keyIndex: number]: "compare" | "found" | "insert" | "promote" | "remove" };
  };
}

interface AnimationStep {
  tree: BTreeNode | null;
  highlights: HighlightMap;
  message: string;
  metrics: TreeMetrics;
}

interface TreeMetrics {
  nodeCount: number;
  height: number;
  totalKeys: number;
  splits: number;
  merges: number;
}

interface NodePosition {
  x: number;
  y: number;
  width: number;
  nodeId: string;
}

type TreeOrder = 3 | 4 | 5;
type OperationMode = "insert" | "delete" | "search";
type ScenarioId = "sequential" | "random" | "delete-merge" | "search-path";

interface Scenario {
  id: ScenarioId;
  label: string;
  description: string;
}

// ============================================================================
// Constants
// ============================================================================

const SCENARIOS: Scenario[] = [
  { id: "sequential", label: "Sequential Insert", description: "Insert values 1 through 15 in order" },
  { id: "random", label: "Random Insert", description: "Insert random values showing varied splits" },
  { id: "delete-merge", label: "Delete & Merge", description: "Build tree then delete keys causing merges" },
  { id: "search-path", label: "Search Path", description: "Build tree then search for specific values" },
];

const SEQUENTIAL_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const RANDOM_VALUES = [42, 17, 88, 5, 33, 71, 99, 23, 56, 11, 67, 44, 78, 3, 91];
const DELETE_BUILD = [10, 20, 30, 40, 50, 60, 70, 80, 5, 15, 25, 35, 45, 55, 65];
const DELETE_KEYS = [30, 70, 50, 10, 60];
const SEARCH_BUILD = [50, 25, 75, 10, 30, 60, 90, 5, 15, 28, 35, 55, 65, 85, 95];
const SEARCH_KEYS = [28, 65, 99, 5, 50];

const NODE_KEY_WIDTH = 36;
const NODE_KEY_HEIGHT = 32;
const NODE_PADDING = 4;
const LEVEL_HEIGHT = 80;
const MIN_NODE_GAP = 16;

// ============================================================================
// B-Tree Logic
// ============================================================================

let nodeIdCounter = 0;
function newNodeId(): string {
  return `btn-${++nodeIdCounter}`;
}

function createNode(): BTreeNode {
  return { id: newNodeId(), keys: [], children: [], parent: null };
}

function cloneTree(node: BTreeNode | null): BTreeNode | null {
  if (!node) return null;
  const cloned = createNode();
  cloned.keys = [...node.keys];
  cloned.children = node.children.map((child) => {
    const c = cloneTree(child)!;
    c.parent = cloned;
    return c;
  });
  return cloned;
}

function getNodeCount(node: BTreeNode | null): number {
  if (!node) return 0;
  let count = 1;
  for (const child of node.children) count += getNodeCount(child);
  return count;
}

function getHeight(node: BTreeNode | null): number {
  if (!node) return 0;
  if (node.children.length === 0) return 1;
  return 1 + getHeight(node.children[0]);
}

function getTotalKeys(node: BTreeNode | null): number {
  if (!node) return 0;
  let total = node.keys.length;
  for (const child of node.children) total += getTotalKeys(child);
  return total;
}

function computeMetrics(root: BTreeNode | null, splits: number, merges: number): TreeMetrics {
  return {
    nodeCount: getNodeCount(root),
    height: getHeight(root),
    totalKeys: getTotalKeys(root),
    splits,
    merges,
  };
}

function findNode(root: BTreeNode | null, nodeId: string): BTreeNode | null {
  if (!root) return null;
  if (root.id === nodeId) return root;
  for (const child of root.children) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

// B-Tree insert with animation steps
function* insertGenerator(
  root: BTreeNode | null,
  key: number,
  order: TreeOrder,
  metrics: TreeMetrics
): Generator<AnimationStep> {
  let currentRoot = root ? cloneTree(root)! : null;
  let splits = metrics.splits;
  const merges = metrics.merges;

  if (!currentRoot) {
    currentRoot = createNode();
    currentRoot.keys = [key];
    yield {
      tree: cloneTree(currentRoot),
      highlights: { [currentRoot.id]: { node: "active", keys: { 0: "insert" } } },
      message: `Inserted ${key} into new root`,
      metrics: computeMetrics(currentRoot, splits, merges),
    };
    return;
  }

  // Find the leaf node where key should be inserted
  let node = currentRoot;
  const path: BTreeNode[] = [];

  while (node.children.length > 0) {
    path.push(node);
    // Show search at this node
    const highlights: HighlightMap = {};
    highlights[node.id] = { node: "search", keys: {} };
    let childIndex = node.keys.length;
    for (let i = 0; i < node.keys.length; i++) {
      highlights[node.id].keys[i] = "compare";
      if (key < node.keys[i]) {
        childIndex = i;
        break;
      }
    }
    yield {
      tree: cloneTree(currentRoot),
      highlights,
      message: `Searching: comparing ${key} at internal node`,
      metrics: computeMetrics(currentRoot, splits, merges),
    };
    node = node.children[childIndex];
  }

  // Insert key into leaf
  let insertPos = node.keys.length;
  for (let i = 0; i < node.keys.length; i++) {
    if (key < node.keys[i]) { insertPos = i; break; }
    if (key === node.keys[i]) {
      const hl: HighlightMap = {};
      hl[node.id] = { node: "found", keys: { [i]: "found" } };
      yield {
        tree: cloneTree(currentRoot),
        highlights: hl,
        message: `Key ${key} already exists`,
        metrics: computeMetrics(currentRoot, splits, merges),
      };
      return;
    }
  }
  node.keys.splice(insertPos, 0, key);

  const insertHl: HighlightMap = {};
  insertHl[node.id] = { node: "active", keys: { [insertPos]: "insert" } };
  yield {
    tree: cloneTree(currentRoot),
    highlights: insertHl,
    message: `Inserted ${key} into leaf node`,
    metrics: computeMetrics(currentRoot, splits, merges),
  };

  // Check if split is needed (max keys = order - 1)
  const maxKeys = order - 1;
  let current: BTreeNode | null = node;

  while (current && current.keys.length > maxKeys) {
    // Split needed
    const splitHl: HighlightMap = {};
    splitHl[current.id] = { node: "split", keys: {} };
    for (let i = 0; i < current.keys.length; i++) {
      splitHl[current.id].keys[i] = "compare";
    }
    yield {
      tree: cloneTree(currentRoot),
      highlights: splitHl,
      message: `Node overflow (${current.keys.length} keys, max ${maxKeys}). Splitting...`,
      metrics: computeMetrics(currentRoot, splits, merges),
    };

    splits++;
    const midIndex = Math.floor(current.keys.length / 2);
    const medianKey = current.keys[midIndex];

    // Create right sibling
    const rightNode = createNode();
    rightNode.keys = current.keys.splice(midIndex + 1);
    const leftKeys = current.keys.splice(0, midIndex);
    current.keys = leftKeys;

    if (current.children.length > 0) {
      rightNode.children = current.children.splice(midIndex + 1);
      for (const child of rightNode.children) child.parent = rightNode;
    }

    if (!current.parent) {
      // Create new root
      const newRoot = createNode();
      newRoot.keys = [medianKey];
      newRoot.children = [current, rightNode];
      current.parent = newRoot;
      rightNode.parent = newRoot;
      currentRoot = newRoot;

      const promoteHl: HighlightMap = {};
      promoteHl[newRoot.id] = { node: "active", keys: { 0: "promote" } };
      promoteHl[current.id] = { node: "active", keys: {} };
      promoteHl[rightNode.id] = { node: "active", keys: {} };
      yield {
        tree: cloneTree(currentRoot),
        highlights: promoteHl,
        message: `Promoted ${medianKey} to new root`,
        metrics: computeMetrics(currentRoot, splits, merges),
      };
      current = null;
    } else {
      const parent: BTreeNode = current.parent!;
      // Insert median into parent
      let parentInsertPos = parent.keys.length;
      for (let i = 0; i < parent.keys.length; i++) {
        if (medianKey < parent.keys[i]) { parentInsertPos = i; break; }
      }
      parent.keys.splice(parentInsertPos, 0, medianKey);

      const childIndex = parent.children.indexOf(current);
      parent.children.splice(childIndex + 1, 0, rightNode);
      rightNode.parent = parent;

      const promoteHl: HighlightMap = {};
      promoteHl[parent.id] = { node: "active", keys: { [parentInsertPos]: "promote" } };
      promoteHl[current.id] = { node: "active", keys: {} };
      promoteHl[rightNode.id] = { node: "active", keys: {} };
      yield {
        tree: cloneTree(currentRoot),
        highlights: promoteHl,
        message: `Promoted ${medianKey} to parent node`,
        metrics: computeMetrics(currentRoot, splits, merges),
      };
      current = parent;
    }
  }

  // Final state
  yield {
    tree: cloneTree(currentRoot),
    highlights: {},
    message: `Insert of ${key} complete`,
    metrics: computeMetrics(currentRoot, splits, merges),
  };
}

// B-Tree search with animation steps
function* searchGenerator(
  root: BTreeNode | null,
  key: number,
  metrics: TreeMetrics
): Generator<AnimationStep> {
  if (!root) {
    yield {
      tree: null,
      highlights: {},
      message: `Tree is empty, ${key} not found`,
      metrics,
    };
    return;
  }

  let currentNode: BTreeNode | null = root;

  while (currentNode) {
    const n: BTreeNode = currentNode;
    const hl: HighlightMap = {};
    hl[n.id] = { node: "search", keys: {} };
    let nextNode: BTreeNode | null = null;
    let found = false;

    for (let i = 0; i < n.keys.length; i++) {
      hl[n.id].keys[i] = "compare";
      yield {
        tree: cloneTree(root),
        highlights: { ...hl },
        message: `Comparing ${key} with ${n.keys[i]}`,
        metrics,
      };

      if (key === n.keys[i]) {
        const foundHl: HighlightMap = {};
        foundHl[n.id] = { node: "found", keys: { [i]: "found" } };
        yield {
          tree: cloneTree(root),
          highlights: foundHl,
          message: `Found ${key}!`,
          metrics,
        };
        found = true;
        break;
      }
      if (key < n.keys[i]) {
        nextNode = n.children.length > 0 ? n.children[i] : null;
        break;
      }
      if (i === n.keys.length - 1) {
        nextNode = n.children.length > 0 ? n.children[i + 1] : null;
      }
    }

    if (found) return;
    currentNode = nextNode;
  }

  yield {
    tree: cloneTree(root),
    highlights: {},
    message: `Key ${key} not found in tree`,
    metrics,
  };
}

// B-Tree delete with animation steps
function* deleteGenerator(
  root: BTreeNode | null,
  key: number,
  order: TreeOrder,
  metrics: TreeMetrics
): Generator<AnimationStep> {
  if (!root) {
    yield { tree: null, highlights: {}, message: `Tree is empty`, metrics };
    return;
  }

  let currentRoot = cloneTree(root)!;
  let splits = metrics.splits;
  let merges = metrics.merges;
  const minKeys = Math.ceil(order / 2) - 1;

  // Find the key
  function findKeyNode(node: BTreeNode, k: number): { node: BTreeNode; index: number } | null {
    for (let i = 0; i < node.keys.length; i++) {
      if (k === node.keys[i]) return { node, index: i };
      if (k < node.keys[i]) {
        if (node.children.length > 0) return findKeyNode(node.children[i], k);
        return null;
      }
    }
    if (node.children.length > 0) return findKeyNode(node.children[node.keys.length], k);
    return null;
  }

  // Search animation
  let searchNode: BTreeNode = currentRoot;
  let found = false;
  while (searchNode) {
    const hl: HighlightMap = {};
    hl[searchNode.id] = { node: "search", keys: {} };
    yield {
      tree: cloneTree(currentRoot),
      highlights: hl,
      message: `Searching for ${key} to delete`,
      metrics: computeMetrics(currentRoot, splits, merges),
    };

    let moved = false;
    for (let i = 0; i < searchNode.keys.length; i++) {
      if (key === searchNode.keys[i]) { found = true; moved = true; break; }
      if (key < searchNode.keys[i]) {
        if (searchNode.children.length > 0) { searchNode = searchNode.children[i]; moved = true; break; }
        moved = true;
        break;
      }
    }
    if (found) break;
    if (!moved) {
      if (searchNode.children.length > 0) {
        searchNode = searchNode.children[searchNode.keys.length];
      } else {
        break;
      }
    }
  }

  const result = findKeyNode(currentRoot, key);
  if (!result) {
    yield {
      tree: cloneTree(currentRoot),
      highlights: {},
      message: `Key ${key} not found in tree`,
      metrics: computeMetrics(currentRoot, splits, merges),
    };
    return;
  }

  const { node: keyNode, index: keyIndex } = result;

  if (keyNode.children.length === 0) {
    // Leaf node - simple removal
    const removeHl: HighlightMap = {};
    removeHl[keyNode.id] = { node: "active", keys: { [keyIndex]: "remove" } };
    yield {
      tree: cloneTree(currentRoot),
      highlights: removeHl,
      message: `Removing ${key} from leaf node`,
      metrics: computeMetrics(currentRoot, splits, merges),
    };

    keyNode.keys.splice(keyIndex, 1);

    // Fix underflow
    if (keyNode.keys.length < minKeys && keyNode.parent) {
      yield* fixUnderflow(keyNode, currentRoot);
    }
  } else {
    // Internal node - replace with predecessor
    let predecessor = keyNode.children[keyIndex];
    while (predecessor.children.length > 0) {
      predecessor = predecessor.children[predecessor.children.length - 1];
    }
    const predKey = predecessor.keys[predecessor.keys.length - 1];

    const replHl: HighlightMap = {};
    replHl[keyNode.id] = { node: "active", keys: { [keyIndex]: "remove" } };
    replHl[predecessor.id] = { node: "search", keys: { [predecessor.keys.length - 1]: "found" } };
    yield {
      tree: cloneTree(currentRoot),
      highlights: replHl,
      message: `Replacing ${key} with predecessor ${predKey}`,
      metrics: computeMetrics(currentRoot, splits, merges),
    };

    keyNode.keys[keyIndex] = predKey;
    predecessor.keys.pop();

    if (predecessor.keys.length < minKeys && predecessor.parent) {
      yield* fixUnderflow(predecessor, currentRoot);
    }
  }

  // Handle root with no keys
  if (currentRoot.keys.length === 0 && currentRoot.children.length > 0) {
    currentRoot = currentRoot.children[0];
    currentRoot.parent = null;
  } else if (currentRoot.keys.length === 0 && currentRoot.children.length === 0) {
    yield {
      tree: null,
      highlights: {},
      message: `Tree is now empty after deleting ${key}`,
      metrics: computeMetrics(null, splits, merges),
    };
    return;
  }

  yield {
    tree: cloneTree(currentRoot),
    highlights: {},
    message: `Delete of ${key} complete`,
    metrics: computeMetrics(currentRoot, splits, merges),
  };

  function* fixUnderflow(node: BTreeNode, root: BTreeNode): Generator<AnimationStep> {
    if (!node.parent) return;
    const parent = node.parent;
    const childIndex = parent.children.indexOf(node);

    // Try borrow from left sibling
    if (childIndex > 0) {
      const leftSibling = parent.children[childIndex - 1];
      if (leftSibling.keys.length > minKeys) {
        const hl: HighlightMap = {};
        hl[node.id] = { node: "merge", keys: {} };
        hl[leftSibling.id] = { node: "active", keys: {} };
        yield {
          tree: cloneTree(root),
          highlights: hl,
          message: `Redistributing from left sibling`,
          metrics: computeMetrics(root, splits, merges),
        };

        node.keys.unshift(parent.keys[childIndex - 1]);
        parent.keys[childIndex - 1] = leftSibling.keys.pop()!;
        if (leftSibling.children.length > 0) {
          const movedChild = leftSibling.children.pop()!;
          movedChild.parent = node;
          node.children.unshift(movedChild);
        }
        return;
      }
    }

    // Try borrow from right sibling
    if (childIndex < parent.children.length - 1) {
      const rightSibling = parent.children[childIndex + 1];
      if (rightSibling.keys.length > minKeys) {
        const hl: HighlightMap = {};
        hl[node.id] = { node: "merge", keys: {} };
        hl[rightSibling.id] = { node: "active", keys: {} };
        yield {
          tree: cloneTree(root),
          highlights: hl,
          message: `Redistributing from right sibling`,
          metrics: computeMetrics(root, splits, merges),
        };

        node.keys.push(parent.keys[childIndex]);
        parent.keys[childIndex] = rightSibling.keys.shift()!;
        if (rightSibling.children.length > 0) {
          const movedChild = rightSibling.children.shift()!;
          movedChild.parent = node;
          node.children.push(movedChild);
        }
        return;
      }
    }

    // Merge with sibling
    merges++;
    if (childIndex > 0) {
      // Merge with left sibling
      const leftSibling = parent.children[childIndex - 1];
      const hl: HighlightMap = {};
      hl[node.id] = { node: "merge", keys: {} };
      hl[leftSibling.id] = { node: "merge", keys: {} };
      yield {
        tree: cloneTree(root),
        highlights: hl,
        message: `Merging with left sibling`,
        metrics: computeMetrics(root, splits, merges),
      };

      leftSibling.keys.push(parent.keys[childIndex - 1]);
      leftSibling.keys.push(...node.keys);
      for (const child of node.children) {
        child.parent = leftSibling;
        leftSibling.children.push(child);
      }
      parent.keys.splice(childIndex - 1, 1);
      parent.children.splice(childIndex, 1);
    } else {
      // Merge with right sibling
      const rightSibling = parent.children[childIndex + 1];
      const hl: HighlightMap = {};
      hl[node.id] = { node: "merge", keys: {} };
      hl[rightSibling.id] = { node: "merge", keys: {} };
      yield {
        tree: cloneTree(root),
        highlights: hl,
        message: `Merging with right sibling`,
        metrics: computeMetrics(root, splits, merges),
      };

      node.keys.push(parent.keys[childIndex]);
      node.keys.push(...rightSibling.keys);
      for (const child of rightSibling.children) {
        child.parent = node;
        node.children.push(child);
      }
      parent.keys.splice(childIndex, 1);
      parent.children.splice(childIndex + 1, 1);
    }

    if (parent.keys.length < minKeys && parent.parent) {
      yield* fixUnderflow(parent, root);
    }
  }
}

// ============================================================================
// Layout computation
// ============================================================================

function computeLayout(
  root: BTreeNode | null,
  canvasWidth: number
): { positions: Map<string, NodePosition>; edges: { from: string; to: string }[] } {
  const positions = new Map<string, NodePosition>();
  const edges: { from: string; to: string }[] = [];
  if (!root) return { positions, edges };

  // Compute subtree widths bottom-up
  function getSubtreeWidth(node: BTreeNode): number {
    const nodeW = node.keys.length * NODE_KEY_WIDTH + NODE_PADDING * 2;
    if (node.children.length === 0) return nodeW;
    let childrenWidth = 0;
    for (let i = 0; i < node.children.length; i++) {
      if (i > 0) childrenWidth += MIN_NODE_GAP;
      childrenWidth += getSubtreeWidth(node.children[i]);
    }
    return Math.max(nodeW, childrenWidth);
  }

  function layoutNode(node: BTreeNode, left: number, right: number, level: number) {
    const nodeW = node.keys.length * NODE_KEY_WIDTH + NODE_PADDING * 2;
    const cx = (left + right) / 2;
    const x = cx - nodeW / 2;
    const y = 20 + level * LEVEL_HEIGHT;

    positions.set(node.id, { x, y, width: nodeW, nodeId: node.id });

    if (node.children.length > 0) {
      const totalChildWidth = node.children.reduce(
        (sum, child, i) => sum + getSubtreeWidth(child) + (i > 0 ? MIN_NODE_GAP : 0),
        0
      );

      let childLeft = cx - totalChildWidth / 2;
      for (const child of node.children) {
        const childW = getSubtreeWidth(child);
        layoutNode(child, childLeft, childLeft + childW, level + 1);
        edges.push({ from: node.id, to: child.id });
        childLeft += childW + MIN_NODE_GAP;
      }
    }
  }

  layoutNode(root, 0, canvasWidth, 0);
  return { positions, edges };
}

// ============================================================================
// Rendering sub-components
// ============================================================================

function BTreeNodeView({
  node,
  pos,
  highlight,
}: {
  node: BTreeNode;
  pos: NodePosition;
  highlight?: HighlightMap[string];
}) {
  const nodeHL = highlight?.node || "default";

  const bgColor =
    nodeHL === "active" ? "#1a2e1a" :
    nodeHL === "split" ? "#2e1a1a" :
    nodeHL === "merge" ? "#2e2a1a" :
    nodeHL === "found" ? "#1a2e2a" :
    nodeHL === "search" ? "#1a1a2e" :
    nodeHL === "promote" ? "#2a1a2e" :
    "#111118";

  const borderColor =
    nodeHL === "active" ? "#10b981" :
    nodeHL === "split" ? "#ef4444" :
    nodeHL === "merge" ? "#f59e0b" :
    nodeHL === "found" ? "#10b981" :
    nodeHL === "search" ? "#6366f1" :
    nodeHL === "promote" ? "#a855f7" :
    "#1e1e2e";

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Node background */}
      <rect
        x={pos.x}
        y={pos.y}
        width={pos.width}
        height={NODE_KEY_HEIGHT}
        rx={8}
        ry={8}
        fill={bgColor}
        stroke={borderColor}
        strokeWidth={1.5}
      />
      {/* Keys */}
      {node.keys.map((key, i) => {
        const kx = pos.x + NODE_PADDING + i * NODE_KEY_WIDTH;
        const keyHL = highlight?.keys?.[i];
        const keyBg =
          keyHL === "compare" ? "#6366f1" :
          keyHL === "found" ? "#10b981" :
          keyHL === "insert" ? "#06b6d4" :
          keyHL === "promote" ? "#a855f7" :
          keyHL === "remove" ? "#ef4444" :
          "transparent";

        return (
          <g key={i}>
            {/* Key cell background */}
            <rect
              x={kx}
              y={pos.y + 2}
              width={NODE_KEY_WIDTH - 2}
              height={NODE_KEY_HEIGHT - 4}
              rx={4}
              fill={keyBg}
              opacity={keyHL ? 0.3 : 0}
            />
            {/* Key divider */}
            {i > 0 && (
              <line
                x1={kx}
                y1={pos.y + 6}
                x2={kx}
                y2={pos.y + NODE_KEY_HEIGHT - 6}
                stroke={borderColor}
                strokeWidth={1}
                opacity={0.4}
              />
            )}
            {/* Key text */}
            <text
              x={kx + (NODE_KEY_WIDTH - 2) / 2}
              y={pos.y + NODE_KEY_HEIGHT / 2 + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={keyHL === "found" ? "#10b981" : keyHL === "remove" ? "#ef4444" : keyHL === "promote" ? "#a855f7" : "#e4e4e7"}
              fontSize={13}
              fontFamily="monospace"
              fontWeight={600}
            >
              {key}
            </text>
          </g>
        );
      })}
    </motion.g>
  );
}

function TreeEdge({
  fromPos,
  toPos,
}: {
  fromPos: NodePosition;
  toPos: NodePosition;
}) {
  const x1 = fromPos.x + fromPos.width / 2;
  const y1 = fromPos.y + NODE_KEY_HEIGHT;
  const x2 = toPos.x + toPos.width / 2;
  const y2 = toPos.y;

  return (
    <motion.line
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.4 }}
      transition={{ duration: 0.3 }}
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="#3f3f5e"
      strokeWidth={1.5}
    />
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function BTreesPage() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [order, setOrder] = useState<TreeOrder>(3);
  const [mode, setMode] = useState<OperationMode>("insert");
  const [inputValue, setInputValue] = useState("");
  const [tree, setTree] = useState<BTreeNode | null>(null);
  const [highlights, setHighlights] = useState<HighlightMap>({});
  const [statusMessage, setStatusMessage] = useState("B-Tree is empty. Insert a key to begin.");
  const [metrics, setMetrics] = useState<TreeMetrics>({
    nodeCount: 0, height: 0, totalKeys: 0, splits: 0, merges: 0,
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [activeScenario, setActiveScenario] = useState<ScenarioId | "">("");
  const [canvasWidth, setCanvasWidth] = useState(900);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const generatorRef = useRef<Generator<AnimationStep> | null>(null);
  const stepsQueueRef = useRef<AnimationStep[]>([]);
  const treeRef = useRef<BTreeNode | null>(null);
  const metricsRef = useRef<TreeMetrics>(metrics);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const scenarioQueueRef = useRef<{ ops: Array<{ type: OperationMode; key: number }>; index: number } | null>(null);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { treeRef.current = tree; }, [tree]);
  useEffect(() => { metricsRef.current = metrics; }, [metrics]);

  // Measure container width
  useEffect(() => {
    const measure = () => {
      if (svgContainerRef.current) {
        setCanvasWidth(svgContainerRef.current.clientWidth);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // ── Step logic ─────────────────────────────────────────────────────────────
  const stepForward = useCallback(() => {
    // If we have queued steps, consume one
    if (stepsQueueRef.current.length > 0) {
      const step = stepsQueueRef.current.shift()!;
      setTree(step.tree ? cloneTree(step.tree) : null);
      setHighlights(step.highlights);
      setStatusMessage(step.message);
      setMetrics(step.metrics);
      return true;
    }

    // If we have a generator, get next step
    if (generatorRef.current) {
      const result = generatorRef.current.next();
      if (!result.done) {
        const step = result.value;
        setTree(step.tree ? cloneTree(step.tree) : null);
        setHighlights(step.highlights);
        setStatusMessage(step.message);
        setMetrics(step.metrics);
        return true;
      }
      generatorRef.current = null;
    }

    // If scenario queue has more operations
    if (scenarioQueueRef.current && scenarioQueueRef.current.index < scenarioQueueRef.current.ops.length) {
      const op = scenarioQueueRef.current.ops[scenarioQueueRef.current.index];
      scenarioQueueRef.current.index++;

      if (op.type === "insert") {
        generatorRef.current = insertGenerator(treeRef.current, op.key, order, metricsRef.current);
      } else if (op.type === "delete") {
        generatorRef.current = deleteGenerator(treeRef.current, op.key, order, metricsRef.current);
      } else {
        generatorRef.current = searchGenerator(treeRef.current, op.key, metricsRef.current);
      }

      const result = generatorRef.current.next();
      if (!result.done) {
        const step = result.value;
        setTree(step.tree ? cloneTree(step.tree) : null);
        setHighlights(step.highlights);
        setStatusMessage(step.message);
        setMetrics(step.metrics);
        return true;
      }
      generatorRef.current = null;
      return true;
    }

    // Nothing left to do
    setIsPlaying(false);
    return false;
  }, [order]);

  // ── Animation loop ─────────────────────────────────────────────────────────
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(10, 200 / speedRef.current);
      if (timestamp - lastTickRef.current >= interval) {
        lastTickRef.current = timestamp;
        const active = stepForward();
        if (!active) return;
      }
      animationRef.current = requestAnimationFrame(animationLoop);
    },
    [stepForward]
  );

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    isPlayingRef.current = true;
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const handleStep = useCallback(() => {
    handlePause();
    stepForward();
  }, [handlePause, stepForward]);

  const handleReset = useCallback(() => {
    handlePause();
    nodeIdCounter = 0;
    setTree(null);
    setHighlights({});
    setStatusMessage("B-Tree is empty. Insert a key to begin.");
    setMetrics({ nodeCount: 0, height: 0, totalKeys: 0, splits: 0, merges: 0 });
    generatorRef.current = null;
    stepsQueueRef.current = [];
    scenarioQueueRef.current = null;
    setActiveScenario("");
  }, [handlePause]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // ── Manual operations ──────────────────────────────────────────────────────
  const handleManualOp = useCallback(() => {
    const val = parseInt(inputValue);
    if (isNaN(val)) return;
    setInputValue("");

    handlePause();

    if (mode === "insert") {
      generatorRef.current = insertGenerator(treeRef.current, val, order, metricsRef.current);
    } else if (mode === "delete") {
      generatorRef.current = deleteGenerator(treeRef.current, val, order, metricsRef.current);
    } else {
      generatorRef.current = searchGenerator(treeRef.current, val, metricsRef.current);
    }

    // Step once immediately
    stepForward();
  }, [inputValue, mode, order, handlePause, stepForward]);

  const handleRandomInsert = useCallback(() => {
    const val = Math.floor(Math.random() * 99) + 1;
    setInputValue(String(val));
    handlePause();
    generatorRef.current = insertGenerator(treeRef.current, val, order, metricsRef.current);
    stepForward();
  }, [order, handlePause, stepForward]);

  // ── Scenario selection ─────────────────────────────────────────────────────
  const handleScenario = useCallback(
    (id: ScenarioId) => {
      handleReset();
      setActiveScenario(id);

      let ops: Array<{ type: OperationMode; key: number }> = [];

      switch (id) {
        case "sequential":
          ops = SEQUENTIAL_VALUES.map((v) => ({ type: "insert" as OperationMode, key: v }));
          break;
        case "random":
          ops = RANDOM_VALUES.map((v) => ({ type: "insert" as OperationMode, key: v }));
          break;
        case "delete-merge":
          ops = [
            ...DELETE_BUILD.map((v) => ({ type: "insert" as OperationMode, key: v })),
            ...DELETE_KEYS.map((v) => ({ type: "delete" as OperationMode, key: v })),
          ];
          break;
        case "search-path":
          ops = [
            ...SEARCH_BUILD.map((v) => ({ type: "insert" as OperationMode, key: v })),
            ...SEARCH_KEYS.map((v) => ({ type: "search" as OperationMode, key: v })),
          ];
          break;
      }

      scenarioQueueRef.current = { ops, index: 0 };
    },
    [handleReset]
  );

  // Reset when order changes
  useEffect(() => {
    handleReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  // ── Layout computation ─────────────────────────────────────────────────────
  const { positions, edges } = computeLayout(tree, canvasWidth);
  const treeHeight = tree ? getHeight(tree) : 0;
  const svgHeight = Math.max(200, treeHeight * LEVEL_HEIGHT + 60);

  // Collect all nodes for rendering
  function collectNodes(node: BTreeNode | null): BTreeNode[] {
    if (!node) return [];
    const result = [node];
    for (const child of node.children) result.push(...collectNodes(child));
    return result;
  }
  const allNodes = collectNodes(tree);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: "#0a0a0f" }}>
      <Navbar />

      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* ── Header ──────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
            className="mb-6"
          >
            <div className="flex items-center gap-3 mb-2">
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-semibold"
                style={{
                  background: "rgba(16,185,129,0.1)",
                  color: "#10b981",
                  border: "1px solid rgba(16,185,129,0.2)",
                }}
              >
                4.5
              </span>
              <span className="text-xs text-[#71717a]">Algorithms & Data Structures</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              B-Trees & B+ Trees
            </h1>
            <p className="text-sm text-[#a1a1aa] max-w-2xl mt-2">
              Visualize how B-Trees maintain balance through splits and merges. Watch keys
              propagate upward during insertion and nodes consolidate during deletion, keeping
              the tree height-balanced for efficient disk-based access.
            </p>
          </motion.div>

          {/* ── Tree Order Selector + Mode ──────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex flex-wrap items-center gap-3 mb-4"
          >
            {/* Order selector */}
            <div className="flex items-center gap-1.5 text-xs text-[#71717a] mr-1">
              <TreePine size={14} />
              <span>Order</span>
            </div>
            {([3, 4, 5] as TreeOrder[]).map((o) => (
              <button
                key={o}
                onClick={() => setOrder(o)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                style={{
                  background: order === o ? "rgba(16,185,129,0.12)" : "#1e1e2e",
                  color: order === o ? "#10b981" : "#a1a1aa",
                  border: order === o ? "1px solid rgba(16,185,129,0.3)" : "1px solid transparent",
                }}
              >
                B-Tree (Order {o})
              </button>
            ))}

            <div className="w-px h-8 bg-[#1e1e2e] mx-1" />

            {/* Mode selector */}
            {(["insert", "delete", "search"] as OperationMode[]).map((m) => {
              const Icon = m === "insert" ? Plus : m === "delete" ? Trash2 : Search;
              const color = m === "insert" ? "#10b981" : m === "delete" ? "#ef4444" : "#6366f1";
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                  style={{
                    background: mode === m ? `${color}18` : "#1e1e2e",
                    color: mode === m ? color : "#a1a1aa",
                    border: mode === m ? `1px solid ${color}40` : "1px solid transparent",
                  }}
                >
                  <Icon size={12} />
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              );
            })}
          </motion.div>

          {/* ── Scenario Presets ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="flex flex-wrap items-center gap-2 mb-4"
          >
            <div className="flex items-center gap-1.5 text-xs text-[#71717a] mr-1">
              <Shuffle size={14} />
              <span>Presets</span>
            </div>
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => handleScenario(s.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                style={{
                  background: activeScenario === s.id ? "rgba(99,102,241,0.12)" : "#1e1e2e",
                  color: activeScenario === s.id ? "#6366f1" : "#a1a1aa",
                  border: activeScenario === s.id ? "1px solid rgba(99,102,241,0.3)" : "1px solid transparent",
                }}
                title={s.description}
              >
                {s.label}
              </button>
            ))}
          </motion.div>

          {/* ── Input Area ──────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="flex items-center gap-3 mb-4"
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleManualOp(); }}
                placeholder="Enter key..."
                className="w-32 px-3 py-2 rounded-lg text-sm font-mono bg-[#111118] border border-[#1e1e2e] text-white placeholder-[#71717a] focus:outline-none focus:border-[#6366f1] transition-colors"
              />
              <button
                onClick={handleManualOp}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                style={{
                  background: mode === "insert" ? "rgba(16,185,129,0.15)" : mode === "delete" ? "rgba(239,68,68,0.15)" : "rgba(99,102,241,0.15)",
                  color: mode === "insert" ? "#10b981" : mode === "delete" ? "#ef4444" : "#6366f1",
                  border: `1px solid ${mode === "insert" ? "rgba(16,185,129,0.3)" : mode === "delete" ? "rgba(239,68,68,0.3)" : "rgba(99,102,241,0.3)"}`,
                }}
              >
                {mode === "insert" && <Plus size={14} />}
                {mode === "delete" && <Trash2 size={14} />}
                {mode === "search" && <Search size={14} />}
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
              <button
                onClick={handleRandomInsert}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[#1e1e2e] text-[#a1a1aa] hover:text-white hover:bg-[#2a2a3e] transition-all duration-200"
              >
                <Shuffle size={12} />
                Random
              </button>
            </div>
          </motion.div>

          {/* ── Visualization ───────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="rounded-2xl overflow-hidden mb-4"
            style={{
              background: "#111118",
              border: "1px solid #1e1e2e",
              boxShadow: "0 0 0 1px rgba(16,185,129,0.03), 0 20px 50px -12px rgba(0,0,0,0.5)",
            }}
          >
            {/* Status bar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-2">
                <Info size={14} className="text-[#6366f1]" />
                <span className="text-xs text-[#a1a1aa] font-medium">{statusMessage}</span>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono text-[#71717a]">
                <span>Order: <span className="text-[#10b981]">{order}</span></span>
                <span>Max keys: <span className="text-[#06b6d4]">{order - 1}</span></span>
                <span>Min keys: <span className="text-[#f59e0b]">{Math.ceil(order / 2) - 1}</span></span>
              </div>
            </div>

            {/* SVG Canvas */}
            <div ref={svgContainerRef} className="w-full overflow-x-auto" style={{ minHeight: "250px" }}>
              <svg
                width={canvasWidth}
                height={svgHeight}
                viewBox={`0 0 ${canvasWidth} ${svgHeight}`}
                className="w-full"
              >
                {/* Grid background */}
                <defs>
                  <pattern id="btree-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e1e2e" strokeWidth="0.5" opacity="0.3" />
                  </pattern>
                </defs>
                <rect width={canvasWidth} height={svgHeight} fill="url(#btree-grid)" />

                {/* Edges */}
                {edges.map((edge) => {
                  const fromPos = positions.get(edge.from);
                  const toPos = positions.get(edge.to);
                  if (!fromPos || !toPos) return null;
                  return (
                    <TreeEdge
                      key={`${edge.from}-${edge.to}`}
                      fromPos={fromPos}
                      toPos={toPos}
                    />
                  );
                })}

                {/* Nodes */}
                {allNodes.map((node) => {
                  const pos = positions.get(node.id);
                  if (!pos) return null;
                  return (
                    <BTreeNodeView
                      key={node.id}
                      node={node}
                      pos={pos}
                      highlight={highlights[node.id]}
                    />
                  );
                })}

                {/* Empty state */}
                {!tree && (
                  <text
                    x={canvasWidth / 2}
                    y={svgHeight / 2}
                    textAnchor="middle"
                    fill="#71717a"
                    fontSize={14}
                    fontFamily="sans-serif"
                  >
                    Tree is empty. Insert a key to begin.
                  </text>
                )}
              </svg>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-5 px-4 py-2.5 border-t border-[#1e1e2e]">
              {[
                { color: "#6366f1", label: "Searching" },
                { color: "#06b6d4", label: "Inserting" },
                { color: "#ef4444", label: "Split/Remove" },
                { color: "#f59e0b", label: "Merge" },
                { color: "#10b981", label: "Found" },
                { color: "#a855f7", label: "Promote" },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: color, opacity: 0.6 }} />
                  <span className="text-[11px] text-[#71717a]">{label}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* ── Controls ────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <ModuleControls
              isPlaying={isPlaying}
              onPlay={handlePlay}
              onPause={handlePause}
              onStep={handleStep}
              onReset={handleReset}
              speed={speed}
              onSpeedChange={setSpeed}
              showMetrics={showMetrics}
              onToggleMetrics={() => setShowMetrics(!showMetrics)}
            />
          </motion.div>

          {/* ── Metrics ─────────────────────────────────────────────── */}
          <AnimatePresence>
            {showMetrics && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="flex flex-wrap gap-3 mt-4"
              >
                {[
                  { label: "Nodes", value: metrics.nodeCount, color: "#6366f1", icon: <Layers size={14} /> },
                  { label: "Height", value: metrics.height, color: "#06b6d4", icon: <ArrowUp size={14} /> },
                  { label: "Total Keys", value: metrics.totalKeys, color: "#10b981", icon: <Hash size={14} /> },
                  { label: "Splits", value: metrics.splits, color: "#ef4444", icon: <Split size={14} /> },
                  { label: "Merges", value: metrics.merges, color: "#f59e0b", icon: <Merge size={14} /> },
                ].map((metric) => (
                  <div
                    key={metric.label}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e]"
                  >
                    <span style={{ color: metric.color }}>{metric.icon}</span>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                        {metric.label}
                      </span>
                      <span className="text-sm font-mono font-semibold" style={{ color: metric.color }}>
                        {metric.value}
                      </span>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Info Panel ──────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-6 rounded-2xl overflow-hidden"
            style={{ background: "#111118", border: "1px solid #1e1e2e" }}
          >
            <div className="px-5 py-3.5 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-2">
                <Info size={14} className="text-[#10b981]" />
                <span className="text-sm font-semibold text-white">B-Tree Properties</span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-[#10b981] uppercase tracking-wider">Structure</h3>
                <ul className="space-y-1.5 text-xs text-[#a1a1aa]">
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span>Every node has at most <span className="text-[#06b6d4] font-mono">{order - 1}</span> keys</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span>Every non-root node has at least <span className="text-[#f59e0b] font-mono">{Math.ceil(order / 2) - 1}</span> keys</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span>All leaves are at the same depth</span>
                  </li>
                </ul>
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-[#ef4444] uppercase tracking-wider">Split Operation</h3>
                <ul className="space-y-1.5 text-xs text-[#a1a1aa]">
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span>When a node overflows (more than {order - 1} keys)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span>Median key is promoted to parent</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span>Node splits into two child nodes</span>
                  </li>
                </ul>
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-[#f59e0b] uppercase tracking-wider">Merge Operation</h3>
                <ul className="space-y-1.5 text-xs text-[#a1a1aa]">
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span>When a node underflows (fewer than {Math.ceil(order / 2) - 1} keys)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span>First tries to redistribute from a sibling</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#71717a] mt-0.5">-</span>
                    <span>If redistribution fails, merges with sibling</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Complexity table */}
            <div className="border-t border-[#1e1e2e]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1e1e2e]">
                    <th className="px-5 py-2.5 text-left font-medium text-[#71717a]">Operation</th>
                    <th className="px-5 py-2.5 text-left font-medium text-[#71717a]">Average</th>
                    <th className="px-5 py-2.5 text-left font-medium text-[#71717a]">Worst</th>
                    <th className="px-5 py-2.5 text-left font-medium text-[#71717a]">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { op: "Search", avg: "O(log n)", worst: "O(log n)", desc: "Binary search within each node" },
                    { op: "Insert", avg: "O(log n)", worst: "O(log n)", desc: "May require splits up to root" },
                    { op: "Delete", avg: "O(log n)", worst: "O(log n)", desc: "May require merges or redistributions" },
                  ].map((row) => (
                    <tr key={row.op} className="border-b border-[#1e1e2e]/50">
                      <td className="px-5 py-2.5 font-medium text-white">{row.op}</td>
                      <td className="px-5 py-2.5 font-mono text-[#10b981]">{row.avg}</td>
                      <td className="px-5 py-2.5 font-mono text-[#ef4444]">{row.worst}</td>
                      <td className="px-5 py-2.5 text-[#a1a1aa]">{row.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
