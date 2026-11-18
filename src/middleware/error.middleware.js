import { Prisma } from '@prisma/client';
import multer from 'multer';
import { ApiError } from '../utils/errors.js';
import { env } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: 'Resource not found',
    errorCode: 'NOT_FOUND',
  });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ApiError) {
    const body = {
      success: false,
      message: error.message,
      errorCode: error.errorCode,
    };
    if (error.errorCode === 'VALIDATION_ERROR' && error.details) {
      body.details = error.details;
    }
    res.status(error.statusCode).json(body);
    return;
  }

  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    const maxMb = Math.max(1, Math.round(env.WORKSHEET_MAX_BYTES / (1024 * 1024)));
    res.status(tooLarge ? 413 : 400).json({
      success: false,
      message: tooLarge ? `PDF must be ${maxMb} MB or smaller` : 'Upload could not be processed',
      errorCode: tooLarge ? 'FILE_TOO_LARGE' : 'INVALID_UPLOAD',
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res.status(409).json({
      success: false,
      message: 'Duplicate record',
      errorCode: 'DUPLICATE',
    });
    return;
  }

  console.error(error);
  const prismaCode = typeof error?.code === 'string' ? error.code : '';
  const lines = String(error?.message || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const detail = lines.find((line) => /default value|denied|does not exist|Unknown column|Data too long|cannot be null|foreign key|Can't reach database/i.test(line));
  const raw = lines.join(' ');
  const safeLine = raw
    && raw.length <= 180
    && !/mysql:\/\//i.test(raw)
    && !/prisma/i.test(raw)
    && !/secret|password|token/i.test(raw)
    ? raw
    : '';
  res.status(500).json({
    success: false,
    message: detail || safeLine || (prismaCode ? `Database request failed (${prismaCode})` : 'Database request failed'),
    errorCode: prismaCode || 'DATABASE_TRANSACTION_FAILED',
  });
}
