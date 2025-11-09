import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface ShiftSwapRequest {
  id?: number;
  requesterId: number;
  bookingId: number;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  acceptedBy?: number;
  createdAt: Date;
}

export class ShiftSwapService {
  /**
   * Create shift swap request
   */
  async createSwapRequest(data: {
    requesterId: number;
    bookingId: number;
    reason: string;
  }): Promise<number> {
    // Verify requester owns the booking
    const bookingSql = `
      SELECT cleaner_id, status, scheduled_time
      FROM bookings
      WHERE id = ?
    `;

    const bookings = await query(bookingSql, [data.bookingId]) as RowDataPacket[];

    if (bookings.length === 0) {
      throw new Error('Booking not found');
    }

    if (bookings[0].cleaner_id !== data.requesterId) {
      throw new Error('Only assigned cleaner can request swap');
    }

    if (!['assigned', 'accepted'].includes(bookings[0].status)) {
      throw new Error('Booking cannot be swapped in current status');
    }

    const sql = `
      INSERT INTO shift_swap_requests (
        requester_id, booking_id, reason, status, created_at
      ) VALUES (?, ?, ?, 'pending', NOW())
    `;

    const result = await query(sql, [
      data.requesterId,
      data.bookingId,
      data.reason
    ]) as ResultSetHeader;

    // Notify other available cleaners
    await this.notifyAvailableCleaners(result.insertId, data.bookingId);

    return result.insertId;
  }

  /**
   * Notify available cleaners
   */
  private async notifyAvailableCleaners(swapRequestId: number, bookingId: number): Promise<void> {
    // Get booking details
    const bookingSql = `
      SELECT
        b.id,
        b.scheduled_time,
        a.latitude,
        a.longitude,
        SUM(bs.estimated_duration_minutes) as totalDuration
      FROM bookings b
      INNER JOIN addresses a ON a.id = b.address_id
      INNER JOIN booking_services bs ON bs.booking_id = b.id
      WHERE b.id = ?
      GROUP BY b.id, b.scheduled_time, a.latitude, a.longitude
    `;

    const booking = await query(bookingSql, [bookingId]) as RowDataPacket[];

    if (booking.length === 0) return;

    // Find available cleaners nearby
    const cleanersSql = `
      SELECT
        u.id,
        u.name,
        u.phone,
        (6371 * acos(
          cos(radians(?)) * cos(radians(u.current_latitude)) *
          cos(radians(u.current_longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(u.current_latitude))
        )) AS distance
      FROM users u
      WHERE u.user_type = 'cleaner'
        AND u.is_available = TRUE
        AND u.status = 'active'
      HAVING distance <= 10
      ORDER BY distance ASC
      LIMIT 20
    `;

    const cleaners = await query(cleanersSql, [
      booking[0].latitude,
      booking[0].longitude,
      booking[0].latitude
    ]) as RowDataPacket[];

    // TODO: Send push notifications to cleaners
    console.log(`Notified ${cleaners.length} cleaners about swap request ${swapRequestId}`);
  }

  /**
   * Accept swap request
   */
  async acceptSwapRequest(swapRequestId: number, cleanerId: number): Promise<void> {
    // Get swap request
    const swapSql = `
      SELECT
        requester_id, booking_id, status
      FROM shift_swap_requests
      WHERE id = ?
    `;

    const swaps = await query(swapSql, [swapRequestId]) as RowDataPacket[];

    if (swaps.length === 0) {
      throw new Error('Swap request not found');
    }

    if (swaps[0].status !== 'pending') {
      throw new Error('Swap request already processed');
    }

    // Check cleaner availability
    const canAccept = await this.checkCleanerAvailability(cleanerId, swaps[0].booking_id);

    if (!canAccept) {
      throw new Error('Cleaner not available for this booking');
    }

    // Update swap request
    await query(
      'UPDATE shift_swap_requests SET status = ?, accepted_by = ?, accepted_at = NOW() WHERE id = ?',
      ['accepted', cleanerId, swapRequestId]
    );

    // Update booking
    await query(
      'UPDATE bookings SET cleaner_id = ?, updated_at = NOW() WHERE id = ?',
      [cleanerId, swaps[0].booking_id]
    );

    // Notify both cleaners
    console.log(`Swap request ${swapRequestId} accepted by cleaner ${cleanerId}`);
  }

