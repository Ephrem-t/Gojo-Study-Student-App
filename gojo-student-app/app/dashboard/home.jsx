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

/**
 * Home feed with pagination ("load more") for older posts.
 * Added:
 * 1) Student-target filter uses targetRole: only "all" or "student" (or missing => all)
 * 2) Image tap opens full-screen viewer
 */

const SCREEN_WIDTH = Dimensions.get("window").width;
const IMAGE_HEIGHT = Math.round(SCREEN_WIDTH * 0.9 * 0.65);
const PAGE_SIZE = 20;

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

export default function HomeScreen() {
  const [postsLatest, setPostsLatest] = useState([]);
  const [postsOlder, setPostsOlder] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [userId, setUserId] = useState(null);

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
        if (u.profileImage) {
          await AsyncStorage.setItem("profileImage", u.profileImage);
          Image.prefetch(u.profileImage).catch(() => {});
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

          const adminIds = Array.from(new Set(filteredTmp.map((p) => p.data.adminId).filter(Boolean)));
          const schoolKey = await AsyncStorage.getItem("schoolKey");

          await Promise.all(
            adminIds.map(async (aid) => {
              if (adminCacheRef.current[aid]) return;
              try {
                let snapUser = null;
                try {
                  snapUser = await queryUserByUsernameInSchool(aid, schoolKey);
                } catch {
                  snapUser = null;
                }

                if (snapUser && snapUser.exists()) {
                  snapUser.forEach((c) => {
                    adminCacheRef.current[aid] = { ...c.val(), _nodeKey: c.key, _schoolKey: schoolKey || null };
                    return true;
                  });
                  return;
                }

                try {
                  const snapByUserId = await queryUserByChildInSchool("userId", aid, schoolKey);
                  if (snapByUserId && snapByUserId.exists()) {
                    snapByUserId.forEach((c) => {
                      adminCacheRef.current[aid] = { ...c.val(), _nodeKey: c.key, _schoolKey: schoolKey || null };
                      return true;
                    });
                    return;
                  }
                } catch {}

                try {
                  const qGlobal = query(ref(database, "Users"), orderByChild("username"), equalTo(aid));
                  const sGlobal = await get(qGlobal);
                  if (sGlobal.exists()) {
                    sGlobal.forEach((c) => {
                      adminCacheRef.current[aid] = { ...c.val(), _nodeKey: c.key, _schoolKey: null };
                      return true;
                    });
                    return;
                  }
                  const qGlobal2 = query(ref(database, "Users"), orderByChild("userId"), equalTo(aid));
                  const sGlobal2 = await get(qGlobal2);
                  if (sGlobal2.exists()) {
                    sGlobal2.forEach((c) => {
                      adminCacheRef.current[aid] = { ...c.val(), _nodeKey: c.key, _schoolKey: null };
                      return true;
                    });
                    return;
                  }
                } catch {}
              } catch {}
            })
          );

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

            const admin = adminCacheRef.current[p.data.adminId] || null;
            return { postId: p.postId, data: p.data, admin, likesMap: likesNode, seenMap: seenNode };
          });

          enriched.forEach((e) => {
            if (e.data.postUrl) Image.prefetch(e.data.postUrl).catch(() => {});
            if (e.admin && e.admin.profileImage) Image.prefetch(e.admin.profileImage).catch(() => {});
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
  }, [loadUserContext]);

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

      const adminIds = Array.from(new Set(filteredByTarget.map((p) => p.data.adminId).filter(Boolean)));
      const schoolKey = await AsyncStorage.getItem("schoolKey");

      await Promise.all(
        adminIds.map(async (aid) => {
          if (adminCacheRef.current[aid]) return;
          try {
            let snapUser = null;
            try {
              snapUser = await queryUserByUsernameInSchool(aid, schoolKey);
            } catch {
              snapUser = null;
            }
            if (snapUser && snapUser.exists()) {
              snapUser.forEach((c) => {
                adminCacheRef.current[aid] = { ...c.val(), _nodeKey: c.key, _schoolKey: schoolKey || null };
                return true;
              });
              return;
            }

            try {
              const snapByUserId = await queryUserByChildInSchool("userId", aid, schoolKey);
              if (snapByUserId && snapByUserId.exists()) {
                snapByUserId.forEach((c) => {
                  adminCacheRef.current[aid] = { ...c.val(), _nodeKey: c.key, _schoolKey: schoolKey || null };
                  return true;
                });
                return;
              }
            } catch {}

            try {
              const qGlobal = query(ref(database, "Users"), orderByChild("username"), equalTo(aid));
              const sGlobal = await get(qGlobal);
              if (sGlobal.exists()) {
                sGlobal.forEach((c) => {
                  adminCacheRef.current[aid] = { ...c.val(), _nodeKey: c.key, _schoolKey: null };
                  return true;
                });
                return;
              }
              const qGlobal2 = query(ref(database, "Users"), orderByChild("userId"), equalTo(aid));
              const sGlobal2 = await get(qGlobal2);
              if (sGlobal2.exists()) {
                sGlobal2.forEach((c) => {
                  adminCacheRef.current[aid] = { ...c.val(), _nodeKey: c.key, _schoolKey: null };
                  return true;
                });
                return;
              }
            } catch {}
          } catch {}
        })
      );

      const enrichedOlder = filteredByTarget.map((p) => {
        const likesNode = p.data.likes || {};
        const seenNode = p.data.seenBy || {};
        const admin = adminCacheRef.current[p.data.adminId] || null;
        return { postId: p.postId, data: p.data, admin, likesMap: likesNode, seenMap: seenNode };
      });

      enrichedOlder.forEach((e) => {
        if (e.data.postUrl) Image.prefetch(e.data.postUrl).catch(() => {});
        if (e.admin && e.admin.profileImage) Image.prefetch(e.admin.profileImage).catch(() => {});
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

  function PostCard({ item }) {
    const { postId, data, admin, likesMap = {}, seenMap = {} } = item;
    const likesCount = data.likeCount || Object.keys(likesMap || {}).length;
    const seenCount = Object.keys(seenMap || {}).length;
    const isLiked = userId ? !!likesMap[userId] : false;
    const imageUri = data.postUrl || null;

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
            source={(admin && admin.profileImage) ? { uri: admin.profileImage } : require("../../assets/images/avatar_placeholder.png")}
            style={styles.avatar}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.username}>{admin?.name || admin?.username || "School Admin"}</Text>
            <Text style={styles.time}>{timeAgo(data.time)}</Text>
          </View>
        </View>

        {/* FEATURE #2: tap to open large view */}
        {imageUri ? (
          <TouchableOpacity activeOpacity={0.95} onPress={() => { setViewerImage(imageUri); setViewerVisible(true); }}>
            <Image source={{ uri: imageUri }} style={styles.postImage} resizeMode="cover" />
          </TouchableOpacity>
        ) : null}

        <View style={styles.actionsRow}>
          <View style={styles.leftActions}>
            <TouchableOpacity onPress={onHeartPress} style={styles.iconBtn} activeOpacity={0.8}>
              <Animated.View style={{ transform: [{ scale }] }}>
                <Ionicons name={isLiked ? "heart" : "heart-outline"} size={28} color={isLiked ? "#E0245E" : "#111"} />
              </Animated.View>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.meta}>
          <Text style={styles.likesText}>{likesCount} {likesCount === 1 ? "like" : "likes"}</Text>
          <Text style={styles.messageText}>
            <Text style={styles.username}>{admin?.username || admin?.name || ""}</Text>
            {"  "}
            {data.message}
          </Text>
          <View style={styles.bottomMetaRow}>
            <Text style={styles.seenText}>{seenCount} seen</Text>
            <Text style={styles.timeSmall}> • {new Date(data.time).toLocaleString?.() ?? ""}</Text>
          </View>
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
        <ActivityIndicator size="large" color="#007AFB" />
      </View>
    );
  }

  if (!combinedPosts || combinedPosts.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: "#fff" }}>
        <EmptyState />
      </View>
    );
  }

  const ListFooter = () => {
    if (loadingMore) return <ActivityIndicator style={{ margin: 16 }} color="#007AFB" />;
    if (!hasMore) return <Text style={{ textAlign: "center", color: "#888", padding: 12 }}>No more posts</Text>;
    return null;
  };

  return (
    <>
      <FlatList
        data={combinedPosts}
        keyExtractor={(i) => i.postId}
        renderItem={({ item }) => <PostCard item={item} />}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#007AFB"]} />}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (!loadingMore && hasMore) loadMore();
        }}
        ListFooterComponent={<ListFooter />}
      />

      {/* FEATURE #2: full-screen image modal */}
      <Modal visible={viewerVisible} transparent animationType="fade" onRequestClose={() => setViewerVisible(false)}>
        <View style={styles.viewerBg}>
          <View style={styles.viewerTop}>
            <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerVisible(false)}>
              <Ionicons name="close" size={26} color="#fff" />
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

