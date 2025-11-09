-- Primo Cleaning Platform - Enhanced Database Schema
-- Includes: Location tracking, Attendance, Ratings, Chat, Notifications, Subscriptions, etc.

-- ============================================
-- LOCATION TRACKING SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS cleaner_locations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cleaner_id INT NOT NULL,
    booking_id INT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    accuracy DECIMAL(6, 2) NULL COMMENT 'Accuracy in meters',
    speed DECIMAL(6, 2) NULL COMMENT 'Speed in m/s',
    heading DECIMAL(5, 2) NULL COMMENT 'Direction in degrees',
    altitude DECIMAL(8, 2) NULL COMMENT 'Altitude in meters',
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cleaner_id (cleaner_id),
    INDEX idx_booking_id (booking_id),
    INDEX idx_recorded_at (recorded_at),
    FOREIGN KEY (cleaner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- ATTENDANCE SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS cleaner_attendance (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cleaner_id INT NOT NULL,
    booking_id INT NOT NULL,
    check_in_time TIMESTAMP NULL,
    check_in_latitude DECIMAL(10, 8) NULL,
    check_in_longitude DECIMAL(11, 8) NULL,
    check_in_photo VARCHAR(500) NULL,
    check_out_time TIMESTAMP NULL,
    check_out_latitude DECIMAL(10, 8) NULL,
    check_out_longitude DECIMAL(11, 8) NULL,
    check_out_photo VARCHAR(500) NULL,
    total_duration INT NULL COMMENT 'Duration in minutes',
    distance_from_location DECIMAL(8, 2) NULL COMMENT 'Distance in meters',
    status ENUM('checked_in', 'checked_out', 'verified', 'disputed') DEFAULT 'checked_in',
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cleaner_id (cleaner_id),
    INDEX idx_booking_id (booking_id),
    INDEX idx_check_in_time (check_in_time),
    FOREIGN KEY (cleaner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- RATINGS & REVIEWS SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS ratings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL,
    customer_id INT NOT NULL,
    cleaner_id INT NOT NULL,
    rating INT NOT NULL COMMENT '1-5 stars',
    review TEXT NULL,
    service_quality INT NULL COMMENT '1-5 rating',
    punctuality INT NULL COMMENT '1-5 rating',
    professionalism INT NULL COMMENT '1-5 rating',
    value_for_money INT NULL COMMENT '1-5 rating',
    would_recommend BOOLEAN DEFAULT TRUE,
    photos JSON NULL COMMENT 'Array of photo URLs',
    is_verified BOOLEAN DEFAULT FALSE,
    is_featured BOOLEAN DEFAULT FALSE,
    response TEXT NULL COMMENT 'Cleaner/Admin response',
    response_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_booking_id (booking_id),
    INDEX idx_customer_id (customer_id),
    INDEX idx_cleaner_id (cleaner_id),
    INDEX idx_rating (rating),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (cleaner_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_booking_rating (booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- CUSTOMER SUPPORT CHAT SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS chat_conversations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id INT NOT NULL,
    booking_id INT NULL,
    support_agent_id INT NULL,
    status ENUM('open', 'assigned', 'resolved', 'closed') DEFAULT 'open',
    priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
    category VARCHAR(100) NULL COMMENT 'Issue category',
    subject VARCHAR(255) NULL,
    last_message_at TIMESTAMP NULL,
    resolved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_customer_id (customer_id),
    INDEX idx_booking_id (booking_id),
    INDEX idx_support_agent_id (support_agent_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
    FOREIGN KEY (support_agent_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    conversation_id INT NOT NULL,
    sender_id INT NOT NULL,
    message TEXT NOT NULL,
    message_type ENUM('text', 'image', 'file', 'system') DEFAULT 'text',
    attachment_url VARCHAR(500) NULL,
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_conversation_id (conversation_id),
    INDEX idx_sender_id (sender_id),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- NOTIFICATION SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    type VARCHAR(100) NOT NULL COMMENT 'booking_created, job_assigned, payment_received, etc',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSON NULL COMMENT 'Additional data payload',
    action_url VARCHAR(500) NULL,
    priority ENUM('low', 'normal', 'high') DEFAULT 'normal',
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP NULL,
    sent_via JSON NULL COMMENT 'push, sms, email flags',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_type (type),
    INDEX idx_is_read (is_read),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS push_tokens (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    token VARCHAR(500) NOT NULL,
    device_type ENUM('ios', 'android', 'web') NOT NULL,
    device_id VARCHAR(255) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_token (token),
    INDEX idx_is_active (is_active),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_device (user_id, device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SUBSCRIPTION PLANS
-- ============================================

CREATE TABLE IF NOT EXISTS subscription_plans (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    price DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'INR',
    billing_period ENUM('monthly', 'quarterly', 'yearly') NOT NULL,
    discount_percentage DECIMAL(5, 2) DEFAULT 0.00,
    max_bookings INT NULL COMMENT 'Max bookings per period, NULL for unlimited',
    priority_support BOOLEAN DEFAULT FALSE,
    free_cancellations INT DEFAULT 0,
    features JSON NULL COMMENT 'Array of features',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_subscriptions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id INT NOT NULL,
    plan_id INT NOT NULL,
    status ENUM('active', 'cancelled', 'expired', 'paused') DEFAULT 'active',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    auto_renew BOOLEAN DEFAULT TRUE,
    bookings_used INT DEFAULT 0,
    payment_method VARCHAR(100) NULL,
    stripe_subscription_id VARCHAR(255) NULL,
    cancelled_at TIMESTAMP NULL,
    cancellation_reason TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_customer_id (customer_id),
    INDEX idx_plan_id (plan_id),
    INDEX idx_status (status),
    INDEX idx_end_date (end_date),
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- CANCELLATION & REFUNDS
-- ============================================

CREATE TABLE IF NOT EXISTS cancellations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL,
    cancelled_by INT NOT NULL COMMENT 'User ID who cancelled',
    cancellation_type ENUM('customer', 'cleaner', 'admin', 'system') NOT NULL,
    reason VARCHAR(255) NOT NULL,
    detailed_reason TEXT NULL,
    cancelled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    refund_amount DECIMAL(10, 2) DEFAULT 0.00,
    refund_status ENUM('none', 'pending', 'processed', 'failed') DEFAULT 'none',
    refund_processed_at TIMESTAMP NULL,
    penalty_amount DECIMAL(10, 2) DEFAULT 0.00,
    penalty_reason TEXT NULL,
    INDEX idx_booking_id (booking_id),
    INDEX idx_cancelled_by (cancelled_by),
    INDEX idx_refund_status (refund_status),
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- CLEANER VERIFICATION
-- ============================================

CREATE TABLE IF NOT EXISTS cleaner_documents (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cleaner_id INT NOT NULL,
    document_type ENUM('id_proof', 'address_proof', 'police_clearance', 'work_permit', 'insurance', 'other') NOT NULL,
    document_number VARCHAR(100) NULL,
    document_url VARCHAR(500) NOT NULL,
    verified_status ENUM('pending', 'approved', 'rejected', 'expired') DEFAULT 'pending',
    verified_by INT NULL COMMENT 'Admin user ID',
    verified_at TIMESTAMP NULL,
    rejection_reason TEXT NULL,
    expiry_date DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cleaner_id (cleaner_id),
    INDEX idx_document_type (document_type),
    INDEX idx_verified_status (verified_status),
    FOREIGN KEY (cleaner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cleaner_background_checks (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cleaner_id INT NOT NULL,
    check_type VARCHAR(100) NOT NULL,
    provider VARCHAR(100) NULL COMMENT 'Background check provider',
    status ENUM('pending', 'in_progress', 'passed', 'failed', 'expired') NOT NULL,
    reference_number VARCHAR(100) NULL,
    report_url VARCHAR(500) NULL,
    checked_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cleaner_id (cleaner_id),
    INDEX idx_status (status),
    FOREIGN KEY (cleaner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SCHEDULING SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS cleaner_availability (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cleaner_id INT NOT NULL,
    day_of_week INT NOT NULL COMMENT '0=Sunday, 6=Saturday',
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cleaner_id (cleaner_id),
    INDEX idx_day_of_week (day_of_week),
    FOREIGN KEY (cleaner_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_cleaner_day_time (cleaner_id, day_of_week, start_time, end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cleaner_time_off (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cleaner_id INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason VARCHAR(255) NULL,
    is_approved BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cleaner_id (cleaner_id),
    INDEX idx_dates (start_date, end_date),
    FOREIGN KEY (cleaner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- PAYMENT SETTLEMENTS
-- ============================================

CREATE TABLE IF NOT EXISTS cleaner_earnings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cleaner_id INT NOT NULL,
    booking_id INT NOT NULL,
    base_amount DECIMAL(10, 2) NOT NULL,
    bonus_amount DECIMAL(10, 2) DEFAULT 0.00,
    tip_amount DECIMAL(10, 2) DEFAULT 0.00,
    penalty_amount DECIMAL(10, 2) DEFAULT 0.00,
    platform_fee DECIMAL(10, 2) NOT NULL,
    final_amount DECIMAL(10, 2) NOT NULL,
    status ENUM('pending', 'approved', 'paid', 'disputed') DEFAULT 'pending',
    payment_method VARCHAR(100) NULL,
    payment_reference VARCHAR(255) NULL,
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cleaner_id (cleaner_id),
    INDEX idx_booking_id (booking_id),
    INDEX idx_status (status),
    FOREIGN KEY (cleaner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settlement_batches (
    id INT PRIMARY KEY AUTO_INCREMENT,
    batch_number VARCHAR(100) NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    total_cleaners INT NOT NULL,
    status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
    payment_method VARCHAR(100) NULL,
    processed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_batch_number (batch_number),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SERVICE CATALOG ENHANCEMENTS
-- ============================================

ALTER TABLE services ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS min_duration INT DEFAULT 30 COMMENT 'Minimum duration in minutes';
ALTER TABLE services ADD COLUMN IF NOT EXISTS max_duration INT DEFAULT 480 COMMENT 'Maximum duration in minutes';
ALTER TABLE services ADD COLUMN IF NOT EXISTS image_urls JSON NULL COMMENT 'Array of image URLs';
ALTER TABLE services ADD COLUMN IF NOT EXISTS requirements JSON NULL COMMENT 'Special requirements or instructions';

-- ============================================
-- BOOKING STATUS ENHANCEMENTS
-- ============================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS estimated_arrival TIME NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS actual_start_time TIMESTAMP NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS actual_end_time TIMESTAMP NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_present BOOLEAN DEFAULT TRUE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS access_instructions TEXT NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completion_photos JSON NULL COMMENT 'Array of photo URLs';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completion_notes TEXT NULL;

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX idx_bookings_status_date ON bookings(status, scheduled_date);
CREATE INDEX idx_users_type_status ON users(user_type, status);
CREATE INDEX idx_addresses_user_active ON addresses(user_id, is_active);

-- ============================================
-- INITIAL DATA FOR SUBSCRIPTION PLANS
-- ============================================

INSERT INTO subscription_plans (name, description, price, billing_period, discount_percentage, max_bookings, priority_support, free_cancellations, features)
VALUES
('Basic', 'Perfect for occasional cleaning needs', 0.00, 'monthly', 0.00, NULL, FALSE, 1, '["Standard support", "Pay per booking", "1 free cancellation per month"]'),
('Premium', 'Best value for regular cleaning', 999.00, 'monthly', 10.00, NULL, TRUE, 3, ["10% discount on all bookings", "Priority support", "3 free cancellations per month", "Dedicated cleaner preference"]'),
('Platinum', 'Ultimate cleaning experience', 2499.00, 'monthly', 20.00, NULL, TRUE, 5, '["20% discount on all bookings", "24/7 priority support", "5 free cancellations per month", "Dedicated cleaner guaranteed", "Same-day booking available"]')
ON DUPLICATE KEY UPDATE name=name;
