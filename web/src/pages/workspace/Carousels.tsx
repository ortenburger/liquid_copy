import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Progress } from "../../components/ui/Progress";
import {
  fetchOpenCarousels,
  openCarouselEditorUrl,
  type OpenCarouselSummary,
} from "../../lib/open-carousel";
import { loadSettings } from "../../lib/settings";
import "./workspace.css";
import "./Carousels.css";

type StudioView = "home" | string;

export function CarouselsPage() {
  const settings = loadSettings();
  const baseUrl = settings.openCarouselBaseUrl || "http://localhost:3000";

  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [carousels, setCarousels] = useState<OpenCarouselSummary[]>([]);
  const [view, setView] = useState<StudioView>("home");

  const iframeSrc =
    view === "home" ? baseUrl.replace(/\/$/, "") : openCarouselEditorUrl(baseUrl, view);

  const refresh = useCallback(async () => {
    setBusy(true);
    const result = await fetchOpenCarousels(baseUrl);
    setOk(result.ok);
    setMessage(result.message);
    setCarousels(result.carousels);
    setBusy(false);
  }, [baseUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="carousels-page">
      <header className="carousels-toolbar">
        <div className="carousels-toolbar-copy">
          <p className="eyebrow">Carousel studio</p>
          <h1 className="page-title carousels-title">Open Carrusel</h1>
        </div>
        <div className="carousels-toolbar-actions">
          {ok === true ? (
            <Badge tone="active">Connected</Badge>
          ) : ok === false ? (
            <Badge tone="failed">Offline</Badge>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={() => void refresh()}>
            Refresh
          </Button>
          <Button
            variant={view === "home" ? "primary" : "ghost"}
            onClick={() => setView("home")}
          >
            Studio home
          </Button>
          <Link to="/app/settings">
            <Button variant="ghost">URL settings</Button>
          </Link>
        </div>
      </header>

      <Progress active={busy} label="Syncing carousels" />

      {ok === false ? (
        <p className="error-banner carousels-banner">
          {message} Configure the studio URL in{" "}
          <Link to="/app/settings">Settings</Link>, then start Open Carrusel with{" "}
          <code>cd open-carrusel && npm run dev</code>.
        </p>
      ) : null}

      <div className="carousels-layout">
        <aside className="carousels-sidebar" aria-label="Carousel library">
          <div className="carousels-sidebar-head">
            <span className="panel-title">Library</span>
            <span className="panel-meta">
              {carousels.length} item{carousels.length === 1 ? "" : "s"}
            </span>
          </div>
          {message && ok ? (
            <p className="carousels-sidebar-note">{message}</p>
          ) : null}
          <ul className="carousels-list">
            {carousels.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`carousels-list-item ${view === c.id ? "is-active" : ""}`}
                  onClick={() => setView(c.id)}
                >
                  <span className="carousels-list-name">{c.name}</span>
                  <span className="carousels-list-meta">
                    {c.slideCount} slide{c.slideCount === 1 ? "" : "s"} · {c.aspectRatio}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {carousels.length === 0 && ok ? (
            <p className="carousels-sidebar-empty">
              No carousels yet — create one in the studio on the right.
            </p>
          ) : null}
        </aside>

        <div className="carousels-stage">
          <iframe
            key={iframeSrc}
            className="carousels-frame"
            title="Open Carrusel inside Liquid Copy"
            src={iframeSrc}
            allow="clipboard-read; clipboard-write"
          />
        </div>
      </div>
    </div>
  );
}
