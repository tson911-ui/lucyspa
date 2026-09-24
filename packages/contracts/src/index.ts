/** Public, transport-only contracts. No ORM, Node runtime or domain implementation exports. */
export interface HealthResponse {
  status: 'ok' | 'error';
  service: string;
  checks?: { database: 'up' | 'down'; redis: 'up' | 'down' };
}

export interface ApiErrorResponse {
  statusCode: number;
  code: string;
  message: string | string[];
  requestId: string;
}

export interface AuthContextResponse {
  csrfToken: string;
  authenticated: boolean;
}
