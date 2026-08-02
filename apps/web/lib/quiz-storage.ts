// Host-machine quiz storage (§B2.3, extended by §S7.6 "My Quizzes").
//
// The full quiz definition — including the correct answers — lives ONLY in the
// host's browser and is broadcast one question at a time.
//
// Deviation from the brief's "sessionStorage": we use localStorage so the
// create tab, the /host controls tab, and the /screen projector tab (all on the
// same host machine) share it, and it survives a refresh for recovery.
//
// Three key families, all under the `ably-quiz:` prefix:
//   ably-quiz:<quizId>         StoredQuiz  — the definition of a PLAYED quiz.
//                              Unchanged since S2: /host?quiz=<id> reads it.
//   ably-quiz:draft:<draftId>  StoredDraft — a quiz that has never been
//                              launched, kept as raw grid cells so half-typed
//                              rows survive a crash or a stray back button.
//   ably-quiz:records          QuizRecord[] — the index behind "My Quizzes":
//                              one summary per draft/played quiz, newest first,
//                              capped at MAX_RECORDS.
//
// A record is a DRAFT until it is launched, and PLAYED (immutable) after: the
// questions have been broadcast and scored, so editing one afterwards would
// make the stored definition disagree with the results. Duplicate instead.

import {
  DEFAULT_ALGO_ID,
  LIMIT_DEFAULT_S,
  type QuestionDef,
  type QuizConfig,
} from '@ably-quiz/core';

export type StoredQuiz = {
  quizId: string;
  createdAt: number;
  questions: QuestionDef[];
  config: QuizConfig;
  /** Optional host-given name (§S7.6). Absent on quizzes stored before S7.6. */
  name?: string;
};

/** Create-page settings that aren't part of a QuestionDef, kept with a draft so
 *  resuming restores the whole page rather than just the questions. */
export type DraftSettings = {
  defaultLimitS: number;
  scoringAlgoId: string;
  streakEnabled: boolean;
  autoReveal: boolean;
  /** Agent slugs the host unchecked (empty = everyone available plays). */
  excludedAgents: string[];
};

export type StoredDraft = {
  draftId: string;
  createdAt: number;
  updatedAt: number;
  name?: string;
  /** Raw grid cells exactly as typed — CELL_COUNT per row, in the column order
   *  of QuestionGrid's `rowCells`. A draft may hold invalid/half-typed rows. */
  cells: string[][];
  settings: DraftSettings;
};

export type QuizRecordStatus = 'draft' | 'played';

/** One row of "My Quizzes". Summary only — the payload lives under its own key. */
export type QuizRecord = {
  /** Draft id for a draft, quiz id for a played quiz. */
  id: string;
  status: QuizRecordStatus;
  createdAt: number;
  /** Last edit for a draft; the launch time for a played quiz. */
  updatedAt: number;
  questionCount: number;
  name?: string;
  /** First question prompt — the fallback list label when there's no name. */
  firstPrompt?: string;
};

const PREFIX = 'ably-quiz:';
const RECORDS_KEY = `${PREFIX}records`;
const DRAFT_PREFIX = `${PREFIX}draft:`;

/** Keep localStorage bounded: the newest MAX_RECORDS quizzes, drafts pruned first. */
export const MAX_RECORDS = 20;

/** Columns per grid row (question, correct, wrong ×3, time, category, author). */
export const CELL_COUNT = 8;

export const DEFAULT_DRAFT_SETTINGS: DraftSettings = {
  defaultLimitS: LIMIT_DEFAULT_S,
  scoringAlgoId: DEFAULT_ALGO_ID,
  streakEnabled: false,
  autoReveal: true,
  excludedAgents: [],
};

const keyFor = (quizId: string) => `${PREFIX}${quizId}`;
const draftKeyFor = (draftId: string) => `${DRAFT_PREFIX}${draftId}`;

/** localStorage, or null when unavailable (SSR, or blocked by the browser). */
function store(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  const s = store();
  if (!s) return null;
  const raw = s.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Writes are best-effort: a full quota must never break the create page. */
function writeJson(key: string, value: unknown): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — the in-memory quiz still works */
  }
}

// --- Played quizzes ---------------------------------------------------------

export function saveQuiz(quiz: StoredQuiz): void {
  writeJson(keyFor(quiz.quizId), quiz);
}

export function loadQuiz(quizId: string): StoredQuiz | null {
  const quiz = readJson(keyFor(quizId));
  return isStoredQuiz(quiz) ? quiz : null;
}

function isStoredQuiz(value: unknown): value is StoredQuiz {
  if (typeof value !== 'object' || value === null) return false;
  const q = value as Partial<StoredQuiz>;
  return typeof q.quizId === 'string' && Array.isArray(q.questions) && typeof q.config === 'object';
}

// --- Drafts -----------------------------------------------------------------

