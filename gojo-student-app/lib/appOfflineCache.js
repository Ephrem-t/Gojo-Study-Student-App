import AsyncStorage from "@react-native-async-storage/async-storage";
import { database } from "../constants/firebaseConfig";
import { get, limitToLast, orderByChild, query, ref } from "./offlineDatabase";
import { getSnapshot, getValue } from "../app/lib/dbHelpers";
import { getSavedPostsLocation } from "../app/lib/savedPosts";

const SCREEN_CACHE_PREFIX = "offlineScreenCache:v1";
const APP_BOOTSTRAP_LAST_RUN_KEY = "offlineAppBootstrap:lastRun:v1";
const APP_BOOTSTRAP_MIN_INTERVAL_MS = 10 * 60 * 1000;
const HOME_FEED_PAGE_SIZE = 20;

let bootstrapPromise = null;

function normalizeGrade(value) {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  const matched = raw.match(/(\d{1,2})/);
  if (matched) return String(matched[1]);
  const cleaned = raw.replace(/^grade\s*/i, "").trim();
  return cleaned || null;
}

function normalizeSection(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || null;
}

function buildScreenCacheKey(scope, parts = []) {
  const normalizedScope = String(scope || "screen").trim() || "screen";
  const suffix = (parts || [])
    .map((part) => encodeURIComponent(String(part == null ? "" : part).trim() || "global"))
    .join(":");
  return `${SCREEN_CACHE_PREFIX}:${normalizedScope}${suffix ? `:${suffix}` : ""}`;
}

export async function readScreenCache(scope, parts = []) {
  try {
    const raw = await AsyncStorage.getItem(buildScreenCacheKey(scope, parts));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && "value" in parsed ? parsed.value : parsed;
  } catch {
    return null;
  }
}

export async function writeScreenCache(scope, parts = [], value) {
  try {
    await AsyncStorage.setItem(
      buildScreenCacheKey(scope, parts),
      JSON.stringify({ savedAt: Date.now(), value })
    );
  } catch {}
}

export async function removeScreenCache(scope, parts = []) {
  try {
    await AsyncStorage.removeItem(buildScreenCacheKey(scope, parts));
  } catch {}
}

export async function resolveStudentAppContext() {
  const pairs = await AsyncStorage.multiGet([
    "studentNodeKey",
    "studentId",
    "username",
    "userId",
    "userNodeKey",
    "schoolKey",
    "studentGrade",
    "studentSection",
  ]);

  const session = Object.fromEntries(pairs);
  const studentId = session.studentNodeKey || session.studentId || session.username || null;
  const userId = session.userId || null;
  const userNodeKey = session.userNodeKey || null;
  let schoolKey = session.schoolKey || null;
  let grade = normalizeGrade(session.studentGrade);
  let section = normalizeSection(session.studentSection);

  if (!studentId) {
    return {
      studentId: null,
      userId,
      userNodeKey,
      schoolKey,
      grade,
      section,
    };
  }

  if (!schoolKey) {
    schoolKey = await getValue([
      `Platform1/schoolCodeIndex/${String(studentId).slice(0, 3)}`,
      `schoolCodeIndex/${String(studentId).slice(0, 3)}`,
    ], { maxAgeMs: 24 * 60 * 60 * 1000 });
  }

  let student = null;
  if (schoolKey) {
    student = await getValue([
      `Platform1/Schools/${schoolKey}/Students/${studentId}`,
      `Schools/${schoolKey}/Students/${studentId}`,
    ], { maxAgeMs: 10 * 60 * 1000 });
  }

  if (student) {
    grade = normalizeGrade(
      student?.basicStudentInformation?.grade ??
      student?.grade ??
      grade
    );

    section = normalizeSection(
      student?.basicStudentInformation?.section ??
      student?.section ??
      section
    );
  }

  const writes = [];
  if (schoolKey && schoolKey !== session.schoolKey) writes.push(["schoolKey", String(schoolKey)]);
  if (grade && grade !== normalizeGrade(session.studentGrade)) writes.push(["studentGrade", grade]);
  if (section && section !== normalizeSection(session.studentSection)) writes.push(["studentSection", section]);
  if (writes.length) {
    await AsyncStorage.multiSet(writes).catch(() => null);
  }

  return {
    studentId,
    userId,
    userNodeKey,
    schoolKey,
    grade,
    section,
  };
}

