#!/bin/bash
# Local E2E Test for Permaweb OS
# Tests the complete flow: wallet auth → pod creation → signed request → OpenCode response

set -e

echo "=== Permaweb OS Local E2E Test ==="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

pass() {
    echo -e "${GREEN}✓ $1${NC}"
    ((TESTS_PASSED++))
}

fail() {
    echo -e "${RED}✗ $1${NC}"
    ((TESTS_FAILED++))
}

# Cleanup function
cleanup() {
    echo ""
    echo "Cleaning up..."
    [ ! -z "$API_PID" ] && kill $API_PID 2>/dev/null || true
    [ ! -z "$SIDECAR_PID" ] && kill $SIDECAR_PID 2>/dev/null || true
}

trap cleanup EXIT

# Check prerequisites
echo "Checking prerequisites..."
command -v node &> /dev/null || { fail "Node.js not installed"; exit 1; }
command -v npm &> /dev/null || { fail "npm not installed"; exit 1; }
pass "Node.js installed"

# Check OpenCode
if [ ! -f ~/.opencode/bin/opencode ]; then
    fail "OpenCode not installed at ~/.opencode/bin/opencode"
    exit 1
fi
pass "OpenCode installed"

# Build
echo ""
echo "Building..."
cd "$(dirname "$0")/.."
cd api && npm run build 2>&1 > /dev/null || { fail "API build failed"; exit 1; }
pass "API built"

cd ../opencode-sidecar && npm run build 2>&1 > /dev/null || { fail "Sidecar build failed"; exit 1; }
pass "Sidecar built"

cd ../frontend && npm run build 2>&1 > /dev/null || { fail "Frontend build failed"; exit 1; }
pass "Frontend built"

# Start API server
echo ""
echo "Starting API server..."
cd ../api
PORT=3000 node dist/index.js &
API_PID=$!
sleep 2

# Check API health
if curl -s http://localhost:3000/health | grep -q "ok"; then
    pass "API server running on port 3000"
else
    fail "API server not responding"
    exit 1
fi

# Start Sidecar server
echo ""
echo "Starting Sidecar server..."
cd ../opencode-sidecar
OWNER_KEY_ID="0x1234567890abcdef1234567890abcdef12345678" \
OWNER_PUBLIC_KEY_PEM="" \
PORT=3001 \
node dist/index.js &
SIDECAR_PID=$!
sleep 2

# Check Sidecar health
if curl -s http://localhost:3001/health | grep -q "ok"; then
    pass "Sidecar server running on port 3001"
else
    fail "Sidecar server not responding"
    exit 1
fi

