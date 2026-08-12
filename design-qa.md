# Design QA

## Reference

- Source: user-provided Build 3 desktop reference, 1265 × 958.
- Validation viewport: 1265 × 958 desktop and 390 × 844 mobile.

## Pass history

### Pass 1

- The page bands matched the reference height, but the portrait started below the navigation rather than behind it.
- The logo was undersized, the navigation sat too far right, and the portrait crop showed too little of Dave near the top edge.
- Evidence/profile alignment and footer CTA placement needed refinement.

### Pass 2

- Rebuilt the hero as a layered composition so the portrait spans the complete 444 px hero while navigation overlays it.
- Corrected the logo footprint, headline width, portrait crop, evidence divider, article typography, and footer alignment.
- Replaced typed media names with a precise image lockup extracted from the approved reference.

### Final pass

- Desktop section boundaries align at 98 px, 542 px, 659 px, 869 px, and 944 px.
- Portrait, caption, headline, CTAs, quote, profile, media marks, five-column article grid, and closing bar visually match the approved composition.
- Mobile layout reflows to a single column; menu opens and closes correctly, links remain keyboard-accessible, and all content remains readable without horizontal overflow.
- Production build and route/link tests pass.

## Known constraints

- The reference includes future-dated article examples. They are retained as presentation content and link to the closest relevant live pages until an automated article feed is connected.
