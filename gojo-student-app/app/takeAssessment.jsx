import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Image,
  Modal,
  Animated,
  Easing,
  ActivityIndicator,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";

import { ref as dbRef, set } from "../lib/offlineDatabase";
import { ref as stRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { database, storage } from "../constants/firebaseConfig";
import { useAppTheme } from "../hooks/use-app-theme";
import { resolveSchoolKeyFromStudentId } from "./lib/dbHelpers";
import PageLoadingSkeleton from "../components/ui/page-loading-skeleton";
import {
  loadAssessmentBundleFromServer,
  readAssessmentSubmissionIndex,
  readDownloadedAssessmentBundle,
  updateCachedSubjectAssessmentStatus,
} from "../lib/schoolAssessments";

const PRIMARY = "#0B72FF";
const MUTED = "#6B78A8";
const SUCCESS = "#12B76A";
const DANGER = "#EF4444";
const CELEBRATION_THRESHOLD = 80;
const TAKE_ASSESSMENT_SUBMISSION_CACHE_MS = 90 * 1000;
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
  const warmSubmitted = String(params?.warmSubmitted || "") === "1";
  const warmAssessment = useMemo(() => {
    if (!assessmentId) return null;

    const warmTitle = String(params?.warmTitle || params?.title || "").trim();
    const warmDueDate = Number(params?.warmDueDate || 0);
    const warmTotalPoints = Number(params?.warmTotalPoints || 0);
    const warmQuestionCount = Number(params?.warmQuestionCount || 0);
    const warmType = String(params?.warmType || "").trim();

    if (!warmTitle && !warmDueDate && !warmTotalPoints && !warmQuestionCount && !warmType) {
      return null;
    }

    return {
      title: warmTitle || "Assessment",
      dueDate: warmDueDate || null,
      totalPoints: warmTotalPoints || 0,
      questionCount: warmQuestionCount || 0,
      type: warmType || "",
    };
  }, [assessmentId, params?.title, params?.warmDueDate, params?.warmQuestionCount, params?.warmTitle, params?.warmTotalPoints, params?.warmType]);
  const subjectAssessmentCacheParams = useMemo(() => ({
    courseId: String(params?.returnCourseId || ""),
    subject: String(params?.returnSubject || ""),
    grade: String(params?.returnGrade || ""),
    section: String(params?.returnSection || ""),
  }), [params?.returnCourseId, params?.returnGrade, params?.returnSection, params?.returnSubject]);

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
  const [alreadySubmitted, setAlreadySubmitted] = useState(warmSubmitted);
  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [resultSummary, setResultSummary] = useState({
    kind: "submitted",
    isAuto: false,
    finalScore: 0,
    totalPoints: 0,
  });

  const [schoolKey, setSchoolKey] = useState(null);
  const [studentId, setStudentId] = useState(null);

  const [assessment, setAssessment] = useState(() => warmAssessment);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);

  const [timeLeftMs, setTimeLeftMs] = useState(null);

  const draftKey = useMemo(() => {
    if (!assessmentId || !studentId) return null;
    return `assessmentDraft:${assessmentId}:${studentId}`;
  }, [assessmentId, studentId]);

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

        const submissionIndex = await readAssessmentSubmissionIndex({
          schoolKey: sKey,
          assessmentId,
          studentId: sid,
          maxAgeMs: TAKE_ASSESSMENT_SUBMISSION_CACHE_MS,
        });
        const submitted = !!submissionIndex;
        setAlreadySubmitted(submitted);

        let bundle = sid && assessmentId
          ? await readDownloadedAssessmentBundle(sid, assessmentId)
          : null;

        if (!bundle?.assessment || !Array.isArray(bundle?.questions) || !bundle.questions.length) {
          bundle = await loadAssessmentBundleFromServer({
            schoolKey: sKey,
            assessmentId,
          });
        }

        const nextAssessment = bundle?.assessment || null;
        const nextQuestions = Array.isArray(bundle?.questions) ? bundle.questions : [];

        setAssessment(nextAssessment);
        setQuestions(nextQuestions);

        if (submitted && sid && String(params?.returnTo || "") === "subjectAssessments") {
          void updateCachedSubjectAssessmentStatus({
            studentId: sid,
            assessmentId,
            submitted: true,
            finalScore:
              typeof submissionIndex?.finalScore === "number"
                ? submissionIndex.finalScore
                : null,
            ...subjectAssessmentCacheParams,
          });
        }

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
  }, [assessmentId, params?.returnTo, subjectAssessmentCacheParams]);

  useEffect(() => {
    if (!assessment?.dueDate) return;

    const dueTs = normalizeUnixTimestamp(assessment.dueDate);
    if (!dueTs || dueTs <= 0) return;

    const tick = () => {
      const left = dueTs - Date.now();
      setTimeLeftMs(left);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [assessment]);

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

  const isExpired = !alreadySubmitted && timeLeftMs !== null && timeLeftMs <= 0;
  const readOnly = alreadySubmitted || submitting;

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

  useEffect(() => {
    if (!questions.length) {
      if (activeQuestionIndex !== 0) setActiveQuestionIndex(0);
      return;
    }

    if (activeQuestionIndex > questions.length - 1) {
      setActiveQuestionIndex(questions.length - 1);
    }
  }, [activeQuestionIndex, questions.length]);

  const totalQuestions = questions.length;
  const currentQuestion = totalQuestions ? questions[activeQuestionIndex] || null : null;
  const currentQuestionAnswer = currentQuestion ? answers[currentQuestion.id] : null;
  const currentWrittenHasImage = Object.keys(currentQuestionAnswer?.imageUrls || {}).length > 0;
  const currentCorrectAnswerRaw = String(currentQuestion?.correctAnswer || "").trim();
  const currentResponseEntered = useMemo(() => {
    if (!currentQuestion || !currentQuestionAnswer) return false;
    if (currentQuestion.type === "written") {
      return !!String(currentQuestionAnswer.textAnswer || "").trim() || Object.keys(currentQuestionAnswer.imageUrls || {}).length > 0;
    }
    return !!String(currentQuestionAnswer.value || "").trim();
  }, [currentQuestion, currentQuestionAnswer]);
  const shouldRevealExpiredAnswer = useMemo(() => {
    return isExpired && !alreadySubmitted && !!currentQuestion && !!currentCorrectAnswerRaw && currentResponseEntered;
  }, [alreadySubmitted, currentCorrectAnswerRaw, currentQuestion, currentResponseEntered, isExpired]);
  const expiredAnswerIsCorrect = useMemo(() => {
    if (!shouldRevealExpiredAnswer || !currentQuestion || !currentQuestionAnswer) return false;

    const studentValue = String(currentQuestionAnswer.value || currentQuestionAnswer.textAnswer || "").trim();
    if (!studentValue) return false;

    if (currentQuestion.type === "mcq") {
      return studentValue === currentCorrectAnswerRaw;
    }

    return studentValue.toLowerCase() === currentCorrectAnswerRaw.toLowerCase();
  }, [currentCorrectAnswerRaw, currentQuestion, currentQuestionAnswer, shouldRevealExpiredAnswer]);
  const currentCorrectAnswerDisplay = useMemo(() => {
    if (!currentQuestion || !currentCorrectAnswerRaw) return "";
    if (currentQuestion.type === "mcq") {
      const optionText = currentQuestion.options?.[currentCorrectAnswerRaw];
      return optionText ? `${currentCorrectAnswerRaw}. ${optionText}` : currentCorrectAnswerRaw;
    }
    return currentCorrectAnswerRaw;
  }, [currentCorrectAnswerRaw, currentQuestion]);
  const questionProgressPercent = totalQuestions > 0
    ? Math.min(100, Math.max(0, ((activeQuestionIndex + 1) / totalQuestions) * 100))
    : 0;
  const isLastQuestion = totalQuestions > 0 && activeQuestionIndex >= totalQuestions - 1;

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

  const submitAssessment = async (isAuto = false) => {
    try {
      if (!studentId || !assessmentId || submitting || alreadySubmitted) return;
      if (isExpired) {
        Alert.alert("Assessment expired", "Submission is closed. The student can only practice the questions.");
        return;
      }
      setSubmitting(true);

      const submissionIndex = await readAssessmentSubmissionIndex({
        schoolKey,
        assessmentId,
        studentId,
        maxAgeMs: 0,
      });
      const submitted = !!submissionIndex;
      if (submitted) {
        setAlreadySubmitted(true);
        if (String(params?.returnTo || "") === "subjectAssessments") {
          void updateCachedSubjectAssessmentStatus({
            studentId,
            assessmentId,
            submitted: true,
            finalScore:
              typeof submissionIndex?.finalScore === "number"
                ? submissionIndex.finalScore
                : null,
            ...subjectAssessmentCacheParams,
          });
        }
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
      if (studentId && String(params?.returnTo || "") === "subjectAssessments") {
        void updateCachedSubjectAssessmentStatus({
          studentId,
          assessmentId,
          submitted: true,
          finalScore: Number(autoScore || 0),
          ...subjectAssessmentCacheParams,
        });
      }
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

  const timerText = formatTimeLeft(timeLeftMs);
  const dueLabel = formatDueDate(assessment?.dueDate);
  const resultPercent = resultSummary.totalPoints > 0
    ? Math.round((resultSummary.finalScore / resultSummary.totalPoints) * 100)
    : 0;
  const shouldCelebrate = resultModalVisible && resultPercent >= CELEBRATION_THRESHOLD;
  const isAlreadySubmission = resultSummary.kind === "already";
  const primaryActionLabel = alreadySubmitted
    ? (isLastQuestion ? "Finish" : "Next")
    : isExpired
    ? (isLastQuestion ? "Finish" : "Next")
    : submitting
    ? "Submitting..."
    : (isLastQuestion ? "Submit" : "Next");

  const handlePrimaryAction = () => {
    if (!totalQuestions) return;

    if (alreadySubmitted) {
      if (isLastQuestion) {
        handleBackNavigation();
        return;
      }
      setActiveQuestionIndex((index) => Math.min(totalQuestions - 1, index + 1));
      return;
    }

    if (isExpired) {
      if (isLastQuestion) {
        handleBackNavigation();
        return;
      }
      setActiveQuestionIndex((index) => Math.min(totalQuestions - 1, index + 1));
      return;
    }

    if (isLastQuestion) {
      void submitAssessment(false);
      return;
    }

    setActiveQuestionIndex((index) => Math.min(totalQuestions - 1, index + 1));
  };

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

  if (loading && !assessment) {
    return (
      <PageLoadingSkeleton variant="detail" style={[styles.screen, { paddingTop: insets.top }]} />
    );
  }

  if (!assessment) {
    return (
      <SafeAreaView style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>Assessment not found.</Text>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <PageLoadingSkeleton variant="detail" style={[styles.screen, { paddingTop: insets.top }]} />
    );
  }

  const closeResultModal = () => {
    setResultModalVisible(false);
    handleBackNavigation();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.examShell, { paddingTop: insets.top + 8 }]}> 
        <View style={styles.examHeaderBar}>
          <TouchableOpacity onPress={handleBackNavigation} style={styles.backIconBtn}>
            <Ionicons name="arrow-back" size={20} color={PRIMARY} />
          </TouchableOpacity>

          <View style={styles.examHeaderCopy}>
            <Text numberOfLines={1} style={styles.examTitle}>{assessment.title || "Assessment"}</Text>
            <Text style={styles.examSubtitle}>
              {totalQuestions ? `Question ${Math.min(activeQuestionIndex + 1, totalQuestions)} / ${totalQuestions}` : "Preparing questions"}
            </Text>
          </View>

          {Number(assessment?.dueDate || 0) > 0 ? (
            <View style={[styles.timerPill, styles.headerTimerPill]}>
              <Ionicons
                name="time-outline"
                size={14}
                color={timeLeftMs <= 0 ? DANGER : PRIMARY}
              />
              {isExpired ? (
                <Text style={[styles.timerStatusText, { color: DANGER }]}>Expired</Text>
              ) : null}
              <Text style={[styles.timerText, { color: timeLeftMs <= 0 ? DANGER : PRIMARY }]}>{timerText}</Text>
            </View>
          ) : (
            <View style={[styles.timerPillMuted, styles.headerTimerPill]}>
              <Ionicons name="time-outline" size={14} color={MUTED} />
              <Text style={styles.timerMutedText}>No time limit</Text>
            </View>
          )}
        </View>

        <View style={styles.examMetaRow}>
          <View style={styles.examMetaPill}>
            <Ionicons name="ribbon-outline" size={13} color={PRIMARY} />
            <Text style={styles.examMetaPillText}>{assessment.totalPoints || totalPoints} pts</Text>
          </View>
          <View style={styles.examMetaPill}>
            <Ionicons name="calendar-outline" size={13} color={PRIMARY} />
            <Text style={styles.examMetaPillText}>{dueLabel}</Text>
          </View>
          <View style={styles.examMetaPill}>
            <Ionicons name="checkmark-circle-outline" size={13} color={PRIMARY} />
            <Text style={styles.examMetaPillText}>{answeredCount}/{totalQuestions || 0} answered</Text>
          </View>
        </View>

        {alreadySubmitted ? (
          <View style={styles.infoBox}>
            <Ionicons name="checkmark-circle" size={16} color={PRIMARY} />
            <Text style={styles.infoText}>Submitted already. You can review your answers only.</Text>
          </View>
        ) : null}

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${questionProgressPercent}%` }]} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.examBody, { paddingBottom: Math.max(24, insets.bottom + 16) }]}
          showsVerticalScrollIndicator={false}
        >
          {currentQuestion ? (
            <View style={styles.card}>
              <View style={styles.qHeader}>
                <Text style={styles.qNumber}>Q{activeQuestionIndex + 1}</Text>
                <Text style={styles.qPoints}>{currentQuestion.points || 0} pts</Text>
              </View>

              <Text style={styles.qTitle}>{currentQuestion.question}</Text>
              <Text style={styles.qMeta}>{String(currentQuestion.type || "").replace(/_/g, " ")}</Text>

              {currentQuestion.type === "mcq" ? (
                <View style={styles.answerBlock}>
                  {Object.keys(currentQuestion.options || {}).map((key) => {
                    const selected = currentQuestionAnswer?.value === key;
                    const isCorrectOption = shouldRevealExpiredAnswer && currentCorrectAnswerRaw === key;
                    const isWrongSelected = shouldRevealExpiredAnswer && selected && currentCorrectAnswerRaw !== key;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[
                          styles.opt,
                          selected && styles.optSelected,
                          isCorrectOption && styles.optCorrect,
                          isWrongSelected && styles.optWrong,
                          readOnly && { opacity: 0.7 },
                        ]}
                        onPress={() => setMcq(currentQuestion.id, key)}
                        disabled={readOnly}
                      >
                        <Text style={styles.optText}>{key}. {currentQuestion.options[key]}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}

              {currentQuestion.type === "true_false" ? (
                <View style={styles.answerBlockRow}>
                  {["True", "False"].map((value) => {
                    const selected = String(currentQuestionAnswer?.value || "").toLowerCase() === value.toLowerCase();
                    const isCorrectOption = shouldRevealExpiredAnswer && currentCorrectAnswerRaw.toLowerCase() === value.toLowerCase();
                    const isWrongSelected = shouldRevealExpiredAnswer && selected && currentCorrectAnswerRaw.toLowerCase() !== value.toLowerCase();

                    return (
                      <TouchableOpacity
                        key={value}
                        style={[
                          styles.tfBtn,
                          selected && styles.tfBtnSelected,
                          isCorrectOption && styles.tfBtnCorrect,
                          isWrongSelected && styles.tfBtnWrong,
                          readOnly && { opacity: 0.7 },
                        ]}
                        onPress={() => setTrueFalse(currentQuestion.id, value)}
                        disabled={readOnly}
                      >
                        <Text style={[styles.tfText, selected && styles.tfTextSelected]}>{value}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}

              {currentQuestion.type === "fill_blank" ? (
                <TextInput
                  placeholder="Type your answer"
                  placeholderTextColor={colors.muted}
                  style={[
                    styles.input,
                    shouldRevealExpiredAnswer && expiredAnswerIsCorrect ? styles.inputCorrect : null,
                    shouldRevealExpiredAnswer && !expiredAnswerIsCorrect ? styles.inputWrong : null,
                  ]}
                  value={currentQuestionAnswer?.value || ""}
                  onChangeText={(text) => setFillBlank(currentQuestion.id, text)}
                  editable={!readOnly}
                />
              ) : null}

              {currentQuestion.type === "written" ? (
                <View style={styles.answerBlock}>
                  <TextInput
                    multiline
                    placeholder={
                      currentWrittenHasImage
                        ? "Writing disabled because image answer is attached."
                        : "Write your answer..."
                    }
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { minHeight: 120 }, currentWrittenHasImage && styles.inputDisabled]}
                    value={currentQuestionAnswer?.textAnswer || ""}
                    onChangeText={(text) => setWrittenText(currentQuestion.id, text)}
                    editable={!readOnly && !currentWrittenHasImage}
                  />

                  <TouchableOpacity
                    style={[styles.uploadBtn, readOnly && { opacity: 0.6 }]}
                    onPress={() => addWrittenImage(currentQuestion.id)}
                    disabled={readOnly}
                  >
                    <MaterialCommunityIcons name="image-plus" size={14} color={PRIMARY} />
                    <Text style={styles.uploadText}>Add handwritten image</Text>
                  </TouchableOpacity>

                  {currentWrittenHasImage ? (
                    <Text style={styles.helperText}>Image answer attached. Text answer is disabled for this question.</Text>
                  ) : null}

                  <View style={styles.imageRow}>
                    {Object.entries(currentQuestionAnswer?.imageUrls || {}).map(([key, url]) => (
                      <View key={key} style={styles.imgWrap}>
                        <Image source={{ uri: url }} style={styles.img} />
                        {!readOnly ? (
                          <TouchableOpacity style={styles.removeImgBtn} onPress={() => removeWrittenImage(currentQuestion.id, key)}>
                            <Text style={styles.removeImgText}>✕</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {shouldRevealExpiredAnswer ? (
                <View style={styles.answerRevealCard}>
                  <Text style={[styles.answerRevealTitle, expiredAnswerIsCorrect ? styles.answerRevealTitleCorrect : styles.answerRevealTitleWrong]}>
                    {expiredAnswerIsCorrect ? "Correct" : "Answer"}
                  </Text>
                  <Text style={styles.answerRevealText}>
                    {expiredAnswerIsCorrect ? "Good. " : "Correct answer: "}
                    {expiredAnswerIsCorrect ? `Correct answer: ${currentCorrectAnswerDisplay}` : currentCorrectAnswerDisplay}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.loadingInfoCard}>
              <ActivityIndicator size="small" color={PRIMARY} />
              <Text style={styles.loadingInfoTitle}>Preparing assessment</Text>
              <Text style={styles.loadingInfoText}>Loading questions for this assessment.</Text>
            </View>
          )}
        </ScrollView>

        {totalQuestions > 0 ? (
          <View style={[styles.footerBar, { paddingBottom: Math.max(12, insets.bottom) }]}>
            <TouchableOpacity
              style={[styles.footerGhostBtn, activeQuestionIndex <= 0 && { opacity: 0.45 }]}
              onPress={() => setActiveQuestionIndex((index) => Math.max(0, index - 1))}
              disabled={activeQuestionIndex <= 0}
            >
              <Text style={styles.footerGhostText}>Previous</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.footerPrimaryBtn,
                submitting ? { opacity: 0.7 } : null,
              ]}
              onPress={handlePrimaryAction}
              disabled={submitting}
            >
              <Text style={styles.footerPrimaryText}>{primaryActionLabel}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

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
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },

  examShell: {
    flex: 1,
    paddingHorizontal: 14,
  },
  examHeaderBar: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  examHeaderCopy: {
    flex: 1,
    minWidth: 0,
    marginHorizontal: 12,
  },
  examTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  examSubtitle: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  examMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 12,
  },
  examMetaPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginRight: 8,
    marginBottom: 8,
  },
  examMetaPillText: {
    marginLeft: 6,
    color: colors.text,
    fontSize: 11.5,
    fontWeight: "700",
  },
  headerTimerPill: {
    alignSelf: "auto",
    marginTop: 0,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: "hidden",
    marginBottom: 12,
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: PRIMARY,
  },
  examBody: {
    flexGrow: 1,
  },

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
  timerStatusText: {
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
  loadingInfoCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 16,
    backgroundColor: colors.card,
    marginBottom: 12,
    alignItems: "center",
  },
  loadingInfoTitle: {
    marginTop: 10,
    color: colors.text,
    fontWeight: "800",
    fontSize: 14,
  },
  loadingInfoText: {
    marginTop: 4,
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
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
    backgroundColor: colors.infoSurface,
    borderWidth: 1,
    borderColor: colors.infoBorder,
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
    backgroundColor: colors.infoSurface,
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
  optCorrect: {
    borderColor: SUCCESS,
    backgroundColor: "rgba(18,183,106,0.10)",
  },
  optWrong: {
    borderColor: DANGER,
    backgroundColor: "rgba(239,68,68,0.08)",
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
  tfBtnCorrect: {
    backgroundColor: "rgba(18,183,106,0.10)",
    borderColor: SUCCESS,
  },
  tfBtnWrong: {
    backgroundColor: "rgba(239,68,68,0.08)",
    borderColor: DANGER,
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
  inputCorrect: {
    borderColor: SUCCESS,
    backgroundColor: "rgba(18,183,106,0.06)",
  },
  inputWrong: {
    borderColor: DANGER,
    backgroundColor: "rgba(239,68,68,0.05)",
  },
  answerRevealCard: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: colors.panel,
  },
  answerRevealTitle: {
    fontSize: 13,
    fontWeight: "900",
  },
  answerRevealTitleCorrect: {
    color: SUCCESS,
  },
  answerRevealTitleWrong: {
    color: DANGER,
  },
  answerRevealText: {
    marginTop: 5,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
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
  footerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 10,
    backgroundColor: colors.background,
  },
  footerGhostBtn: {
    minWidth: 104,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    marginRight: 12,
  },
  footerGhostText: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 13,
  },
  footerPrimaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  footerPrimaryText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 13.5,
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