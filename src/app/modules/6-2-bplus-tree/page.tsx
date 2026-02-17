"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Plus,
  Trash2,
  Shuffle,
  Database,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Info,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ============================================================================
// B+ Tree Data Structure
// ============================================================================

interface BPlusNode {
  id: string;
  keys: number[];
  children: BPlusNode[];
  isLeaf: boolean;
  next: BPlusNode | null; // linked list for leaves
  parent: BPlusNode | null;
}

let nodeIdCounter = 0;
function newNodeId(): string {
  return `node-${++nodeIdCounter}`;
}

function createNode(isLeaf: boolean): BPlusNode {
  return {
    id: newNodeId(),
    keys: [],
    children: [],
    isLeaf,
    next: null,
    parent: null,
  };
}

function cloneTree(node: BPlusNode | null): BPlusNode | null {
  if (!node) return null;
  const cloned = createNode(node.isLeaf);
  cloned.keys = [...node.keys];
  cloned.children = node.children.map((child) => {
    const c = cloneTree(child)!;
    c.parent = cloned;
    return c;
  });
  // Rebuild leaf linked list
  if (cloned.isLeaf) {
    cloned.next = null; // will be patched below
  }
  return cloned;
}

function patchLeafLinks(root: BPlusNode | null) {
  if (!root) return;
  const leaves = getLeaves(root);
  for (let i = 0; i < leaves.length - 1; i++) {
    leaves[i].next = leaves[i + 1];
  }
  if (leaves.length > 0) leaves[leaves.length - 1].next = null;
}

function getLeaves(node: BPlusNode): BPlusNode[] {
  if (node.isLeaf) return [node];
  const result: BPlusNode[] = [];
  for (const child of node.children) {
    result.push(...getLeaves(child));
  }
  return result;
}

function getAllNodes(node: BPlusNode | null): BPlusNode[] {
  if (!node) return [];
  const result: BPlusNode[] = [node];
  for (const child of node.children) {
    result.push(...getAllNodes(child));
  }
  return result;
}

function getHeight(node: BPlusNode | null): number {
  if (!node) return 0;
  if (node.isLeaf) return 1;
  return 1 + getHeight(node.children[0]);
}

function countKeys(node: BPlusNode | null): number {
  if (!node) return 0;
  if (node.isLeaf) return node.keys.length;
  let count = 0;
  for (const child of node.children) {
    count += countKeys(child);
  }
  return count;
}

// ============================================================================
// B+ Tree Operations
// ============================================================================

class BPlusTree {
  root: BPlusNode | null = null;
  order: number;

  constructor(order: number) {
    this.order = order;
  }

  get maxKeys() {
    return this.order - 1;
  }
  get minKeys() {
    return Math.ceil(this.order / 2) - 1;
  }

  search(key: number): { node: BPlusNode; index: number; path: string[] } | null {
    const path: string[] = [];
    let current = this.root;
    while (current) {
      path.push(current.id);
      if (current.isLeaf) {
        const idx = current.keys.indexOf(key);
        if (idx !== -1) return { node: current, index: idx, path };
        return null;
      }
      let i = 0;
      while (i < current.keys.length && key >= current.keys[i]) {
        i++;
      }
      current = current.children[i];
    }
    return null;
  }

  searchPath(key: number): string[] {
    const path: string[] = [];
    let current = this.root;
    while (current) {
      path.push(current.id);
      if (current.isLeaf) break;
      let i = 0;
      while (i < current.keys.length && key >= current.keys[i]) {
        i++;
      }
      current = current.children[i];
    }
    return path;
  }

  findLeaf(key: number): BPlusNode | null {
    let current = this.root;
    while (current && !current.isLeaf) {
      let i = 0;
      while (i < current.keys.length && key >= current.keys[i]) {
        i++;
      }
      current = current.children[i];
    }
    return current;
  }

  insert(key: number): void {
    if (!this.root) {
      this.root = createNode(true);
      this.root.keys.push(key);
      return;
    }

    const leaf = this.findLeaf(key)!;

    // Check for duplicate
    if (leaf.keys.includes(key)) return;

    // Insert in sorted position
    let pos = 0;
    while (pos < leaf.keys.length && leaf.keys[pos] < key) pos++;
    leaf.keys.splice(pos, 0, key);

    // Split if overflow
    if (leaf.keys.length > this.maxKeys) {
      this.splitLeaf(leaf);
    }
  }

  private splitLeaf(leaf: BPlusNode): void {
    const mid = Math.ceil(leaf.keys.length / 2);
    const newLeaf = createNode(true);

    newLeaf.keys = leaf.keys.splice(mid);
    newLeaf.next = leaf.next;
    leaf.next = newLeaf;

    const pushUpKey = newLeaf.keys[0];

    if (!leaf.parent) {
      const newRoot = createNode(false);
      newRoot.keys.push(pushUpKey);
      newRoot.children.push(leaf, newLeaf);
      leaf.parent = newRoot;
      newLeaf.parent = newRoot;
      this.root = newRoot;
    } else {
      this.insertInParent(leaf, pushUpKey, newLeaf);
    }
  }

  private insertInParent(
    left: BPlusNode,
    key: number,
    right: BPlusNode
  ): void {
    const parent = left.parent!;
    const idx = parent.children.indexOf(left);

    parent.keys.splice(idx, 0, key);
    parent.children.splice(idx + 1, 0, right);
    right.parent = parent;

    if (parent.keys.length > this.maxKeys) {
      this.splitInternal(parent);
    }
  }

  private splitInternal(node: BPlusNode): void {
    const mid = Math.floor(node.keys.length / 2);
    const pushUpKey = node.keys[mid];

    const newNode = createNode(false);
    newNode.keys = node.keys.splice(mid + 1);
    node.keys.splice(mid); // remove the pushed-up key

    newNode.children = node.children.splice(mid + 1);
    for (const child of newNode.children) {
      child.parent = newNode;
    }

    if (!node.parent) {
      const newRoot = createNode(false);
      newRoot.keys.push(pushUpKey);
      newRoot.children.push(node, newNode);
      node.parent = newRoot;
      newNode.parent = newRoot;
      this.root = newRoot;
    } else {
      this.insertInParent(node, pushUpKey, newNode);
    }
  }

