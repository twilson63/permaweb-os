/**
 * @fileoverview GitHub OAuth helpers for config, authorization URL generation, and token exchange.
 * @author Web OS contributors
 * @exports getGitHubOAuthConfig, buildGitHubAuthorizeUrl, exchangeGitHubCodeForToken
 */

/**
 * Utilities for the GitHub OAuth web application flow.
 *
 * Exports helpers to read configuration, build authorize URLs, and exchange
 * authorization codes for access tokens.
 */

/**
 * Required GitHub OAuth client credentials.
 */
export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Reads GitHub OAuth credentials from environment variables.
 *
 * @returns Client configuration when fully configured; otherwise `null`.
 */
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

/**
 * Builds the redirect URL used to start the GitHub OAuth authorization flow.
 *
 * @param clientId - OAuth app client ID.
 * @param redirectUri - Callback URI registered for the OAuth app.
 * @param state - CSRF protection state token.
 * @returns Full GitHub authorization URL with query parameters.
 */
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

/**
 * Exchanges a GitHub OAuth authorization code for an access token.
 *
 * @param clientId - OAuth app client ID.
 * @param clientSecret - OAuth app client secret.
 * @param code - Authorization code from callback query params.
 * @param redirectUri - Callback URI used for the authorization request.
 * @returns Access token string when successful, otherwise `null`.
 */
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
