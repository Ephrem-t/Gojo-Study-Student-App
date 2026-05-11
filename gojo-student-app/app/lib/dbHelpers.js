// Lightweight firebase realtime helpers used across screens.
//
// Usage:
//   const val = await getValue(['Platform1/studentLives/abc']);
//   const snap = await getSnapshot(['Platform1/companyExams/packages']);
//   const newKey = await pushAndSet('Platform1/attempts/company/uid/examId', attemptObj);
//   await runTransactionSafe('Platform1/studentProgress/uid/company/rid/examId/attemptsUsed', curr => Number(curr||0)+1);
//
// Keeps consistent semantics: getValue returns plain object or null, getSnapshot returns snapshot or null.
import { get, ref, runTransaction, push, set, update } from "../../lib/offlineDatabase";
import { database } from "../../constants/firebaseConfig";

const CACHE_AGE_BY_MATCHER = [
  { match: (path) => path.includes("schoolCodeIndex/"), maxAgeMs: 24 * 60 * 60 * 1000 },
  { match: (path) => path === "Platform1/Schools" || path === "Schools", maxAgeMs: 30 * 60 * 1000 },
  { match: (path) => path.includes("/questionBanks") || path.startsWith("questionBanks"), maxAgeMs: 30 * 60 * 1000 },
  { match: (path) => path.includes("companyExams/packages") || path.includes("companyExams/exams") || path === "Platform1/companyExams/packages" || path === "companyExams/packages", maxAgeMs: 10 * 60 * 1000 },
  { match: (path) => path.includes("appConfig/exams"), maxAgeMs: 10 * 60 * 1000 },
  { match: (path) => path.includes("examNotifications"), maxAgeMs: 2 * 60 * 1000 },
  { match: (path) => path.includes("usersMeta/"), maxAgeMs: 2 * 60 * 1000 },
  { match: (path) => path.includes("studentProgress/"), maxAgeMs: 30 * 1000 },
  { match: (path) => path.includes("studentLives/"), maxAgeMs: 15 * 1000 },
];

function resolveCacheMaxAge(paths, explicitMaxAgeMs = null) {
  if (Number.isFinite(Number(explicitMaxAgeMs)) && Number(explicitMaxAgeMs) >= 0) {
    return Number(explicitMaxAgeMs);
  }

  let resolved = 0;
  for (const rawPath of paths || []) {
    const path = String(rawPath || "").replace(/^\/+|\/+$/g, "");
    const match = CACHE_AGE_BY_MATCHER.find((entry) => entry.match(path));
    if (match) {
      resolved = Math.max(resolved, Number(match.maxAgeMs || 0));
    }
  }
  return resolved;
}

/**
 * Return the plain JS value for the first existing path.
 * Returns null when not found.
 */
export async function getValue(paths, options = {}) {
  const maxAgeMs = resolveCacheMaxAge(paths, options?.maxAgeMs);
  for (const p of paths) {
    try {
      const snap = await get(ref(database, p), maxAgeMs > 0 ? { maxAgeMs } : null);
      if (snap && snap.exists()) return snap.val();
    } catch (_e) {
      // ignore and continue
    }
  }
  return null;
}

/**
 * Return the snapshot for the first existing path (or null).
 */
export async function getSnapshot(paths, options = {}) {
  const maxAgeMs = resolveCacheMaxAge(paths, options?.maxAgeMs);
  for (const p of paths) {
    try {
      const snap = await get(ref(database, p), maxAgeMs > 0 ? { maxAgeMs } : null);
      if (snap && snap.exists()) return snap;
    } catch (_e) {
      // ignore
    }
  }
  return null;
}

export async function resolveSchoolKeyFromStudentId(studentId) {
  const normalizedStudentId = String(studentId || "").trim();
  if (!normalizedStudentId) return null;

  const schoolCodePrefix = normalizedStudentId.slice(0, 3).toUpperCase();
  if (!schoolCodePrefix) return null;

  const resolvedSchoolKey = await getValue([
    `Platform1/schoolCodeIndex/${schoolCodePrefix}`,
    `schoolCodeIndex/${schoolCodePrefix}`,
  ], { maxAgeMs: 24 * 60 * 60 * 1000 });

  return resolvedSchoolKey ? String(resolvedSchoolKey).trim() : null;
}

/**
 * Safe transaction helper. updater receives currentValue and must return new value.
 * Example: await runTransactionSafe('Platform1/studentLives/uid/currentLives', curr => Math.max(0, (curr||0)-1));
 */
export async function runTransactionSafe(path, updater) {
  const nodeRef = ref(database, path);
  return runTransaction(nodeRef, (current) => {
    try {
      return updater(current);
    } catch (_e) {
      return current;
    }
  });
}

/**
 * Push and set helper that returns key.
 */
export async function pushAndSet(basePath, value) {
  const newRef = push(ref(database, basePath));
  const newKey = newRef.key;
  await set(ref(database, `${basePath}/${newKey}`), value);
  return newKey;
}

/**
 * Atomic update map
 */
export async function safeUpdate(patch) {
  return update(ref(database), patch);
}