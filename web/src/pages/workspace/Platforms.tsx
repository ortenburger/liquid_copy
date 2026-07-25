import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Badge";
import { api } from "../../lib/api";
import { useAsyncAction, useWorkflowStatus } from "../../lib/hooks";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "../../lib/types";
import "./workspace.css";

export function PlatformsPage() {
  const status = useWorkflowStatus();
  const { busy, error, run } = useAsyncAction();
  const selected = new Set(status.platforms);

  function toggle(platform: SocialPlatform) {
    const next = new Set(selected);
    if (next.has(platform)) next.delete(platform);
    else next.add(platform);
    void run(() => api.setPlatforms([...next]));
  }

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">Publishing targets</p>
          <h1 className="page-title">Platforms</h1>
        </div>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            run(() => api.setPlatforms(["instagram", "linkedin", "tiktok"]))
          }
        >
          Reset defaults
        </Button>
      </header>

      {error ? <p className="error-banner">{error}</p> : null}

      <p className="page-lead">
        Select at least one channel. Content variants are validated against each
        platform’s constraints before publish.
      </p>

      <div className="chip-cloud">
        {SOCIAL_PLATFORMS.map((platform) => (
          <Chip
            key={platform}
            selected={selected.has(platform)}
            onClick={() => toggle(platform)}
          >
            {platform}
          </Chip>
        ))}
      </div>
    </div>
  );
}
