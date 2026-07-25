import { NavLink, Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { useSimpleUi } from "../../lib/hooks";
import {
  isFullOnlyPath,
  isSimpleOnlyPath,
  navForMode,
} from "../../lib/simple-ui-nav";
import logoNav from "../../assets/logo-nav.png";
import "./Shell.css";

function GearIcon() {
  return (
    <svg
      className="shell-gear"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.36.3.8.48 1.27.51H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function WorkspaceShell() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const simpleUi = useSimpleUi();
  const nav = navForMode(simpleUi);
  const mainNav = nav.filter((item) => !item.icon);
  const iconNav = nav.filter((item) => item.icon);
  const embed = pathname.startsWith("/app/carousels");

  useEffect(() => {
    if (simpleUi && isFullOnlyPath(pathname)) {
      navigate("/app", { replace: true });
      return;
    }
    if (!simpleUi && isSimpleOnlyPath(pathname)) {
      navigate("/app", { replace: true });
    }
  }, [simpleUi, pathname, navigate]);

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
            {mainNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end ?? false}
                className={({ isActive }) =>
                  `shell-link ${isActive ? "is-active" : ""}`
                }
                onClick={() => setOpen(false)}
              >
                {item.label}
              </NavLink>
            ))}
            {iconNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end ?? false}
                title={item.label}
                aria-label={item.label}
                className={({ isActive }) =>
                  `shell-link shell-link--icon ${isActive ? "is-active" : ""}`
                }
                onClick={() => setOpen(false)}
              >
                {item.icon === "gear" ? <GearIcon /> : item.label}
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
