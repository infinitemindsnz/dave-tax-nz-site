import { site as content } from "./content";
import { absoluteUrl } from "./urls";
import type { ArticleEntry } from "./articles";
import { articleRoute, isInternalRoute, machineDateTime } from "./discovery";
import { resolveMediaUrl } from "./media";

/**
 * JSON-LD graph for the homepage: Organization + LegalService + Person.
 *
 * Rule of the file: **every value is derived from src/data/site.yaml.** Nothing
 * is hand-typed here. The whole point of structured data is to be a
 * machine-readable restatement of what the page already says; a hardcoded name,
 * phone number or service description would be a second source of truth that
 * silently drifts the first time the client edits the content model.
 *
 * Two consequences of that rule worth knowing:
 *  - `telephone` is derived from the `tel:` href, not from the displayed value.
 *    The content model deliberately preserves an upstream data bug where the
 *    displayed number ("+64 21 021 68888") has one more digit than the dialable
 *    one ("+64210216888"). Machines get the dialable number.
 *  - The office address is the single `contact.rows` entry that links to a map.
 *    It is split on the last comma into streetAddress + addressLocality. No
 *    country/region is invented — the content model does not carry one.
 *
 * Nothing here renders. This module is head-only output.
 */

type JsonObject = Record<string, unknown>;

/** Drop keys whose value is undefined so optional content never emits `null`. */
function defined(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

/**
 * The absolute URL for an expertise card's target, or `undefined` where the card
 * has no addressable page.
 *
 * Three shapes reach this: an internal route ("/student-loan-negotiations/"),
 * which `absoluteUrl` resolves through the configured `base`; an absolute
 * http(s) URL, emitted as-is; and a mailto:, which is a contact point rather
 * than a `Service` URL and is dropped.
 */
function practiceAreaUrl(site: URL | undefined, href: string): string | undefined {
  if (isInternalRoute(href)) return absoluteUrl(site, href.slice(1));
  return href.startsWith("http") ? href : undefined;
}

/**
 * "97 Great South Road, Epsom" → street + locality. A value with no comma stays
 * a single streetAddress rather than being guessed apart.
 */
function postalAddress(value: string): JsonObject {
  const separator = value.lastIndexOf(",");
  if (separator === -1) return { "@type": "PostalAddress", streetAddress: value };
  return {
    "@type": "PostalAddress",
    streetAddress: value.slice(0, separator).trim(),
    addressLocality: value.slice(separator + 1).trim(),
  };
}

// The schema.org types this module emits, in graph order. Exported so a test or
// a build gate can assert the graph shape without re-deriving it.
// (Plain comment, not JSDoc: a `@type` tag here trips ts(80004).)
export const STRUCTURED_DATA_TYPES = ["Organization", "LegalService", "Person"] as const;

// The article page emits the practice's identity nodes alongside the Article so
// its `author` / `publisher` @id references resolve inside the same graph.
export const ARTICLE_STRUCTURED_DATA_TYPES = ["Organization", "Person", "Article"] as const;

/**
 * The three identity nodes plus the @ids that reference them. Shared so the
 * homepage graph and an article graph describe the same Organization and the
 * same Person, at the same @id, instead of two near-copies that drift.
 */
function buildEntities(site: URL | undefined) {
  const { meta, brand, hero, proof, expertise, contact, footer } = content;

  const home = absoluteUrl(site);
  const organizationId = `${home}#organization`;
  const legalServiceId = `${home}#legal-service`;
  const personId = `${home}#person`;

  const telHref = contact.rows.find((row) => row.href.startsWith("tel:"))?.href;
  const mailHref = contact.rows.find((row) => row.href.startsWith("mailto:"))?.href;
  const officeRow = contact.rows.find((row) => row.href.startsWith("http"));

  const telephone = telHref?.slice("tel:".length);
  // mailto: hrefs may carry a ?subject= query; the address is everything before it.
  const email = mailHref?.slice("mailto:".length).split("?")[0];
  if (!telephone && !email) {
    throw new Error(
      "src/data/site.yaml: contact.rows must contain at least one tel: or mailto: row — " +
        "structured data cannot describe a practice with no contact point",
    );
  }

  const address = officeRow ? postalAddress(officeRow.value) : undefined;

  // Profile links Dave/the practice controls elsewhere. `external: false` rows
  // (the mailto link) are contact details, not identity profiles.
  const profiles = footer.links.filter((link) => link.external).map((link) => link.href);
  const sameAs = profiles.length > 0 ? profiles : undefined;

  const logo = {
    "@type": "ImageObject",
    url: absoluteUrl(site, brand.logo.src),
    width: brand.logo.width,
    height: brand.logo.height,
    caption: brand.logo.alt,
  };

  const portrait = {
    "@type": "ImageObject",
    url: absoluteUrl(site, proof.author.image.src),
    width: proof.author.image.width,
    height: proof.author.image.height,
    caption: proof.author.image.alt,
  };

  const practiceAreas = expertise.items.map((item) => item.title);

  const organization = defined({
    "@type": "Organization",
    "@id": organizationId,
    name: brand.name,
    url: home,
    description: footer.description,
    logo,
    image: logo,
    telephone,
    email,
    address,
    sameAs,
  });

  const legalService = defined({
    "@type": "LegalService",
    "@id": legalServiceId,
    name: brand.name,
    url: home,
    description: expertise.intro,
    slogan: hero.headline,
    provider: { "@id": organizationId },
    telephone,
    email,
    address,
    image: portrait,
    serviceType: practiceAreas,
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: expertise.eyebrow,
      itemListElement: expertise.items.map((item, index) =>
        defined({
          "@type": "Offer",
          position: index + 1,
          itemOffered: defined({
            "@type": "Service",
            name: item.title,
            description: item.text,
            // The addressable practice areas, at whatever URL the content model
            // gives them: two are now pages of this site ("/student-loan-
            // negotiations/"), resolved to absolute here because JSON-LD has no
            // document to be relative to. The mailto: card has no canonical URL
            // to point at and emits none.
            url: practiceAreaUrl(site, item.href),
            provider: { "@id": organizationId },
          }),
        }),
      ),
    },
    potentialAction: {
      "@type": "ReserveAction",
      name: contact.action.ctaLabel,
      description: contact.action.title,
      target: { "@type": "EntryPoint", urlTemplate: contact.action.ctaHref },
    },
  });

  const person = defined({
    "@type": "Person",
    "@id": personId,
    // hero.caption.name and proof.author.name are the same governed value; the
    // portrait caption is the one that sits next to the image being referenced.
    name: hero.caption.name,
    jobTitle: brand.tagline,
    description: meta.description,
    url: home,
    image: portrait,
    telephone,
    email,
    address,
    knowsAbout: practiceAreas,
    worksFor: { "@id": organizationId },
    sameAs,
  });

  return { organizationId, personId, organization, legalService, person };
}