  delete(key: number): boolean {
    if (!this.root) return false;

    const leaf = this.findLeaf(key);
    if (!leaf) return false;

    const idx = leaf.keys.indexOf(key);
    if (idx === -1) return false;

    leaf.keys.splice(idx, 1);

    // If root is leaf
    if (leaf === this.root) {
      if (leaf.keys.length === 0) this.root = null;
      return true;
    }

    // Check underflow
    if (leaf.keys.length < this.minKeys) {
      this.fixLeafUnderflow(leaf);
    } else {
      // Update parent keys if needed (first key in leaf might have changed)
      this.updateParentKeys(leaf);
    }

    return true;
  }

  private updateParentKeys(node: BPlusNode): void {
    let current = node;
    while (current.parent) {
      const parent = current.parent;
      const idx = parent.children.indexOf(current);
      if (idx > 0 && current.isLeaf) {
        parent.keys[idx - 1] = current.keys[0];
      }
      current = parent;
    }
  }

  private fixLeafUnderflow(leaf: BPlusNode): void {
    const parent = leaf.parent!;
    const idx = parent.children.indexOf(leaf);

    // Try borrow from left sibling
    if (idx > 0) {
      const leftSibling = parent.children[idx - 1];
      if (leftSibling.keys.length > this.minKeys) {
        const borrowed = leftSibling.keys.pop()!;
        leaf.keys.unshift(borrowed);
        parent.keys[idx - 1] = leaf.keys[0];
        return;
      }
    }

    // Try borrow from right sibling
    if (idx < parent.children.length - 1) {
      const rightSibling = parent.children[idx + 1];
      if (rightSibling.keys.length > this.minKeys) {
        const borrowed = rightSibling.keys.shift()!;
        leaf.keys.push(borrowed);
        parent.keys[idx] = rightSibling.keys[0];
        return;
      }
    }

    // Merge with sibling
    if (idx > 0) {
      // Merge with left sibling
      const leftSibling = parent.children[idx - 1];
      leftSibling.keys.push(...leaf.keys);
      leftSibling.next = leaf.next;
      parent.keys.splice(idx - 1, 1);
      parent.children.splice(idx, 1);
    } else {
      // Merge with right sibling
      const rightSibling = parent.children[idx + 1];
      leaf.keys.push(...rightSibling.keys);
      leaf.next = rightSibling.next;
      parent.keys.splice(idx, 1);
      parent.children.splice(idx + 1, 1);
    }

    // Fix parent underflow
    if (parent === this.root) {
      if (parent.keys.length === 0) {
        this.root = parent.children[0];
        this.root.parent = null;
      }
    } else if (parent.keys.length < this.minKeys) {
      this.fixInternalUnderflow(parent);
    }
  }

  private fixInternalUnderflow(node: BPlusNode): void {
    const parent = node.parent!;
    const idx = parent.children.indexOf(node);

    // Try borrow from left sibling
    if (idx > 0) {
      const leftSibling = parent.children[idx - 1];
      if (leftSibling.keys.length > this.minKeys) {
        node.keys.unshift(parent.keys[idx - 1]);
        parent.keys[idx - 1] = leftSibling.keys.pop()!;
        const movedChild = leftSibling.children.pop()!;
        movedChild.parent = node;
        node.children.unshift(movedChild);
        return;
      }
    }

    // Try borrow from right sibling
    if (idx < parent.children.length - 1) {
      const rightSibling = parent.children[idx + 1];
      if (rightSibling.keys.length > this.minKeys) {
        node.keys.push(parent.keys[idx]);
        parent.keys[idx] = rightSibling.keys.shift()!;
        const movedChild = rightSibling.children.shift()!;
        movedChild.parent = node;
        node.children.push(movedChild);
        return;
      }
    }

    // Merge
    if (idx > 0) {
      const leftSibling = parent.children[idx - 1];
      leftSibling.keys.push(parent.keys[idx - 1]);
      leftSibling.keys.push(...node.keys);
      for (const child of node.children) {
        child.parent = leftSibling;
      }
      leftSibling.children.push(...node.children);
      parent.keys.splice(idx - 1, 1);
      parent.children.splice(idx, 1);
    } else {
      const rightSibling = parent.children[idx + 1];
      node.keys.push(parent.keys[idx]);
      node.keys.push(...rightSibling.keys);
      for (const child of rightSibling.children) {
        child.parent = node;
      }
      node.children.push(...rightSibling.children);
      parent.keys.splice(idx, 1);
      parent.children.splice(idx + 1, 1);
    }

    if (parent === this.root) {
      if (parent.keys.length === 0) {
        this.root = parent.children[0];
        this.root.parent = null;
      }
    } else if (parent.keys.length < this.minKeys) {
      this.fixInternalUnderflow(parent);
    }
  }

  rangeQuery(low: number, high: number): { keys: number[]; leafIds: string[] } {
    const result: number[] = [];
    const leafIds: string[] = [];
    let leaf = this.findLeaf(low);

    while (leaf) {
      let added = false;
      for (const key of leaf.keys) {
        if (key >= low && key <= high) {
          result.push(key);
          added = true;
        }
        if (key > high) return { keys: result, leafIds };
      }
      if (added) leafIds.push(leaf.id);
      leaf = leaf.next;
    }

    return { keys: result, leafIds };
  }

  deepClone(): BPlusTree {
    const tree = new BPlusTree(this.order);
    tree.root = cloneTree(this.root);
    if (tree.root) patchLeafLinks(tree.root);
    return tree;
  }
}

// ============================================================================
// Layout calculation
// ============================================================================

interface NodeLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  keys: number[];
  isLeaf: boolean;
  children: string[];
  nextLeafId: string | null;
}

const NODE_HEIGHT = 40;
const KEY_WIDTH = 40;
const NODE_PADDING = 8;
const LEVEL_GAP = 80;
const NODE_GAP = 20;

function calculateNodeWidth(keyCount: number): number {
  return Math.max(KEY_WIDTH, keyCount * KEY_WIDTH + NODE_PADDING * 2);
}

