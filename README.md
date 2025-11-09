# Primo - Backend & Web Frontend

**Full-stack cleaning services platform**

This repository contains the complete backend API and web frontend for the Primo on-demand cleaning services platform.

## 📁 Repository Structure

```
zzzzzz/
├── backend/           ✅ Complete and production-ready
│   ├── src/          TypeScript source code
│   ├── dist/         Compiled JavaScript
│   ├── logs/         Application logs
│   └── ...
└── frontend/         🔜 Coming soon (React + TypeScript)
```

## 🚀 Backend - COMPLETE

The backend API is **fully implemented and production-ready**!

### Features
- ✅ 40+ REST API endpoints
- ✅ Phone + OTP authentication
- ✅ JWT-based authorization
- ✅ Complete booking system
- ✅ Stripe payment integration
- ✅ Twilio SMS notifications
- ✅ Rating & review system
- ✅ Admin dashboard endpoints
- ✅ Real-time location tracking
- ✅ Comprehensive error handling
- ✅ Rate limiting & security

### Tech Stack
- Node.js + TypeScript
- Express.js framework
- MySQL database
- JWT authentication
- Stripe payments
- Twilio SMS
- Winston logging

### Quick Start

```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
nano .env  # Update with your credentials

# Set up database
npm run db:migrate
npm run db:seed

# Start server
npm run dev
```

**Server**: http://localhost:3000
**API**: http://localhost:3000/api/v1

### Documentation
- **[Quick Start Guide](backend/QUICKSTART.md)** - Get started in 5 minutes
- **[Full Documentation](backend/README.md)** - Complete API reference
- **Database**: 13 tables with complete schema
- **Endpoints**: Auth, Services, Bookings, Cleaner, Admin

### Default Credentials
After seeding:
- **Admin**: admin@primo.com / admin123

## 🖥️ Frontend - PLANNED

React-based web application for customers and admin dashboard.

### Planned Features
- Customer booking interface
- Service selection
- Real-time cleaner tracking
- Payment processing
- Booking history
- Admin dashboard
- Analytics & reports

### Tech Stack (Planned)
- React + TypeScript
- Vite build tool
- Tailwind CSS
- Context API / Redux
- Axios for API calls

## 🎯 What's Built

### ✅ Backend Complete
- All authentication endpoints
- User management
- Service catalog
- Address management
- Complete booking flow
- Payment processing
- SMS notifications
- Rating system
- Cleaner job management
- Admin dashboard APIs
- Location tracking

### 🔜 Next: Frontend
- Web UI design
- Customer booking flow
- Admin dashboard
- Integration with backend

## 📊 Database

13 MySQL tables:
- users, otp_tokens, services
- addresses, bookings, booking_services
- job_photos, ratings, transactions
- issues, notifications, admin_users
- platform_settings

## 🔐 Security

- JWT authentication
- OTP verification
- Rate limiting
- Input validation
- Password hashing
- Security headers
- CORS configured

## 📱 API Endpoints

### Authentication
- `POST /api/v1/auth/send-otp`
- `POST /api/v1/auth/verify-otp`
- `POST /api/v1/auth/update-profile`

### Services
- `GET /api/v1/services`

### Bookings
- `POST /api/v1/bookings`
- `GET /api/v1/bookings`
- `GET /api/v1/bookings/:id`
- `PUT /api/v1/bookings/:id/cancel`
- `PUT /api/v1/bookings/:id/status`
- `POST /api/v1/bookings/:id/rate`

### Cleaner
- `PUT /api/v1/cleaner/availability`
- `PUT /api/v1/cleaner/location`
- `POST /api/v1/cleaner/jobs/:id/accept`

### Admin
- `POST /api/v1/admin/login`
- `GET /api/v1/admin/dashboard/stats`
- `GET /api/v1/admin/cleaners`

**Full list**: See [backend/README.md](backend/README.md)

## 🧪 Testing

```bash
# Health check
curl http://localhost:3000/health

# Get services
curl http://localhost:3000/api/v1/services

# Send OTP
curl -X POST http://localhost:3000/api/v1/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+919876543210"}'
```

## 📈 Current Status

**Backend**: ✅ Production-ready
- 13 database tables
- 40+ API endpoints
- All core features implemented
- Comprehensive documentation
- Ready for frontend integration

**Frontend**: 🔜 Next milestone

## 🛠️ Development

### Prerequisites
- Node.js 18+
- MySQL 8.0+
- Stripe account (optional for dev)
- Twilio account (optional for dev)

### Development Mode
Backend runs with mock services if Twilio/Stripe not configured:
- OTP codes logged to console
- SMS messages logged instead of sent
- Payments return mock success

See logs in `backend/logs/`

## 📖 Documentation

- [Backend Quick Start](backend/QUICKSTART.md)
- [Backend README](backend/README.md)

## 🎉 What's Next?

1. **Frontend Development**
   - Design UI/UX
   - Implement customer flows
   - Build admin dashboard

2. **Mobile Apps**
   - See xxxxx repository
   - Customer and Cleaner apps

3. **Deployment**
   - Production infrastructure
   - CI/CD pipeline
   - Monitoring setup

---

**Primo Backend** - ✅ Complete and ready to serve! 🚀

Built with Node.js, TypeScript, Express, and MySQL
