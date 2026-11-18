import { z } from 'zod';

const token = z.string().trim().min(1).max(200);
const weekNumber = z.number().int().min(1).max(8);
const optionalRating = z.number().int().min(1).max(10).nullable().optional();

function portalRequest(params, body = z.object({}).strict()) {
  return z.object({
    body,
    params,
    query: z.object({}).passthrough(),
  });
}

export const portalTokenSchema = portalRequest(z.object({ token }).passthrough());

export const portalWeekSchema = portalRequest(z.object({
  token,
  weekNumber: z.coerce.number().int().min(1).max(8),
}).passthrough());

export const portalFileSchema = portalRequest(z.object({
  token,
  fileId: z.coerce.number().int().positive(),
}).passthrough());

export const ratingDraftSchema = portalRequest(
  z.object({ token }).passthrough(),
  z.object({
    weekNumber,
    desireRating: optionalRating,
    happinessRating: optionalRating,
    connectionRating: optionalRating,
  }).strict(),
);

export const ratingSubmitSchema = portalRequest(
  z.object({ token }).passthrough(),
  z.object({
    weekNumber,
    desireRating: z.number().int().min(1).max(10),
    happinessRating: z.number().int().min(1).max(10),
    connectionRating: z.number().int().min(1).max(10),
    edit: z.boolean().optional(),
  }).strict(),
);

export const checklistSchema = portalRequest(
  z.object({ token }).passthrough(),
  z.object({
    weekNumber,
    itemKey: z.string().trim().min(1).max(80),
    completed: z.boolean(),
  }).strict(),
);

export const uploadSchema = portalRequest(
  z.object({ token }).passthrough(),
  z.object({
    weekNumber: z.coerce.number().int().min(1).max(8),
    worksheetKey: z.string().trim().min(1).max(80),
  }).strict(),
);

const participantParams = z.object({
  participantId: z.coerce.number().int().positive(),
}).passthrough();

export const adminParticipantSchema = z.object({
  body: z.object({}).passthrough(),
  params: participantParams,
  query: z.object({}).passthrough(),
});

export const adminFileSchema = z.object({
  body: z.object({}).passthrough(),
  params: participantParams.extend({
    fileId: z.coerce.number().int().positive(),
  }),
  query: z.object({}).passthrough(),
});
