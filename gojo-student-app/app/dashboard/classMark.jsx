import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  LayoutAnimation,
  UIManager,
  Platform,
  ScrollView,
  Modal,
  Animated,
  Image,
  PanResponder,
  Dimensions,
  TouchableWithoutFeedback,
} from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get, query, orderByChild, equalTo } from "firebase/database";
import { database } from "../../constants/firebaseConfig";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Svg, Circle } from "react-native-svg";
import { setOpenedChat } from "../lib/chatStore";
import { useAppTheme } from "../../hooks/use-app-theme";

// school-aware helper (adjust path if your helper lives elsewhere)
import { getUserVal } from "../lib/userHelpers";

/* app/dashboard/classMark.jsx
   - Uses Platform1/Schools/{schoolKey}/... where available
   - Shows empty state when no courses found
*/

const { height: SCREEN_H } = Dimensions.get("window");
const PRIMARY = "#007AFB";
const MUTED = "#6B78A8";
const SUCCESS = "#27AE60";
const WARNING = "#F2C94C";
const DANGER = "#EB5757";
const CARD_BORDER = "#F1F3F8";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
function humanNumber(n) { if (n == null || Number.isNaN(Number(n))) return "-"; return String(n); }
const percentColor = (p) => { if (p == null) return MUTED; if (p >= 85) return SUCCESS; if (p >= 70) return PRIMARY; if (p >= 50) return WARNING; return DANGER; };

/* mapping subject names -> icon */
const SUBJECT_ICON_MAP = [
  { keys: ["english", "literature"], icon: "book-open-page-variant", color: "#6C5CE7" },
  { keys: ["math", "mathematics", "algebra", "geometry"], icon: "calculator-variant", color: "#00A8FF" },
  { keys: ["science", "general science", "biology", "chemistry", "physics"], icon: "flask", color: "#00B894" },
  { keys: ["environmental", "env"], icon: "leaf", color: "#00C897" },
  { keys: ["history", "social"], icon: "history", color: "#F39C12" },
  { keys: ["geography"], icon: "map", color: "#0984e3" },
  { keys: ["computer", "ict", "computing"], icon: "laptop", color: "#8e44ad" },
  { keys: ["physical", "pe", "sport"], icon: "run", color: "#e17055" },
  
];
function getSubjectIcon(subjectText = "") {
  const s = (subjectText || "").toLowerCase();
  for (const entry of SUBJECT_ICON_MAP) {
    for (const k of entry.keys) if (s.includes(k)) return { name: entry.icon, color: entry.color };
  }
  return { name: "book-outline", color: "#6e6e6e" };
}

/* Circular overall progress (white center) */
function CircularProgress({ size = 112, strokeWidth = 9, percent = 0, color, textSize = 18 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = clamp(Math.round(percent || 0), 0, 100);
  const strokeDashoffset = circumference - (circumference * pct) / 100;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderRadius: size / 2 }}>
      <Svg width={size} height={size}>
        <Circle fill="none" stroke="#EEF4FF" cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} />
        <Circle
          fill="none"
          stroke={color || percentColor(pct)}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
        />
      </Svg>
      <Text style={{ position: "absolute", fontWeight: "800", fontSize: textSize, color: color || percentColor(pct) }}>{pct !== null ? `${pct}%` : "-"}</Text>
    </View>
  );
}

/* Animated linear progress */
function LinearProgress({ percent = 0, height = 8, style }) {
  const widthAnim = useRef(new Animated.Value(0)).current;
  const pct = clamp(Math.round(percent || 0), 0, 100);
  const color = percentColor(pct);
  useEffect(() => { Animated.timing(widthAnim, { toValue: pct, duration: 450, useNativeDriver: false }).start(); }, [pct]);
  const w = widthAnim.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] });
  return (
    <View style={[{ backgroundColor: "#EEF4FF", height, borderRadius: 8, overflow: "hidden" }, style]}>
      <Animated.View style={{ width: w, height, backgroundColor: color }} />
    </View>
  );
}

function schoolBasePath(schoolKey) {
  return schoolKey ? `Platform1/Schools/${schoolKey}` : null;
}

