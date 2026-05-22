import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  AppSettings,
  StoredMapping,
  XeroAccountOption,
  XeroBrandingThemeOption,
} from '../../shared/types';

export default function Settings(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [mappings, setMappings] = useState<Record<string, StoredMapping>>({});
  const [accounts, setAccounts] = useState<XeroAccountOption[]>([]);
  const [themes, setThemes] = useState<XeroBrandingThemeOption[]>([]);
  const [version, setVersion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const refresh = async (): Promise<void> => {
    try {
      const [s, m, ver] = await Promise.all([
        window.api.store.getSettings(),
        window.api.store.getMappings(),
        window.api.app.version(),
      ]);
      setSettings(s);
      setMappings(m);
      setVersion(ver);
      // Attempt to load Xero-backed options; ok if we're not connected.
      try {
        const [accs, brs] = await Promise.all([
          window.api.xero.listAccounts(),
          window.api.xero.listBrandingThemes(),
        ]);
        setAccounts(accs);
        setThemes(brs);
      } catch {
        // ignore — user may not be connected
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const updateSetting = async <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ): Promise<void> => {
    const next = await window.api.store.updateSettings({ [key]: value } as Partial<AppSettings>);
    setSettings(next);
  };

  const deleteMapping = async (key: string): Promise<void> => {
    await window.api.store.deleteMapping(key);
    setMappings((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleDisconnect = async (): Promise<void> => {
    if (!confirm('Disconnect from Xero? You will need to authorise again next time.')) return;
    await window.api.xero.disconnect();
  };

  const handleResetAll = async (): Promise<void> => {
    if (!confirm('Reset ALL stored data (tokens, mappings, settings, run history)? This cannot be undone.')) return;
    await window.api.store.resetAll();
    await refresh();
  };

  const mappingEntries = Object.entries(mappings).filter(([key, m]) =>
    !search ||
    key.toLowerCase().includes(search.toLowerCase()) ||
    m.xeroContactName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">Manage defaults, saved mappings, and connection.</p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-slate-900">Defaults</h2>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="label mb-1">Revenue account</label>
            <select
              value={settings?.accountCode ?? ''}
              onChange={(e) => void updateSetting('accountCode', e.target.value || null)}
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
            <input
              value={settings?.taxType ?? ''}
              onChange={(e) => void updateSetting('taxType', e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label mb-1">Branding theme</label>
            <select
              value={settings?.brandingThemeId ?? ''}
              onChange={(e) => void updateSetting('brandingThemeId', e.target.value || null)}
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
          <div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings?.dryRunDefault ?? true}
                onChange={(e) => void updateSetting('dryRunDefault', e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
              />
              <span>
                <div className="font-medium text-slate-900">Dry run by default</div>
                <div className="text-xs text-slate-500">
                  When on, new runs default to preview mode. Recommended.
                </div>
              </span>
            </label>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Saved school mappings</h2>
            <span className="badge-slate">{Object.keys(mappings).length}</span>
          </div>
        </div>
        <div className="p-5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter mappings…"
            className="input mb-3"
          />
          {mappingEntries.length === 0 ? (
            <div className="text-sm text-slate-500">No saved mappings yet.</div>
          ) : (
            <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
              {mappingEntries.map(([key, m]) => (
                <div key={key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-slate-900">{key}</div>
                    <div className="truncate text-xs text-slate-500">→ {m.xeroContactName}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteMapping(key)}
                    className="btn-ghost text-xs"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-slate-900">Connection</h2>
        </div>
        <div className="space-y-3 p-5">
          <Link to="/setup" className="btn-secondary inline-block text-xs">
            Manage Xero connection
          </Link>
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            className="btn-secondary text-xs"
          >
            Disconnect from Xero
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-slate-900">Danger zone</h2>
        </div>
        <div className="space-y-3 p-5">
          <button
            type="button"
            onClick={() => void handleResetAll()}
            className="btn-danger text-xs"
          >
            Reset all local data
          </button>
          <p className="text-xs text-slate-500">
            Removes tokens, mappings, settings, and run history. Does not affect anything in Xero.
          </p>
        </div>
      </section>

      <div className="text-center text-xs text-slate-400">Xero Invoicer v{version || '…'}</div>
    </div>
  );
}
