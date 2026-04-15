import React, { useEffect, useMemo, useRef, useState } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text, TouchableOpacity, View, Image, StyleSheet, Platform } from "react-native";
import * as NavigationBar from "expo-navigation-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get, onValue, off, query, orderByChild, equalTo } from "firebase/database";
import { database } from "../../constants/firebaseConfig";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../../hooks/use-app-theme";
import { useAppLock } from "../../hooks/use-app-lock";
import { extractProfileImage, normalizeProfileImageUri } from "../lib/profileImage";

export default function DashboardLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, statusBarStyle } = useAppTheme();
  const { appLockEnabled, lockAppNow } = useAppLock();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [profileImage, setProfileImage] = useState(null);
  const [totalUnread, setTotalUnread] = useState(0);
  const chatsCleanupRef = useRef(null);

  useEffect(() => {
    if (Platform.OS !== "android") return undefined;

    const buttonStyle = statusBarStyle === "light" ? "light" : "dark";

    (async () => {
      try {
        await NavigationBar.setPositionAsync("absolute");
        await NavigationBar.setBackgroundColorAsync("#00000000");
        await NavigationBar.setBorderColorAsync("#00000000");
        await NavigationBar.setButtonStyleAsync(buttonStyle);
      } catch (error) {
        console.warn("Navigation bar style error:", error);
      }
    })();

    return () => {
      (async () => {
        try {
          await NavigationBar.setBackgroundColorAsync(colors.tabBar);
          await NavigationBar.setBorderColorAsync(colors.border);
          await NavigationBar.setPositionAsync("relative");
          await NavigationBar.setButtonStyleAsync(buttonStyle);
        } catch {}
      })();
    };
  }, [colors.border, colors.tabBar, statusBarStyle]);

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
    <View style={styles.titleRow}>
      <Text style={styles.titleText}>Gojo</Text>
      <Text style={styles.titleAccent}>Study</Text>
    </View>
  );

  const HomeHeaderLeft = () => (
    <View style={styles.headerRightRow}>
      {appLockEnabled ? (
        <TouchableOpacity style={[styles.iconButton, styles.homeHeaderLockButton]} onPress={lockAppNow}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.text} />
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity style={styles.iconButton} onPress={() => router.push("/chats")}>
        <View style={styles.chatIconWrap}>
          <Ionicons name="paper-plane-outline" size={19} color={colors.text} />
          {totalUnread > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>
                {totalUnread > 99 ? "99+" : totalUnread}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );

  const ExamTabIcon = ({ color, size }) => (
    <View style={[styles.tabIconShell, styles.examTabIconWrap]}>
      <Ionicons name="document-text-outline" size={size - 1} color={color} />
      <Text style={[styles.examTabMark, { color }]}>A+</Text>
    </View>
  );

  const BooksTabIcon = ({ color, size }) => (
    <View style={[styles.tabIconShell, styles.booksTabIconWrap]}>
      <Ionicons name="library-outline" size={size - 1} color={color} />
    </View>
  );

  const ClassMarkTabIcon = ({ color, size }) => (
    <View style={[styles.tabIconShell, styles.classMarkTabIconWrap]}>
      <Ionicons name="stats-chart-outline" size={size - 1} color={color} />
    </View>
  );

  const HomeTabIcon = ({ color, focused }) => (
    <Ionicons name={focused ? "home" : "home-outline"} size={24} color={color} />
  );

  const ProfileTabIcon = ({ color, size, focused }) => {
    const normalizedUri = normalizeProfileImageUri(profileImage, { allowBlob: Platform.OS === "web" });

    if (normalizedUri) {
      return (
        <Image
          source={{ uri: normalizedUri }}
          style={[
            styles.tabProfileImage,
            focused && { borderColor: color, transform: [{ scale: 1.06 }] },
          ]}
        />
      );
    }

    return <Ionicons name={focused ? "person-circle" : "person-circle-outline"} size={size + 2} color={color} />;
  };

  const DashboardTabBar = ({ state, descriptors, navigation }) => {
    return (
      <View pointerEvents="box-none" style={styles.telegramTabBarRoot}>
        <View
          style={[
            styles.telegramBarSurface,
            { bottom: Math.max(insets.bottom, 6) },
          ]}
        >
          <View pointerEvents="none" style={styles.telegramBarTopEdge} />
          {state.routes.map((route, index) => {
            const descriptor = descriptors[route.key];
            const options = descriptor.options || {};
            const focused = state.index === index;
            const color = focused ? colors.primary : colors.tabInactive;
            const label = typeof options.tabBarLabel === "string"
              ? options.tabBarLabel
              : typeof options.title === "string"
                ? options.title
                : route.name;

            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });

              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            };

            const onLongPress = () => {
              navigation.emit({
                type: "tabLongPress",
                target: route.key,
              });
            };

            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={focused ? { selected: true } : {}}
                activeOpacity={0.88}
                onPress={onPress}
                onLongPress={onLongPress}
                style={[
                  styles.telegramTabItem,
                  focused && styles.telegramTabItemActive,
                  route.name === "home" && styles.telegramHomeTabItem,
                ]}
              >
                <View style={styles.telegramTabIconWrap}>
                  {typeof options.tabBarIcon === "function"
                    ? options.tabBarIcon({ focused, color, size: 24 })
                    : null}
                </View>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.telegramTabLabel,
                    { color },
                    focused && styles.telegramTabLabelActive,
                    route.name === "home" && styles.telegramHomeTabLabel,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <>
      <StatusBar style={statusBarStyle} backgroundColor={colors.tabBar} translucent={false} />
      <Tabs
        initialRouteName="home"
        tabBar={(props) => <DashboardTabBar {...props} />}
        screenOptions={{
          headerStyle: { backgroundColor: colors.tabBar },
          headerShadowVisible: false,
          headerTitleAlign: "left",
          headerTintColor: colors.text,
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
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
            headerShown: false,
            tabBarIcon: ({ color, size }) => <ExamTabIcon color={color} size={size} />,
          }}
        />

        <Tabs.Screen
          name="home"
          options={{
            title: "Home",
            headerTitle: () => <HomeHeaderTitle />,
            headerRight: () => <HomeHeaderLeft />,
            tabBarIcon: ({ color, focused }) => <HomeTabIcon color={color} focused={focused} />,
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

        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            headerShown: false,
            tabBarIcon: ({ color, size, focused }) => <ProfileTabIcon color={color} size={size} focused={focused} />,
          }}
        />
      </Tabs>
    </>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginLeft: 8,
  },

  titleText: {
    fontSize: 22,
    color: colors.text,
    fontWeight: "800",
    letterSpacing: -0.3,
  },

  titleAccent: {
    fontSize: 22,
    color: colors.primary,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginLeft: 4,
  },

  telegramTabBarRoot: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
  },

  telegramBarSurface: {
    position: "absolute",
    left: 10,
    right: 10,
    height: 58,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    backgroundColor: colors.tabGlass,
    borderWidth: 1,
    borderColor: colors.tabGlassBorder,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.045,
    shadowRadius: 8,
    elevation: 2,
  },

  telegramBarTopEdge: {
    position: "absolute",
    left: 1,
    right: 1,
    top: 1,
    height: 1,
    borderRadius: 999,
    backgroundColor: colors.tabGlassHighlight,
  },

  telegramTabItem: {
    flex: 1,
    height: 46,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 4,
    paddingBottom: 4,
  },

  telegramHomeTabItem: {
    marginHorizontal: 2,
  },

  telegramTabItemActive: {
    backgroundColor: colors.tabGlassActive,
  },

  telegramTabIconWrap: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 26,
  },

  telegramTabLabel: {
    marginTop: 1,
    fontSize: 10.5,
    fontWeight: "600",
    lineHeight: 12,
  },

  telegramHomeTabLabel: {
    fontWeight: "700",
  },

  telegramTabLabelActive: {
    fontWeight: "800",
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

  tabIconShell: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },

  tabProfileImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "transparent",
    backgroundColor: colors.soft,
  },

  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  homeHeaderLockButton: {
    marginRight: 8,
  },

  chatIconWrap: {
    width: 22,
    height: 22,
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

  examTabMark: {
    position: "absolute",
    top: 9,
    alignSelf: "center",
    fontSize: 8,
    fontWeight: "800",
    lineHeight: 9,
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
    backgroundColor: colors.danger,
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