// Helpers for Vercel's Web-standard function handlers (Request in, Response out).

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  return new Response(JSON.stringify(data), { status, headers });
}

/** Wrap a handler so thrown errors become JSON responses. */
export function handler(fn) {
  return {
    async fetch(request) {
      try {
        return await fn(request);
      } catch (e) {
        if (e && e.expose) return json({ error: e.message }, e.status || 500);
        console.error(e);
        return json({ error: 'Something went wrong on the server.' }, 500);
      }
    },
  };
}

export async function readBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return {};
  const text = await request.text();
  if (text.length > 2_000_000) throw new HttpError(413, 'That upload is too large.');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'The request body was not valid JSON.');
  }
}

export function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function isHttps(request) {
  const proto = request.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  return new URL(request.url).protocol === 'https:';
}

export function setCookie(request, name, value, maxAgeSeconds) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isHttps(request)) parts.push('Secure');
  return parts.join('; ');
}

export function queryParams(request) {
  return new URL(request.url).searchParams;
}
