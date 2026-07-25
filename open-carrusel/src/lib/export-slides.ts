import { existsSync } from "node:fs";
import { readFile } from "fs/promises";
import path from "path";
import puppeteer, { type Browser } from "puppeteer";
import sharp from "sharp";
import { wrapSlideHtml, extractFontFamilies } from "./slide-html";
import { getInlinedFontCSS } from "./fonts";
import type { Slide, AspectRatio } from "@/types/carousel";
import { DIMENSIONS } from "@/types/carousel";

// Singleton browser with lifecycle management
let browser: Browser | null = null;
let exportCount = 0;
let browserUnavailable: string | null = null;
const MAX_EXPORTS_BEFORE_RESTART = 50;

function resolveChromeExecutable(): string | undefined {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((p) => existsSync(p));
}

async function getBrowser(): Promise<Browser> {
  if (browserUnavailable) {
    throw new Error(browserUnavailable);
  }
  if (browser && exportCount >= MAX_EXPORTS_BEFORE_RESTART) {
    await browser.close().catch(() => {});
    browser = null;
    exportCount = 0;
  }
  if (!browser || !browser.isConnected()) {
    const executablePath = resolveChromeExecutable();
    try {
      browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
      });
      exportCount = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      browserUnavailable =
        `Puppeteer Chrome unavailable (${msg.split("\n")[0]}). ` +
        `Install with: cd open-carrusel && npx puppeteer browsers install chrome`;
      throw new Error(browserUnavailable);
    }
  }
  return browser;
}

/**
 * Inline all image references in slide HTML.
 * Replaces /uploads/xxx.png paths with data: URIs.
 */
async function inlineImages(html: string): Promise<string> {
  const uploadDir = path.resolve(process.cwd(), "public");
  const imgRegex = /(?:src=["']|url\(["']?)(\/uploads\/[^"'\s)]+)/g;
  const matches = [...html.matchAll(imgRegex)];

  let result = html;
  for (const match of matches) {
    const imgPath = match[1];
    try {
      const fullPath = path.join(uploadDir, imgPath);
      const buffer = await readFile(fullPath);
      const ext = path.extname(imgPath).toLowerCase();
      const mime =
        ext === ".png"
          ? "image/png"
          : ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : "image/webp";
      const base64 = buffer.toString("base64");
      result = result.replace(imgPath, `data:${mime};base64,${base64}`);
    } catch {
      // Keep original path — Puppeteer can fetch from localhost
    }
  }

  return result;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Sharp/SVG fallback when Chrome/Puppeteer is not installed.
 * Good enough for Liquid Copy seeded text slides and Zernio media stubs.
 */
export async function exportSlideFallback(
  slide: Slide,
  aspectRatio: AspectRatio,
): Promise<Buffer> {
  const { width, height } = DIMENSIONS[aspectRatio];
  const text = htmlToPlainText(slide.html) || "Slide";
  const lines = wrapText(text, aspectRatio === "9:16" ? 28 : 36).slice(0, 14);
  const fontSize = aspectRatio === "9:16" ? 54 : 48;
  const lineHeight = fontSize * 1.25;
  const blockHeight = lines.length * lineHeight;
  const startY = Math.max(80, (height - blockHeight) / 2);

  const tspans = lines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      return `<tspan x="${width / 2}" y="${y}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0f1419"/>
  <rect x="48" y="48" width="${width - 96}" height="${height - 96}" rx="24" fill="#1a2332" stroke="#2d3a4d" stroke-width="2"/>
  <text fill="#f4f7fb" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle">${tspans}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text.slice(0, maxChars)];
}

async function exportSlideWithPuppeteer(
  slide: Slide,
  aspectRatio: AspectRatio,
): Promise<Buffer> {
  const { width, height } = DIMENSIONS[aspectRatio];

  const fontFamilies = extractFontFamilies(slide.html);
  const inlinedFontCss = await getInlinedFontCSS(fontFamilies);
  const inlinedHtml = await inlineImages(slide.html);
  const fullHtml = wrapSlideHtml(inlinedHtml, aspectRatio, {
    inlineFontCss: inlinedFontCss,
  });

  const br = await getBrowser();
  const page = await br.newPage();

  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(fullHtml, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page
      .waitForFunction(
        () =>
          document.fonts.ready.then(() =>
            [...document.fonts].every((f) => f.status === "loaded"),
          ),
        { timeout: 3000 },
      )
      .catch(() => undefined);

    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await new Promise((r) => setTimeout(r, 100));

    const screenshotBuffer = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width, height },
      omitBackground: false,
    });

    exportCount++;

    return sharp(screenshotBuffer).toColorspace("srgb").png().toBuffer();
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Export a single slide to PNG buffer.
 * Prefers Puppeteer; falls back to Sharp/SVG when Chrome is missing.
 */
export async function exportSlide(
  slide: Slide,
  aspectRatio: AspectRatio,
): Promise<Buffer> {
  try {
    return await exportSlideWithPuppeteer(slide, aspectRatio);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[export] Puppeteer failed, using Sharp fallback: ${msg}`);
    return exportSlideFallback(slide, aspectRatio);
  }
}

/**
 * Export all slides of a carousel to PNG buffers.
 * Processes up to 3 slides concurrently.
 */
export async function exportAllSlides(
  slides: Slide[],
  aspectRatio: AspectRatio,
  onProgress?: (current: number, total: number) => void,
): Promise<{ name: string; buffer: Buffer }[]> {
  const results: { name: string; buffer: Buffer }[] = [];
  const CONCURRENCY = 3;

  for (let i = 0; i < slides.length; i += CONCURRENCY) {
    const batch = slides.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (slide, batchIdx) => {
        const idx = i + batchIdx;
        const buffer = await exportSlide(slide, aspectRatio);
        onProgress?.(idx + 1, slides.length);
        return { name: `slide-${idx + 1}.png`, buffer };
      }),
    );
    results.push(...batchResults);
  }

  return results;
}
