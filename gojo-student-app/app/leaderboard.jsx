import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
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
  Platform,
  StatusBar,
  Modal,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get } from "firebase/database";
import { database } from "../constants/firebaseConfig";
import { useAppTheme } from "../hooks/use-app-theme";
import { getSnapshot } from "./lib/dbHelpers";
import { queryUserByUsernameInSchool, queryUserByChildInSchool } from "./lib/userHelpers";
import { extractProfileImage } from "./lib/profileImage";

const C = {
  primary: "#0B72FF",
  text: "#0B2540",
  muted: "#6B78A8",
  bg: "#FFFFFF",
  border: "#EAF0FF",
  gold: "#F2C94C",
  silver: "#C0C6CC",
  bronze: "#D08A3A",
};

function normalizeGrade(g) {
  if (!g) return null;
  const s = String(g).trim().toLowerCase();
  const m = s.match(/(\d{1,2})/);
  return m ? String(m[1]) : s.replace(/^grade\s*/i, "");
}

function yearsFromDob(dob) {
  if (!dob) return "";
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? String(age) : "";
}

async function resolveUserProfile(userId) {
  if (!userId) return { profile: null, schoolCode: null };
  try {
    const prefix = String(userId).slice(0, 3).toUpperCase();
    const idx = await get(ref(database, `Platform1/schoolCodeIndex/${prefix}`));
    const schoolCode = idx?.val() || null;
    let profile = null;

    if (schoolCode) {
      try {
        const snap = await queryUserByUsernameInSchool(userId, schoolCode);
        if (snap?.exists()) snap.forEach((c) => { profile = c.val(); return true; });
      } catch {}
    }

    if (!profile) {
      try {
        const snap = await queryUserByChildInSchool("username", userId, null);
        if (snap?.exists()) snap.forEach((c) => { profile = c.val(); return true; });
      } catch {}
    }

    return { profile, schoolCode };
  } catch {
    return { profile: null, schoolCode: null };
  }
}

async function resolveStudentAndSchoolDetails(userId, fallbackSchoolCode) {
  try {
    if (!userId) return { student: null, schoolInfo: null, schoolCode: null, user: null };

    const candidates = [];
    if (fallbackSchoolCode) candidates.push(fallbackSchoolCode);

    const { schoolCode: profileSchoolCode } = await resolveUserProfile(userId);
    if (profileSchoolCode && !candidates.includes(profileSchoolCode)) {
      candidates.push(profileSchoolCode);
    }

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

      const usersSnap = await get(ref(database, `Platform1/Schools/${schoolCode}/Users/${userId}`));
      if (usersSnap?.exists()) user = usersSnap.val();

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
        return { student, schoolInfo, schoolCode, user };
      }
    }

    return { student: null, schoolInfo: null, schoolCode: fallbackSchoolCode || null, user: null };
  } catch {
    return { student: null, schoolInfo: null, schoolCode: fallbackSchoolCode || null, user: null };
  }
}

