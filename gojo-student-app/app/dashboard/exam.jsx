import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
  RefreshControl,
  Dimensions,
  Modal,
  Animated,
} from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { ref, get } from "firebase/database";
import { database } from "../../constants/firebaseConfig";
import { useAppTheme } from "../../hooks/use-app-theme";
import { queryUserByUsernameInSchool, queryUserByChildInSchool } from "../lib/userHelpers";
import { getValue, getSnapshot } from "../lib/dbHelpers";
import { extractProfileImage } from "../lib/profileImage";

const { width: SCREEN_W } = Dimensions.get("window");

const PRIMARY = "#0B72FF";
const GOLD = "#F2C94C";
const SILVER = "#C0C6CC";
const BRONZE = "#D08A3A";

const CARD_W = Math.round(SCREEN_W * 0.78);
const STORY_AVATAR_SIZE = 54;
const PROMO_CARD_W = SCREEN_W - 32;
const PROMO_PEEK_CARD_W = SCREEN_W - 56;
const PROMO_CARD_GAP = 16;
const STICKY_TOP_AVATAR_SIZE = 38;
const STICKY_TOP_DEFAULT_STEP = 20;
const STICKY_TOP_MIN_STEP = 10;
const STICKY_TOP_MAX_WIDTH = 110;
const EXAM_FILTERS = [
  { key: "online", label: "Online Exam" },
  { key: "gojo", label: "Practice Exams" },
  { key: "school", label: "School Assessments" },
];

const SUBJECT_ICON_MAP = [
  { keys: ["english", "literature"], icon: "book-open-page-variant", color: "#6C5CE7" },
  { keys: ["math", "mathematics", "algebra", "geometry", "maths"], icon: "calculator-variant", color: "#00A8FF" },
  { keys: ["science", "general science", "biology", "chemistry", "physics"], icon: "flask", color: "#00B894" },
  { keys: ["environmental", "env"], icon: "leaf", color: "#00C897" },
  { keys: ["history", "social"], icon: "history", color: "#F39C12" },
  { keys: ["geography"], icon: "map", color: "#0984e3" },
  { keys: ["computer", "ict", "computing"], icon: "laptop", color: "#8e44ad" },
  { keys: ["physical", "pe", "sport"], icon: "run", color: "#e17055" },
  { keys: ["art"], icon: "palette", color: "#FF7675" },
];

function normalizeGrade(g) {
  if (!g) return null;
  const s = String(g).trim().toLowerCase();
  const matched = s.match(/(\d{1,2})/);
  if (matched) return String(matched[1]);
  return s.replace(/^grade\s*/i, "");
}

function normalizeSection(v) {
  return String(v || "").trim().toUpperCase() || null;
}

function normalizeToken(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function prettyLabelFromCourseId(courseId) {
  const raw = String(courseId || "").trim();
  if (!raw) return "Subject";

  const withoutPrefix = raw.replace(/^course[_-]?/i, "");
  const withoutTail = withoutPrefix.replace(/[_-]?\d{1,2}[a-z]?$/i, "");
  const clean = withoutTail || withoutPrefix;

  return clean
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ") || "Subject";
}

function toMsTimestamp(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num < 1e12 ? num * 1000 : num;
}

function formatPromoDate(ts) {
  if (!ts) return "Soon";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "Soon";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCountdownParts(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    { label: "D", value: String(days).padStart(2, "0") },
    { label: "H", value: String(hours).padStart(2, "0") },
    { label: "M", value: String(minutes).padStart(2, "0") },
    { label: "S", value: String(seconds).padStart(2, "0") },
  ];
}

function formatInlineCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (parts.length === 0) parts.push(`${seconds}s`);

  return parts.slice(0, 3).join(" ");
}

function countQuestionOrderItems(questionOrder) {
  if (Array.isArray(questionOrder)) return questionOrder.length;
  if (questionOrder && typeof questionOrder === "object") return Object.keys(questionOrder).length;
  return 0;
}

function summarizeAttemptEntries(attemptsNode = {}) {
  let entries = attemptsNode || {};
  if (attemptsNode && (attemptsNode.attemptStatus || attemptsNode.startTime || attemptsNode.scorePercent != null)) {
    entries = { legacy_single_attempt: attemptsNode };
  }

  const values = Object.values(entries || {});
  const completed = values.filter((entry) => String(entry?.attemptStatus || "").toLowerCase() === "completed");
  const inProgress = values.filter((entry) => String(entry?.attemptStatus || "").toLowerCase() === "in_progress");

  const latestCompleted = completed.sort(
    (a, b) => Number(b?.endTime || b?.startTime || 0) - Number(a?.endTime || a?.startTime || 0)
  )[0] || null;

  const totalQuestions = latestCompleted
    ? Number(latestCompleted?.total || latestCompleted?.totalQuestions || countQuestionOrderItems(latestCompleted?.questionOrder))
    : 0;
  const correctCount = latestCompleted ? Number(latestCompleted?.correctCount || 0) : 0;
  const wrongCount = Math.max(0, totalQuestions - correctCount);
  const pointsAwarded = latestCompleted ? Number(latestCompleted?.pointsAwarded || 0) : 0;
  const rankingCounted = latestCompleted
    ? String(latestCompleted?.rankingCounted).toLowerCase() === "true" || latestCompleted?.rankingCounted === true || Number(latestCompleted?.rankingCounted) === 1
    : false;
  const resultVisible = latestCompleted
    ? latestCompleted?.resultVisible == null
      ? rankingCounted
      : String(latestCompleted?.resultVisible).toLowerCase() === "true" || latestCompleted?.resultVisible === true || Number(latestCompleted?.resultVisible) === 1
    : false;

  return {
    hasCompleted: completed.length > 0,
    hasInProgress: inProgress.length > 0,
    hasTaken: completed.length > 0 || inProgress.length > 0,
    resultVisible,
    rankingCounted,
    pointsAwarded,
    scorePercent: latestCompleted ? Number(latestCompleted?.scorePercent || 0) : 0,
    correctCount,
    wrongCount,
    totalQuestions,
  };
}

function getPromoVisual(type, colors) {
  const t = String(type || "").toLowerCase();
  if (t === "new_round") {
    return { icon: "layers-outline", accent: "#7C3AED", badgeBg: colors.soft, surface: colors.elevatedSurface };
  }
  if (t === "new_package") {
    return { icon: "megaphone-outline", accent: colors.primary, badgeBg: colors.infoSurface, surface: colors.elevatedSurface };
  }
  if (t === "live") {
    return { icon: "flash-outline", accent: colors.warningText, badgeBg: colors.warningSurface, surface: colors.elevatedSurface };
  }
  return { icon: "alarm-outline", accent: colors.primary, badgeBg: colors.infoSurface, surface: colors.elevatedSurface };
}

function getSubjectVisual(subjectName = "") {
  const lower = String(subjectName).toLowerCase();
  const match = SUBJECT_ICON_MAP.find((item) =>
    item.keys.some((key) => lower.includes(key))
  );
  return (
    match || {
      icon: "book-education-outline",
      color: PRIMARY,
    }
  );
}

async function resolveSchoolKeyFast(studentId) {
  if (!studentId) return null;

  try {
    const cached = await AsyncStorage.getItem("schoolKey");
    if (cached) return cached;
  } catch {}

  try {
    const schoolsSnap = await getSnapshot([`Platform1/Schools`]);
    const schools = schoolsSnap?.val ? schoolsSnap.val() || {} : {};
    for (const schoolKey of Object.keys(schools)) {
      const sSnap = await get(ref(database, `Platform1/Schools/${schoolKey}/Students/${studentId}`));
      if (sSnap?.exists()) {
        try {
          await AsyncStorage.setItem("schoolKey", schoolKey);
        } catch {}
        return schoolKey;
      }
    }
  } catch {}

  return null;
}

async function resolveUserProfile(userId) {
  if (!userId) return {};
  try {
    const prefix = String(userId).slice(0, 3).toUpperCase();
    const codeSnap = await get(ref(database, `Platform1/schoolCodeIndex/${prefix}`));
    const schoolKey = codeSnap?.val() || null;
    let profile = null;

    if (schoolKey) {
      try {
        const snap = await queryUserByUsernameInSchool(userId, schoolKey);
        if (snap?.exists()) snap.forEach((c) => { profile = c.val(); return true; });
      } catch {}
    }

    if (!profile) {
      try {
        const snap = await queryUserByChildInSchool("username", userId, null);
        if (snap?.exists()) snap.forEach((c) => { profile = c.val(); return true; });
      } catch {}
    }

    if (!profile) {
      try {
        const rootUser = await get(ref(database, `Users/${userId}`));
        if (rootUser?.exists()) profile = rootUser.val();
      } catch {}
    }

    return { profile };
  } catch {
    return {};
  }
}

async function resolveStudentGradeForRankUser(userId, fallbackSchoolCode = null) {
  try {
    if (!userId) return null;

    const candidates = [];
    if (fallbackSchoolCode) candidates.push(fallbackSchoolCode);

    try {
      const pref = String(userId).slice(0, 3).toUpperCase();
      const idx = await get(ref(database, `Platform1/schoolCodeIndex/${pref}`));
      const indexedSchoolCode = idx?.val() || null;
      if (indexedSchoolCode && !candidates.includes(indexedSchoolCode)) {
        candidates.push(indexedSchoolCode);
      }
    } catch {}

    for (const schoolCode of candidates) {
      if (!schoolCode) continue;

      let user = null;

      const direct = await get(ref(database, `Platform1/Schools/${schoolCode}/Users/${userId}`));
      if (direct?.exists()) user = direct.val();

      if (!user) {
        try {
          const byUsername = await queryUserByUsernameInSchool(userId, schoolCode);
          if (byUsername?.exists()) {
            byUsername.forEach((c) => {
              user = c.val();
              return true;
            });
          }
        } catch {}
      }

      if (!user) {
        try {
          const byUserId = await queryUserByChildInSchool("userId", userId, schoolCode);
          if (byUserId?.exists()) {
            byUserId.forEach((c) => {
              user = c.val();
              return true;
            });
          }
        } catch {}
      }

      const studentId = user?.studentId || null;
      if (!studentId) continue;

      const st = await get(ref(database, `Platform1/Schools/${schoolCode}/Students/${studentId}`));
      if (!st?.exists()) continue;

      const sv = st.val() || {};
      const grade = normalizeGrade(
        sv?.basicStudentInformation?.grade ??
        sv?.grade ??
        null
      );
      if (grade) return grade;
    }

    return null;
  } catch {
    return null;
  }
}

