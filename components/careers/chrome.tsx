import { BriefcaseBusiness } from "lucide-react";
export function Brand() {
  return (
    <a href="/" className="brand" aria-label="AI Case Leads careers home">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>
        AI CASE LEADS<span className="brand-caption">CAREERS</span>
      </span>
    </a>
  );
}
export function Header() {
  return (
    <header className="site-header">
      <div className="site-width header-inner">
        <Brand />
        <nav aria-label="Main navigation">
          <a href="/#positions">Opportunities</a>
          <a href="/#process">Our process</a>
          <a href="/team" className="team-link">
            <BriefcaseBusiness size={15} aria-hidden="true" /> Hiring team
          </a>
        </nav>
      </div>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-width footer-inner">
        <Brand />
        <p>Good people. Meaningful work.</p>
        <div>
          <a href="/privacy">Applicant privacy</a>
          <a href="/help">Application help</a>
          <a href="/team">Hiring team</a>
        </div>
        <span className="footer-copyright">
          © {new Date().getFullYear()} AI Case Leads
        </span>
      </div>
    </footer>
  );
}
export function PageChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
      {children}
      <Footer />
    </>
  );
}
