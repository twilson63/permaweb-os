export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export const getGitHubOAuthConfig = (): GitHubOAuthConfig | null => {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim() || "";

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret
  };
};

export const buildGitHubAuthorizeUrl = ({
  clientId,
  redirectUri,
  state
}: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string => {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "repo read:user",
    state,
    allow_signup: "true"
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
};

export const exchangeGitHubCodeForToken = async ({
  clientId,
  clientSecret,
  code,
  redirectUri
}: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<string | null> => {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri
  });

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    access_token?: string;
  };
  const accessToken = payload.access_token?.trim();

  return accessToken || null;
};
