import { useMemo, useState } from "react";
import { ArrowRight, Briefcase, Check, EnvelopeSimple, FileText, GlobeHemisphereWest, List, Phone, Quotes, ShieldCheck, Student, X } from "@phosphor-icons/react";
import { articles } from "./articles";

const phoneDisplay = "+64 21 021 68888";
const phoneHref = "tel:+64210216888";
const email = "dave@davetaxnz.nz";

function ActionLink({ href, children, secondary = false, external = false }) {
  return <a className={secondary ? "button button--secondary" : "button"} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{children}</a>;
}

function Header({ menuOpen, setMenuOpen }) {
  const close = () => setMenuOpen(false);
  return <header className="site-header">
    <a className="brand" href="#top" aria-label="Dave Ananth home" onClick={close}><img src="assets/dave-ananth-logo.webp" alt="Dave Ananth, Tax Barrister" width="150" height="130" /></a>
    <button className="menu-button" type="button" aria-expanded={menuOpen} aria-controls="site-nav" onClick={() => setMenuOpen(!menuOpen)}><span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>{menuOpen ? <X size={26} /> : <List size={28} />}</button>
    <nav id="site-nav" className={menuOpen ? "nav nav--open" : "nav"} aria-label="Primary navigation">
      <a href="#about" onClick={close}>About Dave</a><a href="#expertise" onClick={close}>Expertise</a><a href="#stories" onClick={close}>Client stories</a><a href="#insights" onClick={close}>Articles &amp; media</a><a href="#contact" onClick={close}>Contact</a>
    </nav>
    <ActionLink href="https://davetaxnz.nz/book-a-consultation/" external>Book a free consultation</ActionLink>
  </header>;
}

function Hero() {
  return <section className="hero" aria-labelledby="hero-title">
    <div className="hero__copy"><p className="eyebrow">Former IRD prosecutor · 35+ years in tax law</p><h1 id="hero-title">When IRD pressure rises, experience matters.</h1><div className="accent-rule" aria-hidden="true" /><p className="hero__lead">Dave Ananth resolves student loan debt, tax disputes and enforcement action with clear, practical advice.</p>
      <a className="alert-link" href="#expertise"><ShieldCheck size={35} weight="light" /><span>Received an IRD letter or worried about returning to New Zealand?</span><ArrowRight size={20} /></a>
      <div className="button-row"><ActionLink href="https://davetaxnz.nz/book-a-consultation/" external>Book a free consultation</ActionLink><ActionLink href={phoneHref} secondary><Phone size={21} weight="fill" /> Call Dave</ActionLink></div>
    </div>
    <div className="hero__portrait"><img src="assets/dave-ananth-hero.webp" alt="Dave Ananth in barrister attire" width="1280" height="1198" /><div className="portrait-caption"><strong>Dave Ananth</strong><span>Tax Barrister</span><small>Former IRD prosecutor</small></div></div>
  </section>;
}

function Proof() {
  return <section id="about" className="proof section-shell"><div className="quote-mark"><Quotes size={45} weight="fill" aria-hidden="true" /></div><blockquote>“Securing expert tax advice early is critical. Once Inland Revenue initiates contact, delays can lead to escalation, increased penalties and restricted relief options.”</blockquote>
    <div className="proof__identity"><img src="assets/dave-ananth-profile.webp" alt="Dave Ananth" width="1280" height="1280" /><p><strong>Dave Ananth</strong><span>Partner, Meridian Partners</span></p></div>
    <div className="proof__media"><img src="assets/media-lockup.png" alt="As seen in Newstalk ZB, Stuff, NZ Lawyer and The Post" width="402" height="85" /></div>
  </section>;
}

const expertise = [
  { icon: Student, title: "Student loan negotiations", text: "Support for overseas borrowers facing compounding interest, penalties, enforcement or concerns about returning to New Zealand.", href: "https://davetaxnz.nz/student-loan-negotiations/" },
  { icon: FileText, title: "IRD disputes & tax debt", text: "Strategic advice on tax arrears, investigations, statutory demands, payment arrangements, remission and enforcement action.", href: "https://davetaxnz.nz/ird-disputes-tax-penalties-negotiation/" },
  { icon: Briefcase, title: "Business tax matters", text: "Practical, commercially aware advice for GST, PAYE, income tax, unfiled returns and business rehabilitation.", href: "mailto:dave@davetaxnz.nz?subject=Business%20tax%20matter" },
];

