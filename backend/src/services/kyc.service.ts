import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface KYCVerification {
  id?: number;
  userId: number;
  documentType: 'aadhaar' | 'pan' | 'driving_license' | 'passport' | 'voter_id';
  documentNumber: string;
  documentFrontUrl: string;
  documentBackUrl?: string;
  selfieUrl?: string;
  verificationMethod: 'manual' | 'digilocker' | 'aadhaar_otp' | 'third_party_api';
  status: 'pending' | 'in_progress' | 'verified' | 'rejected';
  rejectionReason?: string;
  verifiedBy?: number;
  verifiedAt?: Date;
  submittedAt: Date;
}

export class KYCService {
  /**
   * Submit KYC documents for verification
   */
  async submitKYC(data: {
    userId: number;
    documentType: string;
    documentNumber: string;
    documentFrontUrl: string;
    documentBackUrl?: string;
    selfieUrl?: string;
    verificationMethod?: string;
  }): Promise<number> {
    // Check if user already has pending or verified KYC
    const existing = await this.getUserKYC(data.userId);

    if (existing && (existing.status === 'verified' || existing.status === 'pending')) {
      throw new Error(
        existing.status === 'verified'
          ? 'KYC already verified'
          : 'KYC verification already in progress'
      );
    }

    const sql = `
      INSERT INTO kyc_verifications (
        user_id, document_type, document_number,
        document_front_url, document_back_url, selfie_url,
        verification_method, status, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())
    `;

    const result = await query(sql, [
      data.userId,
      data.documentType,
      data.documentNumber,
      data.documentFrontUrl,
      data.documentBackUrl || null,
      data.selfieUrl || null,
      data.verificationMethod || 'manual'
    ]) as ResultSetHeader;

    return result.insertId;
  }

  /**
   * Get user's KYC verification record
   */
  async getUserKYC(userId: number): Promise<KYCVerification | null> {
    const sql = `
      SELECT
        id, user_id as userId, document_type as documentType,
        document_number as documentNumber,
        document_front_url as documentFrontUrl,
        document_back_url as documentBackUrl,
        selfie_url as selfieUrl,
        verification_method as verificationMethod,
        status, rejection_reason as rejectionReason,
        verified_by as verifiedBy, verified_at as verifiedAt,
        submitted_at as submittedAt
      FROM kyc_verifications
      WHERE user_id = ?
      ORDER BY submitted_at DESC
      LIMIT 1
    `;

    const results = await query(sql, [userId]) as RowDataPacket[];
    return results.length > 0 ? results[0] as KYCVerification : null;
  }

  /**
   * Get KYC verification by ID
   */
  async getKYCById(kycId: number): Promise<KYCVerification | null> {
    const sql = `
      SELECT
        id, user_id as userId, document_type as documentType,
        document_number as documentNumber,
        document_front_url as documentFrontUrl,
        document_back_url as documentBackUrl,
        selfie_url as selfieUrl,
        verification_method as verificationMethod,
        status, rejection_reason as rejectionReason,
        verified_by as verifiedBy, verified_at as verifiedAt,
        submitted_at as submittedAt
      FROM kyc_verifications
      WHERE id = ?
    `;

    const results = await query(sql, [kycId]) as RowDataPacket[];
    return results.length > 0 ? results[0] as KYCVerification : null;
  }

  /**
   * Update KYC verification status
   */
  async updateKYCStatus(
    kycId: number,
    status: 'in_progress' | 'verified' | 'rejected',
    verifiedBy: number,
    rejectionReason?: string
  ): Promise<void> {
    const sql = `
      UPDATE kyc_verifications
      SET status = ?,
          verified_by = ?,
          verified_at = NOW(),
          rejection_reason = ?
      WHERE id = ?
    `;

    await query(sql, [status, verifiedBy, rejectionReason || null, kycId]);

    // Update user verification status if verified
    if (status === 'verified') {
      const kyc = await this.getKYCById(kycId);
      if (kyc) {
        await query('UPDATE users SET is_verified = TRUE WHERE id = ?', [kyc.userId]);
      }
    }
  }

  /**
   * Get pending KYC verifications for admin
   */
  async getPendingVerifications(page: number = 1, limit: number = 20): Promise<{
    verifications: any[];
    total: number;
  }> {
    const countSql = `
      SELECT COUNT(*) as total
      FROM kyc_verifications
      WHERE status = 'pending' OR status = 'in_progress'
    `;

    const countResult = await query(countSql) as RowDataPacket[];
    const total = countResult[0].total;

    const sql = `
      SELECT
        k.id, k.user_id as userId, k.document_type as documentType,
        k.document_number as documentNumber,
        k.document_front_url as documentFrontUrl,
        k.document_back_url as documentBackUrl,
        k.selfie_url as selfieUrl,
        k.verification_method as verificationMethod,
        k.status, k.submitted_at as submittedAt,
        u.name as userName, u.phone as userPhone, u.email as userEmail
      FROM kyc_verifications k
      INNER JOIN users u ON u.id = k.user_id
      WHERE k.status IN ('pending', 'in_progress')
      ORDER BY k.submitted_at ASC
      LIMIT ? OFFSET ?
    `;

    const offset = (page - 1) * limit;
    const verifications = await query(sql, [limit, offset]) as RowDataPacket[];

    return { verifications, total };
  }

