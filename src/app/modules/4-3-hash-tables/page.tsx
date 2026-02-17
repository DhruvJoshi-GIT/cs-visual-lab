"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Hash,
  Plus,
  Search,
  Trash2,
  Shuffle,
  Zap,
  Info,
  ArrowRight,
  AlertTriangle,
  Eye,
  Layers,
  GitCompareArrows,
  ChevronDown,
  Target,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

type CollisionStrategy =
  | "chaining"
  | "linear-probing"
  | "quadratic-probing"
  | "double-hashing";

type BucketEntryState =
  | "default"
  | "hashing"
  | "collision"
  | "probing"
  | "inserted"
  | "found"
  | "deleted"
  | "empty";

interface BucketEntry {
  key: number;
  state: BucketEntryState;
  id: string;
}

interface ChainBucket {
  entries: BucketEntry[];
  state: BucketEntryState;
}

interface OpenAddressBucket {
  entry: BucketEntry | null;
  deleted: boolean;
  state: BucketEntryState;
}

type OperationType = "insert" | "search" | "delete";

interface OperationStep {
  type: OperationType;
  key: number;
  phase: string;
  message: string;
  bucketIndex: number;
  probeSequence: number[];
  done: boolean;
}

interface HashTableState {
  chainBuckets: ChainBucket[];
  openBuckets: OpenAddressBucket[];
  tableSize: number;
  strategy: CollisionStrategy;
  entries: number;
  collisions: number;
  totalProbes: number;
  maxChainLength: number;
  log: string[];
  currentOp: OperationStep | null;
  probeHighlights: number[];
  hashDisplay: string;
}

interface ScenarioPreset {
  name: string;
  label: string;
  keys: number[];
  strategy: CollisionStrategy;
  description: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DOMAIN_COLOR = "#10b981";
const EMPTY_COLOR = "#2a2a3e";
const OCCUPIED_COLOR = "#6366f1";
const COLLISION_COLOR = "#ef4444";
const FOUND_COLOR = "#10b981";
const PROBING_COLOR = "#f59e0b";
const DELETED_COLOR = "#71717a";
const HASHING_COLOR = "#06b6d4";

const STRATEGY_INFO: Record<
  CollisionStrategy,
  { label: string; formula: string; description: string }
> = {
  chaining: {
    label: "Separate Chaining",
    formula: "h(k) = k mod m",
    description: "Each bucket stores a linked list of entries that hash to the same index.",
  },
  "linear-probing": {
    label: "Linear Probing",
    formula: "h(k, i) = (h(k) + i) mod m",
    description: "On collision, probe the next slot linearly until an empty one is found.",
  },
  "quadratic-probing": {
    label: "Quadratic Probing",
    formula: "h(k, i) = (h(k) + i\u00B2) mod m",
    description: "On collision, probe using quadratic increments to reduce clustering.",
  },
  "double-hashing": {
    label: "Double Hashing",
    formula: "h(k, i) = (h\u2081(k) + i\u00B7h\u2082(k)) mod m",
    description:
      "Uses a second hash function to determine probe step size, minimizing clustering.",
  },
};

const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    name: "no-collisions",
    label: "No Collisions",
    keys: [3, 12, 25, 36, 47, 54, 61, 78],
    strategy: "chaining",
    description: "Keys that hash to different buckets",
  },
  {
    name: "clustering",
    label: "Clustering",
    keys: [10, 20, 30, 40, 50, 60, 70, 80, 11, 21, 31],
    strategy: "linear-probing",
    description: "Keys that cause clustering in linear probing",
  },
  {
    name: "high-load",
    label: "High Load Factor",
    keys: [5, 13, 21, 29, 37, 45, 53, 61, 69, 77, 85, 93],
    strategy: "chaining",
    description: "Load factor exceeds 0.75, triggering resize",
  },
  {
    name: "delete-rehash",
    label: "Delete & Rehash",
    keys: [7, 15, 23, 31, 39, 47],
    strategy: "linear-probing",
    description: "Insert then delete to see tombstone handling",
  },
];

const DEFAULT_TABLE_SIZE = 8;

// ─── Hash functions ───────────────────────────────────────────────────────────

function hashPrimary(key: number, tableSize: number): number {
  return ((key % tableSize) + tableSize) % tableSize;
}

function hashSecondary(key: number, tableSize: number): number {
  // Use a prime smaller than tableSize for the second hash
  const prime = Math.max(1, tableSize - 1);
  return 1 + (key % prime);
}

function probe(
  key: number,
  i: number,
  tableSize: number,
  strategy: CollisionStrategy
): number {
  const h = hashPrimary(key, tableSize);
  switch (strategy) {
    case "linear-probing":
      return (h + i) % tableSize;
    case "quadratic-probing":
      return (h + i * i) % tableSize;
    case "double-hashing": {
      const h2 = hashSecondary(key, tableSize);
      return (h + i * h2) % tableSize;
    }
    default:
      return h;
  }
}

let entryIdCounter = 0;
function newEntryId(): string {
  return `entry-${++entryIdCounter}`;
}

// ─── Hash table operations (generators) ───────────────────────────────────────

function createInitialState(
  tableSize: number,
  strategy: CollisionStrategy
): HashTableState {
  return {
    chainBuckets: Array.from({ length: tableSize }, () => ({
      entries: [],
      state: "empty" as BucketEntryState,
    })),
    openBuckets: Array.from({ length: tableSize }, () => ({
      entry: null,
      deleted: false,
      state: "empty" as BucketEntryState,
    })),
    tableSize,
    strategy,
    entries: 0,
    collisions: 0,
    totalProbes: 0,
    maxChainLength: 0,
    log: [],
    currentOp: null,
    probeHighlights: [],
    hashDisplay: "",
  };
}

function countChainEntries(buckets: ChainBucket[]): number {
  return buckets.reduce((sum, b) => sum + b.entries.length, 0);
}

function countOpenEntries(buckets: OpenAddressBucket[]): number {
  return buckets.filter((b) => b.entry !== null && !b.deleted).length;
}

function maxChainLen(buckets: ChainBucket[]): number {
  return Math.max(0, ...buckets.map((b) => b.entries.length));
}

function avgProbeLen(totalProbes: number, entries: number): string {
  if (entries === 0) return "0.00";
  return (totalProbes / entries).toFixed(2);
}

