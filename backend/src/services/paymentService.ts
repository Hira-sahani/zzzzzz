import Stripe from 'stripe';
import { logger } from '../utils/logger';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

let stripe: Stripe | null = null;

// Initialize Stripe if credentials are available
if (stripeSecretKey) {
  stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16'
  });
}

export interface PaymentIntentResult {
  success: boolean;
  clientSecret?: string;
  paymentIntentId?: string;
  error?: string;
}

export interface RefundResult {
  success: boolean;
  refundId?: string;
  error?: string;
}

/**
 * Create a Stripe Payment Intent
 */
export async function createPaymentIntent(
  amount: number,
  currency: string = 'inr',
  metadata: Record<string, string> = {}
): Promise<PaymentIntentResult> {
  // If Stripe not configured, return mock success (for development)
  if (!stripe) {
    logger.warn(`Stripe not configured. Mock payment intent for amount: ${amount}`);
    return {
      success: true,
      clientSecret: `mock_secret_${Date.now()}`,
      paymentIntentId: `mock_pi_${Date.now()}`
    };
  }

  try {
    // Stripe expects amount in smallest currency unit (paise for INR)
    const amountInSmallestUnit = Math.round(amount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInSmallestUnit,
      currency: currency,
      metadata: metadata,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    logger.info(`Payment intent created: ${paymentIntent.id} for amount ${amount}`);

    return {
      success: true,
      clientSecret: paymentIntent.client_secret || undefined,
      paymentIntentId: paymentIntent.id
    };
  } catch (error: any) {
    logger.error('Failed to create payment intent:', error);
    return {
      success: false,
      error: error.message || 'Failed to create payment intent'
    };
  }
}

/**
 * Capture a payment (for bookings paid via Stripe)
 */
export async function capturePayment(paymentIntentId: string): Promise<PaymentIntentResult> {
  if (!stripe) {
    logger.warn(`Stripe not configured. Mock payment capture: ${paymentIntentId}`);
    return {
      success: true,
      paymentIntentId: paymentIntentId
    };
  }

  try {
    const paymentIntent = await stripe.paymentIntents.capture(paymentIntentId);

    logger.info(`Payment captured: ${paymentIntentId}`);

    return {
      success: true,
      paymentIntentId: paymentIntent.id
    };
  } catch (error: any) {
    logger.error(`Failed to capture payment ${paymentIntentId}:`, error);
    return {
      success: false,
      error: error.message || 'Failed to capture payment'
    };
  }
}

/**
 * Refund a payment
 */
export async function refundPayment(
  paymentIntentId: string,
  amount?: number
): Promise<RefundResult> {
  if (!stripe) {
    logger.warn(`Stripe not configured. Mock refund: ${paymentIntentId}`);
    return {
      success: true,
      refundId: `mock_refund_${Date.now()}`
    };
  }

  try {
    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: paymentIntentId
    };

    // Partial refund if amount specified
    if (amount) {
      refundParams.amount = Math.round(amount * 100);
    }

    const refund = await stripe.refunds.create(refundParams);

    logger.info(`Refund processed: ${refund.id} for payment ${paymentIntentId}`);

    return {
      success: true,
      refundId: refund.id
    };
  } catch (error: any) {
    logger.error(`Failed to refund payment ${paymentIntentId}:`, error);
    return {
      success: false,
      error: error.message || 'Failed to process refund'
    };
  }
}

/**
 * Create a payment intent for tip
 */
export async function createTipPaymentIntent(
  amount: number,
  cleanerId: number,
  bookingNumber: string
): Promise<PaymentIntentResult> {
  return createPaymentIntent(amount, 'inr', {
    type: 'tip',
    cleaner_id: cleanerId.toString(),
    booking_number: bookingNumber
  });
}

/**
 * Get publishable key (for frontend)
 */
export function getPublishableKey(): string {
  return stripePublishableKey || 'pk_test_mock_key';
}

/**
 * Retrieve payment intent details
 */
export async function getPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent | null> {
  if (!stripe) {
    logger.warn(`Stripe not configured. Mock get payment intent: ${paymentIntentId}`);
    return null;
  }

  try {
    return await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (error: any) {
    logger.error(`Failed to retrieve payment intent ${paymentIntentId}:`, error);
    return null;
  }
}
