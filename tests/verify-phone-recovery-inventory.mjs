// One incident, one immutable approved projection. This is verification only;
// it does not change the historical policy or manufacture an approval.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const base = "8db6685adf6dcb369aa4f8ba8555a24aa373aeec";
const head = "d7ba46f5f7eb4f4ee9a3155df0b95daaae7f7635";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const policy = JSON.parse(git("show", `${base}:governance/writable-paths.v1.json`));
const scan = policy.preconditions.find((entry) => entry.kind === "closed_set_occurrence_scan");
const exclusions = scan.scanExclusions.map((entry) => entry.path);
const replacements = new Map([["+64 21 021 68888", "+64 22 037 6543"], ["tel:+64210216888", "tel:+64220376543"]]);
const paths = git("ls-tree", "-r", "--name-only", head).trim().split("\n")
  .filter((file) => !exclusions.some((root) => file === root || file.startsWith(`${root}/`)));
const counts = new Map([...replacements].flatMap(([before, after]) => [[before, 0], [after, 0]]));
for (const file of paths) {
  const text = git("show", `${head}:${file}`);
  for (const literal of counts.keys()) counts.set(literal, counts.get(literal) + text.split(literal).length - 1);
}
for (const { literal, count } of scan.expectedOccurrences) {
  const comments = scan.nonRenderingOccurrences.reduce((sum, entry) => sum + (entry.literals[literal] ?? 0), 0);
  assert.equal(counts.get(literal), comments, "the approved candidate retained an old rendering phone occurrence");
  assert.equal(counts.get(replacements.get(literal)), count, "the approved candidate has an incomplete or extra new phone occurrence");
}
console.log("Approved PR22 inventory verified: 11 display + 2 dial targets; historical comments unchanged; no extra old/new occurrences.");
