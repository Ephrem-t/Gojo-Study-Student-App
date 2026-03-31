import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Easing,
  Linking,
  Modal,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Dimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { database } from "../constants/firebaseConfig";
import { get, ref, update } from "firebase/database";
import { useAppTheme } from "../hooks/use-app-theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const TERMS_URL = "https://example.com/terms";
const PRIVACY_URL = "https://example.com/privacy";

export default function SettingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { resolvedAppearance, colors, statusBarStyle, setAppearance } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const slideX = useRef(new Animated.Value(SCREEN_WIDTH)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);
  const defaultPreferences = useMemo(() => ({
    examReminders: true,
    messageAlerts: true,
    weeklySummary: false,
    appearance: "system",
  }), []);

  const [pwdModal, setPwdModal] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [schoolKey, setSchoolKey] = useState(null);
  const [userNodeKey, setUserNodeKey] = useState(null);
  const [studentNodeKey, setStudentNodeKey] = useState(null);
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const isDarkMode = resolvedAppearance === "dark";

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideX, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideX]);

  const navigateAwayFromSettings = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/profiles");
  }, [router]);

  const closeScreen = useCallback((nextAction) => {
    if (closingRef.current) return;
    closingRef.current = true;

    Animated.parallel([
      Animated.timing(slideX, {
        toValue: SCREEN_WIDTH,
        duration: 240,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      closingRef.current = false;
      if (!finished) return;
      if (typeof nextAction === "function") {
        nextAction();
        return;
      }
      navigateAwayFromSettings();
    });
  }, [fadeAnim, navigateAwayFromSettings, slideX]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      closeScreen();
      return true;
    });

    return () => subscription.remove();
  }, [closeScreen]);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        const nextSchoolKey = await AsyncStorage.getItem("schoolKey");
        const nextUserNodeKey = (await AsyncStorage.getItem("userNodeKey")) || null;
        const nextStudentNodeKey =
          (await AsyncStorage.getItem("studentNodeKey")) ||
          (await AsyncStorage.getItem("studentId")) ||
          null;

        if (!active) return;

        setSchoolKey(nextSchoolKey);
        setUserNodeKey(nextUserNodeKey);
        setStudentNodeKey(nextStudentNodeKey);

        if (!nextSchoolKey || !nextUserNodeKey) return;

        const userSnap = await get(ref(database, `Platform1/Schools/${nextSchoolKey}/Users/${nextUserNodeKey}`)).catch(() => null);
        const studentSnap = nextStudentNodeKey
          ? await get(ref(database, `Platform1/Schools/${nextSchoolKey}/Students/${nextStudentNodeKey}`)).catch(() => null)
          : null;

        const userVal = userSnap?.exists() ? userSnap.val() || {} : {};
        const studentVal = studentSnap?.exists() ? studentSnap.val() || {} : {};

        if (!active) return;

        const remotePreferences =
          userVal?.appPreferences ||
          studentVal?.systemAccountInformation?.appPreferences ||
          null;

        if (remotePreferences && active) {
          const mergedPreferences = { ...defaultPreferences, ...remotePreferences };
          setPreferences(mergedPreferences);
          if (mergedPreferences.appearance) {
            await setAppearance(mergedPreferences.appearance);
          }
        } else {
          const storedPreferences = await AsyncStorage.getItem("studentSettingsPreferences");
          if (storedPreferences && active) {
            const mergedPreferences = { ...defaultPreferences, ...JSON.parse(storedPreferences) };
            setPreferences(mergedPreferences);
            if (mergedPreferences.appearance) {
              await setAppearance(mergedPreferences.appearance);
            }
          }
        }
      } catch (error) {
        console.warn("Settings profile load error:", error);
      }
    }

    loadProfile();
    return () => {
      active = false;
    };
  }, [defaultPreferences, setAppearance]);

  const updatePreference = useCallback(async (key, value) => {
    let nextPreferences = null;

    setPreferences((prev) => {
      nextPreferences = { ...prev, [key]: value };
      return nextPreferences;
    });

    if (!nextPreferences) return;

    AsyncStorage.setItem("studentSettingsPreferences", JSON.stringify(nextPreferences)).catch(() => null);

    if (!schoolKey || !userNodeKey) return;

    try {
      await update(ref(database, `Platform1/Schools/${schoolKey}/Users/${userNodeKey}`), {
        appPreferences: nextPreferences,
      });

      if (studentNodeKey) {
        await update(
          ref(database, `Platform1/Schools/${schoolKey}/Students/${studentNodeKey}/systemAccountInformation`),
          { appPreferences: nextPreferences }
        );
      }
    } catch (error) {
      console.warn("Settings preference update error:", error);
    }
  }, [schoolKey, studentNodeKey, userNodeKey]);

  const updateAppearancePreference = useCallback(async (nextAppearance) => {
    await setAppearance(nextAppearance);
    await updatePreference("appearance", nextAppearance);
  }, [setAppearance, updatePreference]);

  const openExternal = useCallback(async (url, label) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert("Unavailable", `${label} link is not configured yet.`);
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert("Error", `Unable to open ${label}.`);
    }
  }, []);

  const openMail = useCallback(async () => {
    try {
      await Linking.openURL("mailto:support@gojostudy.com");
    } catch {
      Alert.alert("Error", "Cannot open email app");
    }
  }, []);

  const resetAppSettings = useCallback(() => {
    Alert.alert("Reset App Settings", "Restore all app settings to their default values?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: async () => {
          await setAppearance(defaultPreferences.appearance);
          setPreferences(defaultPreferences);
          await AsyncStorage.setItem("studentSettingsPreferences", JSON.stringify(defaultPreferences)).catch(() => null);

          if (schoolKey && userNodeKey) {
            try {
              await update(ref(database, `Platform1/Schools/${schoolKey}/Users/${userNodeKey}`), {
                appPreferences: defaultPreferences,
              });

              if (studentNodeKey) {
                await update(
                  ref(database, `Platform1/Schools/${schoolKey}/Students/${studentNodeKey}/systemAccountInformation`),
                  { appPreferences: defaultPreferences }
                );
              }
            } catch (error) {
              console.warn("Reset app settings error:", error);
            }
          }

          Alert.alert("Done", "App settings were reset.");
        },
      },
    ]);
  }, [defaultPreferences, schoolKey, setAppearance, studentNodeKey, userNodeKey]);

  const openAboutApp = useCallback(() => {
    Alert.alert(
      "About Gojo Study",
      "Gojo Study Student App\n\nManage your school schedule, notes, leaderboard access, chats, and study preferences in one place."
    );
  }, []);

  const savePassword = useCallback(async () => {
    if (!newPwd || newPwd.length < 4) {
      Alert.alert("Invalid", "Password must be at least 4 characters.");
      return;
    }

    if (newPwd !== confirmPwd) {
      Alert.alert("Mismatch", "Passwords do not match.");
      return;
    }

    if (!schoolKey || !userNodeKey) {
      Alert.alert("Error", "Missing account information.");
      return;
    }

    try {
      setSavingPwd(true);

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
    } catch (error) {
      console.warn("Settings password update error:", error);
      Alert.alert("Error", "Could not update password.");
    } finally {
      setSavingPwd(false);
    }
  }, [confirmPwd, newPwd, schoolKey, studentNodeKey, userNodeKey]);

  const clearSessionStorage = useCallback(async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      if (keys?.length) {
        await AsyncStorage.multiRemove(keys);
        return;
      }
    } catch {}

    // Fallback removal for known app/session keys if getAllKeys fails.
    const fallbackKeys = [
      "userId",
      "username",
      "userNodeKey",
      "studentId",
      "studentNodeKey",
      "role",
      "schoolKey",
      "studentGrade",
      "grade",
      "profileImage",
      "appearancePreference",
    ];

    try {
      await AsyncStorage.multiRemove(fallbackKeys);
    } catch {}
  }, []);

  const logout = useCallback(() => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await clearSessionStorage();

          closeScreen(() => router.replace("/"));
        },
      },
    ]);
  }, [clearSessionStorage, closeScreen, router]);

  return (
    <View style={styles.screen}>
      <Animated.View style={[styles.screen, { opacity: fadeAnim, transform: [{ translateX: slideX }] }]}>
        <SafeAreaView style={styles.safeArea}>
          <StatusBar style={statusBarStyle} backgroundColor={colors.screen} />
          <View style={[styles.topBarWrap, { paddingTop: Math.max(6, insets.top > 0 ? 6 : 10) }]}>
            <View style={styles.topBar}>
              <TouchableOpacity style={styles.topBarAction} onPress={() => closeScreen()} activeOpacity={0.85}>
                <View style={styles.backBtn}>
                  <Ionicons name="chevron-back" size={19} color={colors.text} />
                </View>
                <Text style={styles.topBarTitle}>Settings</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            <Text style={styles.sectionLabel}>Appearance</Text>
            <View style={styles.groupCard}>
              <SettingSwitchRow
                icon="moon-outline"
                label="Dark Mode"
                caption="Switch the app between light and dark"
                value={isDarkMode}
                onValueChange={(value) => updateAppearancePreference(value ? "dark" : "light")}
                colors={colors}
                styles={styles}
              />
            </View>

            <Text style={styles.sectionLabel}>App Settings</Text>
            <View style={styles.groupCard}>
              <SettingSwitchRow
                icon="notifications-outline"
                label="Exam Reminders"
                caption="Get reminded before tests and deadlines"
                value={preferences.examReminders}
                onValueChange={(value) => updatePreference("examReminders", value)}
                colors={colors}
                styles={styles}
              />
              <Divider styles={styles} />
              <SettingSwitchRow
                icon="chatbubble-ellipses-outline"
                label="Message Alerts"
                caption="Show alerts for new school and class messages"
                value={preferences.messageAlerts}
                onValueChange={(value) => updatePreference("messageAlerts", value)}
                colors={colors}
                styles={styles}
              />
              <Divider styles={styles} />
              <SettingSwitchRow
                icon="stats-chart-outline"
                label="Weekly Summary"
                caption="Keep a weekly study recap ready in the app"
                value={preferences.weeklySummary}
                onValueChange={(value) => updatePreference("weeklySummary", value)}
                colors={colors}
                styles={styles}
              />
              <Divider styles={styles} />
              <SettingRow
                icon="refresh-outline"
                label="Reset App Settings"
                caption="Restore the default app preferences"
                onPress={resetAppSettings}
                colors={colors}
                styles={styles}
              />
              <Divider styles={styles} />
              <SettingRow
                icon="information-circle-outline"
                label="About Gojo Study"
                caption="See what this app section controls"
                onPress={openAboutApp}
                colors={colors}
                styles={styles}
              />
            </View>

            <Text style={styles.sectionLabel}>Student Tools</Text>
            <View style={styles.groupCard}>
              <SettingRow
                icon="calendar-outline"
                label="School Calendar"
                caption="Check school dates and upcoming events"
                onPress={() => router.push("/calendar")}
                colors={colors}
                styles={styles}
              />
              <Divider styles={styles} />
              <SettingRow
                icon="chatbox-ellipses-outline"
                label="Contact School"
                caption="Open the school chat room"
                onPress={() => router.push("/chats")}
                colors={colors}
                styles={styles}
              />
              <Divider styles={styles} />
              <SettingRow
                icon="bookmark-outline"
                label="Saved Posts"
                caption="See the posts you bookmarked from home"
                onPress={() => router.push("/savedPosts")}
                colors={colors}
                styles={styles}
              />
              <Divider styles={styles} />
              <SettingRow
                icon="podium-outline"
                label="Leaderboard"
                caption="See the current ranking board"
                onPress={() => router.push("/leaderboard")}
                colors={colors}
                styles={styles}
              />
            </View>

            <Text style={styles.sectionLabel}>Account</Text>
            <View style={styles.groupCard}>
              <SettingRow
                icon="key-outline"
                label="Change Password"
                caption="Update your account password"
                onPress={() => setPwdModal(true)}
                colors={colors}
                styles={styles}
              />
              <Divider styles={styles} />
              <SettingRow
                icon="person-outline"
                label="Profile"
                caption="Go back to your profile page"
                onPress={() => closeScreen()}
                colors={colors}
                styles={styles}
              />
            </View>

            <Text style={styles.sectionLabel}>Support</Text>
            <View style={styles.groupCard}>
              <SettingRow
                icon="code-slash-outline"
                label="Contact Developer"
                caption="Email the support team"
                onPress={openMail}
                colors={colors}
                styles={styles}
              />
              <Divider styles={styles} />
              <SettingRow
                icon="document-text-outline"
                label="Terms of Service"
                caption="Read the app terms"
                onPress={() => openExternal(TERMS_URL, "Terms of Service")}
                colors={colors}
                styles={styles}
              />
              <Divider styles={styles} />
              <SettingRow
                icon="shield-checkmark-outline"
                label="Privacy Policy"
                caption="See how your data is handled"
                onPress={() => openExternal(PRIVACY_URL, "Privacy Policy")}
                colors={colors}
                styles={styles}
              />
            </View>

            <Text style={styles.sectionLabel}>Danger Zone</Text>
            <View style={styles.groupCard}>
              <SettingRow
                icon="log-out-outline"
                label="Logout"
                caption="Sign out from this device"
                danger
                onPress={logout}
                colors={colors}
                styles={styles}
              />
            </View>
          </ScrollView>

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
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.cancelBtn]}
                    onPress={() => setPwdModal(false)}
                    disabled={savingPwd}
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.saveBtn]}
                    onPress={savePassword}
                    disabled={savingPwd}
                  >
                    {savingPwd ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

function SettingRow({ icon, label, caption, onPress, danger = false, colors, styles }) {
  return (
    <TouchableOpacity style={styles.settingRow} onPress={onPress} activeOpacity={0.86}>
      <View style={styles.settingLeft}>
        <Ionicons name={icon} size={18} color={danger ? colors.danger : colors.text} />
        <View style={styles.settingTextWrap}>
          <Text style={[styles.settingLabel, danger && styles.settingLabelDanger]}>{label}</Text>
          <Text style={styles.settingCaption}>{caption}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </TouchableOpacity>
  );
}

function SettingSwitchRow({ icon, label, caption, value, onValueChange, colors, styles }) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingLeft}>
        <Ionicons name={icon} size={18} color={colors.text} />
        <View style={styles.settingTextWrap}>
          <Text style={styles.settingLabel}>{label}</Text>
          <Text style={styles.settingCaption}>{caption}</Text>
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        thumbColor={value ? colors.white : colors.surfaceMuted}
        trackColor={{ false: colors.border, true: colors.primary }}
      />
    </View>
  );
}

