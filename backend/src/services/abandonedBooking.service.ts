import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface AbandonedBooking {
  customerId: number;
  sessionId?: string;
  servicesSelected: number[];
  addressId?: number;
  scheduledDate?: Date;
  scheduledTime?: string;
  abandonedAt: Date;
  stage: 'service_selection' | 'address_entry' | 'datetime_selection' | 'payment';
  deviceInfo?: any;
  estimatedValue: number;
}

export class AbandonedBookingService {
  /**
   * Track abandoned booking
   */
  async trackAbandoned(data: {
    customerId?: number;
    sessionId: string;
    servicesSelected: number[];
    addressId?: number;
    scheduledDate?: Date;
    scheduledTime?: string;
    stage: string;
    deviceInfo?: any;
    estimatedValue: number;
  }): Promise<number> {
    const sql = `
      INSERT INTO abandoned_bookings (
        customer_id, session_id, services_selected, address_id,
        scheduled_date, scheduled_time, stage, device_info,
        estimated_value, abandoned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const result = await query(sql, [
      data.customerId || null,
      data.sessionId,
      JSON.stringify(data.servicesSelected),
      data.addressId || null,
      data.scheduledDate || null,
      data.scheduledTime || null,
      data.stage,
      data.deviceInfo ? JSON.stringify(data.deviceInfo) : null,
      data.estimatedValue
    ]) as ResultSetHeader;

    return result.insertId;
  }

  /**
   * Get abandoned bookings for recovery
   */
  async getAbandonedForRecovery(hours: number = 24): Promise<any[]> {
    const sql = `
      SELECT
        ab.id,
        ab.customer_id as customerId,
        ab.session_id as sessionId,
        ab.services_selected as servicesSelected,
        ab.address_id as addressId,
        ab.scheduled_date as scheduledDate,
        ab.scheduled_time as scheduledTime,
        ab.stage,
        ab.estimated_value as estimatedValue,
        ab.abandoned_at as abandonedAt,
        u.name as customerName,
        u.email as customerEmail,
        u.phone as customerPhone,
        COUNT(r.id) as recoveryAttempts
      FROM abandoned_bookings ab
      LEFT JOIN users u ON u.id = ab.customer_id
      LEFT JOIN recovery_attempts r ON r.abandoned_booking_id = ab.id
      WHERE ab.recovered = FALSE
        AND ab.abandoned_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
        AND ab.abandoned_at <= DATE_SUB(NOW(), INTERVAL 1 HOUR)
      GROUP BY ab.id, ab.customer_id, ab.session_id, ab.services_selected,
               ab.address_id, ab.scheduled_date, ab.scheduled_time, ab.stage,
               ab.estimated_value, ab.abandoned_at, u.name, u.email, u.phone
      HAVING recoveryAttempts < 3
      ORDER BY ab.estimated_value DESC, ab.abandoned_at ASC
      LIMIT 100
    `;

    const abandoned = await query(sql, [hours]) as RowDataPacket[];

    return abandoned.map(a => ({
      ...a,
      servicesSelected: JSON.parse(a.servicesSelected)
    }));
  }

  /**
   * Send recovery message
   */
  async sendRecoveryMessage(abandonedBookingId: number): Promise<{
    sent: boolean;
    channel: string;
    message: string;
  }> {
    // Get abandoned booking details
    const sql = `
      SELECT
        ab.id,
        ab.customer_id as customerId,
        ab.services_selected as servicesSelected,
        ab.estimated_value as estimatedValue,
        ab.stage,
        u.name,
        u.email,
        u.phone
      FROM abandoned_bookings ab
      LEFT JOIN users u ON u.id = ab.customer_id
      WHERE ab.id = ?
    `;

    const result = await query(sql, [abandonedBookingId]) as RowDataPacket[];

    if (result.length === 0) {
      throw new Error('Abandoned booking not found');
    }

    const abandoned = result[0];
    const services = JSON.parse(abandoned.servicesSelected);

    // Create personalized message based on stage
    let message = '';
    let incentive = '';

    switch (abandoned.stage) {
      case 'service_selection':
        message = `Hi ${abandoned.name || 'there'}! We noticed you were browsing our services. `;
        incentive = 'Complete your booking now and get 10% off! ';
        break;
      case 'address_entry':
        message = `Hi ${abandoned.name}! You're almost there! `;
        incentive = 'Complete your booking in the next hour and get free delivery! ';
        break;
      case 'datetime_selection':
        message = `Hi ${abandoned.name}! Your selected services are waiting. `;
        incentive = 'Book now and we'll prioritize your request! ';
        break;
      case 'payment':
        message = `Hi ${abandoned.name}! You're one step away from a clean home! `;
        incentive = 'Use code COMEBACK15 for 15% off your first booking! ';
        break;
    }

    message += incentive;
    message += `Book now: [link]`;

    // Determine best channel
    const channel = abandoned.email ? 'email' : 'sms';

    // TODO: Send via actual communication service
    console.log(`Recovery message for ${abandonedBookingId} via ${channel}: ${message}`);

    // Log recovery attempt
    await this.logRecoveryAttempt(abandonedBookingId, channel, message);

