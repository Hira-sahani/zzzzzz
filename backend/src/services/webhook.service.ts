import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import crypto from 'crypto';

export interface Webhook {
  id?: number;
  url: string;
  events: string[];
  secret: string;
  isActive: boolean;
  description?: string;
  headers?: { [key: string]: string };
  retryCount: number;
  maxRetries: number;
}

export interface WebhookDelivery {
  id?: number;
  webhookId: number;
  event: string;
  payload: any;
  status: 'pending' | 'success' | 'failed';
  httpStatus?: number;
  responseBody?: string;
  attempts: number;
  lastAttemptAt?: Date;
  nextRetryAt?: Date;
}

export class WebhookService {
  /**
   * Register a new webhook
   */
  async registerWebhook(webhook: {
    url: string;
    events: string[];
    description?: string;
    headers?: { [key: string]: string };
    maxRetries?: number;
  }): Promise<{ id: number; secret: string }> {
    // Generate secret key
    const secret = this.generateSecret();

    const sql = `
      INSERT INTO webhooks (
        url, events, secret, is_active, description,
        custom_headers, retry_count, max_retries
      ) VALUES (?, ?, ?, TRUE, ?, ?, 0, ?)
    `;

    const result = await query(sql, [
      webhook.url,
      JSON.stringify(webhook.events),
      secret,
      webhook.description || null,
      webhook.headers ? JSON.stringify(webhook.headers) : null,
      webhook.maxRetries || 3
    ]) as ResultSetHeader;

    return { id: result.insertId, secret };
  }

  /**
   * Generate webhook secret
   */
  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Trigger webhook for event
   */
  async triggerWebhooks(event: string, payload: any): Promise<void> {
    // Get all active webhooks subscribed to this event
    const sql = `
      SELECT id, url, events, secret, custom_headers, max_retries
      FROM webhooks
      WHERE is_active = TRUE
        AND JSON_CONTAINS(events, ?)
    `;

    const webhooks = await query(sql, [JSON.stringify(event)]) as RowDataPacket[];

    // Create delivery records for each webhook
    for (const webhook of webhooks) {
      await this.createDelivery(webhook.id, event, payload);
      // Trigger delivery in background
      this.deliverWebhook(webhook.id, webhook, event, payload).catch(console.error);
    }
  }

  /**
   * Create webhook delivery record
   */
  private async createDelivery(webhookId: number, event: string, payload: any): Promise<number> {
    const sql = `
      INSERT INTO webhook_deliveries (
        webhook_id, event, payload, status, attempts, created_at
      ) VALUES (?, ?, ?, 'pending', 0, NOW())
    `;

    const result = await query(sql, [
      webhookId,
      event,
      JSON.stringify(payload)
    ]) as ResultSetHeader;

    return result.insertId;
  }

