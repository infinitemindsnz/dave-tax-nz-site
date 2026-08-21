# Governed publication contract

This directory defines the file-backed target that a future Assistant Platform
publisher may address. It grants no authority by itself.

Nothing in this repository reads these files today. There is no publisher, no
candidate builder, no approval client, and no CI check bound to them. Adding
the contract does not make the site writable by anything; it only describes,
in advance and in public, the exact and very small surface that a writer would
be permitted to touch if one were ever built. Until that publisher exists,
`src/data/site.yaml`, `src/data/articles.yaml`, `src/data/pages.yaml` and the
eighteen posts under `src/content/articles/` remain human-owned files edited by
hand.

The content migration widened what this directory **describes**. It widened
what it **permits** for `article_publish` by nothing at all — that remains
`permitted: false` with no writable path. Separately, a 2026-08-20 audit found
that the original phone coupled set covered only 3 of 13 render-reachable
phone occurrences; version 2 of `writable-paths.v1.json` closed that gap by
declaring all thirteen, still under the single `public_phone_patch` operation
kind and still nothing an approver did not explicitly approve.

## Canonical inputs

- `content-contract.v1.json` names every governed source and schema:
  `src/data/site.yaml`, `src/data/articles.yaml`, `src/data/pages.yaml` and the
  `src/content/articles/**/*.md` collection, their JSON Schemas, the two
  build-time validators, and the frozen theme.
- `schemas/site.v1.schema.json` strictly validates the one governed site
  record. Unknown keys fail.
- `schemas/articles.v1.schema.json` strictly validates the curated homepage
  reference list. Unknown keys fail.
- `schemas/pages.v1.schema.json` strictly validates the nine migrated
  WordPress page records. Every slug is required, no others are allowed, and
  the seven cross-field section rules are restated as `if`/`then`.
- `schemas/article-frontmatter.v1.schema.json` strictly validates one article's
  typed frontmatter, including the attribution object.
- `markdown-policy.v1.json` limits article bodies to a twelve-node Markdown
  AST. Raw HTML, MDX, code, tables, footnotes, reference definitions,
  strikethrough, depth-1 headings and non-HTTPS links all fail closed.
- `writable-paths.v1.json` is an exhaustive allowlist. Version 2 permits only
  a closed, two-input `public_phone` patch (`display` plus `e164`) written
  atomically across thirteen targets in four files — three pointers in
  `src/data/site.yaml`, eight substring targets in `src/data/pages.yaml`, and
  one substring target in each of two article bodies. Everything else, in
  every file, is denied, and a closed-set precondition scans the base
  revision and refuses the candidate if any render-reachable phone occurrence
  exists outside those thirteen. Its `documentedOperations` block describes
  `article_publish` with `permitted: false`, and records `public_hours_patch`
  as fully withdrawn — the operation kind no longer exists anywhere else in
  this directory (see "What version 3 may write" below).
- `schemas/candidate-manifest.v1.schema.json` describes the artifact an
  approval decision binds.
- `renderer-manifest.v1.json` pins the static renderer, Node version, build
  command, output digest, build environment, and exhaustive renderer source
  globs.
- `approval-policy.v1.json` binds each closed operation family to its artifact
  class and exact ordered authenticated-approval stages. Chat text is
  explicitly not an approval surface.

## Two validators, one stance

`src/data/schema.ts` is the enforcing validator for the YAML sources.
`src/lib/content.ts` parses all three files — `site.yaml`, `articles.yaml`,
`pages.yaml` — through it, so an unknown key, a missing string, or a malformed
href fails `astro build` rather than shipping a degraded page.
`npm run content:validate` runs the same schemas without a full build.

`src/content.config.ts` is the enforcing validator for article frontmatter,
with the same `strictObject` stance: a misspelled frontmatter key is a build
failure, not a field that silently disappears from the rendered page. It runs
under `npm run build` rather than `content:validate`, because Astro's content
layer owns it.

