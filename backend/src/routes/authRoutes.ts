import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';
import {
  sendOTPValidation,
  verifyOTPValidation,
  updateProfileValidation
} from '../middleware/validation';
import { otpRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// POST /api/v1/auth/send-otp - Send OTP to phone
router.post('/send-otp', otpRateLimiter, sendOTPValidation, authController.sendOTP);

// POST /api/v1/auth/verify-otp - Verify OTP and authenticate
router.post('/verify-otp', verifyOTPValidation, authController.verifyOTP);

// POST /api/v1/auth/update-profile - Update user profile (requires auth)
router.post('/update-profile', authenticateToken, updateProfileValidation, authController.updateProfile);

export default router;
