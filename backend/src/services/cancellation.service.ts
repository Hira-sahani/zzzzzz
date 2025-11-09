import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface CancellationData {
  bookingId: number;
  cancelledBy: number;
  cancellationType: 'customer' | 'cleaner' | 'admin' | 'system';
  reason: string;
  detailedReason?: string;
}

export class CancellationService {
  /**
   * Cancel booking with refund calculation
   */
  async cancelBooking(data: CancellationData): Promise<{
    success: boolean;
    refundAmount: number;
    penaltyAmount: number;
    message: string;
  }> {
    // Get booking details
    const booking = await this.getBookingDetails(data.bookingId);

    if (!booking) {
      throw new Error('Booking not found');
    }

    if (booking.status === 'completed' || booking.status === 'cancelled') {
      throw new Error(`Cannot cancel ${booking.status} booking`);
    }

    // Calculate refund and penalty
    const { refundAmount, penaltyAmount, message } = await this.calculateRefund(
      booking,
      data.cancellationType
    );

    // Create cancellation record
    const sqlCancel = `
      INSERT INTO cancellations (
        booking_id, cancelled_by, cancellation_type,
        reason, detailed_reason, refund_amount, penalty_amount, refund_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `;

    await query(sqlCancel, [
      data.bookingId,
      data.cancelledBy,
      data.cancellationType,
      data.reason,
      data.detailedReason || null,
      refundAmount,
      penaltyAmount
    ]);

    // Update booking status
    const sqlUpdateBooking = `
      UPDATE bookings
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = ?
    `;

    await query(sqlUpdateBooking, [data.bookingId]);

    // Process refund if applicable
    if (refundAmount > 0) {
      await this.processRefund(data.bookingId, refundAmount);
    }

    return {
      success: true,
      refundAmount,
      penaltyAmount,
      message
    };
  }

  /**
   * Calculate refund based on cancellation policy
   */
  private async calculateRefund(
    booking: any,
    cancellationType: string
  ): Promise<{
    refundAmount: number;
    penaltyAmount: number;
    message: string;
  }> {
    const totalAmount = parseFloat(booking.totalAmount);
    const scheduledDate = new Date(booking.scheduledDate + ' ' + booking.scheduledTime);
    const now = new Date();
    const hoursUntilService = (scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    let refundPercentage = 0;
    let penaltyPercentage = 0;
    let message = '';

    if (cancellationType === 'customer') {
      if (booking.status === 'pending' || booking.status === 'assigned') {
        if (hoursUntilService >= 24) {
          refundPercentage = 100;
          message = 'Full refund - cancelled more than 24 hours before service';
        } else if (hoursUntilService >= 12) {
          refundPercentage = 75;
          penaltyPercentage = 25;
          message = '75% refund - cancelled 12-24 hours before service';
        } else if (hoursUntilService >= 6) {
          refundPercentage = 50;
          penaltyPercentage = 50;
          message = '50% refund - cancelled 6-12 hours before service';
        } else {
          refundPercentage = 0;
          penaltyPercentage = 100;
          message = 'No refund - cancelled less than 6 hours before service';
        }
      } else if (booking.status === 'accepted') {
        refundPercentage = 0;
        penaltyPercentage = 100;
        message = 'No refund - cleaner already accepted';
      } else if (booking.status === 'in_progress') {
        refundPercentage = 0;
        penaltyPercentage = 100;
        message = 'No refund - service already started';
      }
    } else if (cancellationType === 'cleaner') {
      // Cleaner cancellation
      refundPercentage = 100;
      message = 'Full refund - cancelled by cleaner';
    } else if (cancellationType === 'admin' || cancellationType === 'system') {
      refundPercentage = 100;
      message = 'Full refund - cancelled by system';
    }

    const refundAmount = (totalAmount * refundPercentage) / 100;
    const penaltyAmount = (totalAmount * penaltyPercentage) / 100;

    return { refundAmount, penaltyAmount, message };
  }

  /**
   * Process refund via Stripe
   */
  private async processRefund(bookingId: number, refundAmount: number): Promise<void> {
    // Get payment details
    const sqlPayment = `
      SELECT stripe_payment_intent_id
      FROM payments
      WHERE booking_id = ? AND status = 'succeeded'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const payments = await query(sqlPayment, [bookingId]) as RowDataPacket[];

    if (payments.length === 0) {
      console.log(`No payment found for booking ${bookingId}`);
      return;
    }

    const paymentIntentId = payments[0].stripe_payment_intent_id;

    // Implement Stripe refund here
    // This is a placeholder for actual Stripe integration
    console.log(`Processing refund of ₹${refundAmount} for payment ${paymentIntentId}`);

    // Update refund status
    const sqlUpdate = `
      UPDATE cancellations
      SET refund_status = 'processed', refund_processed_at = NOW()
      WHERE booking_id = ?
    `;

    await query(sqlUpdate, [bookingId]);
  }

  /**
   * Get booking details
   */
  private async getBookingDetails(bookingId: number): Promise<any> {
    const sql = `
      SELECT
        id, customer_id, cleaner_id, status,
        total_amount as totalAmount,
        scheduled_date as scheduledDate,
        scheduled_time as scheduledTime
      FROM bookings
      WHERE id = ?
    `;

    const results = await query(sql, [bookingId]) as RowDataPacket[];
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Get cancellation details
   */
  async getCancellationDetails(bookingId: number): Promise<any> {
    const sql = `
      SELECT
        id, booking_id as bookingId,
        cancelled_by as cancelledBy,
        cancellation_type as cancellationType,
        reason, detailed_reason as detailedReason,
        cancelled_at as cancelledAt,
        refund_amount as refundAmount,
        refund_status as refundStatus,
        refund_processed_at as refundProcessedAt,
        penalty_amount as penaltyAmount,
        penalty_reason as penaltyReason
      FROM cancellations
      WHERE booking_id = ?
    `;

    const results = await query(sql, [bookingId]) as RowDataPacket[];
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Get cancellation statistics
   */
  async getCancellationStats(cleanerId?: number): Promise<{
    totalCancellations: number;
    customerCancellations: number;
    cleanerCancellations: number;
    totalRefunded: number;
    totalPenalties: number;
  }> {
    let sql = `
      SELECT
        COUNT(*) as totalCancellations,
        SUM(CASE WHEN cancellation_type = 'customer' THEN 1 ELSE 0 END) as customerCancellations,
        SUM(CASE WHEN cancellation_type = 'cleaner' THEN 1 ELSE 0 END) as cleanerCancellations,
        SUM(refund_amount) as totalRefunded,
        SUM(penalty_amount) as totalPenalties
      FROM cancellations
    `;

    const params: any[] = [];

    if (cleanerId) {
      sql += ` WHERE booking_id IN (SELECT id FROM bookings WHERE cleaner_id = ?)`;
      params.push(cleanerId);
    }

    const results = await query(sql, params) as RowDataPacket[];

    return {
      totalCancellations: results[0].totalCancellations || 0,
      customerCancellations: results[0].customerCancellations || 0,
      cleanerCancellations: results[0].cleanerCancellations || 0,
      totalRefunded: parseFloat(results[0].totalRefunded || 0),
      totalPenalties: parseFloat(results[0].totalPenalties || 0)
    };
  }
}

export default new CancellationService();
