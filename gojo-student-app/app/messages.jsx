// app/messages.jsx
import React, { useCallback, useEffect, useState, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  StatusBar,
  TextInput,
  Platform,
  Alert,
  Modal,
  KeyboardAvoidingView,
  InteractionManager,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ref, push, update, get, onValue, off, runTransaction } from "../lib/offlineDatabase";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import * as ImagePicker from "expo-image-picker";
import { database } from "../constants/firebaseConfig";
import { getOpenedChat, clearOpenedChat } from "./lib/chatStore";
import { SafeAreaView } from "react-native-safe-area-context";
// school-aware helpers
import { getUserVal } from "./lib/userHelpers";
import { useAppTheme } from "../hooks/use-app-theme";
import PageLoadingSkeleton from "../components/ui/page-loading-skeleton";
import { extractProfileImage, normalizeProfileImageUri } from "./lib/profileImage";
import { persistChatMessages, persistChatsCache, readCachedChatMessages, readChatsCache } from "../lib/chatCache";
import { queueChatImageUpload, readPendingChatMessages } from "../lib/mediaUploadQueue";

/**
 * app/messages.jsx
 * - Uses school-aware getUserVal for all Users lookups so code works with:
 *     Platform1/Schools/{schoolKey}/Users/{nodeKey}
 *   (and falls back to root /Users if no schoolKey saved).
 *
 * - Uses school-aware Chats path when schoolKey is present:
 *     Platform1/Schools/{schoolKey}/Chats/{chatId}
 *
 * Notes:
 * - Avoids inline `await` inside template literals — builds a prefix string first.
 */

const AVATAR_PLACEHOLDER = require("../assets/images/avatar_placeholder.png");

