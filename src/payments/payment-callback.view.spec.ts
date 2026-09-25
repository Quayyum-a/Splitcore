/**
 * Unit tests for the Paystack callback page.
 *
 * It renders untrusted values (a reference straight off a query string, a
 * venue name from the database) into HTML, so escaping is the thing that
 * matters most here.
 */

import { renderCallbackPage } from './payment-callback.view';

describe('renderCallbackPage', () => {
  it('reports a confirmed payment', () => {
    const html = renderCallbackPage({
      status: 'SUCCESS',
      reference: 'pay_abc123',
      amountKobo: 500000,
      venueName: 'Quilox',
      entertainerName: 'DJ Mike',
    });

    expect(html).toContain('Payment confirmed');
    expect(html).toContain('pay_abc123');
    expect(html).toContain('₦5,000.00');
    expect(html).toContain('Quilox');
    expect(html).toContain('DJ Mike');
  });

  it.each([
    ['PENDING', 'Still confirming'],
    ['CREATED', 'Not completed'],
    ['FAILED', 'Payment failed'],
    ['ABANDONED', 'Payment abandoned'],
    ['REVERSED', 'Payment reversed'],
    ['REFUNDED', 'Payment refunded'],
  ])('renders %s as "%s"', (status, heading) => {
    expect(renderCallbackPage({ status })).toContain(heading);
  });

  it('falls back to a not-found page for an unrecognised status', () => {
    expect(renderCallbackPage({ status: 'WAT' })).toContain('Payment not found');
  });

  it('shows the supplied detail message', () => {
    const html = renderCallbackPage({
      status: 'UNKNOWN',
      detail: 'No payment reference was supplied in the callback URL.',
    });

    expect(html).toContain('No payment reference was supplied');
  });

  it('omits rows it has no value for', () => {
    const html = renderCallbackPage({ status: 'SUCCESS' });

    expect(html).not.toContain('Reference');
    expect(html).not.toContain('Entertainer');
    expect(html).toContain('Status');
  });

  it('formats kobo as naira with two decimals', () => {
    expect(renderCallbackPage({ status: 'SUCCESS', amountKobo: 1 })).toContain('₦0.01');
    expect(renderCallbackPage({ status: 'SUCCESS', amountKobo: 123456789 })).toContain(
      '₦1,234,567.89',
    );
  });

  describe('escaping', () => {
    it('escapes a reference taken straight from the query string', () => {
      const html = renderCallbackPage({
        status: 'SUCCESS',
        reference: '<script>alert(1)</script>',
      });

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes a venue name coming from the database', () => {
      const html = renderCallbackPage({
        status: 'SUCCESS',
        venueName: '"><img src=x onerror=alert(1)>',
      });

      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&quot;&gt;&lt;img');
    });

    it('escapes the detail message', () => {
      const html = renderCallbackPage({ status: 'UNKNOWN', detail: "<b>bold</b> & 'quoted'" });

      expect(html).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; &#39;quoted&#39;');
    });
  });

  it('is a self-contained document with no external requests', () => {
    const html = renderCallbackPage({ status: 'SUCCESS', reference: 'pay_abc' });

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<script[\s>]/);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