// Chaining insert generator
function* chainingInsertGenerator(
  state: HashTableState,
  key: number
): Generator<HashTableState> {
  const buckets = state.chainBuckets.map((b) => ({
    entries: b.entries.map((e) => ({ ...e })),
    state: "default" as BucketEntryState,
  }));
  const tableSize = state.tableSize;
  const h = hashPrimary(key, tableSize);
  let collisions = state.collisions;
  let totalProbes = state.totalProbes + 1;
  const log = [...state.log];

  // Step 1: Show hash computation
  const hashDisplay = `h(${key}) = ${key} mod ${tableSize} = ${h}`;
  log.push(`INSERT ${key}: ${hashDisplay}`);
  buckets[h].state = "hashing";

  yield {
    ...state,
    chainBuckets: buckets,
    log: [...log],
    hashDisplay,
    probeHighlights: [h],
    currentOp: {
      type: "insert",
      key,
      phase: "hashing",
      message: hashDisplay,
      bucketIndex: h,
      probeSequence: [h],
      done: false,
    },
  };

  // Step 2: Check for collision
  const hasCollision = buckets[h].entries.length > 0;
  if (hasCollision) {
    collisions++;
    buckets[h].state = "collision";
    log.push(`  Collision at bucket ${h}! Chaining...`);

    yield {
      ...state,
      chainBuckets: buckets.map((b) => ({
        entries: b.entries.map((e) => ({ ...e })),
        state: b.state,
      })),
      collisions,
      totalProbes,
      log: [...log],
      hashDisplay,
      probeHighlights: [h],
      currentOp: {
        type: "insert",
        key,
        phase: "collision",
        message: `Collision at bucket ${h}`,
        bucketIndex: h,
        probeSequence: [h],
        done: false,
      },
    };
  }

  // Step 3: Insert into chain
  buckets[h].entries.push({
    key,
    state: "inserted",
    id: newEntryId(),
  });
  buckets[h].state = "inserted";
  const entries = countChainEntries(buckets);
  const mxChain = maxChainLen(buckets);
  log.push(`  Inserted ${key} into bucket ${h} (chain length: ${buckets[h].entries.length})`);

  yield {
    ...state,
    chainBuckets: buckets.map((b) => ({
      entries: b.entries.map((e) => ({ ...e })),
      state: b.state,
    })),
    entries,
    collisions,
    totalProbes,
    maxChainLength: mxChain,
    log: [...log],
    hashDisplay,
    probeHighlights: [h],
    currentOp: {
      type: "insert",
      key,
      phase: "inserted",
      message: `Inserted ${key} at bucket ${h}`,
      bucketIndex: h,
      probeSequence: [h],
      done: true,
    },
  };

  // Step 4: Reset states
  const finalBuckets = buckets.map((b) => ({
    entries: b.entries.map((e) => ({ ...e, state: "default" as BucketEntryState })),
    state: "default" as BucketEntryState,
  }));

  yield {
    ...state,
    chainBuckets: finalBuckets,
    entries,
    collisions,
    totalProbes,
    maxChainLength: mxChain,
    log: [...log],
    hashDisplay: "",
    probeHighlights: [],
    currentOp: null,
  };
}

// Open addressing insert generator
function* openAddressInsertGenerator(
  state: HashTableState,
  key: number
): Generator<HashTableState> {
  const buckets = state.openBuckets.map((b) => ({
    entry: b.entry ? { ...b.entry } : null,
    deleted: b.deleted,
    state: "default" as BucketEntryState,
  }));
  const tableSize = state.tableSize;
  const strategy = state.strategy;
  const h = hashPrimary(key, tableSize);
  let collisions = state.collisions;
  let totalProbes = state.totalProbes;
  const log = [...state.log];
  const probeSeq: number[] = [];

  // Step 1: Show hash computation
  const hashDisplay = `h(${key}) = ${key} mod ${tableSize} = ${h}`;
  log.push(`INSERT ${key}: ${hashDisplay}`);

  yield {
    ...state,
    openBuckets: buckets.map((b) => ({ ...b })),
    log: [...log],
    hashDisplay,
    probeHighlights: [h],
    currentOp: {
      type: "insert",
      key,
      phase: "hashing",
      message: hashDisplay,
      bucketIndex: h,
      probeSequence: [h],
      done: false,
    },
  };

  // Step 2: Probe until we find an empty slot
  for (let i = 0; i < tableSize; i++) {
    const idx = probe(key, i, tableSize, strategy);
    probeSeq.push(idx);
    totalProbes++;

    if (buckets[idx].entry !== null && !buckets[idx].deleted) {
      // Collision
      if (i > 0) collisions++;
      buckets[idx].state = "probing";
      const probeMsg =
        i === 0
          ? `  Slot ${idx} occupied (${buckets[idx].entry!.key}), probing...`
          : `  Probe ${i}: slot ${idx} occupied (${buckets[idx].entry!.key})`;
      log.push(probeMsg);

      yield {
        ...state,
        openBuckets: buckets.map((b) => ({ ...b, entry: b.entry ? { ...b.entry } : null })),
        collisions,
        totalProbes,
        log: [...log],
        hashDisplay,
        probeHighlights: [...probeSeq],
        currentOp: {
          type: "insert",
          key,
          phase: "probing",
          message: probeMsg,
          bucketIndex: idx,
          probeSequence: [...probeSeq],
          done: false,
        },
      };

      // Reset this bucket's visual state
      buckets[idx].state = "default";
    } else {
      // Found empty or deleted slot
      if (i > 0) collisions++;
      buckets[idx].entry = { key, state: "inserted", id: newEntryId() };
      buckets[idx].deleted = false;
      buckets[idx].state = "inserted";
      const entries = countOpenEntries(buckets);
      log.push(`  Inserted ${key} at slot ${idx} (probe ${i})`);

      yield {
        ...state,
        openBuckets: buckets.map((b) => ({ ...b, entry: b.entry ? { ...b.entry } : null })),
        entries,
        collisions,
        totalProbes,
        log: [...log],
        hashDisplay,
        probeHighlights: [...probeSeq],
        currentOp: {
          type: "insert",
          key,
          phase: "inserted",
          message: `Inserted ${key} at slot ${idx}`,
          bucketIndex: idx,
          probeSequence: [...probeSeq],
          done: true,
        },
      };

      // Reset states
      const finalBuckets = buckets.map((b) => ({
        entry: b.entry ? { ...b.entry, state: "default" as BucketEntryState } : null,
        deleted: b.deleted,
        state: "default" as BucketEntryState,
      }));

      yield {
        ...state,
        openBuckets: finalBuckets,
        entries,
        collisions,
        totalProbes,
        log: [...log],
        hashDisplay: "",
        probeHighlights: [],
        currentOp: null,
      };

      return;
    }
  }

  // Table full
  log.push(`  Table full! Cannot insert ${key}`);
  yield {
    ...state,
    openBuckets: buckets.map((b) => ({ ...b, entry: b.entry ? { ...b.entry } : null })),
    log: [...log],
    hashDisplay: "",
    probeHighlights: [],
    currentOp: null,
  };
}

