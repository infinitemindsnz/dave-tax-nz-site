import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { resolvePhonePolicy } from "../scripts/phone-baseline.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const policyPath = "governance/writable-paths.v1.json";
const policy = JSON.parse(readFileSync(path.join(root, policyPath), "utf8"));
const current = parse(readFileSync(path.join(root, "src/data/site.yaml"), "utf8")).contact.rows[0];
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "phone-baseline-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(root, dir, { recursive: true, filter: (file) => ![".git", "node_modules", "dist"].some((part) => path.relative(root, file).split(path.sep).includes(part)) });
  symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"));
  return dir;
}
function replace(dir, before, after) {
  for (const file of policy.coupledSet.paths) {
    const filename = path.join(dir, file);
    const text = readFileSync(filename, "utf8").split("\n").map((line) => /^\s*#/u.test(line) ? line : line.replaceAll(before.display, after.display).replaceAll(before.href, after.href)).join("\n");
    writeFileSync(filename, text);
  }
}
function governance(dir) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ["--test", "tests/governance.test.mjs"], { cwd: dir, encoding: "utf8", env });
}
const next = { display: "+64 22 111 2222", href: "tel:+64221112222" };
test("the complete current-tree governance suite passes after two phone publications", (t) => {
  const dir = fixture(t);
  const authority = readFileSync(path.join(dir, policyPath), "utf8");
  replace(dir, { display: current.value, href: current.href }, next);
  let result = governance(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  replace(dir, next, { display: "+64 22 333 4444", href: "tel:+64223334444" });
  result = governance(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(path.join(dir, policyPath), "utf8"), authority);
});
test("current-tree scans reject missing, extra and resurrected phone occurrences", (t) => {
  const dir = fixture(t);
  replace(dir, { display: current.value, href: current.href }, next);
  const article = path.join(dir, policy.coupledSet.paths.find((file) => file.endsWith(".md")));
  const original = readFileSync(article, "utf8");
  for (const text of [original.replace(next.display, ""), original + `\n${next.display}\n`, original + "\n+64 21 021 68888\n"]) {
    writeFileSync(article, text);
    const result = governance(dir);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  }
});
test("baseline mode is explicit and anchor agreement does not learn new counts", () => {
  const source = (file) => readFileSync(path.join(root, file), "utf8");
  const legacy = structuredClone(policy);
  delete legacy.preconditions.find((entry) => entry.kind === "closed_set_occurrence_scan").baselineMode;
  assert.equal(resolvePhonePolicy(legacy, () => { throw new Error("legacy policy must not read anchors"); }), legacy);
  const unknown = structuredClone(policy);
  unknown.preconditions.find((entry) => entry.kind === "closed_set_occurrence_scan").baselineMode = "latest_branch";
  assert.throws(() => resolvePhonePolicy(unknown, source), /unknown phone baseline/);
  assert.throws(() => resolvePhonePolicy(policy, (file) => source(file).replace(current.href, next.href)), /anchors disagree/);
  const effective = resolvePhonePolicy(policy, source);
  const scan = effective.preconditions.find((entry) => entry.kind === "closed_set_occurrence_scan");
  assert.equal(scan.expectedOccurrences.reduce((sum, entry) => sum + entry.count, 0), 13);
  assert.deepEqual(scan.nonRenderingOccurrences, policy.preconditions.find((entry) => entry.kind === "closed_set_occurrence_scan").nonRenderingOccurrences);
});
