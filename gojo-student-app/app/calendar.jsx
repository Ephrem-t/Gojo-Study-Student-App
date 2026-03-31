import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Modal,
  Pressable,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get } from "firebase/database";
import { database } from "../constants/firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as EthiopianDate from "ethiopian-date";
import { useAppTheme } from "../hooks/use-app-theme";

const PRIMARY = "#2563EB";
const PRIMARY_DARK = "#1D4ED8";
const PRIMARY_SOFT = "#EFF6FF";
const BG = "#FFFFFF";
const CARD = "#FFFFFF";
const TEXT = "#0F172A";
const MUTED = "#64748B";
const BORDER = "#E2E8F0";

const CAT_COLORS = {
  academic: "#16A34A",
  class: "#DC2626",
  defaultClose: "#EAB308",
};

const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_AM = ["እሁድ", "ሰኞ", "ማክ", "ረቡዕ", "ሐሙስ", "አርብ", "ቅዳሜ"];

const ETH_MONTHS_EN = [
  "Meskerem",
  "Tikimt",
  "Hidar",
  "Tahsas",
  "Tir",
  "Yekatit",
  "Megabit",
  "Miazia",
  "Ginbot",
  "Sene",
  "Hamle",
  "Nehase",
  "Pagume",
];

const ETH_MONTHS_AM = [
  "መስከረም",
  "ጥቅምት",
  "ህዳር",
  "ታህሳስ",
  "ጥር",
  "የካቲት",
  "መጋቢት",
  "ሚያዝያ",
  "ግንቦት",
  "ሰኔ",
  "ሐምሌ",
  "ነሐሴ",
  "ጳጉሜ",
];

function pad(v) {
  return String(v).padStart(2, "0");
}

function toYMDFromParts(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function normalizeCategory(e) {
  const raw = String(e?.category || e?.type || e?.subType || "").trim().toLowerCase();
  if (raw.includes("academic")) return "academic";
  if (raw.includes("class")) return "class";
  return "class";
}

function safeToEthiopian(gYear, gMonth, gDay) {
  try {
    const eth = EthiopianDate.toEthiopian(gYear, gMonth, gDay);
    if (!eth) return null;

    if (Array.isArray(eth)) {
      return {
        year: Number(eth[0]),
        month: Number(eth[1]),
        day: Number(eth[2]),
      };
    }

    return {
      year: Number(eth.year),
      month: Number(eth.month),
      day: Number(eth.day),
    };
  } catch {
    return null;
  }
}

function safeToGregorian(eYear, eMonth, eDay) {
  try {
    const g = EthiopianDate.toGregorian(eYear, eMonth, eDay);
    if (!g) return null;

    if (Array.isArray(g)) {
      return {
        year: Number(g[0]),
        month: Number(g[1]),
        day: Number(g[2]),
      };
    }

    return {
      year: Number(g.year),
      month: Number(g.month),
      day: Number(g.day),
    };
  } catch {
    return null;
  }
}

function getTodayEthiopian() {
  const now = new Date();
  return (
    safeToEthiopian(now.getFullYear(), now.getMonth() + 1, now.getDate()) || {
      year: 2018,
      month: 1,
      day: 1,
    }
  );
}

function toGregorianYMDFromEth(year, month, day) {
  const g = safeToGregorian(year, month, day);
  if (!g) return null;
  return toYMDFromParts(g.year, g.month, g.day);
}

function getGregorianDateFromEth(year, month, day) {
  const g = safeToGregorian(year, month, day);
  if (!g) return null;
  return new Date(g.year, g.month - 1, g.day);
}

function getEthMonthName(month, amharic = false) {
  return (amharic ? ETH_MONTHS_AM : ETH_MONTHS_EN)[month - 1] || "";
}

function formatEthDate(eth, amharic = false) {
  if (!eth) return "N/A";
  return `${getEthMonthName(eth.month, amharic)} ${eth.day}, ${eth.year}`;
}

function getDaysInEthMonth(year, month) {
  if (month >= 1 && month <= 12) return 30;
  const nextGreg = safeToGregorian(year + 1, 1, 1);
  if (!nextGreg) return 5;
  const leap = nextGreg.year % 4 === 0;
  return leap ? 6 : 5;
}

function getEthWeekday(year, month, day) {
  const g = getGregorianDateFromEth(year, month, day);
  return g ? g.getDay() : 0;
}

function buildEthMonthGrid(year, month) {
  const startWeekday = getEthWeekday(year, month, 1);
  const daysInMonth = getDaysInEthMonth(year, month);

  const prevMonth = month === 1 ? 13 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonthDays = getDaysInEthMonth(prevYear, prevMonth);

  const cells = [];
  for (let i = 0; i < startWeekday; i++) {
    const day = prevMonthDays - startWeekday + i + 1;
    cells.push({
      ethYear: prevYear,
      ethMonth: prevMonth,
      ethDay: day,
      gregorianDate: null,
      isOutsideMonth: true,
    });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({
      ethYear: year,
      ethMonth: month,
      ethDay: day,
      gregorianDate: toGregorianYMDFromEth(year, month, day),
      isOutsideMonth: false,
    });
  }

  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    const nextMonth = month === 13 ? 1 : month + 1;
    const nextYear = month === 13 ? year + 1 : year;
    cells.push({
      ethYear: nextYear,
      ethMonth: nextMonth,
      ethDay: nextDay,
      gregorianDate: null,
      isOutsideMonth: true,
    });
    nextDay += 1;
  }
  return cells;
}

function getLabelMap(am, schoolName = "") {
  const cleanSchoolName = String(schoolName || "").trim();
  const dynamicTitleEn = cleanSchoolName ? `${cleanSchoolName} Calendar` : "Your School Calendar";
  const dynamicTitleAm = cleanSchoolName
    ? `${cleanSchoolName} የትምህርት ቀን መቁጠሪያ`
    : "የእርስዎ ትምህርት ቤት ቀን መቁጠሪያ";

  return {
    title: am ? dynamicTitleAm : dynamicTitleEn,
    sub: am
      ? "የክፍል እና አካዳሚክ ዝግጅቶችን በኢትዮጵያ ቀን መቁጠሪያ ይመልከቱ"
      : "Browse class and academic events in Ethiopian calendar view",
    today: am ? "ዛሬ" : "Today",
    selectedDayTitle: am ? "የቀኑ ዝርዝር" : "Day Details",
    todayEvents: am ? "የዛሬ ዝርዝር" : "Today's Details",
    noEventsDay: am ? "በዚህ ቀን ምንም ዝግጅት የለም።" : "No events for this date.",
    upcomingDeadline: am ? "የሚመጡ የመጨረሻ ቀኖች" : "Upcoming Deadline",
    noUpcomingDeadline: am ? "የሚመጡ የመጨረሻ ቀኖች የሉም።" : "No upcoming deadlines.",
    gregorian: am ? "ግሪጎሪያን" : "Gregorian",
    ethiopian: am ? "ኢትዮጵያዊ" : "Ethiopian",
    description: am ? "ማብራሪያ" : "Description",
    noDescription: am ? "ማብራሪያ አልተገለጸም።" : "No description provided.",
    lang: am ? "AM" : "EN",
    month: am ? "ወር" : "Month",
    year: am ? "ዓመት" : "Year",
    category: {
      academic: am ? "አካዳሚክ" : "Academic",
      class: am ? "ክፍል" : "Class",
      defaultClose: am ? "መደበኛ የዝግ ቀን" : "Default Closed Day",
    },
  };
}

