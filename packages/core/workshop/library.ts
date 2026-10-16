import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import type { BlueprintDocument, BlueprintRevisionMetadata, ProductionPlan, WorkshopAssignment, WorkshopEvaluationReport, WorkshopScore } from '@autofactorio/contracts';
import { validateWorkshopAssignment } from '@autofactorio/contracts';
import { blueprintContentHash, exportBlueprint, normalizeBlueprint, sanitizedBundle } from './blueprint.js';
import { workshopRubricHash } from './scoring.js';
import { evaluationBoundary } from './boundary.js';

export interface LibraryProvenance { assignment:WorkshopAssignment; evaluationReference:string; chain?:{request:NonNullable<WorkshopAssignment['chainRequest']>;plan:ProductionPlan} }
export interface LibraryAdmission {
  identity:Pick<BlueprintRevisionMetadata,'familyId'|'variantId'|'parentHash'|'label'>;document:BlueprintDocument;
  proof:{score:WorkshopScore;evaluation:WorkshopEvaluationReport;rubric:WorkshopAssignment['rubric'];rubricHash:string;profileId:string;gameFingerprint:string;outputPortId:string;exportValid:boolean;characterBuildEvidence:string[]|null;compatibilityEvidence:string[];distinctionEvidence:string[];admit:boolean;provenance?:LibraryProvenance};operationId:string;
}
export interface LibrarySearch { product?:string;profileId?:string;gameFingerprint?:string;boundaryHash?:string;rubricHash?:string;machine?:string;status?:string;maxWidth?:number;maxHeight?:number;limit?:number;offset?:number }
export interface LibraryEntry extends BlueprintRevisionMetadata { directory:string }
type Row={directory:string};
const safe=(value:string,label:string)=>{if(!/^[\w.-]{1,160}$/.test(value))throw new Error(`Invalid ${label}`);return value;};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const atomicJson=(file:string,value:unknown)=>{const temporary=file+'.pending';writeFileSync(temporary,JSON.stringify(value,null,2),{flag:'wx'});renameSync(temporary,file);};

