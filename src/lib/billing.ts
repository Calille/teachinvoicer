import type { ParsedLine } from '../../shared/types';

export type BillingLine = {
  description: string;
  quantity: number;
  unitAmount: number;
  isAwr: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function cleanTeacher(teacher: string): string {
  return teacher.replace(/\s+/g, ' ').trim();
}

/**
 * Strip an already-present "(AWR)" tag from a notes string so we don't
 * double-flag it when isAwr is true and the suffix is added separately.
 */
function cleanNotes(notes: string | null): string {
  if (!notes) return '';
  return notes
    .replace(/\(\s*awr\s*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function describe(teacher: string, suffix: string, isAwr: boolean): string {
  const t = cleanTeacher(teacher);
  const awr = isAwr ? ' (AWR)' : '';
  return suffix ? `${t} — ${suffix}${awr}` : `${t}${awr}`;
}

/**
 * Convert a single parsed spreadsheet row into one or more Xero line items.
 *
 * - "5 full days at £155/day"    → 1 line:  qty=5 × £155.00
 * - "3 part days at £77.50/day"  → 1 line:  qty=3 × £77.50
 * - "4 full + 1 part day"        → 2 lines: qty=4 × £155.00 + qty=1 × £77.50
 * - "missing 1 hour" (no days)   → 1 line:  qty=1 × £16.82 (uses notes if present)
 *
 * The week ending date is intentionally omitted — it's already the invoice's
 * reference shown at the top of the document.
 */
export function expandLine(line: ParsedLine): BillingLine[] {
  const { teacher, fullDays, partDays, invoiceAmount, dailyCharge, isAwr, notes } = line;
  const totalDays = fullDays + partDays;

  // No day counts: correction, one-off, or unusual row. Single line.
  if (totalDays === 0) {
    const note = cleanNotes(notes);
    const suffix = note || 'Placement';
    return [
      {
        description: describe(teacher, suffix, isAwr),
        quantity: 1,
        unitAmount: round2(invoiceAmount),
        isAwr,
      },
    ];
  }

  // Only full days. Use col G if math agrees, else derive.
  if (partDays === 0) {
    const unit =
      dailyCharge !== null &&
      dailyCharge !== 0 &&
      Math.abs(fullDays * dailyCharge - invoiceAmount) < 0.005
        ? dailyCharge
        : invoiceAmount / fullDays;
    return [
      {
        description: describe(teacher, 'Full day', isAwr),
        quantity: fullDays,
        unitAmount: round2(unit),
        isAwr,
      },
    ];
  }

  // Only part days. Use col G if math agrees, else derive.
  if (fullDays === 0) {
    const unit =
      dailyCharge !== null &&
      dailyCharge !== 0 &&
      Math.abs(partDays * dailyCharge - invoiceAmount) < 0.005
        ? dailyCharge
        : invoiceAmount / partDays;
    return [
      {
        description: describe(teacher, 'Part day', isAwr),
        quantity: partDays,
        unitAmount: round2(unit),
        isAwr,
      },
    ];
  }

  // Mixed full + part days in a single row. Always split into two line items.
  // Preferred path: use col G as the full-day rate and derive the part-day
  // rate from the remainder. Fallback when col G is missing: assume part days
  // bill at half the full-day rate (the usual UK supply teacher convention).
  let fullRate: number;
  let partRate: number;
  if (dailyCharge !== null && dailyCharge !== 0) {
    fullRate = dailyCharge;
    partRate = (invoiceAmount - fullDays * dailyCharge) / partDays;
  } else {
    fullRate = invoiceAmount / (fullDays + partDays / 2);
    partRate = fullRate / 2;
  }

  return [
    {
      description: describe(teacher, 'Full day', isAwr),
      quantity: fullDays,
      unitAmount: round2(fullRate),
      isAwr,
    },
    {
      description: describe(teacher, 'Part day', isAwr),
      quantity: partDays,
      unitAmount: round2(partRate),
      isAwr,
    },
  ];
}
