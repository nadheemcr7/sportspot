export type SportType = 'Football' | 'Box Cricket' | '7v7 Turf' | 'Pickleball';

export type BookingSource = 'ONLINE' | 'WALK_IN';

export type BookingStatus =
  | 'HOLD'
  | 'AWAITING_OWNER_APPROVAL'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED';

export type PaymentStatus =
  | 'UNPAID_HOLD'
  | 'SCREENSHOT_UPLOADED'
  | 'ADVANCE_VERIFIED'
  | 'FULLY_PAID'
  | 'REJECTED'
  | 'REFUNDED';

export type PaymentMethod = 'GPAY_QR_SCREENSHOT' | 'CASH_AT_VENUE' | 'UPI_AT_VENUE';

export type SlotDisplayState =
  | 'AVAILABLE'
  | 'HOLD'
  | 'AWAITING_OWNER_APPROVAL'
  | 'BOOKED_ONLINE'
  | 'BOOKED_WALK_IN'
  | 'BLOCKED';

export interface CourtPricing {
  weekdayMorningRate: number; // per hour (60 mins)
  weekdayEveningRate: number; // per hour from peakStartHour onwards
  weekendMorningRate: number;
  weekendEveningRate: number;
  peakStartHour: number; // e.g., 17 (5:00 PM floodlights)
}

export interface Court {
  id: string;
  name: string;
  sportTypes: SportType[];
  capacity: string;
  surface: string;
  facilities: string[];
  imageUrl: string;
  active: boolean;
  slotIntervalMinutes: number; // 30 mins atomic unit
  allowedDurations: number[]; // [60, 90, 120]
  pricing: CourtPricing;
}

export interface VenueSettings {
  venueName: string;
  address: string;
  phone: string;
  timezone: string;
  currency: string;
  ownerUpiId: string;
  ownerMerchantName: string;
  ownerQrCustomUrl?: string;
  advancePercentage: number; // default 30% advance via GPay QR
  holdDurationMinutes: number; // default 10 minutes while user pays on GPay
  openingTime: string; // "06:00"
  closingTime: string; // "23:00"
  facilities: string[];
}

export interface SlotLockRecord {
  slotKey: string; // courtId__YYYY-MM-DD__HH:MM
  courtId: string;
  bookingDate: string; // YYYY-MM-DD
  unitTime: string; // HH:MM (30-min unit start)
  bookingId?: string;
  source?: BookingSource;
  status: 'HOLD' | 'AWAITING_OWNER_APPROVAL' | 'BOOKED' | 'BLOCKED';
  holdExpiresAt?: string | null;
  reason?: string;
  customerName?: string;
  updatedAt: string;
}

export interface BookingRecord {
  id: string;
  bookingReference: string;
  userId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  courtId: string;
  courtName: string;
  sport: SportType;
  bookingDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  durationMinutes: number;
  unitKeys: string[];
  source: BookingSource;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  baseAmount: number;
  discountAmount: number;
  totalAmount: number;
  advanceAmount: number;
  paidAmount: number;
  balanceAmount: number;
  couponCode?: string | null;
  upiReferenceUtr?: string | null;
  screenshotDataUrl?: string | null;
  screenshotUploadedAt?: string | null;
  ownerVerifiedAt?: string | null;
  ownerVerifiedBy?: string | null;
  rejectionReason?: string | null;
  holdExpiresAt?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CouponRecord {
  id: string;
  code: string;
  description: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  minBookingAmount: number;
  maxUses: number;
  usedCount: number;
  active: boolean;
}

export interface NotificationItem {
  id: string;
  recipientRole: 'CUSTOMER' | 'OWNER';
  userId?: string;
  title: string;
  message: string;
  bookingId?: string;
  read: boolean;
  createdAt: string;
}

export interface PriceBreakdown {
  baseAmount: number;
  discountAmount: number;
  totalAmount: number;
  advanceAmount: number;
  balanceAmount: number;
  isWeekend: boolean;
  isPeakEvening: boolean;
  appliedCoupon?: string | null;
}

export interface ComputedSlotCard {
  startTime: string;
  endTime: string;
  durationMinutes: number;
  unitKeys: string[];
  state: SlotDisplayState;
  priceBreakdown: PriceBreakdown;
  bookingId?: string;
  customerName?: string;
  holdExpiresAt?: string | null;
  blockReason?: string;
}
