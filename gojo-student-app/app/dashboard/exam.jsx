import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Dimensions,
  Platform,
  SafeAreaView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get } from "firebase/database";
import { database } from "../../constants/firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { queryUserByUsernameInSchool, queryUserByChildInSchool } from "../lib/userHelpers";

/**
 * Modern, clean Top-5 leaderboard with pagination dots
 * - Wide cards (same width) so layout doesn't elongate or overflow.
 * - Dots indicator below the list to show there are more entries and current position.
 * - Top-1 visually emphasized but all cards keep same width (consistent snapping).
 */

const SCREEN_W = Dimensions.get("window").width;
const CARD_WIDTH = Math.round(Math.min(760, SCREEN_W * 0.92)); // wide but within screen
const CARD_HEIGHT = 180;
const PRIMARY = "#0B72FF";
const MUTED = "#6B78A8";
const GOLD = "#F2C94C";
const CARD_SPACING = 14;

async function resolveSchoolKeyForPrefix(prefix) {
  try {
    const snap = await get(ref(database, `Platform1/schoolCodeIndex/${prefix}`));
    if (snap.exists()) return snap.val();
  } catch (e) {
    // ignore
  }
  return null;
}

async function fetchProfileAndSchoolForUser(userId) {
  if (!userId) return {};
  try {
    const prefix = userId.substr(0, 3).toUpperCase();
    const schoolKey = await resolveSchoolKeyForPrefix(prefix);

    let profile = null;
    let userNodeKey = null;

    if (schoolKey) {
      try {
        const snap = await queryUserByUsernameInSchool(userId, schoolKey);
        if (snap && snap.exists()) {
          snap.forEach((c) => {
            profile = c.val();
            userNodeKey = c.key;
            return true;
          });
        }
      } catch (e) {
        // fallback below
      }
    }

    if (!profile) {
      try {
        const snap = await queryUserByChildInSchool("username", userId, null);
        if (snap && snap.exists()) {
          snap.forEach((c) => {
            profile = c.val();
            userNodeKey = c.key;
            return true;
          });
        }
      } catch (e) {
        // ignore
      }
    }

    let schoolInfo = null;
    if (schoolKey) {
      try {
        const sSnap = await get(ref(database, `Platform1/Schools/${schoolKey}/schoolInfo`));
        if (sSnap.exists()) schoolInfo = sSnap.val();
      } catch (e) {}
    }

    return { profile, schoolInfo, schoolKey, userNodeKey };
  } catch (err) {
    return {};
  }
}

