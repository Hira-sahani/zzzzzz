import { Request, Response } from 'express';
import { query } from '../config/database';
import { logger } from '../utils/logger';
import { sendSMSNotification } from '../services/notificationService';

/**
 * Toggle cleaner availability
 * PUT /api/v1/cleaner/availability
 */
export async function updateAvailability(req: Request, res: Response): Promise<void> {
  try {
    const cleanerId = req.user!.userId;
    const { isAvailable, latitude, longitude } = req.body;

    if (isAvailable && (!latitude || !longitude)) {
      res.status(400).json({
        success: false,
        error: 'Location required when setting available',
        code: 'LOCATION_REQUIRED'
      });
      return;
    }

    // Update availability
    await query(
      `UPDATE users SET is_available = ?, current_latitude = ?, current_longitude = ?, last_location_update = NOW()
       WHERE id = ? AND user_type = 'cleaner'`,
      [isAvailable, isAvailable ? latitude : null, isAvailable ? longitude : null, cleanerId]
    );

    res.status(200).json({
      success: true,
      isAvailable: isAvailable,
      message: isAvailable ? 'You are now available for jobs' : 'You are now offline'
    });

    logger.info(`Cleaner ${cleanerId} availability updated: ${isAvailable}`);
  } catch (error) {
    logger.error('Update availability error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update availability',
      code: 'UPDATE_FAILED'
    });
  }
}

/**
 * Update cleaner location
 * PUT /api/v1/cleaner/location
 */
export async function updateLocation(req: Request, res: Response): Promise<void> {
  try {
    const cleanerId = req.user!.userId;
    const { latitude, longitude } = req.body;

    await query(
      'UPDATE users SET current_latitude = ?, current_longitude = ?, last_location_update = NOW() WHERE id = ? AND is_available = true',
      [latitude, longitude, cleanerId]
    );

    res.status(200).json({
      success: true,
      message: 'Location updated'
    });
  } catch (error) {
    logger.error('Update location error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update location',
      code: 'UPDATE_FAILED'
    });
  }
}

/**
 * Accept job request
 * POST /api/v1/cleaner/jobs/:bookingId/accept
 */
export async function acceptJob(req: Request, res: Response): Promise<void> {
  try {
    const cleanerId = req.user!.userId;
    const bookingId = parseInt(req.params.bookingId);

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

    // Check if booking is still available
    if (booking.status !== 'assigned' || booking.cleaner_id !== cleanerId) {
      res.status(400).json({
        success: false,
        error: 'Job no longer available',
        code: 'JOB_UNAVAILABLE'
      });
      return;
    }

    // Update booking status
    await query(
      'UPDATE bookings SET status = ?, accepted_at = NOW() WHERE id = ?',
      ['accepted', bookingId]
    );

    // Notify customer
    const customer = await query('SELECT phone FROM users WHERE id = ?', [booking.customer_id]);
    const cleaner = await query('SELECT name FROM users WHERE id = ?', [cleanerId]);

    // Send SMS notification
    const message = `Primo: ${cleaner[0].name} is on the way! Track them in the app.`;
    await sendSMSNotification(booking.customer_id, customer[0].phone, 'Cleaner Assigned', message, bookingId);

    // Get full booking details
    const services = await query(
      'SELECT service_name as name, service_price as price FROM booking_services WHERE booking_id = ?',
      [bookingId]
    );

    res.status(200).json({
      success: true,
      booking: {
        id: booking.id,
        bookingNumber: booking.booking_number,
        services: services,
        address: JSON.parse(booking.address_snapshot),
        specialInstructions: booking.special_instructions,
        totalAmount: parseFloat(booking.total_amount),
        cleanerEarnings: parseFloat(booking.cleaner_earnings)
      }
    });

    logger.info(`Cleaner ${cleanerId} accepted booking ${bookingId}`);
  } catch (error) {
    logger.error('Accept job error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to accept job',
      code: 'ACCEPT_FAILED'
    });
  }
}

/**
 * Decline job request
 * POST /api/v1/cleaner/jobs/:bookingId/decline
 */
