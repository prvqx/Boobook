// Image library stored in the database, so tests can use pictures without touching GitHub.
// The table is created automatically the first time it's needed.
import { q, one } from './db.js';

let ready = null;

export function ensureImages() {
  if (!ready) {
    ready = q(
      `create table if not exists images (
         name        text primary key,
         mime        text not null,
         data        bytea not null,
         size        integer not null,
         width       integer,
         height      integer,
         created_at  timestamptz not null default now()
       )`
    ).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);
export const validImageName = (n) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(String(n || ''));

export async function getImage(name) {
  await ensureImages();
  return one('select mime, data from images where name = $1', [name]);
}

export async function listImages() {
  await ensureImages();
  return q('select name, mime, size, width, height, created_at from images order by created_at desc');
}

export async function imageExists(name) {
  await ensureImages();
  return !!(await one('select 1 as x from images where name = $1', [name]));
}

export async function putImage(name, mime, buf, width, height) {
  await ensureImages();
  await q(
    `insert into images (name, mime, data, size, width, height) values ($1, $2, $3, $4, $5, $6)
     on conflict (name) do update set mime = excluded.mime, data = excluded.data, size = excluded.size,
       width = excluded.width, height = excluded.height, created_at = now()`,
    [name, mime, buf, buf.length, width || null, height || null]
  );
}

export async function deleteImage(name) {
  await ensureImages();
  const rows = await q('delete from images where name = $1 returning name', [name]);
  return rows.length > 0;
}

/** Which of these names are NOT uploaded yet. */
export async function missingImages(names) {
  if (!names.length) return [];
  await ensureImages();
  const rows = await q('select name from images where name = any($1::text[])', [names]);
  const have = new Set(rows.map((r) => r.name));
  return names.filter((n) => !have.has(n));
}
