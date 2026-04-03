import React, { useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
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
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, query, orderByChild, equalTo, get } from "firebase/database";
import { database } from "../constants/firebaseConfig";
import { useAppTheme } from "../hooks/use-app-theme";

export const options = { headerShown: false };

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

  const resolveSchoolKeyFromUsername = async (uname) => {
    if (!uname || uname.length < 3) return null;
    const prefix = uname.substr(0, 3).toUpperCase();
    try {
      const snap = await get(ref(database, `Platform1/schoolCodeIndex/${prefix}`));
      if (snap.exists()) return snap.val();
    } catch (e) {
      console.warn("[Login] resolveSchoolKey error", e);
    }
    return null;
  };

  const findUserByUsername = async (uname) => {
    const schoolKey = await resolveSchoolKeyFromUsername(uname);
    if (!schoolKey) {
      return { error: `School code not found for username prefix (${uname.substr(0, 3)})` };
    }

    try {
      const usersRef = ref(database, `Platform1/Schools/${schoolKey}/Users`);
      const q = query(usersRef, orderByChild("username"), equalTo(uname));
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
    // Prefer current username prefix -> schoolKey
    const uname = username.trim();
    let schoolKey = null;

    if (uname && uname.length >= 3) {
      schoolKey = await resolveSchoolKeyFromUsername(uname);
    }

    // fallback to cached schoolKey (if exists)
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
    setError("");
    const uname = username.trim();
    const pwd = String(password ?? "").trim();

    if (!uname || !pwd) {
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

      if (user.role !== "student") {
        setError("This account is not a student account.");
        return;
      }

      const storedPwd = user.password == null ? "" : String(user.password).trim();
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
        ["userId", user.userId || ""],
        ["username", user.username || ""],
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
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.top}>
              <Image source={require("../assets/images/logo.png")} style={styles.logo} resizeMode="contain" />
              <Text style={styles.title}>Let's Start</Text>
              <Text style={styles.subtitle}>Sign in to your Gojo Study student account</Text>
            </View>

            <View style={styles.form}>
              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={styles.inputRow}>
                <Ionicons name="person-outline" size={22} color={colors.muted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Username"
                  placeholderTextColor={colors.muted}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current && passwordRef.current.focus()}
                />
              </View>

              <View style={styles.inputRow}>
                <Ionicons name="key-outline" size={22} color={colors.muted} style={styles.inputIcon} />
                <TextInput
                  ref={passwordRef}
                  style={[styles.input, { paddingRight: 44 }]}
                  placeholder="Password"
                  placeholderTextColor={colors.muted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleSignIn}
                />
                <TouchableOpacity activeOpacity={0.7} onPress={() => setShowPassword((v) => !v)} style={styles.eyeButton}>
                  <Ionicons name={showPassword ? "eye" : "eye-off"} size={20} color={colors.muted} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleSignIn} disabled={loading}>
                {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Login</Text>}
              </TouchableOpacity>

              <TouchableOpacity style={styles.linkRow} onPress={handleNeedHelp}>
                <Text style={styles.linkText}>Need help? Contact your school</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.footer}>
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
    scrollContent: { flexGrow: 1, justifyContent: "space-between", paddingTop: 12, paddingBottom: 20 },
    top: { alignItems: "center", marginTop: 8 },
    logo: { width: 200, height: 200, borderRadius: 14, marginTop: 16 },
    title: { marginTop: -12, fontSize: 36, color: colors.text, fontWeight: "800" },
    subtitle: { marginTop: 8, fontSize: 14, color: colors.muted, textAlign: "center" },

    form: { paddingHorizontal: 28, marginTop: 8 },
    error: { color: colors.danger, marginBottom: 8, textAlign: "center" },

    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      height: 56,
      marginTop: 12,
    },
    inputIcon: { marginRight: 8 },
    input: { flex: 1, fontSize: 16, color: colors.text },

    eyeButton: {
      position: "absolute",
      right: 18,
      height: 56,
      alignItems: "center",
      justifyContent: "center",
    },

    button: {
      height: 56,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 20,
    },
    buttonDisabled: { opacity: 0.75 },
    buttonText: { color: colors.white, fontWeight: "800", fontSize: 18 },

    linkRow: { marginTop: 12, alignItems: "center" },
    linkText: { color: colors.primary, fontWeight: "600" },

    footer: { alignItems: "center", marginTop: 28, paddingBottom: 8 },
    copyright: { color: colors.muted, fontSize: 12 },
  });
}