// Local test drive:  npm install  then  npm run dev  →  http://localhost:3000
// Uses an in-memory Postgres (PGlite), runs db/schema.sql, adds two demo test takers
// and opens the sample tests in tests/. Nothing here is used on Vercel.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { setQueryImpl } from '../lib/db.js';
import { normalizeTest } from '../lib/testdef.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8'));

let chain = Promise.resolve();
setQueryImpl((text, params) => {
  // PGlite runs one query at a time; queue them like a single connection.
  const run = chain.then(() => db.query(text, params).then((r) => r.rows));
  chain = run.catch(() => {});
  return run;
});

// Demo test takers (local only).
await db.exec(`
  insert into users (username, display_name, password_hash) values
    ('avery',  'Avery Jordan', crypt('avery123',  gen_salt('bf', 10))),
    ('sam',    'Sam Lee',      crypt('sam123',    gen_salt('bf', 10)))
  on conflict (username) do nothing;
`);

for (const file of fs.readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.json'))) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'tests', file), 'utf8'));
  const { def, errors } = normalizeTest(raw);
  if (errors.length) {
    console.warn(`tests/${file} has problems:\n  - ${errors.join('\n  - ')}`);
    continue;
  }
  await db.query(
    `insert into tests (id, title, definition, is_open) values ($1, $2, $3::jsonb, true)
     on conflict (id) do update set definition = excluded.definition, title = excluded.title`,
    [def.id, def.title, JSON.stringify(def)]
  );
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const apiCache = new Map();

async function handleApi(req, res, url) {
  const name = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  if (!/^[a-z]+$/.test(name) || !fs.existsSync(path.join(root, 'api', `${name}.js`))) {
    res.writeHead(404).end('Not found');
    return;
  }
  if (!apiCache.has(name)) apiCache.set(name, (await import(pathToFileURL(path.join(root, 'api', `${name}.js`)))).default);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const request = new Request(url, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = await apiCache.get(name).fetch(request);
  const out = {};
  response.headers.forEach((v, k) => {
    if (k !== 'set-cookie') out[k] = v;
  });
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
}

function handleStatic(req, res, url) {
  const pub = path.join(root, 'public');
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(pub, p);
  if (!file.startsWith(pub)) return res.writeHead(403).end();
  if (!fs.existsSync(file) && !path.extname(file) && fs.existsSync(`${file}.html`)) file = `${file}.html`;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else handleStatic(req, res, url);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Server error');
    }
  })
  .listen(PORT, () => {
    console.log(`\n  Mock Exam is running → http://localhost:${PORT}\n`);
    console.log('  Proctor:      proctor / Proctor-2026!');
    console.log('  Test takers:  avery / avery123    sam / sam123');
    console.log('  (in-memory database — everything resets when you stop this)\n');
  });
