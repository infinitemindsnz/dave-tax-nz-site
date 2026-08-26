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
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const governancePath = (...segments) => path.join(root, "governance", ...segments);
const readJson = (...segments) => JSON.parse(readFileSync(governancePath(...segments), "utf8"));

const writablePaths = readJson("writable-paths.v1.json");
const approvalPolicy = readJson("approval-policy.v1.json");
const candidateManifestSchema = readJson("schemas", "candidate-manifest.v1.schema.json");

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

  await t.test("the schema.ts content model still defines no hours field to write to", () => {
    const schemaSource = readFileSync(path.join(root, "src", "data", "schema.ts"), "utf8");
    assert.equal(/\bhours\b/i.test(schemaSource), false);
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
