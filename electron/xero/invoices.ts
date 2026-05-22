import { BrowserWindow, ipcMain } from 'electron';
import { Invoice, LineAmountTypes } from 'xero-node';
import type { Invoices, LineItem } from 'xero-node';
import { getXeroClient } from './auth';
import { appendRun } from '../store/index';
import type {
  AppSettings,
  InvoiceCreationResult,
  PreparedInvoice,
  RunRecord,
} from '../../shared/types';

type CreateOpts = {
  accountCode: string;
  taxType: string;
  brandingThemeId: string | null;
  lineAmountTypes: AppSettings['lineAmountTypes'];
  dryRun: boolean;
};

// Xero limit is 60 calls/min. We pace at ~1 call/second with retry on 429/5xx.
const THROTTLE_MS = 1100;
const MAX_RETRIES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as {
      response?: { statusCode?: number; body?: unknown };
      message?: string;
      statusCode?: number;
    };
    const status = e.response?.statusCode ?? e.statusCode;
    const body = e.response?.body;
    if (body && typeof body === 'object') {
      const b = body as {
        Message?: string;
        Elements?: Array<{ ValidationErrors?: Array<{ Message?: string }> }>;
      };
      const validation = b.Elements?.flatMap(
        (el) => el.ValidationErrors?.map((v) => v.Message ?? '') ?? [],
      ).filter(Boolean);
      if (validation && validation.length > 0) {
        return `${status ? `[${status}] ` : ''}${validation.join('; ')}`;
      }
      if (b.Message) return `${status ? `[${status}] ` : ''}${b.Message}`;
    }
    if (e.message) return `${status ? `[${status}] ` : ''}${e.message}`;
  }
  return String(err);
}

function isTransient(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as {
      response?: { statusCode?: number };
      statusCode?: number;
      code?: string;
    };
    const status = e.response?.statusCode ?? e.statusCode;
    if (status === 429) return true;
    if (status && status >= 500 && status < 600) return true;
    if (e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET' || e.code === 'EAI_AGAIN') return true;
  }
  return false;
}

function lineAmountTypesEnum(v: AppSettings['lineAmountTypes']): LineAmountTypes {
  switch (v) {
    case 'Inclusive':
      return LineAmountTypes.Inclusive;
    case 'NoTax':
      return LineAmountTypes.NoTax;
    case 'Exclusive':
    default:
      return LineAmountTypes.Exclusive;
  }
}

function buildPayload(prepared: PreparedInvoice, opts: CreateOpts): Invoices {
  const lineItems: LineItem[] = prepared.lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitAmount: l.unitAmount,
    accountCode: opts.accountCode,
    taxType: opts.taxType,
  }));

  const invoice: Invoice = {
    type: Invoice.TypeEnum.ACCREC,
    contact: { contactID: prepared.contactID },
    date: prepared.date,
    dueDate: prepared.dueDate,
    reference: prepared.reference,
    status: Invoice.StatusEnum.DRAFT,
    lineAmountTypes: lineAmountTypesEnum(opts.lineAmountTypes),
    lineItems,
  };
  if (opts.brandingThemeId) {
    invoice.brandingThemeID = opts.brandingThemeId;
  }
  return { invoices: [invoice] };
}

async function createOne(
  prepared: PreparedInvoice,
  opts: CreateOpts,
): Promise<InvoiceCreationResult> {
  if (opts.dryRun) {
    return {
      schoolKey: prepared.schoolKey,
      schoolName: prepared.schoolName,
      ok: true,
      invoiceID: 'dry-run',
      invoiceNumber: '[DRY RUN]',
      total: prepared.total,
      dryRun: true,
    };
  }

  const { client, tenantId } = await getXeroClient();
  const payload = buildPayload(prepared, opts);

  let attempt = 0;
  let lastError: unknown = null;
  while (attempt <= MAX_RETRIES) {
    try {
      const res = await client.accountingApi.createInvoices(
        tenantId,
        payload,
        false, // summarizeErrors — we want per-invoice errors back
        2, // unitdp: 2 decimal places for GBP
      );
      const created = res.body.invoices?.[0];
      if (!created || !created.invoiceID) {
        // The endpoint may still return validation errors here.
        const errs = created?.validationErrors?.map((v) => v.message).filter(Boolean);
        const msg = errs && errs.length > 0
          ? errs.join('; ')
          : 'Xero returned no invoice in the response.';
        return {
          schoolKey: prepared.schoolKey,
          schoolName: prepared.schoolName,
          ok: false,
          error: msg,
          total: prepared.total,
          dryRun: false,
        };
      }
      return {
        schoolKey: prepared.schoolKey,
        schoolName: prepared.schoolName,
        ok: true,
        invoiceID: created.invoiceID,
        invoiceNumber: created.invoiceNumber ?? '(no number)',
        total: prepared.total,
        dryRun: false,
      };
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || attempt === MAX_RETRIES) break;
      const backoff = Math.min(15_000, 1000 * 2 ** attempt);
      await sleep(backoff);
      attempt += 1;
    }
  }

  return {
    schoolKey: prepared.schoolKey,
    schoolName: prepared.schoolName,
    ok: false,
    error: describeError(lastError),
    total: prepared.total,
    dryRun: false,
  };
}

export function registerInvoiceIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(
    'invoices:create',
    async (
      _e,
      invoices: PreparedInvoice[],
      opts: CreateOpts & { weekEnding: string; spreadsheetFilename: string },
    ): Promise<InvoiceCreationResult[]> => {
      if (!opts.dryRun && (!opts.accountCode || opts.accountCode.length === 0)) {
        throw new Error('Cannot create invoices without a revenue account code.');
      }

      const results: InvoiceCreationResult[] = [];
      const win = () => getMainWindow();

      for (let i = 0; i < invoices.length; i += 1) {
        const prepared = invoices[i];
        win()?.webContents.send('invoices:progress', {
          index: i + 1,
          total: invoices.length,
          school: prepared.schoolName,
        });
        const res = await createOne(prepared, opts);
        results.push(res);
        if (i < invoices.length - 1 && !opts.dryRun) {
          await sleep(THROTTLE_MS);
        }
      }

      const successes = results.filter((r) => r.ok).length;
      const failures = results.length - successes;
      const total = results.filter((r) => r.ok).reduce((sum, r) => sum + r.total, 0);

      const run: RunRecord = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        weekEnding: opts.weekEnding,
        spreadsheetFilename: opts.spreadsheetFilename,
        invoicesCreated: successes,
        totalAmount: total,
        failures,
        dryRun: opts.dryRun,
      };
      appendRun(run);
      return results;
    },
  );

  ipcMain.handle(
    'invoices:retry',
    async (
      _e,
      invoice: PreparedInvoice,
      opts: CreateOpts,
    ): Promise<InvoiceCreationResult> => {
      if (!opts.dryRun && (!opts.accountCode || opts.accountCode.length === 0)) {
        throw new Error('Cannot retry without a revenue account code.');
      }
      return await createOne(invoice, opts);
    },
  );
}
