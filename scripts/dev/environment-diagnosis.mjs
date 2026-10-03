import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Classify only known signatures. Never echo raw sandbox payloads or credentials. */
export function diagnoseSandbox(text) {
  const counts = Object.fromEntries([
    ['refreshFailure', /setup refresh had errors/g],
    ['writeAclFailure', /write ACE (?:grant )?failed/g],
    ['denyAclFailure', /deny ACE failed/g],
    ['historicalOwnerFailure', /SetNamedSecurityInfoW/g],
  ].map(([key, regex]) => [key, [...text.matchAll(regex)].length]));
  return { version: 1, state: counts.refreshFailure ? 'failed' : 'unverified', signatures: counts,
    diagnosis: counts.refreshFailure && (counts.writeAclFailure || counts.denyAclFailure)
      ? 'Sandbox setup cannot update one or more workspace ACL entries; application execution has not started.'
      : 'No current ACL failure can be established from the selected log tail.',
    rootCause: 'unresolved',
    remediation: 'User or administrator should inspect ownership and ACL update rights on the specifically named paths in the private log and repair only confirmed entries. Re-run an ordinary workspace command afterward.',
    fallback: 'For an already authorized project operation, request scoped require_escalated automatic review. A rejection remains a blocker; do not bypass it.',
    exclusions: ['No automatic ACL changes', 'No blanket Git trust changes', 'No prerequisite upgrades', 'Historical ACL ownership is not evidence of the current cause'] };
}

export async function inspectSandboxLog(file) {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat(), length = Math.min(stat.size, 1024 * 1024), buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    return { ...diagnoseSandbox(buffer.toString('utf8')), logModifiedAt: stat.mtime.toISOString(), tailBytes: length, truncated: stat.size > length };
  } finally { await handle.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2];
  Promise.resolve().then(() => { if (!file) throw new Error('Usage: node scripts/dev/environment-diagnosis.mjs <current sandbox log>'); return inspectSandboxLog(file); })
    .then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
