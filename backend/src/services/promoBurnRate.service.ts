import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface PromoBurnRate {
  couponCode: string;
  totalBudget: number;
  budgetUsed: number;
  budgetRemaining: number;
  burnRate: number; // per day
  usageCount: number;
  totalDiscountGiven: number;
  daysActive: number;
  estimatedDaysRemaining: number;
  projectedTotalUsage: number;
  efficiency: number; // ROI
}

export class PromoBurnRateService {
  /**
   * Calculate burn rate for coupon
   */
  async calculateBurnRate(couponCode: string): Promise<PromoBurnRate> {
    // Get coupon details
    const couponSql = `
      SELECT
        id, code, discount_type as discountType, discount_value as discountValue,
        max_discount as maxDiscount, usage_limit as usageLimit,
        budget_limit as budgetLimit, valid_from as validFrom, valid_until as validUntil
      FROM coupons
      WHERE code = ?
    `;

    const coupons = await query(couponSql, [couponCode]) as RowDataPacket[];

    if (coupons.length === 0) {
      throw new Error('Coupon not found');
    }

    const coupon = coupons[0];

    // Get usage statistics
    const usageSql = `
      SELECT
        COUNT(*) as usageCount,
        SUM(discount_amount) as totalDiscountGiven,
        MIN(used_at) as firstUsed,
        MAX(used_at) as lastUsed
      FROM coupon_usage
      WHERE coupon_id = ?
    `;

    const usage = await query(usageSql, [coupon.id]) as RowDataPacket[];

    const usageCount = usage[0].usageCount || 0;
    const totalDiscountGiven = parseFloat(usage[0].totalDiscountGiven || 0);
    const firstUsed = usage[0].firstUsed;
    const lastUsed = usage[0].lastUsed;

    // Calculate days active
    const startDate = firstUsed || coupon.validFrom || new Date();
    const now = new Date();
    const daysActive = Math.max(1, Math.ceil((now.getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)));

    // Calculate burn rate (discount per day)
    const burnRate = totalDiscountGiven / daysActive;

    // Budget calculations
    const totalBudget = coupon.budgetLimit || (coupon.usageLimit * (coupon.maxDiscount || 0));
    const budgetUsed = totalDiscountGiven;
    const budgetRemaining = totalBudget - budgetUsed;

    // Estimate days remaining
    const estimatedDaysRemaining = burnRate > 0 ? budgetRemaining / burnRate : Infinity;

    // Project total usage
    const validUntil = coupon.validUntil ? new Date(coupon.validUntil) : null;
    const maxDaysRemaining = validUntil
      ? Math.ceil((validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : estimatedDaysRemaining;

    const projectedDaysRemaining = Math.min(estimatedDaysRemaining, maxDaysRemaining);
    const projectedTotalUsage = totalDiscountGiven + (burnRate * projectedDaysRemaining);

    // Calculate efficiency (assume 10x ROI target)
    const targetROI = 10;
    const actualRevenue = await this.getRevenueFromCoupon(coupon.id);
    const efficiency = totalDiscountGiven > 0 ? (actualRevenue / totalDiscountGiven) : 0;

    return {
      couponCode: coupon.code,
      totalBudget,
      budgetUsed,
      budgetRemaining,
      burnRate: Math.round(burnRate * 100) / 100,
      usageCount,
      totalDiscountGiven,
      daysActive,
      estimatedDaysRemaining: Math.round(estimatedDaysRemaining),
      projectedTotalUsage: Math.round(projectedTotalUsage * 100) / 100,
      efficiency: Math.round(efficiency * 100) / 100
    };
  }

  /**
   * Get revenue generated from coupon users
   */
  private async getRevenueFromCoupon(couponId: number): Promise<number> {
    const sql = `
      SELECT SUM(b.total_amount) as totalRevenue
      FROM bookings b
      INNER JOIN coupon_usage cu ON cu.booking_id = b.id
      WHERE cu.coupon_id = ?
        AND b.status = 'completed'
    `;

    const result = await query(sql, [couponId]) as RowDataPacket[];
    return parseFloat(result[0].totalRevenue || 0);
  }

  /**
   * Get all active promos with burn rates
   */
  async getAllPromoBurnRates(): Promise<PromoBurnRate[]> {
    const sql = `
      SELECT code
      FROM coupons
      WHERE is_active = TRUE
        AND (valid_until IS NULL OR valid_until >= NOW())
      ORDER BY created_at DESC
    `;

    const coupons = await query(sql) as RowDataPacket[];

    const burnRates: PromoBurnRate[] = [];

    for (const coupon of coupons) {
      try {
        const burnRate = await this.calculateBurnRate(coupon.code);
        burnRates.push(burnRate);
      } catch (error) {
        console.error(`Failed to calculate burn rate for ${coupon.code}:`, error);
      }
    }

    return burnRates;
  }

  /**
   * Get promos at risk of over-budget
   */
  async getPromosAtRisk(threshold: number = 0.8): Promise<any[]> {
    const burnRates = await this.getAllPromoBurnRates();

    return burnRates
      .filter(br => {
        const budgetUsagePercent = br.budgetUsed / br.totalBudget;
        return budgetUsagePercent >= threshold && br.estimatedDaysRemaining < 7;
      })
      .map(br => ({
        ...br,
        budgetUsagePercent: Math.round((br.budgetUsed / br.totalBudget) * 100),
        risk: 'high'
      }))
      .sort((a, b) => b.budgetUsagePercent - a.budgetUsagePercent);
  }

  /**
   * Get low-performing promos
   */
  async getLowPerformingPromos(minEfficiency: number = 5): Promise<any[]> {
    const burnRates = await this.getAllPromoBurnRates();

    return burnRates
      .filter(br => br.efficiency < minEfficiency && br.daysActive >= 7)
      .map(br => ({
        ...br,
        recommendation: 'Consider pausing or adjusting discount'
      }))
      .sort((a, b) => a.efficiency - b.efficiency);
  }

  /**
   * Get promo performance summary
   */
  async getPromoPerformanceSummary(days: number = 30): Promise<{
    totalPromos: number;
    activePromos: number;
    totalBudgetAllocated: number;
    totalBudgetUsed: number;
    avgBurnRate: number;
    avgEfficiency: number;
    highPerformers: number;
    lowPerformers: number;
    atRisk: number;
  }> {
    const burnRates = await this.getAllPromoBurnRates();

    const totalPromos = burnRates.length;
    const activePromos = burnRates.filter(br => br.budgetRemaining > 0).length;
    const totalBudgetAllocated = burnRates.reduce((sum, br) => sum + br.totalBudget, 0);
    const totalBudgetUsed = burnRates.reduce((sum, br) => sum + br.budgetUsed, 0);
    const avgBurnRate = burnRates.reduce((sum, br) => sum + br.burnRate, 0) / burnRates.length;
    const avgEfficiency = burnRates.reduce((sum, br) => sum + br.efficiency, 0) / burnRates.length;

    const highPerformers = burnRates.filter(br => br.efficiency >= 10).length;
    const lowPerformers = burnRates.filter(br => br.efficiency < 5 && br.daysActive >= 7).length;
    const atRisk = burnRates.filter(br =>
      (br.budgetUsed / br.totalBudget) >= 0.8 && br.estimatedDaysRemaining < 7
    ).length;

    return {
      totalPromos,
      activePromos,
      totalBudgetAllocated: Math.round(totalBudgetAllocated * 100) / 100,
      totalBudgetUsed: Math.round(totalBudgetUsed * 100) / 100,
      avgBurnRate: Math.round(avgBurnRate * 100) / 100,
      avgEfficiency: Math.round(avgEfficiency * 100) / 100,
      highPerformers,
      lowPerformers,
      atRisk
    };
  }

  /**
   * Pause promo if budget exceeded
   */
  async autoPauseIfOverBudget(couponCode: string): Promise<boolean> {
    const burnRate = await this.calculateBurnRate(couponCode);

    if (burnRate.budgetRemaining <= 0) {
      await query(
        'UPDATE coupons SET is_active = FALSE, pause_reason = ? WHERE code = ?',
        ['Budget exhausted', couponCode]
      );
      return true;
    }

    return false;
  }

  /**
   * Get daily burn rate trend
   */
  async getDailyBurnTrend(couponCode: string, days: number = 30): Promise<any[]> {
    const sql = `
      SELECT
        c.code,
        c.id as couponId
      FROM coupons c
      WHERE c.code = ?
    `;

    const coupons = await query(sql, [couponCode]) as RowDataPacket[];

    if (coupons.length === 0) {
      throw new Error('Coupon not found');
    }

    const trendSql = `
      SELECT
        DATE(used_at) as date,
        COUNT(*) as usageCount,
        SUM(discount_amount) as totalDiscount,
        AVG(discount_amount) as avgDiscount
      FROM coupon_usage
      WHERE coupon_id = ?
        AND used_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(used_at)
      ORDER BY date ASC
    `;

    const trend = await query(trendSql, [coupons[0].couponId, days]) as RowDataPacket[];

    return trend.map(t => ({
      date: t.date,
      usageCount: t.usageCount,
      totalDiscount: parseFloat(t.totalDiscount || 0),
      avgDiscount: parseFloat(t.avgDiscount || 0)
    }));
  }

  /**
   * Recommend budget adjustment
   */
  async recommendBudgetAdjustment(couponCode: string): Promise<{
    currentBudget: number;
    recommendedBudget: number;
    reason: string;
  }> {
    const burnRate = await this.calculateBurnRate(couponCode);

    let recommendedBudget = burnRate.totalBudget;
    let reason = 'No adjustment needed';

    // If burning too fast
    if (burnRate.estimatedDaysRemaining < 7 && burnRate.budgetRemaining > 0) {
      recommendedBudget = burnRate.totalBudget * 1.5;
      reason = 'Burning faster than expected - increase budget by 50%';
    }

    // If low efficiency
    if (burnRate.efficiency < 3) {
      recommendedBudget = burnRate.totalBudget * 0.5;
      reason = 'Low ROI - reduce budget by 50% or pause';
    }

    // If high efficiency but low usage
    if (burnRate.efficiency >= 10 && burnRate.usageCount < 10 && burnRate.daysActive >= 7) {
      recommendedBudget = burnRate.totalBudget * 2;
      reason = 'High ROI but low usage - increase budget and promote more';
    }

    return {
      currentBudget: burnRate.totalBudget,
      recommendedBudget: Math.round(recommendedBudget * 100) / 100,
      reason
    };
  }
}

export default new PromoBurnRateService();