The JSON Schema files here are the platform-facing mirror of both validators.
They exist because a publisher outside this repository cannot be asked to
execute the repository's own TypeScript in order to learn the shape of the
content. They are required to stay field-for-field identical. If the two ever
disagree, the candidate is refused; the disagreement is not reconciled by
picking the more permissive one.

There is exactly one declared divergence, and it runs in the safe direction.
`publishedAt` and `updatedAt` are `z.coerce.date()` in `src/content.config.ts`,
which accepts any string the `Date` constructor parses;
`schemas/article-frontmatter.v1.schema.json` pins the narrower offset-free
wall-clock pattern the corpus actually uses. The mirror is a strict subset, so
anything passing the mirror passes the validator and never the reverse — a
publisher working from the mirror alone cannot author frontmatter the build
refuses. It is recorded in the schema's own `comment` so that it stays a
reviewed decision rather than becoming silent drift.

No schema here constrains string length or normalises punctuation. That is
deliberate. Every string in `src/data/site.yaml` was copied verbatim from the
pre-Astro React source, curly apostrophes and en dashes included; every string
in `src/data/pages.yaml` and every article body is verbatim client copy from
WordPress, WordPress's own truncated excerpts (`"… […]"`) included. All of it
must survive the round-trip unchanged. A length cap would eventually force a
silent copy edit, and "improving" an excerpt is exactly the kind of small
helpful change this contract exists to prevent.

## What version 3 may write

One operation family, one closed two-input contract, thirteen targets across
four files — the complete render-reachable coupled set, not the three
pointers this contract listed before the 2026-08-20 audit.

`public_phone_patch` writes the public phone number. A proposal supplies
exactly two inputs — `display` (the human-readable string) and `e164` (bare
E.164 digits, no `tel:` prefix) — and nothing else; there is no per-target
override and no way to patch a subset. That number is denormalised across
**thirteen render-reachable occurrences**, not three: the display string and
two `tel:` hrefs in `src/data/site.yaml`; eight substring occurrences in
`src/data/pages.yaml` — the `about-dave` and `contact` meta descriptions (each
rendered three times as `<meta name=description>`, `og:description` and
`twitter:description`) and six list/prose fragments; and one substring
occurrence in each of two published article bodies. All thirteen are a
**coupled set that must be written atomically** across all four files in one
candidate. A patch that lands a subset leaves the site contradicting itself —
which is exactly what a version-1-shaped patch, covering only the three
`site.yaml` pointers, would have done: a fully-approved candidate would have
left ten stale occurrences live, including both meta descriptions, while every
structural gate reported success (`governance/evidence/2026-08-20-phone-and-hours-audit.v1.md`,
finding 1).

A JSON-pointer target (`render: "raw"` or `render: "tel"`) writes its field's
entire value. A substring target (`render: "substring"`) — every `pages.yaml`
target and both article targets — writes into a field or a Markdown body that
holds more than the phone number, so the publisher must locate the declared
`matchLiteral` inside the current value, require it to occur exactly once, and
replace only that span. It must never overwrite the whole field or the whole
body.

They have already drifted. `src/App.jsx` shipped the display string
`+64 21 021 68888` against the href `tel:+64210216888`: twelve digits against
eleven. `src/data/site.yaml` preserves that bug on purpose rather than
guessing which one is right. A publisher must not silently repair it, and
must never derive `e164` from `display` or vice versa — the closed contract
has no default for either input. The correct number is a client-confirmed
fact: both inputs arrive only as explicit, human-confirmed replacements in an
approved candidate, and until one is approved every one of the thirteen
targets keeps its current value unchanged, including on refusal.

A **closed-set precondition** is what makes this a closed contract rather than
an allowlist someone can silently outgrow. Version 2 enumerated the sources to
scan, which reopened the hole it existed to close: an enumerated list only sees
the files someone remembered to list, so a phone number added to
`src/data/articles.yaml`, or to an article's frontmatter `excerpt` — which
renders as the meta description, `og:description`, `twitter:description`, the
JSON-LD description and the RSS item — passed the scan untouched and would have
been left stale by an otherwise complete thirteen-target write.

