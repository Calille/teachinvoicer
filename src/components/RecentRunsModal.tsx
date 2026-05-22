import { useEffect, useState } from 'react';
import type { RunRecord } from '../../shared/types';
import { formatGBP } from '../lib/format';

export default function RecentRunsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void window.api.store.getRuns().then((r) => {
      setRuns(r);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header">
          <h2 className="text-base font-semibold text-slate-900">Recent runs</h2>
          <button type="button" onClick={onClose} className="btn-ghost text-xs">
            Close
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="p-6 text-sm text-slate-500">Loading…</div>
          ) : runs.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No runs yet. Once you've created some invoices they'll appear here.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Week ending</th>
                  <th className="px-4 py-2 text-left">File</th>
                  <th className="px-4 py-2 text-right">Invoices</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2 text-right">Failures</th>
                  <th className="px-4 py-2 text-left">Mode</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-slate-600">
                      {new Date(r.timestamp).toLocaleString('en-GB')}
                    </td>
                    <td className="px-4 py-2 text-slate-700">{r.weekEnding}</td>
                    <td className="px-4 py-2 text-slate-500" title={r.spreadsheetFilename}>
                      <span className="block max-w-[14rem] truncate">
                        {r.spreadsheetFilename}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular">{r.invoicesCreated}</td>
                    <td className="px-4 py-2 text-right tabular">{formatGBP(r.totalAmount)}</td>
                    <td className="px-4 py-2 text-right tabular">
                      {r.failures > 0 ? (
                        <span className="badge-red">{r.failures}</span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {r.dryRun ? (
                        <span className="badge-amber">Dry run</span>
                      ) : (
                        <span className="badge-green">Live</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
