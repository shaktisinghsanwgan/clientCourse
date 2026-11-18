import multer from 'multer';
import { env } from '../config/env.js';

export const worksheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.WORKSHEET_MAX_BYTES,
    files: 1,
  },
});
