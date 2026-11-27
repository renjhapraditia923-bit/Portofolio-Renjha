import { put, list, del } from '@vercel/blob';
import { timingSafeEqual } from 'node:crypto';

const PHOTOS_PREFIX = 'photos/';
const ALLOWED_SLOTS = new Set(['img-tool-1', 'img-tool-2', 'img-tool-3', 'img-tool-4']);
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function isAuthorized(request) {
  const expected = process.env.COVER_ADMIN_PASSWORD;
  if (!expected) return false;
  const given = request.headers.get('x-admin-password') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function listSlot(slot) {
  const { blobs } = await list({ prefix: `${PHOTOS_PREFIX}${slot}/` });
  return blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

export async function GET() {
  try {
    const { blobs } = await list({ prefix: PHOTOS_PREFIX });
    const latest = {};
    for (const blob of blobs) {
      const slot = blob.pathname.slice(PHOTOS_PREFIX.length).split('/')[0];
      if (!ALLOWED_SLOTS.has(slot)) continue;
      const current = latest[slot];
      if (!current || new Date(blob.uploadedAt) > new Date(current.uploadedAt)) {
        latest[slot] = blob;
      }
    }
    const photos = Object.fromEntries(Object.entries(latest).map(([slot, blob]) => [slot, blob.url]));
    return json(
      { photos },
      200,
      { 'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=300' },
    );
  } catch (error) {
    console.error('Gagal membaca foto:', error);
    return json({ photos: {} }, 200, { 'Cache-Control': 'no-store' });
  }
}

export async function POST(request) {
  if (!process.env.COVER_ADMIN_PASSWORD) {
    return json({ error: 'COVER_ADMIN_PASSWORD belum diatur di server.' }, 500);
  }
  if (!isAuthorized(request)) {
    return json({ error: 'Password admin salah.' }, 401);
  }

  const slot = new URL(request.url).searchParams.get('slot') ?? '';
  if (!ALLOWED_SLOTS.has(slot)) {
    return json({ error: 'Slot foto tidak dikenal.' }, 400);
  }

  const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim();
  const extension = ALLOWED_TYPES[contentType];
  if (!extension) {
    return json({ error: 'Format tidak didukung. Gunakan JPG, PNG, WEBP, atau AVIF.' }, 415);
  }

  const declaredSize = Number(request.headers.get('content-length') ?? 0);
  if (declaredSize > MAX_BYTES) {
    return json({ error: 'Ukuran foto maksimal 4 MB.' }, 413);
  }

  try {
    const data = await request.arrayBuffer();
    if (data.byteLength === 0) return json({ error: 'File kosong.' }, 400);
    if (data.byteLength > MAX_BYTES) return json({ error: 'Ukuran foto maksimal 4 MB.' }, 413);

    const previous = await listSlot(slot);
    const blob = await put(`${PHOTOS_PREFIX}${slot}/photo.${extension}`, data, {
      access: 'public',
      contentType,
      addRandomSuffix: true,
    });

    if (previous.length > 0) {
      await del(previous.map((item) => item.url)).catch((error) => {
        console.error('Gagal menghapus foto lama:', error);
      });
    }

    return json({ url: blob.url }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Gagal mengunggah foto:', error);
    return json({ error: 'Gagal mengunggah foto.' }, 500);
  }
}
