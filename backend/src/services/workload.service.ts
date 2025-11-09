import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface CleanerCapacity {
  cleanerId: number;
  maxDailyBookings: number;
  maxConcurrentBookings: number;
  currentLoad: number;
  todayBookings: number;
  availableCapacity: number;
}

export class WorkloadService {
  /**
   * Get cleaner capacity
   */
  async getCleanerCapacity(cleanerId: number): Promise<CleanerCapacity | null> {
    const sql = `
      SELECT
        cleaner_id as cleanerId,
        max_daily_bookings as maxDailyBookings,
        max_concurrent_bookings as maxConcurrentBookings,
        current_load as currentLoad,
        today_bookings as todayBookings,
        last_booking_at as lastBookingAt
      FROM cleaner_capacity
      WHERE cleaner_id = ?
    `;

    const results = await query(sql, [cleanerId]) as RowDataPacket[];

    if (results.length === 0) return null;

    const capacity = results[0];
    return {
      ...capacity,
      availableCapacity: capacity.maxDailyBookings - capacity.todayBookings
    };
  }

  /**
   * Initialize capacity for cleaner
   */
  async initializeCapacity(cleanerId: number, options?: {
    maxDailyBookings?: number;
    maxConcurrentBookings?: number;
  }): Promise<void> {
    const sql = `
      INSERT INTO cleaner_capacity (
        cleaner_id, max_daily_bookings, max_concurrent_bookings,
        current_load, today_bookings
      ) VALUES (?, ?, ?, 0, 0)
      ON DUPLICATE KEY UPDATE
        max_daily_bookings = VALUES(max_daily_bookings),
        max_concurrent_bookings = VALUES(max_concurrent_bookings)
    `;

    await query(sql, [
      cleanerId,
      options?.maxDailyBookings || 10,
      options?.maxConcurrentBookings || 2
    ]);
  }

  /**
   * Update cleaner load
   */
  async updateCleanerLoad(cleanerId: number, increment: number = 1): Promise<void> {
    const sql = `
      UPDATE cleaner_capacity
      SET current_load = current_load + ?,
          today_bookings = today_bookings + ?,
          last_booking_at = NOW()
      WHERE cleaner_id = ?
    `;

    await query(sql, [increment, increment > 0 ? 1 : 0, cleanerId]);
  }

  /**
   * Check if cleaner can accept booking
   */
  async canAcceptBooking(cleanerId: number): Promise<{
    canAccept: boolean;
    reason?: string;
  }> {
    const capacity = await this.getCleanerCapacity(cleanerId);

    if (!capacity) {
      // Initialize capacity if not exists
      await this.initializeCapacity(cleanerId);
      return { canAccept: true };
    }

    // Check daily limit
    if (capacity.todayBookings >= capacity.maxDailyBookings) {
      return {
        canAccept: false,
        reason: `Daily limit reached (${capacity.maxDailyBookings} bookings)`
      };
    }

    // Check concurrent limit
    if (capacity.currentLoad >= capacity.maxConcurrentBookings) {
      return {
        canAccept: false,
        reason: `Concurrent booking limit reached (${capacity.maxConcurrentBookings})`
      };
    }

    return { canAccept: true };
  }

  /**
   * Find available cleaners for booking
   */
  async findAvailableCleaners(
    cityId: number,
    location: { latitude: number; longitude: number },
    requiredDuration: number
  ): Promise<any[]> {
    const sql = `
      SELECT
        u.id, u.name, u.phone, u.rating_average as rating,
        u.current_latitude as latitude, u.current_longitude as longitude,
        cc.current_load as currentLoad,
        cc.today_bookings as todayBookings,
        cc.max_daily_bookings as maxDailyBookings,
        cc.max_concurrent_bookings as maxConcurrentBookings,
        (6371 * acos(
          cos(radians(?)) * cos(radians(u.current_latitude)) *
          cos(radians(u.current_longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(u.current_latitude))
        )) AS distance
      FROM users u
      INNER JOIN cleaner_capacity cc ON cc.cleaner_id = u.id
      WHERE u.user_type = 'cleaner'
        AND u.is_available = TRUE
        AND u.status = 'active'
        AND u.is_verified = TRUE
        AND cc.current_load < cc.max_concurrent_bookings
        AND cc.today_bookings < cc.max_daily_bookings
      HAVING distance <= 10
      ORDER BY distance ASC, rating DESC
      LIMIT 20
    `;

    const cleaners = await query(sql, [
      location.latitude,
      location.longitude,
      location.latitude
    ]) as RowDataPacket[];

    return cleaners;
  }