/** A short, URL-safe id for an unlaunched quiz (distinct from a quiz id). */
export function newDraftId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function saveDraft(draft: StoredDraft): void {
  const cells = normalizeCells(draft.cells);
  writeJson(draftKeyFor(draft.draftId), { ...draft, cells });
  const firstPrompt = firstPromptOf(cells);
  upsertRecord({
    id: draft.draftId,
    status: 'draft',
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    questionCount: countFilledRows(cells),
    ...(draft.name ? { name: draft.name } : {}),
    ...(firstPrompt ? { firstPrompt } : {}),
  });
}

export function loadDraft(draftId: string): StoredDraft | null {
  const raw = readJson(draftKeyFor(draftId));
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Partial<StoredDraft>;
  if (typeof d.draftId !== 'string' || !Array.isArray(d.cells)) return null;
  const now = Date.now();
  return {
    draftId: d.draftId,
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : now,
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : now,
    ...(typeof d.name === 'string' && d.name ? { name: d.name } : {}),
    cells: normalizeCells(d.cells),
    settings: { ...DEFAULT_DRAFT_SETTINGS, ...sanitizeSettings(d.settings) },
  };
}

function sanitizeSettings(value: unknown): Partial<DraftSettings> {
  if (typeof value !== 'object' || value === null) return {};
  const s = value as Partial<DraftSettings>;
  return {
    ...(typeof s.defaultLimitS === 'number' ? { defaultLimitS: s.defaultLimitS } : {}),
    ...(typeof s.scoringAlgoId === 'string' ? { scoringAlgoId: s.scoringAlgoId } : {}),
    ...(typeof s.streakEnabled === 'boolean' ? { streakEnabled: s.streakEnabled } : {}),
    ...(typeof s.autoReveal === 'boolean' ? { autoReveal: s.autoReveal } : {}),
    ...(Array.isArray(s.excludedAgents)
      ? { excludedAgents: s.excludedAgents.filter((x): x is string => typeof x === 'string') }
      : {}),
  };
}

/** Every row exactly CELL_COUNT strings, so a stored grid always fits the editor. */
function normalizeCells(cells: unknown): string[][] {
  if (!Array.isArray(cells)) return [];
  return cells
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) =>
      Array.from({ length: CELL_COUNT }, (_, i) => (typeof row[i] === 'string' ? row[i] : '')),
    );
}

function countFilledRows(cells: string[][]): number {
  return cells.filter((row) => row.some((c) => c.trim() !== '')).length;
}

function firstPromptOf(cells: string[][]): string | undefined {
  const row = cells.find((r) => r.some((c) => c.trim() !== ''));
  const prompt = row?.[0]?.trim();
  return prompt ? prompt : undefined;
}

// --- Draft → played ---------------------------------------------------------

/** Launch: persist the definition for /host and flip the record to PLAYED.
 *  The questions are stored once (under the quiz key) — the record is a pointer,
 *  and the draft's raw cells are dropped. */
export function launchQuiz(quiz: StoredQuiz, fromDraftId?: string): void {
  saveQuiz(quiz);
  const s = store();
  if (!s) return;
  const records = listRecords();
  const prior = fromDraftId ? records.find((r) => r.id === fromDraftId) : undefined;
  if (fromDraftId) s.removeItem(draftKeyFor(fromDraftId));
  const firstPrompt = quiz.questions[0]?.prompt;
  const rest = records.filter((r) => r.id !== fromDraftId && r.id !== quiz.quizId);
  const played: QuizRecord = {
    id: quiz.quizId,
    status: 'played',
    createdAt: prior?.createdAt ?? quiz.createdAt,
    updatedAt: quiz.createdAt,
    questionCount: quiz.questions.length,
    ...(quiz.name ? { name: quiz.name } : {}),
    ...(firstPrompt ? { firstPrompt } : {}),
  };
  writeRecords(prune([played, ...rest], quiz.quizId));
}

/** Copy a played quiz into a fresh draft — the only way to "edit" it (§S7.6).
 *  Returns the new draft id, or null if the definition isn't in this browser. */
export function duplicateQuiz(quizId: string): string | null {
  const quiz = loadQuiz(quizId);
  if (!quiz) return null;
  const draft = draftFromQuiz(quiz, newDraftId());
  saveDraft(draft);
  return draft.draftId;
}

/** A quiz definition turned back into editable grid cells. Rows whose limit
 *  matches the quiz default keep a blank Time cell, so they follow the default. */
