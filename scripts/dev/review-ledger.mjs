import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkSource, validateContract } from '../check-agent-contract.mjs';
import { appendEvent } from './events.mjs';
import { assessReceiptIntegrity, assessReuse, fingerprintInputs } from './receipts.mjs';
import { boundedJson, createEvidenceDirectory, safeRuntimePath, sha256, writeNewJson } from './safe-artifacts.mjs';

const id = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value) && !value.includes('..');
const text = value => typeof value === 'string' && value.trim().length > 0;
const reasons = new Set(['new-defect', 'incomplete-fix', 'introduced-regression', 'environment-repair', 'coverage-expansion', 'justified-repeat']);

async function retained(reference, root, json = true) {
  if (!reference || !/^[a-f0-9]{64}$/.test(reference.sha256 ?? '')) throw new Error('retained evidence identity required');
  const bytes = await readFile(await safeRuntimePath(root, reference.path, { mustExist: true }));
  if (sha256(bytes) !== reference.sha256) throw new Error('retained evidence integrity mismatch');
  return json ? JSON.parse(bytes) : bytes;
}

/** Records are immutable artifacts; the ledger is their ordered hash-pinned reference list. */
export async function assessReviewLedger(references, { root = process.cwd() } = {}) {
  const errors = [], readinessErrors = [], records = [], findings = new Map(), lastCorrection = new Map(), diagnoses = new Map(), seen = new Set();
  if (!Array.isArray(references)) return { ready: false, errors: ['ledger references required'], records: [], findings: [], uniqueFindings: 0 };
  for (const reference of references) {
    try {
      const row = await retained(reference, root);
      if (row.version !== 1 || !id(row.id) || seen.has(row.id) || !id(row.author) || !Number.isFinite(Date.parse(row.at)) || !['finding', 'adjudication', 'correction', 'diagnosis', 'coverage'].includes(row.kind)) throw new Error('invalid or duplicate ledger record');
      if (!Array.isArray(row.evidence) || !row.evidence.length) throw new Error('classification requires evidence');
      for (const evidence of row.evidence) await retained(evidence, root, false);
      if (row.kind === 'finding') {
        if (!id(row.findingId) || !id(row.invariantId)) throw new Error('finding/invariant identities required');
        const assignment = await retained(row.review?.assignment, root), result = await retained(row.review?.result, root);
        const validation = validateContract(assignment, result);
        if (!validation.valid || assignment.role !== 'review' || !result.findings.some(finding => finding.id === row.findingId)) throw new Error('original reviewer finding is not retained');
        const originalId = row.originalId ?? row.id;
        if (row.originalId) {
          const original = findings.get(row.originalId);
          if (!original || original.invariantId !== row.invariantId) throw new Error('follow-up must link the original invariant');
          original.observations.push(row.id);
          // A new observation reopens a previously fixed claim; its evidence is never overwritten.
          original.disposition = 'pending';
        } else findings.set(originalId, { id: originalId, findingId: row.findingId, invariantId: row.invariantId, disposition: 'pending', observations: [row.id] });
      } else if (row.kind === 'adjudication') {
        const finding = findings.get(row.originalId);
        if (!finding || finding.invariantId !== row.invariantId || !['pending', 'fixed', 'rejected'].includes(row.disposition) || !text(row.reason)) throw new Error('invalid adjudication or missing reason');
        finding.disposition = row.disposition;
      } else if (row.kind === 'correction') {
        const finding = findings.get(row.originalId), previous = lastCorrection.get(row.invariantId);
        if (!finding || finding.invariantId !== row.invariantId || !['satisfied', 'unsatisfied', 'unknown'].includes(row.outcome) || !reasons.has(row.rerunReason) || !text(row.failureSignature) || !text(row.command) || !/^[a-f0-9]{64}$/.test(row.sourceId ?? '') || (row.predecessorId ?? null) !== (previous?.id ?? null)) throw new Error('correction requires stable lineage, source, command, outcome and rerun reason');
        const admission = await retained(row.admission, root);
        if (admission.version !== 1 || admission.kind !== 'correction-admission' || admission.decision !== 'continue' || admission.invariantId !== row.invariantId || !admission.originalIds?.includes(row.originalId) || admission.predecessorId !== (previous?.id ?? null) || admission.command !== row.command || admission.sourceId !== row.sourceId || sha256(JSON.stringify(admission.source)) !== admission.sourceId || !Array.isArray(admission.records) || JSON.stringify(references.slice(0, admission.records.length)) !== JSON.stringify(admission.records)) throw new Error('correction outcome is not bound to its recorded admission/candidate');
        const admittedRecords = records.slice(0, admission.records.length);
        const admittedDiagnoses = new Map(admittedRecords.filter(item => item.kind === 'diagnosis').map(item => [item.invariantId, item]));
        const historic = await correctionDecision(admittedRecords, admittedDiagnoses, row.invariantId, root, { historical: true });
        if (!historic.allowed) throw new Error(historic.reason);
        if (historic.diagnosisId && admission.diagnosisId !== historic.diagnosisId) throw new Error('correction admission does not bind the required diagnosis');
        lastCorrection.set(row.invariantId, row);
      } else if (row.kind === 'diagnosis') {
        if (!id(row.invariantId) || !text(row.command) || !text(row.failureSignature) || !text(row.hypothesis) || !Array.isArray(row.predecessors) || row.predecessors.length !== 2 || !text(row.discriminatingCheck?.command)) throw new Error('bounded diagnosis packet is incomplete');
        const proof = await retained(row.discriminatingCheck.receipt, root);
        if (JSON.stringify([proof.identity?.command, ...(proof.identity?.args ?? [])]) !== row.discriminatingCheck.command) throw new Error('discriminating command does not match receipt');
        const validity = await assessReceiptIntegrity(row.discriminatingCheck.receipt, { root });
        if (!validity.intact) throw new Error(`historical discriminating check is incomplete: ${validity.reason}`);
        const failures = records.filter(item => item.kind === 'correction' && item.invariantId === row.invariantId && item.outcome !== 'satisfied').slice(-2);
        if (failures.length !== 2 || JSON.stringify(row.predecessors) !== JSON.stringify(failures.map(item => item.id))) throw new Error('diagnosis does not cover the last two unsuccessful corrections');
        diagnoses.set(row.invariantId, row);
      } else {
        const assignment = await retained(row.review?.assignment, root), result = await retained(row.review?.result, root);
        const validation = validateContract(assignment, result);
        if (!validation.ready || assignment.role !== 'review' || !Array.isArray(row.unaffectedPaths) || !row.unaffectedPaths.length) throw new Error('unaffected coverage requires ready original review');
        const followup = await retained(row.followup?.assignment, root), returned = await retained(row.followup?.result, root);
        if (!validateContract(followup, returned).ready || followup.role !== 'review') throw new Error('fix-only coverage requires ready follow-up review');
        for (const filename of row.unaffectedPaths) {
          const original = assignment.source.files.find(item => item.path === filename), current = followup.source.files.find(item => item.path === filename);
          if (!original?.sha256 || original.sha256 !== current?.sha256 || !result.scope.some(item => item.path === filename && item.status === 'reviewed') || !returned.scope.some(item => item.path === filename && item.status === 'reviewed')) throw new Error(`unaffected coverage is not justified: ${filename}`);
        }
        // Historical coverage remains readable after a change, but cannot establish current acceptance.
        readinessErrors.push(...await checkSource({ source: { files: followup.source.files.filter(item => row.unaffectedPaths.includes(item.path)) } }, root));
      }
      seen.add(row.id); records.push(row);
    } catch (error) { errors.push(`${reference?.path ?? 'record'}: ${error.message}`); }
  }
  const unresolved = [...findings.values()].filter(row => row.disposition === 'pending').length;
  return { version: 1, ready: errors.length === 0 && readinessErrors.length === 0 && unresolved === 0, valid: errors.length === 0, errors, readinessErrors, uniqueFindings: findings.size, unresolved, findings: [...findings.values()], records };
}

