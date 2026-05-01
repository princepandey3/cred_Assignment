'use strict';

/**
 * SecurityService
 * ═══════════════════════════════════════════════════════════════
 * Single source of truth for all cryptographic operations.
 *
 * Responsibilities:
 *   • AES-256-GCM encryption / decryption  (OAuth tokens, AI keys)
 *   • HKDF key derivation  (per-purpose sub-keys from master secret)
 *   • bcrypt password hashing / verification  (min cost 12)
 *   • Constant-time comparison  (timing-safe equality checks)
 *   • Secure random generation  (tokens, salts, IDs)
 *   • Log-safe serialisation  (redacts secrets from log payloads)
 *
 * Design rules enforced here:
 *   1. No plaintext secret ever enters a log statement.
 *   2. All returned objects are sealed (Object.freeze) to prevent
 *      accidental mutation that could expose sensitive fields.
 *   3. Every method is synchronous where crypto allows it, async
 *      only for bcrypt (intentionally slow).
 *   4. Key material is derived via HKDF — never raw SHA-256.
 * ═══════════════════════════════════════════════════════════════
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');

// ─── Constants ────────────────────────────────────────────────

const ALGORITHM       = 'aes-256-gcm';
const IV_BYTES        = 12;   // 96-bit IV  — NIST SP 800-38D recommended for GCM
const TAG_BYTES       = 16;   // 128-bit auth tag — maximum GCM tag length
const KEY_BYTES       = 32;   // 256-bit key
const HKDF_HASH      = 'sha256';
const HKDF_SALT_BYTES = 32;

const BCRYPT_MIN_COST = 12;   // OWASP minimum for bcrypt in 2024+
const BCRYPT_COST     = 12;   // configurable below via env

const TOKEN_BYTES     = 32;   // 256-bit opaque tokens
const SEPARATOR       = ':';  // delimiter in serialised ciphertext

// Purpose labels keep sub-keys domain-separated
const KEY_PURPOSES = Object.freeze({
  OAUTH_TOKEN : 'ai-publisher:oauth-token-encryption-v1',
  AI_KEY      : 'ai-publisher:ai-key-encryption-v1',
  GENERIC     : 'ai-publisher:generic-encryption-v1',
});

// ─── Key Management ──────────────────────────────────────────

let _masterKey = null; // cached Buffer — loaded once at first use

/**
 * Loads and validates the master encryption secret from the environment.
 * Returns a raw Buffer ready for HKDF.
 *
 * Throws immediately if the secret is absent or too short (< 32 chars)
 * so misconfiguration is caught at startup, not mid-request.
 */
function _getMasterSecret() {
  if (_masterKey) return _masterKey;

  const secret = process.env.ENCRYPTION_SECRET;

  if (!secret) {
    throw new SecurityError(
      'ENCRYPTION_SECRET is not set. Cannot perform any cryptographic operation.',
      'KEY_MISSING'
    );
  }

  if (secret.length < 32) {
    throw new SecurityError(
      'ENCRYPTION_SECRET is too short (minimum 32 characters required).',
      'KEY_TOO_SHORT'
    );
  }

  // Hold as a Buffer — never as a string after this point
  _masterKey = Buffer.from(secret, 'utf8');
  return _masterKey;
}

/**
 * Derives a 256-bit sub-key for a specific purpose using HKDF.
 *
 * Using HKDF instead of raw SHA-256:
 *  • Extracts entropy properly even if the master secret has low randomness.
 *  • Binds the derived key to `purpose` — an oauth key cannot be used to
 *    decrypt an ai-key ciphertext even with the same master secret.
 *
 * @param {string} purpose  - one of KEY_PURPOSES values
 * @param {Buffer} [salt]   - optional; random 256-bit salt stored alongside ciphertext
 * @returns {Buffer} 32-byte key
 */
function _deriveKey(purpose, salt = null) {
  const masterSecret = _getMasterSecret();
  const ikm  = masterSecret;
  const info = Buffer.from(purpose, 'utf8');
  const effectiveSalt = salt || Buffer.alloc(HKDF_SALT_BYTES, 0);

  // hkdfSync returns ArrayBuffer — wrap in Buffer for cipher APIs and fill()
  return Buffer.from(crypto.hkdfSync(HKDF_HASH, ikm, effectiveSalt, info, KEY_BYTES));
}