async function resolveStudentAndSchoolDetailsForProfile(userId, fallbackSchoolCode = null) {
  try {
    if (!userId) return { user: null, student: null, schoolInfo: null, schoolCode: null };

    const candidates = [];
    if (fallbackSchoolCode) candidates.push(fallbackSchoolCode);

    try {
      const pref = String(userId).slice(0, 3).toUpperCase();
      const idx = await get(ref(database, `Platform1/schoolCodeIndex/${pref}`));
      const indexedSchoolCode = idx?.val() || null;
      if (indexedSchoolCode && !candidates.includes(indexedSchoolCode)) {
        candidates.push(indexedSchoolCode);
      }
    } catch {}

    for (const schoolCode of candidates) {
      if (!schoolCode) continue;

      let user = null;

      const direct = await get(ref(database, `Platform1/Schools/${schoolCode}/Users/${userId}`));
      if (direct?.exists()) user = direct.val();

      if (!user) {
        try {
          const byUsername = await queryUserByUsernameInSchool(userId, schoolCode);
          if (byUsername?.exists()) {
            byUsername.forEach((c) => {
              user = c.val();
              return true;
            });
          }
        } catch {}
      }

      if (!user) {
        try {
          const byUserId = await queryUserByChildInSchool("userId", userId, schoolCode);
          if (byUserId?.exists()) {
            byUserId.forEach((c) => {
              user = c.val();
              return true;
            });
          }
        } catch {}
      }

      const studentId = user?.studentId || null;
      let student = null;
      if (studentId) {
        const st = await get(ref(database, `Platform1/Schools/${schoolCode}/Students/${studentId}`));
        if (st?.exists()) student = st.val();
      }

      const schoolInfoSnap = await get(ref(database, `Platform1/Schools/${schoolCode}/schoolInfo`));
      const schoolInfo = schoolInfoSnap?.exists() ? schoolInfoSnap.val() : null;

      if (user || student || schoolInfo) {
        return { user, student, schoolInfo, schoolCode };
      }
    }

    return { user: null, student: null, schoolInfo: null, schoolCode: fallbackSchoolCode || null };
  } catch {
    return { user: null, student: null, schoolInfo: null, schoolCode: fallbackSchoolCode || null };
  }
}

function formatGradeLabel(student) {
  const normalized = normalizeGrade(
    student?.basicStudentInformation?.grade ||
    student?.grade ||
    ""
  );
  return normalized ? `Grade ${normalized}` : "-";
}

