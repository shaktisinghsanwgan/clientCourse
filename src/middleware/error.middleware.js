import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/errors.js';

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

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res.status(409).json({
      success: false,
      message: 'Duplicate record',
      errorCode: 'DUPLICATE',
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    success: false,
    message: 'Database transaction failure',
    errorCode: 'DATABASE_TRANSACTION_FAILED',
  });
}
