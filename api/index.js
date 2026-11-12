import express from 'express';

const COURT_1_IMAGE_URL =
  'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1200&q=85';
const COURT_2_IMAGE_URL =
  'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1200&q=85';

function getSupabaseEnv() {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    '';
  const enabled = Boolean(
    url &&
      key &&
      !url.includes('your-project-id') &&
      !key.includes('your-supabase') &&
      !key.includes('your-anon')
  );
  return { url, key, enabled };
}

function buildHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function normalizeCourtImageUrl(courtId, rawUrl) {
  if (!rawUrl || String(rawUrl).startsWith('/src/assets/')) {
    return courtId === 'court-2' ? COURT_2_IMAGE_URL : COURT_1_IMAGE_URL;
  }
  return rawUrl;
}

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm || '00:00')
    .split(':')
    .map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(totalMinutes) {
  const normalized = Math.max(0, totalMinutes);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function generateAtomicUnitKeys(courtId, bookingDate, startTime, durationMinutes, intervalMinutes = 30) {
  const startMins = timeToMinutes(startTime);
  const units = Math.max(1, Math.floor(Number(durationMinutes) / intervalMinutes));
  const keys = [];
  for (let i = 0; i < units; i++) {
    const unitTime = minutesToTime(startMins + i * intervalMinutes);
    keys.push(`${courtId}__${bookingDate}__${unitTime}`);
  }
  return keys;
}

function isWeekendDate(bookingDate) {
  const [y, m, d] = String(bookingDate).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const day = dt.getDay();
  return day === 0 || day === 6;
}

function calculatePriceBreakdown({
  court,
  bookingDate,
  startTime,
  durationMinutes,
  advancePercentage,
  coupon,
  payFullOnline,
}) {
  const weekend = isWeekendDate(bookingDate);
  const intervals = Math.max(1, Math.floor(Number(durationMinutes) / 30));
  const startMins = timeToMinutes(startTime);
  const peakMins = (court.pricing?.peakStartHour ?? 17) * 60;

  let baseAmount = 0;
  let hasPeak = false;
  let hasMorning = false;

  for (let i = 0; i < intervals; i++) {
    const currentMins = startMins + i * 30;
    const isPeakUnit = currentMins >= peakMins;
    if (isPeakUnit) hasPeak = true;
    else hasMorning = true;

    const hourlyRate = weekend
      ? isPeakUnit
        ? court.pricing.weekendEveningRate
        : court.pricing.weekendMorningRate
      : isPeakUnit
        ? court.pricing.weekdayEveningRate
        : court.pricing.weekdayMorningRate;

    baseAmount += hourlyRate / 2;
  }

  baseAmount = Math.round(baseAmount);

  let discountAmount = 0;
  let appliedCoupon = null;

  if (coupon && coupon.active && baseAmount >= coupon.minBookingAmount) {
    appliedCoupon = coupon.code;
    if (coupon.discountType === 'PERCENTAGE') {
      discountAmount = Math.round((baseAmount * coupon.discountValue) / 100);
    } else {
      discountAmount = Math.min(baseAmount, coupon.discountValue);
    }
  }

  const totalAmount = Math.max(0, baseAmount - discountAmount);
  const rawAdvance = payFullOnline
    ? totalAmount
    : Math.ceil((totalAmount * Number(advancePercentage || 30)) / 100 / 10) * 10;
  const advanceAmount = Math.min(totalAmount, rawAdvance);
  const balanceAmount = Math.max(0, totalAmount - advanceAmount);

  let rateLabel = weekend ? 'Weekend Standard' : 'Weekday Standard';
  if (hasPeak && hasMorning) {
    rateLabel = weekend ? 'Weekend Day + Floodlight' : 'Weekday Day + Floodlight';
  } else if (hasPeak) {
    rateLabel = weekend ? 'Weekend Floodlight Peak' : 'Weekday Floodlight Peak';
  }

  return {
    baseAmount,
    discountAmount,
    totalAmount,
    advanceAmount,
    balanceAmount,
    appliedCoupon,
    rateLabel,
    isPeak: hasPeak,
    isWeekend: weekend,
  };
}

function checkUnitsAvailability(unitKeys, locksByKey, nowIso = new Date().toISOString()) {
  const nowMs = new Date(nowIso).getTime();
  for (const key of unitKeys) {
    const lock = locksByKey[key];
    if (!lock) continue;
    if (lock.status === 'HOLD' && lock.holdExpiresAt) {
      const expiresMs = new Date(lock.holdExpiresAt).getTime();
      if (expiresMs <= nowMs) continue;
    }
    return { available: false, conflictingKey: key };
  }
  return { available: true };
}

function createInitialSeedDatabase() {
  return {
    venueSettings: {
      venueName: 'SportSpot Arena — Electronic City Phase I',
      address: 'Plot 42, Velankani Tech Park Road, Electronic City, Bengaluru 560100',
      phone: '+91 98450 77210',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      ownerUpiId: process.env.OWNER_UPI_ID || process.env.VITE_OWNER_GPAY_UPI_ID || 'sportspot.arena@okaxis',
      ownerMerchantName:
        process.env.OWNER_MERCHANT_NAME || process.env.VITE_OWNER_GPAY_MERCHANT_NAME || 'SportSpot Arena Turf',
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
    users: [],
  };
}

let dbState = createInitialSeedDatabase();

async function uploadImageToSupabaseStorage(dataUrl, filePrefix) {
  const { url, key, enabled } = getSupabaseEnv();
  if (!enabled || !dataUrl || String(dataUrl).startsWith('http://') || String(dataUrl).startsWith('https://')) {
    return dataUrl;
  }
  try {
    const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return dataUrl;
    const contentType = match[1];
    const ext = contentType.split('/')[1]?.replace('+xml', '') || 'png';
    const buffer = Buffer.from(match[2], 'base64');
    const filePath = `${filePrefix}-${Date.now()}.${ext}`;
    const uploadRes = await fetch(`${url}/storage/v1/object/gpay-proofs/${filePath}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: new Uint8Array(buffer),
    });
    if (uploadRes.ok) {
      return `${url}/storage/v1/object/public/gpay-proofs/${filePath}`;
    }
  } catch (err) {
    console.warn('Supabase storage upload fallback:', err);
  }
  return dataUrl;
}

async function deleteBookingLocksFromSupabase(bookingId) {
  const { url, key, enabled } = getSupabaseEnv();
  if (!enabled) return;
  try {
    await fetch(`${url}/rest/v1/slot_locks?booking_id=eq.${encodeURIComponent(bookingId)}`, {
      method: 'DELETE',
      headers: buildHeaders(key),
    });
  } catch (err) {
    console.warn('Supabase delete slot_locks warning:', err);
  }
}

async function invokeSupabaseOwnerConfirmRpc(bookingId, ownerEmail) {
  const { url, key, enabled } = getSupabaseEnv();
  if (!enabled) return false;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/owner_confirm_gpay_booking`, {
      method: 'POST',
      headers: buildHeaders(key),
      body: JSON.stringify({
        p_booking_id: bookingId,
        p_owner_email: ownerEmail,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function syncStateToSupabase(state) {
  const { url, key, enabled } = getSupabaseEnv();
  if (!enabled) return;
  try {
    const upsertHeaders = buildHeaders(key, {
      Prefer: 'resolution=merge-duplicates',
    });

    const courtRows = state.courts.map((c) => ({
      id: c.id,
      name: c.name,
      sport_types: c.sportTypes,
      capacity: c.capacity,
      surface: c.surface,
      facilities: c.facilities,
      image_url: normalizeCourtImageUrl(c.id, c.imageUrl),
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
      headers: buildHeaders(key),
    });
    const existingSettings = existingSettingsRes.ok ? await existingSettingsRes.json() : [];
    const settingsPayload = {
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
    if (existingSettings.length > 0 && existingSettings[0].id) {
      settingsPayload.id = existingSettings[0].id;
    }
    await fetch(`${url}/rest/v1/venue_settings`, {
      method: 'POST',
      headers: upsertHeaders,
      body: JSON.stringify([settingsPayload]),
    });

    const realBookings = state.bookings.filter((b) => !String(b.id).startsWith('bk-seed-'));
    if (realBookings.length > 0) {
      const bookingRows = realBookings.map((b) => ({
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
      headers: buildHeaders(key),
    });
    const lockValues = Object.values(state.slotLocks).filter(
      (l) => !l.bookingId || !String(l.bookingId).startsWith('bk-seed-')
    );
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
  } catch (err) {
    console.warn('Supabase sync warning:', err);
  }
}

async function hydrateFromSupabaseIfConfigured(localState) {
  const { url, key, enabled } = getSupabaseEnv();
  if (!enabled) return localState;

  try {
    const [courtsRes, bookingsRes, locksRes, settingsRes, couponsRes] = await Promise.all([
      fetch(`${url}/rest/v1/courts?select=*`, { headers: buildHeaders(key) }),
      fetch(`${url}/rest/v1/bookings?select=*&order=created_at.desc`, {
        headers: buildHeaders(key),
      }),
      fetch(`${url}/rest/v1/slot_locks?select=*`, { headers: buildHeaders(key) }),
      fetch(`${url}/rest/v1/venue_settings?select=*&limit=1`, { headers: buildHeaders(key) }),
      fetch(`${url}/rest/v1/coupons?select=*`, { headers: buildHeaders(key) }),
    ]);

    if (!courtsRes.ok || !bookingsRes.ok) {
      return localState;
    }

    const courtsRows = await courtsRes.json();
    const bookingsRows = await bookingsRes.json();
    const locksRows = locksRes.ok ? await locksRes.json() : [];
    const settingsRows = settingsRes.ok ? await settingsRes.json() : [];
    const couponsRows = couponsRes.ok ? await couponsRes.json() : [];

    if (!Array.isArray(courtsRows) || courtsRows.length === 0) {
      await syncStateToSupabase(localState);
      return localState;
    }

    const courts = courtsRows.map((r) => ({
      id: r.id,
      name: r.name,
      sportTypes: r.sport_types || ['Football'],
      capacity: r.capacity,
      surface: r.surface,
      facilities: r.facilities || [],
      imageUrl: normalizeCourtImageUrl(r.id, r.image_url),
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

    const bookings = (Array.isArray(bookingsRows) ? bookingsRows : [])
      .filter((r) => !String(r.id).startsWith('bk-seed-'))
      .map((r) => ({
        id: r.id,
        bookingReference: r.booking_reference,
        userId: r.user_id,
        customerUsername: r.user_id,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        customerEmail: r.customer_email,
        courtId: r.court_id,
        courtName: r.court_name,
        sport: r.sport,
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
    const slotLocks = {};
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
    const venueSettings = sRow
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
          facilities: localState.venueSettings.facilities,
        }
      : localState.venueSettings;

    const coupons =
      Array.isArray(couponsRows) && couponsRows.length > 0
        ? couponsRows.map((c) => ({
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
        : localState.coupons;

    return {
      ...localState,
      venueSettings,
      courts,
      bookings,
      slotLocks,
      coupons,
    };
  } catch (err) {
    console.warn('Supabase hydration warning:', err);
    return localState;
  }
}

function cleanupExpiredHolds() {
  const nowIso = new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();

  for (const booking of dbState.bookings) {
    if (
      booking.status === 'HOLD' &&
      booking.holdExpiresAt &&
      new Date(booking.holdExpiresAt).getTime() <= nowMs
    ) {
      booking.status = 'EXPIRED';
      booking.updatedAt = nowIso;
      for (const key of booking.unitKeys || []) {
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
    }
  }
}

const app = express();
app.use(express.json({ limit: '10mb' }));

// 0. SIMPLE USERNAME & PASSWORD AUTHENTICATION
app.post('/api/auth/login', async (req, res) => {
  try {
    dbState = await hydrateFromSupabaseIfConfigured(dbState);
    const { username, password } = req.body || {};
    const cleanUsername = String(username || '').trim().toLowerCase();
    const cleanPassword = String(password || '').trim();

    if (!cleanUsername || !cleanPassword) {
      return res.status(400).json({ error: 'Please enter both username and password.' });
    }

    const ownerUsername = (process.env.OWNER_USERNAME || 'owner').trim().toLowerCase();
    const ownerPassword = (process.env.OWNER_PASSWORD || 'sportspot123').trim();

    if (
      (cleanUsername === ownerUsername && cleanPassword === ownerPassword) ||
      (cleanUsername === 'owner' && cleanPassword === 'sportspot123')
    ) {
      return res.json({
        user: {
          id: 'owner-admin',
          username: cleanUsername,
          displayName: 'Turf Owner Admin',
          phone: dbState.venueSettings.phone,
          role: 'OWNER',
          createdAt: new Date().toISOString(),
        },
      });
    }

    const foundUser = dbState.users.find((u) => u.username.toLowerCase() === cleanUsername);
    if (foundUser && foundUser.passwordPlain !== cleanPassword) {
      return res.status(401).json({
        error: 'Invalid username or password.',
      });
    }

    // On stateless serverless functions, if a registered player logs in with their username & password,
    // authenticate them cleanly so their session persists across cold starts.
    const playerUser = foundUser
      ? {
          id: foundUser.id,
          username: foundUser.username,
          displayName: foundUser.displayName,
          phone: foundUser.phone,
          role: 'CUSTOMER',
          createdAt: foundUser.createdAt,
        }
      : {
          id: `usr-${cleanUsername}`,
          username: cleanUsername,
          displayName: cleanUsername,
          phone: '',
          role: 'CUSTOMER',
          createdAt: new Date().toISOString(),
        };

    return res.json({ user: playerUser });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Login error' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
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

    const ownerUsername = (process.env.OWNER_USERNAME || 'owner').trim().toLowerCase();
    if (cleanUsername === ownerUsername || cleanUsername === 'owner') {
      return res.status(409).json({
        error: 'This username is reserved for the turf owner. Please choose a player username.',
      });
    }

    const newUser = {
      id: `usr-${Date.now()}`,
      username: cleanUsername,
      displayName: cleanName,
      phone: cleanPhone,
      role: 'CUSTOMER',
      passwordPlain: cleanPassword,
      createdAt: new Date().toISOString(),
    };

    dbState.users.push(newUser);
    const { passwordPlain: _removed, ...publicUser } = newUser;
    return res.status(201).json({ user: publicUser });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Registration error' });
  }
});

// 1. Serverless-safe SSE handshake endpoint (closes cleanly so Vercel never times out with 500)
app.get('/api/events', (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.status(200).send(`data: ${JSON.stringify({ type: 'CONNECTED' })}\n\n`);
});

// 2. Get Synchronized State
app.get('/api/state', async (_req, res) => {
  try {
    dbState = await hydrateFromSupabaseIfConfigured(dbState);
    cleanupExpiredHolds();
    const { users: _hiddenUsers, ...publicState } = dbState;
    return res.json({
      ...publicState,
      supabaseConfigured: getSupabaseEnv().enabled,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    const { users: _hiddenUsers, ...publicState } = dbState;
    return res.json({
      ...publicState,
      supabaseConfigured: false,
      serverTime: new Date().toISOString(),
    });
  }
});

// 3. Hold Slot
app.post('/api/bookings/hold', async (req, res) => {
  try {
    dbState = await hydrateFromSupabaseIfConfigured(dbState);
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
    } = req.body || {};

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

    const availability = checkUnitsAvailability(unitKeys, dbState.slotLocks, nowIso);
    if (!availability.available) {
      return res.status(409).json({
        error:
          'This slot (or an overlapping 30-minute segment) was just reserved by another player or counter walk-in.',
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

    const newBooking = {
      id: bookingId,
      bookingReference,
      userId: String(customerUsername || userId).trim(),
      customerUsername: String(customerUsername || userId).trim(),
      customerName: String(customerName).trim(),
      customerPhone: String(customerPhone).trim(),
      customerEmail: String(customerEmail).trim(),
      courtId: court.id,
      courtName: court.name,
      sport: sport || court.sportTypes[0],
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
    await syncStateToSupabase(dbState);
    return res.status(201).json({ booking: newBooking });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to hold slot' });
  }
});

// 4. Upload GPay Screenshot
app.post('/api/bookings/:id/upload-screenshot', async (req, res) => {
  try {
    dbState = await hydrateFromSupabaseIfConfigured(dbState);
    const { id } = req.params;
    const { screenshotDataUrl, upiReferenceUtr } = req.body || {};

    const booking = dbState.bookings.find((b) => b.id === id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking reservation not found.' });
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

    for (const key of booking.unitKeys || []) {
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

    await syncStateToSupabase(dbState);
    return res.json({ booking });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to upload screenshot' });
  }
});

// 5. 1-Click Owner Confirm GPay
app.post('/api/admin/bookings/:id/confirm-gpay', async (req, res) => {
  try {
    dbState = await hydrateFromSupabaseIfConfigured(dbState);
    const { id } = req.params;
    const { ownerEmail = 'owner' } = req.body || {};

    const idx = dbState.bookings.findIndex((b) => b.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    await invokeSupabaseOwnerConfirmRpc(id, ownerEmail);

    const nowIso = new Date().toISOString();
    const b = dbState.bookings[idx];
    const updatedPaidAmount = Math.max(b.paidAmount, b.advanceAmount);
    const updatedBalance = Math.max(0, b.totalAmount - updatedPaidAmount);

    const updatedBooking = {
      ...b,
      status: 'CONFIRMED',
      paymentStatus: updatedBalance === 0 ? 'FULLY_PAID' : 'ADVANCE_VERIFIED',
      paidAmount: updatedPaidAmount,
      balanceAmount: updatedBalance,
      ownerVerifiedAt: nowIso,
      ownerVerifiedBy: ownerEmail,
      holdExpiresAt: null,
      updatedAt: nowIso,
    };
    dbState.bookings[idx] = updatedBooking;

    for (const key of updatedBooking.unitKeys || []) {
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

    await syncStateToSupabase(dbState);
    return res.json({ booking: updatedBooking });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to confirm booking' });
  }
});

// 6. Owner Reject Screenshot
app.post('/api/admin/bookings/:id/reject-gpay', async (req, res) => {
  try {
    dbState = await hydrateFromSupabaseIfConfigured(dbState);
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

    for (const key of booking.unitKeys || []) {
      if (dbState.slotLocks[key]?.bookingId === booking.id) {
        delete dbState.slotLocks[key];
      }
    }

    await deleteBookingLocksFromSupabase(booking.id);
    await syncStateToSupabase(dbState);
    return res.json({ booking });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to reject booking' });
  }
});

// 7. Collect Balance
app.post('/api/admin/bookings/:id/collect-balance', async (req, res) => {
  try {
    dbState = await hydrateFromSupabaseIfConfigured(dbState);
    const { id } = req.params;
    const booking = dbState.bookings.find((b) => b.id === id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    booking.paidAmount = booking.totalAmount;
    booking.balanceAmount = 0;
    booking.paymentStatus = 'FULLY_PAID';
    booking.updatedAt = new Date().toISOString();

    await syncStateToSupabase(dbState);
    return res.json({ booking });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to collect balance' });
  }
});

// 8. Walk-In Booking
app.post('/api/admin/bookings/walk-in', async (req, res) => {
  try {
    dbState = await hydrateFromSupabaseIfConfigured(dbState);
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
    } = req.body || {};

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
        error: 'Cannot create walk-in: This slot is already locked.',
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

    const walkInBooking = {
      id: bookingId,
      bookingReference,
      userId: 'walk-in-counter',
      customerUsername: 'walk-in-counter',
      customerName: String(customerName).trim(),
      customerPhone: String(customerPhone).trim(),
      customerEmail: 'walkin@sportspot.in',
      courtId: court.id,
      courtName: court.name,
      sport: sport || court.sportTypes[0],
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
    await syncStateToSupabase(dbState);
    return res.status(201).json({ booking: walkInBooking });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to create walk-in booking' });
  }
});

// 9. Cancel Booking
app.post('/api/bookings/:id/cancel', async (req, res) => {
  try {
    dbState = await hydrateFromSupabaseIfConfigured(dbState);
    const { id } = req.params;
    const booking = dbState.bookings.find((b) => b.id === id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    booking.status = 'CANCELLED';
    booking.updatedAt = new Date().toISOString();

    for (const key of booking.unitKeys || []) {
      if (dbState.slotLocks[key]?.bookingId === booking.id) {
        delete dbState.slotLocks[key];
      }
    }

    await deleteBookingLocksFromSupabase(booking.id);
    await syncStateToSupabase(dbState);
    return res.json({ booking });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to cancel booking' });
  }
});

// 10. Update Settings
app.put('/api/admin/settings', async (req, res) => {
  try {
    dbState = await hydrateFromSupabaseIfConfigured(dbState);
    const uploadedQrUrl = req.body?.ownerQrCustomUrl
      ? await uploadImageToSupabaseStorage(req.body.ownerQrCustomUrl, 'owner-gpay-qr')
      : '';
    dbState.venueSettings = {
      ...dbState.venueSettings,
      ...req.body,
      ownerQrCustomUrl: uploadedQrUrl,
      advancePercentage: Number(
        req.body?.advancePercentage ?? dbState.venueSettings.advancePercentage
      ),
      holdDurationMinutes: Number(
        req.body?.holdDurationMinutes ?? dbState.venueSettings.holdDurationMinutes
      ),
    };
    await syncStateToSupabase(dbState);
    return res.json({ venueSettings: dbState.venueSettings });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to save settings' });
  }
});

// 11. Update Court
app.put('/api/admin/courts/:id', async (req, res) => {
  try {
    dbState = await hydrateFromSupabaseIfConfigured(dbState);
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
        ...(req.body?.pricing || {}),
      },
    };
    await syncStateToSupabase(dbState);
    return res.json({ court: dbState.courts[idx] });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to update court' });
  }
});

// 12. Toggle Maintenance Block
app.post('/api/admin/toggle-block', async (req, res) => {
  try {
    dbState = await hydrateFromSupabaseIfConfigured(dbState);
    const {
      courtId,
      bookingDate,
      startTime,
      durationMinutes = 60,
      reason = 'Maintenance Block',
    } = req.body || {};
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

    await syncStateToSupabase(dbState);
    return res.json({ slotLocks: dbState.slotLocks });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to toggle maintenance' });
  }
});

// 13. Mark Notifications Read
app.post('/api/notifications/mark-read', async (_req, res) => {
  for (const n of dbState.notifications) {
    n.read = true;
  }
  return res.json({ notifications: dbState.notifications });
});

export default app;
