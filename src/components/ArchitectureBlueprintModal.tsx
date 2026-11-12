import React, { useState } from 'react';
import {
  Check,
  Copy,
  Database,
  FileCode2,
  QrCode,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { SUPABASE_GPAY_WORKFLOW_STEPS } from '../lib/supabase';

interface ArchitectureBlueprintModalProps {
  onClose: () => void;
}

const SUPABASE_SQL_SNIPPET = `-- SportSpot Supabase Schema + Atomic 1-Click GPay Approval RPC
create table public.bookings (
  id text primary key,
  booking_reference text not null unique,
  customer_name text not null,
  customer_phone text not null,
  court_id text not null references public.courts(id),
  booking_date date not null,
  start_time text not null,
  end_time text not null,
  duration_minutes integer not null,
  unit_keys text[] not null, -- e.g. {'court-1__2026-11-12__18:00', 'court-1__2026-11-12__18:30'}
  source text not null check (source in ('ONLINE', 'WALK_IN')),
  status text not null check (status in ('HOLD', 'AWAITING_OWNER_APPROVAL', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
  payment_status text not null check (payment_status in ('UNPAID_HOLD', 'SCREENSHOT_UPLOADED', 'ADVANCE_VERIFIED', 'FULLY_PAID', 'REJECTED')),
  total_amount integer not null,
  advance_amount integer not null,
  paid_amount integer not null default 0,
  balance_amount integer not null,
  upi_reference_utr text,
  screenshot_url text,
  owner_verified_at timestamptz,
  hold_expires_at timestamptz
);

-- One-Click Owner Confirmation Function (Runs inside a single Postgres transaction)
create or replace function public.owner_confirm_gpay_booking(p_booking_id text, p_owner_email text)
returns public.bookings language plpgsql security definer as $$
declare v_booking public.bookings;
begin
  update public.bookings
  set status = 'CONFIRMED',
      payment_status = case when advance_amount >= total_amount then 'FULLY_PAID' else 'ADVANCE_VERIFIED' end,
      paid_amount = advance_amount,
      balance_amount = greatest(0, total_amount - advance_amount),
      owner_verified_at = now(),
      owner_verified_by = p_owner_email,
      hold_expires_at = null
  where id = p_booking_id
  returning * into v_booking;

  update public.slot_locks
  set status = 'BOOKED', hold_expires_at = null
  where booking_id = p_booking_id;

  return v_booking;
end;
$$;`;

export const ArchitectureBlueprintModal: React.FC<ArchitectureBlueprintModalProps> = ({
  onClose,
}) => {
  const [copiedSql, setCopiedSql] = useState(false);

  const handleCopySql = () => {
    navigator.clipboard?.writeText(SUPABASE_SQL_SNIPPET);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="blueprint-modal-title"
    >
      <div className="w-full max-w-5xl bg-[#0F1624] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-6">
        <div className="flex items-center justify-between px-6 py-4 bg-[#141D2E] border-b border-slate-800">
          <div>
            <p className="text-xs font-mono text-[#A3E635]">
              DETAILED SYSTEM ARCHITECTURE · SUPABASE + ZERO-GATEWAY GPAY QR WORKFLOW
            </p>
            <h2
              id="blueprint-modal-title"
              className="text-2xl font-display font-bold tracking-wide text-white"
            >
              How SportSpot’s Custom GPay QR & One-Click Owner Approval Works
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close architecture guide"
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* 4-Step End-to-End Flow */}
          <div>
            <h3 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
              <QrCode className="w-4 h-4 text-[#A3E635]" />
              End-to-End GPay Advance & Screenshot Verification Lifecycle
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {SUPABASE_GPAY_WORKFLOW_STEPS.map((item) => (
                <div
                  key={item.step}
                  className="bg-[#090D16] border border-slate-800/90 rounded-xl p-4"
                >
                  <p className="text-xs font-mono text-[#A3E635]">{item.step}</p>
                  <p className="text-sm font-semibold text-white mt-1">{item.title}</p>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Edge Cases & Double-Booking Safeguards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#090D16] border border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span>Zero Double-Booking Guarantee</span>
              </div>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Every slot is split into deterministic 30-minute keys{' '}
                <code className="font-mono text-slate-200">courtId__date__HH:MM</code>. Whether
                booked online via GPay or added as a counter Walk-In, the server locks those exact
                keys in a single transaction.
              </p>
            </div>

            <div className="bg-[#090D16] border border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Sparkles className="w-4 h-4 text-[#A3E635]" />
                <span>Advance Now + Balance at Venue</span>
              </div>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Customers pay a configurable advance (default 30%, e.g. ₹420 on a ₹1,400 floodlight
                slot) directly to the Owner’s GPay QR. When they arrive to play, the owner clicks{' '}
                <strong className="text-slate-200">Collect Balance (₹980)</strong> in 1 click.
              </p>
            </div>

            <div className="bg-[#090D16] border border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Database className="w-4 h-4 text-sky-400" />
                <span>Fake Screenshot Protection</span>
              </div>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Slots with uploaded screenshots stay in{' '}
                <code className="font-mono text-amber-300">AWAITING_OWNER_APPROVAL</code>. The owner
                sees the 12-digit UTR and receipt image side-by-side. Clicking{' '}
                <strong className="text-slate-200">Reject & Release</strong> frees the slot
                instantly.
              </p>
            </div>
          </div>

          {/* Supabase SQL & RPC Block */}
          <div className="bg-[#090D16] border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-[#141D2E] border-b border-slate-800">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-200">
                <FileCode2 className="w-4 h-4 text-[#A3E635]" />
                <span>supabase/schema.sql — Tables & One-Click Confirmation RPC</span>
              </div>
              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white rounded-md transition-colors"
              >
                {copiedSql ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#A3E635]" />
                    Copied SQL
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy Supabase SQL
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
              {SUPABASE_SQL_SNIPPET}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
