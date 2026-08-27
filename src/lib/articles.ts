import { getCollection, type CollectionEntry } from "astro:content";
import { pages } from "./content";
import { sitePath } from "./urls";

/**
 * The `articles` content collection, as the pages actually consume it.
 *
 * Everything that is *derived* from an article — its route, its display date,
 * its card label, whether a curated `articles.yaml` entry now has an in-repo
 * page — is derived exactly once, here. The pages read; they do not decide.
 *
 * Nothing in this module produces user-visible prose. Display dates are
 * formatted from the frontmatter's own values in the site's existing
 * convention; every label the article surfaces render comes from
 * `site.articlePages` in src/data/site.yaml.
 */

export type ArticleEntry = CollectionEntry<"articles">;

/**
 * Month names, matching src/lib/article-date.ts. Both files render the same
 * "11 August 2026" convention `src/data/articles.yaml` already uses for its
 * governed display strings — article-date.ts parses that string, this file
 * produces it. Keeping the article surfaces on the same convention means the
 * homepage cards and the article index never show two date styles.
 */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * The WordPress origin these posts were migrated from — see
 * `generatedFrom` in src/data/article-migration-report.json
 * ("https://davetaxnz.nz/wp-json/wp/v2/posts").
 *
 * Used to decide whether a curated `src/data/articles.yaml` entry points at a
 * post that now has an in-repo page. Third-party media URLs (rnz.co.nz,
 * interest.co.nz, stuff.co.nz, …) never match and keep pointing outward, which
 * is the correct behaviour: those articles are hosted by the publisher and are
 * not ours to re-host.
 */
const MIGRATED_HOSTS: ReadonlySet<string> = new Set(["davetaxnz.nz", "www.davetaxnz.nz"]);

/**
 * Frontmatter dates are WordPress's NZ wall clock with no zone offset
 * ("2026-07-19T22:13:18"), so `z.coerce.date()` parses them as local time on
 * the build machine. Reading them back with the local getters returns the exact
 * wall clock that was written, whatever the build machine's zone — which is the
 * whole point of the extractor keeping them unnormalised. `toISOString()` and
 * `Intl` would both shift several late-evening posts onto the next day.
 *
 * CAVEAT the types do not tell you: the content layer serialises collection
 * data through its own JSON store, and a `z.coerce.date()` field comes back out
 * of that store as the ORIGINAL STRING ("2026-08-06T06:44:18"), not as a Date —
 * even though `entry.data.publishedAt` is typed `Date`. Anything that calls a
 * Date method on it straight from `getCollection` fails at build time with
 * "getTime is not a function". `publishedArticles()` below therefore revives
 * both timestamps once, at the single point every surface reads them through,
 * so the type and the runtime value finally agree.
 *
 * Reviving with `new Date(string)` is what preserves the wall clock: an
 * offset-free ISO string parses as local time, so the components read back
 * exactly as written.
 */
export function reviveDate(value: Date | string): Date {
  const revived = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(revived.getTime())) {
    throw new Error(`src/content/articles: unparseable frontmatter date ${JSON.stringify(value)}`);
  }
  return revived;
}

export function displayDate(value: Date): string {
  return `${value.getDate()} ${MONTHS[value.getMonth()]} ${value.getFullYear()}`;
}

/** The same wall-clock day as a machine-readable `<time datetime>` value. */
export function machineDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

/** Route of the article index. */
export function articlesIndexPath(): string {
  return sitePath("articles/");
}

/** Route of one article. `build.format` is "directory", hence the trailing slash. */
export function articlePath(slug: string): string {
  return sitePath(`articles/${slug}/`);
}

/**
 * Published articles, newest first.
 *
 * Two build-time guards, both fail-closed:
 *
 *  - The filename and the frontmatter `slug` must agree. They are two
 *    independent claims about the same permalink, and the route is built from
 *    the frontmatter; letting them drift would publish an article at an address
 *    nothing links to.
 *  - No two articles may claim the same slug. Astro would resolve the collision
 *    silently and one article would become unreachable.
 */
export async function publishedArticles(): Promise<ArticleEntry[]> {
  const entries = await getCollection("articles", ({ data }) => !data.draft);

  const seen = new Set<string>();
  for (const entry of entries) {
    // The glob loader's `id` is the file path relative to `base`, extension
    // INCLUDED ("nz-crypto-tax-disposals.md"). Comparing it raw to the slug
    // fails for every article, so strip the extension before comparing.
    const filename = entry.id.replace(/\.md$/, "");
    if (filename !== entry.data.slug) {
      throw new Error(
        `src/content/articles/${entry.id}: frontmatter slug "${entry.data.slug}" does not ` +
          `match the filename. The route is built from the frontmatter, so the file would be ` +
          `published at /articles/${entry.data.slug}/ and nothing would link to it.`,
      );
    }
    if (seen.has(entry.data.slug)) {
      throw new Error(`Duplicate article slug "${entry.data.slug}" in src/content/articles/`);
    }
    seen.add(entry.data.slug);
  }

  // Revive the timestamps once, here, so every downstream surface — the index
  // cards, the detail page, the sitemap, the feed, llms.txt and the JSON-LD
  // graph — gets real Dates and none of them has to know about the store's
  // string round-trip. See `reviveDate` above.
  const revived = entries.map((entry) => ({
    ...entry,
    data: {
      ...entry.data,
      publishedAt: reviveDate(entry.data.publishedAt),
      updatedAt: reviveDate(entry.data.updatedAt),
    },
  }));

  return revived.sort(
    (left, right) => right.data.publishedAt.getTime() - left.data.publishedAt.getTime(),
  );
}

