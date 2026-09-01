import { z } from "zod";

/**
 * Strict schemas for the governed content model.
 *
 * Every object is a `strictObject`: an unknown key is a build failure, not a
 * silently ignored field. That is the point — copy is data, and a typo in a key
 * name must not degrade into a missing string on the rendered page.
 *
 * These schemas validate SHAPE and PRESENCE. They deliberately do not enforce
 * length caps or normalise punctuation: the strings are copied verbatim from
 * the original design and must survive the round-trip unchanged.
 */

/** Phosphor icon component names referenced by the content model. */
export const ICON_NAMES = [
  "ArrowRight",
  "Briefcase",
  "Check",
  "EnvelopeSimple",
  "FileText",
  "GlobeHemisphereWest",
  "List",
  "Phone",
  "Quotes",
  "ShieldCheck",
  "Student",
  "X",
] as const;

const iconName = z.enum(ICON_NAMES);

const nonEmpty = z.string().min(1);
const semanticId = z.string().regex(/^[a-z][a-z0-9.-]*$/);
const contentControl = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

const openingHours = z
  .strictObject({
    timezone: z.literal("Pacific/Auckland"),
    weekly: z
      .array(
        z.strictObject({
          day: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
          intervals: z
            .array(
              z.strictObject({
                opens: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
                closes: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
              }),
            )
            .min(1)
            .max(3),
        }),
      )
      .min(1)
      .max(7),
    display: z.string().min(1)
      .refine((value) => [...value].length <= 300, "opening-hours display exceeds 300 Unicode characters")
      .refine((value) => !contentControl.test(value), "opening-hours display contains a forbidden control character"),
  })
  .superRefine((hours, ctx) => {
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    let priorDay = -1;
    for (const [dayIndex, day] of hours.weekly.entries()) {
      const currentDay = days.indexOf(day.day);
      if (currentDay <= priorDay) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["weekly", dayIndex, "day"], message: "days must be unique and ordered Monday–Sunday" });
      }
      priorDay = currentDay;
      let priorClose = "";
      for (const [intervalIndex, interval] of day.intervals.entries()) {
        if (interval.opens >= interval.closes || interval.opens < priorClose) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["weekly", dayIndex, "intervals", intervalIndex], message: "intervals must be ordered, non-overlapping and have opens < closes" });
        }
        priorClose = interval.closes;
      }
    }
  });

/** Path relative to the site root, e.g. "assets/dave-ananth-logo.webp". */
const assetPath = z
  .string()
  .min(1)
  .regex(/^assets\/[A-Za-z0-9._/-]+$/, "asset paths must be site-relative under assets/");