function getDefaultClosureDefs(amharic = false) {
  return [
    {
      month: 1,
      day: 1,
      title: amharic ? "እንቁጣጣሽ" : "Enkutatash",
      notes: amharic ? "የኢትዮጵያ አዲስ ዓመት - የትምህርት ዝግ ቀን" : "Ethiopian New Year - School closed day",
    },
    {
      month: 1,
      day: 17,
      title: amharic ? "መስቀል" : "Meskel",
      notes: amharic ? "የመስቀል በዓል - የትምህርት ዝግ ቀን" : "Meskel - School closed day",
    },
    {
      month: 4,
      day: 29,
      title: amharic ? "ገና" : "Genna",
      notes: amharic ? "የገና በዓል - የትምህርት ዝግ ቀን" : "Genna - School closed day",
    },
    {
      month: 5,
      day: 11,
      title: amharic ? "ጥምቀት" : "Timket",
      notes: amharic ? "የጥምቀት በዓል - የትምህርት ዝግ ቀን" : "Timket - School closed day",
    },
    {
      month: 6,
      day: 23,
      title: amharic ? "የአድዋ ድል ቀን" : "Adwa Victory Day",
      notes: amharic ? "የአድዋ ድል ቀን - የትምህርት ዝግ ቀን" : "Adwa Victory Day - School closed day",
    },
    {
      month: 8,
      day: 23,
      title: amharic ? "የሠራተኞች ቀን" : "Labour Day",
      notes: amharic ? "የሠራተኞች ቀን - የትምህርት ዝግ ቀን" : "Labour Day - School closed day",
    },
    {
      month: 9,
      day: 27,
      title: amharic ? "የአርበኞች ቀን" : "Patriots' Victory Day",
      notes: amharic ? "የአርበኞች ቀን - የትምህርት ዝግ ቀን" : "Patriots' Victory Day - School closed day",
    },
    {
      month: 9,
      day: 20,
      title: amharic ? "የደርግ ውድቀት ቀን" : "Downfall of the Derg",
      notes: amharic ? "የመታሰቢያ ቀን - የትምህርት ዝግ ቀን" : "Commemoration Day - School closed day",
    },
  ];
}

function buildDefaultClosureEvents(yearStart, yearEnd, amharic = false) {
  const defs = getDefaultClosureDefs(amharic);
  const out = [];

  for (let y = yearStart; y <= yearEnd; y++) {
    defs.forEach((d) => {
      const g = toGregorianYMDFromEth(y, d.month, d.day);
      if (!g) return;

      out.push({
        id: `default-closure-${y}-${d.month}-${d.day}`,
        title: d.title,
        notes: d.notes,
        ethiopianDate: { year: y, month: d.month, day: d.day },
        gregorianDate: g,
        category: "class",
        type: "class",
        _category: "class",
        _defaultClosure: true,
      });
    });
  }

  return out;
}

