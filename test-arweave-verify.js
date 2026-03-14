const Arweave = require('arweave');
const crypto = require('crypto');

const arweave = Arweave.init({});

// Test data from user
const jwk = {
  kty: 'RSA',
  n: 'nZzv-lpAXLt5_4_jycoj3FSr6A_Pi-sPebTzzh8Yuf1gWOrRHL6gOVYiDbxR9kxCm75bg8js3lqTBdifr1ooVhppXsQNUqxNypIT8QhPr4QkmY39XLQqt5JGCESa7Mzc-EXNa-0mkzgcfXTLamyMyLWfvD_oFNHqEsJk6xut1aFxOUGnpNzgv203CCkK4Yi1PUl8RU7Q5d2JCoVvFiAF4tm_5aG9AB-vEBkW0jbHntRHsHZGi3QVtiA_Msd2--J6DZ2WL4_MbZkhDiKuA2lBFiLtfO-wARSh9qRIT902CmOG1rM4aBR87avZa4vz9mwx_0tGGuKYaXCJ_AQ9ASahTDlIGrFZTAUgh3GPnhvL6GT94Mb6BiJVzavvxA5OXdxDbhoHFzgaEc5_Y707UN0TGWHT2pfwUbgZgGrOftjJa2mkO1y7zixRoaHxKKn_cDCpI5gnRX4vlhaDFxgmso-ZG0N01oyuVtdpPp5PR7O-0Iy0OyrSyPY_MjTo-fgKrZlbBRMcOWmdia_DizowiUJ_hYGXc_jqYo38gVde_d4NvbuubfpsVImtV3fzADAHcvO90hwu5IMF2Q0bKE38bXdGaiivMH34dqxYFjS0fNYBhfOEvP4vqGZ62n9BlvWAQwLgEL71GF6LPUHC5fOei2eCx1c7WAHCNCX_5G7jXUhunFU',
  e: 'AQAB'
};

const signatureB64url = 'hpfHvT1fwicEgtH3cbvW2w9HMqdlKSG2wXLy8KnCkSdTTrSr2M7A4tMWvjFc7792SLI349dMOyAfOGT7c_JOD_-y4ZAf5S6Oiwvtc5ACHJq5n78L4QKhH_VlLOarswrwOMeuIsj_FpBd305LHv3EEmka8jkyZ4hPQZGYJi0c_3EDmEcAtGtSztXO_3Pmg4kKGpbxjTqAt7Eb1PVSYRd3WlQgxBgmqmjUTnDNlVfp9ZGkRCsMpwMBVbKh_9MWktab7JKCjHcQYVxs08XIy98H5pgHKcCoGLaGjwVxUorwyBL6GqnH0ce_LVfPPXviNhCDPEYtsgQV-nDNlw5vbbmqq0UMclSOTS6edywEsyt-ZinuTGbInGKIi_xJDBbpee10S6ct0aP83zUSrfDuGx2rBb5gCz0tLswBugur96TJbb3U36sfWZqhG1y94ZoXNjxLOgexMp1oAqpwLQeHPNAucQt9KmXD4EoXwsi0RoD1MdbRqmqALdOZ38l04v5Jc6tK8t7ksdHVO6tPZiJAnVC5YfQWH6XKOfGfFfZb2p-vHb7B-EDg-BJmH2za9J1NACz20MPbGfAsnrhuJEJKBMg27-xwnIRJGKHMkDBJhtsQA7eNKsrzpRNobDBocKv9X_RI1QMv-9ScWncZfci1JCv5utzYY-ap5vwHq_Ieh7aTaA0';

const message = 'Sign in to Web OS\n\nAddress: Z1COjLRwKht_NhbGoeG69ChZ5t_b6V2LCEZfI7KhbhQ\nNonce: 4a4f8df448a523d37ef4c5f8d355d115\nIssued At: 2026-03-14T16:26:57.342Z';

