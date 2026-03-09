import { signatureHeaders, type RequestLike, type Signer } from "http-message-sig";
import { authStore } from "./auth/store";

/**
 * Frontend API client utilities used by the React application.
 */

/**
 * Pod entity shape returned by backend endpoints.
 */
export interface Pod {
  id: string;
  name: string;
  status: string;
  subdomain: string;
  createdAt: string;
  llm?: {
    model: string;
    provider: string;
    keyPath: string;
  };
}

/**
 * Request payload accepted by the pod creation endpoint.
 */
export interface CreatePodInput {
  model?: string;
}

/**
 * Wallet challenge payload returned before signature verification.
 */
export interface WalletAuthChallenge {
  message: string;
  nonce: string;
}

/**
 * Session payload returned after wallet signature verification.
 */
export interface WalletAuthSession {
  token: string;
  expiresAt: string;
}

/**
 * Wallet provider methods required for HTTP signature and auth flows.
 */
export interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

/**
 * Response shape for the pod list endpoint.
 */
interface ListPodsResponse {
  pods: Pod[];
}

/**
 * Parses API error responses into a user-facing message.
 *
 * @param response - Failed fetch response.
 * @returns API-provided message or fallback status text.
 */
const parseError = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
};

/**
 * Converts a hex-encoded wallet signature into raw bytes.
 *
 * @param signatureHex - Signature string from wallet providers.
 * @returns Signature bytes.
 * @throws {Error} If the input is not valid even-length hex.
 */
function signatureHexToBytes(signatureHex: string): Uint8Array {
  const normalized = signatureHex.startsWith("0x") ? signatureHex.slice(2) : signatureHex;

  if (!/^[a-fA-F0-9]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("Wallet returned an invalid signature format");
  }

  const bytes = new Uint8Array(normalized.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    const offset = index * 2;
    bytes[index] = Number.parseInt(normalized.slice(offset, offset + 2), 16);
  }

  return bytes;
}

/**
 * Converts Fetch headers into a plain string map.
 *
 * @param headers - Headers object.
 * @returns Plain object keyed by header names.
 */
function toHeaderRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};

  for (const [name, value] of headers.entries()) {
    record[name] = value;
  }

  return record;
}

/**
 * Builds HTTP Message Signature headers using an Ethereum wallet signer.
 *
 * @param input - Signature construction parameters.
 * @returns Headers including `Signature` and `Signature-Input`.
 */
async function createHttpSigHeaders(input: {
  provider: EthereumProvider;
  address: string;
  requestUrl: string;
  method: string;
  headers?: HeadersInit;
}): Promise<Headers> {
  const requestUrl = new URL(input.requestUrl, window.location.origin);
  const headers = new Headers(input.headers);

  if (!headers.has("date")) {
    headers.set("date", new Date().toUTCString());
  }

  if (!headers.has("host")) {
    headers.set("host", requestUrl.host);
  }

  const requestLike: RequestLike = {
    method: input.method,
    url: `${requestUrl.pathname}${requestUrl.search}`,
    protocol: requestUrl.protocol.replace(":", ""),
    headers: toHeaderRecord(headers),
  };

  const signer: Signer = {
    keyid: input.address.toLowerCase(),
    alg: "eth-personal-sign" as unknown as Signer["alg"],
    sign: async (signingString) => {
      const response = await input.provider.request({
        method: "personal_sign",
        params: [signingString, input.address],
      });

      if (typeof response !== "string") {
        throw new Error("Wallet did not return a signature");
      }

      return signatureHexToBytes(response);
    },
  };

  const signedHeaders = await signatureHeaders(requestLike, {
    signer,
    components: ["@method", "@path", "host", "date"],
  });

  headers.set("Signature", signedHeaders.Signature);
  headers.set("Signature-Input", signedHeaders["Signature-Input"]);
  return headers;
}

/**
 * Executes a fetch request signed with HTTP Message Signatures.
 *
 * @param provider - Browser Ethereum provider used to sign the request.
 * @param address - Wallet address used as signer key id.
 * @param requestUrl - Request URL to fetch.
 * @param init - Optional fetch init options.
 * @returns Fetch response.
 */
export async function podFetchWithHttpSig(
  provider: EthereumProvider,
  address: string,
  requestUrl: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = init.method ?? "GET";
  const headers = await createHttpSigHeaders({
    provider,
    address,
    requestUrl,
    method,
    headers: init.headers,
  });

  return fetch(requestUrl, {
    ...init,
    method,
    headers,
  });
}

/**
 * Returns bearer auth headers for the current wallet session.
 *
 * @returns Authorization headers when a session token exists.
 */
const getAuthHeaders = (): HeadersInit => {
  const token = authStore.getSession()?.token;

  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`
  };
};

/**
 * Retrieves all pods visible to the authenticated wallet.
 *
 * @returns Pod records.
 */
export const listPods = async (): Promise<Pod[]> => {
  const response = await fetch("/api/pods", {
    headers: {
      ...getAuthHeaders()
    }
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const payload = (await response.json()) as ListPodsResponse;
  return payload.pods;
};

/**
 * Creates a new pod for the authenticated wallet.
 *
 * @param input - Pod creation payload.
 * @returns Created pod.
 */
export const createPod = async (input: CreatePodInput = {}): Promise<Pod> => {
  const response = await fetch("/api/pods", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders()
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as Pod;
};

/**
 * Deletes a pod by identifier.
 *
 * @param id - Pod ID.
 */
export const deletePod = async (id: string): Promise<void> => {
  const response = await fetch(`/api/pods/${id}`, {
    method: "DELETE",
    headers: {
      ...getAuthHeaders()
    }
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }
};

/**
 * Requests a wallet signature challenge from the API.
 *
 * @param address - Wallet address requesting login.
 * @returns Challenge message and nonce.
 */
export const requestWalletChallenge = async (address: string): Promise<WalletAuthChallenge> => {
  const response = await fetch("/api/auth/nonce", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ address })
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as WalletAuthChallenge;
};

/**
 * Verifies a signed challenge and returns an authenticated session.
 *
 * @param address - Wallet address that signed the challenge.
 * @param signature - Signature produced by wallet `personal_sign`.
 * @returns Session token and expiry.
 */
export const verifyWalletSignature = async (
  address: string,
  signature: string
): Promise<WalletAuthSession> => {
  const response = await fetch("/api/auth/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ address, signature })
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as WalletAuthSession;
};
