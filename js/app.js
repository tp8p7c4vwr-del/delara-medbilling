/* MedFee Desk - app. Static, offline-capable. No analytics, no trackers, no patient data stored. */
(function () {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => n == null || isNaN(n) ? '—' : '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const LS = { get: (k, d) => { try { const v = localStorage.getItem('mb.' + k); return v == null ? d : v; } catch (e) { return d; } },
               set: (k, v) => { try { localStorage.setItem('mb.' + k, v); } catch (e) {} } };
  // ---- Favourites and recent codes: kept on this device only (localStorage). Keys are 'H:<HSC>' or 'I:<ICD-9>'.
  const readList = k => { try { const a = JSON.parse(LS.get(k, '[]')); return Array.isArray(a) ? a.filter(x => typeof x === 'string' && /^[HI]:/.test(x)) : []; } catch (e) { return []; } };
  let FAVS = readList('favs'), RECENT = readList('recent');
  const RECENT_MAX = 20;
  const isFav = key => FAVS.includes(key);
  // Timestamps (ISO) for export: when each favourite was added and when each recent code was last opened.
  let TS = (() => { try { const o = JSON.parse(LS.get('savedts', '{}')); return { f: o.f || {}, r: o.r || {} }; } catch (e) { return { f: {}, r: {} }; } })();
  const saveTS = () => LS.set('savedts', JSON.stringify(TS));
  const saveLists = () => { LS.set('favs', JSON.stringify(FAVS)); LS.set('recent', JSON.stringify(RECENT)); saveTS(); };
  // Ask the browser not to evict local data (supported in Chrome, Edge, Firefox, Safari 15.2+). Silent if unsupported or refused.
  function persistStorage() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {}); } catch (e) {} }
  function star(key) {
    const on = isFav(key), lab = on ? 'Remove from favourites' : 'Add to favourites';
    return `<span class="star${on ? ' on' : ''}" role="button" tabindex="0" data-fav="${esc(key)}" aria-pressed="${on}" aria-label="${lab}" title="${lab}">${on ? '★' : '☆'}</span>`;
  }
  function paintStar(el) {
    const on = isFav(el.dataset.fav), lab = on ? 'Remove from favourites' : 'Add to favourites';
    el.classList.toggle('on', on); el.textContent = on ? '★' : '☆'; el.setAttribute('aria-pressed', String(on)); el.setAttribute('aria-label', lab); el.title = lab;
  }
  function toggleFav(key) {
    const on = !isFav(key);
    FAVS = on ? [key].concat(FAVS) : FAVS.filter(k => k !== key);
    if (on) { TS.f[key] = new Date().toISOString(); persistStorage(); } else delete TS.f[key];
    saveLists();
    $$('[data-fav]').forEach(el => { if (el.dataset.fav === key) paintStar(el); });
    if (!lastQuery && $('#results .savedh')) renderSaved();
    toast(on ? 'Added to favourites' : 'Removed from favourites');
  }
  function addRecent(key) {
    RECENT = [key].concat(RECENT.filter(k => k !== key)).slice(0, RECENT_MAX);
    TS.r[key] = new Date().toISOString(); Object.keys(TS.r).forEach(k => { if (!RECENT.includes(k)) delete TS.r[k]; });
    saveLists();
  }
  // ---- Export / import (codes and timestamps only; nothing else leaves the device)
  const keyToItem = (k, t) => ({ type: k[0] === 'H' ? 'HSC' : 'ICD9', code: k.slice(2), ...(t ? { at: t } : {}) });
  function exportSaved() {
    const now = new Date();
    const data = { app: 'MedFee Desk', kind: 'favourites', version: 1, exported: now.toISOString(),
      favourites: FAVS.map(k => keyToItem(k, TS.f[k])), recent: RECENT.map(k => keyToItem(k, TS.r[k])) };
    const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const name = `medfee-desk-favourites-${d}.json`, text = JSON.stringify(data, null, 1);
    const blob = new Blob([text], { type: 'application/json' });
    const download = () => { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); toast('Exported ' + name); };
    // iPhone/iPad (Safari and home-screen app): the share sheet offers "Save to Files", AirDrop, Mail. Elsewhere: a normal download.
    let file = null; try { file = new File([blob], name, { type: 'application/json' }); } catch (e) {}
    if (phone && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'MedFee Desk favourites' }).then(() => toast('Exported ' + name)).catch(err => { if (!err || err.name !== 'AbortError') download(); });
    } else download();
  }
  function parseImport(text) {
    const o = JSON.parse(text);
    if (!o || typeof o !== 'object' || (!Array.isArray(o.favourites) && !Array.isArray(o.recent))) throw new Error('not a MedFee Desk favourites file');
    const conv = arr => (Array.isArray(arr) ? arr : []).map(x => {
      if (!x || typeof x.code !== 'string') return null;
      const code = x.code.trim().toUpperCase(), t = x.type === 'ICD9' ? 'I' : 'H';
      if (t === 'H' ? !BYCODE[code] : !ICDBY[code]) return null;
      const at = typeof x.at === 'string' && !isNaN(Date.parse(x.at)) ? new Date(x.at).toISOString() : null;
      return { key: t + ':' + code, at };
    }).filter(Boolean);
    return { fav: conv(o.favourites), rec: conv(o.recent), skipped: ((o.favourites || []).length + (o.recent || []).length) };
  }
  function importSaved(file) {
    const r = new FileReader();
    r.onload = () => {
      let p; try { p = parseImport(String(r.result)); } catch (e) { alert('Import failed: this is not a MedFee Desk favourites file.'); return; }
      const newFav = [...new Set(p.fav.map(x => x.key))].filter(k => !FAVS.includes(k));
      const skipped = p.skipped - p.fav.length - p.rec.length;
      if (!newFav.length && !p.rec.length) { alert('Nothing to import: all favourites in this file are already saved' + (skipped ? ` (${skipped} unknown code${skipped > 1 ? 's' : ''} skipped)` : '') + '.'); return; }
      if (!confirm(`Import from ${file.name}?\n\n• ${newFav.length} new favourite${newFav.length === 1 ? '' : 's'} (${p.fav.length - newFav.length} already saved)\n• ${p.rec.length} recent code${p.rec.length === 1 ? '' : 's'} merged, newest kept, max ${RECENT_MAX}` + (skipped ? `\n• ${skipped} unknown code${skipped > 1 ? 's' : ''} skipped` : '') + '\n\nExisting favourites are kept; nothing is deleted.')) return;
      const now = new Date().toISOString();
      p.fav.forEach(x => { if (newFav.includes(x.key) && !TS.f[x.key]) TS.f[x.key] = x.at || now; });
      FAVS = FAVS.concat(newFav);
      const rmap = {}; RECENT.forEach(k => rmap[k] = TS.r[k] || ''); p.rec.forEach(x => { const t = x.at || ''; if (!(x.key in rmap) || t > rmap[x.key]) rmap[x.key] = t; });
      const order = Object.keys(rmap).map((k, i) => ({ k, t: rmap[k], i })).sort((a, b) => (b.t > a.t) - (b.t < a.t) || a.i - b.i);
      RECENT = order.slice(0, RECENT_MAX).map(x => x.k); TS.r = {}; order.slice(0, RECENT_MAX).forEach(x => { if (x.t) TS.r[x.k] = x.t; });
      saveLists(); persistStorage();
      if (!lastQuery && $('#results .savedh')) renderSaved();
      toast(`Imported ${newFav.length} favourite${newFav.length === 1 ? '' : 's'} and ${p.rec.length} recent`);
    };
    r.onerror = () => alert('Import failed: the file could not be read.');
    r.readAsText(file);
  }
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const fmtDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
  const shortDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`; };

  let TOP, META, CODES, BYCODE = {}, RULES, RULEBY = {}, MODS, MODTYPE = {}, MODCODE = {}, EXPL, ICD, ICDBY = {}, BULL, BULLBY = {}, RES;
  let codeIndex, icdIndex;
  let skill = LS.get('skill', 'OBGY');
  // ---- Phone/tablet mode: automatic on touch devices under 1024px wide or a mobile UA; user choice is remembered.
  const autoPhone = () => ((('ontouchstart' in window) || navigator.maxTouchPoints > 0) && window.innerWidth < 1024) ||
    /iPhone|iPod|iPad|Android|Mobile/i.test(navigator.userAgent);
  let phone = false;
  function applyLayout() {
    const pref = LS.get('layout', '');
    phone = pref ? pref === 'phone' : autoPhone();
    document.documentElement.classList.toggle('phone', phone);
    const t = document.getElementById('layoutToggle');
    if (t) { t.hidden = !(phone || pref === 'desktop' || autoPhone()); t.textContent = phone ? 'Desktop version' : 'Phone version'; }
  }
  applyLayout();
  let region = LS.get('region', 'CA');
  let lastQuery = '', current = null;

  // ------------------------------------------------------------ app-defined scope tables (not Alberta Health mappings)
  // Procedure-list sections treated as in scope per fee skill (roman numeral of SOMB Part B section).
  const SKILL_SECTIONS = {
    OBGY: ['I', 'IX', 'X', 'XI', 'XIII', 'XIV', 'XVI', 'XVII', 'XVIII'],
    UROL: ['I', 'X', 'XI', 'XII', 'XVII', 'XVIII'],
    GNSG: ['I', 'III', 'IX', 'X', 'XI', 'XIII', 'XVI', 'XVII', 'XVIII'],
    CARD: ['I', 'VIII', 'XVIII'], CTSG: ['I', 'VII', 'VIII', 'XVIII'], CRSG: ['I', 'VIII', 'XVIII'], VSSG: ['I', 'VIII', 'XVIII'], THOR: ['I', 'VII', 'XVIII'],
    OPHT: ['I', 'IV', 'XVIII'], OTOL: ['I', 'III', 'V', 'VI', 'VII', 'XVIII'], NUSG: ['I', 'II', 'XV', 'XVIII'], ORTH: ['I', 'XV', 'XVIII'],
    PLAS: ['I', 'XV', 'XVI', 'XVII', 'XVIII'], DERM: ['I', 'XVII', 'XVIII']
  };
  // ICD-9 category ranges in scope per fee skill. Skills not listed (and GP, EMSP, FTER, INMD, ANES) see the full list.
  const ICD_SCOPE = {
    OBGY: { label: 'pregnancy/childbirth (630-679), female genital & breast (610-629), urinary (590-599), gynaecologic neoplasms, genital infections, relevant symptoms, V20-V28 and related V codes',
      r: [[630, 679], [610, 629], [590, 599], [174, 174], [179, 184], [198, 198], [218, 221], [233, 233], [236, 236], [239, 239], [54, 54], [78, 79], [98, 99], [112, 112], [131, 131], [256, 256], [788, 789], [795, 795]],
      v: [[13, 13], [20, 28], [45, 45], [61, 61], [67, 67], [72, 72], [76, 76]] },
    CARD: { label: 'circulatory (390-459), cardiac congenital (745-747), symptoms (780-799)', r: [[390, 459], [745, 747], [780, 799]], v: [[12, 12], [15, 15], [42, 45], [53, 53], [58, 58], [67, 67], [71, 72], [81, 81]] },
    PEDC: { label: 'circulatory, congenital, perinatal, symptoms', r: [[390, 459], [740, 779], [780, 799]], v: [[20, 21], [30, 39], [42, 45], [67, 67], [72, 72]] },
    UROL: { label: 'genitourinary (580-608), urologic neoplasms, symptoms', r: [[580, 608], [185, 189], [222, 222], [233, 233], [236, 236], [752, 753], [788, 788], [791, 791], [996, 996]], v: [[13, 13], [25, 26], [44, 45], [53, 53], [55, 56], [64, 67]] },
    DERM: { label: 'skin (680-709), skin neoplasms, infections', r: [[680, 709], [1, 139], [172, 173], [216, 216], [232, 232], [238, 238], [782, 782]], v: [[10, 10], [67, 67], [72, 72]] },
    OPHT: { label: 'eye (360-379), related', r: [[360, 379], [190, 190], [224, 224], [743, 743], [918, 918], [921, 921], [940, 940]], v: [[41, 41], [43, 43], [45, 45], [67, 67], [72, 72], [80, 80]] },
    OTOL: { label: 'ear/nose/throat & respiratory (380-389, 460-478), head & neck neoplasms', r: [[380, 389], [460, 478], [140, 149], [160, 161], [784, 784]], v: [[41, 41], [67, 67], [72, 72]] },
    PSYC: { label: 'mental disorders (290-319)', r: [[290, 319], [780, 780], [799, 799]], v: [[11, 11], [15, 15], [40, 40], [60, 62], [65, 65], [67, 67], [70, 71]] },
    NEUR: { label: 'nervous system (320-359), cerebrovascular, symptoms', r: [[320, 359], [430, 438], [780, 781], [784, 784], [850, 854], [950, 957]], v: [[12, 12], [17, 17], [67, 67]] },
    GAST: { label: 'digestive (520-579), GI neoplasms, symptoms', r: [[520, 579], [150, 159], [211, 211], [230, 230], [787, 789], [792, 792]], v: [[10, 10], [12, 12], [16, 16], [18, 18], [44, 44], [53, 53], [55, 55], [67, 67], [76, 76]] },
    RSMD: { label: 'respiratory (460-519), lung neoplasms, symptoms', r: [[460, 519], [11, 11], [162, 163], [786, 786]], v: [[12, 12], [15, 15], [44, 44], [46, 46], [67, 67], [71, 71]] },
    NEPH: { label: 'kidney/urinary (580-599), hypertension, metabolic', r: [[580, 599], [401, 405], [250, 250], [270, 279], [788, 788], [791, 791]], v: [[42, 42], [45, 45], [56, 56], [67, 67]] },
    ORTH: { label: 'musculoskeletal (710-739), injuries (800-999)', r: [[710, 739], [800, 999], [754, 756]], v: [[43, 43], [45, 45], [48, 49], [54, 54], [67, 67]] }
  };
  ['SPMH', 'GNMH'].forEach(k => ICD_SCOPE[k] = ICD_SCOPE.PSYC);
  ['PDNR'].forEach(k => ICD_SCOPE[k] = ICD_SCOPE.NEUR); ['PDGE'].forEach(k => ICD_SCOPE[k] = ICD_SCOPE.GAST); ['PEDN'].forEach(k => ICD_SCOPE[k] = ICD_SCOPE.NEPH);
  const FULL_ICD = new Set(['BASE', 'GP', 'EMSP', 'FTER', 'INMD', 'ANES', 'CRCM']);

  function icdInScope(icd, sk) {
    sk = sk || skill;
    if (FULL_ICD.has(sk) || !ICD_SCOPE[sk]) return true;
    const sc = ICD_SCOPE[sk];
    if (icd.code[0] === 'V') { const n = parseInt(icd.code.slice(1, 3), 10); return sc.v.some(([a, b]) => n >= a && n <= b); }
    if (icd.code[0] === 'E') return false;
    const n = parseInt(icd.code.slice(0, 3), 10);
    return sc.r.some(([a, b]) => n >= a && n <= b);
  }
  const romanOf = c => (c.section || '').split('.')[0].trim();
  function codeInSkill(c, sk) {
    sk = sk || skill;
    if (c.skill && c.skill[sk]) return true;
    const secs = SKILL_SECTIONS[sk];
    if (!secs) return true;
    return secs.includes(romanOf(c));
  }
  // down-weight codes whose wording ties them to another discipline (search ranking only)
  const DISC = { OBGY: /obstetr|gyn|perinat|uro-gyn|prenatal|pregnan/i, PSYC: /psychiatr/i, CARD: /cardiolog/i, PED: /pediatric|paediatric/i,
    NEUR: /neurolog/i, OPHT: /ophthalm/i, DERM: /dermatolog/i, GAST: /gastroenterolog/i, UROL: /urolog(?!y,)/i, RHEU: /rheumatolog/i,
    ORSG: /dental|oral surg/i, PODS: /podiatr/i, NEPH: /nephrolog/i, MDON: /oncolog/i, ANES: /anesthetist|anaesthetist/i };
  ['SPMH', 'GNMH'].forEach(k => DISC[k] = DISC.PSYC); ['PDGE', 'PDNR', 'PDSG', 'PEDC', 'PEDN', 'NPM'].forEach(k => DISC[k] = DISC.PED);
  function offSkillPenalty(c) {
    const own = DISC[skill];
    if (own && own.test(c.desc)) return 1;
    for (const [k, re] of Object.entries(DISC)) if (k !== skill && DISC[k] !== own && re.test(c.desc)) return 0.6;
    return 1;
  }
  function feeFor(c, sk) {
    sk = sk || skill;
    if (c.byAssess) return { amount: null, label: 'By assessment', note: 'Fee by assessment (procedure list: BY ASSESS)' };
    if (sk !== 'BASE' && c.skill && c.skill[sk] != null) return { amount: parseFloat(c.skill[sk]), label: sk + ' rate', note: `SKLL ${sk} replace-base rate from the price list` };
    return { amount: c.base, label: sk === 'BASE' ? 'schedule base' : 'schedule base', note: sk === 'BASE' ? 'Schedule base rate' : `No SKLL ${sk} rate listed; schedule base applies` };
  }

  // ------------------------------------------------------------ boot
  async function boot() {
    const get = n => fetch('data/' + n + '.json').then(r => r.json());
    [META, CODES, RULES, MODS, EXPL, ICD, BULL, RES, TOP] = await Promise.all(['meta', 'codes', 'rules', 'modifiers', 'explanatory', 'icd9', 'bulletins', 'resources', 'top-sources'].map(get));
    CODES.forEach(c => BYCODE[c.code] = c);
    RULES.forEach(r => RULEBY[r.id] = r);
    MODS.forEach(t => { MODTYPE[t.type] = t; t.codes.forEach(c => MODCODE[t.type + ':' + c.code] = c); });
    ICD.forEach(i => ICDBY[i.code] = i);
    BULL.forEach(b => BULLBY[b.num] = b);
    initSkill();
    footer();
    codeIndex = new MBSearch.Index(CODES.map(c => ({ id: c.code, c, fields: {
      desc: c.desc, head: [c.group, c.sub].filter(Boolean).join(' ').replace(/\d{2}\.\d+\s?[A-Z]*/g, ''),
      notes: c.notes || '', chap: (c.chapter || '').replace(/^\d+\s/, '') } })), { desc: 3, head: 1.1, notes: 0.35, chap: 0.4 }, { phraseField: 'desc' });
    icdIndex = new MBSearch.Index(ICD.map(i => ({ id: i.code, i, fields: { desc: i.desc, block: i.block, excl: '' } })), { desc: 3, block: 0.6 }, { phraseField: 'desc' });
    wire();
    renderStatic();
    if (!lastQuery) renderSaved();
    route();
  }

  function skillOptions(sel) {
    const opts = ['<option value="BASE">Schedule base only</option>'].concat(
      META.skills.map(s => `<option value="${esc(s.code)}">${esc(s.code)} — ${esc(s.name)}</option>`));
    sel.innerHTML = opts.join('');
    sel.value = skill;
  }
  function initSkill() {
    const sel = $('#skill'); skillOptions(sel);
    if (!sel.value) { skill = 'OBGY'; sel.value = skill; }
    sel.addEventListener('change', () => setSkill(sel.value));
    const chip = $('#skillChip'); skillOptions(chip); chip.value = sel.value; $('#skillChipText').textContent = sel.value === 'BASE' ? 'Base' : sel.value;
    chip.addEventListener('change', () => setSkill(chip.value));
  }
  function setSkill(v) {
    skill = v; LS.set('skill', v);
    $$('select.skillsel, #skill, #skillChip').forEach(s => s.value = v);
    const ct = $('#skillChipText'); if (ct) ct.textContent = v === 'BASE' ? 'Base' : v;
    $('#limitSkill').disabled = !SKILL_SECTIONS[skill];
    if (lastQuery) doSearch(lastQuery, true); else renderSaved();
    if (current) showCode(current, true);
    renderPrice(); renderIcdScope();
    const iq = $('#iq').value.trim(); if (iq) icdSearch(iq);
  }

  function footer() {
    const eff = fmtDate(META.sombEffective);
    const newest = BULL.slice().sort((a, b) => b.num - a.num)[0];
    $('#dataline').innerHTML = `Data: SOMB effective ${esc(eff)}, source <a href="${esc(META.albertaCa)}" target="_blank" rel="noopener noreferrer">alberta.ca</a>` +
      ` · <a href="${esc(META.sombDataset)}" target="_blank" rel="noopener noreferrer">SOMB files</a>` +
      ` · ICD-9 supplement as of ${esc(META.icd9.asOf)}` + (newest ? ` · Bulletins to MED ${newest.num} (${esc(newest.date)})` : '') +
      ` · ${META.counts.codes.toLocaleString()} HSCs`;
  }

  // ------------------------------------------------------------ routing (hash holds only codes, never typed text)
  function showTab(name) {
    $$('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + name));
    $$('#tabs button, #moreMenu button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  }
  function closeMore() { const m = $('#moreMenu'); if (m) { m.hidden = true; $('#moreBtn').setAttribute('aria-expanded', 'false'); } }
  function route() {
    const h = decodeURIComponent(location.hash.slice(2));
    const [kind, arg] = [h.split('/')[0], h.split('/').slice(1).join('/')];
    if (kind === 'code' && BYCODE[arg]) { showTab('procedures'); showCode(arg); }
    else if (kind === 'rules') { showTab('rules'); if (arg) setTimeout(() => { const el = document.getElementById('gr-' + arg); if (el) el.scrollIntoView({ block: 'start' }); }, 30); }
    else if (kind === 'medres' && ICDBY[arg]) { showMedRes(arg); }
    else if (kind && $('#tab-' + kind)) showTab(kind);
    else showTab('procedures');
  }
  window.addEventListener('hashchange', route);
  // Home: Procedures tab, search cleared, code detail closed, scrolled to top. Fee skill is kept.
  function goHome() {
    current = null; lastQuery = '';
    const q = $('#q'); q.value = ''; $('#qclear').hidden = true; q.blur();
    $('#results')._ctx = null; doSearch('');
    const d = $('#detail'); d.hidden = true; d.innerHTML = ''; d.scrollTop = 0; $('.split').classList.remove('showing'); closeMore();
    $$('dialog[open]').forEach(x => x.close());
    showTab('procedures');
    if (location.hash) history.pushState(null, '', location.pathname + location.search);
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ query understanding (local only)
  const PERIOD_CODES = {
    EV: ['EV', 'TEV', 'HAEV', 'OFEV', 'BNEV'], NTPM: ['NTPM', 'TNTP', 'HANTPM', 'OFNTPM', 'BNNTPM'],
    NTAM: ['NTAM', 'TNTA', 'HANTAM', 'OFNTAM', 'BNNTAM'], WK: ['WK', 'TWK', 'TST', 'TDES', 'HAEVWK', 'OFEVWK', 'BNEVWK']
  };
  const PERIOD_LABEL = { EV: 'weekday evening 1700-2200', NTPM: 'night 2200-2400', NTAM: 'night 0000-0700', WK: 'weekend/stat holiday 0700-2200' };
  const CALLBACK = { DAY: '03.05N', EV: '03.05P', NTPM: '03.05QA', NTAM: '03.05QB', WK: '03.05R' };
  function parseContext(q) {
    const s = q.toLowerCase(); const ctx = { periods: [], minutes: null };
    const weekend = /\b(weekend|saturday|sunday|sat|sun|stat|holiday)\b/.test(s);
    let hour = null;
    let m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/);
    if (m) { hour = parseInt(m[1], 10) % 12 + (m[3][0] === 'p' ? 12 : 0); }
    else if ((m = s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)) || (m = s.match(/\b([01]\d|2[0-3])([0-5]\d)\s*(h|hrs|hours)?\b(?!\s*(min|minutes))/))) {
      if (!/(\d+)\s*(min|minutes|mins)/.test(s) || m[0].includes(':')) hour = parseInt(m[1], 10);
    }
    if (/\bmidnight\b/.test(s)) hour = 0;
    if (hour != null) {
      if (hour >= 22) ctx.periods.push('NTPM'); else if (hour < 7) ctx.periods.push('NTAM');
      else if (weekend) ctx.periods.push('WK'); else if (hour >= 17) ctx.periods.push('EV'); else ctx.periods.push('DAY');
      ctx.hour = hour;
    } else {
      if (/\bevening\b/.test(s)) ctx.periods.push(weekend ? 'WK' : 'EV');
      if (/\b(night|overnight)\b/.test(s)) ctx.periods.push('NTPM', 'NTAM');
      if (weekend && !ctx.periods.length) ctx.periods.push('WK');
    }
    if ((m = s.match(/(\d+)\s*(?:\+\s*)?(min|mins|minutes)\b/))) ctx.minutes = parseInt(m[1], 10);
    else if (/\bhalf (an )?hour\b/.test(s)) ctx.minutes = 30;
    else if ((m = s.match(/(\d+)\s*(h|hr|hrs|hour|hours)\b/))) ctx.minutes = parseInt(m[1], 10) * 60;
    ctx.over = /(\bover\b|more than|exceed|longer than|>)/.test(s);
    if (ctx.over && ctx.minutes) ctx.minutes += 1;
    ctx.hospital = /\b(hospital|inpatient|ward|admitted|l&d|labour|labor|delivery suite)\b/.test(s);
    ctx.callback = /\b(call ?back|called in|callback)\b/.test(s);
    return ctx;
  }
  function stripContext(q) {
    return q.replace(/\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)/gi, ' ').replace(/\b([01]?\d|2[0-3]):[0-5]\d\b/g, ' ')
      .replace(/\b(over|more than|longer than|exceeding|>)?\s*\d+\s*(min|mins|minutes|h|hr|hrs|hours?)\b/gi, ' ').replace(/\bhalf (an )?hour\b/gi, ' ')
      .replace(/\bat\b/gi, ' ').replace(/\b(weekday|weekend|saturday|sunday|tonight|midnight|overnight|evening|night)\b/gi, ' ');
  }

  // ------------------------------------------------------------ procedure search
  function doSearch(q, keepSel) {
    lastQuery = q;
    const box = $('#results');
    q = q.trim();
    if (!q) { renderSaved(); $('#timehint').textContent = ''; return; }
    const ctx = parseContext(q);
    const limit = $('#limitSkill').checked && !!SKILL_SECTIONS[skill];
    let hits;
    const cq = q.toUpperCase().replace(/\s+/g, '');
    if (/^\d{2}\.\d{0,2}[A-Z]{0,3}$/.test(cq)) {
      hits = CODES.filter(c => c.code.startsWith(cq)).slice(0, 10).map(c => ({ score: c.code === cq ? 100 : 50, doc: { c } }));
    } else {
      const res = codeIndex.search(stripContext(q), { limit: 10,
        filter: limit ? d => codeInSkill(d.c) : null,
        boost: d => (d.c.skill && d.c.skill[skill] ? 1.35 : 1) * (codeInSkill(d.c) ? 1.1 : 1) * (d.c.desc ? 1 : 0.5) * offSkillPenalty(d.c) });
      hits = res.hits;
    }
    const hint = [];
    if (ctx.periods.length) hint.push('Time: ' + ctx.periods.map(p => p === 'DAY' ? 'weekday daytime (no after-hours premium)' : PERIOD_LABEL[p]).join(', '));
    if (ctx.minutes) hint.push(`Duration: ${ctx.over ? 'over ' + (ctx.minutes - 1) : ctx.minutes} min`);
    $('#timehint').textContent = hint.join(' · ');
    if (!hits.length) { box.innerHTML = '<p class="muted pad">No matching health service codes. Try other wording or an HSC.</p>'; return; }
    const top = hits[0].score || 1;
    box.innerHTML = hits.map((h, i) => {
      const c = h.doc.c, f = feeFor(c);
      return `<button class="hit${current === c.code ? ' sel' : ''}" data-code="${esc(c.code)}">
        <div class="row1"><span class="lft"><span class="code">${esc(c.display || c.code)}</span>${star('H:' + c.code)}</span><span class="fee">${f.amount == null ? esc(f.label) : money(f.amount)}</span></div>
        <div class="hdesc">${esc(c.desc)}</div>
        <div class="score">#${i + 1} · score ${h.score.toFixed(2)} (${Math.round(100 * h.score / top)}%) · ${esc(f.label)}${c.cat ? ' · cat ' + esc(c.cat) : ''}
        ${c.bulletins && c.bulletins.some(b => !b.superseded) ? ' · <span class="badge b">MED ' + c.bulletins[0].num + '</span>' : ''}</div></button>`;
    }).join('');
    if (ctx.minutes > 30 && /consult/i.test(q) && BYCODE['03.08M'] && !hits.some(h => h.doc.c.code === '03.08M') && (skill === 'OBGY' || skill === 'BASE')) {
      const x = BYCODE['03.08M'];
      box.insertAdjacentHTML('beforeend', `<button class="hit" data-code="03.08M"><div class="row1"><span class="lft"><span class="code">03.08M</span>${star('H:03.08M')}</span><span class="fee">${money(feeFor(x).amount)}</span></div><div>${esc(x.desc)}</div><div class="score">Time add-on (rule-based, not scored): HSC note — claimable with 03.08A/AZ/B/BZ when the consultation exceeds 30 minutes</div></button>`);
    }
    box._ctx = ctx;
    if (!keepSel && window.matchMedia('(min-width:900px)').matches) showCode(hits[0].doc.c.code, true);
  }

  // ------------------------------------------------------------ favourites / recent view (home screen when the search is empty)
  function savedRow(key) {
    const code = key.slice(2);
    if (key[0] === 'H') {
      const c = BYCODE[code]; if (!c) return '';
      const f = feeFor(c);
      return `<button class="hit${current === c.code ? ' sel' : ''}" data-code="${esc(c.code)}"><div class="row1"><span class="lft"><span class="code">${esc(c.display || c.code)}</span>${star(key)}</span><span class="fee">${f.amount == null ? esc(f.label) : money(f.amount)}</span></div><div class="hdesc">${esc(c.desc)}</div></button>`;
    }
    const i = ICDBY[code]; if (!i) return '';
    return `<button class="hit" data-icd="${esc(i.code)}"><div class="row1"><span class="lft"><span class="code">${esc(i.code)}</span>${star(key)}</span><span class="small muted">ICD-9</span></div><div class="hdesc">${esc(icdLabel(i))}</div></button>`;
  }
  function renderSaved() {
    const box = $('#results'); box._ctx = null;
    const fav = FAVS.map(savedRow).filter(Boolean).join(''), rec = RECENT.map(savedRow).filter(Boolean).join('');
    const sk = esc(skill === 'BASE' ? 'base' : skill);
    box.innerHTML = `<div class="savedh" id="savedFav"><h3>★ Favourites</h3></div>${fav || '<p class="muted small pad">Tap ☆ on any code to keep it here.</p>'}
      <div class="savedh" id="savedRecent"><h3>Recent</h3>${rec ? '<button type="button" class="linkbtn" id="clearRecent">Clear</button>' : ''}</div>${rec || '<p class="muted small pad">Codes you open appear here (last ' + RECENT_MAX + ').</p>'}
      <div class="savedtools"><button type="button" class="ghost" id="expSaved">Export</button><button type="button" class="ghost" id="impSaved">Import</button></div>
      <p class="small muted pad savednote">Saved on this device only. Add to Home Screen on iPhone to keep them safe; use Export to back up or move to another device.</p>
      <p class="muted small pad">Fees shown for fee skill ${sk}. Search runs on this device only; nothing you type is sent anywhere.</p>`;
  }
  function openSaved(which) {
    goHome();
    const t = $(which === 'recent' ? '#savedRecent' : '#savedFav'); if (t && which === 'recent') t.scrollIntoView({ block: 'start' });
  }

  // ------------------------------------------------------------ code detail
  function pdfUrl(key) { const r = META.sources.find(s => s.key === key); return r ? r.url : '#'; }
  function grLinks(text) {
    return esc(text).replace(/\bGRs?\s+((?:\d{1,2}(?:\.\d{1,2}){0,3})(?:(?:,\s*|\s+and\s+|\s*-\s*)\d{1,2}(?:\.\d{1,2}){0,3})*)/g, (m, list) =>
      m.replace(/\d{1,2}(?:\.\d{1,2}){0,3}/g, id => RULEBY[id] ? `<a href="#/rules/${id}">${id}</a>` : id))
      .replace(/\b(\d{2}\.\d{1,2}\s?[A-Z]{0,3})\b/g, (m, c) => { const k = c.replace(/\s/g, ''); return BYCODE[k] && k !== current ? `<a href="#/code/${k}">${c}</a>` : m; });
  }
  function modDef(type, code) {
    const d = MODCODE[type + ':' + code]; const t = MODTYPE[type];
    return (d ? d.text : '') || (t ? t.text : '');
  }
  function showCode(code, quiet) {
    const c = BYCODE[code]; if (!c) return;
    current = code;
    if (!quiet) addRecent('H:' + code);
    $$('.hit').forEach(b => b.classList.toggle('sel', b.dataset.code === code));
    const ctx = ($('#results')._ctx) || { periods: [] };
    const f = feeFor(c);
    const hl = new Set(ctx.periods.flatMap(p => PERIOD_CODES[p] || []));
    const minutes = ctx.minutes;
    const el = $('#detail'); el.hidden = false;
    const bl = (c.bulletins || []);
    const docLinks = [];
    bl.forEach(b => { const B = BULLBY[b.num]; if (B) docLinks.push(`<a target="_blank" rel="noopener noreferrer" href="${esc(B.url)}#page=${b.page}">Open MED ${b.num} at this code</a> <span class="small muted">(${esc(B.date)}${b.superseded ? ', superseded' : ''}, p. ${b.page})</span>`); });
    if (c.plPage) docLinks.push(`<a target="_blank" rel="noopener noreferrer" href="${esc(pdfUrl('procedure'))}#page=${c.plPage}">Procedure list p. ${esc(c.plLabel)}</a>`);
    if (c.pricePage) docLinks.push(`<a target="_blank" rel="noopener noreferrer" href="${esc(pdfUrl('price'))}#page=${c.pricePage}">Price list p. ${esc(c.priceLabel)}</a>`);
    // context callouts
    const call = [];
    if (ctx.periods.length) {
      const own = (c.mods || []).filter(m => hl.has(m[1]));
      own.forEach(m => call.push(`On this HSC: <b>${esc(m[0])} ${esc(m[1])}</b> ${esc(m[3])} ${esc(m[4])} — ${esc(modDef(m[0], m[1]))}`));
      const aa = BYCODE['03.01AA'];
      if (aa) (aa.mods || []).filter(m => hl.has(m[1])).forEach(m => call.push(`After-hours time premium: <a href="#/code/03.01AA">03.01AA</a> with SURT ${esc(m[1])} — ${m[5] ? esc(m[5].map(x => `calls ${x[0]}: ${x[1]} ${x[2]}`).join('; ')) : ''} (<a href="#/rules/15.13">GR 15.13</a>)`));
      if (ctx.hospital || ctx.callback) ctx.periods.forEach(p => { const cb = BYCODE[CALLBACK[p]]; if (cb) call.push(`Special callback (if called in): <a href="#/code/${cb.code}">${esc(cb.code)}</a> ${esc(cb.desc)} <span class="fee">${money(cb.base)}</span> (<a href="#/rules/15.3">GR 15.3</a>, <a href="#/rules/15.8">15.8</a>)`); });
      if (!own.length && !call.length) call.push('No after-hours modifier is listed for this HSC in the price list.');
    }
    if (minutes) {
      (c.mods || []).filter(m => m[0] === 'CARE').forEach(m => { const mm = parseInt((m[1].match(/\d+/) || [0])[0], 10); if (mm && minutes >= mm) { hl.add(m[1]); call.push(`Complex care time: <b>CARE ${esc(m[1])}</b> ${esc(m[3])} ${esc(m[4])} — ${esc(modDef('CARE', m[1]))}`); } });
      if (/consultation/i.test(c.desc) && minutes > 30 && BYCODE['03.08M'] && c.code !== '03.08M') { const x = BYCODE['03.08M']; call.push(`Extended consultation over 30 min: <a href="#/code/03.08M">03.08M</a> ${esc(x.desc)} <span class="fee">${money(feeFor(x).amount)}</span>`); }
    }
    const skillRows = Object.entries(c.skill || {});
    if (phone) { phoneCard(c, f, call, docLinks, el); return; }
    $('.split').classList.remove('showing');
    el.innerHTML = `
      <div class="mobileskill">Fee skill <select class="skillsel" aria-label="Fee skill"></select></div>
      <div class="row1"><span class="code codebig">${esc(c.display || c.code)}</span>${star('H:' + c.code)}
        ${c.cat ? `<span class="badge">cat ${esc(c.cat)}</span>` : ''}${c.visit ? '<span class="badge">V</span>' : ''}${c.notInPriceList ? '<span class="badge b">not in price list</span>' : ''}</div>
      <h2>${esc(c.desc)}</h2>
      <div class="small muted">${esc([c.section, c.chapter, c.sub, c.group].filter(Boolean).join(' › '))}</div>
      <div class="feeblock">
        <div><div class="small muted">Schedule fee (${esc(skill === 'BASE' ? 'base' : skill)})</div><div class="fee big">${f.amount == null ? esc(f.label) : money(f.amount)}</div><div class="small muted">${esc(f.note)}</div></div>
        ${skill !== 'BASE' && f.amount !== c.base && !c.byAssess ? `<div><div class="small muted">Schedule base</div><div class="fee">${money(c.base)}</div></div>` : ''}
        ${c.ane != null ? `<div><div class="small muted">Anaesthetic benefit (separate)</div><div class="fee">${money(c.ane)}</div></div>` : ''}
      </div>
      <div class="row"><button class="ghost" id="askCode">Ask AI</button><button class="ghost" id="copyCode">Copy HSC</button></div>
      ${call.length ? `<h3>For your description</h3><ul>${call.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
      ${c.notes ? `<h3>Notes</h3><p>${grLinks(c.notes)}</p>` : ''}
      ${c.gr && c.gr.length ? `<p class="small">Governing rules: ${c.gr.map(g => `<a href="#/rules/${g}">GR ${g}</a>`).join(', ')}</p>` : ''}
      <h3>In the ministry document</h3><div class="links">${docLinks.join('') || '<span class="muted">—</span>'}</div>
      <h3>Suggested ICD-9 <span class="small muted" id="icdsugbasis"></span></h3>
      <div id="icdsug"></div>
      <h3>Modifiers (price list)</h3>
      ${(c.mods || []).length ? `<div class="tablewrap"><table><thead><tr><th>Type</th><th>Code</th><th>Expl.</th><th>Action</th><th>Amount</th></tr></thead><tbody>
        ${c.mods.map(m => `<tr class="${hl.has(m[1]) ? 'hl' : ''}"><td>${esc(m[0])}</td><td title="${esc(modDef(m[0], m[1]))}">${esc(m[1])}</td><td>${m[2] ? 'Y' : ''}</td><td>${esc(m[3])}${m[5] ? '<br><span class="small muted">' + esc(m[5].map(x => `calls ${x[0]}: ${x[1]} ${x[2]}`).join('; ')) + '</span>' : ''}</td><td>${esc(m[4])}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted small">No modifier rows listed.</p>'}
      ${skillRows.length ? `<details><summary class="small">Fee-skill rates (SKLL, replace base) — ${skillRows.length}</summary><div class="tablewrap"><table><tbody>${skillRows.map(([k, v]) => `<tr class="${k === skill ? 'hl' : ''}"><td>${esc(k)}</td><td>${esc((META.skills.find(s => s.code === k) || {}).name || '')}</td><td class="fee">${money(parseFloat(v))}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    `;
    skillOptions($('.skillsel', el)); $('.skillsel', el).addEventListener('change', e => setSkill(e.target.value));
    $('#askCode').onclick = () => openAI(codePrompt(c));
    $('#copyCode').onclick = () => copy(c.code, 'HSC copied');
    { const sg = suggestIcd(c); $('#icdsugbasis').textContent = '(' + sg.basis + ')'; renderIcdList($('#icdsug'), sg.rows, sg.empty); }
    if (!quiet && !window.matchMedia('(min-width:900px)').matches) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (location.hash !== '#/code/' + code) history.replaceState(null, '', '#/code/' + code);
  }

  // Phone code card: fee, key notes collapsed, ICD-9 suggestions, Document / Ask AI / More about this condition.
  let pickedIcd = null;
  function phoneCard(c, f, call, docLinks, el) {
    el.innerHTML = `<div class="pcard">
      <button type="button" class="ghost back" id="pBack">‹ Results</button>
      <div class="row1"><span class="code codebig">${esc(c.display || c.code)}</span>${star('H:' + c.code)}${c.cat ? `<span class="badge">cat ${esc(c.cat)}</span>` : ''}</div>
      <h2>${esc(c.desc)}</h2>
      <div class="pfee"><div class="fee big">${f.amount == null ? esc(f.label) : money(f.amount)}</div>
        <div class="small muted">Schedule fee (${esc(skill === 'BASE' ? 'base' : skill)})${skill !== 'BASE' && f.amount !== c.base && !c.byAssess ? ' · base ' + money(c.base) : ''}${c.ane != null ? ' · anaesthetic ' + money(c.ane) + ' (separate)' : ''}</div></div>
      <div class="pbtns"><button type="button" class="ghost" id="pDoc" aria-expanded="false">Document</button><button type="button" class="ghost" id="askCode">Ask AI</button><button type="button" class="ghost" id="pMore">More about this condition</button></div>
      <div id="pDocs" class="links" hidden>${docLinks.join('') || '<span class="muted">No document page listed.</span>'}</div>
      ${call.length ? `<details><summary>For your description</summary><ul>${call.map(x => `<li>${x}</li>`).join('')}</ul></details>` : ''}
      ${c.notes || (c.gr && c.gr.length) ? `<details><summary>Key notes</summary>${c.notes ? `<p>${grLinks(c.notes)}</p>` : ''}${c.gr && c.gr.length ? `<p class="small">Governing rules: ${c.gr.map(g => `<a href="#/rules/${g}">GR ${g}</a>`).join(', ')}</p>` : ''}</details>` : ''}
      <h3>Suggested ICD-9</h3><p class="small muted" id="icdsugbasis"></p><div id="icdsug" class="picklist"></div></div>`;
    const sg = suggestIcd(c); $('#icdsugbasis').textContent = sg.basis; renderIcdList($('#icdsug'), sg.rows, sg.empty);
    pickedIcd = sg.rows.length ? sg.rows[0].i.code : null;
    const mark = () => $$('#icdsug .icdrow').forEach(r => r.classList.toggle('picked', r.dataset.icd === pickedIcd));
    mark();
    $('#icdsug').addEventListener('click', e => { const r = e.target.closest('.icdrow'); if (r && !e.target.closest('button')) { pickedIcd = r.dataset.icd; mark(); } });
    $('#pMore').disabled = !pickedIcd;
    $('#pMore').onclick = () => pickedIcd && showMedRes(pickedIcd);
    $('#pDoc').onclick = () => { const d = $('#pDocs'); d.hidden = !d.hidden; $('#pDoc').setAttribute('aria-expanded', String(!d.hidden)); };
    $('#askCode').onclick = () => openAI(codePrompt(c));
    $('#pBack').onclick = () => { current = null; el.hidden = true; el.innerHTML = ''; $('.split').classList.remove('showing'); $$('.hit').forEach(b => b.classList.remove('sel')); if (!lastQuery) renderSaved(); history.replaceState(null, '', location.pathname + location.search); window.scrollTo(0, 0); };
    $('.split').classList.add('showing');
    window.scrollTo(0, 0);
    if (location.hash !== '#/code/' + c.code) history.replaceState(null, '', '#/code/' + c.code);
  }

  // ------------------------------------------------------------ ICD-9
  const CONCEPTS = [
    [/pessary/i, 'prolapse uterovaginal vaginal wall cystocele rectocele stress incontinence'],
    [/cesarean|caesarean/i, 'cesarean delivery previous uterine scar malposition malpresentation breech obstructed labour fetal distress placenta praevia multiple gestation'],
    [/colposcop|cervi(x|cal)|cone biopsy|leep|loop electrical/i, 'cervix dysplasia abnormal papanicolaou smear carcinoma in situ condyloma cervicitis'],
    [/contracept/i, 'contraceptive management intrauterine device'],
    [/prenatal|obstetric|pregnan/i, 'pregnancy supervision normal high-risk'],
    [/delivery|labour|labor/i, 'delivery normal labour'],
    [/hysterectomy|myomectomy|ablation/i, 'leiomyoma uterus excessive menstruation menorrhagia prolapse endometriosis postmenopausal bleeding'],
    [/sterili|tubal/i, 'sterilization contraceptive management'],
    [/ectopic/i, 'ectopic pregnancy tubal'],
    [/endometri/i, 'endometrial hyperplasia excessive menstruation postmenopausal bleeding'],
    [/termination|abortion|curettage|evacuation/i, 'abortion missed spontaneous legally induced'],
    [/laparoscop/i, 'pelvic pain endometriosis ovarian cyst'],
    [/ovar/i, 'ovary cyst neoplasm'], [/vulv/i, 'vulva'], [/vagin/i, 'vagina'], [/fertil/i, 'infertility female'],
    [/incontinence|sling|urethr|bladder|cysto/i, 'incontinence stress urinary'],
    [/amnio|chorionic|fetal|cordocentesis/i, 'fetal abnormality antenatal screening'],
    [/induction/i, 'post term prolonged pregnancy'], [/laceration|perine|sphincter/i, 'laceration perineal'],
    [/hemorrhage|haemorrhage/i, 'postpartum hemorrhage'], [/placenta/i, 'retained placenta'], [/breast/i, 'breast'],
    [/consultation|visit|assessment/i, '']
  ];
  function scopeLabel() {
    if (FULL_ICD.has(skill) || !ICD_SCOPE[skill]) return 'full ICD-9 list';
    return skill + ' scope';
  }
  function renderIcdScope() {
    const sc = ICD_SCOPE[skill];
    $('#icdscope').textContent = (FULL_ICD.has(skill) || !sc) ? `Fee skill ${skill === 'BASE' ? 'not set' : skill}: full Alberta ICD-9 list (${ICD.length.toLocaleString()} codes).`
      : `Fee skill ${skill}: limited to ${sc.label}. App-defined scope; switch to GP or "Schedule base only" for the full list.`;
  }
  // ------------------------------------------------------------ HSC -> ICD-9 relevance (app-defined clinical mapping)
  // Each rule: test(c) on the HSC; n = ICD-9 numeric category ranges; v = V-code ranges; x = exact code prefixes;
  // pin = ordered high-relevance codes (shown only if present in the Alberta ICD-9 list); q = search terms for further ranking.
  const GYN_NEO = ['179', '180', '182', '183', '184', '218', '219', '220', '221', '233.1', '233.2', '233.3'];
  const ch2 = c => parseInt(String(c.code).split('.')[0], 10);
  const txt = c => [c.desc, c.group, c.sub, c.chapter].filter(Boolean).join(' ');
  const sec = c => romanOf(c);
  const FG = c => ['XIII', 'XIV'].includes(sec(c));           // female genital / obstetric sections
  const ONC = /carcinoma|malignan|cancer|radical|debulk|radium|oncolog/i;
  const OB_N = [[640, 679]];
  const SITE_RULES = [
    { id: 'iud', why: 'Matches procedure: intrauterine contraception',
      test: c => /intra-?uterine contraceptive|\bIUD\b|\bIUCD\b/i.test(c.desc),
      v: [[25, 25]], x: ['V45.5', '996.3', '626.2', '627.0'],
      pin: ['V25.1', 'V25.4', 'V25.0', 'V25.8', 'V45.5', '996.3', '626.2'], q: 'contraceptive intrauterine device' },
    { id: 'steril', why: 'Matches procedure: sterilization',
      test: c => (FG(c) || sec(c) === 'XII') && /sterili[sz]|tubal ligation|vasectomy/i.test(c.desc),
      v: [[25, 26]], x: [], pin: ['V25.2', 'V25.0', 'V26.0'], q: 'sterilization contraceptive' },
    { id: 'abort', why: 'Matches obstetric event: pregnancy loss / termination',
      test: c => FG(c) && /abortion|terminat\w* (of )?pregnancy|terminate pregnancy|fetal reduction/i.test(c.desc),
      n: [[632, 639]], x: ['655', '651', '667.1', '666.2', 'V61.7'],
      pin: ['635.9', '632', '634.9', '655.9', '655.1', '655.0', '637.9', '667.1', '651.0', '651.1'], q: 'abortion legally induced missed spontaneous fetal abnormality' },
    { id: 'ectopic', why: 'Matches obstetric event: ectopic pregnancy',
      test: c => FG(c) && /ectopic|intraperitoneal embryo/i.test(c.desc),
      x: ['633'], pin: ['633.1', '633.0', '633.2', '633.8', '633.9'], q: 'ectopic tubal pregnancy' },
    { id: 'cerclage', why: 'Matches obstetric event: cervical incompetence (cerclage)',
      test: c => FG(c) && /cerclage|suturing of cervix|encircling suture/i.test(c.desc),
      n: OB_N, x: ['V23'], pinw: 260, pin: ['654.5', 'V23.4', 'V23.5', '644.2'], q: 'cervical incompetence poor obstetric history' },
    { id: 'pph', why: 'Matches obstetric event: third stage / postpartum haemorrhage',
      test: c => FG(c) && /placenta|post ?partum hemorrhage|haemorrhage|inverted uterus/i.test(c.desc),
      n: [[665, 667]], x: ['669.4'], pin: ['666.1', '666.0', '667.0', '666.2', '667.1', '665.2', '666.3'], q: 'postpartum haemorrhage retained placenta inversion uterus' },
    { id: 'obtrauma', why: 'Matches obstetric event: obstetric laceration / haematoma',
      test: c => sec(c) === 'XIV' && /laceration|sphincter|hematoma|haematoma/i.test(c.desc),
      x: ['664', '665', '674', '668', '669.4'], pin: ['664.2', '664.3', '665.3', '665.4', '665.7', '664.1', '674.3', '674.1', '665.1'], q: 'perineal laceration cervix vaginal haematoma wound' },
    { id: 'cs', why: 'Matches obstetric event: cesarean delivery',
      test: c => (sec(c) === 'XIV' && ch2(c) === 86) || (FG(c) || sec(c) === 'II') && /cesarean|caesarean/i.test(c.desc) && !/vaginal delivery/i.test(c.desc),
      n: OB_N, v: [[27, 27]],
      pin: ['654.2', '669.7', '652.2', '653.4', '656.3', '660.0', '641.0', '651.0', '652.8', 'V27.0'],
      q: 'caesarean uterine scar malpresentation breech disproportion obstructed labour fetal distress placenta praevia twin' },
    { id: 'induction', why: 'Matches obstetric event: induction of labour',
      test: c => sec(c) === 'XIV' && /induction/i.test(c.desc),
      n: OB_N, v: [[27, 27]], pin: ['645', '658.1', '642.4', '656.5', '648.8', '642.5', '656.3', '651.0'], q: 'prolonged pregnancy premature rupture pre-eclampsia poor fetal growth' },
    { id: 'vd', why: 'Matches obstetric event: labour and vaginal delivery',
      test: c => (sec(c) === 'XIV' || sec(c) === 'II') && /deliver|labou?r|forceps|vacuum|ventouse|breech|version|induction|dystocia/i.test(c.desc) && !/drug delivery/i.test(c.desc),
      n: OB_N, v: [[27, 27]],
      pin: ['650', '664.0', '664.1', '664.2', '645', '658.1', '660.4', '669.5', '652.2', '654.2', '651.0', '651.1', '661.2', '662.1', 'V27.0', 'V27.2', 'V27.5'],
      q: 'delivery normal perineal laceration prolonged pregnancy premature rupture shoulder dystocia' },
    { id: 'ob', why: 'Matches obstetric procedure: pregnancy / fetal assessment', test: c => sec(c) === 'XIV',
      n: [[630, 679]], v: [[22, 24], [27, 28]], pin: ['655.9', '656.5', '656.3', 'V28.0', 'V28.3', 'V23.9'], q: 'pregnancy antenatal fetal' },
    { id: 'fert', why: 'Matches procedure: tubal patency / infertility investigation',
      test: c => FG(c) && /patency|hysterosalping|insufflation|infertil/i.test(c.desc),
      n: [[628, 628]], x: ['614.6', '256.4', 'V26', '617', '752'], pin: ['628.2', '628.9', 'V26.2', '614.6', '628.0', '617.2'], q: 'infertility female tubal' },
    { id: 'endo', why: 'Matches condition: endometriosis / pelvic adhesions',
      test: c => FG(c) && /endometriosis|lysis of adhes/i.test(c.desc),
      n: [[614, 614], [617, 617]], x: ['625.3', '625.0', '625.9', '628', '620'], pin: ['617.0', '617.1', '617.3', '614.6', '625.3', '625.0', '617.9'], q: 'endometriosis adhesions pelvic pain dysmenorrhoea' },
    { id: 'congen', why: 'Matches condition: congenital anomaly of female genital tract',
      test: c => sec(c) === 'XIII' && /congenital/i.test(c.desc),
      x: ['752', '626.0', '625.0'], pin: ['752.4', '752.3', '752.2', '752.8', '626.0'], q: 'anomalies uterus vagina cervix' },
    { id: 'gyninj', why: 'Matches condition: non-obstetric injury of female genital tract',
      test: c => sec(c) === 'XIII' && /injury|non-obstetrical laceration|hematoma|haematoma/i.test(c.desc),
      x: ['867.4', '867.5', '867.6', '867.7', '939.2', '624.5', '623.6', '998.2', '624.4', '618.7'], pin: ['939.2', '624.5', '623.6', '867.4', '867.5', '998.2', '624.4'], q: 'injury haematoma vulva vagina uterus' },
    { id: 'cervix', why: 'Matches procedure site: cervix',
      test: c => FG(c) && (ch2(c) === 79 || /colposcop|cervi(x|cal)|cone biopsy|conization|\bLEEP\b|loop electr/i.test(c.desc)),
      x: ['622', '616.0', '180', '219.0', '233.1', '795.0', '795.1', '078.1', 'V76.2', 'V72.3', '752.4'],
      pin: ['795.0', '622.1', '233.1', '180', '616.0', '622.7', '078.1', 'V76.2'], q: 'cervix dysplasia papanicolaou smear carcinoma in situ cervicitis polyp' },
    { id: 'pessary', why: 'Matches procedure: vaginal pessary (pelvic organ support)',
      test: c => /pessary/i.test(c.desc) || /^10\.16/.test(c.code),
      x: ['618', '625.6', '788.3', '996.3', '623.5', '616.1'],
      pin: ['618.1', '618.0', '618.2', '618.3', '618.4', '618.5', '625.6', '996.3'], q: 'prolapse uterovaginal vaginal wall incontinence stress' },
    { id: 'ovary', why: 'Matches procedure site: ovary / adnexa',
      test: c => FG(c) && ([77, 78].includes(ch2(c)) || /ovar|oophor|salping|fallopian|adnex/i.test(c.desc)),
      n: [[614, 614], [620, 620], [628, 628]], x: ['183', '198.6', '220', '236.2', '256.4', '625.9', '617.1', '617.2', 'V26', 'V84'],
      pin: ['620.2', '620.0', '617.1', '614.6', '220', '183.0', '256.4'], onc: ['183.0', '183', '198.6', '236.2'], q: 'ovarian cyst endometriosis adhesions neoplasm ovary' },
    { id: 'uterus', why: 'Matches procedure site: uterus',
      test: c => FG(c) && ([80, 81].includes(ch2(c)) || /hysterect|myomect|endometri|uter(us|ine)|curettage|D ?& ?C\b/i.test(c.desc)),
      n: [[615, 615], [617, 618], [621, 621], [625, 627]], x: ['179', '180', '182', '218', '219.1', '233.1', '233.2', '236.0', '614', '620', '752'],
      pin: ['218', '626.2', '627.1', '618.1', '617.0', '621.0', '621.3', '182.0', '625.3'], onc: ['182.0', '180', '179', '233.2', '236.0'],
      q: 'uterus leiomyoma menorrhagia excessive menstruation postmenopausal bleeding prolapse endometrial hyperplasia' },
    { id: 'vagina', why: 'Matches procedure site: vagina / pelvic floor', test: c => FG(c) && ch2(c) === 82,
      n: [[618, 619], [623, 623]], x: ['614.4', '616.1', '184.0', '221.1', '233.3', '625.0', '625.6', '752.4', '078.1', '996.3'],
      pin: ['618.0', '618.5', '623.0', '616.1', '619.1', '625.6', '625.0', '221.1'], onc: ['184.0', '233.3'], q: 'vagina vaginal wall prolapse dysplasia vaginitis fistula' },
    { id: 'vulva', why: 'Matches procedure site: vulva / perineum', test: c => FG(c) && (ch2(c) === 83 || /vulv|bartholin|perine/i.test(c.desc)),
      n: [[624, 624]], x: ['616', '184.4', '221.2', '233.3', '078.1', '625.0', '618.7'],
      pin: ['616.2', '616.3', '624.0', '624.8', '616.1', '078.1', '624.4', '184.4'], onc: ['184.4', '233.3', '624.0'], q: 'vulva bartholin cyst abscess dystrophy' },
    { id: 'gyn', why: 'Matches procedure site: female genital organs', test: c => sec(c) === 'XIII',
      n: [[614, 629]], v: [[25, 26], [72, 72]], x: GYN_NEO, pin: [], q: 'female genital' },
    { id: 'breast', why: 'Matches procedure site: breast', test: c => sec(c) === 'XVI',
      n: [[610, 611]], x: ['174', '175', '217', '233.0', '238.3', '239.3', '793.8', 'V10.3', 'V16.3', 'V76.1'], pin: ['174.9', '611.7', '610.0', '610.1', '217', '233.0', '793.8'], onc: ['174.9', '233.0', '174'], q: 'breast neoplasm mass' }
  ];
  // Body-system ranges for other procedure sections (operations on X → diagnoses of X).
  const SYS = {
    II: { why: 'nervous system', n: [[320, 359], [191, 192], [225, 225], [430, 438], [741, 742], [850, 854], [950, 957]] },
    III: { why: 'endocrine system', n: [[240, 259], [193, 194], [226, 227]] },
    IV: { why: 'eye', n: [[360, 379], [190, 190], [224, 224], [743, 743], [870, 871], [918, 918], [921, 921], [930, 930], [940, 940]] },
    V: { why: 'ear', n: [[380, 389], [744, 744], [872, 872], [931, 931]] },
    VI: { why: 'nose, mouth and pharynx', n: [[470, 478], [520, 529], [140, 149], [160, 160], [210, 210], [749, 749], [802, 802], [873, 873], [932, 933]] },
    VII: { why: 'respiratory system', n: [[460, 519], [160, 163], [212, 212], [231, 231], [786, 786], [860, 862], [934, 934]] },
    VIII: { why: 'cardiovascular system', n: [[390, 459], [745, 747], [785, 785]] },
    IX: { why: 'haemic and lymphatic system', n: [[200, 208], [280, 289], [196, 196], [785, 785]] },
    X: { why: 'digestive system', n: [[520, 579], [150, 159], [211, 211], [230, 230], [787, 787], [935, 938]] },
    XI: { why: 'urinary tract', n: [[580, 599], [188, 189], [223, 223], [753, 753], [788, 788], [791, 791], [866, 867]], x: ['625.6', '996.3'] },
    XII: { why: 'male genital organs', n: [[600, 608], [185, 187], [222, 222], [752, 752]], v: [[25, 26]] },
    XV: { why: 'musculoskeletal system', n: [[710, 739], [800, 848], [754, 756], [170, 171], [213, 213], [215, 215], [905, 905]] },
    XVII: { why: 'skin and subcutaneous tissue', n: [[680, 709], [172, 173], [214, 214], [216, 216], [232, 232], [870, 897], [910, 919], [940, 949], [110, 111]], x: ['078.1'] }
  };
  function icdAllowed(i, r) {
    const code = i.code;
    if ((r.x || []).some(p => code === p || code.startsWith(p + '.') || (p.includes('.') && code.startsWith(p)))) return true;
    if (code[0] === 'E') return false;
    if (code[0] === 'V') { const n = parseInt(code.slice(1, 3), 10); return (r.v || []).some(([a, b]) => n >= a && n <= b); }
    const n = parseInt(code.slice(0, 3), 10);
    return (r.n || []).some(([a, b]) => n >= a && n <= b);
  }
  function icdRuleFor(c) {
    const r = SITE_RULES.find(r => r.test(c));
    if (r) return r;
    const s = SYS[sec(c)];
    if (s) return { id: 'sys', why: 'Matches procedure body system: ' + s.why, n: s.n, v: s.v, x: s.x, pin: [], q: '' };
    return null; // visits, consultations and general services: fee-skill scope
  }
  function suggestIcd(c) {
    const MAX = 8;
    const q = [c.desc, c.group, c.sub].filter(Boolean).join(' ').replace(/\d{2}\.\d+\s?[A-Z]*/g, ' ');
    const rule = icdRuleFor(c);
    if (rule) {
      const STOP = new Set(['delivery', 'vaginal', 'management', 'procedure', 'other', 'section', 'approach', 'method', 'repair', 'includes', 'without', 'additional', 'benefit', 'assisted', 'presentation', 'following', 'reason', 'minutes', 'first', 'claimed', 'abdominal', 'surgical', 'treatment', 'removal', 'insertion', 'operations', 'labour', 'labor', 'pregnancy', 'blood', 'absence', 'uterus', 'uterine', 'induction', 'medical', 'ectopic', 'umbilical', 'sampling', 'percutaneous']);
      const STOP6 = new Set(['hyster', 'pregna', 'labour', 'cesare', 'obstet']);
      const SYN = { multip: ['twin', 'triplet', 'multip'], reduct: ['twin', 'triplet'], incisi: ['wound', 'surgic'], rectal: ['fourth'], sphinc: ['third', 'fourth'], efface: ['incompet'], encirc: ['incompet'] };
      const fold = s => s.toLowerCase().replace(/ae/g, 'e').replace(/oe/g, 'e');
      const words = [...new Set((fold(c.desc).match(/[a-z]{5,}/g) || []).filter(w => !STOP.has(w)).map(w => w.slice(0, 6)).filter(w => !STOP6.has(w)))].flatMap(w => SYN[w] || [w]);
      const wm = i => { const d = fold(i.desc); return words.filter(w => d.includes(w)).length; };
      const onc = ONC.test(c.desc) && rule.onc ? rule.onc : [];
      const cand = new Map();
      const add = (i, base, score) => { if (!i || !icdAllowed(i, rule)) return; const prev = cand.get(i.code); const v = base + wm(i) * 100; if (!prev || prev.v < v) cand.set(i.code, { i, v, score }); };
      onc.forEach((code, k) => add(ICDBY[code], 300 - k, null));
      (rule.pin || []).forEach((code, k) => add(ICDBY[code], (rule.pinw || 60) - k, null));
      const query = (rule.q || '') + ' ' + q.split(/\s+/).slice(0, 8).join(' ');
      icdIndex.search(query, { limit: 40, filter: d => icdAllowed(d.i, rule), boost: d => d.i.code.includes('.') ? 1.1 : 1 }).hits
        .forEach(h => add(h.doc.i, Math.min(h.score, 30), h.score));
      const out = [...cand.values()].sort((x, y) => y.v - x.v).map(r => ({ i: r.i, score: (rule.pin || []).includes(r.i.code) || onc.includes(r.i.code) ? null : r.score, why: rule.why }));
      return { rows: out.slice(0, MAX), basis: rule.why };
    }
    let extra = '';
    CONCEPTS.forEach(([re, words]) => { if (re.test(c.desc + ' ' + (c.group || '') + ' ' + (c.sub || ''))) extra += ' ' + words; });
    const isVisit = /consultation|visit|assessment|examination|interview/i.test(c.desc + ' ' + (c.sub || ''));
    if (isVisit && skill === 'OBGY' && !/prenatal|obstetric/i.test(c.desc)) extra += ' pregnancy supervision pelvic pain menstruation menopausal';
    const why = (isVisit ? 'Visit/consultation code: ' : 'General service: ') + (FULL_ICD.has(skill) || !ICD_SCOPE[skill] ? 'full list (fee skill ' + (skill === 'BASE' ? 'not set' : skill) + ')' : skill + ' fee-skill scope');
    const VISIT_PINS = { OBGY: ['V22.1', 'V22.0', 'V23.9', 'V24.2', 'V72.3', '626.2', '627.1', '625.3'] };
    if (isVisit && VISIT_PINS[skill]) {
      const rows = VISIT_PINS[skill].map(k => ICDBY[k]).filter(i => i && icdInScope(i)).map(i => ({ i, why }));
      return { rows: rows.slice(0, MAX), basis: why };
    }
    if (isVisit) return { rows: [], basis: why, empty: 'Visit codes: diagnosis follows the presenting condition. Search the ICD-9 tab (' + scopeLabel() + ').' };
    const res = icdIndex.search((extra || q) + ' ' + (extra ? q.split(/\s+/).slice(0, 6).join(' ') : ''), { limit: MAX, filter: d => icdInScope(d.i), boost: d => d.i.code.includes('.') ? 1.1 : 1 });
    return { rows: res.hits.slice(0, MAX).map(h => ({ i: h.doc.i, score: h.score, why })), basis: why };
  }
  // Sub-codes in the Alberta list often read only "Unspecified" or "Ovary"; prefix the parent category for context.
  function icdLabel(i) {
    if (!i.code.includes('.') || i.desc.length > 40) return i.desc;
    let p = ICDBY[i.code.split('.')[0]];
    if (!p && i.code.split('.')[1].length > 1) p = ICDBY[i.code.slice(0, -1)];
    // The source PDF repeats a child's title on a few parent rows (e.g. 618); skip those parents rather than mislabel.
    const dup = p && [...'0123456789'].some(d => { const k = ICDBY[p.code + '.' + d]; return k && p.desc.slice(0, 30).toLowerCase() === k.desc.slice(0, 30).toLowerCase(); });
    return p && p.desc && !dup && !i.desc.toLowerCase().includes(p.desc.toLowerCase()) ? p.desc + ': ' + i.desc : i.desc;
  }
  function renderIcdList(el, rows, emptyMsg) {
    if (!rows.length) { el.innerHTML = '<p class="muted small">' + esc(emptyMsg || 'No ICD-9 suggestions in this scope.') + '</p>'; return; }
    el.innerHTML = rows.map(r => `<div class="icdrow" data-icd="${esc(r.i.code)}"><div><span class="code">${esc(r.i.code)}</span> ${esc(icdLabel(r.i))}
      <div class="small muted">${esc(r.i.block || '')}${r.score != null ? ' · score ' + r.score.toFixed(2) : (r.why ? ' · key match' : '')}</div>${r.why ? `<div class="small why">Why suggested: ${esc(r.why)}</div>` : ''}</div>
      <div class="btns">${star('I:' + r.i.code)}<button class="ghost" data-copy="${esc(r.i.code)}">Copy</button><button class="ghost" data-medres="${esc(r.i.code)}">More about this condition</button></div></div>`).join('');
  }
  function icdSearch(q) {
    const el = $('#icdresults');
    q = q.trim(); if (!q) { el.innerHTML = ''; return; }
    const cq = q.toUpperCase().replace(/\s+/g, '');
    let rows;
    if (/^(V\d{0,2}|\d{1,3})(\.\d{0,2})?$/.test(cq)) rows = ICD.filter(i => i.code.startsWith(cq) && icdInScope(i)).slice(0, 25).map(i => ({ i }));
    else rows = icdIndex.search(q, { limit: 25, filter: d => icdInScope(d.i), boost: d => d.i.code.includes('.') ? 1.05 : 1 }).hits.map(h => ({ i: h.doc.i, score: h.score }));
    renderIcdList(el, rows);
    if (!rows.length) el.innerHTML = `<p class="muted">No matches in ${esc(scopeLabel())}.</p>`;
  }

  // ------------------------------------------------------------ Medical resources
  // Search term = condition name only. Use the code's own title when it is specific; fall back to parent + title.
  function condTerm(i) {
    const GENERIC = /^(unspecified|other|others|without|with |not specified|site unspecified|closed|open|nos\b|ovary$|uterus$|vagina$|vulva$|breast)/i;
    const own = i.desc.trim();
    let d = own;
    if (own.length < 14 || GENERIC.test(own)) { const lab = icdLabel(i); d = lab.includes(': ') ? lab.split(': ')[0] : lab; }
    if (GENERIC.test(d) && i.block) d = i.block.replace(/\([^)]*\)/g, '').trim();
    d = d.replace(/,\s*(closed|open)$/i, '');
    return d.replace(/\([^)]*\)/g, ' ').replace(/:/g, ' ').replace(/\b(without|with) mention of .*$/i, ' ')
      .replace(/,?\s*(unspecified|not elsewhere classified|nec|other specified|other|unspecified site|not specified as malignant or benign)\b/gi, ' ')
      .replace(/\s+/g, ' ').replace(/[:,\s-]+$/, '').trim() || own;
  }
  function resourcesHtml(icd) {
    const term = icd ? condTerm(icd) : null;
    const regs = region === 'ALL' ? RES.regions : RES.regions.filter(r => r.id === region);
    const item = it => {
      const url = term && it.search ? it.search.replace('{q}', encodeURIComponent(term)) : it.home;
      const kind = term && it.search ? 'search' : 'home';
      return `<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(it.name)}</a> <span class="small muted">${kind === 'search' ? 'search' : 'site'}${it.sub ? ' · subscription' : ''}${it.obgy ? ' · OB/GYN' : ''}${it.pt ? ' · patient-facing' : ''}</span></li>`;
    };
    const sel = `<label class="small">Region <select id="regionSel"><option value="ALL">All</option>${RES.regions.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></label>`;
    return `${sel}${regs.map(r => {
      const orgs = r.orgs.filter(o => !o.obgy || skill === 'OBGY' || skill === 'BASE' || !icd);
      const js = r.journals.filter(o => !o.obgy || skill === 'OBGY' || skill === 'BASE' || !icd);
      return `<div class="region"><h3>${esc(r.name)}</h3><ul>${orgs.map(item).join('')}</ul>${r.local ? `<h4>${esc(r.localLabel || 'Regional and local resources')}</h4><ul>${r.local.map(item).join('')}</ul>` : ''}${r.charities ? `<h4>National Health Charities &amp; Organizations</h4><ul>${r.charities.map(item).join('')}</ul>` : ''}<h4>Journals</h4><ul>${js.map(item).join('')}</ul></div>`;
    }).join('')}
    <p class="small muted">External links for reference; MedFee Desk is not affiliated. Search links carry only the condition name${icd ? ` ("${esc(term)}")` : ''}.</p>
    <p class="small muted">ICD-10/ICD-11 equivalents: no validated crosswalk from the Alberta ICD-9 supplement is bundled; use the WHO ICD-10/11 browsers above.</p>`;
  }
  function wireRegion(root, icd) {
    const s = $('#regionSel', root); if (!s) return;
    s.value = region;
    s.onchange = () => { region = s.value; LS.set('region', region); if (icd) showMedRes(icd.code); else renderResources(); };
  }
  function renderResources() {
    const el = $('#resources');
    el.innerHTML = `<div class="condhead"><h2>Resources</h2><p class="small muted">Clinical and guideline sources by region. Open “More about this condition” on any ICD-9 code for condition-specific searches.</p></div>` + resourcesHtml(null);
    wireRegion(el, null);
  }
  // Top sources: ICD-9 range -> specialty -> ranked top 10 sites and top 10 journals (curated, data/top-sources.json).
  function topSpecialty(i) {
    const code = i.code;
    for (const m of TOP.map) {
      if (m.kind === 'x' && m.val.some(p => code === p || code.startsWith(p + '.') || (p.includes('.') && code.startsWith(p)))) return m.sp;
      if (m.kind === 'e' && code[0] === 'E') return m.sp;
      if (m.kind === 'v' && code[0] === 'V') { const n = parseInt(code.slice(1, 3), 10); if (n >= m.val[0] && n <= m.val[1]) return m.sp; }
      if (m.kind === 'n' && /^\d/.test(code)) { const n = parseInt(code.slice(0, 3), 10); if (n >= m.val[0] && n <= m.val[1]) return m.sp; }
    }
    return 'gen';
  }
  function topSourcesHtml(i) {
    const sp = TOP.specialties[topSpecialty(i)], term = condTerm(i), qe = encodeURIComponent(term);
    const sub = x => x.sub ? ' <span class="badge sub">subscription</span>' : '';
    const sites = sp.sites.map(k => TOP.sites[k]).map(s => `<li><a href="${esc(s.search ? s.search.replace('{q}', qe) : s.home)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a> <span class="small muted">${s.search ? 'search' : 'site'}</span>${sub(s)}</li>`).join('');
    const jours = sp.journals.map(k => TOP.journals[k]).map(j => `<li><a href="${esc('https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(term + ' AND "' + j.nlm + '"[jour]'))}" target="_blank" rel="noopener noreferrer">${esc(j.name)}</a> <span class="small muted">PubMed in journal · <a href="${esc(j.home)}" target="_blank" rel="noopener noreferrer">journal site</a></span>${sub(j)}</li>`).join('');
    return `<div class="topsrc"><h3>Top sources for <span class="code">${esc(i.code)}</span> ${esc(icdLabel(i))}</h3>
      <p class="small muted">${esc(sp.label)}. Ranked by authority, then relevance. Searches carry only "${esc(term)}".</p>
      <div class="topgrid"><div><h4>Top 10 websites</h4><ol>${sites}</ol></div><div><h4>Top 10 journals</h4><ol>${jours}</ol></div></div></div>
      <h3>Directory by region</h3>`;
  }
  function showMedRes(code) {
    const i = ICDBY[code]; if (!i) return;
    addRecent('I:' + code);
    let sec = $('#tab-medres');
    if (!sec) { sec = document.createElement('section'); sec.id = 'tab-medres'; sec.className = 'tab'; $('#main').appendChild(sec); }
    sec.innerHTML = `<div class="condhead"><div class="small muted">Medical resources</div><h2><span class="code">${esc(i.code)}</span>${star('I:' + i.code)} ${esc(icdLabel(i))}</h2>
      <div class="small muted">${esc(i.block || '')}${i.excl ? ' · ' + esc(i.excl) : ''}</div>
      <div class="row mt8"><button class="ghost" data-copy="${esc(i.code)}">Copy ICD-9</button><button class="ghost" id="medBack">Back</button></div></div>` + topSourcesHtml(i) + resourcesHtml(i);
    wireRegion(sec, i);
    $('#medBack', sec).onclick = () => history.back();
    showTab('medres');
    window.scrollTo(0, 0);
    if (location.hash !== '#/medres/' + code) history.pushState(null, '', '#/medres/' + code);
  }

  // ------------------------------------------------------------ other tabs
  function renderPrice() {
    const f = ($('#pf').value || '').trim().toLowerCase();
    const cq = f.toUpperCase().replace(/\s+/g, '');
    const rows = CODES.filter(c => !f || c.code.startsWith(cq) || (c.desc || '').toLowerCase().includes(f) || (c.section || '').toLowerCase().includes(f) || (c.sub || '').toLowerCase().includes(f));
    const show = rows.slice(0, 300);
    $('#pricelist').innerHTML = `<p class="small muted pad">${rows.length.toLocaleString()} of ${CODES.length.toLocaleString()} HSCs${rows.length > 300 ? ' (first 300 shown; refine the filter)' : ''}. Fee column uses fee skill ${esc(skill === 'BASE' ? 'base' : skill)}.</p>
      <table><thead><tr><th>HSC</th><th>Description</th><th>Base</th><th>${esc(skill === 'BASE' ? 'Fee' : skill)}</th><th>ANE</th><th>Cat</th></tr></thead><tbody>
      ${show.map(c => { const fe = feeFor(c); return `<tr><td class="nowrap">${star('H:' + c.code)}<a class="code" href="#/code/${esc(c.code)}">${esc(c.display || c.code)}</a></td><td>${esc(c.desc)}</td><td>${c.byAssess ? 'By assess' : money(c.base)}</td><td class="fee">${fe.amount == null ? '—' : money(fe.amount)}</td><td>${c.ane != null ? money(c.ane) : ''}</td><td>${esc(c.cat || '')}</td></tr>`; }).join('')}
      </tbody></table>`;
  }
  function renderRules() {
    const f = ($('#rf').value || '').trim().toLowerCase();
    const rows = RULES.filter(r => !f || r.id === f || r.id.startsWith(f + '.') || r.text.toLowerCase().includes(f));
    $('#rules').innerHTML = `<p class="small muted">Medical governing rules, SOMB effective ${esc(fmtDate(META.sombEffective))} — ${rows.length} of ${RULES.length} rules. <a target="_blank" rel="noopener noreferrer" href="${esc(pdfUrl('rules'))}">PDF</a></p>` +
      rows.map(r => `<div class="rule" id="gr-${esc(r.id)}"><span class="code">GR ${esc(r.id)}</span>${grLinks(r.text)} <a class="small" target="_blank" rel="noopener noreferrer" href="${esc(pdfUrl('rules'))}#page=${r.page}">p.</a></div>`).join('');
  }
  function renderMods() {
    const f = ($('#mf').value || '').trim().toLowerCase();
    $('#modifiers').innerHTML = MODS.filter(t => !f || t.type.toLowerCase().includes(f) || t.text.toLowerCase().includes(f) || t.codes.some(c => c.code.toLowerCase().includes(f) || c.text.toLowerCase().includes(f)))
      .map(t => `<div class="rule"><span class="code">${esc(t.type)}</span>${esc(t.text)}${t.codes.length ? `<table><tbody>${t.codes.map(c => `<tr><td class="code">${esc(c.code)}</td><td>${esc(c.text)}</td></tr>`).join('')}</tbody></table>` : ''}</div>`).join('');
  }
  function renderExpl() {
    const f = ($('#ef').value || '').trim().toLowerCase();
    $('#explanatory').innerHTML = EXPL.filter(e => !f || e.code.toLowerCase().startsWith(f) || (e.title + ' ' + e.text).toLowerCase().includes(f))
      .map(e => `<div class="rule"><span class="code">${esc(e.code)}</span><b>${esc(e.title)}</b> <span class="small muted">${esc(e.group || '')}</span><br>${esc(e.text)}</div>`).join('');
  }
  function renderBulletins() {
    const list = BULL.slice().sort((a, b) => b.num - a.num);
    $('#bulletins').innerHTML = `<p class="small muted">AHCIP medical bulletins (MED 251 onward) from <a target="_blank" rel="noopener noreferrer" href="${esc(META.bulletinsDataset)}">open.alberta.ca</a>. HSCs named in a bulletin are flagged on the code detail.</p>` +
      list.map(b => `<div class="bul${b.superseded ? ' sup' : ''}"><b>MED ${b.num}</b> — ${esc(b.title)} <span class="small muted">${esc(b.date || b.created)}</span>
        ${b.superseded ? `<span class="badge s">superseded${b.supersededBy ? ' by MED ' + b.supersededBy : ''}</span>` : ''}
        ${b.supersedes && b.supersedes.length ? `<div class="small muted">Supersedes MED ${b.supersedes.join(', ')}</div>` : ''}
        <div class="small"><a target="_blank" rel="noopener noreferrer" href="${esc(b.url)}">Open PDF</a>${b.codes && b.codes.length ? ` · ${b.codes.length} HSCs: ${b.codes.slice(0, 40).map(c => `<a href="#/code/${esc(c)}">${esc(c)}</a>`).join(', ')}${b.codes.length > 40 ? '…' : ''}` : ''}</div></div>`).join('');
  }
  function hsc(code) { const c = BYCODE[code]; return c ? `<a href="#/code/${code}">${esc(c.display || code)}</a> ${esc(c.desc)} (<span class="fee">${c.byAssess ? 'by assessment' : money(feeFor(c).amount)}</span>)` : esc(code); }
  function gr(id) { return RULEBY[id] ? `<a href="#/rules/${id}">GR ${id}</a>` : 'GR ' + id; }
  function renderNotes() {
    $('#notes').innerHTML = `<div class="notes">
    <p class="small muted">Short claim notes written for MedFee Desk from the SOMB effective ${esc(fmtDate(META.sombEffective))}. Fees shown for fee skill ${esc(skill === 'BASE' ? 'base' : skill)}. The governing rule text prevails.</p>
    <div class="card"><h3>Cesarean section and BMI</h3><ul>
      <li>${hsc('86.9C')}; ${hsc('86.9D')}; ${hsc('86.9B')}. Neither 86.9C nor 86.9D may be claimed with 81.29C (HSC note).</li>
      <li>BMI modifier (BMIPRO for the surgeon/assistant, BMIANE/BMI2AN for anaesthesia) adds 25% where the price list lists it: adult BMI ≥ 40 or paediatric &gt; 97th percentile — ${gr('18.1')}.</li>
      <li>Surgical assist and anaesthesia are claimed under ROLE modifiers (SA, SAQS, ANE); anaesthetic benefit is separate from the surgical fee.</li></ul></div>
    <div class="card"><h3>Prenatal care</h3><ul>
      <li>Initial prenatal visit ${hsc('03.04B')} — once per pregnancy; full history, examination and prenatal record (${gr('8.1.1')}).</li>
      <li>Subsequent prenatal visits ${hsc('03.03B')} / ${hsc('03.03BZ')}; prenatal, emergency and hospital visits may be claimed up to and including the day of delivery, except when delivery occurs within 24 h of admission (${gr('8.1.2')}).</li>
      <li>Obstetrical consultation ${hsc('03.08B')}; repeat obstetrical consultation ${hsc('03.07C')}. Extended perinatology/uro-gynaecology consultation time: ${hsc('03.08M')} when the consultation exceeds 30 min.</li></ul></div>
    <div class="card"><h3>Vaginal delivery</h3><ul>
      <li>${hsc('87.98A')}; VBAC ${hsc('87.98C')}; additional newborn ${hsc('87.98D')}.</li>
      <li>Delivery benefit includes surgical induction, episiotomy and repair of 1st/2nd-degree lacerations, and ordinary immediate newborn care (${gr('8.1.4')}). When delivery occurs within 24 h of admission it includes the admission (03.04C) or hospital visit (03.03D) and post-partum hospital visits for one week (${gr('8.1.5')}).</li>
      <li>Add-ons claimable at 100% with delivery per HSC notes, e.g. ${hsc('87.82')}, ${hsc('87.89A')}, ${hsc('87.6')}, ${hsc('87.99A')}, ${hsc('84.21D')}.</li></ul></div>
    <div class="card"><h3>After-hours (unscheduled services and time premium)</h3><ul>
      <li>Periods: weekday evening 1700-2200, weekend/stat 0700-2200, any night 2200-0700 (${gr('15.3')}). Claim by the time the encounter starts, not the time of the call (${gr('15.6')}).</li>
      <li>SURC (EV, NTPM, NTAM, WK) on eligible HSCs requires a special call on the patient's behalf, unscheduled response outside normal hours, priority attendance and direct attendance (${gr('15.7.1')}). Not claimable when the physician initiates the service (${gr('15.4')}).</li>
      <li>After-hours time premium: ${hsc('03.01AA')} with SURT TEV/TNTP/TNTA/TWK/TST per 15 min of direct care, max 4 per hour (${gr('15.13')}).</li></ul></div>
    <div class="card"><h3>Special callbacks to hospital inpatient</h3><ul>
      <li>${hsc('03.05N')}; ${hsc('03.05P')}; ${hsc('03.05QA')}; ${hsc('03.05QB')}; ${hsc('03.05R')}.</li>
      <li>One callback/unscheduled benefit per encounter (${gr('15.5')}); subsequent inpatients in the same callback use ${hsc('03.03AR')}; ${hsc('03.03DF')} may be added (${gr('15.8')}). Maximums: ${gr('15.11')}.</li></ul></div>
    <div class="card"><h3>Consultations</h3><ul>
      <li>Comprehensive ${hsc('03.08A')} / ${hsc('03.08AZ')}; limited ${hsc('03.07A')}; repeat ${hsc('03.07B')}. Definitions: ${gr('4.3')}; referral requirements: ${gr('4.4')}.</li>
      <li>Comprehensive visits/consultations: once per 365 days per patient by the same physician (${gr('4.6.1')}). Not for transfer of care alone (${gr('4.4.1')}); repeat consultation requires a new referral request (${gr('4.4.6')}).</li>
      <li>Complex consultation modifier CMXC30 (where listed) for consultations meeting its time definition; telephone/video consult ${hsc('03.08CV')}. See MED 289 on telephone consults with invalid practitioner IDs.</li></ul></div>
    </div>`;
  }
  function renderStatic() { renderPrice(); renderRules(); renderMods(); renderExpl(); renderBulletins(); renderNotes(); renderResources(); renderIcdScope(); $('#limitSkill').disabled = !SKILL_SECTIONS[skill]; }

  // ------------------------------------------------------------ Ask AI (links only; prompt never includes typed text)
  const AIS = [
    { id: 'grok', name: 'Grok', url: p => 'https://grok.com/?q=' + encodeURIComponent(p) },
    { id: 'chatgpt', name: 'ChatGPT', url: p => 'https://chatgpt.com/?q=' + encodeURIComponent(p) },
    { id: 'claude', name: 'Claude', url: p => 'https://claude.ai/new?q=' + encodeURIComponent(p) },
    { id: 'gemini', name: 'Gemini', url: () => 'https://gemini.google.com/app', copy: true },
    { id: 'perplexity', name: 'Perplexity', url: p => 'https://www.perplexity.ai/search?q=' + encodeURIComponent(p) },
    { id: 'grokipedia', name: 'Grokipedia', url: (p, t) => 'https://grokipedia.com/search?q=' + encodeURIComponent(t || 'Alberta Schedule of Medical Benefits') }
  ];
  const effShort = () => shortDate(META.sombEffective);
  function codePrompt(c) {
    const d = (c.desc || '').slice(0, 160);
    return { text: `Alberta SOMB health service code ${c.code} (${d}), fee skill ${skill === 'BASE' ? 'not specified' : skill}, effective ${effShort()}: explain billing rules, common modifiers and appropriate ICD-9 codes. Verify against the current SOMB.`, topic: d };
  }
  function generalPrompt() {
    return { text: `Alberta Schedule of Medical Benefits (SOMB), fee skill ${skill === 'BASE' ? 'not specified' : skill}, effective ${effShort()}: explain how to choose health service codes, modifiers and ICD-9 diagnostic codes. Verify against the current SOMB.`, topic: 'Alberta Schedule of Medical Benefits' };
  }
  let aiPrompt = null, aiPick = null;
  function openAI(p) {
    aiPrompt = p; aiPick = null;
    const dlg = $('#aiDialog');
    $('#aiPrompt').textContent = p.text;
    const last = LS.get('ai', '');
    const order = AIS.slice().sort((a, b) => (b.id === last) - (a.id === last));
    $('#aiList').innerHTML = order.map(a => `<button type="button" data-ai="${a.id}" class="${a.id === last ? 'last' : ''}">${esc(a.name)}${a.copy ? '<br><span class="small muted">copies prompt</span>' : ''}${a.id === last ? '<br><span class="small muted">last used</span>' : ''}</button>`).join('');
    $('#aiConfirm').hidden = true; $('#aiList').hidden = false; $('#aiMsg').textContent = '';
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function wireAI() {
    $('#aiList').addEventListener('click', e => {
      const b = e.target.closest('button[data-ai]'); if (!b) return;
      aiPick = AIS.find(a => a.id === b.dataset.ai);
      $('#aiConfirmText').textContent = `This opens ${aiPick.name} outside MedFee Desk. Do not add patient names, PHN, DOB, chart or claim numbers.`;
      $('#aiList').hidden = true; $('#aiConfirm').hidden = false;
    });
    $('#aiBack').onclick = () => { $('#aiConfirm').hidden = true; $('#aiList').hidden = false; };
    $('#aiGo').onclick = async () => {
      if (!aiPick || !aiPrompt) return;
      LS.set('ai', aiPick.id);
      const url = aiPick.url(aiPrompt.text, aiPrompt.topic);
      if (aiPick.copy) {
        const w = window.open('about:blank', '_blank');
        const ok = await copy(aiPrompt.text, null);
        $('#aiMsg').textContent = ok ? 'Prompt copied, paste it.' : 'Copy failed; select the prompt above and copy it.';
        toast(ok ? 'Prompt copied, paste it' : 'Copy the prompt manually');
        if (w) { w.opener = null; w.location.href = url; } else window.open(url, '_blank', 'noopener');
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
        $('#aiDialog').close();
      }
    };
  }

  // ------------------------------------------------------------ feedback (POST only on explicit submit)
  const PHI = [
    /\b\d{5}[-\s]?\d{4}\b/, /\b\d{9}\b/, /\bPHN\b/i, /\bULI\b/, /\b(DOB|D\.O\.B\.?|date of birth|birth ?date|born on)\b/i,
    /\b(19|20)\d{2}[-\/.](0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])\b/,
    /\b(0?[1-9]|[12]\d|3[01])[-\/.](0?[1-9]|1[0-2])[-\/.]((19|20)\d{2}|\d{2})\b/,
    /\b(0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])[-\/.]((19|20)\d{2})\b/,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+(19|20)\d{2}\b/i,
    /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(19|20)\d{2}\b/i,
    /\b(MRN|chart\s*(no|number|#)|claim\s*(no|number|#))\b/i
  ];
  function wireFeedback() {
    const form = $('#fb'), msg = $('#fbmsg');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(form);
      const text = String(fd.get('message') || '');
      if (!text.trim()) { msg.textContent = 'Enter a suggestion.'; return; }
      if (PHI.some(re => re.test(text)) || PHI.slice(0, 5).some(re => re.test(String(fd.get('email') || '').replace(/@.*/, '')))) {
        msg.innerHTML = '<span class="warn">Remove patient identifiers before sending.</span>'; return;
      }
      if (fd.get('botcheck')) return;
      msg.textContent = 'Sending…';
      try {
        const r = await fetch('https://api.web3forms.com/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ access_key: fd.get('access_key'), subject: fd.get('subject'), email: fd.get('email') || undefined, message: text, botcheck: false }), referrerPolicy: 'no-referrer' });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.success !== false) { msg.textContent = 'Thank you. Suggestion sent.'; form.reset(); }
        else throw new Error('send failed');
      } catch (err) {
        msg.innerHTML = 'Could not send. Email <a href="mailto:delaramedbilling@gmail.com">delaramedbilling@gmail.com</a> instead.';
      }
    });
  }

  // ------------------------------------------------------------ misc
  async function copy(text, note) {
    try { await navigator.clipboard.writeText(text); if (note) toast(note); return true; }
    catch (e) {
      try { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); if (ok && note) toast(note); return ok; } catch (e2) { return false; }
    }
  }
  let tt; function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => el.hidden = true, 2200); }

  function wire() {
    $('#moreBtn').addEventListener('click', e => { e.stopPropagation(); const m = $('#moreMenu'); m.hidden = !m.hidden; $('#moreBtn').setAttribute('aria-expanded', String(!m.hidden)); });
    $('#moreMenu').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (!b) return; closeMore(); if (b.dataset.tab === 'procedures') { goHome(); return; } showTab(b.dataset.tab); history.replaceState(null, '', '#/' + b.dataset.tab); window.scrollTo(0, 0); });
    document.addEventListener('click', e => { if (!e.target.closest('.morewrap')) closeMore(); });
    $('#layoutToggle').addEventListener('click', () => {
      LS.set('layout', phone ? 'desktop' : 'phone'); applyLayout();
      if (current) showCode(current, true); else { $('.split').classList.remove('showing'); }
      if (lastQuery) doSearch(lastQuery, true);
    });
    window.addEventListener('resize', () => { if (!LS.get('layout', '')) { const was = phone; applyLayout(); if (was !== phone && current) showCode(current, true); } });
    $('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (!b) return; showTab(b.dataset.tab); history.replaceState(null, '', b.dataset.tab === 'procedures' && current ? '#/code/' + current : '#/' + b.dataset.tab); });
    const q = $('#q'), clr = $('#qclear');
    $('#qform').addEventListener('submit', e => { e.preventDefault(); q.blur(); doSearch(q.value); });
    q.addEventListener('input', () => { clr.hidden = !q.value; });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); q.blur(); doSearch(q.value); } });
    clr.addEventListener('click', () => { q.value = ''; clr.hidden = true; doSearch(''); q.focus(); });
    $('#limitSkill').addEventListener('change', () => lastQuery && doSearch(lastQuery, true));
    $('#results').addEventListener('click', e => {
      if (e.target.closest('#clearRecent')) { RECENT = []; TS.r = {}; saveLists(); renderSaved(); toast('Recent codes cleared'); return; }
      if (e.target.closest('#expSaved')) { exportSaved(); return; }
      if (e.target.closest('#impSaved')) { const f = $('#impFile'); f.value = ''; f.click(); return; }
      const b = e.target.closest('.hit'); if (!b) return;
      if (b.dataset.icd) showMedRes(b.dataset.icd); else showCode(b.dataset.code);
    });
    $('#impFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) importSaved(f); });
    if (FAVS.length) persistStorage();
    $$('[data-saved]').forEach(b => b.addEventListener('click', () => { closeMore(); openSaved(b.dataset.saved); }));
    $('#askGeneral').onclick = () => openAI(generalPrompt());
    const iq = $('#iq'), icl = $('#iclear');
    $('#iform').addEventListener('submit', e => { e.preventDefault(); iq.blur(); icdSearch(iq.value); });
    iq.addEventListener('input', () => { icl.hidden = !iq.value; });
    icl.addEventListener('click', () => { iq.value = ''; icl.hidden = true; icdSearch(''); iq.focus(); });
    let t; const deb = fn => () => { clearTimeout(t); t = setTimeout(fn, 150); };
    $('#pf').addEventListener('input', deb(renderPrice)); $('#rf').addEventListener('input', deb(renderRules));
    $('#mf').addEventListener('input', deb(renderMods)); $('#ef').addEventListener('input', deb(renderExpl));
    document.addEventListener('click', e => {
      const c = e.target.closest('[data-copy]'); if (c) { copy(c.dataset.copy, c.dataset.copy + ' copied'); return; }
      const m = e.target.closest('[data-medres]'); if (m) showMedRes(m.dataset.medres);
    });
    wireAI(); wireFeedback();
  }
  // Star toggles run in the capture phase so a tap never opens the row, card or link underneath.
  document.addEventListener('click', e => { const s = e.target.closest && e.target.closest('[data-fav]'); if (!s) return; e.preventDefault(); e.stopPropagation(); if (ready) toggleFav(s.dataset.fav); }, true);
  document.addEventListener('keydown', e => { const s = e.target.closest && e.target.closest('[data-fav]'); if (!s || (e.key !== 'Enter' && e.key !== ' ')) return; e.preventDefault(); e.stopPropagation(); if (ready) toggleFav(s.dataset.fav); }, true);
  // Home link: bound before data loads. Until the app is ready the plain href="./" reload still lands on home.
  let ready = false;
  $('#homeLink').addEventListener('click', e => { if (!ready) return; e.preventDefault(); goHome(); });

  // Service worker: bypass the HTTP cache for sw.js, check for updates on load and when the tab becomes visible,
  // and reload once when a new version takes control so stale code never lingers.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  }

  boot().then(() => { ready = true; }).catch(err => { document.body.insertAdjacentHTML('afterbegin', '<p class="pad warn">Could not load data files. Serve this folder over http (e.g. python3 -m http.server).</p>'); console.error(err); });
})();
