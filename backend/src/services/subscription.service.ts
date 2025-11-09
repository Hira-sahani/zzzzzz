import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface Subscription {
  id?: number;
  customerId: number;
  planId: number;
  status: 'active' | 'paused' | 'cancelled' | 'expired';
  startDate: Date;
  endDate?: Date;
  renewalDate: Date;
  autoRenew: boolean;
  billingCycle: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  amount: number;
  servicesIncluded: number[];
  bookingsPerCycle: number;
  bookingsUsed: number;
  lastRenewalDate?: Date;
  nextBillingDate: Date;
  paymentMethodId?: string;
}

export class SubscriptionService {
  /**
   * Create new subscription
   */
  async createSubscription(data: {
    customerId: number;
    planId: number;
    billingCycle: string;
    autoRenew?: boolean;
    paymentMethodId?: string;
  }): Promise<number> {
    // Get plan details
    const planSql = `
      SELECT
        id, name, price, billing_cycle as billingCycle,
        bookings_per_cycle as bookingsPerCycle,
        services_included as servicesIncluded
      FROM subscription_plans
      WHERE id = ? AND is_active = TRUE
    `;

    const plans = await query(planSql, [data.planId]) as RowDataPacket[];

    if (plans.length === 0) {
      throw new Error('Subscription plan not found');
    }

    const plan = plans[0];

    // Calculate dates
    const startDate = new Date();
    const renewalDate = this.calculateNextRenewalDate(startDate, data.billingCycle);

    const sql = `
      INSERT INTO subscriptions (
        customer_id, plan_id, status, start_date, renewal_date,
        auto_renew, billing_cycle, amount, services_included,
        bookings_per_cycle, bookings_used, next_billing_date
      ) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `;

    const result = await query(sql, [
      data.customerId,
      data.planId,
      startDate,
      renewalDate,
      data.autoRenew !== false,
      data.billingCycle,
      plan.price,
      plan.servicesIncluded,
      plan.bookingsPerCycle,
      renewalDate
    ]) as ResultSetHeader;

    // Store payment method if provided
    if (data.paymentMethodId) {
      await this.updatePaymentMethod(result.insertId, data.paymentMethodId);
    }

    return result.insertId;
  }

  /**
   * Calculate next renewal date
   */
  private calculateNextRenewalDate(startDate: Date, cycle: string): Date {
    const renewalDate = new Date(startDate);

    switch (cycle) {
      case 'weekly':
        renewalDate.setDate(renewalDate.getDate() + 7);
        break;
      case 'monthly':
        renewalDate.setMonth(renewalDate.getMonth() + 1);
        break;
      case 'quarterly':
        renewalDate.setMonth(renewalDate.getMonth() + 3);
        break;
      case 'yearly':
        renewalDate.setFullYear(renewalDate.getFullYear() + 1);
        break;
    }

    return renewalDate;
  }

  /**
   * Process auto-renewal for subscriptions due
   */
  async processAutoRenewals(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    errors: string[];
  }> {
    // Get subscriptions due for renewal
    const sql = `
      SELECT
        id, customer_id as customerId, plan_id as planId,
        amount, billing_cycle as billingCycle,
        payment_method_id as paymentMethodId
      FROM subscriptions
      WHERE status = 'active'
        AND auto_renew = TRUE
        AND next_billing_date <= DATE_ADD(NOW(), INTERVAL 1 DAY)
    `;

    const subscriptions = await query(sql) as RowDataPacket[];

    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const sub of subscriptions) {
      try {
        await this.renewSubscription(sub.id, sub.paymentMethodId);
        succeeded++;
      } catch (error: any) {
        failed++;
        errors.push(`Subscription ${sub.id}: ${error.message}`);
      }
    }

