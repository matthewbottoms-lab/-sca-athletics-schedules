import { mondayFor, dayOffset, weekDays, niceDate, processSchedules, fingerprint, clock } from './logic.js';
import { STORAGE_KEY, readApprovals, storageAvailable, saveApproval, reconcileWeek } from './approvals.js';

const $ = id => document.getElementById(id);
let monday = mondayFor();
let selected = dayOffset(monday, 0);
// This is a convenience-only public view, not an access-control mechanism.
// Coach links show schedule data only; AD links retain local issue approvals.
const isCoachView = new URLSearchParams(window.location.search).get('view') === 'coach';
document.body.classList.toggle('coach-view', isCoachView);
let mode = 'week';
let filter = 'all';
let model = { events:[], issues:[] };
let approved = new Set();
let lastFetched = '';
let loading = false;
const canSave = storageAvailable(localStorage);
approved = new Set(readApprovals(localStorage).map(x => x.id));

const viewSwitch = el('a', 'view-switch', isCoachView ? 'AD view' : 'Coach view ↗');
viewSwitch.href = isCoachView ? window.location.pathname : `${window.location.pathname}?view=coach`;
viewSwitch.setAttribute('aria-label', isCoachView ? 'Open Athletic Director view' : 'Open shareable coach schedule');
$('refresh').before(viewSwitch);
const brandSubtitle = document.querySelector('.brand-subtitle');
if (brandSubtitle) brandSubtitle.textContent = isCoachView ? 'Weekly coach schedule' : 'Weekly command center';
if (isCoachView) {
  $('issuesTab').hidden = true;
  $('issuesView').hidden = true;
  $('approvalStatus').hidden = true;
}

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
    if (!canSave && !isCoachView) notices.push('This browser is preventing local approval storage. Your exceptions cannot be saved until device storage is available.');
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
  const stats = [
    ['Games',events.filter(e => e.type === 'game').length],
    ['Practices',events.filter(e => e.type === 'practice').length],
    isCoachView ? ['Other activities',events.filter(e => !['game','practice'].includes(e.type)).length] : ['Potential issues',issues.length]
  ];
  $('stats').replaceChildren(...stats.map(([label,value]) => {
    const card = el('div','stat'); card.append(el('div','stat-number',value),el('div','stat-label',label)); return card;
  }));
  $('issueCounter').textContent = issues.length ? `(${issues.length})` : '';
  $('weekView').hidden = mode !== 'week';
  $('issuesView').hidden = isCoachView || mode !== 'issues';
  $('weekTab').classList.toggle('active',mode === 'week');
  $('issuesTab').classList.toggle('active',!isCoachView && mode === 'issues');
  $('weekTab').setAttribute('aria-selected',String(mode === 'week'));
  $('issuesTab').setAttribute('aria-selected',String(mode === 'issues'));
  if (!isCoachView) $('approvalStatus').textContent = canSave ? 'Exceptions saved only in this browser · not shared with other devices' : 'Local approvals unavailable in this browser';
  renderDays(events,issues);
  if (!isCoachView) renderIssues(issues);
}
// Keep on-campus facility use separate from off-campus contests. A merged
// transportation/facility game retains its original gym/field location.
const ON_CAMPUS = /^(?:sca|scottsdale christian(?: academy)?|home)(?:\b|$)/i;
const INDOOR_SPORTS = /volleyball|basketball|wrestling|cheer|gymnastics/i;
function isAwayDescription(detail) {
  return /(?:^|[\s\n])(?:at\s+[a-z]|@\s*[a-z])/i.test(detail||'') &&
    !/(?:^|[\s\n])(?:at\s+sca|@\s*sca)\b/i.test(detail||'');
}
export function laneFor(e) {
  if (e.side === 'A') return 'away';
  if (e.source === 'facilities') {
    if (e.type !== 'note' && isAwayDescription(e.detail)) return 'away';
    return e.location === 'Gym' ? 'gym' : 'field';
  }
  if (e.source === 'transportation') {
    if (e.location && !ON_CAMPUS.test(e.location)) return 'away';
    if (e.facilityLocation === 'Gym') return 'gym';
    if (e.facilityLocation === 'Field') return 'field';
    return INDOOR_SPORTS.test(e.team) ? 'gym' : 'field';
  }
  return e.location === 'Gym' ? 'gym' : 'field';
}
const LANES = [
  {id:'field',name:'Field & Outdoor',icon:'◌',hint:'On-campus outdoor activities'},
  {id:'gym',name:'Gym & Indoor',icon:'▤',hint:'On-campus gym activities'},
  {id:'away',name:'Away Games & Transportation',icon:'↗',hint:'Off-campus events and travel'}
];
function eventCard(e) {
  const card=el('article',`event ${e.type}`), body=el('div','body');
  card.append(el('span','marker'));
  const isAway=laneFor(e)==='away';
  const when=el('div','when',e.source==='transportation' ? (e.time || (e.start!==null?clock(e.start):'TBD')) : (e.start==null?'TBD':clock(e.start)));
  const description = e.detail || 'No details';
  body.append(el('div','name',e.team),el('div','description',description));
  const meta=el('div','meta');
  const label=e.type==='note'?'Facility note':e.type[0].toUpperCase()+e.type.slice(1);
  meta.append(el('span','tag',label));
  if (e.source==='transportation') {
    if (!isAway && e.facilityLocation) meta.append(el('span','tag',e.facilityLocation));
    if (isAway && e.location && !/Venue TBD/i.test(e.location)) meta.append(el('span','tag',e.location));
    if (e.dismissal && !/^x$/i.test(e.dismissal)) meta.append(el('span','tag',`Dismissal: ${e.dismissal}`));
    if (e.transport && !/^x$/i.test(e.transport)) meta.append(el('span','tag',`Vehicle: ${e.transport}`));
  }
  body.append(meta);
  card.append(body,when);
  return card;
}
function renderDays(events,issues) {
  const days=weekDays(monday);
  $('days').replaceChildren(...days.map((date,i)=>{
    const list=events.filter(e=>e.date===date);
    const count=isCoachView?0:issues.filter(issue=>issue.date===date).length;
    const btn=el('button',`day ${selected===date?'selected':''} ${count?'has-issues':''}`);
    btn.setAttribute('aria-pressed',String(selected===date));
    btn.append(el('div','day-name',['MON','TUE','WED','THU','FRI','SAT','SUN'][i]),
               el('div','day-number',new Date(`${date}T12:00:00`).getDate()),
               el('div','day-count',count?`${count} to review`:`${list.length} items`));
    btn.onclick=()=>{selected=date;render();};
    return btn;
  }));
  const container=$('dayDetails');container.replaceChildren();
  const list=events.filter(e=>e.date===selected);
  const head=el('div','day-header');
  head.append(el('h2','',niceDate(selected,{weekday:'long',month:'long',day:'numeric'})),
              el('span','count',`${list.length} calendar items`));
  container.append(head);
  if (!list.length) {
    container.append(el('div','empty','Nothing found for this day in the published schedules.'));
    return;
  }
  const grid=el('div','facility-grid');
  for (const lane of LANES) {
    const entries=list.filter(e=>laneFor(e)===lane.id).sort((a,b)=>
      (a.start??Number.POSITIVE_INFINITY)-(b.start??Number.POSITIVE_INFINITY)||a.team.localeCompare(b.team));
    const section=el('section',`facility-lane lane-${lane.id}`);
    const title=el('div','lane-title');
    const label=el('div','lane-label');
    label.append(el('span','lane-icon',lane.icon),el('h3','',lane.name));
    title.append(label,el('span','lane-count',`${entries.length} ${entries.length===1?'item':'items'}`));
    section.append(title);
    const items=el('div','lane-items');
    if (entries.length) items.append(...entries.map(eventCard));
    else items.append(el('div','lane-empty','Nothing scheduled'));
    section.append(items);
    grid.append(section);
  }
  container.append(grid);
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
function setMode(value) {mode=isCoachView?'week':value;render();}
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
