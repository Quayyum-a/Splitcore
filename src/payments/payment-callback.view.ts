export interface CallbackView {
  /** A PaymentStatus value, or 'UNKNOWN' when no payment matched. */
  status: string;
  reference?: string;
  amountKobo?: number;
  venueName?: string;
  entertainerName?: string | null;
  detail?: string;
}

const PRESENTATION: Record<string, { title: string; body: string; tone: string }> = {
  SUCCESS: {
    title: 'Payment confirmed',
    body: 'The tip has been verified with Paystack and recorded in the ledger.',
    tone: '#11823b',
  },
  PENDING: {
    title: 'Still confirming',
    body: 'Paystack has not confirmed this payment yet. Refresh in a moment — this page re-checks every time it loads.',
    tone: '#8a6100',
  },
  CREATED: {
    title: 'Not completed',
    body: 'Checkout was opened but no payment has been confirmed yet.',
    tone: '#8a6100',
  },
  FAILED: {
    title: 'Payment failed',
    body: 'Paystack reported this payment as failed. Nothing was recorded in the ledger.',
    tone: '#a1141b',
  },
  ABANDONED: {
    title: 'Payment abandoned',
    body: 'Checkout was closed before payment completed.',
    tone: '#a1141b',
  },
  REVERSED: {
    title: 'Payment reversed',
    body: 'This payment was reversed after settlement.',
    tone: '#a1141b',
  },
  REFUNDED: {
    title: 'Payment refunded',
    body: 'This payment was refunded.',
    tone: '#a1141b',
  },
  UNKNOWN: {
    title: 'Payment not found',
    body: 'No payment matches that reference. Check the link, or start a new tip.',
    tone: '#a1141b',
  },
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string,
  );
}

function formatNaira(amountKobo: number): string {
  return `₦${(amountKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

/**
 * The confirmation page Paystack returns the guest to.
 *
 * This is a development and pilot stand-in for the real guest frontend: it
 * exists so the checkout flow can be exercised end to end before that
 * frontend exists. It renders the status the *server* verified with
 * Paystack, never anything the redirect itself claims — the redirect proves
 * nothing, which is the whole reason this page calls back into settlement.
 */
export function renderCallbackPage(view: CallbackView): string {
  const presentation = PRESENTATION[view.status] ?? PRESENTATION.UNKNOWN;

  const rows: Array<[string, string]> = [];
  if (view.reference) rows.push(['Reference', view.reference]);
  if (view.amountKobo !== undefined) rows.push(['Amount', formatNaira(view.amountKobo)]);
  if (view.venueName) rows.push(['Venue', view.venueName]);
  if (view.entertainerName) rows.push(['Entertainer', view.entertainerName]);
  rows.push(['Status', view.status]);

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
    )
    .join('');

  const detail = view.detail ? `<p class="detail">${escapeHtml(view.detail)}</p>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(presentation.title)} · Splitcore</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #f6f7f9; color: #14181f; padding: 24px;
  }
  main { max-width: 32rem; width: 100%; background: #fff; border-radius: 14px;
         padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06); }
  h1 { margin: 0 0 8px; font-size: 1.5rem; color: ${presentation.tone}; }
  p { margin: 0 0 20px; color: #4a5260; }
  p.detail { font-size: .875rem; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; font-size: .9375rem; }
  th, td { text-align: left; padding: 10px 0; border-top: 1px solid #eceef2; vertical-align: top; }
  th { font-weight: 500; color: #6b7280; width: 40%; }
  td { font-variant-numeric: tabular-nums; word-break: break-all; }
  footer { margin-top: 24px; font-size: .8125rem; color: #9aa1ad; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f1218; color: #e7eaf0; }
    main { background: #171b23; box-shadow: none; border: 1px solid #262c37; }
    p { color: #a6adbb; }
    th { color: #8b93a1; }
    th, td { border-top-color: #262c37; }
  }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(presentation.title)}</h1>
  <p>${escapeHtml(presentation.body)}</p>
  <table>${tableRows}</table>
  ${detail}
  <footer>Splitcore · status verified server-side with Paystack</footer>
</main>
</body>
</html>`;
}
