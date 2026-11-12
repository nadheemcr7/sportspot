import React, { useState, useMemo } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  QrCode,
  ShieldCheck,
  MapPin,
  Phone,
  Eye,
  XCircle,
  Ticket,
  ArrowRight,
  FileCheck2,
} from 'lucide-react';
import {
  BookingRecord,
  CouponRecord,
  Court,
  SlotLockRecord,
  SportType,
  VenueSettings,
} from '../types/sportspot';
import {
  calculatePriceBreakdown,
  computeDailySlotsForCourt,
} from '../utils/bookingEngine';
import { GpayAdvanceModal } from './GpayAdvanceModal';
import { QrCodeSvg } from './QrCodeSvg';

interface CustomerPortalProps {
  venueSettings: VenueSettings;
  courts: Court[];
  bookings: BookingRecord[];
  slotLocks: Record<string, SlotLockRecord>;
  coupons: CouponRecord[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onRefreshState: () => Promise<void>;
  onOpenBlueprint: () => void;
  onSwitchToOwner: () => void;
}

function getNext7Days(baseDateStr: string): { dateStr: string; dayLabel: string; numLabel: string }[] {
  const [y, m, d] = baseDateStr.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  const days: { dateStr: string; dayLabel: string; numLabel: string }[] = [];

  for (let i = 0; i < 7; i++) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + i);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const dateStr = `${yy}-${mm}-${dd}`;
    const dayLabel =
      i === 0
        ? 'Today'
        : i === 1
          ? 'Tomorrow'
          : dt.toLocaleDateString('en-US', { weekday: 'short' });
    const numLabel = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    days.push({ dateStr, dayLabel, numLabel });
  }
  return days;
}

