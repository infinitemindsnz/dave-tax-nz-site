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
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

const siteYaml = parseYaml(readFileSync(path.join(root, "src", "data", "site.yaml"), "utf8"));
const pagesYaml = parseYaml(readFileSync(path.join(root, "src", "data", "pages.yaml"), "utf8"));

const articlesDir = path.join(root, "src", "content", "articles");
const articleFiles = readdirSync(articlesDir).filter((name) => name.endsWith(".md"));

function stripFrontmatter(markdown) {
  if (!markdown.startsWith("---")) return markdown;
  const end = markdown.indexOf("\n---", 3);
  return end === -1 ? markdown : markdown.slice(end + 4);
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

/** Returns { [literal]: occurrenceCount } across site.yaml, pages.yaml and every article body. */
function actualOccurrenceCounts(literals) {
  const articleBodies = articleFiles.map((name) =>
    stripFrontmatter(readFileSync(path.join(articlesDir, name), "utf8")),
  );
  const countAcrossSources = (literal) =>
    countLiteralInData(siteYaml, literal) +
    countLiteralInData(pagesYaml, literal) +
    articleBodies.reduce((sum, body) => sum + countLiteralInString(body, literal), 0);

  return Object.fromEntries(literals.map((literal) => [literal, countAcrossSources(literal)]));
}

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

  const scanPrecondition = writablePaths.preconditions.find((p) => p.kind === "closed_set_occurrence_scan");
  assert.ok(scanPrecondition, "expected a closed_set_occurrence_scan precondition");
  assert.equal(scanPrecondition.totalDeclaredTargets, 13);

  const expectedSum = scanPrecondition.expectedOccurrences.reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(expectedSum, 13);
});

test("declared phone occurrences match the current repository content exactly", () => {
  const scanPrecondition = writablePaths.preconditions.find((p) => p.kind === "closed_set_occurrence_scan");
  const literals = scanPrecondition.expectedOccurrences.map((entry) => entry.literal);
  const actual = actualOccurrenceCounts(literals);

  for (const { literal, count } of scanPrecondition.expectedOccurrences) {
    assert.equal(actual[literal], count, `expected ${count} occurrences of ${JSON.stringify(literal)}, found ${actual[literal]}`);
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
      const data = file === "src/data/site.yaml" ? siteYaml : pagesYaml;
      const value = resolveJsonPointer(data, target.jsonPointer);
      assert.equal(typeof value, "string", `${target.jsonPointer} must resolve to a string`);

      if (target.render === "raw") {
        assert.equal(value, target.matchLiteral, "a raw-render target must equal the literal exactly");
      } else {
        assert.equal(
          countLiteralInString(value, target.matchLiteral),
          1,
          `a substring target's literal must occur exactly once, found ${countLiteralInString(value, target.matchLiteral)}`,
        );
      }
    });
  }
});

test("every declared article body target's matchLiteral occurs exactly once", async (t) => {
  const articleTargets = writablePaths.files
    .filter((file) => file.path.startsWith("src/content/articles/"))
    .map((file) => ({
      file: file.path,
      target: file.fields.find((f) => f.operationKind === "public_phone_patch").targets.find((t) => t.textMatch === "body"),
    }));

  assert.equal(articleTargets.length, 2);

  for (const { file, target } of articleTargets) {
    await t.test(`${file} body contains "${target.matchLiteral}" exactly once`, () => {
      const body = stripFrontmatter(readFileSync(path.join(root, file), "utf8"));
      assert.equal(countLiteralInString(body, target.matchLiteral), 1);
    });
  }
});

test("closed-set occurrence scan refuses the candidate on any drift", async (t) => {
  const expectedOccurrences = writablePaths.preconditions.find(
    (p) => p.kind === "closed_set_occurrence_scan",
  ).expectedOccurrences;
  const [displayLiteral, telLiteral] = expectedOccurrences.map((entry) => entry.literal);
  const actual = actualOccurrenceCounts([displayLiteral, telLiteral]);

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
      assert.equal(result.refused, expectRefused);
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
