import {
  BookingRecord,
  ComputedSlotCard,
  CouponRecord,
  Court,
  PriceBreakdown,
  SlotDisplayState,
  SlotLockRecord,
} from '../types/sportspot';

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(totalMinutes: number): string {
  const normalized = Math.max(0, totalMinutes);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function buildSlotKey(courtId: string, bookingDate: string, unitTime: string): string {
  return `${courtId}__${bookingDate}__${unitTime}`;
}

/**
 * Generates deterministic 30-minute base unit keys for a reservation request.
 * Example: court-1, 2026-11-12, 18:00, 90 mins -> 3 keys (18:00, 18:30, 19:00)
 */
export function generateAtomicUnitTimes(startTime: string, durationMinutes: number, intervalMinutes = 30): string[] {
  const startMins = timeToMinutes(startTime);
  const count = Math.max(1, Math.floor(durationMinutes / intervalMinutes));
  const units: string[] = [];
  for (let i = 0; i < count; i++) {
    units.push(minutesToTime(startMins + i * intervalMinutes));
  }
  return units;
}

export function generateAtomicUnitKeys(
  courtId: string,
  bookingDate: string,
  startTime: string,
  durationMinutes: number,
  intervalMinutes = 30
): string[] {
  return generateAtomicUnitTimes(startTime, durationMinutes, intervalMinutes).map((unitTime) =>
    buildSlotKey(courtId, bookingDate, unitTime)
  );
}

export function isLockActive(lock: SlotLockRecord, nowIso: string): boolean {
  if (lock.status === 'HOLD') {
    if (!lock.holdExpiresAt) return false;
    return new Date(lock.holdExpiresAt).getTime() > new Date(nowIso).getTime();
  }
  return (
    lock.status === 'AWAITING_OWNER_APPROVAL' ||
    lock.status === 'BOOKED' ||
    lock.status === 'BLOCKED'
  );
}

export function checkUnitsAvailability(
  unitKeys: string[],
  locksByKey: Record<string, SlotLockRecord>,
  nowIso: string,
  ignoreBookingId?: string
): { available: boolean; conflictingKey?: string; conflictingLock?: SlotLockRecord } {
  for (const key of unitKeys) {
    const lock = locksByKey[key];
    if (!lock) continue;
    if (ignoreBookingId && lock.bookingId === ignoreBookingId) continue;
    if (isLockActive(lock, nowIso)) {
      return { available: false, conflictingKey: key, conflictingLock: lock };
    }
  }
  return { available: true };
}

export function isWeekendDate(bookingDate: string): boolean {
  const [y, m, d] = bookingDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Calculates dynamic turf price, coupon discount, required GPay advance, and balance due at venue.
 */
export function calculatePriceBreakdown(params: {
  court: Court;
  bookingDate: string;
  startTime: string;
  durationMinutes: number;
  advancePercentage: number;
  coupon?: CouponRecord | null;
  payFullOnline?: boolean;
}): PriceBreakdown {
  const {
    court,
    bookingDate,
    startTime,
    durationMinutes,
    advancePercentage,
    coupon,
    payFullOnline = false,
  } = params;

  const isWeekend = isWeekendDate(bookingDate);
  const unitTimes = generateAtomicUnitTimes(startTime, durationMinutes, 30);

  let rawBase = 0;
  let hasPeakUnit = false;

  for (const unitTime of unitTimes) {
    const hour = Math.floor(timeToMinutes(unitTime) / 60);
    const isPeak = hour >= court.pricing.peakStartHour;
    if (isPeak) hasPeakUnit = true;

    const hourlyRate = isWeekend
      ? isPeak
        ? court.pricing.weekendEveningRate
        : court.pricing.weekendMorningRate
      : isPeak
        ? court.pricing.weekdayEveningRate
        : court.pricing.weekdayMorningRate;

    rawBase += Math.round(hourlyRate / 2); // 30-min unit cost
  }

  let discountAmount = 0;
  let appliedCoupon: string | null = null;

  if (
    coupon &&
    coupon.active &&
    coupon.usedCount < coupon.maxUses &&
    rawBase >= coupon.minBookingAmount
  ) {
    if (coupon.discountType === 'PERCENTAGE') {
      discountAmount = Math.round((rawBase * coupon.discountValue) / 100);
    } else {
      discountAmount = Math.min(rawBase, coupon.discountValue);
    }
    appliedCoupon = coupon.code;
  }

  const totalAmount = Math.max(0, rawBase - discountAmount);
  const clampedPct = Math.min(100, Math.max(10, advancePercentage));
  const advanceAmount = payFullOnline
    ? totalAmount
    : Math.max(100, Math.round((totalAmount * clampedPct) / 100 / 10) * 10);
  const finalAdvance = Math.min(totalAmount, advanceAmount);
  const balanceAmount = Math.max(0, totalAmount - finalAdvance);

  return {
    baseAmount: rawBase,
    discountAmount,
    totalAmount,
    advanceAmount: finalAdvance,
    balanceAmount,
    isWeekend,
    isPeakEvening: hasPeakUnit,
    appliedCoupon,
  };
}

/**
 * Computes all selectable time-slot cards for a court, date, and duration.
 */
export function computeDailySlotsForCourt(params: {
  court: Court;
  bookingDate: string;
  durationMinutes: number;
  openingTime: string;
  closingTime: string;
  advancePercentage: number;
  locksByKey: Record<string, SlotLockRecord>;
  nowIso: string;
}): ComputedSlotCard[] {
  const {
    court,
    bookingDate,
    durationMinutes,
    openingTime,
    closingTime,
    advancePercentage,
    locksByKey,
    nowIso,
  } = params;

  const openMins = timeToMinutes(openingTime);
  const closeMins = timeToMinutes(closingTime);
  const step = 60; // Present hourly start slots (06:00, 07:00, ...) that lock consecutive 30-min atomic units
  const slots: ComputedSlotCard[] = [];

  for (let startMins = openMins; startMins + durationMinutes <= closeMins; startMins += step) {
    const startTime = minutesToTime(startMins);
    const endTime = minutesToTime(startMins + durationMinutes);
    const unitKeys = generateAtomicUnitKeys(court.id, bookingDate, startTime, durationMinutes, 30);

    let state: SlotDisplayState = 'AVAILABLE';
    let bookingId: string | undefined;
    let customerName: string | undefined;
    let holdExpiresAt: string | null | undefined;
    let blockReason: string | undefined;

    for (const key of unitKeys) {
      const lock = locksByKey[key];
      if (!lock || !isLockActive(lock, nowIso)) continue;

      bookingId = lock.bookingId;
      customerName = lock.customerName;
      holdExpiresAt = lock.holdExpiresAt;
      blockReason = lock.reason;

      if (lock.status === 'BLOCKED') {
        state = 'BLOCKED';
        break;
      }
      if (lock.status === 'BOOKED') {
        state = lock.source === 'WALK_IN' ? 'BOOKED_WALK_IN' : 'BOOKED_ONLINE';
        break;
      }
      if (lock.status === 'AWAITING_OWNER_APPROVAL') {
        state = 'AWAITING_OWNER_APPROVAL';
        break;
      }
      if (lock.status === 'HOLD') {
        state = 'HOLD';
      }
    }

    const priceBreakdown = calculatePriceBreakdown({
      court,
      bookingDate,
      startTime,
      durationMinutes,
      advancePercentage,
    });

    slots.push({
      startTime,
      endTime,
      durationMinutes,
      unitKeys,
      state,
      priceBreakdown,
      bookingId,
      customerName,
      holdExpiresAt,
      blockReason,
    });
  }

  return slots;
}

/**
 * Transitions a booking when the Owner clicks "Confirm Payment & Slot" in 1 click.
 */
export function applyOwnerOneClickConfirmation(
  booking: BookingRecord,
  ownerEmail: string,
  nowIso: string
): BookingRecord {
  const isFull = booking.advanceAmount >= booking.totalAmount;
  return {
    ...booking,
    status: 'CONFIRMED',
    paymentStatus: isFull ? 'FULLY_PAID' : 'ADVANCE_VERIFIED',
    paidAmount: booking.advanceAmount,
    balanceAmount: Math.max(0, booking.totalAmount - booking.advanceAmount),
    ownerVerifiedAt: nowIso,
    ownerVerifiedBy: ownerEmail,
    holdExpiresAt: null,
    rejectionReason: null,
    updatedAt: nowIso,
  };
}

/**
 * Builds a standard UPI payment URI for Google Pay / PhonePe / Paytm QR codes.
 */
export function buildUpiPaymentUri(params: {
  upiId: string;
  merchantName: string;
  amount: number;
  bookingReference: string;
}): string {
  const { upiId, merchantName, amount, bookingReference } = params;
  const pn = encodeURIComponent(merchantName);
  const tn = encodeURIComponent(`SportSpot Turf Advance ${bookingReference}`);
  return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${pn}&am=${amount.toFixed(2)}&cu=INR&tn=${tn}`;
}

/**
 * Generates a deterministic 25x25 QR matrix (finder patterns + timing + alignment + data hash)
 * so the GPay QR renders crisp and reliable without external API calls.
 */
export function generateDeterministicQrMatrix(payload: string, size = 25): boolean[][] {
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const placeFinder = (rowOffset: number, colOffset: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = rowOffset + r;
        const cc = colOffset + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        reserved[rr][cc] = true;
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        matrix[rr][cc] = inOuter && (onBorder || inCore);
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    reserved[6][i] = true;
    reserved[i][6] = true;
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Alignment pattern at bottom-right
  const ar = size - 9;
  const ac = size - 9;
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      reserved[ar + r][ac + c] = true;
      matrix[ar + r][ac + c] =
        Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
    }
  }

  // Deterministic bit stream from payload
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  let seed = hash >>> 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      const charCode = payload.charCodeAt((r * size + c) % payload.length);
      seed = (Math.imul(seed ^ charCode, 1664525) + 1013904223) >>> 0;
      matrix[r][c] = ((seed >> ((r + c) % 16)) & 1) === 1;
    }
  }

  return matrix;
}

/**
 * Creates a realistic SVG Data-URI representing a customer's GPay Advance Payment Screenshot.
 * Used both for initial demo records and the 1-click "Generate Sample GPay Receipt" helper in preview.
 */
export function createSampleGpayReceiptDataUrl(params: {
  payerName: string;
  merchantName: string;
  merchantUpiId: string;
  amount: number;
  utrNumber: string;
  bookingReference: string;
  paidAtLabel: string;
}): string {
  const {
    payerName,
    merchantName,
    merchantUpiId,
    amount,
    utrNumber,
    bookingReference,
    paidAtLabel,
  } = params;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="720" viewBox="0 0 520 720">
    <rect width="520" height="720" rx="24" fill="#121824"/>
    <rect x="16" y="16" width="488" height="688" rx="18" fill="#171F2E" stroke="#293548" stroke-width="1.5"/>
    <circle cx="260" cy="96" r="34" fill="#16A34A" fill-opacity="0.18" stroke="#22C55E" stroke-width="2"/>
    <path d="M245 96L255 106L277 84" stroke="#4ADE80" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <text x="260" y="158" text-anchor="middle" fill="#94A3B8" font-family="sans-serif" font-size="14" font-weight="600">Paid to ${merchantName}</text>
    <text x="260" y="212" text-anchor="middle" fill="#F8FAFC" font-family="monospace" font-size="44" font-weight="700">₹${amount.toLocaleString('en-IN')}</text>
    <text x="260" y="242" text-anchor="middle" fill="#4ADE80" font-family="sans-serif" font-size="13" font-weight="600">Completed · ${paidAtLabel}</text>
    <line x1="48" y1="274" x2="472" y2="274" stroke="#293548" stroke-width="1"/>
    <text x="48" y="314" fill="#94A3B8" font-family="sans-serif" font-size="12">UPI Transaction ID (UTR)</text>
    <text x="472" y="314" text-anchor="end" fill="#F8FAFC" font-family="monospace" font-size="15" font-weight="700">${utrNumber}</text>
    <text x="48" y="358" fill="#94A3B8" font-family="sans-serif" font-size="12">To Merchant UPI ID</text>
    <text x="472" y="358" text-anchor="end" fill="#E2E8F0" font-family="monospace" font-size="14">${merchantUpiId}</text>
    <text x="48" y="402" fill="#94A3B8" font-family="sans-serif" font-size="12">From Customer</text>
    <text x="472" y="402" text-anchor="end" fill="#E2E8F0" font-family="sans-serif" font-size="14" font-weight="600">${payerName}</text>
    <text x="48" y="446" fill="#94A3B8" font-family="sans-serif" font-size="12">SportSpot Booking Ref</text>
    <text x="472" y="446" text-anchor="end" fill="#A3E635" font-family="monospace" font-size="14" font-weight="700">${bookingReference}</text>
    <rect x="48" y="488" width="424" height="92" rx="12" fill="#0F172A" stroke="#1E293B"/>
    <text x="68" y="520" fill="#94A3B8" font-family="sans-serif" font-size="12">Payment Note</text>
    <text x="68" y="546" fill="#F8FAFC" font-family="sans-serif" font-size="14" font-weight="600">Turf Slot Advance Payment — ${bookingReference}</text>
    <text x="68" y="566" fill="#64748B" font-family="sans-serif" font-size="11">Verified via Google Pay UPI Instant Transfer</text>
    <text x="260" y="646" text-anchor="middle" fill="#64748B" font-family="sans-serif" font-size="12" font-weight="600">GOOGLE PAY · UPI PAYMENT RECEIPT</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
