// Regression tests for the governed content policy (governance/*.json).
//
// These files are documentation for a publisher that does not live in this
// repository, so there is no production code path to exercise directly.
// What IS testable, and what regresses silently otherwise, is the contract
// between the policy's claims and the actual repository content it describes:
// the withdrawn operation kind must stay unreachable, the declared phone
// occurrence set must stay exactly in sync with the real files, and the
// closed-set refusal rule must actually reject a base revision that drifts
// from what the policy expects.
//
// The load-bearing test here is "every phone occurrence under the scan roots
// is accounted for": it walks the whole render-reachable tree rather than a
// list of files someone remembered to write down. An earlier revision of this
// suite scanned an enumerated source list and stayed green at 36/36 while two
// injected occurrences (src/data/articles.yaml and an article frontmatter
// `excerpt`) reached seven places in rendered output, including the homepage
// and rss.xml. Do not narrow that walk back to a file list.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  GovernedMaterialiserRefusal,
  GOVERNED_AUTHORITY_DIGESTS,
  materialiseGovernedOperation,
} from "../scripts/governed-materialisers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const governancePath = (...segments) => path.join(root, "governance", ...segments);
const readJson = (...segments) => JSON.parse(readFileSync(governancePath(...segments), "utf8"));

const writablePaths = readJson("writable-paths.v1.json");
const approvalPolicy = readJson("approval-policy.v1.json");
const candidateManifestSchema = readJson("schemas", "candidate-manifest.v1.schema.json");
const expansionFixtures = readJson("fixtures", "governed-site-expansion.v1.json");

/**
 * Every file under `dir`, recursively, as paths relative to `base` (the
 * repository root). `skip` is matched against each entry's full path
 * relative to `base`, not its basename, so an excluded top-level directory
 * like `tests` does not also swallow an unrelated nested `public/tests`.
 * Symlinks are resolved with `statSync` (which follows them) rather than
 * the non-following `Dirent` type checks, since Astro dereferences symlinks
 * into the published output — a symlinked file must be scanned like any
 * other file, not silently dropped.
 */
function walkFiles(dir, skip = new Set(), base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (skip.has(rel)) continue;
    const stats = entry.isSymbolicLink() ? statSync(full) : entry;
    if (stats.isDirectory()) out.push(...walkFiles(full, skip, base));
    else if (stats.isFile()) out.push(rel);
  }
  return out;
}

/** `src/content/articles/**\/*.md` and friends, without pulling in a glob dependency. */
function globToRegExp(glob) {
  const source = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.+/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${source}$`);
}

function countLiteralInString(value, literal) {
  if (literal === "") return 0;
  let count = 0;
  let index = 0;
  while ((index = value.indexOf(literal, index)) !== -1) {
    count += 1;
    index += literal.length;
  }
  return count;
}

/** Walks every string leaf of parsed YAML/JSON data (never raw source text, so comments are excluded). */
function countLiteralInData(value, literal) {
  if (typeof value === "string") return countLiteralInString(value, literal);
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countLiteralInData(item, literal), 0);
  if (value && typeof value === "object") {
    return Object.values(value).reduce((sum, item) => sum + countLiteralInData(item, literal), 0);
  }
  return 0;
}

function resolveJsonPointer(root, pointer) {
  if (pointer === "") return root;
  return pointer
    .replace(/^\//, "")
    .split("/")
    .reduce((node, segment) => (Array.isArray(node) ? node[Number(segment)] : node[segment]), root);
}

const scanPrecondition = writablePaths.preconditions.find((p) => p.kind === "closed_set_occurrence_scan");
const literals = scanPrecondition.expectedOccurrences.map((entry) => entry.literal);

/** Parsed YAML/JSON for any declared source, parsed once per file. */
const parsedSources = new Map();
function parseSource(rel) {
  if (!parsedSources.has(rel)) {
    const text = readFileSync(path.join(root, rel), "utf8");
    parsedSources.set(rel, rel.endsWith(".json") ? JSON.parse(text) : parseYaml(text));
  }
  return parsedSources.get(rel);
}

const siteYaml = parseSource("src/data/site.yaml");

/**
 * ONE walk of the scan roots, and the raw literal counts it finds.
 *
 * Starts at the repository root and removes only the declared `scanExclusions`,
 * so a new top-level directory is in scope the moment it exists rather than
 * needing to have been listed. Files are read as bytes and only decoded when a
 * literal actually appears: public/ is ~3MB of images, and decoding all of it
 * to look for two ASCII strings dominated the suite's runtime for no benefit.
 */
const excluded = new Set(scanPrecondition.scanExclusions.map((entry) => entry.path));
const scanRootFiles = walkFiles(root, excluded);
const rawText = new Map();
const rawCounts = new Map();
for (const rel of scanRootFiles) {
  const bytes = readFileSync(path.join(root, rel));
  if (!literals.some((literal) => bytes.includes(literal))) continue;
  const text = bytes.toString("utf8");
  rawText.set(rel, text);
  const counts = {};
  for (const literal of literals) {
    const found = countLiteralInString(text, literal);
    if (found > 0) counts[literal] = found;
  }
  rawCounts.set(rel, counts);
}

/**
 * Article files, derived from the contract's own `rawTextSources` glob rather
 * than a hardcoded directory and extension, so the policy stays the single
 * source of truth if that glob is ever broadened.
 */
const articleGlobs = scanPrecondition.rawTextSources.map(globToRegExp);
const articleFiles = scanRootFiles.filter((rel) => articleGlobs.some((re) => re.test(rel)));

/**
 * { [literal]: occurrenceCount } as DATA, exactly as the contract's
 * `expectedOccurrences` counts it: parsed string leaves of every declared
 * parsedDataSource (so YAML comments are excluded) plus whole article file text
 * (frontmatter INCLUDED — `excerpt` is frontmatter and it renders as the meta
 * description, og:/twitter:description, the JSON-LD description and the RSS item).
 */
const actualCounts = Object.fromEntries(
  literals.map((literal) => [
    literal,
    scanPrecondition.parsedDataSources.reduce(
      (sum, rel) => sum + countLiteralInData(parseSource(rel), literal),
      0,
    ) + articleFiles.reduce((sum, rel) => sum + (rawCounts.get(rel)?.[literal] ?? 0), 0),
  ]),
);

/** Mirrors writable-paths.v1.json's closed_set_occurrence_scan precondition: refuse on any count mismatch. */
function evaluateClosedSetScan(actualCounts, expectedOccurrences) {
  const mismatches = expectedOccurrences
    .filter(({ literal, count }) => actualCounts[literal] !== count)
    .map(({ literal, count }) => `${literal}: expected ${count}, found ${actualCounts[literal]}`);
  return { refused: mismatches.length > 0, mismatches };
}

function allPhonePatchTargets() {
  return writablePaths.files.flatMap((file) =>
    file.fields.filter((field) => field.operationKind === "public_phone_patch").flatMap((field) => field.targets),
  );
}

test("public_hours_patch is fully withdrawn", async (t) => {
  await t.test("is absent from approval-policy.v1.json's operations[]", () => {
    const operationKinds = approvalPolicy.operations.map((op) => op.operationKind);
    assert.equal(operationKinds.includes("public_hours_patch"), false);
  });

  await t.test("is absent from the candidate-manifest operation_kind enum", () => {
    assert.equal(candidateManifestSchema.properties.operation_kind.enum.includes("public_hours_patch"), false);
  });

  await t.test("has no if/then branch keyed on public_hours_patch", () => {
    const branches = JSON.stringify(candidateManifestSchema.allOf ?? candidateManifestSchema);
    assert.equal(branches.includes('"const": "public_hours_patch"'), false);
  });

  await t.test("is recorded in writable-paths.v1.json as permitted: false", () => {
    const hoursOp = writablePaths.documentedOperations.find((op) => op.operationKind === "public_hours_patch");
    assert.ok(hoursOp, "expected a documentedOperations entry for public_hours_patch");
    assert.equal(hoursOp.permitted, false);
    assert.equal(hoursOp.withdrawalStatus, "fully_withdrawn_v2");
    assert.deepEqual(hoursOp.wouldTarget.paths, [], "must not declare a live write target");
  });

  await t.test("no files[] entry declares public_hours_patch as an operationKind", () => {
    const declaredKinds = writablePaths.files.flatMap((file) => file.fields.map((f) => f.operationKind));
    assert.equal(declaredKinds.includes("public_hours_patch"), false);
  });

  await t.test("the replacement operation uses a new real field, never the withdrawn name", () => {
    const schemaSource = readFileSync(path.join(root, "src", "data", "schema.ts"), "utf8");
    assert.ok(schemaSource.includes("openingHours"));
    assert.equal(candidateManifestSchema.properties.operation_kind.enum.includes("public_opening_hours_replace"), true);
    assert.equal(candidateManifestSchema.properties.operation_kind.enum.includes("public_hours_patch"), false);
  });
});

test("public_phone_patch declares the complete 13-occurrence coupled set", () => {
  const targets = allPhonePatchTargets();
  assert.equal(targets.length, 13);

  assert.ok(scanPrecondition, "expected a closed_set_occurrence_scan precondition");
  assert.equal(scanPrecondition.totalDeclaredTargets, 13);

  const expectedSum = scanPrecondition.expectedOccurrences.reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(expectedSum, 13);
});

test("declared phone occurrences match the current repository content exactly", () => {
  for (const { literal, count } of scanPrecondition.expectedOccurrences) {
    assert.equal(
      actualCounts[literal],
      count,
      `expected ${count} occurrences of ${JSON.stringify(literal)}, found ${actualCounts[literal]}`,
    );
  }
});

test("public_phone input contract is a closed display/e164 pair with no derivation", () => {
  const contract = writablePaths.inputContracts.public_phone;
  assert.deepEqual(Object.keys(contract.inputs).sort(), ["display", "e164"]);

  for (const [name, definition] of Object.entries(contract.inputs)) {
    assert.equal("default" in definition, false, `${name} must not declare a default`);
  }

  assert.match(contract.inputs.e164.pattern, /\^\\\+/, "e164 must require a leading '+'");
  assert.equal(contract.inputs.e164.pattern.includes("tel:"), false, "e164 must not embed the tel: scheme");
});

test("every declared phone target's matchLiteral is exactly where the policy says it is", async (t) => {
  const scenarios = writablePaths.files.flatMap((file) =>
    file.fields
      .filter((field) => field.operationKind === "public_phone_patch")
      .flatMap((field) =>
        field.targets.filter((target) => target.jsonPointer).map((target) => ({ file: file.path, target })),
      ),
  );

  assert.ok(scenarios.length > 0, "expected at least one jsonPointer-addressed target");

  for (const { file, target } of scenarios) {
    await t.test(`${file}${target.jsonPointer} contains "${target.matchLiteral}"`, () => {
      const value = resolveJsonPointer(parseSource(file), target.jsonPointer);
      assert.equal(typeof value, "string", `${target.jsonPointer} must resolve to a string`);

      if (target.render === "raw") {
        assert.equal(value, target.matchLiteral, "a raw-render target must equal the literal exactly");
      } else {
        const found = countLiteralInString(value, target.matchLiteral);
        assert.equal(found, 1, `a substring target's literal must occur exactly once, found ${found}`);
      }
    });
  }
});

