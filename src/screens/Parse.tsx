import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRun } from '../lib/RunContext';
import { expandLine, sumLines } from '../lib/billing';
import { formatGBP, plural } from '../lib/format';
import type { ParsedInvoice, ParsedLine } from '../../shared/types';

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function n(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return value.toFixed(2);
}

/**
 * Build a CSV that mirrors what the parser ingested, plus what the billing
 * layer turned each row into. This is the single best tool for finding
 * "totals are out" bugs — drop it next to the original spreadsheet in
 * Excel and spot the rows that don't agree.
 */
function buildDiagnosticCsv(
  filename: string,
  sheetName: string,
  weekEnding: string,
  invoices: ParsedInvoice[],
): string {
  const lines: string[] = [];
  lines.push(`# Diagnostic export for ${csvEscape(filename)}`);
  lines.push(`# Sheet read: ${csvEscape(sheetName)}`);
  lines.push(`# Week ending: ${csvEscape(weekEnding)}`);
  lines.push(
    `# Generated: ${new Date().toISOString()} — totals at the bottom should match the spreadsheet's grand total`,
  );
  lines.push('');
  lines.push(
    [
      'row_number',
      'school',
      'teacher',
      'full_days',
      'part_days',
      'daily_charge_G',
      'weekly_charge_M',
      'invoice_amount',
      'is_awr',
      'notes',
      'xero_line_count',
      'xero_line_total',
      'matches_invoice_amount',
    ].join(','),
  );

  let grandTotal = 0;
  let grandXeroTotal = 0;
  let mismatches = 0;

  const allLines: { invoice: ParsedInvoice; line: ParsedLine }[] = [];
  for (const inv of invoices) {
    for (const line of inv.lines) {
      allLines.push({ invoice: inv, line });
    }
  }
  allLines.sort((a, b) => a.line.rowNumber - b.line.rowNumber);

  for (const { line } of allLines) {
    const billing = expandLine(line);
    const xeroTotal = sumLines(billing);
    const matches = Math.abs(xeroTotal - line.invoiceAmount) < 0.005;
    if (!matches) mismatches += 1;
    grandTotal += line.invoiceAmount;
    grandXeroTotal += xeroTotal;
    lines.push(
      [
        line.rowNumber,
        csvEscape(line.school),
        csvEscape(line.teacher),
        line.fullDays || '',
        line.partDays || '',
        n(line.dailyCharge),
        n(line.weeklyCharge),
        n(line.invoiceAmount),
        line.isAwr ? 'yes' : '',
        csvEscape(line.notes ?? ''),
        billing.length,
        n(xeroTotal),
        matches ? 'yes' : 'NO',
      ].join(','),
    );
  }

  lines.push('');
  lines.push(
    `# Grand total (spreadsheet sum of M/G): ${n(grandTotal)}`,
  );
  lines.push(
    `# Grand total (sum of Xero qty × unitAmount): ${n(grandXeroTotal)}`,
  );
  lines.push(`# Row mismatches: ${mismatches}`);
  return lines.join('\r\n');
}

