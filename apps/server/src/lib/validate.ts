import type { ZodTypeAny, z } from 'zod';
import { badRequest } from './errors.ts';

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path.join('.') || 'istek';
    throw badRequest(`Geçersiz değer (${where}): ${first?.message ?? 'doğrulama hatası'}`, r.error.issues);
  }
  return r.data;
}
