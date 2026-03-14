const Arweave = require('arweave');
const crypto = require('crypto');

// Test: Understand how Arweave transaction signatures work
// Arweave.crypto.verify() expects: (owner, data, signature)
// where data is the deepHash of transaction fields

// Sample JWK (public key only - for verification)
const jwkN = 'nZzv-lpAXLt5_4_jycoj3FSr6A_Pi-sPebTzzh8Yuf1gWOrRHL6gOVYiDbxR9kxCm75bg8js3lqTBdifr1ooVhppXsQNUqxNypIT8QhPr4QkmY39XLQqt5JGCESa7Mzc-EXNa-0mkzgcfXTLamyMyLWfvD_oFNHqEsJk6xut1aFxOUGnpNzgv203CCkK4Yi1PUl8RU7Q5d2JCoVvFiAF4tm_5aG9AB-vEBkW0jbHntRHsHZGi3QVtiA_Msd2--J6DZ2WL4_MbZkhDiKuA2lBFiLtfO-wARSh9qRIT902CmOG1rM4aBR87avZa4vz9mwx_0tGGuKYaXCJ_AQ9ASahTDlIGrFZTAUgh3GPnhvL6GT94Mb6BiJVzavvxA5OXdxDbhoHFzgaEc5_Y707UN0TGWHT2pfwUbgZgGrOftjJa2mkO1y7zixRoaHxKKn_cDCpI5gnRX4vlhaDFxgmso-ZG0N01oyuVtdpPp5PR7O-0Iy0OyrSyPY_MjTo-fgKrZlbBRMcOWmdia_DizowiUJ_hYGXc_jqYo38gVde_d4NvbuubfpsVImtV3fzADAHcvO90hwu5IMF2Q0bKE38bXdGaiivMH34dqxYFjS0fNYBhfOEvP4vqGZ62n9BlvWAQwLgEL71GF6LPUHC5fOei2eCx1c7WAHCNCX_5G7jXUhunFU';

console.log('=== How Arweave Transaction Signature Verification Works ===\n');

console.log('For authentication, the client should:');
console.log('1. Create an Arweave transaction with the auth message as data');
console.log('2. Sign the transaction with Wander (using sign() API)');
console.log('3. Send the signed transaction to the server');
console.log('');
console.log('The server can then:');
console.log('1. Verify the transaction signature using Arweave.crypto.verify()');
console.log('2. Check that the data matches the auth message');
console.log('');

console.log('=== Transaction Structure ===\n');
console.log('A signed transaction has:');
console.log('- id: hash of the signature');
console.log('- owner: public key modulus');
console.log('- signature: RSA-PSS signature of deepHash(tx fields)');
console.log('- data_root: merkle root of data (for large files)');
console.log('- data_size: size of the data');
console.log('');

console.log('=== Verification Process ===\n');
console.log('ArweaveJS verification:');
console.log('1. Compute deepHash of: [owner, target, data_root, quantity, reward, last_tx]');
console.log('2. Verify signature against deepHash using owner (public key modulus)');
console.log('');

console.log('=== Client-Side Code (Browser) ===\n');
console.log(`
// In browser with Wander:
const arweave = Arweave.init({ host: 'ar-io.net', port: 443, protocol: 'https' });
const message = "Sign in to Web OS\\n\\nAddress: YOUR_ADDRESS\\nNonce: NONCE\\nIssued At: TIMESTAMP";

// Get wallet address
await window.arweaveWallet.connect(['SIGN_TRANSACTION', 'ACCESS_ADDRESS', 'ACCESS_ALL_PUBLIC_KEYS']);
const address = await window.arweaveWallet.getActiveAddress();

// Create transaction with message as data
const tx = await arweave.createTransaction({ data: message });

// Sign with Wander
const signedTx = await window.arweaveWallet.sign(tx);

// Send to server
const payload = {
  address: address,
  message: message,
  signature: signedTx.signature,
  owner: signedTx.owner,
  id: signedTx.id
};
fetch('/api/auth/verify', { method: 'POST', body: JSON.stringify(payload) });
`);

console.log('=== Server-Side Verification ===\n');
console.log(`
// Server verification:
const Arweave = require('arweave');
const arweave = Arweave.init({});

async function verifyAuth(payload) {
  const { signature, owner, message, address } = payload;
  
  // Create a transaction to compute the deep hash
  const tx = await arweave.createTransaction({ data: message });
  tx.owner = owner;
  tx.signature = signature;
  
  // Compute deep hash of transaction fields
  const dataBuffer = arweave.utils.stringToBuffer(message);
  const dataRoot = await arweave.merkle.computeRoots(dataBuffer);
  const deepHash = await Arweave.crypto.deepHash([
    arweave.utils.b64UrlToBuffer(owner),
    new Uint8Array(0), // target (empty for data tx)
    dataRoot,
    arweave.utils.stringToBuffer('0'), // quantity
    arweave.utils.stringToBuffer('0'), // reward
    new Uint8Array(0) // last_tx
  ]);
  
  // Verify signature
  const isValid = await Arweave.crypto.verify(
    owner,
    deepHash,
    arweave.utils.b64UrlToBuffer(signature)
  );
  
  // Verify address matches owner
  const derivedAddress = arweave.utils.bufferTob64Url(
    await Arweave.crypto.hash(arweave.utils.b64UrlToBuffer(owner), 'SHA-256')
  );
  
  return isValid && derivedAddress === address;
}
`);

console.log('=== Key Difference: signMessage vs sign (transaction) ===\n');
console.log('signMessage: Signs arbitrary bytes, algorithm unknown');
console.log('sign(transaction): Signs transaction using Arweave standard (RSA-PSS of deepHash)');
console.log('');
console.log('Recommendation: Use transaction signing for authentication!');
console.log('This will work with Arweave.crypto.verify() because it uses the standard format.');