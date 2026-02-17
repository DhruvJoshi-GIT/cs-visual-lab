"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers,
  Clock,
  Zap,
  ArrowRight,
  Terminal,
  RotateCw,
  Globe,
  Sparkles,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

/* ═══════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════ */

type FrameKind = "sync" | "microtask" | "macrotask" | "webapi";

interface CallFrame {
  id: number;
  label: string;
  color: string;
  kind: FrameKind;
}

interface WebAPITimer {
  id: number;
  label: string;
  callback: string;
  totalTicks: number;
  remainingTicks: number;
  kind: "timeout" | "interval" | "fetch" | "promise-resolve";
}

interface QueueItem {
  id: number;
  label: string;
  callback: string;
  color: string;
}

interface ConsoleEntry {
  id: number;
  value: string;
  step: number;
}

type StepPhase =
  | "execute-callstack"
  | "check-microtasks"
  | "process-microtask"
  | "check-macrotasks"
  | "process-macrotask"
  | "tick-webapis"
  | "done";

interface EventLoopState {
  callStack: CallFrame[];
  webAPIs: WebAPITimer[];
  microtaskQueue: QueueItem[];
  macrotaskQueue: QueueItem[];
  console: ConsoleEntry[];
  currentLine: number;
  phase: StepPhase;
  stepCount: number;
  explanation: string;
  done: boolean;
  programCounter: number;
}

interface Instruction {
  line: number;
  code: string;
  action: (state: EventLoopState) => EventLoopState;
}

interface Scenario {
  id: string;
  label: string;
  description: string;
  code: string;
  instructions: Instruction[];
}

const COLORS = {
  callStack: "#6366f1",
  microtask: "#10b981",
  macrotask: "#f59e0b",
  webAPI: "#06b6d4",
  sync: "#6366f1",
};

let globalId = 0;
function nextId(): number {
  return ++globalId;
}

/* ═══════════════════════════════════════════════════════════
   SCENARIO DEFINITIONS
   ═══════════════════════════════════════════════════════════ */

