/* ════════════════════════════════════════════════════════════════
   RACING NSW · application script
   Sections, in source order:
     1 · Data constants        5 · Render functions
     2 · Format & badge helpers 6 · Navigation & views
     3 · App state & selectors  7 · Dash companion
     4 · Fantasy interactions   8 · Onboarding · then Boot at the end
   ════════════════════════════════════════════════════════════════ */
/* ╔══════════════════════════════════════════════════════════════╗
   ║ SECTION 1 · FANTASY RULES                                    ║
   ║ The salary-cap game rules. All DATA now lives in             ║
   ║ js/data-service.js — see the adapter notes in that file.     ║
   ╚══════════════════════════════════════════════════════════════╝ */
const SALARY_CAP = 2_000_000;
const SQUAD = { jockey:5, trainer:2 };

/* Headline feature for a schedule card. Render helper — reads a race day
   supplied by the service; prizeNum() comes from data-service.js. */
function schedFeat(r){
  const prizeNum = window.DataService.prizeNum;
  const fs=(r.feats&&r.feats.length)?r.feats:(r.feat?[r.feat]:[]); if(!fs.length) return '';
  const hf=fs.reduce((a,b)=>prizeNum(b.prize)>prizeNum(a.prize)?b:a);
  const more=fs.length>1?` <span class="text-sky-soft font-semibold">+${fs.length-1} more</span>`:'';
  return `<p class="text-[12.5px] font-extrabold text-gold mt-1">${hf.name} &middot; ${hf.prize}${more}</p>`;
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║ STATE + RULE ENGINE (unchanged rules; fantasy-tab only)      ║
   ╚══════════════════════════════════════════════════════════════╝ */
/* ╔══════════════════════════════════════════════════════════════╗
   ║ SECTION 2 · FORMAT & BADGE HELPERS                           ║
   ╚══════════════════════════════════════════════════════════════╝ */
const GRADE_STYLE = {
  'G1':            'background:#F2B33D;color:#040C1F',
  'G2':            'background:#C0C0C0;color:#040C1F',
  'G3':            'background:#CD7F32;color:#fff',
  'Listed':        'background:rgba(255,255,255,0.9);color:#040C1F',
  'Showcase':      'background:#5BB8FF;color:#040C1F',
  'Cup Day':       'background:#E8132E;color:#fff',
  'Country Champs':'background:#1D6B3A;color:#fff',
  'Open':          'background:rgba(255,255,255,0.12);color:#A7CDEF',
  'Maiden':        'background:rgba(255,255,255,0.12);color:#A7CDEF',
};
function gradeBadge(grade){
  const st = GRADE_STYLE[grade] || GRADE_STYLE['Open'];
  return `<span class="display-tight text-[10px] px-2.5 py-1.5 rounded-lg shrink-0" style="${st}">${grade}</span>`;
}
const badgeHTML = gradeBadge;   /* back-compat shim */

/* Track-condition badge (3.2) — colour by RNSW scale */
function condBadge(c){
  if(!c) return '';
  const n = parseInt(c.replace(/\D/g,''),10);
  const cls = n<=2 ? 'cond-firm' : n<=4 ? 'cond-good' : n<=6 ? 'cond-soft' : 'cond-heavy';
  return `<span class="cond ${cls}">${c}</span>`;
}
/* Weather icon paired with a condition (3.2) */
function condWeather(c){
  const n = parseInt((c||'').replace(/\D/g,''),10);
  if(n>=7) return '🌧️';
  if(n>=5) return '⛅';
  return '☀️';
}

/* Leaderboard trend arrow (3.1) */
function trendArrow(t){
  if(t==='up')   return '<span class="text-emerald-400 font-bold">▲</span>';
  if(t==='down') return '<span class="text-rnswred font-bold">▼</span>';
  return '<span class="text-sky-soft font-bold">—</span>';
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║ SECTION 3 · APP STATE & SELECTORS                            ║
   ╚══════════════════════════════════════════════════════════════╝ */

/* ── The view's copy of the data ───────────────────────────────
   Screens render synchronously off DATA; DataService fills it. Keeping
   a resolved snapshot here (rather than awaiting inside every render
   function) means the render code stays synchronous and unchanged in
   shape, and a re-render triggered by a filter tap never has to wait
   on the network.

   Everything starts empty. A render that runs before its domain has
   loaded produces an empty list, not a crash — which is exactly the
   loading state stage 5 will dress up. */
const DATA = {
  raceDays:[], results:[], players:[],
  /* Horses are not preloaded: searchHorses()/getHorseProfile() resolve
     per-lookup so an api-mode search hits the server, not a stale copy. */
  jockeyProfiles:{}, trainerProfiles:{},
  liveFeed:[], leaderboard:[], myLeague:[], myRank:null, pastRounds:[],
  sites:[], socials:[], podcasts:[], activations:[], tickets:[], alertOpts:{},
  newsHub:'', stories:[], videos:[], replays:[], diary:[], events:[],
  mapCats:{}, mapPins:[],
};

/* Freshness per domain, keyed as in DATA: {fetchedAt, stale, source, error}.
   Stage 5 reads this for the "last updated" indicators. */
const META = {};
function noteMeta(key, env){
  META[key] = { fetchedAt:env.fetchedAt, stale:env.stale, source:env.source, error:env.error };
  return env.data;
}

/* Pull one domain into DATA, then repaint whatever depends on it. Each
   is independent, so a slow or failing domain never blocks the others. */
function loadDomain(key, call, apply, repaint){
  return call().then(env=>{
    apply(noteMeta(key, env));
    if(repaint) repaint();
  }).catch(e=>{
    // DataService is contracted never to reject; belt-and-braces so one
    // bad domain can't abort the boot chain.
    META[key] = { fetchedAt:null, stale:true, source:'none', error:String(e&&e.message||e) };
  });
}

/* Boot-time load of every domain the app renders. */
function loadAppData(){
  const S = window.DataService;
  showLoading();   // paint skeletons up front; replaced when data settles
  return Promise.all([
    loadDomain('raceDays', ()=>S.getRaceDays(), d=>{ DATA.raceDays=d||[]; }),
    loadDomain('results',  ()=>S.getResults(),  d=>{ DATA.results=d||[]; }),
    loadDomain('jockeys',  ()=>S.getJockeys(),  d=>{ DATA.jockeyProfiles=(d&&d.profiles)||{}; DATA._jockeys=(d&&d.roster)||[]; }),
    loadDomain('trainers', ()=>S.getTrainers(), d=>{ DATA.trainerProfiles=(d&&d.profiles)||{}; DATA._trainers=(d&&d.roster)||[]; }),
    loadDomain('liveFeed', ()=>S.getLiveFeed(), d=>{ DATA.liveFeed=d||[]; }),
    loadDomain('leaderboard', ()=>S.getLeaderboard(), d=>{
      DATA.leaderboard=(d&&d.global)||[]; DATA.myLeague=(d&&d.league)||[]; DATA.myRank=(d&&d.me)||null; }),
    loadDomain('pastRounds', ()=>S.getPastRounds(), d=>{ DATA.pastRounds=d||[]; }),
    loadDomain('network',  ()=>S.getNetwork(),  d=>{
      DATA.sites=(d&&d.sites)||[]; DATA.socials=(d&&d.socials)||[]; DATA.podcasts=(d&&d.podcasts)||[]; }),
    loadDomain('activations', ()=>S.getActivations(), d=>{ DATA.activations=d||[]; }),
    loadDomain('tickets',  ()=>S.getTickets(),  d=>{ DATA.tickets=d||[]; }),
    loadDomain('alertOpts',()=>S.getAlertOptions(), d=>{ DATA.alertOpts=d||{}; }),
    loadDomain('news',     ()=>S.getNews(),     d=>{ DATA.newsHub=(d&&d.hub)||''; DATA.stories=(d&&d.stories)||[]; }),
    loadDomain('videos',   ()=>S.getVideos(),   d=>{ DATA.videos=d||[]; }),
    loadDomain('replays',  ()=>S.getRaceReplays(), d=>{ DATA.replays=d||[]; }),
    loadDomain('diary',    ()=>S.getRaceDiary(), d=>{ DATA.diary=d||[]; }),
    loadDomain('events',   ()=>S.getUpcomingEvents(), d=>{ DATA.events=d||[]; }),
    loadDomain('courseMap',()=>S.getCourseMap(), d=>{
      DATA.mapCats=(d&&d.cats)||{}; DATA.mapPins=(d&&d.pins)||[]; }),
  ]).then(()=>{
    // Fantasy roster is jockeys + trainers, in that order (drives Market order).
    DATA.players = (DATA._jockeys||[]).concat(DATA._trainers||[]);
  });
}

const state = { picks:[], captainId:null, market:'jockey', schedSector:'all', resSector:'all' };
const byId  = id => DATA.players.find(p=>p.id===id);
const spent = () => state.picks.reduce((s,id)=>s+byId(id).price,0);
const remaining = () => SALARY_CAP - spent();
const countRole = r => state.picks.filter(id=>byId(id).role===r).length;
const money = n => '$'+n.toLocaleString('en-AU');
const moneyK = n => n>=1_000_000 ? '$'+(n/1_000_000).toFixed(n%1_000_000?2:1).replace(/\.0$/,'')+'M' : '$'+(n/1000)+'k';

/* ╔══════════════════════════════════════════════════════════════╗
   ║ SECTION 4 · INTERACTIONS — FANTASY SQUAD                     ║
   ╚══════════════════════════════════════════════════════════════╝ */
function togglePick(id){
  const p=byId(id), i=state.picks.indexOf(id);
  if(i>-1){ state.picks.splice(i,1); if(state.captainId===id) state.captainId=null; persistPicks(); render(); return; }
  if(countRole(p.role)>=SQUAD[p.role]){ toast(`All ${SQUAD[p.role]} ${p.role} slots are full — remove one first.`); return; }
  if(p.price>remaining()){ toast(`⛔ Over the cap: ${p.name} costs ${moneyK(p.price)} but only ${moneyK(remaining())} remains.`); return; }
  state.picks.push(id); persistPicks(); render();
}
/* 5.2 — fantasy state persistence */
function persistPicks(){ try{ localStorage.setItem('rnsw_fantasy_picks', JSON.stringify({picks:state.picks, captainId:state.captainId})); }catch(e){} }
function setCaptain(id){
  const p=byId(id);
  if(p.role!=='jockey' || !state.picks.includes(id)) return;
  state.captainId = state.captainId===id ? null : id; persistPicks(); render();
}
function resetTeam(){ state.picks=[]; state.captainId=null; try{localStorage.removeItem('rnsw_fantasy_picks');}catch(e){} render(); toast('Squad cleared — $2,000,000 cap restored.'); }

/* ── Rendering ───────────────────────────────────────────────── */
const TIER_COLORS = { Elite:'text-gold', Power:'text-sky-brand', Solid:'text-emerald-300', Value:'text-sky-soft' };

/* ╔══════════════════════════════════════════════════════════════╗
   ║ SECTION 5 · RENDER FUNCTIONS                                 ║
   ╚══════════════════════════════════════════════════════════════╝ */
function render(){ renderBudget(); renderGrid(); renderRoster(); renderCapAlert(); }

function renderBudget(){
  const rem=remaining(), pct=Math.min(100, spent()/SALARY_CAP*100);
  // 4.1 three states: 0–74 emerald · 75–89 amber · 90–100 RNSW red
  const col = pct<75 ? '#34D399' : pct<90 ? '#F59E0B' : '#E8132E';
  const rt=document.getElementById('budgetRemaining');
  rt.textContent = money(rem);
  rt.style.color = pct<75 ? '' : col;
  document.getElementById('pickCount').innerHTML = `${state.picks.length}<span class="text-sky-soft">/7</span>`;
  const f=document.getElementById('budgetFill');
  f.style.width=pct+'%';
  f.className='h-full rounded-full';
  f.style.backgroundColor = col;
}

function renderGrid(){
  const js=state.picks.filter(id=>byId(id).role==='jockey');
  const ts=state.picks.filter(id=>byId(id).role==='trainer');
  const slot=(id,label)=>{
    if(!id) return `<div class="slot-empty rounded-[20px] min-h-[110px] grid place-items-center text-center p-2">
        <div><div class="text-2xl mb-1">＋</div><div class="text-[10.5px] font-bold leading-tight">${label}</div></div></div>`;
    const p=byId(id), cpt=state.captainId===id;
    const cBtn=p.role==='jockey'?`<button class="tap absolute top-1 left-1 w-8 h-8 rounded-full display text-[11px] grid place-items-center ${cpt?'bg-gold text-navy-950':'bg-black/50 text-sky-soft border border-white/20'}" onclick="event.stopPropagation(); setCaptain('${p.id}')" aria-label="Toggle captain">C</button>`:'';
    return `<div class="slot-filled rounded-[20px] min-h-[110px] relative p-2 pt-9 flex flex-col justify-end cursor-pointer" onclick="togglePick('${p.id}')" role="button" aria-label="Remove ${p.name}">
      ${cBtn}
      <button class="tap absolute top-1 right-1 w-8 h-8 rounded-full bg-black/50 border border-white/20 text-sky-soft grid place-items-center" onclick="event.stopPropagation(); togglePick('${p.id}')" aria-label="Remove">✕</button>
      ${cpt?'<span class="absolute -top-2 left-1/2 -translate-x-1/2 bg-gold text-navy-950 display-tight text-[8.5px] px-2 py-0.5 rounded-md">2× CAPTAIN</span>':''}
      <div class="display-tight text-[11.5px] leading-tight">${p.name}</div>
      <div class="text-sky-brand font-extrabold text-[11.5px] mt-0.5">${moneyK(p.price)}</div></div>`;
  };
  document.getElementById('jockeyGrid').innerHTML  = Array.from({length:5},(_,i)=>slot(js[i],'Jockey slot')).join('');
  document.getElementById('trainerGrid').innerHTML = Array.from({length:2},(_,i)=>slot(ts[i],'Trainer slot')).join('');
}

function renderRoster(){
  const list=DATA.players.filter(p=>p.role===state.market);
  document.getElementById('rosterList').innerHTML=list.map(p=>{
    const picked=state.picks.includes(p.id);
    const full=!picked && countRole(p.role)>=SQUAD[p.role];
    const over=!picked && p.price>remaining();
    const dis=full||over;
    const lbl=picked?'✓ Picked':over?'Over cap':full?'Full':'+ Add';
    const sty=picked?'text-navy-950" style="background:linear-gradient(180deg,#8FCBFF,#5BB8FF)':
             dis?'bg-white/10 text-sky-soft/50"':'bg-white text-navy-950 active:scale-95"';
    return `<div class="glass rounded-[22px] p-3.5 flex items-center gap-3 ${dis?'opacity-60':''} ${picked?'border-sky-brand/70':''}">
      <div class="w-12 h-12 rounded-full bg-white/10 display grid place-items-center text-[13px] text-sky-brand shrink-0">${p.name.split(' ').map(w=>w[0]).slice(0,2).join('')}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="display-tight text-[13.5px] truncate">${p.name}</span>
          <span class="text-[9.5px] font-extrabold tracking-wider ${TIER_COLORS[p.tier]}">${p.tier.toUpperCase()}</span>
        </div>
        <div class="text-[11.5px] text-sky-soft truncate">${p.note}</div>
        <div class="text-[13.5px] font-extrabold text-white mt-0.5">${moneyK(p.price)}</div>
      </div>
      <button class="tap rounded-2xl px-4 py-3 font-extrabold text-[12.5px] transition ${sty}" ${dis&&!picked?'disabled':''} onclick="togglePick('${p.id}')">${lbl}</button></div>`;
  }).join('');
}

/* Superstar Conflict — McDonald (j1) + Waller (t1), both $750k */
function renderCapAlert(){
  const el=document.getElementById('capAlert');
  const both=state.picks.includes('j1')&&state.picks.includes('t1');
  const left=7-state.picks.length, rem=remaining();
  if(both&&left>0){
    el.innerHTML=`⚠️ <b>Cap Alert: Superstar Conflict!</b> Only ${moneyK(rem)} remaining for ${left} slot${left===1?'':'s'} (~${moneyK(Math.floor(rem/left/1000)*1000)} each). Legal, but brutal.`;
    el.classList.remove('hidden');
  } else if(left>0 && rem/left<70_000){
    el.innerHTML=`⚠️ <b>Cap squeeze:</b> ${moneyK(rem)} left for ${left} slot${left===1?'':'s'}. Some picks may be unaffordable.`;
    el.classList.remove('hidden');
  } else el.classList.add('hidden');
}

/* ── 3.4 Home Race-Day Mode (Live | Today | News) ── */
function setRaceDayMode(m){
  ['live','today','news'].forEach(k=>document.getElementById('rd-'+k).classList.toggle('on',k===m));
  document.getElementById('liveMode').classList.toggle('hidden',m!=='live');
  document.getElementById('todayFeed').classList.toggle('hidden',m!=='today');
  document.getElementById('newsFeed').classList.toggle('hidden',m!=='news');
  if(m==='live') renderLiveFeed();
  if(m==='today') renderTodayFeed();
}
function renderLiveFeed(){
  document.getElementById('liveFeed').innerHTML=DATA.liveFeed.map(f=>{
    const badge = f.state==='live'
      ? '<span class="flex items-center gap-1.5 bg-rnswred text-white display-tight text-[9.5px] px-2 py-1 rounded-md"><span class="pulse" style="width:6px;height:6px"></span> LIVE</span>'
      : f.state==='result'
        ? '<span class="bg-sky-brand text-navy-950 display-tight text-[9.5px] px-2 py-1 rounded-md">RESULT</span>'
        : '<span class="bg-white/15 text-sky-soft display-tight text-[9.5px] px-2 py-1 rounded-md">UPCOMING</span>';
    return `<article class="glass rounded-[22px] p-4">
      <div class="flex items-center justify-between mb-1.5">
        <span class="display-tight text-[13px]">${f.label}</span>${badge}
      </div>
      <p class="text-[12.5px] text-sky-soft leading-snug">${f.text}</p>
    </article>`;
  }).join('');
}
function renderTodayFeed(){
  // Today = the Golden Slipper Day programme (feature meeting)
  const d=DATA.raceDays.find(x=>x.day==='TAB Everest Day') || DATA.raceDays[0];
  document.getElementById('todayFeed').innerHTML=`
    <article class="glass rounded-[22px] p-4 mb-1">
      <div class="text-[9.5px] font-extrabold tracking-[.2em] text-sky-soft">TODAY · ${d.venue}</div>
      <div class="display-tight text-[16px] mt-0.5">${d.day||d.venue}</div>
      <div class="mt-1 flex items-center gap-1.5">${condWeather(d.condition)} ${condBadge(d.condition)}</div>
    </article>`
    + d.races.map(rc=>`
    <article class="glass rounded-[20px] px-4 py-3 flex items-center gap-3">
      <div class="w-9 h-9 rounded-lg bg-black/30 grid place-items-center display text-[13px] ${rc.feature?'text-gold':'text-sky-brand'} shrink-0">R${rc.n}</div>
      <div class="flex-1 min-w-0"><div class="font-bold text-[13px] truncate">${rc.name}</div>
        <div class="text-[11px] text-sky-soft">${rc.cls} · ${rc.dist}</div></div>
      <div class="display-tight text-[13px] text-white shrink-0">${rc.time}</div>
    </article>`).join('');
}

/* ── 3.1 Fantasy view toggle (My Team | Leaderboard) ── */
function setFantasyView(v){
  document.getElementById('fan-team').classList.toggle('on',v==='team');
  document.getElementById('fan-board').classList.toggle('on',v==='board');
  document.getElementById('fantasyTeam').classList.toggle('hidden',v!=='team');
  document.getElementById('fantasyBoard').classList.toggle('hidden',v!=='board');
  document.getElementById('budgetSticky').style.display = v==='team' ? '' : 'none';
  if(v==='board') setBoardTab('global');
}
let boardTab='global';
function setBoardTab(t){
  boardTab=t;
  document.getElementById('lb-global').classList.toggle('on',t==='global');
  document.getElementById('lb-league').classList.toggle('on',t==='league');
  document.getElementById('inviteBtn').classList.toggle('hidden',t!=='league');
  renderBoard();
}
function renderBoard(){
  const el=document.getElementById('boardList');
  if(boardTab==='global'){
    el.innerHTML=DATA.leaderboard.map(r=>`
      <div class="glass rounded-2xl px-3.5 py-3 flex items-center gap-3">
        <div class="w-7 text-center display text-[15px] ${r.rank<=3?'text-gold':'text-sky-soft'}">${r.rank}</div>
        <div class="w-9 h-9 rounded-full bg-white/10 display grid place-items-center text-[11px] text-sky-brand shrink-0">${initialsOf(r.name)}</div>
        <div class="flex-1 min-w-0 font-bold text-[13.5px] truncate">${r.name}</div>
        <div class="text-[10px]">${trendArrow(r.trend)}</div>
        <div class="display text-[15px] text-gold">${r.pts.toLocaleString()}</div>
      </div>`).join('')
      + `<div class="glass rounded-2xl px-3.5 py-3 flex items-center gap-3" style="border-color:rgba(91,184,255,.7)">
          <div class="w-7 text-center display text-[15px] text-sky-brand">47</div>
          <div class="w-9 h-9 rounded-full display grid place-items-center text-[11px] text-navy-950 shrink-0" style="background:linear-gradient(180deg,#8FCBFF,#5BB8FF)">${initialsOf(getUserName())}</div>
          <div class="flex-1 min-w-0 font-bold text-[13.5px] truncate">You</div>
          <div class="text-[10px]">${trendArrow('up')}</div>
          <div class="display text-[15px] text-gold">1,284</div>
        </div>`;
  } else {
    el.innerHTML=DATA.myLeague.map(r=>`
      <div class="glass rounded-2xl px-3.5 py-3 flex items-center gap-3 ${r.you?'':''}" style="${r.you?'border-color:rgba(91,184,255,.7)':''}">
        <div class="w-7 text-center display text-[15px] ${r.rank<=3?'text-gold':'text-sky-soft'}">${r.rank}</div>
        <div class="w-9 h-9 rounded-full display grid place-items-center text-[11px] shrink-0 ${r.you?'text-navy-950':'bg-white/10 text-sky-brand'}" style="${r.you?'background:linear-gradient(180deg,#8FCBFF,#5BB8FF)':''}">${r.you?initialsOf(getUserName()):initialsOf(r.name)}</div>
        <div class="flex-1 min-w-0 font-bold text-[13.5px] truncate">${r.you?'You':r.name}</div>
        <div class="display text-[15px] text-gold">${r.pts.toLocaleString()}</div>
      </div>`).join('');
  }
}

/* ── 3.3 Past Rounds accordion ── */
function renderPastRounds(){
  document.getElementById('pastRounds').innerHTML=DATA.pastRounds.map((r,i)=>`
    <div class="glass rounded-[24px] overflow-hidden">
      <button class="tap w-full px-4 py-4 flex items-center justify-between" onclick="togglePastRound(${i})" aria-expanded="false">
        <div class="text-left"><div class="display-tight text-[14px]">${r.round}</div>
          <div class="text-[11.5px] text-sky-soft mt-0.5">Round total</div></div>
        <div class="flex items-center gap-2">
          <span class="display text-[18px] text-gold">${r.total}</span>
          <svg class="chev text-sky-brand" id="rchev-${i}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>
        </div>
      </button>
      <div class="acc-body px-4" id="racc-${i}">
        <div class="pb-4">
          <div class="flex items-center gap-2 text-[9.5px] font-extrabold text-sky-soft/70 pb-1 border-b border-white/10">
            <span class="flex-1">PLAYER</span><span class="w-16 text-right">RIDES/RUN</span><span class="w-10 text-right">PTS</span><span class="w-8 text-right">CAP</span>
          </div>
          ${r.rows.map(row=>`<div class="flex items-center gap-2 text-[11.5px] py-1.5 border-b border-white/5 last:border-0">
            <span class="flex-1 font-bold truncate">${row[0]}</span>
            <span class="w-16 text-right text-sky-soft">${row[1]}</span>
            <span class="w-10 text-right font-extrabold">${row[2]}</span>
            <span class="w-8 text-right ${row[3]==='2×'?'text-gold font-bold':'text-sky-soft'}">${row[3]}</span>
          </div>`).join('')}
        </div>
      </div>
    </div>`).join('');
}
function togglePastRound(i){
  const b=document.getElementById('racc-'+i), c=document.getElementById('rchev-'+i);
  const open=b.classList.toggle('open'); c.classList.toggle('open',open);
}

/* ── Navigation + secondary views ────────────────────────────── */
/* ╔══════════════════════════════════════════════════════════════╗
   ║ SECTION 6 · NAVIGATION & VIEWS                               ║
   ╚══════════════════════════════════════════════════════════════╝ */
const TAB_ORDER = ['home','schedule','results','fantasy','activations'];
let activeTab = 'home';
function switchTab(tab){
  // Direction drives the slide animation (forward = in from right).
  const fromI = TAB_ORDER.indexOf(activeTab), toI = TAB_ORDER.indexOf(tab);
  const dir = (fromI<0 || toI<0 || fromI===toI) ? 0 : (toI>fromI ? 1 : -1);
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active','nav-left','nav-right'));
  const view = document.getElementById('view-'+tab);
  view.classList.add('active');
  if(dir===1) view.classList.add('nav-right');
  else if(dir===-1) view.classList.add('nav-left');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.getElementById('appScroll').scrollTo({top:0,behavior:'instant'});
  // 4.3 — per-tab aurora theme (home & menu use the default)
  const aur=document.querySelector('.aurora');
  aur.className='aurora'+(['results','fantasy','schedule'].includes(tab)?' aurora-'+tab:'');
  activeTab = tab;
  // 5.1 — reflect tab in URL hash for bookmarking/sharing
  if(window.location.hash!=='#/'+tab) window.location.hash='#/'+tab;
}
/* 5.1 — respond to hash changes (back/forward, shared links) */
window.addEventListener('hashchange',()=>{
  const tab=(window.location.hash.replace('#/','')||'home');
  if(TAB_ORDER.includes(tab)) switchTab(tab);
});

/* V6 — swipe left/right between tabs. Ignores horizontal carousels,
   inputs/switches, open modals, and predominantly-vertical scrolls. */
(function initSwipeNav(){
  const scroller = document.getElementById('appScroll');
  if(!scroller) return;
  let sx=0, sy=0, st=0, tracking=false, skip=false;
  const overlayOpen = () =>
    document.querySelector('#sheetWrap.open, #chatWrap.open, .sheetWrap.open') ||
    (document.getElementById('onboard') && !document.getElementById('onboard').classList.contains('gone'));
  scroller.addEventListener('pointerdown', e=>{
    if(e.pointerType==='mouse' && e.button!==0){ tracking=false; return; }
    sx=e.clientX; sy=e.clientY; st=Date.now(); tracking=true;
    skip = !!(e.target.closest && e.target.closest('.carousel, input, textarea, [role="switch"], [role="slider"]'));
  }, {passive:true});
  scroller.addEventListener('pointerup', e=>{
    if(!tracking) return; tracking=false;
    if(skip || overlayOpen()) return;
    const dx=e.clientX-sx, dy=e.clientY-sy, dt=Date.now()-st;
    if(Math.abs(dx)<64 || Math.abs(dx) < Math.abs(dy)*1.7 || dt>650) return;  // not a clean horizontal flick
    const i = TAB_ORDER.indexOf(activeTab);
    if(i<0) return;
    if(dx<0 && i<TAB_ORDER.length-1) switchTab(TAB_ORDER[i+1]);
    else if(dx>0 && i>0) switchTab(TAB_ORDER[i-1]);
  }, {passive:true});
  scroller.addEventListener('pointercancel', ()=>{ tracking=false; }, {passive:true});
})();

const SECTOR_LABEL = { metro:'METRO', prov:'PROVINCIAL', country:'COUNTRY' };

/* SCHEDULE — sector eyebrow → venue → feature day → date; cards drill into
   the race programme (1.4); track condition shown (3.2); empty state (5.6). */
function setSchedSector(s){
  state.schedSector=s;
  ['all','metro','prov','country'].forEach(k=>document.getElementById('sec-sched-'+k).classList.toggle('on',k===s));
  const rows=DATA.raceDays.filter(r=>s==='all'||r.sector===s);
  const listEl=document.getElementById('scheduleList');
  if(rows.length===0){ listEl.innerHTML=emptyState('No meetings this sector'); return; }
  listEl.innerHTML=rows.map((r)=>`
    <article class="glass rounded-[24px] p-4 flex items-start justify-between gap-3 cursor-pointer active:scale-[.99] transition" onclick="openProgramme(${DATA.raceDays.indexOf(r)})" role="button" aria-label="Open ${r.venue} programme">
      <div class="min-w-0">
        <div class="text-[9.5px] font-extrabold tracking-[.22em] text-sky-soft">${SECTOR_LABEL[r.sector]}</div>
        <h3 class="display-tight text-[17px] leading-tight mt-0.5">${r.venue}</h3>
        ${r.day?`<p class="text-[13px] font-semibold text-sky-brand mt-0.5">${r.day}</p>`:''}
        <p class="text-[13px] font-bold text-white mt-1">${r.date}</p>
        ${schedFeat(r)}
        <div class="mt-2 flex items-center gap-1.5">${condWeather(r.condition)} ${condBadge(r.condition)}</div>
      </div>
      <div class="flex flex-col items-end gap-2">${gradeBadge(r.badge)}<span class="text-sky-brand text-lg">›</span></div>
    </article>`).join('');
}

/* Empty-state card (5.6) */
function emptyState(title){
  return `<div class="glass rounded-[24px] p-8 text-center">
      <div class="text-4xl mb-3">🏇</div>
      <div class="display-tight text-[16px] mb-1">${title}</div>
      <p class="text-sky-soft text-[13px]">Try "All" to see every race day, or check back closer to the weekend.</p>
    </div>`;
}

/* RESULTS — sector filter + Class label */
function setResSector(s){
  state.resSector=s;
  ['all','metro','prov','country'].forEach(k=>document.getElementById('sec-res-'+k).classList.toggle('on',k===s));
  renderResults();
}
function sortResults(key){
  if(key==='cls') DATA.results.sort((a,b)=>a.cls.localeCompare(b.cls));
  if(key==='venue') DATA.results.sort((a,b)=>a.venue.localeCompare(b.venue));
  if(key==='date') DATA.results.sort((a,b)=>new Date(b.date)-new Date(a.date));
  renderResults();
}
function renderResults(){
  const rows=DATA.results.filter(r=>state.resSector==='all'||r.sector===state.resSector);
  const listEl=document.getElementById('resultsList');
  if(rows.length===0){ listEl.innerHTML=emptyState('No results this sector'); return; }
  listEl.innerHTML=rows.map((r)=>{
    const idx=DATA.results.indexOf(r);
    const field=(r.runners||[]).map(rw=>`
      <div class="flex items-center gap-2 text-[11.5px] py-1 border-b border-white/5 last:border-0">
        <span class="w-7 font-extrabold ${rw[0]==='1st'?'text-gold':'text-sky-soft'}">${rw[0]}</span>
        <span class="flex-1 font-bold truncate">${rw[1]}</span>
        <span class="w-16 text-right text-sky-soft truncate">${rw[2]}</span>
        <span class="w-10 text-right text-sky-soft">${rw[4]}</span>
      </div>`).join('');
    return `<article class="glass rounded-[24px] overflow-hidden" data-id="${idx}">
      <div class="p-4 flex items-center gap-3 cursor-pointer" onclick="toggleResult(${idx})" role="button" aria-expanded="false">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="display-tight text-[14px]">${r.race}</span>
            ${gradeBadge(r.cls)}
          </div>
          <div class="text-[11.5px] text-sky-soft mt-0.5">${SECTOR_LABEL[r.sector]} · ${r.venue} · ${r.date}</div>
          <div class="text-[12.5px] font-bold mt-1">🏆 ${r.winner} — ${r.jt}</div>
        </div>
        <svg class="chev shrink-0 text-sky-brand" id="chev-${idx}" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>
      </div>
      <div class="res-expand px-4" id="exp-${idx}">
        <div class="pb-4">
          <div class="text-[9.5px] font-extrabold tracking-[.2em] text-sky-soft mb-1.5">FULL FIELD</div>
          <div class="rounded-2xl bg-black/20 px-3 py-2 mb-3">
            <div class="flex items-center gap-2 text-[9.5px] font-extrabold text-sky-soft/70 pb-1 border-b border-white/10">
              <span class="w-7">POS</span><span class="flex-1">HORSE</span><span class="w-16 text-right">JOCKEY</span><span class="w-10 text-right">MGN</span>
            </div>
            ${field}
          </div>
          <div class="grid grid-cols-3 gap-2 mb-3">
            <div class="rounded-xl bg-black/20 p-2 text-center"><div class="text-[9px] text-sky-soft font-bold">WIN</div><div class="display-tight text-[14px] text-gold">${r.div?.win||'—'}</div></div>
            <div class="rounded-xl bg-black/20 p-2 text-center"><div class="text-[9px] text-sky-soft font-bold">EXACTA</div><div class="display-tight text-[14px] text-gold">${r.div?.exacta||'—'}</div></div>
            <div class="rounded-xl bg-black/20 p-2 text-center"><div class="text-[9px] text-sky-soft font-bold">TRIFECTA</div><div class="display-tight text-[14px] text-gold">${r.div?.trifecta||'—'}</div></div>
          </div>
          <button class="tap w-full btn-primary py-3 display-tight text-[12.5px]" onclick="event.stopPropagation(); openProfileByName('${(r.winner||'').replace(/'/g,"\\'")}')">View Form</button>
        </div>
      </div>
    </article>`;
  }).join('')
    + `<p class="text-[10.5px] text-sky-soft/60 mt-3">Results refresh live on race day. Class shown per Racing Australia grading.</p>`;
}

/* Toggle a result card open/closed (1.3) */
function toggleResult(idx){
  const exp=document.getElementById('exp-'+idx), chev=document.getElementById('chev-'+idx);
  const open=exp.classList.toggle('open'); chev.classList.toggle('open',open);
}

/* Universal Horse Search → profile cards (1.2)
   Horse matching goes through the service (server-side in api mode);
   jockey/trainer name matching runs against the already-loaded profile
   maps. A stale in-flight response can't overwrite a newer one — see
   searchSeq. */
let searchSeq = 0;
async function runSearch(q){
  const box=document.getElementById('searchResults');
  q=q.trim().toLowerCase();
  if(!q){ box.classList.add('hidden'); return; }
  const seq = ++searchSeq;
  const env = await window.DataService.searchHorses(q);
  if(seq !== searchSeq) return;            // a later keystroke already won
  const hHits=env.data||[];
  const jHits=Object.keys(DATA.jockeyProfiles).filter(n=>n.toLowerCase().includes(q)).map(n=>({type:'jockey',name:n}));
  const tHits=Object.keys(DATA.trainerProfiles).filter(n=>n.toLowerCase().includes(q)).map(n=>({type:'trainer',name:n}));
  const hits=[...hHits, ...jHits, ...tHits].slice(0,6);
  box.innerHTML=hits.length?hits.map(x=>{
    const icon=x.type==='horse'?'🐎':x.type==='jockey'?'🧑‍🦱':'📋';
    const sub=x.type==='horse'?`T: ${x.trainer} · J: ${x.jockey}`:x.type==='jockey'?'Jockey · tap for season stats':'Trainer · tap for stable stats';
    return `<button class="tap w-full text-left px-4 py-3.5 border-b border-white/10 last:border-0" onclick="openProfile('${x.type}','${x.name.replace(/'/g,"\\'")}'); document.getElementById('searchResults').classList.add('hidden'); document.getElementById('horseSearch').value=''">
      <div class="display-tight text-[13.5px]">${icon} ${x.name}${x.type==='horse'?` <span class="text-sky-brand text-[11.5px] font-body font-extrabold">${x.record||''}</span>`:''}</div>
      <div class="text-[11.5px] text-sky-soft mt-0.5">${sub}</div>
    </button>`;
  }).join('')
  :`<div class="px-4 py-4 text-[13px] text-sky-soft">No horse, jockey or trainer matches “${q}”. Try “Winx”, “McDonald” or “Waller”.</div>`;
  box.classList.remove('hidden');
}

/* Build + open a profile card by (type,name) (1.2) */
async function openProfile(type,name){
  let body='';
  if(type==='horse'){
    const x=(await window.DataService.getHorseProfile(name)).data; if(!x) return;
    const pills=(x.last5||[]).map(p=>`<span class="pill pill-${p<=3?p:'u'}">${p<=3?p:'•'}</span>`).join('');
    body=`
      <div class="text-[12px] text-sky-soft mb-3">${x.cs}</div>
      <div class="grid grid-cols-2 gap-2 mb-4">
        <div class="glass rounded-2xl p-3"><div class="text-[9px] font-bold text-sky-soft tracking-wider">TRAINER</div><div class="font-bold text-[13px] mt-0.5">${x.trainer}</div><div class="text-[11px] text-sky-brand font-extrabold">${x.tPrice}</div></div>
        <div class="glass rounded-2xl p-3"><div class="text-[9px] font-bold text-sky-soft tracking-wider">JOCKEY</div><div class="font-bold text-[13px] mt-0.5">${x.jockey}</div><div class="text-[11px] text-sky-brand font-extrabold">${x.jPrice}</div></div>
        <div class="glass rounded-2xl p-3"><div class="text-[9px] font-bold text-sky-soft tracking-wider">OWNER</div><div class="font-bold text-[13px] mt-0.5">${x.owner}</div></div>
        <div class="glass rounded-2xl p-3"><div class="text-[9px] font-bold text-sky-soft tracking-wider">CAREER (W-P-S)</div><div class="display-tight text-[15px] mt-0.5">${x.record}</div></div>
      </div>
      <div class="text-[9.5px] font-extrabold tracking-[.2em] text-sky-soft mb-2">LAST 5 STARTS</div>
      <div class="flex gap-1.5 mb-4">${pills}</div>
      <div class="glass rounded-2xl p-3 text-[12.5px] font-semibold">🏆 ${x.note}</div>`;
  } else {
    const P=(type==='jockey'?DATA.jockeyProfiles:DATA.trainerProfiles)[name]; if(!P) return;
    const unit=type==='jockey'?'rides':'runners';
    const recent=(P.recent||[]).map(r=>`
      <div class="flex items-center gap-2 py-2 border-b border-white/5 last:border-0">
        <span class="pill pill-1">1</span>
        <span class="flex-1 font-bold text-[13px]">${r[0]}</span>
        <span class="text-[11.5px] text-sky-soft">${r[1]} · ${r[2]}</span>
      </div>`).join('');
    body=`
      <div class="flex items-center gap-2 mb-3">
        <span class="text-[10px] font-extrabold tracking-wider text-gold">${(P.tier||'').toUpperCase()}</span>
        <span class="text-[11px] text-sky-brand font-extrabold">${P.price} fantasy</span>
      </div>
      <div class="grid grid-cols-3 gap-2 mb-4">
        <div class="glass rounded-2xl p-3 text-center"><div class="display text-[20px]">${P.wins}</div><div class="text-[9px] text-sky-soft font-bold">WINS</div></div>
        <div class="glass rounded-2xl p-3 text-center"><div class="display text-[20px]">${P[unit]}</div><div class="text-[9px] text-sky-soft font-bold">${unit.toUpperCase()}</div></div>
        <div class="glass rounded-2xl p-3 text-center"><div class="display text-[20px]">${P.winPct}%</div><div class="text-[9px] text-sky-soft font-bold">STRIKE</div></div>
      </div>
      <div class="text-[9.5px] font-extrabold tracking-[.2em] text-sky-soft mb-1">RECENT WINNERS</div>
      <div class="glass rounded-2xl px-3 py-1 mb-2">${recent}</div>`;
  }
  document.getElementById('profileTitle').textContent=name;
  document.getElementById('profileIcon').textContent = type==='horse'?'🐎':type==='jockey'?'🧑‍🦱':'📋';
  document.getElementById('profileBody').innerHTML=body;
  const fb=document.getElementById('followBtn');
  fb.dataset.name=name; fb.setAttribute('aria-pressed','false'); fb.textContent='+ Follow';
  openGenericSheet('profileSheetWrap');
}
async function openProfileByName(name){
  if(DATA.jockeyProfiles[name]) return openProfile('jockey',name);
  if(DATA.trainerProfiles[name]) return openProfile('trainer',name);
  const horse=(await window.DataService.getHorseProfile(name)).data;
  if(horse) return openProfile('horse',name);
  toast('Full form for '+name+' is on its way');
}
function toggleFollow(btn){
  const on=btn.getAttribute('aria-pressed')==='true';
  btn.setAttribute('aria-pressed', (!on).toString());
  btn.textContent = on ? '+ Follow' : '✓ Following';
  if(!on) toast(`🔔 You'll be alerted when ${btn.dataset.name} runs next`);
}

/* Race programme drill-in (1.4) */
function openProgramme(dayIdx){
  const d=DATA.raceDays[dayIdx]; if(!d) return;
  document.getElementById('progTitle').textContent='Race Programme — '+d.venue;
  document.getElementById('progSub').innerHTML=`${SECTOR_LABEL[d.sector]} · ${d.date} &nbsp;${condBadge(d.condition)}`;
  document.getElementById('progBody').innerHTML=d.races.map(rc=>`
    <div class="glass rounded-2xl p-3.5 mb-2.5 flex items-center gap-3 ${rc.feature?'border-gold/60':''}">
      <div class="w-10 h-10 rounded-xl bg-black/30 grid place-items-center display text-[14px] ${rc.feature?'text-gold':'text-sky-brand'} shrink-0">R${rc.n}</div>
      <div class="flex-1 min-w-0">
        <div class="font-bold text-[13.5px] truncate">${rc.name}</div>
        <div class="text-[11px] text-sky-soft">${rc.cls} · ${rc.dist} · ${rc.time}${rc.feature&&rc.prize?` · <span class="text-gold font-bold">${rc.prize}</span>`:''}</div>
      </div>
      ${rc.feature?gradeBadge(d.badge):`<span class="text-[10px] font-bold text-sky-soft">${rc.dist}</span>`}
    </div>`).join('')
    + `<button class="tap w-full mt-2 btn-primary py-3.5 display-tight text-[13px]" onclick="goResultsFor('${d.sector}')">View Results for this Track ›</button>`;
  openGenericSheet('progSheetWrap');
}
function goResultsFor(sector){
  closeGenericSheet('progSheetWrap');
  switchTab('results');
  setResSector(sector);
  toast('Showing '+SECTOR_LABEL[sector].toLowerCase()+' results');
}

/* Generic sheet open/close (1.1, 1.2, 1.4) */
function openGenericSheet(id){ document.getElementById(id).classList.add('open');
  document.getElementById('dashBubble').style.opacity='0'; }
function closeGenericSheet(id){ document.getElementById(id).classList.remove('open');
  if(typeof dashOn==='undefined'||dashOn) document.getElementById('dashBubble').style.opacity=''; }

/* ── 1.1 Tickets sheet ── */
function qrGrid(seed){
  let s=seed; const rnd=()=>{ s=(s*9301+49297)%233280; return s/233280; };
  let cells=''; for(let i=0;i<121;i++) cells+=`<i class="${rnd()>0.5?'on':''}"></i>`;
  return `<div class="qr">${cells}</div>`;
}
function openTickets(){
  document.getElementById('ticketsBody').innerHTML=DATA.tickets.map(t=>`
    <div class="glass rounded-[22px] p-4 mb-3 flex gap-4 items-center">
      <div class="flex-1 min-w-0">
        <div class="display-tight text-[15px] leading-tight">${t.ev}</div>
        <div class="text-[12px] text-sky-soft mt-1">${t.date}</div>
        <div class="text-[12px] font-bold mt-0.5">${t.venue}</div>
        <div class="text-[11.5px] text-sky-brand font-bold mt-0.5">${t.gate}</div>
        <div class="flex gap-2 mt-3">
          <button class="tap rounded-full px-4 py-2.5 text-[12px] font-extrabold text-navy-950" style="background:linear-gradient(180deg,#8FCBFF,#5BB8FF)" onclick="toast('Added to Apple Wallet')">Add to Wallet</button>
          <button class="tap rounded-full px-4 py-2.5 text-[12px] font-extrabold text-white glass glass-pill" onclick="event.stopPropagation();toast('Ticket link copied — share to transfer entry')">↗ Share</button>
        </div>
      </div>
      ${qrGrid(t.seed)}
    </div>`).join('');
  openGenericSheet('ticketsSheetWrap');
}

/* ── 1.1 Race alerts sheet ── */
const alertState={ horses:{}, jockeys:{}, tracks:{} };
let alertTab='horses';
function setAlertTab(t){
  alertTab=t;
  ['horses','jockeys','tracks'].forEach(k=>document.getElementById('al-'+k).classList.toggle('on',k===t));
  renderAlerts();
}
function renderAlerts(){
  document.getElementById('alertsBody').innerHTML=(DATA.alertOpts[alertTab]||[]).map((name)=>{
    const on=!!alertState[alertTab][name];
    return `<div class="glass rounded-2xl px-4 py-4 mb-2.5 flex items-center justify-between">
      <span class="font-bold text-[14px]">${name}</span>
      <button role="switch" aria-checked="${on}" onclick="toggleAlert('${name.replace(/'/g,"\\'")}')" class="relative w-[52px] h-[31px] rounded-full transition-colors duration-300" style="background:${on?'linear-gradient(180deg,#8FCBFF,#5BB8FF)':'rgba(255,255,255,.18)'}">
        <span class="absolute top-[3px] w-[25px] h-[25px] rounded-full bg-white shadow transition-all duration-300" style="left:${on?'24px':'3px'}"></span>
      </button></div>`;
  }).join('');
}
function toggleAlert(name){ alertState[alertTab][name]=!alertState[alertTab][name]; renderAlerts(); }
function openAlerts(){ setAlertTab('horses'); openGenericSheet('alertsSheetWrap'); }
function openTravel(){ openGenericSheet('travelSheetWrap'); }

/* ── 1.1 Accessibility sheet ── */
function setFontSize(v){ const sizes=[13,15,17,19]; document.getElementById('appScroll').style.fontSize=sizes[v]+'px'; }
function toggleReduceMotion(btn){
  const on=btn.getAttribute('aria-checked')!=='true';
  btn.setAttribute('aria-checked',on); flipSwitch(btn,on);
  document.body.classList.toggle('rm-on',on);
}
function toggleHighContrast(btn){
  const on=btn.getAttribute('aria-checked')!=='true';
  btn.setAttribute('aria-checked',on); flipSwitch(btn,on);
  document.getElementById('appScroll').classList.toggle('hc',on);
}
function flipSwitch(btn,on){
  btn.style.background = on ? 'linear-gradient(180deg,#8FCBFF,#5BB8FF)' : 'rgba(255,255,255,.18)';
  btn.firstElementChild.style.left = on ? '24px' : '3px';
}
function openAccessibility(){ openGenericSheet('a11ySheetWrap'); }

/* ── 1.1 Membership sheet ── */
function openMembership(){ document.getElementById('memName').textContent=getUserName(); openGenericSheet('memSheetWrap'); }

/* Market segment */
function setMarket(m){
  state.market=m;
  document.getElementById('seg-jockeys').classList.toggle('on',m==='jockey');
  document.getElementById('seg-trainers').classList.toggle('on',m==='trainer');
  renderRoster();
}

/* MENU builders */
function buildMenu(){
  document.getElementById('siteLinks').innerHTML=DATA.sites.map(s=>`
    <a class="tap glass rounded-2xl px-4 py-4 flex items-center gap-3" href="${s.url}" target="_blank" rel="noopener">
      <span class="text-xl">${s.icon}</span>
      <span class="flex-1 min-w-0"><span class="block font-bold text-[14.5px]">${s.name}</span>
      <span class="block text-[11.5px] text-sky-soft">${s.sub}</span></span>
      <span class="text-sky-brand text-lg">↗</span></a>`).join('');
  document.getElementById('socialLinks').innerHTML=DATA.socials.map(s=>`
    <a class="tap glass rounded-2xl py-3.5 grid place-items-center" href="${s.url}" target="_blank" rel="noopener" aria-label="${s.name}">
      <span class="display text-[13px] text-sky-brand">${s.label}</span>
      <span class="text-[9px] font-bold text-sky-soft mt-0.5">${s.name}</span></a>`).join('');
  document.getElementById('podLinks').innerHTML=DATA.podcasts.map(p=>`
    <button class="tap w-full glass rounded-2xl px-4 py-4 flex items-center gap-3 text-left" onclick="toast('🎙️ Opening ${p.name}…')">
      <span class="text-xl">${p.icon}</span>
      <span class="flex-1"><span class="block font-bold text-[14.5px]">${p.name}</span>
      <span class="block text-[11.5px] text-sky-soft">${p.sub}</span></span>
      <span class="text-sky-brand text-lg">›</span></button>`).join('');
}

/* ── Activations tab (on-course experiences) ── */
function renderActivations(){
  document.getElementById('activationList').innerHTML = DATA.activations.map(a=>{
    const gold = !!a.flagship;
    const act  = a.app ? 'openGoldenMingle()' : `openActivationInfo('${a.id}')`;
    return `<button class="tap w-full text-left text-white glass ${gold?'glass-strong':''} rounded-[24px] p-4 flex items-center gap-4"
      style="${gold?'border-color:rgba(242,179,61,.55)':''}" onclick="${act}">
      <div class="w-14 h-14 rounded-2xl grid place-items-center text-2xl shrink-0"
        style="background:${gold?'linear-gradient(135deg,#FFD37A,#F2B33D)':'rgba(91,184,255,.16)'}">${a.icon}</div>
      <div class="flex-1 min-w-0">
        <div class="display-tight text-[16px] leading-tight">${a.name}</div>
        <div class="text-[12px] text-sky-soft mt-0.5 truncate">${a.where}</div>
        <span class="inline-block mt-2 px-2.5 py-1 rounded-md text-[9.5px] font-extrabold tracking-wider ${gold?'text-navy-950':'text-sky-brand'}"
          style="background:${gold?'#F2B33D':'rgba(91,184,255,.16)'}">${a.tag}</span>
      </div>
      <span class="${gold?'text-gold':'text-sky-brand'} text-xl shrink-0">›</span>
    </button>`;
  }).join('');
}
function openActivationInfo(id){
  const a = DATA.activations.find(x=>x.id===id); if(!a) return;
  document.getElementById('actIcon').textContent  = a.icon;
  document.getElementById('actTitle').textContent = a.name;
  document.getElementById('actWhere').textContent = a.where;
  document.getElementById('actBlurb').textContent = a.blurb;
  document.getElementById('actWhen').textContent  = a.when;
  openGenericSheet('actSheetWrap');
}

/* ── The Golden Mingle — embedded experience (iframe overlay) ── */
function openGoldenMingle(){ document.getElementById('gmOverlay').classList.add('open'); }
function closeGoldenMingle(){ document.getElementById('gmOverlay').classList.remove('open'); }
function gmPhase(p){
  const f=document.getElementById('gmFrame');
  try{ f.contentWindow.postMessage({gmPhase:p},'*'); }catch(e){}
  document.querySelectorAll('#gmPhaseToggle .gmph').forEach(b=>b.classList.toggle('on', b.dataset.ph===p));
}

/* ── Home · News (real Racing NSW stories) + Shows (YouTube) ── */
function renderStories(){
  const el=document.getElementById('storyList'); if(!el) return;
  el.innerHTML = DATA.stories.map(s=>`
    <a href="${DATA.newsHub}" target="_blank" rel="noopener" class="tap block glass rounded-2xl px-4 py-3 flex items-center gap-3 text-white">
      <div class="flex-1 min-w-0">
        <div class="text-[9px] font-extrabold tracking-[.18em] text-sky-brand mb-0.5">${s.tag} · ${s.when}</div>
        <div class="display-tight text-[14px] leading-snug">${s.t}</div>
      </div>
      <span class="text-sky-brand shrink-0 text-lg">↗</span>
    </a>`).join('');
}
function renderShows(){
  const el=document.getElementById('showsGrid'); if(!el) return;
  el.innerHTML = DATA.videos.filter(v=>v.kind==='show').map(v=>`
    <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(v.t+' Racing NSW')}" target="_blank" rel="noopener" class="tap block rounded-2xl overflow-hidden glass">
      <div class="relative aspect-video bg-navy-800">
        <img src="${v.th}" alt="" loading="lazy" class="absolute inset-0 w-full h-full object-cover">
        <span class="absolute inset-0 grid place-items-center">
          <span class="w-9 h-9 rounded-full grid place-items-center" style="background:rgba(232,19,46,.92)"><svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></span>
        </span>
      </div>
      <div class="p-2.5">
        <div class="display-tight text-[12px] leading-tight text-white" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${v.t}</div>
        <div class="text-[10.5px] text-sky-soft mt-1">▶ ${v.ch}</div>
      </div>
    </a>`).join('');
}

/* ── New content sections (stage 4) — all fed through DataService ──
   Videos, Podcasts, Race Diary and Replays didn't exist in the UI before.
   These placeholder sections read the same DATA snapshot every other
   screen does, so flipping DATA_SOURCE to "api" swaps their data too. */

/* Home · Videos — feature + interview clips (the Shows grid already
   covers kind:'show'). Horizontal carousel of glass cards. */
function renderVideos(){
  const el=document.getElementById('videoList'); if(!el) return;
  const vids=DATA.videos.filter(v=>v.kind!=='show');
  if(!vids.length){ el.innerHTML=emptyMini('Videos are on their way'); return; }
  el.innerHTML=vids.map(v=>`
    <button class="tap text-left rounded-2xl overflow-hidden glass" style="width:230px" onclick="toast('▶ Opening ${(v.t||'').replace(/'/g,"\\'").slice(0,40)}…')">
      <div class="relative aspect-video bg-navy-800">
        <img src="${v.th}" alt="" loading="lazy" class="absolute inset-0 w-full h-full object-cover">
        <span class="absolute inset-0" style="background:linear-gradient(180deg,rgba(4,12,31,0),rgba(4,12,31,.55))"></span>
        <span class="absolute top-2 left-2 display-tight text-[8.5px] px-2 py-0.5 rounded-md ${v.kind==='feature'?'bg-rnswred text-white':'bg-sky-brand text-navy-950'}">${(v.kind||'').toUpperCase()}</span>
        <span class="absolute inset-0 grid place-items-center">
          <span class="w-11 h-11 rounded-full glass glass-strong glass-pill grid place-items-center"><svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></span>
        </span>
      </div>
      <div class="p-3">
        <div class="display-tight text-[12.5px] leading-tight text-white" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${v.t}</div>
        <div class="text-[10.5px] text-sky-soft mt-1">${v.ch}${v.when?` · ${v.when}`:''}</div>
      </div>
    </button>`).join('');
}

/* Home · Podcasts — show cards with the latest episode. */
function renderPodcasts(){
  const el=document.getElementById('podcastList'); if(!el) return;
  if(!DATA.podcasts.length){ el.innerHTML=emptyMini('Podcasts are on their way'); return; }
  el.innerHTML=DATA.podcasts.map(p=>`
    <button class="tap w-full text-left glass rounded-[22px] p-4 flex items-center gap-4" onclick="toast('🎙️ Opening ${(p.name||'').replace(/'/g,"\\'")}…')">
      <div class="w-14 h-14 rounded-2xl grid place-items-center text-2xl shrink-0" style="background:rgba(91,184,255,.16)">${p.icon}</div>
      <div class="flex-1 min-w-0">
        <div class="display-tight text-[15px] leading-tight truncate">${p.name}</div>
        ${p.latest?`<div class="text-[12px] text-sky-soft mt-0.5 truncate">Latest: ${p.latest}</div>`:`<div class="text-[12px] text-sky-soft mt-0.5 truncate">${p.sub||''}</div>`}
        <div class="text-[10.5px] text-sky-soft/80 mt-1">${[p.when,p.dur,p.episodes!=null?p.episodes+' eps':''].filter(Boolean).join(' · ')}</div>
      </div>
      <span class="w-9 h-9 rounded-full grid place-items-center shrink-0" style="background:rgba(232,19,46,.92)"><svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></span>
    </button>`).join('');
}

/* Schedule · Race Diary — key dates, colour-coded by type. */
const DIARY_STYLE = {
  noms:    {label:'NOMS',    color:'#5BB8FF'},
  weights: {label:'WEIGHTS', color:'#F2B33D'},
  accept:  {label:'ACCEPT',  color:'#34D399'},
  draw:    {label:'DRAW',    color:'#8FCBFF'},
  ballot:  {label:'BALLOT',  color:'#E8132E'},
};
function renderDiary(){
  const el=document.getElementById('diaryList'); if(!el) return;
  if(!DATA.diary.length){ el.innerHTML=emptyMini('Diary dates are on their way'); return; }
  el.innerHTML=DATA.diary.map(d=>{
    const s=DIARY_STYLE[d.type]||{label:(d.type||'').toUpperCase(),color:'#A7CDEF'};
    const dm=(d.date||'').split(' ').slice(0,2).join(' ');   // "28 Aug"
    return `<div class="glass rounded-[20px] p-3.5 flex items-center gap-3.5">
      <div class="w-12 shrink-0 text-center">
        <div class="display text-[15px] leading-none text-white">${dm.split(' ')[0]||''}</div>
        <div class="text-[10px] font-extrabold tracking-wider text-sky-soft mt-0.5">${(dm.split(' ')[1]||'').toUpperCase()}</div>
      </div>
      <div class="w-px self-stretch bg-white/10"></div>
      <div class="flex-1 min-w-0">
        <span class="inline-block display-tight text-[8.5px] px-2 py-0.5 rounded-md text-navy-950 mb-1" style="background:${s.color}">${s.label}</span>
        <div class="font-bold text-[13.5px] truncate">${d.event}</div>
        <div class="text-[11.5px] text-sky-soft truncate">${d.label} · ${d.venue}</div>
      </div>
    </div>`;
  }).join('');
}

/* Results · Replays — horizontal carousel of feature-race replays. */
function renderReplays(){
  const el=document.getElementById('replayList'); if(!el) return;
  if(!DATA.replays.length){ el.innerHTML=emptyMini('Replays are on their way'); return; }
  el.innerHTML=DATA.replays.map(r=>`
    <button class="tap text-left rounded-2xl overflow-hidden glass" style="width:230px" onclick="toast('▶ Replay — ${(r.race||'').replace(/'/g,"\\'")}…')">
      <div class="relative aspect-video bg-navy-800">
        <img src="${r.th}" alt="" loading="lazy" class="absolute inset-0 w-full h-full object-cover">
        <span class="absolute inset-0" style="background:linear-gradient(180deg,rgba(4,12,31,0),rgba(4,12,31,.6))"></span>
        <span class="absolute top-2 left-2">${gradeBadge(r.cls)}</span>
        <span class="absolute bottom-2 right-2 display-tight text-[9px] px-1.5 py-0.5 rounded bg-black/60 text-white">${r.dur}</span>
        <span class="absolute inset-0 grid place-items-center">
          <span class="w-11 h-11 rounded-full grid place-items-center" style="background:rgba(232,19,46,.92)"><svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></span>
        </span>
      </div>
      <div class="p-3">
        <div class="display-tight text-[13px] leading-tight truncate">${r.race}</div>
        <div class="text-[11px] text-sky-soft mt-0.5 truncate">🏆 ${r.winner} · ${r.date}</div>
      </div>
    </button>`).join('');
}

/* Small inline empty-state for the horizontal/list sections. */
function emptyMini(msg){
  return `<div class="glass rounded-[20px] px-4 py-6 text-center text-sky-soft text-[13px]">${msg}</div>`;
}

/* ── Stage 5 · loading skeletons ───────────────────────────────
   Painted before data arrives (matters in api mode over a slow race-day
   connection). DataService always resolves with fallback data, so a
   skeleton is only ever replaced by content — the screen never stays
   blank and never hangs on a spinner. */
function skRows(n, h){
  let s=''; for(let i=0;i<n;i++) s+=`<div class="skeleton sk-row" style="height:${h||88}px"></div>`;
  return s;
}
function skChips(n, h){
  let s=''; for(let i=0;i<n;i++) s+=`<div class="skeleton sk-chip" style="height:${h||150}px"></div>`;
  return s;
}
function showLoading(){
  // Only fill a container that's still empty, so this is safe to call again
  // and never clobbers content that has already rendered.
  const set=(id,html)=>{ const el=document.getElementById(id); if(el && !el.innerHTML.trim()) el.innerHTML=html; };
  set('scheduleList', skRows(4,120));
  set('resultsList',  skRows(4,96));
  set('storyList',    skRows(3,64));
  set('videoList',    skChips(3));
  set('podcastList',  skRows(3,84));
  set('diaryList',    skRows(4,70));
  set('replayList',   skChips(3));
  set('rosterList',   skRows(4,84));
  set('pastRounds',   skRows(3,74));
}

/* ── Stage 5 · "last updated" freshness ────────────────────────
   Reads META (stamped by loadDomain) through DataService.formatUpdated.
   Fallback/stale data is marked amber and labelled "cached" so degraded
   race-day content is honestly signalled, not passed off as live. */
function setFresh(id, key){
  const el=document.getElementById(id); if(!el) return;
  const m=META[key];
  if(!m || !m.fetchedAt){ el.textContent=''; el.classList.remove('stale'); return; }
  el.textContent = window.DataService.formatUpdated(m.fetchedAt) + (m.stale ? ' · cached' : '');
  el.classList.toggle('stale', !!m.stale);
}
function renderFreshness(){
  setFresh('resultsUpdated','results');   // results — freshness matters most
  setFresh('raceDayUpdated','liveFeed');  // live race-day info
  setFresh('videoUpdated','videos');
  setFresh('replayUpdated','replays');
}

function toggleFeatSound(btn){ const v=document.getElementById('featVid'); if(!v) return; v.muted=!v.muted; btn.innerHTML=v.muted?'&#128263;':'&#128266;'; if(!v.muted){ v.play&&v.play(); } }
function newsTab(which){
  document.getElementById('newsStories').classList.toggle('hidden', which!=='latest');
  document.getElementById('newsShows').classList.toggle('hidden', which!=='shows');
  document.getElementById('nt-latest').classList.toggle('on', which==='latest');
  document.getElementById('nt-shows').classList.toggle('on', which==='shows');
}

/* ── Interactive Course Map (Google-Maps stand-in while in development) ── */
/* Categories are data now, so filters start empty and are seeded from the
   service's category list by seedMapFilters() before the map first paints. */
let mapState = {x:0, y:0, scale:1, filters:new Set()};
function seedMapFilters(){
  if(mapState.filters.size===0) mapState.filters=new Set(Object.keys(DATA.mapCats));
}
function renderMapFilters(){
  seedMapFilters();
  document.getElementById('mapFilters').innerHTML = Object.entries(DATA.mapCats).map(([k,c])=>
    `<button class="mapfilt on ${k==='mingle'?'gold':''}" data-cat="${k}" onclick="toggleMapCat('${k}')">${c.emoji} ${c.label}</button>`).join('');
}
function renderMapPins(){
  seedMapFilters();
  document.getElementById('mapPins').innerHTML = DATA.mapPins.filter(p=>mapState.filters.has(p.cat)).map(p=>{
    const c=DATA.mapCats[p.cat];
    return `<button class="mappin" style="left:${p.x}%;top:${p.y}%" onclick="showPin(event,&quot;${p.name}&quot;,&quot;${c.label}&quot;)">
      <span class="dot" style="background:${c.color}"><span>${c.emoji}</span></span></button>`;
  }).join('');
}
function toggleMapCat(k){
  if(mapState.filters.has(k)) mapState.filters.delete(k); else mapState.filters.add(k);
  document.querySelector(`.mapfilt[data-cat="${k}"]`).classList.toggle('on');
  renderMapPins();
}
function showPin(e,name,cat){
  e.stopPropagation();
  const el=document.getElementById('mapPinLabel');
  el.innerHTML=`<div class="glass glass-strong rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
    <div><div class="text-[9px] font-extrabold tracking-[.16em] text-sky-soft">${cat.toUpperCase()}</div>
    <div class="display-tight text-[15px] text-white">${name}</div></div>
    <button class="tap text-sky-soft text-lg" onclick="document.getElementById('mapPinLabel').classList.remove('show')" aria-label="Close">✕</button></div>`;
  el.classList.add('show');
}
function applyMapTransform(){
  document.getElementById('mapCanvas').style.transform=`translate(${mapState.x}px,${mapState.y}px) scale(${mapState.scale})`;
}
function mapZoom(dir){ mapState.scale=Math.max(1,Math.min(3, +(mapState.scale+dir*0.4).toFixed(2))); applyMapTransform(); }
function mapReset(){ mapState.x=0; mapState.y=0; mapState.scale=1; applyMapTransform(); }
function initMapDrag(){
  const vp=document.getElementById('mapViewport'); let drag=false,sx,sy,ox,oy;
  vp.addEventListener('pointerdown',e=>{ if(e.target.closest('.mappin')||e.target.closest('#mapZoom')||e.target.closest('#mapPinLabel'))return;
    drag=true; sx=e.clientX; sy=e.clientY; ox=mapState.x; oy=mapState.y; try{vp.setPointerCapture(e.pointerId);}catch(_){} });
  vp.addEventListener('pointermove',e=>{ if(!drag)return; mapState.x=ox+(e.clientX-sx); mapState.y=oy+(e.clientY-sy); applyMapTransform(); });
  vp.addEventListener('pointerup',()=>{drag=false;});
  vp.addEventListener('pointercancel',()=>{drag=false;});
}
function openCourseMap(){
  const o=document.getElementById('mapOverlay'); o.classList.add('open');
  if(!o.dataset.init){ renderMapFilters(); renderMapPins(); initMapDrag(); o.dataset.init='1'; }
  mapReset();
}
function closeCourseMap(){ document.getElementById('mapOverlay').classList.remove('open'); }

/* ╔══════════════════════════════════════════════════════════════╗
   ║ DASH · AI COMPANION (secondary)                             ║
   ║ respondTo() calls the hosted Claude endpoint with an app-    ║
   ║ aware system prompt and short conversation memory. If the    ║
   ║ request fails (e.g. opened as a local file with no proxy),   ║
   ║ it falls back to localAnswer()'s on-device knowledge base —  ║
   ║ the chat UI is identical either way.                         ║
   ╚══════════════════════════════════════════════════════════════╝ */

/* Knowledge base: each intent has trigger keywords + an answer.
   Answers may include <a> links out to the Racing NSW sites. */
const DASH_KB = [
  { keys:['home','feed','live','start','main','sky','thoroughbred','vision','watch','video','stream'],
    answer:"The <b>Home</b> tab is your live feed. Switch between <b>Live</b>, <b>Today</b> and <b>News</b>. In Live you get the <b>Sky Thoroughbred Central</b> player; News has a featured story plus a <b>Latest</b> feed of Racing NSW stories and a <b>Shows</b> tab of videos to watch. The <b>course map</b> opens from the map button in the <b>top‑left</b>." },
  { keys:['search','find','horse','lookup','form','jockey','trainer'],
    answer:"Use the <b>search bar</b> at the top of Home to look up any horse, trainer or jockey. You'll get their recent form, connections and last run. Try typing “Autumn Glow” or “Waller”." },
  { keys:['schedule','calendar','race day','raceday','when','date','sector','metro','provincial','country','fixture','meeting'],
    answer:"The <b>Schedule</b> tab lists every race day by <b>sector</b> — Metro, Provincial or Country (use the filter at the top). Each card shows the <b>venue</b> first, then the feature day name (if it's a feature day), then the date. Badges flag G1–Listed plus Showcase, Cup Day and Country Champs meetings." },
  { keys:['result','results','winner','won','replay','placing','class','finished'],
    answer:"The <b>Results</b> tab shows feature-race winners with the horse, jockey and trainer. Filter by <b>sector</b>, sort by newest, class or track, and tap ▶ to watch a replay. Race grade is shown as <b>Class</b>." },
  { keys:['fantasy','team','squad','pick','salary','cap','budget','captain','trade','points','score','scoring','stable','draft','player','market'],
    answer:"<b>Fantasy</b> is where you build a stable! You get a <b>$2,000,000 cap</b> for <b>7 picks (5 jockeys + 2 trainers)</b>. Tap players in the Market to add them — the budget bar updates live. Nominate one jockey as <b>Captain</b> (the gold “C”) for <b>2× points</b>. You get 3 free trades per carnival; extra trades cost −30 pts. Scoring: jockeys 50/25/10/5, trainers 30/15/8/3 per runner, all multiplied by the race grade (×3 G1, ×2 G2, ×1.5 G3, ×1.2 Listed)." },
  { keys:['superstar','conflict','mcdonald','waller','expensive','afford','warning'],
    answer:"That's the <b>Superstar Conflict</b> alert! If you pick both James McDonald ($750k) and Chris Waller ($750k), you've spent $1.5M and only $500k is left for your other 5 slots — about $100k each. It's allowed, but it squeezes the rest of your stable. The cap bar turns red to warn you." },
  { keys:['menu','activation','activations','golden mingle','sign the x','lagoon','drinks cart','on-course','website','link','everest','kosciuszko','mingle','team thoroughbred','social','podcast','instagram','facebook','follow'],
    answer:"The new <b>Experience</b> tab has our on‑course experiences — <b>Sign the X</b>, the <b>Everest Lagoon Drinks Cart</b> and <b>The Golden Mingle</b> (tap it to open the live experience). Our network links — <a href='https://www.racingnsw.com.au' target='_blank'>Racing NSW</a>, <a href='https://www.theeverest.com.au' target='_blank'>The Everest</a>, The Kosciuszko, Country Championships, <a href='https://www.teamthoroughbred.com.au' target='_blank'>Team Thoroughbred</a> — plus socials and podcasts now live under your profile (top‑right)." },
  { keys:['account','setting','settings','profile','ticket','login','sign','notification','accessibility','text size','membership'],
    answer:"Tap the <b>circle in the top-right</b> to open your account. From there you can manage tickets &amp; passes (with <b>Add to Wallet</b> and <b>Share</b>), <b>Getting Here &amp; Travel</b>, race alerts, text size &amp; accessibility, membership and payments — and toggle me, Dash, on or off." },
  { keys:['map','course','track map','toilet','food','first aid','golden mingle','facilities','randwick','rosehill','canterbury','getting here','travel','parking','transport','train','light rail','bus','how do i get'],
    answer:"Tap the <b>map button in the top‑left</b> to open the interactive <b>Course Map</b> — pinch to zoom, drag to pan, with toggle pins for Entry &amp; Gates, Food &amp; Bars, Amenities, First Aid and the Golden Mingle." },
  { keys:['turn you off','turn off','hide you','disable','switch you off','remove you','close you','dash off','toggle','get rid'],
    answer:"No worries! Open your account (the <b>top-right circle</b>), then flick the <b>Dash AI Companion</b> switch off — my bubble will disappear. You can switch me back on from the same spot whenever you need a hand." },
  { keys:['hello','hi','hey','help','what can you do','who are you','dash'],
    answer:"Hey, I'm <b>Dash</b> 🐎 — your Racing NSW guide. I can explain any part of the app: Home, Schedule, Results, Fantasy and the Menu. Tap a suggestion below, or just ask me anything." },
  { keys:['everest','the everest','20m','randwick slot','slot race'],
    answer:"<b>The Everest</b> is the world's richest turf race. <b>2026 marks its 10th anniversary</b> — run at <b>Royal Randwick</b> for a <b>$20M</b> prize pool. On the same day, <b>The Kosciuszko</b> gives country horses a ballot-only shot at <b>$1.3M</b>." },
  { keys:['championships','star championships','two days','doncaster','queen elizabeth'],
    answer:"<b>The Championships</b> are two Group 1 days across <b>Royal Randwick</b> and <b>Rosehill Gardens</b>, headlined by races like the Doncaster Mile and Queen Elizabeth Stakes. You'll find them on the <b>Schedule</b> tab in April." },
  { keys:['venue','venues','track list','where do they race','rosehill','warwick','newcastle','kembla','wagga','scone'],
    answer:"Racing NSW covers metro tracks like <b>Royal Randwick</b>, <b>Rosehill Gardens</b>, <b>Canterbury Park</b> and <b>Warwick Farm</b>, plus provincial and country venues such as Newcastle, Gosford, Kembla Grange, Wagga Wagga, Dubbo and Scone. Use the <b>Sector filter</b> on Schedule to browse them." },
  { keys:['leaderboard','rank','ranking','league','friends','points total','position'],
    answer:"In <b>Fantasy</b>, tap <b>Leaderboard</b> to see your global rank (you're <b>#47 of 12,834</b> on 1,284 pts), the top 10 with trend arrows, and your private <b>friends league</b>. You can invite mates from there too." },
  { keys:['season','autumn','spring','winter','summer','carnival when','calendar'],
    answer:"The fantasy season runs in four blocks: <b>Autumn Carnival</b> (Feb–Apr), <b>Winter Series</b> (May–Jul), <b>Spring Carnival</b> (Aug–Nov) and <b>Summer Series</b> (Dec–Jan). You get a free full-squad reset between Autumn and Spring." },
];

/* ── 2.x DASH · Claude-powered companion ──────────────────────────
   respondTo() now calls the Anthropic Messages API with conversation
   memory and an app-aware system prompt. When the app is opened as a
   local file (no proxy), the fetch fails and Dash gracefully falls
   back to the local DASH_KB engine — the UI is identical either way. */

/* 2.4 — expanded system prompt */
/* ╔══════════════════════════════════════════════════════════════╗
   ║ SECTION 7 · DASH COMPANION (secondary)                       ║
   ╚══════════════════════════════════════════════════════════════╝ */
const DASH_SYSTEM = `You are Dash, the official AI companion for the Racing NSW app.
You are friendly, knowledgeable about Australian thoroughbred racing, and you know
every feature of this app: Home (live feed with a Race-Day Mode toggle of Live/Today/News,
universal search, course maps, Sky Thoroughbred Central player), Schedule (sector filter
Metro/Provincial/Country, tappable cards that open full race programmes, track-condition
badges), Results (sector filter, sort by newest/class/track, expandable cards with full
field, margins and Win/Exacta/Trifecta dividends, View Form), Fantasy (salary cap $2,000,000,
7 picks = 5 jockeys + 2 trainers, Captain mechanic 2x points, scoring J 50/25/10/5,
T 30/15/8/3 per runner, race multipliers G1 x3, G2 x2, G3 x1.5, Listed x1.2, the Superstar
Conflict alert when McDonald and Waller are both picked at $750k, a Leaderboard with global
rank and a friends league, and Past Rounds history), and Experience (on-course experiences: Sign the X, the Everest Lagoon Drinks Cart, and The
Golden Mingle, which opens as a live embedded experience). The account circle (top-right) holds
tickets, race alerts, the Racing NSW network links, socials, podcasts, accessibility and membership.

VENUES you know: Royal Randwick, Rosehill Gardens, Canterbury Park, Warwick Farm, Newcastle,
Kembla Grange, Hawkesbury, Gosford, Wyong, Bathurst, Orange, Dubbo, Albury, Wagga Wagga,
Goulburn, Coffs Harbour, Grafton, Scone.
EVENTS: The Everest 2026 is the 10th anniversary, run at Royal Randwick for a $20M prize pool.
The Championships are two days across Randwick and Rosehill featuring Group 1 racing.
The Kosciuszko is a ballot-only country sprint worth $1.3M, run on the same day as The Everest.
SEASON STRUCTURE: Autumn Carnival (Feb-Apr), Winter Series (May-Jul), Spring Carnival (Aug-Nov),
Summer Series (Dec-Jan).
You also know general racing: track conditions (Firm/Good/Soft/Heavy), barrier draws, and race
classes (Maiden, Benchmark, Class, Listed, Group). Keep replies under 80 words. Use <b></b>
HTML tags for key terms. Respond in Australian English. Do not invent real-time odds or live results.`;

/* 2.2 — conversation memory */
let chatHistory = [];

/* Off-topic redirect — used as the offline fallback default */
const DASH_OFFTOPIC =
  "That one's outside the app, so I can't help directly — but our websites might! Try <a href='https://www.racingnsw.com.au' target='_blank'>racingnsw.com.au</a> for racing info, form and news, <a href='https://www.theeverest.com.au' target='_blank'>theeverest.com.au</a> for our marquee events, or <a href='https://www.teamthoroughbred.com.au' target='_blank'>teamthoroughbred.com.au</a> for life after racing. Anything about the app itself, though — ask away!";

/* Starter chips (first message only) */
const DASH_SUGGESTIONS = [
  "How does Fantasy work?",
  "What's the Superstar Conflict?",
  "How do I search a horse?",
  "What's the Sector filter?",
  "How do I read Results?",
  "Tell me about The Everest",
  "How do I turn you off?",
];

/* 2.3 — contextual follow-up chip sets, chosen from the last reply */
const CHIP_SETS = {
  fantasy:['Who\u2019s the best value jockey?','What\u2019s a Captain pick?','How do trades work?','What is the Superstar Conflict?'],
  schedres:['Filter by Metro only','What\u2019s a G1 race?','When\u2019s the next race day?','Show me how Results work'],
  menu:['Tell me about The Everest','What podcasts do you have?','How do I follow Racing NSW?','What is Team Thoroughbred?'],
  default:DASH_SUGGESTIONS,
};
function pickChipSet(text){
  const t=(text||'').toLowerCase();
  if(/(fantasy|captain|cap|trade|superstar|jockey|trainer|squad|points|score)/.test(t)) return 'fantasy';
  if(/(schedule|result|race day|sector|metro|provincial|country|class|g1|g2|replay|programme)/.test(t)) return 'schedres';
  if(/(everest|kosciuszko|menu|website|podcast|social|team thoroughbred|follow)/.test(t)) return 'menu';
  return 'default';
}

/* Local keyword fallback (the original KB engine).
   Whole-word / phrase matching avoids false hits (e.g. 'hi' inside
   'championships'); scoring weights by key length so a specific key
   like 'championships' outranks a generic one like 'when'. */
function localAnswer(q){
  const t=' '+q.toLowerCase().replace(/[^a-z0-9& ]+/g,' ')+' ';
  const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  let best=null, bestScore=0;
  for(const intent of DASH_KB){
    let score=0;
    for(const k of intent.keys){
      const hit = k.includes(' ')
        ? t.includes(' '+k+' ') || t.includes(k)
        : new RegExp('\\b'+esc(k)+'\\b').test(t);
      if(hit) score += k.length;          // longer key = more specific
    }
    if(score>bestScore){ bestScore=score; best=intent; }
  }
  return bestScore>0 ? best.answer : DASH_OFFTOPIC;
}

/* 2.1 — async Claude API call with memory; offline → local fallback */
async function respondTo(q){
  const msgs = [...chatHistory.slice(-6), { role:'user', content:q }];
  try{
    // Goes to our own proxy (see api/dash.js), which holds the model key
    // server-side. No absolute URL and no key ever lives in www/.
    const text = await window.DataService.askDash(msgs, DASH_SYSTEM);
    return text || localAnswer(q);
  }catch(e){
    return localAnswer(q);   // graceful offline fallback
  }
}

/* Render chips for a given set key (2.3) */
function renderChips(setKey){
  const chips = CHIP_SETS[setKey] || DASH_SUGGESTIONS;
  document.getElementById('chatChips').innerHTML = chips
    .map(q=>`<button class="chip" onclick="askChat('${q.replace(/'/g,"\\'")}')">${q}</button>`).join('');
}

/* Append a message bubble (sender: 'ai' | 'user') */
function pushMsg(html, sender){
  const log=document.getElementById('chatLog');
  const wrap=document.createElement('div');
  wrap.className = sender==='user' ? 'flex justify-end' : 'flex';
  wrap.innerHTML = `<div class="msg msg-${sender}">${html}</div>`;
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
}

/* Show typing indicator until the (awaited) reply resolves */
async function dashReply(userText){
  const log=document.getElementById('chatLog');
  const t=document.createElement('div');
  t.className='flex'; t.id='typingRow';
  t.innerHTML=`<div class="msg msg-ai typing"><span></span><span></span><span></span></div>`;
  log.appendChild(t); log.scrollTop=log.scrollHeight;

  const answer = await respondTo(userText);
  t.remove();
  pushMsg(answer,'ai');
  // 2.2 — record memory
  chatHistory.push({ role:'user', content:userText });
  chatHistory.push({ role:'assistant', content:answer.replace(/<[^>]+>/g,'') });
  // 2.3 — refresh chips contextually based on the reply
  renderChips(pickChipSet(answer + ' ' + userText));
}

let chatStarted=false;
function openChat(){
  document.getElementById('chatWrap').classList.add('open');
  document.getElementById('dashBubble').style.opacity='0';
  document.getElementById('dashPing').style.display='none';
  if(!chatStarted){
    chatStarted=true;
    renderChips('default');
    pushMsg("G'day! I'm <b>Dash</b> 🐎 your Racing NSW companion. Ask me how anything in the app works — or tap a question below to get started.", 'ai');
  }
}
function closeChat(){ document.getElementById('chatWrap').classList.remove('open');
  if(dashOn) document.getElementById('dashBubble').style.opacity=''; }

/* Send from the input box */
async function sendChat(){
  const input=document.getElementById('chatInput');
  const q=input.value.trim();
  if(!q) return;
  pushMsg(q,'user'); input.value='';
  await dashReply(q);
}
/* Send from a suggestion chip */
async function askChat(q){
  pushMsg(q,'user');
  await dashReply(q);
}

/* Settings toggle — show/hide the floating bubble */
let dashOn=true;
function toggleDash(){
  dashOn=!dashOn;
  const tg=document.getElementById('dashToggle'), kn=document.getElementById('dashKnob');
  const bubble=document.getElementById('dashBubble');
  tg.setAttribute('aria-checked', dashOn);
  tg.style.background = dashOn ? 'linear-gradient(180deg,#8FCBFF,#5BB8FF)' : 'rgba(255,255,255,.18)';
  kn.style.left = dashOn ? '24px' : '3px';
  bubble.classList.toggle('hidden', !dashOn);
  if(!dashOn) closeChat();
  toast(dashOn ? '🐎 Dash is on — tap the bubble anytime.' : 'Dash hidden. Turn me back on here whenever you like.');
}

/* ── 5.7 Editable user name + avatar initials sync ── */
function getUserName(){
  try{ return localStorage.getItem('rnsw_username') || 'Jack Webster'; }catch(e){ return 'Jack Webster'; }
}
function initialsOf(name){
  return (name.trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('') || 'JW').toUpperCase();
}
function applyUserName(){
  const name=getUserName(), ini=initialsOf(name);
  const inp=document.getElementById('userNameInput'); if(inp) inp.value=name;
  const ha=document.getElementById('headerAvatar'); if(ha) ha.textContent=ini;
  const sa=document.getElementById('sheetAvatar'); if(sa) sa.textContent=ini;
  const mn=document.getElementById('memName'); if(mn) mn.textContent=name;
  updateAuthUI();
}
function saveUserName(){
  const inp=document.getElementById('userNameInput');
  let v=(inp.value||'').trim(); if(!v) v='Jack Webster';
  try{ localStorage.setItem('rnsw_username', v); }catch(e){}
  applyUserName();
}

/* Account sheet */
function openSheet(){ document.getElementById('sheetWrap').classList.add('open');
  updateAuthUI();
  document.getElementById('dashBubble').style.opacity='0'; }
function closeSheet(){ document.getElementById('sheetWrap').classList.remove('open');
  if(dashOn) document.getElementById('dashBubble').style.opacity=''; }

/* Toast */
let toastTimer;
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.style.opacity=1;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.style.opacity=0,2600);
}

