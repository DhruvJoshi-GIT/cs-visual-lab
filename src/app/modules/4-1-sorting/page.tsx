"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shuffle,
  SlidersHorizontal,
  GitCompareArrows,
  ChevronDown,
  Zap,
  Clock,
  ArrowUpDown,
  Eye,
  Layers,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ─── Types ────────────────────────────────────────────────────────────────────

type BarState = "default" | "comparing" | "swapping" | "sorted" | "pivot";

interface SortState {
  array: number[];
  states: BarState[];
  comparisons: number;
  swaps: number;
  arrayAccesses: number;
}

type AlgorithmName =
  | "bubble"
  | "selection"
  | "insertion"
  | "merge"
  | "quick"
  | "heap";

interface AlgorithmInfo {
  name: string;
  label: string;
  timeAvg: string;
  timeWorst: string;
  timeBest: string;
  space: string;
  stable: boolean;
}

type Distribution = "random" | "nearly-sorted" | "reversed" | "few-unique";

// ─── Algorithm metadata ───────────────────────────────────────────────────────

const ALGORITHMS: Record<AlgorithmName, AlgorithmInfo> = {
  bubble: {
    name: "bubble",
    label: "Bubble Sort",
    timeAvg: "O(n\u00B2)",
    timeWorst: "O(n\u00B2)",
    timeBest: "O(n)",
    space: "O(1)",
    stable: true,
  },
  selection: {
    name: "selection",
    label: "Selection Sort",
    timeAvg: "O(n\u00B2)",
    timeWorst: "O(n\u00B2)",
    timeBest: "O(n\u00B2)",
    space: "O(1)",
    stable: false,
  },
  insertion: {
    name: "insertion",
    label: "Insertion Sort",
    timeAvg: "O(n\u00B2)",
    timeWorst: "O(n\u00B2)",
    timeBest: "O(n)",
    space: "O(1)",
    stable: true,
  },
  merge: {
    name: "merge",
    label: "Merge Sort",
    timeAvg: "O(n log n)",
    timeWorst: "O(n log n)",
    timeBest: "O(n log n)",
    space: "O(n)",
    stable: true,
  },
  quick: {
    name: "quick",
    label: "Quick Sort",
    timeAvg: "O(n log n)",
    timeWorst: "O(n\u00B2)",
    timeBest: "O(n log n)",
    space: "O(log n)",
    stable: false,
  },
  heap: {
    name: "heap",
    label: "Heap Sort",
    timeAvg: "O(n log n)",
    timeWorst: "O(n log n)",
    timeBest: "O(n log n)",
    space: "O(1)",
    stable: false,
  },
};

const ALGORITHM_KEYS: AlgorithmName[] = [
  "bubble",
  "selection",
  "insertion",
  "merge",
  "quick",
  "heap",
];

// ─── Color map ────────────────────────────────────────────────────────────────

const BAR_COLORS: Record<BarState, { bg: string; border: string }> = {
  default: { bg: "#2a2a3e", border: "#1e1e2e" },
  comparing: { bg: "#f59e0b", border: "#d97706" },
  swapping: { bg: "#ef4444", border: "#dc2626" },
  sorted: { bg: "#10b981", border: "#059669" },
  pivot: { bg: "#6366f1", border: "#4f46e5" },
};

// ─── Array generation ─────────────────────────────────────────────────────────

function generateArray(size: number, distribution: Distribution): number[] {
  const arr: number[] = [];
  switch (distribution) {
    case "random":
      for (let i = 0; i < size; i++) {
        arr.push(Math.floor(Math.random() * 95) + 5);
      }
      break;
    case "nearly-sorted":
      for (let i = 0; i < size; i++) {
        arr.push(Math.floor(((i + 1) / size) * 90) + 5);
      }
      // swap ~10% of elements
      for (let i = 0; i < Math.floor(size * 0.1); i++) {
        const a = Math.floor(Math.random() * size);
        const b = Math.floor(Math.random() * size);
        [arr[a], arr[b]] = [arr[b], arr[a]];
      }
      break;
    case "reversed":
      for (let i = 0; i < size; i++) {
        arr.push(Math.floor(((size - i) / size) * 90) + 5);
      }
      break;
    case "few-unique":
      {
        const values = [15, 35, 55, 75, 95];
        for (let i = 0; i < size; i++) {
          arr.push(values[Math.floor(Math.random() * values.length)]);
        }
      }
      break;
  }
  return arr;
}

// ─── Sorting algorithm generators ─────────────────────────────────────────────

function makeDefaultStates(n: number): BarState[] {
  return new Array(n).fill("default");
}

