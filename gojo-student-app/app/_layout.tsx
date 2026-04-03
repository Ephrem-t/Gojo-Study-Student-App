import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemeProvider } from "@react-navigation/native";
import { AppState, SafeAreaView, StyleSheet, View, Text, TouchableOpacity, Animated, Easing, Modal, Platform } from "react-native";
import { Stack, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getValue } from "./lib/dbHelpers";
import PasscodePanel from "../components/passcode-panel";
import { AppLockProvider } from "../hooks/use-app-lock";
import {
  APP_LOCK_LAST_INACTIVE_AT_KEY,
  APP_LOCK_PASSCODE_LENGTH,
  DEFAULT_APP_LOCK_STATE,
  loadStoredAppLock,
  normalizePasscodeValue,
  resolveAppLockAccountKey,
} from "../constants/appLock";
import {
  SESSION_AUTH_KEYS,
  SESSION_EXPIRED_NOTICE_KEY,
  SESSION_LAST_ACTIVE_KEY,
  isStudentSessionValid,
} from "../constants/session";
import { AppThemeProvider, useAppTheme } from "../hooks/use-app-theme";

export const unstable_settings = {
  initialRouteName: "index",
};

type Notif = {
  id: string;
  title?: string;
  body?: string;
  deepLink?: string;
  createdAt?: number;
  type?: string;
  grades?: Record<string, boolean>;
  meta?: {
    packageId?: string;
    subjectKey?: string;
    roundId?: string;
    examId?: string;
    questionBankId?: string;
  };
};

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <ThemedRootLayout />
    </AppThemeProvider>
  );
}

function ThemedRootLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { colors, navigationTheme, statusBarStyle } = useAppTheme();
  const bootRedirectDoneRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const sessionSyncDoneRef = useRef(false);
  const [appLock, setAppLock] = useState(DEFAULT_APP_LOCK_STATE);
  const [appLocked, setAppLocked] = useState(false);
  const [unlockCode, setUnlockCode] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const currentPath = String(pathname || "/");
  const isPublicRoute = currentPath === "/" || currentPath === "/index";

  const resetAppLockState = useCallback(() => {
    AsyncStorage.removeItem(APP_LOCK_LAST_INACTIVE_AT_KEY).catch(() => null);
    setAppLock(DEFAULT_APP_LOCK_STATE);
    setAppLocked(false);
    setUnlockCode("");
    setUnlockError("");
  }, []);

  const syncAppLockState = useCallback(async (session: Record<string, string | null>, options?: { evaluateAutoLock?: boolean }) => {
    const role = String(session.role || "");
    const evaluateAutoLock = Boolean(options?.evaluateAutoLock);

    if (role !== "student") {
      resetAppLockState();
      return;
    }

    const accountKey = resolveAppLockAccountKey(session.studentNodeKey, session.studentId, session.userId);
    const normalizedAppLock = await loadStoredAppLock(accountKey);

    setAppLock(normalizedAppLock);

    if (!normalizedAppLock.enabled) {
      AsyncStorage.removeItem(APP_LOCK_LAST_INACTIVE_AT_KEY).catch(() => null);
      setAppLocked(false);
      setUnlockCode("");
      setUnlockError("");
      return;
    }

    if (!evaluateAutoLock) {
      return;
    }

    const lastInactiveValue = await AsyncStorage.getItem(APP_LOCK_LAST_INACTIVE_AT_KEY);
    await AsyncStorage.removeItem(APP_LOCK_LAST_INACTIVE_AT_KEY).catch(() => null);

    const lastInactiveAt = Number(lastInactiveValue || 0);
    const shouldLock =
      lastInactiveAt > 0 && Date.now() - lastInactiveAt >= Number(normalizedAppLock.autoLockDelayMs || 0);

    if (shouldLock) {
      setUnlockCode("");
      setUnlockError("");
      setAppLocked(true);
    }
  }, [resetAppLockState]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined") return;
    if (typeof window.addEventListener !== "function") return;

    const preloadFonts = async () => {
      try {
        await Promise.all([
          Ionicons.loadFont(),
          MaterialCommunityIcons.loadFont(),
        ]);
      } catch (error) {
        console.warn("Icon font preload failed on web:", error);
      }
    };

    preloadFonts();

    const onUnhandledRejection = (event: any) => {
      const reasonText = String(event?.reason?.message || event?.reason || "").toLowerCase();
      const isFontTimeout =
        reasonText.includes("fontfaceobserver") ||
        reasonText.includes("6000ms timeout exceeded");

      if (isFontTimeout) {
        event?.preventDefault?.();
        console.warn("Ignored web font timeout for icon font.");
      }
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection as any);
    return () => {
      if (typeof window.removeEventListener === "function") {
        window.removeEventListener("unhandledrejection", onUnhandledRejection as any);
      }
    };
  }, []);

  const syncSessionAccess = useCallback(async (options?: { forceAppLock?: boolean }) => {
    const shouldForceHome = isPublicRoute || currentPath === "/setting";
    const evaluateAutoLock = !sessionSyncDoneRef.current || Boolean(options?.forceAppLock);

    const pairs = await AsyncStorage.multiGet([
      "role",
      "userId",
      SESSION_LAST_ACTIVE_KEY,
      "studentNodeKey",
      "studentId",
    ]);
    const session = Object.fromEntries(pairs) as Record<string, string | null>;

    if (isStudentSessionValid(session)) {
      await AsyncStorage.setItem(SESSION_LAST_ACTIVE_KEY, String(Date.now()));
      await syncAppLockState(session, {
        evaluateAutoLock,
      });

      if (shouldForceHome && !bootRedirectDoneRef.current) {
        bootRedirectDoneRef.current = true;
        router.replace("/dashboard/home");
      }

      sessionSyncDoneRef.current = true;
      return;
    }

    sessionSyncDoneRef.current = true;
    bootRedirectDoneRef.current = false;
    resetAppLockState();

    if (session.role === "student" && session.userId) {
      await AsyncStorage.multiRemove(SESSION_AUTH_KEYS);
      await AsyncStorage.setItem(SESSION_EXPIRED_NOTICE_KEY, String(Date.now()));
    }

    if (!isPublicRoute) {
      router.replace("/");
    }
  }, [currentPath, isPublicRoute, resetAppLockState, router, syncAppLockState]);

  useEffect(() => {
    syncSessionAccess().catch((error) => {
      console.warn("Session sync error:", error);
    });
  }, [syncSessionAccess]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasBackgrounded = /inactive|background/.test(appStateRef.current);

      if (/inactive|background/.test(nextState)) {
        if (appLock.enabled) {
          AsyncStorage.setItem(APP_LOCK_LAST_INACTIVE_AT_KEY, String(Date.now())).catch(() => null);
        } else {
          AsyncStorage.removeItem(APP_LOCK_LAST_INACTIVE_AT_KEY).catch(() => null);
        }
      }

      appStateRef.current = nextState;

      if (wasBackgrounded && nextState === "active") {
        syncSessionAccess({ forceAppLock: true }).catch((error) => {
          console.warn("Session resume sync error:", error);
        });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [appLock.enabled, syncSessionAccess]);

  useEffect(() => {
    if (!appLocked || unlockCode.length !== APP_LOCK_PASSCODE_LENGTH) return;

    if (unlockCode === appLock.passcode) {
      AsyncStorage.removeItem(APP_LOCK_LAST_INACTIVE_AT_KEY).catch(() => null);
      setAppLocked(false);
      setUnlockCode("");
      setUnlockError("");
      return;
    }

    const timer = setTimeout(() => {
      setUnlockCode("");
      setUnlockError("Wrong 4-digit passcode. Try again.");
    }, 120);

    return () => clearTimeout(timer);
  }, [appLock.passcode, appLocked, unlockCode]);

  const handleUnlockDigit = useCallback((digit: string) => {
    setUnlockError("");
    setUnlockCode((current) => {
      if (current.length >= APP_LOCK_PASSCODE_LENGTH) return current;
      return normalizePasscodeValue(`${current}${digit}`);
    });
  }, []);

  const handleUnlockBackspace = useCallback(() => {
    setUnlockError("");
    setUnlockCode((current) => current.slice(0, -1));
  }, []);

  const lockAppNow = useCallback(() => {
    setUnlockCode("");
    setUnlockError("");
    setAppLocked(true);
  }, []);

  return (
    <AppLockProvider value={{ appLockEnabled: appLock.enabled, lockAppNow }}>
      <ThemeProvider value={navigationTheme}>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
          <StatusBar style={statusBarStyle} backgroundColor={colors.background} />
          <GlobalNotificationToast />
          <Stack initialRouteName="index" screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
            <Stack.Screen name="setting" options={{ animation: "slide_from_right", presentation: "card" }} />
          </Stack>

          <Modal visible={appLock.enabled && appLocked} transparent animationType="fade" onRequestClose={() => null}>
            <View style={[styles.lockOverlay, { backgroundColor: colors.overlay }]}> 
              <PasscodePanel
                colors={colors}
                title="Passcode Lock"
                subtitle="Enter your 4-digit code to unlock Gojo Study."
                value={unlockCode}
                errorText={unlockError}
                onDigitPress={handleUnlockDigit}
                onBackspace={handleUnlockBackspace}
                footerNote="Tap the lock icon on the home page header to lock Gojo Study instantly on this phone."
              />
            </View>
          </Modal>
        </SafeAreaView>
      </ThemeProvider>
    </AppLockProvider>
  );
}