/** Any link target the markup uses: #anchor, https:, mailto:, tel:. */
const href = z
  .string()
  .min(1)
  .regex(
    /^(#[A-Za-z][\w-]*|https?:\/\/\S+|mailto:\S+|tel:\+?[0-9]+)$/,
    "href must be an in-page anchor, http(s) URL, mailto: or tel: link",
  );

/**
 * A route this build publishes: root-relative, lowercase, trailing slash.
 * "/" (the homepage), "/articles/", "/about-dave/".
 *
 * This is the ONLY shape the content model uses to mean "a page of this site".
 * It carries no `base`, exactly like every other path in the model (see
 * src/lib/urls.ts) — the markup resolves it through `sitePath()`, and
 * `resolveInternalRoute()` in src/lib/discovery.ts fails the build if the route
 * is not one the build actually emits.
 */
const internalRouteSource = "\\/([a-z0-9]+(-[a-z0-9]+)*\\/)*";

const anchorSource = "#[A-Za-z][\\w-]*";

const externalHref = z.string().url().startsWith("https://");

/**
 * Nav target: an in-page anchor, or an internal route.
 *
 * Anchors were the only option while the site was one page. Now that the
 * migrated WordPress pages have routes, a nav item points at the real page
 * wherever one exists and keeps an anchor only where it does not.
 */
const navHref = z
  .string()
  .min(1)
  .regex(
    new RegExp(`^(${anchorSource}|${internalRouteSource})$`),
    'nav items link to an in-page anchor ("#expertise") or an internal route ("/articles/")',
  );

/**
 * Expertise card target. `href` above plus internal routes, because two of the
 * three practice areas are now pages of this site rather than links back to the
 * client's WordPress install.
 */
const cardHref = z
  .string()
  .min(1)
  .regex(
    new RegExp(
      `^(${anchorSource}|${internalRouteSource}|https?:\\/\\/\\S+|mailto:\\S+|tel:\\+?[0-9]+)$`,
    ),
    "card href must be an internal route, an in-page anchor, an http(s) URL, mailto: or tel: link",
  );

const image = z.strictObject({
  src: assetPath,
  alt: nonEmpty,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const link = z.strictObject({
  id: semanticId,
  binding: semanticId,
  label: nonEmpty,
  href,
  external: z.boolean(),
});

const navItem = z.strictObject({
  id: semanticId,
  binding: semanticId,
  label: nonEmpty,
  href: navHref,
});

const navigation = z
  .strictObject({
    ariaLabel: nonEmpty,
    skipLabel: nonEmpty,
    menuOpenLabel: nonEmpty,
    menuCloseLabel: nonEmpty,
    items: z.record(semanticId, navItem),
    order: z.array(semanticId).min(1),
    cta: link,
  })
  .superRefine((nav, ctx) => {
    const keys = Object.keys(nav.items);
    if (new Set(nav.order).size !== nav.order.length || [...nav.order].sort().join("\0") !== [...keys].sort().join("\0")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["order"], message: "navigation order must be an exact permutation of item keys" });
    }
    for (const [key, item] of Object.entries(nav.items)) {
      const expected = `header.${key}`;
      if (item.id !== expected || item.binding !== expected) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", key], message: `navigation item identity must equal ${expected}` });
      }
    }
  });