function computeLayout(root: BPlusNode | null): Map<string, NodeLayout> {
  const layouts = new Map<string, NodeLayout>();
  if (!root) return layouts;

  // Collect nodes by level
  const levels: BPlusNode[][] = [];
  let currentLevel = [root];
  while (currentLevel.length > 0) {
    levels.push(currentLevel);
    const nextLevel: BPlusNode[] = [];
    for (const node of currentLevel) {
      if (!node.isLeaf) {
        nextLevel.push(...node.children);
      }
    }
    currentLevel = nextLevel;
  }

  // Bottom-up: compute widths and positions
  const subtreeWidths = new Map<string, number>();

  function computeSubtreeWidth(node: BPlusNode): number {
    const nodeW = calculateNodeWidth(node.keys.length);
    if (node.isLeaf) {
      subtreeWidths.set(node.id, nodeW);
      return nodeW;
    }
    let childrenTotalWidth = 0;
    for (let i = 0; i < node.children.length; i++) {
      if (i > 0) childrenTotalWidth += NODE_GAP;
      childrenTotalWidth += computeSubtreeWidth(node.children[i]);
    }
    const w = Math.max(nodeW, childrenTotalWidth);
    subtreeWidths.set(node.id, w);
    return w;
  }

  computeSubtreeWidth(root);

  // Top-down: assign positions
  function assignPositions(node: BPlusNode, x: number, y: number) {
    const nodeW = calculateNodeWidth(node.keys.length);
    const subtreeW = subtreeWidths.get(node.id)!;
    const nodeX = x + (subtreeW - nodeW) / 2;

    layouts.set(node.id, {
      id: node.id,
      x: nodeX,
      y,
      width: nodeW,
      height: NODE_HEIGHT,
      keys: [...node.keys],
      isLeaf: node.isLeaf,
      children: node.children.map((c) => c.id),
      nextLeafId: node.isLeaf && node.next ? node.next.id : null,
    });

    if (!node.isLeaf) {
      let childX = x;
      for (const child of node.children) {
        const childW = subtreeWidths.get(child.id)!;
        assignPositions(child, childX, y + LEVEL_GAP);
        childX += childW + NODE_GAP;
      }
    }
  }

  assignPositions(root, 0, 0);

  return layouts;
}

// ============================================================================
// Animation Step Types
// ============================================================================

type AnimStepType =
  | "highlight-node"
  | "highlight-path"
  | "insert-key"
  | "delete-key"
  | "split"
  | "merge"
  | "found"
  | "not-found"
  | "range-highlight"
  | "complete";

interface AnimStep {
  type: AnimStepType;
  nodeIds: string[];
  key?: number;
  message: string;
  treeSnapshot?: BPlusTree;
  highlightKeys?: Map<string, number[]>;
}

// ============================================================================
// Main Component
// ============================================================================

