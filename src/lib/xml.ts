/**
 * XML text escaping, shared by every XML discovery surface.
 *
 * The sitemap and the RSS feed both embed governed content (article titles,
 * excerpts, source names) into XML text nodes and attribute values. They must
 * escape identically, so the escaper lives in one place rather than being
 * re-typed per route.
 *
 * All five predefined entities are escaped, including `'` and `"`, so the same
 * function is safe for an attribute value as for a text node.
 */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
