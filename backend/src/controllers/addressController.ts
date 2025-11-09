import { Request, Response } from 'express';
import { query, transaction } from '../config/database';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

/**
 * Get user's saved addresses
 * GET /api/v1/addresses
 */
export async function getAddresses(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;

    const addresses = await query(
      `SELECT id, address_line1 as addressLine1, address_line2 as addressLine2,
       city, state, postal_code as postalCode, country, latitude, longitude,
       landmark, special_instructions as specialInstructions, is_default as isDefault
       FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );

    res.status(200).json({
      success: true,
      addresses: addresses
    });
  } catch (error) {
    logger.error('Get addresses error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch addresses',
      code: 'FETCH_FAILED'
    });
  }
}

/**
 * Add new address
 * POST /api/v1/addresses
 */
export async function createAddress(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const {
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country = 'India',
      latitude,
      longitude,
      landmark,
      specialInstructions,
      isDefault = false
    } = req.body;

    // If this is set as default, unset other defaults first
    if (isDefault) {
      await query('UPDATE addresses SET is_default = false WHERE user_id = ?', [userId]);
    }

    // Insert new address
    const result = await query(
      `INSERT INTO addresses (user_id, address_line1, address_line2, city, state,
       postal_code, country, latitude, longitude, landmark, special_instructions, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        addressLine1,
        addressLine2 || null,
        city,
        state || null,
        postalCode || null,
        country,
        latitude,
        longitude,
        landmark || null,
        specialInstructions || null,
        isDefault
      ]
    );

    // Fetch created address
    const addresses = await query('SELECT * FROM addresses WHERE id = ?', [result.insertId]);
    const address = addresses[0];

    res.status(201).json({
      success: true,
      address: {
        id: address.id,
        addressLine1: address.address_line1,
        addressLine2: address.address_line2,
        city: address.city,
        state: address.state,
        postalCode: address.postal_code,
        country: address.country,
        latitude: address.latitude,
        longitude: address.longitude,
        landmark: address.landmark,
        specialInstructions: address.special_instructions,
        isDefault: address.is_default
      }
    });

    logger.info(`Address created for user ${userId}: ${result.insertId}`);
  } catch (error) {
    logger.error('Create address error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create address',
      code: 'CREATE_FAILED'
    });
  }
}

/**
 * Update address
 * PUT /api/v1/addresses/:id
 */
export async function updateAddress(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const addressId = parseInt(req.params.id);

    // Check if address belongs to user
    const addresses = await query('SELECT * FROM addresses WHERE id = ? AND user_id = ?', [
      addressId,
      userId
    ]);

    if (addresses.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Address not found',
        code: 'NOT_FOUND'
      });
      return;
    }

    const {
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      latitude,
      longitude,
      landmark,
      specialInstructions,
      isDefault
    } = req.body;

    // If this is set as default, unset other defaults first
    if (isDefault) {
      await query('UPDATE addresses SET is_default = false WHERE user_id = ? AND id != ?', [
        userId,
        addressId
      ]);
    }

    // Update address
    await query(
      `UPDATE addresses SET address_line1 = ?, address_line2 = ?, city = ?, state = ?,
       postal_code = ?, country = ?, latitude = ?, longitude = ?, landmark = ?,
       special_instructions = ?, is_default = ?
       WHERE id = ?`,
      [
        addressLine1,
        addressLine2 || null,
        city,
        state || null,
        postalCode || null,
        country,
        latitude,
        longitude,
        landmark || null,
        specialInstructions || null,
        isDefault,
        addressId
      ]
    );

    // Fetch updated address
    const updatedAddresses = await query('SELECT * FROM addresses WHERE id = ?', [addressId]);
    const address = updatedAddresses[0];

    res.status(200).json({
      success: true,
      address: {
        id: address.id,
        addressLine1: address.address_line1,
        addressLine2: address.address_line2,
        city: address.city,
        state: address.state,
        postalCode: address.postal_code,
        country: address.country,
        latitude: address.latitude,
        longitude: address.longitude,
        landmark: address.landmark,
        specialInstructions: address.special_instructions,
        isDefault: address.is_default
      }
    });

    logger.info(`Address updated: ${addressId}`);
  } catch (error) {
    logger.error('Update address error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update address',
      code: 'UPDATE_FAILED'
    });
  }
}

/**
 * Delete address
 * DELETE /api/v1/addresses/:id
 */
export async function deleteAddress(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const addressId = parseInt(req.params.id);

    // Check if address belongs to user
    const addresses = await query('SELECT * FROM addresses WHERE id = ? AND user_id = ?', [
      addressId,
      userId
    ]);

    if (addresses.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Address not found',
        code: 'NOT_FOUND'
      });
      return;
    }

    // Delete address
    await query('DELETE FROM addresses WHERE id = ?', [addressId]);

    res.status(200).json({
      success: true,
      message: 'Address deleted successfully'
    });

    logger.info(`Address deleted: ${addressId}`);
  } catch (error) {
    logger.error('Delete address error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete address',
      code: 'DELETE_FAILED'
    });
  }
}
