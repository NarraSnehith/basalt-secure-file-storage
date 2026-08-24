import { z } from 'zod';
import { uuid } from '../../lib/http.js';

const futureDate = z.coerce
  .date()
  .refine((d) => d.getTime() > Date.now() + 30_000, 'Pick a time in the future.')
  .refine((d) => d.getTime() < Date.now() + 365 * 86_400_000 * 2, 'Expiry cannot be more than two years out.');

export const sharePassword = z
  .string()
  .min(6, 'Use at least 6 characters.')
  .max(128, 'Keep it under 128 characters.');

export const createShareSchema = z.object({
  fileId: uuid,
  label: z.string().trim().max(80).nullish(),
  password: sharePassword.nullish(),
  expiresAt: futureDate.nullish(),
  maxDownloads: z.coerce.number().int().min(1).max(1_000_000).nullish(),
  allowPreview: z.boolean().default(true),
});

export const updateShareSchema = z
  .object({
    label: z.string().trim().max(80).nullish(),
    password: sharePassword.nullable().optional(),
    expiresAt: futureDate.nullable().optional(),
    maxDownloads: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    allowPreview: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');

export const unlockSchema = z.object({
  password: z.string().min(1, 'Enter the password.').max(200),
});

export const slugParams = z.object({
  slug: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Not a valid link.'),
});
