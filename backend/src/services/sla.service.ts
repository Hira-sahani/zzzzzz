import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface SLAPolicy {
  id?: number;
  violationType: 'late_response' | 'late_arrival' | 'no_show' | 'poor_quality' | 'incomplete_service';
  description: string;
  thresholdMinutes?: number;
  ratingThreshold?: number;
  penaltyType: 'percentage' | 'fixed' | 'warning';
  penaltyAmount?: number;
  maxPenalty?: number;
  warningsBeforePenalty: number;
  isActive: boolean;
}

export interface SLAViolation {
  bookingId: number;
  cleanerId: number;
  violationType: string;
  description: string;
  penaltyAmount: number;
  wasWarning: boolean;
}

export class SLAService {
  /**
   * Check for SLA violations after booking completion
   */
  async checkBookingViolations(bookingId: number): Promise<SLAViolation[]> {
    const violations: SLAViolation[] = [];

    // Get booking details with timestamps
    const sqlBooking = `
      SELECT
        b.id, b.cleaner_id, b.customer_id,
        b.assigned_at, b.accepted_at, b.started_at, b.completed_at,
        b.status, b.total_amount, b.cleaner_earnings,
        r.rating, r.quality_rating
      FROM bookings b
      LEFT JOIN ratings r ON r.booking_id = b.id AND r.rated_id = b.cleaner_id
      WHERE b.id = ?
    `;

    const bookings = await query(sqlBooking, [bookingId]) as RowDataPacket[];
    if (bookings.length === 0) return violations;

    const booking = bookings[0];
    if (!booking.cleaner_id) return violations;

    // Check late response (assigned to accepted)
    if (booking.assigned_at && booking.accepted_at) {
      const responseTime = (new Date(booking.accepted_at).getTime() - new Date(booking.assigned_at).getTime()) / 1000 / 60;
      const responsePolicy = await this.getPolicy('late_response');

      if (responsePolicy && responsePolicy.thresholdMinutes && responseTime > responsePolicy.thresholdMinutes) {
        const violation = await this.createViolation({
          bookingId: booking.id,
          cleanerId: booking.cleaner_id,
          violationType: 'late_response',
          description: `Response time: ${Math.round(responseTime)} minutes (threshold: ${responsePolicy.thresholdMinutes} minutes)`,
          penaltyAmount: await this.calculatePenalty(booking.cleaner_id, responsePolicy, booking.cleaner_earnings),
          wasWarning: false
        });
        violations.push(violation);
      }
    }

    // Check late arrival (accepted to started)
    if (booking.accepted_at && booking.started_at) {
      const travelTime = (new Date(booking.started_at).getTime() - new Date(booking.accepted_at).getTime()) / 1000 / 60;
      const arrivalPolicy = await this.getPolicy('late_arrival');

      if (arrivalPolicy && arrivalPolicy.thresholdMinutes && travelTime > arrivalPolicy.thresholdMinutes) {
        const violation = await this.createViolation({
          bookingId: booking.id,
          cleanerId: booking.cleaner_id,
          violationType: 'late_arrival',
          description: `Arrival time: ${Math.round(travelTime)} minutes (threshold: ${arrivalPolicy.thresholdMinutes} minutes)`,
          penaltyAmount: await this.calculatePenalty(booking.cleaner_id, arrivalPolicy, booking.cleaner_earnings),
          wasWarning: false
        });
        violations.push(violation);
      }
    }

    // Check no-show
    if (booking.status === 'cancelled' && booking.accepted_at && !booking.started_at) {
      const noShowPolicy = await this.getPolicy('no_show');
      if (noShowPolicy) {
        const violation = await this.createViolation({
          bookingId: booking.id,
          cleanerId: booking.cleaner_id,
          violationType: 'no_show',
          description: 'Cleaner accepted job but did not arrive',
          penaltyAmount: await this.calculatePenalty(booking.cleaner_id, noShowPolicy, booking.cleaner_earnings),
          wasWarning: false
        });
        violations.push(violation);
      }
    }

    // Check poor quality (based on rating)
    if (booking.rating || booking.quality_rating) {
      const avgRating = booking.quality_rating || booking.rating;
      const qualityPolicy = await this.getPolicy('poor_quality');

      if (qualityPolicy && qualityPolicy.ratingThreshold && avgRating < qualityPolicy.ratingThreshold) {
        const violation = await this.createViolation({
          bookingId: booking.id,
          cleanerId: booking.cleaner_id,
          violationType: 'poor_quality',
          description: `Quality rating: ${avgRating} (threshold: ${qualityPolicy.ratingThreshold})`,
          penaltyAmount: await this.calculatePenalty(booking.cleaner_id, qualityPolicy, booking.cleaner_earnings),
          wasWarning: false
        });
        violations.push(violation);
      }
    }

    // Check incomplete service
    const sqlServices = `
      SELECT COUNT(*) as total, SUM(is_completed) as completed
      FROM booking_services
      WHERE booking_id = ?
    `;
    const services = await query(sqlServices, [bookingId]) as RowDataPacket[];

    if (services[0].total > 0 && services[0].completed < services[0].total) {
      const incompletePolicy = await this.getPolicy('incomplete_service');
      if (incompletePolicy) {
        const violation = await this.createViolation({
          bookingId: booking.id,
          cleanerId: booking.cleaner_id,
          violationType: 'incomplete_service',
          description: `Completed ${services[0].completed} of ${services[0].total} services`,
          penaltyAmount: await this.calculatePenalty(booking.cleaner_id, incompletePolicy, booking.cleaner_earnings),
          wasWarning: false
        });
        violations.push(violation);
      }
    }

    return violations;
  }