/* Pin the fantasy budget tracker just below the sticky header.
   Measured at runtime so it tracks real header height across
   font loading and viewport changes. */
function layoutSticky(){
  const hdr=document.getElementById('appHeader');
  const b=document.getElementById('budgetSticky');
  // hdr.offsetTop already includes the top-spacer (safe-area/top-chrome) height,
  // so this tracks the real header position rather than a hardcoded 56px.
  if(hdr&&b) b.style.top=(hdr.offsetTop+hdr.offsetHeight-10)+'px';
}
window.addEventListener('resize',layoutSticky);
window.addEventListener('load',layoutSticky);
window.addEventListener('orientationchange',layoutSticky);

/* Scale the device-preview frame to fit the desktop viewport.
   Only runs in frame mode (≥900px wide AND ≥600px tall — matches the CSS
   @media guard); in full-bleed mode it clears any transform so the app
   fills the viewport natively. */
function fitPhone(){
  const phone=document.getElementById('phone');
  const framed = window.innerWidth>=900 && window.innerHeight>=600;
  if(!framed){ phone.style.transform=''; phone.style.marginBottom=''; return; }
  const s=Math.round(Math.min(1,(window.innerHeight-56)/876,(window.innerWidth-32)/417)*100)/100;
  phone.style.transform=`scale(${s})`;
  phone.style.marginBottom = `${-(876*(1-s))}px`;
}
window.addEventListener('resize',fitPhone);
window.addEventListener('orientationchange',fitPhone);

