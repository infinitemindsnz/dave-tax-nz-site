import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse, parseDocument } from "yaml";

const governanceUrl = new URL("../governance/", import.meta.url);
const authorityText = (name) => readFileSync(new URL(name, governanceUrl), "utf8");
const readContract = (name) => JSON.parse(authorityText(name));
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const writable = readContract("writable-paths.v1.json");
const approvals = readContract("approval-policy.v1.json");

export const GOVERNED_MATERIALISER_VERSION = 1;
export const GOVERNED_AUTHORITY_DIGESTS = Object.freeze(Object.fromEntries(
  [
    "writable-paths.v1.json",
    "approval-policy.v1.json",
    "renderer-manifest.v1.json",
    "schemas/site.v1.schema.json",
    "schemas/typed-pages.v1.schema.json",
    "schemas/operation-carriers.v1.schema.json",
  ].map((name) => [name, sha256(authorityText(name))]),
));
export const GOVERNED_OPERATIONS = Object.freeze([
  "site_link_patch",
  "typed_page_create",
  "public_email_patch",
  "public_opening_hours_replace",
]);

const SITE = "src/data/site.yaml";
const PAGES = "src/data/pages.yaml";
const TYPED_PAGES = "src/data/typed-pages.yaml";
const EMAIL_ARTICLES = Object.freeze([
  "src/content/articles/can-ird-arrest-me-at-the-border-over-my-student-loan.md",
  "src/content/articles/i-live-in-australia-and-my-nz-student-loan-has-doubled-what-can-i-do.md",
]);
const DAYS = Object.freeze(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const EMAIL = /^(?=.{3,254}$)[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/u;
const PRIVATE_IPV4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u;

export class GovernedMaterialiserRefusal extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "GovernedMaterialiserRefusal";
    this.code = code;
  }
}

function refuse(code, message) {
  throw new GovernedMaterialiserRefusal(code, message);
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse("invalid_shape", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    refuse("unknown_field", `${label} keys must be exactly ${expected.join(", ")}`);
  }
  return value;
}

function boundedText(value, label, maxCharacters, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) refuse("invalid_text", `${label} must be non-empty text`);
  if (!value.isWellFormed() || CONTROL.test(value) || [...value].length > maxCharacters) refuse("invalid_text", `${label} is unsafe or exceeds ${maxCharacters} characters`);
  return value.normalize("NFC");
}

function assertBase(base) {
  exactObject(base, ["revision", "expectedRevision", "writablePolicyVersion", "approvalPolicyVersion", "authorityDigests", "inventoryComplete", "files", "fileSha256", "modes", "publishedRoutes"], "base");
  if (!/^[0-9a-f]{40,64}$/u.test(base.revision) || base.revision !== base.expectedRevision) {
    refuse("stale_base", "base revision does not equal the manifest-pinned revision");
  }
  if (base.writablePolicyVersion !== writable.schemaVersion || base.approvalPolicyVersion !== approvals.schemaVersion) {
    refuse("stale_contract", "policy or approval revision does not equal the loaded website authority");
  }
  try {
    exactObject(base.authorityDigests, Object.keys(GOVERNED_AUTHORITY_DIGESTS), "base.authorityDigests");
  } catch (error) {
    if (error instanceof GovernedMaterialiserRefusal) refuse("stale_contract", error.message);
    throw error;
  }
  for (const [name, digest] of Object.entries(GOVERNED_AUTHORITY_DIGESTS)) {
    if (base.authorityDigests[name] !== digest) refuse("stale_contract", `${name} digest differs from the loaded website authority`);
  }
  if (!base.files || typeof base.files !== "object" || Array.isArray(base.files)) refuse("invalid_base", "base files are required");
  if (base.inventoryComplete !== true) refuse("invalid_base", "a complete protected-base source inventory is required");
  if (!base.modes || typeof base.modes !== "object" || Array.isArray(base.modes)) refuse("invalid_base", "base modes are required");
  if (!base.fileSha256 || typeof base.fileSha256 !== "object" || Array.isArray(base.fileSha256)) refuse("invalid_base", "base source blob digests are required");
  if (!Array.isArray(base.publishedRoutes)) refuse("invalid_base", "publishedRoutes must be an array");
  for (const [name, text] of Object.entries(base.files)) {
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || name.includes("\0")) {
      refuse("unsafe_path", `base inventory contains unsafe path ${JSON.stringify(name)}`);
    }
    if (typeof text !== "string") refuse("invalid_base", `base file ${name} is not text`);
    if (base.modes[name] !== "100644") refuse("unsafe_mode", `${name} is missing, executable, a symlink, or a submodule`);
    if (base.fileSha256[name] !== sha256(text)) refuse("stale_source", `${name} bytes differ from the manifest-bound source blob`);
  }
}

