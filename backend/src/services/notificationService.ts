import { query } from '../config/database';
import { sendSMS } from './smsService';
import { logger } from '../utils/logger';
import { NotificationType } from '../types';

/**
 * Create notification record in database
 */
async function createNotificationRecord(
  userId: number,
  bookingId: number | null,
  type: NotificationType,
  title: string,
  message: string,
  externalId?: string,
  status: 'pending' | 'sent' | 'failed' = 'pending',
  errorMessage?: string
): Promise<number> {
  const sql = `
    INSERT INTO notifications (user_id, booking_id, notification_type, title, message, status, external_id, error_message, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const sentAt = status === 'sent' ? new Date() : null;

  const result = await query(sql, [
    userId,
    bookingId,
    type,
    title,
    message,
    status,
    externalId || null,
    errorMessage || null,
    sentAt
  ]);

  return result.insertId;
}

/**
 * Send SMS notification and track in database
 */
export async function sendSMSNotification(
  userId: number,
  phone: string,
  title: string,
  message: string,
  bookingId?: number
): Promise<void> {
  try {
    const smsResult = await sendSMS(phone, message);

    if (smsResult.success) {
      await createNotificationRecord(
        userId,
        bookingId || null,
        'sms',
        title,
        message,
        smsResult.messageId,
        'sent'
      );
      logger.info(`SMS notification sent to user ${userId}`);
    } else {
      await createNotificationRecord(
        userId,
        bookingId || null,
        'sms',
        title,
        message,
        undefined,
        'failed',
        smsResult.error
      );
      logger.error(`Failed to send SMS to user ${userId}: ${smsResult.error}`);
    }
  } catch (error: any) {
    logger.error(`Error sending SMS notification:`, error);
    await createNotificationRecord(
      userId,
      bookingId || null,
      'sms',
      title,
      message,
      undefined,
      'failed',
      error.message
    );
  }
}

/**
 * Send push notification (placeholder for Firebase FCM integration)
 */
export async function sendPushNotification(
  userId: number,
  title: string,
  message: string,
  bookingId?: number
): Promise<void> {
  try {
    // TODO: Implement Firebase Cloud Messaging
    // For now, just log and track in database
    logger.info(`Push notification would be sent to user ${userId}: ${title}`);

    await createNotificationRecord(
      userId,
      bookingId || null,
      'push',
      title,
      message,
      undefined,
      'sent'
    );
  } catch (error: any) {
    logger.error(`Error sending push notification:`, error);
    await createNotificationRecord(
      userId,
      bookingId || null,
      'push',
      title,
      message,
      undefined,
      'failed',
      error.message
    );
  }
}

/**
 * Get user's notifications
 */
export async function getUserNotifications(
  userId: number,
  limit: number = 50,
  offset: number = 0
): Promise<any[]> {
  const sql = `
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  return await query(sql, [userId, limit, offset]);
}

/**
 * Mark notification as read (if we add that feature later)
 */
export async function markNotificationRead(notificationId: number): Promise<void> {
  // Future implementation
  logger.info(`Mark notification ${notificationId} as read`);
}
