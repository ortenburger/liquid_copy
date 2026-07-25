import { NextResponse } from "next/server";
import {
  mergeBrandFill,
  scrapeBrandFromUrl,
} from "@/lib/firecrawl-brand";
import type { BrandConfig } from "@/types/brand";
import { DEFAULT_BRAND } from "@/types/brand";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      url?: string;
      apiKey?: string;
      /** Current wizard state — used so we only fill blanks. */
      current?: Partial<BrandConfig>;
    };

    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      return NextResponse.json(
        { ok: false, error: "url is required" },
        { status: 400 },
      );
    }

    const scraped = await scrapeBrandFromUrl({
      url,
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
    });

    if (!scraped.ok) {
      return NextResponse.json(
        { ok: false, error: scraped.error, brand: null, filled: [] },
        { status: 422 },
      );
    }

    const current: BrandConfig = {
      ...DEFAULT_BRAND,
      ...body.current,
      colors: { ...DEFAULT_BRAND.colors, ...body.current?.colors },
      fonts: { ...DEFAULT_BRAND.fonts, ...body.current?.fonts },
      styleKeywords: body.current?.styleKeywords ?? [],
      customFonts: body.current?.customFonts ?? [],
      name: body.current?.name ?? "",
      logoPath: body.current?.logoPath ?? null,
      websiteUrl: body.current?.websiteUrl ?? "",
      createdAt: body.current?.createdAt ?? "",
      updatedAt: body.current?.updatedAt ?? "",
    };

    const { brand, filled } = mergeBrandFill(current, scraped.patch);

    return NextResponse.json({
      ok: true,
      brand,
      filled,
      message:
        filled.length === 0
          ? "Nothing to fill — your existing brand fields were kept."
          : `Filled ${filled.length} empty field${filled.length === 1 ? "" : "s"} from the site.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message, brand: null, filled: [] },
      { status: 500 },
    );
  }
}
