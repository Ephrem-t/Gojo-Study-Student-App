import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, get } from "firebase/database";
import { database } from "../constants/firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import * as EthiopianDate from "ethiopian-date";

const PRIMARY = "#2563EB";
const PRIMARY_DARK = "#1D4ED8";
const PRIMARY_SOFT = "#EFF6FF";
const BG = "#FFFFFF";
const CARD = "#FFFFFF";
const TEXT = "#0F172A";
const MUTED = "#64748B";
const BORDER = "#E2E8F0";

const CAT_COLORS = {
  academic: "#2563EB",
  event: "#0EA5E9",
  exam: "#DC2626",
  holiday: "#16A34A",
  general: "#64748B",
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
  const raw = String(e?.category || e?.type || "general").toLowerCase();
  if (raw.includes("exam")) return "exam";
  if (raw.includes("academic")) return "academic";
  if (raw.includes("holiday")) return "holiday";
  if (raw.includes("event")) return "event";
  return "general";
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

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);

  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({
      ethYear: year,
      ethMonth: month,
      ethDay: day,
      gregorianDate: toGregorianYMDFromEth(year, month, day),
    });
  }

  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function getLabelMap(am) {
  return {
    title: am ? "የትምህርት ቤት የኢትዮጵያ ቀን መቁጠሪያ" : "School Calendar",
    sub: am
      ? "ዝግጅቶችን፣ በዓላትን እና የዝግ ቀናትን በኢትዮጵያ ቀን መቁጠሪያ ይመልከቱ"
      : "Browse events, holidays, and closed days in Ethiopian calendar view",
    today: am ? "ዛሬ" : "Today",
    selectedDayTitle: am ? "የቀኑ ዝርዝር" : "Day Details",
    todayEvents: am ? "የዛሬ ዝርዝር" : "Today's Details",
    noEventsDay: am ? "በዚህ ቀን ምንም ዝግጅት የለም።" : "No events for this date.",
    upcoming: am ? "የሚመጡ ዝግጅቶች" : "Upcoming Events",
    noUpcoming: am ? "የሚመጡ ዝግጅቶች የሉም።" : "No upcoming events.",
    gregorian: am ? "ግሪጎሪያን" : "Gregorian",
    ethiopian: am ? "ኢትዮጵያዊ" : "Ethiopian",
    description: am ? "ማብራሪያ" : "Description",
    noDescription: am ? "ማብራሪያ አልተገለጸም።" : "No description provided.",
    builtInHoliday: am ? "ብሔራዊ የዝግ ቀን" : "National Closed Day",
    lang: am ? "AM" : "EN",
    month: am ? "ወር" : "Month",
    year: am ? "ዓመት" : "Year",
    category: {
      academic: am ? "አካዳሚክ" : "Academic",
      event: am ? "ክስተት" : "Event",
      exam: am ? "ፈተና" : "Exam",
      holiday: am ? "በዓል" : "Holiday",
      general: am ? "አጠቃላይ" : "General",
    },
  };
}