  /**
   * Get all KYC verifications with filters
   */
  async getAllVerifications(filters: {
    status?: string;
    documentType?: string;
    startDate?: Date;
    endDate?: Date;
    userId?: number;
    page?: number;
    limit?: number;
  }): Promise<{ verifications: any[]; total: number }> {
    let sql = `
      SELECT
        k.id, k.user_id as userId, k.document_type as documentType,
        k.document_number as documentNumber,
        k.document_front_url as documentFrontUrl,
        k.document_back_url as documentBackUrl,
        k.selfie_url as selfieUrl,
        k.verification_method as verificationMethod,
        k.status, k.rejection_reason as rejectionReason,
        k.verified_by as verifiedBy, k.verified_at as verifiedAt,
        k.submitted_at as submittedAt,
        u.name as userName, u.phone as userPhone, u.email as userEmail,
        v.name as verifierName
      FROM kyc_verifications k
      INNER JOIN users u ON u.id = k.user_id
      LEFT JOIN users v ON v.id = k.verified_by
      WHERE 1=1
    `;

    const params: any[] = [];

    if (filters.status) {
      sql += ` AND k.status = ?`;
      params.push(filters.status);
    }

    if (filters.documentType) {
      sql += ` AND k.document_type = ?`;
      params.push(filters.documentType);
    }

    if (filters.userId) {
      sql += ` AND k.user_id = ?`;
      params.push(filters.userId);
    }

    if (filters.startDate) {
      sql += ` AND k.submitted_at >= ?`;
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      sql += ` AND k.submitted_at <= ?`;
      params.push(filters.endDate);
    }

    // Count total
    const countSql = sql.replace(
      'SELECT k.id, k.user_id as userId, k.document_type as documentType, k.document_number as documentNumber, k.document_front_url as documentFrontUrl, k.document_back_url as documentBackUrl, k.selfie_url as selfieUrl, k.verification_method as verificationMethod, k.status, k.rejection_reason as rejectionReason, k.verified_by as verifiedBy, k.verified_at as verifiedAt, k.submitted_at as submittedAt, u.name as userName, u.phone as userPhone, u.email as userEmail, v.name as verifierName',
      'SELECT COUNT(*) as total'
    );
    const countResult = await query(countSql, params) as RowDataPacket[];
    const total = countResult[0].total;

    // Get paginated results
    sql += ` ORDER BY k.submitted_at DESC`;

    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const verifications = await query(sql, params) as RowDataPacket[];

    return { verifications, total };
  }

  /**
   * Verify Aadhaar using OTP (placeholder for integration)
   */
  async verifyAadhaarOTP(
    aadhaarNumber: string,
    otp: string
  ): Promise<{ success: boolean; details?: any; error?: string }> {
    // This would integrate with Aadhaar verification API (UIDAI)
    // Placeholder implementation
    console.log('Aadhaar OTP verification not yet integrated');

    return {
      success: false,
      error: 'Aadhaar OTP verification requires UIDAI API integration'
    };
  }

  /**
   * Verify PAN (placeholder for integration)
   */
  async verifyPAN(panNumber: string): Promise<{
    success: boolean;
    details?: { name: string; panNumber: string };
    error?: string;
  }> {
    // This would integrate with PAN verification API
    // Placeholder implementation
    console.log('PAN verification not yet integrated');

    return {
      success: false,
      error: 'PAN verification requires Income Tax API integration'
    };
  }

  /**
   * Get KYC statistics
   */
  async getKYCStats(): Promise<{
    total: number;
    pending: number;
    inProgress: number;
    verified: number;
    rejected: number;
    verificationRate: number;
  }> {
    const sql = `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as inProgress,
        SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
      FROM kyc_verifications
    `;

    const result = await query(sql) as RowDataPacket[];
    const stats = result[0];

    const verificationRate = stats.total > 0
      ? (stats.verified / stats.total) * 100
      : 0;

    return {
      total: stats.total || 0,
      pending: stats.pending || 0,
      inProgress: stats.inProgress || 0,
      verified: stats.verified || 0,
      rejected: stats.rejected || 0,
      verificationRate: Math.round(verificationRate * 100) / 100
    };
  }

  /**
   * Bulk approve KYC verifications
   */
  async bulkApprove(kycIds: number[], verifiedBy: number): Promise<number> {
    const placeholders = kycIds.map(() => '?').join(',');

    const sql = `
      UPDATE kyc_verifications
      SET status = 'verified',
          verified_by = ?,
          verified_at = NOW()
      WHERE id IN (${placeholders})
        AND status = 'pending'
    `;

    const result = await query(sql, [verifiedBy, ...kycIds]) as ResultSetHeader;

    // Update user verification status
    const userSql = `
      UPDATE users
      SET is_verified = TRUE
      WHERE id IN (
        SELECT user_id FROM kyc_verifications WHERE id IN (${placeholders})
      )
    `;

    await query(userSql, kycIds);

    return result.affectedRows;
  }
}

export default new KYCService();