function* bubbleSortGenerator(inputArr: number[]): Generator<SortState> {
  const arr = [...inputArr];
  const n = arr.length;
  let comparisons = 0;
  let swaps = 0;
  let arrayAccesses = 0;

  for (let i = 0; i < n - 1; i++) {
    let swapped = false;
    for (let j = 0; j < n - 1 - i; j++) {
      const states = makeDefaultStates(n);
      // mark sorted portion
      for (let k = n - i; k < n; k++) states[k] = "sorted";
      states[j] = "comparing";
      states[j + 1] = "comparing";
      comparisons++;
      arrayAccesses += 2;
      yield { array: [...arr], states, comparisons, swaps, arrayAccesses };

      if (arr[j] > arr[j + 1]) {
        [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
        swaps++;
        arrayAccesses += 4; // 2 reads + 2 writes
        const swapStates = makeDefaultStates(n);
        for (let k = n - i; k < n; k++) swapStates[k] = "sorted";
        swapStates[j] = "swapping";
        swapStates[j + 1] = "swapping";
        yield {
          array: [...arr],
          states: swapStates,
          comparisons,
          swaps,
          arrayAccesses,
        };
        swapped = true;
      }
    }
    // mark as sorted
    const mark = makeDefaultStates(n);
    for (let k = n - 1 - i; k < n; k++) mark[k] = "sorted";
    yield { array: [...arr], states: mark, comparisons, swaps, arrayAccesses };

    if (!swapped) break;
  }

  // final sorted
  const finalStates: BarState[] = new Array(n).fill("sorted");
  yield { array: [...arr], states: finalStates, comparisons, swaps, arrayAccesses };
}

function* selectionSortGenerator(inputArr: number[]): Generator<SortState> {
  const arr = [...inputArr];
  const n = arr.length;
  let comparisons = 0;
  let swaps = 0;
  let arrayAccesses = 0;

  for (let i = 0; i < n - 1; i++) {
    let minIdx = i;

    for (let j = i + 1; j < n; j++) {
      const states = makeDefaultStates(n);
      for (let k = 0; k < i; k++) states[k] = "sorted";
      states[minIdx] = "pivot";
      states[j] = "comparing";
      comparisons++;
      arrayAccesses += 2;
      yield { array: [...arr], states, comparisons, swaps, arrayAccesses };

      if (arr[j] < arr[minIdx]) {
        minIdx = j;
      }
    }

    if (minIdx !== i) {
      [arr[i], arr[minIdx]] = [arr[minIdx], arr[i]];
      swaps++;
      arrayAccesses += 4;
      const swapStates = makeDefaultStates(n);
      for (let k = 0; k < i; k++) swapStates[k] = "sorted";
      swapStates[i] = "swapping";
      swapStates[minIdx] = "swapping";
      yield {
        array: [...arr],
        states: swapStates,
        comparisons,
        swaps,
        arrayAccesses,
      };
    }

    const mark = makeDefaultStates(n);
    for (let k = 0; k <= i; k++) mark[k] = "sorted";
    yield { array: [...arr], states: mark, comparisons, swaps, arrayAccesses };
  }

  const finalStates: BarState[] = new Array(n).fill("sorted");
  yield { array: [...arr], states: finalStates, comparisons, swaps, arrayAccesses };
}

function* insertionSortGenerator(inputArr: number[]): Generator<SortState> {
  const arr = [...inputArr];
  const n = arr.length;
  let comparisons = 0;
  let swaps = 0;
  let arrayAccesses = 0;

  for (let i = 1; i < n; i++) {
    const key = arr[i];
    arrayAccesses++;
    let j = i - 1;

    // highlight current key
    const keyStates = makeDefaultStates(n);
    for (let k = 0; k < i; k++) keyStates[k] = "sorted";
    keyStates[i] = "pivot";
    yield { array: [...arr], states: keyStates, comparisons, swaps, arrayAccesses };

    while (j >= 0 && arr[j] > key) {
      comparisons++;
      arrayAccesses += 2;

      const states = makeDefaultStates(n);
      for (let k = 0; k < i; k++) states[k] = "sorted";
      states[j] = "comparing";
      states[j + 1] = "swapping";
      yield { array: [...arr], states, comparisons, swaps, arrayAccesses };

      arr[j + 1] = arr[j];
      swaps++;
      arrayAccesses += 2;
      j--;
    }

    if (j >= 0) {
      comparisons++;
      arrayAccesses++;
    }

    arr[j + 1] = key;
    arrayAccesses++;

    const mark = makeDefaultStates(n);
    for (let k = 0; k <= i; k++) mark[k] = "sorted";
    yield { array: [...arr], states: mark, comparisons, swaps, arrayAccesses };
  }

  const finalStates: BarState[] = new Array(n).fill("sorted");
  yield { array: [...arr], states: finalStates, comparisons, swaps, arrayAccesses };
}

function* mergeSortGenerator(inputArr: number[]): Generator<SortState> {
  const arr = [...inputArr];
  const n = arr.length;
  let comparisons = 0;
  let swaps = 0;
  let arrayAccesses = 0;
  const sortedSet = new Set<number>();

  function* mergeSort(
    left: number,
    right: number
  ): Generator<SortState> {
    if (left >= right) return;

    const mid = Math.floor((left + right) / 2);
    yield* mergeSort(left, mid);
    yield* mergeSort(mid + 1, right);
    yield* merge(left, mid, right);
  }

  function* merge(
    left: number,
    mid: number,
    right: number
  ): Generator<SortState> {
    const leftArr = arr.slice(left, mid + 1);
    const rightArr = arr.slice(mid + 1, right + 1);
    arrayAccesses += right - left + 1;

    let i = 0;
    let j = 0;
    let k = left;

    while (i < leftArr.length && j < rightArr.length) {
      comparisons++;
      arrayAccesses += 2;

      const states = makeDefaultStates(n);
      sortedSet.forEach((idx) => (states[idx] = "sorted"));
      states[left + i] = "comparing";
      states[mid + 1 + j] = "comparing";
      // highlight merge region
      for (let m = left; m <= right; m++) {
        if (states[m] === "default") states[m] = "pivot";
      }
      yield { array: [...arr], states, comparisons, swaps, arrayAccesses };

      if (leftArr[i] <= rightArr[j]) {
        arr[k] = leftArr[i];
        i++;
      } else {
        arr[k] = rightArr[j];
        j++;
        swaps++;
      }
      arrayAccesses++;
      k++;

      const writeStates = makeDefaultStates(n);
      sortedSet.forEach((idx) => (writeStates[idx] = "sorted"));
      writeStates[k - 1] = "swapping";
      for (let m = left; m <= right; m++) {
        if (writeStates[m] === "default") writeStates[m] = "pivot";
      }
      yield { array: [...arr], states: writeStates, comparisons, swaps, arrayAccesses };
    }

    while (i < leftArr.length) {
      arr[k] = leftArr[i];
      arrayAccesses += 2;
      i++;
      k++;
    }

    while (j < rightArr.length) {
      arr[k] = rightArr[j];
      arrayAccesses += 2;
      j++;
      k++;
    }

    // if this is the final merge (full array), mark everything sorted
    if (left === 0 && right === n - 1) {
      for (let m = 0; m < n; m++) sortedSet.add(m);
    }

    const mark = makeDefaultStates(n);
    sortedSet.forEach((idx) => (mark[idx] = "sorted"));
    for (let m = left; m <= right; m++) {
      if (mark[m] !== "sorted") mark[m] = "sorted";
    }
    yield { array: [...arr], states: mark, comparisons, swaps, arrayAccesses };
  }

  yield* mergeSort(0, n - 1);

  const finalStates: BarState[] = new Array(n).fill("sorted");
  yield { array: [...arr], states: finalStates, comparisons, swaps, arrayAccesses };
}

function* quickSortGenerator(inputArr: number[]): Generator<SortState> {
  const arr = [...inputArr];
  const n = arr.length;
  let comparisons = 0;
  let swaps = 0;
  let arrayAccesses = 0;
  const sortedSet = new Set<number>();

  function* quickSort(low: number, high: number): Generator<SortState> {
    if (low >= high) {
      if (low === high) sortedSet.add(low);
      return;
    }

    const pivotResult: { index: number } = { index: 0 };
    yield* partition(low, high, pivotResult);
    const pi = pivotResult.index;

    sortedSet.add(pi);

    const mark = makeDefaultStates(n);
    sortedSet.forEach((idx) => (mark[idx] = "sorted"));
    yield { array: [...arr], states: mark, comparisons, swaps, arrayAccesses };

    yield* quickSort(low, pi - 1);
    yield* quickSort(pi + 1, high);
  }

  function* partition(
    low: number,
    high: number,
    result: { index: number }
  ): Generator<SortState> {
    // Median-of-three pivot selection
    const mid = Math.floor((low + high) / 2);
    if (arr[mid] < arr[low]) {
      [arr[low], arr[mid]] = [arr[mid], arr[low]];
      swaps++;
      arrayAccesses += 4;
    }
    if (arr[high] < arr[low]) {
      [arr[low], arr[high]] = [arr[high], arr[low]];
      swaps++;
      arrayAccesses += 4;
    }
    if (arr[mid] < arr[high]) {
      [arr[mid], arr[high]] = [arr[high], arr[mid]];
      swaps++;
      arrayAccesses += 4;
    }
    // pivot is now at high
    const pivot = arr[high];
    arrayAccesses++;

    let i = low - 1;

    // show pivot
    const pivotStates = makeDefaultStates(n);
    sortedSet.forEach((idx) => (pivotStates[idx] = "sorted"));
    pivotStates[high] = "pivot";
    yield { array: [...arr], states: pivotStates, comparisons, swaps, arrayAccesses };

    for (let j = low; j < high; j++) {
      comparisons++;
      arrayAccesses++;

      const states = makeDefaultStates(n);
      sortedSet.forEach((idx) => (states[idx] = "sorted"));
      states[high] = "pivot";
      states[j] = "comparing";
      if (i >= low) states[i] = "comparing";
      yield { array: [...arr], states, comparisons, swaps, arrayAccesses };

      if (arr[j] <= pivot) {
        i++;
        if (i !== j) {
          [arr[i], arr[j]] = [arr[j], arr[i]];
          swaps++;
          arrayAccesses += 4;

          const swapStates = makeDefaultStates(n);
          sortedSet.forEach((idx) => (swapStates[idx] = "sorted"));
          swapStates[high] = "pivot";
          swapStates[i] = "swapping";
          swapStates[j] = "swapping";
          yield { array: [...arr], states: swapStates, comparisons, swaps, arrayAccesses };
        }
      }
    }

    [arr[i + 1], arr[high]] = [arr[high], arr[i + 1]];
    swaps++;
    arrayAccesses += 4;

    const finalSwap = makeDefaultStates(n);
    sortedSet.forEach((idx) => (finalSwap[idx] = "sorted"));
    finalSwap[i + 1] = "swapping";
    finalSwap[high] = "swapping";
    yield { array: [...arr], states: finalSwap, comparisons, swaps, arrayAccesses };

    result.index = i + 1;
  }

  yield* quickSort(0, n - 1);

  const finalStates: BarState[] = new Array(n).fill("sorted");
  yield { array: [...arr], states: finalStates, comparisons, swaps, arrayAccesses };
}

function* heapSortGenerator(inputArr: number[]): Generator<SortState> {
  const arr = [...inputArr];
  const n = arr.length;
  let comparisons = 0;
  let swaps = 0;
  let arrayAccesses = 0;
  const sortedSet = new Set<number>();

  function* heapify(
    size: number,
    root: number
  ): Generator<SortState> {
    let largest = root;
    const left = 2 * root + 1;
    const right = 2 * root + 2;

    if (left < size) {
      comparisons++;
      arrayAccesses += 2;
      const states = makeDefaultStates(n);
      sortedSet.forEach((idx) => (states[idx] = "sorted"));
      states[largest] = "pivot";
      states[left] = "comparing";
      yield { array: [...arr], states, comparisons, swaps, arrayAccesses };

      if (arr[left] > arr[largest]) {
        largest = left;
      }
    }

    if (right < size) {
      comparisons++;
      arrayAccesses += 2;
      const states = makeDefaultStates(n);
      sortedSet.forEach((idx) => (states[idx] = "sorted"));
      states[largest] = "pivot";
      states[right] = "comparing";
      yield { array: [...arr], states, comparisons, swaps, arrayAccesses };

      if (arr[right] > arr[largest]) {
        largest = right;
      }
    }

    if (largest !== root) {
      [arr[root], arr[largest]] = [arr[largest], arr[root]];
      swaps++;
      arrayAccesses += 4;

      const swapStates = makeDefaultStates(n);
      sortedSet.forEach((idx) => (swapStates[idx] = "sorted"));
      swapStates[root] = "swapping";
      swapStates[largest] = "swapping";
      yield { array: [...arr], states: swapStates, comparisons, swaps, arrayAccesses };

      yield* heapify(size, largest);
    }
  }

  // Build max heap
  for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
    yield* heapify(n, i);
  }

  const heapBuilt = makeDefaultStates(n);
  yield { array: [...arr], states: heapBuilt, comparisons, swaps, arrayAccesses };

  // Extract elements
  for (let i = n - 1; i > 0; i--) {
    [arr[0], arr[i]] = [arr[i], arr[0]];
    swaps++;
    arrayAccesses += 4;
    sortedSet.add(i);

    const swapStates = makeDefaultStates(n);
    sortedSet.forEach((idx) => (swapStates[idx] = "sorted"));
    swapStates[0] = "swapping";
    yield { array: [...arr], states: swapStates, comparisons, swaps, arrayAccesses };

    yield* heapify(i, 0);
  }

  sortedSet.add(0);
  const finalStates: BarState[] = new Array(n).fill("sorted");
  yield { array: [...arr], states: finalStates, comparisons, swaps, arrayAccesses };
}

