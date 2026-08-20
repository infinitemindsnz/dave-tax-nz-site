# Evidence record — public phone occurrences and `public_hours_patch` residue

- **Audit ID:** `EV-2026-08-20-PHONE-HOURS-001`
- **Recorded:** 2026-08-20
- **Method:** read-only inventory at a frozen revision, plus one clean build of that
  revision to establish render-reachability from output bytes rather than inference.
- **Nothing in this audit edited a governed value.** `src/data/site.yaml`,
  `src/data/pages.yaml`, `src/content/articles/**` and every file under `governance/`
  are byte-identical to the frozen commit.

## 1. Frozen revision

| | |
|---|---|
| Commit | `40a7cb01a1cc8e7b32ae09195ad5cf626cf01dfc` |
| Tree | `5ae81d88770967cfe352c85a94bac2fbc0b3a366` |
| Subject | `deploy: refuse to ship a tree the publication receipt would misname` |
| Working tree at audit time | clean apart from untracked `.nanika-lock`; `node_modules/` and `dist/` are gitignored build products |
| Build used for reachability | `npm ci && npm run build`, `GITHUB_ACTIONS` unset → `resolvedBase: "/"`, matching `governance/renderer-manifest.v1.json.buildEnvironment` |
| Build result | success, 27 HTML pages + `llms.txt`, `robots.txt`, `rss.xml`, `sitemap.xml` |

## 2. Phone occurrence inventory — source

Two distinct literals exist. They are **not** interchangeable and the contract preserves
the mismatch deliberately:

- `DISPLAY` = `+64 21 021 68888` (12 digits)
- `DIAL` = `+64210216888` (11 digits), always inside a `tel:` href or a JSON-LD `telephone`

### 2a. Governed pointers — `src/data/site.yaml` (3 occurrences, all in `writable-paths.v1.json.files`)

| # | Line | JSON pointer | Literal | Proposal field |
|---|---|---|---|---|
| P1 | `src/data/site.yaml:91` | `/hero/ctas/1/href` | `tel:` + DIAL | `public_phone` |
| P2 | `src/data/site.yaml:216` | `/contact/rows/0/value` | DISPLAY | `public_phone` |
| P3 | `src/data/site.yaml:217` | `/contact/rows/0/href` | `tel:` + DIAL | `public_phone` |

`writeMode` is `atomic`; the three are declared a coupled set. Index-addressed pointers
P1 and P3 are guarded by the `preconditions` identity assertions on
`/contact/rows/0/label`, `/hero/ctas/1/label` and `/hero/ctas/1/variant`.

### 2b. Render-reachable occurrences NOT covered by any pointer — `src/data/pages.yaml` (8)

`pages.yaml` is not a writable path under any operation kind, yet each of these reaches
published bytes.

| # | Line | Page record | Field | Literal | Rendered as |
|---|---|---|---|---|---|
| G1 | `src/data/pages.yaml:185` | `about-dave` | `description` | DISPLAY | `<meta name=description>`, `og:description`, `twitter:description` (×3) |
| G2 | `src/data/pages.yaml:197` | `about-dave` | `sections[].items[]` | DISPLAY | `<li>` in `.article-prose` |
| G3 | `src/data/pages.yaml:255` | `contact` | `description` | DISPLAY | head meta ×3 |
| G4 | `src/data/pages.yaml:265` | `contact` | `sections[].body` | DISPLAY | `<p>` under `<h3>Mobile Cell:</h3>` |
| G5 | `src/data/pages.yaml:571` | `student-loan-negotiations` | `sections[].items[]` | DISPLAY | `<li>` |
| G6 | `src/data/pages.yaml:696` | `student-loan-negotiations` | `sections[].items[]` | DISPLAY | `<li>` under `Contact Dave` |
| G7 | `src/data/pages.yaml:725` | `ird-disputes-tax-penalties-negotiation` | `sections[].items[]` | DISPLAY | `<li>` |
| G8 | `src/data/pages.yaml:860` | `ird-disputes-tax-penalties-negotiation` | `sections[].items[]` | DISPLAY | `<li>` under `Contact Dave` |

