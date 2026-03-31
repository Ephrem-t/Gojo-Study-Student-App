import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { get, ref, runTransaction } from "firebase/database";
import { database } from "../constants/firebaseConfig";
import { useAppTheme } from "../hooks/use-app-theme";
import { getInstagramFeedAspectRatio } from "./lib/instagramMedia";
import { extractProfileImage, normalizeProfileImageUri } from "./lib/profileImage";
import { getSavedPostsLocation, getSavedPostsMap, setSavedPostEntry } from "./lib/savedPosts";
import { queryUserByChildInSchool, queryUserByUsernameInSchool } from "./lib/userHelpers";

const DESCRIPTION_PREVIEW_LENGTH = 140;

function timeAgo(value) {
  if (!value) return "";
  const timestamp = typeof value === "number" ? value : new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";

  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  return `${years}y`;
}

function formatTargetRoleLabel(data) {
  const raw = data?.targetRole ?? data?.target ?? "all";
  const normalized = String(raw).trim().toLowerCase();

  if (!normalized || normalized === "all") return "Visible to everyone";
  if (normalized === "student") return "Visible to student";
  return `Visible to ${normalized}`;
}

function isStudentVisiblePost(data) {
  const raw = data?.targetRole ?? data?.target ?? "all";
  const role = String(raw).toLowerCase().trim();
  if (!raw) return true;
  return role === "all" || role === "student";
}

