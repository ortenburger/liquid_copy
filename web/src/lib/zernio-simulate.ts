/**
 * Local simulated Zernio publishes — used when the real API is unavailable
 * or the operator explicitly chooses Simulate.
 */
import type { AnalyticsRow, ExperimentCard, SocialPlatform } from "./types";

const STORAGE_KEY = "liquid-copy.zernio-sim.v1";

export interface SimulatedZernioPublish {
  id: string;
  postVariantId: string;
  carouselId: string;
  name: string;
  platform: SocialPlatform | string;
  publishedAt: string;
  impressions: number;
  engagementRate: number;
  ctr: number;
  saves: number;
  shares: number;
  comments: number;
  captionPreview?: string;
}

function read(): SimulatedZernioPublish[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SimulatedZernioPublish[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items: SimulatedZernioPublish[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 40)));
}

export function listSimulatedPublishes(): SimulatedZernioPublish[] {
  return read();
}

export function recordSimulatedPublish(input: {
  carouselId: string;
  name: string;
  postVariantId: string;
  platform?: string;
  caption?: string;
}): SimulatedZernioPublish {
  const seed = [...input.carouselId].reduce((a, c) => a + c.charCodeAt(0), 0);
  const impressions = 1200 + (seed % 8800);
  const engagementRate = 0.018 + (seed % 40) / 1000;
  const ctr = 0.008 + (seed % 25) / 1000;
  const record: SimulatedZernioPublish = {
    id: `sim-${input.carouselId.slice(0, 12)}-${Date.now().toString(36)}`,
    postVariantId: input.postVariantId,
    carouselId: input.carouselId,
    name: input.name,
    platform: input.platform || "linkedin",
    publishedAt: new Date().toISOString(),
    impressions,
    engagementRate,
    ctr,
    saves: Math.round(impressions * 0.012),
    shares: Math.round(impressions * 0.004),
    comments: Math.round(impressions * 0.006),
    captionPreview: input.caption?.slice(0, 160),
  };
  write([record, ...read().filter((r) => r.carouselId !== input.carouselId)]);
  return record;
}

export function simulatedPublishesToAnalyticsRows(): AnalyticsRow[] {
  return read().map((r) => ({
    id: r.id,
    title: r.name,
    hook: r.captionPreview || r.name,
    platform: (r.platform as SocialPlatform) || "linkedin",
    status: "published",
    impressions: r.impressions,
    engagementRate: r.engagementRate,
    ctr: r.ctr,
    saves: r.saves,
    shares: r.shares,
    comments: r.comments,
    winner: r.engagementRate >= 0.035,
    note: `Simulated Zernio · ${r.postVariantId}`,
  }));
}

export function simulatedPublishesToExperimentCards(): ExperimentCard[] {
  return read().map((r) => ({
    id: r.id,
    title: r.name,
    hook: r.captionPreview || r.name,
    platform: (r.platform as SocialPlatform) || "linkedin",
    status: r.engagementRate >= 0.035 ? ("won" as const) : ("published" as const),
    updatedAt: r.publishedAt,
  }));
}
