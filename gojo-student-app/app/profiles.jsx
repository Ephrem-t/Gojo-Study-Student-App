import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ScrollView,
  TextInput,
  Modal,
  ActivityIndicator,
  Animated,
  Dimensions,
  PanResponder,
  Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import { database, storage } from "../constants/firebaseConfig";
import { ref, get, update, remove } from "firebase/database";
import { ref as stRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAppTheme } from "../hooks/use-app-theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const PRIMARY = "#007AFB";
const BG = "#FFFFFF";
const CARD = "#FFFFFF";
const TEXT = "#0B2540";
const MUTED = "#6B78A8";
const BORDER = "#E7EEFF";
const SOFT = "#EEF5FF";
const SUCCESS = "#12B76A";
const DANGER = "#EF4444";

const AVATAR_PLACEHOLDER = require("../assets/images/avatar_placeholder.png");

const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function normalizeProfileImageUri(value) {
  if (!value || typeof value !== "string") return null;
  const uri = value.trim();
  if (!uri) return null;

  if (/^https?:\/\//i.test(uri)) return uri;
  if (/^data:image\//i.test(uri)) return uri;
  if (/^blob:/i.test(uri) && Platform.OS === "web") return uri;
  if (/^file:\/\//i.test(uri)) return null;

  return null;
}

async function uploadProfileImageAsync({ uri, userNodeKey, studentNodeKey }) {
  const response = await fetch(uri);
  const blob = await response.blob();
  const ownerKey = userNodeKey || studentNodeKey || "student";
  const extMatch = String(uri).match(/\.(jpg|jpeg|png|webp)(?:\?|$)/i);
  const ext = extMatch?.[1]?.toLowerCase() || "jpg";
  const path = `profile-images/${ownerKey}/${Date.now()}.${ext}`;
  const storageRef = stRef(storage, path);

  await uploadBytes(storageRef, blob, {
    contentType: blob.type || `image/${ext === "jpg" ? "jpeg" : ext}`,
  });

  return getDownloadURL(storageRef);
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatNoteDate(value) {
  if (!value) return "Recently updated";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "Recently updated";
  }
}

function upcomingWithinDays(events, days = 30) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const max = new Date(now);
  max.setDate(now.getDate() + days);

  return (events || [])
    .filter((e) => {
      if (!e?.gregorianDate) return false;
      const d = new Date(e.gregorianDate);
      d.setHours(0, 0, 0, 0);
      return d >= now && d <= max;
    })
    .sort((a, b) => new Date(a.gregorianDate || 0) - new Date(b.gregorianDate || 0));
}

function getTodayDayName() {
  return new Date().toLocaleDateString("en-US", { weekday: "long" });
}

function getCategoryColor(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("exam")) return "#DC2626";
  if (s.includes("holiday")) return "#16A34A";
  if (s.includes("academic")) return PRIMARY;
  if (s.includes("event")) return "#0EA5E9";
  return MUTED;
}

function getCategoryLabel(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("exam")) return "Exam";
  if (s.includes("holiday")) return "Holiday";
  if (s.includes("academic")) return "Academic";
  if (s.includes("event")) return "Event";
  return "General";
}

function extractGradeNumber(v) {
  const m = String(v || "").match(/(\d+)/);
  return m ? m[1] : String(v || "").trim();
}

function normalizeSection(v) {
  return String(v || "").trim().toUpperCase();
}

function buildGradeSectionKey(grade, section) {
  const g = extractGradeNumber(grade);
  const s = normalizeSection(section);
  if (!g || !s) return "";
  return `Grade ${g}${s}`;
}

function sortPeriods(entries) {
  return [...entries].sort((a, b) => {
    const aNum = Number(String(a.period || "").match(/P(\d+)/)?.[1] || 999);
    const bNum = Number(String(b.period || "").match(/P(\d+)/)?.[1] || 999);
    return aNum - bNum;
  });
}

function normalizeGradeKey(v) {
  if (!v) return "";
  const s = String(v).toLowerCase().replace("grade", "").trim();
  return s ? `grade${s}` : "";
}

function titleize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getSubjectIcon(subjectName) {
  const name = (subjectName || "").toLowerCase();
  if (name.includes("math") || name.includes("mathematics")) return "calculator-outline";
  if (name.includes("science")) return "flask-outline";
  if (name.includes("english") || name.includes("language")) return "book-outline";
  if (name.includes("history") || name.includes("social")) return "globe-outline";
  if (name.includes("biology")) return "leaf-outline";
  if (name.includes("chemistry")) return "color-wand-outline";
  if (name.includes("physics")) return "flash-outline";
  if (name.includes("geography")) return "map-outline";
  if (name.includes("computer") || name.includes("ict")) return "laptop-outline";
  if (name.includes("art")) return "palette-outline";
  if (name.includes("music")) return "musical-notes-outline";
  if (name.includes("physical") || name.includes("pe") || name.includes("sport")) return "fitness-outline";
  return "library-outline";
}

function getSubjectColor(subjectName) {
  const name = (subjectName || "").toLowerCase();
  if (name.includes("math") || name.includes("mathematics")) return "#FF6B6B";
  if (name.includes("science")) return "#4ECDC4";
  if (name.includes("english") || name.includes("language")) return "#45B7D1";
  if (name.includes("history") || name.includes("social")) return "#96CEB4";
  if (name.includes("biology")) return "#88D8B0";
  if (name.includes("chemistry")) return "#FFB74D";
  if (name.includes("physics")) return "#64B5F6";
  if (name.includes("geography")) return "#81C784";
  if (name.includes("computer") || name.includes("ict")) return "#9575CD";
  if (name.includes("art")) return "#F06292";
  if (name.includes("music")) return "#BA68C8";
  if (name.includes("physical") || name.includes("pe") || name.includes("sport")) return "#4DB6AC";
  return "#90A4AE";
}

function normalizeChapterNotes(value) {
  if (!value || typeof value !== "object") return [];

  const nestedNotes = value.notes && typeof value.notes === "object"
    ? Object.entries(value.notes)
        .map(([noteId, note]) => ({ ...(note || {}), noteId }))
        .filter((note) => typeof note === "object")
    : [];

  if (typeof value.text === "string" || typeof value.title === "string") {
    return [{ ...value, noteId: value.noteId || "legacy" }, ...nestedNotes];
  }

  return nestedNotes.length
    ? nestedNotes
    : Object.entries(value)
        .map(([noteId, note]) => ({ ...(note || {}), noteId }))
        .filter((note) => typeof note === "object" && (typeof note.text === "string" || typeof note.title === "string"));
}