Version 3 replaces the enumeration with an **exhaustive accounting rule**.
Before applying any patch, the publisher scans *every* file in the repository —
starting at the root and removing only the declared `scanExclusions`
(`node_modules/`, `.git/`, `dist/`, `.astro/`, `governance/`, `tests/`, each with
a stated reason) — for both literals in raw text. Every occurrence it finds must
be accounted for as either a declared target counted in `expectedOccurrences`,
or an explicitly declared entry in `nonRenderingOccurrences` (today: the
preserve-the-bug YAML comment in `site.yaml` and the module doc comment in
`src/lib/structured-data.ts`, neither of which renders). An occurrence that is
neither refuses the whole candidate.

Scanning from the root rather than from a list of roots matters: an earlier draft
of version 3 scanned `src/` and `public/`, which left `worker/index.js` — the
runtime that serves every response — outside the scan. A new top-level directory
that reaches rendered output is now in scope the moment it exists, and excluding
it is a reviewed edit rather than an omission nobody notices.

A `nonRenderingOccurrences` entry is **comment-scoped**, not path-scoped: every
occurrence it covers must sit on a comment line. A path-scoped allowlist leaves
the totals balanced when a comment occurrence is *replaced* by a live one — a
regression this repository has already seen, when a hardcoded
`const telephone = "+64 21 021 68888"` briefly replaced the value derived from
the `tel:` href in `src/lib/structured-data.ts`, keeping the file's count at one
while the JSON-LD telephone silently became the 12-digit display form.
This inverts the burden of proof: a new render-reachable occurrence anywhere in
the tree fails closed by default instead of needing to have been anticipated by
a file list. Counts are still refused in both directions — a missing occurrence
means a declared target is stale and must not be written blind.

`public_hours_patch` is now **fully withdrawn**, not merely refused at the
write gate. This site has **no structured opening-hours record** — the
reference contract's `office_hours` field targets a `/hours` array that simply
does not exist here, and manufacturing one would be a schema change, not a
policy entry. `/contact/action/title` — "Free 15-minute initial consultation"
— is a booking call-to-action, not an availability statement, and a version 1
mapping that pointed the operation kind there was withdrawn for exactly that
reason. Version 1 removed that mapping from `writable-paths.v1.json` but left
the operation kind buildable and approvable everywhere else: it still appeared
in `approval-policy.v1.json`'s `operations[]` and in the `operation_kind` enum
and an `if`/`then` branch of `candidate-manifest.v1.schema.json`, so a
candidate could still be constructed and genuinely approved before dying only
at the final write gate (`governance/evidence/2026-08-20-phone-and-hours-audit.v1.md`,
finding 2). Version 2 removes it from both — `public_hours_patch` no longer
appears in `operations[]`, the enum, or any `if`/`then` branch. A candidate
declaring it now fails structural schema validation before an approval stage
is even computed. Real opening hours would require a change to
`src/data/schema.ts` and a version 3 of this contract with its own approval
policy entry and schema branch; version 3 must not be stretched to cover them.

Two of the thirteen targets — the `site.yaml` pointers addressing `contact.rows`
and `hero.ctas` by index — address array elements by index. A reorder of
either array would silently retarget the policy at the email row, the office
address, or the booking button. `writable-paths.v1.json` therefore carries
identity preconditions that the publisher must assert against the base
revision before applying anything, and must refuse on any mismatch. Those
assertions are read-only; they are not fields the policy may write.

## What version 3 describes but does not permit

`writable-paths.v1.json` carries a `documentedOperations` block for two
operation kinds, and grants no paths for either.

`public_hours_patch` is documented as **fully withdrawn**: no longer in
`approval-policy.v1.json`'s `operations[]`, no longer in the `operation_kind`
enum or any `if`/`then` branch of `candidate-manifest.v1.schema.json`, and its
entry records the wrong CTA mapping it once had, why that was destructive, and
the four preconditions (a real hours field, a materialiser, a version 3
contract, a semantic pointer-meaning check) that would have to be met before
re-introducing it as a new operation kind — not before restoring this one.

