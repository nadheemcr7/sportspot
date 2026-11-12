import React, { useState, useEffect, useCallback } from 'react';
import {
  BookingRecord,
  CouponRecord,
  Court,
  NotificationItem,
  SlotLockRecord,
  UserAccount,
  VenueSettings,
} from './types/sportspot';
import { CustomerPortal } from './components/CustomerPortal';
import { OwnerDashboard } from './components/OwnerDashboard';
import { ArchitectureBlueprintModal } from './components/ArchitectureBlueprintModal';
import { AuthModal, AuthModalMode } from './components/AuthModal';
import { LogOut, Shield, User, LogIn } from 'lucide-react';

function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const USER_STORAGE_KEY = 'sportspot_auth_user_v1';

export default function App() {
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateString());
  const [venueSettings, setVenueSettings] = useState<VenueSettings | null>(null);
  const [courts, setCourts] = useState<Court[]>([]);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [slotLocks, setSlotLocks] = useState<Record<string, SlotLockRecord>>({});
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [_notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [supabaseConnected, setSupabaseConnected] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [showBlueprintModal, setShowBlueprintModal] = useState<boolean>(false);

  // Simple Username & Password Session
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    try {
      const saved = localStorage.getItem(USER_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as UserAccount) : null;
    } catch {
      return null;
    }
  });
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode | null>(null);

  const handleAuthenticated = (user: UserAccount) => {
    setCurrentUser(user);
    try {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } catch {
      // ignore storage errors
    }
    setAuthModalMode(null);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };

  const handleSignOut = () => {
    setCurrentUser(null);
    try {
      localStorage.removeItem(USER_STORAGE_KEY);
    } catch {
      // ignore
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };

  const fetchFullState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (res.ok) {
        const data = await res.json();
        if (data?.venueSettings) {
          setVenueSettings(data.venueSettings);
          setCourts(data.courts || []);
          setBookings(data.bookings || []);
          setSlotLocks(data.slotLocks || {});
          setCoupons(data.coupons || []);
          setNotifications(data.notifications || []);
          setSupabaseConnected(Boolean(data.supabaseConfigured));
          return;
        }
      }
    } catch (err) {
      console.warn('Initial fetch /api/state note:', err);
    } finally {
      // Graceful fallback to guarantee UI renders even if serverless API function cold-starts
      setVenueSettings((prev) => prev || {
        venueName: 'SportSpot Arena',
        address: 'Electronic City, Bengaluru',
        phone: '+91 98450 77210',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        ownerUpiId: 'sportspot.arena@okaxis',
        ownerMerchantName: 'SportSpot Arena Turf',
        advancePercentage: 30,
        holdDurationMinutes: 10,
        openingTime: '06:00',
        closingTime: '23:00',
        facilities: ['FIFA Quality Pro Turf', '400 Lux Night LED Floodlights'],
      });
      setCourts((prev) => (prev.length ? prev : [
        {
          id: 'court-1',
          name: 'Court 1 — Pro FIFA 7v7 Arena',
          sportTypes: ['Football', '7v7 Turf'],
          capacity: '7v7 (Up to 14 Players)',
          surface: 'FIFA Quality Pro 55mm Monofilament Grass',
          facilities: ['400 Lux LED Floodlights', 'Pro Goalposts'],
          imageUrl: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1200&q=85',
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
          sportTypes: ['Box Cricket', 'Football'],
          capacity: '6v6 / 8v8 Box Cricket (Up to 16 Players)',
          surface: '35mm High-Density Cricket Outfield',
          facilities: ['32ft High Roof Netting', 'LED Stumps Included'],
          imageUrl: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1200&q=85',
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
      ]));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFullState();

    // Real-time Server-Sent Events subscription (only in supported persistent environments)
    let evtSource: EventSource | null = null;
    try {
      evtSource = new EventSource('/api/events');
      evtSource.onmessage = () => {
        fetchFullState();
      };
      evtSource.onerror = () => {
        // SSE error on serverless is non-fatal; close and rely on polling/actions
        evtSource?.close();
      };
    } catch {
      // ignore
    }
    return () => {
      evtSource?.close();
    };
  }, [fetchFullState]);

  const pendingGpayCount = bookings.filter(
    (b) => b.status === 'AWAITING_OWNER_APPROVAL'
  ).length;

  if (loading || !venueSettings) {
    return (
      <div className="min-h-screen bg-[#090D16] text-slate-100 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="text-2xl font-display font-bold tracking-wider text-[#A3E635]">
            SPORTSPOT ARENA
          </div>
          <p className="text-xs font-mono text-slate-400">
            Loading Live Court Availability &amp; GPay QR Engine...
          </p>
        </div>
      </div>
    );
  }

  const isOwnerLoggedIn = currentUser?.role === 'OWNER';

  return (
    <div className="min-h-screen bg-[#090D16] text-[#F8FAFC] flex flex-col">
      {/* =====================================================================
          DEDICATED OWNER PORTAL HEADER vs. CUSTOMER WEBSITE HEADER
         ===================================================================== */}
      {isOwnerLoggedIn ? (
        <header className="sticky top-0 z-40 h-16 bg-[#090D16]/95 backdrop-blur-md border-b border-slate-800/90 px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-display text-2xl font-bold tracking-wider text-white">
              SPORT<span className="text-[#A3E635]">SPOT</span>
            </span>
            <span className="px-2.5 py-0.5 rounded-md bg-[#A3E635]/15 border border-[#A3E635]/40 text-[11px] font-mono font-semibold text-[#A3E635]">
              OWNER ADMIN CONSOLE
            </span>
          </div>

          <div className="hidden md:flex items-center gap-4 text-xs">
            <span className="font-mono text-slate-300">
              Pending GPay Proofs:{' '}
              <strong className="text-[#A3E635]">{pendingGpayCount}</strong>
            </span>
            <span className="text-slate-600">·</span>
            <span className="font-mono text-slate-400">
              DB: {supabaseConnected ? 'Supabase Live Sync' : 'Local Dev Store'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-mono text-slate-300">
              <Shield className="w-3.5 h-3.5 text-[#A3E635]" />@{currentUser.username}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition-colors"
            >
              <LogOut className="w-3.5 h-3.5 text-red-400" />
              <span>Sign Out</span>
            </button>
          </div>
        </header>
      ) : (
        <header className="sticky top-0 z-40 h-16 bg-[#090D16]/95 backdrop-blur-md border-b border-slate-800/90 px-4 sm:px-8 flex items-center justify-between gap-4">
          {/* Zone 1: Brand Identity */}
          <a
            href="#"
            className="flex items-center gap-2.5 text-left focus:outline-none shrink-0"
          >
            <span className="font-display text-2xl font-bold tracking-wider text-white">
              SPORT<span className="text-[#A3E635]">SPOT</span>
            </span>
          </a>

          {/* Zone 2: Customer Navigation Links (Zero Owner Links Shown to Customers) */}
          <nav
            aria-label="Customer Navigation"
            className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300"
          >
            <a
              href="#live-booking-engine"
              className="hover:text-[#A3E635] transition-colors whitespace-nowrap"
            >
              Book Turf
            </a>
            <a
              href="#courts-section"
              className="hover:text-[#A3E635] transition-colors whitespace-nowrap"
            >
              Courts &amp; Rates
            </a>
            <a
              href="#my-bookings-section"
              className="hover:text-[#A3E635] transition-colors whitespace-nowrap"
            >
              My Bookings
            </a>
          </nav>

          {/* Zone 3: Player Login / Account Actions */}
          <div className="flex items-center gap-2.5 shrink-0">
            {currentUser ? (
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141D2E] border border-slate-800 text-xs text-slate-200 font-mono">
                  <User className="w-3.5 h-3.5 text-[#A3E635]" />@{currentUser.username}
                </span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 hover:text-white transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAuthModalMode('PLAYER_LOGIN')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141D2E] hover:bg-slate-800 border border-slate-700 text-xs font-medium text-white transition-colors"
                >
                  <LogIn className="w-3.5 h-3.5 text-[#A3E635]" />
                  <span>Login / Sign Up</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAuthModalMode('OWNER_LOGIN')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0F1624] hover:bg-slate-800 border border-slate-800 text-xs text-slate-400 hover:text-white transition-colors"
                >
                  <Shield className="w-3.5 h-3.5 text-[#A3E635]" />
                  <span className="hidden sm:inline">Owner Login</span>
                </button>
              </div>
            )}
          </div>
        </header>
      )}

      {/* Main Content Container: Dedicated Owner Page vs. Customer Website */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {isOwnerLoggedIn ? (
          <OwnerDashboard
            venueSettings={venueSettings}
            courts={courts}
            bookings={bookings}
            slotLocks={slotLocks}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onRefreshState={fetchFullState}
            onOpenBlueprint={() => setShowBlueprintModal(true)}
          />
        ) : (
          <CustomerPortal
            venueSettings={venueSettings}
            courts={courts}
            bookings={bookings}
            slotLocks={slotLocks}
            coupons={coupons}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onBookingCreatedOrUpdated={fetchFullState}
            currentUser={currentUser}
            onOpenAuth={(mode) => setAuthModalMode(mode)}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-[#090D16] py-6 px-4 sm:px-8 text-xs text-slate-400">
        <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <span className="font-semibold text-white">{venueSettings.venueName}</span> ·{' '}
            {venueSettings.address}
          </div>
          <div className="flex items-center gap-5 font-mono">
            <span>UPI: {venueSettings.ownerUpiId}</span>
            {!isOwnerLoggedIn && (
              <button
                type="button"
                onClick={() => setAuthModalMode('OWNER_LOGIN')}
                className="text-slate-400 hover:text-[#A3E635] transition-colors"
              >
                Turf Owner Login
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* Username & Password Auth Modal */}
      {authModalMode && (
        <AuthModal
          initialMode={authModalMode}
          onClose={() => setAuthModalMode(null)}
          onAuthenticated={handleAuthenticated}
        />
      )}

      {/* Supabase Schema & GPay Flow Modal (Accessible from Owner Portal) */}
      {showBlueprintModal && (
        <ArchitectureBlueprintModal onClose={() => setShowBlueprintModal(false)} />
      )}
    </div>
  );
}
