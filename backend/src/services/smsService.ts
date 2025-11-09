import twilio from 'twilio';
import { logger } from '../utils/logger';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

let twilioClient: twilio.Twilio | null = null;

// Initialize Twilio client if credentials are available
if (accountSid && authToken && twilioPhone) {
  twilioClient = twilio(accountSid, authToken);
}

export interface SMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send SMS using Twilio
 */
export async function sendSMS(to: string, message: string): Promise<SMSResult> {
  // If Twilio not configured, log and return mock success (for development)
  if (!twilioClient) {
    logger.warn(`Twilio not configured. Mock SMS to ${to}: ${message}`);
    return {
      success: true,
      messageId: `mock_${Date.now()}`
    };
  }

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: twilioPhone,
      to: to
    });

    logger.info(`SMS sent successfully to ${to}, SID: ${result.sid}`);

    return {
      success: true,
      messageId: result.sid
    };
  } catch (error: any) {
    logger.error(`Failed to send SMS to ${to}:`, error);
    return {
      success: false,
      error: error.message || 'Failed to send SMS'
    };
  }
}

/**
 * Send OTP SMS
 */
export async function sendOTPSMS(phone: string, otp: string): Promise<SMSResult> {
  const message = `Your Primo verification code is: ${otp}. Valid for 10 minutes. Do not share this code with anyone.`;
  return sendSMS(phone, message);
}

/**
 * Send booking confirmation SMS
 */
export async function sendBookingConfirmationSMS(
  phone: string,
  bookingNumber: string,
  services: string[],
  totalAmount: number
): Promise<SMSResult> {
  const servicesList = services.join(', ');
  const message = `Primo: Your booking ${bookingNumber} is confirmed! Services: ${servicesList}. Total: ₹${totalAmount}. We're finding a cleaner for you.`;
  return sendSMS(phone, message);
}

/**
 * Send cleaner assigned SMS
 */
export async function sendCleanerAssignedSMS(
  phone: string,
  cleanerName: string,
  estimatedArrival: string
): Promise<SMSResult> {
  const message = `Primo: ${cleanerName} is on the way! Estimated arrival: ${estimatedArrival}. Track them in the app.`;
  return sendSMS(phone, message);
}

/**
 * Send job completion SMS
 */
export async function sendJobCompletionSMS(
  phone: string,
  bookingNumber: string
): Promise<SMSResult> {
  const message = `Primo: Your service (${bookingNumber}) is complete! Please rate your experience in the app. Thank you for choosing Primo!`;
  return sendSMS(phone, message);
}

/**
 * Send cancellation SMS
 */
export async function sendCancellationSMS(
  phone: string,
  bookingNumber: string,
  reason?: string
): Promise<SMSResult> {
  const message = `Primo: Booking ${bookingNumber} has been cancelled. ${reason || ''} If you have questions, contact support.`;
  return sendSMS(phone, message);
}