/** Portable content identity is separate from its boundary/rubric attestations. */
export class BlueprintLibrary {
  private readonly db:Database.Database;
  constructor(readonly root:string){
    mkdirSync(root,{recursive:true});this.db=new Database(path.join(root,'index.sqlite'));this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS revisions(revision_hash TEXT PRIMARY KEY,family_id TEXT NOT NULL,variant_id TEXT NOT NULL,label TEXT NOT NULL,product TEXT NOT NULL,profile_id TEXT NOT NULL,game_fingerprint TEXT NOT NULL,statuses TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,machines TEXT NOT NULL,directory TEXT NOT NULL,operation_id TEXT NOT NULL UNIQUE);CREATE INDEX IF NOT EXISTS revisions_search ON revisions(product,profile_id,game_fingerprint);CREATE TABLE IF NOT EXISTS admission_receipts(operation_id TEXT PRIMARY KEY,entry_id TEXT NOT NULL);`);
    const columns=this.db.prepare('PRAGMA table_info(revisions)').all() as {name:string}[];
    for(const name of ['content_hash','boundary_hash','rubric_hash'])if(!columns.some(column=>column.name===name))this.db.exec(`ALTER TABLE revisions ADD COLUMN ${name} TEXT`);
    this.db.exec('UPDATE revisions SET content_hash=revision_hash WHERE content_hash IS NULL');
  }
  private provenanceBoundary(proof:LibraryAdmission['proof']){
    const p=proof.provenance;if(!p||p.evaluationReference!==proof.evaluation.attemptId)throw new Error('Complete authoritative library provenance required');
    const a=validateWorkshopAssignment(p.assignment);
    if(a.id!==proof.score.candidate.sessionId||a.revision!==proof.score.candidate.assignmentRevision||a.profileId!==proof.profileId||a.gameFingerprint!==proof.gameFingerprint||workshopRubricHash(a.rubric)!==proof.rubricHash)throw new Error('Library assignment provenance mismatch');
    if(a.productionMode==='chain'&&(!p.chain||digest(p.chain.request)!==digest(a.chainRequest)||digest(p.chain.plan.request)!==digest(a.chainRequest)||!p.chain.plan.executable||p.chain.plan.status!=='feasible'))throw new Error('Complete immutable chain plan provenance required');
    return evaluationBoundary(a);
  }
  private metadata(directory:string):LibraryEntry{
    const stored=JSON.parse(readFileSync(path.join(directory,'metadata.json'),'utf8')) as BlueprintRevisionMetadata;
    const proof=JSON.parse(readFileSync(path.join(directory,'evidence.json'),'utf8')) as LibraryAdmission['proof'];let hash:string|null=null;
    // Incomplete historical authority is readable, but never guessed compatible.
    if(proof.provenance){try{hash=this.provenanceBoundary(proof).hash;}catch{/* unknown legacy boundary */}}
    if(stored.boundaryHash&&stored.boundaryHash!==hash)throw new Error('Library boundary evidence mismatch');
    return {...stored,attestationId:stored.attestationId??stored.revisionHash,boundaryHash:hash,boundaryStatus:hash?'known':'unknown',directory};
  }
  private row(id:string):Row{
    safe(id,'revision');const exact=this.db.prepare('SELECT directory FROM revisions WHERE revision_hash=?').get(id) as Row|undefined;if(exact)return exact;
    const rows=this.db.prepare('SELECT directory FROM revisions WHERE content_hash=?').all(id) as Row[];
    if(rows.length!==1)throw new Error(rows.length?'Ambiguous blueprint content; select an exact attestation':'Unknown revision');return rows[0]!;
  }
  admissionReceipt(operationId:string):LibraryEntry|null{
    safe(operationId,'operation');const row=this.db.prepare('SELECT directory FROM revisions WHERE operation_id=? OR revision_hash=(SELECT entry_id FROM admission_receipts WHERE operation_id=?)').get(operationId,operationId) as Row|undefined;
    return row?this.metadata(row.directory):null;
  }
  private index(metadata:LibraryEntry,operationId:string,rubricHash:string){
    this.db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(metadata.attestationId,metadata.familyId,metadata.variantId,metadata.label,metadata.product.name,metadata.profileId,metadata.gameFingerprint,JSON.stringify(metadata.statuses),metadata.footprint.width,metadata.footprint.height,JSON.stringify(metadata.machines),metadata.directory,operationId,metadata.revisionHash,metadata.boundaryHash,rubricHash);
  }
  admit(input:LibraryAdmission):LibraryEntry{
    safe(input.operationId,'operation');const document=normalizeBlueprint(input.document),revisionHash=blueprintContentHash(document),proof=input.proof;
    if(!proof.score.eligible||!proof.evaluation.valid||!proof.evaluation.passed||proof.score.candidate.artifactHash!==revisionHash||proof.evaluation.attemptId!==`${proof.score.candidate.sessionId}:${proof.score.candidate.iteration}`)throw new Error('Library admission requires one exact eligible evaluated artifact');
    if(proof.score.rubricVersion!==proof.rubric.version||proof.rubricHash!==workshopRubricHash(proof.rubric))throw new Error('Library admission rubric evidence mismatch');
    if(!proof.exportValid||!proof.compatibilityEvidence.length||!proof.admit||!proof.distinctionEvidence.length)throw new Error('Library admission validity or useful-distinction gate failed');
    const port=document.ports.find(value=>value.id===proof.outputPortId&&value.direction==='output'&&value.required);if(!port)throw new Error('Library admission output port mismatch');
    const boundaryHash=proof.provenance?this.provenanceBoundary(proof).hash:null;
    if(proof.provenance&&digest(normalizeBlueprint({...document,ports:proof.provenance.assignment.ports}).ports)!==digest(document.ports))throw new Error('Library blueprint boundary differs from assignment');
    const attestationId=boundaryHash?`attestation-${digest({revisionHash,boundaryHash,rubricHash:proof.rubricHash,gameFingerprint:proof.gameFingerprint})}`:revisionHash;
    const receipt=this.admissionReceipt(input.operationId);if(receipt){if(receipt.attestationId!==attestationId)throw new Error('Operation identity already admitted different revision or boundary');return receipt;}
    const existing=this.db.prepare('SELECT directory FROM revisions WHERE revision_hash=?').get(attestationId) as Row|undefined;
    if(existing){this.db.prepare('INSERT INTO admission_receipts VALUES(?,?)').run(input.operationId,attestationId);return this.metadata(existing.directory);}
    const xs=document.entities.map(value=>value.position.x),ys=document.entities.map(value=>value.position.y),statuses:BlueprintRevisionMetadata['statuses']=['export-valid','production-verified'];if(proof.characterBuildEvidence?.length)statuses.push('character-build-verified');
    const directory=path.join(this.root,'components',safe(port.product.name,'product'),safe(input.identity.familyId,'family'),safe(input.identity.variantId,'variant'),'revisions',attestationId);
    const metadata:LibraryEntry={schema:1,...structuredClone(input.identity),revisionHash,attestationId,boundaryHash,boundaryStatus:boundaryHash?'known':'unknown',product:structuredClone(port.product),profileId:safe(proof.profileId,'profile'),gameFingerprint:safe(proof.gameFingerprint,'game fingerprint'),statuses,footprint:{width:Math.max(...xs)-Math.min(...xs)+1,height:Math.max(...ys)-Math.min(...ys)+1},machines:[...new Set(document.entities.map(value=>value.name))].sort(),rate:structuredClone(port.rate),provenance:[...new Set([proof.score.candidate.bundleHash,...proof.score.candidate.evidence])],evidence:[...new Set([...proof.evaluation.evidence,...Object.values(proof.score.dimensions).flatMap(value=>value.evidence),...proof.compatibilityEvidence,...proof.distinctionEvidence,...(proof.characterBuildEvidence??[])])],directory};
    // Recover a completed directory after a crash before indexing. Retry proof
    // must never overwrite the original immutable measurement.
    try{const stored=this.metadata(directory);if(stored.attestationId!==attestationId)throw new Error('Revision directory collision');this.index(stored,input.operationId,proof.rubricHash);return stored;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const temporary=directory+'.pending-'+input.operationId;mkdirSync(path.dirname(directory),{recursive:true});mkdirSync(temporary,{recursive:false});
    try{
      const {directory:_directory,...stored}=metadata;void _directory;
      atomicJson(path.join(temporary,'blueprint.json'),document);writeFileSync(path.join(temporary,'blueprint.txt'),exportBlueprint(document),{flag:'wx'});atomicJson(path.join(temporary,'metadata.json'),stored);atomicJson(path.join(temporary,'evidence.json'),proof);atomicJson(path.join(temporary,'portable.json'),sanitizedBundle(document,stored));renameSync(temporary,directory);this.index(metadata,input.operationId,proof.rubricHash);return metadata;
    }catch(error){rmSync(temporary,{recursive:true,force:true});throw error;}
  }
  search(query:LibrarySearch={}):LibraryEntry[]{
    // Derive legacy authority before pagination; unknown rows cannot consume a
    // boundary-sensitive page or suppress admission of a compatible candidate.
    const rows=this.db.prepare('SELECT directory FROM revisions ORDER BY product,family_id,variant_id,revision_hash').all() as Row[];
    const entries=rows.map(row=>this.metadata(row.directory)).filter(e=>(!query.product||e.product.name===query.product)&&(!query.profileId||e.profileId===query.profileId)&&(!query.gameFingerprint||e.gameFingerprint===query.gameFingerprint)&&(!query.boundaryHash||e.boundaryHash===query.boundaryHash)&&(!query.rubricHash||this.get(e.attestationId!).evidence.rubricHash===query.rubricHash)&&(!query.machine||e.machines.includes(query.machine))&&(!query.status||e.statuses.includes(query.status as BlueprintRevisionMetadata['statuses'][number]))&&(query.maxWidth===undefined||e.footprint.width<=query.maxWidth)&&(query.maxHeight===undefined||e.footprint.height<=query.maxHeight));
    const offset=Math.max(0,query.offset??0);return entries.slice(offset,offset+Math.min(100,Math.max(1,query.limit??25)));
  }
  get(id:string):{entry:LibraryEntry;document:BlueprintDocument;blueprint:string;portable:unknown;evidence:LibraryAdmission['proof']}{
    const {directory}=this.row(id);return{entry:this.metadata(directory),document:JSON.parse(readFileSync(path.join(directory,'blueprint.json'),'utf8')) as BlueprintDocument,blueprint:readFileSync(path.join(directory,'blueprint.txt'),'utf8'),portable:JSON.parse(readFileSync(path.join(directory,'portable.json'),'utf8')),evidence:JSON.parse(readFileSync(path.join(directory,'evidence.json'),'utf8')) as LibraryAdmission['proof']};
  }
  rename(id:string,label:string):void{
    if(!label.trim()||label.length>200)throw new Error('Invalid label');const {directory}=this.row(id),metadata=this.metadata(directory),{directory:_directory,...stored}=metadata;void _directory;
    atomicJson(path.join(directory,'metadata.json.pending-update'),{...stored,label});renameSync(path.join(directory,'metadata.json.pending-update'),path.join(directory,'metadata.json'));this.db.prepare('UPDATE revisions SET label=? WHERE revision_hash=?').run(label,metadata.attestationId);
  }
  async rebuild():Promise<number>{
    this.db.prepare('DELETE FROM revisions').run();let count=0;
    const walk=async(directory:string):Promise<void>=>{let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch{return;}for(const entry of entries){const target=path.join(directory,entry.name);if(entry.isDirectory()&&!entry.name.includes('.pending-'))await walk(target);else if(entry.name==='metadata.json'){const metadata=this.metadata(directory),proof=JSON.parse(readFileSync(path.join(directory,'evidence.json'),'utf8')) as LibraryAdmission['proof'];this.index(metadata,`rebuild-${metadata.attestationId}`,proof.rubricHash);count++;}}};
    await walk(path.join(this.root,'components'));return count;
  }
  close():void{this.db.close();}
}
