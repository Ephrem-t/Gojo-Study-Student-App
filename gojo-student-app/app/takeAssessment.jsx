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
  Modal,
  Animated,
  Easing,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";

import { ref as dbRef, get, set } from "firebase/database";
import { ref as stRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { database, storage } from "../constants/firebaseConfig";
import { useAppTheme } from "../hooks/use-app-theme";

const PRIMARY = "#0B72FF";
const MUTED = "#6B78A8";
const TEXT = "#0B2540";
const BORDER = "#EAF0FF";
const BG = "#FFFFFF";
const SUCCESS = "#12B76A";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";
const CELEBRATION_THRESHOLD = 80;
const RESULT_SPARKLES = [
  { left: "8%", top: 26, color: "#0B72FF", drop: -32, rotate: "-22deg" },
  { left: "18%", top: 12, color: "#12B76A", drop: -40, rotate: "12deg" },
  { left: "28%", top: 30, color: "#F59E0B", drop: -26, rotate: "-12deg" },
  { left: "39%", top: 10, color: "#7C3AED", drop: -44, rotate: "18deg" },
  { left: "52%", top: 24, color: "#EC4899", drop: -30, rotate: "-18deg" },
  { left: "63%", top: 10, color: "#0EA5E9", drop: -40, rotate: "16deg" },
  { left: "73%", top: 28, color: "#22C55E", drop: -28, rotate: "-16deg" },
  { left: "83%", top: 12, color: "#F97316", drop: -42, rotate: "20deg" },
  { left: "89%", top: 34, color: "#2563EB", drop: -24, rotate: "-14deg" },
];

export default function TakeAssessment() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { assessmentId } = params;

  const handleBackNavigation = () => {
    if (String(params?.returnTo || "") === "subjectAssessments") {
      router.replace({
        pathname: "/subjectAssessments",
        params: {
          courseId: String(params?.returnCourseId || ""),
          subject: String(params?.returnSubject || ""),
          grade: String(params?.returnGrade || ""),
          section: String(params?.returnSection || ""),
          returnTo: "exam",
          returnExamFilter: String(params?.returnExamFilter || "school"),
        },
      });
      return;
    }
    router.back();
  };

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [resultSummary, setResultSummary] = useState({
    kind: "submitted",
    isAuto: false,
    finalScore: 0,
    totalPoints: 0,
  });

  const [schoolKey, setSchoolKey] = useState(null);
  const [studentId, setStudentId] = useState(null);

  const [assessment, setAssessment] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);

  const [timeLeftMs, setTimeLeftMs] = useState(null);
  const autoSubmittedRef = useRef(false);
  const submitAssessmentRef = useRef(null);

  const draftKey = useMemo(() => {
    if (!assessmentId || !studentId) return null;
    return `assessmentDraft:${assessmentId}:${studentId}`;
  }, [assessmentId, studentId]);

  const scrollRef = useRef(null);
  const questionLayoutsRef = useRef({});
  const resultOverlayOpacity = useRef(new Animated.Value(0)).current;
  const resultCardTranslate = useRef(new Animated.Value(28)).current;
  const resultCardScale = useRef(new Animated.Value(0.94)).current;
  const sparkleAnims = useRef(RESULT_SPARKLES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!resultModalVisible) {
      resultOverlayOpacity.setValue(0);
      resultCardTranslate.setValue(28);
      resultCardScale.setValue(0.94);
      return;
    }

    Animated.parallel([
      Animated.timing(resultOverlayOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(resultCardTranslate, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(resultCardScale, {
        toValue: 1,
        speed: 14,
        bounciness: 6,
        useNativeDriver: true,
      }),
    ]).start();
  }, [resultModalVisible, resultOverlayOpacity, resultCardScale, resultCardTranslate]);

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

    const dueTs = normalizeUnixTimestamp(assessment.dueDate);
    if (!dueTs || dueTs <= 0) return;

    const tick = () => {
      const left = dueTs - Date.now();
      setTimeLeftMs(left);

      if (left <= 0 && !autoSubmittedRef.current && !submitting && !alreadySubmitted) {
        autoSubmittedRef.current = true;
        submitAssessmentRef.current?.(true);
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

  const answeredCount = useMemo(() => {
    return questions.filter((q) => {
      const a = answers[q.id];
      if (!a) return false;
      if (a.type === "written") {
        return !!String(a.textAnswer || "").trim() || Object.keys(a.imageUrls || {}).length > 0;
      }
      return !!String(a.value || "").trim();
    }).length;
  }, [questions, answers]);

  const setMcq = (qid, option) => {
    if (readOnly) return;
    setAnswers((p) => ({ ...p, [qid]: { type: "mcq", value: option } }));
  };

  const setTrueFalse = (qid, option) => {
    if (readOnly) return;
    setAnswers((p) => ({ ...p, [qid]: { type: "true_false", value: option } }));
  };

  const setFillBlank = (qid, text) => {
    if (readOnly) return;
    setAnswers((p) => ({ ...p, [qid]: { type: "fill_blank", value: text } }));
  };

  const setWrittenText = (qid, text) => {
    if (readOnly) return;
    const prev = answers[qid] || { type: "written", textAnswer: "", imageUrls: {} };
    if (Object.keys(prev.imageUrls || {}).length > 0) return;

    setAnswers((p) => ({
      ...p,
      [qid]: { ...prev, type: "written", textAnswer: text },
    }));
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
        [qid]: {
          ...prev,
          type: "written",
          textAnswer: "",
          imageUrls: nextImageUrls,
        },
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
    setAnswers((p) => ({
      ...p,
      [qid]: { ...prev, imageUrls: next },
    }));
  };

  const jumpToQuestion = (index) => {
    const y = questionLayoutsRef.current[index];
    if (scrollRef.current && typeof y === "number") {
      scrollRef.current.scrollTo({ y: Math.max(0, y - 90), animated: true });
      setActiveQuestionIndex(index);
    }
  };

  const handleScroll = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const entries = Object.entries(questionLayoutsRef.current);

    if (!entries.length) return;

    let current = 0;
    for (const [idx, top] of entries) {
      if (y + 120 >= top) current = Number(idx);
    }
    if (current !== activeQuestionIndex) setActiveQuestionIndex(current);
  };

  const submitAssessment = async (isAuto = false) => {
    try {
      if (!studentId || !assessmentId || submitting || alreadySubmitted) return;
      setSubmitting(true);

      const submitted = await hasStudentSubmitted({ schoolKey, assessmentId, studentId });
      if (submitted) {
        setAlreadySubmitted(true);
        setResultSummary({
          kind: "already",
          isAuto: false,
          finalScore: 0,
          totalPoints: Number(assessment?.totalPoints || totalPoints || 0),
        });
        setResultModalVisible(true);
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
        } else if (q.type === "true_false") {
          packedAnswers[q.id] = { type: "true_false", value: a.value || "" };
          if (
            String(a.value || "").trim().toLowerCase() ===
            String(q.correctAnswer || "").trim().toLowerCase()
          ) {
            autoScore += Number(q.points || 0);
          }
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
      setResultSummary({
        kind: "submitted",
        isAuto,
        finalScore: Number(autoScore || 0),
        totalPoints: Number(assessment?.totalPoints || totalPoints || 0),
      });
      setResultModalVisible(true);
    } catch {
      Alert.alert("Submit failed", "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  submitAssessmentRef.current = submitAssessment;

  const timerText = formatTimeLeft(timeLeftMs);
  const dueLabel = formatDueDate(assessment?.dueDate);
  const resultPercent = resultSummary.totalPoints > 0
    ? Math.round((resultSummary.finalScore / resultSummary.totalPoints) * 100)
    : 0;
  const shouldCelebrate = resultModalVisible && resultPercent >= CELEBRATION_THRESHOLD;
  const isAlreadySubmission = resultSummary.kind === "already";

  useEffect(() => {
    sparkleAnims.forEach((v) => v.setValue(0));
    if (!shouldCelebrate) return;

    const anims = sparkleAnims.map((v, idx) =>
      Animated.timing(v, {
        toValue: 1,
        duration: 760,
        delay: idx * 50,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      })
    );

    Animated.stagger(30, anims).start();
  }, [shouldCelebrate, sparkleAnims]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </SafeAreaView>
    );
  }

  if (!assessment) {
    return (
      <SafeAreaView style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>Assessment not found.</Text>
      </SafeAreaView>
    );
  }

  const closeResultModal = () => {
    setResultModalVisible(false);
    handleBackNavigation();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 14,
          paddingBottom: Math.max(28, insets.bottom + 20),
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topNav}>
          <TouchableOpacity onPress={handleBackNavigation} style={styles.backIconBtn}>
            <Ionicons name="arrow-back" size={20} color={PRIMARY} />
          </TouchableOpacity>
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.title}>{assessment.title || "Assessment"}</Text>
          <Text style={styles.metaLine}>Total: {assessment.totalPoints || totalPoints} pts</Text>
          <Text style={styles.metaLine}>Due: {dueLabel}</Text>
          <Text style={styles.metaLine}>Answered: {answeredCount}/{questions.length}</Text>

          {Number(assessment?.dueDate || 0) > 0 ? (
            <View style={styles.timerPill}>
              <Ionicons
                name="time-outline"
                size={14}
                color={timeLeftMs <= 0 ? DANGER : PRIMARY}
              />
              <Text
                style={[
                  styles.timerText,
                  { color: timeLeftMs <= 0 ? DANGER : PRIMARY },
                ]}
              >
                {timerText}
              </Text>
            </View>
          ) : (
            <View style={styles.timerPillMuted}>
              <Ionicons name="time-outline" size={14} color={MUTED} />
              <Text style={styles.timerMutedText}>No time limit</Text>
            </View>
          )}
        </View>

        {questions.length > 0 ? (
          <View style={styles.navCard}>
            <Text style={styles.navTitle}>Questions</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.navPillsRow}
            >
              {questions.map((q, index) => {
                const a = answers[q.id];
                const isAnswered =
                  a &&
                  (
                    (a.type === "written" &&
                      (!!String(a.textAnswer || "").trim() || Object.keys(a.imageUrls || {}).length > 0)) ||
                    (a.type !== "written" && !!String(a.value || "").trim())
                  );

                const isActive = index === activeQuestionIndex;

                return (
                  <TouchableOpacity
                    key={q.id}
                    style={[
                      styles.navPill,
                      isActive && styles.navPillActive,
                      isAnswered && !isActive && styles.navPillDone,
                    ]}
                    onPress={() => jumpToQuestion(index)}
                  >
                    <Text
                      style={[
                        styles.navPillText,
                        isActive && styles.navPillTextActive,
                        isAnswered && !isActive && styles.navPillTextDone,
                      ]}
                    >
                      Q{index + 1}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {alreadySubmitted && (
          <View style={styles.infoBox}>
            <Ionicons name="checkmark-circle" size={16} color={PRIMARY} />
            <Text style={styles.infoText}>Already submitted. You cannot submit again.</Text>
          </View>
        )}

        {questions.map((q, idx) => {
          const writtenHasImage = Object.keys(answers[q.id]?.imageUrls || {}).length > 0;

          return (
            <View
              key={q.id}
              style={styles.card}
              onLayout={(e) => {
                questionLayoutsRef.current[idx] = e.nativeEvent.layout.y;
              }}
            >
              <View style={styles.qHeader}>
                <Text style={styles.qNumber}>Q{idx + 1}</Text>
                <Text style={styles.qPoints}>{q.points || 0} pts</Text>
              </View>

              <Text style={styles.qTitle}>{q.question}</Text>
              <Text style={styles.qMeta}>{String(q.type || "").replace("_", " ")}</Text>

              {q.type === "mcq" && (
                <View style={styles.answerBlock}>
                  {Object.keys(q.options || {}).map((k) => {
                    const selected = answers[q.id]?.value === k;
                    return (
                      <TouchableOpacity
                        key={k}
                        style={[styles.opt, selected && styles.optSelected, readOnly && { opacity: 0.7 }]}
                        onPress={() => setMcq(q.id, k)}
                        disabled={readOnly}
                      >
                        <Text style={styles.optText}>{k}. {q.options[k]}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {q.type === "true_false" && (
                <View style={styles.answerBlockRow}>
                  {["True", "False"].map((value) => {
                    const selected =
                      String(answers[q.id]?.value || "").toLowerCase() === value.toLowerCase();

                    return (
                      <TouchableOpacity
                        key={value}
                        style={[styles.tfBtn, selected && styles.tfBtnSelected, readOnly && { opacity: 0.7 }]}
                        onPress={() => setTrueFalse(q.id, value)}
                        disabled={readOnly}
                      >
                        <Text style={[styles.tfText, selected && styles.tfTextSelected]}>{value}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {q.type === "fill_blank" && (
                <TextInput
                  placeholder="Type your answer"
                    placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={answers[q.id]?.value || ""}
                  onChangeText={(t) => setFillBlank(q.id, t)}
                  editable={!readOnly}
                />
              )}

              {q.type === "written" && (
                <View style={styles.answerBlock}>
                  <TextInput
                    multiline
                    placeholder={
                      writtenHasImage
                        ? "Writing disabled because image answer is attached."
                        : "Write your answer..."
                    }
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { minHeight: 100 }, writtenHasImage && styles.inputDisabled]}
                    value={answers[q.id]?.textAnswer || ""}
                    onChangeText={(t) => setWrittenText(q.id, t)}
                    editable={!readOnly && !writtenHasImage}
                  />

                  <TouchableOpacity
                    style={[styles.uploadBtn, readOnly && { opacity: 0.6 }]}
                    onPress={() => addWrittenImage(q.id)}
                    disabled={readOnly}
                  >
                    <MaterialCommunityIcons name="image-plus" size={14} color={PRIMARY} />
                    <Text style={styles.uploadText}>Add handwritten image</Text>
                  </TouchableOpacity>

                  {writtenHasImage ? (
                    <Text style={styles.helperText}>
                      Image answer attached. Text answer is disabled for this question.
                    </Text>
                  ) : null}

                  <View style={styles.imageRow}>
                    {Object.entries(answers[q.id]?.imageUrls || {}).map(([k, url]) => (
                      <View key={k} style={styles.imgWrap}>
                        <Image source={{ uri: url }} style={styles.img} />
                        {!readOnly && (
                          <TouchableOpacity
                            style={styles.removeImgBtn}
                            onPress={() => removeWrittenImage(q.id, k)}
                          >
                            <Text style={styles.removeImgText}>✕</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          );
        })}

        <TouchableOpacity
          style={[styles.submitBtn, (readOnly || submitting) && { opacity: 0.65 }]}
          onPress={() => submitAssessment(false)}
          disabled={readOnly || submitting}
        >
          <Text style={styles.submitText}>
            {alreadySubmitted
              ? "Already Submitted"
              : submitting
              ? "Submitting..."
              : "Submit Assessment"}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={resultModalVisible}
        transparent
        animationType="none"
        onRequestClose={closeResultModal}
      >
        <Animated.View style={[styles.resultOverlay, { opacity: resultOverlayOpacity }]}>
          <Animated.View
            style={[
              styles.resultCard,
              {
                transform: [
                  { translateY: resultCardTranslate },
                  { scale: resultCardScale },
                ],
              },
            ]}
          >
            <View style={styles.resultGlowTop} />
            <View style={styles.resultGlowBottom} />
            {shouldCelebrate ? (
              <View pointerEvents="none" style={styles.sparkleLayer}>
                {RESULT_SPARKLES.map((item, idx) => {
                  const progress = sparkleAnims[idx];
                  const opacity = progress.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] });
                  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, item.drop] });
                  const scale = progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.6, 1.08, 0.8] });

                  return (
                    <Animated.View
                      key={`sparkle-${idx}`}
                      style={[
                        styles.sparkleDot,
                        {
                          left: item.left,
                          top: item.top,
                          backgroundColor: item.color,
                          opacity,
                          transform: [{ translateY }, { scale }, { rotate: item.rotate }],
                        },
                      ]}
                    />
                  );
                })}
              </View>
            ) : null}

            <View style={styles.resultIconWrap}>
              <Ionicons name="checkmark-done" size={28} color="#fff" />
            </View>

            <Text style={styles.resultTitle}>
              {isAlreadySubmission
                ? "Already Submitted"
                : resultSummary.isAuto
                  ? "Time Is Up"
                  : "Assessment Submitted"}
            </Text>
            <Text style={styles.resultSubtitle}>
              {isAlreadySubmission
                ? "This assessment was already submitted before."
                : resultSummary.isAuto
                  ? "Your exam was auto-submitted successfully."
                  : "Great work. Your exam has been submitted successfully."}
            </Text>

            {!isAlreadySubmission ? (
              <View style={styles.resultStatsRow}>
                <View style={styles.resultStatBox}>
                  <Text style={styles.resultStatLabel}>Score</Text>
                  <Text style={styles.resultStatValue}>{resultSummary.finalScore}/{resultSummary.totalPoints || 0}</Text>
                </View>
                <View style={styles.resultStatDivider} />
                <View style={styles.resultStatBox}>
                  <Text style={styles.resultStatLabel}>Result</Text>
                  <Text style={styles.resultStatValue}>{resultPercent}%</Text>
                </View>
              </View>
            ) : (
              <View style={styles.resultInfoPill}>
                <Ionicons name="information-circle-outline" size={16} color={PRIMARY} />
                <Text style={styles.resultInfoText}>No duplicate submission allowed.</Text>
              </View>
            )}

            <TouchableOpacity style={styles.resultPrimaryBtn} onPress={closeResultModal} activeOpacity={0.9}>
              <Text style={styles.resultPrimaryText}>Continue</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </Modal>
    </SafeAreaView>
  );
}

/* ---------------- Helpers ---------------- */

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

  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
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

function createStyles(colors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },

  topNav: { marginBottom: 8 },
  backIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
  },

  heroCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 16,
    backgroundColor: colors.panel,
    marginBottom: 14,
  },
  title: { fontSize: 22, fontWeight: "900", color: colors.text, marginBottom: 6 },
  metaLine: { color: colors.muted, marginBottom: 5, fontWeight: "700", fontSize: 12.5 },

  timerPill: {
    alignSelf: "flex-start",
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.soft,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  timerText: {
    marginLeft: 6,
    fontWeight: "900",
    fontSize: 12,
  },
  timerPillMuted: {
    alignSelf: "flex-start",
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  timerMutedText: {
    marginLeft: 6,
    color: colors.muted,
    fontWeight: "800",
    fontSize: 12,
  },

  navCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 12,
    backgroundColor: colors.card,
    marginBottom: 12,
  },
  navTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.text,
    marginBottom: 10,
  },
  navPillsRow: {
    paddingRight: 4,
  },
  navPill: {
    minWidth: 46,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    paddingHorizontal: 10,
  },
  navPillActive: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  navPillDone: {
    backgroundColor: colors.soft,
    borderColor: colors.border,
  },
  navPillText: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 12,
  },
  navPillTextActive: {
    color: "#fff",
  },
  navPillTextDone: {
    color: SUCCESS,
  },

  infoBox: {
    backgroundColor: "#EEF4FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  infoText: {
    color: PRIMARY,
    fontWeight: "700",
    fontSize: 12,
    marginLeft: 8,
    flex: 1,
  },

  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    backgroundColor: colors.card,
  },
  qHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  qNumber: {
    backgroundColor: "#EEF4FF",
    color: PRIMARY,
    fontWeight: "900",
    fontSize: 11,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: "hidden",
  },
  qPoints: {
    color: MUTED,
    fontWeight: "800",
    fontSize: 11,
  },
  qTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
    marginTop: 10,
    lineHeight: 21,
  },
  qMeta: {
    marginTop: 4,
    fontSize: 11.5,
    color: colors.muted,
    fontWeight: "700",
    textTransform: "capitalize",
  },

  answerBlock: { marginTop: 10 },
  answerBlockRow: {
    marginTop: 10,
    flexDirection: "row",
  },

  opt: {
    padding: 11,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginTop: 8,
    backgroundColor: colors.card,
  },
  optSelected: {
    borderColor: PRIMARY,
    backgroundColor: colors.soft,
  },
  optText: {
    color: colors.text,
    fontWeight: "600",
    fontSize: 13,
  },

  tfBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  tfBtnSelected: {
    backgroundColor: colors.soft,
    borderColor: PRIMARY,
  },
  tfText: {
    color: colors.text,
    fontWeight: "700",
  },
  tfTextSelected: {
    color: PRIMARY,
  },

  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    textAlignVertical: "top",
    color: colors.text,
    backgroundColor: colors.card,
  },
  inputDisabled: {
    backgroundColor: colors.inputBackground,
    color: colors.muted,
  },

  uploadBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: colors.soft,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  uploadText: {
    color: PRIMARY,
    fontWeight: "700",
    fontSize: 12,
    marginLeft: 7,
  },
  helperText: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 11.5,
    fontWeight: "600",
  },

  imageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 10,
  },
  imgWrap: {
    width: 76,
    height: 76,
    marginRight: 8,
    marginBottom: 8,
    position: "relative",
  },
  img: {
    width: "100%",
    height: "100%",
    borderRadius: 10,
    backgroundColor: colors.inputBackground,
  },
  removeImgBtn: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
  },
  removeImgText: {
    color: "#fff",
    fontSize: 11,
  },

  submitBtn: {
    marginTop: 8,
    backgroundColor: PRIMARY,
    padding: 15,
    borderRadius: 14,
    alignItems: "center",
  },
  submitText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 14,
  },

  resultOverlay: {
    flex: 1,
    backgroundColor: "rgba(6, 15, 39, 0.56)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  resultCard: {
    width: "100%",
    maxWidth: 390,
    borderRadius: 24,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    alignItems: "center",
    overflow: "hidden",
    shadowColor: "#001946",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.24,
    shadowRadius: 20,
    elevation: 12,
  },
  resultGlowTop: {
    position: "absolute",
    top: -90,
    right: -80,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "rgba(11,114,255,0.12)",
  },
  resultGlowBottom: {
    position: "absolute",
    bottom: -80,
    left: -70,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(18,183,106,0.10)",
  },
  sparkleLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 90,
  },
  sparkleDot: {
    position: "absolute",
    width: 8,
    height: 14,
    borderRadius: 6,
  },
  resultIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    borderWidth: 4,
    borderColor: "rgba(11,114,255,0.18)",
  },
  resultTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  resultSubtitle: {
    color: colors.muted,
    marginTop: 8,
    textAlign: "center",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 20,
    paddingHorizontal: 6,
  },
  resultStatsRow: {
    width: "100%",
    marginTop: 16,
    marginBottom: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    flexDirection: "row",
    alignItems: "stretch",
  },
  resultStatBox: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  resultStatDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  resultStatLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  resultStatValue: {
    marginTop: 6,
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  resultInfoPill: {
    width: "100%",
    marginTop: 16,
    marginBottom: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  resultInfoText: {
    marginLeft: 6,
    color: colors.muted,
    fontWeight: "700",
    fontSize: 12,
  },
  resultPrimaryBtn: {
    width: "100%",
    borderRadius: 14,
    backgroundColor: PRIMARY,
    paddingVertical: 12,
    alignItems: "center",
  },
  resultPrimaryText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
});
}