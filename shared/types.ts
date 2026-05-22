/**
 * Shared types between Electron main and React renderer.
 * Keep this file dependency-free.
 */

export type XeroConnection = {
  tenantId: string;
  tenantName: string;
  connectedAt: string;
};

export type ParsedLine = {
  rowNumber: number;
  school: string;
  teacher: string;
  notes: string | null;
  dailyCharge: number | null;
  weeklyCharge: number | null;
  fullDays: number;
  partDays: number;
  hours: number | null;
  isAwr: boolean;
  invoiceAmount: number;
  description: string;
};

export type ParsedInvoice = {
  schoolName: string;
  schoolNameOriginal: string;
  lines: ParsedLine[];
  totalAmount: number;
  lineCount: number;
};

export type ParseWarning = {
  rowNumber: number;
  school: string | null;
  reason: string;
};

export type ParseResult = {
  weekEndingDate: string; // DD/MM/YYYY
  filename: string;
  invoices: ParsedInvoice[];
  warnings: ParseWarning[];
  totals: {
    schoolCount: number;
    lineCount: number;
    grandTotal: number;
    skippedRowCount: number;
  };
};

export type XeroContact = {
  contactID: string;
  name: string;
};

export type MatchCandidate = {
  contactID: string;
  name: string;
  score: number; // 0..1, 1 = perfect match
};

export type SchoolMatchState = {
  schoolKey: string;
  schoolNameOriginal: string;
  candidates: MatchCandidate[];
  selectedContactID: string | null;
  selectedContactName: string | null;
  fromSavedMapping: boolean;
  autoApplied: boolean;
  skipped: boolean;
};

export type StoredMapping = {
  xeroContactId: string;
  xeroContactName: string;
  confirmedAt: string;
};

export type AppSettings = {
  accountCode: string | null;
  taxType: string;
  brandingThemeId: string | null;
  dryRunDefault: boolean;
  lineAmountTypes: 'Exclusive' | 'Inclusive' | 'NoTax';
};

export type XeroAccountOption = {
  code: string;
  name: string;
  type: string;
};

export type XeroBrandingThemeOption = {
  brandingThemeID: string;
  name: string;
};

export type PreparedInvoice = {
  schoolKey: string;
  schoolName: string;
  contactID: string;
  reference: string;
  date: string; // YYYY-MM-DD (today)
  dueDate: string; // YYYY-MM-DD (week ending + 14d)
  weekEnding: string; // DD/MM/YYYY for display
  total: number;
  lines: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    isAwr: boolean;
  }>;
};

export type InvoiceCreationResult =
  | {
      schoolKey: string;
      schoolName: string;
      ok: true;
      invoiceID: string;
      invoiceNumber: string;
      total: number;
      dryRun: boolean;
    }
  | {
      schoolKey: string;
      schoolName: string;
      ok: false;
      error: string;
      total: number;
      dryRun: boolean;
    };

export type RunRecord = {
  id: string;
  timestamp: string;
  weekEnding: string;
  spreadsheetFilename: string;
  invoicesCreated: number;
  totalAmount: number;
  failures: number;
  dryRun: boolean;
};

export type DuplicateWarning = {
  schoolKey: string;
  schoolName: string;
  existingInvoiceNumber: string;
  existingInvoiceID: string;
  existingStatus: string;
};

export type ConnectionStatus =
  | { connected: false }
  | {
      connected: true;
      tenantName: string;
      tenantId: string;
      expiresAt: number;
    };
