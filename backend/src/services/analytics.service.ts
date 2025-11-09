import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export class AnalyticsService {
  /**
   * Track analytics event
   */
  async trackEvent(event: {
    userId?: number;
    eventType: string;
    eventName: string;
    properties?: any;
    sessionId?: string;
    deviceInfo?: any;
  }): Promise<number> {
    const sql = `
      INSERT INTO analytics_events (
        user_id, event_type, event_name, properties,
        session_id, device_info, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())
    `;

    const result = await query(sql, [
      event.userId || null,
      event.eventType,
      event.eventName,
      event.properties ? JSON.stringify(event.properties) : null,
      event.sessionId || null,
      event.deviceInfo ? JSON.stringify(event.deviceInfo) : null
    ]) as ResultSetHeader;

    return result.insertId;
  }

  /**
   * Get demand heatmap data
   */
  async getDemandHeatmap(cityId?: number, days: number = 7): Promise<any[]> {
    let sql = `
      SELECT
        city_id as cityId,
        day_of_week as dayOfWeek,
        hour_of_day as hourOfDay,
        demand_score as demandScore,
        booking_count as bookingCount
      FROM demand_heatmap
      WHERE updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const params: any[] = [days];

    if (cityId) {
      sql += ` AND city_id = ?`;
      params.push(cityId);
    }

    sql += ` ORDER BY day_of_week, hour_of_day`;

    return await query(sql, params) as RowDataPacket[];
  }

  /**
   * Update demand heatmap (run hourly)
   */
  async updateDemandHeatmap(): Promise<void> {
    // Calculate demand for each city/day/hour combination
    const sql = `
      INSERT INTO demand_heatmap (
        city_id, day_of_week, hour_of_day, demand_score, booking_count, updated_at
      )
      SELECT
        1 as city_id,
        DAYOFWEEK(b.created_at) - 1 as day_of_week,
        HOUR(b.created_at) as hour_of_day,
        LEAST(100, COUNT(*) * 5) as demand_score,
        COUNT(*) as booking_count,
        NOW() as updated_at
      FROM bookings b
      WHERE b.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DAYOFWEEK(b.created_at), HOUR(b.created_at)
      ON DUPLICATE KEY UPDATE
        demand_score = VALUES(demand_score),
        booking_count = VALUES(booking_count),
        updated_at = VALUES(updated_at)
    `;

    await query(sql);
  }

  /**
   * Get booking conversion funnel
   */
  async getConversionFunnel(startDate: Date, endDate: Date): Promise<{
    pageViews: number;
    serviceSelection: number;
    bookingStarted: number;
    bookingCompleted: number;
    conversionRate: number;
  }> {
    const sql = `
      SELECT
        SUM(CASE WHEN event_name = 'page_view' AND properties LIKE '%services%' THEN 1 ELSE 0 END) as pageViews,
        SUM(CASE WHEN event_name = 'service_selected' THEN 1 ELSE 0 END) as serviceSelection,
        SUM(CASE WHEN event_name = 'booking_started' THEN 1 ELSE 0 END) as bookingStarted,
        SUM(CASE WHEN event_name = 'booking_completed' THEN 1 ELSE 0 END) as bookingCompleted
      FROM analytics_events
      WHERE created_at >= ? AND created_at <= ?
    `;

    const result = await query(sql, [startDate, endDate]) as RowDataPacket[];

    const data = result[0];
    const conversionRate = data.pageViews > 0
      ? (data.bookingCompleted / data.pageViews) * 100
      : 0;

    return {
      pageViews: data.pageViews || 0,
      serviceSelection: data.serviceSelection || 0,
      bookingStarted: data.bookingStarted || 0,
      bookingCompleted: data.bookingCompleted || 0,
      conversionRate: Math.round(conversionRate * 100) / 100
    };
  }

  /**
   * Get user retention
   */
  async getUserRetention(cohortMonth: Date): Promise<any[]> {
    const sql = `
      SELECT
        DATE_FORMAT(u.created_at, '%Y-%m') as cohort,
        COUNT(DISTINCT u.id) as cohortSize,
        COUNT(DISTINCT CASE WHEN b.created_at >= DATE_ADD(u.created_at, INTERVAL 1 MONTH) THEN u.id END) as month1,
        COUNT(DISTINCT CASE WHEN b.created_at >= DATE_ADD(u.created_at, INTERVAL 2 MONTH) THEN u.id END) as month2,
        COUNT(DISTINCT CASE WHEN b.created_at >= DATE_ADD(u.created_at, INTERVAL 3 MONTH) THEN u.id END) as month3
      FROM users u
      LEFT JOIN bookings b ON b.customer_id = u.id
      WHERE u.user_type = 'customer'
        AND u.created_at >= ?
      GROUP BY DATE_FORMAT(u.created_at, '%Y-%m')
      ORDER BY cohort
    `;

    return await query(sql, [cohortMonth]) as RowDataPacket[];
  }

  /**
   * Get revenue analytics
   */
  async getRevenueAnalytics(startDate: Date, endDate: Date, groupBy: 'day' | 'week' | 'month' = 'day'): Promise<any[]> {
    let dateFormat = '%Y-%m-%d';
    if (groupBy === 'week') dateFormat = '%Y-%U';
    if (groupBy === 'month') dateFormat = '%Y-%m';

    const sql = `
      SELECT
        DATE_FORMAT(b.completed_at, ?) as period,
        COUNT(*) as bookingCount,
        SUM(b.total_amount) as totalRevenue,
        SUM(b.platform_fee) as platformFee,
        SUM(b.cleaner_earnings) as cleanerEarnings,
        AVG(b.total_amount) as avgBookingValue
      FROM bookings b
      WHERE b.status = 'completed'
        AND b.completed_at >= ? AND b.completed_at <= ?
      GROUP BY DATE_FORMAT(b.completed_at, ?)
      ORDER BY period
    `;

    const results = await query(sql, [dateFormat, startDate, endDate, dateFormat]) as RowDataPacket[];

    return results.map(row => ({
      ...row,
      totalRevenue: parseFloat(row.totalRevenue || 0),
      platformFee: parseFloat(row.platformFee || 0),
      cleanerEarnings: parseFloat(row.cleanerEarnings || 0),
      avgBookingValue: parseFloat(row.avgBookingValue || 0)
    }));
  }

  /**
   * Get service popularity
   */
  async getServicePopularity(startDate: Date, endDate: Date): Promise<any[]> {
    const sql = `
      SELECT
        s.id, s.name,
        COUNT(bs.id) as bookingCount,
        SUM(bs.service_price) as totalRevenue,
        AVG(bs.service_price) as avgPrice
      FROM services s
      INNER JOIN booking_services bs ON bs.service_id = s.id
      INNER JOIN bookings b ON b.id = bs.booking_id
      WHERE b.created_at >= ? AND b.created_at <= ?
      GROUP BY s.id, s.name
      ORDER BY bookingCount DESC
    `;

    const results = await query(sql, [startDate, endDate]) as RowDataPacket[];

    return results.map(row => ({
      ...row,
      totalRevenue: parseFloat(row.totalRevenue || 0),
      avgPrice: parseFloat(row.avgPrice || 0)
    }));
  }

  /**
   * Get cleaner performance metrics
   */
  async getCleanerPerformance(cleanerId: number, days: number = 30): Promise<{
    totalBookings: number;
    completedBookings: number;
    cancelledBookings: number;
    averageRating: number;
    totalEarnings: number;
    avgCompletionTime: number;
    acceptanceRate: number;
  }> {
    const sql = `
      SELECT
        COUNT(*) as totalBookings,
        SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) as completedBookings,
        SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) as cancelledBookings,
        AVG(r.rating) as averageRating,
        SUM(CASE WHEN b.status = 'completed' THEN b.cleaner_earnings ELSE 0 END) as totalEarnings,
        AVG(TIMESTAMPDIFF(MINUTE, b.started_at, b.completed_at)) as avgCompletionTime
      FROM bookings b
      LEFT JOIN ratings r ON r.booking_id = b.id AND r.rated_id = b.cleaner_id
      WHERE b.cleaner_id = ?
        AND b.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const result = await query(sql, [cleanerId, days]) as RowDataPacket[];

    return {
      totalBookings: result[0].totalBookings || 0,
      completedBookings: result[0].completedBookings || 0,
      cancelledBookings: result[0].cancelledBookings || 0,
      averageRating: parseFloat(result[0].averageRating || 0),
      totalEarnings: parseFloat(result[0].totalEarnings || 0),
      avgCompletionTime: parseFloat(result[0].avgCompletionTime || 0),
      acceptanceRate: 0 // Would need additional tracking
    };
  }

  /**
   * Get peak hours analysis
   */
  async getPeakHours(cityId?: number, days: number = 30): Promise<any[]> {
    let sql = `
      SELECT
        HOUR(b.created_at) as hour,
        COUNT(*) as bookingCount,
        AVG(b.total_amount) as avgAmount
      FROM bookings b
      WHERE b.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const params: any[] = [days];

    if (cityId) {
      sql += ` AND b.city_id = ?`;
      params.push(cityId);
    }

    sql += ` GROUP BY HOUR(b.created_at) ORDER BY hour`;

    const results = await query(sql, params) as RowDataPacket[];

    return results.map(row => ({
      ...row,
      avgAmount: parseFloat(row.avgAmount || 0)
    }));
  }

  /**
   * Get geographic distribution
   */
  async getGeographicDistribution(days: number = 30): Promise<any[]> {
    const sql = `
      SELECT
        a.city,
        a.postal_code,
        COUNT(*) as bookingCount,
        SUM(b.total_amount) as totalRevenue
      FROM bookings b
      INNER JOIN addresses a ON a.id = b.address_id
      WHERE b.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY a.city, a.postal_code
      ORDER BY bookingCount DESC
      LIMIT 50
    `;

    const results = await query(sql, [days]) as RowDataPacket[];

    return results.map(row => ({
      ...row,
      totalRevenue: parseFloat(row.totalRevenue || 0)
    }));
  }

  /**
   * Clean up old analytics events
   */
  async cleanupOldEvents(daysToKeep: number = 90): Promise<number> {
    const sql = `
      DELETE FROM analytics_events
      WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const result = await query(sql, [daysToKeep]) as ResultSetHeader;
    return result.affectedRows;
  }
}

export default new AnalyticsService();
