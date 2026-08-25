import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

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

const expectedPaths = [...policy.coupledSet.paths].sort();
assert.ok(expectedPaths.length > 0, "base policy coupled set is empty");
assert.equal(new Set(expectedPaths).size, expectedPaths.length, "base policy coupled paths are duplicated");

const statusLines = git("diff", "--name-status", "--no-renames", baseSha, headSha)
  .trim()
  .split("\n")
  .filter(Boolean);

const changedPaths = statusLines.map((line) => {
  const fields = line.split("\t");
  assert.equal(fields.length, 2, `candidate has an unsupported diff record: ${line}`);
  assert.equal(fields[0], "M", `governed candidate may only modify existing files: ${line}`);
  return fields[1];
});

assert.deepEqual(
  [...changedPaths].sort(),
  expectedPaths,
  "governed candidate changed-file set must equal the complete base-policy coupled set",
);

const changedGovernance = changedPaths.filter((entry) => entry === "governance" || entry.startsWith("governance/"));
assert.deepEqual(changedGovernance, [], "a governed candidate may not modify its own authority policy");

process.stdout.write(`Governed candidate boundary verified across ${changedPaths.length} coupled files.\n`);
