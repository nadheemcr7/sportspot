import {
  BookingRecord,
  CouponRecord,
  Court,
  NotificationItem,
  SlotLockRecord,
  SportType,
  UserAccount,
  VenueSettings,
} from '../types/sportspot';
import {
  applyOwnerOneClickConfirmation,
  calculatePriceBreakdown,
  checkUnitsAvailability,
  generateAtomicUnitKeys,
  minutesToTime,
  timeToMinutes,
} from '../utils/bookingEngine';
import { COURT_1_IMAGE_URL, COURT_2_IMAGE_URL } from './supabaseRest';

const LOCAL_STATE_CACHE_KEY = 'sportspot_BrowserState_v2';
const LOCAL_USERS_CACHE_KEY = 'sportspot_RegisteredUsers_v2';

interface BrowserStateShape {
  venueSettings: VenueSettings;
  courts: Court[];
  bookings: BookingRecord[];
  slotLocks: Record<string, SlotLockRecord>;
  coupons: CouponRecord[];
  notifications: NotificationItem[];
}

function getBrowserSupabaseConfig() {
  const env = (import.meta as any).env || {};
  const url = String(env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.VITE_SUPABASE_ANON_KEY || '');
  const enabled = Boolean(
    url &&
      key &&
      !url.includes('your-project-id') &&
      !key.includes('your-supabase') &&
      !key.includes('your-anon')
  );
  return { url, key, enabled };
}