/* --------------------------------------------------------------------------
 * Category hubs — /articles/category/<slug>/
 *
 * One crawlable page per category that at least one published article carries.
 * The JS filter strip on /articles/ detaches and re-attaches cards, which a
 * crawler never executes; these routes are the link-followable form of the
 * same facets. Category LABELS are governed values (the "articles-advice"
 * list section of src/data/pages.yaml, the same list the filter strip renders
 * and the article-publish vocabulary is pinned to); nothing here invents,
 * renames or reorders one — this module only derives routes from them.
 * ------------------------------------------------------------------------ */

export interface ArticleCategory {
  /** The governed label, verbatim ("Student Loans"). */
  label: string;
  /** The label's URL form ("student-loans"). */
  slug: string;
  /** Published articles carrying the label, newest first. */
  entries: ArticleEntry[];
}

/**
 * "Student Loans" → "student-loans". Deterministic and total: a label that
 * collapses to nothing (or collides with another label's slug — checked in
 * `publishedCategories`) is a build failure, not a silently absent page.
 */
export function categorySlug(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") {
    throw new Error(`article category ${JSON.stringify(label)} produces an empty URL slug`);
  }
  return slug;
}

/** Route of one category hub, base applied — what an `href` needs. */
export function categoryPath(slug: string): string {
  return sitePath(`articles/category/${slug}/`);
}

/**
 * The categories the build publishes hubs for: every governed filter-list
 * entry (minus the "show everything" first entry) that at least one published
 * article carries, in the client's own list order.
 *
 * Fail-closed guards, mirroring the reachability guard on /articles/:
 *  - an article category missing from the governed list is a build failure
 *    here too, because its hub route could never be derived consistently;
 *  - two labels collapsing to one slug would publish one hub over the other;
 *  - an article slugged "category" would sit inside the hub namespace at
 *    /articles/category/, shadowing it.
 */
export async function publishedCategories(): Promise<ArticleCategory[]> {
  const entries = await publishedArticles();

  const record = pages["articles-advice"];
  const filterSection = record.sections.find((section) => section.kind === "list");
  if (!filterSection?.items) {
    throw new Error(
      'src/data/pages.yaml: the "articles-advice" record must contain a list section — ' +
        "it is the governed category vocabulary the hub routes derive from",
    );
  }
  const [, ...governedOrder] = filterSection.items;

  const used = new Map<string, ArticleEntry[]>();
  for (const entry of entries) {
    if (entry.data.slug === "category") {
      throw new Error(
        `src/content/articles/${entry.id}: the slug "category" is reserved — ` +
          "it would shadow the /articles/category/ hub namespace",
      );
    }
    for (const label of entry.data.categories) {
      const list = used.get(label);
      if (list) list.push(entry);
      else used.set(label, [entry]);
    }
  }

  const governed = new Set(governedOrder);
  for (const label of used.keys()) {
    if (!governed.has(label)) {
      throw new Error(
        `article category ${JSON.stringify(label)} is not in the "articles-advice" ` +
          "list section of src/data/pages.yaml, so no hub route can be derived for it",
      );
    }
  }

  const seenSlugs = new Set<string>();
  return governedOrder
    .filter((label) => used.has(label))
    .map((label) => {
      const slug = categorySlug(label);
      if (seenSlugs.has(slug)) {
        throw new Error(`article categories collide on the URL slug "${slug}"`);
      }
      seenSlugs.add(slug);
      return { label, slug, entries: used.get(label) ?? [] };
    });
}

/**
 * The label an article card shows in `.article-type`.
 *
 * Mirrors the semantics `src/data/articles.yaml` already encodes in its `type`
 * field: a repost is labelled with the publisher who reported it, an original
 * piece with the site's authored label. Attribution is never dropped — a post
 * that credits Stuff says "Stuff" on its card, not "By Dave".
 */
export function articleTypeLabel(entry: ArticleEntry, authoredLabel: string): string {
  return entry.data.attribution?.source ?? authoredLabel;
}

/**
 * The slug of the in-repo article a curated `articles.yaml` URL now points at,
 * or `undefined` when the URL belongs to a third-party publisher.
 *
 * Matching is on host + final path segment: WordPress permalinks are
 * `https://davetaxnz.nz/2026/08/06/<slug>/`, and `<slug>` is the same value the
 * extractor wrote into the frontmatter.
 */
export function migratedSlugForUrl(url: string, slugs: ReadonlySet<string>): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!MIGRATED_HOSTS.has(parsed.hostname)) return undefined;

  const segments = parsed.pathname.split("/").filter(Boolean);
  const last = segments.at(-1);
  return last !== undefined && slugs.has(last) ? last : undefined;
}
