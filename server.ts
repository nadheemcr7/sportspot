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
  UserAccount,
  VenueSettings,
} from './src/types/sportspot.ts';
import {
  applyOwnerOneClickConfirmation,
  calculatePriceBreakdown,
  checkUnitsAvailability,
  generateAtomicUnitKeys,
  minutesToTime,
  timeToMinutes,
} from './src/utils/bookingEngine.ts';
import {
  COURT_1_IMAGE_URL,
  COURT_2_IMAGE_URL,
  deleteBookingLocksFromSupabase,
  hydrateFromSupabaseIfConfigured,
  invokeSupabaseOwnerConfirmRpc,
  syncStateToSupabase,
  uploadImageToSupabaseStorage,
} from './src/lib/supabaseRest.ts';

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

const OWNER_USERNAME = (process.env.OWNER_USERNAME || 'owner').trim().toLowerCase();
const OWNER_PASSWORD = (process.env.OWNER_PASSWORD || 'sportspot123').trim();

interface StoredUser extends UserAccount {
  passwordPlain: string;
}

interface DatabaseShape {
  venueSettings: VenueSettings;
  courts: Court[];
  bookings: BookingRecord[];
  slotLocks: Record<string, SlotLockRecord>;
  coupons: CouponRecord[];
  notifications: NotificationItem[];
  users: StoredUser[];
}

function createInitialSeedDatabase(): DatabaseShape {
  const venueSettings: VenueSettings = {
    venueName: 'SportSpot Arena — Electronic City Phase I',
    address: 'Plot 42, Velankani Tech Park Road, Electronic City, Bengaluru 560100',
    phone: '+91 98450 77210',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    ownerUpiId: process.env.OWNER_UPI_ID || 'sportspot.arena@okaxis',
    ownerMerchantName: process.env.OWNER_MERCHANT_NAME || 'SportSpot Arena Turf',
    ownerQrCustomUrl: '',
    advancePercentage: 30,
    holdDurationMinutes: 10,
    openingTime: '06:00',
    closingTime: '23:00',
    facilities: [
      'FIFA Quality Pro 55mm Turf',
      '400 Lux Night LED Floodlights',
      'Covered Dugout & Pavilion',
      'Shower & Locker Rooms',
      'Chilled RO Drinking Water',
      'Free Floodlit Parking',
    ],
  };

  const courts: Court[] = [
    {
      id: 'court-1',
      name: 'Court 1 — Pro FIFA 7v7 Arena',
      sportTypes: ['Football', '7v7 Turf', 'Box Cricket'],
      capacity: '7v7 (Up to 14 Players)',
      surface: 'FIFA Quality Pro 55mm Monofilament Grass + Shockpad',
      facilities: [
        '400 Lux LED Floodlights',
        'Pro Goalposts',
        'Covered Team Dugout',
        'Digital Scoreboard',
      ],
      imageUrl: COURT_1_IMAGE_URL,
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
      facilities: [
        '32ft High Roof Netting',
        'LED Stumps & Bats Included',
        'Floodlights',
        'Spectator Bench',
      ],
      imageUrl: COURT_2_IMAGE_URL,
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

  const coupons: CouponRecord[] = [
    {
      id: 'cp-1',
      code: 'FIRST10',
      description: '10% off on bookings above ₹800',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      minBookingAmount: 800,
      maxUses: 200,
      usedCount: 0,
      active: true,
    },
    {
      id: 'cp-2',
      code: 'TURF200',
      description: 'Flat ₹200 off on 90-min or 120-min turf sessions above ₹1400',
      discountType: 'FIXED',
      discountValue: 200,
      minBookingAmount: 1400,
      maxUses: 100,
      usedCount: 0,
      active: true,
    },
    {
      id: 'cp-3',
      code: 'NIGHT150',
      description: 'Flat ₹150 off on floodlight evening matches above ₹1200',
      discountType: 'FIXED',
      discountValue: 150,
      minBookingAmount: 1200,
      maxUses: 150,
      usedCount: 0,
      active: true,
    },
  ];

  // Clean production state: 0 dummy bookings, 0 dummy slot locks, 0 dummy notifications
  return {
    venueSettings,
    courts,
    bookings: [],
    slotLocks: {},
    coupons,
    notifications: [],
    users: [],
  };
}

function sanitizeLoadedDatabase(parsed: DatabaseShape): DatabaseShape {
  // Strip any legacy dummy seed bookings (`bk-seed-%`) and normalize court images
  const cleanBookings = (parsed.bookings || []).filter((b) => !String(b.id).startsWith('bk-seed-'));
  const cleanLocks: Record<string, SlotLockRecord> = {};
  for (const [k, lock] of Object.entries(parsed.slotLocks || {})) {
    if (lock.bookingId && String(lock.bookingId).startsWith('bk-seed-')) {
      continue;
    }
    cleanLocks[k] = lock;
  }
  const cleanCourts = (parsed.courts || []).map((c) => ({
    ...c,
    imageUrl:
      !c.imageUrl || c.imageUrl.startsWith('/src/assets/')
        ? c.id === 'court-2'
          ? COURT_2_IMAGE_URL
          : COURT_1_IMAGE_URL
        : c.imageUrl,
  }));

  return {
    ...parsed,
    courts: cleanCourts,
    bookings: cleanBookings,
    slotLocks: cleanLocks,
    notifications: (parsed.notifications || []).filter(
      (n) => !String(n.id).startsWith('notif-seed-')
    ),
    users: Array.isArray(parsed.users) ? parsed.users : [],
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
        const cleaned = sanitizeLoadedDatabase(parsed);
        fs.writeFileSync(DB_FILE, JSON.stringify(cleaned, null, 2), 'utf-8');
        return cleaned;
      }
    }
  } catch (err) {
    console.error('Error loading local DB, initializing fresh state:', err);
  }
  const seeded = createInitialSeedDatabase();
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(seeded, null, 2), 'utf-8');
  } catch {
    // ignore on read-only serverless fs
  }
  return seeded;
}

