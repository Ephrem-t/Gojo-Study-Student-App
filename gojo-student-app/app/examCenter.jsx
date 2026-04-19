import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Platform,
  Animated,
  Alert,
  StatusBar,
  Vibration,
  Modal,
  Easing,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ref, get } from "../lib/offlineDatabase";
import { database } from "../constants/firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import { useAppTheme } from "../hooks/use-app-theme";
import PageLoadingSkeleton from "../components/ui/page-loading-skeleton";
import { readScreenCache, writeScreenCache } from "../lib/appOfflineCache";
import { getValue, pushAndSet, runTransactionSafe, safeUpdate } from "./lib/dbHelpers";
import {
  createLocalAttemptId,
  ensurePracticeLives,
  readPracticeExamBundle,
  readPracticeExamProgress,
  updatePracticeExamProgress,
  writePracticeLives,
} from "../lib/practiceExamStore";
import { peekExamCenterWarmRoute } from "../lib/examRouteWarmCache";

const C = {
  primary: "#0B72FF",
  muted: "#6B78A8",
  success: "#16A34A",
  danger: "#EF4444",
};
const HEART_COLOR = "#EF4444";
const DEFAULT_HEART_REFILL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_LIVES = 5;
const WRONGS_PER_LIFE_FALLBACK = 2;
const EXAM_REVIEW_CACHE_PREFIX = "examReviewCache:v1";
const QUESTION_BANK_CACHE_PREFIX = "questionBankCache:v1";
const DEFAULT_APP_EXAM_CONFIG = {
  attempts: {
    defaultRefillIntervalMs: 0,
    maxCarryRefills: 999,
    practiceRefillEnabled: false,
  },
  lives: {
    defaultMaxLives: DEFAULT_MAX_LIVES,
    defaultRefillIntervalMs: DEFAULT_HEART_REFILL_MS,
    fallbackWrongsPerLife: WRONGS_PER_LIFE_FALLBACK,
  },
  ui: {},
};

function mergeAppExamConfig(config = null) {
  return {
    ...DEFAULT_APP_EXAM_CONFIG,
    ...(config || {}),
    attempts: {
      ...DEFAULT_APP_EXAM_CONFIG.attempts,
      ...(config?.attempts || {}),
      defaultRefillIntervalMs: 0,
      practiceRefillEnabled: false,
    },
    lives: {
      ...DEFAULT_APP_EXAM_CONFIG.lives,
      ...(config?.lives || {}),
    },
    ui: {
      ...DEFAULT_APP_EXAM_CONFIG.ui,
      ...(config?.ui || {}),
    },
  };
}

function getReviewCacheKey(studentId, examId) {
  return `${EXAM_REVIEW_CACHE_PREFIX}:${String(studentId || "anon")}:${String(examId || "")}`;
}

function getQuestionBankCacheKey(qbId) {
  return `${QUESTION_BANK_CACHE_PREFIX}:${String(qbId || "")}`;
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
  } catch {}
}

async function readStoredStudentId() {
  try {
    const pairs = await AsyncStorage.multiGet(["studentNodeKey", "studentId", "username"]);
    const session = Object.fromEntries(pairs);
    return session.studentNodeKey || session.studentId || session.username || null;
  } catch {
    return null;
  }
}

function toMsTs(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}
function normalizeQuestionOrder(qOrder) {
  if (!qOrder) return [];
  if (Array.isArray(qOrder)) return qOrder;
  if (typeof qOrder === "object") {
    const keys = Object.keys(qOrder);
    const numeric = keys.every((k) => String(Number(k)) === String(k));
    if (numeric) return keys.map((k) => ({ k: Number(k), v: qOrder[k] })).sort((a, b) => a.k - b.k).map((x) => x.v);
    return keys.map((k) => qOrder[k]);
  }
  return [];
}

function getHighestCompletedScorePercent(entries = {}) {
  return Object.values(entries || {}).reduce((highest, attempt) => {
    if (String(attempt?.attemptStatus || "").toLowerCase() !== "completed") return highest;
    const parsedScorePercent = Number(attempt?.scorePercent);
    if (!Number.isFinite(parsedScorePercent)) return highest;
    return Math.max(highest, parsedScorePercent);
  }, 0);
}

function scoreExam(questions, order, answers) {
  const qOrder = order.length ? order : questions.map((q) => q.id);
  const map = {};
  (questions || []).forEach((q) => { if (q?.id != null) map[String(q.id)] = q; });

  let correct = 0;
  let total = 0;
  qOrder.forEach((qId) => {
    const q = map[String(qId)];
    if (!q) return;
    total += 1;
    if (String(q.correctAnswer ?? "").trim() !== "" && String(answers?.[String(qId)] ?? "").trim() === String(q.correctAnswer ?? "").trim()) correct += 1;
  });
  const percent = total ? (correct / total) * 100 : 0;
  return { correct, total, percent };
}
function getBadgeAndPoints(examMeta, percent) {
  let badge = null;
  let points = 0;
  if (examMeta?.scoringEnabled && examMeta?.scoring) {
    const s = examMeta.scoring;
    if (percent >= Number(s.platinumPercent || 90)) { badge = "platinum"; points = Number(s.maxPoints || 3); }
    else if (percent >= Number(s.diamondPercent || 85)) { badge = "diamond"; points = 2; }
    else if (percent >= Number(s.goldPercent || 75)) { badge = "gold"; points = 1; }
  }
  return { badge, points };
}

function getResolvedPracticePassPercent(examMeta = null) {
  const parsed = Number(
    examMeta?.passingPercent ??
    examMeta?.passPercent ??
    examMeta?.passScore ??
    NaN
  );

  if (!Number.isFinite(parsed)) return 50;
  return Math.max(50, parsed);
}

function normalizePackageGradeCacheToken(value) {
  if (!value) return null;
  return String(value).trim().toLowerCase().replace(/^grade/i, "") || null;
}

