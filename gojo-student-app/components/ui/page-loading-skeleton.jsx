import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useAppTheme } from "../../hooks/use-app-theme";

function withAlpha(color, alpha) {
  if (typeof color !== "string") return `rgba(255,255,255,${alpha})`;

  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex.split("").map((value) => value + value).join("");
    }

    if (hex.length !== 6) {
      return `rgba(255,255,255,${alpha})`;
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

function SkeletonBlock({ blockStyle, baseColor, shimmerColors, translateX }) {
  return (
    <View style={[styles.block, { backgroundColor: baseColor }, blockStyle]}>
      <Animated.View pointerEvents="none" style={[styles.shimmerTrack, { transform: [{ translateX }] }]}>
        <LinearGradient colors={shimmerColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.shimmerGradient} />
      </Animated.View>
    </View>
  );
}

function SkeletonShell({ children, shellStyle, shellColor, borderColor }) {
  return <View style={[styles.shell, { backgroundColor: shellColor, borderColor }, shellStyle]}>{children}</View>;
}

function renderHeader(renderBlock, showHeader) {
  if (!showHeader) return null;

  return (
    <View style={styles.headerRow}>
      {renderBlock({ width: 40, height: 40, borderRadius: 20 }, "header-back")}
      <View style={styles.headerCopy}>
        {renderBlock({ width: "46%", height: 22, borderRadius: 12 }, "header-title")}
        {renderBlock({ width: "28%", height: 12, borderRadius: 6, marginTop: 10 }, "header-subtitle")}
      </View>
      {renderBlock({ width: 34, height: 34, borderRadius: 17 }, "header-action")}
    </View>
  );
}

function renderChipRow(renderBlock, chips, keyPrefix = "chip") {
  return (
    <View style={styles.chipRow}>
      {chips.map((chip, index) =>
        renderBlock(
          {
            width: chip,
            height: 30,
            borderRadius: 15,
            marginRight: index === chips.length - 1 ? 0 : 8,
          },
          `${keyPrefix}-${index}`
        )
      )}
    </View>
  );
}

function renderStatRow(renderBlock, stats, keyPrefix = "stat") {
  return (
    <View style={styles.statRow}>
      {stats.map((stat, index) => (
        <SkeletonShell
          key={`${keyPrefix}-${index}`}
          shellStyle={[styles.statShell, index < stats.length - 1 ? styles.statShellGap : null]}
          shellColor={stat.shellColor}
          borderColor={stat.borderColor}
        >
          {renderBlock({ width: "48%", height: 12, borderRadius: 6 }, `${keyPrefix}-label-${index}`)}
          {renderBlock({ width: stat.valueWidth, height: 28, borderRadius: 12, marginTop: 14 }, `${keyPrefix}-value-${index}`)}
        </SkeletonShell>
      ))}
    </View>
  );
}

function renderListRows(renderBlock, shellColor, borderColor, count = 5, dense = false) {
  return Array.from({ length: count }).map((_, index) => (
    <SkeletonShell key={`list-row-${index}`} shellStyle={index > 0 ? styles.sectionGapMd : null} shellColor={shellColor} borderColor={borderColor}>
      <View style={styles.listRow}>
        {renderBlock({ width: dense ? 46 : 54, height: dense ? 46 : 54, borderRadius: dense ? 18 : 22, marginRight: 12 }, `list-avatar-${index}`)}
        <View style={styles.flexOne}>
          {renderBlock({ width: index % 2 === 0 ? "58%" : "44%", height: 15, borderRadius: 8 }, `list-title-${index}`)}
          {renderBlock({ width: index % 3 === 0 ? "72%" : "60%", height: 11, borderRadius: 6, marginTop: 10 }, `list-subtitle-${index}`)}
        </View>
        <View style={styles.listMeta}>
          {renderBlock({ width: 42, height: 10, borderRadius: 5 }, `list-time-${index}`)}
          {renderBlock({ width: 26, height: 18, borderRadius: 9, marginTop: 12 }, `list-badge-${index}`)}
        </View>
      </View>
    </SkeletonShell>
  ));
}

function renderVariant(variant, renderBlock, palette, showHeader) {
  const { shellColor, borderColor } = palette;

  switch (variant) {
    case "auth":
      return (
        <View style={styles.authWrap}>
          {renderChipRow(renderBlock, [88], "auth-pill")}
          <SkeletonShell shellStyle={styles.authShell} shellColor={shellColor} borderColor={borderColor}>
            {renderBlock({ width: 78, height: 78, borderRadius: 39, alignSelf: "center" }, "auth-logo")}
            {renderBlock({ width: "54%", height: 26, borderRadius: 13, alignSelf: "center", marginTop: 24 }, "auth-title")}
            {renderBlock({ width: "68%", height: 12, borderRadius: 6, alignSelf: "center", marginTop: 14 }, "auth-subtitle")}
            <SkeletonShell shellStyle={styles.inputShell} shellColor={shellColor} borderColor={borderColor}>
              {renderBlock({ width: 22, height: 22, borderRadius: 11, marginRight: 12 }, "auth-user-icon")}
              <View style={styles.flexOne}>
                {renderBlock({ width: "28%", height: 10, borderRadius: 5 }, "auth-user-label")}
                {renderBlock({ width: "72%", height: 14, borderRadius: 7, marginTop: 10 }, "auth-user-input")}
              </View>
            </SkeletonShell>
            <SkeletonShell shellStyle={[styles.inputShell, styles.sectionGapSm]} shellColor={shellColor} borderColor={borderColor}>
              {renderBlock({ width: 22, height: 22, borderRadius: 11, marginRight: 12 }, "auth-pass-icon")}
              <View style={styles.flexOne}>
                {renderBlock({ width: "24%", height: 10, borderRadius: 5 }, "auth-pass-label")}
                {renderBlock({ width: "66%", height: 14, borderRadius: 7, marginTop: 10 }, "auth-pass-input")}
              </View>
            </SkeletonShell>
            {renderBlock({ width: "100%", height: 54, borderRadius: 18, marginTop: 22 }, "auth-button")}
            <View style={[styles.row, styles.sectionGapMd, styles.centerAligned]}>
              {renderBlock({ width: 76, height: 10, borderRadius: 5 }, "auth-foot-left")}
              {renderBlock({ width: 54, height: 10, borderRadius: 5, marginLeft: 18 }, "auth-foot-right")}
            </View>
          </SkeletonShell>
        </View>
      );
    case "chat":
      return (
        <>
          {renderHeader(renderBlock, showHeader)}
          <SkeletonShell shellStyle={styles.searchShell} shellColor={shellColor} borderColor={borderColor}>
            {renderBlock({ width: 18, height: 18, borderRadius: 9, marginRight: 12 }, "chat-search-icon")}
            {renderBlock({ width: "42%", height: 12, borderRadius: 6 }, "chat-search-text")}
          </SkeletonShell>
          {renderChipRow(renderBlock, [84, 94, 78, 90], "chat-filter")}
          {renderListRows(renderBlock, shellColor, borderColor, 6)}
        </>
      );
    case "profile":
      return (
        <>
          <SkeletonShell shellStyle={styles.profileHeroShell} shellColor={shellColor} borderColor={borderColor}>
            <View style={styles.rowBetween}>
              {renderBlock({ width: 38, height: 38, borderRadius: 19 }, "profile-back")}
              <View style={styles.row}>
                {renderBlock({ width: 66, height: 26, borderRadius: 13, marginRight: 10 }, "profile-pill-1")}
                {renderBlock({ width: 34, height: 34, borderRadius: 17 }, "profile-settings")}
              </View>
            </View>
          </SkeletonShell>
          <View style={styles.profileAvatarWrap}>
            {renderBlock({ width: 116, height: 116, borderRadius: 58 }, "profile-avatar")}
          </View>
          <View style={styles.profileCopyWrap}>
            {renderBlock({ width: "44%", height: 26, borderRadius: 13, alignSelf: "center" }, "profile-name")}
            <View style={[styles.row, styles.centerAligned, styles.sectionGapSm]}>
              {renderBlock({ width: 92, height: 12, borderRadius: 6 }, "profile-handle")}
              {renderBlock({ width: 74, height: 28, borderRadius: 14, marginLeft: 10 }, "profile-grade")}
            </View>
            {renderBlock({ width: 136, height: 40, borderRadius: 20, alignSelf: "center", marginTop: 16 }, "profile-edit")}
          </View>
          {renderStatRow(renderBlock, [
            { valueWidth: "34%", shellColor, borderColor },
            { valueWidth: "42%", shellColor, borderColor },
            { valueWidth: "30%", shellColor, borderColor },
          ], "profile-stat")}
          <SkeletonShell shellStyle={styles.sectionGapLg} shellColor={shellColor} borderColor={borderColor}>
            {renderChipRow(renderBlock, [72, 78, 84], "profile-tabs")}
          </SkeletonShell>
          <SkeletonShell shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
            {renderBlock({ width: "34%", height: 14, borderRadius: 7 }, "profile-section-title")}
            {renderBlock({ width: "92%", height: 12, borderRadius: 6, marginTop: 16 }, "profile-line-1")}
            {renderBlock({ width: "74%", height: 12, borderRadius: 6, marginTop: 10 }, "profile-line-2")}
          </SkeletonShell>
          <SkeletonShell shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
            {renderBlock({ width: "42%", height: 14, borderRadius: 7 }, "profile-card-title")}
            {renderListRows(renderBlock, shellColor, borderColor, 2, true)}
          </SkeletonShell>
        </>
      );
    case "feed":
      return (
        <>
          <View style={styles.storyRow}>
            {Array.from({ length: 6 }).map((_, index) => (
              <View key={`story-${index}`} style={[styles.storyItem, index > 0 ? styles.storyGap : null]}>
                {renderBlock({ width: 60, height: 60, borderRadius: 30 }, `story-avatar-${index}`)}
                {renderBlock({ width: 42, height: 10, borderRadius: 5, marginTop: 10 }, `story-label-${index}`)}
              </View>
            ))}
          </View>
          <SkeletonShell shellStyle={styles.composerShell} shellColor={shellColor} borderColor={borderColor}>
            {renderBlock({ width: 42, height: 42, borderRadius: 21, marginRight: 12 }, "feed-composer-avatar")}
            <View style={styles.flexOne}>
              {renderBlock({ width: "36%", height: 10, borderRadius: 5 }, "feed-composer-title")}
              {renderBlock({ width: "70%", height: 14, borderRadius: 7, marginTop: 10 }, "feed-composer-line")}
            </View>
          </SkeletonShell>
          {Array.from({ length: 2 }).map((_, index) => (
            <SkeletonShell key={`feed-card-${index}`} shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
              <View style={styles.row}>
                {renderBlock({ width: 42, height: 42, borderRadius: 21, marginRight: 12 }, `feed-avatar-${index}`)}
                <View style={styles.flexOne}>
                  {renderBlock({ width: "42%", height: 14, borderRadius: 7 }, `feed-title-${index}`)}
                  {renderBlock({ width: "28%", height: 10, borderRadius: 5, marginTop: 10 }, `feed-meta-${index}`)}
                </View>
              </View>
              {renderBlock({ width: "100%", height: 210, borderRadius: 24, marginTop: 18 }, `feed-image-${index}`)}
              <View style={[styles.rowBetween, styles.sectionGapMd]}>
                <View style={styles.row}>
                  {renderBlock({ width: 22, height: 22, borderRadius: 11, marginRight: 14 }, `feed-like-${index}`)}
                  {renderBlock({ width: 22, height: 22, borderRadius: 11, marginRight: 14 }, `feed-comment-${index}`)}
                  {renderBlock({ width: 22, height: 22, borderRadius: 11 }, `feed-share-${index}`)}
                </View>
                {renderBlock({ width: 22, height: 22, borderRadius: 11 }, `feed-save-${index}`)}
              </View>
              {renderBlock({ width: "88%", height: 12, borderRadius: 6, marginTop: 18 }, `feed-line-1-${index}`)}
              {renderBlock({ width: "64%", height: 12, borderRadius: 6, marginTop: 10 }, `feed-line-2-${index}`)}
            </SkeletonShell>
          ))}
        </>
      );
    case "exam":
      return (
        <>
          <SkeletonShell shellStyle={styles.examTopShell} shellColor={shellColor} borderColor={borderColor}>
            <View style={styles.rowBetween}>
              <View style={styles.row}>
                {Array.from({ length: 3 }).map((_, index) => (
                  <View key={`exam-avatar-${index}`} style={[styles.avatarStackItem, index > 0 ? styles.avatarStackOverlap : null]}>
                    {renderBlock({ width: 34, height: 34, borderRadius: 17 }, `exam-stack-${index}`)}
                  </View>
                ))}
              </View>
              {renderBlock({ width: 82, height: 20, borderRadius: 10 }, "exam-title")}
              {renderBlock({ width: 34, height: 34, borderRadius: 17 }, "exam-action")}
            </View>
          </SkeletonShell>
          <View style={[styles.row, styles.sectionGapMd, styles.storyRail]}>
            {Array.from({ length: 5 }).map((_, index) => (
              <View key={`exam-story-${index}`} style={[styles.storyItem, index > 0 ? styles.storyGap : null]}>
                {renderBlock({ width: 56, height: 56, borderRadius: 28 }, `exam-story-avatar-${index}`)}
                {renderBlock({ width: 44, height: 10, borderRadius: 5, marginTop: 8 }, `exam-story-text-${index}`)}
              </View>
            ))}
          </View>
          <SkeletonShell shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
            {renderBlock({ width: "38%", height: 14, borderRadius: 7 }, "exam-promo-kicker")}
            {renderBlock({ width: "62%", height: 24, borderRadius: 12, marginTop: 14 }, "exam-promo-title")}
            {renderBlock({ width: "78%", height: 12, borderRadius: 6, marginTop: 12 }, "exam-promo-subtitle")}
            {renderBlock({ width: "100%", height: 168, borderRadius: 24, marginTop: 18 }, "exam-promo-card")}
          </SkeletonShell>
          {renderStatRow(renderBlock, [
            { valueWidth: "38%", shellColor, borderColor },
            { valueWidth: "30%", shellColor, borderColor },
            { valueWidth: "34%", shellColor, borderColor },
          ], "exam-stat")}
          {Array.from({ length: 3 }).map((_, index) => (
            <SkeletonShell key={`exam-package-${index}`} shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
              <View style={styles.row}>
                {renderBlock({ width: 52, height: 52, borderRadius: 18, marginRight: 14 }, `exam-package-icon-${index}`)}
                <View style={styles.flexOne}>
                  {renderBlock({ width: index % 2 === 0 ? "48%" : "58%", height: 16, borderRadius: 8 }, `exam-package-title-${index}`)}
                  {renderBlock({ width: "34%", height: 10, borderRadius: 5, marginTop: 10 }, `exam-package-meta-${index}`)}
                </View>
              </View>
              {renderBlock({ width: "94%", height: 12, borderRadius: 6, marginTop: 18 }, `exam-package-line-1-${index}`)}
              {renderBlock({ width: "72%", height: 12, borderRadius: 6, marginTop: 10 }, `exam-package-line-2-${index}`)}
              <View style={[styles.rowBetween, styles.sectionGapMd]}>
                {renderBlock({ width: 76, height: 28, borderRadius: 14 }, `exam-package-pill-${index}`)}
                {renderBlock({ width: 92, height: 36, borderRadius: 18 }, `exam-package-button-${index}`)}
              </View>
            </SkeletonShell>
          ))}
        </>
      );
    case "package":
      return (
        <>
          {renderHeader(renderBlock, showHeader)}
          <View style={styles.sectionGapMd}>
            {renderBlock({ width: 118, height: 14, borderRadius: 7 }, "package-whatsnew-title")}
          </View>
          <View style={styles.railRow}>
            {Array.from({ length: 2 }).map((_, index) => (
              <SkeletonShell key={`package-rail-${index}`} shellStyle={[styles.railCard, index > 0 ? styles.railGap : null]} shellColor={shellColor} borderColor={borderColor}>
                <View style={styles.row}>
                  {renderBlock({ width: 28, height: 28, borderRadius: 14, marginRight: 10 }, `package-rail-icon-${index}`)}
                  {renderBlock({ width: "56%", height: 12, borderRadius: 6 }, `package-rail-title-${index}`)}
                </View>
                {renderBlock({ width: "92%", height: 11, borderRadius: 6, marginTop: 14 }, `package-rail-line-1-${index}`)}
                {renderBlock({ width: "66%", height: 11, borderRadius: 6, marginTop: 10 }, `package-rail-line-2-${index}`)}
              </SkeletonShell>
            ))}
          </View>
          <SkeletonShell shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
            {renderBlock({ width: "42%", height: 28, borderRadius: 14 }, "package-hero-title")}
            {renderBlock({ width: "72%", height: 12, borderRadius: 6, marginTop: 12 }, "package-hero-subtitle")}
            {renderStatRow(renderBlock, [
              { valueWidth: "32%", shellColor, borderColor },
              { valueWidth: "38%", shellColor, borderColor },
              { valueWidth: "28%", shellColor, borderColor },
            ], "package-hero-stat")}
          </SkeletonShell>
          {Array.from({ length: 3 }).map((_, index) => (
            <SkeletonShell key={`package-subject-${index}`} shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
              <View style={styles.row}>
                {renderBlock({ width: 54, height: 54, borderRadius: 20, marginRight: 14 }, `package-subject-icon-${index}`)}
                <View style={styles.flexOne}>
                  {renderBlock({ width: index % 2 === 0 ? "46%" : "58%", height: 16, borderRadius: 8 }, `package-subject-title-${index}`)}
                  {renderBlock({ width: "34%", height: 10, borderRadius: 5, marginTop: 10 }, `package-subject-meta-${index}`)}
                </View>
                {renderBlock({ width: 22, height: 22, borderRadius: 11 }, `package-subject-chevron-${index}`)}
              </View>
              <View style={[styles.row, styles.sectionGapMd]}>
                {renderBlock({ width: 80, height: 28, borderRadius: 14, marginRight: 8 }, `package-subject-pill-1-${index}`)}
                {renderBlock({ width: 96, height: 28, borderRadius: 14 }, `package-subject-pill-2-${index}`)}
              </View>
              {renderBlock({ width: "96%", height: 12, borderRadius: 6, marginTop: 18 }, `package-subject-line-1-${index}`)}
              {renderBlock({ width: "78%", height: 12, borderRadius: 6, marginTop: 10 }, `package-subject-line-2-${index}`)}
            </SkeletonShell>
          ))}
        </>
      );
    case "library":
      return (
        <>
          {renderHeader(renderBlock, showHeader)}
          <SkeletonShell shellStyle={styles.searchShell} shellColor={shellColor} borderColor={borderColor}>
            {renderBlock({ width: 18, height: 18, borderRadius: 9, marginRight: 12 }, "library-search-icon")}
            {renderBlock({ width: "46%", height: 12, borderRadius: 6 }, "library-search-text")}
          </SkeletonShell>
          <SkeletonShell shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
            {renderBlock({ width: "36%", height: 12, borderRadius: 6 }, "library-kicker")}
            {renderBlock({ width: "58%", height: 24, borderRadius: 12, marginTop: 14 }, "library-title")}
            {renderBlock({ width: "74%", height: 12, borderRadius: 6, marginTop: 12 }, "library-subtitle")}
            {renderBlock({ width: "100%", height: 160, borderRadius: 24, marginTop: 18 }, "library-banner")}
          </SkeletonShell>
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonShell key={`library-book-${index}`} shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
              <View style={styles.row}>
                {renderBlock({ width: 78, height: 102, borderRadius: 18, marginRight: 14 }, `library-cover-${index}`)}
                <View style={styles.flexOne}>
                  {renderBlock({ width: index % 2 === 0 ? "52%" : "64%", height: 16, borderRadius: 8 }, `library-name-${index}`)}
                  {renderBlock({ width: "34%", height: 10, borderRadius: 5, marginTop: 12 }, `library-grade-${index}`)}
                  {renderBlock({ width: "82%", height: 10, borderRadius: 5, marginTop: 18 }, `library-line-1-${index}`)}
                  {renderBlock({ width: "68%", height: 10, borderRadius: 5, marginTop: 10 }, `library-line-2-${index}`)}
                  {renderBlock({ width: "100%", height: 8, borderRadius: 4, marginTop: 18 }, `library-progress-${index}`)}
                </View>
              </View>
            </SkeletonShell>
          ))}
        </>
      );
    case "stats":
      return (
        <>
          {renderHeader(renderBlock, showHeader)}
          <View style={[styles.rowBetween, styles.sectionGapMd]}>
            {renderChipRow(renderBlock, [82, 90, 74], "stats-filter")}
            {renderBlock({ width: 42, height: 42, borderRadius: 21 }, "stats-search")}
          </View>
          {renderStatRow(renderBlock, [
            { valueWidth: "38%", shellColor, borderColor },
            { valueWidth: "30%", shellColor, borderColor },
            { valueWidth: "34%", shellColor, borderColor },
          ], "stats-top")}
          <SkeletonShell shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
            {renderBlock({ width: "28%", height: 14, borderRadius: 7 }, "stats-chart-kicker")}
            {renderBlock({ width: "46%", height: 22, borderRadius: 11, marginTop: 12 }, "stats-chart-title")}
            <View style={styles.chartShell}>
              {Array.from({ length: 6 }).map((_, index) => (
                <View key={`chart-bar-${index}`} style={styles.chartColumn}>
                  {renderBlock({ width: 22, height: 70 + ((index % 3) * 24), borderRadius: 11 }, `stats-chart-bar-${index}`)}
                  {renderBlock({ width: 26, height: 8, borderRadius: 4, marginTop: 10 }, `stats-chart-label-${index}`)}
                </View>
              ))}
            </View>
          </SkeletonShell>
          {Array.from({ length: 3 }).map((_, index) => (
            <SkeletonShell key={`stats-course-${index}`} shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
              <View style={styles.rowBetween}>
                <View style={styles.flexOne}>
                  {renderBlock({ width: index % 2 === 0 ? "42%" : "56%", height: 16, borderRadius: 8 }, `stats-course-title-${index}`)}
                  {renderBlock({ width: "28%", height: 10, borderRadius: 5, marginTop: 10 }, `stats-course-meta-${index}`)}
                </View>
                {renderBlock({ width: 46, height: 22, borderRadius: 11 }, `stats-course-badge-${index}`)}
              </View>
              {renderBlock({ width: "100%", height: 10, borderRadius: 5, marginTop: 18 }, `stats-course-progress-${index}`)}
              {renderBlock({ width: "72%", height: 10, borderRadius: 5, marginTop: 12 }, `stats-course-foot-${index}`)}
            </SkeletonShell>
          ))}
        </>
      );
    case "detail":
      return (
        <>
          {renderHeader(renderBlock, showHeader)}
          <SkeletonShell shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
            {renderChipRow(renderBlock, [84, 74, 68], "detail-chip")}
            {renderBlock({ width: "56%", height: 26, borderRadius: 13, marginTop: 18 }, "detail-title")}
            {renderBlock({ width: "34%", height: 12, borderRadius: 6, marginTop: 12 }, "detail-subtitle")}
            {renderBlock({ width: "100%", height: 188, borderRadius: 26, marginTop: 20 }, "detail-hero")}
          </SkeletonShell>
          <SkeletonShell shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
            {renderBlock({ width: "26%", height: 14, borderRadius: 7 }, "detail-section-title")}
            {renderBlock({ width: "94%", height: 12, borderRadius: 6, marginTop: 16 }, "detail-line-1")}
            {renderBlock({ width: "82%", height: 12, borderRadius: 6, marginTop: 10 }, "detail-line-2")}
            {renderBlock({ width: "68%", height: 12, borderRadius: 6, marginTop: 10 }, "detail-line-3")}
          </SkeletonShell>
          {Array.from({ length: 2 }).map((_, index) => (
            <SkeletonShell key={`detail-card-${index}`} shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
              {renderBlock({ width: "42%", height: 14, borderRadius: 7 }, `detail-card-title-${index}`)}
              {renderBlock({ width: "88%", height: 12, borderRadius: 6, marginTop: 16 }, `detail-card-line-1-${index}`)}
              {renderBlock({ width: "62%", height: 12, borderRadius: 6, marginTop: 10 }, `detail-card-line-2-${index}`)}
            </SkeletonShell>
          ))}
        </>
      );
    case "list":
    default:
      return (
        <>
          {renderHeader(renderBlock, showHeader)}
          <SkeletonShell shellStyle={styles.sectionGapMd} shellColor={shellColor} borderColor={borderColor}>
            {renderChipRow(renderBlock, [76, 88, 94], "list-pill")}
            {renderBlock({ width: "48%", height: 22, borderRadius: 11, marginTop: 18 }, "list-title")}
            {renderBlock({ width: "72%", height: 12, borderRadius: 6, marginTop: 12 }, "list-subtitle")}
          </SkeletonShell>
          {renderListRows(renderBlock, shellColor, borderColor, 5)}
        </>
      );
  }
}

