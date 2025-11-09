import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface FraudAlert {
  id?: number;
  userId: number;
  alertType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  description: string;
  metadata?: any;
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  detectedAt: Date;
}

export class FraudService {
  /**
   * Check for fraud patterns in booking
   */
  async checkBookingFraud(bookingId: number, userId: number, metadata: any): Promise<FraudAlert[]> {
    const alerts: FraudAlert[] = [];

    // Check 1: Multiple bookings at same time
    const simultaneousBookings = await this.checkSimultaneousBookings(userId);
    if (simultaneousBookings > 1) {
      alerts.push({
        userId,
        alertType: 'multiple_simultaneous_bookings',
        severity: 'high',
        riskScore: 75,
        description: `User has ${simultaneousBookings} bookings at the same time`,
        metadata: { bookingId, count: simultaneousBookings },
        status: 'open',
        detectedAt: new Date()
      });
    }

    // Check 2: Unusual cancellation patterns
    const cancellationRate = await this.getCancellationRate(userId);
    if (cancellationRate > 0.5) {
      alerts.push({
        userId,
        alertType: 'high_cancellation_rate',
        severity: 'medium',
        riskScore: 60,
        description: `User cancellation rate: ${(cancellationRate * 100).toFixed(0)}%`,
        metadata: { bookingId, cancellationRate },
        status: 'open',
        detectedAt: new Date()
      });
    }

    // Check 3: Rapid booking creation
    const recentBookings = await this.getRecentBookingCount(userId, 1); // Last hour
    if (recentBookings > 5) {
      alerts.push({
        userId,
        alertType: 'rapid_booking_creation',
        severity: 'high',
        riskScore: 80,
        description: `${recentBookings} bookings created in last hour`,
        metadata: { bookingId, count: recentBookings },
        status: 'open',
        detectedAt: new Date()
      });
    }

    // Check 4: Payment failures
    const paymentFailures = await this.getPaymentFailureCount(userId);
    if (paymentFailures > 3) {
      alerts.push({
        userId,
        alertType: 'multiple_payment_failures',
        severity: 'medium',
        riskScore: 55,
        description: `${paymentFailures} payment failures`,
        metadata: { bookingId, failures: paymentFailures },
        status: 'open',
        detectedAt: new Date()
      });
    }

    // Save alerts
    for (const alert of alerts) {
      await this.createAlert(alert);
    }

    return alerts;
  }

  /**
   * Check for suspicious user behavior
   */
  async checkUserBehavior(userId: number): Promise<number> {
    let riskScore = 0;

    // Multiple accounts from same device/IP
    const duplicateAccounts = await this.checkDuplicateAccounts(userId);
    if (duplicateAccounts > 1) {
      riskScore += 30;
    }

    // Location spoofing
    const locationJumps = await this.checkLocationJumps(userId);
    if (locationJumps) {
      riskScore += 25;
    }

    // Abnormal usage patterns
    const abnormalPatterns = await this.checkAbnormalPatterns(userId);
    if (abnormalPatterns) {
      riskScore += 20;
    }

    // Account age vs activity
    const accountRisk = await this.checkAccountAge(userId);
    riskScore += accountRisk;

    return Math.min(riskScore, 100);
  }

  /**
   * Check simultaneous bookings
   */
  private async checkSimultaneousBookings(userId: number): Promise<number> {
    const sql = `
      SELECT COUNT(*) as count
      FROM bookings
      WHERE customer_id = ?
        AND status IN ('pending', 'assigned', 'accepted', 'in_progress')
        AND created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
    `;

    const result = await query(sql, [userId]) as RowDataPacket[];
    return result[0].count || 0;
  }

  /**
   * Get cancellation rate
   */
  private async getCancellationRate(userId: number): Promise<number> {
    const sql = `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM bookings
      WHERE customer_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `;

    const result = await query(sql, [userId]) as RowDataPacket[];

    if (result[0].total === 0) return 0;
    return result[0].cancelled / result[0].total;
  }

  /**
   * Get recent booking count
   */
  private async getRecentBookingCount(userId: number, hours: number): Promise<number> {
    const sql = `
      SELECT COUNT(*) as count
      FROM bookings
      WHERE customer_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
    `;

    const result = await query(sql, [userId, hours]) as RowDataPacket[];
    return result[0].count || 0;
  }

  /**
   * Get payment failure count
   */
  private async getPaymentFailureCount(userId: number): Promise<number> {
    const sql = `
      SELECT COUNT(*) as count
      FROM transactions
      WHERE user_id = ?
        AND status = 'failed'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `;

    const result = await query(sql, [userId]) as RowDataPacket[];
    return result[0].count || 0;
  }

  /**
   * Check for duplicate accounts
   */
  private async checkDuplicateAccounts(userId: number): Promise<number> {
    // This would check IP addresses, device fingerprints, etc.
    // Placeholder implementation
    return 0;
  }

