// Same-origin token broker for the support dashboard. Runs server-side only:
// as a Vercel serverless function in production and as Vite dev middleware
// locally (see vite.config.js). It holds ADMIN_DASHBOARD_KEY, asks the chat
// server for a short-lived dashboard token, and hands that token to the page.
// The key never reaches the browser bundle.
//
// SECURITY: this endpoint is the gate to the dashboard. Whoever can reach it can
// open the dashboard, so the dashboard deployment itself must be access-
// protected (Vercel Deployment Protection) - see README.

export async function brokerAdminToken(req, env) {
  if (req.method !== 'GET') return { status: 405, body: { code: 'method', error: 'GET only.' } };

  // Reject cross-site browser requests (another website calling this endpoint).
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    return { status: 403, body: { code: 'forbidden', error: 'Cross-site request refused.' } };
  }

  const key = env.ADMIN_DASHBOARD_KEY;
  const base = String(env.ADMIN_API_URL || env.VITE_SERVER_URL || '').replace(/\/+$/, '');
  if (!key) {
    return { status: 500, body: { code: 'config', error: 'ADMIN_DASHBOARD_KEY is not set on the dashboard deployment.' } };
  }
  if (!base) {
    return { status: 500, body: { code: 'config', error: 'VITE_SERVER_URL (or ADMIN_API_URL) is not set on the dashboard deployment.' } };
  }

  let upstream;
  try {
    upstream = await fetch(`${base}/api/admin/session`, {
      method: 'POST',
      headers: { 'x-admin-key': key },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { status: 502, body: { code: 'unreachable', error: `Chat server at ${base} is unreachable.` } };
  }

  const data = await upstream.json().catch(() => ({}));
  if (upstream.ok && data.token) return { status: 200, body: { token: data.token, expiresIn: data.expiresIn } };

  if (upstream.status === 401) {
    return { status: 502, body: { code: 'bad_key', error: 'The chat server rejected ADMIN_DASHBOARD_KEY (keys differ between Vercel and the chat server).' } };
  }
  return { status: 502, body: { code: data.code || 'upstream', error: data.error || `Chat server returned ${upstream.status}.` } };
}

// Vercel serverless entry point.
export default async function handler(req, res) {
  const { status, body } = await brokerAdminToken(req, process.env);
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}
