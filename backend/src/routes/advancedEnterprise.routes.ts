import express, { Request, Response } from 'express';
import routeOptimizationService from '../services/routeOptimization.service';
import repeatCustomerService from '../services/repeatCustomer.service';
import subscriptionService from '../services/subscription.service';
import abandonedBookingService from '../services/abandonedBooking.service';
import promoBurnRateService from '../services/promoBurnRate.service';
import shiftSwapService from '../services/shiftSwap.service';
import escalationService from '../services/escalation.service';
import autoCompensationService from '../services/autoCompensation.service';
import toxicCustomerService from '../services/toxicCustomer.service';
import churnPredictionService from '../services/churnPrediction.service';

const router = express.Router();

// ============================================
// 1. ROUTE OPTIMIZATION ENDPOINTS
// ============================================

// Optimize route for a cleaner
router.post('/route-optimization/optimize', async (req: Request, res: Response) => {
  try {
    const { cleanerId, bookingIds, startLocation } = req.body;

    if (!cleanerId || !bookingIds || !Array.isArray(bookingIds)) {
      return res.status(400).json({
        success: false,
        error: 'cleanerId and bookingIds array are required'
      });
    }

    const result = await routeOptimizationService.optimizeRoute(
      cleanerId,
      bookingIds,
      startLocation
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Optimize routes for all cleaners
router.post('/route-optimization/batch', async (req: Request, res: Response) => {
  try {
    const { date } = req.body;
    const targetDate = date ? new Date(date) : new Date();

    const result = await routeOptimizationService.optimizeAllCleanerRoutes(targetDate);

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Track route deviation
router.post('/route-optimization/deviation', async (req: Request, res: Response) => {
  try {
    const { routeId, bookingId, actualArrival, reason } = req.body;

    const result = await routeOptimizationService.trackRouteDeviation(
      routeId,
      bookingId,
      new Date(actualArrival),
      reason
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get route optimization statistics
router.get('/route-optimization/stats/:cleanerId?', async (req: Request, res: Response) => {
  try {
    const { cleanerId } = req.params;
    const { days } = req.query;

    const result = await routeOptimizationService.getOptimizationStats(
      cleanerId ? parseInt(cleanerId) : undefined,
      days ? parseInt(days as string) : undefined
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 2. REPEAT CUSTOMER ENDPOINTS
// ============================================

// Get customer profile
router.get('/customers/:customerId/profile', async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;

    const profile = await repeatCustomerService.getCustomerProfile(parseInt(customerId));

    res.json({ success: true, data: profile });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Segment all customers
router.get('/customers/segments', async (req: Request, res: Response) => {
  try {
    const segments = await repeatCustomerService.segmentCustomers();

    res.json({ success: true, data: segments });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get at-risk customers
router.get('/customers/at-risk', async (req: Request, res: Response) => {
  try {
    const { threshold } = req.query;

    const customers = await repeatCustomerService.getAtRiskCustomers(
      threshold ? parseInt(threshold as string) : undefined
    );

    res.json({ success: true, data: customers });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Match preferred cleaner
router.get('/customers/:customerId/preferred-cleaner', async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const { serviceType, date, timeSlot } = req.query;

    const match = await repeatCustomerService.matchPreferredCleaner(
      parseInt(customerId),
      serviceType as string,
      date ? new Date(date as string) : undefined,
      timeSlot as string
    );

    res.json({ success: true, data: match });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send personalized reminder
router.post('/customers/:customerId/reminder', async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const { reminderType } = req.body;

    const result = await repeatCustomerService.sendPersonalizedReminder(
      parseInt(customerId),
      reminderType
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get retention statistics
router.get('/customers/retention/stats', async (req: Request, res: Response) => {
  try {
    const { months } = req.query;

    const stats = await repeatCustomerService.getRetentionStats(
      months ? parseInt(months as string) : undefined
    );

    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 3. SUBSCRIPTION ENDPOINTS
// ============================================

// Create subscription
router.post('/subscriptions', async (req: Request, res: Response) => {
  try {
    const subscriptionData = req.body;

    const subscriptionId = await subscriptionService.createSubscription(subscriptionData);

    res.json({ success: true, data: { subscriptionId } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Process auto-renewals
router.post('/subscriptions/auto-renew', async (req: Request, res: Response) => {
  try {
    const result = await subscriptionService.processAutoRenewals();

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Renew specific subscription
router.post('/subscriptions/:subscriptionId/renew', async (req: Request, res: Response) => {
  try {
    const { subscriptionId } = req.params;
    const { paymentMethodId } = req.body;

    const result = await subscriptionService.renewSubscription(
      parseInt(subscriptionId),
      paymentMethodId
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Pause subscription
router.post('/subscriptions/:subscriptionId/pause', async (req: Request, res: Response) => {
  try {
    const { subscriptionId } = req.params;
    const { reason } = req.body;

    await subscriptionService.pauseSubscription(parseInt(subscriptionId), reason);

    res.json({ success: true, message: 'Subscription paused successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Resume subscription
router.post('/subscriptions/:subscriptionId/resume', async (req: Request, res: Response) => {
  try {
    const { subscriptionId } = req.params;

    await subscriptionService.resumeSubscription(parseInt(subscriptionId));

    res.json({ success: true, message: 'Subscription resumed successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cancel subscription
router.post('/subscriptions/:subscriptionId/cancel', async (req: Request, res: Response) => {
  try {
    const { subscriptionId } = req.params;
    const { reason } = req.body;

    await subscriptionService.cancelSubscription(parseInt(subscriptionId), reason);

    res.json({ success: true, message: 'Subscription cancelled successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Track subscription usage
router.post('/subscriptions/:subscriptionId/usage', async (req: Request, res: Response) => {
  try {
    const { subscriptionId } = req.params;
    const { bookingId } = req.body;

    await subscriptionService.trackSubscriptionUsage(
      parseInt(subscriptionId),
      parseInt(bookingId)
    );

    res.json({ success: true, message: 'Usage tracked successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get subscription statistics
router.get('/subscriptions/stats', async (req: Request, res: Response) => {
  try {
    const stats = await subscriptionService.getSubscriptionStats();

    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 4. ABANDONED BOOKING ENDPOINTS
// ============================================

// Track abandoned booking
router.post('/abandoned-bookings', async (req: Request, res: Response) => {
  try {
    const abandonedData = req.body;

    const abandonedId = await abandonedBookingService.trackAbandonedBooking(abandonedData);

    res.json({ success: true, data: { abandonedId } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get abandoned bookings for recovery
router.get('/abandoned-bookings/recovery', async (req: Request, res: Response) => {
  try {
    const { hours } = req.query;

    const bookings = await abandonedBookingService.getAbandonedForRecovery(
      hours ? parseInt(hours as string) : undefined
    );

    res.json({ success: true, data: bookings });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send recovery message
router.post('/abandoned-bookings/:abandonedId/recover', async (req: Request, res: Response) => {
  try {
    const { abandonedId } = req.params;
    const { channel } = req.body;

    const result = await abandonedBookingService.sendRecoveryMessage(
      parseInt(abandonedId),
      channel
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mark as recovered
router.post('/abandoned-bookings/:abandonedId/mark-recovered', async (req: Request, res: Response) => {
  try {
    const { abandonedId } = req.params;
    const { bookingId } = req.body;

    await abandonedBookingService.markAsRecovered(
      parseInt(abandonedId),
      parseInt(bookingId)
    );

    res.json({ success: true, message: 'Marked as recovered' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create personalized incentive
router.post('/abandoned-bookings/:customerId/incentive', async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;

    const incentive = await abandonedBookingService.createPersonalizedIncentive(
      parseInt(customerId)
    );

    res.json({ success: true, data: incentive });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get recovery statistics
router.get('/abandoned-bookings/stats', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;

    const stats = await abandonedBookingService.getRecoveryStats(
      days ? parseInt(days as string) : undefined
    );

    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch process recovery
router.post('/abandoned-bookings/batch-recovery', async (req: Request, res: Response) => {
  try {
    const { hours, maxAttempts } = req.body;

    const result = await abandonedBookingService.batchProcessRecovery(hours, maxAttempts);

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 5. PROMO BURN RATE ENDPOINTS
// ============================================

// Calculate burn rate
router.get('/promos/:couponCode/burn-rate', async (req: Request, res: Response) => {
  try {
    const { couponCode } = req.params;

    const burnRate = await promoBurnRateService.calculateBurnRate(couponCode);

    res.json({ success: true, data: burnRate });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get at-risk promos
router.get('/promos/at-risk', async (req: Request, res: Response) => {
  try {
    const { threshold } = req.query;

    const promos = await promoBurnRateService.getPromosAtRisk(
      threshold ? parseFloat(threshold as string) : undefined
    );

    res.json({ success: true, data: promos });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get daily burn trend
router.get('/promos/:couponCode/trend', async (req: Request, res: Response) => {
  try {
    const { couponCode } = req.params;
    const { days } = req.query;

    const trend = await promoBurnRateService.getDailyBurnTrend(
      couponCode,
      days ? parseInt(days as string) : undefined
    );

    res.json({ success: true, data: trend });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Recommend budget adjustment
router.get('/promos/:couponCode/recommend-budget', async (req: Request, res: Response) => {
  try {
    const { couponCode } = req.params;

    const recommendation = await promoBurnRateService.recommendBudgetAdjustment(couponCode);

    res.json({ success: true, data: recommendation });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get low performers
router.get('/promos/low-performers', async (req: Request, res: Response) => {
  try {
    const { efficiencyThreshold } = req.query;

    const lowPerformers = await promoBurnRateService.getLowPerformers(
      efficiencyThreshold ? parseFloat(efficiencyThreshold as string) : undefined
    );

    res.json({ success: true, data: lowPerformers });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch track burn rates
router.post('/promos/batch-track', async (req: Request, res: Response) => {
  try {
    const result = await promoBurnRateService.batchTrackBurnRates();

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 6. SHIFT SWAP ENDPOINTS
// ============================================

// Create swap request
router.post('/shift-swaps', async (req: Request, res: Response) => {
  try {
    const swapData = req.body;

    const swapRequestId = await shiftSwapService.createSwapRequest(swapData);

    res.json({ success: true, data: { swapRequestId } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Accept swap request
router.post('/shift-swaps/:swapRequestId/accept', async (req: Request, res: Response) => {
  try {
    const { swapRequestId } = req.params;
    const { cleanerId } = req.body;

    await shiftSwapService.acceptSwapRequest(
      parseInt(swapRequestId),
      parseInt(cleanerId)
    );

    res.json({ success: true, message: 'Swap request accepted' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Decline swap request
router.post('/shift-swaps/:swapRequestId/decline', async (req: Request, res: Response) => {
  try {
    const { swapRequestId } = req.params;
    const { cleanerId } = req.body;

    await shiftSwapService.declineSwapRequest(
      parseInt(swapRequestId),
      parseInt(cleanerId)
    );

    res.json({ success: true, message: 'Swap request declined' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cancel swap request
router.post('/shift-swaps/:swapRequestId/cancel', async (req: Request, res: Response) => {
  try {
    const { swapRequestId } = req.params;

    await shiftSwapService.cancelSwapRequest(parseInt(swapRequestId));

    res.json({ success: true, message: 'Swap request cancelled' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get pending swap requests for cleaner
router.get('/shift-swaps/cleaner/:cleanerId/pending', async (req: Request, res: Response) => {
  try {
    const { cleanerId } = req.params;

    const requests = await shiftSwapService.getPendingSwapRequests(parseInt(cleanerId));

    res.json({ success: true, data: requests });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get swap statistics
router.get('/shift-swaps/stats', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;

    const stats = await shiftSwapService.getSwapStats(
      days ? parseInt(days as string) : undefined
    );

    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 7. ESCALATION ENDPOINTS
// ============================================

// Create escalation
router.post('/escalations', async (req: Request, res: Response) => {
  try {
    const escalationData = req.body;

    const escalationId = await escalationService.createEscalation(escalationData);

    res.json({ success: true, data: { escalationId } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Escalate to next level
router.post('/escalations/:escalationId/escalate', async (req: Request, res: Response) => {
  try {
    const { escalationId } = req.params;
    const { reason } = req.body;

    await escalationService.escalateToNextLevel(parseInt(escalationId), reason);

    res.json({ success: true, message: 'Escalated to next level' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Resolve escalation
router.post('/escalations/:escalationId/resolve', async (req: Request, res: Response) => {
  try {
    const { escalationId } = req.params;
    const { resolutionNotes } = req.body;

    await escalationService.resolveEscalation(parseInt(escalationId), resolutionNotes);

    res.json({ success: true, message: 'Escalation resolved' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get escalations for agent
router.get('/escalations/agent/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { status } = req.query;

    const escalations = await escalationService.getEscalationsForAgent(
      parseInt(agentId),
      status as string
    );

    res.json({ success: true, data: escalations });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Process auto-escalations
router.post('/escalations/auto-escalate', async (req: Request, res: Response) => {
  try {
    const result = await escalationService.processAutoEscalations();

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get escalation statistics
router.get('/escalations/stats', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;

    const stats = await escalationService.getEscalationStats(
      days ? parseInt(days as string) : undefined
    );

    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 8. AUTO-COMPENSATION ENDPOINTS
// ============================================

// Check and compensate for booking
router.post('/compensations/check/:bookingId', async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const compensations = await autoCompensationService.checkAndCompensate(
      parseInt(bookingId)
    );

    res.json({ success: true, data: compensations });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Process compensation
router.post('/compensations/:compensationId/process', async (req: Request, res: Response) => {
  try {
    const { compensationId } = req.params;

    await autoCompensationService.processCompensation(parseInt(compensationId));

    res.json({ success: true, message: 'Compensation processed' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Approve compensation
router.post('/compensations/:compensationId/approve', async (req: Request, res: Response) => {
  try {
    const { compensationId } = req.params;
    const { approvedBy } = req.body;

    await autoCompensationService.approveCompensation(
      parseInt(compensationId),
      parseInt(approvedBy)
    );

    res.json({ success: true, message: 'Compensation approved' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reject compensation
router.post('/compensations/:compensationId/reject', async (req: Request, res: Response) => {
  try {
    const { compensationId } = req.params;
    const { approvedBy, reason } = req.body;

    await autoCompensationService.rejectCompensation(
      parseInt(compensationId),
      parseInt(approvedBy),
      reason
    );

    res.json({ success: true, message: 'Compensation rejected' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get pending compensations
router.get('/compensations/pending', async (req: Request, res: Response) => {
  try {
    const compensations = await autoCompensationService.getPendingCompensations();

    res.json({ success: true, data: compensations });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch process compensations
router.post('/compensations/batch-process', async (req: Request, res: Response) => {
  try {
    const { days } = req.body;

    const result = await autoCompensationService.batchProcessCompensations(days);

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get compensation statistics
router.get('/compensations/stats', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;

    const stats = await autoCompensationService.getCompensationStats(
      days ? parseInt(days as string) : undefined
    );

    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 9. TOXIC CUSTOMER ENDPOINTS
// ============================================

// Analyze customer
router.post('/toxic-customers/analyze/:customerId', async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;

    const analysis = await toxicCustomerService.analyzeCustomer(parseInt(customerId));

    res.json({ success: true, data: analysis });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get flagged customers
router.get('/toxic-customers/flagged', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;

    const customers = await toxicCustomerService.getFlaggedCustomers(status as string);

    res.json({ success: true, data: customers });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get protection recommendations
router.get('/toxic-customers/:customerId/protection', async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;

    const recommendations = await toxicCustomerService.getProtectionRecommendations(
      parseInt(customerId)
    );

    res.json({ success: true, data: recommendations });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update flag status
router.post('/toxic-customers/:customerId/update-status', async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const { newStatus, reviewedBy, reviewNotes } = req.body;

    await toxicCustomerService.updateFlagStatus(
      parseInt(customerId),
      newStatus,
      parseInt(reviewedBy),
      reviewNotes
    );

    res.json({ success: true, message: 'Status updated' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch analyze customers
router.post('/toxic-customers/batch-analyze', async (req: Request, res: Response) => {
  try {
    const { threshold } = req.body;

    const result = await toxicCustomerService.batchAnalyzeCustomers(threshold);

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get toxicity statistics
router.get('/toxic-customers/stats', async (req: Request, res: Response) => {
  try {
    const stats = await toxicCustomerService.getToxicityStats();

    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 10. CHURN PREDICTION ENDPOINTS
// ============================================

// Predict churn for customer
router.post('/churn/predict/:customerId', async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;

    const prediction = await churnPredictionService.predictChurn(parseInt(customerId));

    res.json({ success: true, data: prediction });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch predict churn
router.post('/churn/batch-predict', async (req: Request, res: Response) => {
  try {
    const { minLifetimeValue } = req.body;

    const result = await churnPredictionService.batchPredictChurn(minLifetimeValue);

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get high-risk customers
router.get('/churn/high-risk', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;

    const customers = await churnPredictionService.getHighRiskCustomers(
      limit ? parseInt(limit as string) : undefined
    );

    res.json({ success: true, data: customers });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get churn statistics
router.get('/churn/stats', async (req: Request, res: Response) => {
  try {
    const stats = await churnPredictionService.getChurnStats();

    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Track prediction accuracy
router.get('/churn/accuracy', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;

    const accuracy = await churnPredictionService.trackPredictionAccuracy(
      days ? parseInt(days as string) : undefined
    );

    res.json({ success: true, data: accuracy });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Execute retention action
router.post('/churn/:customerId/retention-action', async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const { action, executedBy } = req.body;

    await churnPredictionService.executeRetentionAction(
      parseInt(customerId),
      action,
      parseInt(executedBy)
    );

    res.json({ success: true, message: 'Retention action executed' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