function source(base, name) {
  if (!Object.hasOwn(base.files, name) || base.modes[name] !== "100644") refuse("stale_base", `${name} is absent or has an unsafe mode`);
  return base.files[name];
}

function yamlDocument(base, name) {
  const document = parseDocument(source(base, name), { strict: true });
  if (document.errors.length) refuse("invalid_base", `${name} is not valid YAML`);
  return document;
}

function outputFor(document) {
  return document.toString({ lineWidth: 0 });
}

function pointerSegments(pointer) {
  if (!/^\/(?:[^/~]|~[01])+(?:\/(?:[^/~]|~[01])+)*$/u.test(pointer)) refuse("invalid_contract", `unsafe JSON pointer ${pointer}`);
  return pointer.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~")).map((part) => /^\d+$/u.test(part) ? Number(part) : part);
}

function getAt(root, pointer) {
  return pointerSegments(pointer).reduce((node, segment) => node?.[segment], root);
}

function semanticObjectPath(root, semanticId, path = []) {
  const matches = [];
  const visit = (value, current) => {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && value.id === semanticId && value.binding === semanticId) matches.push(current);
    for (const [key, child] of Object.entries(value)) visit(child, [...current, Array.isArray(value) ? Number(key) : key]);
  };
  visit(root, path);
  if (matches.length !== 1) refuse("stale_semantic_binding", `${semanticId} resolves to ${matches.length} semantic objects`);
  return matches[0];
}

