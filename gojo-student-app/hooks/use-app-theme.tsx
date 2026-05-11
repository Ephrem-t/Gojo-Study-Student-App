import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
} from "@react-navigation/native";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Colors } from "../constants/theme";

export const APPEARANCE_STORAGE_KEY = "studentAppearancePreference";

export type AppearancePreference = "light" | "dark" | "system";

type AppThemeContextValue = {
  appearance: AppearancePreference;
  resolvedAppearance: "light" | "dark";
  colors: typeof Colors.light;
  navigationTheme: typeof NavigationDefaultTheme;
  statusBarStyle: "light" | "dark";
  setAppearance: (nextAppearance: AppearancePreference) => Promise<void>;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearanceState] = useState<AppearancePreference>("light");

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const stored = await AsyncStorage.getItem(APPEARANCE_STORAGE_KEY);
        if (!mounted) return;

        if (stored === "light" || stored === "dark" || stored === "system") {
          setAppearanceState(stored);
        }
      } catch {
        // Ignore storage read failures and keep the default light appearance.
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Only explicit dark mode enables dark palette; legacy/system values resolve to light.
  const resolvedAppearance = appearance === "dark" ? "dark" : "light";

  const colors = useMemo(
    () => (resolvedAppearance === "dark" ? Colors.dark : Colors.light),
    [resolvedAppearance]
  );

  const navigationTheme = useMemo(() => {
    const baseTheme = resolvedAppearance === "dark" ? NavigationDarkTheme : NavigationDefaultTheme;

    return {
      ...baseTheme,
      colors: {
        ...baseTheme.colors,
        background: colors.background,
        card: colors.tabBar,
        text: colors.text,
        border: colors.border,
        primary: colors.primary,
        notification: colors.danger,
      },
    };
  }, [colors, resolvedAppearance]);

  const setAppearance = useCallback(async (nextAppearance: AppearancePreference) => {
    setAppearanceState(nextAppearance);
    try {
      await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, nextAppearance);
    } catch {
      // Ignore storage write failures to avoid blocking UI updates.
    }
  }, []);

  const value = useMemo<AppThemeContextValue>(() => ({
    appearance,
    resolvedAppearance,
    colors,
    navigationTheme,
    statusBarStyle: resolvedAppearance === "dark" ? "light" : "dark",
    setAppearance,
  }), [appearance, colors, navigationTheme, resolvedAppearance, setAppearance]);

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  const context = useContext(AppThemeContext);

  if (!context) {
    throw new Error("useAppTheme must be used inside AppThemeProvider.");
  }

  return context;
}