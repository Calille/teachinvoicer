import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRun } from '../lib/RunContext';
import type { SchoolMatchState, XeroContact } from '../../shared/types';
import { plural } from '../lib/format';

const AUTO_THRESHOLD = 0.9;

export default function Match(): JSX.Element {
  const navigate = useNavigate();
  const { parse, matches, setMatches, updateMatch } = useRun();
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<XeroContact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!parse) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [m, c] = await Promise.all([
          window.api.matching.buildMatches(parse.invoices.map((i) => i.schoolNameOriginal)),
          window.api.xero.listContacts(false),
        ]);
        if (cancelled) return;
        setMatches(m);
        setContacts(c);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [parse, setMatches]);

  const refreshContacts = async (): Promise<void> => {
    if (!parse) return;
    setRefreshing(true);
    try {
      const c = await window.api.xero.listContacts(true);
      setContacts(c);
      const m = await window.api.matching.buildMatches(
        parse.invoices.map((i) => i.schoolNameOriginal),
      );
      setMatches(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const saved = useMemo(() => matches.filter((m) => m.fromSavedMapping && !m.skipped), [matches]);
  const auto = useMemo(
    () =>
      matches.filter(
        (m) =>
          !m.fromSavedMapping &&
          m.autoApplied &&
          !m.skipped &&
          m.selectedContactID,
      ),
    [matches],
  );
  const todo = useMemo(
    () => matches.filter((m) => !m.fromSavedMapping && !m.autoApplied && !m.skipped),
    [matches],
  );
  const skipped = useMemo(() => matches.filter((m) => m.skipped), [matches]);

  const matchedCount = matches.filter((m) => m.selectedContactID || m.skipped).length;
  const totalCount = matches.length;
  const canContinue = totalCount > 0 && matchedCount === totalCount;

  const persistMapping = async (m: SchoolMatchState): Promise<void> => {
    if (!m.selectedContactID || !m.selectedContactName) return;
    await window.api.store.setMapping(m.schoolKey, {
      xeroContactId: m.selectedContactID,
      xeroContactName: m.selectedContactName,
      confirmedAt: new Date().toISOString(),
    });
  };

  const handleSelect = async (
    schoolKey: string,
    contactID: string,
    contactName: string,
  ): Promise<void> => {
    updateMatch(schoolKey, {
      selectedContactID: contactID,
      selectedContactName: contactName,
      skipped: false,
    });
    await window.api.store.setMapping(schoolKey, {
      xeroContactId: contactID,
      xeroContactName: contactName,
      confirmedAt: new Date().toISOString(),
    });
  };

  const handleClear = async (schoolKey: string): Promise<void> => {
    updateMatch(schoolKey, {
      selectedContactID: null,
      selectedContactName: null,
      fromSavedMapping: false,
      autoApplied: false,
    });
    await window.api.store.deleteMapping(schoolKey);
  };

  const handleSkip = (schoolKey: string, skip: boolean): void => {
    updateMatch(schoolKey, { skipped: skip });
  };

  if (!parse) {
    return (
      <div className="text-center text-sm text-slate-500">
        No parsed data. <Link to="/upload" className="text-accent-600 underline">Upload a spreadsheet</Link>.
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm text-slate-500">Loading contacts and computing matches…</div>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Match schools to Xero contacts</h1>
          <p className="mt-1 text-sm text-slate-600">
            {matchedCount} of {totalCount} schools matched. {contacts.length}{' '}
            {plural(contacts.length, 'contact')} loaded from Xero.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshContacts}
          disabled={refreshing}
          className="btn-secondary text-xs"
        >
          {refreshing ? 'Refreshing…' : 'Refresh contacts'}
        </button>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full bg-accent-600 transition-all"
          style={{ width: `${totalCount > 0 ? (matchedCount / totalCount) * 100 : 0}%` }}
        />
      </div>

      {saved.length > 0 && (
        <Collapsible
          open={showSaved}
          setOpen={setShowSaved}
          title={`Saved mappings applied (${saved.length})`}
          subtitle="From your previous runs"
          accent="green"
        >
          <CompactMatchList
            matches={saved}
            contacts={contacts}
            onSelect={handleSelect}
            onClear={handleClear}
            onSkip={handleSkip}
          />
        </Collapsible>
      )}

      {auto.length > 0 && (
        <Collapsible
          open={showAuto}
          setOpen={setShowAuto}
          title={`High-confidence matches (${auto.length})`}
          subtitle={`Score above ${AUTO_THRESHOLD}. Review if you want to.`}
          accent="accent"
        >
          <CompactMatchList
            matches={auto}
            contacts={contacts}
            onSelect={handleSelect}
            onClear={handleClear}
            onSkip={handleSkip}
          />
        </Collapsible>
      )}

      {todo.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Needs your input</h2>
            <span className="badge-amber">{todo.length}</span>
          </div>
          <div className="space-y-3">
            {todo.map((m) => (
              <MatchRow
                key={m.schoolKey}
                match={m}
                contacts={contacts}
                onSelect={handleSelect}
                onClear={handleClear}
                onSkip={handleSkip}
              />
            ))}
          </div>
        </section>
      )}

      {skipped.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Skipped</h2>
            <span className="badge-slate">{skipped.length}</span>
            <p className="text-xs text-slate-500">These schools will not be invoiced this run.</p>
          </div>
          <div className="space-y-2">
            {skipped.map((m) => (
              <div
                key={m.schoolKey}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm"
              >
                <span className="text-slate-600">{m.schoolNameOriginal}</span>
                <button
                  type="button"
                  onClick={() => handleSkip(m.schoolKey, false)}
                  className="btn-ghost text-xs"
                >
                  Un-skip
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="sticky bottom-0 -mx-6 flex items-center justify-between border-t border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
        <Link to="/parse" className="btn-secondary">
          Back
        </Link>
        <button
          type="button"
          onClick={() => navigate('/review')}
          disabled={!canContinue}
          className="btn-primary"
          title={!canContinue ? 'Match or skip every school first' : undefined}
        >
          Continue to review
        </button>
      </div>
    </div>
  );
}

function Collapsible({
  open,
  setOpen,
  title,
  subtitle,
  accent,
  children,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  title: string;
  subtitle: string;
  accent: 'green' | 'accent';
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          <span className={accent === 'green' ? 'badge-green' : 'badge-accent'}>{title}</span>
          <span className="text-xs text-slate-500">{subtitle}</span>
        </div>
        <span className="text-xs text-slate-500">{open ? 'Hide' : 'Review'}</span>
      </button>
      {open && <div className="border-t border-slate-100 p-4">{children}</div>}
    </div>
  );
}

function CompactMatchList({
  matches,
  contacts,
  onSelect,
  onClear,
  onSkip,
}: {
  matches: SchoolMatchState[];
  contacts: XeroContact[];
  onSelect: (key: string, id: string, name: string) => void;
  onClear: (key: string) => void;
  onSkip: (key: string, v: boolean) => void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      {matches.map((m) => (
        <MatchRow
          key={m.schoolKey}
          match={m}
          contacts={contacts}
          compact
          onSelect={onSelect}
          onClear={onClear}
          onSkip={onSkip}
        />
      ))}
    </div>
  );
}

function MatchRow({
  match,
  contacts,
  compact,
  onSelect,
  onClear,
  onSkip,
}: {
  match: SchoolMatchState;
  contacts: XeroContact[];
  compact?: boolean;
  onSelect: (key: string, id: string, name: string) => void;
  onClear: (key: string) => void;
  onSkip: (key: string, v: boolean) => void;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts.slice(0, 20);
    return contacts
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [search, contacts]);

  return (
    <div className={compact ? 'rounded-md border border-slate-200 bg-white p-3' : 'card p-4'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-900">{match.schoolNameOriginal}</div>
          {match.selectedContactID && (
            <div className="mt-1 flex items-center gap-2 text-xs">
              <span className="text-slate-500">→</span>
              <span className="font-medium text-slate-700">{match.selectedContactName}</span>
              {match.fromSavedMapping && <span className="badge-green">Saved</span>}
              {match.autoApplied && !match.fromSavedMapping && (
                <span className="badge-accent">Auto</span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {match.selectedContactID && (
            <button
              type="button"
              onClick={() => onClear(match.schoolKey)}
              className="btn-ghost text-xs"
            >
              Clear
            </button>
          )}
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={match.skipped}
              onChange={(e) => onSkip(match.schoolKey, e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
            />
            Skip
          </label>
        </div>
      </div>

      {!compact && !match.skipped && (
        <div className="mt-3 space-y-2">
          {match.candidates.length > 0 && (
            <div>
              <div className="label mb-1">Top fuzzy matches</div>
              <div className="space-y-1">
                {match.candidates.map((c) => (
                  <button
                    key={c.contactID}
                    type="button"
                    onClick={() => onSelect(match.schoolKey, c.contactID, c.name)}
                    className={[
                      'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      match.selectedContactID === c.contactID
                        ? 'border-accent-500 bg-accent-50 text-accent-900'
                        : 'border-slate-200 bg-white hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 font-mono text-xs text-slate-500">
                      {(c.score * 100).toFixed(0)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-xs font-medium text-accent-600 hover:text-accent-700"
            >
              {showAll ? 'Hide' : 'Search all contacts'}
            </button>
            {showAll && (
              <div className="mt-2 space-y-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Type to filter contacts…"
                  className="input"
                />
                <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200">
                  {filteredContacts.map((c) => (
                    <button
                      key={c.contactID}
                      type="button"
                      onClick={() => onSelect(match.schoolKey, c.contactID, c.name)}
                      className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      {c.name}
                    </button>
                  ))}
                  {filteredContacts.length === 0 && (
                    <div className="px-3 py-2 text-xs text-slate-500">No contacts match.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span title="Coming soon — create new contacts directly from Xero for now">
              Create new contact in Xero (coming soon)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
