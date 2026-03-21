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
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ref, get, set, remove } from "firebase/database";
import { database } from "../constants/firebaseConfig";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PRIMARY = "#0B72FF";
const TEXT = "#0B2540";
const MUTED = "#6B78A8";
const BORDER = "#EAF0FF";

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
  } = useLocalSearchParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Saved");

  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [pinned, setPinned] = useState(false);
  const [colorTag, setColorTag] = useState(NOTE_COLORS[0]);

  const lastSavedRef = useRef("");

  const gradeKey = useMemo(() => normalizeGradeKey(grade), [grade]);

  const notePath = useMemo(() => {
    if (!schoolCode || !studentId || !gradeKey || !subjectKey || !unitKey) return null;
    return `Platform1/Schools/${schoolCode}/StudentBookNotes/${studentId}/${gradeKey}/${subjectKey}/${unitKey}`;
  }, [schoolCode, studentId, gradeKey, subjectKey, unitKey]);

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
    if (!notePath || loading) return;

    const timer = setTimeout(async () => {
      const current = JSON.stringify({
        title: noteTitle,
        text: noteText,
        pinned,
        colorTag,
      });

      if (current === lastSavedRef.current) return;

      try {
        setSaveStatus("Saving...");
        await saveNote(false);
      } catch {}
    }, 800);

    return () => clearTimeout(timer);
  }, [noteTitle, noteText, pinned, colorTag, notePath, loading]);

  const saveNote = async (showAlert = true) => {
    try {
      if (!notePath) return;
      setSaving(true);
      setSaveStatus("Saving...");

      const now = Date.now();
      const existing = await get(ref(database, notePath));
      const prev = existing.exists() ? existing.val() || {} : {};

      const payload = {
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

      await set(ref(database, notePath), payload);

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
      await remove(ref(database, notePath));
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

        <TouchableOpacity style={styles.topIconBtn} onPress={() => saveNote(true)}>
          <Ionicons name="save-outline" size={20} color={PRIMARY} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: Math.max(30, insets.bottom + 24),
        }}
        showsVerticalScrollIndicator={false}
      >
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

          <TouchableOpacity
            style={[styles.pinBtn, pinned && styles.pinBtnActive]}
            onPress={() => setPinned((p) => !p)}
          >
            <Ionicons name={pinned ? "pin" : "pin-outline"} size={14} color={pinned ? "#fff" : PRIMARY} />
            <Text style={[styles.pinBtnText, pinned && styles.pinBtnTextActive]}>
              {pinned ? "Pinned" : "Pin"}
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          value={noteTitle}
          onChangeText={setNoteTitle}
          placeholder="Note title"
          placeholderTextColor={MUTED}
          style={styles.titleInput}
        />

        <Text style={styles.sectionLabel}>Note color</Text>
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

        <Text style={styles.sectionLabel}>Your notes</Text>
        <TextInput
          value={noteText}
          onChangeText={setNoteText}
          placeholder="Write your ideas, summary, formulas, difficult points, reminders, keywords, or chapter breakdown..."
          placeholderTextColor={MUTED}
          multiline
          textAlignVertical="top"
          style={[styles.bodyInput, { backgroundColor: colorTag }]}
        />

        <View style={styles.helperCard}>
          <Text style={styles.helperTitle}>Tip</Text>
          <Text style={styles.helperText}>
            Use this page for summary notes, key formulas, questions to ask later, and exam revision points.
          </Text>
        </View>

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: "#fff",
  },
  topIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
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

  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
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

  pinBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  pinBtnActive: {
    backgroundColor: PRIMARY,
  },
  pinBtnText: {
    marginLeft: 6,
    color: PRIMARY,
    fontWeight: "700",
    fontSize: 12,
  },
  pinBtnTextActive: {
    color: "#fff",
  },

  titleInput: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 15,
    color: TEXT,
    fontWeight: "800",
    backgroundColor: "#fff",
    marginBottom: 16,
  },

  sectionLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: TEXT,
    marginBottom: 10,
  },

  colorRow: {
    flexDirection: "row",
    marginBottom: 18,
  },
  colorDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: 10,
    borderWidth: 2,
    borderColor: "transparent",
  },
  colorDotActive: {
    borderColor: PRIMARY,
  },

  bodyInput: {
    minHeight: 260,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 14,
    fontSize: 15,
    color: TEXT,
    lineHeight: 22,
  },

  helperCard: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#F8FBFF",
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
    marginTop: 18,
  },
  primaryBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    backgroundColor: PRIMARY,
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
});