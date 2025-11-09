import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface Compensation {
  id?: number;
  bookingId: number;
  customerId: number;
  reason: string;
  compensationType: 'refund' | 'credit' | 'discount_coupon' | 'free_service';
  amount: number;
  status: 'pending' | 'approved' | 'processed' | 'rejected';
  autoApproved: boolean;
  processedAt?: Date;
}

export class AutoCompensationService {
  // Compensation rules
  private compensationRules = [
    {
      violationType: 'late_arrival',
      threshold: 30, // minutes
      compensationType: 'credit' as const,
      compensationPercent: 20
    },
    {
      violationType: 'poor_quality',
      threshold: 3, // rating
      compensationType: 'refund' as const,
      compensationPercent: 50
    },
    {
      violationType: 'no_show',
      threshold: 0,
      compensationType: 'refund' as const,
      compensationPercent: 100
    },
    {
      violationType: 'incomplete_service',
      threshold: 0,
      compensationType: 'refund' as const,
      compensationPercent: 30
    }
  ];

  /**
   * Check and process auto-compensation for booking
   */
  async checkAndCompensate(bookingId: number): Promise<Compensation[]> {
    const compensations: Compensation[] = [];

    // Get booking details
    const bookingSql = `
      SELECT
        b.id,
        b.customer_id,
        b.total_amount,
        b.accepted_at,
        b.started_at,
        b.completed_at,
        r.quality_rating
      FROM bookings b
      LEFT JOIN ratings r ON r.booking_id = b.id AND r.rater_id = b.customer_id
      WHERE b.id = ?
    `;

    const bookings = await query(bookingSql, [bookingId]) as RowDataPacket[];

    if (bookings.length === 0) return compensations;

    const booking = bookings[0];

    // Check SLA violations
    const violations = await this.getSLAViolations(bookingId);

    for (const violation of violations) {
      const rule = this.compensationRules.find(r => r.violationType === violation.violation_type);

      if (!rule) continue;

      // Calculate compensation amount
      const amount = (booking.total_amount * rule.compensationPercent) / 100;

      // Check if already compensated
      const existing = await this.getExistingCompensation(bookingId, violation.violation_type);

      if (existing) continue;

      // Create compensation
      const compensation: Compensation = {
        bookingId,
        customerId: booking.customer_id,
        reason: `Auto-compensation for ${violation.violation_type}: ${violation.description}`,
        compensationType: rule.compensationType,
        amount,
        status: 'pending',
        autoApproved: true
      };

      const compensationId = await this.createCompensation(compensation);
      compensation.id = compensationId;

      // Auto-approve if within threshold
      if (amount <= 500) {
        await this.approveCompensation(compensationId);
        await this.processCompensation(compensationId);
      }

      compensations.push(compensation);
    }

    return compensations;
  }

  /**
   * Get SLA violations for booking
   */
  private async getSLAViolations(bookingId: number): Promise<any[]> {
    const sql = `
      SELECT
        violation_type,
        description,
        penalty_amount
      FROM sla_violations
      WHERE booking_id = ?
    `;

    return await query(sql, [bookingId]) as RowDataPacket[];
  }

  /**
   * Check if compensation already exists
   */
  private async getExistingCompensation(bookingId: number, reason: string): Promise<boolean> {
    const sql = `
      SELECT COUNT(*) as count
      FROM compensations
      WHERE booking_id = ?
        AND reason LIKE ?
    `;

    const result = await query(sql, [bookingId, `%${reason}%`]) as RowDataPacket[];
    return result[0].count > 0;
  }