function getBuiltInHolidayDefinitions(amharic) {
  return [
    {
      month: 1,
      day: 1,
      title: amharic ? "እንቁጣጣሽ" : "Enkutatash",
      notes: amharic ? "የኢትዮጵያ አዲስ ዓመት።" : "Ethiopian New Year.",
    },
    {
      month: 1,
      day: 17,
      title: amharic ? "መስቀል" : "Meskel",
      notes: amharic ? "የመስቀል በዓል።" : "Finding of the True Cross.",
    },
    {
      month: 4,
      day: 29,
      title: amharic ? "ገና" : "Genna",
      notes: amharic ? "የገና በዓል።" : "Ethiopian Christmas.",
    },
    {
      month: 5,
      day: 11,
      title: amharic ? "ጥምቀት" : "Timket",
      notes: amharic ? "የጥምቀት በዓል።" : "Epiphany / Timket.",
    },
    {
      month: 6,
      day: 23,
      title: amharic ? "የአድዋ ድል ቀን" : "Adwa Victory Day",
      notes: amharic ? "የአድዋ ድል መታሰቢያ።" : "Commemoration of the Battle of Adwa.",
    },
    {
      month: 8,
      day: 23,
      title: amharic ? "የሠራተኞች ቀን" : "Labour Day",
      notes: amharic ? "የሠራተኞች ቀን።" : "International Labour Day.",
    },
    {
      month: 8,
      day: 27,
      title: amharic ? "የአርበኞች ቀን" : "Patriots' Victory Day",
      notes: amharic ? "የአርበኞች ድል ቀን።" : "Patriots' Victory Day.",
    },
    {
      month: 9,
      day: 20,
      title: amharic ? "የደርግ ውድቀት ቀን" : "Downfall of the Derg",
      notes: amharic ? "ግንቦት 20 መታሰቢያ።" : "National commemoration day.",
    },
  ];
}

function getMovableHolidayMap(amharic) {
  return {
    "2026-03-20": {
      title: amharic ? "ኢድ አልፊጥር" : "Eid al-Fitr",
      notes: amharic
        ? "የሙስሊም በዓል፣ ኦፊሴላዊ የዝግ ቀን።"
        : "Muslim celebration and official public holiday.",
    },
    "2026-04-10": {
      title: amharic ? "ስቅለት" : "Good Friday",
      notes: amharic
        ? "የኦርቶዶክስ የስቅለት በዓል።"
        : "Orthodox Good Friday observance.",
    },
    "2026-04-12": {
      title: amharic ? "ፋሲካ" : "Fasika / Easter",
      notes: amharic
        ? "የኦርቶዶክስ ፋሲካ በዓል።"
        : "Orthodox Easter celebration.",
    },
    "2026-06-28": {
      title: amharic ? "ኢድ አልአድሃ" : "Eid al-Adha",
      notes: amharic
        ? "የሙስሊም በዓል፣ ኦፊሴላዊ የዝግ ቀን።"
        : "Muslim celebration and official public holiday.",
    },
  };
}

function buildBuiltInHolidayEventsForMonth(ethYear, ethMonth, amharic) {
  const fixed = getBuiltInHolidayDefinitions(amharic)
    .filter((h) => Number(h.month) === Number(ethMonth))
    .map((h) => ({
      id: `builtin-fixed-${ethYear}-${h.month}-${h.day}-${h.title}`,
      title: h.title,
      notes: h.notes,
      gregorianDate: toGregorianYMDFromEth(ethYear, h.month, h.day),
      ethiopianDate: {
        year: ethYear,
        month: h.month,
        day: h.day,
      },
      category: "holiday",
      type: "holiday",
      _category: "holiday",
      _builtIn: true,
    }));

  const movable = [];
  const movableMap = getMovableHolidayMap(amharic);

  Object.entries(movableMap).forEach(([gregorianDate, info]) => {
    const [gy, gm, gd] = gregorianDate.split("-").map(Number);
    const eth = safeToEthiopian(gy, gm, gd);

    if (
      eth &&
      Number(eth.year) === Number(ethYear) &&
      Number(eth.month) === Number(ethMonth)
    ) {
      movable.push({
        id: `builtin-movable-${gregorianDate}-${info.title}`,
        title: info.title,
        notes: info.notes,
        gregorianDate,
        ethiopianDate: eth,
        category: "holiday",
        type: "holiday",
        _category: "holiday",
        _builtIn: true,
      });
    }
  });

  return [...fixed, ...movable];
}

