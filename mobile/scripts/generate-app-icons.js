#!/usr/bin/env node
/** Generate Android/iOS app icons and splash screens from assets/logo.png. */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '../..');
const MOBILE = path.resolve(__dirname, '..');
const LOGO_SRC = path.join(ROOT, 'assets', 'logo.png');
const WWW_LOGO = path.join(MOBILE, 'www', 'img', 'logo.png');
const ANDROID_RES = path.join(MOBILE, 'android', 'app', 'src', 'main', 'res');
const IOS_ICON = path.join(
  MOBILE,
  'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'
);
const IOS_SPLASH_DIR = path.join(
  MOBILE,
  'ios/App/App/Assets.xcassets/Splash.imageset'
);

const BG = { r: 10, g: 14, b: 20, alpha: 1 };

const ANDROID_LAUNCHER = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

const ANDROID_SPLASH = {
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
};

async function fitLogoOnCanvas(logo, canvasSize, padding = 0.08) {
  const usable = Math.floor(canvasSize * (1 - padding * 2));
  const meta = await sharp(logo).metadata();
  const scale = Math.min(usable / meta.width, usable / meta.height);
  const w = Math.max(1, Math.round(meta.width * scale));
  const h = Math.max(1, Math.round(meta.height * scale));
  const resized = await sharp(logo).resize(w, h, { fit: 'inside' }).png().toBuffer();
  const x = Math.floor((canvasSize - w) / 2);
  const y = Math.floor((canvasSize - h) / 2);

  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: BG },
  })
    .composite([{ input: resized, left: x, top: y }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function splashWithLogo(logo, width, height) {
  const usable = Math.floor(Math.min(width, height) * 0.55);
  const meta = await sharp(logo).metadata();
  const scale = Math.min(usable / meta.width, usable / meta.height);
  const w = Math.max(1, Math.round(meta.width * scale));
  const h = Math.max(1, Math.round(meta.height * scale));
  const resized = await sharp(logo).resize(w, h, { fit: 'inside' }).png().toBuffer();
  const x = Math.floor((width - w) / 2);
  const y = Math.floor((height - h) / 2);

  return sharp({
    create: { width, height, channels: 4, background: BG },
  })
    .composite([{ input: resized, left: x, top: y }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function notificationIcon(logo, size = 96) {
  const { data, info } = await sharp(logo)
    .resize(size, size, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += info.channels) {
    const a = data[i + 3];
    if (a > 40) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.min(255, a);
    } else {
      data[i + 3] = 0;
    }
  }

  return sharp(data, { raw: { width: size, height: size, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function savePng(buffer, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  console.log(`  ${path.relative(MOBILE, filePath)}`);
}

async function main() {
  if (!fs.existsSync(LOGO_SRC)) {
    console.error(`ERROR: Logo not found at ${LOGO_SRC}`);
    process.exit(1);
  }

  const logo = fs.readFileSync(LOGO_SRC);
  const meta = await sharp(logo).metadata();
  console.log(`Using logo: ${LOGO_SRC} (${meta.width}x${meta.height})`);

  savePng(logo, WWW_LOGO);

  for (const [folder, size] of Object.entries(ANDROID_LAUNCHER)) {
    const base = path.join(ANDROID_RES, folder);
    const icon = await fitLogoOnCanvas(logo, size, 0.06);
    savePng(icon, path.join(base, 'ic_launcher.png'));
    savePng(icon, path.join(base, 'ic_launcher_round.png'));
    savePng(await fitLogoOnCanvas(logo, size, 0.12), path.join(base, 'ic_launcher_foreground.png'));
  }

  const notif = await notificationIcon(logo, 96);
  savePng(notif, path.join(ANDROID_RES, 'drawable-nodpi', 'ic_stat_icon.png'));
  savePng(notif, path.join(ANDROID_RES, 'drawable', 'ic_stat_icon.png'));

  for (const [folder, [w, h]] of Object.entries(ANDROID_SPLASH)) {
    savePng(await splashWithLogo(logo, w, h), path.join(ANDROID_RES, folder, 'splash.png'));
  }
  savePng(await splashWithLogo(logo, 480, 480), path.join(ANDROID_RES, 'drawable', 'splash.png'));

  savePng(await fitLogoOnCanvas(logo, 1024, 0.06), IOS_ICON);

  const iosSplash = await splashWithLogo(logo, 2732, 2732);
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    savePng(iosSplash, path.join(IOS_SPLASH_DIR, name));
  }

  console.log('Done — app icons and splash screens updated.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
