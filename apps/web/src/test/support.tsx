import type { AuthorizationScope, CurrentAccountResponse } from '@lucy-spa/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountContext, WorkforceContext } from '../components/workforce/session';
import type { Locale } from '../i18n/locales';
import { getWorkforceDictionary } from '../i18n/workforce';
import { WorkforceApi } from '../lib/workforce/api';

type Grant = [permission: string, scope?: string];

/** A workforce account whose `/auth/me` hints hold the given grants (branch id or GLOBAL). */
export function employee(
  grants: Grant[] = [],
  denies: Grant[] = [],
  id = 'emp-1',
): CurrentAccountResponse {
  const scope = (branch?: string): AuthorizationScope =>
    branch ? { kind: 'BRANCH', branchId: branch } : { kind: 'GLOBAL' };
  return {
    id,
    kind: 'EMPLOYEE',
    displayName: 'Lan',
    locale: 'vi',
    authorization: {
      version: 1,
      grants: grants.map(([permission, branch]) => ({ permission, scope: scope(branch) })),
      denies: denies.map(([permission, branch]) => ({ permission, scope: scope(branch) })),
    },
  };
}

export const owner: CurrentAccountResponse = {
  id: 'owner-1',
  kind: 'OWNER',
  displayName: 'Owner',
  locale: 'vi',
  authorization: { version: 1, owner: true },
};

export const customer: CurrentAccountResponse = {
  id: 'cust-1',
  kind: 'CUSTOMER',
  displayName: 'Customer',
  locale: 'vi',
  authorization: { version: 1, grants: [], denies: [] },
};

/**
 * Server-renders a workforce component with real contexts and an API whose requests never
 * settle: the markup is the component's first paint, which is where permission gating
 * decides which sections and actions exist.
 */
export function render(
  node: ReactNode,
  account: CurrentAccountResponse,
  locale: Locale = 'vi',
): string {
  const api = new WorkforceApi({ fetch: () => new Promise<Response>(() => undefined) });
  return renderToStaticMarkup(
    <WorkforceContext.Provider
      value={{ locale, t: getWorkforceDictionary(locale), api, base: `/${locale}/workforce` }}
    >
      <AccountContext.Provider value={{ account, signOut: () => Promise.resolve() }}>
        {node}
      </AccountContext.Provider>
    </WorkforceContext.Provider>,
  );
}

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A scripted fetch: each call is recorded and answered by the next handler. */
export function scriptedFetch(responses: ((call: Call) => Response)[]) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${call.method} ${call.url}`);
    return Promise.resolve(next(call));
  };
  return { fetcher, calls };
}

export function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const context =
  (token: string, authenticated = false) =>
  () =>
    json(200, { csrfToken: token, authenticated });

export const failure =
  (status: number, code: string, message = code) =>
  () =>
    json(status, { statusCode: status, code, message, requestId: 'req-1' });
