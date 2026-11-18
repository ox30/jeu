// Packing a save for the browser's storage: gzip (the browser's own CompressionStream) then
// base64, so that a long game with all its watch reports takes a tenth of its size and the
// five automatic saves fit. Where the browser has no CompressionStream the text is kept as
// it is. No library: only what the platform gives.

const CHUNK = 0x8000;

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

function fromBase64(text) {
  const s = atob(text);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

export function canCompress() {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof Response === 'function';
}

/** { enc: 'gzip' | 'raw', data }: the text packed for storage. */
export async function pack(text) {
  if (!canCompress()) return { enc: 'raw', data: text };
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    return { enc: 'gzip', data: toBase64(bytes) };
  } catch {
    return { enc: 'raw', data: text };
  }
}

/** The text back. Throws when the packed data is damaged or its encoding unknown. */
export async function unpack(packed) {
  if (!packed || typeof packed.data !== 'string') throw new Error('pack: empty');
  if (packed.enc === 'raw') return packed.data;
  if (packed.enc !== 'gzip') throw new Error(`pack: unknown encoding ${packed.enc}`);
  if (!canCompress()) throw new Error('pack: unsupported');
  const stream = new Blob([fromBase64(packed.data)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
