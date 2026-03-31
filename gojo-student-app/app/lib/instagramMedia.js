import { Image } from "react-native";

export const INSTAGRAM_FEED_MIN_ASPECT_RATIO = 4 / 5;
export const INSTAGRAM_FEED_MAX_ASPECT_RATIO = 1.91;

const aspectRatioCache = new Map();

export function clampInstagramFeedAspectRatio(aspectRatio) {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return 1;

  return Math.max(
    INSTAGRAM_FEED_MIN_ASPECT_RATIO,
    Math.min(INSTAGRAM_FEED_MAX_ASPECT_RATIO, aspectRatio)
  );
}

export async function getInstagramFeedAspectRatio(uri) {
  if (!uri) return 1;

  const cached = aspectRatioCache.get(uri);
  if (cached) return cached;

  const nextAspectRatio = await new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => {
        resolve(clampInstagramFeedAspectRatio(width / height));
      },
      () => resolve(1)
    );
  });

  aspectRatioCache.set(uri, nextAspectRatio);
  return nextAspectRatio;
}