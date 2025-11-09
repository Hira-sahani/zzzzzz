import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface AuditLog {
  id?: number;
  userId?: number;
  action: string;
  resourceType: string;
  resourceId?: number;
  changes?: any;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

export class AuditService {
  /**
   * Log an action
   */
  async log(log: {
    userId?: number;
    action: string;
    resourceType: string;
    resourceId?: number;
    changes?: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<number> {
    const sql = `
      INSERT INTO audit_logs (
        user_id, action, resource_type, resource_id,
        changes, ip_address, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const result = await query(sql, [
      log.userId || null,
      log.action,
      log.resourceType,
      log.resourceId || null,
      log.changes ? JSON.stringify(log.changes) : null,
      log.ipAddress || null,
      log.userAgent || null
    ]) as ResultSetHeader;

    return result.insertId;
  }

  /**
   * Get audit logs with filters
   */
  async getLogs(filters: {
    userId?: number;
    action?: string;
    resourceType?: string;
    resourceId?: number;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ logs: any[]; total: number }> {
    let sql = `
      SELECT
        al.id, al.user_id as userId, al.action, al.resource_type as resourceType,
        al.resource_id as resourceId, al.changes, al.ip_address as ipAddress,
        al.user_agent as userAgent, al.created_at as createdAt,
        u.name as userName, u.email as userEmail
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE 1=1
    `;

    const params: any[] = [];

    if (filters.userId) {
      sql += ` AND al.user_id = ?`;
      params.push(filters.userId);
    }

    if (filters.action) {
      sql += ` AND al.action = ?`;
      params.push(filters.action);
    }

    if (filters.resourceType) {
      sql += ` AND al.resource_type = ?`;
      params.push(filters.resourceType);
    }

    if (filters.resourceId) {
      sql += ` AND al.resource_id = ?`;
      params.push(filters.resourceId);
    }

    if (filters.startDate) {
      sql += ` AND al.created_at >= ?`;
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      sql += ` AND al.created_at <= ?`;
      params.push(filters.endDate);
    }

    // Count total
    const countSql = sql.replace(
      'SELECT al.id, al.user_id as userId, al.action, al.resource_type as resourceType, al.resource_id as resourceId, al.changes, al.ip_address as ipAddress, al.user_agent as userAgent, al.created_at as createdAt, u.name as userName, u.email as userEmail',
      'SELECT COUNT(*) as total'
    );
    const countResult = await query(countSql, params) as RowDataPacket[];
    const total = countResult[0].total;

    // Get paginated results
    sql += ` ORDER BY al.created_at DESC`;

    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const offset = (page - 1) * limit;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const logs = await query(sql, params) as RowDataPacket[];

    // Parse changes JSON
    logs.forEach(log => {
      if (log.changes) {
        log.changes = JSON.parse(log.changes);
      }
    });

    return { logs, total };
  }

  /**
   * Get user activity
   */
  async getUserActivity(userId: number, days: number = 30): Promise<any[]> {
    const sql = `
      SELECT
        action, resource_type as resourceType,
        COUNT(*) as count,
        MAX(created_at) as lastActivity
      FROM audit_logs
      WHERE user_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY action, resource_type
      ORDER BY count DESC
    `;

    return await query(sql, [userId, days]) as RowDataPacket[];
  }

  /**
   * Get activity summary
   */
  async getActivitySummary(days: number = 7): Promise<{
    totalActions: number;
    uniqueUsers: number;
    topActions: any[];
    topUsers: any[];
  }> {
    const totalSql = `
      SELECT
        COUNT(*) as totalActions,
        COUNT(DISTINCT user_id) as uniqueUsers
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const totalResult = await query(totalSql, [days]) as RowDataPacket[];

    const topActionsSql = `
      SELECT
        action, COUNT(*) as count
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY action
      ORDER BY count DESC
      LIMIT 10
    `;

    const topActions = await query(topActionsSql, [days]) as RowDataPacket[];

    const topUsersSql = `
      SELECT
        al.user_id as userId,
        u.name as userName,
        u.email as userEmail,
        COUNT(*) as actionCount
      FROM audit_logs al
      INNER JOIN users u ON u.id = al.user_id
      WHERE al.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY al.user_id, u.name, u.email
      ORDER BY actionCount DESC
      LIMIT 10
    `;

    const topUsers = await query(topUsersSql, [days]) as RowDataPacket[];

    return {
      totalActions: totalResult[0].totalActions || 0,
      uniqueUsers: totalResult[0].uniqueUsers || 0,
      topActions,
      topUsers
    };
  }

  /**
   * Clean up old audit logs
   */
  async cleanup(daysToKeep: number = 365): Promise<number> {
    const sql = `
      DELETE FROM audit_logs
      WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const result = await query(sql, [daysToKeep]) as ResultSetHeader;
    return result.affectedRows;
  }
}

export default new AuditService();
