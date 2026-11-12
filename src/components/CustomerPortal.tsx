import React, { useState, useMemo, useEffect } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  Phone,
  CheckCircle2,
  QrCode,
  Tag,
  ArrowRight,
  Lock,
  Sparkles,
  FileImage,
  XCircle,
  Eye,
  ShieldCheck,
  UserCheck,
  Zap,
  Trophy,
} from 'lucide-react';
import {
  BookingRecord,
  CouponRecord,
  Court,
  SlotLockRecord,
  SportType,
  UserAccount,
  VenueSettings,
} from '../types/sportspot';
import {
  calculatePriceBreakdown,
  computeDailySlotsForCourt,
} from '../utils/bookingEngine';
import { safeApiJson } from '../lib/apiClient';
import {
  COURT_1_IMAGE_URL,
  COURT_2_IMAGE_URL,
  HERO_TURF_IMAGE_URL,
} from '../lib/supabaseRest';
import { GpayAdvanceModal } from './GpayAdvanceModal';
import { QrCodeSvg } from './QrCodeSvg';
import { TurfImage } from './TurfImage';
import { AuthModalMode } from './AuthModal';

interface CustomerPortalProps {
  venueSettings: VenueSettings;
  courts: Court[];
  bookings: BookingRecord[];
  slotLocks: Record<string, SlotLockRecord>;
  coupons: CouponRecord[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onBookingCreatedOrUpdated: () => Promise<void>;
  currentUser: UserAccount | null;
  onOpenAuth: (mode: AuthModalMode) => void;
}

export const CustomerPortal: React.FC<CustomerPortalProps> = ({
  venueSettings,
  courts,
  bookings,
  slotLocks,
  coupons,
  selectedDate,
  onSelectDate,
  onBookingCreatedOrUpdated,
  currentUser,
  onOpenAuth,
}) => {
  const [selectedCourtId, setSelectedCourtId] = useState<string>(courts[0]?.id || 'court-1');
  const [selectedSport, setSelectedSport] = useState<SportType>('Football');
  const [selectedDuration, setSelectedDuration] = useState<number>(60);
  const [selectedStartTime, setSelectedStartTime] = useState<string | null>(null);

  // Player Checkout Form
  const [customerName, setCustomerName] = useState<string>(currentUser?.displayName || '');
  const [customerPhone, setCustomerPhone] = useState<string>(currentUser?.phone || '');
  const [couponInput, setCouponInput] = useState<string>('');
  const [payFullOnline, setPayFullOnline] = useState<boolean>(false);

  useEffect(() => {
    if (currentUser) {
      setCustomerName(currentUser.displayName);
      setCustomerPhone(currentUser.phone);
    }
  }, [currentUser]);

  const [holdingSlot, setHoldingSlot] = useState<boolean>(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [activeGpayBooking, setActiveGpayBooking] = useState<BookingRecord | null>(null);
  const [previewReceiptBooking, setPreviewReceiptBooking] = useState<BookingRecord | null>(null);
  const [entryQrBooking, setEntryQrBooking] = useState<BookingRecord | null>(null);
  const [bookingFilter, setBookingFilter] = useState<'ALL' | 'PENDING' | 'CONFIRMED'>('ALL');
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

  const selectedCourt = useMemo(
    () => courts.find((c) => c.id === selectedCourtId) || courts[0],
    [courts, selectedCourtId]
  );

  // Compute all slots for the selected court, date, and duration
  const dailySlots = useMemo(() => {
    if (!selectedCourt) return [];
    return computeDailySlotsForCourt({
      court: selectedCourt,
      bookingDate: selectedDate,
      durationMinutes: selectedDuration,
      openingTime: venueSettings.openingTime,
      closingTime: venueSettings.closingTime,
      advancePercentage: venueSettings.advancePercentage,
      locksByKey: slotLocks,
      nowIso: new Date().toISOString(),
    });
  }, [selectedCourt, selectedDate, selectedDuration, venueSettings, slotLocks]);

  const selectedSlotObj = useMemo(
    () => dailySlots.find((s) => s.startTime === selectedStartTime && s.state === 'AVAILABLE') || null,
    [dailySlots, selectedStartTime]
  );

  const matchedCoupon = useMemo(() => {
    if (!couponInput.trim()) return null;
    return (
      coupons.find(
        (c) => c.code.toUpperCase() === couponInput.trim().toUpperCase() && c.active
      ) || null
    );
  }, [coupons, couponInput]);

  const checkoutPrice = useMemo(() => {
    if (!selectedCourt || !selectedSlotObj) return null;
    return calculatePriceBreakdown({
      court: selectedCourt,
      bookingDate: selectedDate,
      startTime: selectedSlotObj.startTime,
      durationMinutes: selectedDuration,
      advancePercentage: venueSettings.advancePercentage,
      coupon: matchedCoupon,
      payFullOnline,
    });
  }, [
    selectedCourt,
    selectedSlotObj,
    selectedDate,
    selectedDuration,
    venueSettings.advancePercentage,
    matchedCoupon,
    payFullOnline,
  ]);

  const availableSlotsCount = useMemo(
    () => dailySlots.filter((s) => s.state === 'AVAILABLE').length,
    [dailySlots]
  );

  // Filter My Bookings strictly to the logged-in customer (or bookings placed in this session)
  const myBookings = useMemo(() => {
    const owned = bookings.filter((b) => {
      if (b.source !== 'ONLINE') return false;
      if (currentUser) {
        return (
          b.userId === currentUser.username ||
          b.customerUsername === currentUser.username ||
          b.customerPhone === currentUser.phone
        );
      }
      if (customerPhone.trim()) {
        return b.customerPhone.trim() === customerPhone.trim();
      }
      return false;
    });

    if (bookingFilter === 'PENDING') {
      return owned.filter(
        (b) => b.status === 'AWAITING_OWNER_APPROVAL' || b.status === 'HOLD'
      );
    }
    if (bookingFilter === 'CONFIRMED') {
      return owned.filter((b) => b.status === 'CONFIRMED');
    }
    return owned;
  }, [bookings, currentUser, customerPhone, bookingFilter]);

  const handleHoldSlotAndOpenGpay = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutError(null);

    if (!selectedSlotObj) {
      setCheckoutError('Please click an available green time slot on the turf grid first.');
      return;
    }
    if (!customerName.trim() || !customerPhone.trim()) {
      setCheckoutError('Please enter your name and mobile number to reserve this slot.');
      return;
    }

    setHoldingSlot(true);
    try {
      const { ok, data } = await safeApiJson('/api/bookings/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser?.username || customerPhone.trim(),
          customerUsername: currentUser?.username || customerPhone.trim(),
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          courtId: selectedCourt.id,
          sport: selectedSport,
          bookingDate: selectedDate,
          startTime: selectedSlotObj.startTime,
          durationMinutes: selectedDuration,
          couponCode: couponInput.trim() || undefined,
          payFullOnline,
        }),
      });
      if (!ok) {
        throw new Error(data?.error || 'Could not hold the selected slot.');
      }

