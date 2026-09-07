'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { Answer } from '@/intelligence/types';
import { Button } from '@/design/primitives/Button';
import { Card, CardBody, CardHeader } from '@/design/primitives/Card';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { EvidenceList } from '@/design/primitives/Meta';
import { Badge } from '@/design/primitives/Badge';
import { LoadingBlock, ErrorState } from '@/design/primitives/States';

interface Entry {
  id: string;
  question: string;
  answer: Answer | null;
  error: string | null;
  pending: boolean;
}

/**
 * The Intelligence conversation.
 *
 * Each answer shows three things together: the sentence, the table it was
 * computed from, and how the question was interpreted. The interpretation is
 * visible because the most common failure in a natural-language interface is
 * answering a different question well.
 */
export function AskPanel({
  orgUnitId,
  periodId,
  suggestions,
  showEvidence = true,
}: {
  orgUnitId: string;
  periodId: string;
  suggestions: string[];
  /**
   * Whether to offer the row-level evidence table and verification trail.
   * Executives get the answer and its basis; the underlying rows are an
   * investigative tool that belongs with the workspace tier.
   */
  showEvidence?: boolean;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [question, setQuestion] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setEntries((current) => [
      { id, question: trimmed, answer: null, error: null, pending: true },
      ...current,
    ]);
    setQuestion('');

    try {
      const response = await fetch('/api/intelligence/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, orgUnitId, periodId }),
      });
      const payload = (await response.json()) as { data: Answer } | { error: { message: string } };
      setEntries((current) =>
        current.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                pending: false,
                answer: 'data' in payload ? payload.data : null,
                error: 'error' in payload ? payload.error.message : null,
              }
            : entry,
        ),
      );
    } catch {
      setEntries((current) =>
        current.map((entry) =>
          entry.id === id
            ? { ...entry, pending: false, error: 'We could not reach the server. Try again in a moment.' }
            : entry,
        ),
      );
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
          className="flex gap-2"
        >
          <label htmlFor="ask-input" className="sr-only">
            Ask a question about SRHR performance
          </label>
          <input
            id="ask-input"
            ref={inputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about performance, change, risk or data quality…"
            className="h-10 flex-1 rounded-[var(--radius-md)] border bg-[var(--surface)] px-3 text-[14px] transition-colors hover:border-[var(--border-strong)]"
          />
          <Button type="submit" variant="primary" disabled={question.trim().length === 0}>
            Ask
          </Button>
        </form>

        {entries.length === 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-medium text-[var(--text-tertiary)]">Try one of these</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void ask(suggestion)}
                  className="rounded-full border px-2.5 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--brand-400)] hover:bg-[var(--brand-050)] hover:text-[var(--brand-700)]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <p className="mt-4 border-t pt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              Every figure in an answer is computed by the platform from stored reporting, and every answer
              shows the evidence it was derived from.
            </p>
          </div>
        ) : null}
      </Card>

      {entries.map((entry) => (
        <Card key={entry.id} className="animate-enter">
          <CardHeader
            title={entry.question}
            description={entry.answer?.interpretation}
            action={
              entry.answer ? (
                <div className="flex items-center gap-1.5">
                  <Badge
                    tone="neutral"
                    title={
                      entry.answer.writtenBy === 'MODEL'
                        ? 'Figures computed by the platform; wording produced by a language model from those figures.'
                        : 'Figures computed and worded by the platform, with no language model involved.'
                    }
                  >
                    {entry.answer.writtenBy === 'MODEL' ? 'Model-worded' : 'Platform-worded'}
                  </Badge>
                </div>
              ) : null
            }
          />
          <CardBody>
            {entry.pending ? <LoadingBlock rows={3} /> : null}
            {entry.error ? <ErrorState description={entry.error} /> : null}

            {entry.answer ? (
              <div className="space-y-4">
                {entry.answer.result ? (
                  <p className="text-[14px] leading-relaxed font-medium text-[var(--text-primary)]">
                    {entry.answer.result.headline}
                  </p>
                ) : null}

                {entry.answer.sections.map((section, index) => (
                  <div key={`${section.heading ?? 'body'}-${index}`}>
                    {section.heading ? (
                      <h3 className="mb-1 text-[12px] font-semibold text-[var(--text-primary)]">
                        {section.heading}
                      </h3>
                    ) : null}
                    <p className="text-[13px] leading-relaxed whitespace-pre-line text-[var(--text-secondary)]">
                      {section.body}
                    </p>
                  </div>
                ))}

                {showEvidence && entry.answer.result && entry.answer.result.rows.length > 0 ? (
                  <details className="rounded-[var(--radius-md)] border bg-[var(--surface-sunken)] px-3 py-2">
                    <summary className="cursor-pointer text-[12px] font-medium text-[var(--text-secondary)]">
                      Evidence — {entry.answer.result.rows.length} rows
                    </summary>
                    <div className="mt-2">
                      <TableWrap>
                        <thead>
                          <tr>
                            {entry.answer.result.columns.map((column) => (
                              <Th key={column.key} align={column.numeric ? 'right' : 'left'}>
                                {column.label}
                              </Th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {entry.answer.result.rows.map((row, rowIndex) => (
                            <Tr key={`${row.refId ?? rowIndex}`}>
                              {entry.answer!.result!.columns.map((column) => {
                                const value = row.cells[column.key];
                                const isLink = column.key === 'area' && row.refKind === 'ORG_UNIT' && row.refId;
                                return (
                                  <Td
                                    key={column.key}
                                    align={column.numeric ? 'right' : 'left'}
                                    numeric={column.numeric}
                                  >
                                    {isLink ? (
                                      <Link
                                        href={`/performance?orgUnit=${row.refId}&period=${entry.answer!.result!.query.periodId}`}
                                        className="text-[var(--brand-600)] hover:underline"
                                      >
                                        {String(value ?? '—')}
                                      </Link>
                                    ) : (
                                      String(value ?? '—')
                                    )}
                                  </Td>
                                );
                              })}
                            </Tr>
                          ))}
                        </tbody>
                      </TableWrap>
                    </div>
                  </details>
                ) : null}

                {showEvidence && entry.answer.result && entry.answer.result.findings.length > 0 ? (
                  <details className="rounded-[var(--radius-md)] border bg-[var(--surface-sunken)] px-3 py-2">
                    <summary className="cursor-pointer text-[12px] font-medium text-[var(--text-secondary)]">
                      How each statement was verified
                    </summary>
                    <ul className="mt-2 space-y-3">
                      {entry.answer.result.findings.map((finding) => (
                        <li key={finding.statement}>
                          <p className="text-[12px] text-[var(--text-primary)]">{finding.statement}</p>
                          <EvidenceList items={finding.evidence} className="mt-1 sm:grid-cols-3" />
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {entry.answer.result?.href ? (
                  <Link
                    href={entry.answer.result.href}
                    className="inline-block text-[12px] text-[var(--brand-600)] hover:underline"
                  >
                    Open this in the workspace →
                  </Link>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
