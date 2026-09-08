import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const checker = path.join(root, "scripts/verify-governed-candidate-ci.mjs");
const policyPath = "governance/writable-paths.v1.json";
const policy = JSON.parse(readFileSync(path.join(root, policyPath), "utf8"));
const phoneFiles = policy.coupledSet.paths;
const oldDisplay = policy.files.find((file) => file.path === "src/data/site.yaml").fields
  .find((field) => field.operationKind === "public_phone_patch").targets
  .find((target) => target.render === "raw").matchLiteral;
const oldHref = policy.files.find((file) => file.path === "src/data/site.yaml").fields
  .find((field) => field.operationKind === "public_phone_patch").targets
  .find((target) => target.render === "tel").matchLiteral;

function fixture(t, changes) {
  const directory = mkdtempSync(path.join(tmpdir(), "governed-ci-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Governed CI Test",
    "-c", "user.email=ci-test@example.invalid", ...args], { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  for (const file of [policyPath, ...phoneFiles]) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    writeFileSync(path.join(directory, file), readFileSync(path.join(root, file)));
  }
  git("init", "--quiet");
  git("add", "--", policyPath, ...phoneFiles);
  git("commit", "--quiet", "-m", "audited fixture base");
  const base = git("rev-parse", "HEAD");
  for (const [file, transform] of Object.entries(changes)) {
    const filename = path.join(directory, file);
    writeFileSync(filename, transform(readFileSync(filename, "utf8")));
  }
  git("add", "--", policyPath, ...phoneFiles);
  git("commit", "--quiet", "-m", "candidate fixture");
  const head = git("rev-parse", "HEAD");
  const outputFile = path.join(directory, "action-output.txt");
  const result = spawnSync(process.execPath, [checker], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, GOVERNED_BASE_SHA: base, GOVERNED_HEAD_SHA: head, GITHUB_OUTPUT: outputFile },
  });
  return { ...result, output: existsSync(outputFile) ? readFileSync(outputFile, "utf8") : "" };
}

const replacePhone = (text) => text.split("\n").map((line) => /^\s*#/u.test(line) ? line :
  line.replaceAll(oldDisplay, "+64 22 037 6543").replaceAll(oldHref, "tel:+64220376543")).join("\n");

test("only a complete verified phone candidate enables the phone-specific CI path", (t) => {
  const result = fixture(t, Object.fromEntries(phoneFiles.map((file) => [file, replacePhone])));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, "phone_patch=true\n");
});

test("ordinary text candidates retain the candidate-tree governance scan", (t) => {
  const result = fixture(t, { "src/data/site.yaml": (text) => text.replace('tagline: "Tax Barrister"', 'tagline: "Independent tax advice"') });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, "phone_patch=false\n");
});

test("an incomplete phone candidate cannot emit a successful CI routing output", (t) => {
  const result = fixture(t, { "src/data/site.yaml": replacePhone });
  assert.notEqual(result.status, 0);
  assert.equal(result.output, "");
});

test("phone candidates with unrelated edits cannot emit a successful CI routing output", (t) => {
  const changes = Object.fromEntries(phoneFiles.map((file) => [file, replacePhone]));
  changes["src/data/site.yaml"] = (text) => replacePhone(text).replace("[about, expertise, stories, articles, contact]", "[ about, expertise, stories, articles, contact ]");
  const result = fixture(t, changes);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outside its exact scalar projection/);
  assert.equal(result.output, "");
});
