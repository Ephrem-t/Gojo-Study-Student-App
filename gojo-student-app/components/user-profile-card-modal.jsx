import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppTheme } from "../hooks/use-app-theme";

export default function UserProfileCardModal({ visible, loading, profile, onClose, onMessage }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.accent} />
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <View style={styles.hero}>
                {profile?.avatar ? (
                  <Image source={{ uri: profile.avatar }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarLetter}>{(profile?.name || "U")[0]}</Text>
                  </View>
                )}
                <Text style={styles.name}>{profile?.name || "-"}</Text>
                <Text style={styles.roleLine}>
                  <Text style={styles.roleLabel}>Role</Text>
                  <Text style={styles.roleDot}>  •  </Text>
                  <Text style={styles.roleValue}>{profile?.roleTitle || profile?.role || "School Account"}</Text>
                </Text>
              </View>

              <View style={styles.infoGrid}>
                <InfoRow label="School" value={profile?.school || "-"} styles={styles} />
                <InfoRow label="Office No" value={profile?.officeNumber || "-"} styles={styles} />
                <InfoRow label="Location" value={profile?.location || "-"} styles={styles} />
              </View>

              <View style={[styles.actions, !profile?.canMessage && styles.actionsSingle]}>
                {profile?.canMessage ? (
                  <TouchableOpacity style={styles.messageBtn} activeOpacity={0.9} onPress={onMessage}>
                    <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.white} />
                    <Text style={styles.messageBtnText}>Message</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={[styles.closeBtn, !profile?.canMessage && styles.closeBtnFull]} activeOpacity={0.88} onPress={onClose}>
                  <Text style={styles.closeBtnText}>Close</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function InfoRow({ label, value, styles }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.modalBackdrop,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 18,
    },
    card: {
      width: "100%",
      maxWidth: 344,
      backgroundColor: colors.card,
      borderRadius: 24,
      paddingHorizontal: 16,
      paddingTop: 18,
      paddingBottom: 14,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.tabGlassActive,
      shadowColor: "#001845",
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.16,
      shadowRadius: 28,
      elevation: 18,
    },
    accent: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 68,
      backgroundColor: colors.soft,
    },
    hero: {
      alignItems: "center",
      marginBottom: 12,
    },
    avatar: {
      width: 68,
      height: 68,
      borderRadius: 34,
      marginBottom: 10,
      backgroundColor: colors.soft,
      borderWidth: 2,
      borderColor: colors.background,
    },
    avatarFallback: {
      alignItems: "center",
      justifyContent: "center",
    },
    avatarLetter: {
      fontSize: 24,
      fontWeight: "800",
      color: colors.primary,
    },
    name: {
      fontSize: 20,
      fontWeight: "800",
      color: colors.text,
      textAlign: "center",
    },
    roleLine: {
      marginTop: 8,
      fontSize: 13,
      textAlign: "center",
    },
    roleLabel: {
      color: colors.muted,
      fontWeight: "700",
    },
    roleDot: {
      color: colors.muted,
    },
    roleValue: {
      fontSize: 13,
      fontWeight: "800",
      color: colors.primary,
    },
    infoGrid: {
      gap: 8,
    },
    infoRow: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 14,
      backgroundColor: colors.elevatedSurface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    infoLabel: {
      fontSize: 10,
      fontWeight: "800",
      color: colors.muted,
      textTransform: "uppercase",
      marginBottom: 3,
    },
    infoValue: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
    },
    actions: {
      flexDirection: "row",
      gap: 10,
      marginTop: 12,
    },
    actionsSingle: {
      justifyContent: "center",
    },
    messageBtn: {
      flex: 1,
      minHeight: 40,
      borderRadius: 12,
      backgroundColor: colors.primary,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 16,
      elevation: 8,
    },
    messageBtnText: {
      color: colors.white,
      fontSize: 14,
      fontWeight: "800",
    },
    closeBtn: {
      flex: 1,
      minHeight: 40,
      borderRadius: 12,
      backgroundColor: colors.subduedButton,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    closeBtnFull: {
      flex: 0,
      minWidth: 120,
    },
    closeBtnText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "800",
    },
  });
}