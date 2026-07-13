/* ============================================================
   KEIZOKU 継続 — pace keeper
   Vanilla JS · IndexedDB · offline-first · no dependencies
   ============================================================ */
'use strict';

/* ————— utilities ————— */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DAY = 86400000;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ymd(d) {
  const x = d instanceof Date ? d : new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}
function fromYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function today() { return ymd(new Date()); }
function dayIdx(d = new Date()) { return (d.getDay() + 6) % 7; } // Mon=0 … Sun=6
function startOfWeek(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - dayIdx(x));
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function daysBetween(a, b) { // whole local days from a to b
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((B - A) / DAY);
}
function fmtMin(min) {
  min = Math.round(min);
  if (min < 60) return min + 'm';
  const h = min / 60;
  return (h % 1 === 0 ? h : h.toFixed(1)) + 'h';
}
function fmtHours(min) { return (min / 60).toFixed(1); }
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function niceDate(s) {
  const d = fromYmd(s);
  const t = today(), yst = ymd(addDays(new Date(), -1));
  if (s === t) return 'Today';
  if (s === yst) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/* ————— IndexedDB ————— */
const DB_NAME = 'keizoku', DB_VER = 1;
let db;

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('sessions')) {
        const st = d.createObjectStore('sessions', { keyPath: 'id' });
        st.createIndex('byProject', 'projectId');
        st.createIndex('byDate', 'date');
      }
      if (!d.objectStoreNames.contains('routines')) d.createObjectStore('routines', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('checks')) d.createObjectStore('checks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blocks')) d.createObjectStore('blocks', { keyPath: 'id' });
    };
    req.onsuccess = () => { db = req.result; res(db); };
    req.onerror = () => rej(req.error);
  });
}
function tx(store, mode = 'readonly') { return db.transaction(store, mode).objectStore(store); }
function idbAll(store) {
  return new Promise((res, rej) => {
    const r = tx(store).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}
function idbPut(store, val) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').put(val);
    r.onsuccess = () => res(val);
    r.onerror = () => rej(r.error);
  });
}
function idbDel(store, key) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').delete(key);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}
function idbClear(store) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').clear();
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

/* ————— state ————— */
const S = { projects: [], sessions: [], routines: [], checks: [], blocks: [] };
let currentView = localStorage.getItem('keizoku.view') || 'today';

