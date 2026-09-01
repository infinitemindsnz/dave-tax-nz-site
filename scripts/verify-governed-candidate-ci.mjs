import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { parse as parseYaml, parseDocument } from "yaml";
import { GOVERNED_AUTHORITY_DIGESTS, materialiseGovernedOperation } from "./governed-materialisers.mjs";

const sha = /^[0-9a-f]{40}$/;
const baseSha = process.env.GOVERNED_BASE_SHA ?? "";
const headSha = process.env.GOVERNED_HEAD_SHA ?? "";

assert.match(baseSha, sha, "GOVERNED_BASE_SHA must be a full lowercase SHA-1");
assert.match(headSha, sha, "GOVERNED_HEAD_SHA must be a full lowercase SHA-1");
assert.notEqual(baseSha, headSha, "a governed candidate must change the base tree");

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const policy = JSON.parse(git("show", `${baseSha}:governance/writable-paths.v1.json`));
assert.equal(policy?.coupledSet?.operationKind, "public_phone_patch", "base policy has no active phone coupled set");
assert.equal(policy?.coupledSet?.writeMode, "atomic_across_files", "base policy phone write is not atomic");

const phonePaths = [...policy.coupledSet.paths].sort();
assert.ok(phonePaths.length > 0, "base policy coupled set is empty");
assert.equal(new Set(phonePaths).size, phonePaths.length, "base policy coupled paths are duplicated");

// The text-patch surface is absent in base policies before writable-paths v4;
// a candidate can only claim the shape its own base revision declares.
const textPatchFiles = Array.isArray(policy?.textPatch?.files) ? [...policy.textPatch.files].sort() : null;
if (textPatchFiles !== null) {
  assert.equal(policy.textPatch.operationKind, "site_text_patch", "base policy textPatch has the wrong operation kind");
  assert.ok(textPatchFiles.length > 0, "base policy textPatch file allowlist is empty");
  assert.equal(new Set(textPatchFiles).size, textPatchFiles.length, "base policy textPatch files are duplicated");
}

const typedPageFiles = Array.isArray(policy?.typedPageCreate?.files) ? [...policy.typedPageCreate.files].sort() : null;
if (typedPageFiles !== null) {
  assert.equal(policy.typedPageCreate.operationKind, "typed_page_create", "base policy typedPageCreate has the wrong operation kind");
  assert.ok(typedPageFiles.includes("src/data/typed-pages.yaml"), "typed page policy omits its create-only record source");
  assert.equal(new Set(typedPageFiles).size, typedPageFiles.length, "typed page files are duplicated");
}

const statusLines = git("diff", "--name-status", "--no-renames", baseSha, headSha)
  .trim()
  .split("\n")
  .filter(Boolean);

const records = statusLines.map((line) => {
  const fields = line.split("\t");
  assert.equal(fields.length, 2, `candidate has an unsupported diff record: ${line}`);
  assert.ok(fields[0] === "M" || fields[0] === "A", `governed candidate may only modify or add files: ${line}`);
  return { status: fields[0], path: fields[1] };
});
const changedPaths = records.map((record) => record.path);
const addedPaths = records.filter((record) => record.status === "A").map((record) => record.path);

const changedGovernance = changedPaths.filter((entry) => entry === "governance" || entry.startsWith("governance/"));
assert.deepEqual(changedGovernance, [], "a governed candidate may not modify its own authority policy");

// Operation dispatch by changed-file shape. A candidate is either the complete
// phone coupled set (all four files, exactly), or a nonempty subset of the
// base policy's textPatch file allowlist. Nothing in between: a three-of-four
// phone candidate must NOT fall through into the text-patch branch unless
// every changed file is genuinely inside the text allowlist — and the two
// article files never are, so a subset phone write still refuses here.
const sortedChanged = [...changedPaths].sort();
const isPhoneCoupledSet =
  addedPaths.length === 0 &&
  sortedChanged.length === phonePaths.length && sortedChanged.every((entry, index) => entry === phonePaths[index]);

// article_publish: exactly ONE record, an added file under the articlePublish
// directory with the contract's slug grammar — and only when the base policy
// declares that surface. Anything else with an "A" record refuses below.
const articleBlock = policy?.articlePublish;
const articlePattern = /^src\/content\/articles\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const isArticleCreate =
  articleBlock !== undefined && articleBlock !== null &&
  records.length === 1 && addedPaths.length === 1 && articlePattern.test(addedPaths[0]);
