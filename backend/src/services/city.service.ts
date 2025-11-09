import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface City {
  id?: number;
  name: string;
  code: string;
  country: string;
  timezone: string;
  currency: string;
  currencySymbol: string;
  defaultLanguage: string;
  supportedLanguages: string[];
  isActive: boolean;
  launchDate?: Date;
  latitude?: number;
  longitude?: number;
}

export interface CityConfig {
  cityId: number;
  operationalHours?: {
    [day: string]: { open: string; close: string; isOpen: boolean };
  };
  minBookingAmount?: number;
  platformFeePercentage?: number;
  maxServiceRadius?: number;
  emergencyContactPhone?: string;
  customConfig?: any;
}

export class CityService {
  /**
   * Get all active cities
   */
  async getAllCities(includeInactive: boolean = false): Promise<City[]> {
    let sql = `
      SELECT
        id, name, code, country, timezone, currency, currency_symbol as currencySymbol,
        default_language as defaultLanguage, supported_languages as supportedLanguages,
        is_active as isActive, launch_date as launchDate,
        latitude, longitude
      FROM cities
    `;

    if (!includeInactive) {
      sql += ` WHERE is_active = TRUE`;
    }

    sql += ` ORDER BY name ASC`;

    const cities = await query(sql) as RowDataPacket[];

    return cities.map(city => ({
      ...city,
      supportedLanguages: JSON.parse(city.supportedLanguages || '[]')
    }));
  }

  /**
   * Get city by ID
   */
  async getCityById(cityId: number): Promise<City | null> {
    const sql = `
      SELECT
        id, name, code, country, timezone, currency, currency_symbol as currencySymbol,
        default_language as defaultLanguage, supported_languages as supportedLanguages,
        is_active as isActive, launch_date as launchDate,
        latitude, longitude
      FROM cities
      WHERE id = ?
    `;

    const cities = await query(sql, [cityId]) as RowDataPacket[];

    if (cities.length === 0) return null;

    const city = cities[0];
    return {
      ...city,
      supportedLanguages: JSON.parse(city.supportedLanguages || '[]')
    };
  }

  /**
   * Get city by code
   */
  async getCityByCode(code: string): Promise<City | null> {
    const sql = `
      SELECT
        id, name, code, country, timezone, currency, currency_symbol as currencySymbol,
        default_language as defaultLanguage, supported_languages as supportedLanguages,
        is_active as isActive, launch_date as launchDate,
        latitude, longitude
      FROM cities
      WHERE code = ?
    `;

    const cities = await query(sql, [code.toUpperCase()]) as RowDataPacket[];

    if (cities.length === 0) return null;

    const city = cities[0];
    return {
      ...city,
      supportedLanguages: JSON.parse(city.supportedLanguages || '[]')
    };
  }