async function persistDatabase(db: DatabaseShape): Promise<void> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch {
    // Ignore on read-only serverless environment (Vercel uses Supabase)
  }
  if (isSupabaseLive) {
    await syncStateToSupabase(db);
  }
}

let dbState: DatabaseShape = loadDatabase();
let supabaseHydratedOnce = false;

async function ensureSupabaseHydrated() {
  if (isSupabaseLive && !supabaseHydratedOnce) {
    supabaseHydratedOnce = true;
    dbState = await hydrateFromSupabaseIfConfigured(dbState);
  }
}

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
    void persistDatabase(dbState);
  }
  return mutated;
}

export const app = express();
app.use(express.json({ limit: '10mb' }));

// 0. SIMPLE USERNAME & PASSWORD AUTHENTICATION (No Email Required)
app.post('/api/auth/login', async (req, res) => {
  await ensureSupabaseHydrated();
  const { username, password } = req.body || {};
  const cleanUsername = String(username || '').trim().toLowerCase();
  const cleanPassword = String(password || '').trim();

  if (!cleanUsername || !cleanPassword) {
    return res.status(400).json({ error: 'Please enter both username and password.' });
  }

  // Dedicated Turf Owner Login
  if (cleanUsername === OWNER_USERNAME && cleanPassword === OWNER_PASSWORD) {
    const ownerAccount: UserAccount = {
      id: 'owner-admin',
      username: OWNER_USERNAME,
      displayName: 'Turf Owner Admin',
      phone: dbState.venueSettings.phone,
      role: 'OWNER',
      createdAt: new Date().toISOString(),
    };
    return res.json({ user: ownerAccount });
  }

  // Customer Login
  const foundUser = dbState.users.find((u) => u.username.toLowerCase() === cleanUsername);
  if (!foundUser || foundUser.passwordPlain !== cleanPassword) {
    return res.status(401).json({
      error: 'Invalid username or password. New player? Switch to "Create Player Account".',
    });
  }

  const { passwordPlain: _removed, ...publicUser } = foundUser;
  return res.json({ user: publicUser });
});

