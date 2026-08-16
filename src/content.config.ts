import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * The `articles` collection: one Markdown file per post migrated from the
 * client's WordPress site (davetaxnz.nz/wp-json/wp/v2/posts).
 *
 * Same governance stance as src/data/schema.ts: `strictObject`, so an unknown
 * or misspelled frontmatter key is a build failure rather than a field that
 * silently disappears from the rendered page.
 *
 * `attribution` is legally load-bearing. Many of these posts are reposts of
 * Interest.co.nz, Stuff, RNZ, Newstalk ZB or Te Waha Nui reporting. Where the
 * body carries a repost or original-reporting line, the source and the
 * canonical original URL are recorded here as well as preserved verbatim in the
 * body prose. `source` and `originalUrl` are required together — a half-filled
 * attribution is worse than none, so the schema refuses to accept one without
 * the other.
 */
const articles = defineCollection({
  loader: glob({ base: "./src/content/articles", pattern: "**/*.md" }),
  schema: z.strictObject({
    title: z.string().min(1),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case"),

    /**
     * WordPress `date` / `modified`: the site's local (NZ) wall clock, kept
     * verbatim rather than normalised to UTC. Several posts publish late in the
     * NZ evening, and a UTC shift would move them onto the next calendar day —
     * changing the date the client published on.
     */
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date(),

    excerpt: z.string().min(1),
    categories: z.array(z.string().min(1)).min(1),

    attribution: z
      .strictObject({
        source: z.string().min(1),
        originalUrl: z.string().url().startsWith("https://"),
      })
      .optional(),

    heroImage: z
      .strictObject({
        src: z.string().url().startsWith("https://"),
        alt: z.string(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      })
      .optional(),

    draft: z.boolean(),
  }),
});

export const collections = { articles };
