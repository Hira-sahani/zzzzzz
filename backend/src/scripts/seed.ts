import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'primo_cleaning'
};

async function seed() {
  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('Connected to database for seeding...\n');

    // Seed Services
    console.log('Seeding services...');
    await connection.query(`
      INSERT INTO services (name, description, estimated_duration_minutes, price, display_order) VALUES
      ('Bathroom Cleaning', 'Complete bathroom sanitization including toilet, sink, shower, and floor', 30, 299.00, 1),
      ('Kitchen Cleaning', 'Kitchen surfaces, appliances, and floor cleaning', 45, 399.00, 2),
      ('Dusting', 'Furniture, shelves, and surface dusting', 30, 249.00, 3),
      ('Mopping', 'Floor cleaning and mopping', 30, 199.00, 4)
      ON DUPLICATE KEY UPDATE name=name
    `);
    console.log('✓ Services seeded');

    // Seed Platform Settings
    console.log('Seeding platform settings...');
    await connection.query(`
      INSERT INTO platform_settings (setting_key, setting_value, description) VALUES
      ('job_match_radius_km', '5', 'Search radius in kilometers for finding available cleaners'),
      ('otp_expiry_minutes', '10', 'OTP expiration time in minutes'),
      ('otp_max_requests_per_hour', '3', 'Maximum OTP requests allowed per phone number per hour'),
      ('job_acceptance_timeout_seconds', '60', 'Time in seconds for cleaner to accept job request'),
      ('platform_fee_percentage', '15', 'Platform fee percentage taken from each booking')
      ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)
    `);
    console.log('✓ Platform settings seeded');

    // Create a default admin user (optional)
    console.log('Creating default admin user...');

    // First create user entry
    const [userResult]: any = await connection.query(`
      INSERT INTO users (phone, user_type, name, email, status)
      VALUES ('+919999999999', 'admin', 'Admin User', 'admin@primo.com', 'active')
      ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)
    `);

    const userId = userResult.insertId || userResult.lastInsertId;

    // Then create admin_users entry with hashed password
    const passwordHash = await bcrypt.hash('admin123', 10);
    await connection.query(`
      INSERT INTO admin_users (user_id, email, password_hash, role)
      VALUES (?, 'admin@primo.com', ?, 'super_admin')
      ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)
    `, [userId, passwordHash]);

    console.log('✓ Default admin user created');
    console.log('  Email: admin@primo.com');
    console.log('  Password: admin123');
    console.log('  ⚠️  IMPORTANT: Change this password in production!');

    console.log('\n✅ Database seeded successfully!');

  } catch (error) {
    console.error('Seeding failed:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run seed
seed()
  .then(() => {
    console.log('Seeding completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  });
