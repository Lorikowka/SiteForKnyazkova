/**
 * Валидация входных данных на схемах zod.
 */
import { validationError } from './utils/errors.js';

/** Разбирает данные схемой; при ошибке бросает 400 со списком деталей. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    throw validationError(result.error.issues.map((issue) => issue.message));
  }
  return result.data;
}

/** Fastify-хук: валидирует тело запроса и заменяет его разобранным значением. */
export function bodyValidator(schema) {
  return async function validateBody(request) {
    request.body = parse(schema, request.body);
  };
}
