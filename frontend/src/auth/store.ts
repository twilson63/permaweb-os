export interface AuthSession {
  token: string;
  address: string;
  expiresAt: string;
}

const SESSION_TOKEN_KEY = "webos.sessionToken";
const WALLET_ADDRESS_KEY = "webos.walletAddress";
const SESSION_EXPIRES_AT_KEY = "webos.sessionExpiresAt";

class AuthStore {
  private session: AuthSession | null;

  constructor() {
    this.session = this.readFromStorage();

    if (this.session && this.isExpired(this.session.expiresAt)) {
      this.clearSession();
    }
  }

  getSession(): AuthSession | null {
    if (!this.session) {
      return null;
    }

    if (this.isExpired(this.session.expiresAt)) {
      this.clearSession();
      return null;
    }

    return this.session;
  }

  setSession(session: AuthSession): void {
    this.session = session;
    localStorage.setItem(SESSION_TOKEN_KEY, session.token);
    localStorage.setItem(WALLET_ADDRESS_KEY, session.address);
    localStorage.setItem(SESSION_EXPIRES_AT_KEY, session.expiresAt);
  }

  clearSession(): void {
    this.session = null;
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(WALLET_ADDRESS_KEY);
    localStorage.removeItem(SESSION_EXPIRES_AT_KEY);
  }

  private readFromStorage(): AuthSession | null {
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    const address = localStorage.getItem(WALLET_ADDRESS_KEY);
    const expiresAt = localStorage.getItem(SESSION_EXPIRES_AT_KEY);

    if (!token || !address || !expiresAt) {
      return null;
    }

    return {
      token,
      address,
      expiresAt
    };
  }

  private isExpired(expiresAt: string): boolean {
    const expiresAtMs = Date.parse(expiresAt);

    if (Number.isNaN(expiresAtMs)) {
      return true;
    }

    return expiresAtMs <= Date.now();
  }
}

export const authStore = new AuthStore();