function getRoundWindow(roundMeta = {}, now = Date.now()) {
  const start = toMsTs(
    roundMeta?.startTimestamp ??
    roundMeta?.releaseTimestamp ??
    roundMeta?.startAt ??
    roundMeta?.startsAt ??
    0
  );
  const end = toMsTs(
    roundMeta?.endTimestamp ??
    roundMeta?.endAt ??
    roundMeta?.endsAt ??
    0
  );
  const status = String(roundMeta?.status || "").toLowerCase();

  const beforeStart = !!start && now < start;
  const afterEnd = !!end && now > end;
  const explicitLive = ["live", "active", "open", "ongoing"].includes(status);

  if (explicitLive && !afterEnd) {
    return { ok: true, start, end, reason: "", hasWindow: !!(start || end) };
  }

  if (!start && !end) {
    return { ok: true, start: 0, end: 0, reason: "", hasWindow: false };
  }

  if (beforeStart) {
    return { ok: false, start, end, reason: "This exam is not live yet.", hasWindow: true };
  }

  if (afterEnd) {
    return { ok: false, start, end, reason: "This live exam has ended.", hasWindow: true };
  }

  return { ok: true, start, end, reason: "", hasWindow: true };
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function formatTime(sec) {
  const s = Number(sec || 0);
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
function formatMsToMMSS(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
function normalizeHeartRefillMs(value, fallback = DEFAULT_HEART_REFILL_MS) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(DEFAULT_HEART_REFILL_MS, parsed);
}
function computeRefillState({ currentLives, maxLives, lastConsumedAt, refillMs, now = Date.now() }) {
  const current = Number(currentLives ?? 0);
  const max = Number(maxLives ?? 5);
  const last = Number(lastConsumedAt ?? 0);
  const interval = normalizeHeartRefillMs(refillMs, 0);

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
  const resolvedMaxLives = Math.max(1, Number(maxLives ?? DEFAULT_MAX_LIVES));
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

function computeAttemptRefillState({ attemptsUsed, lastAttemptTimestamp, refillMs, now = Date.now() }) {
  const usedRaw = Math.max(0, Number(attemptsUsed || 0));
  const lastTs = Number(lastAttemptTimestamp || 0);
  const interval = Number(refillMs || 0);

  if (!interval || interval <= 0 || !lastTs) {
    return {
      effectiveAttemptsUsed: usedRaw,
      anchorTs: lastTs,
      recovered: 0,
      nextInMs: 0,
    };
  }

  const elapsed = Math.max(0, now - lastTs);
  const recovered = Math.floor(elapsed / interval);
  const effectiveAttemptsUsed = Math.max(0, usedRaw - recovered);
  const anchorTs = recovered > 0 ? lastTs + recovered * interval : lastTs;
  const nextInMs = effectiveAttemptsUsed <= 0 ? 0 : Math.max(0, interval - ((now - anchorTs) % interval));

  return {
    effectiveAttemptsUsed,
    anchorTs,
    recovered,
    nextInMs,
  };
}

export default function ExamCenter() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const { colors, statusBarStyle } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const modalStyles = useMemo(() => createModalStyles(colors), [colors]);

  const roundId = params.roundId;
  const examId = params.examId;
  const questionBankIdParam = params.questionBankId;
  const mode = params.mode || "start";
  const isReviewOnlyMode = mode === "review" || mode === "result";
  const practiceOfflineRequested = String(params.practiceOffline || "") === "1";
  const warmRouteData = useMemo(
    () => peekExamCenterWarmRoute({ roundId, examId }),
    [roundId, examId]
  );
  const hasWarmRulesShell = mode === "start" && !!warmRouteData?.examMeta;

  const syncPackageSubjectsReturnCache = useCallback(async (patch = {}) => {
    const returnTo = String(params?.returnTo || "");
    const returnPackageId = String(params?.returnPackageId || "").trim();
    if (returnTo !== "packageSubjects" || !returnPackageId || !patch || typeof patch !== "object") {
      return;
    }

    const cacheParts = [
      returnPackageId,
      normalizePackageGradeCacheToken(params?.returnStudentGrade) || "all",
    ];

    const snapshot = await readScreenCache("package-subjects", cacheParts);
    if (!snapshot || typeof snapshot !== "object") return;

    await writeScreenCache("package-subjects", cacheParts, {
      ...snapshot,
      ...patch,
    });
  }, [params?.returnPackageId, params?.returnStudentGrade, params?.returnTo]);

  const handleBackNavigation = useCallback(() => {
    const returnTo = String(params?.returnTo || "");
    if (returnTo === "packageSubjects") {
      router.replace({
        pathname: "/packageSubjects",
        params: {
          packageId: String(params?.returnPackageId || ""),
          packageName: String(params?.returnPackageName || "Package"),
          studentGrade: String(params?.returnStudentGrade || ""),
        },
      });
      return;
    }
    if (returnTo === "exam") {
      router.replace({
        pathname: "/dashboard/exam",
        params: {
          activeFilter: String(params?.returnExamFilter || "online"),
        },
      });
      return;
    }
    router.back();
  }, [params, router]);

  const [loading, setLoading] = useState(!hasWarmRulesShell);
  const [stage, setStage] = useState(mode === "review" ? "review" : "rules");
  const [roundMeta, setRoundMeta] = useState(() => warmRouteData?.roundMeta || null);
  const [examMeta, setExamMeta] = useState(() => warmRouteData?.examMeta || null);
  const [isCompetitive, setIsCompetitive] = useState(() => !!warmRouteData?.isCompetitive);

  const [questions, setQuestions] = useState(() => (Array.isArray(warmRouteData?.questions) ? warmRouteData.questions : []));
  const [questionLoadError, setQuestionLoadError] = useState(null);

  const [studentId, setStudentId] = useState(null);
  const [attemptNo, setAttemptNo] = useState(1);
  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const [effectiveAttemptsUsed, setEffectiveAttemptsUsed] = useState(0);
  const [attemptProgressAnchorTs, setAttemptProgressAnchorTs] = useState(0);
  const [attemptId, setAttemptId] = useState(null);

  const [inProgressAttempt, setInProgressAttempt] = useState(null);
  const [reviewAttempt, setReviewAttempt] = useState(null);
  const [lastCompletedAttempt, setLastCompletedAttempt] = useState(null);

  const [order, setOrder] = useState([]);
  const [answers, setAnswers] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedFeedback, setSelectedFeedback] = useState(null);
  const [showAnswerRequiredWarning, setShowAnswerRequiredWarning] = useState(false);

  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef(null);
  const heartSyncTimeoutRef = useRef(null);
  const attemptSyncTimeoutRef = useRef(null);
  const bestScorePercentRef = useRef(0);
  const [result, setResult] = useState(null);

  const [globalLives, setGlobalLives] = useState(null);
  const [globalMaxLives, setGlobalMaxLives] = useState(DEFAULT_MAX_LIVES);
  const [globalRefillMs, setGlobalRefillMs] = useState(DEFAULT_HEART_REFILL_MS);
  const [globalLastConsumedAt, setGlobalLastConsumedAt] = useState(null);

  const [outOfLivesModalVisible, setOutOfLivesModalVisible] = useState(false);
  const [nextHeartInMs, setNextHeartInMs] = useState(0);
  const outModalAnim = useRef(new Animated.Value(0)).current;

  const [showHeartInfoModal, setShowHeartInfoModal] = useState(false);
  const heartModalAnim = useRef(new Animated.Value(0)).current;

  const [feedbackMode, setFeedbackMode] = useState("end");
  const [showFeedbackInfoModal, setShowFeedbackInfoModal] = useState(false);
  const [showAttemptsExhaustedDetails, setShowAttemptsExhaustedDetails] = useState(true);

  const [showPostSubmitReview, setShowPostSubmitReview] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);

  const wrongCountRef = useRef(0);
  const livesMutationVersionRef = useRef(0);

  // [v48] add near other useState/useRef declarations inside ExamCenter component:
const resultPop = useRef(new Animated.Value(0)).current;
const resultPulse = useRef(new Animated.Value(1)).current;
const resultConfetti = useRef(new Animated.Value(0)).current;
const practicePassPercent = useMemo(() => getResolvedPracticePassPercent(examMeta), [examMeta]);

const isPass = useMemo(() => {
  return Number(result?.percent || 0) >= practicePassPercent;
}, [practicePassPercent, result]);

const gradeLabel = useMemo(() => {
  const p = Number(result?.percent || 0);
  if (p < practicePassPercent) return "Fail";
  if (p >= 90) return "Excellent";
  if (p >= 75) return "Great job";
  return "Pass";
}, [practicePassPercent, result]);

  const [appExamConfig, setAppExamConfig] = useState(() => mergeAppExamConfig(warmRouteData?.appExamConfig || null));
  const [offlinePracticeBundle, setOfflinePracticeBundle] = useState(null);
  const isOfflinePracticeMode = practiceOfflineRequested && !!offlinePracticeBundle;

  const loadQuestionBank = useCallback(async (qbId) => {
    setQuestionLoadError(null);
    if (!qbId) {
      setQuestionLoadError("Question bank id missing.");
      setQuestions([]);
      return [];
    }

    const cacheKey = getQuestionBankCacheKey(qbId);
    const cached = await readJsonCache(cacheKey);
    if (Array.isArray(cached?.questions) && cached.questions.length) {
      setQuestions(cached.questions);
      return cached.questions;
    }

    const direct = [
      `Platform1/questionBanks/${qbId}`,
      `Platform1/questionBanks/questionBanks/${qbId}`,
      `Platform1/companyExams/questionBanks/${qbId}`,
      `companyExams/questionBanks/${qbId}`,
      `questionBanks/${qbId}`,
      `questionBanks/questionBanks/${qbId}`,
    ];

    let qb = await getValue(direct);
    if (qb?.questions) {
      const normalizedQuestions = Object.entries(qb.questions).map(([id, q]) => ({ id, ...q }));
      setQuestions(normalizedQuestions);
      await writeJsonCache(cacheKey, { savedAt: Date.now(), qbId, questions: normalizedQuestions });
      return normalizedQuestions;
    }

    const parents = [
      `Platform1/questionBanks`,
      `Platform1/questionBanks/questionBanks`,
      `questionBanks`,
      `questionBanks/questionBanks`,
      `Platform1/companyExams/questionBanks`,
      `companyExams/questionBanks`,
      `Platform1`,
    ];

    for (const p of parents) {
      const node = await getValue([p]);
      if (!node) continue;
      if (node[qbId]?.questions) { qb = node[qbId]; break; }
      if (node.questionBanks?.[qbId]?.questions) { qb = node.questionBanks[qbId]; break; }
      if (node.questionBanks?.questionBanks?.[qbId]?.questions) { qb = node.questionBanks.questionBanks[qbId]; break; }
    }

    if (qb?.questions) {
      const normalizedQuestions = Object.entries(qb.questions).map(([id, q]) => ({ id, ...q }));
      setQuestions(normalizedQuestions);
      await writeJsonCache(cacheKey, { savedAt: Date.now(), qbId, questions: normalizedQuestions });
      return normalizedQuestions;
    }

    setQuestions([]);
    setQuestionLoadError(`Question bank not found for ${qbId}`);
    return [];
  }, []);

  const findRoundMetaById = useCallback(async (rid, targetExamId = null, targetQuestionBankId = null) => {
    const pkgs = await getValue([`Platform1/companyExams/packages`, `companyExams/packages`]);
    if (!pkgs) return null;

    let fallbackMatch = null;

    for (const pkgKey of Object.keys(pkgs)) {
      const subjects = (pkgs[pkgKey] || {}).subjects || {};
      for (const sk of Object.keys(subjects)) {
        const rounds = (subjects[sk] || {}).rounds || {};
        if (!rounds[rid]) continue;

        const candidate = { ...(rounds[rid] || {}), id: rid, packageId: pkgKey, subjectKey: sk };
        const candidateExamId = String(candidate?.examId || "");
        const candidateQuestionBankId = String(candidate?.questionBankId || "");

        if (
          (targetExamId && candidateExamId === String(targetExamId)) ||
          (targetQuestionBankId && candidateQuestionBankId === String(targetQuestionBankId))
        ) {
          return candidate;
        }

        if (!fallbackMatch) fallbackMatch = candidate;
      }
    }

    return fallbackMatch;
  }, []);

  const submitExam = useCallback(async () => {
    clearInterval(timerRef.current);

    const finalOrder = order.length ? order : questions.map((q) => q.id);
    const computed = scoreExam(questions, finalOrder, answers);
    const scored = getBadgeAndPoints(examMeta, computed.percent);

    const now = Date.now();
    const resultVisible = isCompetitive
      ? false
      : examMeta?.scoringEnabled
      ? now >= toMsTs(roundMeta?.resultReleaseTimestamp)
      : true;
    const awardedPointsValue = isCompetitive ? "pending" : scored.points;
    const usedBefore = Math.max(Number(effectiveAttemptsUsed || 0), Number(attemptsUsed || 0));
    const startedAttemptNo = Number(inProgressAttempt?.attemptNo || 0);
    const usedAfter = Math.max(usedBefore, startedAttemptNo, attemptId ? 1 : 0);
    const updatedBestScorePercent = Math.max(Number(bestScorePercentRef.current || 0), computed.percent);
    const resolvedPassPercent = getResolvedPracticePassPercent(examMeta);
    const didFailExam = computed.percent < resolvedPassPercent;
    const localReviewAttempt = {
      id: attemptId,
      roundId,
      examId,
      attemptStatus: "completed",
      endTime: Date.now(),
      scorePercent: computed.percent,
      correctCount: computed.correct,
      totalQuestions: computed.total,
      badge: scored.badge,
      pointsAwarded: awardedPointsValue,
      resultVisible,
      questionOrder: finalOrder,
      answers,
    };
    if (studentId && examId && attemptId) {
      if (isOfflinePracticeMode) {
        await updatePracticeExamProgress(studentId, examId, (current) => {
          const attempts = { ...(current.attempts || {}) };
          attempts[String(attemptId)] = {
            ...(attempts[String(attemptId)] || {}),
            ...localReviewAttempt,
          };
          return {
            ...current,
            status: "completed",
            attemptsUsed: usedAfter,
            lastScorePercent: updatedBestScorePercent,
            bestScorePercent: Math.max(Number(current?.bestScorePercent || 0), updatedBestScorePercent),
            lastAttemptId: attemptId,
            lastSubmittedAt: now,
            lastAttemptTimestamp: now,
            attempts,
          };
        }).catch(() => {});
      } else {
        const patch = {};
        patch[`Platform1/attempts/company/${studentId}/${examId}/${attemptId}/endTime`] = now;
        patch[`Platform1/attempts/company/${studentId}/${examId}/${attemptId}/attemptStatus`] = "completed";
        patch[`Platform1/attempts/company/${studentId}/${examId}/${attemptId}/answers`] = answers;
        patch[`Platform1/attempts/company/${studentId}/${examId}/${attemptId}/scorePercent`] = computed.percent;
        patch[`Platform1/attempts/company/${studentId}/${examId}/${attemptId}/correctCount`] = computed.correct;
        patch[`Platform1/attempts/company/${studentId}/${examId}/${attemptId}/pointsAwarded`] = awardedPointsValue;
        patch[`Platform1/attempts/company/${studentId}/${examId}/${attemptId}/badge`] = scored.badge;
        patch[`Platform1/attempts/company/${studentId}/${examId}/${attemptId}/resultVisible`] = resultVisible;
        patch[`Platform1/studentProgress/${studentId}/company/${roundId}/${examId}/status`] = "completed";
        patch[`Platform1/studentProgress/${studentId}/company/${roundId}/${examId}/attemptsUsed`] = usedAfter;
        patch[`Platform1/studentProgress/${studentId}/company/${roundId}/${examId}/lastScorePercent`] = updatedBestScorePercent;
        patch[`Platform1/studentProgress/${studentId}/company/${roundId}/${examId}/bestScorePercent`] = updatedBestScorePercent;
        patch[`Platform1/studentProgress/${studentId}/company/${roundId}/${examId}/lastAttemptId`] = attemptId;
        patch[`Platform1/studentProgress/${studentId}/company/${roundId}/${examId}/lastSubmittedAt`] = now;
        patch[`Platform1/studentProgress/${studentId}/company/${roundId}/${examId}/lastAttemptTimestamp`] = now;
        await safeUpdate(patch).catch(() => {});
      }
      bestScorePercentRef.current = updatedBestScorePercent;
      setAttemptsUsed(usedAfter);
      setEffectiveAttemptsUsed(usedAfter);
      setAttemptNo(usedAfter + 1);
      setAttemptProgressAnchorTs(now);
    }

    let lifePenaltyApplied = false;

    try {
      if (!isCompetitive && studentId) {
        if (isOfflinePracticeMode) {
          const localLives = await ensurePracticeLives(studentId, appExamConfig?.lives || {});
          if (didFailExam) {
            livesMutationVersionRef.current += 1;
            const now = Date.now();
            const consumedLives = buildQueuedHeartConsumption({
              currentLives: localLives.currentLives,
              maxLives: localLives.maxLives || globalMaxLives || DEFAULT_MAX_LIVES,
              lastConsumedAt: localLives.lastConsumedAt,
              refillMs: localLives.refillIntervalMs || globalRefillMs || DEFAULT_HEART_REFILL_MS,
              now,
            });
            if (!consumedLives) {
              throw new Error("No lives available to deduct");
            }
            const nextLives = {
              ...localLives,
              currentLives: consumedLives.currentLives,
              lastConsumedAt: consumedLives.lastConsumedAt,
            };
            const savedLives = await writePracticeLives(studentId, nextLives, appExamConfig?.lives || {});
            const nextGlobalLives = Number(savedLives.currentLives || 0);
            const nextGlobalLastConsumedAt = Number(savedLives.lastConsumedAt || 0) || null;
            setGlobalLives(nextGlobalLives);
            setGlobalLastConsumedAt(nextGlobalLastConsumedAt);
            void syncPackageSubjectsReturnCache({
              globalLives: nextGlobalLives,
              globalMaxLives: Number(savedLives.maxLives || globalMaxLives || DEFAULT_MAX_LIVES),
              globalRefillMs: Number(savedLives.refillIntervalMs || globalRefillMs || DEFAULT_HEART_REFILL_MS),
              globalLastConsumedAt: nextGlobalLastConsumedAt,
            });
            lifePenaltyApplied = true;
          }
        } else {
          const livesPath = `Platform1/studentLives/${studentId}`;
          if (didFailExam) {
            livesMutationVersionRef.current += 1;
            const consumedAt = Date.now();
            const transactionResult = await runTransactionSafe(livesPath, (currentNode) => {
              const raw = currentNode && typeof currentNode === "object" ? currentNode : {};
              const resolvedMaxLives = Number(raw.maxLives ?? globalMaxLives ?? DEFAULT_MAX_LIVES);
              const resolvedRefillMs = normalizeHeartRefillMs(raw.refillIntervalMs ?? raw.refillInterval ?? globalRefillMs ?? DEFAULT_HEART_REFILL_MS);
              const consumedLives = buildQueuedHeartConsumption({
                currentLives: raw.currentLives ?? raw.current ?? globalLives ?? resolvedMaxLives,
                maxLives: resolvedMaxLives,
                lastConsumedAt: toMsTs(raw.lastConsumedAt ?? raw.lastConsumed ?? globalLastConsumedAt ?? 0),
                refillMs: resolvedRefillMs,
                now: consumedAt,
              });

              if (!consumedLives) return;

              return {
                ...raw,
                currentLives: consumedLives.currentLives,
                maxLives: resolvedMaxLives,
                refillIntervalMs: resolvedRefillMs,
                lastConsumedAt: consumedLives.lastConsumedAt,
              };
            });
            lifePenaltyApplied = !!transactionResult?.committed;
          }

          const updated = await get(ref(database, livesPath)).catch(() => null);
          if (updated?.exists()) {
            const val = updated.val();
            const nextGlobalLives = Number(val.currentLives ?? val.current ?? 0);
            const nextGlobalLastConsumedAt = toMsTs(val.lastConsumedAt ?? val.lastConsumed ?? 0);
            setGlobalLives(nextGlobalLives);
            setGlobalLastConsumedAt(nextGlobalLastConsumedAt);
            if (didFailExam) {
              void syncPackageSubjectsReturnCache({
                globalLives: nextGlobalLives,
                globalMaxLives,
                globalRefillMs,
                globalLastConsumedAt: nextGlobalLastConsumedAt,
              });
            }
          } else if (didFailExam && lifePenaltyApplied) {
            void syncPackageSubjectsReturnCache({
              globalLives: Math.max(0, Number(globalLives || 0) - 1),
              globalMaxLives,
              globalRefillMs,
              globalLastConsumedAt: Number(globalLastConsumedAt || 0) || Date.now(),
            });
          }
        }
      }
    } catch (e) {
      console.warn("submitExam: life deduction failed", e);
    }

    setInProgressAttempt(null);
    setAttemptId(null);
    setLastCompletedAttempt(localReviewAttempt);
    setResult({
      percent: computed.percent,
      correct: computed.correct,
      total: computed.total,
      badge: scored.badge,
      points: awardedPointsValue,
      resultVisible,
      passPercent: resolvedPassPercent,
      lifePenaltyApplied,
    });

    if (studentId && examId && questions.length) {
      await writeJsonCache(getReviewCacheKey(studentId, examId), {
        savedAt: Date.now(),
        roundMeta: roundMeta || null,
        examMeta: examMeta || null,
        isCompetitive,
        feedbackMode,
        questions,
        reviewAttempt: localReviewAttempt,
      });
    }

    setShowPostSubmitReview(false);
    setReviewIndex(0);

    wrongCountRef.current = 0;
    setStage("result");
  }, [order, questions, answers, studentId, examId, attemptId, examMeta, roundMeta, isCompetitive, roundId, appExamConfig, feedbackMode, effectiveAttemptsUsed, attemptsUsed, isOfflinePracticeMode, inProgressAttempt, globalLives, globalLastConsumedAt, globalMaxLives, globalRefillMs, syncPackageSubjectsReturnCache]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      bestScorePercentRef.current = 0;
      const livesVersionBeforeLoad = livesMutationVersionRef.current;

      const sid = await readStoredStudentId();
      if (!cancelled) setStudentId(sid);
      if (practiceOfflineRequested && sid && examId) {
        const bundle = await readPracticeExamBundle(sid, examId);
        if (!bundle?.questions || !Array.isArray(bundle.questions) || !bundle.questions.length) {
          if (!cancelled) {
            setOfflinePracticeBundle(null);
            setQuestions([]);
            setQuestionLoadError("Download this practice exam first to use it offline.");
            setLoading(false);
          }
          return;
        }
        const bundledConfig = mergeAppExamConfig(bundle.appExamConfig);
        if (!cancelled) {
          setOfflinePracticeBundle(bundle);
          setQuestionLoadError(null);
          setAppExamConfig((prev) => ({
            ...prev,
            ...bundle.appExamConfig,
            attempts: { ...prev.attempts, ...(bundle.appExamConfig?.attempts || {}) },
            lives: { ...prev.lives, ...(bundle.appExamConfig?.lives || {}) },
            ui: { ...prev.ui, ...(bundle.appExamConfig?.ui || {}) },
          }));
          setRoundMeta(bundle.roundMeta || null);
          setExamMeta(bundle.examMeta || null);
          setIsCompetitive(false);
          setFeedbackMode(bundle.feedbackMode || (bundle.examMeta?.scoringEnabled ? "end" : "instant"));
          setQuestions(bundle.questions);
        }
        const localLives = await ensurePracticeLives(sid, bundledConfig.lives);
        if (!cancelled) {
          setGlobalMaxLives(Number(localLives.maxLives || DEFAULT_MAX_LIVES));
          setGlobalRefillMs(normalizeHeartRefillMs(localLives.refillIntervalMs));
          if (livesVersionBeforeLoad === livesMutationVersionRef.current) {
            setGlobalLives(Number(localLives.currentLives || 0));
            setGlobalLastConsumedAt(Number(localLives.lastConsumedAt || 0) || null);
          }
        }
        const progressNode = await readPracticeExamProgress(sid, examId);
        const entries = progressNode?.attempts || {};
        const keys = Object.keys(entries || {});
        let completedCount = 0;
        let latestInProgress = null;
        let latestInProgressKey = null;
        let latestCompleted = null;
        let latestCompletedKey = null;
        for (const key of keys) {
          const attempt = entries[key] || {};
          const status = String(attempt.attemptStatus || "").toLowerCase();
          if (status === "completed") {
            completedCount += 1;
            const endTime = Number(attempt.endTime || attempt.startTime || 0);
            if (!latestCompleted || endTime > Number(latestCompleted.endTime || latestCompleted.startTime || 0)) {
              latestCompleted = attempt;
              latestCompletedKey = key;
            }
          } else if (status === "in_progress") {
            if (!latestInProgress || Number(attempt.startTime || 0) > Number(latestInProgress.startTime || 0)) {
              latestInProgress = attempt;
              latestInProgressKey = key;
            }
          }
        }
        const progressAttemptsUsed = Math.max(
          Number(progressNode?.attemptsUsed || 0),
          completedCount,
          keys.length
        );
        const progressLastAttemptTs = Number(
          progressNode?.lastAttemptTimestamp ||
          progressNode?.lastSubmittedAt ||
          latestCompleted?.endTime ||
          latestCompleted?.startTime ||
          0
        );
        bestScorePercentRef.current = Math.max(
          Number(progressNode?.bestScorePercent || 0),
          getHighestCompletedScorePercent(entries)
        );
        if (!cancelled) {
          setAttemptsUsed(progressAttemptsUsed);
          setEffectiveAttemptsUsed(progressAttemptsUsed);
          setAttemptNo(progressAttemptsUsed + 1);
          setAttemptProgressAnchorTs(progressLastAttemptTs);
        }
        if (latestInProgress && latestInProgressKey && !cancelled) {
          setInProgressAttempt({ id: latestInProgressKey, ...latestInProgress });
          setAttemptId(latestInProgressKey);
          setOrder(normalizeQuestionOrder(latestInProgress.questionOrder || {}));
          setAnswers(latestInProgress.answers || {});
          if (latestInProgress.remainingSeconds != null) setTimeLeft(Number(latestInProgress.remainingSeconds));
          else if (bundle.examMeta?.timeLimit && latestInProgress.startTime) {
            const elapsed = Math.floor((Date.now() - Number(latestInProgress.startTime || 0)) / 1000);
            setTimeLeft(Math.max(0, Number(bundle.examMeta.timeLimit || 0) - elapsed));
          }
        }
        if (latestCompleted && latestCompletedKey && !cancelled) {
          setLastCompletedAttempt({ id: latestCompletedKey, ...latestCompleted });
        }
        if ((mode === "review" || mode === "result") && keys.length && !cancelled) {
          const completedKeys = keys.filter((key) => String(entries[key]?.attemptStatus || "").toLowerCase() === "completed");
          let latestKey = null;
          if (completedKeys.length) {
            completedKeys.sort((a, b) => Number(entries[b]?.endTime || entries[b]?.startTime || 0) - Number(entries[a]?.endTime || entries[a]?.startTime || 0));
            latestKey = completedKeys[0];
          } else {
            keys.sort((a, b) => Number(entries[b]?.endTime || entries[b]?.startTime || 0) - Number(entries[a]?.endTime || entries[a]?.startTime || 0));
            latestKey = keys[0];
          }
          if (latestKey) {
            const rawAttempt = entries[latestKey] || {};
            setReviewAttempt({
              id: latestKey,
              ...rawAttempt,
              questionOrder: normalizeQuestionOrder(rawAttempt.questionOrder || {}),
              answers: rawAttempt.answers || {},
            });
          }
        }
        if (!cancelled) setLoading(false);
        return;
      }
      if (!cancelled) setOfflinePracticeBundle(null);

      if (isReviewOnlyMode && sid && examId) {
        const cachedBundle = await readJsonCache(getReviewCacheKey(sid, examId));
        if (cachedBundle?.reviewAttempt && Array.isArray(cachedBundle?.questions) && cachedBundle.questions.length) {
          if (!cancelled) {
            setRoundMeta(cachedBundle.roundMeta || null);
            setExamMeta(cachedBundle.examMeta || null);
            setIsCompetitive(!!cachedBundle.isCompetitive);
            setFeedbackMode(cachedBundle.feedbackMode || (cachedBundle.isCompetitive ? "end" : "instant"));
            setQuestions(cachedBundle.questions);
            setReviewAttempt({
              ...(cachedBundle.reviewAttempt || {}),
              questionOrder: normalizeQuestionOrder(cachedBundle.reviewAttempt?.questionOrder || {}),
              answers: cachedBundle.reviewAttempt?.answers || {},
            });
            setLastCompletedAttempt(cachedBundle.reviewAttempt || null);
            setLoading(false);
          }
          return;
        }
      }

      const cfgPromise = getValue([`Platform1/appConfig/exams`, `appConfig/exams`]);
      const roundMetaPromise = findRoundMetaById(roundId, examId, questionBankIdParam);
      const examPromise = getValue([
        `Platform1/companyExams/exams/${examId}`,
        `companyExams/exams/${examId}`,
        `Platform1/exams/${examId}`,
        `exams/${examId}`,
      ]);
      const livesPromise = sid && !isReviewOnlyMode
        ? getValue([`Platform1/studentLives/${sid}`, `studentLives/${sid}`])
        : Promise.resolve(null);
      const attemptsPromise = sid && examId
        ? getValue([`Platform1/attempts/company/${sid}/${examId}`, `attempts/company/${sid}/${examId}`])
        : Promise.resolve({});
      const progressPromise = sid && examId
        ? getValue([`Platform1/studentProgress/${sid}/company/${roundId}/${examId}`], { maxAgeMs: 30 * 1000 })
        : Promise.resolve({});
      const eagerQuestionLoadPromise = questionBankIdParam ? loadQuestionBank(questionBankIdParam) : null;

      const [cfg, rMeta, exam, livesNode, attemptsNodeRaw, progressNodeRaw] = await Promise.all([
        cfgPromise,
        roundMetaPromise,
        examPromise,
        livesPromise,
        attemptsPromise,
        progressPromise,
      ]);

      if (!cancelled && cfg) {
        setAppExamConfig(mergeAppExamConfig(cfg));
      }

      if (sid && !isReviewOnlyMode) {
        const defaultRefillMs = normalizeHeartRefillMs(cfg?.lives?.defaultRefillIntervalMs);
        const defaultMaxLives = Number(cfg?.lives?.defaultMaxLives || DEFAULT_MAX_LIVES);

        if (livesNode) {
          const raw = livesNode || {};
          const rawCurrent = Number(raw.currentLives ?? raw.lives ?? 0);
          const max = Number(raw.maxLives ?? raw.max ?? defaultMaxLives);

          let refillMs = defaultRefillMs;
          const refillRaw = raw.refillIntervalMs ?? raw.refillInterval ?? null;
          if (refillRaw != null) {
            const n = Number(refillRaw);
            if (Number.isFinite(n)) refillMs = normalizeHeartRefillMs(n > 1000 ? n : n * 1000, defaultRefillMs);
          }

          const lastConsumed = toMsTs(raw.lastConsumedAt ?? raw.lastConsumed ?? 0) || 0;
          let computedCurrent = Number.isFinite(rawCurrent) ? rawCurrent : 0;
          let computedLastConsumed = lastConsumed || 0;

          if (refillMs > 0 && lastConsumed && computedCurrent < max) {
            const elapsed = Math.max(0, Date.now() - lastConsumed);
            const recovered = Math.floor(elapsed / refillMs);
            if (recovered > 0) {
              computedCurrent = Math.min(max, computedCurrent + recovered);
              computedLastConsumed = lastConsumed + recovered * refillMs;
              void safeUpdate({
                [`Platform1/studentLives/${sid}/currentLives`]: computedCurrent,
                [`Platform1/studentLives/${sid}/lastConsumedAt`]: computedLastConsumed,
              }).catch(() => {});
            }
          }

          if (!cancelled) {
            setGlobalMaxLives(max || defaultMaxLives);
            setGlobalRefillMs(refillMs);
            if (livesVersionBeforeLoad === livesMutationVersionRef.current) {
              setGlobalLives(computedCurrent);
              setGlobalLastConsumedAt(computedLastConsumed || null);
            }
          }
        } else {
          const starterLives = {
            currentLives: defaultMaxLives,
            maxLives: defaultMaxLives,
            refillIntervalMs: defaultRefillMs,
            lastConsumedAt: 0,
          };

          void safeUpdate({
            [`Platform1/studentLives/${sid}`]: starterLives,
          }).catch(() => {});

          if (!cancelled) {
            setGlobalMaxLives(defaultMaxLives);
            setGlobalRefillMs(defaultRefillMs);
            if (livesVersionBeforeLoad === livesMutationVersionRef.current) {
              setGlobalLives(defaultMaxLives);
              setGlobalLastConsumedAt(null);
            }
          }
        }
      }

      if (!cancelled) setRoundMeta(rMeta || null);

      if (!cancelled) setExamMeta(exam || null);

      let pkgMeta = null;
      if (rMeta?.packageId) {
        pkgMeta = await getValue([`Platform1/companyExams/packages/${rMeta.packageId}`, `companyExams/packages/${rMeta.packageId}`]);
      }
      const competitive = String(pkgMeta?.type || "").toLowerCase() === "competitive";
      if (!cancelled) setIsCompetitive(competitive);

      const resolvedFeedbackMode = competitive ? "end" : exam?.scoringEnabled ? "end" : "instant";
      if (!cancelled) setFeedbackMode(resolvedFeedbackMode);

      let qbId = questionBankIdParam || exam?.questionBankId || null;
      if (!qbId && examId) {
        const examMap = await getValue([`Platform1/companyExams/exams`, `companyExams/exams`]);
        if (examMap?.[examId]?.questionBankId) qbId = examMap[examId].questionBankId;
      }

      const loadedQuestions = eagerQuestionLoadPromise
        ? await eagerQuestionLoadPromise
        : await loadQuestionBank(qbId);

      if (sid && examId) {
        const attemptsNode = attemptsNodeRaw || {};
        let entries = attemptsNode || {};
        if (attemptsNode && (attemptsNode.attemptStatus || attemptsNode.startTime || attemptsNode.scorePercent != null)) {
          entries = { legacy_single_attempt: attemptsNode };
        }

        const keys = Object.keys(entries || {});
        let completedCount = 0;
        let latestInProgress = null;
        let latestInProgressKey = null;
        let latestCompleted = null;
        let latestCompletedKey = null;

        for (const k of keys) {
          const a = entries[k] || {};
          const status = String(a.attemptStatus || "").toLowerCase();
          if (status === "completed") {
            completedCount += 1;
            const endT = Number(a.endTime || a.startTime || 0);
            if (!latestCompleted || endT > Number(latestCompleted.endTime || latestCompleted.startTime || 0)) {
              latestCompleted = a;
              latestCompletedKey = k;
            }
          } else if (status === "in_progress") {
            if (!latestInProgress || Number(a.startTime || 0) > Number(latestInProgress.startTime || 0)) {
              latestInProgress = a;
              latestInProgressKey = k;
            }
          }
        }

        const progressNode = progressNodeRaw || {};
        const progressAttemptsUsed = Math.max(
          Number(progressNode?.attemptsUsed || 0),
          completedCount,
          keys.length
        );
        const progressLastAttemptTs = Number(
          progressNode?.lastAttemptTimestamp ||
          progressNode?.lastSubmittedAt ||
          latestCompleted?.endTime ||
          latestCompleted?.startTime ||
          0
        );
        bestScorePercentRef.current = Math.max(
          Number(progressNode?.bestScorePercent || 0),
          getHighestCompletedScorePercent(entries)
        );

        if (!cancelled) {
          setAttemptsUsed(progressAttemptsUsed);
          setEffectiveAttemptsUsed(progressAttemptsUsed);
          setAttemptNo(progressAttemptsUsed + 1);
          setAttemptProgressAnchorTs(progressLastAttemptTs);
        }

        if (latestInProgress && latestInProgressKey && !cancelled) {
          setInProgressAttempt({ id: latestInProgressKey, ...latestInProgress });
          setAttemptId(latestInProgressKey);
          setOrder(normalizeQuestionOrder(latestInProgress.questionOrder || {}));
          setAnswers(latestInProgress.answers || {});
          if (latestInProgress.remainingSeconds != null) setTimeLeft(Number(latestInProgress.remainingSeconds));
          else if (exam?.timeLimit && latestInProgress.startTime) {
            const elapsed = Math.floor((Date.now() - Number(latestInProgress.startTime || 0)) / 1000);
            setTimeLeft(Math.max(0, Number(exam.timeLimit || 0) - elapsed));
          }
        }

        if (latestCompleted && latestCompletedKey && !cancelled) setLastCompletedAttempt({ id: latestCompletedKey, ...latestCompleted });

        if ((mode === "review" || mode === "result") && keys.length && !cancelled) {
          const completedKeys = keys.filter((k) => String(entries[k]?.attemptStatus || "").toLowerCase() === "completed");
          let latestKey = null;
          if (completedKeys.length) {
            completedKeys.sort((a, b) => Number(entries[b]?.endTime || entries[b]?.startTime || 0) - Number(entries[a]?.endTime || entries[a]?.startTime || 0));
            latestKey = completedKeys[0];
          } else {
            keys.sort((a, b) => Number(entries[b]?.endTime || entries[b]?.startTime || 0) - Number(entries[a]?.endTime || entries[a]?.startTime || 0));
            latestKey = keys[0];
          }
          if (latestKey) {
            const raw = entries[latestKey] || {};
            const normalizedReviewAttempt = {
              id: latestKey,
              ...raw,
              questionOrder: normalizeQuestionOrder(raw.questionOrder || {}),
              answers: raw.answers || {},
            };
            setReviewAttempt(normalizedReviewAttempt);

            void writeJsonCache(getReviewCacheKey(sid, examId), {
              savedAt: Date.now(),
              roundMeta: rMeta || null,
              examMeta: exam || null,
              isCompetitive: competitive,
              feedbackMode: resolvedFeedbackMode,
              questions: Array.isArray(loadedQuestions) ? loadedQuestions : [],
              reviewAttempt: normalizedReviewAttempt,
            });
          }
        }
      }

      if (!cancelled) setLoading(false);
    })();

    return () => clearInterval(timerRef.current);
  }, [roundId, examId, questionBankIdParam, mode, isReviewOnlyMode, findRoundMetaById, loadQuestionBank, practiceOfflineRequested]);

  useEffect(() => {
    if ((mode !== "review" && mode !== "result") || !reviewAttempt || !questions.length) return;

    const hydratedOrder = normalizeQuestionOrder(reviewAttempt.questionOrder || {});
    const hydratedAnswers = reviewAttempt.answers || {};
    const resolvedOrder = hydratedOrder.length ? hydratedOrder : questions.map((item) => item.id);
    const totalFromAttempt = Number(reviewAttempt.totalQuestions ?? reviewAttempt.total ?? resolvedOrder.length ?? 0);

    setOrder(resolvedOrder);
    setAnswers(hydratedAnswers);
    setResult({
      percent: Number(reviewAttempt.scorePercent || 0),
      correct: Number(reviewAttempt.correctCount || 0),
      total: totalFromAttempt,
      badge: reviewAttempt.badge || null,
      points: reviewAttempt.pointsAwarded,
      resultVisible: reviewAttempt.resultVisible !== false,
    });
    setReviewIndex(0);
    setShowPostSubmitReview(true);
    setStage("result");
  }, [mode, reviewAttempt, questions]);

  useEffect(() => {
    if (stage !== "result") return;

  resultPop.setValue(0);
  resultConfetti.setValue(0);

  Animated.parallel([
    Animated.spring(resultPop, {
      toValue: 1,
      useNativeDriver: true,
      friction: 6,
      tension: 90,
    }),
    Animated.timing(resultConfetti, {
      toValue: 1,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }),
  ]).start();

  const pulseLoop = Animated.loop(
    Animated.sequence([
      Animated.timing(resultPulse, { toValue: 1.05, duration: 700, useNativeDriver: true }),
      Animated.timing(resultPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
    ])
  );
  pulseLoop.start();

  return () => {
    pulseLoop.stop();
    resultPulse.setValue(1);
  };
}, [stage, resultPop, resultConfetti, resultPulse]);


  useEffect(() => {
    if (outOfLivesModalVisible) Animated.spring(outModalAnim, { toValue: 1, useNativeDriver: true }).start();
    else Animated.timing(outModalAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
  }, [outOfLivesModalVisible, outModalAnim]);

  useEffect(() => {
    if (showHeartInfoModal) Animated.spring(heartModalAnim, { toValue: 1, useNativeDriver: true }).start();
    else Animated.timing(heartModalAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
  }, [showHeartInfoModal, heartModalAnim]);

  useEffect(() => {
    if (globalLives == null) {
      setNextHeartInMs(0);
      return undefined;
    }

    const refreshHeartCountdown = () => {
      const state = computeRefillState({
        currentLives: globalLives,
        maxLives: globalMaxLives,
        lastConsumedAt: globalLastConsumedAt,
        refillMs: globalRefillMs,
      });
      setNextHeartInMs(state.nextInMs);
    };

    refreshHeartCountdown();

    if (Number(globalLives || 0) >= Number(globalMaxLives || 0) || !Number(globalRefillMs || 0)) {
      return undefined;
    }

    const intervalId = setInterval(refreshHeartCountdown, 1000);
    return () => clearInterval(intervalId);
  }, [globalLives, globalMaxLives, globalLastConsumedAt, globalRefillMs]);

  useEffect(() => {
    clearTimeout(heartSyncTimeoutRef.current);

    if (globalLives == null) {
      return undefined;
    }

    let cancelled = false;

    const syncRecoveredHearts = async () => {
      const state = computeRefillState({
        currentLives: globalLives,
        maxLives: globalMaxLives,
        lastConsumedAt: globalLastConsumedAt,
        refillMs: globalRefillMs,
      });

      if (state.recovered <= 0 || !studentId) return;

      try {
        if (isOfflinePracticeMode) {
          await writePracticeLives(studentId, {
            currentLives: state.currentLives,
            maxLives: globalMaxLives,
            refillIntervalMs: globalRefillMs,
            lastConsumedAt: state.lastConsumedAt,
          }, {
            defaultMaxLives: globalMaxLives,
            defaultRefillIntervalMs: globalRefillMs,
          });
        } else {
          await safeUpdate({
            [`Platform1/studentLives/${studentId}/currentLives`]: state.currentLives,
            [`Platform1/studentLives/${studentId}/lastConsumedAt`]: state.lastConsumedAt,
          });
        }

        if (!cancelled) {
          setGlobalLives(state.currentLives);
          setGlobalLastConsumedAt(state.lastConsumedAt);
        }
      } catch (e) {
        console.warn("heart refill sync failed", e);
      }
    };

    const state = computeRefillState({
      currentLives: globalLives,
      maxLives: globalMaxLives,
      lastConsumedAt: globalLastConsumedAt,
      refillMs: globalRefillMs,
    });

    if (state.recovered > 0) {
      syncRecoveredHearts().catch(() => {});
    } else if (state.nextInMs > 0 && Number(globalLives || 0) < Number(globalMaxLives || 0)) {
      heartSyncTimeoutRef.current = setTimeout(() => {
        syncRecoveredHearts().catch(() => {});
      }, state.nextInMs + 50);
    }

    return () => {
      cancelled = true;
      clearTimeout(heartSyncTimeoutRef.current);
    };
  }, [studentId, globalLives, globalMaxLives, globalLastConsumedAt, globalRefillMs, isOfflinePracticeMode]);

  useEffect(() => {
    if (!studentId || !roundId || !examId || !examMeta) {
      setEffectiveAttemptsUsed(Number(attemptsUsed || 0));
      return undefined;
    }

    const refillEnabled =
      examMeta?.attemptRefillEnabled !== false &&
      appExamConfig?.attempts?.practiceRefillEnabled !== false;

    const refillMs = Number(
      examMeta?.attemptRefillIntervalMs ??
      appExamConfig?.attempts?.defaultRefillIntervalMs ??
      0
    );

    const refreshAttemptCountdown = () => {
      if (isCompetitive || !refillEnabled || !refillMs || !attemptProgressAnchorTs) {
        setEffectiveAttemptsUsed(Number(attemptsUsed || 0));
        return;
      }

      const state = computeAttemptRefillState({
        attemptsUsed,
        lastAttemptTimestamp: attemptProgressAnchorTs,
        refillMs,
      });

      setEffectiveAttemptsUsed(state.effectiveAttemptsUsed);
    };

    refreshAttemptCountdown();

    if (isCompetitive || !refillEnabled || !refillMs || !attemptProgressAnchorTs || Number(attemptsUsed || 0) <= 0) {
      return undefined;
    }

    const intervalId = setInterval(refreshAttemptCountdown, 1000);
    return () => clearInterval(intervalId);
  }, [studentId, roundId, examId, examMeta, appExamConfig?.attempts, isCompetitive, attemptsUsed, attemptProgressAnchorTs]);

  useEffect(() => {
    clearTimeout(attemptSyncTimeoutRef.current);

    if (!studentId || !roundId || !examId || !examMeta || isCompetitive) {
      return undefined;
    }

    const refillEnabled =
      examMeta?.attemptRefillEnabled !== false &&
      appExamConfig?.attempts?.practiceRefillEnabled !== false;

    const refillMs = Number(
      examMeta?.attemptRefillIntervalMs ??
      appExamConfig?.attempts?.defaultRefillIntervalMs ??
      0
    );

    const usedRaw = Number(attemptsUsed || 0);
    const lastTs = Number(attemptProgressAnchorTs || 0);

    if (!refillEnabled || !refillMs || !lastTs || usedRaw <= 0) {
      return undefined;
    }

    let cancelled = false;

    const syncRecoveredAttempts = async () => {
      const state = computeAttemptRefillState({
        attemptsUsed: usedRaw,
        lastAttemptTimestamp: lastTs,
        refillMs,
      });

      if (state.effectiveAttemptsUsed === usedRaw) return;

      if (isOfflinePracticeMode) {
        await updatePracticeExamProgress(studentId, examId, (current) => ({
          ...current,
          attemptsUsed: state.effectiveAttemptsUsed,
          lastAttemptTimestamp: state.anchorTs,
        })).catch(() => {});
      } else {
        await safeUpdate({
          [`Platform1/studentProgress/${studentId}/company/${roundId}/${examId}/attemptsUsed`]: state.effectiveAttemptsUsed,
          [`Platform1/studentProgress/${studentId}/company/${roundId}/${examId}/lastAttemptTimestamp`]: state.anchorTs,
        }).catch(() => {});
      }

      if (!cancelled) {
        setAttemptsUsed(state.effectiveAttemptsUsed);
        setEffectiveAttemptsUsed(state.effectiveAttemptsUsed);
        setAttemptNo(state.effectiveAttemptsUsed + 1);
        setAttemptProgressAnchorTs(state.anchorTs);
      }
    };

    const state = computeAttemptRefillState({
      attemptsUsed: usedRaw,
      lastAttemptTimestamp: lastTs,
      refillMs,
    });

    if (state.effectiveAttemptsUsed !== usedRaw) {
      syncRecoveredAttempts().catch(() => {});
    } else if (state.nextInMs > 0) {
      attemptSyncTimeoutRef.current = setTimeout(() => {
        syncRecoveredAttempts().catch(() => {});
      }, state.nextInMs + 50);
    }

    return () => {
      cancelled = true;
      clearTimeout(attemptSyncTimeoutRef.current);
    };
  }, [studentId, roundId, examId, examMeta, appExamConfig?.attempts, isCompetitive, attemptsUsed, attemptProgressAnchorTs, isOfflinePracticeMode]);

  const persistStartAttempt = useCallback(async (qOrder) => {
    if (!studentId || !examId) return null;

    const startedAt = Date.now();

    const baseAttempt = {
      roundId,
      attemptNo,
      attemptStatus: "in_progress",
      startTime: startedAt,
      questionOrder: qOrder,
      answers: {},
      scorePercent: null,
      pointsAwarded: 0,
      badge: null,
      rankingCounted: false,
      resultVisible: false,
      feedbackMode,
    };

    if (isOfflinePracticeMode) {
      const newAttemptId = createLocalAttemptId();
      await updatePracticeExamProgress(studentId, examId, (current) => {
        const attempts = { ...(current.attempts || {}) };
        attempts[newAttemptId] = baseAttempt;
        return {
          ...current,
          status: "in_progress",
          attemptsUsed: Number(current.attemptsUsed || 0) + 1,
          lastAttemptId: newAttemptId,
          lastAttemptTimestamp: startedAt,
          attempts,
        };
      }).catch(() => {});

      setInProgressAttempt({ id: newAttemptId, ...baseAttempt });
      setAttemptId(newAttemptId);
      setAttemptsUsed((p) => Number(p || 0) + 1);
      setEffectiveAttemptsUsed((p) => Number(p || 0) + 1);
      setAttemptNo((p) => Number(p || 1) + 1);
      setAttemptProgressAnchorTs(startedAt);

      wrongCountRef.current = 0;
      return newAttemptId;
    }

    const newAttemptId = await pushAndSet(`Platform1/attempts/company/${studentId}/${examId}`, baseAttempt);
    setInProgressAttempt({ id: newAttemptId, ...baseAttempt });
    setAttemptId(newAttemptId);

    try {
      const progressPath = `Platform1/studentProgress/${studentId}/company/${roundId}/${examId}/attemptsUsed`;
      await runTransactionSafe(progressPath, (current = 0) => Number(current || 0) + 1);
      await safeUpdate({ [`Platform1/studentProgress/${studentId}/company/${roundId}/${examId}/lastAttemptTimestamp`]: startedAt }).catch(() => {});
    } catch {}

    setAttemptsUsed((p) => Number(p || 0) + 1);
    setEffectiveAttemptsUsed((p) => Number(p || 0) + 1);
    setAttemptNo((p) => Number(p || 1) + 1);
    setAttemptProgressAnchorTs(startedAt);

    wrongCountRef.current = 0;
    return newAttemptId;
  }, [studentId, examId, roundId, attemptNo, feedbackMode, isOfflinePracticeMode]);

  const attemptsUsedForUI = Number.isFinite(effectiveAttemptsUsed)
    ? effectiveAttemptsUsed
    : Number(attemptsUsed || 0);
  const maxAttemptsAllowed = isCompetitive ? 1 : Number(examMeta?.maxAttempts || 1);
  const attemptsLeft = Math.max(0, maxAttemptsAllowed - attemptsUsedForUI);

  const consumeCompetitiveExamHeart = useCallback(async () => {
    if (!studentId) return true;

    const currentLives = Number(globalLives ?? 0);
    if (currentLives <= 0) {
      setOutOfLivesModalVisible(true);
      return false;
    }

    const livesPath = `Platform1/studentLives/${studentId}`;
    const now = Date.now();

    try {
      const transactionResult = await runTransactionSafe(livesPath, (currentNode) => {
        const raw = currentNode && typeof currentNode === "object" ? currentNode : {};
        const resolvedMaxLives = Number(raw.maxLives ?? globalMaxLives ?? DEFAULT_MAX_LIVES);
        const resolvedRefillMs = normalizeHeartRefillMs(raw.refillIntervalMs ?? raw.refillInterval ?? globalRefillMs ?? DEFAULT_HEART_REFILL_MS);
        const consumedLives = buildQueuedHeartConsumption({
          currentLives: raw.currentLives ?? raw.current ?? currentLives,
          maxLives: resolvedMaxLives,
          lastConsumedAt: toMsTs(raw.lastConsumedAt ?? raw.lastConsumed ?? globalLastConsumedAt ?? 0),
          refillMs: resolvedRefillMs,
          now,
        });

        if (!consumedLives) return;

        return {
          ...raw,
          currentLives: consumedLives.currentLives,
          maxLives: resolvedMaxLives,
          refillIntervalMs: resolvedRefillMs,
          lastConsumedAt: consumedLives.lastConsumedAt,
        };
      });

      if (!transactionResult?.committed) {
        setOutOfLivesModalVisible(true);
        return false;
      }

      const updatedLives = transactionResult?.snapshot?.exists?.() ? transactionResult.snapshot.val() || {} : null;
      if (updatedLives) {
        setGlobalLives(Number(updatedLives.currentLives ?? updatedLives.current ?? Math.max(0, currentLives - 1)));
        setGlobalLastConsumedAt(toMsTs(updatedLives.lastConsumedAt ?? updatedLives.lastConsumed ?? now));
      } else {
        setGlobalLives(Math.max(0, currentLives - 1));
        setGlobalLastConsumedAt(Number(globalLastConsumedAt || 0) || now);
      }
      return true;
    } catch (e) {
      console.warn("consumeCompetitiveExamHeart failed", e);
      return true;
    }
  }, [studentId, globalLives, globalLastConsumedAt, globalMaxLives, globalRefillMs]);

  const startExam = useCallback(async () => {
    if (!examMeta) return Alert.alert("Cannot start", "Exam metadata unavailable.");

    const maxAttempts = isCompetitive ? 1 : Number(examMeta?.maxAttempts || 1);
    if (attemptsUsedForUI >= maxAttempts && !inProgressAttempt) return;

    if (examMeta?.scoringEnabled && (!questions || questions.length === 0)) {
      return Alert.alert("Cannot start", questionLoadError || "Question bank not loaded yet.");
    }

    if (globalLives === 0) {
      setOutOfLivesModalVisible(true);
      return;
    }

    const ids = questions.map((q) => q.id);
    if (!ids.length) return Alert.alert("No questions", "Question data not found for this exam.");
    if (inProgressAttempt && attemptId) return Alert.alert("Resume available", "You have an unfinished attempt. Use Resume Test.");

    if (isCompetitive) {
      const consumed = await consumeCompetitiveExamHeart();
      if (!consumed) return;
    }

    const qOrder = shuffleArray(ids);
    setOrder(qOrder);
    setAnswers({});
    setCurrentIndex(0);
    setSelectedFeedback(null);
    setShowAnswerRequiredWarning(false);
    setTimeLeft(Number(examMeta?.timeLimit || 600));

    const aId = await persistStartAttempt(qOrder);
    setAttemptId(aId);

    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          submitExam();
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    setStage("exam");
  }, [examMeta, attemptsUsedForUI, inProgressAttempt, questions, questionLoadError, isCompetitive, globalLives, attemptId, persistStartAttempt, submitExam, consumeCompetitiveExamHeart]);

  const resumeExam = useCallback(() => {
    if (!inProgressAttempt || !attemptId) return Alert.alert("No attempt to resume");

    const normalizedOrder = normalizeQuestionOrder(inProgressAttempt.questionOrder || {});
    if (!order.length && normalizedOrder.length) setOrder(normalizedOrder);
    if (inProgressAttempt.answers) setAnswers(inProgressAttempt.answers || {});
    setSelectedFeedback(null);
    setShowAnswerRequiredWarning(false);

    if (inProgressAttempt.remainingSeconds != null) setTimeLeft(Number(inProgressAttempt.remainingSeconds));
    else if (inProgressAttempt.startTime && examMeta?.timeLimit) {
      const elapsed = Math.floor((Date.now() - Number(inProgressAttempt.startTime || 0)) / 1000);
      setTimeLeft(Math.max(0, Number(examMeta.timeLimit || 600) - elapsed));
    } else setTimeLeft(Number(examMeta?.timeLimit || 600));

    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { clearInterval(timerRef.current); submitExam(); return 0; }
        return t - 1;
      });
    }, 1000);

    setStage("exam");
  }, [inProgressAttempt, attemptId, order.length, examMeta, submitExam]);

  const setAnswer = useCallback(async (qId, optionKey) => {
    if (stage !== "exam") return;
    if (!isCompetitive && feedbackMode === "instant" && answers?.[qId] != null) return;

    setAnswers((p) => ({ ...p, [qId]: optionKey }));
    setShowAnswerRequiredWarning(false);

    const q = questions.find((x) => x.id === qId);
    if (q) {
      const correct = String(q.correctAnswer || "") === String(optionKey || "");
      if (!isCompetitive && feedbackMode === "instant") {
        setSelectedFeedback(correct ? "correct" : "wrong");
        Vibration.vibrate(20);
      }
      if (!isCompetitive && !correct) wrongCountRef.current = Number(wrongCountRef.current || 0) + 1;
    }

    if (!studentId || !examId || !attemptId) return;
    if (isOfflinePracticeMode) {
      await updatePracticeExamProgress(studentId, examId, (current) => {
        const attempts = { ...(current.attempts || {}) };
        const currentAttempt = { ...(attempts[String(attemptId)] || {}) };
        attempts[String(attemptId)] = {
          ...currentAttempt,
          answers: {
            ...(currentAttempt.answers || {}),
            [qId]: optionKey,
          },
        };
        return {
          ...current,
          attempts,
        };
      }).catch(() => {});
      return;
    }
    await safeUpdate({ [`Platform1/attempts/company/${studentId}/${examId}/${attemptId}/answers/${qId}`]: optionKey }).catch(() => {});
  }, [stage, feedbackMode, answers, questions, isCompetitive, studentId, examId, attemptId, isOfflinePracticeMode]);

  const prevQ = useCallback(() => {
    setSelectedFeedback(null);
    setShowAnswerRequiredWarning(false);
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  }, [currentIndex]);

  const nextQ = useCallback(() => {
    const currentQuestionId = order[currentIndex] || questions[currentIndex]?.id;
    const hasSelectedAnswer = currentQuestionId != null && answers?.[currentQuestionId] != null;

    if (!hasSelectedAnswer) {
      setShowAnswerRequiredWarning(true);
      return;
    }

    setSelectedFeedback(null);
    setShowAnswerRequiredWarning(false);
    if (currentIndex < (order.length || questions.length) - 1) setCurrentIndex((i) => i + 1);
    else submitExam();
  }, [currentIndex, order, questions, answers, submitExam]);

  const canStart = useMemo(() => {
    if (loading) return { ok: false, reason: "Preparing exam..." };
    if (!examMeta) return { ok: false, reason: "Exam metadata unavailable." };
    if (examMeta?.scoringEnabled && (!questions || questions.length === 0)) {
      if (questionLoadError) return { ok: false, reason: questionLoadError };
      return { ok: false, reason: "Question bank not loaded yet. Try again in a moment." };
    }

    const maxAttempts = isCompetitive ? 1 : Number(examMeta?.maxAttempts || 1);

    if (isCompetitive && lastCompletedAttempt && !inProgressAttempt) {
      return { ok: false, reason: "You already took this exam. Wait until points are released." };
    }

    if (attemptsUsedForUI >= maxAttempts && !inProgressAttempt) {
      return { ok: false, reason: isCompetitive ? "You already took this exam. Wait until points are released." : "No attempts left for this exam." };
    }

    const roundWindow = getRoundWindow(roundMeta);
    if (roundWindow.hasWindow && !roundWindow.ok) {
      return { ok: false, reason: roundWindow.reason || "This exam is outside the allowed time window." };
    }

    return { ok: true, reason: "" };
  }, [loading, examMeta, questions, questionLoadError, attemptsUsedForUI, inProgressAttempt, isCompetitive, lastCompletedAttempt, roundMeta]);

  const qId = order[currentIndex];
  const q = questions.find((x) => x.id === qId);
  const currentQuestionAnswered = q?.id != null && answers?.[q.id] != null;

  const totalQ = Math.max(1, order.length || questions.length || 1);
  const examProgressPct = Math.min(100, Math.max(0, ((currentIndex + 1) / totalQ) * 100));

  const passingPercent = practicePassPercent;
  const hasPassPercent = !isCompetitive;
  const failedPracticeExam = !isCompetitive && !!result && !isPass;
  const heartCountdownLabel = globalLives != null && Number(globalLives || 0) < Number(globalMaxLives || 0) && Number(nextHeartInMs || 0) > 0
    ? formatMsToMMSS(nextHeartInMs)
    : null;

  const instructionsList = useMemo(() => {
    const src = examMeta?.instructions ?? examMeta?.instruction ?? examMeta?.rules ?? [];
    if (Array.isArray(src)) return src.filter(Boolean).map((x) => String(x));
    if (typeof src === "object") return Object.keys(src).map((k) => src[k]).filter(Boolean).map((x) => String(x));
    if (typeof src === "string" && src.trim()) return [src.trim()];
    return [];
  }, [examMeta]);

  const showWarmRulesShell = loading && stage === "rules" && !!examMeta;

  if (loading && !showWarmRulesShell) {
    return (
      <PageLoadingSkeleton variant="detail" style={[styles.loadingWrap, { paddingTop: insets.top }]} />
    );
  }

  return (
    <SafeAreaView style={styles.safeRoot}>
      <StatusBar barStyle={statusBarStyle} backgroundColor={colors.background} />

      <Modal visible={outOfLivesModalVisible} transparent animationType="none" onRequestClose={() => {}}>
        <View style={modalStyles.overlay}>
          <Animated.View style={[modalStyles.card, { transform: [{ scale: outModalAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }], opacity: outModalAnim }]}>
            <Text style={modalStyles.title}>You&apos;re out of lives</Text>
            <Text style={modalStyles.text}>You have no global lives left to continue practicing.</Text>
            <Text style={[modalStyles.countdown, { marginTop: 12 }]}>Next life in {formatMsToMMSS(nextHeartInMs)}</Text>
            <TouchableOpacity style={modalStyles.closeBtn} onPress={() => setOutOfLivesModalVisible(false)}>
              <Text style={modalStyles.closeBtnText}>OK</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      <Modal visible={showFeedbackInfoModal} animationType="slide" transparent onRequestClose={() => setShowFeedbackInfoModal(false)}>
        <View style={modalStyles.overlay}>
          <View style={modalStyles.card}>
            <Text style={modalStyles.title}>Feedback modes</Text>
            <Text style={modalStyles.modeTitle}>Instant</Text>
            <Text style={modalStyles.modeText}>After answering, immediate correctness is shown and choice is locked.</Text>
            <Text style={modalStyles.modeTitle}>End of exam</Text>
            <Text style={modalStyles.modeText}>You can change answers until submit.</Text>
            <TouchableOpacity style={modalStyles.closeBtnPrimary} onPress={() => setShowFeedbackInfoModal(false)}>
              <Text style={modalStyles.closeBtnTextPrimary}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={styles.root}>
        {stage === "rules" && (
          <View style={styles.panel}>
            <View style={[styles.headerBar, { paddingTop: insets.top + 8 }]}>
              <TouchableOpacity onPress={handleBackNavigation} style={styles.backBtn}><Ionicons name="chevron-back" size={22} color={colors.text} /></TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{examMeta?.name || "Practice Test"}</Text>
                <Text style={styles.subtitle}>{roundMeta?.name || ""}</Text>
              </View>
              <TouchableOpacity style={styles.headerLivesButton} onPress={() => setShowHeartInfoModal(true)}>
                <View style={styles.headerLivesRow}>
                  {heartCountdownLabel ? (
                    <Text style={styles.headerLivesTimer}>{heartCountdownLabel}</Text>
                  ) : null}
                  <Ionicons name={globalLives != null && globalLives > 0 ? "heart" : "heart-outline"} size={18} color={globalLives != null && globalLives > 0 ? HEART_COLOR : colors.muted} />
                  <Text style={styles.headerLivesCount}>{globalLives != null ? `${globalLives}` : `—`}</Text>
                </View>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.body}>
              <Text style={styles.mainTitle}>Rules</Text>

              <View style={styles.rulesInfoColumn}>
                <View style={styles.rulesRow}>
                  <View style={styles.rulesIconWrap}><Ionicons name="list-outline" size={20} color={C.primary} /></View>
                  <View style={styles.rulesTextWrap}>
                    <Text style={styles.rulesNumber}>{examMeta?.totalQuestions ?? questions.length} questions</Text>
                    <Text style={styles.rulesLabel}>Number of questions</Text>
                  </View>
                </View>

                <View style={styles.rulesRow}>
                  <View style={styles.rulesIconWrap}><Ionicons name="time-outline" size={20} color={C.primary} /></View>
                  <View style={styles.rulesTextWrap}>
                    <Text style={styles.rulesNumber}>{formatTime(examMeta?.timeLimit ?? 0)}</Text>
                    <Text style={styles.rulesLabel}>Time limit</Text>
                  </View>
                </View>

                <View style={styles.rulesRow}>
                  <View style={styles.rulesIconWrap}><Ionicons name="ticket-outline" size={20} color={C.primary} /></View>
                  <View style={styles.rulesTextWrap}>
                    <Text style={styles.rulesNumber}>{Number(attemptsUsedForUI || 0)} / {maxAttemptsAllowed}</Text>
                    <Text style={styles.rulesLabel}>{isCompetitive ? "Attempt used" : "Attempts used"}</Text>
                  </View>
                </View>

                {!isCompetitive && hasPassPercent ? (
                  <View style={styles.rulesRow}>
                    <View style={styles.rulesIconWrap}><Ionicons name="shield-checkmark-outline" size={20} color={C.primary} /></View>
                    <View style={styles.rulesTextWrap}>
                      <Text style={styles.rulesNumber}>{passingPercent}%</Text>
                      <Text style={styles.rulesLabel}>Passing score (practice)</Text>
                    </View>
                  </View>
                ) : null}

                {examMeta?.rankingEnabled ? (
                  <View style={styles.rulesRow}>
                    <View style={styles.rulesIconWrap}><Ionicons name="trophy-outline" size={20} color={C.primary} /></View>
                    <View style={styles.rulesTextWrap}>
                      <Text style={styles.rulesNumber}>Ranking Enabled</Text>
                      <Text style={styles.rulesLabel}>This attempt contributes to leaderboard</Text>
                    </View>
                  </View>
                ) : null}
              </View>

              {!!instructionsList.length && (
                <View style={styles.infoCard}>
                  <Text style={styles.infoTitle}>Instructions</Text>
                  {instructionsList.map((line, idx) => (
                    <Text key={`${line}_${idx}`} style={styles.infoText}>• {line}</Text>
                  ))}
                </View>
              )}

              {attemptsLeft <= 0 && !inProgressAttempt ? (
                <View style={styles.noAttemptsCard}>
                  <TouchableOpacity
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                    onPress={() => setShowAttemptsExhaustedDetails((p) => !p)}
                    activeOpacity={0.8}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Ionicons name="alert-circle-outline" size={20} color="#C2410C" />
                      <Ionicons name="alert-circle-outline" size={20} color={colors.warningText} />
                      <Text style={styles.noAttemptsTitle}>Attempts exhausted</Text>
                    </View>
                    <Ionicons name={showAttemptsExhaustedDetails ? "chevron-up" : "chevron-down"} size={18} color={colors.warningText} />
                  </TouchableOpacity>

                  {showAttemptsExhaustedDetails ? (
                    <>
                      <Text style={styles.noAttemptsSub}>
                        {isCompetitive
                          ? "You already took this exam. Wait until points are released."
                          : "You used all attempts for this exam."}
                      </Text>
                    </>
                  ) : null}
                </View>
              ) : null}

              {!isCompetitive && (
                <View style={styles.feedbackRow}>
                  <Text style={{ fontWeight: "800", color: colors.text, marginRight: 8 }}>Feedback</Text>
                  <View style={{ flexDirection: "row" }}>
                    <TouchableOpacity style={[styles.toggleBtn, feedbackMode === "instant" ? styles.toggleOn : styles.toggleOff]} onPress={() => setFeedbackMode("instant")}>
                      <Text style={feedbackMode === "instant" ? styles.toggleTextOn : styles.toggleTextOff}>Instant</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.toggleBtn, feedbackMode === "end" ? styles.toggleOn : styles.toggleOff]} onPress={() => setFeedbackMode("end")}>
                      <Text style={feedbackMode === "end" ? styles.toggleTextOn : styles.toggleTextOff}>End of exam</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={{ marginLeft: 10 }} onPress={() => setShowFeedbackInfoModal(true)}>
                    <Ionicons name="information-circle-outline" size={18} color={colors.muted} />
                  </TouchableOpacity>
                </View>
              )}

              {questionLoadError ? <Text style={styles.warning}>{questionLoadError}</Text> : null}
              {!canStart.ok && !questionLoadError && !(isCompetitive && attemptsLeft <= 0 && !inProgressAttempt) ? (
                <Text style={styles.warning}>{canStart.reason}</Text>
              ) : null}

              {inProgressAttempt && attemptId ? (
                <TouchableOpacity style={styles.primaryBtn} onPress={resumeExam}>
                  <Text style={styles.primaryBtnText}>Resume Test</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.primaryBtn, !canStart.ok ? { opacity: 0.55 } : null]} disabled={!canStart.ok} onPress={startExam}>
                  <Text style={styles.primaryBtnText}>Start Test</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        )}

        {stage === "exam" && (
          <View style={styles.panel}>
            <View style={[styles.headerBar, { paddingTop: insets.top + 8 }]}>
              <TouchableOpacity onPress={handleBackNavigation} style={styles.backBtn}><Ionicons name="chevron-back" size={22} color={colors.text} /></TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{examMeta?.name || "Exam"}</Text>
                <Text style={styles.subtitle}>Question {Math.min(currentIndex + 1, totalQ)} / {totalQ}</Text>
              </View>
              <View style={styles.timerPill}>
                <Ionicons name="time-outline" size={16} color={C.primary} />
                <Text style={styles.timer}>{formatTime(timeLeft)}</Text>
              </View>
            </View>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${examProgressPct}%` }]} />
            </View>

            <ScrollView contentContainerStyle={styles.examBody}>
              {!q ? (
                <Text style={styles.warning}>Question not available.</Text>
              ) : (
                <>
                  <View style={styles.qCard}>
                    <Text style={styles.qText}>{q.question}</Text>
                  </View>

                  {Object.keys(q.options || {}).map((optKey) => {
                    const selected = answers?.[q.id] === optKey;
                    const showInstant = !isCompetitive && feedbackMode === "instant" && answers?.[q.id] != null;
                    const isCorrectOpt = String(q.correctAnswer || "") === String(optKey);
                    const isWrongSel = selected && !isCorrectOpt;

                    return (
                      <TouchableOpacity
                        key={optKey}
                        disabled={showInstant}
                        onPress={() => setAnswer(q.id, optKey)}
                        style={[
                          styles.option,
                          styles.optionDefault,
                          selected ? styles.optionSelected : null,
                          showInstant && isCorrectOpt ? styles.correctFlash : null,
                          showInstant && isWrongSel ? styles.wrongFlash : null,
                        ]}
                      >
                        <View style={[styles.optBadge, selected ? styles.optBadgeSel : styles.optBadgeDef]}>
                          <Text style={styles.optLetter}>{optKey}</Text>
                        </View>
                        <Text style={[styles.optText, selected ? styles.optTextSel : null]}>{q.options[optKey]}</Text>
                      </TouchableOpacity>
                    );
                  })}

                  {!isCompetitive && feedbackMode === "instant" && selectedFeedback ? (
                    <Text style={{ marginTop: 10, fontWeight: "800", color: selectedFeedback === "correct" ? C.success : C.danger }}>
                      {selectedFeedback === "correct" ? "Correct ✅" : "Wrong ❌"}
                    </Text>
                  ) : null}

                  {!isCompetitive && feedbackMode === "instant" && answers?.[q?.id] != null && q?.explanation ? (
                    <View style={styles.explanationCard}>
                      <Text style={styles.explanationTitle}>Explanation</Text>
                      <Text style={styles.explanationText}>{q.explanation}</Text>
                    </View>
                  ) : null}
                </>
              )}
            </ScrollView>

            {showAnswerRequiredWarning ? (
              <Text style={[styles.warning, { marginHorizontal: 16, marginTop: 0 }]}>Choose one answer before continuing.</Text>
            ) : null}

            <View
              style={[
                styles.footer,
                {
                  marginBottom:
                    Platform.OS === "android"
                      ? Math.max(insets.bottom + 12, 28)
                      : Math.max(insets.bottom, 12),
                },
              ]}
            >
              <TouchableOpacity style={styles.ghostBtn} onPress={prevQ} disabled={currentIndex <= 0}>
                <Text style={styles.ghostTxt}>Previous</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtnSmall, !currentQuestionAnswered ? { opacity: 0.82 } : null]} onPress={nextQ}>
                <Text style={styles.primaryBtnText}>{currentIndex < totalQ - 1 ? "Next" : "Submit"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {stage === "result" && showPostSubmitReview && (
          <View style={styles.panel}>
            <View style={[styles.headerBar, { paddingTop: insets.top + 8 }]}>
              <TouchableOpacity onPress={handleBackNavigation} style={styles.backBtn}>
                <Ionicons name="chevron-back" size={22} color={colors.text} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Review Answers</Text>
                <Text style={styles.subtitle}>{reviewIndex + 1} / {totalQ}</Text>
              </View>
              <Text style={{ fontWeight: "900", color: C.primary }}>{Math.round(Number(result?.percent || 0))}%</Text>
            </View>

            {(() => {
              const rqId = order[reviewIndex];
              const rq = questions.find((x) => x.id === rqId);
              if (!rq) return <Text style={styles.warning}>Review question unavailable.</Text>;

              const selected = answers?.[rq.id];
              const correct = rq.correctAnswer;
              const isCorrect = String(selected || "") === String(correct || "");

              return (
                <ScrollView contentContainerStyle={styles.examBody}>
                  <View style={styles.qCard}>
                    <Text style={styles.qText}>{rq.question}</Text>
                  </View>

                  {Object.keys(rq.options || {}).map((optKey) => {
                    const isSel = selected === optKey;
                    const isRight = String(correct) === String(optKey);

                    return (
                      <View
                        key={optKey}
                        style={[
                          styles.option,
                          styles.optionDefault,
                          isRight ? styles.correctFlash : null,
                          isSel && !isRight ? styles.wrongFlash : null,
                        ]}
                      >
                        <View style={[styles.optBadge, styles.optBadgeDef]}>
                          <Text style={styles.optLetter}>{optKey}</Text>
                        </View>
                        <Text style={styles.optText}>
                          {rq.options[optKey]}
                          {isSel ? " • your answer" : ""}
                          {isRight ? " • correct" : ""}
                        </Text>
                      </View>
                    );
                  })}

                  <View style={styles.explanationCard}>
                    <Text style={[styles.explanationTitle, { color: isCorrect ? C.success : C.danger }]}>
                      {isCorrect ? "Correct ✅" : "Incorrect ❌"}
                    </Text>
                    {!!rq.explanation && <Text style={styles.explanationText}>{rq.explanation}</Text>}
                  </View>
                </ScrollView>
              );
            })()}

            <View
              style={[
                styles.footer,
                {
                  marginBottom:
                    Platform.OS === "android"
                      ? Math.max(insets.bottom + 12, 28)
                      : Math.max(insets.bottom, 12),
                },
              ]}
            >
              <TouchableOpacity style={styles.ghostBtn} disabled={reviewIndex <= 0} onPress={() => setReviewIndex((i) => Math.max(0, i - 1))}>
                <Text style={styles.ghostTxt}>Previous</Text>
              </TouchableOpacity>
              {reviewIndex < totalQ - 1 ? (
                <TouchableOpacity style={styles.primaryBtnSmall} onPress={() => setReviewIndex((i) => i + 1)}>
                  <Text style={styles.primaryBtnText}>Next</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.primaryBtnSmall} onPress={handleBackNavigation}>
                  <Text style={styles.primaryBtnText}>Finish</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

{stage === "result" && !showPostSubmitReview && (
  <View style={styles.resultScreen}>
    <Animated.View
      style={[
        styles.resultBgOrnament,
        {
          opacity: resultConfetti.interpolate({ inputRange: [0, 1], outputRange: [0, 0.25] }),
          transform: [{ scale: resultConfetti.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.1] }) }],
        },
      ]}
    />

    <View style={styles.resultCenter}>
      <Animated.View
        style={[
          styles.resultCard,
          {
            opacity: resultPop,
            transform: [
              { scale: resultPop.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) },
              { translateY: resultPop.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
            ],
          },
        ]}
      >
        <View style={styles.resultGlowTop} />
        <View style={styles.resultGlowBottom} />

        <Animated.View style={{ transform: [{ scale: resultPulse }] }}>
          <View
            style={[
              styles.resultBadgeBubble,
              failedPracticeExam
                ? { backgroundColor: C.danger, borderColor: "rgba(239,68,68,0.18)" }
                : null,
            ]}
          >
            <Ionicons
              name={
                isCompetitive && !result?.resultVisible
                  ? "time-outline"
                  : failedPracticeExam
                  ? "close-circle"
                  : "checkmark-circle"
              }
              size={42}
              color="#fff"
            />
          </View>
        </Animated.View>

        <Text style={styles.resultTitle}>
          {isCompetitive && !result?.resultVisible ? "Exam Submitted" : failedPracticeExam ? "Failed" : "Exam Completed"}
        </Text>

        {isCompetitive && !result?.resultVisible ? (
          <>
            <Text style={styles.resultSub}>
              You finished the exam successfully. Please wait until all students submit and points are distributed.
            </Text>

            <View style={styles.resultMoodPill}>
              <Text style={styles.resultMoodText}>Results pending</Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.resultPct}>{Math.round(Number(result?.percent || 0))}%</Text>
            <Text style={styles.resultSub}>
              {failedPracticeExam
                ? `You failed this practice exam. Score at least ${Math.round(Number(result?.passPercent || practicePassPercent))}% to pass.${result?.lifePenaltyApplied ? " 1 life has been deducted." : ""}`
                : "Great work. Your exam has been submitted successfully."}
            </Text>

            <View style={styles.resultMoodPill}>
              <Text style={styles.resultMoodText}>{gradeLabel}</Text>
            </View>

            <View style={styles.resultStatsRow}>
              <View style={styles.resultStatBox}>
                <Text style={styles.resultStatLabel}>Correct</Text>
                <Text style={[styles.resultStatValue, { color: C.success }]}>{result?.correct ?? 0}</Text>
              </View>
              <View style={styles.resultStatDivider} />
              <View style={styles.resultStatBox}>
                <Text style={styles.resultStatLabel}>Wrong</Text>
                <Text style={[styles.resultStatValue, { color: C.danger }]}>
                  {Math.max(0, Number(result?.total || 0) - Number(result?.correct || 0))}
                </Text>
              </View>
              <View style={styles.resultStatDivider} />
              <View style={styles.resultStatBox}>
                <Text style={styles.resultStatLabel}>Score</Text>
                <Text style={[styles.resultStatValue, { color: C.primary }]}>
                  {Math.round(Number(result?.percent || 0))}%
                </Text>
              </View>
            </View>

            {result?.badge ? (
              <View style={styles.resultChip}>
                <Ionicons name="ribbon" size={14} color={C.primary} />
                <Text style={styles.resultChipText}>Badge: {String(result.badge).toUpperCase()}</Text>
              </View>
            ) : null}
          </>
        )}

        <View style={styles.resultActions}>
          {!isCompetitive && feedbackMode === "end" ? (
            <TouchableOpacity
              activeOpacity={0.9}
              style={[styles.resultActionBtn, styles.resultActionBtnSecondary]}
              onPress={() => {
                setShowPostSubmitReview(true);
                setReviewIndex(0);
              }}
            >
              <View style={[styles.resultActionIconWrap, styles.resultActionIconWrapSecondary]}>
                <Ionicons name="reader-outline" size={20} color={C.primary} />
              </View>
              <View style={styles.resultActionCopy}>
                <Text style={styles.resultActionTitle}>Review</Text>
                <Text style={styles.resultActionSubtitle}>See your answers.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.primary} />
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity activeOpacity={0.92} style={[styles.resultActionBtn, styles.resultActionBtnPrimary]} onPress={handleBackNavigation}>
            <View style={[styles.resultActionIconWrap, styles.resultActionIconWrapPrimary]}>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </View>
            <View style={styles.resultActionCopy}>
              <Text style={[styles.resultActionTitle, styles.resultActionTitlePrimary]}>Continue</Text>
              <Text style={[styles.resultActionSubtitle, styles.resultActionSubtitlePrimary]}>Back to exams.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  </View>
)}
      </View>

      <Modal visible={showHeartInfoModal} transparent animationType="none" onRequestClose={() => setShowHeartInfoModal(false)}>
        <View style={modalStyles.overlay}>
          <Animated.View style={[modalStyles.card, { transform: [{ scale: heartModalAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }], opacity: heartModalAnim }]}>
            <Text style={modalStyles.title}>Lives & refill</Text>
            <Text style={modalStyles.text}>Lives are shared across all practice exams and refill automatically over time.</Text>
            <View style={{ marginTop: 12, alignItems: "center" }}>
              <Ionicons name={globalLives != null && globalLives > 0 ? "heart" : "heart-outline"} size={32} color={globalLives != null && globalLives > 0 ? HEART_COLOR : colors.muted} />
              <Text style={{ fontWeight: "900", marginTop: 8, fontSize: 18 }}>{globalLives != null ? `${globalLives} / ${globalMaxLives}` : `— / ${globalMaxLives}`}</Text>
              <Text style={{ marginTop: 8, color: colors.muted }}>
                {globalLives != null && globalLives >= globalMaxLives ? "Lives full" : `Next life in: ${formatMsToMMSS(nextHeartInMs)}`}
              </Text>
              <Text style={{ marginTop: 6, color: colors.muted, fontSize: 12 }}>Refill interval: {Math.round(globalRefillMs / 60000)} min</Text>
            </View>
            <TouchableOpacity style={modalStyles.closeBtnPrimary} onPress={() => setShowHeartInfoModal(false)}>
              <Text style={modalStyles.closeBtnTextPrimary}>Close</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
  safeRoot: { flex: 1, backgroundColor: colors.background },
  loadingWrap: { flex: 1, backgroundColor: colors.background, justifyContent: "center", alignItems: "center" },

  root: { flex: 1, backgroundColor: colors.background },
  panel: { flex: 1, backgroundColor: colors.background },

  headerBar: {
    minHeight: 62,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.background,
  },
  backBtn: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.inputBackground },
  title: { fontSize: 18, fontWeight: "900", color: colors.text },
  subtitle: { marginTop: 2, color: colors.muted, fontSize: 12 },
  headerLivesButton: { minWidth: 72, alignItems: "flex-end" },
  headerLivesRow: { flexDirection: "row", alignItems: "center" },
  headerLivesTimer: { marginRight: 8, color: C.primary, fontWeight: "800", fontSize: 12 },
  headerLivesCount: { marginLeft: 6, color: C.primary, fontWeight: "900" },

  body: { paddingHorizontal: 16, paddingBottom: 24 },
  mainTitle: { fontSize: 24, fontWeight: "900", color: colors.text, marginTop: 8, marginBottom: 10 },

  rulesInfoColumn: { width: "100%", marginBottom: 12 },
  rulesRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderRadius: 10 },
  rulesIconWrap: {
    width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center", marginRight: 12, backgroundColor: colors.card,
  },
  rulesTextWrap: { flex: 1 },
  rulesNumber: { fontWeight: "900", color: colors.text, fontSize: 16 },
  rulesLabel: { color: colors.muted, marginTop: 2 },

  infoCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    borderRadius: 12,
    padding: 12,
  },
  infoTitle: { fontWeight: "900", color: colors.text, marginBottom: 6 },
  infoText: { color: colors.muted, lineHeight: 20 },

  noAttemptsCard: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
    borderRadius: 12,
    padding: 12,
  },
  noAttemptsTitle: { marginLeft: 8, fontWeight: "900", color: colors.warningText },
  noAttemptsSub: { marginTop: 8, color: colors.warningText, lineHeight: 20, fontWeight: "600" },
  noAttemptsTimer: { marginTop: 8, color: C.primary, fontWeight: "900" },

  feedbackRow: { flexDirection: "row", alignItems: "center", marginTop: 10, marginBottom: 8 },
  warning: { marginTop: 12, color: colors.warningText, fontWeight: "700" },

  primaryBtn: { marginTop: 18, backgroundColor: C.primary, borderRadius: 12, alignItems: "center", paddingVertical: 14 },
  primaryBtnSmall: { backgroundColor: C.primary, borderRadius: 12, alignItems: "center", paddingVertical: 12, paddingHorizontal: 24 },
  primaryBtnText: { color: "#fff", fontWeight: "900" },

  examBody: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 12 },
  timerPill: { flexDirection: "row", alignItems: "center", backgroundColor: colors.soft, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  timer: { marginLeft: 6, color: C.primary, fontWeight: "800" },

  progressTrack: {
    marginHorizontal: 16,
    marginTop: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  progressFill: {
    height: 8,
    backgroundColor: C.primary,
  },

  qCard: { marginTop: 12, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12 },
  qText: { fontSize: 18, fontWeight: "900", color: colors.text },

  option: { marginTop: 10, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center" },
  optionDefault: { backgroundColor: colors.inputBackground, borderWidth: 1, borderColor: colors.border },
  optionSelected: { backgroundColor: C.primary },
  correctFlash: { backgroundColor: colors.successSurface, borderColor: colors.successBorder },
  wrongFlash: { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder },

  optBadge: { width: 34, height: 34, borderRadius: 17, marginRight: 10, alignItems: "center", justifyContent: "center" },
  optBadgeDef: { borderWidth: 1, borderColor: C.muted },
  optBadgeSel: { backgroundColor: colors.card },
  optLetter: { color: C.muted, fontWeight: "800" },

  optText: { flex: 1, color: colors.text, fontSize: 14 },
  optTextSel: { color: "#fff", fontWeight: "800" },

  explanationCard: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    borderRadius: 12,
    padding: 12,
  },
  explanationTitle: {
    fontWeight: "900",
    color: colors.text,
    marginBottom: 6,
  },
  explanationText: {
    color: colors.muted,
    lineHeight: 20,
  },

  footer: { marginTop: 8, marginHorizontal: 16, marginBottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ghostBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 18 },
  ghostTxt: { color: colors.muted, fontWeight: "800" },

  resultScreen: { flex: 1, backgroundColor: colors.background },
  resultCenter: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  resultCard: {
    width: "100%",
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    overflow: "hidden",
    shadowColor: "#001946",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.24,
    shadowRadius: 20,
    elevation: 12,
  },
  resultGlowTop: {
    position: "absolute",
    top: -90,
    right: -80,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "rgba(11,114,255,0.12)",
  },
  resultGlowBottom: {
    position: "absolute",
    bottom: -80,
    left: -70,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(18,183,106,0.10)",
  },
  resultPct: { fontSize: 56, color: C.primary, fontWeight: "900", marginTop: 4 },
  resultSub: {
    marginTop: 8,
    color: colors.muted,
    textAlign: "center",
    fontWeight: "600",
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 6,
  },
  resultMoodPill: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultMoodText: {
    color: C.primary,
    fontSize: 12,
    fontWeight: "800",
  },

  resultBgOrnament: {
    position: "absolute",
    top: "15%",
    left: "10%",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: C.primary,
  },
  resultBadgeBubble: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    marginBottom: 14,
    backgroundColor: C.primary,
    borderWidth: 4,
    borderColor: "rgba(11,114,255,0.18)",
  },
  resultTitle: {
    marginTop: 12,
    fontSize: 22,
    fontWeight: "900",
    color: colors.text,
  },
  resultStatsRow: {
    marginTop: 14,
    flexDirection: "row",
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    alignItems: "stretch",
  },
  resultStatBox: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  resultStatDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  resultStatLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  resultStatValue: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: "900",
  },
  resultActions: {
    width: "100%",
    marginTop: 18,
    gap: 10,
  },
  resultActionBtn: {
    width: "100%",
    minHeight: 62,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 11,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  resultActionBtnSecondary: {
    backgroundColor: colors.soft,
    borderColor: colors.border,
  },
  resultActionBtnPrimary: {
    backgroundColor: C.primary,
    borderColor: "rgba(11,114,255,0.16)",
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 8,
  },
  resultActionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  resultActionIconWrapSecondary: {
    backgroundColor: "rgba(11,114,255,0.12)",
  },
  resultActionIconWrapPrimary: {
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  resultActionCopy: {
    flex: 1,
    paddingRight: 12,
  },
  resultActionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  resultActionTitlePrimary: {
    color: "#fff",
  },
  resultActionSubtitle: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "600",
  },
  resultActionSubtitlePrimary: {
    color: "rgba(255,255,255,0.84)",
  },
  resultChip: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.soft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  resultChipText: {
    marginLeft: 6,
    color: C.primary,
    fontWeight: "800",
    fontSize: 12,
  },

  toggleBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, marginRight: 8, borderWidth: 1, borderColor: colors.border },
  toggleOn: { backgroundColor: C.primary, borderColor: C.primary },
  toggleOff: { backgroundColor: colors.card, borderColor: colors.border },
  toggleTextOn: { color: "#fff", fontWeight: "800" },
  toggleTextOff: { color: colors.text, fontWeight: "800" },
});
}


function createModalStyles(colors) {
  return StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: colors.overlay, justifyContent: "center", alignItems: "center", padding: 20,
  },
  card: {
    width: "100%", maxWidth: 420, backgroundColor: colors.card, borderRadius: 14, padding: 18, alignItems: "center",
  },
  title: { fontSize: 20, fontWeight: "900", marginBottom: 8, color: colors.text },
  text: { color: colors.muted, textAlign: "center" },
  countdown: { marginTop: 6, fontWeight: "900", color: C.primary },
  closeBtn: { marginTop: 18, backgroundColor: colors.inputBackground, paddingVertical: 10, borderRadius: 10, alignItems: "center", width: "100%" },
  closeBtnText: { color: colors.muted, fontWeight: "800" },
  modeTitle: { marginTop: 10, fontWeight: "800", color: colors.text },
  modeText: { marginTop: 6, color: colors.muted, lineHeight: 20 },
  closeBtnPrimary: { marginTop: 18, backgroundColor: C.primary, paddingVertical: 10, borderRadius: 10, alignItems: "center", width: "100%" },
  closeBtnTextPrimary: { color: "#fff", fontWeight: "900" },
});
}