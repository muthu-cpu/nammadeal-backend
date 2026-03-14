/**
 * ONDC Crypto Utilities
 * - Creates the Authorization header (Beckn v1.2 spec)
 * - Signs requests with Ed25519
 */

const nacl = require('tweetnacl');
const { decodeBase64, encodeBase64, decodeUTF8 } = require('tweetnacl-util');
const crypto = require('crypto');

/**
 * Build the ONDC Authorization header string.
 * Format: Signature keyId="{subscriberId}|{uniqueKeyId}|ed25519",
 *         algorithm="ed25519", created="{ts}", expires="{ts+1h}",
 *         headers="(created) (expires) digest",signature="{base64sig}"
 */
function createAuthHeader(body) {
  const privateKeyB64 = process.env.ONDC_SIGNING_PRIVATE_KEY;
  const subscriberId  = process.env.ONDC_SUBSCRIBER_ID  || 'nammadeal.app';
  const uniqueKeyId   = process.env.ONDC_UNIQUE_KEY_ID  || 'nammadeal-key-1';

  if (!privateKeyB64) throw new Error('ONDC_SIGNING_PRIVATE_KEY not set in .env');

  const privateKey = decodeBase64(privateKeyB64);

  const created = Math.floor(Date.now() / 1000);
  const expires  = created + 3600; // 1 hour

  // Blake2b or SHA-256 digest of body (ONDC uses SHA-256)
  const bodyHash   = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
  const digest     = `SHA-256=${bodyHash}`;

  // Signing string
  const signingString = `(created): ${created}\n(expires): ${expires}\ndigest: ${digest}`;
  const messageBytes  = decodeUTF8(signingString);
  const signatureBytes = nacl.sign.detached(messageBytes, privateKey);
  const signature      = encodeBase64(signatureBytes);

  return (
    `Signature keyId="${subscriberId}|${uniqueKeyId}|ed25519",` +
    `algorithm="ed25519",created="${created}",expires="${expires}",` +
    `headers="(created) (expires) digest",signature="${signature}"`
  );
}

/**
 * Verify an inbound ONDC Authorization header.
 * Returns true if valid.
 */
function verifyAuthHeader(authHeader, body) {
  try {
    const publicKeyB64 = process.env.ONDC_SIGNING_PUBLIC_KEY;
    if (!publicKeyB64) return false;
    const publicKey = decodeBase64(publicKeyB64);

    // Extract signature
    const sigMatch = authHeader.match(/signature="([^"]+)"/);
    const creMatch  = authHeader.match(/created="([^"]+)"/);
    const expMatch  = authHeader.match(/expires="([^"]+)"/);
    if (!sigMatch || !creMatch || !expMatch) return false;

    const created = creMatch[1];
    const expires  = expMatch[1];

    // Rebuild digest
    const bodyHash   = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
    const digest     = `SHA-256=${bodyHash}`;

    const signingString  = `(created): ${created}\n(expires): ${expires}\ndigest: ${digest}`;
    const messageBytes   = decodeUTF8(signingString);
    const signatureBytes = decodeBase64(sigMatch[1]);

    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
  } catch {
    return false;
  }
}

module.exports = { createAuthHeader, verifyAuthHeader };