export const siteSchema = z.strictObject({
  meta: z.strictObject({
    lang: z.string().regex(/^[a-z]{2}(-[A-Za-z0-9]+)*$/),
    title: nonEmpty,
    description: nonEmpty,
    themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),

  brand: z.strictObject({
    name: nonEmpty,
    tagline: nonEmpty,
    href,
    ariaLabel: nonEmpty,
    logo: image,
  }),

  nav: navigation,

  hero: z.strictObject({
    eyebrow: nonEmpty,
    headline: nonEmpty,
    lead: nonEmpty,
    alert: z.strictObject({
      text: nonEmpty,
      href,
    }),
    ctas: z
      .array(
        z.strictObject({
          id: semanticId,
          binding: semanticId,
          label: nonEmpty,
          href,
          variant: z.enum(["primary", "secondary"]),
          external: z.boolean(),
          icon: iconName.nullable(),
        }),
      )
      .min(1),
    portrait: image,
    caption: z.strictObject({
      name: nonEmpty,
      role: nonEmpty,
      note: nonEmpty,
    }),
  }),

  proof: z.strictObject({
    quote: nonEmpty,
    author: z.strictObject({
      name: nonEmpty,
      role: nonEmpty,
      image,
    }),
    mediaImage: image,
  }),

  expertise: z.strictObject({
    eyebrow: nonEmpty,
    heading: nonEmpty,
    intro: nonEmpty,
    items: z
      .array(
        z.strictObject({
          id: semanticId,
          binding: semanticId,
          number: z.string().regex(/^\d{2}$/),
          icon: iconName,
          title: nonEmpty,
          text: nonEmpty,
          href: cardHref,
          linkLabel: nonEmpty,
        }),
      )
      .min(1),
  }),

  story: z.strictObject({
    eyebrow: nonEmpty,
    heading: nonEmpty,
    body: nonEmpty,
    credit: z.strictObject({
      name: nonEmpty,
      meta: nonEmpty,
    }),
    link: z.strictObject({
      id: semanticId,
      binding: semanticId,
      label: nonEmpty,
      href: externalHref,
    }),
  }),

  insights: z.strictObject({
    eyebrow: nonEmpty,
    heading: nonEmpty,
    intro: nonEmpty,
    filtersLabel: nonEmpty,
    filters: z.array(nonEmpty).min(2),
    articleLinkLabel: nonEmpty,
  }),

  /**
   * Chrome for the article surfaces (`/articles/` and `/articles/<slug>/`).
   *
   * Deliberately tiny. Everything an article surface *says* is data: titles,
   * excerpts, categories, bodies and attribution lines come from
   * src/content/articles/*.md, and the index's page title and category filter
   * list come from the `articles-advice` record in pages.yaml. These four
   * strings are the labels needed to render that data and nothing else — they
   * restate, summarise and replace none of it.
   *
   * `attributionLabel` / `attributionLinkLabel` frame the source credit block
   * on a detail page. That block is legally load-bearing: many posts are
   * reposts of Interest.co.nz, Stuff, RNZ, Newstalk ZB or Te Waha Nui
   * reporting. Removing these labels does not remove the obligation, it just
   * removes the frame around it.
   *
   * `authoredLabel` is not new copy — it is the value `src/data/articles.yaml`
   * already uses in its `type` field for Dave's own pieces, lifted to a label
   * so the article cards can distinguish authored posts from reposts without
   * a component hardcoding the string.
   */
  articlePages: z.strictObject({
    /**
     * The label on any link whose destination is the article index. Used by the
     * back link on a detail page and by the homepage "Articles & media" section
     * link — one governed string for one destination, rather than a second
     * wording invented for the second surface.
     */
    indexLinkLabel: nonEmpty,
    /** Byline shown on posts that carry no source attribution. */
    authoredLabel: nonEmpty,
    /** Introduces the source credit, e.g. "Originally published by" + "Stuff". */
    attributionLabel: nonEmpty,
    /** Label on the link to the source's canonical original URL. */
    attributionLinkLabel: nonEmpty,
  }),

  contact: z.strictObject({
    eyebrow: nonEmpty,
    heading: nonEmpty,
    intro: nonEmpty,
    rows: z
      .array(
        z.strictObject({
          label: nonEmpty,
          value: nonEmpty,
          href,
        }),
      )
      .min(1),
    action: z.strictObject({
      id: semanticId,
      binding: semanticId,
      title: nonEmpty,
      ctaLabel: nonEmpty,
      ctaHref: externalHref,
    }),
  }),

  /** Null until the client supplies the complete public fact in an approved proposal. */
  openingHours: openingHours.nullable(),

  footer: z.strictObject({
    logo: image,
    description: nonEmpty,
    links: z.array(link).min(1),
    legal: nonEmpty,
  }),
});

export const articleSchema = z.strictObject({
  category: nonEmpty,
  type: nonEmpty,
  date: nonEmpty,
  title: nonEmpty,
  summary: nonEmpty,
  url: externalHref,
});

export const articlesSchema = z.strictObject({
  articles: z.array(articleSchema).min(1),
});

/* --------------------------------------------------------------------------
 * pages.yaml — the migrated WordPress page copy.
 *
 * One entry per WordPress page, keyed by its WordPress slug. Copy is verbatim
 * client copy; attribution lines (testimonial names and dates, source links)
 * are legally load-bearing and must never be stripped or paraphrased.
 * ------------------------------------------------------------------------ */

/** The nine WordPress pages migrated from davetaxnz.nz. */
export const PAGE_SLUGS = [
  "home",
  "about-dave",
  "contact",
  "testimonials",
  "articles-advice",
  "student-loan-negotiations",
  "ird-disputes-tax-penalties-negotiation",
  "book-a-consultation",
  "thanks-consult",
] as const;

export const SECTION_KINDS = ["prose", "list", "quote", "cta"] as const;

/**
 * Section link target. Wider than `href` above because migrated page copy also
 * links to site-root paths (e.g. "/about") alongside anchors and absolute URLs.
 */
const sectionHref = z
  .string()
  .min(1)
  .regex(
    /^(#[A-Za-z][\w-]*|\/[A-Za-z0-9._~\-/]*|https?:\/\/\S+|mailto:\S+|tel:\S+)$/,
    "section href must be an in-page anchor, root-relative path, http(s) URL, mailto: or tel: link",
  );

/**
 * One block of page copy.
 *
 * - `prose` — `heading` and/or `body`. Paragraphs inside `body` are separated
 *   by a blank line; a single newline is a hard line break from the source.
 * - `list`  — `items`, with an optional `heading`.
 * - `quote` — `body` is the quoted text. `heading` carries the attributed name
 *   and `meta` the secondary attribution line (e.g. "August 2026"). Attribution
 *   is load-bearing: do not drop it.
 * - `cta`   — `body` is the link label and `href` the target. A `cta` without an
 *   `href` is a form submit button, which has no target of its own.
 *
 * Refined rather than discriminated so the "every section carries something
 * renderable" rule is enforced for all kinds in one place.
 */
export const pageSectionSchema = z
  .strictObject({
    kind: z.enum(SECTION_KINDS),
    heading: nonEmpty.optional(),
    meta: nonEmpty.optional(),
    body: nonEmpty.optional(),
    items: z.array(nonEmpty).min(1).optional(),
    href: sectionHref.optional(),
  })
  .superRefine((section, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });

    if (section.heading === undefined && section.body === undefined && section.items === undefined) {
      fail("section must carry at least one of heading, body or items");
    }
    if (section.kind !== "list" && section.items !== undefined) {
      fail(`items is only valid on a list section, not ${section.kind}`);
    }
    if (section.kind === "list" && section.items === undefined) {
      fail("list section requires items");
    }
    if (section.kind === "quote" && section.body === undefined) {
      fail("quote section requires body (the quoted text)");
    }
    if (section.kind === "quote" && section.heading === undefined && section.meta !== undefined) {
      fail("quote meta is a secondary attribution line and requires heading");
    }
    if (section.kind !== "quote" && section.meta !== undefined) {
      fail(`meta is only valid on a quote section, not ${section.kind}`);
    }
    if (section.kind === "cta" && section.body === undefined) {
      fail("cta section requires body (the link label)");
    }
    if (section.kind !== "cta" && section.href !== undefined) {
      fail(`href is only valid on a cta section, not ${section.kind}`);
    }
  });

