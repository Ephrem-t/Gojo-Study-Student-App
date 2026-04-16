const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  canvas: path.resolve(__dirname, "shims/pdfjs/canvas.js"),
  "path2d-polyfill": path.resolve(__dirname, "shims/pdfjs/path2d-polyfill.js"),
  fs: path.resolve(__dirname, "shims/pdfjs/unsupported-node-module.js"),
  http: path.resolve(__dirname, "shims/pdfjs/unsupported-node-module.js"),
  https: path.resolve(__dirname, "shims/pdfjs/unsupported-node-module.js"),
  zlib: path.resolve(__dirname, "shims/pdfjs/unsupported-node-module.js"),
};

module.exports = config;