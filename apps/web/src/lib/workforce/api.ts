/**
 * The workforce area's name for the shared API client (`lib/api/client`). One client serves
 * the workforce and customer areas; nothing is duplicated.
 */
export {
  ACTIVITY_HEADER,
  ApiClient as WorkforceApi,
  type DownloadedFile,
  ApiError,
  type ApiClientOptions as WorkforceApiOptions,
  type Query,
  type RequestOptions,
} from '../api/client';
