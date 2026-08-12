import { useState } from "react";
import { ArrowRight, List, Phone, Quotes, Warning, X } from "@phosphor-icons/react";

const bookingUrl = "https://davetaxnz.nz/book-a-consultation/";
const phoneHref = "tel:+64210216888";

const columns = [
  {
    eyebrow: "Latest thinking",
    title: "Regularly updated insights on IRD, tax and student loan issues.",
    link: "View all articles",
    url: "https://davetaxnz.nz/articles-advice/",
    intro: true,
  },
  {
    eyebrow: "Student loans",
    title: "Returning to NZ with outstanding loans: what you need to know",
    date: "7 August 2026",
    text: "Key considerations if you’re coming back to New Zealand and have an outstanding student loan.",
    link: "Read more",
    url: "https://davetaxnz.nz/student-loan-negotiations/",
  },
  {
    eyebrow: "IRD",
    title: "Responding to IRD letters: timing is everything",
    date: "5 August 2026",
    text: "Why early engagement with the IRD can prevent escalation and protect your options.",
    link: "Read more",
    url: "https://davetaxnz.nz/ird-disputes-tax-penalties-negotiation/",
  },
  {
    eyebrow: "Tax",
    title: "Provisional tax: managing risk and cash flow",
    date: "1 August 2026",
    text: "Practical steps to stay compliant and avoid penalties when cash flow is tight.",
    link: "Read more",
    url: "https://davetaxnz.nz/articles-advice/",
  },
  {
    eyebrow: "In the media",
    title: "Interview: IRD disputes and the value of early resolution",
    date: "30 July 2026",
    text: "Dave Ananth on Newstalk ZB about resolving disputes before they escalate.",
    link: "Read more",
    url: "https://www.interest.co.nz/business/138466/dave-ananth-says-overseas-student-loan-problem-not-just-about-losing-money-its-also",
  },
];

function Header({ open, setOpen }) {
  const close = () => setOpen(false);
  return <header className="compact-header">
    <a href="#top" className="compact-logo" aria-label="Dave Ananth home" onClick={close}><img src="assets/dave-ananth-logo.webp" alt="Dave Ananth, Tax Barrister" /></a>
    <button className="compact-menu" type="button" aria-controls="compact-nav" aria-expanded={open} onClick={() => setOpen(!open)}><span className="sr-only">{open ? "Close menu" : "Open menu"}</span>{open ? <X size={25} /> : <List size={27} />}</button>
    <nav id="compact-nav" className={open ? "compact-nav compact-nav--open" : "compact-nav"} aria-label="Primary navigation">
      <a href="#about" onClick={close}>About Dave</a><span aria-hidden="true" />
      <a href="#insights" onClick={close}>Expertise</a><span aria-hidden="true" />
      <a href="https://davetaxnz.nz/testimonials/" target="_blank" rel="noreferrer">Client stories</a><span aria-hidden="true" />
      <a href="#insights" onClick={close}>Articles &amp; media</a><span aria-hidden="true" />
      <a href="mailto:dave@davetaxnz.nz">Contact</a>
    </nav>
    <a className="compact-book" href={bookingUrl} target="_blank" rel="noreferrer">Book a free consultation</a>
  </header>;
}

function Hero() {
  return <section className="compact-hero" aria-labelledby="hero-title">
    <div className="compact-copy">
      <h1 id="hero-title">When IRD pressure<br />rises, experience matters.</h1>
      <div className="short-rule" aria-hidden="true" />
      <p>Dave Ananth is a former IRD prosecutor with<br className="desktop-only" /> 35+ years’ experience resolving student loan<br className="desktop-only" /> debt, tax disputes and enforcement action.</p>
      <a className="compact-alert" href="https://davetaxnz.nz/ird-disputes-tax-penalties-negotiation/" target="_blank" rel="noreferrer"><span className="alert-icon"><Warning size={31} weight="light" /></span><strong>Received an IRD letter or worried about<br className="desktop-only" /> returning to New Zealand?</strong></a>
      <div className="compact-actions"><a className="primary-action" href={bookingUrl} target="_blank" rel="noreferrer">Book a free consultation</a><a className="secondary-action" href={phoneHref}><Phone size={20} weight="fill" />Call Dave</a></div>
    </div>
    <div className="compact-portrait"><img src="assets/dave-ananth-hero.webp" alt="Dave Ananth in barrister attire" /><div className="compact-caption"><strong>Dave Ananth</strong><span>Tax Barrister</span><small>Former IRD prosecutor</small></div></div>
  </section>;
}

function Evidence() {
  return <section id="about" className="evidence compact-inner">
    <Quotes className="evidence-quotes" size={38} weight="fill" aria-hidden="true" />
    <blockquote>“Securing expert tax advice early is critical. Once Inland Revenue (IRD)<br className="desktop-only" /> initiates contact, delays often lead to case escalation, increased penalties,<br className="desktop-only" /> and restricted relief options. By implementing a proactive strategy at the<br className="desktop-only" /> outset, complex IRD matters, including student loans, can often be<br className="desktop-only" /> resolved more efficiently and with better outcomes.”</blockquote>
    <div className="evidence-profile"><img src="assets/dave-ananth-profile.webp" alt="Dave Ananth" /><span>Dave Ananth<small>12 August 2026</small></span></div>
    <img className="media-lockup" src="assets/media-lockup.png" alt="As seen in Newstalk ZB, Stuff, NZ Lawyer and The Post" />
  </section>;
}

function Insights() {
  return <section id="insights" className="compact-insights compact-inner">{columns.map((item) => <article className={item.intro ? "insight insight--intro" : "insight"} key={item.eyebrow}>
    <p className="insight-eyebrow">{item.eyebrow}</p><div className="insight-rule" aria-hidden="true" /><h2>{item.title}</h2>{item.date && <time>{item.date}</time>}{item.text && <p className="insight-text">{item.text}</p>}<a href={item.url} target="_blank" rel="noreferrer">{item.link}<ArrowRight size={14} /></a>
  </article>)}</section>;
}

function ClosingBar() {
  return <section className="closing-bar"><div className="closing-inner"><a className="closing-call" href={phoneHref}><span><Phone size={23} weight="fill" /></span><p>Need to talk now?<small>Call Dave direct on <b>09 379 4126</b></small></p></a><p className="closing-promise"><em>Confidential. Strategic. Experienced.</em><small>Barrister services throughout New Zealand.</small></p><a className="closing-book" href={bookingUrl} target="_blank" rel="noreferrer">Book a free consultation</a></div></section>;
}

export function App() {
  const [open, setOpen] = useState(false);
  return <><a className="skip-link" href="#main">Skip to content</a><div id="top" className="presentation-canvas"><div className="hero-panel"><div className="compact-inner"><Header open={open} setOpen={setOpen} /><main id="main"><Hero /></main></div></div><div className="paper-panel"><Evidence /><Insights /></div><ClosingBar /></div></>;
}
