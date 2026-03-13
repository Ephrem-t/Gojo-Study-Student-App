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
  Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { database } from "../constants/firebaseConfig";
import { ref, get, update } from "firebase/database";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const PRIMARY = "#007AFB";
const BG = "#F6F8FF";
const CARD = "#FFFFFF";
const TEXT = "#0B2540";
const MUTED = "#6B78A8";

const AVATAR_PLACEHOLDER = require("../assets/images/avatar_placeholder.png");
const TERMS_URL = "https://example.com/terms";
const PRIVACY_URL = "https://example.com/privacy";

function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString();
  } catch {
    return dateStr;
  }
}

function upcomingWithinDays(events, days = 30) {
  const now = new Date();
  const max = new Date(now);
  max.setDate(now.getDate() + days);
  return (events || []).filter((e) => {
    if (!e?.gregorianDate) return false;
    const d = new Date(e.gregorianDate);
    return d >= now && d <= max;
  });
}

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;

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

      if (sk && uKey) {
        const us = await get(ref(database, `Platform1/Schools/${sk}/Users/${uKey}`));
        const userVal = us.exists() ? us.val() : null;

        let studentVal = null;
        if (sKey) {
          const ss = await get(ref(database, `Platform1/Schools/${sk}/Students/${sKey}`));
          if (ss.exists()) studentVal = ss.val();
        }

        setProfile({
          name: userVal?.name || studentVal?.name || "Student",
          username: userVal?.username || studentVal?.studentId || "",
          role: userVal?.role || "student",
          profileImage: userVal?.profileImage || studentVal?.profileImage || null,
          grade: studentVal?.grade || studentVal?.basicStudentInformation?.grade || "",
          section: studentVal?.section || studentVal?.basicStudentInformation?.section || "",
          studentId: studentVal?.studentId || "",
        });
      }

      if (sk) {
        const evSnap = await get(ref(database, `Platform1/Schools/${sk}/CalendarEvents`));
        const arr = [];
        if (evSnap.exists()) {
          evSnap.forEach((c) => {
            arr.push({ id: c.key, ...(c.val() || {}) });
          });
        }
        arr.sort((a, b) => new Date(a.gregorianDate || 0) - new Date(b.gregorianDate || 0));
        setCalendarEvents(arr);
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

  // Negative pull amount (0..220)
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

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Floating back button */}
      <View style={[styles.backWrap, { top: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Pull-down stretch image (above content) */}
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
      >
        {/* Header card with circular default */}
        <View style={styles.profileCard}>
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
          <Text style={styles.pullHint}>Pull down to expand profile photo</Text>
        </View>

        <View style={styles.card}>
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
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Upcoming School Events</Text>
          {upcoming.length === 0 ? (
            <Text style={styles.emptyText}>No upcoming events in the next 30 days.</Text>
          ) : (
            upcoming.slice(0, 4).map((e) => (
              <View key={e.id} style={styles.eventRow}>
                <View style={styles.eventDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.eventTitle}>{e.title || "Event"}</Text>
                  <Text style={styles.eventMeta}>
                    {formatDate(e.gregorianDate)}{" "}
                    {e.ethiopianDate
                      ? `• Eth: ${e.ethiopianDate.day}/${e.ethiopianDate.month}/${e.ethiopianDate.year}`
                      : ""}
                  </Text>
                  {!!e.notes && <Text style={styles.eventNotes}>{e.notes}</Text>}
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
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

      {/* Password modal */}
      <Modal visible={pwdModal} transparent animationType="fade" onRequestClose={() => setPwdModal(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Change Password</Text>

            <TextInput value={newPwd} onChangeText={setNewPwd} placeholder="New password" secureTextEntry style={styles.input} />
            <TextInput value={confirmPwd} onChangeText={setConfirmPwd} placeholder="Confirm password" secureTextEntry style={styles.input} />

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
    </SafeAreaView>
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

  profileCard: {
    marginTop: 10,
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    marginBottom: 12,
    zIndex: 3,
  },
  avatarWrap: { position: "relative" },
  avatar: { width: 92, height: 92, borderRadius: 46, backgroundColor: "#EEF3FF" },
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
  name: { marginTop: 12, fontSize: 18, fontWeight: "800", color: TEXT },
  subText: { marginTop: 4, fontSize: 13, color: MUTED },
  pullHint: { marginTop: 8, fontSize: 11, color: "#8AA0CF" },

  card: {
    backgroundColor: CARD,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: TEXT, marginBottom: 8, marginTop: 2 },

  actionRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
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

  eventRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 8 },
  eventDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: PRIMARY, marginTop: 6, marginRight: 10 },
  eventTitle: { fontSize: 14, fontWeight: "700", color: TEXT },
  eventMeta: { marginTop: 2, fontSize: 12, color: MUTED },
  eventNotes: { marginTop: 2, fontSize: 12, color: "#445A8A" },
  emptyText: { color: MUTED, fontSize: 13, paddingVertical: 4 },

  logoutBtn: {
    marginTop: 4,
    backgroundColor: "#D64545",
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
});