import { Request, Response } from 'express';
import { query } from '../config/database';
import { logger } from '../utils/logger';
import {
  generateBookingNumber,
  calculateBookingFinancials,
  calculateDistance
} from '../utils/helpers';
import { createPaymentIntent, getPublishableKey } from '../services/paymentService';
import { sendSMSNotification, sendPushNotification } from '../services/notificationService';
import {
  sendBookingConfirmationSMS,
  sendCleanerAssignedSMS,
  sendCancellationSMS
} from '../services/smsService';

/**
 * Create new booking
 * POST /api/v1/bookings
 */
export async function createBooking(req: Request, res: Response): Promise<void> {
  try {
    const customerId = req.user!.userId;
    const {
      bookingType,
      scheduledDate,
      scheduledTime,
      addressId,
      serviceIds,
      specialInstructions,
      paymentMethod
    } = req.body;

    // Validate address belongs to user
    const addresses = await query('SELECT * FROM addresses WHERE id = ? AND user_id = ?', [
      addressId,
      customerId
    ]);

    if (addresses.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Address not found',
        code: 'ADDRESS_NOT_FOUND'
      });
      return;
    }

    const address = addresses[0];

    // Validate all services exist and are active
    const services = await query(
      `SELECT * FROM services WHERE id IN (${serviceIds.map(() => '?').join(',')}) AND is_active = true`,
      serviceIds
    );

    if (services.length !== serviceIds.length) {
      res.status(400).json({
        success: false,
        error: 'One or more services are invalid or unavailable',
        code: 'INVALID_SERVICES'
      });
      return;
    }

    // Calculate totals
    const totalAmount = services.reduce((sum: number, service: any) => sum + parseFloat(service.price), 0);

    // Get platform fee percentage from settings
    const settings = await query(
      "SELECT setting_value FROM platform_settings WHERE setting_key = 'platform_fee_percentage'"
    );
    const platformFeePercentage = settings.length > 0 ? parseFloat(settings[0].setting_value) : 15;

    const { platformFee, cleanerEarnings } = calculateBookingFinancials(totalAmount, platformFeePercentage);

    // Generate booking number
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const bookingsToday = await query(
      "SELECT COUNT(*) as count FROM bookings WHERE DATE(created_at) = CURDATE()"
    );
    const sequenceNumber = bookingsToday[0].count + 1;
    const bookingNumber = generateBookingNumber(sequenceNumber);

    // Create address snapshot
    const addressSnapshot = {
      addressLine1: address.address_line1,
      addressLine2: address.address_line2,
      city: address.city,
      state: address.state,
      postalCode: address.postal_code,
      country: address.country,
      latitude: address.latitude,
      longitude: address.longitude,
      landmark: address.landmark,
      specialInstructions: address.special_instructions
    };

    // Create Stripe payment intent if needed
    let stripePaymentIntentId = null;
    let clientSecret = null;

    if (paymentMethod === 'stripe') {
      const paymentResult = await createPaymentIntent(totalAmount, 'inr', {
        booking_number: bookingNumber,
        customer_id: customerId.toString()
      });

      if (!paymentResult.success) {
        res.status(500).json({
          success: false,
          error: 'Failed to create payment intent',
          code: 'PAYMENT_FAILED'
        });
        return;
      }

      stripePaymentIntentId = paymentResult.paymentIntentId;
      clientSecret = paymentResult.clientSecret;
    }

    // Insert booking
    const bookingResult = await query(
      `INSERT INTO bookings (booking_number, customer_id, booking_type, status, scheduled_date, scheduled_time,
       address_id, address_snapshot, special_instructions, total_amount, platform_fee, cleaner_earnings,
       payment_method, payment_status, stripe_payment_intent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bookingNumber,
        customerId,
        bookingType,
        'pending',
        bookingType === 'scheduled' ? scheduledDate : null,
        bookingType === 'scheduled' ? scheduledTime : null,
        addressId,
        JSON.stringify(addressSnapshot),
        specialInstructions || null,
        totalAmount,
        platformFee,
        cleanerEarnings,
        paymentMethod,
        'pending',
        stripePaymentIntentId
      ]
    );

    const bookingId = bookingResult.insertId;

    // Insert booking services
    for (const service of services) {
      await query(
        `INSERT INTO booking_services (booking_id, service_id, service_name, service_price, estimated_duration_minutes)
         VALUES (?, ?, ?, ?, ?)`,
        [bookingId, service.id, service.name, service.price, service.estimated_duration_minutes]
      );
    }

    // Send confirmation SMS
    const customer = await query('SELECT * FROM users WHERE id = ?', [customerId]);
    await sendBookingConfirmationSMS(
      customer[0].phone,
      bookingNumber,
      services.map((s: any) => s.name),
      totalAmount
    );

    // If instant booking, trigger cleaner matching
    if (bookingType === 'instant') {
      // This would normally be async, but for simplicity we'll just log it
      logger.info(`Starting cleaner matching for instant booking ${bookingId}`);
      // matchCleanerForBooking(bookingId, address.latitude, address.longitude);
    }

    // Prepare response
    const response: any = {
      success: true,
      booking: {
        id: bookingId,
        bookingNumber: bookingNumber,
        bookingType: bookingType,
        status: 'pending',
        services: services.map((s: any) => ({
          name: s.name,
          price: parseFloat(s.price),
          duration: s.estimated_duration_minutes
        })),
        address: addressSnapshot,
        totalAmount: totalAmount,
        platformFee: platformFee,
        cleanerEarnings: cleanerEarnings,
        paymentMethod: paymentMethod,
        paymentStatus: 'pending',
        createdAt: new Date().toISOString()
      }
    };

    if (paymentMethod === 'stripe' && clientSecret) {
      response.stripePaymentIntent = {
        clientSecret: clientSecret,
        publishableKey: getPublishableKey()
      };
    }

    res.status(201).json(response);

    logger.info(`Booking created: ${bookingNumber}`);
  } catch (error) {
    logger.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create booking',
      code: 'BOOKING_FAILED'
    });
  }
}

/**
 * Get user's bookings
 * GET /api/v1/bookings
 */
export async function getBookings(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const userType = req.user!.userType;
    const status = req.query.status as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    let sql = '';
    let countSql = '';
    let params: any[] = [];

    if (userType === 'customer') {
      sql = `
        SELECT b.*, u.name as cleaner_name, u.profile_photo_url as cleaner_photo, u.rating_average as cleaner_rating
        FROM bookings b
        LEFT JOIN users u ON b.cleaner_id = u.id
        WHERE b.customer_id = ?
      `;
      countSql = 'SELECT COUNT(*) as total FROM bookings WHERE customer_id = ?';
      params.push(userId);
    } else if (userType === 'cleaner') {
      sql = `
        SELECT b.*, u.name as customer_name, u.phone as customer_phone
        FROM bookings b
        LEFT JOIN users u ON b.customer_id = u.id
        WHERE b.cleaner_id = ?
      `;
      countSql = 'SELECT COUNT(*) as total FROM bookings WHERE cleaner_id = ?';
      params.push(userId);
    } else {
      res.status(403).json({
        success: false,
        error: 'Invalid user type',
        code: 'FORBIDDEN'
      });
      return;
    }

    if (status) {
      sql += ' AND b.status = ?';
      countSql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const bookings = await query(sql, params);

    // Get total count
    const countResult = await query(countSql, params.slice(0, status ? 2 : 1));
    const total = countResult[0].total;

    // Get services for each booking
    for (const booking of bookings) {
      const services = await query(
        'SELECT service_name as name, service_price as price FROM booking_services WHERE booking_id = ?',
        [booking.id]
      );
      booking.services = services;
      booking.address = JSON.parse(booking.address_snapshot);
    }

    res.status(200).json({
      success: true,
      bookings: bookings,
      pagination: {
        total: total,
        page: page,
        limit: limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bookings',
      code: 'FETCH_FAILED'
    });
  }
}

/**
 * Get booking by ID
 * GET /api/v1/bookings/:id
 */
export async function getBookingById(req: Request, res: Response): Promise<void> {
  try {
    const bookingId = parseInt(req.params.id);
    const userId = req.user!.userId;
    const userType = req.user!.userType;

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

    // Check authorization
    if (
      userType === 'customer' &&
      booking.customer_id !== userId
    ) {
      res.status(403).json({
        success: false,
        error: 'Not authorized to view this booking',
        code: 'FORBIDDEN'
      });
      return;
    }

    if (
      userType === 'cleaner' &&
      booking.cleaner_id !== userId
    ) {
      res.status(403).json({
        success: false,
        error: 'Not authorized to view this booking',
        code: 'FORBIDDEN'
      });
      return;
    }

    // Get services
    const services = await query(
      `SELECT service_name as name, service_price as price, estimated_duration_minutes as duration, is_completed as isCompleted
       FROM booking_services WHERE booking_id = ?`,
      [bookingId]
    );

    // Get customer and cleaner details
    const customer = await query('SELECT id, name, phone, profile_photo_url as photo FROM users WHERE id = ?', [
      booking.customer_id
    ]);

    let cleaner = null;
    if (booking.cleaner_id) {
      const cleaners = await query(
        'SELECT id, name, phone, profile_photo_url as photo, rating_average as rating, current_latitude as currentLatitude, current_longitude as currentLongitude FROM users WHERE id = ?',
        [booking.cleaner_id]
      );
      cleaner = cleaners[0];
    }

    // Get photos
    const photos = await query('SELECT photo_url as url, photo_type as type FROM job_photos WHERE booking_id = ?', [
      bookingId
    ]);

    // Get ratings
    const ratings = await query('SELECT * FROM ratings WHERE booking_id = ?', [bookingId]);
    const customerRating = ratings.find((r: any) => r.rater_id === booking.customer_id);
    const cleanerRating = ratings.find((r: any) => r.rater_id === booking.cleaner_id);

    const response = {
      success: true,
      booking: {
        id: booking.id,
        bookingNumber: booking.booking_number,
        bookingType: booking.booking_type,
        status: booking.status,
        services: services,
        address: JSON.parse(booking.address_snapshot),
        customer: customer[0],
        cleaner: cleaner,
        totalAmount: parseFloat(booking.total_amount),
        platformFee: parseFloat(booking.platform_fee),
        cleanerEarnings: parseFloat(booking.cleaner_earnings),
        paymentMethod: booking.payment_method,
        paymentStatus: booking.payment_status,
        timeline: {
          created: booking.created_at,
          assigned: booking.assigned_at,
          accepted: booking.accepted_at,
          started: booking.started_at,
          completed: booking.completed_at
        },
        photos: photos,
        ratings: {
          customerRating: customerRating || null,
          cleanerRating: cleanerRating || null
        }
      }
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error('Get booking by ID error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch booking',
      code: 'FETCH_FAILED'
    });
  }
}

/**
 * Cancel booking
 * PUT /api/v1/bookings/:id/cancel
 */
export async function cancelBooking(req: Request, res: Response): Promise<void> {
  try {
    const bookingId = parseInt(req.params.id);
    const userId = req.user!.userId;
    const userType = req.user!.userType;
    const { reason } = req.body;

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

    // Check authorization
    if (userType === 'customer' && booking.customer_id !== userId) {
      res.status(403).json({
        success: false,
        error: 'Not authorized to cancel this booking',
        code: 'FORBIDDEN'
      });
      return;
    }

    // Check if cancellation is allowed
    if (['in_progress', 'completed', 'cancelled'].includes(booking.status)) {
      res.status(400).json({
        success: false,
        error: 'Cannot cancel booking in current status',
        code: 'INVALID_STATUS'
      });
      return;
    }

    // Update booking status
    await query(
      'UPDATE bookings SET status = ?, cancelled_at = NOW(), cancelled_by = ?, cancellation_reason = ? WHERE id = ?',
      [booking.status, userType, reason || null, bookingId]
    );

    // Handle refund if payment was made via Stripe
    let refundAmount = 0;
    if (booking.payment_method === 'stripe' && booking.stripe_payment_intent_id) {
      // TODO: Process refund via Stripe
      refundAmount = parseFloat(booking.total_amount);
      logger.info(`Refund should be processed for booking ${bookingId}`);
    }

    // Notify cleaner if assigned
    if (booking.cleaner_id) {
      const cleaner = await query('SELECT phone FROM users WHERE id = ?', [booking.cleaner_id]);
      await sendCancellationSMS(cleaner[0].phone, booking.booking_number, 'Customer cancelled the booking');
    }

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      refundAmount: refundAmount
    });

    logger.info(`Booking cancelled: ${booking.booking_number}`);
  } catch (error) {
    logger.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel booking',
      code: 'CANCEL_FAILED'
    });
  }
}
