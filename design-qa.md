# Design QA

- Source visual truth: `/Users/shankar/.codex/generated_images/019ff4d4-050b-7da2-8650-88079745a433/exec-290e382f-13cd-48b8-9014-feb11a3b8a35.png`
- Implementation screenshot: `implementation-desktop-viewport.png`
- Comparison board: `design-qa-comparison.png`
- Viewport: 1536 × 1024 CSS pixels, device scale factor 1
- Source pixels: 1536 × 1024
- Implementation pixels: 1536 × 1024
- Density normalization: none required; both evidence images are 1× and equal size
- State: homepage, top of page, desktop navigation closed

## Full-view comparison evidence

The side-by-side comparison board shows the selected dark editorial direction is preserved: black hero, left-aligned high-impact headline, real portrait on the right, vermilion primary actions, warm paper evidence band, serif editorial typography, strong rules and compact metadata. The implementation intentionally extends the page below the initial viewport so article filters, services, client evidence and contact information remain comfortably readable and accessible rather than compressing the entire production site into the concept image’s presentation-board height.

## Focused-region evidence

No additional crop was required because the 1536 × 1024 board keeps the logo, navigation, hero typography, portrait crop, calls to action and evidence strip readable at original density. Mobile evidence was separately captured in `implementation-mobile-top.png` and `implementation-mobile.png` at 390 × 844.

## Findings

- No actionable P0, P1 or P2 fidelity issues remain.
- Fonts and typography: Libre Franklin and Source Serif 4 reproduce the source’s modern grotesk/editorial-serif contrast. Headline wrapping is intentionally narrower at common desktop widths to maintain readable measure.
- Spacing and layout rhythm: the hero’s split grid, action grouping and evidence strip match the source hierarchy. Below-fold sections use a roomier production rhythm than the compressed concept board.
- Colors and visual tokens: near-black, warm paper, vermilion, muted gold and grey rules match the visual target and retain accessible contrast.
- Image quality and asset fidelity: Dave’s real source-site logo and two real portraits are used locally with no hotlinking or generated substitutes.
- Copy and content: visible claims, testimonials, services, contact details and media links are grounded in davetaxnz.nz. Unverified media logos and invented article titles from the concept were not reproduced.
- Interaction and responsiveness: desktop article filtering works; the mobile menu opens, exposes the correct expanded state, closes after navigation and lands on the target section; console error/warning checks were clear.

## Comparison history

- Initial implementation: the selected direction and core layout matched with no P0/P1/P2 findings. No visual fixes were required after the first normalized comparison.

## Follow-up polish

- P3: replace external Google Fonts with self-hosted subsets before a final custom-domain launch if absolute third-party independence is required.
- P3: migrate article entries from `src/articles.js` to the future automated publishing source when that workflow is selected.

## Final result

final result: passed
