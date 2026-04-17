import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
  Modal,
  SafeAreaView,
  Pressable,
  ScrollView,
  TextInput,
  Switch,
  Animated,
  PanResponder,
  Linking,
  Platform,
  useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get, remove, update } from "firebase/database";
import { database } from "../../constants/firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as ScreenOrientation from "expo-screen-orientation";
import { openBrowserAsync, WebBrowserPresentationStyle } from "expo-web-browser";
import { resolveNoteColorTag } from "../lib/noteColors";
import {
  deletePdfTextSearchIndex,
  ensurePdfTextSearchIndex,
  searchPdfTextSearchIndex,
} from "../lib/pdfTextSearch";
import { useRouter, useFocusEffect } from "expo-router";
import NativePdfView, { nativePdfUnavailableMessage } from "../../components/native-pdf-view";
import { useAppTheme } from "../../hooks/use-app-theme";

const MAX_NOTES_PER_CHAPTER = 5;

const BOOKS_DIR = `${FileSystem.documentDirectory}books/`;
const DOWNLOAD_INDEX_KEY = "downloaded_books_index_v1";
const BOOK_CATALOG_CACHE_KEY = "book_catalog_cache_v1";
const BOOK_SETTINGS_KEY = "book_settings_v1";
const READER_PROGRESS_KEY = "book_reader_progress_v1";
const READER_BOOKMARKS_KEY = "book_reader_bookmarks_v1";
const READER_MODE_SCROLL = "scroll";
const READER_MODE_PAGED = "paged";
const READER_SEARCH_RESULT_LIMIT = 40;

function sha1(msg) {
  function rotl(n, s) { return (n << s) | (n >>> (32 - s)); }
  function tohex(i) { return ("00000000" + i.toString(16)).slice(-8); }
  let H0 = 0x67452301, H1 = 0xEFCDAB89, H2 = 0x98BADCFE, H3 = 0x10325476, H4 = 0xC3D2E1F0;
  const ml = msg.length;
  const wa = [];
  for (let i = 0; i < ml; i++) wa[i >> 2] |= msg.charCodeAt(i) << (24 - (i % 4) * 8);
  const l = ((ml + 8) >> 6) + 1;
  const words = new Array(l * 16).fill(0);
  for (let i = 0; i < wa.length; i++) words[i] = wa[i];
  words[ml >> 2] |= 0x80 << (24 - (ml % 4) * 8);
  words[words.length - 1] = ml * 8;

  for (let i = 0; i < words.length; i += 16) {
    const w = words.slice(i, i + 16);
    let a = H0, b = H1, c = H2, d = H3, e = H4;
    for (let t = 0; t < 80; t++) {
      let wt;
      if (t < 16) wt = w[t];
      else {
        const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16];
        wt = rotl(x, 1); w[t] = wt;
      }
      let f, k;
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const temp = (rotl(a, 5) + f + e + k + (wt >>> 0)) >>> 0;
      e = d; d = c; c = rotl(b, 30) >>> 0; b = a; a = temp;
    }
    H0 = (H0 + a) >>> 0; H1 = (H1 + b) >>> 0; H2 = (H2 + c) >>> 0; H3 = (H3 + d) >>> 0; H4 = (H4 + e) >>> 0;
  }
  return tohex(H0) + tohex(H1) + tohex(H2) + tohex(H3) + tohex(H4);
}

