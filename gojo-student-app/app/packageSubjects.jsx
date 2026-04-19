import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  LayoutAnimation,
  UIManager,
  Platform,
  Modal,
  Animated,
  Alert,
  useWindowDimensions,
  InteractionManager,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { getValue, safeUpdate } from "./lib/dbHelpers";
import { useAppTheme } from "../hooks/use-app-theme";
import {
  deletePracticeExamBundle,
  downloadPracticeExamBundle,
  ensurePracticeLives,
  getQuestionBankQuestionsForPractice,
  hasPracticeExamBundle,
  readCompanyExamPackageDetail,
  readPracticeExamBundle,
  readPracticeExamProgress,
  updatePracticeExamProgress,
  writeCompanyExamPackageDetail,
  writePracticeLives,
} from "../lib/practiceExamStore";
import { readScreenCache, writeScreenCache } from "../lib/appOfflineCache";
import PageLoadingSkeleton from "../components/ui/page-loading-skeleton";
import { seedExamCenterWarmRoute } from "../lib/examRouteWarmCache";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const PRIMARY = "#0B72FF";
const HEART_REFILL_MS = 30 * 60 * 1000;
const DEFAULT_GLOBAL_MAX_LIVES = 5;
const HEART_COLOR = "#EF4444";
const PACKAGE_STATUS_TICK_MS = 15 * 1000;
const PACKAGE_HEART_TICK_MS = 1000;
const PACKAGE_ATTEMPT_SYNC_MS = 15 * 1000;