function getMovableClosureMap(amharic = false) {
  return {
    "2024-04-10": {
      title: amharic ? "ኢድ አልፊጥር" : "Eid al-Fitr",
      notes: amharic ? "የኢድ አልፊጥር በዓል - የትምህርት ዝግ ቀን" : "Eid al-Fitr - School closed day",
    },
    "2024-05-03": {
      title: amharic ? "ስቅለት" : "Good Friday",
      notes: amharic ? "የስቅለት በዓል - የትምህርት ዝግ ቀን" : "Good Friday - School closed day",
    },
    "2024-05-05": {
      title: amharic ? "ፋሲካ" : "Fasika / Easter",
      notes: amharic ? "የፋሲካ በዓል - የትምህርት ዝግ ቀን" : "Fasika / Easter - School closed day",
    },
    "2024-06-16": {
      title: amharic ? "ኢድ አልአድሃ" : "Eid al-Adha",
      notes: amharic ? "የኢድ አልአድሃ በዓል - የትምህርት ዝግ ቀን" : "Eid al-Adha - School closed day",
    },
    "2025-03-30": {
      title: amharic ? "ኢድ አልፊጥር" : "Eid al-Fitr",
      notes: amharic ? "የኢድ አልፊጥር በዓል - የትምህርት ዝግ ቀን" : "Eid al-Fitr - School closed day",
    },
    "2025-04-18": {
      title: amharic ? "ስቅለት" : "Good Friday",
      notes: amharic ? "የስቅለት በዓል - የትምህርት ዝግ ቀን" : "Good Friday - School closed day",
    },
    "2025-04-20": {
      title: amharic ? "ፋሲካ" : "Fasika / Easter",
      notes: amharic ? "የፋሲካ በዓል - የትምህርት ዝግ ቀን" : "Fasika / Easter - School closed day",
    },
    "2025-06-06": {
      title: amharic ? "ኢድ አልአድሃ" : "Eid al-Adha",
      notes: amharic ? "የኢድ አልአድሃ በዓል - የትምህርት ዝግ ቀን" : "Eid al-Adha - School closed day",
    },
    "2026-03-20": {
      title: amharic ? "ኢድ አልፊጥር" : "Eid al-Fitr",
      notes: amharic ? "የኢድ አልፊጥር በዓል - የትምህርት ዝግ ቀን" : "Eid al-Fitr - School closed day",
    },
    "2026-04-10": {
      title: amharic ? "ስቅለት" : "Good Friday",
      notes: amharic ? "የስቅለት በዓል - የትምህርት ዝግ ቀን" : "Good Friday - School closed day",
    },
    "2026-04-12": {
      title: amharic ? "ፋሲካ" : "Fasika / Easter",
      notes: amharic ? "የፋሲካ በዓል - የትምህርት ዝግ ቀን" : "Fasika / Easter - School closed day",
    },
    "2026-05-27": {
      title: amharic ? "ኢድ አልአድሃ" : "Eid al-Adha",
      notes: amharic ? "የኢድ አልአድሃ በዓል - የትምህርት ዝግ ቀን" : "Eid al-Adha - School closed day",
    },
    "2027-03-10": {
      title: amharic ? "ኢድ አልፊጥር" : "Eid al-Fitr",
      notes: amharic ? "የኢድ አልፊጥር በዓል - የትምህርት ዝግ ቀን" : "Eid al-Fitr - School closed day",
    },
    "2027-04-30": {
      title: amharic ? "ስቅለት" : "Good Friday",
      notes: amharic ? "የስቅለት በዓል - የትምህርት ዝግ ቀን" : "Good Friday - School closed day",
    },
    "2027-05-02": {
      title: amharic ? "ፋሲካ" : "Fasika / Easter",
      notes: amharic ? "የፋሲካ በዓል - የትምህርት ዝግ ቀን" : "Fasika / Easter - School closed day",
    },
    "2027-05-17": {
      title: amharic ? "ኢድ አልአድሃ" : "Eid al-Adha",
      notes: amharic ? "የኢድ አልአድሃ በዓል - የትምህርት ዝግ ቀን" : "Eid al-Adha - School closed day",
    },
    "2028-02-27": {
      title: amharic ? "ኢድ አልፊጥር" : "Eid al-Fitr",
      notes: amharic ? "የኢድ አልፊጥር በዓል - የትምህርት ዝግ ቀን" : "Eid al-Fitr - School closed day",
    },
    "2028-04-14": {
      title: amharic ? "ስቅለት" : "Good Friday",
      notes: amharic ? "የስቅለት በዓል - የትምህርት ዝግ ቀን" : "Good Friday - School closed day",
    },
    "2028-04-16": {
      title: amharic ? "ፋሲካ" : "Fasika / Easter",
      notes: amharic ? "የፋሲካ በዓል - የትምህርት ዝግ ቀን" : "Fasika / Easter - School closed day",
    },
    "2028-05-05": {
      title: amharic ? "ኢድ አልአድሃ" : "Eid al-Adha",
      notes: amharic ? "የኢድ አልአድሃ በዓል - የትምህርት ዝግ ቀን" : "Eid al-Adha - School closed day",
    },
    "2029-02-14": {
      title: amharic ? "ኢድ አልፊጥር" : "Eid al-Fitr",
      notes: amharic ? "የኢድ አልፊጥር በዓል - የትምህርት ዝግ ቀን" : "Eid al-Fitr - School closed day",
    },
    "2029-04-06": {
      title: amharic ? "ስቅለት" : "Good Friday",
      notes: amharic ? "የስቅለት በዓል - የትምህርት ዝግ ቀን" : "Good Friday - School closed day",
    },
    "2029-04-08": {
      title: amharic ? "ፋሲካ" : "Fasika / Easter",
      notes: amharic ? "የፋሲካ በዓል - የትምህርት ዝግ ቀን" : "Fasika / Easter - School closed day",
    },
    "2029-04-24": {
      title: amharic ? "ኢድ አልአድሃ" : "Eid al-Adha",
      notes: amharic ? "የኢድ አልአድሃ በዓል - የትምህርት ዝግ ቀን" : "Eid al-Adha - School closed day",
    },
    "2030-02-03": {
      title: amharic ? "ኢድ አልፊጥር" : "Eid al-Fitr",
      notes: amharic ? "የኢድ አልፊጥር በዓል - የትምህርት ዝግ ቀን" : "Eid al-Fitr - School closed day",
    },
    "2030-04-13": {
      title: amharic ? "ኢድ አልአድሃ" : "Eid al-Adha",
      notes: amharic ? "የኢድ አልአድሃ በዓል - የትምህርት ዝግ ቀን" : "Eid al-Adha - School closed day",
    },
    "2030-04-26": {
      title: amharic ? "ስቅለት" : "Good Friday",
      notes: amharic ? "የስቅለት በዓል - የትምህርት ዝግ ቀን" : "Good Friday - School closed day",
    },
    "2030-04-28": {
      title: amharic ? "ፋሲካ" : "Fasika / Easter",
      notes: amharic ? "የፋሲካ በዓል - የትምህርት ዝግ ቀን" : "Fasika / Easter - School closed day",
    },
    "2031-01-24": {
      title: amharic ? "ኢድ አልፊጥር" : "Eid al-Fitr",
      notes: amharic ? "የኢድ አልፊጥር በዓል - የትምህርት ዝግ ቀን" : "Eid al-Fitr - School closed day",
    },
    "2031-04-02": {
      title: amharic ? "ኢድ አልአድሃ" : "Eid al-Adha",
      notes: amharic ? "የኢድ አልአድሃ በዓል - የትምህርት ዝግ ቀን" : "Eid al-Adha - School closed day",
    },
    "2031-04-11": {
      title: amharic ? "ስቅለት" : "Good Friday",
      notes: amharic ? "የስቅለት በዓል - የትምህርት ዝግ ቀን" : "Good Friday - School closed day",
    },
    "2031-04-13": {
      title: amharic ? "ፋሲካ" : "Fasika / Easter",
      notes: amharic ? "የፋሲካ በዓል - የትምህርት ዝግ ቀን" : "Fasika / Easter - School closed day",
    },
    "2032-01-13": {
      title: amharic ? "ኢድ አልፊጥር" : "Eid al-Fitr",
      notes: amharic ? "የኢድ አልፊጥር በዓል - የትምህርት ዝግ ቀን" : "Eid al-Fitr - School closed day",
    },
    "2032-03-22": {
      title: amharic ? "ኢድ አልአድሃ" : "Eid al-Adha",
      notes: amharic ? "የኢድ አልአድሃ በዓል - የትምህርት ዝግ ቀን" : "Eid al-Adha - School closed day",
    },
    "2032-04-30": {
      title: amharic ? "ስቅለት" : "Good Friday",
      notes: amharic ? "የስቅለት በዓል - የትምህርት ዝግ ቀን" : "Good Friday - School closed day",
    },
    "2032-05-02": {
      title: amharic ? "ፋሲካ" : "Fasika / Easter",
      notes: amharic ? "የፋሲካ በዓል - የትምህርት ዝግ ቀን" : "Fasika / Easter - School closed day",
    },
  };
}

function buildMovableClosureEvents(yearStart, yearEnd, amharic = false) {
  const map = getMovableClosureMap(amharic);
  const out = [];

  Object.entries(map).forEach(([gregorianDate, info]) => {
    const [gy] = gregorianDate.split("-").map(Number);
    if (!Number.isFinite(gy) || gy < yearStart || gy > yearEnd) return;

    const [year, month, day] = gregorianDate.split("-").map(Number);
    const eth = safeToEthiopian(year, month, day);
    const titleText = String(info.title || "");
    const isEid = /eid/i.test(titleText);
    const moonNote = amharic
      ? " (ቀኑ በአካባቢያዊ የጨረቃ እይታ መሠረት ሊለያይ ይችላል)"
      : " (Date may vary by local moon sighting)";
    const noteText = String(info.notes || "");
    const notes = isEid && !noteText.includes("moon") && !noteText.includes("ጨረቃ")
      ? `${noteText}${moonNote}`
      : noteText;

    out.push({
      id: `default-movable-${gregorianDate}-${String(info.title).toLowerCase().replace(/\s+/g, "-")}`,
      title: info.title,
      notes,
      ethiopianDate: eth,
      gregorianDate,
      category: "class",
      type: "class",
      _category: "class",
      _defaultClosure: true,
      _movableClosure: true,
    });
  });

  return out;
}

