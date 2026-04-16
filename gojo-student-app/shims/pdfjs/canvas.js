class DOMMatrixShim {
  invertSelf() {
    return this;
  }

  multiplySelf() {
    return this;
  }

  preMultiplySelf() {
    return this;
  }

  translateSelf() {
    return this;
  }

  scaleSelf() {
    return this;
  }

  rotateSelf() {
    return this;
  }

  transformPoint(point) {
    return point;
  }
}

class CanvasRenderingContext2DShim {}

module.exports = {
  DOMMatrix: globalThis.DOMMatrix || DOMMatrixShim,
  CanvasRenderingContext2D: globalThis.CanvasRenderingContext2D || CanvasRenderingContext2DShim,
  ImageData: globalThis.ImageData,
  Path2D: globalThis.Path2D,
  createCanvas() {
    throw new Error("The Node canvas package is unavailable in this Expo app.");
  },
};