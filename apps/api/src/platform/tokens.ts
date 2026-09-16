import type { parseApiEnvironment } from '@lucy-spa/server';

export type ApiEnvironment = ReturnType<typeof parseApiEnvironment>;
export const API_ENVIRONMENT = Symbol('API_ENVIRONMENT');
export const API_LOGGER = Symbol('API_LOGGER');