const isTypedPageCreate =
  typedPageFiles !== null &&
  addedPaths.length === 0 &&
  sortedChanged.includes("src/data/typed-pages.yaml") &&
  sortedChanged.every((entry) => typedPageFiles.includes(entry));

function yamlAt(revision, file) {
  return parseYaml(git("show", `${revision}:${file}`));
}

const sourceAt = (revision, file) => git("show", `${revision}:${file}`);
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const pointerParts = (pointer) => pointer.slice(1).split("/").map((part) => /^\d+$/u.test(part) ? Number(part) : part.replaceAll("~1", "/").replaceAll("~0", "~"));
const getAt = (value, pointer) => pointerParts(pointer).reduce((node, part) => node?.[part], value);

function semanticDiff(before, after, pointer = "") {
  if (Object.is(before, after)) return [];
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) !== Array.isArray(after)) return [pointer];
  const keys = new Set(Array.isArray(before) ? [...before.keys(), ...after.keys()] : [...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap((key) => semanticDiff(before[key], after[key], `${pointer}/${key}`));
}

function materialiserBase() {
  const requiredFiles = [
    "src/data/site.yaml",
    "src/data/pages.yaml",
    "src/data/typed-pages.yaml",
    "src/content/articles/can-ird-arrest-me-at-the-border-over-my-student-loan.md",
    "src/content/articles/i-live-in-australia-and-my-nz-student-loan-has-doubled-what-can-i-do.md",
  ];
  const excludedRoots = new Set((policy.publicEmailPatch?.scanExclusions ?? []).map((entry) => entry.path));
  const treeEntries = git("ls-tree", "-r", baseSha).trim().split("\n").filter(Boolean).map((line) => {
    const match = /^(\d{6}) blob [0-9a-f]+\t(.+)$/u.exec(line);
    assert.ok(match, `unsupported Git tree entry: ${line}`);
    return { mode: match[1], file: match[2] };
  }).filter(({ file }) => !excludedRoots.has(file.split("/")[0]));
  const inventoryFiles = [...new Set([...treeEntries.map(({ file }) => file), ...requiredFiles])].sort();
  const modeByFile = new Map(treeEntries.map(({ file, mode }) => [file, mode]));
  const files = Object.fromEntries(inventoryFiles.map((file) => [file, sourceAt(baseSha, file)]));
  const pages = yamlAt(baseSha, "src/data/pages.yaml");
  const typed = yamlAt(baseSha, "src/data/typed-pages.yaml");
  const articleFiles = git("ls-tree", "-r", "--name-only", baseSha, "src/content/articles").trim().split("\n").filter((file) => file.endsWith(".md"));
  const publishedRoutes = new Set(["/", "/articles/", ...Object.keys(pages).filter((slug) => !["home", "articles-advice"].includes(slug)).map((slug) => `/${slug}/`)]);
  for (const page of typed.pages) publishedRoutes.add(`/${page.slug}/`);
  for (const file of articleFiles) publishedRoutes.add(`/articles/${path.basename(file, ".md")}/`);
  return {
    revision: baseSha,
    expectedRevision: baseSha,
    writablePolicyVersion: policy.schemaVersion,
    approvalPolicyVersion: JSON.parse(sourceAt(baseSha, "governance/approval-policy.v1.json")).schemaVersion,
    authorityDigests: { ...GOVERNED_AUTHORITY_DIGESTS },
    inventoryComplete: true,
    files,
    fileSha256: Object.fromEntries(Object.entries(files).map(([file, value]) => [file, digest(value)])),
    modes: Object.fromEntries(inventoryFiles.map((file) => [file, modeByFile.get(file) ?? "missing"])),
    publishedRoutes: [...publishedRoutes],
  };
}

function exactMaterialiserMatch(operationKind, proposal) {
  try {
    const result = materialiseGovernedOperation({ operationKind, proposal, base: materialiserBase() });
    return result.changes.length === sortedChanged.length && result.changes.every((change, index) =>
      change.path === sortedChanged[index] && change.before === sourceAt(baseSha, change.path) && change.after === sourceAt(headSha, change.path));
  } catch {
    return false;
  }
}

function inferredLinkProposal() {
  const before = yamlAt(baseSha, "src/data/site.yaml");
  const after = yamlAt(headSha, "src/data/site.yaml");
  const links = policy.linkPatch.surfaces.flatMap((surface) => {
    const beforeLabel = getAt(before, surface.labelPointer);
    const beforeHref = getAt(before, surface.hrefPointer);
    const label = getAt(after, surface.labelPointer);
    const href = getAt(after, surface.hrefPointer);
    if (beforeLabel === label && beforeHref === href) return [];
    return [{ surfaceId: surface.surfaceId, label, destination: { kind: href.startsWith("/") ? "internal_route" : "external_https", value: href } }];
  }).sort((left, right) => left.surfaceId.localeCompare(right.surfaceId));
  const navigationOrders = JSON.stringify(before.nav.order) === JSON.stringify(after.nav.order)
    ? []
    : [{ groupId: "site.header.primary", itemIds: after.nav.order }];
  return { schemaVersion: 1, links, navigationOrders };
}

function verifyLegacyTextPatch() {
  const allowedSite = new Set(policy.textPatch.enumeratedSurfaces.map((surface) => surface.jsonPointer));
  let count = 0;
  let totalBytes = 0;
  for (const file of sortedChanged) {
    assert.ok(policy.textPatch.files.includes(file), `site_text_patch cannot write ${file}`);
    const before = yamlAt(baseSha, file);
    const after = yamlAt(headSha, file);
    const changed = semanticDiff(before, after);
    const document = parseDocument(sourceAt(baseSha, file), { strict: true });
    for (const pointer of changed) {
      const value = getAt(after, pointer);
      assert.equal(typeof value, "string", `${file}${pointer} is not a text scalar`);
      assert.equal(/[\r\n]/u.test(value), false, `${file}${pointer} contains a newline`);
      if (file === "src/data/site.yaml") {
        assert.ok(allowedSite.has(pointer), `${file}${pointer} is outside site_text_patch`);
      } else {
        const parts = pointerParts(pointer);
        const slug = parts[0];
        assert.ok(policy.textPatch.patternedSurfaces.slugs.includes(slug), `${file}${pointer} uses a forbidden page`);
        const sectionIndex = parts[1] === "sections" ? parts[2] : null;
        if (sectionIndex !== null) assert.equal(policy.textPatch.patternedSurfaces.excludeSectionKinds.includes(before[slug].sections[sectionIndex].kind), false, `${file}${pointer} is attribution-bearing`);
        const shape = parts.length === 2 && ["title", "description"].includes(parts[1])
          || parts.length === 4 && parts[1] === "sections" && ["heading", "body"].includes(parts[3])
          || parts.length === 5 && parts[1] === "sections" && parts[3] === "items" && Number.isInteger(parts[4]);
        assert.ok(shape, `${file}${pointer} is outside patterned text fields`);
      }
      count += 1;
      totalBytes += Buffer.byteLength(value);
      document.setIn(pointerParts(pointer), value);
    }
    for (const { literal } of policy.textPatch.constraints.preserveLiteralOccurrences) {
      assert.equal(sourceAt(baseSha, file).split(literal).length, sourceAt(headSha, file).split(literal).length, `${file} changed a protected literal count`);
    }
    assert.equal(document.toString({ lineWidth: 0 }), sourceAt(headSha, file), `${file} contains bytes not produced by its text surfaces`);
  }
  assert.ok(count >= 1 && count <= policy.textPatch.constraints.maxSurfacesPerCandidate, "site_text_patch surface count is outside policy");
  assert.ok(totalBytes <= policy.textPatch.constraints.maxTotalValueBytes, "site_text_patch aggregate value bound exceeded");
}

function verifyLegacyPhonePatch() {
  const baseSite = yamlAt(baseSha, "src/data/site.yaml");
  const headSite = yamlAt(headSha, "src/data/site.yaml");
  const display = headSite.contact.rows[0].value;
  const e164 = headSite.contact.rows[0].href.slice(4);
  assert.match(e164, /^\+[1-9][0-9]{6,14}$/, "public_phone_patch e164 is invalid");
  for (const file of policy.files) {
    const targets = file.fields.filter((field) => field.operationKind === "public_phone_patch").flatMap((field) => field.targets);
    if (targets.length === 0) continue;
    const beforeText = sourceAt(baseSha, file.path);
    if (file.path.endsWith(".yaml")) {
      const document = parseDocument(beforeText, { strict: true });
      for (const target of targets) {
        const parts = pointerParts(target.jsonPointer);
        const current = document.getIn(parts);
        const replacement = target.input === "display" ? display : e164;
        if (target.render === "raw") document.setIn(parts, replacement);
        else if (target.render === "tel") document.setIn(parts, `tel:${replacement}`);
        else {
          assert.equal(current.split(target.matchLiteral).length - 1, 1, `${file.path}${target.jsonPointer} drifted`);
          document.setIn(parts, current.replace(target.matchLiteral, replacement));
        }
      }
      assert.equal(document.toString({ lineWidth: 0 }), sourceAt(headSha, file.path), `${file.path} is not the exact phone projection`);
    } else {
      assert.equal(targets.length, 1);
      assert.equal(beforeText.split(targets[0].matchLiteral).length - 1, 1, `${file.path} phone target drifted`);
      assert.equal(beforeText.replace(targets[0].matchLiteral, display), sourceAt(headSha, file.path), `${file.path} is not the exact phone projection`);
    }
  }
}

function verifyTypedPageCreate() {
  const baseRegistry = yamlAt(baseSha, "src/data/typed-pages.yaml");
  const headRegistry = yamlAt(headSha, "src/data/typed-pages.yaml");
  assert.ok(Array.isArray(baseRegistry?.pages) && Array.isArray(headRegistry?.pages), "typed page registry must contain pages arrays");
  assert.equal(headRegistry.pages.length, baseRegistry.pages.length + 1, "typed_page_create must append exactly one record");
  assert.deepEqual(headRegistry.pages.slice(0, -1), baseRegistry.pages, "typed_page_create may not modify or reorder existing records");
  const created = headRegistry.pages.at(-1);
  assert.match(created?.slug ?? "", /^[a-z0-9]+(?:-[a-z0-9]+)*$/, "created typed page has an unsafe slug");

  if (!sortedChanged.includes("src/data/site.yaml")) {
    return { schemaVersion: 1, page: created, navigationPlacement: null };
  }
  const baseSite = yamlAt(baseSha, "src/data/site.yaml");
  const headSite = yamlAt(headSha, "src/data/site.yaml");
  assert.ok(baseSite?.nav?.items && headSite?.nav?.items && !Array.isArray(baseSite.nav.items) && !Array.isArray(headSite.nav.items), "site header must contain keyed navigation items");
  const baseKeys = Object.keys(baseSite.nav.items);
  const headKeys = Object.keys(headSite.nav.items);
  assert.equal(headKeys.length, baseKeys.length + 1, "typed page navigation may add exactly one item");
  const newKeys = headKeys.filter((key) => !Object.hasOwn(baseSite.nav.items, key));
  assert.deepEqual(newKeys, [`page.${created.slug}`], "typed page navigation key must derive from the created slug");
  for (const key of baseKeys) assert.deepEqual(headSite.nav.items[key], baseSite.nav.items[key], `typed page navigation modified existing item ${key}`);
  assert.ok(Array.isArray(baseSite.nav.order) && Array.isArray(headSite.nav.order), "site header must contain an explicit navigation order");
  const positions = headSite.nav.order.flatMap((_, index) => {
    const remaining = [...headSite.nav.order.slice(0, index), ...headSite.nav.order.slice(index + 1)];
    return JSON.stringify(remaining) === JSON.stringify(baseSite.nav.order) ? [index] : [];
  });
  assert.equal(positions.length, 1, "typed page navigation must be one pure insertion");
  assert.equal(headSite.nav.order[positions[0]], newKeys[0], "typed page order inserted the wrong item key");
  const inserted = headSite.nav.items[newKeys[0]];
  const semanticId = `header.page.${created.slug}`;
  assert.deepEqual(Object.keys(inserted).sort(), ["binding", "href", "id", "label"], "typed page navigation item has undeclared fields");
  assert.equal(inserted.id, semanticId, "typed page navigation ID must derive from the created slug");
  assert.equal(inserted.binding, semanticId, "typed page navigation binding must derive from the created slug");
  assert.equal(inserted.href, `/${created.slug}/`, "typed page navigation route must target the created page");
  assert.equal(typeof inserted.label, "string");
  assert.ok(inserted.label.length > 0 && Buffer.byteLength(inserted.label) <= 80, "typed page navigation label is outside its bound");
  const normalisedHead = structuredClone(headSite);
  delete normalisedHead.nav.items[newKeys[0]];
  normalisedHead.nav.order.splice(positions[0], 1);
  assert.deepEqual(normalisedHead, baseSite, "typed_page_create may not modify unrelated site semantics");
  return {
    schemaVersion: 1,
    page: created,
    navigationPlacement: { groupId: "site.header.primary", label: inserted.label, position: positions[0] },
  };
}

if (isArticleCreate) {
  assert.equal(articleBlock.operationKind, "article_publish", "base policy articlePublish has the wrong operation kind");
  assert.equal(articleBlock.writeMode, "create_only", "base policy articlePublish is not create-only");
  process.stdout.write(`Governed candidate boundary verified: one created article (${addedPaths[0]}).\n`);
} else if (isTypedPageCreate) {
  const proposal = verifyTypedPageCreate();
  assert.equal(exactMaterialiserMatch("typed_page_create", proposal), true, "typed page candidate bytes do not equal the website materialiser output");
  process.stdout.write(`Governed candidate boundary verified across ${changedPaths.length} typed-page file(s) (typed_page_create).\n`);
} else if (isPhoneCoupledSet) {
  const site = yamlAt(headSha, "src/data/site.yaml");
  const mailto = site.contact.rows[1].href.slice("mailto:".length).split("?")[0];
  const emailProposal = { schemaVersion: 1, display: site.contact.rows[1].value, mailto };
  if (exactMaterialiserMatch("public_email_patch", emailProposal)) {
    process.stdout.write(`Governed candidate boundary verified across ${changedPaths.length} exact materialiser files (public_email_patch).\n`);
  } else {
    verifyLegacyPhonePatch();
    process.stdout.write(`Governed candidate boundary verified across ${changedPaths.length} exact coupled files (public_phone_patch).\n`);
  }
} else {
  assert.deepEqual(addedPaths, [], "only a single-article candidate may add a file");
  assert.ok(
    textPatchFiles !== null,
    "governed candidate changed-file set must equal the complete base-policy coupled set (the base policy declares no text-patch surface)",
  );
  const allowed = new Set(textPatchFiles);
  const outside = sortedChanged.filter((entry) => !allowed.has(entry));
  assert.deepEqual(
    outside,
    [],
    "governed candidate must be either the complete phone coupled set or a nonempty subset of the textPatch file allowlist",
  );
  assert.ok(sortedChanged.length > 0, "a governed text candidate must change at least one allowlisted file");
  if (sortedChanged.length === 1 && sortedChanged[0] === "src/data/site.yaml") {
    const before = yamlAt(baseSha, "src/data/site.yaml");
    const after = yamlAt(headSha, "src/data/site.yaml");
    const hours = after.openingHours;
    const hoursProposal = hours && { schemaVersion: 1, timezone: hours.timezone, weekly: hours.weekly, display: hours.display };
    if (hoursProposal && before.openingHours !== after.openingHours && exactMaterialiserMatch("public_opening_hours_replace", hoursProposal)) {
      process.stdout.write("Governed candidate boundary verified against exact materialiser output (public_opening_hours_replace).\n");
    } else {
      const linkProposal = inferredLinkProposal();
      if (linkProposal.links.length > 0 && exactMaterialiserMatch("site_link_patch", linkProposal)) {
        process.stdout.write("Governed candidate boundary verified against exact materialiser output (site_link_patch).\n");
      } else {
        verifyLegacyTextPatch();
        process.stdout.write(`Governed candidate boundary verified across ${changedPaths.length} exact text-surface files (site_text_patch).\n`);
      }
    }
  } else {
    verifyLegacyTextPatch();
    process.stdout.write(`Governed candidate boundary verified across ${changedPaths.length} exact text-surface files (site_text_patch).\n`);
  }
}
