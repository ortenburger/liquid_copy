import type { PostVariant, PublishRecord } from "../../types/index.js";

export class NotImplementedError extends Error {
  constructor(platform: string) {
    super(
      `Publishing adapter for ${platform} is not configured: API credentials unavailable`,
    );
    this.name = "NotImplementedError";
  }
}

export interface PlatformAdapter {
  readonly platform: string;
  publish(variant: PostVariant): Promise<PublishRecord>;
}

export function createStubPublishRecord(
  variant: PostVariant,
  overrides: Partial<PublishRecord> = {},
): PublishRecord {
  return {
    id: overrides.id ?? cryptoRandomId(),
    postVariantId: variant.id,
    hypothesisId: variant.hypothesisId,
    platform: variant.platform,
    scheduledAt: overrides.scheduledAt ?? new Date().toISOString(),
    publishedAt: overrides.publishedAt,
    status: overrides.status ?? "queued",
    retryAttempts: overrides.retryAttempts ?? 0,
    retainUntil: overrides.retainUntil,
  };
}

function cryptoRandomId(): string {
  return `pub_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Factory for stub adapters that throw NotImplementedError so retry/failure
 * paths remain testable when credentials are unavailable.
 */
export function createCredentialStubAdapter(
  platform: PlatformAdapter["platform"],
): PlatformAdapter {
  return {
    platform,
    async publish(_variant: PostVariant): Promise<PublishRecord> {
      void _variant;
      throw new NotImplementedError(platform);
    },
  };
}