  /**
   * Deliver webhook
   */
  private async deliverWebhook(
    deliveryId: number,
    webhook: any,
    event: string,
    payload: any
  ): Promise<void> {
    try {
      // Prepare payload
      const webhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        data: payload
      };

      // Generate signature
      const signature = this.generateSignature(webhook.secret, JSON.stringify(webhookPayload));

      // Prepare headers
      const headers: any = {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': event,
        'User-Agent': 'PrimeCleaningWebhook/1.0'
      };

      // Add custom headers
      if (webhook.custom_headers) {
        const customHeaders = JSON.parse(webhook.custom_headers);
        Object.assign(headers, customHeaders);
      }

      // Make HTTP request
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(webhookPayload),
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });

      const responseBody = await response.text();

      // Update delivery status
      await this.updateDeliveryStatus(
        deliveryId,
        response.ok ? 'success' : 'failed',
        response.status,
        responseBody
      );

      // Increment retry count if failed
      if (!response.ok && webhook.retry_count < webhook.max_retries) {
        await this.scheduleRetry(deliveryId, webhook.retry_count + 1);
      }
    } catch (error: any) {
      console.error('Webhook delivery error:', error);

      await this.updateDeliveryStatus(
        deliveryId,
        'failed',
        0,
        error.message
      );

      // Schedule retry
      if (webhook.retry_count < webhook.max_retries) {
        await this.scheduleRetry(deliveryId, webhook.retry_count + 1);
      }
    }
  }

  /**
   * Generate HMAC signature
   */
  private generateSignature(secret: string, payload: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Verify webhook signature
   */
  verifySignature(secret: string, payload: string, signature: string): boolean {
    const expectedSignature = this.generateSignature(secret, payload);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Update delivery status
   */
  private async updateDeliveryStatus(
    deliveryId: number,
    status: string,
    httpStatus: number,
    responseBody: string
  ): Promise<void> {
    const sql = `
      UPDATE webhook_deliveries
      SET status = ?,
          http_status = ?,
          response_body = ?,
          attempts = attempts + 1,
          last_attempt_at = NOW()
      WHERE id = ?
    `;

    await query(sql, [status, httpStatus, responseBody, deliveryId]);
  }

  /**
   * Schedule retry
   */
  private async scheduleRetry(deliveryId: number, attemptNumber: number): Promise<void> {
    // Exponential backoff: 1min, 5min, 30min
    const delays = [60, 300, 1800];
    const delaySeconds = delays[Math.min(attemptNumber - 1, delays.length - 1)];

    const sql = `
      UPDATE webhook_deliveries
      SET next_retry_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
      WHERE id = ?
    `;

    await query(sql, [delaySeconds, deliveryId]);
  }

  /**
   * Process pending retries
   */
  async processPendingRetries(): Promise<void> {
    const sql = `
      SELECT
        wd.id as deliveryId,
        wd.webhook_id as webhookId,
        wd.event, wd.payload,
        w.url, w.secret, w.custom_headers as customHeaders,
        w.retry_count as retryCount, w.max_retries as maxRetries
      FROM webhook_deliveries wd
      INNER JOIN webhooks w ON w.id = wd.webhook_id
      WHERE wd.status = 'failed'
        AND wd.next_retry_at IS NOT NULL
        AND wd.next_retry_at <= NOW()
        AND wd.attempts < w.max_retries
      LIMIT 100
    `;

    const deliveries = await query(sql) as RowDataPacket[];

    for (const delivery of deliveries) {
      const payload = JSON.parse(delivery.payload);
      await this.deliverWebhook(
        delivery.deliveryId,
        {
          id: delivery.webhookId,
          url: delivery.url,
          secret: delivery.secret,
          custom_headers: delivery.customHeaders,
          retry_count: delivery.retryCount,
          max_retries: delivery.maxRetries
        },
        delivery.event,
        payload
      );
    }
  }

  /**
   * Get webhook by ID
   */
  async getWebhookById(webhookId: number): Promise<Webhook | null> {
    const sql = `
      SELECT
        id, url, events, secret, is_active as isActive,
        description, custom_headers as headers,
        retry_count as retryCount, max_retries as maxRetries
      FROM webhooks
      WHERE id = ?
    `;

    const webhooks = await query(sql, [webhookId]) as RowDataPacket[];

    if (webhooks.length === 0) return null;

    const webhook = webhooks[0];
    return {
      ...webhook,
      events: JSON.parse(webhook.events),
      headers: webhook.headers ? JSON.parse(webhook.headers) : undefined
    };
  }

  /**
   * Get all webhooks
   */
  async getAllWebhooks(): Promise<Webhook[]> {
    const sql = `
      SELECT
        id, url, events, secret, is_active as isActive,
        description, custom_headers as headers,
        retry_count as retryCount, max_retries as maxRetries
      FROM webhooks
      ORDER BY created_at DESC
    `;

    const webhooks = await query(sql) as RowDataPacket[];

    return webhooks.map(webhook => ({
      ...webhook,
      events: JSON.parse(webhook.events),
      headers: webhook.headers ? JSON.parse(webhook.headers) : undefined
    }));
  }

  /**
   * Update webhook
   */
  async updateWebhook(webhookId: number, updates: Partial<Webhook>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.url) {
      fields.push('url = ?');
      values.push(updates.url);
    }

    if (updates.events) {
      fields.push('events = ?');
      values.push(JSON.stringify(updates.events));
    }

    if (updates.isActive !== undefined) {
      fields.push('is_active = ?');
      values.push(updates.isActive);
    }

    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }

    if (updates.headers) {
      fields.push('custom_headers = ?');
      values.push(JSON.stringify(updates.headers));
    }

    if (updates.maxRetries !== undefined) {
      fields.push('max_retries = ?');
      values.push(updates.maxRetries);
    }

    if (fields.length === 0) return;

    values.push(webhookId);
    const sql = `UPDATE webhooks SET ${fields.join(', ')} WHERE id = ?`;

    await query(sql, values);
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(webhookId: number): Promise<void> {
    await query('DELETE FROM webhooks WHERE id = ?', [webhookId]);
  }

  /**
   * Get webhook deliveries
   */
  async getWebhookDeliveries(
    webhookId: number,
    filters?: {
      status?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<{ deliveries: any[]; total: number }> {
    let sql = `
      SELECT
        id, webhook_id as webhookId, event, payload,
        status, http_status as httpStatus, response_body as responseBody,
        attempts, last_attempt_at as lastAttemptAt,
        next_retry_at as nextRetryAt, created_at as createdAt
      FROM webhook_deliveries
      WHERE webhook_id = ?
    `;

    const params: any[] = [webhookId];

    if (filters?.status) {
      sql += ` AND status = ?`;
      params.push(filters.status);
    }

    // Count total
    const countSql = sql.replace(
      'SELECT id, webhook_id as webhookId, event, payload, status, http_status as httpStatus, response_body as responseBody, attempts, last_attempt_at as lastAttemptAt, next_retry_at as nextRetryAt, created_at as createdAt',
      'SELECT COUNT(*) as total'
    );
    const countResult = await query(countSql, params) as RowDataPacket[];
    const total = countResult[0].total;

    // Get paginated results
    sql += ` ORDER BY created_at DESC`;

    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const offset = (page - 1) * limit;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const deliveries = await query(sql, params) as RowDataPacket[];

    // Parse payload
    deliveries.forEach(delivery => {
      if (delivery.payload) {
        delivery.payload = JSON.parse(delivery.payload);
      }
    });

    return { deliveries, total };
  }
}

export default new WebhookService();
