import { Router } from 'express';
import * as bookingController from '../controllers/bookingController';
import { authenticateToken } from '../middleware/auth';
import { createBookingValidation } from '../middleware/validation';

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

export default router;
