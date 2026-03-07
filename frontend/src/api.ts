export interface Pod {
  id: string;
  name: string;
  status: string;
  subdomain: string;
  createdAt: string;
}

export interface WalletAuthChallenge {
  message: string;
  nonce: string;
}

export interface WalletAuthSession {
  token: string;
  address: string;
  expiresAt: string;
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

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem("webos.sessionToken");

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

export const createPod = async (): Promise<Pod> => {
  const response = await fetch("/api/pods", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders()
    },
    body: JSON.stringify({})
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
