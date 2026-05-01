'use strict';

/**
 * Auth Step 5 Tests
 * ─────────────────────────────────────────────────────────────
 * Covers:
 *   • authenticate middleware (valid, expired, missing, blocklisted)
 *   • Refresh token rotation
 *   • Theft detection (replay of an already-rotated token)
 *   • Logout with access token blocklisting
 *   • GET /me  (via authService.getMe)
 *
 * Run: node src/tests/auth.step5.test.js
 * ─────────────────────────────────────────────────────────────
 */

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test_jwt_secret_at_least_32_chars_long_abc123';
process.env.ENCRYPTION_SECRET = 'test_encryption_secret_that_is_at_least_32_chars_long_abc';

// ── Mock prisma ──────────────────────────────────────────────
const Module = require('module');
const _orig  = Module._load;
Module._load  = function (request, parent, isMain) {
  if (request === '../config/prisma' || request.endsWith('config/prisma')) {
    return { prisma: {} };
  }
  return _orig.apply(this, arguments);
};

// ── In-memory stores ──────────────────────────────────────────
const userStore  = {};
const redisStore = {};

const fakeRedis = {
  set: async (key, val, opts) => { redisStore[key] = val; },
  get: async (key) => redisStore[key] ?? null,
  del: async (key) => { delete redisStore[key]; },
};