test("every declared article target's matchLiteral occurs exactly once in the whole file", async (t) => {
  const articleTargets = writablePaths.files
    .filter((file) => file.path.startsWith("src/content/articles/"))
    .map((file) => ({
      file: file.path,
      target: file.fields.find((f) => f.operationKind === "public_phone_patch").targets.find((t) => t.textMatch === "body"),
    }));

  assert.equal(articleTargets.length, 2);

  for (const { file, target } of articleTargets) {
    // Whole file, frontmatter included: a second occurrence appearing in
    // `excerpt` renders as the meta description and must refuse the candidate,
    // not slip past a body-only count.
    await t.test(`${file} contains "${target.matchLiteral}" exactly once`, () => {
      assert.equal(rawCounts.get(file)?.[target.matchLiteral] ?? 0, 1);
    });
  }
});

test("closed-set occurrence scan refuses the candidate on any drift", async (t) => {
  const expectedOccurrences = scanPrecondition.expectedOccurrences;
  const [displayLiteral, telLiteral] = literals;
  const actual = actualCounts;

  const scenarios = [
    {
      name: "accepts a base revision matching the current, audited content exactly",
      counts: actual,
      expectRefused: false,
    },
    {
      name: "refuses when an undeclared extra display occurrence appears",
      counts: { ...actual, [displayLiteral]: actual[displayLiteral] + 1 },
      expectRefused: true,
    },
    {
      name: "refuses when a declared display occurrence is missing (stale target)",
      counts: { ...actual, [displayLiteral]: actual[displayLiteral] - 1 },
      expectRefused: true,
    },
    {
      name: "refuses when an undeclared extra tel: occurrence appears",
      counts: { ...actual, [telLiteral]: actual[telLiteral] + 1 },
      expectRefused: true,
    },
    {
      name: "refuses when a declared tel: occurrence is missing (stale target)",
      counts: { ...actual, [telLiteral]: actual[telLiteral] - 1 },
      expectRefused: true,
    },
  ];

  for (const { name, counts, expectRefused } of scenarios) {
    await t.test(name, () => {
      const result = evaluateClosedSetScan(counts, expectedOccurrences);
      assert.equal(result.refused, expectRefused, result.mismatches.join("; "));
    });
  }
});

test("current site content is unchanged from the audited baseline", async (t) => {
  const identityPrecondition = writablePaths.preconditions.find((p) => p.path === "src/data/site.yaml" && p.assertions);

  for (const { jsonPointer, equals } of identityPrecondition.assertions) {
    await t.test(`${jsonPointer} still equals ${JSON.stringify(equals)}`, () => {
      assert.equal(resolveJsonPointer(siteYaml, jsonPointer), equals);
    });
  }

  await t.test("the booking CTA that public_hours_patch would have overwritten is untouched", () => {
    assert.equal(resolveJsonPointer(siteYaml, "/contact/action/title"), "Free 15-minute initial consultation");
  });
});

test("every phone occurrence under the scan roots is accounted for", async (t) => {
  // THE CLOSED-SET GUARANTEE, ENFORCED AGAINST THE REAL TREE.
  //
  // This is the test that makes the contract closed rather than an allowlist
  // that can silently outgrow itself. It does not consult a list of files to
  // check; it walks every file under `scanRoots` and demands that each phone
  // occurrence it finds is either counted in `expectedOccurrences` or declared
  // in `nonRenderingOccurrences`. An occurrence that is neither fails here.
  const declaredData = new Set(scanPrecondition.parsedDataSources);
  const nonRendering = new Map(
    scanPrecondition.nonRenderingOccurrences.map((entry) => [entry.path, entry.literals]),
  );

  assert.ok(scanRootFiles.length > 0, "expected the scan roots to contain files");

  await t.test("no occurrence sits in an undeclared file", () => {
    const undeclared = [...rawCounts.keys()].filter(
      (rel) =>
        !declaredData.has(rel) && !nonRendering.has(rel) && !articleGlobs.some((re) => re.test(rel)),
    );
    assert.deepEqual(
      undeclared,
      [],
      `phone occurrences found in files the closed-set scan does not declare: ${undeclared.join(", ")}. ` +
        "Either add the file to parsedDataSources/rawTextSources and declare its targets, or — only if it " +
        "genuinely cannot render — add it to nonRenderingOccurrences.",
    );
  });

  await t.test("declared non-rendering occurrences match reality exactly", async (tt) => {
    // A file can hold both kinds at once: src/data/site.yaml carries one real
    // target and one comment-borne mention of each literal. The raw count must
    // therefore equal the file's parsed-data count plus its declared
    // non-rendering count — never just one of the two.
    for (const [rel, expected] of nonRendering) {
      await tt.test(rel, () => {
        const actual = rawCounts.get(rel) ?? {};
        const data = declaredData.has(rel) ? parseSource(rel) : null;
        for (const [literal, count] of Object.entries(expected)) {
          const inData = data === null ? 0 : countLiteralInData(data, literal);
          assert.equal(
            actual[literal] ?? 0,
            count + inData,
            `${rel}: expected ${count} non-rendering + ${inData} data occurrence(s) of ${JSON.stringify(literal)}, found ${actual[literal] ?? 0} raw`,
          );
        }
      });
    }
  });

  await t.test("every declared non-rendering occurrence really sits in a comment", () => {
    // A path-scoped allowlist is not enough. `nonRenderingOccurrences` says a
    // file's occurrences are comments, so the totals stay balanced even if a
    // comment occurrence is REPLACED by a live one — the count never moves.
    // That is not hypothetical: a hardcoded `const telephone = "+64 21 021
    // 68888"` was briefly introduced into src/lib/structured-data.ts, replacing
    // the value derived from the tel: href. The count stayed at 1 and every
    // other assertion here passed, while the JSON-LD telephone silently became
    // the 12-digit display form instead of the dialable one. Checking that each
    // declared occurrence is on a comment line is what catches that.
    const commentLine = {
      ".yaml": (line) => line.trimStart().startsWith("#"),
      ".yml": (line) => line.trimStart().startsWith("#"),
      ".ts": (line) => /^(?:\/\/|\/\*|\*)/.test(line.trimStart()),
      ".js": (line) => /^(?:\/\/|\/\*|\*)/.test(line.trimStart()),
      ".mjs": (line) => /^(?:\/\/|\/\*|\*)/.test(line.trimStart()),
    };

    for (const [rel, expected] of nonRendering) {
      const isComment = commentLine[path.extname(rel)];
      assert.ok(isComment, `no comment syntax known for ${rel} — extend commentLine before allowlisting it`);

      const lines = (rawText.get(rel) ?? "").split("\n");
      for (const [literal, declared] of Object.entries(expected)) {
        // Count the occurrences that ARE on comment lines. Requiring this to
        // equal the declared count catches both directions: a comment
        // occurrence replaced by live code (count falls), and a comment that
        // quietly went away. A live occurrence added alongside the comment
        // moves the raw tree total instead, which the next subtest catches.
        const inComments = lines
          .filter((line) => isComment(line))
          .reduce((sum, line) => sum + countLiteralInString(line, literal), 0);
        assert.equal(
          inComments,
          declared,
          `${rel}: declared ${declared} non-rendering (comment) occurrence(s) of ${JSON.stringify(literal)}, ` +
            `found ${inComments}. A non-rendering allowlist entry may only cover comments — if the literal now ` +
            "appears in live code, it must be a declared target or must not exist.",
        );
      }
    }
  });

  await t.test("raw tree total equals declared data targets plus declared non-rendering occurrences", async (tt) => {
    for (const { literal, count } of scanPrecondition.expectedOccurrences) {
      await tt.test(JSON.stringify(literal), () => {
        const rawTotal = [...rawCounts.values()].reduce((sum, byLiteral) => sum + (byLiteral[literal] ?? 0), 0);
        const declaredNonRendering = [...nonRendering.values()].reduce(
          (sum, byLiteral) => sum + (byLiteral[literal] ?? 0),
          0,
        );
        assert.equal(
          rawTotal,
          count + declaredNonRendering,
          `${literal}: raw tree has ${rawTotal}, contract accounts for ${count} target(s) + ${declaredNonRendering} non-rendering`,
        );
      });
    }
  });
});

