-- Primo Platform - Enterprise Features Schema
-- 24 Advanced Features for Production Scale

-- ============================================
-- SURGE PRICING ENGINE
-- ============================================

CREATE TABLE IF NOT EXISTS surge_pricing_rules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    city_id INT NULL,
    service_id INT NULL COMMENT 'NULL = all services',
    day_of_week INT NULL COMMENT '0-6, NULL = all days',
    start_time TIME NULL,
    end_time TIME NULL,
    surge_multiplier DECIMAL(4, 2) NOT NULL DEFAULT 1.00 COMMENT '1.00 = no surge, 1.5 = 50% increase',
    min_multiplier DECIMAL(4, 2) DEFAULT 1.00,
    max_multiplier DECIMAL(4, 2) DEFAULT 3.00,
    demand_threshold INT NULL COMMENT 'Active bookings to trigger surge',
    is_active BOOLEAN DEFAULT TRUE,
    priority INT DEFAULT 0 COMMENT 'Higher priority rules override lower',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_city_service (city_id, service_id),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS surge_pricing_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL,
    base_price DECIMAL(10, 2) NOT NULL,
    surge_multiplier DECIMAL(4, 2) NOT NULL,
    final_price DECIMAL(10, 2) NOT NULL,
    rule_id INT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_booking (booking_id),
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- SLA & PENALTIES
-- ============================================