async function correctionDecision(records, diagnoses, invariantId, root, { historical = false } = {}) {
  const relevant = records.filter(row => row.kind === 'correction' && row.invariantId === invariantId);
  const lastSuccess = relevant.findLastIndex(row => row.outcome === 'satisfied');
  const failed = relevant.slice(lastSuccess + 1).filter(row => row.outcome !== 'satisfied');
  if (failed.length < 2) return { allowed: true, reason: 'bounded-correction' };
  const packet = diagnoses.get(invariantId);
  if (!packet || JSON.stringify(packet.predecessors) !== JSON.stringify(failed.slice(-2).map(row => row.id))) return { allowed: false, reason: 'two unsuccessful corrections require diagnosis and a discriminating check' };
  if (historical) {
    const proof = await assessReceiptIntegrity(packet.discriminatingCheck.receipt, { root });
    return { allowed: proof.intact, diagnosisId: packet.id, reason: proof.intact ? 'historical-admission-integrity' : proof.reason };
  }
  const receipt = await retained(packet.discriminatingCheck.receipt, root);
  const proof = await assessReuse(packet.discriminatingCheck.receipt, receipt.identity, { root });
  return { allowed: proof.reusable, diagnosisId: packet.id, reason: proof.reusable ? 'diagnosed-with-current-discriminating-check' : `discriminating check invalid: ${proof.reason}` };
}

export async function assessCorrectionAdmission(input, { root = process.cwd() } = {}) {
  const ledger = await assessReviewLedger(input?.records, { root });
  if (!ledger.valid || !id(input?.invariantId) || !ledger.findings.some(row => row.invariantId === input.invariantId)) return { allowed: false, reason: 'invalid correction lineage', errors: ledger.errors };
  const diagnoses = new Map(ledger.records.filter(row => row.kind === 'diagnosis').map(row => [row.invariantId, row]));
  try { return await correctionDecision(ledger.records, diagnoses, input.invariantId, root); }
  catch (error) { return { allowed: false, reason: error.message }; }
}

