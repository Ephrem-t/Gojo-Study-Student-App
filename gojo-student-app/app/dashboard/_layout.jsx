import React, { useEffect, useMemo, useRef, useState } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text, TouchableOpacity, View, Image, StyleSheet, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get, onValue, off, query, orderByChild, equalTo } from "firebase/database";
import { database } from "../../constants/firebaseConfig";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../../hooks/use-app-theme";
import { extractProfileImage, normalizeProfileImageUri } from "../lib/profileImage";

export default function DashboardLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, statusBarStyle } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [profileImage, setProfileImage] = useState(null);
  const [totalUnread, setTotalUnread] = useState(0);
  const chatsCleanupRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const userNodeKey = await AsyncStorage.getItem("userNodeKey");
        const studentNodeKey = await AsyncStorage.getItem("studentNodeKey");
        const userId = await AsyncStorage.getItem("userId");
        const username = await AsyncStorage.getItem("username");
        const studentId = await AsyncStorage.getItem("studentId");
        const storedSchoolKey = await AsyncStorage.getItem("schoolKey");

        const resolveSchoolKey = async () => {
          if (storedSchoolKey) return storedSchoolKey;

          const candidates = [username, studentId, userId, userNodeKey, studentNodeKey]
            .filter(Boolean)
            .map((v) => String(v).trim().toUpperCase())
            .filter((v) => v.length >= 3);

          for (const candidate of candidates) {
            const prefix = candidate.slice(0, 3);
            try {
              const codeSnap = await get(ref(database, `Platform1/schoolCodeIndex/${prefix}`));
              const code = codeSnap?.exists() ? codeSnap.val() : null;
              if (code) {
                try {
                  await AsyncStorage.setItem("schoolKey", String(code));
                } catch {}
                return String(code);
              }
            } catch {}
          }

          return null;
        };

        const schoolKey = await resolveSchoolKey();

        const uniqueVals = Array.from(
          new Set([userNodeKey, studentNodeKey, userId, username, studentId].filter(Boolean))
        );

        const tryDirectUser = async (key, useSchoolScope) => {
          if (!key) return null;
          const path = useSchoolScope && schoolKey
            ? `Platform1/Schools/${schoolKey}/Users/${key}`
            : `Users/${key}`;
          const snap = await get(ref(database, path));
          if (!snap.exists()) return null;
          return extractProfileImage(snap.val());
        };

        const tryCollectionByField = async (collectionPath, field, value) => {
          if (!value) return null;
          const q = query(ref(database, collectionPath), orderByChild(field), equalTo(value));
          const snap = await get(q);
          if (!snap.exists()) return null;
          let found = null;
          snap.forEach((child) => {
            found = extractProfileImage(child.val());
            return true;
          });
          return found;
        };

        const tryDirectStudent = async (key, useSchoolScope) => {
          if (!key) return null;
          const path = useSchoolScope && schoolKey
            ? `Platform1/Schools/${schoolKey}/Students/${key}`
            : `Students/${key}`;
          const snap = await get(ref(database, path));
          if (!snap.exists()) return null;
          return extractProfileImage(snap.val());
        };

        const tryStudentCollectionByField = async (collectionPath, field, value) => {
          if (!value) return null;
          const q = query(ref(database, collectionPath), orderByChild(field), equalTo(value));
          const snap = await get(q);
          if (!snap.exists()) return null;
          let found = null;
          snap.forEach((child) => {
            found = extractProfileImage(child.val());
            return true;
          });
          return found;
        };

        let resolvedProfileImage = null;

        // 1) Fast path: direct node lookups from possible keys.
        for (const key of uniqueVals) {
          resolvedProfileImage = await tryDirectUser(key, true);
          if (resolvedProfileImage) break;
          resolvedProfileImage = await tryDirectUser(key, false);
          if (resolvedProfileImage) break;

          // Some accounts store avatar under Students rather than Users.
          resolvedProfileImage = await tryDirectStudent(key, true);
          if (resolvedProfileImage) break;
          resolvedProfileImage = await tryDirectStudent(key, false);
          if (resolvedProfileImage) break;
        }

        // 2) Fallback: query Users collections by common identifier fields.
        if (!resolvedProfileImage) {
          const collections = schoolKey
            ? [`Platform1/Schools/${schoolKey}/Users`, "Users"]
            : ["Users"];
          const fields = ["userId", "username", "studentId"];

          for (const col of collections) {
            for (const val of uniqueVals) {
              for (const field of fields) {
                resolvedProfileImage = await tryCollectionByField(col, field, val);
                if (resolvedProfileImage) break;
              }
              if (resolvedProfileImage) break;
            }
            if (resolvedProfileImage) break;
          }
        }

        // 3) Final fallback: query Students collections by identity fields.
        if (!resolvedProfileImage) {
          const studentCollections = schoolKey
            ? [`Platform1/Schools/${schoolKey}/Students`, "Students"]
            : ["Students"];
          const studentFields = [
            "studentId",
            "userId",
            "username",
            "systemAccountInformation/username",
            "name",
          ];

          for (const col of studentCollections) {
            for (const val of uniqueVals) {
              for (const field of studentFields) {
                resolvedProfileImage = await tryStudentCollectionByField(col, field, val);
                if (resolvedProfileImage) break;
              }
              if (resolvedProfileImage) break;
            }
            if (resolvedProfileImage) break;
          }
        }

        if (mounted) setProfileImage(resolvedProfileImage || null);

        if (!userId) return;

        const chatsRefPath = schoolKey
          ? `Platform1/Schools/${schoolKey}/Chats`
          : "Chats";

        const chatsRef = ref(database, chatsRefPath);

        const listener = (snap) => {
          if (!snap.exists()) {
            setTotalUnread(0);
            return;
          }

          let total = 0;
          snap.forEach((chatSnap) => {
            const unreadNode = chatSnap.child("unread");
            if (unreadNode.exists()) {
              const val = unreadNode.child(userId).val();
              if (typeof val === "number") total += val;
            }
          });

          setTotalUnread(total);
        };

        onValue(chatsRef, listener);
        chatsCleanupRef.current = () => {
          try {
            off(chatsRef, "value", listener);
          } catch {
            try {
              off(chatsRef);
            } catch {}
          }
        };
      } catch (err) {
        console.warn("Dashboard layout init error:", err);
      }
    })();

    return () => {
      mounted = false;
      if (chatsCleanupRef.current) {
        try {
          chatsCleanupRef.current();
        } catch {}
        chatsCleanupRef.current = null;
      }
    };
  }, []);

  const HomeHeaderTitle = () => (
    <Text style={styles.titleText}>Gojo Study</Text>
  );

  const HomeHeaderLeft = () => (
    <TouchableOpacity style={styles.iconButton} onPress={() => router.push("/chats")}>
      <View style={styles.chatIconWrap}>
        <Ionicons name="paper-plane-outline" size={21} color={colors.text} />
        {totalUnread > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>
              {totalUnread > 99 ? "99+" : totalUnread}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  const HomeHeaderRight = () => (
    <View style={styles.headerRightRow}>
      <TouchableOpacity onPress={() => router.push("../profiles")}> 
        <Image
          source={
            normalizeProfileImageUri(profileImage, { allowBlob: Platform.OS === "web" })
              ? { uri: normalizeProfileImageUri(profileImage, { allowBlob: Platform.OS === "web" }) }
              : require("../../assets/images/avatar_placeholder.png")
          }
          style={styles.profileImage}
        />
      </TouchableOpacity>
    </View>
  );

  const ExamTabIcon = ({ color, size }) => (
    <View style={styles.examTabIconWrap}>
      <Ionicons name="document-text-outline" size={size} color={color} />
      <Text style={[styles.examTabBadge, { color }]}>A+</Text>
    </View>
  );

  const BooksTabIcon = ({ color, size }) => (
    <View style={styles.booksTabIconWrap}>
      <Ionicons name="library-outline" size={size} color={color} />
      <Text style={[styles.booksTabBadge, { color }]}>BK</Text>
    </View>
  );

  const ClassMarkTabIcon = ({ color, size }) => (
    <View style={styles.classMarkTabIconWrap}>
      <Ionicons name="podium-outline" size={size} color={color} />
      <Text style={[styles.classMarkTabBadge, { color }]}>MK</Text>
    </View>
  );

  return (
    <>
      <StatusBar style={statusBarStyle} backgroundColor={colors.tabBar} translucent={false} />
      <Tabs
        initialRouteName="home"
        screenOptions={{
          headerStyle: { backgroundColor: colors.tabBar },
          headerShadowVisible: false,
          headerTitleAlign: "left",
          tabBarShowLabel: true,
          tabBarLabelPosition: "below-icon",
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.tabInactive,
          headerTintColor: colors.text,
          tabBarStyle: {
            height: 52 + Math.max(insets.bottom, 0),
            backgroundColor: colors.tabBar,
            borderTopColor: colors.border,
            paddingTop: 2,
            paddingBottom: Math.max(insets.bottom, 0),
          },
          sceneStyle: { backgroundColor: colors.background },
          tabBarItemStyle: { paddingVertical: 1 },
          tabBarIconStyle: { marginBottom: 1 },
          tabBarLabelStyle: { fontSize: 12, fontWeight: "600", lineHeight: 14 },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: "Home",
            headerLeft: () => <HomeHeaderRight />,
            headerTitle: () => <HomeHeaderTitle />,
            headerRight: () => <HomeHeaderLeft />,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" size={size} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="book"
          options={{
            title: "Books",
            tabBarLabel: "Book",
            headerTitle: "Book Library",
            headerRight: () => null,
            tabBarIcon: ({ color, size }) => <BooksTabIcon color={color} size={size} />,
          }}
        />

        <Tabs.Screen
          name="exam"
          options={{
            title: "Exams",
            tabBarLabel: "Exam",
            headerTitle: "Exams",
            headerRight: () => null,
            tabBarIcon: ({ color, size }) => <ExamTabIcon color={color} size={size} />,
          }}
        />

        <Tabs.Screen
          name="classMark"
          options={{
            title: "Class Mark",
            tabBarLabel: "Class Mark",
            headerTitle: "Class Mark",
            headerRight: () => null,
            tabBarIcon: ({ color, size }) => <ClassMarkTabIcon color={color} size={size} />,
          }}
        />
      </Tabs>
    </>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
  titleText: {
    fontSize: 20,
    color: colors.text,
    fontWeight: "700",
    marginLeft: 8,
  },

  headerRightRow: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 12,
  },

  profileImage: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 0.5,
    borderColor: colors.border,
    backgroundColor: colors.soft,
  },

  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  chatIconWrap: {
    width: 24,
    height: 24,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },

  examTabIconWrap: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },

  booksTabIconWrap: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },

  booksTabBadge: {
    position: "absolute",
    right: -7,
    bottom: 1,
    fontSize: 7,
    fontWeight: "800",
    lineHeight: 8,
    backgroundColor: colors.tabBar,
    paddingHorizontal: 2,
    borderRadius: 4,
    overflow: "hidden",
  },

  examTabBadge: {
    position: "absolute",
    right: -6,
    bottom: 1,
    fontSize: 9,
    fontWeight: "800",
    lineHeight: 10,
    backgroundColor: colors.tabBar,
    paddingHorizontal: 2,
    borderRadius: 4,
    overflow: "hidden",
  },

  classMarkTabIconWrap: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },

  classMarkTabBadge: {
    position: "absolute",
    right: -7,
    bottom: 1,
    fontSize: 7,
    fontWeight: "800",
    lineHeight: 8,
    backgroundColor: colors.tabBar,
    paddingHorizontal: 2,
    borderRadius: 4,
    overflow: "hidden",
  },

  unreadBadge: {
    position: "absolute",
    right: -10,
    top: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#FF3B30",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: colors.tabBar,
    zIndex: 20,
    elevation: 20,
  },

  unreadText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: "700",
  },
});
}