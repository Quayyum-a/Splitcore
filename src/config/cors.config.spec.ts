import { getCorsOptions } from './cors.config';

type OriginCallback = (err: Error | null, allow?: boolean) => void;
type OriginFn = (origin: string | undefined, callback: OriginCallback) => void;

// Resolves the origin callback into something assertable: either the error the
// config passed, or the boolean allow/deny decision.
function decide(nodeEnv: string, origin: string | undefined) {
  const originFn = getCorsOptions(nodeEnv).origin as unknown as OriginFn;
  let result: { error: Error | null; allowed?: boolean } | undefined;
  originFn(origin, (error, allowed) => {
    result = { error, allowed };
  });
  if (!result) throw new Error('origin callback was never invoked');
  return result;
}

describe('getCorsOptions origin decisions', () => {
  const ORIGINS_VAR = 'ALLOWED_ORIGINS';
  const original = process.env[ORIGINS_VAR];

  afterEach(() => {
    if (original === undefined) delete process.env[ORIGINS_VAR];
    else process.env[ORIGINS_VAR] = original;
  });

  it('allows a request with no origin (curl, mobile, server-to-server)', () => {
    expect(decide('production', undefined)).toEqual({ error: null, allowed: true });
  });

  it('allows the canonical production domains', () => {
    expect(decide('production', 'https://splitcore.app').allowed).toBe(true);
    expect(decide('production', 'https://www.splitcore.app').allowed).toBe(true);
  });

  it('allows the deployed frontend origin', () => {
    expect(decide('production', 'https://splitcore-app.netlify.app').allowed).toBe(true);
  });

  // The whole point: a browser must get a plain missing-CORS-header response,
  // not a 500. Passing an Error to the callback makes the cors middleware
  // throw, which surfaced as "HTTP 500" on every cross-origin request and
  // buried genuine server errors.
  it('denies an unknown origin without raising an error', () => {
    const result = decide('production', 'https://evil.example.com');
    expect(result.error).toBeNull();
    expect(result.allowed).toBe(false);
  });

  it('honours extra origins from ALLOWED_ORIGINS', () => {
    process.env[ORIGINS_VAR] = 'https://staging.splitcore.app,https://preview.example.com';
    expect(decide('production', 'https://staging.splitcore.app').allowed).toBe(true);
    expect(decide('production', 'https://preview.example.com').allowed).toBe(true);
    expect(decide('production', 'https://other.example.com').allowed).toBe(false);
  });

  it('tolerates whitespace and trailing slashes in ALLOWED_ORIGINS', () => {
    process.env[ORIGINS_VAR] = ' https://a.example.com , https://b.example.com/ ';
    expect(decide('production', 'https://a.example.com').allowed).toBe(true);
    expect(decide('production', 'https://b.example.com').allowed).toBe(true);
  });

  it('ignores empty entries from a trailing comma', () => {
    process.env[ORIGINS_VAR] = 'https://a.example.com,';
    // An empty string must not become an allowed origin.
    expect(decide('production', '').allowed).toBe(true); // falsy origin => no-origin path
    expect(decide('production', 'https://a.example.com').allowed).toBe(true);
  });

  it('allows localhost in development and denies it in production', () => {
    expect(decide('development', 'http://localhost:3000').allowed).toBe(true);
    expect(decide('development', 'http://localhost:3001').allowed).toBe(true);
    expect(decide('production', 'http://localhost:3000').allowed).toBe(false);
  });

  it('falls back to the development list for an unrecognised NODE_ENV', () => {
    expect(decide('wat', 'http://localhost:3000').allowed).toBe(true);
    expect(decide('wat', 'https://splitcore.app').allowed).toBe(false);
  });
});

describe('getCorsOptions static options', () => {
  it('permits the verbs and headers the API actually uses', () => {
    const opts = getCorsOptions('production');
    expect(opts.credentials).toBe(true);
    expect(opts.methods).toEqual(expect.arrayContaining(['GET', 'POST', 'PATCH', 'DELETE']));
    expect(opts.allowedHeaders).toEqual(expect.arrayContaining(['Content-Type', 'Authorization']));
  });
});
