import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  InteractionManager,
  Alert,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get } from "../lib/offlineDatabase";
import { database } from "../constants/firebaseConfig";
import { resolveSchoolKeyFromStudentId } from "./lib/dbHelpers";
import { useAppTheme } from "../hooks/use-app-theme";
import PageLoadingSkeleton from "../components/ui/page-loading-skeleton";
import {
  downloadAssessmentBundle,
  readDownloadedAssessmentStateMap,
  persistCachedSubjectAssessments,
  readAssessmentSubmissionIndex,
  readCachedSubjectAssessments,
} from "../lib/schoolAssessments";

const PRIMARY = "#0B72FF";
const MUTED = "#6B78A8";
const SUCCESS = "#12B76A";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";
const INFO = "#0EA5E9";
const SUBJECT_ASSESSMENTS_CACHE_TTL_MS = 2 * 60 * 1000;
const SUBJECT_ASSESSMENTS_NODE_CACHE_MS = 90 * 1000;
const SUBJECT_ASSESSMENTS_SUBMISSION_CACHE_MS = 90 * 1000;

const SUBJECT_ICON_MAP = [
  { keys: ["english", "literature"], icon: "book-open-page-variant", color: "#6C5CE7" },
  { keys: ["math", "mathematics", "algebra", "geometry", "maths"], icon: "calculator-variant", color: "#00A8FF" },
  { keys: ["science", "general science", "biology", "chemistry", "physics"], icon: "flask", color: "#00B894" },
  { keys: ["environmental", "env"], icon: "leaf", color: "#00C897" },
  { keys: ["history", "social"], icon: "history", color: "#F39C12" },
  { keys: ["geography"], icon: "map", color: "#0984E3" },
  { keys: ["computer", "ict", "computing"], icon: "laptop", color: "#8E44AD" },
  { keys: ["physical", "pe", "sport"], icon: "run", color: "#E17055" },
  { keys: ["art"], icon: "palette", color: "#FF7675" },
];

function getSubjectVisual(subjectName = "") {
  const lower = String(subjectName).toLowerCase();
  const match = SUBJECT_ICON_MAP.find((item) =>
    item.keys.some((key) => lower.includes(key))
  );
  return match || { icon: "book-education-outline", color: PRIMARY };
}

function normalizeUnixTimestamp(ts) {
  const num = Number(ts);
  if (!num || Number.isNaN(num)) return null;
  return num < 1000000000000 ? num * 1000 : num;
}

