import { Router } from 'express';
import { authenticateAdmin } from '../middleware/admin.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { asyncHandler } from '../utils/errors.js';
import { adminFileSchema, adminParticipantSchema } from '../validators/worksheet.validator.js';
import * as adminWorksheetController from '../controllers/admin-worksheet.controller.js';

const router = Router();

router.use(authenticateAdmin);
router.post('/portal-links/sync', asyncHandler(adminWorksheetController.syncPortalLinks));
router.get('/participants', asyncHandler(adminWorksheetController.listParticipants));
router.get('/participants/:participantId/files/:fileId', validate(adminFileSchema), asyncHandler(adminWorksheetController.downloadParticipantWorksheet));
router.get('/participants/:participantId/ratings', validate(adminParticipantSchema), asyncHandler(adminWorksheetController.showParticipantRatings));
router.get('/participants/:participantId/worksheets', validate(adminParticipantSchema), asyncHandler(adminWorksheetController.showParticipantWorksheets));
router.get('/participants/:participantId', validate(adminParticipantSchema), asyncHandler(adminWorksheetController.showParticipant));

export default router;
