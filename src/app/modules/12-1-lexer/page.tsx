"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Code2,
  ScanLine,
  AlertTriangle,
  Type,
  Hash,
  Braces,
  Quote,
  Terminal,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

/* ═══════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════ */

type TokenType =
  | "KEYWORD"
  | "IDENTIFIER"
  | "NUMBER"
  | "OPERATOR"
  | "PUNCTUATION"
  | "STRING"
  | "WHITESPACE"
  | "ERROR";

type LexerState =
  | "START"
  | "IN_IDENTIFIER"
  | "IN_NUMBER"
  | "IN_STRING"
  | "IN_OPERATOR"
  | "IN_COMMENT"
  | "DONE"
  | "ERROR";

interface Token {
  id: number;
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

interface DFANode {
  id: string;
  label: string;
  x: number;
  y: number;
  accepting: boolean;
}

interface DFAEdge {
  from: string;
  to: string;
  label: string;
}

interface Scenario {
  id: string;
  label: string;
  description: string;
  code: string;
}

const TOKEN_COLORS: Record<TokenType, string> = {
  KEYWORD: "#6366f1",
  IDENTIFIER: "#06b6d4",
  NUMBER: "#10b981",
  OPERATOR: "#f59e0b",
  PUNCTUATION: "#a855f7",
  STRING: "#ec4899",
  WHITESPACE: "#71717a",
  ERROR: "#ef4444",
};

const TOKEN_ICONS: Record<TokenType, string> = {
  KEYWORD: "K",
  IDENTIFIER: "Id",
  NUMBER: "#",
  OPERATOR: "Op",
  PUNCTUATION: "P",
  STRING: "S",
  WHITESPACE: "W",
  ERROR: "!",
};

const KEYWORDS = new Set([
  "let",
  "const",
  "var",
  "function",
  "return",
  "if",
  "else",
  "while",
  "for",
  "class",
  "new",
  "this",
  "true",
  "false",
  "null",
  "undefined",
  "async",
  "await",
  "import",
  "export",
  "default",
  "from",
  "typeof",
  "void",
  "switch",
  "case",
  "break",
  "continue",
  "try",
  "catch",
  "throw",
]);

const OPERATORS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "!",
  "<",
  ">",
  "&",
  "|",
  "^",
  "~",
  "?",
  ":",
  "==",
  "!=",
  "===",
  "!==",
  "<=",
  ">=",
  "&&",
  "||",
  "+=",
  "-=",
  "*=",
  "/=",
  "=>",
  "++",
  "--",
]);

const PUNCTUATION_CHARS = new Set([
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  ";",
  ",",
  ".",
]);

const OPERATOR_CHARS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "!",
  "<",
  ">",
  "&",
  "|",
  "^",
  "~",
  "?",
  ":",
]);

const SCENARIOS: Scenario[] = [
  {
    id: "simple-assign",
    label: "Simple Assignment",
    description: "Variable declaration and arithmetic",
    code: 'let x = 42 + y;',
  },
  {
    id: "function-decl",
    label: "Function Declaration",
    description: "Function with parameters and return",
    code: 'function add(a, b) {\n  return a + b;\n}',
  },
  {
    id: "string-literals",
    label: "String Literals",
    description: "Different string types and operations",
    code: 'const msg = "hello";\nlet name = \'world\';\nlet full = msg + " " + name;',
  },
  {
    id: "complex-expr",
    label: "Complex Expression",
    description: "Nested expressions with multiple operators",
    code: 'let result = (x + 3) * y - z / 2;\nif (result >= 100) {\n  return true;\n}',
  },
];

/* ═══════════════════════════════════════════════════════════
   DFA STATES FOR VISUALIZATION
   ═══════════════════════════════════════════════════════════ */

const DFA_NODES: DFANode[] = [
  { id: "start", label: "START", x: 60, y: 100, accepting: false },
  { id: "in_id", label: "IN_ID", x: 200, y: 40, accepting: true },
  { id: "in_num", label: "IN_NUM", x: 200, y: 160, accepting: true },
  { id: "in_str", label: "IN_STR", x: 340, y: 40, accepting: false },
  { id: "str_end", label: "STR_END", x: 440, y: 40, accepting: true },
  { id: "in_op", label: "IN_OP", x: 340, y: 160, accepting: true },
];

