'use client';

// Questions editor built on react-datasheet-grid — an Excel-like grid with
// native copy/paste from a spreadsheet, keyboard nav, and add/remove rows. Dark
// theme is applied via the --dsg-* CSS variables (see globals.css).

import { DataSheetGrid, keyColumn, textColumn } from 'react-datasheet-grid';

// textColumn represents an empty cell as null, so fields are nullable.
export type GridRow = {
  question: string | null;
  correct: string | null;
  wrong1: string | null;
  wrong2: string | null;
  wrong3: string | null;
  limit: string | null;
  category: string | null;
};

export function emptyRow(): GridRow {
  return { question: '', correct: '', wrong1: '', wrong2: '', wrong3: '', limit: '', category: '' };
}

/** The 7 columns in the fixed order the core parser expects (null → ''). */
export function rowCells(r: GridRow): string[] {
  return [r.question, r.correct, r.wrong1, r.wrong2, r.wrong3, r.limit, r.category].map(
    (c) => c ?? '',
  );
}

export function isRowEmpty(r: GridRow): boolean {
  return rowCells(r).every((c) => c.trim() === '');
}

const columns = [
  { ...keyColumn<GridRow, 'question'>('question', textColumn), title: 'Question', grow: 3 },
  { ...keyColumn<GridRow, 'correct'>('correct', textColumn), title: 'Correct answer', grow: 1.4 },
  { ...keyColumn<GridRow, 'wrong1'>('wrong1', textColumn), title: 'Wrong 1' },
  { ...keyColumn<GridRow, 'wrong2'>('wrong2', textColumn), title: 'Wrong 2' },
  { ...keyColumn<GridRow, 'wrong3'>('wrong3', textColumn), title: 'Wrong 3' },
  { ...keyColumn<GridRow, 'limit'>('limit', textColumn), title: 'Time (s)', grow: 0.5 },
  { ...keyColumn<GridRow, 'category'>('category', textColumn), title: 'Category' },
];

export function QuestionGrid({
  rows,
  onChange,
  badRows,
}: {
  rows: GridRow[];
  onChange: (rows: GridRow[]) => void;
  badRows: Set<number>;
}) {
  return (
    <div className="dsg-dark">
      <DataSheetGrid<GridRow>
        value={rows}
        onChange={onChange}
        columns={columns}
        createRow={emptyRow}
        rowClassName={({ rowIndex }) => (badRows.has(rowIndex) ? 'dsg-bad-row' : undefined)}
      />
    </div>
  );
}
