import React, { useState, useEffect, useCallback } from 'react';
import {
  BookingRecord,
  CouponRecord,
  Court,
  NotificationItem,
  SlotLockRecord,
  VenueSettings,
} from './types/sportspot';
import { CustomerPortal } from './components/CustomerPortal';
import { OwnerDashboard } from './components/OwnerDashboard';
import { ArchitectureBlueprintModal } from './components/ArchitectureBlueprintModal';

function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function App() {
  const [activeView, setActiveView] = useState<'CUSTOMER' | 'OWNER'>('CUSTOMER');
  const [showBlueprintModal, setShowBlueprintModal] = useState<boolean>(false);
  const [selectedDate, setSelectedDate] = useState<string>(getTodayIsoDate());
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [activeView]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [activeView]);

  const [venueSettings, setVenueSettings] = useState<VenueSettings>({
    venueName: 'SportSpot Arena — Electronic City Phase I',
    address: 'Plot 42, Velankani Tech Park Road, Electronic City, Bengaluru 560100',
    phone: '+91 98450 77210',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    ownerUpiId: 'sportspot.arena@okaxis',
    ownerMerchantName: 'SportSpot Arena Turf',
    advancePercentage: 30,
    holdDurationMinutes: 10,
    openingTime: '06:00',
    closingTime: '23:00',
    facilities: [],
  });

  const [courts, setCourts] = useState<Court[]>([]);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [slotLocks, setSlotLocks] = useState<Record<string, SlotLockRecord>>({});
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [, setNotifications] = useState<NotificationItem[]>([]);

  const fetchServerState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) return;
      const data = await res.json();
      if (data.venueSettings) setVenueSettings(data.venueSettings);
      if (Array.isArray(data.courts)) setCourts(data.courts);
      if (Array.isArray(data.bookings)) setBookings(data.bookings);
      if (data.slotLocks) setSlotLocks(data.slotLocks);
      if (Array.isArray(data.coupons)) setCoupons(data.coupons);
      if (Array.isArray(data.notifications)) setNotifications(data.notifications);
    } catch (err) {
      console.error('Failed to load SportSpot state:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServerState();

    // Real-time Server-Sent Events subscription
    const eventSource = new EventSource('/api/events');
    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed && parsed.type && parsed.type !== 'CONNECTED') {
          fetchServerState();
        }
      } catch {
        // ignore malformed keepalive
      }
    };

    return () => {
      eventSource.close();
    };
  }, [fetchServerState]);

  const pendingGpayCount = bookings.filter(
    (b) => b.status === 'AWAITING_OWNER_APPROVAL'
  ).length;

  return (
    <div className="min-h-screen flex flex-col bg-[#090D16] text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-8 px-6 py-4 bg-[#090D16]/95 backdrop-blur-md border-b border-slate-800/90">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('CUSTOMER');
          }}
          className="text-2xl font-display font-bold uppercase tracking-wider text-white whitespace-nowrap shrink-0"
        >
          SportSpot
        </a>

        {/* Zone 2: 5 concise single-line navigation links */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300"
        >
          <a
            href="#booking-engine"
            onClick={() => setActiveView('CUSTOMER')}
            className="hover:text-[#A3E635] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Book Turf
          </a>
          <a
            href="#courts-pricing"
            onClick={() => setActiveView('CUSTOMER')}
            className="hover:text-[#A3E635] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Courts & Rates
          </a>
          <a
            href="#my-bookings"
            onClick={() => setActiveView('CUSTOMER')}
            className="hover:text-[#A3E635] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            My Bookings
          </a>
          <button
            type="button"
            onClick={() => setShowBlueprintModal(true)}
            className="hover:text-[#A3E635] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Supabase & QR Flow
          </button>
          <button
            type="button"
            onClick={() => setActiveView('OWNER')}
            className={`hover:text-[#A3E635] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'OWNER' ? 'text-[#A3E635] underline' : ''
            }`}
          >
            Owner Portal
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          {activeView === 'CUSTOMER' ? (
            <button
              type="button"
              onClick={() => setActiveView('OWNER')}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-[#A3E635] hover:bg-[#bef264] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Verify GPay Screenshots ({pendingGpayCount})
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setActiveView('CUSTOMER')}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Switch to Customer Booking
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main id="top" className="flex-1">
        {loading && courts.length === 0 ? (
          <div className="max-w-7xl mx-auto px-6 py-16 space-y-6">
            <div className="h-64 bg-[#0F1624] border border-slate-800 rounded-2xl animate-pulse" />
            <div className="h-96 bg-[#0F1624] border border-slate-800 rounded-2xl animate-pulse" />
          </div>
        ) : activeView === 'CUSTOMER' ? (
          <CustomerPortal
            venueSettings={venueSettings}
            courts={courts}
            bookings={bookings}
            slotLocks={slotLocks}
            coupons={coupons}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onRefreshState={fetchServerState}
            onOpenBlueprint={() => setShowBlueprintModal(true)}
            onSwitchToOwner={() => setActiveView('OWNER')}
          />
        ) : (
          <OwnerDashboard
            venueSettings={venueSettings}
            courts={courts}
            bookings={bookings}
            slotLocks={slotLocks}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onRefreshState={fetchServerState}
            onOpenBlueprint={() => setShowBlueprintModal(true)}
          />
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-800/80 bg-[#090D16] py-8 px-6 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-400">
          <div>
            <span className="font-display font-bold text-white uppercase tracking-wide text-sm">
              SportSpot
            </span>
            <span className="mx-2">·</span>
            <span>{venueSettings.venueName}</span>
            <span className="mx-2">·</span>
            <span>{venueSettings.address}</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setShowBlueprintModal(true)}
              className="hover:text-white underline-offset-4 hover:underline"
            >
              Supabase SQL Schema
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() =>
                setActiveView(activeView === 'CUSTOMER' ? 'OWNER' : 'CUSTOMER')
              }
              className="hover:text-white underline-offset-4 hover:underline"
            >
              {activeView === 'CUSTOMER' ? 'Owner Admin Login' : 'Public Booking Page'}
            </button>
          </div>
        </div>
      </footer>

      {/* Architecture & Supabase SQL Modal */}
      {showBlueprintModal && (
        <ArchitectureBlueprintModal onClose={() => setShowBlueprintModal(false)} />
      )}
    </div>
  );
}
