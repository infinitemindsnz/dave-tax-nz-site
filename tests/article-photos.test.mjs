import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { articlePhotosSchema, articlePhotoPath } from '../src/lib/article-photos.ts';

const bytes = readFileSync(new URL('./fixtures/article-photo.jpg', import.meta.url));
const photo = {sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, width: 320, height: 200, jpegBase64: bytes.toString('base64'), alt: 'Geometric shapes', caption: ''};
test('governed article photos have exact content-addressed bytes and no active or external content', () => {
  assert.deepEqual(articlePhotosSchema.parse([photo]), [photo]);
  assert.equal(articlePhotoPath(photo), `/article-photos/${photo.sha256.slice(7)}.jpg`);
  for (const bad of [{...photo, width: 319}, {...photo, sha256: `sha256:${'0'.repeat(64)}`}, {...photo, alt: '<img>'}, {...photo, url: 'https://example.test/picture'}, {...photo, jpegBase64: `${photo.jpegBase64}\n`}]) {
    assert.equal(articlePhotosSchema.safeParse([bad]).success, false);
  }
  assert.equal(articlePhotosSchema.safeParse([photo, photo]).success, false);
  const withMetadata = Buffer.concat([bytes.subarray(0,2), Buffer.from([255,225,0,4,65,66]), bytes.subarray(2)]);
  assert.equal(articlePhotosSchema.safeParse([{...photo, sha256: `sha256:${createHash('sha256').update(withMetadata).digest('hex')}`, jpegBase64: withMetadata.toString('base64')}]).success, false);
});
