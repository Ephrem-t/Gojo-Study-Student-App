import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get, query, orderByChild, equalTo } from "../../lib/offlineDatabase";
import { database } from "../../constants/firebaseConfig";

/**
 * Helper utilities so all code reads/writes Users under:
 *   Platform1/Schools/{schoolKey}/Users/{userNodeKey}
 *
 * Fallback: if no schoolKey is found in AsyncStorage, operations fall back
 * to old root path: Users/{userNodeKey} or query(ref(database, "Users"), ...)
 * This prevents immediate breakage while you roll out the migration.
 */

const SCHOOL_KEY_STORAGE = "schoolKey";

async function getSavedSchoolKey() {
  try {
    const sk = await AsyncStorage.getItem(SCHOOL_KEY_STORAGE);
    if (sk) return sk;
  } catch (e) {
    // ignore
  }
  return null;
}

export function usersRefForSchool(schoolKey) {
  if (schoolKey) return ref(database, `Platform1/Schools/${schoolKey}/Users`);
  return ref(database, "Users");
}

/**
 * Return a Database Reference for a given nodeKey.
 */
export async function userNodeRef(nodeKey) {
  const sk = await getSavedSchoolKey();
  if (sk) return ref(database, `Platform1/Schools/${sk}/Users/${nodeKey}`);
  return ref(database, `Users/${nodeKey}`);
}

/**
 * Return snapshot for a given user node key under the resolved school (or fallback).
 * Caller should check .exists()
 */
export async function getUserSnapshot(nodeKey) {
  try {
    const r = await userNodeRef(nodeKey);
    return await get(r);
  } catch (e) {
    // fallback: try root Users path (older format)
    try {
      return await get(ref(database, `Users/${nodeKey}`));
    } catch {
      return null;
    }
  }
}

/**
 * Convenience: return .val() or null
 */
export async function getUserVal(nodeKey) {
  const snap = await getUserSnapshot(nodeKey);
  return snap && snap.exists() ? snap.val() : null;
}

/**
 * Query a username inside the provided schoolKey, or the saved schoolKey (if omitted).
 * Returns the snapshot (may be empty). Use snapshot.forEach to extract node key and value.
 */
export async function queryUserByUsernameInSchool(username, explicitSchoolKey = null) {
  const sk = explicitSchoolKey || (await getSavedSchoolKey());
  try {
    if (!sk) {
      // fallback to global Users
      const q = query(ref(database, "Users"), orderByChild("username"), equalTo(username));
      return await get(q);
    }
    const usersRef = ref(database, `Platform1/Schools/${sk}/Users`);
    const q = query(usersRef, orderByChild("username"), equalTo(username));
    return await get(q);
  } catch (err) {
    // When query fails due to index rules, bubble up
    throw err;
  }
}

/**
 * Query by a generic child (e.g. userId) inside the resolved school.
 * If you need to search username or userId, call this and check the snapshot.
 */
export async function queryUserByChildInSchool(childName, value, explicitSchoolKey = null) {
  const sk = explicitSchoolKey || (await getSavedSchoolKey());
  if (!sk) {
    const q = query(ref(database, "Users"), orderByChild(childName), equalTo(value));
    return await get(q);
  }
  const usersRef = ref(database, `Platform1/Schools/${sk}/Users`);
  const q = query(usersRef, orderByChild(childName), equalTo(value));
  return await get(q);
}