function makeScenarios(): Scenario[] {
  return [
    {
      id: "settimeout-basics",
      label: "setTimeout Basics",
      description: "Understanding deferred execution with setTimeout",
      code: `console.log("Start");
setTimeout(() => {
  console.log("Timeout 1");
}, 0);
setTimeout(() => {
  console.log("Timeout 2");
}, 0);
console.log("End");`,
      instructions: [
        {
          line: 1,
          code: 'console.log("Start")',
          action: (s) => ({
            ...s,
            callStack: [
              ...s.callStack,
              { id: nextId(), label: 'console.log("Start")', color: COLORS.sync, kind: "sync" },
            ],
            explanation: 'Push console.log("Start") onto the call stack',
          }),
        },
        {
          line: 1,
          code: '// executes "Start"',
          action: (s) => ({
            ...s,
            callStack: s.callStack.slice(0, -1),
            console: [...s.console, { id: nextId(), value: "Start", step: s.stepCount }],
            explanation: 'Execute and pop: prints "Start" to console',
          }),
        },
        {
          line: 2,
          code: "setTimeout(cb1, 0)",
          action: (s) => ({
            ...s,
            callStack: [
              ...s.callStack,
              { id: nextId(), label: "setTimeout(cb1, 0)", color: COLORS.webAPI, kind: "sync" },
            ],
            explanation: "Push setTimeout(cb1, 0) onto the call stack",
          }),
        },
        {
          line: 2,
          code: "// registers timer in Web APIs",
          action: (s) => ({
            ...s,
            callStack: s.callStack.slice(0, -1),
            webAPIs: [
              ...s.webAPIs,
              {
                id: nextId(),
                label: "Timer (cb1)",
                callback: 'console.log("Timeout 1")',
                totalTicks: 1,
                remainingTicks: 1,
                kind: "timeout",
              },
            ],
            explanation: "Pop setTimeout: registers a 0ms timer in Web APIs. Timer will fire next tick.",
          }),
        },
        {
          line: 5,
          code: "setTimeout(cb2, 0)",
          action: (s) => ({
            ...s,
            callStack: [
              ...s.callStack,
              { id: nextId(), label: "setTimeout(cb2, 0)", color: COLORS.webAPI, kind: "sync" },
            ],
            explanation: "Push setTimeout(cb2, 0) onto the call stack",
          }),
        },
        {
          line: 5,
          code: "// registers timer in Web APIs",
          action: (s) => ({
            ...s,
            callStack: s.callStack.slice(0, -1),
            webAPIs: [
              ...s.webAPIs,
              {
                id: nextId(),
                label: "Timer (cb2)",
                callback: 'console.log("Timeout 2")',
                totalTicks: 1,
                remainingTicks: 1,
                kind: "timeout",
              },
            ],
            explanation: "Pop setTimeout: registers second 0ms timer in Web APIs.",
          }),
        },
        {
          line: 8,
          code: 'console.log("End")',
          action: (s) => ({
            ...s,
            callStack: [
              ...s.callStack,
              { id: nextId(), label: 'console.log("End")', color: COLORS.sync, kind: "sync" },
            ],
            explanation: 'Push console.log("End") onto the call stack',
          }),
        },
        {
          line: 8,
          code: '// executes "End"',
          action: (s) => ({
            ...s,
            callStack: s.callStack.slice(0, -1),
            console: [...s.console, { id: nextId(), value: "End", step: s.stepCount }],
            explanation: 'Execute and pop: prints "End". Call stack is now empty!',
          }),
        },
        {
          line: 0,
          code: "// Web API timers fire",
          action: (s) => ({
            ...s,
            webAPIs: [],
            macrotaskQueue: [
              ...s.macrotaskQueue,
              { id: nextId(), label: "cb1", callback: 'console.log("Timeout 1")', color: COLORS.macrotask },
              { id: nextId(), label: "cb2", callback: 'console.log("Timeout 2")', color: COLORS.macrotask },
            ],
            phase: "tick-webapis",
            explanation: "Timers complete: callbacks move to the macrotask queue",
          }),
        },
        {
          line: 0,
          code: "// Event loop: check microtask queue",
          action: (s) => ({
            ...s,
            phase: "check-microtasks",
            explanation: "Event loop checks microtask queue first - it's empty. Moving to macrotasks.",
          }),
        },
        {
          line: 3,
          code: "// Event loop: process macrotask cb1",
          action: (s) => ({
            ...s,
            callStack: [
              { id: nextId(), label: "cb1()", color: COLORS.macrotask, kind: "macrotask" },
            ],
            macrotaskQueue: s.macrotaskQueue.slice(1),
            phase: "process-macrotask",
            explanation: "Event loop picks one macrotask: cb1 is pushed onto the call stack",
          }),
        },
        {
          line: 3,
          code: '// cb1 logs "Timeout 1"',
          action: (s) => ({
            ...s,
            callStack: [],
            console: [...s.console, { id: nextId(), value: "Timeout 1", step: s.stepCount }],
            explanation: 'cb1 executes: prints "Timeout 1" and pops off the call stack',
          }),
        },
        {
          line: 6,
          code: "// Event loop: process macrotask cb2",
          action: (s) => ({
            ...s,
            callStack: [
              { id: nextId(), label: "cb2()", color: COLORS.macrotask, kind: "macrotask" },
            ],
            macrotaskQueue: s.macrotaskQueue.slice(1),
            phase: "process-macrotask",
            explanation: "Event loop picks next macrotask: cb2 is pushed onto the call stack",
          }),
        },
        {
          line: 6,
          code: '// cb2 logs "Timeout 2"',
          action: (s) => ({
            ...s,
            callStack: [],
            console: [...s.console, { id: nextId(), value: "Timeout 2", step: s.stepCount }],
            phase: "done",
            done: true,
            explanation: 'cb2 executes: prints "Timeout 2". All queues empty. Done!',
          }),
        },
      ],
    },
    {
      id: "promise-chain",
      label: "Promise Chain",
      description: "Microtask priority with Promise.then",
      code: `console.log("Start");
Promise.resolve()
  .then(() => console.log("Promise 1"))
  .then(() => console.log("Promise 2"));
console.log("End");`,
      instructions: [
        {
          line: 1,
          code: 'console.log("Start")',
          action: (s) => ({
            ...s,
            callStack: [
              { id: nextId(), label: 'console.log("Start")', color: COLORS.sync, kind: "sync" },
            ],
            explanation: 'Push console.log("Start") onto the call stack',
          }),
        },
        {
          line: 1,
          code: "// executes",
          action: (s) => ({
            ...s,
            callStack: [],
            console: [...s.console, { id: nextId(), value: "Start", step: s.stepCount }],
            explanation: 'Prints "Start" and pops from call stack',
          }),
        },
        {
          line: 2,
          code: "Promise.resolve().then(cb1)",
          action: (s) => ({
            ...s,
            callStack: [
              { id: nextId(), label: "Promise.resolve().then(cb1)", color: COLORS.sync, kind: "sync" },
            ],
            explanation: "Push Promise.resolve().then(cb1) - resolve is immediate",
          }),
        },
        {
          line: 2,
          code: "// .then callback queued as microtask",
          action: (s) => ({
            ...s,
            callStack: [],
            microtaskQueue: [
              ...s.microtaskQueue,
              { id: nextId(), label: "then(cb1)", callback: 'console.log("Promise 1")', color: COLORS.microtask },
            ],
            explanation: "Promise resolves immediately: .then callback is placed in microtask queue",
          }),
        },
        {
          line: 5,
          code: 'console.log("End")',
          action: (s) => ({
            ...s,
            callStack: [
              { id: nextId(), label: 'console.log("End")', color: COLORS.sync, kind: "sync" },
            ],
            explanation: 'Push console.log("End") onto the call stack',
          }),
        },
        {
          line: 5,
          code: "// executes",
          action: (s) => ({
            ...s,
            callStack: [],
            console: [...s.console, { id: nextId(), value: "End", step: s.stepCount }],
            explanation: 'Prints "End". Synchronous code is done. Event loop kicks in!',
          }),
        },
        {
          line: 0,
          code: "// Event loop: drain microtask queue",
          action: (s) => ({
            ...s,
            phase: "check-microtasks",
            explanation: "Event loop: call stack is empty, checking microtask queue. Found then(cb1)!",
          }),
        },
        {
          line: 3,
          code: '// microtask cb1: console.log("Promise 1")',
          action: (s) => ({
            ...s,
            callStack: [
              { id: nextId(), label: "cb1()", color: COLORS.microtask, kind: "microtask" },
            ],
            microtaskQueue: [],
            phase: "process-microtask",
            explanation: "Dequeue microtask cb1, push onto call stack",
          }),
        },
        {
          line: 3,
          code: "// cb1 executes, chains .then(cb2)",
          action: (s) => ({
            ...s,
            callStack: [],
            console: [...s.console, { id: nextId(), value: "Promise 1", step: s.stepCount }],
            microtaskQueue: [
              { id: nextId(), label: "then(cb2)", callback: 'console.log("Promise 2")', color: COLORS.microtask },
            ],
            explanation: 'Prints "Promise 1". The chained .then(cb2) is added to microtask queue',
          }),
        },
        {
          line: 0,
          code: "// Event loop: microtask queue not empty yet!",
          action: (s) => ({
            ...s,
            phase: "check-microtasks",
            explanation: "Event loop checks again: microtask queue is NOT empty. Must drain it fully!",
          }),
        },
        {
          line: 4,
          code: '// microtask cb2: console.log("Promise 2")',
          action: (s) => ({
            ...s,
            callStack: [
              { id: nextId(), label: "cb2()", color: COLORS.microtask, kind: "microtask" },
            ],
            microtaskQueue: [],
            phase: "process-microtask",
            explanation: "Dequeue microtask cb2, push onto call stack",
          }),
        },
        {
          line: 4,
          code: "// cb2 executes",
          action: (s) => ({
            ...s,
            callStack: [],
            console: [...s.console, { id: nextId(), value: "Promise 2", step: s.stepCount }],
            phase: "done",
            done: true,
            explanation: 'Prints "Promise 2". All queues empty. Done! Output order: Start, End, Promise 1, Promise 2',
          }),
        },
      ],
    },
    {
      id: "micro-vs-macro",
      label: "Microtask vs Macrotask",
      description: "Promise callbacks run before setTimeout callbacks",
      code: `console.log("Start");
setTimeout(() => {
  console.log("Timeout");
}, 0);
Promise.resolve().then(() => {
  console.log("Promise");
});
console.log("End");`,
      instructions: [
        {
          line: 1,
          code: 'console.log("Start")',
          action: (s) => ({
            ...s,
            callStack: [{ id: nextId(), label: 'console.log("Start")', color: COLORS.sync, kind: "sync" }],
            explanation: 'Push console.log("Start")',
          }),
        },
        {
          line: 1,
          code: "// executes",
          action: (s) => ({
            ...s,
            callStack: [],
            console: [...s.console, { id: nextId(), value: "Start", step: s.stepCount }],
            explanation: 'Prints "Start"',
          }),
        },
        {
          line: 2,
          code: "setTimeout(cb_timeout, 0)",
          action: (s) => ({
            ...s,
            callStack: [{ id: nextId(), label: "setTimeout(cb, 0)", color: COLORS.webAPI, kind: "sync" }],
            explanation: "Push setTimeout onto call stack",
          }),
        },
        {
          line: 2,
          code: "// registers Web API timer",
          action: (s) => ({
            ...s,
            callStack: [],
            webAPIs: [
              {
                id: nextId(),
                label: "Timer (cb)",
                callback: 'console.log("Timeout")',
                totalTicks: 1,
                remainingTicks: 1,
                kind: "timeout",
              },
            ],
            explanation: "Timer registered in Web APIs. Callback will go to macrotask queue.",
          }),
        },
        {
          line: 5,
          code: "Promise.resolve().then(cb_promise)",
          action: (s) => ({
            ...s,
            callStack: [{ id: nextId(), label: "Promise.resolve().then(cb)", color: COLORS.sync, kind: "sync" }],
            explanation: "Push Promise.resolve().then(cb) onto call stack",
          }),
        },
        {
          line: 5,
          code: "// resolve is immediate, .then queued as microtask",
          action: (s) => ({
            ...s,
            callStack: [],
            microtaskQueue: [
              { id: nextId(), label: "then(cb)", callback: 'console.log("Promise")', color: COLORS.microtask },
            ],
            explanation: "Promise resolves immediately. .then callback goes to microtask queue (higher priority!).",
          }),
        },
        {
          line: 8,
          code: 'console.log("End")',
          action: (s) => ({
            ...s,
            callStack: [{ id: nextId(), label: 'console.log("End")', color: COLORS.sync, kind: "sync" }],
            explanation: 'Push console.log("End")',
          }),
        },
        {
          line: 8,
          code: "// executes",
          action: (s) => ({
            ...s,
            callStack: [],
            console: [...s.console, { id: nextId(), value: "End", step: s.stepCount }],
            explanation: 'Prints "End". Synchronous code finished. Event loop starts.',
          }),
        },
        {
          line: 0,
          code: "// Web API timer fires",
          action: (s) => ({
            ...s,
            webAPIs: [],
            macrotaskQueue: [
              { id: nextId(), label: "cb_timeout", callback: 'console.log("Timeout")', color: COLORS.macrotask },
            ],
            phase: "tick-webapis",
            explanation: "Timer fires: callback moves to macrotask queue",
          }),
        },
        {
          line: 0,
          code: "// Event loop: microtasks first!",
          action: (s) => ({
            ...s,
            phase: "check-microtasks",
            explanation: "KEY RULE: Event loop processes ALL microtasks before ANY macrotask!",
          }),
        },
        {
          line: 6,
          code: '// microtask: console.log("Promise")',
          action: (s) => ({
            ...s,
            callStack: [{ id: nextId(), label: "cb_promise()", color: COLORS.microtask, kind: "microtask" }],
            microtaskQueue: [],
            phase: "process-microtask",
            explanation: "Dequeue microtask, push onto call stack",
          }),
        },
        {
          line: 6,
          code: "// executes",
          action: (s) => ({
            ...s,
            callStack: [],
            console: [...s.console, { id: nextId(), value: "Promise", step: s.stepCount }],
            explanation: 'Prints "Promise". Microtask queue is now empty.',
          }),
        },
        {
          line: 0,
          code: "// Event loop: now process macrotask",
          action: (s) => ({
            ...s,
            phase: "check-macrotasks",
            explanation: "Microtask queue empty. Now event loop picks ONE macrotask.",
          }),
        },
        {
          line: 3,
          code: '// macrotask: console.log("Timeout")',
          action: (s) => ({
            ...s,
            callStack: [{ id: nextId(), label: "cb_timeout()", color: COLORS.macrotask, kind: "macrotask" }],
            macrotaskQueue: [],
            phase: "process-macrotask",
            explanation: "Dequeue macrotask, push onto call stack",
          }),
        },
        {
          line: 3,
          code: "// executes",
          action: (s) => ({
            ...s,
            callStack: [],
            console: [...s.console, { id: nextId(), value: "Timeout", step: s.stepCount }],
            phase: "done",
            done: true,
            explanation: 'Prints "Timeout". Done! Order: Start, End, Promise, Timeout. Microtasks always beat macrotasks!',
          }),
        },
      ],
    },
    {
      id: "async-await",
      label: "async/await",
      description: "How async/await desugars to promises",
      code: `async function foo() {
  console.log("foo start");
  await bar();
  console.log("foo end");
}
async function bar() {
  console.log("bar");
}
console.log("script start");
foo();
console.log("script end");`,
      instructions: [
        {
          line: 9,
          code: 'console.log("script start")',
          action: (s) => ({
            ...s,
            callStack: [{ id: nextId(), label: 'console.log("script start")', color: COLORS.sync, kind: "sync" }],
            explanation: 'Push console.log("script start")',
          }),
        },
        {
          line: 9,
          code: "// executes",
          action: (s) => ({
            ...s,
            callStack: [],
            console: [...s.console, { id: nextId(), value: "script start", step: s.stepCount }],
            explanation: 'Prints "script start"',
          }),
        },
        {
          line: 10,
          code: "foo()",
          action: (s) => ({
            ...s,
            callStack: [{ id: nextId(), label: "foo()", color: COLORS.sync, kind: "sync" }],
            explanation: "Call foo() - an async function. Pushes foo onto call stack.",
          }),
        },
        {
          line: 2,
          code: 'console.log("foo start")',
          action: (s) => ({
            ...s,
            callStack: [
              ...s.callStack,
              { id: nextId(), label: 'console.log("foo start")', color: COLORS.sync, kind: "sync" },
            ],
            explanation: 'Inside foo: push console.log("foo start")',
          }),
        },
        {
          line: 2,
          code: "// executes",
          action: (s) => ({
            ...s,
            callStack: s.callStack.slice(0, -1),
            console: [...s.console, { id: nextId(), value: "foo start", step: s.stepCount }],
            explanation: 'Prints "foo start"',
          }),
        },
        {
          line: 3,
          code: "await bar()",
          action: (s) => ({
            ...s,
            callStack: [
              ...s.callStack,
              { id: nextId(), label: "bar()", color: COLORS.sync, kind: "sync" },
            ],
            explanation: "Hit await bar(): first, bar() is called synchronously",
          }),
        },
        {
          line: 7,
          code: 'console.log("bar")',
          action: (s) => ({
            ...s,
            callStack: [
              ...s.callStack,
              { id: nextId(), label: 'console.log("bar")', color: COLORS.sync, kind: "sync" },
            ],
            explanation: 'Inside bar: push console.log("bar")',
          }),
        },
        {
          line: 7,
          code: "// bar executes",
          action: (s) => ({
            ...s,
            callStack: s.callStack.slice(0, -2),
            console: [...s.console, { id: nextId(), value: "bar", step: s.stepCount }],
            explanation: 'Prints "bar". bar() returns (implicitly resolves its promise).',
          }),
        },
        {
          line: 3,
          code: "// await pauses foo, schedules continuation as microtask",
          action: (s) => ({
            ...s,
            callStack: [],
            microtaskQueue: [
              ...s.microtaskQueue,
              { id: nextId(), label: "foo resume", callback: 'console.log("foo end")', color: COLORS.microtask },
            ],
            explanation: "await suspends foo(). The continuation (after await) is queued as a microtask. Control returns to caller!",
          }),
        },
        {
          line: 11,
          code: 'console.log("script end")',
          action: (s) => ({
            ...s,
            callStack: [{ id: nextId(), label: 'console.log("script end")', color: COLORS.sync, kind: "sync" }],
            explanation: 'Back in global scope: push console.log("script end")',
          }),
        },
        {
          line: 11,
          code: "// executes",
          action: (s) => ({
            ...s,
            callStack: [],
            console: [...s.console, { id: nextId(), value: "script end", step: s.stepCount }],
            explanation: 'Prints "script end". Synchronous code is done. Event loop starts!',
          }),
        },
        {
          line: 0,
          code: "// Event loop: process microtask (foo resume)",
          action: (s) => ({
            ...s,
            phase: "check-microtasks",
            explanation: "Event loop: call stack empty, draining microtask queue. Found foo resume!",
          }),
        },
        {
          line: 4,
          code: "// resume foo after await",
          action: (s) => ({
            ...s,
            callStack: [{ id: nextId(), label: "foo() [resumed]", color: COLORS.microtask, kind: "microtask" }],
            microtaskQueue: [],
            phase: "process-microtask",
            explanation: "foo() resumes execution after await. Pushed back onto call stack.",
          }),
        },
        {
          line: 4,
          code: 'console.log("foo end")',
          action: (s) => ({
            ...s,
            callStack: [],
            console: [...s.console, { id: nextId(), value: "foo end", step: s.stepCount }],
            phase: "done",
            done: true,
            explanation: 'Prints "foo end". Done! Order: script start, foo start, bar, script end, foo end',
          }),
        },
      ],
    },
  ];
}

