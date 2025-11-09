export type UserType = 'customer' | 'cleaner' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'pending_approval' | 'inactive';
export type BookingType = 'instant' | 'scheduled';
export type BookingStatus = 'pending' | 'assigned' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';
export type PaymentMethod = 'stripe' | 'cash';
export type PaymentStatus = 'pending' | 'paid' | 'refunded';
export type NotificationType = 'sms' | 'push' | 'email';
export type NotificationStatus = 'pending' | 'sent' | 'failed';
export type IssueType = 'quality' | 'payment' | 'behavior' | 'no_show' | 'other';
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TransactionType = 'booking_payment' | 'refund' | 'cleaner_payout' | 'tip';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'refunded';
export type AdminRole = 'super_admin' | 'operations_manager';
export type PhotoType = 'before' | 'after' | 'general';

export interface User {
  id: number;
  phone: string;
  user_type: UserType;
  name: string | null;
  email: string | null;
  profile_photo_url: string | null;
  status: UserStatus;
  is_available: boolean;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_update: Date | null;
  rating_average: number;
  total_ratings: number;
  total_jobs_completed: number;
  total_bookings: number;
  verification_documents: any | null;
  is_verified: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface OTPToken {
  id: number;
  phone: string;
  otp_code: string;
  expires_at: Date;
  is_used: boolean;
  created_at: Date;
}

export interface Service {
  id: number;
  name: string;
  description: string;
  estimated_duration_minutes: number;
  price: number;
  icon_url: string | null;
  is_active: boolean;
  display_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface Address {
  id: number;
  user_id: number;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string | null;
  postal_code: string | null;
  country: string;
  latitude: number;
  longitude: number;
  landmark: string | null;
  special_instructions: string | null;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Booking {
  id: number;
  booking_number: string;
  customer_id: number;
  cleaner_id: number | null;
  booking_type: BookingType;
  status: BookingStatus;
  scheduled_date: Date | null;
  scheduled_time: string | null;
  address_id: number;
  address_snapshot: any;
  special_instructions: string | null;
  total_amount: number;
  platform_fee: number;
  cleaner_earnings: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  stripe_payment_intent_id: string | null;
  assigned_at: Date | null;
  accepted_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  cancelled_by: 'customer' | 'cleaner' | 'admin' | null;
  created_at: Date;
  updated_at: Date;
}

export interface BookingService {
  id: number;
  booking_id: number;
  service_id: number;
  service_name: string;
  service_price: number;
  estimated_duration_minutes: number;
  is_completed: boolean;
  created_at: Date;
}

export interface Rating {
  id: number;
  booking_id: number;
  rater_id: number;
  rated_id: number;
  rating: number;
  review_text: string | null;
  timeliness_rating: number | null;
  quality_rating: number | null;
  professionalism_rating: number | null;
  created_at: Date;
}

export interface Transaction {
  id: number;
  booking_id: number | null;
  user_id: number;
  transaction_type: TransactionType;
  amount: number;
  currency: string;
  payment_method: PaymentMethod | 'bank_transfer';
  status: TransactionStatus;
  stripe_transaction_id: string | null;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface JWTPayload {
  userId: number;
  phone: string;
  userType: UserType;
  iat?: number;
  exp?: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
}
