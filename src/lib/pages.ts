import { PAGE_SLUGS, type Page, type PageSection, type PageSlug } from "../data/schema";
import { sitePath } from "./urls";

/**
 * The migrated WordPress pages, as routes.
 *
 * `src/data/pages.yaml` carries all nine pages from davetaxnz.nz. Two of them
 * are already published by a page file of their own and MUST NOT be published a
 * second time by the dynamic route:
 *
 *  - `home` — src/pages/index.astro is the homepage. It is the Astro port of the
 *    original React `App()` and is the design the client signed off; the
 *    WordPress `home` record is the same page's *copy*, flattened by the
 *    extractor into 29 sections (a hero headline split across a heading and
 *    three ctas, the About pull quote, the Insights list). Rendering it through
 *    the generic section renderers would replace the signed-off homepage with a
 *    linear restatement of itself.
 *  - `articles-advice` — src/pages/articles/index.astro is that page. It already
 *    takes its title, meta description and category filter strip from this exact
 *    record, and fills the grid with the real `articles` collection. The record's
 *    own two sections are the heading and that filter list, so a second route at
 *    /articles-advice/ would be the same page minus every article.
 *
 * Everything else is published by src/pages/[slug].astro at /<slug>/.
 */
export const EXCLUDED_PAGE_SLUGS = ["home", "articles-advice"] as const;

const excluded = new Set<string>(EXCLUDED_PAGE_SLUGS);

/** The seven slugs src/pages/[slug].astro publishes, in pages.yaml order. */
export const ROUTED_PAGE_SLUGS: PageSlug[] = PAGE_SLUGS.filter((slug) => !excluded.has(slug));

/** The base-aware href for a migrated page — never hand-join "/" + slug. */
export function pagePath(slug: PageSlug): string {
  return sitePath(`${slug}/`);
}

/**
 * The base-less route shape the discovery surfaces want (src/lib/discovery.ts).
 * `absoluteUrl()` applies the configured `base` itself, so these must not carry
 * it — same contract as `articleRoute()`.
 */
export function pageRoutes(): string[] {
  return ROUTED_PAGE_SLUGS.map((slug) => `${slug}/`);
}

/* --------------------------------------------------------------------------
 * Section text
 * ------------------------------------------------------------------------ */

/**
 * A `body` string split the way the extractor wrote it: a blank line is a
 * paragraph break, a single newline is a hard line break the client typed.
 * Returns paragraphs, each already split into its lines — so a renderer can
 * emit <p> per paragraph and <br> between lines without ever re-flowing,
 * re-punctuating or trimming the client's copy beyond the surrounding
 * whitespace YAML itself introduces.
 */
export function toParagraphs(body: string): string[][] {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split("\n").filter((line) => line.trim() !== ""))
    .filter((lines) => lines.length > 0);
}

/* --------------------------------------------------------------------------
 * Page structure
 *
 * The extractor flattened each WordPress page into a single ordered list of
 * sections, which loses two things a rendered page needs back: which heading is
 * the page's own <h1>, and which headings are subordinate to which.
 * ------------------------------------------------------------------------ */

/** Heading level a section's heading renders at. `h1` is the masthead only. */
export type HeadingLevel = "h2" | "h3";

export interface Masthead {
  /** The page's <h1>. */
  heading: string;
  /**
   * `page.title` when it says something the <h1> does not. Several WordPress
   * titles are the heading again in a different case ("Testimonials" /
   * "TESTIMONIALS"), and an eyebrow that restates the heading is noise.
   */
  eyebrow?: string;
  /** The masthead section's own body, if it carried one (thanks-consult does). */
  lead?: string;
}

export interface PlannedSection {
  section: PageSection;
  /**
   * Heading level for `section.heading`.
   *
   * Reconstructs the source outline from the shape of the data: a `prose`
   * section with a heading and NO body is a divider in the original document
   * ("Why Choose Me", "Frequently Asked Questions"), and the headed sections
   * after it are its children. Everything else is a titled block.
   *
   * The one hard constraint is heading order: a page must never jump from the
   * <h1> straight to an <h3>, so the first heading of any kind is promoted to
   * <h2> whether or not a divider came first.
   */
  level: HeadingLevel;
  /** True for the heading-only `prose` sections described above. */
  divider: boolean;
}

export interface PagePlan {
  masthead: Masthead;
  /** Every section after the one the masthead consumed, in source order. */
  body: PlannedSection[];
}

/**
 * Split a page record into a masthead and a body.
 *
 * The masthead consumes the first section when it is a `prose` section with a
 * heading — which is how all seven routed pages open, because WordPress put the
 * page's own title block first. Nothing is dropped: that section's body, where
 * it has one, becomes the opening paragraph.
 *
 * When the first section is anything else the WordPress page title is the <h1>
 * and no section is consumed, so a future page edit can never silently lose its
 * first block.
 */
export function planPage(page: Page): PagePlan {
  const [first, ...rest] = page.sections;
  const opensWithHeading = first.kind === "prose" && first.heading !== undefined;

  const heading = opensWithHeading ? (first.heading as string) : page.title;
  const remaining = opensWithHeading ? rest : page.sections;

  const masthead: Masthead = {
    heading,
    eyebrow: sameText(page.title, heading) ? undefined : page.title,
    lead: opensWithHeading ? first.body : undefined,
  };

  let sawHeading = false;
  const body = remaining.map<PlannedSection>((section) => {
    const divider = section.kind === "prose" && section.heading !== undefined && !section.body;
    const level: HeadingLevel = divider || !sawHeading ? "h2" : "h3";
    if (section.heading !== undefined) sawHeading = true;
    return { section, level, divider };
  });

  return { masthead, body };
}

function sameText(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Consecutive `quote` sections collapsed into one group.
 *
 * /testimonials/ is 39 quotes in a row. Rendered one per full-measure block
 * that is 39 identical slabs and nothing can be scanned; rendered as one run it
 * is a grid, which is what the frozen sheet's `.article-grid` already is. Any
 * other kind passes through as a group of one, so source order is preserved
 * exactly.
 */
export type SectionGroup =
  | { kind: "quotes"; sections: PageSection[] }
  | { kind: "single"; entry: PlannedSection };

export function groupSections(body: PlannedSection[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  for (const entry of body) {
    if (entry.section.kind !== "quote") {
      groups.push({ kind: "single", entry });
      continue;
    }
    const last = groups.at(-1);
    if (last?.kind === "quotes") last.sections.push(entry.section);
    else groups.push({ kind: "quotes", sections: [entry.section] });
  }
  return groups;
}
