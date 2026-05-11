import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { database, storage } from "../constants/firebaseConfig";
import {
  get,
  getOfflineState,
  ref as dbRef,
  set as dbSet,
  subscribeOfflineState,
  update as dbUpdate,
} from "./offlineDatabase";

const MEDIA_QUEUE_KEY = "mediaUploadQueue:v1";
const QUEUED_MEDIA_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}queued-media/`
  : null;

const queueListeners = new Set();

let queueLoaded = false;
let queueSnapshot = [];
let queueLock = Promise.resolve();
let syncStarted = false;
let flushPromise = null;

function withQueueLock(work) {
  const next = queueLock.then(work, work);
  queueLock = next.catch(() => null);
  return next;
}

function cloneValue(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function emitQueue() {
  const snapshot = getMediaUploadQueueState();
  queueListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {}
  });
}

async function loadQueue() {
  if (queueLoaded) return cloneValue(queueSnapshot);

  try {
    const raw = await AsyncStorage.getItem(MEDIA_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    queueSnapshot = Array.isArray(parsed) ? parsed : [];
  } catch {
    queueSnapshot = [];
  }

  queueLoaded = true;
  emitQueue();
  return cloneValue(queueSnapshot);
}

async function saveQueue(queue) {
  queueSnapshot = Array.isArray(queue) ? queue : [];
  queueLoaded = true;
  await AsyncStorage.setItem(MEDIA_QUEUE_KEY, JSON.stringify(queueSnapshot));
  emitQueue();
}

function randomId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeHint(value = "media") {
  return String(value || "media")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "media";
}

function getFileExtension(uri, fallback = "jpg") {
  const raw = String(uri || "").split("?")[0] || "";
  const matched = raw.match(/\.([a-z0-9]{2,5})$/i);
  if (!matched) return fallback;
  return String(matched[1] || fallback).toLowerCase();
}

function getMimeTypeFromExtension(ext) {
  switch (String(ext || "").toLowerCase()) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "heic":
    case "heif":
      return "image/heic";
    default:
      return "image/jpeg";
  }
}

function isRemoteUri(uri) {
  const value = String(uri || "").trim();
  if (!value) return false;
  return /^https?:\/\//i.test(value) || /^data:image\//i.test(value);
}

export function isLocalMediaUri(uri) {
  const value = String(uri || "").trim();
  if (!value) return false;
  return !isRemoteUri(value);
}

async function ensureQueuedMediaDir() {
  if (!QUEUED_MEDIA_DIR) return null;

  try {
    const info = await FileSystem.getInfoAsync(QUEUED_MEDIA_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(QUEUED_MEDIA_DIR, { intermediates: true });
    }
  } catch {}

  return QUEUED_MEDIA_DIR;
}

export async function persistLocalMediaUri(localUri, hint = "media") {
  if (!isLocalMediaUri(localUri) || !QUEUED_MEDIA_DIR) return localUri;

  const normalizedUri = String(localUri || "").trim();
  if (!normalizedUri) return localUri;
  if (normalizedUri.startsWith(QUEUED_MEDIA_DIR)) return normalizedUri;

  await ensureQueuedMediaDir();

  const ext = getFileExtension(normalizedUri);
  const fileName = `${sanitizeHint(hint)}-${randomId()}.${ext}`;
  const targetUri = `${QUEUED_MEDIA_DIR}${fileName}`;

  try {
    await FileSystem.copyAsync({ from: normalizedUri, to: targetUri });
    return targetUri;
  } catch {
    return normalizedUri;
  }
}

async function cleanupQueuedMediaUri(localUri) {
  if (!QUEUED_MEDIA_DIR) return;

  const normalizedUri = String(localUri || "").trim();
  if (!normalizedUri || !normalizedUri.startsWith(QUEUED_MEDIA_DIR)) return;

  try {
    await FileSystem.deleteAsync(normalizedUri, { idempotent: true });
  } catch {}
}

async function persistAssessmentAnswers(answers, assessmentId, studentId) {
  const nextAnswers = {};

  for (const [questionId, answer] of Object.entries(answers || {})) {
    if (!answer || typeof answer !== "object") {
      nextAnswers[questionId] = answer;
      continue;
    }

    if (String(answer.type || "") !== "written") {
      nextAnswers[questionId] = cloneValue(answer);
      continue;
    }

    const nextImageUrls = {};
    for (const [imageKey, imageUri] of Object.entries(answer.imageUrls || {})) {
      if (!isLocalMediaUri(imageUri)) {
        nextImageUrls[imageKey] = imageUri;
        continue;
      }

      nextImageUrls[imageKey] = await persistLocalMediaUri(
        imageUri,
        `assessment-${assessmentId}-${studentId}-${questionId}-${imageKey}`
      );
    }

    nextAnswers[questionId] = {
      ...cloneValue(answer),
      imageUrls: nextImageUrls,
    };
  }

  return nextAnswers;
}

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

async function uploadLocalMediaToStorage(localUri, storagePath) {
  const ext = getFileExtension(localUri);
  const blob = await uriToBlob(localUri);
  const uploadRef = storageRef(storage, storagePath);

  await uploadBytes(uploadRef, blob, {
    contentType: blob?.type || getMimeTypeFromExtension(ext),
  });

  const remoteUrl = await getDownloadURL(uploadRef);
  await cleanupQueuedMediaUri(localUri);
  return remoteUrl;
}

function isOfflineLikeError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();

  return (
    !getOfflineState().isConnected ||
    code.includes("network") ||
    code.includes("disconnect") ||
    message.includes("network") ||
    message.includes("offline") ||
    message.includes("disconnected") ||
    message.includes("failed to get") ||
    message.includes("could not reach")
  );
}

async function buildUnreadUpdates({ schoolKey, chatId, senderId, receiverId }) {
  const prefix = schoolKey ? `Platform1/Schools/${schoolKey}/` : "";
  const chatPath = `${prefix}Chats/${chatId}`;

  const chatSnap = await get(dbRef(database, chatPath)).catch(() => null);
  const unreadNode = chatSnap?.exists() ? chatSnap.child("unread").val() || {} : {};
  const participants = chatSnap?.exists()
    ? chatSnap.child("participants").val() || {}
    : { [senderId]: true, [receiverId]: true };

  const updates = {
    [`${chatPath}/participants/${senderId}`]: true,
    [`${chatPath}/participants/${receiverId}`]: true,
  };

  Object.keys(participants || {}).forEach((participantId) => {
    if (String(participantId) === String(senderId)) {
      updates[`${chatPath}/unread/${participantId}`] = 0;
    } else {
      const previous = Number(unreadNode?.[participantId] || 0);
      updates[`${chatPath}/unread/${participantId}`] = previous + 1;
    }
  });

  if (!updates[`${chatPath}/unread/${receiverId}`]) {
    updates[`${chatPath}/unread/${receiverId}`] = 1;
  }

  if (!updates[`${chatPath}/unread/${senderId}`]) {
    updates[`${chatPath}/unread/${senderId}`] = 0;
  }

  return updates;
}

async function cleanupJobMedia(job) {
  if (!job?.payload) return;

  if (job.kind === "profile-image" || job.kind === "chat-image") {
    await cleanupQueuedMediaUri(job.payload.localUri);
    return;
  }

  if (job.kind === "assessment-submission") {
    const answers = job.payload?.submissionPayload?.answers || {};
    for (const answer of Object.values(answers)) {
      if (!answer || typeof answer !== "object") continue;
      for (const imageUri of Object.values(answer.imageUrls || {})) {
        await cleanupQueuedMediaUri(imageUri);
      }
    }
  }
}

async function processProfileImageJob(job) {
  const payload = job.payload || {};
  const ownerKey = payload.userNodeKey || payload.studentNodeKey || "student";
  const ext = getFileExtension(payload.localUri);
  const remoteUrl = await uploadLocalMediaToStorage(
    payload.localUri,
    `profile-images/${ownerKey}/${Date.now()}.${ext}`
  );

  const updates = {};
  if (payload.schoolKey && payload.userNodeKey) {
    updates[`Platform1/Schools/${payload.schoolKey}/Users/${payload.userNodeKey}/profileImage`] = remoteUrl;
  } else if (payload.userNodeKey) {
    updates[`Users/${payload.userNodeKey}/profileImage`] = remoteUrl;
  }

  if (payload.schoolKey && payload.studentNodeKey) {
    updates[`Platform1/Schools/${payload.schoolKey}/Students/${payload.studentNodeKey}/profileImage`] = remoteUrl;
  } else if (payload.studentNodeKey) {
    updates[`Students/${payload.studentNodeKey}/profileImage`] = remoteUrl;
  }

  if (Object.keys(updates).length) {
    await dbUpdate(dbRef(database), updates);
  }

  await AsyncStorage.setItem("profileImage", remoteUrl).catch(() => null);
  return remoteUrl;
}

async function processChatImageJob(job) {
  const payload = job.payload || {};
  const prefix = payload.schoolKey ? `Platform1/Schools/${payload.schoolKey}/` : "";
  const ext = getFileExtension(payload.localUri);
  const remoteUrl = await uploadLocalMediaToStorage(
    payload.localUri,
    `chatImages/${payload.chatId}/${payload.messageId}.${ext}`
  );

  const messageObj = {
    messageId: payload.messageId,
    senderId: payload.senderId,
    receiverId: payload.receiverId,
    text: "",
    timeStamp: payload.timeStamp,
    type: "image",
    imageUrl: remoteUrl,
    seen: false,
    edited: false,
    deleted: false,
  };

  const lastMessage = {
    seen: false,
    senderId: payload.senderId,
    text: "📷 Image",
    timeStamp: payload.timeStamp,
    type: "image",
  };

  const unreadUpdates = await buildUnreadUpdates({
    schoolKey: payload.schoolKey,
    chatId: payload.chatId,
    senderId: payload.senderId,
    receiverId: payload.receiverId,
  });

  const updates = {
    [`${prefix}Chats/${payload.chatId}/messages/${payload.messageId}`]: messageObj,
    [`${prefix}Chats/${payload.chatId}/lastMessage`]: lastMessage,
    ...unreadUpdates,
  };

  await dbUpdate(dbRef(database), updates);
  return remoteUrl;
}

async function uploadAssessmentAnswerImages(assessmentId, studentId, answers) {
  const nextAnswers = {};

  for (const [questionId, answer] of Object.entries(answers || {})) {
    if (!answer || typeof answer !== "object") {
      nextAnswers[questionId] = answer;
      continue;
    }

    if (String(answer.type || "") !== "written") {
      nextAnswers[questionId] = cloneValue(answer);
      continue;
    }

    const nextImageUrls = {};
    for (const [imageKey, imageUri] of Object.entries(answer.imageUrls || {})) {
      if (!isLocalMediaUri(imageUri)) {
        nextImageUrls[imageKey] = imageUri;
        continue;
      }

      const ext = getFileExtension(imageUri);
      nextImageUrls[imageKey] = await uploadLocalMediaToStorage(
        imageUri,
        `school_exam_submissions/${assessmentId}/${studentId}/${questionId}/${Date.now()}-${imageKey}.${ext}`
      );
    }

    nextAnswers[questionId] = {
      ...cloneValue(answer),
      imageUrls: nextImageUrls,
    };
  }

  return nextAnswers;
}

async function processAssessmentSubmissionJob(job) {
  const payload = job.payload || {};
  const answers = await uploadAssessmentAnswerImages(
    payload.assessmentId,
    payload.studentId,
    payload.submissionPayload?.answers || {}
  );

  const finalPayload = {
    ...(cloneValue(payload.submissionPayload) || {}),
    answers,
  };

  const basePath = payload.schoolKey
    ? `Platform1/Schools/${payload.schoolKey}/SchoolExams`
    : "SchoolExams";

  await dbSet(
    dbRef(database, `${basePath}/AssessmentSubmissions/${payload.assessmentId}/${payload.studentId}`),
    finalPayload
  );

  await dbSet(
    dbRef(database, `${basePath}/SubmissionIndex/${payload.assessmentId}/${payload.studentId}`),
    {
      submittedAt: Number(finalPayload.submittedAt || Date.now()),
      finalScore: Number(finalPayload.finalScore || 0),
      status: String(finalPayload.status || "submitted"),
    }
  );

  return finalPayload;
}

async function processJob(job) {
  switch (job?.kind) {
    case "profile-image":
      return processProfileImageJob(job);
    case "chat-image":
      return processChatImageJob(job);
    case "assessment-submission":
      return processAssessmentSubmissionJob(job);
    default:
      return null;
  }
}

async function enqueueJob(kind, payload) {
  startMediaUploadSync();

  const jobId = `media_${randomId()}`;
  let normalizedPayload = cloneValue(payload || {});

  if (kind === "profile-image") {
    normalizedPayload.localUri = await persistLocalMediaUri(
      normalizedPayload.localUri,
      `profile-${normalizedPayload.userNodeKey || normalizedPayload.studentNodeKey || "student"}`
    );
  }

  if (kind === "chat-image") {
    normalizedPayload.localUri = await persistLocalMediaUri(
      normalizedPayload.localUri,
      `chat-${normalizedPayload.chatId || "chat"}-${normalizedPayload.messageId || jobId}`
    );
  }

  if (kind === "assessment-submission") {
    normalizedPayload = {
      ...normalizedPayload,
      submissionPayload: {
        ...(cloneValue(normalizedPayload.submissionPayload) || {}),
        answers: await persistAssessmentAnswers(
          normalizedPayload.submissionPayload?.answers || {},
          normalizedPayload.assessmentId,
          normalizedPayload.studentId
        ),
      },
    };
  }

  return withQueueLock(async () => {
    const queue = await loadQueue();
    const filteredQueue = queue.filter((job) => {
      if (kind === "profile-image" && job.kind === "profile-image") {
        const currentOwner = job.payload?.userNodeKey || job.payload?.studentNodeKey || "student";
        const nextOwner = normalizedPayload.userNodeKey || normalizedPayload.studentNodeKey || "student";
        return String(currentOwner) !== String(nextOwner);
      }

      if (kind === "chat-image" && job.kind === "chat-image") {
        return String(job.payload?.messageId || "") !== String(normalizedPayload.messageId || "");
      }

      if (kind === "assessment-submission" && job.kind === "assessment-submission") {
        const sameAssessment = String(job.payload?.assessmentId || "") === String(normalizedPayload.assessmentId || "");
        const sameStudent = String(job.payload?.studentId || "") === String(normalizedPayload.studentId || "");
        return !(sameAssessment && sameStudent);
      }

      return true;
    });

    const job = {
      id: jobId,
      kind,
      createdAt: Date.now(),
      payload: normalizedPayload,
    };

    await saveQueue([...filteredQueue, job]);
    flushMediaUploadQueue().catch(() => null);
    return cloneValue(job);
  });
}

export function getMediaUploadQueueState() {
  return {
    pendingCount: queueSnapshot.length,
  };
}

export function subscribeMediaUploadQueue(listener) {
  queueListeners.add(listener);
  try {
    listener(getMediaUploadQueueState());
  } catch {}

  loadQueue().catch(() => null);

  return () => {
    queueListeners.delete(listener);
  };
}

export function startMediaUploadSync() {
  if (syncStarted) return;
  syncStarted = true;

  loadQueue()
    .then(() => {
      if (getOfflineState().isConnected) {
        flushMediaUploadQueue().catch(() => null);
      }
    })
    .catch(() => null);

  subscribeOfflineState((offlineState) => {
    if (offlineState?.isConnected) {
      flushMediaUploadQueue().catch(() => null);
    }
  });
}

export async function enqueueProfileImageUpload(payload) {
  return enqueueJob("profile-image", payload);
}

export async function queueChatImageUpload(payload) {
  return enqueueJob("chat-image", payload);
}

export async function queueAssessmentSubmission(payload) {
  return enqueueJob("assessment-submission", payload);
}

export async function readPendingChatMessages(chatId) {
  const queue = await loadQueue();
  return queue
    .filter((job) => job.kind === "chat-image" && String(job.payload?.chatId || "") === String(chatId || ""))
    .map((job) => ({
      messageId: job.payload?.messageId,
      senderId: job.payload?.senderId,
      receiverId: job.payload?.receiverId,
      text: "",
      timeStamp: job.payload?.timeStamp,
      type: "image",
      imageUrl: job.payload?.localUri,
      seen: false,
      uploading: true,
      localOnly: true,
    }))
    .sort((left, right) => Number(left.timeStamp || 0) - Number(right.timeStamp || 0));
}

export async function getPendingAssessmentSubmission(assessmentId, studentId) {
  const queue = await loadQueue();
  return queue.find((job) => {
    if (job.kind !== "assessment-submission") return false;
    return (
      String(job.payload?.assessmentId || "") === String(assessmentId || "") &&
      String(job.payload?.studentId || "") === String(studentId || "")
    );
  }) || null;
}

export async function flushMediaUploadQueue() {
  if (flushPromise) return flushPromise;

  flushPromise = withQueueLock(async () => {
    const queue = await loadQueue();
    if (!queue.length) return;

    const remaining = [];

    for (let index = 0; index < queue.length; index += 1) {
      const job = queue[index];
      try {
        await processJob(job);
      } catch (error) {
        if (isOfflineLikeError(error)) {
          remaining.push(...queue.slice(index));
          break;
        }

        console.warn("Dropping media queue item after permanent error", job?.kind, error);
        await cleanupJobMedia(job);
      }
    }

    await saveQueue(remaining);
  }).finally(() => {
    flushPromise = null;
  });

  return flushPromise;
}