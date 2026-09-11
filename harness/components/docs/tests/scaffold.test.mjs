import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scaffoldDocs } from '../tools/scaffold.mjs';
import { validateDocs } from '../tools/validate.mjs';

test('scaffoldDocs provisions a complete, valid 3-tier documentation repository', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-v5-docs-test-'));

  try {
    const result = scaffoldDocs({
      targetDir: tmpDir,
      projectName: 'Acme Crawler',
      projectSlug: 'acme-crawler',
      description: 'An autonomous web crawling engine',
    });

    assert.equal(result.projectName, 'Acme Crawler');
    assert.equal(result.slug, 'acme-crawler');

    // Run validation on the generated directory
    const validation = validateDocs(tmpDir);
    assert.equal(validation.valid, true, `Validation failed: ${validation.errors.join(', ')}`);

    // Verify template variable replacement
    const archContent = fs.readFileSync(path.join(tmpDir, 'system/ARCHITECTURE.md'), 'utf8');
    assert.match(archContent, /Acme Crawler/);
    assert.match(archContent, /An autonomous web crawling engine/);

    const manualContent = fs.readFileSync(path.join(tmpDir, 'system/MANUAL.md'), 'utf8');
    assert.match(manualContent, /Acme Crawler/);

    const epicTemplate = fs.readFileSync(path.join(tmpDir, 'design/templates/epic.template.md'), 'utf8');
    assert.match(epicTemplate, /## 2\. Goals & Explicit Non-Goals/);
    assert.match(epicTemplate, /## 3\. Alternatives Considered/);
    assert.match(epicTemplate, /## 4\. Design/);
    assert.match(epicTemplate, /## 5\. Implementation Milestones/);

    // Verify product/ does not exist
    assert.equal(fs.existsSync(path.join(tmpDir, 'product')), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
