import AsyncStorage from "@react-native-async-storage/async-storage";

export const CHATS_CACHE_KEY = "chatsCache";
export const CHATS_CACHE_FETCHED_AT_KEY = "chatsCacheFetchedAt";
export const CHAT_TOTAL_UNREAD_KEY = "chatTotalUnread";
export const CHAT_TOTAL_UNREAD_FETCHED_AT_KEY = "chatTotalUnreadFetchedAt";
const CHAT_MESSAGES_CACHE_PREFIX = "chatMessagesCache:v1";

const unreadTotalListeners = new Set();
let unreadTotalSnapshot = 0;

function normalizeUnreadTotal(total) {
  return Math.max(0, Number(total || 0));
}

function getChatMessagesCacheKey(chatId) {
  return `${CHAT_MESSAGES_CACHE_PREFIX}:${String(chatId || "")}`;
}

function emitUnreadTotal(total) {
  unreadTotalSnapshot = normalizeUnreadTotal(total);
  unreadTotalListeners.forEach((listener) => {
    try {
      listener(unreadTotalSnapshot);
    } catch {}
  });
  return unreadTotalSnapshot;
}

export function calculateUnreadTotal(chats = []) {
  if (!Array.isArray(chats)) return 0;
  return chats.reduce((total, chat) => total + Math.max(0, Number(chat?.unread || 0)), 0);
}

export async function readChatsCache() {
  try {
    const raw = await AsyncStorage.getItem(CHATS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function readChatsCacheFetchedAt() {
  try {
    return Number((await AsyncStorage.getItem(CHATS_CACHE_FETCHED_AT_KEY)) || 0);
  } catch {
    return 0;
  }
}

export async function readCachedUnreadTotal() {
  try {
    unreadTotalSnapshot = normalizeUnreadTotal(await AsyncStorage.getItem(CHAT_TOTAL_UNREAD_KEY));
    return unreadTotalSnapshot;
  } catch {
    return 0;
  }
}

export function subscribeUnreadTotal(listener) {
  unreadTotalListeners.add(listener);
  try {
    listener(unreadTotalSnapshot);
  } catch {}

  return () => {
    unreadTotalListeners.delete(listener);
  };
}

export async function persistUnreadTotal(total, fetchedAt = Date.now()) {
  const unreadTotal = normalizeUnreadTotal(total);
  await AsyncStorage.multiSet([
    [CHAT_TOTAL_UNREAD_KEY, String(unreadTotal)],
    [CHAT_TOTAL_UNREAD_FETCHED_AT_KEY, String(Number(fetchedAt || Date.now()))],
  ]);
  emitUnreadTotal(unreadTotal);
  return unreadTotal;
}

export async function persistChatsCache(chats = [], fetchedAt = Date.now()) {
  const normalizedChats = Array.isArray(chats) ? chats : [];
  const normalizedFetchedAt = Number(fetchedAt || Date.now());
  const unreadTotal = normalizeUnreadTotal(calculateUnreadTotal(normalizedChats));

  await AsyncStorage.multiSet([
    [CHATS_CACHE_KEY, JSON.stringify(normalizedChats)],
    [CHATS_CACHE_FETCHED_AT_KEY, String(normalizedFetchedAt)],
    [CHAT_TOTAL_UNREAD_KEY, String(unreadTotal)],
    [CHAT_TOTAL_UNREAD_FETCHED_AT_KEY, String(normalizedFetchedAt)],
  ]);

  emitUnreadTotal(unreadTotal);

  return unreadTotal;
}

export async function readCachedChatMessages(chatId) {
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId) return [];

  try {
    const raw = await AsyncStorage.getItem(getChatMessagesCacheKey(normalizedChatId));
    const parsed = raw ? JSON.parse(raw) : null;
    const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    return messages;
  } catch {
    return [];
  }
}

export async function persistChatMessages(chatId, messages = [], fetchedAt = Date.now()) {
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId) return [];

  const normalizedMessages = Array.isArray(messages)
    ? messages
        .slice(-80)
        .map((message) => ({
          messageId: message?.messageId || "",
          senderId: message?.senderId || "",
          receiverId: message?.receiverId || "",
          text: message?.text || "",
          timeStamp: Number(message?.timeStamp || 0),
          type: message?.type || "text",
          imageUrl: message?.imageUrl || "",
          seen: !!message?.seen,
          edited: !!message?.edited,
          deleted: !!message?.deleted,
          uploading: !!message?.uploading,
        }))
    : [];

  try {
    await AsyncStorage.setItem(
      getChatMessagesCacheKey(normalizedChatId),
      JSON.stringify({
        fetchedAt: Number(fetchedAt || Date.now()),
        messages: normalizedMessages,
      })
    );
  } catch {}

  return normalizedMessages;
}