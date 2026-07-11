// Question ingestion (§B2.8). Paste from the Google Sheets template → parse.
// Auto-detects TSV (Sheets) or CSV, tolerates quoted fields, and validates.
// Columns: question, correct, wrong1, wrong2, wrong3?, time_limit_s?, category?
//
// Pure and tested; the create screen (S3.1) renders the preview + errors.

import { questionDefSchema, type QuestionDef } from './protocol';

export const LIMIT_MIN_S = 10;
export const LIMIT_MAX_S = 60;
export const LIMIT_DEFAULT_S = 20;

export type ParsedQuestions = {
  questions: QuestionDef[];
  /** Human-readable, row-numbered problems (skipped rows). */
  errors: string[];
};

/** Split delimited text into rows of fields, honouring "quoted" fields (RFC4180-ish). */
function tokenize(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // swallow; '\n' handles the row break
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function clampLimitMs(raw: string | undefined): number {
  const n = raw && raw.trim() ? Number.parseInt(raw.trim(), 10) : NaN;
  const seconds = Number.isFinite(n)
    ? Math.min(LIMIT_MAX_S, Math.max(LIMIT_MIN_S, n))
    : LIMIT_DEFAULT_S;
  return seconds * 1000;
}

export function parseQuestions(input: string): ParsedQuestions {
  const questions: QuestionDef[] = [];
  const errors: string[] = [];

  const text = input.replace(/\r\n/g, '\n').trim();
  if (!text) return { questions, errors: ['Nothing pasted yet.'] };

  const delimiter = text.includes('\t') ? '\t' : ',';
  const rows = tokenize(text, delimiter);

  let lineNo = 0;
  for (const raw of rows) {
    lineNo++;
    const cells = raw.map((c) => c.trim());
    if (cells.every((c) => c === '')) continue; // blank line
    // Skip an optional header row.
    if (lineNo === 1 && cells[0]?.toLowerCase() === 'question') continue;

    const prompt = cells[0] ?? '';
    const correct = cells[1] ?? '';
    if (!prompt) {
      errors.push(`Row ${lineNo}: missing question text.`);
      continue;
    }
    if (!correct) {
      errors.push(`Row ${lineNo}: missing the correct answer (column 2).`);
      continue;
    }
    const wrongs = [cells[2], cells[3], cells[4]].filter((c): c is string => !!c && c !== '');
    const options = [correct, ...wrongs];
    if (options.length < 2 || options.length > 4) {
      errors.push(`Row ${lineNo}: needs 2–4 options (correct + 1–3 wrong), got ${options.length}.`);
      continue;
    }
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
      errors.push(`Row ${lineNo}: options must be distinct.`);
      continue;
    }

    const candidate: QuestionDef = {
      prompt,
      options,
      correctIndex: 0, // `correct` is first; options are shuffled at broadcast (§B2.8)
      limitMs: clampLimitMs(cells[5]),
      ...(cells[6] ? { category: cells[6] } : {}),
    };
    const parsed = questionDefSchema.safeParse(candidate);
    if (parsed.success) {
      questions.push(parsed.data);
    } else {
      errors.push(`Row ${lineNo}: ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
    }
  }

  if (questions.length === 0 && errors.length === 0) {
    errors.push('No questions found.');
  }
  return { questions, errors };
}