const DFA_EDGES: DFAEdge[] = [
  { from: "start", to: "in_id", label: "[a-z]" },
  { from: "start", to: "in_num", label: "[0-9]" },
  { from: "start", to: "in_str", label: '"/\'' },
  { from: "start", to: "in_op", label: "op" },
  { from: "in_id", to: "in_id", label: "[a-z0-9]" },
  { from: "in_num", to: "in_num", label: "[0-9.]" },
  { from: "in_str", to: "in_str", label: "any" },
  { from: "in_str", to: "str_end", label: '"/\'' },
];

const DFA_STATE_MAP: Record<string, string> = {
  START: "start",
  IN_IDENTIFIER: "in_id",
  IN_NUMBER: "in_num",
  IN_STRING: "in_str",
  IN_OPERATOR: "in_op",
  DONE: "start",
  ERROR: "start",
};

/* ═══════════════════════════════════════════════════════════
   LEXER LOGIC
   ═══════════════════════════════════════════════════════════ */

function isAlpha(ch: string): boolean {
  return /[a-zA-Z_$]/.test(ch);
}

function isDigit(ch: string): boolean {
  return /[0-9]/.test(ch);
}

function isAlphaNum(ch: string): boolean {
  return /[a-zA-Z0-9_$]/.test(ch);
}

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

interface LexerSnapshot {
  position: number;
  state: LexerState;
  tokens: Token[];
  currentTokenStart: number;
  buffer: string;
  done: boolean;
  errorMessage: string | null;
}

function createInitialSnapshot(source: string): LexerSnapshot {
  return {
    position: 0,
    state: "START",
    tokens: [],
    currentTokenStart: 0,
    buffer: "",
    done: source.length === 0,
    errorMessage: null,
  };
}

let globalTokenId = 0;

