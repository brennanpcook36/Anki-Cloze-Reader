const test = require('node:test');
const assert = require('node:assert/strict');
const { launchAnki, isAnkiRunning } = require('../src/anki-launcher.cjs');

test('Open Anki uses the macOS application launcher without a shell', async () => {
  let call;
  const result = await launchAnki('darwin', (file, args, callback) => { call = { file, args }; callback(null); });
  assert.deepEqual(call, { file: '/usr/bin/open', args: ['-a', 'Anki'] });
  assert.deepEqual(result, { launched: true });
});

test('Open Anki reports a clear error when the application is missing', async () => {
  await assert.rejects(
    launchAnki('darwin', (_file, _args, callback) => callback(new Error('not found'))),
    /Make sure Anki is installed/
  );
});

test('Anki process detection distinguishes a closed app from a missing add-on', async () => {
  let call;
  assert.equal(await isAnkiRunning('darwin', (file, args, callback) => { call = { file, args }; callback(null); }), true);
  assert.deepEqual(call, { file: '/usr/bin/pgrep', args: ['-x', 'Anki'] });
  assert.equal(await isAnkiRunning('darwin', (_file, _args, callback) => callback(new Error('not running'))), false);
});