export async function prewarmEssentialAppCaches(options = {}) {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const force = Boolean(options?.force);
    const lastRun = Number((await AsyncStorage.getItem(APP_BOOTSTRAP_LAST_RUN_KEY)) || 0);

    if (!force && lastRun > 0 && Date.now() - lastRun < APP_BOOTSTRAP_MIN_INTERVAL_MS) {
      return null;
    }

    const context = await resolveStudentAppContext();
    if (!context?.studentId) return null;

    const tasks = [];
    const enqueue = (work) => {
      tasks.push(
        Promise.resolve()
          .then(work)
          .catch(() => null)
      );
    };

    if (context.schoolKey) {
      enqueue(() => getSnapshot([
        `Platform1/Schools/${context.schoolKey}/Students/${context.studentId}`,
      ], { maxAgeMs: 10 * 60 * 1000 }));

      enqueue(() => getSnapshot([
        `Platform1/Schools/${context.schoolKey}/schoolInfo`,
      ], { maxAgeMs: 60 * 60 * 1000 }));

      enqueue(() => getSnapshot([
        `Platform1/Schools/${context.schoolKey}/CalendarEvents`,
      ], { maxAgeMs: 10 * 60 * 1000 }));

      enqueue(() => getSnapshot([
        `Platform1/Schools/${context.schoolKey}/Schedule`,
        `Platform1/Schools/${context.schoolKey}/Schedules`,
      ], { maxAgeMs: 10 * 60 * 1000 }));

      if (context.grade) {
        enqueue(() => getSnapshot([
          `Platform1/Schools/${context.schoolKey}/GradeManagement/grades/${context.grade}`,
        ], { maxAgeMs: 10 * 60 * 1000 }));

        enqueue(() => getSnapshot([
          `Platform1/Schools/${context.schoolKey}/AssesmentTemplates/${context.grade}`,
          `AssesmentTemplates/${context.grade}`,
        ], { maxAgeMs: 10 * 60 * 1000 }));
      }

      const schoolPostsRef = ref(database, `Platform1/Schools/${context.schoolKey}/Posts`);
      enqueue(() => get(
        query(schoolPostsRef, orderByChild("time"), limitToLast(HOME_FEED_PAGE_SIZE)),
        { maxAgeMs: 5 * 60 * 1000 }
      ));

      if (context.grade) {
        enqueue(() => getSnapshot([
          `Platform1/Schools/${context.schoolKey}/StudentBookNotes/${context.studentId}/grade${context.grade}`,
        ], { maxAgeMs: 10 * 60 * 1000 }));
      }
    } else {
      const globalPostsRef = ref(database, "Posts");
      enqueue(() => get(
        query(globalPostsRef, orderByChild("time"), limitToLast(HOME_FEED_PAGE_SIZE)),
        { maxAgeMs: 5 * 60 * 1000 }
      ));
    }

    const savedPostsLocation = await getSavedPostsLocation().catch(() => null);
    if (savedPostsLocation?.basePath) {
      enqueue(() => get(ref(database, savedPostsLocation.basePath), { maxAgeMs: 60 * 1000 }));
    }

    enqueue(() => getSnapshot([
      "Platform1/companyExams/packages",
      "companyExams/packages",
    ], { maxAgeMs: 10 * 60 * 1000 }));

    if (context.schoolKey && context.userNodeKey) {
      enqueue(() => getSnapshot([
        `Platform1/Schools/${context.schoolKey}/Users/${context.userNodeKey}`,
        `Users/${context.userNodeKey}`,
      ], { maxAgeMs: 10 * 60 * 1000 }));
    }

    enqueue(() => getSnapshot([
      "Platform1/companyExams/exams",
      "companyExams/exams",
    ], { maxAgeMs: 10 * 60 * 1000 }));

    enqueue(() => getSnapshot([
      "Platform1/appConfig/exams",
      "appConfig/exams",
    ], { maxAgeMs: 10 * 60 * 1000 }));

    enqueue(() => getSnapshot([
      `Platform1/usersMeta/${context.studentId}`,
      `usersMeta/${context.studentId}`,
    ], { maxAgeMs: 2 * 60 * 1000 }));

    enqueue(() => getSnapshot([
      "Platform1/examNotifications",
      "examNotifications",
    ], { maxAgeMs: 2 * 60 * 1000 }));

    enqueue(() => getSnapshot([
      `Platform1/studentLives/${context.studentId}`,
      `studentLives/${context.studentId}`,
    ], { maxAgeMs: 30 * 1000 }));

    const country = (await getValue([
      "Platform1/country",
      "country",
    ], { maxAgeMs: 60 * 60 * 1000 })) || "Ethiopia";

    if (context.grade) {
      const gradeKey = `grade${context.grade}`;
      enqueue(() => getSnapshot([
        `Platform1/rankings/country/${country}/${gradeKey}/leaderboard`,
        `rankings/country/${country}/${gradeKey}/leaderboard`,
      ], { maxAgeMs: 5 * 60 * 1000 }));

      if (context.schoolKey) {
        enqueue(() => getSnapshot([
          `Platform1/rankings/schools/${context.schoolKey}/${gradeKey}/leaderboard`,
          `rankings/schools/${context.schoolKey}/${gradeKey}/leaderboard`,
        ], { maxAgeMs: 5 * 60 * 1000 }));
      }
    }

    await Promise.allSettled(tasks);
    await AsyncStorage.setItem(APP_BOOTSTRAP_LAST_RUN_KEY, String(Date.now())).catch(() => null);
    return context;
  })().finally(() => {
    bootstrapPromise = null;
  });

  return bootstrapPromise;
}