/* ── 3.5 · Onboarding ─────────────────────────────────────────── */
/* ╔══════════════════════════════════════════════════════════════╗
   ║ SECTION 8 · ONBOARDING (first run only)                      ║
   ╚══════════════════════════════════════════════════════════════╝ */
let obIndex = 0;
function goOnboard(i){
  obIndex = Math.max(0, Math.min(2, i));
  const track = document.getElementById('obTrack');
  if(track) track.style.transform = 'translateX(-' + (obIndex*33.3333) + '%)';
  for(let d=0; d<3; d++){
    const dot = document.getElementById('ob-dot-'+d);
    if(dot) dot.classList.toggle('on', d===obIndex);
  }
}
function obNext(i){ goOnboard(i); }
function finishOnboarding(allow){
  try{ localStorage.setItem('rnsw_onboarded','1'); }catch(e){}
  const ob = document.getElementById('onboard');
  if(ob) ob.classList.add('gone');
  if(allow) toast("Notifications on \u2014 we'll keep you posted. \ud83d\udd14");
}
function maybeShowOnboarding(){
  const ob = document.getElementById('onboard');
  if(!ob) return;
  let seen=false;
  try{ seen = localStorage.getItem('rnsw_onboarded')==='1'; }catch(e){}
  if(seen){ ob.classList.add('gone'); }
  else { ob.classList.remove('gone'); goOnboard(0); }
}