export function draftFromQuiz(quiz: StoredQuiz, draftId: string, now = Date.now()): StoredDraft {
  const cells = quiz.questions.map((q) => cellsFromQuestion(q, quiz.config.defaultLimitMs));
  return {
    draftId,
    createdAt: now,
    updatedAt: now,
    ...(quiz.name ? { name: `${quiz.name} (copy)` } : {}),
    cells,
    settings: {
      defaultLimitS: Math.round(quiz.config.defaultLimitMs / 1000),
      scoringAlgoId: quiz.config.scoringAlgoId,
      streakEnabled: quiz.config.streakEnabled,
      autoReveal: quiz.config.autoReveal ?? true,
      // The roster is re-fetched live on /create, and the stored config lists
      // only the agents that played — so a copy starts with everyone back in.
      excludedAgents: [],
    },
  };
}

/** Column order must match QuestionGrid's `rowCells`. */
function cellsFromQuestion(q: QuestionDef, defaultLimitMs: number): string[] {
  const wrong = q.options.filter((_, i) => i !== q.correctIndex);
  return [
    q.prompt,
    q.options[q.correctIndex] ?? '',
    wrong[0] ?? '',
    wrong[1] ?? '',
    wrong[2] ?? '',
    q.limitMs === defaultLimitMs ? '' : String(Math.round(q.limitMs / 1000)),
    q.category ?? '',
    q.author ?? '',
  ];
}

// --- The record index -------------------------------------------------------

/** Every quiz this browser knows about, newest first. Seeds itself from any
 *  pre-S7.6 quizzes on first use, so quizzes made before "My Quizzes" existed
 *  still show up. */
export function listRecords(): QuizRecord[] {
  const s = store();
  if (!s) return [];
  if (s.getItem(RECORDS_KEY) === null) {
    const seeded = prune(seedFromLegacyQuizzes(s), undefined);
    writeRecords(seeded);
    return seeded;
  }
  return sanitizeRecords(readJson(RECORDS_KEY));
}

/** Forget a quiz on this machine: the index row plus its payload. */
export function deleteRecord(id: string): void {
  const s = store();
  if (!s) return;
  s.removeItem(draftKeyFor(id));
  s.removeItem(keyFor(id));
  writeRecords(listRecords().filter((r) => r.id !== id));
}

/** The list label: the host's name, else the opening words of question 1. */
export function recordLabel(record: QuizRecord): string {
  const name = record.name?.trim();
  if (name) return name;
  const prompt = record.firstPrompt?.trim();
  if (!prompt) return 'Untitled quiz';
  return prompt.length > 58 ? `${prompt.slice(0, 58).trimEnd()}…` : prompt;
}

function upsertRecord(record: QuizRecord): void {
  const rest = listRecords().filter((r) => r.id !== record.id);
  writeRecords(prune([record, ...rest], record.id));
}

function writeRecords(records: QuizRecord[]): void {
  writeJson(RECORDS_KEY, records);
}

function sanitizeRecords(value: unknown): QuizRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isQuizRecord)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_RECORDS);
}

function isQuizRecord(value: unknown): value is QuizRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<QuizRecord>;
  return (
    typeof r.id === 'string' &&
    (r.status === 'draft' || r.status === 'played') &&
    typeof r.createdAt === 'number' &&
    typeof r.updatedAt === 'number' &&
    typeof r.questionCount === 'number'
  );
}

/** Drop the oldest records past the cap, drafts first, taking their payloads
 *  with them. `keepId` is the record being written — never evict that one. */
function prune(records: QuizRecord[], keepId: string | undefined): QuizRecord[] {
  const kept = [...records].sort((a, b) => b.updatedAt - a.updatedAt);
  while (kept.length > MAX_RECORDS) {
    const victim = oldestEvictable(kept, keepId);
    if (victim < 0) break;
    const [dropped] = kept.splice(victim, 1);
    if (dropped) {
      const s = store();
      s?.removeItem(draftKeyFor(dropped.id));
      s?.removeItem(keyFor(dropped.id));
    }
  }
  return kept;
}

/** Index of the oldest draft, or the oldest record when there are no drafts. */
function oldestEvictable(records: QuizRecord[], keepId: string | undefined): number {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]!;
    if (r.status === 'draft' && r.id !== keepId) return i;
  }
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i]!.id !== keepId) return i;
  }
  return -1;
}

/** One-off migration: quizzes stored before S7.6 have no index row. Scan the
 *  `ably-quiz:<quizId>` keys and record them as played. */
function seedFromLegacyQuizzes(s: Storage): QuizRecord[] {
  const records: QuizRecord[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    if (key === RECORDS_KEY || key.startsWith(DRAFT_PREFIX)) continue;
    const quiz = loadQuiz(key.slice(PREFIX.length));
    if (!quiz) continue;
    const firstPrompt = quiz.questions[0]?.prompt;
    records.push({
      id: quiz.quizId,
      status: 'played',
      createdAt: quiz.createdAt,
      updatedAt: quiz.createdAt,
      questionCount: quiz.questions.length,
      ...(quiz.name ? { name: quiz.name } : {}),
      ...(firstPrompt ? { firstPrompt } : {}),
    });
  }
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}