export async function recordCorrectionAdmission(input, { root = process.cwd(), outputRoot = '.runtime/development/correction-admissions' } = {}) {
  const decision = await assessCorrectionAdmission(input, { root });
  if (!decision.allowed) return decision;
  if (!text(input.command)) return { allowed: false, reason: 'corrective command and source boundary required' };
  try {
    const source = await fingerprintInputs(root, input.inputs);
    const ledger = await assessReviewLedger(input.records, { root });
    const relevant = ledger.records.filter(row => row.kind === 'correction' && row.invariantId === input.invariantId);
    const directory = await createEvidenceDirectory(root, outputRoot, 'admission');
    const payload = { version: 1, kind: 'correction-admission', id: randomUUID(), at: new Date().toISOString(), invariantId: input.invariantId, originalIds: ledger.findings.filter(row => row.invariantId === input.invariantId).map(row => row.id), predecessorId: relevant.at(-1)?.id ?? null, command: input.command, source, sourceId: sha256(JSON.stringify(source)), records: input.records, decision: 'continue', diagnosisId: decision.diagnosisId ?? null };
    if (!payload.originalIds.length) throw new Error('corrective invariant has no retained finding');
    const filename = path.join(directory, 'admission.json');
    await writeNewJson(filename, payload);
    return { ...decision, admission: { path: path.relative(root, filename).split(path.sep).join('/'), sha256: sha256(await readFile(filename)) }, sourceId: payload.sourceId };
  } catch (error) { return { allowed: false, reason: error.message }; }
}

export async function checkCorrectionAdmission(reference, { root = process.cwd() } = {}) {
  const admission = await retained(reference, root);
  if (admission.kind !== 'correction-admission' || admission.decision !== 'continue' || sha256(JSON.stringify(await fingerprintInputs(root, admission.source))) !== admission.sourceId) throw new Error('correction candidate changed after admission');
  return admission;
}

export async function writeLedgerRecord(directory, row, { root = process.cwd(), records = [] } = {}) {
  if (row.kind === 'diagnosis') {
    const proof = await retained(row.discriminatingCheck?.receipt, root);
    const current = await assessReuse(row.discriminatingCheck.receipt, proof.identity, { root });
    if (!current.reusable) throw new Error(`new diagnosis discriminating check invalid: ${current.reason}`);
  }
  const target = await safeRuntimePath(root, `${directory}/${row.id}.json`);
  // Validate in an immutable temporary artifact before publication. Invalid attempts remain evidence.
  const attempt = await safeRuntimePath(root, `${directory}/attempt-${randomUUID()}.json`);
  await writeNewJson(attempt, row);
  const reference = { path: path.relative(root, attempt).split(path.sep).join('/'), sha256: sha256(await readFile(attempt)) };
  const validation = await assessReviewLedger([...records, reference], { root });
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  await writeNewJson(target, row);
  const published = { path: path.relative(root, target).split(path.sep).join('/'), sha256: sha256(await readFile(target)) };
  const kind = row.kind === 'finding' ? 'finding' : row.kind === 'adjudication' ? 'disposition' : row.kind === 'diagnosis' ? 'escalation' : row.kind === 'correction' ? 'admission' : 'handoff';
  await appendEvent(`${directory}/events.jsonl`, { version: 1, eventId: randomUUID(), runId: row.id, workerId: row.author, sequence: 0, at: row.at, kind, phase: row.kind === 'diagnosis' ? 'diagnosis' : 'review', role: 'author', provenance: 'author', invariantId: row.invariantId, findingId: row.originalId ?? (row.kind === 'finding' ? row.id : undefined), predecessorId: row.predecessorId ?? (row.kind === 'correction' ? row.originalId : undefined), rerunReason: row.rerunReason, evidence: [published.path] }, { root });
  return published;
}

export async function main(args, { root = process.cwd(), write = console.log } = {}) {
  if (args.length !== 3 || !['assess', 'admit', 'record'].includes(args[0]) || args[1] !== '--input') throw new Error('usage: review-ledger.mjs assess|admit|record --input <runtime.json>');
  const input = JSON.parse(await readFile(await safeRuntimePath(root, args[2], { mustExist: true }), 'utf8'));
  const report = args[0] === 'assess' ? await assessReviewLedger(input.records, { root }) : args[0] === 'admit' ? await recordCorrectionAdmission(input, { root }) : await writeLedgerRecord(input.directory, input.record, { root, records: input.records });
  write(boundedJson({ ...report, records: undefined }));
  return args[0] === 'record' || report.ready || report.allowed ? 0 : 1;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(boundedJson({ error: error.message })); process.exitCode = 1; });
