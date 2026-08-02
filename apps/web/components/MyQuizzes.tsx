'use client';

// "My Quizzes" (§S7.6) — the front door's memory. Hosts kept losing quizzes:
// you couldn't edit one after clicking create, couldn't re-run a finished one,
// and testing meant rebuilding the same quiz over and over.
//
// Deliberately NOT a quiz-management system: it's the localStorage records on
// this machine, newest first, with the three actions that matter — resume a
// draft, duplicate a played quiz, forget one.

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  deleteRecord,
  duplicateQuiz,
  listRecords,
  recordLabel,
  type QuizRecord,
} from '@/lib/quiz-storage';

export function MyQuizzes() {
  const router = useRouter();
  // null until read: localStorage is client-only, so the list can't render on
  // the server without a hydration mismatch.
  const [records, setRecords] = useState<QuizRecord[] | null>(null);
  useEffect(() => setRecords(listRecords()), []);

  if (!records || records.length === 0) return null;

  const remove = (record: QuizRecord) => {
    const ok = window.confirm(
      record.status === 'played'
        ? `Delete “${recordLabel(record)}”?\n\nIts questions and correct answers are only stored in this browser — deleting means the host controls and results for it can no longer be opened.`
        : `Delete the draft “${recordLabel(record)}”?`,
    );
    if (!ok) return;
    deleteRecord(record.id);
    setRecords(listRecords());
  };

  const duplicate = (record: QuizRecord) => {
    const draftId = duplicateQuiz(record.id);
    if (draftId) router.push(`/create?draft=${draftId}`);
  };

  return (
    <section className="mt-12 w-full max-w-xl text-left">
      <h2 className="mb-2 text-xs font-semibold tracking-[0.2em] text-neutral-500 uppercase">
        Your quizzes
      </h2>
      <ul className="divide-y divide-neutral-900 rounded-xl border border-neutral-800 bg-neutral-950/60">
        {records.map((record) => (
          <li key={record.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{recordLabel(record)}</p>
              <p className="mt-0.5 text-xs text-neutral-500">
                <StatusChip status={record.status} />
                <span className="ml-2">
                  {record.questionCount} question{record.questionCount === 1 ? '' : 's'} ·{' '}
                  {record.status === 'played' ? 'played' : 'edited'} {formatWhen(record.updatedAt)}
                </span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs">
              {record.status === 'draft' ? (
                <Action onClick={() => router.push(`/create?draft=${record.id}`)} primary>
                  Resume
                </Action>
              ) : (
                <>
                  <Action onClick={() => router.push(`/host?quiz=${record.id}`)} primary>
                    Open host
                  </Action>
                  <Action onClick={() => duplicate(record)}>Duplicate</Action>
                </>
              )}
              <Action onClick={() => remove(record)} muted>
                Delete
              </Action>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-neutral-600">
        Stored in this browser only — a played quiz can’t be edited, only duplicated.
      </p>
    </section>
  );
}

function StatusChip({ status }: { status: QuizRecord['status'] }) {
  const played = status === 'played';
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wide uppercase ${
        played ? 'bg-neutral-800 text-neutral-300' : 'bg-ably/15 text-ably'
      }`}
    >
      {played ? 'played' : 'draft'}
    </span>
  );
}

function Action({
  onClick,
  primary,
  muted,
  children,
}: {
  onClick: () => void;
  primary?: boolean;
  muted?: boolean;
  children: React.ReactNode;
}) {
  const tone = primary
    ? 'text-ably hover:underline'
    : muted
      ? 'text-neutral-600 hover:text-red-400'
      : 'text-neutral-400 hover:text-ink';
  return (
    <button type="button" onClick={onClick} className={`font-medium transition ${tone}`}>
      {children}
    </button>
  );
}

/** Short, local, and only ever rendered client-side (no hydration mismatch). */
function formatWhen(ts: number): string {
  const date = new Date(ts);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? `today ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