function titleize(s) {
  return String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeGradeKey(g) {
  if (!g) return null;
  const s = String(g).toLowerCase().replace("grade", "").trim();
  return `grade${s}`;
}

function normalizeOfflineEntityKey(value, fallback = "item") {
  const normalized = String(value || fallback || "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
}

function sortSubjectUnits(a, b) {
  const leftOrder = Number(a?.order || 0);
  const rightOrder = Number(b?.order || 0);

  if (leftOrder && rightOrder && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  if (leftOrder && !rightOrder) return -1;
  if (!leftOrder && rightOrder) return 1;

  return String(a?.title || "").localeCompare(String(b?.title || ""));
}

function mapBooksCatalogToSubjects(booksObj) {
  return Object.keys(booksObj || {})
    .map((subjectKey) => {
      const subjectValue = booksObj[subjectKey] || {};
      const unitsObj = subjectValue.units || {};

      const units = Object.keys(unitsObj)
        .map((unitKey, index) => {
          const unitValue = unitsObj[unitKey] || {};
          return {
            unitKey,
            order: Number(String(unitKey).replace(/\D/g, "")) || index + 1,
            title: unitValue.title || titleize(unitKey),
            pdfUrl: unitValue.pdfUrl || null,
          };
        })
        .sort(sortSubjectUnits);

      return {
        subjectKey,
        subjectName: titleize(subjectKey),
        title: subjectValue.title || titleize(subjectKey),
        coverUrl: String(
          subjectValue.coverUrl ||
          subjectValue.cover ||
          subjectValue.image ||
          subjectValue.coverImage ||
          ""
        ).trim() || null,
        language: subjectValue.language || "",
        region: subjectValue.region || "",
        units,
        totalUnits: units.length,
      };
    })
    .sort((left, right) => String(left.subjectName || left.title || "").localeCompare(String(right.subjectName || right.title || "")));
}

function buildOfflineSubjectsFromDownloads(files = []) {
  if (!Array.isArray(files) || files.length === 0) return [];

  const sortedFiles = [...files].sort((left, right) => {
    const subjectCompare = String(left.subjectName || "Downloaded chapters").localeCompare(String(right.subjectName || "Downloaded chapters"));
    if (subjectCompare !== 0) return subjectCompare;
    return sortSubjectUnits(left, right);
  });

  const subjects = new Map();

  sortedFiles.forEach((file, index) => {
    const subjectName = String(file.subjectName || "Downloaded chapters").trim() || "Downloaded chapters";
    const subjectKey = normalizeOfflineEntityKey(file.subjectKey || subjectName, `downloaded_subject_${index + 1}`);

    const subject = subjects.get(subjectKey) || {
      subjectKey,
      subjectName,
      title: subjectName,
      coverUrl: file.coverUrl || null,
      language: file.language || "",
      region: file.region || "",
      units: [],
    };

    subject.units.push({
      unitKey: normalizeOfflineEntityKey(file.unitKey || file.name || file.title, `${subjectKey}_unit_${subject.units.length + 1}`),
      order: Number(file.unitOrder || file.order || subject.units.length + 1) || subject.units.length + 1,
      title: file.title || file.name || `Chapter ${subject.units.length + 1}`,
      pdfUrl: file.url || null,
      localUri: file.uri || null,
    });

    subjects.set(subjectKey, subject);
  });

  return Array.from(subjects.values())
    .map((subject) => ({
      ...subject,
      units: subject.units.sort(sortSubjectUnits),
      totalUnits: subject.units.length,
    }))
    .sort((left, right) => String(left.subjectName || left.title || "").localeCompare(String(right.subjectName || right.title || "")));
}

function getSubjectIcon(subjectName) {
  const name = (subjectName || "").toLowerCase();
  if (name.includes('math') || name.includes('mathematics')) return 'calculator-outline';
  if (name.includes('science')) return 'flask-outline';
  if (name.includes('english') || name.includes('language')) return 'book-outline';
  if (name.includes('history') || name.includes('social')) return 'globe-outline';
  if (name.includes('biology')) return 'leaf-outline';
  if (name.includes('chemistry')) return 'color-wand-outline';
  if (name.includes('physics')) return 'flash-outline';
  if (name.includes('geography')) return 'map-outline';
  if (name.includes('computer') || name.includes('ict')) return 'laptop-outline';
  if (name.includes('art')) return 'palette-outline';
  if (name.includes('music')) return 'musical-notes-outline';
  if (name.includes('physical') || name.includes('pe') || name.includes('sport')) return 'fitness-outline';
  return 'library-outline';
}

function getSubjectColor(subjectName, isDark = false) {
  const name = (subjectName || "").toLowerCase();
  if (isDark) {
    if (name.includes('math') || name.includes('mathematics')) return '#FFA4A4';
    if (name.includes('science')) return '#7BE9E0';
    if (name.includes('english') || name.includes('language')) return '#86D9FF';
    if (name.includes('history') || name.includes('social')) return '#B4E9CD';
    if (name.includes('biology')) return '#AFEFCB';
    if (name.includes('chemistry')) return '#FFD08A';
    if (name.includes('physics')) return '#9ACDFF';
    if (name.includes('geography')) return '#A9E5B1';
    if (name.includes('computer') || name.includes('ict')) return '#C1ACFF';
    if (name.includes('art')) return '#FF9CC4';
    if (name.includes('music')) return '#E0A8FF';
    if (name.includes('physical') || name.includes('pe') || name.includes('sport')) return '#89E6DB';
    return '#C4D2E3';
  }

  if (name.includes('math') || name.includes('mathematics')) return '#FF6B6B';
  if (name.includes('science')) return '#4ECDC4';
  if (name.includes('english') || name.includes('language')) return '#45B7D1';
  if (name.includes('history') || name.includes('social')) return '#96CEB4';
  if (name.includes('biology')) return '#88D8B0';
  if (name.includes('chemistry')) return '#FFB74D';
  if (name.includes('physics')) return '#64B5F6';
  if (name.includes('geography')) return '#81C784';
  if (name.includes('computer') || name.includes('ict')) return '#9575CD';
  if (name.includes('art')) return '#F06292';
  if (name.includes('music')) return '#BA68C8';
  if (name.includes('physical') || name.includes('pe') || name.includes('sport')) return '#4DB6AC';
  return '#90A4AE';
}

function normalizeChapterNotes(value) {
  if (!value || typeof value !== "object") return [];

  const nestedNotes = value.notes && typeof value.notes === "object"
    ? Object.entries(value.notes)
        .map(([noteId, note]) => ({ ...(note || {}), noteId }))
        .filter((note) => typeof note === "object")
    : [];

  if (typeof value.text === "string" || typeof value.title === "string") {
    return [{ ...value, noteId: value.noteId || "legacy" }, ...nestedNotes];
  }

  return nestedNotes.length
    ? nestedNotes
    : Object.entries(value)
    .map(([noteId, note]) => ({ ...(note || {}), noteId }))
    .filter((note) => typeof note === "object" && (typeof note.text === "string" || typeof note.title === "string"));
}

function clampPositivePage(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function clampPageWithinBounds(value, totalPages = 0, fallback = 1) {
  const nextPage = clampPositivePage(value, fallback);
  return totalPages > 0 ? Math.min(nextPage, totalPages) : nextPage;
}

function flattenPdfTableContents(entries, depth = 0, seed = "outline") {
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry, index) => {
    const title = String(entry?.title || "").trim();
    const page = clampPositivePage(Number(entry?.pageIdx) + 1, 1);
    const key = `${seed}-${depth}-${index}-${page}-${title || "untitled"}`;
    const currentEntry = title ? [{ key, title, page, depth }] : [];

    return currentEntry.concat(flattenPdfTableContents(entry?.children || [], depth + 1, key));
  });
}

function normalizeStoredReaderBookmarks(value) {
  if (!Array.isArray(value)) return [];

  const seenPages = new Set();

  return value
    .map((entry, index) => {
      const page = clampPositivePage(entry?.page, 0);
      if (!page) return null;

      const label = String(entry?.label || `Page ${page}`).trim() || `Page ${page}`;
      const note = String(entry?.note || "").trim();
      const createdAt = Number(entry?.createdAt || Date.now() + index);
      const updatedAt = Number(entry?.updatedAt || createdAt);

      return {
        page,
        label,
        note,
        createdAt,
        updatedAt,
      };
    })
    .filter((entry) => {
      if (!entry) return false;
      if (seenPages.has(entry.page)) return false;
      seenPages.add(entry.page);
      return true;
    })
    .sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
}

function getFilenameFromLocalUri(localUri) {
  const normalized = String(localUri || "").split("?")[0].split("#")[0];
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function normalizeReaderMode(value) {
  return value === READER_MODE_PAGED ? READER_MODE_PAGED : READER_MODE_SCROLL;
}

function createInitialViewerState(readerMode = READER_MODE_SCROLL) {
  return {
    visible: false,
    title: "",
    subjectName: "",
    localUri: null,
    reloadKey: 0,
    initialPage: 1,
    currentPage: 1,
    totalPages: 0,
    readerMode: normalizeReaderMode(readerMode),
  };
}

function createInitialReaderTextIndexState(localUri = null) {
  return {
    localUri,
    status: "idle",
    pageCount: 0,
    indexedPages: 0,
    error: "",
    fromCache: false,
    lastUpdated: 0,
  };
}

export default function BooksScreen() {
  const router = useRouter();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { colors, resolvedAppearance } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const PRIMARY = colors.primary;
  const TEXT = colors.text;
  const MUTED = colors.muted;
  const SUCCESS = colors.success;

  const [loading, setLoading] = useState(true);
  const [subjects, setSubjects] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [studentGrade, setStudentGrade] = useState(null);
  const [studentId, setStudentId] = useState(null);
  const [schoolCode, setSchoolCode] = useState(null);

  const [search, setSearch] = useState("");
  const [settingsVisible, setSettingsVisible] = useState(false);

  const [settings, setSettings] = useState({
    languageFilter: "All",
    showDownloadedOnly: false,
    autoExpandSubjects: false,
    compactMode: false,
    readerMode: READER_MODE_SCROLL,
  });

  const [downloadProgress, setDownloadProgress] = useState({});
  const [downloadingMap, setDownloadingMap] = useState({});
  const activeDownloadsRef = useRef({});

  const [downloadedFilesList, setDownloadedFilesList] = useState([]);
  const [managerVisible, setManagerVisible] = useState(false);

  const [viewer, setViewer] = useState(() => createInitialViewerState());
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerLoadProgress, setViewerLoadProgress] = useState(0);
  const [notesMap, setNotesMap] = useState({});
  const [noteSheet, setNoteSheet] = useState({ visible: false, subject: null, unit: null });
  const [noteReader, setNoteReader] = useState({ visible: false, subject: null, unit: null, note: null });
  const [brokenCoverMap, setBrokenCoverMap] = useState({});
  const [readerJumpVisible, setReaderJumpVisible] = useState(false);
  const [readerJumpInput, setReaderJumpInput] = useState("1");
  const [readerBookmarksVisible, setReaderBookmarksVisible] = useState(false);
  const [readerOutlineVisible, setReaderOutlineVisible] = useState(false);
  const [readerBookmarks, setReaderBookmarks] = useState([]);
  const [readerOutline, setReaderOutline] = useState([]);
  const [bookmarkEditor, setBookmarkEditor] = useState({ visible: false, page: 1, label: "", note: "" });
  const [readerSearchVisible, setReaderSearchVisible] = useState(false);
  const [readerSearchQuery, setReaderSearchQuery] = useState("");
  const [readerTextIndexState, setReaderTextIndexState] = useState(() => createInitialReaderTextIndexState());
  const [readerChromeVisible, setReaderChromeVisible] = useState(true);

  const [showFloatingIndicators, setShowFloatingIndicators] = useState(false);

  const floatingAnimValue = useRef(new Animated.Value(0)).current;
  const readerChromeAnimValue = useRef(new Animated.Value(1)).current;
  const readerChromeHideTimeoutRef = useRef(null);
  const readerProgressRef = useRef({});
  const readerProgressSaveTimeoutRef = useRef(null);
  const readerBookmarksRef = useRef({});
  const downloadedFilesListRef = useRef([]);
  const hasLoadedBooksRef = useRef(false);
  const viewerLocalUriRef = useRef(null);
  const pdfViewRef = useRef(null);
  const readerTextIndexRef = useRef(null);
  const readerTextIndexRequestRef = useRef(0);
  const readerHiddenCloseTapRef = useRef(0);

  const isLandscapeLayout = windowWidth > windowHeight;
  const isTabletLayout = Math.min(windowWidth, windowHeight) >= 768;
  const isReaderWideLayout = viewer.visible && (isTabletLayout || windowWidth >= 900);
  const readerToolsEnabled = false;

  const readerHeaderStyle = [
    styles.readerHeader,
    isLandscapeLayout && styles.readerHeaderLandscape,
    isReaderWideLayout && styles.readerHeaderWide,
  ];
  const readerToolRowStyle = [
    styles.readerToolRow,
    isReaderWideLayout && styles.readerToolRowWide,
  ];
  const readerBodyWrapStyle = [
    styles.readerBodyWrap,
    isReaderWideLayout && styles.readerBodyWrapWide,
  ];
  const readerPageChipStyle = [
    styles.readerPageChip,
    isReaderWideLayout && styles.readerPageChipWide,
  ];
  const readerBottomDockStyle = [
    styles.readerBottomDock,
    isReaderWideLayout && styles.readerBottomDockWide,
  ];
  const readerPanelSheetStyle = [
    styles.bottomSheet,
    (isLandscapeLayout || isReaderWideLayout) && styles.readerPanelFloatingSheet,
    isLandscapeLayout && styles.readerPanelLandscapeSheet,
    isReaderWideLayout && styles.readerPanelTabletSheet,
  ];

  const ensureBooksDir = useCallback(async () => {
    const info = await FileSystem.getInfoAsync(BOOKS_DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(BOOKS_DIR, { intermediates: true });
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(BOOK_SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setSettings((prev) => ({ ...prev, ...parsed }));
      }
    } catch {}
  }, []);

  const saveSettings = useCallback(async (next) => {
    setSettings(next);
    try {
      await AsyncStorage.setItem(BOOK_SETTINGS_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const loadReaderProgressIndex = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(READER_PROGRESS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      readerProgressRef.current = parsed && typeof parsed === "object" ? parsed : {};
      return readerProgressRef.current;
    } catch {
      readerProgressRef.current = {};
      return {};
    }
  }, []);

  const loadReaderBookmarksIndex = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(READER_BOOKMARKS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      readerBookmarksRef.current = parsed && typeof parsed === "object" ? parsed : {};
      return readerBookmarksRef.current;
    } catch {
      readerBookmarksRef.current = {};
      return {};
    }
  }, []);

  const flushReaderProgress = useCallback(async () => {
    if (readerProgressSaveTimeoutRef.current) {
      clearTimeout(readerProgressSaveTimeoutRef.current);
      readerProgressSaveTimeoutRef.current = null;
    }

    try {
      await AsyncStorage.setItem(READER_PROGRESS_KEY, JSON.stringify(readerProgressRef.current));
    } catch {}
  }, []);

  const queueReaderProgressSave = useCallback((localUri, page, totalPages = 0) => {
    if (!localUri) return;

    readerProgressRef.current = {
      ...readerProgressRef.current,
      [localUri]: {
        page: clampPositivePage(page, 1),
        totalPages: Math.max(0, Number(totalPages || 0)),
        updatedAt: Date.now(),
      },
    };

    if (readerProgressSaveTimeoutRef.current) {
      clearTimeout(readerProgressSaveTimeoutRef.current);
    }

    readerProgressSaveTimeoutRef.current = setTimeout(() => {
      AsyncStorage.setItem(READER_PROGRESS_KEY, JSON.stringify(readerProgressRef.current)).catch(() => null);
      readerProgressSaveTimeoutRef.current = null;
    }, 250);
  }, []);

  const persistBookmarksForLocalUri = useCallback(async (localUri, entries) => {
    if (!localUri) return;

    const normalized = normalizeStoredReaderBookmarks(entries);
    const nextIndex = { ...readerBookmarksRef.current };

    if (normalized.length) nextIndex[localUri] = normalized;
    else delete nextIndex[localUri];

    readerBookmarksRef.current = nextIndex;

    if (viewerLocalUriRef.current === localUri) {
      setReaderBookmarks(normalized);
    }

    try {
      await AsyncStorage.setItem(READER_BOOKMARKS_KEY, JSON.stringify(nextIndex));
    } catch {}
  }, []);

  const removeReaderArtifactsForLocalUri = useCallback(async (
    localUri,
    { clearProgress = true, clearBookmarks = true } = {}
  ) => {
    if (!localUri) return;

    const writes = [];

    if (clearProgress && readerProgressRef.current[localUri]) {
      const nextProgress = { ...readerProgressRef.current };
      delete nextProgress[localUri];
      readerProgressRef.current = nextProgress;
      writes.push(AsyncStorage.setItem(READER_PROGRESS_KEY, JSON.stringify(nextProgress)).catch(() => null));
    }

    if (clearBookmarks && readerBookmarksRef.current[localUri]) {
      const nextBookmarks = { ...readerBookmarksRef.current };
      delete nextBookmarks[localUri];
      readerBookmarksRef.current = nextBookmarks;

      if (viewerLocalUriRef.current === localUri) {
        setReaderBookmarks([]);
      }

      writes.push(AsyncStorage.setItem(READER_BOOKMARKS_KEY, JSON.stringify(nextBookmarks)).catch(() => null));
    }

    if (writes.length) {
      await Promise.all(writes);
    }
  }, []);

  const ensureReaderTextIndex = useCallback(async (localUri, { force = false } = {}) => {
    if (!localUri) return null;

    if (
      !force &&
      readerTextIndexRef.current &&
      readerTextIndexState.localUri === localUri &&
      readerTextIndexState.status === "ready"
    ) {
      return readerTextIndexRef.current;
    }

    const requestId = readerTextIndexRequestRef.current + 1;
    readerTextIndexRequestRef.current = requestId;

    setReaderTextIndexState((prev) => ({
      ...createInitialReaderTextIndexState(localUri),
      status: "indexing",
      pageCount: prev.localUri === localUri ? prev.pageCount : 0,
      indexedPages: prev.localUri === localUri ? prev.indexedPages : 0,
    }));

    try {
      const { index, fromCache } = await ensurePdfTextSearchIndex(localUri, {
        force,
        onProgress: ({ page, pageCount }) => {
          if (readerTextIndexRequestRef.current !== requestId) return;

          setReaderTextIndexState((prev) => ({
            ...prev,
            localUri,
            status: "indexing",
            pageCount,
            indexedPages: page,
            error: "",
            fromCache: false,
          }));
        },
      });

      if (readerTextIndexRequestRef.current !== requestId) {
        return null;
      }

      readerTextIndexRef.current = index;
      setReaderTextIndexState({
        localUri,
        status: "ready",
        pageCount: index.pageCount,
        indexedPages: index.pageCount,
        error: "",
        fromCache,
        lastUpdated: Date.now(),
      });
      return index;
    } catch (error) {
      if (readerTextIndexRequestRef.current !== requestId) {
        return null;
      }

      readerTextIndexRef.current = null;
      setReaderTextIndexState({
        ...createInitialReaderTextIndexState(localUri),
        status: "error",
        error: error?.message || "Could not index the PDF text.",
        lastUpdated: Date.now(),
      });
      return null;
    }
  }, [readerTextIndexState.localUri, readerTextIndexState.status]);

  useEffect(() => {
    loadReaderProgressIndex().catch(() => null);
  }, [loadReaderProgressIndex]);

  useEffect(() => {
    loadReaderBookmarksIndex().catch(() => null);
  }, [loadReaderBookmarksIndex]);

  useEffect(() => {
    viewerLocalUriRef.current = viewer.localUri;
  }, [viewer.localUri]);

  useEffect(() => {
    readerTextIndexRequestRef.current += 1;
    readerTextIndexRef.current = null;
    setReaderTextIndexState(createInitialReaderTextIndexState(viewer.localUri || null));
  }, [viewer.localUri]);

  useEffect(() => {
    setReaderChromeVisible(true);
  }, [viewer.localUri, viewer.visible]);

  useEffect(() => {
    Animated.timing(readerChromeAnimValue, {
      toValue: readerChromeVisible ? 1 : 0,
      duration: readerChromeVisible ? 220 : 180,
      useNativeDriver: true,
    }).start();
  }, [readerChromeAnimValue, readerChromeVisible]);

  useEffect(() => {
    if (!readerToolsEnabled) return undefined;

    if (readerChromeHideTimeoutRef.current) {
      clearTimeout(readerChromeHideTimeoutRef.current);
      readerChromeHideTimeoutRef.current = null;
    }

    if (
      !viewer.visible ||
      !readerChromeVisible ||
      viewerLoading ||
      readerJumpVisible ||
      readerBookmarksVisible ||
      readerOutlineVisible ||
      readerSearchVisible ||
      bookmarkEditor.visible
    ) {
      return undefined;
    }

    readerChromeHideTimeoutRef.current = setTimeout(() => {
      setReaderChromeVisible(false);
      readerChromeHideTimeoutRef.current = null;
    }, 4200);

    return () => {
      if (readerChromeHideTimeoutRef.current) {
        clearTimeout(readerChromeHideTimeoutRef.current);
        readerChromeHideTimeoutRef.current = null;
      }
    };
  }, [
    bookmarkEditor.visible,
    readerBookmarksVisible,
    readerChromeVisible,
    readerJumpVisible,
    readerOutlineVisible,
    readerSearchVisible,
    viewer.currentPage,
    viewer.visible,
    viewerLoading,
    readerToolsEnabled,
  ]);

  useEffect(() => {
    return () => {
      flushReaderProgress().catch(() => null);
    };
  }, [flushReaderProgress]);

  useEffect(() => {
    if (!readerSearchVisible || !viewer.localUri) return;
    if (readerTextIndexState.status === "ready" || readerTextIndexState.status === "indexing") return;

    ensureReaderTextIndex(viewer.localUri).catch(() => null);
  }, [ensureReaderTextIndex, readerSearchVisible, readerTextIndexState.status, viewer.localUri]);

  useEffect(() => {
    if (Platform.OS === "web" || !viewer.visible || !NativePdfView) return undefined;

    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.ALL_BUT_UPSIDE_DOWN).catch(() => null);

    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => null);
    };
  }, [viewer.visible]);

  useEffect(() => {
    downloadedFilesListRef.current = downloadedFilesList;
  }, [downloadedFilesList]);

  const downloadedUriSet = useMemo(() => {
  return new Set(downloadedFilesList.map((f) => f.uri));
}, [downloadedFilesList]);
  const updateSetting = useCallback(async (key, value) => {
    const next = { ...settings, [key]: value };
    await saveSettings(next);
    
    // If auto-expand is turned off, collapse all subjects
    if (key === 'autoExpandSubjects' && !value) {
      setExpanded({});
    }
  }, [settings, saveSettings]);

  const getLocalFilename = useCallback((url) => {
    if (!url) return null;
    let ext = "pdf";
    try {
      const pathPart = url.split("?")[0].split("#")[0];
      const parts = pathPart.split(".");
      if (parts.length > 1) {
        const e = parts[parts.length - 1].toLowerCase();
        if (/^[a-z0-9]{1,5}$/.test(e)) ext = e;
      }
    } catch {}
    return `${sha1(url)}.${ext}`;
  }, []);

  const getLocalPathForUrl = useCallback((url) => {
    const name = getLocalFilename(url);
    return name ? `${BOOKS_DIR}${name}` : null;
  }, [getLocalFilename]);

  const loadDownloadIndex = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(DOWNLOAD_INDEX_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  const saveDownloadIndex = useCallback(async (idx) => {
    await AsyncStorage.setItem(DOWNLOAD_INDEX_KEY, JSON.stringify(idx || {}));
  }, []);

  const loadBookCatalogCache = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(BOOK_CATALOG_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  const saveBookCatalogForGrade = useCallback(async (gradeKey, subjectList) => {
    if (!gradeKey || !Array.isArray(subjectList)) return;

    const cache = await loadBookCatalogCache();
    cache[gradeKey] = {
      updatedAt: Date.now(),
      subjects: subjectList,
    };

    await AsyncStorage.setItem(BOOK_CATALOG_CACHE_KEY, JSON.stringify(cache));
  }, [loadBookCatalogCache]);

  const getBookCatalogForGrade = useCallback(async (gradeKey) => {
    if (!gradeKey) return [];

    const cache = await loadBookCatalogCache();
    return Array.isArray(cache?.[gradeKey]?.subjects) ? cache[gradeKey].subjects : [];
  }, [loadBookCatalogCache]);

  const registerDownloadMetadata = useCallback(async (url, meta) => {
    const filename = getLocalFilename(url);
    if (!filename) return;
    const idx = await loadDownloadIndex();
    const normalizedUnitOrder = Number(meta.unitOrder || meta.order || 0);
    idx[filename] = {
      url,
      title: meta.title || filename,
      subjectName: meta.subjectName || null,
      subjectKey: meta.subjectKey || null,
      unitKey: meta.unitKey || null,
      unitOrder: normalizedUnitOrder > 0 ? normalizedUnitOrder : null,
      coverUrl: meta.coverUrl || null,
      language: meta.language || "",
      region: meta.region || "",
      downloadedAt: Date.now(),
    };
    await saveDownloadIndex(idx);
  }, [getLocalFilename, loadDownloadIndex, saveDownloadIndex]);

  const removeDownloadMetadata = useCallback(async (filename) => {
    const idx = await loadDownloadIndex();
    if (idx[filename]) {
      delete idx[filename];
      await saveDownloadIndex(idx);
    }
  }, [loadDownloadIndex, saveDownloadIndex]);

  const getDownloadMetadataForLocalUri = useCallback(async (localUri) => {
    const filename = getFilenameFromLocalUri(localUri);
    if (!filename) return null;

    const idx = await loadDownloadIndex();
    const meta = idx[filename];

    return meta ? { filename, ...meta } : null;
  }, [loadDownloadIndex]);

  const refreshDownloadedFiles = useCallback(async () => {
    await ensureBooksDir();
    const idx = await loadDownloadIndex();
    const names = await FileSystem.readDirectoryAsync(BOOKS_DIR);
    const list = [];

    for (const name of names) {
      const uri = `${BOOKS_DIR}${name}`;
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) continue;
      if (Number(info.size || 0) <= 0) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
        await removeDownloadMetadata(name);
        continue;
      }
      const meta = idx[name] || {};
      list.push({
        name,
        uri,
        size: info.size || 0,
        modificationTime: info.modificationTime || 0,
        title: meta.title || name,
        url: meta.url || null,
        subjectName: meta.subjectName || null,
        subjectKey: meta.subjectKey || null,
        unitKey: meta.unitKey || null,
        unitOrder: Number(meta.unitOrder || 0) || 0,
        coverUrl: meta.coverUrl || null,
        language: meta.language || "",
        region: meta.region || "",
        downloadedAt: meta.downloadedAt || 0,
      });
    }

    list.sort((a, b) => (b.modificationTime || 0) - (a.modificationTime || 0));
    setDownloadedFilesList(list);
    return list;
  }, [ensureBooksDir, loadDownloadIndex, removeDownloadMetadata]);

  const deleteLocalPdfCopy = useCallback(async (
    localUri,
    {
      removeMetadata = true,
      clearProgress = true,
      clearBookmarks = true,
      refreshList = true,
    } = {}
  ) => {
    if (!localUri) return;

    const filename = getFilenameFromLocalUri(localUri);

    try {
      const info = await FileSystem.getInfoAsync(localUri);
      if (info?.exists) {
        await FileSystem.deleteAsync(localUri, { idempotent: true });
      }
    } catch {}

    if (removeMetadata && filename) {
      await removeDownloadMetadata(filename);
    }

    await deletePdfTextSearchIndex(localUri);
    await removeReaderArtifactsForLocalUri(localUri, { clearProgress, clearBookmarks });

    if (viewerLocalUriRef.current === localUri) {
      readerTextIndexRequestRef.current += 1;
      readerTextIndexRef.current = null;
      setReaderTextIndexState(createInitialReaderTextIndexState(null));
    }

    if (refreshList) {
      await refreshDownloadedFiles();
    }
  }, [refreshDownloadedFiles, removeDownloadMetadata, removeReaderArtifactsForLocalUri]);

  const cancelDownload = useCallback(async (url) => {
    const active = activeDownloadsRef.current[url];
    if (active?.resumable?.cancelAsync) {
      try { await active.resumable.cancelAsync(); } catch {}
    }

    const localPath = getLocalPathForUrl(url);
    if (localPath) {
      const info = await FileSystem.getInfoAsync(localPath);
      if (info.exists) await FileSystem.deleteAsync(localPath, { idempotent: true });
    }

    setDownloadingMap((s) => {
      const c = { ...s };
      delete c[url];
      return c;
    });

    setDownloadProgress((s) => {
      const c = { ...s };
      delete c[url];
      return c;
    });

    delete activeDownloadsRef.current[url];
  }, [getLocalPathForUrl]);

  const downloadToLocal = useCallback(async (url, meta = {}) => {
    await ensureBooksDir();
    const localPath = getLocalPathForUrl(url);

    const finishDownload = async (fileUri) => {
      const resolvedUri = fileUri || localPath;
      const info = await FileSystem.getInfoAsync(resolvedUri);

      if (!info.exists || Number(info.size || 0) <= 0) {
        await FileSystem.deleteAsync(resolvedUri, { idempotent: true });
        throw new Error("Downloaded file is empty.");
      }

      setDownloadingMap((s) => {
        const c = { ...s };
        delete c[url];
        return c;
      });
      setDownloadProgress((s) => ({ ...s, [url]: 1 }));
      delete activeDownloadsRef.current[url];
      await registerDownloadMetadata(url, meta);
      await refreshDownloadedFiles();
      return resolvedUri;
    };

    setDownloadingMap((s) => ({ ...s, [url]: true }));
    setDownloadProgress((s) => ({ ...s, [url]: 0 }));

    const resumable = FileSystem.createDownloadResumable(
      url,
      localPath,
      {},
      (dp) => {
        if (dp.totalBytesExpectedToWrite > 0) {
          setDownloadProgress((s) => ({
            ...s,
            [url]: dp.totalBytesWritten / dp.totalBytesExpectedToWrite,
          }));
        }
      }
    );

    activeDownloadsRef.current[url] = { resumable };

    try {
      const out = await resumable.downloadAsync();
      return await finishDownload(out?.uri);
    } catch (err) {
      try {
        const fb = await FileSystem.downloadAsync(url, localPath);
        return await finishDownload(fb?.uri);
      } catch (e) {
        const info = await FileSystem.getInfoAsync(localPath);
        if (info.exists) await FileSystem.deleteAsync(localPath, { idempotent: true });

        setDownloadingMap((s) => {
          const c = { ...s };
          delete c[url];
          return c;
        });
        setDownloadProgress((s) => {
          const c = { ...s };
          delete c[url];
          return c;
        });
        delete activeDownloadsRef.current[url];
        throw e || err;
      }
    }
  }, [ensureBooksDir, getLocalPathForUrl, registerDownloadMetadata, refreshDownloadedFiles]);

  const closeReaderPanels = useCallback(() => {
    setReaderJumpVisible(false);
    setReaderBookmarksVisible(false);
    setReaderOutlineVisible(false);
    setReaderSearchVisible(false);
  }, []);

  const closeViewer = useCallback(() => {
    readerHiddenCloseTapRef.current = 0;
    setViewerLoading(false);
    setViewerLoadProgress(0);
    setReaderChromeVisible(true);
    closeReaderPanels();
    readerTextIndexRequestRef.current += 1;
    queueReaderProgressSave(viewer.localUri, viewer.currentPage, viewer.totalPages);
    flushReaderProgress().catch(() => null);
    setReaderOutline([]);
    setReaderJumpInput("1");
    setBookmarkEditor({ visible: false, page: 1, label: "", note: "" });
    setReaderSearchQuery("");
    pdfViewRef.current = null;
    setViewer(createInitialViewerState(settings.readerMode));
  }, [closeReaderPanels, flushReaderProgress, queueReaderProgressSave, settings.readerMode, viewer.currentPage, viewer.localUri, viewer.totalPages]);

  const handleReaderHiddenClosePress = useCallback(() => {
    const now = Date.now();

    if (now - readerHiddenCloseTapRef.current <= 320) {
      readerHiddenCloseTapRef.current = 0;
      closeViewer();
      return;
    }

    readerHiddenCloseTapRef.current = now;
  }, [closeViewer]);

  const openLocalPdfInViewer = useCallback((localUri, title, subjectName = "") => {
    if (!localUri) {
      Alert.alert("Unable to load", "This chapter is not downloaded on your phone yet.");
      return;
    }

    if (!NativePdfView) {
      Alert.alert("PDF reader unavailable", nativePdfUnavailableMessage);
      return;
    }

    const progressIndex = readerProgressRef.current;
    const bookmarkIndex = readerBookmarksRef.current;
    const savedProgress = progressIndex?.[localUri] || {};
    const knownTotalPages = Math.max(0, Number(savedProgress.totalPages || 0));
    const initialPage = knownTotalPages
      ? Math.min(clampPositivePage(savedProgress.page, 1), knownTotalPages)
      : clampPositivePage(savedProgress.page, 1);

    setReaderBookmarks(normalizeStoredReaderBookmarks(bookmarkIndex?.[localUri]));
    setReaderOutline([]);
    setReaderJumpInput(String(initialPage));
    setBookmarkEditor({ visible: false, page: initialPage, label: "", note: "" });
    setReaderSearchQuery("");
    setReaderChromeVisible(true);
    setViewerLoading(false);
    setViewerLoadProgress(0);
    setViewer({
      visible: true,
      title,
      subjectName,
      localUri,
      reloadKey: 0,
      initialPage,
      currentPage: initialPage,
      totalPages: knownTotalPages,
      readerMode: normalizeReaderMode(settings.readerMode),
    });
  }, [settings.readerMode]);

  const reloadViewer = useCallback(async () => {
    if (!viewer.localUri) return;

    const localInfo = await FileSystem.getInfoAsync(viewer.localUri).catch(() => null);
    if (!localInfo?.exists || Number(localInfo.size || 0) <= 0) {
      setViewerLoading(false);
      setViewerLoadProgress(0);
      Alert.alert("Saved copy missing", "This chapter file is no longer available on your phone.");
      return;
    }

    setViewerLoading(true);
    setViewerLoadProgress(0);
    setViewer((prev) => {
      if (!prev.localUri) return prev;
      return {
        ...prev,
        reloadKey: prev.reloadKey + 1,
        initialPage: clampPositivePage(prev.currentPage, prev.initialPage),
      };
    });
  }, [viewer.localUri]);

  const handleViewerLoadComplete = useCallback((numberOfPages, _path, _size, tableContents = []) => {
    const safeTotalPages = Math.max(0, Number(numberOfPages || 0));
    const fallbackPage = clampPositivePage(viewer.currentPage, 1);
    const nextPage = safeTotalPages ? Math.min(fallbackPage, safeTotalPages) : fallbackPage;

    setViewerLoading(false);
    setViewerLoadProgress(1);
    setReaderOutline(flattenPdfTableContents(tableContents));
    setReaderJumpInput(String(nextPage));
    setViewer((prev) => ({
      ...prev,
      totalPages: safeTotalPages,
      initialPage: safeTotalPages ? Math.min(clampPositivePage(prev.initialPage, 1), safeTotalPages) : clampPositivePage(prev.initialPage, 1),
      currentPage: nextPage,
    }));

    if (viewerLocalUriRef.current) {
      queueReaderProgressSave(viewerLocalUriRef.current, nextPage, safeTotalPages);
    }
  }, [queueReaderProgressSave, viewer.currentPage]);

  const handleViewerPageChanged = useCallback((page, numberOfPages) => {
    const safePage = clampPositivePage(page, 1);
    const safeTotalPages = Math.max(0, Number(numberOfPages || viewer.totalPages || 0));

    setReaderJumpInput(String(safePage));
    setViewer((prev) => ({
      ...prev,
      currentPage: safePage,
      totalPages: safeTotalPages || prev.totalPages,
    }));

    if (viewerLocalUriRef.current) {
      queueReaderProgressSave(viewerLocalUriRef.current, safePage, safeTotalPages || viewer.totalPages);
    }
  }, [queueReaderProgressSave, viewer.totalPages]);

  const jumpToReaderPage = useCallback((requestedPage, { closePanels = false } = {}) => {
    const safePage = clampPageWithinBounds(requestedPage, viewer.totalPages, viewer.currentPage || 1);

    if (pdfViewRef.current?.setPage) {
      pdfViewRef.current.setPage(safePage);
      setViewer((prev) => ({
        ...prev,
        currentPage: safePage,
        initialPage: safePage,
      }));
    } else {
      setViewer((prev) => ({
        ...prev,
        currentPage: safePage,
        initialPage: safePage,
        reloadKey: prev.reloadKey + 1,
      }));
    }

    setReaderJumpInput(String(safePage));

    if (viewerLocalUriRef.current) {
      queueReaderProgressSave(viewerLocalUriRef.current, safePage, viewer.totalPages);
    }

    if (closePanels) {
      closeReaderPanels();
    }
  }, [closeReaderPanels, queueReaderProgressSave, viewer.currentPage, viewer.totalPages]);

  const submitReaderJump = useCallback(() => {
    if (!viewer.totalPages) {
      Alert.alert("Page count unavailable", "Wait for the chapter to finish loading before jumping to a page.");
      return;
    }

    const requestedPage = Number(readerJumpInput);
    if (!Number.isFinite(requestedPage)) {
      Alert.alert("Invalid page", `Enter a page number between 1 and ${viewer.totalPages}.`);
      return;
    }

    jumpToReaderPage(requestedPage, { closePanels: true });
  }, [jumpToReaderPage, readerJumpInput, viewer.totalPages]);

  const currentReaderBookmark = useMemo(() => {
    return readerBookmarks.find((entry) => entry.page === viewer.currentPage) || null;
  }, [readerBookmarks, viewer.currentPage]);

  const editingReaderBookmark = useMemo(() => {
    return readerBookmarks.find((entry) => entry.page === bookmarkEditor.page) || null;
  }, [bookmarkEditor.page, readerBookmarks]);

  const getBookmarkLabelForPage = useCallback((page) => {
    const exactMatch = readerOutline.find((entry) => entry.page === page);
    return exactMatch?.title || `Page ${page}`;
  }, [readerOutline]);

  const openBookmarkEditor = useCallback((page = viewer.currentPage) => {
    const safePage = clampPageWithinBounds(page, viewer.totalPages, viewer.currentPage || 1);
    const existing = readerBookmarks.find((entry) => entry.page === safePage);

    closeReaderPanels();
    setReaderChromeVisible(true);
    setBookmarkEditor({
      visible: true,
      page: safePage,
      label: existing?.label || getBookmarkLabelForPage(safePage),
      note: existing?.note || "",
    });
  }, [closeReaderPanels, getBookmarkLabelForPage, readerBookmarks, viewer.currentPage, viewer.totalPages]);

  const closeBookmarkEditor = useCallback(() => {
    setBookmarkEditor({ visible: false, page: 1, label: "", note: "" });
  }, []);

  const saveReaderBookmarkDraft = useCallback(async () => {
    const localUri = viewerLocalUriRef.current;
    if (!localUri) return;

    const safePage = clampPageWithinBounds(bookmarkEditor.page, viewer.totalPages, viewer.currentPage || 1);
    const existing = readerBookmarks.find((entry) => entry.page === safePage);
    const label = String(bookmarkEditor.label || "").trim() || getBookmarkLabelForPage(safePage);
    const note = String(bookmarkEditor.note || "").trim();
    const nextBookmarks = readerBookmarks
      .filter((entry) => entry.page !== safePage)
      .concat({
        page: safePage,
        label,
        note,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
      });

    await persistBookmarksForLocalUri(localUri, nextBookmarks);
    closeBookmarkEditor();
  }, [bookmarkEditor.label, bookmarkEditor.note, bookmarkEditor.page, closeBookmarkEditor, getBookmarkLabelForPage, persistBookmarksForLocalUri, readerBookmarks, viewer.currentPage, viewer.totalPages]);

  const deleteReaderBookmark = useCallback(async (page = viewer.currentPage) => {
    const localUri = viewerLocalUriRef.current;
    if (!localUri) return;

    const safePage = clampPageWithinBounds(page, viewer.totalPages, viewer.currentPage || 1);
    const nextBookmarks = readerBookmarks.filter((entry) => entry.page !== safePage);

    await persistBookmarksForLocalUri(localUri, nextBookmarks);

    if (bookmarkEditor.visible && bookmarkEditor.page === safePage) {
      closeBookmarkEditor();
    }
  }, [bookmarkEditor.page, bookmarkEditor.visible, closeBookmarkEditor, persistBookmarksForLocalUri, readerBookmarks, viewer.currentPage, viewer.totalPages]);

  const retryReaderTextIndex = useCallback(() => {
    if (!viewer.localUri) return;
    ensureReaderTextIndex(viewer.localUri, { force: true }).catch(() => null);
  }, [ensureReaderTextIndex, viewer.localUri]);

  const openReaderSearch = useCallback(() => {
    closeReaderPanels();
    setReaderChromeVisible(true);
    setReaderSearchQuery("");
    setReaderSearchVisible(true);
  }, [closeReaderPanels]);

  const openReaderJumpPanel = useCallback(() => {
    closeReaderPanels();
    setReaderChromeVisible(true);
    setReaderJumpInput(String(clampPositivePage(viewer.currentPage, 1)));
    setReaderJumpVisible(true);
  }, [closeReaderPanels, viewer.currentPage]);

  const enterReaderFocusMode = useCallback(() => {
    if (viewerLoading) return;
    closeReaderPanels();
    setReaderChromeVisible(false);
  }, [closeReaderPanels, viewerLoading]);

  const handleReaderPageTap = useCallback((page, x = 0) => {
    if (viewerLoading) return;

    const safeTapX = Number(x || 0);
    const leftZone = windowWidth * 0.28;
    const rightZone = windowWidth * 0.72;

    if (!readerToolsEnabled) {
      if (viewer.readerMode === READER_MODE_PAGED) {
        if (safeTapX <= leftZone && viewer.currentPage > 1) {
          jumpToReaderPage(viewer.currentPage - 1);
        } else if (safeTapX >= rightZone && (!viewer.totalPages || viewer.currentPage < viewer.totalPages)) {
          jumpToReaderPage(viewer.currentPage + 1);
        }
      }

      return;
    }

    if (!readerChromeVisible && viewer.readerMode === READER_MODE_PAGED) {
      if (safeTapX <= leftZone && viewer.currentPage > 1) {
        jumpToReaderPage(viewer.currentPage - 1);
        return;
      }

      if (safeTapX >= rightZone && (!viewer.totalPages || viewer.currentPage < viewer.totalPages)) {
        jumpToReaderPage(viewer.currentPage + 1);
        return;
      }
    }

    setReaderChromeVisible((prev) => {
      const next = !prev;
      if (!next) {
        closeReaderPanels();
      }
      return next;
    });
  }, [
    closeReaderPanels,
    jumpToReaderPage,
    readerChromeVisible,
    viewer.currentPage,
    viewer.readerMode,
    viewer.totalPages,
    viewerLoading,
    windowWidth,
    readerToolsEnabled,
  ]);

  const readerSearchResults = useMemo(() => {
    const rawQuery = String(readerSearchQuery || "").trim();
    const query = rawQuery.toLowerCase();
    const numericQuery = /^\d+$/.test(query) ? Number(query) : 0;
    const canJumpDirectly = numericQuery > 0 && (!viewer.totalPages || numericQuery <= viewer.totalPages);
    const textIndex = readerTextIndexState.lastUpdated >= 0 ? readerTextIndexRef.current : null;

    const directResults = canJumpDirectly
      ? [{
          key: `page-${numericQuery}`,
          kind: "page",
          kindLabel: "Jump",
          title: `Go to page ${numericQuery}`,
          subtitle: "Direct page jump",
          note: "",
          page: numericQuery,
          depth: 0,
        }]
      : [];

    const bookmarkResults = readerBookmarks
      .filter((entry) => {
        if (!query) return true;
        return [entry.label, entry.note, `page ${entry.page}`, String(entry.page)]
          .some((part) => String(part || "").toLowerCase().includes(query));
      })
      .map((entry) => ({
        key: `bookmark-${entry.page}`,
        kind: "bookmark",
        kindLabel: "Bookmark",
        title: entry.label,
        subtitle: `Page ${entry.page}`,
        note: entry.note || "",
        page: entry.page,
        depth: 0,
      }));

    const outlineResults = readerOutline
      .filter((entry) => {
        if (!query) return true;
        return [entry.title, `page ${entry.page}`, String(entry.page)]
          .some((part) => String(part || "").toLowerCase().includes(query));
      })
      .map((entry) => ({
        key: `outline-${entry.key}`,
        kind: "outline",
        kindLabel: "Contents",
        title: entry.title,
        subtitle: `Page ${entry.page}`,
        note: "",
        page: entry.page,
        depth: entry.depth,
      }));

    const reservedResults = query
      ? directResults.length + bookmarkResults.length + outlineResults.length
      : bookmarkResults.length + outlineResults.length;
    const textResults = query && readerTextIndexState.status === "ready"
      ? searchPdfTextSearchIndex(
          textIndex,
          rawQuery,
          Math.max(0, READER_SEARCH_RESULT_LIMIT - reservedResults)
        )
      : [];

    const merged = query
      ? directResults.concat(bookmarkResults, outlineResults, textResults)
      : bookmarkResults.concat(outlineResults.slice(0, READER_SEARCH_RESULT_LIMIT));

    return merged.slice(0, READER_SEARCH_RESULT_LIMIT);
  }, [readerBookmarks, readerOutline, readerSearchQuery, readerTextIndexState.lastUpdated, readerTextIndexState.status, viewer.totalPages]);

  const readerSearchStatusLabel = useMemo(() => {
    if (readerTextIndexState.status === "indexing") {
      return readerTextIndexState.pageCount
        ? `Preparing full text search... ${readerTextIndexState.indexedPages}/${readerTextIndexState.pageCount} pages indexed.`
        : "Preparing full text search...";
    }

    if (readerTextIndexState.status === "ready") {
      return readerTextIndexState.fromCache
        ? `Full text search ready across ${readerTextIndexState.pageCount} pages. Cached for faster reuse.`
        : `Full text search ready across ${readerTextIndexState.pageCount} pages.`;
    }

    if (readerTextIndexState.status === "error") {
      return readerTextIndexState.error || "Full text indexing failed for this PDF.";
    }

    return "Search full PDF text, bookmarks, and chapter contents.";
  }, [readerTextIndexState.error, readerTextIndexState.fromCache, readerTextIndexState.indexedPages, readerTextIndexState.pageCount, readerTextIndexState.status]);

  const handleViewerLinkPress = useCallback(async (href) => {
    const url = String(href || "").trim();
    if (!url) return;

    const normalizedUrl = url.replace(/\s+/g, "");
    const pageMatch = normalizedUrl.match(/^#?page[=:/](\d+)$/i);

    if (pageMatch) {
      jumpToReaderPage(Number(pageMatch[1]), { closePanels: true });
      return;
    }

    try {
      if (/^https?:\/\//i.test(url)) {
        await openBrowserAsync(url, {
          presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
        });
        return;
      }

      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert("Unsupported link", "This PDF link cannot be opened on this device.");
        return;
      }

      await Linking.openURL(url);
    } catch (error) {
      console.warn("PDF link open error:", error);
      Alert.alert("Unable to open link", "This link could not be opened from the PDF.");
    }
  }, [jumpToReaderPage]);

  const repairAndReopenPdf = useCallback(async (localUri, fallbackMeta = null) => {
    const metadata = fallbackMeta || await getDownloadMetadataForLocalUri(localUri);

    if (!metadata?.url) {
      Alert.alert("Repair unavailable", "This saved PDF has no source URL to download again.");
      return;
    }

    setViewerLoading(true);
    setViewerLoadProgress(0);

    try {
      await deleteLocalPdfCopy(localUri, {
        removeMetadata: true,
        clearProgress: false,
        clearBookmarks: false,
        refreshList: false,
      });

      const freshUri = await downloadToLocal(metadata.url, {
        title: metadata.title || viewer.title,
        subjectName: metadata.subjectName || viewer.subjectName,
      });

      await refreshDownloadedFiles();
      await openLocalPdfInViewer(freshUri, metadata.title || viewer.title, metadata.subjectName || viewer.subjectName || "");
    } catch (error) {
      console.warn("Textbook PDF repair error:", error);
      setViewerLoading(false);
      setViewerLoadProgress(0);
      Alert.alert("Repair failed", "A fresh copy could not be downloaded right now.");
    }
  }, [deleteLocalPdfCopy, downloadToLocal, getDownloadMetadataForLocalUri, openLocalPdfInViewer, refreshDownloadedFiles, viewer.subjectName, viewer.title]);

  const handleViewerError = useCallback(async (error) => {
    console.warn("Textbook PDF load error:", error);
    setViewerLoading(false);
    setViewerLoadProgress(0);

    const localUri = viewerLocalUriRef.current;
    const metadata = localUri ? await getDownloadMetadataForLocalUri(localUri) : null;

    Alert.alert(
      "Couldn’t open this chapter",
      metadata?.url
        ? "The saved PDF looks damaged or incomplete. Retry it, or replace the cached copy with a fresh download."
        : "The saved PDF looks damaged or incomplete. Retry it, or close and open the chapter again from the list.",
      [
        { text: "Close", style: "cancel", onPress: closeViewer },
        { text: "Retry", onPress: () => reloadViewer() },
        ...(metadata?.url ? [{ text: "Redownload", onPress: () => repairAndReopenPdf(localUri, metadata) }] : []),
      ]
    );
  }, [closeViewer, getDownloadMetadataForLocalUri, reloadViewer, repairAndReopenPdf]);

  const handleViewerModeToggle = useCallback(() => {
    const nextMode = viewer.readerMode === READER_MODE_PAGED ? READER_MODE_SCROLL : READER_MODE_PAGED;

    setViewer((prev) => ({
      ...prev,
      readerMode: nextMode,
      reloadKey: prev.reloadKey + 1,
      initialPage: clampPositivePage(prev.currentPage, prev.initialPage),
    }));

    updateSetting("readerMode", nextMode).catch(() => null);
  }, [updateSetting, viewer.readerMode]);

  const deleteFile = useCallback(async (file) => {
    await deleteLocalPdfCopy(file.uri, {
      removeMetadata: true,
      clearProgress: true,
      clearBookmarks: true,
    });
  }, [deleteLocalPdfCopy]);

  const loadStudentContext = useCallback(async () => {
    try {
      const sid =
        (await AsyncStorage.getItem("studentNodeKey")) ||
        (await AsyncStorage.getItem("studentId")) ||
        (await AsyncStorage.getItem("username")) ||
        null;

      if (!sid) return null;

      setStudentId(sid);

      const prefix = String(sid).slice(0, 3).toUpperCase();
      const schoolCodeSnap = await get(ref(database, `Platform1/schoolCodeIndex/${prefix}`));
      const resolvedSchoolCode = schoolCodeSnap.exists() ? schoolCodeSnap.val() : null;

      if (resolvedSchoolCode) setSchoolCode(resolvedSchoolCode);

      if (resolvedSchoolCode) {
        const stSnap = await get(ref(database, `Platform1/Schools/${resolvedSchoolCode}/Students/${sid}`));
        if (stSnap.exists()) {
          const st = stSnap.val() || {};
          const g = String(st?.basicStudentInformation?.grade || st?.grade || "").trim();
          if (g) {
            setStudentGrade(g);
            return { studentId: sid, schoolCode: resolvedSchoolCode, grade: g };
          }
        }
      }

      const cached = await AsyncStorage.getItem("studentGrade");
      if (cached) {
        const g = String(cached).toLowerCase().replace("grade", "").trim();
        setStudentGrade(g);
        return { studentId: sid, schoolCode: resolvedSchoolCode, grade: g };
      }
    } catch (err) {
      console.warn("loadStudentContext error:", err);
    }

    return null;
  }, []);

  const loadNotes = useCallback(async (ctx) => {
    if (!ctx?.schoolCode || !ctx?.studentId || !ctx?.grade) return;

    try {
      const gradeKey = normalizeGradeKey(ctx.grade);
      const snap = await get(
        ref(
          database,
          `Platform1/Schools/${ctx.schoolCode}/StudentBookNotes/${ctx.studentId}/${gradeKey}`
        )
      );

      const next = {};
      if (snap.exists()) {
        const val = snap.val() || {};
        Object.keys(val).forEach((subjectKey) => {
          const subjectUnits = val[subjectKey] || {};
          Object.keys(subjectUnits).forEach((unitKey) => {
            const chapterValue = subjectUnits[unitKey] || {};
            const notes = normalizeChapterNotes(chapterValue)
              .sort((a, b) => {
                const ap = a?.pinned ? 1 : 0;
                const bp = b?.pinned ? 1 : 0;
                if (ap !== bp) return bp - ap;
                return (b?.updatedAt || b?.createdAt || 0) - (a?.updatedAt || a?.createdAt || 0);
              });
            next[`${subjectKey}__${unitKey}`] = notes;
          });
        });
      }

      setNotesMap(next);
    } catch (err) {
      console.warn("loadNotes error:", err);
    }
  }, []);

  const applyLoadedSubjects = useCallback((list) => {
    const safeList = Array.isArray(list) ? list : [];
    setSubjects(safeList);
    setBrokenCoverMap({});

  }, []);

  useEffect(() => {
    if (!settings.autoExpandSubjects) return;

    const expandedMap = {};
    subjects.forEach((subject) => {
      expandedMap[subject.subjectKey] = true;
    });
    setExpanded(expandedMap);
  }, [settings.autoExpandSubjects, subjects]);

  const loadBooks = useCallback(async () => {
    const shouldShowLoader = !hasLoadedBooksRef.current;
    let offlineSubjects = buildOfflineSubjectsFromDownloads(downloadedFilesListRef.current);

    if (shouldShowLoader) {
      setLoading(true);
    }

    try {
      await ensureBooksDir();
      const downloadedFiles = await refreshDownloadedFiles();
      offlineSubjects = buildOfflineSubjectsFromDownloads(downloadedFiles);
      await loadSettings();

      const ctx = await loadStudentContext();
      const gradeKey = normalizeGradeKey(ctx?.grade);
      const cachedSubjects = await getBookCatalogForGrade(gradeKey);
      let nextSubjects = cachedSubjects.length ? cachedSubjects : offlineSubjects;

      if (ctx?.grade && gradeKey) {
        try {
          const snap = await get(ref(database, `Platform1/TextBooks/${gradeKey}`));

          if (snap.exists()) {
            nextSubjects = mapBooksCatalogToSubjects(snap.val() || {});
            await saveBookCatalogForGrade(gradeKey, nextSubjects);
          }
        } catch (err) {
          console.warn("TextBooks remote load error:", err);
        }

        await loadNotes(ctx);
      }

      applyLoadedSubjects(nextSubjects);
    } catch (err) {
      console.warn("TextBooks load error:", err);
      applyLoadedSubjects(offlineSubjects);
    } finally {
      hasLoadedBooksRef.current = true;
      setLoading(false);
    }
  }, [
    applyLoadedSubjects,
    ensureBooksDir,
    getBookCatalogForGrade,
    refreshDownloadedFiles,
    loadSettings,
    loadStudentContext,
    loadNotes,
    saveBookCatalogForGrade,
  ]);

  useFocusEffect(
    useCallback(() => {
      loadBooks();
    }, [loadBooks])
  );

  const toggleExpand = useCallback((k) => {
    setExpanded((p) => ({ ...p, [k]: !p[k] }));
  }, []);

  const languages = useMemo(() => {
    const set = new Set(subjects.map((s) => s.language).filter(Boolean));
    return ["All", ...Array.from(set)];
  }, [subjects]);

  const filteredSubjects = useMemo(() => {
    const q = search.trim().toLowerCase();

    let filtered = subjects
      .filter((s) => settings.languageFilter === "All" || s.language === settings.languageFilter)
      .map((s) => {
        const units = !q
          ? s.units
          : s.units.filter((u) => u.title.toLowerCase().includes(q));

        const subjectMatch =
          s.subjectName.toLowerCase().includes(q) ||
          s.title.toLowerCase().includes(q);

        return subjectMatch ? s : { ...s, units, totalUnits: units.length };
      })
      .filter((s) => s.totalUnits > 0 || s.subjectName.toLowerCase().includes(q));

    if (settings.showDownloadedOnly) {
      filtered = filtered
        .map((subject) => {
          const units = subject.units.filter((u) => {
            const path = u.localUri || getLocalPathForUrl(u.pdfUrl);
            return path ? downloadedFilesList.some((f) => f.uri === path) : false;
          });
          return { ...subject, units, totalUnits: units.length };
        })
        .filter((s) => s.totalUnits > 0);
    }

    return filtered;
  }, [
    subjects,
    search,
    settings.languageFilter,
    settings.showDownloadedOnly,
    downloadedFilesList,
    getLocalPathForUrl,
  ]);

  const openNoteEditorWithId = useCallback((subject, unit, noteId = null) => {
    const safeNoteId = typeof noteId === "string" ? noteId : "";
    router.push({
      pathname: "../chapterNote",
      params: {
        schoolCode,
        studentId,
        grade: studentGrade,
        subjectKey: subject.subjectKey,
        subjectTitle: subject.title,
        unitKey: unit.unitKey,
        unitTitle: unit.title,
        noteId: safeNoteId,
      },
    });
  }, [router, schoolCode, studentId, studentGrade]);

  const openNoteSheet = useCallback((subject, unit) => {
    setNoteSheet({ visible: true, subject, unit });
  }, []);

  const closeNoteSheet = useCallback(() => {
    setNoteSheet({ visible: false, subject: null, unit: null });
  }, []);

  const openNoteReader = useCallback((note) => {
    if (!noteSheet.subject || !noteSheet.unit || !note) return;
    setNoteReader({
      visible: true,
      subject: noteSheet.subject,
      unit: noteSheet.unit,
      note,
    });
    closeNoteSheet();
  }, [closeNoteSheet, noteSheet.subject, noteSheet.unit]);

  const closeNoteReader = useCallback(() => {
    setNoteReader({ visible: false, subject: null, unit: null, note: null });
  }, []);

  const selectedChapterNotes = useMemo(() => {
    if (!noteSheet.subject || !noteSheet.unit) return null;
    const noteKey = `${noteSheet.subject.subjectKey}__${noteSheet.unit.unitKey}`;
    return notesMap[noteKey] || [];
  }, [noteSheet.subject, noteSheet.unit, notesMap]);

  const openNoteEditorFromSheet = useCallback((noteId = null) => {
    if (!noteSheet.subject || !noteSheet.unit) return;
    if (!noteId && (selectedChapterNotes?.length || 0) >= MAX_NOTES_PER_CHAPTER) {
      Alert.alert(
        "Note limit reached",
        `You can only create ${MAX_NOTES_PER_CHAPTER} notes in one chapter. Edit or delete an old note to add another one.`
      );
      return;
    }
    const subject = noteSheet.subject;
    const unit = noteSheet.unit;
    closeNoteSheet();
    openNoteEditorWithId(subject, unit, noteId);
  }, [closeNoteSheet, noteSheet.subject, noteSheet.unit, openNoteEditorWithId, selectedChapterNotes]);

  const canAddMoreNotesToSelectedChapter = useMemo(() => {
    return (selectedChapterNotes?.length || 0) < MAX_NOTES_PER_CHAPTER;
  }, [selectedChapterNotes]);

  const openNoteEditorFromReader = useCallback(() => {
    if (!noteReader.subject || !noteReader.unit || !noteReader.note) return;
    const { subject, unit, note } = noteReader;
    closeNoteReader();
    openNoteEditorWithId(subject, unit, note.noteId || null);
  }, [closeNoteReader, noteReader, openNoteEditorWithId]);

  const deleteNoteFromSheet = useCallback(async (note) => {
    if (!noteSheet.subject || !noteSheet.unit || !note || !schoolCode || !studentId || !studentGrade) return;

    const gradeKey = normalizeGradeKey(studentGrade);
    const unitPath = `Platform1/Schools/${schoolCode}/StudentBookNotes/${studentId}/${gradeKey}/${noteSheet.subject.subjectKey}/${noteSheet.unit.unitKey}`;
    const noteId = note.noteId || "";

    try {
      if (noteId === "legacy") {
        await update(ref(database, unitPath), {
          noteId: null,
          studentId: null,
          gradeKey: null,
          subjectKey: null,
          unitKey: null,
          title: null,
          text: null,
          pinned: null,
          colorTag: null,
          createdAt: null,
          updatedAt: null,
        });
      } else {
        await remove(ref(database, `${unitPath}/notes/${noteId}`));
      }

      await loadNotes({ schoolCode, studentId, grade: studentGrade });
    } catch {
      Alert.alert("Delete failed", "Could not remove this note.");
    }
  }, [loadNotes, noteSheet.subject, noteSheet.unit, schoolCode, studentGrade, studentId]);

  const openUnit = useCallback(async (unit, subject) => {
    const subjectName = typeof subject === "string"
      ? subject
      : subject?.subjectName || subject?.title || unit.subjectName || "";
    const url = unit.pdfUrl;

    if (unit.localUri && downloadedUriSet.has(unit.localUri)) {
      openLocalPdfInViewer(unit.localUri, unit.title, subjectName);
      return;
    }

    if (!url) {
      if (unit.localUri) {
        openLocalPdfInViewer(unit.localUri, unit.title, subjectName);
        return;
      }

      Alert.alert("Offline only", "This chapter is not available from the internet right now, but saved chapters will still open offline.");
      return;
    }

    if (downloadingMap[url]) {
      Alert.alert("Download in progress", "Wait for this chapter to finish downloading before opening it.");
      return;
    }

    let localUri = null;
    try {
      const localPath = getLocalPathForUrl(url);
      if (localPath && downloadedUriSet.has(localPath)) {
        localUri = localPath;
      } else {
        const info = localPath ? await FileSystem.getInfoAsync(localPath) : { exists: false };
        if (info.exists && Number(info.size || 0) > 0) {
          localUri = localPath;
        } else if (info.exists && localPath) {
          await FileSystem.deleteAsync(localPath, { idempotent: true });
        }
      }
    } catch {}

    if (!localUri) {
      try {
        localUri = await downloadToLocal(url, {
          title: unit.title,
          subjectName,
          subjectKey: typeof subject === "object" ? subject?.subjectKey || null : unit.subjectKey || null,
          unitKey: unit.unitKey || null,
          unitOrder: unit.order || null,
          coverUrl: typeof subject === "object" ? subject?.coverUrl || null : null,
          language: typeof subject === "object" ? subject?.language || "" : "",
          region: typeof subject === "object" ? subject?.region || "" : "",
        });
      } catch {
        Alert.alert("Download failed", "This chapter could not be saved to your phone. Please try downloading it again.");
        return;
      }
    }

    openLocalPdfInViewer(localUri, unit.title, subjectName);
  }, [downloadToLocal, downloadedUriSet, downloadingMap, getLocalPathForUrl, openLocalPdfInViewer]);

  const downloadOrCancel = useCallback(async (unit, subject) => {
    const subjectName = typeof subject === "string"
      ? subject
      : subject?.subjectName || subject?.title || unit.subjectName || "";
    const url = unit.pdfUrl;

    if (!url) {
      if (unit.localUri) {
        Alert.alert("Saved chapter", "This chapter is already downloaded and can be opened offline from the chapter row.");
        return;
      }

      Alert.alert("No PDF", "This unit has no pdfUrl.");
      return;
    }

    if (downloadingMap[url]) {
      return Alert.alert("Cancel download?", "", [
        { text: "No", style: "cancel" },
        { text: "Yes", onPress: () => cancelDownload(url) },
      ]);
    }

    try {
      await downloadToLocal(url, {
        title: unit.title,
        subjectName,
        subjectKey: typeof subject === "object" ? subject?.subjectKey || null : unit.subjectKey || null,
        unitKey: unit.unitKey || null,
        unitOrder: unit.order || null,
        coverUrl: typeof subject === "object" ? subject?.coverUrl || null : null,
        language: typeof subject === "object" ? subject?.language || "" : "",
        region: typeof subject === "object" ? subject?.region || "" : "",
      });
      Alert.alert("Done", "Unit downloaded.");
    } catch {
      Alert.alert("Failed", "Download failed.");
    }
  }, [cancelDownload, downloadToLocal, downloadingMap]);

  const totalDownloadedSizeMB = useMemo(() => {
    const total = downloadedFilesList.reduce((s, f) => s + (f.size || 0), 0);
    return (total / (1024 * 1024)).toFixed(2);
  }, [downloadedFilesList]);

  const totalUnits = useMemo(
    () => subjects.reduce((sum, s) => sum + (s.totalUnits || 0), 0),
    [subjects]
  );

  const totalNotes = useMemo(() => {
    return Object.values(notesMap).reduce((sum, notes) => sum + (Array.isArray(notes) ? notes.length : 0), 0);
  }, [notesMap]);

  const activeIndicators = useMemo(() => {
    const out = [];
    if (settings.languageFilter !== "All") out.push(settings.languageFilter);
    if (settings.showDownloadedOnly) out.push("Downloaded Only");
    if (settings.compactMode) out.push("Compact");
    return out;
  }, [settings]);

  const readerStatusLabel = useMemo(() => {
    const modeLabel = viewer.readerMode === READER_MODE_PAGED ? "Swipe mode" : "Scroll mode";
    if (viewer.initialPage > 1) {
      return `Resuming from page ${viewer.initialPage} • ${modeLabel}`;
    }
    return `${modeLabel} • Tap the page to hide controls`;
  }, [viewer.initialPage, viewer.readerMode]);

  const readerCurrentSection = useMemo(() => {
    if (!readerOutline.length) return null;

    let currentSection = null;
    for (const entry of readerOutline) {
      if (entry.page <= viewer.currentPage) {
        currentSection = entry;
      } else {
        break;
      }
    }

    return currentSection;
  }, [readerOutline, viewer.currentPage]);

  const readerNextSection = useMemo(() => {
    return readerOutline.find((entry) => entry.page > viewer.currentPage) || null;
  }, [readerOutline, viewer.currentPage]);

  const readerProgressPercent = useMemo(() => {
    if (!viewer.totalPages) return 0;
    return Math.min(100, Math.max(1, Math.round((viewer.currentPage / viewer.totalPages) * 100)));
  }, [viewer.currentPage, viewer.totalPages]);

  const readerRemainingPages = useMemo(() => {
    if (!viewer.totalPages) return 0;
    return Math.max(viewer.totalPages - viewer.currentPage, 0);
  }, [viewer.currentPage, viewer.totalPages]);

  const readerCanGoBackward = viewer.currentPage > 1;
  const readerCanGoForward = viewer.totalPages ? viewer.currentPage < viewer.totalPages : false;

  const readerSectionSummary = useMemo(() => {
    if (readerNextSection) {
      return `Next: ${readerNextSection.title} on page ${readerNextSection.page}`;
    }

    if (!viewer.totalPages) {
      return "Page count will appear after the PDF finishes loading.";
    }

    if (!readerRemainingPages) {
      return "You are on the last page of this chapter.";
    }

    return `${readerRemainingPages} page${readerRemainingPages === 1 ? "" : "s"} left in this chapter.`;
  }, [readerNextSection, readerRemainingPages, viewer.totalPages]);

  const readerPageChipLabel = useMemo(() => {
    if (!viewer.totalPages) {
      return `Page ${viewer.currentPage}`;
    }

    return `Page ${viewer.currentPage} / ${viewer.totalPages}`;
  }, [viewer.currentPage, viewer.totalPages]);

  const isCurrentPageBookmarked = Boolean(currentReaderBookmark);

  const handleScroll = useCallback((e) => {
    const y = e.nativeEvent.contentOffset.y;
    const shouldShow = y > 70 && activeIndicators.length > 0;
    
    setShowFloatingIndicators(shouldShow);
    
    Animated.timing(floatingAnimValue, {
      toValue: shouldShow ? 1 : 0,
      duration: shouldShow ? 250 : 300,
      useNativeDriver: false,
    }).start();
  }, [activeIndicators.length, floatingAnimValue]);

  const renderListHeader = () => (
    <View>
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <View style={[styles.statIconWrap, styles.statIconBlue]}>
            <Ionicons name="library-outline" size={15} color={PRIMARY} />
          </View>
          <Text style={styles.statValue}>{subjects.length}</Text>
          <Text style={styles.statLabel}>Subjects</Text>
        </View>
        <View style={styles.statCard}>
          <View style={[styles.statIconWrap, styles.statIconPurple]}>
            <Ionicons name="reader-outline" size={15} color={PRIMARY} />
          </View>
          <Text style={styles.statValue}>{totalUnits}</Text>
          <Text style={styles.statLabel}>Chapters</Text>
        </View>
        <View style={[styles.statCard, { marginRight: 0 }]}>
          <View style={[styles.statIconWrap, styles.statIconGreen]}>
            <Ionicons name="document-text-outline" size={15} color={SUCCESS} />
          </View>
          <Text style={styles.statValue}>{totalNotes}</Text>
          <Text style={styles.statLabel}>Notes</Text>
        </View>
      </View>

      <View style={styles.inlineIndicatorsWrap}>
        {activeIndicators.map((item) => (
          <View key={item} style={styles.activeChip}>
            <Text style={styles.activeChipText}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  const formatNoteDate = useCallback((value) => {
    if (!value) return "Saved note";
    try {
      return new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "Saved note";
    }
  }, []);

  const formatFileSize = useCallback((bytes) => {
    const size = Number(bytes || 0);
    if (size <= 0) return "0 KB";

    const units = ["KB", "MB", "GB", "TB"];
    let value = size / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
  }, []);

  function SwipeableNoteCard({ note }) {
    const translateX = useRef(new Animated.Value(0)).current;
    const openRef = useRef(false);
    const ACTION_WIDTH = 116;

    const animateTo = useCallback((toValue) => {
      openRef.current = toValue < 0;
      Animated.spring(translateX, {
        toValue,
        useNativeDriver: true,
        bounciness: 0,
        speed: 18,
      }).start();
    }, [translateX]);

    const panResponder = useRef(
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
        },
        onPanResponderMove: (_, gestureState) => {
          const nextX = openRef.current
            ? Math.min(0, Math.max(-ACTION_WIDTH, -ACTION_WIDTH + gestureState.dx))
            : Math.min(0, Math.max(-ACTION_WIDTH, gestureState.dx));
          translateX.setValue(nextX);
        },
        onPanResponderRelease: (_, gestureState) => {
          const shouldOpen = openRef.current
            ? gestureState.dx < 28
            : gestureState.dx < -36;
          animateTo(shouldOpen ? -ACTION_WIDTH : 0);
        },
        onPanResponderTerminate: () => {
          animateTo(openRef.current ? -ACTION_WIDTH : 0);
        },
      })
    ).current;

    return (
      <View style={styles.noteSwipeRow}>
        <View style={styles.noteSwipeActions}>
          <TouchableOpacity
            style={[styles.noteSwipeActionBtn, styles.noteSwipeEditBtn]}
            activeOpacity={0.9}
            onPress={() => openNoteEditorFromSheet(note.noteId || null)}
          >
            <Ionicons name="create-outline" size={18} color={colors.white} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.noteSwipeActionBtn, styles.noteSwipeDeleteBtn]}
            activeOpacity={0.9}
            onPress={() =>
              Alert.alert("Delete note", "Remove this note from the chapter list?", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => deleteNoteFromSheet(note),
                },
              ])
            }
          >
            <Ionicons name="trash-outline" size={18} color={colors.white} />
          </TouchableOpacity>
        </View>

        <Animated.View
          style={[
            styles.noteSwipeCardWrap,
            { transform: [{ translateX }] },
          ]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity
            style={styles.noteListCard}
            activeOpacity={0.9}
            onPress={() => {
              if (openRef.current) {
                animateTo(0);
                return;
              }
              openNoteReader(note);
            }}
          >
            <View style={styles.noteListHeader}>
              <View style={styles.noteListIconWrap}>
                <Ionicons name="create-outline" size={16} color={PRIMARY} />
              </View>
              <View style={styles.noteListTextWrap}>
                <View style={styles.noteListTopLine}>
                  <Text style={styles.noteListTitle} numberOfLines={1}>
                    {note.title || `${noteSheet.unit?.title || "Chapter"} Note`}
                  </Text>
                  {note.pinned ? (
                    <View style={styles.notePinnedPill}>
                      <Ionicons name="pin" size={10} color={PRIMARY} />
                      <Text style={styles.notePinnedText}>Pinned</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.noteListPreview} numberOfLines={2}>
                  {note.text || ""}
                </Text>
              </View>
              <View style={styles.noteSwipeHint}>
                <Ionicons name="chevron-back" size={12} color={MUTED} />
                <Text style={styles.noteSwipeHintText}>Swipe left</Text>
              </View>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  if (!subjects.length) {
    return (
      <View style={styles.emptyContainer}>
        <Image
          source={require("../../assets/images/no_data_illustrator.jpg")}
          style={styles.emptyImage}
          resizeMode="contain"
        />
        <Text style={styles.emptyTitle}>No textbooks available</Text>
        <Text style={styles.emptySubtitle}>
          We couldn’t find textbooks for grade {studentGrade || "—"}.
        </Text>
      </View>
    );
  }

  function UnitRow({ unit, subject, index }) {
    const url = unit.pdfUrl;
    const isDownloading = !!(url && downloadingMap[url]);
    const progress = Math.round((downloadProgress[url] || 0) * 100);
    const noteKey = `${subject.subjectKey}__${unit.unitKey}`;
    const chapterNotes = notesMap[noteKey] || [];
    const hasNote = chapterNotes.length > 0;

    const resolvedLocalUri = unit.localUri || (url ? getLocalPathForUrl(url) : null);
    const downloaded = !!resolvedLocalUri && downloadedUriSet.has(resolvedLocalUri);

    return (
      <View style={[styles.unitRow, settings.compactMode && styles.unitRowCompact]}>
        <TouchableOpacity
          style={styles.unitMainTap}
          activeOpacity={0.75}
          onPress={() => openUnit(unit, subject)}
        >
          <View style={styles.unitOrderBadge}>
            <Text style={styles.unitOrderText}>{unit.order || index + 1}</Text>
          </View>

          <View style={styles.unitTextWrap}>
            <View style={styles.unitTitleRow}>
              <Text style={styles.unitTitle}>{unit.title}</Text>
              {hasNote ? (
                <View style={styles.noteBadge}>
                  <Ionicons name="create-outline" size={12} color={PRIMARY} />
                  <Text style={styles.noteBadgeText}>{chapterNotes.length} Note{chapterNotes.length === 1 ? "" : "s"}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>

        {isDownloading ? (
          <TouchableOpacity onPress={() => cancelDownload(url)} style={styles.progressWrap}>
            <ActivityIndicator color={colors.white} size="small" />
            <Text style={styles.progressText}>{progress}%</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.unitActions}>
            <TouchableOpacity
              onPress={() => openNoteSheet(subject, unit)}
              style={[styles.noteActionBtn, hasNote && styles.noteActionBtnActive]}
            >
              <View style={[styles.noteActionIconWrap, hasNote && styles.noteActionIconWrapActive]}>
                <Ionicons name={hasNote ? "create" : "create-outline"} size={16} color={hasNote ? colors.white : PRIMARY} />
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => downloadOrCancel(unit, subject)}
              style={[styles.iconDownload, downloaded ? styles.iconDownloaded : null]}
            >
              <Ionicons
                name={downloaded ? "cloud-done" : "cloud-download-outline"}
                size={18}
                color={downloaded ? colors.white : PRIMARY}
              />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.stickyWrap}>
        <View style={styles.topUtilityRow}>
          <View style={styles.searchCard}>
            <View style={styles.searchIconWrap}>
              <Ionicons name="search-outline" size={16} color={PRIMARY} />
            </View>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search subject or chapter"
              placeholderTextColor={MUTED}
              style={styles.searchInput}
            />
          </View>

          <TouchableOpacity
            style={styles.topActionBtn}
            onPress={async () => {
              await refreshDownloadedFiles();
              setManagerVisible(true);
            }}
          >
            <Ionicons name="cloud-download-outline" size={18} color={PRIMARY} />
            {downloadedFilesList.length ? <View style={styles.topActionDot} /> : null}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.topActionBtn}
            onPress={() => setSettingsVisible(true)}
          >
            <Ionicons name="options-outline" size={18} color={PRIMARY} />
          </TouchableOpacity>
        </View>

        <Animated.View
          pointerEvents={showFloatingIndicators ? "auto" : "none"}
          style={[
          styles.floatingIndicatorsWrap,
          {
            transform: [{ translateY: floatingAnimValue.interpolate({
              inputRange: [0, 1],
              outputRange: [-20, 0],
            }) }],
            opacity: floatingAnimValue,
            maxHeight: floatingAnimValue.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 100],
            }),
            paddingHorizontal: 16,
            paddingTop: floatingAnimValue.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 8],
            }),
            paddingBottom: floatingAnimValue.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 10],
            }),
          }
        ]}>
          {activeIndicators.map((item) => (
            <View key={item} style={styles.activeChip}>
              <Text style={styles.activeChipText}>{item}</Text>
            </View>
          ))}
        </Animated.View>
      </View>

      <FlatList
        data={filteredSubjects}
        keyExtractor={(item) => item.subjectKey}
        contentContainerStyle={styles.list}
        ListHeaderComponent={renderListHeader}
        stickyHeaderIndices={[]}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <View style={[styles.card, expanded[item.subjectKey] && styles.cardSelected]}>
            <TouchableOpacity
              style={[styles.cardHeader, expanded[item.subjectKey] && styles.cardHeaderExpanded]}
              activeOpacity={0.92}
              onPress={() => toggleExpand(item.subjectKey)}
            >
              <View style={styles.cardHeaderLeft}>
                {item.coverUrl && !brokenCoverMap[item.subjectKey] ? (
                  <Image
                    source={{ uri: item.coverUrl }}
                    style={styles.cover}
                    resizeMode="cover"
                    onError={() =>
                      setBrokenCoverMap((prev) => ({ ...prev, [item.subjectKey]: true }))
                    }
                  />
                ) : (
                  <View style={[styles.cover, styles.subjectIconContainer]}>
                    <Ionicons 
                      name={getSubjectIcon(item.title)} 
                      size={32} 
                      color={getSubjectColor(item.title, resolvedAppearance === "dark")} 
                    />
                  </View>
                )}
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={styles.subjectName}>{item.title}</Text>
                  <Text style={styles.subjectSub}>
                    {item.totalUnits} chapter{item.totalUnits === 1 ? "" : "s"}
                  </Text>

                  <View style={{ flexDirection: "row", marginTop: 6, flexWrap: "wrap" }}>
                    {!!item.language && <Text style={styles.metaChip}>{item.language}</Text>}
                    {!!item.region && <Text style={styles.metaChip}>{item.region}</Text>}
                  </View>
                </View>
              </View>

              <View style={[styles.cardHeaderToggle, expanded[item.subjectKey] && styles.cardHeaderToggleActive]}>
                <Ionicons
                  name={expanded[item.subjectKey] ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={expanded[item.subjectKey] ? PRIMARY : MUTED}
                />
              </View>
            </TouchableOpacity>

            {expanded[item.subjectKey] && (
              <View style={styles.unitsContainer}>
                {item.units.map((u, idx) => (
                  <UnitRow key={u.unitKey} unit={u} subject={item} index={idx} />
                ))}
              </View>
            )}
          </View>
        )}
      />

      <Modal visible={noteSheet.visible} transparent animationType="slide" onRequestClose={closeNoteSheet}>
        <Pressable style={styles.modalBackdrop} onPress={closeNoteSheet} />
        <View style={styles.noteSheetWrap}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Chapter Notes</Text>
          <Text style={styles.noteSheetSubtitle}>{noteSheet.unit?.title || "Select a chapter note"}</Text>

          <View style={styles.noteLimitCard}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={styles.noteLimitTitle}>Note slots</Text>
              <Text style={styles.noteLimitText}>
                {selectedChapterNotes?.length || 0}/{MAX_NOTES_PER_CHAPTER} used in this chapter.
              </Text>
            </View>
            <View style={[styles.noteLimitPill, !canAddMoreNotesToSelectedChapter && styles.noteLimitPillFull]}>
              <Text style={[styles.noteLimitPillText, !canAddMoreNotesToSelectedChapter && styles.noteLimitPillTextFull]}>
                {canAddMoreNotesToSelectedChapter ? "Can add" : "Full"}
              </Text>
            </View>
          </View>

          {selectedChapterNotes?.length ? (
            <View>
              {selectedChapterNotes.map((note) => (
                <SwipeableNoteCard
                  key={note.noteId || `${note.title || "note"}-${note.updatedAt || note.createdAt || 0}`}
                  note={note}
                />
              ))}
              <TouchableOpacity
                style={[
                  styles.noteAddAnotherBtn,
                  !canAddMoreNotesToSelectedChapter && styles.noteAddAnotherBtnDisabled,
                ]}
                activeOpacity={0.88}
                onPress={() => openNoteEditorFromSheet(null)}
                disabled={!canAddMoreNotesToSelectedChapter}
              >
                <Ionicons
                  name={canAddMoreNotesToSelectedChapter ? "add-outline" : "lock-closed-outline"}
                  size={16}
                  color={canAddMoreNotesToSelectedChapter ? PRIMARY : MUTED}
                />
                <Text
                  style={[
                    styles.noteAddAnotherText,
                    !canAddMoreNotesToSelectedChapter && styles.noteAddAnotherTextDisabled,
                  ]}
                >
                  {canAddMoreNotesToSelectedChapter ? "Add New Note" : "5 notes reached"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.noteEmptyState} activeOpacity={0.86} onPress={() => openNoteEditorFromSheet(null)}>
              <View style={styles.noteEmptyIconWrap}>
                <Ionicons name="document-text-outline" size={20} color={PRIMARY} />
              </View>
              <Text style={styles.noteEmptyTitle}>No note yet</Text>
              <Text style={styles.noteEmptyText}>Create a note for this chapter from here.</Text>
              <View style={styles.noteInlinePrimaryAction}>
                <Ionicons name="add-outline" size={16} color={colors.white} />
                <Text style={styles.noteInlinePrimaryActionText}>Add New Note</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      </Modal>

      <Modal visible={noteReader.visible} animationType="slide" onRequestClose={closeNoteReader}>
        <SafeAreaView style={styles.noteReaderScreen}>
          <View style={styles.noteReaderTopBar}>
            <TouchableOpacity style={styles.noteReaderIconBtn} onPress={closeNoteReader}>
              <Ionicons name="arrow-back" size={20} color={TEXT} />
            </TouchableOpacity>

            <View style={styles.noteReaderTopText}>
              <Text numberOfLines={1} style={styles.noteReaderUnitTitle}>
                {noteReader.unit?.title || "Chapter Note"}
              </Text>
              <Text numberOfLines={1} style={styles.noteReaderTopSubtitle}>
                {noteReader.subject?.title || "Subject"}
              </Text>
            </View>

            <TouchableOpacity style={styles.noteReaderEditBtn} onPress={openNoteEditorFromReader}>
              <Text style={styles.noteReaderEditText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.noteReaderScroll}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.noteReaderHero}>
              <View style={styles.noteReaderHeaderRow}>
                <View style={styles.noteReaderTypePill}>
                  <Ionicons name="time-outline" size={12} color={PRIMARY} />
                  <Text style={styles.noteReaderTypeText}>
                    {formatNoteDate(noteReader.note?.updatedAt || noteReader.note?.createdAt)}
                  </Text>
                </View>
                {noteReader.note?.pinned ? (
                  <View style={styles.noteReaderPinnedPill}>
                    <Ionicons name="pin" size={12} color={PRIMARY} />
                    <Text style={styles.noteReaderPinnedText}>Pinned</Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.noteReaderTitle}>
                {noteReader.note?.title || `${noteReader.unit?.title || "Chapter"} Note`}
              </Text>
            </View>

            <View
              style={[
                styles.noteReaderBodyCard,
                {
                  backgroundColor: noteReader.note?.colorTag
                    ? resolveNoteColorTag(noteReader.note.colorTag, colors, colors.inputBackground)
                    : colors.inputBackground,
                },
              ]}
            >
              <View style={styles.noteReaderBodyHeader}>
                <Ionicons name="create-outline" size={15} color={PRIMARY} />
                <Text style={styles.noteReaderBodyLabel}>Note Content</Text>
              </View>
              <View style={styles.noteReaderDivider} />
              <Text
                selectable
                style={[
                  styles.noteReaderBodyText,
                  !noteReader.note?.text && styles.noteReaderBodyTextEmpty,
                ]}
              >
                {noteReader.note?.text || "No saved note content yet."}
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={settingsVisible} transparent animationType="slide" onRequestClose={() => setSettingsVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSettingsVisible(false)} />
        <View style={styles.bottomSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Reading Settings</Text>

          <FlatList
            data={[]}
            renderItem={null}
            ListHeaderComponent={
              <View>
                <Text style={styles.settingsSectionTitle}>Language</Text>
                <View style={styles.languageWrap}>
                  {languages.map((lang) => (
                    <TouchableOpacity
                      key={lang}
                      onPress={() => updateSetting("languageFilter", lang)}
                      style={[
                        styles.filterChip,
                        settings.languageFilter === lang ? styles.filterChipOn : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          settings.languageFilter === lang ? styles.filterChipTextOn : null,
                        ]}
                      >
                        {lang}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.settingsSectionTitle}>Preferences</Text>

                <Text style={styles.settingsSectionTitle}>Reader</Text>
                <View style={styles.languageWrap}>
                  <TouchableOpacity
                    onPress={() => updateSetting("readerMode", READER_MODE_SCROLL)}
                    style={[
                      styles.filterChip,
                      normalizeReaderMode(settings.readerMode) === READER_MODE_SCROLL ? styles.filterChipOn : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        normalizeReaderMode(settings.readerMode) === READER_MODE_SCROLL ? styles.filterChipTextOn : null,
                      ]}
                    >
                      Fit-width Scroll
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => updateSetting("readerMode", READER_MODE_PAGED)}
                    style={[
                      styles.filterChip,
                      normalizeReaderMode(settings.readerMode) === READER_MODE_PAGED ? styles.filterChipOn : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        normalizeReaderMode(settings.readerMode) === READER_MODE_PAGED ? styles.filterChipTextOn : null,
                      ]}
                    >
                      Page Swipe
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.settingRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingTitle}>Show downloaded only</Text>
                    <Text style={styles.settingSubtitle}>Hide chapters not downloaded yet</Text>
                  </View>
                  <Switch
                    value={settings.showDownloadedOnly}
                    onValueChange={(v) => updateSetting("showDownloadedOnly", v)}
                    trackColor={{ false: colors.border, true: colors.soft }}
                    thumbColor={settings.showDownloadedOnly ? PRIMARY : colors.white}
                  />
                </View>

                <View style={styles.settingRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingTitle}>Auto-expand subjects</Text>
                    <Text style={styles.settingSubtitle}>Open all subjects automatically</Text>
                  </View>
                  <Switch
                    value={settings.autoExpandSubjects}
                    onValueChange={(v) => updateSetting("autoExpandSubjects", v)}
                    trackColor={{ false: colors.border, true: colors.soft }}
                    thumbColor={settings.autoExpandSubjects ? PRIMARY : colors.white}
                  />
                </View>

                <View style={styles.settingRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingTitle}>Compact mode</Text>
                    <Text style={styles.settingSubtitle}>Show tighter chapter rows</Text>
                  </View>
                  <Switch
                    value={settings.compactMode}
                    onValueChange={(v) => updateSetting("compactMode", v)}
                    trackColor={{ false: colors.border, true: colors.soft }}
                    thumbColor={settings.compactMode ? PRIMARY : colors.white}
                  />
                </View>
              </View>
            }
          />
        </View>
      </Modal>

      <Modal visible={viewer.visible} animationType="none" onRequestClose={closeViewer}>
        <SafeAreaView style={styles.readerContainer}>
          <View style={readerBodyWrapStyle}>
            {viewer.localUri && NativePdfView ? (
              <>
                <NativePdfView
                  ref={pdfViewRef}
                  key={`${viewer.localUri}-${viewer.reloadKey}-${viewer.readerMode}`}
                  source={{ uri: viewer.localUri, cache: false }}
                  page={viewer.initialPage}
                  style={styles.readerWebView}
                  fitPolicy={0}
                  minScale={1}
                  maxScale={4}
                  spacing={viewer.readerMode === READER_MODE_PAGED ? 0 : 12}
                  horizontal={viewer.readerMode === READER_MODE_PAGED}
                  enablePaging={viewer.readerMode === READER_MODE_PAGED}
                  enableAntialiasing
                  enableAnnotationRendering
                  onLoadProgress={(progress) => setViewerLoadProgress(Number(progress || 0))}
                  onLoadComplete={handleViewerLoadComplete}
                  onPageChanged={handleViewerPageChanged}
                  onPageSingleTap={handleReaderPageTap}
                  onPressLink={handleViewerLinkPress}
                  onError={handleViewerError}
                  enableDoubleTapZoom
                />

                {readerToolsEnabled ? (
                  <>
                    <Animated.View
                      pointerEvents={readerChromeVisible ? "auto" : "none"}
                      style={[
                        styles.readerTopOverlay,
                        {
                          opacity: readerChromeAnimValue,
                          transform: [{
                            translateY: readerChromeAnimValue.interpolate({
                              inputRange: [0, 1],
                              outputRange: [-26, 0],
                            }),
                          }],
                        },
                      ]}
                    >
                      <View style={readerHeaderStyle}>
                        <TouchableOpacity onPress={closeViewer} style={styles.readerHeaderIconBtn} hitSlop={8}>
                          <Ionicons name="arrow-back" size={20} color={TEXT} />
                        </TouchableOpacity>

                        <View style={styles.readerTitleWrap}>
                          <Text style={[styles.readerTitle, isReaderWideLayout && styles.readerTitleWide]} numberOfLines={isReaderWideLayout ? 2 : 1}>{viewer.title}</Text>
                          {!!viewer.subjectName && (
                            <Text style={[styles.readerSubtitle, isReaderWideLayout && styles.readerSubtitleWide]} numberOfLines={1}>{viewer.subjectName}</Text>
                          )}

                          <View style={styles.readerMetaPillRow}>
                            <View style={[styles.readerMetaPill, styles.readerMetaPillPrimary]}>
                              <Ionicons name="compass-outline" size={12} color={PRIMARY} />
                              <Text style={styles.readerMetaPillText} numberOfLines={1}>
                                {readerCurrentSection?.title || "Chapter reader"}
                              </Text>
                            </View>

                            <View style={styles.readerMetaPill}>
                              <Ionicons name="stats-chart-outline" size={12} color={PRIMARY} />
                              <Text style={styles.readerMetaPillText}>
                                {viewer.totalPages ? `${readerProgressPercent}% read` : "Loading"}
                              </Text>
                            </View>

                            {isCurrentPageBookmarked ? (
                              <View style={styles.readerMetaPill}>
                                <Ionicons name="bookmark" size={12} color={PRIMARY} />
                                <Text style={styles.readerMetaPillText}>Saved</Text>
                              </View>
                            ) : null}
                          </View>

                          <Text style={[styles.readerStatusText, isReaderWideLayout && styles.readerStatusTextWide]} numberOfLines={1}>
                            {readerStatusLabel}
                          </Text>
                        </View>

                        <View style={styles.readerHeaderActions}>
                          <TouchableOpacity
                            onPress={handleViewerModeToggle}
                            style={[
                              styles.readerHeaderIconBtn,
                              styles.readerHeaderActionBtn,
                              viewer.readerMode === READER_MODE_PAGED && styles.readerModeBtnActive,
                            ]}
                            hitSlop={8}
                          >
                            <Ionicons
                              name={viewer.readerMode === READER_MODE_PAGED ? "albums-outline" : "reader-outline"}
                              size={18}
                              color={PRIMARY}
                            />
                          </TouchableOpacity>

                          <TouchableOpacity
                            onPress={reloadViewer}
                            style={[styles.readerHeaderIconBtn, styles.readerHeaderActionBtn]}
                            hitSlop={8}
                          >
                            <Ionicons name="refresh" size={18} color={PRIMARY} />
                          </TouchableOpacity>

                          <TouchableOpacity
                            onPress={enterReaderFocusMode}
                            style={[styles.readerHeaderIconBtn, styles.readerHeaderActionBtn]}
                            hitSlop={8}
                          >
                            <Ionicons name="scan-outline" size={18} color={PRIMARY} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </Animated.View>

                    <Animated.View
                      pointerEvents={readerChromeVisible ? "auto" : "none"}
                      style={[
                        styles.readerBottomOverlay,
                        {
                          opacity: readerChromeAnimValue,
                          transform: [{
                            translateY: readerChromeAnimValue.interpolate({
                              inputRange: [0, 1],
                              outputRange: [34, 0],
                            }),
                          }],
                        },
                      ]}
                    >
                      <View style={readerBottomDockStyle}>
                        <View style={styles.readerDockTopRow}>
                          <View style={styles.readerDockSectionWrap}>
                            <Text style={styles.readerDockEyebrow}>Current section</Text>
                            <Text style={styles.readerDockSectionTitle} numberOfLines={1}>
                              {readerCurrentSection?.title || viewer.subjectName || "Chapter overview"}
                            </Text>
                            <Text style={styles.readerDockSectionHint} numberOfLines={1}>
                              {readerSectionSummary}
                            </Text>
                          </View>

                          <TouchableOpacity style={styles.readerDockFocusBtn} onPress={enterReaderFocusMode}>
                            <Ionicons name="scan-outline" size={18} color={PRIMARY} />
                          </TouchableOpacity>
                        </View>

                        <TouchableOpacity style={styles.readerProgressCard} activeOpacity={0.9} onPress={openReaderJumpPanel}>
                          <View style={styles.readerProgressHeaderRow}>
                            <Text style={styles.readerProgressLabel}>Reading progress</Text>
                            <Text style={styles.readerProgressValue}>
                              {viewer.totalPages ? `${readerProgressPercent}%` : "--"}
                            </Text>
                          </View>

                          <View style={styles.readerProgressTrack}>
                            <View
                              style={[
                                styles.readerProgressFill,
                                { width: viewer.totalPages ? `${Math.max(readerProgressPercent, 4)}%` : "12%" },
                              ]}
                            />
                          </View>

                          <View style={styles.readerProgressFooterRow}>
                            <Text style={styles.readerProgressFooterText}>
                              Page {viewer.currentPage} of {viewer.totalPages || "--"}
                            </Text>
                            <Text style={styles.readerProgressFooterText}>
                              {viewer.totalPages
                                ? `${readerRemainingPages} page${readerRemainingPages === 1 ? "" : "s"} left`
                                : "Tap to jump"}
                            </Text>
                          </View>
                        </TouchableOpacity>

                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          style={styles.readerDockToolScroller}
                          contentContainerStyle={readerToolRowStyle}
                        >
                          <TouchableOpacity
                            style={[styles.readerToolBtn, !readerCanGoBackward && styles.readerToolBtnDisabled]}
                            onPress={() => jumpToReaderPage(viewer.currentPage - 1)}
                            disabled={!readerCanGoBackward}
                          >
                            <Ionicons name="chevron-back-outline" size={16} color={PRIMARY} />
                            <Text style={styles.readerToolBtnText}>Prev</Text>
                          </TouchableOpacity>

                          <TouchableOpacity style={styles.readerToolBtn} onPress={openReaderJumpPanel}>
                            <Ionicons name="navigate-outline" size={16} color={PRIMARY} />
                            <Text style={styles.readerToolBtnText}>Go to</Text>
                          </TouchableOpacity>

                          <TouchableOpacity style={styles.readerToolBtn} onPress={openReaderSearch}>
                            <Ionicons name="search-outline" size={16} color={PRIMARY} />
                            <Text style={styles.readerToolBtnText}>Find</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.readerToolBtn, isCurrentPageBookmarked && styles.readerToolBtnActive]}
                            onPress={() => openBookmarkEditor(viewer.currentPage)}
                          >
                            <Ionicons
                              name={isCurrentPageBookmarked ? "bookmark" : "bookmark-outline"}
                              size={16}
                              color={PRIMARY}
                            />
                            <Text style={styles.readerToolBtnText}>
                              {isCurrentPageBookmarked ? "Saved" : "Save"}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity style={styles.readerToolBtn} onPress={() => setReaderBookmarksVisible(true)}>
                            <Ionicons name="bookmarks-outline" size={16} color={PRIMARY} />
                            <Text style={styles.readerToolBtnText}>Bookmarks</Text>
                            {readerBookmarks.length ? (
                              <View style={styles.readerToolCountPill}>
                                <Text style={styles.readerToolCountText}>{readerBookmarks.length}</Text>
                              </View>
                            ) : null}
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.readerToolBtn, !readerOutline.length && styles.readerToolBtnDisabled]}
                            onPress={() => setReaderOutlineVisible(true)}
                            disabled={!readerOutline.length}
                          >
                            <Ionicons name="list-outline" size={16} color={PRIMARY} />
                            <Text style={styles.readerToolBtnText}>Contents</Text>
                          </TouchableOpacity>

                          <TouchableOpacity style={styles.readerToolBtn} onPress={handleViewerModeToggle}>
                            <Ionicons
                              name={viewer.readerMode === READER_MODE_PAGED ? "albums-outline" : "reader-outline"}
                              size={16}
                              color={PRIMARY}
                            />
                            <Text style={styles.readerToolBtnText}>
                              {viewer.readerMode === READER_MODE_PAGED ? "Paged" : "Scroll"}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.readerToolBtn, !readerCanGoForward && styles.readerToolBtnDisabled]}
                            onPress={() => jumpToReaderPage(viewer.currentPage + 1)}
                            disabled={!readerCanGoForward}
                          >
                            <Ionicons name="chevron-forward-outline" size={16} color={PRIMARY} />
                            <Text style={styles.readerToolBtnText}>Next</Text>
                          </TouchableOpacity>
                        </ScrollView>
                      </View>
                    </Animated.View>
                  </>
                ) : null}

                {!readerToolsEnabled ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close reader"
                    accessibilityHint="Double tap the top left corner to close the reader."
                    onPress={handleReaderHiddenClosePress}
                    style={styles.readerHiddenCloseZone}
                  />
                ) : null}

                <View pointerEvents="none" style={readerPageChipStyle}>
                  <Text style={styles.readerPageChipText}>
                    {readerPageChipLabel}
                  </Text>
                </View>

                {viewerLoading && viewer.reloadKey > 0 ? (
                  <View style={styles.readerLoadingOverlay}>
                    <ActivityIndicator size="large" color={PRIMARY} />
                    <Text style={styles.readerLoadingText}>
                      {viewerLoadProgress > 0 && viewerLoadProgress < 1
                        ? `Refreshing chapter... ${Math.round(viewerLoadProgress * 100)}%`
                        : "Refreshing chapter..."}
                    </Text>
                  </View>
                ) : null}
              </>
            ) : (
              <View style={styles.center}>
                <Text style={{ color: MUTED }}>No document selected</Text>
              </View>
            )}
          </View>
        </SafeAreaView>
      </Modal>

      <Modal visible={readerJumpVisible} transparent animationType="fade" onRequestClose={() => setReaderJumpVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setReaderJumpVisible(false)} />
        <View style={readerPanelSheetStyle}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Go to Page</Text>
          <Text style={styles.readerPanelSubtitle}>
            Jump directly to any page in this chapter.
          </Text>

          <TextInput
            value={readerJumpInput}
            onChangeText={setReaderJumpInput}
            keyboardType="number-pad"
            placeholder={viewer.totalPages ? `1 - ${viewer.totalPages}` : "Wait for page count"}
            placeholderTextColor={MUTED}
            style={styles.readerJumpInput}
          />

          <Text style={styles.readerJumpHint}>
            {viewer.totalPages ? `Enter a page number between 1 and ${viewer.totalPages}.` : "Page count appears after the PDF finishes loading."}
          </Text>

          <View style={styles.readerQuickActionRow}>
            <TouchableOpacity style={styles.readerQuickActionBtn} onPress={() => jumpToReaderPage(1, { closePanels: true })}>
              <Text style={styles.readerQuickActionText}>First page</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.readerQuickActionBtn}
              onPress={() => jumpToReaderPage(Math.max(1, viewer.currentPage - 1), { closePanels: true })}
            >
              <Text style={styles.readerQuickActionText}>Previous</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.readerQuickActionBtn}
              onPress={() => jumpToReaderPage(Math.min(viewer.totalPages || viewer.currentPage + 1, viewer.currentPage + 1), { closePanels: true })}
            >
              <Text style={styles.readerQuickActionText}>Next</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.readerQuickActionBtn}
              onPress={() => jumpToReaderPage(viewer.totalPages || viewer.currentPage, { closePanels: true })}
            >
              <Text style={styles.readerQuickActionText}>Last page</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.readerPanelPrimaryBtn} onPress={submitReaderJump}>
            <Ionicons name="arrow-forward-outline" size={16} color={colors.white} />
            <Text style={styles.readerPanelPrimaryBtnText}>Go to page</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={readerBookmarksVisible} transparent animationType="slide" onRequestClose={() => setReaderBookmarksVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setReaderBookmarksVisible(false)} />
        <View style={readerPanelSheetStyle}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Bookmarks</Text>
          <Text style={styles.readerPanelSubtitle}>Save important pages and return to them quickly.</Text>

          <TouchableOpacity
            style={[styles.readerCurrentBookmarkCard, isCurrentPageBookmarked && styles.readerCurrentBookmarkCardActive]}
            onPress={() => openBookmarkEditor(viewer.currentPage)}
          >
            <View style={styles.readerCurrentBookmarkIcon}>
              <Ionicons
                name={isCurrentPageBookmarked ? "bookmark" : "bookmark-outline"}
                size={18}
                color={PRIMARY}
              />
            </View>
            <View style={styles.readerCurrentBookmarkTextWrap}>
              <Text style={styles.readerCurrentBookmarkTitle}>
                {currentReaderBookmark?.label || `Current page ${viewer.currentPage}`}
              </Text>
              <Text style={styles.readerCurrentBookmarkText}>
                {currentReaderBookmark?.note
                  ? currentReaderBookmark.note
                  : isCurrentPageBookmarked
                    ? "Tap to edit this bookmark name or add a note."
                    : "Save this page with a custom name or note."}
              </Text>
            </View>
          </TouchableOpacity>

          {readerBookmarks.length ? (
            <FlatList
              data={readerBookmarks}
              keyExtractor={(item) => `${item.page}`}
              contentContainerStyle={styles.readerPanelList}
              renderItem={({ item }) => (
                <View style={styles.readerPanelRow}>
                  <TouchableOpacity
                    style={styles.readerPanelRowMain}
                    onPress={() => {
                      jumpToReaderPage(item.page, { closePanels: true });
                      setReaderBookmarksVisible(false);
                    }}
                  >
                    <View style={styles.readerPanelRowIcon}>
                      <Ionicons name="bookmark" size={16} color={PRIMARY} />
                    </View>
                    <View style={styles.readerPanelRowTextWrap}>
                      <Text style={styles.readerPanelRowTitle} numberOfLines={1}>{item.label}</Text>
                      <Text style={styles.readerPanelRowSubtitle}>Page {item.page}</Text>
                      {!!item.note ? (
                        <Text style={styles.readerBookmarkNotePreview} numberOfLines={2}>{item.note}</Text>
                      ) : null}
                    </View>
                    {item.page === viewer.currentPage ? (
                      <View style={styles.readerCurrentPill}>
                        <Text style={styles.readerCurrentPillText}>Current</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>

                  <View style={styles.readerPanelActionGroup}>
                    <TouchableOpacity style={styles.readerPanelEditBtn} onPress={() => openBookmarkEditor(item.page)}>
                      <Ionicons name="create-outline" size={18} color={PRIMARY} />
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.readerPanelDeleteBtn} onPress={() => deleteReaderBookmark(item.page)}>
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            />
          ) : (
            <View style={styles.readerPanelEmptyState}>
              <Ionicons name="bookmarks-outline" size={22} color={PRIMARY} />
              <Text style={styles.readerPanelEmptyTitle}>No bookmarks yet</Text>
              <Text style={styles.readerPanelEmptyText}>Save pages from the reader toolbar to see them here.</Text>
            </View>
          )}
        </View>
      </Modal>

      <Modal visible={readerOutlineVisible} transparent animationType="slide" onRequestClose={() => setReaderOutlineVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setReaderOutlineVisible(false)} />
        <View style={readerPanelSheetStyle}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Contents</Text>
          <Text style={styles.readerPanelSubtitle}>Jump through the PDF outline just like a full reader app.</Text>

          {readerOutline.length ? (
            <FlatList
              data={readerOutline}
              keyExtractor={(item) => item.key}
              contentContainerStyle={styles.readerPanelList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.readerPanelRowMain, { paddingLeft: 14 + item.depth * 14 }]}
                  onPress={() => {
                    jumpToReaderPage(item.page, { closePanels: true });
                    setReaderOutlineVisible(false);
                  }}
                >
                  <View style={styles.readerPanelRowIcon}>
                    <Ionicons name="list-outline" size={16} color={PRIMARY} />
                  </View>
                  <View style={styles.readerPanelRowTextWrap}>
                    <Text style={styles.readerPanelRowTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.readerPanelRowSubtitle}>Page {item.page}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          ) : (
            <View style={styles.readerPanelEmptyState}>
              <Ionicons name="document-text-outline" size={22} color={PRIMARY} />
              <Text style={styles.readerPanelEmptyTitle}>No outline found</Text>
              <Text style={styles.readerPanelEmptyText}>This PDF does not expose chapter contents for quick jumps.</Text>
            </View>
          )}
        </View>
      </Modal>

      <Modal visible={bookmarkEditor.visible} transparent animationType="slide" onRequestClose={closeBookmarkEditor}>
        <Pressable style={styles.modalBackdrop} onPress={closeBookmarkEditor} />
        <View style={readerPanelSheetStyle}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{editingReaderBookmark ? "Edit Bookmark" : "Save Bookmark"}</Text>
          <Text style={styles.readerPanelSubtitle}>Give this page a name and add an optional note for later.</Text>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.readerBookmarkPagePill}>
              <Ionicons name="bookmark-outline" size={14} color={PRIMARY} />
              <Text style={styles.readerBookmarkPagePillText}>Page {bookmarkEditor.page}</Text>
            </View>

            <Text style={styles.readerFieldLabel}>Bookmark name</Text>
            <TextInput
              value={bookmarkEditor.label}
              onChangeText={(value) => setBookmarkEditor((prev) => ({ ...prev, label: value }))}
              placeholder={`Page ${bookmarkEditor.page}`}
              placeholderTextColor={MUTED}
              style={styles.readerBookmarkInput}
            />

            <Text style={styles.readerFieldLabel}>Note</Text>
            <TextInput
              value={bookmarkEditor.note}
              onChangeText={(value) => setBookmarkEditor((prev) => ({ ...prev, note: value }))}
              placeholder="Optional reminder, summary, or revision hint"
              placeholderTextColor={MUTED}
              multiline
              textAlignVertical="top"
              style={styles.readerBookmarkNoteInput}
            />

            <View style={styles.readerEditorActionRow}>
              {editingReaderBookmark ? (
                <TouchableOpacity style={styles.readerEditorDangerBtn} onPress={() => deleteReaderBookmark(bookmarkEditor.page)}>
                  <Text style={styles.readerEditorDangerBtnText}>Delete</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity style={styles.readerEditorSecondaryBtn} onPress={closeBookmarkEditor}>
                <Text style={styles.readerEditorSecondaryBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.readerEditorPrimaryBtn} onPress={saveReaderBookmarkDraft}>
                <Ionicons name="save-outline" size={16} color={colors.white} />
                <Text style={styles.readerEditorPrimaryBtnText}>{editingReaderBookmark ? "Update" : "Save"}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={readerSearchVisible} transparent animationType="slide" onRequestClose={() => setReaderSearchVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setReaderSearchVisible(false)} />
        <View style={readerPanelSheetStyle}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Find in Chapter</Text>
          <Text style={styles.readerPanelSubtitle}>{readerSearchStatusLabel}</Text>

          {readerTextIndexState.status === "indexing" ? (
            <View style={styles.readerSearchStatusCard}>
              <ActivityIndicator size="small" color={PRIMARY} />
              <Text style={styles.readerSearchStatusText}>You can already search bookmarks and contents while the PDF text index builds.</Text>
            </View>
          ) : null}

          {readerTextIndexState.status === "error" ? (
            <View style={[styles.readerSearchStatusCard, styles.readerSearchStatusCardError]}>
              <Text style={styles.readerSearchStatusText}>{readerTextIndexState.error || "Full text indexing failed for this PDF."}</Text>
              <TouchableOpacity style={styles.readerSearchRetryBtn} onPress={retryReaderTextIndex}>
                <Text style={styles.readerSearchRetryBtnText}>Retry indexing</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TextInput
            value={readerSearchQuery}
            onChangeText={setReaderSearchQuery}
            placeholder="Search text, title, note, or page"
            placeholderTextColor={MUTED}
            style={styles.readerSearchInput}
          />

          {readerSearchResults.length ? (
            <FlatList
              data={readerSearchResults}
              keyExtractor={(item) => item.key}
              contentContainerStyle={styles.readerPanelList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.readerPanelRowMain, { marginBottom: 10, paddingLeft: 14 + (item.kind === "outline" ? item.depth * 14 : 0) }]}
                  onPress={() => {
                    jumpToReaderPage(item.page, { closePanels: true });
                  }}
                >
                  <View style={styles.readerPanelRowIcon}>
                    <Ionicons
                      name={item.kind === "bookmark" ? "bookmark" : item.kind === "outline" ? "list-outline" : "navigate-outline"}
                      size={16}
                      color={PRIMARY}
                    />
                  </View>
                  <View style={styles.readerPanelRowTextWrap}>
                    <View style={styles.readerSearchTitleRow}>
                      <Text style={styles.readerPanelRowTitle} numberOfLines={1}>{item.title}</Text>
                      <View style={styles.readerSearchTag}>
                        <Text style={styles.readerSearchTagText}>{item.kindLabel}</Text>
                      </View>
                    </View>
                    <Text style={styles.readerPanelRowSubtitle}>{item.subtitle}</Text>
                    {!!item.note ? (
                      <Text style={styles.readerBookmarkNotePreview} numberOfLines={2}>{item.note}</Text>
                    ) : null}
                  </View>
                  {item.page === viewer.currentPage ? (
                    <View style={styles.readerCurrentPill}>
                      <Text style={styles.readerCurrentPillText}>Current</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              )}
            />
          ) : (
            <View style={styles.readerPanelEmptyState}>
              <Ionicons name="search-outline" size={22} color={PRIMARY} />
              <Text style={styles.readerPanelEmptyTitle}>Nothing matched</Text>
              <Text style={styles.readerPanelEmptyText}>Try a page number, a bookmark name, or a chapter title from the PDF contents.</Text>
            </View>
          )}
        </View>
      </Modal>

      <Modal visible={managerVisible} animationType="slide" onRequestClose={() => setManagerVisible(false)}>
        <SafeAreaView style={styles.managerContainer}>
          <View style={styles.managerHeader}>
            <TouchableOpacity onPress={() => setManagerVisible(false)} style={styles.managerIconBtn}>
              <Ionicons name="arrow-back" size={20} color={TEXT} />
            </TouchableOpacity>
            <View style={styles.managerHeaderTextWrap}>
              <Text style={styles.managerTitle}>Downloads</Text>
              <Text style={styles.managerSubtitle}>
                {downloadedFilesList.length} files • {totalDownloadedSizeMB} MB
              </Text>
            </View>
            <TouchableOpacity onPress={() => refreshDownloadedFiles()} style={styles.managerIconBtn}>
              <Ionicons name="refresh" size={20} color={PRIMARY} />
            </TouchableOpacity>
          </View>

          {downloadedFilesList.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={{ color: MUTED }}>No files downloaded yet.</Text>
            </View>
          ) : (
            <FlatList
              data={downloadedFilesList}
              keyExtractor={(f) => f.uri}
              contentContainerStyle={styles.managerListContent}
              renderItem={({ item }) => (
                <View style={styles.fileRow}>
                  <View style={styles.fileIconWrap}>
                    <Ionicons name="document-text-outline" size={20} color={PRIMARY} />
                  </View>

                  <View style={styles.fileMainContent}>
                    <Text style={styles.fileName} numberOfLines={1}>{item.title}</Text>

                    <View style={styles.fileMetaRow}>
                      <View style={styles.fileMetaPill}>
                        <Ionicons name="download-outline" size={12} color={PRIMARY} />
                        <Text style={styles.fileMetaPillText}>{formatFileSize(item.size)}</Text>
                      </View>
                      {!!item.subjectName && (
                        <View style={styles.fileMetaPillMuted}>
                          <Text style={styles.fileMetaPillMutedText} numberOfLines={1}>{item.subjectName}</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  <View style={styles.fileActionGroup}>
                    <TouchableOpacity
                      onPress={() => {
                        if (item.uri) openLocalPdfInViewer(item.uri, item.title, item.subjectName || "");
                        else Alert.alert("Missing file", "This cached file is no longer on your phone.");
                      }}
                      style={[styles.fileActionBtn, styles.fileOpenBtn]}
                    >
                      <Ionicons name="open-outline" size={18} color={PRIMARY} />
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() =>
                        Alert.alert("Delete file", "Delete this file from app storage?", [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Delete",
                            style: "destructive",
                            onPress: async () => {
                              try {
                                await deleteFile(item);
                                Alert.alert("Deleted", "File removed.");
                              } catch {
                                Alert.alert("Error", "Delete failed.");
                              }
                            },
                          },
                        ])
                      }
                      style={[styles.fileActionBtn, styles.fileDeleteBtn]}
                    >
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  const PRIMARY = colors.primary;
  const TEXT = colors.text;
  const MUTED = colors.muted;
  const CARD = colors.card;
  const BORDER = colors.border;
  const BG = colors.background;
  const SUCCESS = colors.success;

  return StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  stickyWrap: {
    backgroundColor: colors.panel,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingBottom: 2,
  },

  topUtilityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  searchCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    backgroundColor: CARD,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    height: 42,
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.025,
    shadowRadius: 8,
    elevation: 1,
  },
  searchIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  searchInput: {
    flex: 1,
    color: TEXT,
    marginLeft: 10,
    fontSize: 14,
    fontWeight: "500",
  },
  topActionBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 3,
    position: "relative",
  },
  topActionDot: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: SUCCESS,
    borderWidth: 1.5,
    borderColor: colors.white,
  },

  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: "center",
    marginRight: 10,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  statIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  statIconBlue: {
    backgroundColor: colors.soft,
  },
  statIconPurple: {
    backgroundColor: colors.badgeBackground,
  },
  statIconGreen: {
    backgroundColor: colors.soft,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "900",
    color: TEXT,
    lineHeight: 22,
  },
  statLabel: {
    marginTop: 2,
    fontSize: 11,
    color: MUTED,
    fontWeight: "700",
  },

  inlineIndicatorsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },

  floatingIndicatorsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: CARD,
  },

  activeChip: {
    backgroundColor: colors.soft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  activeChipText: {
    color: PRIMARY,
    fontSize: 12,
    fontWeight: "700",
  },

  list: { padding: 12, paddingBottom: 24 },

  card: {
    backgroundColor: CARD,
    borderRadius: 22,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.025,
    shadowRadius: 10,
    elevation: 1,
  },
  cardSelected: {
    borderColor: PRIMARY,
    shadowColor: PRIMARY,
    shadowOpacity: 0.05,
    elevation: 2,
  },
  cardHeader: {
    paddingHorizontal: 16,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardHeaderExpanded: {
    backgroundColor: colors.inputBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  cardHeaderToggle: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  cardHeaderToggleActive: {
    borderColor: PRIMARY,
    backgroundColor: colors.soft,
  },
  subjectIconContainer: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.badgeBackground,
    borderWidth: 1,
    borderColor: colors.soft,
  },
  cover: {
    width: 56,
    height: 74,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  subjectName: {
    fontWeight: "900",
    fontSize: 17,
    color: TEXT,
  },
  subjectSub: {
    color: MUTED,
    marginTop: 4,
    fontSize: 12,
    fontWeight: "700",
  },
  metaChip: {
    marginRight: 6,
    marginBottom: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: BORDER,
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
  },
  unitsContainer: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: colors.inputBackground,
  },
  unitRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    backgroundColor: CARD,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.018,
    shadowRadius: 6,
    elevation: 0,
  },
  unitMainTap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  unitTextWrap: {
    flex: 1,
    marginLeft: 10,
    paddingRight: 10,
  },
  unitRowCompact: {
    paddingVertical: 9,
  },
  unitOrderBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  unitOrderText: {
    color: PRIMARY,
    fontSize: 12,
    fontWeight: "800",
  },
  unitTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  unitTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: TEXT,
    marginRight: 6,
  },
  noteBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.soft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  noteBadgeText: {
    marginLeft: 4,
    fontSize: 11,
    color: PRIMARY,
    fontWeight: "700",
  },

  unitActions: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 10,
  },
  noteActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  noteActionBtnActive: {
    borderColor: PRIMARY,
    backgroundColor: colors.soft,
  },
  noteActionIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 9,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  noteActionIconWrapActive: {
    backgroundColor: PRIMARY,
  },

  iconDownload: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.inputBackground,
  },
  iconDownloaded: {
    backgroundColor: SUCCESS,
    borderColor: SUCCESS,
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  progressWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: PRIMARY,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  progressText: {
    color: colors.white,
    marginLeft: 8,
    fontWeight: "700",
  },

  emptyContainer: {
    flex: 1,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  emptyImage: { width: 220, height: 160, marginBottom: 18 },
  emptyTitle: { fontSize: 20, fontWeight: "800", color: TEXT, marginBottom: 6 },
  emptySubtitle: { fontSize: 14, color: MUTED, textAlign: "center" },

  readerContainer: { flex: 1, backgroundColor: BG },
  readerHeader: {
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.tabGlassBorder,
    borderRadius: 24,
    backgroundColor: colors.tabGlass,
    shadowColor: "#08101C",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 22,
    elevation: 7,
  },
  readerHeaderIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.tabGlassBorder,
    backgroundColor: colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  readerHeaderActionBtn: {
    marginLeft: 8,
  },
  readerHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 8,
  },
  readerHeaderWide: {
    minHeight: 92,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  readerHeaderLandscape: {
    minHeight: 74,
  },
  readerToolRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingTop: 2,
    paddingBottom: 2,
  },
  readerToolRowWide: {
    paddingHorizontal: 6,
    paddingTop: 2,
    paddingBottom: 2,
  },
  readerToolBtn: {
    height: 42,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.tabGlassBorder,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    marginRight: 8,
  },
  readerToolBtnActive: {
    borderColor: PRIMARY,
    backgroundColor: colors.soft,
  },
  readerToolBtnDisabled: {
    opacity: 0.45,
  },
  readerToolBtnText: {
    marginLeft: 6,
    fontSize: 13,
    fontWeight: "800",
    color: TEXT,
  },
  readerToolCountPill: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    marginLeft: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.soft,
  },
  readerToolCountText: {
    fontSize: 10,
    fontWeight: "900",
    color: PRIMARY,
  },
  readerModeBtnActive: {
    backgroundColor: colors.soft,
    borderColor: PRIMARY,
  },
  readerTitleWrap: {
    flex: 1,
    marginHorizontal: 10,
  },
  readerLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: PRIMARY,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  readerTitle: {
    marginTop: 2,
    fontWeight: "900",
    fontSize: 15,
    color: TEXT,
  },
  readerTitleWide: {
    fontSize: 17,
    lineHeight: 23,
  },
  readerSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: MUTED,
  },
  readerSubtitleWide: {
    fontSize: 13,
  },
  readerMetaPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
  },
  readerMetaPill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.tabGlassBorder,
    backgroundColor: colors.card,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginRight: 8,
    marginBottom: 6,
  },
  readerMetaPillPrimary: {
    maxWidth: "74%",
  },
  readerMetaPillText: {
    marginLeft: 5,
    fontSize: 11,
    fontWeight: "800",
    color: TEXT,
  },
  readerStatusText: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
    color: PRIMARY,
  },
  readerStatusTextWide: {
    fontSize: 12,
  },
  readerBodyWrap: {
    flex: 1,
    margin: 0,
    borderRadius: 0,
    overflow: "hidden",
    borderWidth: 0,
    backgroundColor: CARD,
  },
  readerBodyWrapWide: {
    margin: 16,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 3,
  },
  readerWebView: {
    flex: 1,
    backgroundColor: BG,
  },
  readerTopOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 12,
  },
  readerBottomOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  readerBottomDock: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.tabGlassBorder,
    backgroundColor: colors.tabGlass,
    padding: 14,
    shadowColor: "#08101C",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
  },
  readerBottomDockWide: {
    maxWidth: 840,
    alignSelf: "center",
    width: "100%",
  },
  readerDockTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  readerDockSectionWrap: {
    flex: 1,
    marginRight: 12,
  },
  readerDockEyebrow: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: PRIMARY,
  },
  readerDockSectionTitle: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: "900",
    color: TEXT,
  },
  readerDockSectionHint: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "600",
    color: MUTED,
  },
  readerDockFocusBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.tabGlassBorder,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  readerProgressCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.tabGlassBorder,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  readerProgressHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  readerProgressLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: MUTED,
  },
  readerProgressValue: {
    fontSize: 13,
    fontWeight: "900",
    color: PRIMARY,
  },
  readerProgressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    overflow: "hidden",
    marginTop: 12,
  },
  readerProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: PRIMARY,
  },
  readerProgressFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  readerProgressFooterText: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED,
  },
  readerDockToolScroller: {
    marginTop: 12,
  },
  readerPageChip: {
    position: "absolute",
    right: 16,
    bottom: 16,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.tabGlass,
    borderWidth: 1,
    borderColor: colors.tabGlassBorder,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    zIndex: 15,
  },
  readerHiddenCloseZone: {
    position: "absolute",
    top: 8,
    left: 8,
    width: 68,
    height: 68,
    zIndex: 16,
  },
  readerPageChipWide: {
    right: 24,
    bottom: 24,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  readerPageChipWithChrome: {
    bottom: 182,
  },
  readerPageChipWithChromeWide: {
    bottom: 194,
  },
  readerPageChipFocusMode: {
    bottom: 16,
  },
  readerPageChipText: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: "800",
    color: TEXT,
  },
  readerLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
  },
  readerLoadingText: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: "700",
    color: TEXT,
  },

  managerContainer: { flex: 1, backgroundColor: BG },
  managerHeader: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: colors.panel,
  },
  managerIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
  },
  managerHeaderTextWrap: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 12,
  },
  managerTitle: { fontWeight: "900", fontSize: 18, color: TEXT },
  managerSubtitle: { marginTop: 3, color: MUTED, fontSize: 12, fontWeight: "600" },
  managerListContent: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },

  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    backgroundColor: CARD,
    marginBottom: 10,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.025,
    shadowRadius: 10,
    elevation: 1,
  },
  fileIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  fileMainContent: {
    flex: 1,
    minWidth: 0,
  },
  fileName: { fontSize: 14, fontWeight: "800", color: TEXT },
  fileMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    marginTop: 7,
  },
  fileMetaPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.soft,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginRight: 8,
    marginBottom: 0,
  },
  fileMetaPillText: {
    marginLeft: 4,
    fontSize: 11,
    fontWeight: "700",
    color: PRIMARY,
  },
  fileMetaPillMuted: {
    backgroundColor: colors.inputBackground,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginBottom: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  fileMetaPillMutedText: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED,
  },
  fileActionGroup: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 12,
  },
  fileActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  fileOpenBtn: {
    backgroundColor: colors.inputBackground,
    borderColor: BORDER,
    marginRight: 8,
  },
  fileDeleteBtn: {
    backgroundColor: CARD,
    borderColor: colors.danger,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  noteSheetWrap: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
  },
  bottomSheet: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    maxHeight: "78%",
    backgroundColor: CARD,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
  },
  readerPanelFloatingSheet: {
    width: "92%",
    alignSelf: "center",
    bottom: 12,
  },
  readerPanelTabletSheet: {
    maxWidth: 840,
    maxHeight: "82%",
  },
  readerPanelLandscapeSheet: {
    maxHeight: "88%",
  },
  sheetHandle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.separator,
    alignSelf: "center",
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: TEXT,
    marginBottom: 14,
  },
  noteSheetSubtitle: {
    fontSize: 13,
    color: MUTED,
    fontWeight: "600",
    marginTop: -6,
    marginBottom: 14,
  },
  noteLimitCard: {
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  noteLimitTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: TEXT,
  },
  noteLimitText: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: "600",
    color: MUTED,
  },
  noteLimitPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.soft,
  },
  noteLimitPillFull: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  noteLimitPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: SUCCESS,
  },
  noteLimitPillTextFull: {
    color: colors.danger,
  },
  noteListCard: {
    marginBottom: 0,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 12,
    paddingVertical: 11,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  noteSwipeRow: {
    marginBottom: 10,
    position: "relative",
  },
  noteSwipeActions: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    paddingRight: 2,
  },
  noteSwipeCardWrap: {
    zIndex: 2,
  },
  noteSwipeActionBtn: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  noteSwipeEditBtn: {
    backgroundColor: PRIMARY,
  },
  noteSwipeDeleteBtn: {
    backgroundColor: colors.danger,
  },
  noteListHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  noteListIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  noteListTextWrap: {
    flex: 1,
    marginRight: 8,
  },
  noteListTopLine: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  noteListTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: TEXT,
    flex: 1,
    marginRight: 8,
  },
  notePinnedPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.soft,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 4,
    gap: 4,
  },
  notePinnedText: {
    fontSize: 10,
    fontWeight: "800",
    color: PRIMARY,
  },
  noteListPreview: {
    fontSize: 12,
    lineHeight: 17,
    color: MUTED,
  },
  noteSwipeHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingLeft: 8,
    marginLeft: 10,
    opacity: 0.85,
  },
  noteSwipeHintText: {
    marginLeft: 4,
    color: MUTED,
    fontSize: 10,
    fontWeight: "700",
  },
  noteAddAnotherBtn: {
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: colors.inputBackground,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 14,
  },
  noteAddAnotherText: {
    color: PRIMARY,
    fontSize: 13,
    fontWeight: "800",
  },
  noteAddAnotherBtnDisabled: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  noteAddAnotherTextDisabled: {
    color: MUTED,
  },
  noteEmptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 22,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    backgroundColor: colors.inputBackground,
  },
  noteReaderScreen: {
    flex: 1,
    backgroundColor: BG,
  },
  noteReaderTopBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: CARD,
  },
  noteReaderIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
  },
  noteReaderTopText: {
    flex: 1,
    marginHorizontal: 12,
  },
  noteReaderUnitTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: TEXT,
  },
  noteReaderTopSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: MUTED,
  },
  noteReaderEditBtn: {
    minWidth: 58,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  noteReaderEditText: {
    fontSize: 13,
    fontWeight: "800",
    color: PRIMARY,
  },
  noteReaderScroll: {
    padding: 16,
    paddingBottom: 40,
  },
  noteReaderHero: {
    borderRadius: 18,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 12,
  },
  noteReaderHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  noteReaderTypePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.soft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  noteReaderTypeText: {
    marginLeft: 6,
    fontSize: 11,
    fontWeight: "800",
    color: MUTED,
  },
  noteReaderPinnedPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.inputBackground,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 4,
  },
  noteReaderPinnedText: {
    fontSize: 11,
    fontWeight: "800",
    color: MUTED,
  },
  noteReaderTitle: {
    fontSize: 21,
    lineHeight: 29,
    fontWeight: "900",
    color: TEXT,
  },
  noteReaderBodyCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 20,
    minHeight: 260,
  },
  noteReaderBodyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  noteReaderBodyLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: PRIMARY,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  noteReaderDivider: {
    height: 1,
    backgroundColor: colors.separator,
    marginTop: 12,
    marginBottom: 14,
  },
  noteReaderBodyText: {
    fontSize: 15,
    lineHeight: 26,
    color: TEXT,
    fontWeight: "500",
  },
  noteReaderBodyTextEmpty: {
    color: MUTED,
    fontStyle: "italic",
  },
  noteEmptyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  noteEmptyTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: TEXT,
    marginBottom: 4,
  },
  noteEmptyText: {
    fontSize: 12,
    color: MUTED,
    textAlign: "center",
  },
  noteInlinePrimaryAction: {
    marginTop: 14,
    height: 42,
    borderRadius: 12,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
  },
  noteInlinePrimaryActionText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: "800",
  },
  readerPanelSubtitle: {
    marginTop: -6,
    marginBottom: 14,
    fontSize: 12,
    fontWeight: "600",
    color: MUTED,
  },
  readerJumpInput: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 16,
    color: TEXT,
    fontSize: 18,
    fontWeight: "800",
  },
  readerJumpHint: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    fontWeight: "600",
  },
  readerQuickActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 14,
    marginBottom: 14,
  },
  readerQuickActionBtn: {
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    marginBottom: 8,
  },
  readerQuickActionText: {
    fontSize: 12,
    fontWeight: "800",
    color: TEXT,
  },
  readerPanelPrimaryBtn: {
    height: 46,
    borderRadius: 14,
    backgroundColor: PRIMARY,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  readerPanelPrimaryBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.white,
  },
  readerCurrentBookmarkCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    backgroundColor: colors.inputBackground,
    marginBottom: 12,
  },
  readerCurrentBookmarkCardActive: {
    borderColor: PRIMARY,
    backgroundColor: colors.soft,
  },
  readerCurrentBookmarkIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  readerCurrentBookmarkTextWrap: {
    flex: 1,
  },
  readerCurrentBookmarkTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: TEXT,
  },
  readerCurrentBookmarkText: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    fontWeight: "600",
  },
  readerBookmarkPagePill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: colors.soft,
    marginBottom: 14,
  },
  readerBookmarkPagePillText: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: "800",
    color: PRIMARY,
  },
  readerFieldLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: TEXT,
    marginBottom: 8,
  },
  readerBookmarkInput: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 14,
    color: TEXT,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 14,
  },
  readerBookmarkNoteInput: {
    minHeight: 110,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    color: TEXT,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },
  readerEditorActionRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    marginBottom: 4,
  },
  readerEditorDangerBtn: {
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    marginRight: 8,
  },
  readerEditorDangerBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.danger,
  },
  readerEditorSecondaryBtn: {
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginRight: 8,
  },
  readerEditorSecondaryBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: TEXT,
  },
  readerEditorPrimaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  readerEditorPrimaryBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.white,
  },
  readerSearchInput: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 14,
    color: TEXT,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 14,
  },
  readerSearchStatusCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  readerSearchStatusCardError: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  readerSearchStatusText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 12,
    lineHeight: 18,
    color: TEXT,
    fontWeight: "600",
  },
  readerSearchRetryBtn: {
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PRIMARY,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    marginLeft: 10,
  },
  readerSearchRetryBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: PRIMARY,
  },
  readerPanelList: {
    paddingBottom: 12,
  },
  readerPanelRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  readerPanelActionGroup: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 10,
  },
  readerPanelRowMain: {
    flex: 1,
    minHeight: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
  },
  readerPanelRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  readerPanelRowTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  readerPanelRowTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: TEXT,
  },
  readerPanelRowSubtitle: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: "700",
    color: MUTED,
  },
  readerBookmarkNotePreview: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    fontWeight: "600",
  },
  readerPanelEditBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  readerPanelDeleteBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  readerCurrentPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: colors.soft,
    marginLeft: 10,
  },
  readerCurrentPillText: {
    fontSize: 10,
    fontWeight: "900",
    color: PRIMARY,
  },
  readerSearchTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  readerSearchTag: {
    marginLeft: 8,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.soft,
  },
  readerSearchTagText: {
    fontSize: 10,
    fontWeight: "800",
    color: PRIMARY,
  },
  readerPanelEmptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 26,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    backgroundColor: colors.inputBackground,
  },
  readerPanelEmptyTitle: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: "800",
    color: TEXT,
  },
  readerPanelEmptyText: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    color: MUTED,
  },

  settingsSectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: TEXT,
    marginBottom: 10,
    marginTop: 10,
  },
  languageWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 10,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: CARD,
    marginRight: 8,
    marginBottom: 8,
  },
  filterChipOn: { backgroundColor: colors.soft, borderColor: PRIMARY },
  filterChipText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  filterChipTextOn: { color: PRIMARY },

  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  settingTitle: { fontSize: 14, fontWeight: "800", color: TEXT },
  settingSubtitle: { fontSize: 12, color: MUTED, marginTop: 4 },
});
}