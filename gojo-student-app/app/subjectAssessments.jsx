import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get } from "firebase/database";
import { database } from "../constants/firebaseConfig";
import { getSnapshot } from "./lib/dbHelpers";

const PRIMARY = "#0B72FF";
const MUTED = "#6B78A8";
const TEXT = "#0B2540";

function formatDueDate(dueDate) {
  if (!dueDate) return "No due date";
  const d = new Date(Number(dueDate));
  if (Number.isNaN(d.getTime())) return "No due date";
  return d.toLocaleDateString();
}

function getAssessmentStatus({ submitted, finalScore, dueDate }) {
  if (submitted) {
    if (typeof finalScore === "number") return { label: "Graded", color: "#10B981" };
    return { label: "Submitted", color: "#0EA5E9" };
  }
  if (dueDate) {
    const due = Number(dueDate);
    if (!Number.isNaN(due) && Date.now() > due) return { label: "Overdue", color: "#EF4444" };
  }
  return { label: "Pending", color: "#F59E0B" };
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
      const s = await get(ref(database, `Platform1/Schools/${schoolKey}/Students/${studentId}`));
      if (s.exists()) {
        try { await AsyncStorage.setItem("schoolKey", schoolKey); } catch {}
        return schoolKey;
      }
    }
  } catch {}

  return null;
}

export default function SubjectAssessmentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { courseId, subject, grade, section } = useLocalSearchParams();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const sid =
        (await AsyncStorage.getItem("studentNodeKey")) ||
        (await AsyncStorage.getItem("studentId")) ||
        (await AsyncStorage.getItem("username")) ||
        null;

      const sk = await resolveSchoolKeyFast(sid);

      let assessmentsObj = {};
      if (sk) {
        const scoped = await get(ref(database, `Platform1/Schools/${sk}/SchoolExams/Assessments`));
        if (scoped.exists()) assessmentsObj = scoped.val() || {};
      }
      if (!Object.keys(assessmentsObj).length) {
        const global = await get(ref(database, `SchoolExams/Assessments`));
        if (global.exists()) assessmentsObj = global.val() || {};
      }

      const list = Object.keys(assessmentsObj)
        .map((aid) => ({ assessmentId: aid, ...assessmentsObj[aid] }))
        .filter((a) => String(a.courseId) === String(courseId))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

      const enriched = await Promise.all(
        list.map(async (a) => {
          let idx = null;
          if (sk && sid) {
            const scoped = await get(
              ref(database, `Platform1/Schools/${sk}/SchoolExams/SubmissionIndex/${a.assessmentId}/${sid}`)
            );
            if (scoped.exists()) idx = scoped.val() || {};
          }
          if (!idx && sid) {
            const global = await get(ref(database, `SchoolExams/SubmissionIndex/${a.assessmentId}/${sid}`));
            if (global.exists()) idx = global.val() || {};
          }

          return {
            ...a,
            submitted: !!idx,
            finalScore: typeof idx?.finalScore === "number" ? idx.finalScore : null,
          };
        })
      );

      setItems(enriched);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={PRIMARY} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backIconBtn}>
          <Ionicons name="arrow-back" size={20} color={PRIMARY} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{subject || "Subject"}</Text>
          <Text style={styles.subTitle}>
            Grade {grade || "--"} • Section {section || "--"}
          </Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.assessmentId}
        contentContainerStyle={{ padding: 14, paddingBottom: Math.max(24, insets.bottom + 14) }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No assessments available.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const status = getAssessmentStatus({
            submitted: item.submitted,
            finalScore: item.finalScore,
            dueDate: item.dueDate,
          });

          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.9}
              onPress={() =>
                router.push({
                  pathname: "/takeAssessment",
                  params: {
                    assessmentId: item.assessmentId,
                    courseId: item.courseId,
                    title: item.title || "Assessment",
                  },
                })
              }
            >
              <View style={styles.topRow}>
                <View style={styles.typeBadge}>
                  <Text style={styles.typeText}>
                    {item.type === "exam" ? "Exam" : "Worksheet"}
                  </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: `${status.color}22` }]}>
                  <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                </View>
              </View>

              <Text style={styles.cardTitle}>{item.title || "Assessment"}</Text>
              <Text style={styles.meta}>Due: {formatDueDate(item.dueDate)}</Text>
              <Text style={styles.meta}>
                {Number(item.totalPoints || 0)} points
                {typeof item.finalScore === "number" ? ` • Score: ${item.finalScore}` : ""}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    paddingHorizontal: 14,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  backIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#EEF4FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  title: { fontSize: 19, fontWeight: "900", color: TEXT },
  subTitle: { marginTop: 2, fontSize: 12, color: MUTED },

  empty: {
    borderWidth: 1,
    borderColor: "#EAF0FF",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  emptyText: { color: MUTED, fontWeight: "600" },

  card: {
    borderWidth: 1,
    borderColor: "#EAF0FF",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#fff",
  },
  topRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  typeBadge: { backgroundColor: "#EEF4FF", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  typeText: { color: PRIMARY, fontSize: 11, fontWeight: "800" },
  statusBadge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: "800" },

  cardTitle: { fontSize: 15, fontWeight: "900", color: TEXT, marginBottom: 6 },
  meta: { color: MUTED, fontSize: 12, fontWeight: "600", marginBottom: 2 },
});