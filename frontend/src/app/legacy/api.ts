import { getAccessToken, getApiBaseUrl } from "./auth";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function extractMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "서버 요청 처리 중 오류가 발생했습니다.";
  }

  const data = payload as { message?: string | string[] };
  if (Array.isArray(data.message)) {
    return data.message.join("\n");
  }

  if (typeof data.message === "string" && data.message.length > 0) {
    return data.message;
  }

  return "서버 요청 처리 중 오류가 발생했습니다.";
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers(options.headers ?? {});

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers,
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? ((await response.json()) as unknown) : null;

  if (!response.ok) {
    throw new ApiError(extractMessage(payload), response.status);
  }

  return payload as T;
}