export default function ExamScreen() {
  const router = useRouter();
  const tabBarHeight = useBottomTabBarHeight();
  const routeParams = useLocalSearchParams();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const MUTED = colors.muted;
  const scrollBottomPadding = Math.max(72, tabBarHeight + 12);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [leaders, setLeaders] = useState([]);
  const [packages, setPackages] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [studentGrade, setStudentGrade] = useState(null);
  const [leaderCountry, setLeaderCountry] = useState("Ethiopia");
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [upcomingExamModalVisible, setUpcomingExamModalVisible] = useState(false);
  const [selectedUpcomingExam, setSelectedUpcomingExam] = useState(null);
  const [topTiePickerVisible, setTopTiePickerVisible] = useState(false);
  const [topTieCandidates, setTopTieCandidates] = useState([]);
  const [topTieRank, setTopTieRank] = useState(null);
  const [activeFilter, setActiveFilter] = useState("online");
  const [expandedOnlineSubjectId, setExpandedOnlineSubjectId] = useState(null);
  const [promoNowTs, setPromoNowTs] = useState(Date.now());
  const [promoCardIndex, setPromoCardIndex] = useState(0);
  const [onlineExamAttemptState, setOnlineExamAttemptState] = useState({});
  const loadLeadersRef = useRef(null);
  const loadPackagesRef = useRef(null);
  const loadSubjectsFastRef = useRef(null);
  const promoListRef = useRef(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const screenData = useMemo(() => [{ id: "exam-content" }], []);

  useEffect(() => {
    const nextFilter = String(routeParams?.activeFilter || "").toLowerCase();
    if (["online", "gojo", "school"].includes(nextFilter)) {
      setActiveFilter(nextFilter);
    }
  }, [routeParams?.activeFilter]);

  useEffect(() => {
    if (activeFilter !== "online") return;

    setPromoNowTs(Date.now());
    const id = setInterval(() => setPromoNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeFilter]);

  const loadOnlineExamAttemptState = useCallback(async (studentId) => {
    if (!studentId) {
      setOnlineExamAttemptState({});
      return;
    }

    try {
      const attemptsRoot = (await getValue([
        `Platform1/attempts/company/${studentId}`,
        `attempts/company/${studentId}`,
      ])) || {};

      const next = {};
      Object.keys(attemptsRoot || {}).forEach((examKey) => {
        const examAttempts = attemptsRoot?.[examKey] || {};
        next[String(examKey)] = summarizeAttemptEntries(examAttempts);
      });

      setOnlineExamAttemptState(next);
    } catch {
      setOnlineExamAttemptState({});
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const sid =
        (await AsyncStorage.getItem("studentNodeKey")) ||
        (await AsyncStorage.getItem("studentId")) ||
        (await AsyncStorage.getItem("username")) ||
        null;

      const schoolKey = await resolveSchoolKeyFast(sid);

      const cachedGrade = normalizeGrade(await AsyncStorage.getItem("studentGrade"));
      let effectiveGrade = cachedGrade;

      if (sid && schoolKey) {
        try {
          const st = await get(ref(database, `Platform1/Schools/${schoolKey}/Students/${sid}`));
          if (st?.exists()) {
            const sv = st.val() || {};
            const fromStudent = normalizeGrade(
              sv?.basicStudentInformation?.grade ??
              sv?.grade ??
              null
            );
            if (fromStudent) effectiveGrade = fromStudent;
          }
        } catch {}
      }

      setStudentGrade(effectiveGrade || null);

      await Promise.all([
        loadLeadersRef.current?.(effectiveGrade),
        loadPackagesRef.current?.(effectiveGrade),
        loadSubjectsFastRef.current?.({ studentId: sid, schoolKey }),
        loadOnlineExamAttemptState(sid),
      ]);
    } finally {
      setLoading(false);
    }
  }, [loadOnlineExamAttemptState]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  const loadLeaders = useCallback(async (grade) => {
    try {
      const countrySnap = await getSnapshot([`Platform1/country`, `country`]);
      const country = countrySnap?.val?.() || "Ethiopia";
      setLeaderCountry(country);
      const gradeKey = grade ? `grade${grade}` : "grade9";

      const snap = await getSnapshot([
        `Platform1/rankings/country/${country}/${gradeKey}/leaderboard`,
        `rankings/country/${country}/${gradeKey}/leaderboard`,
      ]);

      const raw = [];
      const val = snap?.val ? snap.val() : null;
      if (val) {
        Object.keys(val).forEach((key) => raw.push({
          userId: key,
          rank: Number(val[key]?.rank || 999),
          totalPoints: Number(val[key]?.totalPoints || 0),
        }));
      }

      raw.sort((a, b) => (a.rank || 999) - (b.rank || 999));

      const targetGrade = normalizeGrade(grade);
      const enriched = await Promise.all(
        raw.map(async (e) => {
          const { profile } = await resolveUserProfile(e.userId);
          const profileSchoolCode = profile?.schoolCode || null;
          const resolvedGrade = await resolveStudentGradeForRankUser(e.userId, profileSchoolCode);
          return {
            ...e,
            profile: profile || null,
            resolvedGrade,
          };
        })
      );

      const sameGrade = enriched.filter((e) => normalizeGrade(e.resolvedGrade) === targetGrade);
      const visibleRanks = [...new Set(
        sameGrade.map((entry, index) => Number(entry?.rank || index + 1))
      )].slice(0, 4);

      if (!visibleRanks.length) {
        setLeaders(sameGrade.slice(0, 4));
        return;
      }

      setLeaders(
        sameGrade.filter((entry, index) => visibleRanks.includes(Number(entry?.rank || index + 1)))
      );
    } catch {
      setLeaderCountry("Ethiopia");
      setLeaders([]);
    }
  }, []);

  const loadPackages = useCallback(async (grade) => {
    try {
      const pkgVal = await getValue([`Platform1/companyExams/packages`, `companyExams/packages`]);
      if (!pkgVal) return setPackages([]);

      const arr = [];
      Object.keys(pkgVal).forEach((key) => {
        const v = pkgVal[key] || {};
        const pkgGrade = normalizeGrade(v.grade);
        if (grade && pkgGrade && pkgGrade !== String(grade)) return;

        arr.push({
          id: key,
          name: v.name || key,
          subtitle:
            v.type === "competitive"
              ? "National Challenge"
              : v.type === "practice"
              ? "Practice Pack"
              : v.type === "entrance"
              ? "Entrance Prep"
              : "Special Pack",
          description: v.description || "Explore package",
          type: v.type || "practice",
          packageIcon: v.packageIcon || "",
          subjectCount: Object.keys(v.subjects || {}).length,
          subjectsData: v.subjects || {},
          active: v.active !== false,
        });
      });

      setPackages(arr.filter((p) => p.active));
    } catch {
      setPackages([]);
    }
  }, []);

  const loadSubjectsFast = useCallback(async ({ studentId, schoolKey }) => {
    try {
      if (!studentId || !schoolKey) return setSubjects([]);

      let studentGradeValue = null;
      let studentSection = null;

      const studentSnap = await get(ref(database, `Platform1/Schools/${schoolKey}/Students/${studentId}`));
      if (studentSnap.exists()) {
        const sv = studentSnap.val() || {};
        studentGradeValue =
          normalizeGrade(
            sv?.basicStudentInformation?.grade ??
            sv?.grade ??
            null
          ) || null;

        studentSection =
          normalizeSection(
            sv?.basicStudentInformation?.section ??
            sv?.section ??
            ""
          ) || null;
      }

      if (!studentGradeValue || !studentSection) {
        setSubjects([]);
        return;
      }

      const gradeMgmtSnap = await get(
        ref(database, `Platform1/Schools/${schoolKey}/GradeManagement/grades/${studentGradeValue}`)
      );

      if (!gradeMgmtSnap.exists()) {
        setSubjects([]);
        return;
      }

      const gradeNode = gradeMgmtSnap.val() || {};
      const sectionNode = gradeNode?.sections?.[studentSection] || {};
      const sectionCoursesMap = sectionNode?.courses || {};
      const courseIds = Object.keys(sectionCoursesMap).filter((k) => !!sectionCoursesMap[k]);

      const teacherAssignments = gradeNode?.sectionSubjectTeachers?.[studentSection] || {};
      const gradeSubjects = gradeNode?.subjects || {};
      const assignmentByCourseId = {};

      Object.keys(teacherAssignments).forEach((subjectKey) => {
        const row = teacherAssignments[subjectKey] || {};
        if (row?.courseId) {
          assignmentByCourseId[row.courseId] = {
            subjectKey,
            ...row,
          };
        }
      });

      const resolveSubjectName = (courseId, assignment) => {
        const direct =
          assignment?.subject ||
          assignment?.subjectName ||
          gradeSubjects?.[assignment?.subjectKey || ""]?.name ||
          "";

        if (String(direct).trim()) return String(direct).trim();

        const byKeyMatch = Object.keys(gradeSubjects).find((k) => {
          const keyToken = normalizeToken(k);
          return keyToken && normalizeToken(courseId).includes(keyToken);
        });
        if (byKeyMatch && String(gradeSubjects?.[byKeyMatch]?.name || "").trim()) {
          return String(gradeSubjects[byKeyMatch].name).trim();
        }

        return prettyLabelFromCourseId(courseId);
      };

      const baseSubjects = courseIds.map((courseId) => {
        const assignment = assignmentByCourseId[courseId] || {};
        const subjectName = resolveSubjectName(courseId, assignment);
        return {
          courseId,
          subject: subjectName,
          name: subjectName,
          grade: studentGradeValue,
          section: studentSection,
          teacherId: assignment.teacherId || "",
          teacherName: assignment.teacherName || "",
        };
      });

      let assessmentsObj = {};
      let scopedSubmissionIndex = {};
      let globalSubmissionIndex = {};

      const assessmentsSnap = await get(
        ref(database, `Platform1/Schools/${schoolKey}/SchoolExams/Assessments`)
      );
      if (assessmentsSnap.exists()) assessmentsObj = assessmentsSnap.val() || {};

      if (!Object.keys(assessmentsObj).length) {
        const globalAssessmentsSnap = await get(ref(database, `SchoolExams/Assessments`));
        if (globalAssessmentsSnap.exists()) assessmentsObj = globalAssessmentsSnap.val() || {};
      }

      const scopedSubmissionSnap = await get(
        ref(database, `Platform1/Schools/${schoolKey}/SchoolExams/SubmissionIndex`)
      );
      if (scopedSubmissionSnap.exists()) scopedSubmissionIndex = scopedSubmissionSnap.val() || {};

      const globalSubmissionSnap = await get(ref(database, `SchoolExams/SubmissionIndex`));
      if (globalSubmissionSnap.exists()) globalSubmissionIndex = globalSubmissionSnap.val() || {};

      const countByCourse = {};
      const pendingCountByCourse = {};
      Object.keys(assessmentsObj).forEach((aid) => {
        const item = assessmentsObj[aid] || {};
        const cid = item.courseId;
        if (!cid) return;
        if (item.status === "removed") return;

        countByCourse[cid] = (countByCourse[cid] || 0) + 1;

        const scopedSubmission = scopedSubmissionIndex?.[aid]?.[studentId] || null;
        const globalSubmission = globalSubmissionIndex?.[aid]?.[studentId] || null;
        const submitted = !!(scopedSubmission || globalSubmission);

        if (!submitted) {
          pendingCountByCourse[cid] = (pendingCountByCourse[cid] || 0) + 1;
        }
      });

      const out = baseSubjects.map((c) => ({
        ...c,
        assessmentCount: countByCourse[c.courseId] || 0,
        pendingAssessmentCount: pendingCountByCourse[c.courseId] || 0,
      }));

      setSubjects(out);
    } catch {
      setSubjects([]);
    }
  }, []);

  loadLeadersRef.current = loadLeaders;
  loadPackagesRef.current = loadPackages;
  loadSubjectsFastRef.current = loadSubjectsFast;

  const onlineExamPackages = useMemo(
    () => packages.filter((p) => p.type === "competitive"),
    [packages]
  );

  const onlineExamSubjects = useMemo(() => {
    const map = {};

    onlineExamPackages.forEach((pkg) => {
      const subjectsData = pkg?.subjectsData || {};
      Object.keys(subjectsData).forEach((subjectKey) => {
        const row = subjectsData[subjectKey] || {};
        const name = String(row?.name || row?.title || subjectKey || "Subject").trim();
        const normalized = name.toLowerCase();
        if (!map[normalized]) {
          map[normalized] = { id: normalized, name, packageCount: 0, exams: [] };
        }
        map[normalized].packageCount += 1;

        const pushExam = ({ examName, roundId, examId, questionBankId, startTs, endTs }) => {
          const e = String(examName || "").trim();
          if (!e) return;
          const existing = map[normalized].exams.find((x) => x.name === e);
          if (existing) {
            if (!existing.roundId) existing.roundId = roundId || null;
            if (!existing.examId) existing.examId = examId || null;
            if (!existing.questionBankId) existing.questionBankId = questionBankId || "";

            const shouldPreferThisRound =
              (!existing.startTs && !!startTs) ||
              (!!startTs && !!existing.startTs && startTs < existing.startTs);

            if (shouldPreferThisRound) {
              existing.startTs = startTs || existing.startTs || 0;
              existing.endTs = endTs || existing.endTs || 0;
              if (roundId) existing.roundId = roundId;
              if (examId) existing.examId = examId;
              if (questionBankId) existing.questionBankId = questionBankId;
            }
          } else {
            map[normalized].exams.push({
              name: e,
              roundId: roundId || null,
              examId: examId || null,
              questionBankId: questionBankId || "",
              startTs: startTs || 0,
              endTs: endTs || 0,
            });
          }
        };

        const rounds = row?.rounds || {};
        Object.keys(rounds).forEach((rid) => {
          const r = rounds[rid] || {};
          const startTs = toMsTimestamp(
            r?.startTimestamp ||
            r?.releaseTimestamp ||
            r?.startAt ||
            r?.startsAt ||
            0
          );
          const endTs = toMsTimestamp(r?.endTimestamp || r?.endAt || 0);

          pushExam({
            examName: r?.name || r?.examName || rid,
            roundId: rid,
            examId: r?.examId,
            questionBankId: r?.questionBankId,
            startTs,
            endTs,
          });
        });
      });
    });

    return Object.values(map)
      .map((subject) => ({
        ...subject,
        exams: [...subject.exams].sort((a, b) => {
          const aTs = Number(a?.startTs || 0);
          const bTs = Number(b?.startTs || 0);

          if (aTs && bTs && aTs !== bTs) return aTs - bTs;
          if (aTs && !bTs) return -1;
          if (!aTs && bTs) return 1;
          return String(a?.name || "").localeCompare(String(b?.name || ""));
        }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [onlineExamPackages]);

  const practiceExamPackages = useMemo(
    () => packages.filter((p) => p.type === "practice"),
    [packages]
  );

  const onlineRoundTimeline = useMemo(() => {
    const rows = [];

    onlineExamPackages.forEach((pkg) => {
      const subjectsData = pkg?.subjectsData || {};
      Object.keys(subjectsData).forEach((subjectKey) => {
        const subjectRow = subjectsData[subjectKey] || {};
        const subjectName = String(subjectRow?.name || subjectRow?.title || subjectKey || "Subject").trim();
        const rounds = subjectRow?.rounds || {};

        Object.keys(rounds).forEach((roundId) => {
          const round = rounds[roundId] || {};
          const startTs = toMsTimestamp(
            round?.startTimestamp ||
            round?.releaseTimestamp ||
            round?.startAt ||
            round?.startsAt ||
            0
          );
          if (!startTs) return;

          rows.push({
            id: `${pkg.id}-${subjectKey}-${roundId}`,
            packageId: pkg.id,
            packageName: pkg.name || "Competitive Package",
            subjectName,
            roundId,
            roundName: String(round?.name || roundId || "Upcoming Round"),
            examId: round?.examId || "",
            questionBankId: round?.questionBankId || "",
            status: String(round?.status || "").toLowerCase(),
            startTs,
            endTs: toMsTimestamp(round?.endTimestamp || round?.endAt || 0),
          });
        });
      });
    });

    return rows.sort((a, b) => a.startTs - b.startTs);
  }, [onlineExamPackages]);

  const upcomingOnlineReleases = useMemo(
    () => onlineRoundTimeline.filter((item) => item.startTs > promoNowTs),
    [onlineRoundTimeline, promoNowTs]
  );

  const liveOnlineRoundsCount = useMemo(
    () => onlineRoundTimeline.filter((item) => item.startTs <= promoNowTs && (!item.endTs || item.endTs >= promoNowTs)).length,
    [onlineRoundTimeline, promoNowTs]
  );

  const onlinePromoCards = useMemo(() => {
    const gradeLabel = studentGrade ? `Grade ${studentGrade}` : "your grade";

    if (upcomingOnlineReleases.length > 0) {
      const visual = getPromoVisual("countdown", colors);
      return upcomingOnlineReleases.slice(0, 5).map((release, index) => ({
        id: `countdown-${release.id}`,
        icon: visual.icon,
        accent: visual.accent,
        badgeBg: visual.badgeBg,
        surface: visual.surface,
        badge: index === 0 ? "Upcoming exam" : "Also upcoming",
        stamp: formatPromoDate(release.startTs),
        title: release.roundName,
        subtitle: `${release.subjectName} • ${release.packageName}`,
        countdownParts: formatCountdownParts(release.startTs - promoNowTs),
        body: "Countdown for the next national online exam release.",
        footer: "",
        route: null,
      }));
    }

    const visual = getPromoVisual(liveOnlineRoundsCount > 0 ? "live" : "countdown", colors);
    return [{
      id: "competitive-release-overview",
      icon: visual.icon,
      accent: visual.accent,
      badgeBg: visual.badgeBg,
      surface: visual.surface,
      badge: liveOnlineRoundsCount > 0 ? "Live now" : "Upcoming exam",
      stamp: leaderCountry,
      title: liveOnlineRoundsCount > 0
        ? `${liveOnlineRoundsCount} round${liveOnlineRoundsCount === 1 ? "" : "s"} live now`
        : "Countdown will appear here",
      subtitle: liveOnlineRoundsCount > 0
        ? `Students across ${leaderCountry} are already competing in national exams.`
        : `The next premium online exam release for ${gradeLabel} will show a live countdown here.`,
      countdownParts: null,
      body: liveOnlineRoundsCount > 0
        ? `${onlineExamSubjects.length} subjects are already open in National Competitive Exams.`
        : `${onlineExamPackages.length} competitive package${onlineExamPackages.length === 1 ? "" : "s"} ready for the next release.`,
      footer: liveOnlineRoundsCount > 0 ? "Open a subject below to join now" : "Waiting for the next scheduled release",
      route: null,
    }];
  }, [
    upcomingOnlineReleases,
    liveOnlineRoundsCount,
    onlineExamPackages,
    onlineExamSubjects.length,
    leaderCountry,
    studentGrade,
    promoNowTs,
    colors,
  ]);

  const promoCarouselCardWidth = onlinePromoCards.length > 1 ? PROMO_PEEK_CARD_W : PROMO_CARD_W;

  const handlePromoScrollEnd = useCallback((event) => {
    const nextIndex = Math.round(
      event.nativeEvent.contentOffset.x / (promoCarouselCardWidth + PROMO_CARD_GAP)
    );
    const clampedIndex = Math.max(0, Math.min(nextIndex, Math.max(onlinePromoCards.length - 1, 0)));
    setPromoCardIndex(clampedIndex);
  }, [onlinePromoCards.length, promoCarouselCardWidth]);

  useEffect(() => {
    if (promoCardIndex < onlinePromoCards.length) return;
    setPromoCardIndex(0);
  }, [promoCardIndex, onlinePromoCards.length]);

  useEffect(() => {
    if (activeFilter !== "online" || onlinePromoCards.length <= 1) return;
    promoListRef.current?.scrollToOffset({
      offset: promoCardIndex * (promoCarouselCardWidth + PROMO_CARD_GAP),
      animated: true,
    });
  }, [activeFilter, promoCardIndex, onlinePromoCards.length, promoCarouselCardWidth]);

  useEffect(() => {
    if (activeFilter !== "online" || onlinePromoCards.length <= 1) return;

    const id = setInterval(() => {
      setPromoCardIndex((prev) => (prev + 1) % onlinePromoCards.length);
    }, 4500);

    return () => clearInterval(id);
  }, [activeFilter, onlinePromoCards.length]);

  const renderOnlinePromoCard = useCallback((card, cardWidth = null) => (
    <View
      style={[
        styles.promoCard,
        cardWidth ? { width: cardWidth } : null,
        {
          backgroundColor: card.surface,
          borderColor: card.badgeBg,
        },
      ]}
    >
      <View style={[styles.promoGlowOrb, { backgroundColor: card.badgeBg }]} />

      <View style={styles.promoCardTopRow}>
        <View style={[styles.promoBadge, { backgroundColor: card.badgeBg }]}> 
          <Ionicons name={card.icon} size={14} color={card.accent} />
          <Text style={[styles.promoBadgeText, { color: card.accent }]}>{card.badge}</Text>
        </View>
        <Text style={styles.promoStampText}>{card.stamp}</Text>
      </View>

      <Text numberOfLines={1} style={styles.promoTitle}>{card.title}</Text>
      <Text numberOfLines={1} style={styles.promoSubtitle}>{card.subtitle}</Text>

      {card.countdownParts ? (
        <View style={styles.promoCountdownRow}>
          {card.countdownParts.map((part) => (
            <View key={`${card.id}-${part.label}`} style={styles.promoCountdownBlock}>
              <Text style={styles.promoCountdownValue}>{part.value}</Text>
              <Text style={styles.promoCountdownLabel}>{part.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text numberOfLines={1} style={styles.promoBody}>{card.body}</Text>

      {card.footer ? (
        <View style={styles.promoFooter}>
          <Text numberOfLines={1} style={styles.promoFooterText}>{card.footer}</Text>
          <Ionicons
            name={card.route ? "arrow-forward" : "sparkles-outline"}
            size={16}
            color={card.accent}
          />
        </View>
      ) : null}
    </View>
  ), [styles]);

  const openTopProfile = useCallback(async (item) => {
    if (!item?.userId) return;

    setProfileModalVisible(true);
    setProfileLoading(true);
    setSelectedProfile(null);

    const { profile } = await resolveUserProfile(item.userId);
    const fallbackSchoolCode = profile?.schoolCode || null;
    const details = await resolveStudentAndSchoolDetailsForProfile(item.userId, fallbackSchoolCode);

    const gender =
      details?.student?.basicStudentInformation?.gender ||
      details?.student?.gender ||
      details?.user?.gender ||
      "";

    const school =
      details?.schoolInfo?.name ||
      details?.schoolInfo?.schoolName ||
      details?.user?.schoolName ||
      details?.user?.schoolCode ||
      details?.schoolCode ||
      "";

    const region =
      details?.schoolInfo?.region ||
      details?.schoolInfo?.address?.region ||
      "";

    const city =
      details?.schoolInfo?.city ||
      details?.schoolInfo?.address?.city ||
      "";

    setSelectedProfile({
      name: profile?.name || profile?.username || item.userId,
      rank: Number(item?.rank || 0),
      points: Number(item?.totalPoints || 0),
      avatar: extractProfileImage(profile),
      grade: formatGradeLabel(details?.student),
      gender,
      school,
      region,
      city,
    });
    setProfileLoading(false);
  }, []);

  const openUpcomingExamPreview = useCallback((subjectName, exam, variant = "upcoming", attemptState = null) => {
    if (!exam) return;

    setSelectedUpcomingExam({
      variant,
      subjectName: subjectName || "Subject",
      name: exam?.name || (variant === "pending" ? "Exam pending" : variant === "scored" ? "Exam result" : variant === "taken" ? "Exam already taken" : "Upcoming Exam"),
      startTs: Number(exam?.startTs || 0),
      endTs: Number(exam?.endTs || 0),
      roundId: exam?.roundId || "",
      examId: exam?.examId || "",
      pointsAwarded: Number(attemptState?.pointsAwarded || 0),
      scorePercent: Number(attemptState?.scorePercent || 0),
      correctCount: Number(attemptState?.correctCount || 0),
      wrongCount: Number(attemptState?.wrongCount || 0),
      totalQuestions: Number(attemptState?.totalQuestions || 0),
      resultVisible: !!attemptState?.resultVisible,
    });
    setUpcomingExamModalVisible(true);
  }, []);

  const handleOnlineExamPress = useCallback(async (subjectName, exam, cachedAttemptState = null) => {
    if (!exam) return;

    const startTs = Number(exam?.startTs || 0);

    if (startTs > promoNowTs) {
      openUpcomingExamPreview(subjectName, exam, "upcoming");
      return;
    }

    if (cachedAttemptState?.hasCompleted) {
      const previewVariant = !cachedAttemptState?.resultVisible || !cachedAttemptState?.rankingCounted
        ? "pending"
        : "scored";
      openUpcomingExamPreview(subjectName, exam, previewVariant, cachedAttemptState);
      return;
    }

    if (!exam?.roundId || !exam?.examId) return;

    try {
      const sid =
        (await AsyncStorage.getItem("studentNodeKey")) ||
        (await AsyncStorage.getItem("studentId")) ||
        (await AsyncStorage.getItem("username")) ||
        null;

      if (sid) {
        const attemptsNode = (await getValue([
          `Platform1/attempts/company/${sid}/${exam.examId}`,
          `attempts/company/${sid}/${exam.examId}`,
        ])) || {};

        const liveAttemptState = summarizeAttemptEntries(attemptsNode);

        if (liveAttemptState.hasCompleted) {
          const previewVariant = !liveAttemptState?.resultVisible || !liveAttemptState?.rankingCounted
            ? "pending"
            : "scored";
          openUpcomingExamPreview(subjectName, exam, previewVariant, liveAttemptState);
          return;
        }
      }
    } catch {}

    router.push({
      pathname: "/examCenter",
      params: {
        roundId: exam.roundId,
        examId: exam.examId,
        questionBankId: exam.questionBankId || "",
        mode: "start",
        returnTo: "exam",
        returnExamFilter: "online",
      },
    });
  }, [openUpcomingExamPreview, promoNowTs, router]);

  const topRankGroups = useMemo(() => {
    const grouped = [];
    const seen = new Set();

    leaders.forEach((item, index) => {
      const rank = Number(item?.rank || index + 1);
      if (seen.has(rank)) return;
      const group = leaders.filter((x, idx) => Number(x?.rank || idx + 1) === rank);
      seen.add(rank);
      grouped.push({ rank, representative: group[0], tiedItems: group });
    });

    return grouped;
  }, [leaders]);

  const handleTopRankPress = useCallback((group) => {
    const tiedItems = group?.tiedItems || [];
    if (!tiedItems.length) return;
    if (tiedItems.length === 1) {
      openTopProfile(tiedItems[0]);
      return;
    }
    setTopTieRank(group.rank);
    setTopTieCandidates(tiedItems);
    setTopTiePickerVisible(true);
  }, [openTopProfile]);

  const stickyTopProfiles = useMemo(
    () => topRankGroups
      .flatMap((group) => {
        const tiedItems = Array.isArray(group?.tiedItems) ? group.tiedItems : [];
        if (tiedItems.length) return tiedItems;
        return group?.representative ? [group.representative] : [];
      })
      .slice(0, 6),
    [topRankGroups]
  );

  const stickyAvatarStep = useMemo(() => {
    if (stickyTopProfiles.length <= 1) return STICKY_TOP_AVATAR_SIZE;

    const availableWidth = STICKY_TOP_MAX_WIDTH - STICKY_TOP_AVATAR_SIZE;
    const compressedStep = Math.floor(availableWidth / (stickyTopProfiles.length - 1));

    return Math.max(
      STICKY_TOP_MIN_STEP,
      Math.min(STICKY_TOP_DEFAULT_STEP, compressedStep)
    );
  }, [stickyTopProfiles.length]);

  const stickyAvatarOverlap = STICKY_TOP_AVATAR_SIZE - stickyAvatarStep;

  const stickyProfilesTargetWidth = useMemo(() => {
    if (!stickyTopProfiles.length) return 0;
    return Math.min(
      STICKY_TOP_MAX_WIDTH,
      STICKY_TOP_AVATAR_SIZE + Math.max(0, stickyTopProfiles.length - 1) * stickyAvatarStep
    );
  }, [stickyAvatarStep, stickyTopProfiles.length]);

  const stickyProfilesProgress = scrollY.interpolate({
    inputRange: [24, 92],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  const stickyProfilesWidth = scrollY.interpolate({
    inputRange: [24, 92],
    outputRange: [0, stickyProfilesTargetWidth],
    extrapolate: "clamp",
  });

  const stickyProfilesTranslateX = scrollY.interpolate({
    inputRange: [24, 92],
    outputRange: [-20, 0],
    extrapolate: "clamp",
  });

  const stickyProfilesTranslateY = scrollY.interpolate({
    inputRange: [24, 92],
    outputRange: [7, 0],
    extrapolate: "clamp",
  });

  const stickyProfilesScale = scrollY.interpolate({
    inputRange: [24, 92],
    outputRange: [0.82, 1],
    extrapolate: "clamp",
  });

  const leftTitleOpacity = scrollY.interpolate({
    inputRange: [0, 20, 64],
    outputRange: [1, 0.55, 0],
    extrapolate: "clamp",
  });

  const leftTitleTranslateY = scrollY.interpolate({
    inputRange: [0, 64],
    outputRange: [0, -4],
    extrapolate: "clamp",
  });

  const centeredTitleOpacity = scrollY.interpolate({
    inputRange: [18, 70],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  const centeredTitleTranslateY = scrollY.interpolate({
    inputRange: [18, 70],
    outputRange: [8, 0],
    extrapolate: "clamp",
  });

  const centeredTitleScale = scrollY.interpolate({
    inputRange: [18, 70],
    outputRange: [0.96, 1],
    extrapolate: "clamp",
  });

  const headerVerticalPadding = scrollY.interpolate({
    inputRange: [0, 88],
    outputRange: [8, 5],
    extrapolate: "clamp",
  });

  const topBarSurfaceOpacity = scrollY.interpolate({
    inputRange: [0, 14, 72],
    outputRange: [0, 0.18, 1],
    extrapolate: "clamp",
  });

  const topBarSurfaceScale = scrollY.interpolate({
    inputRange: [0, 72],
    outputRange: [0.985, 1],
    extrapolate: "clamp",
  });

  const heroProfilesTranslateY = scrollY.interpolate({
    inputRange: [0, 48, 108],
    outputRange: [0, -18, -42],
    extrapolate: "clamp",
  });

  const heroProfilesTranslateX = scrollY.interpolate({
    inputRange: [0, 108],
    outputRange: [0, -10],
    extrapolate: "clamp",
  });

  const heroProfilesScale = scrollY.interpolate({
    inputRange: [0, 44, 108],
    outputRange: [1, 0.97, 0.88],
    extrapolate: "clamp",
  });

  const heroProfilesOpacity = scrollY.interpolate({
    inputRange: [0, 38, 96, 118],
    outputRange: [1, 0.88, 0.22, 0],
    extrapolate: "clamp",
  });

  const topSection = useMemo(() => (
    <View>
      <Animated.View
        style={[
          styles.storyListMotionWrap,
          {
            opacity: heroProfilesOpacity,
            transform: [
              { translateY: heroProfilesTranslateY },
              { translateX: heroProfilesTranslateX },
              { scale: heroProfilesScale },
            ],
          },
        ]}
      >
        <View style={styles.storyListWrap}>
        <FlatList
          data={topRankGroups}
          horizontal
          keyExtractor={(i, idx) => `rank-${i.rank}-${idx}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, paddingRight: 44 }}
          showsHorizontalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ width: 8 }} />}
          renderItem={({ item, index }) => {
            const rank = Number(item.rank || index + 1);
            const main = item.representative || null;
            const tiedItems = Array.isArray(item.tiedItems) ? item.tiedItems : [];
            const name = main?.profile?.name || main?.profile?.username || main?.userId || "-";
            const avatar = main?.profile?.profileImage || null;
            const trophyColor = rank === 1 ? GOLD : rank === 2 ? SILVER : rank === 3 ? BRONZE : null;
            const rankFrameStyle =
              rank === 1
                ? styles.rankFrameGold
                : rank === 2
                ? styles.rankFrameSilver
                : rank === 3
                ? styles.rankFrameBronze
                : null;

            const rankGlowStyle =
              rank === 1
                ? styles.rankGlowGold
                : rank === 2
                ? styles.rankGlowSilver
                : rank === 3
                ? styles.rankGlowBronze
                : null;

            const rankBadgeStyle =
              rank === 1
                ? styles.rankBadgeGold
                : rank === 2
                ? styles.rankBadgeSilver
                : rank === 3
                ? styles.rankBadgeBronze
                : styles.rankBadgeDefault;

            return (
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.storyWrap}
                onPress={() => handleTopRankPress(item)}
              >
                <View style={[styles.rankFrame, rankFrameStyle]}>
                  <View style={[styles.avatarShadow, rankGlowStyle]}>
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={styles.avatar} />
                    ) : (
                      <View style={styles.avatarFallback}>
                        <Text style={styles.avatarLetter}>{(name || "U")[0]}</Text>
                      </View>
                    )}
                  </View>
                  {rank <= 3 ? (
                    <View style={[styles.trophyBadge, { backgroundColor: trophyColor }]}>
                      <Ionicons name="trophy" size={10} color="#fff" />
                    </View>
                  ) : null}

                  <View style={[styles.rankBottomBadge, rankBadgeStyle]}>
                    <Text style={styles.rankBottomBadgeText}>{rank}</Text>
                  </View>
                </View>
                <Text numberOfLines={1} style={styles.storyName}>{name}</Text>
                {tiedItems.length > 1 ? (
                  <View style={styles.storyTieStackWrap}>
                    {tiedItems.slice(0, 4).map((person, idx) => {
                      const tieAvatar = person?.profile?.profileImage || null;
                      const tieName = person?.profile?.name || person?.profile?.username || person?.userId || "U";
                      return (
                        <View
                          key={`${person?.userId || idx}-${idx}`}
                          style={[
                            styles.storyTieAvatarWrap,
                            idx > 0 ? { marginLeft: -9 } : null,
                          ]}
                        >
                          {tieAvatar ? (
                            <Image source={{ uri: tieAvatar }} style={styles.storyTieAvatar} />
                          ) : (
                            <View style={styles.storyTieFallback}>
                              <Text style={styles.storyTieLetter}>{tieName[0]}</Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                    <Text style={styles.storyTieText}>+{tiedItems.length - 1}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          }}
        />

        <TouchableOpacity
          style={styles.storyNextBtn}
          activeOpacity={0.9}
          onPress={() => router.push("../leaderboard")}
        >
          <Ionicons name="chevron-forward" size={22} color={PRIMARY} />
        </TouchableOpacity>
        </View>
      </Animated.View>

      <View style={styles.topFiltersWrap}>
        {EXAM_FILTERS.map((filter) => {
          const active = activeFilter === filter.key;
          return (
            <TouchableOpacity
              key={filter.key}
              activeOpacity={0.9}
              onPress={() => setActiveFilter(filter.key)}
              style={[styles.topFilterBtn, active && styles.topFilterBtnActive]}
            >
              <Text
                numberOfLines={1}
                style={[styles.topFilterText, active && styles.topFilterTextActive]}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {activeFilter === "online" ? (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>National Competitive Exams</Text>
          </View>

          {onlinePromoCards.length ? (
            <View style={styles.onlinePromoSection}>
              {onlinePromoCards.length > 1 ? (
                <>
                  <FlatList
                    ref={promoListRef}
                    data={onlinePromoCards}
                    horizontal
                    keyExtractor={(item) => item.id}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.onlinePromoContent}
                    ItemSeparatorComponent={() => <View style={{ width: PROMO_CARD_GAP }} />}
                    renderItem={({ item }) => renderOnlinePromoCard(item, promoCarouselCardWidth)}
                    snapToInterval={promoCarouselCardWidth + PROMO_CARD_GAP}
                    snapToAlignment="start"
                    decelerationRate="fast"
                    disableIntervalMomentum
                    onMomentumScrollEnd={handlePromoScrollEnd}
                    getItemLayout={(_, index) => ({
                      length: promoCarouselCardWidth + PROMO_CARD_GAP,
                      offset: index * (promoCarouselCardWidth + PROMO_CARD_GAP),
                      index,
                    })}
                  />

                  <View style={styles.promoDotsRow}>
                    {onlinePromoCards.map((card, index) => (
                      <View
                        key={`${card.id}-dot`}
                        style={[
                          styles.promoDot,
                          index === promoCardIndex ? styles.promoDotActive : null,
                        ]}
                      />
                    ))}
                  </View>
                </>
              ) : (
                <View style={styles.onlinePromoSingleWrap}>
                  {renderOnlinePromoCard(onlinePromoCards[0])}
                </View>
              )}
            </View>
          ) : null}

          {onlineExamSubjects.length === 0 ? (
            <View style={styles.emptyAssessments}>
              <MaterialCommunityIcons name="trophy-outline" size={24} color={MUTED} />
              <Text style={styles.emptyAssessmentsText}>No national competitive exam subjects available right now.</Text>
            </View>
          ) : (
            <View style={styles.onlineListWrap}>
              {onlineExamSubjects.map((item) => {
                const upcomingExamCount = item.exams.filter((exam) => Number(exam?.startTs || 0) > promoNowTs).length;

                return (
                <View key={item.id} style={styles.onlineListItemWrap}>
                  <TouchableOpacity
                    style={[styles.onlineListItem, expandedOnlineSubjectId === item.id && styles.onlineListItemExpanded]}
                    activeOpacity={0.9}
                    onPress={() =>
                      setExpandedOnlineSubjectId((prev) => (prev === item.id ? null : item.id))
                    }
                  >
                    <View style={styles.onlineListLeft}>
                      <View style={styles.onlineListIconFallback}>
                        <MaterialCommunityIcons name="book-open-page-variant-outline" size={20} color={PRIMARY} />
                      </View>

                      <View style={styles.onlineListTextWrap}>
                        <Text numberOfLines={1} style={styles.onlineListTitle}>{item.name}</Text>
                        <View style={styles.onlineListMetaChip}>
                          <Text numberOfLines={1} style={styles.onlineListMeta}>
                            Grade {studentGrade || "--"} • {item.exams.length} exam{item.exams.length === 1 ? "" : "s"}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {upcomingExamCount > 0 ? (
                      <View style={styles.onlineListCountBadge}>
                        <Text style={styles.onlineListCountText}>{upcomingExamCount > 99 ? "99+" : upcomingExamCount}</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>

                  {expandedOnlineSubjectId === item.id ? (
                    <View style={styles.onlineExamDropWrap}>
                      {item.exams.length ? (
                        item.exams.map((exam, idx) => {
                          const startTs = Number(exam?.startTs || 0);
                          const endTs = Number(exam?.endTs || 0);

                          const hasSetup = !!exam?.roundId && !!exam?.examId;
                          const attemptState = onlineExamAttemptState[String(exam?.examId || "")] || {};
                          const hasCompletedAttempt = !!attemptState?.hasCompleted;
                          const hasInProgressAttempt = !!attemptState?.hasInProgress;
                          const hasVisibleResult = !!attemptState?.resultVisible;
                          const hasRankedResult = !!attemptState?.rankingCounted;
                          const earnedPoints = Number(attemptState?.pointsAwarded || 0);

                          const isUpcoming = startTs > promoNowTs;
                          const isPending = hasCompletedAttempt && (!hasVisibleResult || !hasRankedResult);
                          const isScored = hasCompletedAttempt && hasVisibleResult && hasRankedResult;
                          const isExpired = !hasCompletedAttempt && !hasInProgressAttempt && !!endTs && endTs < promoNowTs;
                          const isLive = hasSetup && !isUpcoming && !isExpired && !isPending && !isScored && (!!startTs ? startTs <= promoNowTs : true) && (!endTs || endTs >= promoNowTs);

                          const canOpenExam = hasSetup && !isUpcoming && !isExpired && !hasCompletedAttempt;
                          const canShowPreview = isUpcoming || isPending || isScored;

                          const metaText = isUpcoming
                            ? `Opens in ${formatInlineCountdown(startTs - promoNowTs)}`
                            : isPending
                            ? "Point pending"
                            : isScored
                            ? `${earnedPoints} ${earnedPoints === 1 ? "point" : "points"}`
                            : isExpired
                            ? "Expired"
                            : !hasSetup
                            ? "Exam setup unavailable"
                            : endTs
                            ? `Ends in ${formatInlineCountdown(endTs - promoNowTs)}`
                            : "Live now";

                          const statusPill = isUpcoming
                            ? "UPCOMING"
                            : isPending
                            ? "PENDING"
                            : isScored
                            ? `${earnedPoints} ${earnedPoints === 1 ? "PT" : "PTS"}`
                            : isExpired
                            ? "EXPIRED"
                            : !hasSetup
                            ? "UNAVAILABLE"
                            : "LIVE";

                          return (
                            <TouchableOpacity
                              key={`${item.id}-exam-${idx}`}
                              style={[
                                styles.onlineExamDropItem,
                                !hasSetup && !canShowPreview && !isExpired && styles.onlineExamDropItemDisabled,
                                isUpcoming && styles.onlineExamDropItemUpcoming,
                                isLive && styles.onlineExamDropItemLive,
                                isPending && styles.onlineExamDropItemPending,
                                isScored && styles.onlineExamDropItemScored,
                                isExpired && styles.onlineExamDropItemExpired,
                              ]}
                              activeOpacity={0.9}
                              onPress={() => {
                                if (!canOpenExam && !canShowPreview) return;
                                handleOnlineExamPress(item.name, exam, attemptState);
                              }}
                              disabled={!canOpenExam && !canShowPreview}
                            >
                              <View style={styles.onlineExamDropMain}>
                                <View style={styles.onlineExamOrderBadge}>
                                  <Text style={styles.onlineExamOrderText}>{idx + 1}</Text>
                                </View>
                                <View style={styles.onlineExamDropTextWrap}>
                                  <Text numberOfLines={1} style={styles.onlineExamDropTitle}>{exam.name}</Text>
                                  <Text
                                    numberOfLines={1}
                                    style={[
                                      styles.onlineExamDropMeta,
                                      isUpcoming && styles.onlineExamDropMetaUpcoming,
                                      isLive && styles.onlineExamDropMetaLive,
                                      isPending && styles.onlineExamDropMetaPending,
                                      isScored && styles.onlineExamDropMetaScored,
                                      isExpired && styles.onlineExamDropMetaExpired,
                                    ]}
                                  >
                                    {metaText}
                                  </Text>
                                </View>
                              </View>

                              {statusPill ? (
                                <View
                                  style={[
                                    styles.onlineExamStatusPill,
                                    statusPill === "UPCOMING" && styles.onlineExamStatusPillUpcoming,
                                    statusPill === "LIVE" && styles.onlineExamStatusPillLive,
                                    statusPill === "PENDING" && styles.onlineExamStatusPillPending,
                                    (statusPill === "1 PT" || /PTS$/.test(statusPill)) && styles.onlineExamStatusPillScored,
                                    statusPill === "EXPIRED" && styles.onlineExamStatusPillExpired,
                                    statusPill === "UNAVAILABLE" && styles.onlineExamStatusPillUnavailable,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.onlineExamStatusText,
                                      statusPill === "UPCOMING" && styles.onlineExamStatusTextUpcoming,
                                      statusPill === "LIVE" && styles.onlineExamStatusTextLive,
                                      statusPill === "PENDING" && styles.onlineExamStatusTextPending,
                                      (statusPill === "1 PT" || /PTS$/.test(statusPill)) && styles.onlineExamStatusTextScored,
                                      statusPill === "EXPIRED" && styles.onlineExamStatusTextExpired,
                                      statusPill === "UNAVAILABLE" && styles.onlineExamStatusTextUnavailable,
                                    ]}
                                  >
                                    {statusPill}
                                  </Text>
                                </View>
                              ) : null}
                            </TouchableOpacity>
                          );
                        })
                      ) : (
                        <View style={styles.onlineExamDropEmptyRow}>
                          <Text style={styles.onlineExamDropEmptyText}>No exams available yet for this subject.</Text>
                        </View>
                      )}
                    </View>
                  ) : null}
                </View>
                );
              })}
            </View>
          )}
        </>
      ) : null}

      {activeFilter === "gojo" ? (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Practice Exams</Text>
            <Text style={styles.sectionSubtitle}>Practice-only packages for daily preparation</Text>
          </View>

          {practiceExamPackages.length === 0 ? (
            <View style={styles.emptyAssessments}>
              <MaterialCommunityIcons name="book-open-page-variant-outline" size={24} color={MUTED} />
              <Text style={styles.emptyAssessmentsText}>No practice exams available right now.</Text>
            </View>
          ) : (
            <View style={styles.practiceListWrap}>
              {practiceExamPackages.map((item) => {
                const iconName = "book-open-page-variant-outline";

                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.onlineListItemWrap}
                    activeOpacity={0.92}
                    onPress={() =>
                      router.push({
                        pathname: "/packageSubjects",
                        params: {
                          packageId: item.id,
                          packageName: item.name,
                          studentGrade: studentGrade || "",
                        },
                      })
                    }
                  >
                    <View style={styles.onlineListItem}>
                      <View style={styles.onlineListLeft}>
                        {item.packageIcon ? (
                          <Image source={{ uri: item.packageIcon }} style={styles.onlineListIconFallback} />
                        ) : (
                          <View style={styles.onlineListIconFallback}>
                            <MaterialCommunityIcons name={iconName} size={20} color={PRIMARY} />
                          </View>
                        )}

                        <View style={styles.practiceListTextWrap}>
                          <Text numberOfLines={2} style={styles.practiceListTitle}>{item.name}</Text>
                          <View style={styles.practiceListMetaChip}>
                            <Text numberOfLines={1} style={styles.practiceListMeta}>
                              {item.subjectCount || 0} subjects • {item.subtitle}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </>
      ) : null}

      {activeFilter === "school" ? (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>School Assessments</Text>
            <Text style={styles.sectionSubtitle}>Subjects for your current grade and section</Text>
          </View>

          {subjects.length === 0 ? (
            <View style={styles.emptyAssessments}>
              <MaterialCommunityIcons name="clipboard-text-outline" size={24} color={MUTED} />
              <Text style={styles.emptyAssessmentsText}>No subjects found for this student.</Text>
            </View>
          ) : (
            <View style={styles.schoolListWrap}>
              {subjects.map((item) => {
                const visual = getSubjectVisual(item.subject);
                return (
                  <TouchableOpacity
                    key={item.courseId}
                    style={styles.schoolBookCard}
                    activeOpacity={0.92}
                    onPress={() =>
                      router.push({
                        pathname: "/subjectAssessments",
                        params: {
                          courseId: item.courseId,
                          subject: item.subject,
                          grade: item.grade,
                          section: item.section,
                          returnTo: "exam",
                          returnExamFilter: "school",
                        },
                      })
                    }
                  >
                    <View style={styles.schoolBookHeader}>
                      <View style={styles.schoolBookHeaderLeft}>
                        <View style={styles.schoolBookIconWrap}>
                          <MaterialCommunityIcons name={visual.icon} size={28} color={visual.color} />
                        </View>

                        <View style={styles.schoolBookTextWrap}>
                          <Text numberOfLines={1} style={styles.schoolBookTitle}>{item.subject}</Text>
                          <Text numberOfLines={1} style={styles.schoolBookSub}>
                            Grade {item.grade || "--"} • Section {item.section || "--"}
                          </Text>
                          <View style={styles.schoolBookMetaRow}>
                            <Text style={styles.schoolBookMetaChip}>
                              {item.assessmentCount > 0
                                ? `${item.assessmentCount} assessment${item.assessmentCount === 1 ? "" : "s"}`
                                : "No assessments yet"}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {item.pendingAssessmentCount > 0 ? (
                        <View style={styles.schoolBookCountBadge}>
                          <Text style={styles.schoolBookCountText}>
                            {item.pendingAssessmentCount > 99 ? "99+" : item.pendingAssessmentCount}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </>
      ) : null}

      <Modal
        visible={upcomingExamModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setUpcomingExamModalVisible(false)}
      >
        <View style={styles.profileModalOverlay}>
          <View style={styles.upcomingExamModalCard}>
            <View style={styles.upcomingExamModalGlow} />

            <View style={styles.upcomingExamModalBadge}>
              <Ionicons
                name={selectedUpcomingExam?.variant === "taken" || selectedUpcomingExam?.variant === "pending" ? "checkmark-circle-outline" : "alarm-outline"}
                size={14}
                color={PRIMARY}
              />
              <Text style={styles.upcomingExamModalBadgeText}>
                {selectedUpcomingExam?.variant === "pending"
                  ? "Pending result"
                  : selectedUpcomingExam?.variant === "taken"
                  ? "Exam taken"
                  : "Upcoming exam"}
              </Text>
            </View>

            <Text style={styles.upcomingExamModalTitle}>
              {selectedUpcomingExam?.name || "Upcoming Exam"}
            </Text>
            <Text style={styles.upcomingExamModalSubtitleText}>
              {(selectedUpcomingExam?.subjectName || "General Subject")} • National Competitive Exam
            </Text>

            {selectedUpcomingExam?.variant === "taken" || selectedUpcomingExam?.variant === "pending" || selectedUpcomingExam?.variant === "scored" ? (
              <>
                <View style={styles.upcomingExamModalNote}>
                  <Ionicons name="information-circle-outline" size={15} color={PRIMARY} />
                  <Text style={styles.upcomingExamModalNoteText}>
                    {selectedUpcomingExam?.variant === "pending"
                      ? "You took this exam. Exam point pending."
                      : selectedUpcomingExam?.variant === "scored"
                      ? `You got ${Number(selectedUpcomingExam?.pointsAwarded || 0)} ${Number(selectedUpcomingExam?.pointsAwarded || 0) === 1 ? "point" : "points"}.`
                      : "You already took this exam. Exam point pending."}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                  <View style={{ flex: 1, borderWidth: 1, borderColor: colors.successBorder, backgroundColor: colors.successSurface, borderRadius: 14, paddingVertical: 10, alignItems: "center" }}>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700" }}>Correct</Text>
                    <Text style={{ color: colors.success, fontSize: 18, fontWeight: "900", marginTop: 4 }}>{Number(selectedUpcomingExam?.correctCount || 0)}</Text>
                  </View>
                  <View style={{ flex: 1, borderWidth: 1, borderColor: colors.dangerBorder, backgroundColor: colors.dangerSurface, borderRadius: 14, paddingVertical: 10, alignItems: "center" }}>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700" }}>Wrong</Text>
                    <Text style={{ color: colors.danger, fontSize: 18, fontWeight: "900", marginTop: 4 }}>{Number(selectedUpcomingExam?.wrongCount || 0)}</Text>
                  </View>
                </View>
              </>
            ) : (
              <>
                <View style={styles.upcomingExamModalInfoRow}>
                  <Ionicons name="calendar-outline" size={14} color={PRIMARY} />
                  <Text style={styles.upcomingExamModalInfoText}>
                    Opens {formatPromoDate(selectedUpcomingExam?.startTs || 0)}
                  </Text>
                </View>

                {selectedUpcomingExam?.startTs ? (
                  <View style={styles.upcomingExamModalCountdownRow}>
                    {formatCountdownParts(
                      Math.max(0, Number(selectedUpcomingExam?.startTs || 0) - promoNowTs)
                    ).map((part) => (
                      <View
                        key={`${selectedUpcomingExam?.examId || selectedUpcomingExam?.roundId || part.label}-${part.label}`}
                        style={styles.upcomingExamModalCountdownBlock}
                      >
                        <Text style={styles.upcomingExamModalCountdownValue}>{part.value}</Text>
                        <Text style={styles.upcomingExamModalCountdownLabel}>{part.label}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.upcomingExamModalNote}>
                  <Ionicons name="sparkles-outline" size={15} color={PRIMARY} />
                  <Text style={styles.upcomingExamModalNoteText}>
                    This exam will open soon. When the countdown ends, come back here and start it from the subject list.
                  </Text>
                </View>
              </>
            )}

            <TouchableOpacity style={styles.closeBtn} onPress={() => setUpcomingExamModalVisible(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={topTiePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTopTiePickerVisible(false)}
      >
        <View style={styles.profileModalOverlay}>
          <View style={styles.profileModalCard}>
            <Text style={styles.tieModalTitle}>Rank #{topTieRank} is tied</Text>
            <Text style={styles.tieModalSubtitle}>Choose a student to view profile details.</Text>

            <FlatList
              data={topTieCandidates}
              keyExtractor={(i, idx) => `${i.userId}-${idx}`}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              style={{ maxHeight: 280, width: "100%" }}
              renderItem={({ item }) => {
                const personName = item?.profile?.name || item?.profile?.username || item?.userId || "-";
                const personAvatar = item?.profile?.profileImage || null;
                return (
                  <TouchableOpacity
                    style={styles.tieOptionRow}
                    activeOpacity={0.9}
                    onPress={() => {
                      setTopTiePickerVisible(false);
                      setTimeout(() => openTopProfile(item), 120);
                    }}
                  >
                    {personAvatar ? (
                      <Image source={{ uri: personAvatar }} style={styles.tieOptionAvatar} />
                    ) : (
                      <View style={[styles.tieOptionAvatar, styles.avatarFallback]}>
                        <Text style={styles.avatarLetter}>{(personName || "U")[0]}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text numberOfLines={1} style={styles.tieOptionName}>{personName}</Text>
                      <Text style={styles.tieOptionPoints}>{Number(item?.totalPoints || 0)} points</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={MUTED} />
                  </TouchableOpacity>
                );
              }}
            />

            <TouchableOpacity style={styles.closeBtn} onPress={() => setTopTiePickerVisible(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={profileModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileModalVisible(false)}
      >
        <View style={styles.profileModalOverlay}>
          <View style={styles.profileModalCard}>
            {profileLoading ? (
              <ActivityIndicator color={PRIMARY} />
            ) : (
              <>
                <View style={styles.profileHero}>
                  {selectedProfile?.avatar ? (
                    <Image source={{ uri: selectedProfile.avatar }} style={styles.modalAvatar} />
                  ) : (
                    <View style={[styles.modalAvatar, styles.avatarFallback]}>
                      <Text style={styles.avatarLetter}>{(selectedProfile?.name || "U")[0]}</Text>
                    </View>
                  )}

                  <Text style={styles.modalName}>{selectedProfile?.name || "-"}</Text>
                  <View style={styles.modalRankBadge}>
                    <Text style={styles.modalRank}>
                      #{selectedProfile?.rank || "-"} • {selectedProfile?.points || 0} pts
                    </Text>
                  </View>
                </View>

                <View style={styles.infoGrid}>
                  <InfoRow label="Grade" value={selectedProfile?.grade || "-"} styles={styles} />
                  <InfoRow label="Gender" value={selectedProfile?.gender || "-"} styles={styles} />
                  <InfoRow label="School" value={selectedProfile?.school || "-"} styles={styles} />
                  <InfoRow label="Region" value={selectedProfile?.region || "-"} styles={styles} />
                  <InfoRow label="City" value={selectedProfile?.city || "-"} styles={styles} />
                </View>

                <TouchableOpacity style={styles.closeBtn} onPress={() => setProfileModalVisible(false)}>
                  <Text style={styles.closeBtnText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  ), [
    activeFilter,
    expandedOnlineSubjectId,
    MUTED,
    onlineExamSubjects,
    onlinePromoCards,
    practiceExamPackages,
    promoCardIndex,
    promoNowTs,
    onlineExamAttemptState,
    profileLoading,
    profileModalVisible,
    handlePromoScrollEnd,
    renderOnlinePromoCard,
    router,
    selectedProfile,
    studentGrade,
    styles,
    colors,
    subjects,
    topTieCandidates,
    topTiePickerVisible,
    topTieRank,
    topRankGroups,
    upcomingExamModalVisible,
    selectedUpcomingExam,
    heroProfilesOpacity,
    heroProfilesScale,
    heroProfilesTranslateX,
    heroProfilesTranslateY,
    handleTopRankPress,
    openTopProfile,
    handleOnlineExamPress,
    promoCarouselCardWidth,
  ]);

  if (loading) {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={[styles.screen, styles.center]}>
        <ActivityIndicator color={PRIMARY} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <Animated.FlatList
        data={screenData}
        keyExtractor={(item) => item.id}
        renderItem={() => topSection}
        ListHeaderComponent={
          <Animated.View
            style={[
              styles.examTopBar,
              {
                paddingTop: headerVerticalPadding,
                paddingBottom: headerVerticalPadding,
              },
            ]}
          >
            <Animated.View
              pointerEvents="none"
              style={[
                styles.examTopBarSurface,
                {
                  opacity: topBarSurfaceOpacity,
                  transform: [
                    { scaleX: topBarSurfaceScale },
                    { scaleY: topBarSurfaceScale },
                  ],
                },
              ]}
            />

            <View style={styles.examTopBarHeaderRow}>
              <Animated.View
                style={[
                  styles.examTopBarStickyProfilesWrap,
                  {
                    width: stickyProfilesWidth,
                    opacity: stickyProfilesProgress,
                    transform: [
                      { translateX: stickyProfilesTranslateX },
                      { translateY: stickyProfilesTranslateY },
                      { scale: stickyProfilesScale },
                    ],
                  },
                ]}
              >
                <TouchableOpacity
                  activeOpacity={0.88}
                  style={styles.examTopBarStickyProfilesButton}
                  onPress={() => router.push("../leaderboard")}
                >
                  <View style={styles.examTopBarStickyProfilesRow}>
                    <View style={styles.examTopBarStickyAvatarStack}>
                      {stickyTopProfiles.map((person, index) => {
                        const name = person?.profile?.name || person?.profile?.username || person?.userId || "U";
                        const avatar = extractProfileImage(person?.profile || null);

                        return (
                          <View
                            key={`sticky-top-${person?.userId || index}-${index}`}
                            style={[
                              styles.examTopBarStickyAvatarWrap,
                              index > 0 ? { marginLeft: -stickyAvatarOverlap } : null,
                            ]}
                          >
                            {avatar ? (
                              <Image source={{ uri: avatar }} style={styles.examTopBarStickyAvatar} />
                            ) : (
                              <View style={styles.examTopBarStickyAvatarFallback}>
                                <Text style={styles.examTopBarStickyAvatarLetter}>{name[0]}</Text>
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </TouchableOpacity>
              </Animated.View>

              <Animated.View
                style={[
                  styles.examTopBarTextWrap,
                  {
                    opacity: leftTitleOpacity,
                    transform: [{ translateY: leftTitleTranslateY }],
                  },
                ]}
              >
                <Text style={styles.examTopBarTitle}>Exams</Text>
              </Animated.View>

              <Animated.View
                pointerEvents="none"
                style={[
                  styles.examTopBarCenteredTitleWrap,
                  {
                    opacity: centeredTitleOpacity,
                    transform: [
                      { translateY: centeredTitleTranslateY },
                      { scale: centeredTitleScale },
                    ],
                  },
                ]}
              >
                <Text style={styles.examTopBarCenteredTitle}>Exams</Text>
              </Animated.View>
            </View>
          </Animated.View>
        }
        stickyHeaderIndices={[0]}
        contentContainerStyle={{ paddingBottom: scrollBottomPadding }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
      />
    </SafeAreaView>
  );
}

function InfoRow({ label, value, styles }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },

  examTopBar: {
    position: "relative",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: colors.background,
  },
  examTopBarSurface: {
    position: "absolute",
    left: 8,
    right: 8,
    top: 2,
    bottom: 2,
    borderRadius: 18,
    backgroundColor: colors.card,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  examTopBarHeaderRow: {
    position: "relative",
    justifyContent: "center",
    minHeight: 42,
    zIndex: 1,
  },
  examTopBarTextWrap: {
    width: "100%",
    minHeight: 42,
    justifyContent: "center",
    paddingRight: 18,
  },
  examTopBarTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "500",
  },
  examTopBarCenteredTitleWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  examTopBarCenteredTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "500",
  },
  examTopBarStickyProfilesWrap: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    overflow: "hidden",
    justifyContent: "center",
    zIndex: 1,
  },
  examTopBarStickyProfilesButton: {
    alignSelf: "flex-start",
  },
  examTopBarStickyProfilesRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 6,
    paddingVertical: 2,
  },
  examTopBarStickyAvatarStack: {
    flexDirection: "row",
    alignItems: "center",
  },
  examTopBarStickyAvatarWrap: {
    width: STICKY_TOP_AVATAR_SIZE,
    height: STICKY_TOP_AVATAR_SIZE,
    borderRadius: STICKY_TOP_AVATAR_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.background,
    overflow: "hidden",
    backgroundColor: colors.card,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  examTopBarStickyAvatar: {
    width: "100%",
    height: "100%",
    borderRadius: STICKY_TOP_AVATAR_SIZE / 2,
  },
  examTopBarStickyAvatarFallback: {
    width: "100%",
    height: "100%",
    borderRadius: STICKY_TOP_AVATAR_SIZE / 2,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
  },
  examTopBarStickyAvatarLetter: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
  },

  storyListMotionWrap: {
    zIndex: 2,
  },

  topFiltersWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 6,
    gap: 4,
  },
  topFilterBtn: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  topFilterBtnActive: {
    backgroundColor: colors.soft,
    borderColor: colors.primary,
  },
  topFilterText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
    flexShrink: 1,
  },
  topFilterTextActive: {
    color: PRIMARY,
  },

  heroBlock: {
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 6,
    padding: 16,
    borderRadius: 20,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.soft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroBadgeText: {
    marginLeft: 6,
    color: PRIMARY,
    fontSize: 12,
    fontWeight: "800",
  },
  heroTitle: {
    marginTop: 12,
    fontSize: 22,
    fontWeight: "900",
    color: colors.text,
  },
  heroText: {
    marginTop: 6,
    color: colors.muted,
    lineHeight: 20,
    fontSize: 13,
  },

  sectionHeader: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 8 },
  sectionHeaderRow: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  sectionTitle: { fontSize: 18, fontWeight: "900", color: colors.text },
  sectionSubtitle: { marginTop: 2, fontSize: 12, color: colors.muted },

  sectionActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  sectionActionBtnText: {
    color: PRIMARY,
    marginLeft: 6,
    fontWeight: "700",
    fontSize: 12,
  },

  storyListWrap: {
    position: "relative",
    minHeight: STORY_AVATAR_SIZE + 44,
  },
  storyNextBtn: {
    position: "absolute",
    right: 14,
    top: 16,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    zIndex: 1,
  },

  storyWrap: { width: STORY_AVATAR_SIZE + 12, alignItems: "center" },
  rankFrame: {
    width: STORY_AVATAR_SIZE + 10,
    height: STORY_AVATAR_SIZE + 10,
    borderRadius: (STORY_AVATAR_SIZE + 10) / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.inputBackground,
    position: "relative",
    overflow: "visible",
  },
  rankFrameGold: {
    backgroundColor: colors.background === "#fff" ? "#FFF7DF" : colors.warningSurface,
    borderWidth: 1,
    borderColor: colors.background === "#fff" ? "#F3D27A" : colors.warningBorder,
  },
  rankFrameSilver: {
    backgroundColor: colors.background === "#fff" ? "#F4F6FA" : colors.elevatedSurface,
    borderWidth: 1,
    borderColor: colors.background === "#fff" ? "#CBD3DD" : colors.border,
  },
  rankFrameBronze: {
    backgroundColor: colors.background === "#fff" ? "#FFF3EA" : colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.background === "#fff" ? "#E0AE7E" : colors.warningBorder,
  },
  avatarShadow: {
    width: STORY_AVATAR_SIZE,
    height: STORY_AVATAR_SIZE,
    borderRadius: STORY_AVATAR_SIZE / 2,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  rankGlowGold: { shadowColor: GOLD, shadowOpacity: 0.5, shadowRadius: 12, elevation: 7 },
  rankGlowSilver: { shadowColor: "#94A3B8", shadowOpacity: 0.35, shadowRadius: 11, elevation: 6 },
  rankGlowBronze: { shadowColor: BRONZE, shadowOpacity: 0.35, shadowRadius: 11, elevation: 6 },
  avatar: { width: STORY_AVATAR_SIZE, height: STORY_AVATAR_SIZE, borderRadius: STORY_AVATAR_SIZE / 2 },
  avatarFallback: {
    width: STORY_AVATAR_SIZE,
    height: STORY_AVATAR_SIZE,
    borderRadius: STORY_AVATAR_SIZE / 2,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: { color: "#fff", fontWeight: "900", fontSize: 20 },
  trophyBadge: {
    position: "absolute",
    top: -1,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  rankBottomBadge: {
    position: "absolute",
    bottom: -5,
    alignSelf: "center",
    minWidth: 28,
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 9,
    borderWidth: 1.2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  rankBadgeDefault: { backgroundColor: colors.background === "#fff" ? "#DCE7FF" : colors.infoSurface },
  rankBadgeGold: { backgroundColor: "#F2C94C" },
  rankBadgeSilver: { backgroundColor: "#C0C6CC" },
  rankBadgeBronze: { backgroundColor: "#D08A3A" },
  rankBottomBadgeText: { color: "#fff", fontWeight: "900", fontSize: 10 },
  storyName: { marginTop: 8, width: STORY_AVATAR_SIZE + 8, textAlign: "center", fontSize: 11, color: colors.text },
  storyTieStackWrap: {
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  storyTieAvatarWrap: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  storyTieAvatar: {
    width: "100%",
    height: "100%",
    borderRadius: 9,
  },
  storyTieFallback: {
    width: "100%",
    height: "100%",
    borderRadius: 9,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
  },
  storyTieLetter: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 9,
  },
  storyTieText: {
    marginLeft: 5,
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
  },

  challengeCard: {
    width: CARD_W,
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  challengeTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  challengeIconImage: {
    width: 58,
    height: 58,
    borderRadius: 14,
    backgroundColor: colors.inputBackground,
  },
  challengeIconFallback: {
    width: 58,
    height: 58,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.soft,
  },
  challengePill: {
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginLeft: 10,
    flexShrink: 1,
  },
  challengePillText: {
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "800",
  },
  challengeTitle: {
    marginTop: 14,
    fontSize: 17,
    fontWeight: "900",
    color: colors.text,
  },
  challengeDesc: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  challengeFooter: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  challengeMetaBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.soft,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  challengeMetaText: {
    marginLeft: 6,
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "800",
  },
  practiceListWrap: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  practiceListCard: {
    width: "100%",
    marginBottom: 12,
    borderRadius: 22,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    shadowColor: "#1D4ED8",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 4,
    overflow: "hidden",
  },
  practiceCardAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: "#0B72FF",
  },
  practiceTopRow: {
    paddingLeft: 4,
  },
  practiceIconImage: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  practiceIconFallback: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  practicePill: {
    backgroundColor: colors.soft,
    borderColor: colors.border,
  },
  practicePillText: {
    letterSpacing: 0.2,
  },
  practiceTitle: {
    marginTop: 12,
    paddingLeft: 4,
  },
  practiceDesc: {
    paddingLeft: 4,
  },
  practiceFooter: {
    paddingLeft: 4,
    marginTop: 12,
  },
  practiceMetaBadge: {
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  practiceMetaText: {
    fontWeight: "900",
  },
  practiceArrowCapsule: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
  },

  onlineListWrap: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  onlinePromoSection: {
    marginTop: 4,
    marginBottom: 14,
  },
  onlinePromoContent: {
    paddingHorizontal: 16,
    paddingRight: 16,
  },
  onlinePromoSingleWrap: {
    paddingHorizontal: 16,
  },
  promoDotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  promoDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  promoDotActive: {
    width: 22,
    backgroundColor: colors.primary,
  },
  promoCard: {
    minHeight: 184,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 4,
  },
  promoAccentBar: {
    position: "absolute",
    left: 0,
    top: 12,
    bottom: 12,
    width: 4,
    borderRadius: 999,
  },
  promoGlowOrb: {
    position: "absolute",
    right: -28,
    top: -28,
    width: 116,
    height: 116,
    borderRadius: 58,
    opacity: 0.85,
  },
  promoCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 7,
  },
  promoBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    gap: 5,
  },
  promoBadgeText: {
    fontSize: 10,
    fontWeight: "800",
  },
  promoStampText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.muted,
    marginLeft: 10,
    flexShrink: 1,
    textAlign: "right",
  },
  promoTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
    paddingRight: 24,
  },
  promoSubtitle: {
    marginTop: 3,
    color: colors.text,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "700",
    paddingRight: 24,
  },
  promoCountdownRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 6,
  },
  promoCountdownBlock: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  promoCountdownValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  promoCountdownLabel: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  promoBody: {
    marginTop: 5,
    color: colors.muted,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "600",
  },
  promoFooter: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  promoFooterText: {
    flex: 1,
    color: colors.text,
    fontSize: 10,
    fontWeight: "800",
  },
  onlineListItemWrap: {
    marginBottom: 16,
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
  onlineListItem: {
    paddingHorizontal: 16,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  onlineListItemExpanded: {
    backgroundColor: colors.inputBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  onlineListLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 10,
  },
  onlineListIconImage: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.inputBackground,
  },
  onlineListIconFallback: {
    width: 56,
    height: 74,
    borderRadius: 14,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  onlineListTextWrap: {
    marginLeft: 12,
    flex: 1,
  },
  practiceListTextWrap: {
    marginLeft: 12,
    flex: 1,
    justifyContent: "center",
    paddingRight: 2,
  },
  onlineListTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  practiceListTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
  },
  onlineListMetaChip: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  practiceListMetaChip: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  onlineListMeta: {
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "700",
  },
  practiceListMeta: {
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  onlineListChevronWrap: {
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
  onlineListCountBadge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EF4444",
    marginLeft: 10,
  },
  onlineListCountText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
  },
  onlineExamDropWrap: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: colors.panel,
  },
  onlineExamDropItem: {
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
  onlineExamDropItemDisabled: {
    opacity: 0.55,
  },
  onlineExamDropItemUpcoming: {
    borderColor: colors.primary,
    backgroundColor: colors.soft,
  },
  onlineExamDropItemLive: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  onlineExamDropItemPending: {
    borderColor: colors.infoBorder,
    backgroundColor: colors.infoSurface,
  },
  onlineExamDropItemScored: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  onlineExamDropItemFailed: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  onlineExamDropItemExpired: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    opacity: 0.7,
  },
  onlineExamDropMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginRight: 10,
  },
  onlineExamOrderBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 10,
  },
  onlineExamOrderText: {
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "900",
  },
  onlineExamDropTextWrap: {
    flex: 1,
    marginRight: 10,
  },
  onlineExamDropTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  onlineExamDropMeta: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
  },
  onlineExamDropMetaUpcoming: {
    color: PRIMARY,
    fontWeight: "800",
  },
  onlineExamDropMetaLive: {
    color: colors.warningText,
    fontWeight: "800",
  },
  onlineExamDropMetaPending: {
    color: colors.primary,
    fontWeight: "800",
  },
  onlineExamDropMetaScored: {
    color: colors.success,
    fontWeight: "800",
  },
  onlineExamDropMetaFailed: {
    color: colors.danger,
    fontWeight: "800",
  },
  onlineExamDropMetaExpired: {
    color: colors.muted,
    fontWeight: "800",
  },
  onlineExamStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
  },
  onlineExamStatusPillUpcoming: {
    borderColor: colors.infoBorder,
    backgroundColor: colors.infoSurface,
  },
  onlineExamStatusPillLive: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  onlineExamStatusPillPending: {
    borderColor: colors.infoBorder,
    backgroundColor: colors.infoSurface,
  },
  onlineExamStatusPillScored: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  onlineExamStatusPillFail: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  onlineExamStatusPillExpired: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  onlineExamStatusPillUnavailable: {
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
  },
  onlineExamStatusText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
    color: colors.muted,
  },
  onlineExamStatusTextUpcoming: {
    color: colors.primary,
  },
  onlineExamStatusTextLive: {
    color: colors.warningText,
  },
  onlineExamStatusTextPending: {
    color: colors.primary,
  },
  onlineExamStatusTextScored: {
    color: colors.success,
  },
  onlineExamStatusTextFail: {
    color: colors.danger,
  },
  onlineExamStatusTextExpired: {
    color: colors.muted,
  },
  onlineExamStatusTextUnavailable: {
    color: colors.muted,
  },
  onlineExamDropEmptyRow: {
    paddingVertical: 10,
  },
  onlineExamDropEmptyText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },

  competitiveCard: {
    width: CARD_W,
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.025,
    shadowRadius: 10,
    elevation: 1,
  },
  competitiveCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  competitiveIconImage: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.inputBackground,
  },
  competitiveIconFallback: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.soft,
  },
  competitiveChevronWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  competitiveTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: "900",
    color: colors.text,
  },
  competitiveDesc: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  competitiveMetaRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  competitiveMetaPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.soft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  competitiveMetaText: {
    marginLeft: 6,
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "800",
  },

  emptyAssessments: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  emptyAssessmentsText: { color: colors.muted, fontSize: 13, fontWeight: "600" },

  schoolListWrap: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  schoolBookCard: {
    backgroundColor: colors.card,
    borderRadius: 22,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.025,
    shadowRadius: 10,
    elevation: 1,
  },
  schoolBookHeader: {
    paddingHorizontal: 16,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  schoolBookHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  schoolBookIconWrap: {
    width: 56,
    height: 74,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  schoolBookTextWrap: {
    marginLeft: 12,
    flex: 1,
  },
  schoolBookTitle: {
    fontWeight: "900",
    fontSize: 17,
    color: colors.text,
  },
  schoolBookSub: {
    color: colors.muted,
    marginTop: 4,
    fontSize: 12,
    fontWeight: "700",
  },
  schoolBookMetaRow: {
    flexDirection: "row",
    marginTop: 6,
    flexWrap: "wrap",
  },
  schoolBookMetaChip: {
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
  schoolBookCountBadge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EF4444",
    marginLeft: 10,
  },
  schoolBookCountText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
  },

  profileModalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  profileModalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileHero: {
    alignItems: "center",
    paddingBottom: 6,
  },
  modalAvatar: { width: 78, height: 78, borderRadius: 39 },
  modalName: {
    marginTop: 12,
    fontWeight: "900",
    color: colors.text,
    fontSize: 19,
    textAlign: "center",
  },
  modalRankBadge: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalRank: { color: PRIMARY, fontWeight: "800", fontSize: 12 },
  infoGrid: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    overflow: "hidden",
  },
  infoRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  infoValue: { color: colors.text, fontSize: 12, fontWeight: "800", flexShrink: 1, textAlign: "right" },
  tieModalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  tieModalSubtitle: {
    marginTop: 6,
    marginBottom: 12,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  tieOptionRow: {
    width: "100%",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
  },
  tieOptionAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  tieOptionName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  tieOptionPoints: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  upcomingExamModalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  upcomingExamModalGlow: {
    position: "absolute",
    top: -28,
    right: -26,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(11,114,255,0.10)",
  },
  upcomingExamModalBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  upcomingExamModalBadgeText: {
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "800",
  },
  upcomingExamModalTitle: {
    marginTop: 14,
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  upcomingExamModalSubtitleText: {
    marginTop: 5,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  upcomingExamModalInfoRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  upcomingExamModalInfoText: {
    marginLeft: 6,
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "800",
  },
  upcomingExamModalCountdownRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 8,
  },
  upcomingExamModalCountdownBlock: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 9,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  upcomingExamModalCountdownValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  upcomingExamModalCountdownLabel: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  upcomingExamModalNote: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  upcomingExamModalNoteText: {
    flex: 1,
    marginLeft: 8,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  closeBtn: {
    marginTop: 12,
    width: "100%",
    alignSelf: "stretch",
    height: 42,
    borderRadius: 12,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});
}