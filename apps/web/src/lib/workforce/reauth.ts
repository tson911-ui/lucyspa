import type { ReauthenticateRequest } from '@lucy-spa/contracts';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError, type WorkforceApi } from './api';
import { errorMessage } from './workflows';

/**
 * Fresh reauthentication for sensitive workforce commands (credential provisioning and
 * resets). The API answers such a command with REAUTHENTICATION_REQUIRED when the signed-in
 * actor has not confirmed their own password recently; the actor then re-enters it,
 * `POST /auth/reauthenticate` rotates the session, and the command is sent once more.
 * The actor's password lives only in the dialog's state for that one request.
 */

/** The actor closed the confirmation without confirming: nothing was saved. */
export class ReauthenticationCancelled extends Error {
  constructor() {
    super('Reauthentication cancelled.');
    this.name = 'ReauthenticationCancelled';
  }
}

/** Asks the signed-in actor to confirm their password; true once confirmed, false if cancelled. */
export type ConfirmIdentity = () => Promise<boolean>;

export async function withReauthentication<T>(
  action: () => Promise<T>,
  confirm: ConfirmIdentity,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'REAUTHENTICATION_REQUIRED')) throw error;
  }
  if (!(await confirm())) throw new ReauthenticationCancelled();
  return action();
}

/** Confirms the current actor's own password; the rotated session needs a new CSRF token. */
export async function reauthenticate(api: WorkforceApi, password: string): Promise<void> {
  const body: ReauthenticateRequest = { password };
  await api.post<void>('/api/v1/auth/reauthenticate', body);
  await api.context();
}

export function reauthErrorMessage(error: unknown, t: WorkforceDictionary): string {
  if (error instanceof ApiError && error.code === 'AUTHENTICATION_FAILED') {
    return t.reauth.wrongPassword;
  }
  return errorMessage(error, t);
}
