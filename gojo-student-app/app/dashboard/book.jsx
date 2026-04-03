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
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get, remove, update } from "firebase/database";
import { database } from "../../constants/firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter, useFocusEffect } from "expo-router";
import NativePdfView, { nativePdfUnavailableMessage } from "../../components/native-pdf-view";
import { useAppTheme } from "../../hooks/use-app-theme";

const MAX_NOTES_PER_CHAPTER = 5;

const BOOKS_DIR = `${FileSystem.documentDirectory}books/`;
const DOWNLOAD_INDEX_KEY = "downloaded_books_index_v1";
const BOOK_SETTINGS_KEY = "book_settings_v1";

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

export default function BooksScreen() {
  const router = useRouter();
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
  });

  const [downloadProgress, setDownloadProgress] = useState({});
  const [downloadingMap, setDownloadingMap] = useState({});
  const activeDownloadsRef = useRef({});

  const [downloadedFilesList, setDownloadedFilesList] = useState([]);
  const [managerVisible, setManagerVisible] = useState(false);

  const [viewer, setViewer] = useState({
    visible: false,
    title: "",
    subjectName: "",
    localUri: null,
    reloadKey: 0,
  });
  const [viewerLoading, setViewerLoading] = useState(false);
  const [notesMap, setNotesMap] = useState({});
  const [noteSheet, setNoteSheet] = useState({ visible: false, subject: null, unit: null });
  const [noteReader, setNoteReader] = useState({ visible: false, subject: null, unit: null, note: null });
  const [brokenCoverMap, setBrokenCoverMap] = useState({});

  const [showFloatingIndicators, setShowFloatingIndicators] = useState(false);

  const floatingAnimValue = useRef(new Animated.Value(0)).current;

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

  const registerDownloadMetadata = useCallback(async (url, meta) => {
    const filename = getLocalFilename(url);
    if (!filename) return;
    const idx = await loadDownloadIndex();
    idx[filename] = {
      url,
      title: meta.title || filename,
      subjectName: meta.subjectName || null,
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
      });
    }

    list.sort((a, b) => (b.modificationTime || 0) - (a.modificationTime || 0));
    setDownloadedFilesList(list);
  }, [ensureBooksDir, loadDownloadIndex, removeDownloadMetadata]);

  const cancelDownload = useCallback(async (url) => {
    const active = activeDownloadsRef.current[url];
    if (active?.resumable?.cancelAsync) {
      try { await active.resumable.cancelAsync(); } catch {}
    }

    const localPath = getLocalPathForUrl(url);
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

  const closeViewer = useCallback(() => {
    setViewerLoading(false);
    setViewer({
      visible: false,
      title: "",
      subjectName: "",
      localUri: null,
      reloadKey: 0,
    });
  }, []);

  const openLocalPdfInViewer = useCallback((localUri, title, subjectName = "") => {
    if (!localUri) {
      Alert.alert("Unable to load", "This chapter is not downloaded on your phone yet.");
      return;
    }

    if (!NativePdfView) {
      Alert.alert("PDF reader unavailable", nativePdfUnavailableMessage);
      return;
    }

    setViewerLoading(true);
    setViewer({
      visible: true,
      title,
      subjectName,
      localUri,
      reloadKey: 0,
    });
  }, []);

  const reloadViewer = useCallback(() => {
    setViewerLoading(true);
    setViewer((prev) => {
      if (!prev.localUri) return prev;
      return {
        ...prev,
        reloadKey: prev.reloadKey + 1,
      };
    });
  }, []);

  const deleteFile = useCallback(async (file) => {
    await FileSystem.deleteAsync(file.uri, { idempotent: true });
    await removeDownloadMetadata(file.name);
    await refreshDownloadedFiles();
  }, [removeDownloadMetadata, refreshDownloadedFiles]);

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

  const loadBooks = useCallback(async () => {
    setLoading(true);
    try {
      await ensureBooksDir();
      await refreshDownloadedFiles();
      await loadSettings();

      const ctx = await loadStudentContext();
      if (!ctx?.grade) {
        setSubjects([]);
        setLoading(false);
        return;
      }

      const gradeKey = normalizeGradeKey(ctx.grade);
      const snap = await get(ref(database, `Platform1/TextBooks/${gradeKey}`));

      if (!snap.exists()) {
        setSubjects([]);
        setLoading(false);
        return;
      }

      const booksObj = snap.val() || {};
      const list = Object.keys(booksObj).map((subjectKey) => {
        const b = booksObj[subjectKey] || {};
        const unitsObj = b.units || {};

        const units = Object.keys(unitsObj)
          .map((uk, idx) => {
            const u = unitsObj[uk] || {};
            return {
              unitKey: uk,
              order: Number(String(uk).replace(/\D/g, "")) || idx + 1,
              title: u.title || titleize(uk),
              pdfUrl: u.pdfUrl || null,
            };
          })
          .sort((a, b2) => a.order - b2.order);

        return {
          subjectKey,
          subjectName: titleize(subjectKey),
          title: b.title || titleize(subjectKey),
          coverUrl:
            String(
              b.coverUrl || b.cover || b.image || b.coverImage || ""
            ).trim() || null,
          language: b.language || "",
          region: b.region || "",
          units,
          totalUnits: units.length,
        };
      });

      setSubjects(list);
  setBrokenCoverMap({});

      if (settings.autoExpandSubjects) {
        const expandedMap = {};
        list.forEach((s) => {
          expandedMap[s.subjectKey] = true;
        });
        setExpanded(expandedMap);
      }

      await loadNotes(ctx);
    } catch (err) {
      console.warn("TextBooks load error:", err);
      setSubjects([]);
    } finally {
      setLoading(false);
    }
  }, [
    ensureBooksDir,
    refreshDownloadedFiles,
    loadSettings,
    loadStudentContext,
    settings.autoExpandSubjects,
    loadNotes,
  ]);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

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
            const path = getLocalPathForUrl(u.pdfUrl);
            return downloadedFilesList.some((f) => f.uri === path);
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

  const openNoteEditor = useCallback((subject, unit) => {
    openNoteEditorWithId(subject, unit, null);
  }, [openNoteEditorWithId]);

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

  const openUnit = useCallback(async (unit, subjectName) => {
    const url = unit.pdfUrl;
    if (!url) return Alert.alert("No PDF", "This unit has no pdfUrl.");

    if (downloadingMap[url]) {
      Alert.alert("Download in progress", "Wait for this chapter to finish downloading before opening it.");
      return;
    }

    let localUri = null;
    try {
      const localPath = getLocalPathForUrl(url);
      const info = localPath ? await FileSystem.getInfoAsync(localPath) : { exists: false };
      if (info.exists && Number(info.size || 0) > 0) {
        localUri = localPath;
      } else if (info.exists && localPath) {
        await FileSystem.deleteAsync(localPath, { idempotent: true });
      }
    } catch {}

    if (!localUri) {
      try {
        localUri = await downloadToLocal(url, { title: unit.title, subjectName });
      } catch {
        Alert.alert("Download failed", "This chapter could not be saved to your phone. Please try downloading it again.");
        return;
      }
    }

    openLocalPdfInViewer(localUri, unit.title, subjectName);
  }, [downloadToLocal, downloadingMap, getLocalPathForUrl, openLocalPdfInViewer]);

  const downloadOrCancel = useCallback(async (unit, subjectName) => {
    const url = unit.pdfUrl;
    if (!url) return Alert.alert("No PDF", "This unit has no pdfUrl.");

    if (downloadingMap[url]) {
      return Alert.alert("Cancel download?", "", [
        { text: "No", style: "cancel" },
        { text: "Yes", onPress: () => cancelDownload(url) },
      ]);
    }

    try {
      await downloadToLocal(url, { title: unit.title, subjectName });
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
    const isDownloading = !!downloadingMap[url];
    const progress = Math.round((downloadProgress[url] || 0) * 100);
    const noteKey = `${subject.subjectKey}__${unit.unitKey}`;
    const chapterNotes = notesMap[noteKey] || [];
    const hasNote = chapterNotes.length > 0;

    const downloaded = !!url && downloadedUriSet.has(getLocalPathForUrl(url));

    return (
      <View style={[styles.unitRow, settings.compactMode && styles.unitRowCompact]}>
        <TouchableOpacity
          style={styles.unitMainTap}
          activeOpacity={0.75}
          onPress={() => openUnit(unit, subject.subjectName)}
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
              onPress={() => downloadOrCancel(unit, subject.subjectName)}
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

        <Animated.View style={[
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

            <View style={[styles.noteReaderBodyCard, { backgroundColor: noteReader.note?.colorTag || colors.inputBackground }]}>
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

      <Modal visible={viewer.visible} animationType="slide" onRequestClose={closeViewer}>
        <SafeAreaView style={styles.readerContainer}>
          <View style={styles.readerHeader}>
            <TouchableOpacity onPress={closeViewer} style={styles.readerHeaderIconBtn}>
              <Ionicons name="arrow-back" size={20} color={TEXT} />
            </TouchableOpacity>

            <View style={styles.readerTitleWrap}>
              <Text style={styles.readerTitle} numberOfLines={1}>{viewer.title}</Text>
              {!!viewer.subjectName && (
                <Text style={styles.readerSubtitle} numberOfLines={1}>{viewer.subjectName}</Text>
              )}
              <Text style={styles.readerStatusText} numberOfLines={1}>
                Opened from your phone storage
              </Text>
            </View>

            <TouchableOpacity
              onPress={reloadViewer}
              style={styles.readerHeaderIconBtn}
            >
              <Ionicons name="refresh" size={18} color={PRIMARY} />
            </TouchableOpacity>
          </View>

          <View style={styles.readerBodyWrap}>
            {viewer.localUri && NativePdfView ? (
              <>
                <NativePdfView
                  key={`${viewer.localUri}-${viewer.reloadKey}`}
                  source={{ uri: viewer.localUri }}
                  style={styles.readerWebView}
                  onLoadComplete={() => setViewerLoading(false)}
                  onError={(error) => {
                    console.warn("Textbook PDF load error:", error);
                    setViewerLoading(false);
                    Alert.alert("Unable to load", "This PDF could not be opened from your phone. Delete it and download it again.");
                  }}
                  enableDoubleTapZoom
                />

                {viewerLoading ? (
                  <View style={styles.readerLoadingOverlay}>
                    <ActivityIndicator size="large" color={PRIMARY} />
                    <Text style={styles.readerLoadingText}>Opening chapter...</Text>
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
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: CARD,
  },
  readerHeaderIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
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
  readerSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: MUTED,
  },
  readerStatusText: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
    color: PRIMARY,
  },
  readerBodyWrap: {
    flex: 1,
    margin: 0,
    borderRadius: 0,
    overflow: "hidden",
    borderWidth: 0,
    backgroundColor: CARD,
  },
  readerWebView: {
    flex: 1,
    backgroundColor: BG,
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