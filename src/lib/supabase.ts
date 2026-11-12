const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('your-project-id') &&
    !supabaseAnonKey.includes('your-supabase-anon-key')
);

export const SUPABASE_GPAY_WORKFLOW_STEPS = [
  {
    step: '01. Atomic Slot Hold (10-Min Lock)',
    title: 'Customer selects slot -> Server locks 30-min atomic units',
    detail:
      'When a player clicks "Reserve & Pay Advance", the server runs an atomic check on deterministic keys (courtId__YYYY-MM-DD__HH:MM) and creates a 10-minute HOLD so neither online users nor walk-ins can double-book while the customer pays.',
  },
  {
    step: '02. Owner GPay QR & Advance Split',
    title: 'Dynamic UPI QR displays exact Advance Amount (e.g. 30%)',
    detail:
      'Instead of paying 2%–3% payment gateway fees to Razorpay/Stripe, SportSpot generates the Owner’s direct Google Pay / UPI QR code pre-filled with the advance amount (e.g. ₹420 advance now, ₹980 payable at turf counter).',
  },
  {
    step: '03. Screenshot Upload & UTR Submission',
    title: 'Customer uploads GPay screenshot -> Status moves to Awaiting Approval',
    detail:
      'The player uploads their Google Pay payment screenshot and optional 12-digit UPI UTR reference. The slot stays locked as "Reserved · Verification Pending" and pushes a real-time alert to the Owner Dashboard.',
  },
  {
    step: '04. One-Click Owner Confirmation',
    title: 'Owner views screenshot & confirms payment + slot in 1 click',
    detail:
      'In the Admin Dashboard, the owner inspects the GPay screenshot and UTR side-by-side and clicks one button ("Confirm Payment & Approve Slot") to mark the advance verified, permanently lock the slot, and issue the player’s QR Entry Pass.',
  },
];