function isValidProfileUri(value) {
  if (!value || typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;
  if (v === "/default-profile.png" || v.toLowerCase().includes("default-profile")) return false;
  return /^(https?:\/\/|file:\/\/|data:image\/|content:\/\/)/i.test(v);
}

function buildEmployeeDisplayName(emp = {}) {
  const p = emp.personal || emp.profileData?.personal || {};
  const full = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ").trim();
  return full || emp.name || null;
}

function getEmployeeProfileImage(emp = {}) {
  const p = emp.personal || emp.profileData?.personal || {};
  const candidates = [
    emp.profileImage,
    p.profileImage,
    p.profileImageName,
    emp.profileData?.personal?.profileImageName,
  ];
  return candidates.find((x) => isValidProfileUri(x)) || null;
}

function buildUserDisplayName(user = {}) {
  const p = user.personal || user.profileData?.personal || {};
  const fullFromPersonal = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ").trim();
  const fullFromRoot = [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ").trim();
  return fullFromPersonal || fullFromRoot || user.name || user.displayName || user.fullName || user.username || null;
}

function getUserProfileImage(user = {}) {
  const p = user.personal || user.profileData?.personal || {};
  const candidates = [
    user.profileImage,
    user.photoURL,
    user.avatar,
    user.profilePhoto,
    p.profileImage,
    p.profileImageName,
    user.profileData?.personal?.profileImageName,
  ];
  return candidates.find((x) => isValidProfileUri(x)) || null;
}

function extractTeacherNameFromMarks(marks = {}) {
  if (!marks || typeof marks !== "object") return null;
  for (const semKey of Object.keys(marks)) {
    const semNode = marks[semKey] || {};
    if (semNode.teacherName) return semNode.teacherName;
    for (const qk of Object.keys(semNode)) {
      const qNode = semNode[qk] || {};
      if (qNode && qNode.teacherName) return qNode.teacherName;
    }
  }
  return null;
}

function extractTeacherUserIdFromMarks(marks = {}) {
  if (!marks || typeof marks !== "object") return null;
  for (const semKey of Object.keys(marks)) {
    const semNode = marks[semKey] || {};
    if (semNode.userId) return String(semNode.userId);
    for (const qk of Object.keys(semNode)) {
      const qNode = semNode[qk] || {};
      if (qNode && qNode.userId) return String(qNode.userId);
    }
  }
  return null;
}

function normalizeSubjectKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function formatQuarterLabel(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "Quarter";
  const match = raw.toLowerCase().match(/^q(\d+)$/) || raw.toLowerCase().match(/^quarter\s*(\d+)$/);
  if (match?.[1]) return `Quarter ${match[1]}`;
  return raw.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function detectTemplateMode(templateSubjectNode) {
  if (!templateSubjectNode || typeof templateSubjectNode !== "object") return null;
  const semKeys = Object.keys(templateSubjectNode);
  let foundQuarter = false;
  let foundSemester = false;

  semKeys.forEach((semKey) => {
    const semNode = templateSubjectNode[semKey] || {};
    if (typeof semNode !== "object") return;
    const qKeys = Object.keys(semNode).filter((k) => /^q\d+/i.test(k));
    if (qKeys.length > 0) foundQuarter = true;
    if (semNode.assessments || semNode.assessment) foundSemester = true;
    if (!foundQuarter && !foundSemester) {
      qKeys.forEach((qk) => {
        const q = semNode[qk] || {};
        const modeVal = String(q.mode || "").toLowerCase();
        if (modeVal === "quarter") foundQuarter = true;
      });
    }
  });

  if (foundQuarter) return "quarter";
  if (foundSemester) return "semester";
  return null;
}

function pickNumber(...values) {
  for (const v of values) {
    if (v == null || v === "") continue;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function normalizeAssessmentEntry(entry = {}, fallbackKey = "") {
  const name =
    entry.name ||
    entry.title ||
    entry.label ||
    fallbackKey;

  const max = pickNumber(entry.max, entry.totalPoints, entry.points, entry.point, entry.outOf);
  const score = pickNumber(entry.score, entry.obtained, entry.point, entry.points, entry.finalScore, entry.mark);

  return {
    ...entry,
    name,
    max,
    score,
  };
}

function mergeMarksWithTemplate(actualMarks, templateSubjectNode) {
  const output = {};
  const actual = actualMarks && typeof actualMarks === "object" ? actualMarks : {};
  const template = templateSubjectNode && typeof templateSubjectNode === "object" ? templateSubjectNode : {};

  const semKeys = Array.from(new Set([...Object.keys(template), ...Object.keys(actual)])).filter(Boolean);

  semKeys.forEach((semKey) => {
    const tSem = template[semKey] || {};
    const aSem = actual[semKey] || {};
    const semOut = {
      ...tSem,
      ...aSem,
    };

    const qKeys = Array.from(
      new Set([
        ...Object.keys(tSem).filter((k) => /^q\d+/i.test(k)),
        ...Object.keys(aSem).filter((k) => /^q\d+/i.test(k)),
      ])
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (qKeys.length > 0) {
      qKeys.forEach((qk) => {
        const tQ = tSem[qk] || {};
        const aQ = aSem[qk] || {};
        const tAssess = tQ.assessments || tQ.assessment || {};
        const aAssess = aQ.assessments || aQ.assessment || {};
        const mergedAssess = {};

        const aKeys = Object.keys(aAssess || {});
        const tKeys = Object.keys(tAssess || {});
        const mergedKeys = Array.from(new Set([...tKeys, ...aKeys]));

        mergedKeys.forEach((ak) => {
          const tA = normalizeAssessmentEntry(tAssess[ak] || {}, ak);
          const aA = normalizeAssessmentEntry(aAssess[ak] || {}, ak);
          mergedAssess[ak] = {
            ...tA,
            ...aA,
            name: aA.name || tA.name || ak,
            max: aA.max != null ? aA.max : tA.max,
            score: aA.score != null ? aA.score : tA.score,
          };
        });

        semOut[qk] = {
          ...tQ,
          ...aQ,
          assessments: mergedAssess,
        };
      });
    } else {
      const tAssess = tSem.assessments || tSem.assessment || {};
      const aAssess = aSem.assessments || aSem.assessment || {};
      const mergedAssess = {};
      const mergedKeys = Array.from(new Set([...Object.keys(tAssess), ...Object.keys(aAssess)]));

      mergedKeys.forEach((ak) => {
        const tA = normalizeAssessmentEntry(tAssess[ak] || {}, ak);
        const aA = normalizeAssessmentEntry(aAssess[ak] || {}, ak);
        mergedAssess[ak] = {
          ...tA,
          ...aA,
          name: aA.name || tA.name || ak,
          max: aA.max != null ? aA.max : tA.max,
          score: aA.score != null ? aA.score : tA.score,
        };
      });

      semOut.assessments = mergedAssess;
    }

    output[semKey] = semOut;
  });

  return output;
}

/* Bottom sheet omitted for brevity — unchanged from previous (keeps same implementation) */
// ... (keep DraggableBottomSheet from prior file unchanged)
function DraggableBottomSheet({ visible, onClose, contentHeight = SCREEN_H * 0.85, innerScrollAtTopRef, onSnapChange, children, styles }) {
  const sheetHeight = contentHeight;
  const fullY = 0;
  const halfY = sheetHeight * 0.5;
  const hiddenY = sheetHeight;
  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const lastY = useRef(hiddenY);

  const shouldCaptureSheetPan = (_, gesture) => {
    const dy = Number(gesture?.dy || 0);
    const absDy = Math.abs(dy);
    if (absDy < 3) return false;

    // When fully expanded, allow pull-down only if inner scroll is already at the top.
    if (lastY.current === fullY) {
      return dy > 0 && !!innerScrollAtTopRef?.current;
    }

    // At half/hidden states, normal sheet drag should remain responsive.
    return absDy > 3;
  };

  useEffect(() => {
    if (visible) { Animated.timing(translateY, { toValue: fullY, duration: 260, useNativeDriver: true }).start(); lastY.current = fullY; onSnapChange && onSnapChange('full'); }
    else { Animated.timing(translateY, { toValue: hiddenY, duration: 220, useNativeDriver: true }).start(); lastY.current = hiddenY; onSnapChange && onSnapChange('hidden'); }
  }, [visible]);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: shouldCaptureSheetPan,
    onMoveShouldSetPanResponderCapture: shouldCaptureSheetPan,
    onPanResponderGrant: () => { translateY.setOffset(lastY.current); translateY.setValue(0); },
    onPanResponderMove: (_, gesture) => { translateY.setValue(gesture.dy); },
    onPanResponderRelease: (_, gesture) => {
      translateY.flattenOffset();
      const vy = gesture.vy;
      const moved = lastY.current + gesture.dy;
      const snaps = [fullY, halfY, hiddenY];
      let nearest = snaps.reduce((a, b) => (Math.abs(b - moved) < Math.abs(a - moved) ? b : a), snaps[0]);
      if (vy < -0.5) nearest = fullY;
      if (vy > 0.6) nearest = hiddenY;
      Animated.spring(translateY, { toValue: nearest, useNativeDriver: true, bounciness: 6 }).start(() => {
        lastY.current = nearest;
        onSnapChange && onSnapChange(nearest === fullY ? 'full' : nearest === halfY ? 'half' : 'hidden');
        if (nearest >= sheetHeight * 0.95) onClose && onClose();
      });
    },
  })).current;

  const handlePanResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { translateY.setOffset(lastY.current); translateY.setValue(0); },
    onPanResponderMove: (_, gesture) => { translateY.setValue(gesture.dy); },
    onPanResponderRelease: (_, gesture) => {
      translateY.flattenOffset();
      const vy = gesture.vy;
      const moved = lastY.current + gesture.dy;
      const snaps = [fullY, halfY, hiddenY];
      let nearest = snaps.reduce((a, b) => (Math.abs(b - moved) < Math.abs(a - moved) ? b : a), snaps[0]);
      if (vy < -0.5) nearest = fullY;
      if (vy > 0.6) nearest = hiddenY;
      Animated.spring(translateY, { toValue: nearest, useNativeDriver: true, bounciness: 6 }).start(() => {
        lastY.current = nearest;
        onSnapChange && onSnapChange(nearest === fullY ? 'full' : nearest === halfY ? 'half' : 'hidden');
        if (nearest >= sheetHeight * 0.95) onClose && onClose();
      });
    },
  })).current;

  if (!visible) return null;

  const handleToggle = () => {
    const target = lastY.current === fullY ? halfY : fullY;
    Animated.spring(translateY, { toValue: target, useNativeDriver: true, bounciness: 6 }).start(() => {
      lastY.current = target;
      onSnapChange && onSnapChange(target === fullY ? 'full' : 'half');
    });
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}><View style={styles.sheetBackdrop} /></TouchableWithoutFeedback>

      <Animated.View style={[styles.sheetContainer, { height: sheetHeight, transform: [{ translateY }] }]} {...panResponder.panHandlers}>
        <View style={styles.handleRow}>
          <TouchableOpacity activeOpacity={0.9} onPress={handleToggle} style={styles.sheetHandleTouchable}>
            <View style={styles.sheetHandle} />
          </TouchableOpacity>
          <View style={styles.handleDragZone} {...handlePanResponder.panHandlers} />
        </View>

        <View style={{ flex: 1 }}>{children}</View>
      </Animated.View>
    </Modal>
  );
}

