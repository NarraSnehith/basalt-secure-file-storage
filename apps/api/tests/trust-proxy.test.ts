import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

/**
 * What `trust proxy` actually resolves to.
 *
 * This is the setting that decides which address a rate limit counts against
 * and which one lands in the audit trail, and getting it wrong fails quietly:
 * one hop too few attributes every request to the nearest load balancer, so the
 * limits carry on looking correct while constraining nobody. Worth pinning the
 * behaviour rather than trusting a comment.
 *
 * Express is the thing under test here, so the app is built inline — the point
 * is the relationship between a hop count and a forwarded chain, not our routes.
 */
function ipUnder(trust: boolean | number) {
  const app = express();
  app.set('trust proxy', trust);
  app.get('/whoami', (req, res) => res.json({ ip: req.ip, protocol: req.protocol }));
  return app;
}

// Reading right to left: the nearest proxy is last. A caller who writes their
// own header contributes the left-most entry.
const CHAIN = 'forged-by-the-caller, 203.0.113.9, 10.0.0.7';

describe('trust proxy', () => {
  it('trusts nothing by default, so a forwarded header cannot move the address', async () => {
    const { body } = await request(ipUnder(false)).get('/whoami').set('X-Forwarded-For', CHAIN);
    expect(body.ip).not.toBe('203.0.113.9');
    expect(body.ip).not.toBe('forged-by-the-caller');
  });

  it('one hop stops at the nearest proxy — the bug this replaced', async () => {
    const { body } = await request(ipUnder(1)).get('/whoami').set('X-Forwarded-For', CHAIN);
    expect(body.ip).toBe('10.0.0.7');
  });

  it('two hops reach the real client', async () => {
    const { body } = await request(ipUnder(2)).get('/whoami').set('X-Forwarded-For', CHAIN);
    expect(body.ip).toBe('203.0.113.9');
  });

  it('trusting the whole chain takes the value the caller wrote', async () => {
    const { body } = await request(ipUnder(true)).get('/whoami').set('X-Forwarded-For', CHAIN);
    // Precisely why `true` is not the default: this is attacker-controlled.
    expect(body.ip).toBe('forged-by-the-caller');
  });

  it('honours a forwarded protocol once a proxy is trusted', async () => {
    const trusted = await request(ipUnder(1)).get('/whoami').set('X-Forwarded-Proto', 'https');
    expect(trusted.body.protocol).toBe('https');

    const untrusted = await request(ipUnder(false)).get('/whoami').set('X-Forwarded-Proto', 'https');
    expect(untrusted.body.protocol).toBe('http');
  });
});