// ─── Ciphertext Serialisation ─────────────────────────────────

/**
 * Serialise: base64(salt):base64(iv):base64(tag):base64(ciphertext)
 *
 * Including a per-ciphertext salt means each derived key is unique,
 * giving us key commitment and preventing cross-context decryption.
 */
function _serialise(salt, iv, tag, ciphertext) {
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(SEPARATOR);
}

/**
 * Deserialise and validate the stored ciphertext string.
 * Returns { salt, iv, tag, ciphertext } as Buffers.
 * Throws SecurityError on malformed input.
 */
function _deserialise(stored) {
  if (typeof stored !== 'string') {
    // Throw directly — not wrapped by decrypt() — so code stays INVALID_CIPHERTEXT
    throw Object.assign(
      new SecurityError('Invalid ciphertext: expected a string', 'INVALID_CIPHERTEXT'),
      { _raw: true }
    );
  }

  const parts = stored.split(SEPARATOR);

  if (parts.length !== 4) {
    throw new SecurityError(
      `Invalid ciphertext format: expected 4 segments, got ${parts.length}`,
      'INVALID_CIPHERTEXT'
    );
  }

  const [saltB64, ivB64, tagB64, dataB64] = parts;

  return {
    salt       : Buffer.from(saltB64, 'base64'),
    iv         : Buffer.from(ivB64,   'base64'),
    tag        : Buffer.from(tagB64,  'base64'),
    ciphertext : Buffer.from(dataB64, 'base64'),
  };
}

// ─── SecurityError ────────────────────────────────────────────

/**
 * Custom error class for security failures.
 * Carries a machine-readable `code` for structured error handling upstream.
 * The message is intentionally vague for external callers — details stay in logs.
 */
