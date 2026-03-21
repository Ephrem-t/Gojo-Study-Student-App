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
  TextInput,
  Switch,
  Animated,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get } from "firebase/database";
import { database } from "../../constants/firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { WebView } from "react-native-webview";
import { useRouter, useFocusEffect } from "expo-router";

const PRIMARY = "#0B72FF";
const TEXT = "#0B2540";
const MUTED = "#6B78A8";
const CARD = "#FFFFFF";
const BORDER = "#EAF0FF";
const BG = "#ffffff";
const SUCCESS = "#12B76A";

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

function getSubjectColor(subjectName) {
  const name = (subjectName || "").toLowerCase();
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

export default function BooksScreen() {
  const router = useRouter();

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

  const [viewer, setViewer] = useState({ visible: false, uri: null, title: "" });
  const [notesMap, setNotesMap] = useState({});

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
  }, [ensureBooksDir, loadDownloadIndex]);

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
      setDownloadingMap((s) => {
        const c = { ...s };
        delete c[url];
        return c;
      });
      setDownloadProgress((s) => ({ ...s, [url]: 1 }));
      delete activeDownloadsRef.current[url];
      await registerDownloadMetadata(url, meta);
      await refreshDownloadedFiles();
      return out.uri;
    } catch (err) {
      try {
        const fb = await FileSystem.downloadAsync(url, localPath);
        setDownloadingMap((s) => {
          const c = { ...s };
          delete c[url];
          return c;
        });
        setDownloadProgress((s) => ({ ...s, [url]: 1 }));
        delete activeDownloadsRef.current[url];
        await registerDownloadMetadata(url, meta);
        await refreshDownloadedFiles();
        return fb.uri;
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

  const openRemotePdfInViewer = useCallback((remoteUrl, title) => {
    const gview = `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(remoteUrl)}`;
    setViewer({ visible: true, uri: gview, title });
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
            const note = subjectUnits[unitKey] || {};
            next[`${subjectKey}__${unitKey}`] = note;
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
          coverUrl: b.coverUrl || null,
          language: b.language || "",
          region: b.region || "",
          units,
          totalUnits: units.length,
        };
      });

      setSubjects(list);

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

  const openNoteEditor = useCallback((subject, unit) => {
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
      },
    });
  }, [router, schoolCode, studentId, studentGrade]);

  const openUnit = useCallback(async (unit, subjectName) => {
    const url = unit.pdfUrl;
    if (!url) return Alert.alert("No PDF", "This unit has no pdfUrl.");

    const localPath = getLocalPathForUrl(url);
    const info = await FileSystem.getInfoAsync(localPath);

    if (info.exists) {
      return openRemotePdfInViewer(url, unit.title);
    }

    Alert.alert("Read Unit", "Choose action.", [
      { text: "Cancel", style: "cancel" },
      { text: "Read Online", onPress: () => openRemotePdfInViewer(url, unit.title) },
      {
        text: "Download",
        onPress: async () => {
          try {
            await downloadToLocal(url, { title: unit.title, subjectName });
            Alert.alert("Downloaded", "Saved for offline cache.");
          } catch {
            Alert.alert("Download failed", "Unable to download this unit.");
          }
        },
      },
    ]);
  }, [downloadToLocal, getLocalPathForUrl, openRemotePdfInViewer]);

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
    return Object.values(notesMap).filter((n) => String(n?.text || "").trim()).length;
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
          <Text style={styles.statValue}>{subjects.length}</Text>
          <Text style={styles.statLabel}>Subjects</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{totalUnits}</Text>
          <Text style={styles.statLabel}>Chapters</Text>
        </View>
        <View style={[styles.statCard, { marginRight: 0 }]}>
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
    const hasNote = !!notesMap[noteKey]?.text?.trim();

    const downloaded = !!url && downloadedUriSet.has(getLocalPathForUrl(url));

    return (
      <View style={[styles.unitRow, settings.compactMode && styles.unitRowCompact]}>
        <View style={styles.unitOrderBadge}>
          <Text style={styles.unitOrderText}>{unit.order || index + 1}</Text>
        </View>

        <View style={{ flex: 1, marginLeft: 10 }}>
          <View style={styles.unitTitleRow}>
            <Text style={styles.unitTitle}>{unit.title}</Text>
            {hasNote ? (
              <View style={styles.noteBadge}>
                <Ionicons name="document-text" size={12} color={PRIMARY} />
                <Text style={styles.noteBadgeText}>Note</Text>
              </View>
            ) : null}
          </View>
        </View>

        {isDownloading ? (
          <TouchableOpacity onPress={() => cancelDownload(url)} style={styles.progressWrap}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.progressText}>{progress}%</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.unitActions}>
            <TouchableOpacity onPress={() => openNoteEditor(subject, unit)} style={styles.iconBtnSoft}>
              <Ionicons name={hasNote ? "create" : "create-outline"} size={18} color={PRIMARY} />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => openUnit(unit, subject.subjectName)} style={styles.readBtn}>
              <Text style={styles.readBtnText}>Read</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => downloadOrCancel(unit, subject.subjectName)}
              style={[styles.iconDownload, downloaded ? styles.iconDownloaded : null]}
            >
              <Ionicons
                name={downloaded ? "cloud-done" : "cloud-download-outline"}
                size={18}
                color={downloaded ? "#fff" : PRIMARY}
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
            <Ionicons name="search-outline" size={18} color={MUTED} />
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
            <Ionicons name="cloud-outline" size={20} color={PRIMARY} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.topActionBtn}
            onPress={() => setSettingsVisible(true)}
          >
            <Ionicons name="settings-outline" size={20} color={PRIMARY} />
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
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                {item.coverUrl ? (
                  <Image
                    source={{ uri: item.coverUrl }}
                    style={styles.cover}
                  />
                ) : (
                  <View style={[styles.cover, styles.subjectIconContainer]}>
                    <Ionicons 
                      name={getSubjectIcon(item.title)} 
                      size={32} 
                      color={getSubjectColor(item.title)} 
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

              <TouchableOpacity style={styles.expandBtn} onPress={() => toggleExpand(item.subjectKey)}>
                <Ionicons
                  name={expanded[item.subjectKey] ? "chevron-up-outline" : "chevron-down-outline"}
                  size={24}
                  color="#444"
                />
              </TouchableOpacity>
            </View>

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
                    trackColor={{ false: "#DDE6F5", true: "#B7D3FF" }}
                    thumbColor={settings.showDownloadedOnly ? PRIMARY : "#fff"}
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
                    trackColor={{ false: "#DDE6F5", true: "#B7D3FF" }}
                    thumbColor={settings.autoExpandSubjects ? PRIMARY : "#fff"}
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
                    trackColor={{ false: "#DDE6F5", true: "#B7D3FF" }}
                    thumbColor={settings.compactMode ? PRIMARY : "#fff"}
                  />
                </View>
              </View>
            }
          />
        </View>
      </Modal>

      <Modal visible={viewer.visible} animationType="slide" onRequestClose={() => setViewer({ visible: false, uri: null, title: "" })}>
        <SafeAreaView style={styles.readerContainer}>
          <View style={styles.readerHeader}>
            <TouchableOpacity onPress={() => setViewer({ visible: false, uri: null, title: "" })} style={{ padding: 8 }}>
              <Ionicons name="close" size={22} color="#222" />
            </TouchableOpacity>
            <Text style={styles.readerTitle} numberOfLines={1}>{viewer.title}</Text>
            <View style={{ width: 36 }} />
          </View>

          {viewer.uri ? (
            <WebView
              source={{ uri: viewer.uri }}
              originWhitelist={["*"]}
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
              style={{ flex: 1, backgroundColor: "#fff" }}
              onError={() => Alert.alert("Unable to load", "Could not open online reader for this PDF.")}
            />
          ) : (
            <View style={styles.center}>
              <Text style={{ color: MUTED }}>No document selected</Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      <Modal visible={managerVisible} animationType="slide" onRequestClose={() => setManagerVisible(false)}>
        <SafeAreaView style={styles.managerContainer}>
          <View style={styles.managerHeader}>
            <TouchableOpacity onPress={() => setManagerVisible(false)} style={{ padding: 8 }}>
              <Ionicons name="close" size={22} color="#222" />
            </TouchableOpacity>
            <View style={{ alignItems: "center" }}>
              <Text style={styles.managerTitle}>Downloads</Text>
              <Text style={{ color: MUTED, fontSize: 12 }}>
                {downloadedFilesList.length} files • {totalDownloadedSizeMB} MB
              </Text>
            </View>
            <TouchableOpacity onPress={() => refreshDownloadedFiles()} style={{ padding: 8 }}>
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
              renderItem={({ item }) => (
                <View style={styles.fileRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fileName}>{item.title}</Text>
                    <Text style={styles.fileMeta}>
                      {(item.size / 1024).toFixed(1)} KB • {item.subjectName || ""}
                    </Text>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <TouchableOpacity
                      onPress={() => {
                        if (item.url) openRemotePdfInViewer(item.url, item.title);
                        else Alert.alert("No online link", "This cached file has no source URL.");
                      }}
                      style={{ marginRight: 12 }}
                    >
                      <Ionicons name="open-outline" size={22} color={PRIMARY} />
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
                    >
                      <Ionicons name="trash-outline" size={22} color="#d23f44" />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  stickyWrap: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  topUtilityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  searchCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    height: 48,
  },
  searchInput: {
    flex: 1,
    color: TEXT,
    marginLeft: 8,
  },
  topActionBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },

  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    marginRight: 10,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "900",
    color: TEXT,
  },
  statLabel: {
    marginTop: 4,
    fontSize: 12,
    color: MUTED,
    fontWeight: "600",
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
    backgroundColor: "#fff",
  },

  activeChip: {
    backgroundColor: "#EAF3FF",
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
    borderRadius: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
  },
  cardHeader: {
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  subjectIconContainer: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8f9fa",
  },
  cover: {
    width: 56,
    height: 74,
    borderRadius: 10,
    backgroundColor: "#f8f9fa",
  },
  subjectName: {
    fontWeight: "900",
    fontSize: 16,
    color: TEXT,
  },
  subjectSub: {
    color: MUTED,
    marginTop: 4,
    fontSize: 12,
  },
  metaChip: {
    marginRight: 6,
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#F1F5FF",
    color: PRIMARY,
    fontSize: 11,
    overflow: "hidden",
  },
  expandBtn: { paddingHorizontal: 8, paddingVertical: 6 },

  unitsContainer: {
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  unitRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderTopColor: BORDER,
    borderTopWidth: 1,
  },
  unitRowCompact: {
    paddingVertical: 8,
  },
  unitOrderBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#EEF4FF",
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
    color: "#1B2B45",
    marginRight: 6,
  },
  noteBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EEF4FF",
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
    marginLeft: 8,
  },
  iconBtnSoft: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  readBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  readBtnText: { color: "#fff", fontWeight: "800" },

  iconDownload: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
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
    color: "#fff",
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
  emptyTitle: { fontSize: 20, fontWeight: "800", color: "#222", marginBottom: 6 },
  emptySubtitle: { fontSize: 14, color: MUTED, textAlign: "center" },

  readerContainer: { flex: 1, backgroundColor: "#fff" },
  readerHeader: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  readerTitle: {
    fontWeight: "700",
    fontSize: 15,
    color: "#222",
    flex: 1,
    textAlign: "center",
  },

  managerContainer: { flex: 1, backgroundColor: "#fff" },
  managerHeader: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  managerTitle: { fontWeight: "700", fontSize: 16, color: "#222" },

  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomColor: BORDER,
    borderBottomWidth: 1,
  },
  fileName: { fontSize: 13, fontWeight: "700", color: "#111" },
  fileMeta: { fontSize: 12, color: MUTED, marginTop: 4 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(9, 20, 42, 0.35)",
  },
  bottomSheet: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    maxHeight: "78%",
    backgroundColor: "#fff",
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
    backgroundColor: "#D7DFEE",
    alignSelf: "center",
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: TEXT,
    marginBottom: 14,
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
    backgroundColor: "#fff",
    marginRight: 8,
    marginBottom: 8,
  },
  filterChipOn: { backgroundColor: "#EAF3FF", borderColor: PRIMARY },
  filterChipText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  filterChipTextOn: { color: PRIMARY },

  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F4FA",
  },
  settingTitle: { fontSize: 14, fontWeight: "800", color: TEXT },
  settingSubtitle: { fontSize: 12, color: MUTED, marginTop: 4 },
});