import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/database';
import { generateToken } from '../middleware/auth';
import { logger } from '../utils/logger';

/**
 * Admin login
 * POST /api/v1/admin/login
 */
export async function adminLogin(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    // Find admin user
    const adminUsers = await query(
      'SELECT au.*, u.* FROM admin_users au JOIN users u ON au.user_id = u.id WHERE au.email = ?',
      [email]
    );

    if (adminUsers.length === 0) {
      res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
      return;
    }

    const adminUser = adminUsers[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, adminUser.password_hash);

    if (!isValidPassword) {
      res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
      return;
    }

    // Check account status
    if (adminUser.status !== 'active') {
      res.status(403).json({
        success: false,
        error: 'Account suspended',
        code: 'ACCOUNT_SUSPENDED'
      });
      return;
    }

    // Update last login
    await query('UPDATE admin_users SET last_login_at = NOW() WHERE id = ?', [adminUser.id]);

    // Generate token
    const token = generateToken(adminUser.user_id, adminUser.phone, 'admin');

    res.status(200).json({
      success: true,
      token: token,
      admin: {
        id: adminUser.user_id,
        email: adminUser.email,
        name: adminUser.name,
        role: adminUser.role
      }
    });

    logger.info(`Admin logged in: ${email}`);
  } catch (error) {
    logger.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
      code: 'LOGIN_FAILED'
    });
  }
}

/**
 * Get dashboard statistics
 * GET /api/v1/admin/dashboard/stats
 */
export async function getDashboardStats(req: Request, res: Response): Promise<void> {
  try {
    // Today's stats
    const todayBookings = await query(
      "SELECT COUNT(*) as total FROM bookings WHERE DATE(created_at) = CURDATE()"
    );

    const todayCompleted = await query(
      "SELECT COUNT(*) as total FROM bookings WHERE DATE(completed_at) = CURDATE() AND status = 'completed'"
    );

    const todayInProgress = await query(
      "SELECT COUNT(*) as total FROM bookings WHERE status = 'in_progress'"
    );

    const todayCancelled = await query(
      "SELECT COUNT(*) as total FROM bookings WHERE DATE(cancelled_at) = CURDATE() AND status = 'cancelled'"
    );

    const todayRevenue = await query(
      "SELECT SUM(total_amount) as revenue FROM bookings WHERE DATE(completed_at) = CURDATE() AND status = 'completed'"
    );

    const activeCleaners = await query(
      "SELECT COUNT(*) as count FROM users WHERE user_type = 'cleaner' AND is_available = true"
    );

    // This week stats
    const weekBookings = await query(
      "SELECT COUNT(*) as total FROM bookings WHERE YEARWEEK(created_at) = YEARWEEK(NOW())"
    );

    const weekRevenue = await query(
      "SELECT SUM(total_amount) as revenue FROM bookings WHERE YEARWEEK(completed_at) = YEARWEEK(NOW()) AND status = 'completed'"
    );

    // This month stats
    const monthBookings = await query(
      "SELECT COUNT(*) as total FROM bookings WHERE MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())"
    );

    const monthRevenue = await query(
      "SELECT SUM(total_amount) as revenue FROM bookings WHERE MONTH(completed_at) = MONTH(NOW()) AND YEAR(completed_at) = YEAR(NOW()) AND status = 'completed'"
    );

    // Average rating
    const avgRating = await query(
      "SELECT AVG(rating_average) as average FROM users WHERE user_type = 'cleaner' AND total_ratings > 0"
    );

    // Pending issues
    const pendingIssues = await query(
      "SELECT COUNT(*) as count FROM issues WHERE status = 'open'"
    );

    res.status(200).json({
      success: true,
      stats: {
        today: {
          totalBookings: todayBookings[0].total,
          completedBookings: todayCompleted[0].total,
          inProgressBookings: todayInProgress[0].total,
          cancelledBookings: todayCancelled[0].total,
          revenue: todayRevenue[0].revenue || 0,
          activeCleaners: activeCleaners[0].count
        },
        thisWeek: {
          totalBookings: weekBookings[0].total,
          revenue: weekRevenue[0].revenue || 0
        },
        thisMonth: {
          totalBookings: monthBookings[0].total,
          revenue: monthRevenue[0].revenue || 0
        },
        averageRating: avgRating[0].average ? parseFloat(avgRating[0].average).toFixed(2) : 0,
        pendingIssues: pendingIssues[0].count
      }
    });
  } catch (error) {
    logger.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard stats',
      code: 'FETCH_FAILED'
    });
  }
}

/**
 * Get all cleaners (admin view)
 * GET /api/v1/admin/cleaners
 */
export async function getCleaners(req: Request, res: Response): Promise<void> {
  try {
    const status = req.query.status as string;
    const isAvailable = req.query.isAvailable as string;
    const search = req.query.search as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    let sql = "SELECT * FROM users WHERE user_type = 'cleaner'";
    let countSql = "SELECT COUNT(*) as total FROM users WHERE user_type = 'cleaner'";
    const params: any[] = [];

    if (status) {
      sql += ' AND status = ?';
      countSql += ' AND status = ?';
      params.push(status);
    }

    if (isAvailable) {
      sql += ' AND is_available = ?';
      countSql += ' AND is_available = ?';
      params.push(isAvailable === 'true');
    }

    if (search) {
      sql += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
      countSql += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

    const cleaners = await query(sql, [...params, limit, offset]);
    const countResult = await query(countSql, params);
    const total = countResult[0].total;

    res.status(200).json({
      success: true,
      cleaners: cleaners,
      pagination: {
        total: total,
        page: page,
        limit: limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Get cleaners error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cleaners',
      code: 'FETCH_FAILED'
    });
  }
}

/**
 * Create new cleaner
 * POST /api/v1/admin/cleaners
 */
export async function createCleaner(req: Request, res: Response): Promise<void> {
  try {
    const { name, phone, email, status = 'pending_approval' } = req.body;

    // Check if phone already exists
    const existingUsers = await query('SELECT * FROM users WHERE phone = ?', [phone]);

    if (existingUsers.length > 0) {
      res.status(400).json({
        success: false,
        error: 'Phone number already registered',
        code: 'PHONE_EXISTS'
      });
      return;
    }

    // Create cleaner user
    const result = await query(
      `INSERT INTO users (phone, user_type, name, email, status)
       VALUES (?, 'cleaner', ?, ?, ?)`,
      [phone, name, email || null, status]
    );

    const cleaner = await query('SELECT * FROM users WHERE id = ?', [result.insertId]);

    res.status(201).json({
      success: true,
      cleaner: cleaner[0]
    });

    logger.info(`Cleaner created: ${result.insertId}`);
  } catch (error) {
    logger.error('Create cleaner error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create cleaner',
      code: 'CREATE_FAILED'
    });
  }
}

/**
 * Update cleaner
 * PUT /api/v1/admin/cleaners/:id
 */
export async function updateCleaner(req: Request, res: Response): Promise<void> {
  try {
    const cleanerId = parseInt(req.params.id);
    const { status, isVerified } = req.body;

    await query(
      'UPDATE users SET status = ?, is_verified = ? WHERE id = ? AND user_type = ?',
      [status, isVerified, cleanerId, 'cleaner']
    );

    const cleaner = await query('SELECT * FROM users WHERE id = ?', [cleanerId]);

    res.status(200).json({
      success: true,
      cleaner: cleaner[0]
    });

    logger.info(`Cleaner updated: ${cleanerId}`);
  } catch (error) {
    logger.error('Update cleaner error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update cleaner',
      code: 'UPDATE_FAILED'
    });
  }
}