      await onBookingCreatedOrUpdated();
      setActiveGpayBooking(data.booking);
    } catch (err: any) {
      setCheckoutError(err.message || 'Unable to hold slot.');
    } finally {
      setHoldingSlot(false);
    }
  };

  const handleCancelBooking = async (bookingId: string) => {
    try {
      const { ok } = await safeApiJson(`/api/bookings/${bookingId}/cancel`, { method: 'POST' });
      if (ok) {
        await onBookingCreatedOrUpdated();
        setBannerNotice('Reservation cancelled and turf slot released back to the public grid.');
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-12 pb-20">
      {/* 1. HERO SECTION — FLOODLIT STADIUM SHOWCASE */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-800/90 bg-[#0F1624] shadow-2xl">
        <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
          {/* Left Copy Column */}
          <div className="lg:col-span-7 p-6 sm:p-10 lg:p-12 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <p className="text-xs font-mono uppercase tracking-widest text-[#A3E635]">
                FIFA QUALITY PRO 55MM TURF · 400 LUX FLOODLIGHTS · DIRECT GPAY ADVANCE
              </p>
              <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-wide text-white leading-[1.03]">
                YOUR GAME. YOUR TURF.
                <br />
                <span className="text-[#A3E635]">INSTANT GPAY SLOT LOCK.</span>
              </h1>
              <p className="text-slate-300 text-sm sm:text-base max-w-2xl leading-relaxed">
                Welcome to <strong className="text-white">{venueSettings.venueName}</strong> —
                Bengaluru’s premier floodlit 7v7 Football &amp; High-Roof Box Cricket complex. Check
                live court availability, reserve your slot with a{' '}
                <strong className="text-[#A3E635]">
                  {venueSettings.advancePercentage}% GPay QR advance
                </strong>
                , and upload your screenshot for instant owner confirmation.
              </p>
            </div>

            {/* Primary CTAs */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <a
                href="#live-booking-engine"
                className="inline-flex items-center gap-2 px-6 py-3.5 bg-[#A3E635] hover:bg-[#bef264] text-slate-950 font-semibold text-sm rounded-xl transition-all shadow-lg shadow-[#A3E635]/10"
              >
                <span>Check Live Slots &amp; Book Now</span>
                <ArrowRight className="w-4 h-4" />
              </a>

              {!currentUser ? (
                <button
                  type="button"
                  onClick={() => onOpenAuth('PLAYER_LOGIN')}
                  className="inline-flex items-center gap-2 px-5 py-3.5 bg-[#141D2E] hover:bg-slate-800 text-slate-200 border border-slate-700 font-medium text-sm rounded-xl transition-colors"
                >
                  <UserCheck className="w-4 h-4 text-[#A3E635]" />
                  <span>Player Login / Create Account</span>
                </button>
              ) : (
                <a
                  href="#my-bookings-section"
                  className="inline-flex items-center gap-2 px-5 py-3.5 bg-[#141D2E] hover:bg-slate-800 text-slate-200 border border-slate-700 font-medium text-sm rounded-xl transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4 text-[#A3E635]" />
                  <span>View My Bookings ({myBookings.length})</span>
                </a>
              )}
            </div>

            {/* Venue Highlights Strip */}
            <div className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center gap-y-2 gap-x-6 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#A3E635]" />
                {venueSettings.address}
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono">
                <Clock className="w-3.5 h-3.5 text-[#A3E635]" />
                Open Daily {venueSettings.openingTime} – {venueSettings.closingTime}
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono">
                <Phone className="w-3.5 h-3.5 text-[#A3E635]" />
                {venueSettings.phone}
              </span>
            </div>
          </div>

          {/* Right Floodlit Stadium Visual */}
          <div className="lg:col-span-5 relative min-h-[300px] lg:min-h-[420px] bg-[#090D16]">
            <TurfImage
              src={HERO_TURF_IMAGE_URL}
              variant="hero"
              alt="SportSpot floodlit artificial grass football and box cricket stadium arena at night"
              className="w-full h-full object-cover opacity-90"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#090D16] via-[#090D16]/30 to-transparent" />

            {/* Floating Live Status Overlay */}
            <div className="absolute bottom-5 left-5 right-5 bg-[#090D16]/90 backdrop-blur-md border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-mono text-[#A3E635] uppercase">
                  LIVE AVAILABILITY · {selectedDate}
                </p>
                <p className="text-sm font-semibold text-white mt-0.5">
                  {availableSlotsCount} Open Slots on {selectedCourt?.name.split('—')[0]}
                </p>
                <p className="text-xs text-slate-400">
                  Pay {venueSettings.advancePercentage}% Advance via GPay · Balance at Turf Counter
                </p>
              </div>
              <div className="bg-white p-1.5 rounded-lg shrink-0">
                <QrCode className="w-8 h-8 text-slate-950" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. ABOUT THE ARENA & 4-STEP GPAY RESERVATION PROCESS */}
      <section className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#0F1624] border border-slate-800/90 rounded-2xl p-5 flex items-start gap-4">
            <div className="p-3 rounded-xl bg-[#141D2E] border border-slate-700 text-[#A3E635] shrink-0">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                Pro-Grade FIFA 55mm Turf &amp; High-Roof Cricket Cage
              </h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Shock-absorbent monofilament grass engineered for zero knee strain, high-bounce
                woven cricket pitch mat, and 32ft boundary netting.
              </p>
            </div>
          </div>

          <div className="bg-[#0F1624] border border-slate-800/90 rounded-2xl p-5 flex items-start gap-4">
            <div className="p-3 rounded-xl bg-[#141D2E] border border-slate-700 text-[#A3E635] shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                Zero Payment Gateway Fees — Direct Owner GPay QR
              </h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Scan the turf owner’s GPay QR directly for the {venueSettings.advancePercentage}%
                advance, upload your payment screenshot, and pay the remaining{' '}
                {100 - venueSettings.advancePercentage}% when your team arrives.
              </p>
            </div>
          </div>

          <div className="bg-[#0F1624] border border-slate-800/90 rounded-2xl p-5 flex items-start gap-4">
            <div className="p-3 rounded-xl bg-[#141D2E] border border-slate-700 text-[#A3E635] shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                Atomic 30-Minute Slot Lock Protection
              </h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                The moment you hold a slot or upload your GPay receipt, that time window is locked
                across both online players and venue counter walk-ins.
              </p>
            </div>
          </div>
        </div>

        {/* 4-Step How It Works Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              step: '01. Choose Court & Time',
              title: 'Real-Time Atomic Lock',
              desc: 'Pick your turf, date, and 60/90/120-min slot on the live availability grid.',
            },
            {
              step: `02. Scan Owner’s GPay QR (${venueSettings.advancePercentage}% Advance)`,
              title: 'Direct UPI Transfer',
              desc: `Pay the ${venueSettings.advancePercentage}% advance to ${venueSettings.ownerUpiId}; pay the balance at the counter.`,
            },
            {
              step: '03. Upload GPay Screenshot',
              title: 'Instant Proof Submission',
              desc: 'Upload your GPay payment screenshot & UTR; your slot stays locked for you.',
            },
            {
              step: '04. Owner 1-Click Approval',
              title: 'Verified & Ready to Play',
              desc: 'The owner confirms your screenshot in one click and issues your Entry QR Pass.',
            },
          ].map((item) => (
            <div
              key={item.step}
              className="bg-[#0F1624]/80 border border-slate-800/90 rounded-xl p-4 flex flex-col justify-between"
            >
              <div>
                <p className="text-xs font-mono text-[#A3E635]">{item.step}</p>
                <h3 className="text-sm font-semibold text-white mt-1">{item.title}</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {bannerNotice && (
        <div className="flex items-center justify-between gap-4 bg-emerald-950/60 border border-emerald-700/70 text-emerald-200 px-5 py-3.5 rounded-xl text-sm">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-[#A3E635] shrink-0" />
            <span>{bannerNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setBannerNotice(null)}
            className="text-xs text-emerald-300 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 3. INTERACTIVE LIVE TURF AVAILABILITY & GPAY BOOKING ENGINE */}
      <section id="live-booking-engine" className="scroll-mt-24 space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-mono text-[#A3E635] uppercase">01. LIVE RESERVATION ENGINE</p>
            <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-wide text-white">
              Select Court, Date &amp; Available Slot
            </h2>
          </div>

          {/* Slot Status Legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/30 border border-emerald-400" />
              Available: Green border
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/30 border border-amber-400" />
              Pending GPay Verification: Amber
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-slate-800 border border-slate-600" />
              Booked / Blocked: Slate
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 8 Columns: Court Selector, Filters & Time Slot Matrix */}
          <div className="lg:col-span-8 bg-[#0F1624] border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-6">
            {/* Court Selection Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {courts.map((court) => {
                const isSelected = court.id === selectedCourt?.id;
                return (
                  <button
                    key={court.id}
                    type="button"
                    onClick={() => {
                      setSelectedCourtId(court.id);
                      setSelectedSport(court.sportTypes[0]);
                      setSelectedStartTime(null);
                    }}
                    className={`text-left p-4 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-[#141D2E] border-[#A3E635] shadow-md shadow-[#A3E635]/5'
                        : 'bg-[#090D16] border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-white">{court.name}</span>
                      <span className="text-xs font-mono text-[#A3E635]">
                        ₹{court.pricing.weekdayMorningRate}–₹{court.pricing.weekendEveningRate}/hr
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{court.surface}</p>
                    <p className="text-[11px] font-mono text-slate-400 mt-2">
                      {court.capacity} · {court.sportTypes.join(' / ')}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Filter Controls: Date, Sport, Duration */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-800/80">
              <div>
                <label
                  htmlFor="booking-date-picker"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Match Date
                </label>
                <div className="relative">
                  <input
                    id="booking-date-picker"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      onSelectDate(e.target.value);
                      setSelectedStartTime(null);
                    }}
                    className="w-full px-3.5 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-[#A3E635]"
                  />
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-300 mb-1.5">Sport</span>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedCourt?.sportTypes || ['Football']).map((sp) => (
                    <button
                      key={sp}
                      type="button"
                      onClick={() => setSelectedSport(sp)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                        selectedSport === sp
                          ? 'bg-[#A3E635] text-slate-950 border-[#A3E635] font-semibold'
                          : 'bg-[#090D16] text-slate-300 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {sp}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-300 mb-1.5">
                  Session Duration
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(selectedCourt?.allowedDurations || [60, 90, 120]).map((dur) => (
                    <button
                      key={dur}
                      type="button"
                      onClick={() => {
                        setSelectedDuration(dur);
                        setSelectedStartTime(null);
                      }}
                      className={`py-2 rounded-lg text-xs font-mono border transition-colors ${
                        selectedDuration === dur
                          ? 'bg-[#A3E635] text-slate-950 border-[#A3E635] font-semibold'
                          : 'bg-[#090D16] text-slate-300 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {dur}m
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Time Slot Matrix Grid */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  Click an open time slot ({selectedDuration} mins) — Floodlight rate applies from
                  17:00 onwards
                </span>
                <span className="font-mono text-slate-300">
                  {availableSlotsCount} / {dailySlots.length} available
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                {dailySlots.map((slot) => {
                  const isAvailable = slot.state === 'AVAILABLE';
                  const isSelected = isAvailable && selectedStartTime === slot.startTime;

                  let cardStyles =
                    'bg-[#090D16] border-emerald-800/70 hover:border-[#A3E635] text-white';
                  let statusLabel = 'Available';
                  let statusColor = 'text-emerald-400';

                  if (isSelected) {
                    cardStyles =
                      'bg-[#A3E635]/15 border-[#A3E635] ring-1 ring-[#A3E635] text-white';
                    statusLabel = 'Selected';
                    statusColor = 'text-[#A3E635]';
                  } else if (slot.state === 'AWAITING_OWNER_APPROVAL') {
                    cardStyles =
                      'bg-amber-950/25 border-amber-800/60 text-slate-400 cursor-not-allowed opacity-85';
                    statusLabel = 'GPay Proof Sent';
                    statusColor = 'text-amber-400';
                  } else if (slot.state === 'HOLD') {
                    cardStyles =
                      'bg-amber-950/20 border-amber-800/40 text-slate-400 cursor-not-allowed opacity-80';
                    statusLabel = 'On 10m Hold';
                    statusColor = 'text-amber-300';
                  } else if (slot.state === 'BOOKED_ONLINE') {
                    cardStyles =
                      'bg-slate-900/90 border-slate-800 text-slate-500 cursor-not-allowed opacity-70';
                    statusLabel = 'Booked Online';
                    statusColor = 'text-slate-500';
                  } else if (slot.state === 'BOOKED_WALK_IN') {
                    cardStyles =
                      'bg-slate-900/90 border-slate-800 text-slate-500 cursor-not-allowed opacity-70';
                    statusLabel = 'Walk-In Booked';
                    statusColor = 'text-slate-500';
                  } else if (slot.state === 'BLOCKED') {
                    cardStyles =
                      'bg-slate-950 border-slate-800/60 text-slate-600 cursor-not-allowed opacity-60';
                    statusLabel = 'Maintenance';
                    statusColor = 'text-slate-500';
                  }

                  return (
                    <button
                      key={slot.startTime}
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => setSelectedStartTime(slot.startTime)}
                      className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[82px] ${cardStyles}`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-xs font-semibold">
                          {slot.startTime}–{slot.endTime}
                        </span>
                        {slot.priceBreakdown.isPeakEvening && isAvailable && (
                          <span className="text-[10px] font-mono text-amber-300">Floodlight</span>
                        )}
                      </div>

                      <div className="mt-2 flex items-baseline justify-between gap-1">
                        <span className="font-mono text-xs font-bold">
                          ₹{slot.priceBreakdown.totalAmount}
                        </span>
                        <span className="text-[10px] font-mono text-[#A3E635]">
                          Adv ₹{slot.priceBreakdown.advanceAmount}
                        </span>
                      </div>

                      <div className={`text-[10px] font-medium mt-1 truncate ${statusColor}`}>
                        {statusLabel}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right 4 Columns: Player Details & GPay QR Advance Checkout Card */}
          <form
            onSubmit={handleHoldSlotAndOpenGpay}
            className="lg:col-span-4 bg-[#0F1624] border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5 sticky top-20"
          >
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-mono text-[#A3E635]">STEP 2 · ADVANCE CHECKOUT</p>
                <h3 className="text-lg font-display font-bold tracking-wide text-white">
                  Reservation Summary &amp; GPay Split
                </h3>
              </div>
              {!currentUser && (
                <button
                  type="button"
                  onClick={() => onOpenAuth('PLAYER_LOGIN')}
                  className="text-xs text-[#A3E635] hover:underline font-medium"
                >
                  Login
                </button>
              )}
            </div>

            {selectedSlotObj && checkoutPrice ? (
              <div className="bg-[#090D16] border border-slate-800 rounded-xl p-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Court</span>
                  <span className="font-semibold text-white">{selectedCourt.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Date &amp; Time</span>
                  <span className="font-mono text-slate-200">
                    {selectedDate} · {selectedSlotObj.startTime}–{selectedSlotObj.endTime}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Sport &amp; Duration</span>
                  <span className="text-slate-200">
                    {selectedSport} ({selectedDuration} mins)
                  </span>
                </div>
              </div>
            ) : (
              <div className="bg-[#090D16] border border-dashed border-slate-800 rounded-xl p-4 text-xs text-slate-400 text-center">
                Select any green <strong className="text-white">Available</strong> slot on the left
                to calculate your {venueSettings.advancePercentage}% GPay advance.
              </div>
            )}

            {/* Player Details Inputs */}
            <div className="space-y-3">
              <div>
                <label htmlFor="player-name" className="block text-xs text-slate-300 mb-1">
                  Player / Team Captain Name *
                </label>
                <input
                  id="player-name"
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full px-3.5 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-[#A3E635]"
                />
              </div>

              <div>
                <label htmlFor="player-phone" className="block text-xs text-slate-300 mb-1">
                  WhatsApp / Mobile Number *
                </label>
                <input
                  id="player-phone"
                  type="tel"
                  required
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="+91 98450 11223"
                  className="w-full px-3.5 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-[#A3E635]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="promo-code" className="block text-xs text-slate-300">
                    Promo Code (Optional)
                  </label>
                  <span className="text-[11px] font-mono text-slate-400">
                    Try: FIRST10 · TURF200 · NIGHT150
                  </span>
                </div>
                <div className="relative">
                  <Tag className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="promo-code"
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                    placeholder="FIRST10"
                    className="w-full pl-8 pr-3 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-xs font-mono uppercase text-white focus:outline-none focus:border-[#A3E635]"
                  />
                </div>
                {matchedCoupon && (
                  <p className="text-[11px] text-emerald-400 mt-1">
                    Applied {matchedCoupon.code}: {matchedCoupon.description}
                  </p>
                )}
              </div>

              {/* Payment Split Choice */}
              <div className="pt-1">
                <span className="block text-xs text-slate-300 mb-1.5">GPay QR Payment Option</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayFullOnline(false)}
                    className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                      !payFullOnline
                        ? 'bg-[#141D2E] border-[#A3E635] text-white'
                        : 'bg-[#090D16] border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="font-semibold text-[#A3E635]">
                      Pay {venueSettings.advancePercentage}% Advance
                    </div>
                    <div className="text-[11px] text-slate-400">Rest at Turf Counter</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPayFullOnline(true)}
                    className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                      payFullOnline
                        ? 'bg-[#141D2E] border-[#A3E635] text-white'
                        : 'bg-[#090D16] border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="font-semibold text-white">Pay 100% Full</div>
                    <div className="text-[11px] text-slate-400">Zero Venue Balance</div>
                  </button>
                </div>
              </div>
            </div>

            {/* Pricing Breakdown */}
            {checkoutPrice && (
              <div className="bg-[#090D16] border border-slate-800 rounded-xl p-4 space-y-2 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Base Turf Fee</span>
                  <span className="font-mono text-slate-200">₹{checkoutPrice.baseAmount}</span>
                </div>
                {checkoutPrice.discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-400">
                    <span>Coupon Discount ({checkoutPrice.appliedCoupon})</span>
                    <span className="font-mono">-₹{checkoutPrice.discountAmount}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-300 font-medium pt-1 border-t border-slate-800">
                  <span>Total Booking Amount</span>
                  <span className="font-mono">₹{checkoutPrice.totalAmount}</span>
                </div>
                <div className="flex justify-between text-[#A3E635] font-semibold text-sm pt-1">
                  <span>Pay Advance via Owner GPay QR</span>
                  <span className="font-mono">₹{checkoutPrice.advanceAmount}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Remaining Payable at Venue</span>
                  <span className="font-mono text-slate-200">₹{checkoutPrice.balanceAmount}</span>
                </div>
              </div>
            )}

            {checkoutError && (
              <div className="text-xs text-red-300 bg-red-950/50 border border-red-800/70 rounded-lg px-3.5 py-2.5">
                {checkoutError}
              </div>
            )}

            <button
              type="submit"
              disabled={holdingSlot || !selectedSlotObj}
              className="w-full py-3.5 px-4 bg-[#A3E635] hover:bg-[#bef264] text-slate-950 font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <QrCode className="w-4 h-4" />
              <span>
                {holdingSlot
                  ? 'Locking Slot...'
                  : checkoutPrice
                    ? `Hold Slot & Pay ₹${checkoutPrice.advanceAmount} on GPay`
                    : 'Select an Available Slot to Continue'}
              </span>
            </button>
          </form>
        </div>
      </section>

      {/* 4. COURTS & DYNAMIC RATE CARDS */}
      <section id="courts-section" className="scroll-mt-24 space-y-6">
        <div>
          <p className="text-xs font-mono text-[#A3E635] uppercase">
            02. ARENA SPECIFICATIONS &amp; RATES
          </p>
          <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-wide text-white">
            Turf Courts &amp; Dynamic Hourly Pricing
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {courts.map((court, idx) => (
            <div
              key={court.id}
              className="bg-[#0F1624] border border-slate-800 rounded-2xl overflow-hidden flex flex-col justify-between"
            >
              <div>
                <div className="relative h-56 bg-[#090D16]">
                  <TurfImage
                    src={court.id === 'court-2' ? COURT_2_IMAGE_URL : COURT_1_IMAGE_URL}
                    variant={idx === 1 ? 'cricket' : 'football'}
                    alt={court.name}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0F1624] via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
                    <div>
                      <span className="text-xs font-mono text-[#A3E635]">
                        {court.sportTypes.join(' · ')}
                      </span>
                      <h3 className="text-xl font-display font-bold text-white">{court.name}</h3>
                    </div>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  <p className="text-xs text-slate-300">
                    {court.capacity} · {court.surface}
                  </p>
                  <p className="text-xs text-slate-400">
                    Facilities: {court.facilities.join(' · ')}
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800">
                    <div className="bg-[#090D16] p-2.5 rounded-lg border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block">Weekday Day</span>
                      <span className="font-mono text-xs font-semibold text-white">
                        ₹{court.pricing.weekdayMorningRate}/hr
                      </span>
                    </div>
                    <div className="bg-[#090D16] p-2.5 rounded-lg border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block">Weekday Floodlight</span>
                      <span className="font-mono text-xs font-semibold text-[#A3E635]">
                        ₹{court.pricing.weekdayEveningRate}/hr
                      </span>
                    </div>
                    <div className="bg-[#090D16] p-2.5 rounded-lg border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block">Weekend Day</span>
                      <span className="font-mono text-xs font-semibold text-white">
                        ₹{court.pricing.weekendMorningRate}/hr
                      </span>
                    </div>
                    <div className="bg-[#090D16] p-2.5 rounded-lg border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block">Weekend Floodlight</span>
                      <span className="font-mono text-xs font-semibold text-[#A3E635]">
                        ₹{court.pricing.weekendEveningRate}/hr
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 5. CUSTOMER MY BOOKINGS & GPAY VERIFICATION STATUS */}
      <section id="my-bookings-section" className="scroll-mt-24 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-mono text-[#A3E635] uppercase">
              03. PLAYER RESERVATION LEDGER
            </p>
            <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-wide text-white">
              My Bookings &amp; Live Owner Verification Status
            </h2>
          </div>

          <div className="inline-flex p-1 bg-[#0F1624] border border-slate-800 rounded-xl">
            {(
              [
                { id: 'ALL', label: `All Reservations (${myBookings.length})` },
                { id: 'PENDING', label: 'Pending GPay Approval' },
                { id: 'CONFIRMED', label: 'Confirmed Slots' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setBookingFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  bookingFilter === tab.id
                    ? 'bg-[#A3E635] text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {myBookings.length === 0 ? (
            <div className="bg-[#0F1624] border border-slate-800 rounded-2xl p-8 text-center space-y-3">
              <p className="text-sm font-semibold text-white">
                {currentUser
                  ? `No turf reservations yet for @${currentUser.username}`
                  : 'No active turf reservations in this session yet'}
              </p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Select an available green time slot in the booking engine above, scan the owner’s
                GPay QR code for the {venueSettings.advancePercentage}% advance, and upload your
                payment screenshot to track live confirmation here.
              </p>
              {!currentUser && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => onOpenAuth('PLAYER_LOGIN')}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#141D2E] hover:bg-slate-800 border border-slate-700 text-xs font-medium text-[#A3E635] rounded-lg transition-colors"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Sign In with Username &amp; Password to View Past Bookings</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            myBookings.map((booking) => {
              const isConfirmed = booking.status === 'CONFIRMED';
              const isPendingOwner = booking.status === 'AWAITING_OWNER_APPROVAL';
              const isHold = booking.status === 'HOLD';

              return (
                <div
                  key={booking.id}
                  className="bg-[#0F1624] border border-slate-800 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5 text-xs">
                      <span className="font-mono font-semibold text-[#A3E635]">
                        {booking.bookingReference}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-300 font-medium">{booking.customerName}</span>
                      <span className="text-slate-600">·</span>
                      {isConfirmed && (
                        <span className="text-emerald-400 font-mono font-semibold">
                          Confirmed by Owner
                        </span>
                      )}
                      {isPendingOwner && (
                        <span className="text-amber-300 font-mono font-semibold">
                          GPay Screenshot Uploaded — Awaiting 1-Click Owner Approval
                        </span>
                      )}
                      {isHold && (
                        <span className="text-amber-400 font-mono">
                          Slot Held — Complete GPay Screenshot Upload
                        </span>
                      )}
                      {booking.status === 'REJECTED' && (
                        <span className="text-red-400 font-mono">
                          Screenshot Declined ({booking.rejectionReason})
                        </span>
                      )}
                      {booking.status === 'CANCELLED' && (
                        <span className="text-slate-500 font-mono">Cancelled</span>
                      )}
                    </div>

                    <h3 className="text-base font-semibold text-white">
                      {booking.courtName} · {booking.sport} ({booking.bookingDate} ·{' '}
                      {booking.startTime}–{booking.endTime})
                    </h3>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400 font-mono">
                      <span>Total: ₹{booking.totalAmount}</span>
                      <span className="text-[#A3E635]">GPay Advance: ₹{booking.advanceAmount}</span>
                      <span>Venue Counter Balance: ₹{booking.balanceAmount}</span>
                      {booking.upiReferenceUtr && <span>UTR: {booking.upiReferenceUtr}</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    {isHold && (
                      <button
                        type="button"
                        onClick={() => setActiveGpayBooking(booking)}
                        className="px-3.5 py-2 bg-[#A3E635] text-slate-950 font-semibold text-xs rounded-lg"
                      >
                        Upload GPay Screenshot
                      </button>
                    )}

                    {booking.screenshotDataUrl && (
                      <button
                        type="button"
                        onClick={() => setPreviewReceiptBooking(booking)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#141D2E] hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 rounded-lg"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#A3E635]" />
                        <span>View GPay Screenshot</span>
                      </button>
                    )}

                    {isConfirmed && (
                      <button
                        type="button"
                        onClick={() => setEntryQrBooking(booking)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-700/70 text-xs text-emerald-200 font-medium rounded-lg"
                      >
                        <QrCode className="w-3.5 h-3.5 text-[#A3E635]" />
                        <span>Entry QR Pass</span>
                      </button>
                    )}

                    {(isHold || isPendingOwner || isConfirmed) && (
                      <button
                        type="button"
                        onClick={() => handleCancelBooking(booking.id)}
                        className="inline-flex items-center gap-1 px-3 py-2 bg-red-950/30 hover:bg-red-950/60 border border-red-900/50 text-xs text-red-300 rounded-lg"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* GPAY ADVANCE & SCREENSHOT UPLOAD MODAL */}
      {activeGpayBooking && (
        <GpayAdvanceModal
          booking={activeGpayBooking}
          venueSettings={venueSettings}
          onClose={() => setActiveGpayBooking(null)}
          onSubmitted={async (updated) => {
            setActiveGpayBooking(null);
            setSelectedStartTime(null);
            await onBookingCreatedOrUpdated();
            setBannerNotice(
              `GPay screenshot uploaded for ${updated.bookingReference}! Your slot (${updated.startTime}–${updated.endTime}) is now locked awaiting the Turf Owner’s 1-click confirmation.`
            );
          }}
        />
      )}

      {/* PREVIEW UPLOADED GPAY SCREENSHOT MODAL */}
      {previewReceiptBooking && previewReceiptBooking.screenshotDataUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Uploaded GPay screenshot preview"
        >
          <div className="bg-[#0F1624] border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <p className="text-xs font-mono text-[#A3E635]">
                  {previewReceiptBooking.bookingReference} · UTR{' '}
                  {previewReceiptBooking.upiReferenceUtr}
                </p>
                <h3 className="text-base font-semibold text-white">
                  Uploaded GPay Advance Receipt (₹{previewReceiptBooking.advanceAmount})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewReceiptBooking(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>
            <div className="flex justify-center bg-[#090D16] p-3 rounded-xl border border-slate-800">
              <img
                src={previewReceiptBooking.screenshotDataUrl}
                alt="GPay Receipt"
                className="max-h-96 object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* TURF ENTRY QR PASS MODAL */}
      {entryQrBooking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmed Turf Entry QR Pass"
        >
          <div className="bg-[#0F1624] border border-slate-800 rounded-2xl max-w-sm w-full p-6 text-center space-y-4">
            <p className="text-xs font-mono text-[#A3E635]">CONFIRMED TURF ENTRY PASS</p>
            <h3 className="text-lg font-display font-bold text-white">
              {entryQrBooking.courtName}
            </h3>
            <p className="text-xs font-mono text-slate-300">
              {entryQrBooking.bookingDate} · {entryQrBooking.startTime}–{entryQrBooking.endTime}
            </p>
            <div className="flex justify-center py-2">
              <QrCodeSvg
                value={`SPORTSPOT-PASS|${entryQrBooking.bookingReference}|${entryQrBooking.customerName}|${entryQrBooking.bookingDate}|${entryQrBooking.startTime}|BAL:${entryQrBooking.balanceAmount}`}
                size={180}
                label={entryQrBooking.bookingReference}
              />
            </div>
            <div className="bg-[#090D16] border border-slate-800 rounded-xl p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Advance Verified</span>
                <span className="font-mono text-emerald-400">₹{entryQrBooking.paidAmount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Payable at Counter</span>
                <span className="font-mono text-white">₹{entryQrBooking.balanceAmount}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEntryQrBooking(null)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white rounded-lg"
            >
              Close Entry Pass
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
