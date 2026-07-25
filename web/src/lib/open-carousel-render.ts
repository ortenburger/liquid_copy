/** Mirrors open-carrusel/src/types/carousel.ts DIMENSIONS + slide-html wrap. */

export type OpenCarouselAspectRatio = "1:1" | "4:5" | "9:16";

export const OPEN_CAROUSEL_DIMENSIONS: Record<
  OpenCarouselAspectRatio,
  { width: number; height: number }
> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

export function normalizeAspectRatio(value: string): OpenCarouselAspectRatio {
  if (value === "1:1" || value === "9:16") return value;
  return "4:5";
}

function extractFontFamilies(html: string): string[] {
  const families = new Set<string>();
  const regex = /font-family:\s*['"]?([^;'"}\n]+?)['"]?\s*[;}"]/g;
  let match: RegExpExecArray | null;
  const generics = new Set([
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "inherit",
    "initial",
    "unset",
  ]);
  while ((match = regex.exec(html)) !== null) {
    for (const part of match[1].trim().split(",")) {
      const name = part.trim().replace(/['"]/g, "");
      if (name && !generics.has(name.toLowerCase())) families.add(name);
    }
  }
  return Array.from(families);
}

/** Shared preview contract with Open Carrusel (iframe srcDoc). */
export function wrapSlideHtml(
  slideHtml: string,
  aspectRatio: OpenCarouselAspectRatio,
): string {
  const { width, height } = OPEN_CAROUSEL_DIMENSIONS[aspectRatio];
  const fontFamilies = extractFontFamilies(slideHtml);
  let fontBlock = "";
  if (fontFamilies.length > 0) {
    const params = fontFamilies
      .map((f) => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700;800`)
      .join("&");
    fontBlock = `<link href="https://fonts.googleapis.com/css2?${params}&display=swap" rel="stylesheet">`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${width}, initial-scale=1">
  ${fontBlock}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
  </style>
</head>
<body>
  ${slideHtml}
</body>
</html>`;
}
