import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface Escalation {
  id?: number;
  bookingId: number;
  issueType: 'cleaner_no_show' | 'customer_not_home' | 'safety_concern' | 'equipment_failure' | 'payment_dispute' | 'quality_issue' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  reportedBy: number;
  reporterType: 'customer' | 'cleaner' | 'system';
  description: string;
  currentLevel: number;
  assignedTo?: number;
  status: 'open' | 'in_progress' | 'resolved' | 'escalated';
  resolutionTime?: number;
  createdAt: Date;
}

export class EscalationService {
  // Escalation ladder configuration
  private escalationLadder = [
    { level: 1, role: 'support_agent', timeoutMinutes: 15 },
    { level: 2, role: 'team_lead', timeoutMinutes: 30 },
    { level: 3, role: 'operations_manager', timeoutMinutes: 60 },
    { level: 4, role: 'director', timeoutMinutes: 120 }
  ];

  /**
   * Create new escalation
   */
  async createEscalation(data: {
    bookingId: number;
    issueType: string;
    severity: string;
    reportedBy: number;
    reporterType: string;
    description: string;
  }): Promise<number> {
    // Calculate initial severity if not provided
    const severity = data.severity || await this.calculateSeverity(data.bookingId, data.issueType);

    // Determine initial assignment based on severity
    const initialLevel = severity === 'critical' ? 2 : 1;
    const assignedTo = await this.getNextAvailableAgent(initialLevel);

    const sql = `
      INSERT INTO escalations (
        booking_id, issue_type, severity, reported_by, reporter_type,
        description, current_level, assigned_to, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', NOW())
    `;

    const result = await query(sql, [
      data.bookingId,
      data.issueType,
      severity,
      data.reportedBy,
      data.reporterType,
      data.description,
      initialLevel,
      assignedTo
    ]) as ResultSetHeader;

    // Notify assigned agent
    await this.notifyAgent(assignedTo, result.insertId);

    // Set auto-escalation timer
    await this.scheduleAutoEscalation(result.insertId);

    return result.insertId;
  }

  /**
   * Calculate severity based on issue type and context
   */
  private async calculateSeverity(bookingId: number, issueType: string): Promise<string> {
    // Get booking details
    const sql = `
      SELECT b.total_amount, b.booking_type, u.total_bookings
      FROM bookings b
      INNER JOIN users u ON u.id = b.customer_id
      WHERE b.id = ?
    `;

    const result = await query(sql, [bookingId]) as RowDataPacket[];

    if (result.length === 0) return 'medium';

    const booking = result[0];

    // Critical issues
    if (['safety_concern', 'cleaner_no_show'].includes(issueType)) {
      return 'critical';
    }

    // High value or VIP customer
    if (booking.total_amount > 1000 || booking.total_bookings > 10) {
      return 'high';
    }

    // Instant bookings are higher priority
    if (booking.booking_type === 'instant') {
      return 'high';
    }

    // Default
    return 'medium';
  }

  /**
   * Get next available agent at level
   */
  private async getNextAvailableAgent(level: number): Promise<number | null> {
    const role = this.escalationLadder[level - 1]?.role;

    if (!role) return null;

    const sql = `
      SELECT u.id, COUNT(e.id) as activeEscalations
      FROM users u
      LEFT JOIN escalations e ON e.assigned_to = u.id AND e.status IN ('open', 'in_progress')
      INNER JOIN user_roles ur ON ur.user_id = u.id
      INNER JOIN roles r ON r.id = ur.role_id
      WHERE r.name = ?
        AND u.status = 'active'
      GROUP BY u.id
      ORDER BY activeEscalations ASC, RAND()
      LIMIT 1
    `;

    const agents = await query(sql, [role]) as RowDataPacket[];

    return agents.length > 0 ? agents[0].id : null;
  }

  /**
   * Notify agent of new escalation
   */
  private async notifyAgent(agentId: number | null, escalationId: number): Promise<void> {
    if (!agentId) return;

    // TODO: Send push notification/SMS to agent
    console.log(`Notified agent ${agentId} of escalation ${escalationId}`);
  }

  /**
   * Schedule auto-escalation
   */
  private async scheduleAutoEscalation(escalationId: number): Promise<void> {
    // Get escalation details
    const sql = `SELECT current_level FROM escalations WHERE id = ?`;
    const result = await query(sql, [escalationId]) as RowDataPacket[];

    if (result.length === 0) return;

    const level = result[0].current_level;
    const timeout = this.escalationLadder[level - 1]?.timeoutMinutes || 30;

    // Set escalation timeout
    await query(
      'UPDATE escalations SET escalate_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
      [timeout, escalationId]
    );
  }