/* ═══════════════════════════════════════════════════════════
   INITIAL STATE FACTORY
   ═══════════════════════════════════════════════════════════ */

function createInitialState(): EventLoopState {
  return {
    callStack: [],
    webAPIs: [],
    microtaskQueue: [],
    macrotaskQueue: [],
    console: [],
    currentLine: 0,
    phase: "execute-callstack",
    stepCount: 0,
    explanation: "Press Play or Step to begin execution",
    done: false,
    programCounter: 0,
  };
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function EventLoopPage() {
  const scenarios = useMemo(() => makeScenarios(), []);

  /* ─── Core simulation state ─── */
  const [activeScenario, setActiveScenario] = useState(scenarios[0].id);
  const [state, setState] = useState<EventLoopState>(createInitialState);

  /* ─── UI state ─── */
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);

  /* ─── Refs for animation loop ─── */
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const stateRef = useRef(state);
  const scenarioRef = useRef(scenarios[0]);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  stateRef.current = state;

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.console.length]);

  const currentScenario = useMemo(
    () => scenarios.find((s) => s.id === activeScenario) || scenarios[0],
    [activeScenario, scenarios]
  );

  useEffect(() => {
    scenarioRef.current = currentScenario;
  }, [currentScenario]);

  /* ─── Step forward ─── */
  const stepForward = useCallback(() => {
    setState((prev) => {
      if (prev.done) {
        setIsPlaying(false);
        return prev;
      }
      const scenario = scenarioRef.current;
      const pc = prev.programCounter;
      if (pc >= scenario.instructions.length) {
        return { ...prev, done: true, explanation: "Program finished!" };
      }
      const instruction = scenario.instructions[pc];
      const newState = instruction.action(prev);
      return {
        ...newState,
        currentLine: instruction.line,
        stepCount: prev.stepCount + 1,
        programCounter: pc + 1,
        done: newState.done || pc + 1 >= scenario.instructions.length,
      };
    });
  }, []);

  /* ─── Animation loop ─── */
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(10, 700 / speedRef.current);
      if (timestamp - lastTickRef.current >= interval) {
        lastTickRef.current = timestamp;
        stepForward();
      }
      animationRef.current = requestAnimationFrame(animationLoop);
    },
    [stepForward]
  );

  useEffect(() => {
    if (isPlaying) {
      lastTickRef.current = 0;
      animationRef.current = requestAnimationFrame(animationLoop);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, animationLoop]);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  /* ─── Controls ─── */
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleStep = useCallback(() => stepForward(), [stepForward]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    globalId = 0;
    setState(createInitialState());
  }, []);

  const handleScenarioSelect = useCallback(
    (scenarioId: string) => {
      setIsPlaying(false);
      globalId = 0;
      setActiveScenario(scenarioId);
      setState(createInitialState());
    },
    []
  );

  /* ─── Metrics ─── */
  const metrics = useMemo(
    () => ({
      callStackDepth: state.callStack.length,
      microtaskCount: state.microtaskQueue.length,
      macrotaskCount: state.macrotaskQueue.length,
      webAPICount: state.webAPIs.length,
      stepsExecuted: state.stepCount,
      consoleLines: state.console.length,
    }),
    [state]
  );

  /* ─── Code lines for display ─── */
  const codeLines = currentScenario.code.split("\n");

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Navbar />

      <div className="pt-14">
        {/* ── Header ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs font-mono font-medium px-2 py-1 rounded bg-[#64748b]/15 text-[#64748b] border border-[#64748b]/20">
                12.10
              </span>
              <div className="flex items-center gap-1.5 text-xs text-[#71717a]">
                <RotateCw size={12} />
                <span>Compiler &amp; Language Internals</span>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              JavaScript Event Loop
            </h1>
            <p className="mt-1.5 text-[#a1a1aa] text-sm sm:text-base max-w-2xl">
              Visualize how the call stack, microtask queue, macrotask queue,
              and Web APIs interact to execute asynchronous JavaScript
            </p>
          </motion.div>
        </div>

        {/* ── Scenario selector ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-[#71717a] mr-1">
              <Sparkles size={14} />
              <span>Presets</span>
            </div>
            {scenarios.map((scenario) => (
              <button
                key={scenario.id}
                onClick={() => handleScenarioSelect(scenario.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                  activeScenario === scenario.id
                    ? "bg-[#6366f1]/15 text-[#6366f1] border border-[#6366f1]/30"
                    : "bg-[#1e1e2e] text-[#a1a1aa] border border-transparent hover:bg-[#2a2a3e] hover:text-white"
                }`}
                title={scenario.description}
              >
                {scenario.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Controls bar ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4">
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
          />
        </div>

        {/* ── Metrics ── */}
        <AnimatePresence>
          {showMetrics && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4"
            >
              <div className="flex flex-wrap gap-3">
                <MetricCard label="Call Stack" value={String(metrics.callStackDepth)} color={COLORS.callStack} />
                <MetricCard label="Microtasks" value={String(metrics.microtaskCount)} color={COLORS.microtask} />
                <MetricCard label="Macrotasks" value={String(metrics.macrotaskCount)} color={COLORS.macrotask} />
                <MetricCard label="Web APIs" value={String(metrics.webAPICount)} color={COLORS.webAPI} />
                <MetricCard label="Steps" value={String(metrics.stepsExecuted)} color="#a1a1aa" />
                <MetricCard label="Console Lines" value={String(metrics.consoleLines)} color="#e4e4e7" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Explanation bar ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4">
          <motion.div
            key={state.stepCount}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-4 py-3 rounded-xl bg-[#111118] border border-[#1e1e2e]"
          >
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    state.phase === "process-microtask"
                      ? COLORS.microtask
                      : state.phase === "process-macrotask"
                      ? COLORS.macrotask
                      : state.phase === "tick-webapis"
                      ? COLORS.webAPI
                      : state.phase === "done"
                      ? "#10b981"
                      : COLORS.callStack,
                }}
              />
              <span className="text-sm text-[#e4e4e7]">
                {state.explanation}
              </span>
            </div>
          </motion.div>
        </div>

        {/* ── Main Layout ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-4">
            {/* ── Left column: Code + Console ── */}
            <div className="space-y-4">
              {/* Code Panel */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <Terminal size={14} className="text-[#6366f1]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Source Code
                  </span>
                </div>

                <div className="p-3 font-mono text-xs">
                  {codeLines.map((line, i) => {
                    const lineNum = i + 1;
                    const isActive = lineNum === state.currentLine;
                    return (
                      <div
                        key={i}
                        className={`flex items-start gap-3 px-2 py-0.5 rounded transition-all duration-200 ${
                          isActive
                            ? "bg-[#6366f1]/10 border-l-2 border-[#6366f1]"
                            : "border-l-2 border-transparent"
                        }`}
                      >
                        <span
                          className={`w-5 shrink-0 text-right select-none ${
                            isActive ? "text-[#6366f1]" : "text-[#71717a]/50"
                          }`}
                        >
                          {lineNum}
                        </span>
                        <span
                          className={`${
                            isActive ? "text-white" : "text-[#a1a1aa]"
                          } whitespace-pre`}
                        >
                          {line}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>

              {/* Console Output */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <Terminal size={14} className="text-[#10b981]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Console Output
                  </span>
                </div>

                <div className="p-3 font-mono text-xs max-h-[200px] overflow-y-auto scrollbar-thin min-h-[80px]">
                  <AnimatePresence mode="popLayout">
                    {state.console.map((entry) => (
                      <motion.div
                        key={entry.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-2 py-0.5"
                      >
                        <span className="text-[#71717a]">&gt;</span>
                        <span className="text-[#e4e4e7]">{entry.value}</span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {state.console.length === 0 && (
                    <div className="text-[#71717a] italic py-2">
                      No output yet...
                    </div>
                  )}
                  <div ref={consoleEndRef} />
                </div>
              </motion.div>

              {/* Event Loop Phase */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <RotateCw size={14} className="text-[#f59e0b]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Event Loop Cycle
                  </span>
                </div>

                <div className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    {(
                      [
                        { phase: "execute-callstack", label: "Call Stack", color: COLORS.callStack },
                        { phase: "check-microtasks", label: "Microtasks", color: COLORS.microtask },
                        { phase: "process-microtask", label: "Microtasks", color: COLORS.microtask },
                        { phase: "check-macrotasks", label: "Macrotasks", color: COLORS.macrotask },
                        { phase: "process-macrotask", label: "Macrotasks", color: COLORS.macrotask },
                        { phase: "tick-webapis", label: "Web APIs", color: COLORS.webAPI },
                      ] as const
                    ).map((item, i) => {
                      const isCurrentPhase =
                        state.phase === item.phase ||
                        (item.phase === "check-microtasks" &&
                          state.phase === "process-microtask") ||
                        (item.phase === "check-macrotasks" &&
                          state.phase === "process-macrotask");
                      // Deduplicate labels
                      if (i === 2 || i === 4) return null;
                      return (
                        <div key={i} className="flex items-center gap-1.5">
                          {i > 0 && i !== 2 && i !== 4 && (
                            <ArrowRight
                              size={10}
                              className="text-[#71717a]/50 shrink-0"
                            />
                          )}
                          <div
                            className={`px-2 py-1 rounded text-[10px] font-mono font-medium transition-all duration-300 ${
                              isCurrentPhase
                                ? "scale-110"
                                : "opacity-40"
                            }`}
                            style={{
                              backgroundColor: isCurrentPhase
                                ? `${item.color}20`
                                : "transparent",
                              color: item.color,
                              border: isCurrentPhase
                                ? `1px solid ${item.color}40`
                                : "1px solid transparent",
                            }}
                          >
                            {item.label}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            </div>

            {/* ── Right column: Call Stack, Web APIs, Queues ── */}
            <div className="space-y-4">
              {/* Top row: Call Stack + Web APIs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Call Stack */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
                    <div className="flex items-center gap-2">
                      <Layers size={14} className="text-[#6366f1]" />
                      <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                        Call Stack
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[#71717a]">
                      {state.callStack.length} frames
                    </span>
                  </div>

                  <div className="p-3 min-h-[200px] flex flex-col-reverse gap-1.5">
                    <AnimatePresence mode="popLayout">
                      {state.callStack.map((frame, i) => (
                        <motion.div
                          key={frame.id}
                          initial={{ opacity: 0, scale: 0.8, y: -20 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.8, y: 20 }}
                          transition={{ duration: 0.25 }}
                          className="px-3 py-2 rounded-lg border text-xs font-mono font-medium"
                          style={{
                            backgroundColor: `${frame.color}15`,
                            borderColor: `${frame.color}30`,
                            color: frame.color,
                            boxShadow:
                              i === state.callStack.length - 1
                                ? `0 0 12px ${frame.color}20`
                                : "none",
                          }}
                        >
                          {frame.label}
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {state.callStack.length === 0 && (
                      <div className="text-[10px] text-[#71717a] italic text-center py-8">
                        Empty - waiting for work
                      </div>
                    )}
                  </div>
                </motion.div>

                {/* Web APIs */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                  className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
                    <div className="flex items-center gap-2">
                      <Globe size={14} className="text-[#06b6d4]" />
                      <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                        Web APIs
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[#71717a]">
                      {state.webAPIs.length} active
                    </span>
                  </div>

                  <div className="p-3 min-h-[200px] space-y-2">
                    <AnimatePresence mode="popLayout">
                      {state.webAPIs.map((timer) => (
                        <motion.div
                          key={timer.id}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20, scale: 0.8 }}
                          transition={{ duration: 0.25 }}
                          className="px-3 py-2.5 rounded-lg bg-[#06b6d4]/10 border border-[#06b6d4]/20"
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-mono font-medium text-[#06b6d4]">
                              {timer.label}
                            </span>
                            <span className="text-[10px] font-mono text-[#71717a]">
                              <Clock size={10} className="inline mr-1" />
                              {timer.remainingTicks > 0 ? "waiting" : "ready"}
                            </span>
                          </div>
                          <div className="text-[10px] text-[#a1a1aa] font-mono truncate">
                            {timer.callback}
                          </div>
                          {/* Timer progress bar */}
                          <div className="mt-1.5 h-1 bg-[#1e1e2e] rounded-full overflow-hidden">
                            <motion.div
                              className="h-full bg-[#06b6d4] rounded-full"
                              animate={{
                                width: `${((timer.totalTicks - timer.remainingTicks) / timer.totalTicks) * 100}%`,
                              }}
                            />
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {state.webAPIs.length === 0 && (
                      <div className="text-[10px] text-[#71717a] italic text-center py-8">
                        No active Web APIs
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>

              {/* Bottom row: Microtask Queue + Macrotask Queue */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Microtask Queue */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
                    <div className="flex items-center gap-2">
                      <Zap size={14} className="text-[#10b981]" />
                      <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                        Microtask Queue
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[#71717a]">
                      {state.microtaskQueue.length} pending
                    </span>
                  </div>

                  <div className="p-3 min-h-[120px]">
                    <div className="flex flex-wrap gap-2">
                      <AnimatePresence mode="popLayout">
                        {state.microtaskQueue.map((item, i) => (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: 0, scale: 0.7, x: 20 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.7, x: -20 }}
                            transition={{ duration: 0.2 }}
                            className="px-3 py-2 rounded-lg border"
                            style={{
                              backgroundColor: "#10b98115",
                              borderColor: "#10b98130",
                              boxShadow:
                                i === 0 &&
                                (state.phase === "check-microtasks" ||
                                  state.phase === "process-microtask")
                                  ? "0 0 12px rgba(16, 185, 129, 0.3)"
                                  : "none",
                            }}
                          >
                            <div className="text-xs font-mono font-medium text-[#10b981]">
                              {item.label}
                            </div>
                            <div className="text-[10px] text-[#a1a1aa] font-mono mt-0.5 truncate max-w-[150px]">
                              {item.callback}
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                    {state.microtaskQueue.length === 0 && (
                      <div className="text-[10px] text-[#71717a] italic text-center py-6">
                        Empty
                      </div>
                    )}

                    {/* Priority indicator */}
                    <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[#10b981]/60">
                      <Zap size={10} />
                      <span>
                        High priority: processed before macrotasks
                      </span>
                    </div>
                  </div>
                </motion.div>

                {/* Macrotask Queue */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                  className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
                    <div className="flex items-center gap-2">
                      <Clock size={14} className="text-[#f59e0b]" />
                      <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                        Macrotask Queue
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[#71717a]">
                      {state.macrotaskQueue.length} pending
                    </span>
                  </div>

                  <div className="p-3 min-h-[120px]">
                    <div className="flex flex-wrap gap-2">
                      <AnimatePresence mode="popLayout">
                        {state.macrotaskQueue.map((item, i) => (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: 0, scale: 0.7, x: 20 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.7, x: -20 }}
                            transition={{ duration: 0.2 }}
                            className="px-3 py-2 rounded-lg border"
                            style={{
                              backgroundColor: "#f59e0b15",
                              borderColor: "#f59e0b30",
                              boxShadow:
                                i === 0 &&
                                (state.phase === "check-macrotasks" ||
                                  state.phase === "process-macrotask")
                                  ? "0 0 12px rgba(245, 158, 11, 0.3)"
                                  : "none",
                            }}
                          >
                            <div className="text-xs font-mono font-medium text-[#f59e0b]">
                              {item.label}
                            </div>
                            <div className="text-[10px] text-[#a1a1aa] font-mono mt-0.5 truncate max-w-[150px]">
                              {item.callback}
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                    {state.macrotaskQueue.length === 0 && (
                      <div className="text-[10px] text-[#71717a] italic text-center py-6">
                        Empty
                      </div>
                    )}

                    {/* Priority indicator */}
                    <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[#f59e0b]/60">
                      <Clock size={10} />
                      <span>
                        Lower priority: one per loop iteration
                      </span>
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* How It Works */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <RotateCw size={14} className="text-[#71717a]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    How The Event Loop Works
                  </span>
                </div>

                <div className="p-4 space-y-3 text-xs text-[#a1a1aa] leading-relaxed">
                  <p>
                    JavaScript is <strong className="text-white">single-threaded</strong> -
                    it can only execute one thing at a time on the{" "}
                    <strong className="text-[#6366f1]">call stack</strong>.
                    The event loop enables asynchronous behavior.
                  </p>
                  <div className="space-y-1.5">
                    <p className="text-[#71717a] font-semibold uppercase tracking-wider text-[10px]">
                      Execution Order:
                    </p>
                    <ol className="space-y-1 ml-2 list-decimal list-inside">
                      <li>
                        Run all <strong className="text-[#6366f1]">synchronous code</strong>{" "}
                        on the call stack
                      </li>
                      <li>
                        When call stack empties, drain{" "}
                        <strong className="text-[#10b981]">ALL microtasks</strong>{" "}
                        (Promise .then, queueMicrotask)
                      </li>
                      <li>
                        Process <strong className="text-[#f59e0b]">ONE macrotask</strong>{" "}
                        (setTimeout, setInterval, I/O)
                      </li>
                      <li>Repeat from step 2</li>
                    </ol>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="p-2 rounded-lg bg-[#10b981]/5 border border-[#10b981]/10">
                      <div className="text-[10px] font-bold text-[#10b981] mb-1">
                        Microtasks
                      </div>
                      <div className="text-[10px] text-[#71717a]">
                        Promise.then, catch, finally, queueMicrotask, MutationObserver
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-[#f59e0b]/5 border border-[#f59e0b]/10">
                      <div className="text-[10px] font-bold text-[#f59e0b] mb-1">
                        Macrotasks
                      </div>
                      <div className="text-[10px] text-[#71717a]">
                        setTimeout, setInterval, setImmediate, I/O, UI rendering
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] mt-2">
                    <strong className="text-[#ef4444]">Key insight:</strong>{" "}
                    Microtasks can schedule more microtasks, and they ALL run
                    before the next macrotask. This is why Promise callbacks
                    always execute before setTimeout(fn, 0) callbacks.
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════ */

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-[#71717a] mb-0.5">
        {label}
      </div>
      <div className="text-base font-bold font-mono" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
