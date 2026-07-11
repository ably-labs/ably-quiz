// Host-machine quiz storage (§B2.3). The full quiz definition — including the
// correct answers — lives ONLY in the host's browser and is broadcast one
// question at a time.
//
// Deviation from the brief's "sessionStorage": we use localStorage so the
// create tab, the /host controls tab, and the /screen projector tab (all on the
// same host machine) share it, and it survives a refresh for recovery.

import type { QuestionDef, QuizConfig } from '@ably-quiz/core';

export type StoredQuiz = {
  quizId: string;
  createdAt: number;
  questions: QuestionDef[];
  config: QuizConfig;
};

const keyFor = (quizId: string) => `ably-quiz:${quizId}`;

export function saveQuiz(quiz: StoredQuiz): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(keyFor(quiz.quizId), JSON.stringify(quiz));
}

export function loadQuiz(quizId: string): StoredQuiz | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(keyFor(quizId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredQuiz;
  } catch {
    return null;
  }
}