  /**
   * Calculate penalty amount based on policy and cleaner history
   */
  private async calculatePenalty(
    cleanerId: number,
    policy: SLAPolicy,
    bookingEarnings: number
  ): Promise<number> {
    // Get recent violations count (last 30 days)
    const sqlHistory = `
      SELECT COUNT(*) as count
      FROM sla_violations
      WHERE cleaner_id = ?
        AND violation_type = ?
        AND detected_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `;

    const history = await query(sqlHistory, [cleanerId, policy.violationType]) as RowDataPacket[];
    const recentViolations = history[0].count || 0;

    // Check if warnings before penalty
    if (recentViolations < policy.warningsBeforePenalty) {
      return 0; // Warning only, no penalty
    }

    // Calculate penalty
    let penaltyAmount = 0;

    if (policy.penaltyType === 'percentage' && policy.penaltyAmount) {
      penaltyAmount = (bookingEarnings * policy.penaltyAmount) / 100;
    } else if (policy.penaltyType === 'fixed' && policy.penaltyAmount) {
      penaltyAmount = policy.penaltyAmount;
    }

    // Apply max penalty cap
    if (policy.maxPenalty && penaltyAmount > policy.maxPenalty) {
      penaltyAmount = policy.maxPenalty;
    }

    return Math.round(penaltyAmount * 100) / 100;
  }

  /**
   * Create SLA violation record
   */
  private async createViolation(data: SLAViolation): Promise<SLAViolation> {
    // Check if this is a warning
    const sqlHistory = `
      SELECT COUNT(*) as count
      FROM sla_violations
      WHERE cleaner_id = ?
        AND violation_type = ?
        AND detected_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `;

    const history = await query(sqlHistory, [data.cleanerId, data.violationType]) as RowDataPacket[];
    const policy = await this.getPolicy(data.violationType);

    const isWarning = policy ? history[0].count < policy.warningsBeforePenalty : false;

    const sql = `
      INSERT INTO sla_violations (
        booking_id, cleaner_id, violation_type, description,
        penalty_amount, was_warning, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())
    `;

    await query(sql, [
      data.bookingId,
      data.cleanerId,
      data.violationType,
      data.description,
      isWarning ? 0 : data.penaltyAmount,
      isWarning
    ]);

    return {
      ...data,
      penaltyAmount: isWarning ? 0 : data.penaltyAmount,
      wasWarning: isWarning
    };
  }

  /**
   * Get SLA policy by violation type
   */
  async getPolicy(violationType: string): Promise<SLAPolicy | null> {
    const sql = `
      SELECT
        id, violation_type as violationType, description,
        threshold_minutes as thresholdMinutes,
        rating_threshold as ratingThreshold,
        penalty_type as penaltyType,
        penalty_amount as penaltyAmount,
        max_penalty as maxPenalty,
        warnings_before_penalty as warningsBeforePenalty,
        is_active as isActive
      FROM sla_policies
      WHERE violation_type = ? AND is_active = TRUE
      LIMIT 1
    `;

    const policies = await query(sql, [violationType]) as RowDataPacket[];
    return policies.length > 0 ? policies[0] as SLAPolicy : null;
  }

