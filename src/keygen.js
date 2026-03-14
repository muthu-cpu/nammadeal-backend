/**
 * NammaDeal ONDC Key Generator
 * Run: node src/keygen.js
 *
 * Generates:
 *   - Ed25519 signing key pair  (for request signing)
 *   - X25519 encryption key pair (for key exchange)
 *
 * Paste the output into your .env file AND register the public keys on the ONDC portal.
 */

const nacl = require('tweetnacl');
const { encodeBase64 } = require('tweetnacl-util');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateKeys() {
  console.log('\n🔑  NammaDeal ONDC Key Generator\n' + '─'.repeat(50));

  // ── Ed25519 Signing Keys ────────────────────────────────
  const signingPair = nacl.sign.keyPair();
  const signingPrivateB64 = encodeBase64(signingPair.secretKey);
  const signingPublicB64  = encodeBase64(signingPair.publicKey);

  // ── X25519 Encryption Keys ─────────────────────────────
  const encryptionPair = nacl.box.keyPair();
  const encryptionPrivateB64 = encodeBase64(encryptionPair.secretKey);
  const encryptionPublicB64  = encodeBase64(encryptionPair.publicKey);

  const envContent = `# Generated on ${new Date().toISOString()}
ONDC_SUBSCRIBER_ID=nammadeal.app
ONDC_UNIQUE_KEY_ID=nammadeal-key-1
ONDC_SIGNING_PRIVATE_KEY=${signingPrivateB64}
ONDC_SIGNING_PUBLIC_KEY=${signingPublicB64}
ONDC_ENCRYPTION_PRIVATE_KEY=${encryptionPrivateB64}
ONDC_ENCRYPTION_PUBLIC_KEY=${encryptionPublicB64}

ONDC_GATEWAY_URL=https://staging.registry.ondc.org/ondc
FIREBASE_PROJECT_ID=nammadeal-870a6
PORT=3000
NODE_ENV=development
`;

  // Write .env
  const envPath = path.join(__dirname, '..', '.env');
  fs.writeFileSync(envPath, envContent);

  console.log('\n✅  Keys generated and saved to .env\n');
  console.log('📋  REGISTER THESE PUBLIC KEYS ON ONDC PORTAL:');
  console.log('─'.repeat(50));
  console.log('📝  Signing Public Key (Ed25519):');
  console.log('    ' + signingPublicB64);
  console.log('\n🔒  Encryption Public Key (X25519):');
  console.log('    ' + encryptionPublicB64);
  console.log('\n─'.repeat(50));
  console.log('ℹ️   Steps:');
  console.log('   1. Go to ONDC Portal → Your Profile → Continue Integration');
  console.log('   2. Paste the Signing Public Key above');
  console.log('   3. Paste the Encryption Public Key above');
  console.log('   4. Set Subscriber URL to your deployed backend URL');
  console.log('   5. Run: npm run dev  (to start the backend)');
  console.log('   6. Expose via ngrok for testing: npx ngrok http 3000\n');
}

generateKeys();
