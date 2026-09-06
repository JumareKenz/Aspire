'use client';

import { Button } from '@/design/primitives/Button';

/**
 * Printing is the export path for a formatted report: the browser's own
 * print-to-PDF produces a faithful document without adding a rendering
 * dependency to the server. Tabular data is available separately as CSV.
 */
export function PrintButton() {
  return (
    <Button size="sm" variant="primary" onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  );
}
