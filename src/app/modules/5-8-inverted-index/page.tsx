"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Search,
  Scissors,
  Database,
  Shuffle,
  ArrowRight,
  Hash,
  Layers,
  Filter,
  BookOpen,
  Tag,
  Info,
  X,
  Check,
} from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import ModuleControls from "@/components/ui/ModuleControls";

// ============================================================================
// Types
// ============================================================================

interface Document {
  id: number;
  title: string;
  content: string;
  color: string;
}

interface Token {
  original: string;
  lowercase: string;
  isStopWord: boolean;
  stemmed: string;
  docId: number;
}

interface PostingEntry {
  term: string;
  docIds: number[];
}

type Phase = "documents" | "tokenization" | "indexing" | "query";

interface AnimationStep {
  phase: Phase;
  message: string;
  activeDocId?: number;
  activeTokenIndex?: number;
  activeToken?: Token;
  processingStage?: "original" | "lowercase" | "stop-removal" | "stem";
  indexEntries: PostingEntry[];
  highlightTerm?: string;
  highlightDocs?: number[];
  processedTokens: Token[];
  currentDocTokens: Token[];
  queryTerms?: string[];
  queryResults?: number[];
  queryType?: "AND" | "OR";
}

type ScenarioId = "simple" | "technical" | "single-query" | "boolean-query";

interface Scenario {
  id: ScenarioId;
  label: string;
  description: string;
}

// ============================================================================
// Constants
// ============================================================================

const SCENARIOS: Scenario[] = [
  { id: "simple", label: "Simple Documents", description: "Process everyday text documents" },
  { id: "technical", label: "Technical Articles", description: "Process technical CS-related articles" },
  { id: "single-query", label: "Single Term Query", description: "Build index then search single term" },
  { id: "boolean-query", label: "Boolean Query", description: "Build index then run AND/OR queries" },
];

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "not", "only", "own", "same", "so", "than", "too", "very", "just",
  "because", "but", "and", "or", "if", "while", "that", "this", "it",
  "its", "i", "me", "my", "we", "our", "you", "your", "he", "him",
  "his", "she", "her", "they", "them", "their", "what", "which", "who",
]);

const DOC_COLORS = ["#6366f1", "#06b6d4", "#10b981", "#f59e0b", "#ef4444"];

const SIMPLE_DOCS: Document[] = [
  {
    id: 1,
    title: "The Cat",
    content: "The cat sat on the mat. The cat is fluffy and warm.",
    color: DOC_COLORS[0],
  },
  {
    id: 2,
    title: "The Dog",
    content: "A dog ran in the park. The dog is loyal and fast.",
    color: DOC_COLORS[1],
  },
  {
    id: 3,
    title: "The Garden",
    content: "The garden has flowers and trees. A cat sleeps in the warm garden.",
    color: DOC_COLORS[2],
  },
  {
    id: 4,
    title: "The Park",
    content: "The park is big and green. Dogs and cats play in the park.",
    color: DOC_COLORS[3],
  },
];

const TECHNICAL_DOCS: Document[] = [
  {
    id: 1,
    title: "Binary Search",
    content: "Binary search works on sorted arrays. It divides the search space in half each step for logarithmic time complexity.",
    color: DOC_COLORS[0],
  },
  {
    id: 2,
    title: "Hash Tables",
    content: "Hash tables provide constant time lookup. A hash function maps keys to array indices for fast search and insertion.",
    color: DOC_COLORS[1],
  },
  {
    id: 3,
    title: "B-Trees",
    content: "B-trees are balanced search trees used in databases. Each node can have multiple keys and children for efficient disk access.",
    color: DOC_COLORS[2],
  },
  {
    id: 4,
    title: "Inverted Index",
    content: "An inverted index maps terms to document lists. Search engines use inverted indices for fast full-text search and retrieval.",
    color: DOC_COLORS[3],
  },
];

const SINGLE_QUERY_TERMS = ["search"];
const BOOLEAN_QUERY_AND = ["search", "fast"];
const BOOLEAN_QUERY_OR = ["tree", "hash"];

// ============================================================================
// Text processing helpers
// ============================================================================

