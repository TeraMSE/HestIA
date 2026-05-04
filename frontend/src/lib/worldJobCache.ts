const STORAGE_KEY = "hestia_3d_jobs";

type Cache = Record<string, Record<string, string>>;

function readCache(): Cache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Cache;
  } catch {
    return {};
  }
}

function writeCache(cache: Cache): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage quota exceeded or unavailable — silently skip
  }
}

export function getJobId(
  userId: string | number,
  propertyId: string | number
): string | null {
  const cache = readCache();
  return cache[String(userId)]?.[String(propertyId)] ?? null;
}

export function saveJobId(
  userId: string | number,
  propertyId: string | number,
  jobId: string
): void {
  const cache = readCache();
  const uid = String(userId);
  if (!cache[uid]) cache[uid] = {};
  cache[uid][String(propertyId)] = jobId;
  writeCache(cache);
}

export function clearJobForProperty(
  userId: string | number,
  propertyId: string | number
): void {
  const cache = readCache();
  const uid = String(userId);
  if (cache[uid]) {
    delete cache[uid][String(propertyId)];
    writeCache(cache);
  }
}
