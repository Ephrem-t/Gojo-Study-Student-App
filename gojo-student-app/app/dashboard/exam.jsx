import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
  RefreshControl,
  Dimensions,
  Modal,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get } from "firebase/database";
import { database } from "../../constants/firebaseConfig";
import { queryUserByUsernameInSchool, queryUserByChildInSchool } from "../lib/userHelpers";
import { getValue, getSnapshot } from "../lib/dbHelpers";

const { width: SCREEN_W } = Dimensions.get("window");

const PRIMARY = "#0B72FF";
const GOLD = "#F2C94C";
const SILVER = "#C0C6CC";
const BRONZE = "#D08A3A";
const BG = "#FFFFFF";
const TEXT = "#0B2540";
const MUTED = "#6B78A8";
const BORDER = "#EAF0FF";

const CARD_W = Math.round(SCREEN_W * 0.78);
const STORY_AVATAR_SIZE = 54;
const SUBJECT_CARD_W = Math.round(SCREEN_W * 0.46);
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
  const routeParams = useLocalSearchParams();

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
  const [activeFilter, setActiveFilter] = useState("online");
  const [expandedOnlineSubjectId, setExpandedOnlineSubjectId] = useState(null);

  useEffect(() => {
    const nextFilter = String(routeParams?.activeFilter || "").toLowerCase();
    if (["online", "gojo", "school"].includes(nextFilter)) {
      setActiveFilter(nextFilter);
    }
  }, [routeParams?.activeFilter]);

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
        loadLeaders(effectiveGrade),
        loadPackages(effectiveGrade),
        loadSubjectsFast({ studentId: sid, schoolKey }),
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

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
        Object.keys(val).forEach((key) => raw.push({ userId: key, rank: val[key]?.rank || 999 }));
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
      setLeaders(sameGrade.slice(0, 4));
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
      const assessmentsSnap = await get(
        ref(database, `Platform1/Schools/${schoolKey}/SchoolExams/Assessments`)
      );
      if (assessmentsSnap.exists()) assessmentsObj = assessmentsSnap.val() || {};

      const countByCourse = {};
      Object.keys(assessmentsObj).forEach((aid) => {
        const item = assessmentsObj[aid] || {};
        const cid = item.courseId;
        if (!cid) return;
        if (item.status === "removed") return;
        countByCourse[cid] = (countByCourse[cid] || 0) + 1;
      });

      const out = baseSubjects.map((c) => ({
        ...c,
        assessmentCount: countByCourse[c.courseId] || 0,
      }));

      setSubjects(out);
    } catch {
      setSubjects([]);
    }
  }, []);

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

        const pushExam = ({ examName, roundId, examId, questionBankId }) => {
          const e = String(examName || "").trim();
          if (!e) return;
          const existing = map[normalized].exams.find((x) => x.name === e);
          if (existing) {
            if (!existing.roundId) existing.roundId = roundId || null;
            if (!existing.examId) existing.examId = examId || null;
            if (!existing.questionBankId) existing.questionBankId = questionBankId || "";
          } else {
            map[normalized].exams.push({
              name: e,
              roundId: roundId || null,
              examId: examId || null,
              questionBankId: questionBankId || "",
            });
          }
        };

        const rounds = row?.rounds || {};
        Object.keys(rounds).forEach((rid) => {
          const r = rounds[rid] || {};
          pushExam({
            examName: r?.name || r?.examName || rid,
            roundId: rid,
            examId: r?.examId,
            questionBankId: r?.questionBankId,
          });
        });
      });
    });

    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [onlineExamPackages]);

  const practiceExamPackages = useMemo(
    () => packages.filter((p) => p.type === "practice"),
    [packages]
  );

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
      avatar: profile?.profileImage || null,
      grade: formatGradeLabel(details?.student),
      gender,
      school,
      region,
      city,
    });
    setProfileLoading(false);
  }, []);

  const topSection = useMemo(() => (
    <View>
      <View style={styles.storyListWrap}>
        <FlatList
          data={leaders}
          horizontal
          keyExtractor={(i) => i.userId}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, paddingRight: 44 }}
          showsHorizontalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ width: 8 }} />}
          renderItem={({ item, index }) => {
            const rank = Number(item.rank || index + 1);
            const name = item.profile?.name || item.profile?.username || item.userId;
            const avatar = item.profile?.profileImage || null;
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
                onPress={() => openTopProfile(item)}
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
              <Text style={[styles.topFilterText, active && styles.topFilterTextActive]}>{filter.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {activeFilter === "online" ? (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>National Competitive Exams</Text>
            <Text style={styles.sectionSubtitle}>Top national exam packages available for your grade</Text>
          </View>

          {onlineExamSubjects.length === 0 ? (
            <View style={styles.emptyAssessments}>
              <MaterialCommunityIcons name="trophy-outline" size={24} color={MUTED} />
              <Text style={styles.emptyAssessmentsText}>No national competitive exam subjects available right now.</Text>
            </View>
          ) : (
            <View style={styles.onlineListWrap}>
              {onlineExamSubjects.map((item) => (
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
                            In {item.packageCount} national exam{item.packageCount === 1 ? "" : "s"}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.onlineListChevronWrap}>
                      <Ionicons
                        name={expandedOnlineSubjectId === item.id ? "chevron-up" : "chevron-forward"}
                        size={16}
                        color={PRIMARY}
                      />
                    </View>
                  </TouchableOpacity>

                  {expandedOnlineSubjectId === item.id ? (
                    <View style={styles.onlineExamDropWrap}>
                      {item.exams.length ? (
                        item.exams.map((exam, idx) => (
                          <TouchableOpacity
                            key={`${item.id}-exam-${idx}`}
                            style={[styles.onlineExamDropItem, (!exam?.roundId || !exam?.examId) && styles.onlineExamDropItemDisabled]}
                            activeOpacity={0.9}
                            onPress={() => {
                              if (!exam?.roundId || !exam?.examId) return;
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
                            }}
                            disabled={!exam?.roundId || !exam?.examId}
                          >
                            <View style={styles.onlineExamDropMain}>
                              <View style={styles.onlineExamOrderBadge}>
                                <Text style={styles.onlineExamOrderText}>{idx + 1}</Text>
                              </View>
                              <View style={styles.onlineExamDropTextWrap}>
                                <Text numberOfLines={1} style={styles.onlineExamDropTitle}>{exam.name}</Text>
                                <Text numberOfLines={1} style={styles.onlineExamDropMeta}>
                                  {exam?.roundId && exam?.examId ? "Tap to start exam" : "Exam setup unavailable"}
                                </Text>
                              </View>
                            </View>
                          </TouchableOpacity>
                        ))
                      ) : (
                        <View style={styles.onlineExamDropEmptyRow}>
                          <Text style={styles.onlineExamDropEmptyText}>No exams available yet for this subject.</Text>
                        </View>
                      )}
                    </View>
                  ) : null}
                </View>
              ))}
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

                      <View style={styles.schoolBookChevronWrap}>
                        <Ionicons name="chevron-forward" size={18} color={MUTED} />
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </>
      ) : null}

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
                  <InfoRow label="Grade" value={selectedProfile?.grade || "-"} />
                  <InfoRow label="Gender" value={selectedProfile?.gender || "-"} />
                  <InfoRow label="School" value={selectedProfile?.school || "-"} />
                  <InfoRow label="Region" value={selectedProfile?.region || "-"} />
                  <InfoRow label="City" value={selectedProfile?.city || "-"} />
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
    leaders,
    onlineExamSubjects,
    practiceExamPackages,
    profileLoading,
    profileModalVisible,
    router,
    selectedProfile,
    studentGrade,
    subjects,
    openTopProfile,
  ]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={PRIMARY} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <FlatList
        data={[]}
        renderItem={null}
        ListHeaderComponent={topSection}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />}
      />
    </SafeAreaView>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  center: { alignItems: "center", justifyContent: "center" },

  topFiltersWrap: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 6,
    gap: 8,
  },
  topFilterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#DCE7FF",
    backgroundColor: "#FFFFFF",
  },
  topFilterBtnActive: {
    backgroundColor: "#EEF4FF",
    borderColor: "#BBD3FF",
  },
  topFilterText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
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
    backgroundColor: "#F7FAFF",
    borderWidth: 1,
    borderColor: "#E7F0FF",
  },
  heroBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EEF4FF",
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
    color: TEXT,
  },
  heroText: {
    marginTop: 6,
    color: MUTED,
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
  sectionTitle: { fontSize: 18, fontWeight: "900", color: TEXT },
  sectionSubtitle: { marginTop: 2, fontSize: 12, color: MUTED },

  sectionActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE7FF",
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
    backgroundColor: "#F4F7FE",
    position: "relative",
    overflow: "visible",
  },
  rankFrameGold: {
    backgroundColor: "#FFF7DF",
    borderWidth: 1,
    borderColor: "#F3D27A",
  },
  rankFrameSilver: {
    backgroundColor: "#F4F6FA",
    borderWidth: 1,
    borderColor: "#CBD3DD",
  },
  rankFrameBronze: {
    backgroundColor: "#FFF3EA",
    borderWidth: 1,
    borderColor: "#E0AE7E",
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
  rankBadgeDefault: { backgroundColor: "#DCE7FF" },
  rankBadgeGold: { backgroundColor: "#F2C94C" },
  rankBadgeSilver: { backgroundColor: "#C0C6CC" },
  rankBadgeBronze: { backgroundColor: "#D08A3A" },
  rankBottomBadgeText: { color: "#fff", fontWeight: "900", fontSize: 10 },
  storyName: { marginTop: 8, width: STORY_AVATAR_SIZE + 8, textAlign: "center", fontSize: 11, color: TEXT },

  challengeCard: {
    width: CARD_W,
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
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
    backgroundColor: "#F1F5FF",
  },
  challengeIconFallback: {
    width: 58,
    height: 58,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF4FF",
  },
  challengePill: {
    backgroundColor: "#F7FAFF",
    borderWidth: 1,
    borderColor: BORDER,
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
    color: TEXT,
  },
  challengeDesc: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
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
    backgroundColor: "#EEF4FF",
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
    borderColor: "#E5EDFF",
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
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
    borderColor: "#E6EEFF",
  },
  practiceIconFallback: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E6EEFF",
  },
  practicePill: {
    backgroundColor: "#EEF4FF",
    borderColor: "#D8E6FF",
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
    backgroundColor: "#EEF4FF",
    borderWidth: 1,
    borderColor: "#DCE8FF",
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
    borderColor: "#DCE8FF",
    backgroundColor: "#F8FBFF",
  },

  onlineListWrap: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  onlineListItemWrap: {
    marginBottom: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E7EDF8",
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
    backgroundColor: "#FCFDFF",
    borderBottomWidth: 1,
    borderBottomColor: "#EAF0FB",
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
    backgroundColor: "#F1F5FF",
  },
  onlineListIconFallback: {
    width: 56,
    height: 74,
    borderRadius: 14,
    backgroundColor: "#F7F9FC",
    borderWidth: 1,
    borderColor: "#EEF2F8",
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
    color: TEXT,
    fontSize: 17,
    fontWeight: "900",
  },
  practiceListTitle: {
    color: TEXT,
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
    backgroundColor: "#F4F7FD",
    borderWidth: 1,
    borderColor: "#E7EDF8",
  },
  practiceListMetaChip: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#F4F7FD",
    borderWidth: 1,
    borderColor: "#E7EDF8",
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
    borderColor: "#E5ECFA",
    backgroundColor: "#F8FBFF",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  onlineExamDropWrap: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: "#F8FBFF",
  },
  onlineExamDropItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#E4ECFA",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.018,
    shadowRadius: 6,
    elevation: 0,
  },
  onlineExamDropItemDisabled: {
    opacity: 0.55,
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
    backgroundColor: "#EEF4FF",
    borderWidth: 1,
    borderColor: "#D8E7FF",
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
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
  },
  onlineExamDropMeta: {
    marginTop: 2,
    color: MUTED,
    fontSize: 11,
    fontWeight: "600",
  },
  onlineExamDropEmptyRow: {
    paddingVertical: 10,
  },
  onlineExamDropEmptyText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "600",
  },

  competitiveCard: {
    width: CARD_W,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E7EDF8",
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
    backgroundColor: "#F1F5FF",
  },
  competitiveIconFallback: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF4FF",
  },
  competitiveChevronWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DCE7FF",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  competitiveTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: "900",
    color: TEXT,
  },
  competitiveDesc: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
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
    backgroundColor: "#EEF4FF",
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
    borderColor: BORDER,
    backgroundColor: "#F9FBFF",
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  emptyAssessmentsText: { color: MUTED, fontSize: 13, fontWeight: "600" },

  schoolListWrap: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  schoolBookCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E7EDF8",
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
    backgroundColor: "#F7F9FC",
    borderWidth: 1,
    borderColor: "#EEF2F8",
  },
  schoolBookTextWrap: {
    marginLeft: 12,
    flex: 1,
  },
  schoolBookTitle: {
    fontWeight: "900",
    fontSize: 17,
    color: TEXT,
  },
  schoolBookSub: {
    color: "#667085",
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
    backgroundColor: "#F4F7FD",
    borderWidth: 1,
    borderColor: "#E7EDF8",
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
  },
  schoolBookChevronWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5ECFA",
    backgroundColor: "#F8FBFF",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },

  profileModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  profileModalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E6EEFD",
  },
  profileHero: {
    alignItems: "center",
    paddingBottom: 6,
  },
  modalAvatar: { width: 78, height: 78, borderRadius: 39 },
  modalName: {
    marginTop: 12,
    fontWeight: "900",
    color: TEXT,
    fontSize: 19,
    textAlign: "center",
  },
  modalRankBadge: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#EEF4FF",
    borderWidth: 1,
    borderColor: "#DDE9FF",
  },
  modalRank: { color: PRIMARY, fontWeight: "800", fontSize: 12 },
  infoGrid: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#E7EDF8",
    borderRadius: 14,
    overflow: "hidden",
  },
  infoRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF3FB",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoLabel: { color: MUTED, fontSize: 12, fontWeight: "700" },
  infoValue: { color: TEXT, fontSize: 12, fontWeight: "800", flexShrink: 1, textAlign: "right" },
  closeBtn: {
    marginTop: 12,
    height: 42,
    borderRadius: 12,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});