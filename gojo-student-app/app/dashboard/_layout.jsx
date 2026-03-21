import React, { useEffect, useState, useRef } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text, TouchableOpacity, View, Image, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get, onValue, off } from "firebase/database";
import { database } from "../../constants/firebaseConfig";
import { StatusBar } from "expo-status-bar";

const PRIMARY = "#007AFB";
const WHITE = "#FFFFFF";

export default function DashboardLayout() {
  const router = useRouter();
  const [profileImage, setProfileImage] = useState(null);
  const [totalUnread, setTotalUnread] = useState(0);
  const chatsCleanupRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const userNodeKey =
          (await AsyncStorage.getItem("userNodeKey")) ||
          (await AsyncStorage.getItem("userId")) ||
          null;

        const userId = await AsyncStorage.getItem("userId");
        const schoolKey = await AsyncStorage.getItem("schoolKey");

        if (userNodeKey) {
          const userPath = schoolKey
            ? `Platform1/Schools/${schoolKey}/Users/${userNodeKey}`
            : `Users/${userNodeKey}`;

          const snap = await get(ref(database, userPath));
          if (mounted && snap.exists()) {
            setProfileImage(snap.val()?.profileImage || null);
          }
        }

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

  const HomeHeaderRight = () => (
    <View style={styles.headerRightRow}>
      <TouchableOpacity style={styles.iconButton} onPress={() => router.push("/chats")}>
        <View style={styles.chatIconWrap}>
          <Ionicons name="chatbubbles-outline" size={22} color="#222" />
          {totalUnread > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>
                {totalUnread > 99 ? "99+" : totalUnread}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.push("../profile")} style={{ marginLeft: 12 }}>
        <Image
          source={
            profileImage
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
            headerTitle: () => <HomeHeaderTitle />,
            headerRight: () => <HomeHeaderRight />,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" size={size} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="book"
          options={{
            title: "Books",
            headerTitle: "Books",
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