async function getGroupedStudentNotes(schoolCode, grade, candidateStudentIds) {
  const gradeKey = normalizeGradeKey(grade);
  const ids = Array.from(new Set((candidateStudentIds || []).filter(Boolean).map((value) => String(value).trim())));

  if (!schoolCode || !gradeKey || !ids.length) return [];

  try {
    let notesRoot = null;
    let ownerId = null;

    for (const id of ids) {
      const snap = await get(ref(database, `Platform1/Schools/${schoolCode}/StudentBookNotes/${id}/${gradeKey}`)).catch(() => null);
      if (snap?.exists()) {
        notesRoot = snap.val() || {};
        ownerId = id;
        break;
      }
    }

    if (!notesRoot || !ownerId) return [];

    const booksSnap = await get(ref(database, `Platform1/TextBooks/${gradeKey}`)).catch(() => null);
    const booksMap = booksSnap?.exists() ? booksSnap.val() || {} : {};

    return Object.keys(notesRoot)
      .map((subjectKey) => {
        const subjectNode = notesRoot[subjectKey] || {};
        const subjectMeta = booksMap[subjectKey] || {};
        const subjectTitle = subjectMeta.title || titleize(subjectKey);
        const subjectNotes = [];

        Object.keys(subjectNode).forEach((unitKey) => {
          const unitValue = subjectNode[unitKey] || {};
          const unitMeta = subjectMeta.units?.[unitKey] || {};
          const unitTitle = unitMeta.title || titleize(unitKey);

          normalizeChapterNotes(unitValue)
            .sort((a, b) => {
              const ap = a?.pinned ? 1 : 0;
              const bp = b?.pinned ? 1 : 0;
              if (ap !== bp) return bp - ap;
              return (b?.updatedAt || b?.createdAt || 0) - (a?.updatedAt || a?.createdAt || 0);
            })
            .forEach((note) => {
              const title = String(note?.title || "").trim() || `${unitTitle} Note`;
              const preview = String(note?.text || "").trim();

              if (!title && !preview) return;

              subjectNotes.push({
                ownerId,
                subjectKey,
                subjectTitle,
                unitKey,
                unitTitle,
                noteId: note?.noteId || "",
                title,
                text: preview,
                preview,
                pinned: !!note?.pinned,
                colorTag: note?.colorTag || "#F8FBFF",
                updatedAt: note?.updatedAt || note?.createdAt || 0,
              });
            });
        });

        return {
          subjectKey,
          subjectTitle,
          notes: subjectNotes,
        };
      })
      .filter((section) => section.notes.length > 0);
  } catch (error) {
    console.warn("Grouped notes lookup error:", error);
    return [];
  }
}

async function getCountryRankForStudent(grade, candidateIds) {
  const normalizedGrade = extractGradeNumber(grade);
  const ids = Array.from(new Set((candidateIds || []).filter(Boolean).map((value) => String(value).trim())));

  if (!normalizedGrade || !ids.length) return null;

  try {
    let country = "Ethiopia";

    try {
      const countrySnap = await get(ref(database, "Platform1/country"));
      if (countrySnap.exists()) country = countrySnap.val() || country;
    } catch {}

    if (!country || typeof country !== "string") country = "Ethiopia";

    const gradeKey = `grade${normalizedGrade}`;
    const paths = [
      `Platform1/rankings/country/${country}/${gradeKey}/leaderboard`,
      `rankings/country/${country}/${gradeKey}/leaderboard`,
    ];

    for (const path of paths) {
      const snap = await get(ref(database, path)).catch(() => null);
      if (!snap?.exists()) continue;

      const leaderboard = snap.val() || {};
      for (const id of ids) {
        const row = leaderboard[id];
        const rank = Number(row?.rank || 0);
        if (rank > 0 && rank <= 10) {
          return { rank, country };
        }
      }
    }
  } catch (error) {
    console.warn("Country rank lookup error:", error);
  }

  return null;
}

