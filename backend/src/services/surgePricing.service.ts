import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface SurgePricingRule {
  id?: number;
  cityId?: number;
  serviceId?: number;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  surgeMultiplier: number;
  minMultiplier?: number;
  maxMultiplier?: number;
  demandThreshold?: number;
  isActive: boolean;
  priority?: number;
}

export class SurgePricingService {
  /**
   * Calculate surge multiplier for a booking
   */
  async calculateSurgeMultiplier(
    cityId: number,
    serviceId: number,
    requestTime: Date = new Date()
  ): Promise<{ multiplier: number; ruleId?: number; reason: string }> {
    const dayOfWeek = requestTime.getDay();
    const timeStr = requestTime.toTimeString().substring(0, 5);

    // Get active demand
    const currentDemand = await this.getCurrentDemand(cityId);

    // Find applicable rules, ordered by priority
    const sql = `
      SELECT id, surge_multiplier, demand_threshold, min_multiplier, max_multiplier
      FROM surge_pricing_rules
      WHERE is_active = TRUE
        AND (city_id IS NULL OR city_id = ?)
        AND (service_id IS NULL OR service_id = ?)
        AND (day_of_week IS NULL OR day_of_week = ?)
        AND (start_time IS NULL OR start_time <= ?)
        AND (end_time IS NULL OR end_time >= ?)
      ORDER BY priority DESC, id DESC
      LIMIT 1
    `;

    const rules = await query(sql, [cityId, serviceId, dayOfWeek, timeStr, timeStr]) as RowDataPacket[];

    if (rules.length === 0) {
      return { multiplier: 1.0, reason: 'No surge pricing rules active' };
    }

    const rule = rules[0];

    // Check if demand threshold is met
    if (rule.demand_threshold && currentDemand < rule.demand_threshold) {
      return { multiplier: 1.0, reason: 'Demand below threshold' };
    }

    // Calculate dynamic multiplier based on demand
    let multiplier = rule.surge_multiplier;

    if (rule.demand_threshold && currentDemand > rule.demand_threshold) {
      const demandFactor = (currentDemand - rule.demand_threshold) * 0.1;
      multiplier = Math.min(
        rule.surge_multiplier + demandFactor,
        rule.max_multiplier || 3.0
      );
      multiplier = Math.max(multiplier, rule.min_multiplier || 1.0);
    }

    return {
      multiplier: parseFloat(multiplier.toFixed(2)),
      ruleId: rule.id,
      reason: currentDemand > (rule.demand_threshold || 0) ? 'High demand' : 'Time-based surge'
    };
  }

  /**
   * Apply surge pricing to booking
   */
  async applySurgePricing(
    bookingId: number,
    basePrice: number,
    cityId: number,
    serviceId: number
  ): Promise<{ finalPrice: number; surgeMultiplier: number }> {
    const { multiplier, ruleId } = await this.calculateSurgeMultiplier(cityId, serviceId);

    const finalPrice = Math.round(basePrice * multiplier * 100) / 100;

    // Record surge pricing history
    if (multiplier > 1.0) {
      await query(
        `INSERT INTO surge_pricing_history (booking_id, base_price, surge_multiplier, final_price, rule_id)
         VALUES (?, ?, ?, ?, ?)`,
        [bookingId, basePrice, multiplier, finalPrice, ruleId || null]
      );
    }

    return { finalPrice, surgeMultiplier: multiplier };
  }

  /**
   * Get current demand (active bookings in last hour)
   */
  private async getCurrentDemand(cityId: number): Promise<number> {
    const sql = `
      SELECT COUNT(*) as count
      FROM bookings
      WHERE city_id = ?
        AND status IN ('pending', 'assigned', 'accepted', 'in_progress')
        AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
    `;

    const result = await query(sql, [cityId]) as RowDataPacket[];
    return result[0].count || 0;
  }

  /**
   * Create surge pricing rule
   */
  async createRule(rule: SurgePricingRule): Promise<number> {
    const sql = `
      INSERT INTO surge_pricing_rules (
        city_id, service_id, day_of_week, start_time, end_time,
        surge_multiplier, min_multiplier, max_multiplier,
        demand_threshold, is_active, priority
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await query(sql, [
      rule.cityId || null,
      rule.serviceId || null,
      rule.dayOfWeek !== undefined ? rule.dayOfWeek : null,
      rule.startTime || null,
      rule.endTime || null,
      rule.surgeMultiplier,
      rule.minMultiplier || 1.0,
      rule.maxMultiplier || 3.0,
      rule.demandThreshold || null,
      rule.isActive,
      rule.priority || 0
    ]) as ResultSetHeader;

    return result.insertId;
  }

  /**
   * Get surge history for analysis
   */
  async getSurgeHistory(cityId?: number, days: number = 7): Promise<any[]> {
    let sql = `
      SELECT
        DATE(sph.applied_at) as date,
        AVG(sph.surge_multiplier) as avgMultiplier,
        MAX(sph.surge_multiplier) as maxMultiplier,
        COUNT(*) as totalBookings
      FROM surge_pricing_history sph
      INNER JOIN bookings b ON b.id = sph.booking_id
      WHERE sph.applied_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const params: any[] = [days];

    if (cityId) {
      sql += ` AND b.city_id = ?`;
      params.push(cityId);
    }

    sql += ` GROUP BY DATE(sph.applied_at) ORDER BY date DESC`;

    return await query(sql, params) as RowDataPacket[];
  }
}

export default new SurgePricingService();
