/**
 * Renderer-visible API contract. Implemented by electron/preload.ts and
 * consumed by the React renderer via window.api.
 *
 * Keep this file dependency-free apart from shared/types.
 */
import type {
  AppSettings,
  ConnectionStatus,
  DuplicateWarning,
  InvoiceCreationResult,
  ParseResult,
  PreparedInvoice,
  RunRecord,
  SchoolMatchState,
  StoredMapping,
  XeroAccountOption,
  XeroBrandingThemeOption,
  XeroContact,
} from './types';

export interface BridgeApi {
  app: {
    version: () => Promise<string>;
    envInfo: () => Promise<{
      envPath: string | null;
      expectedPath: string;
      hasCredentials: boolean;
    }>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  dialog: {
    openSpreadsheet: () => Promise<string | null>;
  };
  xero: {
    status: () => Promise<ConnectionStatus>;
    connect: () => Promise<ConnectionStatus>;
    disconnect: () => Promise<void>;
    listAccounts: () => Promise<XeroAccountOption[]>;
    listBrandingThemes: () => Promise<XeroBrandingThemeOption[]>;
    listContacts: (force?: boolean) => Promise<XeroContact[]>;
    checkDuplicates: (
      references: Array<{ contactID: string; reference: string; schoolKey: string; schoolName: string }>,
    ) => Promise<DuplicateWarning[]>;
  };
  parser: {
    parseFile: (filePath: string, manualWeekEnding?: string | null) => Promise<ParseResult>;
  };
  matching: {
    buildMatches: (schoolNames: string[]) => Promise<SchoolMatchState[]>;
  };
  invoices: {
    create: (
      invoices: PreparedInvoice[],
      opts: {
        accountCode: string;
        taxType: string;
        brandingThemeId: string | null;
        lineAmountTypes: AppSettings['lineAmountTypes'];
        dryRun: boolean;
        weekEnding: string;
        spreadsheetFilename: string;
      },
    ) => Promise<InvoiceCreationResult[]>;
    retry: (
      invoice: PreparedInvoice,
      opts: {
        accountCode: string;
        taxType: string;
        brandingThemeId: string | null;
        lineAmountTypes: AppSettings['lineAmountTypes'];
        dryRun: boolean;
      },
    ) => Promise<InvoiceCreationResult>;
  };
  store: {
    getMappings: () => Promise<Record<string, StoredMapping>>;
    setMapping: (schoolKey: string, mapping: StoredMapping) => Promise<void>;
    deleteMapping: (schoolKey: string) => Promise<void>;
    getRuns: () => Promise<RunRecord[]>;
    getSettings: () => Promise<AppSettings>;
    updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
    resetAll: () => Promise<void>;
  };
  events: {
    onInvoiceProgress: (
      cb: (p: { index: number; total: number; school: string }) => void,
    ) => () => void;
    onMenu: (channel: 'menu:open-file' | 'menu:open-settings', cb: () => void) => () => void;
  };
}
