import {
  BookingRecord,
  CouponRecord,
  Court,
  SlotLockRecord,
  SportType,
  VenueSettings,
} from '../types/sportspot';

export const COURT_1_IMAGE_URL =
  'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1200&q=85';
export const COURT_2_IMAGE_URL =
  'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1200&q=85';
export const HERO_TURF_IMAGE_URL =
  'https://images.unsplash.com/photo-1529900748604-07564a03e7a6?auto=format&fit=crop&w=1400&q=85';

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

function buildHeaders(key: string, extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function normalizeCourtImageUrl(courtId: string, rawUrl?: string): string {
  if (!rawUrl || rawUrl.startsWith('/src/assets/')) {
    return courtId === 'court-2' ? COURT_2_IMAGE_URL : COURT_1_IMAGE_URL;
  }
  return rawUrl;
}

/**
 * Uploads a Data URL (PNG/JPG/WEBP/SVG) to the user's Supabase `gpay-proofs` Storage bucket
 * and returns the public URL. Gracefully falls back to the original Data URL if the bucket is unreachable.
 */
export async function uploadImageToSupabaseStorage(
  dataUrl: string,
  filePrefix: string
): Promise<string> {
  const { url, key, enabled } = getSupabaseEnv();
  if (!enabled || !dataUrl || dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
    return dataUrl;
  }

  try {
    let buffer: Buffer;
    let contentType = 'image/png';
    let ext = 'png';

    if (dataUrl.startsWith('data:image/svg+xml;utf8,')) {
      const rawSvg = decodeURIComponent(dataUrl.replace('data:image/svg+xml;utf8,', ''));
      buffer = Buffer.from(rawSvg, 'utf-8');
      contentType = 'image/svg+xml';
      ext = 'svg';
    } else {
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return dataUrl;
      contentType = match[1];
      ext = contentType.split('/')[1]?.replace('+xml', '') || 'png';
      buffer = Buffer.from(match[2], 'base64');
    }

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
    console.warn('Supabase Storage upload fallback to inline dataUrl:', err);
  }
  return dataUrl;
}

/**
 * Calls the PostgreSQL transactional RPC `public.owner_confirm_gpay_booking`
 */
export async function invokeSupabaseOwnerConfirmRpc(
  bookingId: string,
  ownerEmail: string
): Promise<boolean> {
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
  } catch (err) {
    console.warn('Supabase RPC owner_confirm_gpay_booking warning:', err);
    return false;
  }
}

/**
 * Deletes a single booking and its slot locks from Supabase when cancelled or removed.
 */
export async function deleteBookingLocksFromSupabase(bookingId: string): Promise<void> {
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

/**
 * Hydrates server state from Supabase PostgreSQL tables if configured.
 * Also purges any old dummy seed bookings (`bk-seed-%`) so the database only contains real bookings.
 */
export async function hydrateFromSupabaseIfConfigured<
  T extends {
    venueSettings: VenueSettings;
    courts: Court[];
    bookings: BookingRecord[];
    slotLocks: Record<string, SlotLockRecord>;
    coupons: CouponRecord[];
  },
>(localState: T): Promise<T> {
  const { url, key, enabled } = getSupabaseEnv();
  if (!enabled) return localState;

  try {
    // Purge any legacy dummy seed rows (`bk-seed-%`) from Supabase so only real bookings exist
    await fetch(`${url}/rest/v1/slot_locks?booking_id=like.bk-seed-*`, {
      method: 'DELETE',
      headers: buildHeaders(key),
    });
    await fetch(`${url}/rest/v1/bookings?id=like.bk-seed-*`, {
      method: 'DELETE',
      headers: buildHeaders(key),
    });

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

    const courtsRows = (await courtsRes.json()) as any[];
    const bookingsRows = (await bookingsRes.json()) as any[];
    const locksRows = locksRes.ok ? ((await locksRes.json()) as any[]) : [];
    const settingsRows = settingsRes.ok ? ((await settingsRes.json()) as any[]) : [];
    const couponsRows = couponsRes.ok ? ((await couponsRes.json()) as any[]) : [];

    // First run on fresh Supabase tables: seed initial courts, coupons, and venue settings (0 bookings)
    if (courtsRows.length === 0) {
      await syncStateToSupabase(localState);
      return localState;
    }

    const courts: Court[] = courtsRows.map((r) => ({
      id: r.id,
      name: r.name,
      sportTypes: (r.sport_types || ['Football']) as SportType[],
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

    const bookings: BookingRecord[] = bookingsRows
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
    for (const l of locksRows) {
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

    const sRow = settingsRows[0];
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
          facilities: localState.venueSettings.facilities,
        }
      : localState.venueSettings;

    const coupons: CouponRecord[] =
      couponsRows.length > 0
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
    console.warn('Supabase hydration warning (using local cache):', err);
    return localState;
  }
}

/**
 * Synchronizes current courts, bookings, slot_locks, coupons, and venue_settings to Supabase PostgreSQL.
 */
export async function syncStateToSupabase(state: {
  venueSettings: VenueSettings;
  courts: Court[];
  bookings: BookingRecord[];
  slotLocks: Record<string, SlotLockRecord>;
  coupons: CouponRecord[];
}): Promise<void> {
  const { url, key, enabled } = getSupabaseEnv();
  if (!enabled) return;

  try {
    const upsertHeaders = buildHeaders(key, {
      Prefer: 'resolution=merge-duplicates',
    });

    // 1. Upsert Courts (with normalized guaranteed-visible image URLs)
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

    // 2. Sync Venue Settings
    const existingSettingsRes = await fetch(`${url}/rest/v1/venue_settings?select=id&limit=1`, {
      headers: buildHeaders(key),
    });
    const existingSettings = existingSettingsRes.ok
      ? ((await existingSettingsRes.json()) as any[])
      : [];
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
    if (existingSettings.length > 0 && existingSettings[0].id) {
      settingsPayload.id = existingSettings[0].id;
    }
    await fetch(`${url}/rest/v1/venue_settings`, {
      method: 'POST',
      headers: upsertHeaders,
      body: JSON.stringify([settingsPayload]),
    });

    // 3. Upsert Real Bookings
    const realBookings = state.bookings.filter((b) => !b.id.startsWith('bk-seed-'));
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

    // 4. Replace active Slot Locks in Supabase
    await fetch(`${url}/rest/v1/slot_locks?slot_key=neq.__none__`, {
      method: 'DELETE',
      headers: buildHeaders(key),
    });
    const lockValues = Object.values(state.slotLocks).filter(
      (l) => !l.bookingId || !l.bookingId.startsWith('bk-seed-')
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

    // 5. Upsert Coupons
    if (state.coupons.length > 0) {
      const couponRows = state.coupons.map((c) => ({
        id: c.id,
        code: c.code,
        description: c.description,
        discount_type: c.discountType,
        discount_value: c.discountValue,
        min_booking_amount: c.minBookingAmount,
        max_uses: c.maxUses,
        used_count: c.usedCount,
        active: c.active,
      }));
      await fetch(`${url}/rest/v1/coupons`, {
        method: 'POST',
        headers: upsertHeaders,
        body: JSON.stringify(couponRows),
      });
    }
  } catch (err) {
    console.warn('Supabase background sync warning:', err);
  }
}
