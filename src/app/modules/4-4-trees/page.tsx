"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TreePine,
  Plus,
  Search,
  Trash2,
  Shuffle,
  Zap,
  Info,
  Eye,
  Layers,
  GitCompareArrows,
  ChevronDown,
  RotateCw,
  ArrowDown,
  Target,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

type TreeType = "bst" | "avl" | "red-black";

type NodeColor = "red" | "black";

type NodeVisualState =
  | "default"
  | "searching"
  | "found"
  | "inserting"
  | "deleting"
  | "rotating"
  | "recoloring"
  | "visited";

interface TreeNode {
  value: number;
  left: TreeNode | null;
  right: TreeNode | null;
  parent: TreeNode | null;
  color: NodeColor; // for RB trees
  height: number; // for AVL trees
  id: string;
}

interface LayoutNode {
  node: TreeNode;
  x: number;
  y: number;
  visualState: NodeVisualState;
}

interface LayoutEdge {
  from: { x: number; y: number };
  to: { x: number; y: number };
  highlighted: boolean;
}

interface TreeState {
  root: TreeNode | null;
  layoutNodes: LayoutNode[];
  layoutEdges: LayoutEdge[];
  nodeCount: number;
  treeHeight: number;
  comparisons: number;
  rotations: number;
  balanceStatus: string;
  log: string[];
  phase: string;
  highlightedPath: string[];
  traversalOrder: number[];
}

interface ScenarioPreset {
  name: string;
  label: string;
  values: number[];
  treeType: TreeType;
  description: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DOMAIN_COLOR = "#10b981";
const DEFAULT_NODE_COLOR = "#6366f1";
const SEARCHING_COLOR = "#f59e0b";
const FOUND_COLOR = "#10b981";
const INSERTING_COLOR = "#06b6d4";
const ROTATING_COLOR = "#f59e0b";
const RB_RED_COLOR = "#ef4444";
const RB_BLACK_COLOR = "#2a2a3e";
const VISITED_COLOR = "#8b5cf6";

const NODE_RADIUS = 22;
const LEVEL_HEIGHT = 70;
const MIN_H_SPACING = 50;

const TREE_TYPE_INFO: Record<TreeType, { label: string; description: string }> = {
  bst: {
    label: "Binary Search Tree",
    description:
      "A basic BST with no balancing. Insertions follow the BST property but can lead to degenerate (linked-list) shapes.",
  },
  avl: {
    label: "AVL Tree",
    description:
      "Self-balancing BST where the heights of two child subtrees differ by at most 1. Uses rotations to maintain balance.",
  },
  "red-black": {
    label: "Red-Black Tree",
    description:
      "Self-balancing BST using node coloring (red/black) and rotations. Guarantees O(log n) height with relaxed balance constraints.",
  },
};

const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    name: "balanced",
    label: "Balanced Insert",
    values: [50, 25, 75, 12, 37, 62, 87],
    treeType: "bst",
    description: "Inserting values that create a balanced BST",
  },
  {
    name: "worst-bst",
    label: "Worst Case BST",
    values: [10, 20, 30, 40, 50, 60, 70],
    treeType: "bst",
    description: "Sorted input creates a degenerate (linked-list) BST",
  },
  {
    name: "avl-rotations",
    label: "AVL Rotations",
    values: [30, 20, 10, 25, 40, 35, 50],
    treeType: "avl",
    description: "Insertions that trigger LL, RR, LR rotations in AVL",
  },
  {
    name: "rb-recoloring",
    label: "RB Recoloring",
    values: [10, 20, 30, 15, 25, 5, 1],
    treeType: "red-black",
    description: "Insertions that trigger recoloring and rotations in RB tree",
  },
];

// ─── Node IDs ─────────────────────────────────────────────────────────────────

let nodeIdCounter = 0;
function newNodeId(): string {
  return `tn-${++nodeIdCounter}`;
}

// ─── Tree utility functions ───────────────────────────────────────────────────

function createTreeNode(
  value: number,
  color: NodeColor = "red"
): TreeNode {
  return {
    value,
    left: null,
    right: null,
    parent: null,
    color,
    height: 1,
    id: newNodeId(),
  };
}

function getHeight(node: TreeNode | null): number {
  if (!node) return 0;
  return node.height;
}

function updateHeight(node: TreeNode): void {
  node.height = 1 + Math.max(getHeight(node.left), getHeight(node.right));
}

function getBalanceFactor(node: TreeNode | null): number {
  if (!node) return 0;
  return getHeight(node.left) - getHeight(node.right);
}

function treeHeight(node: TreeNode | null): number {
  if (!node) return 0;
  return 1 + Math.max(treeHeight(node.left), treeHeight(node.right));
}

function countNodes(node: TreeNode | null): number {
  if (!node) return 0;
  return 1 + countNodes(node.left) + countNodes(node.right);
}

function cloneTree(node: TreeNode | null, parent: TreeNode | null = null): TreeNode | null {
  if (!node) return null;
  const cloned: TreeNode = {
    value: node.value,
    left: null,
    right: null,
    parent,
    color: node.color,
    height: node.height,
    id: node.id,
  };
  cloned.left = cloneTree(node.left, cloned);
  cloned.right = cloneTree(node.right, cloned);
  return cloned;
}

function inorderTraversal(node: TreeNode | null): number[] {
  if (!node) return [];
  return [
    ...inorderTraversal(node.left),
    node.value,
    ...inorderTraversal(node.right),
  ];
}

function findMin(node: TreeNode): TreeNode {
  let current = node;
  while (current.left) current = current.left;
  return current;
}

// ─── Layout algorithm ─────────────────────────────────────────────────────────

function computeLayout(
  root: TreeNode | null,
  highlightedIds: Set<string>,
  visualStates: Map<string, NodeVisualState>
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  if (!root) return { nodes: [], edges: [] };

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  // Calculate subtree widths for proper spacing
  function subtreeWidth(node: TreeNode | null): number {
    if (!node) return 0;
    const leftW = subtreeWidth(node.left);
    const rightW = subtreeWidth(node.right);
    return Math.max(MIN_H_SPACING, leftW + rightW + MIN_H_SPACING);
  }

  function layout(
    node: TreeNode,
    x: number,
    y: number,
    hSpread: number
  ): void {
    const visualState = visualStates.get(node.id) || "default";
    nodes.push({ node, x, y, visualState });

    if (node.left) {
      const childX = x - hSpread / 2;
      const childY = y + LEVEL_HEIGHT;
      edges.push({
        from: { x, y },
        to: { x: childX, y: childY },
        highlighted: highlightedIds.has(node.id) && highlightedIds.has(node.left.id),
      });
      layout(node.left, childX, childY, hSpread / 2);
    }

    if (node.right) {
      const childX = x + hSpread / 2;
      const childY = y + LEVEL_HEIGHT;
      edges.push({
        from: { x, y },
        to: { x: childX, y: childY },
        highlighted: highlightedIds.has(node.id) && highlightedIds.has(node.right.id),
      });
      layout(node.right, childX, childY, hSpread / 2);
    }
  }

  const totalWidth = subtreeWidth(root);
  const hSpread = Math.max(totalWidth, 200);
  layout(root, 0, 40, hSpread);

  // Normalize x positions to be centered
  if (nodes.length > 0) {
    const minX = Math.min(...nodes.map((n) => n.x));
    const maxX = Math.max(...nodes.map((n) => n.x));
    const centerOffset = -(minX + maxX) / 2;
    nodes.forEach((n) => {
      n.x += centerOffset;
    });
    edges.forEach((e) => {
      e.from.x += centerOffset;
      e.to.x += centerOffset;
    });
  }

  return { nodes, edges };
}

