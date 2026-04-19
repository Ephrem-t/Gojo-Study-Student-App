import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  equalTo as firebaseEqualTo,
  endAt as firebaseEndAt,
  get as firebaseGet,
  limitToLast as firebaseLimitToLast,
  off as firebaseOff,
  onValue as firebaseOnValue,
  orderByChild as firebaseOrderByChild,
  push as firebasePush,
  query as firebaseQuery,
  ref as firebaseRef,
  remove as firebaseRemove,
  runTransaction as firebaseRunTransaction,
  set as firebaseSet,
  update as firebaseUpdate,
} from "firebase/database";
import { database } from "../constants/firebaseConfig";

const CACHE_PREFIX = "offlineDbCache:v1:";
const CACHE_INDEX_KEY = "offlineDbCacheIndex:v1";
const WRITE_QUEUE_KEY = "offlineDbWriteQueue:v1";

const targetMetaMap = new WeakMap();
const constraintMetaMap = new WeakMap();
const liveTargets = new Map();
const offlineStateListeners = new Set();

let cacheIndexPromise = null;
let cacheIndexValue = null;
let cacheLock = Promise.resolve();
let queueLock = Promise.resolve();
let connected = typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
  ? navigator.onLine
  : true;
let connectionResolved = typeof navigator !== "undefined" && typeof navigator.onLine === "boolean";
let pendingWrites = 0;
let syncStarted = false;
let flushPromise = null;

function withCacheLock(work) {
  const next = cacheLock.then(work, work);
  cacheLock = next.catch(() => null);
  return next;
}

function withQueueLock(work) {
  const next = queueLock.then(work, work);
  queueLock = next.catch(() => null);
  return next;
}

function normalizePath(path = "") {
  return String(path || "").replace(/^\/+|\/+$/g, "");
}

function splitPath(path = "") {
  const normalized = normalizePath(path);
  return normalized ? normalized.split("/").filter(Boolean) : [];
}

function joinPath(basePath = "", childPath = "") {
  const base = normalizePath(basePath);
  const child = normalizePath(childPath);
  if (!base) return child;
  if (!child) return base;
  return `${base}/${child}`;
}

function lastSegment(path = "") {
  const parts = splitPath(path);
  return parts.length ? parts[parts.length - 1] : null;
}

function isNumericSegment(segment) {
  return /^\d+$/.test(String(segment || ""));
}

function isAncestorOrSame(ancestorPath = "", candidatePath = "") {
  const ancestor = splitPath(ancestorPath);
  const candidate = splitPath(candidatePath);
  if (ancestor.length > candidate.length) return false;
  return ancestor.every((segment, index) => segment === candidate[index]);
}

function relativePath(fromPath = "", toPath = "") {
  if (!isAncestorOrSame(fromPath, toPath)) return null;
  const fromParts = splitPath(fromPath);
  const toParts = splitPath(toPath);
  return toParts.slice(fromParts.length).join("/");
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function getValueAtParts(value, parts) {
  let current = value;
  for (const part of parts) {
    if (current == null) return undefined;
    if (Array.isArray(current) && isNumericSegment(part)) {
      current = current[Number(part)];
    } else {
      current = current[part];
    }
  }
  return current;
}

function createContainerForPart(nextPart) {
  return isNumericSegment(nextPart) ? [] : {};
}

function setValueAtParts(rootValue, parts, nextValue) {
  if (!parts.length) return cloneValue(nextValue);

  let root = cloneValue(rootValue);
  if (root == null || typeof root !== "object") {
    root = createContainerForPart(parts[0]);
  }

  let current = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    const nextPart = parts[index + 1];
    const key = Array.isArray(current) && isNumericSegment(part) ? Number(part) : part;
    if (current[key] == null || typeof current[key] !== "object") {
      current[key] = createContainerForPart(nextPart);
    }
    current = current[key];
  }

  const finalPart = parts[parts.length - 1];
  const finalKey = Array.isArray(current) && isNumericSegment(finalPart) ? Number(finalPart) : finalPart;
  current[finalKey] = cloneValue(nextValue);
  return root;
}

