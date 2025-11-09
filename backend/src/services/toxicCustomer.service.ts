import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface ToxicCustomerFlag {
  customerId: number;
  riskScore: number;
  flags: string[];
  totalIncidents: number;
  recentIncidents: number;
  avgCleanerRating: number;
  cancellationRate: number;
  paymentIssues: number;
  abusiveReports: number;
  status: 'watch' | 'warned' | 'restricted' | 'blocked';
}

export class ToxicCustomerService {
  /**
   * Analyze customer behavior and calculate toxicity score
   */
  async analyzeCustomer(customerId: number): Promise<ToxicCustomerFlag> {
    let riskScore = 0;
    const flags: string[] = [];

    // Get basic customer stats
    const statsSql = `
      SELECT
        COUNT(*) as totalBookings,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM bookings
      WHERE customer_id = ?
    `;

    const stats = await query(statsSql, [customerId]) as RowDataPacket[];

    const totalBookings = stats[0].totalBookings || 0;
    const cancelled = stats[0].cancelled || 0;
    const completed = stats[0].completed || 0;

    // Check 1: Cancellation rate
    const cancellationRate = totalBookings > 0 ? cancelled / totalBookings : 0;

    if (cancellationRate > 0.5 && totalBookings >= 5) {
      riskScore += 30;
      flags.push('high_cancellation_rate');
    } else if (cancellationRate > 0.3 && totalBookings >= 5) {
      riskScore += 15;
      flags.push('moderate_cancellation_rate');
    }

    // Check 2: Cleaner ratings (how cleaners rated this customer)
    const ratingsSql = `
      SELECT AVG(rating) as avgRating, COUNT(*) as ratingCount
      FROM ratings
      WHERE rated_id = ? AND rater_id IN (
        SELECT cleaner_id FROM bookings WHERE customer_id = ?
      )
    `;

    const ratings = await query(ratingsSql, [customerId, customerId]) as RowDataPacket[];
    const avgCleanerRating = parseFloat(ratings[0].avgRating || 5);
    const ratingCount = ratings[0].ratingCount || 0;

    if (avgCleanerRating < 3 && ratingCount >= 3) {
      riskScore += 40;
      flags.push('poorly_rated_by_cleaners');
    } else if (avgCleanerRating < 3.5 && ratingCount >= 3) {
      riskScore += 20;
      flags.push('low_cleaner_satisfaction');
    }

    // Check 3: Payment issues
    const paymentSql = `
      SELECT COUNT(*) as failedPayments
      FROM transactions
      WHERE user_id = ? AND status = 'failed'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    `;

    const payments = await query(paymentSql, [customerId]) as RowDataPacket[];
    const paymentIssues = payments[0].failedPayments || 0;

    if (paymentIssues >= 5) {
      riskScore += 25;
      flags.push('frequent_payment_failures');
    } else if (paymentIssues >= 3) {
      riskScore += 10;
      flags.push('payment_issues');
    }

    // Check 4: Disputes and complaints
    const disputesSql = `
      SELECT COUNT(*) as totalDisputes
      FROM issues
      WHERE reporter_id = ? AND reporter_type = 'customer'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    `;

    const disputes = await query(disputesSql, [customerId]) as RowDataPacket[];
    const totalIncidents = disputes[0].totalDisputes || 0;

    if (totalIncidents >= 5) {
      riskScore += 30;
      flags.push('frequent_complaints');
    } else if (totalIncidents >= 3) {
      riskScore += 15;
      flags.push('multiple_complaints');
    }

    // Check 5: Abusive behavior reports
    const abusiveSql = `
      SELECT COUNT(*) as abusiveReports
      FROM cleaner_reports
      WHERE customer_id = ? AND report_type = 'abusive_behavior'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    `;

    const abusive = await query(abusiveSql, [customerId]) as RowDataPacket[];
    const abusiveReports = abusive[0].abusiveReports || 0;

    if (abusiveReports >= 2) {
      riskScore += 50;
      flags.push('abusive_behavior');
    } else if (abusiveReports >= 1) {
      riskScore += 25;
      flags.push('reported_abusive');
    }

    // Check 6: No-shows
    const noShowSql = `
      SELECT COUNT(*) as noShows
      FROM bookings
      WHERE customer_id = ?
        AND status = 'cancelled'
        AND started_at IS NULL
        AND accepted_at IS NOT NULL
        AND cancellation_reason LIKE '%not home%'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    `;

    const noShows = await query(noShowSql, [customerId]) as RowDataPacket[];
    const noShowCount = noShows[0].noShows || 0;

    if (noShowCount >= 3) {
      riskScore += 35;
      flags.push('frequent_no_shows');
    } else if (noShowCount >= 2) {
      riskScore += 15;
      flags.push('occasional_no_shows');
    }

    // Check 7: Recent incidents (last 30 days)
    const recentSql = `
      SELECT COUNT(*) as recentCount
      FROM issues
      WHERE reporter_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `;

    const recent = await query(recentSql, [customerId]) as RowDataPacket[];
    const recentIncidents = recent[0].recentCount || 0;

    if (recentIncidents >= 3) {
      riskScore += 20;
      flags.push('recent_escalation');
    }

    // Determine status
    let status: 'watch' | 'warned' | 'restricted' | 'blocked' = 'watch';

    if (riskScore >= 80) {
      status = 'blocked';
    } else if (riskScore >= 60) {
      status = 'restricted';
    } else if (riskScore >= 40) {
      status = 'warned';
    }

    return {
      customerId,
      riskScore: Math.min(riskScore, 100),
      flags,
      totalIncidents,
      recentIncidents,
      avgCleanerRating: Math.round(avgCleanerRating * 100) / 100,
      cancellationRate: Math.round(cancellationRate * 100) / 100,
      paymentIssues,
      abusiveReports,
      status
    };
  }

