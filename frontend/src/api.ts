import { signatureHeaders, type RequestLike, type Signer } from "http-message-sig";
import { authStore } from "./auth/store";

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

export interface CreatePodInput {
  model?: string;
}

export interface WalletAuthChallenge {
  message: string;
  nonce: string;
}

export interface WalletAuthSession {
  token: string;
  expiresAt: string;
}

export interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

interface ListPodsResponse {
  pods: Pod[];
}

const parseError = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
};

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

function toHeaderRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};

  for (const [name, value] of headers.entries()) {
    record[name] = value;
  }

  return record;
}

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

const getAuthHeaders = (): HeadersInit => {
  const token = authStore.getSession()?.token;

  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`
  };
};

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
