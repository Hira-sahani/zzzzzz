import { Router } from 'express';
import * as servicesController from '../controllers/servicesController';

const router = Router();

// GET /api/v1/services - Get all services (public endpoint)
router.get('/', servicesController.getServices);

// GET /api/v1/services/:id - Get service by ID (public endpoint)
router.get('/:id', servicesController.getServiceById);

export default router;
