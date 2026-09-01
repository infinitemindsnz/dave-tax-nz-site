#!/usr/bin/env node
// Standalone gate for the governed content model. Same schemas the Astro build
// uses (src/data/schema.ts), but runnable without a full build — so a copy edit
// can be checked in a second instead of a minute.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { articlesSchema, pagesSchema, siteSchema, typedPagesSchema } from "../src/data/schema.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  ["site.yaml", siteSchema],
  ["articles.yaml", articlesSchema],
  ["pages.yaml", pagesSchema],
  ["typed-pages.yaml", typedPagesSchema],
];

let failed = false;
for (const [file, schema] of targets) {
  const full = path.join(root, "src", "data", file);
  const result = schema.safeParse(parse(readFileSync(full, "utf8")));
  if (result.success) {
    console.log(`ok   src/data/${file}`);
    continue;
  }
  failed = true;
  console.error(`FAIL src/data/${file}`);
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
}

if (failed) process.exit(1);
console.log("Content model valid.");
