import React, { useEffect, useState, useRef } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text, TouchableOpacity, View, Image, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get, onValue, off } from "firebase/database";
import { database } from "../../constants/firebaseConfig";
import { StatusBar } from "expo-status-bar";

/**
 * Dashboard layout (expo-router Tabs)
 * - Header: left "Gojo Study", right: chat icon + profile avatar
 * - Uses Platform1/Schools/{schoolKey}/Users and /Chats when schoolKey is available
 */

const PRIMARY = "#007AFB";
const WHITE = "#FFFFFF";
const MUTED = "#6B78A8";

export default function DashboardLayout() {
  const router = useRouter();
  const [profileImage, setProfileImage] = useState(null);
  const [totalUnread, setTotalUnread] = useState(0);
  const chatsCleanupRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    let chatsRefPath = null;
    let listenerCallback = null;

    (async () => {
      try {
        const userNodeKey = await AsyncStorage.getItem("userNodeKey");
        const userId = await AsyncStorage.getItem("userId");
        const schoolKey = await AsyncStorage.getItem("schoolKey"); // saved at login

        // Resolve profile image path using schoolKey if available
        try {
          if (userNodeKey) {
            const userPath = schoolKey
              ? `Platform1/Schools/${schoolKey}/Users/${userNodeKey}`
              : `Users/${userNodeKey}`;
            const snap = await get(ref(database, userPath));
            if (mounted && snap.exists()) {
              setProfileImage(snap.val().profileImage || null);
            }
          }
        } catch (err) {
          console.warn("Failed to fetch user profile (dashboard layout):", err);
        }

        // If no userId we cannot compute unread; bail out
        if (!userId) return;

        // Choose chats path depending on schoolKey
        chatsRefPath = schoolKey ? `Platform1/Schools/${schoolKey}/Chats` : "Chats";
        const chatsRef = ref(database, chatsRefPath);

        // subscribe
        listenerCallback = (snap) => {
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

        onValue(chatsRef, listenerCallback);
        // store cleanup
        chatsCleanupRef.current = () => {
          try {
            off(chatsRef, "value", listenerCallback);
          } catch (e) {
            // best-effort
            try { off(chatsRef); } catch {}
          }
        };
      } catch (err) {
        console.warn("Dashboard layout initialization error:", err);
      }
    })();

    return () => {
      mounted = false;
      if (chatsCleanupRef.current) {
        try { chatsCleanupRef.current(); } catch (e) {}
        chatsCleanupRef.current = null;
      }
    };
  }, []);

  const HeaderLeft = () => <Text style={styles.titleText}>Gojo Study</Text>;

  const HeaderRight = () => (
    <View style={styles.headerRightRow}>
      <TouchableOpacity
        style={styles.iconButton}
        onPress={() => {
          router.push("/chats");
        }}
      >
        <Ionicons name="chatbubble-outline" size={22} color="#222" />
        {totalUnread > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{totalUnread > 99 ? "99+" : totalUnread}</Text>
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.push("/dashboard/profile")} style={{ marginLeft: 12 }}>
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
          headerTitleAlign: "left",
          headerTitle: () => <HeaderLeft />,
          headerRight: () => <HeaderRight />,
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
            tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
          }}
        />

        <Tabs.Screen
          name="book"
          options={{
            title: "Books",
            tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" size={size} color={color} />,
          }}
        />

        <Tabs.Screen
          name="exam"
          options={{
            title: "Exams",
            tabBarIcon: ({ color, size }) => <Ionicons name="clipboard-outline" size={size} color={color} />,
          }}
        />

        <Tabs.Screen
          name="classMark"
          options={{
            title: "Class Mark",
            tabBarIcon: ({ color, size }) => <Ionicons name="reader-outline" size={size} color={color} />,
          }}
        />
      </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  titleText: { fontSize: 20, color: "#222", fontWeight: "700", marginLeft: 8 },
  headerRightRow: { flexDirection: "row", alignItems: "center", marginRight: 12 },
  profileImage: { width: 38, height: 38, borderRadius: 19, borderWidth: 0.5, borderColor: "#EFEFF4", backgroundColor: "#F6F8FF" },
  iconButton: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", position: "relative" },
  unreadBadge: { position: "absolute", right: -6, top: -6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#FF3B30", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  unreadText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});