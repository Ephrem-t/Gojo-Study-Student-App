import AsyncStorage from "@react-native-async-storage/async-storage";
import { get, ref } from "./offlineDatabase";
import { database } from "../constants/firebaseConfig";

const QUESTION_BANK_CACHE_PREFIX = "questionBankCache:v1";
const PRACTICE_EXAM_BUNDLE_PREFIX = "practiceExamBundle:v1";
const PRACTICE_EXAM_PROGRESS_PREFIX = "practiceExamProgress:v1";
const PRACTICE_LIVES_PREFIX = "practiceExamLives:v1";
const COMPANY_EXAM_PACKAGE_CATALOG_PREFIX = "companyExamPackageCatalog:v1";
const COMPANY_EXAM_PACKAGE_DETAIL_PREFIX = "companyExamPackageDetail:v1";

const DEFAULT_MAX_LIVES = 5;
const DEFAULT_REFILL_MS = 30 * 60 * 1000;

function normalizeId(value, fallback = "") {
  return String(value || fallback || "").trim();
}

function normalizeCacheToken(value, fallback = "all") {
  return String(value || fallback || "").trim().toLowerCase() || fallback;
}

export function getQuestionBankCacheKey(qbId) {
  return `${QUESTION_BANK_CACHE_PREFIX}:${normalizeId(qbId)}`;
}

export function getPracticeExamBundleKey(studentId, examId) {
  return `${PRACTICE_EXAM_BUNDLE_PREFIX}:${normalizeId(studentId, "anon")}:${normalizeId(examId)}`;
}

export function getPracticeExamProgressKey(studentId, examId) {
  return `${PRACTICE_EXAM_PROGRESS_PREFIX}:${normalizeId(studentId, "anon")}:${normalizeId(examId)}`;
}

export function getPracticeLivesKey(studentId) {
  return `${PRACTICE_LIVES_PREFIX}:${normalizeId(studentId, "anon")}`;
}

export function getCompanyExamPackageCatalogKey(grade) {
  return `${COMPANY_EXAM_PACKAGE_CATALOG_PREFIX}:${normalizeCacheToken(grade, "all")}`;
}

export function getCompanyExamPackageDetailKey(packageId) {
  return `${COMPANY_EXAM_PACKAGE_DETAIL_PREFIX}:${normalizeId(packageId)}`;
}

