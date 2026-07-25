import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
import "./Landing.css";

export function Landing() {
  return (
    <div className="landing">
      <div className="landing-atmosphere" aria-hidden />
      <header className="landing-nav container">
        <span className="landing-mark">Liquid Intelligence</span>
        <Link to="/app" className="landing-nav-link">
          Open workspace
        </Link>
      </header>

      <main className="landing-hero container stagger-in">
        <p className="landing-brand">Liquid Intelligence</p>
        <h1 className="landing-headline">Content that learns as it ships.</h1>
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
