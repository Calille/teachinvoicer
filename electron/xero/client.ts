import { ipcMain } from 'electron';
import { getXeroClient } from './auth';
import type {
  DuplicateWarning,
  XeroAccountOption,
  XeroBrandingThemeOption,
  XeroContact,
} from '../../shared/types';
import { getContactsCache, setContactsCache } from '../store/index';

const CONTACTS_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Pages through every customer contact and returns a slim list usable by
 * the renderer. Cached in electron-store for up to one hour.
 */
export async function fetchAllContacts(forceRefresh = false): Promise<XeroContact[]> {
  if (!forceRefresh) {
    const cached = getContactsCache();
    if (cached && Date.now() - cached.fetchedAt < CONTACTS_TTL_MS) {
      return cached.contacts;
    }
  }

  const { client, tenantId } = await getXeroClient();

  const all: XeroContact[] = [];
  let page = 1;
  // Xero returns up to 100 contacts per page.
  // We stop when we receive fewer than 100 in a page.
  for (;;) {
    const res = await client.accountingApi.getContacts(
      tenantId,
      undefined,
      'IsCustomer==true',
      'Name ASC',
      undefined,
      page,
      false,
    );
    const batch = res.body.contacts ?? [];
    for (const c of batch) {
      if (c.contactID && c.name) {
        all.push({ contactID: c.contactID, name: c.name });
      }
    }
    if (batch.length < 100) break;
    page += 1;
    if (page > 200) break; // safety net (would mean 20k+ contacts)
  }

  setContactsCache({ contacts: all, fetchedAt: Date.now() });
  return all;
}

export async function fetchAccounts(): Promise<XeroAccountOption[]> {
  const { client, tenantId } = await getXeroClient();
  const res = await client.accountingApi.getAccounts(
    tenantId,
    undefined,
    'Type=="REVENUE"',
    'Code ASC',
  );
  return (res.body.accounts ?? [])
    .filter((a) => a.code && a.name)
    .map((a) => ({
      code: a.code as string,
      name: a.name as string,
      type: (a.type as unknown as string) ?? 'REVENUE',
    }));
}

export async function fetchBrandingThemes(): Promise<XeroBrandingThemeOption[]> {
  const { client, tenantId } = await getXeroClient();
  const res = await client.accountingApi.getBrandingThemes(tenantId);
  return (res.body.brandingThemes ?? [])
    .filter((t) => t.brandingThemeID && t.name)
    .map((t) => ({
      brandingThemeID: t.brandingThemeID as string,
      name: t.name as string,
    }));
}

/**
 * Query Xero for existing invoices with the given reference per contact.
 * Returns one warning per match. Best-effort — failures are swallowed.
 */
export async function checkDuplicateReferences(
  refs: Array<{ contactID: string; reference: string; schoolKey: string; schoolName: string }>,
): Promise<DuplicateWarning[]> {
  if (refs.length === 0) return [];

  const { client, tenantId } = await getXeroClient();

  const warnings: DuplicateWarning[] = [];
  // Group by unique reference (all our references will be the same, but
  // keep this generic in case the spec changes).
  const refsByValue = new Map<string, typeof refs>();
  for (const r of refs) {
    const list = refsByValue.get(r.reference) ?? [];
    list.push(r);
    refsByValue.set(r.reference, list);
  }

  for (const [reference, group] of refsByValue) {
    try {
      const safe = reference.replace(/"/g, '\\"');
      const where = `Reference=="${safe}"`;
      const res = await client.accountingApi.getInvoices(
        tenantId,
        undefined, // ifModifiedSince
        where,
        'Date DESC',
        undefined, // IDs
        undefined, // invoiceNumbers
        undefined, // contactIDs
        ['DRAFT', 'SUBMITTED', 'AUTHORISED'],
      );
      const invoices = res.body.invoices ?? [];
      const byContact = new Map<string, (typeof invoices)[number]>();
      for (const inv of invoices) {
        const cid = inv.contact?.contactID;
        if (cid && !byContact.has(cid)) byContact.set(cid, inv);
      }
      for (const r of group) {
        const dup = byContact.get(r.contactID);
        if (dup) {
          warnings.push({
            schoolKey: r.schoolKey,
            schoolName: r.schoolName,
            existingInvoiceNumber: dup.invoiceNumber ?? '(no number)',
            existingInvoiceID: dup.invoiceID ?? '',
            existingStatus: (dup.status as unknown as string) ?? 'DRAFT',
          });
        }
      }
    } catch {
      // Best-effort — leave duplicate check empty on error.
    }
  }
  return warnings;
}

export function registerXeroClientIpc(): void {
  ipcMain.handle('xero:list-contacts', (_e, force?: boolean) => fetchAllContacts(!!force));
  ipcMain.handle('xero:list-accounts', () => fetchAccounts());
  ipcMain.handle('xero:list-branding-themes', () => fetchBrandingThemes());
  ipcMain.handle('xero:check-duplicates', (_e, refs) => checkDuplicateReferences(refs));
}