// Search generator (works for both strategies)
function* searchGenerator(
  state: HashTableState,
  key: number
): Generator<HashTableState> {
  const strategy = state.strategy;
  const tableSize = state.tableSize;
  const h = hashPrimary(key, tableSize);
  const log = [...state.log];
  const hashDisplay = `h(${key}) = ${key} mod ${tableSize} = ${h}`;
  log.push(`SEARCH ${key}: ${hashDisplay}`);

  if (strategy === "chaining") {
    const buckets = state.chainBuckets.map((b) => ({
      entries: b.entries.map((e) => ({ ...e })),
      state: "default" as BucketEntryState,
    }));

    // Highlight target bucket
    buckets[h].state = "hashing";
    yield {
      ...state,
      chainBuckets: buckets,
      log: [...log],
      hashDisplay,
      probeHighlights: [h],
      currentOp: {
        type: "search",
        key,
        phase: "hashing",
        message: hashDisplay,
        bucketIndex: h,
        probeSequence: [h],
        done: false,
      },
    };

    // Search through chain
    const chain = buckets[h].entries;
    for (let i = 0; i < chain.length; i++) {
      chain[i].state = "probing";
      log.push(`  Comparing with ${chain[i].key}...`);

      yield {
        ...state,
        chainBuckets: buckets.map((b) => ({
          entries: b.entries.map((e) => ({ ...e })),
          state: b.state,
        })),
        log: [...log],
        hashDisplay,
        probeHighlights: [h],
        currentOp: {
          type: "search",
          key,
          phase: "probing",
          message: `Comparing with ${chain[i].key}`,
          bucketIndex: h,
          probeSequence: [h],
          done: false,
        },
      };

      if (chain[i].key === key) {
        chain[i].state = "found";
        log.push(`  Found ${key} at bucket ${h}, position ${i}!`);

        yield {
          ...state,
          chainBuckets: buckets.map((b) => ({
            entries: b.entries.map((e) => ({ ...e })),
            state: b.state,
          })),
          log: [...log],
          hashDisplay,
          probeHighlights: [h],
          currentOp: {
            type: "search",
            key,
            phase: "found",
            message: `Found ${key}!`,
            bucketIndex: h,
            probeSequence: [h],
            done: true,
          },
        };

        // Reset
        const finalBuckets = buckets.map((b) => ({
          entries: b.entries.map((e) => ({ ...e, state: "default" as BucketEntryState })),
          state: "default" as BucketEntryState,
        }));
        yield { ...state, chainBuckets: finalBuckets, log: [...log], hashDisplay: "", probeHighlights: [], currentOp: null };
        return;
      }
      chain[i].state = "default";
    }

    // Not found
    log.push(`  ${key} not found in bucket ${h}`);
    buckets[h].state = "default";
    yield {
      ...state,
      chainBuckets: buckets.map((b) => ({
        entries: b.entries.map((e) => ({ ...e })),
        state: b.state,
      })),
      log: [...log],
      hashDisplay: "",
      probeHighlights: [],
      currentOp: {
        type: "search",
        key,
        phase: "not-found",
        message: `${key} not found`,
        bucketIndex: h,
        probeSequence: [h],
        done: true,
      },
    };
  } else {
    // Open addressing search
    const buckets = state.openBuckets.map((b) => ({
      entry: b.entry ? { ...b.entry } : null,
      deleted: b.deleted,
      state: "default" as BucketEntryState,
    }));
    const probeSeq: number[] = [];

    yield {
      ...state,
      openBuckets: buckets.map((b) => ({ ...b })),
      log: [...log],
      hashDisplay,
      probeHighlights: [h],
      currentOp: {
        type: "search",
        key,
        phase: "hashing",
        message: hashDisplay,
        bucketIndex: h,
        probeSequence: [h],
        done: false,
      },
    };

    for (let i = 0; i < tableSize; i++) {
      const idx = probe(key, i, tableSize, strategy);
      probeSeq.push(idx);

      if (buckets[idx].entry === null && !buckets[idx].deleted) {
        // Empty slot = not found
        log.push(`  Slot ${idx} empty. ${key} not found.`);
        yield {
          ...state,
          openBuckets: buckets.map((b) => ({ ...b })),
          log: [...log],
          hashDisplay: "",
          probeHighlights: [],
          currentOp: {
            type: "search",
            key,
            phase: "not-found",
            message: `${key} not found`,
            bucketIndex: idx,
            probeSequence: [...probeSeq],
            done: true,
          },
        };
        return;
      }

      if (buckets[idx].entry && buckets[idx].entry!.key === key && !buckets[idx].deleted) {
        // Found
        buckets[idx].state = "found";
        buckets[idx].entry!.state = "found";
        log.push(`  Found ${key} at slot ${idx}!`);

        yield {
          ...state,
          openBuckets: buckets.map((b) => ({ ...b, entry: b.entry ? { ...b.entry } : null })),
          log: [...log],
          hashDisplay,
          probeHighlights: [...probeSeq],
          currentOp: {
            type: "search",
            key,
            phase: "found",
            message: `Found ${key}!`,
            bucketIndex: idx,
            probeSequence: [...probeSeq],
            done: true,
          },
        };

        // Reset
        const finalBuckets = buckets.map((b) => ({
          entry: b.entry ? { ...b.entry, state: "default" as BucketEntryState } : null,
          deleted: b.deleted,
          state: "default" as BucketEntryState,
        }));
        yield { ...state, openBuckets: finalBuckets, log: [...log], hashDisplay: "", probeHighlights: [], currentOp: null };
        return;
      }

      // Keep probing
      buckets[idx].state = "probing";
      log.push(`  Probe ${i}: slot ${idx} ${buckets[idx].deleted ? "(deleted)" : `has ${buckets[idx].entry?.key}`}`);

      yield {
        ...state,
        openBuckets: buckets.map((b) => ({ ...b, entry: b.entry ? { ...b.entry } : null })),
        log: [...log],
        hashDisplay,
        probeHighlights: [...probeSeq],
        currentOp: {
          type: "search",
          key,
          phase: "probing",
          message: `Probing slot ${idx}`,
          bucketIndex: idx,
          probeSequence: [...probeSeq],
          done: false,
        },
      };

      buckets[idx].state = "default";
    }

    log.push(`  ${key} not found after full probe`);
    yield {
      ...state,
      openBuckets: buckets.map((b) => ({ ...b })),
      log: [...log],
      hashDisplay: "",
      probeHighlights: [],
      currentOp: null,
    };
  }
}

