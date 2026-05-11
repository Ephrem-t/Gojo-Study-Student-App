const NOTE_COLOR_PRESETS = [
  { key: "sky", light: "#EEF4FF", dark: "#10203A" },
  { key: "amber", light: "#FFF4E8", dark: "#2B1A0B" },
  { key: "mint", light: "#ECFDF3", dark: "#10261F" },
  { key: "rose", light: "#FEF3F2", dark: "#33181C" },
  { key: "violet", light: "#F4F3FF", dark: "#241738" },
];

export const DEFAULT_NOTE_COLOR_KEY = NOTE_COLOR_PRESETS[0].key;

function isLightTheme(colors) {
  return colors?.background === "#fff";
}

function isHexColor(value) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || "").trim());
}

function findNoteColorPreset(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;

  return (
    NOTE_COLOR_PRESETS.find((option) =>
      [option.key, option.light.toLowerCase(), option.dark.toLowerCase()].includes(raw)
    ) || null
  );
}

function resolvePresetColor(option, colors) {
  return isLightTheme(colors) ? option.light : option.dark;
}

export function getNoteColorOptions(colors) {
  return NOTE_COLOR_PRESETS.map((option) => ({
    ...option,
    value: resolvePresetColor(option, colors),
  }));
}

export function normalizeNoteColorTag(value) {
  return findNoteColorPreset(value)?.key || DEFAULT_NOTE_COLOR_KEY;
}

export function resolveNoteColorTag(value, colors, fallback = null) {
  if (!value) return fallback;

  const preset = findNoteColorPreset(value);
  if (!preset) {
    return isHexColor(value) ? value : fallback;
  }

  return resolvePresetColor(preset, colors);
}