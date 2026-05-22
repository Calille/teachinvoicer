import Store from 'electron-store';
import { app } from 'electron';
import { createHash } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import type { AppSettings, RunRecord, StoredMapping, XeroContact } from '../../shared/types';

export type StoreSchema = {
  xero: {
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: number; // epoch ms
    tenantId: string;
    tenantName: string;
  } | null;

  mappings: Record<string, StoredMapping>;

  contactsCache: {
    contacts: XeroContact[];
    fetchedAt: number;
  } | null;

  settings: AppSettings;

  runs: RunRecord[];
};

const defaults: StoreSchema = {
  xero: null,
  mappings: {},
  contactsCache: null,
  settings: {
    accountCode: null,
    taxType: 'NONE',
    brandingThemeId: null,
    dryRunDefault: true,
    lineAmountTypes: 'Exclusive',
  },
  runs: [],
};

/**
 * Build a stable encryption key from machine-specific values.
 * Not a true secret (anyone with code + machine can derive it), but obscures
 * the stored tokens against casual file inspection.
 */
function deriveEncryptionKey(): string {
  const seed = [
    'xero-invoicer-v1',
    hostname(),
    userInfo().username,
    app.getPath('userData'),
  ].join('|');
  return createHash('sha256').update(seed).digest('hex');
}

let store: Store<StoreSchema> | null = null;

export function getStore(): Store<StoreSchema> {
  if (!store) {
    store = new Store<StoreSchema>({
      name: 'xero-invoicer',
      defaults,
      encryptionKey: deriveEncryptionKey(),
      clearInvalidConfig: true,
    });
  }
  return store;
}

// Convenience accessors -----------------------------------------------------

export function getXeroTokens(): StoreSchema['xero'] {
  return getStore().get('xero');
}

export function setXeroTokens(value: StoreSchema['xero']): void {
  getStore().set('xero', value);
}

export function getMappings(): Record<string, StoredMapping> {
  return getStore().get('mappings');
}

export function setMapping(schoolKey: string, mapping: StoredMapping): void {
  const all = getMappings();
  all[schoolKey] = mapping;
  getStore().set('mappings', all);
}

export function deleteMapping(schoolKey: string): void {
  const all = getMappings();
  delete all[schoolKey];
  getStore().set('mappings', all);
}

export function getContactsCache(): StoreSchema['contactsCache'] {
  return getStore().get('contactsCache');
}

export function setContactsCache(value: StoreSchema['contactsCache']): void {
  getStore().set('contactsCache', value);
}

export function getSettings(): AppSettings {
  return getStore().get('settings');
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch };
  getStore().set('settings', next);
  return next;
}

export function getRuns(): RunRecord[] {
  return getStore().get('runs');
}

export function appendRun(run: RunRecord): void {
  const runs = getRuns();
  runs.unshift(run);
  getStore().set('runs', runs.slice(0, 50));
}

export function resetAll(): void {
  getStore().clear();
}
