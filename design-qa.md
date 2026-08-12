# Design QA

- Source visual truth: restored scrollable implementation from commit `8a619e3`; publication-logo treatment from `/var/folders/n2/d96307fd2c91hg5g4xt_f24m0000gn/T/codex-clipboard-43f2c6e2-4376-47d0-beee-7f9eaff1ecca.png`
- Implementation screenshot: `/tmp/dave-tax-design-qa-restored/restored-desktop.png`
- Comparison board: `/tmp/dave-tax-design-qa-restored/design-qa-comparison-restored.png`
- Desktop viewport: 1536 × 1024 CSS pixels, device scale factor 1
- Mobile viewport: 390 × 844 CSS pixels, device scale factor 1
- Source direction pixels: 1536 × 1024
- Implementation pixels: 1536 × 1024
- Density normalization: none required
- State: homepage, desktop navigation closed; mobile navigation tested open and closed

## Full-view comparison evidence

The rollback restores the earlier production composition: a substantial split hero followed by proof, Expertise, Client Story, Articles & Media, Contact, and footer sections. The page is 3,719 CSS pixels tall in its default desktop state and scrolls normally. The comparison board confirms that the dark editorial hero, portrait, typography, warm paper proof section, vermilion actions, and publication strip retain the selected visual language.

The compact one-screen presentation is intentionally not reproduced because the user explicitly requested restoration of the previous scrollable page.

## Focused-region evidence

The proof-section region was checked separately at desktop and mobile sizes. The supplied publication lockup is rendered as one sharp 402 × 85 image and visibly contains Newstalk ZB, Stuff, NZ Lawyer, and The Post. All five local images loaded with non-zero natural dimensions.

## Findings

- No actionable P0, P1, or P2 issues remain.
- Fonts and typography: the restored Libre Franklin and Source Serif 4 hierarchy matches the earlier scrollable build, including the large hero display and editorial headings.
- Spacing and layout rhythm: the long-form section sequence and generous vertical rhythm are restored. Desktop and mobile show no horizontal overflow.
- Colors and visual tokens: the near-black, warm paper, vermilion, muted gold, and grey rule system is restored without new drift.
- Image quality and asset fidelity: Dave’s supplied logo and portraits remain local assets. The four publication marks use the supplied raster lockup rather than substituted text.
- Copy and content: the previous service, client story, article, contact, and footer content is restored.
- Interaction and responsiveness: article filtering works; selecting “In the media” displays two cards. The mobile menu reports the correct expanded state, becomes visible, closes correctly, and the page remains free of horizontal overflow.

## Comparison history

- Earlier compact pass: the page was compressed into a 958-pixel presentation canvas, removing the expected long-form scrolling experience.
- Rollback pass: reverted the compact page to commit `8a619e3`, restoring all long-form sections and normal scrolling.
- Logo pass: replaced the earlier text-only media links with the supplied Newstalk ZB, Stuff, NZ Lawyer, and The Post image lockup. Post-fix desktop and mobile captures show the lockup fully visible.

## Follow-up polish

- P3: connect the existing article collection to the planned automated publishing source when that workflow is selected.

## Final result

final result: passed