async function getSchoolRankForStudent(grade, schoolKey, candidateIds) {
  const normalizedGrade = extractGradeNumber(grade);
  const ids = Array.from(new Set((candidateIds || []).filter(Boolean).map((value) => String(value).trim())));

  if (!normalizedGrade || !schoolKey || !ids.length) return null;

  try {
    const gradeKey = `grade${normalizedGrade}`;
    const paths = [
      `Platform1/rankings/schools/${schoolKey}/${gradeKey}/leaderboard`,
      `rankings/schools/${schoolKey}/${gradeKey}/leaderboard`,
      `Platform1/rankings/schools/${schoolKey}/${gradeKey}`,
      `rankings/schools/${schoolKey}/${gradeKey}`,
    ];

    for (const path of paths) {
      const snap = await get(ref(database, path)).catch(() => null);
      if (!snap?.exists()) continue;

      const raw = snap.val() || {};
      const leaderboard = raw?.leaderboard || raw;

      for (const id of ids) {
        const row = leaderboard[id];
        const rank = Number(row?.rank || 0);
        if (rank > 0 && rank <= 10) {
          return { rank, schoolKey };
        }
      }
    }
  } catch (error) {
    console.warn("School rank lookup error:", error);
  }

  return null;
}

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, statusBarStyle } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const scrollY = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;

  const [loading, setLoading] = useState(true);
  const [savingPhoto, setSavingPhoto] = useState(false);

  const [schoolKey, setSchoolKey] = useState(null);
  const [userNodeKey, setUserNodeKey] = useState(null);
  const [studentNodeKey, setStudentNodeKey] = useState(null);

  const [profile, setProfile] = useState({
    name: "",
    username: "",
    role: "student",
    profileImage: null,
    grade: "",
    section: "",
    studentId: "",
  });

  const [calendarEvents, setCalendarEvents] = useState([]);
  const [scheduleMap, setScheduleMap] = useState({});
  const [scheduleVisible, setScheduleVisible] = useState(false);
  const [countryRank, setCountryRank] = useState(null);
  const [schoolRank, setSchoolRank] = useState(null);

  const [pwdModal, setPwdModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [profileSectionTab, setProfileSectionTab] = useState("main");
  const [noteSections, setNoteSections] = useState([]);
  const [expandedNoteSubjects, setExpandedNoteSubjects] = useState({});
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteReader, setNoteReader] = useState({ visible: false, note: null });
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const sk = await AsyncStorage.getItem("schoolKey");
      const uKey = (await AsyncStorage.getItem("userNodeKey")) || null;
      const sKey =
        (await AsyncStorage.getItem("studentNodeKey")) ||
        (await AsyncStorage.getItem("studentId")) ||
        null;

      setSchoolKey(sk);
      setUserNodeKey(uKey);
      setStudentNodeKey(sKey);
      setCountryRank(null);
      setSchoolRank(null);
      setNoteSections([]);

      let grade = "";
      let section = "";
      let studentId = "";

      if (sk && uKey) {
        const us = await get(ref(database, `Platform1/Schools/${sk}/Users/${uKey}`));
        const userVal = us.exists() ? us.val() : null;

        let studentVal = null;
        if (sKey) {
          const ss = await get(ref(database, `Platform1/Schools/${sk}/Students/${sKey}`));
          if (ss.exists()) studentVal = ss.val();
        }

        grade = studentVal?.grade || studentVal?.basicStudentInformation?.grade || "";
        section = studentVal?.section || studentVal?.basicStudentInformation?.section || "";
        studentId = studentVal?.studentId || sKey || "";

        setProfile({
          name: userVal?.name || studentVal?.name || "Student",
          username: userVal?.username || studentVal?.studentId || "",
          role: userVal?.role || "student",
          profileImage: normalizeProfileImageUri(userVal?.profileImage || studentVal?.profileImage || null),
          grade,
          section,
          studentId,
        });

        const rankInfo = await getCountryRankForStudent(grade, [
          studentId,
          sKey,
          userVal?.username,
          studentVal?.studentId,
          uKey,
        ]);
        setCountryRank(rankInfo);

        const schoolRankInfo = await getSchoolRankForStudent(grade, sk, [
          studentId,
          sKey,
          userVal?.username,
          studentVal?.studentId,
          uKey,
        ]);
        setSchoolRank(schoolRankInfo);

        setNotesLoading(true);
        const groupedNotes = await getGroupedStudentNotes(sk, grade, [
          sKey,
          studentId,
          userVal?.username,
          studentVal?.studentId,
          uKey,
        ]);
        setNoteSections(groupedNotes);
        setExpandedNoteSubjects(
          groupedNotes.reduce((acc, section, index) => {
            acc[section.subjectKey] = index === 0;
            return acc;
          }, {})
        );
        setNotesLoading(false);
      }

      if (sk) {
        const [evSnap, schedSnap] = await Promise.all([
          get(ref(database, `Platform1/Schools/${sk}/CalendarEvents`)).catch(() => null),
          get(ref(database, `Platform1/Schools/${sk}/Schedules`)).catch(() => null),
        ]);

        const arr = [];
        if (evSnap?.exists()) {
          evSnap.forEach((c) => {
            arr.push({ id: c.key, ...(c.val() || {}) });
          });
        }
        arr.sort((a, b) => new Date(a.gregorianDate || 0) - new Date(b.gregorianDate || 0));
        setCalendarEvents(arr);

        const nextSchedule = {};
        if (schedSnap?.exists()) {
          const raw = schedSnap.val() || {};
          Object.keys(raw).forEach((day) => {
            const gradeSectionKey = buildGradeSectionKey(grade, section);
            const dayNode = raw[day] || {};
            const selected = dayNode[gradeSectionKey] || {};

            nextSchedule[day] = sortPeriods(
              Object.keys(selected).map((period) => ({
                period,
                ...(selected[period] || {}),
              }))
            );
          });
        }
        setScheduleMap(nextSchedule);
      }
    } catch (e) {
      console.warn("Profile fetch error:", e);
      Alert.alert("Error", "Unable to load profile.");
    } finally {
      setNotesLoading(false);
      setLoading(false);
    }
  }, []);

  const openProfileNoteEditor = useCallback((note) => {
    if (!note?.ownerId || !note?.subjectKey || !note?.unitKey) return;

    router.push({
      pathname: "/chapterNote",
      params: {
        schoolCode: schoolKey,
        studentId: note.ownerId,
        grade: profile.grade,
        subjectKey: note.subjectKey,
        subjectTitle: note.subjectTitle,
        unitKey: note.unitKey,
        unitTitle: note.unitTitle,
        noteId: note.noteId || "",
      },
    });
  }, [profile.grade, router, schoolKey]);

  const openProfileNoteReader = useCallback((note) => {
    if (!note) return;
    setNoteReader({ visible: true, note });
  }, []);

  const closeProfileNoteReader = useCallback(() => {
    setNoteReader({ visible: false, note: null });
  }, []);

  const openProfileNoteEditorFromReader = useCallback(() => {
    if (!noteReader.note) return;
    const note = noteReader.note;
    closeProfileNoteReader();
    requestAnimationFrame(() => openProfileNoteEditor(note));
  }, [closeProfileNoteReader, noteReader.note, openProfileNoteEditor]);

  const refreshGroupedNotes = useCallback(async () => {
    if (!schoolKey || !profile.grade) return;

    setNotesLoading(true);
    try {
      const groupedNotes = await getGroupedStudentNotes(schoolKey, profile.grade, [
        studentNodeKey,
        profile.studentId,
        profile.username,
        userNodeKey,
      ]);

      setNoteSections(groupedNotes);
      setExpandedNoteSubjects((prev) => {
        const next = {};
        groupedNotes.forEach((section, index) => {
          next[section.subjectKey] = prev[section.subjectKey] ?? index === 0;
        });
        return next;
      });
    } finally {
      setNotesLoading(false);
    }
  }, [profile.grade, profile.studentId, profile.username, schoolKey, studentNodeKey, userNodeKey]);

  const deleteProfileNote = useCallback(async (note) => {
    if (!schoolKey || !profile.grade || !note?.ownerId || !note?.subjectKey || !note?.unitKey) return;

    const gradeKey = normalizeGradeKey(profile.grade);
    const unitPath = `Platform1/Schools/${schoolKey}/StudentBookNotes/${note.ownerId}/${gradeKey}/${note.subjectKey}/${note.unitKey}`;
    const noteId = note.noteId || "";

    try {
      if (noteId === "legacy") {
        await update(ref(database, unitPath), {
          noteId: null,
          studentId: null,
          gradeKey: null,
          subjectKey: null,
          unitKey: null,
          title: null,
          text: null,
          pinned: null,
          colorTag: null,
          createdAt: null,
          updatedAt: null,
        });
      } else {
        await remove(ref(database, `${unitPath}/notes/${noteId}`));
      }

      if (noteReader.note?.noteId === note.noteId && noteReader.note?.unitKey === note.unitKey) {
        closeProfileNoteReader();
      }

      await refreshGroupedNotes();
    } catch {
      Alert.alert("Delete failed", "Could not remove this note.");
    }
  }, [closeProfileNoteReader, noteReader.note, profile.grade, refreshGroupedNotes, schoolKey]);

  const toggleNoteSubject = useCallback((subjectKey) => {
    setExpandedNoteSubjects((prev) => ({
      ...prev,
      [subjectKey]: !prev[subjectKey],
    }));
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const upcoming = useMemo(() => upcomingWithinDays(calendarEvents, 30), [calendarEvents]);
  const todayDay = getTodayDayName();
  const todaySchedule = scheduleMap[todayDay] || [];
  const usernameHandle = useMemo(() => {
    const raw = String(profile.username || "").trim();
    if (!raw) return "@student";
    return raw.startsWith("@") ? raw : `@${raw}`;
  }, [profile.username]);

  const gradeSection = useMemo(() => {
    const g = extractGradeNumber(profile.grade);
    const s = normalizeSection(profile.section);
    if (!g && !s) return "--";
    return `${g}${s}`;
  }, [profile.grade, profile.section]);

  const avatarUri = useMemo(() => normalizeProfileImageUri(profile.profileImage), [profile.profileImage]);

  const handleProfileBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/dashboard/home");
  }, [router]);

  const openScheduleSheet = useCallback(() => {
    setScheduleVisible(true);
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

  const closeScheduleSheet = useCallback(() => {
    Animated.timing(sheetAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setScheduleVisible(false);
    });
  }, [sheetAnim]);

  const pickAndSavePhoto = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission required", "Please allow gallery access.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1],
      });

      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;

      setSavingPhoto(true);
      const uploadedUrl = await uploadProfileImageAsync({
        uri,
        userNodeKey,
        studentNodeKey,
      });

      if (schoolKey && userNodeKey) {
        await update(ref(database, `Platform1/Schools/${schoolKey}/Users/${userNodeKey}`), {
          profileImage: uploadedUrl,
        });
      }

      if (schoolKey && studentNodeKey) {
        await update(ref(database, `Platform1/Schools/${schoolKey}/Students/${studentNodeKey}`), {
          profileImage: uploadedUrl,
        });
      }

      setProfile((p) => ({ ...p, profileImage: uploadedUrl }));
      Alert.alert("Updated", "Profile photo updated.");
    } catch (e) {
      console.warn("pickAndSavePhoto error:", e);
      Alert.alert("Error", "Could not update profile photo.");
    } finally {
      setSavingPhoto(false);
    }
  }, [schoolKey, studentNodeKey, userNodeKey]);

  const savePassword = useCallback(async () => {
    if (!newPwd || newPwd.length < 4) {
      return Alert.alert("Invalid", "Password must be at least 4 characters.");
    }
    if (newPwd !== confirmPwd) {
      return Alert.alert("Mismatch", "Passwords do not match.");
    }

    try {
      setSavingPwd(true);
      if (!schoolKey || !userNodeKey) throw new Error("Missing user info");

      await update(ref(database, `Platform1/Schools/${schoolKey}/Users/${userNodeKey}`), {
        password: newPwd,
      });

      if (studentNodeKey) {
        await update(
          ref(database, `Platform1/Schools/${schoolKey}/Students/${studentNodeKey}/systemAccountInformation`),
          { temporaryPassword: newPwd }
        );
      }

      setPwdModal(false);
      setNewPwd("");
      setConfirmPwd("");
      Alert.alert("Success", "Password updated.");
    } catch (e) {
      console.warn("savePassword error:", e);
      Alert.alert("Error", "Could not update password.");
    } finally {
      setSavingPwd(false);
    }
  }, [newPwd, confirmPwd, schoolKey, userNodeKey, studentNodeKey]);

  const openEditProfileMenu = useCallback(() => {
    setEditModal(true);
  }, []);

  const pullY = scrollY.interpolate({
    inputRange: [-220, 0],
    outputRange: [220, 0],
    extrapolate: "clamp",
  });

  const stretchHeight = pullY.interpolate({
    inputRange: [0, 220],
    outputRange: [0, 300],
    extrapolate: "clamp",
  });

  const stretchOpacity = pullY.interpolate({
    inputRange: [0, 30, 220],
    outputRange: [0, 0.35, 1],
    extrapolate: "clamp",
  });

  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [700, 0],
  });

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={statusBarStyle} backgroundColor={colors.background} />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.stretchContainer,
          {
            height: stretchHeight,
            opacity: stretchOpacity,
          },
        ]}
      >
        <View style={styles.stretchFill} />
      </Animated.View>

      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
        })}
        scrollEventThrottle={16}
        bounces
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroBanner}>
            <View style={styles.heroBannerFallback}>
              <View style={styles.heroBannerOrbPrimary} />
              <View style={styles.heroBannerOrbSecondary} />
            </View>
            <View style={styles.heroBannerOverlay} />

            <View style={styles.heroTopBar}>
              <TouchableOpacity style={styles.heroTopIconBtn} onPress={handleProfileBack}>
                <Ionicons name="chevron-back" size={20} color={colors.white} />
              </TouchableOpacity>

              <Text style={styles.heroTopTitle}>Profile</Text>

              <View style={styles.heroTopActions}>
                <View style={styles.heroQuickStats}>
                  {schoolRank?.rank ? (
                    <MiniPill
                      icon="podium-gold"
                      text={`S#${schoolRank.rank}`}
                      styles={styles}
                      onPress={() => router.push({ pathname: "/leaderboard", params: { scope: "school" } })}
                    />
                  ) : null}
                  {countryRank?.rank ? (
                    <MiniPill
                      icon="trophy-outline"
                      text={`#${countryRank.rank}`}
                      styles={styles}
                      onPress={() => router.push({ pathname: "/leaderboard", params: { scope: "country" } })}
                    />
                  ) : null}
                </View>

                <TouchableOpacity style={styles.heroTopIconBtn} onPress={() => router.push("/setting")}>
                  <MaterialCommunityIcons name="cog-outline" size={18} color={colors.white} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.heroAvatarSlot}>
            <View style={styles.avatarWrap}>
              <Image
                source={avatarUri ? { uri: avatarUri } : AVATAR_PLACEHOLDER}
                style={styles.avatar}
              />
              <TouchableOpacity style={styles.editAvatarBtn} onPress={pickAndSavePhoto} disabled={savingPhoto}>
                {savingPhoto ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Ionicons name="camera" size={16} color={colors.white} />
                )}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.heroIdentityBlock}>
            <View style={styles.identityTopRow}>
              <Text style={styles.name}>{profile.name}</Text>
            </View>
            <View style={styles.subRow}>
              <Text style={styles.subText}>{usernameHandle}</Text>
              {gradeSection && gradeSection !== "--" ? (
                <MiniPill icon="school-outline" text={gradeSection} compact styles={styles} />
              ) : null}
            </View>
            <TouchableOpacity style={styles.editProfileBtn} onPress={openEditProfileMenu} activeOpacity={0.88}>
              <Text style={styles.editProfileText}>Edit Profile</Text>
            </TouchableOpacity>

            <View style={styles.profileFilterRow}>
              <TouchableOpacity
                style={[styles.profileFilterBtn, profileSectionTab === "main" && styles.profileFilterBtnActive]}
                onPress={() => setProfileSectionTab("main")}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.profileFilterText,
                    profileSectionTab === "main" && styles.profileFilterTextActive,
                  ]}
                >
                  Main
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.profileFilterBtn, profileSectionTab === "note" && styles.profileFilterBtnActive]}
                onPress={() => setProfileSectionTab("note")}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.profileFilterText,
                    profileSectionTab === "note" && styles.profileFilterTextActive,
                  ]}
                >
                  My Note
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {profileSectionTab === "main" ? (
          <>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Today at school</Text>

          <TouchableOpacity style={styles.scheduleCard} activeOpacity={0.9} onPress={openScheduleSheet}>
            <View style={styles.scheduleTop}>
              <View style={styles.scheduleIconWrap}>
                <Ionicons name="time-outline" size={18} color={PRIMARY} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.scheduleTitle}>{todayDay} Schedule</Text>
                <Text style={styles.scheduleSub}>
                  {todaySchedule.length
                    ? `${todaySchedule.length} period${todaySchedule.length === 1 ? "" : "s"} today`
                    : "No scheduled periods for today"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={MUTED} />
            </View>

            {todaySchedule.length ? (
              <View style={styles.schedulePreviewWrap}>
                {todaySchedule.slice(0, 3).map((item) => (
                  <View key={item.period} style={styles.previewRow}>
                    <Text style={styles.previewPeriod}>{item.period}</Text>
                    <Text numberOfLines={1} style={styles.previewSubject}>
                      {item.subject || "Free Period"}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </TouchableOpacity>

          <ActionRow
            icon="calendar-outline"
            title="School calendar"
            subtitle="See upcoming events in a cleaner view"
            onPress={() => router.push("./calendar")}
            styles={styles}
            colors={colors}
          />
        </View>

          </>
        ) : (
          <View style={styles.card}>
            {notesLoading ? (
              <View style={styles.noteStateCard}>
                <ActivityIndicator color={PRIMARY} />
                <Text style={styles.noteStateText}>Loading notes...</Text>
              </View>
            ) : noteSections.length ? (
              noteSections.map((section) => (
                <View key={section.subjectKey} style={[styles.noteSubjectCard, expandedNoteSubjects[section.subjectKey] && styles.noteSubjectCardSelected]}>
                  <TouchableOpacity
                    style={[styles.noteSubjectHeader, expandedNoteSubjects[section.subjectKey] && styles.noteSubjectHeaderExpanded]}
                    activeOpacity={0.92}
                    onPress={() => toggleNoteSubject(section.subjectKey)}
                  >
                    <View style={styles.noteSubjectHeaderLeft}>
                      <View style={[styles.noteSubjectCover, styles.noteSubjectIconContainer]}>
                        <Ionicons
                          name={getSubjectIcon(section.subjectTitle)}
                          size={26}
                          color={getSubjectColor(section.subjectTitle)}
                        />
                      </View>
                      <View style={styles.noteSubjectInfoWrap}>
                        <Text style={styles.noteSubjectName}>{section.subjectTitle}</Text>
                        <Text style={styles.noteSubjectSub}>
                          {section.notes.length} note{section.notes.length === 1 ? "" : "s"}
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.noteSubjectToggle, expandedNoteSubjects[section.subjectKey] && styles.noteSubjectToggleActive]}>
                      <Ionicons
                        name={expandedNoteSubjects[section.subjectKey] ? "chevron-up" : "chevron-down"}
                        size={16}
                        color={expandedNoteSubjects[section.subjectKey] ? PRIMARY : MUTED}
                      />
                    </View>
                  </TouchableOpacity>

                  {expandedNoteSubjects[section.subjectKey] ? (
                    <View style={styles.noteUnitsContainer}>
                      {section.notes.map((note) => (
                        <SwipeableProfileNoteCard
                          key={`${section.subjectKey}-${note.unitKey}-${note.noteId || note.title}`}
                          note={note}
                          onOpen={() => openProfileNoteReader(note)}
                          onEdit={() => openProfileNoteEditor(note)}
                          onDelete={() =>
                            Alert.alert("Delete note", "Remove this note from your list?", [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Delete",
                                style: "destructive",
                                onPress: () => deleteProfileNote(note),
                              },
                            ])
                          }
                          styles={styles}
                          colors={colors}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              ))
            ) : (
              <View style={styles.noteStateCard}>
                <Ionicons name="document-text-outline" size={18} color={MUTED} />
                <Text style={styles.noteStateText}>No saved notes yet.</Text>
              </View>
            )}
          </View>
        )}

      </Animated.ScrollView>

      <Modal visible={editModal} transparent animationType="fade" onRequestClose={() => setEditModal(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Profile</Text>

            <TouchableOpacity
              style={styles.editOptionBtn}
              onPress={() => {
                setEditModal(false);
                requestAnimationFrame(() => pickAndSavePhoto());
              }}
            >
              <Ionicons name="image-outline" size={18} color={TEXT} />
              <Text style={styles.editOptionText}>Change Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.editOptionBtn}
              onPress={() => {
                setEditModal(false);
                requestAnimationFrame(() => setPwdModal(true));
              }}
            >
              <Ionicons name="key-outline" size={18} color={TEXT} />
              <Text style={styles.editOptionText}>Change Password</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.editOptionBtn, styles.editOptionCancel]} onPress={() => setEditModal(false)}>
              <Ionicons name="close-outline" size={18} color={MUTED} />
              <Text style={[styles.editOptionText, styles.editOptionCancelText]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={pwdModal} transparent animationType="fade" onRequestClose={() => setPwdModal(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Change Password</Text>

            <TextInput
              value={newPwd}
              onChangeText={setNewPwd}
              placeholder="New password"
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
            />
            <TextInput
              value={confirmPwd}
              onChangeText={setConfirmPwd}
              placeholder="Confirm password"
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={() => setPwdModal(false)} disabled={savingPwd}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.saveBtn]} onPress={savePassword} disabled={savingPwd}>
                {savingPwd ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={noteReader.visible} animationType="slide" onRequestClose={closeProfileNoteReader}>
        <SafeAreaView style={styles.noteReaderScreen}>
          <View style={styles.noteReaderTopBar}>
            <TouchableOpacity style={styles.noteReaderIconBtn} onPress={closeProfileNoteReader}>
              <Ionicons name="arrow-back" size={20} color={TEXT} />
            </TouchableOpacity>

            <View style={styles.noteReaderTopText}>
              <Text numberOfLines={1} style={styles.noteReaderUnitTitle}>
                {noteReader.note?.title || "Chapter Note"}
              </Text>
              <Text numberOfLines={1} style={styles.noteReaderTopSubtitle}>
                {noteReader.note?.subjectTitle || "Subject"}
              </Text>
            </View>

            <TouchableOpacity style={styles.noteReaderEditBtn} onPress={openProfileNoteEditorFromReader}>
              <Text style={styles.noteReaderEditText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.noteReaderScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.noteReaderHero}>
              <View style={styles.noteReaderHeaderRow}>
                <View style={styles.noteReaderTypePill}>
                  <Ionicons name="time-outline" size={12} color={PRIMARY} />
                  <Text style={styles.noteReaderTypeText}>
                    {formatNoteDate(noteReader.note?.updatedAt || noteReader.note?.createdAt)}
                  </Text>
                </View>

                {noteReader.note?.pinned ? (
                  <View style={styles.noteReaderPinnedPill}>
                    <Ionicons name="pin" size={12} color={PRIMARY} />
                    <Text style={styles.noteReaderPinnedText}>Pinned</Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.noteReaderTitle}>
                {noteReader.note?.title || `${noteReader.note?.unitTitle || "Chapter"} Note`}
              </Text>
            </View>

            <View style={[styles.noteReaderBodyCard, { backgroundColor: noteReader.note?.colorTag || "#F8FBFF" }]}>
              <View style={styles.noteReaderBodyHeader}>
                <Ionicons name="create-outline" size={15} color={PRIMARY} />
                <Text style={styles.noteReaderBodyLabel}>Note Content</Text>
              </View>
              <View style={styles.noteReaderDivider} />
              <Text
                selectable
                style={[
                  styles.noteReaderBodyText,
                  !noteReader.note?.text && styles.noteReaderBodyTextEmpty,
                ]}
              >
                {noteReader.note?.text || "No saved note content yet."}
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={scheduleVisible} transparent animationType="none" onRequestClose={closeScheduleSheet}>
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={closeScheduleSheet} />
          <Animated.View
            style={[
              styles.sheetContainer,
              {
                paddingBottom: Math.max(18, insets.bottom + 8),
                transform: [{ translateY: sheetTranslateY }],
              },
            ]}
          >
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Class Schedule</Text>
                <Text style={styles.sheetSub}>
                  Grade {profile.grade || "--"} • Section {profile.section || "--"}
                </Text>
              </View>
              <TouchableOpacity style={styles.sheetCloseBtn} onPress={closeScheduleSheet}>
                <Ionicons name="close" size={20} color={TEXT} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {DAY_ORDER.map((day) => {
                const entries = scheduleMap[day] || [];
                const isToday = day === todayDay;

                return (
                  <View key={day} style={[styles.daySection, isToday && styles.daySectionToday]}>
                    <View style={styles.daySectionHeader}>
                      <Text style={styles.daySectionTitle}>{day}</Text>
                      {isToday ? (
                        <View style={styles.todayPill}>
                          <Text style={styles.todayPillText}>Today</Text>
                        </View>
                      ) : null}
                    </View>

                    {entries.length ? (
                      entries.map((item) => (
                        <View key={`${day}-${item.period}`} style={styles.periodRow}>
                          <View style={styles.periodBadge}>
                            <Text style={styles.periodBadgeText}>{item.period}</Text>
                          </View>

                          <View style={{ flex: 1 }}>
                            <Text style={styles.periodSubject}>{item.subject || "Free Period"}</Text>
                            <Text style={styles.periodTeacher}>
                              {item.teacherName || "Unassigned"}
                            </Text>
                          </View>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.dayEmptyText}>No periods scheduled.</Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

function MiniPill({ icon, text, compact = false, styles, onPress }) {
  const iconColor = compact ? PRIMARY : "#F8FAFC";
  const Container = onPress ? TouchableOpacity : View;
  return (
    <Container
      style={[styles.miniPill, compact && styles.miniPillCompact]}
      {...(onPress
        ? {
            onPress,
            activeOpacity: 0.85,
          }
        : {})}
    >
      <MaterialCommunityIcons name={icon} size={compact ? 10 : 13} color={iconColor} />
      <Text style={[styles.miniPillText, compact && styles.miniPillTextCompact]}>{text}</Text>
    </Container>
  );
}

function SwipeableProfileNoteCard({ note, onOpen, onEdit, onDelete, styles, colors }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const ACTION_WIDTH = 116;

  const animateTo = useCallback((toValue) => {
    openRef.current = toValue < 0;
    setIsOpen(toValue < 0);
    Animated.spring(translateX, {
      toValue,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [translateX]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
      },
      onPanResponderMove: (_, gestureState) => {
        const nextX = openRef.current
          ? Math.min(0, Math.max(-ACTION_WIDTH, -ACTION_WIDTH + gestureState.dx))
          : Math.min(0, Math.max(-ACTION_WIDTH, gestureState.dx));
        translateX.setValue(nextX);
      },
      onPanResponderRelease: (_, gestureState) => {
        const shouldOpen = openRef.current
          ? gestureState.dx < 28
          : gestureState.dx < -36;
        animateTo(shouldOpen ? -ACTION_WIDTH : 0);
      },
      onPanResponderTerminate: () => {
        animateTo(openRef.current ? -ACTION_WIDTH : 0);
      },
    })
  ).current;

  return (
    <View style={styles.noteSwipeRow}>
      <View pointerEvents={isOpen ? "auto" : "none"} style={styles.noteSwipeActions}>
        <TouchableOpacity
          style={[styles.noteSwipeActionBtn, styles.noteSwipeEditBtn]}
          activeOpacity={0.9}
          onPress={() => {
            if (!openRef.current) return;
            onEdit();
          }}
        >
          <Ionicons name="create-outline" size={16} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.noteSwipeActionBtn, styles.noteSwipeDeleteBtn]}
          activeOpacity={0.9}
          onPress={() => {
            if (!openRef.current) return;
            onDelete();
          }}
        >
          <Ionicons name="trash-outline" size={16} color="#fff" />
        </TouchableOpacity>
      </View>

      <Animated.View
        style={[
          styles.noteSwipeCardWrap,
          { transform: [{ translateX }] },
        ]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={styles.noteItemRow}
          activeOpacity={0.9}
          onPress={() => {
            if (openRef.current) {
              animateTo(0);
              return;
            }
            onOpen();
          }}
        >
          <View style={styles.noteItemMainTap}>
            <View style={styles.noteItemBadge}>
              <Ionicons name="document-text-outline" size={15} color={colors.primary} />
            </View>
            <View style={styles.noteItemTextWrap}>
              <View style={styles.noteItemTopLine}>
                <Text numberOfLines={1} style={styles.noteItemTitle}>{note.title}</Text>
                {note.pinned ? (
                  <View style={styles.notePinnedPill}>
                    <Ionicons name="pin" size={10} color={colors.primary} />
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          <View style={styles.noteSwipeHint}>
            <Ionicons name="chevron-back" size={11} color={colors.muted} />
            <Text style={styles.noteSwipeHintText}>Swipe left</Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function ActionRow({ icon, title, subtitle, onPress, styles, colors }) {
  return (
    <TouchableOpacity style={styles.actionRow} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </TouchableOpacity>
  );
}

function createStyles(colors) {
  const BG = colors.background;
  const CARD = colors.card;
  const TEXT = colors.text;
  const MUTED = colors.muted;
  const BORDER = colors.border;
  const SOFT = colors.soft;

  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scroll: { padding: 14, paddingBottom: 28, paddingTop: 0 },
  center: { alignItems: "center", justifyContent: "center" },

  stretchContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: SCREEN_WIDTH,
    zIndex: 20,
    overflow: "hidden",
    backgroundColor: colors.soft,
  },
  stretchImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  stretchFill: {
    flex: 1,
    backgroundColor: "#991B1B",
  },

  heroCard: {
    marginTop: 0,
    marginHorizontal: -14,
    backgroundColor: CARD,
    borderRadius: 0,
    marginBottom: 12,
    zIndex: 3,
    borderWidth: 0,
    overflow: "hidden",
  },
  heroBanner: {
    height: 110,
    backgroundColor: "#7F1D1D",
    position: "relative",
    overflow: "hidden",
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  heroBannerImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  heroBannerFallback: {
    flex: 1,
    backgroundColor: "#991B1B",
    overflow: "hidden",
  },
  heroBannerOrbPrimary: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(248,113,113,0.30)",
    top: -40,
    right: -20,
  },
  heroBannerOrbSecondary: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.10)",
    bottom: -60,
    left: -20,
  },
  heroBannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(69,10,10,0.22)",
  },
  heroTopBar: {
    position: "absolute",
    top: 10,
    left: 12,
    right: 12,
    zIndex: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroTopActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  heroTopIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,23,42,0.38)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  heroTopTitle: {
    color: "#F8FAFC",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.2,
    flex: 1,
    textAlign: "center",
    marginHorizontal: 12,
  },
  heroAvatarSlot: {
    paddingHorizontal: 18,
    marginTop: -44,
  },
  avatarWrap: { position: "relative", alignSelf: "flex-start" },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.soft,
    borderWidth: 4,
    borderColor: colors.white,
  },
  editAvatarBtn: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.white,
  },
  heroIdentityBlock: {
    marginTop: -6,
    marginHorizontal: 14,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  identityTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  name: { fontSize: 21, fontWeight: "800", color: TEXT },
  editProfileBtn: {
    marginTop: 10,
    width: "100%",
    backgroundColor: "#5865F2",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  editProfileText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: "700",
  },
  profileFilterRow: {
    flexDirection: "row",
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 4,
    marginTop: 10,
  },
  profileFilterBtn: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  profileFilterBtnActive: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  profileFilterText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.muted,
  },
  profileFilterTextActive: {
    color: colors.text,
  },
  subRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  subText: { fontSize: 11, color: MUTED, fontWeight: "600", marginRight: 8 },
  heroQuickStats: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 8,
  },
  miniPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15,23,42,0.55)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  miniPillCompact: {
    backgroundColor: SOFT,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderColor: colors.border,
  },
  miniPillText: {
    marginLeft: 5,
    color: "#F8FAFC",
    fontSize: 11,
    fontWeight: "700",
  },
  miniPillTextCompact: {
    marginLeft: 3,
    fontSize: 9,
    color: PRIMARY,
  },

  card: {
    backgroundColor: CARD,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: TEXT, marginBottom: 10 },

  scheduleCard: {
    backgroundColor: colors.inputBackground,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginBottom: 12,
  },
  scheduleTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  scheduleIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: SOFT,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  scheduleTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: TEXT,
  },
  scheduleSub: {
    marginTop: 2,
    fontSize: 12,
    color: MUTED,
  },
  schedulePreviewWrap: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
    paddingTop: 10,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 7,
  },
  previewPeriod: {
    width: 64,
    color: PRIMARY,
    fontSize: 12,
    fontWeight: "800",
  },
  previewSubject: {
    flex: 1,
    color: TEXT,
    fontSize: 13,
    fontWeight: "600",
  },

  actionRow: { flexDirection: "row", alignItems: "center", paddingVertical: 11 },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  actionTitle: { fontSize: 14, fontWeight: "700", color: TEXT },
  actionSub: { fontSize: 12, color: MUTED, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.separator, marginLeft: 44 },

  eventRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 9 },
  eventDot: { width: 8, height: 8, borderRadius: 4, marginTop: 7, marginRight: 10 },
  eventTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  eventTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: TEXT },
  eventBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  eventBadgeText: {
    fontSize: 10,
    fontWeight: "800",
  },
  eventMeta: { marginTop: 3, fontSize: 12, color: MUTED },
  eventNotes: { marginTop: 3, fontSize: 12, color: colors.muted },
  emptyText: { color: MUTED, fontSize: 13, paddingVertical: 4 },

  logoutBtn: {
    marginTop: 4,
    backgroundColor: DANGER,
    borderRadius: 12,
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  logoutText: { color: colors.white, fontWeight: "800", marginLeft: 8 },

  modalBg: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: 14,
  },
  modalTitle: { fontSize: 16, fontWeight: "800", color: TEXT, marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    height: 44,
    paddingHorizontal: 12,
    marginBottom: 10,
    color: TEXT,
    backgroundColor: colors.inputBackground,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", marginTop: 4 },
  modalBtn: {
    minWidth: 90,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  cancelBtn: { backgroundColor: colors.surfaceMuted },
  saveBtn: { backgroundColor: PRIMARY },
  cancelText: { color: colors.text, fontWeight: "700" },
  saveText: { color: colors.white, fontWeight: "700" },

  editOptionBtn: {
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  editOptionText: {
    marginLeft: 10,
    fontSize: 14,
    fontWeight: "700",
    color: TEXT,
  },
  editOptionCancel: {
    marginBottom: 0,
    backgroundColor: colors.surfaceMuted,
  },
  editOptionCancelText: {
    color: MUTED,
  },
  noteSectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  noteSectionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  noteSectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: TEXT,
  },
  noteSectionText: {
    marginTop: 3,
    fontSize: 12,
    color: MUTED,
  },
  noteStateCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  noteStateText: {
    marginTop: 8,
    fontSize: 12,
    color: MUTED,
    fontWeight: "600",
  },
  noteSubjectCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.025,
    shadowRadius: 10,
    elevation: 1,
  },
  noteSubjectCardSelected: {
    borderColor: colors.primary,
    shadowColor: PRIMARY,
    shadowOpacity: 0.05,
    elevation: 2,
  },
  noteSubjectHeader: {
    paddingHorizontal: 11,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  noteSubjectHeaderExpanded: {
    backgroundColor: colors.inputBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  noteSubjectHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  noteSubjectCover: {
    width: 42,
    height: 54,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
  },
  noteSubjectIconContainer: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.separator,
  },
  noteSubjectInfoWrap: {
    marginLeft: 8,
    flex: 1,
  },
  noteSubjectName: {
    fontWeight: "900",
    fontSize: 14,
    color: TEXT,
  },
  noteSubjectSub: {
    color: colors.muted,
    marginTop: 2,
    fontSize: 10,
    fontWeight: "700",
  },
  noteSubjectToggle: {
    width: 26,
    height: 26,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  noteSubjectToggleActive: {
    borderColor: colors.primary,
    backgroundColor: colors.soft,
  },
  noteUnitsContainer: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: colors.inputBackground,
  },
  noteSwipeRow: {
    marginTop: 6,
    position: "relative",
  },
  noteSwipeActions: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    paddingRight: 2,
  },
  noteSwipeCardWrap: {
    zIndex: 2,
  },
  noteSwipeActionBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  noteSwipeEditBtn: {
    backgroundColor: PRIMARY,
  },
  noteSwipeDeleteBtn: {
    backgroundColor: "#EF4444",
  },
  noteItemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.card,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.018,
    shadowRadius: 6,
    elevation: 0,
  },
  noteItemMainTap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  noteItemBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  noteItemTextWrap: {
    flex: 1,
    marginLeft: 8,
    paddingRight: 8,
  },
  noteItemTopLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
  },
  noteItemTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    color: colors.text,
    marginRight: 6,
  },
  notePinnedPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.soft,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
  },
  noteSwipeHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingLeft: 8,
    marginLeft: 10,
    opacity: 0.85,
  },
  noteSwipeHintText: {
    marginLeft: 3,
    fontSize: 8,
    color: MUTED,
    fontWeight: "700",
  },

  noteReaderScreen: {
    flex: 1,
    backgroundColor: colors.screen,
  },
  noteReaderTopBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  noteReaderIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  noteReaderTopText: {
    flex: 1,
    marginHorizontal: 12,
  },
  noteReaderUnitTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: TEXT,
  },
  noteReaderTopSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: MUTED,
    fontWeight: "600",
  },
  noteReaderEditBtn: {
    minWidth: 58,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  noteReaderEditText: {
    fontSize: 13,
    fontWeight: "800",
    color: PRIMARY,
  },
  noteReaderScroll: {
    padding: 16,
    paddingBottom: 40,
  },
  noteReaderHero: {
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  },
  noteReaderHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  noteReaderTypePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.soft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  noteReaderTypeText: {
    marginLeft: 6,
    fontSize: 11,
    fontWeight: "800",
    color: MUTED,
  },
  noteReaderPinnedPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 4,
  },
  noteReaderPinnedText: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED,
  },
  noteReaderTitle: {
    fontSize: 21,
    lineHeight: 29,
    fontWeight: "900",
    color: TEXT,
  },
  noteReaderBodyCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 20,
    minHeight: 260,
  },
  noteReaderBodyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  noteReaderBodyLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: PRIMARY,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  noteReaderDivider: {
    height: 1,
    backgroundColor: colors.separator,
    marginTop: 12,
    marginBottom: 14,
  },
  noteReaderBodyText: {
    fontSize: 15,
    lineHeight: 26,
    color: TEXT,
    fontWeight: "500",
  },
  noteReaderBodyTextEmpty: {
    color: MUTED,
    fontStyle: "italic",
  },

  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: colors.overlay,
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    maxHeight: "82%",
  },
  sheetHandle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: TEXT,
  },
  sheetSub: {
    marginTop: 2,
    color: MUTED,
    fontSize: 12,
    fontWeight: "600",
  },
  sheetCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },

  daySection: {
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 12,
    backgroundColor: colors.card,
  },
  daySectionToday: {
    backgroundColor: colors.inputBackground,
    borderColor: colors.primary,
  },
  daySectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  daySectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: TEXT,
  },
  todayPill: {
    backgroundColor: SOFT,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  todayPillText: {
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "800",
  },
  periodRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  periodBadge: {
    minWidth: 64,
    backgroundColor: colors.soft,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
    marginRight: 10,
    alignItems: "center",
  },
  periodBadgeText: {
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "800",
  },
  periodSubject: {
    fontSize: 14,
    fontWeight: "700",
    color: TEXT,
  },
  periodTeacher: {
    marginTop: 2,
    fontSize: 12,
    color: MUTED,
  },
  dayEmptyText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "600",
    paddingTop: 4,
  },

  });
}