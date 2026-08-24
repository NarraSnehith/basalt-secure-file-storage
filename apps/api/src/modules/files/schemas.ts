import { z } from 'zod';
import { uuid } from '../../lib/http.js';

export const listQuerySchema = z.object({
  scope: z.enum(['folder', 'all', 'trash', 'starred', 'shared', 'recent']).default('folder'),
  folderId: uuid.nullish(),
  q: z.string().trim().max(200).optional(),
  kind: z.string().max(120).optional(),
  sort: z.enum(['name', 'size', 'created', 'updated']).default('created'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  cursor: z.string().max(500).optional(),
});

export const uploadFieldsSchema = z.object({
  folderId: z
    .string()
    .transform((v) => (v === '' || v === 'null' || v === 'root' ? null : v))
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || z.string().uuid().safeParse(v).success, 'folderId must be a valid id'),
  visibility: z.enum(['private', 'public']).default('private'),
  // 'version' keeps one file with a history; 'rename' is the old file-manager
  // behaviour of "report (2).pdf". Versioning is the better default — the
  // numbered-copy pile is the thing people complain about.
  onConflict: z.enum(['version', 'rename']).default('version'),
});

export const renameSchema = z.object({
  name: z.string().trim().min(1, 'Give the file a name.').max(255),
});

export const patchFileSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    folderId: uuid.nullish(),
    starred: z.boolean().optional(),
    visibility: z.enum(['private', 'public']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');

export const idsSchema = z.object({
  ids: z.array(uuid).min(1, 'Select at least one file.').max(500),
});

export const dispositionSchema = z.object({
  disposition: z.enum(['inline', 'attachment', 'auto']).default('auto'),
  /** Omit for the current revision. */
  version: z.coerce.number().int().min(1).max(100_000).optional(),
});
