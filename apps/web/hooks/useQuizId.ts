'use client';

import { useEffect, useState } from 'react';

/** Read `?quiz=<id>` from the URL client-side (avoids the useSearchParams Suspense boundary). */
export function useQuizId(): string | null | undefined {
  // undefined = still reading; null = missing; string = present
  const [quizId, setQuizId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setQuizId(new URLSearchParams(window.location.search).get('quiz'));
  }, []);
  return quizId;
}
