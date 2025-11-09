import { Request, Response } from 'express';
import { query } from '../config/database';
import { generateToken } from '../middleware/auth';
import { generateOTP, addMinutes, isOTPExpired } from '../utils/helpers';
import { sendOTPSMS } from '../services/smsService';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

/**
 * Send OTP to phone number
 * POST /api/v1/auth/send-otp
 */
export async function sendOTP(req: Request, res: Response): Promise<void> {
  try {
    const { phone } = req.body;

    // Check rate limit: max 3 OTP requests per phone per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentOTPs = await query(
      'SELECT COUNT(*) as count FROM otp_tokens WHERE phone = ? AND created_at > ?',
      [phone, oneHourAgo]
    );

    if (recentOTPs[0].count >= 3) {
      res.status(429).json({
        success: false,
        error: 'Too many OTP requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED'
      });
      return;
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = addMinutes(10); // 10 minutes expiry

    // Store OTP in database
    await query(
      'INSERT INTO otp_tokens (phone, otp_code, expires_at) VALUES (?, ?, ?)',
      [phone, otp, expiresAt]
    );

    // Send OTP via SMS
    await sendOTPSMS(phone, otp);

    logger.info(`OTP sent to ${phone}`);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      expiresIn: 600 // 10 minutes in seconds
    });
  } catch (error) {
    logger.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send OTP',
      code: 'OTP_SEND_FAILED'
    });
  }
}

/**
 * Verify OTP and authenticate user
 * POST /api/v1/auth/verify-otp
 */
export async function verifyOTP(req: Request, res: Response): Promise<void> {
  try {
    const { phone, otp } = req.body;

    // Find OTP token
    const otpTokens = await query(
      'SELECT * FROM otp_tokens WHERE phone = ? AND otp_code = ? AND is_used = false ORDER BY created_at DESC LIMIT 1',
      [phone, otp]
    );

    if (otpTokens.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Invalid OTP',
        code: 'INVALID_OTP'
      });
      return;
    }

    const otpToken = otpTokens[0];

    // Check if expired
    if (isOTPExpired(otpToken.expires_at)) {
      res.status(400).json({
        success: false,
        error: 'OTP has expired',
        code: 'EXPIRED_OTP'
      });
      return;
    }

    // Mark OTP as used
    await query('UPDATE otp_tokens SET is_used = true WHERE id = ?', [otpToken.id]);

    // Check if user exists
    let users = await query('SELECT * FROM users WHERE phone = ?', [phone]);
    let user;
    let isNewUser = false;

    if (users.length === 0) {
      // Create new user
      const result = await query(
        'INSERT INTO users (phone, user_type, status) VALUES (?, ?, ?)',
        [phone, 'customer', 'active']
      );

      users = await query('SELECT * FROM users WHERE id = ?', [result.insertId]);
      user = users[0];
      isNewUser = true;
      logger.info(`New user created: ${user.id}`);
    } else {
      user = users[0];
    }

    // Generate JWT token
    const token = generateToken(user.id, user.phone, user.user_type);

    // Prepare user response
    const userResponse: any = {
      id: user.id,
      phone: user.phone,
      userType: user.user_type,
      isNewUser: isNewUser
    };

    if (!isNewUser) {
      userResponse.name = user.name;
      userResponse.email = user.email;
      userResponse.profilePhoto = user.profile_photo_url;
    }

    res.status(200).json({
      success: true,
      token: token,
      user: userResponse
    });

    logger.info(`User authenticated: ${user.id}`);
  } catch (error) {
    logger.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
      code: 'AUTH_FAILED'
    });
  }
}

/**
 * Update user profile (after first login)
 * POST /api/v1/auth/update-profile
 */
export async function updateProfile(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { name, email } = req.body;

    // Update user
    await query(
      'UPDATE users SET name = ?, email = ? WHERE id = ?',
      [name, email || null, userId]
    );

    // Fetch updated user
    const users = await query('SELECT * FROM users WHERE id = ?', [userId]);
    const user = users[0];

    res.status(200).json({
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        email: user.email,
        userType: user.user_type
      }
    });

    logger.info(`Profile updated for user: ${userId}`);
  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile',
      code: 'UPDATE_FAILED'
    });
  }
}