`article_publish` remains documented with `permitted: false`: what it would
target (`src/content/articles/<slug>.md`, **create-only** — editing or deleting
an existing article can silently alter an attribution on already-published
reporting and would need its own entry), what it would be constrained by (the
frontmatter schema and the Markdown policy), and, at more length, what it would
**not** target. That negative list is the useful half. Publishing an article
must not append to the curated homepage list in `src/data/articles.yaml`, must
not append a category to the client's own filter strip in `src/data/pages.yaml`,
must not touch the article-surface labels in `src/data/site.yaml`, must not
write `src/data/media-manifest.json` (the Markdown policy uses that manifest as
a gate, and letting the same operation write the gate would defeat it), and must
not touch either stylesheet.

It exists so that the shape of an operation this repository refuses is written
down in public rather than left to a future implementer's inference — the same
stance the reference contract takes. `files` remains the exhaustive allowlist,
`default` remains `deny`, and a fully-approved `article_publish` candidate is
still refused, because this policy lists no path it may write. Six
preconditions are recorded that would have to be met before the question of
enabling it is even in order; they are reproduced under "Future work" below.

## Candidate identity

The JSON schema mirrors the Assistant Platform's strict
`SiteCandidateManifestV1` field-for-field; it is byte-identical to the
reference contract's copy apart from its `$id`. It binds base and candidate
Git objects; sorted before/after blob changes; policy, schema, renderer,
theme, lockfile, preview tree, source pack, and claim-ledger digests; source
snapshots; public classification; affected canonical URLs; and approval-policy
version. A credential-free isolated builder may construct the candidate Git
objects for exact preview identity, but no remote branch or commit is pushed
before authenticated approval. The publisher must re-verify every approved
digest before opening or merging a pull request.

Every candidate declares exactly one closed operation family. Version 2
recognizes `public_phone_patch` and the structurally described but locally
unauthorized `article_publish`; `public_hours_patch` is no longer a
recognized value at all — declaring it fails schema validation — and a broad
site-record operation is deliberately invalid. `article_publish` is now structurally
*coherent* here in a way it was not before — there is a Markdown content
source, a frontmatter schema and a Markdown policy for it to bind. Coherent is
not permitted. The only file that can permit anything is
`writable-paths.v1.json`, and it does not.

`content_schema_sha256` binds `schemas/site.v1.schema.json`,
`schemas/articles.v1.schema.json`, `schemas/pages.v1.schema.json` and
`schemas/article-frontmatter.v1.schema.json`. `src/data/schema.ts` and
`src/content.config.ts` are bound separately through the renderer source globs
and `renderer_sha256`, because each is simultaneously a validator and a build
input.

`theme_sha256` binds `src/styles.css`. That file is the client's own
stylesheet, copied verbatim from the pre-Astro source and design-frozen: the
rendered page must remain visually identical to the deployed site. No operation
kind in this contract may modify it, and a candidate whose diff touches it is
refused regardless of approval. `src/styles-article.css` — the one stylesheet
the article surfaces needed, because body prose is a genuinely new element with
no class in the frozen sheet — is renderer-owned and bound by
`renderer_sha256`. Every reused surface (`.article-grid`, `.article-card`,
`.article-meta`, `.article-type`, `.filters`, `.filter`, `.section-pad`,
`.section-heading`, `.eyebrow`, `.text-link`) still comes from the frozen sheet
untouched.

`markdown_policy_sha256` **now has a local binding**: `markdown-policy.v1.json`.
Earlier versions of this document recorded that it had none, on the grounds
that the repository had no Markdown content source. That is no longer true —
eighteen posts now live under `src/content/articles/` and render at
`/articles/<slug>/`. The binding closes a structural gap. It does **not** grant
the operation: `article_publish` remains unauthorized by `writable-paths.v1.json`,
which is the only file in this directory that can authorize anything.

## Two article surfaces, one of them new

`src/data/articles.yaml` is the **curated homepage list**: eight structured
reference records — category, type, human-readable display date, title,
summary, and an external `https` URL — rendered by the homepage Insights
section. Most point at articles hosted by other publishers, which are theirs
and not ours to re-host. The client chose these eight and their order.

