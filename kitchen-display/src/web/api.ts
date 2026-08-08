export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = 'ApiError';
  }
}

// The server intentionally allows the read-only Partner request up to 30 seconds.
// Keep the browser deadline above that boundary so it receives the server's safe
// success/error response instead of aborting an otherwise valid production read.
const DEFAULT_TIMEOUT_MS = 40_000;

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers,
    signal: init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error_code?: string } | null;
    throw new ApiError(response.status, body?.error_code ?? `http_${response.status}`);
  }
  return response.json() as Promise<T>;
}