  /**
   * Create compensation record
   */
  private async createCompensation(compensation: Compensation): Promise<number> {
    const sql = `
      INSERT INTO compensations (
        booking_id, customer_id, reason, compensation_type,
        amount, status, auto_approved, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const result = await query(sql, [
      compensation.bookingId,
      compensation.customerId,
      compensation.reason,
      compensation.compensationType,
      compensation.amount,
      compensation.status,
      compensation.autoApproved
    ]) as ResultSetHeader;

    return result.insertId;
  }

  /**
   * Approve compensation
   */
  async approveCompensation(compensationId: number, approvedBy?: number): Promise<void> {
    await query(
      'UPDATE compensations SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?',
      ['approved', approvedBy || null, compensationId]
    );
  }

  /**
   * Process compensation
   */
  async processCompensation(compensationId: number): Promise<void> {
    // Get compensation details
    const sql = `
      SELECT
        booking_id, customer_id, compensation_type, amount
      FROM compensations
      WHERE id = ? AND status = 'approved'
    `;

    const compensations = await query(sql, [compensationId]) as RowDataPacket[];

    if (compensations.length === 0) {
      throw new Error('Compensation not found or not approved');
    }

    const comp = compensations[0];

    switch (comp.compensation_type) {
      case 'refund':
        await this.processRefund(comp.booking_id, comp.amount);
        break;
      case 'credit':
        await this.addCredit(comp.customer_id, comp.amount);
        break;
      case 'discount_coupon':
        await this.createDiscountCoupon(comp.customer_id, comp.amount);
        break;
      case 'free_service':
        await this.grantFreeService(comp.customer_id);
        break;
    }

    // Mark as processed
    await query(
      'UPDATE compensations SET status = ?, processed_at = NOW() WHERE id = ?',
      ['processed', compensationId]
    );

    // Notify customer
    console.log(`Compensation ${compensationId} processed for customer ${comp.customer_id}`);
  }

  /**
   * Process refund
   */
  private async processRefund(bookingId: number, amount: number): Promise<void> {
    // TODO: Integrate with payment gateway
    const sql = `
      INSERT INTO transactions (
        user_id, booking_id, transaction_type, amount,
        payment_method, status, description, created_at
      )
      SELECT
        customer_id, ?, 'refund', ?, payment_method, 'completed',
        'Auto-compensation refund', NOW()
      FROM bookings
      WHERE id = ?
    `;

    await query(sql, [bookingId, amount, bookingId]);
  }

  /**
   * Add credit to customer account
   */
  private async addCredit(customerId: number, amount: number): Promise<void> {
    const sql = `
      INSERT INTO customer_credits (
        customer_id, amount, reason, expires_at, created_at
      ) VALUES (?, ?, 'Auto-compensation credit', DATE_ADD(NOW(), INTERVAL 90 DAY), NOW())
    `;

    await query(sql, [customerId, amount]);
  }

  /**
   * Create discount coupon
   */
  private async createDiscountCoupon(customerId: number, discountAmount: number): Promise<void> {
    const code = `SORRY${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const sql = `
      INSERT INTO coupons (
        code, discount_type, discount_value, usage_limit,
        customer_id, valid_until, created_at
      ) VALUES (?, 'fixed', ?, 1, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), NOW())
    `;

    await query(sql, [code, discountAmount, customerId]);
  }

  /**
   * Grant free service
   */
  private async grantFreeService(customerId: number): Promise<void> {
    const sql = `
      INSERT INTO free_service_grants (
        customer_id, expires_at, created_at
      ) VALUES (?, DATE_ADD(NOW(), INTERVAL 60 DAY), NOW())
    `;

    await query(sql, [customerId]);
  }

  /**
   * Get pending compensations
   */
  async getPendingCompensations(): Promise<any[]> {
    const sql = `
      SELECT
        c.id,
        c.booking_id as bookingId,
        c.customer_id as customerId,
        c.reason,
        c.compensation_type as compensationType,
        c.amount,
        c.auto_approved as autoApproved,
        c.created_at as createdAt,
        u.name as customerName,
        b.booking_number as bookingNumber
      FROM compensations c
      INNER JOIN users u ON u.id = c.customer_id
      INNER JOIN bookings b ON b.id = c.booking_id
      WHERE c.status = 'pending'
      ORDER BY c.created_at ASC
    `;

    return await query(sql) as RowDataPacket[];
  }

  /**
   * Batch process auto-approved compensations
   */
  async batchProcessAutoApproved(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const sql = `
      SELECT id
      FROM compensations
      WHERE status = 'approved'
        AND auto_approved = TRUE
      LIMIT 100
    `;

    const compensations = await query(sql) as RowDataPacket[];

    let succeeded = 0;
    let failed = 0;

    for (const comp of compensations) {
      try {
        await this.processCompensation(comp.id);
        succeeded++;
      } catch (error) {
        console.error(`Failed to process compensation ${comp.id}:`, error);
        failed++;
      }
    }

    return {
      processed: compensations.length,
      succeeded,
      failed
    };
  }

  /**
   * Get compensation statistics
   */
  async getCompensationStats(days: number = 30): Promise<{
    totalCompensations: number;
    totalAmount: number;
    byType: { [type: string]: { count: number; amount: number } };
    autoApprovedPercent: number;
    avgAmount: number;
  }> {
    const sql = `
      SELECT
        COUNT(*) as totalCompensations,
        SUM(amount) as totalAmount,
        AVG(amount) as avgAmount,
        SUM(CASE WHEN auto_approved = TRUE THEN 1 ELSE 0 END) as autoApproved
      FROM compensations
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const stats = await query(sql, [days]) as RowDataPacket[];

    // By type
    const typeSql = `
      SELECT
        compensation_type,
        COUNT(*) as count,
        SUM(amount) as amount
      FROM compensations
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY compensation_type
    `;

    const types = await query(typeSql, [days]) as RowDataPacket[];
    const byType: any = {};
    types.forEach(t => {
      byType[t.compensation_type] = {
        count: t.count,
        amount: parseFloat(t.amount || 0)
      };
    });

    const totalCompensations = stats[0].totalCompensations || 0;
    const autoApproved = stats[0].autoApproved || 0;

    return {
      totalCompensations,
      totalAmount: parseFloat(stats[0].totalAmount || 0),
      byType,
      autoApprovedPercent: totalCompensations > 0
        ? Math.round((autoApproved / totalCompensations) * 100)
        : 0,
      avgAmount: parseFloat(stats[0].avgAmount || 0)
    };
  }
}

export default new AutoCompensationService();
