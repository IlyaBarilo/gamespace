import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('PWA offers the official APK as a separate application version', () => {
  assert.match(html, /<section class="panel alternative-app-panel"/);
  assert.match(html, /href="https:\/\/github\.com\/IlyaBarilo\/gamespace\/releases\/latest\/download\/GameSpace-latest\.apk"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /локальные сайты, настройки и сохранения игр не переносятся автоматически/);

  const updatePanel = html.indexOf('class="panel pwa-update-panel"');
  const alternativePanel = html.indexOf('class="panel alternative-app-panel"');
  const detailsPanel = html.indexOf('class="panel details-panel"');
  assert.ok(updatePanel >= 0 && alternativePanel > updatePanel && detailsPanel > alternativePanel);
});

test('alternative application card adapts to narrow screens', () => {
  assert.match(styles, /\.alternative-app-panel\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(280px, 0\.72fr\)/);
  assert.match(styles, /@media[^{}]*\{[\s\S]*?\.alternative-app-panel\s*\{\s*grid-template-columns:\s*1fr/);
});
