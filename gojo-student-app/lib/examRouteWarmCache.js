const ENTRY_TTL_MS = 5 * 60 * 1000;
const warmRouteEntries = new Map();

function buildEntryKey(roundId, examId) {
  const normalizedRoundId = String(roundId || "").trim();
  const normalizedExamId = String(examId || "").trim();
  if (!normalizedRoundId && !normalizedExamId) return "";
  return `${normalizedRoundId}::${normalizedExamId}`;
}

function cloneValue(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function pruneExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of warmRouteEntries.entries()) {
    if (!entry?.savedAt || now - entry.savedAt > ENTRY_TTL_MS) {
      warmRouteEntries.delete(key);
    }
  }
}

function mergeObjectLike(existingValue, incomingValue) {
  if (incomingValue == null) return cloneValue(existingValue);
  if (Array.isArray(incomingValue) || typeof incomingValue !== "object") {
    return cloneValue(incomingValue);
  }

  const existingObject = existingValue && typeof existingValue === "object" && !Array.isArray(existingValue)
    ? existingValue
    : {};

  return {
    ...cloneValue(existingObject),
    ...cloneValue(incomingValue),
  };
}

export function seedExamCenterWarmRoute({ roundId, examId, data = {} }) {
  pruneExpiredEntries();

  const entryKey = buildEntryKey(roundId, examId);
  if (!entryKey) return null;

  const existingData = warmRouteEntries.get(entryKey)?.data || {};
  const nextData = {
    ...cloneValue(existingData),
    ...cloneValue(data),
    roundMeta: mergeObjectLike(existingData.roundMeta, data.roundMeta),
    examMeta: mergeObjectLike(existingData.examMeta, data.examMeta),
    appExamConfig: mergeObjectLike(existingData.appExamConfig, data.appExamConfig),
    questions: Array.isArray(data.questions)
      ? cloneValue(data.questions)
      : Array.isArray(existingData.questions)
      ? cloneValue(existingData.questions)
      : [],
  };

  warmRouteEntries.set(entryKey, {
    savedAt: Date.now(),
    data: nextData,
  });

  return cloneValue(nextData);
}

export function peekExamCenterWarmRoute({ roundId, examId }) {
  pruneExpiredEntries();

  const entryKey = buildEntryKey(roundId, examId);
  if (!entryKey) return null;

  const entry = warmRouteEntries.get(entryKey);
  if (!entry?.data) return null;

  return cloneValue(entry.data);
}