`src/content/articles/**/*.md` is the **in-repo corpus**: eighteen posts
migrated from `davetaxnz.nz/wp-json/wp/v2/posts`, each with typed frontmatter
and a Markdown body, each rendered as a real page in this repository. `/articles/`
indexes them; `/articles/<slug>/` is one post.

They are separate content sources and the contract keeps them separate.
`src/lib/articles.ts` resolves a curated record whose URL is a `davetaxnz.nz`
permalink to the matching in-repo page, and leaves every third-party URL
pointing outward — which is the correct behaviour, because an Interest.co.nz
article is Interest.co.nz's to host. Publishing an article would not entitle a
writer to promote it onto the homepage; that is a separate editorial decision
and would be a separate operation.

Neither file is in the writable allowlist. Both are deliberately
automation-ready — a future workflow could append a reference record from a
media monitor, or a future Article Engine could write a post — and version 1
grants neither authority. Every entry and every article is added by a human
today.

Both surfaces feed the renderer-owned discovery output: `/rss.xml` and
`/llms.txt` are generated from the same validated records the pages render, and
`/sitemap.xml` and `/robots.txt` from the same site record. Those outputs are
derivations, not a third content source, and nothing may edit them directly.

## What the Markdown policy allows

`markdown-policy.v1.json` governs article bodies. Its allowlist is **twelve
mdast node types**, derived from a GFM parse of the eighteen migrated bodies
rather than copied from the reference contract:

```
root  heading  paragraph  text  emphasis  strong
break  link  image  list  listItem  blockquote
```

Two deliberate differences from the reference contract, in both directions:

- `thematicBreak` is allowed there and **refused here**, because no migrated
  body contains one. An allowlist entry that authorizes a node nothing uses
  widens authority for nothing.
- `image` is refused there and **allowed here**, because nineteen images are
  part of the client's verbatim body copy and removing them would be an edit.
  The allowance is narrowed rather than left open: every body image URL must be
  HTTPS *and* must resolve in `src/data/media-manifest.json` to a copy that
  ships under `public/assets/wp/`. All nineteen do, as do all fifteen
  `heroImage.src` values. An unresolvable URL means hot-linking an asset this
  site does not serve, so it fails closed rather than rendering a future 404.

`html` is refused, and it is the load-bearing entry. Astro renders raw HTML in
`.md` straight into the page, so one `html` node would let body copy emit
`<script>`, `<iframe>`, `<form>`, event-handler attributes or inline style
inside otherwise renderer-owned markup. It is refused at the AST level rather
than sanitized: a sanitizer is a filter that can be wrong, an allowlist is a
gate that cannot be partially satisfied. The five MDX node types are refused
alongside it, so enabling MDX later cannot silently inherit this approval.

There is consequently **no path from a governed article body to executable
code**, and that is a property of the allowlist rather than a separate check.
The twelve allowed types have exactly two URL-bearing fields between them —
`link.url` and `image.url` — and both are constrained to a closed protocol set,
so `javascript:`, `data:` and every other scheme fail closed. The site's two
interactive behaviours (mobile menu, article filter) are inline `<script>`
blocks in renderer-owned `.astro` components, bound by `renderer_sha256`; they
are never authored as content.

Heading depths **2 through 6** are permitted and depth 1 is reserved: the
detail page renders the frontmatter `title` as the page's only `<h1>`, so a
depth-1 body heading would emit a second one. The range is not tightened to the
reference contract's `[2,3,4]` — the client's own headings already reach depth 6,
and narrowing the policy would refuse existing verbatim copy, which would mean
editing the client's structure to satisfy a governance file. That is backwards.

