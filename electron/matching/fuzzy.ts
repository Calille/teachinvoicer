import { ipcMain } from 'electron';
import Fuse from 'fuse.js';
import { fetchAllContacts } from '../xero/client';
import { getMappings } from '../store/index';
import type { MatchCandidate, SchoolMatchState, XeroContact } from '../../shared/types';

const AUTO_THRESHOLD = 0.9;
const FUSE_THRESHOLD = 0.4; // 0 = exact, 1 = anything

/**
 * Strips noise words and punctuation so 'The Hethersett Academy SB' and
 * 'Hethersett Academy' become comparable strings.
 */
function normaliseForMatching(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,'’()&/]/g, ' ')
    .replace(/\b(the|school|academy|primary|secondary|college|ce|vc|ve|cofe|c of e)\b/g, ' ')
    .replace(/\b[a-z]{1,3}\b\s*$/g, ' ') // strip short trailing tokens like ' SB'
    .replace(/\s+/g, ' ')
    .trim();
}

function schoolKeyOf(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

type IndexedContact = XeroContact & {
  normalised: string;
};

function buildIndex(contacts: XeroContact[]): {
  fuse: Fuse<IndexedContact>;
  byNormalised: Map<string, IndexedContact>;
} {
  const indexed = contacts.map<IndexedContact>((c) => ({
    ...c,
    normalised: normaliseForMatching(c.name),
  }));

  const fuse = new Fuse<IndexedContact>(indexed, {
    keys: [
      { name: 'normalised', weight: 0.7 },
      { name: 'name', weight: 0.3 },
    ],
    includeScore: true,
    threshold: FUSE_THRESHOLD,
    ignoreLocation: true,
    minMatchCharLength: 2,
    shouldSort: true,
  });

  const byNormalised = new Map<string, IndexedContact>();
  for (const c of indexed) byNormalised.set(c.normalised, c);
  return { fuse, byNormalised };
}

function findCandidates(
  schoolName: string,
  fuse: Fuse<IndexedContact>,
  byNormalised: Map<string, IndexedContact>,
): MatchCandidate[] {
  const normalisedQuery = normaliseForMatching(schoolName);

  // Exact normalised match → 1.0 confidence.
  const exact = byNormalised.get(normalisedQuery);
  if (exact) {
    return [{ contactID: exact.contactID, name: exact.name, score: 1 }];
  }

  const results = fuse.search(normalisedQuery, { limit: 3 });
  return results
    .filter((r) => r.item.contactID && r.item.name)
    .map((r) => ({
      contactID: r.item.contactID,
      name: r.item.name,
      // fuse score is "distance" — lower is better. Convert to similarity in [0, 1].
      score: Math.max(0, Math.min(1, 1 - (r.score ?? 1))),
    }));
}

export async function buildMatches(schoolNames: string[]): Promise<SchoolMatchState[]> {
  const contacts = await fetchAllContacts(false);
  const { fuse, byNormalised } = buildIndex(contacts);
  const mappings = getMappings();

  const seen = new Set<string>();
  const out: SchoolMatchState[] = [];

  for (const original of schoolNames) {
    const schoolKey = schoolKeyOf(original);
    if (seen.has(schoolKey)) continue;
    seen.add(schoolKey);

    const candidates = findCandidates(original, fuse, byNormalised);
    const saved = mappings[schoolKey];

    if (saved) {
      // Verify the saved contact still exists in Xero. If not, fall through to fresh matching.
      const stillExists = contacts.some((c) => c.contactID === saved.xeroContactId);
      if (stillExists) {
        out.push({
          schoolKey,
          schoolNameOriginal: original,
          candidates,
          selectedContactID: saved.xeroContactId,
          selectedContactName: saved.xeroContactName,
          fromSavedMapping: true,
          autoApplied: true,
          skipped: false,
        });
        continue;
      }
    }

    const top = candidates[0];
    if (top && top.score >= AUTO_THRESHOLD) {
      out.push({
        schoolKey,
        schoolNameOriginal: original,
        candidates,
        selectedContactID: top.contactID,
        selectedContactName: top.name,
        fromSavedMapping: false,
        autoApplied: true,
        skipped: false,
      });
    } else {
      out.push({
        schoolKey,
        schoolNameOriginal: original,
        candidates,
        selectedContactID: null,
        selectedContactName: null,
        fromSavedMapping: false,
        autoApplied: false,
        skipped: false,
      });
    }
  }
  return out;
}

export function registerMatchingIpc(): void {
  ipcMain.handle('matching:build-matches', (_e, schoolNames: string[]) =>
    buildMatches(schoolNames ?? []),
  );
}
