import { Router } from 'express';
import * as cleanerController from '../controllers/cleanerController';
import { authenticateToken, requireUserType } from '../middleware/auth';
import { updateAvailabilityValidation, updateLocationValidation } from '../middleware/validation';

const router = Router();

// All cleaner routes require cleaner authentication
router.use(authenticateToken);
router.use(requireUserType('cleaner'));

// PUT /api/v1/cleaner/availability - Toggle availability
router.put('/availability', updateAvailabilityValidation, cleanerController.updateAvailability);

// PUT /api/v1/cleaner/location - Update location
router.put('/location', updateLocationValidation, cleanerController.updateLocation);

// POST /api/v1/cleaner/jobs/:bookingId/accept - Accept job
router.post('/jobs/:bookingId/accept', cleanerController.acceptJob);

// POST /api/v1/cleaner/jobs/:bookingId/decline - Decline job
router.post('/jobs/:bookingId/decline', cleanerController.declineJob);

export default router;
