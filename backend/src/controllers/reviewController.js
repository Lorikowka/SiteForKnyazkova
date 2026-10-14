/**
 * Отзывы с сайта.
 */
import db from '../db/index.js';
import { escapeTelegramHtml, sendTelegramNotification } from '../services/notifications.js';
import logger from '../utils/logger.js';

export async function createReview(request, reply) {
  const { rating, name, contact, message } = request.body || {};

  const sanitizedName = db.sanitizeInput(name);
  const sanitizedContact = db.sanitizeInput(contact);
  const sanitizedMessage = db.sanitizeInput(message);

  const result = db.createReview({
    rating: Number(rating),
    name: sanitizedName,
    contact: sanitizedContact,
    message: sanitizedMessage,
    source: 'site'
  });

  const reviewId = result.lastInsertRowid;

  await sendTelegramNotification([
    '⭐ <b>Новый отзыв с сайта</b>',
    '',
    `ID: ${reviewId}`,
    `Оценка: ${rating}/5`,
    `Имя: ${escapeTelegramHtml(sanitizedName)}`,
    `Контакт: ${escapeTelegramHtml(sanitizedContact)}`,
    `Отзыв: ${escapeTelegramHtml(sanitizedMessage)}`
  ].join('\n'));

  logger.info(`Review created: #${reviewId}, rating: ${rating}`);
  return reply.code(201).send({ success: true, id: Number(reviewId) });
}

export async function getReviews(request, reply) {
  const limit = Math.min(parseInt(request.query?.limit, 10) || 50, 100);
  const offset = Math.max(parseInt(request.query?.offset, 10) || 0, 0);
  return reply.send({ success: true, reviews: db.getAllReviews(limit, offset) });
}
