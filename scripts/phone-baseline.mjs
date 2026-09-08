import assert from "node:assert/strict";
import { parseDocument } from "yaml";

// Only an explicitly opted-in, versioned policy can take its phone values from
// the protected revision. Pointers, counts, exclusions and comment inventory
// remain policy-owned. Callers supply a read-only view of the revision under test.
export function resolvePhonePolicy(policy, readSource) {
  const scan = policy.preconditions.find((entry) => entry.kind === "closed_set_occurrence_scan");
  if (scan.baselineMode === undefined) return policy;
  assert.equal(scan.baselineMode, "protected_base_values_v1", "unknown phone baseline mode");
  const effective = structuredClone(policy);
  const targets = effective.files.flatMap((file) => file.fields.filter((field) => field.operationKind === "public_phone_patch")
    .flatMap((field) => field.targets.map((target) => ({ file: file.path, target }))));
  const replacements = new Map();
  for (const input of ["display", "e164"]) {
    const owned = targets.filter(({ target }) => target.input === input);
    assert.equal(new Set(owned.map(({ target }) => target.matchLiteral)).size, 1, "inconsistent original phone literals");
    const anchors = owned.filter(({ target }) => target.jsonPointer && target.render === (input === "display" ? "raw" : "tel"));
    assert.ok(anchors.length > 0, "phone baseline requires a policy-owned scalar anchor");
    const values = anchors.map(({ file, target }) => {
      const doc = parseDocument(readSource(file), { strict: true, uniqueKeys: true });
      assert.equal(doc.errors.length, 0, "phone anchor is not strict YAML");
      const data = doc.toJS({ maxAliasCount: 0 });
      const value = target.jsonPointer.slice(1).split("/").reduce((node, part) => node?.[part.replaceAll("~1", "/").replaceAll("~0", "~")], data);
      assert.equal(typeof value, "string");
      assert.ok(value.length > 0 && Buffer.byteLength(value) <= 64 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value), "invalid phone baseline scalar");
      if (input === "e164") assert.match(value, /^tel:\+[1-9][0-9]{6,14}$/u);
      return value;
    });
    assert.equal(new Set(values).size, 1, "phone baseline anchors disagree");
    replacements.set(owned[0].target.matchLiteral, values[0]);
  }
  const effectiveScan = effective.preconditions.find((entry) => entry.kind === "closed_set_occurrence_scan");
  const counts = new Map(scan.expectedOccurrences.map(({ literal }) => [literal, 0]));
  for (const { target } of targets) {
    target.matchLiteral = replacements.get(target.matchLiteral);
    counts.set(target.matchLiteral, (counts.get(target.matchLiteral) ?? 0) + 1);
  }
  effectiveScan.expectedOccurrences = [...counts].map(([literal, count]) => ({ literal, count }));
  if (effective.textPatch) {
    effective.textPatch.constraints.preserveLiteralOccurrences = [...counts.keys()].map((literal) => ({ ...policy.textPatch.constraints.preserveLiteralOccurrences[0], literal }));
  }
  return effective;
}
