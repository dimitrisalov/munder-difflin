'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { IntegrationEventLog, eventText } = loadTs('src/main/integrationEvents.ts');

test('event text is one bounded line', () => {
  assert.equal(eventText('  a\n\tb  '), 'a b');
  assert.equal(eventText('x'.repeat(500)).length, 200);
});

test('keeps the newest N, newest first, across a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-events-'));
  const file = path.join(dir, 'events.json');
  const log = new IntegrationEventLog(() => file, 3);
  for (let i = 1; i <= 5; i++) log.push('telegram', `event ${i}`);
  log.push('panel', 'broke', 'error');
  assert.deepEqual(log.list().map((e) => e.text), ['broke', 'event 5', 'event 4']);
  const again = new IntegrationEventLog(() => file, 3);
  assert.deepEqual(again.list().map((e) => e.text), ['broke', 'event 5', 'event 4']);
  assert.equal(again.list()[0].level, 'error');
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(new IntegrationEventLog(() => file, 3).list(), []);
});