CREATE TABLE IF NOT EXISTS sla_policies (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    service_type VARCHAR(50) NULL,
    max_response_time INT NOT NULL COMMENT 'Minutes to respond',
    max_arrival_delay INT NOT NULL COMMENT 'Minutes late tolerance',
    penalty_per_minute DECIMAL(6, 2) DEFAULT 0.00,
    max_penalty_amount DECIMAL(10, 2) DEFAULT 0.00,
    min_quality_rating DECIMAL(3, 2) DEFAULT 3.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sla_violations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL,
    cleaner_id INT NOT NULL,
    policy_id INT NOT NULL,
    violation_type ENUM('late_response', 'late_arrival', 'no_show', 'poor_quality', 'incomplete') NOT NULL,
    severity ENUM('minor', 'major', 'critical') DEFAULT 'minor',
    penalty_amount DECIMAL(10, 2) DEFAULT 0.00,
    actual_value DECIMAL(10, 2) NULL COMMENT 'Actual time/rating',
    expected_value DECIMAL(10, 2) NULL,
    is_waived BOOLEAN DEFAULT FALSE,
    waived_reason TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_booking (booking_id),
    INDEX idx_cleaner (cleaner_id),
    FOREIGN KEY (booking_id) REFERENCES bookings(id),
    FOREIGN KEY (cleaner_id) REFERENCES users(id),
    FOREIGN KEY (policy_id) REFERENCES sla_policies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- GEO-FENCING & ZONES
-- ============================================

CREATE TABLE IF NOT EXISTS geo_zones (
    id INT PRIMARY KEY AUTO_INCREMENT,
    city_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    zone_type ENUM('service_area', 'restricted', 'premium', 'high_demand') DEFAULT 'service_area',
    polygon_coordinates JSON NOT NULL COMMENT 'GeoJSON polygon coordinates',
    center_latitude DECIMAL(10, 8) NOT NULL,
    center_longitude DECIMAL(11, 8) NOT NULL,
    radius_meters INT NULL COMMENT 'For circular zones',
    is_active BOOLEAN DEFAULT TRUE,
    priority INT DEFAULT 0,
    metadata JSON NULL COMMENT 'Additional zone properties',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_city (city_id),
    INDEX idx_type (zone_type),
    FOREIGN KEY (city_id) REFERENCES cities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS zone_pricing (
    id INT PRIMARY KEY AUTO_INCREMENT,
    zone_id INT NOT NULL,
    service_id INT NULL,
    base_price_adjustment DECIMAL(10, 2) DEFAULT 0.00 COMMENT 'Fixed adjustment',
    price_multiplier DECIMAL(4, 2) DEFAULT 1.00 COMMENT 'Percentage adjustment',
    min_fare DECIMAL(10, 2) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (zone_id) REFERENCES geo_zones(id),
    FOREIGN KEY (service_id) REFERENCES services(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- MULTI-CITY CONFIGURATION
-- ============================================

CREATE TABLE IF NOT EXISTS cities (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    country VARCHAR(100) DEFAULT 'India',
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    timezone VARCHAR(50) DEFAULT 'Asia/Kolkata',
    currency VARCHAR(10) DEFAULT 'INR',
    is_active BOOLEAN DEFAULT TRUE,
    launch_date DATE NULL,
    default_language VARCHAR(10) DEFAULT 'en',
    supported_languages JSON NULL COMMENT '["en", "hi", "mr"]',
    operational_hours JSON NULL COMMENT 'Start/end times',
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_active (is_active),
    INDEX idx_country_state (country, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS city_config (
    id INT PRIMARY KEY AUTO_INCREMENT,
    city_id INT NOT NULL,
    config_key VARCHAR(100) NOT NULL,
    config_value JSON NOT NULL,
    description TEXT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (city_id) REFERENCES cities(id),
    UNIQUE KEY unique_city_config (city_id, config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- COUPONS & REFERRALS
-- ============================================

CREATE TABLE IF NOT EXISTS coupons (
    id INT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    description TEXT NULL,
    discount_type ENUM('percentage', 'fixed', 'free_service') NOT NULL,
    discount_value DECIMAL(10, 2) NOT NULL,
    max_discount DECIMAL(10, 2) NULL COMMENT 'Cap for percentage discounts',
    min_order_value DECIMAL(10, 2) DEFAULT 0.00,
    applicable_services JSON NULL COMMENT 'Service IDs array, NULL = all',
    applicable_cities JSON NULL COMMENT 'City IDs array, NULL = all',
    usage_limit INT NULL COMMENT 'Total uses allowed',
    usage_per_user INT DEFAULT 1,
    valid_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    valid_until TIMESTAMP NULL,
    is_active BOOLEAN DEFAULT TRUE,
    coupon_type ENUM('public', 'private', 'referral', 'first_time') DEFAULT 'public',
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_code (code),
    INDEX idx_active_dates (is_active, valid_from, valid_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS coupon_usage (
    id INT PRIMARY KEY AUTO_INCREMENT,
    coupon_id INT NOT NULL,
    user_id INT NOT NULL,
    booking_id INT NOT NULL,
    discount_amount DECIMAL(10, 2) NOT NULL,
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_coupon (coupon_id),
    INDEX idx_user (user_id),
    FOREIGN KEY (coupon_id) REFERENCES coupons(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (booking_id) REFERENCES bookings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS referrals (
    id INT PRIMARY KEY AUTO_INCREMENT,
    referrer_id INT NOT NULL COMMENT 'User who referred',
    referee_id INT NOT NULL COMMENT 'User who was referred',
    referral_code VARCHAR(50) NOT NULL,
    status ENUM('pending', 'completed', 'expired', 'invalid') DEFAULT 'pending',
    referrer_reward DECIMAL(10, 2) DEFAULT 0.00,
    referee_reward DECIMAL(10, 2) DEFAULT 0.00,
    referrer_reward_type ENUM('cash', 'credits', 'discount') DEFAULT 'credits',
    referee_reward_type ENUM('cash', 'credits', 'discount') DEFAULT 'discount',
    completed_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_referrer (referrer_id),
    INDEX idx_referee (referee_id),
    INDEX idx_code (referral_code),
    FOREIGN KEY (referrer_id) REFERENCES users(id),
    FOREIGN KEY (referee_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- GST INVOICING
-- ============================================

CREATE TABLE IF NOT EXISTS invoices (
    id INT PRIMARY KEY AUTO_INCREMENT,
    invoice_number VARCHAR(50) NOT NULL UNIQUE,
    booking_id INT NOT NULL,
    customer_id INT NOT NULL,
    invoice_date DATE NOT NULL,
    due_date DATE NULL,
    subtotal DECIMAL(10, 2) NOT NULL,
    cgst_rate DECIMAL(5, 2) DEFAULT 0.00,
    sgst_rate DECIMAL(5, 2) DEFAULT 0.00,
    igst_rate DECIMAL(5, 2) DEFAULT 0.00,
    cgst_amount DECIMAL(10, 2) DEFAULT 0.00,
    sgst_amount DECIMAL(10, 2) DEFAULT 0.00,
    igst_amount DECIMAL(10, 2) DEFAULT 0.00,
    total_tax DECIMAL(10, 2) DEFAULT 0.00,
    discount_amount DECIMAL(10, 2) DEFAULT 0.00,
    total_amount DECIMAL(10, 2) NOT NULL,
    status ENUM('draft', 'sent', 'paid', 'cancelled') DEFAULT 'draft',
    payment_status ENUM('unpaid', 'partial', 'paid') DEFAULT 'unpaid',
    customer_gstin VARCHAR(15) NULL,
    billing_address JSON NOT NULL,
    invoice_url VARCHAR(500) NULL COMMENT 'PDF URL',
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_invoice_number (invoice_number),
    INDEX idx_booking (booking_id),
    INDEX idx_customer (customer_id),
    INDEX idx_date (invoice_date),
    FOREIGN KEY (booking_id) REFERENCES bookings(id),
    FOREIGN KEY (customer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- KYC VERIFICATION
-- ============================================

CREATE TABLE IF NOT EXISTS kyc_verifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    verification_type ENUM('aadhaar', 'pan', 'driving_license', 'passport', 'voter_id') NOT NULL,
    document_number VARCHAR(100) NOT NULL,
    document_front_url VARCHAR(500) NOT NULL,
    document_back_url VARCHAR(500) NULL,
    selfie_url VARCHAR(500) NULL,
    verification_status ENUM('pending', 'in_progress', 'verified', 'rejected', 'expired') DEFAULT 'pending',
    verification_method ENUM('manual', 'digilocker', 'aadhaar_otp', 'third_party') DEFAULT 'manual',
    verified_by INT NULL COMMENT 'Admin user ID',
    verified_at TIMESTAMP NULL,
    rejection_reason TEXT NULL,
    expiry_date DATE NULL,
    verification_data JSON NULL COMMENT 'API response data',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_status (verification_status),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- INVENTORY & SUPPLIES
-- ============================================

CREATE TABLE IF NOT EXISTS inventory_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(200) NOT NULL,
    sku VARCHAR(100) UNIQUE,
    category VARCHAR(100) NULL,
    description TEXT NULL,
    unit VARCHAR(50) DEFAULT 'piece',
    min_stock_level INT DEFAULT 0,
    current_stock INT DEFAULT 0,
    unit_cost DECIMAL(10, 2) DEFAULT 0.00,
    supplier VARCHAR(200) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sku (sku),
    INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cleaner_inventory (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cleaner_id INT NOT NULL,
    item_id INT NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    last_restocked_at TIMESTAMP NULL,
    notes TEXT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (cleaner_id) REFERENCES users(id),
    FOREIGN KEY (item_id) REFERENCES inventory_items(id),
    UNIQUE KEY unique_cleaner_item (cleaner_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    item_id INT NOT NULL,
    cleaner_id INT NULL,
    transaction_type ENUM('purchase', 'allocation', 'return', 'adjustment', 'usage') NOT NULL,
    quantity INT NOT NULL,
    unit_cost DECIMAL(10, 2) NULL,
    total_cost DECIMAL(10, 2) NULL,
    booking_id INT NULL,
    notes TEXT NULL,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_item (item_id),
    INDEX idx_cleaner (cleaner_id),
    FOREIGN KEY (item_id) REFERENCES inventory_items(id),
    FOREIGN KEY (cleaner_id) REFERENCES users(id),
    FOREIGN KEY (booking_id) REFERENCES bookings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- DISPUTE WORKFLOWS
-- ============================================

CREATE TABLE IF NOT EXISTS disputes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    dispute_number VARCHAR(50) NOT NULL UNIQUE,
    booking_id INT NOT NULL,
    raised_by INT NOT NULL,
    against_user_id INT NULL COMMENT 'Cleaner or Customer',
    dispute_type ENUM('quality', 'payment', 'behaviour', 'cancellation', 'damage', 'other') NOT NULL,
    severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
    subject VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    evidence_urls JSON NULL COMMENT 'Photo/document URLs',
    status ENUM('open', 'investigating', 'resolved', 'closed', 'escalated') DEFAULT 'open',
    assigned_to INT NULL COMMENT 'Support agent',
    resolution TEXT NULL,
    compensation_amount DECIMAL(10, 2) DEFAULT 0.00,
    resolved_at TIMESTAMP NULL,
    resolved_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_booking (booking_id),
    INDEX idx_raised_by (raised_by),
    INDEX idx_status (status),
    FOREIGN KEY (booking_id) REFERENCES bookings(id),
    FOREIGN KEY (raised_by) REFERENCES users(id),
    FOREIGN KEY (against_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dispute_messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    dispute_id INT NOT NULL,
    sender_id INT NOT NULL,
    message TEXT NOT NULL,
    attachment_url VARCHAR(500) NULL,
    is_internal BOOLEAN DEFAULT FALSE COMMENT 'Internal note vs public message',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_dispute (dispute_id),
    FOREIGN KEY (dispute_id) REFERENCES disputes(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- BEFORE/AFTER PHOTOS
-- ============================================

CREATE TABLE IF NOT EXISTS job_photos (
    id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL,
    cleaner_id INT NOT NULL,
    photo_type ENUM('before', 'during', 'after', 'issue') NOT NULL,
    photo_url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500) NULL,
    caption TEXT NULL,
    room_type VARCHAR(100) NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSON NULL COMMENT 'EXIF data, GPS, etc.',
    INDEX idx_booking (booking_id),
    INDEX idx_type (photo_type),
    FOREIGN KEY (booking_id) REFERENCES bookings(id),
    FOREIGN KEY (cleaner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- ROLES & PERMISSIONS
-- ============================================

CREATE TABLE IF NOT EXISTS roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(200) NOT NULL,
    description TEXT NULL,
    is_system_role BOOLEAN DEFAULT FALSE COMMENT 'Cannot be deleted',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS permissions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(200) NOT NULL,
    resource VARCHAR(100) NOT NULL COMMENT 'bookings, users, etc.',
    action VARCHAR(50) NOT NULL COMMENT 'create, read, update, delete',
    description TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INT NOT NULL,
    permission_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_roles (
    user_id INT NOT NULL,
    role_id INT NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by INT NULL,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- AUDIT LOGS
-- ============================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL COMMENT 'booking, user, payment, etc.',
    resource_id INT NULL,
    changes JSON NULL COMMENT 'Before/after values',
    ip_address VARCHAR(45) NULL,
    user_agent TEXT NULL,
    request_method VARCHAR(10) NULL,
    request_url VARCHAR(500) NULL,
    status_code INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_resource (resource_type, resource_id),
    INDEX idx_action (action),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- WEBHOOKS & INTEGRATIONS
-- ============================================

CREATE TABLE IF NOT EXISTS webhooks (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(200) NOT NULL,
    url VARCHAR(500) NOT NULL,
    secret_key VARCHAR(255) NOT NULL,
    events JSON NOT NULL COMMENT 'Array of event types to listen for',
    is_active BOOLEAN DEFAULT TRUE,
    retry_count INT DEFAULT 3,
    timeout_seconds INT DEFAULT 30,
    headers JSON NULL COMMENT 'Custom HTTP headers',
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    webhook_id INT NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSON NOT NULL,
    response_status INT NULL,
    response_body TEXT NULL,
    attempt_count INT DEFAULT 1,
    delivered_at TIMESTAMP NULL,
    next_retry_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_webhook (webhook_id),
    INDEX idx_event (event_type),
    INDEX idx_retry (next_retry_at),
    FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- TDS & GST COMPLIANCE
-- ============================================

CREATE TABLE IF NOT EXISTS tax_filings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    filing_period VARCHAR(20) NOT NULL COMMENT 'YYYY-MM or YYYY-QQ',
    filing_type ENUM('gst', 'tds', 'income_tax') NOT NULL,
    total_revenue DECIMAL(15, 2) NOT NULL,
    total_tax DECIMAL(15, 2) NOT NULL,
    status ENUM('draft', 'filed', 'amended') DEFAULT 'draft',
    filed_at TIMESTAMP NULL,
    filed_by INT NULL,
    filing_reference VARCHAR(100) NULL,
    document_url VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_period (filing_period),
    INDEX idx_type (filing_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tds_deductions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cleaner_id INT NOT NULL,
    settlement_batch_id INT NULL,
    period VARCHAR(20) NOT NULL,
    gross_amount DECIMAL(10, 2) NOT NULL,
    tds_rate DECIMAL(5, 2) NOT NULL,
    tds_amount DECIMAL(10, 2) NOT NULL,
    net_amount DECIMAL(10, 2) NOT NULL,
    pan_number VARCHAR(10) NULL,
    form_16a_url VARCHAR(500) NULL,
    deducted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cleaner (cleaner_id),
    INDEX idx_period (period),
    FOREIGN KEY (cleaner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- CRASH REPORTING & MONITORING
-- ============================================

CREATE TABLE IF NOT EXISTS crash_reports (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    app_version VARCHAR(50) NOT NULL,
    platform ENUM('ios', 'android', 'web') NOT NULL,
    user_id INT NULL,
    error_message TEXT NOT NULL,
    stack_trace TEXT NULL,
    device_info JSON NULL,
    os_version VARCHAR(50) NULL,
    crash_time TIMESTAMP NOT NULL,
    is_resolved BOOLEAN DEFAULT FALSE,
    resolution_notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_platform (platform),
    INDEX idx_app_version (app_version),
    INDEX idx_resolved (is_resolved),
    INDEX idx_crash_time (crash_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- ANALYTICS & HEATMAPS
-- ============================================

CREATE TABLE IF NOT EXISTS analytics_events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_name VARCHAR(100) NOT NULL,
    user_id INT NULL,
    session_id VARCHAR(100) NULL,
    properties JSON NULL,
    page_url VARCHAR(500) NULL,
    referrer VARCHAR(500) NULL,
    device_type VARCHAR(50) NULL,
    city_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_event (event_name),
    INDEX idx_user (user_id),
    INDEX idx_session (session_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS demand_heatmap (
    id INT PRIMARY KEY AUTO_INCREMENT,
    city_id INT NOT NULL,
    zone_id INT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    demand_score INT NOT NULL COMMENT '0-100',
    hour_of_day INT NOT NULL COMMENT '0-23',
    day_of_week INT NOT NULL COMMENT '0-6',
    calculation_date DATE NOT NULL,
    booking_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_city (city_id),
    INDEX idx_time (day_of_week, hour_of_day),
    INDEX idx_date (calculation_date),
    FOREIGN KEY (city_id) REFERENCES cities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- OFFLINE MODE SYNC
-- ============================================

CREATE TABLE IF NOT EXISTS sync_queue (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    device_id VARCHAR(255) NOT NULL,
    action_type VARCHAR(100) NOT NULL COMMENT 'create_booking, update_status, etc.',
    resource_type VARCHAR(100) NOT NULL,
    resource_id INT NULL,
    payload JSON NOT NULL,
    status ENUM('pending', 'synced', 'failed', 'conflict') DEFAULT 'pending',
    error_message TEXT NULL,
    retry_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    synced_at TIMESTAMP NULL,
    INDEX idx_user_device (user_id, device_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- MULTILINGUAL SUPPORT
-- ============================================

CREATE TABLE IF NOT EXISTS translations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    language_code VARCHAR(10) NOT NULL COMMENT 'en, hi, mr, etc.',
    resource_type VARCHAR(100) NOT NULL COMMENT 'service, notification, etc.',
    resource_id INT NULL,
    field_name VARCHAR(100) NOT NULL,
    translated_text TEXT NOT NULL,
    is_approved BOOLEAN DEFAULT FALSE,
    translated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_language (language_code),
    INDEX idx_resource (resource_type, resource_id),
    UNIQUE KEY unique_translation (language_code, resource_type, resource_id, field_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- FRAUD DETECTION
-- ============================================

CREATE TABLE IF NOT EXISTS fraud_alerts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    alert_type VARCHAR(100) NOT NULL,
    severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
    user_id INT NULL,
    booking_id INT NULL,
    description TEXT NOT NULL,
    detection_rules JSON NULL,
    risk_score INT NOT NULL COMMENT '0-100',
    status ENUM('open', 'investigating', 'confirmed', 'false_positive', 'resolved') DEFAULT 'open',
    investigated_by INT NULL,
    resolution_notes TEXT NULL,
    resolved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_booking (booking_id),
    INDEX idx_severity (severity),
    INDEX idx_status (status),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (booking_id) REFERENCES bookings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS blocked_users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    blocked_reason TEXT NOT NULL,
    blocked_by INT NOT NULL,
    blocked_until TIMESTAMP NULL COMMENT 'NULL = permanent',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_active (is_active),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (blocked_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- WORKLOAD BALANCING
-- ============================================

CREATE TABLE IF NOT EXISTS cleaner_capacity (
    cleaner_id INT PRIMARY KEY,
    max_daily_bookings INT DEFAULT 8,
    max_concurrent_bookings INT DEFAULT 1,
    current_active_bookings INT DEFAULT 0,
    total_bookings_today INT DEFAULT 0,
    last_booking_at TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (cleaner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

ALTER TABLE bookings ADD INDEX idx_city_status (city_id, status);
ALTER TABLE bookings ADD INDEX idx_scheduled (scheduled_date, scheduled_time);

-- Insert default roles
INSERT INTO roles (name, display_name, is_system_role) VALUES
('super_admin', 'Super Administrator', TRUE),
('admin', 'Administrator', TRUE),
('support_agent', 'Support Agent', TRUE),
('cleaner', 'Cleaner', TRUE),
('customer', 'Customer', TRUE)
ON DUPLICATE KEY UPDATE name=name;

-- Insert default city (Mumbai)
INSERT INTO cities (name, state, country, latitude, longitude) VALUES
('Mumbai', 'Maharashtra', 'India', 19.0760, 72.8777)
ON DUPLICATE KEY UPDATE name=name;
