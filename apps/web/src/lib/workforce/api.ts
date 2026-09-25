import type { ApiErrorResponse, AuthContextResponse } from '@lucy-spa/contracts';

/**
 * A failed API call. `code` is the backend's allowlisted error code (for example
 * `CONFLICT`, `FORBIDDEN`, or `HTTP_400` for request-shape validation); `field` is the
 * safe field identifier the backend names, never a submitted value.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly field: string | null = null,
    readonly requestId: string | null = null,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

/** The backend reports a named field as `"<Message>: <field>"`. */
function fieldOf(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const match = /: ([A-Za-z][A-Za-z0-9]*)$/.exec(message);
  return match?.[1] ?? null;
}

async function toError(response: Response): Promise<ApiError> {
  let body: Partial<ApiErrorResponse> | null;
  try {
    body = (await response.json()) as Partial<ApiErrorResponse>;
  } catch {
    body = null;
  }
  return new ApiError(
    response.status,
    typeof body?.code === 'string' ? body.code : `HTTP_${response.status}`,
    fieldOf(body?.message),
    typeof body?.requestId === 'string' ? body.requestId : null,
  );
}

export type Query = Record<string, string | number | undefined>;

export interface WorkforceApiOptions {
  /** Injected in tests; the browser's fetch otherwise. */
  readonly fetch?: typeof fetch;
  /** Called once per 401 so the shell can return to the login screen. */
  readonly onUnauthenticated?: () => void;
}

/**
 * The single web client for the Lucy Spa API. Requests go to the same-origin `/api`
 * rewrite, so the HttpOnly session cookie travels automatically and nothing is stored in
 * web storage. Every POST sends JSON with the session-bound CSRF token from
 * `GET /api/v1/auth/context`; the browser adds the exact Origin header.
 */
export class WorkforceApi {
  private csrfToken: string | null = null;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: WorkforceApiOptions = {}) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** Refreshes the CSRF token (required after login, reauthentication and logout). */
  async context(): Promise<AuthContextResponse> {
    const context = await this.request<AuthContextResponse>('GET', '/api/v1/auth/context');
    this.csrfToken = context.csrfToken;
    return context;
  }

  get<T>(path: string, query: Query = {}): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    return this.request<T>('GET', `${path}${suffix}`);
  }

  async post<T>(path: string, body: object = {}): Promise<T> {
    if (this.csrfToken === null) await this.context();
    try {
      return await this.request<T>('POST', path, body);
    } catch (error) {
      // A rotated session invalidates the old token; the guard rejected the request
      // before it ran, so one retry with a fresh token is safe.
      if (error instanceof ApiError && error.code === 'REQUEST_NOT_ALLOWED') {
        await this.context();
        return this.request<T>('POST', path, body);
      }
      throw error;
    }
  }

  /** Forget the token (after logout the anonymous session gets a new one). */
  resetCsrf(): void {
    this.csrfToken = null;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    }
    let response: Response;
    try {
      response = await this.fetcher(path, {
        method,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, 'NETWORK');
    }
    if (!response.ok) {
      const error = await toError(response);
      if (error.status === 401 && error.code === 'AUTHENTICATION_REQUIRED') {
        this.options.onUnauthenticated?.();
      }
      throw error;
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