  /**
   * Escalate to next level
   */
  async escalateToNextLevel(escalationId: number, reason?: string): Promise<void> {
    // Get current escalation
    const sql = `SELECT current_level, severity FROM escalations WHERE id = ?`;
    const result = await query(sql, [escalationId]) as RowDataPacket[];

    if (result.length === 0) {
      throw new Error('Escalation not found');
    }

    const currentLevel = result[0].current_level;
    const nextLevel = currentLevel + 1;

    if (nextLevel > this.escalationLadder.length) {
      throw new Error('Already at highest escalation level');
    }

    // Get next agent
    const nextAgent = await this.getNextAvailableAgent(nextLevel);

    // Update escalation
    await query(
      `UPDATE escalations
       SET current_level = ?,
           assigned_to = ?,
           status = 'escalated',
           escalated_at = NOW(),
           escalation_reason = ?
       WHERE id = ?`,
      [nextLevel, nextAgent, reason || 'Auto-escalated due to timeout', escalationId]
    );

    // Log escalation
    await query(
      `INSERT INTO escalation_history (escalation_id, from_level, to_level, reason, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [escalationId, currentLevel, nextLevel, reason || 'Auto-escalated']
    );

    // Notify new agent
    await this.notifyAgent(nextAgent, escalationId);

    // Set new timeout
    await this.scheduleAutoEscalation(escalationId);
  }

  /**
   * Process auto-escalations
   */
  async processAutoEscalations(): Promise<{ processed: number; escalated: number }> {
    // Find escalations that need escalation
    const sql = `
      SELECT id
      FROM escalations
      WHERE status IN ('open', 'in_progress')
        AND escalate_at IS NOT NULL
        AND escalate_at <= NOW()
    `;

    const escalations = await query(sql) as RowDataPacket[];

    let escalated = 0;

    for (const esc of escalations) {
      try {
        await this.escalateToNextLevel(esc.id, 'Auto-escalated due to timeout');
        escalated++;
      } catch (error) {
        console.error(`Failed to auto-escalate ${esc.id}:`, error);
      }
    }

    return {
      processed: escalations.length,
      escalated
    };
  }

  /**
   * Resolve escalation
   */
  async resolveEscalation(
    escalationId: number,
    resolution: string,
    resolvedBy: number
  ): Promise<void> {
    const sql = `
      UPDATE escalations
      SET status = 'resolved',
          resolution = ?,
          resolved_by = ?,
          resolved_at = NOW(),
          resolution_time = TIMESTAMPDIFF(MINUTE, created_at, NOW())
      WHERE id = ?
    `;

    await query(sql, [resolution, resolvedBy, escalationId]);

    // Log resolution
    await query(
      `INSERT INTO escalation_history (escalation_id, action, description, created_at)
       VALUES (?, 'resolved', ?, NOW())`,
      [escalationId, resolution]
    );
  }

  /**
   * Get active escalations
   */
  async getActiveEscalations(filters?: {
    severity?: string;
    assignedTo?: number;
    level?: number;
  }): Promise<any[]> {
    let sql = `
      SELECT
        e.id,
        e.booking_id as bookingId,
        e.issue_type as issueType,
        e.severity,
        e.reported_by as reportedBy,
        e.reporter_type as reporterType,
        e.description,
        e.current_level as currentLevel,
        e.assigned_to as assignedTo,
        e.status,
        e.created_at as createdAt,
        e.escalate_at as escalateAt,
        TIMESTAMPDIFF(MINUTE, e.created_at, NOW()) as ageMinutes,
        u.name as reporterName,
        a.name as assigneeName
      FROM escalations e
      LEFT JOIN users u ON u.id = e.reported_by
      LEFT JOIN users a ON a.id = e.assigned_to
      WHERE e.status IN ('open', 'in_progress', 'escalated')
    `;

    const params: any[] = [];

    if (filters?.severity) {
      sql += ` AND e.severity = ?`;
      params.push(filters.severity);
    }

    if (filters?.assignedTo) {
      sql += ` AND e.assigned_to = ?`;
      params.push(filters.assignedTo);
    }

    if (filters?.level) {
      sql += ` AND e.current_level = ?`;
      params.push(filters.level);
    }

    sql += ` ORDER BY
      FIELD(e.severity, 'critical', 'high', 'medium', 'low'),
      e.created_at ASC`;

    return await query(sql, params) as RowDataPacket[];
  }

  /**
   * Get escalation statistics
   */
  async getEscalationStats(days: number = 30): Promise<{
    totalEscalations: number;
    byLevel: { [level: number]: number };
    bySeverity: { [severity: string]: number };
    avgResolutionTime: number;
    resolved: number;
    escalated: number;
  }> {
    const sql = `
      SELECT
        COUNT(*) as totalEscalations,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
        SUM(CASE WHEN status = 'escalated' THEN 1 ELSE 0 END) as escalated,
        AVG(CASE WHEN status = 'resolved' THEN resolution_time ELSE NULL END) as avgResolutionTime
      FROM escalations
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const stats = await query(sql, [days]) as RowDataPacket[];

    // By level
    const levelSql = `
      SELECT current_level, COUNT(*) as count
      FROM escalations
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY current_level
    `;
    const levels = await query(levelSql, [days]) as RowDataPacket[];
    const byLevel: any = {};
    levels.forEach(l => { byLevel[l.current_level] = l.count; });

    // By severity
    const severitySql = `
      SELECT severity, COUNT(*) as count
      FROM escalations
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY severity
    `;
    const severities = await query(severitySql, [days]) as RowDataPacket[];
    const bySeverity: any = {};
    severities.forEach(s => { bySeverity[s.severity] = s.count; });

    return {
      totalEscalations: stats[0].totalEscalations || 0,
      byLevel,
      bySeverity,
      avgResolutionTime: parseFloat(stats[0].avgResolutionTime || 0),
      resolved: stats[0].resolved || 0,
      escalated: stats[0].escalated || 0
    };
  }
}

export default new EscalationService();
