import express, { Application, Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Import database
import { testConnection } from './config/database';

// Import middleware
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRateLimiter } from './middleware/rateLimiter';

// Import routes
import authRoutes from './routes/authRoutes';
import servicesRoutes from './routes/servicesRoutes';
import addressRoutes from './routes/addressRoutes';
import bookingRoutes from './routes/bookingRoutes';
import cleanerRoutes from './routes/cleanerRoutes';
import adminRoutes from './routes/adminRoutes';

// Import logger
import { logger } from './utils/logger';

// Create Express app
const app: Application = express();
const PORT = process.env.PORT || 3000;

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      process.env.ADMIN_URL || 'http://localhost:5173/admin'
    ],
    credentials: true
  })
);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req: Request, res: Response, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// API Routes
const API_VERSION = '/api/v1';

app.use(`${API_VERSION}/auth`, authRoutes);
app.use(`${API_VERSION}/services`, servicesRoutes);
app.use(`${API_VERSION}/addresses`, addressRoutes);
app.use(`${API_VERSION}/bookings`, bookingRoutes);
app.use(`${API_VERSION}/cleaner`, cleanerRoutes);
app.use(`${API_VERSION}/admin`, adminRoutes);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Primo API is running',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to Primo Cleaning Platform API',
    version: '1.0.0',
    documentation: '/api/v1/docs'
  });
});

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Start server
async function startServer() {
  try {
    // Test database connection
    await testConnection();

    // Start listening
    app.listen(PORT, () => {
      logger.info(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🧹 Primo Cleaning Platform API                         ║
║                                                           ║
║   Environment: ${process.env.NODE_ENV || 'development'}                              ║
║   Port: ${PORT}                                              ║
║   Database: ${process.env.DB_NAME || 'primo_cleaning'}                          ║
║                                                           ║
║   API Base: http://localhost:${PORT}${API_VERSION}              ║
║   Health: http://localhost:${PORT}/health                   ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  process.exit(0);
});

// Start the server
startServer();

export default app;
