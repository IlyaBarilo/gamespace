import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('PWA keeps the official APK link inside the program block', () => {
  assert.match(html, /href="https:\/\/github\.com\/IlyaBarilo\/gamespace\/releases\/latest\/download\/GameSpace-latest\.apk"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /локальные сайты, настройки и сохранения игр не переносятся автоматически/);
  const program = html.indexOf('aria-labelledby="programTitle"');
  const apk = html.indexOf('id="downloadApkLink"');
  const help = html.indexOf('aria-labelledby="helpTitle"');
  assert.ok(program >= 0 && apk > program && help > apk);
});
