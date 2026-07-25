import type { PlatformAdapter } from "./types.js";
import { createCredentialStubAdapter } from "./types.js";

export const tiktokAdapter: PlatformAdapter =
  createCredentialStubAdapter("tiktok");
