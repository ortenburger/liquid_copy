import type { PlatformAdapter } from "./types.js";
import { createCredentialStubAdapter } from "./types.js";

export const linkedinAdapter: PlatformAdapter =
  createCredentialStubAdapter("linkedin");
