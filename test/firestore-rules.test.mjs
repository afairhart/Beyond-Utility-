/**
 * Firestore security-rules regression tests.
 *
 * Runs against the Firestore emulator (see package.json "test" script). Guards
 * the invariants that matter for a PUBLIC repo where Firestore is the only place
 * private data may live:
 *
 *   - No self-provisioned admin (the escalation that was fixed).
 *   - No role self-escalation by an existing non-admin.
 *   - No user-directory enumeration by non-admins.
 *   - Admin-only collections deny every non-admin principal.
 *   - Admin flows still work.
 *
 * A failure here should block merge/deploy.
 */
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';

const testEnv = await initializeTestEnvironment({
  projectId: 'buv-rules-ci',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8181 },
});

// Seed baseline data with rules disabled (as the real admin would have).
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await db.collection('users').doc('admin-uid').set({ email: 'admin@buv.test', role: 'admin' });
  await db.collection('users').doc('lp-uid').set({ email: 'lp@buv.test', role: 'lp' });
  await db.collection('pipeline_companies').doc('co1').set({ name: 'Test Co', status: 'new' });
  await db.collection('settings').doc('apiKeys').set({ claude: 'sk-secret' });
  await db.collection('linkedinConnections').doc('c1').set({ name: 'Someone' });
  await db.collection('usage').doc('functions-2026-07').set({ invocations: 1 });
});

const admin    = testEnv.authenticatedContext('admin-uid').firestore();
const lp       = testEnv.authenticatedContext('lp-uid').firestore();
const stranger = testEnv.authenticatedContext('stranger-uid').firestore(); // signed up, no profile
const anon     = testEnv.unauthenticatedContext().firestore();

const ADMIN_ONLY = ['pipeline_companies', 'linkedinConnections', 'linkedinMessages', 'linkedinInvitations', 'linkedinCompanyFollows', 'settings'];

let pass = 0, fail = 0;
async function check(label, promise) {
  try { await promise; console.log('  ok   ' + label); pass++; }
  catch (e) { console.log('  FAIL ' + label + ' — ' + e.message.split('\n')[0]); fail++; }
}

console.log('\n# escalation is closed');
await check('stranger cannot self-create admin profile', assertFails(
  stranger.collection('users').doc('stranger-uid').set({ email: 's@x.test', role: 'admin' })));
await check('stranger cannot self-create partner profile', assertFails(
  stranger.collection('users').doc('stranger-uid').set({ email: 's@x.test', role: 'partner' })));
await check('stranger cannot self-create any profile', assertFails(
  stranger.collection('users').doc('stranger-uid').set({ email: 's@x.test', role: 'lp' })));
await check('lp cannot escalate own role to admin', assertFails(
  lp.collection('users').doc('lp-uid').update({ role: 'admin' })));

console.log('\n# user directory is not enumerable by non-admins');
await check('lp cannot list users', assertFails(lp.collection('users').get()));
await check('stranger cannot list users', assertFails(stranger.collection('users').get()));
await check('anon cannot list users', assertFails(anon.collection('users').get()));

console.log('\n# admin-only collections deny every non-admin principal');
for (const col of ADMIN_ONLY) {
  await check(`lp cannot read ${col}`, assertFails(lp.collection(col).get()));
  await check(`stranger cannot read ${col}`, assertFails(stranger.collection(col).get()));
  await check(`anon cannot read ${col}`, assertFails(anon.collection(col).get()));
  await check(`lp cannot write ${col}`, assertFails(lp.collection(col).doc('x').set({ a: 1 })));
}

console.log('\n# login-activity self-update stays allowed, everything else denied');
await check('lp can update own login activity', assertSucceeds(
  lp.collection('users').doc('lp-uid').update({ lastLoginAt: new Date(), loginCount: 2 })));
await check('lp can read own profile', assertSucceeds(lp.collection('users').doc('lp-uid').get()));

console.log('\n# admin flows still work');
await check('admin can list users', assertSucceeds(admin.collection('users').get()));
await check('admin can create a user profile (Add User flow)', assertSucceeds(
  admin.collection('users').doc('new-lp').set({ email: 'new@buv.test', role: 'lp' })));
await check('admin can read settings/apiKeys', assertSucceeds(admin.collection('settings').doc('apiKeys').get()));
await check('admin can read+write pipeline', assertSucceeds(
  admin.collection('pipeline_companies').doc('co1').update({ status: 'diligence' })));
await check('admin can read usage', assertSucceeds(admin.collection('usage').doc('functions-2026-07').get()));
await check('nobody client-writes usage', assertFails(
  admin.collection('usage').doc('functions-2026-07').set({ invocations: 0 })));

await testEnv.cleanup();
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
