import type { Article, Site } from "../data/schema";
import { newestArticleFirst } from "./article-date";

/**
 * Renders /llms.txt — a plain-text, link-first restatement of the page for
 * assistants and answer engines.
 *
 * Every line of prose comes from the content model. The only literals in this
 * file are Markdown structure (`#`, `>`, `-`); the section headings themselves
 * are the site's own eyebrows and headings, so the document cannot describe a
 * section the page does not have.
 */

/**
 * One published post from the `articles` collection, flattened to the fields
 * this document renders. Kept structural rather than importing the Astro
 * collection type so the renderer stays a pure function of plain data.
 */
export interface LlmsPost {
  title: string;
  /** Canonical on-site URL — absolute, already resolved through `base`. */
  url: string;
  excerpt: string;
  categories: string[];
  /** Publish date, wall clock, date precision. */
  published: string;
  /** Present only where the post is a repost of someone else's reporting. */
  attribution?: { source: string; originalUrl: string };
}

interface LlmsDocumentInput {
  site: Site;
  /** Reference records (src/data/articles.yaml) — the off-site media mentions. */
  articles: Article[];
  /** The site's own articles (src/content/articles/*.md), newest first. */
  posts: LlmsPost[];
  /** Resolves a site-relative path (e.g. "" or "#contact") to an absolute URL. */
  absolute: (path?: string) => string;
}

function oneLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

/**
 * Render governed text as a CommonMark literal. Escaping every ASCII
 * punctuation character closes links, images, autolinks, HTML, headings,
 * lists, emphasis and reference definitions without dropping the source text.
 * Unicode punctuation (the curly quotes and en dashes this site's copy uses)
 * stays ordinary text in CommonMark.
 */
export function escapeMarkdownLiteral(value: string): string {
  let escaped = "";
  for (const character of oneLine(value)) {
    const codePoint = character.codePointAt(0)!;
    const isAsciiPunctuation =
      (codePoint >= 0x21 && codePoint <= 0x2f) ||
      (codePoint >= 0x3a && codePoint <= 0x40) ||
      (codePoint >= 0x5b && codePoint <= 0x60) ||
      (codePoint >= 0x7b && codePoint <= 0x7e);
    escaped += isAsciiPunctuation ? `\\${character}` : character;
  }
  return escaped;
}

/**
 * Angle-bracket link destination. CommonMark allows `[text](<dest>)` for
 * destinations containing spaces or parentheses; a destination carrying `<`,
 * `>` or whitespace could break out of the link, so it fails the build instead.
 */
function destination(url: string): string {
  if (/[\s<>]/.test(url)) {
    throw new Error(`llms.txt refuses an unsafe link destination: ${url}`);
  }
  return `<${url}>`;
}

function link(label: string, url: string): string {
  return `[${escapeMarkdownLiteral(label)}](${destination(url)})`;
}

export function renderLlmsDocument({ site, articles, posts, absolute }: LlmsDocumentInput): string {
  const literal = escapeMarkdownLiteral;
  const { meta, brand, nav, hero, proof, expertise, story, insights, contact, footer } = site;
  const home = absolute();
  const sorted = [...articles].sort(newestArticleFirst);

  /**
   * A content-model href as an absolute URL. Every destination in this document
   * has to be absolute — an assistant reads llms.txt with no base document to
   * resolve against — so an internal route ("/student-loan-negotiations/") goes
   * through `absolute`, which applies the configured `base`. mailto:, tel: and
   * links to other sites are already absolute and pass through.
   */
  const target = (href: string) => (href.startsWith("/") ? absolute(href) : href);

  const lines = [
    `# ${literal(brand.name)}`,
    "",
    `> ${literal(meta.description)}`,
    "",
    `${literal(brand.tagline)}. ${literal(hero.eyebrow)}`,
    "",
    `- ${link(brand.name, home)}: ${literal(hero.headline)} ${literal(hero.lead)}`,
    "",
    `> ${literal(proof.quote)} — ${literal(proof.author.name)}, ${literal(proof.author.role)}`,
    "",

    `## ${literal(nav.ariaLabel)}`,
    "",
    ...nav.items.map((item) => `- ${link(item.label, absolute(item.href))}`),
    `- ${link(nav.cta.label, nav.cta.href)}`,
    "",

    `## ${literal(expertise.eyebrow)}`,
    "",
    literal(expertise.intro),
    "",
    ...expertise.items.map(
      (item) => `- ${link(item.title, target(item.href))}: ${literal(item.text)}`,
    ),
    "",

    `## ${literal(story.eyebrow)}`,
    "",
    literal(story.heading),
    "",
    `${literal(story.body)} — ${literal(story.credit.name)}, ${literal(story.credit.meta)}`,
    "",
    `- ${link(story.link.label, story.link.href)}`,
    "",

    `## ${literal(insights.heading)}`,
    "",
    literal(insights.intro),
    "",
    // The site's own articles, at their canonical on-site URLs, newest first.
    // The trailing parenthetical carries the categories, the publish date and —
    // where the post is a repost — a link to the original reporting under the
    // source's own name. Attribution is load-bearing: an assistant reading this
    // file must be able to tell whose reporting a post restates.
    ...posts.map((post) => {
      const facts = [...post.categories.map(literal), literal(post.published)];
      if (post.attribution) {
        facts.push(link(post.attribution.source, post.attribution.originalUrl));
      }
      return `- ${link(post.title, post.url)}: ${literal(post.excerpt)} (${facts.join("; ")})`;
    }),
    "",
    // Off-site reference records: media mentions and the client's own WordPress
    // copies. Listed after the canonical articles, never in place of them.
    ...sorted.map(
      (article) =>
        `- ${link(article.title, article.url)}: ${literal(article.summary)} (${literal(article.category)}; ${literal(article.type)}; ${literal(article.date)})`,
    ),
    "",

    `## ${literal(contact.eyebrow)}`,
    "",
    literal(contact.intro),
    "",
    ...contact.rows.map(
      (row) => `- ${link(row.label, row.href)}: ${literal(row.value)}`,
    ),
    `- ${link(contact.action.ctaLabel, contact.action.ctaHref)}: ${literal(contact.action.title)}`,
    "",

    `## ${literal(footer.logo.alt)}`,
    "",
    literal(footer.description),
    "",
    ...footer.links.map((item) => `- ${link(item.label, item.href)}`),
    "",
    literal(footer.legal),
    "",
  ];

  return lines.join("\n");
}