function deleteValueAtParts(rootValue, parts) {
  if (!parts.length) return undefined;
  const root = cloneValue(rootValue);
  if (root == null || typeof root !== "object") return root;

  let current = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    const key = Array.isArray(current) && isNumericSegment(part) ? Number(part) : part;
    if (current[key] == null || typeof current[key] !== "object") return root;
    current = current[key];
  }

  const finalPart = parts[parts.length - 1];
  const finalKey = Array.isArray(current) && isNumericSegment(finalPart) ? Number(finalPart) : finalPart;
  if (Array.isArray(current) && typeof finalKey === "number") {
    delete current[finalKey];
  } else {
    delete current[finalKey];
  }
  return root;
}

function createCachedSnapshot(value, key = null) {
  const exists = value !== undefined && value !== null;

  return {
    key,
    exists: () => exists,
    val: () => cloneValue(value),
    child: (path) => createCachedSnapshot(getValueAtParts(value, splitPath(path)), lastSegment(path)),
    hasChild: (path) => {
      const childValue = getValueAtParts(value, splitPath(path));
      return childValue !== undefined && childValue !== null;
    },
    forEach: (callback) => {
      if (!exists) return false;
      const entries = Array.isArray(value)
        ? value.map((item, index) => [String(index), item])
        : Object.entries(value || {});

      for (const [childKey, childValue] of entries) {
        if (callback(createCachedSnapshot(childValue, childKey)) === true) return true;
      }
      return false;
    },
    numChildren: () => {
      if (!exists) return 0;
      if (Array.isArray(value)) return value.length;
      return Object.keys(value || {}).length;
    },
    toJSON: () => cloneValue(value),
  };
}

function isCacheablePath(path = "") {
  return normalizePath(path) !== ".info/connected";
}

function getCacheStorageKey(cacheKey) {
  return `${CACHE_PREFIX}${cacheKey}`;
}

function isFiniteCacheAge(maxAgeMs) {
  return Number.isFinite(Number(maxAgeMs)) && Number(maxAgeMs) > 0;
}

function isCacheFresh(entry, maxAgeMs) {
  if (!entry || !isFiniteCacheAge(maxAgeMs)) return false;
  const savedAt = Number(entry.savedAt || 0);
  if (!savedAt) return false;
  return Date.now() - savedAt <= Number(maxAgeMs);
}

function getRawRef(path = "") {
  const normalizedPath = normalizePath(path);
  return normalizedPath ? firebaseRef(database, normalizedPath) : firebaseRef(database);
}

async function loadCacheIndex() {
  if (cacheIndexValue) return cacheIndexValue;
  if (!cacheIndexPromise) {
    cacheIndexPromise = AsyncStorage.getItem(CACHE_INDEX_KEY)
      .then((raw) => {
        try {
          cacheIndexValue = raw ? JSON.parse(raw) : {};
        } catch {
          cacheIndexValue = {};
        }
        return cacheIndexValue;
      })
      .finally(() => {
        cacheIndexPromise = null;
      });
  }
  return cacheIndexPromise;
}

async function persistCacheIndex() {
  await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(cacheIndexValue || {}));
}

function setTargetMeta(target, meta) {
  if (target && typeof target === "object") {
    targetMetaMap.set(target, meta);
  }
  return target;
}

function inferTargetMeta(target) {
  if (!target || typeof target !== "object") return { kind: "ref", path: "", cacheKey: "ref:" };
  const path = normalizePath(target?._path?.toString?.() || target?._path?.pieces_?.join?.("/") || "");
  return {
    kind: target?._queryParams ? "query" : "ref",
    path,
    cacheKey: `${target?._queryParams ? "query" : "ref"}:${path}`,
  };
}

function getTargetMeta(target) {
  return targetMetaMap.get(target) || inferTargetMeta(target);
}

function setConstraintMeta(constraint, meta) {
  if (constraint && typeof constraint === "object") {
    constraintMetaMap.set(constraint, meta);
  }
  return constraint;
}

function getConstraintDescriptor(constraint, index) {
  const meta = constraintMetaMap.get(constraint);
  if (!meta) return `constraint:${index}`;
  const serializedArgs = (meta.args || []).map((arg) => {
    if (arg == null) return String(arg);
    if (typeof arg === "object") {
      try {
        return JSON.stringify(arg);
      } catch {
        return "[object]";
      }
    }
    return String(arg);
  }).join(",");
  return `${meta.type}:${serializedArgs}`;
}

