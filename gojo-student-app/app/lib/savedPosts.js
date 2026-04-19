import AsyncStorage from "@react-native-async-storage/async-storage";
import { get, ref, remove, set } from "../../lib/offlineDatabase";
import { database } from "../../constants/firebaseConfig";

function getPostsBasePath(schoolKey) {
  if (schoolKey) return `Platform1/Schools/${schoolKey}/Posts`;
  return "Posts";
}

export async function getSavedPostsLocation() {
  const schoolKey = await AsyncStorage.getItem("schoolKey");
  const userNodeKey = await AsyncStorage.getItem("userNodeKey");
  const userId = await AsyncStorage.getItem("userId");

  if (schoolKey && userNodeKey) {
    return {
      schoolKey,
      userNodeKey,
      userId,
      basePath: `Platform1/Schools/${schoolKey}/Users/${userNodeKey}/savedPosts`,
    };
  }

  const fallbackKey = userNodeKey || userId;
  if (!fallbackKey) return null;

  return {
    schoolKey: null,
    userNodeKey: fallbackKey,
    userId,
    basePath: `Users/${fallbackKey}/savedPosts`,
  };
}

export async function getSavedPostsMap() {
  const location = await getSavedPostsLocation();
  if (!location?.basePath) return {};

  const snap = await get(ref(database, location.basePath));
  if (!snap.exists()) return {};

  return snap.val() || {};
}

export async function setSavedPostEntry(postId, shouldSave, postData = {}) {
  const location = await getSavedPostsLocation();
  if (!location?.basePath) {
    throw new Error("Missing saved post location");
  }

  const savedPostRef = ref(database, `${location.basePath}/${postId}`);
  const savedByActorId = location.userId || location.userNodeKey;
  const savedByRef = savedByActorId
    ? ref(database, `${getPostsBasePath(location.schoolKey)}/${postId}/savedBy/${savedByActorId}`)
    : null;

  if (!shouldSave) {
    await remove(savedPostRef);
    if (savedByRef) await remove(savedByRef);
    return { saved: false };
  }

  const payload = {
    postId,
    savedAt: Date.now(),
    time: postData?.time || null,
    postUrl: postData?.postUrl || null,
    message: postData?.message || "",
  };

  await set(savedPostRef, payload);
  if (savedByRef) await set(savedByRef, true);
  return { saved: true, payload };
}

export async function toggleSavedPostEntry(postId, postData = {}) {
  const location = await getSavedPostsLocation();
  if (!location?.basePath) {
    throw new Error("Missing saved post location");
  }

  const savedPostRef = ref(database, `${location.basePath}/${postId}`);
  const savedByActorId = location.userId || location.userNodeKey;
  const savedByRef = savedByActorId
    ? ref(database, `${getPostsBasePath(location.schoolKey)}/${postId}/savedBy/${savedByActorId}`)
    : null;
  const snap = await get(savedPostRef);

  if (snap.exists()) {
    await remove(savedPostRef);
    if (savedByRef) await remove(savedByRef);
    return { saved: false };
  }

  const payload = {
    postId,
    savedAt: Date.now(),
    time: postData?.time || null,
    postUrl: postData?.postUrl || null,
    message: postData?.message || "",
  };

  await set(savedPostRef, payload);
  if (savedByRef) await set(savedByRef, true);
  return { saved: true, payload };
}