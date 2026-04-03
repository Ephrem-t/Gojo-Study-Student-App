import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

export const APP_LOCK_PASSCODE_LENGTH = 4;
export const APP_LOCK_LAST_INACTIVE_AT_KEY = "appLockLastInactiveAt";
export const APP_LOCK_DEFAULT_AUTO_LOCK_DELAY_MS = 60 * 60 * 1000;
export const APP_LOCK_STORAGE_KEY_PREFIX = "gojoAppLock:";

export const APP_LOCK_AUTO_LOCK_OPTIONS = Object.freeze([
  { label: "1 minute", value: 1 * 60 * 1000 },
  { label: "5 minutes", value: 5 * 60 * 1000 },
  { label: "1 hour", value: 60 * 60 * 1000 },
  { label: "5 hours", value: 5 * 60 * 60 * 1000 },
]);

export const DEFAULT_APP_LOCK_STATE = Object.freeze({
  enabled: false,
  passcode: "",
  autoLockDelayMs: APP_LOCK_DEFAULT_AUTO_LOCK_DELAY_MS,
  updatedAt: null,
});

export function normalizePasscodeValue(value) {
  return String(value || "")
    .replace(/\D/g, "")
    .slice(0, APP_LOCK_PASSCODE_LENGTH);
}

export function isValidPasscodeValue(value) {
  return normalizePasscodeValue(value).length === APP_LOCK_PASSCODE_LENGTH;
}

export function normalizeAutoLockDelayMs(value) {
  const nextValue = Number(value || 0);
  const matched = APP_LOCK_AUTO_LOCK_OPTIONS.find((option) => option.value === nextValue);
  return matched ? matched.value : APP_LOCK_DEFAULT_AUTO_LOCK_DELAY_MS;
}

export function getAutoLockDelayLabel(value) {
  const normalizedValue = normalizeAutoLockDelayMs(value);
  return APP_LOCK_AUTO_LOCK_OPTIONS.find((option) => option.value === normalizedValue)?.label || "1 hour";
}

export function resolveAppLockAccountKey(...values) {
  const candidate = values
    .map((value) => String(value || "").trim())
    .find(Boolean);

  return candidate || "local-device";
}

export function getLocalAppLockStorageKey(accountKey) {
  return `${APP_LOCK_STORAGE_KEY_PREFIX}${resolveAppLockAccountKey(accountKey)}`;
}

export function normalizeStoredAppLock(rawValue) {
  const passcode = normalizePasscodeValue(rawValue?.passcode);
  const enabled = Boolean(rawValue?.enabled) && isValidPasscodeValue(passcode);
  const autoLockDelayMs = normalizeAutoLockDelayMs(rawValue?.autoLockDelayMs);

  return {
    enabled,
    passcode: enabled ? passcode : "",
    autoLockDelayMs,
    updatedAt: typeof rawValue?.updatedAt === "string" ? rawValue.updatedAt : null,
  };
}

export function buildStoredAppLockPayload(passcode, enabled = true, autoLockDelayMs = APP_LOCK_DEFAULT_AUTO_LOCK_DELAY_MS) {
  const normalizedPasscode = normalizePasscodeValue(passcode);
  const nextEnabled = Boolean(enabled) && isValidPasscodeValue(normalizedPasscode);
  const normalizedDelay = normalizeAutoLockDelayMs(autoLockDelayMs);

  return {
    enabled: nextEnabled,
    passcode: nextEnabled ? normalizedPasscode : "",
    autoLockDelayMs: normalizedDelay,
    updatedAt: new Date().toISOString(),
  };
}

async function canUseSecureStore() {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function readAppLockString(storageKey) {
  if (await canUseSecureStore()) {
    try {
      return await SecureStore.getItemAsync(storageKey);
    } catch {
      // fall through to AsyncStorage
    }
  }

  return AsyncStorage.getItem(storageKey);
}

async function writeAppLockString(storageKey, value) {
  if (await canUseSecureStore()) {
    try {
      await SecureStore.setItemAsync(storageKey, value);
      await AsyncStorage.removeItem(storageKey).catch(() => null);
      return;
    } catch {
      // fall through to AsyncStorage
    }
  }

  await AsyncStorage.setItem(storageKey, value);
}

async function removeAppLockString(storageKey) {
  if (await canUseSecureStore()) {
    try {
      await SecureStore.deleteItemAsync(storageKey);
    } catch {
      // ignore and continue cleanup
    }
  }

  await AsyncStorage.removeItem(storageKey).catch(() => null);
}

export async function loadStoredAppLock(accountKey) {
  const storageKey = getLocalAppLockStorageKey(accountKey);
  const rawValue = await readAppLockString(storageKey);

  if (!rawValue) {
    return DEFAULT_APP_LOCK_STATE;
  }

  try {
    return normalizeStoredAppLock(JSON.parse(rawValue));
  } catch {
    return DEFAULT_APP_LOCK_STATE;
  }
}

export async function saveStoredAppLock(accountKey, appLockState) {
  const storageKey = getLocalAppLockStorageKey(accountKey);
  const normalizedValue = normalizeStoredAppLock(appLockState);

  await writeAppLockString(storageKey, JSON.stringify(normalizedValue));
  return normalizedValue;
}

export async function clearStoredAppLock(accountKey) {
  const storageKey = getLocalAppLockStorageKey(accountKey);
  await removeAppLockString(storageKey);
}