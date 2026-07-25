import type { PlatformAdapter } from "./types.js";
import { createCredentialStubAdapter } from "./types.js";

export const youtubeShortsAdapter: PlatformAdapter =
  createCredentialStubAdapter("youtube_shorts");
