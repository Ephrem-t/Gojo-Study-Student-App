import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get, set, remove } from "../lib/offlineDatabase";
import { database } from "../constants/firebaseConfig";
import { useAppTheme } from "../hooks/use-app-theme";
import { resolveSchoolKeyFromStudentId } from "./lib/dbHelpers";
import PageLoadingSkeleton from "../components/ui/page-loading-skeleton";

const PRIMARY = "#0B72FF";
const SUBJECT_ICON_MAP = [
  { keys: ["english", "literature"], icon: "book-open-page-variant", color: "#6C5CE7", bg: "#F3F0FF", darkBg: "#241738" },
  { keys: ["math", "mathematics", "algebra", "geometry", "maths"], icon: "calculator-variant", color: "#00A8FF", bg: "#EEF8FF", darkBg: "#10203A" },
  { keys: ["science", "general science", "biology", "chemistry", "physics"], icon: "flask", color: "#00B894", bg: "#ECFFF8", darkBg: "#10261F" },
  { keys: ["history", "social"], icon: "history", color: "#F39C12", bg: "#FFF8EC", darkBg: "#2B1A0B" },
  { keys: ["geography"], icon: "map", color: "#0984E3", bg: "#EEF6FF", darkBg: "#10203A" },
  { keys: ["computer", "ict", "computing"], icon: "laptop", color: "#8E44AD", bg: "#F7F0FF", darkBg: "#241738" },
  { keys: ["art"], icon: "palette", color: "#FF7675", bg: "#FFF2F2", darkBg: "#33181C" },
];
const TOPIC_UNDERSTANDING_OPTIONS = [
  {
    key: "excellent",
    label: "Excellent",
    subtitle: "I understood this topic very well.",
    icon: "sparkles-outline",
    tint: "#0284C7",
    bg: "#F0F9FF",
    darkBg: "#10203A",
  },
  {
    key: "good",
    label: "Good",
    subtitle: "Learned well, need a little practice.",
    icon: "thumbs-up-outline",
    tint: "#059669",
    bg: "#ECFDF5",
    darkBg: "#10261F",
  },
  {
    key: "dont_understand",
    label: "I don't understand",
    subtitle: "I need this topic explained again.",
    icon: "help-circle-outline",
    tint: "#D97706",
    bg: "#FFFBEB",
    darkBg: "#2B1A0B",
  },
  {
    key: "not_learned",
    label: "Not learned",
    subtitle: "Submitted, but not taught in class.",
    icon: "alert-circle-outline",
    tint: "#DC2626",
    bg: "#FEF2F2",
    darkBg: "#33181C",
  },
];
const VALID_TOPIC_UNDERSTANDING_LEVELS = new Set(
  TOPIC_UNDERSTANDING_OPTIONS.map((item) => item.key)
);

function resolveAdaptiveSurface(lightBg, darkBg, colors) {
  if (!colors || colors.background === "#fff") return lightBg;
  return darkBg || colors.elevatedSurface || lightBg;
}

function normalizeTopicUnderstandingLevel(value = "") {
  const normalized = String(value || "").trim();
  return VALID_TOPIC_UNDERSTANDING_LEVELS.has(normalized) ? normalized : "";
}

function normalizeTeacherRatingValue(value = 0) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.min(5, Math.round(numericValue)));
}

function normalizeGrade(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  const matched = normalized.match(/(\d{1,2})/);
  if (matched) return String(matched[1]);
  return normalized.replace(/^grade\s*/i, "");
}

