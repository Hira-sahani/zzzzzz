import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface NotificationData {
  userId: number;
  type: string;
  title: string;
  message: string;
  data?: any;
  actionUrl?: string;
  priority?: 'low' | 'normal' | 'high';
}

export interface Notification {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  data?: any;
  actionUrl?: string;
  priority: string;
  isRead: boolean;
  readAt?: Date;
  sentVia?: any;
  createdAt: Date;
}

export class NotificationService {
  /**
   * Create notification
   */
  async createNotification(data: NotificationData): Promise<number> {
    const sql = `
      INSERT INTO notifications (user_id, type, title, message, data, action_url, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await query(sql, [
      data.userId,
      data.type,
      data.title,
      data.message,
      data.data ? JSON.stringify(data.data) : null,
      data.actionUrl || null,
      data.priority || 'normal'
    ]) as ResultSetHeader;

    // Send push notification if user has tokens
    await this.sendPushNotification(data.userId, data.title, data.message, data.data);

    return result.insertId;
  }

  /**
   * Get user notifications
   */
  async getUserNotifications(
    userId: number,
    limit: number = 50,
    offset: number = 0,
    unreadOnly: boolean = false
  ): Promise<Notification[]> {
    const sql = `
      SELECT
        id, user_id as userId, type, title, message,
        data, action_url as actionUrl, priority,
        is_read as isRead, read_at as readAt, sent_via as sentVia, created_at as createdAt
      FROM notifications
      WHERE user_id = ? ${unreadOnly ? 'AND is_read = FALSE' : ''}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const results = await query(sql, [userId, limit, offset]) as RowDataPacket[];

    results.forEach(notif => {
      if (notif.data) notif.data = JSON.parse(notif.data);
      if (notif.sentVia) notif.sentVia = JSON.parse(notif.sentVia);
    });

    return results as Notification[];
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: number, userId: number): Promise<void> {
    const sql = `
      UPDATE notifications
      SET is_read = TRUE, read_at = NOW()
      WHERE id = ? AND user_id = ?
    `;

    await query(sql, [notificationId, userId]);
  }

  /**
   * Mark all as read
   */
  async markAllAsRead(userId: number): Promise<void> {
    const sql = `
      UPDATE notifications
      SET is_read = TRUE, read_at = NOW()
      WHERE user_id = ? AND is_read = FALSE
    `;

    await query(sql, [userId]);
  }

  /**
   * Get unread count
   */
  async getUnreadCount(userId: number): Promise<number> {
    const sql = `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE`;
    const results = await query(sql, [userId]) as RowDataPacket[];
    return results[0].count;
  }

  /**
   * Save push token
   */
  async savePushToken(
    userId: number,
    token: string,
    deviceType: 'ios' | 'android' | 'web',
    deviceId?: string
  ): Promise<void> {
    const sql = `
      INSERT INTO push_tokens (user_id, token, device_type, device_id, last_used_at)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        token = VALUES(token),
        is_active = TRUE,
        last_used_at = NOW()
    `;

    await query(sql, [userId, token, deviceType, deviceId || null]);
  }

  /**
   * Get user push tokens
   */
  async getUserPushTokens(userId: number): Promise<Array<{ token: string; deviceType: string }>> {
    const sql = `
      SELECT token, device_type as deviceType
      FROM push_tokens
      WHERE user_id = ? AND is_active = TRUE
    `;

    const results = await query(sql, [userId]) as RowDataPacket[];
    return results as Array<{ token: string; deviceType: string }>;
  }

  /**
   * Send push notification (Firebase Cloud Messaging)
   */
  private async sendPushNotification(
    userId: number,
    title: string,
    message: string,
    data?: any
  ): Promise<void> {
    const tokens = await this.getUserPushTokens(userId);

    if (tokens.length === 0) return;

    // Implement Firebase Cloud Messaging here
    // This is a placeholder for actual FCM integration
    console.log(`Sending push to ${tokens.length} devices for user ${userId}`);
    console.log(`Title: ${title}, Message: ${message}`);
  }

  /**
   * Send booking-related notifications
   */
  async sendBookingNotification(
    bookingId: number,
    customerId: number,
    cleanerId: number | null,
    type: 'booking_created' | 'booking_accepted' | 'booking_started' | 'booking_completed' | 'booking_cancelled'
  ): Promise<void> {
    const messages = {
      booking_created: {
        customer: { title: 'Booking Confirmed', message: 'Your cleaning service has been booked successfully' },
        cleaner: { title: 'New Job Request', message: 'You have a new cleaning job request' }
      },
      booking_accepted: {
        customer: { title: 'Cleaner Assigned', message: 'A cleaner has been assigned to your booking' },
        cleaner: { title: 'Job Accepted', message: 'You have accepted a new job' }
      },
      booking_started: {
        customer: { title: 'Service Started', message: 'Your cleaner has arrived and started the service' },
        cleaner: { title: 'Job Started', message: 'You have started the cleaning job' }
      },
      booking_completed: {
        customer: { title: 'Service Completed', message: 'Your cleaning service has been completed. Please rate your experience' },
        cleaner: { title: 'Job Completed', message: 'You have completed the cleaning job' }
      },
      booking_cancelled: {
        customer: { title: 'Booking Cancelled', message: 'Your booking has been cancelled' },
        cleaner: { title: 'Job Cancelled', message: 'A job has been cancelled' }
      }
    };

    const msg = messages[type];

    // Notify customer
    await this.createNotification({
      userId: customerId,
      type,
      title: msg.customer.title,
      message: msg.customer.message,
      data: { bookingId },
      actionUrl: `/bookings/${bookingId}`
    });

    // Notify cleaner if assigned
    if (cleanerId) {
      await this.createNotification({
        userId: cleanerId,
        type,
        title: msg.cleaner.title,
        message: msg.cleaner.message,
        data: { bookingId },
        actionUrl: `/jobs/${bookingId}`
      });
    }
  }

  /**
   * Delete old notifications
   */
  async deleteOldNotifications(daysOld: number = 90): Promise<number> {
    const sql = `
      DELETE FROM notifications
      WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        AND is_read = TRUE
    `;

    const result = await query(sql, [daysOld]) as ResultSetHeader;
    return result.affectedRows;
  }
}

export default new NotificationService();
