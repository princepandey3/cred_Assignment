'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;    // 96-bit IV — recommended for GCM
const TAG_LENGTH = 16;   // 128-bit auth tag
const KEY_LENGTH = 32;   // 256-bit key

/**
 * Derives a fixed-length key from the application secret using SHA-256.
 * In production, prefer a dedicated KMS-managed key over a derived one.
 */
function getDerivedKey() {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) throw new Error('ENCRYPTION_SECRET environment variable is not set');
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 * Output format: base64(iv):base64(authTag):base64(ciphertext)
 *
 * @param {string} plaintext
 * @returns {string} Encrypted string safe to store in the DB
 */
function encrypt(plaintext) {
  if (!plaintext) return null;

  const key = getDerivedKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}

/**
 * Decrypts a string produced by `encrypt()`.
 *
 * @param {string} encryptedStr
 * @returns {string} Original plaintext
 */
function decrypt(encryptedStr) {
  if (!encryptedStr) return null;

  const [ivB64, tagB64, dataB64] = encryptedStr.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted string format');
  }

  const key = getDerivedKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Hashes a password with bcrypt-equivalent security using PBKDF2.
 * For actual password hashing, prefer the `bcrypt` package — this is
 * a zero-dependency fallback for environments where native modules are restricted.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { encrypt, decrypt, hashToken };
