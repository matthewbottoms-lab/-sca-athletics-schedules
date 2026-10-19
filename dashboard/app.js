import { mondayFor, dayOffset, weekDays, niceDate, processSchedules, fingerprint, clock, parseRanges } from './logic.js';
import { STORAGE_KEY, readApprovals, storageAvailable, saveApproval, reconcileWeek } from './approvals.js';

const $ = id => document.getElementById(id);
const todayIso = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
let monday=mondayFor();
let selected=todayIso();
let followToday=true; // automatically advance the live Today view across midnight
// A public coach link is a simplified view, not security / authentication.
const isCoachView=new URLSearchParams(window.location.search).get('view')==='coach';
document.body.classList.toggle('coach-view',isCoachView);
// Keep a coach's Home Screen shortcut in coach mode.
if(isCoachView){const manifest=document.querySelector('link[rel="manifest"]');if(manifest)manifest.href='./coach.webmanifest';}
let mode=isCoachView?'week':'overview';
let filter='all';
let model={events:[],issues:[]};
let approved=new Set();
let lastFetched='';
let loading=false;
const canSave=storageAvailable(localStorage);
approved=new Set(readApprovals(localStorage).map(x=>x.id));

function el(tag,classes,text){const n=document.createElement(tag);if(classes)n.className=classes;if(text!==undefined)n.textContent=String(text);return n;}
const viewSwitch=el('a','view-switch',isCoachView?'AD view':'Coach view ↗');
viewSwitch.href=isCoachView?window.location.pathname:`${window.location.pathname}?view=coach`;
viewSwitch.setAttribute('aria-label',isCoachView?'Open AD dashboard':'Open shareable coach schedule');
document.querySelector('.header-actions').prepend(viewSwitch);
const subtitle=document.querySelector('.brand-subtitle');
if(subtitle)subtitle.textContent=isCoachView?'Coach schedules':'AD Command Center';
if(isCoachView){$('overviewTab').hidden=true;$('issuesTab').hidden=true;$('approvalStatus').hidden=true;}

function formatWeek(){return `${niceDate(monday,{month:'short',day:'numeric'})} – ${niceDate(dayOffset(monday,6),{month:'short',day:'numeric',year:'numeric'})}`;}
function visible(e){return filter==='all'||e.group===filter;}
function currentIssues(){return model.issues.filter(i=>!approved.has(i.id)&&(filter==='all'||i.group===filter||i.group==='Other'));}
function setNotice(text){$('notice').textContent=text;$('notice').hidden=!text;}
function weekHasDay(date){return weekDays(monday).includes(date);}
async function load(){
  if(loading)return;
  loading=true;$('refresh').disabled=true;setNotice('');
  try{
    const ts=Date.now();
    const paths=['../facilities.json','../transportation.json','../status.json'];
    const responses=await Promise.all(paths.map(p=>fetch(`${p}?v=${ts}`,{cache:'no-store'})));
    if(responses.some(r=>!r.ok))throw Error('One or more published schedule files could not be downloaded');
    const [fac,tran,status]=await Promise.all(responses.map(r=>r.json()));
    model=processSchedules(fac,tran,monday);
    model.issues=await Promise.all(model.issues.map(async issue=>({...issue,id:await fingerprint(issue.signature)})));
    approved=reconcileWeek(localStorage,monday,new Set(model.issues.map(issue=>issue.id)));
    lastFetched=status.fetchedAt||fac.fetchedAt||'';
    const notices=[];
    if(status.schedules?.some(s=>!s.ok))notices.push('A source schedule did not refresh successfully. Published information could be outdated.');
    const age=Date.now()-new Date(lastFetched).getTime();
    const stale=!Number.isFinite(age)||age<0||age>90*60000;
    $('freshness').textContent=stale?'⚠ Schedule data may be outdated':`Updated ${new Date(lastFetched).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`;
    $('freshness').classList.toggle('stale',stale);
    if(stale)notices.push('No successful schedule refresh reported in the past 90 minutes.');
    if(!canSave&&!isCoachView)notices.push('Local approval storage unavailable in this browser.');
    setNotice(notices.join(' '));
  }catch(err){
    setNotice(`Could not load schedules: ${err.message}. Previously loaded events are still shown, if available.`);
    $('freshness').textContent='Refresh unavailable';$('freshness').classList.add('stale');
  }finally{loading=false;$('refresh').disabled=false;render();}
}

