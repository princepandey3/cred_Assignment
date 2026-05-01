'use strict';

/**
 * AuthService Tests
 * ═══════════════════════════════════════════════════════════════
 * Tests register, login, refresh, logout, and verifyAccessToken.
 * Uses lightweight stubs — no live DB or Redis required.
 *
 * Run: node src/tests/auth.service.test.js
 * ═══════════════════════════════════════════════════════════════
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_at_least_32_chars_long_abc123';
process.env.ENCRYPTION_SECRET = 'test_encryption_secret_that_is_at_least_32_chars_long_abc';

// ─── Mock prisma config before any require that loads it ─────
const Module = require('module');
const _originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '../config/prisma' || request.endsWith('config/prisma')) {
    return { prisma: {} }; // unused; repository is fully stubbed below
  }
  return _originalLoad.apply(this, arguments);
};

// ─── Minimal stubs ──────────────────────────────────────────────

const userStore = {};

// Stub user.repository
const userRepository = require('../repositories/user.repository');
userRepository.emailExists = async (email) => !!Object.values(userStore).find(u => u.email === email);
userRepository.create = async (data) => {
  const id = `user_${Date.now()}`;
  const user = { id, ...data, isActive: true, createdAt: new Date(), updatedAt: new Date() };
  delete user.passwordHash; // safeSelect strips it
  userStore[id] = { ...user, passwordHash: data.passwordHash };
  return user;
};
userRepository.findByEmail = async (email) => Object.values(userStore).find(u => u.email === email) || null;
userRepository.findById = async (id) => {
  const u = userStore[id];
  if (!u) return null;
  const { passwordHash: _ph, ...safe } = u;
  return safe;
};

// Stub Redis
const redisStore = {};
const fakeRedis = {
  set: async (key, val) => { redisStore[key] = val; },
  get: async (key) => redisStore[key] || null,
  del: async (key) => { delete redisStore[key]; },
};
const redisConfig = require('../config/redis');
redisConfig.getRedisClient = async () => fakeRedis;

// ─── Load service AFTER stubs are in place ────────────────────
const authService = require('../services/auth.service');

// ─── Test runner ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected "${expected}" but got "${actual}"`);
  }
}

// ─── Tests ────────────────────────────────────────────────────

async function main() {
console.log('\n──────────────────────────────────────');
console.log('  AuthService Tests');
console.log('──────────────────────────────────────\n');

// Register
console.log('📋 Registration');

await test('registers a new user and returns tokens', async () => {
  const result = await authService.register({
    email: 'alice@example.com',
    password: 'Password1!',
    name: 'Alice',
  });

  assert(result.user, 'user missing');
  assert(result.accessToken, 'accessToken missing');
  assert(result.refreshToken, 'refreshToken missing');
  assertEqual(result.user.email, 'alice@example.com');
  assertEqual(result.user.name, 'Alice');
  assert(!result.user.passwordHash, 'passwordHash must not be returned');
});

await test('normalizes email to lowercase on register', async () => {
  const result = await authService.register({
    email: 'BOB@Example.COM',
    password: 'Password1!',
    name: 'Bob',
  });
  assertEqual(result.user.email, 'bob@example.com');
});

await test('throws CONFLICT when email already registered', async () => {
  try {
    await authService.register({
      email: 'alice@example.com',
      password: 'Password1!',
      name: 'Alice 2',
    });
    throw new Error('Should have thrown');
  } catch (err) {
    assertEqual(err.statusCode, 409, `Expected 409, got ${err.statusCode}`);
  }
});

// Login
console.log('\n🔑 Login');

await test('returns tokens on valid credentials', async () => {
  const result = await authService.login({
    email: 'alice@example.com',
    password: 'Password1!',
  });
  assert(result.accessToken, 'accessToken missing');
  assert(result.refreshToken, 'refreshToken missing');
  assert(!result.user.passwordHash, 'passwordHash must not be returned');
});

await test('normalizes email on login', async () => {
  const result = await authService.login({
    email: '  ALICE@EXAMPLE.COM  ',
    password: 'Password1!',
  });
  assert(result.accessToken);
});

await test('throws 401 on wrong password', async () => {
  try {
    await authService.login({ email: 'alice@example.com', password: 'WrongPass1!' });
    throw new Error('Should have thrown');
  } catch (err) {
    assertEqual(err.statusCode, 401, `Expected 401, got ${err.statusCode}`);
  }
});

await test('throws 401 on unknown email', async () => {
  try {
    await authService.login({ email: 'nobody@example.com', password: 'Password1!' });
    throw new Error('Should have thrown');
  } catch (err) {
    assertEqual(err.statusCode, 401, `Expected 401, got ${err.statusCode}`);
  }
});

// Token refresh
console.log('\n🔄 Token Refresh');

let savedRefreshToken;

await test('refresh returns new token pair', async () => {
  const login = await authService.login({ email: 'alice@example.com', password: 'Password1!' });
  savedRefreshToken = login.refreshToken;

  const result = await authService.refresh(login.refreshToken);
  assert(result.accessToken, 'new accessToken missing');
  assert(result.refreshToken, 'new refreshToken missing');
  assert(result.refreshToken !== login.refreshToken, 'refresh token must rotate');
});

await test('old refresh token is rejected after rotation', async () => {
  // savedRefreshToken was used once already in the previous test
  try {
    await authService.refresh(savedRefreshToken);
    throw new Error('Should have thrown');
  } catch (err) {
    assertEqual(err.statusCode, 401);
  }
});

await test('throws 401 on invalid refresh token string', async () => {
  try {
    await authService.refresh('not.a.valid.jwt');
    throw new Error('Should have thrown');
  } catch (err) {
    assertEqual(err.statusCode, 401);
  }
});

// Logout
console.log('\n🚪 Logout');

await test('logout revokes the refresh token', async () => {
  const login = await authService.login({ email: 'alice@example.com', password: 'Password1!' });
  await authService.logout(login.refreshToken);

  try {
    await authService.refresh(login.refreshToken);
    throw new Error('Should have thrown after logout');
  } catch (err) {
    assertEqual(err.statusCode, 401);
  }
});

await test('logout is idempotent with invalid token', async () => {
  // Should not throw
  await authService.logout('garbage_token');
});

// Access token verification
console.log('\n🛡️  Access Token Verification');

await test('verifyAccessToken returns correct payload', async () => {
  const login = await authService.login({ email: 'alice@example.com', password: 'Password1!' });
  const payload = authService.verifyAccessToken(login.accessToken);

  assert(payload.sub, 'sub missing');
  assertEqual(payload.email, 'alice@example.com');
  assertEqual(payload.type, 'access');
});

await test('verifyAccessToken throws on refresh token used as access token', async () => {
  const login = await authService.login({ email: 'alice@example.com', password: 'Password1!' });
  try {
    authService.verifyAccessToken(login.refreshToken);
    throw new Error('Should have thrown');
  } catch (err) {
    assertEqual(err.statusCode, 401);
  }
});

await test('verifyAccessToken throws on tampered token', async () => {
  const login = await authService.login({ email: 'alice@example.com', password: 'Password1!' });
  const tampered = login.accessToken.slice(0, -5) + 'XXXXX';
  try {
    authService.verifyAccessToken(tampered);
    throw new Error('Should have thrown');
  } catch (err) {
    assertEqual(err.statusCode, 401);
  }
});

// Summary
console.log('\n──────────────────────────────────────');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('──────────────────────────────────────\n');

if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