`src/data/pages.yaml:895` (`"Phone:"`, a `book-a-consultation` form label) carries no
number and is excluded from the count.

### 2c. Render-reachable occurrences in article bodies (2)

| # | Location | Literal | Draft |
|---|---|---|---|
| A1 | `src/content/articles/can-ird-arrest-me-at-the-border-over-my-student-loan.md:65` | DISPLAY | `draft: false` |
| A2 | `src/content/articles/i-live-in-australia-and-my-nz-student-loan-has-doubled-what-can-i-do.md:144` | DISPLAY | `draft: false` |

No article carries `draft: true`, so both are published.

### 2d. Non-render occurrences (documentation and comments — inventoried, not reachable)

`src/data/site.yaml:212`, `:213` (the preserve-the-bug comment); `src/lib/structured-data.ts:19`, `:20`;
`governance/writable-paths.v1.json:17`; `governance/README.md:103`.

### 2e. Totals

**Source, render-reachable: 13** — 3 governed (P1–P3) + 8 ungoverned `pages.yaml` (G1–G8)
+ 2 article bodies (A1–A2). **10 of 13 sit outside the declared pointer set.**

## 3. Renderer traces

| Source | Renderer path | Output surface |
|---|---|---|
| P1 `/hero/ctas/1/href` | `lib/content.ts` → `components/Hero.astro:56` → `pages/index.astro` | homepage "Call Dave" `<a href="tel:…">` |
| P2 `/contact/rows/0/value` | `components/Contact.astro:32` (`<span><small>{row.label}</small>{row.value}</span>`) | visible number in the Contact block on **every** page — `index.astro`, all 7 `[slug].astro` routes, `articles/index.astro`, all 18 `articles/[slug].astro` |
| P3 `/contact/rows/0/href` | (a) `Contact.astro:32` `<a href>`; (b) `lib/structured-data.ts:85-89` — `contact.rows.find(row => row.href.startsWith("tel:"))`, sliced to `telephone`; (c) `lib/llms-document.ts:162-164` | `tel:` href on every page; JSON-LD `telephone` on Organization + LegalService + Person (homepage) and Organization + Person (each article); `/llms.txt` contact row |
| G1, G3 | `pages/[slug].astro` → `BaseLayout.astro:82,90,98` | three head meta tags per page |
| G2, G5–G8 | `lib/pages.ts:planPage/groupSections` → `PageSections.astro` → `ListSection.astro` | `<li>` verbatim |
| G4 | same → `ProseSection.astro` (`toParagraphs`) | `<p>` verbatim |
| A1, A2 | `content.config.ts` glob → `lib/articles.ts:publishedArticles` → `pages/articles/[slug].astro` | article body list item |

**Structured data is derived from `tel:`, never from the display string** — confirmed in
`lib/structured-data.ts:17-20` and in the built bytes, so machines receive the 11-digit
form and humans the 12-digit form by design.

### 3a. Occurrences in built output (`dist/client`, measured)

| Literal | Count |
|---|---|
| `+64 21 021 68888` (DISPLAY) | **42** |
| `tel:+64210216888` | **29** |
| `+64210216888` (DIAL, total) | **68** |
| `"telephone":"+64210216888"` (JSON-LD) | **39** |

Reconciliation: DISPLAY 42 = 27 Contact blocks + 12 `pages.yaml`-derived (4 `about-dave`,
4 `contact`, 2 `student-loan-negotiations`, 2 `ird-disputes`) + 2 article bodies + 1
`llms.txt`. `tel:` 29 = 27 Contact blocks + 1 hero CTA + 1 `llms.txt`. JSON-LD 39 =
3 homepage nodes + 18 articles × 2 nodes. DIAL 68 = 29 + 39. `rss.xml` and `sitemap.xml`
contain no phone occurrence.

## 4. `public_hours_patch` — current references

Withdrawn by `e709dc4`, which touched **only** `governance/content-contract.v1.json` and
`governance/writable-paths.v1.json`. Five references survive at `40a7cb0`:

