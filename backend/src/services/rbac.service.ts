import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface Role {
  id?: number;
  name: string;
  description?: string;
  isSystemRole: boolean;
}

export interface Permission {
  id?: number;
  resource: string;
  action: string;
  description?: string;
}

export class RBACService {
  /**
   * Check if user has permission
   */
  async hasPermission(userId: number, resource: string, action: string): Promise<boolean> {
    const sql = `
      SELECT COUNT(*) as count
      FROM user_roles ur
      INNER JOIN role_permissions rp ON rp.role_id = ur.role_id
      INNER JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ?
        AND p.resource = ?
        AND p.action = ?
    `;

    const result = await query(sql, [userId, resource, action]) as RowDataPacket[];
    return result[0].count > 0;
  }

  /**
   * Get user permissions
   */
  async getUserPermissions(userId: number): Promise<Permission[]> {
    const sql = `
      SELECT DISTINCT
        p.id, p.resource, p.action, p.description
      FROM user_roles ur
      INNER JOIN role_permissions rp ON rp.role_id = ur.role_id
      INNER JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ?
      ORDER BY p.resource, p.action
    `;

    return await query(sql, [userId]) as Permission[];
  }

  /**
   * Get user roles
   */
  async getUserRoles(userId: number): Promise<Role[]> {
    const sql = `
      SELECT
        r.id, r.name, r.description, r.is_system_role as isSystemRole
      FROM user_roles ur
      INNER JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY r.name
    `;

    return await query(sql, [userId]) as Role[];
  }

  /**
   * Assign role to user
   */
  async assignRole(userId: number, roleId: number, assignedBy: number): Promise<void> {
    // Check if already assigned
    const checkSql = `SELECT COUNT(*) as count FROM user_roles WHERE user_id = ? AND role_id = ?`;
    const existing = await query(checkSql, [userId, roleId]) as RowDataPacket[];

    if (existing[0].count > 0) {
      return; // Already assigned
    }

    const sql = `
      INSERT INTO user_roles (user_id, role_id, assigned_by, assigned_at)
      VALUES (?, ?, ?, NOW())
    `;

    await query(sql, [userId, roleId, assignedBy]);
  }

  /**
   * Remove role from user
   */
  async removeRole(userId: number, roleId: number): Promise<void> {
    const sql = `DELETE FROM user_roles WHERE user_id = ? AND role_id = ?`;
    await query(sql, [userId, roleId]);
  }

  /**
   * Create role
   */
  async createRole(role: { name: string; description?: string; isSystemRole?: boolean }): Promise<number> {
    const sql = `
      INSERT INTO roles (name, description, is_system_role)
      VALUES (?, ?, ?)
    `;

    const result = await query(sql, [
      role.name,
      role.description || null,
      role.isSystemRole || false
    ]) as ResultSetHeader;

    return result.insertId;
  }

  /**
   * Get all roles
   */
  async getAllRoles(): Promise<Role[]> {
    const sql = `
      SELECT id, name, description, is_system_role as isSystemRole
      FROM roles
      ORDER BY name
    `;

    return await query(sql) as Role[];
  }

  /**
   * Get role by ID
   */
  async getRoleById(roleId: number): Promise<Role | null> {
    const sql = `
      SELECT id, name, description, is_system_role as isSystemRole
      FROM roles
      WHERE id = ?
    `;

    const roles = await query(sql, [roleId]) as RowDataPacket[];
    return roles.length > 0 ? roles[0] as Role : null;
  }

  /**
   * Create permission
   */
  async createPermission(permission: { resource: string; action: string; description?: string }): Promise<number> {
    const sql = `
      INSERT INTO permissions (resource, action, description)
      VALUES (?, ?, ?)
    `;

    const result = await query(sql, [
      permission.resource,
      permission.action,
      permission.description || null
    ]) as ResultSetHeader;

    return result.insertId;
  }

  /**
   * Get all permissions
   */
  async getAllPermissions(): Promise<Permission[]> {
    const sql = `
      SELECT id, resource, action, description
      FROM permissions
      ORDER BY resource, action
    `;

    return await query(sql) as Permission[];
  }

  /**
   * Get role permissions
   */
  async getRolePermissions(roleId: number): Promise<Permission[]> {
    const sql = `
      SELECT
        p.id, p.resource, p.action, p.description
      FROM role_permissions rp
      INNER JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ?
      ORDER BY p.resource, p.action
    `;

    return await query(sql, [roleId]) as Permission[];
  }

  /**
   * Assign permission to role
   */
  async assignPermissionToRole(roleId: number, permissionId: number): Promise<void> {
    // Check if already assigned
    const checkSql = `SELECT COUNT(*) as count FROM role_permissions WHERE role_id = ? AND permission_id = ?`;
    const existing = await query(checkSql, [roleId, permissionId]) as RowDataPacket[];

    if (existing[0].count > 0) {
      return; // Already assigned
    }

    const sql = `
      INSERT INTO role_permissions (role_id, permission_id)
      VALUES (?, ?)
    `;

    await query(sql, [roleId, permissionId]);
  }

  /**
   * Remove permission from role
   */
  async removePermissionFromRole(roleId: number, permissionId: number): Promise<void> {
    const sql = `DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?`;
    await query(sql, [roleId, permissionId]);
  }

  /**
   * Set role permissions (replaces all existing)
   */
  async setRolePermissions(roleId: number, permissionIds: number[]): Promise<void> {
    // Remove all existing permissions
    await query(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);

    // Add new permissions
    if (permissionIds.length > 0) {
      const values = permissionIds.map(pid => `(${roleId}, ${pid})`).join(',');
      const sql = `INSERT INTO role_permissions (role_id, permission_id) VALUES ${values}`;
      await query(sql);
    }
  }

  /**
   * Get users by role
   */
  async getUsersByRole(roleId: number): Promise<any[]> {
    const sql = `
      SELECT
        u.id, u.name, u.email, u.phone, u.user_type as userType,
        ur.assigned_at as assignedAt
      FROM user_roles ur
      INNER JOIN users u ON u.id = ur.user_id
      WHERE ur.role_id = ?
      ORDER BY ur.assigned_at DESC
    `;

    return await query(sql, [roleId]) as RowDataPacket[];
  }
}

export default new RBACService();
