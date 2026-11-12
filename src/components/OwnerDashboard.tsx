import React, { useState, useMemo } from 'react';
import {
  CheckCircle2,
  XCircle,
  Plus,
  Download,
  Eye,
  QrCode,
  Calendar,
  LayoutDashboard,
  ClipboardList,
  Settings,
  Wrench,
  Search,
  Wallet,
  FileCode2,
  Check,
  AlertCircle,
} from 'lucide-react';
import {
  BookingRecord,
  Court,
  SlotLockRecord,
  SportType,
  VenueSettings,
} from '../types/sportspot';
import {
  buildUpiPaymentUri,
  computeDailySlotsForCourt,
} from '../utils/bookingEngine';
import { QrCodeSvg } from './QrCodeSvg';

interface OwnerDashboardProps {
  venueSettings: VenueSettings;
  courts: Court[];
  bookings: BookingRecord[];
  slotLocks: Record<string, SlotLockRecord>;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onRefreshState: () => Promise<void>;
  onOpenBlueprint: () => void;
}

type AdminTab = 'OVERVIEW' | 'BOOKINGS' | 'SCHEDULE' | 'SETTINGS';

export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({
  venueSettings,
  courts,
  bookings,
  slotLocks,
  selectedDate,
  onSelectDate,
  onRefreshState,
  onOpenBlueprint,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('OVERVIEW');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'ONLINE' | 'WALK_IN'>('ALL');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'AWAITING_OWNER_APPROVAL' | 'CONFIRMED' | 'REJECTED'
  >('ALL');

  const [processingId, setProcessingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [inspectScreenshotBooking, setInspectScreenshotBooking] =
    useState<BookingRecord | null>(null);

  // Walk-In Modal State
  const [showWalkInModal, setShowWalkInModal] = useState<boolean>(false);
  const [walkInName, setWalkInName] = useState<string>('');
  const [walkInPhone, setWalkInPhone] = useState<string>('');
  const [walkInCourtId, setWalkInCourtId] = useState<string>(courts[0]?.id || 'court-1');
  const [walkInDuration, setWalkInDuration] = useState<number>(60);
  const [walkInStartTime, setWalkInStartTime] = useState<string>('15:00');
  const [walkInPaymentMethod, setWalkInPaymentMethod] = useState<'CASH_AT_VENUE' | 'UPI_AT_VENUE'>(
    'UPI_AT_VENUE'
  );
  const [walkInCollectFull, setWalkInCollectFull] = useState<boolean>(true);
  const [walkInError, setWalkInError] = useState<string | null>(null);
  const [walkInSubmitting, setWalkInSubmitting] = useState<boolean>(false);

  // Settings Form State
  const [venueNameInput, setVenueNameInput] = useState<string>(venueSettings.venueName);
  const [addressInput, setAddressInput] = useState<string>(venueSettings.address);
  const [phoneInput, setPhoneInput] = useState<string>(venueSettings.phone);
  const [upiIdInput, setUpiIdInput] = useState<string>(venueSettings.ownerUpiId);
  const [merchantNameInput, setMerchantNameInput] = useState<string>(
    venueSettings.ownerMerchantName
  );
  const [customQrDataUrl, setCustomQrDataUrl] = useState<string>(
    venueSettings.ownerQrCustomUrl || ''
  );
  const [advancePctInput, setAdvancePctInput] = useState<number>(venueSettings.advancePercentage);
  const [holdMinsInput, setHoldMinsInput] = useState<number>(venueSettings.holdDurationMinutes);
  const [savingSettings, setSavingSettings] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Pending GPay Screenshots Queue
  const pendingApprovalBookings = useMemo(
    () => bookings.filter((b) => b.status === 'AWAITING_OWNER_APPROVAL'),
    [bookings]
  );

  // Analytics KPIs calculated strictly from actual records
  const kpis = useMemo(() => {
    const activeConfirmed = bookings.filter((b) => b.status === 'CONFIRMED');
    const verifiedRevenue = activeConfirmed.reduce((sum, b) => sum + b.paidAmount, 0);
    const balanceCollectible = activeConfirmed.reduce((sum, b) => sum + b.balanceAmount, 0);
    const pendingAdvanceValue = pendingApprovalBookings.reduce(
      (sum, b) => sum + b.advanceAmount,
      0
    );
    const walkInCount = activeConfirmed.filter((b) => b.source === 'WALK_IN').length;
    const onlineCount = activeConfirmed.filter((b) => b.source === 'ONLINE').length;

    // Occupancy on selectedDate
    const totalDailyUnits = courts.length * 34; // 06:00 to 23:00 = 17 hrs = 34 half-hour units per court
    const lockedUnitsToday = Object.values(slotLocks).filter(
      (l) =>
        l.bookingDate === selectedDate &&
        (l.status === 'BOOKED' || l.status === 'AWAITING_OWNER_APPROVAL')
    ).length;
    const occupancyPct =
      totalDailyUnits > 0 ? Math.min(100, Math.round((lockedUnitsToday / totalDailyUnits) * 100)) : 0;

    return {
      verifiedRevenue,
      balanceCollectible,
      pendingAdvanceValue,
      confirmedCount: activeConfirmed.length,
      walkInCount,
      onlineCount,
      occupancyPct,
    };
  }, [bookings, pendingApprovalBookings, courts.length, slotLocks, selectedDate]);

  // 1-Click Owner Confirm GPay Payment & Approve Slot
  const handleOneClickConfirm = async (bookingId: string) => {
    setProcessingId(bookingId);
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/confirm-gpay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerEmail: 'owner@sportspot.in' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to confirm booking');
      await onRefreshState();
      showToast(
        `Confirmed ${data.booking.bookingReference} (${data.booking.customerName}) — Advance ₹${data.booking.advanceAmount} verified & slot locked!`
      );
    } catch (err: any) {
      showToast(err.message || 'Error confirming booking');
    } finally {
      setProcessingId(null);
    }
  };

  // 1-Click Owner Reject Invalid Screenshot & Release Slot
  const handleOneClickReject = async (bookingId: string) => {
    setProcessingId(bookingId);
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/reject-gpay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'GPay screenshot verification declined by owner. Slot released.',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reject booking');
      await onRefreshState();
      showToast(
        `Rejected ${data.booking.bookingReference} — Slot ${data.booking.startTime} is now available again.`
      );
    } catch (err: any) {
      showToast(err.message || 'Error rejecting booking');
    } finally {
      setProcessingId(null);
    }
  };

  // 1-Click Collect Remaining Venue Balance at Counter
  const handleCollectVenueBalance = async (bookingId: string) => {
    setProcessingId(bookingId);
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/collect-balance`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record balance');
      await onRefreshState();
      showToast(
        `Full balance collected for ${data.booking.bookingReference} (Total ₹${data.booking.totalAmount} Paid).`
      );
    } catch (err: any) {
      showToast(err.message || 'Error collecting balance');
    } finally {
      setProcessingId(null);
    }
  };

  // Toggle Maintenance Block on a Court Slot
  const handleToggleMaintenance = async (courtId: string, startTime: string) => {
    try {
      const res = await fetch('/api/admin/toggle-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courtId,
          bookingDate: selectedDate,
          startTime,
          durationMinutes: 60,
          reason: 'Turf Maintenance / Rolling',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Cannot block booked slot');
        return;
      }
      await onRefreshState();
      showToast(`Updated maintenance status for ${startTime} on ${selectedDate}`);
    } catch (err: any) {
      showToast(err.message || 'Failed to toggle maintenance');
    }
  };

  // Walk-In Available Slots for Modal
  const walkInCourt = useMemo(
    () => courts.find((c) => c.id === walkInCourtId) || courts[0],
    [courts, walkInCourtId]
  );

  const walkInAvailableSlots = useMemo(() => {
    if (!walkInCourt) return [];
    return computeDailySlotsForCourt({
      court: walkInCourt,
      bookingDate: selectedDate,
      durationMinutes: walkInDuration,
      openingTime: venueSettings.openingTime,
      closingTime: venueSettings.closingTime,
      advancePercentage: venueSettings.advancePercentage,
      locksByKey: slotLocks,
      nowIso: new Date().toISOString(),
    }).filter((s) => s.state === 'AVAILABLE');
  }, [walkInCourt, selectedDate, walkInDuration, venueSettings, slotLocks]);

  const handleCreateWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setWalkInError(null);
    if (!walkInName.trim() || !walkInPhone.trim()) {
      setWalkInError('Please enter walk-in customer name and phone number.');
      return;
    }

    const chosenSlot = walkInAvailableSlots.find((s) => s.startTime === walkInStartTime) || walkInAvailableSlots[0];
    if (!chosenSlot) {
      setWalkInError('No available slot for the selected court and duration.');
      return;
    }

    setWalkInSubmitting(true);
    try {
      const res = await fetch('/api/admin/bookings/walk-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: walkInName.trim(),
          customerPhone: walkInPhone.trim(),
          courtId: walkInCourt.id,
          sport: walkInCourt.sportTypes[0],
          bookingDate: selectedDate,
          startTime: chosenSlot.startTime,
          durationMinutes: walkInDuration,
          paymentMethod: walkInPaymentMethod,
          collectFullAmount: walkInCollectFull,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create walk-in booking');
      await onRefreshState();
      setShowWalkInModal(false);
      setWalkInName('');
      setWalkInPhone('');
      showToast(
        `Walk-in booking ${data.booking.bookingReference} created for ${data.booking.startTime} — Immediately blocked online!`
      );
    } catch (err: any) {
      setWalkInError(err.message || 'Failed to create walk-in booking');
    } finally {
      setWalkInSubmitting(false);
    }
  };

  const handleQrImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCustomQrDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueName: venueNameInput.trim(),
          address: addressInput.trim(),
          phone: phoneInput.trim(),
          ownerUpiId: upiIdInput.trim(),
          ownerMerchantName: merchantNameInput.trim(),
          ownerQrCustomUrl: customQrDataUrl || undefined,
          advancePercentage: Number(advancePctInput),
          holdDurationMinutes: Number(holdMinsInput),
        }),
      });
      if (res.ok) {
        await onRefreshState();
        showToast('Updated Venue Address, Contact Phone & Owner GPay QR settings.');
      }
    } finally {
      setSavingSettings(false);
    }
  };

  // Filtered Bookings for Ledger Table
  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      if (sourceFilter !== 'ALL' && b.source !== sourceFilter) return false;
      if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          b.customerName.toLowerCase().includes(q) ||
          b.customerPhone.toLowerCase().includes(q) ||
          b.bookingReference.toLowerCase().includes(q) ||
          (b.upiReferenceUtr || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [bookings, sourceFilter, statusFilter, searchQuery]);

  // CSV Export
  const handleExportCsv = () => {
    const headers = [
      'Reference',
      'Customer',
      'Phone',
      'Court',
      'Sport',
      'Date',
      'Slot',
      'Source',
      'Status',
      'PaymentStatus',
      'TotalINR',
      'AdvancePaidINR',
      'BalanceDueINR',
      'UPI_UTR',
    ];
    const rows = filteredBookings.map((b) => [
      b.bookingReference,
      `"${b.customerName}"`,
      `"${b.customerPhone}"`,
      `"${b.courtName}"`,
      b.sport,
      b.bookingDate,
      `${b.startTime}-${b.endTime}`,
      b.source,
      b.status,
      b.paymentStatus,
      b.totalAmount,
      b.paidAmount,
      b.balanceAmount,
      b.upiReferenceUtr || '',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sportspot-bookings-${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${filteredBookings.length} booking records to CSV.`);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          role="status"
          className="mb-6 flex items-center justify-between bg-emerald-950/80 border border-emerald-700 text-emerald-200 px-4 py-3 rounded-xl text-xs font-medium"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#A3E635] shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-emerald-300 hover:text-white ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Sidebar Navigation (SaaS Workspace Canvas) */}
        <aside className="lg:col-span-3 bg-[#0F1624] border border-slate-800 rounded-2xl p-4 space-y-6">
          <div className="px-2 pt-1">
            <p className="text-[11px] font-mono text-[#A3E635]">OWNER ADMIN CONSOLE</p>
            <h2 className="text-lg font-display font-bold tracking-wide text-white uppercase mt-0.5">
              {venueSettings.venueName.split('—')[0]}
            </h2>
            <p className="text-xs font-mono text-slate-400 mt-0.5">
              UPI: {venueSettings.ownerUpiId}
            </p>
          </div>

          <nav className="space-y-1" aria-label="Owner dashboard navigation">
            <button
              type="button"
              onClick={() => setActiveTab('OVERVIEW')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-colors ${
                activeTab === 'OVERVIEW'
                  ? 'bg-[#A3E635] text-slate-950 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <LayoutDashboard className="w-4 h-4" />
                <span>Overview & GPay Queue</span>
              </span>
              <span className="font-mono text-[11px]">
                ({pendingApprovalBookings.length})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('BOOKINGS')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-colors ${
                activeTab === 'BOOKINGS'
                  ? 'bg-[#A3E635] text-slate-950 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <ClipboardList className="w-4 h-4" />
                <span>All Bookings & Walk-Ins</span>
              </span>
              <span className="font-mono text-[11px]">{bookings.length}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('SCHEDULE')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-colors ${
                activeTab === 'SCHEDULE'
                  ? 'bg-[#A3E635] text-slate-950 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Calendar className="w-4 h-4" />
                <span>Live Court Schedule</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('SETTINGS')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-colors ${
                activeTab === 'SETTINGS'
                  ? 'bg-[#A3E635] text-slate-950 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Settings className="w-4 h-4" />
                <span>GPay QR & Court Pricing</span>
              </span>
            </button>
          </nav>

          <div className="pt-4 border-t border-slate-800 space-y-2.5">
            <button
              type="button"
              onClick={() => {
                if (walkInAvailableSlots[0]) {
                  setWalkInStartTime(walkInAvailableSlots[0].startTime);
                }
                setShowWalkInModal(true);
              }}
              className="w-full py-2.5 px-3 bg-[#A3E635] hover:bg-[#bef264] text-slate-950 font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>New Walk-In Booking</span>
            </button>

            <button
              type="button"
              onClick={onOpenBlueprint}
              className="w-full py-2 px-3 bg-[#090D16] hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors"
            >
              <FileCode2 className="w-3.5 h-3.5 text-[#A3E635]" />
              <span>Supabase SQL & QR Blueprint</span>
            </button>
          </div>
        </aside>

        {/* Main Content Viewport (9 Columns) */}
        <div className="lg:col-span-9 space-y-6">
          {/* Top Contextual Header */}
          <div className="bg-[#0F1624] border border-slate-800 rounded-2xl px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-mono text-slate-400">
                Owner Console / {activeTab} / {selectedDate}
              </p>
              <h1 className="text-2xl font-display font-bold tracking-wide text-white uppercase mt-0.5">
                {activeTab === 'OVERVIEW' && 'One-Click GPay Verification & Venue Overview'}
                {activeTab === 'BOOKINGS' && 'Unified Online & Walk-In Booking Ledger'}
                {activeTab === 'SCHEDULE' && 'Live Multi-Court Availability & Maintenance'}
                {activeTab === 'SETTINGS' && 'Owner GPay QR Code & Dynamic Pricing Engine'}
              </h1>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <input
                type="date"
                aria-label="Filter schedule date"
                value={selectedDate}
                onChange={(e) => onSelectDate(e.target.value)}
                className="px-3 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-xs font-mono text-white"
              />
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#141D2E] hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 rounded-lg transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          {/* 6 KPI Metric Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-[#0F1624] border border-slate-800 rounded-xl p-4">
              <span className="text-[11px] text-slate-400 block">Pending GPay Proofs</span>
              <span className="text-2xl font-mono font-bold text-amber-400 mt-1 block">
                {pendingApprovalBookings.length}
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                ₹{kpis.pendingAdvanceValue} to verify
              </span>
            </div>

            <div className="bg-[#0F1624] border border-slate-800 rounded-xl p-4">
              <span className="text-[11px] text-slate-400 block">Verified Collected</span>
              <span className="text-2xl font-mono font-bold text-[#A3E635] mt-1 block">
                ₹{kpis.verifiedRevenue}
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                Confirmed payments
              </span>
            </div>

            <div className="bg-[#0F1624] border border-slate-800 rounded-xl p-4">
              <span className="text-[11px] text-slate-400 block">Balance at Counter</span>
              <span className="text-2xl font-mono font-bold text-white mt-1 block">
                ₹{kpis.balanceCollectible}
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                Payable on arrival
              </span>
            </div>

            <div className="bg-[#0F1624] border border-slate-800 rounded-xl p-4">
              <span className="text-[11px] text-slate-400 block">Confirmed Slots</span>
              <span className="text-2xl font-mono font-bold text-white mt-1 block">
                {kpis.confirmedCount}
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                {kpis.onlineCount} Online · {kpis.walkInCount} Walk-In
              </span>
            </div>

            <div className="bg-[#0F1624] border border-slate-800 rounded-xl p-4">
              <span className="text-[11px] text-slate-400 block">Turf Occupancy</span>
              <span className="text-2xl font-mono font-bold text-white mt-1 block">
                {kpis.occupancyPct}%
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                {selectedDate}
              </span>
            </div>

            <div className="bg-[#0F1624] border border-slate-800 rounded-xl p-4">
              <span className="text-[11px] text-slate-400 block">Advance Split Rule</span>
              <span className="text-2xl font-mono font-bold text-[#A3E635] mt-1 block">
                {venueSettings.advancePercentage}%
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                Direct to Owner GPay
              </span>
            </div>
          </div>

          {/* TAB 1: OVERVIEW & 1-CLICK GPAY VERIFICATION QUEUE */}
          {activeTab === 'OVERVIEW' && (
            <div className="space-y-6">
              {/* Priority Centerpiece: 1-Click GPay Screenshot Verification Queue */}
              <div className="bg-[#0F1624] border border-slate-800 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 bg-[#141D2E] border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-mono text-amber-300">
                      ACTION REQUIRED · ZERO-GATEWAY GPAY SCREENSHOT VERIFICATION
                    </p>
                    <h2 className="text-lg font-semibold text-white">
                      Pending Customer GPay Advance Screenshots ({pendingApprovalBookings.length})
                    </h2>
                  </div>
                  <span className="text-xs text-slate-400">
                    Inspect screenshot & UTR, then click 1 button to confirm payment + lock slot
                  </span>
                </div>

                {pendingApprovalBookings.length === 0 ? (
                  <div className="p-10 text-center space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-[#A3E635] mx-auto" />
                    <p className="text-sm font-semibold text-white">
                      All GPay Advance Screenshots Are Verified!
                    </p>
                    <p className="text-xs text-slate-400">
                      New customer reservations with uploaded GPay screenshots will appear here in real time.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800">
                    {pendingApprovalBookings.map((booking) => (
                      <div
                        key={booking.id}
                        className="p-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-center"
                      >
                        {/* Screenshot Thumbnail Preview (3 cols) */}
                        <div className="md:col-span-3 flex flex-col items-center bg-[#090D16] border border-slate-800 rounded-xl p-3">
                          {booking.screenshotDataUrl ? (
                            <button
                              type="button"
                              onClick={() => setInspectScreenshotBooking(booking)}
                              className="group relative w-full flex flex-col items-center"
                            >
                              <img
                                src={booking.screenshotDataUrl}
                                alt={`GPay screenshot from ${booking.customerName}`}
                                className="h-36 object-contain rounded-lg border border-slate-700 group-hover:border-[#A3E635] transition-colors"
                              />
                              <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#A3E635] font-medium">
                                <Eye className="w-3.5 h-3.5" />
                                Inspect Full Receipt
                              </span>
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500 py-8">No image</span>
                          )}
                        </div>

                        {/* Booking & Payment Details (5 cols) */}
                        <div className="md:col-span-5 space-y-2">
                          <div className="flex items-center gap-2 text-xs font-mono">
                            <span className="text-[#A3E635] font-bold">
                              {booking.bookingReference}
                            </span>
                            <span>·</span>
                            <span className="text-amber-300">Awaiting 1-Click Approval</span>
                          </div>

                          <h3 className="text-base font-semibold text-white">
                            {booking.customerName} ({booking.customerPhone})
                          </h3>

                          <p className="text-xs text-slate-300">
                            {booking.courtName} · {booking.sport}
                          </p>
                          <p className="text-xs font-mono text-slate-200">
                            Date: {booking.bookingDate} · Slot: {booking.startTime}–{booking.endTime} ({booking.durationMinutes}m)
                          </p>

                          <div className="pt-2 grid grid-cols-3 gap-2 text-xs">
                            <div className="bg-[#090D16] p-2.5 rounded-lg border border-slate-800">
                              <span className="text-[10px] text-slate-400 block">Total Price</span>
                              <span className="font-mono font-semibold text-white">
                                ₹{booking.totalAmount}
                              </span>
                            </div>
                            <div className="bg-emerald-950/30 p-2.5 rounded-lg border border-emerald-800/60">
                              <span className="text-[10px] text-emerald-300 block">
                                GPay Advance
                              </span>
                              <span className="font-mono font-bold text-[#A3E635]">
                                ₹{booking.advanceAmount}
                              </span>
                            </div>
                            <div className="bg-[#090D16] p-2.5 rounded-lg border border-slate-800">
                              <span className="text-[10px] text-slate-400 block">
                                Venue Balance
                              </span>
                              <span className="font-mono font-semibold text-slate-200">
                                ₹{booking.balanceAmount}
                              </span>
                            </div>
                          </div>

                          <p className="text-xs font-mono text-slate-400 pt-1">
                            UPI Reference / UTR:{' '}
                            <span className="text-white font-semibold">
                              {booking.upiReferenceUtr || 'Not provided'}
                            </span>
                          </p>
                        </div>

                        {/* One-Click Confirmation Buttons (4 cols) */}
                        <div className="md:col-span-4 flex flex-col gap-2.5">
                          <button
                            type="button"
                            disabled={processingId === booking.id}
                            onClick={() => handleOneClickConfirm(booking.id)}
                            className="w-full py-3 px-4 bg-[#A3E635] hover:bg-[#bef264] text-slate-950 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors shadow-sm disabled:opacity-50"
                          >
                            <Check className="w-4 h-4 stroke-[2.5]" />
                            <span>
                              {processingId === booking.id
                                ? 'Confirming...'
                                : `Confirm ₹${booking.advanceAmount} & Approve Slot`}
                            </span>
                          </button>

                          <button
                            type="button"
                            disabled={processingId === booking.id}
                            onClick={() => handleOneClickReject(booking.id)}
                            className="w-full py-2.5 px-4 bg-red-950/40 hover:bg-red-950/70 border border-red-800/60 text-red-200 font-medium text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                            <XCircle className="w-4 h-4" />
                            <span>Reject Screenshot & Release Slot</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Live Court Schedule Snapshot on Overview */}
              <div className="bg-[#0F1624] border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-mono text-[#A3E635]">
                      LIVE SYNCHRONIZED COURT TIMELINE · {selectedDate}
                    </p>
                    <h3 className="text-base font-semibold text-white">
                      Online GPay Bookings & Walk-In Counter Occupancy
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('SCHEDULE')}
                    className="text-xs text-[#A3E635] hover:underline font-medium"
                  >
                    Manage Maintenance Blocks →
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {courts.map((court) => {
                    const slots = computeDailySlotsForCourt({
                      court,
                      bookingDate: selectedDate,
                      durationMinutes: 60,
                      openingTime: venueSettings.openingTime,
                      closingTime: venueSettings.closingTime,
                      advancePercentage: venueSettings.advancePercentage,
                      locksByKey: slotLocks,
                      nowIso: new Date().toISOString(),
                    });

                    return (
                      <div
                        key={court.id}
                        className="bg-[#090D16] border border-slate-800 rounded-xl p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                          <span className="text-sm font-semibold text-white">{court.name}</span>
                          <span className="text-xs font-mono text-slate-400">
                            {slots.filter((s) => s.state === 'AVAILABLE').length} open
                          </span>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {slots.map((slot) => {
                            let badgeStyle =
                              'bg-emerald-950/30 border-emerald-800/60 text-emerald-300';
                            let statusShort = 'Open';
                            if (slot.state === 'AWAITING_OWNER_APPROVAL') {
                              badgeStyle = 'bg-amber-950/40 border-amber-700 text-amber-300';
                              statusShort = 'Verify GPay';
                            } else if (slot.state === 'BOOKED_ONLINE') {
                              badgeStyle = 'bg-sky-950/40 border-sky-800 text-sky-300';
                              statusShort = 'Online';
                            } else if (slot.state === 'BOOKED_WALK_IN') {
                              badgeStyle = 'bg-purple-950/40 border-purple-800 text-purple-300';
                              statusShort = 'Walk-In';
                            } else if (slot.state === 'BLOCKED') {
                              badgeStyle = 'bg-slate-900 border-slate-800 text-slate-500';
                              statusShort = 'Blocked';
                            }
                            return (
                              <div
                                key={slot.startTime}
                                className={`p-2 rounded-lg border text-xs ${badgeStyle}`}
                              >
                                <div className="font-mono font-semibold">{slot.startTime}</div>
                                <div className="text-[10px] truncate mt-0.5">
                                  {slot.customerName || statusShort}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ALL BOOKINGS & WALK-IN COUNTER TABLE */}
          {activeTab === 'BOOKINGS' && (
            <div className="bg-[#0F1624] border border-slate-800 rounded-2xl overflow-hidden">
              <div className="p-4 bg-[#141D2E] border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search customer, phone, booking ref (SS-8491), or UTR..."
                    className="w-full pl-9 pr-4 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-[#A3E635]"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex p-1 bg-[#090D16] border border-slate-800 rounded-lg">
                    {(['ALL', 'ONLINE', 'WALK_IN'] as const).map((src) => (
                      <button
                        key={src}
                        type="button"
                        onClick={() => setSourceFilter(src)}
                        className={`px-2.5 py-1 text-xs rounded-md ${
                          sourceFilter === src
                            ? 'bg-[#A3E635] text-slate-950 font-semibold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {src === 'ALL' ? 'All Sources' : src === 'ONLINE' ? 'Online GPay' : 'Walk-In'}
                      </button>
                    ))}
                  </div>

                  <div className="inline-flex p-1 bg-[#090D16] border border-slate-800 rounded-lg">
                    {(['ALL', 'AWAITING_OWNER_APPROVAL', 'CONFIRMED', 'REJECTED'] as const).map(
                      (st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setStatusFilter(st)}
                          className={`px-2.5 py-1 text-xs rounded-md ${
                            statusFilter === st
                              ? 'bg-[#A3E635] text-slate-950 font-semibold'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {st === 'ALL'
                            ? 'All Status'
                            : st === 'AWAITING_OWNER_APPROVAL'
                              ? 'Pending GPay'
                              : st}
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] font-mono text-slate-400 bg-[#090D16]/60">
                      <th className="py-3 px-4">Ref & Source</th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Court & Slot</th>
                      <th className="py-3 px-4 text-right">Total / Paid / Balance</th>
                      <th className="py-3 px-4">GPay Proof & Status</th>
                      <th className="py-3 px-4 text-right">One-Click Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-xs">
                    {filteredBookings.map((b) => (
                      <tr key={b.id} className="hover:bg-[#141D2E]/40">
                        <td className="py-3.5 px-4 font-mono">
                          <div className="font-semibold text-[#A3E635]">{b.bookingReference}</div>
                          <div className="text-[11px] text-slate-400">{b.source}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-white">{b.customerName}</div>
                          <div className="font-mono text-[11px] text-slate-400">
                            {b.customerPhone}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="text-slate-200">{b.courtName.split('—')[0]}</div>
                          <div className="font-mono text-[11px] text-slate-400">
                            {b.bookingDate} · {b.startTime}–{b.endTime}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono">
                          <div className="text-white font-semibold">Total: ₹{b.totalAmount}</div>
                          <div className="text-[11px] text-[#A3E635]">Paid: ₹{b.paidAmount}</div>
                          <div className="text-[11px] text-slate-400">Due: ₹{b.balanceAmount}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div
                            className={`font-semibold ${
                              b.status === 'CONFIRMED'
                                ? 'text-emerald-400'
                                : b.status === 'AWAITING_OWNER_APPROVAL'
                                  ? 'text-amber-300'
                                  : 'text-slate-400'
                            }`}
                          >
                            {b.status === 'AWAITING_OWNER_APPROVAL'
                              ? 'Pending Owner Confirm'
                              : b.status}
                          </div>
                          {b.upiReferenceUtr && (
                            <div className="font-mono text-[11px] text-slate-400">
                              UTR: {b.upiReferenceUtr}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="inline-flex items-center justify-end gap-2">
                            {b.screenshotDataUrl && (
                              <button
                                type="button"
                                onClick={() => setInspectScreenshotBooking(b)}
                                className="px-2.5 py-1.5 bg-[#090D16] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-[11px]"
                              >
                                Screenshot
                              </button>
                            )}
                            {b.status === 'AWAITING_OWNER_APPROVAL' && (
                              <button
                                type="button"
                                onClick={() => handleOneClickConfirm(b.id)}
                                className="px-3 py-1.5 bg-[#A3E635] hover:bg-[#bef264] text-slate-950 font-semibold rounded-lg text-[11px]"
                              >
                                Confirm Slot
                              </button>
                            )}
                            {b.status === 'CONFIRMED' && b.balanceAmount > 0 && (
                              <button
                                type="button"
                                onClick={() => handleCollectVenueBalance(b.id)}
                                className="px-2.5 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-700 text-emerald-200 rounded-lg text-[11px] font-mono"
                              >
                                Collect ₹{b.balanceAmount}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: LIVE SCHEDULE & MAINTENANCE BLOCKING */}
          {activeTab === 'SCHEDULE' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {courts.map((court) => {
                const slots = computeDailySlotsForCourt({
                  court,
                  bookingDate: selectedDate,
                  durationMinutes: 60,
                  openingTime: venueSettings.openingTime,
                  closingTime: venueSettings.closingTime,
                  advancePercentage: venueSettings.advancePercentage,
                  locksByKey: slotLocks,
                  nowIso: new Date().toISOString(),
                });

                return (
                  <div
                    key={court.id}
                    className="bg-[#0F1624] border border-slate-800 rounded-2xl p-5 space-y-4"
                  >
                    <div>
                      <p className="text-xs font-mono text-[#A3E635]">{court.capacity}</p>
                      <h3 className="text-lg font-semibold text-white">{court.name}</h3>
                    </div>

                    <div className="divide-y divide-slate-800/80">
                      {slots.map((slot) => (
                        <div
                          key={slot.startTime}
                          className="py-2.5 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="font-mono font-semibold text-slate-200">
                            {slot.startTime} – {slot.endTime}
                          </div>

                          <div className="flex-1 px-3 truncate">
                            {slot.state === 'AVAILABLE' && (
                              <span className="text-emerald-400">
                                Available (₹{slot.priceBreakdown.totalAmount})
                              </span>
                            )}
                            {slot.state === 'AWAITING_OWNER_APPROVAL' && (
                              <span className="text-amber-300">
                                GPay Proof Uploaded · {slot.customerName}
                              </span>
                            )}
                            {slot.state === 'BOOKED_ONLINE' && (
                              <span className="text-sky-300">
                                Confirmed Online · {slot.customerName}
                              </span>
                            )}
                            {slot.state === 'BOOKED_WALK_IN' && (
                              <span className="text-purple-300">
                                Walk-In Counter · {slot.customerName}
                              </span>
                            )}
                            {slot.state === 'BLOCKED' && (
                              <span className="text-slate-500">
                                Blocked ({slot.blockReason || 'Maintenance'})
                              </span>
                            )}
                          </div>

                          <div>
                            {(slot.state === 'AVAILABLE' || slot.state === 'BLOCKED') && (
                              <button
                                type="button"
                                onClick={() => handleToggleMaintenance(court.id, slot.startTime)}
                                className="px-2.5 py-1 bg-[#090D16] hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-300 rounded-md"
                              >
                                {slot.state === 'BLOCKED' ? 'Unblock Slot' : 'Block Maintenance'}
                              </button>
                            )}
                            {slot.state === 'AWAITING_OWNER_APPROVAL' && slot.bookingId && (
                              <button
                                type="button"
                                onClick={() => handleOneClickConfirm(slot.bookingId!)}
                                className="px-2.5 py-1 bg-[#A3E635] text-slate-950 font-semibold text-[11px] rounded-md"
                              >
                                1-Click Confirm
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 4: OWNER GPAY QR & COURT PRICING SETTINGS */}
          {activeTab === 'SETTINGS' && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              <form
                onSubmit={handleSaveSettings}
                className="md:col-span-7 bg-[#0F1624] border border-slate-800 rounded-2xl p-6 space-y-4"
              >
                <div>
                  <p className="text-xs font-mono text-[#A3E635]">
                    VENUE CONTACT & ZERO-GATEWAY GPAY QR CONFIGURATION
                  </p>
                  <h3 className="text-lg font-semibold text-white">
                    Turf Address, Mobile Number & Owner Google Pay UPI
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="venue-name-input"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Arena / Turf Display Name
                    </label>
                    <input
                      id="venue-name-input"
                      type="text"
                      value={venueNameInput}
                      onChange={(e) => setVenueNameInput(e.target.value)}
                      className="w-full px-3.5 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-sm text-white"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="venue-phone-input"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Turf Contact Mobile Number
                    </label>
                    <input
                      id="venue-phone-input"
                      type="text"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      placeholder="+91 98450 77210"
                      className="w-full px-3.5 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-sm font-mono text-white"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="venue-address-input"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Full Turf Venue Address (Displayed in Hero & Footer)
                  </label>
                  <input
                    id="venue-address-input"
                    type="text"
                    value={addressInput}
                    onChange={(e) => setAddressInput(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-sm text-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor="owner-upi-id"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Owner Google Pay / UPI ID
                  </label>
                  <input
                    id="owner-upi-id"
                    type="text"
                    value={upiIdInput}
                    onChange={(e) => setUpiIdInput(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-sm font-mono text-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor="owner-merchant-name"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Payee / Turf Business Name on GPay
                  </label>
                  <input
                    id="owner-merchant-name"
                    type="text"
                    value={merchantNameInput}
                    onChange={(e) => setMerchantNameInput(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-sm text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="advance-pct"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Advance Payment Percentage (%)
                    </label>
                    <input
                      id="advance-pct"
                      type="number"
                      min={10}
                      max={100}
                      value={advancePctInput}
                      onChange={(e) => setAdvancePctInput(Number(e.target.value))}
                      className="w-full px-3.5 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-sm font-mono text-white"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="hold-mins"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Slot Hold Timer (Minutes)
                    </label>
                    <input
                      id="hold-mins"
                      type="number"
                      min={5}
                      max={30}
                      value={holdMinsInput}
                      onChange={(e) => setHoldMinsInput(Number(e.target.value))}
                      className="w-full px-3.5 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-sm font-mono text-white"
                    />
                  </div>
                </div>

                {/* Optional Custom GPay QR Image Upload */}
                <div className="pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="owner-custom-qr-upload"
                      className="block text-xs font-medium text-slate-300"
                    >
                      Upload Your Own GPay QR Image (Optional)
                    </label>
                    {customQrDataUrl && (
                      <button
                        type="button"
                        onClick={() => setCustomQrDataUrl('')}
                        className="text-xs text-red-400 hover:underline"
                      >
                        Reset to Dynamic Auto-QR
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mb-2">
                    By default, SportSpot auto-generates a UPI QR from your UPI ID above with the exact advance amount pre-filled. Or upload your own GPay QR image here:
                  </p>
                  <input
                    id="owner-custom-qr-upload"
                    type="file"
                    accept="image/*"
                    onChange={handleQrImageUpload}
                    className="block w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-[#A3E635] hover:file:bg-slate-700 cursor-pointer"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="px-5 py-2.5 bg-[#A3E635] hover:bg-[#bef264] text-slate-950 font-semibold text-xs rounded-lg transition-colors"
                >
                  {savingSettings ? 'Saving...' : 'Save Owner GPay QR Settings'}
                </button>
              </form>

              <div className="md:col-span-5 bg-[#0F1624] border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center text-center space-y-3">
                <p className="text-xs font-mono text-[#A3E635]">
                  {customQrDataUrl ? 'CUSTOM UPLOADED GPAY QR' : 'LIVE DYNAMIC UPI QR PREVIEW'}
                </p>
                <p className="text-sm font-semibold text-white">{merchantNameInput}</p>
                {customQrDataUrl ? (
                  <img
                    src={customQrDataUrl}
                    alt="Uploaded Owner GPay QR Code"
                    className="w-44 h-44 object-contain bg-white p-2 rounded-xl border border-slate-700"
                  />
                ) : (
                  <QrCodeSvg
                    value={buildUpiPaymentUri({
                      upiId: upiIdInput,
                      merchantName: merchantNameInput,
                      amount: 420,
                      bookingReference: 'SS-DEMO',
                    })}
                    size={172}
                    label={upiIdInput}
                  />
                )}
                <p className="text-xs text-slate-400">
                  Customers scan this QR during checkout to pay their {advancePctInput}% advance
                  directly into your bank account.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* WALK-IN BOOKING MODAL */}
      {showWalkInModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="walkin-modal-title"
        >
          <form
            onSubmit={handleCreateWalkIn}
            className="bg-[#0F1624] border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <p className="text-xs font-mono text-[#A3E635]">
                  COUNTER DESK RESERVATION · INSTANT ONLINE SYNC
                </p>
                <h3 id="walkin-modal-title" className="text-lg font-semibold text-white">
                  New Walk-In Turf Booking ({selectedDate})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowWalkInModal(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="walkin-name" className="block text-xs text-slate-300 mb-1">
                  Walk-In Customer Name *
                </label>
                <input
                  id="walkin-name"
                  type="text"
                  required
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  placeholder="e.g. Arjun Shetty"
                  className="w-full px-3 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-xs text-white"
                />
              </div>
              <div>
                <label htmlFor="walkin-phone" className="block text-xs text-slate-300 mb-1">
                  Mobile Number *
                </label>
                <input
                  id="walkin-phone"
                  type="tel"
                  required
                  value={walkInPhone}
                  onChange={(e) => setWalkInPhone(e.target.value)}
                  placeholder="+91 98450 12345"
                  className="w-full px-3 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-xs font-mono text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="walkin-court" className="block text-xs text-slate-300 mb-1">
                  Select Court
                </label>
                <select
                  id="walkin-court"
                  value={walkInCourtId}
                  onChange={(e) => setWalkInCourtId(e.target.value)}
                  className="w-full px-3 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-xs text-white"
                >
                  {courts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="walkin-slot" className="block text-xs text-slate-300 mb-1">
                  Available Time Slot ({selectedDate})
                </label>
                <select
                  id="walkin-slot"
                  value={walkInStartTime}
                  onChange={(e) => setWalkInStartTime(e.target.value)}
                  className="w-full px-3 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-xs font-mono text-white"
                >
                  {walkInAvailableSlots.map((s) => (
                    <option key={s.startTime} value={s.startTime}>
                      {s.startTime} – {s.endTime} (₹{s.priceBreakdown.totalAmount})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="block text-xs text-slate-300 mb-1">Payment Mode at Counter</span>
                <select
                  aria-label="Walk-in payment mode"
                  value={walkInPaymentMethod}
                  onChange={(e) =>
                    setWalkInPaymentMethod(e.target.value as 'CASH_AT_VENUE' | 'UPI_AT_VENUE')
                  }
                  className="w-full px-3 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-xs text-white"
                >
                  <option value="UPI_AT_VENUE">GPay / UPI at Counter</option>
                  <option value="CASH_AT_VENUE">Cash at Counter</option>
                </select>
              </div>

              <div>
                <span className="block text-xs text-slate-300 mb-1">Amount Collected</span>
                <select
                  aria-label="Walk-in amount collected"
                  value={walkInCollectFull ? 'FULL' : 'ADVANCE'}
                  onChange={(e) => setWalkInCollectFull(e.target.value === 'FULL')}
                  className="w-full px-3 py-2 bg-[#090D16] border border-slate-700 rounded-lg text-xs text-white"
                >
                  <option value="FULL">100% Full Amount Paid</option>
                  <option value="ADVANCE">{venueSettings.advancePercentage}% Advance Paid</option>
                </select>
              </div>
            </div>

            {walkInError && (
              <div className="text-xs text-red-300 bg-red-950/50 border border-red-800 rounded-lg p-2.5">
                {walkInError}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowWalkInModal(false)}
                className="px-4 py-2 text-xs text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={walkInSubmitting}
                className="px-5 py-2.5 bg-[#A3E635] hover:bg-[#bef264] text-slate-950 font-semibold text-xs rounded-lg"
              >
                {walkInSubmitting ? 'Booking...' : 'Confirm Walk-In & Lock Slot'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* INSPECT GPAY SCREENSHOT MODAL */}
      {inspectScreenshotBooking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Inspect customer GPay receipt screenshot"
        >
          <div className="bg-[#0F1624] border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <p className="text-xs font-mono text-[#A3E635]">
                  {inspectScreenshotBooking.bookingReference} · UTR {inspectScreenshotBooking.upiReferenceUtr}
                </p>
                <h3 className="text-base font-semibold text-white">
                  {inspectScreenshotBooking.customerName} — ₹{inspectScreenshotBooking.advanceAmount} Advance
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectScreenshotBooking(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="flex justify-center bg-[#090D16] p-3 rounded-xl border border-slate-800">
              <img
                src={inspectScreenshotBooking.screenshotDataUrl!}
                alt="Customer GPay screenshot"
                className="max-h-[400px] object-contain rounded-lg"
              />
            </div>

            {inspectScreenshotBooking.status === 'AWAITING_OWNER_APPROVAL' && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    const id = inspectScreenshotBooking.id;
                    setInspectScreenshotBooking(null);
                    await handleOneClickConfirm(id);
                  }}
                  className="flex-1 py-2.5 bg-[#A3E635] hover:bg-[#bef264] text-slate-950 font-semibold text-xs rounded-lg"
                >
                  Confirm Payment & Approve Slot
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const id = inspectScreenshotBooking.id;
                    setInspectScreenshotBooking(null);
                    await handleOneClickReject(id);
                  }}
                  className="py-2.5 px-4 bg-red-950/50 border border-red-800 text-red-200 text-xs rounded-lg"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
