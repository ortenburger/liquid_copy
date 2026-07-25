import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import logoNav from "../../assets/logo-nav.png";
import "./Shell.css";

const NAV = [
  { to: "/app", end: true, label: "Overview" },
  { to: "/app/checkpoints", label: "Checkpoints" },
  { to: "/app/experiments", label: "Experiments" },
  { to: "/app/knowledge", label: "Knowledge" },
  { to: "/app/platforms", label: "Platforms" },
  { to: "/app/carousels", label: "Carousels" },
  { to: "/app/settings", label: "Settings" },
] as const;

export function WorkspaceShell() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const embed = pathname.startsWith("/app/carousels");

  return (
    <div className="shell">
      <header className="shell-top">
        <div className="container shell-top-inner">
          <Link to="/" className="shell-brand" aria-label="Liquid Copy home">
            <img src={logoNav} alt="Liquid Copy" className="shell-brand-img" />
          </Link>
          <button
            type="button"
            className="shell-menu-btn"
            aria-expanded={open}
            aria-controls="shell-nav"
            onClick={() => setOpen((v) => !v)}
          >
            Menu
          </button>
          <nav id="shell-nav" className={`shell-nav ${open ? "is-open" : ""}`}>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={"end" in item ? item.end : false}
                className={({ isActive }) =>
                  `shell-link ${isActive ? "is-active" : ""}`
                }
                onClick={() => setOpen(false)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <Link to="/" className="shell-exit">
            <Button variant="ghost">Exit</Button>
          </Link>
        </div>
      </header>
      <main
        className={
          embed ? "shell-main shell-main--embed" : "shell-main container"
        }
      >
        <Outlet />
      </main>
    </div>
  );
}
