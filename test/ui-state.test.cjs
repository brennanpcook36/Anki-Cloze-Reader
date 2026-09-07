const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = fs.readFileSync(path.join(__dirname, '../src/renderer/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.mjs'), 'utf8');

test('the home screen hidden state overrides its flex layout', () => {
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(app, /\$\("#empty-state"\)\.hidden = true/);
  assert.match(app, /\$\("#empty-state"\)\.hidden = false/);
});

test('Anki reconnects after launch, focus, and while the app remains open', () => {
  assert.match(app, /window\.addEventListener\("focus", refreshAnkiConnection\)/);
  assert.match(app, /setInterval\(refreshAnkiConnection, 5000\)/);
  assert.match(app, /if \(await refreshAnkiConnection\(\)\)/);
});

test('the Anki heartbeat does not rebuild the deck selector', () => {
  assert.match(app, /ankiRequest\(\{ action: "version" \}\)/);
  assert.match(app, /if \(refreshDecks \|\| !ankiWasConnected\) await refreshAnkiDecks\(\)/);
  const heartbeat = app.match(/async function refreshAnkiConnection[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(heartbeat, /replaceChildren/);
});

test('Study Profile selector and editor share one visual control', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  assert.match(html, /class="profile-control"[\s\S]*id="profile-select"[\s\S]*id="profile-button"/);
});

test('Library PDFs expose an Open at page action with page validation', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  assert.match(html, /id="open-page-menu-button">Open at page/);
  assert.match(html, /id="open-page-input" type="number" min="1" step="1"/);
  assert.match(app, /loadPdfFile\(await window\.clozeReader\.loadPdf\(target\.id\), page\)/);
  assert.match(app, /page > state\.pdf\.numPages/);
});

test('main header controls share a standard height', () => {
  assert.match(styles, /\.toolbar \.button, \.toolbar \.mode-switch, \.toolbar \.profile-control, \.toolbar \.ai-toggle \{ height: 38px; \}/);
});

test('Open at page uses prioritized lazy PDF rendering', () => {
  assert.match(app, /renderDocument\(pdf, session, destinationPage, destinationOffset\)/);
  assert.match(app, /new IntersectionObserver/);
  assert.match(app, /await renderPage\(initialPage\)/);
  assert.match(app, /rootMargin: "1200px 0px"/);
});

test('long PDFs show loading state and release distant canvases', () => {
  assert.match(styles, /\.pdf-page\[data-rendered="false"\]::after \{ content: "Loading page…"/);
  assert.match(app, /const unloadDistantPages = \(\) =>/);
  assert.match(app, /canvas\.width = canvas\.height = 0/);
  assert.match(app, /viewer\.removeEventListener\("scroll", scheduleUnload\)/);
});

test('Anki can be refreshed deliberately without changing the heartbeat', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  assert.match(html, /id="refresh-anki"[^>]*>Refresh Anki/);
  assert.match(app, /refreshAnkiConnection\(\{ refreshDecks: true \}\)/);
  assert.match(app, /AnkiConnect unavailable/);
  assert.match(app, /Anki closed/);
});
