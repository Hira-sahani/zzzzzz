import { Router } from 'express';
import * as addressController from '../controllers/addressController';
import { authenticateToken, requireUserType } from '../middleware/auth';
import { createAddressValidation } from '../middleware/validation';

const router = Router();

// All address routes require customer authentication
router.use(authenticateToken);
router.use(requireUserType('customer'));

// GET /api/v1/addresses - Get user's addresses
router.get('/', addressController.getAddresses);

// POST /api/v1/addresses - Create new address
router.post('/', createAddressValidation, addressController.createAddress);

// PUT /api/v1/addresses/:id - Update address
router.put('/:id', createAddressValidation, addressController.updateAddress);

// DELETE /api/v1/addresses/:id - Delete address
router.delete('/:id', addressController.deleteAddress);

export default router;
