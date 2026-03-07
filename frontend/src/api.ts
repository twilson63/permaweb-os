export interface Pod {
  id: string;
  name: string;
  status: string;
  subdomain: string;
  createdAt: string;
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

export const listPods = async (): Promise<Pod[]> => {
  const response = await fetch("/api/pods");

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
      "Content-Type": "application/json"
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
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }
};