export const pageSchema = z.strictObject({
  /** WordPress page title, decoded. */
  title: nonEmpty,
  /** WordPress excerpt rendered to plain text — upstream copy, preserved as-is. */
  description: nonEmpty,
  sections: z.array(pageSectionSchema).min(1),
});

const governedText = (max: number) =>
  z
    .string()
    .min(1)
    .refine((value) => [...value].length <= max, `typed page text exceeds ${max} Unicode characters`)
    .refine((value) => !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/u.test(value), "typed page text contains forbidden control, bidi, or markup characters");

export const typedPageSectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("prose"),
    heading: governedText(160),
    body: governedText(4000),
  }),
  z.strictObject({
    kind: z.literal("list"),
    heading: governedText(160),
    items: z.array(governedText(500)).min(1).max(20),
  }),
]);

export const typedPageSchema = z.strictObject({
  pageType: z.literal("service_detail"),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: governedText(120),
  description: governedText(300),
  sections: z.array(typedPageSectionSchema).max(12),
});

export const typedPagesSchema = z.strictObject({
  pages: z.array(typedPageSchema).max(64),
});

/**
 * Every slug is required and no others are allowed: a page that silently stops
 * being migrated is a content regression, not a smaller file.
 */
export const pagesSchema = z.strictObject(
  Object.fromEntries(PAGE_SLUGS.map((slug) => [slug, pageSchema])) as {
    [K in (typeof PAGE_SLUGS)[number]]: typeof pageSchema;
  },
);

export type Site = z.infer<typeof siteSchema>;
export type Article = z.infer<typeof articleSchema>;
export type IconName = (typeof ICON_NAMES)[number];
export type PageSection = z.infer<typeof pageSectionSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Pages = z.infer<typeof pagesSchema>;
export type PageSlug = (typeof PAGE_SLUGS)[number];
export type SectionKind = (typeof SECTION_KINDS)[number];
export type TypedPage = z.infer<typeof typedPageSchema>;
export type TypedPages = z.infer<typeof typedPagesSchema>;
