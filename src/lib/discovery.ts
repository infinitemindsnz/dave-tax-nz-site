import { articlePath, publishedArticles } from "./articles";
import { pageRoutes } from "./pages";
import { sitePath } from "./urls";

/**
 * The discovery layer: what the sitemap, the RSS feed, llms.txt and the JSON-LD
 * graph need in order to describe this site to a machine.
 *
 * Two jobs, both of which exist so no discovery surface has to re-derive
 * anything the rendering surfaces already know:
 *
 *  1. ROUTES — the set of HTML pages this build actually publishes.
 *  2. TIMESTAMPS — the article frontmatter's wall clock in the two machine
 *     shapes the surfaces need, without ever normalising it into a zone the
 *     content model does not carry.
 */

/* --------------------------------------------------------------------------
 * Routes
 * ------------------------------------------------------------------------ */

export interface SiteRoute {
  /** Site-relative, no leading slash, no `base` — resolve through `absoluteUrl`. */
  path: string;
  /**
   * W3C-Datetime `lastmod`, date precision. Present only where the content
   * model carries a real, governed modification date. It is deliberately absent
   * for pages assembled from src/data/*.yaml: a phone-number patch changes such
   * a page without touching any date field, so any value we could put there
   * would be a modification time the build cannot vouch for.
   */
  lastmod?: string;
}

/**
 * The base-less form of an article's route.
 *
 * `articlePath()` in src/lib/articles.ts is what an `href` needs: it has the
 * configured `base` applied already. `absoluteUrl()` applies the base itself,
 * so feeding it that value would double the prefix on the GitHub Pages deploy.
 * Stripping the base back off — rather than re-typing "articles/<slug>/" here —
 * keeps one definition of the route shape in the repo.
 */
export function articleRoute(slug: string): string {
  const base = sitePath();
  return articlePath(slug).slice(base.length);
}

/**
 * Static page routes discovered from the page files themselves.
 *
 * Discovery surfaces must never list a URL the build does not emit — a sitemap
 * full of 404s is worse than a short one. This is a Vite glob over the page
 * directory, so when a migrated WordPress page (about-dave, contact,
 * testimonials, …) lands as a page file it appears in the sitemap on the next
 * build with no edit here. Nothing is listed speculatively: a page route that
 * has not been built yet is simply absent.
 *
 * Excluded by rule:
 *  - dynamic route files (`[slug]`, `[...rest]`): they publish nothing by
 *    themselves, and their concrete URLs come from their data source below;
 *  - `_`-prefixed files, which Astro does not route;
 *  - endpoint files (`.ts`): robots.txt, rss.xml, llms.txt and sitemap.xml are
 *    discovery surfaces, not content pages, and do not belong in a sitemap.
 *
 * Keys only — the loaders are never called, so no page module is executed and
 * there is no import cycle between a page and the sitemap that lists it.
 */
const pageFiles = Object.keys(import.meta.glob("/src/pages/**/*.astro"));

const PAGES_PREFIX = "/src/pages/";

function routeFromPageFile(file: string): string | undefined {
  const relative = file.slice(PAGES_PREFIX.length).replace(/\.astro$/, "");
  const segments = relative.split("/");

  if (segments.some((segment) => segment.startsWith("_"))) return undefined;
  if (segments.some((segment) => segment.includes("[") || segment.includes("]"))) return undefined;

  if (relative === "index") return "";
  const trimmed = segments.at(-1) === "index" ? segments.slice(0, -1).join("/") : relative;
  return `${trimmed}/`;
}

/** Home first, then alphabetical — a stable sitemap order. */
function byRoute(left: string, right: string): number {
  if (left === "") return -1;
  if (right === "") return 1;
  return left.localeCompare(right);
}

/**
 * Every HTML page route this build publishes.
 *
 * Two sources, because there are two kinds of page file:
 *
 *  1. The glob above — one file, one route (index.astro, articles/index.astro).
 *  2. `pageRoutes()` — the concrete URLs of the ONE dynamic page route,
 *     src/pages/[slug].astro, which the glob deliberately skips because a
 *     `[slug]` file publishes nothing by itself. Its `getStaticPaths` and this
 *     list read the same `ROUTED_PAGE_SLUGS` in src/lib/pages.ts, so the sitemap
 *     cannot list a migrated page the build does not emit, or miss one it does.
 */