app.post('/api/auth/register', async (req, res) => {
  await ensureSupabaseHydrated();
  const { username, password, displayName, phone } = req.body || {};
  const cleanUsername = String(username || '').trim().toLowerCase();
  const cleanPassword = String(password || '').trim();
  const cleanName = String(displayName || username || '').trim();
  const cleanPhone = String(phone || '').trim();

  if (!cleanUsername || !cleanPassword || !cleanName || !cleanPhone) {
    return res.status(400).json({
      error: 'Username, password, full name, and mobile number are required.',
    });
  }

  if (cleanUsername === OWNER_USERNAME) {
    return res.status(409).json({
      error: 'This username is reserved for the turf owner. Please choose a player username.',
    });
  }

  const existing = dbState.users.find((u) => u.username.toLowerCase() === cleanUsername);
  if (existing) {
    return res.status(409).json({
      error: 'Username already taken. Please sign in or pick another username.',
    });
  }

  const newUser: StoredUser = {
    id: `usr-${Date.now()}`,
    username: cleanUsername,
    displayName: cleanName,
    phone: cleanPhone,
    role: 'CUSTOMER',
    passwordPlain: cleanPassword,
    createdAt: new Date().toISOString(),
  };

  dbState.users.push(newUser);
  await persistDatabase(dbState);

  const { passwordPlain: _removed, ...publicUser } = newUser;
  return res.status(201).json({ user: publicUser });
});

// 1. SSE Endpoint for Live Availability & Owner Dashboard Updates
app.get('/api/events', (req, res) => {
  // On serverless platforms like Vercel, long-lived SSE connections are timed out or restricted.
  // We send headers and immediate event, and keep it safe from 500s.
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: 'CONNECTED' })}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
  } catch (err) {
    console.warn('SSE connection warning:', err);
    res.status(200).end();
  }
});

