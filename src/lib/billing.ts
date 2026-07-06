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

function pence(n: number): number {
  return Math.round(n * 100);
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
 * The Xero invoice's line total is computed as `qty × unitAmount` at 2dp.
 * When a row's per-day rate doesn't divide cleanly (e.g. £387.50 / 3 =
 * £129.166…), naive rounding to 2dp loses a penny per line — so a row
 * totalling £387.50 on the spreadsheet would land in Xero as £387.51.
 *
 * Across 95 schools that drift accumulates into pounds, which is why Josh
 * was seeing the totals "out". We absorb the difference by adjusting the
 * line with the highest qty; if the difference can't be spread evenly into
 * that line's qty, we split it (qty-1 at the original rate + one unit
 * absorbing the remainder) so the final sum is exact to the penny.
 */
function reconcileToTarget(input: BillingLine[], target: number): BillingLine[] {
  if (input.length === 0) return input;

  const targetP = pence(target);
  const sumP = input.reduce((s, l) => s + pence(l.unitAmount) * l.quantity, 0);
  let diff = targetP - sumP;
  if (diff === 0) return input;

  // Pick the largest-qty line. Smallest per-unit adjustment goes here.
  let pickIdx = 0;
  for (let i = 1; i < input.length; i += 1) {
    if (input[i].quantity > input[pickIdx].quantity) pickIdx = i;
  }
  const pick = input[pickIdx];
  const qty = pick.quantity;

  // If the diff divides evenly into qty, just bump the unit.
  if (qty > 0 && diff % qty === 0) {
    const newUnitP = pence(pick.unitAmount) + diff / qty;
    return input.map((l, i) =>
      i === pickIdx ? { ...l, unitAmount: round2(newUnitP / 100) } : l,
    );
  }

  // Single-unit pick — just adjust its unit directly.
  if (qty <= 1) {
    return input.map((l, i) =>
      i === pickIdx
        ? { ...l, unitAmount: round2((pence(l.unitAmount) + diff) / 100) }
        : l,
    );
  }

  // Otherwise split the picked line: (qty-1) at the original rate plus a
  // single "tail" unit that takes the rounding hit. Both rates are at 2dp.
  const origUnitP = pence(pick.unitAmount);
  const headQty = qty - 1;
  const headUnitP = origUnitP;
  const headSum = headUnitP * headQty;

  // The other lines' contribution is unchanged.
  const otherSum = sumP - origUnitP * qty;
  const tailUnitP = targetP - otherSum - headSum;

  const out: BillingLine[] = [];
  for (let i = 0; i < input.length; i += 1) {
    if (i !== pickIdx) {
      out.push(input[i]);
      continue;
    }
    out.push({ ...pick, quantity: headQty, unitAmount: round2(headUnitP / 100) });
    out.push({ ...pick, quantity: 1, unitAmount: round2(tailUnitP / 100) });
  }
  return out;
}

/**
 * Convert a single parsed spreadsheet row into one or more Xero line items.
 *
 * - "5 full days at £155/day"    → 1 line:  qty=5 × £155.00
 * - "3 part days at £77.50/day"  → 1 line:  qty=3 × £77.50
 * - "4 full + 1 part day"        → 2 lines: qty=4 × £155.00 + qty=1 × £77.50
 * - "missing 1 hour" (no days)   → 1 line:  qty=1 × £16.82 (uses notes if present)
 *
 * The output is reconciled against the row's `invoiceAmount` so the sum of
 * qty × unit on the Xero invoice exactly matches the spreadsheet's total —
 * no penny drift.
 */
export function expandLine(line: ParsedLine): BillingLine[] {
  const { teacher, fullDays, partDays, invoiceAmount, dailyCharge, isAwr, notes } = line;
  const totalDays = fullDays + partDays;

  let raw: BillingLine[];

  if (totalDays === 0) {
    // No day counts: correction, one-off, or unusual row. Single line.
    const note = cleanNotes(notes);
    const suffix = note || 'Placement';
    raw = [
      {
        description: describe(teacher, suffix, isAwr),
        quantity: 1,
        unitAmount: round2(invoiceAmount),
        isAwr,
      },
    ];
  } else if (partDays === 0) {
    // Only full days. Prefer col G if the math agrees; else derive.
    const unit =
      dailyCharge !== null &&
      dailyCharge !== 0 &&
      Math.abs(fullDays * dailyCharge - invoiceAmount) < 0.005
        ? dailyCharge
        : invoiceAmount / fullDays;
    raw = [
      {
        description: describe(teacher, 'Full day', isAwr),
        quantity: fullDays,
        unitAmount: round2(unit),
        isAwr,
      },
    ];
  } else if (fullDays === 0) {
    // Only part days. Use col G only if the math agrees (col G is the
    // full-day rate, which usually won't match a part-only row).
    const unit =
      dailyCharge !== null &&
      dailyCharge !== 0 &&
      Math.abs(partDays * dailyCharge - invoiceAmount) < 0.005
        ? dailyCharge
        : invoiceAmount / partDays;
    raw = [
      {
        description: describe(teacher, 'Part day', isAwr),
        quantity: partDays,
        unitAmount: round2(unit),
        isAwr,
      },
    ];
  } else {
    // Mixed full + part. Use col G as the full-day rate and derive the
    // part-day rate from the remainder. If col G is missing OR derived
    // part rate would be implausible, fall back to "part = half full".
    let fullRate: number;
    let partRate: number;
    const derivedPart =
      dailyCharge !== null && dailyCharge !== 0
        ? (invoiceAmount - fullDays * dailyCharge) / partDays
        : null;
    const colGUsable =
      derivedPart !== null &&
      derivedPart >= -0.005 &&
      derivedPart <= (dailyCharge ?? 0) + 0.005;
    if (colGUsable && dailyCharge !== null) {
      fullRate = dailyCharge;
      partRate = derivedPart!;
    } else {
      fullRate = invoiceAmount / (fullDays + partDays / 2);
      partRate = fullRate / 2;
    }
    raw = [
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

  return reconcileToTarget(raw, invoiceAmount);
}

/**
 * Sum the (qty × unit) of a set of billing lines, at 2dp. Always equals the
 * source row's invoiceAmount because expandLine reconciles to it.
 */
export function sumLines(lines: BillingLine[]): number {
  return round2(
    lines.reduce((s, l) => s + pence(l.unitAmount) * l.quantity, 0) / 100,
  );
}
