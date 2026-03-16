import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Alert,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";

import { ref as dbRef, get, set } from "firebase/database";
import { ref as stRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { database, storage } from "../constants/firebaseConfig";

const PRIMARY = "#0B72FF";
const MUTED = "#6B78A8";

export default function TakeAssessment() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { assessmentId } = useLocalSearchParams();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);

  const [schoolKey, setSchoolKey] = useState(null);
  const [studentId, setStudentId] = useState(null);

  const [assessment, setAssessment] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});

  const [timeLeftMs, setTimeLeftMs] = useState(null);
  const autoSubmittedRef = useRef(false);

  const draftKey = useMemo(() => {
    if (!assessmentId || !studentId) return null;
    return `assessmentDraft:${assessmentId}:${studentId}`;
  }, [assessmentId, studentId]);

  useEffect(() => {
    (async () => {
      try {
        const sid =
          (await AsyncStorage.getItem("studentNodeKey")) ||
          (await AsyncStorage.getItem("studentId")) ||
          (await AsyncStorage.getItem("username"));

        setStudentId(sid || null);

        const sKey = await resolveSchoolKeyFast(sid);
        setSchoolKey(sKey);

        const submitted = await hasStudentSubmitted({
          schoolKey: sKey,
          assessmentId,
          studentId: sid,
        });
        setAlreadySubmitted(submitted);

        const a = await loadAssessment(sKey, assessmentId);
        setAssessment(a);

        const qs = await resolveQuestionsDynamic({
          questionRefs: a?.questionRefs || {},
          schoolKey: sKey,
        });
        setQuestions(qs);

        if (!submitted && sid && assessmentId) {
          const raw = await AsyncStorage.getItem(`assessmentDraft:${assessmentId}:${sid}`);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed?.answers) setAnswers(parsed.answers);
            } catch {}
          }
        }
      } catch {
        Alert.alert("Error", "Failed to load assessment.");
      } finally {
        setLoading(false);
      }
    })();
  }, [assessmentId]);

  useEffect(() => {
    if (!assessment?.dueDate) return;
    const dueTs = Number(assessment.dueDate);
    if (Number.isNaN(dueTs) || dueTs <= 0) return; // <=0 means no timer

    const tick = () => {
      const left = dueTs - Date.now();
      setTimeLeftMs(left);
      if (left <= 0 && !autoSubmittedRef.current && !submitting && !alreadySubmitted) {
        autoSubmittedRef.current = true;
        submitAssessment(true);
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [assessment, submitting, alreadySubmitted]);

  useEffect(() => {
    if (!draftKey || alreadySubmitted) return;
    const id = setTimeout(async () => {
      try {
        await AsyncStorage.setItem(draftKey, JSON.stringify({ savedAt: Date.now(), answers }));
      } catch {}
    }, 300);
    return () => clearTimeout(id);
  }, [answers, draftKey, alreadySubmitted]);

  const totalPoints = useMemo(
    () => questions.reduce((sum, q) => sum + Number(q.points || 0), 0),
    [questions]
  );

  const readOnly = alreadySubmitted || submitting || (timeLeftMs !== null && timeLeftMs <= 0);

  const setMcq = (qid, option) => {
    if (readOnly) return;
    setAnswers((p) => ({ ...p, [qid]: { type: "mcq", value: option } }));
  };

  const setFillBlank = (qid, text) => {
    if (readOnly) return;
    setAnswers((p) => ({ ...p, [qid]: { type: "fill_blank", value: text } }));
  };

  const setWrittenText = (qid, text) => {
    if (readOnly) return;
    const prev = answers[qid] || { type: "written", textAnswer: "", imageUrls: {} };
    setAnswers((p) => ({ ...p, [qid]: { ...prev, type: "written", textAnswer: text } }));
  };

  const addWrittenImage = async (qid) => {
    if (readOnly) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission required", "Allow photo access to upload images.");
        return;
      }

      const pick = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });

      if (pick.canceled || !pick.assets?.length) return;
      const localUri = pick.assets[0].uri;

      const url = await uploadSubmissionImage({
        localUri,
        assessmentId: String(assessmentId),
        studentId: String(studentId),
        qid: String(qid),
      });

      const prev = answers[qid] || { type: "written", textAnswer: "", imageUrls: {} };
      const nextImageUrls = { ...(prev.imageUrls || {}) };
      const key = `img${Object.keys(nextImageUrls).length + 1}`;
      nextImageUrls[key] = url;

      setAnswers((p) => ({
        ...p,
        [qid]: { ...prev, type: "written", imageUrls: nextImageUrls },
      }));
    } catch {
      Alert.alert("Upload failed", "Could not upload image.");
    }
  };

  const removeWrittenImage = (qid, imageKey) => {
    if (readOnly) return;
    const prev = answers[qid];
    if (!prev?.imageUrls) return;
    const next = { ...prev.imageUrls };
    delete next[imageKey];
    setAnswers((p) => ({ ...p, [qid]: { ...prev, imageUrls: next } }));
  };

  const submitAssessment = async (isAuto = false) => {
    try {
      if (!studentId || !assessmentId || submitting || alreadySubmitted) return;
      setSubmitting(true);

      const submitted = await hasStudentSubmitted({ schoolKey, assessmentId, studentId });
      if (submitted) {
        setAlreadySubmitted(true);
        Alert.alert("Already submitted", "You already submitted this assessment.");
        return;
      }

      let autoScore = 0;
      const packedAnswers = {};

      for (const q of questions) {
        const a = answers[q.id];
        if (!a) continue;

        if (q.type === "mcq") {
          packedAnswers[q.id] = { type: "mcq", value: a.value || "" };
          if ((a.value || "") === (q.correctAnswer || "")) autoScore += Number(q.points || 0);
        } else if (q.type === "fill_blank") {
          const studentValue = String(a.value || "").trim().toLowerCase();
          const correct = String(q.correctAnswer || "").trim().toLowerCase();
          packedAnswers[q.id] = { type: "fill_blank", value: a.value || "" };
          if (studentValue && studentValue === correct) autoScore += Number(q.points || 0);
        } else {
          packedAnswers[q.id] = {
            type: "written",
            textAnswer: a.textAnswer || "",
            imageUrls: a.imageUrls || {},
          };
        }
      }

      const now = Date.now();
      const payload = {
        answers: packedAnswers,
        autoScore,
        teacherScore: 0,
        finalScore: autoScore,
        status: "submitted",
        submittedAt: now,
      };

      const base = schoolKey
        ? `Platform1/Schools/${schoolKey}/SchoolExams`
        : `SchoolExams`;

      await set(dbRef(database, `${base}/AssessmentSubmissions/${assessmentId}/${studentId}`), payload);
      await set(dbRef(database, `${base}/SubmissionIndex/${assessmentId}/${studentId}`), {
        submittedAt: now,
        finalScore: autoScore,
        status: "submitted",
      });

      if (draftKey) await AsyncStorage.removeItem(draftKey);
      setAlreadySubmitted(true);

      Alert.alert(
        isAuto ? "Time up" : "Submitted",
        isAuto ? "Assessment auto-submitted." : "Your assessment has been submitted."
      );
      router.back();
    } catch {
      Alert.alert("Submit failed", "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (!assessment) {
    return (
      <SafeAreaView style={[styles.center, { paddingTop: insets.top }]}>
        <Text>Assessment not found.</Text>
      </SafeAreaView>
    );
  }

  const timerText = formatTimeLeft(timeLeftMs);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 14,
          paddingBottom: Math.max(28, insets.bottom + 20),
        }}
      >
        <View style={styles.topNav}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backIconBtn}>
            <Ionicons name="arrow-back" size={20} color={PRIMARY} />
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>{assessment.title || "Assessment"}</Text>
        <Text style={styles.meta}>Total: {assessment.totalPoints || totalPoints} pts</Text>
        {Number(assessment?.dueDate || 0) > 0 ? (
          <Text style={[styles.meta, { color: timeLeftMs <= 0 ? "#EF4444" : MUTED }]}>
            Time left: {timerText}
          </Text>
        ) : (
          <Text style={styles.meta}>No time limit</Text>
        )}

        {alreadySubmitted && (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>Already submitted. You cannot submit again.</Text>
          </View>
        )}

        {questions.map((q, idx) => (
          <View key={q.id} style={styles.card}>
            <Text style={styles.qTitle}>{idx + 1}. {q.question}</Text>
            <Text style={styles.qMeta}>{q.type} • {q.points || 0} pts</Text>

            {q.type === "mcq" && (
              <View style={{ marginTop: 8 }}>
                {Object.keys(q.options || {}).map((k) => {
                  const selected = answers[q.id]?.value === k;
                  return (
                    <TouchableOpacity
                      key={k}
                      style={[styles.opt, selected && styles.optSelected, readOnly && { opacity: 0.7 }]}
                      onPress={() => setMcq(q.id, k)}
                      disabled={readOnly}
                    >
                      <Text>{k}. {q.options[k]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {q.type === "fill_blank" && (
              <TextInput
                placeholder="Type your answer"
                style={styles.input}
                value={answers[q.id]?.value || ""}
                onChangeText={(t) => setFillBlank(q.id, t)}
                editable={!readOnly}
              />
            )}

            {q.type === "written" && (
              <View style={{ marginTop: 8 }}>
                <TextInput
                  multiline
                  placeholder="Write your answer..."
                  style={[styles.input, { minHeight: 90 }]}
                  value={answers[q.id]?.textAnswer || ""}
                  onChangeText={(t) => setWrittenText(q.id, t)}
                  editable={!readOnly}
                />

                <TouchableOpacity
                  style={[styles.uploadBtn, readOnly && { opacity: 0.6 }]}
                  onPress={() => addWrittenImage(q.id)}
                  disabled={readOnly}
                >
                  <Text style={styles.uploadText}>+ Add handwritten image</Text>
                </TouchableOpacity>

                <View style={styles.imageRow}>
                  {Object.entries(answers[q.id]?.imageUrls || {}).map(([k, url]) => (
                    <View key={k} style={styles.imgWrap}>
                      <Image source={{ uri: url }} style={styles.img} />
                      {!readOnly && (
                        <TouchableOpacity style={styles.removeImgBtn} onPress={() => removeWrittenImage(q.id, k)}>
                          <Text style={{ color: "#fff", fontSize: 11 }}>✕</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        ))}

        <TouchableOpacity
          style={[styles.submitBtn, (readOnly || submitting) && { opacity: 0.65 }]}
          onPress={() => submitAssessment(false)}
          disabled={readOnly || submitting}
        >
          <Text style={styles.submitText}>
            {alreadySubmitted ? "Already Submitted" : submitting ? "Submitting..." : "Submit Assessment"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------------- Helpers ---------------- */

async function resolveSchoolKeyFast(studentId) {
  if (!studentId) return null;

  try {
    const cached = await AsyncStorage.getItem("schoolKey");
    if (cached) return cached;
  } catch {}

  try {
    const schoolsSnap = await get(dbRef(database, `Platform1/Schools`));
    if (!schoolsSnap.exists()) return null;
    const schools = schoolsSnap.val() || {};
    for (const key of Object.keys(schools)) {
      const s = await get(dbRef(database, `Platform1/Schools/${key}/Students/${studentId}`));
      if (s.exists()) {
        try { await AsyncStorage.setItem("schoolKey", key); } catch {}
        return key;
      }
    }
  } catch {}

  return null;
}

async function hasStudentSubmitted({ schoolKey, assessmentId, studentId }) {
  if (!assessmentId || !studentId) return false;

  try {
    if (schoolKey) {
      const scoped = await get(
        dbRef(database, `Platform1/Schools/${schoolKey}/SchoolExams/SubmissionIndex/${assessmentId}/${studentId}`)
      );
      if (scoped.exists()) return true;
    }
  } catch {}

  try {
    const global = await get(dbRef(database, `SchoolExams/SubmissionIndex/${assessmentId}/${studentId}`));
    if (global.exists()) return true;
  } catch {}

  return false;
}

async function loadAssessment(schoolKey, assessmentId) {
  if (!assessmentId) return null;

  if (schoolKey) {
    const snap = await get(dbRef(database, `Platform1/Schools/${schoolKey}/SchoolExams/Assessments/${assessmentId}`));
    if (snap.exists()) return snap.val();
  }

  const snap2 = await get(dbRef(database, `SchoolExams/Assessments/${assessmentId}`));
  if (snap2.exists()) return snap2.val();

  return null;
}

/**
 * Robust question resolver for changed QuestionBank structures:
 * - direct keyed: QB[qid]
 * - nested arbitrary depth: QB/.../.../qid
 * - avoids per-question full scans by flattening once per root
 */
async function resolveQuestionsDynamic({ questionRefs, schoolKey }) {
  const ids = Object.values(questionRefs || {});
  if (!ids.length) return [];

  let scopedQB = null;
  let globalQB = null;

  if (schoolKey) {
    try {
      const s = await get(dbRef(database, `Platform1/Schools/${schoolKey}/SchoolExams/QuestionBank`));
      if (s.exists()) scopedQB = s.val() || {};
    } catch {}
  }

  try {
    const g = await get(dbRef(database, `SchoolExams/QuestionBank`));
    if (g.exists()) globalQB = g.val() || {};
  } catch {}

  const mapScoped = flattenQuestionBank(scopedQB);
  const mapGlobal = flattenQuestionBank(globalQB);

  return ids
    .map((qid) => mapScoped[qid] || mapGlobal[qid] || null)
    .filter(Boolean)
    .map((q) => ({ ...q }));
}

function flattenQuestionBank(root) {
  const out = {};
  if (!root || typeof root !== "object") return out;

  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    for (const [key, val] of Object.entries(node)) {
      if (!val || typeof val !== "object") continue;

      // heuristic: a question object must have at least type + question
      const isQuestion =
        typeof val.type === "string" &&
        typeof val.question === "string";

      if (isQuestion) {
        out[key] = { id: key, ...val };
      } else {
        stack.push(val);
      }
    }
  }
  return out;
}

function formatTimeLeft(ms) {
  if (ms == null) return "--:--";
  if (ms <= 0) return "00:00";

  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function uploadSubmissionImage({ localUri, assessmentId, studentId, qid }) {
  const blob = await uriToBlob(localUri);
  const filename = `${Date.now()}.jpg`;
  const path = `school_exam_submissions/${assessmentId}/${studentId}/${qid}/${filename}`;
  const sRef = stRef(storage, path);

  await uploadBytes(sRef, blob, { contentType: "image/jpeg" });
  const url = await getDownloadURL(sRef);
  return url;
}

async function uriToBlob(uri) {
  const res = await fetch(uri);
  return await res.blob();
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  topNav: { marginBottom: 6 },
  backIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#EEF4FF",
    alignItems: "center",
    justifyContent: "center",
  },

  title: { fontSize: 20, fontWeight: "900", marginBottom: 4 },
  meta: { color: MUTED, marginBottom: 6, fontWeight: "600" },

  infoBox: {
    backgroundColor: "#EEF4FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  infoText: { color: PRIMARY, fontWeight: "700", fontSize: 12 },

  card: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#fff",
  },
  qTitle: { fontSize: 15, fontWeight: "700" },
  qMeta: { marginTop: 2, fontSize: 12, color: MUTED },

  opt: {
    padding: 10,
    borderWidth: 1,
    borderColor: "#dbeafe",
    borderRadius: 10,
    marginTop: 8,
    backgroundColor: "#fff",
  },
  optSelected: {
    borderColor: PRIMARY,
    backgroundColor: "#EEF4FF",
  },

  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 10,
    textAlignVertical: "top",
  },

  uploadBtn: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#EEF4FF",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  uploadText: { color: PRIMARY, fontWeight: "700", fontSize: 12 },

  imageRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
  imgWrap: { width: 74, height: 74, marginRight: 8, marginBottom: 8, position: "relative" },
  img: { width: "100%", height: "100%", borderRadius: 8, backgroundColor: "#f3f4f6" },
  removeImgBtn: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
  },

  submitBtn: {
    marginTop: 16,
    backgroundColor: PRIMARY,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  submitText: { color: "#fff", fontWeight: "800" },
});