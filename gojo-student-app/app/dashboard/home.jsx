import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Alert,
  Animated,
  Modal,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import {
  ref,
  query,
  orderByChild,
  limitToLast,
  equalTo,
  endAt,
  onValue,
  off,
  get,
  update,
  runTransaction,
} from "firebase/database";
import { database } from "../../constants/firebaseConfig";
import { queryUserByUsernameInSchool, queryUserByChildInSchool } from "../lib/userHelpers";
import { useAppTheme } from "../../hooks/use-app-theme";
import { extractProfileImage, normalizeProfileImageUri } from "../lib/profileImage";

/**
 * Home feed with pagination ("load more") for older posts.
 * Added:
 * 1) Student-target filter uses targetRole: only "all" or "student" (or missing => all)
 * 2) Image tap opens full-screen viewer
 */

const SCREEN_WIDTH = Dimensions.get("window").width;
const IMAGE_HEIGHT = Math.round(SCREEN_WIDTH * 0.9 * 0.65);
const PAGE_SIZE = 20;
const DESCRIPTION_PREVIEW_LENGTH = 140;

function getFileExtensionFromUrl(url) {
  if (!url) return "jpg";
  const cleanUrl = url.split("?")[0] || "";
  const ext = cleanUrl.split(".").pop()?.toLowerCase();
  if (!ext || ext.length > 5) return "jpg";
  return ext;
}

function getMimeTypeFromExtension(ext) {
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "heic":
      return "image/heic";
    default:
      return "image/jpeg";
  }
}

