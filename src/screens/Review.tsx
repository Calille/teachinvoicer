import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRun } from '../lib/RunContext';
import { expandLine } from '../lib/billing';
import { formatGBP, plural } from '../lib/format';
import type {
  AppSettings,
  DuplicateWarning,
  PreparedInvoice,
  XeroAccountOption,
  XeroBrandingThemeOption,
} from '../../shared/types';

const TAX_TYPES = [
  { value: 'NONE', label: 'NONE (no VAT — UK education exempt)' },
  { value: 'EXEMPTOUTPUT', label: 'EXEMPTOUTPUT (sales exempt)' },
  { value: 'ZERORATEDOUTPUT', label: 'ZERORATEDOUTPUT (sales zero-rated)' },
  { value: 'OUTPUT2', label: 'OUTPUT2 (20% VAT on income)' },
];

const LINE_AMOUNT_TYPES: Array<{ value: AppSettings['lineAmountTypes']; label: string }> = [
  { value: 'Exclusive', label: 'Exclusive of tax' },
  { value: 'Inclusive', label: 'Inclusive of tax' },
  { value: 'NoTax', label: 'No tax' },
];

function addDays(dateGB: string, days: number): string {
  // dateGB is DD/MM/YYYY
  const [dd, mm, yyyy] = dateGB.split('/').map((n) => parseInt(n, 10));
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function gbToIso(dateGB: string): string {
  const [dd, mm, yyyy] = dateGB.split('/').map((n) => parseInt(n, 10));
  return new Date(Date.UTC(yyyy, mm - 1, dd)).toISOString().slice(0, 10);
}

export default function Review(): JSX.Element {
  const navigate = useNavigate();
  const {
    parse,
    matches,
    prepared,
    setPrepared,
    settings,
    setSettings,
    patchSettings,
    setResults,
    dryRunOverride,
    setDryRunOverride,
  } = useRun();

  const [accounts, setAccounts] = useState<XeroAccountOption[]>([]);
  const [themes, setThemes] = useState<XeroBrandingThemeOption[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number; school: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  // Per-invoice selection. Defaults to "all selected" whenever the prepared
  // list changes (e.g. after re-matching).
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Build prepared invoices from matches + parse.
  useEffect(() => {
    if (!parse) return;
    const reference = `Week Ending ${parse.weekEndingDate}`;
    const date = new Date().toISOString().slice(0, 10);
    const dueDate = addDays(parse.weekEndingDate, 14);
    const prep: PreparedInvoice[] = [];
    for (const inv of parse.invoices) {
      const m = matches.find((x) => x.schoolNameOriginal === inv.schoolNameOriginal);
      if (!m || !m.selectedContactID || m.skipped) continue;
      prep.push({
        schoolKey: m.schoolKey,
        schoolName: inv.schoolNameOriginal,
        contactID: m.selectedContactID,
        reference,
        date,
        dueDate,
        weekEnding: parse.weekEndingDate,
        total: inv.totalAmount,
        lines: inv.lines.flatMap((l) => expandLine(l)),
      });
    }
    setPrepared(prep);
  }, [parse, matches, setPrepared]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [s, accs, brs] = await Promise.all([
          window.api.store.getSettings(),
          window.api.xero.listAccounts(),
          window.api.xero.listBrandingThemes(),
        ]);
        if (cancelled) return;
        setSettings(s);
        setAccounts(accs);
        setThemes(brs);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [setSettings]);

  useEffect(() => {
    if (prepared.length === 0) {
      setDuplicates([]);
      return;
    }
    let cancelled = false;
    const refs = prepared.map((p) => ({
      contactID: p.contactID,
      reference: p.reference,
      schoolKey: p.schoolKey,
      schoolName: p.schoolName,
    }));
    window.api.xero.checkDuplicates(refs).then((dups) => {
      if (!cancelled) setDuplicates(dups);
    }).catch(() => {
      // Non-fatal — duplicate check is best-effort.
    });
    return () => {
      cancelled = true;
    };
  }, [prepared]);

  // Reset selection to all-selected whenever the prepared list shape changes.
  useEffect(() => {
    setSelectedKeys(new Set(prepared.map((p) => p.schoolKey)));
  }, [prepared]);

  const totalAmount = useMemo(
    () => prepared.reduce((sum, inv) => sum + inv.total, 0),
    [prepared],
  );

  const selectedInvoices = useMemo(
    () => prepared.filter((p) => selectedKeys.has(p.schoolKey)),
    [prepared, selectedKeys],
  );

  const selectedTotal = useMemo(
    () => selectedInvoices.reduce((sum, inv) => sum + inv.total, 0),
    [selectedInvoices],
  );

  const toggleOne = (schoolKey: string): void => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(schoolKey)) next.delete(schoolKey);
      else next.add(schoolKey);
      return next;
    });
  };

  const selectAll = (): void => {
    setSelectedKeys(new Set(prepared.map((p) => p.schoolKey)));
  };

  const selectNone = (): void => {
    setSelectedKeys(new Set());
  };

  const deselectDuplicates = (): void => {
    const dupKeys = new Set(duplicates.map((d) => d.schoolKey));
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of dupKeys) next.delete(k);
      return next;
    });
  };

  const effectiveDryRun = dryRunOverride ?? settings?.dryRunDefault ?? true;

  const handleCreate = async (): Promise<void> => {
    if (!settings) return;
    if (!settings.accountCode) {
      setError('Choose a revenue account before creating invoices.');
      return;
    }
    if (!parse) return;
    if (selectedInvoices.length === 0) {
      setError('Tick at least one invoice to create.');
      return;
    }
    setCreating(true);
    setError(null);
    setProgress({ index: 0, total: selectedInvoices.length, school: '' });

    const off = window.api.events.onInvoiceProgress((p) => setProgress(p));

    try {
      const results = await window.api.invoices.create(selectedInvoices, {
        accountCode: settings.accountCode,
        taxType: settings.taxType,
        brandingThemeId: settings.brandingThemeId,
        lineAmountTypes: settings.lineAmountTypes,
        dryRun: effectiveDryRun,
        weekEnding: parse.weekEndingDate,
        spreadsheetFilename: parse.filename,
      });
      setResults(results);
      navigate('/results');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      off();
      setCreating(false);
      setProgress(null);
    }
  };

  const persistSetting = async <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ): Promise<void> => {
    patchSettings({ [key]: value } as Partial<AppSettings>);
    await window.api.store.updateSettings({ [key]: value });
  };

  if (!parse) {
    return (
      <div className="text-center text-sm text-slate-500">
        No parsed data. <Link to="/upload" className="text-accent-600 underline">Upload a spreadsheet</Link>.
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm text-slate-500">Loading Xero accounts and branding themes…</div>;
  }

  const skippedCount = parse.invoices.length - prepared.length;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr,20rem]">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Review &amp; create drafts</h1>
          <p className="mt-1 text-sm text-slate-600">
            <span className="font-semibold">{selectedInvoices.length}</span> of{' '}
            <span className="font-semibold">{prepared.length}</span>{' '}
            {plural(prepared.length, 'invoice')} selected — totalling{' '}
            <span className="font-semibold tabular">{formatGBP(selectedTotal)}</span>
            {selectedInvoices.length !== prepared.length && (
              <span className="text-slate-400">
                {' '}
                (of {formatGBP(totalAmount)} available)
              </span>
            )}
            . Drafts will <strong>not</strong> be sent automatically — Josh sends from Xero.
          </p>
          {skippedCount > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {skippedCount} {plural(skippedCount, 'school')} skipped at the matching step.
            </p>
          )}
        </div>

        {duplicates.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <div className="mb-2 font-semibold">
              ⚠ Possible duplicates ({duplicates.length})
            </div>
            <p className="mb-2 text-xs">
              Xero already has an invoice with this reference for these schools.
              You can still proceed — Xero allows duplicate references — but you may want to skip them.
            </p>
            <ul className="space-y-1 text-xs">
              {duplicates.map((d) => (
                <li key={d.schoolKey}>
                  <span className="font-medium">{d.schoolName}</span> — existing{' '}
                  <button
                    type="button"
                    className="font-mono underline"
                    onClick={() =>
                      window.api.shell.openExternal(
                        `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${d.existingInvoiceID}`,
                      )
                    }
                  >
                    {d.existingInvoiceNumber}
                  </button>{' '}
                  ({d.existingStatus})
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
          <span className="text-slate-500">Bulk:</span>
          <button
            type="button"
            onClick={selectAll}
            disabled={selectedInvoices.length === prepared.length}
            className="btn-ghost text-xs"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={selectNone}
            disabled={selectedInvoices.length === 0}
            className="btn-ghost text-xs"
          >
            Select none
          </button>
          {duplicates.length > 0 && (
            <button
              type="button"
              onClick={deselectDuplicates}
              className="btn-ghost text-xs"
              title="Untick any school that already has an invoice with this week's reference in Xero"
            >
              Untick {duplicates.length} possible {plural(duplicates.length, 'duplicate')}
            </button>
          )}
        </div>

        <div className="space-y-2">
          {prepared.map((inv) => {
            const isSelected = selectedKeys.has(inv.schoolKey);
            const isDup = duplicates.some((d) => d.schoolKey === inv.schoolKey);
            return (
            <details
              key={inv.schoolKey}
              className={[
                'card overflow-hidden transition-opacity',
                isSelected ? '' : 'opacity-60',
              ].join(' ')}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-3 hover:bg-slate-50">
                <div className="flex min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Include ${inv.schoolName}`}
                    checked={isSelected}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleOne(inv.schoolKey);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 shrink-0 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
                  />
                  <span className="truncate text-sm font-medium text-slate-900">
                    {inv.schoolName}
                  </span>
                  <span className="text-xs text-slate-500">
                    Ref: {inv.reference}
                  </span>
                  {isDup && <span className="badge-amber">Possible duplicate</span>}
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-slate-500">
                    {inv.lines.length} {plural(inv.lines.length, 'line')}
                  </span>
                  <span className="font-semibold tabular text-slate-900">
                    {formatGBP(inv.total)}
                  </span>
                </div>
              </summary>
              <div className="border-t border-slate-100 bg-slate-50/50">
                <div className="px-5 py-3 text-xs text-slate-500">
                  Date {inv.date} · Due {inv.dueDate}
                </div>
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-2 text-left">Description</th>
                      <th className="px-5 py-2 text-right">Qty</th>
                      <th className="px-5 py-2 text-right">Unit</th>
                      <th className="px-5 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lines.map((l, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-5 py-2 text-xs text-slate-700">
                          {l.description}
                          {l.isAwr && <span className="ml-2 badge-accent">AWR</span>}
                        </td>
                        <td className="px-5 py-2 text-right tabular text-slate-700">
                          {l.quantity}
                        </td>
                        <td className="px-5 py-2 text-right tabular text-slate-700">
                          {formatGBP(l.unitAmount)}
                        </td>
                        <td className="px-5 py-2 text-right tabular font-medium text-slate-900">
                          {formatGBP(l.unitAmount * l.quantity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            );
          })}
        </div>
      </div>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="card">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-slate-900">Settings</h2>
          </div>
          <div className="space-y-4 p-5">
            <div>
              <label className="label mb-1">Revenue account</label>
              <select
                value={settings?.accountCode ?? ''}
                onChange={(e) => void persistSetting('accountCode', e.target.value || null)}
                className="select"
              >
                <option value="">— Choose an account —</option>
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label mb-1">Tax type</label>
              <select
                value={settings?.taxType ?? 'NONE'}
                onChange={(e) => void persistSetting('taxType', e.target.value)}
                className="select"
              >
                {TAX_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label mb-1">Line amount type</label>
              <select
                value={settings?.lineAmountTypes ?? 'Exclusive'}
                onChange={(e) =>
                  void persistSetting('lineAmountTypes', e.target.value as AppSettings['lineAmountTypes'])
                }
                className="select"
              >
                {LINE_AMOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label mb-1">Branding theme</label>
              <select
                value={settings?.brandingThemeId ?? ''}
                onChange={(e) => void persistSetting('brandingThemeId', e.target.value || null)}
                className="select"
              >
                <option value="">— Use Xero default —</option>
                {themes.map((t) => (
                  <option key={t.brandingThemeID} value={t.brandingThemeID}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={effectiveDryRun}
                  onChange={(e) => setDryRunOverride(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
                />
                <span>
                  <div className="font-medium text-slate-900">Dry run — don't actually push to Xero</div>
                  <div className="text-xs text-slate-500">
                    Recommended for the first few weeks. Default is set in Settings.
                  </div>
                </span>
              </label>
            </div>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleCreate}
              disabled={
                creating ||
                selectedInvoices.length === 0 ||
                !settings?.accountCode
              }
              className="btn-primary w-full"
            >
              {creating
                ? `Creating ${progress?.index ?? 0} of ${progress?.total ?? selectedInvoices.length}…`
                : effectiveDryRun
                  ? `Run dry run (${selectedInvoices.length})`
                  : `Create ${selectedInvoices.length} ${plural(selectedInvoices.length, 'draft')} in Xero`}
            </button>
            {creating && progress && (
              <div className="text-xs text-slate-500">
                Working on <span className="font-medium text-slate-700">{progress.school}</span>
              </div>
            )}

            <Link to="/match" className="btn-ghost w-full text-xs">
              Back to matching
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
