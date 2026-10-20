const crypto = require('crypto');

// Minimal HS256 JWT verification (no extra dependency). Returns the claims
// or null. Expiry (`exp`, seconds) is enforced when present.
function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (header.alg !== 'HS256') return null;

    const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
    const actual = Buffer.from(parts[2], 'base64url');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (claims.exp && Date.now() / 1000 > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}

function signToken(claims, secret) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(claims);
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

module.exports = { verifyToken, signToken };
