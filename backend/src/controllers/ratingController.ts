import { Request, Response } from 'express';
import { query } from '../config/database';
import { logger } from '../utils/logger';
import { calculateNewAverage } from '../utils/helpers';

/**
 * Rate booking (customer rates cleaner or vice versa)
 * POST /api/v1/bookings/:id/rate
 */
export async function rateBooking(req: Request, res: Response): Promise<void> {
  try {
    const bookingId = parseInt(req.params.id);
    const raterId = req.user!.userId;
    const userType = req.user!.userType;
    const {
      rating,
      review,
      timelinessRating,
      qualityRating,
      professionalismRating,
      tip,
      notes
    } = req.body;

    // Get booking
    const bookings = await query('SELECT * FROM bookings WHERE id = ?', [bookingId]);

    if (bookings.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Booking not found',
        code: 'NOT_FOUND'
      });
      return;
    }

    const booking = bookings[0];

    // Check if booking is completed
    if (booking.status !== 'completed') {
      res.status(400).json({
        success: false,
        error: 'Can only rate completed bookings',
        code: 'BOOKING_NOT_COMPLETED'
      });
      return;
    }

    // Check authorization and determine who is being rated
    let ratedId: number;

    if (userType === 'customer' && booking.customer_id === raterId) {
      // Customer rating cleaner
      if (!booking.cleaner_id) {
        res.status(400).json({
          success: false,
          error: 'No cleaner assigned to this booking',
          code: 'NO_CLEANER'
        });
        return;
      }
      ratedId = booking.cleaner_id;
    } else if (userType === 'cleaner' && booking.cleaner_id === raterId) {
      // Cleaner rating customer
      ratedId = booking.customer_id;
    } else {
      res.status(403).json({
        success: false,
        error: 'Not authorized to rate this booking',
        code: 'FORBIDDEN'
      });
      return;
    }

    // Check if already rated
    const existingRatings = await query(
      'SELECT * FROM ratings WHERE booking_id = ? AND rater_id = ?',
      [bookingId, raterId]
    );

    if (existingRatings.length > 0) {
      res.status(400).json({
        success: false,
        error: 'You have already rated this booking',
        code: 'ALREADY_RATED'
      });
      return;
    }

    // Insert rating
    await query(
      `INSERT INTO ratings (booking_id, rater_id, rated_id, rating, review_text,
       timeliness_rating, quality_rating, professionalism_rating)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bookingId,
        raterId,
        ratedId,
        rating,
        userType === 'customer' ? review || null : notes || null,
        userType === 'customer' ? timelinessRating || null : null,
        userType === 'customer' ? qualityRating || null : null,
        userType === 'customer' ? professionalismRating || null : null
      ]
    );

    // Update rated user's average rating
    const ratedUser = await query('SELECT rating_average, total_ratings FROM users WHERE id = ?', [
      ratedId
    ]);
    const newAverage = calculateNewAverage(
      ratedUser[0].rating_average,
      ratedUser[0].total_ratings,
      rating
    );

    await query(
      'UPDATE users SET rating_average = ?, total_ratings = total_ratings + 1 WHERE id = ?',
      [newAverage, ratedId]
    );

    // Handle tip if provided (customer only)
    if (userType === 'customer' && tip && tip > 0) {
      // TODO: Process tip payment via Stripe
      await query(
        `INSERT INTO transactions (booking_id, user_id, transaction_type, amount, payment_method, status, description)
         VALUES (?, ?, 'tip', ?, 'stripe', 'pending', 'Tip for cleaner')`,
        [bookingId, ratedId, tip]
      );

      logger.info(`Tip of ${tip} added for cleaner ${ratedId} on booking ${bookingId}`);
    }

    res.status(201).json({
      success: true,
      message: 'Rating submitted successfully'
    });

    logger.info(`Booking ${bookingId} rated by user ${raterId}`);
  } catch (error: any) {
    logger.error('Rate booking error:', error);

    // Check for duplicate rating error
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({
        success: false,
        error: 'You have already rated this booking',
        code: 'ALREADY_RATED'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to submit rating',
      code: 'RATING_FAILED'
    });
  }
}
