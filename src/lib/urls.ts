/**
 * Absolute-URL helper shared by every discovery surface.
 *
 * `astro.config.mjs` sets `site` (the origin) and a `base` that is
 * "/dave-tax-nz-redesign/" on the GitHub Pages deploy and "/" everywhere else.
 * Canonical links, Open Graph URLs, the sitemap, robots.txt, the RSS feed and
 * the JSON-LD graph must all agree, so they all resolve through this one
 * function instead of hand-joining strings.
 *
 * `path` is site-relative and MUST NOT start with the base — pass "assets/x.webp"
 * or "sitemap.xml" or "#contact", exactly as the content model stores it.
 */
export function absoluteUrl(site: URL | undefined, path = ""): string {
  if (!site) {
    throw new Error(
      "astro.config.mjs must set `site`: canonical, sitemap, RSS and JSON-LD output need absolute URLs",
    );
  }
  return new URL(sitePath(path), site).href;
}

/**
 * The base-aware root-relative form of the same site-relative `path` — what an
 * `href` in the markup needs.
 *
 * Every in-repo link (the article index, an article permalink, the back link)
 * MUST go through this. Writing "/articles/" by hand silently breaks the
 * GitHub Pages deploy, where the site is served from "/dave-tax-nz-redesign/".
 */
export function sitePath(path = ""): string {
  const base = import.meta.env.BASE_URL;
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const relative = path.startsWith("/") ? path.slice(1) : path;
  return `${normalizedBase}${relative}`;
}