function Divider({ styles }) {
  return <View style={styles.divider} />;
}

function createStyles(colors) {
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.screen,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.screen,
  },
  topBarWrap: {
    backgroundColor: colors.screen,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topBar: {
    height: 62,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  topBarAction: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  topBarTitle: {
    marginLeft: 10,
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 34,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 9,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  groupCard: {
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
    overflow: "hidden",
  },
  settingRow: {
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  settingTextWrap: {
    marginLeft: 10,
    flex: 1,
    paddingRight: 12,
  },
  settingLabel: {
    fontSize: 14,
    color: colors.text,
    fontWeight: "700",
  },
  settingLabelDanger: {
    color: colors.danger,
  },
  settingCaption: {
    marginTop: 2,
    fontSize: 11,
    color: colors.muted,
    fontWeight: "600",
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 40,
  },
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
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    height: 44,
    paddingHorizontal: 12,
    marginBottom: 10,
    color: colors.text,
    backgroundColor: colors.inputBackground,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 4,
  },
  modalBtn: {
    minWidth: 90,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  cancelBtn: {
    backgroundColor: colors.surfaceMuted,
  },
  saveBtn: {
    backgroundColor: colors.primary,
  },
  cancelText: {
    color: colors.text,
    fontWeight: "700",
  },
  saveText: {
    color: colors.white,
    fontWeight: "700",
  },
  });
}