function buildTargetMeta(kind, path, descriptor = "") {
  const normalizedPath = normalizePath(path);
  return {
    kind,
    path: normalizedPath,
    cacheKey: kind === "query"
      ? `query:${normalizedPath}:${descriptor || "all"}`
      : `ref:${normalizedPath}`,
  };
}

function getOrCreateLiveTarget(meta) {
  let state = liveTargets.get(meta.cacheKey);
  if (!state) {
    state = {
      meta,
      value: null,
      exists: false,
      hasValue: false,
      savedAt: 0,
      listeners: new Set(),
    };
    liveTargets.set(meta.cacheKey, state);
  }
  return state;
}

function setLiveTargetValue(meta, value, exists, savedAt = Date.now()) {
  const state = getOrCreateLiveTarget(meta);
  state.meta = meta;
  state.value = cloneValue(value);
  state.exists = !!exists;
  state.hasValue = true;
  state.savedAt = Number(savedAt || Date.now());
  return state;
}

function emitLiveTarget(state) {
  const snapshot = createCachedSnapshot(state.exists ? state.value : null, lastSegment(state.meta.path));
  state.listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {}
  });
}

function emitOfflineState() {
  const snapshot = getOfflineState();
  offlineStateListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {}
  });
}

function isOfflineError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  return (
    (connectionResolved && !connected)    ||
    code.includes("network")              ||
    code.includes("disconnect")           ||
    message.includes("network")           ||
    message.includes("offline")           ||
    message.includes("disconnected")      ||
    message.includes("failed to get")     ||
    message.includes("could not reach")
  );
}

