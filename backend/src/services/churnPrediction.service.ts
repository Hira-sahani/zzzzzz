import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface ChurnPrediction {
  customerId: number;
  churnProbability: number;
  churnRisk: 'low' | 'medium' | 'high' | 'critical';
  predictedChurnDate?: Date;
  factors: ChurnFactor[];
  retentionActions: string[];
  confidenceScore: number;
}

export interface ChurnFactor {
  factor: string;
  impact: number;
  value: any;
  trend: 'positive' | 'negative' | 'neutral';
}

export class ChurnPredictionService {
  /**
   * Predict churn for a customer
   */
  async predictChurn(customerId: number): Promise<ChurnPrediction> {
    const factors: ChurnFactor[] = [];
    let churnScore = 0;
    let confidenceScore = 0;

    // Factor 1: Recency (weight: 30%)
    const recencySql = `
      SELECT
        DATEDIFF(NOW(), MAX(created_at)) as daysSinceLastBooking,
        COUNT(*) as totalBookings
      FROM bookings
      WHERE customer_id = ?
        AND status IN ('completed', 'in_progress')
    `;

    const recency = await query(recencySql, [customerId]) as RowDataPacket[];
    const daysSinceLastBooking = recency[0].daysSinceLastBooking || 999;
    const totalBookings = recency[0].totalBookings || 0;

    let recencyScore = 0;
    if (daysSinceLastBooking > 90) recencyScore = 100;
    else if (daysSinceLastBooking > 60) recencyScore = 70;
    else if (daysSinceLastBooking > 30) recencyScore = 40;
    else if (daysSinceLastBooking > 14) recencyScore = 20;
    else recencyScore = 0;

    churnScore += recencyScore * 0.3;
    confidenceScore += 25;

    factors.push({
      factor: 'recency',
      impact: recencyScore * 0.3,
      value: daysSinceLastBooking,
      trend: daysSinceLastBooking > 30 ? 'negative' : 'positive'
    });

    // Factor 2: Frequency trend (weight: 25%)
    const frequencySql = `
      SELECT
        DATE(created_at) as bookingDate,
        COUNT(*) as bookingsOnDate
      FROM bookings
      WHERE customer_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL 180 DAY)
        AND status IN ('completed', 'in_progress')
      GROUP BY DATE(created_at)
      ORDER BY bookingDate ASC
    `;

    const frequency = await query(frequencySql, [customerId]) as RowDataPacket[];

    let frequencyScore = 0;
    if (frequency.length === 0) {
      frequencyScore = 100;
    } else {
      // Calculate if frequency is increasing or decreasing
      const recentBookings = frequency.filter(f =>
        new Date(f.bookingDate) > new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
      ).length;
      const olderBookings = frequency.filter(f =>
        new Date(f.bookingDate) <= new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
      ).length;

      if (recentBookings === 0 && olderBookings > 0) {
        frequencyScore = 100;
      } else if (recentBookings < olderBookings / 2) {
        frequencyScore = 70;
      } else if (recentBookings < olderBookings) {
        frequencyScore = 40;
      } else {
        frequencyScore = 10;
      }
    }

    churnScore += frequencyScore * 0.25;
    confidenceScore += 20;

    factors.push({
      factor: 'frequency_trend',
      impact: frequencyScore * 0.25,
      value: frequency.length,
      trend: frequencyScore > 50 ? 'negative' : 'positive'
    });

    // Factor 3: Monetary value trend (weight: 20%)
    const monetarySql = `
      SELECT
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 60 DAY) THEN total_amount ELSE 0 END) as recentSpend,
        SUM(CASE WHEN created_at < DATE_SUB(NOW(), INTERVAL 60 DAY) AND created_at >= DATE_SUB(NOW(), INTERVAL 120 DAY) THEN total_amount ELSE 0 END) as previousSpend,
        SUM(total_amount) as lifetimeValue
      FROM bookings
      WHERE customer_id = ?
        AND status = 'completed'
    `;

    const monetary = await query(monetarySql, [customerId]) as RowDataPacket[];
    const recentSpend = parseFloat(monetary[0].recentSpend || 0);
    const previousSpend = parseFloat(monetary[0].previousSpend || 0);
    const lifetimeValue = parseFloat(monetary[0].lifetimeValue || 0);

    let monetaryScore = 0;
    if (recentSpend === 0 && previousSpend > 0) {
      monetaryScore = 100;
    } else if (recentSpend < previousSpend * 0.5) {
      monetaryScore = 70;
    } else if (recentSpend < previousSpend) {
      monetaryScore = 40;
    } else {
      monetaryScore = 10;
    }

    churnScore += monetaryScore * 0.2;
    confidenceScore += 20;

    factors.push({
      factor: 'spending_trend',
      impact: monetaryScore * 0.2,
      value: recentSpend,
      trend: monetaryScore > 50 ? 'negative' : 'positive'
    });

    // Factor 4: Satisfaction score (weight: 15%)
    const satisfactionSql = `
      SELECT
        AVG(quality_rating) as avgRating,
        COUNT(*) as ratingCount
      FROM ratings
      WHERE rater_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    `;

    const satisfaction = await query(satisfactionSql, [customerId]) as RowDataPacket[];
    const avgRating = parseFloat(satisfaction[0].avgRating || 5);
    const ratingCount = satisfaction[0].ratingCount || 0;

    let satisfactionScore = 0;
    if (ratingCount === 0) {
      satisfactionScore = 30; // No feedback is slightly concerning
    } else if (avgRating < 3) {
      satisfactionScore = 100;
    } else if (avgRating < 3.5) {
      satisfactionScore = 70;
    } else if (avgRating < 4) {
      satisfactionScore = 40;
    } else {
      satisfactionScore = 10;
    }

    churnScore += satisfactionScore * 0.15;
    confidenceScore += 15;

    factors.push({
      factor: 'satisfaction',
      impact: satisfactionScore * 0.15,
      value: avgRating,
      trend: avgRating < 4 ? 'negative' : 'positive'
    });

    // Factor 5: Engagement (weight: 10%)
    const engagementSql = `
      SELECT
        COUNT(*) as cancelledBookings,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancellations
      FROM bookings
      WHERE customer_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    `;

    const engagement = await query(engagementSql, [customerId]) as RowDataPacket[];
    const cancellations = engagement[0].cancellations || 0;
    const recentBookings = engagement[0].cancelledBookings || 0;

    let engagementScore = 0;
    const cancellationRate = recentBookings > 0 ? cancellations / recentBookings : 0;

    if (cancellationRate > 0.5) {
      engagementScore = 100;
    } else if (cancellationRate > 0.3) {
      engagementScore = 70;
    } else if (cancellationRate > 0.1) {
      engagementScore = 30;
    } else {
      engagementScore = 0;
    }

    churnScore += engagementScore * 0.1;
    confidenceScore += 10;

    factors.push({
      factor: 'engagement',
      impact: engagementScore * 0.1,
      value: cancellationRate,
      trend: cancellationRate > 0.2 ? 'negative' : 'positive'
    });

    // Normalize churn score to 0-100
    const churnProbability = Math.min(Math.max(churnScore, 0), 100);

    // Determine risk level
    let churnRisk: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (churnProbability >= 75) churnRisk = 'critical';
    else if (churnProbability >= 50) churnRisk = 'high';
    else if (churnProbability >= 30) churnRisk = 'medium';

    // Predict churn date
    let predictedChurnDate: Date | undefined;
    if (daysSinceLastBooking > 0 && totalBookings > 0) {
      const avgFrequency = 180 / totalBookings; // Rough estimate
      const daysUntilChurn = Math.max(0, (avgFrequency * 2) - daysSinceLastBooking);
      predictedChurnDate = new Date(Date.now() + daysUntilChurn * 24 * 60 * 60 * 1000);
    }

    // Generate retention actions
    const retentionActions = this.generateRetentionActions(
      churnProbability,
      factors,
      lifetimeValue
    );

    return {
      customerId,
      churnProbability: Math.round(churnProbability * 100) / 100,
      churnRisk,
      predictedChurnDate,
      factors,
      retentionActions,
      confidenceScore
    };
  }