export const CustomerPortal: React.FC<CustomerPortalProps> = ({
  venueSettings,
  courts,
  bookings,
  slotLocks,
  coupons,
  selectedDate,
  onSelectDate,
  onRefreshState,
  onOpenBlueprint,
  onSwitchToOwner,
}) => {
  const activeCourts = useMemo(() => courts.filter((c) => c.active), [courts]);
  const [selectedCourtId, setSelectedCourtId] = useState<string>(
    activeCourts[0]?.id || 'court-1'
  );
  const selectedCourt = useMemo(
    () => activeCourts.find((c) => c.id === selectedCourtId) || activeCourts[0],
    [activeCourts, selectedCourtId]
  );

  const [selectedSport, setSelectedSport] = useState<SportType>(
    selectedCourt?.sportTypes[0] || 'Football'
  );
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [selectedStartTime, setSelectedStartTime] = useState<string>('16:00');

  // Checkout customer fields
  const [customerName, setCustomerName] = useState<string>('Vikramaditya Rao');
  const [customerPhone, setCustomerPhone] = useState<string>('+91 99001 55219');
  const [customerEmail, setCustomerEmail] = useState<string>('vikram.rao@gmail.com');
  const [couponInput, setCouponInput] = useState<string>('');
  const [payFullOnline, setPayFullOnline] = useState<boolean>(false);

  const [bookingError, setBookingError] = useState<string | null>(null);
  const [holdingSlot, setHoldingSlot] = useState<boolean>(false);
  const [activeHoldBooking, setActiveHoldBooking] = useState<BookingRecord | null>(null);
  const [confirmedBannerBooking, setConfirmedBannerBooking] = useState<BookingRecord | null>(null);

  // My Bookings filter & modals
  const [myBookingFilter, setMyBookingFilter] = useState<'ALL' | 'PENDING' | 'CONFIRMED'>('ALL');
  const [previewScreenshotBooking, setPreviewScreenshotBooking] = useState<BookingRecord | null>(
    null
  );
  const [entryPassBooking, setEntryPassBooking] = useState<BookingRecord | null>(null);

  const todayStr = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
  }, []);

  const dateOptions = useMemo(() => getNext7Days(todayStr), [todayStr]);

  const computedSlots = useMemo(() => {
    if (!selectedCourt) return [];
    return computeDailySlotsForCourt({
      court: selectedCourt,
      bookingDate: selectedDate,
      durationMinutes,
      openingTime: venueSettings.openingTime,
      closingTime: venueSettings.closingTime,
      advancePercentage: venueSettings.advancePercentage,
      locksByKey: slotLocks,
      nowIso: new Date().toISOString(),
    });
  }, [selectedCourt, selectedDate, durationMinutes, venueSettings, slotLocks]);

  // Ensure selectedStartTime points to an available slot if current selection is not in list
  const selectedSlotCard = useMemo(
    () => computedSlots.find((s) => s.startTime === selectedStartTime) || null,
    [computedSlots, selectedStartTime]
  );

  const matchedCoupon = useMemo(() => {
    if (!couponInput.trim()) return null;
    return (
      coupons.find(
        (c) => c.active && c.code.toUpperCase() === couponInput.trim().toUpperCase()
      ) || null
    );
  }, [coupons, couponInput]);

  const liveCheckoutPrice = useMemo(() => {
    if (!selectedCourt) return null;
    return calculatePriceBreakdown({
      court: selectedCourt,
      bookingDate: selectedDate,
      startTime: selectedStartTime || '16:00',
      durationMinutes,
      advancePercentage: venueSettings.advancePercentage,
      coupon: matchedCoupon,
      payFullOnline,
    });
  }, [
    selectedCourt,
    selectedDate,
    selectedStartTime,
    durationMinutes,
    venueSettings.advancePercentage,
    matchedCoupon,
    payFullOnline,
  ]);

  const availableSlotCount = useMemo(
    () => computedSlots.filter((s) => s.state === 'AVAILABLE').length,
    [computedSlots]
  );

  const handleReserveAndShowGpayQr = async (e: React.FormEvent) => {
    e.preventDefault();
    setBookingError(null);

    if (!customerName.trim() || !customerPhone.trim()) {
      setBookingError('Please enter your full name and 10-digit mobile number.');
      return;
    }

    if (!selectedSlotCard || selectedSlotCard.state !== 'AVAILABLE') {
      setBookingError('Please select an available (green) time slot on the grid.');
      return;
    }

    setHoldingSlot(true);
    try {
      const response = await fetch('/api/bookings/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'cust-demo',
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerEmail: customerEmail.trim(),
          courtId: selectedCourt.id,
          sport: selectedSport,
          bookingDate: selectedDate,
          startTime: selectedSlotCard.startTime,
          durationMinutes,
          couponCode: matchedCoupon?.code || null,
          payFullOnline,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Could not hold the selected slot.');
      }
      await onRefreshState();
      setActiveHoldBooking(data.booking);
    } catch (err: any) {
      setBookingError(err.message || 'Could not reserve slot.');
    } finally {
      setHoldingSlot(false);
    }
  };

  const handleCancelBooking = async (bookingId: string) => {
    try {
      const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
        method: 'POST',
      });
      if (res.ok) {
        await onRefreshState();
      }
    } catch (err) {
      console.error('Failed to cancel booking:', err);
    }
  };

  const filteredMyBookings = useMemo(() => {
    return bookings.filter((b) => {
      if (myBookingFilter === 'PENDING') return b.status === 'AWAITING_OWNER_APPROVAL';
      if (myBookingFilter === 'CONFIRMED') return b.status === 'CONFIRMED';
      return true;
    });
  }, [bookings, myBookingFilter]);

  return (
    <div className="space-y-16 pb-20">
      {/* 1. HERO SECTION */}
      <section className="max-w-7xl mx-auto px-6 pt-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left Copy Column */}
          <div className="lg:col-span-7 flex flex-col justify-between bg-[#0F1624] border border-slate-800/90 rounded-2xl p-8 lg:p-10">
            <div className="space-y-5">
              <p className="text-xs font-mono tracking-wider text-[#A3E635]">
                ELECTRONIC CITY PHASE I · LIVE SLOT ENGINE · DIRECT GPAY QR ADVANCE
              </p>
              <h1
                className="font-display font-bold tracking-wide text-white uppercase leading-[1.03]"
                style={{ fontSize: 'clamp(2.4rem, 4.2vw, 3.85rem)' }}
              >
                Your Game. Your Turf. Instant GPay Slot Lock.
              </h1>
              <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
                Check real-time availability synchronized across online players and counter walk-ins.
                Reserve your slot, pay the {venueSettings.advancePercentage}% advance directly via
                the Owner’s Google Pay QR code, and upload your screenshot for 1-click confirmation.
              </p>
            </div>

            <div className="pt-8 space-y-6">
              <div className="flex flex-wrap items-center gap-4">
                <a
                  href="#booking-engine"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#A3E635] hover:bg-[#bef264] text-slate-950 font-semibold text-sm rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <span>Reserve Your Turf Slot</span>
                  <ArrowRight className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={onOpenBlueprint}
                  className="px-5 py-3 bg-[#141D2E] hover:bg-slate-800 text-slate-200 border border-slate-700 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  View Supabase & GPay QR Blueprint
                </button>
              </div>

              <div className="pt-5 border-t border-slate-800/80 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
                <span>{venueSettings.venueName}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-300">
                  Open {venueSettings.openingTime} – {venueSettings.closingTime}
                </span>
                <span aria-hidden="true">·</span>
                <span>Zero Payment Gateway Markup</span>
              </div>
            </div>
          </div>

          {/* Right 16:9 Stadium Visual Carrier */}
          <div className="lg:col-span-5 relative rounded-2xl overflow-hidden border border-slate-800 bg-gradient-to-br from-emerald-950 via-slate-900 to-slate-950 min-h-[340px]">
            <img
              src="/src/assets/images/hero_stadium_turf_1794488668863.jpg"
              alt="SportSpot floodlit artificial grass football and box cricket stadium arena at night"
              referrerPolicy="no-referrer"
              className="w-full h-full lg:h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#090D16] via-[#090D16]/45 to-transparent" />
            <div className="absolute bottom-0 inset-x-0 p-6 flex flex-col justify-end">
              <p className="text-xs font-mono text-[#A3E635]">
                LIVE AVAILABILITY · {selectedDate}
              </p>
              <p className="text-lg font-semibold text-white mt-0.5">
                {availableSlotCount} Open Slots on {selectedCourt?.name.split('—')[0]}
              </p>
              <p className="text-xs text-slate-300 mt-1">
                Advance UPI ID: <span className="font-mono text-white">{venueSettings.ownerUpiId}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Full-Width 4-Step GPay QR Workflow Bar below the Hero Split */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#0F1624] border border-slate-800/80 rounded-xl p-4">
            <p className="text-xs font-mono text-[#A3E635]">01. Choose Court & Time</p>
            <p className="text-sm font-semibold text-white mt-1">Real-Time Atomic Lock</p>
            <p className="text-xs text-slate-400 mt-1">
              Locks 30-min segments so online players and walk-ins never collide.
            </p>
          </div>
          <div className="bg-[#0F1624] border border-slate-800/80 rounded-xl p-4">
            <p className="text-xs font-mono text-[#A3E635]">
              02. Scan Owner’s GPay QR ({venueSettings.advancePercentage}% Advance)
            </p>
            <p className="text-sm font-semibold text-white mt-1">No Payment Gateway Needed</p>
            <p className="text-xs text-slate-400 mt-1">
              Pay the advance directly to {venueSettings.ownerUpiId}; pay balance at turf.
            </p>
          </div>
          <div className="bg-[#0F1624] border border-slate-800/80 rounded-xl p-4">
            <p className="text-xs font-mono text-[#A3E635]">03. Upload GPay Screenshot</p>
            <p className="text-sm font-semibold text-white mt-1">Instant Proof Submission</p>
            <p className="text-xs text-slate-400 mt-1">
              Attach your GPay screenshot & UTR; slot stays reserved for you.
            </p>
          </div>
          <div className="bg-[#0F1624] border border-slate-800/80 rounded-xl p-4">
            <p className="text-xs font-mono text-[#A3E635]">04. 1-Click Owner Approval</p>
            <p className="text-sm font-semibold text-white mt-1">Verified & Ready to Play</p>
            <p className="text-xs text-slate-400 mt-1">
              Owner views your screenshot in dashboard & confirms slot in one click.
            </p>
          </div>
        </div>
      </section>

      {/* Banner when a customer just uploaded a screenshot */}
      {confirmedBannerBooking && (
        <section className="max-w-7xl mx-auto px-6">
          <div className="bg-emerald-950/40 border border-emerald-700/70 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono">
                <FileCheck2 className="w-4 h-4" />
                <span>
                  GPAY SCREENSHOT UPLOADED · REF {confirmedBannerBooking.bookingReference} · AWAITING OWNER 1-CLICK CONFIRMATION
                </span>
              </div>
              <h3 className="text-lg font-semibold text-white">
                Slot Reserved for {confirmedBannerBooking.customerName} — {confirmedBannerBooking.courtName} ({confirmedBannerBooking.startTime}–{confirmedBannerBooking.endTime})
              </h3>
              <p className="text-xs text-slate-300">
                Advance Paid via GPay: <span className="font-mono font-semibold text-white">₹{confirmedBannerBooking.advanceAmount}</span> (UTR: <span className="font-mono">{confirmedBannerBooking.upiReferenceUtr}</span>) · Balance at Venue: <span className="font-mono font-semibold text-white">₹{confirmedBannerBooking.balanceAmount}</span>
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={onSwitchToOwner}
                className="px-4 py-2 bg-[#A3E635] hover:bg-[#bef264] text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap"
              >
                Open Owner Dashboard to 1-Click Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmedBannerBooking(null)}
                className="px-3 py-2 text-xs text-slate-300 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 2. INTERACTIVE LIVE BOOKING ENGINE */}
      <section id="booking-engine" className="max-w-7xl mx-auto px-6 scroll-mt-20">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-6 gap-4">
          <div>
            <p className="text-xs font-mono text-[#A3E635]">01. LIVE RESERVATION ENGINE</p>
            <h2 className="text-3xl font-display font-bold tracking-wide text-white uppercase mt-1">
              Select Court, Date & Available Slot
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
            <span>Available: Green border</span>
            <span>·</span>
            <span>Pending GPay Verification: Amber</span>
            <span>·</span>
            <span>Booked (Online / Walk-In): Slate</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left 8 Columns: Court, Date, Duration & Live Slot Grid */}
          <div className="lg:col-span-8 space-y-6 bg-[#0F1624] border border-slate-800 rounded-2xl p-6">
            {/* Step A: Court & Sport Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeCourts.map((court) => {
                const isSelected = court.id === selectedCourt?.id;
                return (
                  <button
                    key={court.id}
                    type="button"
                    onClick={() => {
                      setSelectedCourtId(court.id);
                      if (!court.sportTypes.includes(selectedSport)) {
                        setSelectedSport(court.sportTypes[0]);
                      }
                    }}
                    className={`text-left p-4 rounded-xl border transition-colors ${
                      isSelected
                        ? 'bg-[#141D2E] border-[#A3E635]'
                        : 'bg-[#090D16] border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">{court.name}</span>
                      <span className="text-xs font-mono text-[#A3E635]">
                        ₹{court.pricing.weekdayMorningRate}–₹{court.pricing.weekendEveningRate}/hr
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{court.surface}</p>
                    <p className="text-xs text-slate-500 mt-2">
                      {court.capacity} · {court.sportTypes.join(' / ')}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Step B: Sport & Duration Segmented Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-slate-800/80">
              <div>
                <span className="block text-xs text-slate-400 mb-1.5">Select Sport</span>
                <div className="inline-flex items-center gap-1 p-1 bg-[#090D16] border border-slate-800 rounded-lg">
                  {(selectedCourt?.sportTypes || ['Football', 'Box Cricket']).map((sport) => (
                    <button
                      key={sport}
                      type="button"
                      onClick={() => setSelectedSport(sport)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        selectedSport === sport
                          ? 'bg-[#A3E635] text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {sport}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-xs text-slate-400 mb-1.5">Slot Duration</span>
                <div className="inline-flex items-center gap-1 p-1 bg-[#090D16] border border-slate-800 rounded-lg">
                  {(selectedCourt?.allowedDurations || [60, 90, 120]).map((dur) => (
                    <button
                      key={dur}
                      type="button"
                      onClick={() => setDurationMinutes(dur)}
                      className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap ${
                        durationMinutes === dur
                          ? 'bg-[#A3E635] text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {dur} mins
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Step C: 7-Day Date Selector Strip */}
            <div className="pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400">Select Playing Date</span>
                <span className="text-xs font-mono text-slate-400">{selectedDate}</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
                {dateOptions.map((d) => {
                  const active = d.dateStr === selectedDate;
                  return (
                    <button
                      key={d.dateStr}
                      type="button"
                      onClick={() => onSelectDate(d.dateStr)}
                      className={`py-2.5 px-2 rounded-lg border text-center transition-colors ${
                        active
                          ? 'bg-[#A3E635] text-slate-950 border-[#A3E635] font-semibold'
                          : 'bg-[#090D16] text-slate-300 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="text-[11px]">{d.dayLabel}</div>
                      <div className="text-xs font-mono mt-0.5">{d.numLabel}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step D: Live Slot Cards Grid */}
            <div className="pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-slate-300">
                  Live Time Slots ({durationMinutes} mins) — {selectedCourt?.name}
                </span>
                <span className="text-xs font-mono text-[#A3E635]">
                  {availableSlotCount} of {computedSlots.length} available
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {computedSlots.map((slot) => {
                  const isAvailable = slot.state === 'AVAILABLE';
                  const isSelected = isAvailable && slot.startTime === selectedStartTime;

                  let stateLabel = 'Available';
                  let cardClass =
                    'bg-[#090D16] border-emerald-800/70 hover:border-[#A3E635] text-slate-100';

                  if (isSelected) {
                    stateLabel = 'Selected';
                    cardClass =
                      'bg-[#141D2E] border-2 border-[#A3E635] text-white shadow-sm';
                  } else if (slot.state === 'AWAITING_OWNER_APPROVAL') {
                    stateLabel = 'GPay Proof Sent';
                    cardClass =
                      'bg-amber-950/25 border-amber-800/60 text-amber-200/80 cursor-not-allowed opacity-80';
                  } else if (slot.state === 'HOLD') {
                    stateLabel = 'Held (Paying)';
                    cardClass =
                      'bg-amber-950/20 border-amber-800/50 text-amber-300/75 cursor-not-allowed opacity-75';
                  } else if (slot.state === 'BOOKED_ONLINE') {
                    stateLabel = 'Booked Online';
                    cardClass =
                      'bg-slate-900/60 border-slate-800 text-slate-500 cursor-not-allowed opacity-65';
                  } else if (slot.state === 'BOOKED_WALK_IN') {
                    stateLabel = 'Walk-In Booked';
                    cardClass =
                      'bg-slate-900/60 border-slate-800 text-slate-500 cursor-not-allowed opacity-65';
                  } else if (slot.state === 'BLOCKED') {
                    stateLabel = 'Maintenance';
                    cardClass =
                      'bg-slate-950 border-slate-800/70 text-slate-600 cursor-not-allowed opacity-60';
                  }

                  return (
                    <button
                      key={slot.startTime}
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => setSelectedStartTime(slot.startTime)}
                      aria-label={`Slot ${slot.startTime} to ${slot.endTime} ${stateLabel} Total ${slot.priceBreakdown.totalAmount} rupees`}
                      className={`p-3 rounded-xl border text-left transition-colors ${cardClass}`}
                    >
                      <div className="flex items-center justify-between text-xs font-mono font-semibold">
                        <span>
                          {slot.startTime}–{slot.endTime}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-baseline justify-between">
                        <span className="text-xs font-mono text-slate-300">
                          ₹{slot.priceBreakdown.totalAmount}
                        </span>
                        <span className="text-[11px] font-mono text-[#A3E635]">
                          Adv ₹{slot.priceBreakdown.advanceAmount}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400 truncate">
                        {stateLabel}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right 4 Columns: Checkout & Owner GPay QR Trigger */}
          <form
            onSubmit={handleReserveAndShowGpayQr}
            className="lg:col-span-4 bg-[#0F1624] border border-slate-800 rounded-2xl p-6 space-y-5 sticky top-20"
          >
            <div className="border-b border-slate-800 pb-4">
              <p className="text-xs font-mono text-[#A3E635]">STEP 2 · ADVANCE CHECKOUT</p>
              <h3 className="text-xl font-display font-bold tracking-wide text-white uppercase mt-0.5">
                Reservation Summary & GPay Split
              </h3>
            </div>

            <div className="bg-[#090D16] border border-slate-800 rounded-xl p-4 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Selected Court</span>
                <span className="font-semibold text-white text-right">
                  {selectedCourt?.name.split('—')[0]}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Sport & Duration</span>
                <span className="font-mono text-slate-200">
                  {selectedSport} · {durationMinutes} mins
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Date & Slot</span>
                <span className="font-mono text-[#A3E635]">
                  {selectedDate} · {selectedSlotCard?.startTime || '--:--'}–
                  {selectedSlotCard?.endTime || '--:--'}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="cust-name"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Player Full Name *
                </label>
                <input
                  id="cust-name"
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter full name"
                  className="w-full px-3.5 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#A3E635]"
                />
              </div>

              <div>
                <label
                  htmlFor="cust-phone"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  WhatsApp / Mobile Number *
                </label>
                <input
                  id="cust-phone"
                  type="tel"
                  required
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="+91 98450 00000"
                  className="w-full px-3.5 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-sm font-mono text-white focus:outline-none focus:border-[#A3E635]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="coupon-code" className="text-xs font-medium text-slate-300">
                    Promo Code
                  </label>
                  <button
                    type="button"
                    onClick={() => setCouponInput('FIRSTGAME20')}
                    className="text-[11px] font-mono text-[#A3E635] hover:underline"
                  >
                    Apply FIRSTGAME20 (20% Off)
                  </button>
                </div>
                <input
                  id="coupon-code"
                  type="text"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  placeholder="FIRSTGAME20 or TURF200"
                  className="w-full px-3.5 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-xs font-mono text-white uppercase focus:outline-none focus:border-[#A3E635]"
                />
              </div>

              {/* Payment Split Toggle */}
              <div className="pt-1">
                <span className="block text-xs font-medium text-slate-300 mb-1.5">
                  GPay QR Payment Mode
                </span>
                <div className="grid grid-cols-2 gap-2 p-1 bg-[#090D16] border border-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setPayFullOnline(false)}
                    className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors ${
                      !payFullOnline
                        ? 'bg-[#141D2E] text-[#A3E635] border border-[#A3E635]/50'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {venueSettings.advancePercentage}% Advance Now
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayFullOnline(true)}
                    className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors ${
                      payFullOnline
                        ? 'bg-[#141D2E] text-[#A3E635] border border-[#A3E635]/50'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    100% Full Payment
                  </button>
                </div>
              </div>
            </div>

            {/* Price & Advance Split Summary */}
            {liveCheckoutPrice && (
              <div className="bg-[#090D16] border border-slate-800 rounded-xl p-4 space-y-2 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>
                    Base Turf Rate ({liveCheckoutPrice.isPeakEvening ? 'Peak Floodlight' : 'Day Rate'})
                  </span>
                  <span className="font-mono text-slate-200">₹{liveCheckoutPrice.baseAmount}</span>
                </div>
                {liveCheckoutPrice.discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-400">
                    <span>Coupon ({liveCheckoutPrice.appliedCoupon})</span>
                    <span className="font-mono">-₹{liveCheckoutPrice.discountAmount}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-200 font-medium pt-1.5 border-t border-slate-800">
                  <span>Total Booking Amount</span>
                  <span className="font-mono">₹{liveCheckoutPrice.totalAmount}</span>
                </div>
                <div className="flex justify-between text-[#A3E635] font-semibold text-sm pt-1">
                  <span>Pay Advance via Owner GPay QR</span>
                  <span className="font-mono">₹{liveCheckoutPrice.advanceAmount}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Remaining Payable at Venue</span>
                  <span className="font-mono text-slate-200">
                    ₹{liveCheckoutPrice.balanceAmount}
                  </span>
                </div>
              </div>
            )}

            {bookingError && (
              <div className="flex items-center gap-2 text-xs text-red-300 bg-red-950/50 border border-red-800/70 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{bookingError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={holdingSlot || !selectedSlotCard || selectedSlotCard.state !== 'AVAILABLE'}
              className="w-full py-3 px-4 bg-[#A3E635] hover:bg-[#bef264] text-slate-950 font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <QrCode className="w-4 h-4" />
              <span>
                {holdingSlot
                  ? 'Locking Slot...'
                  : `Reserve Slot & Pay ₹${liveCheckoutPrice?.advanceAmount || 0} on GPay`}
              </span>
            </button>
          </form>
        </div>
      </section>

      {/* 3. COURTS & TRANSPARENT RATE CARD */}
      <section id="courts-pricing" className="max-w-7xl mx-auto px-6 scroll-mt-20">
        <div className="mb-6">
          <p className="text-xs font-mono text-[#A3E635]">02. ARENA SPECIFICATIONS & RATES</p>
          <h2 className="text-3xl font-display font-bold tracking-wide text-white uppercase mt-1">
            Turf Courts & Dynamic Hourly Pricing
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {courts.map((court) => (
            <div
              key={court.id}
              className="bg-[#0F1624] border border-slate-800 rounded-2xl overflow-hidden flex flex-col justify-between"
            >
              <div>
                <div className="relative h-60 bg-gradient-to-br from-emerald-950 to-slate-900 overflow-hidden">
                  <img
                    src={court.imageUrl}
                    alt={court.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0F1624] via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-5 right-5 flex items-end justify-between">
                    <div>
                      <p className="text-xs font-mono text-[#A3E635]">
                        {court.sportTypes.join(' · ')}
                      </p>
                      <h3 className="text-xl font-display font-bold text-white uppercase">
                        {court.name}
                      </h3>
                    </div>
                  </div>
                </div>

                <div className="p-6 space-y-4">
                  <div className="text-xs text-slate-400">
                    <span>{court.capacity}</span>
                    <span className="mx-2">·</span>
                    <span>{court.surface}</span>
                  </div>
                  <div className="text-xs text-slate-300">
                    Facilities: {court.facilities.join(' · ')}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-slate-800 text-xs">
                    <div className="bg-[#090D16] p-3 rounded-lg border border-slate-800/80">
                      <span className="text-slate-400 block text-[11px]">Weekday Day</span>
                      <span className="font-mono font-semibold text-white text-sm">
                        ₹{court.pricing.weekdayMorningRate}/hr
                      </span>
                    </div>
                    <div className="bg-[#090D16] p-3 rounded-lg border border-slate-800/80">
                      <span className="text-slate-400 block text-[11px]">Weekday Floodlight</span>
                      <span className="font-mono font-semibold text-[#A3E635] text-sm">
                        ₹{court.pricing.weekdayEveningRate}/hr
                      </span>
                    </div>
                    <div className="bg-[#090D16] p-3 rounded-lg border border-slate-800/80">
                      <span className="text-slate-400 block text-[11px]">Weekend Day</span>
                      <span className="font-mono font-semibold text-white text-sm">
                        ₹{court.pricing.weekendMorningRate}/hr
                      </span>
                    </div>
                    <div className="bg-[#090D16] p-3 rounded-lg border border-slate-800/80">
                      <span className="text-slate-400 block text-[11px]">Weekend Floodlight</span>
                      <span className="font-mono font-semibold text-[#A3E635] text-sm">
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

      {/* 4. CUSTOMER MY BOOKINGS & GPAY VERIFICATION TRACKER */}
      <section id="my-bookings" className="max-w-7xl mx-auto px-6 scroll-mt-20">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-xs font-mono text-[#A3E635]">03. CUSTOMER BOOKING LEDGER</p>
            <h2 className="text-3xl font-display font-bold tracking-wide text-white uppercase mt-1">
              My Bookings & Live Owner Verification Status
            </h2>
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-[#0F1624] border border-slate-800 rounded-lg">
            {(['ALL', 'PENDING', 'CONFIRMED'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setMyBookingFilter(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  myBookingFilter === tab
                    ? 'bg-[#A3E635] text-slate-950 font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {tab === 'ALL'
                  ? `All Reservations (${bookings.length})`
                  : tab === 'PENDING'
                    ? 'Pending GPay Approval'
                    : 'Confirmed Slots'}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-[#0F1624] border border-slate-800 rounded-2xl overflow-hidden">
          {filteredMyBookings.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <p className="text-sm text-slate-400">
                No bookings match the selected filter yet.
              </p>
              <a
                href="#booking-engine"
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#A3E635] text-slate-950 text-xs font-semibold rounded-lg"
              >
                Book Your First Slot
              </a>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {filteredMyBookings.map((b) => (
                <div
                  key={b.id}
                  className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-[#141D2E]/50 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                      <span className="text-[#A3E635] font-semibold">{b.bookingReference}</span>
                      <span>·</span>
                      <span className="text-slate-300">{b.source === 'WALK_IN' ? 'Walk-In Counter' : 'Online GPay QR'}</span>
                      <span>·</span>
                      <span
                        className={
                          b.status === 'CONFIRMED'
                            ? 'text-emerald-400 font-semibold'
                            : b.status === 'AWAITING_OWNER_APPROVAL'
                              ? 'text-amber-300 font-semibold'
                              : 'text-slate-400'
                        }
                      >
                        {b.status === 'CONFIRMED'
                          ? 'Confirmed by Owner'
                          : b.status === 'AWAITING_OWNER_APPROVAL'
                            ? 'Awaiting Owner 1-Click Confirmation'
                            : b.status}
                      </span>
                    </div>

                    <h3 className="text-base font-semibold text-white">
                      {b.courtName} · {b.sport} ({b.bookingDate} · {b.startTime}–{b.endTime})
                    </h3>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                      <span>Player: {b.customerName}</span>
                      <span>·</span>
                      <span className="font-mono">
                        Total: ₹{b.totalAmount} | Advance: ₹{b.advanceAmount} | Balance Due at Turf: ₹{b.balanceAmount}
                      </span>
                      {b.upiReferenceUtr && (
                        <>
                          <span>·</span>
                          <span className="font-mono text-slate-300">UTR: {b.upiReferenceUtr}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {b.screenshotDataUrl && (
                      <button
                        type="button"
                        onClick={() => setPreviewScreenshotBooking(b)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#090D16] hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 rounded-lg transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#A3E635]" />
                        <span>View GPay Screenshot</span>
                      </button>
                    )}

                    {b.status === 'CONFIRMED' && (
                      <button
                        type="button"
                        onClick={() => setEntryPassBooking(b)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#A3E635]/15 hover:bg-[#A3E635]/25 border border-[#A3E635]/40 text-xs text-[#A3E635] font-medium rounded-lg transition-colors"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>Entry QR Pass</span>
                      </button>
                    )}

                    {(b.status === 'CONFIRMED' || b.status === 'AWAITING_OWNER_APPROVAL') && (
                      <button
                        type="button"
                        onClick={() => handleCancelBooking(b.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-950/30 hover:bg-red-950/60 border border-red-800/50 text-xs text-red-300 rounded-lg transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* GPAY ADVANCE QR & SCREENSHOT UPLOAD MODAL */}
      {activeHoldBooking && (
        <GpayAdvanceModal
          booking={activeHoldBooking}
          venueSettings={venueSettings}
          onClose={() => setActiveHoldBooking(null)}
          onSubmitted={async (updated) => {
            setActiveHoldBooking(null);
            setConfirmedBannerBooking(updated);
            await onRefreshState();
          }}
        />
      )}

      {/* SCREENSHOT PREVIEW MODAL */}
      {previewScreenshotBooking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="GPay payment screenshot preview"
        >
          <div className="bg-[#0F1624] border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <p className="text-xs font-mono text-[#A3E635]">
                  {previewScreenshotBooking.bookingReference} · UTR {previewScreenshotBooking.upiReferenceUtr}
                </p>
                <h3 className="text-base font-semibold text-white">
                  Uploaded GPay Advance Receipt (₹{previewScreenshotBooking.advanceAmount})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewScreenshotBooking(null)}
                className="text-xs text-slate-400 hover:text-white px-2 py-1"
              >
                Close
              </button>
            </div>
            <div className="flex justify-center bg-[#090D16] p-3 rounded-xl border border-slate-800">
              <img
                src={previewScreenshotBooking.screenshotDataUrl!}
                alt="GPay receipt"
                className="max-h-[420px] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* ENTRY QR PASS MODAL */}
      {entryPassBooking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmed Turf Entry QR Pass"
        >
          <div className="bg-[#0F1624] border border-slate-800 rounded-2xl max-w-sm w-full p-6 text-center space-y-4">
            <p className="text-xs font-mono text-[#A3E635]">
              VERIFIED TURF ENTRY PASS · {entryPassBooking.bookingReference}
            </p>
            <h3 className="text-lg font-semibold text-white">{entryPassBooking.courtName}</h3>
            <p className="text-xs font-mono text-slate-300">
              {entryPassBooking.bookingDate} · {entryPassBooking.startTime}–{entryPassBooking.endTime}
            </p>
            <div className="flex justify-center py-2">
              <QrCodeSvg
                value={`SPORTSPOT_PASS:${entryPassBooking.bookingReference}:${entryPassBooking.customerPhone}`}
                size={180}
                label={entryPassBooking.bookingReference}
              />
            </div>
            <p className="text-xs text-slate-400">
              Advance Verified: <span className="font-mono text-emerald-400">₹{entryPassBooking.paidAmount}</span> · Balance at Gate: <span className="font-mono text-white">₹{entryPassBooking.balanceAmount}</span>
            </p>
            <button
              type="button"
              onClick={() => setEntryPassBooking(null)}
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
