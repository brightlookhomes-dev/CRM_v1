export async function onRequest({ request, env }) {
  if (!env.API_ORIGIN) return new Response('API_ORIGIN is not configured', { status: 503 });

  let apiOrigin;
  try {
    apiOrigin = new URL(env.API_ORIGIN);
  } catch {
    return new Response('API_ORIGIN is invalid', { status: 500 });
  }
  if (apiOrigin.protocol !== 'https:' && apiOrigin.hostname !== 'localhost') {
    return new Response('API_ORIGIN must use HTTPS', { status: 500 });
  }

  const incoming = new URL(request.url);
  const upstreamUrl = new URL(`${incoming.pathname}${incoming.search}`, apiOrigin.origin);
  return fetch(new Request(upstreamUrl, request));
}
