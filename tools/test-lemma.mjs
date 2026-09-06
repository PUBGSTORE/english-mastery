// Lemmatiser fixture test. Run: node tools/test-lemma.mjs   (needs the app served? No: loads JSON from disk.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Minimal shim of content.load for node
globalThis.document = { createElement: () => ({ set innerHTML(v) { this.value = v; } }) };
const contentShim = { load: async (n) => JSON.parse(fs.readFileSync(path.join(root, 'data', n + '.json'), 'utf8')), allVocab: async () => [].concat(...['vocab-a1', 'vocab-a2', 'vocab-b1', 'vocab-b2', 'vocab-c1', 'vocab-tech', 'phrasal-verbs', 'idioms'].map((f) => JSON.parse(fs.readFileSync(path.join(root, 'data', f + '.json'), 'utf8')))) };
// Load lemma.js with content.js replaced by the shim
const src = fs.readFileSync(path.join(root, 'js/lemma.js'), 'utf8').replace("import { load } from './content.js';", 'const load = globalThis.__load;').replace("const { allVocab } = await import('./content.js');", 'const allVocab = globalThis.__allVocab;');
globalThis.__load = contentShim.load; globalThis.__allVocab = contentShim.allVocab;
const tmp = path.join(root, 'tools', '.lemma-under-test.mjs');
fs.writeFileSync(tmp, src);
const L = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);
await L.ready();

const cases = [
  ['running', 'run'], ['runs', 'run'], ['ran', 'run'], ['studies', 'study'], ['studied', 'study'], ['studying', 'study'],
  ['happier', 'happy'], ['happiest', 'happy'], ['cities', 'city'], ['boxes', 'box'], ['watches', 'watch'], ['buses', 'bus'],
  ['went', 'go'], ['gone', 'go'], ['children', 'child'], ['women', 'woman'], ['leaves', 'leaf'], ['knives', 'knife'],
  ['making', 'make'], ['made', 'make'], ['stopped', 'stop'], ['stopping', 'stop'], ['bigger', 'big'], ['biggest', 'big'],
  ['quickly', 'quick'], ['happily', 'happy'], ['carefully', 'careful'], ['news', 'news'], ['series', 'series'], ['this', 'this'],
  ['was', 'be'], ['is', 'be'], ['has', 'have'], ['does', 'do'], ['said', 'say'], ['written', 'write'], ['writing', 'write'],
  ['analyses', 'analysis'], ['criteria', 'criterion'], ['better', 'good'], ['worse', 'bad'], ['lying', 'lie'], ['dying', 'die'],
  ['agreed', 'agree'], ['agreeing', 'agree'], ['tried', 'try'], ['tries', 'try'], ['flies', 'fly'], ['played', 'play'],
  ['vulnerabilities', 'vulnerability'], ['patches', 'patch'], ['exploited', 'exploit'], ['escalating', 'escalate'],
  ['glass', 'glass'], ['gas', 'gas'], ['yes', 'yes'], ['us', 'us'], ['bus', 'bus'], ['less', 'less'], ['process', 'process'],
  ['users', 'user'], ['user', 'user'], ['latest', 'late'], ['later', 'late'], ['taken', 'take'], ['taking', 'take'],
  ['hoped', 'hope'], ['hoping', 'hope'], ['used', 'use'], ['using', 'use'], ['saved', 'save'], ['lives', 'life'], ["it's", 'it'], ['meetings', 'meeting'], ['settings', 'setting'], ['nothing', 'nothing'], ['thing', 'thing'], ['stated', 'state'], ['fastest', 'fast'], ['nicer', 'nice'], ['friendlier', 'friendly'], ['remediated', 'remediate'], ['biases', 'bias'], ['lenses', 'lens'], ['cases', 'case'], ['optimizing', 'optimize'], ['enumerated', 'enumerate'], ['sandboxed', 'sandbox'], ['obfuscating', 'obfuscate'], ['containerized', 'containerize'],
];
let fail = 0;
for (const [w, want] of cases) { const got = L.lemmatise(w); if (got !== want) { fail++; console.log(`FAIL ${w} → ${got} (want ${want})`); } }
const tok = L.tokenise("Yesterday Balvant fixed the bug in Mumbai. The Patches were deployed by Priya's team; I don't know why it can't work.");
const tokens = tok.flatMap((s) => s.tokens);
const propers = tokens.filter((t) => t.proper).map((t) => t.w);
console.log('proper nouns:', propers.join(', '));
if (!propers.includes('balvant') || !propers.includes('mumbai') || !propers.includes('priya')) { fail++; console.log('FAIL proper noun detection'); }
if (propers.includes('yesterday') || propers.includes('the') || propers.includes('patches')) { fail++; console.log('FAIL sentence-initial capital treated as proper'); }
console.log(`${cases.length - fail}/${cases.length} lemma cases pass${fail ? '' : ' — OK'}`);
process.exit(fail ? 1 : 0);
