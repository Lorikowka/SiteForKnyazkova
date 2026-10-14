/** Репозиторий отзывов. */
import { all, run } from '../connection.js';

export function createReview(data) {
  return run(
    'INSERT INTO reviews (rating, name, contact, message, source) VALUES (?, ?, ?, ?, ?)',
    [data.rating, data.name, data.contact, data.message, data.source || 'site']
  );
}

export function getAllReviews(limit = 50, offset = 0) {
  return all('SELECT * FROM reviews ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
}