function jwkToPem(jwk) {
  const modB64 = jwk.n.replace(/-/g, '+').replace(/_/g, '/');
  const modulus = Buffer.from(modB64, 'base64');
  const expB64 = (jwk.e || 'AQAB').replace(/-/g, '+').replace(/_/g, '/');
  const exponent = Buffer.from(expB64, 'base64');
  
  const derEncode = (tag, content) => {
    const len = content.length;
    let lenBytes;
    if (len < 128) lenBytes = Buffer.from([len]);
    else if (len < 256) lenBytes = Buffer.from([0x81, len]);
    else lenBytes = Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
    return Buffer.concat([Buffer.from([tag]), lenBytes, content]);
  };
  
  const encodeInteger = (buf) => {
    if (buf[0] >= 0x80) { const withZero = Buffer.alloc(buf.length + 1); withZero[0] = 0x00; buf.copy(withZero, 1); return withZero; }
    return buf;
  };
  
  const modSeq = derEncode(0x02, encodeInteger(modulus));
  const expSeq = derEncode(0x02, encodeInteger(exponent));
  const rsaKey = derEncode(0x30, Buffer.concat([modSeq, expSeq]));
  const rsaOid = Buffer.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  const bitString = derEncode(0x03, Buffer.concat([Buffer.from([0x00]), rsaKey]));
  const spki = derEncode(0x30, Buffer.concat([rsaOid, bitString]));
  const base64 = spki.toString('base64');
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

console.log('=== Comprehensive Arweave Signature Verification Test ===\n');
console.log('JWK n length:', jwk.n.length, 'chars');
console.log('Signature length:', signatureB64url.length, 'chars');
console.log('Message length:', message.length, 'chars');
console.log('');

const sigBytes = Buffer.from(signatureB64url, 'base64url');
const msgBytes = Buffer.from(message, 'utf8');
const pem = jwkToPem(jwk);

console.log('Signature bytes:', sigBytes.length);
console.log('Message bytes:', msgBytes.length);
console.log('PEM length:', pem.length);
console.log('');

// Test 1: Arweave.crypto.verify (the official way)
console.log('=== Test 1: Arweave.crypto.verify ===');
async function test1() {
  try {
    const result = await Arweave.crypto.verify(jwk.n, msgBytes, sigBytes);
    console.log('Result:', result);
  } catch (e) {
    console.log('Error:', e.message);
  }
}
test1();

// Test 2: Node.js crypto with various hash algorithms and paddings
console.log('\n=== Test 2: Node.js crypto variations ===');

const hashes = ['sha256', 'sha384', 'sha512'];
const paddings = [
  { name: 'PKCS1', padding: crypto.constants.RSA_PKCS1_PADDING },
  { name: 'PSS-DIGEST', padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST },
  { name: 'PSS-MAX', padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_MAX_SIGN },
  { name: 'PSS-0', padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 0 },
  { name: 'PSS-32', padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
  { name: 'PSS-48', padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 48 },
  { name: 'PSS-64', padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 64 },
];

console.log('Testing raw message:');
for (const hash of hashes) {
  for (const pad of paddings) {
    try {
      const result = crypto.verify(hash, msgBytes, { key: pem, padding: pad.padding, saltLength: pad.saltLength }, sigBytes);
      if (result) console.log(`  ${hash} + ${pad.name}: TRUE`);
    } catch (e) {}
  }
}

console.log('\nTesting SHA256 hash of message:');
const hash256 = crypto.createHash('sha256').update(msgBytes).digest();
for (const pad of paddings) {
  try {
    const result = crypto.verify('sha256', hash256, { key: pem, padding: pad.padding, saltLength: pad.saltLength }, sigBytes);
    if (result) console.log(`  SHA256 + ${pad.name}: TRUE`);
  } catch (e) {}
}

// Test 3: Different message encodings
console.log('\n=== Test 3: Different message encodings ===');

const msgBase64 = msgBytes.toString('base64');
const msgBase64url = msgBytes.toString('base64url');
const msgHex = msgBytes.toString('hex');

console.log('Testing base64-encoded message...');
let result = crypto.verify('sha256', Buffer.from(msgBase64, 'base64'), { key: pem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, sigBytes);
console.log('  base64 + PSS-32:', result);

result = crypto.verify('sha256', Buffer.from(msgBase64url, 'base64url'), { key: pem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, sigBytes);
console.log('  base64url + PSS-32:', result);

// Test 4: Arweave transaction-style signing
console.log('\n=== Test 4: Arweave transaction-style signing ===');

// Arweave transactions sign a deep hash of: owner, target, data_root, quantity, reward, last_tx
// Let's see if signMessage uses a similar format

async function test4() {
  // Try signing the hash of the message
  const hash = await Arweave.crypto.hash(msgBytes, 'SHA-256');
  console.log('SHA-256 hash of message:', Arweave.utils.bufferTob64Url(hash));
  
  // Try verifying against the hash
  try {
    const result = await Arweave.crypto.verify(jwk.n, hash, sigBytes);
    console.log('Arweave verify(hash):', result);
  } catch (e) {
    console.log('Arweave verify(hash) error:', e.message);
  }
  
  // Try with raw bytes
  try {
    const result = await Arweave.crypto.verify(jwk.n, msgBytes, sigBytes);
    console.log('Arweave verify(raw):', result);
  } catch (e) {
    console.log('Arweave verify(raw) error:', e.message);
  }
}
test4();

// Test 5: Check if signature is valid at all
console.log('\n=== Test 5: Signature validity check ===');
console.log('Signature size:', sigBytes.length, 'bytes');
console.log('Modulus size:', Buffer.from(jwk.n.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length, 'bytes');
console.log('Expected RSA key size:', sigBytes.length * 8, 'bits');
console.log('Modulus bits:', Buffer.from(jwk.n.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length * 8, 'bits');

// Test 6: Check address derivation
console.log('\n=== Test 6: Address verification ===');
async function test6() {
  const modulusBytes = Arweave.utils.b64UrlToBuffer(jwk.n);
  const hash = await Arweave.crypto.hash(modulusBytes, 'SHA-256');
  const derivedAddress = Arweave.utils.bufferTob64Url(hash);
  const expectedAddress = 'Z1COjLRwKht_NhbGoeG69ChZ5t_b6V2LCEZfI7KhbhQ';
  console.log('Derived address:', derivedAddress);
  console.log('Expected address:', expectedAddress);
  console.log('Match:', derivedAddress === expectedAddress);
}
test6();

// Test 7: Try with Web Crypto API
console.log('\n=== Test 7: Web Crypto API ===');
async function test7() {
  try {
    const key = await crypto.webcrypto.subtle.importKey(
      'jwk',
      { ...jwk, alg: 'RS256' },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const result = await crypto.webcrypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      sigBytes,
      msgBytes
    );
    console.log('Web Crypto RSASSA-PKCS1-v1_5:', result);
  } catch (e) {
    console.log('Web Crypto error:', e.message);
  }
  
  try {
    const key = await crypto.webcrypto.subtle.importKey(
      'jwk',
      { ...jwk, alg: 'PS256' },
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const result = await crypto.webcrypto.subtle.verify(
      { name: 'RSA-PSS', saltLength: 32 },
      key,
      sigBytes,
      msgBytes
    );
    console.log('Web Crypto RSA-PSS saltLength=32:', result);
  } catch (e) {
    console.log('Web Crypto RSA-PSS error:', e.message);
  }
}
test7();

console.log('\n=== All tests complete ===');