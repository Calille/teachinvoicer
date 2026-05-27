import { ipcMain } from 'electron';
import * as XLSX from 'xlsx';
import type { ParseResult, ParseWarning, ParsedLine } from '../../shared/types';
import { groupBySchool } from './normalise';

/**
 * Column indices in the data sheet. These match the spec (A=1 → JS index 0).
 */
const COL = {
  notes: 0, // A
  school: 1, // B
  frequency: 2, // C
  lea: 3, // D
  teacher: 4, // E
  dailyPay: 5, // F
  charge: 6, // G — daily charge
  niPandAl: 7, // H
  pct: 8, // I
  dGpm: 9, // J
  gpm: 10, // K
  wkPay: 11, // L
  wkChg: 12, // M — weekly charge (the invoice amount when present)
  sa: 13,
  mo: 14, // O
  tu: 15,
  we: 16,
  th: 17,
  fr: 18,
  fullDays: 19, // T
  partDays: 20, // U
  hours: 21, // V
  awr: 22, // W
} as const;

function safeString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function safeNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed || trimmed === '#DIV/0!' || trimmed === '#N/A' || trimmed === '#VALUE!') {
      return null;
    }
    const cleaned = trimmed.replace(/[£,$\s]/g, '');
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isAllNullOrEmpty(row: unknown[]): boolean {
  return row.every(
    (v) =>
      v === null ||
      v === undefined ||
      (typeof v === 'string' && v.trim() === ''),
  );
}

function isSectionHeader(row: unknown[]): boolean {
  // Header rows have literal 'Frequency' in col C and 'Teacher' in col E.
  const c = safeString(row[COL.frequency]).trim().toLowerCase();
  const e = safeString(row[COL.teacher]).trim().toLowerCase();
  return c === 'frequency' && e === 'teacher';
}

function normaliseSchoolKey(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const AWR_RE = /\(\s*awr\s*\)/i;

/**
 * Short summary of the spreadsheet row, used only for the Parse preview
 * screen. The actual invoice line descriptions are generated separately in
 * src/lib/billing.ts so we can split full/part days into their own line items
 * without the W/E (which is already on the invoice as the reference).
 */
function buildDescription(
  fullDays: number,
  partDays: number,
  isAwr: boolean,
): string {
  const parts: string[] = [];
  if (fullDays > 0) {
    parts.push(`${fullDays} full day${fullDays === 1 ? '' : 's'}`);
  }
  if (partDays > 0) {
    parts.push(`${partDays} part day${partDays === 1 ? '' : 's'}`);
  }
  const daysClause = parts.length > 0 ? parts.join(', ') : 'placement';
  const suffix = isAwr ? ' (AWR)' : '';
  return `${daysClause}${suffix}`;
}

/**
 * Parses a Week_ending_*.xlsx workbook into an array of ParsedLine objects,
 * plus warnings for rows that were intentionally skipped or look suspicious.
 */
export function parseWorkbook(
  filePath: string,
  _weekEndingDate: string,
): { lines: ParsedLine[]; warnings: ParseWarning[]; skippedCount: number } {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName =
    workbook.Sheets['Report'] !== undefined
      ? 'Report'
      : (workbook.SheetNames[0] ?? '');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error('No worksheet found in the spreadsheet.');
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: true,
    defval: null,
    raw: true,
  });

  const lines: ParsedLine[] = [];
  const warnings: ParseWarning[] = [];
  let skippedCount = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const rowNumber = i + 1; // 1-indexed to match spreadsheet display

    if (!row || row.length === 0 || isAllNullOrEmpty(row)) {
      skippedCount += 1;
      continue;
    }

    if (isSectionHeader(row)) {
      skippedCount += 1;
      continue;
    }

    const schoolRaw = safeString(row[COL.school]).trim();
    if (!schoolRaw) {
      // Footer / aggregate row — count but don't warn (these are very common).
      skippedCount += 1;
      continue;
    }

    const teacher = safeString(row[COL.teacher]).trim();
    if (!teacher) {
      // School row without a teacher: nothing to invoice. Note it.
      warnings.push({
        rowNumber,
        school: schoolRaw,
        reason: 'school row had no teacher in column E',
      });
      skippedCount += 1;
      continue;
    }

    const notesRaw = safeString(row[COL.notes]).trim();
    const notes = notesRaw || null;

    const weeklyCharge = safeNumber(row[COL.wkChg]);
    const dailyCharge = safeNumber(row[COL.charge]);

    let invoiceAmount: number | null = null;
    if (weeklyCharge !== null && weeklyCharge !== 0) {
      invoiceAmount = weeklyCharge;
    } else if (dailyCharge !== null && dailyCharge !== 0) {
      invoiceAmount = dailyCharge;
    } else if (weeklyCharge === 0 || dailyCharge === 0) {
      // Zero charge — skip but warn (spec: rows with zero amount).
      warnings.push({
        rowNumber,
        school: schoolRaw,
        reason: 'row has zero charge in columns G and M',
      });
      skippedCount += 1;
      continue;
    } else {
      // Neither column had a parseable number.
      warnings.push({
        rowNumber,
        school: schoolRaw,
        reason: 'no usable amount in columns G (Charge) or M (Wk/Chg)',
      });
      skippedCount += 1;
      continue;
    }

    const fullDaysRaw = safeNumber(row[COL.fullDays]);
    const partDaysRaw = safeNumber(row[COL.partDays]);
    const fullDays = fullDaysRaw !== null ? Math.round(fullDaysRaw) : 0;
    const partDays = partDaysRaw !== null ? Math.round(partDaysRaw) : 0;
    const hours = safeNumber(row[COL.hours]);

    const awrFromCol = safeString(row[COL.awr]).trim();
    const isAwr = AWR_RE.test(notesRaw) || (awrFromCol.length > 0 && AWR_RE.test(awrFromCol));

    const description = buildDescription(fullDays, partDays, isAwr);

    lines.push({
      rowNumber,
      school: schoolRaw.replace(/\s+/g, ' ').trim(),
      teacher,
      notes,
      dailyCharge,
      weeklyCharge,
      fullDays,
      partDays,
      hours,
      isAwr,
      invoiceAmount,
      description,
    });
  }

  return { lines, warnings, skippedCount };
}

function extractWeekEndingFromFilename(filename: string): string | null {
  const m = filename.match(
    /Week[_\s]*ending[_\s]*(\d+)(?:st|nd|rd|th)?[_\s]*([A-Za-z]+)[_\s]*(\d{4})/i,
  );
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

export function registerParserIpc(): void {
  ipcMain.handle(
    'parser:parse-file',
    async (_e, filePath: string, manualWeekEnding: string | null) => {
      const filename = filePath.split(/[\\/]/).pop() ?? filePath;
      const detected = extractWeekEndingFromFilename(filename);
      const weekEnding = manualWeekEnding ?? detected;
      if (!weekEnding) {
        throw new Error(
          `Couldn't read the week ending date from the filename "${filename}". Please enter it manually.`,
        );
      }
      const { lines, warnings, skippedCount } = parseWorkbook(filePath, weekEnding);
      const invoices = groupBySchool(lines);
      const grandTotal = invoices.reduce((sum, i) => sum + i.totalAmount, 0);
      const result: ParseResult = {
        weekEndingDate: weekEnding,
        filename,
        invoices,
        warnings,
        totals: {
          schoolCount: invoices.length,
          lineCount: lines.length,
          grandTotal,
          skippedRowCount: skippedCount,
        },
      };
      return result;
    },
  );
}
