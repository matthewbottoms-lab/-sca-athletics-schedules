import { mondayFor, dayOffset, weekDays, niceDate, processSchedules, fingerprint, clock } from './logic.js';
import { STORAGE_KEY, readApprovals, storageAvailable, saveApproval, reconcileWeek } from './approvals.js';

const $ = id => document.getElementById(id);
let monday = mondayFor();
let selected = dayOffset(monday, 0);
let mode = 'week';
let filter = 'all';
let model = { events:[], issues:[] };
let approved = new Set();
let lastFetched = '';
let loading = false;
const canSave = storageAvailable(localStorage);
approved = new Set(readApprovals(localStorage).map(x => x.id));

function el(tag, classes, text) {
  const x = document.createElement(tag);
  if (classes) x.className = classes;
  if (text !== undefined) x.textContent = String(text);
  return x;
}
function formatWeek() { return `${niceDate(monday,{month:'short',day:'numeric'})} – ${niceDate(dayOffset(monday,6),{month:'short',day:'numeric',year:'numeric'})}`; }
function visible(e) { return filter === 'all' || e.group === filter; }
function currentIssues() { return model.issues.filter(issue => !approved.has(issue.id) && (filter === 'all' || issue.group === filter || issue.group === 'Other')); }
function setNotice(text) { $('notice').textContent = text; $('notice').hidden = !text; }