  /**
   * Create new city
   */
  async createCity(city: City): Promise<number> {
    const sql = `
      INSERT INTO cities (
        name, code, country, timezone, currency, currency_symbol,
        default_language, supported_languages, is_active, launch_date,
        latitude, longitude
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await query(sql, [
      city.name,
      city.code.toUpperCase(),
      city.country,
      city.timezone,
      city.currency,
      city.currencySymbol,
      city.defaultLanguage,
      JSON.stringify(city.supportedLanguages || []),
      city.isActive,
      city.launchDate || null,
      city.latitude || null,
      city.longitude || null
    ]) as ResultSetHeader;

    return result.insertId;
  }

  /**
   * Update city
   */
  async updateCity(cityId: number, updates: Partial<City>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }

    if (updates.code !== undefined) {
      fields.push('code = ?');
      values.push(updates.code.toUpperCase());
    }

    if (updates.country !== undefined) {
      fields.push('country = ?');
      values.push(updates.country);
    }

    if (updates.timezone !== undefined) {
      fields.push('timezone = ?');
      values.push(updates.timezone);
    }

    if (updates.currency !== undefined) {
      fields.push('currency = ?');
      values.push(updates.currency);
    }

    if (updates.currencySymbol !== undefined) {
      fields.push('currency_symbol = ?');
      values.push(updates.currencySymbol);
    }

    if (updates.defaultLanguage !== undefined) {
      fields.push('default_language = ?');
      values.push(updates.defaultLanguage);
    }

    if (updates.supportedLanguages !== undefined) {
      fields.push('supported_languages = ?');
      values.push(JSON.stringify(updates.supportedLanguages));
    }

    if (updates.isActive !== undefined) {
      fields.push('is_active = ?');
      values.push(updates.isActive);
    }

    if (updates.launchDate !== undefined) {
      fields.push('launch_date = ?');
      values.push(updates.launchDate);
    }

    if (updates.latitude !== undefined) {
      fields.push('latitude = ?');
      values.push(updates.latitude);
    }

    if (updates.longitude !== undefined) {
      fields.push('longitude = ?');
      values.push(updates.longitude);
    }

    if (fields.length === 0) return;

    values.push(cityId);
    const sql = `UPDATE cities SET ${fields.join(', ')} WHERE id = ?`;

    await query(sql, values);
  }

  /**
   * Get city configuration
   */
  async getCityConfig(cityId: number): Promise<CityConfig | null> {
    const sql = `
      SELECT
        city_id as cityId,
        operational_hours as operationalHours,
        min_booking_amount as minBookingAmount,
        platform_fee_percentage as platformFeePercentage,
        max_service_radius as maxServiceRadius,
        emergency_contact_phone as emergencyContactPhone,
        custom_config as customConfig
      FROM city_config
      WHERE city_id = ?
    `;

    const configs = await query(sql, [cityId]) as RowDataPacket[];

    if (configs.length === 0) return null;

    const config = configs[0];
    return {
      ...config,
      operationalHours: config.operationalHours ? JSON.parse(config.operationalHours) : null,
      customConfig: config.customConfig ? JSON.parse(config.customConfig) : null
    };
  }

  /**
   * Set city configuration
   */
  async setCityConfig(config: CityConfig): Promise<void> {
    const sql = `
      INSERT INTO city_config (
        city_id, operational_hours, min_booking_amount,
        platform_fee_percentage, max_service_radius,
        emergency_contact_phone, custom_config
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        operational_hours = VALUES(operational_hours),
        min_booking_amount = VALUES(min_booking_amount),
        platform_fee_percentage = VALUES(platform_fee_percentage),
        max_service_radius = VALUES(max_service_radius),
        emergency_contact_phone = VALUES(emergency_contact_phone),
        custom_config = VALUES(custom_config)
    `;

    await query(sql, [
      config.cityId,
      config.operationalHours ? JSON.stringify(config.operationalHours) : null,
      config.minBookingAmount || null,
      config.platformFeePercentage || null,
      config.maxServiceRadius || null,
      config.emergencyContactPhone || null,
      config.customConfig ? JSON.stringify(config.customConfig) : null
    ]);
  }

  /**
   * Check if city is operational at given time
   */
  async isCityOperational(cityId: number, datetime?: Date): Promise<boolean> {
    const config = await this.getCityConfig(cityId);
    if (!config || !config.operationalHours) return true; // No restrictions

    const checkTime = datetime || new Date();
    const city = await this.getCityById(cityId);
    if (!city) return false;

    // Convert to city timezone (simplified - would use a library like moment-timezone in production)
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[checkTime.getDay()];

    const hours = config.operationalHours[dayName];
    if (!hours || !hours.isOpen) return false;

    // Check if current time is within operational hours
    const currentTime = `${String(checkTime.getHours()).padStart(2, '0')}:${String(checkTime.getMinutes()).padStart(2, '0')}`;

    return currentTime >= hours.open && currentTime <= hours.close;
  }

  /**
   * Find nearest city by coordinates
   */
  async findNearestCity(latitude: number, longitude: number): Promise<City | null> {
    const sql = `
      SELECT
        id, name, code, country, timezone, currency, currency_symbol as currencySymbol,
        default_language as defaultLanguage, supported_languages as supportedLanguages,
        is_active as isActive, launch_date as launchDate,
        latitude, longitude,
        (6371 * acos(
          cos(radians(?)) * cos(radians(latitude)) *
          cos(radians(longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(latitude))
        )) AS distance
      FROM cities
      WHERE is_active = TRUE
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      ORDER BY distance ASC
      LIMIT 1
    `;

    const cities = await query(sql, [latitude, longitude, latitude]) as RowDataPacket[];

    if (cities.length === 0) return null;

    const city = cities[0];
    return {
      ...city,
      supportedLanguages: JSON.parse(city.supportedLanguages || '[]')
    };
  }

  /**
   * Get cities within radius of coordinates
   */
  async getCitiesInRadius(
    latitude: number,
    longitude: number,
    radiusKm: number = 100
  ): Promise<City[]> {
    const sql = `
      SELECT
        id, name, code, country, timezone, currency, currency_symbol as currencySymbol,
        default_language as defaultLanguage, supported_languages as supportedLanguages,
        is_active as isActive, launch_date as launchDate,
        latitude, longitude,
        (6371 * acos(
          cos(radians(?)) * cos(radians(latitude)) *
          cos(radians(longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(latitude))
        )) AS distance
      FROM cities
      WHERE is_active = TRUE
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      HAVING distance <= ?
      ORDER BY distance ASC
    `;

    const cities = await query(sql, [latitude, longitude, latitude, radiusKm]) as RowDataPacket[];

    return cities.map(city => ({
      ...city,
      supportedLanguages: JSON.parse(city.supportedLanguages || '[]')
    }));
  }

  /**
   * Get city statistics
   */
  async getCityStats(cityId: number, days: number = 30): Promise<{
    totalBookings: number;
    completedBookings: number;
    totalRevenue: number;
    activeCleaners: number;
    averageRating: number;
  }> {
    const sql = `
      SELECT
        COUNT(DISTINCT b.id) as totalBookings,
        SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) as completedBookings,
        SUM(CASE WHEN b.status = 'completed' THEN b.total_amount ELSE 0 END) as totalRevenue,
        COUNT(DISTINCT b.cleaner_id) as activeCleaners,
        AVG(r.rating) as averageRating
      FROM bookings b
      LEFT JOIN addresses a ON a.id = b.address_id
      LEFT JOIN ratings r ON r.booking_id = b.id
      WHERE b.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    // Note: This assumes we add city_id to addresses table or derive it from geo_zones
    const stats = await query(sql, [days]) as RowDataPacket[];

    return {
      totalBookings: stats[0].totalBookings || 0,
      completedBookings: stats[0].completedBookings || 0,
      totalRevenue: parseFloat(stats[0].totalRevenue || 0),
      activeCleaners: stats[0].activeCleaners || 0,
      averageRating: parseFloat(stats[0].averageRating || 0)
    };
  }

  /**
   * Activate or deactivate city
   */
  async setCityStatus(cityId: number, isActive: boolean): Promise<void> {
    const sql = `UPDATE cities SET is_active = ? WHERE id = ?`;
    await query(sql, [isActive, cityId]);
  }
}

export default new CityService();
