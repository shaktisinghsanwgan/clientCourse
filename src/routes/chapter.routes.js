import { Router } from 'express';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/errors.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  activeChapterSchema,
  completeChapterSchema,
  progressByNameSchema,
  createChapterSchema,
  syncChaptersSchema,
  updateChapterSchema,
  weekParamSchema,
} from '../validators/chapter.validator.js';
import * as chapterController from '../controllers/chapter.controller.js';

const router = Router();

router.post('/sync', authenticateAdmin, validate(syncChaptersSchema), asyncHandler(chapterController.sync));
router.post('/complete', authenticate, validate(completeChapterSchema), asyncHandler(chapterController.complete));
router.post('/progress', validate(progressByNameSchema), asyncHandler(chapterController.progressByName));
router.get('/week/:weekNumber', authenticate, validate(weekParamSchema), asyncHandler(chapterController.week));
router.post('/', authenticateAdmin, validate(createChapterSchema), asyncHandler(chapterController.create));
router.patch('/:chapterId/active', authenticateAdmin, validate(activeChapterSchema), asyncHandler(chapterController.setActive));
router.patch('/:chapterId', authenticateAdmin, validate(updateChapterSchema), asyncHandler(chapterController.update));

export default router;