    return {
      sent: true,
      channel,
      message
    };
  }

  /**
   * Log recovery attempt
   */
  private async logRecoveryAttempt(
    abandonedBookingId: number,
    channel: string,
    message: string
  ): Promise<void> {
    const sql = `
      INSERT INTO recovery_attempts (
        abandoned_booking_id, channel, message, sent_at
      ) VALUES (?, ?, ?, NOW())
    `;

    await query(sql, [abandonedBookingId, channel, message]);
  }

  /**
   * Mark as recovered
   */
  async markRecovered(abandonedBookingId: number, bookingId: number): Promise<void> {
    const sql = `
      UPDATE abandoned_bookings
      SET recovered = TRUE,
          recovered_booking_id = ?,
          recovered_at = NOW()
      WHERE id = ?
    `;

    await query(sql, [bookingId, abandonedBookingId]);
  }

  /**
   * Get recovery statistics
   */
  async getRecoveryStats(days: number = 30): Promise<{
    totalAbandoned: number;
    totalRecovered: number;
    recoveryRate: number;
    totalRecoveredValue: number;
    avgRecoveryTime: number;
    byStage: { [stage: string]: { abandoned: number; recovered: number; rate: number } };
  }> {
    const sql = `
      SELECT
        COUNT(*) as totalAbandoned,
        SUM(CASE WHEN recovered = TRUE THEN 1 ELSE 0 END) as totalRecovered,
        SUM(CASE WHEN recovered = TRUE THEN estimated_value ELSE 0 END) as totalRecoveredValue,
        AVG(CASE WHEN recovered = TRUE THEN TIMESTAMPDIFF(HOUR, abandoned_at, recovered_at) ELSE NULL END) as avgRecoveryTime
      FROM abandoned_bookings
      WHERE abandoned_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const stats = await query(sql, [days]) as RowDataPacket[];

    // Get stats by stage
    const stageSql = `
      SELECT
        stage,
        COUNT(*) as abandoned,
        SUM(CASE WHEN recovered = TRUE THEN 1 ELSE 0 END) as recovered
      FROM abandoned_bookings
      WHERE abandoned_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY stage
    `;

    const stages = await query(stageSql, [days]) as RowDataPacket[];

    const byStage: any = {};
    stages.forEach(s => {
      byStage[s.stage] = {
        abandoned: s.abandoned,
        recovered: s.recovered,
        rate: s.abandoned > 0 ? Math.round((s.recovered / s.abandoned) * 100) : 0
      };
    });

    const totalAbandoned = stats[0].totalAbandoned || 0;
    const totalRecovered = stats[0].totalRecovered || 0;

    return {
      totalAbandoned,
      totalRecovered,
      recoveryRate: totalAbandoned > 0 ? Math.round((totalRecovered / totalAbandoned) * 100) : 0,
      totalRecoveredValue: parseFloat(stats[0].totalRecoveredValue || 0),
      avgRecoveryTime: parseFloat(stats[0].avgRecoveryTime || 0),
      byStage
    };
  }

  /**
   * Batch process recovery messages
   */
  async batchProcessRecovery(): Promise<{
    processed: number;
    sent: number;
    failed: number;
  }> {
    const abandoned = await this.getAbandonedForRecovery(24);

    let sent = 0;
    let failed = 0;

    for (const booking of abandoned) {
      try {
        await this.sendRecoveryMessage(booking.id);
        sent++;
      } catch (error) {
        console.error(`Failed to send recovery for ${booking.id}:`, error);
        failed++;
      }
    }

    return {
      processed: abandoned.length,
      sent,
      failed
    };
  }

  /**
   * Get abandonment trends
   */
  async getAbandonmentTrends(days: number = 30): Promise<any[]> {
    const sql = `
      SELECT
        DATE(abandoned_at) as date,
        COUNT(*) as totalAbandoned,
        SUM(CASE WHEN recovered = TRUE THEN 1 ELSE 0 END) as recovered,
        AVG(estimated_value) as avgValue,
        stage
      FROM abandoned_bookings
      WHERE abandoned_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(abandoned_at), stage
      ORDER BY date DESC, stage
    `;

    const trends = await query(sql, [days]) as RowDataPacket[];

    return trends.map(t => ({
      date: t.date,
      totalAbandoned: t.totalAbandoned,
      recovered: t.recovered,
      recoveryRate: Math.round((t.recovered / t.totalAbandoned) * 100),
      avgValue: parseFloat(t.avgValue || 0),
      stage: t.stage
    }));
  }

  /**
   * Create personalized incentive
   */
  async createPersonalizedIncentive(customerId: number): Promise<{
    code: string;
    discountPercent: number;
    validUntil: Date;
  }> {
    // Check customer's abandoned bookings and value
    const sql = `
      SELECT
        COUNT(*) as abandonedCount,
        AVG(estimated_value) as avgValue
      FROM abandoned_bookings
      WHERE customer_id = ?
        AND recovered = FALSE
        AND abandoned_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `;

    const result = await query(sql, [customerId]) as RowDataPacket[];

    const abandonedCount = result[0].abandonedCount || 0;
    const avgValue = parseFloat(result[0].avgValue || 0);

    // Calculate incentive based on behavior
    let discountPercent = 10; // Base discount

    if (abandonedCount >= 3) {
      discountPercent = 20; // Higher discount for multiple abandonments
    } else if (avgValue > 1000) {
      discountPercent = 15; // Mid discount for high-value carts
    }

    // Generate unique code
    const code = `COMEBACK${discountPercent}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 7); // Valid for 7 days

    // Create coupon
    const couponSql = `
      INSERT INTO coupons (
        code, discount_type, discount_value, usage_limit, valid_until, created_at
      ) VALUES (?, 'percentage', ?, 1, ?, NOW())
    `;

    await query(couponSql, [code, discountPercent, validUntil]);

    return {
      code,
      discountPercent,
      validUntil
    };
  }
}

export default new AbandonedBookingService();
