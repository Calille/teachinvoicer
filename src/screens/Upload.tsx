import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRun } from '../lib/RunContext';

function extractWeekEndingFromFilename(filename: string): string | null {
  // e.g. Week_ending_22nd_May_2026.xlsx
  const m = filename.match(/Week[_\s]*ending[_\s]*(\d+)(?:st|nd|rd|th)?[_\s]*([A-Za-z]+)[_\s]*(\d{4})/i);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthName = m[2].toLowerCase();
  const year = parseInt(m[3], 10);
  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  };
  const month = months[monthName];
  if (!month) return null;
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

export default function Upload(): JSX.Element {
  const navigate = useNavigate();
  const { setParse, reset } = useRun();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [pendingFilename, setPendingFilename] = useState<string | null>(null);
  const [manualDate, setManualDate] = useState('');
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    reset();
  }, [reset]);

  useEffect(() => {
    const off = window.api.events.onMenu('menu:open-file', () => {
      void chooseFile();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runParse = async (filePath: string, weekEndingOverride: string | null): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.parser.parseFile(filePath, weekEndingOverride);
      setParse(result);
      navigate('/parse');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePath = async (filePath: string): Promise<void> => {
    const filename = filePath.split(/[\\/]/).pop() ?? filePath;
    const detected = extractWeekEndingFromFilename(filename);
    if (detected) {
      await runParse(filePath, null);
    } else {
      setPendingPath(filePath);
      setPendingFilename(filename);
    }
  };

  const chooseFile = async (): Promise<void> => {
    const p = await window.api.dialog.openSpreadsheet();
    if (p) await handlePath(p);
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const xlsx = files.find((f) => f.name.toLowerCase().endsWith('.xlsx'));
    if (!xlsx) {
      setError('Please drop a .xlsx file.');
      return;
    }
    const filePath = (xlsx as File & { path?: string }).path;
    if (!filePath) {
      setError('Could not read the dropped file path.');
      return;
    }
    await handlePath(filePath);
  };

  const submitManual = async (): Promise<void> => {
    if (!pendingPath) return;
    const m = manualDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) {
      setError('Enter a date as DD/MM/YYYY (for example, 22/05/2026).');
      return;
    }
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    await runParse(pendingPath, `${dd}/${mm}/${m[3]}`);
  };

  if (pendingPath && !busy) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="card">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-slate-900">Week ending date</h2>
          </div>
          <div className="space-y-4 p-6">
            <p className="text-sm text-slate-600">
              We couldn't read the week ending date from the filename{' '}
              <span className="font-medium text-slate-900">{pendingFilename}</span>.
              Please enter it manually.
            </p>
            <div>
              <label htmlFor="week-ending" className="label mb-1">
                Week ending (DD/MM/YYYY)
              </label>
              <input
                id="week-ending"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                placeholder="22/05/2026"
                className="input"
                autoFocus
              />
            </div>
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={submitManual} className="btn-primary">
                Parse spreadsheet
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingPath(null);
                  setPendingFilename(null);
                  setManualDate('');
                  setError(null);
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Upload spreadsheet</h1>
        <p className="mt-1 text-sm text-slate-600">
          Drop this week's <span className="font-mono">Week_ending_*.xlsx</span> file. Nothing leaves
          your computer until you confirm in the review step.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={[
          'flex h-72 flex-col items-center justify-center rounded-xl border-2 border-dashed bg-white p-6 text-center transition-colors',
          dragOver
            ? 'border-accent-500 bg-accent-50'
            : 'border-slate-300 hover:border-accent-400',
        ].join(' ')}
      >
        {busy ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-slate-700">Parsing spreadsheet…</div>
            <div className="text-xs text-slate-500">This usually takes a second or two.</div>
          </div>
        ) : (
          <>
            <div className="mb-3 text-sm font-medium text-slate-700">
              Drag and drop your .xlsx file here
            </div>
            <div className="mb-4 text-xs text-slate-500">— or —</div>
            <button type="button" onClick={() => void chooseFile()} className="btn-primary">
              Choose file
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
