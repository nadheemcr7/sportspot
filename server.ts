import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  BookingRecord,
  CouponRecord,
  Court,
  NotificationItem,
  SlotLockRecord,
  SportType,
  VenueSettings,
} from './src/types/sportspot.ts';
import {
  applyOwnerOneClickConfirmation,
  buildSlotKey,
  calculatePriceBreakdown,
  checkUnitsAvailability,
  createSampleGpayReceiptDataUrl,
  generateAtomicUnitKeys,
  minutesToTime,
  timeToMinutes,
} from './src/utils/bookingEngine.ts';

dotenv.config();

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'sportspot-db.json');

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const isSupabaseLive = Boolean(
  supabaseUrl &&
    supabaseKey &&
    !supabaseUrl.includes('your-project-id') &&
    !supabaseKey.includes('your-supabase')
);

interface DatabaseShape {
  venueSettings: VenueSettings;
  courts: Court[];
  bookings: BookingRecord[];
  slotLocks: Record<string, SlotLockRecord>;
  coupons: CouponRecord[];
  notifications: NotificationItem[];
}

function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function createInitialSeedDatabase(): DatabaseShape {
  const today = getTodayDateString();
  const nowIso = new Date().toISOString();

  const venueSettings: VenueSettings = {
    venueName: 'SportSpot Arena — Electronic City Phase I',
    address: 'Plot 42, Velankani Tech Park Road, Electronic City, Bengaluru 560100',
    phone: '+91 98450 77210',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    ownerUpiId: process.env.OWNER_UPI_ID || 'sportspot.arena@okaxis',
    ownerMerchantName: process.env.OWNER_MERCHANT_NAME || 'SportSpot Arena Turf',
    advancePercentage: 30,
    holdDurationMinutes: 10,
    openingTime: '06:00',
    closingTime: '23:00',
    facilities: [
      'FIFA Quality Pro 55mm Turf',
      '400 Lux LED Stadium Floodlights',
      'Locker & Shower Rooms',
      'Covered Spectator Dugout',
      'Chilled RO Drinking Water',
      'Ample 2W & 4W Parking',
    ],
  };

  const courts: Court[] = [
    {
      id: 'court-1',
      name: 'Court 1 — Pro FIFA 7v7 Arena',
      sportTypes: ['Football', '7v7 Turf', 'Box Cricket'],
      capacity: '7v7 (Up to 14 Players)',
      surface: 'FIFA Quality Pro 55mm Monofilament Grass + Shockpad',
      facilities: ['400 Lux LED Floodlights', 'Pro Goalposts', 'Covered Team Dugout', 'Digital Scoreboard'],
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
    },
    {
      id: 'court-2',
      name: 'Court 2 — High-Roof Box Cricket & 5v5 Cage',
      sportTypes: ['Box Cricket', 'Football', 'Pickleball'],
      capacity: '6v6 / 8v8 Box Cricket (Up to 16 Players)',
      surface: '35mm High-Density Cricket Outfield + Woven Pitch Mat',
      facilities: ['32ft High Roof Netting', 'LED Stumps & Bats Included', 'Floodlights', 'Spectator Bench'],
      imageUrl: '/src/assets/images/court_box_cricket_1794488671397.jpg',
      active: true,
      slotIntervalMinutes: 30,
      allowedDurations: [60, 90, 120],
      pricing: {
        weekdayMorningRate: 800,
        weekdayEveningRate: 1200,
        weekendMorningRate: 1000,
        weekendEveningRate: 1400,
        peakStartHour: 17,
      },
    },
  ];

  const bookings: BookingRecord[] = [
    {
      id: 'bk-seed-101',
      bookingReference: 'SS-8491',
      userId: 'cust-rohan',
      customerName: 'Rohan Deshmukh',
      customerPhone: '+91 98802 44110',
      customerEmail: 'rohan.deshmukh@gmail.com',
      courtId: 'court-1',
      courtName: 'Court 1 — Pro FIFA 7v7 Arena',
      sport: 'Football',
      bookingDate: today,
      startTime: '18:00',
      endTime: '19:00',
      durationMinutes: 60,
      unitKeys: generateAtomicUnitKeys('court-1', today, '18:00', 60),
      source: 'ONLINE',
      status: 'AWAITING_OWNER_APPROVAL',
      paymentStatus: 'SCREENSHOT_UPLOADED',
      paymentMethod: 'GPAY_QR_SCREENSHOT',
      baseAmount: 1400,
      discountAmount: 0,
      totalAmount: 1400,
      advanceAmount: 420,
      paidAmount: 0,
      balanceAmount: 980,
      upiReferenceUtr: '631749201844',
      screenshotDataUrl: createSampleGpayReceiptDataUrl({
        payerName: 'Rohan Deshmukh',
        merchantName: venueSettings.ownerMerchantName,
        merchantUpiId: venueSettings.ownerUpiId,
        amount: 420,
        utrNumber: '631749201844',
        bookingReference: 'SS-8491',
        paidAtLabel: 'Today, 4:12 PM',
      }),
      screenshotUploadedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'bk-seed-102',
      bookingReference: 'SS-8492',
      userId: 'cust-karthik',
      customerName: 'Karthik Subramanian',
      customerPhone: '+91 97411 89023',
      customerEmail: 'karthik.s@outlook.com',
      courtId: 'court-2',
      courtName: 'Court 2 — High-Roof Box Cricket & 5v5 Cage',
      sport: 'Box Cricket',
      bookingDate: today,
      startTime: '19:00',
      endTime: '20:30',
      durationMinutes: 90,
      unitKeys: generateAtomicUnitKeys('court-2', today, '19:00', 90),
      source: 'ONLINE',
      status: 'AWAITING_OWNER_APPROVAL',
      paymentStatus: 'SCREENSHOT_UPLOADED',
      paymentMethod: 'GPAY_QR_SCREENSHOT',
      baseAmount: 1800,
      discountAmount: 0,
      totalAmount: 1800,
      advanceAmount: 540,
      paidAmount: 0,
      balanceAmount: 1260,
      upiReferenceUtr: '631788310922',
      screenshotDataUrl: createSampleGpayReceiptDataUrl({
        payerName: 'Karthik Subramanian',
        merchantName: venueSettings.ownerMerchantName,
        merchantUpiId: venueSettings.ownerUpiId,
        amount: 540,
        utrNumber: '631788310922',
        bookingReference: 'SS-8492',
        paidAtLabel: 'Today, 4:28 PM',
      }),
      screenshotUploadedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'bk-seed-103',
      bookingReference: 'SS-8485',
      userId: 'cust-demo',
      customerName: 'Vikramaditya Rao',
      customerPhone: '+91 99001 55219',
      customerEmail: 'vikram.rao@gmail.com',
      courtId: 'court-1',
      courtName: 'Court 1 — Pro FIFA 7v7 Arena',
      sport: '7v7 Turf',
      bookingDate: today,
      startTime: '07:00',
      endTime: '08:00',
      durationMinutes: 60,
      unitKeys: generateAtomicUnitKeys('court-1', today, '07:00', 60),
      source: 'ONLINE',
      status: 'CONFIRMED',
      paymentStatus: 'ADVANCE_VERIFIED',
      paymentMethod: 'GPAY_QR_SCREENSHOT',
      baseAmount: 1000,
      discountAmount: 0,
      totalAmount: 1000,
      advanceAmount: 300,
      paidAmount: 300,
      balanceAmount: 700,
      upiReferenceUtr: '631700192831',
      screenshotDataUrl: createSampleGpayReceiptDataUrl({
        payerName: 'Vikramaditya Rao',
        merchantName: venueSettings.ownerMerchantName,
        merchantUpiId: venueSettings.ownerUpiId,
        amount: 300,
        utrNumber: '631700192831',
        bookingReference: 'SS-8485',
        paidAtLabel: 'Today, 6:15 AM',
      }),
      screenshotUploadedAt: nowIso,
      ownerVerifiedAt: nowIso,
      ownerVerifiedBy: 'owner@sportspot.in',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'bk-seed-104',
      bookingReference: 'SS-8488',
      userId: 'walkin-counter',
      customerName: 'Zayed Khan & XI (Walk-In)',
      customerPhone: '+91 98455 31098',
      customerEmail: 'walkin@sportspot.in',
      courtId: 'court-1',
      courtName: 'Court 1 — Pro FIFA 7v7 Arena',
      sport: 'Football',
      bookingDate: today,
      startTime: '09:00',
      endTime: '10:00',
      durationMinutes: 60,
      unitKeys: generateAtomicUnitKeys('court-1', today, '09:00', 60),
      source: 'WALK_IN',
      status: 'CONFIRMED',
      paymentStatus: 'FULLY_PAID',
      paymentMethod: 'UPI_AT_VENUE',
      baseAmount: 1000,
      discountAmount: 0,
      totalAmount: 1000,
      advanceAmount: 1000,
      paidAmount: 1000,
      balanceAmount: 0,
      ownerVerifiedAt: nowIso,
      ownerVerifiedBy: 'Counter Desk',
      notes: 'Walk-in customer paid full amount at turf counter.',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'bk-seed-105',
      bookingReference: 'SS-8489',
      userId: 'cust-demo',
      customerName: 'Vikramaditya Rao',
      customerPhone: '+91 99001 55219',
      customerEmail: 'vikram.rao@gmail.com',
      courtId: 'court-2',
      courtName: 'Court 2 — High-Roof Box Cricket & 5v5 Cage',
      sport: 'Box Cricket',
      bookingDate: today,
      startTime: '17:00',
      endTime: '18:00',
      durationMinutes: 60,
      unitKeys: generateAtomicUnitKeys('court-2', today, '17:00', 60),
      source: 'ONLINE',
      status: 'CONFIRMED',
      paymentStatus: 'ADVANCE_VERIFIED',
      paymentMethod: 'GPAY_QR_SCREENSHOT',
      baseAmount: 1200,
      discountAmount: 0,
      totalAmount: 1200,
      advanceAmount: 360,
      paidAmount: 360,
      balanceAmount: 840,
      upiReferenceUtr: '631711904412',
      screenshotDataUrl: createSampleGpayReceiptDataUrl({
        payerName: 'Vikramaditya Rao',
        merchantName: venueSettings.ownerMerchantName,
        merchantUpiId: venueSettings.ownerUpiId,
        amount: 360,
        utrNumber: '631711904412',
        bookingReference: 'SS-8489',
        paidAtLabel: 'Today, 1:20 PM',
      }),
      screenshotUploadedAt: nowIso,
      ownerVerifiedAt: nowIso,
      ownerVerifiedBy: 'owner@sportspot.in',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  const slotLocks: Record<string, SlotLockRecord> = {};
  for (const b of bookings) {
    for (const key of b.unitKeys) {
      const unitTime = key.split('__')[2];
      slotLocks[key] = {
        slotKey: key,
        courtId: b.courtId,
        bookingDate: b.bookingDate,
        unitTime,
        bookingId: b.id,
        source: b.source,
        status: b.status === 'AWAITING_OWNER_APPROVAL' ? 'AWAITING_OWNER_APPROVAL' : 'BOOKED',
        customerName: b.customerName,
        updatedAt: nowIso,
      };
    }
  }

  // Add one maintenance block at 13:00 on Court 2
  const maintKeys = generateAtomicUnitKeys('court-2', today, '13:00', 60);
  for (const key of maintKeys) {
    slotLocks[key] = {
      slotKey: key,
      courtId: 'court-2',
      bookingDate: today,
      unitTime: key.split('__')[2],
      status: 'BLOCKED',
      reason: 'Pitch Rolling & Net Inspection',
      updatedAt: nowIso,
    };
  }

  const coupons: CouponRecord[] = [
    {
      id: 'cp-1',
      code: 'FIRSTGAME20',
      description: '20% off on your first turf slot booking (min ₹800)',
      discountType: 'PERCENTAGE',
      discountValue: 20,
      minBookingAmount: 800,
      maxUses: 100,
      usedCount: 14,
      active: true,
    },
    {
      id: 'cp-2',
      code: 'TURF200',
      description: 'Flat ₹200 off on 90+ minute floodlight bookings (min ₹1,200)',
      discountType: 'FIXED',
      discountValue: 200,
      minBookingAmount: 1200,
      maxUses: 50,
      usedCount: 8,
      active: true,
    },
  ];

  const notifications: NotificationItem[] = [
    {
      id: 'notif-1',
      recipientRole: 'OWNER',
      title: 'GPay Screenshot Uploaded · SS-8491',
      message: 'Rohan Deshmukh uploaded a ₹420 GPay screenshot (UTR: 631749201844) for Court 1 at 18:00.',
      bookingId: 'bk-seed-101',
      read: false,
      createdAt: nowIso,
    },
    {
      id: 'notif-2',
      recipientRole: 'OWNER',
      title: 'GPay Screenshot Uploaded · SS-8492',
      message: 'Karthik Subramanian uploaded a ₹540 GPay screenshot (UTR: 631788310922) for Court 2 at 19:00.',
      bookingId: 'bk-seed-102',
      read: false,
      createdAt: nowIso,
    },
  ];

  return {
    venueSettings,
    courts,
    bookings,
    slotLocks,
    coupons,
    notifications,
  };
}

function loadDatabase(): DatabaseShape {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as DatabaseShape;
      if (parsed && Array.isArray(parsed.courts) && Array.isArray(parsed.bookings)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error loading local DB, initializing fresh seed:', err);
  }
  const seeded = createInitialSeedDatabase();
  saveDatabase(seeded);
  return seeded;
}

function saveDatabase(db: DatabaseShape): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist database:', err);
  }
}

