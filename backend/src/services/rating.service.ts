import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface CreateRatingData {
  bookingId: number;
  customerId: number;
  cleanerId: number;
  rating: number; // 1-5
  review?: string;
  serviceQuality?: number;
  punctuality?: number;
  professionalism?: number;
  valueForMoney?: number;
  wouldRecommend?: boolean;
  photos?: string[];
}

export interface Rating {
  id: number;
  bookingId: number;
  customerId: number;
  cleanerId: number;
  rating: number;
  review?: string;
  serviceQuality?: number;
  punctuality?: number;
  professionalism?: number;
  valueForMoney?: number;
  wouldRecommend: boolean;
  photos?: string[];
  isVerified: boolean;
  isFeatured: boolean;
  response?: string;
  responseAt?: Date;
  createdAt: Date;
}

export class RatingService {
  /**
   * Create a new rating
   */
  async createRating(data: CreateRatingData): Promise<number> {
    // Check if rating already exists
    const existing = await this.getRatingByBookingId(data.bookingId);
    if (existing) {
      throw new Error('Rating already exists for this booking');
    }

    const sql = `
      INSERT INTO ratings (
        booking_id, customer_id, cleaner_id,
        rating, review,
        service_quality, punctuality, professionalism, value_for_money,
        would_recommend, photos
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await query(sql, [
      data.bookingId,
      data.customerId,
      data.cleanerId,
      data.rating,
      data.review || null,
      data.serviceQuality || null,
      data.punctuality || null,
      data.professionalism || null,
      data.valueForMoney || null,
      data.wouldRecommend !== false,
      data.photos ? JSON.stringify(data.photos) : null
    ]) as ResultSetHeader;

    // Update cleaner's average rating
    await this.updateCleanerAverageRating(data.cleanerId);

    return result.insertId;
  }

  /**
   * Get rating by booking ID
   */
  async getRatingByBookingId(bookingId: number): Promise<Rating | null> {
    const sql = `
      SELECT
        id, booking_id as bookingId, customer_id as customerId, cleaner_id as cleanerId,
        rating, review,
        service_quality as serviceQuality,
        punctuality, professionalism, value_for_money as valueForMoney,
        would_recommend as wouldRecommend,
        photos, is_verified as isVerified, is_featured as isFeatured,
        response, response_at as responseAt, created_at as createdAt
      FROM ratings
      WHERE booking_id = ?
    `;

    const results = await query(sql, [bookingId]) as RowDataPacket[];

    if (results.length === 0) return null;

    const rating = results[0];
    if (rating.photos) {
      rating.photos = JSON.parse(rating.photos);
    }

    return rating as Rating;
  }

  /**
   * Get ratings for a cleaner
   */
  async getCleanerRatings(
    cleanerId: number,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ ratings: Rating[]; total: number }> {
    const sqlCount = `
      SELECT COUNT(*) as total FROM ratings WHERE cleaner_id = ?
    `;

    const sql = `
      SELECT
        r.id, r.booking_id as bookingId, r.customer_id as customerId, r.cleaner_id as cleanerId,
        r.rating, r.review,
        r.service_quality as serviceQuality,
        r.punctuality, r.professionalism, r.value_for_money as valueForMoney,
        r.would_recommend as wouldRecommend,
        r.photos, r.is_verified as isVerified, r.is_featured as isFeatured,
        r.response, r.response_at as responseAt, r.created_at as createdAt,
        u.name as customerName
      FROM ratings r
      LEFT JOIN users u ON u.id = r.customer_id
      WHERE r.cleaner_id = ?
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const countResult = await query(sqlCount, [cleanerId]) as RowDataPacket[];
    const ratings = await query(sql, [cleanerId, limit, offset]) as RowDataPacket[];

    ratings.forEach(rating => {
      if (rating.photos) {
        rating.photos = JSON.parse(rating.photos);
      }
    });

    return {
      ratings: ratings as Rating[],
      total: countResult[0].total
    };
  }