async function load() {
  if (loading) return;
  loading = true;
  $('refresh').disabled = true;
  setNotice('');
  try {
    const ts = Date.now();
    // GitHub Pages already publishes these three files at the site root.
    const paths = ['../facilities.json','../transportation.json','../status.json'];
    const responses = await Promise.all(paths.map(p => fetch(`${p}?v=${ts}`, {cache:'no-store'})));
    if (responses.some(r => !r.ok)) throw Error('One or more published schedule files could not be downloaded');
    const [fac, tran, status] = await Promise.all(responses.map(r => r.json()));
    model = processSchedules(fac, tran, monday);
    model.issues = await Promise.all(model.issues.map(async issue => ({...issue, id:await fingerprint(issue.signature)})));
    // Only clear an old approval when a successful schedule check shows that exact issue is gone.
    approved = reconcileWeek(localStorage, monday, new Set(model.issues.map(issue => issue.id)));
    lastFetched = status.fetchedAt || fac.fetchedAt || '';
    const notices = [];
    if (status.schedules?.some(s => !s.ok)) notices.push('A source schedule did not refresh successfully. Published information could be outdated.');
    const age = Date.now() - new Date(lastFetched).getTime();
    const stale = !Number.isFinite(age) || age < 0 || age > 90 * 60000;
    $('freshness').textContent = stale ? '⚠ Schedule data may be outdated' : `Updated ${new Date(lastFetched).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`;
    $('freshness').classList.toggle('stale',stale);
    if (stale) notices.push('No successful schedule refresh reported in the past 90 minutes.');
    if (!canSave) notices.push('This browser is preventing local approval storage. Your exceptions cannot be saved until device storage is available.');
    setNotice(notices.join(' '));
  } catch (err) {
    setNotice(`Could not load schedules: ${err.message}. Previously loaded events are still shown, if available.`);
    $('freshness').textContent = 'Refresh unavailable';
    $('freshness').classList.add('stale');
  } finally {
    loading = false;
    $('refresh').disabled = false;
    render();
  }
}
function render() {
  $('weekLabel').textContent = formatWeek();
  const events = model.events.filter(visible);
  const issues = currentIssues();
  const stats = [['Games',events.filter(e => e.type === 'game' && e.source === 'transportation').length],['Practices',events.filter(e => e.type === 'practice').length],['Potential issues',issues.length]];
  $('stats').replaceChildren(...stats.map(([label,value]) => {
    const card = el('div','stat'); card.append(el('div','stat-number',value),el('div','stat-label',label)); return card;
  }));
  $('issueCounter').textContent = issues.length ? `(${issues.length})` : '';
  $('weekView').hidden = mode !== 'week';
  $('issuesView').hidden = mode !== 'issues';
  $('weekTab').classList.toggle('active',mode === 'week');
  $('issuesTab').classList.toggle('active',mode === 'issues');
  $('weekTab').setAttribute('aria-selected',String(mode === 'week'));
  $('issuesTab').setAttribute('aria-selected',String(mode === 'issues'));
  $('approvalStatus').textContent = canSave ? 'Exceptions saved only in this browser · not shared with other devices' : 'Local approvals unavailable in this browser';
  renderDays(events,issues);
  renderIssues(issues);
}
function renderDays(events,issues) {
  const days = weekDays(monday);
  $('days').replaceChildren(...days.map((date,i) => {
    const list = events.filter(e => e.date === date), count = issues.filter(issue => issue.date === date).length;
    const btn = el('button',`day ${selected === date ? 'selected' : ''} ${count ? 'has-issues' : ''}`);
    btn.setAttribute('aria-pressed',String(selected === date));
    btn.append(el('div','day-name',['MON','TUE','WED','THU','FRI','SAT','SUN'][i]),el('div','day-number',new Date(`${date}T12:00:00`).getDate()),el('div','day-count',count ? `${count} to review` : `${list.length} items`));
    btn.onclick = () => { selected=date; render(); };
    return btn;
  }));
  const container = $('dayDetails'); container.replaceChildren();
  const list = events.filter(e => e.date === selected);
  const head = el('div','day-header');
  head.append(el('h2','',niceDate(selected,{weekday:'long',month:'long',day:'numeric'})),el('span','count',`${list.length} calendar items`));
  container.append(head);
  if (!list.length) {container.append(el('div','empty','Nothing found for this day in the published schedules.'));return;}
  const wrap = el('div','event-list');
  for (const e of list) {
    const card = el('article',`event ${e.type}`), marker = el('span','marker'), body = el('div','body');
    body.append(el('div','name',e.team),el('div','description',e.detail || 'No details'));
    const meta = el('div','meta');
    for (const item of [e.type === 'note' ? 'Facility note' : e.type[0].toUpperCase() + e.type.slice(1), e.location, e.side === 'A' ? 'Away' : e.side === 'H' ? 'Home' : '', e.source === 'facilities' ? 'Facilities' : 'Transportation']) {
      if (item) meta.append(el('span','tag',item));
    }
    if (e.source === 'transportation') {
      if (e.dismissal) meta.append(el('span','tag',`Dismissal: ${e.dismissal}`));
      if (e.transport) meta.append(el('span','tag',`Transport: ${e.transport}`));
    }
    body.append(meta);
    const when = el('div','when',e.source === 'transportation' ? (e.time || 'Time TBD') : e.start == null ? '' : clock(e.start));
    card.append(marker,body,when); wrap.append(card);
  }
  container.append(wrap);
}
function renderIssues(active) {
  const wrap = $('issuesList');wrap.replaceChildren();
  if (!active.length) wrap.append(el('div','empty','No active potential issues found for this week.'));
  for (const issue of active) {
    const card = el('article','issue-card');
    card.append(el('div','issue-date',niceDate(issue.date)),el('div','issue-title',issue.title),el('p','issue-body',issue.details));
    const btn = el('button','approve','✓ Approve on this device');
    btn.disabled = !canSave;
    btn.onclick = () => setApproval(issue.id,true);
    card.append(btn);wrap.append(card);
  }
  const hidden = model.issues.filter(i => approved.has(i.id));
  if (hidden.length) {
    const details = el('details','approved-panel'), summary = el('summary','',`Approved on this device (${hidden.length})`);
    details.append(summary);
    for (const issue of hidden) {
      const item = el('div','approved-item'), text = el('div','',niceDate(issue.date)+' · '+issue.title), btn = el('button','reopen','Reopen');
      btn.disabled = !canSave;
      btn.onclick = () => setApproval(issue.id,false);
      item.append(text,btn); details.append(item);
    }
    wrap.append(details);
  }
}
function setApproval(id,approve) {
  if (!canSave || !saveApproval(localStorage,id,monday,approve)) {
    setNotice('This device could not save the change. Check Safari settings and available local storage.');
    return;
  }
  if (approve) approved.add(id); else approved.delete(id);
  setNotice('');
  render();
}
function setMode(value) {mode=value;render();}
$('weekTab').onclick = () => setMode('week');
$('issuesTab').onclick = () => setMode('issues');
$('filter').onchange = e => {filter=e.target.value;render();};
$('prev').onclick = () => shift(-7);
$('next').onclick = () => shift(7);
$('todayBtn').onclick = () => {monday=mondayFor();selected=monday;load();};
$('refresh').onclick = () => load();
function shift(days) { monday=dayOffset(monday,days);selected=monday;load(); }
window.addEventListener('storage',e => {
  if (e.key === STORAGE_KEY) {approved=new Set(readApprovals(localStorage).map(x=>x.id));render();}
});
load();
setInterval(() => load(),5 * 60 * 1000);
