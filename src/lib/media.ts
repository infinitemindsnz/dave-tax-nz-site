import manifest from "../data/media-manifest.json";

/**
 * Resolves a WordPress upload URL to the local copy under public/assets/wp/.
 *
 * `src/data/media-manifest.json` was produced by the migration and maps every
 * davetaxnz.nz upload referenced by migrated content to a file that now ships
 * in this repo. Discovery surfaces care because Open Graph images and JSON-LD
 * `image` values should point at an asset this site actually serves — a crawler
 * that cannot reach the client's WordPress host would otherwise see no image.
 *
 * A URL the manifest does not know is returned unchanged rather than guessed
 * at: an unresolvable remote image is still a correct absolute URL, whereas a
 * fabricated local path would 404.
 */

interface MediaRecord {
  local: string;
  alt: string;
  width: number;
  height: number;
}

const media = manifest.media as Record<string, MediaRecord>;

/**
 * Site-relative path (no leading slash, no base) for a migrated upload, or
 * `undefined` when the manifest has no local copy. The manifest stores
 * root-absolute paths ("/assets/wp/x.webp"); the leading slash is stripped so
 * the value can go through `absoluteUrl`, which owns the `base` prefix.
 */
export function localMediaPath(url: string): string | undefined {
  const record = media[url];
  if (!record) return undefined;
  return record.local.startsWith("/") ? record.local.slice(1) : record.local;
}

/**
 * Absolute URL for an image referenced by migrated content: the local copy when
 * one exists, otherwise the original remote URL, untouched.
 */
export function resolveMediaUrl(
  url: string,
  absolute: (path: string) => string,
): string {
  const local = localMediaPath(url);
  return local === undefined ? url : absolute(local);
}
