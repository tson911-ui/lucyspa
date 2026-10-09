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
    /** On a 401: why the session ended, when the API says (`AUTHORIZATION_CHANGED`). */
    readonly reason: string | null = null,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

/**
 * The backend reports a named field as `"<Message>: <field>"`. A field is a camelCase name, or (for a
 * conflict that names the other record, like `POPUP_OVERLAP`) that record's id, or (Phase 6 P6-10: `PRODUCT_OUT_OF_STOCK` names every line
 * it cannot serve) a comma-separated list of ids. A nested field (Phase 6 P6-19: `address.recipientPhone`) is dot-separated names.
 */
function fieldOf(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const match =
    /: ([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*|[0-9a-f]{8}-[0-9a-f-]{27}(?:,[0-9a-f]{8}-[0-9a-f-]{27})*)$/.exec(
      message,
    );
  return match?.[1] ?? null;
}

function errorFromBody(status: number, body: Partial<ApiErrorResponse> | null): ApiError {
  return new ApiError(
    status,
    typeof body?.code === 'string' ? body.code : `HTTP_${status}`,
    fieldOf(body?.message),
    typeof body?.requestId === 'string' ? body.requestId : null,
    typeof body?.reason === 'string' ? body.reason : null,
  );
}

async function toError(response: Response): Promise<ApiError> {
  let body: Partial<ApiErrorResponse> | null;
  try {
    body = (await response.json()) as Partial<ApiErrorResponse>;
  } catch {
    body = null;
  }
  return errorFromBody(response.status, body);
}

/** Progress and cancellation of one file upload. */
export interface UploadControl {
  /** 0-100, as the browser sends the body. */
  readonly onProgress?: (percent: number) => void;
  readonly signal?: AbortSignal;
}

export type Query = Record<string, string | number | undefined>;

/**
 * Marks a read as caused by the user (navigation, an explicit load or reload), so the API
 * counts it as activity and restarts the idle timeout. Commands (POST) always count.
 */
export const ACTIVITY_HEADER = 'X-Lucy-Activity';

export interface RequestOptions {
  /**
   * A read not caused by the user (session checks, any future polling or background
   * refresh). It must never keep the session alive, so it carries no activity marker.
   */
  readonly passive?: boolean;
  /** The caller handles a 401 itself (the session watch); `onUnauthenticated` is not called. */
  readonly skipExpiryHook?: boolean;
}

export interface ApiClientOptions {
  /** Injected in tests; the browser's fetch otherwise. */
  readonly fetch?: typeof fetch;
  /** Called on every 401 with the method and the API's reason, so the shell can keep or leave the page. */
  readonly onUnauthenticated?: (method: 'GET' | 'POST', reason: string | null) => void;
  /** Called after every successful response (the session is valid again). */
  readonly onAuthenticatedResponse?: () => void;
  /** Injected in tests; `fetch` cannot report upload progress, so uploads use XMLHttpRequest. */
  readonly xhr?: () => XMLHttpRequest;
}

/**
 * The single web client for the Lucy Spa API, shared by the workforce and customer areas. Requests go to the same-origin `/api`
 * rewrite, so the HttpOnly session cookie travels automatically and nothing is stored in
 * web storage. Every POST sends JSON with the session-bound CSRF token from
 * `GET /api/v1/auth/context`; the browser adds the exact Origin header.
 */
export class ApiClient {
  private csrfToken: string | null = null;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: ApiClientOptions = {}) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** Refreshes the CSRF token (required after login, reauthentication and logout). */
  async context(): Promise<AuthContextResponse> {
    const context = await this.request<AuthContextResponse>('GET', '/api/v1/auth/context', {
      passive: true,
    });
    this.csrfToken = context.csrfToken;
    return context;
  }

  /** A user-caused read by default; pass `{ passive: true }` for automatic reads. */
  get<T>(path: string, query: Query = {}, options: RequestOptions = {}): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    return this.request<T>('GET', `${path}${suffix}`, options);
  }

  async post<T>(path: string, body: object = {}): Promise<T> {
    if (this.csrfToken === null) await this.context();
    try {
      return await this.request<T>('POST', path, {}, body);
    } catch (error) {
      // A rotated session invalidates the old token; the guard rejected the request
      // before it ran, so one retry with a fresh token is safe.
      if (error instanceof ApiError && error.code === 'REQUEST_NOT_ALLOWED') {
        await this.context();
        return this.request<T>('POST', path, {}, body);
      }
      throw error;
    }
  }

  /**
   * One multipart upload (the browser sets the boundary, so no Content-Type is sent). Same CSRF token,
   * one retry on a rotated session and the same 401 handling as `post`; reports progress and can be aborted.
   */
  async upload<T>(path: string, form: FormData, control: UploadControl = {}): Promise<T> {
    if (this.csrfToken === null) await this.context();
    try {
      return await this.sendForm<T>(path, form, control);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'REQUEST_NOT_ALLOWED') {
        await this.context();
        return this.sendForm<T>(path, form, control);
      }
      throw error;
    }
  }

  private sendForm<T>(path: string, form: FormData, control: UploadControl): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const xhr = this.options.xhr?.() ?? new XMLHttpRequest();
      const abort = () => xhr.abort();
      xhr.open('POST', path);
      xhr.setRequestHeader('Accept', 'application/json');
      if (this.csrfToken) xhr.setRequestHeader('X-CSRF-Token', this.csrfToken);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          control.onProgress?.(Math.round((event.loaded / event.total) * 100));
        }
      };
      const done = () => control.signal?.removeEventListener('abort', abort);
      xhr.onerror = () => {
        done();
        reject(new ApiError(0, 'NETWORK'));
      };
      xhr.onabort = () => {
        done();
        reject(new DOMException('Upload cancelled', 'AbortError'));
      };
      xhr.onload = () => {
        done();
        let body: unknown;
        try {
          body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          body = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          this.options.onAuthenticatedResponse?.();
          resolve(body as T);
          return;
        }
        const error = errorFromBody(xhr.status, body as Partial<ApiErrorResponse> | null);
        if (error.status === 401 && error.code === 'AUTHENTICATION_REQUIRED') {
          this.options.onUnauthenticated?.('POST', error.reason);
        }
        reject(error);
      };
      if (control.signal?.aborted) {
        reject(new DOMException('Upload cancelled', 'AbortError'));
        return;
      }
      control.signal?.addEventListener('abort', abort, { once: true });
      xhr.send(form);
    });
  }

  /** Forget the token (after logout the anonymous session gets a new one). */
  resetCsrf(): void {
    this.csrfToken = null;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: RequestOptions = {},
    body?: object,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (method === 'GET' && !options.passive) headers[ACTIVITY_HEADER] = 'user';
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
      if (
        error.status === 401 &&
        error.code === 'AUTHENTICATION_REQUIRED' &&
        !options.skipExpiryHook
      ) {
        this.options.onUnauthenticated?.(method, error.reason);
      }
      throw error;
    }
    this.options.onAuthenticatedResponse?.();
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
