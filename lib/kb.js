// Internal knowledge base — the "documentation" the conversational assistant
// and the agent-side recommender search. Each article carries step-by-step
// guidance, an optional internal doc link, and an optional self-service action
// that can resolve simple cases without a human.

export const ARTICLES = [
  {
    id: 'kb-password-reset', dept: 'IT', simple: true, action: 'password_reset',
    title: 'Reset a forgotten or expired password',
    keywords: ['password', 'reset', 'forgot', 'locked', 'login', 'sign in', 'account locked', 'expired'],
    tip: 'Most password problems are fixed instantly with a self-service reset.',
    steps: [
      'Open the self-service portal and choose “Forgot password”.',
      'Verify your identity with the code sent to your phone.',
      'Set a new password (12+ characters).',
      'Sign in again — if it still fails, your account may be locked; we can unlock it.',
    ],
    link: 'https://intranet.example.com/it/password-reset',
  },
  {
    id: 'kb-monitor', dept: 'IT', simple: true, action: null,
    title: 'Monitor / external display not turning on',
    keywords: ['monitor', 'screen', 'display', 'not turning on', 'no signal', 'black screen', 'second screen'],
    tip: 'A loose cable or wrong input source is the cause about 8 times out of 10.',
    steps: [
      'Check the power cable at both the monitor and the wall, and confirm the power light is on.',
      'Reseat the video cable (HDMI/DisplayPort/USB-C) at both ends.',
      'Press the monitor’s input/source button and select the port your cable uses.',
      'Try a different cable or port if you have one. Still dark? Raise a ticket and we’ll swap the unit.',
    ],
    link: 'https://intranet.example.com/it/display-troubleshooting',
  },
  {
    id: 'kb-vpn', dept: 'IT', simple: true, action: null,
    title: 'VPN keeps disconnecting',
    keywords: ['vpn', 'disconnect', 'drop', 'remote', 'work from home', 'tunnel'],
    tip: 'Restarting the client and switching gateway clears most VPN drops.',
    steps: [
      'Fully quit and reopen the VPN client.',
      'Switch to the nearest gateway in the dropdown.',
      'Disable Wi-Fi power-saving / battery-saver mode.',
      'If it still drops, note your gateway and we’ll move you to a stabler one.',
    ],
    link: 'https://intranet.example.com/it/vpn',
  },
  {
    id: 'kb-software', dept: 'IT', simple: true, action: 'software_provision',
    title: 'Request / install approved software',
    keywords: ['install', 'software', 'app', 'license', 'figma', 'provision', 'set up tool'],
    tip: 'Approved apps can be auto-provisioned to your device.',
    steps: [
      'Open the Software Portal.',
      'Search for the app and click Request.',
      'Approved apps install automatically within ~15 minutes.',
    ],
    link: 'https://intranet.example.com/it/software-portal',
  },
  {
    id: 'kb-wifi', dept: 'IT', simple: true, action: null,
    title: 'Slow or dropping Wi-Fi',
    keywords: ['wifi', 'wi-fi', 'internet', 'slow', 'network', 'connection'],
    tip: 'Forgetting and rejoining the network resolves most flaky Wi-Fi.',
    steps: [
      'Forget the office network, then rejoin it.',
      'Move closer to an access point.',
      'Restart your device’s Wi-Fi adapter.',
    ],
    link: 'https://intranet.example.com/it/wifi',
  },
  {
    id: 'kb-expense', dept: 'Finance', simple: true, action: null,
    title: 'Where and how to submit an expense report',
    keywords: ['expense', 'expense report', 'reimbursement', 'claim', 'receipt', 'submit expenses', 'travel'],
    tip: 'Expense reports go through the Finance portal — attach itemised receipts.',
    steps: [
      'Open the Finance portal → Expenses → New report.',
      'Add each line item and attach an itemised receipt (the #1 cause of delays is a missing receipt).',
      'Submit for manager approval; reimbursement lands in the next payroll run.',
    ],
    link: 'https://intranet.example.com/finance/expenses',
  },
  {
    id: 'kb-invoice', dept: 'Finance', simple: true, action: null,
    title: 'Vendor invoice rejected by the portal',
    keywords: ['invoice', 'vendor', 'portal', 'rejected', 'upload', 'billing'],
    tip: 'The portal rejects files over 5 MB.',
    steps: [
      'Check the file is a PDF under 5 MB — compress it if larger.',
      'Confirm the PO number matches the invoice.',
      'Re-upload; if it still fails, raise a ticket with the error text.',
    ],
    link: 'https://intranet.example.com/finance/vendor-portal',
  },
  {
    id: 'kb-leave', dept: 'HR', simple: true, action: null,
    title: 'Check leave / PTO balance',
    keywords: ['leave', 'pto', 'vacation', 'balance', 'holiday', 'days off'],
    tip: 'Your live balance is always on the HRIS “My Balance” page.',
    steps: [
      'Open the HRIS → My Balance.',
      'Annual carry-over is applied on the 1st of January.',
      'If the number looks wrong, raise a ticket and HR will reconcile it.',
    ],
    link: 'https://intranet.example.com/hr/leave',
  },
  {
    id: 'kb-payslip', dept: 'HR', simple: true, action: null,
    title: 'Find or download a payslip',
    keywords: ['payslip', 'payroll', 'salary', 'pay stub'],
    tip: 'Payslips appear under Documents → Payroll within 24h of payday.',
    steps: [
      'Open the HRIS → Documents → Payroll.',
      'Payslips appear within 24 hours of payday.',
      'Missing after 24h? Raise a ticket and HR will re-issue it.',
    ],
    link: 'https://intranet.example.com/hr/payroll',
  },
  {
    id: 'kb-access-card', dept: 'Admin', simple: true, action: null,
    title: 'Building access card not working',
    keywords: ['access card', 'badge', 'card', 'door', 'entry', 'building access'],
    tip: 'Tapping firmly on a second reader works surprisingly often.',
    steps: [
      'Tap firmly and hold for a second.',
      'Try a different reader / door.',
      'Still failing? Raise a ticket and Admin will re-encode the card.',
    ],
    link: 'https://intranet.example.com/admin/access',
  },
  {
    id: 'kb-room', dept: 'Admin', simple: true, action: null,
    title: 'Meeting room double-booked',
    keywords: ['room', 'meeting room', 'booking', 'double booked', 'reservation'],
    tip: 'Most double-bookings are a stale recurring invite.',
    steps: [
      'Check the room calendar for a recurring invite blocking it.',
      'Remove the stale invite or book an alternative room.',
      'If it persists, raise a ticket and Admin will clear it.',
    ],
    link: 'https://intranet.example.com/admin/rooms',
  },
];