function buildSupabaseHeaders(key: string, extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function getDefaultBrowserState(): BrowserStateShape {
  const env = (import.meta as any).env || {};
  return {
    venueSettings: {
      venueName: 'SportSpot Arena — Electronic City Phase I',
      address: 'Plot 42, Velankani Tech Park Road, Electronic City, Bengaluru 560100',
      phone: '+91 98450 77210',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      ownerUpiId: env.VITE_OWNER_GPAY_UPI_ID || 'sportspot.arena@okaxis',
      ownerMerchantName: env.VITE_OWNER_GPAY_MERCHANT_NAME || 'SportSpot Arena Turf',
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
    },
    courts: [
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
    ],
    bookings: [],
    slotLocks: {},
    coupons: [
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
    ],
    notifications: [],
  };
}

function loadLocalBrowserState(): BrowserStateShape {
  try {
    const raw = localStorage.getItem(LOCAL_STATE_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.venueSettings && Array.isArray(parsed.courts)) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return getDefaultBrowserState();
}

function saveLocalBrowserState(state: BrowserStateShape) {
  try {
    localStorage.setItem(LOCAL_STATE_CACHE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

async function uploadBrowserImageToSupabase(dataUrl: string, prefix: string): Promise<string> {
  const { url, key, enabled } = getBrowserSupabaseConfig();
  if (!enabled || !dataUrl || dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
    return dataUrl;
  }
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const ext = (blob.type.split('/')[1] || 'png').replace('+xml', '');
    const filePath = `${prefix}-${Date.now()}.${ext}`;
    const uploadRes = await fetch(`${url}/storage/v1/object/gpay-proofs/${filePath}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': blob.type || 'image/png',
        'x-upsert': 'true',
      },
      body: blob,
    });
    if (uploadRes.ok) {
      return `${url}/storage/v1/object/public/gpay-proofs/${filePath}`;
    }
  } catch {
    // fallback to dataUrl
  }
  return dataUrl;
}

async function hydrateBrowserStateFromSupabase(): Promise<BrowserStateShape> {
  const local = loadLocalBrowserState();
  const { url, key, enabled } = getBrowserSupabaseConfig();
  if (!enabled) return local;

  try {
    const [courtsRes, bookingsRes, locksRes, settingsRes, couponsRes] = await Promise.all([
      fetch(`${url}/rest/v1/courts?select=*`, { headers: buildSupabaseHeaders(key) }),
      fetch(`${url}/rest/v1/bookings?select=*&order=created_at.desc`, {
        headers: buildSupabaseHeaders(key),
      }),
      fetch(`${url}/rest/v1/slot_locks?select=*`, { headers: buildSupabaseHeaders(key) }),
      fetch(`${url}/rest/v1/venue_settings?select=*&limit=1`, {
        headers: buildSupabaseHeaders(key),
      }),
      fetch(`${url}/rest/v1/coupons?select=*`, { headers: buildSupabaseHeaders(key) }),
    ]);

    if (!courtsRes.ok || !bookingsRes.ok) return local;

    const courtsRows = await courtsRes.json();
    const bookingsRows = await bookingsRes.json();
    const locksRows = locksRes.ok ? await locksRes.json() : [];
    const settingsRows = settingsRes.ok ? await settingsRes.json() : [];
    const couponsRows = couponsRes.ok ? await couponsRes.json() : [];

    if (!Array.isArray(courtsRows) || courtsRows.length === 0) {
      await syncBrowserStateToSupabase(local);
      return local;
    }

    const courts: Court[] = courtsRows.map((r: any) => ({
      id: r.id,
      name: r.name,
      sportTypes: (r.sport_types || ['Football']) as SportType[],
      capacity: r.capacity,
      surface: r.surface,
      facilities: r.facilities || [],
      imageUrl:
        !r.image_url || String(r.image_url).startsWith('/src/assets/')
          ? r.id === 'court-2'
            ? COURT_2_IMAGE_URL
            : COURT_1_IMAGE_URL
          : r.image_url,
      active: Boolean(r.active),
      slotIntervalMinutes: Number(r.slot_interval_minutes || 30),
      allowedDurations: r.allowed_durations || [60, 90, 120],
      pricing: {
        weekdayMorningRate: Number(r.weekday_morning_rate || 1000),
        weekdayEveningRate: Number(r.weekday_evening_rate || 1400),
        weekendMorningRate: Number(r.weekend_morning_rate || 1200),
        weekendEveningRate: Number(r.weekend_evening_rate || 1600),
        peakStartHour: Number(r.peak_start_hour || 17),
      },
    }));

    const bookings: BookingRecord[] = (Array.isArray(bookingsRows) ? bookingsRows : [])
      .filter((r: any) => !String(r.id).startsWith('bk-seed-'))
      .map((r: any) => ({
        id: r.id,
        bookingReference: r.booking_reference,
        userId: r.user_id,
        customerUsername: r.user_id,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        customerEmail: r.customer_email,
        courtId: r.court_id,
        courtName: r.court_name,
        sport: r.sport as SportType,
        bookingDate: r.booking_date,
        startTime: r.start_time,
        endTime: r.end_time,
        durationMinutes: Number(r.duration_minutes),
        unitKeys: r.unit_keys || [],
        source: r.source,
        status: r.status,
        paymentStatus: r.payment_status,
        paymentMethod: r.payment_method,
        baseAmount: Number(r.base_amount),
        discountAmount: Number(r.discount_amount || 0),
        totalAmount: Number(r.total_amount),
        advanceAmount: Number(r.advance_amount),
        paidAmount: Number(r.paid_amount || 0),
        balanceAmount: Number(r.balance_amount),
        couponCode: r.coupon_code,
        upiReferenceUtr: r.upi_reference_utr,
        screenshotDataUrl: r.screenshot_url,
        screenshotUploadedAt: r.screenshot_uploaded_at,
        ownerVerifiedAt: r.owner_verified_at,
        ownerVerifiedBy: r.owner_verified_by,
        rejectionReason: r.rejection_reason,
        holdExpiresAt: r.hold_expires_at,
        notes: r.notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));

    const bookingsById = new Map(bookings.map((b) => [b.id, b]));
    const slotLocks: Record<string, SlotLockRecord> = {};
    for (const l of Array.isArray(locksRows) ? locksRows : []) {
      if (l.booking_id && String(l.booking_id).startsWith('bk-seed-')) continue;
      const linkedBooking = l.booking_id ? bookingsById.get(l.booking_id) : undefined;
      slotLocks[l.slot_key] = {
        slotKey: l.slot_key,
        courtId: l.court_id,
        bookingDate: l.booking_date,
        unitTime: l.unit_time,
        bookingId: l.booking_id || undefined,
        source: linkedBooking?.source,
        status: l.status,
        holdExpiresAt: l.hold_expires_at,
        reason: l.reason,
        customerName: linkedBooking?.customerName,
        updatedAt: l.updated_at,
      };
    }

    const sRow = Array.isArray(settingsRows) ? settingsRows[0] : null;
    const venueSettings: VenueSettings = sRow
      ? {
          venueName: sRow.venue_name,
          address: sRow.address,
          phone: sRow.phone,
          timezone: sRow.timezone || 'Asia/Kolkata',
          currency: sRow.currency || 'INR',
          ownerUpiId: sRow.owner_upi_id,
          ownerMerchantName: sRow.owner_merchant_name,
          ownerQrCustomUrl: sRow.owner_qr_image_url || undefined,
          advancePercentage: Number(sRow.advance_percentage || 30),
          holdDurationMinutes: Number(sRow.hold_duration_minutes || 10),
          openingTime: sRow.opening_time || sRow.opening_Time || '06:00',
          closingTime: sRow.closing_time || sRow.closing_Time || '23:00',
          facilities: local.venueSettings.facilities,
        }
      : local.venueSettings;

    const coupons: CouponRecord[] =
      Array.isArray(couponsRows) && couponsRows.length > 0
        ? couponsRows.map((c: any) => ({
            id: c.id,
            code: c.code,
            description: c.description,
            discountType: c.discount_type,
            discountValue: Number(c.discount_value),
            minBookingAmount: Number(c.min_booking_amount),
            maxUses: Number(c.max_uses),
            usedCount: Number(c.used_count || 0),
            active: Boolean(c.active),
          }))
        : local.coupons;

    const hydrated: BrowserStateShape = {
      venueSettings,
      courts,
      bookings,
      slotLocks,
      coupons,
      notifications: local.notifications || [],
    };
    saveLocalBrowserState(hydrated);
    return hydrated;
  } catch {
    return local;
  }
}

async function syncBrowserStateToSupabase(state: BrowserStateShape): Promise<void> {
  saveLocalBrowserState(state);
  const { url, key, enabled } = getBrowserSupabaseConfig();
  if (!enabled) return;

  try {
    const upsertHeaders = buildSupabaseHeaders(key, {
      Prefer: 'resolution=merge-duplicates',
    });

    const courtRows = state.courts.map((c) => ({
      id: c.id,
      name: c.name,
      sport_types: c.sportTypes,
      capacity: c.capacity,
      surface: c.surface,
      facilities: c.facilities,
      image_url: c.imageUrl,
      active: c.active,
      slot_interval_minutes: c.slotIntervalMinutes,
      allowed_durations: c.allowedDurations,
      weekday_morning_rate: c.pricing.weekdayMorningRate,
      weekday_evening_rate: c.pricing.weekdayEveningRate,
      weekend_morning_rate: c.pricing.weekendMorningRate,
      weekend_evening_rate: c.pricing.weekendEveningRate,
      peak_start_hour: c.pricing.peakStartHour,
    }));
    await fetch(`${url}/rest/v1/courts`, {
      method: 'POST',
      headers: upsertHeaders,
      body: JSON.stringify(courtRows),
    });

    const existingSettingsRes = await fetch(`${url}/rest/v1/venue_settings?select=id&limit=1`, {
      headers: buildSupabaseHeaders(key),
    });
    const existingSettings = existingSettingsRes.ok ? await existingSettingsRes.json() : [];
    const settingsPayload: Record<string, any> = {
      venue_name: state.venueSettings.venueName,
      address: state.venueSettings.address,
      phone: state.venueSettings.phone,
      timezone: state.venueSettings.timezone,
      currency: state.venueSettings.currency,
      owner_upi_id: state.venueSettings.ownerUpiId,
      owner_merchant_name: state.venueSettings.ownerMerchantName,
      owner_qr_image_url: state.venueSettings.ownerQrCustomUrl || null,
      advance_percentage: state.venueSettings.advancePercentage,
      hold_duration_minutes: state.venueSettings.holdDurationMinutes,
      updated_at: new Date().toISOString(),
    };
    if (Array.isArray(existingSettings) && existingSettings[0]?.id) {
      settingsPayload.id = existingSettings[0].id;
    }
    await fetch(`${url}/rest/v1/venue_settings`, {
      method: 'POST',
      headers: upsertHeaders,
      body: JSON.stringify([settingsPayload]),
    });

    if (state.bookings.length > 0) {
      const bookingRows = state.bookings.map((b) => ({
        id: b.id,
        booking_reference: b.bookingReference,
        user_id: b.userId,
        customer_name: b.customerName,
        customer_phone: b.customerPhone,
        customer_email: b.customerEmail,
        court_id: b.courtId,
        court_name: b.courtName,
        sport: b.sport,
        booking_date: b.bookingDate,
        start_time: b.startTime,
        end_time: b.endTime,
        duration_minutes: b.durationMinutes,
        unit_keys: b.unitKeys,
        source: b.source,
        status: b.status,
        payment_status: b.paymentStatus,
        payment_method: b.paymentMethod,
        base_amount: b.baseAmount,
        discount_amount: b.discountAmount,
        total_amount: b.totalAmount,
        advance_amount: b.advanceAmount,
        paid_amount: b.paidAmount,
        balance_amount: b.balanceAmount,
        coupon_code: b.couponCode || null,
        upi_reference_utr: b.upiReferenceUtr || null,
        screenshot_url: b.screenshotDataUrl || null,
        screenshot_uploaded_at: b.screenshotUploadedAt || null,
        owner_verified_at: b.ownerVerifiedAt || null,
        owner_verified_by: b.ownerVerifiedBy || null,
        rejection_reason: b.rejectionReason || null,
        hold_expires_at: b.holdExpiresAt || null,
        notes: b.notes || null,
        created_at: b.createdAt,
        updated_at: b.updatedAt,
      }));
      await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: upsertHeaders,
        body: JSON.stringify(bookingRows),
      });
    }

    await fetch(`${url}/rest/v1/slot_locks?slot_key=neq.__none__`, {
      method: 'DELETE',
      headers: buildSupabaseHeaders(key),
    });
    const lockValues = Object.values(state.slotLocks);
    if (lockValues.length > 0) {
      const lockRows = lockValues.map((l) => ({
        slot_key: l.slotKey,
        court_id: l.courtId,
        booking_date: l.bookingDate,
        unit_time: l.unitTime,
        booking_id: l.bookingId || null,
        status: l.status,
        hold_expires_at: l.holdExpiresAt || null,
        reason: l.reason || null,
        updated_at: l.updatedAt,
      }));
      await fetch(`${url}/rest/v1/slot_locks`, {
        method: 'POST',
        headers: upsertHeaders,
        body: JSON.stringify(lockRows),
      });
    }
  } catch {
    // ignore background sync warnings
  }
}

/**
 * Executes a client-side fallback directly against Supabase + localStorage if a serverless `/api/*` call fails.
 */
async function executeClientFallback(
  path: string,
  method: string,
  body: any
): Promise<{ ok: boolean; status: number; data: any }> {
  const state = await hydrateBrowserStateFromSupabase();

  // 1. GET /api/state
  if (path === '/api/state' && method === 'GET') {
    return {
      ok: true,
      status: 200,
      data: {
        ...state,
        supabaseConfigured: getBrowserSupabaseConfig().enabled,
        serverTime: new Date().toISOString(),
      },
    };
  }

  // 2. POST /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') {
    const cleanUsername = String(body?.username || '').trim().toLowerCase();
    const cleanPassword = String(body?.password || '').trim();
    if (!cleanUsername || !cleanPassword) {
      return {
        ok: false,
        status: 400,
        data: { error: 'Please enter both username and password.' },
      };
    }

    if (cleanUsername === 'owner' && cleanPassword === 'sportspot123') {
      const ownerUser: UserAccount = {
        id: 'owner-admin',
        username: 'owner',
        displayName: 'Turf Owner Admin',
        phone: state.venueSettings.phone,
        role: 'OWNER',
        createdAt: new Date().toISOString(),
      };
      return { ok: true, status: 200, data: { user: ownerUser } };
    }

    let storedUsers: Array<UserAccount & { passwordPlain: string }> = [];
    try {
      storedUsers = JSON.parse(localStorage.getItem(LOCAL_USERS_CACHE_KEY) || '[]');
    } catch {
      storedUsers = [];
    }

    const matched = storedUsers.find((u) => u.username.toLowerCase() === cleanUsername);
    if (matched && matched.passwordPlain !== cleanPassword) {
      return {
        ok: false,
        status: 401,
        data: { error: 'Invalid username or password.' },
      };
    }

    const user: UserAccount = matched
      ? {
          id: matched.id,
          username: matched.username,
          displayName: matched.displayName,
          phone: matched.phone,
          role: 'CUSTOMER',
          createdAt: matched.createdAt,
        }
      : {
          id: `usr-${cleanUsername}`,
          username: cleanUsername,
          displayName: cleanUsername,
          phone: '',
          role: 'CUSTOMER',
          createdAt: new Date().toISOString(),
        };

    return { ok: true, status: 200, data: { user } };
  }

  // 3. POST /api/auth/register
  if (path === '/api/auth/register' && method === 'POST') {
    const cleanUsername = String(body?.username || '').trim().toLowerCase();
    const cleanPassword = String(body?.password || '').trim();
    const cleanName = String(body?.displayName || cleanUsername).trim();
    const cleanPhone = String(body?.phone || '').trim();

    if (!cleanUsername || !cleanPassword || !cleanName || !cleanPhone) {
      return {
        ok: false,
        status: 400,
        data: { error: 'Username, password, full name, and mobile number are required.' },
      };
    }
    if (cleanUsername === 'owner') {
      return {
        ok: false,
        status: 409,
        data: { error: 'This username is reserved for the turf owner.' },
      };
    }

    let storedUsers: Array<UserAccount & { passwordPlain: string }> = [];
    try {
      storedUsers = JSON.parse(localStorage.getItem(LOCAL_USERS_CACHE_KEY) || '[]');
    } catch {
      storedUsers = [];
    }

    const newUser: UserAccount & { passwordPlain: string } = {
      id: `usr-${Date.now()}`,
      username: cleanUsername,
      displayName: cleanName,
      phone: cleanPhone,
      role: 'CUSTOMER',
      passwordPlain: cleanPassword,
      createdAt: new Date().toISOString(),
    };
    storedUsers = [
      ...storedUsers.filter((u) => u.username.toLowerCase() !== cleanUsername),
      newUser,
    ];
    try {
      localStorage.setItem(LOCAL_USERS_CACHE_KEY, JSON.stringify(storedUsers));
    } catch {
      // ignore
    }

    const { passwordPlain: _removed, ...publicUser } = newUser;
    return { ok: true, status: 201, data: { user: publicUser } };
  }

  // 4. POST /api/bookings/hold
  if (path === '/api/bookings/hold' && method === 'POST') {
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
    } = body || {};

    const court = state.courts.find((c) => c.id === courtId && c.active) || state.courts[0];
    const nowIso = new Date().toISOString();
    const unitKeys = generateAtomicUnitKeys(
      court.id,
      bookingDate,
      startTime,
      Number(durationMinutes),
      30
    );

    const availability = checkUnitsAvailability(unitKeys, state.slotLocks, nowIso);
    if (!availability.available) {
      return {
        ok: false,
        status: 409,
        data: { error: 'This slot was just reserved. Please select another time.' },
      };
    }

    const matchedCoupon = couponCode
      ? state.coupons.find(
          (c) => c.code.toUpperCase() === String(couponCode).trim().toUpperCase() && c.active
        )
      : null;

    const price = calculatePriceBreakdown({
      court,
      bookingDate,
      startTime,
      durationMinutes: Number(durationMinutes),
      advancePercentage: state.venueSettings.advancePercentage,
      coupon: matchedCoupon,
      payFullOnline: Boolean(payFullOnline),
    });

    const endTime = minutesToTime(timeToMinutes(startTime) + Number(durationMinutes));
    const holdExpiresAt = new Date(
      Date.now() + state.venueSettings.holdDurationMinutes * 60 * 1000
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
      state.slotLocks[key] = {
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

    state.bookings.unshift(newBooking);
    await syncBrowserStateToSupabase(state);
    return { ok: true, status: 201, data: { booking: newBooking } };
  }

  // 5. POST /api/bookings/:id/upload-screenshot
  const uploadMatch = path.match(/^\/api\/bookings\/([^/]+)\/upload-screenshot$/);
  if (uploadMatch && method === 'POST') {
    const bookingId = uploadMatch[1];
    const booking = state.bookings.find((b) => b.id === bookingId);
    if (!booking) {
      return { ok: false, status: 404, data: { error: 'Booking not found.' } };
    }

    const nowIso = new Date().toISOString();
    const cleanUtr =
      String(body?.upiReferenceUtr || '').trim() || `UTR${Date.now().toString().slice(-8)}`;
    const storedUrl = await uploadBrowserImageToSupabase(
      body?.screenshotDataUrl,
      `receipt-${booking.bookingReference}`
    );

    booking.status = 'AWAITING_OWNER_APPROVAL';
    booking.paymentStatus = 'SCREENSHOT_UPLOADED';
    booking.screenshotDataUrl = storedUrl;
    booking.upiReferenceUtr = cleanUtr;
    booking.screenshotUploadedAt = nowIso;
    booking.holdExpiresAt = null;
    booking.updatedAt = nowIso;

    for (const key of booking.unitKeys) {
      state.slotLocks[key] = {
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

    await syncBrowserStateToSupabase(state);
    return { ok: true, status: 200, data: { booking } };
  }

  // 6. POST /api/admin/bookings/:id/confirm-gpay
  const confirmMatch = path.match(/^\/api\/admin\/bookings\/([^/]+)\/confirm-gpay$/);
  if (confirmMatch && method === 'POST') {
    const bookingId = confirmMatch[1];
    const idx = state.bookings.findIndex((b) => b.id === bookingId);
    if (idx === -1) {
      return { ok: false, status: 404, data: { error: 'Booking not found.' } };
    }

    const nowIso = new Date().toISOString();
    const updatedBooking = applyOwnerOneClickConfirmation(
      state.bookings[idx],
      body?.ownerEmail || 'owner',
      nowIso
    );
    state.bookings[idx] = updatedBooking;

    for (const key of updatedBooking.unitKeys) {
      state.slotLocks[key] = {
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

    await syncBrowserStateToSupabase(state);
    return { ok: true, status: 200, data: { booking: updatedBooking } };
  }

  // 7. POST /api/admin/bookings/:id/reject-gpay
  const rejectMatch = path.match(/^\/api\/admin\/bookings\/([^/]+)\/reject-gpay$/);
  if (rejectMatch && method === 'POST') {
    const bookingId = rejectMatch[1];
    const booking = state.bookings.find((b) => b.id === bookingId);
    if (!booking) {
      return { ok: false, status: 404, data: { error: 'Booking not found.' } };
    }

    booking.status = 'REJECTED';
    booking.paymentStatus = 'REJECTED';
    booking.rejectionReason = body?.reason || 'Declined by owner';
    booking.updatedAt = new Date().toISOString();

    for (const key of booking.unitKeys) {
      if (state.slotLocks[key]?.bookingId === booking.id) {
        delete state.slotLocks[key];
      }
    }

    await syncBrowserStateToSupabase(state);
    return { ok: true, status: 200, data: { booking } };
  }

  // 8. POST /api/admin/bookings/:id/collect-balance
  const collectMatch = path.match(/^\/api\/admin\/bookings\/([^/]+)\/collect-balance$/);
  if (collectMatch && method === 'POST') {
    const bookingId = collectMatch[1];
    const booking = state.bookings.find((b) => b.id === bookingId);
    if (!booking) {
      return { ok: false, status: 404, data: { error: 'Booking not found.' } };
    }

    booking.paidAmount = booking.totalAmount;
    booking.balanceAmount = 0;
    booking.paymentStatus = 'FULLY_PAID';
    booking.updatedAt = new Date().toISOString();

    await syncBrowserStateToSupabase(state);
    return { ok: true, status: 200, data: { booking } };
  }

  // 9. POST /api/admin/bookings/walk-in
  if (path === '/api/admin/bookings/walk-in' && method === 'POST') {
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
    } = body || {};

    const court = state.courts.find((c) => c.id === courtId) || state.courts[0];
    const nowIso = new Date().toISOString();
    const unitKeys = generateAtomicUnitKeys(
      court.id,
      bookingDate,
      startTime,
      Number(durationMinutes),
      30
    );

    const price = calculatePriceBreakdown({
      court,
      bookingDate,
      startTime,
      durationMinutes: Number(durationMinutes),
      advancePercentage: state.venueSettings.advancePercentage,
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
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    for (const key of unitKeys) {
      state.slotLocks[key] = {
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

    state.bookings.unshift(walkInBooking);
    await syncBrowserStateToSupabase(state);
    return { ok: true, status: 201, data: { booking: walkInBooking } };
  }

  // 10. POST /api/bookings/:id/cancel
  const cancelMatch = path.match(/^\/api\/bookings\/([^/]+)\/cancel$/);
  if (cancelMatch && method === 'POST') {
    const bookingId = cancelMatch[1];
    const booking = state.bookings.find((b) => b.id === bookingId);
    if (!booking) {
      return { ok: false, status: 404, data: { error: 'Booking not found.' } };
    }
    booking.status = 'CANCELLED';
    booking.updatedAt = new Date().toISOString();
    for (const key of booking.unitKeys) {
      if (state.slotLocks[key]?.bookingId === booking.id) {
        delete state.slotLocks[key];
      }
    }
    await syncBrowserStateToSupabase(state);
    return { ok: true, status: 200, data: { booking } };
  }

  // 11. PUT /api/admin/settings
  if (path === '/api/admin/settings' && method === 'PUT') {
    const uploadedQr = body?.ownerQrCustomUrl
      ? await uploadBrowserImageToSupabase(body.ownerQrCustomUrl, 'owner-gpay-qr')
      : '';
    state.venueSettings = {
      ...state.venueSettings,
      ...body,
      ownerQrCustomUrl: uploadedQr,
    };
    await syncBrowserStateToSupabase(state);
    return { ok: true, status: 200, data: { venueSettings: state.venueSettings } };
  }

  // 12. POST /api/admin/toggle-block
  if (path === '/api/admin/toggle-block' && method === 'POST') {
    const {
      courtId,
      bookingDate,
      startTime,
      durationMinutes = 60,
      reason = 'Maintenance Block',
    } = body || {};
    const unitKeys = generateAtomicUnitKeys(
      courtId,
      bookingDate,
      startTime,
      Number(durationMinutes),
      30
    );
    const nowIso = new Date().toISOString();
    const firstLock = state.slotLocks[unitKeys[0]];
    if (firstLock && firstLock.status === 'BLOCKED') {
      for (const k of unitKeys) {
        if (state.slotLocks[k]?.status === 'BLOCKED') {
          delete state.slotLocks[k];
        }
      }
    } else {
      for (const k of unitKeys) {
        state.slotLocks[k] = {
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
    await syncBrowserStateToSupabase(state);
    return { ok: true, status: 200, data: { slotLocks: state.slotLocks } };
  }

  return { ok: false, status: 404, data: { error: 'Endpoint not found' } };
}

/**
 * Universal safe API helper that calls the backend `/api/*` endpoint, safely parses JSON,
 * and if the serverless endpoint ever returns a 500 or non-JSON text, seamlessly executes
 * the operation against Supabase + browser state.
 */
export async function safeApiJson<T = any>(
  url: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data: T }> {
  const method = (options?.method || 'GET').toUpperCase();
  const parsedBody =
    typeof options?.body === 'string'
      ? (() => {
          try {
            return JSON.parse(options.body as string);
          } catch {
            return {};
          }
        })()
      : undefined;

  try {
    const res = await fetch(url, options);
    const rawText = await res.text();
    let json: any = null;
    try {
      json = rawText ? JSON.parse(rawText) : {};
    } catch {
      json = null;
    }

    // If the server responded with valid JSON and didn't crash with 500/502/504, return it directly
    if (json !== null && res.status < 500) {
      return { ok: res.ok, status: res.status, data: json as T };
    }
  } catch {
    // Network error -> proceed to client-side Supabase fallback
  }

  const fallback = await executeClientFallback(url, method, parsedBody);
  return fallback as { ok: boolean; status: number; data: T };
}