  /**
   * Generate retention actions based on churn factors
   */
  private generateRetentionActions(
    churnProbability: number,
    factors: ChurnFactor[],
    lifetimeValue: number
  ): string[] {
    const actions: string[] = [];

    // High-value customer retention
    if (lifetimeValue > 1000 && churnProbability > 50) {
      actions.push('Assign dedicated account manager');
      actions.push('Offer VIP loyalty program enrollment');
    }

    // Recency-based actions
    const recencyFactor = factors.find(f => f.factor === 'recency');
    if (recencyFactor && recencyFactor.value > 30) {
      actions.push('Send personalized "We miss you" email with 20% discount');
      actions.push('Offer free add-on service for next booking');
    }

    // Satisfaction-based actions
    const satisfactionFactor = factors.find(f => f.factor === 'satisfaction');
    if (satisfactionFactor && satisfactionFactor.value < 4) {
      actions.push('Call customer to address satisfaction concerns');
      actions.push('Offer complimentary service recovery');
    }

    // Frequency-based actions
    const frequencyFactor = factors.find(f => f.factor === 'frequency_trend');
    if (frequencyFactor && frequencyFactor.trend === 'negative') {
      actions.push('Introduce subscription plan with discount');
      actions.push('Send re-engagement campaign with new services');
    }

    // Spending-based actions
    const monetaryFactor = factors.find(f => f.factor === 'spending_trend');
    if (monetaryFactor && monetaryFactor.trend === 'negative') {
      actions.push('Offer budget-friendly service packages');
      actions.push('Introduce referral rewards program');
    }

    // High churn risk default actions
    if (churnProbability > 70 && actions.length === 0) {
      actions.push('Urgent: Personal outreach from customer success team');
      actions.push('Offer exclusive loyalty discount (25% off)');
    }

    return actions;
  }

