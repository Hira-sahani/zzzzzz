import { Router } from 'express';
import * as adminController from '../controllers/adminController';
import { authenticateToken, requireUserType } from '../middleware/auth';
import { adminLoginValidation } from '../middleware/validation';
import { adminRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// POST /api/v1/admin/login - Admin login (no auth required)
router.post('/login', adminLoginValidation, adminController.adminLogin);

// All other admin routes require admin authentication
router.use(authenticateToken);
router.use(requireUserType('admin'));
router.use(adminRateLimiter);

// GET /api/v1/admin/dashboard/stats - Get dashboard statistics
router.get('/dashboard/stats', adminController.getDashboardStats);

// GET /api/v1/admin/cleaners - Get all cleaners
router.get('/cleaners', adminController.getCleaners);

// POST /api/v1/admin/cleaners - Create new cleaner
router.post('/cleaners', adminController.createCleaner);

// PUT /api/v1/admin/cleaners/:id - Update cleaner
router.put('/cleaners/:id', adminController.updateCleaner);

export default router;
