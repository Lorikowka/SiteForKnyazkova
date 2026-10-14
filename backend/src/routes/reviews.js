/** Маршруты отзывов. */
import { z } from 'zod';

import { createReview, getReviews } from '../controllers/reviewController.js';
import { limitOptions } from '../middleware/rateLimit.js';
import { bodyValidator } from '../validation.js';

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  name: z.string().trim().min(2).max(120),
  contact: z.string().trim().min(3).max(160),
  message: z.string().trim().min(10).max(2000)
});

export default async function reviewRoutes(app) {
  app.post('/', {
    preHandler: bodyValidator(reviewSchema),
    config: limitOptions(10)
  }, createReview);

  app.get('/', getReviews);
}
