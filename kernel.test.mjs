import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from './kernel.mjs';

const G = { scope: 'email:read', grantedAt: 0, halfLife: 100 };

test('strength halves per half-life: 1 at grant, 0.5 at one, 0.25 at two', () => {
  assert.equal(K.strengthAt(G, 0).strength, 1);
  assert.equal(K.strengthAt(G, 100).strength, 0.5);
  assert.equal(K.strengthAt(G, 200).strength, 0.25);
});

test('COVERED inside one half-life, strength pinned at the midpoint', () => {
  const r = K.ruling(G, { scope: 'email:read', tick: 50 });
  assert.equal(r.ok, true);
  assert.equal(r.ruling, 'COVERED');
  assert.equal(r.strength, 0.7071067811865476);
});

test('boundary tick still COVERED; one tick past it EXPIRED with pinned strength', () => {
  assert.equal(K.ruling(G, { scope: 'email:read', tick: 100 }).ruling, 'COVERED');
  const r = K.ruling(G, { scope: 'email:read', tick: 101 });
  assert.equal(r.ruling, 'EXPIRED');
  assert.equal(r.strength, 0.49654624771851796);
});

test('an act at the grant tick itself is COVERED at exactly full strength, not refused', () => {
  const r = K.ruling(G, { scope: 'email:read', tick: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.ruling, 'COVERED');
  assert.equal(r.strength, 1);
});

test('a landed revocation beats remaining strength; an unlanded one does not', () => {
  const g = { ...G, revocations: [{ scope: 'email:read', at: 30 }] };
  const r = K.ruling(g, { scope: 'email:read', tick: 40 });
  assert.equal(r.ruling, 'EXPIRED');
  assert.equal(r.strength, 0);
  assert.equal(K.ruling(g, { scope: 'email:read', tick: 20 }).ruling, 'COVERED');
});

test('a revocation landing exactly ON the act tick counts as landed; one tick earlier does not', () => {
  const g = { ...G, revocations: [{ scope: 'email:read', at: 30 }] };
  const at = K.ruling(g, { scope: 'email:read', tick: 30 });
  assert.equal(at.ruling, 'EXPIRED');
  assert.equal(at.why, 'revoked');
  assert.equal(at.strength, 0);
  assert.equal(K.ruling(g, { scope: 'email:read', tick: 29 }).ruling, 'COVERED');
});

test('unmatched scope and pre-grant act both REFUSE-UNKNOWN, never estimated', () => {
  assert.equal(K.ruling(G, { scope: 'email:write', tick: 10 }).ruling, 'REFUSE-UNKNOWN');
  assert.equal(K.ruling(G, { scope: 'email:read', tick: -1 }).ruling, 'REFUSE-UNKNOWN');
});

test('non-object grants all refused with the same exact why: null, array, number', () => {
  const why = 'grant is not an object';
  assert.deepEqual(K.strengthAt(null, 0), { ok: false, why });
  assert.deepEqual(K.strengthAt([], 0), { ok: false, why });
  assert.deepEqual(K.strengthAt(7, 0), { ok: false, why });
});

test('grant.scope must be a non-empty string: empty and non-string refused with the exact why', () => {
  const why = 'grant.scope is not a non-empty string';
  assert.deepEqual(K.strengthAt({ scope: '', grantedAt: 0, halfLife: 100 }, 0), { ok: false, why });
  assert.deepEqual(K.strengthAt({ scope: 42, grantedAt: 0, halfLife: 100 }, 0), { ok: false, why });
});

// kills line-20 ||→&& (both): null slips a && chain (typeof null IS 'object') and then throws on
// r.scope; number/array slip the second && and misreport as "has no scope". Pin the exact why for all three.
test('non-object revocation entries refused by name with index: null, number, array all "is not an object"', () => {
  const why = 'revocation 0 is not an object';
  assert.deepEqual(K.strengthAt({ ...G, revocations: [null] }, 0), { ok: false, why });
  assert.deepEqual(K.strengthAt({ ...G, revocations: [7] }, 0), { ok: false, why });
  assert.deepEqual(K.strengthAt({ ...G, revocations: [[]] }, 0), { ok: false, why });
  assert.deepEqual(
    K.strengthAt({ ...G, revocations: [{ scope: 'email:read', at: 1 }, null] }, 0),
    { ok: false, why: 'revocation 1 is not an object' }
  );
});

// kills line-21 ||→&&: an empty-string scope makes only the RIGHT arm true, a non-string scope only
// the LEFT — under && each half sails through to ok:true. Both must refuse with the exact why.
test('revocation scope must be a non-empty string: empty and non-string both refused as "has no scope"', () => {
  const why = 'revocation 0 has no scope';
  assert.deepEqual(K.strengthAt({ ...G, revocations: [{ scope: '', at: 5 }] }, 0), { ok: false, why });
  assert.deepEqual(K.strengthAt({ ...G, revocations: [{ scope: 42, at: 5 }] }, 0), { ok: false, why });
  assert.equal(K.ruling({ ...G, revocations: [{ scope: '', at: 5 }] }, { scope: 'email:read', tick: 0 }).ok, false);
});

// kills line-46 ||→&& (both): null throws on act.scope under a && chain; array/number fall through
// to the wrong why ("act.scope is not a non-empty string"). Pin the exact why for all three.
test('non-object acts all refused with the same exact why: null, array, number', () => {
  const why = 'act is not an object';
  assert.deepEqual(K.ruling(G, null), { ok: false, why });
  assert.deepEqual(K.ruling(G, []), { ok: false, why });
  assert.deepEqual(K.ruling(G, 7), { ok: false, why });
});

// kills line-47 ||→&&: under && an empty or non-string act.scope slips validation and misreports as
// ok:true REFUSE-UNKNOWN (scope mismatch). Malformed input must be ok:false, never a ruling.
test('act.scope must be a non-empty string: empty and non-string are ok:false, never REFUSE-UNKNOWN', () => {
  const why = 'act.scope is not a non-empty string';
  assert.deepEqual(K.ruling(G, { scope: '', tick: 0 }), { ok: false, why });
  assert.deepEqual(K.ruling(G, { scope: 42, tick: 0 }), { ok: false, why });
});

test('minStrength boundaries: 0, 2, NaN, string all refused by name; exactly 1 accepted, expiring at grantedAt', () => {
  const why = 'grant.minStrength is not in (0, 1]';
  assert.deepEqual(K.expiryTick({ ...G, minStrength: 0 }), { ok: false, why });
  assert.deepEqual(K.expiryTick({ ...G, minStrength: 2 }), { ok: false, why });
  assert.deepEqual(K.expiryTick({ ...G, minStrength: NaN }), { ok: false, why });
  assert.deepEqual(K.expiryTick({ ...G, minStrength: 'high' }), { ok: false, why });
  assert.deepEqual(K.expiryTick({ ...G, minStrength: 1 }), { ok: true, tick: 0 });
});

test('bad input returns ok:false; expiryTick pins the boundary numerically', () => {
  assert.equal(K.ruling({ scope: 'x', grantedAt: 0, halfLife: 0 }, { scope: 'x', tick: 1 }).ok, false);
  assert.equal(K.strengthAt(G, Infinity).ok, false);
  assert.equal(K.expiryTick(G).tick, 100);
  assert.equal(K.expiryTick({ ...G, minStrength: 0.25 }).tick, 200);
});