  /**
   * Flag toxic customer
   */
  async flagCustomer(customerId: number, auto: boolean = true): Promise<number> {
    const analysis = await this.analyzeCustomer(customerId);

    // Check if already flagged
    const existingSql = `
      SELECT id FROM toxic_customer_flags WHERE customer_id = ?
    `;

    const existing = await query(existingSql, [customerId]) as RowDataPacket[];

    if (existing.length > 0) {
      // Update existing flag
      await query(
        `UPDATE toxic_customer_flags
         SET risk_score = ?,
             flags = ?,
             status = ?,
             updated_at = NOW()
         WHERE customer_id = ?`,
        [analysis.riskScore, JSON.stringify(analysis.flags), analysis.status, customerId]
      );
      return existing[0].id;
    }

    // Create new flag
    const sql = `
      INSERT INTO toxic_customer_flags (
        customer_id, risk_score, flags, status, auto_flagged, created_at
      ) VALUES (?, ?, ?, ?, ?, NOW())
    `;

    const result = await query(sql, [
      customerId,
      analysis.riskScore,
      JSON.stringify(analysis.flags),
      analysis.status,
      auto
    ]) as ResultSetHeader;

    // Update user status if blocked
    if (analysis.status === 'blocked') {
      await query('UPDATE users SET status = ? WHERE id = ?', ['suspended', customerId]);
    }

    return result.insertId;
  }

