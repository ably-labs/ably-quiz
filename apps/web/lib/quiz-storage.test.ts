import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteRecord,
  draftFromQuiz,
  duplicateQuiz,
  launchQuiz,
  listRecords,
  loadDraft,
  loadQuiz,
  MAX_RECORDS,
  newDraftId,
  recordLabel,
  saveDraft,
  saveQuiz,
  type StoredDraft,
  type StoredQuiz,
} from './quiz-storage';

// The suite runs in vitest's `node` environment (see vitest.config.ts), so the
// module's `window.localStorage` needs a shim.
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as unknown as { window: { localStorage: Storage } }).window = {
    localStorage: storage,
  };
});

const question = (prompt: string, limitMs = 20_000) => ({
  prompt,
  options: ['right', 'wrong a', 'wrong b'],
  correctIndex: 0,
  limitMs,
  category: 'Science',
  author: 'Priya',
});

function quiz(quizId: string, over: Partial<StoredQuiz> = {}): StoredQuiz {
  return {
    quizId,
    createdAt: 1_000,
    questions: [question('What is the chemical symbol for gold?')],
    config: {
      scoringAlgoId: 'speed',
      questionCount: 1,
      defaultLimitMs: 20_000,
      streakEnabled: false,
      autoReveal: true,
    },
    ...over,
  };
}

function draft(draftId: string, over: Partial<StoredDraft> = {}): StoredDraft {
  return {
    draftId,
    createdAt: 500,
    updatedAt: 500,
    cells: [['Capital of France?', 'Paris', 'Lyon', '', '', '', '', '']],
    settings: {
      defaultLimitS: 20,
      scoringAlgoId: 'speed',
      streakEnabled: false,
      autoReveal: true,
      excludedAgents: [],
    },
    ...over,
  };
}

describe('played quizzes (§B2.3)', () => {
  it('round-trips a quiz, and loads pre-S7.6 records that have no name', () => {
    saveQuiz(quiz('brave-otter-482'));
    const loaded = loadQuiz('brave-otter-482');
    expect(loaded?.questions).toHaveLength(1);
    expect(loaded?.name).toBeUndefined();
    expect(loadQuiz('missing')).toBeNull();
  });

  it('ignores malformed JSON rather than throwing', () => {
    storage.setItem('ably-quiz:broken', '{not json');
    expect(loadQuiz('broken')).toBeNull();
    storage.setItem('ably-quiz:records', 'nope');
    expect(listRecords()).toEqual([]);
  });
});

describe('drafts (§S7.6)', () => {
  it('saves a draft, indexes it, and resumes it', () => {
    saveDraft(draft('d1', { name: 'Friday pub quiz' }));
    const [record] = listRecords();
    expect(record).toMatchObject({ id: 'd1', status: 'draft', questionCount: 1 });
    expect(recordLabel(record!)).toBe('Friday pub quiz');

    const resumed = loadDraft('d1');
    expect(resumed?.cells[0]?.[1]).toBe('Paris');
    expect(resumed?.settings.defaultLimitS).toBe(20);
  });

  it('re-saving the same draft updates its row instead of adding one', () => {
    saveDraft(draft('d1'));
    saveDraft(draft('d1', { updatedAt: 900, cells: [['Q1', 'a', 'b', '', '', '', '', '']] }));
    const records = listRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.updatedAt).toBe(900);
  });

  it('labels an unnamed draft with the first question, and pads short rows', () => {
    saveDraft(draft('d1', { cells: [['Who painted the Mona Lisa?', 'Da Vinci']] }));
    const [record] = listRecords();
    expect(recordLabel(record!)).toBe('Who painted the Mona Lisa?');
    expect(loadDraft('d1')?.cells[0]).toHaveLength(8);
  });

  it('fills missing settings with defaults (back-compat)', () => {
    storage.setItem(
      'ably-quiz:draft:old',
      JSON.stringify({ draftId: 'old', cells: [['Q', 'a']], settings: { streakEnabled: true } }),
    );
    const resumed = loadDraft('old');
    expect(resumed?.settings.streakEnabled).toBe(true);
    expect(resumed?.settings.autoReveal).toBe(true);
    expect(resumed?.settings.excludedAgents).toEqual([]);
  });

  it('counts only rows with content', () => {
    saveDraft(
      draft('d1', {
        cells: [
          ['Q1', 'a', 'b', '', '', '', '', ''],
          ['', '', '', '', '', '', '', ''],
          ['Q2', 'a', 'b', '', '', '', '', ''],
        ],
      }),
    );
    expect(listRecords()[0]?.questionCount).toBe(2);
  });

  it('mints distinct draft ids', () => {
    expect(newDraftId()).not.toBe(newDraftId());
  });
});

describe('launching a draft (draft → played)', () => {
  it('replaces the draft row with a played one and drops the draft payload', () => {
    saveDraft(draft('d1', { createdAt: 100, updatedAt: 200, name: 'Round two' }));
    launchQuiz(quiz('brave-otter-482', { createdAt: 5_000, name: 'Round two' }), 'd1');

    const records = listRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'brave-otter-482',
      status: 'played',
      createdAt: 100, // preserved from the draft…
      updatedAt: 5_000, // …and stamped with the launch
      questionCount: 1,
      name: 'Round two',
    });
    expect(loadDraft('d1')).toBeNull();
    expect(loadQuiz('brave-otter-482')?.name).toBe('Round two');
  });

  it('works without a draft (a quiz launched straight from a fresh page)', () => {
    launchQuiz(quiz('swift-comet-100'));
    expect(listRecords()[0]).toMatchObject({ id: 'swift-comet-100', status: 'played' });
  });
});

