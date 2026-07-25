import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
import logo from "../assets/logo.png";
import logoNav from "../assets/logo-nav.png";
import "./Landing.css";

export function Landing() {
  return (
    <div className="landing">
      <div className="landing-atmosphere" aria-hidden />
      <header className="landing-nav container">
        <Link to="/" className="landing-mark" aria-label="Liquid Copy home">
          <img src={logoNav} alt="" className="landing-mark-img" />
        </Link>
        <Link to="/app" className="landing-nav-link">
          Open workspace
        </Link>
      </header>

      <main className="landing-hero container stagger-in">
        <h1 className="landing-brand">
          <img src={logo} alt="Liquid Copy" className="landing-brand-img" />
        </h1>
        <p className="landing-headline">Content that learns as it ships.</p>
        <p className="landing-support">
          A continuous experimentation OS — from company context to hypothesis,
          carousel, publish, and measured learning.
        </p>
        <div className="landing-cta">
          <Link to="/app">
            <Button variant="accent">Enter workspace</Button>
          </Link>
          <a
            href="https://github.com/ortenburger/liquid_copy"
            target="_blank"
            rel="noreferrer"
          >
            <Button variant="ghost">View repository</Button>
          </a>
        </div>
      </main>
    </div>
  );
}
