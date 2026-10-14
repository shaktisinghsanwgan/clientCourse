import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().email().max(255);
const nameSchema = z.string().trim().min(1).max(150);

export const registerSchema = z.object({
  body: z.object({
    name: nameSchema,
    email: emailSchema,
    kajabiCustomerId: z.string().trim().min(1).max(255).optional(),
    purchaseReference: z.string().trim().min(1).max(255).optional(),
    offerReference: z.string().trim().min(1).max(255).optional(),
  }).strict(),
  params: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
});

export const syncUserSchema = z.object({
  body: z.object({
    kajabiCustomerId: z.string().trim().min(1).max(255).optional(),
  }).strict(),
  params: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
});

export const userIdParamSchema = z.object({
  body: z.object({}).passthrough(),
  params: z.object({
    userId: z.coerce.number().int().positive(),
  }).passthrough(),
  query: z.object({}).passthrough(),
});

export const updateUserSchema = z.object({
  body: z.object({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
  }).strict().refine((value) => value.name || value.email, {
    message: 'Name or email is required',
  }),
  params: z.object({
    userId: z.coerce.number().int().positive(),
  }).passthrough(),
  query: z.object({}).passthrough(),
});

export const lookupSchema = z.object({
  body: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
  query: z.object({
    kajabiUserId: z.string().trim().min(1).max(255),
  }).passthrough(),
});

export const bindSchema = z.object({
  body: z.object({
    name: nameSchema.optional(),
    email: emailSchema,
    kajabiUserId: z.string().trim().min(1).max(255),
  }).strict(),
  params: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
});

export const loginSchema = z.object({
  body: z.object({
    email: emailSchema,
  }).strict(),
  params: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
});