// ─── BST Operations ───────────────────────────────────────────────────────────

function bstInsert(root: TreeNode | null, value: number): TreeNode {
  const newNode = createTreeNode(value, "black");
  if (!root) return newNode;

  let current: TreeNode | null = root;
  let parent: TreeNode | null = null;

  while (current) {
    parent = current;
    if (value < current.value) {
      current = current.left;
    } else if (value > current.value) {
      current = current.right;
    } else {
      return root; // duplicate
    }
  }

  newNode.parent = parent;
  if (parent) {
    if (value < parent.value) {
      parent.left = newNode;
    } else {
      parent.right = newNode;
    }
  }

  return root;
}

function bstSearch(
  root: TreeNode | null,
  value: number
): { path: string[]; found: boolean } {
  const path: string[] = [];
  let current = root;
  while (current) {
    path.push(current.id);
    if (value === current.value) return { path, found: true };
    if (value < current.value) current = current.left;
    else current = current.right;
  }
  return { path, found: false };
}

function bstDelete(root: TreeNode | null, value: number): TreeNode | null {
  if (!root) return null;

  if (value < root.value) {
    root.left = bstDelete(root.left, value);
    if (root.left) root.left.parent = root;
  } else if (value > root.value) {
    root.right = bstDelete(root.right, value);
    if (root.right) root.right.parent = root;
  } else {
    if (!root.left) return root.right;
    if (!root.right) return root.left;

    const successor = findMin(root.right);
    root.value = successor.value;
    root.right = bstDelete(root.right, successor.value);
    if (root.right) root.right.parent = root;
  }

  return root;
}

// ─── AVL Operations ───────────────────────────────────────────────────────────

function rotateRight(y: TreeNode): TreeNode {
  const x = y.left!;
  const T2 = x.right;

  x.right = y;
  y.left = T2;

  x.parent = y.parent;
  y.parent = x;
  if (T2) T2.parent = y;

  updateHeight(y);
  updateHeight(x);

  return x;
}

function rotateLeft(x: TreeNode): TreeNode {
  const y = x.right!;
  const T2 = y.left;

  y.left = x;
  x.right = T2;

  y.parent = x.parent;
  x.parent = y;
  if (T2) T2.parent = x;

  updateHeight(x);
  updateHeight(y);

  return y;
}

function avlInsert(
  node: TreeNode | null,
  value: number,
  rotationCount: { count: number }
): TreeNode {
  if (!node) {
    const newNode = createTreeNode(value, "black");
    newNode.height = 1;
    return newNode;
  }

  if (value < node.value) {
    node.left = avlInsert(node.left, value, rotationCount);
    if (node.left) node.left.parent = node;
  } else if (value > node.value) {
    node.right = avlInsert(node.right, value, rotationCount);
    if (node.right) node.right.parent = node;
  } else {
    return node; // duplicate
  }

  updateHeight(node);
  const balance = getBalanceFactor(node);

  // Left Left
  if (balance > 1 && node.left && value < node.left.value) {
    rotationCount.count++;
    return rotateRight(node);
  }

  // Right Right
  if (balance < -1 && node.right && value > node.right.value) {
    rotationCount.count++;
    return rotateLeft(node);
  }

  // Left Right
  if (balance > 1 && node.left && value > node.left.value) {
    rotationCount.count += 2;
    node.left = rotateLeft(node.left);
    if (node.left) node.left.parent = node;
    return rotateRight(node);
  }

  // Right Left
  if (balance < -1 && node.right && value < node.right.value) {
    rotationCount.count += 2;
    node.right = rotateRight(node.right);
    if (node.right) node.right.parent = node;
    return rotateLeft(node);
  }

  return node;
}

function avlDelete(
  node: TreeNode | null,
  value: number,
  rotationCount: { count: number }
): TreeNode | null {
  if (!node) return null;

  if (value < node.value) {
    node.left = avlDelete(node.left, value, rotationCount);
    if (node.left) node.left.parent = node;
  } else if (value > node.value) {
    node.right = avlDelete(node.right, value, rotationCount);
    if (node.right) node.right.parent = node;
  } else {
    if (!node.left || !node.right) {
      const temp = node.left || node.right;
      if (!temp) return null;
      return temp;
    }
    const successor = findMin(node.right);
    node.value = successor.value;
    node.id = successor.id;
    node.right = avlDelete(node.right, successor.value, rotationCount);
    if (node.right) node.right.parent = node;
  }

  updateHeight(node);
  const balance = getBalanceFactor(node);

  if (balance > 1 && getBalanceFactor(node.left) >= 0) {
    rotationCount.count++;
    return rotateRight(node);
  }

  if (balance > 1 && getBalanceFactor(node.left) < 0) {
    rotationCount.count += 2;
    node.left = rotateLeft(node.left!);
    if (node.left) node.left.parent = node;
    return rotateRight(node);
  }

  if (balance < -1 && getBalanceFactor(node.right) <= 0) {
    rotationCount.count++;
    return rotateLeft(node);
  }

  if (balance < -1 && getBalanceFactor(node.right) > 0) {
    rotationCount.count += 2;
    node.right = rotateRight(node.right!);
    if (node.right) node.right.parent = node;
    return rotateLeft(node);
  }

  return node;
}

// ─── Red-Black Tree Operations ────────────────────────────────────────────────

function rbRotateLeft(root: TreeNode, x: TreeNode): TreeNode {
  const y = x.right!;
  x.right = y.left;
  if (y.left) y.left.parent = x;
  y.parent = x.parent;
  if (!x.parent) {
    root = y;
  } else if (x === x.parent.left) {
    x.parent.left = y;
  } else {
    x.parent.right = y;
  }
  y.left = x;
  x.parent = y;
  return root;
}

function rbRotateRight(root: TreeNode, y: TreeNode): TreeNode {
  const x = y.left!;
  y.left = x.right;
  if (x.right) x.right.parent = y;
  x.parent = y.parent;
  if (!y.parent) {
    root = x;
  } else if (y === y.parent.left) {
    y.parent.left = x;
  } else {
    y.parent.right = x;
  }
  x.right = y;
  y.parent = x;
  return root;
}