| # | Location | Semantic status |
|---|---|---|
| H1 | `governance/writable-paths.v1.json:35` | **Intended.** `documentedOperations` entry, `permitted: false`, with the full rationale, `wouldNotTarget` list and four re-enable preconditions. |
| H2 | `governance/content-contract.v1.json:8` | **Intended.** Comment recording why the `consultation_availability` mapping was removed. |
| H3 | `governance/approval-policy.v1.json:11` | **Residue — live grant surface.** Still an entry in `operations[]` with `artifactClass: site_block_patch` and `requiredApprovalStages: ["publication_approval"]`. Unchanged since `2658162`. |
| H4 | `governance/schemas/candidate-manifest.v1.schema.json:49` | **Residue.** Still in the `operation_kind` enum, so a manifest declaring it still validates. |
| H5 | `governance/schemas/candidate-manifest.v1.schema.json:174` | **Residue.** The `if/then` branch constraining its `artifact_class` and approval stages is still present. |

Stale prose that still describes the withdrawn operation as permitted:
`governance/README.md:17`, `:93`, `:110-117`, `:119`, `:167`, `:443`, and
`governance/writable-paths.v1.json:66` — all count **four** pointers or two permitted
operation families where the policy now grants **three** pointers and one.

`writable-paths.v1.json.files` is the exhaustive allowlist and `default` is `deny`, so an
hours candidate is refused at the write gate. H3–H5 do not grant a write; they leave the
operation kind constructible and approvable up to that point.

## 5. Policy digests (SHA-256 of file bytes)

| File | Pre-withdrawal (`92f6335` / `2658162`) | Current (`40a7cb0`) | Changed |
|---|---|---|---|
| `governance/writable-paths.v1.json` | `7e5159f5412e65ddf096a0a9db5a7a1d7c451e06f5813da5c3356202036f657d` | `e8d923cc0a3f519e56c1dc0943adc9ef8b42f18c8322158e7eb5375246799777` | **yes** |
| `governance/content-contract.v1.json` | `57532cc4807a9b63186e1e2e4d102b500c233381cea1d1fa030729c5d51208dc` | `9e846e3a6e2b49d916df0284a8cda24dd13734b88c95baf554505530d75e9ae1` | **yes** |
| `governance/approval-policy.v1.json` | `122c59abee02f1673549ce6f1cad731f2e158f13b5393a8b82d39c5a849e2d60` | `122c59abee02f1673549ce6f1cad731f2e158f13b5393a8b82d39c5a849e2d60` | no |
| `governance/schemas/candidate-manifest.v1.schema.json` | `f8fddef74055141707e55afbbd5b6f517cec91aa0c1345b15e1d58fc68799230` | `f8fddef74055141707e55afbbd5b6f517cec91aa0c1345b15e1d58fc68799230` | no |
| `governance/README.md` | `cbfefdce1da20cfad3ad644f5df1ccd381ccf9ba170b17ae43ff07abc1d3e094` | `cbfefdce1da20cfad3ad644f5df1ccd381ccf9ba170b17ae43ff07abc1d3e094` | no |

Other current digests, recorded for future comparison:

| File | `40a7cb0` |
|---|---|
| `governance/renderer-manifest.v1.json` | `683f645936da608bbcf4b8344634df4e53b7636845be56e4e205a3aaf85f652d` |
| `governance/markdown-policy.v1.json` | `024b05d5187a806effd9dd178dc989aad2c13115c2f235edbfd0f85bc4311dbb` |
| `governance/schemas/site.v1.schema.json` | `2764ccdceb8f5b76359cf3014b9e63412f247f75fb21815a766497515ba2f148` |
| `governance/schemas/pages.v1.schema.json` | `595c06d87ebd402b2988a63197019e543b92969fef29431f56487d1de6cb0d7b` |

## 6. Commit metadata verification (read-only)