async function readCacheEntry(meta) {
  if (!meta || !meta.cacheKey) return null;
  const liveState = liveTargets.get(meta.cacheKey);
  if (liveState?.hasValue) {
    return {
      savedAt: Number(liveState.savedAt || 0),
      value: cloneValue(liveState.value),
      exists: liveState.exists,
      basePath: meta.path,
    };
  }

  try {
    const raw = await AsyncStorage.getItem(getCacheStorageKey(meta.cacheKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCacheEntry(meta, value, exists) {
  if (!meta || !meta.cacheKey || !isCacheablePath(meta.path)) return;

  const entry = {
    savedAt: Date.now(),
    exists: !!exists,
    basePath: meta.path,
    kind: meta.kind,
    value: cloneValue(value),
  };

  setLiveTargetValue(meta, entry.value, entry.exists, entry.savedAt);

  await withCacheLock(async () => {
    const index = await loadCacheIndex();
    index[meta.cacheKey] = {
      basePath: meta.path,
      kind: meta.kind,
      storageKey: getCacheStorageKey(meta.cacheKey),
      savedAt: entry.savedAt,
    };
    await AsyncStorage.setItem(getCacheStorageKey(meta.cacheKey), JSON.stringify(entry));
    await persistCacheIndex();
  });
}

function applyMutationToValue(basePath, currentValue, mutationPath, nextValue, removeMode = false) {
  const normalizedBasePath = normalizePath(basePath);
  const normalizedMutationPath = normalizePath(mutationPath);

  if (normalizedBasePath === normalizedMutationPath) {
    return {
      value: removeMode ? null : cloneValue(nextValue),
      exists: !removeMode && nextValue !== undefined && nextValue !== null,
    };
  }

  if (isAncestorOrSame(normalizedBasePath, normalizedMutationPath)) {
    const relative = relativePath(normalizedBasePath, normalizedMutationPath);
    const parts = splitPath(relative);
    const updatedValue = removeMode
      ? deleteValueAtParts(currentValue, parts)
      : setValueAtParts(currentValue, parts, nextValue);
    return {
      value: updatedValue,
      exists: updatedValue !== undefined && updatedValue !== null,
    };
  }

  if (isAncestorOrSame(normalizedMutationPath, normalizedBasePath)) {
    if (removeMode || nextValue == null) {
      return { value: null, exists: false };
    }
    const relative = relativePath(normalizedMutationPath, normalizedBasePath);
    const extractedValue = relative ? getValueAtParts(nextValue, splitPath(relative)) : nextValue;
    return {
      value: cloneValue(extractedValue),
      exists: extractedValue !== undefined && extractedValue !== null,
    };
  }

  return null;
}

async function applyMutationToCaches(mutationPath, nextValue, removeMode = false) {
  const normalizedMutationPath = normalizePath(mutationPath);
  if (!normalizedMutationPath || !isCacheablePath(normalizedMutationPath)) return;

  await withCacheLock(async () => {
    const index = await loadCacheIndex();
    const entries = Object.entries(index || {});

    for (const [cacheKey, meta] of entries) {
      const basePath = normalizePath(meta?.basePath || "");
      if (!basePath) continue;
      const relevant = isAncestorOrSame(basePath, normalizedMutationPath) || isAncestorOrSame(normalizedMutationPath, basePath);
      if (!relevant) continue;

      let currentEntry = null;
      const liveState = liveTargets.get(cacheKey);
      if (liveState?.hasValue) {
        currentEntry = {
          value: cloneValue(liveState.value),
          exists: liveState.exists,
          basePath,
        };
      } else {
        try {
          const raw = await AsyncStorage.getItem(meta.storageKey || getCacheStorageKey(cacheKey));
          currentEntry = raw ? JSON.parse(raw) : null;
        } catch {
          currentEntry = null;
        }
      }

      const updated = applyMutationToValue(basePath, currentEntry?.value ?? null, normalizedMutationPath, nextValue, removeMode);
      if (!updated) continue;

      const newEntry = {
        savedAt: Date.now(),
        exists: updated.exists,
        basePath,
        kind: meta.kind || (cacheKey.startsWith("query:") ? "query" : "ref"),
        value: cloneValue(updated.value),
      };

      await AsyncStorage.setItem(meta.storageKey || getCacheStorageKey(cacheKey), JSON.stringify(newEntry));

      if (liveState) {
        liveState.value = cloneValue(newEntry.value);
        liveState.exists = newEntry.exists;
        liveState.hasValue = true;
        liveState.savedAt = newEntry.savedAt;
        emitLiveTarget(liveState);
      }
    }
  });
}

async function loadWriteQueue() {
  try {
    const raw = await AsyncStorage.getItem(WRITE_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveWriteQueue(queue) {
  pendingWrites = Array.isArray(queue) ? queue.length : 0;
  await AsyncStorage.setItem(WRITE_QUEUE_KEY, JSON.stringify(queue || []));
  emitOfflineState();
}

async function enqueueWrite(operation) {
  return withQueueLock(async () => {
    const queue = await loadWriteQueue();
    queue.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: Date.now(),
      ...operation,
    });
    await saveWriteQueue(queue);
    return queue;
  });
}

async function executeWrite(operation) {
  switch (operation.type) {
    case "set":
      await firebaseSet(getRawRef(operation.path), operation.value);
      return;
    case "remove":
      await firebaseRemove(getRawRef(operation.path));
      return;
    case "update":
      if (operation.basePath) {
        await firebaseUpdate(getRawRef(operation.basePath), operation.value || {});
      } else {
        await firebaseUpdate(getRawRef(), operation.value || {});
      }
      return;
    default:
      return;
  }
}

export async function flushQueuedWrites() {
  if (flushPromise) return flushPromise;

  flushPromise = withQueueLock(async () => {
    let queue = await loadWriteQueue();
    if (!queue.length) {
      await saveWriteQueue(queue);
      return;
    }

    const remaining = [];

    for (let index = 0; index < queue.length; index += 1) {
      const operation = queue[index];
      try {
        await executeWrite(operation);
      } catch (error) {
        if (isOfflineError(error)) {
          remaining.push(...queue.slice(index));
          break;
        }
        console.warn("Dropping offline write after permanent error", operation?.type, operation?.path || operation?.basePath, error);
      }
    }

    queue = remaining;
    await saveWriteQueue(queue);
  }).finally(() => {
    flushPromise = null;
  });

  return flushPromise;
}

function setConnectionState(nextConnected) {
  const resolvedNext = !!nextConnected;
  const changed = connected !== resolvedNext || !connectionResolved;
  connected = resolvedNext;
  connectionResolved = true;
  if (changed) emitOfflineState();
  if (connected) {
    flushQueuedWrites().catch(() => null);
  }
}

export function startOfflineSync() {
  if (syncStarted) return;
  syncStarted = true;

  loadWriteQueue()
    .then((queue) => {
      pendingWrites = queue.length;
      emitOfflineState();
      if (connected && queue.length) {
        flushQueuedWrites().catch(() => null);
      }
    })
    .catch(() => null);

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("online", () => setConnectionState(true));
    window.addEventListener("offline", () => setConnectionState(false));
  }

  const connectedRef = firebaseRef(database, ".info/connected");
  firebaseOnValue(
    connectedRef,
    (snapshot) => {
      setConnectionState(!!snapshot.val());
    },
    () => {
      if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
        setConnectionState(!!navigator.onLine);
      }
    }
  );
}

export function getOfflineState() {
  return {
    isConnected: connected,
    hasResolved: connectionResolved,
    pendingWrites,
    isOffline: connectionResolved && !connected,
  };
}

export function subscribeOfflineState(listener) {
  offlineStateListeners.add(listener);
  try {
    listener(getOfflineState());
  } catch {}
  return () => {
    offlineStateListeners.delete(listener);
  };
}

function createConstraint(factory, type) {
  return (...args) => setConstraintMeta(factory(...args), { type, args });
}

export function ref(db, path = "") {
  const normalizedPath = normalizePath(path);
  const target = normalizedPath ? firebaseRef(db, normalizedPath) : firebaseRef(db);
  return setTargetMeta(target, buildTargetMeta("ref", path));
}

export function query(target, ...constraints) {
  const baseMeta = getTargetMeta(target);
  const descriptor = constraints.map((constraint, index) => getConstraintDescriptor(constraint, index)).join("|");
  return setTargetMeta(
    firebaseQuery(target, ...constraints),
    buildTargetMeta("query", baseMeta.path, descriptor)
  );
}

export const orderByChild = createConstraint(firebaseOrderByChild, "orderByChild");
export const equalTo = createConstraint(firebaseEqualTo, "equalTo");
export const limitToLast = createConstraint(firebaseLimitToLast, "limitToLast");
export const endAt = createConstraint(firebaseEndAt, "endAt");

export async function get(target, options = null) {
  const meta = getTargetMeta(target);
  const maxAgeMs = Number(options?.maxAgeMs || 0);
  const allowFreshCache = isFiniteCacheAge(maxAgeMs);

  if (allowFreshCache) {
    const cached = await readCacheEntry(meta);
    if (isCacheFresh(cached, maxAgeMs)) {
      return createCachedSnapshot(cached.exists ? cached.value : null, lastSegment(meta.path));
    }
  }

  try {
    const snapshot = await firebaseGet(target);
    await writeCacheEntry(meta, snapshot.exists() ? snapshot.val() : null, snapshot.exists());
    return snapshot;
  } catch (error) {
    const cached = await readCacheEntry(meta);
    if (cached) {
      return createCachedSnapshot(cached.exists ? cached.value : null, lastSegment(meta.path));
    }
    throw error;
  }
}

export function onValue(target, callback, cancelCallbackOrListenOptions, options) {
  const meta = getTargetMeta(target);
  const state = getOrCreateLiveTarget(meta);

  let active = true;
  const localListener = (snapshot) => {
    if (!active) return;
    callback(snapshot);
  };

  state.listeners.add(localListener);

  const emitCached = async () => {
    const cached = await readCacheEntry(meta);
    if (!active || !cached) return;
    const liveState = setLiveTargetValue(meta, cached.value, cached.exists, cached.savedAt);
    callback(createCachedSnapshot(liveState.exists ? liveState.value : null, lastSegment(meta.path)));
  };

  emitCached().catch(() => null);

  const cancelCallback = typeof cancelCallbackOrListenOptions === "function"
    ? cancelCallbackOrListenOptions
    : null;

  const unsubscribe = firebaseOnValue(
    target,
    async (snapshot) => {
      if (!active) return;
      await writeCacheEntry(meta, snapshot.exists() ? snapshot.val() : null, snapshot.exists());
      callback(snapshot);
    },
    async (error) => {
      const cached = await readCacheEntry(meta);
      if (cached && active) {
        const liveState = setLiveTargetValue(meta, cached.value, cached.exists, cached.savedAt);
        callback(createCachedSnapshot(liveState.exists ? liveState.value : null, lastSegment(meta.path)));
        if (!isOfflineError(error) && cancelCallback) cancelCallback(error);
        return;
      }
      if (cancelCallback) cancelCallback(error);
    },
    options
  );

  return () => {
    active = false;
    state.listeners.delete(localListener);
    if (!state.listeners.size && !state.hasValue) {
      liveTargets.delete(meta.cacheKey);
    }
    try {
      unsubscribe();
    } catch {}
  };
}

export function off(target, eventType, callback) {
  return firebaseOff(target, eventType, callback);
}

export function push(target, value) {
  const baseMeta = getTargetMeta(target);
  const pushedRef = firebasePush(target);
  const path = joinPath(baseMeta.path, pushedRef.key || "");
  const wrappedRef = setTargetMeta(pushedRef, buildTargetMeta("ref", path));

  if (arguments.length > 1) {
    const promise = set(wrappedRef, value).then(() => wrappedRef);
    wrappedRef.then = promise.then.bind(promise);
    wrappedRef.catch = promise.catch.bind(promise);
  }

  return wrappedRef;
}

export async function set(target, value) {
  const meta = getTargetMeta(target);
  const normalizedPath = normalizePath(meta.path);

  try {
    if (!connectionResolved || connected) {
      await firebaseSet(getRawRef(normalizedPath), value);
      await writeCacheEntry(meta, value, value !== undefined && value !== null);
      await applyMutationToCaches(normalizedPath, value, false);
      return;
    }
  } catch (error) {
    if (!isOfflineError(error)) throw error;
  }

  await enqueueWrite({ type: "set", path: normalizedPath, value: cloneValue(value) });
  await writeCacheEntry(meta, value, value !== undefined && value !== null);
  await applyMutationToCaches(normalizedPath, value, false);
}

export async function remove(target) {
  const meta = getTargetMeta(target);
  const normalizedPath = normalizePath(meta.path);

  try {
    if (!connectionResolved || connected) {
      await firebaseRemove(getRawRef(normalizedPath));
      await writeCacheEntry(meta, null, false);
      await applyMutationToCaches(normalizedPath, null, true);
      return;
    }
  } catch (error) {
    if (!isOfflineError(error)) throw error;
  }

  await enqueueWrite({ type: "remove", path: normalizedPath });
  await writeCacheEntry(meta, null, false);
  await applyMutationToCaches(normalizedPath, null, true);
}

export async function update(target, value) {
  const meta = getTargetMeta(target);
  const basePath = normalizePath(meta.path);
  const payload = cloneValue(value || {});

  try {
    if (!connectionResolved || connected) {
      if (basePath) {
        await firebaseUpdate(getRawRef(basePath), payload);
      } else {
        await firebaseUpdate(getRawRef(), payload);
      }
      const entries = Object.entries(payload);
      for (const [subPath, subValue] of entries) {
        const fullPath = joinPath(basePath, subPath);
        await applyMutationToCaches(fullPath, subValue, subValue === null);
      }
      return;
    }
  } catch (error) {
    if (!isOfflineError(error)) throw error;
  }

  await enqueueWrite({ type: "update", basePath, value: payload });
  const entries = Object.entries(payload);
  for (const [subPath, subValue] of entries) {
    const fullPath = joinPath(basePath, subPath);
    await applyMutationToCaches(fullPath, subValue, subValue === null);
  }
}

export async function runTransaction(target, updater) {
  const meta = getTargetMeta(target);
  const normalizedPath = normalizePath(meta.path);

  try {
    if (!connectionResolved || connected) {
      const result = await firebaseRunTransaction(getRawRef(normalizedPath), updater);
      await writeCacheEntry(meta, result.snapshot.exists() ? result.snapshot.val() : null, result.snapshot.exists());
      await applyMutationToCaches(normalizedPath, result.snapshot.exists() ? result.snapshot.val() : null, !result.snapshot.exists());
      return result;
    }
  } catch (error) {
    if (!isOfflineError(error)) throw error;
  }

  const cached = await readCacheEntry(meta);
  const currentValue = cloneValue(cached?.exists ? cached.value : null);
  const nextValue = updater(currentValue);

  if (nextValue === undefined) {
    return {
      committed: false,
      snapshot: createCachedSnapshot(currentValue, lastSegment(meta.path)),
    };
  }

  await enqueueWrite({ type: "set", path: normalizedPath, value: cloneValue(nextValue) });
  await writeCacheEntry(meta, nextValue, nextValue !== undefined && nextValue !== null);
  await applyMutationToCaches(normalizedPath, nextValue, nextValue === null);

  return {
    committed: true,
    snapshot: createCachedSnapshot(nextValue, lastSegment(meta.path)),
  };
}