test("the coupled set is atomic across exactly the files that declare targets", () => {
  const coupled = writablePaths.coupledSet;
  assert.ok(coupled, "expected a coupledSet declaration");
  assert.equal(coupled.writeMode, "atomic_across_files");
  assert.equal(coupled.operationKind, "public_phone_patch");

  const declaringFiles = writablePaths.files
    .filter((file) => file.fields.some((field) => field.operationKind === "public_phone_patch"))
    .map((file) => file.path);
  assert.deepEqual(
    [...coupled.paths].sort(),
    [...declaringFiles].sort(),
    "coupledSet.paths must be exactly the files declaring public_phone_patch targets",
  );
  assert.equal(coupled.totalTargets, allPhonePatchTargets().length);
  assert.equal(coupled.totalTargets, scanPrecondition.totalDeclaredTargets);
});

test("the candidate manifest binds a phone patch to the whole coupled set", async (t) => {
  // Structural assertions, not a validator run: the suite stays dependency-free.
  // These fail if someone relaxes the constraint that makes a subset-write,
  // a foreign path, or a create/delete escalation refuse at schema validation.
  const branch = candidateManifestSchema.allOf.find(
    (entry) => entry.if?.properties?.operation_kind?.const === "public_phone_patch",
  );
  assert.ok(branch, "expected a public_phone_patch branch");
  const changed = branch.then.properties.changed_paths;
  assert.ok(changed, "the public_phone_patch branch must constrain changed_paths");

  const coupled = writablePaths.coupledSet;

  await t.test("cannot declare fewer or more paths than the coupled set", () => {
    assert.equal(changed.minItems, coupled.paths.length);
    assert.equal(changed.maxItems, coupled.paths.length);
    assert.equal(changed.uniqueItems, true);
  });

  await t.test("every coupled path is individually required", () => {
    const required = changed.allOf.map((entry) => entry.contains.properties.path.const);
    assert.deepEqual([...required].sort(), [...coupled.paths].sort());
  });

  await t.test("no path outside the coupled set is permitted", () => {
    assert.deepEqual([...changed.items.properties.path.enum].sort(), [...coupled.paths].sort());
  });

  await t.test("a phone patch may only modify, never add or delete", () => {
    assert.equal(changed.items.properties.change.const, "modify");
  });
});

test("the candidate manifest pins the writable policy version it was built against", async (t) => {
  const pinned = candidateManifestSchema.properties.writable_policy_version;

  await t.test("the field exists and is required", () => {
    assert.ok(pinned, "expected a writable_policy_version property");
    assert.ok(
      candidateManifestSchema.required.includes("writable_policy_version"),
      "writable_policy_version must be required — an optional pin is not a pin",
    );
  });

  await t.test("the pin tracks this contract's actual schemaVersion", () => {
    // Guards the drift that a digest field alone could not catch: a publisher
    // still holding an older writable policy declares an older version here and
    // fails schema validation instead of writing a stale subset of targets.
    assert.equal(
      pinned.const,
      writablePaths.schemaVersion,
      "bump writable_policy_version in the candidate manifest schema whenever writable-paths.v1.json's schemaVersion changes",
    );
  });
});

// ── site_text_patch (writable-paths v4 textPatch) ───────────────────────────
//
// The text-patch surface widens the write surface beyond the phone fact, so
// its own contract-vs-repository invariants get the same treatment: every
// enumerated surface must resolve in the live YAML to a writable single-line
// string, no surface may alias a pointer the policy elsewhere forbids, and
// the three governance files must agree about the operation.

const textPatch = writablePaths.textPatch;
const pagesYamlLive = JSON.parse(JSON.stringify(parseYaml(readFileSync(path.join(root, "src/data/pages.yaml"), "utf8"))));

test("textPatch declares a coherent operation", async (t) => {
  await t.test("has the expected identity and write mode", () => {
    assert.equal(textPatch.operationKind, "site_text_patch");
    assert.equal(textPatch.proposalField, "site_text");
    assert.equal(textPatch.artifactClass, "site_text_patch");
    assert.equal(textPatch.writeMode, "atomic");
  });
  await t.test("bounds every candidate", () => {
    assert.ok(Number.isInteger(textPatch.constraints.maxSurfacesPerCandidate) && textPatch.constraints.maxSurfacesPerCandidate >= 1);
    assert.ok(Number.isInteger(textPatch.constraints.maxValueBytes) && textPatch.constraints.maxValueBytes >= 1);
    assert.ok(textPatch.constraints.maxTotalValueBytes >= textPatch.constraints.maxValueBytes);
    assert.equal(textPatch.constraints.valueNewlines, "forbidden");
  });
  await t.test("file allowlist is the two content models, sorted and unique", () => {
    assert.deepEqual([...textPatch.files].sort(), ["src/data/pages.yaml", "src/data/site.yaml"]);
    assert.equal(new Set(textPatch.files).size, textPatch.files.length);
  });
  await t.test("preserved literals are exactly the closed-set scan's literals", () => {
    assert.deepEqual(
      textPatch.constraints.preserveLiteralOccurrences.map((entry) => entry.literal).sort(),
      [...literals].sort(),
    );
  });
});

test("every enumerated text surface resolves to a writable single-line string", () => {
  const seen = new Set();
  for (const surface of textPatch.enumeratedSurfaces) {
    assert.match(surface.surfaceId, /^[a-z0-9.-]+$/, `${surface.surfaceId} has a non-canonical id`);
    assert.ok(!seen.has(surface.surfaceId), `${surface.surfaceId} is declared twice`);
    seen.add(surface.surfaceId);
    assert.ok(textPatch.files.includes(surface.file), `${surface.surfaceId} targets a file outside the allowlist`);
    assert.equal(surface.file, "src/data/site.yaml", "enumerated surfaces are the site.yaml catalogue");
    assert.ok(typeof surface.meaning === "string" && surface.meaning.length > 0, `${surface.surfaceId} lacks a meaning binding`);
    const value = resolveJsonPointer(siteYaml, surface.jsonPointer);
    assert.equal(typeof value, "string", `${surface.surfaceId} (${surface.jsonPointer}) does not resolve to a string`);
    assert.ok(!value.includes("\n"), `${surface.surfaceId} resolves to a multi-line scalar the splice writer cannot rewrite`);
  }
});

