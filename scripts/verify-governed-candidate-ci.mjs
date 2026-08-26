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

if (isArticleCreate) {
  assert.equal(articleBlock.operationKind, "article_publish", "base policy articlePublish has the wrong operation kind");
  assert.equal(articleBlock.writeMode, "create_only", "base policy articlePublish is not create-only");
  process.stdout.write(`Governed candidate boundary verified: one created article (${addedPaths[0]}).\n`);
} else if (isPhoneCoupledSet) {
  process.stdout.write(`Governed candidate boundary verified across ${changedPaths.length} coupled files (public_phone_patch).\n`);
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
  process.stdout.write(`Governed candidate boundary verified across ${changedPaths.length} text-surface files (site_text_patch).\n`);
}
