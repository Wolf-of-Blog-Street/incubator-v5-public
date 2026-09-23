import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReleaseVersion as check } from './release.mjs';

test('release version fits the change: pm-only is X.Y.Z.N on the fleet version, any fleet file is X.Y.Z', () => {
  const S = { friends: 'fleet', proxy: 'pm' };
  assert.equal(check('5.9.6.1', '5.9.6', ['components/proxy/proxy.mjs', 'package.json'], S), null);
  assert.equal(check('5.9.6.2', '5.9.6.1', ['components/proxy/x'], S), null);
  assert.ok(check('5.9.7', '5.9.6', ['components/proxy/proxy.mjs'], S), 'pm-only change with a fleet number');
  assert.ok(check('5.9.7.1', '5.9.6', ['components/proxy/proxy.mjs'], S), 'dogfood must stay on the fleet version');
  assert.equal(check('5.9.7', '5.9.6.3', ['components/friends/a.mjs', 'components/proxy/x'], S), null);
  assert.ok(check('5.9.6.4', '5.9.6.3', ['components/friends/a.mjs'], S), 'fleet change with a dogfood number');
});
