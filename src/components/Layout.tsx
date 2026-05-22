import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useRun } from '../lib/RunContext';
import RecentRunsModal from './RecentRunsModal';

const STEPS: Array<{ path: string; label: string; n: number }> = [
  { path: '/upload', label: 'Upload', n: 1 },
  { path: '/parse', label: 'Parse', n: 2 },
  { path: '/match', label: 'Match', n: 3 },
  { path: '/review', label: 'Review', n: 4 },
  { path: '/results', label: 'Results', n: 5 },
];

export default function Layout({ children }: { children: React.ReactNode }): JSX.Element {
  const loc = useLocation();
  const navigate = useNavigate();
  const { reset } = useRun();
  const [version, setVersion] = useState<string>('');
  const [showRuns, setShowRuns] = useState(false);

  useEffect(() => {
    void window.api.app.version().then(setVersion).catch(() => undefined);
  }, []);

  const currentStep = STEPS.findIndex((s) => loc.pathname.startsWith(s.path));
  const onSetupOrSettings = loc.pathname.startsWith('/setup') || loc.pathname.startsWith('/settings');

  const startOver = (): void => {
    reset();
    navigate('/upload');
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-600 text-sm font-semibold text-white">
              X
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-slate-900">Xero Invoicer</div>
              <div className="text-xs text-slate-500">Teach Education · Keep Education</div>
            </div>
          </div>

          {!onSetupOrSettings && (
            <nav className="hidden flex-1 items-center justify-center gap-1 md:flex">
              {STEPS.map((s, idx) => {
                const active = idx === currentStep;
                const done = currentStep > idx;
                return (
                  <div key={s.path} className="flex items-center">
                    <Link
                      to={s.path}
                      className={[
                        'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                        active
                          ? 'bg-accent-50 text-accent-700'
                          : done
                            ? 'text-slate-700 hover:bg-slate-100'
                            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold',
                          active
                            ? 'bg-accent-600 text-white'
                            : done
                              ? 'bg-slate-300 text-slate-700'
                              : 'bg-slate-200 text-slate-500',
                        ].join(' ')}
                      >
                        {done ? '✓' : s.n}
                      </span>
                      <span>{s.label}</span>
                    </Link>
                    {idx < STEPS.length - 1 && (
                      <span className="mx-1 h-px w-4 bg-slate-200" aria-hidden />
                    )}
                  </div>
                );
              })}
            </nav>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowRuns(true)}
              className="btn-ghost text-xs"
              title="Recent runs"
            >
              History
            </button>
            <Link to="/settings" className="btn-ghost text-xs">
              Settings
            </Link>
            {!onSetupOrSettings && (
              <button type="button" onClick={startOver} className="btn-ghost text-xs">
                Start over
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-2 text-xs text-slate-400">
          <div>Drafts only. Nothing is sent to schools automatically.</div>
          <div>v{version || '…'}</div>
        </div>
      </footer>

      {showRuns && <RecentRunsModal onClose={() => setShowRuns(false)} />}
    </div>
  );
}
