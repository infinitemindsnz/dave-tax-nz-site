import type { APIRoute } from "astro";
import { absoluteUrl } from "../lib/urls";

export const prerender = true;

/**
 * /robots.txt — crawl access plus the sitemap pointer.
 *
 * Every route the build publishes — the home page, the article index and each
 * article — is public marketing content and is crawlable. This file expresses
 * crawl access only; it makes no claim about downstream use. The sitemap it
 * points at is the authoritative route list (src/lib/discovery.ts).
 */
export const GET: APIRoute = ({ site }) => {
  const body = [
    "# Public marketing site. Every page is intended to be crawled.",
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${absoluteUrl(site, "sitemap.xml")}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