function formatDueDate(dueDate) {
  const normalized = normalizeUnixTimestamp(dueDate);
  if (!normalized) return "No due date";

  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "No due date";

  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getAssessmentStatus({ submitted, finalScore, dueDate }) {
  if (submitted) {
    if (typeof finalScore === "number") {
      return { label: "Graded", color: SUCCESS, icon: "checkmark-circle" };
    }
    return { label: "Submitted", color: INFO, icon: "cloud-done-outline" };
  }

  const normalizedDueDate = normalizeUnixTimestamp(dueDate);
  if (normalizedDueDate && Date.now() > normalizedDueDate) {
    return { label: "Overdue", color: DANGER, icon: "alert-circle-outline" };
  }

  return { label: "Pending", color: WARNING, icon: "time-outline" };
}

function getTypeMeta(type = "") {
  const t = String(type || "").toLowerCase();

  if (t.includes("worksheet")) return { label: "Worksheet", icon: "document-text-outline" };
  if (t.includes("quiz")) return { label: "Quiz", icon: "help-circle-outline" };
  if (t.includes("test")) return { label: type || "Test", icon: "create-outline" };
  if (t.includes("exam")) return { label: "Exam", icon: "school-outline" };

  return { label: type || "Assessment", icon: "reader-outline" };
}

function getAssessmentSortTimestamp(item = {}, fallbackIndex = 0) {
  return Math.max(
    normalizeUnixTimestamp(item?.publishedAt) || 0,
    normalizeUnixTimestamp(item?.createdAt) || 0,
    normalizeUnixTimestamp(item?.updatedAt) || 0,
    normalizeUnixTimestamp(item?.openAt || item?.startAt || item?.availableFrom) || 0,
    Number(fallbackIndex || 0)
  );
}

function sortAssessmentsNewestFirst(items = []) {
  return [...items]
    .sort((left, right) => {
      const leftIndex = Number(left?.__sourceIndex || 0);
      const rightIndex = Number(right?.__sourceIndex || 0);
      const timeDiff = getAssessmentSortTimestamp(right, rightIndex) - getAssessmentSortTimestamp(left, leftIndex);
      if (timeDiff !== 0) return timeDiff;

      const indexDiff = rightIndex - leftIndex;
      if (indexDiff !== 0) return indexDiff;

      return String(right?.assessmentId || "").localeCompare(String(left?.assessmentId || ""));
    })
    .map(({ __sourceIndex, ...rest }) => rest);
}

async function resolveSchoolKeyFast(studentId) {
  if (!studentId) return null;

  try {
    const cached = await AsyncStorage.getItem("schoolKey");
    if (cached) return cached;
  } catch {}

  try {
    const resolvedSchoolKey = await resolveSchoolKeyFromStudentId(studentId);
    if (resolvedSchoolKey) {
      try {
        await AsyncStorage.setItem("schoolKey", resolvedSchoolKey);
      } catch {}
      return resolvedSchoolKey;
    }
  } catch {}

  return null;
}

async function readAssessmentSession() {
  const pairs = await AsyncStorage.multiGet(["studentNodeKey", "studentId", "username", "schoolKey"]);
  const session = Object.fromEntries(pairs || []);
  return {
    studentId: session.studentNodeKey || session.studentId || session.username || null,
    schoolKey: session.schoolKey || null,
  };
}

export default function SubjectAssessmentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { courseId, subject, grade, section, returnTo, returnExamFilter } = params;
  const warmStats = useMemo(() => {
    const total = Math.max(0, Number(params?.warmAssessmentCount || 0));
    const pending = Math.max(0, Number(params?.warmPendingAssessmentCount || 0));
    return {
      total,
      pending,
      submitted: Math.max(0, total - pending),
    };
  }, [params?.warmAssessmentCount, params?.warmPendingAssessmentCount]);
  const hasWarmShell = useMemo(
    () => !!subject || !!grade || !!section || warmStats.total > 0,
    [grade, section, subject, warmStats.total]
  );
  const cacheRouteParams = useMemo(() => ({
    courseId: String(courseId || ""),
    subject: String(subject || ""),
    grade: String(grade || ""),
    section: String(section || ""),
  }), [courseId, grade, section, subject]);

  const handleBackNavigation = useCallback(() => {
    if (String(returnTo || "") === "exam") {
      router.replace({
        pathname: "/dashboard/exam",
        params: { activeFilter: String(returnExamFilter || "school") },
      });
      return;
    }
    router.back();
  }, [returnTo, returnExamFilter, router]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState([]);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [downloadedMap, setDownloadedMap] = useState({});
  const [downloadProgressMap, setDownloadProgressMap] = useState({});

  const hydrateDownloadedMap = useCallback(async (assessmentItems = [], session = null) => {
    const activeSession = session || sessionInfo || await readAssessmentSession();
    const sid = activeSession?.studentId || null;
    if (!sid || !Array.isArray(assessmentItems) || !assessmentItems.length) {
      setDownloadedMap({});
      return;
    }

    const nextMap = await readDownloadedAssessmentStateMap(sid, assessmentItems);
    setDownloadedMap(nextMap);
  }, [sessionInfo]);

  const openAssessment = useCallback((item) => {
    router.push({
      pathname: "/takeAssessment",
      params: {
        assessmentId: item.assessmentId,
        courseId: item.courseId,
        title: item.title || "Assessment",
        warmTitle: String(item.title || "Assessment"),
        warmDueDate: String(item.dueDate || ""),
        warmTotalPoints: String(item.totalPoints || 0),
        warmQuestionCount: String(item.questionCount || 0),
        warmType: String(item.type || ""),
        warmSubmitted: item.submitted ? "1" : "0",
        warmFinalScore: item.finalScore != null ? String(item.finalScore) : "",
        returnTo: "subjectAssessments",
        returnCourseId: String(courseId || ""),
        returnSubject: String(subject || ""),
        returnGrade: String(grade || ""),
        returnSection: String(section || ""),
        returnExamFilter: String(returnExamFilter || "school"),
      },
    });
  }, [courseId, grade, returnExamFilter, router, section, subject]);

  const downloadAssessmentToPhone = useCallback(async (item) => {
    const assessmentKey = String(item?.assessmentId || "").trim();
    if (!assessmentKey || Number(downloadProgressMap?.[assessmentKey] || 0) > 0) return;

    const activeSession = sessionInfo || await readAssessmentSession();
    const sid = activeSession?.studentId || null;
    if (!sid) {
      Alert.alert("Download unavailable", "Student account was not found on this phone.");
      return;
    }

    let sk = activeSession?.schoolKey || null;
    if (!sk) {
      sk = await resolveSchoolKeyFast(sid);
    }

    setSessionInfo({ studentId: sid, schoolKey: sk || null });
    setDownloadProgressMap((prev) => ({ ...prev, [assessmentKey]: 8 }));

    try {
      setDownloadProgressMap((prev) => ({ ...prev, [assessmentKey]: 34 }));
      await downloadAssessmentBundle({
        studentId: sid,
        schoolKey: sk,
        assessmentId: assessmentKey,
        assessment: item,
      });
      setDownloadedMap((prev) => ({ ...prev, [assessmentKey]: true }));
      setDownloadProgressMap((prev) => ({ ...prev, [assessmentKey]: 0 }));
    } catch (error) {
      setDownloadProgressMap((prev) => ({ ...prev, [assessmentKey]: 0 }));
      Alert.alert("Download failed", error?.message || "Could not download this assessment.");
    }
  }, [downloadProgressMap, sessionInfo]);

  const handleAssessmentPress = useCallback((item, isDownloaded) => {
    if (!isDownloaded) {
      Alert.alert("Download first", "Download this assessment to the phone before opening it.");
      return;
    }

    openAssessment(item);
  }, [openAssessment]);

  const loadData = useCallback(async (options = {}) => {
    const background = Boolean(options?.background);
    const force = Boolean(options?.force);
    const session = options?.session || await readAssessmentSession();
    const sid = session?.studentId || null;
    setSessionInfo(session || null);

    if (!background) {
      setLoading(true);
    }

    try {
      const sk = await resolveSchoolKeyFast(sid);

      let assessmentsObj = {};
      if (sk) {
        const scoped = await get(
          ref(database, `Platform1/Schools/${sk}/SchoolExams/Assessments`),
          force ? null : { maxAgeMs: SUBJECT_ASSESSMENTS_NODE_CACHE_MS }
        );
        if (scoped.exists()) assessmentsObj = scoped.val() || {};
      }

      if (!Object.keys(assessmentsObj).length) {
        const global = await get(
          ref(database, `SchoolExams/Assessments`),
          force ? null : { maxAgeMs: SUBJECT_ASSESSMENTS_NODE_CACHE_MS }
        );
        if (global.exists()) assessmentsObj = global.val() || {};
      }

      const list = sortAssessmentsNewestFirst(
        Object.keys(assessmentsObj)
          .map((aid, index) => ({ assessmentId: aid, __sourceIndex: index, ...assessmentsObj[aid] }))
          .filter((a) => String(a.courseId) === String(courseId))
          .filter((a) => String(a.status || "").toLowerCase() !== "removed")
      );

      const enriched = await Promise.all(
        list.map(async (a) => {
          const idx = sid
            ? await readAssessmentSubmissionIndex({
                schoolKey: sk,
                assessmentId: a.assessmentId,
                studentId: sid,
                maxAgeMs: force ? 0 : SUBJECT_ASSESSMENTS_SUBMISSION_CACHE_MS,
              })
            : null;

          return {
            ...a,
            submitted: !!idx,
            finalScore: typeof idx?.finalScore === "number" ? idx.finalScore : null,
          };
        })
      );

      const sortedEnriched = sortAssessmentsNewestFirst(enriched);

      setItems(sortedEnriched);
      await hydrateDownloadedMap(sortedEnriched, { studentId: sid, schoolKey: sk || null });
      if (sid && courseId) {
        void persistCachedSubjectAssessments({
          studentId: sid,
          ...cacheRouteParams,
          schoolKey: sk || "",
          items: sortedEnriched,
        });
      }
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, [cacheRouteParams, courseId, hydrateDownloadedMap]);

  useEffect(() => {
    let cancelled = false;
    let task = null;

    (async () => {
      const session = await readAssessmentSession();
      setSessionInfo(session || null);
      const sid = session?.studentId || null;
      const cached = sid && courseId
        ? await readCachedSubjectAssessments({ studentId: sid, ...cacheRouteParams })
        : null;

      if (cancelled) return;

      const hasCachedSnapshot = !!cached && Array.isArray(cached.items);
      if (hasCachedSnapshot) {
        const sortedCachedItems = sortAssessmentsNewestFirst(cached.items);
        setItems(sortedCachedItems);
        void hydrateDownloadedMap(sortedCachedItems, session);
        setLoading(false);
      }

      const fetchedAt = Number(cached?.fetchedAt || 0);
      const cacheAgeMs = fetchedAt > 0 ? Date.now() - fetchedAt : Number.POSITIVE_INFINITY;
      const shouldRefresh = !hasCachedSnapshot || cacheAgeMs > SUBJECT_ASSESSMENTS_CACHE_TTL_MS;
      if (!shouldRefresh) return;

      task = InteractionManager.runAfterInteractions(() => {
        loadData({ background: hasCachedSnapshot, force: !hasCachedSnapshot, session }).catch(() => null);
      });
    })();

    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [cacheRouteParams, courseId, hydrateDownloadedMap, loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData({ force: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  const visual = useMemo(() => getSubjectVisual(subject), [subject]);

  const stats = useMemo(() => {
    if (loading && items.length === 0 && hasWarmShell) {
      return warmStats;
    }

    const total = items.length;
    const submitted = items.filter((x) => x.submitted).length;
    const pending = items.filter((x) => !x.submitted).length;
    return { total, submitted, pending };
  }, [hasWarmShell, items, loading, warmStats]);

  if (loading && !hasWarmShell) {
    return (
      <PageLoadingSkeleton variant="list" style={[styles.screen, { paddingTop: insets.top }]} />
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.assessmentId}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        contentContainerStyle={{
          paddingBottom: Math.max(24, insets.bottom + 16),
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />
        }
        ListHeaderComponent={
          <>
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
              <TouchableOpacity onPress={handleBackNavigation} style={styles.backIconBtn}>
                <Ionicons name="arrow-back" size={20} color={PRIMARY} />
              </TouchableOpacity>

              <View style={styles.headerTitleWrap}>
                <Text numberOfLines={1} style={styles.headerTitle}>{subject || "Subject"}</Text>
                <Text numberOfLines={1} style={styles.headerSubtitle}>School Assessments</Text>
              </View>

              <TouchableOpacity onPress={onRefresh} style={styles.headerActionBtn}>
                <Ionicons name="refresh-outline" size={18} color={PRIMARY} />
              </TouchableOpacity>
            </View>

            <View style={styles.heroCard}>
              <View style={styles.heroGlowA} />
              <View style={styles.heroGlowB} />

              <View style={styles.heroRow}>
                <Text numberOfLines={1} style={styles.heroTitleInline}>{subject || "Subject"}</Text>
                <View style={styles.heroChip}>
                  <MaterialCommunityIcons name={visual.icon} size={14} color={PRIMARY} />
                  <Text style={styles.heroChipText}>School</Text>
                </View>
              </View>

              <Text style={styles.heroSubTitle}>Grade {grade || "--"} • Section {section || "--"}</Text>
              <Text style={styles.heroText}>Download once and open from the phone.</Text>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{stats.total}</Text>
                <Text style={styles.statLabel}>Total</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statValue, { color: INFO }]}>{stats.submitted}</Text>
                <Text style={styles.statLabel}>Submitted</Text>
              </View>
              <View style={styles.statCardLast}>
                <Text style={[styles.statValue, { color: WARNING }]}>{stats.pending}</Text>
                <Text style={styles.statLabel}>Pending</Text>
              </View>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Assessments</Text>
              <Text style={styles.sectionSubtitle}>
                {loading
                  ? "Loading available assessments..."
                  : items.length
                  ? "Download first, then open offline."
                  : "No published assessments yet."}
              </Text>
            </View>
          </>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingStateWrap}>
              <ActivityIndicator size="small" color={PRIMARY} />
              <Text style={styles.loadingStateTitle}>Preparing assessments</Text>
              <Text style={styles.loadingStateText}>Fetching the latest work for this subject.</Text>
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons name="clipboard-text-outline" size={28} color={MUTED} />
              </View>
              <Text style={styles.emptyTitle}>No assessments available</Text>
              <Text style={styles.emptyText}>
                Your teacher has not published assessments for this subject yet.
              </Text>
            </View>
          )
        }
        renderItem={({ item, index }) => {
          const status = getAssessmentStatus({
            submitted: item.submitted,
            finalScore: item.finalScore,
            dueDate: item.dueDate,
          });

          const typeMeta = getTypeMeta(item.type);
          const dueLabel = formatDueDate(item.dueDate);
          const assessmentKey = String(item.assessmentId || "");
          const downloadPct = Number(downloadProgressMap?.[assessmentKey] || 0);
          const isDownloading = downloadPct > 0;
          const isDownloaded = !!downloadedMap?.[assessmentKey];

          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.92}
              onPress={() => handleAssessmentPress(item, isDownloaded)}
            >
              <View style={styles.cardMain}>
                <View style={styles.cardOrderBadge}>
                  <Text style={styles.cardOrderText}>{index + 1}</Text>
                </View>

                <View style={styles.cardTextWrap}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.title || "Assessment"}
                  </Text>

                  <Text style={styles.cardMetaPrimary} numberOfLines={1}>
                    {typeMeta.label} • {Number(item.questionCount || 0)} Qs • {Number(item.totalPoints || 0)} pts
                  </Text>

                  <View style={styles.cardChipRow}>
                    <View style={styles.metaChip}>
                      <Ionicons name="calendar-outline" size={12} color={MUTED} />
                      <Text style={styles.metaChipText}>{dueLabel}</Text>
                    </View>

                    <View style={[styles.statusBadge, { backgroundColor: `${status.color}18` }]}>
                      <Ionicons name={status.icon} size={11} color={status.color} />
                      <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={styles.cardFooter}>
                <View style={styles.cardScoreWrap}>
                  {typeof item.finalScore === "number" ? (
                    <Text style={styles.scoreText}>Score: {item.finalScore}</Text>
                  ) : (
                    <Text style={styles.scoreHint}>
                      {item.submitted
                        ? "Waiting for result"
                        : item.timeLimitMinutes
                        ? `${item.timeLimitMinutes} min limit`
                        : "No time limit"}
                    </Text>
                  )}
                </View>

                <View style={styles.cardActionRow}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    disabled={isDownloading}
                    style={[
                      styles.downloadWrap,
                      isDownloaded && styles.downloadWrapDone,
                      isDownloading && styles.downloadWrapBusy,
                    ]}
                    onPress={() => downloadAssessmentToPhone(item)}
                  >
                    {isDownloading ? (
                      <Text style={styles.downloadText}>{Math.round(downloadPct)}%</Text>
                    ) : (
                      <>
                        <Ionicons
                          name={isDownloaded ? "checkmark-circle" : "cloud-download-outline"}
                          size={14}
                          color={isDownloaded ? SUCCESS : PRIMARY}
                        />
                        <Text style={[styles.downloadText, isDownloaded && styles.downloadTextDone]}>
                          {isDownloaded ? "Saved" : "Download"}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.9}
                    disabled={!isDownloaded}
                    style={[styles.openWrap, !isDownloaded && styles.openWrapDisabled]}
                    onPress={() => openAssessment(item)}
                  >
                    <Text style={[styles.openText, !isDownloaded && styles.openTextDisabled]}>
                      {item.submitted ? "Review" : "Open"}
                    </Text>
                    <Ionicons name="arrow-forward" size={14} color={!isDownloaded ? MUTED : PRIMARY} />
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },

  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
    marginHorizontal: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.text,
  },
  headerSubtitle: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  backIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  headerActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  heroCard: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
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
    justifyContent: "flex-start",
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
  heroTitleInline: {
    flex: 1,
    marginRight: 10,
    fontSize: 18,
    fontWeight: "900",
    color: colors.text,
  },
  heroTitle: {
    marginTop: 6,
    fontSize: 18,
    fontWeight: "900",
    color: colors.text,
  },
  heroSubTitle: {
    marginTop: 4,
    fontSize: 12,
    color: colors.muted,
    fontWeight: "700",
  },
  heroText: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },

  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    marginTop: 8,
  },
  statCard: {
    flex: 1,
    marginRight: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 8,
    alignItems: "center",
  },
  statCardLast: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 8,
    alignItems: "center",
  },
  statValue: {
    fontSize: 17,
    fontWeight: "900",
    color: colors.text,
  },
  statLabel: {
    marginTop: 4,
    fontSize: 12,
    color: colors.muted,
    fontWeight: "700",
  },

  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: colors.text,
  },
  sectionSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: colors.muted,
    fontWeight: "600",
  },

  loadingStateWrap: {
    marginHorizontal: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    backgroundColor: colors.card,
  },
  loadingStateTitle: {
    marginTop: 10,
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  loadingStateText: {
    marginTop: 4,
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
  },

  emptyWrap: {
    marginHorizontal: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    backgroundColor: colors.card,
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.text,
  },
  emptyText: {
    marginTop: 6,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 19,
  },

  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 10,
    backgroundColor: colors.card,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.018,
    shadowRadius: 6,
    elevation: 0,
  },
  cardMain: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardOrderBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  cardOrderText: {
    color: PRIMARY,
    fontSize: 12,
    fontWeight: "800",
  },
  cardTextWrap: {
    flex: 1,
    marginRight: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
  },
  cardMetaPrimary: {
    marginTop: 3,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  cardChipRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusText: {
    marginLeft: 5,
    fontSize: 10.5,
    fontWeight: "800",
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginRight: 8,
    marginBottom: 8,
  },
  metaChipText: {
    marginLeft: 6,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },

  cardFooter: {
    marginTop: 2,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardActionRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardScoreWrap: {
    flex: 1,
  },
  scoreText: {
    color: SUCCESS,
    fontWeight: "800",
    fontSize: 12.5,
  },
  scoreHint: {
    color: colors.muted,
    fontWeight: "700",
    fontSize: 11.5,
  },
  downloadWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.soft,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginRight: 8,
    minWidth: 88,
  },
  downloadWrapDone: {
    backgroundColor: `${SUCCESS}14`,
  },
  downloadWrapBusy: {
    opacity: 0.84,
  },
  downloadText: {
    color: PRIMARY,
    fontWeight: "800",
    marginLeft: 6,
    fontSize: 11.5,
  },
  downloadTextDone: {
    color: SUCCESS,
  },
  openWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.soft,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  openWrapDisabled: {
    backgroundColor: colors.inputBackground,
  },
  openText: {
    color: PRIMARY,
    fontWeight: "800",
    marginRight: 6,
    fontSize: 11.5,
  },
  openTextDisabled: {
    color: MUTED,
  },
});
}