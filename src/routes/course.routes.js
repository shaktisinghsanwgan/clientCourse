import { Router } from 'express';
import { authenticateUnlessPurchaserEmail } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { purchaserEmailQuerySchema } from '../validators/progress.validator.js';
import { asyncHandler } from '../utils/errors.js';
import * as courseController from '../controllers/course.controller.js';

const router = Router();

router.get('/', authenticateUnlessPurchaserEmail, validate(purchaserEmailQuerySchema), asyncHandler(courseController.showCourse));
router.get('/sync', authenticateUnlessPurchaserEmail, validate(purchaserEmailQuerySchema), asyncHandler(courseController.syncCourse));

export default router;
