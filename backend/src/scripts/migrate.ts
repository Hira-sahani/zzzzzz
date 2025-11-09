import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true
};

async function migrate() {
  let connection;

  try {
    // Connect without database first to create it
    connection = await mysql.createConnection(dbConfig);

    console.log('Creating database if not exists...');
    await connection.query(`CREATE DATABASE IF NOT EXISTS primo_cleaning CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE primo_cleaning`);

    console.log('Creating tables...');

    // Table 1: users
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        phone VARCHAR(20) UNIQUE NOT NULL,
        user_type ENUM('customer', 'cleaner', 'admin') NOT NULL,
        name VARCHAR(100) NULL,
        email VARCHAR(255) NULL UNIQUE,
        profile_photo_url VARCHAR(500) NULL,
        status ENUM('active', 'suspended', 'pending_approval', 'inactive') DEFAULT 'active',
        is_available BOOLEAN DEFAULT false,
        current_latitude DECIMAL(10, 8) NULL,
        current_longitude DECIMAL(11, 8) NULL,
        last_location_update DATETIME NULL,
        rating_average DECIMAL(3, 2) DEFAULT 0.00,
        total_ratings INT DEFAULT 0,
        total_jobs_completed INT DEFAULT 0,
        total_bookings INT DEFAULT 0,
        verification_documents JSON NULL,
        is_verified BOOLEAN DEFAULT false,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_type (user_type),
        INDEX idx_status (status),
        INDEX idx_is_available (is_available),
        INDEX idx_location (current_latitude, current_longitude)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created users table');

    // Table 2: otp_tokens
    await connection.query(`
      CREATE TABLE IF NOT EXISTS otp_tokens (
        id INT PRIMARY KEY AUTO_INCREMENT,
        phone VARCHAR(20) NOT NULL,
        otp_code VARCHAR(6) NOT NULL,
        expires_at DATETIME NOT NULL,
        is_used BOOLEAN DEFAULT false,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_phone (phone),
        INDEX idx_expires_at (expires_at),
        INDEX idx_is_used (is_used)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created otp_tokens table');

    // Table 3: services
    await connection.query(`
      CREATE TABLE IF NOT EXISTS services (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        estimated_duration_minutes INT NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        icon_url VARCHAR(500) NULL,
        is_active BOOLEAN DEFAULT true,
        display_order INT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_is_active (is_active),
        INDEX idx_display_order (display_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created services table');

    // Table 4: addresses
    await connection.query(`
      CREATE TABLE IF NOT EXISTS addresses (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        address_line1 VARCHAR(255) NOT NULL,
        address_line2 VARCHAR(255) NULL,
        city VARCHAR(100) NOT NULL,
        state VARCHAR(100) NULL,
        postal_code VARCHAR(20) NULL,
        country VARCHAR(100) DEFAULT 'India',
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        landmark VARCHAR(255) NULL,
        special_instructions TEXT NULL,
        is_default BOOLEAN DEFAULT false,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_is_default (is_default)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created addresses table');

    // Table 5: bookings
    await connection.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        booking_number VARCHAR(20) UNIQUE NOT NULL,
        customer_id INT NOT NULL,
        cleaner_id INT NULL,
        booking_type ENUM('instant', 'scheduled') NOT NULL,
        status ENUM('pending', 'assigned', 'accepted', 'in_progress', 'completed', 'cancelled') DEFAULT 'pending',
        scheduled_date DATE NULL,
        scheduled_time TIME NULL,
        address_id INT NOT NULL,
        address_snapshot JSON NOT NULL,
        special_instructions TEXT NULL,
        total_amount DECIMAL(10, 2) NOT NULL,
        platform_fee DECIMAL(10, 2) DEFAULT 0.00,
        cleaner_earnings DECIMAL(10, 2) NOT NULL,
        payment_method ENUM('stripe', 'cash') NOT NULL,
        payment_status ENUM('pending', 'paid', 'refunded') DEFAULT 'pending',
        stripe_payment_intent_id VARCHAR(255) NULL,
        assigned_at DATETIME NULL,
        accepted_at DATETIME NULL,
        started_at DATETIME NULL,
        completed_at DATETIME NULL,
        cancelled_at DATETIME NULL,
        cancellation_reason TEXT NULL,
        cancelled_by ENUM('customer', 'cleaner', 'admin') NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES users(id),
        FOREIGN KEY (cleaner_id) REFERENCES users(id),
        FOREIGN KEY (address_id) REFERENCES addresses(id),
        INDEX idx_status (status),
        INDEX idx_booking_type (booking_type),
        INDEX idx_customer_id (customer_id),
        INDEX idx_cleaner_id (cleaner_id),
        INDEX idx_scheduled_date (scheduled_date),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created bookings table');

    // Table 6: booking_services
    await connection.query(`
      CREATE TABLE IF NOT EXISTS booking_services (
        id INT PRIMARY KEY AUTO_INCREMENT,
        booking_id INT NOT NULL,
        service_id INT NOT NULL,
        service_name VARCHAR(100) NOT NULL,
        service_price DECIMAL(10, 2) NOT NULL,
        estimated_duration_minutes INT NOT NULL,
        is_completed BOOLEAN DEFAULT false,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
        FOREIGN KEY (service_id) REFERENCES services(id),
        INDEX idx_booking_id (booking_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created booking_services table');

    // Table 7: job_photos
    await connection.query(`
      CREATE TABLE IF NOT EXISTS job_photos (
        id INT PRIMARY KEY AUTO_INCREMENT,
        booking_id INT NOT NULL,
        photo_url VARCHAR(500) NOT NULL,
        photo_type ENUM('before', 'after', 'general') DEFAULT 'general',
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
        INDEX idx_booking_id (booking_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created job_photos table');

    // Table 8: ratings
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ratings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        booking_id INT NOT NULL,
        rater_id INT NOT NULL,
        rated_id INT NOT NULL,
        rating TINYINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
        review_text TEXT NULL,
        timeliness_rating TINYINT NULL CHECK (timeliness_rating >= 1 AND timeliness_rating <= 5),
        quality_rating TINYINT NULL CHECK (quality_rating >= 1 AND quality_rating <= 5),
        professionalism_rating TINYINT NULL CHECK (professionalism_rating >= 1 AND professionalism_rating <= 5),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
        FOREIGN KEY (rater_id) REFERENCES users(id),
        FOREIGN KEY (rated_id) REFERENCES users(id),
        INDEX idx_booking_id (booking_id),
        INDEX idx_rated_id (rated_id),
        INDEX idx_rating (rating),
        UNIQUE KEY unique_rating_per_booking (booking_id, rater_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created ratings table');

    // Table 9: transactions
    await connection.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        booking_id INT NULL,
        user_id INT NOT NULL,
        transaction_type ENUM('booking_payment', 'refund', 'cleaner_payout', 'tip') NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'INR',
        payment_method ENUM('stripe', 'cash', 'bank_transfer') NOT NULL,
        status ENUM('pending', 'completed', 'failed', 'refunded') NOT NULL,
        stripe_transaction_id VARCHAR(255) NULL,
        description TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (booking_id) REFERENCES bookings(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        INDEX idx_user_id (user_id),
        INDEX idx_transaction_type (transaction_type),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created transactions table');

    // Table 10: issues
    await connection.query(`
      CREATE TABLE IF NOT EXISTS issues (
        id INT PRIMARY KEY AUTO_INCREMENT,
        booking_id INT NOT NULL,
        reporter_id INT NOT NULL,
        reporter_type ENUM('customer', 'cleaner') NOT NULL,
        issue_type ENUM('quality', 'payment', 'behavior', 'no_show', 'other') NOT NULL,
        description TEXT NOT NULL,
        evidence_urls JSON NULL,
        status ENUM('open', 'in_progress', 'resolved', 'closed') DEFAULT 'open',
        resolution_notes TEXT NULL,
        resolved_by INT NULL,
        resolved_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (booking_id) REFERENCES bookings(id),
        FOREIGN KEY (reporter_id) REFERENCES users(id),
        FOREIGN KEY (resolved_by) REFERENCES users(id),
        INDEX idx_status (status),
        INDEX idx_booking_id (booking_id),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created issues table');

    // Table 11: notifications
    await connection.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        booking_id INT NULL,
        notification_type ENUM('sms', 'push', 'email') NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        status ENUM('pending', 'sent', 'failed') DEFAULT 'pending',
        sent_at DATETIME NULL,
        external_id VARCHAR(255) NULL,
        error_message TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (booking_id) REFERENCES bookings(id),
        INDEX idx_user_id (user_id),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created notifications table');

    // Table 12: admin_users
    await connection.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('super_admin', 'operations_manager') DEFAULT 'operations_manager',
        last_login_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created admin_users table');

    // Table 13: platform_settings
    await connection.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        setting_key VARCHAR(100) UNIQUE NOT NULL,
        setting_value TEXT NOT NULL,
        description TEXT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created platform_settings table');

    console.log('\n✅ All tables created successfully!');

  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run migration
migrate()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