// Delete generator for open addressing
function* deleteGenerator(
  state: HashTableState,
  key: number
): Generator<HashTableState> {
  const strategy = state.strategy;
  const tableSize = state.tableSize;
  const h = hashPrimary(key, tableSize);
  const log = [...state.log];
  log.push(`DELETE ${key}: h(${key}) = ${h}`);

  if (strategy === "chaining") {
    const buckets = state.chainBuckets.map((b) => ({
      entries: b.entries.map((e) => ({ ...e })),
      state: "default" as BucketEntryState,
    }));

    buckets[h].state = "hashing";
    yield {
      ...state,
      chainBuckets: buckets,
      log: [...log],
      hashDisplay: `h(${key}) = ${h}`,
      probeHighlights: [h],
      currentOp: { type: "delete", key, phase: "hashing", message: `h(${key}) = ${h}`, bucketIndex: h, probeSequence: [h], done: false },
    };

    const idx = buckets[h].entries.findIndex((e) => e.key === key);
    if (idx !== -1) {
      buckets[h].entries[idx].state = "deleted";
      log.push(`  Found ${key} at bucket ${h}, removing...`);

      yield {
        ...state,
        chainBuckets: buckets.map((b) => ({ entries: b.entries.map((e) => ({ ...e })), state: b.state })),
        log: [...log],
        hashDisplay: "",
        probeHighlights: [h],
        currentOp: { type: "delete", key, phase: "deleting", message: `Removing ${key}`, bucketIndex: h, probeSequence: [h], done: false },
      };

      buckets[h].entries.splice(idx, 1);
      const entries = countChainEntries(buckets);
      const mxChain = maxChainLen(buckets);
      log.push(`  Deleted ${key} from bucket ${h}`);

      const finalBuckets = buckets.map((b) => ({
        entries: b.entries.map((e) => ({ ...e, state: "default" as BucketEntryState })),
        state: "default" as BucketEntryState,
      }));

      yield {
        ...state,
        chainBuckets: finalBuckets,
        entries,
        maxChainLength: mxChain,
        log: [...log],
        hashDisplay: "",
        probeHighlights: [],
        currentOp: { type: "delete", key, phase: "deleted", message: `Deleted ${key}`, bucketIndex: h, probeSequence: [h], done: true },
      };
    } else {
      log.push(`  ${key} not found in bucket ${h}`);
      buckets[h].state = "default";
      yield { ...state, chainBuckets: buckets, log: [...log], hashDisplay: "", probeHighlights: [], currentOp: null };
    }
  } else {
    // Open addressing delete (tombstone)
    const buckets = state.openBuckets.map((b) => ({
      entry: b.entry ? { ...b.entry } : null,
      deleted: b.deleted,
      state: "default" as BucketEntryState,
    }));
    const probeSeq: number[] = [];

    yield {
      ...state,
      openBuckets: buckets.map((b) => ({ ...b })),
      log: [...log],
      hashDisplay: `h(${key}) = ${h}`,
      probeHighlights: [h],
      currentOp: { type: "delete", key, phase: "hashing", message: `h(${key}) = ${h}`, bucketIndex: h, probeSequence: [h], done: false },
    };

    for (let i = 0; i < tableSize; i++) {
      const idx = probe(key, i, tableSize, strategy);
      probeSeq.push(idx);

      if (buckets[idx].entry === null && !buckets[idx].deleted) {
        log.push(`  ${key} not found (empty slot ${idx})`);
        yield { ...state, openBuckets: buckets.map((b) => ({ ...b })), log: [...log], hashDisplay: "", probeHighlights: [], currentOp: null };
        return;
      }

      if (buckets[idx].entry && buckets[idx].entry!.key === key && !buckets[idx].deleted) {
        buckets[idx].state = "deleted";
        buckets[idx].entry!.state = "deleted";
        log.push(`  Found ${key} at slot ${idx}, marking as deleted (tombstone)`);

        yield {
          ...state,
          openBuckets: buckets.map((b) => ({ ...b, entry: b.entry ? { ...b.entry } : null })),
          log: [...log],
          hashDisplay: "",
          probeHighlights: [...probeSeq],
          currentOp: { type: "delete", key, phase: "deleting", message: `Deleting ${key}`, bucketIndex: idx, probeSequence: [...probeSeq], done: false },
        };

        buckets[idx].deleted = true;
        buckets[idx].entry = null;
        const entries = countOpenEntries(buckets);

        const finalBuckets = buckets.map((b) => ({
          entry: b.entry ? { ...b.entry, state: "default" as BucketEntryState } : null,
          deleted: b.deleted,
          state: "default" as BucketEntryState,
        }));

        yield {
          ...state,
          openBuckets: finalBuckets,
          entries,
          log: [...log],
          hashDisplay: "",
          probeHighlights: [],
          currentOp: { type: "delete", key, phase: "deleted", message: `Deleted ${key}`, bucketIndex: idx, probeSequence: [...probeSeq], done: true },
        };
        return;
      }

      buckets[idx].state = "probing";
      log.push(`  Probe ${i}: slot ${idx} ${buckets[idx].deleted ? "(tombstone)" : `has ${buckets[idx].entry?.key}`}`);

      yield {
        ...state,
        openBuckets: buckets.map((b) => ({ ...b, entry: b.entry ? { ...b.entry } : null })),
        log: [...log],
        hashDisplay: "",
        probeHighlights: [...probeSeq],
        currentOp: { type: "delete", key, phase: "probing", message: `Probing slot ${idx}`, bucketIndex: idx, probeSequence: [...probeSeq], done: false },
      };
      buckets[idx].state = "default";
    }

    log.push(`  ${key} not found`);
    yield { ...state, openBuckets: buckets.map((b) => ({ ...b })), log: [...log], hashDisplay: "", probeHighlights: [], currentOp: null };
  }
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

// ─── Bucket visualization components ──────────────────────────────────────────

function ChainBucketViz({
  bucket,
  index,
  isHighlighted,
}: {
  bucket: ChainBucket;
  index: number;
  isHighlighted: boolean;
}) {
  const getBucketBg = () => {
    if (bucket.state === "hashing") return HASHING_COLOR;
    if (bucket.state === "collision") return COLLISION_COLOR;
    if (bucket.state === "inserted") return FOUND_COLOR;
    if (isHighlighted) return `${PROBING_COLOR}40`;
    return bucket.entries.length > 0 ? `${OCCUPIED_COLOR}20` : "#1a1a24";
  };

  const getBucketBorder = () => {
    if (bucket.state === "hashing") return HASHING_COLOR;
    if (bucket.state === "collision") return COLLISION_COLOR;
    if (bucket.state === "inserted") return FOUND_COLOR;
    if (isHighlighted) return PROBING_COLOR;
    return "#2a2a3e";
  };

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Bucket header */}
      <div
        className="flex items-center justify-center w-14 h-10 rounded-lg font-mono text-xs font-semibold transition-all duration-200"
        style={{
          background: getBucketBg(),
          border: `1.5px solid ${getBucketBorder()}`,
          color:
            bucket.state !== "default" && bucket.state !== "empty"
              ? "#ffffff"
              : "#71717a",
          boxShadow:
            bucket.state === "hashing"
              ? `0 0 12px ${HASHING_COLOR}40`
              : bucket.state === "collision"
              ? `0 0 12px ${COLLISION_COLOR}40`
              : "none",
        }}
      >
        [{index}]
      </div>

      {/* Chain entries */}
      <div className="flex flex-col items-center gap-0.5 min-h-[24px]">
        {bucket.entries.map((entry, i) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center"
          >
            {i > 0 && (
              <div className="w-px h-2" style={{ background: "#3a3a4e" }} />
            )}
            <div
              className="flex items-center justify-center w-12 h-8 rounded-md font-mono text-xs font-semibold transition-all duration-200"
              style={{
                background:
                  entry.state === "found"
                    ? FOUND_COLOR
                    : entry.state === "inserted"
                    ? `${FOUND_COLOR}30`
                    : entry.state === "probing"
                    ? `${PROBING_COLOR}30`
                    : entry.state === "deleted"
                    ? `${COLLISION_COLOR}30`
                    : `${OCCUPIED_COLOR}20`,
                border: `1px solid ${
                  entry.state === "found"
                    ? FOUND_COLOR
                    : entry.state === "inserted"
                    ? FOUND_COLOR
                    : entry.state === "probing"
                    ? PROBING_COLOR
                    : entry.state === "deleted"
                    ? COLLISION_COLOR
                    : `${OCCUPIED_COLOR}40`
                }`,
                color:
                  entry.state === "found" || entry.state === "deleted"
                    ? "#ffffff"
                    : "#a1a1aa",
              }}
            >
              {entry.key}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function OpenBucketViz({
  bucket,
  index,
  isHighlighted,
  probeIndex,
}: {
  bucket: OpenAddressBucket;
  index: number;
  isHighlighted: boolean;
  probeIndex: number;
}) {
  const getBg = () => {
    if (bucket.state === "found") return FOUND_COLOR;
    if (bucket.state === "inserted") return `${FOUND_COLOR}30`;
    if (bucket.state === "probing") return `${PROBING_COLOR}30`;
    if (bucket.state === "deleted") return `${COLLISION_COLOR}30`;
    if (bucket.state === "hashing") return `${HASHING_COLOR}30`;
    if (isHighlighted) return `${PROBING_COLOR}15`;
    if (bucket.deleted) return `${DELETED_COLOR}15`;
    if (bucket.entry) return `${OCCUPIED_COLOR}15`;
    return "#1a1a24";
  };

  const getBorder = () => {
    if (bucket.state === "found") return FOUND_COLOR;
    if (bucket.state === "inserted") return FOUND_COLOR;
    if (bucket.state === "probing") return PROBING_COLOR;
    if (bucket.state === "deleted") return COLLISION_COLOR;
    if (bucket.state === "hashing") return HASHING_COLOR;
    if (isHighlighted) return PROBING_COLOR;
    if (bucket.deleted) return DELETED_COLOR;
    if (bucket.entry) return `${OCCUPIED_COLOR}40`;
    return "#2a2a3e";
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="flex items-center justify-center w-16 h-12 rounded-lg font-mono text-sm font-semibold transition-all duration-200 relative"
        style={{
          background: getBg(),
          border: `1.5px solid ${getBorder()}`,
          color:
            bucket.state === "found"
              ? "#ffffff"
              : bucket.entry
              ? "#a1a1aa"
              : bucket.deleted
              ? "#4a4a5e"
              : "#3a3a4e",
          boxShadow:
            bucket.state === "found"
              ? `0 0 16px ${FOUND_COLOR}40`
              : bucket.state === "probing"
              ? `0 0 8px ${PROBING_COLOR}30`
              : "none",
        }}
      >
        {bucket.deleted ? (
          <Trash2 size={14} style={{ color: DELETED_COLOR }} />
        ) : bucket.entry ? (
          bucket.entry.key
        ) : (
          <span className="text-[10px] text-[#3a3a4e]">empty</span>
        )}
        {isHighlighted && probeIndex >= 0 && (
          <span
            className="absolute -top-2 -right-2 flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold"
            style={{
              background: PROBING_COLOR,
              color: "#000",
            }}
          >
            {probeIndex}
          </span>
        )}
      </div>
      <span className="text-[10px] font-mono text-[#4a4a5e]">{index}</span>
    </div>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function HashTablesPage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [strategy, setStrategy] = useState<CollisionStrategy>("chaining");
  const [tableSize, setTableSize] = useState(DEFAULT_TABLE_SIZE);
  const [showMetrics, setShowMetrics] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [activeScenario, setActiveScenario] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [strategyDropdownOpen, setStrategyDropdownOpen] = useState(false);

  // ── Hash table state ────────────────────────────────────────────────────────
  const [htState, setHtState] = useState<HashTableState>(() =>
    createInitialState(DEFAULT_TABLE_SIZE, "chaining")
  );

  // ── Auto-play queue ─────────────────────────────────────────────────────────
  const [autoKeys, setAutoKeys] = useState<number[]>([]);
  const autoKeyIndexRef = useRef(0);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const generatorRef = useRef<Generator<HashTableState> | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const htStateRef = useRef<HashTableState>(htState);

  // Keep refs in sync
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    htStateRef.current = htState;
  }, [htState]);

  // ── Step forward ────────────────────────────────────────────────────────────
  const stepForward = useCallback((): boolean => {
    if (generatorRef.current) {
      const result = generatorRef.current.next();
      if (!result.done) {
        setHtState(result.value);
        return true;
      }
      generatorRef.current = null;
    }

    // Check if we have auto-play keys
    if (autoKeyIndexRef.current < autoKeys.length) {
      const key = autoKeys[autoKeyIndexRef.current];
      autoKeyIndexRef.current++;
      const currentState = htStateRef.current;

      if (currentState.strategy === "chaining") {
        generatorRef.current = chainingInsertGenerator(currentState, key);
      } else {
        generatorRef.current = openAddressInsertGenerator(currentState, key);
      }

      const result = generatorRef.current.next();
      if (!result.done) {
        setHtState(result.value);
        return true;
      }
    }

    setIsComplete(true);
    setIsPlaying(false);
    isPlayingRef.current = false;
    return false;
  }, [autoKeys]);

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
    if (isComplete && autoKeys.length === 0) return;
    setIsPlaying(true);
    isPlayingRef.current = true;
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop, isComplete, autoKeys]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const handleStep = useCallback(() => {
    if (isComplete && autoKeys.length === 0) return;
    handlePause();
    stepForward();
  }, [handlePause, stepForward, isComplete, autoKeys]);

  const handleReset = useCallback(() => {
    handlePause();
    generatorRef.current = null;
    autoKeyIndexRef.current = 0;
    setIsComplete(false);
    setAutoKeys([]);
    const newState = createInitialState(tableSize, strategy);
    setHtState(newState);
    htStateRef.current = newState;
  }, [handlePause, tableSize, strategy]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // ── Operations ──────────────────────────────────────────────────────────────
  const handleInsert = useCallback(
    (key: number) => {
      handlePause();
      generatorRef.current = null;
      setIsComplete(false);
      const currentState = htStateRef.current;
      if (strategy === "chaining") {
        generatorRef.current = chainingInsertGenerator(currentState, key);
      } else {
        generatorRef.current = openAddressInsertGenerator(currentState, key);
      }
    },
    [handlePause, strategy]
  );

  const handleSearch = useCallback(
    (key: number) => {
      handlePause();
      generatorRef.current = null;
      setIsComplete(false);
      const currentState = htStateRef.current;
      generatorRef.current = searchGenerator(currentState, key);
    },
    [handlePause]
  );

  const handleDelete = useCallback(
    (key: number) => {
      handlePause();
      generatorRef.current = null;
      setIsComplete(false);
      const currentState = htStateRef.current;
      generatorRef.current = deleteGenerator(currentState, key);
    },
    [handlePause]
  );

  const handleRandomKey = useCallback(() => {
    const key = Math.floor(Math.random() * 99) + 1;
    setKeyInput(String(key));
    return key;
  }, []);

  // ── Scenario handling ───────────────────────────────────────────────────────
  const handleScenarioChange = useCallback(
    (scenarioName: string) => {
      handlePause();
      setActiveScenario(scenarioName);
      const scenario = SCENARIO_PRESETS.find((s) => s.name === scenarioName);
      if (scenario) {
        setStrategy(scenario.strategy);
        generatorRef.current = null;
        autoKeyIndexRef.current = 0;
        setIsComplete(false);
        const newState = createInitialState(tableSize, scenario.strategy);
        setHtState(newState);
        htStateRef.current = newState;
        setAutoKeys(scenario.keys);
      }
    },
    [handlePause, tableSize]
  );

  // ── Strategy change ─────────────────────────────────────────────────────────
  const handleStrategyChange = useCallback(
    (newStrategy: CollisionStrategy) => {
      setStrategy(newStrategy);
      setStrategyDropdownOpen(false);
      handlePause();
      generatorRef.current = null;
      autoKeyIndexRef.current = 0;
      setIsComplete(false);
      setAutoKeys([]);
      const newState = createInitialState(tableSize, newStrategy);
      setHtState(newState);
      htStateRef.current = newState;
    },
    [handlePause, tableSize]
  );

  // ── Computed values ─────────────────────────────────────────────────────────
  const loadFactor =
    strategy === "chaining"
      ? countChainEntries(htState.chainBuckets) / tableSize
      : countOpenEntries(htState.openBuckets) / tableSize;
  const isHighLoad = loadFactor > 0.75;

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
                4.3
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Hash Tables
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Explore how hash tables store and retrieve data using hash functions,
              and how different collision resolution strategies handle conflicts.
              Watch insertions, searches, and deletions step by step.
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
                Prerequisite: Arrays, Modular Arithmetic
              </span>
            </div>
          </motion.div>

          {/* ── Controls row ────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
            className="flex flex-wrap items-center gap-3 mb-4"
          >
            {/* Strategy selector */}
            <div className="relative">
              <button
                onClick={() => setStrategyDropdownOpen(!strategyDropdownOpen)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: "#111118",
                  border: "1px solid #1e1e2e",
                }}
              >
                <Hash size={14} style={{ color: OCCUPIED_COLOR }} />
                {STRATEGY_INFO[strategy].label}
                <ChevronDown
                  size={14}
                  className="text-[#71717a]"
                  style={{
                    transform: strategyDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 200ms ease",
                  }}
                />
              </button>

              <AnimatePresence>
                {strategyDropdownOpen && (
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
                      minWidth: "240px",
                    }}
                  >
                    {(
                      Object.keys(STRATEGY_INFO) as CollisionStrategy[]
                    ).map((key) => (
                      <button
                        key={key}
                        onClick={() => handleStrategyChange(key)}
                        className="w-full flex flex-col px-4 py-2.5 text-sm text-left transition-all duration-150"
                        style={{
                          color: strategy === key ? OCCUPIED_COLOR : "#a1a1aa",
                          background:
                            strategy === key
                              ? `${OCCUPIED_COLOR}10`
                              : "transparent",
                        }}
                        onMouseEnter={(e) => {
                          if (strategy !== key) e.currentTarget.style.background = "#16161f";
                        }}
                        onMouseLeave={(e) => {
                          if (strategy !== key) e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <span className="font-medium">{STRATEGY_INFO[key].label}</span>
                        <span className="text-[10px] font-mono text-[#71717a]">
                          {STRATEGY_INFO[key].formula}
                        </span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Key input + operations */}
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm"
              style={{
                background: "#111118",
                border: "1px solid #1e1e2e",
              }}
            >
              <span className="text-xs text-[#71717a]">Key:</span>
              <input
                type="number"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                className="w-14 bg-transparent text-white text-sm font-mono outline-none border-b border-[#2a2a3e] focus:border-[#6366f1] transition-colors text-center"
                placeholder="0"
              />
              <button
                onClick={() => {
                  const k = parseInt(keyInput);
                  if (!isNaN(k)) handleInsert(k);
                }}
                className="px-2 py-1 rounded-lg text-xs font-medium text-[#10b981] hover:bg-[#10b981]/10 transition-colors"
                title="Insert key"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => {
                  const k = parseInt(keyInput);
                  if (!isNaN(k)) handleSearch(k);
                }}
                className="px-2 py-1 rounded-lg text-xs font-medium text-[#06b6d4] hover:bg-[#06b6d4]/10 transition-colors"
                title="Search key"
              >
                <Search size={14} />
              </button>
              <button
                onClick={() => {
                  const k = parseInt(keyInput);
                  if (!isNaN(k)) handleDelete(k);
                }}
                className="px-2 py-1 rounded-lg text-xs font-medium text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
                title="Delete key"
              >
                <Trash2 size={14} />
              </button>
            </div>

            <button
              onClick={() => {
                const k = handleRandomKey();
                handleInsert(k);
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
                      activeScenario === s.name ? `${DOMAIN_COLOR}18` : "transparent",
                    color: activeScenario === s.name ? DOMAIN_COLOR : "#71717a",
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

          {/* ── Table size slider ──────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: [0.23, 1, 0.32, 1] }}
            className="flex items-center gap-4 mb-4 px-1"
          >
            <span className="text-xs text-[#71717a] font-medium whitespace-nowrap">
              Buckets
            </span>
            <input
              type="range"
              min={4}
              max={16}
              step={1}
              value={tableSize}
              onChange={(e) => {
                const newSize = parseInt(e.target.value);
                setTableSize(newSize);
                handleReset();
              }}
              className="flex-1 max-w-xs h-1.5 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#10b981] [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-[#10b981]/30"
              style={{ background: "#1e1e2e" }}
            />
            <span
              className="text-xs font-mono font-semibold tabular-nums min-w-[2.5rem] text-center"
              style={{ color: DOMAIN_COLOR }}
            >
              {tableSize}
            </span>

            {/* Load factor */}
            <div className="flex items-center gap-2 ml-4">
              <span className="text-xs text-[#71717a]">Load Factor:</span>
              <span
                className="text-xs font-mono font-semibold"
                style={{
                  color: isHighLoad ? COLLISION_COLOR : DOMAIN_COLOR,
                }}
              >
                {loadFactor.toFixed(2)}
              </span>
              {isHighLoad && (
                <AlertTriangle size={12} style={{ color: COLLISION_COLOR }} />
              )}
            </div>
          </motion.div>

          {/* ── Visualization area ────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="rounded-2xl overflow-hidden mb-4"
            style={{
              background: "#111118",
              border: "1px solid #1e1e2e",
              boxShadow:
                "0 0 0 1px rgba(16,185,129,0.03), 0 20px 50px -12px rgba(0,0,0,0.5)",
            }}
          >
            {/* Hash function display */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-3">
                <Hash size={14} style={{ color: OCCUPIED_COLOR }} />
                <span className="text-sm text-white font-medium">
                  {STRATEGY_INFO[strategy].label}
                </span>
                <span className="text-xs font-mono text-[#71717a]">
                  {STRATEGY_INFO[strategy].formula}
                </span>
              </div>
              {htState.hashDisplay && (
                <motion.div
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-2"
                >
                  <ArrowRight size={12} style={{ color: HASHING_COLOR }} />
                  <span
                    className="text-xs font-mono font-semibold"
                    style={{ color: HASHING_COLOR }}
                  >
                    {htState.hashDisplay}
                  </span>
                </motion.div>
              )}
            </div>

            {/* Buckets visualization */}
            <div
              className="flex items-start justify-center gap-2 px-4 py-6 overflow-x-auto"
              style={{ minHeight: strategy === "chaining" ? "280px" : "160px" }}
            >
              {strategy === "chaining"
                ? htState.chainBuckets.map((bucket, index) => (
                    <ChainBucketViz
                      key={index}
                      bucket={bucket}
                      index={index}
                      isHighlighted={htState.probeHighlights.includes(index)}
                    />
                  ))
                : htState.openBuckets.map((bucket, index) => (
                    <OpenBucketViz
                      key={index}
                      bucket={bucket}
                      index={index}
                      isHighlighted={htState.probeHighlights.includes(index)}
                      probeIndex={htState.probeHighlights.indexOf(index)}
                    />
                  ))}
            </div>

            {/* Operation status */}
            <AnimatePresence>
              {htState.currentOp && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center justify-center gap-2 px-4 py-3 mx-4 mb-4 rounded-xl"
                  style={{
                    background:
                      htState.currentOp.phase === "found"
                        ? `${FOUND_COLOR}15`
                        : htState.currentOp.phase === "collision"
                        ? `${COLLISION_COLOR}15`
                        : htState.currentOp.phase === "inserted"
                        ? `${FOUND_COLOR}15`
                        : `${HASHING_COLOR}15`,
                    border: `1px solid ${
                      htState.currentOp.phase === "found"
                        ? `${FOUND_COLOR}30`
                        : htState.currentOp.phase === "collision"
                        ? `${COLLISION_COLOR}30`
                        : htState.currentOp.phase === "inserted"
                        ? `${FOUND_COLOR}30`
                        : `${HASHING_COLOR}30`
                    }`,
                  }}
                >
                  <span
                    className="text-xs font-mono font-medium"
                    style={{
                      color:
                        htState.currentOp.phase === "found"
                          ? FOUND_COLOR
                          : htState.currentOp.phase === "collision"
                          ? COLLISION_COLOR
                          : htState.currentOp.phase === "inserted"
                          ? FOUND_COLOR
                          : HASHING_COLOR,
                    }}
                  >
                    {htState.currentOp.message}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Legend */}
            <div
              className="flex items-center justify-center gap-5 px-4 py-2.5 border-t"
              style={{ borderColor: "#1e1e2e" }}
            >
              {[
                { color: EMPTY_COLOR, label: "Empty" },
                { color: OCCUPIED_COLOR, label: "Occupied" },
                { color: COLLISION_COLOR, label: "Collision" },
                { color: PROBING_COLOR, label: "Probing" },
                { color: FOUND_COLOR, label: "Found/Inserted" },
                { color: DELETED_COLOR, label: "Deleted" },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-sm"
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
            transition={{ duration: 0.5, delay: 0.3, ease: [0.23, 1, 0.32, 1] }}
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
              {autoKeys.length > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                  style={{
                    background: `${HASHING_COLOR}10`,
                    border: `1px solid ${HASHING_COLOR}20`,
                  }}
                >
                  <span className="text-xs text-[#71717a]">
                    Queue: {autoKeyIndexRef.current}/{autoKeys.length}
                  </span>
                </div>
              )}
            </ModuleControls>
          </motion.div>

          {/* ── Metrics + Log + Info panels ─────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35, ease: [0.23, 1, 0.32, 1] }}
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
                      label="Entries"
                      value={
                        strategy === "chaining"
                          ? countChainEntries(htState.chainBuckets)
                          : countOpenEntries(htState.openBuckets)
                      }
                      color={OCCUPIED_COLOR}
                    />
                    <MetricBadge
                      icon={<Target size={12} />}
                      label="Load Factor"
                      value={loadFactor.toFixed(2)}
                      color={isHighLoad ? COLLISION_COLOR : DOMAIN_COLOR}
                    />
                    <MetricBadge
                      icon={<GitCompareArrows size={12} />}
                      label="Collisions"
                      value={htState.collisions}
                      color={COLLISION_COLOR}
                    />
                    <MetricBadge
                      icon={<ArrowRight size={12} />}
                      label="Avg Probes"
                      value={avgProbeLen(
                        htState.totalProbes,
                        strategy === "chaining"
                          ? countChainEntries(htState.chainBuckets)
                          : countOpenEntries(htState.openBuckets)
                      )}
                      color={PROBING_COLOR}
                    />
                    {strategy === "chaining" && (
                      <MetricBadge
                        icon={<Layers size={12} />}
                        label="Max Chain"
                        value={htState.maxChainLength}
                        color={HASHING_COLOR}
                      />
                    )}
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
                  <Search size={14} style={{ color: OCCUPIED_COLOR }} />
                  <span className="text-sm font-semibold text-white">
                    Operation Log
                  </span>
                </div>
              </div>
              <div
                className="p-4 overflow-y-auto space-y-1"
                style={{ maxHeight: "260px" }}
              >
                {htState.log.length === 0 ? (
                  <span className="text-xs text-[#4a4a5e] italic">
                    Insert, search, or delete a key to see operations...
                  </span>
                ) : (
                  htState.log.map((entry, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="text-xs font-mono leading-relaxed px-2 py-1 rounded"
                      style={{
                        background:
                          i === htState.log.length - 1
                            ? `${OCCUPIED_COLOR}08`
                            : "transparent",
                        color:
                          i === htState.log.length - 1 ? "#a1a1aa" : "#5a5a6e",
                        borderLeft:
                          i === htState.log.length - 1
                            ? `2px solid ${OCCUPIED_COLOR}`
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
                    How It Works
                  </span>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <div
                  className="p-3 rounded-xl"
                  style={{
                    background: `${OCCUPIED_COLOR}08`,
                    border: `1px solid ${OCCUPIED_COLOR}20`,
                  }}
                >
                  <span
                    className="text-xs font-semibold"
                    style={{ color: OCCUPIED_COLOR }}
                  >
                    {STRATEGY_INFO[strategy].label}
                  </span>
                  <p className="text-[11px] text-[#a1a1aa] mt-1 leading-relaxed">
                    {STRATEGY_INFO[strategy].description}
                  </p>
                </div>

                {/* Complexity table */}
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                    Time Complexity
                  </span>
                  <div className="mt-2 space-y-1">
                    {[
                      {
                        label: "Insert (avg)",
                        value: strategy === "chaining" ? "O(1)" : "O(1)",
                        color: FOUND_COLOR,
                      },
                      {
                        label: "Search (avg)",
                        value: "O(1+\u03B1)",
                        color: "#f59e0b",
                      },
                      {
                        label: "Delete (avg)",
                        value: strategy === "chaining" ? "O(1+\u03B1)" : "O(1/(1-\u03B1))",
                        color: COLLISION_COLOR,
                      },
                      {
                        label: "Worst case",
                        value: "O(n)",
                        color: "#ef4444",
                      },
                    ].map(({ label, value, color }) => (
                      <div
                        key={label}
                        className="flex items-center justify-between px-2.5 py-1.5 rounded-lg"
                        style={{ background: "#0d0d14" }}
                      >
                        <span className="text-[11px] text-[#71717a]">{label}</span>
                        <span
                          className="text-xs font-mono font-semibold"
                          style={{ color }}
                        >
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Load factor warning */}
                {isHighLoad && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 rounded-xl"
                    style={{
                      background: `${COLLISION_COLOR}10`,
                      border: `1px solid ${COLLISION_COLOR}25`,
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        size={12}
                        style={{ color: COLLISION_COLOR, marginTop: "2px" }}
                      />
                      <div>
                        <span
                          className="text-xs font-semibold"
                          style={{ color: COLLISION_COLOR }}
                        >
                          High Load Factor!
                        </span>
                        <p className="text-[11px] text-[#a1a1aa] mt-0.5 leading-relaxed">
                          Load factor {loadFactor.toFixed(2)} exceeds 0.75.
                          Performance degrades significantly. In practice, the
                          table would resize (double) and rehash all entries.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Key insight */}
                <div
                  className="p-3 rounded-xl"
                  style={{
                    background: `${DOMAIN_COLOR}08`,
                    border: `1px solid ${DOMAIN_COLOR}20`,
                  }}
                >
                  <div className="flex items-start gap-2">
                    <Zap size={12} style={{ color: DOMAIN_COLOR, marginTop: "2px" }} />
                    <div>
                      <span className="text-xs font-semibold" style={{ color: DOMAIN_COLOR }}>
                        Key Insight
                      </span>
                      <p className="text-[11px] text-[#a1a1aa] mt-1 leading-relaxed">
                        Hash tables provide O(1) average-case operations by using
                        a hash function to map keys directly to array positions.
                        The load factor (\u03B1 = n/m) determines how full the table
                        is and directly impacts performance.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Close dropdowns on click outside */}
      {strategyDropdownOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setStrategyDropdownOpen(false)}
        />
      )}
    </div>
  );
}
