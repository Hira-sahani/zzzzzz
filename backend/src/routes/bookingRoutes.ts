import { Router } from 'express';
import * as bookingController from '../controllers/bookingController';
import * as cleanerController from '../controllers/cleanerController';
import * as ratingController from '../controllers/ratingController';
import { authenticateToken } from '../middleware/auth';
import { createBookingValidation, createRatingValidation } from '../middleware/validation';

const router = Router();

// All booking routes require authentication
router.use(authenticateToken);

// POST /api/v1/bookings - Create new booking (customer only)
router.post('/', createBookingValidation, bookingController.createBooking);

// GET /api/v1/bookings - Get user's bookings
router.get('/', bookingController.getBookings);

// GET /api/v1/bookings/:id - Get booking details
router.get('/:id', bookingController.getBookingById);

// PUT /api/v1/bookings/:id/cancel - Cancel booking
router.put('/:id/cancel', bookingController.cancelBooking);

// PUT /api/v1/bookings/:id/status - Update booking status (cleaner only)
router.put('/:id/status', cleanerController.updateBookingStatus);

// POST /api/v1/bookings/:id/rate - Rate booking
router.post('/:id/rate', createRatingValidation, ratingController.rateBooking);

export default router;
