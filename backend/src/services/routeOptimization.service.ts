import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface RouteStop {
  bookingId: number;
  latitude: number;
  longitude: number;
  estimatedDuration: number;
  priority: number;
  scheduledTime?: Date;
}

export interface OptimizedRoute {
  cleanerId: number;
  stops: RouteStop[];
  totalDistance: number;
  totalDuration: number;
  estimatedStartTime: Date;
  estimatedEndTime: Date;
  efficiency: number;
}

export class RouteOptimizationService {
  /**
   * Calculate distance between two points using Haversine formula
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Optimize route using nearest neighbor algorithm with priority
   */
  async optimizeRoute(
    cleanerId: number,
    bookingIds: number[],
    startLocation?: { latitude: number; longitude: number }
  ): Promise<OptimizedRoute> {
    // Get cleaner's current location
    const cleanerSql = `
      SELECT current_latitude as latitude, current_longitude as longitude
      FROM users
      WHERE id = ? AND user_type = 'cleaner'
    `;
    const cleanerResult = await query(cleanerSql, [cleanerId]) as RowDataPacket[];

    if (cleanerResult.length === 0) {
      throw new Error('Cleaner not found');
    }

    const currentLocation = startLocation || {
      latitude: cleanerResult[0].latitude,
      longitude: cleanerResult[0].longitude
    };

    // Get booking locations
    const bookingsSql = `
      SELECT
        b.id as bookingId,
        a.latitude,
        a.longitude,
        SUM(bs.estimated_duration_minutes) as estimatedDuration,
        CASE
          WHEN b.booking_type = 'instant' THEN 10
          WHEN b.scheduled_time IS NOT NULL AND b.scheduled_time <= DATE_ADD(NOW(), INTERVAL 2 HOUR) THEN 8
          ELSE 5
        END as priority,
        b.scheduled_time as scheduledTime
      FROM bookings b
      INNER JOIN addresses a ON a.id = b.address_id
      INNER JOIN booking_services bs ON bs.booking_id = b.id
      WHERE b.id IN (?)
        AND b.status IN ('assigned', 'accepted')
      GROUP BY b.id, a.latitude, a.longitude, b.booking_type, b.scheduled_time
    `;

    const bookings = await query(bookingsSql, [bookingIds]) as RowDataPacket[];

    if (bookings.length === 0) {
      throw new Error('No valid bookings found');
    }

    // Nearest neighbor algorithm with priority weighting
    const stops: RouteStop[] = [];
    const unvisited = [...bookings];
    let current = currentLocation;
    let totalDistance = 0;
    let totalDuration = 0;

    while (unvisited.length > 0) {
      // Find nearest with priority weighting
      let minScore = Infinity;
      let nearestIndex = 0;

      for (let i = 0; i < unvisited.length; i++) {
        const booking = unvisited[i];
        const distance = this.calculateDistance(
          current.latitude,
          current.longitude,
          booking.latitude,
          booking.longitude
        );

        // Score = distance / priority (lower is better)
        // Higher priority bookings get lower scores
        const score = distance / booking.priority;

        if (score < minScore) {
          minScore = score;
          nearestIndex = i;
        }
      }

      const nearest = unvisited[nearestIndex];
      const distance = this.calculateDistance(
        current.latitude,
        current.longitude,
        nearest.latitude,
        nearest.longitude
      );

      stops.push({
        bookingId: nearest.bookingId,
        latitude: nearest.latitude,
        longitude: nearest.longitude,
        estimatedDuration: nearest.estimatedDuration,
        priority: nearest.priority,
        scheduledTime: nearest.scheduledTime
      });

      totalDistance += distance;
      totalDuration += nearest.estimatedDuration + this.estimateTravelTime(distance);

      current = { latitude: nearest.latitude, longitude: nearest.longitude };
      unvisited.splice(nearestIndex, 1);
    }

    // Calculate efficiency (bookings per km)
    const efficiency = stops.length / totalDistance;

    // Estimate times
    const now = new Date();
    const estimatedStartTime = now;
    const estimatedEndTime = new Date(now.getTime() + totalDuration * 60 * 1000);

    // Save optimized route
    await this.saveOptimizedRoute(cleanerId, stops, totalDistance, totalDuration);

    return {
      cleanerId,
      stops,
      totalDistance: Math.round(totalDistance * 100) / 100,
      totalDuration,
      estimatedStartTime,
      estimatedEndTime,
      efficiency: Math.round(efficiency * 100) / 100
    };
  }

  /**
   * Estimate travel time based on distance (assumes 30 km/h avg speed in city)
   */
  private estimateTravelTime(distanceKm: number): number {
    const avgSpeedKmh = 30;
    return (distanceKm / avgSpeedKmh) * 60; // Return minutes
  }

  /**
   * Save optimized route to database
   */
  private async saveOptimizedRoute(
    cleanerId: number,
    stops: RouteStop[],
    totalDistance: number,
    totalDuration: number
  ): Promise<number> {
    const sql = `
      INSERT INTO optimized_routes (
        cleaner_id, route_data, total_distance, total_duration,
        stop_count, created_at
      ) VALUES (?, ?, ?, ?, ?, NOW())
    `;

    const result = await query(sql, [
      cleanerId,
      JSON.stringify(stops),
      totalDistance,
      totalDuration,
      stops.length
    ]) as ResultSetHeader;

    return result.insertId;
  }

