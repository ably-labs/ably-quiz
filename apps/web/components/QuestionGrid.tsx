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
  /** Who submitted the question (§S7.2) — credited on screen; they sit it out. */
  author: string | null;
};

export function emptyRow(): GridRow {
  return {
    question: '',
    correct: '',
    wrong1: '',
    wrong2: '',
    wrong3: '',
    limit: '',
    category: '',
    author: '',
  };
}

/** The 8 columns in the fixed order the core parser expects (null → ''). */
export function rowCells(r: GridRow): string[] {
  return [r.question, r.correct, r.wrong1, r.wrong2, r.wrong3, r.limit, r.category, r.author].map(
    (c) => c ?? '',
  );
}

/** Inverse of `rowCells` — restores a row from stored draft cells (§S7.6). */
export function rowFromCells(cells: string[]): GridRow {
  const cell = (i: number) => cells[i] ?? '';
  return {
    question: cell(0),
    correct: cell(1),
    wrong1: cell(2),
    wrong2: cell(3),
    wrong3: cell(4),
    limit: cell(5),
    category: cell(6),
    author: cell(7),
  };
}

export function isRowEmpty(r: GridRow): boolean {
  return rowCells(r).every((c) => c.trim() === '');
}

/** Column set; `disabled` builds the read-only variant a played quiz shows (§S7.6). */
function buildColumns(disabled: boolean) {
  return [
    { ...keyColumn<GridRow, 'question'>('question', textColumn), title: 'Question', grow: 3 },
    { ...keyColumn<GridRow, 'correct'>('correct', textColumn), title: 'Correct answer', grow: 1.4 },
    { ...keyColumn<GridRow, 'wrong1'>('wrong1', textColumn), title: 'Wrong 1' },
    { ...keyColumn<GridRow, 'wrong2'>('wrong2', textColumn), title: 'Wrong 2' },
    { ...keyColumn<GridRow, 'wrong3'>('wrong3', textColumn), title: 'Wrong 3' },
    { ...keyColumn<GridRow, 'limit'>('limit', textColumn), title: 'Time (s)', grow: 0.5 },
    { ...keyColumn<GridRow, 'category'>('category', textColumn), title: 'Category' },
    { ...keyColumn<GridRow, 'author'>('author', textColumn), title: 'Author' },
  ].map((c) => ({ ...c, disabled }));
}

const columns = buildColumns(false);
const readOnlyColumns = buildColumns(true);

export function QuestionGrid({
  rows,
  onChange,
  badRows,
  readOnly = false,
}: {
  rows: GridRow[];
  onChange: (rows: GridRow[]) => void;
  badRows: Set<number>;
  /** Played quizzes are immutable — show the questions, refuse the edits. */
  readOnly?: boolean;
}) {
  return (
    <div className="dsg-dark">
      <DataSheetGrid<GridRow>
        value={rows}
        onChange={onChange}
        columns={readOnly ? readOnlyColumns : columns}
        createRow={emptyRow}
        rowClassName={({ rowIndex }) => (badRows.has(rowIndex) ? 'dsg-bad-row' : undefined)}
        lockRows={readOnly}
        disableContextMenu={readOnly}
        {...(readOnly ? { addRowsComponent: false as const } : {})}
      />
    </div>
  );
}
