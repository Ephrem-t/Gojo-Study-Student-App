import AsyncStorage from "@react-native-async-storage/async-storage";
import { getValue } from "../app/lib/dbHelpers";
import { readScreenCache, writeScreenCache } from "./appOfflineCache";

const SUBJECT_ASSESSMENTS_CACHE_SCOPE = "subject-assessments";
const DOWNLOADED_ASSESSMENT_BUNDLE_PREFIX = "schoolAssessmentBundle:v1";
const ASSESSMENT_BUNDLE_FETCH_CACHE_MS = 30 * 60 * 1000;

function normalizeCacheId(value, fallback = "") {
  return String(value || fallback || "").trim();
}

function getDownloadedAssessmentBundleKey(studentId, assessmentId) {
  return `${DOWNLOADED_ASSESSMENT_BUNDLE_PREFIX}:${normalizeCacheId(studentId, "anon")}:${normalizeCacheId(assessmentId)}`;
}

async function readJsonCache(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeJsonCache(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function normalizeUnixTimestamp(ts) {
  const num = Number(ts);
  if (!num || Number.isNaN(num)) return 0;
  return num < 1000000000000 ? num * 1000 : num;
}

export function getAssessmentBundleVersionToken(assessment = {}) {
  const questionRefs = Object.values(assessment?.questionRefs || {})
    .map((value) => normalizeCacheId(value))
    .filter(Boolean)
    .sort()
    .join(",");

  return [
    normalizeCacheId(assessment?.assessmentId || assessment?.id),
    normalizeCacheId(assessment?.title),
    normalizeCacheId(assessment?.type),
    normalizeUnixTimestamp(assessment?.updatedAt),
    normalizeUnixTimestamp(assessment?.publishedAt),
    normalizeUnixTimestamp(assessment?.createdAt),
    normalizeUnixTimestamp(assessment?.openAt || assessment?.startAt || assessment?.availableFrom),
    normalizeUnixTimestamp(assessment?.dueDate),
    Number(assessment?.questionCount || 0),
    Number(assessment?.totalPoints || 0),
    questionRefs,
  ].join("::");
}

function buildSubjectAssessmentsCacheParts({ studentId, courseId, subject, grade, section } = {}) {
  return [
    String(studentId || "anon").trim() || "anon",
    String(courseId || "course").trim() || "course",
    String(subject || "subject").trim() || "subject",
    String(grade || "grade").trim() || "grade",
    String(section || "section").trim() || "section",
  ];
}

export async function readCachedSubjectAssessments(params = {}) {
  return readScreenCache(
    SUBJECT_ASSESSMENTS_CACHE_SCOPE,
    buildSubjectAssessmentsCacheParts(params)
  );
}

export async function persistCachedSubjectAssessments(params = {}) {
  const { items, ...routeParams } = params;
  await writeScreenCache(
    SUBJECT_ASSESSMENTS_CACHE_SCOPE,
    buildSubjectAssessmentsCacheParts(routeParams),
    {
      ...routeParams,
      items: Array.isArray(items) ? items : [],
      fetchedAt: Date.now(),
    }
  );
}

export async function updateCachedSubjectAssessmentStatus(params = {}) {
  const { assessmentId, submitted, finalScore } = params;
  const normalizedAssessmentId = String(assessmentId || "").trim();
  if (!normalizedAssessmentId) return false;

  const snapshot = await readCachedSubjectAssessments(params);
  if (!snapshot || !Array.isArray(snapshot.items)) return false;

  let changed = false;
  const hasFinalScore = typeof finalScore === "number" && Number.isFinite(finalScore);
  const nextItems = snapshot.items.map((item) => {
    if (String(item?.assessmentId || "").trim() !== normalizedAssessmentId) {
      return item;
    }

    const nextSubmitted = submitted == null ? !!item?.submitted : Boolean(submitted);
    const nextFinalScore = hasFinalScore ? finalScore : item?.finalScore ?? null;

    if (item?.submitted === nextSubmitted && item?.finalScore === nextFinalScore) {
      return item;
    }

    changed = true;
    return {
      ...item,
      submitted: nextSubmitted,
      finalScore: nextFinalScore,
    };
  });

  if (!changed) return false;

  await writeScreenCache(
    SUBJECT_ASSESSMENTS_CACHE_SCOPE,
    buildSubjectAssessmentsCacheParts(params),
    {
      ...snapshot,
      fetchedAt: Date.now(),
      items: nextItems,
    }
  );

  return true;
}

export async function readAssessmentSubmissionIndex({
  schoolKey,
  assessmentId,
  studentId,
  maxAgeMs,
} = {}) {
  const normalizedAssessmentId = String(assessmentId || "").trim();
  const normalizedStudentId = String(studentId || "").trim();
  if (!normalizedAssessmentId || !normalizedStudentId) return null;

  const paths = [];
  if (schoolKey) {
    paths.push(
      `Platform1/Schools/${schoolKey}/SchoolExams/SubmissionIndex/${normalizedAssessmentId}/${normalizedStudentId}`
    );
  }
  paths.push(`SchoolExams/SubmissionIndex/${normalizedAssessmentId}/${normalizedStudentId}`);

  const options = Number.isFinite(Number(maxAgeMs)) && Number(maxAgeMs) > 0
    ? { maxAgeMs: Number(maxAgeMs) }
    : {};

  const value = await getValue(paths, options);
  return value && typeof value === "object" ? value : null;
}

export async function readDownloadedAssessmentBundle(studentId, assessmentId) {
  const normalizedStudentId = normalizeCacheId(studentId);
  const normalizedAssessmentId = normalizeCacheId(assessmentId);
  if (!normalizedStudentId || !normalizedAssessmentId) return null;

  return readJsonCache(getDownloadedAssessmentBundleKey(normalizedStudentId, normalizedAssessmentId));
}

async function writeDownloadedAssessmentBundle(studentId, assessmentId, bundle) {
  const normalizedStudentId = normalizeCacheId(studentId);
  const normalizedAssessmentId = normalizeCacheId(assessmentId);
  if (!normalizedStudentId || !normalizedAssessmentId) return null;

  const normalizedBundle = {
    ...(bundle || {}),
    assessmentId: normalizedAssessmentId,
    savedAt: Date.now(),
    downloadedAt: Number(bundle?.downloadedAt || Date.now()),
  };

  await writeJsonCache(
    getDownloadedAssessmentBundleKey(normalizedStudentId, normalizedAssessmentId),
    normalizedBundle
  );

  return normalizedBundle;
}

export async function hasDownloadedAssessmentBundle(studentId, assessmentId, expectedVersionToken = "") {
  const bundle = await readDownloadedAssessmentBundle(studentId, assessmentId);
  const versionMatches = !expectedVersionToken || String(bundle?.versionToken || "") === String(expectedVersionToken);
  return !!(
    versionMatches &&
    bundle?.assessment &&
    Array.isArray(bundle?.questions) &&
    bundle.questions.length
  );
}

export async function readDownloadedAssessmentStateMap(studentId, assessments = []) {
  const normalizedStudentId = normalizeCacheId(studentId);
  if (!normalizedStudentId || !Array.isArray(assessments) || !assessments.length) {
    return {};
  }

  const indexedAssessments = assessments
    .map((assessment) => ({
      assessmentId: normalizeCacheId(assessment?.assessmentId),
      expectedVersionToken: getAssessmentBundleVersionToken(assessment),
    }))
    .filter((entry) => entry.assessmentId);

  if (!indexedAssessments.length) return {};

  const pairs = await AsyncStorage.multiGet(
    indexedAssessments.map((entry) =>
      getDownloadedAssessmentBundleKey(normalizedStudentId, entry.assessmentId)
    )
  );

  return indexedAssessments.reduce((result, entry, index) => {
    let parsed = null;
    try {
      parsed = pairs[index]?.[1] ? JSON.parse(pairs[index][1]) : null;
    } catch {
      parsed = null;
    }

    result[entry.assessmentId] = !!(
      parsed?.assessment &&
      Array.isArray(parsed?.questions) &&
      parsed.questions.length &&
      String(parsed?.versionToken || "") === entry.expectedVersionToken
    );

    return result;
  }, {});
}

function flattenQuestionBank(root) {
  const out = {};
  if (!root || typeof root !== "object") return out;

  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    for (const [key, val] of Object.entries(node)) {
      if (!val || typeof val !== "object") continue;

      const isQuestion =
        typeof val.type === "string" &&
        typeof val.question === "string";

      if (isQuestion) {
        out[key] = { id: key, ...val };
      } else {
        stack.push(val);
      }
    }
  }

  return out;
}

export async function resolveAssessmentQuestions({ questionRefs, schoolKey } = {}) {
  const ids = Object.values(questionRefs || {}).map((value) => normalizeCacheId(value)).filter(Boolean);
  if (!ids.length) return [];

  let scopedQuestions = {};
  if (schoolKey) {
    const scopedBank = await getValue(
      [`Platform1/Schools/${schoolKey}/SchoolExams/QuestionBank`],
      { maxAgeMs: ASSESSMENT_BUNDLE_FETCH_CACHE_MS }
    );
    scopedQuestions = flattenQuestionBank(scopedBank);
  }

  const unresolvedIds = ids.filter((id) => !scopedQuestions[id]);
  let globalQuestions = {};
  if (unresolvedIds.length) {
    const globalBank = await getValue(
      ["SchoolExams/QuestionBank"],
      { maxAgeMs: ASSESSMENT_BUNDLE_FETCH_CACHE_MS }
    );
    globalQuestions = flattenQuestionBank(globalBank);
  }

  return ids
    .map((qid) => scopedQuestions[qid] || globalQuestions[qid] || null)
    .filter(Boolean)
    .map((question) => ({ ...question }));
}

export async function loadAssessmentBundleFromServer({ schoolKey, assessmentId, assessment } = {}) {
  const normalizedAssessmentId = normalizeCacheId(assessmentId || assessment?.assessmentId || assessment?.id);
  if (!normalizedAssessmentId) return null;

  let resolvedAssessment = assessment && typeof assessment === "object"
    ? { ...assessment, assessmentId: normalizedAssessmentId }
    : null;

  const hasQuestionRefs = Object.values(resolvedAssessment?.questionRefs || {}).length > 0;
  if (!resolvedAssessment || !hasQuestionRefs) {
    const remoteAssessment = await getValue(
      [
        schoolKey
          ? `Platform1/Schools/${schoolKey}/SchoolExams/Assessments/${normalizedAssessmentId}`
          : null,
        `SchoolExams/Assessments/${normalizedAssessmentId}`,
      ].filter(Boolean),
      { maxAgeMs: ASSESSMENT_BUNDLE_FETCH_CACHE_MS }
    );

    if (!remoteAssessment || typeof remoteAssessment !== "object") {
      return null;
    }

    resolvedAssessment = {
      ...remoteAssessment,
      assessmentId: normalizedAssessmentId,
    };
  }

  const questions = await resolveAssessmentQuestions({
    questionRefs: resolvedAssessment.questionRefs || {},
    schoolKey,
  });

  return {
    assessment: resolvedAssessment,
    questions,
    versionToken: getAssessmentBundleVersionToken(resolvedAssessment),
  };
}

export async function downloadAssessmentBundle({
  studentId,
  schoolKey,
  assessmentId,
  assessment,
} = {}) {
  const normalizedStudentId = normalizeCacheId(studentId);
  const normalizedAssessmentId = normalizeCacheId(assessmentId || assessment?.assessmentId || assessment?.id);
  if (!normalizedStudentId) throw new Error("Student account was not found on this phone.");
  if (!normalizedAssessmentId) throw new Error("Assessment id missing.");

  const remoteBundle = await loadAssessmentBundleFromServer({
    schoolKey,
    assessmentId: normalizedAssessmentId,
    assessment,
  });

  if (!remoteBundle?.assessment) {
    throw new Error("Assessment was not found.");
  }

  if (!Array.isArray(remoteBundle.questions) || !remoteBundle.questions.length) {
    throw new Error("No questions were found for this assessment.");
  }

  const bundle = {
    studentId: normalizedStudentId,
    schoolKey: normalizeCacheId(schoolKey),
    assessment: remoteBundle.assessment,
    questions: remoteBundle.questions,
    versionToken: remoteBundle.versionToken,
    downloadedAt: Date.now(),
  };

  return writeDownloadedAssessmentBundle(normalizedStudentId, normalizedAssessmentId, bundle);
}