describe('duplicate (the only way to reuse a played quiz)', () => {
  it('copies questions and config into a new editable draft', () => {
    launchQuiz(quiz('brave-otter-482', { name: 'Round two' }));
    const draftId = duplicateQuiz('brave-otter-482');
    expect(draftId).toBeTruthy();

    const copy = loadDraft(draftId!);
    expect(copy?.name).toBe('Round two (copy)');
    expect(copy?.cells[0]).toEqual([
      'What is the chemical symbol for gold?',
      'right',
      'wrong a',
      'wrong b',
      '',
      '', // limit matches the quiz default → stays blank, follows the default
      'Science',
      'Priya',
    ]);
    expect(copy?.settings.scoringAlgoId).toBe('speed');

    // The original is untouched and both now appear in the list.
    expect(loadQuiz('brave-otter-482')).not.toBeNull();
    expect(
      listRecords()
        .map((r) => r.status)
        .sort(),
    ).toEqual(['draft', 'played']);
  });

  it('keeps a per-question time override as an explicit cell', () => {
    const copy = draftFromQuiz(
      quiz('q', { questions: [question('Slow one', 45_000)] }),
      'd-copy',
      1_234,
    );
    expect(copy.cells[0]?.[5]).toBe('45');
    expect(copy.createdAt).toBe(1_234);
  });

  it('returns null when the definition isn’t in this browser', () => {
    expect(duplicateQuiz('never-stored')).toBeNull();
  });
});

describe('delete + pruning', () => {
  it('delete removes the row and the payload', () => {
    launchQuiz(quiz('brave-otter-482'));
    deleteRecord('brave-otter-482');
    expect(listRecords()).toEqual([]);
    expect(loadQuiz('brave-otter-482')).toBeNull();

    saveDraft(draft('d1'));
    deleteRecord('d1');
    expect(listRecords()).toEqual([]);
    expect(loadDraft('d1')).toBeNull();
  });

  it('caps the list, evicting the oldest draft first', () => {
    saveDraft(draft('old-draft', { createdAt: 1, updatedAt: 1 }));
    for (let i = 0; i < MAX_RECORDS; i++) {
      launchQuiz(quiz(`played-${i}`, { createdAt: 10_000 + i }));
    }
    expect(listRecords()).toHaveLength(MAX_RECORDS);
    // The oldest DRAFT went, not the oldest played quiz.
    expect(listRecords().some((r) => r.id === 'old-draft')).toBe(false);
    expect(listRecords().some((r) => r.id === 'played-0')).toBe(true);
    expect(loadDraft('old-draft')).toBeNull();
  });

  it('falls back to the oldest played quiz when there are no drafts left', () => {
    for (let i = 0; i <= MAX_RECORDS; i++) {
      launchQuiz(quiz(`played-${i}`, { createdAt: 10_000 + i }));
    }
    const records = listRecords();
    expect(records).toHaveLength(MAX_RECORDS);
    expect(records.some((r) => r.id === 'played-0')).toBe(false);
    expect(loadQuiz('played-0')).toBeNull(); // payload pruned with the row
    expect(records[0]?.id).toBe(`played-${MAX_RECORDS}`);
  });

  it('never evicts the record currently being written', () => {
    for (let i = 0; i < MAX_RECORDS; i++) {
      launchQuiz(quiz(`played-${i}`, { createdAt: 10_000 + i }));
    }
    saveDraft(draft('fresh', { createdAt: 1, updatedAt: 1, name: 'Keep me' }));
    // Its updatedAt is the oldest, but it's the one being saved: it survives,
    // and the oldest played quiz goes instead.
    expect(listRecords().some((r) => r.id === 'fresh')).toBe(true);
    expect(listRecords().some((r) => r.id === 'played-0')).toBe(false);
  });
});

describe('back-compat: quizzes stored before My Quizzes existed', () => {
  it('seeds the index from bare quiz keys on first read', () => {
    saveQuiz(quiz('legacy-one', { createdAt: 2_000 }));
    saveQuiz(quiz('legacy-two', { createdAt: 3_000 }));
    const records = listRecords();
    expect(records.map((r) => r.id)).toEqual(['legacy-two', 'legacy-one']);
    expect(records.every((r) => r.status === 'played')).toBe(true);
    expect(recordLabel(records[0]!)).toBe('What is the chemical symbol for gold?');
  });

  it('seeds once — a later delete is not undone by the migration', () => {
    saveQuiz(quiz('legacy-one'));
    expect(listRecords()).toHaveLength(1);
    deleteRecord('legacy-one');
    expect(listRecords()).toEqual([]);
  });

  it('skips draft and index keys while scanning', () => {
    saveDraft(draft('d1'));
    storage.removeItem('ably-quiz:records'); // force a re-seed
    const records = listRecords();
    expect(records).toEqual([]);
  });
});
