import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOwnerOneClickConfirmation,
  buildSlotKey,
  calculatePriceBreakdown,
  checkUnitsAvailability,
  generateAtomicUnitKeys,
  generateDeterministicQrMatrix,
} from './bookingEngine';
import { BookingRecord, Court, SlotLockRecord } from '../types/sportspot';

const sampleCourt: Court = {
  id: 'court-1',
  name: 'Court 1 — Pro FIFA Arena',
  sportTypes: ['Football', '7v7 Turf'],
  capacity: '7v7 (14 Players)',
  surface: 'FIFA Pro 55mm Turf',
  facilities: ['LED Floodlights', 'Dugout'],
  imageUrl: '/src/assets/images/court_fifa_arena_1794488669774.jpg',
  active: true,
  slotIntervalMinutes: 30,
  allowedDurations: [60, 90, 120],
  pricing: {
    weekdayMorningRate: 1000,
    weekdayEveningRate: 1400,
    weekendMorningRate: 1200,
    weekendEveningRate: 1600,
    peakStartHour: 17,
  },
};

test('generateAtomicUnitKeys locks consecutive 30-minute units accurately', () => {
  const units90 = generateAtomicUnitKeys('court-1', '2026-11-12', '18:00', 90, 30);
  assert.deepEqual(units90, [
    'court-1__2026-11-12__18:00',
    'court-1__2026-11-12__18:30',
    'court-1__2026-11-12__19:00',
  ]);
});

test('checkUnitsAvailability prevents overlapping double bookings and releases expired holds', () => {
  const now = '2026-11-12T10:00:00.000Z';
  const locks: Record<string, SlotLockRecord> = {
    [buildSlotKey('court-1', '2026-11-12', '18:30')]: {
      slotKey: buildSlotKey('court-1', '2026-11-12', '18:30'),
      courtId: 'court-1',
      bookingDate: '2026-11-12',
      unitTime: '18:30',
      bookingId: 'bk-active',
      status: 'AWAITING_OWNER_APPROVAL',
      updatedAt: now,
    },
    [buildSlotKey('court-1', '2026-11-12', '16:00')]: {
      slotKey: buildSlotKey('court-1', '2026-11-12', '16:00'),
      courtId: 'court-1',
      bookingDate: '2026-11-12',
      unitTime: '16:00',
      bookingId: 'bk-expired-hold',
      status: 'HOLD',
      holdExpiresAt: '2026-11-12T09:55:00.000Z', // expired 5 mins ago
      updatedAt: now,
    },
  };

  // Attempting 18:00 for 60 mins (needs 18:00 and 18:30) must fail because 18:30 is awaiting owner approval
  const overlapAttempt = checkUnitsAvailability(
    generateAtomicUnitKeys('court-1', '2026-11-12', '18:00', 60),
    locks,
    now
  );
  assert.equal(overlapAttempt.available, false);
  assert.equal(overlapAttempt.conflictingKey, 'court-1__2026-11-12__18:30');

  // Attempting 16:00 for 60 mins must succeed because the hold at 16:00 is expired
  const expiredHoldAttempt = checkUnitsAvailability(
    generateAtomicUnitKeys('court-1', '2026-11-12', '16:00', 60),
    locks,
    now
  );
  assert.equal(expiredHoldAttempt.available, true);
});

test('calculatePriceBreakdown computes peak floodlight rate, 30% GPay advance, and venue balance', () => {
  // 2026-11-12 is a Thursday (weekday). 18:00 is peak evening (rate = 1400/hr)
  const breakdown = calculatePriceBreakdown({
    court: sampleCourt,
    bookingDate: '2026-11-12',
    startTime: '18:00',
    durationMinutes: 60,
    advancePercentage: 30,
  });

  assert.equal(breakdown.baseAmount, 1400);
  assert.equal(breakdown.totalAmount, 1400);
  assert.equal(breakdown.advanceAmount, 420); // 30% of 1400
  assert.equal(breakdown.balanceAmount, 980); // Remaining payable at turf counter
  assert.equal(breakdown.isPeakEvening, true);
});

test('applyOwnerOneClickConfirmation marks advance verified and confirms booking in one step', () => {
  const pendingBooking: BookingRecord = {
    id: 'bk-101',
    bookingReference: 'SS-2026-101',
    userId: 'cust-1',
    customerName: 'Aarav Nair',
    customerPhone: '+91 98801 11223',
    customerEmail: 'aarav@example.com',
    courtId: 'court-1',
    courtName: 'Court 1 — Pro FIFA Arena',
    sport: 'Football',
    bookingDate: '2026-11-12',
    startTime: '19:00',
    endTime: '20:00',
    durationMinutes: 60,
    unitKeys: ['court-1__2026-11-12__19:00', 'court-1__2026-11-12__19:30'],
    source: 'ONLINE',
    status: 'AWAITING_OWNER_APPROVAL',
    paymentStatus: 'SCREENSHOT_UPLOADED',
    paymentMethod: 'GPAY_QR_SCREENSHOT',
    baseAmount: 1400,
    discountAmount: 0,
    totalAmount: 1400,
    advanceAmount: 420,
    paidAmount: 0,
    balanceAmount: 1400,
    upiReferenceUtr: '631719482015',
    screenshotDataUrl: 'data:image/svg+xml;utf8,<svg></svg>',
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: '2026-11-12T10:02:00.000Z',
  };

  const confirmed = applyOwnerOneClickConfirmation(
    pendingBooking,
    'owner@sportspot.in',
    '2026-11-12T10:05:00.000Z'
  );

  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal(confirmed.paymentStatus, 'ADVANCE_VERIFIED');
  assert.equal(confirmed.paidAmount, 420);
  assert.equal(confirmed.balanceAmount, 980);
  assert.equal(confirmed.ownerVerifiedBy, 'owner@sportspot.in');
});

test('generateDeterministicQrMatrix builds a valid 25x25 QR code with intact finder patterns', () => {
  const matrix = generateDeterministicQrMatrix('upi://pay?pa=sportspot.arena@okaxis&am=420.00');
  assert.equal(matrix.length, 25);
  assert.equal(matrix[0].length, 25);
  // Top-left finder corners and center must be dark
  assert.equal(matrix[0][0], true);
  assert.equal(matrix[3][3], true);
  assert.equal(matrix[6][6], true);
});
