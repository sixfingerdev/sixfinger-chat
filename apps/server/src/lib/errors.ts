import type { ErrorCode } from '@sixfinger/shared';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new HttpError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Oturum gerekli.') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Bu işlem için yetkin yok.') => new HttpError(403, 'forbidden', msg);
export const notFound = (msg = 'Bulunamadı.') => new HttpError(404, 'not_found', msg);
export const conflict = (msg: string) => new HttpError(409, 'conflict', msg);
export const tierRestricted = (msg: string) => new HttpError(403, 'tier_restricted', msg);
