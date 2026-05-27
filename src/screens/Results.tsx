import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRun } from '../lib/RunContext';
import { expandLine } from '../lib/billing';
import { formatGBP, plural } from '../lib/format';
import type { InvoiceCreationResult } from '../../shared/types';

function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? '');
          if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        })
        .join(','),
    )
    .join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Results(): JSX.Element {
  const navigate = useNavigate();
  const { results, setResults, settings, parse, dryRunOverride } = useRun();
  const [retrying, setRetrying] = useState<string | null>(null);

  const successes = useMemo(() => results.filter((r) => r.ok), [results]);
  const failures = useMemo(() => results.filter((r) => !r.ok), [results]);

  const dryRun = useMemo(() => results.some((r) => r.dryRun), [results]);

  const successTotal = useMemo(
    () => successes.reduce((sum, r) => sum + r.total, 0),
    [successes],
  );

  const exportCsv = (): void => {
    const rows: string[][] = [
      ['School', 'Status', 'Invoice number', 'Amount (GBP)', 'Error'],
      ...results.map((r) => [
        r.schoolName,
        r.ok ? (r.dryRun ? 'DRY RUN OK' : 'Created') : 'Failed',
        r.ok ? r.invoiceNumber : '',
        r.total.toFixed(2),
        r.ok ? '' : r.error,
      ]),
    ];
    const ts = new Date().toISOString().slice(0, 10);
    downloadCsv(`xero-invoicer-${ts}.csv`, rows);
  };

  const handleRetry = async (failure: Extract<InvoiceCreationResult, { ok: false }>): Promise<void> => {
    if (!settings || !parse) return;
    const original = parse.invoices.find((i) => i.schoolNameOriginal === failure.schoolName);
    if (!original) return;
    setRetrying(failure.schoolKey);
    try {
      const prepared = {
        schoolKey: failure.schoolKey,
        schoolName: failure.schoolName,
        contactID: '',
        reference: `Week Ending ${parse.weekEndingDate}`,
        date: new Date().toISOString().slice(0, 10),
        dueDate: '',
        weekEnding: parse.weekEndingDate,
        total: original.totalAmount,
        lines: original.lines.flatMap((l) => expandLine(l)),
      };
      // Resolve the contact ID via mappings.
      const mappings = await window.api.store.getMappings();
      const m = mappings[failure.schoolKey];
      if (!m) {
        setResults(results.map((r) =>
          r.schoolKey === failure.schoolKey && !r.ok
            ? { ...r, error: 'No saved mapping; cannot retry without re-matching.' }
            : r,
        ));
        return;
      }
      prepared.contactID = m.xeroContactId;
      const newResult = await window.api.invoices.retry(prepared, {
        accountCode: settings.accountCode ?? '',
        taxType: settings.taxType,
        brandingThemeId: settings.brandingThemeId,
        lineAmountTypes: settings.lineAmountTypes,
        dryRun: dryRunOverride ?? settings.dryRunDefault,
      });
      setResults(results.map((r) => (r.schoolKey === failure.schoolKey ? newResult : r)));
    } finally {
      setRetrying(null);
    }
  };

  if (results.length === 0) {
    return (
      <div className="text-center text-sm text-slate-500">
        No run yet. <Link to="/upload" className="text-accent-600 underline">Start a new run</Link>.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {dryRun ? 'Dry run results' : 'Run complete'}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {dryRun && <span className="badge-amber mr-2">DRY RUN</span>}
          Created <span className="font-semibold">{successes.length}</span> {plural(successes.length, 'draft')}{' '}
          {dryRun ? '(simulated)' : 'in Xero'} totalling{' '}
          <span className="font-semibold tabular">{formatGBP(successTotal)}</span>.
          {failures.length > 0 && (
            <>
              {' '}
              <span className="font-semibold text-red-700">{failures.length}</span> failed.
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={exportCsv} className="btn-secondary text-xs">
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => navigate('/upload')}
          className="btn-primary text-xs"
        >
          Start new run
        </button>
      </div>

      {failures.length > 0 && (
        <section className="card">
          <div className="card-header">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Failed invoices</h2>
              <span className="badge-red">{failures.length}</span>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-2 text-left">School</th>
                <th className="px-5 py-2 text-left">Error</th>
                <th className="px-5 py-2 text-right">Amount</th>
                <th className="px-5 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((r) => (
                <tr key={r.schoolKey} className="border-t border-slate-100">
                  <td className="px-5 py-2 align-top text-slate-700">{r.schoolName}</td>
                  <td className="px-5 py-2 align-top text-xs text-red-700">
                    {r.ok ? '' : r.error}
                  </td>
                  <td className="px-5 py-2 text-right tabular text-slate-700 align-top">
                    {formatGBP(r.total)}
                  </td>
                  <td className="px-5 py-2 text-right align-top">
                    {!r.ok && (
                      <button
                        type="button"
                        onClick={() => void handleRetry(r)}
                        disabled={retrying === r.schoolKey}
                        className="btn-secondary text-xs"
                      >
                        {retrying === r.schoolKey ? 'Retrying…' : 'Retry'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-900">
              {dryRun ? 'Would-be created' : 'Created drafts'}
            </h2>
            <span className="badge-green">{successes.length}</span>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-2 text-left">School</th>
              <th className="px-5 py-2 text-left">Invoice #</th>
              <th className="px-5 py-2 text-right">Amount</th>
              <th className="px-5 py-2 text-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {successes.map((r) =>
              r.ok ? (
                <tr key={r.schoolKey} className="border-t border-slate-100">
                  <td className="px-5 py-2 text-slate-700">{r.schoolName}</td>
                  <td className="px-5 py-2 font-mono text-xs text-slate-600">
                    {r.dryRun ? '[DRY RUN]' : r.invoiceNumber}
                  </td>
                  <td className="px-5 py-2 text-right tabular text-slate-900">
                    {formatGBP(r.total)}
                  </td>
                  <td className="px-5 py-2 text-right">
                    {!r.dryRun && (
                      <button
                        type="button"
                        onClick={() =>
                          window.api.shell.openExternal(
                            `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${r.invoiceID}`,
                          )
                        }
                        className="btn-ghost text-xs"
                      >
                        Open in Xero ↗
                      </button>
                    )}
                  </td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
