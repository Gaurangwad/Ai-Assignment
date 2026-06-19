// Seed dataset builder — shared by the CLI seeder (lib/seed.js) and the store's
// auto-seed on first run (works in memory, so it's serverless-safe).

function iso(daysAgo, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

const samples = [
  // [title, description, category, priority, status, requester, daysAgo, resolution]
  ['VPN keeps disconnecting', 'My VPN drops every few minutes when working from home, I cannot stay connected to the internal network.', 'IT', 'urgent', 'Resolved', 'Priya Sharma', 40,
    'Reinstalled the VPN client and switched the employee to the EU gateway. Stable since.'],
  ['Cannot log in to email', 'Outlook says my password is incorrect even though I just reset it. Login fails on both laptop and phone.', 'IT', 'urgent', 'Closed', 'Daniel Kim', 35,
    'Account was locked after failed attempts. Unlocked in AD and forced a fresh password reset.'],
  ['New laptop request', 'My laptop is 5 years old and very slow. Requesting a replacement device.', 'IT', 'normal', 'In Progress', 'Aisha Khan', 6, ''],
  ['Software install: Figma', 'Please install Figma on my machine for the design team.', 'IT', 'mild', 'Resolved', 'Tom Reyes', 22,
    'Pushed Figma via the software portal and confirmed launch with the user.'],
  ['Printer not working on 3rd floor', 'The shared printer near the kitchen shows offline and nobody can print.', 'IT', 'mild', 'Closed', 'Lena Fischer', 28,
    'Restarted the print spooler and reconnected the printer to the network.'],

  ['Annual leave balance wrong', 'My leave balance shows 3 days but I should have 12. Please correct it.', 'HR', 'mild', 'Resolved', 'Priya Sharma', 30,
    'Carry-over from last year was not applied. Adjusted balance to 12 days in the HRIS.'],
  ['Payslip not received', 'I did not get my payslip for this month and payday was yesterday.', 'HR', 'urgent', 'Closed', 'Marco Bianchi', 33,
    'Email bounced due to a typo in the address. Corrected and re-sent the payslip.'],
  ['Update emergency contact', 'Need to change my emergency contact details in the system.', 'HR', 'normal', 'Resolved', 'Aisha Khan', 18,
    'Updated emergency contact in the employee profile.'],
  ['Onboarding for new hire', 'New developer starts Monday, please set up HR onboarding and accounts.', 'HR', 'mild', 'In Progress', 'Lena Fischer', 3, ''],
  ['Question about parental leave', 'What is the policy for parental leave and how do I apply?', 'HR', 'normal', 'Open', 'Daniel Kim', 1, ''],

  ['Reimbursement for travel', 'Submitted my travel expenses 3 weeks ago and have not been reimbursed yet.', 'Finance', 'mild', 'Resolved', 'Tom Reyes', 25,
    'Claim was missing a receipt. Followed up, received it, and processed the reimbursement.'],
  ['Invoice rejected by vendor portal', 'The vendor portal keeps rejecting my invoice upload with an unclear error.', 'Finance', 'urgent', 'Closed', 'Marco Bianchi', 38,
    'Invoice exceeded the file size limit. Compressed the PDF and uploaded successfully.'],
  ['Corporate card limit increase', 'Requesting a temporary increase on my corporate card for an upcoming conference.', 'Finance', 'normal', 'Resolved', 'Aisha Khan', 15,
    'Approved a temporary limit increase for the conference week.'],
  ['Budget code for new project', 'Need a budget/cost code to charge expenses for project Helix.', 'Finance', 'mild', 'In Progress', 'Priya Sharma', 4, ''],

  ['Broken office chair', 'My chair backrest is broken and uncomfortable. Requesting a replacement.', 'Admin', 'normal', 'Resolved', 'Daniel Kim', 20,
    'Replaced the chair from facilities stock.'],
  ['Meeting room booking issue', 'Booked the Orion room but someone else is in it. Double booking in the system.', 'Admin', 'mild', 'Closed', 'Lena Fischer', 27,
    'Cleared a stale recurring booking that was blocking the room.'],
  ['Access card not working', 'My building access card stopped working at the main entrance this morning.', 'Admin', 'urgent', 'Resolved', 'Tom Reyes', 12,
    'Re-encoded the access card and verified entry at all doors.'],
  ['Request standing desk', 'Requesting a standing desk for ergonomic reasons.', 'Admin', 'normal', 'Open', 'Marco Bianchi', 2, ''],
  ['Wifi slow in meeting rooms', 'Wifi is very slow and intermittent in the meeting rooms on floor 2.', 'IT', 'mild', 'Open', 'Aisha Khan', 1, ''],
  ['Expense policy clarification', 'Are client dinners reimbursable and up to what limit?', 'Finance', 'normal', 'Open', 'Lena Fischer', 0, ''],
];

export function buildSeed() {
  const seed = { tickets: [], notifications: [], counter: 0, notifCounter: 0 };
  for (const [title, description, category, priority, status, requester, daysAgo, resolution] of samples) {
    seed.counter += 1;
    const createdAt = iso(daysAgo);
    const history = [{ status: 'Open', at: createdAt, note: 'Ticket created' }];
    const flow = ['Open', 'In Progress', 'Resolved', 'Closed'];
    const idx = flow.indexOf(status);
    for (let i = 1; i <= idx; i++) {
      history.push({ status: flow[i], at: iso(Math.max(0, daysAgo - i)), note: `Status changed to ${flow[i]}` });
    }
    // Seed a satisfaction rating on most resolved/closed tickets (mostly happy).
    const rated = status === 'Resolved' || status === 'Closed';
    const csat = rated ? (seed.counter % 7 === 0 ? 0 : 1) : null;
    seed.tickets.push({
      id: `TK-${String(seed.counter).padStart(4, '0')}`,
      title, description, category, priority, status, requester,
      agent: idx >= 1 ? `${category} Agent` : null,
      aiCategorized: false,
      resolution: resolution || '',
      csat,
      replies: [],
      createdAt,
      updatedAt: history[history.length - 1].at,
      history,
    });
  }
  return seed;
}
