import type { AuthEnvironment } from '@lucy-spa/server';
import type { Response } from 'express';
import { capabilityDigest } from './crypto.js';

export function sessionCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined || header.length > 8_192) return undefined;
  const values = header.split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    return separator !== -1 && part.slice(0, separator).trim() === name
      ? [part.slice(separator + 1).trim()]
      : [];
  });
  const value = values[0];
  return values.length === 1 && value !== undefined && capabilityDigest(value) !== null
    ? value
    : undefined;
}

export function setSessionCookie(response: Response, config: AuthEnvironment, token: string): void {
  if (capabilityDigest(token) === null) throw new Error('Invalid session capability');
  response.append('Set-Cookie', `${config.cookieName}=${token}; ${attributes(config)}`);
}

export function clearSessionCookie(response: Response, config: AuthEnvironment): void {
  response.append('Set-Cookie', `${config.cookieName}=; ${attributes(config)}; Max-Age=0`);
}

function attributes(config: AuthEnvironment): string {
  return `Path=/; HttpOnly; SameSite=Lax${config.cookieSecure ? '; Secure' : ''}`;
}
