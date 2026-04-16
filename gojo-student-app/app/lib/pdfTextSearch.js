import { File as ExpoFile } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";

const PDF_SEARCH_INDEX_VERSION = 1;
const PDF_SEARCH_SNIPPET_RADIUS = 70;

let pdfjsPromise = null;

if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function withResolvers() {
    let resolve;
    let reject;

    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    return { promise, resolve, reject };
  };
}

async function loadPdfJs() {
  if (!pdfjsPromise) {
    // Keep PDF.js lazy-loaded, but use the older legacy .js build because the
    // current ESM build trips Hermes on native bundles.
    pdfjsPromise = Promise.resolve().then(() => require("pdfjs-dist/legacy/build/pdf.js"));
  }

  const loadedModule = await pdfjsPromise;
  return loadedModule?.getDocument ? loadedModule : loadedModule?.default || loadedModule;
}

function toSafeTimestamp(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.floor(parsed) : 0;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBase64ToBytes(base64) {
  if (!base64) return new Uint8Array();

  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  }

  if (typeof globalThis.Buffer !== "undefined") {
    return Uint8Array.from(globalThis.Buffer.from(base64, "base64"));
  }

  throw new Error("This device cannot decode cached PDF data.");
}

async function readPdfBytes(localUri) {
  try {
    const file = new ExpoFile(localUri);

    if (typeof file.bytes === "function") {
      return await file.bytes();
    }

    if (typeof file.arrayBuffer === "function") {
      return new Uint8Array(await file.arrayBuffer());
    }
  } catch {}

  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return decodeBase64ToBytes(base64);
}

function buildPageText(textContent) {
  const chunks = [];

  for (const item of textContent?.items || []) {
    if (typeof item?.str === "string" && item.str) {
      chunks.push(item.str);
    }

    if (item?.hasEOL) {
      chunks.push("\n");
    }
  }

  return normalizeText(chunks.join(" "));
}

function buildSnippet(text, matchIndex, queryLength) {
  const start = Math.max(0, matchIndex - PDF_SEARCH_SNIPPET_RADIUS);
  const end = Math.min(text.length, matchIndex + queryLength + PDF_SEARCH_SNIPPET_RADIUS);
  let snippet = text.slice(start, end).trim();

  if (start > 0) snippet = `...${snippet}`;
  if (end < text.length) snippet = `${snippet}...`;

  return snippet;
}

function isCacheValid(index, fileInfo, localUri) {
  if (!index || typeof index !== "object") return false;
  if (index.version !== PDF_SEARCH_INDEX_VERSION) return false;
  if (index.localUri !== localUri) return false;
  if (!Array.isArray(index.pages)) return false;

  return (
    Number(index.fileSize || 0) === Number(fileInfo.size || 0) &&
    toSafeTimestamp(index.modificationTime) === toSafeTimestamp(fileInfo.modificationTime)
  );
}

export function getPdfSearchIndexPath(localUri) {
  return localUri ? `${localUri}.search.json` : null;
}

export async function deletePdfTextSearchIndex(localUri) {
  const indexPath = getPdfSearchIndexPath(localUri);
  if (!indexPath) return;

  try {
    await FileSystem.deleteAsync(indexPath, { idempotent: true });
  } catch {}
}

async function readCachedPdfTextSearchIndex(localUri, fileInfo) {
  const indexPath = getPdfSearchIndexPath(localUri);
  if (!indexPath) return null;

  try {
    const indexInfo = await FileSystem.getInfoAsync(indexPath);
    if (!indexInfo.exists) return null;

    const raw = await FileSystem.readAsStringAsync(indexPath);
    const parsed = raw ? JSON.parse(raw) : null;

    if (!isCacheValid(parsed, fileInfo, localUri)) {
      await deletePdfTextSearchIndex(localUri);
      return null;
    }

    return parsed;
  } catch {
    await deletePdfTextSearchIndex(localUri);
    return null;
  }
}

async function extractPdfPageTexts(localUri, onProgress) {
  const pdfBytes = await readPdfBytes(localUri);
  const pdfjs = await loadPdfJs();

  const loadingTask = pdfjs.getDocument({
    data: pdfBytes,
    useWorkerFetch: false,
    useWasm: false,
    disableFontFace: true,
    useSystemFonts: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    stopAtErrors: false,
  });

  let pdfDocument = null;

  try {
    pdfDocument = await loadingTask.promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = buildPageText(textContent);

      pages.push({ page: pageNumber, text });
      onProgress?.({ page: pageNumber, pageCount: pdfDocument.numPages });

      page.cleanup?.();
    }

    return {
      pageCount: pdfDocument.numPages,
      pages,
    };
  } finally {
    try {
      await pdfDocument?.destroy?.();
    } catch {}

    try {
      await loadingTask.destroy();
    } catch {}
  }
}

export async function ensurePdfTextSearchIndex(localUri, options = {}) {
  if (!localUri) {
    throw new Error("A local PDF path is required for text search.");
  }

  const { force = false, onProgress } = options;
  const fileInfo = await FileSystem.getInfoAsync(localUri);

  if (!fileInfo.exists || Number(fileInfo.size || 0) <= 0) {
    throw new Error("The saved PDF file is missing or empty.");
  }

  if (!force) {
    const cached = await readCachedPdfTextSearchIndex(localUri, fileInfo);
    if (cached) {
      return { index: cached, fromCache: true };
    }
  }

  const extracted = await extractPdfPageTexts(localUri, onProgress);
  const index = {
    version: PDF_SEARCH_INDEX_VERSION,
    localUri,
    fileSize: Number(fileInfo.size || 0),
    modificationTime: toSafeTimestamp(fileInfo.modificationTime),
    pageCount: extracted.pageCount,
    extractedAt: Date.now(),
    pages: extracted.pages,
  };

  const indexPath = getPdfSearchIndexPath(localUri);

  if (indexPath) {
    await FileSystem.writeAsStringAsync(indexPath, JSON.stringify(index));
  }

  return { index, fromCache: false };
}

export function searchPdfTextSearchIndex(index, query, limit = 20) {
  const normalizedQuery = normalizeText(query).toLowerCase();

  if (!normalizedQuery || !index?.pages?.length) {
    return [];
  }

  const matches = [];

  for (const pageEntry of index.pages) {
    const pageText = normalizeText(pageEntry?.text);
    if (!pageText) continue;

    const normalizedPageText = pageText.toLowerCase();
    const matchIndex = normalizedPageText.indexOf(normalizedQuery);

    if (matchIndex === -1) {
      continue;
    }

    matches.push({
      key: `text-${pageEntry.page}`,
      kind: "text",
      kindLabel: "Text",
      title: `Text match on page ${pageEntry.page}`,
      subtitle: `Page ${pageEntry.page}`,
      note: buildSnippet(pageText, matchIndex, normalizedQuery.length),
      page: pageEntry.page,
      depth: 0,
    });

    if (matches.length >= limit) {
      break;
    }
  }

  return matches;
}