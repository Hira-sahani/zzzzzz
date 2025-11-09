import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface CustomerProfile {
  customerId: number;
  totalBookings: number;
  completedBookings: number;
  totalSpent: number;
  avgBookingValue: number;
  firstBookingDate: Date;
  lastBookingDate: Date;
  daysSinceLastBooking: number;
  frequencyDays: number;
  preferredServices: string[];
  preferredCleaners: number[];
  preferredTimeSlots: string[];
  preferredDayOfWeek: string[];
  lifetimeValue: number;
  repeatRate: number;
  churnRisk: number;
}

export interface CustomerSegment {
  segment: 'vip' | 'loyal' | 'regular' | 'occasional' | 'at_risk' | 'churned';
  count: number;
  totalRevenue: number;
  avgLifetimeValue: number;
}

export class RepeatCustomerService {
  /**
   * Get comprehensive customer profile
   */
  async getCustomerProfile(customerId: number): Promise<CustomerProfile> {
    // Get booking statistics
    const statsSql = `
      SELECT
        COUNT(*) as totalBookings,
        SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) as completedBookings,
        SUM(CASE WHEN b.status = 'completed' THEN b.total_amount ELSE 0 END) as totalSpent,
        AVG(CASE WHEN b.status = 'completed' THEN b.total_amount ELSE NULL END) as avgBookingValue,
        MIN(b.created_at) as firstBookingDate,
        MAX(b.created_at) as lastBookingDate,
        DATEDIFF(NOW(), MAX(b.created_at)) as daysSinceLastBooking
      FROM bookings b
      WHERE b.customer_id = ?
    `;

    const stats = await query(statsSql, [customerId]) as RowDataPacket[];

    if (stats[0].totalBookings === 0) {
      throw new Error('No bookings found for customer');
    }

    // Calculate frequency (days between bookings)
    const frequencySql = `
      SELECT
        AVG(DATEDIFF(next_booking, booking_date)) as avgFrequencyDays
      FROM (
        SELECT
          created_at as booking_date,
          LEAD(created_at) OVER (ORDER BY created_at) as next_booking
        FROM bookings
        WHERE customer_id = ? AND status = 'completed'
      ) booking_gaps
      WHERE next_booking IS NOT NULL
    `;

    const frequency = await query(frequencySql, [customerId]) as RowDataPacket[];

    // Get preferred services
    const servicesSql = `
      SELECT
        s.name,
        COUNT(*) as bookingCount
      FROM booking_services bs
      INNER JOIN bookings b ON b.id = bs.booking_id
      INNER JOIN services s ON s.id = bs.service_id
      WHERE b.customer_id = ? AND b.status = 'completed'
      GROUP BY s.id, s.name
      ORDER BY bookingCount DESC
      LIMIT 3
    `;

    const services = await query(servicesSql, [customerId]) as RowDataPacket[];
    const preferredServices = services.map(s => s.name);

    // Get preferred cleaners
    const cleanersSql = `
      SELECT
        cleaner_id,
        COUNT(*) as bookingCount
      FROM bookings
      WHERE customer_id = ? AND cleaner_id IS NOT NULL AND status = 'completed'
      GROUP BY cleaner_id
      ORDER BY bookingCount DESC
      LIMIT 3
    `;

    const cleaners = await query(cleanersSql, [customerId]) as RowDataPacket[];
    const preferredCleaners = cleaners.map(c => c.cleaner_id);

    // Get preferred time slots
    const timeSlotsSql = `
      SELECT
        CONCAT(HOUR(created_at), ':00-', HOUR(created_at) + 1, ':00') as timeSlot,
        COUNT(*) as bookingCount
      FROM bookings
      WHERE customer_id = ? AND status = 'completed'
      GROUP BY HOUR(created_at)
      ORDER BY bookingCount DESC
      LIMIT 3
    `;

    const timeSlots = await query(timeSlotsSql, [customerId]) as RowDataPacket[];
    const preferredTimeSlots = timeSlots.map(t => t.timeSlot);

    // Get preferred days of week
    const daysSql = `
      SELECT
        DAYNAME(created_at) as dayName,
        COUNT(*) as bookingCount
      FROM bookings
      WHERE customer_id = ? AND status = 'completed'
      GROUP BY DAYNAME(created_at)
      ORDER BY bookingCount DESC
      LIMIT 3
    `;

    const days = await query(daysSql, [customerId]) as RowDataPacket[];
    const preferredDayOfWeek = days.map(d => d.dayName);

    // Calculate metrics
    const totalSpent = parseFloat(stats[0].totalSpent || 0);
    const completedBookings = stats[0].completedBookings;
    const totalBookings = stats[0].totalBookings;
    const repeatRate = completedBookings > 1 ? (completedBookings - 1) / completedBookings : 0;
    const daysSinceLastBooking = stats[0].daysSinceLastBooking || 0;
    const frequencyDays = parseFloat(frequency[0]?.avgFrequencyDays || 30);

    // Calculate churn risk
    const churnRisk = this.calculateChurnRisk(daysSinceLastBooking, frequencyDays, repeatRate);

    return {
      customerId,
      totalBookings,
      completedBookings,
      totalSpent,
      avgBookingValue: parseFloat(stats[0].avgBookingValue || 0),
      firstBookingDate: stats[0].firstBookingDate,
      lastBookingDate: stats[0].lastBookingDate,
      daysSinceLastBooking,
      frequencyDays,
      preferredServices,
      preferredCleaners,
      preferredTimeSlots,
      preferredDayOfWeek,
      lifetimeValue: totalSpent,
      repeatRate: Math.round(repeatRate * 100) / 100,
      churnRisk: Math.round(churnRisk * 100) / 100
    };
  }