/* ── First-run login gate (guest-first) ───────────────────────────
   The app is fully browsable as a guest; an account is only needed for
   Fantasy, linked tickets and The Golden Mingle. rnsw_auth = '' (never
   chosen) | 'guest' | 'member'. requireAccount()/isSignedIn() are ready
   to gate those features when a real auth backend is wired. */
function authStatus(){ try{ return localStorage.getItem('rnsw_auth')||''; }catch(e){ return ''; } }
function isSignedIn(){ return authStatus()==='member'; }
function setAuth(kind){ try{ localStorage.setItem('rnsw_auth',kind); }catch(e){} }

let _authFirstRun=false, pendingAction=null;
function openAuthGate(ctx){
  const g=document.getElementById('authGate'); if(!g) return;
  if(ctx) _authFirstRun=false;
  const h=document.getElementById('authHeadline'), s=document.getElementById('authSub');
  if(h) h.textContent = (ctx&&ctx.title) ? ctx.title : 'Welcome to Racing NSW';
  if(s) s.textContent = (ctx&&ctx.sub) ? ctx.sub : 'Browse live racing, results, schedules and more — no account needed.';
  g.classList.remove('gone');
}
function maybeShowAuthGate(){
  const g=document.getElementById('authGate'); if(!g) return false;
  if(authStatus()){ g.classList.add('gone'); return false; }   // already chose guest/member
  _authFirstRun=true; openAuthGate(null); return true;          // first run → show gate, defer onboarding
}
function _dismissAuthGate(){ const g=document.getElementById('authGate'); if(g) g.classList.add('gone'); }
function _afterAuth(){
  updateAuthUI();
  if(pendingAction){ const a=pendingAction; pendingAction=null; a(); return; }
  if(_authFirstRun){ _authFirstRun=false; maybeShowOnboarding(); }
}
function continueAsGuest(){
  if(!authStatus()) setAuth('guest');   // never downgrade a member
  _dismissAuthGate(); _afterAuth();
}
function authEmailSignIn(){
  const em=document.getElementById('authEmail'), nm=document.getElementById('authName');
  const email=((em&&em.value)||'').trim(), name=((nm&&nm.value)||'').trim();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ if(em){ em.classList.add('err'); em.focus(); } toast('Enter a valid email address'); return; }
  if(em) em.classList.remove('err');
  setAuth('member');
  try{ localStorage.setItem('rnsw_email',email); }catch(e){}
  const display = name || email.split('@')[0].replace(/[._-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  try{ localStorage.setItem('rnsw_username',display); }catch(e){}
  applyUserName();
  _dismissAuthGate();
  toast('Signed in — welcome, '+display.split(' ')[0]+' 👋');
  _afterAuth();
}
/* Reusable gate for member-only features (wire into Fantasy/tickets/Mingle later). */
function requireAccount(ctx,onOk){ if(isSignedIn()) return onOk(); pendingAction=onOk; openAuthGate(ctx); }
function signOut(){ setAuth('guest'); try{ localStorage.removeItem('rnsw_email'); }catch(e){} updateAuthUI(); toast('You’ve been signed out'); }
function updateAuthUI(){
  const signedIn=isSignedIn();
  const sub=document.getElementById('sheetSub');
  if(sub){ let email=''; try{ email=localStorage.getItem('rnsw_email')||''; }catch(e){}
    sub.textContent = signedIn ? ('Signed in'+(email?' · '+email:'')) : 'Browsing as guest — sign in to save your details'; }
  const inRow=document.getElementById('authSignInRow'); if(inRow) inRow.classList.toggle('hidden', signedIn);
  const outRow=document.getElementById('signOutRow'); if(outRow) outRow.classList.toggle('hidden', !signedIn);
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║ SECTION 9 · BOOT                                             ║
   ╚══════════════════════════════════════════════════════════════╝ */
/* Boot.
   Data first, then paint. Chrome that does not depend on data (auth gate,
   onboarding, phone fit) runs immediately so first paint is never held up
   by the network; the data-backed renders run once loadAppData() settles.
   In local mode that resolves on the next microtask, so this is
   indistinguishable from the previous synchronous boot. */

/* 5.2 — restore persisted fantasy squad (picks + captain).
   Validation needs the roster, so it runs after the load. */
function restorePicks(){
  try{
    const raw = JSON.parse(localStorage.getItem('rnsw_fantasy_picks') || 'null');
    if(raw){
      const arr = Array.isArray(raw) ? raw : (raw.picks || []);
      state.picks = arr.filter(id => DATA.players.some(p => p.id === id));
      const cap = Array.isArray(raw) ? null : raw.captainId;
      if(cap && state.picks.includes(cap) && byId(cap).role === 'jockey') state.captainId = cap;
    }
  }catch(e){}
}

/* Everything that reads DATA. Safe to call again after a refresh. */
function renderAll(){
  setSchedSector(state.schedSector);
  renderResults();
  buildMenu();
  renderActivations();
  renderStories();
  renderShows();
  renderVideos();         // stage 4 — Home videos carousel
  renderPodcasts();       // stage 4 — Home podcasts
  renderDiary();          // stage 4 — Schedule race diary
  renderReplays();        // stage 4 — Results replays carousel
  renderLiveFeed();       // 3.4 — pre-build Race-Day Mode feeds
  renderTodayFeed();
  renderPastRounds();     // 3.3 — fantasy points history
  render();               // budget, grid, roster, cap alert (reflects restored picks)
  renderFreshness();      // stage 5 — "last updated" indicators
  layoutSticky();
}

applyUserName();          // 5.7 — sync username into header/sheet/membership
if(!maybeShowAuthGate()) maybeShowOnboarding();  // login gate on first run, else onboarding

/* 5.1 — initialise from URL hash so #/fantasy etc. deep-links work */
(function(){
  const valid = ['home','schedule','results','fantasy','activations'];
  const h = (window.location.hash || '').replace('#/','');
  if(valid.includes(h)) switchTab(h);
})();

fitPhone();

const appReady = loadAppData().then(()=>{
  restorePicks();
  renderAll();
});
