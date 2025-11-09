-- Advanced Enterprise Features Schema
-- Created for 10 advanced enterprise services

-- ============================================
-- 1. ROUTE OPTIMIZATION
-- ============================================

CREATE TABLE IF NOT EXISTS optimized_routes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  cleaner_id INT NOT NULL,
  booking_ids JSON NOT NULL COMMENT 'Array of booking IDs in optimized order',
  stops JSON NOT NULL COMMENT 'Array of stop objects with locations and order',
  total_distance DECIMAL(10, 2) NOT NULL COMMENT 'Total distance in km',
  total_duration INT NOT NULL COMMENT 'Total estimated duration in minutes',
  efficiency_score DECIMAL(5, 2) NOT NULL COMMENT 'Route efficiency score (0-100)',
  start_location JSON COMMENT 'Starting point {latitude, longitude}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cleaner_date (cleaner_id, created_at),
  FOREIGN KEY (cleaner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS route_deviations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  route_id INT NOT NULL,
  booking_id INT NOT NULL,
  planned_arrival TIMESTAMP NOT NULL,
  actual_arrival TIMESTAMP,
  deviation_minutes INT COMMENT 'Difference in minutes',
  reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_route (route_id),
  INDEX idx_booking (booking_id),
  FOREIGN KEY (route_id) REFERENCES optimized_routes(id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 2. REPEAT CUSTOMER MAPPING
-- ============================================

CREATE TABLE IF NOT EXISTS customer_profiles (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL UNIQUE,
  total_bookings INT DEFAULT 0,
  completed_bookings INT DEFAULT 0,
  lifetime_value DECIMAL(10, 2) DEFAULT 0.00,
  average_booking_value DECIMAL(10, 2) DEFAULT 0.00,
  frequency_days DECIMAL(10, 2) COMMENT 'Average days between bookings',
  repeat_rate DECIMAL(5, 2) COMMENT 'Percentage of repeat bookings',
  churn_risk DECIMAL(5, 2) COMMENT 'Churn risk score 0-100',
  segment ENUM('vip', 'loyal', 'regular', 'occasional', 'at_risk', 'churned') DEFAULT 'regular',
  preferred_services JSON COMMENT 'Array of preferred service types',
  preferred_cleaners JSON COMMENT 'Array of preferred cleaner IDs',
  preferred_time_slots JSON COMMENT 'Array of preferred time slots',
  last_booking_date TIMESTAMP,
  days_since_last_booking INT,
  next_expected_booking TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customer (customer_id),
  INDEX idx_segment (segment),
  INDEX idx_churn_risk (churn_risk),
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_reminders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  reminder_type ENUM('frequency', 'preferred_cleaner', 'seasonal', 're_engagement') NOT NULL,
  message TEXT NOT NULL,
  scheduled_for TIMESTAMP NOT NULL,
  sent_at TIMESTAMP,
  status ENUM('pending', 'sent', 'failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customer (customer_id),
  INDEX idx_scheduled (scheduled_for, status),
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 3. SUBSCRIPTION AUTO-RENEW
-- ============================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  plan_name VARCHAR(100) NOT NULL,
  billing_cycle ENUM('weekly', 'monthly', 'quarterly', 'yearly') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('active', 'paused', 'cancelled', 'expired') DEFAULT 'active',
  auto_renew BOOLEAN DEFAULT TRUE,
  payment_method_id INT,
  bookings_included INT COMMENT 'Number of bookings included per cycle',
  bookings_used INT DEFAULT 0,
  start_date DATE NOT NULL,
  next_billing_date DATE NOT NULL,
  last_renewal_date DATE,
  payment_retry_count INT DEFAULT 0,
  paused_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  cancellation_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customer (customer_id),
  INDEX idx_status (status),
  INDEX idx_next_billing (next_billing_date, status, auto_renew),
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_renewals (
  id INT PRIMARY KEY AUTO_INCREMENT,
  subscription_id INT NOT NULL,
  renewal_date DATE NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  payment_status ENUM('success', 'failed', 'pending') NOT NULL,
  payment_method_id INT,
  transaction_id VARCHAR(100),
  failure_reason TEXT,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_subscription (subscription_id),
  INDEX idx_date (renewal_date),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_usage (
  id INT PRIMARY KEY AUTO_INCREMENT,
  subscription_id INT NOT NULL,
  booking_id INT NOT NULL,
  used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_subscription (subscription_id),
  INDEX idx_booking (booking_id),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 4. ABANDONED BOOKING RECOVERY
-- ============================================

CREATE TABLE IF NOT EXISTS abandoned_bookings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  session_id VARCHAR(100),
  abandonment_stage ENUM('service_selection', 'address_entry', 'datetime_selection', 'payment') NOT NULL,
  service_type VARCHAR(100),
  address TEXT,
  scheduled_date TIMESTAMP,
  estimated_value DECIMAL(10, 2),
  cart_data JSON COMMENT 'Captured form data',
  abandoned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  recovered_at TIMESTAMP,
  recovered_booking_id INT,
  recovery_attempts INT DEFAULT 0,
  last_recovery_attempt TIMESTAMP,
  status ENUM('abandoned', 'recovered', 'expired') DEFAULT 'abandoned',
  INDEX idx_customer (customer_id),
  INDEX idx_status (status, abandoned_at),
  INDEX idx_recovery (recovery_attempts, abandoned_at),
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (recovered_booking_id) REFERENCES bookings(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recovery_attempts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  abandoned_booking_id INT NOT NULL,
  attempt_number INT NOT NULL,
  channel ENUM('email', 'sms', 'push') NOT NULL,
  message TEXT NOT NULL,
  incentive_offered VARCHAR(255),
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  INDEX idx_abandoned (abandoned_booking_id),
  INDEX idx_sent (sent_at),
  FOREIGN KEY (abandoned_booking_id) REFERENCES abandoned_bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 5. PROMO BURN RATE TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS promo_burn_tracking (
  id INT PRIMARY KEY AUTO_INCREMENT,
  coupon_code VARCHAR(50) NOT NULL,
  tracking_date DATE NOT NULL,
  total_budget DECIMAL(10, 2) NOT NULL,
  budget_used DECIMAL(10, 2) NOT NULL,
  budget_remaining DECIMAL(10, 2) NOT NULL,
  daily_burn_rate DECIMAL(10, 2) NOT NULL,
  uses_count INT NOT NULL,
  estimated_days_remaining INT,
  projected_total_usage DECIMAL(10, 2),
  efficiency_score DECIMAL(10, 4) COMMENT 'Revenue / Discount given',
  is_at_risk BOOLEAN DEFAULT FALSE,
  risk_reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_coupon_date (coupon_code, tracking_date),
  INDEX idx_at_risk (is_at_risk),
  UNIQUE KEY unique_coupon_date (coupon_code, tracking_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS promo_budget_adjustments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  coupon_code VARCHAR(50) NOT NULL,
  old_budget DECIMAL(10, 2) NOT NULL,
  new_budget DECIMAL(10, 2) NOT NULL,
  adjustment_amount DECIMAL(10, 2) NOT NULL,
  reason TEXT NOT NULL,
  adjusted_by INT,
  adjusted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_coupon (coupon_code),
  FOREIGN KEY (adjusted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 6. CLEANER SHIFT SWAP
-- ============================================

CREATE TABLE IF NOT EXISTS shift_swap_requests (
  id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT NOT NULL,
  requester_cleaner_id INT NOT NULL,
  acceptor_cleaner_id INT,
  reason TEXT,
  status ENUM('pending', 'accepted', 'declined', 'cancelled', 'expired') DEFAULT 'pending',
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP,
  expires_at TIMESTAMP,
  INDEX idx_booking (booking_id),
  INDEX idx_requester (requester_cleaner_id),
  INDEX idx_acceptor (acceptor_cleaner_id),
  INDEX idx_status (status, requested_at),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (requester_cleaner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (acceptor_cleaner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shift_swap_notifications (
  id INT PRIMARY KEY AUTO_INCREMENT,
  swap_request_id INT NOT NULL,
  cleaner_id INT NOT NULL,
  notification_type ENUM('new_request', 'accepted', 'declined', 'expired') NOT NULL,
  message TEXT NOT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP,
  INDEX idx_swap (swap_request_id),
  INDEX idx_cleaner (cleaner_id, read_at),
  FOREIGN KEY (swap_request_id) REFERENCES shift_swap_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (cleaner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 7. EMERGENCY ESCALATION LADDER
-- ============================================

CREATE TABLE IF NOT EXISTS escalations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT,
  customer_id INT NOT NULL,
  issue_type VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  severity ENUM('low', 'medium', 'high', 'critical') NOT NULL,
  current_level INT DEFAULT 1,
  assigned_to INT,
  status ENUM('open', 'in_progress', 'resolved', 'closed') DEFAULT 'open',
  escalate_at TIMESTAMP,
  resolved_at TIMESTAMP,
  resolution_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_booking (booking_id),
  INDEX idx_customer (customer_id),
  INDEX idx_assigned (assigned_to),
  INDEX idx_status (status, current_level),
  INDEX idx_escalate (escalate_at, status),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS escalation_history (
  id INT PRIMARY KEY AUTO_INCREMENT,
  escalation_id INT NOT NULL,
  from_level INT NOT NULL,
  to_level INT NOT NULL,
  from_agent_id INT,
  to_agent_id INT,
  escalation_reason VARCHAR(255),
  notes TEXT,
  escalated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_escalation (escalation_id),
  INDEX idx_to_agent (to_agent_id),
  FOREIGN KEY (escalation_id) REFERENCES escalations(id) ON DELETE CASCADE,
  FOREIGN KEY (from_agent_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (to_agent_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 8. SLA AUTO-COMPENSATION
-- ============================================

CREATE TABLE IF NOT EXISTS sla_violations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT NOT NULL,
  violation_type ENUM('late_arrival', 'no_show', 'poor_quality', 'incomplete_service', 'equipment_failure') NOT NULL,
  severity INT NOT NULL COMMENT 'Minutes late or quality score difference',
  detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  verified BOOLEAN DEFAULT FALSE,
  verified_by INT,
  verified_at TIMESTAMP,
  INDEX idx_booking (booking_id),
  INDEX idx_type (violation_type),
  INDEX idx_detected (detected_at),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS compensations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT NOT NULL,
  customer_id INT NOT NULL,
  violation_id INT,
  compensation_type ENUM('refund', 'credit', 'discount_coupon', 'free_service') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  reason TEXT NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'processed') DEFAULT 'pending',
  auto_approved BOOLEAN DEFAULT FALSE,
  approved_by INT,
  approved_at TIMESTAMP,
  processed_at TIMESTAMP,
  coupon_code VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_booking (booking_id),
  INDEX idx_customer (customer_id),
  INDEX idx_status (status),
  INDEX idx_violation (violation_id),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (violation_id) REFERENCES sla_violations(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_credits (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  source ENUM('compensation', 'refund', 'promotion', 'referral') NOT NULL,
  source_id INT COMMENT 'ID from source table',
  used_amount DECIMAL(10, 2) DEFAULT 0.00,
  remaining_amount DECIMAL(10, 2) NOT NULL,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customer (customer_id),
  INDEX idx_expires (expires_at),
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS free_service_grants (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  compensation_id INT NOT NULL,
  service_type VARCHAR(100),
  max_value DECIMAL(10, 2),
  used BOOLEAN DEFAULT FALSE,
  used_booking_id INT,
  used_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customer (customer_id, used),
  INDEX idx_expires (expires_at),
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (compensation_id) REFERENCES compensations(id) ON DELETE CASCADE,
  FOREIGN KEY (used_booking_id) REFERENCES bookings(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 9. TOXIC CUSTOMER FLAGGING
-- ============================================

CREATE TABLE IF NOT EXISTS toxic_customer_flags (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL UNIQUE,
  risk_score INT NOT NULL COMMENT 'Score 0-100',
  status ENUM('watch', 'warned', 'restricted', 'blocked') NOT NULL,
  flags JSON NOT NULL COMMENT 'Array of flag reasons',
  behavioral_data JSON COMMENT 'Detailed behavioral metrics',
  protection_recommendations JSON COMMENT 'Array of protection measures',
  flagged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_incident_at TIMESTAMP,
  review_scheduled_at TIMESTAMP,
  reviewed_by INT,
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  INDEX idx_customer (customer_id),
  INDEX idx_status (status),
  INDEX idx_risk_score (risk_score),
  INDEX idx_review (review_scheduled_at),
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cleaner_reports (
  id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT NOT NULL,
  cleaner_id INT NOT NULL,
  customer_id INT NOT NULL,
  report_type ENUM('abuse', 'harassment', 'unsafe_environment', 'payment_dispute', 'unreasonable_demands') NOT NULL,
  description TEXT NOT NULL,
  severity ENUM('low', 'medium', 'high', 'critical') NOT NULL,
  action_taken VARCHAR(255),
  reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_by INT,
  reviewed_at TIMESTAMP,
  INDEX idx_booking (booking_id),
  INDEX idx_cleaner (cleaner_id),
  INDEX idx_customer (customer_id),
  INDEX idx_reported (reported_at),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (cleaner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 10. CHURN PREDICTION
-- ============================================

CREATE TABLE IF NOT EXISTS churn_predictions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL UNIQUE,
  churn_probability DECIMAL(5, 2) NOT NULL COMMENT 'Probability 0-100',
  churn_risk ENUM('low', 'medium', 'high', 'critical') NOT NULL,
  predicted_churn_date DATE,
  factors JSON NOT NULL COMMENT 'Array of factor objects with impact scores',
  retention_actions JSON NOT NULL COMMENT 'Array of recommended actions',
  confidence_score INT NOT NULL COMMENT 'Confidence 0-100',
  last_retention_action VARCHAR(255),
  last_retention_action_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customer (customer_id),
  INDEX idx_risk (churn_risk),
  INDEX idx_probability (churn_probability),
  INDEX idx_predicted_date (predicted_churn_date),
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS retention_actions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  action VARCHAR(255) NOT NULL,
  action_type ENUM('email', 'call', 'discount', 'gift', 'upgrade', 'personal_outreach') NOT NULL,
  executed_by INT NOT NULL,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  result ENUM('pending', 'successful', 'failed', 'no_response') DEFAULT 'pending',
  result_notes TEXT,
  resulted_at TIMESTAMP,
  INDEX idx_customer (customer_id),
  INDEX idx_executed (executed_at),
  INDEX idx_result (result),
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (executed_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- VIEWS FOR REPORTING
-- ============================================

-- Customer 360 View
CREATE OR REPLACE VIEW customer_360_view AS
SELECT
  u.id as customer_id,
  u.name,
  u.email,
  u.phone,
  cp.segment,
  cp.lifetime_value,
  cp.churn_risk as profile_churn_risk,
  chp.churn_probability,
  chp.churn_risk as predicted_churn_risk,
  tcf.risk_score as toxicity_score,
  tcf.status as toxicity_status,
  s.id as subscription_id,
  s.status as subscription_status,
  s.next_billing_date,
  COUNT(DISTINCT ab.id) as abandoned_bookings_count,
  COUNT(DISTINCT e.id) as open_escalations
FROM users u
LEFT JOIN customer_profiles cp ON cp.customer_id = u.id
LEFT JOIN churn_predictions chp ON chp.customer_id = u.id
LEFT JOIN toxic_customer_flags tcf ON tcf.customer_id = u.id
LEFT JOIN subscriptions s ON s.customer_id = u.id AND s.status = 'active'
LEFT JOIN abandoned_bookings ab ON ab.customer_id = u.id AND ab.status = 'abandoned'
LEFT JOIN escalations e ON e.customer_id = u.id AND e.status IN ('open', 'in_progress')
WHERE u.role = 'customer'
GROUP BY u.id, u.name, u.email, u.phone, cp.segment, cp.lifetime_value,
         cp.churn_risk, chp.churn_probability, chp.churn_risk,
         tcf.risk_score, tcf.status, s.id, s.status, s.next_billing_date;

-- Cleaner Performance View
CREATE OR REPLACE VIEW cleaner_performance_view AS
SELECT
  u.id as cleaner_id,
  u.name,
  COUNT(DISTINCT b.id) as total_bookings,
  COUNT(DISTINCT orr.id) as optimized_routes,
  AVG(orr.efficiency_score) as avg_route_efficiency,
  COUNT(DISTINCT ssr.id) as swap_requests_made,
  COUNT(DISTINCT cr.id) as customer_reports_received,
  AVG(r.quality_rating) as avg_rating
FROM users u
LEFT JOIN bookings b ON b.cleaner_id = u.id AND b.status = 'completed'
LEFT JOIN optimized_routes orr ON orr.cleaner_id = u.id
LEFT JOIN shift_swap_requests ssr ON ssr.requester_cleaner_id = u.id
LEFT JOIN cleaner_reports cr ON cr.cleaner_id = u.id
LEFT JOIN ratings r ON r.ratee_id = u.id
WHERE u.role = 'cleaner'
GROUP BY u.id, u.name;