export function staticPageRoutes(): string[] {
  const routes = new Set<string>();
  for (const file of pageFiles) {
    const route = routeFromPageFile(file);
    if (route !== undefined) routes.add(route);
  }
  for (const route of pageRoutes()) routes.add(route);
  return [...routes].sort(byRoute);
}

/* --------------------------------------------------------------------------
 * Governed internal links
 *
 * The content model stores a link to a page of this site as a root-relative
 * route with a trailing slash ("/articles/", "/about-dave/"); see
 * `internalRouteSource` in src/data/schema.ts. Two things have to happen before
 * such a value can go in an href, and both happen here so no component does
 * either by hand.
 * ------------------------------------------------------------------------ */

/**
 * True for a content-model href that names a page of this site, as opposed to
 * an in-page anchor, an absolute URL, or a mailto:/tel: link.
 */
export function isInternalRoute(href: string): boolean {
  return href.startsWith("/");
}

/**
 * A governed internal route as a base-aware href, checked against the routes
 * this build actually publishes.
 *
 * The check is the point. A nav item or an expertise card that names a page is
 * only useful while that page exists, and a link to a page the build no longer
 * emits is a 404 that nothing else in this repo would catch — the sitemap is
 * derived from the build, so it stays silently correct while the nav rots.
 * Renaming a page slug now fails the build at the link instead.
 *
 * `source` names the content-model field in the error, because the fix is
 * always an edit to src/data/site.yaml rather than to the component.
 */
export function resolveInternalRoute(href: string, source: string): string {
  const published = staticPageRoutes();
  const route = href.slice(1);
  if (!published.includes(route)) {
    throw new Error(
      `${source} links to "${href}", which this build does not publish. ` +
        `Published routes: ${published.map((entry) => `/${entry}`).join(", ")}`,
    );
  }
  return sitePath(route);
}

/** Every published route: static pages first, then articles newest first. */
export async function collectRoutes(): Promise<SiteRoute[]> {
  const entries = await publishedArticles();
  return [
    ...staticPageRoutes().map((path) => ({ path })),
    ...entries.map((entry) => ({
      path: articleRoute(entry.data.slug),
      lastmod: machineDateTime(entry.data.updatedAt).slice(0, 10),
    })),
  ];
}

/* --------------------------------------------------------------------------
 * Timestamps
 *
 * `publishedAt` / `updatedAt` are WordPress's `date` / `modified`: the client
 * site's NZ wall clock, written WITHOUT a zone offset ("2026-08-06T06:44:18")
 * and deliberately never normalised to UTC — several posts publish late in the
 * NZ evening and a UTC shift would move them onto the next calendar day,
 * changing the date the client published on.
 *
 * `z.coerce.date()` parses an offset-less ISO string as LOCAL time, so the Date
 * it produces is only meaningful when read back with the LOCAL getters. Both
 * helpers below do exactly that, and they differ in what they then do with the
 * components:
 *
 *  - `machineDateTime` emits them verbatim, offset-free, which is what
 *    `datePublished` / `dateModified` / `<lastmod>` / `article:published_time`
 *    want: an ISO-8601 local time asserts no zone, which is honest here.
 *  - `machineInstant` stamps them onto UTC. RSS `pubDate` is RFC-822 and is
 *    always rendered in a real zone, so without this the feed would shift with
 *    the build machine's own zone; with it, every build emits the same bytes.
 * ------------------------------------------------------------------------ */

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** "2026-08-06T06:44:18" — ISO-8601 local time; no offset is invented. */
export function machineDateTime(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new Error("article frontmatter carries an unparseable publishedAt/updatedAt");
  }
  const date = `${pad(value.getFullYear(), 4)}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  return `${date}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

/** The same wall-clock components anchored to UTC: build-machine independent. */
export function machineInstant(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new Error("article frontmatter carries an unparseable publishedAt/updatedAt");
  }
  return new Date(
    Date.UTC(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
    ),
  );
}
