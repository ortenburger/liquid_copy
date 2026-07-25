export type { PlatformAdapter } from "./types.js";
export {
  NotImplementedError,
  createCredentialStubAdapter,
  createStubPublishRecord,
} from "./types.js";

export { instagramAdapter } from "./instagram.js";
export { tiktokAdapter } from "./tiktok.js";
export { linkedinAdapter } from "./linkedin.js";
export { facebookAdapter } from "./facebook.js";
export { pinterestAdapter } from "./pinterest.js";
export { etsyAdapter } from "./etsy.js";
export { xAdapter } from "./x.js";
export { threadsAdapter } from "./threads.js";
export { youtubeShortsAdapter } from "./youtube-shorts.js";

import { instagramAdapter } from "./instagram.js";
import { tiktokAdapter } from "./tiktok.js";
import { linkedinAdapter } from "./linkedin.js";
import { facebookAdapter } from "./facebook.js";
import { pinterestAdapter } from "./pinterest.js";
import { etsyAdapter } from "./etsy.js";
import { xAdapter } from "./x.js";
import { threadsAdapter } from "./threads.js";
import { youtubeShortsAdapter } from "./youtube-shorts.js";
import type { PlatformAdapter } from "./types.js";
import type { SocialPlatform } from "../../types/index.js";

const ADAPTERS: Record<SocialPlatform, PlatformAdapter> = {
  instagram: instagramAdapter,
  tiktok: tiktokAdapter,
  linkedin: linkedinAdapter,
  facebook: facebookAdapter,
  pinterest: pinterestAdapter,
  etsy: etsyAdapter,
  x: xAdapter,
  threads: threadsAdapter,
  youtube_shorts: youtubeShortsAdapter,
};

export function getPlatformAdapter(platform: SocialPlatform): PlatformAdapter {
  return ADAPTERS[platform];
}

/** Initialise all 9 adapters (smoke test helper). */
export function initialiseAllAdapters(): PlatformAdapter[] {
  return Object.values(ADAPTERS);
}