  /**
   * Batch predict churn for all active customers
   */
  async batchPredictChurn(minLifetimeValue: number = 0): Promise<{
    analyzed: number;
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
  }> {
    // Get active customers
    const sql = `
      SELECT DISTINCT customer_id
      FROM bookings
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 180 DAY)
      HAVING SUM(total_amount) >= ?
    `;

    const customers = await query(sql, [minLifetimeValue]) as RowDataPacket[];

    let highRisk = 0;
    let mediumRisk = 0;
    let lowRisk = 0;

    for (const customer of customers) {
      try {
        const prediction = await this.predictChurn(customer.customer_id);

        // Store prediction
        await this.storePrediction(prediction);

        // Count by risk
        if (prediction.churnRisk === 'critical' || prediction.churnRisk === 'high') {
          highRisk++;
        } else if (prediction.churnRisk === 'medium') {
          mediumRisk++;
        } else {
          lowRisk++;
        }
      } catch (error) {
        console.error(`Failed to predict churn for customer ${customer.customer_id}:`, error);
      }
    }

    return {
      analyzed: customers.length,
      highRisk,
      mediumRisk,
      lowRisk
    };
  }

  /**
   * Store churn prediction
   */
  private async storePrediction(prediction: ChurnPrediction): Promise<void> {
    // Check if prediction exists
    const existingSql = `
      SELECT id FROM churn_predictions WHERE customer_id = ?
    `;

    const existing = await query(existingSql, [prediction.customerId]) as RowDataPacket[];

    if (existing.length > 0) {
      // Update existing
      await query(
        `UPDATE churn_predictions
         SET churn_probability = ?,
             churn_risk = ?,
             predicted_churn_date = ?,
             factors = ?,
             retention_actions = ?,
             confidence_score = ?,
             updated_at = NOW()
         WHERE customer_id = ?`,
        [
          prediction.churnProbability,
          prediction.churnRisk,
          prediction.predictedChurnDate || null,
          JSON.stringify(prediction.factors),
          JSON.stringify(prediction.retentionActions),
          prediction.confidenceScore,
          prediction.customerId
        ]
      );
    } else {
      // Insert new
      await query(
        `INSERT INTO churn_predictions (
          customer_id, churn_probability, churn_risk, predicted_churn_date,
          factors, retention_actions, confidence_score, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          prediction.customerId,
          prediction.churnProbability,
          prediction.churnRisk,
          prediction.predictedChurnDate || null,
          JSON.stringify(prediction.factors),
          JSON.stringify(prediction.retentionActions),
          prediction.confidenceScore
        ]
      );
    }
  }

  /**
   * Get high-risk customers
   */
  async getHighRiskCustomers(limit: number = 50): Promise<any[]> {
    const sql = `
      SELECT
        cp.customer_id as customerId,
        cp.churn_probability as churnProbability,
        cp.churn_risk as churnRisk,
        cp.predicted_churn_date as predictedChurnDate,
        cp.retention_actions as retentionActions,
        u.name,
        u.email,
        u.phone,
        u.total_bookings as totalBookings,
        SUM(b.total_amount) as lifetimeValue
      FROM churn_predictions cp
      INNER JOIN users u ON u.id = cp.customer_id
      LEFT JOIN bookings b ON b.customer_id = cp.customer_id AND b.status = 'completed'
      WHERE cp.churn_risk IN ('high', 'critical')
      GROUP BY cp.customer_id, cp.churn_probability, cp.churn_risk,
               cp.predicted_churn_date, cp.retention_actions, u.name, u.email, u.phone, u.total_bookings
      ORDER BY cp.churn_probability DESC, lifetimeValue DESC
      LIMIT ?
    `;

    const customers = await query(sql, [limit]) as RowDataPacket[];

    return customers.map(c => ({
      ...c,
      retentionActions: JSON.parse(c.retentionActions),
      lifetimeValue: parseFloat(c.lifetimeValue || 0)
    }));
  }

  /**
   * Get churn prediction statistics
   */
  async getChurnStats(): Promise<{
    totalPredictions: number;
    byRisk: { [risk: string]: number };
    avgChurnProbability: number;
    predictedChurnsNext30Days: number;
    highValueAtRisk: number;
  }> {
    const sql = `
      SELECT
        COUNT(*) as totalPredictions,
        AVG(churn_probability) as avgChurnProbability,
        SUM(CASE WHEN predicted_churn_date IS NOT NULL
                 AND predicted_churn_date <= DATE_ADD(NOW(), INTERVAL 30 DAY)
            THEN 1 ELSE 0 END) as predictedChurnsNext30Days
      FROM churn_predictions
    `;

    const stats = await query(sql) as RowDataPacket[];

    // By risk
    const riskSql = `
      SELECT churn_risk, COUNT(*) as count
      FROM churn_predictions
      GROUP BY churn_risk
    `;
    const risks = await query(riskSql) as RowDataPacket[];
    const byRisk: any = {};
    risks.forEach(r => { byRisk[r.churn_risk] = r.count; });

    // High value at risk
    const highValueSql = `
      SELECT COUNT(DISTINCT cp.customer_id) as highValueAtRisk
      FROM churn_predictions cp
      INNER JOIN bookings b ON b.customer_id = cp.customer_id
      WHERE cp.churn_risk IN ('high', 'critical')
      GROUP BY cp.customer_id
      HAVING SUM(b.total_amount) > 1000
    `;
    const highValue = await query(highValueSql) as RowDataPacket[];

    return {
      totalPredictions: stats[0].totalPredictions || 0,
      byRisk,
      avgChurnProbability: parseFloat(stats[0].avgChurnProbability || 0),
      predictedChurnsNext30Days: stats[0].predictedChurnsNext30Days || 0,
      highValueAtRisk: highValue.length
    };
  }

  /**
   * Track prediction accuracy
   */
  async trackPredictionAccuracy(days: number = 30): Promise<{
    totalPredictions: number;
    actualChurns: number;
    truePositives: number;
    falsePositives: number;
    trueNegatives: number;
    falseNegatives: number;
    accuracy: number;
    precision: number;
    recall: number;
  }> {
    // Get predictions made X days ago
    const sql = `
      SELECT
        cp.customer_id,
        cp.churn_risk,
        cp.churn_probability,
        CASE WHEN b.customer_id IS NULL THEN 1 ELSE 0 END as actuallyChurned
      FROM churn_predictions cp
      LEFT JOIN bookings b ON b.customer_id = cp.customer_id
        AND b.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      WHERE cp.created_at <= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND cp.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const predictions = await query(sql, [days, days, days + 7]) as RowDataPacket[];

    let truePositives = 0;
    let falsePositives = 0;
    let trueNegatives = 0;
    let falseNegatives = 0;
    let actualChurns = 0;

    predictions.forEach(p => {
      const predictedChurn = ['high', 'critical'].includes(p.churn_risk);
      const actualChurn = p.actuallyChurned === 1;

      if (actualChurn) actualChurns++;

      if (predictedChurn && actualChurn) truePositives++;
      else if (predictedChurn && !actualChurn) falsePositives++;
      else if (!predictedChurn && !actualChurn) trueNegatives++;
      else if (!predictedChurn && actualChurn) falseNegatives++;
    });

    const total = predictions.length;
    const accuracy = total > 0 ? ((truePositives + trueNegatives) / total) * 100 : 0;
    const precision = (truePositives + falsePositives) > 0
      ? (truePositives / (truePositives + falsePositives)) * 100
      : 0;
    const recall = (truePositives + falseNegatives) > 0
      ? (truePositives / (truePositives + falseNegatives)) * 100
      : 0;

    return {
      totalPredictions: total,
      actualChurns,
      truePositives,
      falsePositives,
      trueNegatives,
      falseNegatives,
      accuracy: Math.round(accuracy * 100) / 100,
      precision: Math.round(precision * 100) / 100,
      recall: Math.round(recall * 100) / 100
    };
  }

  /**
   * Execute retention action
   */
  async executeRetentionAction(
    customerId: number,
    action: string,
    executedBy: number
  ): Promise<void> {
    const sql = `
      INSERT INTO retention_actions (
        customer_id, action, executed_by, executed_at
      ) VALUES (?, ?, ?, NOW())
    `;

    await query(sql, [customerId, action, executedBy]);

    // Update customer record
    await query(
      'UPDATE churn_predictions SET last_retention_action = ?, last_retention_action_at = NOW() WHERE customer_id = ?',
      [action, customerId]
    );
  }
}

export default new ChurnPredictionService();
