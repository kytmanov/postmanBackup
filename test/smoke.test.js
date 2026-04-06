const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig, buildOutputPath, getData } = require('../app.js');

// --- validateConfig tests ---

test('validateConfig - valid config passes without throwing', () => {
  const validConfig = {
    api_keys: ['test-key-123'],
    api_url: 'https://api.getpostman.com/',
    path: {
      collections: 'files/collections',
      environments: 'files/environments',
    },
    time_between_requests: 1000,
    use_date_subfolder: true,
    use_id_subfolder: true,
  };
  // Should not throw
  validateConfig(validConfig);
});

test('validateConfig - empty api_keys array throws', () => {
  const cfg = {
    api_keys: [],
    api_url: 'https://api.getpostman.com/',
    path: { collections: 'files/collections', environments: 'files/environments' },
    time_between_requests: 1000,
    use_date_subfolder: true,
    use_id_subfolder: true,
  };
  assert.throws(() => validateConfig(cfg), /api_keys must be a non-empty array/);
});

test('validateConfig - non-string api_key throws', () => {
  const cfg = {
    api_keys: [123],
    api_url: 'https://api.getpostman.com/',
    path: { collections: 'files/collections', environments: 'files/environments' },
    time_between_requests: 1000,
    use_date_subfolder: true,
    use_id_subfolder: true,
  };
  assert.throws(() => validateConfig(cfg), /all api_keys must be non-empty strings/);
});

test('validateConfig - non-https api_url throws', () => {
  const cfg = {
    api_keys: ['test-key'],
    api_url: 'http://api.getpostman.com/',
    path: { collections: 'files/collections', environments: 'files/environments' },
    time_between_requests: 1000,
    use_date_subfolder: true,
    use_id_subfolder: true,
  };
  assert.throws(() => validateConfig(cfg), /api_url must be a string starting with https/);
});

test('validateConfig - non-positive time_between_requests throws', () => {
  const cfg = {
    api_keys: ['test-key'],
    api_url: 'https://api.getpostman.com/',
    path: { collections: 'files/collections', environments: 'files/environments' },
    time_between_requests: 0,
    use_date_subfolder: true,
    use_id_subfolder: true,
  };
  assert.throws(() => validateConfig(cfg), /time_between_requests must be a positive number/);
});

test('validateConfig - missing path.collections throws', () => {
  const cfg = {
    api_keys: ['test-key'],
    api_url: 'https://api.getpostman.com/',
    path: { collections: '', environments: 'files/environments' },
    time_between_requests: 1000,
    use_date_subfolder: true,
    use_id_subfolder: true,
  };
  assert.throws(() => validateConfig(cfg), /path.collections must be a non-empty string/);
});

// --- buildOutputPath tests ---

test('buildOutputPath - returns a string', () => {
  const result = buildOutputPath('files/collections', 'myapikey');
  assert.ok(typeof result === 'string');
});

test('buildOutputPath - base path is included in result', () => {
  const result = buildOutputPath('files/collections', 'myapikey');
  assert.ok(result.includes('files'));
});

// --- Optional integration test ---

test('getData - optional integration test with real API', {
  skip: !process.env.POSTMAN_API_KEY,
}, async () => {
  // Run with: POSTMAN_API_KEY=your_key node --test test/smoke.test.js
  const data = await getData('https://api.getpostman.com/collections/', process.env.POSTMAN_API_KEY);
  assert.ok(Array.isArray(data.collections), 'collections should be an array');
});
