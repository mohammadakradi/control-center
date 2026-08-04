#!/usr/bin/env node
/**
 * Regenerates the installable-app icons from the single brand mark in `app/icon.svg`.
 *
 *   node infra/icons/generate.mjs
 *
 * The mark is a transparent ring+C glyph, which is wrong for an app icon — a dock or
 * Launchpad tile needs an opaque background, and Android's maskable icons get cropped to a
 * circle. So each output composes the *same* mark over the brand's dark radial background,
 * at a scale that suits its purpose. Nothing is hand-drawn twice: edit `app/icon.svg` and
 * re-run this.
 *
 * macOS only — it rasterizes through QuickLook (`qlmanage`), which is a WebKit renderer and
 * handles the mark's gradients and drop shadows correctly. There is no ImageMagick or
 * librsvg in this repo (or in the dev container), and the icons are committed, so this
 * script only needs to run when the brand mark changes.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const mark = readFileSync(join(repo, "app/icon.svg"), "utf8");

/** Everything inside the mark's root <svg> element — defs, gradients, paths. */
const inner = mark.slice(mark.indexOf(">", mark.indexOf("<svg")) + 1, mark.lastIndexOf("</svg>"));

/** The brand's dark radial background (declared in the mark but unused there). */
const BACKGROUND = `<radialGradient id="app-bg" cx="50%" cy="42%" r="75%">
      <stop offset="0%" stop-color="#121a26"/>
      <stop offset="55%" stop-color="#0c121c"/>
      <stop offset="100%" stop-color="#070b12"/>
    </radialGradient>`;

/** Compose the mark over an opaque tile. `scale` is the mark's share of the tile's width. */
function compose({ scale, radius }) {
  const offset = (600 * (1 - scale)) / 2;
  return `<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Agent Platform">
  <defs>
    ${BACKGROUND}
  </defs>
  <rect width="600" height="600" rx="${radius}" fill="url(#app-bg)"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${inner}</g>
</svg>
`;
}

const TARGETS = [
  // Rounded tile — what Chrome shows in the app list and the macOS Dock.
  { out: "public/icons/icon-192.png", size: 192, scale: 0.74, radius: 132 },
  { out: "public/icons/icon-512.png", size: 512, scale: 0.74, radius: 132 },
  // Maskable: full-bleed, mark well inside the 80%-diameter safe circle Android crops to.
  { out: "public/icons/icon-maskable-512.png", size: 512, scale: 0.56, radius: 0 },
  // iOS applies its own squircle mask, so this one must be square and full-bleed. It lives in
  // `public/` and is declared via `metadata.icons.apple`, NOT as `app/apple-icon.png`: that
  // file convention crashes metadata rendering on every page in this Next build (see CLAUDE.md).
  { out: "public/icons/apple-touch-icon-180.png", size: 180, scale: 0.72, radius: 0 },
];

/** macOS .icns for the Control Center.app bundle — what the Dock and Launchpad actually read.
 *  Built from the same mark: render each size QuickLook-style, then let iconutil pack them. */
function buildIcns(work) {
  const iconset = join(work, "Control Center.iconset");
  mkdirSync(iconset, { recursive: true });
  // The sizes iconutil expects; @2x variants are just the doubled pixel size.
  const sizes = [16, 32, 128, 256, 512];
  for (const size of sizes) {
    for (const scale of [1, 2]) {
      const px = size * scale;
      const src = join(work, `icns-${px}.svg`);
      // Full-bleed with rounded corners, like every other Mac app icon.
      writeFileSync(src, compose({ scale: 0.74, radius: 132 }));
      execFileSync("qlmanage", ["-t", "-s", String(px), "-o", work, src], { stdio: "ignore" });
      renameSync(
        join(work, `icns-${px}.svg.png`),
        join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
      );
    }
  }
  const out = join(repo, "public/icons/app.icns");
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", out]);
  console.log("public/icons/app.icns  (Dock / Launchpad)");
}

const work = mkdtempSync(join(tmpdir(), "app-icons-"));
try {
  for (const { out, size, scale, radius } of TARGETS) {
    const src = join(work, "tile.svg");
    writeFileSync(src, compose({ scale, radius }));
    execFileSync("qlmanage", ["-t", "-s", String(size), "-o", work, src], { stdio: "ignore" });
    const dest = join(repo, out);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(join(work, "tile.svg.png"), dest);
    console.log(`${out}  ${size}×${size}`);
  }
  buildIcns(work);
} finally {
  rmSync(work, { recursive: true, force: true });
}