    return {
      processed: subscriptions.length,
      succeeded,
      failed,
      errors
    };
  }

  /**
   * Renew subscription
   */
  async renewSubscription(
    subscriptionId: number,
    paymentMethodId?: string
  ): Promise<{
    success: boolean;
    transactionId?: number;
    nextRenewalDate: Date;
  }> {
    // Get subscription details
    const sub = await this.getSubscription(subscriptionId);

    if (!sub) {
      throw new Error('Subscription not found');
    }

    if (sub.status !== 'active') {
      throw new Error('Subscription is not active');
    }

    // Process payment
    let transactionId: number | undefined;

    if (paymentMethodId) {
      try {
        // TODO: Process payment with Stripe or payment gateway
        transactionId = await this.processPayment(
          sub.customerId,
          sub.amount,
          paymentMethodId,
          'subscription_renewal'
        );
      } catch (error: any) {
        // Payment failed - handle based on retry policy
        await this.handlePaymentFailure(subscriptionId, error.message);
        throw new Error(`Payment failed: ${error.message}`);
      }
    }

    // Calculate next renewal date
    const nextRenewalDate = this.calculateNextRenewalDate(
      new Date(),
      sub.billingCycle
    );

    // Update subscription
    const updateSql = `
      UPDATE subscriptions
      SET renewal_date = ?,
          next_billing_date = ?,
          bookings_used = 0,
          last_renewal_date = NOW(),
          updated_at = NOW()
      WHERE id = ?
    `;

    await query(updateSql, [nextRenewalDate, nextRenewalDate, subscriptionId]);

    // Log renewal
    await this.logRenewal(subscriptionId, transactionId, 'success');

    return {
      success: true,
      transactionId,
      nextRenewalDate
    };
  }

  /**
   * Process payment (placeholder)
   */
  private async processPayment(
    customerId: number,
    amount: number,
    paymentMethodId: string,
    description: string
  ): Promise<number> {
    // TODO: Integrate with actual payment gateway
    const sql = `
      INSERT INTO transactions (
        user_id, transaction_type, amount, payment_method,
        status, description, created_at
      ) VALUES (?, ?, ?, 'stripe', 'completed', ?, NOW())
    `;

    const result = await query(sql, [
      customerId,
      'subscription_payment',
      amount,
      description
    ]) as ResultSetHeader;

    return result.insertId;
  }

  /**
   * Handle payment failure
   */
  private async handlePaymentFailure(
    subscriptionId: number,
    reason: string
  ): Promise<void> {
    // Log failure
    await this.logRenewal(subscriptionId, undefined, 'failed', reason);

    // Update retry count
    await query(
      'UPDATE subscriptions SET payment_retry_count = payment_retry_count + 1 WHERE id = ?',
      [subscriptionId]
    );

    // Check retry count and pause if exceeded
    const subSql = `SELECT payment_retry_count FROM subscriptions WHERE id = ?`;
    const result = await query(subSql, [subscriptionId]) as RowDataPacket[];

    if (result[0].payment_retry_count >= 3) {
      await this.pauseSubscription(subscriptionId, 'Payment failed after 3 retries');
    }
  }

  /**
   * Log renewal attempt
   */
  private async logRenewal(
    subscriptionId: number,
    transactionId: number | undefined,
    status: string,
    errorMessage?: string
  ): Promise<void> {
    const sql = `
      INSERT INTO subscription_renewals (
        subscription_id, transaction_id, status, error_message, created_at
      ) VALUES (?, ?, ?, ?, NOW())
    `;

    await query(sql, [subscriptionId, transactionId || null, status, errorMessage || null]);
  }

  /**
   * Get subscription
   */
  async getSubscription(subscriptionId: number): Promise<Subscription | null> {
    const sql = `
      SELECT
        id, customer_id as customerId, plan_id as planId,
        status, start_date as startDate, end_date as endDate,
        renewal_date as renewalDate, auto_renew as autoRenew,
        billing_cycle as billingCycle, amount,
        services_included as servicesIncluded,
        bookings_per_cycle as bookingsPerCycle,
        bookings_used as bookingsUsed,
        last_renewal_date as lastRenewalDate,
        next_billing_date as nextBillingDate,
        payment_method_id as paymentMethodId
      FROM subscriptions
      WHERE id = ?
    `;

    const subscriptions = await query(sql, [subscriptionId]) as RowDataPacket[];

    if (subscriptions.length === 0) return null;

    const sub = subscriptions[0];
    return {
      ...sub,
      servicesIncluded: JSON.parse(sub.servicesIncluded || '[]')
    };
  }

  /**
   * Get customer subscriptions
   */
  async getCustomerSubscriptions(customerId: number): Promise<Subscription[]> {
    const sql = `
      SELECT
        id, customer_id as customerId, plan_id as planId,
        status, start_date as startDate, end_date as endDate,
        renewal_date as renewalDate, auto_renew as autoRenew,
        billing_cycle as billingCycle, amount,
        services_included as servicesIncluded,
        bookings_per_cycle as bookingsPerCycle,
        bookings_used as bookingsUsed,
        last_renewal_date as lastRenewalDate,
        next_billing_date as nextBillingDate
      FROM subscriptions
      WHERE customer_id = ?
      ORDER BY created_at DESC
    `;

    const subscriptions = await query(sql, [customerId]) as RowDataPacket[];

    return subscriptions.map(sub => ({
      ...sub,
      servicesIncluded: JSON.parse(sub.servicesIncluded || '[]')
    }));
  }

  /**
   * Pause subscription
   */
  async pauseSubscription(subscriptionId: number, reason?: string): Promise<void> {
    const sql = `
      UPDATE subscriptions
      SET status = 'paused',
          pause_reason = ?,
          paused_at = NOW(),
          updated_at = NOW()
      WHERE id = ?
    `;

    await query(sql, [reason || null, subscriptionId]);
  }

  /**
   * Resume subscription
   */
  async resumeSubscription(subscriptionId: number): Promise<void> {
    const sub = await this.getSubscription(subscriptionId);

    if (!sub) {
      throw new Error('Subscription not found');
    }

    // Calculate new renewal date from now
    const nextRenewalDate = this.calculateNextRenewalDate(new Date(), sub.billingCycle);

    const sql = `
      UPDATE subscriptions
      SET status = 'active',
          renewal_date = ?,
          next_billing_date = ?,
          pause_reason = NULL,
          paused_at = NULL,
          payment_retry_count = 0,
          updated_at = NOW()
      WHERE id = ?
    `;

    await query(sql, [nextRenewalDate, nextRenewalDate, subscriptionId]);
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(
    subscriptionId: number,
    reason?: string,
    immediately: boolean = false
  ): Promise<void> {
    const sub = await this.getSubscription(subscriptionId);

    if (!sub) {
      throw new Error('Subscription not found');
    }

    const endDate = immediately ? new Date() : sub.renewalDate;

    const sql = `
      UPDATE subscriptions
      SET status = 'cancelled',
          end_date = ?,
          cancellation_reason = ?,
          cancelled_at = NOW(),
          auto_renew = FALSE,
          updated_at = NOW()
      WHERE id = ?
    `;

    await query(sql, [endDate, reason || null, subscriptionId]);
  }

  /**
   * Toggle auto-renew
   */
  async toggleAutoRenew(subscriptionId: number, autoRenew: boolean): Promise<void> {
    await query(
      'UPDATE subscriptions SET auto_renew = ?, updated_at = NOW() WHERE id = ?',
      [autoRenew, subscriptionId]
    );
  }

  /**
   * Update payment method
   */
  async updatePaymentMethod(subscriptionId: number, paymentMethodId: string): Promise<void> {
    await query(
      'UPDATE subscriptions SET payment_method_id = ?, updated_at = NOW() WHERE id = ?',
      [paymentMethodId, subscriptionId]
    );
  }

  /**
   * Use subscription booking
   */
  async useSubscriptionBooking(subscriptionId: number, bookingId: number): Promise<void> {
    const sub = await this.getSubscription(subscriptionId);

    if (!sub) {
      throw new Error('Subscription not found');
    }

    if (sub.bookingsUsed >= sub.bookingsPerCycle) {
      throw new Error('Subscription booking limit reached');
    }

    await query(
      'UPDATE subscriptions SET bookings_used = bookings_used + 1 WHERE id = ?',
      [subscriptionId]
    );

    // Log usage
    await query(
      'INSERT INTO subscription_usage (subscription_id, booking_id, used_at) VALUES (?, ?, NOW())',
      [subscriptionId, bookingId]
    );
  }

  /**
   * Get subscription statistics
   */
  async getSubscriptionStats(): Promise<{
    activeSubscriptions: number;
    pausedSubscriptions: number;
    cancelledSubscriptions: number;
    monthlyRecurringRevenue: number;
    avgSubscriptionValue: number;
    renewalRate: number;
  }> {
    const statsSql = `
      SELECT
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeSubscriptions,
        SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as pausedSubscriptions,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelledSubscriptions,
        SUM(CASE WHEN status = 'active' AND billing_cycle = 'monthly' THEN amount ELSE 0 END) as monthlyRevenue,
        AVG(CASE WHEN status = 'active' THEN amount ELSE NULL END) as avgValue
      FROM subscriptions
    `;

    const stats = await query(statsSql) as RowDataPacket[];

    // Calculate renewal rate
    const renewalSql = `
      SELECT
        COUNT(CASE WHEN status = 'success' THEN 1 END) as successful,
        COUNT(*) as total
      FROM subscription_renewals
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `;

    const renewal = await query(renewalSql) as RowDataPacket[];
    const renewalRate = renewal[0].total > 0
      ? (renewal[0].successful / renewal[0].total) * 100
      : 0;

    return {
      activeSubscriptions: stats[0].activeSubscriptions || 0,
      pausedSubscriptions: stats[0].pausedSubscriptions || 0,
      cancelledSubscriptions: stats[0].cancelledSubscriptions || 0,
      monthlyRecurringRevenue: parseFloat(stats[0].monthlyRevenue || 0),
      avgSubscriptionValue: parseFloat(stats[0].avgValue || 0),
      renewalRate: Math.round(renewalRate * 100) / 100
    };
  }
}

export default new SubscriptionService();
