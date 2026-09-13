import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTokens, tokenClaims, describeToken } from '../src/token.mjs';

const jwt = (payload) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

test('parseTokens splits on commas and drops blanks', () => {
  assert.deepEqual(parseTokens(''), []);
  assert.deepEqual(parseTokens(undefined), []);
  assert.deepEqual(parseTokens(' a , b,,c '), ['a', 'b', 'c']);
});

test('tokenClaims reads sub and exp, null for non-JWTs', () => {
  assert.deepEqual(tokenClaims(jwt({ sub: 'u1', exp: 10 })), { sub: 'u1', exp: 10 });
  assert.equal(tokenClaims('opaque'), null);
});

test('describeToken flags expiry', () => {
  const now = 1_000_000_000_000;
  assert.match(describeToken(jwt({ sub: '5ca11100-0000', exp: now / 1000 + 7200 }), now), /user 5ca11100…, valid 2 h/);
  assert.match(describeToken(jwt({ sub: 'x', exp: now / 1000 - 7200 }), now), /EXPIRED 2 h ago/);
  assert.equal(describeToken('opaque', now), 'opaque token (not a JWT)');
});