function extractStudentGrade(student) {
  const raw =
    student?.basicStudentInformation?.grade ||
    student?.grade ||
    "";
  const normalized = normalizeGrade(raw);
  return normalized ? `Grade ${normalized}` : "-";
}
function PodiumItem({ item, place, rankColor, animatedStyle, onPress, styles }) {
  const isFirst = place === 1;
  const medalColor = rankColor(place);
  const tiedItems = Array.isArray(item?.tiedItems) ? item.tiedItems : [];

  if (!item) {
    return (
      <Animated.View style={[styles.podiumCol, isFirst ? styles.podiumCenter : null, animatedStyle]}>
        <View
          style={[
            styles.podiumAvatarWrap,
            isFirst ? styles.podiumAvatarWrapFirst : null,
            styles.emptyPodiumAvatarWrap,
            { borderColor: medalColor },
          ]}
        >
          <Ionicons name="person-outline" size={isFirst ? 28 : 24} color={medalColor} />
          <View style={[styles.medalBadge, { backgroundColor: medalColor }]}>
            <Text style={styles.medalText}>{place}</Text>
          </View>
        </View>

        <Text numberOfLines={1} style={styles.podiumNameEmpty}>
          Open Spot
        </Text>
        <Text style={styles.podiumPtsEmpty}>Not taken yet</Text>

        <View
          style={[
            styles.podiumBlock,
            isFirst ? styles.podiumBlockFirst : styles.podiumBlockSide,
            { backgroundColor: `${medalColor}22` },
          ]}
        >
          <Text style={[styles.podiumBlockText, { color: medalColor }]}>#{place}</Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.podiumCol, isFirst ? styles.podiumCenter : null, animatedStyle]}>
      <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={styles.podiumTouch}>
        <View
          style={[
            styles.podiumAvatarWrap,
            isFirst ? styles.podiumAvatarWrapFirst : null,
            { borderColor: medalColor },
          ]}
        >
          {item.avatar ? (
            <Image source={{ uri: item.avatar }} style={styles.podiumAvatar} />
          ) : (
            <View style={styles.podiumAvatarFallback}>
              <Text style={styles.initial}>{(item.name || "U")[0]}</Text>
            </View>
          )}
          <View style={[styles.medalBadge, { backgroundColor: medalColor }]}>
            <Text style={styles.medalText}>{place}</Text>
          </View>
        </View>

        <Text numberOfLines={1} style={styles.podiumName}>{item.name}</Text>
        <Text style={styles.podiumPts}>{item.totalPoints} pts</Text>

        {tiedItems.length > 1 ? (
          <View style={styles.tiePreviewWrap}>
            {tiedItems.slice(0, 4).map((p, idx) => (
              <View
                key={`${p.userId}-${idx}`}
                style={[
                  styles.tiePreviewAvatarWrap,
                  { borderColor: medalColor },
                  idx > 0 ? { marginLeft: -12 } : null,
                ]}
              >
                {p.avatar ? (
                  <Image source={{ uri: p.avatar }} style={styles.tiePreviewAvatar} />
                ) : (
                  <View style={styles.tiePreviewFallback}>
                    <Text style={styles.tiePreviewInitial}>{(p.name || "U")[0]}</Text>
                  </View>
                )}
              </View>
            ))}
            <Text style={[styles.tiePreviewText, { color: medalColor }]}>+{tiedItems.length - 1}</Text>
          </View>
        ) : null}

        <View
          style={[
            styles.podiumBlock,
            isFirst ? styles.podiumBlockFirst : styles.podiumBlockSide,
            { backgroundColor: `${medalColor}33` },
          ]}
        >
          <Text style={[styles.podiumBlockText, { color: medalColor }]}>#{place}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}
export default function LeaderboardScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors, statusBarStyle } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [country, setCountry] = useState("Ethiopia");
  const [schoolCode, setSchoolCode] = useState(null);
  const [schoolName, setSchoolName] = useState(null);
  const [grade, setGrade] = useState("7");
  const [scope, setScope] = useState("country");

  const [countryRows, setCountryRows] = useState([]);
  const [schoolRows, setSchoolRows] = useState([]);

  const [myUserId, setMyUserId] = useState(null);

  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [tiePickerVisible, setTiePickerVisible] = useState(false);
  const [tieCandidates, setTieCandidates] = useState([]);
  const [tieRank, setTieRank] = useState(null);

  const requestedScope = useMemo(() => {
    const raw = String(params?.scope || params?.filter || params?.level || "").toLowerCase();
    if (raw.includes("school")) return "school";
    if (raw.includes("country")) return "country";
    return null;
  }, [params?.filter, params?.level, params?.scope]);

  const safeTop = Platform.OS === "android" ? (StatusBar.currentHeight || 0) : 0;

  const firstAnim = useRef(new Animated.Value(0)).current;
  const secondAnim = useRef(new Animated.Value(0)).current;
  const thirdAnim = useRef(new Animated.Value(0)).current;

  const enrichRows = useCallback(async (valObj, activeGrade) => {
    const targetGrade = normalizeGrade(activeGrade);
    const base = Object.keys(valObj || {}).map((uid) => ({
      userId: uid,
      rank: Number(valObj[uid]?.rank || 9999),
      totalPoints: Number(valObj[uid]?.totalPoints || 0),
    }));
    base.sort((a, b) => a.rank - b.rank);

    const resolved = await Promise.all(
      base.map(async (r) => {
        const { profile, schoolCode: resolvedSchool } = await resolveUserProfile(r.userId);
        const details = await resolveStudentAndSchoolDetails(r.userId, resolvedSchool);
        const studentGrade = normalizeGrade(
          details?.student?.basicStudentInformation?.grade ||
          details?.student?.grade ||
          ""
        );
        return {
          ...r,
          name: profile?.name || profile?.username || r.userId,
          avatar: extractProfileImage(profile),
          schoolCode: resolvedSchool || null,
          studentGrade,
        };
      })
    );

    return resolved.filter((r) => !!r.studentGrade && r.studentGrade === targetGrade);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);

    const sid =
      (await AsyncStorage.getItem("studentNodeKey")) ||
      (await AsyncStorage.getItem("studentId")) ||
      (await AsyncStorage.getItem("username")) ||
      null;
    setMyUserId(sid);

    const gradeRaw = await AsyncStorage.getItem("studentGrade");
    const g = normalizeGrade(gradeRaw) || "7";
    setGrade(g);

    const countrySnap = await getSnapshot([`Platform1/country`, `country`]);
    const c = (countrySnap?.val && countrySnap.val()) || "Ethiopia";
    setCountry(c);

    let mySchool = null;
    if (sid) {
      try {
        const pref = String(sid).slice(0, 3).toUpperCase();
        const idx = await get(ref(database, `Platform1/schoolCodeIndex/${pref}`));
        mySchool = idx?.val() || null;
      } catch {}
    }
    setSchoolCode(mySchool);
    if (mySchool) {
      try {
        const schoolInfoSnap = await get(ref(database, `Platform1/Schools/${mySchool}/schoolInfo`));
        const info = schoolInfoSnap?.exists() ? schoolInfoSnap.val() : null;
        setSchoolName(info?.name || info?.schoolName || mySchool);
      } catch {
        setSchoolName(mySchool);
      }
    } else {
      setSchoolName(null);
    }

    const gradeKey = `grade${g}`;
    const countryPath = `Platform1/rankings/country/${c}/${gradeKey}/leaderboard`;
    const schoolPath = mySchool ? `Platform1/rankings/schools/${mySchool}/${gradeKey}/leaderboard` : null;

    const countrySnapLb = await getSnapshot([countryPath]);
    const countryVal = countrySnapLb?.val ? countrySnapLb.val() : null;
    const enrichedCountry = countryVal ? await enrichRows(countryVal, g) : [];
    setCountryRows(enrichedCountry);

    if (schoolPath) {
      const schoolSnapLb = await getSnapshot([schoolPath]);
      const schoolValRaw = schoolSnapLb?.val ? schoolSnapLb.val() : null;
      const schoolVal = schoolValRaw?.leaderboard || schoolValRaw;
      const enrichedSchool = schoolVal ? await enrichRows(schoolVal, g) : [];
      setSchoolRows(enrichedSchool);
    } else {
      setSchoolRows([]);
    }

    setLoading(false);
  }, [enrichRows]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (requestedScope === "country") {
      setScope("country");
      return;
    }

    if (requestedScope === "school") {
      setScope(schoolCode ? "school" : "country");
    }
  }, [requestedScope, schoolCode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const rows = useMemo(
    () => (scope === "school" ? schoolRows : countryRows),
    [scope, schoolRows, countryRows]
  );

  const podiumGroups = useMemo(() => {
    const byRank = { 1: [], 2: [], 3: [] };
    rows.forEach((r) => {
      if (r.rank >= 1 && r.rank <= 3) byRank[r.rank].push(r);
    });
    byRank[1].sort((a, b) => b.totalPoints - a.totalPoints);
    byRank[2].sort((a, b) => b.totalPoints - a.totalPoints);
    byRank[3].sort((a, b) => b.totalPoints - a.totalPoints);
    return byRank;
  }, [rows]);
  const myRow = useMemo(() => rows.find((r) => r.userId === myUserId) || null, [rows, myUserId]);

  const podium = useMemo(() => {
    const second = podiumGroups[2]?.[0] ? { ...podiumGroups[2][0], tiedItems: podiumGroups[2] } : null;
    const first = podiumGroups[1]?.[0] ? { ...podiumGroups[1][0], tiedItems: podiumGroups[1] } : null;
    const third = podiumGroups[3]?.[0] ? { ...podiumGroups[3][0], tiedItems: podiumGroups[3] } : null;
    return { first, second, third };
  }, [podiumGroups]);

  const hasPodium = !!((podiumGroups[1] && podiumGroups[1].length) || (podiumGroups[2] && podiumGroups[2].length) || (podiumGroups[3] && podiumGroups[3].length));

  useEffect(() => {
    firstAnim.setValue(0);
    secondAnim.setValue(0);
    thirdAnim.setValue(0);

    if (!hasPodium) return;

    Animated.stagger(120, [
      Animated.timing(secondAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(firstAnim, {
        toValue: 1,
        duration: 580,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(thirdAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [hasPodium, firstAnim, secondAnim, thirdAnim, scope]);

  const firstAnimatedStyle = {
    opacity: firstAnim,
    transform: [
      {
        translateY: firstAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [44, 0],
        }),
      },
      {
        scale: firstAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.94, 1],
        }),
      },
    ],
  };

  const secondAnimatedStyle = {
    opacity: secondAnim,
    transform: [
      {
        translateY: secondAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [34, 0],
        }),
      },
      {
        scale: secondAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.95, 1],
        }),
      },
    ],
  };

  const thirdAnimatedStyle = {
    opacity: thirdAnim,
    transform: [
      {
        translateY: thirdAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [34, 0],
        }),
      },
      {
        scale: thirdAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.95, 1],
        }),
      },
    ],
  };

  const rankColor = (rank) =>
    rank === 1 ? C.gold : rank === 2 ? C.silver : rank === 3 ? C.bronze : C.primary;

  const handlePodiumPress = (rank, group) => {
    if (!group?.length) return;
    if (group.length === 1) {
      openStudentProfile(group[0]);
      return;
    }
    setTieRank(rank);
    setTieCandidates(group);
    setTiePickerVisible(true);
  };

  const openStudentProfile = async (item) => {
    setProfileModalVisible(true);
    setProfileLoading(true);
    setSelectedProfile(null);

    const { student, schoolInfo, schoolCode: resolvedSchoolCode, user } =
      await resolveStudentAndSchoolDetails(item.userId, item.schoolCode);

    const gender =
      student?.basicStudentInformation?.gender ||
      student?.gender ||
      user?.gender ||
      "";
    const gradeLabel = extractStudentGrade(student);
    const schoolName =
      schoolInfo?.name ||
      schoolInfo?.schoolName ||
      user?.schoolName ||
      user?.schoolCode ||
      item.schoolName ||
      resolvedSchoolCode ||
      item.schoolCode ||
      "";

    const city =
      schoolInfo?.city ||
      schoolInfo?.address?.city ||
      "";

    const region =
      student?.addressInformation?.region ||
      schoolInfo?.region ||
      schoolInfo?.address?.region ||
      "";

    setSelectedProfile({
      name: item.name,
      rank: item.rank,
      points: item.totalPoints,
      avatar: item.avatar,
      gender,
      grade: gradeLabel,
      school: schoolName,
      city,
      region,
    });
    setProfileLoading(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, { paddingTop: safeTop }]}>
        <StatusBar barStyle={statusBarStyle} backgroundColor={colors.background} />
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { paddingTop: safeTop }]}>
      <StatusBar barStyle={statusBarStyle} backgroundColor={colors.background} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/dashboard/exam")} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Leaderboard</Text>
          <Text style={styles.sub}>
            {scope === "country"
              ? `${country} • Grade ${grade}`
              : `${schoolName || "My School"} • Grade ${grade}`}
          </Text>
        </View>
      </View>

      <View style={styles.toggleWrapTopOnly}>
        <TouchableOpacity
          onPress={() => setScope("country")}
          style={[styles.toggleBtn, scope === "country" ? styles.toggleOn : styles.toggleOff]}
        >
          <Text style={scope === "country" ? styles.toggleTextOn : styles.toggleTextOff}>
            Country
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setScope("school")}
          style={[styles.toggleBtn, scope === "school" ? styles.toggleOn : styles.toggleOff, !schoolCode ? styles.toggleDisabled : null]}
          disabled={!schoolCode}
        >
          <Text style={scope === "school" ? styles.toggleTextOn : styles.toggleTextOff}>
            Your School
          </Text>
        </TouchableOpacity>
      </View>

      {hasPodium ? (
        <View style={styles.podiumWrap}>
          {podium.second ? (
            <PodiumItem
              item={podium.second}
              place={2}
              rankColor={rankColor}
              animatedStyle={secondAnimatedStyle}
              onPress={() => handlePodiumPress(2, podiumGroups[2])}
              styles={styles}
            />
          ) : null}
          {podium.first ? (
            <PodiumItem
              item={podium.first}
              place={1}
              rankColor={rankColor}
              animatedStyle={firstAnimatedStyle}
              onPress={() => handlePodiumPress(1, podiumGroups[1])}
              styles={styles}
            />
          ) : null}
          {podium.third ? (
            <PodiumItem
              item={podium.third}
              place={3}
              rankColor={rankColor}
              animatedStyle={thirdAnimatedStyle}
              onPress={() => handlePodiumPress(3, podiumGroups[3])}
              styles={styles}
            />
          ) : null}
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(i) => i.userId}
        contentContainerStyle={{ padding: 16, paddingBottom: 26 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>No students found.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={0.9} onPress={() => openStudentProfile(item)}>
            <View style={[styles.row, item.userId === myUserId ? styles.myRow : null]}>
              <View style={[styles.rankPill, { backgroundColor: `${rankColor(item.rank)}1E` }]}>
                <Text style={[styles.rank, { color: rankColor(item.rank) }]}>#{item.rank}</Text>
              </View>
              {item.avatar ? (
                <Image source={{ uri: item.avatar }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.initial}>{(item.name || "U")[0]}</Text>
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text numberOfLines={1} style={styles.name}>{item.name}</Text>
                <View style={styles.pointsChip}>
                  <Ionicons name="trophy-outline" size={12} color={C.primary} />
                  <Text style={styles.points}>{item.totalPoints} points</Text>
                </View>
              </View>
              <View style={styles.rowChevronWrap}>
                <Ionicons name="chevron-forward" size={16} color={colors.muted} />
              </View>
            </View>
          </TouchableOpacity>
        )}
      />

      <Modal
        visible={profileModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {profileLoading ? (
              <ActivityIndicator color={C.primary} />
            ) : (
              <>
                <View style={styles.profileHero}>
                  {selectedProfile?.avatar ? (
                    <Image source={{ uri: selectedProfile.avatar }} style={styles.modalAvatar} />
                  ) : (
                    <View style={[styles.modalAvatar, styles.avatarFallback]}>
                      <Text style={styles.initial}>{(selectedProfile?.name || "U")[0]}</Text>
                    </View>
                  )}

                  <Text style={styles.modalName}>{selectedProfile?.name || "-"}</Text>
                  <View style={styles.modalRankBadge}>
                    <Text style={styles.modalRank}>#{selectedProfile?.rank || "-"} • {selectedProfile?.points || 0} pts</Text>
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

      <Modal
        visible={tiePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTiePickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.tieModalCard}>
            <Text style={styles.tieModalTitle}>Rank #{tieRank} is tied</Text>
            <Text style={styles.tieModalSubtitle}>Choose a student to view full profile details.</Text>

            <FlatList
              data={tieCandidates}
              keyExtractor={(i, idx) => `${i.userId}-${idx}`}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              style={{ maxHeight: 280, width: "100%" }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.tieOptionRow}
                  activeOpacity={0.9}
                  onPress={() => {
                    setTiePickerVisible(false);
                    setTimeout(() => openStudentProfile(item), 120);
                  }}
                >
                  {item.avatar ? (
                    <Image source={{ uri: item.avatar }} style={styles.tieOptionAvatar} />
                  ) : (
                    <View style={[styles.tieOptionAvatar, styles.avatarFallback]}>
                      <Text style={styles.initial}>{(item.name || "U")[0]}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text numberOfLines={1} style={styles.tieOptionName}>{item.name}</Text>
                    <Text style={styles.tieOptionPoints}>{item.totalPoints} points</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                </TouchableOpacity>
              )}
            />

            <TouchableOpacity style={styles.closeBtn} onPress={() => setTiePickerVisible(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.inputBackground,
  },
  title: { fontSize: 22, fontWeight: "900", color: colors.text },
  sub: { color: colors.muted, marginTop: 2 },

  heroPanel: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#DDE9FF",
    backgroundColor: "#F8FBFF",
    padding: 14,
    overflow: "hidden",
  },
  heroGlowA: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "rgba(11,114,255,0.12)",
    top: -70,
    right: -32,
  },
  heroGlowB: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(59,130,246,0.09)",
    bottom: -55,
    left: -22,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EDF4FF",
    borderWidth: 1,
    borderColor: "#D8E7FF",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  heroChipText: {
    marginLeft: 6,
    color: C.primary,
    fontSize: 11,
    fontWeight: "800",
  },
  heroMeta: {
    color: C.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  toggleWrapTopOnly: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  toggleWrap: { flexDirection: "row", gap: 8, marginTop: 12 },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  toggleOn: { backgroundColor: colors.soft, borderColor: colors.primary },
  toggleOff: { backgroundColor: colors.card, borderColor: colors.border },
  toggleDisabled: { opacity: 0.55 },
  toggleTextOn: { color: C.primary, fontSize: 12, fontWeight: "700" },
  toggleTextOff: { color: colors.muted, fontSize: 12, fontWeight: "700" },

  searchWrap: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  searchInput: { marginLeft: 8, flex: 1, color: C.text, fontWeight: "600" },

  heroStatsRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  heroStatCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E6EEFD",
    borderRadius: 14,
    paddingVertical: 8,
    alignItems: "center",
  },
  heroStatValue: {
    color: C.primary,
    fontSize: 16,
    fontWeight: "900",
  },
  heroStatLabel: {
    marginTop: 2,
    color: C.muted,
    fontSize: 11,
    fontWeight: "700",
  },

  meCard: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 12,
    backgroundColor: "#F8FAFF",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  meText: { color: C.muted, fontWeight: "700" },
  meRank: { color: C.primary, fontWeight: "900", fontSize: 20 },
  mePts: { color: C.text, fontWeight: "800" },

  podiumWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
  },
  podiumCol: { flex: 1, alignItems: "center" },
  podiumCenter: { marginHorizontal: 4 },
  podiumTouch: { width: "100%", alignItems: "center" },

  podiumAvatarWrap: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 2.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  podiumAvatarWrapFirst: { width: 78, height: 78, borderRadius: 39 },
  podiumAvatar: { width: "100%", height: "100%", borderRadius: 999 },
  podiumAvatarFallback: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  medalBadge: {
    position: "absolute",
    bottom: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  medalText: { color: "#fff", fontWeight: "900", fontSize: 12 },

  podiumName: {
    marginTop: 8,
    fontWeight: "800",
    color: colors.text,
    fontSize: 12,
    width: 90,
    textAlign: "center",
  },
  podiumPts: { marginTop: 2, color: colors.muted, fontSize: 11, fontWeight: "700" },
  tiePreviewWrap: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  tiePreviewAvatarWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  tiePreviewAvatar: {
    width: "100%",
    height: "100%",
    borderRadius: 12,
  },
  tiePreviewFallback: {
    width: "100%",
    height: "100%",
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  tiePreviewInitial: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900",
  },
  tiePreviewText: {
    marginLeft: 6,
    fontSize: 11,
    fontWeight: "800",
  },

  podiumBlock: {
    marginTop: 8,
    width: "80%",
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  podiumBlockFirst: { height: 70 },
  podiumBlockSide: { height: 48 },
  podiumBlockText: { fontWeight: "900", fontSize: 18 },

  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
  },
  myRow: { backgroundColor: colors.soft, borderColor: colors.primary },
  rankPill: {
    minWidth: 50,
    height: 32,
    borderRadius: 10,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  rank: { fontWeight: "900", fontSize: 15 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { color: "#fff", fontWeight: "900" },
  name: { color: colors.text, fontWeight: "800", fontSize: 14 },
  pointsChip: {
    marginTop: 4,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  points: { color: C.primary, marginLeft: 5, fontSize: 11, fontWeight: "800" },
  rowChevronWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
  },

  emptyWrap: { alignItems: "center", paddingVertical: 30 },
  emptyText: { color: colors.muted, fontWeight: "700" },

  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tieModalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  tieModalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  tieModalSubtitle: {
    marginTop: 6,
    marginBottom: 14,
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
  },
  modalRankBadge: {
    marginTop: 8,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  modalRank: { color: C.primary, fontWeight: "800" },


  emptyPodiumAvatarWrap: {
  backgroundColor: colors.inputBackground,
  borderStyle: "dashed",
},

podiumNameEmpty: {
  marginTop: 8,
  fontWeight: "800",
  color: colors.muted,
  fontSize: 12,
  width: 90,
  textAlign: "center",
},

podiumPtsEmpty: {
  marginTop: 2,
  color: colors.muted,
  fontSize: 11,
  fontWeight: "700",
},
  infoGrid: { marginTop: 16, gap: 8 },
  infoRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  infoLabel: { color: colors.muted, fontWeight: "700" },
  infoValue: { color: colors.text, fontWeight: "800", maxWidth: "60%", textAlign: "right" },

  closeBtn: {
    marginTop: 16,
    backgroundColor: C.primary,
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 12,
  },
  closeBtnText: { color: "#fff", fontWeight: "900" },
});
}