// Preserve the existing lane classification, including the source's inferred
// home-game sport lane. Off-campus events never reserve an on-campus facility.
const ON_CAMPUS=/^(?:sca|scottsdale christian(?: academy)?|home)(?:\b|$)/i;
const INDOOR_SPORTS=/volleyball|basketball|wrestling|cheer|gymnastics/i;
function isAwayDescription(detail){return /(?:^|[\s\n])(?:at\s+[a-z]|@\s*[a-z])/i.test(detail||'')&&!/(?:^|[\s\n])(?:at\s+sca|@\s*sca)\b/i.test(detail||'');}
function laneFor(e){
  if(e.side==='A')return 'away';
  if(e.source==='facilities'){
    if(e.type!=='note'&&isAwayDescription(e.detail))return 'away';
    return e.location==='Gym'?'gym':'field';
  }
  if(e.source==='transportation'){
    if(e.location&&!ON_CAMPUS.test(e.location))return 'away';
    if(e.facilityLocation==='Gym')return 'gym';
    if(e.facilityLocation==='Field')return 'field';
    return INDOOR_SPORTS.test(e.team)?'gym':'field';
  }
  return e.location==='Gym'?'gym':'field';
}
const LANES=[
  {id:'field',name:'Field & Outdoor',icon:'◌'},
  {id:'gym',name:'Gym & Indoor',icon:'▤'},
  {id:'away',name:'Away Games & Transportation',icon:'↗'}
];
function sortEvents(events){return [...events].sort((a,b)=>(a.start??9999)-(b.start??9999)||a.team.localeCompare(b.team));}
function eventCard(e){
  const card=el('article',`event ${e.type}`),body=el('div','body');card.append(el('span','marker'));
  const away=laneFor(e)==='away';
  const time=e.source==='transportation'?(e.time||(e.start!=null?clock(e.start):'TBD')):(e.start==null?'TBD':clock(e.start));
  const when=el('div','when',time);
  body.append(el('div','name',e.team),el('div','description',e.detail||'No details'));
  const meta=el('div','meta');
  meta.append(el('span','tag',e.type==='note'?'Facility note':e.type[0].toUpperCase()+e.type.slice(1)));
  if(e.source==='transportation'){
    if(!away&&e.facilityLocation)meta.append(el('span','tag',e.facilityLocation));
    if(away&&e.location&&!/Venue TBD/i.test(e.location))meta.append(el('span','tag',e.location));
    if(e.dismissal&&!/^x$/i.test(e.dismissal))meta.append(el('span','tag',`Dismissal: ${e.dismissal}`));
    if(e.transport&&!/^x$/i.test(e.transport))meta.append(el('span','tag',`Vehicle: ${e.transport}`));
  }
  body.append(meta);card.append(body,when);return card;
}
function laneSection(lane,entries){
  const section=el('section',`facility-lane lane-${lane.id}`);
  const title=el('div','lane-title'),label=el('div','lane-label');
  label.append(el('span','lane-icon',lane.icon),el('h3','',lane.name));
  title.append(label,el('span','lane-count',`${entries.length} ${entries.length===1?'item':'items'}`));section.append(title);
  const items=el('div','lane-items');
  if(entries.length)items.append(...sortEvents(entries).map(eventCard));
  else items.append(el('div','lane-empty','Nothing scheduled'));
  section.append(items);return section;
}
function groupedGrid(list){const grid=el('div','facility-grid');for(const lane of LANES)grid.append(laneSection(lane,list.filter(e=>laneFor(e)===lane.id)));return grid;}
function dayStrip(target,events,issues){
  const dates=weekDays(monday);
  $(target).replaceChildren(...dates.map((date,i)=>{
    const count=!isCoachView?issues.filter(issue=>issue.date===date).length:0;
    const n=events.filter(e=>e.date===date).length;
    const b=el('button',`day ${selected===date?'selected':''} ${count?'has-issues':''}`);
    b.type='button';b.setAttribute('aria-pressed',String(selected===date));
    b.append(el('div','day-name',['MON','TUE','WED','THU','FRI','SAT','SUN'][i]),
             el('div','day-number',new Date(`${date}T12:00:00`).getDate()),
             el('div','day-count',count?`${count} to review`:`${n} items`));
    b.onclick=()=>{selected=date;followToday=false;render();};return b;
  }));
}
function dayHeading(date,count){const head=el('div','day-header');head.append(el('h2','',niceDate(date,{weekday:'long',month:'long',day:'numeric'})),el('span','count',`${count} calendar ${count===1?'item':'items'}`));return head;}
function renderWeek(events,issues){
  dayStrip('days',events,issues);
  const list=events.filter(e=>e.date===selected),container=$('dayDetails');container.replaceChildren(dayHeading(selected,list.length));
  if(!list.length)container.append(el('div','empty','Nothing found for this date in the published schedules.'));
  else container.append(groupedGrid(list));
}
function jumpTo(modeName){setMode(modeName);}
function renderOverview(events,issues){
  dayStrip('overviewDays',events,issues);
  const list=events.filter(e=>e.date===selected),activeIssues=issues.filter(e=>e.date===selected);
  const counts=LANES.map(lane=>list.filter(e=>laneFor(e)===lane.id).length);
  const container=$('overviewDetails');container.replaceChildren();
  const top=el('div','overview-top'),heading=el('div','');
  heading.append(el('h2','',selected===todayIso()?'Today at a Glance':'Daily Overview'),
    el('div','overview-sub',niceDate(selected,{weekday:'long',month:'long',day:'numeric',year:'numeric'})));
  top.append(heading);
  const timelineBtn=el('button','subtle-button','View timeline →');timelineBtn.onclick=()=>jumpTo('timeline');top.append(timelineBtn);container.append(top);
  const pills=el('div','overview-pills');
  for(const [value,label] of [[counts[0],'Field'],[counts[1],'Gym'],[counts[2],'Away'],[list.filter(e=>e.type==='game').length,'Games']]){
    const p=el('div','overview-pill');p.append(el('div','overview-value',value),el('div','overview-caption',label));pills.append(p);
  }
  container.append(pills);
  if(!isCoachView&&activeIssues.length){
    const alert=el('div','overview-alert');
    alert.append(el('span','',`${activeIssues.length} potential ${activeIssues.length===1?'issue needs':'issues need'} review`));
    const btn=el('button','','Review issues →');btn.onclick=()=>jumpTo('issues');alert.append(btn);container.append(alert);
  }
  const section=el('div','overview-section');section.append(el('h3','','Today’s schedule'.replace('Today',selected===todayIso()?'Today':'Selected day')));
  const openWeek=el('button','subtle-button','Full schedule →');openWeek.onclick=()=>jumpTo('week');section.append(openWeek);container.append(section);
  if(!list.length){container.append(el('div','empty','No events are listed for this day. Use Week to browse other dates.'));return;}
  const compact=el('div','facility-grid');
  for(const lane of LANES)compact.append(laneSection(lane,sortEvents(list.filter(e=>laneFor(e)===lane.id)).slice(0,4)));
  container.append(compact);
  if(counts.some(n=>n>4)){
    const action=el('div','overview-shortcut');const btn=el('button','subtle-button','See all events →');btn.onclick=()=>jumpTo('week');action.append(btn);container.append(action);
  }
}

