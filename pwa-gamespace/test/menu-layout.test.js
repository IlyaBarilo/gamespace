import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('viewer menu tab setting follows the latest archive processing card', () => {
  const archiveStatistics = html.indexOf('aria-labelledby="archiveStatisticsTitle"');
  const viewerSetting = html.indexOf('aria-labelledby="viewerSettingsTitle"');
  const lastError = html.indexOf('aria-labelledby="diagnosticsTitle"');

  assert.ok(archiveStatistics >= 0);
  assert.ok(viewerSetting > archiveStatistics);
  assert.ok(lastError > viewerSetting);
});