Neither commit is an ancestor of `40a7cb0`; both live only on their own refs.
`git show 40a7cb0:src/data/site.yaml` hashes to `908ab6a3…`, identical to `2658162`, so
the audited tree carries neither publish.

| | `2c130a8` | `46d3767` |
|---|---|---|
| Full OID | `2c130a8444bf952d14a3c6e5088cf7afbdebf46d` | `46d376766e070f499d0e801b00ea812471da8019` |
| Ref | `governed/APR-LIVE-PHONE-001` | `governed/APR-LIVE-PHONE-002-REVERT` |
| Tree | `224c2b2078c73ee80574ba5c73e7e4c677e45ad5` | `61412ef42aaecc69f7f60912e9d2afb0fdf4c1ee` |
| Parent | `2658162216…` | `2c130a8444…` |
| Author = committer | `governed-site-publisher <governed-site-publisher@publisher.invalid>` | same |
| Timestamp | `1786917650 +1200` (2026-08-17 10:00:50) | `1786917700 +1200` (2026-08-17 10:01:40) |
| Signature | `%G?` = `N` — unsigned | `N` — unsigned |
| Files touched | `src/data/site.yaml` only, 3+/3− | `src/data/site.yaml` only, 3+/3− |
| `approval-id` | `APR-LIVE-PHONE-001` | `APR-LIVE-PHONE-002-REVERT` |
| `operation-kind` / `field` | `public_phone_patch` / `public_phone` | same |
| `base-sha` | `26581622162dbdd5506a76bb8c7dcf707f137e8f` — matches actual parent | `2c130a8444bf952d14a3c6e5088cf7afbdebf46d` — matches actual parent |
| `policy-sha256` | `7e5159f5…` | `7e5159f5…` |
| `contract-sha256` | `57532cc4…` | `57532cc4…` |
| Principals | requested `principal-requester-live-A`, approved `principal-approver-live-B`, published `governed-site-publisher` | identical |

### 6a. Findings from the metadata

1. **Digests are correct for their base and stale against HEAD.** `7e5159f5…` and
   `57532cc4…` match `writable-paths.v1.json` and `content-contract.v1.json` exactly as
   they stood at `2658162`. Both files changed in `e709dc4`, so any replay, re-verify or
   re-approval of these candidates against `40a7cb0` must fail the digest check. That is
   the gate working; recorded so a future reader does not read the mismatch as corruption.
2. **The declared changes match the applied diff, pointer for pointer,** for both
   commits — all three coupled pointers written in one commit, as `writeMode: "atomic"`
   requires.
3. **`46d3767` is not a faithful revert.** Its trailer declares
   `/contact/rows/0/value: "+64211234567" -> "+64210216888"`, and the applied diff agrees.
   The value at `2658162` was `"+64 21 021 68888"`. `git diff 2658162 46d3767 --
   src/data/site.yaml` is therefore **non-empty**: the display string is left as the
   11-digit dialable form. P1 and P3 return to base; P2 does not.
4. Consequence: the commit labelled `-REVERT` silently performed the reconciliation
   `writable-paths.v1.json:17` explicitly forbids — "A publisher MUST NOT auto-reconcile
   the drift." The comment block at `src/data/site.yaml:211-215`, which still names
   `"+64 21 021 68888"` as the preserved value, would be left describing a value that is
   no longer there.
5. Both commits are unsigned. Attribution rests entirely on trailer text and a
   `.invalid` author address, neither of which is cryptographically bound.

## 7. Observations carried forward

- The coupled set is declared over 3 of the 13 render-reachable phone occurrences. A
  correctly-executed, fully-approved `public_phone_patch` at `40a7cb0` would still leave
  10 occurrences of the old number live — including the `/contact/` and `/about-dave/`
  meta descriptions and four `<li>` items — and every structural gate would pass.
- `governance/renderer-manifest.v1.json.publishedRoutes.comment` says the build emits
  "20 pages". The measured count at `40a7cb0` is **27** HTML pages (1 homepage + 7 routed
  `pages.yaml` slugs + 1 articles index + 18 articles). The route *list* is correct; the
  count in the prose is stale.