// 2. Get Complete Synchronized State (Hydrates live from Supabase when configured)
app.get('/api/state', async (_req, res) => {
  try {
    const isLive = Boolean(
      (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL) &&
        (process.env.SUPABASE_SERVICE_ROLE_KEY ||
          process.env.VITE_SUPABASE_ANON_KEY ||
          process.env.SUPABASE_ANON_KEY)
    );
    if (isLive) {
      dbState = await hydrateFromSupabaseIfConfigured(dbState);
    }
  } catch (err) {
    console.error('Supabase hydration error in /api/state:', err);
  }

  try {
    cleanupExpiredHolds();
    const { users: _hiddenUsers, ...publicState } = dbState;
    return res.json({
      ...publicState,
      supabaseConfigured: Boolean(
        process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
      ),
      serverTime: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Fatal error in /api/state:', err);
    return res.status(500).json({
      error: 'Failed to retrieve state',
      message: err?.message || String(err),
    });
  }
});

// 3. Step 1 of Customer Booking: Atomic Slot Hold & Generate Owner GPay QR Info
app.post('/api/bookings/hold', async (req, res) => {
  await ensureSupabaseHydrated();
  cleanupExpiredHolds();
  const {
    userId = 'guest',
    customerUsername = '',
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
    userId: String(customerUsername || userId).trim(),
    customerUsername: String(customerUsername || userId).trim(),
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
  await persistDatabase(dbState);
  broadcastRealtimeSync('SLOT_HELD');

  return res.status(201).json({ booking: newBooking });
});

// 4. Step 2 of Customer Booking: Upload GPay Screenshot & UTR -> Lock Slot Awaiting Owner Approval
app.post('/api/bookings/:id/upload-screenshot', async (req, res) => {
  await ensureSupabaseHydrated();
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
  const storedScreenshotUrl = await uploadImageToSupabaseStorage(
    screenshotDataUrl,
    `receipt-${booking.bookingReference}`
  );

  booking.status = 'AWAITING_OWNER_APPROVAL';
  booking.paymentStatus = 'SCREENSHOT_UPLOADED';
  booking.screenshotDataUrl = storedScreenshotUrl;
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

  await persistDatabase(dbState);
  broadcastRealtimeSync('SCREENSHOT_UPLOADED');

  return res.json({ booking });
});

// 5. ONE-CLICK OWNER APPROVAL: Verify GPay Screenshot & Confirm Slot
app.post('/api/admin/bookings/:id/confirm-gpay', async (req, res) => {
  await ensureSupabaseHydrated();
  const { id } = req.params;
  const { ownerEmail = 'owner' } = req.body || {};

  const idx = dbState.bookings.findIndex((b) => b.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  if (isSupabaseLive) {
    await invokeSupabaseOwnerConfirmRpc(id, ownerEmail);
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

  await persistDatabase(dbState);
  broadcastRealtimeSync('OWNER_CONFIRMED_GPAY');

  return res.json({ booking: updatedBooking });
});

// 6. OWNER REJECT SCREENSHOT & RELEASE SLOT
app.post('/api/admin/bookings/:id/reject-gpay', async (req, res) => {
  await ensureSupabaseHydrated();
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

  await deleteBookingLocksFromSupabase(booking.id);

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

  await persistDatabase(dbState);
  broadcastRealtimeSync('OWNER_REJECTED_GPAY');

  return res.json({ booking });
});

// 7. OWNER COLLECT REMAINING BALANCE AT TURF COUNTER
app.post('/api/admin/bookings/:id/collect-balance', async (req, res) => {
  await ensureSupabaseHydrated();
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

  await persistDatabase(dbState);
  broadcastRealtimeSync('BALANCE_COLLECTED');

  return res.json({ booking });
});

// 8. OWNER WALK-IN COUNTER BOOKING (Synchronizes with Online Grid Instantly)
app.post('/api/admin/bookings/walk-in', async (req, res) => {
  await ensureSupabaseHydrated();
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
      error: 'Walk-in customer name, phone, court, date, and start time are required.',
    });
  }

  const court = dbState.courts.find((c) => c.id === courtId && c.active);
  if (!court) {
    return res.status(404).json({ error: 'Selected court not found.' });
  }

  const nowIso = new Date().toISOString();
  const unitKeys = generateAtomicUnitKeys(courtId, bookingDate, startTime, Number(durationMinutes), 30);

  const availability = checkUnitsAvailability(unitKeys, dbState.slotLocks, nowIso);
  if (!availability.available) {
    return res.status(409).json({
      error:
        'Cannot create walk-in: This slot is already locked by an online reservation or another walk-in.',
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
    userId: 'walk-in-counter',
    customerUsername: 'walk-in-counter',
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
  await persistDatabase(dbState);
  broadcastRealtimeSync('WALK_IN_CREATED');

  return res.status(201).json({ booking: walkInBooking });
});

// 9. CANCEL BOOKING (Customer or Owner)
app.post('/api/bookings/:id/cancel', async (req, res) => {
  await ensureSupabaseHydrated();
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

  await deleteBookingLocksFromSupabase(booking.id);
  await persistDatabase(dbState);
  broadcastRealtimeSync('BOOKING_CANCELLED');

  return res.json({ booking });
});

// 10. UPDATE OWNER VENUE & GPAY QR SETTINGS
app.put('/api/admin/settings', async (req, res) => {
  await ensureSupabaseHydrated();
  const uploadedQrUrl = req.body.ownerQrCustomUrl
    ? await uploadImageToSupabaseStorage(req.body.ownerQrCustomUrl, 'owner-gpay-qr')
    : '';
  dbState.venueSettings = {
    ...dbState.venueSettings,
    ...req.body,
    ownerQrCustomUrl: uploadedQrUrl,
    advancePercentage: Number(
      req.body.advancePercentage ?? dbState.venueSettings.advancePercentage
    ),
    holdDurationMinutes: Number(
      req.body.holdDurationMinutes ?? dbState.venueSettings.holdDurationMinutes
    ),
  };
  await persistDatabase(dbState);
  broadcastRealtimeSync('SETTINGS_UPDATED');
  return res.json({ venueSettings: dbState.venueSettings });
});

// 11. UPDATE COURT PRICING OR DETAILS
app.put('/api/admin/courts/:id', async (req, res) => {
  await ensureSupabaseHydrated();
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
  await persistDatabase(dbState);
  broadcastRealtimeSync('COURT_UPDATED');
  return res.json({ court: dbState.courts[idx] });
});

// 12. BLOCK / UNBLOCK MAINTENANCE SLOT
app.post('/api/admin/toggle-block', async (req, res) => {
  await ensureSupabaseHydrated();
  const {
    courtId,
    bookingDate,
    startTime,
    durationMinutes = 60,
    reason = 'Maintenance Block',
  } = req.body;
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
      return res
        .status(409)
        .json({ error: 'Cannot block a slot that already has an active booking.' });
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

  await persistDatabase(dbState);
  broadcastRealtimeSync('MAINTENANCE_TOGGLED');
  return res.json({ slotLocks: dbState.slotLocks });
});

// 13. MARK NOTIFICATIONS READ
app.post('/api/notifications/mark-read', async (_req, res) => {
  for (const n of dbState.notifications) {
    n.read = true;
  }
  await persistDatabase(dbState);
  return res.json({ notifications: dbState.notifications });
});

async function startServer() {
  await ensureSupabaseHydrated();

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

// Start standalone HTTP server when executed directly (local dev / Cloud Run), skip when imported by Vercel serverless
if (!process.env.VERCEL) {
  startServer();
}
