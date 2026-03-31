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
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const MUTED = colors.muted;

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
  const [topTiePickerVisible, setTopTiePickerVisible] = useState(false);
  const [topTieCandidates, setTopTieCandidates] = useState([]);
  const [topTieRank, setTopTieRank] = useState(null);
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
      avatar: extractProfileImage(profile),
      grade: formatGradeLabel(details?.student),
      gender,
      school,
      region,
      city,
    });
    setProfileLoading(false);
  }, []);

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

  const topSection = useMemo(() => (
    <View>
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
    leaders,
    onlineExamSubjects,
    practiceExamPackages,
    profileLoading,
    profileModalVisible,
    router,
    selectedProfile,
    studentGrade,
    subjects,
    topTieCandidates,
    topTiePickerVisible,
    topTieRank,
    topRankGroups,
    handleTopRankPress,
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
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  topFilterBtnActive: {
    backgroundColor: colors.soft,
    borderColor: colors.primary,
  },
  topFilterText: {
    color: colors.muted,
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
  schoolBookChevronWrap: {
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
}