function fmtTime12(ts) {
  if (!ts) return "";
  try {
    const d = new Date(Number(ts));
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  } catch {
    return "";
  }
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function dateLabelForTs(ts) {
  if (!ts) return "";
  const date = new Date(Number(ts));
  const today = new Date();
  const diffDays = Math.floor((stripTime(today) - stripTime(date)) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString();
}

// return prefix path (empty or "Platform1/Schools/{schoolKey}/")
async function getPathPrefix() {
  const sk = (await AsyncStorage.getItem("schoolKey")) || null;
  return sk ? `Platform1/Schools/${sk}/` : "";
}

// return a ref for a subpath (school-aware)
async function getDbRef(subPath) {
  const prefix = await getPathPrefix();
  return ref(database, `${prefix}${subPath}`);
}

function mergeMessagesWithPending(messages = [], pendingMessages = []) {
  const mergedById = new Map();

  (Array.isArray(messages) ? messages : []).forEach((message) => {
    const fallbackKey = `${message?.timeStamp || 0}:${message?.senderId || ""}:${message?.imageUrl || message?.text || ""}`;
    mergedById.set(String(message?.messageId || fallbackKey), message);
  });

  (Array.isArray(pendingMessages) ? pendingMessages : []).forEach((message) => {
    const fallbackKey = `${message?.timeStamp || 0}:${message?.senderId || ""}:${message?.imageUrl || message?.text || ""}`;
    const mergedKey = String(message?.messageId || fallbackKey);
    if (!mergedById.has(mergedKey)) {
      mergedById.set(mergedKey, message);
    }
  });

  return Array.from(mergedById.values()).sort(
    (left, right) => Number(left?.timeStamp || 0) - Number(right?.timeStamp || 0)
  );
}

function isRetryableUploadError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();

  return (
    code.includes("network") ||
    code.includes("storage/") ||
    message.includes("network") ||
    message.includes("offline") ||
    message.includes("timeout") ||
    message.includes("disconnected") ||
    message.includes("failed to get")
  );
}

export default function MessagesScreen(props) {
  const router = useRouter();
  const storage = getStorage();
  const { colors, statusBarStyle } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const MUTED = colors.muted;

  const opened = getOpenedChat() || {};
  const routeParams = (props && props.route && props.route.params) ? props.route.params : {};
  const chatFromStore = {
    chatId: opened.chatId ?? routeParams.chatId ?? "",
    contactKey: opened.contactKey ?? routeParams.contactKey ?? "",
    contactUserId: opened.contactUserId ?? routeParams.contactUserId ?? "",
    contactName: opened.contactName ?? routeParams.contactName ?? "",
    contactImage: opened.contactImage ?? routeParams.contactImage ?? null,
  };
  clearOpenedChat();

  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserNodeKey, setCurrentUserNodeKey] = useState(null);
  const [chatId, setChatId] = useState(chatFromStore.chatId || "");
  const [contactUserId, setContactUserId] = useState(chatFromStore.contactUserId || "");
  const [contactKey] = useState(chatFromStore.contactKey || "");
  const [contactName, setContactName] = useState(chatFromStore.contactName || "");
  const [contactImage, setContactImage] = useState(chatFromStore.contactImage || null);
  const [contactSubtitle, setContactSubtitle] = useState(""); // subject/role to show under name

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [lastMessageMeta, setLastMessageMeta] = useState(null);

  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState([]);
  const [viewerFallbackUri, setViewerFallbackUri] = useState(null);
  const safeContactImage = useMemo(() => normalizeProfileImageUri(contactImage), [contactImage]);

  const messagesRefRef = useRef(null);
  const lastMessageRefRef = useRef(null);
  const flatListRef = useRef(null);

  const makeDeterministicChatId = (a, b) => `${a}_${b}`;

  // Resolve local ids (use school-aware helper)
  useEffect(() => {
    let mounted = true;
    (async () => {
      let uId = await AsyncStorage.getItem("userId");
      const nodeKey =
        (await AsyncStorage.getItem("userNodeKey")) ||
        (await AsyncStorage.getItem("studentNodeKey")) ||
        (await AsyncStorage.getItem("studentId")) ||
        null;

      if (!uId && nodeKey) {
        try {
          const uVal = await getUserVal(nodeKey);
          if (uVal) {
            uId = uVal.userId || nodeKey;
          } else {
            uId = nodeKey;
          }
        } catch {
          uId = nodeKey;
        }
      }

      if (mounted) {
        setCurrentUserId(uId || null);
        setCurrentUserNodeKey(nodeKey || null);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Resolve contactUserId & subtitle (subject/role) if missing - use getUserVal
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!contactKey) return;
      try {
        const v = await getUserVal(contactKey);
        if (v && mounted) {
          if (v.userId) setContactUserId(v.userId);
          setContactName((prev) => prev || v.name || v.username || "");
          setContactImage((prev) => prev || extractProfileImage(v));
          const subtitle = (v.subject && String(v.subject).trim()) ? v.subject : (v.role || v.designation || "");
          setContactSubtitle(subtitle || "");
          return;
        }
      } catch {
        // ignore
      }
      if (mounted) setContactSubtitle("");
    })();
    return () => { mounted = false; };
  }, [contactKey]);

  // findOrCreateChatId
  const findOrCreateChatId = useCallback(async (userA, userB, createIfMissing = true) => {
    if (!userA || !userB) return null;
    const c1 = makeDeterministicChatId(userA, userB);
    const c2 = makeDeterministicChatId(userB, userA);
    try {
      const r1 = await getDbRef(`Chats/${c1}`);
      const s1 = await get(r1);
      if (s1.exists()) return c1;
      const r2 = await getDbRef(`Chats/${c2}`);
      const s2 = await get(r2);
      if (s2.exists()) return c2;
      if (!createIfMissing) return null;

      // create under school-aware prefix by building updates with prefix
      const prefix = await getPathPrefix();
      const now = Date.now();
      const participants = { [userA]: true, [userB]: true };
      const lastMessage = { seen: false, senderId: userA, text: "", timeStamp: now, type: "system" };
      const unread = { [userA]: 0, [userB]: 0 };
      const baseUpdates = {};
      baseUpdates[`${prefix}Chats/${c1}/participants`] = participants;
      baseUpdates[`${prefix}Chats/${c1}/lastMessage`] = lastMessage;
      baseUpdates[`${prefix}Chats/${c1}/unread`] = unread;
      await update(ref(database), baseUpdates);
      return c1;
    } catch (err) {
      console.warn("[Messages] findOrCreateChatId error", err);
      return null;
    }
  }, []);

  useEffect(() => {
    if (chatId || !currentUserId || !contactUserId) return undefined;

    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      findOrCreateChatId(currentUserId, contactUserId, false)
        .then((resolvedChatId) => {
          if (!cancelled && resolvedChatId) {
            setChatId(resolvedChatId);
          }
        })
        .catch((error) => {
          console.warn("[Messages] resolve existing chat error", error);
        });
    });

    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [chatId, contactUserId, currentUserId, findOrCreateChatId]);

  // Attach listener and normalize messages
  useEffect(() => {
    let mounted = true;

    const attach = async () => {
      if (!chatId) {
        setMessages([]);
        setLoading(false);
        return;
      }

      const [cachedMessages, pendingMessages] = await Promise.all([
        readCachedChatMessages(chatId),
        readPendingChatMessages(chatId),
      ]);
      const warmMessages = mergeMessagesWithPending(cachedMessages, pendingMessages);

      if (mounted && warmMessages.length) {
        setMessages(warmMessages);
        setLoading(false);
      } else {
        setLoading(true);
      }

      const msgsRef = await getDbRef(`Chats/${chatId}/messages`);
      messagesRefRef.current = msgsRef;

      const listener = onValue(msgsRef, (snap) => {
        if (!mounted) return;

        const nextMessages = [];
        if (snap.exists()) {
          snap.forEach((child) => {
            const data = child.val() || {};
            nextMessages.push({ ...data, messageId: data.messageId || child.key });
          });
        }

        nextMessages.sort((left, right) => Number(left.timeStamp || 0) - Number(right.timeStamp || 0));
        persistChatMessages(chatId, nextMessages, Date.now()).catch(() => {});
        readPendingChatMessages(chatId)
          .then((pendingSnapshot) => {
            if (!mounted) return;
            setMessages(mergeMessagesWithPending(nextMessages, pendingSnapshot));
            setLoading(false);
          })
          .catch(() => {
            if (!mounted) return;
            setMessages(nextMessages);
            setLoading(false);
          });

        const latestMessage = nextMessages[nextMessages.length - 1] || null;
        updateChatsCacheWithLastMessage({
          contactKeyLocal: contactKey || null,
          contactUserIdLocal: contactUserId || null,
          lastMessageText: latestMessage?.type === "image" ? "📷 Image" : (latestMessage?.text || ""),
          timeStamp: latestMessage?.timeStamp || Date.now(),
          lastSenderId: latestMessage?.senderId || null,
          lastSeen: latestMessage?.seen || false,
          unread: 0,
          chatKeyLocal: chatId,
        }).catch(() => {});

        if (currentUserId) {
          InteractionManager.runAfterInteractions(() => {
            void (async () => {
            try {
              const prefix = await getPathPrefix();
              const fullUpdates = {};
              const unreadCountSnap = await get(ref(database, `${prefix}Chats/${chatId}/unread/${currentUserId}`)).catch(() => null);
              const previousUnreadCount = unreadCountSnap?.exists()
                ? Math.max(0, Number(unreadCountSnap.val() || 0))
                : 0;

              if (previousUnreadCount > 0) {
                fullUpdates[`${prefix}Chats/${chatId}/unread/${currentUserId}`] = 0;
              }

              nextMessages.forEach((message) => {
                if ((String(message.receiverId) === String(currentUserId) || String(message.receiverId) === String(currentUserNodeKey)) && !message.seen) {
                  fullUpdates[`${prefix}Chats/${chatId}/messages/${message.messageId}/seen`] = true;
                }
              });

              if (Object.keys(fullUpdates).length) {
                await update(ref(database), fullUpdates);
              }

              if (previousUnreadCount > 0) {
                await decrementUnreadTotalNode(currentUserId, previousUnreadCount);
              }
            } catch (error) {
              console.warn("[Messages] mark seen error", error);
            }
            })();
          });
        }
      });

      messagesRefRef.current._listener = listener;
    };

    attach();

    return () => {
      mounted = false;
      if (messagesRefRef.current) {
        try { off(messagesRefRef.current); } catch {}
      }
    };
  }, [chatId, contactKey, contactUserId, currentUserId, currentUserNodeKey, decrementUnreadTotalNode, updateChatsCacheWithLastMessage]);

  useEffect(() => {
    if (!chatId) {
      setLastMessageMeta(null);
      return;
    }

    (async () => {
      const lastRef = await getDbRef(`Chats/${chatId}/lastMessage`);
      lastMessageRefRef.current = lastRef;
      onValue(lastRef, (snap) => {
        if (snap.exists()) setLastMessageMeta(snap.val());
        else setLastMessageMeta(null);
      });
    })();

    return () => {
      try { if (lastMessageRefRef.current) off(lastMessageRefRef.current); } catch {}
      lastMessageRefRef.current = null;
    };
  }, [chatId]);

  useEffect(() => {
    setTimeout(() => {
      try { flatListRef.current && flatListRef.current.scrollToEnd({ animated: true }); } catch {}
    }, 120);
  }, [messages]);

  const getResolvedUserId = async () => {
    if (currentUserId) return currentUserId;

    let userId = await AsyncStorage.getItem("userId");
    if (userId) return userId;

    const nodeKey =
      (await AsyncStorage.getItem("userNodeKey")) ||
      (await AsyncStorage.getItem("studentNodeKey")) ||
      (await AsyncStorage.getItem("studentId")) ||
      null;

    if (!nodeKey) return null;

    try {
      const userValue = await getUserVal(nodeKey);
      if (userValue) return userValue.userId || nodeKey;
    } catch {}

    return nodeKey;
  };

  const updateUnreadTotalNode = useCallback(async (targetUserId, updater) => {
    const normalizedUserId = String(targetUserId || "").trim();
    if (!normalizedUserId) return null;

    const prefix = await getPathPrefix();
    const unreadTotalRef = ref(database, `${prefix}ChatUnreadTotals/${normalizedUserId}`);
    const result = await runTransaction(unreadTotalRef, (current) => {
      const currentValue = Math.max(0, Number(current || 0));
      const nextValue = typeof updater === "function" ? updater(currentValue) : updater;
      return Math.max(0, Number(nextValue || 0));
    }).catch(() => null);

    if (!result?.snapshot?.exists?.()) return 0;
    return Math.max(0, Number(result.snapshot.val() || 0));
  }, []);

  const incrementUnreadTotalNode = useCallback(async (targetUserId, delta = 1) => {
    const amount = Math.max(0, Number(delta || 0));
    if (!amount) return null;
    return updateUnreadTotalNode(targetUserId, (current) => current + amount);
  }, [updateUnreadTotalNode]);

  const decrementUnreadTotalNode = useCallback(async (targetUserId, delta = 1) => {
    const amount = Math.max(0, Number(delta || 0));
    if (!amount) return null;
    return updateUnreadTotalNode(targetUserId, (current) => Math.max(0, current - amount));
  }, [updateUnreadTotalNode]);

  async function buildUnreadUpdates(chatKeyLocal, senderId, fallbackReceiverId = null) {
    const prefix = await getPathPrefix();
    const chatSnap = await get(await getDbRef(`Chats/${chatKeyLocal}`));
    const unreadObj = chatSnap.exists() ? chatSnap.child("unread").val() || {} : {};
    const unreadUpdates = {};
    const aggregateDeltas = {};

    if (chatSnap.exists()) {
      const participants = chatSnap.child("participants").val() || {};
      const participantIds = Object.keys(participants || {});

      if (!participantIds.length && fallbackReceiverId) {
        participantIds.push(String(fallbackReceiverId));
      }

      participantIds.forEach((participantId) => {
        if (!participantId) return;

        if (String(participantId) === String(senderId)) {
          unreadUpdates[`${prefix}Chats/${chatKeyLocal}/unread/${participantId}`] = 0;
          return;
        }

        const previousUnread = typeof unreadObj[participantId] === "number" ? unreadObj[participantId] : 0;
        unreadUpdates[`${prefix}Chats/${chatKeyLocal}/unread/${participantId}`] = previousUnread + 1;
        aggregateDeltas[participantId] = (aggregateDeltas[participantId] || 0) + 1;
      });
    }

    if (!Object.keys(unreadUpdates).length && fallbackReceiverId) {
      unreadUpdates[`${prefix}Chats/${chatKeyLocal}/unread/${fallbackReceiverId}`] =
        Math.max(0, Number(unreadObj?.[fallbackReceiverId] || 0)) + 1;
      unreadUpdates[`${prefix}Chats/${chatKeyLocal}/unread/${senderId}`] = 0;
      aggregateDeltas[fallbackReceiverId] = 1;
    }

    return {
      unreadUpdates,
      aggregateDeltas,
    };
  }

  const updateChatsCacheWithLastMessage = useCallback(async ({ contactKeyLocal, contactUserIdLocal, lastMessageText, timeStamp, lastSenderId = null, lastSeen = false, unread = null, chatKeyLocal = "" }) => {
    try {
      const cache = await readChatsCache();
      let updated = false;
      const tsNum = Number(timeStamp || Date.now());

      for (let index = 0; index < cache.length; index += 1) {
        const item = cache[index];
        if ((contactKeyLocal && item.key && String(item.key) === String(contactKeyLocal)) || (contactUserIdLocal && item.userId && String(item.userId) === String(contactUserIdLocal))) {
          const existingTs = Number(item.lastTime || 0);
          if (tsNum >= existingTs) {
            item.lastMessage = lastMessageText;
            item.lastTime = tsNum;
            item.lastSenderId = lastSenderId;
            item.lastSeen = !!lastSeen;
            if (chatKeyLocal) item.chatId = chatKeyLocal;
            if (unread != null) item.unread = Math.max(0, Number(unread || 0));
            cache[index] = item;
            updated = true;
          }
          break;
        }
      }

      if (!updated) {
        cache.unshift({
          key: contactKeyLocal || contactUserIdLocal || `u_${Date.now()}`,
          userId: contactUserIdLocal || "",
          name: contactName || "Conversation",
          role: "",
          profileImage: contactImage || null,
          type: "unknown",
          chatId: chatKeyLocal || chatId || "",
          lastMessage: lastMessageText,
          lastTime: tsNum,
          lastSenderId,
          lastSeen: !!lastSeen,
          unread: unread != null ? Math.max(0, Number(unread || 0)) : 0,
        });
        updated = true;
      }

      if (updated) {
        await persistChatsCache(cache, Date.now());
      }
    } catch (error) {
      console.warn("[Messages] updateChatsCacheWithLastMessage error", error);
    }
  }, [chatId, contactImage, contactName]);

  async function uriToBlob(uri) {
    return new Promise((resolve, reject) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.onload = function onLoad() {
          resolve(xhr.response);
        };
        xhr.onerror = function onError() {
          reject(new TypeError("Network request failed"));
        };
        xhr.responseType = "blob";
        xhr.open("GET", uri, true);
        xhr.send(null);
      } catch (error) {
        reject(error);
      }
    });
  }

  async function pickImageAndSend() {
    let localUri = null;
    let chatKeyLocal = chatId;
    let currentResolvedUserId = null;
    let messageId = null;
    let now = 0;

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission required", "Please allow access to photos to attach images.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsEditing: false,
      });

      const cancelled = result.cancelled ?? result.canceled;
      if (cancelled) return;

      localUri = result.uri ?? result.assets?.[0]?.uri;
      if (!localUri) return;

      currentResolvedUserId = await getResolvedUserId();
      if (!currentResolvedUserId) {
        Alert.alert("Missing user id", "Cannot determine current user id.");
        return;
      }

      if (!chatKeyLocal) {
        chatKeyLocal = await findOrCreateChatId(currentResolvedUserId, contactUserId, true);
        if (!chatKeyLocal) {
          Alert.alert("Chat error", "Could not find or create chat");
          return;
        }
        setChatId(chatKeyLocal);
      }

      messageId = push(await getDbRef(`Chats/${chatKeyLocal}/messages`)).key;
      now = Date.now();

      const localMessage = {
        messageId,
        senderId: currentResolvedUserId,
        receiverId: contactUserId,
        text: "",
        timeStamp: now,
        type: "image",
        imageUrl: localUri,
        uploading: true,
      };

      setMessages((prev) => mergeMessagesWithPending(prev, [localMessage]));

      updateChatsCacheWithLastMessage({
        contactKeyLocal: contactKey || null,
        contactUserIdLocal: contactUserId || null,
        lastMessageText: "📷 Image",
        timeStamp: now,
        lastSenderId: currentResolvedUserId,
        lastSeen: false,
        unread: 0,
        chatKeyLocal,
      }).catch(() => {});

      const blob = await uriToBlob(localUri);
      const prefix = await getPathPrefix();
      const storageReference = storageRef(storage, `chatImages/${chatKeyLocal}/${messageId}.jpg`);
      await uploadBytes(storageReference, blob);
      const downloadUrl = await getDownloadURL(storageReference);

      const messageObj = {
        messageId,
        senderId: currentResolvedUserId,
        receiverId: contactUserId,
        text: "",
        timeStamp: now,
        type: "image",
        imageUrl: downloadUrl,
        seen: false,
        edited: false,
        deleted: false,
      };

      const lastMessage = {
        seen: false,
        senderId: currentResolvedUserId,
        text: "📷 Image",
        timeStamp: now,
        type: "image",
      };

      const { unreadUpdates, aggregateDeltas } = await buildUnreadUpdates(chatKeyLocal, currentResolvedUserId, contactUserId);
      const updates = {};
      updates[`${prefix}Chats/${chatKeyLocal}/messages/${messageId}`] = messageObj;
      updates[`${prefix}Chats/${chatKeyLocal}/lastMessage`] = lastMessage;
      Object.assign(updates, unreadUpdates);

      await update(ref(database), updates);
      await Promise.allSettled(
        Object.entries(aggregateDeltas).map(([participantId, delta]) => incrementUnreadTotalNode(participantId, delta))
      );
    } catch (error) {
      console.warn("[Messages:pickImageAndSend] error", error);

      if (localUri && chatKeyLocal && messageId && currentResolvedUserId && isRetryableUploadError(error)) {
        try {
          const schoolKey = (await AsyncStorage.getItem("schoolKey")) || null;
          await queueChatImageUpload({
            schoolKey,
            chatId: chatKeyLocal,
            messageId,
            senderId: currentResolvedUserId,
            receiverId: contactUserId,
            timeStamp: now || Date.now(),
            localUri,
          });
          Alert.alert("Queued to send", "Image will upload automatically when the connection returns.");
          return;
        } catch (queueError) {
          console.warn("[Messages:pickImageAndSend] queue fallback error", queueError);
        }
      }

      Alert.alert("Upload failed", "Could not upload image. Try again.");
    }
  }

  async function sendMessage() {
    if (!text.trim()) return;
    setSending(true);
    const now = Date.now();
    const payload = { text: text.trim(), timeStamp: now, type: "text" };

    try {
      const currentResolvedUserId = await getResolvedUserId();
      if (!currentResolvedUserId) {
        Alert.alert("Missing user id", "Cannot determine current user id.");
        setSending(false);
        return;
      }

      let chatKeyLocal = chatId;
      if (!chatKeyLocal) {
        chatKeyLocal = await findOrCreateChatId(currentResolvedUserId, contactUserId, true);
        if (!chatKeyLocal) {
          Alert.alert("Chat error", "Could not find or create chat");
          setSending(false);
          return;
        }
        setChatId(chatKeyLocal);
      }

      const messageId = push(await getDbRef(`Chats/${chatKeyLocal}/messages`)).key;
      const messageObj = {
        messageId,
        senderId: currentResolvedUserId,
        receiverId: contactUserId,
        text: payload.text,
        timeStamp: payload.timeStamp,
        type: payload.type,
        seen: false,
        edited: false,
        deleted: false,
      };

      const lastMessage = {
        seen: false,
        senderId: currentResolvedUserId,
        text: payload.text,
        timeStamp: payload.timeStamp,
        type: payload.type,
      };

      const prefix = await getPathPrefix();
      const { unreadUpdates, aggregateDeltas } = await buildUnreadUpdates(chatKeyLocal, currentResolvedUserId, contactUserId);
      const updates = {};
      updates[`${prefix}Chats/${chatKeyLocal}/messages/${messageId}`] = messageObj;
      updates[`${prefix}Chats/${chatKeyLocal}/lastMessage`] = lastMessage;
      Object.assign(updates, unreadUpdates);

      setMessages((prev) => (prev.some((message) => message.messageId === messageId) ? prev : [...prev, messageObj]));

      updateChatsCacheWithLastMessage({
        contactKeyLocal: contactKey || null,
        contactUserIdLocal: contactUserId || null,
        lastMessageText: lastMessage.text,
        timeStamp: lastMessage.timeStamp,
        lastSenderId: currentResolvedUserId,
        lastSeen: false,
        unread: 0,
        chatKeyLocal,
      }).catch(() => {});

      await update(ref(database), updates);
      await Promise.allSettled(
        Object.entries(aggregateDeltas).map(([participantId, delta]) => incrementUnreadTotalNode(participantId, delta))
      );

      setText("");
    } catch (error) {
      console.warn("[Messages:send] error", error);
      Alert.alert("Send failed", "Could not send message — try again.");
    } finally {
      setSending(false);
    }
  }

  function closeViewer() {
    setViewerVisible(false);
    setViewerImages([]);
    setViewerFallbackUri(null);
  }

  async function openImageViewer(message) {
    const uri = message.imageUrl || message.imageUri || message.image || null;
    if (!uri) return;

    setViewerImages([{ uri }]);
    setViewerFallbackUri(uri);
    setViewerVisible(true);
  }

  const displayItems = useMemo(() => {
    const items = [];
    let lastDateLabel = null;

    messages.forEach((message) => {
      const label = dateLabelForTs(message.timeStamp);
      if (label !== lastDateLabel) {
        items.push({ type: "date", id: `date-${message.timeStamp}`, label });
        lastDateLabel = label;
      }
      items.push({ type: "message", ...message });
    });

    return items;
  }, [messages]);

  const renderDateSeparator = (label) => (
    <View style={styles.dateSeparator}>
      <View style={styles.dateLine} />
      <Text style={styles.dateText}>{label}</Text>
      <View style={styles.dateLine} />
    </View>
  );

  const renderMessage = ({ item, index }) => {
    if (item.type === "date") {
      return <View style={{ paddingVertical: 10 }}>{renderDateSeparator(item.label)}</View>;
    }

    const message = item;
    const isMe =
      (currentUserId && String(message.senderId) === String(currentUserId)) ||
      (currentUserNodeKey && String(message.senderId) === String(currentUserNodeKey));
    const previousItem = index > 0 ? displayItems[index - 1] : null;
    const previousSameSender = previousItem && previousItem.type === "message" && String(previousItem.senderId) === String(message.senderId);
    const showAvatar = !isMe && !previousSameSender;

    const isLastMessage =
      lastMessageMeta && message.messageId && lastMessageMeta.timeStamp && Number(lastMessageMeta.timeStamp) === Number(message.timeStamp);
    const seenFlag = !!message.seen || (isLastMessage && !!lastMessageMeta?.seen);

    if (message.type === "image") {
      const imageSource = message.imageUrl ? { uri: message.imageUrl } : AVATAR_PLACEHOLDER;

      if (isMe) {
        return (
          <View style={[styles.messageRow, styles.messageRowRight]}>
            <View style={{ flex: 1 }} />
            <View style={{ marginRight: 8 }}>
              <TouchableOpacity activeOpacity={0.9} onPress={() => openImageViewer(message)}>
                <Image source={imageSource} style={styles.outgoingImage} />
                <View style={styles.imageMeta}>
                  <Text style={styles.imageTime}>{fmtTime12(message.timeStamp)}</Text>
                  <Ionicons
                    name={seenFlag ? "checkmark-done" : "checkmark"}
                    size={14}
                    color={seenFlag ? "#CBE8FF" : "rgba(255,255,255,0.75)"}
                    style={{ marginLeft: 8 }}
                  />
                </View>
              </TouchableOpacity>
              <View style={styles.rightTailContainer}><View style={styles.rightTail} /></View>
            </View>
            <View style={{ width: 36 }} />
          </View>
        );
      }

      return (
        <View style={[styles.messageRow, styles.messageRowLeft]}>
          {showAvatar ? <Image source={safeContactImage ? { uri: safeContactImage } : AVATAR_PLACEHOLDER} style={styles.msgAvatar} /> : <View style={{ width: 36 }} />}
          <View style={{ width: 8 }} />
          <View>
            <TouchableOpacity activeOpacity={0.9} onPress={() => openImageViewer(message)}>
              <Image source={imageSource} style={styles.incomingImage} />
              <View style={styles.incomingImageMeta}>
                <Text style={styles.imageTimeIncoming}>{fmtTime12(message.timeStamp)}</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.leftTailContainer}><View style={styles.leftTail} /></View>
          </View>
          <View style={{ flex: 1 }} />
        </View>
      );
    }

    return (
      <View style={[styles.messageRow, isMe ? styles.messageRowRight : styles.messageRowLeft]}>
        {!isMe && showAvatar && <Image source={safeContactImage ? { uri: safeContactImage } : AVATAR_PLACEHOLDER} style={styles.msgAvatar} />}
        {!isMe && !showAvatar && <View style={{ width: 36 }} />}

        <View style={[styles.bubbleWrap, isMe ? { alignItems: "flex-end" } : { alignItems: "flex-start" }]}>
          <View style={[styles.bubble, isMe ? styles.bubbleRight : styles.bubbleLeft]}>
            <Text style={[styles.bubbleText, isMe ? styles.bubbleTextRight : styles.bubbleTextLeft]}>{message.deleted ? "Message deleted" : message.text}</Text>
            <View style={styles.bubbleMetaRow}>
              <Text style={[styles.bubbleTime, isMe ? styles.bubbleTimeRight : styles.bubbleTimeLeft]}>{fmtTime12(message.timeStamp)}</Text>
              {isMe ? (
                <Ionicons
                  name={seenFlag ? "checkmark-done" : "checkmark"}
                  size={14}
                  color={seenFlag ? "#CBE8FF" : "rgba(255,255,255,0.75)"}
                  style={{ marginLeft: 8 }}
                />
              ) : null}
            </View>
          </View>

          {!isMe ? (
            <View style={styles.leftTailContainer}><View style={styles.leftTail} /></View>
          ) : (
            <View style={styles.rightTailContainer}><View style={styles.rightTail} /></View>
          )}
        </View>

        {isMe ? <View style={{ width: 36 }} /> : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle={statusBarStyle === "dark" ? "dark-content" : "light-content"} backgroundColor={colors.background} translucent={false} />
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerName} numberOfLines={1}>{contactName || "Conversation"}</Text>
            <Text style={styles.headerSub}>{contactSubtitle || ""}</Text>
          </View>

          <TouchableOpacity style={styles.headerRight} onPress={() => Alert.alert("Contact", "Open contact profile")}>
            <Image source={safeContactImage ? { uri: safeContactImage } : AVATAR_PLACEHOLDER} style={styles.headerAvatar} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={styles.chatArea}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
        >
          <View style={styles.messagesWrap}>
            {loading ? (
              <PageLoadingSkeleton variant="chat" showHeader={false} style={{ flex: 1, backgroundColor: colors.background }} />
            ) : (
              <FlatList
                ref={flatListRef}
                data={displayItems}
                renderItem={renderMessage}
                keyExtractor={(item, index) => (item.type === "date" ? item.id : item.messageId || `${item.timeStamp}-${index}`)}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.messagesContent}
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={() => flatListRef.current && flatListRef.current.scrollToEnd({ animated: true })}
              />
            )}
          </View>

          <View style={styles.inputRow}>
            <TouchableOpacity onPress={pickImageAndSend} style={styles.attachmentBtn}>
              <Ionicons name="image-outline" size={22} color={MUTED} />
            </TouchableOpacity>

            <TextInput
              placeholder="Message"
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={setText}
              style={styles.input}
              multiline
              returnKeyType="send"
              onSubmitEditing={sendMessage}
            />
            <TouchableOpacity
              style={[styles.sendBtn, text.trim() ? styles.sendBtnActive : styles.sendBtnDisabled]}
              onPress={sendMessage}
              disabled={!text.trim() || sending}
            >
              <Ionicons name="send" size={20} color={text.trim() ? colors.white : colors.muted} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        <Modal visible={viewerVisible} transparent animationType="fade" onRequestClose={closeViewer}>
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={closeViewer}>
              <Ionicons name="close" size={28} color={colors.white} />
            </TouchableOpacity>
            <View style={styles.modalContent}>
              {viewerFallbackUri ? (
                <Image source={{ uri: viewerFallbackUri }} style={styles.modalImage} resizeMode="contain" />
              ) : viewerImages.length ? (
                <Image source={{ uri: viewerImages[0].uri }} style={styles.modalImage} resizeMode="contain" />
              ) : null}
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  chatArea: { flex: 1 },

  header: { height: 62, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, borderBottomColor: colors.separator, borderBottomWidth: 1, backgroundColor: colors.background },
  back: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  headerName: { fontSize: 16, fontWeight: "700", color: colors.text, letterSpacing: 0.1 },
  headerSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  headerRight: { width: 36, alignItems: "center", justifyContent: "center" },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceMuted },

  messagesWrap: { flex: 1, paddingHorizontal: 12, backgroundColor: colors.background },
  messagesContent: { paddingVertical: 12, paddingBottom: 12 },

  messageRow: { flexDirection: "row", marginVertical: 6, alignItems: "flex-end" },
  messageRowLeft: { justifyContent: "flex-start" },
  messageRowRight: { justifyContent: "flex-end" },

  msgAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 8, backgroundColor: colors.surfaceMuted },

  bubbleWrap: { maxWidth: "78%", position: "relative" },
  bubble: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 0,
  },
  bubbleLeft: { backgroundColor: colors.incomingBubble, borderTopLeftRadius: 6, borderTopRightRadius: 14, borderBottomRightRadius: 14, borderBottomLeftRadius: 14 },
  bubbleRight: { backgroundColor: colors.outgoingBubble, borderTopRightRadius: 6, borderTopLeftRadius: 14, borderBottomRightRadius: 14, borderBottomLeftRadius: 14, marginRight: -12 },

  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTextLeft: { color: colors.incomingText, fontWeight: "500" },
  bubbleTextRight: { color: colors.outgoingText, fontWeight: "500" },

  bubbleMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 6 },
  bubbleTime: { fontSize: 10, opacity: 0.9 },
  bubbleTimeLeft: { color: colors.muted, textAlign: "left" },
  bubbleTimeRight: { color: "rgba(255,255,255,0.85)", textAlign: "right" },

  leftTailContainer: { position: "absolute", left: -6, bottom: -2, width: 12, height: 8, overflow: "hidden", alignItems: "flex-start" },
  leftTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: colors.incomingBubble,
    transform: [{ rotate: "180deg" }],
  },

  rightTailContainer: { position: "absolute", right: -20, bottom: -2, width: 12, height: 8, overflow: "hidden", alignItems: "flex-end" },
  rightTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: colors.outgoingBubble,
    transform: [{ rotate: "0deg" }],
  },

  incomingImage: { width: 220, height: 140, borderRadius: 12, resizeMode: "cover", backgroundColor: colors.surfaceMuted },
  outgoingImage: { width: 220, height: 140, borderRadius: 12, resizeMode: "cover", backgroundColor: colors.outgoingBubble , marginRight: -12},
  imageMeta: { position: "absolute", right: 8, bottom: 6, flexDirection: "row", alignItems: "center" },
  incomingImageMeta: { position: "absolute", left: 8, bottom: 6, flexDirection: "row", alignItems: "center" },
  imageTime: { color: "rgba(255,255,255,0.9)", fontSize: 11 },
  imageTimeIncoming: { color: colors.muted, fontSize: 11 },

  dateSeparator: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  dateLine: { height: 1, backgroundColor: colors.separator, flex: 1, marginHorizontal: 12 },
  dateText: { color: colors.muted, fontSize: 12 },

  inputRow: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 8, paddingVertical: 10, borderTopColor: colors.separator, borderTopWidth: 1, backgroundColor: colors.background },
  attachmentBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginRight: 6 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 8 : 6,
    borderRadius: 20,
    backgroundColor: colors.inputBackground,
    color: colors.text,
    fontSize: 15,
    marginRight: 8,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  sendBtnActive: { backgroundColor: colors.primary },
  sendBtnDisabled: { backgroundColor: colors.surfaceMuted },

  // modal fallback styles
  modalOverlay: { flex: 1, backgroundColor: colors.imageOverlay, justifyContent: "center", alignItems: "center" },
  modalContent: { flex: 1, justifyContent: "center", alignItems: "center", width: "100%", padding: 12 },
  modalImage: { width: "100%", height: "100%" },
  modalCloseBtn: { position: "absolute", top: 40, right: 20, zIndex: 20 },
});
}