import { parse } from "yaml";
import siteYaml from "../data/site.yaml?raw";
import articlesYaml from "../data/articles.yaml?raw";
import pagesYaml from "../data/pages.yaml?raw";
import typedPagesYaml from "../data/typed-pages.yaml?raw";
import {
  articlesSchema,
  pagesSchema,
  siteSchema,
  typedPagesSchema,
  type Article,
  type Pages,
  type Site,
  type TypedPage,
} from "../data/schema";

/**
 * Build-time content loader.
 *
 * The YAML is read through Vite's `?raw` import, so it is part of the module
 * graph: edits invalidate in dev, and a schema violation fails `astro build`
 * instead of shipping a page with a missing string. Nothing here is lazy — the
 * validation runs the first time a component imports the module.
 */

function fail(file: string, error: unknown): never {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: Array<{ path: Array<string | number>; message: string }> })
      .issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid content in src/data/${file}:\n${issues}`);
  }
  throw new Error(`Failed to load src/data/${file}: ${String(error)}`);
}

function loadSiteContent(): Site {
  let raw: unknown;
  try {
    raw = parse(siteYaml);
  } catch (error) {
    fail("site.yaml", error);
  }
  const result = siteSchema.safeParse(raw);
  if (!result.success) fail("site.yaml", result.error);
  return result.data;
}

function loadArticleList(): Article[] {
  let raw: unknown;
  try {
    raw = parse(articlesYaml);
  } catch (error) {
    fail("articles.yaml", error);
  }
  const result = articlesSchema.safeParse(raw);
  if (!result.success) fail("articles.yaml", result.error);

  // The original React list keyed on `url`; a duplicate would silently collapse
  // two cards into one, so make it a build failure instead.
  const seen = new Set<string>();
  for (const article of result.data.articles) {
    if (seen.has(article.url)) {
      throw new Error(`Invalid content in src/data/articles.yaml: duplicate url ${article.url}`);
    }
    seen.add(article.url);
  }
  return result.data.articles;
}

/**
 * pages.yaml — the migrated WordPress page copy, keyed by WordPress slug.
 *
 * Until the article routes existed this file was validated only by
 * `npm run content:validate`; nothing imported it, so a malformed edit could
 * pass a build. It is now a build input: `/articles/` takes its title, meta
 * description and category filter list from the `articles-advice` record, so a
 * schema violation fails `astro build` like every other governed source.
 */
function loadPageContent(): Pages {
  let raw: unknown;
  try {
    raw = parse(pagesYaml);
  } catch (error) {
    fail("pages.yaml", error);
  }
  const result = pagesSchema.safeParse(raw);
  if (!result.success) fail("pages.yaml", result.error);
  return result.data;
}

function loadTypedPageContent(): TypedPage[] {
  let raw: unknown;
  try {
    raw = parse(typedPagesYaml);
  } catch (error) {
    fail("typed-pages.yaml", error);
  }
  const result = typedPagesSchema.safeParse(raw);
  if (!result.success) fail("typed-pages.yaml", result.error);
  const seen = new Set<string>();
  for (const page of result.data.pages) {
    if (seen.has(page.slug)) throw new Error(`Invalid content in src/data/typed-pages.yaml: duplicate slug ${page.slug}`);
    seen.add(page.slug);
  }
  return result.data.pages;
}

export const site: Site = loadSiteContent();
export const articles: Article[] = loadArticleList();
export const pages: Pages = loadPageContent();
export const typedPages: TypedPage[] = loadTypedPageContent();
