import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  Modal,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ref, get, set, remove, update } from "firebase/database";
import { database } from "../constants/firebaseConfig";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PRIMARY = "#0B72FF";
const TEXT = "#0B2540";
const MUTED = "#6B78A8";
const BORDER = "#EAF0FF";
const MAX_NOTES_PER_CHAPTER = 5;

const NOTE_COLORS = [
  "#EEF4FF",
  "#FFF4E8",
  "#ECFDF3",
  "#FEF3F2",
  "#F4F3FF",
];

function normalizeGradeKey(g) {
  if (!g) return null;
  const s = String(g).toLowerCase().replace("grade", "").trim();
  return `grade${s}`;
}

function countChapterNotes(value) {
  if (!value || typeof value !== "object") return 0;

  let count = 0;

  if (typeof value.title === "string" || typeof value.text === "string") {
    count += 1;
  }

  if (value.notes && typeof value.notes === "object") {
    count += Object.values(value.notes).filter((note) => note && typeof note === "object").length;
  }

  return count;
}

export default function ChapterNoteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const {
    studentId,
    schoolCode,
    grade,
    subjectKey,
    subjectTitle,
    unitKey,
    unitTitle,
    noteId,
  } = useLocalSearchParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Saved");

  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [pinned, setPinned] = useState(false);
  const [colorTag, setColorTag] = useState(NOTE_COLORS[0]);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [noteFontSize, setNoteFontSize] = useState(15);
  const [showHelperTip, setShowHelperTip] = useState(true);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  const lastSavedRef = useRef("");
  const generatedNoteIdRef = useRef(`note_${Date.now()}`);
  const noteScrollRef = useRef(null);

  const keepEditorInView = () => {
    requestAnimationFrame(() => {
      noteScrollRef.current?.scrollToEnd({ animated: true });
    });
  };

  const gradeKey = useMemo(() => normalizeGradeKey(grade), [grade]);

  const effectiveNoteId = useMemo(() => {
    const raw = String(noteId || "").trim();
    return raw || generatedNoteIdRef.current;
  }, [noteId]);

  const unitPath = useMemo(() => {
    if (!schoolCode || !studentId || !gradeKey || !subjectKey || !unitKey) return null;
    return `Platform1/Schools/${schoolCode}/StudentBookNotes/${studentId}/${gradeKey}/${subjectKey}/${unitKey}`;
  }, [schoolCode, studentId, gradeKey, subjectKey, unitKey]);

  const notePath = useMemo(() => {
    if (!unitPath) return null;
    if (effectiveNoteId === "legacy") return unitPath;
    return `${unitPath}/notes/${effectiveNoteId}`;
  }, [unitPath, effectiveNoteId]);

  const isEmptyNote = useMemo(() => {
    return !String(noteText || "").trim();
  }, [noteText]);

  useEffect(() => {
    (async () => {
      try {
        if (!notePath) return;

        const snap = await get(ref(database, notePath));
        if (snap.exists()) {
          const val = snap.val() || {};
          setNoteTitle(val.title || "");
          setNoteText(val.text || "");
          setPinned(!!val.pinned);
          setColorTag(val.colorTag || NOTE_COLORS[0]);
          lastSavedRef.current = JSON.stringify({
            title: val.title || "",
            text: val.text || "",
            pinned: !!val.pinned,
            colorTag: val.colorTag || NOTE_COLORS[0],
          });
        } else {
          const defaultTitle = `${unitTitle || "Chapter"} Note`;
          setNoteTitle(defaultTitle);
          setNoteText("");
          setPinned(false);
          setColorTag(NOTE_COLORS[0]);
          lastSavedRef.current = JSON.stringify({
            title: defaultTitle,
            text: "",
            pinned: false,
            colorTag: NOTE_COLORS[0],
          });
        }
      } catch {
        Alert.alert("Error", "Failed to load note.");
      } finally {
        setLoading(false);
      }
    })();
  }, [notePath, unitTitle]);

  useEffect(() => {
    if (!notePath || loading || !autoSaveEnabled) return;

    const timer = setTimeout(async () => {
      const current = JSON.stringify({
        title: noteTitle,
        text: noteText,
        pinned,
        colorTag,
      });

      if (current === lastSavedRef.current) return;
      if (isEmptyNote) return;

      try {
        setSaveStatus("Saving...");
        await saveNote(false);
      } catch {}
    }, 800);

    return () => clearTimeout(timer);
  }, [noteTitle, noteText, pinned, colorTag, notePath, loading, isEmptyNote, autoSaveEnabled]);

  const saveNote = async (showAlert = true) => {
    try {
      if (!notePath) return;
      if (isEmptyNote) {
        setSaveStatus("Saved");
        if (showAlert) Alert.alert("Empty note", "Write some note text before saving.");
        return;
      }
      setSaving(true);
      setSaveStatus("Saving...");

      const now = Date.now();
      const existing = await get(ref(database, notePath));
      const prev = existing.exists() ? existing.val() || {} : {};

      if (!existing.exists() && effectiveNoteId !== "legacy" && unitPath) {
        const unitSnap = await get(ref(database, unitPath));
        const currentCount = countChapterNotes(unitSnap.exists() ? unitSnap.val() || {} : {});

        if (currentCount >= MAX_NOTES_PER_CHAPTER) {
          setSaveStatus("Saved");
          if (showAlert) {
            Alert.alert(
              "Note limit reached",
              `You can only create ${MAX_NOTES_PER_CHAPTER} notes in one chapter. Delete an old note to add another one.`
            );
          }
          return;
        }
      }

      const payload = {
        noteId: effectiveNoteId,
        studentId,
        gradeKey,
        subjectKey,
        unitKey,
        title: noteTitle.trim() || `${unitTitle || "Chapter"} Note`,
        text: noteText,
        pinned: !!pinned,
        colorTag,
        createdAt: prev.createdAt || now,
        updatedAt: now,
      };

      if (effectiveNoteId === "legacy" && unitPath) {
        await update(ref(database, unitPath), payload);
      } else {
        await set(ref(database, notePath), payload);
      }

      lastSavedRef.current = JSON.stringify({
        title: payload.title,
        text: payload.text,
        pinned: payload.pinned,
        colorTag: payload.colorTag,
      });

      setSaveStatus("Saved");
      if (showAlert) Alert.alert("Saved", "Your chapter note was saved.");
    } catch {
      setSaveStatus("Failed");
      if (showAlert) Alert.alert("Save failed", "Could not save note.");
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = async () => {
    try {
      if (!notePath) return;
      if (effectiveNoteId === "legacy" && unitPath) {
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
        await remove(ref(database, notePath));
      }
      Alert.alert("Deleted", "Note removed.", [
        {
          text: "OK",
          onPress: () => router.back(),
        },
      ]);
    } catch {
      Alert.alert("Delete failed", "Could not delete note.");
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ActivityIndicator color={PRIMARY} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: Math.max(8, insets.top) }]}>
        <TouchableOpacity style={styles.topIconBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={TEXT} />
        </TouchableOpacity>

        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <Text numberOfLines={1} style={styles.topTitle}>
            {unitTitle || "Chapter Note"}
          </Text>
          <Text numberOfLines={1} style={styles.topSubtitle}>
            {subjectTitle || ""}
          </Text>
        </View>

        <TouchableOpacity style={styles.topIconBtn} onPress={() => setSettingsVisible(true)}>
          <Ionicons name="settings-outline" size={20} color={PRIMARY} />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={noteScrollRef}
        contentContainerStyle={{
          padding: 14,
          paddingBottom: Math.max(130, insets.bottom + 110),
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={styles.statusPill}>
              <Ionicons
                name={
                  saveStatus === "Saved"
                    ? "checkmark-circle"
                    : saveStatus === "Saving..."
                    ? "time-outline"
                    : "alert-circle-outline"
                }
                size={14}
                color={
                  saveStatus === "Saved"
                    ? "#12B76A"
                    : saveStatus === "Saving..."
                    ? PRIMARY
                    : "#EF4444"
                }
              />
              <Text style={styles.statusText}>{saveStatus}</Text>
            </View>
          </View>

          <Text style={styles.statusHint}>
            {autoSaveEnabled
              ? "Your note autosaves as you type. Tap Save for instant backup."
              : "Auto Save is off. Tap Save to store your note."}
          </Text>
        </View>

        <View style={styles.editorCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Title</Text>
          </View>
          <TextInput
            value={noteTitle}
            onChangeText={setNoteTitle}
            placeholder="Note title"
            placeholderTextColor={MUTED}
            style={styles.titleInput}
          />
        </View>

        <View style={styles.editorCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Your notes</Text>
          </View>
          <TextInput
            value={noteText}
            onChangeText={setNoteText}
            onFocus={keepEditorInView}
            onContentSizeChange={keepEditorInView}
            placeholder="Write your ideas, summary, formulas, difficult points, reminders, keywords, or chapter breakdown..."
            placeholderTextColor={MUTED}
            multiline
            textAlignVertical="top"
            style={[
              styles.bodyInput,
              {
                backgroundColor: colorTag,
                fontSize: noteFontSize,
                lineHeight: Math.round(noteFontSize * 1.45),
              },
            ]}
          />
        </View>

        {showHelperTip ? (
          <View style={styles.helperCard}>
            <Text style={styles.helperTitle}>Tip</Text>
            <Text style={styles.helperText}>
              Use this page for summary notes, key formulas, questions to ask later, and exam revision points.
            </Text>
          </View>
        ) : null}

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.primaryBtn, saving && { opacity: 0.7 }]}
            onPress={() => saveNote(true)}
            disabled={saving}
          >
            <Ionicons name="save-outline" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>{saving ? "Saving..." : "Save Note"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() =>
              Alert.alert("Delete note", "Are you sure you want to delete this note?", [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: deleteNote },
              ])
            }
          >
            <Ionicons name="trash-outline" size={18} color="#EF4444" />
            <Text style={styles.deleteBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={settingsVisible} transparent animationType="slide" onRequestClose={() => setSettingsVisible(false)}>
        <Pressable style={styles.settingsBackdrop} onPress={() => setSettingsVisible(false)} />
        <View style={[styles.settingsSheet, { paddingBottom: Math.max(18, insets.bottom + 10) }]}>
          <View style={styles.settingsHandle} />
          <Text style={styles.settingsTitle}>Note Settings</Text>

          <View style={styles.settingsCard}>
            <View style={styles.settingsRow}>
              <View>
                <Text style={styles.settingsLabel}>Pin note</Text>
                <Text style={styles.settingsSubLabel}>Keep this note on top in your chapter list.</Text>
              </View>

              <TouchableOpacity
                style={[styles.settingPinChip, pinned && styles.settingPinChipActive]}
                onPress={() => setPinned((p) => !p)}
              >
                <Ionicons name={pinned ? "pin" : "pin-outline"} size={14} color={pinned ? "#fff" : PRIMARY} />
                <Text style={[styles.settingPinChipText, pinned && styles.settingPinChipTextActive]}>
                  {pinned ? "Pinned" : "Pin"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.settingsCard, { marginTop: 10 }]}> 
            <Text style={styles.settingsLabel}>Note color</Text>
            <Text style={styles.settingsSubLabel}>Choose a color for easy note recognition.</Text>
            <View style={styles.colorRow}>
              {NOTE_COLORS.map((c) => {
                const active = colorTag === c;
                return (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setColorTag(c)}
                    style={[styles.colorDot, { backgroundColor: c }, active && styles.colorDotActive]}
                  />
                );
              })}
            </View>
          </View>

          <View style={[styles.settingsCard, { marginTop: 10 }]}> 
            <Text style={styles.settingsLabel}>Text Size</Text>
            <Text style={styles.settingsSubLabel}>Set the note font size for comfortable reading.</Text>

            <View style={[styles.optionRow, { marginTop: 10 }]}> 
              <Text style={styles.optionLabel}>Size</Text>
              <View style={styles.sizeOptionsWrap}>
                {[13, 15, 17].map((size) => {
                  const active = noteFontSize === size;
                  return (
                    <TouchableOpacity
                      key={String(size)}
                      style={[styles.sizeChip, active && styles.sizeChipActive]}
                      onPress={() => setNoteFontSize(size)}
                    >
                      <Text style={[styles.sizeChipText, active && styles.sizeChipTextActive]}>{size}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>

          <View style={[styles.settingsCard, { marginTop: 10 }]}> 
            <Text style={styles.settingsLabel}>Show Study Tip</Text>
            <Text style={styles.settingsSubLabel}>Display or hide the revision tip below the editor.</Text>

            <View style={[styles.optionRow, { marginTop: 10 }]}> 
              <Text style={styles.optionLabel}>Status</Text>
              <TouchableOpacity
                style={[styles.toggleChip, showHelperTip && styles.toggleChipActive]}
                onPress={() => setShowHelperTip((v) => !v)}
              >
                <Ionicons
                  name={showHelperTip ? "checkmark-circle" : "ellipse-outline"}
                  size={14}
                  color={showHelperTip ? "#fff" : PRIMARY}
                />
                <Text style={[styles.toggleChipText, showHelperTip && styles.toggleChipTextActive]}>
                  {showHelperTip ? "On" : "Off"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.settingsCard, { marginTop: 10 }]}> 
            <Text style={styles.settingsLabel}>Auto Save</Text>
            <Text style={styles.settingsSubLabel}>Automatically save your note while typing.</Text>

            <View style={[styles.optionRow, { marginTop: 10 }]}> 
              <Text style={styles.optionLabel}>Status</Text>
              <TouchableOpacity
                style={[styles.toggleChip, autoSaveEnabled && styles.toggleChipActive]}
                onPress={() => setAutoSaveEnabled((v) => !v)}
              >
                <Ionicons
                  name={autoSaveEnabled ? "checkmark-circle" : "ellipse-outline"}
                  size={14}
                  color={autoSaveEnabled ? "#fff" : PRIMARY}
                />
                <Text style={[styles.toggleChipText, autoSaveEnabled && styles.toggleChipTextActive]}>
                  {autoSaveEnabled ? "On" : "Off"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={styles.settingsDoneBtn} onPress={() => setSettingsVisible(false)}>
            <Text style={styles.settingsDoneText}>Done</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F3F7FD" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 9,
    borderBottomWidth: 1,
    borderBottomColor: "#E1E9FA",
    backgroundColor: "#FFFFFF",
  },
  topIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE7FF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  topTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: TEXT,
  },
  topSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: MUTED,
    fontWeight: "600",
  },

  statusCard: {
    borderWidth: 1,
    borderColor: "#E4ECFF",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 8,
    marginBottom: 8,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
  },
  statusHint: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "600",
    color: MUTED,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: {
    marginLeft: 6,
    fontSize: 12,
    color: TEXT,
    fontWeight: "700",
  },
  editorCard: {
    borderWidth: 1,
    borderColor: "#E4ECFF",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginBottom: 8,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },

  titleInput: {
    borderWidth: 1,
    borderColor: "#DCE7FF",
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 42,
    fontSize: 15,
    color: TEXT,
    fontWeight: "800",
    backgroundColor: "#FBFDFF",
  },

  sectionLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: TEXT,
    marginBottom: 0,
  },

  colorRow: {
    flexDirection: "row",
    paddingTop: 8,
  },
  colorDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
    borderWidth: 2,
    borderColor: "transparent",
  },
  colorDotActive: {
    borderColor: PRIMARY,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },

  bodyInput: {
    minHeight: 250,
    borderWidth: 1,
    borderColor: "#DCE7FF",
    borderRadius: 14,
    padding: 12,
    fontSize: 15,
    color: TEXT,
    lineHeight: 22,
  },

  helperCard: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: "#EDE7D0",
    backgroundColor: "#FFFDF6",
    borderRadius: 14,
    padding: 12,
  },
  helperTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: TEXT,
    marginBottom: 4,
  },
  helperText: {
    fontSize: 12,
    color: MUTED,
    lineHeight: 18,
    fontWeight: "600",
  },

  actionRow: {
    flexDirection: "row",
    marginTop: 14,
  },
  primaryBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    backgroundColor: PRIMARY,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "800",
    marginLeft: 8,
  },

  deleteBtn: {
    width: 110,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FFF5F5",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteBtnText: {
    color: "#EF4444",
    fontWeight: "800",
    marginLeft: 6,
  },

  settingsBackdrop: {
    flex: 1,
    backgroundColor: "rgba(9, 20, 42, 0.38)",
  },
  settingsSheet: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  settingsHandle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#D7DFEE",
    alignSelf: "center",
    marginBottom: 10,
  },
  settingsTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: TEXT,
    marginBottom: 12,
  },
  settingsCard: {
    borderWidth: 1,
    borderColor: "#E4ECFF",
    borderRadius: 14,
    backgroundColor: "#FBFDFF",
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  settingsLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: TEXT,
  },
  settingsSubLabel: {
    marginTop: 4,
    fontSize: 11,
    color: MUTED,
    fontWeight: "600",
  },
  settingPinChip: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#fff",
    marginLeft: 8,
  },
  settingPinChipActive: {
    backgroundColor: PRIMARY,
  },
  settingPinChipText: {
    marginLeft: 6,
    color: PRIMARY,
    fontWeight: "700",
    fontSize: 12,
  },
  settingPinChipTextActive: {
    color: "#fff",
  },
  settingsDoneBtn: {
    marginTop: 12,
    height: 46,
    borderRadius: 14,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
  },
  settingsDoneText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 14,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: TEXT,
  },
  sizeOptionsWrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  sizeChip: {
    minWidth: 34,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D4E2FF",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  sizeChipActive: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  sizeChipText: {
    fontSize: 12,
    fontWeight: "800",
    color: PRIMARY,
  },
  sizeChipTextActive: {
    color: "#fff",
  },
  toggleChip: {
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: PRIMARY,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  toggleChipActive: {
    backgroundColor: PRIMARY,
  },
  toggleChipText: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: "800",
    color: PRIMARY,
  },
  toggleChipTextActive: {
    color: "#fff",
  },
});