const styles = StyleSheet.create({
  list: { paddingVertical: 12, paddingHorizontal: 12, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "#fff" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 16,
    overflow: "hidden",
    borderColor: "#F1F3F8",
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, marginRight: 10, backgroundColor: "#F6F8FF" },

  username: { fontWeight: "700", color: "#111" },
  time: { color: "#888", fontSize: 12, marginTop: 2 },

  postImage: {
    width: "100%",
    height: IMAGE_HEIGHT,
    backgroundColor: "#EEE",
  },

  actionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center",
  },
  leftActions: { flexDirection: "row", alignItems: "center" },

  iconBtn: { padding: 6 },

  meta: { paddingHorizontal: 12, paddingBottom: 12 },
  likesText: { fontWeight: "700", marginBottom: 6, color: "#111" },
  messageText: { color: "#222", lineHeight: 20 },

  bottomMetaRow: { flexDirection: "row", marginTop: 8, alignItems: "center" },
  seenText: { color: "#888", fontSize: 12 },
  timeSmall: { color: "#888", fontSize: 12 },

  emptyContainer: { flex: 1, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", padding: 28 },
  emptyImage: { width: 220, height: 160, marginBottom: 18 },
  emptyFallbackIcon: { width: 120, height: 120, borderRadius: 60, backgroundColor: "#F6F8FF", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: "#222", marginBottom: 6 },
  emptySubtitle: { fontSize: 14, color: "#8B93B3", textAlign: "center" },

  viewerBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
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