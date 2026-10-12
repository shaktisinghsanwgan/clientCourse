import { z } from 'zod';

const purchaserEmail = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().email().optional(),
);

const optionalUserId = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

export const purchaserEmailQuerySchema = z.object({
  body: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
  query: z.object({
    purchaserEmail,
    userId: optionalUserId,
  }).passthrough(),
});

export const weekParamSchema = z.object({
  body: z.object({}).passthrough(),
  params: z.object({
    weekNumber: z.coerce.number().int(),
  }).passthrough(),
  query: z.object({}).passthrough(),
});