function normalizeSection(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function normalizeToken(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeCompactToken(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeSubjectKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function normalizeSemesterKey(value = "") {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (!raw) return null;

  const matched = raw.match(/^semester(\d+)$/) || raw.match(/^sem(\d+)$/);
  if (matched?.[1]) return `semester${matched[1]}`;
  if (/^\d+$/.test(raw)) return `semester${raw}`;
  return raw;
}

function normalizeQuarterKey(value = "") {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (!raw) return null;

  const matched = raw.match(/^quarter(\d+)$/) || raw.match(/^q(\d+)$/);
  if (matched?.[1]) return `q${matched[1]}`;
  return raw;
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

function parseDateKey(dateKey) {
  const matched = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;

  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
}

function toMsTimestamp(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

function getTopicTimestamp(dateKey, createdAt) {
  const fromCreatedAt = toMsTimestamp(createdAt);
  if (fromCreatedAt) return fromCreatedAt;

  const parsed = parseDateKey(dateKey);
  return parsed ? parsed.getTime() : 0;
}

function formatTopicDate(dateKey, createdAt) {
  const parsed = parseDateKey(dateKey);
  const date = parsed || (toMsTimestamp(createdAt) ? new Date(toMsTimestamp(createdAt)) : null);
  if (!date || Number.isNaN(date.getTime())) return "--";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatTopicDay(dateKey, dayName, createdAt) {
  if (dayName) return String(dayName).slice(0, 3);
  const parsed = parseDateKey(dateKey);
  const date = parsed || (toMsTimestamp(createdAt) ? new Date(toMsTimestamp(createdAt)) : null);
  if (!date || Number.isNaN(date.getTime())) return "Day";

  return date.toLocaleDateString(undefined, { weekday: "short" });
}

function formatSemesterLabel(value) {
  const normalized = normalizeSemesterKey(value);
  if (!normalized) return "Semester";

  const matched = normalized.match(/semester(\d+)/i);
  if (matched?.[1]) return `Semester ${matched[1]}`;

  return normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatQuarterLabel(value) {
  const normalized = normalizeQuarterKey(value);
  if (!normalized) return "Quarter";

  const matched = normalized.match(/^q(\d+)$/i);
  if (matched?.[1]) return `Quarter ${matched[1]}`;

  return normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function sortSemesterKeys(values = []) {
  return [...values].sort((left, right) => {
    const leftNumber = Number(normalizeSemesterKey(left)?.match(/semester(\d+)/i)?.[1] || 999);
    const rightNumber = Number(normalizeSemesterKey(right)?.match(/semester(\d+)/i)?.[1] || 999);
    return leftNumber - rightNumber || String(left).localeCompare(String(right));
  });
}

function sortQuarterKeys(values = []) {
  return [...values].sort((left, right) => {
    const leftNumber = Number(normalizeQuarterKey(left)?.match(/^q(\d+)$/i)?.[1] || 999);
    const rightNumber = Number(normalizeQuarterKey(right)?.match(/^q(\d+)$/i)?.[1] || 999);
    return leftNumber - rightNumber || String(left).localeCompare(String(right));
  });
}

function extractTopicQuarterKey(row = {}, weekKey = "") {
  return normalizeQuarterKey(
    row?.quarter ||
      row?.quarterKey ||
      row?.termQuarter ||
      row?.term ||
      (/^q\d+/i.test(String(weekKey || "")) ? weekKey : "")
  );
}

function detectTemplateMode(templateSubjectNode) {
  if (!templateSubjectNode || typeof templateSubjectNode !== "object") return null;

  let foundQuarter = false;
  let foundSemester = false;

  Object.keys(templateSubjectNode).forEach((semesterKey) => {
    const semesterNode = templateSubjectNode?.[semesterKey] || {};
    if (!semesterNode || typeof semesterNode !== "object") return;

    const quarterKeys = Object.keys(semesterNode).filter((key) => /^q\d+/i.test(key));
    if (quarterKeys.length > 0) foundQuarter = true;
    if (semesterNode.assessments || semesterNode.assessment) foundSemester = true;

    if (!foundQuarter && !foundSemester) {
      quarterKeys.forEach((quarterKey) => {
        const quarterNode = semesterNode?.[quarterKey] || {};
        if (String(quarterNode?.mode || "").toLowerCase() === "quarter") {
          foundQuarter = true;
        }
      });
    }
  });

  if (foundQuarter) return "quarter";
  if (foundSemester) return "semester";
  return null;
}

function resolveTemplateSubjectNode(gradeTemplates, ...values) {
  if (!gradeTemplates || typeof gradeTemplates !== "object") return null;

  const rawValues = Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  const candidates = Array.from(
    new Set(
      rawValues.flatMap((raw) => [
        raw,
        raw.toLowerCase(),
        raw.toUpperCase(),
        normalizeSubjectKey(raw),
        raw.replace(/\s+/g, ""),
        raw.toLowerCase().replace(/\s+/g, ""),
      ])
    )
  );

  for (const candidate of candidates) {
    if (gradeTemplates?.[candidate]) return gradeTemplates[candidate];
  }

  const matchedKey = Object.keys(gradeTemplates).find((key) => {
    const normalizedKey = normalizeSubjectKey(key);
    const compactKey = normalizeCompactToken(key);

    return rawValues.some(
      (raw) =>
        normalizedKey === normalizeSubjectKey(raw) ||
        compactKey === normalizeCompactToken(raw)
    );
  });

  return matchedKey ? gradeTemplates[matchedKey] : null;
}

function buildTemplateTermConfig(templateSubjectNode) {
  if (!templateSubjectNode || typeof templateSubjectNode !== "object") {
    return {
      semesterOptions: [],
      quarterOptionsBySemester: {},
    };
  }

  const semesterOptions = [];
  const quarterOptionsBySemester = {};

  sortSemesterKeys(Object.keys(templateSubjectNode)).forEach((semesterKey) => {
    const normalizedSemester = normalizeSemesterKey(semesterKey);
    if (!normalizedSemester) return;

    if (!semesterOptions.includes(normalizedSemester)) {
      semesterOptions.push(normalizedSemester);
    }

    const semesterNode = templateSubjectNode?.[semesterKey] || {};
    const quarterKeys = sortQuarterKeys(
      Object.keys(semesterNode)
        .map((key) => normalizeQuarterKey(key))
        .filter((key) => !!key && /^q\d+/i.test(key))
    );

    if (quarterKeys.length) {
      quarterOptionsBySemester[normalizedSemester] = quarterKeys;
    }
  });

  return {
    semesterOptions,
    quarterOptionsBySemester,
  };
}

function getSubjectVisual(subjectName = "", colors) {
  const lower = String(subjectName).toLowerCase();
  const matched = SUBJECT_ICON_MAP.find((item) =>
    item.keys.some((key) => lower.includes(key))
  );

  const visual = matched || {
    icon: "book-education-outline",
    color: PRIMARY,
    bg: "#EEF4FF",
    darkBg: "#10203A",
  };

  return {
    ...visual,
    bg: resolveAdaptiveSurface(visual.bg, visual.darkBg, colors),
  };
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

function extractSubmittedTopics(dailyNode, submissionNode) {
  const collected = [];
  const seen = new Set();

  Object.keys(dailyNode || {}).forEach((semesterKey) => {
    const semesterLogs = dailyNode?.[semesterKey] || {};
    const semesterSubmissions = submissionNode?.[semesterKey] || {};

    Object.keys(semesterLogs).forEach((monthKey) => {
      const monthLogs = semesterLogs?.[monthKey] || {};
      const monthSubmissions = semesterSubmissions?.[monthKey] || {};

      Object.keys(monthLogs).forEach((weekKey) => {
        const weekLogs = monthLogs?.[weekKey] || {};
        const weekSubmissions = monthSubmissions?.[weekKey] || {};
        const submittedDays = weekSubmissions?.submittedDays || {};

        Object.keys(weekLogs).forEach((dateKey) => {
          if (!submittedDays?.[dateKey]) return;

          const row = weekLogs?.[dateKey] || {};
          const topic = String(row?.topic || "").trim();
          if (!topic) return;

          const uniqueKey = `${semesterKey}-${monthKey}-${weekKey}-${dateKey}-${topic}`;
          if (seen.has(uniqueKey)) return;
          seen.add(uniqueKey);

          collected.push({
            id: uniqueKey,
            topic,
            dateKey,
            dayName: row?.dayName || "",
            semesterKey,
            normalizedSemesterKey: normalizeSemesterKey(semesterKey),
            normalizedQuarterKey: extractTopicQuarterKey(row, weekKey),
            monthKey,
            weekKey,
            createdAt: toMsTimestamp(row?.createdAt || 0),
            timestamp: getTopicTimestamp(dateKey, row?.createdAt || 0),
          });
        });
      });
    });
  });

  return collected.sort((left, right) => right.timestamp - left.timestamp);
}

function normalizePlanSlotKey(semesterKey = "", monthKey = "", weekKey = "") {
  const normalizedSemester = normalizeSemesterKey(semesterKey) || normalizeCompactToken(semesterKey);
  const normalizedMonth = normalizeCompactToken(monthKey);
  const normalizedWeek = normalizeCompactToken(weekKey);

  if (!normalizedSemester || !normalizedMonth || !normalizedWeek) return null;
  return `${normalizedSemester}__${normalizedMonth}__${normalizedWeek}`;
}

function hasAnnualPlanWeekContent(row = {}) {
  return ["topic", "objective", "method", "material", "assessment"].some((key) =>
    String(row?.[key] || "").trim()
  );
}

function extractAnnualPlanWeeks(planNode) {
  const collected = [];
  const seen = new Set();

  Object.keys(planNode || {}).forEach((semesterKey) => {
    const semesterNode = planNode?.[semesterKey] || {};
    const monthsNode =
      semesterNode?.months && typeof semesterNode.months === "object"
        ? semesterNode.months
        : semesterNode;

    Object.keys(monthsNode || {}).forEach((monthKey) => {
      const monthNode = monthsNode?.[monthKey] || {};
      const weeksNode =
        monthNode?.weeks && typeof monthNode.weeks === "object"
          ? monthNode.weeks
          : monthNode;

      Object.keys(weeksNode || {}).forEach((weekKey) => {
        const row = weeksNode?.[weekKey] || {};
        if (!row || typeof row !== "object" || !hasAnnualPlanWeekContent(row)) return;

        const slotKey = normalizePlanSlotKey(semesterKey, monthKey, weekKey);
        if (!slotKey || seen.has(slotKey)) return;
        seen.add(slotKey);

        collected.push({
          slotKey,
          normalizedSemesterKey: normalizeSemesterKey(semesterKey),
          monthKey,
          weekKey,
        });
      });
    });
  });

  return collected;
}

function buildTopicFeedbackKey(courseId = "", topic = {}) {
  const raw = [
    courseId,
    normalizeSemesterKey(topic?.normalizedSemesterKey || topic?.semesterKey || "") || topic?.semesterKey || "",
    topic?.monthKey || "",
    topic?.weekKey || "",
    topic?.dateKey || "",
    String(topic?.topic || "").trim(),
  ]
    .map((value) => String(value || "").trim())
    .join("__");

  return encodeURIComponent(raw);
}

function decodeStudentWhatLearnKey(value = "") {
  const raw = String(value || "");

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function inferCourseIdFromFeedbackKey(feedbackKey = "") {
  const decoded = decodeStudentWhatLearnKey(feedbackKey);
  const separatorIndex = decoded.indexOf("__");
  return separatorIndex > 0 ? decoded.slice(0, separatorIndex) : "";
}

function isStudentWhatLearnEntry(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  return ["courseId", "teacherId", "understandingLevel", "teacherRating", "createdAt", "updatedAt"].some(
    (key) => Object.prototype.hasOwnProperty.call(value, key)
  );
}

function normalizeStudentWhatLearnEntry(entry = {}, feedbackKey = "", fallbackCourseId = "") {
  if (!isStudentWhatLearnEntry(entry)) return null;

  const fallbackTimestamp = Date.now();
  const createdAt = toMsTimestamp(entry?.createdAt || entry?.updatedAt || 0);
  const updatedAt = toMsTimestamp(entry?.updatedAt || entry?.createdAt || 0);

  return {
    courseId:
      String(entry?.courseId || fallbackCourseId || inferCourseIdFromFeedbackKey(feedbackKey)).trim() || "",
    teacherId: String(entry?.teacherId || "").trim(),
    understandingLevel: normalizeTopicUnderstandingLevel(entry?.understandingLevel),
    teacherRating: normalizeTeacherRatingValue(entry?.teacherRating),
    createdAt: createdAt || updatedAt || fallbackTimestamp,
    updatedAt: updatedAt || createdAt || fallbackTimestamp,
  };
}

function enrichStudentWhatLearnTeacherIds(feedbackMap = {}, subjects = []) {
  const nextFeedbackMap = {};
  const courseTeacherIds = {};
  const topicTeacherIds = {};
  let changed = false;

  subjects.forEach((subject) => {
    const subjectTeacherId = String(subject?.teacherId || "").trim();
    if (subject?.courseId && subjectTeacherId) {
      courseTeacherIds[subject.courseId] = subjectTeacherId;
    }

    (subject?.topics || []).forEach((topic) => {
      const topicTeacherId = String(topic?.teacherId || subjectTeacherId || "").trim();
      if (topic?.feedbackKey && topicTeacherId) {
        topicTeacherIds[topic.feedbackKey] = topicTeacherId;
      }
    });
  });

  Object.keys(feedbackMap || {}).forEach((feedbackKey) => {
    const entry = normalizeStudentWhatLearnEntry(feedbackMap?.[feedbackKey], feedbackKey);
    if (!entry) return;

    const teacherId =
      String(entry?.teacherId || topicTeacherIds?.[feedbackKey] || courseTeacherIds?.[entry?.courseId] || "").trim();

    if (teacherId !== String(entry?.teacherId || "").trim()) {
      changed = true;
    }

    nextFeedbackMap[feedbackKey] = {
      ...entry,
      teacherId,
    };
  });

  return {
    feedbackMap: nextFeedbackMap,
    changed,
  };
}

function mergeStudentWhatLearnEntry(target = {}, feedbackKey = "", nextEntry = null, fallbackCourseId = "") {
  const normalizedNextEntry = normalizeStudentWhatLearnEntry(nextEntry, feedbackKey, fallbackCourseId);
  if (!normalizedNextEntry) return target;

  const currentEntry = target?.[feedbackKey];
  if (!currentEntry) {
    target[feedbackKey] = normalizedNextEntry;
    return target;
  }

  const currentUpdatedAt = toMsTimestamp(currentEntry?.updatedAt || currentEntry?.createdAt || 0);
  const nextUpdatedAt = toMsTimestamp(normalizedNextEntry?.updatedAt || normalizedNextEntry?.createdAt || 0);

  if (nextUpdatedAt >= currentUpdatedAt) {
    target[feedbackKey] = normalizedNextEntry;
  }

  return target;
}

function flattenStudentWhatLearnNode(node = {}) {
  const flattened = {};

  Object.keys(node || {}).forEach((topLevelKey) => {
    const topLevelValue = node?.[topLevelKey];
    if (!topLevelValue || typeof topLevelValue !== "object" || Array.isArray(topLevelValue)) return;

    if (isStudentWhatLearnEntry(topLevelValue)) {
      mergeStudentWhatLearnEntry(flattened, topLevelKey, topLevelValue);
      return;
    }

    Object.keys(topLevelValue || {}).forEach((feedbackKey) => {
      mergeStudentWhatLearnEntry(flattened, feedbackKey, topLevelValue?.[feedbackKey], topLevelKey);
    });
  });

  return flattened;
}

function buildStudentWhatLearnPath(schoolKey = "", studentId = "", feedbackKey = "") {
  const basePath = `Platform1/Schools/${schoolKey}/LessonPlans/StudentWhatLearn/${studentId}`;
  if (!feedbackKey) return basePath;
  return `${basePath}/${feedbackKey}`;
}

function buildLegacyStudentWhatLearnPath(schoolKey = "", studentId = "") {
  return `Platform1/Schools/${schoolKey}/StudentWhatLearn/${studentId}`;
}

function mergeStudentWhatLearnNodes(...nodes) {
  return nodes.reduce((merged, node) => {
    const flattenedNode = flattenStudentWhatLearnNode(node);

    Object.keys(flattenedNode).forEach((feedbackKey) => {
      mergeStudentWhatLearnEntry(merged, feedbackKey, flattenedNode?.[feedbackKey]);
    });

    return merged;
  }, {});
}

function serializeStudentWhatLearnNode(node = {}) {
  const flattenedNode = flattenStudentWhatLearnNode(node);
  const stableNode = {};

  Object.keys(flattenedNode)
    .sort()
    .forEach((feedbackKey) => {
      stableNode[feedbackKey] = flattenedNode[feedbackKey];
    });

  return JSON.stringify(stableNode);
}

function getUnderstandingOptions(colors) {
  return TOPIC_UNDERSTANDING_OPTIONS.map((item) => ({
    ...item,
    bg: resolveAdaptiveSurface(item.bg, item.darkBg, colors),
  }));
}

function getUnderstandingOption(value = "", colors) {
  return getUnderstandingOptions(colors).find((item) => item.key === value) || null;
}

function getTeacherRatingLabel(value = 0) {
  const rating = Number(value || 0);
  if (rating >= 5) return "Outstanding";
  if (rating >= 4) return "Strong";
  if (rating >= 3) return "Solid";
  if (rating >= 2) return "Needs work";
  if (rating >= 1) return "Poor";
  return "Not rated yet";
}

function formatFeedbackUpdatedAt(value) {
  const timestamp = toMsTimestamp(value);
  if (!timestamp) return "";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function WhatYouLearnScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [subjects, setSubjects] = useState([]);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [subjectSheetVisible, setSubjectSheetVisible] = useState(false);
  const [selectedSemesterFilter, setSelectedSemesterFilter] = useState("all");
  const [selectedQuarterFilter, setSelectedQuarterFilter] = useState("all");
  const [classMeta, setClassMeta] = useState({
    grade: "",
    section: "",
    schoolName: "",
  });
  const [resolvedSchoolKey, setResolvedSchoolKey] = useState("");
  const [resolvedStudentId, setResolvedStudentId] = useState("");
  const [topicFeedbackMap, setTopicFeedbackMap] = useState({});
  const [topicFeedbackVisible, setTopicFeedbackVisible] = useState(false);
  const [selectedTopicEntry, setSelectedTopicEntry] = useState(null);
  const [selectedUnderstandingLevel, setSelectedUnderstandingLevel] = useState("");
  const [selectedTeacherRating, setSelectedTeacherRating] = useState(0);
  const [savingTopicFeedback, setSavingTopicFeedback] = useState(false);
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const understandingOptions = useMemo(() => getUnderstandingOptions(colors), [colors]);
  const selectedSubjectVisual = useMemo(
    () => (selectedSubject ? getSubjectVisual(selectedSubject.subject, colors) : null),
    [selectedSubject, colors]
  );

  const handleBackNavigation = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/dashboard/profile");
  }, [router]);

  const openSubjectSheet = useCallback((subject) => {
    if (!subject) return;

    setSelectedSubject(subject);
    setSelectedSemesterFilter("all");
    setSelectedQuarterFilter("all");
    setSubjectSheetVisible(true);

    requestAnimationFrame(() => {
      Animated.spring(sheetAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 18,
        stiffness: 140,
        mass: 0.9,
      }).start();
    });
  }, [sheetAnim]);

  const closeSubjectSheet = useCallback(() => {
    Animated.timing(sheetAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setSubjectSheetVisible(false);
        setSelectedSubject(null);
        setSelectedSemesterFilter("all");
        setSelectedQuarterFilter("all");
      }
    });
  }, [sheetAnim]);

  const closeTopicFeedback = useCallback((force = false) => {
    if (savingTopicFeedback && !force) return;

    setTopicFeedbackVisible(false);
    setSelectedTopicEntry(null);
    setSelectedUnderstandingLevel("");
    setSelectedTeacherRating(0);
  }, [savingTopicFeedback]);

  const openTopicFeedback = useCallback((topic, subject) => {
    if (!topic || !subject) return;

    const existingFeedback = topicFeedbackMap?.[topic.feedbackKey] || null;

    setSelectedTopicEntry({
      ...topic,
      courseId: subject.courseId,
      subjectLabel: subject.subject,
      teacherId: topic.teacherId || subject.teacherId || "",
      teacherName: topic.teacherName || subject.teacherName || "",
      visual: subject.visual,
    });
    setSelectedUnderstandingLevel(normalizeTopicUnderstandingLevel(existingFeedback?.understandingLevel));
    setSelectedTeacherRating(normalizeTeacherRatingValue(existingFeedback?.teacherRating));
    setTopicFeedbackVisible(true);
  }, [topicFeedbackMap]);

  const saveTopicFeedback = useCallback(async () => {
    if (!selectedTopicEntry || !resolvedSchoolKey || !resolvedStudentId) {
      Alert.alert("Unavailable", "Student topic feedback cannot be saved right now.");
      return;
    }

    if (!selectedUnderstandingLevel) {
      Alert.alert("Choose evaluation", "Select how well you learned this topic.");
      return;
    }

    const existingFeedback = topicFeedbackMap?.[selectedTopicEntry.feedbackKey] || {};
    const now = Date.now();
    const payload = {
      courseId: selectedTopicEntry.courseId,
      teacherId: String(selectedTopicEntry.teacherId || "").trim(),
      understandingLevel: normalizeTopicUnderstandingLevel(selectedUnderstandingLevel),
      teacherRating: normalizeTeacherRatingValue(selectedTeacherRating),
      createdAt: existingFeedback?.createdAt || now,
      updatedAt: now,
    };

    setSavingTopicFeedback(true);

    try {
      const feedbackPath = buildStudentWhatLearnPath(
        resolvedSchoolKey,
        resolvedStudentId,
        selectedTopicEntry.feedbackKey
      );

      await set(
        ref(database, feedbackPath),
        payload
      );

      setTopicFeedbackMap((prev) => ({
        ...prev,
        [selectedTopicEntry.feedbackKey]: payload,
      }));
      closeTopicFeedback(true);
    } catch (error) {
      console.warn("Topic feedback save error:", error);
      Alert.alert("Save failed", "Could not save your topic evaluation.");
    } finally {
      setSavingTopicFeedback(false);
    }
  }, [
    closeTopicFeedback,
    resolvedSchoolKey,
    resolvedStudentId,
    selectedTeacherRating,
    selectedTopicEntry,
    selectedUnderstandingLevel,
    topicFeedbackMap,
  ]);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);

    try {
      const studentNodeKey = await AsyncStorage.getItem("studentNodeKey");
      const studentId = await AsyncStorage.getItem("studentId");
      const username = await AsyncStorage.getItem("username");
      const candidates = Array.from(new Set([studentNodeKey, studentId, username].filter(Boolean)));

      let schoolKey = await AsyncStorage.getItem("schoolKey");
      if (!schoolKey) {
        for (const candidate of candidates) {
          schoolKey = await resolveSchoolKeyFast(candidate);
          if (schoolKey) break;
        }
      }

      if (!schoolKey) {
        setResolvedSchoolKey("");
        setResolvedStudentId("");
        setTopicFeedbackMap({});
        setSubjects([]);
        setClassMeta({ grade: "", section: "", schoolName: "" });
        return;
      }

      let student = null;
      let resolvedStudentKey = "";
      for (const candidate of candidates) {
        const studentSnap = await get(ref(database, `Platform1/Schools/${schoolKey}/Students/${candidate}`));
        if (studentSnap?.exists()) {
          student = studentSnap.val() || {};
          resolvedStudentKey = String(candidate || "").trim();
          break;
        }
      }

      if (!student) {
        for (const candidate of candidates) {
          const userSnap = await get(ref(database, `Platform1/Schools/${schoolKey}/Users/${candidate}`));
          if (!userSnap?.exists()) continue;

          const userValue = userSnap.val() || {};
          if (!userValue?.studentId) continue;

          const studentSnap = await get(
            ref(database, `Platform1/Schools/${schoolKey}/Students/${userValue.studentId}`)
          );
          if (studentSnap?.exists()) {
            student = studentSnap.val() || {};
            resolvedStudentKey = String(userValue.studentId || "").trim();
            break;
          }
        }
      }

      const effectiveStudentId =
        resolvedStudentKey || String(student?.studentId || "").trim() || String(candidates[0] || "").trim();

      setResolvedSchoolKey(schoolKey);
      setResolvedStudentId(effectiveStudentId);

      let existingTopicFeedback = {};
      if (effectiveStudentId) {
        const feedbackPath = buildStudentWhatLearnPath(schoolKey, effectiveStudentId);
        const legacyFeedbackPath = buildLegacyStudentWhatLearnPath(schoolKey, effectiveStudentId);
        const feedbackSnap = await get(ref(database, feedbackPath));
        const legacyFeedbackSnap = await get(ref(database, legacyFeedbackPath));

        const lessonPlansFeedbackNode = feedbackSnap?.exists() ? feedbackSnap.val() || {} : {};
        const legacyFeedbackNode = legacyFeedbackSnap?.exists() ? legacyFeedbackSnap.val() || {} : {};
        const shouldRemoveLegacyFeedback = legacyFeedbackSnap?.exists();
        const mergedFeedbackNode = mergeStudentWhatLearnNodes(lessonPlansFeedbackNode, legacyFeedbackNode);
        const shouldWriteFeedbackToLessonPlans =
          shouldRemoveLegacyFeedback ||
          serializeStudentWhatLearnNode(lessonPlansFeedbackNode) !== serializeStudentWhatLearnNode(mergedFeedbackNode);

        existingTopicFeedback = mergedFeedbackNode;

        if (shouldWriteFeedbackToLessonPlans) {
          if (Object.keys(mergedFeedbackNode).length) {
            await set(ref(database, feedbackPath), mergedFeedbackNode);
          } else if (feedbackSnap?.exists()) {
            await remove(ref(database, feedbackPath));
          }
        }

        if (shouldRemoveLegacyFeedback) {
          await remove(ref(database, legacyFeedbackPath));
        }
      }
      setTopicFeedbackMap(existingTopicFeedback);

      const gradeValue = normalizeGrade(
        student?.basicStudentInformation?.grade ?? student?.grade ?? ""
      );
      const sectionValue = normalizeSection(
        student?.basicStudentInformation?.section ?? student?.section ?? ""
      );

      const schoolInfoSnap = await get(ref(database, `Platform1/Schools/${schoolKey}/schoolInfo`));
      const schoolInfo = schoolInfoSnap?.exists() ? schoolInfoSnap.val() || {} : {};

      setClassMeta({
        grade: gradeValue || "",
        section: sectionValue || "",
        schoolName: schoolInfo?.name || schoolInfo?.schoolName || schoolKey,
      });

      if (!gradeValue || !sectionValue) {
        setSubjects([]);
        return;
      }

      let gradeTemplates = {};
      const scopedTemplatesSnap = await get(
        ref(database, `Platform1/Schools/${schoolKey}/AssesmentTemplates/${gradeValue}`)
      );
      if (scopedTemplatesSnap?.exists()) gradeTemplates = scopedTemplatesSnap.val() || {};

      if (!Object.keys(gradeTemplates).length) {
        const globalTemplatesSnap = await get(ref(database, `AssesmentTemplates/${gradeValue}`));
        if (globalTemplatesSnap?.exists()) gradeTemplates = globalTemplatesSnap.val() || {};
      }

      const gradeSnap = await get(
        ref(database, `Platform1/Schools/${schoolKey}/GradeManagement/grades/${gradeValue}`)
      );
      if (!gradeSnap?.exists()) {
        setSubjects([]);
        return;
      }

      const gradeNode = gradeSnap.val() || {};
      const sectionNode = gradeNode?.sections?.[sectionValue] || {};
      const sectionCoursesMap = sectionNode?.courses || {};
      const courseIds = Object.keys(sectionCoursesMap).filter((key) => !!sectionCoursesMap[key]);

      const teacherAssignments = gradeNode?.sectionSubjectTeachers?.[sectionValue] || {};
      const gradeSubjects = gradeNode?.subjects || {};
      const assignmentByCourseId = {};

      Object.keys(teacherAssignments).forEach((subjectKey) => {
        const row = teacherAssignments?.[subjectKey] || {};
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

        const byKeyMatch = Object.keys(gradeSubjects).find((key) => {
          const keyToken = normalizeToken(key);
          return keyToken && normalizeToken(courseId).includes(keyToken);
        });

        if (byKeyMatch && String(gradeSubjects?.[byKeyMatch]?.name || "").trim()) {
          return String(gradeSubjects[byKeyMatch].name).trim();
        }

        return prettyLabelFromCourseId(courseId);
      };

      let lessonPlans = {};
      const scopedLessonPlansSnap = await get(ref(database, `Platform1/Schools/${schoolKey}/LessonPlans`));
      if (scopedLessonPlansSnap?.exists()) lessonPlans = scopedLessonPlansSnap.val() || {};

      if (!Object.keys(lessonPlans).length) {
        const globalLessonPlansSnap = await get(ref(database, "LessonPlans"));
        if (globalLessonPlansSnap?.exists()) lessonPlans = globalLessonPlansSnap.val() || {};
      }

      const dailyLogsRoot = lessonPlans?.LessonDailyLogs || {};
      const submissionsRoot = lessonPlans?.LessonSubmissions || {};
      const teacherPlansRoot = lessonPlans?.TeachersLessonPlans || {};

      const nextSubjects = courseIds
        .map((courseId) => {
          const assignment = assignmentByCourseId?.[courseId] || {};
          const subjectName = resolveSubjectName(courseId, assignment);
          const assignmentTeacherName = String(assignment?.teacherName || "").trim();
          const assignmentTeacherId = String(assignment?.teacherId || "").trim();
          const teacherName = assignmentTeacherName || assignmentTeacherId;

          const teacherIds = Array.from(
            new Set(
              [
                assignment?.teacherId,
                ...Object.keys(dailyLogsRoot).filter(
                  (teacherId) => dailyLogsRoot?.[teacherId]?.[courseId] || submissionsRoot?.[teacherId]?.[courseId]
                ),
              ].filter(Boolean)
            )
          );

          const topicMap = new Map();
          teacherIds.forEach((teacherId) => {
            const topicRows = extractSubmittedTopics(
              dailyLogsRoot?.[teacherId]?.[courseId] || {},
              submissionsRoot?.[teacherId]?.[courseId] || {}
            );

            topicRows.forEach((topicRow) => {
              const uniqueKey = `${courseId}-${topicRow.dateKey}-${topicRow.topic}`;
              if (!topicMap.has(uniqueKey)) {
                topicMap.set(uniqueKey, {
                  ...topicRow,
                  teacherId: String(teacherId || assignmentTeacherId || "").trim(),
                  teacherName,
                  feedbackKey: buildTopicFeedbackKey(courseId, topicRow),
                });
              }
            });
          });

          const topics = Array.from(topicMap.values()).sort(
            (left, right) => right.timestamp - left.timestamp
          );
          const annualPlanWeekMap = new Map();

          teacherIds.forEach((teacherId) => {
            const annualPlanWeeks = extractAnnualPlanWeeks(
              teacherPlansRoot?.[teacherId]?.[courseId] || {}
            );

            annualPlanWeeks.forEach((planWeek) => {
              if (!annualPlanWeekMap.has(planWeek.slotKey)) {
                annualPlanWeekMap.set(planWeek.slotKey, planWeek);
              }
            });
          });

          const annualPlanWeeks = Array.from(annualPlanWeekMap.values());
          const coveredPlanSlots = new Set(
            topics
              .map((topic) =>
                normalizePlanSlotKey(
                  topic.normalizedSemesterKey || topic.semesterKey,
                  topic.monthKey,
                  topic.weekKey
                )
              )
              .filter(Boolean)
          );
          const annualPlanCoveredCount = annualPlanWeeks.reduce(
            (sum, planWeek) => sum + (coveredPlanSlots.has(planWeek.slotKey) ? 1 : 0),
            0
          );
          const annualPlanTotalCount = annualPlanWeeks.length;
          const annualPlanCoveragePercent = annualPlanTotalCount
            ? Math.min(100, Math.round((annualPlanCoveredCount / annualPlanTotalCount) * 100))
            : 0;
          const latestTopic = topics[0] || null;
          const visual = getSubjectVisual(subjectName);
          const templateSubjectNode = resolveTemplateSubjectNode(
            gradeTemplates,
            subjectName,
            assignment?.subject,
            assignment?.subjectName,
            gradeSubjects?.[assignment?.subjectKey || ""]?.name,
            assignment?.subjectKey
          );
          const templateMode = detectTemplateMode(templateSubjectNode);
          const templateTermConfig = buildTemplateTermConfig(templateSubjectNode);
          const topicSemesterOptions = sortSemesterKeys(
            Array.from(new Set(topics.map((topic) => topic.normalizedSemesterKey).filter(Boolean)))
          );
          const topicQuarterOptionsBySemester = {};

          topics.forEach((topic) => {
            if (!topic.normalizedSemesterKey || !topic.normalizedQuarterKey) return;
            if (!topicQuarterOptionsBySemester[topic.normalizedSemesterKey]) {
              topicQuarterOptionsBySemester[topic.normalizedSemesterKey] = [];
            }
            if (!topicQuarterOptionsBySemester[topic.normalizedSemesterKey].includes(topic.normalizedQuarterKey)) {
              topicQuarterOptionsBySemester[topic.normalizedSemesterKey].push(topic.normalizedQuarterKey);
            }
          });

          Object.keys(topicQuarterOptionsBySemester).forEach((semesterOption) => {
            topicQuarterOptionsBySemester[semesterOption] = sortQuarterKeys(
              topicQuarterOptionsBySemester[semesterOption]
            );
          });

          const semesterOptions = sortSemesterKeys(
            Array.from(
              new Set([
                ...templateTermConfig.semesterOptions,
                ...topicSemesterOptions,
              ].filter(Boolean))
            )
          );

          const quarterOptionsBySemester = {};
          semesterOptions.forEach((semesterOption) => {
            const mergedQuarterOptions = sortQuarterKeys(
              Array.from(
                new Set([
                  ...(templateTermConfig.quarterOptionsBySemester?.[semesterOption] || []),
                  ...(topicQuarterOptionsBySemester?.[semesterOption] || []),
                ].filter(Boolean))
              )
            );

            if (mergedQuarterOptions.length) {
              quarterOptionsBySemester[semesterOption] = mergedQuarterOptions;
            }
          });

          return {
            courseId,
            subject: subjectName,
            teacherName,
            topicCount: topics.length,
            latestTopic,
            latestTimestamp: latestTopic?.timestamp || 0,
            visual,
            teacherId: assignmentTeacherId || teacherIds[0] || "",
            annualPlanCoveredCount,
            annualPlanTotalCount,
            annualPlanCoveragePercent,
            templateMode,
            semesterOptions,
            quarterOptionsBySemester,
            hasQuarterTopicMetadata: topics.some((topic) => !!topic.normalizedQuarterKey),
            topics,
          };
        })
        .filter((item) => item.topicCount > 0)
        .sort((left, right) => right.latestTimestamp - left.latestTimestamp || left.subject.localeCompare(right.subject));

      const { feedbackMap: hydratedTopicFeedback, changed: teacherIdsHydrated } =
        enrichStudentWhatLearnTeacherIds(existingTopicFeedback, nextSubjects);

      if (teacherIdsHydrated && effectiveStudentId) {
        await set(ref(database, buildStudentWhatLearnPath(schoolKey, effectiveStudentId)), hydratedTopicFeedback);
      }

      if (teacherIdsHydrated) {
        setTopicFeedbackMap(hydratedTopicFeedback);
      }

      setSubjects(nextSubjects);
    } catch (error) {
      console.warn("What you learn load error:", error);
      setSubjects([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData({ silent: true });
    setRefreshing(false);
  }, [loadData]);

  const stats = useMemo(() => {
    const totalSubjects = subjects.length;
    const totalTopics = subjects.reduce((sum, subject) => sum + subject.topicCount, 0);
    const latestTopic = subjects[0]?.latestTopic || null;

    return {
      totalSubjects,
      totalTopics,
      latestLabel: latestTopic
        ? `${formatTopicDay(latestTopic.dateKey, latestTopic.dayName, latestTopic.createdAt)} • ${formatTopicDate(
            latestTopic.dateKey,
            latestTopic.createdAt
          )}`
        : "--",
    };
  }, [subjects]);

  const visibleSemesterOptions = useMemo(() => {
    return selectedSubject?.semesterOptions || [];
  }, [selectedSubject]);

  const visibleQuarterOptions = useMemo(() => {
    if (!selectedSubject || !selectedSubject.hasQuarterTopicMetadata) return [];

    if (selectedSemesterFilter !== "all") {
      return selectedSubject?.quarterOptionsBySemester?.[selectedSemesterFilter] || [];
    }

    return sortQuarterKeys(
      Array.from(
        new Set(
          Object.values(selectedSubject?.quarterOptionsBySemester || {}).flat()
        )
      )
    );
  }, [selectedSemesterFilter, selectedSubject]);

  const filteredSubjectTopics = useMemo(() => {
    if (!selectedSubject) return [];

    return selectedSubject.topics.filter((topic) => {
      if (selectedSemesterFilter !== "all" && topic.normalizedSemesterKey !== selectedSemesterFilter) {
        return false;
      }

      if (
        selectedQuarterFilter !== "all" &&
        selectedSubject.hasQuarterTopicMetadata &&
        topic.normalizedQuarterKey !== selectedQuarterFilter
      ) {
        return false;
      }

      return true;
    });
  }, [selectedQuarterFilter, selectedSemesterFilter, selectedSubject]);

  const subjectSheetFilterSummary = useMemo(() => {
    if (!selectedSubject) return "";

    const labels = [
      selectedSemesterFilter !== "all" ? formatSemesterLabel(selectedSemesterFilter) : null,
      selectedQuarterFilter !== "all" ? formatQuarterLabel(selectedQuarterFilter) : null,
    ].filter(Boolean);

    if (!labels.length) {
      return `${filteredSubjectTopics.length} topic${filteredSubjectTopics.length === 1 ? "" : "s"} available`;
    }

    return `${filteredSubjectTopics.length} topic${filteredSubjectTopics.length === 1 ? "" : "s"} in ${labels.join(" • ")}`;
  }, [filteredSubjectTopics.length, selectedQuarterFilter, selectedSemesterFilter, selectedSubject]);

  const selectedTopicFeedback = useMemo(() => {
    if (!selectedTopicEntry?.feedbackKey) return null;
    return topicFeedbackMap?.[selectedTopicEntry.feedbackKey] || null;
  }, [selectedTopicEntry, topicFeedbackMap]);

  useEffect(() => {
    if (selectedQuarterFilter === "all") return;
    if (visibleQuarterOptions.includes(selectedQuarterFilter)) return;
    setSelectedQuarterFilter("all");
  }, [selectedQuarterFilter, visibleQuarterOptions]);

  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [720, 0],
  });

  if (loading) {
    return (
      <PageLoadingSkeleton variant="list" style={styles.screen} />
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <FlatList
        data={subjects}
        keyExtractor={(item) => item.courseId}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />
        }
        contentContainerStyle={{
          paddingBottom: Math.max(24, insets.bottom + 16),
        }}
        ListHeaderComponent={
          <>
            <View style={[styles.header, { paddingTop: insets.top }] }>
              <TouchableOpacity onPress={handleBackNavigation} style={styles.headerIconBtn}>
                <Ionicons name="arrow-back" size={20} color={PRIMARY} />
              </TouchableOpacity>

              <View style={styles.headerTitleWrap}>
                <Text numberOfLines={1} style={styles.headerTitle}>What you learn</Text>
                <Text numberOfLines={1} style={styles.headerSubtitle}>
                  {classMeta.schoolName || "Your class"}
                </Text>
              </View>

              <TouchableOpacity onPress={onRefresh} style={styles.headerIconBtn}>
                <Ionicons name="refresh-outline" size={18} color={PRIMARY} />
              </TouchableOpacity>
            </View>

            <View style={styles.heroCard}>
              <View style={styles.heroGlowA} />
              <View style={styles.heroGlowB} />

              <Text style={styles.heroTitle}>Daily lesson topics</Text>
              <Text style={styles.heroSubtitle}>
                Grade {classMeta.grade || "--"} • Section {classMeta.section || "--"}
              </Text>
              <Text numberOfLines={1} style={styles.heroText}>
                Track teacher-submitted class topics by subject.
              </Text>

              <View style={styles.heroStatsRow}>
                <View style={styles.heroStatCell}>
                  <Text style={styles.heroStatValue}>{stats.totalSubjects}</Text>
                  <Text style={styles.heroStatLabel}>Subjects</Text>
                </View>

                <View style={styles.heroStatDivider} />

                <View style={styles.heroStatCell}>
                  <Text style={styles.heroStatValue}>{stats.totalTopics}</Text>
                  <Text style={styles.heroStatLabel}>Topics</Text>
                </View>

                <View style={styles.heroStatDivider} />

                <View style={styles.heroStatCell}>
                  <Text numberOfLines={1} style={styles.heroStatValueSmall}>{stats.latestLabel}</Text>
                  <Text style={styles.heroStatLabel}>Latest</Text>
                </View>
              </View>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Subjects</Text>
              <Text style={styles.sectionSubtitle}>Tap any subject card to open submitted daily lesson topics.</Text>
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIconWrap}>
              <MaterialCommunityIcons name="book-education-outline" size={28} color={colors.muted} />
            </View>
            <Text style={styles.emptyTitle}>No submitted topics yet</Text>
            <Text style={styles.emptyText}>
              Your teachers have not submitted daily lesson topics for this class yet.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const latestTopic = item.latestTopic;
          const isActive = subjectSheetVisible && selectedSubject?.courseId === item.courseId;
          const itemVisual = getSubjectVisual(item.subject, colors);

          return (
            <View style={[styles.subjectCard, isActive && styles.subjectCardExpanded]}>
              <TouchableOpacity
                activeOpacity={0.92}
                style={styles.subjectHeader}
                onPress={() => openSubjectSheet(item)}
              >
                <View style={styles.subjectHeaderLeft}>
                  <View style={[styles.subjectIconWrap, { backgroundColor: itemVisual.bg }] }>
                    <MaterialCommunityIcons name={itemVisual.icon} size={24} color={itemVisual.color} />
                  </View>

                  <View style={styles.subjectTextWrap}>
                    <Text numberOfLines={1} style={styles.subjectTitle}>{item.subject}</Text>
                    <Text numberOfLines={1} style={styles.subjectMetaPrimary}>
                      {item.teacherName || "Teacher submitted topics"}
                    </Text>
                    <Text numberOfLines={1} style={styles.subjectMetaSecondary}>
                      {latestTopic
                        ? `Latest • ${latestTopic.topic}`
                        : "No submitted topics yet"}
                    </Text>
                  </View>
                </View>

                <View style={styles.subjectHeaderRight}>
                  <CircularCoverageBadge
                    coveragePercent={item.annualPlanCoveragePercent}
                    styles={styles}
                  />
                </View>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      <Modal visible={subjectSheetVisible} transparent animationType="none" onRequestClose={closeSubjectSheet}>
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={closeSubjectSheet} />

          <Animated.View
            style={[
              styles.subjectSheetContainer,
              {
                paddingBottom: Math.max(18, insets.bottom + 8),
                transform: [{ translateY: sheetTranslateY }],
              },
            ]}
          >
            <View style={styles.sheetHandle} />

            {selectedSubject ? (
              <>
                <View style={styles.subjectSheetHeader}>
                  <View style={styles.subjectSheetHeaderLeft}>
                    <View style={[styles.subjectSheetIconWrap, { backgroundColor: selectedSubjectVisual?.bg || colors.soft }] }>
                      <MaterialCommunityIcons
                        name={selectedSubjectVisual?.icon || "book-education-outline"}
                        size={24}
                        color={selectedSubjectVisual?.color || PRIMARY}
                      />
                    </View>

                    <View style={styles.subjectSheetHeaderInfo}>
                      <Text numberOfLines={1} style={styles.subjectSheetTitle}>{selectedSubject.subject}</Text>
                      <Text numberOfLines={1} style={styles.subjectSheetSubtitle}>
                        {selectedSubject.teacherName || "Teacher submitted topics"}
                      </Text>
                      <PlanCoverageBar
                        coveragePercent={selectedSubject.annualPlanCoveragePercent}
                        coveredCount={selectedSubject.annualPlanCoveredCount}
                        totalCount={selectedSubject.annualPlanTotalCount}
                        styles={styles}
                      />
                    </View>
                  </View>

                  <TouchableOpacity style={styles.subjectSheetCloseBtn} onPress={closeSubjectSheet}>
                    <Ionicons name="close" size={20} color={colors.text} />
                  </TouchableOpacity>
                </View>

                {visibleSemesterOptions.length ? (
                  <View style={styles.subjectSheetFiltersWrap}>
                    <Text style={styles.subjectSheetFilterLabel}>Semester</Text>
                    <View style={styles.subjectSheetFilterRow}>
                      {[
                        { key: "all", label: "All" },
                        ...visibleSemesterOptions.map((semesterOption) => ({
                          key: semesterOption,
                          label: formatSemesterLabel(semesterOption),
                        })),
                      ].map((option, index, array) => {
                        const active = selectedSemesterFilter === option.key;
                        return (
                          <TouchableOpacity
                            key={option.key}
                            activeOpacity={0.9}
                            onPress={() => {
                              setSelectedSemesterFilter(option.key);
                              setSelectedQuarterFilter("all");
                            }}
                            style={[
                              styles.subjectSheetFilterChip,
                              active && styles.subjectSheetFilterChipActive,
                              index < array.length - 1 && styles.subjectSheetFilterChipGap,
                            ]}
                          >
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.subjectSheetFilterChipText,
                                active && styles.subjectSheetFilterChipTextActive,
                              ]}
                            >
                              {option.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {selectedSubject.templateMode === "quarter" && visibleQuarterOptions.length ? (
                      <>
                        <Text style={[styles.subjectSheetFilterLabel, styles.subjectSheetFilterLabelGap]}>Quarter</Text>
                        <View style={styles.subjectSheetFilterRow}>
                          {[
                            { key: "all", label: "All" },
                            ...visibleQuarterOptions.map((quarterOption) => ({
                              key: quarterOption,
                              label: formatQuarterLabel(quarterOption),
                            })),
                          ].map((option, index, array) => {
                            const active = selectedQuarterFilter === option.key;
                            return (
                              <TouchableOpacity
                                key={option.key}
                                activeOpacity={0.9}
                                onPress={() => setSelectedQuarterFilter(option.key)}
                                style={[
                                  styles.subjectSheetFilterChip,
                                  active && styles.subjectSheetFilterChipActive,
                                  index < array.length - 1 && styles.subjectSheetFilterChipGap,
                                ]}
                              >
                                <Text
                                  numberOfLines={1}
                                  style={[
                                    styles.subjectSheetFilterChipText,
                                    active && styles.subjectSheetFilterChipTextActive,
                                  ]}
                                >
                                  {option.label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </>
                    ) : null}

                    <Text style={styles.subjectSheetFilterSummary}>{subjectSheetFilterSummary}</Text>
                  </View>
                ) : null}

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.subjectSheetScrollContent}
                >
                  <SubjectTopicsList
                    topics={filteredSubjectTopics}
                    subject={selectedSubject}
                    colors={colors}
                    styles={styles}
                    feedbackMap={topicFeedbackMap}
                    onTopicPress={openTopicFeedback}
                    emptyMessage={
                      selectedSemesterFilter !== "all" || selectedQuarterFilter !== "all"
                        ? "No submitted topics in this term filter yet."
                        : "No submitted topics yet for this subject."
                    }
                  />
                </ScrollView>
              </>
            ) : null}
          </Animated.View>
        </View>
      </Modal>

      <TopicEvaluationModal
        visible={topicFeedbackVisible}
        onClose={closeTopicFeedback}
        onSave={saveTopicFeedback}
        topicEntry={selectedTopicEntry}
        understandingLevel={selectedUnderstandingLevel}
        understandingOptions={understandingOptions}
        onSelectUnderstandingLevel={setSelectedUnderstandingLevel}
        teacherRating={selectedTeacherRating}
        onSelectTeacherRating={setSelectedTeacherRating}
        existingFeedback={selectedTopicFeedback}
        saving={savingTopicFeedback}
        styles={styles}
        colors={colors}
      />
    </SafeAreaView>
  );
}

function PlanCoverageBar({ coveragePercent, coveredCount, totalCount, styles }) {
  if (!totalCount) return null;

  const safePercent = Math.max(0, Math.min(coveragePercent || 0, 100));
  const fillWidth = `${Math.max(safePercent, safePercent > 0 ? 6 : 0)}%`;

  return (
    <View style={styles.planCoverageWrap}>
      <View style={styles.planCoverageRow}>
        <Text numberOfLines={1} style={styles.planCoverageLabel}>
          {safePercent}% of annual plan covered
        </Text>
        <Text style={styles.planCoverageCount}>
          {coveredCount}/{totalCount}
        </Text>
      </View>
      <View style={styles.planCoverageTrack}>
        <View style={[styles.planCoverageFill, { width: fillWidth }]} />
      </View>
    </View>
  );
}

function TopicEvaluationModal({
  visible,
  onClose,
  onSave,
  topicEntry,
  understandingLevel,
  understandingOptions,
  onSelectUnderstandingLevel,
  teacherRating,
  onSelectTeacherRating,
  existingFeedback,
  saving,
  styles,
  colors,
}) {
  if (!topicEntry) return null;

  const canSave = !!understandingLevel && !saving;
  const updatedLabel = formatFeedbackUpdatedAt(existingFeedback?.updatedAt);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.topicEvalOverlay}>
        <TouchableOpacity
          style={styles.topicEvalBackdrop}
          activeOpacity={1}
          onPress={onClose}
          disabled={saving}
        />

        <SafeAreaView style={styles.topicEvalScreen}>
          <View style={styles.topicEvalCard}>
            <View pointerEvents="none" style={styles.topicEvalCardGlowA} />
            <View pointerEvents="none" style={styles.topicEvalCardGlowB} />

            <View style={styles.topicEvalScrollContent}>
              <View style={styles.topicEvalHeroCard}>
                <View style={styles.topicEvalHeader}>
                  <View style={styles.topicEvalHeaderMain}>
                    <View
                      style={[
                        styles.topicEvalIconWrap,
                        { backgroundColor: topicEntry?.visual?.bg || colors.soft },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={topicEntry?.visual?.icon || "book-education-outline"}
                        size={22}
                        color={topicEntry?.visual?.color || PRIMARY}
                      />
                    </View>

                    <View style={styles.topicEvalHeaderTextWrap}>
                      <View style={styles.topicEvalTitleRow}>
                        <Text style={styles.topicEvalTitle}>{topicEntry.topic}</Text>
                        {updatedLabel ? (
                          <View style={styles.topicEvalTitleSavedWrap}>
                            <View style={styles.topicEvalTitleSavedBadge}>
                              <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                            </View>
                            <Text style={styles.topicEvalTitleSavedText}>Saved {updatedLabel}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.topicEvalSubtitle}>
                        {topicEntry.subjectLabel} • {topicEntry.teacherName || "Teacher submitted topics"}
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.topicEvalCloseBtn}
                    activeOpacity={0.88}
                    onPress={onClose}
                    disabled={saving}
                  >
                    <Ionicons name="close" size={20} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <View style={styles.topicEvalMetaRow}>
                  <View style={styles.topicEvalMetaChip}>
                    <Ionicons name="calendar-outline" size={13} color={PRIMARY} />
                    <Text style={styles.topicEvalMetaText}>
                      {formatTopicDay(topicEntry.dateKey, topicEntry.dayName, topicEntry.createdAt)} • {formatTopicDate(
                        topicEntry.dateKey,
                        topicEntry.createdAt
                      )}
                    </Text>
                  </View>

                  <View style={styles.topicEvalMetaChip}>
                    <Ionicons name="layers-outline" size={13} color={PRIMARY} />
                    <Text style={styles.topicEvalMetaText}>
                      {formatSemesterLabel(topicEntry.semesterKey)} • {topicEntry.monthKey} • {topicEntry.weekKey}
                    </Text>
                  </View>
                </View>

                <View style={styles.topicEvalInfoCard}>
                  <Ionicons name="sparkles-outline" size={16} color={PRIMARY} />
                  <Text style={styles.topicEvalInfoText}>
                    Rate how clear this lesson was.
                  </Text>
                </View>
              </View>

              <Text style={styles.topicEvalSectionTitle}>How well did you learn this topic?</Text>
              <View style={styles.topicEvalSectionCard}>
                {understandingOptions.map((option) => {
                  const isActive = understandingLevel === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      activeOpacity={0.9}
                      style={[
                        styles.topicEvalOptionCard,
                        isActive && styles.topicEvalOptionCardActive,
                        { backgroundColor: isActive ? option.bg : colors.card },
                      ]}
                      onPress={() => onSelectUnderstandingLevel(option.key)}
                    >
                      <View style={[styles.topicEvalOptionIconWrap, { backgroundColor: option.bg }]}>
                        <Ionicons name={option.icon} size={18} color={option.tint} />
                      </View>

                      <View style={styles.topicEvalOptionTextWrap}>
                        <Text style={styles.topicEvalOptionTitle}>{option.label}</Text>
                        <Text numberOfLines={1} style={styles.topicEvalOptionSubtitle}>{option.subtitle}</Text>
                      </View>

                      {isActive ? <Ionicons name="checkmark-circle" size={18} color={PRIMARY} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.topicEvalSectionTitle}>Rate the teacher</Text>
              <View style={styles.topicEvalRatingCard}>
                <View style={styles.topicEvalStarsRow}>
                  {[1, 2, 3, 4, 5].map((star) => {
                    const active = Number(teacherRating || 0) >= star;
                    return (
                      <TouchableOpacity
                        key={star}
                        activeOpacity={0.88}
                        style={[
                          styles.topicEvalStarBtn,
                          active && styles.topicEvalStarBtnActive,
                        ]}
                        onPress={() => onSelectTeacherRating(star)}
                      >
                        <Ionicons
                          name={active ? "star" : "star-outline"}
                          size={24}
                          color={active ? "#F59E0B" : colors.muted}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.topicEvalRatingLabel}>{getTeacherRatingLabel(teacherRating)}</Text>
              </View>

              <View style={styles.topicEvalActionsRow}>
                <TouchableOpacity
                  style={styles.topicEvalSecondaryBtn}
                  activeOpacity={0.88}
                  onPress={onClose}
                  disabled={saving}
                >
                  <Text style={styles.topicEvalSecondaryBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.topicEvalPrimaryBtn,
                    !canSave && styles.topicEvalPrimaryBtnDisabled,
                  ]}
                  activeOpacity={0.9}
                  onPress={onSave}
                  disabled={!canSave}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <View style={styles.topicEvalPrimaryBtnInner}>
                      <Ionicons name="checkmark-circle-outline" size={16} color="#FFFFFF" />
                      <Text style={styles.topicEvalPrimaryBtnText}>
                        {existingFeedback ? "Update feedback" : "Save feedback"}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function CircularCoverageBadge({ coveragePercent, styles }) {
  const safePercent = Math.max(0, Math.min(Number(coveragePercent || 0), 100));
  const size = 44;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - safePercent / 100);

  return (
    <View style={styles.subjectCoverageCircleWrap}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(11,114,255,0.16)"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={PRIMARY}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          rotation={-90}
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>
      <View style={styles.subjectCoverageCircleCenter}>
        <Text style={styles.subjectCoverageCircleText}>{safePercent}%</Text>
      </View>
    </View>
  );
}

function SubjectTopicsList({ topics, subject, colors, styles, feedbackMap, onTopicPress, emptyMessage }) {
  if (!topics.length) {
    return (
      <View style={styles.subjectSheetEmptyWrap}>
        <View style={styles.subjectSheetEmptyIconWrap}>
          <Ionicons name="layers-outline" size={20} color={colors.muted} />
        </View>
        <Text style={styles.subjectSheetEmptyTitle}>No topics in this filter</Text>
        <Text style={styles.subjectSheetEmptyText}>{emptyMessage}</Text>
      </View>
    );
  }

  return (
    <View style={styles.topicListWrap}>
      {topics.map((topic, index) => {
        const isLatest = index === 0;
        const feedback = feedbackMap?.[topic.feedbackKey] || null;
        const understanding = getUnderstandingOption(feedback?.understandingLevel || "", colors);

        return (
        <TouchableOpacity
          key={topic.id}
          activeOpacity={0.92}
          style={[styles.topicCard, isLatest && styles.topicCardLatest]}
          onPress={() => onTopicPress?.(topic, subject)}
        >
          <View style={styles.topicDateBadge}>
            <Text style={styles.topicDateDay}>{formatTopicDay(topic.dateKey, topic.dayName, topic.createdAt)}</Text>
            <Text style={styles.topicDateText}>{formatTopicDate(topic.dateKey, topic.createdAt)}</Text>
          </View>

          <View style={styles.topicContent}>
            <View style={styles.topicTitleRow}>
              <Text style={styles.topicTitle}>{topic.topic}</Text>
              {isLatest ? (
                <View style={styles.latestBadge}>
                  <Text style={styles.latestBadgeText}>Latest</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.topicMetaRow}>
              <View style={styles.topicMetaChip}>
                <Ionicons name="layers-outline" size={11} color={colors.muted} />
                <Text style={styles.topicMetaText}>
                  {formatSemesterLabel(topic.semesterKey)} • {topic.monthKey} • {topic.weekKey}
                </Text>
              </View>

              {feedback ? (
                <>
                  <View
                    style={[
                      styles.topicFeedbackChip,
                      {
                        backgroundColor: understanding?.bg || colors.soft,
                        borderColor: understanding?.tint || colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={understanding?.icon || "chatbubble-ellipses-outline"}
                      size={11}
                      color={understanding?.tint || colors.text}
                    />
                    <Text
                      style={[
                        styles.topicFeedbackChipText,
                        { color: understanding?.tint || colors.text },
                      ]}
                    >
                      {understanding?.label || "Feedback saved"}
                    </Text>
                  </View>

                  {Number(feedback?.teacherRating || 0) > 0 ? (
                    <View style={styles.topicFeedbackChip}>
                      <Ionicons name="star" size={11} color="#F59E0B" />
                      <Text style={styles.topicFeedbackChipText}>{Number(feedback.teacherRating)}/5 teacher</Text>
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>
        );
      })}
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },

    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    headerIconBtn: {
      width: 38,
      height: 38,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.inputBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitleWrap: {
      flex: 1,
      marginHorizontal: 12,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 21,
      fontWeight: "900",
    },
    headerSubtitle: {
      marginTop: 2,
      color: colors.muted,
      fontSize: 12,
      fontWeight: "600",
    },

    heroCard: {
      marginHorizontal: 16,
      marginBottom: 14,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: 14,
      paddingVertical: 13,
      overflow: "hidden",
    },
    heroGlowA: {
      position: "absolute",
      top: -28,
      right: -16,
      width: 104,
      height: 104,
      borderRadius: 52,
      backgroundColor: "rgba(11,114,255,0.10)",
    },
    heroGlowB: {
      position: "absolute",
      bottom: -34,
      left: -14,
      width: 84,
      height: 84,
      borderRadius: 42,
      backgroundColor: "rgba(14,165,233,0.08)",
    },
    heroTitle: {
      marginTop: 2,
      color: colors.text,
      fontSize: 21,
      fontWeight: "900",
    },
    heroSubtitle: {
      marginTop: 4,
      color: colors.text,
      fontSize: 12,
      fontWeight: "700",
    },
    heroText: {
      marginTop: 6,
      color: colors.muted,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "600",
      maxWidth: "92%",
    },

    heroStatsRow: {
      marginTop: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.inputBackground,
      paddingVertical: 10,
      paddingHorizontal: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    heroStatCell: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 4,
    },
    heroStatDivider: {
      width: 1,
      height: 28,
      backgroundColor: colors.border,
      opacity: 0.8,
    },
    heroStatValue: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "900",
    },
    heroStatValueSmall: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "800",
    },
    heroStatLabel: {
      marginTop: 3,
      color: colors.muted,
      fontSize: 10,
      fontWeight: "700",
    },

    statsRow: {
      flexDirection: "row",
      paddingHorizontal: 16,
      marginBottom: 16,
    },
    statCard: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 18,
      paddingVertical: 12,
      alignItems: "center",
      marginRight: 8,
    },
    statCardLast: {
      flex: 1.1,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 18,
      paddingVertical: 12,
      alignItems: "center",
    },
    statValue: {
      color: colors.text,
      fontSize: 20,
      fontWeight: "900",
    },
    statValueSmall: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "800",
    },
    statLabel: {
      marginTop: 4,
      color: colors.muted,
      fontSize: 11,
      fontWeight: "700",
    },

    sectionHeader: {
      paddingHorizontal: 16,
      paddingBottom: 10,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "900",
    },
    sectionSubtitle: {
      marginTop: 3,
      color: colors.muted,
      fontSize: 12,
      fontWeight: "600",
    },

    subjectCard: {
      marginHorizontal: 16,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 22,
      backgroundColor: colors.card,
      overflow: "hidden",
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.03,
      shadowRadius: 12,
      elevation: 2,
    },
    subjectCardExpanded: {
      borderColor: colors.primary,
    },
    subjectHeader: {
      paddingHorizontal: 14,
      paddingVertical: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    subjectHeaderLeft: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
      marginRight: 10,
    },
    subjectIconWrap: {
      width: 56,
      height: 74,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    subjectTextWrap: {
      flex: 1,
      marginLeft: 12,
    },
    subjectTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "900",
    },
    subjectMetaPrimary: {
      marginTop: 4,
      color: colors.muted,
      fontSize: 11,
      fontWeight: "700",
    },
    planCoverageWrap: {
      marginTop: 8,
    },
    planCoverageRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 5,
    },
    planCoverageLabel: {
      flex: 1,
      marginRight: 8,
      color: colors.muted,
      fontSize: 10,
      fontWeight: "700",
    },
    planCoverageCount: {
      color: PRIMARY,
      fontSize: 10,
      fontWeight: "900",
    },
    planCoverageTrack: {
      height: 6,
      borderRadius: 999,
      overflow: "hidden",
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.border,
    },
    planCoverageFill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: PRIMARY,
    },
    subjectMetaSecondary: {
      marginTop: 7,
      color: PRIMARY,
      fontSize: 12,
      fontWeight: "800",
    },
    subjectHeaderRight: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    },
    subjectCoverageCircleWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 8,
    },
    subjectCoverageCircleCenter: {
      position: "absolute",
      alignItems: "center",
      justifyContent: "center",
    },
    subjectCoverageCircleText: {
      color: PRIMARY,
      fontSize: 10,
      fontWeight: "900",
    },
    topicListWrap: {
      paddingTop: 2,
      paddingBottom: 4,
    },
    topicCard: {
      marginBottom: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.card,
      flexDirection: "row",
      alignItems: "flex-start",
    },
    topicCardLatest: {
      borderColor: colors.primary,
      backgroundColor: colors.inputBackground,
    },
    topicDateBadge: {
      width: 68,
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 8,
      backgroundColor: colors.soft,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 10,
    },
    topicDateDay: {
      color: PRIMARY,
      fontSize: 11,
      fontWeight: "900",
      textTransform: "uppercase",
    },
    topicDateText: {
      marginTop: 3,
      color: colors.text,
      fontSize: 11,
      fontWeight: "700",
    },
    topicContent: {
      flex: 1,
    },
    topicTitleRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    topicTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "800",
    },
    latestBadge: {
      marginLeft: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: colors.soft,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    latestBadgeText: {
      color: colors.primary,
      fontSize: 9,
      fontWeight: "900",
      textTransform: "uppercase",
    },
    topicMetaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginTop: 8,
    },
    topicMetaChip: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: 8,
      marginBottom: 8,
    },
    topicMetaText: {
      marginLeft: 5,
      color: colors.muted,
      fontSize: 10,
      fontWeight: "700",
    },
    topicFeedbackChip: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: 8,
      marginBottom: 8,
    },
    topicFeedbackChipText: {
      marginLeft: 5,
      color: colors.text,
      fontSize: 10,
      fontWeight: "800",
    },
    topicFeedbackChipAlert: {
      backgroundColor: colors.dangerSurface,
      borderColor: colors.dangerBorder,
    },
    topicFeedbackChipAlertText: {
      color: colors.danger,
    },
    topicTapHintRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: colors.soft,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 8,
    },
    topicTapHintText: {
      marginLeft: 5,
      color: PRIMARY,
      fontSize: 10,
      fontWeight: "800",
    },

    sheetOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: colors.overlay,
    },
    sheetBackdrop: {
      flex: 1,
    },
    sheetHandle: {
      width: 46,
      height: 5,
      borderRadius: 999,
      backgroundColor: colors.border,
      alignSelf: "center",
      marginBottom: 12,
    },
    subjectSheetContainer: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 16,
      paddingTop: 10,
      maxHeight: "84%",
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: colors.border,
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: -10 },
      shadowOpacity: 0.07,
      shadowRadius: 16,
      elevation: 6,
    },
    subjectSheetHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    subjectSheetHeaderLeft: {
      flexDirection: "row",
      alignItems: "flex-start",
      flex: 1,
      paddingRight: 12,
    },
    subjectSheetIconWrap: {
      width: 52,
      height: 68,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    subjectSheetHeaderInfo: {
      flex: 1,
      marginLeft: 12,
    },
    subjectSheetTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "900",
    },
    subjectSheetSubtitle: {
      marginTop: 4,
      color: colors.muted,
      fontSize: 12,
      fontWeight: "600",
    },
    subjectSheetCloseBtn: {
      width: 38,
      height: 38,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.inputBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    topicEvalOverlay: {
      flex: 1,
      backgroundColor: "transparent",
    },
    topicEvalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "transparent",
    },
    topicEvalScreen: {
      flex: 1,
      backgroundColor: "transparent",
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    topicEvalCloseBtn: {
      width: 40,
      height: 40,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.05,
      shadowRadius: 10,
      elevation: 2,
    },
    topicEvalCard: {
      flex: 1,
      borderRadius: 30,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.08,
      shadowRadius: 20,
      elevation: 8,
    },
    topicEvalScrollContent: {
      paddingHorizontal: 15,
      paddingTop: 14,
      paddingBottom: 20,
    },
    topicEvalPill: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.soft,
    },
    topicEvalPillText: {
      marginLeft: 6,
      color: PRIMARY,
      fontSize: 11,
      fontWeight: "900",
    },
    topicEvalHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
    },
    topicEvalHeaderMain: {
      flex: 1,
      flexDirection: "row",
      alignItems: "flex-start",
      paddingRight: 10,
    },
    topicEvalIconWrap: {
      width: 50,
      height: 50,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    topicEvalHeaderTextWrap: {
      flex: 1,
      marginLeft: 10,
    },
    topicEvalTitleRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    topicEvalTitle: {
      flexShrink: 1,
      color: colors.text,
      fontSize: 17,
      lineHeight: 23,
      fontWeight: "900",
    },
    topicEvalTitleSavedWrap: {
      flexDirection: "row",
      alignItems: "center",
      marginLeft: 6,
    },
    topicEvalTitleSavedBadge: {
      width: 24,
      height: 24,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.successBorder,
      backgroundColor: colors.successSurface,
      alignItems: "center",
      justifyContent: "center",
    },
    topicEvalTitleSavedText: {
      marginLeft: 5,
      color: colors.success,
      fontSize: 10,
      fontWeight: "800",
    },
    topicEvalSubtitle: {
      marginTop: 4,
      color: colors.muted,
      fontSize: 11,
      fontWeight: "700",
    },
    topicEvalMetaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginTop: 12,
    },
    topicEvalMetaChip: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      marginRight: 6,
      marginBottom: 6,
    },
    topicEvalMetaText: {
      marginLeft: 5,
      color: colors.text,
      fontSize: 10,
      fontWeight: "700",
    },
    topicEvalInfoCard: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginTop: 12,
      paddingHorizontal: 11,
      paddingVertical: 10,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: "rgba(11,114,255,0.10)",
      backgroundColor: colors.card,
    },
    topicEvalInfoText: {
      flex: 1,
      marginLeft: 6,
      color: colors.muted,
      fontSize: 10,
      lineHeight: 15,
      fontWeight: "700",
    },
    topicEvalSectionTitle: {
      marginTop: 16,
      marginBottom: 7,
      color: colors.text,
      fontSize: 13,
      fontWeight: "900",
    },
    topicEvalSectionCard: {
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.inputBackground,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    topicEvalOptionCard: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 11,
      paddingVertical: 11,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      marginBottom: 7,
    },
    topicEvalOptionCardActive: {
      borderColor: colors.primary,
      shadowColor: PRIMARY,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.08,
      shadowRadius: 14,
      elevation: 2,
    },
    topicEvalOptionIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    topicEvalOptionTextWrap: {
      flex: 1,
      marginLeft: 8,
      marginRight: 8,
    },
    topicEvalOptionTitle: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "900",
    },
    topicEvalOptionSubtitle: {
      marginTop: 2,
      color: colors.muted,
      fontSize: 10,
      lineHeight: 14,
      fontWeight: "600",
    },
    topicEvalSegmentWrap: {
      flexDirection: "row",
      width: "100%",
      padding: 3,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.inputBackground,
    },
    topicEvalSegmentBtn: {
      flex: 1,
      minWidth: 0,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 8,
      paddingVertical: 9,
      borderRadius: 13,
    },
    topicEvalSegmentBtnGap: {
      marginRight: 4,
    },
    topicEvalSegmentBtnActive: {
      backgroundColor: colors.soft,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    topicEvalSegmentBtnText: {
      color: colors.muted,
      fontSize: 10,
      textAlign: "center",
      fontWeight: "800",
    },
    topicEvalSegmentBtnTextActive: {
      color: PRIMARY,
    },
    topicEvalSectionHint: {
      marginTop: 7,
      color: colors.muted,
      fontSize: 11,
      lineHeight: 17,
      fontWeight: "600",
    },
    topicEvalStarsRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginTop: 3,
    },
    topicEvalRatingCard: {
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.inputBackground,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    topicEvalStarBtn: {
      width: 42,
      height: 42,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
      marginHorizontal: 3,
    },
    topicEvalStarBtnActive: {
      borderColor: colors.warningBorder,
      backgroundColor: colors.warningSurface,
      shadowColor: "#F59E0B",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 10,
      elevation: 2,
    },
    topicEvalRatingLabel: {
      marginTop: 8,
      textAlign: "center",
      color: colors.text,
      fontSize: 11,
      fontWeight: "800",
    },
    topicEvalWarningCard: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginTop: 14,
      paddingHorizontal: 12,
      paddingVertical: 11,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.dangerBorder,
      backgroundColor: colors.dangerSurface,
    },
    topicEvalWarningText: {
      flex: 1,
      marginLeft: 8,
      color: colors.danger,
      fontSize: 11,
      lineHeight: 17,
      fontWeight: "700",
    },
    topicEvalActionsRow: {
      flexDirection: "row",
      marginTop: 18,
    },
    topicEvalSecondaryBtn: {
      flex: 1,
      height: 44,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.inputBackground,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 8,
    },
    topicEvalSecondaryBtnText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "800",
    },
    topicEvalPrimaryBtn: {
      flex: 1.4,
      height: 44,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: PRIMARY,
      shadowColor: PRIMARY,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 14,
      elevation: 4,
    },
    topicEvalPrimaryBtnDisabled: {
      opacity: 0.45,
    },
    topicEvalPrimaryBtnInner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    },
    topicEvalPrimaryBtnText: {
      color: "#FFFFFF",
      fontSize: 12,
      fontWeight: "900",
      marginLeft: 6,
    },
    subjectSheetStatsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginBottom: 8,
    },
    subjectSheetStatPill: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: 8,
      marginBottom: 8,
    },
    subjectSheetStatText: {
      marginLeft: 6,
      color: colors.text,
      fontSize: 11,
      fontWeight: "700",
    },
    subjectSheetFiltersWrap: {
      marginBottom: 4,
    },
    subjectSheetFilterLabel: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "800",
      marginBottom: 5,
    },
    subjectSheetFilterLabelGap: {
      marginTop: 2,
    },
    subjectSheetFilterRow: {
      flexDirection: "row",
      alignItems: "center",
      width: "100%",
      padding: 3,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.inputBackground,
    },
    subjectSheetFilterChip: {
      flex: 1,
      minWidth: 0,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 6,
      paddingVertical: 7,
      borderRadius: 13,
      backgroundColor: "transparent",
    },
    subjectSheetFilterChipGap: {
      marginRight: 4,
    },
    subjectSheetFilterChipActive: {
      backgroundColor: colors.soft,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    subjectSheetFilterChipText: {
      color: colors.muted,
      fontSize: 10,
      fontWeight: "700",
      textAlign: "center",
    },
    subjectSheetFilterChipTextActive: {
      color: PRIMARY,
    },
    subjectSheetFilterSummary: {
      color: colors.muted,
      fontSize: 11,
      fontWeight: "600",
      marginTop: 2,
      marginBottom: 2,
    },
    subjectSheetScrollContent: {
      paddingBottom: 4,
    },
    subjectSheetEmptyWrap: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      backgroundColor: colors.inputBackground,
      paddingVertical: 26,
      paddingHorizontal: 18,
      alignItems: "center",
      marginTop: 4,
    },
    subjectSheetEmptyIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.soft,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    subjectSheetEmptyTitle: {
      marginTop: 12,
      color: colors.text,
      fontSize: 15,
      fontWeight: "800",
    },
    subjectSheetEmptyText: {
      marginTop: 6,
      color: colors.muted,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: "600",
      textAlign: "center",
    },

    emptyWrap: {
      marginHorizontal: 16,
      marginTop: 16,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 22,
      backgroundColor: colors.card,
      paddingVertical: 28,
      paddingHorizontal: 20,
      alignItems: "center",
    },
    emptyIconWrap: {
      width: 60,
      height: 60,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.soft,
      borderWidth: 1,
      borderColor: colors.border,
    },
    emptyTitle: {
      marginTop: 14,
      color: colors.text,
      fontSize: 17,
      fontWeight: "900",
    },
    emptyText: {
      marginTop: 6,
      textAlign: "center",
      color: colors.muted,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: "600",
    },
  });
}