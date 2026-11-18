import { Router } from 'express';
import { ApiError, asyncHandler } from '../utils/errors.js';
import { validate } from '../middleware/validate.middleware.js';
import { worksheetUpload } from '../middleware/upload.middleware.js';
import {
  checklistSchema,
  portalFileSchema,
  portalLinkQuerySchema,
  portalTokenSchema,
  portalWeekSchema,
  ratingDraftSchema,
  ratingSubmitSchema,
  uploadSchema,
} from '../validators/worksheet.validator.js';
import * as worksheetController from '../controllers/worksheet.controller.js';

const router = Router();

function requireUpload(req, res, next) {
  if (!req.file) {
    next(new ApiError(400, 'A PDF file is required', 'FILE_REQUIRED'));
    return;
  }
  next();
}

router.get('/link', validate(portalLinkQuerySchema), asyncHandler(worksheetController.portalLink));
router.get('/:token/files/:fileId', validate(portalFileSchema), asyncHandler(worksheetController.downloadWorksheet));
router.delete('/:token/files/:fileId', validate(portalFileSchema), asyncHandler(worksheetController.removeWorksheet));
router.post(
  '/:token/files',
  worksheetUpload.single('file'),
  validate(uploadSchema),
  requireUpload,
  asyncHandler(worksheetController.uploadWorksheet),
);
router.post('/:token/ratings/draft', validate(ratingDraftSchema), asyncHandler(worksheetController.draftRating));
router.post('/:token/ratings/submit', validate(ratingSubmitSchema), asyncHandler(worksheetController.submitRating));
router.post('/:token/checklist', validate(checklistSchema), asyncHandler(worksheetController.updateChecklist));
router.get('/:token/weeks/:weekNumber', validate(portalWeekSchema), asyncHandler(worksheetController.showWeek));
router.get('/:token', validate(portalTokenSchema), asyncHandler(worksheetController.showPortal));

export default router;