// Use only actual stated time ranges to show occupied duration. A game
// with a single time is a dashed start marker, not a guessed game length.
function timelineEntries(e){
  let ranges=e.type==='note'?parseRanges(e.detail):Array.isArray(e.ranges)?e.ranges:[];
  if(e.source==='transportation'&&e.facilityDetail)ranges=parseRanges(e.facilityDetail);
  if(ranges.length)return ranges.filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.end>r.start).map(r=>({event:e,start:r.start,end:r.end,point:false}));
  if(e.type!=='note'&&e.start!=null&&Number.isFinite(e.start))return [{event:e,start:e.start,end:e.start,point:true}];
  return [];
}
function arrangeTracks(entries){
  const sorted=[...entries].sort((a,b)=>a.start-b.start||a.end-b.end);
  let groups=[],group=[],maxEnd=-1;
  for(const entry of sorted){
    const visualEnd=entry.point?entry.start+30:Math.max(entry.end,entry.start+18);
    const item={...entry,visualEnd};
    if(group.length&&entry.start>=maxEnd){groups.push(group);group=[];maxEnd=-1;}
    group.push(item);maxEnd=Math.max(maxEnd,visualEnd);
  }
  if(group.length)groups.push(group);
  for(const items of groups){
    const tracks=[];
    for(const item of items){
      let col=tracks.findIndex(end=>end<=item.start);
      if(col===-1){col=tracks.length;tracks.push(item.visualEnd);}else tracks[col]=item.visualEnd;
      item.col=col;
    }
    for(const item of items)item.columns=tracks.length;
  }
  return groups.flat();
}
function renderTimeline(events,issues){
  dayStrip('timelineDays',events,issues);
  const list=events.filter(e=>e.date===selected),container=$('timelineDetails');container.replaceChildren(dayHeading(selected,list.length));
  container.append(el('p','timeline-intro','The vertical scale shows actual facility time ranges. Dashed markers mean start time only; the end time is unknown. Away games are listed separately.'));
  const plotted={field:[],gym:[]},extras=[];
  for(const e of list){
    const lane=laneFor(e);
    if(lane==='away'){extras.push(e);continue;}
    const ranges=timelineEntries(e);
    if(ranges.length)plotted[lane].push(...ranges);
    // Notes remain readable below even when one of their stated ranges is plotted.
    if(!ranges.length||e.type==='note')extras.push(e);
  }
  const all=[...plotted.field,...plotted.gym];
  if(!all.length){container.append(el('div','empty','No timed on-campus facility activities found for this day.'));}
  else{
    const min=Math.min(...all.map(e=>e.start)),max=Math.max(...all.map(e=>e.point?e.start:e.end));
    const first=Math.max(0,Math.floor(min/60)*60-60);
    const last=Math.min(1440,Math.max(first+180,Math.ceil(max/60)*60+60));
    const height=(last-first)/60*60;
    const wrap=el('div','timeline-scroller');
    const head=el('div','timeline-head');head.append(el('div','','Time'),el('div','','◌ Field & Outdoor'),el('div','','▤ Gym & Indoor'));wrap.append(head);
    const body=el('div','timeline-main');body.style.height=`${height}px`;
    const axis=el('div','time-axis');
    for(let time=first;time<=last;time+=60){const mark=el('div','time-label',clock(time));mark.style.top=`${(time-first)}px`;axis.append(mark);}
    body.append(axis);
    for(const lane of ['field','gym']){
      const track=el('div',`time-track ${lane==='gym'?'gym-track':''}`);
      for(const item of arrangeTracks(plotted[lane])){
        const e=item.event,top=item.start-first;
        const block=el('div',`${item.point?'timeline-point':'timeline-bar'} ${e.type}`);
        block.style.top=`${top}px`;
        if(!item.point)block.style.height=`${Math.max(18,item.end-item.start)}px`;
        block.style.width=`calc(${100/item.columns}% - 8px)`;
        block.style.left=`calc(${item.col*100/item.columns}% + 4px)`;
        block.style.right='auto';
        const team=el('div','bar-title',e.type==='note'?(e.detail||e.team):e.team);
        const time=el('div','time-small',item.point?`${clock(item.start)} · start only`:`${clock(item.start)}–${clock(item.end)}`);
        block.append(team,time);block.title=`${e.team} — ${time.textContent}. ${e.detail||''}`;
        track.append(block);
      }
      body.append(track);
    }
    wrap.append(body);container.append(wrap);
    const legend=el('div','timeline-legend');legend.append(el('span','legend-block','Known time range'),el('span','legend-point','Start time only'));container.append(legend);
  }
  // Notes and no-time activities remain visible rather than being discarded.
  const away=extras.filter(e=>laneFor(e)==='away');
  const extraOnsite=extras.filter(e=>laneFor(e)!=='away');
  if(away.length||extraOnsite.length){
    const sections=el('div','timeline-extra');
    if(extraOnsite.length)sections.append(laneSection({id:'field',name:'Notes & Untimed Activities',icon:'≡'},extraOnsite));
    if(away.length)sections.append(laneSection({id:'away',name:'Away Games & Transportation',icon:'↗'},away));
    container.append(sections);
  }
}
function renderIssues(issues){
  const wrap=$('issuesList');wrap.replaceChildren();
  if(!issues.length)wrap.append(el('div','empty','No active potential issues found for this week.'));
  for(const issue of issues){
    const card=el('article','issue-card');
    card.append(el('div','issue-date',niceDate(issue.date)),el('div','issue-title',issue.title),el('p','issue-body',issue.details));
    const btn=el('button','approve','✓ Approve on this device');btn.disabled=!canSave;btn.onclick=()=>setApproval(issue.id,true);
    card.append(btn);wrap.append(card);
  }
  const hidden=model.issues.filter(i=>approved.has(i.id));
  if(hidden.length){
    const details=el('details','approved-panel'),summary=el('summary','',`Approved on this device (${hidden.length})`);details.append(summary);
    for(const issue of hidden){
      const item=el('div','approved-item'),t=el('span','',`${niceDate(issue.date)} · ${issue.title}`),btn=el('button','reopen','Reopen');
      btn.disabled=!canSave;btn.onclick=()=>setApproval(issue.id,false);item.append(t,btn);details.append(item);
    }
    wrap.append(details);
  }
}
function render(){
  $('weekLabel').textContent=formatWeek();
  const events=model.events.filter(visible),issues=currentIssues();
  const stats=[['Games',events.filter(e=>e.type==='game').length],['Practices',events.filter(e=>e.type==='practice').length],
    isCoachView?['Other activities',events.filter(e=>!['game','practice'].includes(e.type)).length]:['Potential issues',issues.length]];
  $('stats').replaceChildren(...stats.map(([label,value])=>{const box=el('div','stat');box.append(el('div','stat-number',value),el('div','stat-label',label));return box;}));
  $('issueCounter').textContent=issues.length?`(${issues.length})`:'';
  for(const name of ['overview','week','timeline','issues']){
    const allowed=!isCoachView||!['overview','issues'].includes(name);
    const active=allowed&&mode===name;
    $(`${name}View`).hidden=!active;
    const tab=$(`${name}Tab`);tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));
  }
  if(!isCoachView)$('approvalStatus').textContent=canSave?'Approvals saved only in this browser · never shared between devices':'Local approvals unavailable in this browser';
  if(mode==='overview'&&!isCoachView)renderOverview(events,issues);
  if(mode==='week')renderWeek(events,issues);
  if(mode==='timeline')renderTimeline(events,issues);
  if(mode==='issues'&&!isCoachView)renderIssues(issues);
}
function setMode(next){mode=isCoachView&&!['week','timeline'].includes(next)?'week':next;render();}
function setApproval(id,approve){
  if(!canSave||!saveApproval(localStorage,id,monday,approve)){setNotice('This device could not save the change. Check Safari storage.');return;}
  if(approve)approved.add(id);else approved.delete(id);
  setNotice('');render();
}
for(const name of ['overview','week','timeline','issues'])$(`${name}Tab`).onclick=()=>setMode(name);
$('filter').onchange=e=>{filter=e.target.value;render();};
function shift(n){followToday=false;monday=dayOffset(monday,n);selected=monday;load();}
$('prev').onclick=()=>shift(-7);
$('next').onclick=()=>shift(7);
$('todayBtn').onclick=()=>{followToday=true;monday=mondayFor();selected=todayIso();load();};
$('refresh').onclick=()=>load();
window.addEventListener('storage',e=>{if(e.key===STORAGE_KEY){approved=new Set(readApprovals(localStorage).map(x=>x.id));render();}});
load();
setInterval(()=>{
  if(followToday){monday=mondayFor();selected=todayIso();}
  load();
},5*60*1000);
