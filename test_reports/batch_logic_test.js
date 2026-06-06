/* Headless logic test for the Generate-a-Batch workflow.
 * Loads the REAL db.js + the REAL inline script from quicklabel.html into a
 * sandbox with minimal DOM stubs, then drives the actual batch functions and
 * asserts on the data they produce + persist. No layout (SVG metrics) is
 * exercised — renderLabel safely no-ops against stub elements. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'quicklabel.html'), 'utf8');
const dbJs = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');

// Extract the single inline (non-src) <script> block.
const m = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i.exec(html);
const pageScript = m[1];

// ── stubs ────────────────────────────────────────────────────────────────────
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};

function FakeEl(id) {
  this.id = id || '';
  this.value = '';
  this.checked = false;
  this.innerHTML = '';
  this.textContent = '';
  this.className = '';
  this.style = {};
  this.dataset = {};
  this.options = [];
  this.children = [];
  this.firstElementChild = null;
  this.firstChild = null;
  this.parentNode = null;
  this.classList = { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
}
FakeEl.prototype.focus = function(){};
FakeEl.prototype.blur = function(){};
FakeEl.prototype.setAttribute = function(){};
FakeEl.prototype.removeAttribute = function(){};
FakeEl.prototype.getAttribute = function(){ return null; };
FakeEl.prototype.appendChild = function(c){ this.children.push(c); return c; };
FakeEl.prototype.insertBefore = function(c){ this.children.push(c); return c; };
FakeEl.prototype.removeChild = function(){};
FakeEl.prototype.remove = function(){};
FakeEl.prototype.querySelector = function(){ return null; };
FakeEl.prototype.querySelectorAll = function(){ return []; };
FakeEl.prototype.addEventListener = function(){};
FakeEl.prototype.getBBox = function(){ return { x:0, y:0, width:0, height:0 }; };
FakeEl.prototype.getComputedTextLength = function(){ return 0; };
FakeEl.prototype.closest = function(){ return null; };
FakeEl.prototype.click = function(){};
FakeEl.prototype.scrollIntoView = function(){};

const registry = {};
const document = {
  getElementById: id => (registry[id] || (registry[id] = new FakeEl(id))),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: tag => new FakeEl('<' + tag + '>'),
  addEventListener: () => {},
  body: new FakeEl('body'),
};

// In a browser `window === globalThis`, so `window.db = …` (set by db.js)
// makes `db` a bare global the page can reference. Mirror that: the sandbox
// global IS the window.
let printed = 0;
const sandbox = {
  document, localStorage, console,
  alert: () => {}, prompt: () => null, confirm: () => true,
  setTimeout, clearTimeout, requestAnimationFrame: cb => setTimeout(cb, 0),
  navigator: { userAgent: 'node' },
  print: () => { printed++; },
  addEventListener: () => {},
  matchMedia: () => ({ matches:false, addListener(){}, removeListener(){} }),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// Load the data layer, then the app script. No active user → boot()→showLogin(),
// so full init() never runs (keeps the stub DOM out of the heavy path).
vm.runInContext(dbJs, sandbox, { filename: 'db.js' });
vm.runInContext(pageScript, sandbox, { filename: 'quicklabel.inline.js' });

// ── assertions ───────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

const $ = id => document.getElementById(id);

// 1. Switch into the batch workflow (verifies the workflow is registered;
//    switchWorkflow no-ops on unknown ids). const-scoped WORKFLOWS isn't a
//    sandbox global, so we verify it via behavior below (BL- prefix).
sandbox.switchWorkflow('generate-batch');
check('switched into generate-batch', sandbox.currentWorkflow && sandbox.currentWorkflow().label === 'Generate a Batch',
  sandbox.currentWorkflow && JSON.stringify(sandbox.currentWorkflow()));
$('gen-code').value = 'SL192';
$('date').value = '2026-06-02';
$('cultivar').value = 'Enigma';
$('batch-unit-type').value = 'Bin';
$('quantity').value = '12';

// 3. Add two source grain lots (override / typed path — no saved DB needed).
(async () => {
  await sandbox.addBatchSource('GL-SL188-260201-01');
  await sandbox.addBatchSource('GL-SL188-260201-02');

  const d = sandbox.buildBatchLabelData(3, 12);
  check('batch ID format BL-SL192-260602-01', d.lotId === 'BL-SL192-260602-01', d.lotId);
  check('unit marker "Bin 03/12"', d.destination === 'Bin 03/12', d.destination);
  check('source shows first lot + overflow', d.source === 'GL-SL188-260201-01 +1', d.source);
  check('cultivar carried to label', d.cultivar === 'Enigma', d.cultivar);

  const d1 = sandbox.buildBatchLabelData(1, 12);
  check('unit 1 marker "Bin 01/12"', d1.destination === 'Bin 01/12', d1.destination);

  // 4. Print the batch and inspect what got persisted.
  printed = 0;
  sandbox.printBatch();
  check('window.print() fired once', printed === 1, String(printed));

  const records = await sandbox.db.lots.list({ prefix: 'BL' });
  check('exactly one batch record created', records.length === 1, 'count=' + records.length);
  const rec = records[0] || {};
  check('record lotId is the batch ID', rec.lotId === 'BL-SL192-260602-01', rec.lotId);
  check('record qty = unit count (12)', rec.qty === 12, String(rec.qty));
  check('record unitType = Bin', rec.unitType === 'Bin', rec.unitType);
  check('record sourceLots has both lots',
    Array.isArray(rec.sourceLots) && rec.sourceLots.length === 2, JSON.stringify(rec.sourceLots));

  const edgesA = await sandbox.db.lineage.childrenOf('GL-SL188-260201-01');
  const edgesB = await sandbox.db.lineage.childrenOf('GL-SL188-260201-02');
  check('lineage edge from source A → batch', edgesA.includes('BL-SL192-260602-01'), JSON.stringify(edgesA));
  check('lineage edge from source B → batch', edgesB.includes('BL-SL192-260602-01'), JSON.stringify(edgesB));

  // 5. Next batch same day/genetic increments the sequence (…-02).
  const d2 = sandbox.buildBatchLabelData(1, 1);
  check('second batch ID increments to -02', d2.lotId === 'BL-SL192-260602-02', d2.lotId);

  // 6. Override with NO sources still produces a valid printable batch.
  sandbox.resetForm && sandbox.resetForm();
  sandbox.switchWorkflow('generate-batch');
  $('gen-code').value = 'AB1';
  $('date').value = '2026-06-02';
  const dn = sandbox.buildBatchLabelData(1, 4);
  check('no-source batch still has a batch ID', dn.lotId === 'BL-AB1-260602-01', dn.lotId);
  check('no-source batch has empty source line', dn.source === '', JSON.stringify(dn.source));

  console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