function semanticDiff(before, after, path = "") {
  if (Object.is(before, after)) return [];
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) !== Array.isArray(after)) return [path];
  const keys = new Set(Array.isArray(before) && Array.isArray(after) ? [...before.keys(), ...after.keys()] : [...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap((key) => semanticDiff(before[key], after[key], `${path}/${key}`));
}

function makeChange(path, before, after, allowedPrefixes, change = "modify") {
  const beforeValue = before === null ? null : parse(before);
  const afterValue = parse(after);
  if (change === "modify") {
    const touched = semanticDiff(beforeValue, afterValue);
    if (touched.length === 0) refuse("no_op", `${path} would not change`);
    for (const pointer of touched) {
      if (!allowedPrefixes.some((prefix) => pointer === prefix || pointer.startsWith(`${prefix}/`))) {
        refuse("unrelated_write", `${path}${pointer} is outside the semantic operation`);
      }
    }
  }
  return Object.freeze({ path, change, before, after, afterSha256: sha256(after).slice("sha256:".length) });
}

function canonicalInternalRoute(value, publishedRoutes) {
  boundedText(value, "destination.value", 256);
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { refuse("unsafe_url", "internal route has invalid percent encoding"); }
  if (decoded !== value || !/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*$/u.test(value) || value.includes("//")) {
    refuse("unsafe_url", "internal route must be canonical, lowercase, traversal-free, and trailing-slash terminated");
  }
  if (!publishedRoutes.includes(value)) refuse("missing_route", `${value} is not emitted by the candidate build`);
  return value;
}

function canonicalExternalUrl(value, allowedHosts, allowedPaths) {
  boundedText(value, "destination.value", 2048);
  if (/^(?:\/\/|javascript:|data:|file:|mailto:|tel:)/iu.test(value)) refuse("unsafe_url", "destination scheme is forbidden");
  let url;
  try { url = new URL(value); } catch { refuse("unsafe_url", "destination is not an absolute URL"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port || url.search || url.href !== value ||
    !allowedHosts.includes(host) || !allowedPaths.includes(url.pathname)) {
    refuse("unsafe_url", "external destination is non-canonical or outside the allowlist");
  }
  if (/^\[.*\]$/u.test(host) || /^\d+(?:\.\d+){3}$/u.test(host) || PRIVATE_IPV4.test(host) || host === "localhost" || host.endsWith(".local")) {
    refuse("unsafe_url", "IP-literal and private destinations are forbidden");
  }
  return value;
}

function linkPatch(proposal, base) {
  exactObject(proposal, ["schemaVersion", "links", "navigationOrders"], "site_link_patch proposal");
  if (proposal.schemaVersion !== 1 || !Array.isArray(proposal.links) || !Array.isArray(proposal.navigationOrders)) refuse("invalid_shape", "link carrier version or arrays are invalid");
  if (proposal.links.length < 1 || proposal.links.length > 12) refuse("bounds", "links must contain 1–12 edits");
  if (proposal.navigationOrders.length > 2) refuse("bounds", "at most two navigation groups may be reordered");
  const policy = writable.linkPatch;
  const byId = new Map(policy.surfaces.map((entry) => [entry.surfaceId, entry]));
  const siteDoc = yamlDocument(base, SITE);
  const site = siteDoc.toJS();
  const ids = proposal.links.map((entry) => entry?.surfaceId);
  if (new Set(ids).size !== ids.length || [...ids].sort().some((id, index) => id !== ids[index])) refuse("invalid_order", "link edits must be unique and lexically sorted");
  const allowed = [];
  for (const entry of proposal.links) {
    exactObject(entry, ["surfaceId", "label", "destination"], "link edit");
    const surface = byId.get(entry.surfaceId);
    if (!surface) refuse("unknown_surface", `unknown link surface ${entry.surfaceId}`);
    exactObject(entry.destination, ["kind", "value"], "link destination");
    const label = boundedText(entry.label, "link label", policy.constraints.maxLabelCharacters);
    const objectPath = semanticObjectPath(site, surface.semanticId);
    const labelPath = pointerSegments(surface.labelPointer);
    const hrefPath = pointerSegments(surface.hrefPointer);
    const labelParent = labelPath.slice(0, -1);
    const hrefParent = hrefPath.slice(0, -1);
    if (JSON.stringify(objectPath) !== JSON.stringify(labelParent) || JSON.stringify(objectPath) !== JSON.stringify(hrefParent)) {
      refuse("stale_semantic_binding", `${entry.surfaceId} identity moved away from its declared semantic fields`);
    }
    const baseLabel = labelPath.reduce((node, segment) => node?.[segment], site);
    const baseHref = hrefPath.reduce((node, segment) => node?.[segment], site);
    if (typeof baseLabel !== "string" || typeof baseHref !== "string") refuse("stale_semantic_binding", `${entry.surfaceId} no longer identifies a label/destination pair`);
    if (baseLabel !== surface.baseIdentity?.label || baseHref !== surface.baseIdentity?.href) {
      refuse("stale_semantic_binding", `${entry.surfaceId} base identity drifted from its reviewed catalogue`);
    }
    const href = entry.destination.kind === "internal_route"
      ? canonicalInternalRoute(entry.destination.value, base.publishedRoutes)
      : entry.destination.kind === "external_https"
        ? canonicalExternalUrl(entry.destination.value, surface.allowedExternalHosts ?? [], surface.allowedExternalPaths ?? [])
        : refuse("unsafe_url", "destination kind is not permitted");
    if (!surface.destinationKinds.includes(entry.destination.kind)) refuse("wrong_semantics", `${entry.surfaceId} cannot use ${entry.destination.kind}`);
    siteDoc.setIn(labelPath, label);
    siteDoc.setIn(hrefPath, href);
    const resolvedPointer = (segments) => `/${segments.join("/")}`;
    allowed.push(resolvedPointer(labelPath), resolvedPointer(hrefPath));
  }
  const groupIds = proposal.navigationOrders.map((entry) => entry?.groupId);
  if (new Set(groupIds).size !== groupIds.length) refuse("invalid_order", "navigation groups must be unique");
  for (const order of proposal.navigationOrders) {
    exactObject(order, ["groupId", "itemIds"], "navigation order");
    const group = policy.navigationGroups.find((entry) => entry.groupId === order.groupId);
    if (!group || !Array.isArray(order.itemIds)) refuse("unknown_surface", "unknown navigation group");
    const liveItems = getAt(site, group.itemsPointer);
    if (!liveItems || typeof liveItems !== "object" || Array.isArray(liveItems)) refuse("stale_semantic_binding", `${group.groupId} item registry drifted`);
    const expected = Object.keys(liveItems).sort();
    if (order.itemIds.length !== expected.length || [...order.itemIds].sort().some((id, index) => id !== expected[index])) refuse("invalid_order", "navigation order must be an exact item permutation");
    for (const [key, value] of Object.entries(liveItems)) {
      if (value.id !== `header.${key}` || value.binding !== value.id) refuse("stale_semantic_binding", `${group.groupId} item identity drifted`);
    }
    siteDoc.setIn(pointerSegments(group.orderPointer), order.itemIds);
    allowed.push(group.orderPointer);
  }
  return [makeChange(SITE, source(base, SITE), outputFor(siteDoc), allowed)];
}

function safePageText(value, label, maxCharacters) {
  const text = boundedText(value, label, maxCharacters);
  if (/[<>]|!\[[^\]]*\]\(|\[[^\]]+\]\(|(?:https?|data|javascript|file):|\b(?:script|iframe|style)\b/iu.test(text)) {
    refuse("unsafe_content", `${label} contains HTML, media, a link, or executable content`);
  }
  return text;
}

function typedPageCreate(proposal, base) {
  exactObject(proposal, ["schemaVersion", "page", "navigationPlacement"], "typed_page_create proposal");
  if (proposal.schemaVersion !== 1) refuse("invalid_shape", "unsupported typed page carrier version");
  exactObject(proposal.page, ["pageType", "slug", "title", "description", "sections"], "typed page");
  const registry = writable.typedPageCreate.pageTypes.find((entry) => entry.pageType === proposal.page.pageType);
  if (!registry) refuse("unknown_page_type", "pageType is not rendered by this repository");
  const slug = boundedText(proposal.page.slug, "slug", registry.maxSlugCharacters);
  if (!SAFE_SLUG.test(slug) || decodeURIComponent(slug) !== slug) refuse("unsafe_path", "slug is not canonical");
  if (!Array.isArray(proposal.page.sections) || proposal.page.sections.length > registry.maxSections) refuse("bounds", "sections exceeds its bound");
  const typedDoc = yamlDocument(base, TYPED_PAGES);
  const typed = typedDoc.toJS();
  const collisionKeys = new Set([...base.publishedRoutes, ...typed.pages.map((page) => `/${page.slug}/`)].map((route) => decodeURIComponent(route).replace(/\/+$/u, "").toLowerCase()));
  if (collisionKeys.has(`/${slug}`)) refuse("route_collision", "slug or canonical route already exists");
  const page = {
    pageType: proposal.page.pageType,
    slug,
    title: safePageText(proposal.page.title, "title", registry.maxTitleCharacters),
    description: safePageText(proposal.page.description, "description", registry.maxDescriptionCharacters),
    sections: proposal.page.sections.map((section, index) => {
      if (section?.kind === "prose") {
        exactObject(section, ["kind", "heading", "body"], `sections[${index}]`);
        return { kind: "prose", heading: safePageText(section.heading, "section heading", 160), body: safePageText(section.body, "section body", 4000) };
      }
      if (section?.kind === "list") {
        exactObject(section, ["kind", "heading", "items"], `sections[${index}]`);
        if (!Array.isArray(section.items) || section.items.length < 1 || section.items.length > 20) refuse("bounds", "list items exceed their bound");
        return { kind: "list", heading: safePageText(section.heading, "section heading", 160), items: section.items.map((item) => safePageText(item, "list item", 500)) };
      }
      refuse("unsafe_content", "section kind is not in the page-type registry");
    }),
  };
  if (Buffer.byteLength(JSON.stringify(page)) > registry.maxPageBytes) refuse("bounds", "typed page exceeds its aggregate byte bound");
  typedDoc.addIn(["pages"], page);
  const changes = [makeChange(TYPED_PAGES, source(base, TYPED_PAGES), outputFor(typedDoc), ["/pages"] )];
  if (proposal.navigationPlacement !== null) {
    exactObject(proposal.navigationPlacement, ["groupId", "label", "position"], "navigationPlacement");
    const placement = proposal.navigationPlacement;
    if (placement.groupId !== "site.header.primary" || !Number.isInteger(placement.position)) refuse("invalid_navigation", "navigation placement is not declared");
    const siteDoc = yamlDocument(base, SITE);
    const itemKey = `page.${slug}`;
    const order = siteDoc.getIn(["nav", "order"], true);
    if (!order || !Array.isArray(order.items) || placement.position < 0 || placement.position > order.items.length) refuse("bounds", "navigation position is outside the group");
    if (siteDoc.hasIn(["nav", "items", itemKey])) refuse("route_collision", "navigation identity already exists");
    siteDoc.setIn(["nav", "items", itemKey], {
      id: `header.${itemKey}`,
      binding: `header.${itemKey}`,
      label: boundedText(placement.label, "navigation label", 80),
      href: `/${slug}/`,
    });
    order.items.splice(placement.position, 0, itemKey);
    changes.push(makeChange(SITE, source(base, SITE), outputFor(siteDoc), [`/nav/items/${itemKey}`, "/nav/order"]));
  }
  return changes;
}

function replaceExactly(text, oldValue, newValue, expected, label) {
  const count = text.split(oldValue).length - 1;
  if (count !== expected) refuse("stale_semantic_binding", `${label} expected ${expected} occurrence(s), found ${count}`);
  return text.split(oldValue).join(newValue);
}

function stringOccurrencePointers(value, needles, path = [], found = []) {
  if (typeof value === "string") {
    const occurrences = [...new Set(needles)].reduce((total, needle) => total + (value.split(needle).length - 1), 0);
    if (occurrences > 0) {
      const pointer = `/${path.map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
      found.push({ pointer, occurrences });
    }
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) stringOccurrencePointers(child, needles, [...path, key], found);
  return found;
}

function publicEmailPatch(proposal, base) {
  exactObject(proposal, ["schemaVersion", "display", "mailto"], "public_email_patch proposal");
  if (proposal.schemaVersion !== 1) refuse("invalid_shape", "unsupported email carrier version");
  const display = boundedText(proposal.display, "display", 254);
  const mailto = boundedText(proposal.mailto, "mailto", 254);
  if (!EMAIL.test(display) || !EMAIL.test(mailto) || display !== display.toLowerCase() || mailto !== mailto.toLowerCase()) refuse("invalid_email", "email fields must be canonical bare addresses");
  const siteDoc = yamlDocument(base, SITE);
  const site = siteDoc.toJS();
  const contract = writable.publicEmailPatch;
  for (const assertion of contract.semanticAssertions) {
    if (getAt(site, assertion.jsonPointer) !== assertion.equals) refuse("stale_semantic_binding", "email surface meaning assertion failed");
  }
  const oldDisplay = getAt(site, contract.currentValuePointer);
  const oldMailtoHref = getAt(site, contract.currentMailtoPointer);
  if (typeof oldDisplay !== "string" || typeof oldMailtoHref !== "string" || !oldMailtoHref.startsWith("mailto:")) refuse("stale_semantic_binding", "email source pointers are invalid");
  const oldMailto = oldMailtoHref.slice(7).split("?")[0];
  const declaredEmailPaths = new Set(contract.targets.map((target) => target.path));
  const excludedRoots = new Set(contract.scanExclusions.map((entry) => entry.path));
  const undeclared = Object.entries(base.files)
    .filter(([path]) => !excludedRoots.has(path.split("/")[0]) && !declaredEmailPaths.has(path))
    .filter(([, text]) => text.includes(oldDisplay) || text.includes(oldMailto));
  if (undeclared.length > 0) refuse("undeclared_occurrence", `public email appears outside its coupled set: ${undeclared.map(([path]) => path).join(", ")}`);
  const replacements = new Map();
  for (const target of contract.targets) {
    if (target.pointers) {
      const document = yamlDocument(base, target.path);
      const allowedPointers = new Set(target.pointers.map((entry) => entry.jsonPointer));
      const undeclaredPointers = stringOccurrencePointers(document.toJS(), [oldDisplay, oldMailto])
        .filter(({ pointer }) => !allowedPointers.has(pointer));
      if (undeclaredPointers.length > 0) {
        refuse("undeclared_occurrence", `${target.path} contains public email outside its declared semantic pointers: ${undeclaredPointers.map(({ pointer }) => pointer).join(", ")}`);
      }
      for (const pointerTarget of target.pointers) {
        const current = document.getIn(pointerSegments(pointerTarget.jsonPointer));
        if (typeof current !== "string") refuse("stale_semantic_binding", `${target.path}${pointerTarget.jsonPointer} is not text`);
        const governedNeedle = pointerTarget.input === "display" ? oldDisplay : oldMailto;
        const governedCount = current.split(governedNeedle).length - 1;
        const otherNeedle = pointerTarget.input === "display" ? oldMailto : oldDisplay;
        const otherCount = otherNeedle === governedNeedle ? 0 : current.split(otherNeedle).length - 1;
        if (governedCount !== 1 || otherCount !== 0) {
          refuse("undeclared_occurrence", `${target.path}${pointerTarget.jsonPointer} does not contain exactly its one governed email occurrence`);
        }
        if (pointerTarget.render === "raw") {
          if (current !== oldDisplay) refuse("stale_semantic_binding", `${target.path}${pointerTarget.jsonPointer} drifted`);
          document.setIn(pointerSegments(pointerTarget.jsonPointer), display);
        } else if (pointerTarget.render === "substring") {
          const count = current.split(oldDisplay).length - 1;
          if (count !== 1) refuse("stale_semantic_binding", `${target.path}${pointerTarget.jsonPointer} no longer contains exactly one governed display address`);
          document.setIn(pointerSegments(pointerTarget.jsonPointer), current.replace(oldDisplay, display));
        } else {
          if (!current.startsWith(`mailto:${oldMailto}`)) refuse("stale_semantic_binding", `${target.path}${pointerTarget.jsonPointer} drifted`);
          const suffix = pointerTarget.render === "mailto_preserve_query" ? current.slice(`mailto:${oldMailto}`.length) : "";
          if (pointerTarget.render !== "mailto_preserve_query" && current !== `mailto:${oldMailto}`) refuse("stale_semantic_binding", `${target.path}${pointerTarget.jsonPointer} is not a bare mailto`);
          document.setIn(pointerSegments(pointerTarget.jsonPointer), `mailto:${mailto}${suffix}`);
        }
      }
      replacements.set(target.path, outputFor(document));
      continue;
    }
    const before = source(base, target.path);
    const oldValue = target.input === "display" ? oldDisplay : oldMailto;
    const newValue = target.input === "display" ? display : mailto;
    if (target.requiredLinePrefix) {
      const exactLine = `${target.requiredLinePrefix}${oldValue}`;
      const lineCount = before.split("\n").filter((line) => line === exactLine).length;
      if (lineCount !== target.expectedOccurrences) refuse("attribution_guard", `${target.path} governed contact line drifted or moved into attribution/frontmatter`);
    }
    replacements.set(target.path, replaceExactly(before, oldValue, newValue, target.expectedOccurrences, `${target.path}:${target.input}`));
  }
  return [...replacements.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, after]) => {
    if (path.endsWith(".yaml")) return makeChange(path, source(base, path), after, contract.allowedSemanticPrefixes[path]);
    if (after === source(base, path)) refuse("no_op", `${path} would not change`);
    return Object.freeze({ path, change: "modify", before: source(base, path), after, afterSha256: sha256(after).slice("sha256:".length) });
  });
}

function publicOpeningHoursReplace(proposal, base) {
  exactObject(proposal, ["schemaVersion", "timezone", "weekly", "display"], "public_opening_hours_replace proposal");
  if (proposal.schemaVersion !== 1 || proposal.timezone !== "Pacific/Auckland") refuse("invalid_hours", "timezone must be the site-owned Pacific/Auckland literal");
  if (!Array.isArray(proposal.weekly) || proposal.weekly.length < 1 || proposal.weekly.length > 7) refuse("invalid_hours", "weekly schedule must contain 1–7 open days");
  const seen = new Set();
  let lastDay = -1;
  const weekly = proposal.weekly.map((entry, dayIndex) => {
    exactObject(entry, ["day", "intervals"], `weekly[${dayIndex}]`);
    const index = DAYS.indexOf(entry.day);
    if (index < 0 || seen.has(entry.day) || index <= lastDay || !Array.isArray(entry.intervals) || entry.intervals.length < 1 || entry.intervals.length > 3) refuse("invalid_hours", "days must be unique, ordered, and contain 1–3 intervals");
    seen.add(entry.day); lastDay = index;
    let previousClose = "";
    const intervals = entry.intervals.map((interval, intervalIndex) => {
      exactObject(interval, ["opens", "closes"], `weekly[${dayIndex}].intervals[${intervalIndex}]`);
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(interval.opens) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(interval.closes) || interval.opens >= interval.closes || interval.opens < previousClose) refuse("invalid_hours", "intervals must be ordered, non-overlapping local wall-clock pairs with opens < closes");
      previousClose = interval.closes;
      return { opens: interval.opens, closes: interval.closes };
    });
    return { day: entry.day, intervals };
  });
  const display = boundedText(proposal.display, "display", 300);
  if (/\b24\s*\/\s*7\b/iu.test(display)) refuse("invalid_hours", "24/7 is not representable by this bounded weekly contract");
  const doc = yamlDocument(base, SITE);
  const current = doc.getIn(["openingHours"]);
  if (current === undefined) refuse("stale_semantic_binding", "openingHours field is absent from the strict site model");
  doc.setIn(["openingHours"], { timezone: proposal.timezone, weekly, display });
  return [makeChange(SITE, source(base, SITE), outputFor(doc), ["/openingHours"])];
}

const MATERIALISERS = Object.freeze({
  site_link_patch: linkPatch,
  typed_page_create: typedPageCreate,
  public_email_patch: publicEmailPatch,
  public_opening_hours_replace: publicOpeningHoursReplace,
});

/**
 * Pure candidate projection. It never writes a file, invokes Git/shell, opens a
 * network connection, or accepts a repository/path/command/provider from the
 * proposal. The caller may persist only the returned, sorted change set after
 * binding it to a candidate manifest and the operation's approval ceremony.
 */
export function materialiseGovernedOperation({ operationKind, proposal, base }) {
  if (!GOVERNED_OPERATIONS.includes(operationKind)) refuse("unknown_operation", "operation is not in the selected tranche");
  const expectedApproval = {
    site_link_patch: ["site_link_patch", ["publication_approval"]],
    typed_page_create: ["typed_page", ["legal_sign_off", "publication_approval"]],
    public_email_patch: ["public_email_fact", ["publication_approval"]],
    public_opening_hours_replace: ["public_opening_hours", ["publication_approval"]],
  }[operationKind];
  const approvalEntries = approvals.operations.filter((entry) => entry.operationKind === operationKind);
  const approval = approvalEntries[0];
  if (approvals.schemaVersion !== 4 || approvals.default !== "deny" || approvals.naturalLanguageApproval !== "deny" ||
    approvals.decisionSurface !== "assistant-platform-authenticated" || approvalEntries.length !== 1 ||
    approval?.artifactClass !== expectedApproval[0] || JSON.stringify(approval?.requiredApprovalStages) !== JSON.stringify(expectedApproval[1]) ||
    (operationKind === "typed_page_create" && approval.distinctConfirmations !== true)) {
    refuse("wrong_ceremony", "operation approval policy is absent, widened, or rebound");
  }
  assertBase(base);
  const changes = MATERIALISERS[operationKind](proposal, base).sort((left, right) => left.path.localeCompare(right.path));
  assert.ok(changes.length > 0);
  if (new Set(changes.map((entry) => entry.path)).size !== changes.length) refuse("internal_error", "materialiser emitted duplicate paths");
  return Object.freeze({
    schemaVersion: GOVERNED_MATERIALISER_VERSION,
    operationKind,
    artifactClass: approval.artifactClass,
    requiredApprovalStages: approval.requiredApprovalStages,
    baseRevision: base.revision,
    changes: Object.freeze(changes),
  });
}
