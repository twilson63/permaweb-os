/**
 * @fileoverview Express middleware that authenticates bearer sessions.
 * @author Web OS contributors
 * @exports createSessionAuthMiddleware, SessionLocals
 */

import { NextFunction, Request, Response } from "express";
import { AuthStore, SessionIdentity } from "./store";

/**
 * Response locals populated by the session authentication middleware.
 */
export interface SessionLocals {
  session: SessionIdentity;
}

/**
 * Extracts a bearer token from an Authorization header value.
 *
 * @param authorizationHeader - Raw `Authorization` header value.
 * @returns Parsed bearer token when present, otherwise `null`.
 */
const getBearerToken = (authorizationHeader: string | undefined): string | null => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
};

/**
 * Creates Express middleware that requires a valid authenticated session.
 *
 * @param authStore - Session store used to validate bearer tokens.
 * @returns Express middleware that rejects unauthorized requests with HTTP 401.
 */
export const createSessionAuthMiddleware = (authStore: AuthStore) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = getBearerToken(req.header("authorization"));

    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const session = authStore.validateSession(token);

    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    res.locals.session = session;

    next();
  };
};