async function loadAll() {
  [S.projects, S.sessions, S.routines, S.checks, S.blocks] = await Promise.all(
    ['projects', 'sessions', 'routines', 'checks', 'blocks'].map(idbAll)
  );
  S.sessions.sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')));
  S.projects.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

const projById = (id) => S.projects.find((p) => p.id === id);
const activeProjects = () => S.projects.filter((p) => !p.archived);

/* session queries */
function minutesInRange(pid, fromYmdStr, toYmdStr) { // inclusive
  let m = 0;
  for (const s of S.sessions) {
    if (s.projectId !== pid) continue;
    if (s.date >= fromYmdStr && s.date <= toYmdStr) m += s.minutes;
  }
  return m;
}
function sessionsInRange(pid, fromYmdStr, toYmdStr) {
  return S.sessions.filter((s) => s.projectId === pid && s.date >= fromYmdStr && s.date <= toYmdStr);
}
function totalMinutes(pid) {
  return S.sessions.reduce((m, s) => m + (s.projectId === pid ? s.minutes : 0), 0);
}
function lastSessionDate(pid) {
  let last = null;
  for (const s of S.sessions) if (s.projectId === pid && (!last || s.date > last)) last = s.date;
  return last;
}

/* ============================================================
   PACE ENGINE
   Statuses: ahead · on · behind · slump · done · new
   Week runs Mon–Sun. Honest but not naggy: the first two days
   of a week get grace if the previous full week hit target.
   ============================================================ */
function weekWindow(offset = 0) { // offset 0 = current week
  const mon = addDays(startOfWeek(), offset * 7);
  return { from: ymd(mon), to: ymd(addDays(mon, 6)), mon };
}

function slumpCheck(p, unitPerWeekTarget, unitFn) {
  // unitFn(from,to) → units logged in range (minutes or session count)
  const last = lastSessionDate(p.id);
  const gapDays = last ? daysBetween(fromYmd(last), new Date()) : daysBetween(fromYmd(ymd(p.createdAt ? new Date(p.createdAt) : new Date())), new Date());
  if (gapDays >= 12) return { slump: true, why: last ? `No sessions in ${gapDays} days` : 'No sessions yet after 12+ days' };

  // two most recent FULL weeks both under 40% of target
  const w1 = weekWindow(-1), w2 = weekWindow(-2);
  const ageDays = daysBetween(new Date(p.createdAt || Date.now()), new Date());
  if (ageDays >= 18 && unitPerWeekTarget > 0) {
    const u1 = unitFn(w1.from, w1.to), u2 = unitFn(w2.from, w2.to);
    if (u1 < unitPerWeekTarget * 0.4 && u2 < unitPerWeekTarget * 0.4) {
      return { slump: true, why: 'Two straight weeks under 40% of target' };
    }
  }
  return { slump: false };
}

function paceFor(p) {
  const now = new Date();
  const cw = weekWindow(0);
  const di = dayIdx(now); // 0=Mon
  const elapsedFrac = (di + 1) / 7;
  const created = new Date(p.createdAt || Date.now());
  const ageDays = daysBetween(created, now);

  if (p.kind === 'hours_week') {
    const targetMin = p.hoursPerWeek * 60;
    const logged = minutesInRange(p.id, cw.from, cw.to);
    const expected = targetMin * elapsedFrac;
    const sc = slumpCheck(p, targetMin, (f, t) => minutesInRange(p.id, f, t));

    let status, note;
    if (logged >= targetMin) {
      status = 'ahead';
      note = `Week target met — <strong>${fmtMin(logged)}</strong> of ${fmtMin(targetMin)}`;
    } else if (sc.slump) {
      status = 'slump';
      note = `${sc.why}. Needs <strong>${fmtMin(targetMin - logged)}</strong> more this week.`;
    } else if (logged >= expected * 0.85) {
      status = 'on';
      note = `<strong>${fmtMin(logged)}</strong> logged · pace point ${fmtMin(expected)}`;
    } else if (di <= 1 && ageDays >= 9 && minutesInRange(p.id, weekWindow(-1).from, weekWindow(-1).to) >= targetMin * 0.85) {
      status = 'on';
      note = `Early in the week — last week hit target. <strong>${fmtMin(logged)}</strong> so far.`;
    } else if (ageDays < 3 && logged === 0) {
      status = 'new';
      note = 'New commitment — log the first session.';
    } else {
      status = 'behind';
      const deficit = Math.max(0, expected - logged);
      note = `<strong>${fmtMin(deficit)}</strong> behind pace · ${fmtMin(targetMin - logged)} left this week`;
    }
    return { status, note, progress: Math.min(1, logged / targetMin), tick: Math.min(1, expected / targetMin), headline: `${fmtMin(logged)} / ${fmtMin(targetMin)} this week` };
  }

  if (p.kind === 'sessions_week') {
    const target = p.sessionsPerWeek;
    const count = sessionsInRange(p.id, cw.from, cw.to).length;
    const expected = target * elapsedFrac;
    const sc = slumpCheck(p, target, (f, t) => sessionsInRange(p.id, f, t).length);

    let status, note;
    if (count >= target) {
      status = 'ahead';
      note = `Week target met — <strong>${count}</strong> of ${target} sessions`;
    } else if (sc.slump) {
      status = 'slump';
      note = `${sc.why}. ${target - count} session${target - count === 1 ? '' : 's'} still due.`;
    } else if (count >= Math.floor(expected)) {
      status = 'on';
      note = `<strong>${count}</strong> of ${target} sessions in`;
    } else if (di <= 1 && ageDays >= 9 && sessionsInRange(p.id, weekWindow(-1).from, weekWindow(-1).to).length >= target) {
      status = 'on';
      note = `Early in the week — last week hit target.`;
    } else if (ageDays < 3 && count === 0) {
      status = 'new';
      note = 'New commitment — log the first session.';
    } else {
      status = 'behind';
      note = `<strong>${target - count}</strong> session${target - count === 1 ? '' : 's'} short of pace`;
    }
    return { status, note, progress: Math.min(1, count / target), tick: Math.min(1, expected / target), headline: `${count} / ${target} sessions this week` };
  }

  if (p.kind === 'deadline') {
    const totalTargetMin = p.totalHours * 60;
    const done = totalMinutes(p.id);
    const remaining = totalTargetMin - done;
    const dl = fromYmd(p.deadline);
    const daysLeft = daysBetween(now, dl);

    if (remaining <= 0) {
      return { status: 'done', note: `<strong>${fmtMin(done)}</strong> logged — target reached${daysLeft >= 0 ? ' early' : ''}.`, progress: 1, tick: null, headline: `${fmtHours(done)}h / ${p.totalHours}h total` };
    }
    if (daysLeft < 0) {
      return { status: 'slump', note: `Deadline passed ${-daysLeft}d ago with <strong>${fmtMin(remaining)}</strong> unlogged.`, progress: Math.min(1, done / totalTargetMin), tick: null, headline: `${fmtHours(done)}h / ${p.totalHours}h · overdue` };
    }
    const weeksLeft = Math.max(daysLeft / 7, 1 / 7);
    const reqPerWeek = remaining / weeksLeft; // minutes
    const trailing = minutesInRange(p.id, ymd(addDays(now, -13)), today()) / 2; // per-week over last 14d
    const sc = slumpCheck(p, reqPerWeek, (f, t) => minutesInRange(p.id, f, t));
    const ageDays2 = daysBetween(new Date(p.createdAt || Date.now()), now);

    let status, note;
    const reqStr = `${fmtHours(reqPerWeek)}h/wk needed`;
    if (sc.slump) {
      status = 'slump';
      note = `${sc.why}. <strong>${reqStr}</strong> to make ${niceDeadline(p.deadline)} (${daysLeft}d).`;
    } else if (ageDays2 < 7) {
      status = trailing > 0 || done > 0 ? 'on' : 'new';
      note = `<strong>${reqStr}</strong> · ${daysLeft}d to deadline`;
    } else if (trailing >= reqPerWeek * 0.9) {
      status = trailing >= reqPerWeek * 1.15 ? 'ahead' : 'on';
      note = `Trailing pace <strong>${fmtHours(trailing)}h/wk</strong> vs ${fmtHours(reqPerWeek)}h/wk needed · ${daysLeft}d left`;
    } else {
      status = 'behind';
      note = `Trailing pace <strong>${fmtHours(trailing)}h/wk</strong> — needs ${fmtHours(reqPerWeek)}h/wk · ${daysLeft}d left`;
    }
    return { status, note, progress: Math.min(1, done / totalTargetMin), tick: expectedDeadlineTick(p), headline: `${fmtHours(done)}h / ${p.totalHours}h · due ${niceDeadline(p.deadline)}` };
  }

  return { status: 'new', note: '', progress: 0, tick: null, headline: '' };
}

function expectedDeadlineTick(p) {
  // where progress "should" be if paced evenly from creation to deadline
  const start = new Date(p.createdAt || Date.now());
  const end = fromYmd(p.deadline);
  const span = Math.max(1, daysBetween(start, end));
  const gone = Math.min(span, Math.max(0, daysBetween(start, new Date())));
  return Math.min(1, gone / span);
}
function niceDeadline(s) {
  return fromYmd(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const SEAL = {
  ahead: { k: '達', word: 'Target met' },
  on: { k: '順', word: 'On pace' },
  behind: { k: '遅', word: 'Behind' },
  slump: { k: '滞', word: 'Slump' },
  done: { k: '完', word: 'Complete' },
  new: { k: '始', word: 'Starting' }
};
function targetLabel(p) {
  if (p.kind === 'hours_week') return `${p.hoursPerWeek}h per week`;
  if (p.kind === 'sessions_week') return `${p.sessionsPerWeek} sessions per week`;
  return `${p.totalHours}h by ${niceDeadline(p.deadline)}`;
}

/* ============================================================
   TIMER  (persists across reload via localStorage)
   ============================================================ */
const TKEY = 'keizoku.timer';
let timerInt = null;

function getTimer() { try { return JSON.parse(localStorage.getItem(TKEY)); } catch { return null; } }
function setTimer(v) { v ? localStorage.setItem(TKEY, JSON.stringify(v)) : localStorage.removeItem(TKEY); }

function startTimer(projectId) {
  const t = getTimer();
  if (t) { toast('A timer is already running'); return; }
  setTimer({ projectId, startTs: Date.now() });
  renderTimerBar();
  toast('Timer started');
}
async function stopTimer(save) {
  const t = getTimer();
  if (!t) return;
  setTimer(null);
  clearInterval(timerInt); timerInt = null;
  $('#timerbar').hidden = true;
  if (save) {
    const minutes = Math.max(1, Math.round((Date.now() - t.startTs) / 60000));
    await idbPut('sessions', {
      id: uid(), projectId: t.projectId, date: today(),
      minutes, note: '', source: 'timer', createdAt: new Date().toISOString()
    });
    await refresh();
    toast(`Saved ${fmtMin(minutes)}`);
  } else {
    toast('Timer discarded');
  }
}
function renderTimerBar() {
  const t = getTimer();
  const bar = $('#timerbar');
  if (!t) { bar.hidden = true; clearInterval(timerInt); timerInt = null; return; }
  const p = projById(t.projectId);
  $('#timerbar-project').textContent = p ? p.name : 'Session';
  bar.hidden = false;
  const tick = () => { $('#timerbar-clock').textContent = fmtClock((Date.now() - t.startTs) / 1000); };
  tick();
  clearInterval(timerInt);
  timerInt = setInterval(tick, 1000);
}

/* ============================================================
   RENDER — TODAY
   ============================================================ */
function renderToday() {
  const now = new Date();
  $('#today-title').textContent = now.toLocaleDateString(undefined, { weekday: 'long' });
  const cw = weekWindow(0);
  const weekMin = activeProjects().reduce((m, p) => m + minutesInRange(p.id, cw.from, cw.to), 0);
  $('#today-sub').textContent =
    now.toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) +
    ` · week ${dayIdx(now) + 1}/7 · ${fmtMin(weekMin)} logged this week`;

  /* pace chips */
  const paceWrap = $('#today-pace');
  const projs = activeProjects();
  if (!projs.length) {
    paceWrap.innerHTML = `<div class="empty">No projects yet. Create one under Projects — set the pace you're committing to.</div>`;
  } else {
    paceWrap.innerHTML = `<div class="pace-grid">` + projs.map((p) => {
      const pc = paceFor(p);
      const s = SEAL[pc.status];
      return `<button class="pace-chip" data-goto="${p.id}">
        <span class="seal ${pc.status}">${s.k}</span>
        <span>
          <span class="pace-chip-name">${esc(p.name)}</span>
          <span class="pace-chip-sub">${s.word} · ${esc(pc.headline)}</span>
        </span>
      </button>`;
    }).join('') + `</div>`;
    $$('#today-pace [data-goto]').forEach((b) => b.addEventListener('click', () => switchView('projects')));
  }

  /* planned blocks today */
  const di = dayIdx(now);
  const todaysBlocks = S.blocks
    .filter((b) => b.day === di && projById(b.projectId) && !projById(b.projectId).archived)
    .sort((a, b) => a.start.localeCompare(b.start));
  const bWrap = $('#today-blocks');
  if (!todaysBlocks.length) { bWrap.innerHTML = ''; }
  else {
    const nowHM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    bWrap.innerHTML = `<div class="card" style="padding:0">
      <div class="card-label" style="padding:14px 14px 0">Planned today</div>
      ${todaysBlocks.map((b) => {
        const p = projById(b.projectId);
        const loggedToday = minutesInRange(p.id, today(), today());
        let st, cls;
        if (loggedToday >= b.minutes * 0.8) { st = 'kept'; cls = 'kept'; }
        else if (nowHM > addMinutesHM(b.start, b.minutes)) { st = 'missed'; cls = 'missed'; }
        else { st = 'open'; cls = 'open'; }
        return `<div class="block">
          <span class="block-time mono">${b.start}</span>
          <span class="block-name">${esc(p.name)} · ${fmtMin(b.minutes)}</span>
          <span class="block-status ${cls}">${st}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  /* routines due today */
  const due = S.routines.filter((r) => !r.archived && r.days.includes(di));
  const rWrap = $('#today-routines');
  if (!due.length) { rWrap.innerHTML = ''; }
  else {
    rWrap.innerHTML = `<div class="routine-box">
      <div class="card-label" style="padding:14px 14px 0">Routines</div>
      ${due.map((r) => {
        const checked = S.checks.some((c) => c.routineId === r.id && c.date === today());
        return `<div class="routine ${checked ? 'checked-row' : ''}">
          <button class="rcheck ${checked ? 'checked' : ''}" data-routine="${r.id}" aria-label="Mark ${esc(r.name)} done">✓</button>
          <span class="routine-name">${esc(r.name)}</span>
          <span class="routine-meta">${routineStreak(r)}× streak</span>
        </div>`;
      }).join('')}
    </div>`;
    $$('#today-routines [data-routine]').forEach((b) =>
      b.addEventListener('click', () => toggleRoutine(b.dataset.routine))
    );
  }

  /* quick actions */
  const qWrap = $('#today-quicklog');
  if (projs.length) {
    qWrap.innerHTML = `<div class="card">
      <div class="card-label">Quick start</div>
      <div class="quick-grid">
        ${projs.map((p) => `<button class="btn btn-sm" data-start="${p.id}">▸ ${esc(p.name)}</button>`).join('')}
        <button class="btn btn-sm btn-ghost" id="btn-quick-manual">＋ Log minutes</button>
      </div>
    </div>`;
    $$('#today-quicklog [data-start]').forEach((b) =>
      b.addEventListener('click', () => startTimer(b.dataset.start))
    );
    $('#btn-quick-manual').addEventListener('click', () => openSessionForm());
  } else qWrap.innerHTML = '';
}

function addMinutesHM(hm, min) {
  const [h, m] = hm.split(':').map(Number);
  const t = h * 60 + m + min;
  return String(Math.floor((t % 1440) / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}

function routineStreak(r) {
  // consecutive scheduled days checked, walking back from today (today counts only if checked)
  let streak = 0;
  let d = new Date();
  for (let i = 0; i < 400; i++) {
    const di = dayIdx(d);
    if (r.days.includes(di)) {
      const hit = S.checks.some((c) => c.routineId === r.id && c.date === ymd(d));
      if (hit) streak++;
      else if (ymd(d) !== today()) break; // today not yet done doesn't kill the streak
    }
    d = addDays(d, -1);
  }
  return streak;
}

async function toggleRoutine(rid) {
  const id = rid + '_' + today();
  const existing = S.checks.find((c) => c.id === id);
  if (existing) await idbDel('checks', id);
  else await idbPut('checks', { id, routineId: rid, date: today() });
  await refresh();
}

/* ============================================================
   RENDER — PROJECTS
   ============================================================ */
function renderProjects() {
  const wrap = $('#projects-list');
  const projs = activeProjects();
  if (!projs.length) {
    wrap.innerHTML = `<div class="empty">No commitments yet. A project is a pace you intend to keep — hours per week, sessions per week, or a total by a deadline.</div>`;
  } else {
    wrap.innerHTML = projs.map((p) => {
      const pc = paceFor(p);
      const s = SEAL[pc.status];
      return `<div class="card">
        <div class="proj">
          <div class="seal ${pc.status}" title="${s.word}">${s.k}</div>
          <div class="proj-main">
            <div class="proj-name">${esc(p.name)}</div>
            <div class="proj-target">${targetLabel(p)} · <span class="status-word ${pc.status}">${s.word}</span></div>
            <div class="meter">
              ${pc.tick != null ? `<span class="meter-tick" style="left:${(pc.tick * 100).toFixed(1)}%"></span>` : ''}
              <div class="meter-fill ${pc.status}" style="width:${(pc.progress * 100).toFixed(1)}%"></div>
            </div>
            <div class="meter-row"><span>${esc(pc.headline)}</span></div>
            <div class="proj-note">${pc.note}</div>
            <div class="proj-actions">
              <button class="btn btn-sm btn-primary" data-timer="${p.id}">▸ Start timer</button>
              <button class="btn btn-sm" data-log="${p.id}">Log time</button>
              <button class="btn btn-sm btn-ghost" data-edit="${p.id}">Edit</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  $$('#projects-list [data-timer]').forEach((b) => b.addEventListener('click', () => startTimer(b.dataset.timer)));
  $$('#projects-list [data-log]').forEach((b) => b.addEventListener('click', () => openSessionForm(b.dataset.log)));
  $$('#projects-list [data-edit]').forEach((b) => b.addEventListener('click', () => openProjectForm(b.dataset.edit)));

  /* routines list */
  const rWrap = $('#routines-list');
  const routines = S.routines.filter((r) => !r.archived);
  if (!routines.length) {
    rWrap.innerHTML = `<div class="empty">Routines are simple recurring habits — stretch, review, warm-up — checked off per day.</div>`;
  } else {
    rWrap.innerHTML = `<div class="routine-box">` + routines.map((r) => `
      <div class="routine">
        <span class="routine-name">${esc(r.name)}</span>
        <span class="routine-meta">${r.days.length === 7 ? 'Daily' : r.days.map((d) => DOW[d]).join(' ')}</span>
        <span class="routine-meta">${routineStreak(r)}×</span>
        <button class="btn btn-sm btn-ghost" data-redit="${r.id}">Edit</button>
      </div>`).join('') + `</div>`;
    $$('#routines-list [data-redit]').forEach((b) => b.addEventListener('click', () => openRoutineForm(b.dataset.redit)));
  }

  /* archived */
  const aWrap = $('#archived-wrap');
  const arch = S.projects.filter((p) => p.archived);
  if (!arch.length) { aWrap.innerHTML = ''; return; }
  aWrap.innerHTML = `<button class="arch-toggle" id="arch-toggle">Archived (${arch.length}) ▾</button><div id="arch-list" hidden></div>`;
  $('#arch-toggle').addEventListener('click', () => {
    const list = $('#arch-list');
    list.hidden = !list.hidden;
    if (!list.hidden) {
      list.innerHTML = arch.map((p) => `<div class="card arch-item">
        <div class="proj-name">${esc(p.name)}</div>
        <div class="proj-target">${targetLabel(p)} · ${fmtHours(totalMinutes(p.id))}h all-time</div>
        <div class="proj-actions"><button class="btn btn-sm" data-unarch="${p.id}">Restore</button></div>
      </div>`).join('');
      $$('#arch-list [data-unarch]').forEach((b) => b.addEventListener('click', async () => {
        const p = projById(b.dataset.unarch); p.archived = false;
        await idbPut('projects', p); await refresh();
      }));
    }
  });
}

/* ============================================================
   RENDER — LOG
   ============================================================ */
function renderLog() {
  const wrap = $('#log-list');
  const cutoff = ymd(addDays(new Date(), -60));
  const recent = S.sessions.filter((s) => s.date >= cutoff);
  if (!recent.length) {
    wrap.innerHTML = `<div class="empty">Nothing logged in the last 60 days. Start a timer or log minutes after the fact.</div>`;
    return;
  }
  const byDay = {};
  for (const s of recent) (byDay[s.date] ||= []).push(s);
  const days = Object.keys(byDay).sort().reverse();

  wrap.innerHTML = days.map((d) => {
    const total = byDay[d].reduce((m, s) => m + s.minutes, 0);
    return `<div class="log-day">
      <div class="log-day-head"><span>${niceDate(d)}</span><span class="mono">${fmtMin(total)}</span></div>
      ${byDay[d].map((s) => {
        const p = projById(s.projectId);
        return `<div class="session">
          <span class="session-min">${fmtMin(s.minutes)}</span>
          <span class="session-proj">${esc(p ? p.name : '(deleted project)')}
            ${s.note ? `<span class="session-note">${esc(s.note)}</span>` : ''}
          </span>
          <span class="session-src">${s.source === 'timer' ? '⏱' : '✎'}</span>
          <button class="session-del" data-del="${s.id}" aria-label="Delete entry">✕</button>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');

  $$('#log-list [data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this entry?')) return;
    await idbDel('sessions', b.dataset.del);
    await refresh();
    toast('Entry deleted');
  }));
}

/* ============================================================
   RENDER — STATS
   ============================================================ */
function renderStats() {
  drawWeeksChart();
  drawMonthsChart();

  const wrap = $('#stats-projects');
  const projs = activeProjects();
  if (!projs.length) { wrap.innerHTML = `<div class="empty">Stats appear once you have projects and logged time.</div>`; return; }

  const cw = weekWindow(0), lw = weekWindow(-1);
  wrap.innerHTML = `<div class="card">
    <div class="card-label">Per project — honest numbers</div>
    <table class="stat-table">
      <thead><tr><th>Project</th><th class="num">This wk</th><th class="num">Last wk</th><th class="num">4-wk avg</th><th class="num">All-time</th></tr></thead>
      <tbody>
      ${projs.map((p) => {
        const thisW = minutesInRange(p.id, cw.from, cw.to);
        const lastW = minutesInRange(p.id, lw.from, lw.to);
        const avg4 = minutesInRange(p.id, weekWindow(-4).from, weekWindow(-1).to) / 4;
        const all = totalMinutes(p.id);
        const cons = consistency(p);
        return `<tr>
          <td>${esc(p.name)}<br><span class="consist">${cons}</span></td>
          <td class="num">${fmtHours(thisW)}</td>
          <td class="num">${fmtHours(lastW)}</td>
          <td class="num">${fmtHours(avg4)}</td>
          <td class="num">${fmtHours(all)}h</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>
    <p class="hint" style="margin-top:10px">Hours per column unless marked. 4-wk avg covers the four most recent full weeks.</p>
  </div>`;
}

function consistency(p) {
  // % of full weeks (since creation, max 12) that met target — only for weekly kinds
  if (p.kind === 'deadline') {
    const last = lastSessionDate(p.id);
    return last ? `Last session ${niceDate(last).toLowerCase()}` : 'No sessions yet';
  }
  const created = startOfWeek(new Date(p.createdAt || Date.now()));
  let met = 0, total = 0;
  for (let i = 1; i <= 12; i++) {
    const w = weekWindow(-i);
    if (w.mon < created) break;
    total++;
    if (p.kind === 'hours_week' && minutesInRange(p.id, w.from, w.to) >= p.hoursPerWeek * 60) met++;
    if (p.kind === 'sessions_week' && sessionsInRange(p.id, w.from, w.to).length >= p.sessionsPerWeek) met++;
  }
  if (!total) return 'First week';
  return `${met}/${total} full weeks hit target`;
}

/* charts — plain canvas, DPR-aware */
function setupCanvas(cv, cssH) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || cv.parentElement.clientWidth - 32;
  cv.width = w * dpr; cv.height = cssH * dpr;
  cv.style.height = cssH + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: cssH };
}
function barChart(cv, labels, values, accent) {
  const { ctx, w, h } = setupCanvas(cv, 180);
  ctx.clearRect(0, 0, w, h);
  const padB = 24, padT = 18, padL = 4, padR = 4;
  const max = Math.max(1, ...values);
  const n = values.length;
  const gap = 6;
  const bw = (w - padL - padR - gap * (n - 1)) / n;
  const css = getComputedStyle(document.documentElement);
  const cHai = css.getPropertyValue('--hai').trim();
  const cKei = css.getPropertyValue('--kei').trim();

  ctx.strokeStyle = cKei; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, h - padB + .5); ctx.lineTo(w - padR, h - padB + .5); ctx.stroke();

  ctx.textAlign = 'center';
  values.forEach((v, i) => {
    const x = padL + i * (bw + gap);
    const bh = Math.max(v > 0 ? 2 : 0, ((h - padB - padT) * v) / max);
    ctx.fillStyle = accent;
    if (v > 0) {
      roundRect(ctx, x, h - padB - bh, bw, bh, 2);
      ctx.fill();
      if (bw > 20) {
        ctx.fillStyle = cHai; ctx.font = '10px ' + css.getPropertyValue('--mono');
        ctx.fillText(v % 1 === 0 ? v : v.toFixed(1), x + bw / 2, h - padB - bh - 5);
      }
    }
    ctx.fillStyle = cHai; ctx.font = '9.5px ' + css.getPropertyValue('--sans');
    ctx.fillText(labels[i], x + bw / 2, h - 8);
  });
}
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, 0);
  ctx.arcTo(x, y + h, x, y, 0);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawWeeksChart() {
  const labels = [], values = [];
  for (let i = 11; i >= 0; i--) {
    const w = weekWindow(-i);
    labels.push(w.mon.getDate() + '/' + (w.mon.getMonth() + 1));
    let m = 0;
    for (const p of S.projects) m += minutesInRange(p.id, w.from, w.to);
    values.push(+(m / 60).toFixed(1));
  }
  barChart($('#chart-weeks'), labels, values, getComputedStyle(document.documentElement).getPropertyValue('--moegi').trim());
}
function drawMonthsChart() {
  const labels = [], values = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const from = ymd(d);
    const to = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    labels.push(d.toLocaleDateString(undefined, { month: 'short' }));
    let m = 0;
    for (const p of S.projects) m += minutesInRange(p.id, from, to);
    values.push(+(m / 60).toFixed(1));
  }
  barChart($('#chart-months'), labels, values, getComputedStyle(document.documentElement).getPropertyValue('--ai').trim());
}

/* ============================================================
   MODALS & FORMS
   ============================================================ */
function openModal(title, bodyHTML) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  $('#overlay').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('#overlay').hidden = true;
  document.body.style.overflow = '';
}

/* — project form (create / edit) — */
function openProjectForm(pid) {
  const p = pid ? projById(pid) : null;
  const kind = p ? p.kind : 'hours_week';
  const blocks = p ? S.blocks.filter((b) => b.projectId === p.id) : [];

  openModal(p ? 'Edit project' : 'New project', `
    <div class="field">
      <label for="f-name">Name</label>
      <input type="text" id="f-name" maxlength="60" placeholder="e.g. Guitar practice" value="${p ? esc(p.name) : ''}">
    </div>
    <div class="field">
      <label>Commitment type</label>
      <div class="seg" id="f-kind">
        <button data-k="hours_week" class="${kind === 'hours_week' ? 'active' : ''}">Hours / week</button>
        <button data-k="sessions_week" class="${kind === 'sessions_week' ? 'active' : ''}">Sessions / week</button>
        <button data-k="deadline" class="${kind === 'deadline' ? 'active' : ''}">Deadline</button>
      </div>
    </div>
    <div id="f-kind-fields"></div>
    <div class="field">
      <label>Planned time blocks <span style="text-transform:none;letter-spacing:0">(optional)</span></label>
      <div class="blocks-editor" id="f-blocks"></div>
      <button class="btn btn-sm" id="f-add-block" type="button">＋ Add block</button>
      <p class="hint">A block is a standing slot in your week, e.g. Tue 18:00 for 60 min. Shown on Today.</p>
    </div>
    <div class="modal-foot">
      ${p ? `<button class="btn btn-danger" id="f-archive">${'Archive'}</button>` : ''}
      <button class="btn btn-primary" id="f-save">${p ? 'Save changes' : 'Create project'}</button>
    </div>
  `);

  let curKind = kind;
  const kindFields = () => {
    $('#f-kind-fields').innerHTML =
      curKind === 'hours_week' ? `
        <div class="field"><label for="f-hpw">Target hours per week</label>
        <input type="number" id="f-hpw" min="0.5" step="0.5" inputmode="decimal" value="${p && p.hoursPerWeek ? p.hoursPerWeek : 5}"></div>`
      : curKind === 'sessions_week' ? `
        <div class="field"><label for="f-spw">Target sessions per week</label>
        <input type="number" id="f-spw" min="1" step="1" inputmode="numeric" value="${p && p.sessionsPerWeek ? p.sessionsPerWeek : 3}"></div>`
      : `
        <div class="field-row">
          <div class="field"><label for="f-total">Total hours</label>
          <input type="number" id="f-total" min="1" step="1" inputmode="decimal" value="${p && p.totalHours ? p.totalHours : 100}"></div>
          <div class="field"><label for="f-deadline">Deadline</label>
          <input type="date" id="f-deadline" value="${p && p.deadline ? p.deadline : ymd(addDays(new Date(), 90))}"></div>
        </div>
        <p class="hint">Keizoku derives the weekly rate you need and tracks your trailing pace against it.</p>`;
  };
  kindFields();
  $$('#f-kind button').forEach((b) => b.addEventListener('click', () => {
    curKind = b.dataset.k;
    $$('#f-kind button').forEach((x) => x.classList.toggle('active', x === b));
    kindFields();
  }));

  /* blocks editor */
  const bWrap = $('#f-blocks');
  const blockRow = (b = { day: 0, start: '18:00', minutes: 60 }) => {
    const row = document.createElement('div');
    row.className = 'block-row';
    row.innerHTML = `
      <select class="b-day">${DOW.map((d, i) => `<option value="${i}" ${i === b.day ? 'selected' : ''}>${d}</option>`).join('')}</select>
      <input type="time" class="b-time" value="${b.start}">
      <input type="number" class="b-min" min="5" step="5" value="${b.minutes}" aria-label="Minutes">
      <span class="hint">min</span>
      <button class="iconbtn" type="button" aria-label="Remove block">✕</button>`;
    row.querySelector('.iconbtn').addEventListener('click', () => row.remove());
    bWrap.appendChild(row);
  };
  blocks.forEach(blockRow);
  $('#f-add-block').addEventListener('click', () => blockRow());

  if (p) $('#f-archive').addEventListener('click', async () => {
    if (!confirm(`Archive “${p.name}”? Its history stays in your log and stats.`)) return;
    p.archived = true;
    await idbPut('projects', p);
    closeModal(); await refresh(); toast('Archived');
  });

  $('#f-save').addEventListener('click', async () => {
    const name = $('#f-name').value.trim();
    if (!name) { toast('Give it a name'); return; }
    const rec = p || { id: uid(), createdAt: new Date().toISOString(), archived: false };
    rec.name = name;
    rec.kind = curKind;
    if (curKind === 'hours_week') {
      rec.hoursPerWeek = Math.max(0.5, parseFloat($('#f-hpw').value) || 0);
      if (!rec.hoursPerWeek) { toast('Set a weekly hours target'); return; }
    } else if (curKind === 'sessions_week') {
      rec.sessionsPerWeek = Math.max(1, parseInt($('#f-spw').value) || 0);
      if (!rec.sessionsPerWeek) { toast('Set a weekly sessions target'); return; }
    } else {
      rec.totalHours = Math.max(1, parseFloat($('#f-total').value) || 0);
      rec.deadline = $('#f-deadline').value;
      if (!rec.deadline) { toast('Pick a deadline'); return; }
    }
    await idbPut('projects', rec);

    /* rewrite blocks for this project */
    for (const b of S.blocks.filter((b) => b.projectId === rec.id)) await idbDel('blocks', b.id);
    for (const row of $$('.block-row', bWrap)) {
      const day = parseInt(row.querySelector('.b-day').value);
      const start = row.querySelector('.b-time').value || '18:00';
      const minutes = Math.max(5, parseInt(row.querySelector('.b-min').value) || 60);
      await idbPut('blocks', { id: uid(), projectId: rec.id, day, start, minutes });
    }
    closeModal(); await refresh(); toast(p ? 'Saved' : 'Project created');
  });
}

/* — routine form — */
function openRoutineForm(rid) {
  const r = rid ? S.routines.find((x) => x.id === rid) : null;
  const days = r ? [...r.days] : [0, 1, 2, 3, 4, 5, 6];
  openModal(r ? 'Edit routine' : 'New routine', `
    <div class="field">
      <label for="r-name">Name</label>
      <input type="text" id="r-name" maxlength="60" placeholder="e.g. Mobility work" value="${r ? esc(r.name) : ''}">
    </div>
    <div class="field">
      <label>Days</label>
      <div class="daypick" id="r-days">
        ${DOW.map((d, i) => `<button type="button" data-d="${i}" class="${days.includes(i) ? 'active' : ''}">${d[0]}</button>`).join('')}
      </div>
    </div>
    <div class="modal-foot">
      ${r ? `<button class="btn btn-danger" id="r-delete">Delete</button>` : ''}
      <button class="btn btn-primary" id="r-save">${r ? 'Save' : 'Create routine'}</button>
    </div>
  `);
  $$('#r-days button').forEach((b) => b.addEventListener('click', () => {
    const d = +b.dataset.d;
    if (days.includes(d)) days.splice(days.indexOf(d), 1); else days.push(d);
    b.classList.toggle('active');
  }));
  if (r) $('#r-delete').addEventListener('click', async () => {
    if (!confirm(`Delete “${r.name}” and its history?`)) return;
    await idbDel('routines', r.id);
    for (const c of S.checks.filter((c) => c.routineId === r.id)) await idbDel('checks', c.id);
    closeModal(); await refresh(); toast('Routine deleted');
  });
  $('#r-save').addEventListener('click', async () => {
    const name = $('#r-name').value.trim();
    if (!name) { toast('Give it a name'); return; }
    if (!days.length) { toast('Pick at least one day'); return; }
    days.sort((a, b) => a - b);
    await idbPut('routines', r ? { ...r, name, days } : { id: uid(), name, days, createdAt: new Date().toISOString(), archived: false });
    closeModal(); await refresh(); toast('Saved');
  });
}

/* — manual session form — */
function openSessionForm(pid) {
  const projs = activeProjects();
  if (!projs.length) { toast('Create a project first'); return; }
  openModal('Log time', `
    <div class="field">
      <label for="s-proj">Project</label>
      <select id="s-proj">${projs.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    </div>
    <div class="field-row">
      <div class="field"><label for="s-min">Minutes</label>
        <input type="number" id="s-min" min="1" step="1" inputmode="numeric" value="30"></div>
      <div class="field"><label for="s-date">Date</label>
        <input type="date" id="s-date" value="${today()}" max="${today()}"></div>
    </div>
    <div class="field">
      <label for="s-note">Note <span style="text-transform:none;letter-spacing:0">(optional)</span></label>
      <input type="text" id="s-note" maxlength="120" placeholder="What you worked on">
    </div>
    <div class="modal-foot">
      <button class="btn btn-primary" id="s-save">Save entry</button>
    </div>
  `);
  $('#s-min').focus();
  $('#s-save').addEventListener('click', async () => {
    const minutes = Math.max(1, parseInt($('#s-min').value) || 0);
    if (!minutes) { toast('Enter minutes'); return; }
    const date = $('#s-date').value || today();
    if (date > today()) { toast('No logging the future'); return; }
    await idbPut('sessions', {
      id: uid(), projectId: $('#s-proj').value, date, minutes,
      note: $('#s-note').value.trim(), source: 'manual', createdAt: new Date().toISOString()
    });
    closeModal(); await refresh(); toast(`Logged ${fmtMin(minutes)}`);
  });
}

/* — settings — */
function openSettings() {
  openModal('Settings', `
    <div class="card" style="margin-bottom:12px">
      <div class="card-label">Data</div>
      <p class="hint" style="margin-bottom:12px">Everything lives on this device in IndexedDB. Nothing is sent anywhere. Export regularly if the history matters to you.</p>
      <div class="btn-row">
        <button class="btn" id="set-export">Export JSON</button>
        <button class="btn" id="set-import">Import JSON</button>
        <input type="file" id="set-file" accept="application/json" hidden>
      </div>
    </div>
    <div class="card danger-zone">
      <div class="card-label">Danger zone</div>
      <button class="btn btn-danger" id="set-wipe">Erase all data</button>
    </div>
    <p class="hint" style="margin-top:16px;text-align:center">KEIZOKU 継続 · v1 · 継続は力なり — continuity is power</p>
  `);

  $('#set-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...S }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `keizoku-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#set-import').addEventListener('click', () => $('#set-file').click());
  $('#set-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.projects || !data.sessions) throw new Error('bad shape');
      if (!confirm('Import replaces everything currently on this device. Continue?')) return;
      for (const st of ['projects', 'sessions', 'routines', 'checks', 'blocks']) {
        await idbClear(st);
        for (const rec of data[st] || []) await idbPut(st, rec);
      }
      closeModal(); await refresh(); toast('Import complete');
    } catch {
      toast('That file is not a Keizoku backup');
    }
  });
  $('#set-wipe').addEventListener('click', async () => {
    if (!confirm('Erase every project, session, routine and block on this device?')) return;
    if (!confirm('Last check — this cannot be undone.')) return;
    for (const st of ['projects', 'sessions', 'routines', 'checks', 'blocks']) await idbClear(st);
    setTimer(null);
    closeModal(); await refresh(); toast('All data erased');
  });
}

/* ============================================================
   NAV / SHELL
   ============================================================ */
function switchView(name) {
  currentView = name;
  localStorage.setItem('keizoku.view', name);
  $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  renderView();
  window.scrollTo({ top: 0 });
}
function renderView() {
  if (currentView === 'today') renderToday();
  else if (currentView === 'projects') renderProjects();
  else if (currentView === 'stats') renderStats();
  else if (currentView === 'log') renderLog();
}
async function refresh() {
  await loadAll();
  renderView();
  renderTimerBar();
}

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), 2200);
}

/* install prompt */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#btn-install').hidden = false;
});
$('#btn-install').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#btn-install').hidden = true;
});

/* wire shell */
$$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-add-project').addEventListener('click', () => openProjectForm());
$('#btn-add-routine').addEventListener('click', () => openRoutineForm());
$('#btn-add-session').addEventListener('click', () => openSessionForm());
$('#btn-timer-stop').addEventListener('click', () => stopTimer(true));
$('#btn-timer-discard').addEventListener('click', () => {
  if (confirm('Discard this timed session?')) stopTimer(false);
});
$('#modal-close').addEventListener('click', closeModal);
$('#overlay').addEventListener('click', (e) => { if (e.target === $('#overlay')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#overlay').hidden) closeModal(); });

/* re-render charts on resize (debounced) */
let rzT;
window.addEventListener('resize', () => {
  clearTimeout(rzT);
  rzT = setTimeout(() => { if (currentView === 'stats') renderStats(); }, 200);
});

/* midnight / focus rollover */
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

/* boot */
(async function init() {
  await openDB();
  await loadAll();
  switchView(currentView);
  renderTimerBar();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
