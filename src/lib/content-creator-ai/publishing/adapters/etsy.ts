import type { PlatformAdapter } from "./types.js";
import { createCredentialStubAdapter } from "./types.js";

export const etsyAdapter: PlatformAdapter =
  createCredentialStubAdapter("etsy");