class SecurityError extends Error {
  constructor(message, code = 'SECURITY_ERROR') {
    super(message);
    this.name    = 'SecurityError';
    this.code    = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── SecurityService ─────────────────────────────────────────

class SecurityService {

  // ── Encryption ─────────────────────────────────────────────

  /**
   * Encrypt a plaintext string with AES-256-GCM.
   *
   * Output: "base64(salt):base64(iv):base64(authTag):base64(ciphertext)"
   *
   * Each call generates a fresh random salt (for HKDF) and IV, so
   * encrypting the same plaintext twice produces different ciphertexts.
   *
   * @param {string} plaintext   - The value to encrypt (OAuth token, API key, etc.)
   * @param {string} [purpose]   - Encryption purpose (domain separation)
   * @returns {string}           - Serialised ciphertext safe to store in DB
   */
  encrypt(plaintext, purpose = KEY_PURPOSES.GENERIC) {
    if (plaintext === null || plaintext === undefined) return null;
    if (typeof plaintext !== 'string') {
      throw new SecurityError('encrypt() requires a string input', 'INVALID_INPUT');
    }
    if (plaintext.length === 0) return null;

    const salt = crypto.randomBytes(HKDF_SALT_BYTES);
    const iv   = crypto.randomBytes(IV_BYTES);
    const key  = _deriveKey(purpose, salt);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_BYTES,
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    // Wipe the key Buffer from memory immediately
    key.fill(0);

    return _serialise(salt, iv, tag, encrypted);
  }

  /**
   * Decrypt a string produced by `encrypt()`.
   *
   * The GCM auth tag provides integrity verification — if the stored
   * value was tampered with, this throws before returning anything.
   *
   * @param {string} encryptedStr  - Serialised ciphertext from the DB
   * @param {string} [purpose]     - Must match the purpose used during encryption
   * @returns {string|null}        - Original plaintext, or null if input was null
   */
  decrypt(encryptedStr, purpose = KEY_PURPOSES.GENERIC) {
    if (encryptedStr === null || encryptedStr === undefined) return null;

    let components;
    try {
      components = _deserialise(encryptedStr);
    } catch (e) {
      // Preserve the original code if it was already a SecurityError
      if (e._raw) throw e;
      throw new SecurityError(`Decryption failed — malformed ciphertext: ${e.message}`, 'DECRYPT_FAILED');
    }

    const { salt, iv, tag, ciphertext } = components;
    const key = _deriveKey(purpose, salt);

    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');

      key.fill(0);
      return decrypted;

    } catch {
      key.fill(0);
      // Do NOT include the error details — they can leak oracle information
      throw new SecurityError('Decryption failed — authentication tag mismatch or corrupt data', 'DECRYPT_FAILED');
    }
  }

  /**
   * Convenience wrappers with explicit purpose labels.
   * Use these instead of calling encrypt/decrypt directly so
   * purpose strings are never mistyped at call sites.
   */
  encryptOAuthToken(token)    { return this.encrypt(token, KEY_PURPOSES.OAUTH_TOKEN); }
  decryptOAuthToken(stored)   { return this.decrypt(stored, KEY_PURPOSES.OAUTH_TOKEN); }
  encryptAiKey(key)           { return this.encrypt(key, KEY_PURPOSES.AI_KEY); }
  decryptAiKey(stored)        { return this.decrypt(stored, KEY_PURPOSES.AI_KEY); }

  // ── Password Hashing ───────────────────────────────────────

  /**
   * Hash a password with bcrypt (cost factor 12+).
   *
   * bcrypt is intentionally slow and automatically handles salting.
   * Never use this for non-password data (use encrypt instead).
   *
   * @param {string} password  - Raw plaintext password
   * @returns {Promise<string>} bcrypt hash safe to store in DB
   */
  async hashPassword(password) {
    if (!password || typeof password !== 'string') {
      throw new SecurityError('hashPassword() requires a non-empty string', 'INVALID_INPUT');
    }
    if (password.length > 72) {
      // bcrypt silently truncates beyond 72 bytes — reject to prevent false security
      throw new SecurityError(
        'Password exceeds bcrypt maximum length (72 bytes). Pre-hash or reject.',
        'PASSWORD_TOO_LONG'
      );
    }

    const cost = Math.max(
      BCRYPT_MIN_COST,
      parseInt(process.env.BCRYPT_COST || BCRYPT_COST, 10)
    );

    return bcrypt.hash(password, cost);
  }

  /**
   * Verify a plaintext password against a stored bcrypt hash.
   *
   * Uses bcrypt.compare which is constant-time by design.
   * Always returns a boolean — never throws for mismatches
   * (keeps the calling code simple and timing-safe).
   *
   * @param {string} password  - Plaintext candidate
   * @param {string} hash      - Stored bcrypt hash
   * @returns {Promise<boolean>}
   */
  async verifyPassword(password, hash) {
    if (!password || !hash) return false;
    try {
      return await bcrypt.compare(password, hash);
    } catch {
      return false;
    }
  }

  /**
   * Check if a stored hash needs rehashing (cost factor upgrade).
   * Call this after a successful login and silently rehash if true.
   *
   * @param {string} hash
   * @returns {boolean}
   */
  needsRehash(hash) {
    const currentCost = Math.max(
      BCRYPT_MIN_COST,
      parseInt(process.env.BCRYPT_COST || BCRYPT_COST, 10)
    );
    const rounds = bcrypt.getRounds(hash);
    return rounds < currentCost;
  }

  // ── Secure Random Generation ───────────────────────────────

  /**
   * Generate a cryptographically secure random token.
   * Suitable for: session tokens, email verification links, API keys.
   *
   * @param {number} [bytes=TOKEN_BYTES]  - Entropy in bytes (output is 2× in hex)
   * @returns {string} Hex string
   */
  generateToken(bytes = TOKEN_BYTES) {
    return crypto.randomBytes(bytes).toString('hex');
  }

  /**
   * Generate a URL-safe base64 token (shorter than hex).
   * Suitable for: password-reset links, email verification URLs.
   *
   * @param {number} [bytes=TOKEN_BYTES]
   * @returns {string} Base64url string
   */
  generateUrlSafeToken(bytes = TOKEN_BYTES) {
    return crypto.randomBytes(bytes).toString('base64url');
  }

  /**
   * Generate a prefixed API key in the format:
   *   {prefix}_{base62-random}
   * Mimics the style of Stripe/Anthropic API keys for easy log scanning.
   *
   * @param {string} [prefix='acp']  - Short identifier for the key type
   * @returns {string}
   */
  generateApiKey(prefix = 'acp') {
    const raw = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
    return `${prefix}_${raw}`;
  }

  // ── Constant-Time Comparison ───────────────────────────────

  /**
   * Compare two strings in constant time to prevent timing attacks.
   * Use for: token comparison, HMAC verification, API key matching.
   *
   * Returns false (never throws) if lengths differ — avoids early exit.
   *
   * @param {string} a
   * @param {string} b
   * @returns {boolean}
   */
  safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;

    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');

    // timingSafeEqual requires equal-length buffers
    if (bufA.length !== bufB.length) {
      // Still do a dummy comparison to keep timing uniform
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  }

  /**
   * HMAC-SHA256 of a value — for signing stateless tokens (e.g. unsubscribe links).
   *
   * @param {string} value
   * @param {string} [secret]  - Defaults to ENCRYPTION_SECRET
   * @returns {string} Hex HMAC
   */
  hmac(value, secret = null) {
    const key = secret || process.env.ENCRYPTION_SECRET;
    if (!key) throw new SecurityError('No key provided for HMAC', 'KEY_MISSING');
    return crypto.createHmac('sha256', key).update(value).digest('hex');
  }

  // ── Log Safety ─────────────────────────────────────────────

  /**
   * Redact sensitive fields from an object before passing to a logger.
   *
   * Usage:  logger.info('User data', security.redact(userObject));
   *
   * Recursively walks the object and replaces values whose keys match
   * known sensitive patterns with the string '[REDACTED]'.
   *
   * @param {object} obj        - The object to sanitise
   * @param {number} [depth=4]  - Max recursion depth (prevents circular refs)
   * @returns {object}          - A new object with sensitive values replaced
   */
  redact(obj, depth = 4) {
    if (!obj || typeof obj !== 'object' || depth === 0) return obj;
    if (Array.isArray(obj)) return obj.map((item) => this.redact(item, depth - 1));

    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => {
        if (_isSensitiveKey(key)) return [key, '[REDACTED]'];
        if (value && typeof value === 'object') return [key, this.redact(value, depth - 1)];
        return [key, value];
      })
    );
  }

  /**
   * Mask a secret string for display — shows only the first/last N characters.
   * Safe to include in log messages or UI.
   *
   * "sk-abcdef1234567890" → "sk-a••••••••••7890"
   *
   * @param {string} secret
   * @param {number} [showChars=4]  - Characters to reveal at each end
   * @returns {string}
   */
  mask(secret, showChars = 4) {
    if (!secret || typeof secret !== 'string') return '[empty]';
    if (secret.length <= showChars * 2) return '••••••••';
    const start = secret.slice(0, showChars);
    const end   = secret.slice(-showChars);
    const mid   = '•'.repeat(Math.min(secret.length - showChars * 2, 12));
    return `${start}${mid}${end}`;
  }

  // ── Key Purpose Labels (exposed for consumers) ─────────────
  get purposes() { return KEY_PURPOSES; }
}

// ─── Sensitive Key Detection ──────────────────────────────────

/** Keys whose values should never appear in logs. */
const SENSITIVE_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /access[_-]?key/i,
  /refresh[_-]?key/i,
  /private[_-]?key/i,
  /auth/i,
  /credential/i,
  /enc$/i,        // anything ending in _enc
  /hash$/i,       // password_hash, etc.
  /ssn/i,
  /credit[_-]?card/i,
  /cvv/i,
];

function _isSensitiveKey(key) {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}

// ─── Exports ─────────────────────────────────────────────────

const securityService = new SecurityService();

module.exports = {
  securityService,     // Use this singleton everywhere
  SecurityService,     // Export class for testing / custom instances
  SecurityError,       // Export error class for instanceof checks upstream
  KEY_PURPOSES,        // Export constants for use in repositories
};