  /**
   * Check for location jumps (spoofing)
   */
  private async checkLocationJumps(userId: number): Promise<boolean> {
    // Check if user's location changes impossibly fast
    // Placeholder implementation
    return false;
  }

  /**
   * Check for abnormal usage patterns
   */
  private async checkAbnormalPatterns(userId: number): Promise<boolean> {
    // Check for bot-like behavior, unusual timing patterns, etc.
    // Placeholder implementation
    return false;
  }

  /**
   * Check account age vs activity
   */
  private async checkAccountAge(userId: number): Promise<number> {
    const sql = `
      SELECT
        DATEDIFF(NOW(), created_at) as accountAgeDays,
        total_bookings
      FROM users
      WHERE id = ?
    `;

    const result = await query(sql, [userId]) as RowDataPacket[];

    if (result.length === 0) return 0;

    const { accountAgeDays, total_bookings } = result[0];

    // New account with many bookings is suspicious
    if (accountAgeDays < 7 && total_bookings > 10) {
      return 35;
    }

    return 0;
  }

  /**
   * Create fraud alert
   */
  async createAlert(alert: FraudAlert): Promise<number> {
    const sql = `
      INSERT INTO fraud_alerts (
        user_id, alert_type, severity, risk_score,
        description, metadata, status, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await query(sql, [
      alert.userId,
      alert.alertType,
      alert.severity,
      alert.riskScore,
      alert.description,
      alert.metadata ? JSON.stringify(alert.metadata) : null,
      alert.status,
      alert.detectedAt
    ]) as ResultSetHeader;

    // Auto-block if critical
    if (alert.severity === 'critical') {
      await this.blockUser(alert.userId, `Auto-blocked: ${alert.description}`);
    }

    return result.insertId;
  }

  /**
   * Block user
   */
  async blockUser(userId: number, reason: string): Promise<void> {
    const sql = `
      INSERT INTO blocked_users (user_id, reason, blocked_at)
      VALUES (?, ?, NOW())
      ON DUPLICATE KEY UPDATE reason = VALUES(reason), blocked_at = NOW()
    `;

    await query(sql, [userId, reason]);

    // Update user status
    await query('UPDATE users SET status = ? WHERE id = ?', ['suspended', userId]);
  }

  /**
   * Unblock user
   */
  async unblockUser(userId: number): Promise<void> {
    await query('DELETE FROM blocked_users WHERE user_id = ?', [userId]);
    await query('UPDATE users SET status = ? WHERE id = ?', ['active', userId]);
  }

  /**
   * Get fraud alerts
   */
  async getAlerts(filters: {
    userId?: number;
    severity?: string;
    status?: string;
    alertType?: string;
    page?: number;
    limit?: number;
  }): Promise<{ alerts: any[]; total: number }> {
    let sql = `
      SELECT
        fa.id, fa.user_id as userId, fa.alert_type as alertType,
        fa.severity, fa.risk_score as riskScore, fa.description,
        fa.metadata, fa.status, fa.detected_at as detectedAt,
        u.name as userName, u.email as userEmail, u.phone as userPhone
      FROM fraud_alerts fa
      INNER JOIN users u ON u.id = fa.user_id
      WHERE 1=1
    `;

    const params: any[] = [];

    if (filters.userId) {
      sql += ` AND fa.user_id = ?`;
      params.push(filters.userId);
    }

    if (filters.severity) {
      sql += ` AND fa.severity = ?`;
      params.push(filters.severity);
    }

    if (filters.status) {
      sql += ` AND fa.status = ?`;
      params.push(filters.status);
    }

    if (filters.alertType) {
      sql += ` AND fa.alert_type = ?`;
      params.push(filters.alertType);
    }

    // Count total
    const countSql = sql.replace(
      'SELECT fa.id, fa.user_id as userId, fa.alert_type as alertType, fa.severity, fa.risk_score as riskScore, fa.description, fa.metadata, fa.status, fa.detected_at as detectedAt, u.name as userName, u.email as userEmail, u.phone as userPhone',
      'SELECT COUNT(*) as total'
    );
    const countResult = await query(countSql, params) as RowDataPacket[];
    const total = countResult[0].total;

    // Get paginated results
    sql += ` ORDER BY fa.detected_at DESC`;

    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const offset = (page - 1) * limit;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const alerts = await query(sql, params) as RowDataPacket[];

    // Parse metadata
    alerts.forEach(alert => {
      if (alert.metadata) {
        alert.metadata = JSON.parse(alert.metadata);
      }
    });

    return { alerts, total };
  }

  /**
   * Update alert status
   */
  async updateAlertStatus(
    alertId: number,
    status: 'open' | 'investigating' | 'resolved' | 'false_positive'
  ): Promise<void> {
    await query('UPDATE fraud_alerts SET status = ? WHERE id = ?', [status, alertId]);
  }
}

export default new FraudService();