export default function BPlusTreePage() {
  const [order, setOrder] = useState(4);
  const [tree, setTree] = useState<BPlusTree>(() => new BPlusTree(4));
  const [layouts, setLayouts] = useState<Map<string, NodeLayout>>(new Map());

  const [insertValue, setInsertValue] = useState("");
  const [deleteValue, setDeleteValue] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [rangeLow, setRangeLow] = useState("");
  const [rangeHigh, setRangeHigh] = useState("");

  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [operationCount, setOperationCount] = useState(0);

  // Animation state
  const [animSteps, setAnimSteps] = useState<AnimStep[]>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(-1);
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());
  const [pathNodes, setPathNodes] = useState<Set<string>>(new Set());
  const [flashGreen, setFlashGreen] = useState<Set<string>>(new Set());
  const [flashRed, setFlashRed] = useState<Set<string>>(new Set());
  const [rangeHighlightNodes, setRangeHighlightNodes] = useState<Set<string>>(new Set());
  const [statusMessage, setStatusMessage] = useState("");

  // SVG pan/zoom
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 900, h: 500 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [zoomLevel, setZoomLevel] = useState(1);

  const playIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recompute layout when tree changes
  useEffect(() => {
    const newLayouts = computeLayout(tree.root);
    setLayouts(newLayouts);

    // Auto-fit viewBox
    if (newLayouts.size > 0) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      newLayouts.forEach((l) => {
        minX = Math.min(minX, l.x);
        minY = Math.min(minY, l.y);
        maxX = Math.max(maxX, l.x + l.width);
        maxY = Math.max(maxY, l.y + l.height);
      });
      const padding = 60;
      setViewBox({
        x: minX - padding,
        y: minY - padding,
        w: maxX - minX + padding * 2,
        h: maxY - minY + padding * 2,
      });
    }
  }, [tree]);

  // Clear highlights
  const clearHighlights = useCallback(() => {
    setHighlightedNodes(new Set());
    setPathNodes(new Set());
    setFlashGreen(new Set());
    setFlashRed(new Set());
    setRangeHighlightNodes(new Set());
    setStatusMessage("");
  }, []);

  // Execute a single animation step
  const executeStep = useCallback(
    (step: AnimStep) => {
      clearHighlights();
      setStatusMessage(step.message);

      if (step.treeSnapshot) {
        const snapshot = step.treeSnapshot.deepClone();
        setTree(snapshot);
      }

      switch (step.type) {
        case "highlight-node":
          setHighlightedNodes(new Set(step.nodeIds));
          break;
        case "highlight-path":
          setPathNodes(new Set(step.nodeIds));
          break;
        case "insert-key":
          setFlashGreen(new Set(step.nodeIds));
          break;
        case "delete-key":
          setFlashRed(new Set(step.nodeIds));
          break;
        case "split":
          setHighlightedNodes(new Set(step.nodeIds));
          break;
        case "merge":
          setHighlightedNodes(new Set(step.nodeIds));
          break;
        case "found":
          setFlashGreen(new Set(step.nodeIds));
          break;
        case "not-found":
          setFlashRed(new Set(step.nodeIds));
          break;
        case "range-highlight":
          setRangeHighlightNodes(new Set(step.nodeIds));
          break;
        case "complete":
          break;
      }
    },
    [clearHighlights]
  );

  // Advance to next step
  const advanceStep = useCallback(() => {
    if (animSteps.length === 0) return;
    setCurrentStepIdx((prev) => {
      const next = prev + 1;
      if (next >= animSteps.length) {
        setIsPlaying(false);
        return prev;
      }
      executeStep(animSteps[next]);
      return next;
    });
  }, [animSteps, executeStep]);

  // Auto-play
  useEffect(() => {
    if (isPlaying && currentStepIdx < animSteps.length - 1) {
      const delay = Math.max(200, 1000 / speed);
      playIntervalRef.current = setTimeout(() => {
        advanceStep();
      }, delay);
    } else if (currentStepIdx >= animSteps.length - 1) {
      setIsPlaying(false);
    }
    return () => {
      if (playIntervalRef.current) clearTimeout(playIntervalRef.current);
    };
  }, [isPlaying, currentStepIdx, animSteps.length, speed, advanceStep]);

  // Build animation steps for INSERT
  const buildInsertSteps = useCallback(
    (key: number, treeCopy: BPlusTree): AnimStep[] => {
      const steps: AnimStep[] = [];
      const path = treeCopy.searchPath(key);

      // Traverse path
      for (let i = 0; i < path.length; i++) {
        steps.push({
          type: "highlight-path",
          nodeIds: path.slice(0, i + 1),
          key,
          message: `Traversing to find position for key ${key}...`,
        });
      }

      // Check for duplicate
      const leaf = treeCopy.findLeaf(key);
      if (leaf && leaf.keys.includes(key)) {
        steps.push({
          type: "not-found",
          nodeIds: [leaf.id],
          message: `Key ${key} already exists in tree`,
        });
        return steps;
      }

      // Perform insert
      const beforeInsert = treeCopy.deepClone();
      treeCopy.insert(key);

      // Find the leaf the key ended up in
      const insertedLeaf = treeCopy.findLeaf(key);
      const needsSplit = beforeInsert.findLeaf(key);
      const oldLeafKeyCount = needsSplit ? needsSplit.keys.length : 0;

      if (oldLeafKeyCount >= treeCopy.maxKeys) {
        steps.push({
          type: "insert-key",
          nodeIds: insertedLeaf ? [insertedLeaf.id] : [],
          key,
          message: `Inserted ${key}, node overflow! Splitting...`,
          treeSnapshot: treeCopy,
        });
        const splitNodes = getAllNodes(treeCopy.root).map((n) => n.id);
        steps.push({
          type: "split",
          nodeIds: splitNodes.slice(0, 3),
          message: `Split complete. Key propagated up.`,
          treeSnapshot: treeCopy,
        });
      } else {
        steps.push({
          type: "insert-key",
          nodeIds: insertedLeaf ? [insertedLeaf.id] : [],
          key,
          message: `Inserted key ${key} into leaf node`,
          treeSnapshot: treeCopy,
        });
      }

      steps.push({
        type: "complete",
        nodeIds: [],
        message: `Insert of ${key} complete`,
        treeSnapshot: treeCopy,
      });

      return steps;
    },
    []
  );

  // Build animation steps for DELETE
  const buildDeleteSteps = useCallback(
    (key: number, treeCopy: BPlusTree): AnimStep[] => {
      const steps: AnimStep[] = [];
      const path = treeCopy.searchPath(key);

      for (let i = 0; i < path.length; i++) {
        steps.push({
          type: "highlight-path",
          nodeIds: path.slice(0, i + 1),
          key,
          message: `Searching for key ${key} to delete...`,
        });
      }

      const leaf = treeCopy.findLeaf(key);
      if (!leaf || !leaf.keys.includes(key)) {
        steps.push({
          type: "not-found",
          nodeIds: leaf ? [leaf.id] : [],
          message: `Key ${key} not found in tree`,
        });
        return steps;
      }

      steps.push({
        type: "delete-key",
        nodeIds: [leaf.id],
        key,
        message: `Found key ${key}, deleting...`,
      });

      treeCopy.delete(key);

      steps.push({
        type: "complete",
        nodeIds: [],
        message: `Delete of ${key} complete`,
        treeSnapshot: treeCopy,
      });

      return steps;
    },
    []
  );

  // Build animation steps for SEARCH
  const buildSearchSteps = useCallback(
    (key: number, treeCopy: BPlusTree): AnimStep[] => {
      const steps: AnimStep[] = [];
      const path = treeCopy.searchPath(key);

      for (let i = 0; i < path.length; i++) {
        steps.push({
          type: "highlight-path",
          nodeIds: path.slice(0, i + 1),
          message:
            i < path.length - 1
              ? `Comparing at node, following pointer down...`
              : `Reached leaf node, scanning keys...`,
        });
      }

      const result = treeCopy.search(key);
      if (result) {
        steps.push({
          type: "found",
          nodeIds: [result.node.id],
          key,
          message: `Key ${key} found!`,
        });
      } else {
        const leaf = treeCopy.findLeaf(key);
        steps.push({
          type: "not-found",
          nodeIds: leaf ? [leaf.id] : [],
          message: `Key ${key} not found in tree`,
        });
      }

      return steps;
    },
    []
  );

  // Build animation steps for RANGE QUERY
  const buildRangeSteps = useCallback(
    (low: number, high: number, treeCopy: BPlusTree): AnimStep[] => {
      const steps: AnimStep[] = [];
      const path = treeCopy.searchPath(low);

      for (let i = 0; i < path.length; i++) {
        steps.push({
          type: "highlight-path",
          nodeIds: path.slice(0, i + 1),
          message: `Finding start leaf for range [${low}, ${high}]...`,
        });
      }

      const result = treeCopy.rangeQuery(low, high);

      if (result.keys.length > 0) {
        steps.push({
          type: "range-highlight",
          nodeIds: result.leafIds,
          message: `Range [${low}, ${high}]: found ${result.keys.length} keys: [${result.keys.join(", ")}]`,
        });
      } else {
        steps.push({
          type: "not-found",
          nodeIds: [],
          message: `No keys found in range [${low}, ${high}]`,
        });
      }

      return steps;
    },
    []
  );

  // Start an animated operation
  const startAnimation = useCallback(
    (steps: AnimStep[]) => {
      clearHighlights();
      setAnimSteps(steps);
      setCurrentStepIdx(-1);
      if (steps.length > 0) {
        setCurrentStepIdx(0);
        executeStep(steps[0]);
        setIsPlaying(true);
      }
    },
    [clearHighlights, executeStep]
  );

  // Handlers
  const handleInsert = useCallback(() => {
    const val = parseInt(insertValue);
    if (isNaN(val)) return;
    const treeCopy = tree.deepClone();
    const steps = buildInsertSteps(val, treeCopy);
    startAnimation(steps);
    setInsertValue("");
    setOperationCount((c) => c + 1);
  }, [insertValue, tree, buildInsertSteps, startAnimation]);

  const handleDelete = useCallback(() => {
    const val = parseInt(deleteValue);
    if (isNaN(val)) return;
    const treeCopy = tree.deepClone();
    const steps = buildDeleteSteps(val, treeCopy);
    startAnimation(steps);
    setDeleteValue("");
    setOperationCount((c) => c + 1);
  }, [deleteValue, tree, buildDeleteSteps, startAnimation]);

  const handleSearch = useCallback(() => {
    const val = parseInt(searchValue);
    if (isNaN(val)) return;
    const steps = buildSearchSteps(val, tree);
    startAnimation(steps);
    setSearchValue("");
    setOperationCount((c) => c + 1);
  }, [searchValue, tree, buildSearchSteps, startAnimation]);

  const handleRangeQuery = useCallback(() => {
    const low = parseInt(rangeLow);
    const high = parseInt(rangeHigh);
    if (isNaN(low) || isNaN(high) || low > high) return;
    const steps = buildRangeSteps(low, high, tree);
    startAnimation(steps);
    setRangeLow("");
    setRangeHigh("");
    setOperationCount((c) => c + 1);
  }, [rangeLow, rangeHigh, tree, buildRangeSteps, startAnimation]);

  const handleRandomInsert = useCallback(() => {
    const treeCopy = tree.deepClone();
    const count = 5;
    const existing = new Set<number>();
    if (treeCopy.root) {
      getLeaves(treeCopy.root).forEach((leaf) => {
        leaf.keys.forEach((k) => existing.add(k));
      });
    }
    for (let i = 0; i < count; i++) {
      let val: number;
      do {
        val = Math.floor(Math.random() * 100) + 1;
      } while (existing.has(val));
      existing.add(val);
      treeCopy.insert(val);
    }
    setTree(treeCopy);
    clearHighlights();
    setStatusMessage(`Inserted ${count} random keys`);
    setOperationCount((c) => c + count);
  }, [tree, clearHighlights]);

  const handlePreset = useCallback(
    (preset: "empty" | "small" | "large") => {
      nodeIdCounter = 0;
      const newTree = new BPlusTree(order);
      let keys: number[] = [];

      if (preset === "small") {
        keys = [10, 20, 30, 40, 50, 5, 15, 25, 35, 45];
      } else if (preset === "large") {
        const vals = new Set<number>();
        while (vals.size < 30) vals.add(Math.floor(Math.random() * 99) + 1);
        keys = Array.from(vals);
      }

      for (const k of keys) newTree.insert(k);
      setTree(newTree);
      clearHighlights();
      setAnimSteps([]);
      setCurrentStepIdx(-1);
      setOperationCount(0);
      setStatusMessage(
        preset === "empty"
          ? "Tree cleared"
          : `Loaded ${keys.length} keys`
      );
    },
    [order, clearHighlights]
  );

  const handleOrderChange = useCallback(
    (newOrder: number) => {
      setOrder(newOrder);
      nodeIdCounter = 0;
      const newTree = new BPlusTree(newOrder);
      // Re-insert existing keys
      if (tree.root) {
        const allKeys = getLeaves(tree.root).flatMap((l) => l.keys);
        for (const k of allKeys) newTree.insert(k);
      }
      setTree(newTree);
      clearHighlights();
      setStatusMessage(`Order changed to ${newOrder}`);
    },
    [tree, clearHighlights]
  );

  // ModuleControls handlers
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleStep = useCallback(() => {
    setIsPlaying(false);
    advanceStep();
  }, [advanceStep]);
  const handleReset = useCallback(() => {
    setIsPlaying(false);
    setAnimSteps([]);
    setCurrentStepIdx(-1);
    clearHighlights();
  }, [clearHighlights]);

  // Pan/Zoom handlers
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      const newZoom = Math.max(0.2, Math.min(5, zoomLevel * (1 / factor)));
      setZoomLevel(newZoom);
      setViewBox((vb) => {
        const cx = vb.x + vb.w / 2;
        const cy = vb.y + vb.h / 2;
        const newW = vb.w * factor;
        const newH = vb.h * factor;
        return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
      });
    },
    [zoomLevel]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 0) {
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY });
      }
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning || !svgRef.current) return;
      const svg = svgRef.current;
      const rect = svg.getBoundingClientRect();
      const scaleX = viewBox.w / rect.width;
      const scaleY = viewBox.h / rect.height;
      const dx = (e.clientX - panStart.x) * scaleX;
      const dy = (e.clientY - panStart.y) * scaleY;
      setViewBox((vb) => ({ ...vb, x: vb.x - dx, y: vb.y - dy }));
      setPanStart({ x: e.clientX, y: e.clientY });
    },
    [isPanning, panStart, viewBox.w, viewBox.h]
  );

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  const handleZoomIn = useCallback(() => {
    setViewBox((vb) => {
      const cx = vb.x + vb.w / 2;
      const cy = vb.y + vb.h / 2;
      const newW = vb.w * 0.8;
      const newH = vb.h * 0.8;
      return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
    });
    setZoomLevel((z) => Math.min(5, z * 1.25));
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewBox((vb) => {
      const cx = vb.x + vb.w / 2;
      const cy = vb.y + vb.h / 2;
      const newW = vb.w * 1.25;
      const newH = vb.h * 1.25;
      return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
    });
    setZoomLevel((z) => Math.max(0.2, z * 0.8));
  }, []);

  const handleFitView = useCallback(() => {
    if (layouts.size === 0) return;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    layouts.forEach((l) => {
      minX = Math.min(minX, l.x);
      minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + l.width);
      maxY = Math.max(maxY, l.y + l.height);
    });
    const padding = 60;
    setViewBox({
      x: minX - padding,
      y: minY - padding,
      w: maxX - minX + padding * 2,
      h: maxY - minY + padding * 2,
    });
    setZoomLevel(1);
  }, [layouts]);

  // Computed metrics
  const metrics = useMemo(() => {
    if (!tree.root) {
      return { height: 0, totalKeys: 0, nodeCount: 0, internalNodes: 0, leafNodes: 0, fillFactor: 0 };
    }
    const allNodes = getAllNodes(tree.root);
    const leafNodes = allNodes.filter((n) => n.isLeaf);
    const internalNodes = allNodes.filter((n) => !n.isLeaf);
    const totalKeys = countKeys(tree.root);
    const maxKeysPerNode = tree.maxKeys;
    const avgFill =
      allNodes.length > 0
        ? allNodes.reduce((sum, n) => sum + n.keys.length, 0) / (allNodes.length * maxKeysPerNode)
        : 0;

    return {
      height: getHeight(tree.root),
      totalKeys,
      nodeCount: allNodes.length,
      internalNodes: internalNodes.length,
      leafNodes: leafNodes.length,
      fillFactor: avgFill,
    };
  }, [tree]);

  // Render edges
  const renderEdges = useMemo(() => {
    const edges: React.ReactElement[] = [];
    layouts.forEach((layout) => {
      // Child edges
      for (const childId of layout.children) {
        const childLayout = layouts.get(childId);
        if (!childLayout) continue;

        const x1 = layout.x + layout.width / 2;
        const y1 = layout.y + layout.height;
        const x2 = childLayout.x + childLayout.width / 2;
        const y2 = childLayout.y;

        const isInPath =
          pathNodes.has(layout.id) && pathNodes.has(childId);
        const isHighlighted =
          highlightedNodes.has(layout.id) || highlightedNodes.has(childId);

        edges.push(
          <motion.line
            key={`edge-${layout.id}-${childId}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={
              isInPath
                ? "#06b6d4"
                : isHighlighted
                ? "#6366f1"
                : "#2a2a3e"
            }
            strokeWidth={isInPath ? 2.5 : isHighlighted ? 2 : 1.5}
            strokeOpacity={isInPath ? 1 : isHighlighted ? 0.9 : 0.6}
            initial={false}
            animate={{
              x1,
              y1,
              x2,
              y2,
              stroke: isInPath
                ? "#06b6d4"
                : isHighlighted
                ? "#6366f1"
                : "#2a2a3e",
            }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
          />
        );
      }

      // Leaf linked-list edge
      if (layout.nextLeafId) {
        const nextLayout = layouts.get(layout.nextLeafId);
        if (nextLayout) {
          const x1 = layout.x + layout.width;
          const y1 = layout.y + layout.height / 2;
          const x2 = nextLayout.x;
          const y2 = nextLayout.y + nextLayout.height / 2;

          const isRange =
            rangeHighlightNodes.has(layout.id) &&
            rangeHighlightNodes.has(layout.nextLeafId);

          edges.push(
            <motion.line
              key={`leaf-link-${layout.id}-${layout.nextLeafId}`}
              x1={x1 + 4}
              y1={y1}
              x2={x2 - 4}
              y2={y2}
              stroke={isRange ? "#f59e0b" : "#6366f1"}
              strokeWidth={isRange ? 2 : 1.5}
              strokeDasharray={isRange ? "none" : "6 3"}
              strokeOpacity={isRange ? 1 : 0.4}
              initial={false}
              animate={{
                x1: x1 + 4,
                y1,
                x2: x2 - 4,
                y2,
              }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
            />
          );
        }
      }
    });
    return edges;
  }, [layouts, pathNodes, highlightedNodes, rangeHighlightNodes]);

  // Render nodes
  const renderNodes = useMemo(() => {
    const nodes: React.ReactElement[] = [];
    layouts.forEach((layout) => {
      const isHighlighted = highlightedNodes.has(layout.id);
      const isPath = pathNodes.has(layout.id);
      const isGreen = flashGreen.has(layout.id);
      const isRed = flashRed.has(layout.id);
      const isRange = rangeHighlightNodes.has(layout.id);

      let borderColor = layout.isLeaf ? "#6366f1" : "#2a2a3e";
      let glowFilter = "";
      let bgColor = layout.isLeaf ? "#141420" : "#1e1e2e";

      if (isPath) {
        borderColor = "#06b6d4";
        glowFilter = "url(#glowCyan)";
      }
      if (isHighlighted) {
        borderColor = "#6366f1";
        glowFilter = "url(#glowPrimary)";
      }
      if (isGreen) {
        borderColor = "#10b981";
        glowFilter = "url(#glowGreen)";
        bgColor = "#0a1f1a";
      }
      if (isRed) {
        borderColor = "#ef4444";
        glowFilter = "url(#glowRed)";
        bgColor = "#1f0a0a";
      }
      if (isRange) {
        borderColor = "#f59e0b";
        glowFilter = "url(#glowAmber)";
        bgColor = "#1f1a0a";
      }

      nodes.push(
        <motion.g
          key={layout.id}
          initial={false}
          animate={{ x: layout.x, y: layout.y }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        >
          {/* Node background */}
          <motion.rect
            x={0}
            y={0}
            width={layout.width}
            height={layout.height}
            rx={8}
            ry={8}
            fill={bgColor}
            stroke={borderColor}
            strokeWidth={isPath || isHighlighted || isGreen || isRed || isRange ? 2 : 1}
            filter={glowFilter}
            initial={false}
            animate={{
              fill: bgColor,
              stroke: borderColor,
              strokeWidth:
                isPath || isHighlighted || isGreen || isRed || isRange
                  ? 2
                  : 1,
            }}
            transition={{ duration: 0.3 }}
          />

          {/* Leaf bottom accent */}
          {layout.isLeaf && (
            <motion.rect
              x={2}
              y={layout.height - 4}
              width={layout.width - 4}
              height={3}
              rx={2}
              fill={
                isGreen
                  ? "#10b981"
                  : isRed
                  ? "#ef4444"
                  : isRange
                  ? "#f59e0b"
                  : isPath
                  ? "#06b6d4"
                  : "#6366f1"
              }
              opacity={0.6}
              initial={false}
              animate={{
                fill: isGreen
                  ? "#10b981"
                  : isRed
                  ? "#ef4444"
                  : isRange
                  ? "#f59e0b"
                  : isPath
                  ? "#06b6d4"
                  : "#6366f1",
              }}
              transition={{ duration: 0.3 }}
            />
          )}

          {/* Keys */}
          {layout.keys.map((key, ki) => {
            const keyX =
              NODE_PADDING + ki * KEY_WIDTH + KEY_WIDTH / 2;
            return (
              <g key={`key-${ki}`}>
                <text
                  x={keyX}
                  y={layout.height / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  fontSize={13}
                  fontFamily="ui-monospace, monospace"
                  fontWeight={500}
                >
                  {key}
                </text>
                {/* Divider between keys */}
                {ki < layout.keys.length - 1 && (
                  <line
                    x1={NODE_PADDING + (ki + 1) * KEY_WIDTH}
                    y1={6}
                    x2={NODE_PADDING + (ki + 1) * KEY_WIDTH}
                    y2={layout.height - 6}
                    stroke="#2a2a3e"
                    strokeWidth={1}
                    opacity={0.5}
                  />
                )}
              </g>
            );
          })}

          {/* Empty node placeholder */}
          {layout.keys.length === 0 && (
            <text
              x={layout.width / 2}
              y={layout.height / 2 + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#71717a"
              fontSize={11}
              fontStyle="italic"
            >
              empty
            </text>
          )}
        </motion.g>
      );
    });
    return nodes;
  }, [layouts, highlightedNodes, pathNodes, flashGreen, flashRed, rangeHighlightNodes]);

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />

      <div className="pt-14">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2 py-0.5 rounded-md bg-[#6366f1]/10 border border-[#6366f1]/20 text-[#6366f1] text-xs font-mono font-medium">
                6.2
              </span>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                B+ Tree Indexing
              </h1>
            </div>
            <p className="text-[#a1a1aa] text-sm max-w-2xl">
              Interactive B+ tree with insert, delete, search, and range queries.
              Visualize how database indexes work with animated node splits, merges,
              and linked-list traversals.
            </p>
          </div>

          {/* Controls Bar */}
          <div className="mb-4">
            <ModuleControls
              isPlaying={isPlaying}
              onPlay={handlePlay}
              onPause={handlePause}
              onStep={handleStep}
              onReset={handleReset}
              speed={speed}
              onSpeedChange={setSpeed}
              showMetrics={showMetrics}
              onToggleMetrics={() => setShowMetrics((v) => !v)}
            >
              {/* Order selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#71717a] whitespace-nowrap">
                  Order:
                </span>
                <select
                  value={order}
                  onChange={(e) => handleOrderChange(parseInt(e.target.value))}
                  className="h-8 px-2 rounded-lg bg-[#1e1e2e] border border-[#2a2a3e] text-white text-xs focus:outline-none focus:border-[#6366f1] cursor-pointer"
                >
                  {[3, 4, 5, 6, 7].map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            </ModuleControls>
          </div>

          <div className="flex gap-4 flex-col xl:flex-row">
            {/* Left Panel: Operations */}
            <div className="xl:w-72 flex-shrink-0 space-y-3">
              {/* Insert */}
              <div className="p-3 bg-[#111118] border border-[#1e1e2e] rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Plus size={14} className="text-[#10b981]" />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Insert
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={insertValue}
                    onChange={(e) => setInsertValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleInsert()}
                    placeholder="Key"
                    className="flex-1 h-8 px-3 rounded-lg bg-[#0a0a0f] border border-[#2a2a3e] text-white text-sm placeholder:text-[#71717a] focus:outline-none focus:border-[#6366f1] font-mono"
                  />
                  <button
                    onClick={handleInsert}
                    className="h-8 px-3 rounded-lg bg-[#10b981]/20 border border-[#10b981]/30 text-[#10b981] text-xs font-medium hover:bg-[#10b981]/30 transition-colors"
                  >
                    Insert
                  </button>
                </div>
              </div>

              {/* Delete */}
              <div className="p-3 bg-[#111118] border border-[#1e1e2e] rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Trash2 size={14} className="text-[#ef4444]" />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Delete
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={deleteValue}
                    onChange={(e) => setDeleteValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleDelete()}
                    placeholder="Key"
                    className="flex-1 h-8 px-3 rounded-lg bg-[#0a0a0f] border border-[#2a2a3e] text-white text-sm placeholder:text-[#71717a] focus:outline-none focus:border-[#6366f1] font-mono"
                  />
                  <button
                    onClick={handleDelete}
                    className="h-8 px-3 rounded-lg bg-[#ef4444]/20 border border-[#ef4444]/30 text-[#ef4444] text-xs font-medium hover:bg-[#ef4444]/30 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Search */}
              <div className="p-3 bg-[#111118] border border-[#1e1e2e] rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Search size={14} className="text-[#06b6d4]" />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Search
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder="Key"
                    className="flex-1 h-8 px-3 rounded-lg bg-[#0a0a0f] border border-[#2a2a3e] text-white text-sm placeholder:text-[#71717a] focus:outline-none focus:border-[#6366f1] font-mono"
                  />
                  <button
                    onClick={handleSearch}
                    className="h-8 px-3 rounded-lg bg-[#06b6d4]/20 border border-[#06b6d4]/30 text-[#06b6d4] text-xs font-medium hover:bg-[#06b6d4]/30 transition-colors"
                  >
                    Search
                  </button>
                </div>
              </div>

              {/* Range Query */}
              <div className="p-3 bg-[#111118] border border-[#1e1e2e] rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowRight size={14} className="text-[#f59e0b]" />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Range Query
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={rangeLow}
                    onChange={(e) => setRangeLow(e.target.value)}
                    placeholder="Low"
                    className="w-16 h-8 px-2 rounded-lg bg-[#0a0a0f] border border-[#2a2a3e] text-white text-sm placeholder:text-[#71717a] focus:outline-none focus:border-[#6366f1] font-mono text-center"
                  />
                  <span className="text-[#71717a] self-center text-xs">to</span>
                  <input
                    type="number"
                    value={rangeHigh}
                    onChange={(e) => setRangeHigh(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleRangeQuery()}
                    placeholder="High"
                    className="w-16 h-8 px-2 rounded-lg bg-[#0a0a0f] border border-[#2a2a3e] text-white text-sm placeholder:text-[#71717a] focus:outline-none focus:border-[#6366f1] font-mono text-center"
                  />
                  <button
                    onClick={handleRangeQuery}
                    className="h-8 px-2 rounded-lg bg-[#f59e0b]/20 border border-[#f59e0b]/30 text-[#f59e0b] text-xs font-medium hover:bg-[#f59e0b]/30 transition-colors whitespace-nowrap"
                  >
                    Range
                  </button>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="p-3 bg-[#111118] border border-[#1e1e2e] rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Shuffle size={14} className="text-[#a1a1aa]" />
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">
                    Quick Actions
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleRandomInsert}
                    className="h-8 px-2 rounded-lg bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#a1a1aa] hover:text-white text-xs transition-colors"
                  >
                    Random +5
                  </button>
                  <button
                    onClick={() => handlePreset("empty")}
                    className="h-8 px-2 rounded-lg bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#a1a1aa] hover:text-white text-xs transition-colors"
                  >
                    Empty
                  </button>
                  <button
                    onClick={() => handlePreset("small")}
                    className="h-8 px-2 rounded-lg bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#a1a1aa] hover:text-white text-xs transition-colors"
                  >
                    Small (10)
                  </button>
                  <button
                    onClick={() => handlePreset("large")}
                    className="h-8 px-2 rounded-lg bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#a1a1aa] hover:text-white text-xs transition-colors"
                  >
                    Large (30)
                  </button>
                </div>
              </div>

              {/* Metrics */}
              <AnimatePresence>
                {showMetrics && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-3 bg-[#111118] border border-[#1e1e2e] rounded-xl">
                      <div className="flex items-center gap-2 mb-3">
                        <Database size={14} className="text-[#6366f1]" />
                        <span className="text-xs font-semibold text-white uppercase tracking-wider">
                          Metrics
                        </span>
                      </div>
                      <div className="space-y-2">
                        <MetricRow label="Height" value={metrics.height} />
                        <MetricRow label="Total Keys" value={metrics.totalKeys} />
                        <MetricRow
                          label="Nodes"
                          value={`${metrics.nodeCount} (${metrics.internalNodes}i + ${metrics.leafNodes}l)`}
                        />
                        <MetricRow
                          label="Fill Factor"
                          value={`${(metrics.fillFactor * 100).toFixed(0)}%`}
                        />
                        <MetricRow label="Operations" value={operationCount} />
                        <MetricRow label="Order" value={order} />
                        <MetricRow
                          label="Max Keys/Node"
                          value={order - 1}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Main Visualization */}
            <div className="flex-1 min-h-0">
              <div className="relative bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden" style={{ height: "calc(100vh - 260px)", minHeight: 400 }}>
                {/* Status bar */}
                <AnimatePresence>
                  {statusMessage && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute top-3 left-3 right-3 z-10"
                    >
                      <div className="flex items-center gap-2 px-3 py-2 bg-[#0a0a0f]/90 backdrop-blur-sm border border-[#2a2a3e] rounded-lg">
                        <Info size={14} className="text-[#6366f1] flex-shrink-0" />
                        <span className="text-sm text-[#a1a1aa] font-mono">
                          {statusMessage}
                        </span>
                        {currentStepIdx >= 0 && animSteps.length > 0 && (
                          <span className="ml-auto text-xs text-[#71717a] font-mono whitespace-nowrap">
                            Step {currentStepIdx + 1}/{animSteps.length}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Zoom controls */}
                <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1">
                  <button
                    onClick={handleZoomIn}
                    className="w-8 h-8 rounded-lg bg-[#0a0a0f]/80 backdrop-blur-sm border border-[#2a2a3e] flex items-center justify-center text-[#a1a1aa] hover:text-white hover:border-[#6366f1] transition-colors"
                    title="Zoom in"
                  >
                    <ZoomIn size={14} />
                  </button>
                  <button
                    onClick={handleZoomOut}
                    className="w-8 h-8 rounded-lg bg-[#0a0a0f]/80 backdrop-blur-sm border border-[#2a2a3e] flex items-center justify-center text-[#a1a1aa] hover:text-white hover:border-[#6366f1] transition-colors"
                    title="Zoom out"
                  >
                    <ZoomOut size={14} />
                  </button>
                  <button
                    onClick={handleFitView}
                    className="w-8 h-8 rounded-lg bg-[#0a0a0f]/80 backdrop-blur-sm border border-[#2a2a3e] flex items-center justify-center text-[#a1a1aa] hover:text-white hover:border-[#6366f1] transition-colors"
                    title="Fit to view"
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>

                {/* Legend */}
                <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-3 px-3 py-2 bg-[#0a0a0f]/80 backdrop-blur-sm border border-[#2a2a3e] rounded-lg">
                  <LegendItem color="#1e1e2e" label="Internal" />
                  <LegendItem color="#6366f1" label="Leaf" />
                  <LegendItem color="#06b6d4" label="Search Path" />
                  <LegendItem color="#10b981" label="Inserted" />
                  <LegendItem color="#ef4444" label="Deleted" />
                  <LegendItem color="#f59e0b" label="Range" />
                </div>

                {/* SVG Canvas */}
                <svg
                  ref={svgRef}
                  viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
                  className="w-full h-full"
                  style={{ cursor: isPanning ? "grabbing" : "grab" }}
                  onWheel={handleWheel}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                >
                  {/* Glow filters */}
                  <defs>
                    <filter id="glowPrimary" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feFlood floodColor="#6366f1" floodOpacity="0.4" />
                      <feComposite in2="blur" operator="in" />
                      <feMerge>
                        <feMergeNode />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <filter id="glowCyan" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feFlood floodColor="#06b6d4" floodOpacity="0.4" />
                      <feComposite in2="blur" operator="in" />
                      <feMerge>
                        <feMergeNode />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <filter id="glowGreen" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feFlood floodColor="#10b981" floodOpacity="0.4" />
                      <feComposite in2="blur" operator="in" />
                      <feMerge>
                        <feMergeNode />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <filter id="glowRed" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feFlood floodColor="#ef4444" floodOpacity="0.4" />
                      <feComposite in2="blur" operator="in" />
                      <feMerge>
                        <feMergeNode />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <filter id="glowAmber" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feFlood floodColor="#f59e0b" floodOpacity="0.4" />
                      <feComposite in2="blur" operator="in" />
                      <feMerge>
                        <feMergeNode />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>

                    {/* Subtle grid pattern */}
                    <pattern
                      id="grid"
                      width="40"
                      height="40"
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d="M 40 0 L 0 0 0 40"
                        fill="none"
                        stroke="#1e1e2e"
                        strokeWidth="0.5"
                        opacity="0.3"
                      />
                    </pattern>
                  </defs>

                  {/* Grid background */}
                  <rect
                    x={viewBox.x - 1000}
                    y={viewBox.y - 1000}
                    width={viewBox.w + 2000}
                    height={viewBox.h + 2000}
                    fill="url(#grid)"
                  />

                  {/* Edges */}
                  {renderEdges}

                  {/* Nodes */}
                  {renderNodes}

                  {/* Empty state */}
                  {layouts.size === 0 && (
                    <g>
                      {/* Tree icon drawn in SVG */}
                      <g transform={`translate(${viewBox.x + viewBox.w / 2}, ${viewBox.y + viewBox.h / 2 - 30})`}>
                        <path
                          d="M-12,-20 L0,-36 L12,-20 Z M-16,-8 L0,-24 L16,-8 Z M-20,4 L0,-12 L20,4 Z M-3,4 L-3,16 L3,16 L3,4 Z"
                          fill="#2a2a3e"
                          stroke="#2a2a3e"
                          strokeWidth="1"
                          strokeLinejoin="round"
                        />
                      </g>
                      <text
                        x={viewBox.x + viewBox.w / 2}
                        y={viewBox.y + viewBox.h / 2 + 20}
                        textAnchor="middle"
                        fill="#71717a"
                        fontSize={14}
                      >
                        Empty tree. Insert some keys to get started.
                      </text>
                      <text
                        x={viewBox.x + viewBox.w / 2}
                        y={viewBox.y + viewBox.h / 2 + 40}
                        textAnchor="middle"
                        fill="#4a4a5a"
                        fontSize={12}
                      >
                        Try &quot;Small (10)&quot; or &quot;Large (30)&quot; presets
                      </text>
                    </g>
                  )}
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Small helper components
// ============================================================================

function MetricRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[#71717a]">{label}</span>
      <span className="text-xs text-white font-mono">{value}</span>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="w-2.5 h-2.5 rounded-sm"
        style={{ backgroundColor: color }}
      />
      <span className="text-[10px] text-[#71717a]">{label}</span>
    </div>
  );
}
