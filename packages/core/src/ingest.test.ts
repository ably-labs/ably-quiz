import { describe, expect, it } from 'vitest';
import { LIMIT_DEFAULT_S, parseQuestions } from './ingest';

describe('parseQuestions', () => {
  it('parses TSV (Google Sheets paste) with correct as option index 0', () => {
    const tsv = 'What is 2+2?\t4\t3\t5\t22\t15\tmath';
    const { questions, errors } = parseQuestions(tsv);
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toEqual({
      prompt: 'What is 2+2?',
      options: ['4', '3', '5', '22'],
      correctIndex: 0,
      limitMs: 15_000,
      category: 'math',
    });
  });

  it('parses CSV and handles quoted fields containing commas', () => {
    const csv = '"Which city, historically, was capital?","Rome","Milan","Turin"';
    const { questions, errors } = parseQuestions(csv);
    expect(errors).toEqual([]);
    expect(questions[0]?.prompt).toBe('Which city, historically, was capital?');
    expect(questions[0]?.options).toEqual(['Rome', 'Milan', 'Turin']);
  });

  it('skips a header row', () => {
    const tsv = 'question\tcorrect\twrong1\nCapital of France?\tParis\tLyon';
    const { questions } = parseQuestions(tsv);
    expect(questions).toHaveLength(1);
    expect(questions[0]?.prompt).toBe('Capital of France?');
  });

  it('defaults and clamps the time limit', () => {
    const rows = [
      'No limit given\tA\tB', // → default 20s
      'Too low\tA\tB\t\t\t2', // → clamps to 10s
      'Too high\tA\tB\t\t\t999', // → clamps to 60s
    ].join('\n');
    const { questions } = parseQuestions(rows);
    expect(questions.map((q) => q.limitMs)).toEqual([LIMIT_DEFAULT_S * 1000, 10_000, 60_000]);
  });

  it('collects row-numbered errors and skips bad rows', () => {
    const rows = [
      'Good one\tYes\tNo',
      'Only one option\tSolo', // < 2 options
      '\tNoQuestion\tB', // missing prompt
      'Dup opts\tSame\tSame', // not distinct
    ].join('\n');
    const { questions, errors } = parseQuestions(rows);
    expect(questions).toHaveLength(1);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/Row 2/);
    expect(errors[1]).toMatch(/Row 3/);
    expect(errors[2]).toMatch(/Row 4/);
  });

  it('reports empty input', () => {
    expect(parseQuestions('   ').errors).toEqual(['Nothing pasted yet.']);
  });
});