let dbState: DatabaseShape = loadDatabase();

// SSE Connected Clients for Instant Real-Time Sync Across Customer & Owner Views
const sseClients = new Set<express.Response>();

function broadcastRealtimeSync(eventType: string): void {
  const payload = JSON.stringify({
    type: eventType,
    timestamp: new Date().toISOString(),
  });
  for (const client of sseClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

function cleanupExpiredHolds(): boolean {
  const nowIso = new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  let mutated = false;

  for (const booking of dbState.bookings) {
    if (
      booking.status === 'HOLD' &&
      booking.holdExpiresAt &&
      new Date(booking.holdExpiresAt).getTime() <= nowMs
    ) {
      booking.status = 'EXPIRED';
      booking.updatedAt = nowIso;
      mutated = true;

      for (const key of booking.unitKeys) {
        const lock = dbState.slotLocks[key];
        if (lock && lock.bookingId === booking.id && lock.status === 'HOLD') {
          delete dbState.slotLocks[key];
        }
      }
    }
  }

  for (const [key, lock] of Object.entries(dbState.slotLocks)) {
    if (
      lock.status === 'HOLD' &&
      lock.holdExpiresAt &&
      new Date(lock.holdExpiresAt).getTime() <= nowMs
    ) {
      delete dbState.slotLocks[key];
      mutated = true;
    }
  }

  if (mutated) {
    saveDatabase(dbState);
  }
  return mutated;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // 1. SSE Endpoint for Live Availability & Owner Dashboard Updates
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: 'CONNECTED' })}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // 2. Get Complete Synchronized State
  app.get('/api/state', (_req, res) => {
    cleanupExpiredHolds();
    res.json({
      ...dbState,
      supabaseConfigured: isSupabaseLive,
      serverTime: new Date().toISOString(),
    });
  });

  // 3. Step 1 of Customer Booking: Atomic Slot Hold & Generate Owner GPay QR Info
  app.post('/api/bookings/hold', (req, res) => {
    cleanupExpiredHolds();
    const {
      userId = 'cust-demo',
      customerName,
      customerPhone,
      customerEmail = 'player@sportspot.in',
      courtId,
      sport,
      bookingDate,
      startTime,
      durationMinutes = 60,
      couponCode,
      payFullOnline = false,
    } = req.body;

    if (!customerName || !customerPhone || !courtId || !bookingDate || !startTime) {
      return res.status(400).json({
        error: 'Customer name, phone number, court, date, and start time are required.',
      });
    }

    const court = dbState.courts.find((c) => c.id === courtId && c.active);
    if (!court) {
      return res.status(404).json({ error: 'Selected court is not available.' });
    }

    const nowIso = new Date().toISOString();
    const unitKeys = generateAtomicUnitKeys(courtId, bookingDate, startTime, Number(durationMinutes), 30);

    // Transactional Conflict Check across all 30-minute base units
    const availability = checkUnitsAvailability(unitKeys, dbState.slotLocks, nowIso);
    if (!availability.available) {
      return res.status(409).json({
        error:
          'This slot (or an overlapping 30-minute segment) was just reserved by another player or counter walk-in. Please choose another time.',
        conflictingKey: availability.conflictingKey,
      });
    }

    const matchedCoupon = couponCode
      ? dbState.coupons.find(
          (c) => c.code.toUpperCase() === String(couponCode).trim().toUpperCase() && c.active
        )
      : null;

    const price = calculatePriceBreakdown({
      court,
      bookingDate,
      startTime,
      durationMinutes: Number(durationMinutes),
      advancePercentage: dbState.venueSettings.advancePercentage,
      coupon: matchedCoupon,
      payFullOnline: Boolean(payFullOnline),
    });

    const endTime = minutesToTime(timeToMinutes(startTime) + Number(durationMinutes));
    const holdExpiresAt = new Date(
      Date.now() + dbState.venueSettings.holdDurationMinutes * 60 * 1000
    ).toISOString();
    const bookingId = `bk-${Date.now()}`;
    const bookingReference = `SS-${Math.floor(1000 + Math.random() * 9000)}`;

    const newBooking: BookingRecord = {
      id: bookingId,
      bookingReference,
      userId,
      customerName: String(customerName).trim(),
      customerPhone: String(customerPhone).trim(),
      customerEmail: String(customerEmail).trim(),
      courtId: court.id,
      courtName: court.name,
      sport: (sport as SportType) || court.sportTypes[0],
      bookingDate,
      startTime,
      endTime,
      durationMinutes: Number(durationMinutes),
      unitKeys,
      source: 'ONLINE',
      status: 'HOLD',
      paymentStatus: 'UNPAID_HOLD',
      paymentMethod: 'GPAY_QR_SCREENSHOT',
      baseAmount: price.baseAmount,
      discountAmount: price.discountAmount,
      totalAmount: price.totalAmount,
      advanceAmount: price.advanceAmount,
      paidAmount: 0,
      balanceAmount: price.balanceAmount,
      couponCode: price.appliedCoupon || null,
      holdExpiresAt,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    // Lock all 30-minute atomic units immediately
    for (const key of unitKeys) {
      dbState.slotLocks[key] = {
        slotKey: key,
        courtId: court.id,
        bookingDate,
        unitTime: key.split('__')[2],
        bookingId,
        source: 'ONLINE',
        status: 'HOLD',
        holdExpiresAt,
        customerName: newBooking.customerName,
        updatedAt: nowIso,
      };
    }

    dbState.bookings.unshift(newBooking);
    saveDatabase(dbState);
    broadcastRealtimeSync('SLOT_HELD');

    return res.status(201).json({ booking: newBooking });
  });

  // 4. Step 2 of Customer Booking: Upload GPay Screenshot & UTR -> Lock Slot Awaiting Owner Approval
  app.post('/api/bookings/:id/upload-screenshot', (req, res) => {
    cleanupExpiredHolds();
    const { id } = req.params;
    const { screenshotDataUrl, upiReferenceUtr } = req.body;

    const booking = dbState.bookings.find((b) => b.id === id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking reservation not found.' });
    }

    if (booking.status === 'EXPIRED' || booking.status === 'CANCELLED') {
      return res.status(409).json({
        error: 'This slot hold has expired. Please select the slot again.',
      });
    }

    if (!screenshotDataUrl) {
      return res.status(400).json({
        error: 'Please upload your Google Pay payment screenshot to lock the slot.',
      });
    }

    const nowIso = new Date().toISOString();
    const cleanUtr = String(upiReferenceUtr || '').trim() || `UTR${Date.now().toString().slice(-8)}`;

    booking.status = 'AWAITING_OWNER_APPROVAL';
    booking.paymentStatus = 'SCREENSHOT_UPLOADED';
    booking.screenshotDataUrl = screenshotDataUrl;
    booking.upiReferenceUtr = cleanUtr;
    booking.screenshotUploadedAt = nowIso;
    booking.holdExpiresAt = null;
    booking.updatedAt = nowIso;

    if (booking.couponCode) {
      const coupon = dbState.coupons.find((c) => c.code === booking.couponCode);
      if (coupon) coupon.usedCount += 1;
    }

    for (const key of booking.unitKeys) {
      dbState.slotLocks[key] = {
        slotKey: key,
        courtId: booking.courtId,
        bookingDate: booking.bookingDate,
        unitTime: key.split('__')[2],
        bookingId: booking.id,
        source: 'ONLINE',
        status: 'AWAITING_OWNER_APPROVAL',
        holdExpiresAt: null,
        customerName: booking.customerName,
        updatedAt: nowIso,
      };
    }

    dbState.notifications.unshift({
      id: `notif-${Date.now()}`,
      recipientRole: 'OWNER',
      title: `GPay Screenshot Uploaded · ${booking.bookingReference}`,
      message: `${booking.customerName} uploaded a ₹${booking.advanceAmount} GPay screenshot (UTR: ${cleanUtr}) for ${booking.courtName} (${booking.startTime}–${booking.endTime}). Click to verify & confirm.`,
      bookingId: booking.id,
      read: false,
      createdAt: nowIso,
    });

    saveDatabase(dbState);
    broadcastRealtimeSync('SCREENSHOT_UPLOADED');

    return res.json({ booking });
  });

  // 5. ONE-CLICK OWNER APPROVAL: Verify GPay Screenshot & Confirm Slot
  app.post('/api/admin/bookings/:id/confirm-gpay', (req, res) => {
    const { id } = req.params;
    const { ownerEmail = 'owner@sportspot.in' } = req.body || {};

    const idx = dbState.bookings.findIndex((b) => b.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const nowIso = new Date().toISOString();
    const updatedBooking = applyOwnerOneClickConfirmation(
      dbState.bookings[idx],
      ownerEmail,
      nowIso
    );
    dbState.bookings[idx] = updatedBooking;

    for (const key of updatedBooking.unitKeys) {
      dbState.slotLocks[key] = {
        slotKey: key,
        courtId: updatedBooking.courtId,
        bookingDate: updatedBooking.bookingDate,
        unitTime: key.split('__')[2],
        bookingId: updatedBooking.id,
        source: updatedBooking.source,
        status: 'BOOKED',
        holdExpiresAt: null,
        customerName: updatedBooking.customerName,
        updatedAt: nowIso,
      };
    }

    dbState.notifications.unshift({
      id: `notif-${Date.now()}`,
      recipientRole: 'CUSTOMER',
      userId: updatedBooking.userId,
      title: `Slot Confirmed! · ${updatedBooking.bookingReference}`,
      message: `Owner verified your ₹${updatedBooking.advanceAmount} GPay advance for ${updatedBooking.courtName} on ${updatedBooking.bookingDate} (${updatedBooking.startTime}–${updatedBooking.endTime}). Balance due at venue: ₹${updatedBooking.balanceAmount}.`,
      bookingId: updatedBooking.id,
      read: false,
      createdAt: nowIso,
    });

    saveDatabase(dbState);
    broadcastRealtimeSync('OWNER_CONFIRMED_GPAY');

    return res.json({ booking: updatedBooking });
  });

  // 6. OWNER REJECT SCREENSHOT & RELEASE SLOT
  app.post('/api/admin/bookings/:id/reject-gpay', (req, res) => {
    const { id } = req.params;
    const { reason = 'GPay advance payment not received or screenshot unclear.' } = req.body || {};

    const booking = dbState.bookings.find((b) => b.id === id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const nowIso = new Date().toISOString();
    booking.status = 'REJECTED';
    booking.paymentStatus = 'REJECTED';
    booking.rejectionReason = reason;
    booking.holdExpiresAt = null;
    booking.updatedAt = nowIso;

    for (const key of booking.unitKeys) {
      if (dbState.slotLocks[key]?.bookingId === booking.id) {
        delete dbState.slotLocks[key];
      }
    }

    dbState.notifications.unshift({
      id: `notif-${Date.now()}`,
      recipientRole: 'CUSTOMER',
      userId: booking.userId,
      title: `Payment Verification Declined · ${booking.bookingReference}`,
      message: `Your slot reservation for ${booking.startTime} was released: ${reason}`,
      bookingId: booking.id,
      read: false,
      createdAt: nowIso,
    });

    saveDatabase(dbState);
    broadcastRealtimeSync('OWNER_REJECTED_GPAY');

    return res.json({ booking });
  });

  // 7. OWNER COLLECT REMAINING BALANCE AT TURF COUNTER
  app.post('/api/admin/bookings/:id/collect-balance', (req, res) => {
    const { id } = req.params;
    const booking = dbState.bookings.find((b) => b.id === id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const nowIso = new Date().toISOString();
    booking.paidAmount = booking.totalAmount;
    booking.balanceAmount = 0;
    booking.paymentStatus = 'FULLY_PAID';
    booking.updatedAt = nowIso;

    saveDatabase(dbState);
    broadcastRealtimeSync('BALANCE_COLLECTED');
    return res.json({ booking });
  });

  // 8. OWNER WALK-IN BOOKING (Shares Exact Same Availability Engine & Locks Online Immediately)
  app.post('/api/admin/bookings/walk-in', (req, res) => {
    cleanupExpiredHolds();
    const {
      customerName,
      customerPhone,
      courtId,
      sport,
      bookingDate,
      startTime,
      durationMinutes = 60,
      paymentMethod = 'UPI_AT_VENUE',
      collectFullAmount = true,
      notes = '',
    } = req.body;

    if (!customerName || !customerPhone || !courtId || !bookingDate || !startTime) {
      return res.status(400).json({
        error: 'Customer name, mobile number, court, date, and start time are required.',
      });
    }

    const court = dbState.courts.find((c) => c.id === courtId);
    if (!court) {
      return res.status(404).json({ error: 'Court not found.' });
    }

    const nowIso = new Date().toISOString();
    const unitKeys = generateAtomicUnitKeys(
      courtId,
      bookingDate,
      startTime,
      Number(durationMinutes),
      30
    );

    const availability = checkUnitsAvailability(unitKeys, dbState.slotLocks, nowIso);
    if (!availability.available) {
      return res.status(409).json({
        error: 'Cannot create walk-in: one or more 30-minute units in this slot are already locked or booked online.',
      });
    }

    const price = calculatePriceBreakdown({
      court,
      bookingDate,
      startTime,
      durationMinutes: Number(durationMinutes),
      advancePercentage: dbState.venueSettings.advancePercentage,
      payFullOnline: Boolean(collectFullAmount),
    });

    const endTime = minutesToTime(timeToMinutes(startTime) + Number(durationMinutes));
    const bookingId = `bk-walkin-${Date.now()}`;
    const bookingReference = `SS-W${Math.floor(1000 + Math.random() * 9000)}`;

    const paidNow = collectFullAmount ? price.totalAmount : price.advanceAmount;
    const balanceDue = Math.max(0, price.totalAmount - paidNow);

    const walkInBooking: BookingRecord = {
      id: bookingId,
      bookingReference,
      userId: 'walkin-counter',
      customerName: String(customerName).trim(),
      customerPhone: String(customerPhone).trim(),
      customerEmail: 'walkin@sportspot.in',
      courtId: court.id,
      courtName: court.name,
      sport: (sport as SportType) || court.sportTypes[0],
      bookingDate,
      startTime,
      endTime,
      durationMinutes: Number(durationMinutes),
      unitKeys,
      source: 'WALK_IN',
      status: 'CONFIRMED',
      paymentStatus: balanceDue === 0 ? 'FULLY_PAID' : 'ADVANCE_VERIFIED',
      paymentMethod,
      baseAmount: price.baseAmount,
      discountAmount: 0,
      totalAmount: price.totalAmount,
      advanceAmount: paidNow,
      paidAmount: paidNow,
      balanceAmount: balanceDue,
      ownerVerifiedAt: nowIso,
      ownerVerifiedBy: 'Counter Desk',
      notes: String(notes).trim() || 'Walk-in counter reservation',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    for (const key of unitKeys) {
      dbState.slotLocks[key] = {
        slotKey: key,
        courtId: court.id,
        bookingDate,
        unitTime: key.split('__')[2],
        bookingId,
        source: 'WALK_IN',
        status: 'BOOKED',
        customerName: walkInBooking.customerName,
        updatedAt: nowIso,
      };
    }

    dbState.bookings.unshift(walkInBooking);
    saveDatabase(dbState);
    broadcastRealtimeSync('WALK_IN_CREATED');

    return res.status(201).json({ booking: walkInBooking });
  });

  // 9. CANCEL BOOKING (Customer or Owner)
  app.post('/api/bookings/:id/cancel', (req, res) => {
    const { id } = req.params;
    const booking = dbState.bookings.find((b) => b.id === id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const nowIso = new Date().toISOString();
    booking.status = 'CANCELLED';
    booking.updatedAt = nowIso;

    for (const key of booking.unitKeys) {
      if (dbState.slotLocks[key]?.bookingId === booking.id) {
        delete dbState.slotLocks[key];
      }
    }

    saveDatabase(dbState);
    broadcastRealtimeSync('BOOKING_CANCELLED');

    return res.json({ booking });
  });

  // 10. UPDATE OWNER VENUE & GPAY QR SETTINGS
  app.put('/api/admin/settings', (req, res) => {
    dbState.venueSettings = {
      ...dbState.venueSettings,
      ...req.body,
      ownerQrCustomUrl: req.body.ownerQrCustomUrl || '',
      advancePercentage: Number(req.body.advancePercentage ?? dbState.venueSettings.advancePercentage),
      holdDurationMinutes: Number(req.body.holdDurationMinutes ?? dbState.venueSettings.holdDurationMinutes),
    };
    saveDatabase(dbState);
    broadcastRealtimeSync('SETTINGS_UPDATED');
    return res.json({ venueSettings: dbState.venueSettings });
  });

  // 11. UPDATE COURT PRICING OR DETAILS
  app.put('/api/admin/courts/:id', (req, res) => {
    const { id } = req.params;
    const idx = dbState.courts.findIndex((c) => c.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Court not found.' });
    }
    dbState.courts[idx] = {
      ...dbState.courts[idx],
      ...req.body,
      pricing: {
        ...dbState.courts[idx].pricing,
        ...(req.body.pricing || {}),
      },
    };
    saveDatabase(dbState);
    broadcastRealtimeSync('COURT_UPDATED');
    return res.json({ court: dbState.courts[idx] });
  });

  // 12. BLOCK / UNBLOCK MAINTENANCE SLOT
  app.post('/api/admin/toggle-block', (req, res) => {
    const { courtId, bookingDate, startTime, durationMinutes = 60, reason = 'Maintenance Block' } = req.body;
    const unitKeys = generateAtomicUnitKeys(courtId, bookingDate, startTime, Number(durationMinutes), 30);
    const nowIso = new Date().toISOString();

    const firstLock = dbState.slotLocks[unitKeys[0]];
    if (firstLock && firstLock.status === 'BLOCKED') {
      for (const k of unitKeys) {
        if (dbState.slotLocks[k]?.status === 'BLOCKED') {
          delete dbState.slotLocks[k];
        }
      }
    } else {
      const check = checkUnitsAvailability(unitKeys, dbState.slotLocks, nowIso);
      if (!check.available) {
        return res.status(409).json({ error: 'Cannot block a slot that already has an active booking.' });
      }
      for (const k of unitKeys) {
        dbState.slotLocks[k] = {
          slotKey: k,
          courtId,
          bookingDate,
          unitTime: k.split('__')[2],
          status: 'BLOCKED',
          reason,
          updatedAt: nowIso,
        };
      }
    }

    saveDatabase(dbState);
    broadcastRealtimeSync('MAINTENANCE_TOGGLED');
    return res.json({ slotLocks: dbState.slotLocks });
  });

  // 13. MARK NOTIFICATIONS READ
  app.post('/api/notifications/mark-read', (_req, res) => {
    for (const n of dbState.notifications) {
      n.read = true;
    }
    saveDatabase(dbState);
    return res.json({ notifications: dbState.notifications });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SportSpot Full-Stack Server listening on http://localhost:${PORT}`);
  });
}

startServer();