  /**
   * Get all flagged customers
   */
  async getFlaggedCustomers(status?: string): Promise<any[]> {
    let sql = `
      SELECT
        tcf.customer_id as customerId,
        tcf.risk_score as riskScore,
        tcf.flags,
        tcf.status,
        tcf.created_at as flaggedAt,
        u.name,
        u.email,
        u.phone,
        u.total_bookings as totalBookings
      FROM toxic_customer_flags tcf
      INNER JOIN users u ON u.id = tcf.customer_id
      WHERE 1=1
    `;

    const params: any[] = [];

    if (status) {
      sql += ` AND tcf.status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY tcf.risk_score DESC, tcf.created_at DESC`;

    const flags = await query(sql, params) as RowDataPacket[];

    return flags.map(f => ({
      ...f,
      flags: JSON.parse(f.flags)
    }));
  }

  /**
   * Batch analyze all customers
   */
  async batchAnalyzeCustomers(threshold: number = 40): Promise<{
    analyzed: number;
    flagged: number;
  }> {
    // Get active customers with recent activity
    const sql = `
      SELECT DISTINCT customer_id
      FROM bookings
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    `;

    const customers = await query(sql) as RowDataPacket[];

    let flagged = 0;

    for (const customer of customers) {
      try {
        const analysis = await this.analyzeCustomer(customer.customer_id);

        if (analysis.riskScore >= threshold) {
          await this.flagCustomer(customer.customer_id, true);
          flagged++;
        }
      } catch (error) {
        console.error(`Failed to analyze customer ${customer.customer_id}:`, error);
      }
    }

    return {
      analyzed: customers.length,
      flagged
    };
  }

  /**
   * Get customer protection recommendations for cleaner
   */
  async getProtectionRecommendations(customerId: number): Promise<{
    requireDeposit: boolean;
    requirePrepayment: boolean;
    assignSeniorCleaner: boolean;
    requireSupervision: boolean;
    blockBooking: boolean;
    warnings: string[];
  }> {
    const analysis = await this.analyzeCustomer(customerId);

    const recommendations = {
      requireDeposit: false,
      requirePrepayment: false,
      assignSeniorCleaner: false,
      requireSupervision: false,
      blockBooking: false,
      warnings: [] as string[]
    };

    if (analysis.flags.includes('abusive_behavior')) {
      recommendations.assignSeniorCleaner = true;
      recommendations.requireSupervision = true;
      recommendations.warnings.push('Customer has history of abusive behavior');
    }

    if (analysis.flags.includes('frequent_payment_failures')) {
      recommendations.requirePrepayment = true;
      recommendations.requireDeposit = true;
      recommendations.warnings.push('Frequent payment failures - require prepayment');
    }

    if (analysis.flags.includes('frequent_no_shows')) {
      recommendations.requireDeposit = true;
      recommendations.warnings.push('Customer has no-show history - deposit required');
    }

    if (analysis.status === 'blocked') {
      recommendations.blockBooking = true;
      recommendations.warnings.push('Customer is blocked - do not accept booking');
    }

    if (analysis.flags.includes('poorly_rated_by_cleaners')) {
      recommendations.assignSeniorCleaner = true;
      recommendations.warnings.push('Low ratings from cleaners - assign experienced cleaner');
    }

    return recommendations;
  }

  /**
   * Unflag customer (after rehabilitation)
   */
  async unflagCustomer(customerId: number, reason: string): Promise<void> {
    await query(
      `UPDATE toxic_customer_flags
       SET status = 'resolved',
           resolution_reason = ?,
           resolved_at = NOW()
       WHERE customer_id = ?`,
      [reason, customerId]
    );

    // Reactivate user if blocked
    await query('UPDATE users SET status = ? WHERE id = ?', ['active', customerId]);
  }

  /**
   * Get toxicity statistics
   */
  async getToxicityStats(): Promise<{
    totalFlagged: number;
    byStatus: { [status: string]: number };
    avgRiskScore: number;
    topFlags: { [flag: string]: number };
  }> {
    const sql = `
      SELECT
        COUNT(*) as totalFlagged,
        AVG(risk_score) as avgRiskScore
      FROM toxic_customer_flags
      WHERE status != 'resolved'
    `;

    const stats = await query(sql) as RowDataPacket[];

    // By status
    const statusSql = `
      SELECT status, COUNT(*) as count
      FROM toxic_customer_flags
      WHERE status != 'resolved'
      GROUP BY status
    `;
    const statuses = await query(statusSql) as RowDataPacket[];
    const byStatus: any = {};
    statuses.forEach(s => { byStatus[s.status] = s.count; });

    // Top flags
    const flagsSql = `SELECT flags FROM toxic_customer_flags WHERE status != 'resolved'`;
    const allFlags = await query(flagsSql) as RowDataPacket[];
    const topFlags: any = {};

    allFlags.forEach(f => {
      const flags = JSON.parse(f.flags);
      flags.forEach((flag: string) => {
        topFlags[flag] = (topFlags[flag] || 0) + 1;
      });
    });

    return {
      totalFlagged: stats[0].totalFlagged || 0,
      byStatus,
      avgRiskScore: parseFloat(stats[0].avgRiskScore || 0),
      topFlags
    };
  }
}

export default new ToxicCustomerService();