function tokenize(text: string): string[] {
  return text
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function simpleStem(word: string): string {
  // Very simplified stemming
  let w = word;
  if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("ly") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = w.slice(0, -1);
  else if (w.endsWith("ies") && w.length > 5) w = w.slice(0, -3) + "y";
  return w;
}

function processDocument(doc: Document): Token[] {
  const words = tokenize(doc.content);
  return words.map((word) => {
    const lc = word.toLowerCase();
    const isSW = STOP_WORDS.has(lc);
    const stemmed = isSW ? lc : simpleStem(lc);
    return {
      original: word,
      lowercase: lc,
      isStopWord: isSW,
      stemmed,
      docId: doc.id,
    };
  });
}

function buildIndex(allTokens: Token[]): PostingEntry[] {
  const indexMap = new Map<string, Set<number>>();
  for (const token of allTokens) {
    if (token.isStopWord) continue;
    const term = token.stemmed;
    if (!indexMap.has(term)) indexMap.set(term, new Set());
    indexMap.get(term)!.add(token.docId);
  }
  const entries: PostingEntry[] = [];
  indexMap.forEach((docIds, term) => {
    entries.push({ term, docIds: Array.from(docIds).sort((a, b) => a - b) });
  });
  entries.sort((a, b) => a.term.localeCompare(b.term));
  return entries;
}

// ============================================================================
// Animation step generator
// ============================================================================

function* pipelineGenerator(
  documents: Document[],
  queryTerms?: string[],
  queryType?: "AND" | "OR"
): Generator<AnimationStep> {
  // Phase 1: Show documents
  yield {
    phase: "documents",
    message: "Starting document pipeline. Processing documents one at a time.",
    indexEntries: [],
    processedTokens: [],
    currentDocTokens: [],
  };

  for (const doc of documents) {
    yield {
      phase: "documents",
      message: `Examining Document ${doc.id}: "${doc.title}"`,
      activeDocId: doc.id,
      indexEntries: [],
      processedTokens: [],
      currentDocTokens: [],
    };
  }

  // Phase 2: Tokenization
  const allTokens: Token[] = [];

  for (const doc of documents) {
    const docTokens = processDocument(doc);

    yield {
      phase: "tokenization",
      message: `Tokenizing Document ${doc.id}: "${doc.title}"`,
      activeDocId: doc.id,
      indexEntries: [],
      processedTokens: [...allTokens],
      currentDocTokens: [],
    };

    for (let i = 0; i < docTokens.length; i++) {
      const token = docTokens[i];

      // Show original token
      yield {
        phase: "tokenization",
        message: `Token: "${token.original}"`,
        activeDocId: doc.id,
        activeTokenIndex: i,
        activeToken: token,
        processingStage: "original",
        indexEntries: [],
        processedTokens: [...allTokens],
        currentDocTokens: docTokens.slice(0, i + 1),
      };

      // Show lowercase
      yield {
        phase: "tokenization",
        message: `Lowercase: "${token.original}" -> "${token.lowercase}"`,
        activeDocId: doc.id,
        activeTokenIndex: i,
        activeToken: token,
        processingStage: "lowercase",
        indexEntries: [],
        processedTokens: [...allTokens],
        currentDocTokens: docTokens.slice(0, i + 1),
      };

      // Show stop word check
      if (token.isStopWord) {
        yield {
          phase: "tokenization",
          message: `Stop word removed: "${token.lowercase}"`,
          activeDocId: doc.id,
          activeTokenIndex: i,
          activeToken: token,
          processingStage: "stop-removal",
          indexEntries: [],
          processedTokens: [...allTokens],
          currentDocTokens: docTokens.slice(0, i + 1),
        };
      } else {
        // Show stemming
        yield {
          phase: "tokenization",
          message: `Stemmed: "${token.lowercase}" -> "${token.stemmed}"`,
          activeDocId: doc.id,
          activeTokenIndex: i,
          activeToken: token,
          processingStage: "stem",
          indexEntries: [],
          processedTokens: [...allTokens],
          currentDocTokens: docTokens.slice(0, i + 1),
        };
      }
    }

    allTokens.push(...docTokens);
  }

  // Phase 3: Build inverted index
  yield {
    phase: "indexing",
    message: "Building inverted index from processed tokens...",
    indexEntries: [],
    processedTokens: allTokens,
    currentDocTokens: [],
  };

  const indexMap = new Map<string, Set<number>>();
  const builtEntries: PostingEntry[] = [];
  const nonStopTokens = allTokens.filter((t) => !t.isStopWord);

  for (const token of nonStopTokens) {
    const term = token.stemmed;
    if (!indexMap.has(term)) {
      indexMap.set(term, new Set());
    }
    const wasNew = !indexMap.get(term)!.has(token.docId);
    indexMap.get(term)!.add(token.docId);

    if (wasNew) {
      // Rebuild entries for display
      builtEntries.length = 0;
      indexMap.forEach((docIds, t) => {
        builtEntries.push({ term: t, docIds: Array.from(docIds).sort((a, b) => a - b) });
      });
      builtEntries.sort((a, b) => a.term.localeCompare(b.term));

      yield {
        phase: "indexing",
        message: `Adding "${term}" -> Doc ${token.docId}`,
        highlightTerm: term,
        highlightDocs: [token.docId],
        indexEntries: builtEntries.map((e) => ({ ...e, docIds: [...e.docIds] })),
        processedTokens: allTokens,
        currentDocTokens: [],
      };
    }
  }

  // Final index
  const finalEntries = buildIndex(allTokens);
  yield {
    phase: "indexing",
    message: `Index complete: ${finalEntries.length} unique terms across ${documents.length} documents`,
    indexEntries: finalEntries,
    processedTokens: allTokens,
    currentDocTokens: [],
  };

  // Phase 4: Query (if provided)
  if (queryTerms && queryTerms.length > 0) {
    const type = queryType || "AND";

    yield {
      phase: "query",
      message: `Running ${type} query: ${queryTerms.map((t) => `"${t}"`).join(` ${type} `)}`,
      indexEntries: finalEntries,
      processedTokens: allTokens,
      currentDocTokens: [],
      queryTerms,
      queryType: type,
    };

    // Look up each term
    const termResults: Map<string, number[]> = new Map();

    for (const qTerm of queryTerms) {
      const stemmed = simpleStem(qTerm.toLowerCase());
      const entry = finalEntries.find((e) => e.term === stemmed);
      const docs = entry ? entry.docIds : [];
      termResults.set(qTerm, docs);

      yield {
        phase: "query",
        message: `Looking up "${qTerm}" (stemmed: "${stemmed}"): found in docs [${docs.join(", ") || "none"}]`,
        highlightTerm: stemmed,
        highlightDocs: docs,
        indexEntries: finalEntries,
        processedTokens: allTokens,
        currentDocTokens: [],
        queryTerms,
        queryType: type,
      };
    }

    // Compute final result
    let resultDocs: number[];
    const allDocSets = Array.from(termResults.values());

    if (type === "AND") {
      if (allDocSets.length === 0) {
        resultDocs = [];
      } else {
        resultDocs = allDocSets[0].filter((d) =>
          allDocSets.every((set) => set.includes(d))
        );
      }
    } else {
      const unionSet = new Set<number>();
      allDocSets.forEach((set) => set.forEach((d) => unionSet.add(d)));
      resultDocs = Array.from(unionSet).sort((a, b) => a - b);
    }

    yield {
      phase: "query",
      message: `${type} query result: documents [${resultDocs.join(", ") || "none"}]`,
      indexEntries: finalEntries,
      processedTokens: allTokens,
      currentDocTokens: [],
      queryTerms,
      queryType: type,
      queryResults: resultDocs,
      highlightDocs: resultDocs,
    };
  }
}

// ============================================================================
// Sub-components
// ============================================================================

function DocumentCard({
  doc,
  isActive,
  isHighlighted,
}: {
  doc: Document;
  isActive: boolean;
  isHighlighted: boolean;
}) {
  return (
    <motion.div
      layout
      className="rounded-xl p-3 transition-all duration-200"
      style={{
        background: isActive ? `${doc.color}12` : isHighlighted ? `${doc.color}18` : "#0a0a0f",
        border: `1.5px solid ${isActive ? doc.color : isHighlighted ? `${doc.color}60` : "#1e1e2e"}`,
        boxShadow: isActive ? `0 0 16px ${doc.color}20` : isHighlighted ? `0 0 12px ${doc.color}15` : "none",
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: doc.color }}
        />
        <span className="text-xs font-mono font-semibold" style={{ color: doc.color }}>
          Doc {doc.id}
        </span>
        <span className="text-xs text-[#a1a1aa] font-medium">{doc.title}</span>
      </div>
      <p className="text-[11px] text-[#71717a] leading-relaxed">{doc.content}</p>
    </motion.div>
  );
}

function TokenChip({
  token,
  isActive,
  stage,
}: {
  token: Token;
  isActive: boolean;
  stage?: "original" | "lowercase" | "stop-removal" | "stem";
}) {
  let bg = "#1e1e2e";
  let text = "#a1a1aa";
  let border = "#2a2a3e";
  let decoration = "";

  if (token.isStopWord) {
    bg = isActive ? "#ef444420" : "#1a1a20";
    text = isActive ? "#ef4444" : "#3f3f5e";
    border = isActive ? "#ef444440" : "#1a1a24";
    if (stage === "stop-removal" && isActive) {
      decoration = "line-through";
    }
  } else if (isActive) {
    if (stage === "original") {
      bg = "#f59e0b18"; text = "#f59e0b"; border = "#f59e0b40";
    } else if (stage === "lowercase") {
      bg = "#06b6d418"; text = "#06b6d4"; border = "#06b6d440";
    } else if (stage === "stem") {
      bg = "#10b98118"; text = "#10b981"; border = "#10b98140";
    }
  }

  const display =
    stage === "original" ? token.original :
    stage === "lowercase" ? token.lowercase :
    stage === "stem" ? token.stemmed :
    token.isStopWord ? token.lowercase : token.stemmed;

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-all duration-150"
      style={{
        background: bg,
        color: text,
        border: `1px solid ${border}`,
        textDecoration: decoration,
        opacity: token.isStopWord && !isActive ? 0.4 : 1,
      }}
    >
      {display}
    </span>
  );
}

