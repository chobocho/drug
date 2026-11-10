import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';

const html = await readFile('index.html', 'utf8');
async function waitFor(fn) {
  for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('Timed out waiting for UI');
}
function change(window, input) { input.dispatchEvent(new window.Event('change', { bubbles: true })); }
async function app(factory = new IDBFactory()) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/', beforeParse(w) {
    Object.defineProperty(w, 'indexedDB', { value: factory });
    const RealDate = w.Date;
    w.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2025-05-31T12:00:00'])); } static now() { return new RealDate('2025-05-31T12:00:00').getTime(); } };
    w.confirm = () => true;
  }});
  await waitFor(() => dom.window.document.querySelectorAll('.med-card').length === 3);
  return dom;
}
const text = (d, s) => [...d.querySelectorAll(s)].map(e => e.textContent);

test('단일 HTML, 기본 체크, 새로고침, 점심약 및 요일 설정', async (t) => {
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+stylesheet/i);
  const factory = new IDBFactory(); const dom = await app(factory); t.after(() => dom.window.close()); const w = dom.window, d = w.document;
  assert.deepEqual(text(d, '.med-info strong'), ['아침약', '저녁약', '안약']);
  assert.equal(d.querySelector('#date').min, '2025-02-28');
  d.querySelector('.med-card input').click();
  await waitFor(() => d.querySelector('#progress').textContent === '1 / 3 완료');
  dom.window.close();
  const dom2 = await app(factory); t.after(() => dom2.window.close()); const w2 = dom2.window, d2 = w2.document;
  assert.equal(d2.querySelector('.med-card input').checked, true);
  d2.querySelector('#settings-button').click();
  d2.querySelector('#lunch-enabled').click();
  await waitFor(() => [...d2.querySelectorAll('.setting-item .name-input')].some(e => e.value === '점심약'));
  const lunch = [...d2.querySelectorAll('.setting-item')].find(e => e.querySelector('.name-input').value === '점심약');
  // 2025-05-31 is Saturday: keep only Monday.
  for (const box of lunch.querySelectorAll('.weekdays input')) box.checked = box.value === '1';
  lunch.dispatchEvent(new w2.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => d2.querySelector('#notice').textContent.includes('저장'));
  d2.querySelector('#close-settings').click();
  assert.deepEqual(text(d2, '.med-info strong'), ['아침약', '저녁약', '안약']);
  d2.querySelector('#date').value = '2025-05-26'; change(w2, d2.querySelector('#date'));
  // Settings changes take effect today, not retroactively.
  assert.deepEqual(text(d2, '.med-info strong'), ['아침약', '저녁약', '안약']);
  dom2.window.close();
});

test('사용자 약 추가, 백업과 복원, 손상된 파일 거부', async (t) => {
  const dom = await app(); t.after(() => dom.window.close()); const w = dom.window, d = w.document;
  d.querySelector('#settings-button').click();
  d.querySelector('#new-name').value = '영양제';
  d.querySelector('#add-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => [...d.querySelectorAll('.setting-item .name-input')].some(e => e.value === '영양제'));
  let blob; w.URL.createObjectURL = b => { blob = b; return 'blob:backup'; }; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function() {};
  d.querySelector('#export').click(); await waitFor(() => !!blob);
  const backup = await new Promise((resolve, reject) => { const reader = new w.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(blob); });
  assert.equal(JSON.parse(backup).format, 'drug-check-backup');
  const item = [...d.querySelectorAll('.setting-item')].find(e => e.querySelector('.name-input').value === '영양제');
  item.querySelector('.danger').click();
  await waitFor(() => ![...d.querySelectorAll('.setting-item .name-input')].some(e => e.value === '영양제'));
  const fileInput = d.querySelector('#import-file');
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ size: backup.length, text: async () => backup }] });
  change(w, fileInput);
  await waitFor(() => d.querySelector('#notice').textContent.includes('복원했어요'));
  assert.ok([...d.querySelectorAll('.setting-item .name-input')].some(e => e.value === '영양제'));
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ size: 2, text: async () => '{}' }] });
  change(w, fileInput);
  await waitFor(() => d.querySelector('#notice').classList.contains('error'));
  assert.ok([...d.querySelectorAll('.setting-item .name-input')].some(e => e.value === '영양제'));
  dom.window.close();
});
