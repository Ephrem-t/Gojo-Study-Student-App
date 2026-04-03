import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { APP_LOCK_PASSCODE_LENGTH } from "../constants/appLock";

const PASSCODE_KEY_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [null, "0", "backspace"],
];

export default function PasscodePanel({
  colors,
  title,
  subtitle,
  value = "",
  errorText = "",
  iconName = "lock-closed-outline",
  busy = false,
  onDigitPress,
  onBackspace,
  secondaryLabel,
  onSecondaryPress,
  primaryLabel,
  onPrimaryPress,
  primaryDisabled = false,
  footerNote,
}) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const digits = String(value || "");

  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <Ionicons name={iconName} size={22} color={colors.primary} />
      </View>

      <Text style={styles.title}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

      <View style={styles.dotRow}>
        {Array.from({ length: APP_LOCK_PASSCODE_LENGTH }).map((_, index) => {
          const filled = digits.length > index;
          return <View key={index} style={[styles.dot, filled && styles.dotFilled]} />;
        })}
      </View>

      {!!errorText && <Text style={styles.errorText}>{errorText}</Text>}

      <View style={styles.keypad}>
        {PASSCODE_KEY_ROWS.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.keyRow}>
            {row.map((keyValue, keyIndex) => {
              if (!keyValue) {
                return <View key={`${rowIndex}-${keyIndex}`} style={styles.keySpacer} />;
              }

              if (keyValue === "backspace") {
                return (
                  <TouchableOpacity
                    key={`${rowIndex}-${keyIndex}`}
                    activeOpacity={0.86}
                    style={styles.keyButton}
                    onPress={onBackspace}
                    disabled={busy}
                  >
                    <Ionicons name="backspace-outline" size={20} color={colors.text} />
                  </TouchableOpacity>
                );
              }

              return (
                <TouchableOpacity
                  key={`${rowIndex}-${keyIndex}`}
                  activeOpacity={0.86}
                  style={styles.keyButton}
                  onPress={() => onDigitPress?.(keyValue)}
                  disabled={busy}
                >
                  <Text style={styles.keyText}>{keyValue}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {(secondaryLabel || primaryLabel) && (
        <View style={styles.actionRow}>
          {!!secondaryLabel && (
            <TouchableOpacity
              activeOpacity={0.86}
              style={[styles.actionButton, styles.secondaryButton]}
              onPress={onSecondaryPress}
              disabled={busy}
            >
              <Text style={styles.secondaryText}>{secondaryLabel}</Text>
            </TouchableOpacity>
          )}

          {!!primaryLabel && (
            <TouchableOpacity
              activeOpacity={0.86}
              style={[styles.actionButton, styles.primaryButton, primaryDisabled && styles.primaryButtonDisabled]}
              onPress={onPrimaryPress}
              disabled={busy || primaryDisabled}
            >
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>{primaryLabel}</Text>}
            </TouchableOpacity>
          )}
        </View>
      )}

      {!!footerNote && <Text style={styles.footerNote}>{footerNote}</Text>}
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    card: {
      width: "100%",
      maxWidth: 380,
      backgroundColor: colors.panel,
      borderRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 22,
      paddingBottom: 18,
      borderWidth: 1,
      borderColor: colors.border,
    },
    iconWrap: {
      width: 52,
      height: 52,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
      backgroundColor: colors.soft,
      marginBottom: 14,
    },
    title: {
      fontSize: 20,
      fontWeight: "800",
      color: colors.text,
      textAlign: "center",
    },
    subtitle: {
      marginTop: 8,
      fontSize: 13,
      lineHeight: 19,
      color: colors.muted,
      textAlign: "center",
    },
    dotRow: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      marginTop: 22,
      marginBottom: 16,
      gap: 12,
    },
    dot: {
      width: 14,
      height: 14,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    dotFilled: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    errorText: {
      minHeight: 18,
      fontSize: 12,
      fontWeight: "700",
      color: colors.danger,
      textAlign: "center",
      marginBottom: 8,
    },
    keypad: {
      marginTop: 4,
    },
    keyRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 10,
    },
    keyButton: {
      width: 88,
      height: 58,
      borderRadius: 18,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    keySpacer: {
      width: 88,
      height: 58,
    },
    keyText: {
      fontSize: 24,
      fontWeight: "700",
      color: colors.text,
    },
    actionRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 10,
      marginTop: 18,
    },
    actionButton: {
      flex: 1,
      height: 46,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryButton: {
      backgroundColor: colors.surfaceMuted,
    },
    primaryButton: {
      backgroundColor: colors.primary,
    },
    primaryButtonDisabled: {
      opacity: 0.6,
    },
    secondaryText: {
      color: colors.text,
      fontWeight: "700",
      fontSize: 14,
    },
    primaryText: {
      color: colors.white,
      fontWeight: "800",
      fontSize: 14,
    },
    footerNote: {
      marginTop: 14,
      fontSize: 11,
      lineHeight: 16,
      textAlign: "center",
      color: colors.muted,
    },
  });
}