export async function readJsonCache(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function writeJsonCache(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function deleteJsonCache(key) {
  try {
    await AsyncStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export async function readCompanyExamPackageCatalog(grade) {
  const cached = await readJsonCache(getCompanyExamPackageCatalogKey(grade));
  return Array.isArray(cached?.packages) ? cached.packages : [];
}

export async function writeCompanyExamPackageCatalog(grade, packages) {
  const normalizedPackages = Array.isArray(packages) ? packages : [];
  await writeJsonCache(getCompanyExamPackageCatalogKey(grade), {
    savedAt: Date.now(),
    gradeKey: normalizeCacheToken(grade, "all"),
    packages: normalizedPackages,
  });
  return normalizedPackages;
}

export async function readCompanyExamPackageDetail(packageId) {
  if (!packageId) return null;

  const cached = await readJsonCache(getCompanyExamPackageDetailKey(packageId));
  if (!cached || typeof cached !== "object") return null;

  return {
    savedAt: Number(cached.savedAt || 0),
    pkg: cached.pkg && typeof cached.pkg === "object" ? cached.pkg : null,
    examMap: cached.examMap && typeof cached.examMap === "object" ? cached.examMap : {},
    appExamConfig: cached.appExamConfig && typeof cached.appExamConfig === "object" ? cached.appExamConfig : null,
  };
}

export async function writeCompanyExamPackageDetail(packageId, detail = {}) {
  if (!packageId) return null;

  const normalized = {
    savedAt: Date.now(),
    pkg: detail.pkg && typeof detail.pkg === "object" ? detail.pkg : null,
    examMap: detail.examMap && typeof detail.examMap === "object" ? detail.examMap : {},
    appExamConfig: detail.appExamConfig && typeof detail.appExamConfig === "object" ? detail.appExamConfig : null,
  };

  await writeJsonCache(getCompanyExamPackageDetailKey(packageId), normalized);
  return normalized;
}

async function readFirstExistingValue(paths, options = null) {
  for (const path of paths || []) {
    try {
      const snapshot = await get(ref(database, path), options);
      if (snapshot?.exists()) return snapshot.val();
    } catch {}
  }
  return null;
}

function normalizePracticeProgress(progress = null) {
  const source = progress && typeof progress === "object" ? progress : {};
  const attempts = source.attempts && typeof source.attempts === "object" ? source.attempts : {};
  const normalizedAttempts = Object.entries(attempts || {}).map(([id, attempt]) => ({ id, ...(attempt || {}) }));
  const completedAttempts = normalizedAttempts
    .filter((attempt) => String(attempt.attemptStatus || "").toLowerCase() === "completed");
  const latestAttempt = normalizedAttempts
    .slice()
    .sort((left, right) => Number(right.endTime || right.startTime || 0) - Number(left.endTime || left.startTime || 0))[0] || null;
  const highestAttemptNo = normalizedAttempts.reduce((highest, attempt) => {
    const parsedAttemptNo = Number(attempt?.attemptNo);
    if (!Number.isFinite(parsedAttemptNo)) return highest;
    return Math.max(highest, parsedAttemptNo);
  }, 0);
  const normalizedAttemptsUsed = Math.max(
    0,
    Number(source.attemptsUsed || 0),
    normalizedAttempts.length,
    highestAttemptNo
  );
  const latestCompleted = completedAttempts
    .sort((left, right) => Number(right.endTime || right.startTime || 0) - Number(left.endTime || left.startTime || 0))[0] || null;
  const highestCompletedScorePercent = completedAttempts.reduce((highest, attempt) => {
    const parsedScorePercent = Number(attempt?.scorePercent);
    if (!Number.isFinite(parsedScorePercent)) return highest;
    if (highest == null) return parsedScorePercent;
    return Math.max(highest, parsedScorePercent);
  }, null);

  let normalizedBestScorePercent = 0;
  if (source.bestScorePercent != null) {
    const parsedBestScorePercent = Number(source.bestScorePercent);
    normalizedBestScorePercent = Number.isFinite(parsedBestScorePercent) ? parsedBestScorePercent : 0;
  }
  if (highestCompletedScorePercent != null) {
    normalizedBestScorePercent = Math.max(normalizedBestScorePercent, highestCompletedScorePercent);
  }

  let normalizedLastScorePercent = null;
  if (source.lastScorePercent != null) {
    const parsedLastScorePercent = Number(source.lastScorePercent);
    normalizedLastScorePercent = Number.isFinite(parsedLastScorePercent) ? parsedLastScorePercent : null;
  } else if (latestCompleted?.scorePercent != null) {
    const parsedLatestCompletedPercent = Number(latestCompleted.scorePercent);
    normalizedLastScorePercent = Number.isFinite(parsedLatestCompletedPercent) ? parsedLatestCompletedPercent : null;
  }
  if (normalizedLastScorePercent != null || highestCompletedScorePercent != null || source.bestScorePercent != null) {
    normalizedLastScorePercent = Math.max(Number(normalizedLastScorePercent ?? 0), normalizedBestScorePercent);
  }

  return {
    savedAt: Number(source.savedAt || 0),
    status: String(
      source.status ||
      (normalizedAttempts.some((attempt) => String(attempt.attemptStatus || "").toLowerCase() === "in_progress")
        ? "in_progress"
        : latestCompleted
        ? "completed"
        : "idle")
    ),
    attemptsUsed: normalizedAttemptsUsed,
    lastAttemptTimestamp: Number(
      source.lastAttemptTimestamp ||
      source.lastSubmittedAt ||
      latestAttempt?.endTime ||
      latestAttempt?.startTime ||
      0
    ),
    lastSubmittedAt: Number(source.lastSubmittedAt || 0),
    lastScorePercent: normalizedLastScorePercent,
    bestScorePercent: normalizedBestScorePercent,
    lastAttemptId: source.lastAttemptId || latestAttempt?.id || null,
    attempts,
  };
}

function normalizePracticeLives(lives = null, defaults = {}) {
  const source = lives && typeof lives === "object" ? lives : {};
  const defaultMaxLives = Math.max(1, Number(defaults.defaultMaxLives || DEFAULT_MAX_LIVES));
  let refillIntervalMs = Number(source.refillIntervalMs || source.refillInterval || defaults.defaultRefillIntervalMs || DEFAULT_REFILL_MS);
  if (!Number.isFinite(refillIntervalMs) || refillIntervalMs <= 0) refillIntervalMs = DEFAULT_REFILL_MS;
  refillIntervalMs = Math.max(DEFAULT_REFILL_MS, refillIntervalMs);

  return {
    currentLives: Math.max(0, Number(source.currentLives ?? source.lives ?? defaultMaxLives)),
    maxLives: Math.max(1, Number(source.maxLives ?? source.max ?? defaultMaxLives)),
    refillIntervalMs,
    lastConsumedAt: Number(source.lastConsumedAt || source.lastConsumed || 0),
  };
}

export function createLocalAttemptId() {
  return `local_attempt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function readPracticeExamBundle(studentId, examId) {
  return readJsonCache(getPracticeExamBundleKey(studentId, examId));
}

export async function writePracticeExamBundle(studentId, examId, bundle) {
  const normalizedBundle = {
    ...(bundle || {}),
    savedAt: Date.now(),
    downloadedAt: Number(bundle?.downloadedAt || Date.now()),
  };
  await writeJsonCache(getPracticeExamBundleKey(studentId, examId), normalizedBundle);
  return normalizedBundle;
}

export async function deletePracticeExamBundle(studentId, examId) {
  return deleteJsonCache(getPracticeExamBundleKey(studentId, examId));
}

export async function hasPracticeExamBundle(studentId, examId) {
  const bundle = await readPracticeExamBundle(studentId, examId);
  return !!(bundle?.questions && Array.isArray(bundle.questions) && bundle.questions.length);
}

export async function readPracticeExamProgress(studentId, examId) {
  const progress = await readJsonCache(getPracticeExamProgressKey(studentId, examId));
  return normalizePracticeProgress(progress);
}

export async function writePracticeExamProgress(studentId, examId, progress) {
  const normalizedProgress = normalizePracticeProgress({
    ...(progress || {}),
    savedAt: Date.now(),
  });
  await writeJsonCache(getPracticeExamProgressKey(studentId, examId), normalizedProgress);
  return normalizedProgress;
}

export async function updatePracticeExamProgress(studentId, examId, updater) {
  const current = await readPracticeExamProgress(studentId, examId);
  const cloned = {
    ...current,
    attempts: { ...(current.attempts || {}) },
  };
  const next = typeof updater === "function" ? await updater(cloned) : cloned;
  return writePracticeExamProgress(studentId, examId, next || cloned);
}

export async function readPracticeLives(studentId, defaults = {}) {
  const lives = await readJsonCache(getPracticeLivesKey(studentId));
  return normalizePracticeLives(lives, defaults);
}

export async function ensurePracticeLives(studentId, defaults = {}) {
  const existing = await readJsonCache(getPracticeLivesKey(studentId));
  if (existing && typeof existing === "object") {
    const normalizedExisting = normalizePracticeLives(existing, defaults);
    await writeJsonCache(getPracticeLivesKey(studentId), normalizedExisting);
    return normalizedExisting;
  }

  const initial = normalizePracticeLives(null, defaults);
  await writeJsonCache(getPracticeLivesKey(studentId), initial);
  return initial;
}

export async function writePracticeLives(studentId, lives, defaults = {}) {
  const normalizedLives = normalizePracticeLives({
    ...(lives || {}),
  }, defaults);
  await writeJsonCache(getPracticeLivesKey(studentId), normalizedLives);
  return normalizedLives;
}

export async function getQuestionBankQuestionsForPractice(qbId) {
  if (!qbId) return [];

  const cacheKey = getQuestionBankCacheKey(qbId);
  const cached = await readJsonCache(cacheKey);
  if (Array.isArray(cached?.questions) && cached.questions.length) {
    return cached.questions;
  }

  const directPaths = [
    `Platform1/questionBanks/${qbId}`,
    `Platform1/questionBanks/questionBanks/${qbId}`,
    `Platform1/companyExams/questionBanks/${qbId}`,
    `companyExams/questionBanks/${qbId}`,
    `questionBanks/${qbId}`,
    `questionBanks/questionBanks/${qbId}`,
  ];

  let questionBank = await readFirstExistingValue(directPaths, { maxAgeMs: 30 * 60 * 1000 });

  if (!questionBank?.questions) {
    const parentPaths = [
      `Platform1/questionBanks`,
      `Platform1/questionBanks/questionBanks`,
      `questionBanks`,
      `questionBanks/questionBanks`,
      `Platform1/companyExams/questionBanks`,
      `companyExams/questionBanks`,
      `Platform1`,
    ];

    for (const path of parentPaths) {
      const node = await readFirstExistingValue([path], { maxAgeMs: 30 * 60 * 1000 });
      if (!node) continue;
      if (node[qbId]?.questions) {
        questionBank = node[qbId];
        break;
      }
      if (node.questionBanks?.[qbId]?.questions) {
        questionBank = node.questionBanks[qbId];
        break;
      }
      if (node.questionBanks?.questionBanks?.[qbId]?.questions) {
        questionBank = node.questionBanks.questionBanks[qbId];
        break;
      }
    }
  }

  if (!questionBank?.questions) return [];

  const questions = Object.entries(questionBank.questions).map(([id, question]) => ({ id, ...question }));
  await writeJsonCache(cacheKey, {
    savedAt: Date.now(),
    qbId,
    questions,
  });
  return questions;
}

export async function downloadPracticeExamBundle({
  studentId,
  packageId,
  packageName,
  subjectId,
  subjectName,
  roundMeta,
  examMeta,
  appExamConfig,
}) {
  const examId = normalizeId(examMeta?.id || roundMeta?.examId);
  const questionBankId = normalizeId(examMeta?.questionBankId || roundMeta?.questionBankId);

  if (!examId) throw new Error("Practice exam id missing.");
  if (!questionBankId) throw new Error("Question bank id missing.");

  const questions = await getQuestionBankQuestionsForPractice(questionBankId);
  if (!questions.length) throw new Error("No questions found for this practice exam.");

  const bundle = {
    packageId: normalizeId(packageId),
    packageName: normalizeId(packageName),
    subjectId: normalizeId(subjectId),
    subjectName: normalizeId(subjectName),
    isCompetitive: false,
    feedbackMode: examMeta?.scoringEnabled ? "end" : "instant",
    questionBankId,
    roundMeta: {
      ...(roundMeta || {}),
      id: normalizeId(roundMeta?.id || roundMeta?.roundId),
      roundId: normalizeId(roundMeta?.roundId || roundMeta?.id),
      examId,
      questionBankId,
    },
    examMeta: {
      ...(examMeta || {}),
      id: examId,
      examId,
      questionBankId,
    },
    appExamConfig: {
      attempts: { ...(appExamConfig?.attempts || {}) },
      lives: { ...(appExamConfig?.lives || {}) },
    },
    questions,
    downloadedAt: Date.now(),
  };

  await writePracticeExamBundle(studentId, examId, bundle);
  return bundle;
}