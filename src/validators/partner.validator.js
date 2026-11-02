import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().email().max(255);

export const inviteShownSchema = z.object({
  body: z.object({
    kajabiUserId: z.string().trim().min(1).max(255),
  }).strict(),
  params: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
});

export const linkPartnerSchema = z.object({
  body: z.object({
    partnerName: z.string().trim().min(1).max(150),
    partnerEmail: emailSchema,
    purchaserEmail: emailSchema.optional(),
    purchaserUserId: z.coerce.number().int().positive().optional(),
  }).strict(),
  params: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
});