function rbInsertFixup(
  root: TreeNode,
  z: TreeNode,
  rotationCount: { count: number }
): TreeNode {
  while (z.parent && z.parent.color === "red") {
    if (z.parent === z.parent.parent?.left) {
      const uncle = z.parent.parent?.right;
      if (uncle && uncle.color === "red") {
        // Case 1: Uncle is red
        z.parent.color = "black";
        uncle.color = "black";
        z.parent.parent!.color = "red";
        z = z.parent.parent!;
      } else {
        if (z === z.parent.right) {
          // Case 2: Uncle is black, z is right child
          z = z.parent;
          root = rbRotateLeft(root, z);
          rotationCount.count++;
        }
        // Case 3: Uncle is black, z is left child
        z.parent!.color = "black";
        z.parent!.parent!.color = "red";
        root = rbRotateRight(root, z.parent!.parent!);
        rotationCount.count++;
      }
    } else {
      const uncle = z.parent.parent?.left;
      if (uncle && uncle.color === "red") {
        z.parent.color = "black";
        uncle.color = "black";
        z.parent.parent!.color = "red";
        z = z.parent.parent!;
      } else {
        if (z === z.parent.left) {
          z = z.parent;
          root = rbRotateRight(root, z);
          rotationCount.count++;
        }
        z.parent!.color = "black";
        z.parent!.parent!.color = "red";
        root = rbRotateLeft(root, z.parent!.parent!);
        rotationCount.count++;
      }
    }
  }
  root.color = "black";
  return root;
}

function rbInsert(
  root: TreeNode | null,
  value: number,
  rotationCount: { count: number }
): TreeNode {
  const z = createTreeNode(value, "red");

  if (!root) {
    z.color = "black";
    return z;
  }

  let y: TreeNode | null = null;
  let x: TreeNode | null = root;

  while (x) {
    y = x;
    if (value < x.value) {
      x = x.left;
    } else if (value > x.value) {
      x = x.right;
    } else {
      return root; // duplicate
    }
  }

  z.parent = y;
  if (y) {
    if (value < y.value) {
      y.left = z;
    } else {
      y.right = z;
    }
  }

  return rbInsertFixup(root, z, rotationCount);
}

// ─── Step generator for tree operations ───────────────────────────────────────

function buildTreeState(
  root: TreeNode | null,
  highlightedIds: string[],
  visualStates: Map<string, NodeVisualState>,
  comparisons: number,
  rotations: number,
  log: string[],
  phase: string,
  treeType: TreeType
): TreeState {
  const highlightedSet = new Set(highlightedIds);
  const layout = computeLayout(root, highlightedSet, visualStates);

  let balanceStatus = "N/A";
  if (root) {
    if (treeType === "avl") {
      const getAllNodes = (n: TreeNode | null): TreeNode[] => {
        if (!n) return [];
        return [n, ...getAllNodes(n.left), ...getAllNodes(n.right)];
      };
      const allNodes = getAllNodes(root);
      const unbalanced = allNodes.some((n) => Math.abs(getBalanceFactor(n)) > 1);
      balanceStatus = unbalanced ? "Unbalanced" : "Balanced";
    } else if (treeType === "red-black") {
      balanceStatus = "RB-Valid";
    } else {
      const h = treeHeight(root);
      const n = countNodes(root);
      const perfectH = Math.ceil(Math.log2(n + 1));
      balanceStatus = h <= perfectH + 1 ? "Good" : h > 2 * perfectH ? "Degenerate" : "Skewed";
    }
  }

  return {
    root,
    layoutNodes: layout.nodes,
    layoutEdges: layout.edges,
    nodeCount: countNodes(root),
    treeHeight: treeHeight(root),
    comparisons,
    rotations,
    balanceStatus,
    log,
    phase,
    highlightedPath: highlightedIds,
    traversalOrder: inorderTraversal(root),
  };
}

function* insertGenerator(
  root: TreeNode | null,
  value: number,
  treeType: TreeType,
  prevComparisons: number,
  prevRotations: number,
  prevLog: string[]
): Generator<TreeState> {
  const log = [...prevLog];
  let comparisons = prevComparisons;
  let rotations = prevRotations;
  const visualStates = new Map<string, NodeVisualState>();

  log.push(`INSERT ${value}`);

  if (!root) {
    const newNode = createTreeNode(value, treeType === "red-black" ? "black" : "black");
    newNode.height = 1;
    visualStates.set(newNode.id, "inserting");
    log.push(`  Tree empty, ${value} becomes root`);
    yield buildTreeState(newNode, [newNode.id], visualStates, comparisons, rotations, [...log], "inserted", treeType);
    visualStates.clear();
    yield buildTreeState(newNode, [], visualStates, comparisons, rotations, [...log], "done", treeType);
    return;
  }

  // Animate search path
  let current: TreeNode | null = root;
  const path: string[] = [];

  while (current) {
    path.push(current.id);
    comparisons++;
    visualStates.set(current.id, "searching");
    log.push(`  Compare ${value} with ${current.value}`);
    yield buildTreeState(cloneTree(root)!, [...path], visualStates, comparisons, rotations, [...log], "searching", treeType);

    if (value < current.value) {
      if (!current.left) {
        // Insert here
        log.push(`  ${value} < ${current.value}, insert as left child`);
        break;
      }
      log.push(`  ${value} < ${current.value}, go left`);
      current = current.left;
    } else if (value > current.value) {
      if (!current.right) {
        log.push(`  ${value} > ${current.value}, insert as right child`);
        break;
      }
      log.push(`  ${value} > ${current.value}, go right`);
      current = current.right;
    } else {
      log.push(`  ${value} already exists, skipping`);
      visualStates.clear();
      yield buildTreeState(root, [], visualStates, comparisons, rotations, [...log], "done", treeType);
      return;
    }
  }

  // Perform actual insert
  visualStates.clear();
  let newRoot: TreeNode | null;
  const rotCount = { count: 0 };

  if (treeType === "avl") {
    newRoot = avlInsert(cloneTree(root), value, rotCount);
    rotations += rotCount.count;
    if (rotCount.count > 0) {
      log.push(`  Rebalanced with ${rotCount.count} rotation(s)`);
    }
  } else if (treeType === "red-black") {
    newRoot = rbInsert(cloneTree(root), value, rotCount);
    rotations += rotCount.count;
    if (rotCount.count > 0) {
      log.push(`  RB fixup: ${rotCount.count} rotation(s)`);
    }
  } else {
    newRoot = cloneTree(root);
    bstInsert(newRoot!, value);
  }

  // Find the newly inserted node
  const findNode = (n: TreeNode | null, v: number): TreeNode | null => {
    if (!n) return null;
    if (n.value === v) return n;
    const left = findNode(n.left, v);
    if (left) return left;
    return findNode(n.right, v);
  };

  const inserted = findNode(newRoot, value);
  if (inserted) {
    visualStates.set(inserted.id, "inserting");
  }

  log.push(`  Inserted ${value}` + (treeType === "red-black" && inserted ? ` (color: ${inserted.color})` : ""));

  yield buildTreeState(newRoot, inserted ? [inserted.id] : [], visualStates, comparisons, rotations, [...log], "inserted", treeType);

  visualStates.clear();
  yield buildTreeState(newRoot, [], visualStates, comparisons, rotations, [...log], "done", treeType);
}

