/**
 * `articles.yaml` stores `date` as the human display string the card renders,
 * and that string is verbatim design copy — it is never reformatted for the
 * page. Machine surfaces (RSS `pubDate`) need a real Date, so the display
 * string is parsed rather than a second, driftable date field being added to
 * the content model.
 *
 * The upstream data is not uniformly precise. Most entries are "11 August 2026";
 * one media mention is only "2026", because that is all the publisher dated it.
 * Both are legitimate content, so both parse. An imprecise string resolves to
 * the EARLIEST instant it denotes ("2026" → 1 January 2026, "August 2026" →
 * 1 August 2026), which is the conventional reading and keeps the feed ordering
 * identical to the rendered card order.
 *
 * Parsing is otherwise strict: an unrecognised string is a build failure, not a
 * silent `Invalid Date` in the feed.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "11 August 2026" | "August 2026" | "2026" */
const DISPLAY_DATE = /^(?:(?:(\d{1,2}) )?([A-Za-z]+) )?(\d{4})$/;

export function parseArticleDate(value: string): Date {
  const match = DISPLAY_DATE.exec(value.trim());
  if (!match) {
    throw new Error(
      `src/data/articles.yaml: cannot parse date "${value}" ` +
        `(expected "D Month YYYY", "Month YYYY" or "YYYY")`,
    );
  }
  const [, rawDay, rawMonth, rawYear] = match;

  let monthIndex = 0;
  if (rawMonth !== undefined) {
    monthIndex = MONTHS.indexOf(rawMonth as (typeof MONTHS)[number]);
    if (monthIndex === -1) {
      throw new Error(`src/data/articles.yaml: unknown month "${rawMonth}" in date "${value}"`);
    }
  }
  const day = rawDay === undefined ? 1 : Number(rawDay);
  const year = Number(rawYear);

  // UTC midnight: the display string carries no time zone, and anchoring to UTC
  // keeps the emitted RFC-822 pubDate stable regardless of the build machine.
  const parsed = new Date(Date.UTC(year, monthIndex, day));
  if (parsed.getUTCDate() !== day || parsed.getUTCMonth() !== monthIndex) {
    throw new Error(`src/data/articles.yaml: date "${value}" is not a real calendar date`);
  }
  return parsed;
}

/**
 * Sort comparator: newest first. `Array.prototype.sort` is stable, so entries
 * sharing a date keep the governed order they have in articles.yaml — which is
 * also the order the cards render in.
 */
export function newestArticleFirst(left: { date: string }, right: { date: string }): number {
  return parseArticleDate(right.date).getTime() - parseArticleDate(left.date).getTime();
}
