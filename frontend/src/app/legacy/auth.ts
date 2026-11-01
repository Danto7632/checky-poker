export type MembershipTier = "free" | "pro";
export type AuthRole = "guest" | MembershipTier;
export type PreferredLanguage = "en" | "ko" | "ja";
export const SESSION_UPDATED_EVENT = "aipot:session-updated";

interface AuthSnapshot {
  role: AuthRole;
  isLoggedIn: boolean;
  isPro: boolean;
  userName: string;
  balanceAmount: number;
  preferredLanguage: PreferredLanguage;
}

interface AuthResult {
  ok: boolean;
  message?: string;
}

interface AuthApiUser {
  id: string;
  nickname: string;
  role: string;
  guest: boolean;
  balanceAmount?: number;
  preferredLanguage?: PreferredLanguage;
}

interface AuthApiResponse {
  accessToken: string;
  tokenType: "Bearer";
  user: AuthApiUser;
}

interface StoredSessionUser {
  id: string;
  nickname: string;
  role: AuthRole;
  guest: boolean;
  balanceAmount: number;
  preferredLanguage: PreferredLanguage;
}

const ACCESS_TOKEN_KEY = "aipot_access_token";
const SESSION_USER_KEY = "aipot_session_user";

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function notifySessionUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SESSION_UPDATED_EVENT));
}

function normalizeRole(rawRole: string, guest: boolean): AuthRole {
  if (guest || rawRole === "guest") return "guest";
  if (rawRole === "pro") return "pro";
  return "free";
}

function normalizePreferredLanguage(rawLanguage: unknown): PreferredLanguage {
  if (rawLanguage === "ko" || rawLanguage === "ja") return rawLanguage;
  return "en";
}

function readStoredUser(): StoredSessionUser | null {
  if (!canUseStorage()) return null;

  try {
    const raw = localStorage.getItem(SESSION_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSessionUser;
  } catch {
    return null;
  }
}

function writeSession(session: AuthApiResponse) {
  if (!canUseStorage()) return;

  const role = normalizeRole(session.user.role, session.user.guest);
  const user: StoredSessionUser = {
    id: session.user.id,
    nickname: session.user.nickname,
    role,
    guest: session.user.guest,
    preferredLanguage: normalizePreferredLanguage(session.user.preferredLanguage),
    balanceAmount:
      typeof session.user.balanceAmount === "number"
        ? session.user.balanceAmount
        : session.user.guest
          ? 1000
          : 10000,
  };

  localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
  localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
  notifySessionUpdated();
}

export function patchSessionUser(patch: Partial<StoredSessionUser>) {
  if (!canUseStorage()) return;

  const current = readStoredUser();
  if (!current) return;

  const next: StoredSessionUser = {
    ...current,
    ...patch,
  };

  localStorage.setItem(SESSION_USER_KEY, JSON.stringify(next));
  notifySessionUpdated();
}

function clearSession() {
  if (!canUseStorage()) return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(SESSION_USER_KEY);
  notifySessionUpdated();
}

function parseErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "요청 처리 중 오류가 발생했습니다.";
  }

  const data = payload as { message?: string | string[] };
  if (Array.isArray(data.message)) {
    return data.message.join("\n");
  }
  if (typeof data.message === "string" && data.message.length > 0) {
    return data.message;
  }

  return "요청 처리 중 오류가 발생했습니다.";
}

async function requestAuth(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(parseErrorMessage(payload));
  }

  return payload as AuthApiResponse;
}

export function getApiBaseUrl() {
  const raw = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
  return String(raw).replace(/\/$/, "");
}

export function getAccessToken() {
  if (!canUseStorage()) return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function ensureAuthSeedData() {
  // Backend mode에서는 seed 계정을 서버(AuthService)에서 관리합니다.
}

export async function signInUser(
  nickname: string,
  password: string,
): Promise<AuthResult> {
  try {
    const session = await requestAuth("/auth/sign-in", { nickname, password });
    writeSession(session);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "로그인 처리 중 오류가 발생했습니다.",
    };
  }
}

export async function signUpUser(
  nickname: string,
  password: string,
): Promise<AuthResult> {
  try {
    const session = await requestAuth("/auth/sign-up", { nickname, password });
    writeSession(session);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "회원가입 처리 중 오류가 발생했습니다.",
    };
  }
}

export async function signInGuest(displayName?: string): Promise<AuthResult> {
  try {
    const session = await requestAuth("/auth/guest-session", {
      displayName: displayName && displayName.trim() ? displayName.trim() : undefined,
    });
    writeSession(session);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "게스트 세션 생성 중 오류가 발생했습니다.",
    };
  }
}

export function signOut() {
  const token = getAccessToken();
  if (token) {
    void fetch(`${getApiBaseUrl()}/auth/sign-out`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }).catch(() => {
      // no-op
    });
  }

  clearSession();
}

export function getCurrentAuth(): AuthSnapshot {
  const user = readStoredUser();
  if (!user) {
    return {
      role: "guest",
      isLoggedIn: false,
      isPro: false,
      userName: "Guest",
      balanceAmount: 1000,
      preferredLanguage: "en",
    };
  }

  const preferredLanguage = normalizePreferredLanguage(user.preferredLanguage);

  return {
    role: user.role,
    isLoggedIn: user.role !== "guest",
    isPro: user.role === "pro",
    userName: user.nickname,
    balanceAmount: typeof user.balanceAmount === "number" ? user.balanceAmount : user.role === "guest" ? 1000 : 10000,
    preferredLanguage,
  };
}

export function getCurrentUserId() {
  const user = readStoredUser();
  return user?.id ?? null;
}

export function getCurrentPreferredLanguage(): PreferredLanguage {
  return getCurrentAuth().preferredLanguage;
}