  /**
   * Calculate churn risk score (0-100)
   */
  private calculateChurnRisk(
    daysSinceLastBooking: number,
    avgFrequencyDays: number,
    repeatRate: number
  ): number {
    let risk = 0;

    // Risk based on inactivity
    if (daysSinceLastBooking > avgFrequencyDays * 2) {
      risk += 40;
    } else if (daysSinceLastBooking > avgFrequencyDays * 1.5) {
      risk += 25;
    } else if (daysSinceLastBooking > avgFrequencyDays) {
      risk += 10;
    }

    // Risk based on repeat rate
    if (repeatRate < 0.3) {
      risk += 30;
    } else if (repeatRate < 0.5) {
      risk += 15;
    }

    // Risk based on recency
    if (daysSinceLastBooking > 90) {
      risk += 30;
    } else if (daysSinceLastBooking > 60) {
      risk += 15;
    }

    return Math.min(risk, 100);
  }

  /**
   * Segment customers
   */
  async segmentCustomers(cityId?: number): Promise<CustomerSegment[]> {
    let sql = `
      SELECT
        CASE
          WHEN completed_bookings >= 10 AND total_spent >= 5000 THEN 'vip'
          WHEN completed_bookings >= 5 AND repeat_rate >= 0.5 THEN 'loyal'
          WHEN completed_bookings >= 3 THEN 'regular'
          WHEN completed_bookings >= 1 AND days_since_last < 30 THEN 'occasional'
          WHEN days_since_last > 90 THEN 'churned'
          ELSE 'at_risk'
        END as segment,
        COUNT(*) as count,
        SUM(total_spent) as totalRevenue,
        AVG(total_spent) as avgLifetimeValue
      FROM (
        SELECT
          b.customer_id,
          COUNT(CASE WHEN b.status = 'completed' THEN 1 END) as completed_bookings,
          SUM(CASE WHEN b.status = 'completed' THEN b.total_amount ELSE 0 END) as total_spent,
          DATEDIFF(NOW(), MAX(b.created_at)) as days_since_last,
          (COUNT(CASE WHEN b.status = 'completed' THEN 1 END) - 1) /
            NULLIF(COUNT(CASE WHEN b.status = 'completed' THEN 1 END), 0) as repeat_rate
        FROM bookings b
        WHERE 1=1
    `;

    const params: any[] = [];

    if (cityId) {
      sql += ` AND b.city_id = ?`;
      params.push(cityId);
    }

    sql += `
        GROUP BY b.customer_id
      ) customer_stats
      GROUP BY segment
      ORDER BY FIELD(segment, 'vip', 'loyal', 'regular', 'occasional', 'at_risk', 'churned')
    `;

    const segments = await query(sql, params) as RowDataPacket[];

    return segments.map(s => ({
      segment: s.segment,
      count: s.count,
      totalRevenue: parseFloat(s.totalRevenue || 0),
      avgLifetimeValue: parseFloat(s.avgLifetimeValue || 0)
    }));
  }

  /**
   * Get customers due for next booking (based on frequency)
   */
  async getCustomersDueForBooking(daysWindow: number = 7): Promise<any[]> {
    const sql = `
      SELECT
        u.id as customerId,
        u.name,
        u.email,
        u.phone,
        customer_stats.last_booking_date as lastBookingDate,
        customer_stats.avg_frequency_days as avgFrequencyDays,
        customer_stats.days_since_last as daysSinceLastBooking,
        customer_stats.expected_next_booking as expectedNextBooking
      FROM users u
      INNER JOIN (
        SELECT
          customer_id,
          MAX(created_at) as last_booking_date,
          DATEDIFF(NOW(), MAX(created_at)) as days_since_last,
          AVG(frequency_days) as avg_frequency_days,
          DATE_ADD(MAX(created_at), INTERVAL AVG(frequency_days) DAY) as expected_next_booking
        FROM bookings b
        LEFT JOIN (
          SELECT
            customer_id,
            DATEDIFF(next_booking, booking_date) as frequency_days
          FROM (
            SELECT
              customer_id,
              created_at as booking_date,
              LEAD(created_at) OVER (PARTITION BY customer_id ORDER BY created_at) as next_booking
            FROM bookings
            WHERE status = 'completed'
          ) booking_gaps
          WHERE next_booking IS NOT NULL
        ) frequencies ON frequencies.customer_id = b.customer_id
        WHERE b.status = 'completed'
        GROUP BY b.customer_id
        HAVING days_since_last >= avg_frequency_days - ? AND days_since_last <= avg_frequency_days + ?
      ) customer_stats ON customer_stats.customer_id = u.id
      ORDER BY customer_stats.expected_next_booking ASC
      LIMIT 100
    `;

    return await query(sql, [daysWindow, daysWindow]) as RowDataPacket[];
  }

