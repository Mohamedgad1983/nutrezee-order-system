export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error_code?: string } | null;
    throw new ApiError(response.status, body?.error_code ?? `http_${response.status}`);
  }
  return response.json() as Promise<T>;
}