function* searchGenerator(
  root: TreeNode | null,
  value: number,
  treeType: TreeType,
  prevComparisons: number,
  prevRotations: number,
  prevLog: string[]
): Generator<TreeState> {
  const log = [...prevLog];
  let comparisons = prevComparisons;
  const visualStates = new Map<string, NodeVisualState>();

  log.push(`SEARCH ${value}`);

  if (!root) {
    log.push(`  Tree empty, ${value} not found`);
    yield buildTreeState(null, [], visualStates, comparisons, prevRotations, [...log], "not-found", treeType);
    return;
  }

  let current: TreeNode | null = root;
  const path: string[] = [];

  while (current) {
    path.push(current.id);
    comparisons++;
    visualStates.set(current.id, "searching");
    log.push(`  Compare ${value} with ${current.value}`);
    yield buildTreeState(root, [...path], visualStates, comparisons, prevRotations, [...log], "searching", treeType);

    if (value === current.value) {
      visualStates.set(current.id, "found");
      log.push(`  Found ${value}!`);
      yield buildTreeState(root, [...path], visualStates, comparisons, prevRotations, [...log], "found", treeType);
      visualStates.clear();
      yield buildTreeState(root, [], visualStates, comparisons, prevRotations, [...log], "done", treeType);
      return;
    }

    visualStates.set(current.id, "visited");
    if (value < current.value) {
      log.push(`  ${value} < ${current.value}, go left`);
      current = current.left;
    } else {
      log.push(`  ${value} > ${current.value}, go right`);
      current = current.right;
    }
  }

  log.push(`  ${value} not found`);
  yield buildTreeState(root, path, visualStates, comparisons, prevRotations, [...log], "not-found", treeType);
  visualStates.clear();
  yield buildTreeState(root, [], visualStates, comparisons, prevRotations, [...log], "done", treeType);
}

function* deleteGenerator(
  root: TreeNode | null,
  value: number,
  treeType: TreeType,
  prevComparisons: number,
  prevRotations: number,
  prevLog: string[]
): Generator<TreeState> {
  const log = [...prevLog];
  let comparisons = prevComparisons;
  let rotations = prevRotations;
  const visualStates = new Map<string, NodeVisualState>();

  log.push(`DELETE ${value}`);

  if (!root) {
    log.push(`  Tree empty`);
    yield buildTreeState(null, [], visualStates, comparisons, rotations, [...log], "done", treeType);
    return;
  }

  // Search for the node
  const { path, found } = bstSearch(root, value);

  for (let i = 0; i < path.length; i++) {
    comparisons++;
    visualStates.set(path[i], i === path.length - 1 && found ? "deleting" : "searching");
    yield buildTreeState(root, path.slice(0, i + 1), visualStates, comparisons, rotations, [...log], "searching", treeType);
  }

  if (!found) {
    log.push(`  ${value} not found`);
    visualStates.clear();
    yield buildTreeState(root, [], visualStates, comparisons, rotations, [...log], "done", treeType);
    return;
  }

  log.push(`  Found ${value}, deleting...`);

  // Perform delete
  let newRoot: TreeNode | null;
  const rotCount = { count: 0 };

  if (treeType === "avl") {
    newRoot = avlDelete(cloneTree(root), value, rotCount);
    rotations += rotCount.count;
    if (rotCount.count > 0) {
      log.push(`  Rebalanced with ${rotCount.count} rotation(s)`);
    }
  } else {
    newRoot = bstDelete(cloneTree(root), value);
  }

  log.push(`  Deleted ${value}`);
  visualStates.clear();
  yield buildTreeState(newRoot, [], visualStates, comparisons, rotations, [...log], "deleted", treeType);
  yield buildTreeState(newRoot, [], visualStates, comparisons, rotations, [...log], "done", treeType);
}

function* traversalGenerator(
  root: TreeNode | null,
  treeType: TreeType,
  prevComparisons: number,
  prevRotations: number,
  prevLog: string[]
): Generator<TreeState> {
  const log = [...prevLog];
  const visualStates = new Map<string, NodeVisualState>();
  const visited: string[] = [];

  log.push("IN-ORDER TRAVERSAL");

  function* inorder(node: TreeNode | null): Generator<TreeState> {
    if (!node) return;

    yield* inorder(node.left);

    visited.push(node.id);
    visualStates.set(node.id, "visited");
    log.push(`  Visit ${node.value}`);
    yield buildTreeState(root, [...visited], visualStates, prevComparisons, prevRotations, [...log], "traversal", treeType);

    yield* inorder(node.right);
  }

  if (root) {
    yield* inorder(root);
  }

  log.push(`  Traversal complete: [${inorderTraversal(root).join(", ")}]`);
  yield buildTreeState(root, visited, visualStates, prevComparisons, prevRotations, [...log], "done", treeType);
}

// ─── Metric badge ─────────────────────────────────────────────────────────────

function MetricBadge({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border backdrop-blur-md"
      style={{
        backgroundColor: "rgba(17,17,24,0.85)",
        borderColor: `${color}33`,
      }}
    >
      <span style={{ color }}>{icon}</span>
      <div className="flex flex-col">
        <span className="text-[9px] uppercase tracking-wider" style={{ color: "#71717a" }}>
          {label}
        </span>
        <span className="text-xs font-mono font-semibold tabular-nums" style={{ color }}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
      </div>
    </div>
  );
}

// ─── Tree node visual component ───────────────────────────────────────────────

