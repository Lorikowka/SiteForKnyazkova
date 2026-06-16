const db = require('../../database');
const logger = require('../utils/logger');
const { sendTelegramNotification } = require('../services/notificationService');

const createReview = async (req, res) => {
  try {
    const { rating, name, contact, message } = req.body;
    const sanitizedName = db.sanitizeInput(name);
    const sanitizedContact = db.sanitizeInput(contact);
    const sanitizedMessage = db.sanitizeInput(message);

    const review = await db.createReview({
      rating: Number(rating),
      name: sanitizedName,
      contact: sanitizedContact,
      message: sanitizedMessage,
      source: 'site'
    });

    await sendTelegramNotification([
      'Новый отзыв с сайта',
      `ID: ${review.id}`,
      `Оценка: ${rating}/5`,
      `Имя: ${sanitizedName}`,
      `Контакт: ${sanitizedContact}`,
      `Отзыв: ${sanitizedMessage}`
    ].join('\n'));

    logger.info(`Review created: #${review.id}, rating: ${rating}, contact: ${sanitizedContact}`);
    res.status(201).json({ success: true, id: review.id });
  } catch (error) {
    logger.error(`Review error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Не удалось отправить отзыв' });
  }
};

const getReviews = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const reviews = await db.getAllReviews(limit, offset);
    res.json({ success: true, reviews });
  } catch (error) {
    logger.error(`Get reviews error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Не удалось получить отзывы' });
  }
};

module.exports = { createReview, getReviews };