export function buildStructuredData(site: URL | undefined): JsonObject {
  const { organization, legalService, person } = buildEntities(site);
  return {
    "@context": "https://schema.org",
    "@graph": [organization, legalService, person],
  };
}

/* --------------------------------------------------------------------------
 * Article graph.
 *
 * ATTRIBUTION RULE — the reason this builder branches at all.
 *
 * Roughly two-thirds of the migrated posts are reposts of reporting first
 * published by Interest.co.nz, Stuff, RNZ, Newstalk ZB, Te Waha Nui or Stace
 * Hammond. The frontmatter records that as `attribution: { source, originalUrl }`,
 * and the body preserves the client's own attribution line verbatim.
 *
 * Structured data is a machine-readable restatement of the page, so it must not
 * say something the page does not. Therefore:
 *
 *  - NO attribution → the post is Dave's own writing. `author` is the Person
 *    node and `publisher` is the practice's Organization node.
 *  - attribution PRESENT → the build has no basis for naming Dave the author,
 *    and must not imply it. `author` and `publisher` become an Organization
 *    named by `attribution.source`, identified by `attribution.originalUrl`;
 *    `isBasedOn` and `citation` point at the original; `sourceOrganization`
 *    names the source again in the field crawlers read for provenance. The
 *    practice's Organization still appears in the graph (it is the site), but
 *    never as the article's author or publisher.
 *
 * A half-filled attribution cannot occur: src/content.config.ts requires
 * `source` and `originalUrl` together.
 * ------------------------------------------------------------------------ */

export function buildArticleStructuredData(
  site: URL | undefined,
  article: ArticleEntry["data"],
): JsonObject {
  const { meta } = content;
  const { organizationId, personId, organization, person } = buildEntities(site);

  const canonical = absoluteUrl(site, articleRoute(article.slug));
  const absolute = (path: string) => absoluteUrl(site, path);

  const image = article.heroImage
    ? defined({
        "@type": "ImageObject",
        url: resolveMediaUrl(article.heroImage.src, absolute),
        width: article.heroImage.width,
        height: article.heroImage.height,
        caption: article.heroImage.alt === "" ? undefined : article.heroImage.alt,
      })
    : undefined;

  const attribution = article.attribution;
  const sourceOrganization = attribution
    ? {
        "@type": "Organization",
        name: attribution.source,
        url: attribution.originalUrl,
      }
    : undefined;

  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      person,
      defined({
        "@type": "Article",
        "@id": `${canonical}#article`,
        headline: article.title,
        name: article.title,
        description: article.excerpt,
        url: canonical,
        mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
        inLanguage: meta.lang,
        // Wall-clock, offset-free: see src/lib/article-date.ts. The client's
        // publish date is preserved rather than shifted into UTC.
        datePublished: machineDateTime(article.publishedAt),
        dateModified: machineDateTime(article.updatedAt),
        articleSection: article.categories,
        image,
        author: sourceOrganization ?? { "@id": personId },
        publisher: sourceOrganization ?? { "@id": organizationId },
        sourceOrganization,
        isBasedOn: attribution?.originalUrl,
        citation: attribution
          ? {
              "@type": "CreativeWork",
              name: attribution.source,
              url: attribution.originalUrl,
            }
          : undefined,
      }),
    ],
  };
}