export async function declineJob(req: Request, res: Response): Promise<void> {
  try {
    const cleanerId = req.user!.userId;
    const bookingId = parseInt(req.params.bookingId);

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

    // Check if this cleaner was assigned
    if (booking.cleaner_id !== cleanerId) {
      res.status(400).json({
        success: false,
        error: 'Job not assigned to you',
        code: 'JOB_NOT_ASSIGNED'
      });
      return;
    }

    // Reset booking assignment
    await query(
      'UPDATE bookings SET cleaner_id = NULL, assigned_at = NULL, status = ? WHERE id = ?',
      ['pending', bookingId]
    );

    // TODO: Trigger cleaner matching algorithm again to find next available cleaner

    res.status(200).json({
      success: true,
      message: 'Job declined, offering to next cleaner'
    });

    logger.info(`Cleaner ${cleanerId} declined booking ${bookingId}`);
  } catch (error) {
    logger.error('Decline job error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to decline job',
      code: 'DECLINE_FAILED'
    });
  }
}

/**
 * Update booking status (arrived, started, completed)
 * PUT /api/v1/bookings/:id/status
 */
export async function updateBookingStatus(req: Request, res: Response): Promise<void> {
  try {
    const cleanerId = req.user!.userId;
    const bookingId = parseInt(req.params.id);
    const { status, photos, notes } = req.body;

    // Get booking
    const bookings = await query('SELECT * FROM bookings WHERE id = ? AND cleaner_id = ?', [
      bookingId,
      cleanerId
    ]);

    if (bookings.length === 0) {
      res.status(403).json({
        success: false,
        error: 'Not authorized to update this booking',
        code: 'FORBIDDEN'
      });
      return;
    }

    const booking = bookings[0];

    // Validate status transition
    if (status === 'in_progress') {
      if (booking.status !== 'accepted') {
        res.status(400).json({
          success: false,
          error: 'Invalid status transition',
          code: 'INVALID_TRANSITION'
        });
        return;
      }
      await query('UPDATE bookings SET status = ?, started_at = NOW() WHERE id = ?', ['in_progress', bookingId]);

      // Notify customer
      const customer = await query('SELECT phone FROM users WHERE id = ?', [booking.customer_id]);
      const message = 'Primo: Your cleaner has started the service.';
      await sendSMSNotification(booking.customer_id, customer[0].phone, 'Service Started', message, bookingId);
    } else if (status === 'completed') {
      if (booking.status !== 'in_progress') {
        res.status(400).json({
          success: false,
          error: 'Invalid status transition',
          code: 'INVALID_TRANSITION'
        });
        return;
      }

      // Require photos
      if (!photos || photos.length < 2) {
        res.status(400).json({
          success: false,
          error: 'At least 2 photos required for completion',
          code: 'PHOTOS_REQUIRED'
        });
        return;
      }

      // Update booking
      await query(
        'UPDATE bookings SET status = ?, completed_at = NOW(), payment_status = ? WHERE id = ?',
        ['completed', booking.payment_method === 'stripe' ? 'paid' : 'pending', bookingId]
      );

      // Insert photos
      for (const photoUrl of photos) {
        await query(
          'INSERT INTO job_photos (booking_id, photo_url, photo_type) VALUES (?, ?, ?)',
          [bookingId, photoUrl, 'general']
        );
      }

      // Update cleaner stats
      await query(
        'UPDATE users SET total_jobs_completed = total_jobs_completed + 1 WHERE id = ?',
        [cleanerId]
      );

      // Notify customer
      const customer = await query('SELECT phone FROM users WHERE id = ?', [booking.customer_id]);
      const message = `Primo: Your service (${booking.booking_number}) is complete! Please rate your experience in the app.`;
      await sendSMSNotification(booking.customer_id, customer[0].phone, 'Service Completed', message, bookingId);

      logger.info(`Booking ${bookingId} completed by cleaner ${cleanerId}`);
    }

    res.status(200).json({
      success: true,
      booking: {
        id: booking.id,
        status: status
      }
    });
  } catch (error) {
    logger.error('Update booking status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update booking status',
      code: 'UPDATE_FAILED'
    });
  }
}
