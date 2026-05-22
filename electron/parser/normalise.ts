import type { ParsedInvoice, ParsedLine } from '../../shared/types';

function normaliseKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Groups parsed lines by school. Case-insensitive grouping, but the
 * first-seen original casing is preserved for display.
 */
export function groupBySchool(lines: ParsedLine[]): ParsedInvoice[] {
  const map = new Map<string, ParsedInvoice>();
  for (const line of lines) {
    const key = normaliseKey(line.school);
    const existing = map.get(key);
    if (existing) {
      existing.lines.push(line);
      existing.totalAmount = round2(existing.totalAmount + line.invoiceAmount);
      existing.lineCount += 1;
    } else {
      map.set(key, {
        schoolName: key,
        schoolNameOriginal: line.school.replace(/\s+/g, ' ').trim(),
        lines: [line],
        totalAmount: round2(line.invoiceAmount),
        lineCount: 1,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.schoolNameOriginal.localeCompare(b.schoolNameOriginal),
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
