// @ts-check
/**
 * Brand asset generator — renders every PNG variant the app needs from
 * SVG source-of-truth files under assets/source/.
 *
 * Run via `npm run generate-assets`.
 *
 * Outputs (under assets/images/):
 *   icon.png                        — iOS app icon (1024×1024, opaque)
 *   splash-icon.png                 — Splash screen logo (1024×1024, transparent)
 *   android-icon-foreground.png     — Android adaptive icon foreground
 *   android-icon-background.png     — Android adaptive icon background (solid navy)
 *   android-icon-monochrome.png     — Android 13+ themed icon (white on transparent)
 *   favicon.png                     — Web favicon (48×48)
 *
 * iOS asset-catalog sync:
 *   The iOS app icon is ALSO mirrored into
 *   `ios/Companion/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png`
 *   so Xcode's target-icon preview + the build's runtime app icon both
 *   stay current after a brand refresh. Skipped silently if `ios/` doesn't
 *   exist (e.g., before the first `expo prebuild`).
 *
 * Android asset-catalog sync:
 *   NOT mirrored automatically. Android requires 5 density buckets
 *   (mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi) × 5 variants (launcher, round, fg, bg,
 *   monochrome) = 25 webp files. The canonical way to regenerate them is
 *   `npx expo prebuild --clean --platform android`, which uses Expo's
 *   tooling to do the resize + webp encoding correctly. Run that after
 *   changing the source SVGs.
 *
 * Discipline:
 *   - Source of truth is `assets/source/*.svg`. Edit those, then re-run.
 *   - All PNGs are generated. Manual hand-edits to assets/images/ will be
 *     overwritten on next run.
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "assets/source");
const OUT = resolve(ROOT, "assets/images");
const IOS_ASSET_CATALOG = resolve(
  ROOT,
  "ios/Companion/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png"
);

const NAVY = "#1E3A5F";

/**
 * @param {string} svgPath path under assets/source/
 * @returns {Promise<Buffer>} the raw SVG buffer
 */
async function loadSvg(svgPath) {
  return readFile(resolve(SRC, svgPath));
}

/**
 * Render an SVG to a PNG of the given size.
 *
 * @param {Buffer} svgBuffer raw SVG source
 * @param {number} size square dimensions
 * @param {object} [opts]
 * @param {string} [opts.background] If set, flattens transparency over this color (use for OPAQUE icons like the iOS app icon).
 * @returns {Promise<Buffer>} encoded PNG
 */
async function renderPng(svgBuffer, size, opts = {}) {
  let pipeline = sharp(svgBuffer, { density: 384 }).resize(size, size);
  if (opts.background) {
    pipeline = pipeline.flatten({ background: opts.background });
  }
  return pipeline.png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Render a solid-color square PNG.
 *
 * @param {string} color hex color (e.g. "#1E3A5F")
 * @param {number} size square dimensions
 * @returns {Promise<Buffer>} encoded PNG
 */
async function renderSolid(color, size) {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: color,
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function writePng(name, buffer) {
  const path = resolve(OUT, name);
  await writeFile(path, buffer);
  const sizeKb = (buffer.length / 1024).toFixed(1);
  console.log(`  ✓ ${name.padEnd(36)} ${sizeKb.padStart(7)} KB`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Generating assets from ${SRC}/ → ${OUT}/`);
  console.log("");

  const iconColor = await loadSvg("icon-color.svg");
  const iconForeground = await loadSvg("icon-foreground.svg");
  const iconMonochrome = await loadSvg("icon-monochrome.svg");
  const splash = await loadSvg("splash.svg");

  // iOS app icon — 1024×1024, opaque (Apple rejects transparency)
  const iconBuffer = await renderPng(iconColor, 1024, { background: NAVY });
  await writePng("icon.png", iconBuffer);

  // Mirror into the iOS asset catalog if `ios/` has been prebuilt. Without
  // this, Xcode keeps showing whatever icon was in the catalog at the time
  // of the first `expo prebuild` — even after a brand refresh in app.json.
  // Catalog absence is silently tolerated (pre-prebuild state).
  try {
    await access(dirname(IOS_ASSET_CATALOG));
    await writeFile(IOS_ASSET_CATALOG, iconBuffer);
    const sizeKb = (iconBuffer.length / 1024).toFixed(1);
    console.log(`  ✓ ios/AppIcon.appiconset (synced)         ${sizeKb.padStart(7)} KB`);
  } catch {
    // ios/ not prebuilt yet — skip. The first `expo prebuild` will copy
    // `assets/images/icon.png` into the catalog correctly.
  }

  // Splash screen — 1024×1024, transparent (app.json provides bg)
  await writePng("splash-icon.png", await renderPng(splash, 1024));

  // Android adaptive icon foreground — 1024×1024, transparent
  await writePng("android-icon-foreground.png", await renderPng(iconForeground, 1024));

  // Android adaptive icon background — 1024×1024, opaque navy
  await writePng("android-icon-background.png", await renderSolid(NAVY, 1024));

  // Android 13+ themed icon — 1024×1024, transparent (platform tints)
  await writePng("android-icon-monochrome.png", await renderPng(iconMonochrome, 1024));

  // Web favicon — 48×48 (browser tab; smaller than ICO standard so it
  // scales down cleanly to 16×16 / 32×32 device sizes)
  await writePng("favicon.png", await renderPng(iconColor, 48, { background: NAVY }));

  console.log("");
  console.log("Done. Verify in Expo Go (live reload picks up the new icon");
  console.log("on next dev-server restart) or rebuild with `eas build`.");
}

main().catch((err) => {
  console.error("[generate-assets] failed:", err);
  process.exitCode = 1;
});