  /**
   * Balance workload across cleaners
   */
  async balanceWorkload(bookingId: number, candidateCleaners: number[]): Promise<number | null> {
    if (candidateCleaners.length === 0) return null;

    // Get capacity for all candidates
    const capacities = await Promise.all(
      candidateCleaners.map(id => this.getCleanerCapacity(id))
    );

    // Filter out cleaners at capacity
    const availableCleaners = capacities
      .filter(c => c !== null && c.todayBookings < c.maxDailyBookings)
      .sort((a, b) => {
        // Prioritize cleaners with lower current load
        if (a!.currentLoad !== b!.currentLoad) {
          return a!.currentLoad - b!.currentLoad;
        }
        // Then by today's bookings
        return a!.todayBookings - b!.todayBookings;
      });

    if (availableCleaners.length === 0) return null;

    return availableCleaners[0]!.cleanerId;
  }

  /**
   * Reset daily counters (run at midnight)
   */
  async resetDailyCounters(): Promise<number> {
    const sql = `
      UPDATE cleaner_capacity
      SET today_bookings = 0
    `;

    const result = await query(sql) as ResultSetHeader;
    return result.affectedRows;
  }

  /**
   * Get workload statistics
   */
  async getWorkloadStats(cityId?: number): Promise<{
    totalCleaners: number;
    activeCleaners: number;
    averageLoad: number;
    overloadedCleaners: number;
    availableCapacity: number;
  }> {
    const sql = `
      SELECT
        COUNT(DISTINCT u.id) as totalCleaners,
        COUNT(DISTINCT CASE WHEN u.is_available = TRUE THEN u.id END) as activeCleaners,
        AVG(cc.current_load) as averageLoad,
        COUNT(DISTINCT CASE WHEN cc.current_load >= cc.max_concurrent_bookings THEN u.id END) as overloadedCleaners,
        SUM(cc.max_daily_bookings - cc.today_bookings) as availableCapacity
      FROM users u
      LEFT JOIN cleaner_capacity cc ON cc.cleaner_id = u.id
      WHERE u.user_type = 'cleaner'
        AND u.status = 'active'
    `;

    const result = await query(sql) as RowDataPacket[];

    return {
      totalCleaners: result[0].totalCleaners || 0,
      activeCleaners: result[0].activeCleaners || 0,
      averageLoad: parseFloat(result[0].averageLoad || 0),
      overloadedCleaners: result[0].overloadedCleaners || 0,
      availableCapacity: result[0].availableCapacity || 0
    };
  }

  /**
   * Get cleaner workload history
   */
  async getCleanerWorkloadHistory(
    cleanerId: number,
    days: number = 30
  ): Promise<any[]> {
    const sql = `
      SELECT
        DATE(b.created_at) as date,
        COUNT(*) as bookingsCount,
        SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) as completedCount,
        AVG(TIMESTAMPDIFF(MINUTE, b.started_at, b.completed_at)) as avgDuration
      FROM bookings b
      WHERE b.cleaner_id = ?
        AND b.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(b.created_at)
      ORDER BY date DESC
    `;

    return await query(sql, [cleanerId, days]) as RowDataPacket[];
  }

  /**
   * Update capacity limits
   */
  async updateCapacityLimits(
    cleanerId: number,
    limits: {
      maxDailyBookings?: number;
      maxConcurrentBookings?: number;
    }
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (limits.maxDailyBookings !== undefined) {
      fields.push('max_daily_bookings = ?');
      values.push(limits.maxDailyBookings);
    }

    if (limits.maxConcurrentBookings !== undefined) {
      fields.push('max_concurrent_bookings = ?');
      values.push(limits.maxConcurrentBookings);
    }

    if (fields.length === 0) return;

    values.push(cleanerId);
    const sql = `UPDATE cleaner_capacity SET ${fields.join(', ')} WHERE cleaner_id = ?`;

    await query(sql, values);
  }
}

export default new WorkloadService();
