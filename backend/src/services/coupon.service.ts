import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface Coupon {
  code: string;
  name: string;
  discountType: 'percentage' | 'fixed' | 'free_service';
  discountValue: number;
  maxDiscount?: number;
  minOrderValue?: number;
  usageLimit?: number;
  usagePerUser?: number;
  validFrom?: Date;
  validUntil?: Date;
}

export class CouponService {
  /**
   * Validate and apply coupon
   */
  async applyCoupon(
    code: string,
    userId: number,
    orderValue: number,
    serviceIds?: number[]
  ): Promise<{
    valid: boolean;
    discountAmount: number;
    finalAmount: number;
    message: string;
    couponId?: number;
  }> {
    // Get coupon details
    const sqlCoupon = `
      SELECT id, discount_type, discount_value, max_discount, min_order_value,
             usage_limit, usage_per_user, valid_from, valid_until,
             applicable_services, is_active
      FROM coupons
      WHERE code = ?
    `;

    const coupons = await query(sqlCoupon, [code.toUpperCase()]) as RowDataPacket[];

    if (coupons.length === 0) {
      return { valid: false, discountAmount: 0, finalAmount: orderValue, message: 'Invalid coupon code' };
    }

    const coupon = coupons[0];

    // Check if active
    if (!coupon.is_active) {
      return { valid: false, discountAmount: 0, finalAmount: orderValue, message: 'Coupon is no longer active' };
    }

    // Check validity dates
    const now = new Date();
    if (coupon.valid_from && new Date(coupon.valid_from) > now) {
      return { valid: false, discountAmount: 0, finalAmount: orderValue, message: 'Coupon not yet valid' };
    }
    if (coupon.valid_until && new Date(coupon.valid_until) < now) {
      return { valid: false, discountAmount: 0, finalAmount: orderValue, message: 'Coupon has expired' };
    }

    // Check minimum order value
    if (coupon.min_order_value && orderValue < coupon.min_order_value) {
      return {
        valid: false,
        discountAmount: 0,
        finalAmount: orderValue,
        message: `Minimum order value ₹${coupon.min_order_value} required`
      };
    }

    // Check applicable services
    if (coupon.applicable_services && serviceIds) {
      const applicableServices = JSON.parse(coupon.applicable_services);
      const hasApplicableService = serviceIds.some(id => applicableServices.includes(id));

      if (!hasApplicableService) {
        return {
          valid: false,
          discountAmount: 0,
          finalAmount: orderValue,
          message: 'Coupon not applicable to selected services'
        };
      }
    }

    // Check usage limit
    if (coupon.usage_limit) {
      const sqlUsageTotal = `SELECT COUNT(*) as count FROM coupon_usage WHERE coupon_id = ?`;
      const usageTotal = await query(sqlUsageTotal, [coupon.id]) as RowDataPacket[];

      if (usageTotal[0].count >= coupon.usage_limit) {
        return { valid: false, discountAmount: 0, finalAmount: orderValue, message: 'Coupon usage limit reached' };
      }
    }

    // Check per-user usage limit
    if (coupon.usage_per_user) {
      const sqlUsageUser = `SELECT COUNT(*) as count FROM coupon_usage WHERE coupon_id = ? AND user_id = ?`;
      const usageUser = await query(sqlUsageUser, [coupon.id, userId]) as RowDataPacket[];

      if (usageUser[0].count >= coupon.usage_per_user) {
        return { valid: false, discountAmount: 0, finalAmount: orderValue, message: 'Coupon already used' };
      }
    }

    // Calculate discount
    let discountAmount = 0;

    if (coupon.discount_type === 'percentage') {
      discountAmount = (orderValue * coupon.discount_value) / 100;
      if (coupon.max_discount) {
        discountAmount = Math.min(discountAmount, coupon.max_discount);
      }
    } else if (coupon.discount_type === 'fixed') {
      discountAmount = coupon.discount_value;
    }

    discountAmount = Math.min(discountAmount, orderValue);
    const finalAmount = Math.max(orderValue - discountAmount, 0);

    return {
      valid: true,
      discountAmount: Math.round(discountAmount * 100) / 100,
      finalAmount: Math.round(finalAmount * 100) / 100,
      message: 'Coupon applied successfully',
      couponId: coupon.id
    };
  }

  /**
   * Record coupon usage
   */
  async recordUsage(couponId: number, userId: number, bookingId: number, discountAmount: number): Promise<void> {
    const sql = `
      INSERT INTO coupon_usage (coupon_id, user_id, booking_id, discount_amount)
      VALUES (?, ?, ?, ?)
    `;

    await query(sql, [couponId, userId, bookingId, discountAmount]);
  }

  /**
   * Generate referral code
   */
  generateReferralCode(userName: string): string {
    const cleanName = userName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${cleanName}${random}`;
  }

  /**
   * Create referral
   */
  async createReferral(
    referrerId: number,
    referralCode: string,
    referrerReward: number = 100,
    refereeReward: number = 50
  ): Promise<void> {
    const sql = `
      INSERT INTO referrals (referrer_id, referee_id, referral_code, referrer_reward, referee_reward, expires_at)
      VALUES (?, 0, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 90 DAY))
    `;

    await query(sql, [referrerId, referralCode, referrerReward, refereeReward]);
  }

  /**
   * Apply referral
   */
  async applyReferral(referralCode: string, refereeId: number): Promise<{
    success: boolean;
    referrerReward?: number;
    refereeReward?: number;
    message: string;
  }> {
    const sql = `
      SELECT id, referrer_id, referrer_reward, referee_reward, status, expires_at
      FROM referrals
      WHERE referral_code = ?
    `;

    const referrals = await query(sql, [referralCode]) as RowDataPacket[];

    if (referrals.length === 0) {
      return { success: false, message: 'Invalid referral code' };
    }

    const referral = referrals[0];

    if (referral.status !== 'pending') {
      return { success: false, message: 'Referral code already used' };
    }

    if (new Date(referral.expires_at) < new Date()) {
      return { success: false, message: 'Referral code expired' };
    }

    // Update referral
    const sqlUpdate = `
      UPDATE referrals
      SET referee_id = ?, status = 'completed', completed_at = NOW()
      WHERE id = ?
    `;

    await query(sqlUpdate, [refereeId, referral.id]);

    // Create credits/rewards for both users
    // Implement wallet/credits system here

    return {
      success: true,
      referrerReward: referral.referrer_reward,
      refereeReward: referral.referee_reward,
      message: 'Referral applied successfully'
    };
  }

  /**
   * Get user referral stats
   */
  async getReferralStats(userId: number): Promise<{
    totalReferrals: number;
    completedReferrals: number;
    totalEarnings: number;
    pendingReferrals: number;
  }> {
    const sql = `
      SELECT
        COUNT(*) as totalReferrals,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedReferrals,
        SUM(CASE WHEN status = 'completed' THEN referrer_reward ELSE 0 END) as totalEarnings,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingReferrals
      FROM referrals
      WHERE referrer_id = ?
    `;

    const result = await query(sql, [userId]) as RowDataPacket[];

    return {
      totalReferrals: result[0].totalReferrals || 0,
      completedReferrals: result[0].completedReferrals || 0,
      totalEarnings: parseFloat(result[0].totalEarnings || 0),
      pendingReferrals: result[0].pendingReferrals || 0
    };
  }
}

export default new CouponService();
