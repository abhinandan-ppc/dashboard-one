/* Vanilla DOM application for Truck-Dashboard.html.
 * Scope: Dispatch Planner + Auto Club. Excel upload overrides remain available;
 * Drive refresh is read-only and fetches only when this page opens or is refreshed.
 */
(function () {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attr = (v) => esc(v).replace(/`/g, '&#96;');
  const E = window.TruckEngine;
  const F = window.TruckFreight;
  const L = window.TruckLc;
  const fmt = window.TruckFormat.fmt;
  const money = window.TruckFormat.money;
  const toCsv = window.TruckFormat.toCsv;
  const allDims = window.TruckFormat.allDimensionEntries;
  const cityTable = window.INDIA_CITY_TABLE;
  const KINDS = [
    { kind: 'fr', label: 'Freight rate', token: '-FR' },
    { kind: 'sob', label: 'Transporter SOB', token: '-SOB' },
    { kind: 'plan', label: 'Dispatch plan', token: '-PLAN' },
    { kind: 'delay', label: 'Unloading delay', token: '-Delay' },
  ];
  const VIEWS = [
    ['planner', 'Dispatch Planner'],
    ['club', 'Auto Club'],
  ];
  const TABS = {
    planner: [['zone', 'Zone Plan'], ['manual-place', 'Vehicle Placement']],
    club: [['40', '40 MT Trucks'], ['32', '32 MT Trucks'], ['28', '28/26 MT Trucks'], ['ltl', 'LTL — Manual'], ['club-place', 'Vehicle Placement']],
  };

  const state = {
    view: 'planner', tab: { planner: 'zone', club: '40' }, planFilter: 'all', search: '',
    result: null, rawRows: null, fileName: '', sheetName: '', status: '', statusError: false,
    rateModel: null, rateName: '', rateStatus: 'No freight-rate file loaded',
    sob: null, sobMode: null, pendingSob: null, sobStatus: 'No SOB data loaded',
    placed: new Set(), manual: [], manualSeq: 1, fuzzy: [],
    db: { index: null, kinds: {}, at: null, error: '' }, busy: false,
    delayAuto: null, mapTruck: null, searchText: '',
  };

  function setStatus(message, error = false) { state.status = message; state.statusError = error; renderUploads(); }
  function titleForKind(kind) { return (state.db.index?.kinds?.[kind]?.file?.name) || ''; }

  function xlsxRead(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try { resolve(XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: false })); } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function parsePlanFile(file) {
    setStatus('Reading ' + file.name + ' …');
    try {
      const wb = await xlsxRead(file);
      const sheetName = wb.SheetNames.find(n => /plate|ct|ltl/i.test(n)) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
      if (!rows.length) throw new Error('No data rows found in "' + sheetName + '".');
      const corrections = [];
      for (const city of [...new Set(rows.map(r => r['Ship To Party City']).filter(Boolean))]) {
        const resolved = E.resolveCity(city, cityTable);
        if (resolved.coords && resolved.fuzzy) corrections.push({ from: city, to: resolved.matchedAs, dist: resolved.fuzzyDist });
      }
      state.fuzzy = corrections;
      state.rawRows = rows;
      state.placed = new Set(); state.manual = []; state.manualSeq = 1;
      state.fileName = file.name; state.sheetName = sheetName;
      setStatus('Building truck plan from ' + rows.length + ' rows …');
      state.result = await E.allocate(rows, cityTable);
      setStatus(rows.length + ' rows parsed from sheet "' + sheetName + '".');
      render();
      return true;
    } catch (err) {
      console.error(err); setStatus('Could not parse dispatch plan: ' + err.message, true); return false;
    }
  }

  async function parseRateFile(file) {
    state.rateStatus = 'Reading ' + file.name + ' …'; renderUploads();
    try {
      const wb = await xlsxRead(file);
      const sheetName = wb.SheetNames.find(n => /rate|freight|zone|state/i.test(n)) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
      if (!rows.length) throw new Error('No rate rows found in "' + sheetName + '".');
      state.rateModel = F.buildFreightRateModel(rows, wb); state.rateName = file.name;
      const bands = state.rateModel.odcBands.lengthBands.length + state.rateModel.odcBands.widthBands.length;
      state.rateStatus = state.rateModel.records.length + ' rate rows, ' + bands + ' ODC bands, and ' + (state.rateModel.rtoTable ? state.rateModel.rtoTable.states.size + ' RTO states' : 'no RTO table') + ' loaded.';
      render(); return true;
    } catch (err) { state.rateStatus = 'Could not parse rate file: ' + err.message; renderUploads(); return false; }
  }

  async function parseSobFile(file) {
    state.sobStatus = 'Reading ' + file.name + ' …'; renderUploads();
    try {
      state.pendingSob = F.parseSobWorkbook(await xlsxRead(file));
      state.sobStatus = state.pendingSob.transporters.length + ' transporters across ' + Object.keys(state.pendingSob.states).length + ' states parsed. Choose how to use it.';
      renderUploads();
    } catch (err) { state.sobStatus = 'Could not parse SOB file: ' + err.message; state.pendingSob = null; renderUploads(); }
  }

  async function downloadKind(kind, entry) {
    const res = await fetch('/api/truckdb-proxy?kind=' + encodeURIComponent(kind), { cache: 'no-store' });
    if (!res.ok) {
      let msg = await res.text(); try { msg = JSON.parse(msg).error || msg; } catch {}
      throw new Error(msg || 'Could not download ' + kind);
    }
    const blob = await res.blob();
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    if (head[0] !== 0x50 || head[1] !== 0x4b) throw new Error('Incomplete or invalid XLSX download: ' + (entry?.name || kind));
    return new File([blob], entry?.name || kind + '.xlsx', { lastModified: entry?.modified || Date.now() });
  }

  async function refreshDatabase() {
    if (state.busy) return;
    state.busy = true; state.db.error = ''; renderDbStrip();
    try {
      const res = await fetch('/api/truckdb-proxy', { cache: 'no-store' });
      const type = res.headers.get('content-type') || '';
      if (!type.includes('json')) throw new Error('Truck data service unavailable.');
      const index = await res.json();
      if (!res.ok) throw new Error(index.error || 'Drive index request failed.');
      const kinds = {};
      for (const kind of ['fr', 'sob', 'plan']) {
        const entry = index.kinds?.[kind]?.file;
        if (!entry) { kinds[kind] = { state: 'missing' }; continue; }
        try {
          const file = await downloadKind(kind, entry);
          let ok = true;
          if (kind === 'fr') ok = await parseRateFile(file);
          else if (kind === 'sob') {
            state.sob = F.parseSobWorkbook(await xlsxRead(file));
            state.sobMode = 'drive'; state.sobStatus = Object.keys(state.sob.states).length + ' states loaded from Drive.';
          } else if (kind === 'plan') ok = await parsePlanFile(file);
          if (ok === false) throw new Error('File could not be read as expected XLSX format.');
          kinds[kind] = { state: 'loaded', entry };
        } catch (err) { console.error(err); kinds[kind] = { state: 'error', entry, message: err.message }; }
      }
      state.db = { index, kinds, at: new Date(), error: '' };
    } catch (err) { state.db = { index: null, kinds: {}, at: new Date(), error: err.message }; }
    finally { state.busy = false; render(); }
  }

  function renderDbStrip() {
    const box = $('#dbStrip'); if (!box) return;
    const labels = { loaded: 'Loaded', missing: 'Missing', error: 'Error' };
    const cls = { loaded: 'nonodc', missing: 'odc', error: 'unresolved' };
    const rows = KINDS.map(k => {
      const s = state.db.kinds[k.kind] || { state: 'missing' };
      const info = state.db.index?.kinds?.[k.kind];
      return '<tr><td><b>' + esc(k.label) + '</b></td><td class="mono">' + esc(k.token) + '</td><td>'
        + (s.entry ? esc(s.entry.name) : '<span class="muted">No file with ' + esc(k.token) + '</span>') + '</td><td>'
        + (s.entry?.modified ? new Date(s.entry.modified).toLocaleString('en-GB') : '') + '</td><td><span class="pill ' + (cls[s.state] || '') + '">' + (state.busy ? 'Loading…' : labels[s.state] || '—') + '</span>'
        + (s.message ? ' <span class="muted">' + esc(s.message) + '</span>' : '')
        + (info?.older?.length ? ' <span class="muted">· ' + info.older.length + ' older file(s) ignored</span>' : '') + '</td></tr>';
    }).join('');
    box.innerHTML = '<div class="block-head"><div class="table-head"><h3 class="chart-title">Google Drive folder <span class="muted">— newest tagged file used</span></h3><div class="rank-controls">'
      + (state.db.at ? '<span class="muted">Updated ' + state.db.at.toLocaleTimeString('en-GB') + '</span>' : '')
      + '<button type="button" class="btn primary" id="dbRefresh" ' + (state.busy ? 'disabled' : '') + '>' + (state.busy ? 'Refreshing…' : '↻ Refresh data') + '</button></div></div></div>'
      + (state.db.error ? '<div class="status-line error">' + esc(state.db.error) + '</div>' : '')
      + '<div class="table-scroll"><table class="db-table"><thead><tr><th>Data</th><th>Tag</th><th>File used</th><th>Modified</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    $('#dbRefresh')?.addEventListener('click', refreshDatabase);
  }

  function uploadCard(id, title, hint, status, extra = '') {
    return '<div class="upload-card" id="' + id + '"><div class="upload-left"><div class="upload-icon">↥</div><div class="upload-text"><strong>' + esc(title) + '</strong><span>' + esc(hint) + '</span><div class="status-line' + (state.statusError && id === 'planUpload' ? ' error' : '') + '">' + esc(status || '') + '</div></div></div><div><input type="file" accept=".xlsx,.xls" id="' + id + 'Input">' + extra + '<button class="btn secondary" type="button" data-pick="' + id + 'Input">Choose file</button></div></div>';
  }

  function renderUploads() {
    const root = $('#uploads'); if (!root) return;
    if (state.view !== 'planner') { root.innerHTML = ''; return; }
    const plan = uploadCard('planUpload', state.fileName || 'Upload dispatch plan (.xlsx)', 'Sheet with SO No., Ship To Party City, Thick/Width/Length, ODC Remarks, Dispatch Plan', state.status, state.result ? '<button class="btn" type="button" data-pick="planUploadInput">Re-run</button>' : '');
    const rate = uploadCard('rateUpload', state.rateName || 'Upload freight rates (.xlsx)', 'Destination/state, zone, transporter freight and marketing recovery', state.rateStatus);
    const sobActions = '<button class="btn primary" type="button" id="sobSave" ' + (!state.pendingSob ? 'disabled' : '') + '>Save locally</button><button class="btn" type="button" id="sobAdhoc" ' + (!state.pendingSob ? 'disabled' : '') + '>Use this session</button><button class="btn text" type="button" id="sobClear">Clear saved SOB</button>';
    const sob = uploadCard('sobUpload', 'Upload Transporter SOB (.xlsx)', 'Per-state rows, transporter percentage columns', state.sobStatus + (state.sobMode ? ' · ' + state.sobMode : ''), sobActions);
    root.innerHTML = plan + rate + sob;
    $$('[data-pick]', root).forEach(btn => btn.addEventListener('click', () => $('#' + btn.dataset.pick)?.click()));
    $('#planUploadInput')?.addEventListener('change', e => { if (e.target.files[0]) parsePlanFile(e.target.files[0]); e.target.value = ''; });
    $('#rateUploadInput')?.addEventListener('change', e => { if (e.target.files[0]) parseRateFile(e.target.files[0]); e.target.value = ''; });
    $('#sobUploadInput')?.addEventListener('change', e => { if (e.target.files[0]) parseSobFile(e.target.files[0]); e.target.value = ''; });
    $('#sobSave')?.addEventListener('click', () => { try { localStorage.setItem(F.SOB_STORAGE_KEY, JSON.stringify(state.pendingSob)); state.sob = state.pendingSob; state.sobMode = 'saved locally'; state.pendingSob = null; state.sobStatus = 'SOB saved in this browser.'; render(); } catch (err) { state.sobStatus = 'Could not save: ' + err.message; renderUploads(); } });
    $('#sobAdhoc')?.addEventListener('click', () => { state.sob = state.pendingSob; state.sobMode = 'this session'; state.pendingSob = null; state.sobStatus = 'SOB active for this session.'; render(); });
    $('#sobClear')?.addEventListener('click', () => { localStorage.removeItem(F.SOB_STORAGE_KEY); if (state.sobMode === 'saved locally') { state.sob = null; state.sobMode = null; } state.sobStatus = 'Saved SOB cleared.'; render(); });
    const drop = $('#planUpload');
    ['dragenter', 'dragover'].forEach(ev => drop?.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => drop?.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('dragover'); }));
    drop?.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) parsePlanFile(f); });
  }

  function renderViewSwitch() {
    $('#viewSwitch').innerHTML = VIEWS.map(([id, label]) => '<button class="btn ' + (state.view === id ? 'primary' : '') + '" data-view="' + id + '">' + label + '</button>').join('');
    $$('[data-view]').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.view; render(); }));
  }

  function stateOfCity(city) { return F.lookupFreight(state.rateModel, cityTable, city).state || ''; }
  function placeOfCity(city) { const x = F.lookupFreight(state.rateModel, cityTable, city); return { state: x.state || '', zone: x.zone || '' }; }
  function matchesSearch(entries, cities = []) {
    const terms = state.searchText.toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (!terms.length) return true;
    const hay = entries.map(([so]) => String(so).toLowerCase()).concat(cities.map(c => String(c).toLowerCase()));
    return terms.some(t => hay.some(x => x.includes(t)));
  }
  function soMeta() { return state.result ? L.buildSoMeta(state.result.rows) : new Map(); }

  function renderKpis(result) {
    const byTier = { '40MT': 0, '32MT': 0, '28_26MT': 0 };
    result.trucks.forEach(t => byTier[t.tier]++);
    const placed = result.trucks.reduce((s, t) => s + t.totalMT, 0);
    const ltl = result.ltl.reduce((s, t) => s + t.pendingMT, 0);
    const odc = result.rows.reduce((s, r) => s + (r.isODC ? r.totalMT : 0), 0);
    const unresolved = result.rows.filter(r => !r.cityResolved).length;
    const data = [
      ['Total dispatch', fmt(result.totalMT) + ' MT', result.rows.length + ' lines', ''],
      ['40 MT trucks', byTier['40MT'], 'FTL · priority 1', ''],
      ['32 MT trucks', byTier['32MT'], 'priority 2', 'accent'],
      ['28/26 MT', byTier['28_26MT'], 'last resort', 'warn'],
      ['Placed on trucks', fmt(placed) + ' MT', Math.round(placed / (result.totalMT || 1) * 100) + '% of plan', 'accent'],
      ['LTL manual', fmt(ltl) + ' MT', result.ltl.length + ' pending lines', ltl > 0 ? 'warn' : ''],
      ['ODC tonnage', fmt(odc) + ' MT', Math.round(odc / (result.totalMT || 1) * 100) + '% of plan', ''],
      ['Unresolved cities', unresolved, 'excluded from clubbing', unresolved ? 'critical' : ''],
    ];
    return '<div class="kpi-grid">' + data.map(x => '<div class="kpi ' + x[3] + '"><div class="label">' + x[0] + '</div><div class="value">' + x[1] + '</div><div class="sub">' + x[2] + '</div></div>').join('') + '</div>';
  }

  function renderPlanPills(result) {
    const rows = result.rows.filter(r => r.totalMT > 0);
    const sum = fn => rows.filter(fn).reduce((s, r) => s + r.totalMT, 0);
    const count = fn => rows.filter(fn).length;
    const totalPlan = result.rows.reduce((s, r) => s + r.planMT, 0);
    const under = totalPlan - result.rows.reduce((s, r) => s + r.totalMT, 0);
    const isHtc = r => L.htcGroup(r.htc) === 'HTC';
    const isLc = r => L.isLcSoon(r.lcTs);
    const isOld = r => L.isAgeingHigh(r.ageing);
    const pills = [
      ['all', 'Total dispatch', fmt(sum(() => true)), count(() => true) + ' lines · plan ' + fmt(totalPlan) + ' − under loading ' + fmt(under), ''],
      ['htc', 'HTC (FN, Q, Q & T)', fmt(sum(isHtc)), count(isHtc) + ' lines', ''],
      ['nonhtc', 'Non-HTC', fmt(sum(r => !isHtc(r))), count(r => !isHtc(r)) + ' lines', ''],
      ['lc', 'LC expiry < 15 days', fmt(sum(isLc)), count(isLc) + ' lines · includes expired', 'critical'],
      ['ageing', 'Ageing > 15 days', fmt(sum(isOld)), count(isOld) + ' lines', 'critical'],
    ];
    return '<div class="plan-pills">' + pills.map(p => '<button class="plan-pill ' + p[4] + (state.planFilter === p[0] ? ' on' : '') + '" data-filter="' + p[0] + '" aria-pressed="' + (state.planFilter === p[0]) + '"><span class="pp-label">' + p[1] + '</span><span class="pp-value">' + p[2] + ' MT</span><span class="pp-sub">' + p[3] + '</span></button>').join('') + '</div>';
  }

  function filteredTruckRows(tier) {
    const meta = soMeta();
    const groups = { '40MT': [], '32MT': [], '28_26MT': [] };
    (state.result?.trucks || []).forEach(t => {
      if (!groups[t.tier] || !matchesSearch(t.lines.flatMap(l => l.soBreakdown), t.lines.map(l => l.city))) return;
      if (!t.lines.some(l => l.soBreakdown.some(([so]) => L.matchesPlanFilter(state.planFilter, meta.get(so))))) return;
      const states = [...new Set(t.lines.map(l => stateOfCity(l.city)).filter(Boolean))];
      groups[t.tier].push({ ...t, stateLabel: states.join(' / ') || 'Unknown state' });
    });
    Object.values(groups).forEach(list => list.sort((a, b) => a.stateLabel.localeCompare(b.stateLabel) || a.id.localeCompare(b.id)));
    return groups[tier] || [];
  }

  function odcPill(load) {
    const odc = load.odcMT || 0, total = load.totalMT ?? load.pendingMT, non = load.nonOdcMT ?? total - odc;
    if (odc <= .005) return '<span class="pill nonodc">NON ODC ' + fmt(non) + '</span>';
    if (non <= .005) return '<span class="pill odc">ODC ' + fmt(odc) + '</span>';
    return '<span class="pill mixed">MIXED ' + Math.round(odc / total * 100) + '% ODC</span>';
  }
  function tierPill(t) { const cl = t.tier === '40MT' ? 'tier40' : t.tier === '32MT' ? 'tier32' : 'tier28'; return '<span class="pill ' + cl + '">' + esc(t.tierLabel) + '</span>'; }

  function renderTruckTable(tier) {
    const trucks = filteredTruckRows(tier), meta = soMeta();
    const costRows = F.analysisRows(state.rateModel, cityTable, state.result);
    const cost = new Map();
    costRows.forEach(r => { if (r.transporterCost == null) { if (!cost.has(r.truck)) cost.set(r.truck, null); } else cost.set(r.truck, (cost.get(r.truck) || 0) + r.transporterCost); });
    const rows = trucks.map((t, idx) => {
      const placed = state.placed.has(t.id), clubbed = new Set(t.lines.map(l => l.customerKey || l.customer)).size > 1;
      const entries = t.lines.flatMap((l, li) => l.soBreakdown.map(([so, val]) => ({ li, so, val, customer: l.customer })));
      const perSo = (render, cls = '') => '<div class="' + cls + '">' + entries.map(e => '<div class="so-line club-' + e.li + '">' + (clubbed ? '<b class="club-badge">' + String.fromCharCode(65 + e.li) + '</b> ' : '') + render(e) + '</div>').join('') + '</div>';
      let stateHead = '';
      if (!idx || trucks[idx - 1].stateLabel !== t.stateLabel) stateHead = '<tr class="state-row"><td colspan="18"><b>' + esc(t.stateLabel) + '</b> <span class="muted">(' + trucks.filter(x => x.stateLabel === t.stateLabel).length + ' trucks)</span></td></tr>';
      const customers = clubbed ? t.lines.map((l, i) => '<div class="party club-' + i + '"><b class="club-badge">' + String.fromCharCode(65 + i) + '</b> ' + esc(l.customer) + '</div>').join('') : t.lines.map(l => esc(l.customer)).join(' + ');
      const cities = clubbed ? t.lines.map((l, i) => '<div class="party club-' + i + '"><b class="club-badge">' + String.fromCharCode(65 + i) + '</b> ' + esc(l.city) + '</div>').join('') : [...new Set(t.lines.map(l => l.city))].map(esc).join(' / ');
      const fill = Math.min(100, Math.round(t.totalMT / (t.tier === '40MT' ? 40 : t.tier === '32MT' ? 32 : 28) * 100));
      return stateHead + '<tr class="' + (placed ? 'row-placed' : '') + '"><td><label><input type="checkbox" data-place="' + attr(t.id) + '" ' + (placed ? 'checked' : '') + '> ' + (placed ? '<span class="pill nonodc">Placed</span>' : '') + '</label></td>'
        + '<td class="mono">' + esc(t.id) + '</td><td>' + tierPill(t) + (t.suggestion ? ' <span class="muted">suggestion</span>' : '') + '</td>'
        + '<td>' + customers + (clubbed ? '<small class="muted"> clubbed</small>' : '') + '</td><td>' + cities + '</td><td class="num">' + fmt(t.totalMT) + '</td>'
        + '<td><span class="fill-bar"><span style="width:' + fill + '%"></span></span>' + fill + '%</td><td>' + odcPill(t) + '</td>'
        + '<td class="so-item-cell">' + perSo(e => esc(e.so)) + '</td><td class="muted">' + perSo(e => allDims(e.val).map(d => '<span class="' + (d.odc ? 'dim-odc' : '') + '">' + esc(d.text) + '</span>').join(' / ') || '—') + '</td>'
        + '<td class="num">' + perSo(e => fmt(e.val.mt)) + '</td><td class="num">' + perSo(e => fmt(e.val.pieceWeight)) + '</td><td class="num">' + perSo(e => e.val.count) + '</td>'
        + '<td>' + perSo(e => esc(meta.get(e.so)?.htc || '—')) + '</td><td>' + perSo(e => { const ts = meta.get(e.so)?.lcTs; return ts == null ? '—' : '<span class="' + (L.isLcSoon(ts) ? 'lc-soon' : '') + '">' + L.formatLc(ts) + '</span>'; }) + '</td>'
        + '<td class="num">' + perSo(e => { const v = meta.get(e.so)?.ageing; return v == null ? '—' : '<span class="' + (L.isAgeingHigh(v) ? 'lc-soon' : '') + '">' + v + '</span>'; }) + '</td>'
        + '<td class="num freight-cell">' + money(cost.get(t.id) ?? null) + '</td><td><button class="btn btn-map" data-route="' + attr(t.id) + '">View route</button></td></tr>';
    }).join('');
    const csv = [['State','Truck','Priority','Customers','Destinations','MT','ODC MT','Non-ODC MT','SO/item','Dimensions','Picked Qty MT','Pc Wt','Pieces'], ...trucks.map(t => [t.stateLabel,t.id,t.tierLabel,t.lines.map(l=>l.customer).join(' + '),t.lines.map(l=>l.city).join(' / '),t.totalMT,t.odcMT,t.nonOdcMT,t.lines.flatMap(l=>l.soBreakdown.map(([so])=>so)).join('; '),t.lines.flatMap(l=>l.soBreakdown.map(([,v])=>allDims(v).map(d=>d.text).join(' / '))).join('; '),t.lines.flatMap(l=>l.soBreakdown.map(([,v])=>v.mt)).join('; '),t.lines.flatMap(l=>l.soBreakdown.map(([,v])=>v.pieceWeight)).join('; '),t.lines.flatMap(l=>l.soBreakdown.map(([,v])=>v.count)).join('; ')])];
    return '<section class="block"><div class="table-scroll"><table class="truck-table"><thead><tr><th>Placed</th><th>Truck</th><th>Priority</th><th>Customer(s)</th><th>Destination</th><th class="num">MT</th><th>Fill</th><th>ODC split</th><th>SO / item</th><th>Dimensions</th><th class="num">Picked MT</th><th class="num">Pc Wt</th><th class="num">Pcs</th><th>HTC</th><th>LC date</th><th class="num">Ageing</th><th class="num">Total cost</th><th>Map</th></tr></thead><tbody>' + (rows || '<tr><td colspan="18" class="empty-state">No trucks in this tier.</td></tr>') + '</tbody></table></div><button class="btn text csv-toggle" data-csv="truck-' + tier + '">Copy as CSV</button><textarea class="csv-box hidden" id="csv-truck-' + tier + '" readonly>' + esc(toCsv(csv)) + '</textarea></section>';
  }

  function renderSummary() {
    const result = state.result, meta = soMeta(), map = new Map();
    const add = (city, party, col, mt, so, val) => {
      if (!(mt > 0) || !L.matchesPlanFilter(state.planFilter, meta.get(so))) return;
      const { zone, state: st } = placeOfCity(city), key = [zone, st, city, party].join('|'), cell = city + '\u0001' + party;
      if (!map.has(key)) map.set(key, { key:cell, zone:zone||'Unknown', state:st||'Unknown', city, party, mt40:0, mt32:0, mt28:0, ltl:0, odc:0, htc:new Set(), dims:new Map(), lcTs:null, ageing:null });
      const r = map.get(key); r[col] += mt; r.odc += Math.min(mt, val.odcMt||0);
      allDims(val).forEach(d => r.dims.set(d.text, d.odc || r.dims.get(d.text) || false));
      if (meta.get(so)?.htc) r.htc.add(meta.get(so).htc);
      if (meta.get(so)?.ageing != null) r.ageing = Math.max(r.ageing ?? 0, meta.get(so).ageing);
      if (meta.get(so)?.lcTs != null) r.lcTs = Math.min(r.lcTs ?? Infinity, meta.get(so).lcTs);
    };
    result.trucks.forEach(t => t.lines.forEach(l => l.soBreakdown.forEach(([so,v]) => add(l.city,l.customer,t.tier==='40MT'?'mt40':t.tier==='32MT'?'mt32':'mt28',v.mt,so,v))));
    result.ltl.forEach(l => l.soBreakdown.forEach(([so,v]) => add(l.city,l.customer,'ltl',v.mt,so,v)));
    const rows = [...map.values()].sort((a,b)=>a.zone.localeCompare(b.zone)||a.state.localeCompare(b.state)||a.city.localeCompare(b.city)||a.party.localeCompare(b.party));
    const has28 = rows.some(r=>r.mt28>0), totals={mt40:0,mt32:0,mt28:0,ltl:0,odc:0};
    rows.forEach(r=>Object.keys(totals).forEach(k=>totals[k]+=r[k]||0));
    const grand = totals.mt40+totals.mt32+totals.mt28+totals.ltl;
    return '<section class="block"><div class="block-head"><h2>Dispatch summary — zone / state / city / party</h2><div class="block-desc">Click rows to select plan lines for manual truck building.</div></div><div class="table-scroll"><table><thead><tr><th>Zone</th><th>State</th><th>City</th><th>Party</th><th>HTC</th><th>LC date</th><th class="num">Ageing</th><th class="num">ODC MT</th><th class="num">Non-ODC MT</th><th>Dimensions</th><th class="num">40MT</th><th class="num">32MT</th>'+(has28?'<th class="num">28/26MT</th>':'')+'<th class="num">LTL</th><th class="num">Total</th></tr></thead><tbody>'+rows.map((r,i)=>{const total=r.mt40+r.mt32+r.mt28+r.ltl;return '<tr class="sum-row" data-sum="'+i+'"><td>'+esc(r.zone)+'</td><td>'+esc(r.state)+'</td><td>'+esc(r.city)+'</td><td>'+esc(r.party)+'</td><td>'+([...r.htc].join(', ')||'Non-HTC')+'</td><td>'+(r.lcTs==null?'—':L.formatLc(r.lcTs))+'</td><td class="num">'+(r.ageing??'—')+'</td><td class="num">'+fmt(r.odc)+'</td><td class="num">'+fmt(total-r.odc)+'</td><td class="muted">'+[...r.dims].map(([d,o])=>'<div class="'+(o?'dim-odc':'')+'">'+esc(d)+'</div>').join('')+'</td><td class="num">'+fmt(r.mt40)+'</td><td class="num">'+fmt(r.mt32)+'</td>'+(has28?'<td class="num">'+fmt(r.mt28)+'</td>':'')+'<td class="num">'+fmt(r.ltl)+'</td><td class="num">'+fmt(total)+'</td></tr>';}).join('')+'</tbody><tfoot><tr><td colspan="7">Total</td><td class="num">'+fmt(totals.odc)+'</td><td class="num">'+fmt(grand-totals.odc)+'</td><td></td><td class="num">'+fmt(totals.mt40)+'</td><td class="num">'+fmt(totals.mt32)+'</td>'+(has28?'<td class="num">'+fmt(totals.mt28)+'</td>':'')+'<td class="num">'+fmt(totals.ltl)+'</td><td class="num">'+fmt(grand)+'</td></tr></tfoot></table></div></section>';
  }

  function renderLtl() {
    const meta = soMeta(), out=[]; let c=0;
    state.result.ltlClusters.forEach(group=>{c++;group.forEach(item=>out.push({item,cluster:'C'+c,unresolved:false}));});
    state.result.ltlUnresolved.forEach(item=>out.push({item,cluster:'Unresolved',unresolved:true}));
    const list=out.filter(x=>matchesSearch(x.item.soBreakdown,[x.item.city])&&x.item.soBreakdown.some(([so])=>L.matchesPlanFilter(state.planFilter,meta.get(so))));
    const csv=[['Cluster','Customer','Destination','Pending MT','ODC MT','Non-ODC MT','SO breakdown'],...list.map(x=>[x.cluster,x.item.customer,x.item.city,x.item.pendingMT,x.item.odcMT,x.item.nonOdcMT,x.item.soBreakdown.map(([so,v])=>so+':'+v.mt).join('; ')])];
    return '<section class="block"><div class="block-head"><h2>LTL — manual clubbing worklist</h2><div class="block-desc">Nearby destinations grouped within 100 km.</div></div><div class="table-scroll"><table><thead><tr><th>Cluster</th><th>Customer</th><th>Destination</th><th class="num">Pending MT</th><th>ODC split</th><th>SO / item</th><th>Dimensions</th><th class="num">Pieces</th></tr></thead><tbody>'+list.map(x=>'<tr><td>'+x.cluster+'</td><td>'+esc(x.item.customer)+'</td><td>'+esc(x.item.city)+'</td><td class="num">'+fmt(x.item.pendingMT)+'</td><td>'+odcPill(x.item)+'</td><td class="mono">'+x.item.soBreakdown.map(([so,v])=>'<div>'+esc(so)+' ('+fmt(v.mt)+')</div>').join('')+'</td><td class="muted">'+x.item.soBreakdown.map(([,v])=>allDims(v).map(d=>'<div class="'+(d.odc?'dim-odc':'')+'">'+esc(d.text)+'</div>').join('')).join('')+'</td><td class="num">'+x.item.soBreakdown.reduce((s,[,v])=>s+v.count,0)+'</td></tr>').join('')+'</tbody></table></div><button class="btn text csv-toggle" data-csv="ltl">Copy as CSV</button><textarea class="csv-box hidden" id="csv-ltl" readonly>'+esc(toCsv(csv))+'</textarea></section>';
  }

  function renderPlacement(mode) {
    const auto = mode === 'auto' ? state.result.trucks.filter(t=>state.placed.has(t.id)).map(t=>({id:t.id,kind:'Auto club',size:t.tierLabel,mt:t.totalMT,odc:t.odcMT<=.005?'Non-ODC':t.nonOdcMT<=.005?'ODC':'Mixed '+Math.round(t.odcMT/t.totalMT*100)+'% ODC',customers:[...new Set(t.lines.map(l=>l.customer))],cities:[...new Set(t.lines.map(l=>l.city))],items:t.lines.flatMap(l=>l.soBreakdown.map(([so,v])=>so+' ('+fmt(v.mt)+')'))})) : [];
    const manual = mode === 'manual' ? state.manual.map(t => {
      const byIdx = new Map(state.result.rows.map(r => [r.rowIndex, r]));
      const rows = window.TruckManual.truckRows(t, byIdx);
      const summary = window.TruckManual.summarizeLines(rows);
      return {
        id: t.id, kind: 'Manual', size: summary.size, mt: summary.totalMT,
        odc: window.TruckManual.odcLabel(summary),
        customers: [...new Set(rows.map(r => r.shipTo))], cities: summary.cities,
        items: rows.map(r => r.so + '/' + r.soItm + ' (' + fmt(r.totalMT) + ')'),
      };
    }) : [];
    const all=manual.concat(auto), total=all.reduce((s,t)=>s+t.mt,0);
    return '<section class="block"><div class="block-head"><h2>Vehicle Placement ('+all.length+')</h2><div class="block-desc">Manual planner FTLs and Auto Club trucks marked Placed.</div></div>'+(all.length?'<div class="table-scroll"><table><thead><tr><th>Truck</th><th>Source</th><th>Size</th><th class="num">MT</th><th>ODC</th><th>Customers</th><th>Destinations</th><th>SO / item</th><th></th></tr></thead><tbody>'+all.map(t=>'<tr><td class="mono">'+esc(t.id)+'</td><td>'+t.kind+'</td><td>'+esc(t.size)+'</td><td class="num">'+fmt(t.mt)+'</td><td>'+t.odc+'</td><td>'+t.customers.map(esc).join('<br>')+'</td><td>'+t.cities.map(esc).join(' / ')+'</td><td class="mono">'+t.items.map(esc).join('<br>')+'</td><td><button class="btn" data-unplace="'+attr(t.id)+'">'+(t.kind==='Manual'?'Undo':'Unplace')+'</button></td></tr>').join('')+'</tbody><tfoot><tr><td colspan="3">Total</td><td class="num">'+fmt(total)+'</td><td colspan="5"></td></tr></tfoot></table></div>':'<div class="empty-state">No vehicles placed yet. Tick trucks in Auto Club or create a manual FTL in Zone Plan.</div>')+'</section>';
  }

  function renderUnresolved() {
    const rows=state.result.rows.filter(r=>!r.cityResolved&&r.totalMT>0), map=new Map();
    rows.forEach(r=>{const key=r.shipTo+'||'+r.cityRaw;if(!map.has(key))map.set(key,{key,customer:r.shipTo,city:r.cityRaw,mt:0});map.get(key).mt+=r.totalMT;});
    const list=[...map.values()];
    return '<section class="block"><div class="block-head"><h2>Unresolved destinations <span class="count-chip">'+list.length+'</span></h2><div class="block-desc">These are excluded from automatic clubbing.</div></div>'+(list.length?'<div class="table-scroll"><table><thead><tr><th>Customer</th><th>Destination</th><th class="num">Pending MT</th><th>Resolve</th></tr></thead><tbody>'+list.map(x=>'<tr><td>'+esc(x.customer)+'</td><td>'+esc(x.city)+'</td><td class="num">'+fmt(x.mt)+'</td><td><input class="search-input" data-resolve-input="'+attr(x.key)+'" placeholder="city or lat, lng" style="width:180px"><button class="btn" data-resolve="'+attr(x.key)+'">Resolve</button></td></tr>').join('')+'</tbody></table></div>':'<div class="empty-state">Every destination resolved to a known city.</div>')+(state.fuzzy.length?'<p class="block-desc">Autocorrected: '+state.fuzzy.map(x=>esc(x.from)+' → '+esc(x.to)).join(', ')+'</p>':'')+'</section>';
  }

  function buildManualTruck(rowIndexes, qty, overrides=[]) {
    const id='M'+String(state.manualSeq++).padStart(3,'0'); state.manual.push({id,rowIndexes,qty,overrides}); render();
  }
  function renderZonePlan() {
    return renderSummary()+'<section class="block"><div class="block-head"><h2>Manual FTL builder</h2><div class="block-desc">Select dispatch lines below; total must be ≤40 MT. Available tonnage already excludes quantities on prior manual FTLs.</div></div>'+renderManualPicker()+'</section>';
  }
  function renderManualPicker() {
    const used=new Map();state.manual.forEach(t=>t.rowIndexes.forEach(i=>used.set(i,(used.get(i)||0)+(t.qty?.[i]||0))));
    const rows=state.result.rows.filter(r=>r.totalMT-(used.get(r.rowIndex)||0)>.005&&matchesSearch([[r.so+'/'+r.soItm]],[r.cityRaw])&&L.matchesPlanFilter(state.planFilter,{group:L.htcGroup(r.htc),lcSoon:L.isLcSoon(r.lcTs),ageing:r.ageing}));
    const selected=new Set();
    const html='<div class="table-scroll"><table class="mf-table"><thead><tr><th>Select</th><th>State</th><th>Destination</th><th>Customer</th><th>SO/item</th><th class="num">Available MT</th><th>ODC</th><th>Dimensions</th><th>Auto truck</th></tr></thead><tbody>'+rows.map(r=>'<tr><td><input type="checkbox" data-manual-row="'+r.rowIndex+'"></td><td>'+esc(stateOfCity(r.cityRaw)||'Unknown')+'</td><td>'+esc(r.cityRaw)+'</td><td>'+esc(r.shipTo)+'</td><td class="mono">'+esc(r.so+'/'+r.soItm)+'</td><td class="num">'+fmt(r.totalMT-(used.get(r.rowIndex)||0))+'</td><td>'+(r.isODC?'<span class="pill odc">ODC</span>':'<span class="pill nonodc">NON ODC</span>')+'</td><td>'+fmt(r.widthMm/1000)+' × '+fmt(r.lengthM)+' m</td><td class="muted">'+esc((state.result.trucks.find(t=>t.lines.some(l=>l.soBreakdown.some(([so])=>so===r.so+'/'+r.soItm)))||{}).id||'LTL')+'</td></tr>').join('')+'</tbody></table></div><div class="mf-bar"><span id="manualSummary">0 lines selected</span><button class="btn primary" id="makeManual" disabled>Create manual FTL (≤40 MT)</button></div>';
    setTimeout(()=>{
      const table=$('.mf-table'); if(!table)return;
      table.addEventListener('change',e=>{if(e.target.matches('[data-manual-row]')){const i=Number(e.target.dataset.manualRow);e.target.checked?selected.add(i):selected.delete(i);$('#manualSummary').textContent=selected.size+' lines selected';$('#makeManual').disabled=!selected.size;}});
      $('#makeManual')?.addEventListener('click',()=>{const selectedRows=rows.filter(r=>selected.has(r.rowIndex));const total=selectedRows.reduce((s,r)=>s+r.totalMT,0);if(total>40){alert('Selected '+fmt(total)+' MT, over the 40 MT limit.');return;}const odc=selectedRows.filter(r=>r.isODC).reduce((s,r)=>s+r.totalMT,0), customers=new Set(selectedRows.map(r=>r.shipToKey));const overrides=[];if(odc>0&&odc<total&&odc/total<.6)overrides.push({code:'odc'});if(customers.size>2)overrides.push({code:'customers'});buildManualTruck(selectedRows.map(r=>r.rowIndex),Object.fromEntries(selectedRows.map(r=>[r.rowIndex,r.totalMT])),overrides);});
    },0);
    return html;
  }

  function renderTabsAndContent() {
    const result=state.result, view=state.view, tabs=TABS[view], active=state.tab[view];
    const buttons=tabs.map(([id,label])=>'<button class="tab-btn '+(active===id?'active':'')+'" data-tab="'+id+'">'+label+(id==='40'?'<span class="count-chip">'+filteredTruckRows('40MT').length+'</span>':id==='32'?'<span class="count-chip">'+filteredTruckRows('32MT').length+'</span>':id==='28'?'<span class="count-chip">'+filteredTruckRows('28_26MT').length+'</span>':'')+'</button>').join('');
    let content='';
    if(view==='planner') content=active==='zone'?renderZonePlan():renderPlacement('manual');
    else if(active==='40') content=renderTruckTable('40MT');
    else if(active==='32') content=renderTruckTable('32MT');
    else if(active==='28') content=renderTruckTable('28_26MT');
    else if(active==='ltl') content=renderLtl();
    else content=renderPlacement('auto');
    return '<div class="tabs">'+buttons+'</div>'+(view==='club'?'<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><input class="search-input" id="planSearch" placeholder="Search SO, item, city…" value="'+attr(state.searchText)+'"><button class="btn primary" id="recompute" '+(state.placed.size?'':'disabled')+'>Recompute remaining (unplaced only)</button></div>':'')+content+renderUnresolved();
  }

  function renderResults() {
    const root=$('#results');
    if(!state.result){root.innerHTML=state.statusError?'<div class="status-line error">'+esc(state.status)+'</div>':'<div class="empty-state">Loading dispatch plan from Drive…</div>';return;}
    root.innerHTML=renderKpis(state.result)+(state.view==='club'?renderPlanPills(state.result):'')+renderTabsAndContent();
    $$('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.planFilter=b.dataset.filter;render();}));
    $$('[data-tab]').forEach(b=>b.addEventListener('click',()=>{state.tab[state.view]=b.dataset.tab;render();}));
    $$('[data-place]').forEach(box=>box.addEventListener('change',()=>{box.checked?state.placed.add(box.dataset.place):state.placed.delete(box.dataset.place);render();}));
    $$('[data-route]').forEach(button=>button.addEventListener('click',()=>{
      const truck=state.result.trucks.find(t=>t.id===button.dataset.route); if(!truck)return;
      const stops=truck.lines.filter(l=>Array.isArray(l.coords)).slice().sort((a,b)=>E.haversineKm([20.8404,85.1512],a.coords)-E.haversineKm([20.8404,85.1512],b.coords));
      const destination=stops[stops.length-1]?.coords; if(!destination){alert('No mapped destination coordinates for this truck.');return;}
      const waypoints=stops.slice(0,-1).map(l=>l.coords.join(',')).join('|');
      const url='https://www.google.com/maps/dir/?api=1&origin=20.8404,85.1512&destination='+encodeURIComponent(destination.join(','))+(waypoints?'&waypoints='+encodeURIComponent(waypoints):'')+'&travelmode=driving';
      window.open(url,'_blank','noopener');
    }));
    $$('[data-csv]').forEach(b=>b.addEventListener('click',()=>$('#csv-'+b.dataset.csv)?.classList.toggle('hidden')));
    $$('[data-sum]').forEach(row=>row.addEventListener('click',()=>{row.classList.toggle('sum-selected');}));
    $$('[data-unplace]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.unplace.startsWith('M'))state.manual=state.manual.filter(t=>t.id!==b.dataset.unplace);else state.placed.delete(b.dataset.unplace);render();}));
    $('#planSearch')?.addEventListener('input',e=>{const p=e.target.selectionStart;state.searchText=e.target.value;const val=state.searchText;renderResults();const n=$('#planSearch');n?.focus();n?.setSelectionRange(p,p);});
    $('#recompute')?.addEventListener('click',recomputeRemaining);
    $$('[data-resolve]').forEach(b=>b.addEventListener('click',()=>resolveUnresolved(b.dataset.resolve)));
  }

  async function resolveUnresolved(key) {
    const item=key.split('||'), city=item[1], input=$('[data-resolve-input="'+CSS.escape(key)+'"]');
    const parsed=window.TruckCityOverrides.parseResolveInput(input?.value,E.resolveCity,cityTable);
    if(!parsed){alert('Enter a recognized Indian city or coordinates (lat, lng).');return;}
    cityTable[E.normalizeCityKey(city)]=parsed.coords;
    window.TruckCityOverrides.saveCityOverride(E.normalizeCityKey(city),parsed.coords);
    state.result=await E.allocate(state.rawRows,cityTable);render();
  }

  async function recomputeRemaining(){
    if(!state.result||!state.placed.size)return;
    const locked=state.result.trucks.filter(t=>state.placed.has(t.id)), used=new Map();
    locked.forEach(t=>t.lines.forEach(l=>l.soBreakdown.forEach(([so,v])=>used.set(so,(used.get(so)||0)+v.mt))));
    const remaining=state.rawRows.map(r=>{const key=r['SO No.']+'/'+r['SOItm'];const qty=Math.max(0,(Number(r['Dispatch Plan'])||0)-(Number(r['Under Loading'])||0)-(used.get(key)||0));return qty>.005?{...r,'Dispatch Plan':qty,'Under Loading':0}:null;}).filter(Boolean);
    const recomputed=await E.allocate(remaining,cityTable);recomputed.trucks.forEach(t=>t.id='R-'+t.id);
    state.result={...state.result,trucks:locked.concat(recomputed.trucks),ltl:recomputed.ltl,ltlClusters:recomputed.ltlClusters,ltlUnresolved:recomputed.ltlUnresolved};
    setStatus('Recomputed remaining plan; '+locked.length+' truck(s) locked.');render();
  }

  function render() {
    renderDbStrip();renderViewSwitch();renderUploads();renderResults();
    $('#legend').style.display=state.result?'flex':'none';
  }

  function resetAll(){
    state.view='planner';state.result=null;state.rawRows=null;state.placed.clear();state.manual=[];state.searchText='';
    render();refreshDatabase();
  }
  window.__hub_handle_reset=resetAll;
  window.__hub_handle_theme=function(value){ if(window.jsplTheme)window.jsplTheme.apply(value); };
  window.addEventListener('message',e=>{const m=e.data||{};if(m.type==='theme'&&window.__hub_handle_theme)window.__hub_handle_theme(m.value);if(m.type==='reset')resetAll();});
  if(window.parent&&window.parent!==window){try{window.parent.postMessage({type:'ready'},'*');}catch{}}

  function boot(){
    try{const raw=localStorage.getItem(F.SOB_STORAGE_KEY);if(raw){state.sob=JSON.parse(raw);state.sobMode='saved locally';state.sobStatus='Saved SOB loaded from this browser.';}}catch{}
    window.TruckManual={truckRows:(t,by)=>t.rowIndexes.map(i=>{const r=by.get(i);return r?{...r,totalMT:t.qty?.[i]??r.totalMT}:null;}).filter(Boolean),summarizeLines:rows=>{const totalMT=rows.reduce((s,r)=>s+r.totalMT,0),odcMT=rows.filter(r=>r.isODC).reduce((s,r)=>s+r.totalMT,0);return{size:totalMT<=28?'28/26 MT':totalMT<=32?'32 MT':totalMT<=40?'40 MT':'Over 40 MT',totalMT,odcMT,nonOdcMT:totalMT-odcMT,odcShare:totalMT?odcMT/totalMT*100:0,cities:[...new Set(rows.map(r=>r.cityRaw))]};},odcLabel:s=>s.odcMT<=.005?'Non-ODC':s.nonOdcMT<=.005?'ODC':'Mixed '+s.odcShare.toFixed(0)+'% ODC'};
    window.TruckCityOverrides=window.TruckCityOverrides||{};
    window.TruckCityOverrides.loadCityOverrides(cityTable);
    window.TruckFormat={fmt,money,toCsv,allDimensionEntries:allDims};
    window.TruckEngine=E;window.TruckFreight=F;window.TruckLc=L;
    window.TruckManual=window.TruckManual;
    window.TruckCityOverrides=window.TruckCityOverrides;
    render();
    refreshDatabase();
    window.TruckColumnResize?.installColumnResize?.();
    $('#boot-status').style.display='none';
  }

  // Hook uploads while maintaining the file input's normal override path.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
