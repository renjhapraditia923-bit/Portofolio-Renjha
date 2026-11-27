import { put, list, del } from '@vercel/blob';
import { timingSafeEqual } from 'node:crypto';

const COVER_PREFIX = 'cover/';
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

async function listCovers() {
  const { blobs } = await list({ prefix: COVER_PREFIX });
  return blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

function isAuthorized(request) {
  const expected = process.env.COVER_ADMIN_PASSWORD;
  if (!expected) return false;
  const given = request.headers.get('x-admin-password') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET() {
  try {
    const [latest] = await listCovers();
    return json(
      { url: latest ? latest.url : null },
      200,
      { 'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=300' },
    );
  } catch (error) {
    console.error('Gagal membaca foto cover:', error);
    return json({ url: null }, 200, { 'Cache-Control': 'no-store' });
  }
}

export async function POST(request) {
  if (!process.env.COVER_ADMIN_PASSWORD) {
    return json({ error: 'COVER_ADMIN_PASSWORD belum diatur di server.' }, 500);
  }
  if (!isAuthorized(request)) {
    return json({ error: 'Password admin salah.' }, 401);
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
    if (data.byteLength === 0) {
      return json({ error: 'File kosong.' }, 400);
    }
    if (data.byteLength > MAX_BYTES) {
      return json({ error: 'Ukuran foto maksimal 4 MB.' }, 413);
    }

    const previous = await listCovers();
    const blob = await put(`${COVER_PREFIX}cover.${extension}`, data, {
      access: 'public',
      contentType,
      addRandomSuffix: true,
    });

    if (previous.length > 0) {
      await del(previous.map((item) => item.url)).catch((error) => {
        console.error('Gagal menghapus cover lama:', error);
      });
    }

    return json({ url: blob.url }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Gagal mengunggah foto cover:', error);
    return json({ error: 'Gagal mengunggah foto cover.' }, 500);
  }
}
