const test = require('node:test');
const assert = require('node:assert/strict');

const { isOriginAllowed } = require('../server/middleware/security');
const { createConnectionRateLimiter } = require('../server/sockets/abuseControl');

test('allows only configured origins', () => {
  process.env.CORS_ORIGINS = 'https://app.example.com,https://admin.example.com';

  assert.equal(isOriginAllowed('https://app.example.com'), true);
  assert.equal(isOriginAllowed('https://admin.example.com'), true);
  assert.equal(isOriginAllowed('https://evil.example.com'), false);
});

test('blocks repeated messages after the configured limit', () => {
  const limiter = createConnectionRateLimiter(2, 1000);

  assert.equal(limiter.allow('device-1'), true);
  assert.equal(limiter.allow('device-1'), true);
  assert.equal(limiter.allow('device-1'), false);
});
