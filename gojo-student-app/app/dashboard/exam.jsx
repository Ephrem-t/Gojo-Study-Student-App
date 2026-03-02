// app/dashboard/exam.jsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Dimensions,
  Platform,
  SafeAreaView,
  ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get } from "firebase/database";
import { database } from "../../constants/firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { queryUserByUsernameInSchool, queryUserByChildInSchool } from "../lib/userHelpers";

/**
 * Exams screen (dashboard)
 * - Top: compact Top-5 leaderboard (horizontal carousel + dots)
 * - Middle: Company rounds presented as a horizontal carousel of round cards
 *   - Each round card shows metadata and a horizontal list of exam chips inside it
 * - Below: (kept simple) placeholder for school-level tasks if needed
 *
 * Design goals: simple, modern, professional, responsive.
 * The UI uses data from Platform1/companyExams/rounds and Platform1/rankings.
 */

const SCREEN_W = Dimensions.get("window").width;
const LEADER_CARD_W = Math.round(Math.min(720, SCREEN_W * 0.86));
const LEADER_CARD_H = 160;
const ROUND_CARD_W = Math.round(Math.min(640, SCREEN_W * 0.78));
const ROUND_CARD_H = 190;
const PRIMARY = "#0B72FF";
const MUTED = "#6B78A8";
const GOLD = "#F2C94C";
const SPACING = 14;

async function tryGet(pathVariants) {
  for (const p of pathVariants) {
    try {
      const snap = await get(ref(database, p));
      if (snap && snap.exists()) return snap;
    } catch (e) {
      // ignore and try next
    }
  }
  return null;
}

async function resolveSchoolKeyForPrefix(prefix) {
  const snap = await tryGet([`Platform1/schoolCodeIndex/${prefix}`, `schoolCodeIndex/${prefix}`]);
  return snap && snap.exists() ? snap.val() : null;
}

async function queryUserProfile(userId) {
  if (!userId) return {};
  try {
    const prefix = (userId.substr(0, 3) || "").toUpperCase();
    const schoolKey = await resolveSchoolKeyForPrefix(prefix);

    let profile = null;
    let userNodeKey = null;

    if (schoolKey) {
      try {
        const snap = await queryUserByUsernameInSchool(userId, schoolKey);
        if (snap && snap.exists()) {
          snap.forEach((c) => {
            profile = c.val();
            userNodeKey = c.key;
            return true;
          });
        }
      } catch {}
    }

    if (!profile) {
      try {
        const snap = await queryUserByChildInSchool("username", userId, null);
        if (snap && snap.exists()) {
          snap.forEach((c) => {
            profile = c.val();
            userNodeKey = c.key;
            return true;
          });
        }
      } catch {}
    }

    let schoolInfo = null;
    if (schoolKey) {
      try {
        const sSnap = await tryGet([`Platform1/Schools/${schoolKey}/schoolInfo`, `Schools/${schoolKey}/schoolInfo`]);
        if (sSnap && sSnap.exists()) schoolInfo = sSnap.val();
      } catch {}
    }

    return { profile, schoolInfo, userNodeKey, schoolKey };
  } catch {
    return {};
  }
}

function fmtDate(ts) {
  if (!ts) return "";
  try {
    const d = new Date(Number(ts));
    return d.toLocaleString();
  } catch {
    return "";
  }
}

