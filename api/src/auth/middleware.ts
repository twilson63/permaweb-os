import { NextFunction, Request, Response } from "express";
import { AuthStore, SessionIdentity } from "./store";

export interface SessionLocals {
  session: SessionIdentity;
}

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
