import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "../../hooks/use-app-theme";

const HERO_IMAGE = require("../../assets/images/splash-students.png");

function withAlpha(color, alpha) {
  if (typeof color !== "string") return `rgba(0,0,0,${alpha})`;

  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((value) => value + value)
        .join("");
    }

    if (hex.length !== 6) {
      return `rgba(0,0,0,${alpha})`;
    }

    const parsed = Number.parseInt(hex, 16);
    const red = (parsed >> 16) & 255;
    const green = (parsed >> 8) & 255;
    const blue = parsed & 255;
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  if (color.startsWith("rgb(")) {
    const channels = color
      .slice(4, -1)
      .split(",")
      .map((value) => value.trim());
    if (channels.length >= 3) {
      return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
    }
  }

  return color;
}

function createPalette(colors, isDark) {
  return {
    backgroundGradient: isDark
      ? ["#07111B", "#112131", "#0A1724"]
      : ["#F2F8FF", "#E7F2FF", "#FBFDFF"],
    heroGradient: isDark
      ? [withAlpha(colors.card, 0.98), withAlpha(colors.elevatedSurface, 0.92)]
      : ["rgba(255,255,255,0.98)", "rgba(243,248,255,0.94)"],
    loadingGradient: isDark
      ? [withAlpha(colors.white, 0.04), "#6BA4FF", withAlpha(colors.white, 0.04)]
      : [withAlpha(colors.primary, 0.08), "#2286FF", withAlpha(colors.primary, 0.08)],
    shineGradient: isDark
      ? ["rgba(255,255,255,0)", "rgba(255,255,255,0.08)", "rgba(255,255,255,0)"]
      : ["rgba(255,255,255,0)", "rgba(255,255,255,0.32)", "rgba(255,255,255,0)"],
  };
}

function createStyles(colors, isDark) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 99999,
      elevation: 99999,
    },
    background: {
      flex: 1,
    },
    safeArea: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 20,
      justifyContent: "space-between",
    },
    orbPrimary: {
      position: "absolute",
      top: -64,
      right: -28,
      width: 280,
      height: 280,
      borderRadius: 999,
      backgroundColor: isDark
        ? withAlpha(colors.primary, 0.18)
        : "rgba(255,255,255,0.42)",
    },
    orbSecondary: {
      position: "absolute",
      bottom: 120,
      left: -92,
      width: 250,
      height: 250,
      borderRadius: 999,
      backgroundColor: isDark
        ? withAlpha(colors.white, 0.04)
        : withAlpha(colors.primary, 0.1),
    },
    topRow: {
      alignItems: "center",
    },
    pill: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: isDark
        ? "rgba(255,255,255,0.08)"
        : "rgba(255,255,255,0.24)",
      borderWidth: 1,
      borderColor: isDark
        ? "rgba(255,255,255,0.08)"
        : "rgba(255,255,255,0.48)",
    },
    pillText: {
      color: isDark ? "rgba(226,232,240,0.92)" : "rgba(59,76,99,0.94)",
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 1.4,
    },
    centerContent: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
    },
    heroCluster: {
      width: "100%",
      alignItems: "center",
      justifyContent: "center",
      marginTop: 10,
    },
    heroHalo: {
      position: "absolute",
      width: 328,
      height: 328,
      borderRadius: 999,
      backgroundColor: isDark
        ? withAlpha(colors.primary, 0.16)
        : withAlpha(colors.white, 0.56),
    },
    heroCard: {
      width: "100%",
      maxWidth: 360,
      borderRadius: 34,
      overflow: "hidden",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 22 },
      shadowOpacity: isDark ? 0.34 : 0.16,
      shadowRadius: 28,
      elevation: 12,
      borderWidth: 1,
      borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.56)",
    },
    heroCardGradient: {
      paddingHorizontal: 18,
      paddingTop: 20,
      paddingBottom: 18,
    },
    cardShine: {
      position: "absolute",
      top: -40,
      bottom: -40,
      width: 120,
    },
    imageFrame: {
      height: 320,
      borderRadius: 26,
      overflow: "hidden",
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: isDark
        ? withAlpha(colors.background, 0.34)
        : "rgba(255,255,255,0.78)",
      borderWidth: 1,
      borderColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(214,228,245,0.88)",
    },
    heroImage: {
      width: "100%",
      height: "100%",
    },
    featureRow: {
      marginTop: 16,
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    featureChip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: isDark
        ? withAlpha(colors.primary, 0.14)
        : "rgba(255,255,255,0.72)",
      borderWidth: 1,
      borderColor: isDark
        ? withAlpha(colors.primary, 0.24)
        : "rgba(148,163,184,0.22)",
    },
    featureText: {
      fontSize: 12,
      fontWeight: "700",
      color: isDark ? "rgba(226,232,240,0.92)" : "rgba(71,85,105,0.96)",
    },
    copyBlock: {
      marginTop: 28,
      alignItems: "center",
      paddingHorizontal: 20,
      gap: 8,
    },
    brand: {
      color: isDark ? "rgba(226,232,240,0.94)" : "rgba(59,76,99,0.96)",
      fontSize: 34,
      lineHeight: 40,
      fontWeight: "800",
      letterSpacing: 0.3,
      textAlign: "center",
    },
    subtitle: {
      maxWidth: 320,
      color: isDark ? "rgba(203,213,225,0.78)" : "rgba(100,116,139,0.92)",
      fontSize: 15,
      lineHeight: 22,
      fontWeight: "500",
      textAlign: "center",
    },
    footer: {
      alignItems: "center",
      gap: 12,
    },
    loadingRail: {
      width: 188,
      height: 8,
      borderRadius: 999,
      backgroundColor: isDark
        ? "rgba(255,255,255,0.08)"
        : "rgba(255,255,255,0.32)",
      overflow: "hidden",
    },
    loadingBarWrap: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: 84,
    },
    loadingBar: {
      flex: 1,
      borderRadius: 999,
    },
    footerText: {
      color: isDark ? "rgba(203,213,225,0.72)" : "rgba(100,116,139,0.9)",
      fontSize: 13,
      fontWeight: "600",
      letterSpacing: 0.2,
    },
  });
}

