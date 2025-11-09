import { query } from '../config/database';
import { RowDataPacket } from 'mysql2';

interface Point {
  latitude: number;
  longitude: number;
}

export class GeoFencingService {
  /**
   * Check if point is within a zone
   */
  async isPointInZone(point: Point, zoneId: number): Promise<boolean> {
    const zone = await this.getZone(zoneId);
    if (!zone) return false;

    if (zone.radiusMeters) {
      // Circular zone
      return this.isPointInCircle(point, zone.centerLatitude, zone.centerLongitude, zone.radiusMeters);
    } else {
      // Polygon zone
      const coordinates = JSON.parse(zone.polygonCoordinates);
      return this.isPointInPolygon(point, coordinates);
    }
  }

  /**
   * Find zones containing a point
   */
  async findZonesForPoint(point: Point, cityId: number): Promise<any[]> {
    const sql = `
      SELECT id, name, zone_type, polygon_coordinates,
             center_latitude, center_longitude, radius_meters
      FROM geo_zones
      WHERE city_id = ? AND is_active = TRUE
      ORDER BY priority DESC
    `;

    const zones = await query(sql, [cityId]) as RowDataPacket[];
    const matchingZones: any[] = [];

    for (const zone of zones) {
      const inZone = zone.radius_meters
        ? this.isPointInCircle(point, zone.center_latitude, zone.center_longitude, zone.radius_meters)
        : this.isPointInPolygon(point, JSON.parse(zone.polygon_coordinates));

      if (inZone) {
        matchingZones.push(zone);
      }
    }

    return matchingZones;
  }

  /**
   * Calculate price adjustment for zone
   */
  async getZonePriceAdjustment(
    zoneId: number,
    serviceId: number,
    basePrice: number
  ): Promise<{ adjustedPrice: number; adjustment: number }> {
    const sql = `
      SELECT base_price_adjustment, price_multiplier, min_fare
      FROM zone_pricing
      WHERE zone_id = ? AND (service_id IS NULL OR service_id = ?)
      ORDER BY service_id DESC
      LIMIT 1
    `;

    const pricing = await query(sql, [zoneId, serviceId]) as RowDataPacket[];

    if (pricing.length === 0) {
      return { adjustedPrice: basePrice, adjustment: 0 };
    }

    const p = pricing[0];
    let adjustedPrice = (basePrice * p.price_multiplier) + p.base_price_adjustment;

    if (p.min_fare && adjustedPrice < p.min_fare) {
      adjustedPrice = p.min_fare;
    }

    return {
      adjustedPrice: Math.round(adjustedPrice * 100) / 100,
      adjustment: Math.round((adjustedPrice - basePrice) * 100) / 100
    };
  }

  /**
   * Check if service available in zone
   */
  async isServiceAvailable(point: Point, cityId: number): Promise<boolean> {
    const zones = await this.findZonesForPoint(point, cityId);

    // Check if any zone is a service area
    const serviceArea = zones.find(z => z.zone_type === 'service_area');
    if (serviceArea) return true;

    // Check if in restricted zone
    const restricted = zones.find(z => z.zone_type === 'restricted');
    if (restricted) return false;

    // Default: not available if no service area found
    return zones.length === 0 ? false : true;
  }

  /**
   * Get available cleaners in zone
   */
  async getCleanersInZone(zoneId: number, isAvailable: boolean = true): Promise<number[]> {
    const zone = await this.getZone(zoneId);
    if (!zone) return [];

    // Get cleaners whose last location is within zone
    const sql = `
      SELECT DISTINCT cl.cleaner_id
      FROM cleaner_locations cl
      INNER JOIN users u ON u.id = cl.cleaner_id
      WHERE u.is_available = ?
        AND cl.recorded_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
        AND cl.id IN (
          SELECT MAX(id) FROM cleaner_locations GROUP BY cleaner_id
        )
    `;

    const locations = await query(sql, [isAvailable]) as RowDataPacket[];
    const cleanersInZone: number[] = [];

    for (const loc of locations) {
      const inZone = await this.isPointInZone(
        { latitude: loc.latitude, longitude: loc.longitude },
        zoneId
      );

      if (inZone) {
        cleanersInZone.push(loc.cleaner_id);
      }
    }

    return cleanersInZone;
  }

  /**
   * Point in polygon check (Ray casting algorithm)
   */
  private isPointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;
    const x = point.latitude;
    const y = point.longitude;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].latitude;
      const yi = polygon[i].longitude;
      const xj = polygon[j].latitude;
      const yj = polygon[j].longitude;

      const intersect =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

      if (intersect) inside = !inside;
    }

    return inside;
  }

  /**
   * Point in circle check
   */
  private isPointInCircle(
    point: Point,
    centerLat: number,
    centerLon: number,
    radiusMeters: number
  ): boolean {
    const distance = this.calculateDistance(
      point.latitude,
      point.longitude,
      centerLat,
      centerLon
    );

    return distance * 1000 <= radiusMeters; // Convert km to meters
  }

  /**
   * Calculate distance using Haversine formula
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Get zone details
   */
  private async getZone(zoneId: number): Promise<any> {
    const sql = `
      SELECT id, name, zone_type, polygon_coordinates,
             center_latitude as centerLatitude,
             center_longitude as centerLongitude,
             radius_meters as radiusMeters
      FROM geo_zones
      WHERE id = ? AND is_active = TRUE
    `;

    const zones = await query(sql, [zoneId]) as RowDataPacket[];
    return zones.length > 0 ? zones[0] : null;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}

export default new GeoFencingService();
