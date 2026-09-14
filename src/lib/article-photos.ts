import { createHash } from 'node:crypto';
import { z } from 'zod';

const line = (max: number) => z.string().max(max).refine((text) => text.trim() === text && !/[<>]|\p{C}/u.test(text));
export const articlePhotoSchema = z.strictObject({
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  width: z.number().int().min(1).max(1280),
  height: z.number().int().min(1).max(1280),
  jpegBase64: z.string().min(1).max(87384).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  alt: line(300).refine((text) => text.length > 0),
  caption: line(500),
}).superRefine((photo, context) => {
  const bytes = Buffer.from(photo.jpegBase64, 'base64');
  let valid = bytes.length >= 20 && bytes.length <= 65536 && bytes.subarray(0, 2).toString('hex') === 'ffd8'
    && bytes.toString('base64') === photo.jpegBase64 && `sha256:${createHash('sha256').update(bytes).digest('hex')}` === photo.sha256;
  let offset = 2, frame = false, scan = false, ended = false;
  while (valid && offset < bytes.length) {
    if (bytes[offset++] !== 255) { valid = false; break; }
    const marker = bytes[offset++];
    if (scan) {
      if (marker === 217) { ended = offset === bytes.length; break; }
      if (marker !== 0 && !(marker >= 208 && marker <= 215)) { valid = false; break; }
    } else {
      if (![224, 219, 192, 196, 221, 218].includes(marker) || offset + 2 > bytes.length) { valid = false; break; }
      const size = bytes.readUInt16BE(offset);
      if (size < 2 || offset + size > bytes.length) { valid = false; break; }
      if (marker === 224 && (size !== 16 || bytes.subarray(offset + 2, offset + 7).toString('hex') !== '4a46494600' || bytes[offset + 14] || bytes[offset + 15])) valid = false;
      if (marker === 192) {
        valid = valid && !frame && size === 17 && bytes[offset + 2] === 8 && bytes[offset + 7] === 3
          && bytes.readUInt16BE(offset + 3) === photo.height && bytes.readUInt16BE(offset + 5) === photo.width;
        frame = true;
      }
      offset += size;
      if (marker === 218) { scan = true; valid = valid && frame; }
    }
    if (scan) while (offset < bytes.length && bytes[offset] !== 255) offset++;
  }
  if (!valid || !ended) context.addIssue({ code: 'custom', message: 'Photo must be the exact bounded metadata-free baseline JPEG' });
});
export const articlePhotosSchema = z.array(articlePhotoSchema).max(6).refine((photos) => new Set(photos.map((photo) => photo.sha256)).size === photos.length);
export type ArticlePhoto = z.infer<typeof articlePhotoSchema>;
export function articlePhotoPath(photo: ArticlePhoto): string { return `/article-photos/${photo.sha256.slice(7)}.jpg`; }