export default function AppLaunchSplash() {
  const { colors, resolvedAppearance, statusBarStyle } = useAppTheme();
  const isDark = resolvedAppearance === "dark";
  const palette = useMemo(() => createPalette(colors, isDark), [colors, isDark]);
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const floatValue = useRef(new Animated.Value(0)).current;
  const glowValue = useRef(new Animated.Value(0)).current;
  const railValue = useRef(new Animated.Value(0)).current;
  const shineValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatValue, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(floatValue, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowValue, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glowValue, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    const railLoop = Animated.loop(
      Animated.timing(railValue, {
        toValue: 1,
        duration: 1500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );

    const shineLoop = Animated.loop(
      Animated.timing(shineValue, {
        toValue: 1,
        duration: 2600,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );

    floatLoop.start();
    glowLoop.start();
    railLoop.start();
    shineLoop.start();

    return () => {
      floatLoop.stop();
      glowLoop.stop();
      railLoop.stop();
      shineLoop.stop();
    };
  }, [floatValue, glowValue, railValue, shineValue]);

  const heroTranslateY = floatValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -10],
  });
  const heroScale = glowValue.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.03],
  });
  const haloScale = glowValue.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });
  const haloOpacity = glowValue.interpolate({
    inputRange: [0, 1],
    outputRange: [isDark ? 0.26 : 0.42, isDark ? 0.42 : 0.62],
  });
  const railTranslateX = railValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-84, 188],
  });
  const shineTranslateX = shineValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-280, 280],
  });

  return (
    <View style={styles.overlay}>
      <StatusBar style={statusBarStyle} />
      <LinearGradient
        colors={palette.backgroundGradient}
        locations={[0, 0.4, 1]}
        style={styles.background}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.orbPrimary,
            {
              opacity: haloOpacity,
              transform: [{ scale: haloScale }],
            },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.orbSecondary,
            {
              transform: [{ translateY: heroTranslateY }],
            },
          ]}
        />

        <SafeAreaView style={styles.safeArea}>
          <View style={styles.topRow}>
            <View style={styles.pill}>
              <Text style={styles.pillText}>GOJO STUDY</Text>
            </View>
          </View>

          <View style={styles.centerContent}>
            <View style={styles.heroCluster}>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.heroHalo,
                  {
                    opacity: haloOpacity,
                    transform: [{ scale: haloScale }],
                  },
                ]}
              />

              <Animated.View
                style={[
                  styles.heroCard,
                  {
                    transform: [{ translateY: heroTranslateY }, { scale: heroScale }],
                  },
                ]}
              >
                <LinearGradient
                  colors={palette.heroGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.heroCardGradient}
                >
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.cardShine,
                      {
                        transform: [{ translateX: shineTranslateX }, { rotate: "-16deg" }],
                      },
                    ]}
                  >
                    <LinearGradient
                      colors={palette.shineGradient}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={StyleSheet.absoluteFill}
                    />
                  </Animated.View>

                  <View style={styles.imageFrame}>
                    <Image source={HERO_IMAGE} style={styles.heroImage} resizeMode="contain" />
                  </View>

                  <View style={styles.featureRow}>
                    <View style={styles.featureChip}>
                      <Text style={styles.featureText}>Lessons</Text>
                    </View>
                    <View style={styles.featureChip}>
                      <Text style={styles.featureText}>Assessments</Text>
                    </View>
                    <View style={styles.featureChip}>
                      <Text style={styles.featureText}>Chats</Text>
                    </View>
                  </View>
                </LinearGradient>
              </Animated.View>
            </View>

            <View style={styles.copyBlock}>
              <Text style={styles.brand}>Gojo Study</Text>
              <Text style={styles.subtitle}>
                Daily lessons, assessments, and class updates in one focused learning space.
              </Text>
            </View>
          </View>

          <View style={styles.footer}>
            <View style={styles.loadingRail}>
              <Animated.View
                style={[
                  styles.loadingBarWrap,
                  {
                    transform: [{ translateX: railTranslateX }],
                  },
                ]}
              >
                <LinearGradient
                  colors={palette.loadingGradient}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.loadingBar}
                />
              </Animated.View>
            </View>
            <Text style={styles.footerText}>Preparing your study space</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>
    </View>
  );
}