// ─── Generator factory ────────────────────────────────────────────────────────

function createSortGenerator(
  algorithm: AlgorithmName,
  arr: number[]
): Generator<SortState> {
  switch (algorithm) {
    case "bubble":
      return bubbleSortGenerator(arr);
    case "selection":
      return selectionSortGenerator(arr);
    case "insertion":
      return insertionSortGenerator(arr);
    case "merge":
      return mergeSortGenerator(arr);
    case "quick":
      return quickSortGenerator(arr);
    case "heap":
      return heapSortGenerator(arr);
  }
}

// ─── Bar component ────────────────────────────────────────────────────────────

function SortBar({
  value,
  maxValue,
  state,
  width,
  index,
  total,
}: {
  value: number;
  maxValue: number;
  state: BarState;
  width: number;
  index: number;
  total: number;
}) {
  const heightPercent = (value / maxValue) * 100;
  const colors = BAR_COLORS[state];

  // Gradient: brighter at top
  const gradientBottom = colors.bg;
  const gradientTop =
    state === "default"
      ? "#3a3a4e"
      : state === "comparing"
      ? "#fbbf24"
      : state === "swapping"
      ? "#f87171"
      : state === "sorted"
      ? "#34d399"
      : "#818cf8";

  const glow =
    state === "comparing"
      ? "0 0 12px rgba(245,158,11,0.4)"
      : state === "swapping"
      ? "0 0 12px rgba(239,68,68,0.4)"
      : state === "sorted"
      ? "0 0 8px rgba(16,185,129,0.25)"
      : state === "pivot"
      ? "0 0 12px rgba(99,102,241,0.4)"
      : "none";

  return (
    <div
      className="relative flex-shrink-0"
      style={{
        width: `${width}%`,
        height: "100%",
        padding: total > 50 ? "0 0.5px" : "0 1px",
      }}
    >
      <div
        className="absolute bottom-0 w-full"
        style={{
          height: `${heightPercent}%`,
          background: `linear-gradient(to top, ${gradientBottom}, ${gradientTop})`,
          borderTop: `2px solid ${colors.border}`,
          borderRadius: total > 60 ? "2px 2px 0 0" : "4px 4px 0 0",
          boxShadow: glow,
          transition: "height 80ms ease-out, background 120ms ease-out, box-shadow 120ms ease-out",
        }}
      >
        {/* Value label for small arrays */}
        {total <= 25 && (
          <div
            className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-mono tabular-nums"
            style={{
              color:
                state === "default" ? "#71717a" : state === "sorted" ? "#10b981" : "#ffffff",
              transition: "color 120ms ease-out",
            }}
          >
            {value}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Visualization panel ──────────────────────────────────────────────────────

function VisualizationPanel({
  array,
  barStates,
  label,
  metrics,
  showMetrics,
  algorithmInfo,
  compact,
}: {
  array: number[];
  barStates: BarState[];
  label?: string;
  metrics: { comparisons: number; swaps: number; arrayAccesses: number };
  showMetrics: boolean;
  algorithmInfo: AlgorithmInfo;
  compact?: boolean;
}) {
  const maxValue = useMemo(
    () => Math.max(...array, 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [array.length]
  );
  const barWidth = 100 / array.length;

  return (
    <div className="relative flex flex-col h-full">
      {/* Algorithm label */}
      {label && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#1e1e2e]">
          <span className="text-sm font-semibold text-white">{label}</span>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-[#71717a]">
              Avg: <span className="text-[#06b6d4]">{algorithmInfo.timeAvg}</span>
            </span>
            <span className="text-xs font-mono text-[#71717a]">
              Space: <span className="text-[#06b6d4]">{algorithmInfo.space}</span>
            </span>
            {algorithmInfo.stable && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/20">
                STABLE
              </span>
            )}
          </div>
        </div>
      )}

      {/* Bars container */}
      <div
        className="flex-1 flex items-end px-2 pb-1"
        style={{ paddingTop: array.length <= 25 ? "24px" : "8px" }}
      >
        {array.map((value, index) => (
          <SortBar
            key={index}
            value={value}
            maxValue={maxValue}
            state={barStates[index] || "default"}
            width={barWidth}
            index={index}
            total={array.length}
          />
        ))}
      </div>

      {/* Metrics overlay */}
      <AnimatePresence>
        {showMetrics && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className={`absolute ${
              compact ? "bottom-2 right-2" : "bottom-3 right-3"
            } flex gap-2`}
          >
            <MetricBadge
              icon={<Eye size={12} />}
              label="Comparisons"
              value={metrics.comparisons}
              color="#f59e0b"
            />
            <MetricBadge
              icon={<ArrowUpDown size={12} />}
              label="Swaps"
              value={metrics.swaps}
              color="#ef4444"
            />
            <MetricBadge
              icon={<Layers size={12} />}
              label="Accesses"
              value={metrics.arrayAccesses}
              color="#06b6d4"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MetricBadge({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
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
          {value.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function SortingPage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [arraySize, setArraySize] = useState(30);
  const [distribution, setDistribution] = useState<Distribution>("random");
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<AlgorithmName>("bubble");
  const [compareAlgorithm, setCompareAlgorithm] = useState<AlgorithmName>("merge");
  const [compareMode, setCompareMode] = useState(false);
  const [showMetrics, setShowMetrics] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [compareDropdownOpen, setCompareDropdownOpen] = useState(false);

  // ── Array state ─────────────────────────────────────────────────────────────
  const [primaryArray, setPrimaryArray] = useState<number[]>(() =>
    generateArray(30, "random")
  );
  const [primaryBarStates, setPrimaryBarStates] = useState<BarState[]>(() =>
    makeDefaultStates(30)
  );
  const [primaryMetrics, setPrimaryMetrics] = useState({
    comparisons: 0,
    swaps: 0,
    arrayAccesses: 0,
  });

  const [secondaryArray, setSecondaryArray] = useState<number[]>([]);
  const [secondaryBarStates, setSecondaryBarStates] = useState<BarState[]>([]);
  const [secondaryMetrics, setSecondaryMetrics] = useState({
    comparisons: 0,
    swaps: 0,
    arrayAccesses: 0,
  });

  // ── Refs ────────────────────────────────────────────────────────────────────
  const primaryGenRef = useRef<Generator<SortState> | null>(null);
  const secondaryGenRef = useRef<Generator<SortState> | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const initialArrayRef = useRef<number[]>(primaryArray);
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);

  // Keep refs in sync
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // ── Generate new array ──────────────────────────────────────────────────────
  const handleGenerateArray = useCallback(() => {
    handlePause();
    const newArr = generateArray(arraySize, distribution);
    initialArrayRef.current = newArr;
    setPrimaryArray(newArr);
    setPrimaryBarStates(makeDefaultStates(arraySize));
    setPrimaryMetrics({ comparisons: 0, swaps: 0, arrayAccesses: 0 });
    setSecondaryArray(newArr);
    setSecondaryBarStates(makeDefaultStates(arraySize));
    setSecondaryMetrics({ comparisons: 0, swaps: 0, arrayAccesses: 0 });
    primaryGenRef.current = null;
    secondaryGenRef.current = null;
    setIsComplete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arraySize, distribution]);

  // Regenerate when size or distribution changes
  useEffect(() => {
    handleGenerateArray();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arraySize, distribution]);

  // ── Step forward ────────────────────────────────────────────────────────────
  const stepForward = useCallback((): boolean => {
    let anyActive = false;

    // Primary
    if (!primaryGenRef.current) {
      primaryGenRef.current = createSortGenerator(
        selectedAlgorithm,
        initialArrayRef.current
      );
    }

    const primaryResult = primaryGenRef.current.next();
    if (!primaryResult.done) {
      anyActive = true;
      const state = primaryResult.value;
      setPrimaryArray(state.array);
      setPrimaryBarStates(state.states);
      setPrimaryMetrics({
        comparisons: state.comparisons,
        swaps: state.swaps,
        arrayAccesses: state.arrayAccesses,
      });
    }

    // Secondary (compare mode)
    if (compareMode) {
      if (!secondaryGenRef.current) {
        secondaryGenRef.current = createSortGenerator(
          compareAlgorithm,
          initialArrayRef.current
        );
      }

      const secondaryResult = secondaryGenRef.current.next();
      if (!secondaryResult.done) {
        anyActive = true;
        const state = secondaryResult.value;
        setSecondaryArray(state.array);
        setSecondaryBarStates(state.states);
        setSecondaryMetrics({
          comparisons: state.comparisons,
          swaps: state.swaps,
          arrayAccesses: state.arrayAccesses,
        });
      }
    }

    if (!anyActive) {
      setIsComplete(true);
      setIsPlaying(false);
    }

    return anyActive;
  }, [selectedAlgorithm, compareAlgorithm, compareMode]);

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
    if (isComplete) return;
    setIsPlaying(true);
    isPlayingRef.current = true;
    lastTickRef.current = 0;
    animationRef.current = requestAnimationFrame(animationLoop);
  }, [animationLoop, isComplete]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const handleStep = useCallback(() => {
    if (isComplete) return;
    handlePause();
    stepForward();
  }, [handlePause, stepForward, isComplete]);

  const handleReset = useCallback(() => {
    handlePause();
    const arr = initialArrayRef.current;
    setPrimaryArray(arr);
    setPrimaryBarStates(makeDefaultStates(arr.length));
    setPrimaryMetrics({ comparisons: 0, swaps: 0, arrayAccesses: 0 });
    setSecondaryArray(arr);
    setSecondaryBarStates(makeDefaultStates(arr.length));
    setSecondaryMetrics({ comparisons: 0, swaps: 0, arrayAccesses: 0 });
    primaryGenRef.current = null;
    secondaryGenRef.current = null;
    setIsComplete(false);
  }, [handlePause]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Reset generators when algorithm changes
  useEffect(() => {
    handleReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAlgorithm, compareAlgorithm, compareMode]);

  // ── Distribution labels ─────────────────────────────────────────────────────
  const DISTRIBUTIONS: { key: Distribution; label: string }[] = [
    { key: "random", label: "Random" },
    { key: "nearly-sorted", label: "Nearly Sorted" },
    { key: "reversed", label: "Reversed" },
    { key: "few-unique", label: "Few Unique" },
  ];

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
                  background: "rgba(99,102,241,0.1)",
                  color: "#6366f1",
                  border: "1px solid rgba(99,102,241,0.2)",
                }}
              >
                4.1
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Sorting Algorithms
              </h1>
            </div>
            <p className="text-sm text-[#a1a1aa] max-w-2xl">
              Compare and visualize how different sorting algorithms rearrange data,
              step by step. Watch the tradeoffs between time complexity, space usage, and stability unfold in real time.
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
                Prerequisite: Arrays & Basic Loops
              </span>
            </div>
          </motion.div>

          {/* ── Algorithm selector + controls row ─────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
            className="flex flex-wrap items-center gap-3 mb-4"
          >
            {/* Primary algorithm dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  setDropdownOpen(!dropdownOpen);
                  setCompareDropdownOpen(false);
                }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: "#111118",
                  border: "1px solid #1e1e2e",
                }}
              >
                <SlidersHorizontal size={14} className="text-[#6366f1]" />
                {ALGORITHMS[selectedAlgorithm].label}
                <ChevronDown
                  size={14}
                  className="text-[#71717a]"
                  style={{
                    transform: dropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 200ms ease",
                  }}
                />
              </button>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 mt-1.5 z-50 rounded-xl overflow-hidden"
                    style={{
                      background: "#111118",
                      border: "1px solid #1e1e2e",
                      boxShadow:
                        "0 20px 40px rgba(0,0,0,0.5), 0 0 1px rgba(99,102,241,0.1)",
                      minWidth: "200px",
                    }}
                  >
                    {ALGORITHM_KEYS.map((key) => (
                      <button
                        key={key}
                        onClick={() => {
                          setSelectedAlgorithm(key);
                          setDropdownOpen(false);
                        }}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-all duration-150"
                        style={{
                          color:
                            selectedAlgorithm === key ? "#6366f1" : "#a1a1aa",
                          background:
                            selectedAlgorithm === key
                              ? "rgba(99,102,241,0.08)"
                              : "transparent",
                        }}
                        onMouseEnter={(e) => {
                          if (selectedAlgorithm !== key)
                            e.currentTarget.style.background = "#16161f";
                        }}
                        onMouseLeave={(e) => {
                          if (selectedAlgorithm !== key)
                            e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <span className="font-medium">
                          {ALGORITHMS[key].label}
                        </span>
                        <span className="text-xs font-mono text-[#71717a]">
                          {ALGORITHMS[key].timeAvg}
                        </span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Compare mode toggle */}
            <button
              onClick={() => setCompareMode(!compareMode)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: compareMode
                  ? "rgba(6,182,212,0.1)"
                  : "#111118",
                border: compareMode
                  ? "1px solid rgba(6,182,212,0.3)"
                  : "1px solid #1e1e2e",
                color: compareMode ? "#06b6d4" : "#a1a1aa",
              }}
            >
              <GitCompareArrows size={14} />
              Compare
            </button>

            {/* Secondary algorithm dropdown (compare mode) */}
            <AnimatePresence>
              {compareMode && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.2 }}
                  className="relative overflow-hidden"
                >
                  <button
                    onClick={() => {
                      setCompareDropdownOpen(!compareDropdownOpen);
                      setDropdownOpen(false);
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200 whitespace-nowrap"
                    style={{
                      background: "#111118",
                      border: "1px solid rgba(6,182,212,0.2)",
                    }}
                  >
                    vs. {ALGORITHMS[compareAlgorithm].label}
                    <ChevronDown
                      size={14}
                      className="text-[#71717a]"
                      style={{
                        transform: compareDropdownOpen
                          ? "rotate(180deg)"
                          : "rotate(0deg)",
                        transition: "transform 200ms ease",
                      }}
                    />
                  </button>

                  <AnimatePresence>
                    {compareDropdownOpen && (
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
                          minWidth: "200px",
                        }}
                      >
                        {ALGORITHM_KEYS.filter(
                          (k) => k !== selectedAlgorithm
                        ).map((key) => (
                          <button
                            key={key}
                            onClick={() => {
                              setCompareAlgorithm(key);
                              setCompareDropdownOpen(false);
                            }}
                            className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-all duration-150"
                            style={{
                              color:
                                compareAlgorithm === key
                                  ? "#06b6d4"
                                  : "#a1a1aa",
                              background:
                                compareAlgorithm === key
                                  ? "rgba(6,182,212,0.08)"
                                  : "transparent",
                            }}
                            onMouseEnter={(e) => {
                              if (compareAlgorithm !== key)
                                e.currentTarget.style.background = "#16161f";
                            }}
                            onMouseLeave={(e) => {
                              if (compareAlgorithm !== key)
                                e.currentTarget.style.background = "transparent";
                            }}
                          >
                            <span className="font-medium">
                              {ALGORITHMS[key].label}
                            </span>
                            <span className="text-xs font-mono text-[#71717a]">
                              {ALGORITHMS[key].timeAvg}
                            </span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Distribution presets */}
            <div className="flex items-center gap-1">
              {DISTRIBUTIONS.map((d) => (
                <button
                  key={d.key}
                  onClick={() => setDistribution(d.key)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                  style={{
                    background:
                      distribution === d.key
                        ? "rgba(99,102,241,0.12)"
                        : "transparent",
                    color:
                      distribution === d.key ? "#6366f1" : "#71717a",
                    border:
                      distribution === d.key
                        ? "1px solid rgba(99,102,241,0.2)"
                        : "1px solid transparent",
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {/* Generate new array */}
            <button
              onClick={handleGenerateArray}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-[#a1a1aa] hover:text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: "#111118",
                border: "1px solid #1e1e2e",
              }}
            >
              <Shuffle size={14} />
              New Array
            </button>
          </motion.div>

          {/* ── Array size slider ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: [0.23, 1, 0.32, 1] }}
            className="flex items-center gap-4 mb-4 px-1"
          >
            <span className="text-xs text-[#71717a] font-medium whitespace-nowrap">
              Array Size
            </span>
            <input
              type="range"
              min={10}
              max={100}
              step={1}
              value={arraySize}
              onChange={(e) => setArraySize(parseInt(e.target.value))}
              className="flex-1 max-w-xs h-1.5 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#6366f1] [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-[#6366f1]/30"
              style={{ background: "#1e1e2e" }}
            />
            <span
              className="text-xs font-mono font-semibold tabular-nums min-w-[2.5rem] text-center"
              style={{ color: "#6366f1" }}
            >
              {arraySize}
            </span>
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
                "0 0 0 1px rgba(99,102,241,0.03), 0 20px 50px -12px rgba(0,0,0,0.5)",
            }}
          >
            {compareMode ? (
              <div className="grid grid-cols-2 divide-x divide-[#1e1e2e]" style={{ height: "min(55vh, 500px)" }}>
                <VisualizationPanel
                  array={primaryArray}
                  barStates={primaryBarStates}
                  label={ALGORITHMS[selectedAlgorithm].label}
                  metrics={primaryMetrics}
                  showMetrics={showMetrics}
                  algorithmInfo={ALGORITHMS[selectedAlgorithm]}
                  compact
                />
                <VisualizationPanel
                  array={secondaryArray}
                  barStates={secondaryBarStates}
                  label={ALGORITHMS[compareAlgorithm].label}
                  metrics={secondaryMetrics}
                  showMetrics={showMetrics}
                  algorithmInfo={ALGORITHMS[compareAlgorithm]}
                  compact
                />
              </div>
            ) : (
              <div style={{ height: "min(55vh, 500px)" }}>
                <VisualizationPanel
                  array={primaryArray}
                  barStates={primaryBarStates}
                  label={ALGORITHMS[selectedAlgorithm].label}
                  metrics={primaryMetrics}
                  showMetrics={showMetrics}
                  algorithmInfo={ALGORITHMS[selectedAlgorithm]}
                />
              </div>
            )}

            {/* Color legend */}
            <div
              className="flex items-center justify-center gap-5 px-4 py-2.5 border-t"
              style={{ borderColor: "#1e1e2e" }}
            >
              {(
                [
                  { state: "default" as BarState, label: "Unsorted" },
                  { state: "comparing" as BarState, label: "Comparing" },
                  { state: "swapping" as BarState, label: "Swapping" },
                  { state: "pivot" as BarState, label: "Pivot" },
                  { state: "sorted" as BarState, label: "Sorted" },
                ] as const
              ).map(({ state, label }) => (
                <div key={state} className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{
                      background: BAR_COLORS[state].bg,
                      border: `1px solid ${BAR_COLORS[state].border}`,
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
              {/* Completion badge */}
              <AnimatePresence>
                {isComplete && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                    style={{
                      background: "rgba(16,185,129,0.1)",
                      border: "1px solid rgba(16,185,129,0.2)",
                    }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                    <span className="text-xs font-medium text-[#10b981]">
                      Sorted
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </ModuleControls>
          </motion.div>

          {/* ── Complexity comparison table ────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="mt-6 rounded-2xl overflow-hidden"
            style={{
              background: "#111118",
              border: "1px solid #1e1e2e",
            }}
          >
            <div className="px-5 py-3.5 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-[#6366f1]" />
                <span className="text-sm font-semibold text-white">
                  Complexity Comparison
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1e1e2e]">
                    <th className="px-5 py-2.5 text-left font-medium text-[#71717a]">
                      Algorithm
                    </th>
                    <th className="px-5 py-2.5 text-left font-medium text-[#71717a]">
                      Best
                    </th>
                    <th className="px-5 py-2.5 text-left font-medium text-[#71717a]">
                      Average
                    </th>
                    <th className="px-5 py-2.5 text-left font-medium text-[#71717a]">
                      Worst
                    </th>
                    <th className="px-5 py-2.5 text-left font-medium text-[#71717a]">
                      Space
                    </th>
                    <th className="px-5 py-2.5 text-left font-medium text-[#71717a]">
                      Stable
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ALGORITHM_KEYS.map((key) => {
                    const algo = ALGORITHMS[key];
                    const isActive =
                      key === selectedAlgorithm ||
                      (compareMode && key === compareAlgorithm);

                    return (
                      <tr
                        key={key}
                        className="border-b border-[#1e1e2e]/50 transition-colors duration-150 cursor-pointer"
                        style={{
                          background: isActive
                            ? "rgba(99,102,241,0.04)"
                            : "transparent",
                        }}
                        onClick={() => {
                          if (!isPlaying) setSelectedAlgorithm(key);
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive)
                            e.currentTarget.style.background = "#16161f";
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive)
                            e.currentTarget.style.background = "transparent";
                          else
                            e.currentTarget.style.background =
                              "rgba(99,102,241,0.04)";
                        }}
                      >
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            {isActive && (
                              <div
                                className="w-1.5 h-1.5 rounded-full"
                                style={{
                                  background:
                                    key === selectedAlgorithm
                                      ? "#6366f1"
                                      : "#06b6d4",
                                }}
                              />
                            )}
                            <span
                              className="font-medium"
                              style={{
                                color: isActive ? "#ffffff" : "#a1a1aa",
                              }}
                            >
                              {algo.label}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-2.5 font-mono text-[#10b981]">
                          {algo.timeBest}
                        </td>
                        <td className="px-5 py-2.5 font-mono text-[#f59e0b]">
                          {algo.timeAvg}
                        </td>
                        <td className="px-5 py-2.5 font-mono text-[#ef4444]">
                          {algo.timeWorst}
                        </td>
                        <td className="px-5 py-2.5 font-mono text-[#06b6d4]">
                          {algo.space}
                        </td>
                        <td className="px-5 py-2.5">
                          {algo.stable ? (
                            <span className="text-[#10b981]">Yes</span>
                          ) : (
                            <span className="text-[#71717a]">No</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Close dropdowns on click outside */}
      {(dropdownOpen || compareDropdownOpen) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setDropdownOpen(false);
            setCompareDropdownOpen(false);
          }}
        />
      )}
    </div>
  );
}