// ── Stub repositories & redis ─────────────────────────────────
const userRepo = require('../repositories/user.repository');
userRepo.emailExists = async (e) => !!Object.values(userStore).find(u => u.email === e);
userRepo.create      = async (d)  => {
  const id   = `u_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const user = { id, email: d.email, name: d.name, isActive: true,
                 createdAt: new Date(), updatedAt: new Date() };
  userStore[id] = { ...user, passwordHash: d.passwordHash };
  return user;
};
userRepo.findByEmail = async (e) =>
  Object.values(userStore).find(u => u.email === e) || null;
userRepo.findById    = async (id) => {
  const u = userStore[id];
  if (!u) return null;
  const { passwordHash: _, ...safe } = u;
  return safe;
};

const redisCfg = require('../config/redis');
redisCfg.getRedisClient = async () => fakeRedis;

// ── Load service + middleware AFTER stubs ──────────────────────
const authService  = require('../services/auth.service');
const authenticate = require('../middlewares/authenticate');

// ── Test runner ───────────────────────────────────────────────
let passed = 0, failed = 0;

async function test(name, fn) {
  try   { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

function assert(cond, msg)   { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, m) { if (a !== b) throw new Error(m || `Expected "${b}" got "${a}"`); }

// Minimal mock req/res/next for middleware tests
function mockReq(authHeader) {
  return { headers: { authorization: authHeader } };
}
function mockNext() {
  const fn = (err) => { fn.called = true; fn.err = err || null; };
  fn.called = false; fn.err = null;
  return fn;
}

// ─── Seed a user once ─────────────────────────────────────────
let alice;
{
  const id = 'u_alice';
  userStore[id] = {
    id, email: 'alice@example.com', name: 'Alice',
    passwordHash: '$2b$12$KIXGXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXe',
    isActive: true, createdAt: new Date(), updatedAt: new Date(),
  };
  alice = { id, email: 'alice@example.com', name: 'Alice', isActive: true };
}

// ─── Tests ────────────────────────────────────────────────────
async function main() {

// ── 1. authenticate middleware ────────────────────────────────
console.log('\n──────────────────────────────────────');
console.log('  Auth Step 5 Tests');
console.log('──────────────────────────────────────\n');

console.log('🛡️  authenticate middleware');

await test('passes with a valid access token', async () => {
  const reg = await authService.register({
    email: 'bob@example.com', password: 'Password1!', name: 'Bob',
  });
  const req  = mockReq(`Bearer ${reg.accessToken}`);
  const next = mockNext();
  await authenticate(req, {}, next);
  assert(!next.err, `Unexpected error: ${next.err?.message}`);
  assert(req.user?.id, 'req.user.id missing');
  assertEqual(req.user.email, 'bob@example.com');
});

await test('rejects request with no Authorization header', async () => {
  const req  = mockReq(undefined);
  const next = mockNext();
  await authenticate(req, {}, next);
  assert(next.err, 'Expected error');
  assertEqual(next.err.statusCode, 401);
});

await test('rejects malformed header (no Bearer prefix)', async () => {
  const req  = mockReq('Token abc123');
  const next = mockNext();
  await authenticate(req, {}, next);
  assert(next.err, 'Expected error');
  assertEqual(next.err.statusCode, 401);
});

await test('rejects a refresh token used as access token', async () => {
  const reg = await authService.register({
    email: 'carol@example.com', password: 'Password1!', name: 'Carol',
  });
  const req  = mockReq(`Bearer ${reg.refreshToken}`);
  const next = mockNext();
  await authenticate(req, {}, next);
  assert(next.err, 'Expected 401');
  assertEqual(next.err.statusCode, 401);
});

await test('rejects a tampered token', async () => {
  const reg     = await authService.register({
    email: 'dave@example.com', password: 'Password1!', name: 'Dave',
  });
  const tampered = reg.accessToken.slice(0, -5) + 'XXXXX';
  const req      = mockReq(`Bearer ${tampered}`);
  const next     = mockNext();
  await authenticate(req, {}, next);
  assert(next.err, 'Expected 401');
  assertEqual(next.err.statusCode, 401);
});

// ── 2. Refresh token rotation ─────────────────────────────────
console.log('\n🔄 Refresh token rotation');

await test('returns a new token pair on valid refresh', async () => {
  const reg     = await authService.register({
    email: 'eve@example.com', password: 'Password1!', name: 'Eve',
  });
  const result  = await authService.refresh(reg.refreshToken);
  assert(result.accessToken,  'new accessToken missing');
  assert(result.refreshToken, 'new refreshToken missing');
  assert(result.refreshToken !== reg.refreshToken, 'refresh token must rotate');
  assert(result.accessToken  !== reg.accessToken,  'access token must be new');
});

await test('old refresh token rejected after rotation (family revoked on replay)', async () => {
  const reg   = await authService.register({
    email: 'frank@example.com', password: 'Password1!', name: 'Frank',
  });
  const first = await authService.refresh(reg.refreshToken);
  assert(first.refreshToken, 'First rotation succeeded');

  // Replaying the original triggers theft detection → entire family revoked
  try {
    await authService.refresh(reg.refreshToken); // replay original
    throw new Error('Should have thrown');
  } catch (err) { assertEqual(err.statusCode, 401); }

  // The current (first-rotated) token is also dead because family was nuked
  try {
    await authService.refresh(first.refreshToken);
    throw new Error('Family should be revoked');
  } catch (err) { assertEqual(err.statusCode, 401, `Expected 401 got ${err.statusCode}`); }
});

await test('chained rotations all succeed', async () => {
  const reg = await authService.register({
    email: 'grace@example.com', password: 'Password1!', name: 'Grace',
  });
  let current = reg.refreshToken;
  for (let i = 0; i < 4; i++) {
    const r = await authService.refresh(current);
    current  = r.refreshToken;
  }
  assert(current, 'Final refresh token present after 4 rotations');
});

// ── 3. Theft detection ────────────────────────────────────────
console.log('\n🚨 Theft detection (refresh token reuse)');

await test('replaying a rotated token revokes the family', async () => {
  const reg    = await authService.register({
    email: 'heidi@example.com', password: 'Password1!', name: 'Heidi',
  });
  const stolen = reg.refreshToken;           // attacker captured this

  // Legitimate rotation happens
  const legitimate = await authService.refresh(stolen);

  // Attacker replays the old token — should revoke family + reject
  try {
    await authService.refresh(stolen);
    throw new Error('Should have thrown');
  } catch (err) { assertEqual(err.statusCode, 401); }

  // Even the legitimate (now-rotated-away) token should be dead
  try {
    await authService.refresh(legitimate.refreshToken);
    throw new Error('Family should have been nuked');
  } catch (err) { assertEqual(err.statusCode, 401); }
});

// ── 4. Logout & access token blocklist ───────────────────────
console.log('\n🚪 Logout & access token blocklist');

await test('logout revokes the refresh token', async () => {
  const reg = await authService.register({
    email: 'ivan@example.com', password: 'Password1!', name: 'Ivan',
  });
  await authService.logout({ refreshToken: reg.refreshToken });
  try {
    await authService.refresh(reg.refreshToken);
    throw new Error('Should have thrown');
  } catch (err) { assertEqual(err.statusCode, 401); }
});

await test('logout blocklists the access token', async () => {
  const reg = await authService.register({
    email: 'judy@example.com', password: 'Password1!', name: 'Judy',
  });

  // Token valid before logout
  const before = await authService.verifyAccessToken(reg.accessToken);
  assert(before.sub, 'Token should be valid before logout');

  await authService.logout({
    refreshToken: reg.refreshToken,
    accessToken:  reg.accessToken,
  });

  // Token rejected after logout
  try {
    await authService.verifyAccessToken(reg.accessToken);
    throw new Error('Should have been rejected');
  } catch (err) { assertEqual(err.statusCode, 401); }
});

await test('authenticate middleware rejects a blocklisted access token', async () => {
  const reg = await authService.register({
    email: 'kim@example.com', password: 'Password1!', name: 'Kim',
  });

  await authService.logout({
    refreshToken: reg.refreshToken,
    accessToken:  reg.accessToken,
  });

  const req  = mockReq(`Bearer ${reg.accessToken}`);
  const next = mockNext();
  await authenticate(req, {}, next);
  assert(next.err, 'Expected 401 for blocklisted token');
  assertEqual(next.err.statusCode, 401);
});

await test('logout is idempotent with invalid tokens', async () => {
  // Should never throw
  await authService.logout({ refreshToken: 'garbage', accessToken: 'junk' });
});

// ── 5. getMe ─────────────────────────────────────────────────
console.log('\n👤 getMe');

await test('getMe returns fresh user profile', async () => {
  const reg  = await authService.register({
    email: 'leo@example.com', password: 'Password1!', name: 'Leo',
  });
  const user = await authService.getMe(reg.user.id);
  assertEqual(user.email, 'leo@example.com');
  assertEqual(user.name,  'Leo');
  assert(!user.passwordHash, 'passwordHash must not be returned');
});

await test('getMe throws 404 for unknown userId', async () => {
  try {
    await authService.getMe('00000000-0000-0000-0000-000000000000');
    throw new Error('Should have thrown');
  } catch (err) { assertEqual(err.statusCode, 404); }
});

// ── Summary ───────────────────────────────────────────────────
console.log('\n──────────────────────────────────────');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('──────────────────────────────────────\n');

if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
