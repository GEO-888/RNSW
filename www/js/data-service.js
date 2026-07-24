/* ════════════════════════════════════════════════════════════════
   RACING NSW · DATA SERVICE
   ----------------------------------------------------------------
   The single door between the screens and their data. No render
   function anywhere else in www/ should read a data constant, build
   a URL, or call fetch() directly.

   ADAPTER PATTERN
     RNSW_CONFIG.DATA_SOURCE === 'local'  → return the bundled sample
       data below. This is the shipping default until the Racing
       Australia key exists.
     RNSW_CONFIG.DATA_SOURCE === 'api'    → GET our own endpoints at
       ${API_BASE_URL}/api/racing/*. Those are the Vercel proxy, which
       holds the key server-side. The app NEVER calls Racing Australia
       directly — the key must not reach the client.

   EVERY PUBLIC METHOD RETURNS A PROMISE FOR THE SAME ENVELOPE
     {
       data,              the payload — shape is per-domain
       source,            'local' | 'api' | 'cache'
       fetchedAt,         epoch ms the payload was obtained
       stale,             true when serving past its TTL, or after a
                          failed refresh (show the "last updated" hint)
       error,             null, or a short reason the live call failed
     }
   Callers read `.data` and may read `.stale`/`.fetchedAt` for the
   freshness indicator. Because the envelope never rejects, a screen
   can always render something — bad signal at a racecourse degrades
   to stale or bundled content, never a blank screen.

   SECTIONS
     1 · Local dataset      4 · Adapters
     2 · Cache              5 · Public API
     3 · Transport
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var CFG = global.RNSW_CONFIG || {};

  /* ╔══════════════════════════════════════════════════════════════╗
     ║ SECTION 1 · LOCAL DATASET                                    ║
     ║ Moved verbatim from app.js — this is now its only home.      ║
     ╚══════════════════════════════════════════════════════════════╝ */

  /* Tier from price band */
  var tierOf = function (p) {
    return p >= 500000 ? 'Elite' : p >= 200000 ? 'Power' : p >= 120000 ? 'Solid' : 'Value';
  };

  /* JOCKEYS — top 20 by computed Autumn fantasy points */
  var JOCKEYS = [
    ['James McDonald', 750, 3342.5, 93, 26, 10],
    ['Zac Lloyd',      440, 1952.0, 89, 14, 3],
    ['Tommy Berry',    290, 1295.0, 80,  9, 0],
    ['Jason Collett',  250, 1112.5, 88,  8, 1],
    ['Nash Rawiller',  225, 1002.5, 55,  5, 1],
    ['Chad Schofield', 215,  949.5, 53,  7, 1],
    ['Rachel King',    200,  885.0, 55,  8, 1],
    ['Tim Clark',      190,  841.5, 64,  5, 1],
    ['Kerrin McEvoy',  130,  570.0, 34,  4, 1],
    ['Craig Williams', 120,  542.5, 36,  3, 1],
    ['Adam Hyeronimus',115,  517.5, 40,  3, 0],
    ['Tyler Schiller',  90,  397.5, 58,  2, 0],
    ['Tom Sherry',      85,  380.0, 39,  2, 0],
    ['Dylan Gibbons',   75,  341.0, 64,  3, 0],
    ['Sam Clipperton',  70,  255.0, 34,  2, 0],
    ['Regan Bayliss',   70,  255.0, 36,  1, 0],
    ['Damian Lane',     70,  230.0, 18,  2, 0],
    ['Jamie Melham',    70,  200.0, 11,  1, 1],
    ['Billy Egan',      70,  192.5,  5,  0, 0],
    ['Winona Costin',   70,  177.5, 17,  2, 0],
  ].map(function (row, i) {
    var name = row[0], k = row[1], pts = row[2], rides = row[3], wins = row[4], g1 = row[5];
    return {
      id: 'j' + (i + 1), role: 'jockey', name: name, price: k * 1000, pts: pts, tier: tierOf(k * 1000),
      note: pts.toLocaleString() + ' pts · ' + wins + ' wins (' + g1 + ' G1) · ' + rides + ' rides'
    };
  });

  /* TRAINERS — top 12 by computed Autumn fantasy points (score per runner) */
  var TRAINERS = [
    ['Chris Waller',                       750, 2982.0, 192, 31, 12],
    ['Ciaron Maher',                       185,  726.2,  66,  9,  1],
    ['Gai Waterhouse & Adrian Bott',       160,  630.6,  67,  4,  1],
    ['Michael Freedman',                   145,  570.5,  48,  5,  1],
    ['Bjorn Baker',                        140,  552.0,  77,  7,  1],
    ['Joseph Pride',                       100,  395.0,  43,  4,  0],
    ['Annabel & Rob Archibald',             90,  345.0,  51,  4,  0],
    ['Kris Lees',                           90,  266.5,  34,  3,  1],
    ['Matthew Smith',                       90,  257.5,  18,  2,  1],
    ['Peter G Moody & Katherine Coleman',   90,  234.0,  12,  2,  2],
    ['Peter Snowden',                       90,  223.5,  25,  4,  0],
    ['Gerald Ryan & Sterling Alexiou',      90,  211.6,  13,  3,  0],
  ].map(function (row, i) {
    var name = row[0], k = row[1], pts = row[2], runners = row[3], wins = row[4], g1 = row[5];
    return {
      id: 't' + (i + 1), role: 'trainer', name: name, price: k * 1000, pts: pts, tier: tierOf(k * 1000),
      note: pts.toLocaleString() + ' pts · ' + wins + ' wins (' + g1 + ' G1) from ' + runners + ' runners'
    };
  });

  var PLAYERS = JOCKEYS.concat(TRAINERS);

  /* Build a representative 6-race programme for any meeting. The feature
     race (carrying the meeting's badge/class) is slotted at R6. */
  function prizeNum(p) {
    if (!p) return 0;
    var m = /([\d.]+)\s*([mk])/i.exec(p);
    return m ? parseFloat(m[1]) * (m[2].toLowerCase() === 'm' ? 1000 : 1) : 0;
  }
  function makeRaces(d) {
    var base = [
      { n:1, name:'Maiden Plate',          cls:'Maiden',  dist:'1100m', time:'11:35 AM' },
      { n:2, name:'Class 1 Handicap',      cls:'Class 1', dist:'1200m', time:'12:15 PM' },
      { n:3, name:'Benchmark 72 Handicap', cls:'BM72',    dist:'1400m', time:'12:55 PM' },
      { n:4, name:'Benchmark 88 Handicap', cls:'BM88',    dist:'1600m', time:'1:35 PM' },
      { n:5, name:'The Gateway (Listed)',  cls:'Listed',  dist:'1300m', time:'2:15 PM' },
    ];
    var feats = (d.feats && d.feats.length) ? d.feats.slice() : (d.feat ? [d.feat] : []);
    feats.sort(function (a, b) { return prizeNum(a.prize) - prizeNum(b.prize); }); // richest runs last (climax)
    var times = ['2:55 PM', '3:35 PM', '4:15 PM', '4:55 PM', '5:35 PM'];
    feats.forEach(function (f, i) {
      base.push({ n:6+i, name:f.name, cls:d.badge, dist:f.dist||'1200m', time:times[i]||'5:35 PM', feature:true, prize:f.prize });
    });
    return base;
  }

  /* SCHEDULE — sector / venue / feature-day (blank if none) / date. */
  var RACE_DAYS = [
    // ════ 2026 SYDNEY SPRING CARNIVAL — feature schedule (19 Sep – 21 Nov 2026, upcoming only) ════
    { sector:'metro', venue:'Royal Randwick',   day:'7 Stakes Day',        date:'19 September 2026', badge:'G1',      condition:'Good 4',
      feats:[{name:'7 Stakes', dist:'1100m', prize:'$1m'}] },
    { sector:'metro', venue:'Rosehill Gardens', day:'Golden Rose Day',     date:'26 September 2026', badge:'G1',      condition:'Good 4',
      feats:[{name:'Golden Rose Stakes', dist:'1400m', prize:'$1m'}] },
    { sector:'metro', venue:'Royal Randwick',   day:'Epsom Handicap Day',  date:'3 October 2026',   badge:'G1',      condition:'Good 3',
      feats:[{name:'Epsom Handicap', dist:'1600m', prize:'$1.5m'}] },
    { sector:'metro', venue:'Rosehill Gardens', day:'Hill Stakes Day',     date:'10 October 2026',  badge:'G2',      condition:'Good 4',
      feats:[{name:'Hill Stakes', dist:'2000m', prize:'$2m'}] },
    { sector:'metro', venue:'Royal Randwick',   day:'TAB Everest Day',     date:'17 October 2026',  badge:'G1',      condition:'Good 4',
      feats:[{name:'The TAB Everest', dist:'1200m', prize:'$20m'},
             {name:'King Charles III Stakes', dist:'1600m', prize:'$5m'},
             {name:'The Kosciuszko', dist:'1200m', prize:'$2m'},
             {name:'Sydney Stakes', dist:'1200m', prize:'$2m'}] },
    { sector:'metro', venue:'Royal Randwick',   day:'Spring Champion Day', date:'24 October 2026',  badge:'G1',      condition:'Good 4',
      feats:[{name:'Spring Champion Stakes', dist:'2000m', prize:'$2m'},
             {name:'The Invitation', dist:'1400m', prize:'$2m'}] },
    { sector:'metro', venue:'Royal Randwick',   day:'Golden Eagle Day',    date:'31 October 2026',  badge:'G1',      condition:'Good 4',
      feats:[{name:'The Golden Eagle', dist:'1500m', prize:'$10m'}] },
    { sector:'metro', venue:'Royal Randwick',   day:'The Big Dance',       date:'3 November 2026',  badge:'Feature', condition:'Good 4',
      feats:[{name:'The Big Dance', dist:'1600m', prize:'$3m'}] },
    { sector:'metro', venue:'Rosehill Gardens', day:'Five Diamonds Day',   date:'7 November 2026',  badge:'Feature', condition:'Good 4',
      feats:[{name:'The Five Diamonds', dist:'1500m', prize:'$2m'},
             {name:'Golden Gift', dist:'1100m', prize:'$1m'}] },
    { sector:'prov',  venue:'Newcastle',        day:'The Hunter',          date:'14 November 2026', badge:'Feature', condition:'Good 4',
      feats:[{name:'The Hunter', dist:'1300m', prize:'$1m'}] },
    { sector:'prov',  venue:'Kembla Grange',    day:'The Gong',            date:'21 November 2026', badge:'Feature', condition:'Good 4',
      feats:[{name:'The Gong', dist:'1600m', prize:'$1m'}] },
  ].map(function (d) {
    var out = {}; for (var k in d) out[k] = d[k];
    out.races = makeRaces(d);
    return out;
  });

  /* RESULTS — feature-race winners by sector. */
  var RESULTS = [
    { sector:'metro',  date:'25 Apr 2026', venue:'Royal Randwick',   race:'HMAS Sydney Handicap',      cls:'Open', winner:'Bangkok Hottie', jt:'A. Morgan / D. Payne',
      runners:[['1st','Bangkok Hottie','A. Morgan','D. Payne','—','1:10.32'],['2nd','Spring Tide','J. Collett','C. Waller','0.4L','1:10.39'],['3rd','Lochinvar','T. Berry','M. Dunn','1.1L','1:10.51'],['4th','Brigantine','R. King','K. Lees','2.0L','1:10.65']],
      div:{win:'$4.20', exacta:'$18.40', trifecta:'$96.70'} },
    { sector:'metro',  date:'18 Apr 2026', venue:'Royal Randwick',   race:'All Aged Stakes',           cls:'G1',   winner:'Beiwacht',       jt:'N. Rawiller / C. Waller',
      runners:[['1st','Beiwacht','N. Rawiller','C. Waller','—','1:21.05'],['2nd','Joliestar','J. McDonald','C. Waller','0.2L','1:21.08'],['3rd','Mr Brightside','C. Williams','Hayes','0.9L','1:21.20'],['4th','Lasqueti','T. Berry','M. Freedman','1.6L','1:21.33']],
      div:{win:'$3.10', exacta:'$11.20', trifecta:'$54.30'} },
    { sector:'metro',  date:'11 Apr 2026', venue:'Royal Randwick',   race:'Queen Elizabeth Stakes',    cls:'G1',   winner:'Sir Delius',     jt:'C. Williams / Waterhouse & Bott',
      runners:[['1st','Sir Delius','C. Williams','W. & Bott','—','2:00.41'],['2nd','Via Sistina','J. McDonald','C. Waller','0.3L','2:00.46'],['3rd','Fangirl','Z. Lloyd','C. Waller','1.2L','2:00.60'],['4th','Atishu','R. King','C. Waller','2.4L','2:00.78']],
      div:{win:'$6.80', exacta:'$32.10', trifecta:'$210.40'} },
    { sector:'metro',  date:'4 Apr 2026',  venue:'Royal Randwick',   race:'Doncaster Mile',            cls:'G1',   winner:'Sheza Alibi',    jt:'J. Melham / Moody & Coleman',
      runners:[['1st','Sheza Alibi','J. Melham','Moody & Coleman','—','1:33.12'],['2nd','Anamoe','J. McDonald','C. Waller','0.1L','1:33.13'],['3rd','Pride Of Jenni','T. Sherry','C. McDonald','0.8L','1:33.25'],['4th','Cylinder','N. Rawiller','J. Pride','1.5L','1:33.40']],
      div:{win:'$8.40', exacta:'$41.60', trifecta:'$302.10'} },
    { sector:'country',date:'4 Apr 2026',  venue:'Royal Randwick',   race:'Country Championships Final', cls:'Country Champs', winner:'Western Whisper', jt:'B. Nock / K. Lees',
      runners:[['1st','Western Whisper','B. Nock','K. Lees','—','1:24.55'],['2nd','Riverina Rebel','A. Roper','local','0.6L','1:24.64'],['3rd','Dust Devil','S. Clipperton','M. Smith','1.3L','1:24.77'],['4th','Outback Oasis','J. Parr','local','2.1L','1:24.90']],
      div:{win:'$5.50', exacta:'$24.80', trifecta:'$140.20'} },
    { sector:'metro',  date:'28 Mar 2026', venue:'Rosehill Gardens', race:'Tancred Stakes',            cls:'G1',   winner:'Aeliana',        jt:'J. McDonald / C. Waller',
      runners:[['1st','Aeliana','J. McDonald','C. Waller','—','2:28.30'],['2nd','Knight’s Choice','T. Berry','Hayes','0.5L','2:28.38'],['3rd','Land Legend','Z. Lloyd','C. Waller','1.0L','2:28.46'],['4th','Sharp N Smart','C. Williams','Snowden','1.9L','2:28.61']],
      div:{win:'$2.40', exacta:'$9.80', trifecta:'$38.50'} },
    { sector:'metro',  date:'21 Mar 2026', venue:'Rosehill Gardens', race:'Golden Slipper',            cls:'G1',   winner:'Guest House',    jt:'Z. Lloyd / Price & Kent',
      runners:[['1st','Guest House','Z. Lloyd','Price & Kent','—','1:08.94'],['2nd','Marhoona','J. McDonald','J. Cummings','0.3L','1:08.99'],['3rd','Tentyris','T. Berry','G. Waterhouse','0.7L','1:09.06'],['4th','Switzerland','N. Rawiller','C. Maher','1.4L','1:09.18']],
      div:{win:'$7.10', exacta:'$36.40', trifecta:'$248.90'} },
    { sector:'metro',  date:'14 Mar 2026', venue:'Rosehill Gardens', race:'Coolmore Classic',          cls:'G1',   winner:'Lazzura',        jt:'J. McDonald / C. Waller',
      runners:[['1st','Lazzura','J. McDonald','C. Waller','—','1:22.66'],['2nd','Espiona','T. Berry','C. Waller','0.4L','1:22.73'],['3rd','Olentia','R. King','J. Thompson','1.1L','1:22.85'],['4th','Yagan','C. Schofield','C. Maher','2.0L','1:23.00']],
      div:{win:'$4.80', exacta:'$19.60', trifecta:'$102.30'} },
    { sector:'metro',  date:'7 Mar 2026',  venue:'Royal Randwick',   race:'Randwick Guineas',          cls:'G1',   winner:'Sheza Alibi',    jt:'L. Nolen / Moody & Coleman',
      runners:[['1st','Sheza Alibi','L. Nolen','Moody & Coleman','—','1:33.88'],['2nd','Riff Rocket','J. McDonald','J. O’Shea','0.6L','1:33.97'],['3rd','Capital Of Spain','Z. Lloyd','A. Cummings','1.2L','1:34.06'],['4th','Aft Cabin','T. Clark','W. & Bott','1.8L','1:34.18']],
      div:{win:'$3.60', exacta:'$14.70', trifecta:'$71.40'} },
    { sector:'prov',   date:'27 Feb 2026', venue:'Gosford',          race:'Provincial Champs Qualifier', cls:'Showcase', winner:'Coastal Run', jt:'T. Sherry / K. Lees',
      runners:[['1st','Coastal Run','T. Sherry','K. Lees','—','1:11.20'],['2nd','Sea Mist','J. Parr','M. Smith','0.5L','1:11.29'],['3rd','Tidal Pull','A. Collett','local','1.4L','1:11.42'],['4th','Breakwater','D. Gibbons','local','2.2L','1:11.55']],
      div:{win:'$5.90', exacta:'$26.30', trifecta:'$158.70'} },
    { sector:'metro',  date:'28 Feb 2026', venue:'Royal Randwick',   race:'Verry Elleegant Stakes',    cls:'G1',   winner:'Autumn Glow',    jt:'J. McDonald / C. Waller',
      runners:[['1st','Autumn Glow','J. McDonald','C. Waller','—','1:35.10'],['2nd','Pinstriped','T. Berry','C. Waller','0.2L','1:35.13'],['3rd','Stefi Magnetica','Z. Lloyd','M. Newnham','0.9L','1:35.25'],['4th','Treasurethe Moment','C. Williams','C. Maher','1.7L','1:35.40']],
      div:{win:'$2.10', exacta:'$7.40', trifecta:'$29.80'} },
    { sector:'metro',  date:'21 Feb 2026', venue:'Rosehill Gardens', race:'Hobartville Stakes',        cls:'G2',   winner:'Ninja',          jt:'T. Berry / M. Freedman',
      runners:[['1st','Ninja','T. Berry','M. Freedman','—','1:22.04'],['2nd','Lake Forest','J. McDonald','A. Cummings','0.3L','1:22.09'],['3rd','Manaal','R. King','J. Pride','1.0L','1:22.21'],['4th','Encap','C. Schofield','J. Sargent','1.9L','1:22.36']],
      div:{win:'$3.30', exacta:'$13.10', trifecta:'$62.90'} },
    { sector:'country',date:'15 Feb 2026', venue:'Tamworth',         race:'Country Champs Qualifier',  cls:'Country Champs', winner:'Bush Telegraph', jt:'A. Roper / local stable',
      runners:[['1st','Bush Telegraph','A. Roper','local','—','1:12.80'],['2nd','Red Dirt','J. Penza','local','0.7L','1:12.92'],['3rd','Saleyard','M. Cahill','local','1.5L','1:13.05'],['4th','Drovers Dog','B. Looker','local','2.3L','1:13.20']],
      div:{win:'$6.20', exacta:'$28.90', trifecta:'$172.40'} },
    { sector:'metro',  date:'14 Feb 2026', venue:'Royal Randwick',   race:'Light Fingers Stakes',      cls:'G2',   winner:'Savvy Hallie',   jt:'N. Rawiller / B. Widdup',
      runners:[['1st','Savvy Hallie','N. Rawiller','B. Widdup','—','1:09.70'],['2nd','Facile','J. McDonald','C. Waller','0.4L','1:09.77'],['3rd','Bridoodle','T. Clark','W. & Bott','1.1L','1:09.89'],['4th','Tribeca Star','C. Schofield','G. Portelli','2.0L','1:10.04']],
      div:{win:'$4.50', exacta:'$20.10', trifecta:'$108.60'} },
    { sector:'metro',  date:'7 Feb 2026',  venue:'Royal Randwick',   race:'Eskimo Prince Stakes',      cls:'G3',   winner:'Tempted',        jt:'C. Schofield / C. Maher',
      runners:[['1st','Tempted','C. Schofield','C. Maher','—','1:10.55'],['2nd','Atestof Faith','J. McDonald','C. Maher','0.5L','1:10.63'],['3rd','Storm Boy','Z. Lloyd','W. & Bott','1.3L','1:10.76'],['4th','Briasca','T. Berry','J. Pride','2.1L','1:10.90']],
      div:{win:'$5.10', exacta:'$23.40', trifecta:'$131.20'} },
  ];

  /* Map venue → sector for cross-tab filtering */
  var VENUE_SECTOR = {};
  RACE_DAYS.forEach(function (d) { VENUE_SECTOR[d.venue] = d.sector; });

  /* Universal search — real Autumn G1 winners from the workbook.
     `id` is the stable key getHorseProfile(id) resolves against. */
  var HORSES = [
    { id:'h1', type:'horse', name:'Autumn Glow', cs:'Bay mare, 5yo', trainer:'Chris Waller', owner:'Gerry Harvey', jockey:'James McDonald',
      record:'14: 9-3-1', last5:[1,1,2,1,1], note:'Won Verry Elleegant S (G1) — Randwick, 28 Feb', jPrice:'$750k', tPrice:'$750k' },
    { id:'h2', type:'horse', name:'Sheza Alibi', cs:'Chestnut filly, 3yo', trainer:'Moody & Coleman', owner:'Coolmore', jockey:'Jamie Melham',
      record:'9: 5-2-1', last5:[1,1,2,1,3], note:'Won Doncaster Mile (G1) — Randwick, 4 Apr', jPrice:'$70k', tPrice:'$90k' },
    { id:'h3', type:'horse', name:'Guest House', cs:'Bay colt, 2yo', trainer:'Price & Kent', owner:'Aquis Farm', jockey:'Zac Lloyd',
      record:'5: 3-1-0', last5:[1,3,1,2,1], note:'Won Golden Slipper (G1) — Rosehill, 21 Mar', jPrice:'$440k', tPrice:'$90k' },
    { id:'h4', type:'horse', name:'Aeliana', cs:'Bay mare, 4yo', trainer:'Chris Waller', owner:'Yulong', jockey:'James McDonald',
      record:'11: 6-2-1', last5:[1,1,4,1,2], note:'Won Tancred Stakes (G1) — Rosehill, 28 Mar', jPrice:'$750k', tPrice:'$750k' },
    { id:'h5', type:'horse', name:'Sir Delius', cs:'Bay gelding, 5yo', trainer:'Gai Waterhouse & Adrian Bott', owner:'Star Thoroughbreds', jockey:'Craig Williams',
      record:'18: 7-4-3', last5:[5,1,1,2,1], note:'Won Queen Elizabeth S (G1) — Randwick, 11 Apr', jPrice:'$120k', tPrice:'$160k' },
    { id:'h6', type:'horse', name:'Black Caviar', cs:'Bay mare (Legend)', trainer:'Peter Moody', owner:'Werrett Bloodstock', jockey:'Luke Nolen',
      record:'25: 25-0-0', last5:[1,1,1,1,1], note:'Undefeated Hall of Famer — exhibition entry', jPrice:'—', tPrice:'—' },
    { id:'h7', type:'horse', name:'Winx', cs:'Bay mare (Legend)', trainer:'Chris Waller', owner:'Magic Bloodstock', jockey:'Hugh Bowman',
      record:'43: 37-3-0', last5:[1,1,1,1,1], note:'33 straight wins — exhibition entry', jPrice:'—', tPrice:'$750k' },
    { id:'h8', type:'horse', name:'Nature Strip', cs:'Bay gelding (Legend)', trainer:'Chris Waller', owner:'Rod Lyons synd.', jockey:'James McDonald',
      record:'45: 24-6-3', last5:[1,1,2,1,1], note:'Champion sprinter — exhibition entry', jPrice:'$750k', tPrice:'$750k' },
    { id:'h9', type:'horse', name:'Anamoe', cs:'Bay stallion (Legend)', trainer:'James Cummings', owner:'Godolphin', jockey:'James McDonald',
      record:'25: 15-6-2', last5:[1,1,1,2,1], note:'Champion miler — exhibition entry', jPrice:'$750k', tPrice:'$120k' },
    { id:'h10', type:'horse', name:'Verry Elleegant', cs:'Bay mare (Legend)', trainer:'Chris Waller', owner:'syndicate', jockey:'James McDonald',
      record:'45: 16-9-5', last5:[1,2,1,1,3], note:'Melbourne Cup winner — exhibition entry', jPrice:'$750k', tPrice:'$750k' },
  ];

  /* Jockey + trainer profile detail for the search profile card */
  var JOCKEY_PROFILES = {
    'James McDonald':{ wins:26, rides:93, winPct:28, price:'$750k', tier:'Elite',
      recent:[['Aeliana','Tancred Stakes','28 Mar'],['Autumn Glow','Verry Elleegant S','28 Feb'],['Lazzura','Coolmore Classic','14 Mar']] },
    'Zac Lloyd':{ wins:14, rides:89, winPct:16, price:'$440k', tier:'Power',
      recent:[['Guest House','Golden Slipper','21 Mar'],['Land Legend','3rd Tancred','28 Mar'],['Stefi Magnetica','3rd VES','28 Feb']] },
    'Nash Rawiller':{ wins:5, rides:55, winPct:9, price:'$225k', tier:'Power',
      recent:[['Beiwacht','All Aged Stakes','18 Apr'],['Savvy Hallie','Light Fingers S','14 Feb'],['Cylinder','4th Doncaster','4 Apr']] },
    'Tommy Berry':{ wins:9, rides:80, winPct:11, price:'$290k', tier:'Power',
      recent:[['Ninja','Hobartville Stakes','21 Feb'],['Espiona','2nd Coolmore','14 Mar'],['Tentyris','3rd Slipper','21 Mar']] },
    'Kerrin McEvoy':{ wins:4, rides:34, winPct:12, price:'$130k', tier:'Solid',
      recent:[['Brave Mead','BM88 Hcp','12 Apr'],['Sunshine In Paris','Listed','5 Mar'],['Coleman','BM78','22 Feb']] },
    'Rachel King':{ wins:8, rides:55, winPct:15, price:'$200k', tier:'Power',
      recent:[['Olentia','3rd Coolmore','14 Mar'],['Atishu','4th QE Stakes','11 Apr'],['Manaal','3rd Hobartville','21 Feb']] },
  };
  var TRAINER_PROFILES = {
    'Chris Waller':{ wins:31, runners:192, winPct:16, price:'$750k', tier:'Elite',
      recent:[['Autumn Glow','Verry Elleegant S','28 Feb'],['Aeliana','Tancred Stakes','28 Mar'],['Beiwacht','All Aged Stakes','18 Apr']] },
    'Ciaron Maher':{ wins:9, runners:66, winPct:14, price:'$185k', tier:'Solid',
      recent:[['Tempted','Eskimo Prince S','7 Feb'],['Yagan','4th Coolmore','14 Mar'],['Switzerland','4th Slipper','21 Mar']] },
    'Gai Waterhouse & Adrian Bott':{ wins:4, runners:67, winPct:6, price:'$160k', tier:'Solid',
      recent:[['Sir Delius','Queen Elizabeth S','11 Apr'],['Aft Cabin','4th R. Guineas','7 Mar'],['Bridoodle','3rd Light Fingers','14 Feb']] },
  };

  /* Race-day live feed mock (Home race-day mode) */
  var LIVE_FEED = [
    { state:'live',     label:'Race 6 · Golden Slipper', text:'Jumped &amp; running — Guest House leads at the 400m. Live now.' },
    { state:'result',   label:'Race 5 · The Gateway (Listed)', text:'1st <b>Tentyris</b> (T. Berry), 2nd Marhoona, 3rd Switzerland · Margins: 0.4L, 1.2L' },
    { state:'result',   label:'Race 4 · BM78 Handicap', text:'1st <b>Lake Forest</b> (J. McDonald), 2nd Encap, 3rd Manaal · Margins: 1.0L, 0.6L' },
    { state:'result',   label:'Race 3 · BM64 Handicap', text:'1st <b>Anamoe</b> (J. McDonald), 2nd Nature Strip, 3rd Mr Brightside · Margins: 0.8L, 1.5L' },
    { state:'upcoming', label:'Race 7 · BM88 Handicap', text:'Jumps 4:25 PM — 12 acceptors. Favourite: Cylinder ($3.40).' },
  ];

  /* Fantasy leaderboard */
  var LEADERBOARD = [
    { rank:1,  name:'SlipperKing',     pts:1742, trend:'up' },
    { rank:2,  name:'RandwickRoyalty', pts:1698, trend:'same' },
    { rank:3,  name:'TheBartFastlane', pts:1655, trend:'up' },
    { rank:4,  name:'GaiForce',        pts:1611, trend:'down' },
    { rank:5,  name:'WallerWonders',   pts:1588, trend:'up' },
    { rank:6,  name:'SaddleUpSyd',     pts:1540, trend:'down' },
    { rank:7,  name:'EverestDreams',   pts:1502, trend:'same' },
    { rank:8,  name:'KosciuszkoKid',   pts:1477, trend:'up' },
    { rank:9,  name:'BerryGoodTips',   pts:1450, trend:'down' },
    { rank:10, name:'TheLloydLegend',  pts:1421, trend:'up' },
  ];
  var MY_RANK = { rank:47, total:12834, pts:1284 };
  var MY_LEAGUE = [
    { rank:1, name:'Dad’s Dollars', pts:1410, you:false },
    { rank:2, name:'You',              pts:1284, you:true },
    { rank:3, name:'Macca’s Mob',   pts:1255, you:false },
    { rank:4, name:'Sister Act',       pts:1198, you:false },
    { rank:5, name:'Office Punters',   pts:1102, you:false },
    { rank:6, name:'The Rookie',       pts:944,  you:false },
  ];

  /* Past fantasy rounds */
  var PAST_ROUNDS = [
    { round:'Golden Slipper Day — 21 Mar', total:412, rows:[
        ['Z. Lloyd (C)','3 rides','148','2×'],['J. McDonald','4 rides','96','—'],
        ['T. Berry','3 rides','42','—'],['C. Waller','9 runners','84','—'],['G. Waterhouse & Bott','5 runners','42','—'] ] },
    { round:'Coolmore Classic Day — 14 Mar', total:287, rows:[
        ['J. McDonald (C)','3 rides','130','2×'],['N. Rawiller','2 rides','30','—'],
        ['R. King','2 rides','20','—'],['C. Waller','7 runners','77','—'],['C. Maher','4 runners','30','—'] ] },
    { round:'Verry Elleegant Day — 28 Feb', total:356, rows:[
        ['J. McDonald (C)','4 rides','180','2×'],['T. Berry','3 rides','36','—'],
        ['Z. Lloyd','3 rides','30','—'],['C. Waller','8 runners','88','—'],['M. Freedman','3 runners','22','—'] ] },
  ];

  /* MENU links — Racing NSW family of sites, socials.
     These are outbound destinations for the user's browser, not backend
     calls, so absolute URLs are correct here. */
  var SITES = [
    { icon:'🏇', name:'Racing NSW',            sub:'racingnsw.com.au',          url:'https://www.racingnsw.com.au' },
    { icon:'⛰️', name:'The Everest',            sub:'theeverest.com.au',         url:'https://www.theeverest.com.au' },
    { icon:'🏔️', name:'The Kosciuszko',         sub:'Country racing\'s richest race', url:'https://www.theeverest.com.au/the-kosciuszko' },
    { icon:'✨', name:'The Golden Mingle',      sub:'On-course experiences',     url:'https://www.racingnsw.com.au' },
    { icon:'🌾', name:'Country Championships',  sub:'racingnsw.com.au/country',  url:'https://www.racingnsw.com.au' },
    { icon:'🐎', name:'Team Thoroughbred',      sub:'Life after racing',         url:'https://www.teamthoroughbred.com.au' },
  ];
  var SOCIALS = [
    { label:'IG', name:'Instagram', url:'https://www.instagram.com/racing_nsw' },
    { label:'FB', name:'Facebook',  url:'https://www.facebook.com/RacingNewSouthWales' },
    { label:'X',  name:'X',         url:'https://x.com/racing_nsw' },
    { label:'YT', name:'YouTube',   url:'https://www.youtube.com/@RacingNSWTV' },
    { label:'TT', name:'TikTok',    url:'https://www.tiktok.com/@racingnsw' },
  ];
  var ACTIVATIONS = [
    { id:'signx', icon:'✍️', name:'Sign the X', tag:'FAN WALL',
      where:'Theatre of the Horse Lawn', when:'Gates open – last race',
      blurb:'Leave your mark on The Everest. Add your name to the giant X and join thousands of fans backing the world’s richest turf race.' },
    { id:'lagoon', icon:'🍸', name:'Everest Lagoon Drinks Cart', tag:'BAR',
      where:'Winx Stand concourse', when:'11:00 AM – 5:30 PM',
      blurb:'A roving premium drinks cart serving Everest Lagoon cocktails and chilled bubbles, brought right to where the crowd is.' },
    { id:'mingle', icon:'✨', name:'The Golden Mingle', tag:'OPEN EXPERIENCE',
      where:'Reserved Mingle Marquee', when:'From 11:00 AM', flagship:true, app:true,
      blurb:'Racing’s most stylish social. Tap to open the live Golden Mingle experience.' },
  ];

  /* PODCASTS — the menu reads icon/name/sub (and rendered exactly these two
     before the refactor); the new Podcasts section reads the richer fields.
     One dataset, no duplication. */
  var PODCASTS = [
    { id:'pod1', icon:'🎙️', name:'The Racing NSW Podcast', sub:'Weekly previews & stable news',
      host:'Racing NSW', latest:'Spring preview — Everest barrier draw', when:'22 Jul', dur:'38:12', episodes:112 },
    { id:'pod2', icon:'🎧', name:'Randwick to Riverina',   sub:'Country & provincial deep dives',
      host:'Racing NSW Country', latest:'Kosciuszko slot holders revealed', when:'19 Jul', dur:'27:45', episodes:64 },
    { id:'pod3', icon:'🏆', name:'It’s Gold', sub:'Long-form interviews from the stable floor',
      host:'Racing NSW', latest:'#007 — Mulberry Racing’s data revolution', when:'15 Jul', dur:'22:24', episodes:7 },
  ];

  /* Tickets & passes */
  var TICKETS = [
    { ev:'Golden Slipper Day', date:'Sat 21 Mar 2026', venue:'Rosehill Gardens', gate:'Gate B · The Theatre', seed:137 },
    { ev:'The Star Championships Day 1', date:'Sat 4 Apr 2026', venue:'Royal Randwick', gate:'Gate 5 · Grandstand', seed:911 },
    { ev:'All Aged Stakes Day', date:'Sat 18 Apr 2026', venue:'Royal Randwick', gate:'Gate 1 · Member Lawn', seed:455 },
  ];

  /* Race-alert subscription options */
  var ALERT_OPTS = {
    horses:['Black Caviar','Winx','Nature Strip','Anamoe'],
    jockeys:['James McDonald','Kerrin McEvoy','Tommy Berry','Rachel King'],
    tracks:['Royal Randwick','Rosehill Gardens','Warwick Farm','Canterbury Park'],
  };

  /* NEWS — real Racing NSW stories. NEWS_HUB is an outbound link. */
  var NEWS_HUB = 'https://www.racingnsw.com.au/media-news-premierships/latest-news/';
  var STORIES = [
    {t:'Litt chasing more city success with ex-Godolphin recruits', tag:'STABLES',  when:'16 Jun'},
    {t:'O’Rourke keen to see signs of Predation’s potential', tag:'FORM',    when:'16 Jun'},
    {t:'Punter’s Intelligence wrap — Rosehill', tag:'ANALYSIS',              when:'16 Jun'},
    {t:'Sydney’s ‘Strapper of the Year’ — nominations open', tag:'INDUSTRY', when:'22 Jun'},
    {t:'Neil Evans’ tips & preview for Goulburn', tag:'TIPS',                    when:'21 Jun'},
  ];

  /* VIDEOS — one library. `kind:'show'` entries are the existing News ▸ Shows
     grid (unchanged fields, unchanged order); the other kinds feed the new
     Videos section. All thumbnails are relative paths so they resolve inside
     the native WebView. */
  var SHOW_THUMB = {a1:'assets/show-a1.jpg',a2:'assets/show-a2.jpg',a3:'assets/show-a3.jpg',b1:'assets/show-b1.jpg',b2:'assets/show-b2.jpg',b3:'assets/show-b3.jpg',b4:'assets/show-b4.jpg',b5:'assets/show-b5.jpg',b6:'assets/show-b6.jpg'};
  var VIDEOS = [
    {kind:'show', th:SHOW_THUMB.a1, t:'#007 — Changing the racing game: Mulberry Racing\'s data-driven revolution', ch:'It\'s Gold · 22:24'},
    {kind:'show', th:SHOW_THUMB.a2, t:'The Inside Scoop on the Australian Racing Forensic Laboratory', ch:'Racing NSW · 5:13'},
    {kind:'show', th:SHOW_THUMB.a3, t:'#006 — From arena to airwaves: Yvonne O\'Keefe joins It\'s Gold', ch:'It\'s Gold · 25:52'},
    {kind:'show', th:SHOW_THUMB.b1, t:'#005 — Grit, glory and a cheeky edge: Tommy Berry Unfiltered', ch:'It\'s Gold · 23:55'},
    {kind:'show', th:SHOW_THUMB.b2, t:'#003 — 5 Minutes with Brett Gilding', ch:'It\'s Gold · 5:09'},
    {kind:'show', th:SHOW_THUMB.b3, t:'#004 — Selling Once, Selling Twice, SOLD! Brett Gilding', ch:'It\'s Gold · 25:32'},
    {kind:'show', th:SHOW_THUMB.b4, t:'#003 — Meet the trainer born to race — Adrian Bott', ch:'It\'s Gold · 25:51'},
    {kind:'show', th:SHOW_THUMB.b5, t:'#002 — 5 Minutes with Tom Mclackland', ch:'It\'s Gold · 5:22'},
    {kind:'show', th:SHOW_THUMB.b6, t:'#002 — Meet the farrier breaking the internet — Tom McLackland', ch:'It\'s Gold · 28:35'},
    /* New video-library entries (no UI before this refactor) */
    {kind:'feature',   id:'v1', th:'assets/hero-featured.jpg',  t:'The Spring Carnival is here — 2026 season launch', ch:'Racing NSW · 2:10', when:'18 Jul'},
    {kind:'feature',   id:'v2', th:'assets/video-poster.jpg',   t:'Everest 2026: inside the slot-holder draw',        ch:'Racing NSW · 6:48', when:'16 Jul'},
    {kind:'interview', id:'v3', th:'assets/show-a2.jpg',        t:'James McDonald on riding the Randwick straight',   ch:'Racing NSW · 11:02', when:'12 Jul'},
    {kind:'interview', id:'v4', th:'assets/show-b4.jpg',        t:'Chris Waller: building a spring campaign',         ch:'Racing NSW · 14:37', when:'9 Jul'},
  ];

  /* RACE REPLAYS — paired with the results above. */
  var REPLAYS = [
    { id:'rp1', race:'Queen Elizabeth Stakes',  cls:'G1', venue:'Royal Randwick',   date:'11 Apr 2026', winner:'Sir Delius',      dur:'3:42', th:'assets/show-a1.jpg' },
    { id:'rp2', race:'Doncaster Mile',          cls:'G1', venue:'Royal Randwick',   date:'4 Apr 2026',  winner:'Sheza Alibi',     dur:'3:15', th:'assets/show-a3.jpg' },
    { id:'rp3', race:'Tancred Stakes',          cls:'G1', venue:'Rosehill Gardens', date:'28 Mar 2026', winner:'Aeliana',         dur:'4:08', th:'assets/show-b1.jpg' },
    { id:'rp4', race:'Golden Slipper',          cls:'G1', venue:'Rosehill Gardens', date:'21 Mar 2026', winner:'Guest House',     dur:'2:58', th:'assets/show-b3.jpg' },
    { id:'rp5', race:'Country Champs Final',    cls:'Country Champs', venue:'Royal Randwick', date:'4 Apr 2026', winner:'Western Whisper', dur:'3:21', th:'assets/show-b5.jpg' },
  ];

  /* RACE DIARY — the season's key dates: nominations, acceptances, barrier
     draws and lock-outs that a serious follower plans around. */
  var RACE_DIARY = [
    { id:'d1', date:'28 Aug 2026',  label:'Nominations close',  event:'Golden Rose Stakes',   venue:'Rosehill Gardens', type:'noms' },
    { id:'d2', date:'11 Sep 2026',  label:'Weights released',   event:'Epsom Handicap',       venue:'Royal Randwick',   type:'weights' },
    { id:'d3', date:'15 Sep 2026',  label:'Acceptances',        event:'7 Stakes Day',         venue:'Royal Randwick',   type:'accept' },
    { id:'d4', date:'6 Oct 2026',   label:'Slot holders confirmed', event:'The TAB Everest',  venue:'Royal Randwick',   type:'draw' },
    { id:'d5', date:'13 Oct 2026',  label:'Barrier draw',       event:'The TAB Everest',      venue:'Royal Randwick',   type:'draw' },
    { id:'d6', date:'14 Oct 2026',  label:'Kosciuszko ballot',  event:'The Kosciuszko',       venue:'Royal Randwick',   type:'ballot' },
    { id:'d7', date:'27 Oct 2026',  label:'Nominations close',  event:'The Golden Eagle',     venue:'Royal Randwick',   type:'noms' },
    { id:'d8', date:'10 Nov 2026',  label:'Acceptances',        event:'The Hunter',           venue:'Newcastle',        type:'accept' },
  ];

  /* Course map */
  var MAP_CATS = {
    gate:   {label:'Entry & Gates', emoji:'🚪', color:'#5BB8FF'},
    food:   {label:'Food & Bars',   emoji:'🍔', color:'#5BB8FF'},
    amenity:{label:'Amenities',     emoji:'🚻', color:'#5BB8FF'},
    aid:    {label:'First Aid',     emoji:'⛑️', color:'#E8132E'},
    bet:    {label:'Betting Rings', emoji:'🎟️', color:'#1E4178'},
    mingle: {label:'Golden Mingle', emoji:'✨', color:'#F2B33D'},
  };
  var MAP_PINS = [
    {cat:'gate',   name:'Randwick Gates',        x:54, y:13},
    {cat:'gate',   name:'Alison Rd Entry',       x:64, y:31},
    {cat:'food',   name:'Winx Stand Bars',       x:27, y:33},
    {cat:'mingle', name:'The Golden Mingle',     x:34, y:40},
    {cat:'bet',    name:'Main Betting Ring',     x:41, y:44},
    {cat:'food',   name:'Theatre Food Hall',     x:47, y:49},
    {cat:'amenity',name:'Members Amenities',     x:31, y:44},
    {cat:'amenity',name:'Concourse Amenities',   x:59, y:52},
    {cat:'aid',    name:'First Aid Post',        x:49, y:51},
    {cat:'food',   name:'Infield Bars',          x:55, y:43},
    {cat:'bet',    name:'Tote & TAB',            x:37, y:38},
  ];

  /* UPCOMING EVENTS — derived from the schedule rather than duplicated, so
     a feature race can never disagree with the race day that carries it. */
  function buildUpcomingEvents() {
    var out = [];
    RACE_DAYS.forEach(function (d) {
      (d.feats || []).forEach(function (f) {
        out.push({
          name: f.name, dist: f.dist, prize: f.prize,
          venue: d.venue, sector: d.sector, date: d.date,
          day: d.day, badge: d.badge, condition: d.condition
        });
      });
    });
    return out.sort(function (a, b) { return prizeNum(b.prize) - prizeNum(a.prize); });
  }

  /* ╔══════════════════════════════════════════════════════════════╗
     ║ SECTION 2 · CACHE                                            ║
     ║ localStorage-backed, so a cold start with no signal still    ║
     ║ has yesterday's content to show.                             ║
     ╚══════════════════════════════════════════════════════════════╝ */
  var CACHE_PREFIX = CFG.CACHE_PREFIX || 'rnsw_cache_';
  var TTLS = CFG.CACHE_TTL_MS || {};

  function ttlFor(domain) {
    return TTLS[domain] != null ? TTLS[domain] : (TTLS._default != null ? TTLS._default : 300000);
  }

  function cacheRead(key) {
    try {
      var raw = global.localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (!rec || typeof rec.at !== 'number') return null;
      return rec;                       // { at, data }
    } catch (e) { return null; }
  }

  function cacheWrite(key, data) {
    try {
      var payload = JSON.stringify({ at: Date.now(), data: data });
      var max = CFG.CACHE_MAX_BYTES || 262144;
      if (payload.length > max) return;                 // too big to be worth caching
      global.localStorage.setItem(CACHE_PREFIX + key, payload);
    } catch (e) {
      /* Quota exceeded or private mode: caching is best-effort, never fatal. */
    }
  }

  /* Wipe every cached payload — exposed for a "refresh everything" action. */
  function cacheClear() {
    try {
      var doomed = [];
      for (var i = 0; i < global.localStorage.length; i++) {
        var k = global.localStorage.key(i);
        if (k && k.indexOf(CACHE_PREFIX) === 0) doomed.push(k);
      }
      doomed.forEach(function (k) { global.localStorage.removeItem(k); });
    } catch (e) {}
  }

  /* ╔══════════════════════════════════════════════════════════════╗
     ║ SECTION 3 · TRANSPORT                                        ║
     ╚══════════════════════════════════════════════════════════════╝ */

  /* Build an absolute-or-same-origin URL from config. This is the ONLY
     place in www/ that composes a backend URL. */
  function apiUrl(path, params) {
    var base = (CFG.API_BASE_URL || '').replace(/\/+$/, '');
    var p = path.charAt(0) === '/' ? path : '/' + path;
    var url = base + p;
    if (params) {
      var qs = Object.keys(params)
        .filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
        .join('&');
      if (qs) url += (url.indexOf('?') > -1 ? '&' : '?') + qs;
    }
    return url;
  }

  /* GET with a timeout. Always returns a promise and only ever REJECTS —
     never throws synchronously — so callers can rely on .catch() alone to
     handle every failure. (A very old Android WebView with no fetch would
     otherwise throw past the chain and blank the screen.) */
  function apiGet(path, params) {
    if (typeof global.fetch !== 'function') {
      return Promise.reject(new Error('fetch unavailable'));
    }
    var url = apiUrl(path, params);
    var timeout = CFG.REQUEST_TIMEOUT_MS || 8000;
    var ctrl = (typeof global.AbortController === 'function') ? new global.AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeout);

    return Promise.resolve()
      .then(function () {
        return global.fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: ctrl ? ctrl.signal : undefined
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        clearTimeout(timer);
        /* The proxy answers {error:...} while the key is missing. Treat
           that as a failure so the caller falls back rather than
           rendering an error object. */
        if (json && json.error) throw new Error(json.error);
        return json && json.data !== undefined ? json.data : json;
      })
      .catch(function (err) {
        clearTimeout(timer);
        throw err;
      });
  }

  /* ╔══════════════════════════════════════════════════════════════╗
     ║ SECTION 4 · ADAPTERS                                         ║
     ╚══════════════════════════════════════════════════════════════╝ */

  function envelope(data, source, fetchedAt, stale, error) {
    return {
      data: data,
      source: source,
      fetchedAt: fetchedAt,
      stale: !!stale,
      error: error || null
    };
  }

  /* Deep-ish clone so a screen mutating what it renders (results sorting,
     for one) can never corrupt the service's own dataset. */
  function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  }

  /* The core of the adapter pattern.

     domain   cache key + TTL bucket
     path     endpoint below /api/racing (api mode only)
     params   query string (api mode only)
     localFn  () => payload, used in local mode AND as the last-resort
              fallback when a live call fails with nothing cached.

     Guarantees: always resolves, never rejects. */
  function fetchDomain(domain, path, params, localFn) {
    var now = Date.now();

    if ((CFG.DATA_SOURCE || 'local') !== 'api') {
      return Promise.resolve(envelope(clone(localFn()), 'local', now, false, null));
    }

    var key = domain + (params ? ':' + JSON.stringify(params) : '');
    var cached = cacheRead(key);

    /* Fresh cache wins — no request at all. */
    if (cached && (now - cached.at) < ttlFor(domain)) {
      return Promise.resolve(envelope(cached.data, 'cache', cached.at, false, null));
    }

    return apiGet('/api/racing/' + path, params)
      .then(function (data) {
        cacheWrite(key, data);
        return envelope(data, 'api', Date.now(), false, null);
      })
      .catch(function (err) {
        var reason = (err && err.message) || 'request failed';
        /* Degrade, in order of preference: stale cache → bundled local. */
        if (cached) return envelope(cached.data, 'cache', cached.at, true, reason);
        return envelope(clone(localFn()), 'local', now, true, reason);
      });
  }

  /* ╔══════════════════════════════════════════════════════════════╗
     ║ SECTION 5 · PUBLIC API                                       ║
     ╚══════════════════════════════════════════════════════════════╝ */
  var DataService = {

    /* ── The twelve named domains ─────────────────────────────── */

    getRaceDays: function () {
      return fetchDomain('raceDays', 'race-days', null, function () { return RACE_DAYS; });
    },

    getResults: function () {
      return fetchDomain('results', 'results', null, function () { return RESULTS; });
    },

    getRaceReplays: function () {
      return fetchDomain('replays', 'replays', null, function () { return REPLAYS; });
    },

    /* Matches horse name, trainer or jockey — same rule the search box
       used before, now server-side in api mode. */
    searchHorses: function (query) {
      var q = (query || '').trim().toLowerCase();
      return fetchDomain('horses', 'horses/search', { q: q }, function () {
        if (!q) return [];
        return HORSES.filter(function (h) {
          return h.name.toLowerCase().indexOf(q) > -1
            || (h.trainer || '').toLowerCase().indexOf(q) > -1
            || (h.jockey || '').toLowerCase().indexOf(q) > -1;
        });
      });
    },

    /* Accepts either the stable id ('h1') or the horse's name. */
    getHorseProfile: function (id) {
      var needle = String(id == null ? '' : id).toLowerCase();
      return fetchDomain('horses', 'horses/' + encodeURIComponent(id), null, function () {
        return HORSES.filter(function (h) {
          return h.id.toLowerCase() === needle || h.name.toLowerCase() === needle;
        })[0] || null;
      });
    },

    /* Fantasy roster plus the richer season profiles behind the search card. */
    getJockeys: function () {
      return fetchDomain('jockeys', 'jockeys', null, function () {
        return { roster: JOCKEYS, profiles: JOCKEY_PROFILES };
      });
    },

    getTrainers: function () {
      return fetchDomain('trainers', 'trainers', null, function () {
        return { roster: TRAINERS, profiles: TRAINER_PROFILES };
      });
    },

    getNews: function () {
      return fetchDomain('news', 'news', null, function () {
        return { hub: NEWS_HUB, stories: STORIES };
      });
    },

    getUpcomingEvents: function () {
      return fetchDomain('events', 'events', null, buildUpcomingEvents);
    },

    /* Optional { kind } filter: 'show' | 'feature' | 'interview'. */
    getVideos: function (opts) {
      var kind = opts && opts.kind;
      return fetchDomain('videos', 'videos', kind ? { kind: kind } : null, function () {
        return kind ? VIDEOS.filter(function (v) { return v.kind === kind; }) : VIDEOS;
      });
    },

    getPodcasts: function () {
      return fetchDomain('podcasts', 'podcasts', null, function () { return PODCASTS; });
    },

    getRaceDiary: function () {
      return fetchDomain('diary', 'diary', null, function () { return RACE_DIARY; });
    },

    /* ── Remaining app data, same contract ────────────────────── */

    getLiveFeed: function () {
      return fetchDomain('liveFeed', 'live-feed', null, function () { return LIVE_FEED; });
    },

    getLeaderboard: function () {
      return fetchDomain('leaderboard', 'leaderboard', null, function () {
        return { global: LEADERBOARD, league: MY_LEAGUE, me: MY_RANK };
      });
    },

    getPastRounds: function () {
      return fetchDomain('pastRounds', 'past-rounds', null, function () { return PAST_ROUNDS; });
    },

    getTickets: function () {
      return fetchDomain('tickets', 'tickets', null, function () { return TICKETS; });
    },

    getActivations: function () {
      return fetchDomain('activations', 'activations', null, function () { return ACTIVATIONS; });
    },

    getAlertOptions: function () {
      return fetchDomain('activations', 'alert-options', null, function () { return ALERT_OPTS; });
    },

    getCourseMap: function () {
      return fetchDomain('courseMap', 'course-map', null, function () {
        return { cats: MAP_CATS, pins: MAP_PINS };
      });
    },

    /* Outbound Racing NSW network links — sites, socials, podcast shortcuts. */
    getNetwork: function () {
      return fetchDomain('network', 'network', null, function () {
        return { sites: SITES, socials: SOCIALS, podcasts: PODCASTS };
      });
    },

    /* ── Dash companion ───────────────────────────────────────── */

    /* POSTs to our own proxy, which holds the model key server-side.
       Rejects on failure so Dash can fall back to its on-device KB. */
    askDash: function (messages, system) {
      if (typeof global.fetch !== 'function') {
        return Promise.reject(new Error('fetch unavailable'));
      }
      var timeout = CFG.REQUEST_TIMEOUT_MS || 8000;
      var ctrl = (typeof global.AbortController === 'function') ? new global.AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeout);
      return Promise.resolve()
        .then(function () {
          return global.fetch(apiUrl('/api/dash'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: messages, system: system }),
            signal: ctrl ? ctrl.signal : undefined
          });
        })
        .then(function (res) {
          clearTimeout(timer);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (json) {
          if (!json || json.error) throw new Error((json && json.error) || 'no reply');
          return json.text;
        })
        .catch(function (err) { clearTimeout(timer); throw err; });
    },

    /* ── Utilities ────────────────────────────────────────────── */

    apiUrl: apiUrl,
    clearCache: cacheClear,

    /* Parse a prize string ("$20m", "$1.5m") to a comparable number.
       Shared with the render layer so the schedule card's headline
       feature is picked by exactly the rule the service used. */
    prizeNum: prizeNum,

    config: function () {
      return { source: CFG.DATA_SOURCE || 'local', baseUrl: CFG.API_BASE_URL || '' };
    },

    /* "Updated 2 min ago" for the freshness indicator. */
    formatUpdated: function (ts) {
      if (!ts) return '';
      var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
      if (s < 10)   return 'Updated just now';
      if (s < 60)   return 'Updated ' + s + 's ago';
      var m = Math.round(s / 60);
      if (m < 60)   return 'Updated ' + m + ' min ago';
      var h = Math.round(m / 60);
      if (h < 24)   return 'Updated ' + h + 'h ago';
      return 'Updated ' + Math.round(h / 24) + 'd ago';
    },
  };

  global.DataService = DataService;

})(typeof window !== 'undefined' ? window : this);