function getPosterName(admin, postData) {
  const fullFromAdmin = [admin?.personal?.firstName, admin?.personal?.middleName, admin?.personal?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return admin?.name || admin?.username || fullFromAdmin || postData?.adminName || "School Admin";
}

function getPosterImage(admin, postData) {
  const candidates = [extractProfileImage(admin), postData?.adminProfile];

  for (const candidate of candidates) {
    const normalized = normalizeProfileImageUri(candidate);
    if (normalized) return normalized;
  }

  return null;
}

export default function SavedPostsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const adminCacheRef = useRef({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [posts, setPosts] = useState([]);
  const [userId, setUserId] = useState(null);
  const [expandedDescriptions, setExpandedDescriptions] = useState({});
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerImage, setViewerImage] = useState(null);

  useEffect(() => {
    (async () => {
      const uid = await AsyncStorage.getItem("userId");
      setUserId(uid);
    })();
  }, []);

  const cacheResolvedPoster = useCallback((keys, userVal, nodeKey, schoolKey) => {
    if (!userVal) return;
    const payload = { ...userVal, _nodeKey: nodeKey || null, _schoolKey: schoolKey || null };
    const allKeys = Array.from(
      new Set([
        ...(Array.isArray(keys) ? keys : []),
        nodeKey,
        userVal.userId,
        userVal.username,
      ].filter(Boolean))
    );

    allKeys.forEach((key) => {
      adminCacheRef.current[key] = payload;
    });
  }, []);

  const resolvePosterForPost = useCallback(async (postData, schoolKey) => {
    const keys = [postData?.adminId, postData?.userId, postData?.createdBy].filter(Boolean);
    if (!keys.length) return;

    const cached = keys.find((key) => adminCacheRef.current[key]);
    if (cached) return;

    for (const key of keys) {
      try {
        const byUserId = await queryUserByChildInSchool("userId", key, schoolKey);
        if (byUserId && byUserId.exists()) {
          let found = false;
          byUserId.forEach((child) => {
            cacheResolvedPoster(keys, child.val(), child.key, schoolKey);
            found = true;
            return true;
          });
          if (found) return;
        }
      } catch {}

      try {
        const byUsername = await queryUserByUsernameInSchool(key, schoolKey);
        if (byUsername && byUsername.exists()) {
          let found = false;
          byUsername.forEach((child) => {
            cacheResolvedPoster(keys, child.val(), child.key, schoolKey);
            found = true;
            return true;
          });
          if (found) return;
        }
      } catch {}

      try {
        const directSchoolSnap = schoolKey
          ? await get(ref(database, `Platform1/Schools/${schoolKey}/Users/${key}`))
          : null;
        if (directSchoolSnap && directSchoolSnap.exists()) {
          cacheResolvedPoster(keys, directSchoolSnap.val(), key, schoolKey);
          return;
        }
      } catch {}

      try {
        const directGlobalSnap = await get(ref(database, `Users/${key}`));
        if (directGlobalSnap && directGlobalSnap.exists()) {
          cacheResolvedPoster(keys, directGlobalSnap.val(), key, null);
          return;
        }
      } catch {}
    }
  }, [cacheResolvedPoster]);

  const loadSavedPosts = useCallback(async () => {
    try {
      const location = await getSavedPostsLocation();
      const savedMap = await getSavedPostsMap();

      const savedEntries = Object.entries(savedMap || {})
        .map(([postId, meta]) => ({ postId, meta: meta || {} }))
        .sort((a, b) => Number(b.meta?.savedAt || 0) - Number(a.meta?.savedAt || 0));

      if (!savedEntries.length) {
        setPosts([]);
        return;
      }

      const schoolKey = location?.schoolKey || null;
      const postsBasePath = schoolKey ? `Platform1/Schools/${schoolKey}/Posts` : "Posts";

      const loadedPosts = await Promise.all(
        savedEntries.map(async ({ postId, meta }) => {
          try {
            const snap = await get(ref(database, `${postsBasePath}/${postId}`));
            if (!snap.exists()) return null;

            const data = snap.val() || {};
            if (!isStudentVisiblePost(data)) return null;

            await resolvePosterForPost(data, schoolKey);
            const admin = adminCacheRef.current[data.adminId] || adminCacheRef.current[data.userId] || null;

            const safePostImage = normalizeProfileImageUri(data.postUrl);
            const safeAdminImage = normalizeProfileImageUri(extractProfileImage(admin));
            if (safePostImage) Image.prefetch(safePostImage).catch(() => {});
            if (safeAdminImage) Image.prefetch(safeAdminImage).catch(() => {});

            return {
              postId: data.postId || postId,
              data,
              admin,
              savedAt: Number(meta?.savedAt || 0),
              likesMap: data.likes || {},
            };
          } catch {
            return null;
          }
        })
      );

      setPosts(loadedPosts.filter(Boolean));
    } catch (error) {
      console.warn("load saved posts failed:", error);
      Alert.alert("Error", "Unable to load saved posts right now.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [resolvePosterForPost]);

  useEffect(() => {
    loadSavedPosts();
  }, [loadSavedPosts]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadSavedPosts();
  }, [loadSavedPosts]);

  const toggleDescription = useCallback((postId) => {
    setExpandedDescriptions((prev) => ({
      ...prev,
      [postId]: !prev[postId],
    }));
  }, []);

  const toggleLike = useCallback(async (postId) => {
    const uid = userId || (await AsyncStorage.getItem("userId"));
    if (!uid) {
      Alert.alert("Not signed in", "You must be signed in to like posts.");
      return;
    }

    if (!userId) setUserId(uid);

    const found = posts.find((item) => item.postId === postId);
    if (!found) return;

    const currentlyLiked = !!(found.likesMap && found.likesMap[uid]);

    const optimisticUpdater = (post) => {
      const likes = { ...(post.likesMap || {}) };
      if (currentlyLiked) delete likes[uid];
      else likes[uid] = true;

      return {
        ...post,
        likesMap: likes,
        data: { ...post.data, likeCount: Object.keys(likes).length },
      };
    };

    setPosts((prev) => prev.map((item) => (item.postId === postId ? optimisticUpdater(item) : item)));

    try {
      const location = await getSavedPostsLocation();
      const postRef = location?.schoolKey
        ? ref(database, `Platform1/Schools/${location.schoolKey}/Posts/${postId}`)
        : ref(database, `Posts/${postId}`);

      await runTransaction(postRef, (current) => {
        if (current === null) return current;
        if (!current.likes) current.likes = {};
        if (!current.likeCount) current.likeCount = 0;

        const likedBefore = !!current.likes[uid];
        if (likedBefore) {
          if (current.likes[uid]) delete current.likes[uid];
          current.likeCount = Math.max(0, (current.likeCount || 1) - 1);
        } else {
          current.likes[uid] = true;
          current.likeCount = (current.likeCount || 0) + 1;
        }

        return current;
      });
    } catch (error) {
      console.warn("saved posts like failed:", error);
      try {
        const location = await getSavedPostsLocation();
        const postRef = location?.schoolKey
          ? ref(database, `Platform1/Schools/${location.schoolKey}/Posts/${postId}`)
          : ref(database, `Posts/${postId}`);
        const snap = await get(postRef);

        if (snap.exists()) {
          const value = snap.val() || {};
          setPosts((prev) => prev.map((item) => (
            item.postId === postId
              ? { ...item, data: value, likesMap: value.likes || {} }
              : item
          )));
        }
      } catch {}

      Alert.alert("Error", "Unable to update like. Please try again.");
    }
  }, [posts, userId]);

  const removeSavedPost = useCallback(async (postId) => {
    const previousPosts = posts;
    setPosts((prev) => prev.filter((item) => item.postId !== postId));

    try {
      await setSavedPostEntry(postId, false);
    } catch (error) {
      console.warn("remove saved post failed:", error);
      setPosts(previousPosts);
      Alert.alert("Error", "Unable to remove this saved post.");
    }
  }, [posts]);

  function PostCard({ item }) {
    const { postId, data, admin, savedAt, likesMap = {} } = item;
    const imageUri = normalizeProfileImageUri(data.postUrl);
    const [mediaAspectRatio, setMediaAspectRatio] = useState(1);
    const message = String(data.message || "").trim();
    const posterName = getPosterName(admin, data);
    const posterImage = getPosterImage(admin, data);
    const likesCount = data.likeCount || Object.keys(likesMap || {}).length;
    const isLiked = userId ? !!likesMap[userId] : false;
    const isExpanded = !!expandedDescriptions[postId];
    const shouldTruncate = message.length > DESCRIPTION_PREVIEW_LENGTH;
    const previewMessage = shouldTruncate && !isExpanded
      ? `${message.slice(0, DESCRIPTION_PREVIEW_LENGTH).trimEnd()}...`
      : message;

    useEffect(() => {
      let active = true;

      if (!imageUri) {
        setMediaAspectRatio(1);
        return () => {
          active = false;
        };
      }

      getInstagramFeedAspectRatio(imageUri).then((nextAspectRatio) => {
        if (active) setMediaAspectRatio(nextAspectRatio);
      });

      return () => {
        active = false;
      };
    }, [imageUri]);

    const scale = useRef(new Animated.Value(1)).current;
    const onHeartPress = () => {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.18, duration: 140, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0, duration: 140, useNativeDriver: true }),
      ]).start();
      toggleLike(postId);
    };

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Image
            source={posterImage ? { uri: posterImage } : require("../assets/images/avatar_placeholder.png")}
            style={styles.avatar}
          />
          <View style={styles.headerTextWrap}>
            <Text style={styles.username}>{posterName}</Text>
            <View style={styles.headerMetaRow}>
              <Text style={styles.time}>{timeAgo(data.time)}</Text>
              <Text style={styles.headerDot}>·</Text>
              <Text style={styles.targetRoleText}>{formatTargetRoleLabel(data)}</Text>
            </View>
          </View>
        </View>

        {message ? (
          <View style={styles.messageWrap}>
            <Text style={styles.messageText}>{previewMessage}</Text>
            {shouldTruncate ? (
              <TouchableOpacity activeOpacity={0.8} onPress={() => toggleDescription(postId)}>
                <Text style={styles.seeMoreText}>{isExpanded ? "See less" : "See more"}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {imageUri ? (
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={() => {
              setViewerImage(imageUri);
              setViewerVisible(true);
            }}
          >
            <Image source={{ uri: imageUri }} style={[styles.postImage, { aspectRatio: mediaAspectRatio }]} resizeMode="cover" />
          </TouchableOpacity>
        ) : null}

        <View style={styles.reactionsSummary}>
          <View style={styles.reactionsLeft}>
            <TouchableOpacity style={styles.likeIconOnlyBtn} activeOpacity={0.85} onPress={onHeartPress}>
              <Animated.View style={{ transform: [{ scale }] }}>
                <Ionicons name={isLiked ? "heart" : "heart-outline"} size={24} color={isLiked ? "#ED4956" : colors.text} />
              </Animated.View>
            </TouchableOpacity>
            <Text style={styles.reactionCountText}>{likesCount} {likesCount === 1 ? "like" : "likes"}</Text>
          </View>
          <TouchableOpacity style={styles.saveButton} activeOpacity={0.85} onPress={() => removeSavedPost(postId)}>
            <Ionicons name="bookmark" size={19} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.savedMetaWrap}>
          <Text style={styles.savedMetaText}>Saved {timeAgo(savedAt)}</Text>
        </View>
      </View>
    );
  }

  const EmptyState = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name="bookmark-outline" size={38} color={colors.muted} />
      </View>
      <Text style={styles.emptyTitle}>No saved posts yet</Text>
      <Text style={styles.emptySubtitle}>Posts you bookmark from the home feed will appear here.</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.topBarWrap, { paddingTop: Math.max(6, insets.top > 0 ? 6 : 10) }]}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.topBarAction} onPress={() => router.back()} activeOpacity={0.85}>
            <View style={styles.backBtn}>
              <Ionicons name="chevron-back" size={19} color={colors.text} />
            </View>
            <Text style={styles.topBarTitle}>Saved Posts</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : posts.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.postId}
          renderItem={({ item }) => <PostCard item={item} />}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
        />
      )}

      <Modal visible={viewerVisible} transparent animationType="fade" onRequestClose={() => setViewerVisible(false)}>
        <View style={styles.viewerBg}>
          <View style={styles.viewerTop}>
            <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerVisible(false)}>
              <Ionicons name="close" size={26} color={colors.white} />
            </TouchableOpacity>
          </View>
          <Pressable style={styles.viewerPressable} onPress={() => setViewerVisible(false)}>
            {viewerImage ? <Image source={{ uri: viewerImage }} style={styles.viewerImage} resizeMode="contain" /> : null}
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: "#FFFFFF",
    },
    topBarWrap: {
      backgroundColor: "#FFFFFF",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    topBar: {
      height: 62,
      justifyContent: "center",
      paddingHorizontal: 14,
    },
    topBarAction: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    topBarTitle: {
      marginLeft: 10,
      fontSize: 16,
      fontWeight: "800",
      color: colors.text,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#FFFFFF",
    },
    list: {
      paddingVertical: 0,
      backgroundColor: "#FFFFFF",
    },
    card: {
      backgroundColor: "#FFFFFF",
      marginBottom: 6,
      marginHorizontal: 0,
      overflow: "hidden",
      borderRadius: 0,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: "#DBDBDB",
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 6,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      marginRight: 10,
      backgroundColor: colors.surfaceMuted,
    },
    headerTextWrap: {
      flex: 1,
    },
    username: {
      fontWeight: "700",
      color: colors.text,
      fontSize: 15,
    },
    headerMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 2,
    },
    time: {
      color: colors.muted,
      fontSize: 12,
    },
    headerDot: {
      color: colors.muted,
      fontSize: 12,
      marginHorizontal: 4,
    },
    targetRoleText: {
      color: colors.muted,
      fontSize: 12,
    },
    messageWrap: {
      paddingHorizontal: 12,
      paddingBottom: 8,
    },
    messageText: {
      color: colors.text,
      lineHeight: 20,
      fontSize: 15,
    },
    seeMoreText: {
      color: colors.muted,
      fontSize: 14,
      marginTop: 4,
    },
    postImage: {
      width: "100%",
      backgroundColor: "#DDD",
    },
    reactionsSummary: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingTop: 4,
      paddingBottom: 4,
    },
    reactionsLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    reactionCountText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "700",
    },
    likeIconOnlyBtn: {
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    savedMetaWrap: {
      paddingHorizontal: 12,
      paddingBottom: 6,
    },
    savedMetaText: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: "600",
    },
    saveButton: {
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#FFFFFF",
      paddingHorizontal: 28,
    },
    emptyIconWrap: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.soft,
      marginBottom: 16,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 8,
    },
    emptySubtitle: {
      fontSize: 14,
      color: colors.muted,
      textAlign: "center",
      lineHeight: 20,
    },
    viewerBg: {
      flex: 1,
      backgroundColor: colors.imageOverlay,
      alignItems: "center",
      justifyContent: "center",
    },
    viewerTop: {
      position: "absolute",
      top: 45,
      right: 14,
      zIndex: 20,
    },
    viewerClose: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: "rgba(255,255,255,0.18)",
      alignItems: "center",
      justifyContent: "center",
    },
    viewerPressable: {
      flex: 1,
      width: "100%",
    },
    viewerImage: {
      width: "100%",
      height: "100%",
    },
  });
}