function timeAgo(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const seconds = Math.floor((Date.now() - t) / 1000);
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

function getPosterName(admin, postData) {
  const fullFromAdmin = [admin?.personal?.firstName, admin?.personal?.middleName, admin?.personal?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return admin?.name || admin?.username || fullFromAdmin || postData?.adminName || "School Admin";
}

function getPosterImage(admin, postData) {
  const candidates = [
    extractProfileImage(admin),
    postData?.adminProfile,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeProfileImageUri(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export default function HomeScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [postsLatest, setPostsLatest] = useState([]);
  const [postsOlder, setPostsOlder] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [userId, setUserId] = useState(null);
  const [expandedDescriptions, setExpandedDescriptions] = useState({});
  const [postMenuPostId, setPostMenuPostId] = useState(null);

  // large image viewer state
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerImage, setViewerImage] = useState(null);

  const adminCacheRef = useRef({});
  const postsQueryRef = useRef(null);

  const loadUserContext = useCallback(async () => {
    const uid = await AsyncStorage.getItem("userId");
    setUserId(uid);

    try {
      const userNodeKey = await AsyncStorage.getItem("userNodeKey");
      const schoolKey = await AsyncStorage.getItem("schoolKey");
      let userSnap = null;
      if (userNodeKey && schoolKey) {
        userSnap = await get(ref(database, `Platform1/Schools/${schoolKey}/Users/${userNodeKey}`));
      }
      if ((!userSnap || !userSnap.exists()) && userNodeKey) {
        userSnap = await get(ref(database, `Users/${userNodeKey}`));
      }
      if (userSnap && userSnap.exists()) {
        const u = userSnap.val();
        const safeProfileImage = normalizeProfileImageUri(extractProfileImage(u));
        if (safeProfileImage) {
          await AsyncStorage.setItem("profileImage", safeProfileImage);
          Image.prefetch(safeProfileImage).catch(() => {});
        } else {
          await AsyncStorage.removeItem("profileImage").catch(() => {});
        }
      }
    } catch {}

    return uid;
  }, []);

  const combinedPosts = useMemo(() => [...postsLatest, ...postsOlder], [postsLatest, postsOlder]);

  const postsRefForSchool = async () => {
    const sk = await AsyncStorage.getItem("schoolKey");
    if (sk) return ref(database, `Platform1/Schools/${sk}/Posts`);
    return ref(database, "Posts");
  };

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
    allKeys.forEach((k) => {
      adminCacheRef.current[k] = payload;
    });
  }, []);

  const resolvePosterForPost = useCallback(async (postData, schoolKey) => {
    const keys = [postData?.adminId, postData?.userId, postData?.createdBy].filter(Boolean);
    if (!keys.length) return;

    const cached = keys.find((k) => adminCacheRef.current[k]);
    if (cached) return;

    for (const key of keys) {
      try {
        const byUserId = await queryUserByChildInSchool("userId", key, schoolKey);
        if (byUserId && byUserId.exists()) {
          let found = false;
          byUserId.forEach((c) => {
            cacheResolvedPoster(keys, c.val(), c.key, schoolKey);
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
          byUsername.forEach((c) => {
            cacheResolvedPoster(keys, c.val(), c.key, schoolKey);
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

  // helper: targetRole filtering
  const isStudentVisiblePost = (data) => {
    // your new schema uses targetRole
    const raw = data?.targetRole ?? data?.target ?? "all";
    const role = String(raw).toLowerCase().trim();
    // allow missing as all
    if (!raw) return true;
    return role === "all" || role === "student";
  };

  useEffect(() => {
    let unsubscribe = null;
    let mounted = true;

    (async () => {
      const currentUserId = await loadUserContext();
      const postsRef = await postsRefForSchool();
      const postsQuery = query(postsRef, orderByChild("time"), limitToLast(PAGE_SIZE));
      postsQueryRef.current = postsQuery;

      unsubscribe = onValue(
        postsQuery,
        async (snap) => {
          if (!mounted) return;
          if (!snap.exists()) {
            setPostsLatest([]);
            setPostsOlder([]);
            setHasMore(false);
            setLoading(false);
            return;
          }

          const tmp = [];
          snap.forEach((child) => {
            const val = child.val();
            tmp.push({ postId: val.postId || child.key, data: val });
          });

          tmp.sort((a, b) => {
            const ta = a.data.time ? new Date(a.data.time).getTime() : 0;
            const tb = b.data.time ? new Date(b.data.time).getTime() : 0;
            return tb - ta;
          });

          // FEATURE #1: targetRole filter for student
          const filteredTmp = tmp.filter((p) => isStudentVisiblePost(p.data));

          const schoolKey = await AsyncStorage.getItem("schoolKey");

          await Promise.all(filteredTmp.map((p) => resolvePosterForPost(p.data, schoolKey)));

          const enriched = filteredTmp.map((p) => {
            const likesNode = p.data.likes || {};
            const seenNode = p.data.seenBy || {};

            if (currentUserId && !seenNode[currentUserId]) {
              (async () => {
                try {
                  const sk = await AsyncStorage.getItem("schoolKey");
                  const postPath = sk ? `Platform1/Schools/${sk}/Posts/${p.postId}` : `Posts/${p.postId}`;
                  const updates = {};
                  updates[`${postPath}/seenBy/${currentUserId}`] = true;
                  update(ref(database), updates).catch(() => {});
                } catch {}
              })();
              seenNode[currentUserId] = true;
            }

            const admin =
              adminCacheRef.current[p.data.adminId] ||
              adminCacheRef.current[p.data.userId] ||
              null;
            return { postId: p.postId, data: p.data, admin, likesMap: likesNode, seenMap: seenNode };
          });

          enriched.forEach((e) => {
            const safePostImage = normalizeProfileImageUri(e.data.postUrl);
            const safeAdminImage = normalizeProfileImageUri(extractProfileImage(e.admin));
            if (safePostImage) Image.prefetch(safePostImage).catch(() => {});
            if (safeAdminImage) Image.prefetch(safeAdminImage).catch(() => {});
          });

          if (mounted) {
            setPostsLatest(enriched);
            setPostsOlder((prevOlder) => prevOlder.filter((o) => !enriched.some((el) => el.postId === o.postId)));
            setHasMore(true);
            setLoading(false);
            setRefreshing(false);
          }
        },
        (err) => {
          console.warn("Posts listener error:", err);
          if (mounted) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      );
    })();

    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
      if (postsQueryRef.current) off(postsQueryRef.current);
    };
  }, [loadUserContext, resolvePosterForPost]);

  const onRefresh = async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 700);
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const combined = [...postsLatest, ...postsOlder];
      if (combined.length === 0) {
        setHasMore(false);
        setLoadingMore(false);
        return;
      }
      const oldest = combined[combined.length - 1];
      const oldestTime = oldest.data.time;
      if (!oldestTime) {
        setHasMore(false);
        setLoadingMore(false);
        return;
      }

      const postsRef = await postsRefForSchool();
      const q = query(postsRef, orderByChild("time"), endAt(oldestTime), limitToLast(PAGE_SIZE + 1));
      const snap = await get(q);
      if (!snap.exists()) {
        setHasMore(false);
        setLoadingMore(false);
        return;
      }

      const tmp = [];
      snap.forEach((child) => {
        const val = child.val();
        tmp.push({ postId: val.postId || child.key, data: val });
      });

      tmp.sort((a, b) => {
        const ta = a.data.time ? new Date(a.data.time).getTime() : 0;
        const tb = b.data.time ? new Date(b.data.time).getTime() : 0;
        return tb - ta;
      });

      const filteredTmp = tmp.filter((p) => p.postId !== oldest.postId);

      // FEATURE #1 filter for older pages too
      const filteredByTarget = filteredTmp.filter((p) => isStudentVisiblePost(p.data));

      if (filteredByTarget.length === 0) {
        setHasMore(false);
        setLoadingMore(false);
        return;
      }

      const schoolKey = await AsyncStorage.getItem("schoolKey");

      await Promise.all(filteredByTarget.map((p) => resolvePosterForPost(p.data, schoolKey)));

      const enrichedOlder = filteredByTarget.map((p) => {
        const likesNode = p.data.likes || {};
        const seenNode = p.data.seenBy || {};
        const admin =
          adminCacheRef.current[p.data.adminId] ||
          adminCacheRef.current[p.data.userId] ||
          null;
        return { postId: p.postId, data: p.data, admin, likesMap: likesNode, seenMap: seenNode };
      });

      enrichedOlder.forEach((e) => {
        const safePostImage = normalizeProfileImageUri(e.data.postUrl);
        const safeAdminImage = normalizeProfileImageUri(extractProfileImage(e.admin));
        if (safePostImage) Image.prefetch(safePostImage).catch(() => {});
        if (safeAdminImage) Image.prefetch(safeAdminImage).catch(() => {});
      });

      setPostsOlder((prev) => {
        const existingIds = new Set(prev.map((p) => p.postId).concat(postsLatest.map((p) => p.postId)));
        const toAdd = enrichedOlder.filter((p) => !existingIds.has(p.postId));
        const newOlder = [...prev, ...toAdd];
        if (enrichedOlder.length < PAGE_SIZE) setHasMore(false);
        return newOlder;
      });
    } catch (err) {
      console.warn("loadMore error:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleLike = async (postId) => {
    const uid = userId || (await loadUserContext());
    if (!uid) {
      Alert.alert("Not signed in", "You must be signed in to like posts.");
      return;
    }

    const findPost = () => {
      let p = postsLatest.find((x) => x.postId === postId);
      if (p) return { which: "latest", p };
      p = postsOlder.find((x) => x.postId === postId);
      if (p) return { which: "older", p };
      return null;
    };

    const found = findPost();
    if (!found) return;
    const currentlyLiked = !!(found.p.likesMap && found.p.likesMap[uid]);

    const optimisticUpdater = (post) => {
      const likes = { ...(post.likesMap || {}) };
      if (currentlyLiked) delete likes[uid];
      else likes[uid] = true;
      return { ...post, likesMap: likes, data: { ...post.data, likeCount: Object.keys(likes).length } };
    };

    if (found.which === "latest") setPostsLatest((prev) => prev.map((p) => (p.postId === postId ? optimisticUpdater(p) : p)));
    else setPostsOlder((prev) => prev.map((p) => (p.postId === postId ? optimisticUpdater(p) : p)));

    try {
      const sk = await AsyncStorage.getItem("schoolKey");
      const postRef = sk ? ref(database, `Platform1/Schools/${sk}/Posts/${postId}`) : ref(database, `Posts/${postId}`);
      await runTransaction(postRef, (current) => {
        if (current === null) return current;
        if (!current.likes) current.likes = {};
        if (!current.likeCount) current.likeCount = 0;
        const likedBefore = !!current.likes[uid];
        if (likedBefore) {
          if (current.likes && current.likes[uid]) delete current.likes[uid];
          current.likeCount = Math.max(0, (current.likeCount || 1) - 1);
        } else {
          current.likes[uid] = true;
          current.likeCount = (current.likeCount || 0) + 1;
        }
        return current;
      });
    } catch (err) {
      console.warn("runTransaction failed for like:", err);
      try {
        const sk = await AsyncStorage.getItem("schoolKey");
        const pRef = sk ? ref(database, `Platform1/Schools/${sk}/Posts/${postId}`) : ref(database, `Posts/${postId}`);
        const snap = await get(pRef);
        if (snap.exists()) {
          const val = snap.val();
          const updated = { postId: val.postId || postId, data: val, likesMap: val.likes || {}, seenMap: val.seenBy || {} };
          setPostsLatest((prev) => prev.map((p) => (p.postId === postId ? updated : p)));
          setPostsOlder((prev) => prev.map((p) => (p.postId === postId ? updated : p)));
        }
      } catch {}
      Alert.alert("Error", "Unable to update like. Please try again.");
    }
  };

  const toggleDescription = useCallback((postId) => {
    setExpandedDescriptions((prev) => ({
      ...prev,
      [postId]: !prev[postId],
    }));
  }, []);

  const closePostMenu = useCallback(() => {
    setPostMenuPostId(null);
  }, []);

  const openPostMenu = useCallback((postId) => {
    setPostMenuPostId(postId);
  }, []);

  const handleReportPost = useCallback(() => {
    (async () => {
      const uid = userId || (await loadUserContext());
      const postId = postMenuPostId;

      closePostMenu();

      if (!uid) {
        Alert.alert("Not signed in", "You must be signed in to report posts.");
        return;
      }

      if (!postId) return;

      try {
        const schoolKey = await AsyncStorage.getItem("schoolKey");
        const reportPath = schoolKey
          ? `Platform1/Schools/${schoolKey}/Posts/${postId}/reportBy/${uid}`
          : `Posts/${postId}/reportBy/${uid}`;

        const updates = {};
        updates[reportPath] = true;
        await update(ref(database), updates);

        Alert.alert("Report", "This post has been reported.");
      } catch (error) {
        console.warn("report post failed:", error);
        Alert.alert("Error", "Unable to report this post. Please try again.");
      }
    })();
  }, [closePostMenu, loadUserContext, postMenuPostId, userId]);

  const handleAboutAccount = useCallback(() => {
    const selectedPost = combinedPosts.find((post) => post.postId === postMenuPostId);
    closePostMenu();

    if (!selectedPost) return;

    const accountName = getPosterName(selectedPost.admin, selectedPost.data);
    const targetRole = formatTargetRoleLabel(selectedPost.data);

    Alert.alert("About this account", `Posted by ${accountName}\nAudience: ${targetRole}`);
  }, [combinedPosts, postMenuPostId, closePostMenu]);

  const handleDownloadPost = useCallback(async () => {
    const selectedPost = combinedPosts.find((post) => post.postId === postMenuPostId);
    closePostMenu();

    const downloadableUrl = normalizeProfileImageUri(selectedPost?.data?.postUrl);
    if (!downloadableUrl) {
      Alert.alert("Download", "This post does not have an image to download.");
      return;
    }

    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Permission needed", "Allow photo access to save downloaded images.");
        return;
      }

      const ext = getFileExtensionFromUrl(downloadableUrl);
      const fileName = `gojo-post-${selectedPost.postId || Date.now()}.${ext}`;
      const downloadPath = `${FileSystem.cacheDirectory}${fileName}`;

      await FileSystem.downloadAsync(downloadableUrl, downloadPath);
      await MediaLibrary.saveToLibraryAsync(downloadPath);
      await FileSystem.deleteAsync(downloadPath, { idempotent: true });

      Alert.alert("Download", "Image saved to your gallery.");
    } catch (error) {
      console.warn("download post failed:", error);
      Alert.alert("Error", "Unable to download this image. Please try again.");
    }
  }, [combinedPosts, postMenuPostId, closePostMenu]);

  function PostCard({ item }) {
    const { postId, data, admin, likesMap = {}, seenMap = {} } = item;
    const likesCount = data.likeCount || Object.keys(likesMap || {}).length;
    const isLiked = userId ? !!likesMap[userId] : false;
    const imageUri = normalizeProfileImageUri(data.postUrl);
    const message = String(data.message || "").trim();
    const targetRoleLabel = formatTargetRoleLabel(data);
    const posterName = getPosterName(admin, data);
    const posterImage = getPosterImage(admin, data);
    const isExpanded = !!expandedDescriptions[postId];
    const shouldTruncate = message.length > DESCRIPTION_PREVIEW_LENGTH;
    const previewMessage = shouldTruncate && !isExpanded
      ? `${message.slice(0, DESCRIPTION_PREVIEW_LENGTH).trimEnd()}...`
      : message;

    const scale = useRef(new Animated.Value(1)).current;
    const animateHeart = () => {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.18, duration: 140, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0, duration: 140, useNativeDriver: true }),
      ]).start();
    };
    const onHeartPress = () => {
      animateHeart();
      toggleLike(postId);
    };

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Image
            source={posterImage ? { uri: posterImage } : require("../../assets/images/avatar_placeholder.png")}
            style={styles.avatar}
          />
          <View style={styles.headerTextWrap}>
            <Text style={styles.username}>{posterName}</Text>
            <View style={styles.headerMetaRow}>
              <Text style={styles.time}>{timeAgo(data.time)}</Text>
              <Text style={styles.headerDot}>·</Text>
              <Text style={styles.targetRoleText}>{targetRoleLabel}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.moreBtn} activeOpacity={0.8} onPress={() => openPostMenu(postId)}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.muted} />
          </TouchableOpacity>
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
            <Image source={{ uri: imageUri }} style={styles.postImage} resizeMode="cover" />
          </TouchableOpacity>
        ) : null}

        <View style={styles.reactionsSummary}>
          <View style={styles.reactionsLeft}>
            <Text style={styles.reactionCountText}>{likesCount} {likesCount === 1 ? "like" : "likes"}</Text>
          </View>
          <TouchableOpacity style={styles.likeIconOnlyBtn} activeOpacity={0.85} onPress={onHeartPress}>
            <Animated.View style={{ transform: [{ scale }] }}>
              <Ionicons name={isLiked ? "heart" : "heart-outline"} size={24} color={isLiked ? "#ED4956" : colors.text} />
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const EmptyState = () => (
    <View style={styles.emptyContainer}>
      {(() => {
        try {
          return <Image source={require("../../assets/images/no_data_illustrator.jpg")} style={styles.emptyImage} resizeMode="contain" />;
        } catch {
          return (
            <View style={styles.emptyFallbackIcon}>
              <Ionicons name="newspaper-outline" size={48} color="#B0B8D8" />
            </View>
          );
        }
      })()}
      <Text style={styles.emptyTitle}>No posts yet</Text>
      <Text style={styles.emptySubtitle}>Announcements from your school will appear here.</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!combinedPosts || combinedPosts.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <EmptyState />
      </View>
    );
  }

  const ListFooter = () => {
    if (loadingMore) return <ActivityIndicator style={{ margin: 16 }} color={colors.primary} />;
    if (!hasMore) return <Text style={{ textAlign: "center", color: colors.muted, padding: 12 }}>No more posts</Text>;
    return null;
  };

  return (
    <>
      <FlatList
        data={combinedPosts}
        keyExtractor={(i) => i.postId}
        renderItem={({ item }) => <PostCard item={item} />}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (!loadingMore && hasMore) loadMore();
        }}
        ListFooterComponent={<ListFooter />}
      />

      <Modal visible={!!postMenuPostId} transparent animationType="fade" onRequestClose={closePostMenu}>
        <View style={styles.menuOverlay}>
          <Pressable style={styles.menuBackdrop} onPress={closePostMenu} />
          <View style={styles.menuSheetWrap}>
            <View style={styles.menuSheetHandle} />
            <View style={styles.menuSheet}>
              <TouchableOpacity style={styles.menuItem} activeOpacity={0.85} onPress={handleAboutAccount}>
                <Ionicons name="information-circle-outline" size={20} color={colors.text} />
                <Text style={styles.menuItemText}>About this account</Text>
              </TouchableOpacity>
              <View style={styles.menuDivider} />
              <TouchableOpacity style={styles.menuItem} activeOpacity={0.85} onPress={handleDownloadPost}>
                <Ionicons name="download-outline" size={20} color={colors.text} />
                <Text style={styles.menuItemText}>Download</Text>
              </TouchableOpacity>
              <View style={styles.menuDivider} />
              <TouchableOpacity style={styles.menuItem} activeOpacity={0.85} onPress={handleReportPost}>
                <Ionicons name="flag-outline" size={20} color="#ED4956" />
                <Text style={[styles.menuItemText, styles.menuItemDanger]}>Report</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* FEATURE #2: full-screen image modal */}
      <Modal visible={viewerVisible} transparent animationType="fade" onRequestClose={() => setViewerVisible(false)}>
        <View style={styles.viewerBg}>
          <View style={styles.viewerTop}>
            <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerVisible(false)}>
              <Ionicons name="close" size={26} color={colors.white} />
            </TouchableOpacity>
          </View>
          <Pressable style={{ flex: 1, width: "100%" }} onPress={() => setViewerVisible(false)}>
            {viewerImage ? (
              <Image source={{ uri: viewerImage }} style={styles.viewerImage} resizeMode="contain" />
            ) : null}
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
  list: { paddingVertical: 10, backgroundColor: colors.feedBackground },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: colors.feedBackground },
  card: {
    backgroundColor: colors.card,
    marginBottom: 10,
    overflow: "hidden",
    borderRadius: 0,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: colors.surfaceMuted,
  },

  headerTextWrap: { flex: 1 },
  username: { fontWeight: "700", color: colors.text, fontSize: 15 },
  headerMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  time: { color: colors.muted, fontSize: 12 },
  headerDot: { color: colors.muted, fontSize: 12, marginHorizontal: 4 },
  targetRoleText: { color: colors.muted, fontSize: 12 },
  moreBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  messageWrap: { paddingHorizontal: 12, paddingBottom: 10 },
  messageText: { color: colors.text, lineHeight: 20, fontSize: 15 },
  seeMoreText: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 4,
  },

  postImage: {
    width: "100%",
    height: IMAGE_HEIGHT,
    backgroundColor: "#DDD",
  },
  reactionsSummary: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  reactionsLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  reactionCountText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  likeIconOnlyBtn: {
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  menuBackdrop: {
    flex: 1,
  },
  menuSheetWrap: {
    paddingHorizontal: 8,
    paddingBottom: 10,
  },
  menuSheetHandle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.7)",
    marginBottom: 10,
  },
  menuSheet: {
    backgroundColor: colors.card,
    borderRadius: 22,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 12,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  menuItemText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  menuItemDanger: {
    color: "#ED4956",
  },
  menuDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 18,
  },

  emptyContainer: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 28 },
  emptyImage: { width: 220, height: 160, marginBottom: 18 },
  emptyFallbackIcon: { width: 120, height: 120, borderRadius: 60, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: "#222", marginBottom: 6 },
  emptySubtitle: { fontSize: 14, color: colors.muted, textAlign: "center" },

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
  viewerImage: {
    width: "100%",
    height: "100%",
  },
});
}