export default function CalendarTab() {
  const todayEth = getTodayEthiopian();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [events, setEvents] = useState([]);

  const [ethYear, setEthYear] = useState(todayEth.year);
  const [ethMonth, setEthMonth] = useState(todayEth.month);
  const [selectedEthDay, setSelectedEthDay] = useState(todayEth.day);
  const [todayOnly, setTodayOnly] = useState(false);
  const [amharic, setAmharic] = useState(false);

  const labels = getLabelMap(amharic);
  const scrollRef = useRef(null);
  const detailsYRef = useRef(0);

  const getPathPrefix = async () => {
    const sk = (await AsyncStorage.getItem("schoolKey")) || null;
    return sk ? `Platform1/Schools/${sk}/` : "";
  };

  const fetchCalendarEvents = async () => {
    try {
      const prefix = await getPathPrefix();
      const snap = await get(ref(database, `${prefix}CalendarEvents`));

      if (!snap.exists()) return [];

      const arr = [];
      snap.forEach((child) => {
        const val = child.val() || {};
        const gregorianDate = val.gregorianDate || null;

        let ethiopianDate = val.ethiopianDate || null;
        if (
          !ethiopianDate &&
          gregorianDate &&
          /^\d{4}-\d{2}-\d{2}$/.test(gregorianDate)
        ) {
          const [gy, gm, gd] = gregorianDate.split("-").map(Number);
          ethiopianDate = safeToEthiopian(gy, gm, gd);
        }

        arr.push({
          id: child.key,
          ...val,
          gregorianDate,
          ethiopianDate,
          _category: normalizeCategory(val),
        });
      });

      arr.sort((a, b) => new Date(a.gregorianDate || 0) - new Date(b.gregorianDate || 0));
      return arr;
    } catch (e) {
      console.warn("Calendar events load error:", e);
      return [];
    }
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      const data = await fetchCalendarEvents();
      if (mounted) {
        setEvents(data);
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    const data = await fetchCalendarEvents();
    setEvents(data);
    setRefreshing(false);
  };

  const monthCells = useMemo(() => buildEthMonthGrid(ethYear, ethMonth), [ethYear, ethMonth]);

  const builtInHolidayEvents = useMemo(() => {
    return buildBuiltInHolidayEventsForMonth(ethYear, ethMonth, amharic);
  }, [ethYear, ethMonth, amharic]);

  const mergedEvents = useMemo(() => {
    const dbKeys = new Set(events.map((e) => `${e.gregorianDate}-${e.title}`));
    const extras = builtInHolidayEvents.filter(
      (e) => !dbKeys.has(`${e.gregorianDate}-${e.title}`)
    );

    const merged = [...events, ...extras];
    merged.sort((a, b) => new Date(a.gregorianDate || 0) - new Date(b.gregorianDate || 0));
    return merged;
  }, [events, builtInHolidayEvents]);

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

  const upcoming = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const list = mergedEvents.filter((e) => {
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
  }, [mergedEvents, todayOnly, todayEth.year, todayEth.month, todayEth.day]);

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

    if (dayEvents.some((e) => e._category === "exam")) return CAT_COLORS.exam;
    if (dayEvents.some((e) => e._category === "holiday")) return CAT_COLORS.holiday;
    if (dayEvents.some((e) => e._category === "academic")) return CAT_COLORS.academic;
    if (dayEvents.some((e) => e._category === "event")) return CAT_COLORS.event;
    return CAT_COLORS.general;
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

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={PRIMARY} />
        <Text style={styles.loadingText}>Loading calendar...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
        <View style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="calendar-clear-outline" size={28} color={PRIMARY} />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>{labels.title}</Text>
              <Text style={styles.heroSub}>{labels.sub}</Text>

              <View style={styles.statusChip}>
                <Ionicons name="sparkles-outline" size={14} color={PRIMARY} />
                <Text style={styles.statusText}>
                  {amharic ? "የኢትዮጵያ ቀን መቁጠሪያ" : "Ethiopian calendar mode"}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.metricGrid}>
            <MetricCard
              label={labels.month}
              value={getEthMonthName(ethMonth, amharic)}
              valueColor={PRIMARY}
            />
            <MetricCard label={labels.year} value={ethYear} />
            <MetricCard label={labels.today} value={todayEth.day} />
          </View>
        </View>

        <View style={styles.cardWide}>
          <View style={styles.topActionRow}>
            <TouchableOpacity
              onPress={() => setAmharic((v) => !v)}
              style={[styles.softChip, amharic && styles.softChipActive]}
              activeOpacity={0.86}
            >
              <Text style={[styles.softChipText, amharic && styles.softChipTextActive]}>
                {labels.lang}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setTodayOnly((s) => !s);
                if (!todayOnly) {
                  setEthYear(todayEth.year);
                  setEthMonth(todayEth.month);
                  setSelectedEthDay(todayEth.day);
                }
                scrollToDetails();
              }}
              style={[styles.softChip, todayOnly && styles.softChipActive]}
              activeOpacity={0.86}
            >
              <Ionicons
                name="today-outline"
                size={14}
                color={todayOnly ? "#fff" : PRIMARY}
                style={{ marginRight: 5 }}
              />
              <Text style={[styles.softChipText, todayOnly && styles.softChipTextActive]}>
                {labels.today}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.navRow}>
            <TouchableOpacity onPress={prevMonth} style={styles.navBtn} activeOpacity={0.86}>
              <Ionicons name="chevron-back" size={18} color={PRIMARY} />
            </TouchableOpacity>

            <View style={styles.monthTitleWrap}>
              <Text style={styles.monthTitle}>{monthTitle}</Text>
              <Text style={styles.monthSub} numberOfLines={2}>
                {selectedGregorianDate
                  ? new Date(selectedGregorianDate).toLocaleDateString(amharic ? "am-ET" : undefined)
                  : ""}
              </Text>
            </View>

            <TouchableOpacity onPress={nextMonth} style={styles.navBtn} activeOpacity={0.86}>
              <Ionicons name="chevron-forward" size={18} color={PRIMARY} />
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>{labels.month}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {Array.from({ length: 13 }, (_, i) => i + 1).map((m) => {
              const active = ethMonth === m;
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.choiceChip, active && styles.choiceChipActive]}
                  onPress={() => {
                    setEthMonth(m);
                    setTodayOnly(false);
                    setSelectedEthDay(1);
                  }}
                  activeOpacity={0.86}
                >
                  <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>
                    {getEthMonthName(m, amharic)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.sectionLabel}>{labels.year}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {Array.from({ length: 7 }, (_, i) => todayEth.year - 3 + i).map((y) => {
              const active = ethYear === y;
              return (
                <TouchableOpacity
                  key={y}
                  style={[styles.choiceChip, active && styles.choiceChipActive]}
                  onPress={() => {
                    setEthYear(y);
                    setTodayOnly(false);
                    setSelectedEthDay(1);
                  }}
                  activeOpacity={0.86}
                >
                  <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>
                    {y}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.legendWrap}>
            {["academic", "event", "exam", "holiday"].map((key) => (
              <View key={key} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: CAT_COLORS[key] }]} />
                <Text style={styles.legendText}>{labels.category[key]}</Text>
              </View>
            ))}
          </View>

          <View style={styles.weekRow}>
            {(amharic ? DAYS_AM : DAYS_EN).map((d) => (
              <Text key={d} style={styles.weekText}>
                {d}
              </Text>
            ))}
          </View>

          <View style={styles.gridWrap}>
            {monthCells.map((cell, idx) => {
              if (!cell) return <View key={`empty-${idx}`} style={styles.dayCell} />;

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
              const c = CAT_COLORS[cat] || CAT_COLORS.general;

              return (
                <View key={item.id} style={styles.eventCard}>
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

                  {item._builtIn ? (
                    <Text style={styles.builtInLabel}>{labels.builtInHoliday}</Text>
                  ) : null}

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>{labels.ethiopian}</Text>
                    <Text style={styles.infoValue}>
                      {formatEthDate(item.ethiopianDate, amharic)}
                    </Text>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>{labels.gregorian}</Text>
                    <Text style={styles.infoValue}>
                      {item.gregorianDate
                        ? new Date(item.gregorianDate).toLocaleDateString(amharic ? "am-ET" : undefined)
                        : "N/A"}
                    </Text>
                  </View>

                  <Text style={styles.descTitle}>{labels.description}</Text>
                  <Text style={styles.eventNote}>
                    {item.notes?.trim() ? item.notes : labels.noDescription}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.cardWide}>
          <Text style={styles.cardTitleSmall}>
            {todayOnly ? labels.today : labels.upcoming}
          </Text>

          {upcoming.length === 0 ? (
            <Text style={styles.emptyText}>{labels.noUpcoming}</Text>
          ) : (
            upcoming.map((item) => {
              const cat = item._category || "general";
              const c = CAT_COLORS[cat] || CAT_COLORS.general;

              return (
                <View key={item.id} style={styles.upcomingRow}>
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
    </View>
  );
}

function MetricCard({ label, value, valueColor = TEXT }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color: valueColor }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content: {
    paddingHorizontal: 10,
    paddingTop: 14,
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
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    shadowColor: "rgba(15,23,42,0.06)",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3,
    marginBottom: 12,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  heroIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: PRIMARY_SOFT,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  heroTitle: {
    color: TEXT,
    fontWeight: "800",
    fontSize: 21,
  },
  heroSub: {
    color: MUTED,
    fontSize: 13,
    marginTop: 3,
    fontWeight: "500",
  },
  statusChip: {
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: PRIMARY_SOFT,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "800",
    color: PRIMARY,
    marginLeft: 6,
  },

  metricGrid: {
    flexDirection: "row",
    marginTop: 16,
    gap: 8,
  },
  metricCard: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  metricLabel: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  metricValue: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: "900",
  },

  cardWide: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
    shadowColor: "rgba(15,23,42,0.04)",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },

  topActionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  softChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: PRIMARY_SOFT,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
    marginBottom: 14,
  },
  navBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: PRIMARY_SOFT,
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
    fontSize: 17,
    fontWeight: "900",
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

  sectionLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: TEXT,
    marginBottom: 8,
    marginTop: 2,
  },
  chipRow: {
    gap: 8,
    paddingBottom: 10,
    paddingRight: 6,
  },
  choiceChip: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
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
    marginBottom: 10,
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
    justifyContent: "space-between",
    marginBottom: 6,
  },
  weekText: {
    width: `${100 / 7}%`,
    textAlign: "center",
    fontSize: 12,
    color: MUTED,
    fontWeight: "700",
  },

  gridWrap: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 8,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    marginBottom: 2,
    paddingTop: 5,
    paddingBottom: 2,
    overflow: "hidden",
  },
  daySelected: {
    backgroundColor: PRIMARY,
  },
  dayText: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 15,
    lineHeight: 18,
  },
  dayTextSelected: {
    color: "#fff",
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
    color: "#DCEBFF",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 3,
  },

  cardTitleSmall: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 10,
  },
  emptyText: {
    color: MUTED,
    fontSize: 13,
  },

  selectedDateHeaderWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 12,
  },
  selectedDatePill: {
    minWidth: "48%",
    flexGrow: 1,
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: "#DBEAFE",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  selectedDatePillLabel: {
    fontSize: 11,
    color: MUTED,
    fontWeight: "700",
  },
  selectedDatePillValue: {
    marginTop: 4,
    fontSize: 12,
    color: TEXT,
    fontWeight: "800",
    lineHeight: 18,
    flexWrap: "wrap",
  },

  eventCard: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#FAFCFF",
  },
  eventTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  eventTitle: {
    fontSize: 14,
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

  upcomingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    paddingVertical: 10,
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
    color: "#475569",
    marginTop: 2,
    lineHeight: 16,
  },
  upcomingType: {
    fontSize: 11,
    fontWeight: "800",
    paddingTop: 2,
  },
});