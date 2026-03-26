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
  Linking,
  Animated,
  Dimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { database } from "../constants/firebaseConfig";
import { ref, get, update } from "firebase/database";

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
const TERMS_URL = "https://example.com/terms";
const PRIVACY_URL = "https://example.com/privacy";

const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  const [pwdModal, setPwdModal] = useState(false);
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
          profileImage: userVal?.profileImage || studentVal?.profileImage || null,
          grade,
          section,
          studentId,
        });
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
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const upcoming = useMemo(() => upcomingWithinDays(calendarEvents, 30), [calendarEvents]);
  const todayDay = getTodayDayName();
  const todaySchedule = scheduleMap[todayDay] || [];

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

      if (schoolKey && userNodeKey) {
        await update(ref(database, `Platform1/Schools/${schoolKey}/Users/${userNodeKey}`), {
          profileImage: uri,
        });
      }

      if (schoolKey && studentNodeKey) {
        await update(ref(database, `Platform1/Schools/${schoolKey}/Students/${studentNodeKey}`), {
          profileImage: uri,
        });
      }

      setProfile((p) => ({ ...p, profileImage: uri }));
      Alert.alert("Updated", "Profile photo updated.");
    } catch (e) {
      console.warn("pickAndSavePhoto error:", e);
      Alert.alert("Error", "Could not update profile photo.");
    } finally {
      setSavingPhoto(false);
    }
  }, [schoolKey, userNodeKey, studentNodeKey]);

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

  const logout = useCallback(async () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          try {
            const keys = await AsyncStorage.getAllKeys();
            if (keys?.length) await AsyncStorage.multiRemove(keys);
          } catch {}
          router.replace("/");
        },
      },
    ]);
  }, [router]);

  const openExternal = useCallback(async (url, label) => {
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) return Alert.alert("Unavailable", `${label} link is not configured yet.`);
      await Linking.openURL(url);
    } catch {
      Alert.alert("Error", `Unable to open ${label}.`);
    }
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
      <View style={[styles.backWrap, { top: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

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
        <Image
          source={profile.profileImage ? { uri: profile.profileImage } : AVATAR_PLACEHOLDER}
          style={styles.stretchImage}
        />
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
          <View style={styles.avatarWrap}>
            <Image
              source={profile.profileImage ? { uri: profile.profileImage } : AVATAR_PLACEHOLDER}
              style={styles.avatar}
            />
            <TouchableOpacity style={styles.editAvatarBtn} onPress={pickAndSavePhoto} disabled={savingPhoto}>
              {savingPhoto ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="camera" size={16} color="#fff" />
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.name}>{profile.name}</Text>
          <Text style={styles.subText}>
            {profile.username} {profile.grade ? `• Grade ${profile.grade}` : ""} {profile.section ? `• ${profile.section}` : ""}
          </Text>

          <View style={styles.heroQuickStats}>
            <MiniPill icon="school-outline" text={`Grade ${profile.grade || "--"}`} />
            <MiniPill icon="layers-outline" text={`Section ${profile.section || "--"}`} />
          </View>
        </View>

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
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Upcoming events</Text>

          {upcoming.length === 0 ? (
            <Text style={styles.emptyText}>No upcoming events in the next 30 days.</Text>
          ) : (
            upcoming.slice(0, 4).map((e) => {
              const color = getCategoryColor(e.category || e.type);
              return (
                <View key={e.id} style={styles.eventRow}>
                  <View style={[styles.eventDot, { backgroundColor: color }]} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.eventTopLine}>
                      <Text style={styles.eventTitle}>{e.title || "Event"}</Text>
                      <View style={[styles.eventBadge, { backgroundColor: `${color}16` }]}>
                        <Text style={[styles.eventBadgeText, { color }]}>
                          {getCategoryLabel(e.category || e.type)}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.eventMeta}>{formatDate(e.gregorianDate)}</Text>
                    {!!e.notes && <Text numberOfLines={2} style={styles.eventNotes}>{e.notes}</Text>}
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Account</Text>
          <ActionRow icon="key-outline" title="Change Password" subtitle="Update your account password" onPress={() => setPwdModal(true)} />
          <Divider />
          <ActionRow icon="chatbox-ellipses-outline" title="Contact School" subtitle="Message school management" onPress={() => router.push("/chats")} />
          <Divider />
          <ActionRow
            icon="code-slash-outline"
            title="Contact Developer"
            subtitle="Reach support team"
            onPress={() =>
              Linking.openURL("mailto:support@gojostudy.com").catch(() =>
                Alert.alert("Error", "Cannot open email app")
              )
            }
          />
          <Divider />
          <ActionRow
            icon="document-text-outline"
            title="Terms of Service"
            subtitle="Read usage terms"
            onPress={() => openExternal(TERMS_URL, "Terms of Service")}
          />
          <Divider />
          <ActionRow
            icon="shield-checkmark-outline"
            title="Privacy Policy"
            subtitle="How your data is handled"
            onPress={() => openExternal(PRIVACY_URL, "Privacy Policy")}
          />
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Ionicons name="log-out-outline" size={18} color="#fff" />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>© 2026 Gojo Study • Crafted with care in Ethiopia</Text>
      </Animated.ScrollView>

      <Modal visible={pwdModal} transparent animationType="fade" onRequestClose={() => setPwdModal(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Change Password</Text>

            <TextInput
              value={newPwd}
              onChangeText={setNewPwd}
              placeholder="New password"
              secureTextEntry
              style={styles.input}
            />
            <TextInput
              value={confirmPwd}
              onChangeText={setConfirmPwd}
              placeholder="Confirm password"
              secureTextEntry
              style={styles.input}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={() => setPwdModal(false)} disabled={savingPwd}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.saveBtn]} onPress={savePassword} disabled={savingPwd}>
                {savingPwd ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
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

function MiniPill({ icon, text }) {
  return (
    <View style={styles.miniPill}>
      <Ionicons name={icon} size={13} color={PRIMARY} />
      <Text style={styles.miniPillText}>{text}</Text>
    </View>
  );
}

function ActionRow({ icon, title, subtitle, onPress }) {
  return (
    <TouchableOpacity style={styles.actionRow} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={18} color={PRIMARY} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={MUTED} />
    </TouchableOpacity>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scroll: { padding: 14, paddingBottom: 28, paddingTop: 0 },
  center: { alignItems: "center", justifyContent: "center" },

  backWrap: {
    position: "absolute",
    left: 12,
    zIndex: 50,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },

  stretchContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: SCREEN_WIDTH,
    zIndex: 20,
    overflow: "hidden",
    backgroundColor: "#DDEBFF",
  },
  stretchImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },

  heroCard: {
    marginTop: 10,
    backgroundColor: CARD,
    borderRadius: 22,
    padding: 18,
    alignItems: "center",
    marginBottom: 12,
    zIndex: 3,
    borderWidth: 1,
    borderColor: BORDER,
  },
  avatarWrap: { position: "relative" },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: "#EEF3FF" },
  editAvatarBtn: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  name: { marginTop: 12, fontSize: 20, fontWeight: "800", color: TEXT },
  subText: { marginTop: 4, fontSize: 13, color: MUTED, textAlign: "center" },

  heroQuickStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: 12,
  },
  miniPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SOFT,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    marginHorizontal: 4,
    marginTop: 6,
  },
  miniPillText: {
    marginLeft: 6,
    color: PRIMARY,
    fontSize: 12,
    fontWeight: "700",
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
    backgroundColor: "#FAFCFF",
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
    borderTopColor: "#EEF2FA",
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
    backgroundColor: "#EEF5FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  actionTitle: { fontSize: 14, fontWeight: "700", color: TEXT },
  actionSub: { fontSize: 12, color: MUTED, marginTop: 2 },
  divider: { height: 1, backgroundColor: "#EEF2FA", marginLeft: 44 },

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
  eventNotes: { marginTop: 3, fontSize: 12, color: "#445A8A" },
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
  logoutText: { color: "#fff", fontWeight: "800", marginLeft: 8 },

  footer: { marginTop: 16, textAlign: "center", color: MUTED, fontSize: 12 },

  modalBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
  },
  modalTitle: { fontSize: 16, fontWeight: "800", color: TEXT, marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderColor: "#E4EBFA",
    borderRadius: 10,
    height: 44,
    paddingHorizontal: 12,
    marginBottom: 10,
    color: TEXT,
    backgroundColor: "#FAFCFF",
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
  cancelBtn: { backgroundColor: "#EFF3FB" },
  saveBtn: { backgroundColor: PRIMARY },
  cancelText: { color: "#445A8A", fontWeight: "700" },
  saveText: { color: "#fff", fontWeight: "700" },

  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: "#fff",
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
    backgroundColor: "#D7DFEE",
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
    backgroundColor: "#F7FAFF",
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
    backgroundColor: "#fff",
  },
  daySectionToday: {
    backgroundColor: "#F8FBFF",
    borderColor: "#D9E9FF",
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
    borderTopColor: "#F2F5FB",
  },
  periodBadge: {
    minWidth: 64,
    backgroundColor: "#EEF4FF",
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