  /**
   * Get cleaner's daily route
   */
  async getCleanerDailyRoute(cleanerId: number, date?: Date): Promise<OptimizedRoute | null> {
    const targetDate = date || new Date();
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    const sql = `
      SELECT
        cleaner_id as cleanerId,
        route_data as routeData,
        total_distance as totalDistance,
        total_duration as totalDuration,
        created_at as createdAt
      FROM optimized_routes
      WHERE cleaner_id = ?
        AND created_at >= ?
        AND created_at <= ?
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const routes = await query(sql, [cleanerId, startOfDay, endOfDay]) as RowDataPacket[];

    if (routes.length === 0) return null;

    const route = routes[0];
    const stops = JSON.parse(route.routeData);

    return {
      cleanerId: route.cleanerId,
      stops,
      totalDistance: route.totalDistance,
      totalDuration: route.totalDuration,
      estimatedStartTime: new Date(),
      estimatedEndTime: new Date(Date.now() + route.totalDuration * 60 * 1000),
      efficiency: stops.length / route.totalDistance
    };
  }

  /**
   * Batch optimize routes for all active cleaners
   */
  async batchOptimizeRoutes(cityId?: number): Promise<OptimizedRoute[]> {
    // Get all cleaners with pending bookings
    let sql = `
      SELECT DISTINCT
        b.cleaner_id as cleanerId,
        GROUP_CONCAT(b.id) as bookingIds
      FROM bookings b
      WHERE b.status IN ('assigned', 'accepted')
        AND b.cleaner_id IS NOT NULL
    `;

    if (cityId) {
      sql += ` AND b.city_id = ?`;
    }

    sql += ` GROUP BY b.cleaner_id`;

    const cleaners = await query(sql, cityId ? [cityId] : []) as RowDataPacket[];

    const optimizedRoutes: OptimizedRoute[] = [];

    for (const cleaner of cleaners) {
      try {
        const bookingIds = cleaner.bookingIds.split(',').map((id: string) => parseInt(id));
        const route = await this.optimizeRoute(cleaner.cleanerId, bookingIds);
        optimizedRoutes.push(route);
      } catch (error) {
        console.error(`Failed to optimize route for cleaner ${cleaner.cleanerId}:`, error);
      }
    }

    return optimizedRoutes;
  }

  /**
   * Get route optimization statistics
   */
  async getRouteStats(cleanerId: number, days: number = 30): Promise<{
    avgDistance: number;
    avgDuration: number;
    avgStops: number;
    avgEfficiency: number;
    totalRoutes: number;
  }> {
    const sql = `
      SELECT
        AVG(total_distance) as avgDistance,
        AVG(total_duration) as avgDuration,
        AVG(stop_count) as avgStops,
        AVG(stop_count / total_distance) as avgEfficiency,
        COUNT(*) as totalRoutes
      FROM optimized_routes
      WHERE cleaner_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const result = await query(sql, [cleanerId, days]) as RowDataPacket[];

    return {
      avgDistance: parseFloat(result[0].avgDistance || 0),
      avgDuration: parseFloat(result[0].avgDuration || 0),
      avgStops: parseFloat(result[0].avgStops || 0),
      avgEfficiency: parseFloat(result[0].avgEfficiency || 0),
      totalRoutes: result[0].totalRoutes || 0
    };
  }

  /**
   * Re-optimize route when new booking added
   */
  async reoptimizeWithNewBooking(
    cleanerId: number,
    newBookingId: number
  ): Promise<OptimizedRoute> {
    // Get current route
    const currentRoute = await this.getCleanerDailyRoute(cleanerId);

    if (!currentRoute) {
      // No existing route, create new
      return await this.optimizeRoute(cleanerId, [newBookingId]);
    }

    // Add new booking to existing bookings
    const existingBookingIds = currentRoute.stops.map(stop => stop.bookingId);
    const allBookingIds = [...existingBookingIds, newBookingId];

    // Re-optimize with all bookings
    return await this.optimizeRoute(cleanerId, allBookingIds);
  }

  /**
   * Calculate route deviation (actual vs optimized)
   */
  async calculateRouteDeviation(routeId: number, actualStops: RouteStop[]): Promise<{
    plannedDistance: number;
    actualDistance: number;
    deviation: number;
    deviationPercent: number;
  }> {
    const sql = `
      SELECT route_data, total_distance
      FROM optimized_routes
      WHERE id = ?
    `;

    const routes = await query(sql, [routeId]) as RowDataPacket[];

    if (routes.length === 0) {
      throw new Error('Route not found');
    }

    const plannedStops = JSON.parse(routes[0].route_data);
    const plannedDistance = routes[0].total_distance;

    // Calculate actual distance
    let actualDistance = 0;
    for (let i = 1; i < actualStops.length; i++) {
      const prev = actualStops[i - 1];
      const curr = actualStops[i];
      actualDistance += this.calculateDistance(
        prev.latitude,
        prev.longitude,
        curr.latitude,
        curr.longitude
      );
    }

    const deviation = actualDistance - plannedDistance;
    const deviationPercent = (deviation / plannedDistance) * 100;

    return {
      plannedDistance,
      actualDistance: Math.round(actualDistance * 100) / 100,
      deviation: Math.round(deviation * 100) / 100,
      deviationPercent: Math.round(deviationPercent * 100) / 100
    };
  }
}

export default new RouteOptimizationService();
