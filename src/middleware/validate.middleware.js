import { ApiError } from '../utils/errors.js';

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({
      body: req.body ?? {},
      params: req.params ?? {},
      query: req.query ?? {},
    });

    if (!result.success) {
      next(new ApiError(400, 'Invalid request payload', 'VALIDATION_ERROR', result.error.flatten()));
      return;
    }

    req.valid = result.data;
    next();
  };
}
