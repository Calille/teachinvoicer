import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type {
  AppSettings,
  InvoiceCreationResult,
  ParseResult,
  PreparedInvoice,
  SchoolMatchState,
} from '../../shared/types';

export type Step = 'setup' | 'upload' | 'parse' | 'match' | 'review' | 'results';

type RunState = {
  parse: ParseResult | null;
  matches: SchoolMatchState[];
  prepared: PreparedInvoice[];
  settings: AppSettings | null;
  results: InvoiceCreationResult[];
  dryRunOverride: boolean | null;
};

const initial: RunState = {
  parse: null,
  matches: [],
  prepared: [],
  settings: null,
  results: [],
  dryRunOverride: null,
};

type RunContextValue = RunState & {
  setParse: (r: ParseResult | null) => void;
  setMatches: (m: SchoolMatchState[]) => void;
  updateMatch: (schoolKey: string, patch: Partial<SchoolMatchState>) => void;
  setPrepared: (p: PreparedInvoice[]) => void;
  setSettings: (s: AppSettings) => void;
  patchSettings: (p: Partial<AppSettings>) => void;
  setResults: (r: InvoiceCreationResult[]) => void;
  setDryRunOverride: (v: boolean | null) => void;
  reset: () => void;
};

const Ctx = createContext<RunContextValue | null>(null);

export function RunProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [state, setState] = useState<RunState>(initial);

  const setParse = useCallback((parse: ParseResult | null) => {
    setState((s) => ({ ...s, parse }));
  }, []);

  const setMatches = useCallback((matches: SchoolMatchState[]) => {
    setState((s) => ({ ...s, matches }));
  }, []);

  const updateMatch = useCallback(
    (schoolKey: string, patch: Partial<SchoolMatchState>) => {
      setState((s) => ({
        ...s,
        matches: s.matches.map((m) => (m.schoolKey === schoolKey ? { ...m, ...patch } : m)),
      }));
    },
    [],
  );

  const setPrepared = useCallback((prepared: PreparedInvoice[]) => {
    setState((s) => ({ ...s, prepared }));
  }, []);

  const setSettings = useCallback((settings: AppSettings) => {
    setState((s) => ({ ...s, settings }));
  }, []);

  const patchSettings = useCallback((patch: Partial<AppSettings>) => {
    setState((s) => ({
      ...s,
      settings: s.settings ? { ...s.settings, ...patch } : s.settings,
    }));
  }, []);

  const setResults = useCallback((results: InvoiceCreationResult[]) => {
    setState((s) => ({ ...s, results }));
  }, []);

  const setDryRunOverride = useCallback((v: boolean | null) => {
    setState((s) => ({ ...s, dryRunOverride: v }));
  }, []);

  const reset = useCallback(() => setState(initial), []);

  const value = useMemo<RunContextValue>(
    () => ({
      ...state,
      setParse,
      setMatches,
      updateMatch,
      setPrepared,
      setSettings,
      patchSettings,
      setResults,
      setDryRunOverride,
      reset,
    }),
    [
      state,
      setParse,
      setMatches,
      updateMatch,
      setPrepared,
      setSettings,
      patchSettings,
      setResults,
      setDryRunOverride,
      reset,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRun(): RunContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRun must be used inside RunProvider');
  return ctx;
}
