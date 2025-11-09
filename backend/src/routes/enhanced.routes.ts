import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import locationTrackingService from '../services/locationTracking.service';
import ratingService from '../services/rating.service';
import notificationService from '../services/notification.service';
import cancellationService from '../services/cancellation.service';

const router = Router();

// ============================================
// LOCATION TRACKING ROUTES
// ============================================

/**
 * POST /api/v1/location/track
 * Record cleaner location
 */
router.post('/location/track', authenticateToken, async (req: Request, res: Response) => {
  try {
    const cleanerId = (req as any).user.userId;
    const { latitude, longitude, accuracy, speed, heading, altitude, bookingId } = req.body;

    const locationId = await locationTrackingService.recordLocation(
      cleanerId,
      { latitude, longitude, accuracy, speed, heading, altitude },
      bookingId
    );

    res.json({
      success: true,
      message: 'Location recorded successfully',
      locationId
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/location/booking/:bookingId
 * Get cleaner location for active booking
 */
router.get('/location/booking/:bookingId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const location = await locationTrackingService.getActiveBookingLocation(parseInt(bookingId));

    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'No location data available for this booking'
      });
    }

    res.json({ success: true, location });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/location/history/:bookingId
 * Get location history for booking
 */
router.get('/location/history/:bookingId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const cleanerId = (req as any).user.userId;
    const { bookingId } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;

    const history = await locationTrackingService.getLocationHistory(
      cleanerId,
      parseInt(bookingId),
      limit
    );

    res.json({ success: true, history, total: history.length });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// RATING & REVIEW ROUTES
// ============================================

/**
 * POST /api/v1/ratings
 * Create rating for booking
 */
router.post('/ratings', authenticateToken, async (req: Request, res: Response) => {
  try {
    const customerId = (req as any).user.userId;
    const {
      bookingId, cleanerId, rating, review,
      serviceQuality, punctuality, professionalism, valueForMoney,
      wouldRecommend, photos
    } = req.body;

    // Validate rating
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5' });
    }

    const ratingId = await ratingService.createRating({
      bookingId,
      customerId,
      cleanerId,
      rating,
      review,
      serviceQuality,
      punctuality,
      professionalism,
      valueForMoney,
      wouldRecommend,
      photos
    });

    res.json({
      success: true,
      message: 'Rating submitted successfully',
      ratingId
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/ratings/cleaner/:cleanerId
 * Get ratings for cleaner
 */
router.get('/ratings/cleaner/:cleanerId', async (req: Request, res: Response) => {
  try {
    const { cleanerId } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const { ratings, total } = await ratingService.getCleanerRatings(
      parseInt(cleanerId),
      limit,
      offset
    );

    res.json({ success: true, ratings, total, limit, offset });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/ratings/cleaner/:cleanerId/stats
 * Get rating statistics for cleaner
 */
router.get('/ratings/cleaner/:cleanerId/stats', async (req: Request, res: Response) => {
  try {
    const { cleanerId } = req.params;
    const stats = await ratingService.getCleanerRatingStats(parseInt(cleanerId));

    res.json({ success: true, stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/ratings/booking/:bookingId
 * Get rating for specific booking
 */
router.get('/ratings/booking/:bookingId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const rating = await ratingService.getRatingByBookingId(parseInt(bookingId));

    if (!rating) {
      return res.status(404).json({ success: false, message: 'Rating not found' });
    }

    res.json({ success: true, rating });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/ratings/featured
 * Get featured ratings
 */
router.get('/ratings/featured', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const ratings = await ratingService.getFeaturedRatings(limit);

    res.json({ success: true, ratings });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// NOTIFICATION ROUTES
// ============================================

/**
 * GET /api/v1/notifications
 * Get user notifications
 */
router.get('/notifications', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const unreadOnly = req.query.unreadOnly === 'true';

    const notifications = await notificationService.getUserNotifications(
      userId,
      limit,
      offset,
      unreadOnly
    );

    const unreadCount = await notificationService.getUnreadCount(userId);

    res.json({
      success: true,
      notifications,
      unreadCount,
      limit,
      offset
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/v1/notifications/:id/read
 * Mark notification as read
 */
router.put('/notifications/:id/read', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;

    await notificationService.markAsRead(parseInt(id), userId);

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/v1/notifications/read-all
 * Mark all notifications as read
 */
router.put('/notifications/read-all', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    await notificationService.markAllAsRead(userId);

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/push-token
 * Save push notification token
 */
router.post('/push-token', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { token, deviceType, deviceId } = req.body;

    await notificationService.savePushToken(userId, token, deviceType, deviceId);

    res.json({ success: true, message: 'Push token saved successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// CANCELLATION ROUTES
// ============================================

/**
 * POST /api/v1/bookings/:id/cancel
 * Cancel booking
 */
router.post('/bookings/:id/cancel', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const userType = (req as any).user.userType;
    const { id } = req.params;
    const { reason, detailedReason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, error: 'Cancellation reason is required' });
    }

    const result = await cancellationService.cancelBooking({
      bookingId: parseInt(id),
      cancelledBy: userId,
      cancellationType: userType === 'cleaner' ? 'cleaner' : 'customer',
      reason,
      detailedReason
    });

    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/bookings/:id/cancellation
 * Get cancellation details
 */
router.get('/bookings/:id/cancellation', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cancellation = await cancellationService.getCancellationDetails(parseInt(id));

    if (!cancellation) {
      return res.status(404).json({ success: false, message: 'Cancellation details not found' });
    }

    res.json({ success: true, cancellation });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/cancellations/stats
 * Get cancellation statistics
 */
router.get('/cancellations/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const userType = (req as any).user.userType;

    const cleanerId = userType === 'cleaner' ? userId : undefined;
    const stats = await cancellationService.getCancellationStats(cleanerId);

    res.json({ success: true, stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
