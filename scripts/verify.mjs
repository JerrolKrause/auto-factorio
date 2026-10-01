import { standardVerification } from './dev/standard-verification.mjs';
import { boundedJson } from './dev/safe-artifacts.mjs';

standardVerification(process.argv.slice(2)).then(result => {
  if (!result.passed) process.exitCode = 1;
}).catch(error => { console.error(boundedJson({ error: error.message })); process.exitCode = 1; });