  /**
   * Match customer with preferred cleaner
   */
  async matchCustomerWithPreferredCleaner(customerId: number): Promise<{
    cleanerId: number | null;
    cleanerName: string | null;
    matchScore: number;
    bookingsWithCleaner: number;
  }> {
    const sql = `
      SELECT
        b.cleaner_id as cleanerId,
        u.name as cleanerName,
        COUNT(*) as bookingsWithCleaner,
        AVG(r.rating) as avgRating
      FROM bookings b
      INNER JOIN users u ON u.id = b.cleaner_id
      LEFT JOIN ratings r ON r.booking_id = b.id AND r.rated_id = b.cleaner_id
      WHERE b.customer_id = ?
        AND b.cleaner_id IS NOT NULL
        AND b.status = 'completed'
      GROUP BY b.cleaner_id, u.name
      ORDER BY bookingsWithCleaner DESC, avgRating DESC
      LIMIT 1
    `;

    const result = await query(sql, [customerId]) as RowDataPacket[];

    if (result.length === 0) {
      return {
        cleanerId: null,
        cleanerName: null,
        matchScore: 0,
        bookingsWithCleaner: 0
      };
    }

    const match = result[0];
    const matchScore = Math.min((match.bookingsWithCleaner * 10) + (match.avgRating || 0) * 10, 100);

    return {
      cleanerId: match.cleanerId,
      cleanerName: match.cleanerName,
      matchScore: Math.round(matchScore),
      bookingsWithCleaner: match.bookingsWithCleaner
    };
  }

  /**
   * Get customer retention rate
   */
  async getRetentionRate(months: number = 12): Promise<{
    cohort: string;
    newCustomers: number;
    retained: { [month: number]: number };
    retentionRate: { [month: number]: number };
  }[]> {
    const sql = `
      SELECT
        DATE_FORMAT(first_booking, '%Y-%m') as cohort,
        COUNT(DISTINCT customer_id) as newCustomers,
        SUM(CASE WHEN months_active >= 1 THEN 1 ELSE 0 END) as retained_1,
        SUM(CASE WHEN months_active >= 2 THEN 1 ELSE 0 END) as retained_2,
        SUM(CASE WHEN months_active >= 3 THEN 1 ELSE 0 END) as retained_3,
        SUM(CASE WHEN months_active >= 6 THEN 1 ELSE 0 END) as retained_6,
        SUM(CASE WHEN months_active >= 12 THEN 1 ELSE 0 END) as retained_12
      FROM (
        SELECT
          customer_id,
          MIN(created_at) as first_booking,
          MAX(created_at) as last_booking,
          TIMESTAMPDIFF(MONTH, MIN(created_at), MAX(created_at)) as months_active
        FROM bookings
        WHERE status = 'completed'
        GROUP BY customer_id
      ) customer_cohorts
      WHERE first_booking >= DATE_SUB(NOW(), INTERVAL ? MONTH)
      GROUP BY DATE_FORMAT(first_booking, '%Y-%m')
      ORDER BY cohort DESC
    `;

    const cohorts = await query(sql, [months]) as RowDataPacket[];

    return cohorts.map(c => ({
      cohort: c.cohort,
      newCustomers: c.newCustomers,
      retained: {
        1: c.retained_1,
        2: c.retained_2,
        3: c.retained_3,
        6: c.retained_6,
        12: c.retained_12
      },
      retentionRate: {
        1: Math.round((c.retained_1 / c.newCustomers) * 100),
        2: Math.round((c.retained_2 / c.newCustomers) * 100),
        3: Math.round((c.retained_3 / c.newCustomers) * 100),
        6: Math.round((c.retained_6 / c.newCustomers) * 100),
        12: Math.round((c.retained_12 / c.newCustomers) * 100)
      }
    }));
  }

  /**
   * Send personalized reminder to customer
   */
  async sendPersonalizedReminder(customerId: number): Promise<{
    sent: boolean;
    message: string;
    channel: string;
  }> {
    const profile = await this.getCustomerProfile(customerId);

    // Create personalized message
    let message = `Hi! We noticed it's been ${profile.daysSinceLastBooking} days since your last cleaning. `;

    if (profile.preferredServices.length > 0) {
      message += `Ready for another ${profile.preferredServices[0]}? `;
    }

    if (profile.preferredCleaners.length > 0) {
      message += `Your preferred cleaner is available! `;
    }

    message += `Book now and enjoy our service!`;

    // TODO: Send via SMS or push notification
    console.log(`Reminder for customer ${customerId}: ${message}`);

    return {
      sent: true,
      message,
      channel: 'sms'
    };
  }
}

export default new RepeatCustomerService();