test("no text surface aliases a forbidden pointer", () => {
  const forbiddenExact = new Set([
    "/contact/action/title",
    "/contact/action/ctaLabel",
    "/contact/rows/0/value",
    "/contact/rows/0/label",
    "/hero/ctas/1/label",
    "/hero/ctas/1/variant",
    "/story/heading",
    "/meta/lang",
    "/meta/themeColor",
  ]);
  const forbiddenTails = [
    "/href",
    "/ctaHref",
    "/kind",
    "/variant",
    "/icon",
    "/external",
    "/number",
    "/src",
    "/width",
    "/height",
    "/label",
    "/linkLabel",
    "/ctaLabel",
    "/filtersLabel",
    "/ariaLabel",
    "/skipLabel",
    "/menuOpenLabel",
    "/menuCloseLabel",
  ];
  for (const surface of textPatch.enumeratedSurfaces) {
    assert.ok(!forbiddenExact.has(surface.jsonPointer), `${surface.surfaceId} targets forbidden pointer ${surface.jsonPointer}`);
    for (const tail of forbiddenTails) {
      assert.ok(!surface.jsonPointer.endsWith(tail), `${surface.surfaceId} targets a ${tail} pointer`);
    }
    assert.ok(!surface.jsonPointer.startsWith("/articlePages"), `${surface.surfaceId} targets attribution chrome`);
    assert.ok(!surface.jsonPointer.startsWith("/story/credit"), `${surface.surfaceId} targets testimonial attribution`);
    assert.ok(!surface.jsonPointer.startsWith("/nav/"), `${surface.surfaceId} targets navigation`);
    assert.ok(!surface.jsonPointer.startsWith("/filters"), `${surface.surfaceId} targets the filter list`);
  }
});

test("patterned page surfaces exclude provenance, attribution and structure", async (t) => {
  const patterned = textPatch.patternedSurfaces;
  await t.test("slug allowlist excludes home, testimonials and articles-advice", () => {
    assert.equal(patterned.file, "src/data/pages.yaml");
    for (const slug of ["home", "testimonials", "articles-advice"]) {
      assert.ok(!patterned.slugs.includes(slug), `${slug} must not be text-patchable`);
    }
    for (const slug of patterned.slugs) {
      assert.ok(Object.hasOwn(pagesYamlLive, slug), `${slug} is not a page in pages.yaml`);
    }
  });
  await t.test("quote sections are excluded and meta/href/kind are not fields", () => {
    assert.ok(patterned.excludeSectionKinds.includes("quote"));
    assert.deepEqual(patterned.fields, ["title", "description", "sections/*/heading", "sections/*/body", "sections/*/items/*"]);
  });
});

test("approval policy and candidate manifest carry the operation coherently", async (t) => {
  await t.test("approval-policy has exactly one site_text_patch entry with one stage", () => {
    const entries = approvalPolicy.operations.filter((op) => op.operationKind === "site_text_patch");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].artifactClass, "site_text_patch");
    assert.deepEqual(entries[0].requiredApprovalStages, ["publication_approval"]);
  });
  await t.test("candidate-manifest enums include the operation and artifact class", () => {
    assert.ok(candidateManifestSchema.properties.operation_kind.enum.includes("site_text_patch"));
    assert.ok(candidateManifestSchema.properties.artifact_class.enum.includes("site_text_patch"));
  });
  await t.test("the site_text_patch branch pins class, stage and changed paths", () => {
    const branch = candidateManifestSchema.allOf.find(
      (entry) => entry.if?.properties?.operation_kind?.const === "site_text_patch",
    );
    assert.ok(branch, "candidate manifest lacks a site_text_patch branch");
    assert.equal(branch.then.properties.artifact_class.const, "site_text_patch");
    assert.equal(branch.then.properties.required_approval_stages.maxItems, 1);
    assert.equal(branch.then.properties.required_approval_stages.prefixItems[0].const, "publication_approval");
    const changed = branch.then.properties.changed_paths;
    assert.equal(changed.minItems, 1);
    assert.equal(changed.maxItems, textPatch.files.length);
    assert.deepEqual([...changed.items.properties.path.enum].sort(), [...textPatch.files].sort());
    assert.equal(changed.items.properties.change.const, "modify");
  });
});

// ── article_publish (writable-paths v5 articlePublish) ──────────────────────
//
// The create-only article operation implements the six preconditions the v2
// contract wrote down. These tests hold the contract to the repository the
// same way the phone and text suites do: the category vocabulary must equal
// the client's live filter list, the frontmatter contract must mirror the
// standalone JSON schema and the enforcing zod source, the markdown contract
// must stay a strict subset of the markdown policy, and the three governance
// files must agree about the operation.

const articlePublish = writablePaths.articlePublish;
const frontmatterSchema = readJson("schemas", "article-frontmatter.v1.schema.json");
const markdownPolicy = readJson("markdown-policy.v1.json");
const contentConfigSource = readFileSync(path.join(root, "src/content.config.ts"), "utf8");

test("articlePublish declares the create-only authored contract", async (t) => {
  await t.test("identity, write mode and directory", () => {
    assert.equal(articlePublish.operationKind, "article_publish");
    assert.equal(articlePublish.proposalField, "site_article");
    assert.equal(articlePublish.artifactClass, "article");
    assert.equal(articlePublish.writeMode, "create_only");
    assert.equal(articlePublish.directory, "src/content/articles");
  });
  await t.test("bounds are sane and carrier dominates body", () => {
    const c = articlePublish.constraints;
    for (const bound of [c.maxSlugLength, c.maxTitleLength, c.maxExcerptLength, c.maxCategories, c.maxBodyBytes, c.maxCarrierBytes]) {
      assert.ok(Number.isInteger(bound) && bound >= 1);
    }
    assert.ok(c.maxCarrierBytes > c.maxBodyBytes);
  });
  await t.test("the documented refused-operation entry is gone and hours stays withdrawn", () => {
    const kinds = writablePaths.documentedOperations.map((entry) => entry.operationKind);
    assert.ok(!kinds.includes("article_publish"), "the documented article entry must be replaced by the articlePublish block");
    assert.ok(kinds.includes("public_hours_patch"));
  });
});

test("the category vocabulary equals the client's live filter list", () => {
  const filters = resolveJsonPointer(pagesYamlLive, "/articles-advice/sections/1/items");
  assert.ok(Array.isArray(filters), "articles-advice filter list moved — update categoryVocabularySource");
  const expected = filters.filter((entry) => entry !== "All" && entry !== "Uncategorized");
  assert.deepEqual([...articlePublish.categoryVocabulary].sort(), [...expected].sort());
  assert.ok(!articlePublish.categoryVocabulary.includes("All"));
  assert.ok(!articlePublish.categoryVocabulary.includes("Uncategorized"));
});

test("the frontmatter contract mirrors the schema and the enforcing zod source", async (t) => {
  await t.test("required keys equal the JSON schema's required set", () => {
    assert.deepEqual([...articlePublish.frontmatterContract.requiredKeys].sort(), [...frontmatterSchema.required].sort());
  });
  await t.test("forbidden keys exist in the schema but are never required", () => {
    for (const key of articlePublish.frontmatterContract.forbiddenKeys) {
      assert.ok(Object.hasOwn(frontmatterSchema.properties, key), `${key} is not a schema property`);
      assert.ok(!frontmatterSchema.required.includes(key), `${key} is required by the schema and cannot be forbidden`);
    }
  });
  await t.test("the wall-clock pattern is the schema's own offset-free pattern", () => {
    assert.equal(articlePublish.frontmatterContract.wallClockPattern, frontmatterSchema.$defs.wallClock.pattern);
    assert.equal(articlePublish.frontmatterContract.timezone, "Pacific/Auckland");
  });
  await t.test("the enforcing zod source names every required key (drift tripwire)", () => {
    for (const key of articlePublish.frontmatterContract.requiredKeys) {
      assert.ok(contentConfigSource.includes(key), `src/content.config.ts no longer names frontmatter key ${key}`);
    }
  });
});

test("the markdown contract is a strict subset of the markdown policy", async (t) => {
  const md = articlePublish.markdownContract;
  await t.test("executing verifier class and fail-closed settings", () => {
    assert.equal(md.verifierClass, "conservative-textual-v1");
    assert.equal(md.forbidRawHtml, true);
    assert.equal(md.forbidImages, true);
    assert.equal(md.forbidReferenceLinks, true);
    assert.equal(md.forbidAutolinkLiterals, true);
    assert.equal(md.attributionLineRule, "refuse");
    assert.deepEqual(md.linkProtocols, ["https://"]);
  });
  await t.test("nothing the contract permits is denied by the policy", () => {
    assert.ok(markdownPolicy.allowedNodeTypes.includes("link"), "the policy no longer allows links at all");
    assert.ok(markdownPolicy.allowedNodeTypes.includes("heading"));
    // The policy's only autolink protocol is mailto:, which the contract's
    // forbidAutolinkLiterals refuses entirely — stricter, never wider.
    assert.ok(md.forbidAutolinkLiterals === true || markdownPolicy.autolinkLiteralProtocols.length === 0);
  });
  await t.test("heading depth stays within a document heading budget", () => {
    assert.ok(md.maxHeadingDepth >= 1 && md.maxHeadingDepth <= 3);
  });
});