export default function ExamScreen() {
  const router = useRouter();

  // Leaderboard state
  const [loadingLeaders, setLoadingLeaders] = useState(true);
  const [leaders, setLeaders] = useState([]);
  const [leaderIndex, setLeaderIndex] = useState(0);
  const leaderRef = useRef(null);
  const leaderPadding = Math.round((SCREEN_W - LEADER_CARD_W) / 2);

  // Rounds state
  const [loadingRounds, setLoadingRounds] = useState(true);
  const [rounds, setRounds] = useState([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const roundsRef = useRef(null);
  const roundPadding = Math.round((SCREEN_W - ROUND_CARD_W) / 2);

  useEffect(() => {
    (async () => {
      setLoadingLeaders(true);
      setLoadingRounds(true);
      await Promise.all([loadLeaders(), loadRounds()]);
      setLoadingLeaders(false);
      setLoadingRounds(false);
    })();
  }, []);

  // Load top-5 leaders (enriched)
  const loadLeaders = useCallback(async () => {
    try {
      const countrySnap = await tryGet([`Platform1/country`, `country`]);
      const country = countrySnap && countrySnap.exists() ? countrySnap.val() : "Ethiopia";
      const grade = (await AsyncStorage.getItem("studentGrade")) || "9";
      const gradeKey = `grade${grade}`;

      const snap = await tryGet([
        `Platform1/rankings/country/${country}/${gradeKey}/leaderboard`,
        `rankings/country/${country}/${gradeKey}/leaderboard`,
      ]);

      const raw = [];
      if (snap && snap.exists()) {
        snap.forEach((c) => {
          const v = c.val() || {};
          raw.push({ userId: c.key, rank: v.rank || 999, totalPoints: v.totalPoints || 0, badge: v.badge || null });
        });
      }

      raw.sort((a, b) => (a.rank || 999) - (b.rank || 999));
      const top5 = raw.slice(0, 5);

      const enriched = await Promise.all(
        top5.map(async (entry) => {
          const resolved = await queryUserProfile(entry.userId);
          return { ...entry, profile: resolved.profile || null, schoolInfo: resolved.schoolInfo || null };
        })
      );

      setLeaders(enriched);
      setLeaderIndex(0);
      setTimeout(() => leaderRef.current && enriched.length && leaderRef.current.scrollToOffset({ offset: 0, animated: true }), 150);
    } catch (err) {
      console.warn("loadLeaders", err);
      setLeaders([]);
    }
  }, []);

  // Load company rounds
  const loadRounds = useCallback(async () => {
    try {
      const snap = await tryGet([`Platform1/companyExams/rounds`, `companyExams/rounds`]);
      const arr = [];
      if (snap && snap.exists()) {
        snap.forEach((c) => {
          const v = c.val() || {};
          arr.push({ id: c.key, ...v });
        });
      }
      arr.sort((a, b) => (b.startTimestamp || 0) - (a.startTimestamp || 0));
      setRounds(arr);
      setRoundIndex(0);
      setTimeout(() => roundsRef.current && arr.length && roundsRef.current.scrollToOffset({ offset: 0, animated: true }), 150);
    } catch (err) {
      console.warn("loadRounds", err);
      setRounds([]);
    }
  }, []);

  // Handlers for snapping indices
  const onLeaderScrollEnd = (e) => {
    const offsetX = e.nativeEvent.contentOffset.x || 0;
    const idx = Math.round(offsetX / (LEADER_CARD_W + SPACING));
    setLeaderIndex(Math.max(0, Math.min(leaders.length - 1, idx)));
  };
  const onRoundScrollEnd = (e) => {
    const offsetX = e.nativeEvent.contentOffset.x || 0;
    const idx = Math.round(offsetX / (ROUND_CARD_W + SPACING));
    setRoundIndex(Math.max(0, Math.min(rounds.length - 1, idx)));
  };

  function LeaderCard({ item, index }) {
    const isTop = index === 0 || Number(item.rank) === 1;
    const displayName = item.profile?.name || item.profile?.username || item.userId;
    const avatar = item.profile?.profileImage || item.schoolInfo?.logoUrl || null;
    const school = item.schoolInfo?.name || item.profile?.schoolName || item.schoolInfo?.city || "";

    return (
      <View style={{ width: LEADER_CARD_W, height: LEADER_CARD_H, marginRight: SPACING }}>
        <TouchableOpacity
          activeOpacity={0.92}
          onPress={() => router.push({ pathname: "/exam/profile", params: { userId: item.userId } })}
          style={[styles.leaderCard, isTop ? styles.leaderCardTop : styles.leaderCardNormal]}
        >
          <View style={styles.leaderRow}>
            <View style={styles.leaderLeft}>
              <View style={[styles.rankCircle, isTop && styles.rankCircleTop]}>
                <Text style={[styles.rankText, isTop && styles.rankTextTop]}>{item.rank}</Text>
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text numberOfLines={1} style={[styles.leaderName, isTop && styles.leaderNameTop]}>{displayName}</Text>
                <Text numberOfLines={1} style={styles.leaderSub}>{school}{item.schoolInfo?.region ? ` • ${item.schoolInfo.region}` : ""}</Text>
              </View>
            </View>

            <View style={styles.leaderRight}>
              {avatar ? <Image source={{ uri: avatar }} style={[styles.leaderAvatar, isTop && styles.leaderAvatarTop]} /> : (
                <View style={[styles.avatarPlaceholderSmall, isTop && styles.leaderAvatarTop]}>
                  <Text style={styles.avatarPlaceholderTextSmall}>{(displayName || "U").slice(0, 1)}</Text>
                </View>
              )}
              <View style={{ height: 8 }} />
              <Text style={styles.pointsLabel}>Points</Text>
              <Text style={[styles.pointsValue, isTop && styles.pointsValueTop]}>{item.totalPoints}</Text>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  function RoundCard({ item }) {
    const exams = item.exams ? Object.keys(item.exams).map((k) => ({ id: k, ...item.exams[k] })) : [];
    const status = item.status || "upcoming";
    const typeLabel = (item.type || "round").toUpperCase();

    return (
      <View style={{ width: ROUND_CARD_W, height: ROUND_CARD_H, marginRight: SPACING }}>
        <View style={styles.roundCard}>
          <View style={styles.roundHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.roundName} numberOfLines={2}>{item.name || item.id}</Text>
              <Text style={styles.roundMeta}>{typeLabel} • {status}</Text>
              <Text style={styles.roundTime}>{fmtDate(item.startTimestamp)} — {fmtDate(item.endTimestamp)}</Text>
            </View>

            <View style={{ marginLeft: 10, alignItems: "flex-end" }}>
              <TouchableOpacity style={[styles.typePill, status === "active" ? styles.typeActive : styles.typeMuted]}>
                <Text style={[styles.typePillText, status === "active" ? styles.typePillTextActive : null]}>{status.toUpperCase()}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <FlatList
            data={exams}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(e) => e.id}
            contentContainerStyle={{ paddingTop: 12 }}
            renderItem={({ item: e }) => (
              <View style={styles.examChip}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.examTitle}>{(e.subject || e.id).toUpperCase()}</Text>
                  <Text style={styles.examSub}>{e.chapter} • Grade {String(e.grade || "").replace("grade", "")}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.examAction, e.scoringEnabled ? styles.examActionPrimary : styles.examActionMuted]}
                  onPress={() => router.push({ pathname: "/exam/rules", params: { roundId: item.id, examId: e.id } })}
                >
                  <Text style={styles.examActionText}>{e.scoringEnabled ? "Enter" : "Practice"}</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 36 }}>
        {/* Leaderboard */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Top 5</Text>
            <Text style={styles.subtitle}>Top performers for your grade</Text>
          </View>
          <TouchableOpacity style={styles.cta} onPress={() => router.push("/exam/leaderboard")}>
            <Ionicons name="trophy" size={16} color="#fff" />
            <Text style={styles.ctaText}>See all</Text>
          </TouchableOpacity>
        </View>

        {loadingLeaders ? (
          <View style={styles.loadingArea}><ActivityIndicator size="large" color={PRIMARY} /></View>
        ) : leaders.length === 0 ? (
          <View style={styles.emptyArea}><Text style={styles.emptyText}>No leaderboard data</Text></View>
        ) : (
          <>
            <FlatList
              ref={leaderRef}
              data={leaders}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(i) => i.userId}
              renderItem={({ item, index }) => <LeaderCard item={item} index={index} />}
              contentContainerStyle={{ paddingHorizontal: leaderPadding }}
              snapToInterval={LEADER_CARD_W + SPACING}
              decelerationRate={Platform.OS === "ios" ? 0.92 : 0.98}
              onMomentumScrollEnd={onLeaderScrollEnd}
            />
            <View style={styles.dotsRow}>
              {leaders.map((_, i) => (
                <View key={i} style={[styles.dot, i === leaderIndex ? styles.dotActive : null]} />
              ))}
            </View>
          </>
        )}

        {/* Company rounds (horizontal) */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Company rounds</Text>
          <Text style={styles.sectionSubtitle}>Competitive and practice rounds</Text>
        </View>

        {loadingRounds ? (
          <View style={{ padding: 18, alignItems: "center" }}><ActivityIndicator size="small" color={PRIMARY} /></View>
        ) : rounds.length === 0 ? (
          <View style={{ padding: 18 }}><Text style={{ color: MUTED }}>No rounds found</Text></View>
        ) : (
          <>
            <FlatList
              ref={roundsRef}
              data={rounds}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(r) => r.id}
              renderItem={({ item }) => <RoundCard item={item} />}
              contentContainerStyle={{ paddingHorizontal: roundPadding }}
              snapToInterval={ROUND_CARD_W + SPACING}
              decelerationRate={Platform.OS === "ios" ? 0.92 : 0.98}
              onMomentumScrollEnd={onRoundScrollEnd}
            />
            <View style={styles.dotsRow}>
              {rounds.map((_, i) => (
                <View key={i} style={[styles.dot, i === roundIndex ? styles.dotActive : null]} />
              ))}
            </View>
          </>
        )}

        {/* Optional: school-level area (kept minimal and simple) */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>School assignments</Text>
          <Text style={styles.sectionSubtitle}>From your teachers (classwork, quizzes)</Text>
        </View>

        <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
          <Text style={{ color: MUTED }}>School-level assignments appear here when available.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FBFCFF" },

  header: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 22, fontWeight: "900", color: "#0B2540" },
  subtitle: { color: MUTED, marginTop: 4, fontSize: 13 },

  cta: { flexDirection: "row", alignItems: "center", backgroundColor: PRIMARY, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  ctaText: { color: "#fff", marginLeft: 8, fontWeight: "800" },

  loadingArea: { height: LEADER_CARD_H + 20, alignItems: "center", justifyContent: "center" },
  emptyArea: { paddingVertical: 18, alignItems: "center" },
  emptyText: { color: MUTED },

  leaderCard: {
    borderRadius: 14,
    padding: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#EEF4FF",
    justifyContent: "center",
    height: LEADER_CARD_H,
  },
  leaderCardTop: { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, elevation: 6 },
  leaderCardNormal: { shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 6, elevation: 3 },

  leaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  leaderLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  rankCircle: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  rankCircleTop: { width: 56, height: 56, borderRadius: 28 },
  rankText: { fontWeight: "900", fontSize: 16 },
  rankTextTop: { fontSize: 20 },

  leaderName: { fontWeight: "800", fontSize: 16, color: "#0B2540" },
  leaderNameTop: { fontSize: 18 },
  leaderSub: { color: MUTED, marginTop: 4, fontSize: 12 },

  leaderRight: { alignItems: "center", marginLeft: 12 },
  leaderAvatar: { width: 58, height: 58, borderRadius: 12 },
  leaderAvatarTop: { width: 78, height: 78, borderRadius: 14 },
  avatarPlaceholderSmall: { width: 58, height: 58, borderRadius: 12, backgroundColor: PRIMARY, alignItems: "center", justifyContent: "center" },
  avatarPlaceholderTextSmall: { color: "#fff", fontWeight: "900", fontSize: 20 },

  pointsLabel: { color: MUTED, fontSize: 12 },
  pointsValue: { fontWeight: "900", fontSize: 18, color: "#0B2540" },
  pointsValueTop: { fontSize: 22 },

  trophyWrap: { backgroundColor: "rgba(242,201,76,0.12)", padding: 8, borderRadius: 10 },

  // Dots
  dotsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 12, marginBottom: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#D9E6FF", opacity: 0.9, marginHorizontal: 4 },
  dotActive: { width: 22, height: 8, borderRadius: 10, backgroundColor: PRIMARY },

  // Rounds
  sectionHeader: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 },
  sectionTitle: { fontSize: 18, fontWeight: "900", color: "#0B2540" },
  sectionSubtitle: { color: MUTED, marginTop: 4, fontSize: 13 },

  roundCard: { borderRadius: 12, padding: 14, backgroundColor: "#fff", borderWidth: 1, borderColor: "#EEF4FF", height: ROUND_CARD_H },
  roundHeader: { flexDirection: "row", alignItems: "flex-start" },
  roundName: { fontWeight: "800", fontSize: 15, color: "#12263B" },
  roundMeta: { color: MUTED, marginTop: 6, fontSize: 12 },
  roundTime: { color: MUTED, marginTop: 6, fontSize: 12 },

  typePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  typeActive: { backgroundColor: "rgba(3,201,90,0.08)" },
  typeMuted: { backgroundColor: "rgba(107,120,168,0.06)" },
  typePillText: { fontWeight: "800" },
  typePillTextActive: { color: "#03C95A" },

  // exam chip inside round card
  examChip: {
    minWidth: 220,
    maxWidth: 280,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#F8FAFF",
    marginRight: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  examTitle: { fontWeight: "800", color: "#0B2540" },
  examSub: { color: MUTED, fontSize: 12, marginTop: 4 },
  examAction: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  examActionPrimary: { backgroundColor: PRIMARY },
  examActionMuted: { backgroundColor: "#DDE8FF" },
  examActionText: { color: "#fff", fontWeight: "800" },

  enterBtn: { marginTop: 8, backgroundColor: PRIMARY, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  enterBtnText: { color: "#fff", fontWeight: "800" },
});