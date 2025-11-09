import { query } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface Invoice {
  id?: number;
  invoiceNumber: string;
  bookingId: number;
  customerId: number;
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  customerGstin?: string;
  billingAddress: string;
  subtotal: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  totalTax: number;
  totalAmount: number;
  paymentStatus: 'pending' | 'paid' | 'overdue' | 'cancelled';
  paymentMethod?: string;
  dueDate?: Date;
  paidAt?: Date;
  invoiceDate: Date;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export class InvoiceService {
  /**
   * Generate invoice for a booking
   */
  async generateInvoice(bookingId: number): Promise<Invoice> {
    // Get booking details
    const sqlBooking = `
      SELECT
        b.id, b.booking_number, b.customer_id, b.total_amount,
        b.payment_status, b.payment_method, b.completed_at,
        u.name as customerName, u.email as customerEmail, u.phone as customerPhone,
        a.address_line1, a.address_line2, a.city, a.state, a.postal_code
      FROM bookings b
      INNER JOIN users u ON u.id = b.customer_id
      INNER JOIN addresses a ON a.id = b.address_id
      WHERE b.id = ?
    `;

    const bookings = await query(sqlBooking, [bookingId]) as RowDataPacket[];
    if (bookings.length === 0) {
      throw new Error('Booking not found');
    }

    const booking = bookings[0];

    // Get booking services
    const sqlServices = `
      SELECT service_name, service_price, estimated_duration_minutes
      FROM booking_services
      WHERE booking_id = ?
    `;

    const services = await query(sqlServices, [bookingId]) as RowDataPacket[];

    // Generate invoice number
    const invoiceNumber = await this.generateInvoiceNumber();

    // Calculate GST
    const subtotal = booking.total_amount;
    const { cgst, sgst, igst } = this.calculateGST(subtotal, booking.state);

    // Build billing address
    const billingAddress = [
      booking.address_line1,
      booking.address_line2,
      booking.city,
      booking.state,
      booking.postal_code
    ].filter(Boolean).join(', ');

    // Create invoice
    const invoice: Invoice = {
      invoiceNumber,
      bookingId: booking.id,
      customerId: booking.customer_id,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      customerPhone: booking.customerPhone,
      billingAddress,
      subtotal,
      cgstRate: cgst.rate,
      cgstAmount: cgst.amount,
      sgstRate: sgst.rate,
      sgstAmount: sgst.amount,
      igstRate: igst.rate,
      igstAmount: igst.amount,
      totalTax: cgst.amount + sgst.amount + igst.amount,
      totalAmount: subtotal + cgst.amount + sgst.amount + igst.amount,
      paymentStatus: booking.payment_status === 'paid' ? 'paid' : 'pending',
      paymentMethod: booking.payment_method,
      invoiceDate: booking.completed_at || new Date(),
      dueDate: booking.payment_status === 'paid' ? null : this.calculateDueDate()
    };

    // Save invoice to database
    const invoiceId = await this.saveInvoice(invoice);
    invoice.id = invoiceId;

    return invoice;
  }

  /**
   * Generate unique invoice number
   */
  private async generateInvoiceNumber(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    // Get count of invoices this month
    const sql = `
      SELECT COUNT(*) as count
      FROM invoices
      WHERE invoice_number LIKE ?
    `;

    const prefix = `INV-${year}-${month}`;
    const result = await query(sql, [`${prefix}-%`]) as RowDataPacket[];
    const count = result[0].count + 1;

    return `${prefix}-${String(count).padStart(5, '0')}`;
  }

  /**
   * Calculate GST (CGST, SGST, IGST)
   */
  private calculateGST(
    amount: number,
    state: string,
    customerState: string = 'Maharashtra'
  ): {
    cgst: { rate: number; amount: number };
    sgst: { rate: number; amount: number };
    igst: { rate: number; amount: number };
  } {
    const gstRate = 18; // 18% GST for cleaning services

    // If same state: CGST + SGST
    // If different state: IGST
    const isSameState = state === customerState;

    if (isSameState) {
      const cgstRate = gstRate / 2;
      const sgstRate = gstRate / 2;
      const cgstAmount = Math.round((amount * cgstRate / 100) * 100) / 100;
      const sgstAmount = Math.round((amount * sgstRate / 100) * 100) / 100;

      return {
        cgst: { rate: cgstRate, amount: cgstAmount },
        sgst: { rate: sgstRate, amount: sgstAmount },
        igst: { rate: 0, amount: 0 }
      };
    } else {
      const igstAmount = Math.round((amount * gstRate / 100) * 100) / 100;

      return {
        cgst: { rate: 0, amount: 0 },
        sgst: { rate: 0, amount: 0 },
        igst: { rate: gstRate, amount: igstAmount }
      };
    }
  }

  /**
   * Calculate due date (30 days from invoice date)
   */
  private calculateDueDate(): Date {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    return dueDate;
  }

  /**
   * Save invoice to database
   */
  private async saveInvoice(invoice: Invoice): Promise<number> {
    const sql = `
      INSERT INTO invoices (
        invoice_number, booking_id, customer_id,
        customer_name, customer_email, customer_phone, customer_gstin,
        billing_address, subtotal,
        cgst_rate, cgst_amount,
        sgst_rate, sgst_amount,
        igst_rate, igst_amount,
        total_tax, total_amount,
        payment_status, payment_method,
        invoice_date, due_date, paid_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await query(sql, [
      invoice.invoiceNumber,
      invoice.bookingId,
      invoice.customerId,
      invoice.customerName,
      invoice.customerEmail || null,
      invoice.customerPhone,
      invoice.customerGstin || null,
      invoice.billingAddress,
      invoice.subtotal,
      invoice.cgstRate,
      invoice.cgstAmount,
      invoice.sgstRate,
      invoice.sgstAmount,
      invoice.igstRate,
      invoice.igstAmount,
      invoice.totalTax,
      invoice.totalAmount,
      invoice.paymentStatus,
      invoice.paymentMethod || null,
      invoice.invoiceDate,
      invoice.dueDate || null,
      invoice.paidAt || null
    ]) as ResultSetHeader;

    return result.insertId;
  }

  /**
   * Get invoice by ID
   */
  async getInvoiceById(invoiceId: number): Promise<Invoice | null> {
    const sql = `
      SELECT
        id, invoice_number as invoiceNumber, booking_id as bookingId,
        customer_id as customerId, customer_name as customerName,
        customer_email as customerEmail, customer_phone as customerPhone,
        customer_gstin as customerGstin, billing_address as billingAddress,
        subtotal, cgst_rate as cgstRate, cgst_amount as cgstAmount,
        sgst_rate as sgstRate, sgst_amount as sgstAmount,
        igst_rate as igstRate, igst_amount as igstAmount,
        total_tax as totalTax, total_amount as totalAmount,
        payment_status as paymentStatus, payment_method as paymentMethod,
        invoice_date as invoiceDate, due_date as dueDate, paid_at as paidAt
      FROM invoices
      WHERE id = ?
    `;

    const invoices = await query(sql, [invoiceId]) as RowDataPacket[];
    return invoices.length > 0 ? invoices[0] as Invoice : null;
  }

  /**
   * Get invoice by invoice number
   */
  async getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | null> {
    const sql = `
      SELECT
        id, invoice_number as invoiceNumber, booking_id as bookingId,
        customer_id as customerId, customer_name as customerName,
        customer_email as customerEmail, customer_phone as customerPhone,
        customer_gstin as customerGstin, billing_address as billingAddress,
        subtotal, cgst_rate as cgstRate, cgst_amount as cgstAmount,
        sgst_rate as sgstRate, sgst_amount as sgstAmount,
        igst_rate as igstRate, igst_amount as igstAmount,
        total_tax as totalTax, total_amount as totalAmount,
        payment_status as paymentStatus, payment_method as paymentMethod,
        invoice_date as invoiceDate, due_date as dueDate, paid_at as paidAt
      FROM invoices
      WHERE invoice_number = ?
    `;

    const invoices = await query(sql, [invoiceNumber]) as RowDataPacket[];
    return invoices.length > 0 ? invoices[0] as Invoice : null;
  }

  /**
   * Get invoice by booking ID
   */
  async getInvoiceByBookingId(bookingId: number): Promise<Invoice | null> {
    const sql = `
      SELECT
        id, invoice_number as invoiceNumber, booking_id as bookingId,
        customer_id as customerId, customer_name as customerName,
        customer_email as customerEmail, customer_phone as customerPhone,
        customer_gstin as customerGstin, billing_address as billingAddress,
        subtotal, cgst_rate as cgstRate, cgst_amount as cgstAmount,
        sgst_rate as sgstRate, sgst_amount as sgstAmount,
        igst_rate as igstRate, igst_amount as igstAmount,
        total_tax as totalTax, total_amount as totalAmount,
        payment_status as paymentStatus, payment_method as paymentMethod,
        invoice_date as invoiceDate, due_date as dueDate, paid_at as paidAt
      FROM invoices
      WHERE booking_id = ?
    `;

    const invoices = await query(sql, [bookingId]) as RowDataPacket[];
    return invoices.length > 0 ? invoices[0] as Invoice : null;
  }

  /**
   * Update invoice payment status
   */
  async updatePaymentStatus(
    invoiceId: number,
    status: 'pending' | 'paid' | 'overdue' | 'cancelled',
    paidAt?: Date
  ): Promise<void> {
    const sql = `
      UPDATE invoices
      SET payment_status = ?, paid_at = ?
      WHERE id = ?
    `;

    await query(sql, [status, paidAt || null, invoiceId]);
  }

  /**
   * Get customer invoices
   */
  async getCustomerInvoices(customerId: number, filters?: {
    status?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ invoices: Invoice[]; total: number }> {
    let sql = `
      SELECT
        id, invoice_number as invoiceNumber, booking_id as bookingId,
        customer_id as customerId, customer_name as customerName,
        customer_email as customerEmail, customer_phone as customerPhone,
        customer_gstin as customerGstin, billing_address as billingAddress,
        subtotal, cgst_rate as cgstRate, cgst_amount as cgstAmount,
        sgst_rate as sgstRate, sgst_amount as sgstAmount,
        igst_rate as igstRate, igst_amount as igstAmount,
        total_tax as totalTax, total_amount as totalAmount,
        payment_status as paymentStatus, payment_method as paymentMethod,
        invoice_date as invoiceDate, due_date as dueDate, paid_at as paidAt
      FROM invoices
      WHERE customer_id = ?
    `;

    const params: any[] = [customerId];

    if (filters?.status) {
      sql += ` AND payment_status = ?`;
      params.push(filters.status);
    }

    if (filters?.startDate) {
      sql += ` AND invoice_date >= ?`;
      params.push(filters.startDate);
    }

    if (filters?.endDate) {
      sql += ` AND invoice_date <= ?`;
      params.push(filters.endDate);
    }

    // Count total
    const countSql = sql.replace(
      'SELECT id, invoice_number as invoiceNumber, booking_id as bookingId, customer_id as customerId, customer_name as customerName, customer_email as customerEmail, customer_phone as customerPhone, customer_gstin as customerGstin, billing_address as billingAddress, subtotal, cgst_rate as cgstRate, cgst_amount as cgstAmount, sgst_rate as sgstRate, sgst_amount as sgstAmount, igst_rate as igstRate, igst_amount as igstAmount, total_tax as totalTax, total_amount as totalAmount, payment_status as paymentStatus, payment_method as paymentMethod, invoice_date as invoiceDate, due_date as dueDate, paid_at as paidAt',
      'SELECT COUNT(*) as total'
    );
    const countResult = await query(countSql, params) as RowDataPacket[];
    const total = countResult[0].total;

    // Get paginated results
    sql += ` ORDER BY invoice_date DESC`;

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const invoices = await query(sql, params) as Invoice[];

    return { invoices, total };
  }

  /**
   * Get overdue invoices
   */
  async getOverdueInvoices(): Promise<Invoice[]> {
    const sql = `
      SELECT
        id, invoice_number as invoiceNumber, booking_id as bookingId,
        customer_id as customerId, customer_name as customerName,
        customer_email as customerEmail, customer_phone as customerPhone,
        customer_gstin as customerGstin, billing_address as billingAddress,
        subtotal, cgst_rate as cgstRate, cgst_amount as cgstAmount,
        sgst_rate as sgstRate, sgst_amount as sgstAmount,
        igst_rate as igstRate, igst_amount as igstAmount,
        total_tax as totalTax, total_amount as totalAmount,
        payment_status as paymentStatus, payment_method as paymentMethod,
        invoice_date as invoiceDate, due_date as dueDate, paid_at as paidAt
      FROM invoices
      WHERE payment_status = 'pending'
        AND due_date < NOW()
      ORDER BY due_date ASC
    `;

    return await query(sql) as Invoice[];
  }

  /**
   * Mark overdue invoices
   */
  async markOverdueInvoices(): Promise<number> {
    const sql = `
      UPDATE invoices
      SET payment_status = 'overdue'
      WHERE payment_status = 'pending'
        AND due_date < NOW()
    `;

    const result = await query(sql) as ResultSetHeader;
    return result.affectedRows;
  }

  /**
   * Get GST summary for period
   */
  async getGSTSummary(startDate: Date, endDate: Date): Promise<{
    totalSales: number;
    totalCGST: number;
    totalSGST: number;
    totalIGST: number;
    totalGST: number;
    invoiceCount: number;
  }> {
    const sql = `
      SELECT
        COUNT(*) as invoiceCount,
        SUM(subtotal) as totalSales,
        SUM(cgst_amount) as totalCGST,
        SUM(sgst_amount) as totalSGST,
        SUM(igst_amount) as totalIGST,
        SUM(total_tax) as totalGST
      FROM invoices
      WHERE invoice_date >= ? AND invoice_date <= ?
        AND payment_status != 'cancelled'
    `;

    const result = await query(sql, [startDate, endDate]) as RowDataPacket[];

    return {
      totalSales: parseFloat(result[0].totalSales || 0),
      totalCGST: parseFloat(result[0].totalCGST || 0),
      totalSGST: parseFloat(result[0].totalSGST || 0),
      totalIGST: parseFloat(result[0].totalIGST || 0),
      totalGST: parseFloat(result[0].totalGST || 0),
      invoiceCount: result[0].invoiceCount || 0
    };
  }
}

export default new InvoiceService();