test("approval policy and candidate manifest carry article_publish coherently", async (t) => {
  await t.test("approval-policy keeps the two-stage entry", () => {
    const entries = approvalPolicy.operations.filter((op) => op.operationKind === "article_publish");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].artifactClass, "article");
    assert.deepEqual(entries[0].requiredApprovalStages, ["legal_sign_off", "publication_approval"]);
  });
  await t.test("the article branch pins create-only changed paths", () => {
    const branch = candidateManifestSchema.allOf.find(
      (entry) => entry.if?.properties?.operation_kind?.const === "article_publish",
    );
    assert.ok(branch, "candidate manifest lacks an article_publish branch");
    const changed = branch.then.properties.changed_paths;
    assert.ok(changed, "article branch lacks a changed_paths constraint");
    assert.equal(changed.minItems, 1);
    assert.equal(changed.maxItems, 1);
    assert.equal(changed.items.properties.change.const, "add");
    assert.match("src/content/articles/a-new-article.md", new RegExp(changed.items.properties.path.pattern));
    assert.doesNotMatch("src/content/articles/UPPER.md", new RegExp(changed.items.properties.path.pattern));
    assert.doesNotMatch("src/data/site.yaml", new RegExp(changed.items.properties.path.pattern));
  });
});

// ── governed-site expansion tranche (writable-paths v6) ────────────────────

const materialiserFiles = [
  "src/data/site.yaml",
  "src/data/pages.yaml",
  "src/data/typed-pages.yaml",
  "src/content/articles/can-ird-arrest-me-at-the-border-over-my-student-loan.md",
  "src/content/articles/i-live-in-australia-and-my-nz-student-loan-has-doubled-what-can-i-do.md",
];

function materialiserBase(overrides = {}) {
  const files = Object.fromEntries(materialiserFiles.map((file) => [file, readFileSync(path.join(root, file), "utf8")]));
  const modes = Object.fromEntries(materialiserFiles.map((file) => [file, "100644"]));
  const fileSha256 = Object.fromEntries(materialiserFiles.map((file) => [file, `sha256:${createHash("sha256").update(files[file]).digest("hex")}`]));
  return {
    revision: "a".repeat(40),
    expectedRevision: "a".repeat(40),
    writablePolicyVersion: writablePaths.schemaVersion,
    approvalPolicyVersion: approvalPolicy.schemaVersion,
    authorityDigests: { ...GOVERNED_AUTHORITY_DIGESTS },
    inventoryComplete: true,
    files,
    fileSha256,
    modes,
    publishedRoutes: ["/", "/about-dave/", "/articles/", "/contact/", "/ird-disputes-tax-penalties-negotiation/", "/student-loan-negotiations/", "/testimonials/"],
    ...overrides,
  };
}

const sourceDigest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

function materialise(operationKind, proposal, base = materialiserBase()) {
  return materialiseGovernedOperation({ operationKind, proposal, base });
}

function assertRefusal(code, callback) {
  assert.throws(callback, (error) => error instanceof GovernedMaterialiserRefusal && error.code === code);
}

test("selected operations have exact policy, artifact and ceremony bindings", () => {
  const expected = {
    site_link_patch: ["site_link_patch", ["publication_approval"]],
    typed_page_create: ["typed_page", ["legal_sign_off", "publication_approval"]],
    public_email_patch: ["public_email_fact", ["publication_approval"]],
    public_opening_hours_replace: ["public_opening_hours", ["publication_approval"]],
  };
  for (const [operationKind, [artifactClass, stages]] of Object.entries(expected)) {
    const policy = approvalPolicy.operations.filter((entry) => entry.operationKind === operationKind);
    assert.equal(policy.length, 1, `${operationKind} must have one approval entry`);
    assert.equal(policy[0].artifactClass, artifactClass);
    assert.deepEqual(policy[0].requiredApprovalStages, stages);
    assert.ok(candidateManifestSchema.properties.operation_kind.enum.includes(operationKind));
    assert.ok(candidateManifestSchema.properties.artifact_class.enum.includes(artifactClass));
    const branch = candidateManifestSchema.allOf.find((entry) => entry.if?.properties?.operation_kind?.const === operationKind);
    assert.ok(branch, `${operationKind} candidate branch is missing`);
    assert.equal(branch.then.properties.artifact_class.const, artifactClass);
    assert.deepEqual(branch.then.properties.required_approval_stages.prefixItems.map((entry) => entry.const), stages);
  }
  assert.equal(candidateManifestSchema.properties.writable_policy_version.const, writablePaths.schemaVersion);
  assert.equal(candidateManifestSchema.properties.approval_policy_version.const, approvalPolicy.schemaVersion);
});

test("link catalogue semantic IDs are stable, role-bound, unique and resolve exactly once", () => {
  const found = new Map();
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && typeof value.id === "string" && value.binding === value.id) found.set(value.id, (found.get(value.id) ?? 0) + 1);
    for (const child of Object.values(value)) walk(child);
  };
  walk(siteYaml);
  const surfaceIds = writablePaths.linkPatch.surfaces.map((surface) => surface.surfaceId);
  assert.deepEqual(surfaceIds, [...surfaceIds].sort(), "link surface IDs must be lexical");
  assert.equal(new Set(surfaceIds).size, surfaceIds.length);
  for (const surface of writablePaths.linkPatch.surfaces) {
    assert.equal(found.get(surface.semanticId), 1, `${surface.surfaceId} must resolve one stable semantic object`);
    assert.deepEqual(surface.requiredTogether, ["label", "destination"]);
    assert.ok(surface.destinationKinds.every((kind) => kind === "internal_route" || kind === "external_https"));
    if (surface.destinationKinds.includes("external_https")) {
      const base = new URL(surface.baseIdentity.href);
      assert.deepEqual(surface.allowedExternalPaths, [base.pathname], `${surface.surfaceId} must pin its reviewed external path`);
      assert.deepEqual(surface.allowedExternalHosts, [base.hostname], `${surface.surfaceId} must pin its reviewed external host`);
    }
  }
});

test("strict schema mirrors include stable IDs, typed pages and nullable opening hours", () => {
  const siteSchemaMirror = readJson("schemas", "site.v1.schema.json");
  const typedSchemaMirror = readJson("schemas", "typed-pages.v1.schema.json");
  const carrierSchemaMirror = readJson("schemas", "operation-carriers.v1.schema.json");
  assert.ok(siteSchemaMirror.required.includes("openingHours"));
  assert.ok(siteSchemaMirror.properties.openingHours.oneOf.some((entry) => entry.type === "null"));
  assert.ok(siteSchemaMirror.$defs.navItem.required.includes("id"));
  assert.ok(siteSchemaMirror.$defs.navItem.required.includes("binding"));
  assert.ok(siteSchemaMirror.$defs.link.required.includes("id"));
  assert.ok(siteSchemaMirror.$defs.link.required.includes("binding"));
  assert.equal(typedSchemaMirror.additionalProperties, false);
  assert.equal(typedSchemaMirror.$defs.serviceDetail.additionalProperties, false);
  assert.deepEqual(typedSchemaMirror.$defs.serviceDetail.properties.pageType, { const: "service_detail" });
  assert.equal(typedSchemaMirror.$defs.serviceDetail.properties.sections.maxItems, 12);
  assert.equal(carrierSchemaMirror.oneOf.length, 4);
  for (const name of ["siteLinkPatch", "typedPageCreate", "publicEmailPatch", "publicOpeningHoursReplace"]) {
    assert.equal(carrierSchemaMirror.$defs[name].additionalProperties, false);
  }
});