  /**
   * Get cleaner violations summary
   */
  async getCleanerViolations(cleanerId: number, days: number = 30): Promise<{
    total: number;
    byType: { [key: string]: number };
    totalPenalties: number;
    warnings: number;
  }> {
    const sql = `
      SELECT
        violation_type,
        COUNT(*) as count,
        SUM(penalty_amount) as totalPenalty,
        SUM(CASE WHEN was_warning = TRUE THEN 1 ELSE 0 END) as warnings
      FROM sla_violations
      WHERE cleaner_id = ?
        AND detected_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY violation_type
    `;

    const violations = await query(sql, [cleanerId, days]) as RowDataPacket[];

    const byType: { [key: string]: number } = {};
    let total = 0;
    let totalPenalties = 0;
    let warnings = 0;

    violations.forEach(v => {
      byType[v.violation_type] = v.count;
      total += v.count;
      totalPenalties += parseFloat(v.totalPenalty || 0);
      warnings += v.warnings;
    });

    return {
      total,
      byType,
      totalPenalties: Math.round(totalPenalties * 100) / 100,
      warnings
    };
  }

  /**
   * Create or update SLA policy
   */
  async upsertPolicy(policy: SLAPolicy): Promise<number> {
    if (policy.id) {
      const sql = `
        UPDATE sla_policies
        SET description = ?,
            threshold_minutes = ?,
            rating_threshold = ?,
            penalty_type = ?,
            penalty_amount = ?,
            max_penalty = ?,
            warnings_before_penalty = ?,
            is_active = ?
        WHERE id = ?
      `;

      await query(sql, [
        policy.description,
        policy.thresholdMinutes || null,
        policy.ratingThreshold || null,
        policy.penaltyType,
        policy.penaltyAmount || null,
        policy.maxPenalty || null,
        policy.warningsBeforePenalty,
        policy.isActive,
        policy.id
      ]);

      return policy.id;
    } else {
      const sql = `
        INSERT INTO sla_policies (
          violation_type, description, threshold_minutes, rating_threshold,
          penalty_type, penalty_amount, max_penalty, warnings_before_penalty, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await query(sql, [
        policy.violationType,
        policy.description,
        policy.thresholdMinutes || null,
        policy.ratingThreshold || null,
        policy.penaltyType,
        policy.penaltyAmount || null,
        policy.maxPenalty || null,
        policy.warningsBeforePenalty,
        policy.isActive
      ]) as ResultSetHeader;

      return result.insertId;
    }
  }

  /**
   * Get all SLA policies
   */
  async getAllPolicies(): Promise<SLAPolicy[]> {
    const sql = `
      SELECT
        id, violation_type as violationType, description,
        threshold_minutes as thresholdMinutes,
        rating_threshold as ratingThreshold,
        penalty_type as penaltyType,
        penalty_amount as penaltyAmount,
        max_penalty as maxPenalty,
        warnings_before_penalty as warningsBeforePenalty,
        is_active as isActive
      FROM sla_policies
      ORDER BY id ASC
    `;

    return await query(sql) as SLAPolicy[];
  }

  /**
   * Get violations report for admin
   */
  async getViolationsReport(filters: {
    cleanerId?: number;
    violationType?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }): Promise<{
    violations: any[];
    total: number;
  }> {
    let sql = `
      SELECT
        v.id, v.booking_id, v.cleaner_id, v.violation_type,
        v.description, v.penalty_amount, v.was_warning, v.detected_at,
        u.name as cleanerName,
        b.booking_number
      FROM sla_violations v
      INNER JOIN users u ON u.id = v.cleaner_id
      INNER JOIN bookings b ON b.id = v.booking_id
      WHERE 1=1
    `;

    const params: any[] = [];

    if (filters.cleanerId) {
      sql += ` AND v.cleaner_id = ?`;
      params.push(filters.cleanerId);
    }

    if (filters.violationType) {
      sql += ` AND v.violation_type = ?`;
      params.push(filters.violationType);
    }

    if (filters.startDate) {
      sql += ` AND v.detected_at >= ?`;
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      sql += ` AND v.detected_at <= ?`;
      params.push(filters.endDate);
    }

    // Count total
    const countSql = sql.replace(
      'SELECT v.id, v.booking_id, v.cleaner_id, v.violation_type, v.description, v.penalty_amount, v.was_warning, v.detected_at, u.name as cleanerName, b.booking_number',
      'SELECT COUNT(*) as total'
    );
    const countResult = await query(countSql, params) as RowDataPacket[];
    const total = countResult[0].total;

    // Get paginated results
    sql += ` ORDER BY v.detected_at DESC`;

    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const violations = await query(sql, params) as RowDataPacket[];

    return { violations, total };
  }
}

export default new SLAService();