Authored links are **HTTPS-only**. All 54 in the corpus are; `http:` is refused
rather than upgraded, because silently rewriting a source's canonical URL is a
change to an attribution. One narrow, declared exception exists: two bodies list
the client's own published address as a bare `dave@davetaxnz.nz` inside a
contact list, and GFM autolinks each into `mailto:dave@davetaxnz.nz`. Deleting
the address to satisfy an HTTPS-only rule would be an edit to client copy, so
the exception is written down and bounded in `autolinkLiteralConstraints`
instead of being absorbed into `linkProtocols`, where it would also authorize
hand-authored `mailto:` anchors pointing anywhere. A `mailto:` link passes only
when its visible text equals its destination.

The limits (`200` files, `64 KB` per file, `2000` nodes, AST depth `16`, `60`
links) are sized from the corpus with roughly 5× headroom, not copied from the
reference contract's larger numbers. They are denial-of-service and
blast-radius bounds on a hypothetical publisher, not editorial limits — nothing
here caps what the client may write, because nothing here is authorized to
write anything.

## Attribution is legally load-bearing

Twelve of the eighteen posts are reposts of Interest.co.nz, Stuff, RNZ Nine to
Noon, Newstalk ZB, Te Waha Nui or Stace Hammond reporting. The credit is
carried twice on purpose:

1. The frontmatter `attribution` object — `source` plus the canonical
   `originalUrl`, required together, because a half-filled attribution names a
   publisher without linking what it is crediting.
2. The client's own attribution line, verbatim in the body prose exactly where
   they wrote it.

The duplication is not redundancy. The frontmatter is the machine-readable
claim; the body line is the client's own words. The frontmatter object also
flips three renderer behaviours: the card label becomes the publisher rather
than the authored label, the byline drops Dave's name so the page cannot imply
he wrote another newsroom's reporting, and the JSON-LD author and publisher
become the source with the original linked as `isBasedOn` and `citation`.

Stripping, rewording, relocating or summarizing either one silently changes an
authorship claim. No operation in this contract may do it, and no operation may
add an attribution the body does not support. `markdown-policy.v1.json` states
the rule under `attributionRule` because a body-content verifier is where
someone will look for it, even though it is not expressible as a node-type
constraint.

## Renderer and environment

`astro.config.mjs` fixes `base` to `/` for the generated Vercel origin. Preview
and production builds therefore share the same public path layout, and their
tree digests are directly comparable when the source and toolchain match.

`npm run build` writes more than the static site: `dist/client` is the Astro
output, and `scripts/prepare-sites-build.mjs` then copies `worker/index.js` to
`dist/server/index.js` and `.openai/hosting.json` to `dist/.openai/`. The
manifest records `dist` as the output directory and `dist/client` as the
static root. Vercel publishes that static root, while the extra server and
hosting files preserve the local Sites handoff required by this repository.

The build emits twenty HTML pages — the homepage, `/articles/`, and one page
per published article — plus a discovery surface (`llms.txt`, `robots.txt`,
`rss.xml`, `sitemap.xml`), the generated stylesheet, and the copied assets
including the 36 migrated WordPress uploads under `assets/wp/`.
`renderer-manifest.v1.json` records that set under `publishedRoutes`, with
`articles/<slug>/index.html` written as a pattern because the route set is
derived from the content collection rather than fixed. That list is a factual
record of what the renderer currently emits; unlike the reference contract,
this repository has **no offline discovery-readiness verifier**, so nothing
enforces the list, checks canonical agreement, or refuses output drift. Treat
`publishedRoutes` as documentation, not as a gate.

`src/data/media-manifest.json` and `src/content.config.ts` are renderer
sources, not governed content: the first is migration provenance imported by
`src/lib/media.ts`, the second is simultaneously the frontmatter validator and
the collection loader. `src/data/article-migration-report.json` is neither — it
records what the extractor pulled from each WordPress post, is referenced only
in a source comment, and contributes no bytes to `dist`.

`src/App.jsx` and `src/articles.js` are inert. They are excluded by
`tsconfig.json`, imported by nothing in the build graph, and retained only as
the human reference the Astro components were ported from. They contribute no
bytes to `dist` and are explicitly excluded from the renderer source globs. A
publisher must not treat them as content or as renderer inputs.

## Failure semantics

