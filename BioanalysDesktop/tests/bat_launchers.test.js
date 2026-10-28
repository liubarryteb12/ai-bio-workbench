import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const LAUNCHERS = ['start_all.bat', 'start_portal.bat', 'start_workbench.bat'];

test('Windows batch launchers use CRLF and are covered by gitattributes', () => {
  const attributes = fs.readFileSync(path.join(REPO, '.gitattributes'), 'utf8');
  assert.match(attributes, /^\*\.bat\s+text\s+eol=crlf$/m);
  assert.match(attributes, /^\*\.cmd\s+text\s+eol=crlf$/m);

  for (const name of LAUNCHERS) {
    const file = path.join(REPO, name);
    assert.ok(fs.existsSync(file), `${name} missing`);
    const bytes = fs.readFileSync(file);
    let lf = 0;
    let crlf = 0;
    let loneCr = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] === 0x0d) {
        if (bytes[index + 1] === 0x0a) {
          crlf += 1;
          index += 1;
        } else {
          loneCr += 1;
        }
      } else if (bytes[index] === 0x0a) {
        lf += 1;
      }
    }
    assert.ok(crlf > 0, `${name} has no CRLF line endings`);
    assert.equal(lf, 0, `${name} contains lone LF line endings`);
    assert.equal(loneCr, 0, `${name} contains lone CR line endings`);
  }
});