  /**
   * Check if cleaner is available
   */
  private async checkCleanerAvailability(cleanerId: number, bookingId: number): Promise<boolean> {
    // Get booking time
    const bookingSql = `
      SELECT scheduled_time, SUM(bs.estimated_duration_minutes) as totalDuration
      FROM bookings b
      INNER JOIN booking_services bs ON bs.booking_id = b.id
      WHERE b.id = ?
      GROUP BY b.scheduled_time
    `;

    const booking = await query(bookingSql, [bookingId]) as RowDataPacket[];

    if (booking.length === 0) return false;

    const scheduledTime = new Date(booking[0].scheduled_time);
    const duration = booking[0].totalDuration;

    // Check for conflicts
    const conflictSql = `
      SELECT COUNT(*) as count
      FROM bookings b
      INNER JOIN booking_services bs ON bs.booking_id = b.id
      WHERE b.cleaner_id = ?
        AND b.status IN ('assigned', 'accepted', 'in_progress')
        AND (
          (b.scheduled_time <= ? AND DATE_ADD(b.scheduled_time, INTERVAL bs.estimated_duration_minutes MINUTE) > ?) OR
          (b.scheduled_time < DATE_ADD(?, INTERVAL ? MINUTE) AND b.scheduled_time >= ?)
        )
    `;

    const conflicts = await query(conflictSql, [
      cleanerId,
      scheduledTime,
      scheduledTime,
      scheduledTime,
      duration,
      scheduledTime
    ]) as RowDataPacket[];

    return conflicts[0].count === 0;
  }

  /**
   * Reject swap request
   */
  async rejectSwapRequest(swapRequestId: number, cleanerId: number, reason?: string): Promise<void> {
    await query(
      'UPDATE shift_swap_requests SET status = ?, rejected_by = ?, rejection_reason = ?, rejected_at = NOW() WHERE id = ? AND status = ?',
      ['rejected', cleanerId, reason || null, swapRequestId, 'pending']
    );
  }

  /**
   * Get pending swap requests
   */
  async getPendingSwapRequests(cleanerId?: number): Promise<any[]> {
    let sql = `
      SELECT
        ssr.id,
        ssr.requester_id as requesterId,
        ssr.booking_id as bookingId,
        ssr.reason,
        ssr.created_at as createdAt,
        u.name as requesterName,
        b.scheduled_time as scheduledTime,
        a.latitude,
        a.longitude,
        SUM(bs.estimated_duration_minutes) as totalDuration
      FROM shift_swap_requests ssr
      INNER JOIN users u ON u.id = ssr.requester_id
      INNER JOIN bookings b ON b.id = ssr.booking_id
      INNER JOIN addresses a ON a.id = b.address_id
      INNER JOIN booking_services bs ON bs.booking_id = b.id
      WHERE ssr.status = 'pending'
    `;

    const params: any[] = [];

    if (cleanerId) {
      // Filter by cleaners nearby
      sql += ` AND (6371 * acos(
        cos(radians((SELECT current_latitude FROM users WHERE id = ?))) *
        cos(radians(a.latitude)) *
        cos(radians(a.longitude) - radians((SELECT current_longitude FROM users WHERE id = ?))) +
        sin(radians((SELECT current_latitude FROM users WHERE id = ?))) *
        sin(radians(a.latitude))
      )) <= 10`;
      params.push(cleanerId, cleanerId, cleanerId);
    }

    sql += ` GROUP BY ssr.id, ssr.requester_id, ssr.booking_id, ssr.reason, ssr.created_at,
             u.name, b.scheduled_time, a.latitude, a.longitude
             ORDER BY ssr.created_at DESC`;

    return await query(sql, params) as RowDataPacket[];
  }

  /**
   * Get swap statistics
   */
  async getSwapStats(days: number = 30): Promise<{
    totalRequests: number;
    accepted: number;
    rejected: number;
    pending: number;
    acceptanceRate: number;
    avgResponseTime: number;
  }> {
    const sql = `
      SELECT
        COUNT(*) as totalRequests,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        AVG(CASE
          WHEN status = 'accepted' THEN TIMESTAMPDIFF(MINUTE, created_at, accepted_at)
          WHEN status = 'rejected' THEN TIMESTAMPDIFF(MINUTE, created_at, rejected_at)
          ELSE NULL
        END) as avgResponseTime
      FROM shift_swap_requests
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const result = await query(sql, [days]) as RowDataPacket[];

    const totalRequests = result[0].totalRequests || 0;
    const accepted = result[0].accepted || 0;

    return {
      totalRequests,
      accepted,
      rejected: result[0].rejected || 0,
      pending: result[0].pending || 0,
      acceptanceRate: totalRequests > 0 ? Math.round((accepted / totalRequests) * 100) : 0,
      avgResponseTime: parseFloat(result[0].avgResponseTime || 0)
    };
  }
}

export default new ShiftSwapService();
