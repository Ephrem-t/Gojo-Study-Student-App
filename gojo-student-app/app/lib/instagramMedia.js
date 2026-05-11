import { Image } from "react-native";

export const INSTAGRAM_FEED_MIN_ASPECT_RATIO = 4 / 5;
export const INSTAGRAM_FEED_MAX_ASPECT_RATIO = 1.91;

const aspectRatioCache = new Map();
const rawAspectRatioCache = new Map();

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

  const rawAspectRatio = await getImageAspectRatio(uri);
  const nextAspectRatio = clampInstagramFeedAspectRatio(rawAspectRatio);

  aspectRatioCache.set(uri, nextAspectRatio);
  return nextAspectRatio;
}

export async function getImageAspectRatio(uri) {
  if (!uri) return 1;

  const cached = rawAspectRatioCache.get(uri);
  if (cached) return cached;

  const nextAspectRatio = await new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => {
        const aspectRatio = width > 0 && height > 0 ? width / height : 1;
        resolve(Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1);
      },
      () => resolve(1)
    );
  });

  rawAspectRatioCache.set(uri, nextAspectRatio);
  return nextAspectRatio;
}