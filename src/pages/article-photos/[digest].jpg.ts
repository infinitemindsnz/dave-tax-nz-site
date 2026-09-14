import type { APIRoute } from 'astro';
import { publishedArticles } from '../../lib/articles';
import type { ArticlePhoto } from '../../lib/article-photos';

export async function getStaticPaths() {
  const photos = new Map<string, ArticlePhoto>();
  for (const article of await publishedArticles()) {
    for (const photo of article.data.photos ?? []) {
      const prior = photos.get(photo.sha256);
      if (prior && prior.jpegBase64 !== photo.jpegBase64) throw new Error('Article photo digest collision');
      photos.set(photo.sha256, photo);
    }
  }
  return [...photos.values()].map((photo) => ({ params: { digest: photo.sha256.slice(7) }, props: { photo } }));
}
export const GET: APIRoute = ({ props }) => new Response(new Uint8Array(Buffer.from(props.photo.jpegBase64, 'base64')), {
  headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
});
