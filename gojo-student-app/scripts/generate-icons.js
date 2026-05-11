const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const MASTER_SIZE = 1024;
const BACKGROUND_TOP = { r: 243, g: 249, b: 255, a: 255 };
const BACKGROUND_BOTTOM = { r: 225, g: 239, b: 255, a: 255 };
const PLATE_COLOR = { r: 220, g: 235, b: 251, a: 220 };
const SHADOW_COLOR = { r: 70, g: 118, b: 177, a: 48 };

function rgbaToInt(color) {
  return Jimp.rgbaToInt(color.r, color.g, color.b, color.a);
}

function lerpChannel(start, end, ratio) {
  return Math.round(start + (end - start) * ratio);
}

function fillGradient(image, topColor, bottomColor) {
  const { width, height } = image.bitmap;

  image.scan(0, 0, width, height, function scanPixel(x, y, idx) {
    const ratio = height === 1 ? 0 : y / (height - 1);
    this.bitmap.data[idx] = lerpChannel(topColor.r, bottomColor.r, ratio);
    this.bitmap.data[idx + 1] = lerpChannel(topColor.g, bottomColor.g, ratio);
    this.bitmap.data[idx + 2] = lerpChannel(topColor.b, bottomColor.b, ratio);
    this.bitmap.data[idx + 3] = lerpChannel(topColor.a, bottomColor.a, ratio);
  });
}

function createEllipse(width, height, color) {
  const image = new Jimp(width, height, 0x00000000);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const radiusX = Math.max(1, width / 2);
  const radiusY = Math.max(1, height / 2);

  image.scan(0, 0, width, height, function scanPixel(x, y, idx) {
    const dx = (x - centerX) / radiusX;
    const dy = (y - centerY) / radiusY;

    if ((dx * dx) + (dy * dy) <= 1) {
      this.bitmap.data[idx] = color.r;
      this.bitmap.data[idx + 1] = color.g;
      this.bitmap.data[idx + 2] = color.b;
      this.bitmap.data[idx + 3] = color.a;
    }
  });

  return image;
}

function getOpaqueBounds(image, alphaThreshold = 8) {
  const { width, height, data } = image.bitmap;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) * 4;
      const alpha = data[idx + 3];

      if (alpha > alphaThreshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width, height };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function cropToOpaque(image) {
  const bounds = getOpaqueBounds(image);
  return image.clone().crop(bounds.x, bounds.y, bounds.width, bounds.height);
}

function scaleToFit(image, maxWidth, maxHeight) {
  const ratio = Math.min(maxWidth / image.bitmap.width, maxHeight / image.bitmap.height);
  return image.clone().scale(ratio, Jimp.RESIZE_BICUBIC);
}

function compositeCentered(base, layer, offsetX = 0, offsetY = 0) {
  const x = Math.round((base.bitmap.width - layer.bitmap.width) / 2 + offsetX);
  const y = Math.round((base.bitmap.height - layer.bitmap.height) / 2 + offsetY);
  base.composite(layer, x, y);
}

function createBackground(size) {
  const background = new Jimp(size, size, 0x00000000);
  fillGradient(background, BACKGROUND_TOP, BACKGROUND_BOTTOM);

  const glow = createEllipse(Math.round(size * 0.66), Math.round(size * 0.66), { r: 255, g: 255, b: 255, a: 38 })
    .blur(Math.max(18, Math.round(size * 0.02)));
  compositeCentered(background, glow, 0, Math.round(size * 0.02));

  const plate = createEllipse(Math.round(size * 0.72), Math.round(size * 0.72), PLATE_COLOR);
  compositeCentered(background, plate, 0, Math.round(size * 0.03));

  const centerHighlight = createEllipse(Math.round(size * 0.52), Math.round(size * 0.52), { r: 255, g: 255, b: 255, a: 24 })
    .blur(Math.max(10, Math.round(size * 0.012)));
  compositeCentered(background, centerHighlight, 0, Math.round(size * 0.01));

  return background;
}

function createShadow(size) {
  return createEllipse(
    Math.round(size * 0.43),
    Math.round(size * 0.11),
    SHADOW_COLOR
  ).blur(Math.max(8, Math.round(size * 0.018)));
}

function renderFullIcon(source) {
  const icon = createBackground(MASTER_SIZE);
  const fittedSource = scaleToFit(source, MASTER_SIZE * 0.62, MASTER_SIZE * 0.68);
  const shadow = createShadow(MASTER_SIZE);

  compositeCentered(icon, shadow, 0, Math.round(MASTER_SIZE * 0.235));
  compositeCentered(icon, fittedSource, 0, Math.round(MASTER_SIZE * 0.025));

  return icon;
}

function renderAdaptiveForeground(source) {
  const foreground = new Jimp(MASTER_SIZE, MASTER_SIZE, 0x00000000);
  const fittedSource = scaleToFit(source, MASTER_SIZE * 0.56, MASTER_SIZE * 0.62);

  compositeCentered(foreground, fittedSource, 0, Math.round(MASTER_SIZE * 0.02));

  return foreground;
}

function renderMonochromeForeground(source) {
  const monochromeSource = source.clone();

  monochromeSource.scan(0, 0, monochromeSource.bitmap.width, monochromeSource.bitmap.height, function scanPixel(x, y, idx) {
    const alpha = this.bitmap.data[idx + 3];

    this.bitmap.data[idx] = 255;
    this.bitmap.data[idx + 1] = 255;
    this.bitmap.data[idx + 2] = 255;
    this.bitmap.data[idx + 3] = alpha;
  });

  return renderAdaptiveForeground(monochromeSource);
}

async function writeOutputs(master, outputs, outDir) {
  for (const output of outputs) {
    const outPath = path.join(outDir, output.name);
    console.log(`Generating ${output.name} (${output.size}x${output.size})`);

    await master
      .clone()
      .resize(output.size, output.size, Jimp.RESIZE_BICUBIC)
      .writeAsync(outPath);
  }
}

async function generate(inputPath) {
  const outDir = path.join(__dirname, '..', 'assets', 'images');
  await fs.promises.mkdir(outDir, { recursive: true });

  const source = cropToOpaque(await Jimp.read(inputPath));
  const fullIcon = renderFullIcon(source);
  const adaptiveBackground = createBackground(MASTER_SIZE);
  const adaptiveForeground = renderAdaptiveForeground(source);
  const monochromeForeground = renderMonochromeForeground(source);

  await writeOutputs(
    fullIcon,
    [
      { name: 'app-icon.png', size: 1024 },
      { name: 'android-icon-512.png', size: 512 },
      { name: 'ios-icon-180.png', size: 180 },
      { name: 'ios-icon-120.png', size: 120 },
      { name: 'favicon.png', size: 96 }
    ],
    outDir
  );

  await writeOutputs(
    adaptiveBackground,
    [{ name: 'android-icon-background.png', size: 432 }],
    outDir
  );

  await writeOutputs(
    adaptiveForeground,
    [{ name: 'app-icon-foreground.png', size: 432 }],
    outDir
  );

  await writeOutputs(
    monochromeForeground,
    [{ name: 'android-icon-monochrome.png', size: 432 }],
    outDir
  );

  console.log('All icons generated into', outDir);
}

const input = process.argv[2] || path.join(__dirname, '..', 'assets', 'images', 'login-logo.png');
if (!fs.existsSync(input)) {
  console.error('Source image not found:', input);
  console.error('Place your source image at', input, 'or pass a path as the first argument. Use a high-resolution PNG ideally with transparent background.');
  process.exit(2);
}

generate(input).catch(err => { console.error(err); process.exit(1); });
