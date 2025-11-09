import { Request, Response } from 'express';
import { query } from '../config/database';
import { logger } from '../utils/logger';

/**
 * Get all available services
 * GET /api/v1/services
 */
export async function getServices(req: Request, res: Response): Promise<void> {
  try {
    const services = await query(
      'SELECT id, name, description, estimated_duration_minutes as estimatedDuration, price, icon_url as iconUrl FROM services WHERE is_active = true ORDER BY display_order ASC'
    );

    res.status(200).json({
      success: true,
      services: services
    });
  } catch (error) {
    logger.error('Get services error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch services',
      code: 'FETCH_FAILED'
    });
  }
}

/**
 * Get service by ID
 * GET /api/v1/services/:id
 */
export async function getServiceById(req: Request, res: Response): Promise<void> {
  try {
    const serviceId = parseInt(req.params.id);

    const services = await query(
      'SELECT id, name, description, estimated_duration_minutes as estimatedDuration, price, icon_url as iconUrl FROM services WHERE id = ? AND is_active = true',
      [serviceId]
    );

    if (services.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Service not found',
        code: 'NOT_FOUND'
      });
      return;
    }

    res.status(200).json({
      success: true,
      service: services[0]
    });
  } catch (error) {
    logger.error('Get service by ID error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch service',
      code: 'FETCH_FAILED'
    });
  }
}
