import React, { useEffect, useState, useRef } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text, TouchableOpacity, View, Image, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get, onValue, off, query, orderByChild, equalTo } from "firebase/database";
import { database } from "../../constants/firebaseConfig";
import { StatusBar } from "expo-status-bar";

const PRIMARY = "#007AFB";
const WHITE = "#FFFFFF";

function isValidProfileUri(value) {
  if (!value || typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;
  return /^(https?:\/\/|file:\/\/|data:image\/)/i.test(v);
}

export default function DashboardLayout() {
  const router = useRouter();
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
        const schoolKey = await AsyncStorage.getItem("schoolKey");

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
          return snap.val()?.profileImage || null;
        };

        const tryCollectionByField = async (collectionPath, field, value) => {
          if (!value) return null;
          const q = query(ref(database, collectionPath), orderByChild(field), equalTo(value));
          const snap = await get(q);
          if (!snap.exists()) return null;
          let found = null;
          snap.forEach((child) => {
            found = child.val()?.profileImage || null;
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
          return snap.val()?.profileImage || null;
        };

        const tryStudentCollectionByField = async (collectionPath, field, value) => {
          if (!value) return null;
          const q = query(ref(database, collectionPath), orderByChild(field), equalTo(value));
          const snap = await get(q);
          if (!snap.exists()) return null;
          let found = null;
          snap.forEach((child) => {
            found = child.val()?.profileImage || null;
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
          const studentFields = ["studentId", "userId", "name"];

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
        <Ionicons name="paper-plane-outline" size={21} color="#222" />
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
            isValidProfileUri(profileImage)
              ? { uri: profileImage }
              : require("../../assets/images/avatar_placeholder.png")
          }
          style={styles.profileImage}
        />
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <StatusBar style="dark" backgroundColor={WHITE} translucent={false} />
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: WHITE },
          headerShadowVisible: false,
          headerTitleAlign: "left",
          tabBarActiveTintColor: PRIMARY,
          tabBarInactiveTintColor: "#BFD9FF",
          tabBarStyle: { height: 62, backgroundColor: WHITE },
          tabBarLabelStyle: { fontSize: 12 },
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
            headerTitle: "Book Library",
            headerRight: () => null,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="book-outline" size={size} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="exam"
          options={{
            title: "Exams",
            headerTitle: "Exams",
            headerRight: () => null,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="clipboard-outline" size={size} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="classMark"
          options={{
            title: "Class Mark",
            headerTitle: "Class Mark",
            headerRight: () => null,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="reader-outline" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  titleText: {
    fontSize: 20,
    color: "#222",
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
    borderColor: "#EFEFF4",
    backgroundColor: "#F6F8FF",
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
    borderColor: "#fff",
    zIndex: 20,
    elevation: 20,
  },

  unreadText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
});