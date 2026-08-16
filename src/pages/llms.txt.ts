import type { APIRoute } from "astro";
import { articles, site } from "../lib/content";
import { machineDate, publishedArticles } from "../lib/articles";
import { articleRoute } from "../lib/discovery";
import { renderLlmsDocument } from "../lib/llms-document";
import { absoluteUrl } from "../lib/urls";

export const prerender = true;

/**
 * /llms.txt — a link-first plain-text restatement of the site for assistants
 * and answer engines. Rendered entirely from the content model; see
 * src/lib/llms-document.ts.
 *
 * Two article sources feed it: the `articles` collection (the site's own posts,
 * listed at their canonical on-site URLs, with their source attribution where
 * they are reposts) and src/data/articles.yaml (the off-site media mentions the
 * homepage grid shows).
 */
export const GET: APIRoute = async (context) => {
  const absolute = (path?: string) => absoluteUrl(context.site, path);
  const entries = await publishedArticles();

  const body = renderLlmsDocument({
    site,
    articles,
    posts: entries.map(({ data }) => ({
      title: data.title,
      url: absolute(articleRoute(data.slug)),
      excerpt: data.excerpt,
      categories: data.categories,
      published: machineDate(data.publishedAt),
      attribution: data.attribution,
    })),
    absolute,
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
