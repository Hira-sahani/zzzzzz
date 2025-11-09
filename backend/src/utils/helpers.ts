import { format } from 'date-fns';

/**
 * Generate random 6-digit OTP
 */
export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Generate unique booking number
 * Format: BK + YYYYMMDD + sequence (e.g., BK20250109001)
 */
export function generateBookingNumber(sequenceNumber: number): string {
  const dateStr = format(new Date(), 'yyyyMMdd');
  const sequence = sequenceNumber.toString().padStart(3, '0');
  return `BK${dateStr}${sequence}`;
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in kilometers
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Mask phone number for privacy
 * +919876543210 -> +91XXXXXX3210
 */
export function maskPhoneNumber(phone: string): string {
  if (phone.length <= 6) return phone;
  const start = phone.substring(0, 3);
  const end = phone.substring(phone.length - 4);
  const masked = 'X'.repeat(phone.length - 7);
  return `${start}${masked}${end}`;
}

/**
 * Calculate platform fee and cleaner earnings
 */
export function calculateBookingFinancials(
  totalAmount: number,
  platformFeePercentage: number
): {
  platformFee: number;
  cleanerEarnings: number;
} {
  const platformFee = (totalAmount * platformFeePercentage) / 100;
  const cleanerEarnings = totalAmount - platformFee;

  return {
    platformFee: Math.round(platformFee * 100) / 100, // Round to 2 decimals
    cleanerEarnings: Math.round(cleanerEarnings * 100) / 100
  };
}

/**
 * Calculate new average rating
 */
export function calculateNewAverage(
  currentAverage: number,
  totalRatings: number,
  newRating: number
): number {
  const total = currentAverage * totalRatings + newRating;
  const newAverage = total / (totalRatings + 1);
  return Math.round(newAverage * 100) / 100;
}

/**
 * Check if OTP is expired
 */
export function isOTPExpired(expiresAt: Date): boolean {
  return new Date() > new Date(expiresAt);
}

/**
 * Add minutes to current time
 */
export function addMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60000);
}

/**
 * Check if time is in the past
 */
export function isPastTime(date: Date): boolean {
  return new Date(date) < new Date();
}

/**
 * Sanitize user data for API response (remove sensitive fields)
 */
export function sanitizeUser(user: any): any {
  const { verification_documents, ...sanitized } = user;
  return sanitized;
}
