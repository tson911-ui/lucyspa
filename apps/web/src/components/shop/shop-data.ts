'use client';

import type { OnlineCartResponse, OnlineSalesPublicResponse } from '@lucy-spa/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ApiClient } from '../../lib/api/client';
import { CART_CHANGED, SALES_CACHE_MS } from '../../lib/shop/online';
import { useSiteSession } from '../public/site-session';

/**
 * What the pages of the shop know about online ordering: the public settings (open or closed, limits, promises and the policy)
 * and, for a signed-in member, the cart. The settings are one public read shared by every island of a page for a short time;
 * a failed read counts as "closed" (the shop pages then say "buy in the shop"), never as an error that blocks the page.
 */
const publicClient = new ApiClient();
let cached: { at: number; value: OnlineSalesPublicResponse } | null = null;
let inflight: Promise<OnlineSalesPublicResponse> | null = null;

export function loadOnlineSales(force = false): Promise<OnlineSalesPublicResponse> {
  if (!force && cached && Date.now() - cached.at < SALES_CACHE_MS) {
    return Promise.resolve(cached.value);
  }
  if (inflight) return inflight;
  const request = publicClient
    .get<OnlineSalesPublicResponse>('/api/v1/online-sales', {}, { passive: true })
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = request;
  return request;
}

/** Forget the shared answer (a test, or after the policy changed under the customer). */
export function forgetOnlineSales(): void {
  cached = null;
  inflight = null;
}

export type SalesState = OnlineSalesPublicResponse | 'failed' | null;

/** The public settings: `null` while loading, `'failed'` when they cannot be read. */
export function useOnlineSales(): { sales: SalesState; reload: () => Promise<SalesState> } {
  const [sales, setSales] = useState<SalesState>(() => (cached ? cached.value : null));
  useEffect(() => {
    let active = true;
    loadOnlineSales()
      .then((value) => active && setSales(value))
      .catch(() => active && setSales('failed'));
    return () => {
      active = false;
    };
  }, []);
  const reload = useCallback(async (): Promise<SalesState> => {
    try {
      const value = await loadOnlineSales(true);
      setSales(value);
      return value;
    } catch {
      setSales('failed');
      return 'failed';
    }
  }, []);
  return { sales, reload };
}

/*
 * One cart count for the whole page (react-best-practices client-swr-dedup): the header cart and the phone's account menu both show
 * it, so they share one read, one in-flight request and one CART_CHANGED listener instead of two of each.
 */
let cartLines: number | null = null;
let cartApi: ApiClient | null = null;
let cartRead: Promise<void> | null = null;
const cartListeners = new Set<(count: number | null) => void>();

function readCartLines(api: ApiClient): Promise<void> {
  if (cartRead) return cartRead;
  cartRead = api
    .get<OnlineCartResponse>('/api/v1/me/cart', {}, { passive: true })
    .then((cart) => {
      cartLines = cart.lines.length;
      for (const listener of cartListeners) listener(cartLines);
    })
    .catch(() => undefined)
    .finally(() => {
      cartRead = null;
    });
  return cartRead;
}

function cartChanged(): void {
  if (cartApi) void readCartLines(cartApi);
}

/** The number of lines in the member's cart for the header; `null` until known or when nobody is signed in. */
export function useCartLineCount(enabled: boolean): number | null {
  const { api, signedIn } = useSiteSession();
  const active = signedIn && enabled;
  const [count, setCount] = useState<number | null>(() => (active ? cartLines : null));
  // Forget the last member's count while nobody is signed in, so the next sign-in never shows it.
  if (!active && count !== null) setCount(null);
  useEffect(() => {
    if (!active) return undefined;
    cartListeners.add(setCount);
    if (cartListeners.size === 1) {
      cartApi = api;
      window.addEventListener(CART_CHANGED, cartChanged);
    }
    void readCartLines(api);
    return () => {
      cartListeners.delete(setCount);
      if (cartListeners.size === 0) {
        window.removeEventListener(CART_CHANGED, cartChanged);
        cartApi = null;
        cartLines = null;
      }
    };
  }, [api, active]);
  // Signed out or switched off: no count (derived, not reset in an effect).
  return active ? count : null;
}

/** True when online ordering is open (the public settings say so). */
export function isOpen(sales: SalesState): sales is OnlineSalesPublicResponse {
  return sales !== null && sales !== 'failed' && sales.enabled;
}