function normalizeGrade(g) {
  if (!g) return null;
  return String(g).trim().toLowerCase().replace(/^grade/i, "");
}
function titleize(s) {
  return String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function formatMsToMMSS(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
function normalizeHeartRefillMs(value, fallback = HEART_REFILL_MS) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(HEART_REFILL_MS, parsed);
}
function formatPercentCompact(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  const rounded = Math.round(parsed * 10) / 10;
  return Number.isInteger(rounded) ? `Score ${rounded}%` : `Score ${rounded.toFixed(1)}%`;
}
function toMsTs(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}

function isCompetitiveRoundLive(round, now = Date.now()) {
  if (!round) return false;

  const start = toMsTs(
    round.startTimestamp ??
    round.releaseTimestamp ??
    round.startAt ??
    round.startsAt ??
    round.roundMeta?.startTimestamp ??
    round.roundMeta?.releaseTimestamp ??
    round.roundMeta?.startAt ??
    round.roundMeta?.startsAt ??
    0
  );
  const end = toMsTs(
    round.endTimestamp ??
    round.endAt ??
    round.endsAt ??
    round.roundMeta?.endTimestamp ??
    round.roundMeta?.endAt ??
    round.roundMeta?.endsAt ??
    0
  );
  const status = String(round.status || round.roundMeta?.status || "").toLowerCase();
  const explicitLive = ["live", "active", "open", "ongoing"].includes(status);
  const beforeStart = !!start && now < start;
  const afterEnd = !!end && now > end;

  if (explicitLive && !afterEnd) return true;
  if (!start && !end) return false;
  if (beforeStart || afterEnd) return false;
  return true;
}

function getSubjectVisual(subjectKey, subjectName, colors) {
  const k = `${subjectKey || ""} ${subjectName || ""}`.toLowerCase();
  if (k.includes("math")) return { icon: "calculator-variant-outline", bg: colors.infoSurface, color: colors.primary };
  if (k.includes("physics")) return { icon: "atom-variant", bg: colors.successSurface, color: "#10B981" };
  if (k.includes("chem")) return { icon: "flask-outline", bg: colors.warningSurface, color: "#F97316" };
  if (k.includes("bio")) return { icon: "dna", bg: colors.soft, color: "#8B5CF6" };
  if (k.includes("science")) return { icon: "beaker-outline", bg: colors.infoSurface, color: "#0891B2" };
  if (k.includes("english")) return { icon: "alphabetical", bg: colors.dangerSurface, color: "#EF4444" };
  if (k.includes("history")) return { icon: "book-open-page-variant-outline", bg: colors.warningSurface, color: "#EA580C" };
  if (k.includes("geography")) return { icon: "earth", bg: colors.successSurface, color: "#16A34A" };
  return { icon: "book-education-outline", bg: colors.infoSurface, color: colors.primary };
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

export default function PackageSubjects() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const modalStyles = useMemo(() => createModalStyles(colors), [colors]);
  const isCompactRoundLayout = width < 460;

  const TEXT = colors.text;
  const MUTED = colors.muted;

  const packageId = params.packageId;
  const packageName = params.packageName || "Package";
  const incomingGrade = params.studentGrade;
  const screenCacheParts = useMemo(
    () => [String(packageId || "package"), normalizeGrade(incomingGrade) || "all"],
    [incomingGrade, packageId]
  );

  const [loading, setLoading] = useState(true);
  const [subjects, setSubjects] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [packageType, setPackageType] = useState(null);
  const isPractice = useMemo(() => String(packageType || "").toLowerCase() !== "competitive", [packageType]);
  const [downloadProgressMap, setDownloadProgressMap] = useState({});

  const [globalLives, setGlobalLives] = useState(null);
  const [globalMaxLives, setGlobalMaxLives] = useState(DEFAULT_GLOBAL_MAX_LIVES);
  const [globalRefillMs, setGlobalRefillMs] = useState(HEART_REFILL_MS);
  const [globalLastConsumedAt, setGlobalLastConsumedAt] = useState(null);

  const [showHeartInfoModal, setShowHeartInfoModal] = useState(false);
  const heartModalAnim = useRef(new Animated.Value(0)).current;
  const [nextHeartInMs, setNextHeartInMs] = useState(0);
  const loadRunIdRef = useRef(0);

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [showRead, setShowRead] = useState(false);
  const [lastSeenNotificationsAt, setLastSeenNotificationsAt] = useState(0);
  const [whatsNew, setWhatsNew] = useState([]);

  const [appExamConfig, setAppExamConfig] = useState({
    lives: {
      defaultMaxLives: DEFAULT_GLOBAL_MAX_LIVES,
      defaultRefillIntervalMs: HEART_REFILL_MS,
    },
    attempts: {
      practiceRefillEnabled: false,
      defaultRefillIntervalMs: 0,
      maxCarryRefills: 999,
    },
  });

  const [nowTs, setNowTs] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), PACKAGE_STATUS_TICK_MS);
    return () => clearInterval(t);
  }, []);

  const notifVisual = useCallback((type) => {
    const t = String(type || "").toLowerCase();
    if (t === "new_package") return { icon: "cube-outline", color: colors.primary, bg: colors.infoSurface };
    if (t === "new_round") return { icon: "layers-outline", color: "#7C3AED", bg: colors.soft };
    if (t === "round_live") return { icon: "flash-outline", color: colors.warningText, bg: colors.warningSurface };
    if (t === "result_released") return { icon: "trophy-outline", color: colors.success, bg: colors.successSurface };
    return { icon: "notifications-outline", color: colors.primary, bg: colors.infoSurface };
  }, [colors]);

  const parseDeepLink = useCallback((dl) => {
    const deep = String(dl || "");
    if (!deep) return null;
    const [pathname, query] = deep.split("?");
    const p = {};
    if (query) {
      query.split("&").forEach((pair) => {
        const [k, v] = pair.split("=");
        if (k) p[decodeURIComponent(k)] = decodeURIComponent(v || "");
      });
    }
    return { pathname: pathname || "/", params: p };
  }, []);

  const getStudentIdentity = useCallback(async () => {
    const sid =
      (await AsyncStorage.getItem("studentNodeKey")) ||
      (await AsyncStorage.getItem("studentId")) ||
      (await AsyncStorage.getItem("username")) ||
      null;

    if (!sid) return { sid: null, gradeKey: null };

    const fromStorage =
      (await AsyncStorage.getItem("studentGrade")) ||
      (await AsyncStorage.getItem("grade")) ||
      "";
    const normalized = String(fromStorage).toLowerCase().replace("grade", "").trim();
    if (normalized) return { sid, gradeKey: `grade${normalized}` };

    const schoolCode = await getValue([`Platform1/schoolCodeIndex/${String(sid).slice(0, 3)}`]);
    const student = schoolCode ? await getValue([`Platform1/Schools/${schoolCode}/Students/${sid}`]) : null;
    const rawGrade = String(student?.basicStudentInformation?.grade || student?.grade || "").trim();
    return { sid, gradeKey: rawGrade ? `grade${rawGrade}` : null };
  }, []);

  const warmExamCenterRoute = useCallback((round, options = {}) => {
    if (!round?.roundId || !round?.examId) return;

    const baseRoundMeta = round.roundMeta || {
      ...(options.roundMeta || {}),
      id: round.roundId,
      roundId: round.roundId,
      examId: round.examId,
      questionBankId: round.questionBankId || "",
      name: round.name || options.name || "Round",
      startTimestamp: Number(round.startTimestamp || 0),
      endTimestamp: Number(round.endTimestamp || 0),
      resultReleaseTimestamp: Number(round.resultReleaseTimestamp || 0),
      status: round.status || "",
    };
    const baseExamMeta = round.examMeta || {
      ...(options.examMeta || {}),
      id: round.examId,
      examId: round.examId,
      name: round.name || options.name || "Exam",
      questionBankId: round.questionBankId || options.questionBankId || "",
      totalQuestions: round.totalQuestions,
      timeLimit: round.timeLimit,
      difficulty: round.difficulty,
      maxAttempts: round.maxAttempts,
      attemptRefillIntervalMs: round.attemptRefillIntervalMs,
      attemptRefillEnabled: round.attemptRefillEnabled,
    };

    seedExamCenterWarmRoute({
      roundId: round.roundId,
      examId: round.examId,
      data: {
        roundMeta: baseRoundMeta,
        examMeta: baseExamMeta,
        appExamConfig,
        isCompetitive: !isPractice,
      },
    });

    void (async () => {
      try {
        const sid =
          (await AsyncStorage.getItem("studentNodeKey")) ||
          (await AsyncStorage.getItem("studentId")) ||
          (await AsyncStorage.getItem("username")) ||
          null;

        if (round.practiceOffline && round.downloaded && sid) {
          const bundle = await readPracticeExamBundle(sid, round.examId);
          if (Array.isArray(bundle?.questions) && bundle.questions.length) {
            seedExamCenterWarmRoute({
              roundId: round.roundId,
              examId: round.examId,
              data: {
                roundMeta: bundle.roundMeta || baseRoundMeta,
                examMeta: bundle.examMeta || baseExamMeta,
                appExamConfig: bundle.appExamConfig || appExamConfig,
                isCompetitive: !!bundle.isCompetitive,
                questions: bundle.questions,
              },
            });
            return;
          }
        }

        const questionBankId =
          baseExamMeta?.questionBankId ||
          baseRoundMeta?.questionBankId ||
          round.questionBankId ||
          options.questionBankId ||
          "";

        if (!questionBankId) return;

        const questions = await getQuestionBankQuestionsForPractice(questionBankId);
        if (!Array.isArray(questions) || !questions.length) return;

        seedExamCenterWarmRoute({
          roundId: round.roundId,
          examId: round.examId,
          data: {
            roundMeta: baseRoundMeta,
            examMeta: {
              ...baseExamMeta,
              questionBankId,
            },
            appExamConfig,
            isCompetitive: !isPractice,
            questions,
          },
        });
      } catch {}
    })();
  }, [appExamConfig, isPractice]);

  const loadNotifications = useCallback(async () => {
    const { sid, gradeKey } = await getStudentIdentity();
    if (!sid || !gradeKey) return;

    const userMeta = await getValue([`Platform1/usersMeta/${sid}`, `usersMeta/${sid}`]) || {};
    const lastSeen = Number(userMeta?.lastSeenNotificationsAt || 0);
    setLastSeenNotificationsAt(lastSeen);

    const node = await getValue([`Platform1/examNotifications`, `examNotifications`]) || {};
    const arr = Object.keys(node)
      .map((k) => ({ id: k, ...node[k] }))
      .filter((n) => !!n?.grades?.[gradeKey])
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

    setNotifications(arr);
    setUnreadCount(arr.filter((n) => Number(n.createdAt || 0) > lastSeen).length);
  }, [getStudentIdentity]);

  const openNotification = useCallback((item) => {
    setShowNotifModal(false);

    if (item?.meta?.roundId && item?.meta?.examId) {
      warmExamCenterRoute({
        roundId: item.meta.roundId,
        examId: item.meta.examId,
        questionBankId: item.meta.questionBankId || "",
        name: item?.meta?.roundName || item?.title || "Exam",
      }, {
        questionBankId: item.meta.questionBankId || "",
        name: item?.meta?.roundName || item?.title || "Exam",
      });
      router.push({
        pathname: "/examCenter",
        params: {
          roundId: item.meta.roundId,
          examId: item.meta.examId,
          questionBankId: item.meta.questionBankId || "",
          mode: "start",
          returnTo: "packageSubjects",
          returnPackageId: packageId || "",
          returnPackageName: packageName || "",
          returnStudentGrade: incomingGrade || "",
          ...(isPractice ? { practiceOffline: "1" } : {}),
        },
      });
      return;
    }

    const parsed = parseDeepLink(item?.deepLink);
    if (parsed) router.push({ pathname: parsed.pathname, params: parsed.params });

    void (async () => {
      const { sid } = await getStudentIdentity();
      if (!sid) return;

      const ts = Math.max(Date.now(), Number(item?.createdAt || 0));
      await safeUpdate({
        [`Platform1/usersMeta/${sid}/lastSeenNotificationsAt`]: ts,
      }).catch(() => {});
      await loadNotifications().catch(() => {});
    })();
  }, [getStudentIdentity, incomingGrade, isPractice, loadNotifications, packageId, packageName, parseDeepLink, router, warmExamCenterRoute]);

  const markAllSeen = useCallback(async () => {
    const { sid } = await getStudentIdentity();
    if (!sid) return;
    await safeUpdate({
      [`Platform1/usersMeta/${sid}/lastSeenNotificationsAt`]: Date.now(),
    }).catch(() => {});
    await loadNotifications();
  }, [getStudentIdentity, loadNotifications]);

  const buildWhatsNew = useCallback((subjectList) => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const items = [];

    for (const s of subjectList || []) {
      for (const r of s.rounds || []) {
        const st = Number(r.startTimestamp || 0) * 1000;
        const rr = Number(r.resultReleaseTimestamp || 0) * 1000;

        if (st && now >= st && now - st <= 3 * DAY) {
          items.push({
            type: "round_live",
            id: `${s.id}_${r.id}_live`,
            title: `${s.name}: ${r.name}`,
            subtitle: "Round is now live",
            round: r,
          });
        }
        if (rr && now >= rr && now - rr <= 3 * DAY) {
          items.push({
            type: "result_released",
            id: `${s.id}_${r.id}_result`,
            title: `${s.name}: ${r.name}`,
            subtitle: "Result released",
            round: r,
          });
        }
      }
    }

    const nextItems = items.slice(0, 8);
    setWhatsNew(nextItems);
    return nextItems;
  }, []);

  const hydrateCachedSnapshot = useCallback(async () => {
    try {
      const snapshot = await readScreenCache("package-subjects", screenCacheParts);
      if (!snapshot || typeof snapshot !== "object") return false;

      setSubjects(Array.isArray(snapshot.subjects) ? snapshot.subjects : []);
      setPackageType(snapshot.packageType || null);
      setGlobalLives(snapshot.globalLives ?? null);
      setGlobalMaxLives(Number(snapshot.globalMaxLives || DEFAULT_GLOBAL_MAX_LIVES));
      setGlobalRefillMs(normalizeHeartRefillMs(snapshot.globalRefillMs));
      setGlobalLastConsumedAt(snapshot.globalLastConsumedAt || null);
      if (snapshot.appExamConfig) {
        setAppExamConfig((prev) => ({
          ...prev,
          ...snapshot.appExamConfig,
          lives: { ...prev.lives, ...(snapshot.appExamConfig.lives || {}) },
          attempts: {
            ...prev.attempts,
            ...(snapshot.appExamConfig.attempts || {}),
            practiceRefillEnabled: false,
            defaultRefillIntervalMs: 0,
          },
        }));
      }
      setWhatsNew(Array.isArray(snapshot.whatsNew) ? snapshot.whatsNew : []);
      setLoading(false);
      return true;
    } catch {
      return false;
    }
  }, [screenCacheParts]);

  const buildSubjectsFromPackage = useCallback(async ({ pkg, examMap, sid, isPracticePackage }) => {
    const subjectsNode = pkg?.subjects || {};
    return Promise.all(
      Object.keys(subjectsNode).map(async (subjectKey) => {
        const subject = subjectsNode[subjectKey] || {};
        const roundsNode = subject.rounds || {};

        const roundsArr = await Promise.all(
          Object.keys(roundsNode).map(async (rid) => {
            const r = roundsNode[rid] || {};
            const examId = r.examId;
            const examMeta = examMap?.[examId] || {};

            let progressRaw = null;
            let downloaded = false;
            if (sid && rid && examId) {
              if (isPracticePackage) {
                const [localProgress, localBundleReady] = await Promise.all([
                  readPracticeExamProgress(sid, examId),
                  hasPracticeExamBundle(sid, examId),
                ]);
                progressRaw = localProgress;
                downloaded = !!localBundleReady;
              } else {
                progressRaw = await getValue([
                  `Platform1/studentProgress/${sid}/company/${rid}/${examId}`,
                  `studentProgress/${sid}/company/${rid}/${examId}`,
                ]);
              }
            }

            const hasSubmittedScore =
              progressRaw?.lastScorePercent != null ||
              progressRaw?.bestScorePercent != null ||
              Number(progressRaw?.lastSubmittedAt || 0) > 0;
            const attemptsUsedRaw = Math.max(
              Number(progressRaw?.attemptsUsed || 0),
              Object.keys(progressRaw?.attempts || {}).length
            );

            return {
              id: rid,
              roundId: rid,
              examId,
              questionBankId: examMeta.questionBankId || r.questionBankId || "",
              name: r.name || rid,
              chapter: r.chapter || "",
              totalQuestions: Number(examMeta.totalQuestions || 0),
              timeLimit: Number(examMeta.timeLimit || 0),
              difficulty: examMeta.difficulty || "medium",
              maxAttempts: Number(examMeta.maxAttempts || 1),
              attemptRefillIntervalMs: Number(examMeta.attemptRefillIntervalMs || 0),
              attemptRefillEnabled: examMeta.attemptRefillEnabled !== false,
              attemptsUsedRaw,
              lastAttemptTsRaw: toMsTs(progressRaw?.lastAttemptTimestamp || progressRaw?.lastSubmittedAt || 0),
              bestScorePercentRaw: hasSubmittedScore
                ? Number(progressRaw?.bestScorePercent ?? progressRaw?.lastScorePercent ?? 0)
                : null,
              status: r.status || "upcoming",
              startTimestamp: Number(r.startTimestamp || 0),
              endTimestamp: Number(r.endTimestamp || 0),
              resultReleaseTimestamp: Number(r.resultReleaseTimestamp || 0),
              downloaded,
              practiceOffline: isPracticePackage,
              roundMeta: {
                ...(r || {}),
                id: rid,
                roundId: rid,
                examId,
                questionBankId: examMeta.questionBankId || r.questionBankId || "",
              },
              examMeta: {
                ...(examMeta || {}),
                id: examId,
                examId,
                questionBankId: examMeta.questionBankId || r.questionBankId || "",
              },
            };
          })
        );

        return {
          id: subjectKey,
          keyName: subjectKey,
          name: subject.name || subjectKey,
          chapter: subject.chapter || "",
          rounds: roundsArr,
        };
      })
    );
  }, []);

  const load = useCallback(async (options = {}) => {
    const background = Boolean(options?.background);
    const runId = ++loadRunIdRef.current;
    const isStale = () => loadRunIdRef.current !== runId;

    if (!background) {
      setLoading(true);
    }

    const [cachedPackageDetail, cfg, sessionPairs, livePkg] = await Promise.all([
      readCompanyExamPackageDetail(packageId),
      getValue([`Platform1/appConfig/exams`, `appConfig/exams`]),
      AsyncStorage.multiGet(["studentNodeKey", "studentId", "username", "studentGrade"]),
      getValue([
        `Platform1/companyExams/packages/${packageId}`,
        `companyExams/packages/${packageId}`,
      ]),
    ]);
    if (isStale()) return;

    const session = Object.fromEntries(sessionPairs || []);
    const resolvedConfig = cfg || cachedPackageDetail?.appExamConfig || null;
    if (resolvedConfig) {
      setAppExamConfig((prev) => ({
        ...prev,
        ...resolvedConfig,
        lives: { ...prev.lives, ...(resolvedConfig.lives || {}) },
        attempts: {
          ...prev.attempts,
          ...(resolvedConfig.attempts || {}),
          practiceRefillEnabled: false,
          defaultRefillIntervalMs: 0,
        },
      }));
    }

    const sid = session.studentNodeKey || session.studentId || session.username || null;
    const gradeStored = normalizeGrade(session.studentGrade);
    const grade = normalizeGrade(incomingGrade) || gradeStored;
    const pkg = livePkg || cachedPackageDetail?.pkg || null;

    if (!pkg) {
      if (isStale()) return;
      setSubjects([]);
      setPackageType(null);
      if (!background) setLoading(false);
      return;
    }
    if (isStale()) return;

    setPackageType(pkg.type || null);
    const isPracticePackage = String(pkg.type || "").toLowerCase() !== "competitive";

    const defaultRefill = normalizeHeartRefillMs(resolvedConfig?.lives?.defaultRefillIntervalMs);
    const defaultMax = Number(resolvedConfig?.lives?.defaultMaxLives || DEFAULT_GLOBAL_MAX_LIVES);

    let nextGlobalLives = null;
    let nextGlobalMaxLives = defaultMax;
    let nextGlobalRefillMs = defaultRefill;
    let nextGlobalLastConsumedAt = null;

    const [livesSource, liveExamMap] = await Promise.all([
      sid
        ? isPracticePackage
          ? ensurePracticeLives(sid, resolvedConfig?.lives || {})
          : getValue([`Platform1/studentLives/${sid}`, `studentLives/${sid}`])
        : Promise.resolve(null),
      livePkg ? getValue([`Platform1/companyExams/exams`, `companyExams/exams`]) : Promise.resolve(null),
    ]);
    if (isStale()) return;

    if (sid) {
      if (isPracticePackage) {
        const localLives = livesSource || {};
        nextGlobalLives = Number(localLives.currentLives || 0);
        nextGlobalMaxLives = Number(localLives.maxLives || defaultMax);
        nextGlobalRefillMs = normalizeHeartRefillMs(localLives.refillIntervalMs, defaultRefill);
        nextGlobalLastConsumedAt = Number(localLives.lastConsumedAt || 0) || null;
      } else if (livesSource) {
        const raw = livesSource;
        const lives = Number(raw?.currentLives ?? raw?.lives ?? null);
        const max = Number(raw?.maxLives ?? defaultMax);
        let refillRaw = raw?.refillIntervalMs ?? raw?.refillInterval ?? null;
        let refillMs = defaultRefill;
        if (refillRaw != null) {
          const num = Number(refillRaw);
          if (Number.isFinite(num)) refillMs = normalizeHeartRefillMs(num > 1000 ? num : num * 1000, defaultRefill);
        }
        nextGlobalLives = Number.isFinite(lives) ? lives : null;
        nextGlobalMaxLives = Number.isFinite(max) ? max : defaultMax;
        nextGlobalRefillMs = refillMs;
        nextGlobalLastConsumedAt = toMsTs(raw?.lastConsumedAt ?? raw?.lastConsumed ?? 0) || null;
      }
    }

    if (isStale()) return;
    setGlobalLives(nextGlobalLives);
    setGlobalMaxLives(nextGlobalMaxLives);
    setGlobalRefillMs(nextGlobalRefillMs);
    setGlobalLastConsumedAt(nextGlobalLastConsumedAt);

    if (grade && pkg.grade && normalizeGrade(pkg.grade) && normalizeGrade(pkg.grade) !== String(grade)) {
      if (isStale()) return;
      setSubjects([]);
      if (!background) setLoading(false);
      return;
    }

    const examMap = liveExamMap && Object.keys(liveExamMap).length
      ? liveExamMap
      : (cachedPackageDetail?.examMap || {});

    if (livePkg) {
      void writeCompanyExamPackageDetail(packageId, {
        pkg: livePkg,
        examMap,
        appExamConfig: resolvedConfig,
      });
    }

    const out = await buildSubjectsFromPackage({
      pkg,
      examMap,
      sid,
      isPracticePackage,
    });
    if (isStale()) return;

    setSubjects(out);
    const nextWhatsNew = buildWhatsNew(out);

    if (!isStale()) {
      writeScreenCache("package-subjects", screenCacheParts, {
        subjects: out,
        packageType: pkg.type || null,
        globalLives: nextGlobalLives,
        globalMaxLives: nextGlobalMaxLives,
        globalRefillMs: nextGlobalRefillMs,
        globalLastConsumedAt: nextGlobalLastConsumedAt,
        appExamConfig: resolvedConfig,
        whatsNew: nextWhatsNew,
      }).catch(() => null);
    }

    if (!background) {
      if (isStale()) return;
      setLoading(false);
    }

    if (!isStale()) {
      loadNotifications().catch(() => null);
    }
  }, [packageId, incomingGrade, buildWhatsNew, buildSubjectsFromPackage, loadNotifications, screenCacheParts]);

  useEffect(() => {
    let cancelled = false;
    let task = null;

    (async () => {
      const hydrated = await hydrateCachedSnapshot();
      if (cancelled) return;

      task = InteractionManager.runAfterInteractions(() => {
        load({ background: hydrated }).catch(() => null);
      });
    })();

    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [hydrateCachedSnapshot, load]);

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        load({ background: true }).catch(() => null);
      });

      return () => {
        task?.cancel?.();
      };
    }, [load])
  );

  const toggle = (id) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const syncRoundState = useCallback((examId, patch) => {
    if (!examId || !patch || typeof patch !== "object") return;
    setSubjects((prev) =>
      (prev || []).map((subject) => ({
        ...subject,
        rounds: (subject.rounds || []).map((round) =>
          String(round.examId || "") === String(examId)
            ? { ...round, ...patch }
            : round
        ),
      }))
    );
  }, []);

  const openRound = useCallback((round) => {
    if (!round?.roundId || !round?.examId) return;
    const attemptsLeft = Math.max(0, Number(round.maxAttempts || 1) - Math.max(0, Number(round.attemptsUsedRaw || 0)));
    if (attemptsLeft <= 0) {
      Alert.alert("Attempts finished", "You already used all attempts for this exam.");
      return;
    }
    warmExamCenterRoute(round);
    router.push({
      pathname: "/examCenter",
      params: {
        roundId: round.roundId,
        examId: round.examId,
        questionBankId: round.questionBankId,
        mode: "start",
        returnTo: "packageSubjects",
        returnPackageId: packageId || "",
        returnPackageName: packageName || "",
        returnStudentGrade: incomingGrade || "",
        ...(isPractice ? { practiceOffline: "1" } : {}),
      },
    });
  }, [router, packageId, packageName, incomingGrade, isPractice, warmExamCenterRoute]);

  const downloadPracticeRound = useCallback(async (subject, round) => {
    if (!subject?.id || !round?.examId) return;

    const examKey = String(round.examId || "");
    if (!examKey || round?.downloaded || Number(downloadProgressMap?.[examKey] || 0) > 0) return;

    const sid =
      (await AsyncStorage.getItem("studentNodeKey")) ||
      (await AsyncStorage.getItem("studentId")) ||
      (await AsyncStorage.getItem("username")) ||
      null;

    if (!sid) {
      Alert.alert("Download unavailable", "Student account was not found on this device.");
      return;
    }

    setDownloadProgressMap((prev) => ({ ...prev, [examKey]: 8 }));

    try {
      setDownloadProgressMap((prev) => ({ ...prev, [examKey]: 36 }));
      await downloadPracticeExamBundle({
        studentId: sid,
        packageId,
        packageName,
        subjectId: subject.id,
        subjectName: subject.name,
        roundMeta: round.roundMeta || round,
        examMeta: round.examMeta || {
          id: round.examId,
          examId: round.examId,
          questionBankId: round.questionBankId,
          name: round.name,
          totalQuestions: round.totalQuestions,
          timeLimit: round.timeLimit,
          difficulty: round.difficulty,
          maxAttempts: round.maxAttempts,
          attemptRefillIntervalMs: round.attemptRefillIntervalMs,
          attemptRefillEnabled: round.attemptRefillEnabled,
        },
        appExamConfig,
      });
      syncRoundState(examKey, { downloaded: true });
      setDownloadProgressMap((prev) => ({ ...prev, [examKey]: 0 }));
    } catch (error) {
      console.warn("packageSubjects: downloadPracticeRound failed", error);
      setDownloadProgressMap((prev) => ({ ...prev, [examKey]: 0 }));
      Alert.alert("Download failed", error?.message || "Could not download this practice exam.");
    }
  }, [appExamConfig, downloadProgressMap, packageId, packageName, syncRoundState]);

  const deletePracticeRound = useCallback(async (round) => {
    if (!round?.examId) return;

    const sid =
      (await AsyncStorage.getItem("studentNodeKey")) ||
      (await AsyncStorage.getItem("studentId")) ||
      (await AsyncStorage.getItem("username")) ||
      null;

    if (!sid) {
      Alert.alert("Delete unavailable", "Student account was not found on this device.");
      return;
    }

    const removed = await deletePracticeExamBundle(sid, round.examId);
    if (!removed) {
      Alert.alert("Delete failed", "The offline copy could not be removed right now.");
      return;
    }

    syncRoundState(round.examId, { downloaded: false });
  }, [syncRoundState]);

  useEffect(() => {
    if (showHeartInfoModal) {
      Animated.spring(heartModalAnim, { toValue: 1, useNativeDriver: true }).start();
    } else {
      Animated.timing(heartModalAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start();
    }
  }, [showHeartInfoModal, heartModalAnim]);

  useEffect(() => {
    let timer;
    let syncing = false;

    async function tickHeart() {
      if (globalLives == null) {
        setNextHeartInMs(0);
        return;
      }

      const state = computeRefillState({
        currentLives: globalLives,
        maxLives: globalMaxLives,
        lastConsumedAt: globalLastConsumedAt,
        refillMs: globalRefillMs,
      });

      setNextHeartInMs(state.nextInMs);

      if (state.recovered > 0 && !syncing) {
        const sid =
          (await AsyncStorage.getItem("studentNodeKey")) ||
          (await AsyncStorage.getItem("studentId")) ||
          (await AsyncStorage.getItem("username")) ||
          null;

        if (!sid) return;

        syncing = true;
        try {
          if (isPractice) {
            await writePracticeLives(sid, {
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
              [`Platform1/studentLives/${sid}/currentLives`]: state.currentLives,
              [`Platform1/studentLives/${sid}/lastConsumedAt`]: state.lastConsumedAt,
            });
          }
          setGlobalLives(state.currentLives);
          setGlobalLastConsumedAt(state.lastConsumedAt);
        } catch (e) {
          console.warn("packageSubjects: heart refill sync failed", e);
        } finally {
          syncing = false;
        }
      }
    }

    tickHeart();
    timer = setInterval(tickHeart, PACKAGE_HEART_TICK_MS);
    return () => clearInterval(timer);
  }, [globalLives, globalMaxLives, globalLastConsumedAt, globalRefillMs, isPractice]);

  const deriveAttemptState = useCallback((round) => {
    const maxAttempts = Number(round.maxAttempts || 1);
    const usedRaw = Number(round.attemptsUsedRaw || 0);
    return { usedEffective: usedRaw, left: Math.max(0, maxAttempts - usedRaw), nextInMs: 0, refill: false };
  }, []);

  const applyAttemptRefillIfNeeded = useCallback(async (sid, round) => {
    if (!sid || !round?.examId || !round?.roundId) return;

    const st = deriveAttemptState(round, Date.now());
    if (!st.refill || st.recovered <= 0) return;

    const maxAttempts = Number(round.maxAttempts || 1);
    const usedNew = Math.max(0, Math.min(maxAttempts, st.usedEffective));
    const anchorTs = Number(st.anchor || Date.now());

    await updatePracticeExamProgress(sid, round.examId, (current) => ({
      ...current,
      attemptsUsed: usedNew,
      lastAttemptTimestamp: anchorTs,
    })).catch(() => {});
    syncRoundState(round.examId, {
      attemptsUsedRaw: usedNew,
      lastAttemptTsRaw: anchorTs,
    });
  }, [deriveAttemptState, syncRoundState]);

  useEffect(() => {
    let timer;
    (async () => {
      const sid =
        (await AsyncStorage.getItem("studentNodeKey")) ||
        (await AsyncStorage.getItem("studentId")) ||
        (await AsyncStorage.getItem("username")) ||
        null;

      async function tick() {
        if (!sid || String(packageType || "").toLowerCase() === "competitive") return;
        for (const s of subjects || []) {
          for (const r of s.rounds || []) {
            await applyAttemptRefillIfNeeded(sid, r);
          }
        }
      }

      await tick();
      timer = setInterval(tick, PACKAGE_ATTEMPT_SYNC_MS);
    })();

    return () => clearInterval(timer);
  }, [subjects, packageType, applyAttemptRefillIfNeeded]);

  const displayedNotifications = showRead
    ? notifications
    : notifications.filter((n) => Number(n.createdAt || 0) > lastSeenNotificationsAt);

  const totalRounds = useMemo(
    () => (subjects || []).reduce((sum, s) => sum + ((s.rounds || []).length || 0), 0),
    [subjects]
  );
  const heartCountdownLabel = globalLives != null && Number(globalLives || 0) < Number(globalMaxLives || 0) && Number(nextHeartInMs || 0) > 0
    ? formatMsToMMSS(nextHeartInMs)
    : null;

  if (loading) {
    return (
      <PageLoadingSkeleton
        variant="package"
        style={[styles.screen, { paddingTop: insets.top }]}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.replace({ pathname: "/dashboard/exam", params: { activeFilter: "gojo" } })}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={TEXT} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.title}>{isPractice ? "Practice Exam" : "Competitive Exam"}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>{isPractice ? "Download a round once" : "Choose a subject and start a round"}</Text>
        </View>

        <TouchableOpacity onPress={() => setShowHeartInfoModal(true)} style={styles.headerLivesButton}>
          <View style={styles.headerLivesRow}>
            {heartCountdownLabel ? (
              <Text style={styles.headerLivesTimer}>{heartCountdownLabel}</Text>
            ) : null}
            <Ionicons
              name={globalLives != null && globalLives > 0 ? "heart" : "heart-outline"}
              size={20}
              color={globalLives != null && globalLives > 0 ? HEART_COLOR : MUTED}
            />
            <Text style={styles.headerLivesCount}>
              {globalLives != null ? `${globalLives}` : "—"}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setShowNotifModal(true)}>
          <View>
            <Ionicons name="notifications-outline" size={22} color={TEXT} />
            {unreadCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeTxt}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
      </View>

      {whatsNew.length > 0 ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Text style={styles.whatsNewTitle}>What’s New</Text>
          <FlatList
            horizontal
            data={whatsNew}
            keyExtractor={(i) => i.id}
            showsHorizontalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ width: 8 }} />}
            renderItem={({ item }) => {
              const v = notifVisual(item.type);
              return (
                <View style={styles.newCard}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={[styles.newIconWrap, { backgroundColor: v.bg }]}>
                      <Ionicons name={v.icon} size={14} color={v.color} />
                    </View>
                    <Text style={styles.newTitle} numberOfLines={1}>{item.title}</Text>
                  </View>
                  <Text style={styles.newSub}>{item.subtitle}</Text>
                </View>
              );
            }}
          />
        </View>
      ) : null}

      <View style={styles.heroWrap}>
        <View style={styles.heroGlowA} />
        <View style={styles.heroGlowB} />
        <View style={styles.heroHeadlineRow}>
          <Text numberOfLines={1} style={styles.heroTitleInline}>{packageName}</Text>
        </View>
        <Text style={styles.heroSubtitle}>Master subjects and clear each round.</Text>

        <View style={styles.heroStatsRow}>
          <View style={styles.heroStatCard}>
            <Text style={styles.heroStatValue}>{subjects.length}</Text>
            <Text style={styles.heroStatLabel}>Subjects</Text>
          </View>
          <View style={styles.heroStatCard}>
            <Text style={styles.heroStatValue}>{totalRounds}</Text>
            <Text style={styles.heroStatLabel}>Rounds</Text>
          </View>
          <View style={styles.heroStatCard}>
            <Text style={styles.heroStatValue}>{globalLives != null ? globalLives : "-"}</Text>
            <Text style={styles.heroStatLabel}>Lives</Text>
          </View>
        </View>
      </View>

      <FlatList
        data={subjects}
        keyExtractor={(s) => s.id}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={7}
        removeClippedSubviews={Platform.OS === "android"}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 }}
        ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
        renderItem={({ item }) => {
          const expanded = expandedId === item.id;
          const v = getSubjectVisual(item.keyName, item.name, colors);
          const liveRoundsCount = !isPractice
            ? (item.rounds || []).filter((round) => isCompetitiveRoundLive(round, nowTs)).length
            : 0;

          return (
            <View style={[styles.subjectCard, expanded && styles.subjectCardExpanded]}>
              <TouchableOpacity
                style={[styles.subjectTop, expanded && styles.subjectTopExpanded]}
                activeOpacity={0.92}
                onPress={() => toggle(item.id)}
              >
                <View style={styles.subjectTopLeft}>
                <View style={[styles.subjectIconWrap, { backgroundColor: v.bg }]}>
                  <MaterialCommunityIcons name={v.icon} size={24} color={v.color} />
                </View>

                  <View style={styles.subjectTextWrap}>
                  <Text style={styles.subjectName}>{titleize(item.name)}</Text>
                  {item.chapter ? <Text style={styles.subjectChapter}>{item.chapter}</Text> : null}
                    <View style={styles.subjectMetaRow}>
                      <Text style={styles.subjectMetaChip}>{(item.rounds || []).length} rounds</Text>
                      {liveRoundsCount > 0 ? <Text style={[styles.subjectMetaChip, styles.subjectMetaChipLive]}>LIVE</Text> : null}
                    </View>
                  </View>
                </View>
              </TouchableOpacity>

              {expanded && (
                <View style={styles.expandArea}>
                  {(item.rounds || []).map((r, idx) => {
                    const attemptState = deriveAttemptState(r, nowTs);
                    const disabledByAttempts = attemptState.left <= 0;
                    const disabledByLives = isPractice && globalLives === 0;
                    const downloadPct = Number(downloadProgressMap[String(r.examId || "")] || 0);
                    const isDownloading = downloadPct > 0;
                    const needsDownload = isPractice && !r.downloaded;
                    const disabled = disabledByAttempts || disabledByLives || needsDownload || isDownloading;
                    const lastScoreText = formatPercentCompact(r.bestScorePercentRaw);

                    return (
                      <View key={`${r.roundId}_${r.examId}`} style={{ marginBottom: 10 }}>
                        <View style={[styles.roundRow, isCompactRoundLayout ? styles.roundRowCompact : null]}>
                          <View
                            style={[
                              styles.roundMain,
                              isCompactRoundLayout ? styles.roundMainCompact : null,
                              disabled ? styles.roundMainDisabled : null,
                            ]}
                          >
                            <TouchableOpacity activeOpacity={0.82} disabled={disabled} onPress={() => openRound(r)}>
                              <View style={styles.roundOrderBadge}>
                                <Text style={styles.roundOrderText}>{idx + 1}</Text>
                              </View>
                            </TouchableOpacity>
                            <View style={[styles.roundTextWrap, isCompactRoundLayout ? styles.roundTextWrapCompact : null]}>
                              <TouchableOpacity
                                activeOpacity={0.82}
                                disabled={disabled}
                                onPress={() => openRound(r)}
                                style={styles.roundTitleRow}
                              >
                                <Text style={styles.roundName} numberOfLines={1}>{r.name}</Text>
                                {lastScoreText ? <Text style={styles.roundLastScoreText}>{lastScoreText}</Text> : null}
                              </TouchableOpacity>

                              <View style={styles.roundMetaRow}>
                                <TouchableOpacity
                                  activeOpacity={0.82}
                                  disabled={disabled}
                                  style={styles.roundMetaPressable}
                                  onPress={() => openRound(r)}
                                >
                                  <Text style={styles.roundMeta} numberOfLines={1}>
                                    {(r.totalQuestions || 0)} Qs • {Math.round((r.timeLimit || 0) / 60)} min • {r.difficulty}
                                  </Text>
                                </TouchableOpacity>

                                {isPractice ? (
                                  <TouchableOpacity
                                    disabled={isDownloading}
                                    style={[
                                      styles.downloadBtn,
                                      styles.downloadBtnInline,
                                      r.downloaded && styles.downloadBtnDelete,
                                      isDownloading && styles.downloadBtnBusy,
                                    ]}
                                    onPress={() => {
                                      if (r.downloaded) {
                                        Alert.alert(
                                          "Remove download?",
                                          "This removes the offline copy from this device. Download it again to use this exam offline.",
                                          [
                                            { text: "Cancel", style: "cancel" },
                                            {
                                              text: "Delete",
                                              style: "destructive",
                                              onPress: () => {
                                                void deletePracticeRound(r);
                                              },
                                            },
                                          ]
                                        );
                                        return;
                                      }

                                      void downloadPracticeRound(item, r);
                                    }}
                                  >
                                    {isDownloading ? (
                                      <Text style={styles.downloadBtnText}>{Math.round(downloadPct)}%</Text>
                                    ) : (
                                      <Ionicons
                                        name={r.downloaded ? "trash-outline" : "cloud-download-outline"}
                                        size={16}
                                        color={r.downloaded ? colors.danger : PRIMARY}
                                      />
                                    )}
                                  </TouchableOpacity>
                                ) : null}
                              </View>
                            </View>
                          </View>
                        </View>

                        {disabledByAttempts || disabledByLives ? (
                          <View style={styles.lockInfo}>
                            {disabledByAttempts ? (
                              <>
                                <Text style={styles.noHeartText}>No attempts left for this exam.</Text>
                              </>
                            ) : null}

                            {disabledByLives ? (
                              <>
                                <Text style={[styles.noHeartText, { marginTop: disabledByAttempts ? 6 : 0 }]}>No global lives left for practice.</Text>
                                <Text style={styles.refillText}>Next life in {formatMsToMMSS(nextHeartInMs)}</Text>
                              </>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        }}
      />

      <Modal visible={showNotifModal} transparent animationType="slide" onRequestClose={() => setShowNotifModal(false)}>
        <View style={modalStyles.overlay}>
          <View style={[modalStyles.card, { maxHeight: "75%", alignItems: "stretch" }]}>
            <View style={styles.notifHeaderRow}>
              <Text style={modalStyles.title}>Notifications</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <TouchableOpacity style={styles.filterBtn} onPress={() => setShowRead((p) => !p)}>
                  <Text style={styles.filterBtnTxt}>{showRead ? "Unread" : "All"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.filterBtn} onPress={markAllSeen}>
                  <Text style={styles.filterBtnTxt}>Mark seen</Text>
                </TouchableOpacity>
              </View>
            </View>

            <FlatList
              data={displayedNotifications}
              keyExtractor={(n) => n.id}
              ListEmptyComponent={<Text style={{ color: MUTED, textAlign: "center", marginTop: 20 }}>No notifications</Text>}
              renderItem={({ item }) => {
                const v = notifVisual(item.type);
                const isUnread = Number(item.createdAt || 0) > lastSeenNotificationsAt;

                return (
                  <TouchableOpacity style={[styles.notifItemModern, isUnread ? styles.notifUnread : styles.notifRead]} onPress={() => openNotification(item)}>
                    <View style={[styles.notifIconWrap, { backgroundColor: v.bg }]}>
                      <Ionicons name={v.icon} size={18} color={v.color} />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.notifTitle}>{item.title}</Text>
                      <Text style={styles.notifBody} numberOfLines={2}>{item.body}</Text>
                    </View>

                    {isUnread ? <View style={styles.unreadDot} /> : null}
                  </TouchableOpacity>
                );
              }}
            />

            <TouchableOpacity style={modalStyles.closeBtnPrimary} onPress={() => setShowNotifModal(false)}>
              <Text style={modalStyles.closeBtnTextPrimary}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showHeartInfoModal} transparent animationType="none" onRequestClose={() => setShowHeartInfoModal(false)}>
        <View style={modalStyles.overlay}>
          <Animated.View style={[modalStyles.card, { transform: [{ scale: heartModalAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }], opacity: heartModalAnim }]}>
            <Text style={modalStyles.title}>Lives & refill</Text>
            <Text style={modalStyles.text}>Lives are shared across all practice exams and refill automatically over time.</Text>
            <View style={{ marginTop: 12, alignItems: "center" }}>
              <Ionicons name={globalLives != null && globalLives > 0 ? "heart" : "heart-outline"} size={32} color={globalLives != null && globalLives > 0 ? HEART_COLOR : MUTED} />
              <Text style={styles.heartCountText}>{globalLives != null ? `${globalLives} / ${globalMaxLives}` : `— / ${globalMaxLives}`}</Text>
              <Text style={{ marginTop: 8, color: MUTED }}>
                {globalLives != null && globalLives >= globalMaxLives ? "Lives full" : `Next life in: ${formatMsToMMSS(nextHeartInMs)}`}
              </Text>
              <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                Refill interval: {Math.round(globalRefillMs / 60000)} min
              </Text>
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
  const TEXT = colors.text;
  const MUTED = colors.muted;

  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },

  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    backgroundColor: colors.inputBackground,
  },
  headerTitleWrap: { flex: 1, minWidth: 0, marginRight: 8 },
  title: { fontSize: 21, fontWeight: "900", color: TEXT, flexShrink: 1 },
  subtitle: { marginTop: 2, color: MUTED, fontSize: 12 },
  headerLivesButton: { alignItems: "flex-end", minWidth: 72, marginRight: 10 },
  headerLivesRow: { flexDirection: "row", alignItems: "center" },
  headerLivesTimer: { marginRight: 8, color: colors.primary, fontWeight: "800", fontSize: 12 },
  headerLivesCount: { marginLeft: 6, color: colors.primary, fontWeight: "900" },

  badge: {
    position: "absolute",
    top: -6,
    right: -8,
    backgroundColor: "#EF4444",
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeTxt: { color: "#fff", fontSize: 10, fontWeight: "900" },
  whatsNewTitle: { fontWeight: "900", color: TEXT, marginBottom: 8 },
  heartCountText: { fontWeight: "900", marginTop: 8, fontSize: 18, color: TEXT },

  newCard: {
    width: 230,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
  },
  newIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  newTitle: { color: TEXT, fontWeight: "800", fontSize: 12, flex: 1 },
  newSub: { color: MUTED, marginTop: 6, fontSize: 11 },

  heroWrap: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    paddingHorizontal: 14,
    paddingVertical: 10,
    overflow: "hidden",
  },
  heroGlowA: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "rgba(11,114,255,0.12)",
    top: -70,
    right: -32,
  },
  heroGlowB: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(59,130,246,0.09)",
    bottom: -55,
    left: -22,
  },
  heroHeadlineRow: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  heroTitleInline: {
    flex: 1,
    minWidth: 0,
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },
  heroSubtitle: {
    marginTop: 6,
    color: MUTED,
    fontSize: 12,
    lineHeight: 16,
  },
  heroStatsRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  heroStatCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 7,
    alignItems: "center",
  },
  heroStatValue: {
    color: PRIMARY,
    fontSize: 16,
    fontWeight: "900",
  },
  heroStatLabel: {
    marginTop: 2,
    color: MUTED,
    fontSize: 11,
    fontWeight: "700",
  },

  subjectCard: {
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.025,
    shadowRadius: 10,
    elevation: 1,
  },
  subjectCardExpanded: {
    borderColor: colors.primary,
    shadowColor: PRIMARY,
    shadowOpacity: 0.05,
    elevation: 2,
  },
  subjectTop: {
    paddingHorizontal: 16,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  subjectTopExpanded: {
    backgroundColor: colors.inputBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subjectTopLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  subjectIconWrap: {
    width: 56,
    height: 74,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  subjectTextWrap: {
    marginLeft: 12,
    flex: 1,
  },
  subjectName: {
    fontWeight: "900",
    fontSize: 17,
    color: TEXT,
  },
  subjectChapter: {
    color: MUTED,
    marginTop: 4,
    fontSize: 12,
    fontWeight: "700",
  },
  subjectMetaRow: {
    flexDirection: "row",
    marginTop: 6,
    flexWrap: "wrap",
  },
  subjectMetaChip: {
    marginRight: 6,
    marginBottom: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
  },
  subjectMetaChipLive: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
    color: colors.warningText,
  },

  expandArea: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: colors.inputBackground,
  },
  roundRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.card,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.018,
    shadowRadius: 6,
    elevation: 0,
  },
  roundRowCompact: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  roundMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginRight: 10,
    minWidth: 0,
  },
  roundMainCompact: {
    width: "100%",
    marginRight: 0,
  },
  roundMainDisabled: {
    opacity: 0.68,
  },
  roundOrderBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  roundOrderText: {
    color: PRIMARY,
    fontSize: 12,
    fontWeight: "800",
  },
  roundTextWrap: {
    flex: 1,
    marginLeft: 10,
    paddingRight: 10,
    minWidth: 0,
    flexShrink: 1,
  },
  roundTextWrapCompact: {
    paddingRight: 0,
  },
  roundTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  roundName: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
    marginRight: 6,
  },
  roundMetaRow: {
    marginTop: 3,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  roundMetaPressable: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  roundMeta: { color: MUTED, fontSize: 12 },
  roundLastScoreText: {
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "800",
    flexShrink: 0,
  },

  roundActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  roundActionsCompact: {
    width: "100%",
    justifyContent: "flex-end",
    marginTop: 10,
    paddingLeft: 40,
  },

  downloadBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.infoSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  downloadBtnInline: {
    width: 34,
    height: 30,
    borderRadius: 10,
  },
  downloadBtnDelete: {
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: colors.dangerSurface,
  },
  downloadBtnBusy: {
    borderColor: colors.primary,
    backgroundColor: colors.soft,
  },
  downloadBtnText: {
    color: PRIMARY,
    fontWeight: "900",
    fontSize: 11,
  },

  lockInfo: {
    marginTop: 6,
    marginLeft: 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    padding: 8,
  },
  noHeartText: { color: colors.danger, fontWeight: "800", fontSize: 12 },
  refillText: { marginTop: 2, color: MUTED, fontSize: 12, fontWeight: "700" },

  notifHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  filterBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.inputBackground,
  },
  filterBtnTxt: { color: TEXT, fontWeight: "800", fontSize: 12 },

  notifItemModern: {
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  notifUnread: {
    borderColor: colors.primary,
    backgroundColor: colors.inputBackground,
  },
  notifRead: {
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  notifIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginLeft: 8,
  },
  notifTitle: { color: TEXT, fontWeight: "800", fontSize: 13 },
  notifBody: { color: MUTED, marginTop: 4, fontSize: 12 },
});
}

function createModalStyles(colors) {
  const TEXT = colors.text;
  const MUTED = colors.muted;

  return StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
  },
  title: { fontSize: 20, fontWeight: "900", marginBottom: 8, color: TEXT },
  text: { color: MUTED, textAlign: "center" },
  closeBtnPrimary: { marginTop: 18, backgroundColor: PRIMARY, paddingVertical: 10, borderRadius: 10, alignItems: "center", width: "100%" },
  closeBtnTextPrimary: { color: "#fff", fontWeight: "900" },
});
}