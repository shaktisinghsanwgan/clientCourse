import { z } from 'zod';

const weekNumber = z.coerce.number().int();
const chapterId = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

const chapterInput = z.object({
  weekNumber,
  chapterId,
  chapterName: z.string().trim().min(1).max(255),
  chapterOrder: z.number().int().positive(),
  isActive: z.boolean().optional(),
}).strict();

export const createChapterSchema = z.object({
  body: chapterInput,
  params: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
});

export const updateChapterSchema = z.object({
  body: z.object({
    weekNumber: weekNumber.optional(),
    chapterName: z.string().trim().min(1).max(255).optional(),
    chapterOrder: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
  }).strict(),
  params: z.object({ chapterId }).passthrough(),
  query: z.object({}).passthrough(),
});

export const activeChapterSchema = z.object({
  body: z.object({
    isActive: z.boolean(),
  }).strict(),
  params: z.object({ chapterId }).passthrough(),
  query: z.object({}).passthrough(),
});

export const syncChaptersSchema = z.object({
  body: z.object({
    chapters: z.array(chapterInput).min(1).max(500),
  }).strict(),
  params: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
});

export const weekParamSchema = z.object({
  body: z.object({}).passthrough(),
  params: z.object({
    weekNumber,
  }).passthrough(),
  query: z.object({}).passthrough(),
});

export const progressByNameSchema = z.object({
  body: z.object({
    userId: z.coerce.number().int().positive(),
    chapters: z.array(z.object({
      chapterName: z.string().trim().min(1).max(255),
      completed: z.boolean().optional(),
    }).strict()).min(1).max(50),
  }).strict(),
  params: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
});

export const completeChapterSchema = z.object({
  body: z.object({
    chapterId,
    completed: z.boolean(),
  }).strict(),
  params: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
});