export default function CalendarTab() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const todayEth = getTodayEthiopian();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [events, setEvents] = useState([]);
  const [schoolName, setSchoolName] = useState("");

  const [ethYear, setEthYear] = useState(todayEth.year);
  const [ethMonth, setEthMonth] = useState(todayEth.month);
  const [selectedEthDay, setSelectedEthDay] = useState(todayEth.day);
  const [todayOnly, setTodayOnly] = useState(false);
  const [amharic, setAmharic] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(todayEth.month);
  const [pickerYear, setPickerYear] = useState(todayEth.year);

  const labels = getLabelMap(amharic, schoolName);
  const scrollRef = useRef(null);
  const detailsYRef = useRef(0);

  const resolveSchoolKeyForCalendar = async () => {
    const schoolNodeExists = async (key) => {
      if (!key) return false;
      const [rootSnap, p1Snap] = await Promise.all([
        get(ref(database, `Schools/${key}`)).catch(() => null),
        get(ref(database, `Platform1/Schools/${key}`)).catch(() => null),
      ]);
      return !!(rootSnap?.exists() || p1Snap?.exists());
    };

    const resolveBySchoolCodeIndex = async (code) => {
      if (!code) return null;

      const [rootIdxSnap, p1IdxSnap] = await Promise.all([
        get(ref(database, `schoolCodeIndex/${code}`)).catch(() => null),
        get(ref(database, `Platform1/schoolCodeIndex/${code}`)).catch(() => null),
      ]);

      const candidates = [rootIdxSnap?.val(), p1IdxSnap?.val(), code]
        .filter(Boolean)
        .map((v) => String(v));

      for (const candidate of candidates) {
        if (await schoolNodeExists(candidate)) return candidate;
      }

      return null;
    };

    const fromStorage = [
      (await AsyncStorage.getItem("schoolKey")) || null,
      (await AsyncStorage.getItem("schoolCode")) || null,
    ].filter(Boolean);

    for (const candidate of fromStorage) {
      if (await schoolNodeExists(candidate)) return candidate;

      const resolvedFromCode = await resolveBySchoolCodeIndex(candidate);
      if (resolvedFromCode) return resolvedFromCode;
    }

    const userNodeKey =
      (await AsyncStorage.getItem("userNodeKey")) ||
      (await AsyncStorage.getItem("studentNodeKey")) ||
      (await AsyncStorage.getItem("userId")) ||
      (await AsyncStorage.getItem("studentId")) ||
      null;

    if (userNodeKey) {
      const userPaths = [
        `Users/${userNodeKey}`,
        `Students/${userNodeKey}`,
        `Platform1/Users/${userNodeKey}`,
        `Platform1/Students/${userNodeKey}`,
      ];

      for (const p of userPaths) {
        const snap = await get(ref(database, p));
        if (!snap.exists()) continue;
        const val = snap.val() || {};
        const schoolCode = String(val.schoolCode || "").trim();
        if (!schoolCode) continue;

        const resolvedFromCode = await resolveBySchoolCodeIndex(schoolCode);
        if (resolvedFromCode) return resolvedFromCode;
      }
    }

    const [schoolsRootSnap, schoolsP1Snap] = await Promise.all([
      get(ref(database, "Schools")).catch(() => null),
      get(ref(database, "Platform1/Schools")).catch(() => null),
    ]);

    const pickFromSchoolsSnap = (schoolsSnap) => {
      if (!schoolsSnap?.exists()) return null;

      let fallbackKey = null;
      schoolsSnap.forEach((child) => {
        if (fallbackKey) return true;
        const hasCalendarEvents = !!child.child("CalendarEvents")?.exists();
        if (hasCalendarEvents) {
          fallbackKey = child.key;
          return true;
        }
        return false;
      });

      if (fallbackKey) return fallbackKey;

      let firstKey = null;
      schoolsSnap.forEach((child) => {
        if (firstKey) return true;
        firstKey = child.key;
        return true;
      });

      return firstKey;
    };

    return pickFromSchoolsSnap(schoolsRootSnap) || pickFromSchoolsSnap(schoolsP1Snap) || null;
  };

  const fetchCalendarEvents = async () => {
    try {
      const schoolKey = await resolveSchoolKeyForCalendar();
      let resolvedSchoolName = "";

      if (schoolKey) {
        const schoolPaths = [
          `Schools/${schoolKey}`,
          `Platform1/Schools/${schoolKey}`,
        ];

        for (const path of schoolPaths) {
          const schoolSnap = await get(ref(database, path)).catch(() => null);
          if (!schoolSnap?.exists()) continue;

          const schoolVal = schoolSnap.val() || {};
          const schoolInfo = schoolVal.schoolInfo || {};
          const candidateName = [
            schoolInfo.name,
            schoolInfo.schoolName,
            schoolVal.schoolName,
            schoolVal.name,
            schoolVal.SchoolName,
            schoolVal.title,
            schoolVal.school,
          ]
            .map((v) => String(v || "").trim())
            .find((v) => v.length > 0);

          if (candidateName) {
            resolvedSchoolName = candidateName;
            break;
          }
        }
      }

      if (schoolKey) {
        try {
          await AsyncStorage.setItem("schoolKey", schoolKey);
        } catch {}
      }

      const candidatePaths = schoolKey
        ? [
            `Schools/${schoolKey}/CalendarEvents`,
            `Platform1/Schools/${schoolKey}/CalendarEvents`,
            "CalendarEvents",
          ]
        : ["CalendarEvents"];

      let snap = null;
      for (const path of candidatePaths) {
        const s = await get(ref(database, path));
        if (s.exists()) {
          snap = s;
          break;
        }
      }

      if (!snap) return { events: [], schoolName: resolvedSchoolName };

      const arr = [];
      snap.forEach((child) => {
        const val = child.val() || {};
        const rawGregorian = String(val.gregorianDate || "").trim();
        let gregorianDate = rawGregorian
          ? (rawGregorian.includes("T") ? rawGregorian.slice(0, 10) : rawGregorian)
          : null;

        let ethiopianDate = val.ethiopianDate || null;
        if (ethiopianDate && typeof ethiopianDate === "object") {
          const eYear = Number(ethiopianDate.year);
          const eMonth = Number(ethiopianDate.month);
          const eDay = Number(ethiopianDate.day);

          if (Number.isFinite(eYear) && Number.isFinite(eMonth) && Number.isFinite(eDay)) {
            ethiopianDate = { year: eYear, month: eMonth, day: eDay };
          }
        }

        // Canonical day mapping: when Ethiopian date exists, derive Gregorian from it.
        // This prevents mismatch when stored gregorianDate is missing or off by one day.
        if (
          ethiopianDate &&
          Number.isFinite(Number(ethiopianDate.year)) &&
          Number.isFinite(Number(ethiopianDate.month)) &&
          Number.isFinite(Number(ethiopianDate.day))
        ) {
          const derivedGregorian = toGregorianYMDFromEth(
            Number(ethiopianDate.year),
            Number(ethiopianDate.month),
            Number(ethiopianDate.day)
          );
          if (derivedGregorian) gregorianDate = derivedGregorian;
        }

        if (
          !ethiopianDate &&
          gregorianDate &&
          /^\d{4}-\d{2}-\d{2}$/.test(gregorianDate)
        ) {
          const [gy, gm, gd] = gregorianDate.split("-").map(Number);
          ethiopianDate = safeToEthiopian(gy, gm, gd);
        }

        const normalized = normalizeCategory(val);
        arr.push({
          id: child.key,
          ...val,
          gregorianDate,
          ethiopianDate,
          _category: normalized,
        });
      });

      const filtered = arr.filter((e) => e._category === "academic" || e._category === "class");

      filtered.sort((a, b) => new Date(a.gregorianDate || 0) - new Date(b.gregorianDate || 0));
      return { events: filtered, schoolName: resolvedSchoolName };
    } catch (e) {
      console.warn("Calendar events load error:", e);
      return { events: [], schoolName: "" };
    }
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      const result = await fetchCalendarEvents();
      if (mounted) {
        setEvents(result.events || []);
        if (result.schoolName) setSchoolName(result.schoolName);
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    const result = await fetchCalendarEvents();
    setEvents(result.events || []);
    if (result.schoolName) setSchoolName(result.schoolName);
    setRefreshing(false);
  };

  const monthCells = useMemo(() => buildEthMonthGrid(ethYear, ethMonth), [ethYear, ethMonth]);
  const pickerYears = useMemo(
    () => Array.from({ length: 9 }, (_, i) => todayEth.year - 4 + i),
    [todayEth.year]
  );

  const defaultClosureEvents = useMemo(() => {
    const nowGregorianYear = new Date().getFullYear();
    const gregorianYearStart = nowGregorianYear - 3;
    const gregorianYearEnd = nowGregorianYear + 3;
    const ethiopianYearStart = todayEth.year - 3;
    const ethiopianYearEnd = todayEth.year + 3;

    return [
      ...buildDefaultClosureEvents(ethiopianYearStart, ethiopianYearEnd, amharic),
      ...buildMovableClosureEvents(gregorianYearStart, gregorianYearEnd, amharic),
    ];
  }, [todayEth.year, amharic]);

  const mergedEvents = useMemo(() => {
    const keys = new Set();
    const merged = [];

    [...events, ...defaultClosureEvents].forEach((e) => {
      const key = `${e.gregorianDate || ""}|${String(e.title || "").trim().toLowerCase()}`;
      if (keys.has(key)) return;
      keys.add(key);
      merged.push(e);
    });

    merged.sort((a, b) => new Date(a.gregorianDate || 0) - new Date(b.gregorianDate || 0));
    return merged;
  }, [events, defaultClosureEvents]);

  const eventsByDate = useMemo(() => {
    const map = {};
    mergedEvents.forEach((e) => {
      const key = e.gregorianDate;
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(e);
    });
    return map;
  }, [mergedEvents]);

  const selectedGregorianDate = todayOnly
    ? toGregorianYMDFromEth(todayEth.year, todayEth.month, todayEth.day)
    : toGregorianYMDFromEth(ethYear, ethMonth, selectedEthDay);

  const selectedEvents = useMemo(() => {
    return selectedGregorianDate ? eventsByDate[selectedGregorianDate] || [] : [];
  }, [eventsByDate, selectedGregorianDate]);

  const upcomingDeadlines = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const list = events.filter((e) => {
      if (!e?.showInUpcomingDeadlines) return false;
      if (!e.gregorianDate) return false;
      const d = new Date(e.gregorianDate);
      d.setHours(0, 0, 0, 0);
      return d >= today;
    });

    if (todayOnly) {
      const todayKey = toGregorianYMDFromEth(todayEth.year, todayEth.month, todayEth.day);
      return list.filter((e) => e.gregorianDate === todayKey);
    }

    return list.slice(0, 12);
  }, [events, todayOnly, todayEth.year, todayEth.month, todayEth.day]);

  const prevMonth = () => {
    if (ethMonth === 1) {
      setEthMonth(13);
      setEthYear((y) => y - 1);
    } else {
      setEthMonth((m) => m - 1);
    }
    setTodayOnly(false);
    setSelectedEthDay(1);
  };

  const nextMonth = () => {
    if (ethMonth === 13) {
      setEthMonth(1);
      setEthYear((y) => y + 1);
    } else {
      setEthMonth((m) => m + 1);
    }
    setTodayOnly(false);
    setSelectedEthDay(1);
  };

  const dayDotColor = (gregorianDate) => {
    const dayEvents = eventsByDate[gregorianDate] || [];
    if (!dayEvents.length) return null;

    if (dayEvents.some((e) => e._defaultClosure)) return CAT_COLORS.defaultClose;
    if (dayEvents.some((e) => e._category === "academic")) return CAT_COLORS.academic;
    return CAT_COLORS.class;
  };

  const scrollToDetails = () => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          y: Math.max(0, detailsYRef.current - 12),
          animated: true,
        });
      }, 40);
    });
  };

  const monthTitle = `${getEthMonthName(ethMonth, amharic)} ${ethYear}`;
  const selectedEthDateObj = todayOnly
    ? todayEth
    : { year: ethYear, month: ethMonth, day: selectedEthDay };
  const isTodayHeaderActive =
    todayOnly ||
    (ethYear === todayEth.year && ethMonth === todayEth.month && selectedEthDay === todayEth.day);
  const openMonthYearPicker = () => {
    setPickerMonth(ethMonth);
    setPickerYear(ethYear);
    setPickerVisible(true);
  };

  const applyMonthYearPicker = () => {
    setEthMonth(pickerMonth);
    setEthYear(pickerYear);
    setTodayOnly(false);
    setSelectedEthDay(1);
    setPickerVisible(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingWrap} edges={["top"]}>
        <ActivityIndicator size="large" color={PRIMARY} />
        <Text style={styles.loadingText}>Loading calendar...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Modal
        visible={pickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerVisible(false)}
      >
        <View style={styles.pickerOverlay}>
          <TouchableOpacity
            style={styles.pickerBackdrop}
            activeOpacity={1}
            onPress={() => setPickerVisible(false)}
          />

          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{amharic ? "ወር እና ዓመት" : "Month & Year"}</Text>
              <TouchableOpacity onPress={() => setPickerVisible(false)} activeOpacity={0.86}>
                <Ionicons name="close" size={20} color={TEXT} />
              </TouchableOpacity>
            </View>

            <View style={styles.pickerPreviewCard}>
              <Text style={styles.pickerPreviewLabel}>{amharic ? "የተመረጠው" : "Selected"}</Text>
              <Text style={styles.pickerPreviewValue}>
                {getEthMonthName(pickerMonth, amharic)} {pickerYear}
              </Text>
            </View>

            <View style={styles.pickerColumns}>
              <View style={styles.pickerColumn}>
                <Text style={styles.pickerSectionLabel}>{labels.month}</Text>
                <ScrollView
                  style={styles.pickerList}
                  contentContainerStyle={styles.pickerListContent}
                  showsVerticalScrollIndicator={false}
                >
                  {Array.from({ length: 13 }, (_, i) => i + 1).map((month) => {
                    const active = pickerMonth === month;
                    return (
                      <TouchableOpacity
                        key={month}
                        style={[styles.pickerChip, active && styles.pickerChipActive]}
                        onPress={() => setPickerMonth(month)}
                        activeOpacity={0.86}
                      >
                        <Text style={[styles.pickerChipText, active && styles.pickerChipTextActive]}>
                          {getEthMonthName(month, amharic)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={styles.pickerColumn}>
                <Text style={styles.pickerSectionLabel}>{labels.year}</Text>
                <ScrollView
                  style={styles.pickerList}
                  contentContainerStyle={styles.pickerListContent}
                  showsVerticalScrollIndicator={false}
                >
                  {pickerYears.map((year) => {
                    const active = pickerYear === year;
                    return (
                      <TouchableOpacity
                        key={year}
                        style={[styles.pickerChip, styles.pickerYearChip, active && styles.pickerChipActive]}
                        onPress={() => setPickerYear(year)}
                        activeOpacity={0.86}
                      >
                        <Text style={[styles.pickerChipText, active && styles.pickerChipTextActive]}>
                          {year}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>

            <TouchableOpacity
              style={styles.pickerApplyBtn}
              onPress={applyMonthYearPicker}
              activeOpacity={0.88}
            >
              <Text style={styles.pickerApplyText}>{amharic ? "አሳይ" : "Apply"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={settingsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSettingsVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSettingsVisible(false)} />
        <View style={styles.bottomSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{amharic ? "የቀን መቁጠሪያ ቅንብሮች" : "Calendar Settings"}</Text>
          <Text style={styles.sheetSubtitle}>
            {amharic ? "የቀን መቁጠሪያውን እይታ እና እንቅስቃሴ ያስተካክሉ" : "Adjust calendar view and quick actions"}
          </Text>

          <TouchableOpacity
            style={styles.settingRowCard}
            activeOpacity={0.86}
            onPress={() => {
              setAmharic((v) => !v);
              setSettingsVisible(false);
            }}
          >
            <View style={styles.settingRowLeft}>
              <View style={styles.settingRowIconWrap}>
                <Ionicons name="language-outline" size={18} color={PRIMARY} />
              </View>
              <View style={styles.settingRowTextWrap}>
                <Text style={styles.settingRowTitle}>{amharic ? "ቋንቋ" : "Language"}</Text>
                <Text style={styles.settingRowSubtitle}>{amharic ? "አማርኛ / English መቀየር" : "Switch Amharic / English"}</Text>
              </View>
            </View>
            <Text style={styles.settingValuePill}>{labels.lang}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.settingRowCard}
            activeOpacity={0.86}
            onPress={() => {
              setTodayOnly(false);
              setEthYear(todayEth.year);
              setEthMonth(todayEth.month);
              setSelectedEthDay(todayEth.day);
              setSettingsVisible(false);
            }}
          >
            <View style={styles.settingRowLeft}>
              <View style={styles.settingRowIconWrap}>
                <Ionicons name="today-outline" size={18} color={PRIMARY} />
              </View>
              <View style={styles.settingRowTextWrap}>
                <Text style={styles.settingRowTitle}>{amharic ? "ወደ ዛሬ" : "Go to Today"}</Text>
                <Text style={styles.settingRowSubtitle}>{amharic ? "የዛሬን ቀን በፍጥነት ክፈት" : "Jump back to the current date"}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.settingRowCard}
            activeOpacity={0.86}
            onPress={() => {
              setSettingsVisible(false);
              openMonthYearPicker();
            }}
          >
            <View style={styles.settingRowLeft}>
              <View style={styles.settingRowIconWrap}>
                <Ionicons name="calendar-outline" size={18} color={PRIMARY} />
              </View>
              <View style={styles.settingRowTextWrap}>
                <Text style={styles.settingRowTitle}>{amharic ? "ወር እና ዓመት ምረጥ" : "Choose Month & Year"}</Text>
                <Text style={styles.settingRowSubtitle}>{amharic ? "ወደ ተፈለገው ጊዜ በፍጥነት ይሂዱ" : "Open the month and year picker"}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>
      </Modal>

      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.topBarBackBtn}
          activeOpacity={0.86}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/dashboard/home");
          }}
        >
          <Ionicons name="chevron-back" size={18} color={PRIMARY} />
        </TouchableOpacity>

        <View style={styles.topBarTitleWrap}>
          <Text style={styles.topBarTitle} numberOfLines={1}>{labels.title}</Text>
        </View>

        <View style={styles.topBarActions}>
          <TouchableOpacity
            style={styles.heroModePill}
            activeOpacity={0.86}
            onPress={() => setAmharic((v) => !v)}
          >
            <Ionicons name="sparkles-outline" size={13} color={PRIMARY} />
            <Text style={styles.heroModeText}>{labels.lang}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.heroSettingsBtn} activeOpacity={0.86} onPress={() => setSettingsVisible(true)}>
            <Ionicons name="options-outline" size={14} color={PRIMARY} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.fixedHeaderWrap}>
        <View style={styles.heroCard}>
          <View style={styles.heroTitleWrap}>
            <Text style={styles.heroSub} numberOfLines={2}>{labels.sub}</Text>
          </View>

          <View style={styles.heroMetaRow}>
            <View style={styles.heroMetaChip}>
              <Text style={styles.heroMetaLabel}>{labels.month}</Text>
              <Text style={styles.heroMetaValue}>{getEthMonthName(ethMonth, amharic)}</Text>
            </View>
            <View style={styles.heroMetaChip}>
              <Text style={styles.heroMetaLabel}>{labels.year}</Text>
              <Text style={styles.heroMetaValue}>{ethYear}</Text>
            </View>
            <TouchableOpacity
              style={[styles.heroMetaChip, isTodayHeaderActive && styles.heroMetaChipActive]}
              activeOpacity={0.86}
              onPress={() => {
                setTodayOnly(false);
                setEthYear(todayEth.year);
                setEthMonth(todayEth.month);
                setSelectedEthDay(todayEth.day);
              }}
            >
              <Text style={[styles.heroMetaLabel, isTodayHeaderActive && styles.heroMetaLabelActive]}>{labels.today}</Text>
              <Text style={[styles.heroMetaValue, isTodayHeaderActive && styles.heroMetaValueActive]}>{todayEth.day}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[PRIMARY]}
            tintColor={PRIMARY}
          />
        }
      >
        <View style={styles.cardWide}>
          <View style={styles.navRow}>
            <TouchableOpacity onPress={prevMonth} style={styles.navBtn} activeOpacity={0.86}>
              <Ionicons name="chevron-back" size={18} color={PRIMARY} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.monthTitleWrap}
              onPress={openMonthYearPicker}
              activeOpacity={0.86}
            >
              <Text style={styles.monthTitle}>{monthTitle}</Text>
              <Text style={styles.monthSub} numberOfLines={2}>
                {selectedGregorianDate
                  ? new Date(selectedGregorianDate).toLocaleDateString(amharic ? "am-ET" : undefined)
                  : ""}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={nextMonth} style={styles.navBtn} activeOpacity={0.86}>
              <Ionicons name="chevron-forward" size={18} color={PRIMARY} />
            </TouchableOpacity>
          </View>

          <View style={styles.legendWrap}>
            {["class", "academic", "defaultClose"].map((key) => (
              <View key={key} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: CAT_COLORS[key] }]} />
                <Text style={styles.legendText}>{labels.category[key]}</Text>
              </View>
            ))}
          </View>

          <View style={styles.weekRow}>
            {(amharic ? DAYS_AM : DAYS_EN).map((d) => (
              <View key={d} style={styles.weekCell}>
                <Text style={styles.weekText}>{d}</Text>
              </View>
            ))}
          </View>

          <View style={styles.gridWrap}>
            {monthCells.map((cell, idx) => {
              if (cell.isOutsideMonth) {
                return (
                  <View key={`outside-${idx}-${cell.ethDay}`} style={[styles.dayCell, styles.dayCellOutside]}>
                    <Text style={styles.dayTextOutside}>{cell.ethDay}</Text>
                  </View>
                );
              }

              const isSelected =
                !todayOnly &&
                cell.ethYear === ethYear &&
                cell.ethMonth === ethMonth &&
                cell.ethDay === selectedEthDay;

              const isToday =
                cell.ethYear === todayEth.year &&
                cell.ethMonth === todayEth.month &&
                cell.ethDay === todayEth.day;

              const dotColor = dayDotColor(cell.gregorianDate);

              return (
                <TouchableOpacity
                  key={`${cell.ethYear}-${cell.ethMonth}-${cell.ethDay}`}
                  style={[styles.dayCell, isSelected && styles.daySelected]}
                  onPress={() => {
                    setTodayOnly(false);
                    setSelectedEthDay(cell.ethDay);
                    scrollToDetails();
                  }}
                  activeOpacity={0.82}
                >
                  <Text
                    style={[
                      styles.dayText,
                      isSelected && styles.dayTextSelected,
                      isToday && !isSelected && styles.dayTodayText,
                    ]}
                  >
                    {cell.ethDay}
                  </Text>

                  <Text
                    style={[
                      styles.gregorianHint,
                      isSelected && styles.gregorianHintSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {cell.gregorianDate ? Number(cell.gregorianDate.slice(-2)) : ""}
                  </Text>

                  {dotColor ? (
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: isSelected ? "#fff" : dotColor },
                      ]}
                    />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View
          onLayout={(e) => {
            detailsYRef.current = e.nativeEvent.layout.y;
          }}
        />

        <View style={styles.cardWide}>
          <Text style={styles.cardTitleSmall}>
            {todayOnly ? labels.todayEvents : labels.selectedDayTitle}
          </Text>

          <View style={styles.selectedDateHeaderWrap}>
            <View style={styles.selectedDatePill}>
              <Text style={styles.selectedDatePillLabel}>{labels.ethiopian}</Text>
              <Text style={styles.selectedDatePillValue}>
                {formatEthDate(selectedEthDateObj, amharic)}
              </Text>
            </View>

            <View style={styles.selectedDatePill}>
              <Text style={styles.selectedDatePillLabel}>{labels.gregorian}</Text>
              <Text style={styles.selectedDatePillValue}>
                {selectedGregorianDate
                  ? new Date(selectedGregorianDate).toLocaleDateString(amharic ? "am-ET" : undefined)
                  : "N/A"}
              </Text>
            </View>
          </View>

          {selectedEvents.length === 0 ? (
            <Text style={styles.emptyText}>{labels.noEventsDay}</Text>
          ) : (
            selectedEvents.map((item) => {
              const cat = item._category || "general";
              const c = item._defaultClosure
                ? CAT_COLORS.defaultClose
                : (CAT_COLORS[cat] || CAT_COLORS.class);

              return (
                <View key={item.id} style={[styles.eventCard, { borderColor: `${c}55` }]}>
                  <View style={styles.eventTop}>
                    <Text style={styles.eventTitle}>{item.title || "Event"}</Text>
                    <View
                      style={[
                        styles.catBadge,
                        { backgroundColor: `${c}18`, borderColor: `${c}45` },
                      ]}
                    >
                      <Text style={[styles.catBadgeText, { color: c }]}>
                        {(labels.category[cat] || cat).toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  {item.notes?.trim() ? (
                    <Text style={styles.eventNoteCompact}>
                      {item.notes.trim()}
                    </Text>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        <View style={styles.cardWide}>
          <Text style={styles.cardTitleSmall}>
            {todayOnly ? labels.today : labels.upcomingDeadline}
          </Text>

          {upcomingDeadlines.length === 0 ? (
            <Text style={styles.emptyText}>{labels.noUpcomingDeadline}</Text>
          ) : (
            upcomingDeadlines.map((item) => {
              const cat = item._category || "general";
              const c = item._defaultClosure
                ? CAT_COLORS.defaultClose
                : (CAT_COLORS[cat] || CAT_COLORS.class);

              return (
                <View key={item.id} style={[styles.upcomingRow, { borderColor: `${c}55` }]}>
                  <View style={styles.upcomingContent}>
                    <Text style={styles.upcomingDate}>
                      {formatEthDate(item.ethiopianDate, amharic)}
                    </Text>
                    <Text style={styles.upcomingTitle}>{item.title || "Event"}</Text>
                    <Text style={styles.upcomingSub}>
                      {labels.gregorian}:{" "}
                      {item.gregorianDate
                        ? new Date(item.gregorianDate).toLocaleDateString(amharic ? "am-ET" : undefined)
                        : "N/A"}
                    </Text>
                  </View>
                  <Text style={[styles.upcomingType, { color: c }]}>
                    {labels.category[cat] || cat}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors) {
  const BG = colors.background;
  const CARD = colors.card;
  const TEXT = colors.text;
  const MUTED = colors.muted;
  const BORDER = colors.border;

  return StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  bottomSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: colors.border,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 10,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.border,
    marginBottom: 12,
  },
  sheetTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },
  sheetSubtitle: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "500",
    marginTop: 4,
    marginBottom: 14,
  },
  settingRowCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  settingRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    paddingRight: 12,
  },
  settingRowIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  settingRowTextWrap: {
    flex: 1,
  },
  settingRowTitle: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
  },
  settingRowSubtitle: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "500",
    marginTop: 2,
  },
  settingValuePill: {
    color: PRIMARY,
    fontSize: 11,
    fontWeight: "800",
    backgroundColor: colors.soft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  topBar: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topBarBackBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitleWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 10,
  },
  topBarTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "900",
  },
  topBarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fixedHeaderWrap: {
    paddingHorizontal: 10,
    paddingTop: 0,
  },
  content: {
    paddingHorizontal: 10,
    paddingTop: 0,
    paddingBottom: 28,
  },

  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: BG,
  },
  loadingText: {
    marginTop: 10,
    color: MUTED,
    fontSize: 14,
    fontWeight: "600",
  },

  heroCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
    marginBottom: 12,
  },
  heroTitleWrap: {
    marginBottom: 4,
  },
  heroTitle: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 16,
  },
  heroSub: {
    color: MUTED,
    fontSize: 11,
    marginTop: 3,
    fontWeight: "500",
    lineHeight: 16,
  },
  heroModePill: {
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroActionsWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  heroModeText: {
    marginLeft: 5,
    fontSize: 11,
    fontWeight: "800",
    color: PRIMARY,
  },
  heroSettingsBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroMetaRow: {
    flexDirection: "row",
    marginTop: 4,
    gap: 8,
  },
  heroMetaChip: {
    flex: 1,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  heroMetaChipActive: {
    backgroundColor: "#EAF3FF",
    borderColor: "#BFDBFE",
  },
  heroMetaLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  heroMetaLabelActive: {
    color: PRIMARY,
  },
  heroMetaValue: {
    marginTop: 3,
    color: TEXT,
    fontSize: 14,
    fontWeight: "800",
  },
  heroMetaValueActive: {
    color: PRIMARY_DARK,
  },

  cardWide: {
    backgroundColor: CARD,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 18,
    elevation: 2,
  },

  topActionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  softChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  softChipActive: {
    backgroundColor: PRIMARY,
  },
  softChipText: {
    color: PRIMARY,
    fontSize: 12,
    fontWeight: "800",
  },
  softChipTextActive: {
    color: "#fff",
  },

  navRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  monthTitleWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  monthTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: TEXT,
    textAlign: "center",
  },
  monthSub: {
    fontSize: 12,
    color: MUTED,
    marginTop: 2,
    fontWeight: "600",
    textAlign: "center",
  },
  pickerOverlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 18,
    backgroundColor: colors.overlay,
  },
  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  pickerSheet: {
    backgroundColor: colors.card,
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.1,
    shadowRadius: 28,
    elevation: 6,
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  pickerTitle: {
    flex: 1,
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
    paddingRight: 12,
  },
  pickerPreviewCard: {
    backgroundColor: colors.inputBackground,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 14,
  },
  pickerPreviewLabel: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  pickerPreviewValue: {
    marginTop: 4,
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },
  pickerColumns: {
    flexDirection: "row",
    gap: 12,
  },
  pickerColumn: {
    flex: 1,
  },
  pickerSectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  pickerList: {
    maxHeight: 250,
  },
  pickerListContent: {
    gap: 8,
    paddingBottom: 4,
  },
  pickerChip: {
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 11,
    justifyContent: "center",
  },
  pickerYearChip: {
    alignItems: "center",
  },
  pickerChipActive: {
    backgroundColor: "#EEF4FF",
    borderColor: "#AFCFFF",
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  pickerChipText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "700",
  },
  pickerChipTextActive: {
    color: PRIMARY,
    fontWeight: "800",
  },
  pickerApplyBtn: {
    marginTop: 16,
    backgroundColor: PRIMARY,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  pickerApplyText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: MUTED,
    marginBottom: 7,
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chipRow: {
    gap: 8,
    paddingBottom: 9,
    paddingRight: 6,
  },
  choiceChip: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  choiceChipActive: {
    backgroundColor: PRIMARY_SOFT,
    borderColor: "#BFDBFE",
  },
  choiceChipText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "700",
  },
  choiceChipTextActive: {
    color: PRIMARY,
  },

  legendWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 9,
    gap: 10,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendText: {
    fontSize: 12,
    color: MUTED,
    fontWeight: "600",
  },

  weekRow: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 4,
  },
  weekCell: {
    width: `${100 / 7}%`,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: 8,
  },
  weekText: {
    textAlign: "center",
    fontSize: 11,
    color: colors.muted,
    fontWeight: "800",
  },

  gridWrap: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    overflow: "hidden",
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 0,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingTop: 5,
    paddingBottom: 2,
    overflow: "hidden",
    backgroundColor: colors.card,
  },
  dayCellOutside: {
    backgroundColor: colors.inputBackground,
  },
  daySelected: {
    backgroundColor: "#EAF2FF",
  },
  dayText: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 15,
    lineHeight: 18,
  },
  dayTextSelected: {
    color: PRIMARY_DARK,
  },
  dayTextOutside: {
    color: colors.muted,
    fontWeight: "700",
    fontSize: 14,
  },
  dayTodayText: {
    color: PRIMARY,
    textDecorationLine: "underline",
  },
  gregorianHint: {
    color: MUTED,
    fontSize: 9,
    marginTop: 1,
    fontWeight: "700",
    lineHeight: 11,
    includeFontPadding: false,
  },
  gregorianHintSelected: {
    color: PRIMARY,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 3,
  },

  cardTitleSmall: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 8,
  },
  emptyText: {
    color: MUTED,
    fontSize: 13,
  },

  selectedDateHeaderWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  selectedDatePill: {
    minWidth: "48%",
    flexGrow: 1,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  selectedDatePillLabel: {
    fontSize: 10,
    color: MUTED,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  selectedDatePillValue: {
    marginTop: 3,
    fontSize: 12,
    color: TEXT,
    fontWeight: "800",
    lineHeight: 17,
    flexWrap: "wrap",
  },

  eventCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    backgroundColor: colors.card,
  },
  eventTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  eventTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: TEXT,
    flex: 1,
    paddingRight: 8,
  },
  builtInLabel: {
    marginTop: 6,
    color: "#16A34A",
    fontSize: 11,
    fontWeight: "800",
  },
  catBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  catBadgeText: {
    fontSize: 10,
    fontWeight: "800",
  },
  eventMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 9,
  },
  eventMetaPill: {
    minWidth: "48%",
    flexGrow: 1,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  eventMetaKey: {
    fontSize: 10,
    color: MUTED,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  eventMetaText: {
    marginTop: 2,
    fontSize: 12,
    color: TEXT,
    fontWeight: "700",
    lineHeight: 17,
  },
  infoRow: {
    flexDirection: "row",
    marginTop: 7,
  },
  infoLabel: {
    width: 90,
    fontSize: 12,
    color: MUTED,
    fontWeight: "700",
  },
  infoValue: {
    fontSize: 12,
    color: TEXT,
    fontWeight: "600",
    flex: 1,
    lineHeight: 18,
    flexWrap: "wrap",
  },
  descTitle: {
    marginTop: 9,
    fontSize: 12,
    color: MUTED,
    fontWeight: "700",
  },
  eventNote: {
    fontSize: 13,
    color: TEXT,
    marginTop: 4,
    lineHeight: 18,
  },
  eventNoteCompact: {
    marginTop: 8,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
  },

  upcomingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 10,
  },
  upcomingContent: {
    flex: 1,
  },
  upcomingDate: {
    fontSize: 12,
    color: MUTED,
    fontWeight: "700",
  },
  upcomingTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: TEXT,
    marginTop: 2,
  },
  upcomingSub: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
    lineHeight: 16,
  },
  upcomingType: {
    fontSize: 11,
    fontWeight: "800",
    paddingTop: 2,
  },
});
}