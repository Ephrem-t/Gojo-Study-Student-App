import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  LayoutAnimation,
  UIManager,
  Platform,
  StatusBar,
  Modal,
  Animated,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { getValue, safeUpdate } from "./lib/dbHelpers";
import { useAppTheme } from "../hooks/use-app-theme";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const PRIMARY = "#0B72FF";
const HEART_REFILL_MS = 20 * 60 * 1000;
const DEFAULT_GLOBAL_MAX_LIVES = 5;
const HEART_COLOR = "#EF4444";

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
function toMsTs(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
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
  const interval = Number(refillMs ?? 0);

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
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const modalStyles = useMemo(() => createModalStyles(colors), [colors]);

  const TEXT = colors.text;
  const MUTED = colors.muted;

  const packageId = params.packageId;
  const packageName = params.packageName || "Package";
  const incomingGrade = params.studentGrade;

  const [loading, setLoading] = useState(true);
  const [subjects, setSubjects] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [packageType, setPackageType] = useState(null);

  const [globalLives, setGlobalLives] = useState(null);
  const [globalMaxLives, setGlobalMaxLives] = useState(DEFAULT_GLOBAL_MAX_LIVES);
  const [globalRefillMs, setGlobalRefillMs] = useState(HEART_REFILL_MS);
  const [globalLastConsumedAt, setGlobalLastConsumedAt] = useState(null);

  const [showHeartInfoModal, setShowHeartInfoModal] = useState(false);
  const heartModalAnim = useRef(new Animated.Value(0)).current;
  const [nextHeartInMs, setNextHeartInMs] = useState(0);

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
      practiceRefillEnabled: true,
      defaultRefillIntervalMs: 20 * 60 * 1000,
      maxCarryRefills: 999,
    },
  });

  const [nowTs, setNowTs] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000);
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

  const openNotification = useCallback(async (item) => {
    const { sid } = await getStudentIdentity();
    if (sid) {
      const ts = Math.max(Date.now(), Number(item?.createdAt || 0));
      await safeUpdate({
        [`Platform1/usersMeta/${sid}/lastSeenNotificationsAt`]: ts,
      }).catch(() => {});
      await loadNotifications();
    }

    setShowNotifModal(false);

    if (item?.meta?.roundId && item?.meta?.examId) {
      router.push({
        pathname: "/examCenter",
        params: {
          roundId: item.meta.roundId,
          examId: item.meta.examId,
          questionBankId: item.meta.questionBankId || "",
          mode: "start",
        },
      });
      return;
    }

    const parsed = parseDeepLink(item?.deepLink);
    if (parsed) router.push({ pathname: parsed.pathname, params: parsed.params });
  }, [getStudentIdentity, loadNotifications, parseDeepLink, router]);

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

    setWhatsNew(items.slice(0, 8));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);

    const cfg = await getValue([`Platform1/appConfig/exams`, `appConfig/exams`]);
    if (cfg) {
      setAppExamConfig((prev) => ({
        ...prev,
        ...cfg,
        lives: { ...prev.lives, ...(cfg.lives || {}) },
        attempts: { ...prev.attempts, ...(cfg.attempts || {}) },
      }));
    }

    const sid =
      (await AsyncStorage.getItem("studentNodeKey")) ||
      (await AsyncStorage.getItem("studentId")) ||
      (await AsyncStorage.getItem("username")) ||
      null;

    const gradeStored = normalizeGrade(await AsyncStorage.getItem("studentGrade"));
    const grade = normalizeGrade(incomingGrade) || gradeStored;

    const pkg = await getValue([
      `Platform1/companyExams/packages/${packageId}`,
      `companyExams/packages/${packageId}`,
    ]);

    if (!pkg) {
      setSubjects([]);
      setPackageType(null);
      setLoading(false);
      return;
    }
    setPackageType(pkg.type || null);

    const defaultRefill = Number(cfg?.lives?.defaultRefillIntervalMs || HEART_REFILL_MS);
    const defaultMax = Number(cfg?.lives?.defaultMaxLives || DEFAULT_GLOBAL_MAX_LIVES);

    if (sid) {
      const livesNode = await getValue([`Platform1/studentLives/${sid}`, `studentLives/${sid}`]);
      if (livesNode) {
        const raw = livesNode;
        const lives = Number(raw?.currentLives ?? raw?.lives ?? null);
        const max = Number(raw?.maxLives ?? defaultMax);
        let refillRaw = raw?.refillIntervalMs ?? raw?.refillInterval ?? null;
        let refillMs = defaultRefill;
        if (refillRaw != null) {
          const num = Number(refillRaw);
          if (Number.isFinite(num)) refillMs = num > 1000 ? num : num * 1000;
        }
        const last = toMsTs(raw?.lastConsumedAt ?? raw?.lastConsumed ?? 0) || null;

        setGlobalLives(Number.isFinite(lives) ? lives : null);
        setGlobalMaxLives(Number.isFinite(max) ? max : defaultMax);
        setGlobalRefillMs(refillMs);
        setGlobalLastConsumedAt(last);
      } else {
        setGlobalLives(null);
        setGlobalMaxLives(defaultMax);
        setGlobalRefillMs(defaultRefill);
        setGlobalLastConsumedAt(null);
      }
    } else {
      setGlobalLives(null);
      setGlobalMaxLives(defaultMax);
      setGlobalRefillMs(defaultRefill);
      setGlobalLastConsumedAt(null);
    }

    if (grade && pkg.grade && normalizeGrade(pkg.grade) && normalizeGrade(pkg.grade) !== String(grade)) {
      setSubjects([]);
      setLoading(false);
      return;
    }

    const examMap = (await getValue([`Platform1/companyExams/exams`, `companyExams/exams`])) || {};
    const subjectsNode = pkg.subjects || {};
    const out = [];

    for (const subjectKey of Object.keys(subjectsNode)) {
      const subject = subjectsNode[subjectKey] || {};
      const roundsNode = subject.rounds || {};
      const roundsArr = [];

      for (const rid of Object.keys(roundsNode)) {
        const r = roundsNode[rid] || {};
        const examId = r.examId;
        const examMeta = examMap?.[examId] || {};

        let progressRaw = null;
        if (sid && rid && examId) {
          progressRaw = await getValue([
            `Platform1/studentProgress/${sid}/company/${rid}/${examId}`,
            `studentProgress/${sid}/company/${rid}/${examId}`,
          ]);
        }

        roundsArr.push({
          id: rid,
          roundId: rid,
          examId,
          questionBankId: examMeta.questionBankId || "",
          name: r.name || rid,
          chapter: r.chapter || "",
          totalQuestions: Number(examMeta.totalQuestions || 0),
          timeLimit: Number(examMeta.timeLimit || 0),
          difficulty: examMeta.difficulty || "medium",
          maxAttempts: Number(examMeta.maxAttempts || 1),
          attemptRefillIntervalMs: Number(examMeta.attemptRefillIntervalMs || 0),
          attemptRefillEnabled: examMeta.attemptRefillEnabled !== false,
          attemptsUsedRaw: Number(progressRaw?.attemptsUsed || 0),
          lastAttemptTsRaw: toMsTs(progressRaw?.lastAttemptTimestamp || progressRaw?.lastSubmittedAt || 0),
          status: r.status || "upcoming",
          startTimestamp: Number(r.startTimestamp || 0),
          endTimestamp: Number(r.endTimestamp || 0),
          resultReleaseTimestamp: Number(r.resultReleaseTimestamp || 0),
        });
      }

      out.push({
        id: subjectKey,
        keyName: subjectKey,
        name: subject.name || subjectKey,
        chapter: subject.chapter || "Subject rounds",
        rounds: roundsArr,
      });
    }

    setSubjects(out);
    buildWhatsNew(out);
    await loadNotifications();
    setLoading(false);
  }, [packageId, incomingGrade, buildWhatsNew, loadNotifications]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const isPractice = useMemo(() => String(packageType || "").toLowerCase() !== "competitive", [packageType]);

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

      const sid =
        (await AsyncStorage.getItem("studentNodeKey")) ||
        (await AsyncStorage.getItem("studentId")) ||
        (await AsyncStorage.getItem("username")) ||
        null;

      if (state.recovered > 0 && sid && !syncing) {
        syncing = true;
        try {
          await safeUpdate({
            [`Platform1/studentLives/${sid}/currentLives`]: state.currentLives,
            [`Platform1/studentLives/${sid}/lastConsumedAt`]: state.lastConsumedAt,
          });
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
    timer = setInterval(tickHeart, 1000);
    return () => clearInterval(timer);
  }, [globalLives, globalMaxLives, globalLastConsumedAt, globalRefillMs]);

  const deriveAttemptState = useCallback((round, now) => {
    const maxAttempts = Number(round.maxAttempts || 1);
    const usedRaw = Number(round.attemptsUsedRaw || 0);
    const lastTs = Number(round.lastAttemptTsRaw || 0);

    if (String(packageType || "").toLowerCase() === "competitive") {
      return { usedEffective: usedRaw, left: Math.max(0, maxAttempts - usedRaw), nextInMs: 0, refill: false };
    }

    const enabled = appExamConfig.attempts.practiceRefillEnabled && round.attemptRefillEnabled !== false;
    const refillMs = Number(round.attemptRefillIntervalMs || appExamConfig.attempts.defaultRefillIntervalMs || 0);

    if (!enabled || !refillMs || !lastTs) {
      return { usedEffective: usedRaw, left: Math.max(0, maxAttempts - usedRaw), nextInMs: 0, refill: false };
    }

    const recoveredRaw = Math.floor(Math.max(0, now - lastTs) / refillMs);
    const maxCarry = Number(appExamConfig.attempts.maxCarryRefills ?? 999);
    const recovered = Math.min(Math.max(0, recoveredRaw), Math.max(0, maxCarry));

    const usedEffective = Math.max(0, usedRaw - recovered);
    const left = Math.max(0, maxAttempts - usedEffective);

    const anchor = lastTs + recovered * refillMs;
    const nextInMs = left >= maxAttempts ? 0 : Math.max(0, refillMs - ((now - anchor) % refillMs));

    return { usedEffective, left, nextInMs, refill: true, recovered, anchor };
  }, [packageType, appExamConfig]);

  const applyAttemptRefillIfNeeded = useCallback(async (sid, round) => {
    if (!sid || !round?.examId || !round?.roundId) return;

    const st = deriveAttemptState(round, Date.now());
    if (!st.refill || st.recovered <= 0) return;

    const maxAttempts = Number(round.maxAttempts || 1);
    const usedNew = Math.max(0, Math.min(maxAttempts, st.usedEffective));
    const anchorTs = Number(st.anchor || Date.now());

    await safeUpdate({
      [`Platform1/studentProgress/${sid}/company/${round.roundId}/${round.examId}/attemptsUsed`]: usedNew,
      [`Platform1/studentProgress/${sid}/company/${round.roundId}/${round.examId}/lastAttemptTimestamp`]: anchorTs,
    }).catch(() => {});
  }, [deriveAttemptState]);

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
      timer = setInterval(tick, 5000);
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

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, styles.center, { paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) : 0 }]}>
        <ActivityIndicator color={PRIMARY} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) : 0 }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.replace({ pathname: "/dashboard/exam", params: { activeFilter: "gojo" } })}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={TEXT} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.title}>{packageName}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>Choose a subject and start a round</Text>
        </View>

        <TouchableOpacity onPress={() => setShowHeartInfoModal(true)} style={{ alignItems: "flex-end", minWidth: 72, marginRight: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Ionicons
              name={globalLives != null && globalLives > 0 ? "heart" : "heart-outline"}
              size={20}
              color={globalLives != null && globalLives > 0 ? HEART_COLOR : MUTED}
            />
            <Text style={{ marginLeft: 6, color: PRIMARY, fontWeight: "900" }}>
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
        <View style={styles.heroRow}>
          <View style={styles.heroChip}>
            <MaterialCommunityIcons
              name={isPractice ? "brain" : "trophy-outline"}
              size={14}
              color={PRIMARY}
            />
            <Text style={styles.heroChipText}>{isPractice ? "Practice" : "Competitive"}</Text>
          </View>
        </View>

        <Text style={styles.heroTitle}>{packageName}</Text>
        <Text style={styles.heroSubtitle}>Master each subject, then unlock every round confidently.</Text>

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
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 }}
        ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
        renderItem={({ item }) => {
          const expanded = expandedId === item.id;
          const v = getSubjectVisual(item.keyName, item.name, colors);

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
                  <Text style={styles.subjectChapter}>{item.chapter}</Text>
                    <View style={styles.subjectMetaRow}>
                      <Text style={styles.subjectMetaChip}>{(item.rounds || []).length} rounds</Text>
                    </View>
                  </View>
                </View>

                <View style={[styles.subjectChevronWrap, expanded && styles.subjectChevronWrapActive]}>
                  <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={PRIMARY} />
                </View>
              </TouchableOpacity>

              {expanded && (
                <View style={styles.expandArea}>
                  {(item.rounds || []).map((r, idx) => {
                    const attemptState = deriveAttemptState(r, nowTs);
                    const disabledByAttempts = attemptState.left <= 0;
                    const disabledByLives = isPractice && globalLives === 0;
                    const disabled = disabledByAttempts || disabledByLives;

                    return (
                      <View key={`${r.roundId}_${r.examId}`} style={{ marginBottom: 10 }}>
                        <View style={styles.roundRow}>
                          <View style={styles.roundMain}>
                            <View style={styles.roundOrderBadge}>
                              <Text style={styles.roundOrderText}>{idx + 1}</Text>
                            </View>
                            <View style={styles.roundTextWrap}>
                            <Text style={styles.roundName}>{r.name}</Text>
                            <Text style={styles.roundMeta}>
                              {(r.totalQuestions || 0)} Qs • {Math.round((r.timeLimit || 0) / 60)} min • {r.difficulty}
                            </Text>
                            </View>
                          </View>

                          <TouchableOpacity
                            disabled={disabled}
                            style={[styles.startBtn, disabled ? styles.startBtnDisabled : null]}
                            onPress={() =>
                              router.push({
                                pathname: "/examCenter",
                                params: {
                                  roundId: r.roundId,
                                  examId: r.examId,
                                  questionBankId: r.questionBankId,
                                  mode: "start",
                                  returnTo: "packageSubjects",
                                  returnPackageId: packageId || "",
                                  returnPackageName: packageName || "",
                                  returnStudentGrade: incomingGrade || "",
                                },
                              })
                            }
                          >
                            <Text style={styles.startBtnText}>{disabled ? "Locked" : isPractice ? "Start" : "Enter"}</Text>
                          </TouchableOpacity>
                        </View>

                        {disabled ? (
                          <View style={styles.lockInfo}>
                            {disabledByAttempts ? (
                              <>
                                <Text style={styles.noHeartText}>No attempts left for this exam.</Text>
                                {attemptState.refill && attemptState.nextInMs > 0 ? (
                                  <Text style={styles.refillText}>Next attempt in {formatMsToMMSS(attemptState.nextInMs)}</Text>
                                ) : null}
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
            <Text style={modalStyles.text}>Lives are global and configured by backend appConfig / studentLives.</Text>
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
    paddingTop: 8,
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
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  heroChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroChipText: {
    marginLeft: 6,
    fontSize: 11,
    fontWeight: "800",
    color: PRIMARY,
  },
  heroTitle: {
    marginTop: 6,
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },
  heroSubtitle: {
    marginTop: 2,
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
    borderBottomColor: colors.separator,
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
  subjectChevronWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  subjectChevronWrapActive: {
    borderColor: colors.primary,
    backgroundColor: colors.soft,
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
  roundMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginRight: 10,
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
  },
  roundName: { fontSize: 14, fontWeight: "800", color: colors.text, marginRight: 6 },
  roundMeta: { marginTop: 3, color: MUTED, fontSize: 12 },

  startBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 11,
    shadowColor: "#1D4ED8",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 2,
  },
  startBtnDisabled: { backgroundColor: colors.badgeBackground },
  startBtnText: { color: "#fff", fontWeight: "900", fontSize: 12, letterSpacing: 0.2 },

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