test("committed expansion fixtures are secret-free executable golden vectors", async (t) => {
  assert.equal(expansionFixtures.schemaVersion, 1);
  assert.equal(expansionFixtures.success.length, 4);
  const encoded = JSON.stringify(expansionFixtures);
  assert.equal(/(?:api[_-]?key|password|secret|bearer\s)/iu.test(encoded), false);
  for (const fixture of expansionFixtures.success) {
    await t.test(`${fixture.operationKind} success`, () => {
      const result = materialise(fixture.operationKind, fixture.proposal);
      assert.equal(result.artifactClass, fixture.artifactClass);
      assert.deepEqual(result.requiredApprovalStages, fixture.requiredApprovalStages);
      assert.deepEqual(result.changes.map((entry) => entry.path), fixture.changedPaths);
    });
  }
  for (const fixture of expansionFixtures.refusals) {
    await t.test(fixture.name, () => assertRefusal(fixture.expectedCode, () => materialise(fixture.operationKind, fixture.proposal)));
  }
});

test("site_link_patch materialises only its coupled semantic label and destination", () => {
  const result = materialise("site_link_patch", {
    schemaVersion: 1,
    links: [{ surfaceId: "site.header.contact", label: "Contact Dave", destination: { kind: "internal_route", value: "/contact/" } }],
    navigationOrders: [],
  });
  assert.equal(result.artifactClass, "site_link_patch");
  assert.deepEqual(result.requiredApprovalStages, ["publication_approval"]);
  assert.deepEqual(result.changes.map((entry) => entry.path), ["src/data/site.yaml"]);
  const after = parseYaml(result.changes[0].after);
  assert.equal(after.nav.items.contact.label, "Contact Dave");
  assert.equal(after.nav.items.contact.href, "/contact/");
  const before = parseYaml(result.changes[0].before);
  after.nav.items.contact = before.nav.items.contact;
  assert.deepEqual(after, before, "link materialiser changed unrelated site semantics");
});

test("every link catalogue entry materialises through its declared label/href pointers", async (t) => {
  for (const surface of writablePaths.linkPatch.surfaces) {
    await t.test(surface.surfaceId, () => {
      const currentLabel = resolveJsonPointer(siteYaml, surface.labelPointer);
      const currentHref = resolveJsonPointer(siteYaml, surface.hrefPointer);
      const result = materialise("site_link_patch", {
        schemaVersion: 1,
        links: [{
          surfaceId: surface.surfaceId,
          label: `${currentLabel} updated`,
          destination: { kind: surface.destinationKinds[0], value: currentHref },
        }],
        navigationOrders: [],
      });
      const after = parseYaml(result.changes[0].after);
      assert.equal(resolveJsonPointer(after, surface.labelPointer), `${currentLabel} updated`);
      assert.equal(resolveJsonPointer(after, surface.hrefPointer), currentHref);
    });
  }
});

test("site_link_patch enforces exact navigation permutations", () => {
  const result = materialise("site_link_patch", {
    schemaVersion: 1,
    links: [{ surfaceId: "site.header.contact", label: "Contact", destination: { kind: "internal_route", value: "/contact/" } }],
    navigationOrders: [{ groupId: "site.header.primary", itemIds: ["contact", "about", "expertise", "stories", "articles"] }],
  });
  const after = parseYaml(result.changes[0].after);
  assert.deepEqual(after.nav.order.map((key) => after.nav.items[key].label), ["Contact", "About Dave", "Expertise", "Client stories", "Articles & media"]);
  assertRefusal("invalid_order", () => materialise("site_link_patch", {
    schemaVersion: 1,
    links: [{ surfaceId: "site.header.contact", label: "Contact", destination: { kind: "internal_route", value: "/contact/" } }],
    navigationOrders: [{ groupId: "site.header.primary", itemIds: ["contact"] }],
  }));
});

test("keyed navigation preserves semantic link authority after a prior reorder", () => {
  const firstBase = materialiserBase();
  const reordered = materialise("site_link_patch", {
    schemaVersion: 1,
    links: [{ surfaceId: "site.header.contact", label: "Contact", destination: { kind: "internal_route", value: "/contact/" } }],
    navigationOrders: [{ groupId: "site.header.primary", itemIds: ["contact", "about", "expertise", "stories", "articles"] }],
  }, firstBase);
  firstBase.files["src/data/site.yaml"] = reordered.changes[0].after;
  firstBase.fileSha256["src/data/site.yaml"] = sourceDigest(reordered.changes[0].after);
  const next = materialise("site_link_patch", {
    schemaVersion: 1,
    links: [{ surfaceId: "site.header.contact", label: "Contact Dave", destination: { kind: "internal_route", value: "/contact/" } }],
    navigationOrders: [],
  }, firstBase);
  const after = parseYaml(next.changes[0].after);
  assert.equal(after.nav.items.contact.label, "Contact Dave");
  assert.deepEqual(after.nav.order, ["contact", "about", "expertise", "stories", "articles"]);
});

test("sequential typed page navigation remains creatable and exactly reorderable", () => {
  const base = materialiserBase();
  const create = (slug, position) => materialise("typed_page_create", {
    schemaVersion: 1,
    page: { pageType: "service_detail", slug, title: `${slug} service`, description: `${slug} service description`, sections: [] },
    navigationPlacement: { groupId: "site.header.primary", label: `${slug} service`, position },
  }, base);
  for (const [slug, position] of [["first-service", 5], ["second-service", 6]]) {
    const result = create(slug, position);
    for (const change of result.changes) {
      base.files[change.path] = change.after;
      base.fileSha256[change.path] = sourceDigest(change.after);
    }
  }
  const liveOrder = parseYaml(base.files["src/data/site.yaml"]).nav.order;
  assert.equal(liveOrder.length, 7);
  const reordered = materialise("site_link_patch", {
    schemaVersion: 1,
    links: [{ surfaceId: "site.header.contact", label: "Contact Dave", destination: { kind: "internal_route", value: "/contact/" } }],
    navigationOrders: [{ groupId: "site.header.primary", itemIds: [...liveOrder].reverse() }],
  }, base);
  const after = parseYaml(reordered.changes[0].after);
  assert.deepEqual(after.nav.order, [...liveOrder].reverse());
  assert.equal(after.nav.items.contact.label, "Contact Dave");
});

test("typed_page_create appends one strict rendered record and optional navigation atomically", () => {
  const proposal = {
    schemaVersion: 1,
    page: {
      pageType: "service_detail",
      slug: "tax-audit-support",
      title: "Tax audit support",
      description: "Advice and representation during an Inland Revenue audit.",
      sections: [
        { kind: "prose", heading: "Clear representation", body: "Understand the issues, evidence and next steps." },
        { kind: "list", heading: "Support includes", items: ["Reviewing correspondence", "Preparing a response"] },
      ],
    },
    navigationPlacement: { groupId: "site.header.primary", label: "Tax audit support", position: 4 },
  };
  const result = materialise("typed_page_create", proposal);
  assert.deepEqual(result.changes.map((entry) => entry.path), ["src/data/site.yaml", "src/data/typed-pages.yaml"]);
  assert.deepEqual(parseYaml(result.changes[1].after).pages, [proposal.page]);
  const siteAfter = parseYaml(result.changes[0].after);
  assert.deepEqual(siteAfter.nav.items["page.tax-audit-support"], { id: "header.page.tax-audit-support", binding: "header.page.tax-audit-support", label: "Tax audit support", href: "/tax-audit-support/" });
  assert.equal(siteAfter.nav.order[4], "page.tax-audit-support");
  assert.deepEqual(result.requiredApprovalStages, ["legal_sign_off", "publication_approval"]);
});

test("public_email_patch updates the complete coupled set and no other semantics", () => {
  const result = materialise("public_email_patch", { schemaVersion: 1, display: "office@example.invalid", mailto: "inbox@example.invalid" });
  assert.deepEqual(result.changes.map((entry) => entry.path), [
    "src/content/articles/can-ird-arrest-me-at-the-border-over-my-student-loan.md",
    "src/content/articles/i-live-in-australia-and-my-nz-student-loan-has-doubled-what-can-i-do.md",
    "src/data/pages.yaml",
    "src/data/site.yaml",
  ]);
  const siteAfter = parseYaml(result.changes.find((entry) => entry.path === "src/data/site.yaml").after);
  assert.equal(siteAfter.contact.rows[1].value, "office@example.invalid");
  assert.equal(siteAfter.contact.rows[1].href, "mailto:inbox@example.invalid");
  assert.equal(siteAfter.expertise.items[2].href, "mailto:inbox@example.invalid?subject=Business%20tax%20matter");
  assert.equal(siteAfter.footer.links[2].href, "mailto:inbox@example.invalid");
  for (const change of result.changes) assert.equal(change.after.includes("dave@davetaxnz.nz"), false, change.path);
});