export default function ExamLeaderboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]); // enriched top5
  const listRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // content padding left/right so first card can be centered visually
  const contentPadding = Math.round((SCREEN_W - CARD_WIDTH) / 2);

  useEffect(() => {
    loadTop5();
  }, []);

  const loadTop5 = useCallback(async () => {
    setLoading(true);
    try {
      const countrySnap = await get(ref(database, `Platform1/country`));
      const country = (countrySnap && countrySnap.exists()) ? countrySnap.val() : "Ethiopia";

      const grade = (await AsyncStorage.getItem("studentGrade")) || "9";
      const gradeKey = `grade${grade}`;
      const snap = await get(ref(database, `Platform1/rankings/country/${country}/${gradeKey}/leaderboard`));

      const raw = [];
      if (snap && snap.exists()) {
        snap.forEach((c) => {
          const v = c.val() || {};
          raw.push({
            userId: c.key,
            rank: v.rank || 999,
            totalPoints: v.totalPoints || 0,
            badge: v.badge || null,
          });
        });
      }

      raw.sort((a, b) => (a.rank || 999) - (b.rank || 999));
      const top5 = raw.slice(0, 5);

      const enriched = await Promise.all(
        top5.map(async (entry) => {
          const resolved = await fetchProfileAndSchoolForUser(entry.userId);
          return {
            ...entry,
            profile: resolved.profile || null,
            schoolInfo: resolved.schoolInfo || null,
          };
        })
      );

      setItems(enriched);

      // ensure list starts with the first item nicely positioned
      setTimeout(() => {
        if (listRef.current && enriched.length > 0) {
          listRef.current.scrollToOffset({ offset: 0, animated: true });
          setActiveIndex(0);
        }
      }, 200);
    } catch (err) {
      console.warn("loadTop5 error", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const onMomentumScrollEnd = (e) => {
    const offsetX = e.nativeEvent.contentOffset.x || 0;
    const idx = Math.round(offsetX / (CARD_WIDTH + CARD_SPACING));
    const bounded = Math.max(0, Math.min(items.length - 1, idx));
    setActiveIndex(bounded);
  };

  const renderCard = ({ item, index }) => {
    const isTop = Number(item.rank) === 1 || index === 0; // emphasize first
    const displayName = item.profile?.name || item.profile?.username || item.userId;
    const avatar = item.profile?.profileImage || item.schoolInfo?.logoUrl || null;
    const school = item.schoolInfo?.name || item.profile?.schoolName || item.schoolInfo?.city || "";

    return (
      <View style={{ width: CARD_WIDTH, height: CARD_HEIGHT, marginRight: CARD_SPACING }}>
        <TouchableOpacity
          activeOpacity={0.92}
          onPress={() => router.push({ pathname: "/exam/profile", params: { userId: item.userId } })}
          style={[styles.card, isTop ? styles.cardTop : styles.cardNormal]}
        >
          <View style={styles.cardHeader}>
            <View style={[styles.rankWrap, isTop && styles.rankWrapTop]}>
              <Text style={[styles.rankText, isTop && styles.rankTextTop]}>{item.rank}</Text>
            </View>

            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text numberOfLines={2} style={[styles.name, isTop && styles.nameTop]}>{displayName}</Text>
              <Text numberOfLines={1} style={styles.schoolText}>{school} {item.schoolInfo?.region ? `• ${item.schoolInfo.region}` : ""}</Text>
            </View>
          </View>

          <View style={styles.cardFooter}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {avatar ? (
                <Image source={{ uri: avatar }} style={[styles.avatar, isTop && styles.avatarTop]} />
              ) : (
                <View style={[styles.avatarPlaceholder, isTop && styles.avatarTop]}>
                  <Text style={styles.avatarPlaceholderText}>{(displayName || "U").slice(0, 1)}</Text>
                </View>
              )}

              <View style={{ marginLeft: 12 }}>
                <Text style={styles.pointsLabel}>Points</Text>
                <Text style={[styles.pointsValue, isTop && styles.pointsValueTop]}>{item.totalPoints}</Text>
              </View>
            </View>

            <View style={{ alignItems: "center", justifyContent: "center" }}>
              <View style={styles.trophyWrap}>
                <Ionicons name="trophy" size={26} color={GOLD} />
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>LeaderBoard</Text>
        </View>

        <TouchableOpacity style={styles.cta} onPress={() => router.push("/exam/leaderboard")}>
          <Ionicons name="trophy" size={18} color="#fff" />
          <Text style={styles.ctaText}>See leaderboard</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>No leaderboard data yet.</Text>
        </View>
      ) : (
        <>
          <FlatList
            ref={listRef}
            data={items}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(i) => i.userId}
            renderItem={renderCard}
            contentContainerStyle={{ paddingHorizontal: contentPadding }}
            snapToInterval={CARD_WIDTH + CARD_SPACING}
            decelerationRate={Platform.OS === "ios" ? 0.92 : 0.98}
            onMomentumScrollEnd={onMomentumScrollEnd}
          />

          {/* Dots indicator */}
          <View style={styles.dotsWrap}>
            {items.map((_, i) => {
              const active = i === activeIndex;
              return (
                <View
                  key={`dot-${i}`}
                  style={[
                    styles.dot,
                    active ? styles.dotActive : null,
                    // spread out horizontally a little
                    i !== items.length - 1 ? { marginRight: 8 } : null,
                  ]}
                />
              );
            })}
          </View>
        </>
      )}

      <View style={{ height: 20 }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FBFCFF" },
  header: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 22, fontWeight: "900", color: "#0B2540" },

  cta: { flexDirection: "row", alignItems: "center", backgroundColor: PRIMARY, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  ctaText: { color: "#fff", marginLeft: 8, fontWeight: "800" },

  loaderWrap: { height: CARD_HEIGHT + 20, alignItems: "center", justifyContent: "center" },
  emptyWrap: { paddingHorizontal: 18, paddingVertical: 26, alignItems: "center" },
  emptyText: { color: MUTED },

  card: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#EEF4FF",
    justifyContent: "space-between",
  },
  cardTop: {
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 6,
    transform: [{ scale: 1.02 }],
  },
  cardNormal: {
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 3,
  },

  cardHeader: { flexDirection: "row", alignItems: "center" },
  rankWrap: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  rankWrapTop: { width: 56, height: 56, borderRadius: 28 },
  rankText: { fontWeight: "900", fontSize: 16 },
  rankTextTop: { fontSize: 20 },

  name: { fontWeight: "800", fontSize: 14, color: "#0B2540" },
  nameTop: { fontSize: 18 },
  schoolText: { color: MUTED, marginTop: 4, fontSize: 12 },

  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  avatar: { width: 50, height: 50, borderRadius: 12 },
  avatarTop: { width: 76, height: 76, borderRadius: 14 },
  avatarPlaceholder: { width: 64, height: 64, borderRadius: 12, backgroundColor: PRIMARY, alignItems: "center", justifyContent: "center" },
  avatarPlaceholderText: { color: "#fff", fontWeight: "900", fontSize: 18 },

  pointsLabel: { color: MUTED, fontSize: 12 },
  pointsValue: { fontWeight: "900", fontSize: 20, color: "#0B2540" },
  pointsValueTop: { fontSize: 24 },

  trophyWrap: { backgroundColor: "rgba(242,201,76,0.14)", padding: 10, borderRadius: 12 },

  // Dots indicator
  dotsWrap: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#D9E6FF", opacity: 0.9 },
  dotActive: { width: 22, height: 8, borderRadius: 10, backgroundColor: PRIMARY },
});