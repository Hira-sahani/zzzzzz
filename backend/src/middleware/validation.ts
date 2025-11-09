import { Request, Response, NextFunction } from 'express';
import { validationResult, body, param, query } from 'express-validator';

/**
 * Middleware to check validation results
 */
export const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: errors.array()
    });
    return;
  }
  next();
};

/**
 * Validation rules for authentication endpoints
 */
export const sendOTPValidation = [
  body('phone')
    .notEmpty().withMessage('Phone number is required')
    .matches(/^\+[1-9]\d{1,14}$/).withMessage('Invalid phone format (use E.164 format: +919876543210)'),
  validate
];

export const verifyOTPValidation = [
  body('phone')
    .notEmpty().withMessage('Phone number is required')
    .matches(/^\+[1-9]\d{1,14}$/).withMessage('Invalid phone format'),
  body('otp')
    .notEmpty().withMessage('OTP is required')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
    .isNumeric().withMessage('OTP must be numeric'),
  validate
];

export const updateProfileValidation = [
  body('name')
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
  body('email')
    .optional()
    .isEmail().withMessage('Invalid email format'),
  validate
];

/**
 * Validation rules for address endpoints
 */
export const createAddressValidation = [
  body('addressLine1')
    .notEmpty().withMessage('Address line 1 is required')
    .isLength({ max: 255 }).withMessage('Address line 1 too long'),
  body('city')
    .notEmpty().withMessage('City is required'),
  body('latitude')
    .isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  body('longitude')
    .isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  validate
];

/**
 * Validation rules for booking endpoints
 */
export const createBookingValidation = [
  body('bookingType')
    .isIn(['instant', 'scheduled']).withMessage('Invalid booking type'),
  body('scheduledDate')
    .if(body('bookingType').equals('scheduled'))
    .notEmpty().withMessage('Scheduled date required for scheduled bookings')
    .isISO8601().withMessage('Invalid date format'),
  body('scheduledTime')
    .if(body('bookingType').equals('scheduled'))
    .notEmpty().withMessage('Scheduled time required for scheduled bookings')
    .matches(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/).withMessage('Invalid time format (use HH:MM:SS)'),
  body('addressId')
    .isInt({ min: 1 }).withMessage('Valid address ID required'),
  body('serviceIds')
    .isArray({ min: 1 }).withMessage('At least one service must be selected')
    .custom((value) => value.every((id: any) => Number.isInteger(id) && id > 0))
    .withMessage('Invalid service IDs'),
  body('paymentMethod')
    .isIn(['stripe', 'cash']).withMessage('Invalid payment method'),
  validate
];

/**
 * Validation rules for rating endpoints
 */
export const createRatingValidation = [
  body('rating')
    .isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('timelinessRating')
    .optional()
    .isInt({ min: 1, max: 5 }).withMessage('Timeliness rating must be between 1 and 5'),
  body('qualityRating')
    .optional()
    .isInt({ min: 1, max: 5 }).withMessage('Quality rating must be between 1 and 5'),
  body('professionalismRating')
    .optional()
    .isInt({ min: 1, max: 5 }).withMessage('Professionalism rating must be between 1 and 5'),
  body('tip')
    .optional()
    .isFloat({ min: 0 }).withMessage('Tip must be a positive number'),
  validate
];

/**
 * Validation rules for cleaner endpoints
 */
export const updateAvailabilityValidation = [
  body('isAvailable')
    .isBoolean().withMessage('isAvailable must be boolean'),
  body('latitude')
    .if(body('isAvailable').equals('true' as any))
    .notEmpty().withMessage('Latitude required when setting available')
    .isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  body('longitude')
    .if(body('isAvailable').equals('true' as any))
    .notEmpty().withMessage('Longitude required when setting available')
    .isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  validate
];

export const updateLocationValidation = [
  body('latitude')
    .isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  body('longitude')
    .isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  validate
];

/**
 * Validation rules for admin endpoints
 */
export const adminLoginValidation = [
  body('email')
    .isEmail().withMessage('Valid email required'),
  body('password')
    .notEmpty().withMessage('Password required'),
  validate
];