function stepLexer(snapshot: LexerSnapshot, source: string): LexerSnapshot {
  if (snapshot.done || snapshot.position >= source.length) {
    // If we have a pending buffer, finalize it
    if (snapshot.buffer.length > 0) {
      const newTokens = [...snapshot.tokens];
      let tokenType: TokenType = "ERROR";
      const buf = snapshot.buffer;

      if (snapshot.state === "IN_IDENTIFIER") {
        tokenType = KEYWORDS.has(buf) ? "KEYWORD" : "IDENTIFIER";
      } else if (snapshot.state === "IN_NUMBER") {
        tokenType = "NUMBER";
      } else if (snapshot.state === "IN_OPERATOR") {
        tokenType = "OPERATOR";
      }

      newTokens.push({
        id: ++globalTokenId,
        type: tokenType,
        value: buf,
        start: snapshot.currentTokenStart,
        end: snapshot.position,
      });

      return {
        ...snapshot,
        tokens: newTokens,
        buffer: "",
        state: "DONE",
        done: true,
      };
    }
    return { ...snapshot, state: "DONE", done: true };
  }

  const ch = source[snapshot.position];
  const newTokens = [...snapshot.tokens];
  let newState = snapshot.state;
  let newPos = snapshot.position;
  let newBuffer = snapshot.buffer;
  let newTokenStart = snapshot.currentTokenStart;
  let errorMessage: string | null = null;

  switch (snapshot.state) {
    case "START": {
      if (isWhitespace(ch)) {
        // Emit whitespace token
        let wsEnd = newPos;
        while (wsEnd < source.length && isWhitespace(source[wsEnd])) {
          wsEnd++;
        }
        const wsValue = source.substring(newPos, wsEnd);
        newTokens.push({
          id: ++globalTokenId,
          type: "WHITESPACE",
          value: wsValue,
          start: newPos,
          end: wsEnd,
        });
        newPos = wsEnd;
        newState = "START";
      } else if (isAlpha(ch)) {
        newState = "IN_IDENTIFIER";
        newBuffer = ch;
        newTokenStart = newPos;
        newPos++;
      } else if (isDigit(ch)) {
        newState = "IN_NUMBER";
        newBuffer = ch;
        newTokenStart = newPos;
        newPos++;
      } else if (ch === '"' || ch === "'") {
        newState = "IN_STRING";
        newBuffer = ch;
        newTokenStart = newPos;
        newPos++;
      } else if (PUNCTUATION_CHARS.has(ch)) {
        newTokens.push({
          id: ++globalTokenId,
          type: "PUNCTUATION",
          value: ch,
          start: newPos,
          end: newPos + 1,
        });
        newPos++;
        newState = "START";
      } else if (OPERATOR_CHARS.has(ch)) {
        newState = "IN_OPERATOR";
        newBuffer = ch;
        newTokenStart = newPos;
        newPos++;
      } else {
        // Unknown character - error
        newTokens.push({
          id: ++globalTokenId,
          type: "ERROR",
          value: ch,
          start: newPos,
          end: newPos + 1,
        });
        errorMessage = `Unexpected character '${ch}' at position ${newPos}`;
        newPos++;
        newState = "START";
      }
      break;
    }

    case "IN_IDENTIFIER": {
      if (isAlphaNum(ch)) {
        newBuffer += ch;
        newPos++;
      } else {
        // Emit identifier or keyword token
        const tokenType: TokenType = KEYWORDS.has(newBuffer)
          ? "KEYWORD"
          : "IDENTIFIER";
        newTokens.push({
          id: ++globalTokenId,
          type: tokenType,
          value: newBuffer,
          start: newTokenStart,
          end: newPos,
        });
        newBuffer = "";
        newState = "START";
        // Don't advance position - re-process this character
      }
      break;
    }

    case "IN_NUMBER": {
      if (isDigit(ch) || (ch === "." && !newBuffer.includes("."))) {
        newBuffer += ch;
        newPos++;
      } else {
        // Emit number token
        newTokens.push({
          id: ++globalTokenId,
          type: "NUMBER",
          value: newBuffer,
          start: newTokenStart,
          end: newPos,
        });
        newBuffer = "";
        newState = "START";
      }
      break;
    }

    case "IN_STRING": {
      const quoteChar = newBuffer[0];
      newBuffer += ch;
      newPos++;
      if (ch === quoteChar && newBuffer.length > 1) {
        // End of string
        newTokens.push({
          id: ++globalTokenId,
          type: "STRING",
          value: newBuffer,
          start: newTokenStart,
          end: newPos,
        });
        newBuffer = "";
        newState = "START";
      } else if (newPos >= source.length && ch !== quoteChar) {
        // Unterminated string
        newTokens.push({
          id: ++globalTokenId,
          type: "ERROR",
          value: newBuffer,
          start: newTokenStart,
          end: newPos,
        });
        errorMessage = `Unterminated string starting at position ${newTokenStart}`;
        newBuffer = "";
        newState = "START";
      }
      break;
    }

    case "IN_OPERATOR": {
      // Try to extend the operator (e.g., = → ==, == → ===)
      const combined = newBuffer + ch;
      if (OPERATORS.has(combined)) {
        newBuffer = combined;
        newPos++;
      } else {
        // Emit operator token
        newTokens.push({
          id: ++globalTokenId,
          type: "OPERATOR",
          value: newBuffer,
          start: newTokenStart,
          end: newPos,
        });
        newBuffer = "";
        newState = "START";
      }
      break;
    }

    default:
      newPos++;
      break;
  }

  const done =
    newPos >= source.length &&
    newState === "START" &&
    newBuffer.length === 0;

  return {
    position: newPos,
    state: newState,
    tokens: newTokens,
    currentTokenStart: newTokenStart,
    buffer: newBuffer,
    done,
    errorMessage: errorMessage || snapshot.errorMessage,
  };
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function LexerPage() {
  /* ─── Core simulation state ─── */
  const [sourceCode, setSourceCode] = useState(SCENARIOS[0].code);
  const [snapshot, setSnapshot] = useState<LexerSnapshot>(() =>
    createInitialSnapshot(SCENARIOS[0].code)
  );
  const [activeScenario, setActiveScenario] = useState(SCENARIOS[0].id);

  /* ─── UI state ─── */
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editBuffer, setEditBuffer] = useState(sourceCode);

  /* ─── Refs for animation loop ─── */
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const snapshotRef = useRef(snapshot);
  const sourceRef = useRef(sourceCode);
  const tokenStreamRef = useRef<HTMLDivElement>(null);

  snapshotRef.current = snapshot;
  sourceRef.current = sourceCode;

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  /* Auto-scroll token stream */
  useEffect(() => {
    tokenStreamRef.current?.scrollTo({
      top: tokenStreamRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [snapshot.tokens.length]);

  /* ─── Step forward ─── */
  const stepForward = useCallback(() => {
    setSnapshot((prev) => {
      if (prev.done) {
        setIsPlaying(false);
        return prev;
      }
      return stepLexer(prev, sourceRef.current);
    });
  }, []);

  /* ─── Animation loop ─── */
  const animationLoop = useCallback(
    (timestamp: number) => {
      if (!isPlayingRef.current) return;
      const interval = Math.max(10, 200 / speedRef.current);
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
    globalTokenId = 0;
    setSnapshot(createInitialSnapshot(sourceRef.current));
  }, []);

  const handleScenarioSelect = useCallback(
    (scenarioId: string) => {
      const scenario = SCENARIOS.find((s) => s.id === scenarioId);
      if (!scenario) return;
      setIsPlaying(false);
      globalTokenId = 0;
      setActiveScenario(scenarioId);
      setSourceCode(scenario.code);
      setEditBuffer(scenario.code);
      sourceRef.current = scenario.code;
      setSnapshot(createInitialSnapshot(scenario.code));
    },
    []
  );

  const handleApplyCustomCode = useCallback(() => {
    setIsPlaying(false);
    globalTokenId = 0;
    setSourceCode(editBuffer);
    sourceRef.current = editBuffer;
    setSnapshot(createInitialSnapshot(editBuffer));
    setEditMode(false);
    setActiveScenario("");
  }, [editBuffer]);

  /* ─── Metrics ─── */
  const metrics = useMemo(() => {
    const visibleTokens = snapshot.tokens.filter(
      (t) => t.type !== "WHITESPACE"
    );
    const typeCounts: Partial<Record<TokenType, number>> = {};
    visibleTokens.forEach((t) => {
      typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
    });
    const errors = snapshot.tokens.filter((t) => t.type === "ERROR").length;
    return {
      charsScanned: snapshot.position,
      totalChars: sourceRef.current.length,
      tokensFound: visibleTokens.length,
      errors,
      typeCounts,
      progress:
        sourceRef.current.length > 0
          ? Math.round((snapshot.position / sourceRef.current.length) * 100)
          : 0,
    };
  }, [snapshot]);

  /* ─── DFA active state ─── */
  const activeDfaNode = DFA_STATE_MAP[snapshot.state] || "start";

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
                12.1
              </span>
              <div className="flex items-center gap-1.5 text-xs text-[#71717a]">
                <Code2 size={12} />
                <span>Compiler &amp; Language Internals</span>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Lexical Analysis
            </h1>
            <p className="mt-1.5 text-[#a1a1aa] text-sm sm:text-base max-w-2xl">
              Watch a lexer scan source code character by character, recognizing
              tokens through a deterministic finite automaton
            </p>
          </motion.div>
        </div>

        {/* ── Scenario selector ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-[#71717a] mr-1">
              <Terminal size={14} />
              <span>Presets</span>
            </div>
            {SCENARIOS.map((scenario) => (
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
            <button
              onClick={() => setEditMode(!editMode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                editMode
                  ? "bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30"
                  : "bg-[#1e1e2e] text-[#a1a1aa] border border-transparent hover:bg-[#2a2a3e] hover:text-white"
              }`}
            >
              Custom Code
            </button>
          </div>
        </div>

        {/* ── Custom code editor ── */}
        <AnimatePresence>
          {editMode && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3 overflow-hidden"
            >
              <div className="p-3 rounded-xl bg-[#111118] border border-[#1e1e2e]">
                <textarea
                  value={editBuffer}
                  onChange={(e) => setEditBuffer(e.target.value)}
                  className="w-full h-24 bg-[#0a0a0f] text-[#e4e4e7] text-sm font-mono p-3 rounded-lg border border-[#1e1e2e] focus:border-[#6366f1]/50 focus:outline-none resize-none"
                  placeholder="Enter your code here..."
                  spellCheck={false}
                />
                <div className="flex justify-end mt-2">
                  <button
                    onClick={handleApplyCustomCode}
                    className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#6366f1] hover:bg-[#818cf8] text-white transition-all duration-200"
                  >
                    Apply &amp; Reset
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
                <MetricCard
                  label="Progress"
                  value={`${metrics.progress}%`}
                  color="#6366f1"
                />
                <MetricCard
                  label="Chars Scanned"
                  value={`${metrics.charsScanned}/${metrics.totalChars}`}
                  color="#06b6d4"
                />
                <MetricCard
                  label="Tokens Found"
                  value={String(metrics.tokensFound)}
                  color="#10b981"
                />
                <MetricCard
                  label="Errors"
                  value={String(metrics.errors)}
                  color={metrics.errors > 0 ? "#ef4444" : "#71717a"}
                />
                <MetricCard
                  label="State"
                  value={snapshot.state}
                  color="#f59e0b"
                />
                {Object.entries(metrics.typeCounts).map(([type, count]) => (
                  <MetricCard
                    key={type}
                    label={type}
                    value={String(count)}
                    color={TOKEN_COLORS[type as TokenType]}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Main Layout ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
            {/* ── Left column: Source Code + Token Stream ── */}
            <div className="space-y-4">
              {/* Source Code Panel */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
                  <div className="flex items-center gap-2">
                    <ScanLine size={14} className="text-[#6366f1]" />
                    <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                      Source Code Scanner
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[#71717a]">
                      pos: {snapshot.position}/{sourceCode.length}
                    </span>
                  </div>
                </div>

                {/* Source code display */}
                <div className="p-4 font-mono text-sm leading-relaxed relative min-h-[120px]">
                  <div className="whitespace-pre-wrap break-all">
                    {sourceCode.split("").map((ch, i) => {
                      // Determine highlight state
                      const isCurrent = i === snapshot.position;
                      const isScanned = i < snapshot.position;
                      const isInBuffer =
                        snapshot.buffer.length > 0 &&
                        i >= snapshot.currentTokenStart &&
                        i < snapshot.position;

                      // Find the token this char belongs to (if scanned)
                      let tokenColor: string | null = null;
                      if (isScanned && !isInBuffer) {
                        for (const token of snapshot.tokens) {
                          if (
                            i >= token.start &&
                            i < token.end &&
                            token.type !== "WHITESPACE"
                          ) {
                            tokenColor = TOKEN_COLORS[token.type];
                            break;
                          }
                        }
                      }

                      return (
                        <span
                          key={i}
                          className={`relative inline-block transition-all duration-150 ${
                            ch === "\n" ? "block h-0" : ""
                          }`}
                          style={{
                            color: isCurrent
                              ? "#fbbf24"
                              : isInBuffer
                              ? "#e2e8f0"
                              : tokenColor || (isScanned ? "#a1a1aa" : "#4a4a5a"),
                            backgroundColor: isCurrent
                              ? "rgba(251, 191, 36, 0.15)"
                              : isInBuffer
                              ? "rgba(99, 102, 241, 0.1)"
                              : "transparent",
                            borderBottom: isCurrent
                              ? "2px solid #fbbf24"
                              : "none",
                            textShadow: isCurrent
                              ? "0 0 12px rgba(251, 191, 36, 0.6)"
                              : "none",
                            fontWeight: isCurrent ? 700 : 400,
                            minWidth: ch === " " ? "0.5em" : undefined,
                          }}
                        >
                          {ch === "\n" ? "\u21B5\n" : ch === " " ? "\u00A0" : ch}
                        </span>
                      );
                    })}
                    {/* Cursor at end */}
                    {snapshot.position >= sourceCode.length && !snapshot.done && (
                      <span
                        className="inline-block w-2 h-5 bg-[#fbbf24] animate-pulse rounded-sm"
                        style={{ verticalAlign: "text-bottom" }}
                      />
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="mt-4 h-1 bg-[#1e1e2e] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-[#6366f1] to-[#06b6d4]"
                      animate={{
                        width: `${metrics.progress}%`,
                      }}
                      transition={{ duration: 0.2 }}
                    />
                  </div>
                </div>
              </motion.div>

              {/* Token Stream */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
                  <div className="flex items-center gap-2">
                    <Braces size={14} className="text-[#a855f7]" />
                    <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                      Token Stream
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-[#71717a]">
                    {snapshot.tokens.filter((t) => t.type !== "WHITESPACE")
                      .length}{" "}
                    tokens
                  </span>
                </div>

                <div
                  ref={tokenStreamRef}
                  className="p-4 flex flex-wrap gap-2 max-h-[240px] overflow-y-auto scrollbar-thin"
                >
                  <AnimatePresence mode="popLayout">
                    {snapshot.tokens
                      .filter((t) => t.type !== "WHITESPACE")
                      .map((token) => (
                        <motion.div
                          key={token.id}
                          initial={{ opacity: 0, scale: 0.7, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.7 }}
                          transition={{ duration: 0.2 }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border"
                          style={{
                            backgroundColor: `${TOKEN_COLORS[token.type]}10`,
                            borderColor: `${TOKEN_COLORS[token.type]}30`,
                          }}
                        >
                          <span
                            className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                            style={{
                              backgroundColor: `${TOKEN_COLORS[token.type]}20`,
                              color: TOKEN_COLORS[token.type],
                            }}
                          >
                            {TOKEN_ICONS[token.type]}
                          </span>
                          <span
                            className="text-xs font-mono font-medium"
                            style={{ color: TOKEN_COLORS[token.type] }}
                          >
                            {token.value.replace(/\n/g, "\\n")}
                          </span>
                        </motion.div>
                      ))}
                  </AnimatePresence>

                  {snapshot.tokens.filter((t) => t.type !== "WHITESPACE")
                    .length === 0 && (
                    <div className="text-xs text-[#71717a] italic py-4 w-full text-center">
                      Press Play or Step to start scanning...
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Token Table */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <Type size={14} className="text-[#06b6d4]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Token Table
                  </span>
                </div>

                <div className="max-h-[280px] overflow-y-auto scrollbar-thin">
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0 bg-[#111118]">
                      <tr className="text-[#71717a] border-b border-[#1e1e2e]">
                        <th className="px-4 py-2 text-left font-medium">#</th>
                        <th className="px-4 py-2 text-left font-medium">
                          Type
                        </th>
                        <th className="px-4 py-2 text-left font-medium">
                          Value
                        </th>
                        <th className="px-4 py-2 text-left font-medium">
                          Position
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <AnimatePresence mode="popLayout">
                        {snapshot.tokens
                          .filter((t) => t.type !== "WHITESPACE")
                          .map((token, idx) => (
                            <motion.tr
                              key={token.id}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.15 }}
                              className="border-b border-[#1e1e2e]/50 hover:bg-[#1e1e2e]/30 transition-colors"
                            >
                              <td className="px-4 py-1.5 text-[#71717a]">
                                {idx + 1}
                              </td>
                              <td className="px-4 py-1.5">
                                <span
                                  className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
                                  style={{
                                    backgroundColor: `${TOKEN_COLORS[token.type]}15`,
                                    color: TOKEN_COLORS[token.type],
                                  }}
                                >
                                  {token.type}
                                </span>
                              </td>
                              <td
                                className="px-4 py-1.5 font-semibold"
                                style={{
                                  color: TOKEN_COLORS[token.type],
                                }}
                              >
                                {token.value.replace(/\n/g, "\\n")}
                              </td>
                              <td className="px-4 py-1.5 text-[#71717a]">
                                {token.start}:{token.end}
                              </td>
                            </motion.tr>
                          ))}
                      </AnimatePresence>
                    </tbody>
                  </table>

                  {snapshot.tokens.filter((t) => t.type !== "WHITESPACE")
                    .length === 0 && (
                    <div className="text-xs text-[#71717a] italic py-6 text-center">
                      No tokens yet
                    </div>
                  )}
                </div>
              </motion.div>
            </div>

            {/* ── Right column: DFA + State + Info ── */}
            <div className="space-y-4">
              {/* Lexer State */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <Hash size={14} className="text-[#f59e0b]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Scanner State
                  </span>
                </div>

                <div className="p-4 space-y-3">
                  {/* Current state badge */}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[#71717a] uppercase tracking-wider w-14 shrink-0">
                      State
                    </span>
                    <motion.div
                      key={snapshot.state}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold"
                      style={{
                        backgroundColor:
                          snapshot.state === "START"
                            ? "rgba(99, 102, 241, 0.15)"
                            : snapshot.state === "DONE"
                            ? "rgba(16, 185, 129, 0.15)"
                            : snapshot.state === "ERROR"
                            ? "rgba(239, 68, 68, 0.15)"
                            : "rgba(245, 158, 11, 0.15)",
                        color:
                          snapshot.state === "START"
                            ? "#6366f1"
                            : snapshot.state === "DONE"
                            ? "#10b981"
                            : snapshot.state === "ERROR"
                            ? "#ef4444"
                            : "#f59e0b",
                        border: `1px solid ${
                          snapshot.state === "START"
                            ? "rgba(99, 102, 241, 0.3)"
                            : snapshot.state === "DONE"
                            ? "rgba(16, 185, 129, 0.3)"
                            : snapshot.state === "ERROR"
                            ? "rgba(239, 68, 68, 0.3)"
                            : "rgba(245, 158, 11, 0.3)"
                        }`,
                      }}
                    >
                      {snapshot.state}
                    </motion.div>
                  </div>

                  {/* Current character */}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[#71717a] uppercase tracking-wider w-14 shrink-0">
                      Char
                    </span>
                    <div className="px-3 py-1.5 rounded-lg bg-[#fbbf24]/10 border border-[#fbbf24]/20 text-[#fbbf24] text-xs font-mono font-bold min-w-[40px] text-center">
                      {snapshot.position < sourceCode.length
                        ? sourceCode[snapshot.position] === "\n"
                          ? "\\n"
                          : sourceCode[snapshot.position] === " "
                          ? "SP"
                          : `'${sourceCode[snapshot.position]}'`
                        : "EOF"}
                    </div>
                    <span className="text-[10px] text-[#71717a] font-mono">
                      @{snapshot.position}
                    </span>
                  </div>

                  {/* Buffer */}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[#71717a] uppercase tracking-wider w-14 shrink-0">
                      Buffer
                    </span>
                    <div className="px-3 py-1.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-[#e4e4e7] text-xs font-mono min-w-[60px] min-h-[28px]">
                      {snapshot.buffer || (
                        <span className="text-[#71717a] italic">empty</span>
                      )}
                    </div>
                  </div>

                  {/* Error message */}
                  <AnimatePresence>
                    {snapshot.errorMessage && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/20"
                      >
                        <AlertTriangle
                          size={12}
                          className="text-[#ef4444] mt-0.5 shrink-0"
                        />
                        <span className="text-[11px] text-[#ef4444]">
                          {snapshot.errorMessage}
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>

              {/* DFA Visualization */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <Code2 size={14} className="text-[#10b981]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Scanner DFA
                  </span>
                </div>

                <div className="p-2">
                  <svg
                    viewBox="0 0 500 200"
                    className="w-full"
                    style={{ height: 200 }}
                  >
                    {/* Edges */}
                    {DFA_EDGES.map((edge, i) => {
                      const fromNode = DFA_NODES.find(
                        (n) => n.id === edge.from
                      )!;
                      const toNode = DFA_NODES.find(
                        (n) => n.id === edge.to
                      )!;

                      if (edge.from === edge.to) {
                        // Self-loop
                        return (
                          <g key={i}>
                            <path
                              d={`M ${fromNode.x} ${fromNode.y - 22} C ${fromNode.x - 30} ${fromNode.y - 60}, ${fromNode.x + 30} ${fromNode.y - 60}, ${fromNode.x} ${fromNode.y - 22}`}
                              fill="none"
                              stroke="#2a2a3e"
                              strokeWidth="1.5"
                            />
                            <text
                              x={fromNode.x}
                              y={fromNode.y - 55}
                              textAnchor="middle"
                              className="text-[8px] fill-[#71717a]"
                              fontFamily="monospace"
                            >
                              {edge.label}
                            </text>
                          </g>
                        );
                      }

                      const dx = toNode.x - fromNode.x;
                      const dy = toNode.y - fromNode.y;
                      const len = Math.sqrt(dx * dx + dy * dy);
                      const ux = dx / len;
                      const uy = dy / len;
                      const startX = fromNode.x + ux * 22;
                      const startY = fromNode.y + uy * 22;
                      const endX = toNode.x - ux * 22;
                      const endY = toNode.y - uy * 22;
                      const midX = (startX + endX) / 2;
                      const midY = (startY + endY) / 2 - 8;

                      const isActive =
                        activeDfaNode === edge.from ||
                        activeDfaNode === edge.to;

                      return (
                        <g key={i}>
                          <line
                            x1={startX}
                            y1={startY}
                            x2={endX}
                            y2={endY}
                            stroke={isActive ? "#6366f1" : "#2a2a3e"}
                            strokeWidth={isActive ? 2 : 1.5}
                            markerEnd="url(#arrowhead)"
                            opacity={isActive ? 1 : 0.6}
                          />
                          <text
                            x={midX}
                            y={midY}
                            textAnchor="middle"
                            className="text-[8px]"
                            fill={isActive ? "#a1a1aa" : "#71717a"}
                            fontFamily="monospace"
                          >
                            {edge.label}
                          </text>
                        </g>
                      );
                    })}

                    {/* Arrow marker */}
                    <defs>
                      <marker
                        id="arrowhead"
                        markerWidth="8"
                        markerHeight="6"
                        refX="8"
                        refY="3"
                        orient="auto"
                      >
                        <polygon
                          points="0 0, 8 3, 0 6"
                          fill="#71717a"
                        />
                      </marker>
                    </defs>

                    {/* Nodes */}
                    {DFA_NODES.map((node) => {
                      const isActive = activeDfaNode === node.id;
                      return (
                        <g key={node.id}>
                          {/* Glow */}
                          {isActive && (
                            <circle
                              cx={node.x}
                              cy={node.y}
                              r={26}
                              fill="none"
                              stroke="#6366f1"
                              strokeWidth="1"
                              opacity="0.3"
                            >
                              <animate
                                attributeName="r"
                                values="26;30;26"
                                dur="1.5s"
                                repeatCount="indefinite"
                              />
                              <animate
                                attributeName="opacity"
                                values="0.3;0.1;0.3"
                                dur="1.5s"
                                repeatCount="indefinite"
                              />
                            </circle>
                          )}

                          {/* Double circle for accepting states */}
                          {node.accepting && (
                            <circle
                              cx={node.x}
                              cy={node.y}
                              r={25}
                              fill="none"
                              stroke={isActive ? "#6366f1" : "#2a2a3e"}
                              strokeWidth="1.5"
                            />
                          )}

                          {/* Main circle */}
                          <circle
                            cx={node.x}
                            cy={node.y}
                            r={20}
                            fill={isActive ? "#6366f1" : "#1e1e2e"}
                            stroke={isActive ? "#818cf8" : "#2a2a3e"}
                            strokeWidth="2"
                          />

                          {/* Label */}
                          <text
                            x={node.x}
                            y={node.y + 1}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            className="text-[8px] font-mono font-bold"
                            fill={isActive ? "#fff" : "#a1a1aa"}
                          >
                            {node.label}
                          </text>
                        </g>
                      );
                    })}

                    {/* Entry arrow */}
                    <line
                      x1={10}
                      y1={100}
                      x2={38}
                      y2={100}
                      stroke="#71717a"
                      strokeWidth="1.5"
                      markerEnd="url(#arrowhead)"
                    />
                  </svg>
                </div>
              </motion.div>

              {/* Token Type Legend */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <Quote size={14} className="text-[#ec4899]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    Token Types
                  </span>
                </div>

                <div className="p-3 grid grid-cols-2 gap-2">
                  {(
                    Object.entries(TOKEN_COLORS) as [TokenType, string][]
                  )
                    .filter(([type]) => type !== "WHITESPACE")
                    .map(([type, color]) => (
                      <div
                        key={type}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                        style={{
                          backgroundColor: `${color}08`,
                        }}
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span
                          className="text-[10px] font-mono font-medium"
                          style={{ color }}
                        >
                          {type}
                        </span>
                      </div>
                    ))}
                </div>
              </motion.div>

              {/* How It Works */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="rounded-xl bg-[#111118] border border-[#1e1e2e] overflow-hidden"
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <Code2 size={14} className="text-[#71717a]" />
                  <span className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
                    How It Works
                  </span>
                </div>

                <div className="p-4 space-y-3 text-xs text-[#a1a1aa] leading-relaxed">
                  <p>
                    A <strong className="text-white">lexer</strong> (lexical analyzer)
                    is the first phase of a compiler. It reads raw source code as a
                    stream of characters and groups them into meaningful sequences
                    called <strong className="text-[#6366f1]">tokens</strong>.
                  </p>
                  <div className="space-y-1.5">
                    <p className="text-[#71717a] font-semibold uppercase tracking-wider text-[10px]">
                      Scanner States:
                    </p>
                    <ul className="space-y-1 ml-2">
                      <li>
                        <span className="text-[#6366f1]">START</span> - Waiting
                        for next token
                      </li>
                      <li>
                        <span className="text-[#f59e0b]">IN_IDENTIFIER</span> -
                        Reading a name/keyword
                      </li>
                      <li>
                        <span className="text-[#f59e0b]">IN_NUMBER</span> -
                        Reading a numeric literal
                      </li>
                      <li>
                        <span className="text-[#f59e0b]">IN_STRING</span> -
                        Reading a string literal
                      </li>
                      <li>
                        <span className="text-[#f59e0b]">IN_OPERATOR</span> -
                        Reading operator chars
                      </li>
                      <li>
                        <span className="text-[#10b981]">DONE</span> - All
                        characters processed
                      </li>
                    </ul>
                  </div>
                  <p>
                    The scanner uses a{" "}
                    <strong className="text-[#10b981]">
                      Deterministic Finite Automaton (DFA)
                    </strong>{" "}
                    to decide state transitions. Each character determines the
                    next state. When a token boundary is found, the buffered
                    characters are emitted as a token.
                  </p>
                  <p>
                    <strong className="text-[#f59e0b]">Maximal munch</strong>:
                    The lexer always reads as many characters as possible before
                    emitting a token (e.g., &quot;===&quot; is one token, not three).
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