function PostingRow({
  entry,
  isHighlighted,
  documents,
}: {
  entry: PostingEntry;
  isHighlighted: boolean;
  documents: Document[];
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-3 px-3 py-1.5 rounded-lg transition-all duration-150"
      style={{
        background: isHighlighted ? "rgba(16,185,129,0.08)" : "transparent",
        border: isHighlighted ? "1px solid rgba(16,185,129,0.2)" : "1px solid transparent",
      }}
    >
      <span
        className="text-xs font-mono font-semibold min-w-[80px]"
        style={{ color: isHighlighted ? "#10b981" : "#a1a1aa" }}
      >
        {entry.term}
      </span>
      <ArrowRight size={10} className="text-[#3f3f5e] flex-shrink-0" />
      <div className="flex items-center gap-1 flex-wrap">
        {entry.docIds.map((docId) => {
          const doc = documents.find((d) => d.id === docId);
          return (
            <span
              key={docId}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold"
              style={{
                background: `${doc?.color || "#6366f1"}20`,
                color: doc?.color || "#6366f1",
                border: `1px solid ${doc?.color || "#6366f1"}30`,
              }}
            >
              D{docId}
            </span>
          );
        })}
      </div>
    </motion.div>
  );
}

function ProcessingPipeline({
  token,
  stage,
}: {
  token: Token | undefined;
  stage?: string;
}) {
  if (!token) return null;

  const stages = [
    { label: "Original", value: token.original, color: "#f59e0b", active: stage === "original" },
    { label: "Lowercase", value: token.lowercase, color: "#06b6d4", active: stage === "lowercase" },
    {
      label: "Stop Check",
      value: token.isStopWord ? "REMOVED" : token.lowercase,
      color: token.isStopWord ? "#ef4444" : "#10b981",
      active: stage === "stop-removal",
    },
    {
      label: "Stem",
      value: token.isStopWord ? "-" : token.stemmed,
      color: "#a855f7",
      active: stage === "stem",
    },
  ];

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {stages.map((s, i) => (
        <div key={s.label} className="flex items-center gap-1">
          <div
            className="flex flex-col items-center px-2.5 py-1.5 rounded-lg transition-all duration-200"
            style={{
              background: s.active ? `${s.color}15` : "#0a0a0f",
              border: `1px solid ${s.active ? `${s.color}40` : "#1e1e2e"}`,
              boxShadow: s.active ? `0 0 8px ${s.color}20` : "none",
            }}
          >
            <span className="text-[9px] uppercase tracking-wider font-medium" style={{ color: s.active ? s.color : "#3f3f5e" }}>
              {s.label}
            </span>
            <span
              className="text-xs font-mono font-semibold"
              style={{
                color: s.active ? s.color : "#71717a",
                textDecoration: s.label === "Stop Check" && token.isStopWord && s.active ? "line-through" : "none",
              }}
            >
              {s.value}
            </span>
          </div>
          {i < stages.length - 1 && (
            <ArrowRight
              size={10}
              className="flex-shrink-0"
              style={{ color: s.active ? s.color : "#2a2a3e" }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function PhaseIndicator({ currentPhase }: { currentPhase: Phase }) {
  const phases: { id: Phase; label: string; icon: React.ReactNode; color: string }[] = [
    { id: "documents", label: "Documents", icon: <FileText size={12} />, color: "#6366f1" },
    { id: "tokenization", label: "Tokenize", icon: <Scissors size={12} />, color: "#06b6d4" },
    { id: "indexing", label: "Index Build", icon: <Database size={12} />, color: "#10b981" },
    { id: "query", label: "Query", icon: <Search size={12} />, color: "#f59e0b" },
  ];

  const currentIdx = phases.findIndex((p) => p.id === currentPhase);

  return (
    <div className="flex items-center gap-1">
      {phases.map((p, i) => (
        <div key={p.id} className="flex items-center gap-1">
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-200"
            style={{
              background: i === currentIdx ? `${p.color}15` : i < currentIdx ? `${p.color}08` : "#0a0a0f",
              border: `1px solid ${i === currentIdx ? `${p.color}40` : i < currentIdx ? `${p.color}20` : "#1e1e2e"}`,
              color: i === currentIdx ? p.color : i < currentIdx ? `${p.color}80` : "#3f3f5e",
            }}
          >
            {i < currentIdx ? <Check size={10} /> : p.icon}
            {p.label}
          </div>
          {i < phases.length - 1 && (
            <ArrowRight size={10} style={{ color: i < currentIdx ? phases[i + 1].color : "#2a2a3e" }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function InvertedIndexPage() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [documents, setDocuments] = useState<Document[]>(SIMPLE_DOCS);
  const [currentPhase, setCurrentPhase] = useState<Phase>("documents");
  const [statusMessage, setStatusMessage] = useState("Select a preset to begin the indexing pipeline.");
  const [activeDocId, setActiveDocId] = useState<number | undefined>();
  const [activeToken, setActiveToken] = useState<Token | undefined>();
  const [processingStage, setProcessingStage] = useState<string | undefined>();
  const [indexEntries, setIndexEntries] = useState<PostingEntry[]>([]);
  const [highlightTerm, setHighlightTerm] = useState<string | undefined>();
  const [highlightDocs, setHighlightDocs] = useState<number[] | undefined>();
  const [processedTokens, setProcessedTokens] = useState<Token[]>([]);
  const [currentDocTokens, setCurrentDocTokens] = useState<Token[]>([]);
  const [queryTerms, setQueryTerms] = useState<string[] | undefined>();
  const [queryResults, setQueryResults] = useState<number[] | undefined>();
  const [queryType, setQueryType] = useState<"AND" | "OR" | undefined>();
  const [queryInput, setQueryInput] = useState("");
  const [queryModeInput, setQueryModeInput] = useState<"AND" | "OR">("AND");

  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showMetrics, setShowMetrics] = useState(true);
  const [activeScenario, setActiveScenario] = useState<ScenarioId | "">("");

  // Metrics
  const docsProcessed = new Set(processedTokens.map((t) => t.docId)).size;
  const uniqueTerms = indexEntries.length;
  const indexSize = indexEntries.reduce((sum, e) => sum + e.docIds.length, 0);
  const queryMatches = queryResults?.length ?? 0;

  // ── Refs ────────────────────────────────────────────────────────────────────
  const isPlayingRef = useRef(false);
  const speedRef = useRef(speed);
  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const generatorRef = useRef<ReturnType<typeof pipelineGenerator> | null>(null);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // ── Step logic ─────────────────────────────────────────────────────────────
  const applyStep = useCallback((step: AnimationStep) => {
    setCurrentPhase(step.phase);
    setStatusMessage(step.message);
    setActiveDocId(step.activeDocId);
    setActiveToken(step.activeToken);
    setProcessingStage(step.processingStage);
    setIndexEntries(step.indexEntries);
    setHighlightTerm(step.highlightTerm);
    setHighlightDocs(step.highlightDocs);
    setProcessedTokens(step.processedTokens);
    setCurrentDocTokens(step.currentDocTokens);
    setQueryTerms(step.queryTerms);
    setQueryResults(step.queryResults);
    setQueryType(step.queryType);
  }, []);

  const stepForward = useCallback(() => {
    if (!generatorRef.current) return false;
    const result = generatorRef.current.next();
    if (result.done) {
      generatorRef.current = null;
      setIsPlaying(false);
      return false;
    }
    applyStep(result.value);
    return true;
  }, [applyStep]);

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
    if (!generatorRef.current) return;
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
    generatorRef.current = null;
    setCurrentPhase("documents");
    setStatusMessage("Select a preset to begin the indexing pipeline.");
    setActiveDocId(undefined);
    setActiveToken(undefined);
    setProcessingStage(undefined);
    setIndexEntries([]);
    setHighlightTerm(undefined);
    setHighlightDocs(undefined);
    setProcessedTokens([]);
    setCurrentDocTokens([]);
    setQueryTerms(undefined);
    setQueryResults(undefined);
    setQueryType(undefined);
    setActiveScenario("");
  }, [handlePause]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // ── Scenario handling ──────────────────────────────────────────────────────
  const handleScenario = useCallback(
    (id: ScenarioId) => {
      handleReset();
      setActiveScenario(id);

      let docs: Document[];
      let qTerms: string[] | undefined;
      let qType: "AND" | "OR" | undefined;

      switch (id) {
        case "simple":
          docs = SIMPLE_DOCS;
          break;
        case "technical":
          docs = TECHNICAL_DOCS;
          break;
        case "single-query":
          docs = TECHNICAL_DOCS;
          qTerms = SINGLE_QUERY_TERMS;
          qType = "AND";
          break;
        case "boolean-query":
          docs = TECHNICAL_DOCS;
          qTerms = BOOLEAN_QUERY_OR;
          qType = "OR";
          break;
        default:
          docs = SIMPLE_DOCS;
      }

      setDocuments(docs);

      // Create generator after small delay to allow state update
      setTimeout(() => {
        generatorRef.current = pipelineGenerator(docs, qTerms, qType);
      }, 50);
    },
    [handleReset]
  );

  // ── Manual query ───────────────────────────────────────────────────────────
  const handleManualQuery = useCallback(() => {
    if (!queryInput.trim()) return;
    handlePause();

    const terms = queryInput.trim().split(/\s+/);
    // Build fresh index from current docs
    const allTokens: Token[] = [];
    for (const doc of documents) {
      allTokens.push(...processDocument(doc));
    }
    const fullIndex = buildIndex(allTokens);

    // Look up terms
    const termResults: Map<string, number[]> = new Map();
    for (const term of terms) {
      const stemmed = simpleStem(term.toLowerCase());
      const entry = fullIndex.find((e) => e.term === stemmed);
      termResults.set(term, entry ? entry.docIds : []);
    }

    let resultDocs: number[];
    const allDocSets = Array.from(termResults.values());

    if (queryModeInput === "AND") {
      resultDocs = allDocSets.length > 0
        ? allDocSets[0].filter((d) => allDocSets.every((set) => set.includes(d)))
        : [];
    } else {
      const unionSet = new Set<number>();
      allDocSets.forEach((set) => set.forEach((d) => unionSet.add(d)));
      resultDocs = Array.from(unionSet).sort((a, b) => a - b);
    }

    setCurrentPhase("query");
    setIndexEntries(fullIndex);
    setProcessedTokens(allTokens);
    setQueryTerms(terms);
    setQueryType(queryModeInput);
    setQueryResults(resultDocs);
    setHighlightDocs(resultDocs);
    setStatusMessage(
      `${queryModeInput} query [${terms.join(", ")}]: ${resultDocs.length > 0 ? `docs [${resultDocs.join(", ")}]` : "no matches"}`
    );
  }, [queryInput, queryModeInput, documents, handlePause]);

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
                  background: "rgba(245,158,11,0.1)",
                  color: "#f59e0b",
                  border: "1px solid rgba(245,158,11,0.2)",
                }}
              >
                5.8
              </span>
              <span className="text-xs text-[#71717a]">Search Algorithms & Systems</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Inverted Index
            </h1>
            <p className="text-sm text-[#a1a1aa] max-w-2xl mt-2">
              Watch how search engines build an inverted index from raw documents. Follow the
              full pipeline from tokenization through index construction to query evaluation
              with boolean operators.
            </p>
          </motion.div>

          {/* ── Scenario Presets ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex flex-wrap items-center gap-2 mb-4"
          >
            <div className="flex items-center gap-1.5 text-xs text-[#71717a] mr-1">
              <BookOpen size={14} />
              <span>Presets</span>
            </div>
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => handleScenario(s.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                style={{
                  background: activeScenario === s.id ? "rgba(245,158,11,0.12)" : "#1e1e2e",
                  color: activeScenario === s.id ? "#f59e0b" : "#a1a1aa",
                  border: activeScenario === s.id ? "1px solid rgba(245,158,11,0.3)" : "1px solid transparent",
                }}
                title={s.description}
              >
                {s.label}
              </button>
            ))}
          </motion.div>

          {/* ── Phase indicator ──────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="mb-4"
          >
            <PhaseIndicator currentPhase={currentPhase} />
          </motion.div>

          {/* ── Status bar ──────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl mb-4"
            style={{ background: "#111118", border: "1px solid #1e1e2e" }}
          >
            <Info size={14} className="text-[#6366f1] flex-shrink-0" />
            <span className="text-xs text-[#a1a1aa]">{statusMessage}</span>
          </motion.div>

          {/* ── Main visualization grid ─────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4"
          >
            {/* Left column: Documents + Tokenization */}
            <div className="space-y-4">
              {/* Documents panel */}
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: "#111118", border: "1px solid #1e1e2e" }}
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <FileText size={14} className="text-[#6366f1]" />
                  <span className="text-sm font-semibold text-white">Documents</span>
                  <span className="text-xs font-mono text-[#71717a] ml-auto">
                    {documents.length} docs
                  </span>
                </div>
                <div className="p-3 space-y-2 max-h-[280px] overflow-y-auto">
                  {documents.map((doc) => (
                    <DocumentCard
                      key={doc.id}
                      doc={doc}
                      isActive={activeDocId === doc.id}
                      isHighlighted={highlightDocs?.includes(doc.id) || queryResults?.includes(doc.id) || false}
                    />
                  ))}
                </div>
              </div>

              {/* Tokenization panel */}
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: "#111118", border: "1px solid #1e1e2e" }}
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <Scissors size={14} className="text-[#06b6d4]" />
                  <span className="text-sm font-semibold text-white">Tokenization</span>
                </div>

                {/* Processing pipeline */}
                {activeToken && (
                  <div className="px-4 py-3 border-b border-[#1e1e2e]">
                    <ProcessingPipeline token={activeToken} stage={processingStage} />
                  </div>
                )}

                {/* Current doc tokens */}
                <div className="p-3 min-h-[80px] max-h-[200px] overflow-y-auto">
                  {currentDocTokens.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {currentDocTokens.map((token, i) => (
                        <TokenChip
                          key={`${token.docId}-${i}`}
                          token={token}
                          isActive={i === (currentDocTokens.length - 1) && !!activeToken}
                          stage={i === (currentDocTokens.length - 1) ? processingStage as any : undefined}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-16 text-xs text-[#3f3f5e]">
                      Tokens will appear here during tokenization
                    </div>
                  )}
                </div>

                {/* Token legend */}
                <div className="flex items-center gap-4 px-4 py-2 border-t border-[#1e1e2e]">
                  {[
                    { color: "#06b6d4", label: "Token" },
                    { color: "#ef4444", label: "Stop Word" },
                    { color: "#10b981", label: "Stemmed" },
                  ].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-sm" style={{ background: color, opacity: 0.6 }} />
                      <span className="text-[10px] text-[#71717a]">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right column: Index + Query */}
            <div className="space-y-4">
              {/* Inverted Index panel */}
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: "#111118", border: "1px solid #1e1e2e" }}
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <Database size={14} className="text-[#10b981]" />
                  <span className="text-sm font-semibold text-white">Inverted Index</span>
                  <span className="text-xs font-mono text-[#71717a] ml-auto">
                    {indexEntries.length} terms
                  </span>
                </div>

                {/* Table header */}
                <div className="flex items-center gap-3 px-3 py-1.5 border-b border-[#1e1e2e] text-[10px] uppercase tracking-wider text-[#3f3f5e] font-medium">
                  <span className="min-w-[80px]">Term</span>
                  <span className="ml-4">Posting List (Document IDs)</span>
                </div>

                <div className="p-2 space-y-0.5 max-h-[350px] overflow-y-auto">
                  {indexEntries.length > 0 ? (
                    indexEntries.map((entry) => (
                      <PostingRow
                        key={entry.term}
                        entry={entry}
                        isHighlighted={highlightTerm === entry.term}
                        documents={documents}
                      />
                    ))
                  ) : (
                    <div className="flex items-center justify-center h-24 text-xs text-[#3f3f5e]">
                      Index will build here during the indexing phase
                    </div>
                  )}
                </div>
              </div>

              {/* Query panel */}
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: "#111118", border: "1px solid #1e1e2e" }}
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1e1e2e]">
                  <Search size={14} className="text-[#f59e0b]" />
                  <span className="text-sm font-semibold text-white">Query</span>
                </div>

                {/* Query input */}
                <div className="p-3 border-b border-[#1e1e2e]">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={queryInput}
                      onChange={(e) => setQueryInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleManualQuery(); }}
                      placeholder="Enter search terms..."
                      className="flex-1 px-3 py-2 rounded-lg text-sm font-mono bg-[#0a0a0f] border border-[#1e1e2e] text-white placeholder-[#3f3f5e] focus:outline-none focus:border-[#f59e0b] transition-colors"
                    />
                    <div className="flex items-center rounded-lg overflow-hidden border border-[#1e1e2e]">
                      {(["AND", "OR"] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setQueryModeInput(mode)}
                          className="px-2.5 py-2 text-[11px] font-semibold transition-all duration-150"
                          style={{
                            background: queryModeInput === mode ? "#f59e0b18" : "#0a0a0f",
                            color: queryModeInput === mode ? "#f59e0b" : "#3f3f5e",
                          }}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={handleManualQuery}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200"
                      style={{
                        background: "rgba(245,158,11,0.15)",
                        color: "#f59e0b",
                        border: "1px solid rgba(245,158,11,0.3)",
                      }}
                    >
                      <Search size={12} />
                      Search
                    </button>
                  </div>
                </div>

                {/* Query results */}
                <div className="p-3 min-h-[80px]">
                  {queryTerms ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">Query:</span>
                        {queryTerms.map((term, i) => (
                          <div key={i} className="flex items-center gap-1">
                            {i > 0 && (
                              <span
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                                style={{
                                  background: "#f59e0b15",
                                  color: "#f59e0b",
                                }}
                              >
                                {queryType}
                              </span>
                            )}
                            <span
                              className="px-2 py-0.5 rounded text-xs font-mono font-semibold"
                              style={{ background: "#6366f118", color: "#6366f1", border: "1px solid #6366f130" }}
                            >
                              {term}
                            </span>
                          </div>
                        ))}
                      </div>

                      {queryResults && (
                        <div className="space-y-2">
                          <span className="text-[10px] uppercase tracking-wider text-[#71717a] font-medium">
                            Results ({queryResults.length} matches):
                          </span>
                          {queryResults.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {queryResults.map((docId) => {
                                const doc = documents.find((d) => d.id === docId);
                                return (
                                  <motion.div
                                    key={docId}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                                    style={{
                                      background: `${doc?.color || "#6366f1"}15`,
                                      border: `1px solid ${doc?.color || "#6366f1"}30`,
                                    }}
                                  >
                                    <div
                                      className="w-2 h-2 rounded-full"
                                      style={{ background: doc?.color || "#6366f1" }}
                                    />
                                    <span className="text-xs font-medium" style={{ color: doc?.color || "#6366f1" }}>
                                      Doc {docId}: {doc?.title}
                                    </span>
                                  </motion.div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "#ef444410", border: "1px solid #ef444420" }}>
                              <X size={12} className="text-[#ef4444]" />
                              <span className="text-xs text-[#ef4444]">No matching documents found</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-16 text-xs text-[#3f3f5e]">
                      Query results will appear here. Build the index first.
                    </div>
                  )}
                </div>
              </div>
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
                  { label: "Docs Processed", value: docsProcessed, color: "#6366f1", icon: <FileText size={14} /> },
                  { label: "Unique Terms", value: uniqueTerms, color: "#10b981", icon: <Tag size={14} /> },
                  { label: "Index Size", value: indexSize, color: "#06b6d4", icon: <Database size={14} /> },
                  { label: "Query Matches", value: queryMatches, color: "#f59e0b", icon: <Search size={14} /> },
                  { label: "Phase", value: currentPhase, color: "#a855f7", icon: <Layers size={14} /> },
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
                <Info size={14} className="text-[#f59e0b]" />
                <span className="text-sm font-semibold text-white">How Inverted Indices Work</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-5">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-[#6366f1]" />
                  <h3 className="text-xs font-semibold text-[#6366f1] uppercase tracking-wider">1. Documents</h3>
                </div>
                <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                  Raw text documents are the input. Each document has a unique ID and
                  contains natural language text that needs to be searchable.
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Scissors size={14} className="text-[#06b6d4]" />
                  <h3 className="text-xs font-semibold text-[#06b6d4] uppercase tracking-wider">2. Tokenization</h3>
                </div>
                <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                  Text is split into tokens, lowercased, and stop words (common words
                  like &ldquo;the&rdquo;, &ldquo;is&rdquo;) are removed. Remaining words are stemmed to their
                  root form.
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Database size={14} className="text-[#10b981]" />
                  <h3 className="text-xs font-semibold text-[#10b981] uppercase tracking-wider">3. Index Build</h3>
                </div>
                <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                  The inverted index maps each unique term to a posting list: the set of
                  document IDs containing that term. This reverses the document-to-word
                  relationship.
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Search size={14} className="text-[#f59e0b]" />
                  <h3 className="text-xs font-semibold text-[#f59e0b] uppercase tracking-wider">4. Query</h3>
                </div>
                <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                  Queries look up terms in the index. AND queries intersect posting
                  lists (documents with all terms), OR queries union them (documents with
                  any term).
                </p>
              </div>
            </div>

            {/* Boolean operations */}
            <div className="border-t border-[#1e1e2e] p-5">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider mb-3">Boolean Query Operations</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div
                  className="rounded-xl p-3"
                  style={{ background: "#0a0a0f", border: "1px solid #1e1e2e" }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: "#10b98115", color: "#10b981" }}>
                      AND
                    </span>
                    <span className="text-xs text-[#a1a1aa]">Intersection</span>
                  </div>
                  <div className="text-[11px] font-mono text-[#71717a] space-y-1">
                    <div>&ldquo;cat&rdquo; AND &ldquo;warm&rdquo;</div>
                    <div className="text-[#3f3f5e]">cat: [D1, D3, D4]</div>
                    <div className="text-[#3f3f5e]">warm: [D1, D3]</div>
                    <div className="text-[#10b981]">Result: [D1, D3]</div>
                  </div>
                </div>
                <div
                  className="rounded-xl p-3"
                  style={{ background: "#0a0a0f", border: "1px solid #1e1e2e" }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: "#f59e0b15", color: "#f59e0b" }}>
                      OR
                    </span>
                    <span className="text-xs text-[#a1a1aa]">Union</span>
                  </div>
                  <div className="text-[11px] font-mono text-[#71717a] space-y-1">
                    <div>&ldquo;cat&rdquo; OR &ldquo;dog&rdquo;</div>
                    <div className="text-[#3f3f5e]">cat: [D1, D3, D4]</div>
                    <div className="text-[#3f3f5e]">dog: [D2, D4]</div>
                    <div className="text-[#f59e0b]">Result: [D1, D2, D3, D4]</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Real-world use */}
            <div className="border-t border-[#1e1e2e] px-5 py-4">
              <div className="rounded-xl p-4" style={{ background: "#0a0a0f", border: "1px solid #1e1e2e" }}>
                <h3 className="text-xs font-semibold text-[#06b6d4] uppercase tracking-wider mb-2">
                  Real-World Applications
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-[#a1a1aa]">
                  <div className="flex items-start gap-2">
                    <Search size={12} className="text-[#6366f1] mt-0.5 flex-shrink-0" />
                    <span>
                      <span className="text-white font-medium">Search Engines:</span> Google, Bing use massive
                      inverted indices across billions of web pages.
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Database size={12} className="text-[#10b981] mt-0.5 flex-shrink-0" />
                    <span>
                      <span className="text-white font-medium">Elasticsearch:</span> Powers full-text search
                      in applications using Lucene-based inverted indices.
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <FileText size={12} className="text-[#f59e0b] mt-0.5 flex-shrink-0" />
                    <span>
                      <span className="text-white font-medium">Code Search:</span> GitHub code search uses
                      inverted indices to search across millions of repositories.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