/* main screen */
export default function ClassMarkScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [marksMap, setMarksMap] = useState({});
  const [modeMap, setModeMap] = useState({});
  const [studentId, setStudentId] = useState(null);
  const [studentGrade, setStudentGrade] = useState(null);
  const [studentSection, setStudentSection] = useState(null);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetCourseKey, setSheetCourseKey] = useState(null);
  const [sheetCourseName, setSheetCourseName] = useState(null);
  const [selectedSemester, setSelectedSemester] = useState(null);
  const [teacherProfile, setTeacherProfile] = useState({ name: null, profileImage: null });

  const innerScrollAtTopRef = useRef(true);

  // load student info; reads Students path under school bucket if schoolKey present
  const loadStudent = useCallback(async () => {
    try {
      const schoolKey = await AsyncStorage.getItem("schoolKey");
      const base = schoolBasePath(schoolKey);

      // prefer explicit stored student node key (studentNodeKey or studentId)
      const sNode = (await AsyncStorage.getItem("studentNodeKey")) || (await AsyncStorage.getItem("studentId"));
      if (sNode) {
        // try school-scoped Students first
        if (base) {
          try {
            const snap = await get(ref(database, `${base}/Students/${sNode}`));
            if (snap.exists()) {
              const s = snap.val();
              setStudentId(sNode); setStudentGrade(String(s.grade ?? "")); setStudentSection(String(s.section ?? ""));
              return { id: sNode, grade: String(s.grade ?? ""), section: String(s.section ?? "") };
            }
          } catch (e) { /* continue to fallback */ }
        }
        // fallback to root Students
        try {
          const snap2 = await get(ref(database, `Students/${sNode}`));
          if (snap2.exists()) {
            const s = snap2.val();
            setStudentId(sNode); setStudentGrade(String(s.grade ?? "")); setStudentSection(String(s.section ?? ""));
            return { id: sNode, grade: String(s.grade ?? ""), section: String(s.section ?? "") };
          }
        } catch (e) {}
      }

      // fallback: resolve from userNode
      const userNode = await AsyncStorage.getItem("userNodeKey");
      if (userNode) {
        // use getUserVal to read correct Users node under school (if available)
        const uVal = await getUserVal(userNode);
        if (uVal && uVal.studentId) {
          const sid = uVal.studentId;
          if (base) {
            try {
              const sSnap = await get(ref(database, `${base}/Students/${sid}`));
              if (sSnap.exists()) {
                const s = sSnap.val();
                setStudentId(sid); setStudentGrade(String(s.grade ?? "")); setStudentSection(String(s.section ?? ""));
                return { id: sid, grade: String(s.grade ?? ""), section: String(s.section ?? "") };
              }
            } catch (e) { /* continue */ }
          }
          try {
            const sSnap2 = await get(ref(database, `Students/${sid}`));
            if (sSnap2.exists()) {
              const s = sSnap2.val();
              setStudentId(sid); setStudentGrade(String(s.grade ?? "")); setStudentSection(String(s.section ?? ""));
              return { id: sid, grade: String(s.grade ?? ""), section: String(s.section ?? "") };
            }
          } catch (e) {}
        }
      }
    } catch (e) { console.warn("loadStudent error", e); }
    return null;
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const ctx = await loadStudent();
      if (!ctx) { if (mounted) setLoading(false); return; }
      const grade = ctx.grade, section = ctx.section, sid = ctx.id;

      try {
        const schoolKey = await AsyncStorage.getItem("schoolKey");
        const base = schoolBasePath(schoolKey);

        // Fetch assessment templates for the student's grade first.
        let gradeTemplates = null;
        if (grade) {
          if (base) {
            try {
              const tSnap = await get(ref(database, `${base}/AssesmentTemplates/${String(grade)}`));
              if (tSnap.exists()) gradeTemplates = tSnap.val() || null;
            } catch (e) {}
          }
          if (!gradeTemplates) {
            try {
              const tSnap2 = await get(ref(database, `AssesmentTemplates/${String(grade)}`));
              if (tSnap2.exists()) gradeTemplates = tSnap2.val() || null;
            } catch (e) {}
          }
        }

        // Try school-scoped Courses first, then root Courses
        let snap = null;
        if (base) {
          try { snap = await get(ref(database, `${base}/Courses`)); } catch (e) { snap = null; }
        }
        if (!snap || !snap.exists()) {
          try { snap = await get(ref(database, "Courses")); } catch (e) { snap = null; }
        }

        const list = [];
        if (snap && snap.exists()) {
          snap.forEach((child) => {
            const val = child.val(), key = child.key;
            if (String(val.grade ?? "") === String(grade) && String(val.section ?? "") === String(section)) {
              list.push({ key, data: val });
            }
          });
        }

        list.sort((a, b) => (a.data.name || "").localeCompare(b.data.name || ""));
        if (!mounted) return;
        setCourses(list);

        // ClassMarks: try school-scoped path then fallback to root path
        const marks = {};
        const modes = {};
        await Promise.all(list.map(async (c) => {
          try {
            let cm = null;
            const sidStored = await AsyncStorage.getItem("studentId");
            const sNodeStored = await AsyncStorage.getItem("studentNodeKey");
            const uidStored = await AsyncStorage.getItem("userId");
            const candidateStudentKeys = Array.from(new Set([sid, sidStored, sNodeStored, uidStored].filter(Boolean)));

            for (const candidate of candidateStudentKeys) {
              if (cm && cm.exists()) break;
              if (base) {
                try {
                  const s = await get(ref(database, `${base}/ClassMarks/${c.key}/${candidate}`));
                  if (s.exists()) { cm = s; break; }
                } catch (e) {}
              }
              try {
                const s2 = await get(ref(database, `ClassMarks/${c.key}/${candidate}`));
                if (s2.exists()) { cm = s2; break; }
              } catch (e) {}
            }

            const subjectRaw = c?.data?.subject || c?.data?.name || "";
            const subjectKey = normalizeSubjectKey(subjectRaw);
            const templateSubject = gradeTemplates
              ? gradeTemplates[subjectRaw] || gradeTemplates[subjectRaw?.toLowerCase?.()] || gradeTemplates[subjectKey]
              : null;

            const actualMarks = cm && cm.exists() ? (cm.val() || {}) : {};
            marks[c.key] = mergeMarksWithTemplate(actualMarks, templateSubject || {});
            modes[c.key] = detectTemplateMode(templateSubject || {}) || "semester";
          } catch (err) { console.warn("classmark fetch", err); marks[c.key] = null; }
        }));
        if (!mounted) return;
        setMarksMap(marks);
        setModeMap(modes);
      } catch (err) {
        console.warn(err);
        if (mounted) { setCourses([]); setMarksMap({}); setModeMap({}); }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [loadStudent]);

  const toggle = (k) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setExpanded((p) => ({ ...p, [k]: !p[k] })); };

  const parseAssessments = (node) => {
    if (!node) return [];
    return Object.keys(node).map((k) => {
      const v = normalizeAssessmentEntry(node[k] || {}, k);
      return { key: k, name: v.name || k, max: v.max, score: v.score };
    });
  };

  const quarterTotals = (node) => {
    const arr = parseAssessments(node);
    let s = 0, m = 0;
    arr.forEach((a) => { if (a.score != null) s += a.score; if (a.max != null) m += a.max; });
    const percent = m > 0 ? (s / m) * 100 : null;
    return { s, m, percent, items: arr };
  };

  const courseOverall = (marks) => {
    if (!marks) return { s: 0, m: 0, percent: null };
    let s = 0, m = 0;
    Object.keys(marks).forEach((sem) => {
      const semNode = marks[sem] || {};
      const qKeys = Object.keys(semNode || {}).filter((k) => /^q\d+/i.test(k));
      if (qKeys.length > 0) {
        qKeys.forEach((qk) => {
          const q = semNode[qk] || {};
          const res = quarterTotals(q.assessments || q.assessment || {});
          s += Number(res.s || 0); m += Number(res.m || 0);
        });
      } else {
        const res = quarterTotals(semNode.assessments || semNode.assessment || {});
        s += Number(res.s || 0); m += Number(res.m || 0);
      }
    });
    return { s, m, percent: m > 0 ? (s / m) * 100 : null };
  };

  // fetch teacher profile using TeacherAssignments/Teachers under school bucket first, fallback to root.
  const fetchTeacherProfileForCourse = useCallback(async (courseId, fallbackTeacherName = null, fallbackTeacherUserId = null) => {
    try {
      const schoolKey = await AsyncStorage.getItem("schoolKey");
      const base = schoolBasePath(schoolKey);

      const safeMerge = (current, incoming) => ({
        name: current?.name || incoming?.name || null,
        profileImage: current?.profileImage || incoming?.profileImage || null,
        userId: current?.userId || incoming?.userId || null,
        userNodeKey: current?.userNodeKey || incoming?.userNodeKey || null,
      });

      let result = {
        name: fallbackTeacherName || null,
        profileImage: null,
        userId: fallbackTeacherUserId || null,
        userNodeKey: null,
      };

      const resolveUserByNodeKey = async (userNodeKey) => {
        if (!userNodeKey) return { name: null, profileImage: null };

        const u = await getUserVal(userNodeKey);
        if (u) {
          return {
            name: buildUserDisplayName(u),
            profileImage: getUserProfileImage(u),
            userId: u.userId || userNodeKey,
            userNodeKey,
          };
        }

        try {
          if (base) {
            const s = await get(ref(database, `${base}/Users/${userNodeKey}`));
            if (s.exists()) {
              const v = s.val() || {};
              return {
                name: buildUserDisplayName(v),
                profileImage: getUserProfileImage(v),
                userId: v.userId || userNodeKey,
                userNodeKey,
              };
            }
          }
        } catch {}

        try {
          const g = await get(ref(database, `Users/${userNodeKey}`));
          if (g.exists()) {
            const v = g.val() || {};
            return {
              name: buildUserDisplayName(v),
              profileImage: getUserProfileImage(v),
              userId: v.userId || userNodeKey,
              userNodeKey,
            };
          }
        } catch {}

        // userNodeKey may be a userId field value, not Users node key.
        try {
          const byUserId = async (path) => {
            const q = query(ref(database, path), orderByChild("userId"), equalTo(userNodeKey));
            const snap = await get(q);
            if (!snap.exists()) return null;
            let found = null;
            let foundKey = null;
            snap.forEach((child) => {
              if (found) return true;
              foundKey = child.key;
              found = child.val() || {};
              return true;
            });
            return found ? { key: foundKey, val: found } : null;
          };

          let qUser = null;
          if (base) qUser = await byUserId(`${base}/Users`);
          if (!qUser) qUser = await byUserId("Users");

          if (qUser && qUser.val) {
            return {
              name: buildUserDisplayName(qUser.val),
              profileImage: getUserProfileImage(qUser.val),
              userId: qUser.val.userId || userNodeKey,
              userNodeKey: qUser.key || null,
            };
          }
        } catch {}

        return { name: null, profileImage: null };
      };

      // 0) Prefer teacher userId from ClassMarks (semester userId)
      if (fallbackTeacherUserId) {
        const byUserId = await resolveUserByNodeKey(fallbackTeacherUserId);
        result = safeMerge(result, byUserId);
      }

      // load TeacherAssignments
      let taSnap = null;
      if (base) {
        try { taSnap = await get(ref(database, `${base}/TeacherAssignments`)); } catch (e) { taSnap = null; }
      }
      if (!taSnap || !taSnap.exists()) {
        try { taSnap = await get(ref(database, "TeacherAssignments")); } catch (e) { taSnap = null; }
      }

      let foundTeacherId = null;
      if (taSnap && taSnap.exists()) {
        taSnap.forEach((child) => {
          const val = child.val();
          if (val && val.courseId === courseId) foundTeacherId = val.teacherId || null;
        });
      }

      // 1) Teachers node by teacherId (if assignment exists)
      if (foundTeacherId) {
        let tSnap = null;
        if (base) {
          try { tSnap = await get(ref(database, `${base}/Teachers/${foundTeacherId}`)); } catch (e) { tSnap = null; }
        }
        if (!tSnap || !tSnap.exists()) {
          try { tSnap = await get(ref(database, `Teachers/${foundTeacherId}`)); } catch (e) { tSnap = null; }
        }

        if (tSnap && tSnap.exists()) {
          const tVal = tSnap.val() || {};
          result = safeMerge(result, {
            name: tVal.name || tVal.teacherName || null,
            profileImage: isValidProfileUri(tVal.profileImage) ? tVal.profileImage : null,
            userId: tVal.userId || null,
          });

          if (tVal.userId) {
            const uResolved = await resolveUserByNodeKey(tVal.userId);
            result = safeMerge(result, uResolved);
          }
        }
      }

      // 2) Employees node as fallback (common in your schema)
      let empSnap = null;
      if (base) {
        try { empSnap = await get(ref(database, `${base}/Employees`)); } catch (e) { empSnap = null; }
      }
      if ((!result.name || !result.profileImage) && empSnap && empSnap.exists()) {
        let matchedEmp = null;
        const targetName = String(result.name || fallbackTeacherName || "").trim().toLowerCase();

        empSnap.forEach((child) => {
          if (matchedEmp) return true;
          const emp = child.val() || {};
          const empName = String(buildEmployeeDisplayName(emp) || "").trim().toLowerCase();

          const idMatch =
            (foundTeacherId && emp.teacherId && String(emp.teacherId) === String(foundTeacherId)) ||
            (foundTeacherId && emp.userId && String(emp.userId) === String(foundTeacherId)) ||
            (fallbackTeacherUserId && emp.userId && String(emp.userId) === String(fallbackTeacherUserId));

          const nameMatch = targetName && empName && empName === targetName;

          if (idMatch || nameMatch) {
            matchedEmp = emp;
            return true;
          }
        });

        if (matchedEmp) {
          result = safeMerge(result, {
            name: buildEmployeeDisplayName(matchedEmp),
            profileImage: getEmployeeProfileImage(matchedEmp),
            userId: matchedEmp.userId || null,
          });
          if (matchedEmp.userId) {
            const uResolved = await resolveUserByNodeKey(matchedEmp.userId);
            result = safeMerge(result, uResolved);
          }
        }
      }

      // 3) Users scan by display name as final fallback
      if ((!result.name || !result.profileImage) && base && result.name) {
        try {
          const usersSnap = await get(ref(database, `${base}/Users`));
          if (usersSnap.exists()) {
            const wanted = String(result.name).trim().toLowerCase();
            usersSnap.forEach((child) => {
              if (result.profileImage) return true;
              const u = child.val() || {};
              const uname = String(u.name || "").trim().toLowerCase();
              if (uname && uname === wanted) {
                result = safeMerge(result, {
                  name: buildUserDisplayName(u),
                  profileImage: getUserProfileImage(u),
                  userId: u.userId || child.key,
                  userNodeKey: child.key,
                });
                return true;
              }
            });
          }
        } catch {}
      }

      return result;
    } catch (err) { console.warn("fetchTeacherProfileForCourse error:", err); return { name: fallbackTeacherName || null, profileImage: null }; }
  }, []);

  const openSheet = async (courseKey, courseName, preferredSemester = null) => {
    setSheetCourseKey(courseKey); setSheetCourseName(courseName || null);
    const marks = marksMap[courseKey] || {};
    const semKeys = Object.keys(marks || {});
    const selected = preferredSemester && semKeys.includes(preferredSemester)
      ? preferredSemester
      : semKeys.length > 0
        ? semKeys[0]
        : null;
    const fallbackTeacherName = extractTeacherNameFromMarks(marks);
    const fallbackTeacherUserId =
      (selected && marks[selected] && marks[selected].userId ? String(marks[selected].userId) : null) ||
      extractTeacherUserIdFromMarks(marks);
    setSelectedSemester(selected);
    const profile = await fetchTeacherProfileForCourse(courseKey, fallbackTeacherName, fallbackTeacherUserId);
    setTeacherProfile(profile || { name: null, profileImage: null });
    innerScrollAtTopRef.current = true;
    setSheetVisible(true);
  };

  const onAskTeacher = useCallback(async () => {
    try {
      const contactKey = teacherProfile?.userNodeKey || teacherProfile?.userId || "";
      let contactUserId = teacherProfile?.userId || "";

      if (!contactUserId && contactKey) {
        try {
          const u = await getUserVal(contactKey);
          contactUserId = u?.userId || contactKey;
        } catch {
          contactUserId = contactKey;
        }
      }

      if (!contactKey && !contactUserId) {
        return;
      }

      let myUserId = await AsyncStorage.getItem("userId");
      if (!myUserId) {
        const nk =
          (await AsyncStorage.getItem("userNodeKey")) ||
          (await AsyncStorage.getItem("studentNodeKey")) ||
          (await AsyncStorage.getItem("studentId")) ||
          null;
        if (nk) {
          try {
            const u = await getUserVal(nk);
            myUserId = u?.userId || nk;
          } catch {
            myUserId = nk;
          }
        }
      }

      let existingChatId = "";
      if (myUserId && contactUserId) {
        const makeDeterministicChatId = (a, b) => `${a}_${b}`;
        try {
          const c1 = makeDeterministicChatId(myUserId, contactUserId);
          const c2 = makeDeterministicChatId(contactUserId, myUserId);
          const s1 = await get(ref(database, `Chats/${c1}`));
          if (s1.exists()) existingChatId = c1;
          else {
            const s2 = await get(ref(database, `Chats/${c2}`));
            if (s2.exists()) existingChatId = c2;
          }
        } catch (e) {
          console.warn("onAskTeacher find existing chat error", e);
        }
      }

      setOpenedChat({
        chatId: existingChatId || "",
        contactKey: contactKey || "",
        contactUserId: contactUserId || "",
        contactName: teacherProfile?.name || "Teacher",
        contactImage: teacherProfile?.profileImage || "",
      });

      router.push("/messages");
    } catch (e) {
      console.warn("onAskTeacher error", e);
    }
  }, [teacherProfile, router]);

  const CourseTile = ({ item }) => {
    const courseKey = item.key; const data = item.data; const marks = marksMap[courseKey] || {};
    const overall = courseOverall(marks); const percent = overall.percent !== null ? Math.round(overall.percent) : null;
    const subjectText = (data.subject || data.name || "").toLowerCase(); const iconEntry = getSubjectIcon(subjectText);

    return (
      <View style={styles.cardWrapper}>
        <View style={[styles.cardView, expanded[courseKey] && styles.cardSelected]}>
          <TouchableOpacity
            activeOpacity={0.95}
            style={[styles.cardInner, expanded[courseKey] && styles.cardHeaderExpanded]}
            onPress={() => toggle(courseKey)}
          >
            <View style={styles.cardHeaderLeft}>
              <View style={[styles.subjectImage, styles.subjectIconContainer]}>
              <MaterialCommunityIcons name={iconEntry.name} size={42} color={iconEntry.color} />
              </View>

              <View style={{ flex: 1, marginLeft: 12 }}>
                <View style={styles.subjectTitleRow}>
                  <Text style={styles.subjectName}>{data.name || data.subject || courseKey}</Text>
                  <Text style={styles.gradeSection}>Grade {data.grade || ""}{data.section ? ` • ${data.section}` : ""}</Text>
                </View>

                <View style={{ marginTop: 10 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={styles.smallMuted}>Progress</Text>
                    <Text style={[styles.percentText, { color: percentColor(percent) }]}>{percent !== null ? `${percent}%` : "–"}</Text>
                  </View>
                  <LinearProgress percent={percent || 0} style={{ marginTop: 8 }} />
                </View>
              </View>
            </View>

            <View style={[styles.cardHeaderToggle, expanded[courseKey] && styles.cardHeaderToggleActive]}>
              <Ionicons
                name={expanded[courseKey] ? "chevron-up" : "chevron-down"}
                size={18}
                color={expanded[courseKey] ? PRIMARY : MUTED}
              />
            </View>
          </TouchableOpacity>

          {expanded[courseKey] && (
            <View style={styles.details}>
              {Object.keys(marks || {}).length === 0 ? <Text style={styles.noAssess}>No assessments yet</Text> : (
                Object.keys(marks || {}).map((semKey) => {
                  const semNode = marks[semKey] || {};
                  const qKeys = Object.keys(semNode || {}).filter((k) => /^q\d+/i.test(k));
                  const quarters = qKeys.length > 0 ? qKeys : ["default"];
                  return (
                    <View key={semKey} style={{ marginTop: 8 }}>
                      <Text style={styles.semLabel}>{semKey.toUpperCase()}</Text>
                      {quarters.map((qk) => {
                        const q = qk === "default" ? semNode : (semNode[qk] || {});
                        const res = quarterTotals(q.assessments || q.assessment || {});
                        return (
                          <TouchableOpacity
                            key={qk}
                            activeOpacity={0.9}
                            style={styles.assessmentRow}
                            onPress={() => openSheet(courseKey, data.name || data.subject, semKey)}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.assName}>{qk === "default" ? "ASSESSMENTS" : formatQuarterLabel(qk)}</Text>
                              <Text style={styles.assMeta}>{humanNumber(res.s)} / {humanNumber(res.m)}</Text>
                            </View>
                            <View style={{ width: 140 }}>
                              <LinearProgress percent={res.percent || 0} />
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })
              )}
            </View>
          )}
        </View>
      </View>
    );
  };

  if (loading) return (<View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>);

  // Empty state when no courses found (friendly message)
  if (!courses || courses.length === 0) {
    return (
      <View style={styles.container}>
        <View style={{ padding: 24, alignItems: "center", justifyContent: "center" }}>
          <Image source={require("../../assets/images/no_data_illustrator.jpg")} style={{ width: 220, height: 160, marginBottom: 18 }} resizeMode="contain" />
          <Text style={styles.emptyTitle}>No courses found</Text>
          <Text style={{ color: MUTED, marginTop: 8, textAlign: "center" }}>
            We couldn't find any courses for your grade/section. If this looks incorrect, contact your school administrator.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 0, paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        <Text style={styles.subtitle}>Tap a card to expand quick details. Open details for a complete breakdown.</Text>

        <FlatList
          data={courses}
          keyExtractor={(i) => i.key}
          renderItem={CourseTile}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          contentContainerStyle={{ paddingTop: 6 }}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        />
      </ScrollView>

      <DraggableBottomSheet visible={sheetVisible} onClose={() => setSheetVisible(false)} contentHeight={SCREEN_H * 0.94} innerScrollAtTopRef={innerScrollAtTopRef} styles={styles}>
        <CourseSheetInner
          courseKey={sheetCourseKey}
          courseName={sheetCourseName}
          marks={marksMap[sheetCourseKey]}
          mode={modeMap[sheetCourseKey] || "semester"}
          onAskTeacher={onAskTeacher}
          onClose={() => setSheetVisible(false)}
          selectedSemester={selectedSemester}
          setSelectedSemester={setSelectedSemester}
          teacherProfile={teacherProfile}
          innerScrollAtTopRef={innerScrollAtTopRef}
          styles={styles}
        />
      </DraggableBottomSheet>
    </View>
  );
}

/* CourseSheetInner unchanged from previous (keeps same implementation) */
function CourseSheetInner({ courseKey, courseName, marks = {}, mode = "semester", onAskTeacher, onClose, selectedSemester, setSelectedSemester, teacherProfile, innerScrollAtTopRef, styles }) {
  const [expandedQuarter, setExpandedQuarter] = useState({});
  const [semMenuOpen, setSemMenuOpen] = useState(false);

  useEffect(() => {
    setExpandedQuarter({});
    setSemMenuOpen(false);
  }, [courseKey, selectedSemester]);

  const computeTotals = useCallback((marksObj) => {
    let s = 0, m = 0;
    Object.keys(marksObj || {}).forEach((sem) => {
      const semNode = marksObj[sem] || {};
      const qKeys = Object.keys(semNode || {}).filter((k) => /^q\d+/i.test(k));
      if (qKeys.length > 0) {
        qKeys.forEach((qk) => {
          const q = semNode[qk] || {};
          const arr = q.assessments || q.assessment || {};
          Object.keys(arr).forEach((k) => {
            const a = arr[k] || {};
            if (a.score != null) s += Number(a.score);
            if (a.max != null) m += Number(a.max);
          });
        });
      } else {
        const arr = semNode.assessments || semNode.assessment || {};
        Object.keys(arr).forEach((k) => {
          const a = arr[k] || {};
          if (a.score != null) s += Number(a.score);
          if (a.max != null) m += Number(a.max);
        });
      }
    });
    return { s, m, percent: m > 0 ? (s / m) * 100 : null };
  }, []);

  const overall = computeTotals(marks);
  const semKeys = Object.keys(marks || {});
  const selSem = selectedSemester || (semKeys.length > 0 ? semKeys[0] : null);

  const getQuarterKeys = (semNode) => {
    if (!semNode) return [];
    const keys = Object.keys(semNode || {});
    const qkeys = keys.filter((k) => /^q\d+/i.test(k));
    if (qkeys.length > 0) return qkeys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (semNode.assessments || semNode.assessment) return ["default"];
    return keys;
  };

  const onInnerScroll = (e) => { const y = e.nativeEvent.contentOffset.y; innerScrollAtTopRef.current = y <= 5; };

  const semNode = selSem ? (marks[selSem] || {}) : null;
  const quarterKeys = getQuarterKeys(semNode);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
        <View style={styles.avatar}>
          {teacherProfile?.profileImage ? <Image source={{ uri: teacherProfile.profileImage }} style={{ width: 40, height: 40, borderRadius: 20 }} /> : <Ionicons name="person" size={24} color="#fff" />}
        </View>
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={styles.teacherName}>{teacherProfile?.name || "Teacher"}</Text>
          <Text style={{ color: MUTED, marginTop: 4 }}>{courseName || ""}</Text>
        </View>
        <View style={styles.semDropdownWrap}>
          <TouchableOpacity
            style={styles.semSelector}
            activeOpacity={0.9}
            onPress={() => {
              if (!semKeys.length) return;
              setSemMenuOpen((p) => !p);
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ color: PRIMARY, fontWeight: "700" }}>{selSem ? selSem.toUpperCase() : "SEM"}</Text>
              <Ionicons name={semMenuOpen ? "chevron-up" : "chevron-down"} size={14} color={PRIMARY} />
            </View>
          </TouchableOpacity>

          {semMenuOpen && semKeys.length > 0 && (
            <View style={styles.semDropdownMenu}>
              {semKeys.map((sem) => {
                const active = sem === selSem;
                return (
                  <TouchableOpacity
                    key={sem}
                    activeOpacity={0.9}
                    style={[styles.semOption, active && styles.semOptionActive]}
                    onPress={() => {
                      setSelectedSemester(sem);
                      setExpandedQuarter({});
                      setSemMenuOpen(false);
                    }}
                  >
                    <Text style={[styles.semOptionText, active && { color: PRIMARY }]}>{sem.toUpperCase()}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </View>

      <View style={{ alignItems: "center", marginBottom: 12 }}>
        <CircularProgress percent={overall.percent ?? 0} size={110} strokeWidth={9} textSize={17} color={percentColor(Math.round(overall.percent ?? 0))} />
        <Text style={{ color: MUTED, marginTop: 8 }}>Overall score</Text>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 6 }}>
        <Text style={styles.sheetSectionTitle}>
          {mode === "quarter"
            ? (selSem ? `${formatQuarterLabel(selSem)} - Quarters` : "Quarters")
            : (selSem ? `${selSem.toUpperCase()} - Assessments` : "Assessments")}
        </Text>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
          nestedScrollEnabled
          onScroll={onInnerScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        >
          {selSem ? (
            quarterKeys.length === 0 ? <Text style={{ color: MUTED }}>{mode === "quarter" ? "No quarter data" : "No assessment data"}</Text> : quarterKeys.map((qk) => {
              const qn = qk === "default" ? (semNode?.assessments || semNode?.assessment || {}) : (semNode[qk] || {});
              const arr = qk === "default" ? qn : (qn.assessments || qn.assessment || {});
              const items = Object.keys(arr || {}).map((k) => ({ key: k, ...arr[k] }));
              let s = 0, m = 0; items.forEach((it) => { if (it.score != null) s += Number(it.score); if (it.max != null) m += Number(it.max); });
              const pct = m > 0 ? (s / m) * 100 : null;
              const isExpanded = expandedQuarter[qk] ?? (mode !== "quarter");

              return (
                <View key={qk} style={{ marginBottom: 12 }}>
                  <TouchableOpacity
                    activeOpacity={0.95}
                    onPress={() => setExpandedQuarter((p) => ({ ...p, [qk]: !isExpanded }))}
                    style={styles.semCard}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.quarterTitle}>{qk === "default" ? "Assessments" : formatQuarterLabel(qk)}</Text>
                        <Text style={{ color: MUTED, marginTop: 4 }}>{humanNumber(s)} / {humanNumber(m)}</Text>
                      </View>

                      <View style={{ width: 160, marginLeft: 12 }}>
                        <LinearProgress percent={pct || 0} height={10} />
                        <Text style={{ textAlign: "right", marginTop: 6, fontWeight: "700", color: percentColor(Math.round(pct ?? 0)) }}>{pct !== null ? `${Math.round(pct)}%` : "-"}</Text>
                      </View>

                      <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={20} color={MUTED} style={{ marginLeft: 8 }} />
                    </View>

                    {isExpanded && (
                      <View style={{ marginTop: 12 }}>
                        {items.length === 0 ? <Text style={{ color: MUTED }}>No assessments</Text> : items.map((it) => (
                          <View key={it.key} style={styles.assRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.assessmentName}>{it.name || it.key}</Text>
                              <Text style={{ color: MUTED, marginTop: 4 }}>Max: {it.max ?? "-"} • Score: {it.score ?? "-"}</Text>
                            </View>
                            <Text style={{ fontWeight: "700", color: percentColor((it.score && it.max) ? (it.score / it.max) * 100 : 0) }}>{it.score ?? "-"}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })
          ) : <Text style={{ color: MUTED }}>No semester selected or no data</Text>}
        </ScrollView>
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 12 }}>
        <TouchableOpacity onPress={onClose} style={[styles.sheetBtn, styles.sheetBtnSecondary]}>
          <Text style={styles.sheetBtnText}>Close</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onAskTeacher} style={[styles.sheetBtn, { backgroundColor: PRIMARY }]}>
          <Text style={{ fontWeight: "700", color: "#fff" }}>Ask Teacher</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* styles */
function createStyles(colors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  subtitle: { color: MUTED, paddingHorizontal: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontWeight: "700", fontSize: 18, color: colors.text, textAlign: "center" },

  cardWrapper: { marginBottom: 12 },
  cardView: {
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
  cardSelected: {
    borderColor: "#B9D4FF",
    shadowColor: PRIMARY,
    shadowOpacity: 0.05,
    elevation: 2,
  },
  cardInner: {
    paddingHorizontal: 16,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardHeaderExpanded: {
    backgroundColor: colors.inputBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  subjectImage: {
    width: 56,
    height: 74,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.separator,
  },
  subjectIconContainer: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.separator,
  },
  subjectName: { fontWeight: "900", fontSize: 17, color: colors.text },
  subjectTitleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
  },
  gradeSection: { color: colors.muted, marginLeft: 8, fontSize: 12, fontWeight: "700" },
  smallMuted: { color: MUTED, fontSize: 11, fontWeight: "700" },
  percentText: { fontWeight: "800" },
  cardHeaderToggle: {
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
  cardHeaderToggleActive: {
    borderColor: colors.primary,
    backgroundColor: colors.soft,
  },

  details: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: colors.inputBackground,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  semLabel: { fontWeight: "800", marginBottom: 10, color: colors.text },
  assessmentRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  assName: { fontWeight: "600", color: colors.text },
  assMeta: { color: MUTED, marginTop: 4 },
  noAssess: { color: MUTED, fontStyle: "italic" },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.36)" },
  sheetContainer: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.card, borderTopLeftRadius: 14, borderTopRightRadius: 14, paddingTop: 6, paddingHorizontal: 12, elevation: 12 },
  handleRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  sheetHandleTouchable: { alignItems: "center", paddingVertical: 8, flex: 0 },
  sheetHandle: { width: 48, height: 6, borderRadius: 6, backgroundColor: colors.border },
  handleDragZone: { position: "absolute", top: 0, left: 0, right: 0, height: 36 }, // captures drags on handle area

  semCard: { backgroundColor: colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 10 },
  quarterBlock: { marginTop: 10, paddingTop: 8 },
  assRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomColor: colors.border, borderBottomWidth: 1 },
  sheetSectionTitle: { fontWeight: "700", marginBottom: 8, color: colors.text },
  quarterTitle: { fontWeight: "800", fontSize: 15, color: colors.text },
  assessmentName: { fontWeight: "600", color: colors.text },

  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: PRIMARY, alignItems: "center", justifyContent: "center" },
  teacherName: { fontWeight: "700", color: colors.text },
  semDropdownWrap: {
    position: "relative",
    zIndex: 30,
  },
  semSelector: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.card,
  },
  semDropdownMenu: {
    position: "absolute",
    top: 42,
    right: 0,
    minWidth: 110,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 6,
  },
  semOption: {
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  semOptionActive: {
    backgroundColor: colors.soft,
  },
  semOptionText: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 12,
  },

  sheetQuarter: { marginBottom: 12 },
  sheetBtn: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: 10, marginHorizontal: 6 },
  sheetBtnSecondary: { backgroundColor: colors.inputBackground },
  sheetBtnText: { fontWeight: "700", color: colors.text },
});
}