test("public email targets exhaust every non-excluded repository occurrence", () => {
  const contract = writablePaths.publicEmailPatch;
  const display = siteYaml.contact.rows[1].value;
  const mailto = siteYaml.contact.rows[1].href.slice("mailto:".length).split("?")[0];
  const needles = [...new Set([display, mailto])];
  const excludedRoots = new Set(contract.scanExclusions.map((entry) => entry.path));
  const declaredPaths = new Set(contract.targets.map((target) => target.path));
  const matches = scanRootFiles.filter((file) => !excludedRoots.has(file.split("/")[0])).flatMap((file) => {
    const text = readFileSync(path.join(root, file), "utf8");
    const count = needles.reduce((total, needle) => total + countLiteralInString(text, needle), 0);
    return count > 0 ? [{ file, count }] : [];
  });
  assert.deepEqual(matches.map(({ file }) => file).sort(), [...declaredPaths].sort(), "public email exists outside its coupled set");
  for (const { file, count } of matches) {
    const target = contract.targets.find((entry) => entry.path === file);
    const expected = target.pointers?.length ?? target.expectedOccurrences;
    assert.equal(count, expected, `${file} has an undeclared public-email occurrence`);
  }
});

test("public_opening_hours_replace binds structured and display facts without a default", () => {
  assert.equal(siteYaml.openingHours, null);
  const result = materialise("public_opening_hours_replace", {
    schemaVersion: 1,
    timezone: "Pacific/Auckland",
    weekly: [
      { day: "monday", intervals: [{ opens: "09:00", closes: "12:00" }, { opens: "13:00", closes: "17:00" }] },
      { day: "friday", intervals: [{ opens: "09:00", closes: "15:00" }] },
    ],
    display: "Monday 9:00am–5:00pm; Friday 9:00am–3:00pm",
  });
  assert.deepEqual(result.changes.map((entry) => entry.path), ["src/data/site.yaml"]);
  const hours = parseYaml(result.changes[0].after).openingHours;
  assert.equal(hours.timezone, "Pacific/Auckland");
  assert.equal(hours.weekly.length, 2);
  assert.equal(hours.display, "Monday 9:00am–5:00pm; Friday 9:00am–3:00pm");
});

test("adversarial carriers refuse atomically before any projection", async (t) => {
  const validLink = {
    schemaVersion: 1,
    links: [{ surfaceId: "site.header.contact", label: "Contact", destination: { kind: "internal_route", value: "/contact/" } }],
    navigationOrders: [],
  };
  const scenarios = [
    ["stale base", "stale_base", () => materialise("site_link_patch", validLink, materialiserBase({ expectedRevision: "b".repeat(40) }))],
    ["stale policy", "stale_contract", () => materialise("site_link_patch", validLink, materialiserBase({ writablePolicyVersion: writablePaths.schemaVersion - 1 }))],
    ["wrong authority digest", "stale_contract", () => { const base = materialiserBase(); base.authorityDigests["schemas/operation-carriers.v1.schema.json"] = `sha256:${"0".repeat(64)}`; return materialise("site_link_patch", validLink, base); }],
    ["stale source blob", "stale_source", () => { const base = materialiserBase(); base.files["src/data/site.yaml"] += "\n"; return materialise("site_link_patch", validLink, base); }],
    ["symlink target", "unsafe_mode", () => { const base = materialiserBase(); base.modes["src/data/site.yaml"] = "120000"; return materialise("site_link_patch", validLink, base); }],
    ["caller path", "unknown_field", () => materialise("site_link_patch", { ...validLink, path: "../../worker/index.js" })],
    ["caller command", "unknown_field", () => materialise("site_link_patch", { ...validLink, command: "git push" })],
    ["javascript URL", "unsafe_url", () => materialise("site_link_patch", { ...validLink, links: [{ ...validLink.links[0], destination: { kind: "external_https", value: "javascript:alert(1)" } }] })],
    ["encoded traversal", "unsafe_url", () => materialise("site_link_patch", { ...validLink, links: [{ ...validLink.links[0], destination: { kind: "internal_route", value: "/%2e%2e/" } }] })],
    ["missing internal route", "missing_route", () => materialise("site_link_patch", { ...validLink, links: [{ ...validLink.links[0], destination: { kind: "internal_route", value: "/not-built/" } }] })],
    ["source record without a published route", "missing_route", () => materialise("site_link_patch", { ...validLink, links: [{ ...validLink.links[0], destination: { kind: "internal_route", value: "/home/" } }] })],
    ["credentialed external URL", "unsafe_url", () => materialise("site_link_patch", { ...validLink, links: [{ surfaceId: "site.header.primary-booking", label: "Book", destination: { kind: "external_https", value: "https://user@davetaxnz.nz/book-a-consultation/" } }] })],
    ["non-allowlisted external host", "unsafe_url", () => materialise("site_link_patch", { ...validLink, links: [{ surfaceId: "site.header.primary-booking", label: "Book", destination: { kind: "external_https", value: "https://example.com/" } }] })],
    ["unapproved path on an allowlisted external host", "unsafe_url", () => materialise("site_link_patch", { ...validLink, links: [{ surfaceId: "site.header.primary-booking", label: "Book", destination: { kind: "external_https", value: "https://davetaxnz.nz/redirect-elsewhere/" } }] })],
    ["stale semantic base identity", "stale_semantic_binding", () => { const base = materialiserBase(); base.files["src/data/site.yaml"] = base.files["src/data/site.yaml"].replace('      label: "Contact"\n      href: "/contact/"', '      label: "Unrelated drift"\n      href: "/contact/"'); base.fileSha256["src/data/site.yaml"] = sourceDigest(base.files["src/data/site.yaml"]); return materialise("site_link_patch", validLink, base); }],
    ["semantic ID moved to the wrong role", "stale_semantic_binding", () => { const base = materialiserBase(); base.files["src/data/site.yaml"] = base.files["src/data/site.yaml"].replace('id: "header.about"', 'id: "header.__swap__"').replace('id: "header.contact"', 'id: "header.about"').replace('id: "header.__swap__"', 'id: "header.contact"'); base.fileSha256["src/data/site.yaml"] = sourceDigest(base.files["src/data/site.yaml"]); return materialise("site_link_patch", validLink, base); }],
    ["semantic ID and binding tuple moved to the wrong role", "stale_semantic_binding", () => { const base = materialiserBase(); base.files["src/data/site.yaml"] = base.files["src/data/site.yaml"].replaceAll('"header.about"', '"header.__swap__"').replaceAll('"header.contact"', '"header.about"').replaceAll('"header.__swap__"', '"header.contact"'); base.fileSha256["src/data/site.yaml"] = sourceDigest(base.files["src/data/site.yaml"]); return materialise("site_link_patch", validLink, base); }],
    ["media-bearing typed page", "unsafe_content", () => materialise("typed_page_create", { schemaVersion: 1, page: { pageType: "service_detail", slug: "unsafe", title: "Unsafe", description: "Unsafe page", sections: [{ kind: "prose", heading: "Image", body: "![portrait](data:image/png;base64,AAAA)" }] }, navigationPlacement: null })],
    ["attribution-shaped quote", "unsafe_content", () => materialise("typed_page_create", { schemaVersion: 1, page: { pageType: "service_detail", slug: "unsafe", title: "Unsafe", description: "Unsafe page", sections: [{ kind: "quote", heading: "Client", body: "Quoted words" }] }, navigationPlacement: null })],
    ["typed page bidi override", "invalid_text", () => materialise("typed_page_create", { schemaVersion: 1, page: { pageType: "service_detail", slug: "unsafe", title: "Unsafe", description: "Unsafe page", sections: [{ kind: "prose", heading: "Visual\u202Espoof", body: "Plain body" }] }, navigationPlacement: null })],
    ["existing route collision", "route_collision", () => materialise("typed_page_create", { schemaVersion: 1, page: { pageType: "service_detail", slug: "contact", title: "Contact", description: "Collision", sections: [] }, navigationPlacement: null })],
    ["email CRLF", "invalid_text", () => materialise("public_email_patch", { schemaVersion: 1, display: "office@example.invalid\r\nBcc:x@example.invalid", mailto: "office@example.invalid" })],
    ["undeclared email occurrence", "undeclared_occurrence", () => { const base = materialiserBase(); base.files["src/unrelated.ts"] = 'export const address = "dave@davetaxnz.nz";'; base.modes["src/unrelated.ts"] = "100644"; base.fileSha256["src/unrelated.ts"] = sourceDigest(base.files["src/unrelated.ts"]); return materialise("public_email_patch", { schemaVersion: 1, display: "office@example.invalid", mailto: "office@example.invalid" }, base); }],
    ["undeclared email occurrence in public output source", "undeclared_occurrence", () => { const base = materialiserBase(); base.files["public/stale-email.txt"] = "dave@davetaxnz.nz"; base.modes["public/stale-email.txt"] = "100644"; base.fileSha256["public/stale-email.txt"] = sourceDigest(base.files["public/stale-email.txt"]); return materialise("public_email_patch", { schemaVersion: 1, display: "office@example.invalid", mailto: "office@example.invalid" }, base); }],
    ["undeclared email occurrence inside a target file", "undeclared_occurrence", () => { const base = materialiserBase(); base.files["src/data/site.yaml"] = base.files["src/data/site.yaml"].replace('description: "Dave Ananth is a New Zealand', 'description: "dave@davetaxnz.nz — Dave Ananth is a New Zealand'); base.fileSha256["src/data/site.yaml"] = sourceDigest(base.files["src/data/site.yaml"]); return materialise("public_email_patch", { schemaVersion: 1, display: "office@example.invalid", mailto: "office@example.invalid" }, base); }],
    ["extra email recipient hidden in an allowed mailto pointer", "undeclared_occurrence", () => { const base = materialiserBase(); base.files["src/data/site.yaml"] = base.files["src/data/site.yaml"].replace("?subject=Business%20tax%20matter", "?subject=Business%20tax%20matter&cc=dave@davetaxnz.nz"); base.fileSha256["src/data/site.yaml"] = sourceDigest(base.files["src/data/site.yaml"]); return materialise("public_email_patch", { schemaVersion: 1, display: "office@example.invalid", mailto: "office@example.invalid" }, base); }],
    ["email moved into attribution frontmatter", "attribution_guard", () => { const base = materialiserBase(); const article = materialiserFiles[3]; base.files[article] = base.files[article].replace("- Email: dave@davetaxnz.nz", "attributionEmail: dave@davetaxnz.nz"); base.fileSha256[article] = sourceDigest(base.files[article]); return materialise("public_email_patch", { schemaVersion: 1, display: "office@example.invalid", mailto: "office@example.invalid" }, base); }],
    ["empty hours", "invalid_hours", () => materialise("public_opening_hours_replace", { schemaVersion: 1, timezone: "Pacific/Auckland", weekly: [], display: "Always" })],
    ["overlapping hours", "invalid_hours", () => materialise("public_opening_hours_replace", { schemaVersion: 1, timezone: "Pacific/Auckland", weekly: [{ day: "monday", intervals: [{ opens: "09:00", closes: "12:00" }, { opens: "11:00", closes: "13:00" }] }], display: "Monday" })],
    ["withdrawn operation", "unknown_operation", () => materialise("public_hours_patch", {})],
  ];
  for (const [name, code, callback] of scenarios) await t.test(name, () => assertRefusal(code, callback));
});

