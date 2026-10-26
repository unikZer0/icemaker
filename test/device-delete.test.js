const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fleetStore } = require('../lib/fleet');

test('deleting all devices preserves tombstones and does not reassign original credentials on restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icemaker-delete-'));
  t.after(() => { assert.ok(path.resolve(dir).startsWith(path.join(os.tmpdir(), 'icemaker-delete-'))); fs.rmSync(dir, { recursive: true, force: true }); });
  let fleet = fleetStore(dir, 'original-token', 'original-bridge');
  const originalId = fleet.defaultId;
  await fleet.remove(originalId);
  fleet = fleetStore(dir, 'original-token', 'original-bridge');
  assert.equal(fleet.machines.length, 0); assert.equal(fleet.defaultId, undefined);
  const next = await fleet.create({ name: 'New device', location: '', connection: 'wifi' });
  fleet = fleetStore(dir, 'original-token', 'original-bridge');
  assert.equal(fleet.machines.length, 1); assert.equal(fleet.defaultId, next.id);
  assert.equal(fleet.machines[0].token, next.token); assert.equal(fleet.originalId, originalId);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'machines.json')))[0].deletedAt);
});
