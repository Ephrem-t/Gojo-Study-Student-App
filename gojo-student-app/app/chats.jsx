import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  StatusBar,
  ScrollView,
  RefreshControl,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get } from "../lib/offlineDatabase";
import { database } from "../constants/firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { setOpenedChat } from "./lib/chatStore";
import { useFocusEffect } from "@react-navigation/native";
import { getUserVal } from "./lib/userHelpers";
import { useAppTheme } from "../hooks/use-app-theme";
import useUserProfileCard from "../hooks/use-user-profile-card";
import { extractProfileImage, normalizeProfileImageUri } from "./lib/profileImage";
import { persistChatsCache, readChatsCache, readChatsCacheFetchedAt } from "../lib/chatCache";
import PageLoadingSkeleton from "../components/ui/page-loading-skeleton";

const AVATAR_PLACEHOLDER = require("../assets/images/avatar_placeholder.png");

const FILTERS = ["Parents", "Teachers", "Management", "Support"];
const debounceWindowMs = 60 * 1000;

function shortText(s, n = 60) {
  if (!s && s !== 0) return "";
  const t = String(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}
function fmtTime12(ts) {
  if (!ts) return "";
  try {
    const d = new Date(Number(ts));
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, "0");
    const ampmProper = d.getHours() >= 12 ? "PM" : "AM";
    h = d.getHours() % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampmProper}`;
  } catch {
    return "";
  }
}

export default function ChatsScreen() {
  const router = useRouter();
  const { colors, statusBarStyle } = useAppTheme();
  const MUTED = colors.muted;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { openUserProfile, profileCardModal } = useUserProfileCard();

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState(FILTERS[0]);
  const [contacts, setContacts] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const cacheRef = useRef({
    studentNodeKey: null,
    teacherIdsForStudent: null,
    teacherNodeKeys: null,
  });
  const lastFetchedAtRef = useRef(0);

  async function getDbRef(subPath) {
    const sk = (await AsyncStorage.getItem("schoolKey")) || null;
    if (sk) return ref(database, `Platform1/Schools/${sk}/${subPath}`);
    return ref(database, subPath);
  }

  const resolveCurrentUserId = useCallback(async () => {
    let uId = await AsyncStorage.getItem("userId");
    if (uId) return uId;

    const nodeKey =
      (await AsyncStorage.getItem("userNodeKey")) ||
      (await AsyncStorage.getItem("studentNodeKey")) ||
      (await AsyncStorage.getItem("studentId")) ||
      null;
    if (!nodeKey) return null;

    try {
      const u = await getUserVal(nodeKey);
      if (u) return u.userId || nodeKey;
    } catch {}
    return nodeKey;
  }, []);

  const loadCacheAndShow = async () => {
    try {
      const parsed = await readChatsCache();
      if (Array.isArray(parsed) && parsed.length > 0) {
        setContacts(parsed);
        setLoadingInitial(false);
        const fetchedAt = await readChatsCacheFetchedAt();
        lastFetchedAtRef.current = fetchedAt;
        return true;
      }
    } catch {}
    return false;
  };

  const loadData = useCallback(async ({ background = false } = {}) => {
    if (!background) setLoadingInitial(true);
    try {
      const studentNodeKey =
        (await AsyncStorage.getItem("studentNodeKey")) ||
        (await AsyncStorage.getItem("studentId")) ||
        null;

      const resolvedUserId = await resolveCurrentUserId();
      setCurrentUserId(resolvedUserId || null);

      let studentGrade = null;
      let studentSection = null;
      let studentParentsMap = {};
      try {
        if (studentNodeKey) {
          const snap = await get(await getDbRef(`Students/${studentNodeKey}`));
          if (snap.exists()) {
            const s = snap.val() || {};
            studentGrade = s?.grade ? String(s.grade) : null;
            studentSection = s?.section ? String(s.section) : null;
            studentParentsMap = s?.parents || s?.parentGuardianInformation?.parents || {};
          }
        }
      } catch (e) {
        console.warn("students fetch failed", e);
      }

      // teachers from grade/section course assignment
      if (cacheRef.current.studentNodeKey !== studentNodeKey || !cacheRef.current.teacherIdsForStudent) {
        const courseKeys = new Set();
        try {
          const coursesSnap = await get(await getDbRef("Courses"));
          if (coursesSnap.exists() && studentGrade && studentSection) {
            coursesSnap.forEach((c) => {
              const val = c.val();
              const key = c.key;
              if (String(val?.grade ?? "") === String(studentGrade) && String(val?.section ?? "") === String(studentSection)) {
                courseKeys.add(key);
              }
            });
          }
        } catch {}

        const teacherIdsForStudent = new Set();
        try {
          const taSnap = await get(await getDbRef("TeacherAssignments"));
          if (taSnap.exists() && courseKeys.size > 0) {
            taSnap.forEach((child) => {
              const val = child.val();
              if (val?.courseId && courseKeys.has(val.courseId) && val?.teacherId) {
                teacherIdsForStudent.add(val.teacherId);
              }
            });
          }
        } catch {}

        const teacherNodeKeyMap = {};
        try {
          const teachersSnap = await get(await getDbRef("Teachers"));
          if (teachersSnap.exists()) {
            teachersSnap.forEach((child) => {
              const v = child.val();
              const teacherId = v?.teacherId;
              const userNode = v?.userId;
              if (teacherId && userNode) teacherNodeKeyMap[teacherId] = userNode;
            });
          }
        } catch {}

        cacheRef.current.studentNodeKey = studentNodeKey;
        cacheRef.current.teacherIdsForStudent = teacherIdsForStudent;
        cacheRef.current.teacherNodeKeys = teacherNodeKeyMap;
      }

      const teacherUserNodeKeys = new Set();
      for (const tid of Array.from(cacheRef.current.teacherIdsForStudent || [])) {
        const nodek = cacheRef.current.teacherNodeKeys?.[tid];
        if (nodek) teacherUserNodeKeys.add(nodek);
      }

      // parents linked to student
      const parentUserNodeKeys = new Set();
      try {
        if (studentParentsMap && typeof studentParentsMap === "object") {
          Object.keys(studentParentsMap).forEach((pid) => {
            const p = studentParentsMap[pid];
            if (p?.userId) parentUserNodeKeys.add(String(p.userId));
          });
        }
      } catch {}

      // management sources: School_Admins + Registerers + Finances (NO HR)
      const managementMap = new Map(); // userId -> role label
      const supportMap = new Map(); // userId -> role label

      try {
        const saSnap = await get(await getDbRef("School_Admins"));
        if (saSnap.exists()) {
          saSnap.forEach((child) => {
            const v = child.val();
            if (v?.userId) managementMap.set(String(v.userId), "Management");
          });
        }
      } catch {}

      try {
        const regSnap = await get(await getDbRef("Registerers"));
        if (regSnap.exists()) {
          regSnap.forEach((child) => {
            const v = child.val();
            if (v?.userId) managementMap.set(String(v.userId), "Registerer");
          });
        }
      } catch {}

      try {
        const finSnap = await get(await getDbRef("Finances"));
        if (finSnap.exists()) {
          finSnap.forEach((child) => {
            const v = child.val();
            if (v?.userId) managementMap.set(String(v.userId), "Finance");
          });
        }
      } catch {}

      try {
        const supportSnap = await get(await getDbRef("Support"));
        if (supportSnap.exists()) {
          supportSnap.forEach((child) => {
            const v = child.val();
            if (v?.userId) supportMap.set(String(v.userId), "Support");
          });
        }
      } catch {}

      try {
        const supportsSnap = await get(await getDbRef("Supports"));
        if (supportsSnap.exists()) {
          supportsSnap.forEach((child) => {
            const v = child.val();
            if (v?.userId) supportMap.set(String(v.userId), "Support");
          });
        }
      } catch {}

      const userNodeKeysToLoad = new Set([
        ...Array.from(teacherUserNodeKeys),
        ...Array.from(parentUserNodeKeys),
        ...Array.from(managementMap.keys()),
        ...Array.from(supportMap.keys()),
      ]);

      const userProfiles = {};
      await Promise.all(
        Array.from(userNodeKeysToLoad).map(async (k) => {
          try {
            const val = await getUserVal(k);
            if (val) userProfiles[k] = val;
          } catch {}
        })
      );

      // build contacts map
      const contactsMap = new Map();

      for (const nodeK of Array.from(teacherUserNodeKeys)) {
        const p = userProfiles[nodeK] || null;
        contactsMap.set(nodeK, {
          key: nodeK,
          userId: p?.userId || nodeK,
          name: p?.name || p?.username || "Teacher",
          role: "Teacher",
          profileImage: extractProfileImage(p),
          type: "teacher",
          chatId: null,
          lastMessage: null,
          lastTime: null,
          lastSenderId: null,
          lastSeen: false,
          unread: 0,
        });
      }

      for (const nodeK of Array.from(parentUserNodeKeys)) {
        const p = userProfiles[nodeK] || null;
        if (!p) continue;
        contactsMap.set(nodeK, {
          key: nodeK,
          userId: p?.userId || nodeK,
          name: p?.name || p?.username || "Parent",
          role: "Parent",
          profileImage: extractProfileImage(p),
          type: "parent",
          chatId: null,
          lastMessage: null,
          lastTime: null,
          lastSenderId: null,
          lastSeen: false,
          unread: 0,
        });
      }

      for (const nodeK of Array.from(managementMap.keys())) {
        if (contactsMap.has(nodeK)) continue;
        const p = userProfiles[nodeK] || null;
        const roleLabel = managementMap.get(nodeK) || "Management";

        contactsMap.set(nodeK, {
          key: nodeK,
          userId: p?.userId || nodeK,
          name: p?.name || p?.username || roleLabel,
          role: roleLabel, // Registerer / Finance / Management
          profileImage: extractProfileImage(p),
          type: "management",
          chatId: null,
          lastMessage: null,
          lastTime: null,
          lastSenderId: null,
          lastSeen: false,
          unread: 0,
        });
      }

      for (const nodeK of Array.from(supportMap.keys())) {
        if (contactsMap.has(nodeK)) continue;
        const p = userProfiles[nodeK] || null;
        const roleLabel = supportMap.get(nodeK) || "Support";

        contactsMap.set(nodeK, {
          key: nodeK,
          userId: p?.userId || nodeK,
          name: p?.name || p?.username || roleLabel,
          role: roleLabel,
          profileImage: extractProfileImage(p),
          type: "support",
          chatId: null,
          lastMessage: null,
          lastTime: null,
          lastSenderId: null,
          lastSeen: false,
          unread: 0,
        });
      }

      // merge chat last message + unread
      try {
        const chatsSnap = await get(await getDbRef("Chats"));
        if (chatsSnap.exists()) {
          chatsSnap.forEach((child) => {
            const chatKey = child.key;
            const val = child.val() || {};
            const participants = val.participants || {};
            const last = val.lastMessage || null;
            const unreadObj = val.unread || {};

            if (!resolvedUserId || !participants[resolvedUserId]) return;

            const otherKeys = Object.keys(participants).filter((k) => String(k) !== String(resolvedUserId));
            if (!otherKeys.length) return;
            const other = otherKeys[0];

            for (const [mapKey, c] of contactsMap.entries()) {
              if (String(c.userId) === String(other) || String(mapKey) === String(other)) {
                const next = { ...c };
                next.chatId = chatKey;
                next.lastMessage = last?.text || next.lastMessage;
                next.lastTime = last?.timeStamp || next.lastTime;
                next.lastSenderId = last?.senderId ?? next.lastSenderId;
                next.lastSeen = typeof last?.seen === "boolean" ? last.seen : next.lastSeen;
                const unreadCount = Number(unreadObj[resolvedUserId] ?? 0);
                const lastSender = last?.senderId ?? null;
                next.unread = lastSender && String(lastSender) === String(resolvedUserId) ? 0 : unreadCount;
                contactsMap.set(mapKey, next);
              }
            }
          });
        }
      } catch (e) {
        console.warn("Chats merge failed", e);
      }

      const fresh = Array.from(contactsMap.values()).sort((a, b) => {
        if ((b.unread || 0) !== (a.unread || 0)) return (b.unread || 0) - (a.unread || 0);
        const ta = Number(a.lastTime || 0);
        const tb = Number(b.lastTime || 0);
        if (tb !== ta) return tb - ta;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });

      setContacts(fresh);

      try {
        const fetchedAt = Date.now();
        await persistChatsCache(fresh, fetchedAt);
        lastFetchedAtRef.current = fetchedAt;
      } catch {}
    } catch (err) {
      console.warn("loadData error", err);
    } finally {
      if (!background) setLoadingInitial(false);
      setRefreshing(false);
    }
  }, [resolveCurrentUserId]);

  useEffect(() => {
    (async () => {
      await loadCacheAndShow();
      try {
        const fetchedAt = await readChatsCacheFetchedAt();
        if (!fetchedAt || Date.now() - fetchedAt > debounceWindowMs) loadData({ background: true });
        else lastFetchedAtRef.current = fetchedAt;
      } catch {
        loadData({ background: true });
      }
    })();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - (lastFetchedAtRef.current || 0) > debounceWindowMs) {
        loadData({ background: true });
      }
    }, [loadData])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData({ background: false });
  }, [loadData]);

  const onBackPress = useCallback(() => {
    if (searchActive) {
      setSearchActive(false);
      setSearchQuery("");
      return;
    }

    router.back();
  }, [router, searchActive]);

  const onOpenChat = async (contact) => {
    if (!contact) return;

    setOpenedChat({
      chatId: contact.chatId || "",
      contactKey: contact.key || "",
      contactUserId: contact.userId || "",
      contactName: contact.name || "",
      contactImage: normalizeProfileImageUri(contact.profileImage) || "",
    });

    router.push("/messages");
  };

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const shouldShowSearchResults = normalizedSearchQuery.length > 0;

  const filteredContacts = contacts.filter((c) => {
    if (normalizedSearchQuery) {
      const haystack = [c.name, c.role, c.lastMessage]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearchQuery);
    }

    if (filter === "Management") return c.type === "management";
    if (filter === "Teachers") return c.type === "teacher";
    if (filter === "Parents") return c.type === "parent";
    if (filter === "Support") return c.type === "support";
    return false;
  });

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safe}>
      <StatusBar barStyle={statusBarStyle === "dark" ? "dark-content" : "light-content"} backgroundColor={colors.background} translucent={false} />
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onBackPress} style={styles.backButton}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </TouchableOpacity>

          {searchActive ? (
            <View style={styles.searchBar}>
              <Ionicons name="search-outline" size={18} color={MUTED} />
              <TextInput
                autoFocus
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search"
                placeholderTextColor="#93A1C6"
                style={styles.searchInput}
                returnKeyType="search"
              />
              {searchQuery ? (
                <TouchableOpacity onPress={() => setSearchQuery("")} style={styles.searchIconButton}>
                  <Ionicons name="close-circle" size={18} color={MUTED} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <Text style={styles.headerTitle}>Messages</Text>
          )}

          <TouchableOpacity
            onPress={() => {
              if (searchActive) {
                setSearchActive(false);
                setSearchQuery("");
                return;
              }
              setSearchActive(true);
            }}
            style={styles.searchToggle}
          >
            <Ionicons name={searchActive ? "close" : "search-outline"} size={20} color={colors.muted} />
          </TouchableOpacity>
        </View>

        {!searchActive ? (
          <View style={styles.filterContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
              {FILTERS.map((f) => (
                <TouchableOpacity key={f} onPress={() => setFilter(f)} activeOpacity={0.85} style={[styles.filterPill, filter === f ? styles.filterPillActive : null]}>
                  <Text style={[styles.filterPillText, filter === f ? styles.filterPillTextActive : null]}>{f}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {loadingInitial && contacts.length === 0 ? (
          <PageLoadingSkeleton variant="chat" showHeader={false} style={{ flex: 1, backgroundColor: colors.background }} />
        ) : searchActive && !shouldShowSearchResults ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>Search chats</Text>
            <Text style={styles.emptySubtitle}>Type a name, role, or message to find a user.</Text>
          </View>
        ) : filteredContacts.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No contacts</Text>
            <Text style={styles.emptySubtitle}>
              {normalizedSearchQuery
                ? `No results for "${searchQuery.trim()}".`
                : `No ${filter.toLowerCase()} contacts found yet.`}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredContacts}
            keyExtractor={(it) => it.key}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            renderItem={({ item }) => {
              const lastWasMine = item.lastSenderId && currentUserId && String(item.lastSenderId) === String(currentUserId);
              const seenFlag = !!item.lastSeen;
              return (
                <TouchableOpacity style={styles.itemWrapper} onPress={() => onOpenChat(item)} activeOpacity={0.9}>
                  <View style={styles.row}>
                    <TouchableOpacity
                      style={styles.profileTapArea}
                      activeOpacity={0.85}
                      onPress={() => openUserProfile({
                        candidates: [item.key, item.userId].filter(Boolean),
                        fallbackName: item.name,
                        fallbackAvatar: item.profileImage,
                        fallbackRole: item.role || item.type || "School Account",
                        fallbackRoleTitle: item.role || item.type || "School Account",
                        fallbackContactKey: item.key || "",
                        fallbackContactUserId: item.userId || item.key || "",
                      })}
                    >
                      <Image source={normalizeProfileImageUri(item.profileImage) ? { uri: normalizeProfileImageUri(item.profileImage) } : AVATAR_PLACEHOLDER} style={styles.avatar} />
                    </TouchableOpacity>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={styles.rowTop}>
                        <TouchableOpacity
                          style={styles.nameTapArea}
                          activeOpacity={0.85}
                          onPress={() => openUserProfile({
                            candidates: [item.key, item.userId].filter(Boolean),
                            fallbackName: item.name,
                            fallbackAvatar: item.profileImage,
                            fallbackRole: item.role || item.type || "School Account",
                            fallbackRoleTitle: item.role || item.type || "School Account",
                            fallbackContactKey: item.key || "",
                            fallbackContactUserId: item.userId || item.key || "",
                          })}
                        >
                          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                          {item.role ? <View style={styles.badge}><Text style={styles.badgeText}>{item.role}</Text></View> : null}
                        </TouchableOpacity>

                        <View style={{ alignItems: "flex-end", flexDirection: "row" }}>
                          <Text style={styles.time}>{fmtTime12(item.lastTime)}</Text>
                          <View style={{ width: 8 }} />
                          {lastWasMine ? (
                            <Ionicons name={seenFlag ? "checkmark-done" : "checkmark"} size={16} color={seenFlag ? colors.primary : colors.muted} />
                          ) : null}
                          {item.unread ? <View style={styles.unreadPill}><Text style={styles.unreadText}>{item.unread}</Text></View> : null}
                        </View>
                      </View>

                      <View style={{ marginTop: 6 }}>
                        <Text style={styles.subtitleText} numberOfLines={1}>
                          {shortText(item.lastMessage || "Start a conversation")}
                        </Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.separatorLine} />}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
          />
        )}
      </View>
      {profileCardModal}
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },

  headerRow: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 20, fontWeight: "800", color: colors.text },
  searchToggle: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  searchBar: {
    flex: 1,
    height: 42,
    marginHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    paddingVertical: 0,
  },
  searchIconButton: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },

  filterContainer: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 6,
  },
  filterScrollContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    justifyContent: "center",
    alignItems: "center",
  },
  filterPillActive: {
    backgroundColor: colors.soft,
    borderColor: colors.primary,
  },
  filterPillText: { color: colors.muted, fontWeight: "700", fontSize: 12 },
  filterPillTextActive: { color: colors.primary },

  itemWrapper: { paddingHorizontal: 0 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, backgroundColor: colors.background },
  profileTapArea: { alignItems: "center", justifyContent: "center" },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceMuted },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  nameTapArea: { flex: 1, flexDirection: "row", alignItems: "center" },
  name: { fontWeight: "700", fontSize: 16, color: colors.text, marginRight: 8 },
  badge: { marginLeft: -4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: colors.badgeBackground },
  badgeText: { color: colors.primary, fontWeight: "700", fontSize: 11 },
  subtitleText: { color: colors.muted, fontSize: 13, flex: 1 },

  time: { color: colors.muted, fontSize: 11 },
  unreadPill: { marginTop: 8, backgroundColor: colors.primary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, minWidth: 24, alignItems: "center" },
  unreadText: { color: colors.white, fontWeight: "700", fontSize: 12 },

  separatorLine: { height: 1, backgroundColor: colors.separator, marginLeft: 56 + 12 + 8, marginRight: 0 },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 40, paddingHorizontal: 24 },
  emptyTitle: { fontWeight: "700", fontSize: 16, color: colors.text, textAlign: "center" },
  emptySubtitle: { color: colors.muted, marginTop: 6, textAlign: "center" },
});
}