export default function Parse(): JSX.Element {
  const navigate = useNavigate();
  const { parse } = useRun();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showWarnings, setShowWarnings] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [csvMessage, setCsvMessage] = useState<string | null>(null);

  if (!parse) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <p className="mb-4 text-sm text-slate-600">No spreadsheet parsed yet.</p>
        <Link to="/upload" className="btn-primary">
          Go to upload
        </Link>
      </div>
    );
  }

  const { invoices, totals, warnings, weekEndingDate, filename, sheetName } = parse;

  const sortedInvoices = useMemo(
    () => [...invoices].sort((a, b) => a.schoolName.localeCompare(b.schoolName)),
    [invoices],
  );

  // Sum what Xero will actually invoice (qty × unit, post-reconcile). This
  // should equal the parser's grandTotal exactly; if not, something's off
  // and we surface it loudly.
  const xeroGrandTotal = useMemo(() => {
    let sum = 0;
    for (const inv of invoices) {
      for (const line of inv.lines) {
        sum += sumLines(expandLine(line));
      }
    }
    return Math.round(sum * 100) / 100;
  }, [invoices]);

  const totalsAgree = Math.abs(xeroGrandTotal - totals.grandTotal) < 0.005;

  const toggle = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const singletons = invoices.filter((i) => i.lineCount === 1).length;
  const negatives = invoices.filter((i) => i.lines.some((l) => l.invoiceAmount < 0)).length;
  const zeroLines = warnings.filter((w) => w.reason.includes('zero')).length;
  const totalsRows = warnings.filter((w) => w.reason.includes('subtotal')).length;

  const handleExportCsv = async (): Promise<void> => {
    setExportingCsv(true);
    setCsvMessage(null);
    try {
      const csv = buildDiagnosticCsv(filename, sheetName, weekEndingDate, invoices);
      const baseName = filename.replace(/\.xlsx?$/i, '') || 'parsed';
      const saved = await window.api.dialog.saveCsv(`${baseName}_diagnostic.csv`, csv);
      if (saved) {
        setCsvMessage(`Saved to ${saved}`);
      }
    } catch (e) {
      setCsvMessage(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportingCsv(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Parsed preview</h1>
        <p className="mt-1 text-sm text-slate-600">
          Parsed <span className="font-medium">{totals.lineCount}</span>{' '}
          {plural(totals.lineCount, 'line item')} from{' '}
          <span className="font-medium">{totals.schoolCount}</span> schools.
          Week ending <span className="font-mono">{weekEndingDate}</span>. Total{' '}
          <span className="font-semibold tabular">{formatGBP(totals.grandTotal)}</span>.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {filename} · sheet: <span className="font-mono">{sheetName}</span>
        </p>
      </div>

      {!totalsAgree && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="mb-1 font-semibold">Totals don't reconcile</div>
          <p className="text-xs">
            Spreadsheet sum: <strong>{formatGBP(totals.grandTotal)}</strong>. Xero will
            invoice: <strong>{formatGBP(xeroGrandTotal)}</strong>. Difference:{' '}
            <strong>{formatGBP(xeroGrandTotal - totals.grandTotal)}</strong>. Export the
            diagnostic CSV below to find the offending rows.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Schools" value={totals.schoolCount.toString()} />
        <Stat label="Line items" value={totals.lineCount.toString()} />
        <Stat label="Grand total" value={formatGBP(totals.grandTotal)} />
        <Stat label="Skipped rows" value={totals.skippedRowCount.toString()} muted />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm">
        <div className="grow">
          <div className="font-medium text-slate-900">Diagnostic export</div>
          <div className="text-xs text-slate-500">
            Dump every parsed row to CSV so you can diff against the original
            spreadsheet and confirm nothing was missed or misread.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleExportCsv()}
          disabled={exportingCsv}
          className="btn-secondary text-xs"
        >
          {exportingCsv ? 'Saving…' : 'Export diagnostic CSV'}
        </button>
        {csvMessage && (
          <div className="basis-full text-xs text-slate-500">{csvMessage}</div>
        )}
      </div>

      {(warnings.length > 0 || singletons > 0 || negatives > 0) && (
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Notes & warnings</h2>
              <span className="badge-amber">
                {warnings.length + singletons + negatives}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowWarnings((s) => !s)}
              className="btn-ghost text-xs"
            >
              {showWarnings ? 'Hide' : 'Show'}
            </button>
          </div>
          {showWarnings && (
            <div className="space-y-3 p-5 text-sm">
              {singletons > 0 && (
                <p className="text-slate-600">
                  <span className="font-medium">{singletons}</span> schools have only one line
                  item. Worth a quick glance to make sure that's correct.
                </p>
              )}
              {negatives > 0 && (
                <p className="text-slate-600">
                  <span className="font-medium">{negatives}</span> schools include a negative line
                  (correction). These will be included as negative line items.
                </p>
              )}
              {zeroLines > 0 && (
                <p className="text-slate-600">
                  <span className="font-medium">{zeroLines}</span> rows had zero amount and were
                  skipped.
                </p>
              )}
              {totalsRows > 0 && (
                <p className="text-slate-600">
                  <span className="font-medium">{totalsRows}</span> rows looked like
                  totals/subtotals and were skipped (saves them being billed by mistake).
                </p>
              )}
              {warnings.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-slate-500">
                    Row-level skips ({warnings.length})
                  </summary>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                    {warnings.map((w, i) => (
                      <li key={i}>
                        Row {w.rowNumber}: {w.reason}
                        {w.school ? ` (${w.school})` : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {sortedInvoices.map((inv) => {
          const open = expanded.has(inv.schoolName);
          const hasAwr = inv.lines.some((l) => l.isAwr);
          const hasNegative = inv.lines.some((l) => l.invoiceAmount < 0);
          return (
            <div key={inv.schoolName} className="card overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(inv.schoolName)}
                className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left hover:bg-slate-50"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="text-slate-400">{open ? '▾' : '▸'}</span>
                  <span className="truncate text-sm font-medium text-slate-900">
                    {inv.schoolNameOriginal}
                  </span>
                  {hasAwr && <span className="badge-accent">AWR</span>}
                  {hasNegative && <span className="badge-amber">Correction</span>}
                  {inv.lineCount === 1 && <span className="badge-slate">Single line</span>}
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-slate-500">
                    {inv.lineCount} {plural(inv.lineCount, 'line')}
                  </span>
                  <span className="font-semibold tabular text-slate-900">
                    {formatGBP(inv.totalAmount)}
                  </span>
                </div>
              </button>
              {open && (
                <div className="border-t border-slate-100 bg-slate-50/50">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-2 text-left">Row</th>
                        <th className="px-5 py-2 text-left">Teacher</th>
                        <th className="px-5 py-2 text-left">Description</th>
                        <th className="px-5 py-2 text-right">Amount</th>
                        <th className="px-5 py-2 text-center w-16">AWR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.lines.map((l) => (
                        <tr key={l.rowNumber} className="border-t border-slate-100">
                          <td className="px-5 py-2 align-top text-xs font-mono text-slate-400">
                            {l.rowNumber}
                          </td>
                          <td className="px-5 py-2 align-top text-slate-700">{l.teacher}</td>
                          <td className="px-5 py-2 align-top text-xs text-slate-600">
                            {l.description}
                          </td>
                          <td
                            className={[
                              'px-5 py-2 text-right align-top tabular',
                              l.invoiceAmount < 0
                                ? 'text-amber-700'
                                : 'text-slate-900',
                            ].join(' ')}
                          >
                            {formatGBP(l.invoiceAmount)}
                          </td>
                          <td className="px-5 py-2 text-center align-top">
                            {l.isAwr ? <span className="badge-accent">AWR</span> : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-0 -mx-6 flex items-center justify-between border-t border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
        <Link to="/upload" className="btn-secondary">
          Re-upload
        </Link>
        <button
          type="button"
          onClick={() => navigate('/match')}
          className="btn-primary"
        >
          Continue to matching
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}): JSX.Element {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={[
          'mt-1 text-2xl font-semibold tabular',
          muted ? 'text-slate-400' : 'text-slate-900',
        ].join(' ')}
      >
        {value}
      </div>
    </div>
  );
}
