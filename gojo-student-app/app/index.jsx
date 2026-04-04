import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  StyleSheet,
  TouchableWithoutFeedback,
  Keyboard,
  Linking,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, query, orderByChild, equalTo, get } from "firebase/database";
import { database } from "../constants/firebaseConfig";
import {
  SESSION_AUTH_KEYS,
  SESSION_EXPIRED_NOTICE_KEY,
  SESSION_LAST_ACTIVE_KEY,
  SESSION_LAST_LOGIN_KEY,
  SESSION_TIMEOUT_DAYS,
  isStudentSessionValid,
} from "../constants/session";
import { useAppTheme } from "../hooks/use-app-theme";

export const options = { headerShown: false };

function normalizeUsernameValue(value = "") {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

export default function LoginScreen() {
  const router = useRouter();
  const { colors, statusBarStyle } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const passwordRef = useRef(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [restoringSession, setRestoringSession] = useState(true);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const pairs = await AsyncStorage.multiGet([
          "role",
          "userId",
          SESSION_LAST_ACTIVE_KEY,
          SESSION_LAST_LOGIN_KEY,
          SESSION_EXPIRED_NOTICE_KEY,
        ]);
        if (!mounted) return;

        const session = Object.fromEntries(pairs);
        if (isStudentSessionValid(session)) {
          await AsyncStorage.multiRemove([SESSION_EXPIRED_NOTICE_KEY]);
          await AsyncStorage.setItem(SESSION_LAST_ACTIVE_KEY, String(Date.now()));
          router.replace("/dashboard/home");
          return;
        }

        if (session.role === "student" && session.userId) {
          await AsyncStorage.multiRemove(SESSION_AUTH_KEYS);
          await AsyncStorage.setItem(SESSION_EXPIRED_NOTICE_KEY, String(Date.now()));
          if (mounted) {
            setError(`For your security, please sign in again after ${SESSION_TIMEOUT_DAYS} days of inactivity.`);
          }
          return;
        }

        if (session[SESSION_EXPIRED_NOTICE_KEY] && mounted) {
          await AsyncStorage.removeItem(SESSION_EXPIRED_NOTICE_KEY);
          setError(`For your security, please sign in again after ${SESSION_TIMEOUT_DAYS} days of inactivity.`);
        }
      } catch (sessionError) {
        console.warn("[Login] restore session error:", sessionError);
      } finally {
        if (mounted) {
          setRestoringSession(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSubscription = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const canSubmit = useMemo(
    () => !!normalizeUsernameValue(username) && !!String(password || "").trim() && !loading,
    [loading, password, username]
  );

  const resolveSchoolKeyFromUsername = async (uname) => {
    const normalizedUsername = normalizeUsernameValue(uname);
    if (!normalizedUsername || normalizedUsername.length < 3) return null;

    const prefix = normalizedUsername.slice(0, 3);
    try {
      const snap = await get(ref(database, `Platform1/schoolCodeIndex/${prefix}`));
      if (snap.exists()) return snap.val();
    } catch (e) {
      console.warn("[Login] resolveSchoolKey error", e);
    }
    return null;
  };

  const findUserByUsername = async (uname) => {
    const normalizedUsername = normalizeUsernameValue(uname);
    const schoolKey = await resolveSchoolKeyFromUsername(normalizedUsername);
    if (!schoolKey) {
      return { error: `School code not found for username prefix (${normalizedUsername.slice(0, 3)})` };
    }

    try {
      const usersRef = ref(database, `Platform1/Schools/${schoolKey}/Users`);
      const q = query(usersRef, orderByChild("username"), equalTo(normalizedUsername));
      const snap = await get(q);
      if (snap.exists()) {
        let found = null;
        snap.forEach((child) => {
          found = { ...child.val(), _nodeKey: child.key, _schoolKey: schoolKey };
          return true;
        });
        return { user: found };
      } else {
        return { error: "No account found with that username in the resolved school." };
      }
    } catch (err) {
      console.error("[Login] findUserByUsername", err);
      return { error: "Lookup failed" };
    }
  };

  function normalizeAndFormatGrade(val) {
    if (val == null) return null;
    const s = String(val).trim().toLowerCase();
    const m = s.match(/(\d{1,2})/);
    if (m) return `grade${m[1]}`;
    return `grade${s.replace(/\D/g, "") || s}`;
  }

  // NEW: open dialer with Platform1/schoolInfo/phone
  const handleNeedHelp = async () => {
    try {
      const uname = normalizeUsernameValue(username);
      let schoolKey = null;

      if (uname && uname.length >= 3) {
        schoolKey = await resolveSchoolKeyFromUsername(uname);
      }

      if (!schoolKey) {
        schoolKey = await AsyncStorage.getItem("schoolKey");
      }

      if (!schoolKey) {
        return Alert.alert("Unavailable", "Could not resolve school contact yet. Enter your username first.");
      }

      const schoolInfoSnap = await get(ref(database, `Platform1/Schools/${schoolKey}/schoolInfo`));
      if (!schoolInfoSnap.exists()) {
        return Alert.alert("Unavailable", "School contact is not available yet.");
      }

      const schoolInfo = schoolInfoSnap.val() || {};
      const phoneRaw = schoolInfo.phone || schoolInfo.alternativePhone || "";
      const phone = String(phoneRaw).replace(/[^\d+]/g, "");

      if (!phone) {
        return Alert.alert("Unavailable", "School phone number is missing.");
      }

      const telUrl = `tel:${phone}`;
      const canOpen = await Linking.canOpenURL(telUrl);
      if (!canOpen) {
        return Alert.alert("Unavailable", `Cannot open dialer for: ${phone}`);
      }

      await Linking.openURL(telUrl);
    } catch (e) {
      console.warn("[Login] handleNeedHelp error:", e);
      Alert.alert("Error", "Could not open dialer.");
    }
  };

  const handleSignIn = async () => {
    Keyboard.dismiss();
    setError("");
    const uname = normalizeUsernameValue(username);
    const pwd = String(password ?? "");

    if (!uname || !pwd.trim()) {
      setError("Please enter username and password.");
      return;
    }

    setLoading(true);
    try {
      const { user, error: lookupError } = await findUserByUsername(uname);
      if (lookupError) {
        setError(lookupError);
        return;
      }
      if (!user) {
        setError("No account found with that username.");
        return;
      }

      if (String(user.role || "").trim().toLowerCase() !== "student") {
        setError("This account is not a student account.");
        return;
      }

      const storedPwd = user.password == null ? "" : String(user.password);
      if (!storedPwd || storedPwd !== pwd) {
        setError("Incorrect password.");
        return;
      }

      if (typeof user.isActive === "boolean" && !user.isActive) {
        setError("Account is inactive. Contact the administrator.");
        return;
      }

      const studentNodeKey = user.studentId || "";

      let studentGradeFormatted = null;
      try {
        if (user._schoolKey && studentNodeKey) {
          const studSnap = await get(ref(database, `Platform1/Schools/${user._schoolKey}/Students/${studentNodeKey}`));
          if (studSnap && studSnap.exists()) {
            const studVal = studSnap.val() || {};
            const gradeRaw = studVal?.basicStudentInformation?.grade ?? studVal?.grade ?? null;
            const normalized = normalizeAndFormatGrade(gradeRaw);
            if (normalized) studentGradeFormatted = normalized;
          }
        }
      } catch (e) {
        console.warn("[Login] could not read student record for grade:", e);
      }

      const items = [
        [SESSION_LAST_ACTIVE_KEY, String(Date.now())],
        [SESSION_LAST_LOGIN_KEY, String(Date.now())],
        ["userId", user.userId || ""],
        ["username", user.username || uname],
        ["userNodeKey", user._nodeKey || ""],
        ["studentId", user.studentId || ""],
        ["studentNodeKey", studentNodeKey || ""],
        ["role", user.role || ""],
        ["schoolKey", user._schoolKey || ""],
      ];
      if (studentGradeFormatted) items.push(["studentGrade", studentGradeFormatted]);

      await AsyncStorage.multiSet(items);

      router.replace("/dashboard/home");
    } catch (err) {
      console.error("Login error:", err);
      setError("Unable to sign in. Try again.");
    } finally {
      setLoading(false);
    }
  };

  if (restoringSession) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
        <StatusBar style={statusBarStyle} />
        <View style={styles.bootWrap}>
          <View style={styles.bootCard}>
            <Image source={require("../assets/images/login-logo.png")} style={styles.bootLogo} resizeMode="contain" />
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.bootTitle}>Preparing your workspace</Text>
            <Text style={styles.bootText}>Checking your saved student session.</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style={statusBarStyle} />
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 70 : 20}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={[
              styles.scrollContent,
              keyboardVisible && styles.scrollContentKeyboard,
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            scrollEnabled={keyboardVisible}
          >
            <View pointerEvents="none" style={styles.glowTop} />
            <View pointerEvents="none" style={styles.glowBottom} />

            <View style={styles.top}>
              <View style={styles.heroPill}>
                <Ionicons name="shield-checkmark-outline" size={14} color={colors.primary} />
                <Text style={styles.heroPillText}>Student app</Text>
              </View>

              <Image source={require("../assets/images/login-logo.png")} style={styles.logo} resizeMode="contain" />
              <Text style={styles.title}>Welcome back</Text>
              <Text style={styles.subtitle}>Sign in to continue to your student dashboard.</Text>
            </View>

            <View style={styles.formCard}>
              <View style={styles.formHeader}>
                <Text style={styles.formTitle}>Sign in</Text>
                <Text style={styles.formSubtitle}>Student account access</Text>
              </View>

              {error ? (
                <View style={styles.errorCard}>
                  <Ionicons name="alert-circle" size={18} color={colors.danger} />
                  <Text style={styles.error}>{error}</Text>
                </View>
              ) : null}

              <Text style={styles.fieldLabel}>Username</Text>

              <View style={styles.inputRow}>
                <Ionicons name="person-outline" size={22} color={colors.muted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Username"
                  placeholderTextColor={colors.muted}
                  value={username}
                  onChangeText={(value) => {
                    setError("");
                    setUsername(value);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current && passwordRef.current.focus()}
                />
              </View>

              <Text style={styles.fieldHint}>The first 3 letters help us find your school.</Text>

              <Text style={[styles.fieldLabel, styles.fieldLabelSpacer]}>Password</Text>

              <View style={styles.inputRow}>
                <Ionicons name="key-outline" size={22} color={colors.muted} style={styles.inputIcon} />
                <TextInput
                  ref={passwordRef}
                  style={[styles.input, { paddingRight: 44 }]}
                  placeholder="Password"
                  placeholderTextColor={colors.muted}
                  value={password}
                  onChangeText={(value) => {
                    setError("");
                    setPassword(value);
                  }}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  textContentType="password"
                  returnKeyType="done"
                  onSubmitEditing={handleSignIn}
                />
                <TouchableOpacity activeOpacity={0.7} onPress={() => setShowPassword((v) => !v)} style={styles.eyeButton}>
                  <Ionicons name={showPassword ? "eye" : "eye-off"} size={20} color={colors.muted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldHint}>Your session stays signed in on this device.</Text>

              <TouchableOpacity style={[styles.button, !canSubmit && styles.buttonDisabled]} onPress={handleSignIn} disabled={!canSubmit}>
                {loading ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <View style={styles.buttonContent}>
                    <Ionicons name="lock-closed-outline" size={16} color={colors.white} />
                    <Text style={styles.buttonText}>Sign in to dashboard</Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.supportRow} onPress={handleNeedHelp} activeOpacity={0.85}>
                <Ionicons name="call-outline" size={16} color={colors.primary} />
                <Text style={styles.supportRowText}>Need help? Contact your school</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.muted} />
              </TouchableOpacity>
            </View>

            <View style={[styles.footer, keyboardVisible && styles.footerKeyboard]}>
              <Text style={styles.copyright}>© 2026 GojoStudy. All rights reserved.</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    safe: { flex: 1, backgroundColor: colors.screen },
    scrollContent: {
      flexGrow: 1,
      justifyContent: "space-between",
      paddingTop: 18,
      paddingBottom: 18,
      paddingHorizontal: 18,
      position: "relative",
      overflow: "hidden",
    },
    scrollContentKeyboard: {
      justifyContent: "flex-start",
      paddingBottom: 28,
    },
    glowTop: {
      position: "absolute",
      top: -72,
      right: -36,
      width: 188,
      height: 188,
      borderRadius: 999,
      backgroundColor: "rgba(74,140,255,0.14)",
    },
    glowBottom: {
      position: "absolute",
      bottom: 72,
      left: -64,
      width: 180,
      height: 180,
      borderRadius: 999,
      backgroundColor: "rgba(52,211,153,0.08)",
    },
    top: { alignItems: "center", marginTop: 2 },
    heroPill: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.soft,
      borderWidth: 1,
      borderColor: colors.border,
    },
    heroPillText: {
      marginLeft: 6,
      color: colors.primary,
      fontSize: 11,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    logo: { width: 116, height: 116, borderRadius: 18, marginTop: 12 },
    title: { marginTop: -2, fontSize: 30, color: colors.text, fontWeight: "900" },
    subtitle: {
      marginTop: 8,
      fontSize: 13,
      lineHeight: 18,
      color: colors.muted,
      textAlign: "center",
      maxWidth: 300,
      fontWeight: "600",
    },
    heroHintCard: {
      marginTop: 12,
      width: "100%",
      flexDirection: "row",
      alignItems: "flex-start",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.infoBorder,
      backgroundColor: colors.infoSurface,
    },
    heroHintText: {
      flex: 1,
      marginLeft: 8,
      color: colors.text,
      fontSize: 11,
      lineHeight: 16,
      fontWeight: "700",
    },

    formCard: {
      marginTop: 16,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: 16,
      paddingVertical: 16,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: colors.background === "#fff" ? 0.06 : 0.18,
      shadowRadius: 20,
      elevation: 4,
    },
    formHeader: {
      marginBottom: 2,
    },
    formTitle: {
      color: colors.text,
      fontSize: 20,
      fontWeight: "900",
    },
    formSubtitle: {
      marginTop: 3,
      color: colors.muted,
      fontSize: 11,
      fontWeight: "700",
    },
    errorCard: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.dangerBorder,
      backgroundColor: colors.dangerSurface,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 12,
    },
    error: {
      flex: 1,
      color: colors.danger,
      marginLeft: 8,
      fontSize: 11,
      lineHeight: 16,
      fontWeight: "700",
    },
    fieldLabel: {
      marginTop: 12,
      marginBottom: 6,
      color: colors.text,
      fontSize: 12,
      fontWeight: "800",
    },
    fieldLabelSpacer: {
      marginTop: 10,
    },

    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.inputBackground,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      height: 52,
    },
    inputIcon: { marginRight: 8 },
    input: { flex: 1, fontSize: 16, color: colors.text },
    fieldHint: {
      marginTop: 6,
      color: colors.muted,
      fontSize: 10,
      lineHeight: 15,
      fontWeight: "600",
    },

    eyeButton: {
      position: "absolute",
      right: 18,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
    },

    button: {
      height: 52,
      borderRadius: 15,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 14,
    },
    buttonDisabled: { opacity: 0.55 },
    buttonContent: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    },
    buttonText: { color: colors.white, fontWeight: "900", fontSize: 16, marginLeft: 8 },

    supportRow: {
      marginTop: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    },
    supportRowText: {
      marginHorizontal: 8,
      color: colors.primary,
      fontSize: 12,
      fontWeight: "700",
    },

    footer: { alignItems: "center", marginTop: 18, paddingBottom: 4 },
    footerKeyboard: { marginTop: 12 },
    copyright: { color: colors.muted, fontSize: 12 },

    bootWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 24,
      backgroundColor: colors.screen,
    },
    bootCard: {
      width: "100%",
      maxWidth: 360,
      alignItems: "center",
      paddingHorizontal: 22,
      paddingVertical: 26,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    bootLogo: {
      width: 120,
      height: 120,
      marginBottom: 14,
    },
    bootTitle: {
      marginTop: 14,
      color: colors.text,
      fontSize: 18,
      fontWeight: "900",
    },
    bootText: {
      marginTop: 6,
      color: colors.muted,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: "600",
      textAlign: "center",
    },
  });
}