Any unknown file, unknown field, schema drift between a JSON Schema and its
enforcing validator, precondition mismatch, partial write of the coupled phone
set, missing page slug, forbidden Markdown node, depth-1 heading, non-HTTPS
authored link, `mailto:` anchor whose text does not equal its destination,
image URL absent from the media manifest, exceeded Markdown limit, altered
attribution line, filename/slug disagreement, duplicate slug, symlink, path
traversal, digest mismatch, base-revision drift, or build failure refuses
publication. Refusal is whole-candidate: nothing is stripped, downgraded,
sanitized or auto-corrected by the model or the publisher. A policy that
repairs its input has decided what the client meant, which is not a decision a
publisher gets to make.

The Assistant Platform's authenticated approval would be canonical.
`naturalLanguageApproval` is `deny`: a message in a chat transcript is never
an approval, however unambiguous it reads. GitHub status checks enforce
validation and build integrity; a GitHub review approval is not silently
substituted for or conflated with a platform decision.

## Future work — the publisher does not exist

Everything above describes a target. The following are unbuilt:

- **The publisher.** Nothing constructs a candidate, computes the digests this
  manifest requires, opens a pull request, or merges one. There is no
  credential-free isolated builder in this repository.
- **The approval client.** `decisionSurface` names
  `assistant-platform-authenticated`, but no code here calls it, and no
  authenticated decision can currently be recorded or verified.
- **Schema-drift enforcement.** The requirement that the JSON Schemas stay
  field-for-field identical to `src/data/schema.ts` and `src/content.config.ts`
  is stated here and checked by nobody. A drift check belongs in CI before any
  writer is enabled.
- **A precondition verifier.** The index-identity assertions in
  `writable-paths.v1.json` are written down, not executed.
- **A Markdown-policy verifier.** `markdown-policy.v1.json` is written down and
  parsed by nothing. No code in this repository walks an article body's AST
  against the allowlist, checks heading depths, checks link protocols, or
  checks that image URLs resolve in the media manifest. The eighteen migrated
  bodies were surveyed by hand to derive the policy; nothing re-checks them on
  every build.
- **An attribution-integrity check.** Nothing refuses a diff that touches a
  body attribution line or a frontmatter `attribution` object. This is the
  highest-value missing gate: an operation able to write article bodies can
  silently rewrite an authorship claim on another newsroom's reporting.
- **Author and reviewer identity.** The frontmatter has no `author` or
  `reviewedBy` field. On a repost the JSON-LD author is derived from
  `attribution.source`, which is a publisher name, not a bound canonical
  identity.
- **Source expiry and re-review state.** The corpus makes dated statutory
  claims — Section CB 4 of the Income Tax Act 2007, the ten-day statutory
  demand window, the April 2026 IRD crypto figures. Nothing records when a
  claim was last verified, and calendar-age freshness is explicitly
  unevaluated.
- **Alternative text.** Several migrated WordPress media records carry an empty
  `alt`, and the migration preserved that rather than inventing alternative
  text on the client's behalf. `markdown-policy.v1.json` therefore sets
  `requireAlt: false`. This is a real accessibility gap, recorded as one. It
  closes by the client supplying the text, not by a publisher fabricating it.
- **A discovery-readiness verifier.** The reference contract pins an offline
  verifier that binds every public canonical page to the exact governed source
  and built-output bytes, and refuses canonical drift, incomplete
  sitemap/`llms.txt`/RSS coverage, and ungoverned output files. This
  repository has no equivalent and makes no such guarantee.
- **A self-test.** The reference contract carries a patch self-test
  demonstrating semantic before/after comparison and operation-family
  isolation — an entire-file blob match is not enough. This repository has no
  equivalent.

When a publisher is built, it must independently reproduce every rule in this
directory. It must not trust a check supplied by the target repository as its
authority.

And to restate the thing this document exists to say: **none of the above
grants any authority.** Describing an article surface is not permitting one.
`writable-paths.v1.json` permits one closed, two-input `public_phone` patch
over thirteen targets across four files, `default` is `deny`, and the
eighteen articles, nine page records and eight curated references in this
repository are edited by hand by people.
