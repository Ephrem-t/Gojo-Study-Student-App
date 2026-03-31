/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
    screen: '#F6F8FC',
    card: '#FFFFFF',
    panel: '#FFFFFF',
    border: '#E4EAF5',
    muted: '#6B7894',
    primary: '#007AFB',
    soft: '#EEF5FF',
    surfaceMuted: '#F1F5F9',
    inputBackground: '#F8FAFC',
    tabBar: '#FFFFFF',
    tabInactive: '#6B7280',
    badgeBackground: '#F1F7FF',
    separator: '#EEF4FF',
    feedBackground: '#F0F2F5',
    incomingBubble: '#F6F7FB',
    incomingText: '#11181C',
    outgoingBubble: '#007AFB',
    outgoingText: '#FFFFFF',
    danger: '#F87171',
    success: '#12B76A',
    overlay: 'rgba(0,0,0,0.45)',
    imageOverlay: 'rgba(0,0,0,0.96)',
    white: '#FFFFFF',
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
    screen: '#0B1220',
    card: '#111827',
    panel: '#111827',
    border: '#22314F',
    muted: '#94A3B8',
    primary: '#4A8CFF',
    soft: '#12213D',
    surfaceMuted: '#162033',
    inputBackground: '#0F1A2C',
    tabBar: '#0F172A',
    tabInactive: '#7C8BA1',
    badgeBackground: '#16263F',
    separator: '#1E2C45',
    feedBackground: '#09111F',
    incomingBubble: '#162033',
    incomingText: '#ECEDEE',
    outgoingBubble: '#2D8CFF',
    outgoingText: '#FFFFFF',
    danger: '#F87171',
    success: '#34D399',
    overlay: 'rgba(0,0,0,0.6)',
    imageOverlay: 'rgba(2,6,23,0.97)',
    white: '#FFFFFF',
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