function TreeNodeViz({
  layoutNode,
  treeType,
}: {
  layoutNode: LayoutNode;
  treeType: TreeType;
}) {
  const { node, x, y, visualState } = layoutNode;

  const getNodeBg = (): string => {
    if (visualState === "found") return FOUND_COLOR;
    if (visualState === "searching") return SEARCHING_COLOR;
    if (visualState === "inserting") return INSERTING_COLOR;
    if (visualState === "deleting") return "#ef4444";
    if (visualState === "rotating") return ROTATING_COLOR;
    if (visualState === "visited") return VISITED_COLOR;
    if (treeType === "red-black") {
      return node.color === "red" ? RB_RED_COLOR : RB_BLACK_COLOR;
    }
    return DEFAULT_NODE_COLOR;
  };

  const getNodeBorder = (): string => {
    if (visualState === "found") return "#059669";
    if (visualState === "searching") return "#d97706";
    if (visualState === "inserting") return "#0891b2";
    if (visualState === "deleting") return "#dc2626";
    if (visualState === "visited") return "#7c3aed";
    if (treeType === "red-black") {
      return node.color === "red" ? "#dc2626" : "#4a4a5e";
    }
    return "#4f46e5";
  };

  const getGlow = (): string => {
    if (visualState === "found") return `0 0 20px ${FOUND_COLOR}60`;
    if (visualState === "searching") return `0 0 14px ${SEARCHING_COLOR}50`;
    if (visualState === "inserting") return `0 0 14px ${INSERTING_COLOR}50`;
    if (visualState === "deleting") return `0 0 14px #ef444460`;
    return "none";
  };

  const balanceFactor =
    treeType === "avl" ? getBalanceFactor(node) : null;

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {/* Node circle */}
      <circle
        cx={x}
        cy={y}
        r={NODE_RADIUS}
        fill={getNodeBg()}
        stroke={getNodeBorder()}
        strokeWidth={2}
        style={{
          filter:
            getGlow() !== "none"
              ? `drop-shadow(${getGlow()})`
              : undefined,
          transition: "all 200ms ease-out",
        }}
      />

      {/* Value text */}
      <text
        x={x}
        y={y + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#ffffff"
        fontSize="13"
        fontFamily="monospace"
        fontWeight="bold"
      >
        {node.value}
      </text>

      {/* Balance factor for AVL */}
      {balanceFactor !== null && (
        <text
          x={x + NODE_RADIUS + 4}
          y={y - NODE_RADIUS + 4}
          textAnchor="start"
          fontSize="10"
          fontFamily="monospace"
          fontWeight="bold"
          fill={
            Math.abs(balanceFactor) > 1
              ? "#ef4444"
              : Math.abs(balanceFactor) === 1
              ? "#f59e0b"
              : "#4a4a5e"
          }
        >
          {balanceFactor > 0 ? `+${balanceFactor}` : balanceFactor}
        </text>
      )}

      {/* RB color indicator */}
      {treeType === "red-black" && (
        <circle
          cx={x + NODE_RADIUS - 4}
          cy={y - NODE_RADIUS + 4}
          r={5}
          fill={node.color === "red" ? "#ef4444" : "#1a1a24"}
          stroke={node.color === "red" ? "#dc2626" : "#4a4a5e"}
          strokeWidth={1.5}
        />
      )}
    </motion.g>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function TreesPage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [treeType, setTreeType] = useState<TreeType>("bst");
  const [showMetrics, setShowMetrics] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [activeScenario, setActiveScenario] = useState("");
  const [valueInput, setValueInput] = useState("");
  const [treeTypeDropdownOpen, setTreeTypeDropdownOpen] = useState(false);

  // ── Tree state ──────────────────────────────────────────────────────────────
  const [treeState, setTreeState] = useState<TreeState>(() =>
    buildTreeState(null, [], new Map(), 0, 0, [], "idle", "bst")
  );

  // ── Auto-play queue ─────────────────────────────────────────────────────────
  const [autoValues, setAutoValues] = useState<number[]>([]);
  const autoValueIndexRef = useRef(0);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const generatorRef = useRef<Generator<TreeState> | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const treeRootRef = useRef<TreeNode | null>(null);
  const comparisonsRef = useRef(0);
  const rotationsRef = useRef(0);
  const logRef = useRef<string[]>([]);
  const treeTypeRef = useRef<TreeType>(treeType);

  // Keep refs in sync
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    treeTypeRef.current = treeType;
  }, [treeType]);

  // ── Step forward ────────────────────────────────────────────────────────────
  const stepForward = useCallback((): boolean => {
    if (generatorRef.current) {
      const result = generatorRef.current.next();
      if (!result.done) {
        setTreeState(result.value);
        // Sync root from state when operation is done
        if (result.value.phase === "done" || result.value.phase === "inserted" || result.value.phase === "deleted") {
          treeRootRef.current = result.value.root;
          comparisonsRef.current = result.value.comparisons;
          rotationsRef.current = result.value.rotations;
          logRef.current = result.value.log;
        }
        if (result.value.phase === "done") {
          generatorRef.current = null;
          // Check if there are more auto-play values
          if (autoValueIndexRef.current < autoValues.length) {
            return true; // will pick up next value on next step
          }
        }
        return true;
      }
      generatorRef.current = null;
    }

    // Check auto-play queue
    if (autoValueIndexRef.current < autoValues.length) {
      const value = autoValues[autoValueIndexRef.current];
      autoValueIndexRef.current++;
      generatorRef.current = insertGenerator(
        treeRootRef.current,
        value,
        treeTypeRef.current,
        comparisonsRef.current,
        rotationsRef.current,
        logRef.current
      );
      const result = generatorRef.current.next();
      if (!result.done) {
        setTreeState(result.value);
        if (result.value.phase === "done") {
          treeRootRef.current = result.value.root;
          comparisonsRef.current = result.value.comparisons;
          rotationsRef.current = result.value.rotations;
          logRef.current = result.value.log;
          generatorRef.current = null;
        }
        return true;
      }
    }

    setIsComplete(true);
    setIsPlaying(false);
    isPlayingRef.current = false;
    return false;
  }, [autoValues]);

  // ── Animation loop ──────────────────────────────────────────────────────────
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

  // ── Play / pause / step / reset ─────────────────────────────────────────────
  const handlePlay = useCallback(() => {
    if (isComplete && autoValues.length === 0 && !generatorRef.current) return;
    setIsPlaying(true);
    isPlayingRef.current = true;
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop, isComplete, autoValues]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const handleStep = useCallback(() => {
    if (isComplete && autoValues.length === 0 && !generatorRef.current) return;
    handlePause();
    stepForward();
  }, [handlePause, stepForward, isComplete, autoValues]);

  const handleReset = useCallback(() => {
    handlePause();
    generatorRef.current = null;
    autoValueIndexRef.current = 0;
    setIsComplete(false);
    setAutoValues([]);
    treeRootRef.current = null;
    comparisonsRef.current = 0;
    rotationsRef.current = 0;
    logRef.current = [];
    setTreeState(buildTreeState(null, [], new Map(), 0, 0, [], "idle", treeType));
  }, [handlePause, treeType]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // ── Operations ──────────────────────────────────────────────────────────────
  const handleInsert = useCallback(
    (value: number) => {
      handlePause();
      setIsComplete(false);
      generatorRef.current = insertGenerator(
        treeRootRef.current,
        value,
        treeTypeRef.current,
        comparisonsRef.current,
        rotationsRef.current,
        logRef.current
      );
    },
    [handlePause]
  );

  const handleSearchOp = useCallback(
    (value: number) => {
      handlePause();
      setIsComplete(false);
      generatorRef.current = searchGenerator(
        treeRootRef.current,
        value,
        treeTypeRef.current,
        comparisonsRef.current,
        rotationsRef.current,
        logRef.current
      );
    },
    [handlePause]
  );

  const handleDeleteOp = useCallback(
    (value: number) => {
      handlePause();
      setIsComplete(false);
      generatorRef.current = deleteGenerator(
        treeRootRef.current,
        value,
        treeTypeRef.current,
        comparisonsRef.current,
        rotationsRef.current,
        logRef.current
      );
    },
    [handlePause]
  );

  const handleTraversal = useCallback(() => {
    handlePause();
    setIsComplete(false);
    generatorRef.current = traversalGenerator(
      treeRootRef.current,
      treeTypeRef.current,
      comparisonsRef.current,
      rotationsRef.current,
      logRef.current
    );
  }, [handlePause]);

  const handleRandomValue = useCallback(() => {
    const val = Math.floor(Math.random() * 99) + 1;
    setValueInput(String(val));
    return val;
  }, []);

  // ── Scenario handling ───────────────────────────────────────────────────────
  const handleScenarioChange = useCallback(
    (scenarioName: string) => {
      handlePause();
      setActiveScenario(scenarioName);
      const scenario = SCENARIO_PRESETS.find((s) => s.name === scenarioName);
      if (scenario) {
        setTreeType(scenario.treeType);
        treeTypeRef.current = scenario.treeType;
        generatorRef.current = null;
        autoValueIndexRef.current = 0;
        setIsComplete(false);
        treeRootRef.current = null;
        comparisonsRef.current = 0;
        rotationsRef.current = 0;
        logRef.current = [];
        setTreeState(
          buildTreeState(null, [], new Map(), 0, 0, [], "idle", scenario.treeType)
        );
        setAutoValues(scenario.values);
      }
    },
    [handlePause]
  );

  // ── Tree type change ────────────────────────────────────────────────────────
  const handleTreeTypeChange = useCallback(
    (newType: TreeType) => {
      setTreeType(newType);
      treeTypeRef.current = newType;
      setTreeTypeDropdownOpen(false);
      handleReset();
    },
    [handleReset]
  );

  // ── SVG viewport ────────────────────────────────────────────────────────────
  const svgWidth = 800;
  const svgHeight = Math.max(
    300,
    treeState.treeHeight * LEVEL_HEIGHT + 100
  );

  // Calculate SVG viewBox to center the tree
  const allX = treeState.layoutNodes.map((n) => n.x);
  const minX = allX.length > 0 ? Math.min(...allX) - 60 : -200;
  const maxX = allX.length > 0 ? Math.max(...allX) + 60 : 200;
  const viewWidth = Math.max(maxX - minX, 400);
  const viewBox = `${minX} 0 ${viewWidth} ${svgHeight}`;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: "#0a0a0f" }}>
      <Navbar />

      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* ── Header ────────────────────────────────────────────────── */}
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
                  background: `${DOMAIN_COLOR}15`,
                  color: DOMAIN_COLOR,
                  border: `1px solid ${DOMAIN_COLOR}30`,
                }}
              >
                4.4
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Trees: BST, AVL, Red-Black
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Visualize binary search trees and their self-balancing variants.
              Watch insertions, deletions, rotations, and recoloring unfold step
              by step. Compare how AVL and Red-Black trees maintain balance.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium"
                style={{
                  background: "rgba(245,158,11,0.08)",
                  color: "#f59e0b",
                  border: "1px solid rgba(245,158,11,0.15)",
                }}
              >
                <Zap size={11} />
                Prerequisite: Binary Search, Recursion
              </span>
            </div>
          </motion.div>

          {/* ── Controls row ────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.1,
              ease: [0.23, 1, 0.32, 1],
            }}
            className="flex flex-wrap items-center gap-3 mb-4"
          >
            {/* Tree type selector */}
            <div className="relative">
              <button
                onClick={() => setTreeTypeDropdownOpen(!treeTypeDropdownOpen)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: "#111118",
                  border: "1px solid #1e1e2e",
                }}
              >
                <TreePine size={14} style={{ color: DEFAULT_NODE_COLOR }} />
                {TREE_TYPE_INFO[treeType].label}
                <ChevronDown
                  size={14}
                  className="text-[#71717a]"
                  style={{
                    transform: treeTypeDropdownOpen
                      ? "rotate(180deg)"
                      : "rotate(0deg)",
                    transition: "transform 200ms ease",
                  }}
                />
              </button>

              <AnimatePresence>
                {treeTypeDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 mt-1.5 z-50 rounded-xl overflow-hidden"
                    style={{
                      background: "#111118",
                      border: "1px solid #1e1e2e",
                      boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
                      minWidth: "220px",
                    }}
                  >
                    {(Object.keys(TREE_TYPE_INFO) as TreeType[]).map(
                      (key) => (
                        <button
                          key={key}
                          onClick={() => handleTreeTypeChange(key)}
                          className="w-full flex flex-col px-4 py-2.5 text-sm text-left transition-all duration-150"
                          style={{
                            color:
                              treeType === key
                                ? DEFAULT_NODE_COLOR
                                : "#a1a1aa",
                            background:
                              treeType === key
                                ? `${DEFAULT_NODE_COLOR}10`
                                : "transparent",
                          }}
                          onMouseEnter={(e) => {
                            if (treeType !== key)
                              e.currentTarget.style.background = "#16161f";
                          }}
                          onMouseLeave={(e) => {
                            if (treeType !== key)
                              e.currentTarget.style.background = "transparent";
                          }}
                        >
                          <span className="font-medium">
                            {TREE_TYPE_INFO[key].label}
                          </span>
                        </button>
                      )
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Value input + operations */}
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm"
              style={{
                background: "#111118",
                border: "1px solid #1e1e2e",
              }}
            >
              <span className="text-xs text-[#71717a]">Value:</span>
              <input
                type="number"
                value={valueInput}
                onChange={(e) => setValueInput(e.target.value)}
                className="w-14 bg-transparent text-white text-sm font-mono outline-none border-b border-[#2a2a3e] focus:border-[#6366f1] transition-colors text-center"
                placeholder="0"
              />
              <button
                onClick={() => {
                  const v = parseInt(valueInput);
                  if (!isNaN(v)) handleInsert(v);
                }}
                className="px-2 py-1 rounded-lg text-xs font-medium text-[#10b981] hover:bg-[#10b981]/10 transition-colors"
                title="Insert"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => {
                  const v = parseInt(valueInput);
                  if (!isNaN(v)) handleSearchOp(v);
                }}
                className="px-2 py-1 rounded-lg text-xs font-medium text-[#06b6d4] hover:bg-[#06b6d4]/10 transition-colors"
                title="Search"
              >
                <Search size={14} />
              </button>
              <button
                onClick={() => {
                  const v = parseInt(valueInput);
                  if (!isNaN(v)) handleDeleteOp(v);
                }}
                className="px-2 py-1 rounded-lg text-xs font-medium text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>

            <button
              onClick={() => {
                const v = handleRandomValue();
                handleInsert(v);
              }}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium text-[#a1a1aa] hover:text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: "#111118",
                border: "1px solid #1e1e2e",
              }}
            >
              <Shuffle size={14} />
              Random Insert
            </button>

            <button
              onClick={handleTraversal}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium text-[#a1a1aa] hover:text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: "#111118",
                border: "1px solid #1e1e2e",
              }}
            >
              <ArrowDown size={14} />
              In-Order
            </button>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Scenario presets */}
            <div className="flex items-center gap-1">
              {SCENARIO_PRESETS.map((s) => (
                <button
                  key={s.name}
                  onClick={() => handleScenarioChange(s.name)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                  style={{
                    background:
                      activeScenario === s.name
                        ? `${DOMAIN_COLOR}18`
                        : "transparent",
                    color:
                      activeScenario === s.name ? DOMAIN_COLOR : "#71717a",
                    border:
                      activeScenario === s.name
                        ? `1px solid ${DOMAIN_COLOR}30`
                        : "1px solid transparent",
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </motion.div>

          {/* ── Visualization area ────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.6,
              delay: 0.2,
              ease: [0.23, 1, 0.32, 1],
            }}
            className="rounded-2xl overflow-hidden mb-4"
            style={{
              background: "#111118",
              border: "1px solid #1e1e2e",
              boxShadow:
                "0 0 0 1px rgba(16,185,129,0.03), 0 20px 50px -12px rgba(0,0,0,0.5)",
            }}
          >
            {/* Tree type header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-3">
                <TreePine size={14} style={{ color: DEFAULT_NODE_COLOR }} />
                <span className="text-sm text-white font-medium">
                  {TREE_TYPE_INFO[treeType].label}
                </span>
                <span className="text-xs font-mono text-[#71717a]">
                  Phase:{" "}
                  <span
                    style={{
                      color:
                        treeState.phase === "found"
                          ? FOUND_COLOR
                          : treeState.phase === "not-found"
                          ? "#ef4444"
                          : treeState.phase === "inserted"
                          ? INSERTING_COLOR
                          : treeState.phase === "searching"
                          ? SEARCHING_COLOR
                          : "#71717a",
                    }}
                  >
                    {treeState.phase === "idle"
                      ? "Ready"
                      : treeState.phase.charAt(0).toUpperCase() +
                        treeState.phase.slice(1)}
                  </span>
                </span>
              </div>
              {treeState.traversalOrder.length > 0 && (
                <span className="text-xs font-mono text-[#4a4a5e]">
                  In-order: [{treeState.traversalOrder.join(", ")}]
                </span>
              )}
            </div>

            {/* SVG Tree visualization */}
            <div
              className="flex items-center justify-center overflow-auto"
              style={{
                minHeight: "350px",
                maxHeight: "500px",
              }}
            >
              {treeState.layoutNodes.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16">
                  <TreePine size={32} style={{ color: "#2a2a3e" }} />
                  <span className="text-sm text-[#4a4a5e]">
                    Tree is empty. Insert a value or select a scenario to begin.
                  </span>
                </div>
              ) : (
                <svg
                  width="100%"
                  height={svgHeight}
                  viewBox={viewBox}
                  className="overflow-visible"
                >
                  {/* Edges */}
                  {treeState.layoutEdges.map((edge, i) => (
                    <motion.line
                      key={`edge-${i}`}
                      x1={edge.from.x}
                      y1={edge.from.y}
                      x2={edge.to.x}
                      y2={edge.to.y}
                      stroke={edge.highlighted ? SEARCHING_COLOR : "#2a2a3e"}
                      strokeWidth={edge.highlighted ? 2.5 : 1.5}
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      style={{
                        filter: edge.highlighted
                          ? `drop-shadow(0 0 4px ${SEARCHING_COLOR}60)`
                          : undefined,
                      }}
                    />
                  ))}

                  {/* Nodes */}
                  {treeState.layoutNodes.map((layoutNode) => (
                    <TreeNodeViz
                      key={layoutNode.node.id}
                      layoutNode={layoutNode}
                      treeType={treeType}
                    />
                  ))}
                </svg>
              )}
            </div>

            {/* Legend */}
            <div
              className="flex items-center justify-center gap-5 px-4 py-2.5 border-t"
              style={{ borderColor: "#1e1e2e" }}
            >
              {[
                { color: DEFAULT_NODE_COLOR, label: "Default" },
                { color: SEARCHING_COLOR, label: "Searching" },
                { color: FOUND_COLOR, label: "Found" },
                { color: INSERTING_COLOR, label: "Inserting" },
                { color: VISITED_COLOR, label: "Visited" },
                ...(treeType === "red-black"
                  ? [
                      { color: RB_RED_COLOR, label: "RB-Red" },
                      { color: RB_BLACK_COLOR, label: "RB-Black" },
                    ]
                  : []),
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{
                      background: color,
                      border: `1px solid ${color}`,
                    }}
                  />
                  <span className="text-[11px] text-[#71717a]">{label}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* ── Controls panel ────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.3,
              ease: [0.23, 1, 0.32, 1],
            }}
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
            >
              {autoValues.length > 0 && (
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                  style={{
                    background: `${INSERTING_COLOR}10`,
                    border: `1px solid ${INSERTING_COLOR}20`,
                  }}
                >
                  <span className="text-xs text-[#71717a]">
                    Queue: {autoValueIndexRef.current}/{autoValues.length}
                  </span>
                </div>
              )}
              <AnimatePresence>
                {treeState.phase === "found" && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                    style={{
                      background: `${FOUND_COLOR}15`,
                      border: `1px solid ${FOUND_COLOR}30`,
                    }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                    <span className="text-xs font-medium text-[#10b981]">
                      Found
                    </span>
                  </motion.div>
                )}
                {treeState.phase === "not-found" && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                    style={{
                      background: "rgba(239,68,68,0.1)",
                      border: "1px solid rgba(239,68,68,0.2)",
                    }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
                    <span className="text-xs font-medium text-[#ef4444]">
                      Not Found
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </ModuleControls>
          </motion.div>

          {/* ── Metrics + Log + Info panels ─────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.35,
              ease: [0.23, 1, 0.32, 1],
            }}
            className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4"
          >
            {/* Metrics panel */}
            <AnimatePresence>
              {showMetrics && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="rounded-2xl overflow-hidden"
                  style={{
                    background: "#111118",
                    border: "1px solid #1e1e2e",
                  }}
                >
                  <div className="px-5 py-3.5 border-b border-[#1e1e2e]">
                    <div className="flex items-center gap-2">
                      <Eye size={14} style={{ color: DOMAIN_COLOR }} />
                      <span className="text-sm font-semibold text-white">
                        Metrics
                      </span>
                    </div>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-3">
                    <MetricBadge
                      icon={<Layers size={12} />}
                      label="Nodes"
                      value={treeState.nodeCount}
                      color={DEFAULT_NODE_COLOR}
                    />
                    <MetricBadge
                      icon={<TreePine size={12} />}
                      label="Height"
                      value={treeState.treeHeight}
                      color={INSERTING_COLOR}
                    />
                    <MetricBadge
                      icon={<Eye size={12} />}
                      label="Comparisons"
                      value={treeState.comparisons}
                      color={SEARCHING_COLOR}
                    />
                    <MetricBadge
                      icon={<RotateCw size={12} />}
                      label="Rotations"
                      value={treeState.rotations}
                      color={ROTATING_COLOR}
                    />
                    <MetricBadge
                      icon={<GitCompareArrows size={12} />}
                      label="Balance"
                      value={treeState.balanceStatus}
                      color={
                        treeState.balanceStatus === "Balanced" ||
                        treeState.balanceStatus === "RB-Valid" ||
                        treeState.balanceStatus === "Good"
                          ? FOUND_COLOR
                          : treeState.balanceStatus === "Degenerate"
                          ? "#ef4444"
                          : SEARCHING_COLOR
                      }
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Operation log */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: "#111118",
                border: "1px solid #1e1e2e",
              }}
            >
              <div className="px-5 py-3.5 border-b border-[#1e1e2e]">
                <div className="flex items-center gap-2">
                  <Search size={14} style={{ color: DEFAULT_NODE_COLOR }} />
                  <span className="text-sm font-semibold text-white">
                    Operation Log
                  </span>
                </div>
              </div>
              <div
                className="p-4 overflow-y-auto space-y-1"
                style={{ maxHeight: "260px" }}
              >
                {treeState.log.length === 0 ? (
                  <span className="text-xs text-[#4a4a5e] italic">
                    Insert, search, or delete a value to see operations...
                  </span>
                ) : (
                  treeState.log.map((entry, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="text-xs font-mono leading-relaxed px-2 py-1 rounded"
                      style={{
                        background:
                          i === treeState.log.length - 1
                            ? `${DEFAULT_NODE_COLOR}08`
                            : "transparent",
                        color:
                          i === treeState.log.length - 1
                            ? "#a1a1aa"
                            : "#5a5a6e",
                        borderLeft:
                          i === treeState.log.length - 1
                            ? `2px solid ${DEFAULT_NODE_COLOR}`
                            : "2px solid transparent",
                      }}
                    >
                      {entry}
                    </motion.div>
                  ))
                )}
              </div>
            </div>

            {/* Educational info */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: "#111118",
                border: "1px solid #1e1e2e",
              }}
            >
              <div className="px-5 py-3.5 border-b border-[#1e1e2e]">
                <div className="flex items-center gap-2">
                  <Info size={14} style={{ color: DOMAIN_COLOR }} />
                  <span className="text-sm font-semibold text-white">
                    About {TREE_TYPE_INFO[treeType].label}
                  </span>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <div
                  className="p-3 rounded-xl"
                  style={{
                    background: `${DEFAULT_NODE_COLOR}08`,
                    border: `1px solid ${DEFAULT_NODE_COLOR}20`,
                  }}
                >
                  <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                    {TREE_TYPE_INFO[treeType].description}
                  </p>
                </div>

                {/* Complexity table */}
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                    Time Complexity
                  </span>
                  <div className="mt-2 space-y-1">
                    {treeType === "bst"
                      ? [
                          { label: "Search (avg)", value: "O(log n)", color: FOUND_COLOR },
                          { label: "Search (worst)", value: "O(n)", color: "#ef4444" },
                          { label: "Insert (avg)", value: "O(log n)", color: INSERTING_COLOR },
                          { label: "Insert (worst)", value: "O(n)", color: "#ef4444" },
                          { label: "Space", value: "O(n)", color: "#71717a" },
                        ].map(({ label, value, color }) => (
                          <div
                            key={label}
                            className="flex items-center justify-between px-2.5 py-1.5 rounded-lg"
                            style={{ background: "#0d0d14" }}
                          >
                            <span className="text-[11px] text-[#71717a]">{label}</span>
                            <span className="text-xs font-mono font-semibold" style={{ color }}>
                              {value}
                            </span>
                          </div>
                        ))
                      : [
                          { label: "Search", value: "O(log n)", color: FOUND_COLOR },
                          { label: "Insert", value: "O(log n)", color: INSERTING_COLOR },
                          { label: "Delete", value: "O(log n)", color: "#ef4444" },
                          {
                            label: "Height",
                            value: treeType === "avl" ? "1.44 log n" : "2 log n",
                            color: SEARCHING_COLOR,
                          },
                          { label: "Space", value: "O(n)", color: "#71717a" },
                        ].map(({ label, value, color }) => (
                          <div
                            key={label}
                            className="flex items-center justify-between px-2.5 py-1.5 rounded-lg"
                            style={{ background: "#0d0d14" }}
                          >
                            <span className="text-[11px] text-[#71717a]">{label}</span>
                            <span className="text-xs font-mono font-semibold" style={{ color }}>
                              {value}
                            </span>
                          </div>
                        ))}
                  </div>
                </div>

                {/* Key insight */}
                <div
                  className="p-3 rounded-xl"
                  style={{
                    background: `${DOMAIN_COLOR}08`,
                    border: `1px solid ${DOMAIN_COLOR}20`,
                  }}
                >
                  <div className="flex items-start gap-2">
                    <Zap
                      size={12}
                      style={{ color: DOMAIN_COLOR, marginTop: "2px" }}
                    />
                    <div>
                      <span
                        className="text-xs font-semibold"
                        style={{ color: DOMAIN_COLOR }}
                      >
                        Key Insight
                      </span>
                      <p className="text-[11px] text-[#a1a1aa] mt-1 leading-relaxed">
                        {treeType === "bst"
                          ? "A BST's performance depends entirely on its shape. Sorted input creates a degenerate tree with O(n) operations -- essentially a linked list."
                          : treeType === "avl"
                          ? "AVL trees maintain strict balance (|balance factor| <= 1) using rotations. This guarantees O(log n) height but may require more rotations than Red-Black trees."
                          : "Red-Black trees use a relaxed balancing scheme with node colors. They guarantee the longest path is at most twice the shortest, giving O(log n) operations with fewer rotations on average."}
                      </p>
                    </div>
                  </div>
                </div>

                {/* AVL rotation types */}
                {treeType === "avl" && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                      Rotation Types
                    </span>
                    <div className="mt-2 space-y-1">
                      {[
                        { label: "LL (Right Rotation)", desc: "Left-heavy subtree, left child is left-heavy" },
                        { label: "RR (Left Rotation)", desc: "Right-heavy subtree, right child is right-heavy" },
                        { label: "LR (Left-Right)", desc: "Left-heavy subtree, left child is right-heavy" },
                        { label: "RL (Right-Left)", desc: "Right-heavy subtree, right child is left-heavy" },
                      ].map(({ label, desc }) => (
                        <div
                          key={label}
                          className="px-2.5 py-1.5 rounded-lg"
                          style={{ background: "#0d0d14" }}
                        >
                          <span className="text-[11px] font-semibold" style={{ color: ROTATING_COLOR }}>
                            {label}
                          </span>
                          <p className="text-[10px] text-[#5a5a6e] mt-0.5">
                            {desc}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* RB tree rules */}
                {treeType === "red-black" && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                      Red-Black Rules
                    </span>
                    <div className="mt-2 space-y-1">
                      {[
                        "Every node is red or black",
                        "Root is always black",
                        "Red nodes cannot have red children",
                        "Every path from root to null has same black count",
                        "New insertions are red",
                      ].map((rule, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg"
                          style={{ background: "#0d0d14" }}
                        >
                          <span
                            className="text-[10px] font-mono font-bold mt-0.5"
                            style={{ color: i < 2 ? RB_RED_COLOR : "#4a4a5e" }}
                          >
                            {i + 1}.
                          </span>
                          <span className="text-[10px] text-[#71717a]">
                            {rule}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Close dropdowns on click outside */}
      {treeTypeDropdownOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setTreeTypeDropdownOpen(false)}
        />
      )}
    </div>
  );
}
