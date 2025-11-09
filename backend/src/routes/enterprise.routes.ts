import { Router, Request, Response } from 'express';
import surgePricingService from '../services/surgePricing.service';
import couponService from '../services/coupon.service';
import geoFencingService from '../services/geoFencing.service';
import slaService from '../services/sla.service';
import cityService from '../services/city.service';
import invoiceService from '../services/invoice.service';
import kycService from '../services/kyc.service';
import rbacService from '../services/rbac.service';
import auditService from '../services/audit.service';
import webhookService from '../services/webhook.service';
import fraudService from '../services/fraud.service';
import workloadService from '../services/workload.service';
import analyticsService from '../services/analytics.service';

const router = Router();

// ===== Surge Pricing Routes =====

// Calculate surge multiplier
router.post('/surge-pricing/calculate', async (req: Request, res: Response) => {
  try {
    const { cityId, serviceId, requestTime } = req.body;
    const result = await surgePricingService.calculateSurgeMultiplier(
      cityId,
      serviceId,
      requestTime ? new Date(requestTime) : undefined
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Apply surge pricing to booking
router.post('/surge-pricing/apply', async (req: Request, res: Response) => {
  try {
    const { bookingId, basePrice, cityId, serviceId } = req.body;
    const result = await surgePricingService.applySurgePricing(bookingId, basePrice, cityId, serviceId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create surge pricing rule
router.post('/surge-pricing/rules', async (req: Request, res: Response) => {
  try {
    const ruleId = await surgePricingService.createRule(req.body);
    res.json({ success: true, data: { id: ruleId } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get surge history
router.get('/surge-pricing/history', async (req: Request, res: Response) => {
  try {
    const { cityId, days } = req.query;
    const history = await surgePricingService.getSurgeHistory(
      cityId ? Number(cityId) : undefined,
      days ? Number(days) : 7
    );
    res.json({ success: true, data: history });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== Coupon & Referral Routes =====

// Apply coupon
router.post('/coupons/apply', async (req: Request, res: Response) => {
  try {
    const { code, userId, orderValue, serviceIds } = req.body;
    const result = await couponService.applyCoupon(code, userId, orderValue, serviceIds);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Record coupon usage
router.post('/coupons/record-usage', async (req: Request, res: Response) => {
  try {
    const { couponId, userId, bookingId, discountAmount } = req.body;
    await couponService.recordUsage(couponId, userId, bookingId, discountAmount);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate referral code
router.post('/referrals/generate', async (req: Request, res: Response) => {
  try {
    const { referrerId, userName, referrerReward, refereeReward } = req.body;
    const code = couponService.generateReferralCode(userName);
    await couponService.createReferral(referrerId, code, referrerReward, refereeReward);
    res.json({ success: true, data: { code } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Apply referral
router.post('/referrals/apply', async (req: Request, res: Response) => {
  try {
    const { referralCode, refereeId } = req.body;
    const result = await couponService.applyReferral(referralCode, refereeId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get referral stats
router.get('/referrals/stats/:userId', async (req: Request, res: Response) => {
  try {
    const stats = await couponService.getReferralStats(Number(req.params.userId));
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== Geo-Fencing Routes =====

// Check if point in zone
router.post('/geo-fencing/check-zone', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, zoneId } = req.body;
    const inZone = await geoFencingService.isPointInZone({ latitude, longitude }, zoneId);
    res.json({ success: true, data: { inZone } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Find zones for point
router.post('/geo-fencing/find-zones', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, cityId } = req.body;
    const zones = await geoFencingService.findZonesForPoint({ latitude, longitude }, cityId);
    res.json({ success: true, data: zones });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get zone price adjustment
router.post('/geo-fencing/zone-pricing', async (req: Request, res: Response) => {
  try {
    const { zoneId, serviceId, basePrice } = req.body;
    const result = await geoFencingService.getZonePriceAdjustment(zoneId, serviceId, basePrice);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check service availability
router.post('/geo-fencing/check-availability', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, cityId } = req.body;
    const available = await geoFencingService.isServiceAvailable({ latitude, longitude }, cityId);
    res.json({ success: true, data: { available } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== SLA & Penalties Routes =====

// Check booking violations
router.post('/sla/check-violations/:bookingId', async (req: Request, res: Response) => {
  try {
    const violations = await slaService.checkBookingViolations(Number(req.params.bookingId));
    res.json({ success: true, data: violations });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get cleaner violations
router.get('/sla/violations/:cleanerId', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const violations = await slaService.getCleanerViolations(
      Number(req.params.cleanerId),
      days ? Number(days) : 30
    );
    res.json({ success: true, data: violations });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get/Create SLA policies
router.get('/sla/policies', async (req: Request, res: Response) => {
  try {
    const policies = await slaService.getAllPolicies();
    res.json({ success: true, data: policies });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/sla/policies', async (req: Request, res: Response) => {
  try {
    const policyId = await slaService.upsertPolicy(req.body);
    res.json({ success: true, data: { id: policyId } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get violations report
router.get('/sla/violations-report', async (req: Request, res: Response) => {
  try {
    const result = await slaService.getViolationsReport(req.query);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== City Configuration Routes =====

// Get all cities
router.get('/cities', async (req: Request, res: Response) => {
  try {
    const { includeInactive } = req.query;
    const cities = await cityService.getAllCities(includeInactive === 'true');
    res.json({ success: true, data: cities });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get city by ID
router.get('/cities/:id', async (req: Request, res: Response) => {
  try {
    const city = await cityService.getCityById(Number(req.params.id));
    res.json({ success: true, data: city });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create city
router.post('/cities', async (req: Request, res: Response) => {
  try {
    const cityId = await cityService.createCity(req.body);
    res.json({ success: true, data: { id: cityId } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update city
router.put('/cities/:id', async (req: Request, res: Response) => {
  try {
    await cityService.updateCity(Number(req.params.id), req.body);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get/Set city configuration
router.get('/cities/:id/config', async (req: Request, res: Response) => {
  try {
    const config = await cityService.getCityConfig(Number(req.params.id));
    res.json({ success: true, data: config });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/cities/:id/config', async (req: Request, res: Response) => {
  try {
    await cityService.setCityConfig({ cityId: Number(req.params.id), ...req.body });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check if city is operational
router.get('/cities/:id/operational', async (req: Request, res: Response) => {
  try {
    const { datetime } = req.query;
    const operational = await cityService.isCityOperational(
      Number(req.params.id),
      datetime ? new Date(datetime as string) : undefined
    );
    res.json({ success: true, data: { operational } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Find nearest city
router.post('/cities/nearest', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude } = req.body;
    const city = await cityService.findNearestCity(latitude, longitude);
    res.json({ success: true, data: city });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== GST Invoicing Routes =====

// Generate invoice
router.post('/invoices/generate/:bookingId', async (req: Request, res: Response) => {
  try {
    const invoice = await invoiceService.generateInvoice(Number(req.params.bookingId));
    res.json({ success: true, data: invoice });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get invoice by ID
router.get('/invoices/:id', async (req: Request, res: Response) => {
  try {
    const invoice = await invoiceService.getInvoiceById(Number(req.params.id));
    res.json({ success: true, data: invoice });
  } catch (error: any) {
    res.status(404).json({ success: false, error: 'Invoice not found' });
  }
});

// Get invoice by booking
router.get('/invoices/booking/:bookingId', async (req: Request, res: Response) => {
  try {
    const invoice = await invoiceService.getInvoiceByBookingId(Number(req.params.bookingId));
    res.json({ success: true, data: invoice });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get customer invoices
router.get('/invoices/customer/:customerId', async (req: Request, res: Response) => {
  try {
    const result = await invoiceService.getCustomerInvoices(Number(req.params.customerId), req.query);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get GST summary
router.get('/invoices/gst-summary', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const summary = await invoiceService.getGSTSummary(
      new Date(startDate as string),
      new Date(endDate as string)
    );
    res.json({ success: true, data: summary });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== KYC Verification Routes =====

// Submit KYC
router.post('/kyc/submit', async (req: Request, res: Response) => {
  try {
    const kycId = await kycService.submitKYC(req.body);
    res.json({ success: true, data: { id: kycId } });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Get user KYC
router.get('/kyc/user/:userId', async (req: Request, res: Response) => {
  try {
    const kyc = await kycService.getUserKYC(Number(req.params.userId));
    res.json({ success: true, data: kyc });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update KYC status
router.put('/kyc/:id/status', async (req: Request, res: Response) => {
  try {
    const { status, verifiedBy, rejectionReason } = req.body;
    await kycService.updateKYCStatus(Number(req.params.id), status, verifiedBy, rejectionReason);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get pending verifications
router.get('/kyc/pending', async (req: Request, res: Response) => {
  try {
    const { page, limit } = req.query;
    const result = await kycService.getPendingVerifications(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get KYC statistics
router.get('/kyc/stats', async (req: Request, res: Response) => {
  try {
    const stats = await kycService.getKYCStats();
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== RBAC Routes =====

// Check permission
router.post('/rbac/check-permission', async (req: Request, res: Response) => {
  try {
    const { userId, resource, action } = req.body;
    const hasPermission = await rbacService.hasPermission(userId, resource, action);
    res.json({ success: true, data: { hasPermission } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user permissions
router.get('/rbac/permissions/:userId', async (req: Request, res: Response) => {
  try {
    const permissions = await rbacService.getUserPermissions(Number(req.params.userId));
    res.json({ success: true, data: permissions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user roles
router.get('/rbac/roles/user/:userId', async (req: Request, res: Response) => {
  try {
    const roles = await rbacService.getUserRoles(Number(req.params.userId));
    res.json({ success: true, data: roles });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Assign role
router.post('/rbac/assign-role', async (req: Request, res: Response) => {
  try {
    const { userId, roleId, assignedBy } = req.body;
    await rbacService.assignRole(userId, roleId, assignedBy);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all roles
router.get('/rbac/roles', async (req: Request, res: Response) => {
  try {
    const roles = await rbacService.getAllRoles();
    res.json({ success: true, data: roles });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== Audit Logging Routes =====

// Log event
router.post('/audit/log', async (req: Request, res: Response) => {
  try {
    const logId = await auditService.log(req.body);
    res.json({ success: true, data: { id: logId } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get audit logs
router.get('/audit/logs', async (req: Request, res: Response) => {
  try {
    const result = await auditService.getLogs(req.query);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user activity
router.get('/audit/activity/:userId', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const activity = await auditService.getUserActivity(
      Number(req.params.userId),
      days ? Number(days) : 30
    );
    res.json({ success: true, data: activity });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get activity summary
router.get('/audit/summary', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const summary = await auditService.getActivitySummary(days ? Number(days) : 7);
    res.json({ success: true, data: summary });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== Webhook Routes =====

// Register webhook
router.post('/webhooks', async (req: Request, res: Response) => {
  try {
    const result = await webhookService.registerWebhook(req.body);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all webhooks
router.get('/webhooks', async (req: Request, res: Response) => {
  try {
    const webhooks = await webhookService.getAllWebhooks();
    res.json({ success: true, data: webhooks });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get webhook by ID
router.get('/webhooks/:id', async (req: Request, res: Response) => {
  try {
    const webhook = await webhookService.getWebhookById(Number(req.params.id));
    res.json({ success: true, data: webhook });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update webhook
router.put('/webhooks/:id', async (req: Request, res: Response) => {
  try {
    await webhookService.updateWebhook(Number(req.params.id), req.body);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete webhook
router.delete('/webhooks/:id', async (req: Request, res: Response) => {
  try {
    await webhookService.deleteWebhook(Number(req.params.id));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get webhook deliveries
router.get('/webhooks/:id/deliveries', async (req: Request, res: Response) => {
  try {
    const result = await webhookService.getWebhookDeliveries(Number(req.params.id), req.query);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== Fraud Detection Routes =====

// Check booking fraud
router.post('/fraud/check-booking', async (req: Request, res: Response) => {
  try {
    const { bookingId, userId, metadata } = req.body;
    const alerts = await fraudService.checkBookingFraud(bookingId, userId, metadata);
    res.json({ success: true, data: alerts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check user behavior
router.post('/fraud/check-user/:userId', async (req: Request, res: Response) => {
  try {
    const riskScore = await fraudService.checkUserBehavior(Number(req.params.userId));
    res.json({ success: true, data: { riskScore } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get fraud alerts
router.get('/fraud/alerts', async (req: Request, res: Response) => {
  try {
    const result = await fraudService.getAlerts(req.query);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update alert status
router.put('/fraud/alerts/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    await fraudService.updateAlertStatus(Number(req.params.id), status);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Block/Unblock user
router.post('/fraud/block-user', async (req: Request, res: Response) => {
  try {
    const { userId, reason } = req.body;
    await fraudService.blockUser(userId, reason);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/fraud/unblock-user/:userId', async (req: Request, res: Response) => {
  try {
    await fraudService.unblockUser(Number(req.params.userId));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== Workload Balancing Routes =====

// Get cleaner capacity
router.get('/workload/capacity/:cleanerId', async (req: Request, res: Response) => {
  try {
    const capacity = await workloadService.getCleanerCapacity(Number(req.params.cleanerId));
    res.json({ success: true, data: capacity });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check if cleaner can accept booking
router.get('/workload/can-accept/:cleanerId', async (req: Request, res: Response) => {
  try {
    const result = await workloadService.canAcceptBooking(Number(req.params.cleanerId));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Find available cleaners
router.post('/workload/find-available', async (req: Request, res: Response) => {
  try {
    const { cityId, latitude, longitude, requiredDuration } = req.body;
    const cleaners = await workloadService.findAvailableCleaners(
      cityId,
      { latitude, longitude },
      requiredDuration
    );
    res.json({ success: true, data: cleaners });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Balance workload
router.post('/workload/balance', async (req: Request, res: Response) => {
  try {
    const { bookingId, candidateCleaners } = req.body;
    const cleanerId = await workloadService.balanceWorkload(bookingId, candidateCleaners);
    res.json({ success: true, data: { cleanerId } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get workload statistics
router.get('/workload/stats', async (req: Request, res: Response) => {
  try {
    const { cityId } = req.query;
    const stats = await workloadService.getWorkloadStats(cityId ? Number(cityId) : undefined);
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== Analytics Routes =====

// Track event
router.post('/analytics/track', async (req: Request, res: Response) => {
  try {
    const eventId = await analyticsService.trackEvent(req.body);
    res.json({ success: true, data: { id: eventId } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get demand heatmap
router.get('/analytics/heatmap', async (req: Request, res: Response) => {
  try {
    const { cityId, days } = req.query;
    const heatmap = await analyticsService.getDemandHeatmap(
      cityId ? Number(cityId) : undefined,
      days ? Number(days) : 7
    );
    res.json({ success: true, data: heatmap });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get conversion funnel
router.get('/analytics/conversion-funnel', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const funnel = await analyticsService.getConversionFunnel(
      new Date(startDate as string),
      new Date(endDate as string)
    );
    res.json({ success: true, data: funnel });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get revenue analytics
router.get('/analytics/revenue', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, groupBy } = req.query;
    const revenue = await analyticsService.getRevenueAnalytics(
      new Date(startDate as string),
      new Date(endDate as string),
      (groupBy as any) || 'day'
    );
    res.json({ success: true, data: revenue });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get service popularity
router.get('/analytics/service-popularity', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const popularity = await analyticsService.getServicePopularity(
      new Date(startDate as string),
      new Date(endDate as string)
    );
    res.json({ success: true, data: popularity });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get cleaner performance
router.get('/analytics/cleaner-performance/:cleanerId', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const performance = await analyticsService.getCleanerPerformance(
      Number(req.params.cleanerId),
      days ? Number(days) : 30
    );
    res.json({ success: true, data: performance });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get peak hours
router.get('/analytics/peak-hours', async (req: Request, res: Response) => {
  try {
    const { cityId, days } = req.query;
    const peakHours = await analyticsService.getPeakHours(
      cityId ? Number(cityId) : undefined,
      days ? Number(days) : 30
    );
    res.json({ success: true, data: peakHours });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get geographic distribution
router.get('/analytics/geographic', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const distribution = await analyticsService.getGeographicDistribution(
      days ? Number(days) : 30
    );
    res.json({ success: true, data: distribution });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
