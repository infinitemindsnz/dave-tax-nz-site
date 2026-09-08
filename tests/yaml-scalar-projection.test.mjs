import assert from "node:assert/strict";
import test from "node:test";
import { assertYamlScalarProjection } from "../scripts/verify-yaml-scalar-projection.mjs";

const before = `# Keep editorial formatting intact.
nav:
  order: [about, expertise, stories, articles, contact]
phone: "+64 21 021 68888" # public display
href: "tel:+64210216888"
tagline: 'Tax Barrister'
`;
const phoneWrites = [
  { parts: ["phone"], value: "+64 22 037 6543" },
  { parts: ["href"], value: "tel:+64220376543" },
];
const after = before.replace('phone: "+64 21 021 68888"', 'phone: "+64 22 037 6543"')
  .replace('href: "tel:+64210216888"', 'href: "tel:+64220376543"');

test("phone projection preserves flow arrays, comments and unrelated quotation styles", () => {
  assertYamlScalarProjection(before, after, phoneWrites, "phone fixture");
});

test("semantic equality does not excuse collateral YAML formatting changes", () => {
  assert.throws(() => assertYamlScalarProjection(before,
    after.replace("[about, expertise, stories, articles, contact]", "[ about, expertise, stories, articles, contact ]"),
    phoneWrites, "phone fixture"), /outside its exact scalar projection/);
});

test("projection refuses extra content edits, comment removal and an incomplete phone pair", () => {
  for (const candidate of [
    after.replace("Tax Barrister", "Changed without permission"),
    after.replace(" # public display", ""),
    after.replace("tel:+64220376543", "tel:+64210216888"),
  ]) {
    assert.throws(() => assertYamlScalarProjection(before, candidate, phoneWrites, "phone fixture"),
      /outside its exact scalar projection/);
  }
});

test("text replacements stay inside their existing quoted scalars", () => {
  assertYamlScalarProjection(before, before.replace("'Tax Barrister'", "'Dave''s tax advice'"),
    [{ parts: ["tagline"], value: "Dave's tax advice" }], "text fixture");
  assertYamlScalarProjection('title: "Tax advice"\n', String.raw`title: "Tax \"advice\""` + "\n",
    [{ parts: ["title"], value: 'Tax "advice"' }], "double-quoted fixture");
});

test("plain scalars retain safe spelling and quote YAML-reserved replacements", () => {
  assertYamlScalarProjection("title: Tax advice\n", "title: New advice\n",
    [{ parts: ["title"], value: "New advice" }], "plain fixture");
  assertYamlScalarProjection("title: Tax advice\n", 'title: "true"\n',
    [{ parts: ["title"], value: "true" }], "reserved fixture");
});

test("ambiguous or overlapping scalar writes fail closed", () => {
  assert.throws(() => assertYamlScalarProjection(before, after, [...phoneWrites, phoneWrites[0]], "duplicate"), /overlap/);
  assert.throws(() => assertYamlScalarProjection(before, before, [{ parts: ["missing"], value: "x" }], "missing"), /not a string scalar/);
  assert.throws(() => assertYamlScalarProjection("title: |\n  Advice\n", "title: |\n  New advice\n",
    [{ parts: ["title"], value: "New advice" }], "block"), /unsupported scalar style/);
  assert.throws(() => assertYamlScalarProjection("title: one\ntitle: two\n", "title: new\n",
    [{ parts: ["title"], value: "new" }], "duplicate keys"), /base YAML is invalid/);
  assert.throws(() => assertYamlScalarProjection("title: &title Advice\ncopy: *title\n", "title: &title Changed\ncopy: *title\n",
    [{ parts: ["title"], value: "Changed" }], "alias"));
  assert.throws(() => assertYamlScalarProjection(before, after,
    [{ parts: ["phone"], value: "+64220376543\nextra: content" }], "control"), /control character/);
});