async function withMaterialiserMutant(replacements, callback) {
  const temporaryRoot = mkdtempSync(path.join(root, ".governance-mutation-"));
  try {
    mkdirSync(path.join(temporaryRoot, "scripts"));
    cpSync(path.join(root, "governance"), path.join(temporaryRoot, "governance"), { recursive: true });
    let sourceText = readFileSync(path.join(root, "scripts", "governed-materialisers.mjs"), "utf8");
    for (const [before, after] of replacements) {
      assert.ok(sourceText.includes(before), `mutation anchor is missing: ${before.slice(0, 80)}`);
      sourceText = sourceText.replace(before, after);
    }
    const mutantPath = path.join(temporaryRoot, "scripts", "governed-materialisers.mjs");
    writeFileSync(mutantPath, sourceText);
    const mutant = await import(`${pathToFileURL(mutantPath).href}?case=${Date.now()}-${Math.random()}`);
    return await callback(mutant);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function assertNamedRefusalTestFails(mutant, code, callback) {
  assert.throws(
    () => assert.throws(callback, (error) => error instanceof mutant.GovernedMaterialiserRefusal && error.code === code),
    { name: "AssertionError" },
    `the ${code} regression must fail while its production guard is weakened`,
  );
}

test("representative guards are load-bearing mutation fixtures", async (t) => {
  const productionMaterialiserBefore = readFileSync(path.join(root, "scripts", "governed-materialisers.mjs"), "utf8");
  await t.test("URL scheme refusal test fails against a URL-guard mutant", async () => {
    await withMaterialiserMutant([
      [
        "function canonicalExternalUrl(value, allowedHosts, allowedPaths) {\n",
        "function canonicalExternalUrl(value, allowedHosts, allowedPaths) {\n  if (value === \"javascript:alert(1)\") return value; // mutation fixture\n",
      ],
    ], (mutant) => assertNamedRefusalTestFails(mutant, "unsafe_url", () => mutant.materialiseGovernedOperation({
      operationKind: "site_link_patch",
      proposal: {
        schemaVersion: 1,
        links: [{ surfaceId: "site.header.primary-booking", label: "Book", destination: { kind: "external_https", value: "javascript:alert(1)" } }],
        navigationOrders: [],
      },
      base: materialiserBase(),
    })));
  });

  await t.test("stale-base refusal test fails against a revision-guard mutant", async () => {
    await withMaterialiserMutant([
      [
        "if (!/^[0-9a-f]{40,64}$/u.test(base.revision) || base.revision !== base.expectedRevision) {",
        "if (!/^[0-9a-f]{40,64}$/u.test(base.revision) || false) { // mutation fixture",
      ],
    ], (mutant) => assertNamedRefusalTestFails(mutant, "stale_base", () => mutant.materialiseGovernedOperation({
      operationKind: "site_link_patch",
      proposal: {
        schemaVersion: 1,
        links: [{ surfaceId: "site.header.contact", label: "Contact Dave", destination: { kind: "internal_route", value: "/contact/" } }],
        navigationOrders: [],
      },
      base: materialiserBase({ expectedRevision: "b".repeat(40) }),
    })));
  });

  await t.test("semantic-only test fails against a path-allowlist mutant", async () => {
    await withMaterialiserMutant([
      [
        "if (!allowedPrefixes.some((prefix) => pointer === prefix || pointer.startsWith(`${prefix}/`))) {",
        "if (false && !allowedPrefixes.some((prefix) => pointer === prefix || pointer.startsWith(`${prefix}/`))) { // mutation fixture",
      ],
      [
        "doc.setIn([\"openingHours\"], { timezone: proposal.timezone, weekly, display });",
        "doc.setIn([\"openingHours\"], { timezone: proposal.timezone, weekly, display });\n  doc.setIn([\"meta\", \"title\"], \"unrelated mutant write\");",
      ],
    ], (mutant) => {
      assert.throws(() => {
        const result = mutant.materialiseGovernedOperation({
          operationKind: "public_opening_hours_replace",
          proposal: { schemaVersion: 1, timezone: "Pacific/Auckland", weekly: [{ day: "monday", intervals: [{ opens: "09:00", closes: "17:00" }] }], display: "Monday 9:00am–5:00pm" },
          base: materialiserBase(),
        });
        const before = parseYaml(result.changes[0].before);
        const after = parseYaml(result.changes[0].after);
        after.openingHours = before.openingHours;
        assert.deepEqual(after, before, "hours materialiser changed unrelated site semantics");
      }, { name: "AssertionError" }, "the semantic-only regression must fail while the allowlist is weakened");
    });
  });

  await t.test("attribution refusal test fails against an attribution-guard mutant", async () => {
    await withMaterialiserMutant([
      [
        "if (lineCount !== target.expectedOccurrences) refuse(\"attribution_guard\", `${target.path} governed contact line drifted or moved into attribution/frontmatter`);",
        "if (false && lineCount !== target.expectedOccurrences) refuse(\"attribution_guard\", `${target.path} governed contact line drifted or moved into attribution/frontmatter`); // mutation fixture",
      ],
    ], (mutant) => {
      const base = materialiserBase();
      const article = materialiserFiles[3];
      base.files[article] = base.files[article].replace("- Email: dave@davetaxnz.nz", "attributionEmail: dave@davetaxnz.nz");
      base.fileSha256[article] = sourceDigest(base.files[article]);
      assertNamedRefusalTestFails(mutant, "attribution_guard", () => mutant.materialiseGovernedOperation({
        operationKind: "public_email_patch",
        proposal: { schemaVersion: 1, display: "office@example.invalid", mailto: "office@example.invalid" },
        base,
      }));
    });
  });

  assert.equal(readdirSync(root).some((entry) => entry.startsWith(".governance-mutation-")), false, "mutation files must be restored exactly");
  assert.equal(
    readFileSync(path.join(root, "scripts", "governed-materialisers.mjs"), "utf8"),
    productionMaterialiserBefore,
    "production materialiser bytes must remain exact after every temporary guard mutation",
  );
});