# Test 1: Create nonce for wallet auth
echo ""
echo "=== Test 1: Wallet Authentication ==="
NONCE_RESPONSE=$(curl -s -X POST http://localhost:3000/api/auth/nonce)
NONCE=$(echo $NONCE_RESPONSE | jq -r '.nonce')

if [ ! -z "$NONCE" ] && [ "$NONCE" != "null" ]; then
    pass "Nonce created: $NONCE"
else
    fail "Failed to create nonce"
fi

# Test 2: Create a test wallet and sign
echo ""
echo "=== Test 2: Sign and Verify ==="

# Create test wallet using ethers
WALLET_JSON=$(node -e "
const { Wallet } = require('ethers');
const wallet = Wallet.createRandom();
console.log(JSON.stringify({
    address: wallet.address,
    privateKey: wallet.privateKey
}));
")

WALLET_ADDRESS=$(echo $WALLET_JSON | jq -r '.address')
WALLET_PRIVATE_KEY=$(echo $WALLET_JSON | jq -r '.privateKey')

pass "Test wallet created: $WALLET_ADDRESS"

# Sign the nonce
SIGNED_MESSAGE=$(node -e "
const { Wallet } = require('ethers');
const wallet = new Wallet('$WALLET_PRIVATE_KEY');
wallet.signMessage('$NONCE').then(sig => console.log(sig));
")

pass "Nonce signed"

# Verify signature and get session token
VERIFY_RESPONSE=$(curl -s -X POST http://localhost:3000/api/auth/verify \
    -H "Content-Type: application/json" \
    -d "{\"walletAddress\":\"$WALLET_ADDRESS\",\"signature\":\"$SIGNED_MESSAGE\",\"nonce\":\"$NONCE\"}")

SESSION_TOKEN=$(echo $VERIFY_RESPONSE | jq -r '.token')

if [ ! -z "$SESSION_TOKEN" ] && [ "$SESSION_TOKEN" != "null" ]; then
    pass "Session token received"
else
    fail "Failed to get session token"
    echo "Response: $VERIFY_RESPONSE"
fi

# Test 3: Create a pod
echo ""
echo "=== Test 3: Pod Creation ==="
POD_RESPONSE=$(curl -s -X POST http://localhost:3000/api/pods \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SESSION_TOKEN" \
    -d '{"model": "openai/gpt-4o-mini"}')

POD_ID=$(echo $POD_RESPONSE | jq -r '.id')
POD_SUBDOMAIN=$(echo $POD_RESPONSE | jq -r '.subdomain')

if [ ! -z "$POD_ID" ] && [ "$POD_ID" != "null" ]; then
    pass "Pod created: $POD_ID"
    pass "Subdomain: $POD_SUBDOMAIN"
else
    fail "Failed to create pod"
    echo "Response: $POD_RESPONSE"
fi

# Test 4: List pods
echo ""
echo "=== Test 4: Pod Listing ==="
PODS_RESPONSE=$(curl -s http://localhost:3000/api/pods \
    -H "Authorization: Bearer $SESSION_TOKEN")

POD_COUNT=$(echo $PODS_RESPONSE | jq '.pods | length')

if [ "$POD_COUNT" -gt 0 ]; then
    pass "Pods listed: $POD_COUNT pod(s)"
else
    fail "No pods returned"
fi

# Test 5: LLM Providers
echo ""
echo "=== Test 5: LLM Providers ==="
PROVIDERS_RESPONSE=$(curl -s http://localhost:3000/api/llm/providers)
PROVIDER_COUNT=$(echo $PROVIDERS_RESPONSE | jq '.providers | length')

if [ "$PROVIDER_COUNT" -gt 0 ]; then
    pass "Providers listed: $PROVIDER_COUNT provider(s)"
else
    fail "No providers returned"
fi

# Test 6: Sidecar → OpenCode Integration
echo ""
echo "=== Test 6: Sidecar → OpenCode Integration ==="

# Create a signed request to the sidecar
# Using a test wallet that matches OWNER_KEY_ID
TEST_RESULT=$(node -e "
const { Wallet } = require('ethers');
const { signatureHeaders } = require('./node_modules/http-message-sig');

async function test() {
    const wallet = new Wallet('$WALLET_PRIVATE_KEY');
    const ownerKeyId = '$WALLET_ADDRESS'.toLowerCase();
    
    const message = {
        method: 'POST',
        url: '/verify',
        protocol: 'http',
        headers: {
            host: '127.0.0.1:3001',
            date: new Date().toUTCString(),
        },
    };
    
    function signatureHexToBytes(sig) {
        return Buffer.from(sig.slice(2), 'hex');
    }
    
    const signer = {
        keyid: ownerKeyId,
        alg: 'eth-personal-sign',
        sign: async (signingString) => {
            const sig = await wallet.signMessage(signingString);
            return signatureHexToBytes(sig);
        },
    };
    
    const headers = await signatureHeaders(message, {
        signer,
        components: ['@method', '@path', 'host', 'date'],
    });
    
    const response = await fetch('http://127.0.0.1:3001/verify', {
        method: 'POST',
        headers: {
            date: message.headers.date,
            signature: headers.Signature,
            'signature-input': headers['Signature-Input'],
            'content-type': 'application/json',
        },
        body: JSON.stringify({ content: 'Say hello' }),
    });
    
    const text = await response.text();
    const lines = text.trim().split('\\n');
    const types = lines.filter(l => l.trim()).map(l => {
        try {
            return JSON.parse(l).type;
        } catch {
            return null;
        }
    });
    
    if (response.status === 200 && types.includes('text')) {
        console.log('SUCCESS');
        console.log('Response:', text.substring(0, 200));
    } else {
        console.log('FAILED');
        console.log('Status:', response.status);
        console.log('Response:', text);
    }
}

test().catch(e => console.log('ERROR:', e.message));
" 2>&1)

if echo "$TEST_RESULT" | grep -q "SUCCESS"; then
    pass "Sidecar → OpenCode flow working"
else
    fail "Sidecar → OpenCode flow failed"
    echo "$TEST_RESULT"
fi

# Test 7: Delete pod
echo ""
echo "=== Test 7: Pod Deletion ==="
DELETE_RESPONSE=$(curl -s -X DELETE "http://localhost:3000/api/pods/$POD_ID" \
    -H "Authorization: Bearer $SESSION_TOKEN")

if [ -z "$(echo $DELETE_RESPONSE | jq -r '.error // empty')" ]; then
    pass "Pod deleted"
else
    fail "Failed to delete pod"
    echo "Response: $DELETE_RESPONSE"
fi

# Summary
echo ""
echo "==================================="
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
fi
echo "==================================="

# Exit with appropriate code
if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
else
    exit 0
fi