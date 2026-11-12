import React, { useState, useEffect } from 'react';
import {
  Copy,
  Upload,
  Clock,
  FileCheck2,
  X,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';
import { BookingRecord, VenueSettings } from '../types/sportspot';
import { buildUpiPaymentUri } from '../utils/bookingEngine';
import { QrCodeSvg } from './QrCodeSvg';

interface GpayAdvanceModalProps {
  booking: BookingRecord;
  venueSettings: VenueSettings;
  onClose: () => void;
  onSubmitted: (updatedBooking: BookingRecord) => void;
}

export const GpayAdvanceModal: React.FC<GpayAdvanceModalProps> = ({
  booking,
  venueSettings,
  onClose,
  onSubmitted,
}) => {
  const [upiUtr, setUpiUtr] = useState(booking.upiReferenceUtr || '');
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(
    booking.screenshotDataUrl || null
  );
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(600);

  useEffect(() => {
    if (!booking.holdExpiresAt) return;
    const updateTimer = () => {
      const diff = Math.max(
        0,
        Math.floor((new Date(booking.holdExpiresAt!).getTime() - Date.now()) / 1000)
      );
      setRemainingSeconds(diff);
    };
    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [booking.holdExpiresAt]);

  const upiUri = buildUpiPaymentUri({
    upiId: venueSettings.ownerUpiId,
    merchantName: venueSettings.ownerMerchantName,
    amount: booking.advanceAmount,
    bookingReference: booking.bookingReference,
  });

  const handleCopyUpi = () => {
    navigator.clipboard?.writeText(venueSettings.ownerUpiId);
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 2000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setScreenshotDataUrl(reader.result);
        setErrorMsg(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!screenshotDataUrl) {
      setErrorMsg('Please upload your Google Pay payment screenshot to lock your turf slot.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const response = await fetch(`/api/bookings/${booking.id}/upload-screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenshotDataUrl,
          upiReferenceUtr: upiUtr.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload screenshot');
      }
      onSubmitted(data.booking);
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not submit payment screenshot.');
    } finally {
      setSubmitting(false);
    }
  };

  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gpay-modal-title"
    >
      <div className="relative w-full max-w-3xl bg-[#0F1624] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-6">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#141D2E] border-b border-slate-800">
          <div>
            <p className="text-xs font-mono text-[#A3E635]">
              SLOT TEMPORARILY HELD · REF {booking.bookingReference}
            </p>
            <h2
              id="gpay-modal-title"
              className="text-xl font-display font-bold tracking-wide text-white"
            >
              Pay Advance via Owner’s GPay QR & Upload Screenshot
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-xs font-mono text-amber-300 bg-amber-950/50 border border-amber-800/60 px-3 py-1.5 rounded-lg">
              <Clock className="w-3.5 h-3.5" />
              <span>
                Hold expires in {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close GPay advance payment modal"
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body Grid */}
        <form onSubmit={handleSubmitProof} className="grid grid-cols-1 md:grid-cols-12 gap-6 p-6">
          {/* Left Column: Owner GPay QR & Advance Breakdown */}
          <div className="md:col-span-5 flex flex-col items-center justify-between bg-[#090D16] border border-slate-800/90 rounded-xl p-5">
            <div className="w-full text-center">
              <p className="text-xs text-slate-400">Scan with Google Pay, PhonePe, or Paytm</p>
              <p className="text-sm font-semibold text-white mt-0.5">
                {venueSettings.ownerMerchantName}
              </p>

              <div className="my-4 flex justify-center">
                {venueSettings.ownerQrCustomUrl ? (
                  <img
                    src={venueSettings.ownerQrCustomUrl}
                    alt="Owner GPay QR Code"
                    referrerPolicy="no-referrer"
                    className="w-48 h-48 object-contain bg-white p-2 rounded-xl"
                  />
                ) : (
                  <QrCodeSvg
                    value={upiUri}
                    size={184}
                    label={`Advance: ₹${booking.advanceAmount}`}
                  />
                )}
              </div>

              <div className="flex items-center justify-between gap-2 bg-[#141D2E] border border-slate-800 px-3 py-2 rounded-lg text-xs">
                <span className="font-mono text-slate-300 truncate">{venueSettings.ownerUpiId}</span>
                <button
                  type="button"
                  onClick={handleCopyUpi}
                  className="inline-flex items-center gap-1 text-[#A3E635] hover:underline font-medium shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedUpi ? 'Copied' : 'Copy UPI'}
                </button>
              </div>
            </div>

            {/* Advance vs Venue Balance Math */}
            <div className="w-full mt-5 pt-4 border-t border-slate-800/80 space-y-2 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Slot Total ({booking.durationMinutes} mins)</span>
                <span className="font-mono text-slate-200">₹{booking.totalAmount}</span>
              </div>
              <div className="flex justify-between text-[#A3E635] font-semibold text-sm">
                <span>Pay Advance Now via GPay</span>
                <span className="font-mono">₹{booking.advanceAmount}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Balance Payable at Turf Counter</span>
                <span className="font-mono text-slate-200">₹{booking.balanceAmount}</span>
              </div>
            </div>
          </div>

          {/* Right Column: Upload Screenshot & UTR */}
          <div className="md:col-span-7 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="bg-[#141D2E]/70 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-400">Reserved Slot Details</p>
                <p className="text-sm font-semibold text-white mt-1">
                  {booking.courtName} · {booking.sport}
                </p>
                <p className="text-xs font-mono text-slate-300 mt-1">
                  {booking.bookingDate} · {booking.startTime} – {booking.endTime} (
                  {booking.durationMinutes} mins)
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Player: {booking.customerName} · {booking.customerPhone}
                </p>
              </div>

              <div>
                <label
                  htmlFor="upi-utr-input"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  12-Digit UPI Transaction ID / UTR Number (from GPay receipt)
                </label>
                <input
                  id="upi-utr-input"
                  type="text"
                  value={upiUtr}
                  onChange={(e) => setUpiUtr(e.target.value)}
                  placeholder="Enter 12-digit UPI UTR reference"
                  className="w-full px-3.5 py-2.5 bg-[#090D16] border border-slate-700 rounded-lg text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-[#A3E635]"
                />
              </div>

              <div>
                <label
                  htmlFor="gpay-screenshot-file"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Upload Your Google Pay Screenshot *
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label
                    htmlFor="gpay-screenshot-file"
                    className="flex flex-col items-center justify-center border border-dashed border-slate-700 hover:border-[#A3E635] bg-[#090D16] rounded-xl p-4 cursor-pointer transition-colors min-h-[140px] text-center"
                  >
                    <Upload className="w-6 h-6 text-slate-400 mb-2" />
                    <span className="text-xs font-medium text-slate-200">
                      Click to select screenshot
                    </span>
                    <span className="text-[11px] text-slate-500 mt-1">
                      PNG, JPG, or WEBP from your phone/computer
                    </span>
                    <input
                      id="gpay-screenshot-file"
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>

                  <div className="flex flex-col items-center justify-center bg-[#090D16] border border-slate-800 rounded-xl p-2 min-h-[140px]">
                    {screenshotDataUrl ? (
                      <div className="relative w-full h-36 flex flex-col items-center justify-center">
                        <img
                          src={screenshotDataUrl}
                          alt="Uploaded GPay payment receipt preview"
                          className="max-h-28 object-contain rounded-lg border border-slate-700"
                        />
                        <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                          <FileCheck2 className="w-3.5 h-3.5" />
                          Screenshot attached & ready
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 text-center px-3">
                        After paying ₹{booking.advanceAmount} on GPay, upload your receipt screenshot here.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {errorMsg && (
                <div className="flex items-center gap-2 text-xs text-red-300 bg-red-950/50 border border-red-800/70 rounded-lg px-3.5 py-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <ShieldCheck className="w-4 h-4 text-[#A3E635] shrink-0" />
                <span>Slot stays locked for you while the turf owner clicks Confirm.</span>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#A3E635] hover:bg-[#bef264] text-slate-950 font-semibold text-sm rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {submitting ? 'Uploading Proof...' : 'Submit Screenshot & Lock Slot'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