function Expertise() {
  return <section id="expertise" className="expertise section-shell section-pad"><div className="section-heading"><p className="eyebrow eyebrow--red">Expertise</p><h2>A direct route through difficult IRD matters.</h2><p>Dave works as a strategic buffer between you and Inland Revenue—assessing risk, preparing the case and leading negotiations.</p></div>
    <div className="expertise-grid">{expertise.map(({ icon: Icon, title, text, href }, index) => <a className="expertise-item" href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" key={title}><span className="expertise-item__number">0{index + 1}</span><Icon size={34} weight="light" /><h3>{title}</h3><p>{text}</p><span className="text-link">Learn more <ArrowRight size={18} /></span></a>)}</div>
  </section>;
}

function Stories() {
  return <section id="stories" className="stories"><div className="section-shell stories__inner"><div><p className="eyebrow eyebrow--gold">Client story</p><h2>“Within just two days, the entire process was turned around.”</h2></div><div className="story-copy"><p>After decades of stress over an unresolved student loan, Dave handled the paperwork and IRD communication, helping the client reach a resolution within days.</p><p className="story-credit"><strong>Jana R</strong><span>Student loan client · June 2025</span></p><a className="text-link text-link--light" href="https://davetaxnz.nz/testimonials/" target="_blank" rel="noreferrer">Read client experiences <ArrowRight size={18} /></a></div></div></section>;
}

function Insights() {
  const [filter, setFilter] = useState("All");
  const filters = ["All", "Student loans", "IRD", "Tax", "In the media"];
  const visible = useMemo(() => filter === "All" ? articles : articles.filter((article) => filter === "In the media" ? article.type !== "By Dave" : article.category === filter), [filter]);
  return <section id="insights" className="insights section-shell section-pad"><div className="insights__intro"><p className="eyebrow eyebrow--red">Latest thinking</p><h2>Articles &amp; media</h2><p>Regularly updated guidance on IRD, tax and student loan issues—written by Dave or featuring his commentary.</p></div>
    <div className="filters" aria-label="Filter articles">{filters.map((item) => <button type="button" className={filter === item ? "filter filter--active" : "filter"} onClick={() => setFilter(item)} aria-pressed={filter === item} key={item}>{item}</button>)}</div>
    <div className="article-grid">{visible.map((article) => <article className="article-card" key={article.url}><div className="article-meta"><span>{article.category}</span><time>{article.date}</time></div><h3>{article.title}</h3><p>{article.summary}</p><span className="article-type">{article.type}</span><a className="text-link" href={article.url} target="_blank" rel="noreferrer">Read article <ArrowRight size={18} /></a></article>)}</div>
  </section>;
}

function Contact() {
  return <section id="contact" className="contact"><div className="section-shell contact__grid"><div><p className="eyebrow eyebrow--gold">Contact Dave</p><h2>Take the first step before the matter escalates.</h2><p>Initial consultations are free and confidential. Tell Dave what has happened and he will explain the practical next step.</p></div>
    <div className="contact__links"><a href={phoneHref}><Phone size={27} weight="fill" /><span><small>Call Dave directly</small>{phoneDisplay}</span></a><a href={`mailto:${email}`}><EnvelopeSimple size={27} weight="fill" /><span><small>Email Dave</small>{email}</span></a><a href="https://www.google.com/maps/search/?api=1&query=97+Great+South+Road+Epsom+Auckland+1051" target="_blank" rel="noreferrer"><GlobeHemisphereWest size={27} /><span><small>Auckland office</small>97 Great South Road, Epsom</span></a></div>
    <div className="contact__action"><Check size={28} weight="bold" /><p>Free 15-minute initial consultation</p><ActionLink href="https://davetaxnz.nz/book-a-consultation/" external>Book a consultation</ActionLink></div>
  </div></section>;
}

function Footer() {
  return <footer className="footer section-shell"><img src="assets/dave-ananth-logo.webp" alt="Dave Ananth Tax Barrister" width="120" height="105" /><p>Tax Barrister specialising in student loan and tax debt negotiations. Former IRD prosecutor with 35+ years’ experience.</p><div><a href="https://mplaw.nz/about-meridian-partners/dave-ananth/" target="_blank" rel="noreferrer">Meridian Partners</a><a href="https://www.linkedin.com/in/dave-ananth-6310b023/" target="_blank" rel="noreferrer">LinkedIn</a><a href={`mailto:${email}`}>Email</a></div><small>© 2026 Dave Ananth Tax Services. Information on this site is general and is not legal advice.</small></footer>;
}

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  return <><a className="skip-link" href="#main">Skip to content</a><div id="top" className="dark-shell"><Header menuOpen={menuOpen} setMenuOpen={setMenuOpen} /><main id="main"><Hero /></main></div><Proof /><Expertise /><Stories /><Insights /><Contact /><Footer /></>;
}
