// ConsentDecay — pure kernel: "is this act still covered?"
// Consent rots. Strength = 0.5 ^ ((tick - grantedAt) / halfLife).
// COVERED while strength >= minStrength (default 0.5) and no matching revocation has landed.
// Anything the kernel cannot match or measure -> REFUSE-UNKNOWN or {ok:false, why}. Never estimates.

const fin = (n) => typeof n === 'number' && Number.isFinite(n);

function checkGrant(grant) {
  if (grant === null || typeof grant !== 'object' || Array.isArray(grant)) return 'grant is not an object';
  if (typeof grant.scope !== 'string' || grant.scope.length === 0) return 'grant.scope is not a non-empty string';
  if (!fin(grant.grantedAt)) return 'grant.grantedAt is not a finite number';
  if (!fin(grant.halfLife) || grant.halfLife <= 0) return 'grant.halfLife is not a positive finite number';
  if (grant.minStrength !== undefined && (!fin(grant.minStrength) || grant.minStrength <= 0 || grant.minStrength > 1)) {
    return 'grant.minStrength is not in (0, 1]';
  }
  if (grant.revocations !== undefined) {
    if (!Array.isArray(grant.revocations)) return 'grant.revocations is not an array';
    for (let i = 0; i < grant.revocations.length; i++) {
      const r = grant.revocations[i];
      if (r === null || typeof r !== 'object' || Array.isArray(r)) return 'revocation ' + i + ' is not an object';
      if (typeof r.scope !== 'string' || r.scope.length === 0) return 'revocation ' + i + ' has no scope';
      if (!fin(r.at)) return 'revocation ' + i + '.at is not a finite number';
    }
  }
  return null;
}

export function strengthAt(grant, tick) {
  const why = checkGrant(grant);
  if (why) return { ok: false, why };
  if (!fin(tick)) return { ok: false, why: 'tick is not a finite number' };
  if (tick < grant.grantedAt) return { ok: false, why: 'tick precedes grantedAt' };
  return { ok: true, strength: Math.pow(0.5, (tick - grant.grantedAt) / grant.halfLife) };
}

export function expiryTick(grant) {
  const why = checkGrant(grant);
  if (why) return { ok: false, why };
  const min = grant.minStrength === undefined ? 0.5 : grant.minStrength;
  return { ok: true, tick: grant.grantedAt + grant.halfLife * Math.log2(1 / min) };
}

export function ruling(grant, act) {
  const why = checkGrant(grant);
  if (why) return { ok: false, why };
  if (act === null || typeof act !== 'object' || Array.isArray(act)) return { ok: false, why: 'act is not an object' };
  if (typeof act.scope !== 'string' || act.scope.length === 0) return { ok: false, why: 'act.scope is not a non-empty string' };
  if (!fin(act.tick)) return { ok: false, why: 'act.tick is not a finite number' };

  if (act.scope !== grant.scope) {
    return { ok: true, ruling: 'REFUSE-UNKNOWN', why: 'act scope does not match grant scope' };
  }
  if (act.tick < grant.grantedAt) {
    return { ok: true, ruling: 'REFUSE-UNKNOWN', why: 'act precedes the grant' };
  }
  const revs = grant.revocations === undefined ? [] : grant.revocations;
  for (const r of revs) {
    if (r.scope === grant.scope && r.at <= act.tick) {
      return { ok: true, ruling: 'EXPIRED', why: 'revoked', strength: 0 };
    }
  }
  const s = Math.pow(0.5, (act.tick - grant.grantedAt) / grant.halfLife);
  const min = grant.minStrength === undefined ? 0.5 : grant.minStrength;
  if (s >= min) return { ok: true, ruling: 'COVERED', strength: s };
  return { ok: true, ruling: 'EXPIRED', why: 'strength decayed below minStrength', strength: s };
}
