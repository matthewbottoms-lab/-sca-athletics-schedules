// Private-to-this-browser approvals. No request is sent to a server.
// Entries are keyed to exact issue signatures and ISO Monday dates.
export const STORAGE_KEY = 'sca-ad-weekly-approved-exceptions-v1';

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function readApprovals(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(item =>
      isRecord(item) && /^[a-f0-9]{64}$/.test(item.id) && /^\d{4}-\d{2}-\d{2}$/.test(item.week)
    );
  } catch {
    return [];
  }
}

export function storageAvailable(storage) {
  try {
    const testKey = `${STORAGE_KEY}-test`;
    storage.setItem(testKey, '1');
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function write(storage, entries) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({version:1,entries}));
    return true;
  } catch {
    return false;
  }
}

export function saveApproval(storage, id, week, approve) {
  const entries = readApprovals(storage).filter(item => item.id !== id);
  if (approve) entries.push({id, week});
  return write(storage, entries);
}

export function reconcileWeek(storage, week, currentIds) {
  const entries = readApprovals(storage);
  // Forget approvals for issues that have actually disappeared from this week's refreshed data.
  // Keep other weeks intact when browsing different dates.
  const retained = entries.filter(item => item.week !== week || currentIds.has(item.id));
  if (retained.length !== entries.length) write(storage, retained);
  return new Set(retained.map(item => item.id));
}
