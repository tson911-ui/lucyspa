import { SetMetadata } from '@nestjs/common';

export const MULTIPART_UPLOAD = 'lucy:multipart-upload';

/**
 * Marks ONE controller route as a browser file upload (design 16.3). It changes a single rule of the global
 * CSRF guard: the body is `multipart/form-data` instead of JSON. Origin, Sec-Fetch-Site, the signed-in session
 * and the CSRF token are still required, and it is declared on the handler (never a path pattern). The route
 * must bound the body itself (file size, file and field counts).
 */
export const MultipartUpload = () => SetMetadata(MULTIPART_UPLOAD, true);

export const isMultipartContentType = (value: string): boolean =>
  /^multipart\/form-data\s*;\s*boundary=[^\s;]+\s*$/i.test(value);
