const express = require('express');
const { body } = require('express-validator');
const reviewController = require('../controllers/reviewController');
const { handleValidationErrors } = require('../middleware/validation');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const strictLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  message: { success: false, error: 'Слишком много попыток' }
});

router.post('/',
  strictLimiter,
  [
    body('rating').isInt({ min: 1, max: 5 }),
    body('name').isString().trim().isLength({ min: 2, max: 120 }),
    body('contact').isString().trim().isLength({ min: 3, max: 160 }),
    body('message').isString().trim().isLength({ min: 10, max: 2000 }),
    handleValidationErrors
  ],
  reviewController.createReview
);

router.get('/', reviewController.getReviews);

module.exports = router;
