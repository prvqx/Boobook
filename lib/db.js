// Tiny database helper. In production it talks to Postgres (Neon / Supabase / any)
// through node-postgres using the DATABASE_URL environment variable that Vercel adds
// when you connect a database. The local dev server swaps in an in-memory Postgres.
import pg from 'pg';

let override = null;
let pool = null;

/** Used by dev/server.mjs to run everything against an in-memory database. */
export function setQueryImpl(fn) {
  override = fn;
}

function getPool() {
  if (pool) return pool;
  const connectionString =
    process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    const err = new Error(
      'No database is connected. In Vercel, open your project → Storage → connect a Postgres database, then redeploy.'
    );
    err.expose = true;
    throw err;
  }
  pool = new pg.Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', () => {
    /* idle client errors are recovered on the next query */
  });
  return pool;
}

/** Run a query and return all rows. */
export async function q(text, params = []) {
  try {
    if (override) return await override(text, params);
    const res = await getPool().query(text, params);
    return res.rows;
  } catch (e) {
    if (e && e.code === '42P01') {
      const err = new Error(
        'The database tables are missing. Run db/schema.sql in your database SQL editor (see README, step 4).'
      );
      err.expose = true;
      throw err;
    }
    throw e;
  }
}

/** Run a query and return the first row (or null). */
export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] || null;
}

export const iso = (d) => (d == null ? null : new Date(d).toISOString());
export const ms = (d) => (d == null ? null : new Date(d).getTime());
