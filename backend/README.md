# Primo Cleaning Platform - Backend API

Complete Node.js + TypeScript + Express backend API for the Primo on-demand cleaning services platform.

## Features

- 🔐 Phone + OTP Authentication
- 👥 User Management (Customers, Cleaners, Admins)
- 🧹 Service Catalog Management
- 📍 Address Management with Geolocation
- 📅 Instant & Scheduled Bookings
- 💳 Stripe Payment Integration
- 📱 SMS Notifications via Twilio
- ⭐ Rating & Review System
- 🚀 Real-time Cleaner Matching Algorithm
- 📊 Admin Dashboard & Analytics
- 🔒 JWT-based Authorization
- 🛡️ Rate Limiting & Security

## Tech Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: MySQL
- **Authentication**: JWT (jsonwebtoken)
- **Payment**: Stripe
- **SMS**: Twilio
- **Security**: Helmet, bcryptjs
- **Validation**: express-validator
- **Logging**: Winston

## Prerequisites

- Node.js 18+ and npm
- MySQL 8.0+
- Stripe account (for payments)
- Twilio account (for SMS)
- AWS S3 (for photo storage)

## Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and configure:
   - Database credentials
   - JWT secret
   - Twilio credentials
   - Stripe API keys
   - AWS S3 credentials
   - Google Maps API key

3. **Create database and run migrations**:
   ```bash
   npm run db:migrate
   ```

4. **Seed initial data**:
   ```bash
   npm run db:seed
   ```

   This creates:
   - 4 initial services (Bathroom, Kitchen, Dusting, Mopping)
   - Platform settings
   - Default admin user (admin@primo.com / admin123)

## Running the Server

**Development mode** (with auto-reload):
```bash
npm run dev
```

**Production mode**:
```bash
npm run build
npm start
```

Server will start on: `http://localhost:3000`

## API Endpoints

### Authentication
- `POST /api/v1/auth/send-otp` - Send OTP to phone
- `POST /api/v1/auth/verify-otp` - Verify OTP and authenticate
- `POST /api/v1/auth/update-profile` - Update user profile

### Services
- `GET /api/v1/services` - Get all services (public)
- `GET /api/v1/services/:id` - Get service by ID

### Addresses
- `GET /api/v1/addresses` - Get user's addresses
- `POST /api/v1/addresses` - Add new address
- `PUT /api/v1/addresses/:id` - Update address
- `DELETE /api/v1/addresses/:id` - Delete address

### Bookings
- `POST /api/v1/bookings` - Create new booking
- `GET /api/v1/bookings` - Get user's bookings
- `GET /api/v1/bookings/:id` - Get booking details
- `PUT /api/v1/bookings/:id/cancel` - Cancel booking
- `PUT /api/v1/bookings/:id/status` - Update booking status (cleaner)
- `POST /api/v1/bookings/:id/rate` - Rate booking

### Cleaner
- `PUT /api/v1/cleaner/availability` - Toggle availability
- `PUT /api/v1/cleaner/location` - Update location
- `POST /api/v1/cleaner/jobs/:bookingId/accept` - Accept job
- `POST /api/v1/cleaner/jobs/:bookingId/decline` - Decline job

### Admin
- `POST /api/v1/admin/login` - Admin login
- `GET /api/v1/admin/dashboard/stats` - Dashboard statistics
- `GET /api/v1/admin/cleaners` - Get all cleaners
- `POST /api/v1/admin/cleaners` - Create new cleaner
- `PUT /api/v1/admin/cleaners/:id` - Update cleaner

## Database Schema

The backend uses 13 tables:

1. **users** - All user types (customers, cleaners, admins)
2. **otp_tokens** - OTP codes for authentication
3. **services** - Available cleaning services
4. **addresses** - Customer saved addresses
5. **bookings** - Main bookings table
6. **booking_services** - Services per booking
7. **job_photos** - Photos uploaded after job completion
8. **ratings** - Customer and cleaner ratings
9. **transactions** - Payment transactions
10. **issues** - Customer complaints/disputes
11. **notifications** - Notification history
12. **admin_users** - Admin authentication
13. **platform_settings** - System configuration

## Authentication

All authenticated endpoints require JWT token in Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

User types:
- `customer` - Regular customers booking services
- `cleaner` - Service providers
- `admin` - Platform administrators

## Default Admin Credentials

After running `npm run db:seed`:

- **Email**: admin@primo.com
- **Password**: admin123

⚠️ **IMPORTANT**: Change this password in production!

## Rate Limiting

- OTP endpoints: 3 requests per hour per IP
- General API: 100 requests per minute per IP
- Admin API: 1000 requests per minute per IP

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "ERROR_CODE"
}
```

Common HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `429` - Too Many Requests (rate limit)
- `500` - Internal Server Error

## Project Structure

```
backend/
├── src/
│   ├── config/          # Database and configuration
│   ├── controllers/     # Request handlers
│   ├── middleware/      # Auth, validation, error handling
│   ├── routes/          # API route definitions
│   ├── services/        # External services (Stripe, Twilio, etc.)
│   ├── utils/           # Helper functions
│   ├── types/           # TypeScript type definitions
│   ├── scripts/         # Database migration and seed scripts
│   └── server.ts        # Express app entry point
├── logs/                # Application logs
├── package.json
├── tsconfig.json
└── .env.example
```

## Development

### Code Style

- TypeScript strict mode enabled
- Async/await for asynchronous operations
- Proper error handling with try/catch
- Logging with Winston
- Input validation with express-validator

### Adding New Endpoints

1. Create controller in `src/controllers/`
2. Add validation rules in `src/middleware/validation.ts`
3. Create routes in `src/routes/`
4. Import and mount routes in `src/server.ts`

## Testing

Health check:
```bash
curl http://localhost:3000/health
```

Should return:
```json
{
  "success": true,
  "message": "Primo API is running",
  "timestamp": "2025-01-09T..."
}
```

## Environment Variables

Required environment variables (see `.env.example` for complete list):

```bash
# Database
DB_HOST=localhost
DB_NAME=primo_cleaning
DB_USER=root
DB_PASSWORD=your_password

# JWT
JWT_SECRET=your_secret_key
JWT_EXPIRY=30d

# Twilio (SMS)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# Stripe (Payments)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...

# Server
PORT=3000
NODE_ENV=development
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Use strong JWT secret
3. Enable HTTPS
4. Configure production database
5. Set up proper logging
6. Enable monitoring
7. Configure firewall
8. Set up automated backups

## Logs

Logs are stored in the `logs/` directory:
- `combined.log` - All logs
- `error.log` - Error logs only

## Support

For issues or questions:
- Check logs in `logs/` directory
- Review environment variables
- Verify database connection
- Check API documentation

## License

MIT

---

**Primo Cleaning Platform** - Bringing quality cleaning services to your doorstep 🧹✨
