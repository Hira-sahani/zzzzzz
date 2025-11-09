import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  altitude?: number;
}

export interface CleanerLocation extends LocationData {
  id: number;
  cleanerId: number;
  bookingId?: number;
  recordedAt: Date;
  createdAt: Date;
}

export class LocationTrackingService {
  /**
   * Record cleaner's location
   */
  async recordLocation(
    cleanerId: number,
    location: LocationData,
    bookingId?: number
  ): Promise<number> {
    const sql = `
      INSERT INTO cleaner_locations (
        cleaner_id,
        booking_id,
        latitude,
        longitude,
        accuracy,
        speed,
        heading,
        altitude,
        recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const result = await query(sql, [
      cleanerId,
      bookingId || null,
      location.latitude,
      location.longitude,
      location.accuracy || null,
      location.speed || null,
      location.heading || null,
      location.altitude || null
    ]) as ResultSetHeader;

    return result.insertId;
  }

  /**
   * Get cleaner's latest location
   */
  async getLatestLocation(cleanerId: number): Promise<CleanerLocation | null> {
    const sql = `
      SELECT
        id,
        cleaner_id as cleanerId,
        booking_id as bookingId,
        latitude,
        longitude,
        accuracy,
        speed,
        heading,
        altitude,
        recorded_at as recordedAt,
        created_at as createdAt
      FROM cleaner_locations
      WHERE cleaner_id = ?
      ORDER BY recorded_at DESC
      LIMIT 1
    `;

    const results = await query(sql, [cleanerId]) as RowDataPacket[];
    return results.length > 0 ? results[0] as CleanerLocation : null;
  }

  /**
   * Get cleaner's location history for a booking
   */
  async getLocationHistory(
    cleanerId: number,
    bookingId: number,
    limit: number = 100
  ): Promise<CleanerLocation[]> {
    const sql = `
      SELECT
        id,
        cleaner_id as cleanerId,
        booking_id as bookingId,
        latitude,
        longitude,
        accuracy,
        speed,
        heading,
        altitude,
        recorded_at as recordedAt,
        created_at as createdAt
      FROM cleaner_locations
      WHERE cleaner_id = ? AND booking_id = ?
      ORDER BY recorded_at DESC
      LIMIT ?
    `;

    const results = await query(sql, [cleanerId, bookingId, limit]) as RowDataPacket[];
    return results as CleanerLocation[];
  }

  /**
   * Get real-time location for active booking
   */
  async getActiveBookingLocation(bookingId: number): Promise<CleanerLocation | null> {
    const sql = `
      SELECT
        cl.id,
        cl.cleaner_id as cleanerId,
        cl.booking_id as bookingId,
        cl.latitude,
        cl.longitude,
        cl.accuracy,
        cl.speed,
        cl.heading,
        cl.altitude,
        cl.recorded_at as recordedAt,
        cl.created_at as createdAt
      FROM cleaner_locations cl
      INNER JOIN bookings b ON b.id = cl.booking_id
      WHERE cl.booking_id = ?
        AND b.status IN ('accepted', 'in_progress')
      ORDER BY cl.recorded_at DESC
      LIMIT 1
    `;

    const results = await query(sql, [bookingId]) as RowDataPacket[];
    return results.length > 0 ? results[0] as CleanerLocation : null;
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in kilometers
  }

  /**
   * Check if cleaner is near the booking location
   */
  async isCleanerNearLocation(
    cleanerId: number,
    targetLat: number,
    targetLon: number,
    radiusKm: number = 0.1 // 100 meters default
  ): Promise<boolean> {
    const location = await this.getLatestLocation(cleanerId);

    if (!location) {
      return false;
    }

    const distance = this.calculateDistance(
      location.latitude,
      location.longitude,
      targetLat,
      targetLon
    );

    return distance <= radiusKm;
  }

  /**
   * Delete old location data (privacy/cleanup)
   */
  async deleteOldLocations(daysOld: number = 90): Promise<number> {
    const sql = `
      DELETE FROM cleaner_locations
      WHERE recorded_at < DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const result = await query(sql, [daysOld]) as ResultSetHeader;
    return result.affectedRows;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}

export default new LocationTrackingService();
