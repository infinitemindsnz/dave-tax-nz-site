import type { APIRoute } from "astro";
import { absoluteUrl } from "../lib/urls";
import { collectRoutes } from "../lib/discovery";
import { escapeXml } from "../lib/xml";

export const prerender = true;

/**
 * /sitemap.xml
 *
 * Every HTML route the build publishes: the home page, each migrated page route
 * that exists as a page file, and one entry per published article. The list is
 * derived in src/lib/discovery.ts from the page files and the `articles`
 * collection, so it cannot list a URL the build does not emit and cannot go
 * stale when a page or a post is added.
 *
 * In-page anchors (#about, #expertise, …) are NOT separate URLs and must not be
 * listed — a sitemap of fragments is a duplicate-content signal, not a
 * discovery aid.
 *
 * `lastmod` is emitted only for articles, which carry a real governed
 * modification date (`updatedAt`, from WordPress `modified`). Pages assembled
 * from src/data/*.yaml deliberately have none: a phone-number patch changes
 * such a page without touching any date field, so any value here would be a
 * modification time the build cannot vouch for. An absent lastmod is more
 * accurate than a wrong one.
 */
export const GET: APIRoute = async ({ site }) => {
  const routes = await collectRoutes();

  const records = routes.map((route) =>
    [
      "  <url>",
      `    <loc>${escapeXml(absoluteUrl(site, route.path))}</loc>`,
      ...(route.lastmod ? [`    <lastmod>${escapeXml(route.lastmod)}</lastmod>`] : []),
      "  </url>",
    ].join("\n"),
  );

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...records,
    "</urlset>",
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
