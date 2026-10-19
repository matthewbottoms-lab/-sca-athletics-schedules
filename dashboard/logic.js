// Pure calendar and validation logic. No spreadsheet or exception records are changed.
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const FACILITY_COLS = {
  Fall: {field:[1,2,3,4,5], gym:[8,9,10,11,12,13], fieldNotes:6, gymNotes:14, labels:1, firstRow:3},
  Winter: {field:[1,2,3,4,5,6], gym:[9,10,11,12,13], fieldNotes:7, gymNotes:14, labels:1, firstRow:3},
  Spring: {field:[1,2,3,4], gym:[7,8,9,10,11,12,13,14,15], fieldNotes:5, gymNotes:16, labels:0, firstRow:2},
  Summer: {field:[1,2], gym:[4], fieldNotes:3, gymNotes:5, labels:1, firstRow:3}
};
const blank = v => !String(v ?? '').trim();
const norm = v => String(v ?? '').replace(/\s+/g,' ').trim();
export function isoFromCell(value) {
  const v=norm(value);
  const m=v.match(/(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if(!m) return null;
  const month=MONTHS.indexOf(m[1].toLowerCase());
  if(month<0) return null;
  const day=Number(m[2]),year=Number(m[3]);
  const d=new Date(year,month,day,12);
  if(d.getFullYear()!==year||d.getMonth()!==month||d.getDate()!==day)return null;
  return `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
export function dayOffset(iso,n){const d=new Date(`${iso}T12:00:00`);d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
export function mondayFor(date=new Date()) { const d=new Date(date);d.setHours(12,0,0,0);const delta=(d.getDay()+6)%7;d.setDate(d.getDate()-delta);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function weekDays(monday){return Array.from({length:7},(_,i)=>dayOffset(monday,i));}
export function niceDate(iso,opts={weekday:'short',month:'short',day:'numeric'}){return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US',opts);}
const timePattern = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
function mins(hour,minute,ampm){hour=Number(hour);minute=Number(minute||0);if(hour<1||hour>12||minute>59)return null;return (hour%12)*60+minute+(ampm==='pm'?720:0);}
export function parseRanges(raw){
  const r=/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
  const result=[];let m;
  while((m=r.exec(String(raw||'')))!==null){
    const endM=(m[6]||m[3]||'pm').toLowerCase();
    let firstM=(m[3]||endM).toLowerCase();
    let start=mins(m[1],m[2],firstM),end=mins(m[4],m[5],endM);
    if(start!==null&&end!==null&&start>=end&&!m[3]) {
      const alt=firstM==='pm'?'am':'pm';const candidate=mins(m[1],m[2],alt);
      if(candidate!==null&&candidate<end){firstM=alt;start=candidate;}
    }
    if(start===null||end===null||start>=end||end-start>12*60)continue;
    result.push({start,end,label:m[0].replace(/\s+/g,'').toUpperCase()});
  }
  return result;
}
export function parseTime(raw){const m=String(raw||'').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);return m?mins(m[1],m[2],m[3].toLowerCase()):null;}
export function clock(n){if(n===null||n===undefined)return 'Time TBD';const h=Math.floor(n/60);return `${(h%12)||12}:${String(n%60).padStart(2,'0')}${h>=12?'pm':'am'}`;}
function isGame(s){return /\b(?:vs\.?|versus|game|tournament|scrimmage)\b|\s@\s|^at\s/i.test(s);}
function highSchool(team){return /\bHS\b|HIGH SCHOOL|\bVARSITY\b|\bJV\b|FROSH/i.test(team)&&!/\bMS\b|MIDDLE SCHOOL|5\/6|5TH|6TH/i.test(team);}
function groupOf(team){return highSchool(team)?'HS':/\bMS\b|MIDDLE|5\/6|5TH|6TH/i.test(team)?'MS':'Other';}
function validCell(s){return s&&!/^(?:x|n\/a|na|none|-)$/i.test(s);}
// The same contest can appear in both workbooks. Merge only when the pairing
// is unambiguous, rather than hiding two legitimate contests on the same day.
function teamParts(name) {
  const raw=norm(name).toLowerCase().replace(/\bjv\s*1\b/g,'jv');
  const sport=(raw.match(/flag\s*football|volleyball|basketball|cross\s*country|football|baseball|softball|soccer|golf|swim(?:ming)?|wrestling|tennis|track/)||[])[0]||'';
  const school=/\b(?:ms|middle school)\b/.test(raw)?'MS':/5\s*\/\s*6|5th|6th/.test(raw)?'ELEMENTARY':/\b(?:hs|high school)\b/.test(raw)?'HS':/\bvarsity\b|\bjv\b|frosh/.test(raw)?'HS':'';
  const level=/\bjv\b/.test(raw)?'JV':/\bvarsity\b/.test(raw)?'VARSITY':/\bfrosh\b/.test(raw)?'FROSH':'';
  const color=(raw.match(/\b(?:red|gold|blue|white)\b/)||[])[0]||'';
  const gender=/\bgirls?\b/.test(raw)?'G':/\bboys?\b/.test(raw)?'B':'';
  return {sport:sport.replace(/\s+/g,' '),school,level,color,gender};
}
function meaningfulOpponent(text) {
  const clean=norm(text).toLowerCase().replace(/\bndp\b|\bnotre\s*dame\s*prep\b/g,'notredameprep').replace(/\bncs\b|\bnorthwest\s*christian\b/g,'northwestchristian')
    .replace(/\bvs?\.?\b|\bat\b|\bhome\b|\baway\b|\bprep\b|\bhigh\b|\bschool\b|\bpm\b|\bam\b/g,' ');
  return [...new Set(clean.match(/[a-z]{4,}/g)||[])].filter(t=>!['game','girls','boys','varsity','football','volleyball','basketball','tournament','scrimmage','field','gym','saturday','friday','monday','tuesday','wednesday','thursday','sunday'].includes(t));
}
function hasOpponentClue(facilityDetail, opponent) {
  if (!opponent) return false;
  const a=meaningfulOpponent(facilityDetail),b=meaningfulOpponent(opponent);
  return a.some(word=>b.some(other=>word===other || (word.length>=6&&other.length>=6&&(word.includes(other)||other.includes(word)))));
}
function candidateScore(f,t) {
  if(f.date!==t.date||f.type!=='game'||t.type!=='game')return -1;
  const a=teamParts(f.team),b=teamParts(t.team);
  if(!a.sport||!b.sport||a.sport!==b.sport)return -1;
  if(a.school&&b.school&&a.school!==b.school)return -1;
  if(a.level&&b.level&&a.level!==b.level)return -1;
  if(a.color&&b.color&&a.color!==b.color)return -1;
  if(a.gender&&b.gender&&a.gender!==b.gender)return -1;
  const timeMatch=f.start!==null&&t.start!==null&&Math.abs(f.start-t.start)<=10;
  const timeMismatch=f.start!==null&&t.start!==null&&!timeMatch;
  if(timeMismatch)return -1;
  const opponentMatch=hasOpponentClue(f.detail,t.opponent||'');
  // Unknown JV/varsity levels must have independent opponent evidence.
  const ambiguousLevel=Boolean(a.level)!==Boolean(b.level);
  if(ambiguousLevel&&!opponentMatch)return -1;
  if(a.school&&b.school&&a.school!==b.school)return -1;
  if(!timeMatch&&!opponentMatch)return -1;
  const exactLevel=a.level&&b.level&&a.level===b.level;
  const exactSchool=a.school&&b.school&&a.school===b.school;
  return (timeMatch?10:0)+(opponentMatch?4:0)+(exactLevel?2:0)+(exactSchool?1:0);
}
function combineSameGames(events) {
  const facilityGames=events.filter(e=>e.type==='game'&&e.source==='facilities');
  const transportGames=events.filter(e=>e.type==='game'&&e.source==='transportation');
  const edges=[];
  for(const f of facilityGames)for(const t of transportGames){
    const score=candidateScore(f,t);
    if(score>=10 || (score>=4 && f.start===null && t.start===null))edges.push({f,t,score});
  }
  const bestF=new Map(),bestT=new Map();
  for(const edge of edges){
    if(!bestF.has(edge.f)||bestF.get(edge.f).score<edge.score)bestF.set(edge.f,{score:edge.score,edges:[edge]});
    else if(bestF.get(edge.f).score===edge.score)bestF.get(edge.f).edges.push(edge);
    if(!bestT.has(edge.t)||bestT.get(edge.t).score<edge.score)bestT.set(edge.t,{score:edge.score,edges:[edge]});
    else if(bestT.get(edge.t).score===edge.score)bestT.get(edge.t).edges.push(edge);
  }
  const matched=new Set();
  for(const edge of edges){
    if(bestF.get(edge.f)?.edges.length!==1||bestT.get(edge.t)?.edges.length!==1)continue;
    if(bestF.get(edge.f).edges[0]!==edge||bestT.get(edge.t).edges[0]!==edge)continue;
    // Keep the transportation card (opponent, venue, dismissal, vehicles) and
    // attach useful facility context without publishing duplicate cards.
    edge.t.facilityLocation=edge.f.location;
    edge.t.facilityDetail=edge.f.detail;
    matched.add(edge.f);
  }
  return events.filter(e=>!matched.has(e));
}
export function processSchedules(facilities,transportation,monday){
  const dates=new Set(weekDays(monday));
  const events=[],issues=[],gym=[];
  if(!facilities?.ok||!transportation?.ok)throw new Error('Schedule source did not report successful data');
  for(const sheet of facilities.sheets||[]){
    const cfg=FACILITY_COLS[sheet.name];if(!cfg)continue;
    const labels=sheet.rows?.[cfg.labels]||[];
    for(const row of (sheet.rows||[]).slice(cfg.firstRow)){
      const date=isoFromCell(row[0]);if(!dates.has(date))continue;
      for(const location of ['field','gym']){
        for(const c of cfg[location]){
          const detail=norm(row[c]);if(!validCell(detail))continue;
          const team=norm(labels[c])||`Column ${c+1}`;
          const ranges=parseRanges(detail);
          const type=isGame(detail)?'game':ranges.length?'practice':'event';
          const ev={date,team,detail,type,location:location==='gym'?'Gym':'Field',source:'facilities',group:groupOf(team),start:ranges[0]?.start??parseTime(detail),ranges};
          events.push(ev);
          if(location==='gym')for(const range of ranges)gym.push({...ev,range});
          if(location==='gym'&&type==='game'&&ranges.length===0&&ev.start!==null)gym.push({...ev,range:{start:ev.start,end:ev.start+1},point:true});
        }
        const notes=norm(row[location==='gym'?cfg.gymNotes:cfg.fieldNotes]);
        if(validCell(notes))events.push({date,team:location==='gym'?'Gym notes':'Field notes',detail:notes,type:'note',location:location==='gym'?'Gym':'Field',source:'facilities',group:'Other',start:parseTime(notes)});
      }
    }
  }
  // The current-year transportation tab is authoritative for game details. Ignore historical/other tabs.
  const tSheet=(transportation.sheets||[]).find(s=>s.name==='2026-2027 Transportation');
  if(!tSheet)throw new Error('Current-year transportation tab is missing');
  for(const row of (tSheet.rows||[]).slice(1)){
    const date=isoFromCell(row[0]);if(!dates.has(date))continue;
    const team=norm(row[1]),opponent=norm(row[4]),side=norm(row[5]).toUpperCase();
    if(!team||(!opponent&&!norm(row[3])))continue;
    const dismissal=norm(row[2]),time=norm(row[3]),venue=norm(row[6]),transport=norm(row[7]);
    events.push({date,team,detail:[opponent?`vs ${opponent}`:'',side==='A'?'Away':side==='H'?'Home':'',venue].filter(Boolean).join(' · '),type:'game',location:venue||'Venue TBD',source:'transportation',group:groupOf(team),start:parseTime(time),time,dismissal,transport,side,opponent});
    if(side==='A'&&opponent){
      const missing=[];
      if(blank(dismissal)||/^tbd$/i.test(dismissal))missing.push('dismissal');
      if(blank(transport)||/^tbd$/i.test(transport))missing.push('transportation');
      if(missing.length)issues.push({date,type:'transport',title:`${team}: ${missing.join(' and ')} needs confirmation`,details:`Away event vs ${opponent}. ${missing.map(m=>m[0].toUpperCase()+m.slice(1)).join(' and ')} is blank or TBD.`,signature:`transport|${date}|${team.toLowerCase()}|${opponent.toLowerCase()}|${time.toLowerCase()}|${missing.join(',')}`,group:groupOf(team),severity:'review'});
    }
  }
  // Alert for high-school gym overlaps or two confirmed games; MS practices are intentionally shareable.
  for(let i=0;i<gym.length;i++)for(let j=i+1;j<gym.length;j++){
    const a=gym[i],b=gym[j];
    if(a.date!==b.date||a.team===b.team)continue;
    const bothGames=a.type==='game'&&b.type==='game';
    if(!bothGames&&!(highSchool(a.team)&&highSchool(b.team)))continue;
    const overlap=a.range.start<b.range.end&&b.range.start<a.range.end;
    if(!overlap)continue;
    const names=[a.team,b.team].sort();
    const start=Math.max(a.range.start,b.range.start),end=Math.min(a.range.end,b.range.end);
    issues.push({date:a.date,type:'gym',title:'Possible gym overlap',details:`${names.join(' and ')} overlap near ${clock(start)} in the gym. Verify whether the shared time is intentional.`,signature:`gym|${a.date}|${names.map(s=>s.toLowerCase()).join('|')}|${[a,b].map(item=>item.team.toLowerCase()+':'+item.range.start+'-'+item.range.end).sort().join('|')}`,group:highSchool(a.team)&&highSchool(b.team)?'HS':'Other',severity:'review'});
  }
  const unique=new Map();for(const issue of issues)unique.set(issue.signature,issue);
  const rank={game:0,practice:1,event:2,note:3};
  const combined=combineSameGames(events);
  combined.sort((a,b)=>a.date.localeCompare(b.date)||(a.start??9999)-(b.start??9999)||(rank[a.type]??4)-(rank[b.type]??4));
  return {events:combined,issues:[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title)),monday};
}
export async function fingerprint(signature){const input=new TextEncoder().encode(`sca-v1|${signature}`);const buf=await crypto.subtle.digest('SHA-256',input);return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export {FACILITY_COLS};