export default function PageLoadingSkeleton({ variant = "list", style, contentContainerStyle, showHeader = true }) {
  const { colors, resolvedAppearance } = useAppTheme();
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    shimmer.setValue(0);
    const animation = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1180,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    animation.start();
    return () => animation.stop();
  }, [shimmer]);

  const translateX = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-220, 280],
  });

  const baseColor = withAlpha(colors.surfaceMuted, resolvedAppearance === "dark" ? 0.94 : 1);
  const shimmerColors = useMemo(
    () => [
      withAlpha(colors.white, 0),
      resolvedAppearance === "dark" ? withAlpha(colors.white, 0.08) : withAlpha(colors.white, 0.72),
      withAlpha(colors.white, 0),
    ],
    [colors.white, resolvedAppearance]
  );

  const shellColor = resolvedAppearance === "dark" ? withAlpha(colors.card, 0.92) : withAlpha(colors.card, 0.98);
  const borderColor = resolvedAppearance === "dark" ? withAlpha(colors.border, 0.72) : withAlpha(colors.border, 0.9);

  const renderBlock = (blockStyle, key) => (
    <SkeletonBlock
      key={key}
      blockStyle={blockStyle}
      baseColor={baseColor}
      shimmerColors={shimmerColors}
      translateX={translateX}
    />
  );

  const backgroundColor = variant === "feed" ? colors.feedBackground : colors.background;

  return (
    <View style={[styles.page, { backgroundColor }, style]}>
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          variant === "auth" ? styles.authContent : null,
          contentContainerStyle,
        ]}
      >
        {renderVariant(variant, renderBlock, { shellColor, borderColor }, showHeader)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    overflow: "hidden",
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 34,
  },
  authContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  block: {
    position: "relative",
    overflow: "hidden",
  },
  shell: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
    overflow: "hidden",
  },
  shimmerTrack: {
    position: "absolute",
    top: -2,
    bottom: -2,
    left: -160,
    width: 160,
  },
  shimmerGradient: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  headerCopy: {
    flex: 1,
    marginHorizontal: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  centerAligned: {
    justifyContent: "center",
  },
  flexOne: {
    flex: 1,
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 18,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "stretch",
    marginTop: 22,
  },
  statShell: {
    flex: 1,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  statShellGap: {
    marginRight: 10,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  listMeta: {
    alignItems: "flex-end",
    marginLeft: 12,
  },
  searchShell: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    marginTop: 8,
  },
  authWrap: {
    flex: 1,
    justifyContent: "center",
  },
  authShell: {
    borderRadius: 30,
    padding: 24,
    marginTop: 18,
  },
  inputShell: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    marginTop: 22,
  },
  storyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  storyRail: {
    alignItems: "flex-start",
  },
  storyItem: {
    alignItems: "center",
  },
  storyGap: {
    marginLeft: 14,
  },
  composerShell: {
    marginTop: 18,
  },
  examTopShell: {
    borderRadius: 24,
    marginBottom: 4,
  },
  avatarStackItem: {
    zIndex: 2,
  },
  avatarStackOverlap: {
    marginLeft: -10,
  },
  railRow: {
    flexDirection: "row",
    alignItems: "stretch",
    marginTop: 12,
  },
  railCard: {
    flex: 1,
    minHeight: 106,
  },
  railGap: {
    marginLeft: 12,
  },
  profileHeroShell: {
    minHeight: 168,
    justifyContent: "space-between",
  },
  profileAvatarWrap: {
    alignItems: "center",
    marginTop: -58,
  },
  profileCopyWrap: {
    marginTop: 18,
  },
  chartShell: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 22,
    minHeight: 170,
  },
  chartColumn: {
    alignItems: "center",
    justifyContent: "flex-end",
    flex: 1,
  },
  sectionGapSm: {
    marginTop: 12,
  },
  sectionGapMd: {
    marginTop: 18,
  },
  sectionGapLg: {
    marginTop: 22,
  },
});