import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { site } from "../lib/content";
import { publishedArticles } from "../lib/articles";
import { articleRoute, machineInstant } from "../lib/discovery";
import { absoluteUrl } from "../lib/urls";
import { escapeXml } from "../lib/xml";

export const prerender = true;

/**
 * /rss.xml — the site's own articles as a feed, newest first.
 *
 * The items are the `articles` collection (src/content/articles/*.md), so every
 * `link` is the canonical on-site article URL. Before the posts were migrated
 * this feed carried the reference records in src/data/articles.yaml, whose
 * links point off-site; those records are still the homepage's "Articles &
 * media" grid and are still enumerated in /llms.txt, but they must not be
 * feed items now that the same posts exist here — a feed that carried both
 * would ship each of Dave's articles twice under two different URLs.
 *
 * Feed title/description come from the content model. No new copy is written
 * here, so the feed can never describe the site differently from the page.
 *
 * ATTRIBUTION: many of these posts are reposts. Where the frontmatter carries
 * an attribution, `dc:creator` names the source rather than Dave and
 * `dc:source` links the original. Where it does not, `dc:creator` is the
 * practice. The feed therefore never claims Dave wrote someone else's
 * reporting, and it never drops a source.
 */
export const GET: APIRoute = async (context) => {
  const { meta, brand, insights } = site;
  const entries = await publishedArticles();

  return rss({
    title: meta.title,
    description: insights.intro,
    site: absoluteUrl(context.site),
    xmlns: { dc: "http://purl.org/dc/elements/1.1/" },
    items: entries.map((entry) => {
      const { title, slug, excerpt, categories, publishedAt, attribution } = entry.data;
      const creator = attribution ? attribution.source : brand.name;
      const source = attribution
        ? `<dc:source>${escapeXml(attribution.originalUrl)}</dc:source>`
        : "";

      return {
        title,
        description: excerpt,
        // Absolute: @astrojs/rss passes a fully-qualified link through
        // unchanged, and absoluteUrl already applies the configured `base`.
        link: absoluteUrl(context.site, articleRoute(slug)),
        pubDate: machineInstant(publishedAt),
        categories,
        customData: `<dc:creator>${escapeXml(creator)}</dc:creator>${source}`,
      };
    }),
    customData: `<language>${escapeXml(meta.lang)}</language>`,
  });
};