  /**
   * Get cleaner rating statistics
   */
  async getCleanerRatingStats(cleanerId: number): Promise<{
    averageRating: number;
    totalRatings: number;
    ratingDistribution: { [key: number]: number };
    averageServiceQuality?: number;
    averagePunctuality?: number;
    averageProfessionalism?: number;
    averageValueForMoney?: number;
    recommendationRate: number;
  }> {
    const sql = `
      SELECT
        AVG(rating) as avgRating,
        COUNT(*) as totalRatings,
        SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as rating5,
        SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as rating4,
        SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as rating3,
        SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as rating2,
        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as rating1,
        AVG(service_quality) as avgServiceQuality,
        AVG(punctuality) as avgPunctuality,
        AVG(professionalism) as avgProfessionalism,
        AVG(value_for_money) as avgValueForMoney,
        SUM(CASE WHEN would_recommend = 1 THEN 1 ELSE 0 END) / COUNT(*) * 100 as recommendationRate
      FROM ratings
      WHERE cleaner_id = ?
    `;

    const results = await query(sql, [cleanerId]) as RowDataPacket[];
    const stats = results[0];

    return {
      averageRating: parseFloat(stats.avgRating || 0).toFixed(2) as any,
      totalRatings: stats.totalRatings || 0,
      ratingDistribution: {
        5: stats.rating5 || 0,
        4: stats.rating4 || 0,
        3: stats.rating3 || 0,
        2: stats.rating2 || 0,
        1: stats.rating1 || 0
      },
      averageServiceQuality: stats.avgServiceQuality ? parseFloat(stats.avgServiceQuality).toFixed(2) as any : undefined,
      averagePunctuality: stats.avgPunctuality ? parseFloat(stats.avgPunctuality).toFixed(2) as any : undefined,
      averageProfessionalism: stats.avgProfessionalism ? parseFloat(stats.avgProfessionalism).toFixed(2) as any : undefined,
      averageValueForMoney: stats.avgValueForMoney ? parseFloat(stats.avgValueForMoney).toFixed(2) as any : undefined,
      recommendationRate: parseFloat(stats.recommendationRate || 0).toFixed(2) as any
    };
  }

  /**
   * Update cleaner's average rating in users table
   */
  private async updateCleanerAverageRating(cleanerId: number): Promise<void> {
    const sql = `
      UPDATE users
      SET rating = (
        SELECT AVG(rating)
        FROM ratings
        WHERE cleaner_id = ?
      )
      WHERE id = ?
    `;

    await query(sql, [cleanerId, cleanerId]);
  }

  /**
   * Add response to rating
   */
  async addResponse(ratingId: number, response: string): Promise<void> {
    const sql = `
      UPDATE ratings
      SET response = ?, response_at = NOW()
      WHERE id = ?
    `;

    await query(sql, [response, ratingId]);
  }

  /**
   * Mark rating as verified
   */
  async verifyRating(ratingId: number): Promise<void> {
    const sql = `UPDATE ratings SET is_verified = TRUE WHERE id = ?`;
    await query(sql, [ratingId]);
  }

  /**
   * Mark rating as featured
   */
  async featureRating(ratingId: number, featured: boolean = true): Promise<void> {
    const sql = `UPDATE ratings SET is_featured = ? WHERE id = ?`;
    await query(sql, [featured, ratingId]);
  }

  /**
   * Get featured ratings
   */
  async getFeaturedRatings(limit: number = 10): Promise<Rating[]> {
    const sql = `
      SELECT
        r.id, r.booking_id as bookingId, r.customer_id as customerId, r.cleaner_id as cleanerId,
        r.rating, r.review,
        r.service_quality as serviceQuality,
        r.punctuality, r.professionalism, r.value_for_money as valueForMoney,
        r.would_recommend as wouldRecommend,
        r.photos, r.is_verified as isVerified, r.is_featured as isFeatured,
        r.response, r.response_at as responseAt, r.created_at as createdAt,
        u.name as customerName,
        c.name as cleanerName
      FROM ratings r
      LEFT JOIN users u ON u.id = r.customer_id
      LEFT JOIN users c ON c.id = r.cleaner_id
      WHERE r.is_featured = TRUE AND r.is_verified = TRUE
      ORDER BY r.created_at DESC
      LIMIT ?
    `;

    const ratings = await query(sql, [limit]) as RowDataPacket[];

    ratings.forEach(rating => {
      if (rating.photos) {
        rating.photos = JSON.parse(rating.photos);
      }
    });

    return ratings as Rating[];
  }
}

export default new RatingService();
