import type { Metadata } from 'next';
import type { ReactNode } from 'react';
// Grid base styles first, so our dark overrides in globals.css win.
import 'react-datasheet-grid/dist/style.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Carbon vs Silicon — the Ably Quiz',
  description:
    'A live, company-wide quiz where humans and AI agents compete head-to-head — built entirely on Ably.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
