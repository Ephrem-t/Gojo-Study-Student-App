// Helper for global student lives (POC + transactional consume)
// Usage:
//  const lives = await getStudentLives(studentId)
//  const updated = await consumeLife(studentId)  // throws if not enough lives
import { ref, get, runTransaction } from "../../lib/offlineDatabase";
import { database } from "../../constants/firebaseConfig";

const DEFAULT_REFILL_INTERVAL_MS = 30 * 60 * 1000;

function toMsTs(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed < 1e12 ? parsed * 1000 : parsed;
}

function computeRefillState({ currentLives, maxLives, lastConsumedAt, refillMs, now = Date.now() }) {
  const current = Number(currentLives ?? 0);
  const max = Number(maxLives ?? 5);
  const last = Number(lastConsumedAt ?? 0);
  const interval = Math.max(DEFAULT_REFILL_INTERVAL_MS, Number(refillMs ?? 0));

  if (!interval || interval <= 0) return { currentLives: current, lastConsumedAt: last, recovered: 0, nextInMs: 0 };
  if (current >= max) return { currentLives: current, lastConsumedAt: last, recovered: 0, nextInMs: 0 };
  if (!last) return { currentLives: current, lastConsumedAt: now, recovered: 0, nextInMs: interval };

  const elapsed = Math.max(0, now - last);
  const recovered = Math.floor(elapsed / interval);
  const newCurrent = Math.min(max, current + Math.max(0, recovered));
  const newLast = recovered > 0 ? last + recovered * interval : last;
  const nextInMs = newCurrent >= max ? 0 : Math.max(0, interval - ((now - newLast) % interval));

  return { currentLives: newCurrent, lastConsumedAt: newLast, recovered, nextInMs };
}

function buildQueuedHeartConsumption({ currentLives, maxLives, lastConsumedAt, refillMs, now = Date.now() }) {
  const resolvedMaxLives = Math.max(1, Number(maxLives ?? 5));
  const normalizedState = computeRefillState({
    currentLives,
    maxLives: resolvedMaxLives,
    lastConsumedAt,
    refillMs,
    now,
  });
  const availableLives = Math.max(0, Number(normalizedState.currentLives || 0));

  if (availableLives <= 0) return null;

  return {
    currentLives: Math.max(0, availableLives - 1),
    maxLives: resolvedMaxLives,
    lastConsumedAt: availableLives >= resolvedMaxLives
      ? now
      : Number(normalizedState.lastConsumedAt || now),
  };
}

export async function getStudentLives(studentId) {
  if (!studentId) return null;
  try {
    const snap = await get(ref(database, `Platform1/studentLives/${studentId}`));
    if (snap && snap.exists()) return snap.val();
    const snap2 = await get(ref(database, `studentLives/${studentId}`));
    if (snap2 && snap2.exists()) return snap2.val();
    return null;
  } catch (e) {
    console.warn("getStudentLives error", e && e.message);
    return null;
  }
}

// Atomically consume a life. Returns the updated node value or throws when insufficient lives.
// Note: This runTransaction will create a default node if none exists (maxLives=5).
export async function consumeLife(studentId) {
  if (!studentId) throw new Error("studentId required");
  const nodeRef = ref(database, `Platform1/studentLives/${studentId}`);
  try {
    const result = await runTransaction(nodeRef, (curr) => {
      const now = Date.now();
      const defaultMax = 5;
      const refillIntervalMs = DEFAULT_REFILL_INTERVAL_MS;

      if (!curr) {
        // create default with one consumed
        return {
          maxLives: defaultMax,
          currentLives: Math.max(0, defaultMax - 1),
          lastConsumedAt: now,
          refillIntervalMs,
        };
      }

      const max = Number(curr.maxLives || defaultMax);
      const refill = Math.max(DEFAULT_REFILL_INTERVAL_MS, Number(curr.refillIntervalMs || refillIntervalMs));
      const consumedLives = buildQueuedHeartConsumption({
        currentLives: curr.currentLives ?? curr.current ?? max,
        maxLives: max,
        lastConsumedAt: toMsTs(curr.lastConsumedAt ?? curr.lastConsumed ?? 0),
        refillMs: refill,
        now,
      });

      if (!consumedLives) {
        // abort transaction by returning undefined
        return;
      }

      return {
        ...curr,
        currentLives: consumedLives.currentLives,
        lastConsumedAt: consumedLives.lastConsumedAt,
        refillIntervalMs: refill,
      };
    });

    if (!result.committed) throw new Error("Not enough lives");
    return result.snapshot.val();
  } catch (err) {
    // Rethrow for caller
    throw err;
  }
}