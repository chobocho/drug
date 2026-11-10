type Version = { from: string; name: string; weekdays: number[]; active: boolean };
type Medication = { id: string; versions: Version[] };
type Day = { date: string; checkedIds: string[] };
type Backup = { format: string; version: number; medications: Medication[]; days: Day[] };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const DEFAULTS = [
  { id: 'morning', name: '아침약', active: true },
  { id: 'lunch', name: '점심약', active: false },
  { id: 'evening', name: '저녁약', active: true },
  { id: 'eyeDrops', name: '안약', active: true }
];
let db: IDBDatabase;
let medications: Medication[] = [];
let days: Day[] = [];
let today = localDate();
let selected = today;
let busy = false;

function localDate(d = new Date()): string {
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function validDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const date = new Date(0); date.setFullYear(y, m - 1, d); date.setHours(12, 0, 0, 0);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
function dateObject(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(0); date.setFullYear(y, m - 1, d); date.setHours(12, 0, 0, 0); return date;
}
function cutoff(s: string): string {
  const [y, m, d] = s.split('-').map(Number);
  const target = new Date(0); target.setFullYear(y, m - 4, 1); target.setHours(12, 0, 0, 0);
  const last = new Date(target); last.setMonth(last.getMonth() + 1, 0);
  target.setDate(Math.min(d, last.getDate()));
  return localDate(target);
}
function shift(s: string, n: number): string { const d = dateObject(s); d.setDate(d.getDate() + n); return localDate(d); }
function versionAt(m: Medication, date: string): Version | undefined { return [...m.versions].reverse().find(v => v.from <= date); }
function request<T>(r: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
function complete(tx: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error('저장 작업이 취소되었습니다.')); tx.onerror = () => {}; }); }
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('drug-check', 1);
    r.onupgradeneeded = () => {
      const database = r.result;
      const store = database.createObjectStore('medications', { keyPath: 'id' });
      database.createObjectStore('days', { keyPath: 'date' });
      for (const item of DEFAULTS) store.put({ id: item.id, versions: [{ from: '0001-01-01', name: item.name, weekdays: [...ORDER], active: item.active }] });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('다른 탭에서 데이터베이스를 사용 중입니다.'));
  });
}
async function load(): Promise<void> {
  const tx = db.transaction(['medications', 'days'], 'readwrite');
  const done = complete(tx);
  const [ms, ds] = await Promise.all([request<Medication[]>(tx.objectStore('medications').getAll()), request<Day[]>(tx.objectStore('days').getAll())]);
  const min = cutoff(today);
  for (const day of ds) if (day.date < min) tx.objectStore('days').delete(day.date);
  await done;
  const rank = (id: string): number => { const i = DEFAULTS.findIndex(item => item.id === id); return i < 0 ? DEFAULTS.length : i; };
  medications = ms.sort((a, b) => rank(a.id) - rank(b.id)); days = ds.filter(d => d.date >= min);
}
async function put(store: string, value: Medication | Day): Promise<void> {
  const tx = db.transaction(store, 'readwrite'); const done = complete(tx); tx.objectStore(store).put(value); await done;
}
function notice(message: string, error = false): void {
  const el = $('notice'); el.textContent = message; el.classList.toggle('error', error); el.hidden = !message;
}
function errorMessage(e: unknown): string { return e instanceof Error ? e.message : '알 수 없는 오류'; }
function setBusy(value: boolean): void {
  busy = value;
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach(el => { el.disabled = value; });
  if (!value) updateNavigation();
}
async function run(action: () => Promise<void>): Promise<void> {
  if (busy) return;
  setBusy(true); notice('');
  try { await refreshDate(); await action(); }
  catch (e) { notice(`처리하지 못했어요: ${errorMessage(e)}`, true); }
  finally { setBusy(false); }
}
async function refreshDate(): Promise<void> {
  const now = localDate();
  if (now === today) return;
  const wasToday = selected === today; today = now;
  if (wasToday || selected > today) selected = today;
  if (selected < cutoff(today)) selected = cutoff(today);
  await load(); render();
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el;
}
function icon(id: string): string { return ({ morning: '🌅', lunch: '🍱', evening: '🌙', eyeDrops: '💧' } as Record<string, string>)[id] || '💊'; }
function updateNavigation(): void {
  $('previous').toggleAttribute('disabled', busy || selected <= cutoff(today));
  $('next').toggleAttribute('disabled', busy || selected >= today);
}
function renderHome(): void {
  const input = $<HTMLInputElement>('date'); input.min = cutoff(today); input.max = today; input.value = selected;
  const d = dateObject(selected);
  $('date-heading').textContent = `${selected === today ? '오늘' : `${d.getMonth() + 1}월 ${d.getDate()}일`} · ${WEEK[d.getDay()]}요일`;
  updateNavigation();
  const checked = days.find(day => day.date === selected)?.checkedIds || [];
  const list = $('med-list'); list.replaceChildren();
  let count = 0, doneCount = 0;
  for (const m of medications) {
    const v = versionAt(m, selected); if (!v) continue;
    const done = checked.includes(m.id);
    if (!(v.active && v.weekdays.includes(d.getDay())) && !done) continue;
    count++; if (done) doneCount++;
    const card = node('div', 'med-card');
    const symbol = node('span', 'med-icon', icon(m.id)); symbol.setAttribute('aria-hidden', 'true');
    const info = node('div', 'med-info'); info.append(node('strong', '', v.name), node('p', '', done ? '복용 완료' : '복용 전'));
    const label = node('label', 'switch'); const toggle = node('input'); toggle.type = 'checkbox'; toggle.checked = done; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', `${v.name} 복용 완료`);
    toggle.addEventListener('change', () => { const desired = toggle.checked; void run(async () => {
      const old = days.find(day => day.date === selected); const ids = new Set(old?.checkedIds || []);
      if (desired) ids.add(m.id); else ids.delete(m.id);
      const record = { date: selected, checkedIds: [...ids] }; await put('days', record);
      days = days.filter(day => day.date !== record.date); days.push(record); renderHome();
    }).finally(renderHome); });
    label.append(toggle, node('span')); card.append(symbol, info, label); list.append(card);
  }
  if (!count) list.append(node('div', 'empty', '🌿 이 날짜에 복용할 약이 없어요.'));
  $('progress').textContent = `${doneCount} / ${count} 완료`;
}
function saveVersion(m: Medication, next: Omit<Version, 'from'>): Medication {
  return { ...m, versions: [...m.versions.filter(v => v.from !== today), { from: today, name: next.name, weekdays: next.weekdays, active: next.active }].sort((a, b) => a.from.localeCompare(b.from)) };
}
async function saveMedication(m: Medication): Promise<void> { await put('medications', m); medications = medications.map(old => old.id === m.id ? m : old); render(); }
function renderSettings(): void {
  const lunch = medications.find(m => m.id === 'lunch');
  const lunchToggle = $<HTMLInputElement>('lunch-enabled'); lunchToggle.checked = !!(lunch && versionAt(lunch, today)?.active); lunchToggle.disabled = !lunch || busy;
  const list = $('settings-list'); list.replaceChildren();
  for (const m of medications) {
    const v = versionAt(m, today); if (!v || !v.active) continue;
    const form = node('form', 'setting-item');
    const nameLabel = node('label', '', `${icon(m.id)} 약 이름`); const name = node('input', 'name-input'); name.type = 'text'; name.value = v.name; name.maxLength = 50; name.required = true; nameLabel.append(name); form.append(nameLabel);
    const weekLabel = node('div', 'hint', '복용 요일 (하나 이상 선택)'); form.append(weekLabel);
    const week = node('div', 'weekdays'); week.setAttribute('role', 'group'); week.setAttribute('aria-label', `${v.name} 복용 요일`);
    for (const day of ORDER) {
      const label = node('label', 'day-choice'); const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.value = String(day); checkbox.checked = v.weekdays.includes(day); checkbox.setAttribute('aria-label', `${WEEK[day]}요일`);
      label.append(checkbox, node('span', '', WEEK[day])); week.append(label);
    }
    form.append(week);
    const actions = node('div', 'item-actions'); const save = node('button', 'secondary', '저장'); save.type = 'submit'; actions.append(save);
    if (m.id !== 'lunch') {
      const remove = node('button', 'secondary danger', '삭제'); remove.type = 'button';
      remove.addEventListener('click', () => { if (!confirm(`‘${v.name}’을 오늘부터 목록에서 제외할까요? 지난 기록은 유지됩니다.`)) return; void run(async () => { const current = versionAt(m, today); if (current) await saveMedication(saveVersion(m, { ...current, active: false })); }); });
      actions.append(remove);
    }
    form.append(actions);
    form.addEventListener('submit', event => { event.preventDefault(); const trimmed = name.value.trim(); const weekdays = [...week.querySelectorAll<HTMLInputElement>('input:checked')].map(i => Number(i.value));
      if (!trimmed || !weekdays.length) { notice('약 이름을 입력하고 복용 요일을 하나 이상 선택해 주세요.', true); return; }
      void run(async () => { const current = versionAt(m, today); if (!current) throw new Error('약 설정을 찾을 수 없습니다.'); await saveMedication(saveVersion(m, { name: trimmed, weekdays, active: current.active })); notice('약 설정을 저장했어요.'); });
    });
    list.append(form);
  }
}
function render(): void { renderHome(); renderSettings(); }
function validateBackup(value: unknown): Backup {
  const fail = (): never => { throw new Error('올바르지 않거나 지원하지 않는 백업 파일입니다.'); };
  if (!value || typeof value !== 'object') return fail();
  const b = value as Backup;
  if (b.format !== 'drug-check-backup' || b.version !== 1 || !Array.isArray(b.medications) || !Array.isArray(b.days) || b.medications.length > 1000 || b.days.length > 10000) return fail();
  const ids = new Set<string>(); const dates = new Set<string>();
  for (const m of b.medications) {
    if (!m || typeof m.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(m.id) || ids.has(m.id) || !Array.isArray(m.versions) || !m.versions.length || m.versions.length > 10000) return fail();
    ids.add(m.id); let previous = '';
    for (const v of m.versions) {
      if (!v || !validDate(v.from) || v.from <= previous || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 50 || typeof v.active !== 'boolean' || !Array.isArray(v.weekdays) || !v.weekdays.length || v.weekdays.some(x => !Number.isInteger(x) || x < 0 || x > 6) || new Set(v.weekdays).size !== v.weekdays.length) return fail();
      previous = v.from;
    }
  }
  if (!ids.has('lunch')) return fail();
  for (const d of b.days) {
    if (!d || !validDate(d.date) || dates.has(d.date) || !Array.isArray(d.checkedIds) || new Set(d.checkedIds).size !== d.checkedIds.length || d.checkedIds.some(id => typeof id !== 'string' || !ids.has(id) || !versionAt(b.medications.find(m => m.id === id)!, d.date))) return fail();
    dates.add(d.date);
  }
  return b;
}
async function restore(b: Backup): Promise<void> {
  const tx = db.transaction(['medications', 'days'], 'readwrite'); const done = complete(tx);
  const meds = tx.objectStore('medications'), records = tx.objectStore('days'); meds.clear(); records.clear();
  for (const m of b.medications) meds.put(m);
  for (const day of b.days) if (day.date >= cutoff(today)) records.put(day);
  await done; await load(); render();
}
function setup(): void {
  $('settings-button').addEventListener('click', () => { $('home').hidden = true; $('settings').hidden = false; renderSettings(); });
  $('close-settings').addEventListener('click', () => { $('settings').hidden = true; $('home').hidden = false; renderHome(); });
  $('previous').addEventListener('click', () => { if (selected > cutoff(today)) { selected = shift(selected, -1); renderHome(); } });
  $('next').addEventListener('click', () => { if (selected < today) { selected = shift(selected, 1); renderHome(); } });
  $<HTMLInputElement>('date').addEventListener('change', e => { const value = (e.target as HTMLInputElement).value; if (validDate(value) && value >= cutoff(today) && value <= today) selected = value; renderHome(); });
  $<HTMLInputElement>('lunch-enabled').addEventListener('change', e => { const enabled = (e.target as HTMLInputElement).checked; void run(async () => { const m = medications.find(item => item.id === 'lunch'); const v = m && versionAt(m, today); if (!m || !v) throw new Error('점심약 설정을 찾을 수 없습니다.'); await saveMedication(saveVersion(m, { ...v, active: enabled })); }).finally(renderSettings); });
  $('add-form').addEventListener('submit', e => { e.preventDefault(); const input = $<HTMLInputElement>('new-name'); const name = input.value.trim(); if (!name) { notice('약 이름을 입력해 주세요.', true); return; }
    void run(async () => { const id = `med-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`; const m: Medication = { id, versions: [{ from: today, name, weekdays: [...ORDER], active: true }] }; await put('medications', m); medications.push(m); input.value = ''; render(); notice('약을 추가했어요.'); });
  });
  $('export').addEventListener('click', () => { void run(async () => {
    const backup: Backup = { format: 'drug-check-backup', version: 1, medications, days };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = node('a'); link.href = url; link.download = `약체크-백업-${today}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); notice('백업 파일을 저장했어요.');
  }); });
  $('import').addEventListener('click', () => $<HTMLInputElement>('import-file').click());
  $<HTMLInputElement>('import-file').addEventListener('change', e => { const input = e.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file) return;
    void run(async () => { if (file.size > 2 * 1024 * 1024) throw new Error('백업 파일이 너무 큽니다. (최대 2MB)'); let parsed: unknown; try { parsed = JSON.parse(await file.text()); } catch { throw new Error('JSON 파일을 읽을 수 없습니다.'); } const backup = validateBackup(parsed);
      if (!confirm('현재 약 설정과 복약 기록을 백업 내용으로 모두 바꿀까요? 이 작업은 되돌릴 수 없습니다.')) return;
      await restore(backup); notice('백업을 복원했어요.');
    });
  });
  setInterval(() => { if (!busy && localDate() !== today) void run(async () => {}); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy && localDate() !== today) void run(async () => {}); });
}
async function start(): Promise<void> {
  setBusy(true);
  try { db = await openDatabase(); db.onversionchange = () => { db.close(); notice('다른 탭에서 저장소가 변경되었습니다. 새로고침해 주세요.', true); setBusy(true); }; await load(); setup(); render(); setBusy(false); }
  catch (e) { notice(`저장소를 열 수 없어 앱을 사용할 수 없어요. 브라우저 설정을 확인해 주세요. (${errorMessage(e)})`, true); }
}
void start();
