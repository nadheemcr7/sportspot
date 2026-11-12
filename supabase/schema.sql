-- ============================================================================
-- SPORTSPOT — SUPABASE POSTGRESQL SCHEMA, RLS, STORAGE & ATOMIC RPC FUNCTIONS
-- Custom GPay QR Advance Payment + Screenshot Upload + 1-Click Owner Approval
-- ============================================================================

create extension if not exists "pgcrypto";

-- 1. OWNER & VENUE BUSINESS SETTINGS (Includes Owner GPay QR & Advance Rules)
create table if not exists public.venue_settings (
  id uuid primary key default gen_random_uuid(),
  venue_name text not null default 'SportSpot Arena — Electronic City',
  address text not null default 'Plot 42, Phase 1, Electronic City, Bengaluru, KA 560100',
  phone text not null default '+91 98450 77210',
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR',
  owner_upi_id text not null default 'sportspot.arena@okaxis',
  owner_merchant_name text not null default 'SportSpot Arena Turf',
  owner_qr_image_url text,
  advance_percentage integer not null default 30 check (advance_percentage between 10 and 100),
  hold_duration_minutes integer not null default 10,
  opening_Time text not null default '06:00',
  closing_Time text not null default '23:00',
  updated_at timestamptz not null default now()
);

-- 2. COURTS & TURFS
create table if not exists public.courts (
  id text primary key,
  name text not null,
  sport_types text[] not null default '{"Football", "Box Cricket"}',
  capacity text not null default '7v7 (Max 14 Players)',
  surface text not null default 'FIFA Quality Pro 55mm Monofilament',
  facilities text[] not null default '{"LED Floodlights", "Changing Rooms", "Drinking Water", "Covered Dugout"}',
  image_url text not null,
  active boolean not null default true,
  slot_interval_minutes integer not null default 30,
  allowed_durations integer[] not null default '{60, 90, 120}',
  weekday_morning_rate integer not null default 900,
  weekday_evening_rate integer not null default 1200,
  weekend_morning_rate integer not null default 1100,
  weekend_evening_rate integer not null default 1500,
  peak_start_hour integer not null default 17,
  created_at timestamptz not null default now()
);

-- 3. BOOKINGS (Shared by Online GPay Reservations & Walk-In Counter Bookings)
create table if not exists public.bookings (
  id text primary key,
  booking_reference text not null unique,
  user_id text not null,
  customer_name text not null,
  customer_phone text not null,
  customer_email text not null,
  court_id text not null references public.courts(id) on delete restrict,
  court_name text not null,
  sport text not null,
  booking_date date not null,
  start_time text not null,
  end_time text not null,
  duration_minutes integer not null,
  unit_keys text[] not null,
  source text not null check (source in ('ONLINE', 'WALK_IN')),
  -- Booking lifecycle:
  -- HOLD -> AWAITING_OWNER_APPROVAL -> CONFIRMED -> COMPLETED | REJECTED | CANCELLED
  status text not null check (status in (
    'HOLD',
    'AWAITING_OWNER_APPROVAL',
    'CONFIRMED',
    'COMPLETED',
    'REJECTED',
    'CANCELLED',
    'EXPIRED'
  )),
  -- Payment lifecycle without third-party gateway:
  -- UNPAID_HOLD -> SCREENSHOT_UPLOADED -> ADVANCE_VERIFIED -> FULLY_PAID | REJECTED | REFUNDED
  payment_status text not null check (payment_status in (
    'UNPAID_HOLD',
    'SCREENSHOT_UPLOADED',
    'ADVANCE_VERIFIED',
    'FULLY_PAID',
    'REJECTED',
    'REFUNDED'
  )),
  payment_method text not null check (payment_method in ('GPAY_QR_SCREENSHOT', 'CASH_AT_VENUE', 'UPI_AT_VENUE')),
  base_amount integer not null,
  discount_amount integer not null default 0,
  total_amount integer not null,
  advance_amount integer not null,
  paid_amount integer not null default 0,
  balance_amount integer not null,
  coupon_code text,
  -- GPay Screenshot & Verification Proof Fields
  upi_reference_utr text,
  screenshot_url text,
  screenshot_uploaded_at timestamptz,
  owner_verified_at timestamptz,
  owner_verified_by text,
  rejection_reason text,
  hold_expires_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. ATOMIC SLOT LOCKS (Prevents Double Bookings Across Online & Walk-In)
create table if not exists public.slot_locks (
  slot_key text primary key, -- Deterministic: courtId__YYYY-MM-DD__HH:MM
  court_id text not null references public.courts(id) on delete cascade,
  booking_date date not null,
  unit_time text not null,
  booking_id text references public.bookings(id) on delete cascade,
  status text not null check (status in ('HOLD', 'AWAITING_OWNER_APPROVAL', 'BOOKED', 'BLOCKED')),
  hold_expires_at timestamptz,
  reason text,
  updated_at timestamptz not null default now()
);

-- 5. COUPONS
create table if not exists public.coupons (
  id text primary key,
  code text not null unique,
  description text not null,
  discount_type text not null check (discount_type in ('PERCENTAGE', 'FIXED')),
  discount_value integer not null,
  min_booking_amount integer not null default 500,
  max_uses integer not null default 100,
  used_count integer not null default 0,
  active boolean not null default true
);

-- 6. ATOMIC RPC FUNCTION: ONE-CLICK OWNER APPROVAL OF GPAY SCREENSHOT & SLOT
create or replace function public.owner_confirm_gpay_booking(
  p_booking_id text,
  p_owner_email text
) returns public.bookings
language plpgsql
security definer
as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found';
  end if;

  update public.bookings
  set status = 'CONFIRMED',
      payment_status = case
        when advance_amount >= total_amount then 'FULLY_PAID'
        else 'ADVANCE_VERIFIED'
      end,
      paid_amount = advance_amount,
      balance_amount = greatest(0, total_amount - advance_amount),
      owner_verified_at = now(),
      owner_verified_by = p_owner_email,
      hold_expires_at = null,
      updated_at = now()
  where id = p_booking_id
  returning * into v_booking;

  update public.slot_locks
  set status = 'BOOKED',
      hold_expires_at = null,
      updated_at = now()
  where booking_id = p_booking_id;

  return v_booking;
end;
$$;

-- Enable Supabase Realtime for live slot & dashboard updates
alter publication supabase_realtime add table public.bookings;
alter publication supabase_realtime add table public.slot_locks;