function GlobalNotificationToast() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();

  const [current, setCurrent] = useState<Notif | null>(null);
  const [queue, setQueue] = useState<Notif[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const slideY = useRef(new Animated.Value(-90)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(1)).current;

  const notifVisual = useCallback((type?: string) => {
    const t = String(type || "").toLowerCase();
    if (t === "new_package") return { icon: "cube-outline" as const, color: colors.primary, bg: colors.infoSurface };
    if (t === "new_round") return { icon: "layers-outline" as const, color: "#8B5CF6", bg: colors.soft };
    if (t === "round_live") return { icon: "flash-outline" as const, color: colors.warningText, bg: colors.warningSurface };
    if (t === "result_released") return { icon: "trophy-outline" as const, color: colors.success, bg: colors.successSurface };
    return { icon: "notifications-outline" as const, color: colors.primary, bg: colors.soft };
  }, [colors]);

  const parseDeepLink = useCallback((dl?: string) => {
    const deep = String(dl || "");
    if (!deep) return null;
    const [pathname, query] = deep.split("?");
    const params: Record<string, string> = {};
    if (query) {
      query.split("&").forEach((pair) => {
        const [k, v] = pair.split("=");
        if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
      });
    }
    return { pathname: pathname || "/", params };
  }, []);

  const getStudentGradeKey = useCallback(async (sid: string | null) => {
    if (!sid) return null;

    const fromStorage =
      (await AsyncStorage.getItem("studentGrade")) ||
      (await AsyncStorage.getItem("grade")) ||
      "";
    const norm = String(fromStorage).toLowerCase().replace("grade", "").trim();
    if (norm) return `grade${norm}`;

    const schoolCode = await getValue([`Platform1/schoolCodeIndex/${String(sid).slice(0, 3)}`]);
    if (!schoolCode) return null;

    const student = await getValue([`Platform1/Schools/${schoolCode}/Students/${sid}`]) || {};
    const g = String(student?.basicStudentInformation?.grade || student?.grade || "").trim();
    return g ? `grade${g}` : null;
  }, []);

  const goToNotif = useCallback(async (n: Notif) => {
    if (!n) return;

    if (n.meta?.roundId && n.meta?.examId) {
      router.push({
        pathname: "/examCenter",
        params: {
          roundId: n.meta.roundId,
          examId: n.meta.examId,
          questionBankId: n.meta.questionBankId || "",
          mode: "start",
        },
      });
      return;
    }

    const parsed = parseDeepLink(n.deepLink);
    if (parsed) router.push({ pathname: parsed.pathname as any, params: parsed.params });
  }, [parseDeepLink, router]);

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: -90, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start(() => {
      setCurrent(null);
      bar.setValue(1);
    });
  }, [bar, opacity, slideY]);

  const showNext = useCallback((n: Notif) => {
    setCurrent(n);
    slideY.setValue(-90);
    opacity.setValue(0);
    bar.setValue(1);

    Animated.parallel([
      Animated.timing(slideY, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(bar, { toValue: 0, duration: 5000, easing: Easing.linear, useNativeDriver: false }),
    ]).start(({ finished }) => {
      if (finished) hideToast();
    });
  }, [bar, hideToast, opacity, slideY]);

  useEffect(() => {
    (async () => {
      const sid =
        (await AsyncStorage.getItem("studentNodeKey")) ||
        (await AsyncStorage.getItem("studentId")) ||
        (await AsyncStorage.getItem("username")) ||
        null;
      setStudentId(sid);
    })();
  }, []);

  useEffect(() => {
    if (!studentId) return;
    let timer: any;

    async function poll() {
      const gradeKey = await getStudentGradeKey(studentId);
      if (!gradeKey) return;

      const meta = await getValue([`Platform1/usersMeta/${studentId}`, `usersMeta/${studentId}`]) || {};
      const lastSeen = Number(meta?.lastSeenNotificationsAt || 0);

      const node = await getValue([`Platform1/examNotifications`, `examNotifications`]) || {};
      const arr: Notif[] = Object.keys(node).map((id) => ({ id, ...node[id] }));

      const incoming = arr
        .filter((n) => Number(n.createdAt || 0) > lastSeen)
        .filter((n) => !!n?.grades?.[gradeKey])
        .filter((n) => !seenIdsRef.current.has(n.id))
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

      if (incoming.length) {
        incoming.forEach((n) => seenIdsRef.current.add(n.id));
        setQueue((q) => [...q, ...incoming]);
      }
    }

    poll();
    timer = setInterval(poll, 4000);
    return () => clearInterval(timer);
  }, [getStudentGradeKey, studentId]);

  useEffect(() => {
    if (!current && queue.length > 0) {
      const [first, ...rest] = queue;
      setQueue(rest);
      showNext(first);
    }
  }, [current, queue, showNext]);

  const progressWidth = useMemo(
    () => bar.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
    [bar]
  );

  if (!current) return null;
  const vis = notifVisual(current.type);

  return (
    <Animated.View style={[styles.toastWrap, { top: insets.top + 8, transform: [{ translateY: slideY }], opacity }]}>
      <TouchableOpacity
        activeOpacity={0.92}
        style={[styles.toastCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={async () => {
          const n = current;
          hideToast();
          await goToNotif(n);
        }}
      >
        <View style={styles.toastHeadRow}>
          <View style={[styles.toastIconWrap, { backgroundColor: vis.bg }]}>
            <Ionicons name={vis.icon} size={16} color={vis.color} />
          </View>
          <Text style={[styles.toastTitle, { color: colors.text }]} numberOfLines={1}>
            {current.title || "New Notification"}
          </Text>
        </View>
        {!!current.body && (
          <Text style={[styles.toastBody, { color: colors.muted }]} numberOfLines={2}>
            {current.body}
          </Text>
        )}
        <View style={[styles.toastBarTrack, { backgroundColor: colors.surfaceMuted }]}>
          <Animated.View style={[styles.toastBarFill, { width: progressWidth, backgroundColor: colors.primary }]} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  lockOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },

  toastWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 9999,
  },
  toastCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
  },
  toastHeadRow: { flexDirection: "row", alignItems: "center" },
  toastIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  toastTitle: { fontWeight: "900", flex: 1 },
  toastBody: { marginTop: 6, fontSize: 12, lineHeight: 16 },
  toastBarTrack: {
    marginTop: 8,
    height: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  toastBarFill: {
    height: 4,
    borderRadius: 999,
  },
});