// ============================================================
// IKEA PMA Cartographie — app.js (v3 — premium redesign)
// Store × PMA × Flux × CP × TA
// ============================================================

const M          = window.PMA_MAPPINGS;
const PMA_LIST   = window.PMA_LIST;
const FLUX_LIST  = window.FLUX_LIST;
const PMA_COLORS = window.PMA_COLORS;
const FLUX_COLORS= window.FLUX_COLORS;
const ZONE_COLORS= window.ZONE_COLORS;

// Assign stable ids to flows
M.flows.forEach((f, i) => { f._id = i; });

// Short display name for each flow
function flowShortName(f) {
  if (f.transitVia) return f.transitVia;
  if (f.flux === 'LCDD') return 'Direct magasin';
  return f.label.replace(/^[^·]+·\s*/, '').replace(/\(.*?\)/, '').trim() || f.flux;
}

const FLUX_DESC = {
  CCD:  'Central Customer Delivery',
  LCDD: 'Local Delivery Direct',
  LCDI: 'Local Delivery Indirect',
};

// Normalize source TA names: "TA00"/"TA 00"/"TA00 " → "TA0"; "TA Prio"/"TA PRIO" → "PRIO"
function normalizeTA(zoneName) {
  const s = String(zoneName).toUpperCase().trim();
  if (s.includes('PRIO')) return 'PRIO';
  const m = s.match(/(\d+)/);
  if (!m) return s.replace(/\s+/g,'');
  return 'TA' + parseInt(m[1], 10);
}

const SOURCE_TA_COLORS = {
  'TA0':  '#0E7490',
  'TA1':  '#16A34A',
  'TA2':  '#3B82F6',
  'TA3':  '#F59E0B',
  'TA4':  '#EF4444',
  'TA5':  '#A855F7',
  'TA6':  '#EC4899',
  'TA7':  '#6366F1',
  'PRIO': '#FFDB00',
};
function sourceTAColor(name) { return SOURCE_TA_COLORS[name] || '#6B7280'; }

// CP affectation categories
const CP_CATEGORY_COLORS = {
  propre: '#059669',   // green — 1 PMA, same store
  croise: '#7C3AED',   // purple — 1 PMA, different store delivers
  commun: '#F59E0B',   // amber — appears in 2+ PMA plans
};
const CP_CATEGORY_LABELS = {
  propre: 'Propre',
  croise: 'Croisé',
  commun: 'Commun',
};
const CP_CATEGORY_DESC = {
  propre: 'Territoire exclusif, livré par le magasin PMA',
  croise: 'Territoire d\'une PMA, livré par un autre magasin',
  commun: 'Présent dans le plan de 2+ PMAs',
};

// CP affectation category — computed from the global flowsByCP index (not filtered)
// propre: single PMA owns it, its own store delivers | croise: single PMA, foreign store delivers | commun: 2+ PMAs
function cpCategory(cp) {
  const flows = flowsByCP[cp] || [];
  if (!flows.length) return 'propre';
  const pmasPlan = new Set(flows.map(x => x.flow.pma));
  if (pmasPlan.size > 1) return 'commun';
  const planPMA = [...pmasPlan][0];
  for (const f of flows) {
    const storePMA = M.stores[f.flow.storeCode]?.pma;
    if (storePMA && storePMA !== planPMA) return 'croise';
  }
  return 'propre';
}

// Sort key for source TA labels (PRIO first, then numeric)
function sourceTASortKey(name) {
  if (name === 'PRIO') return -1;
  const m = name.match(/(\d+)/);
  return m ? parseInt(m[1],10) : 99;
}

// ============================================================
// State
// ============================================================
const ANALYST_MODE = new URLSearchParams(location.search).get('analyst') === '1';

// Decode shared scenario from URL (?scenario=<base64>)
function _decodeScenarioURL() {
  try {
    const raw = new URLSearchParams(location.search).get('scenario');
    if (!raw) return {};
    return JSON.parse(atob(raw));
  } catch { return {}; }
}

let state = {
  selectedPMAs:      new Set(['Lyon']),
  enabledFlowIds:    new Set(M.flows.map(f => f._id)),
  zoneFilter:        'all',
  taSourceFilter:    'all',
  cpCategoryFilter:  'all',
  unit:              'ta-source',
  mode:              'polygons',
  basemap:           'light',
  speedKmh:          65,
  showLogistics:     true,
  showOptimalOverlay: false,
  highlightCPs: new Set(),   // CPs highlighted from insight cards (shown with pin on map)
  scenario: {
    active: false,
    name: 'Scénario 1',
    assignments: _decodeScenarioURL(),
    history: [],   // undo stack — each entry is a snapshot of assignments
  },
  leftOpen:  true,
  rightOpen: true,
  drawerOpen: false,
};

// ============================================================
// Runtime data
// ============================================================
let map;
let baseLayers = {};
let layers     = { polygons: [], markers: [], heat: null, stores: [], rings: [], logistics: [] };
let cpData     = {};        // cp → { lat, lng, name, polygons, population }
let flowsByCP  = {};        // cp → [{ flow, zoneName, zoneLabel }]
let distMatrix = {};        // distMatrix[cp][storeCode] = km (all stores + supportStores)

// ============================================================
// Bootstrap
// ============================================================
(async () => {
  initMap();
  wireUI();
  buildFlowIndex();
  await loadCPGeometry();
  buildDistMatrix();
  document.getElementById('loading').style.display = 'none';
  renderAll();
})();

// ============================================================
// Flow index
// ============================================================
function buildFlowIndex() {
  flowsByCP = {};
  for (const flow of M.flows) {
    for (const [zoneName, zone] of Object.entries(flow.zones)) {
      for (const cp of zone.cps) {
        const k = String(cp).trim().padStart(5, '0');
        if (!flowsByCP[k]) flowsByCP[k] = [];
        flowsByCP[k].push({ flow, zoneName, zoneLabel: zone.label });
      }
    }
  }
}

// ============================================================
// Map init
// ============================================================
function initMap() {
  map = L.map('map', { zoomControl: true, preferCanvas: false }).setView([45.55, 5.1], 8);

  baseLayers.light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19,
  });
  baseLayers.terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenTopoMap (CC-BY-SA)', maxZoom: 17,
  });
  baseLayers.dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19,
  });
  baseLayers.light.addTo(map);
}

function setBasemap(name) {
  Object.values(baseLayers).forEach(l => map.removeLayer(l));
  baseLayers[name].addTo(map);
  state.basemap = name;
}

// ============================================================
// Geometry loading
// ============================================================
function setLoad(msg, pct) {
  document.getElementById('loading-msg').textContent = msg;
  if (pct !== undefined) document.getElementById('loading-bar').style.width = pct + '%';
}

function allCPs() {
  const s = new Set();
  for (const flow of M.flows)
    for (const z of Object.values(flow.zones))
      z.cps.forEach(cp => s.add(String(cp).trim().padStart(5, '0')));
  return [...s];
}

async function loadCPGeometry() {
  const cps = allCPs();
  setLoad(`Chargement de ${cps.length} codes postaux…`, 0);
  const batchSize = 25;
  let done = 0;
  for (let i = 0; i < cps.length; i += batchSize) {
    const batch = cps.slice(i, i + batchSize);
    await Promise.all(batch.map(async cp => {
      try {
        const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${cp}&fields=nom,centre,contour,population&format=json&geometry=contour`);
        if (!r.ok) return;
        const data = await r.json();
        if (!data.length) return;
        const polys = [];
        let lat = 0, lng = 0, n = 0, pop = 0, firstName = '';
        for (const c of data) {
          if (c.contour?.coordinates) polys.push(c.contour);
          if (c.centre?.coordinates) { lng += c.centre.coordinates[0]; lat += c.centre.coordinates[1]; n++; }
          if (typeof c.population === 'number') pop += c.population;
          if (!firstName) firstName = c.nom;
        }
        if (n) cpData[cp] = {
          lat: lat / n, lng: lng / n,
          name: data.length > 1 ? `${firstName} +${data.length - 1}` : firstName,
          polygons: polys, population: pop,
        };
      } catch (_) {}
    }));
    done += batch.length;
    setLoad(`Chargement… ${done}/${cps.length}`, (done / cps.length) * 100);
  }
}

// ============================================================
// Helpers
// ============================================================
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function timeZone(hours) {
  const m = hours * 60;
  if (m <= 45) return '1';
  if (m <= 60) return '2';
  if (m <= 110) return '3';
  return '4';
}

function fmt(n) { return n == null ? '—' : Number(n).toLocaleString('fr-FR'); }

function fmtTime(h) {
  if (h < 1) return `${Math.round(h * 60)} min`;
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return mm ? `${hh}h${String(mm).padStart(2,'0')}` : `${hh}h`;
}

function principalStore(pma) {
  return Object.values(M.stores).find(s => s.pma === pma);
}

function allStoresForOptim() {
  return { ...M.stores, ...(M.supportStores || {}) };
}

// Build distance matrix: cp → { storeCode → km } for ALL stores (active + support)
function buildDistMatrix() {
  const allS = allStoresForOptim();
  for (const [cp, d] of Object.entries(cpData)) {
    distMatrix[cp] = {};
    for (const [code, s] of Object.entries(allS)) {
      distMatrix[cp][code] = haversine(d.lat, d.lng, s.lat, s.lng);
    }
  }
}

// Returns the store code with minimum distance to this CP (active + support stores)
function getOptimalStore(cp) {
  const dists = distMatrix[cp];
  if (!dists) return null;
  let best = null, bestD = Infinity;
  for (const [code, d] of Object.entries(dists)) {
    if (d < bestD) { bestD = d; best = code; }
  }
  return best;
}

// Fill color for optimal-overlay mode: PMA color for active stores, gray for support
function getOptimalColor(cp) {
  const code = getOptimalStore(cp);
  if (!code) return '#6B7280';
  const pma = M.stores[code]?.pma;
  return pma ? PMA_COLORS[pma] : '#9CA3AF';
}

// Scenario: assign/unassign a CP, re-render (with undo stack)
function _pushHistory() {
  state.scenario.history.push({ ...state.scenario.assignments });
  if (state.scenario.history.length > 20) state.scenario.history.shift();
}
function assignScenario(cp, storeCode) {
  _pushHistory();
  if (storeCode) state.scenario.assignments[cp] = storeCode;
  else delete state.scenario.assignments[cp];
  map.closePopup();
  renderAll();
}
function unassignCP(cp) { _pushHistory(); delete state.scenario.assignments[cp]; renderAll(); }
function undoScenario() {
  if (!state.scenario.history.length) return;
  state.scenario.assignments = state.scenario.history.pop();
  renderAll();
}
function resetScenario() { _pushHistory(); state.scenario.assignments = {}; renderAll(); }
function toggleScenario() { state.scenario.active = !state.scenario.active; renderAll(); }

function shareScenario() {
  const encoded = btoa(JSON.stringify(state.scenario.assignments));
  const url = `${location.origin}${location.pathname}?scenario=${encoded}${ANALYST_MODE ? '&analyst=1' : ''}`;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('btn-share-scenario');
    if (btn) { btn.textContent = '✓ Lien copié !'; setTimeout(() => { btn.textContent = '🔗 Copier le lien'; }, 2000); }
  }).catch(() => { prompt('Copiez ce lien :', url); });
}
function toggleOptimalOverlay() { state.showOptimalOverlay = !state.showOptimalOverlay; renderAll(); }

// Toast notification
function showToast(msg, color = '#0A8754') {
  let t = document.getElementById('app-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'app-toast';
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9999;padding:10px 18px;border-radius:10px;font-size:12px;font-weight:700;color:white;box-shadow:0 4px 16px #0003;transition:opacity .3s;pointer-events:none';
    document.body.appendChild(t);
  }
  t.style.background = color;
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._to);
  t._to = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

// Highlight CPs from insight card on the map
const _hl = {};   // registry: id → { cps, label }
function _hlBtn(id, cps, label) { _hl[id] = { cps, label }; return `_hlShow('${id}')`; }
function _hlShow(id) { const e = _hl[id]; if (e) highlightOnMap(e.cps, e.label); }

function highlightOnMap(cpArray, label) {
  state.highlightCPs = new Set(cpArray);
  renderAll();
  // Fly to centroid of highlighted CPs
  const pts = cpArray.map(cp => cpData[cp]).filter(Boolean);
  if (pts.length) {
    const lat = pts.reduce((a, d) => a + d.lat, 0) / pts.length;
    const lng = pts.reduce((a, d) => a + d.lng, 0) / pts.length;
    map.flyTo([lat, lng], Math.max(map.getZoom(), 8), { duration: .8 });
  }
  showToast(`📍 ${cpArray.length} CP mis en évidence — ${label}`, '#6D28D9');
}
function clearHighlight() { state.highlightCPs = new Set(); renderAll(); }

function exportScenario() {
  const data = {
    name: state.scenario.name,
    timestamp: new Date().toISOString(),
    assignments: state.scenario.assignments,
    kpis: { reassigned: Object.keys(state.scenario.assignments).length },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: `scenario-pma-${Date.now()}.json` }).click();
  URL.revokeObjectURL(url);
}

// Quick-load scenario: Lyon (562) takes Z1+Z2 of Saint-Étienne (431)
function quickLoadLyonSupport431() {
  _pushHistory();
  for (const flow of M.flows) {
    if (flow.storeCode !== '431') continue;
    for (const [zoneName, zone] of Object.entries(flow.zones)) {
      const n = normalizeTA(zoneName);
      if (n !== 'TA1' && n !== 'TA2') continue;
      zone.cps.forEach(cp => { state.scenario.assignments[String(cp).trim().padStart(5,'0')] = '562'; });
    }
  }
  state.scenario.active = true; renderAll(); showToast("✓ Scénario chargé — CPs en violet sur la carte", "#6D28D9");
}

// Quick-load: Lyon (562) takes Chambéry (73xxx) + Voiron area from Grenoble (435)
function quickLoadLyonChamberysVoiron() {
  _pushHistory();
  const VOIRON = new Set(['38500','38290','38330','38340','38480']);
  for (const flow of M.flows) {
    if (flow.storeCode !== '435') continue;
    for (const zone of Object.values(flow.zones)) {
      zone.cps.forEach(cp => {
        const k = String(cp).trim().padStart(5,'0');
        if (k.startsWith('73') || VOIRON.has(k)) state.scenario.assignments[k] = '562';
      });
    }
  }
  state.scenario.active = true; renderAll(); showToast("✓ Scénario chargé — CPs en violet sur la carte", "#6D28D9");
}

function quickLoadAvignonValence() {
  _pushHistory();
  for (const flow of M.flows) {
    if (flow.storeCode !== '435') continue;
    for (const zone of Object.values(flow.zones)) {
      zone.cps.forEach(cp => {
        const k = String(cp).trim().padStart(5,'0');
        if (k.startsWith('26')) state.scenario.assignments[k] = 'Avignon';
      });
    }
  }
  state.scenario.active = true; renderAll(); showToast("✓ Scénario chargé — CPs en violet sur la carte", "#6D28D9");
}

function quickLoadDijonBourg() {
  _pushHistory();
  for (const flow of M.flows) {
    if (flow.storeCode !== '562') continue;
    for (const zone of Object.values(flow.zones)) {
      zone.cps.forEach(cp => {
        const k = String(cp).trim().padStart(5,'0');
        if (k.startsWith('01')) state.scenario.assignments[k] = 'Dijon';
      });
    }
  }
  state.scenario.active = true; renderAll(); showToast("✓ Scénario chargé — CPs en violet sur la carte", "#6D28D9");
}

function quickLoadClermontRoanne() {
  _pushHistory();
  const ROANNE = new Set(['42300','42120','42155','42190','42310','42410','42470','42600','42640','42670','42720','42820','42840','42370','42390','42420','42460']);
  for (const flow of M.flows) {
    if (flow.storeCode !== '431') continue;
    for (const zone of Object.values(flow.zones)) {
      zone.cps.forEach(cp => {
        const k = String(cp).trim().padStart(5,'0');
        if (ROANNE.has(k)) state.scenario.assignments[k] = '345';
      });
    }
  }
  state.scenario.active = true; renderAll(); showToast("✓ Scénario chargé — CPs en violet sur la carte", "#6D28D9");
}

function quickLoadClermontAnnecy() {
  _pushHistory();
  for (const flow of M.flows) {
    if (flow.storeCode !== '435') continue;
    for (const zone of Object.values(flow.zones)) {
      zone.cps.forEach(cp => {
        const k = String(cp).trim().padStart(5,'0');
        if (k.startsWith('74') || k.startsWith('73')) state.scenario.assignments[k] = '345';
      });
    }
  }
  state.scenario.active = true; renderAll(); showToast("✓ Scénario chargé — CPs en violet sur la carte", "#6D28D9");
}

// ============================================================
// Aggregation
// ============================================================
function visibleFlows() {
  return M.flows.filter(f =>
    state.selectedPMAs.has(f.pma) &&
    state.enabledFlowIds.has(f._id)
  );
}

function buildRecords() {
  const out = [];
  for (const flow of visibleFlows()) {
    const store = M.stores[flow.storeCode];
    for (const [zoneName, zone] of Object.entries(flow.zones)) {
      for (const cp of zone.cps) {
        const k = String(cp).trim().padStart(5, '0');
        const d = cpData[k];
        if (!d) continue;
        const dist = haversine(store.lat, store.lng, d.lat, d.lng);
        const time = dist / state.speedKmh;
        const tz = timeZone(time);
        if (state.zoneFilter !== 'all' && tz !== state.zoneFilter) continue;
        const sourceTA = normalizeTA(zoneName);
        if (state.taSourceFilter !== 'all' && sourceTA !== state.taSourceFilter) continue;
        const category = cpCategory(k);
        if (state.cpCategoryFilter !== 'all' && category !== state.cpCategoryFilter) continue;
        out.push({ cp: k, name: d.name, lat: d.lat, lng: d.lng,
          population: d.population || 0, polygons: d.polygons,
          flow, zoneName, zoneLabel: zone.label, sourceTA, category, store, dist, time, timeZone: tz });
      }
    }
  }
  return out;
}

function dedupe(records) {
  const seen = new Set(), out = [];
  for (const r of records) { if (!seen.has(r.cp)) { seen.add(r.cp); out.push(r); } }
  return out;
}

function uniqueSourceTAs(records) {
  return [...new Set(records.map(r => r.sourceTA))].sort((a,b) => sourceTASortKey(a) - sourceTASortKey(b));
}

// Source TAs available given current PMA + flux selection (ignoring the source-TA filter itself)
function availableSourceTAs() {
  const tas = new Set();
  for (const flow of M.flows) {
    if (!state.selectedPMAs.has(flow.pma)) continue;
    if (!state.enabledFlowIds.has(flow._id)) continue;
    Object.keys(flow.zones).forEach(z => tas.add(normalizeTA(z)));
  }
  return [...tas].sort((a,b) => sourceTASortKey(a) - sourceTASortKey(b));
}

// ============================================================
// Color scales
// ============================================================
let popMin, popMax, distMin, distMax, timeMin, timeMax;

function computeScales(records) {
  if (!records.length) { popMin=0;popMax=1;distMin=0;distMax=1;timeMin=0;timeMax=1; return; }
  popMin  = Math.min(...records.map(r=>r.population));
  popMax  = Math.max(...records.map(r=>r.population));
  distMin = Math.min(...records.map(r=>r.dist));
  distMax = Math.max(...records.map(r=>r.dist));
  timeMin = Math.min(...records.map(r=>r.time));
  timeMax = Math.max(...records.map(r=>r.time));
}

// HSL helpers for per-PMA zone shading
function hexToHSL(hex) {
  let r = parseInt(hex.slice(1,3),16)/255;
  let g = parseInt(hex.slice(3,5),16)/255;
  let b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0, l = (max+min)/2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) {
      case r: h = ((g-b)/d + (g<b?6:0))/6; break;
      case g: h = ((b-r)/d + 2)/6; break;
      case b: h = ((r-g)/d + 4)/6; break;
    }
  }
  return [Math.round(h*360), Math.round(s*100), Math.round(l*100)];
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1-l);
  const f = n => { const k=(n+h/30)%12; const c=l-a*Math.max(Math.min(k-3,9-k,1),-1); return Math.round(255*c).toString(16).padStart(2,'0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
// zone 1=dark (near), 2=medium, 3=light (far)
const ZONE_LIGHTNESS = { '1': 30, '2': 50, '3': 68 };
function pmaZoneColor(pma, zone) {
  const base = PMA_COLORS[pma] || '#888888';
  const [h, s] = hexToHSL(base);
  const l = ZONE_LIGHTNESS[zone] || 50;
  return hslToHex(h, Math.max(s, 55), l);
}

// TA source level → lightness (PRIO darkest, TA7 lightest)
const TA_SOURCE_LIGHTNESS = { 'PRIO':25, 'TA0':32, 'TA1':39, 'TA2':46, 'TA3':53, 'TA4':60, 'TA5':65, 'TA6':70, 'TA7':75 };
function pmaSourceTAColor(pma, taName) {
  const base = PMA_COLORS[pma] || '#888888';
  const [h, s] = hexToHSL(base);
  const l = TA_SOURCE_LIGHTNESS[taName] ?? 50;
  return hslToHex(h, Math.max(s, 55), l);
}

function colorFor(r) {
  const u = state.unit;
  const multi = state.selectedPMAs.size > 1;
  if (u === 'ta-source') return multi ? pmaSourceTAColor(r.flow.pma, r.sourceTA) : sourceTAColor(r.sourceTA);
  if (u === 'cp' || u === 'zone') {
    return multi ? pmaZoneColor(r.flow.pma, r.timeZone) : (ZONE_COLORS[r.timeZone] || '#999');
  }
  if (u === 'category')   return CP_CATEGORY_COLORS[r.category] || '#6B7280';
  if (u === 'population') return scale(r.population, popMin, popMax, ['#C7E9F8','#0EA5E9','#0C4A6E']);
  if (u === 'distance')   return scale(r.dist, distMin, distMax, ['#059669','#FFDB00','#DC2626']);
  if (u === 'time')       return scale(r.time, timeMin, timeMax, ['#059669','#FFDB00','#DC2626']);
  // Default: multi-PMA → PMA hue + zone lightness; single PMA → flat PMA color
  return multi ? pmaZoneColor(r.flow.pma, r.timeZone) : (PMA_COLORS[r.flow.pma] || '#0058A3');
}

function scale(v, mn, mx, palette) {
  if (mx - mn < 1e-6) return palette[0];
  const t = (v - mn) / (mx - mn);
  if (t < 0.5) return lerpHex(palette[0], palette[1], t * 2);
  return lerpHex(palette[1], palette[2], (t - 0.5) * 2);
}

function lerpHex(a, b, t) {
  const ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16);
  const [ar,ag,ab_] = [(ah>>16)&255,(ah>>8)&255,ah&255];
  const [br,bg,bb]  = [(bh>>16)&255,(bh>>8)&255,bh&255];
  const r=Math.round(ar+(br-ar)*t), g=Math.round(ag+(bg-ag)*t), b2=Math.round(ab_+(bb-ab_)*t);
  return '#'+((1<<24)+(r<<16)+(g<<8)+b2).toString(16).slice(1);
}

// ============================================================
// Map rendering
// ============================================================
function clearLayers() {
  ['polygons','markers','rings','stores','logistics'].forEach(k => {
    layers[k].forEach(l => map.removeLayer(l)); layers[k] = [];
  });
  if (layers.heat) { map.removeLayer(layers.heat); layers.heat = null; }
}

// ============================================================
// Logistics chain layer (CDC + LSC nodes + flow lines)
// ============================================================
const HUB_COLORS = {
  'IKEA':    { roof: '#FFDB00', body: '#0058A3' },
  'XPO':     { roof: '#FF8A80', body: '#C62828' },
  'JP Home': { roof: '#FFD54F', body: '#E65100' },
};

// Compute pixel offset to push LSC icon away from nearest store when overlapping
function computeNodeOffset(node) {
  let nearest = null, minDist = Infinity;
  for (const s of Object.values(M.stores)) {
    const d = haversine(node.lat, node.lng, s.lat, s.lng);
    if (d < minDist) { minDist = d; nearest = s; }
  }
  if (minDist > 18 || !nearest) return [0, 0];   // far enough, no offset needed
  const dLat = node.lat - nearest.lat;
  const dLng = node.lng - nearest.lng;
  const len = Math.sqrt(dLat*dLat + dLng*dLng) || 0.0001;
  // Push 38px in same direction as LSC is from store
  return [(dLng/len) * 38, (dLat/len) * 38];
}

function hubIcon(node, isSmall, ofX = 0, ofY = 0) {
  const c  = HUB_COLORS[node.operator] || { roof: '#9CA3AF', body: '#4B5563' };
  const code = (node.code || '').replace(/^CDC /, '').replace(/^LSC/, '');
  let W, H, html, totalH;

  if (isSmall) {
    // Compact LSC: 34×30 SVG, no operator badge (color speaks)
    W = 34; H = 30; totalH = H;
    html = `<div style="display:inline-block;filter:drop-shadow(0 2px 6px rgba(0,0,0,.55))">
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <polygon points="17,1 32,12 2,12" fill="${c.roof}"/>
        <rect x="2" y="12" width="30" height="16" rx="2.5" fill="${c.body}"/>
        <rect x="13" y="20" width="8" height="8" rx="1" fill="rgba(0,0,0,.30)"/>
        <text x="${W/2}" y="19.5" text-anchor="middle" fill="white" font-size="9" font-weight="900" font-family="system-ui,sans-serif">${code}</text>
      </svg>
    </div>`;
  } else {
    // CDC large: 50×46 SVG + 10px operator label
    W = 50; H = 46;
    const op = node.operator || '';
    totalH = H + 10;
    html = `<div style="text-align:center;display:inline-block;filter:drop-shadow(0 4px 12px rgba(0,0,0,.55))">
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <polygon points="25,2 48,18 2,18" fill="${c.roof}"/>
        <rect x="3" y="18" width="44" height="26" rx="3" fill="${c.body}"/>
        <rect x="20" y="29" width="10" height="15" rx="2" fill="rgba(0,0,0,.34)"/>
        <rect x="7" y="23" width="9" height="6" rx="1" fill="rgba(255,255,255,.42)"/>
        <rect x="34" y="23" width="9" height="6" rx="1" fill="rgba(255,255,255,.42)"/>
        <text x="${W/2}" y="42" text-anchor="middle" fill="white" font-size="10" font-weight="900" font-family="system-ui,sans-serif">${code}</text>
      </svg>
      <div style="background:${c.body};color:rgba(255,255,255,.88);font-size:7px;font-weight:800;padding:1px 5px;border-radius:0 0 3px 3px;letter-spacing:.06em;font-family:system-ui,sans-serif;line-height:1.5;margin-top:-2px">${op}</div>
    </div>`;
  }

  // iconAnchor: bottom-center by default ([W/2, totalH]); offset shifts visually NE/SW
  return L.divIcon({
    className: '',
    html,
    iconSize: [W, totalH],
    iconAnchor: [W/2 - ofX, totalH + ofY],
  });
}

function addArrowLine(from, to, color, dashed) {
  layers.logistics.push(
    L.polyline([from, to], {
      color, weight: dashed ? 2.2 : 2.8, opacity: .8,
      dashArray: dashed ? '6 5' : null, interactive: false,
    }).addTo(map)
  );
  const t = 0.78;
  const aLat = from[0] + (to[0]-from[0])*t, aLng = from[1] + (to[1]-from[1])*t;
  const angle = Math.atan2(to[1]-from[1], to[0]-from[0]) * 180/Math.PI;
  layers.logistics.push(
    L.marker([aLat, aLng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="font-size:16px;color:${color};line-height:1;transform:rotate(${angle}deg);filter:drop-shadow(0 0 2px white);font-weight:900">▲</div>`,
        iconSize: [16,16], iconAnchor: [8,8],
      }),
      interactive: false, zIndexOffset: 700,
    }).addTo(map)
  );
}

function nodePopup(nodeKey, nodes, connections) {
  const n = nodes[nodeKey];
  const c = HUB_COLORS[n.operator] || { body: '#4B5563' };
  const storesServed = [...new Set(connections.filter(x => x.lsc===nodeKey || (x.cdc===nodeKey && !x.lsc)).map(x => x.storeCode))];
  const pmasServed   = [...new Set(storesServed.map(s => M.stores[s]?.pma || s))];
  return `<div class="cp-popup">
    <div class="popup-hdr" style="background:${c.body}">
      <div class="popup-cp">${nodeKey}</div>
      <div class="popup-name">${n.label}</div>
    </div>
    <div class="popup-body">
      <table class="popup-tbl">
        <tr><td>Opérateur</td><td>${n.operator||'—'}</td></tr>
        <tr><td>Adresse</td><td style="font-size:10px;line-height:1.3">${n.address||'—'}</td></tr>
        <tr><td>Flux</td><td>${n.flux||'multi'}</td></tr>
        ${pmasServed.length ? `<tr><td>PMA servis</td><td>${pmasServed.join(', ')}</td></tr>` : ''}
      </table>
      ${n.description ? `<div style="margin-top:9px;font-size:10px;color:var(--ink-3);line-height:1.4">${n.description}</div>` : ''}
    </div>
  </div>`;
}

// Draw a thin leader line from real geo position to the offset icon position
function addLeaderLine(latlng, ofX, ofY) {
  if (!ofX && !ofY) return;
  // Convert pixel offset → approx lat/lng offset using current map zoom
  const pt = map.latLngToLayerPoint(latlng);
  const offsetPt = L.point(pt.x + ofX, pt.y - ofY);
  const offsetLatLng = map.layerPointToLatLng(offsetPt);
  layers.logistics.push(
    L.polyline([latlng, offsetLatLng], {
      color: '#9CA3AF', weight: 1, opacity: .6,
      dashArray: '2 3', interactive: false,
    }).addTo(map)
  );
}

function renderLogisticsLayer() {
  if (!state.showLogistics) return;
  const nodes = M.logisticsNodes || {};
  if (!Object.keys(nodes).length) return;

  // --- Parse visible flows to build active nodes + connections ---
  const activeCDCs = new Set(), activeLSCs = new Set();
  const connections = [];   // { cdc, lsc, storeCode, flux }

  for (const flow of visibleFlows()) {
    if (!flow.transitVia) continue;
    const tv = flow.transitVia;
    const mentioned = Object.keys(nodes).filter(k => tv.includes(k));
    let cdc = mentioned.find(k => nodes[k].type === 'CDC');
    const lsc = mentioned.find(k => nodes[k].type === 'LSC');
    if (!cdc && lsc) cdc = 'CDC SQF';   // infer CDC for LSC-only references
    if (!cdc) continue;
    activeCDCs.add(cdc);
    if (lsc && nodes[lsc]?.lat != null) activeLSCs.add(lsc);
    connections.push({ cdc, lsc: lsc || null, storeCode: flow.storeCode, flux: flow.flux });
  }

  // --- CDC markers (large) ---
  for (const cdcKey of activeCDCs) {
    const n = nodes[cdcKey];
    if (!n?.lat) continue;
    const [ofX, ofY] = computeNodeOffset(n);
    addLeaderLine([n.lat, n.lng], ofX, ofY);
    layers.logistics.push(
      L.marker([n.lat, n.lng], { icon: hubIcon(n, false, ofX, ofY), zIndexOffset: 900 })
        .bindPopup(nodePopup(cdcKey, nodes, connections), { maxWidth: 290 })
        .addTo(map)
    );
  }

  // --- LSC markers (small compact) for active LSCs with own coords ---
  for (const lscKey of activeLSCs) {
    const n = nodes[lscKey];
    if (!n?.lat) continue;
    // Skip if co-located with active CDC (would overlap)
    const parentCDC = [...activeCDCs].find(c => nodes[c].lat === n.lat && nodes[c].lng === n.lng);
    if (parentCDC) continue;
    const [ofX, ofY] = computeNodeOffset(n);
    addLeaderLine([n.lat, n.lng], ofX, ofY);
    layers.logistics.push(
      L.marker([n.lat, n.lng], { icon: hubIcon(n, true, ofX, ofY), zIndexOffset: 850 })
        .bindPopup(nodePopup(lscKey, nodes, connections), { maxWidth: 270 })
        .addTo(map)
    );
  }

  // --- Flow lines (deduped) ---
  const drawn = new Set();
  for (const conn of connections) {
    const cdcNode = nodes[conn.cdc];
    const lscNode = conn.lsc ? nodes[conn.lsc] : null;
    const store   = M.stores[conn.storeCode];
    if (!cdcNode?.lat || !store) continue;

    const cdcPt   = [cdcNode.lat, cdcNode.lng];
    const storePt = [store.lat, store.lng];
    const lscPt   = (lscNode?.lat != null) ? [lscNode.lat, lscNode.lng] : null;
    const isLCDI  = conn.flux === 'LCDI';
    const col     = FLUX_COLORS[conn.flux] || '#888';

    if (!isLCDI) {
      if (lscPt) {
        // CDC → LSC (gray dashed)
        const k1 = `cdc-lsc:${conn.cdc}|${conn.lsc}`;
        if (!drawn.has(k1)) { drawn.add(k1); addArrowLine(cdcPt, lscPt, '#9CA3AF', true); }
        // LSC → Store (flux color)
        const k2 = `lsc-sto:${conn.lsc}|${conn.storeCode}|${conn.flux}`;
        if (!drawn.has(k2)) { drawn.add(k2); addArrowLine(lscPt, storePt, col, false); }
      } else {
        // CDC → Store direct (LSC integrated/co-located)
        const k = `cdc-sto:${conn.cdc}|${conn.storeCode}|${conn.flux}`;
        if (!drawn.has(k)) { drawn.add(k); addArrowLine(cdcPt, storePt, col, false); }
      }
    } else {
      // LCDI: Store → CDC (dashed)
      const k = `lcdi:${conn.storeCode}|${conn.cdc}`;
      if (!drawn.has(k)) { drawn.add(k); addArrowLine(storePt, cdcPt, col, true); }
    }
  }

  // --- Infrastructure nodes (not in active flows) — shown faded ---
  for (const [key, n] of Object.entries(nodes)) {
    if (!n.lat) continue;
    if (activeCDCs.has(key) || activeLSCs.has(key)) continue;
    const coloc = [...activeCDCs].some(c => nodes[c]?.lat === n.lat && nodes[c]?.lng === n.lng);
    if (coloc) continue;
    const [ofX, ofY] = computeNodeOffset(n);
    layers.logistics.push(
      L.marker([n.lat, n.lng], {
        icon: hubIcon(n, n.type !== 'CDC', ofX, ofY),
        zIndexOffset: n.type === 'CDC' ? 900 : 850,
        opacity: 0.4,
      })
        .bindPopup(`<div class="cp-popup">
          <div class="popup-hdr" style="background:#6B7280">
            <div class="popup-cp">${key}</div>
            <div class="popup-name">${n.label}</div>
          </div>
          <div class="popup-body">
            <table class="popup-tbl">
              <tr><td>Opérateur</td><td>${n.operator||'—'}</td></tr>
              <tr><td>Adresse</td><td style="font-size:10px;line-height:1.3">${n.address||'—'}</td></tr>
              <tr><td>Flux</td><td>${n.flux||'—'}</td></tr>
            </table>
            <div style="margin-top:8px;font-size:10px;color:var(--ink-3)">Nœud inactif dans la vue actuelle.</div>
          </div>
        </div>`, { maxWidth: 260 })
        .addTo(map)
    );
  }
}

function renderMap(records) {
  clearLayers();
  computeScales(records);
  const unique = dedupe(records);
  const bounds = [];
  renderLogisticsLayer();

  // Stores + rings
  const activeCodes = new Set(visibleFlows().map(f => f.storeCode));
  for (const code of activeCodes) {
    const s = M.stores[code];
    const color = PMA_COLORS[s.pma];
    const icon = L.divIcon({
      className: '',
      html: `<div class="store-pin" style="background:${color}"><span>${s.code}</span></div>`,
      iconSize: [42,42], iconAnchor: [21,42],
    });
    layers.stores.push(
      L.marker([s.lat, s.lng], { icon, zIndexOffset: 1000 })
        .bindPopup(`<div class="cp-popup">
          <div class="popup-hdr" style="background:${color}">
            <div class="popup-cp">${s.name}</div>
            <div class="popup-name">Store ${s.code} · PMA ${s.pma}</div>
          </div>
          <div class="popup-body">
            <table class="popup-tbl">
              <tr><td>CP principal</td><td>${s.cp}</td></tr>
              <tr><td>Coordonnées</td><td>${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}</td></tr>
            </table>
          </div></div>`)
        .addTo(map)
    );
    [25, 50, 100].forEach(rkm =>
      layers.rings.push(L.circle([s.lat, s.lng], {
        radius: rkm*1000, color, weight: 1, opacity: .3,
        fillOpacity: .02, dashArray: '5 7', interactive: false,
      }).addTo(map))
    );
  }

  // Support store ghost markers (reference for optimization analysis)
  for (const s of Object.values(M.supportStores || {})) {
    const icon = L.divIcon({
      className: '',
      html: `<div class="support-pin"><span>${s.code.slice(0,3)}</span></div>`,
      iconSize: [36,36], iconAnchor: [18,36],
    });
    layers.stores.push(
      L.marker([s.lat, s.lng], { icon, zIndexOffset: 900 })
        .bindPopup(`<div class="cp-popup">
          <div class="popup-hdr" style="background:#6B7280">
            <div class="popup-cp">${s.name}</div>
            <div class="popup-name">Magasin support · référence optimisation</div>
          </div>
          <div class="popup-body">
            <table class="popup-tbl">
              <tr><td>Code</td><td>${s.code}</td></tr>
              <tr><td>Coordonnées</td><td>${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}</td></tr>
            </table>
            <div style="margin-top:8px;font-size:10px;color:var(--ink-3)">Magasin de référence pour l'analyse d'optimisation inter-PMA. Non inclus dans les flux actifs.</div>
          </div></div>`)
        .addTo(map)
    );
  }

  // CPs
  if (state.mode === 'heat') {
    const pts = unique.map(r => [r.lat, r.lng,
      state.unit === 'population' ? Math.min(1, r.population / 60000) : 0.6]);
    if (pts.length && L.heatLayer) {
      layers.heat = L.heatLayer(pts, {
        radius: 28, blur: 28, maxZoom: 12,
        gradient: { 0.2:'#0058A3', 0.4:'#00A6B4', 0.6:'#FFDB00', 0.8:'#F18B00', 1:'#DC2626' },
      }).addTo(map);
    }
    unique.forEach(r => bounds.push(L.latLng(r.lat, r.lng)));

  } else if (state.mode === 'polygons') {
    const hasHighlight = state.highlightCPs.size > 0;
    for (const r of unique) {
      const scenarioCode = state.scenario.active ? state.scenario.assignments[r.cp] : null;
      const isHighlighted = hasHighlight && state.highlightCPs.has(r.cp);
      let color, borderColor, borderWeight, borderDash, fillOpacity;
      fillOpacity = hasHighlight && !isHighlighted ? 0.18 : 0.68;
      if (state.showOptimalOverlay) {
        color = getOptimalColor(r.cp);
        borderColor = 'rgba(255,255,255,.6)';
        borderWeight = 0.7;
        borderDash = null;
      } else if (isHighlighted) {
        color = colorFor(r);
        borderColor = '#F97316';    // vivid orange ring
        borderWeight = 4;
        borderDash = null;
        fillOpacity = 0.9;
      } else if (scenarioCode) {
        color = '#8B5CF6';
        borderColor = '#6D28D9';
        borderWeight = 2.5;
        borderDash = '4 3';
      } else {
        color = colorFor(r);
        const cat = r.category;
        borderColor = cat === 'commun' ? '#F59E0B'
          : cat === 'croise' ? '#7C3AED'
          : 'rgba(255,255,255,.6)';
        borderWeight = cat === 'propre' ? 0.7 : 2.2;
        borderDash = cat === 'croise' ? '6 4' : null;
      }
      for (const poly of r.polygons) {
        const layer = L.geoJSON(poly, {
          style: { color: borderColor, weight: borderWeight, dashArray: borderDash, fillColor: color, fillOpacity },
        })
          .bindPopup(buildPopup(r), { maxWidth: 320 })
          .on('mouseover', e => e.target.setStyle({ weight: borderWeight + 1.5, fillOpacity: Math.min(fillOpacity + .15, 1) }))
          .on('mouseout', e => e.target.setStyle({ weight: borderWeight, fillOpacity, color: borderColor, dashArray: borderDash }))
          .addTo(map);
        layers.polygons.push(layer);
        const b = layer.getBounds();
        if (b.isValid()) bounds.push(b);
      }
    }

  } else {
    for (const r of unique) {
      const color = colorFor(r);
      const radius = state.unit === 'population' ? 4 + Math.sqrt(r.population) / 32
        : state.unit === 'distance' ? 4 + r.dist / 22 : 7;
      const m = L.circleMarker([r.lat, r.lng], {
        radius: Math.min(radius, 18),
        fillColor: color, color: '#fff', weight: 1.5, fillOpacity: .9,
      }).bindPopup(buildPopup(r), { maxWidth: 280 }).addTo(map);
      layers.markers.push(m);
      bounds.push(L.latLng(r.lat, r.lng));
    }
  }

  if (bounds.length) {
    const init = bounds[0] instanceof L.LatLngBounds ? bounds[0] : L.latLngBounds(bounds[0], bounds[0]);
    const merged = bounds.reduce((acc, b) => acc.extend(b), init);
    if (merged.isValid()) map.fitBounds(merged.pad(.06));
  }
}

// ============================================================
// Popup
// ============================================================
function buildPopup(r) {
  const allFlows = flowsByCP[r.cp] || [];
  const color = PMA_COLORS[r.flow.pma] || '#0058A3';
  const tzColor = ZONE_COLORS[r.timeZone] || '#999';
  const flowRows = allFlows.map(f => {
    const fluxColor = FLUX_COLORS[f.flow.flux];
    const storePMA  = M.stores[f.flow.storeCode]?.pma;
    const isCross   = storePMA && storePMA !== f.flow.pma;
    const via       = f.flow.transitVia || null;
    const storeObj  = M.stores[f.flow.storeCode];
    const storeName = storeObj ? storeObj.name.replace('IKEA ','') : `Store ${f.flow.storeCode}`;
    return `<div class="popup-flow-row" style="flex-direction:column;align-items:flex-start;gap:4px">
      <div style="display:flex;align-items:center;gap:6px;width:100%">
        <span style="width:9px;height:9px;border-radius:50%;background:${fluxColor};flex-shrink:0"></span>
        <span class="flux-badge" style="background:${fluxColor};padding:1px 7px">${f.flow.flux}</span>
        <b style="font-size:11px">${f.flow.pma}</b>
        ${isCross ? `<span style="font-size:9px;background:#EDE9FE;color:#7C3AED;padding:1px 6px;border-radius:4px;font-weight:700;margin-left:auto">inter-PMA</span>` : ''}
      </div>
      ${via ? `<div style="display:flex;align-items:center;gap:5px;padding-left:15px">
        <span style="font-size:10px;color:var(--ink-3)">via</span>
        <code style="font-size:10px;font-weight:700;color:var(--ink);background:white;padding:1px 6px;border-radius:4px;border:1px solid var(--line)">${via}</code>
      </div>` : ''}
      <div style="display:flex;gap:8px;padding-left:15px;font-size:10px;color:var(--ink-3)">
        <span>🏪 ${storeName}</span>
        <span>·</span>
        <span>${f.zoneName}</span>
      </div>
    </div>`;
  }).join('');

  // Distance comparison table (requires distMatrix)
  const allS = allStoresForOptim();
  const dists = distMatrix[r.cp];
  const distRows = dists ? Object.entries(allS)
    .map(([code, s]) => ({ code, name: s.name.replace('IKEA ',''), dist: dists[code] || 0, isActive: !!M.stores[code] }))
    .sort((a,b) => a.dist - b.dist)
    .map(e => {
      const isCurrent = M.stores[e.code]?.pma === r.flow.pma;
      const scenarioCurrent = state.scenario.assignments[r.cp] === e.code;
      const barW = Math.min(100, Math.round(e.dist / 2.5));
      return `<tr style="${isCurrent ? 'background:var(--blue-lt)' : ''}${scenarioCurrent ? 'background:#EDE9FE' : ''}">
        <td style="font-weight:${isCurrent||scenarioCurrent?'800':'600'};color:${isCurrent?'var(--blue)':scenarioCurrent?'#7C3AED':'var(--ink-2)'}">${e.name}</td>
        <td><div style="display:flex;align-items:center;gap:4px"><div style="width:${barW}px;height:4px;border-radius:2px;background:${isCurrent?'var(--blue)':scenarioCurrent?'#8B5CF6':'var(--line)'}"></div><span style="font-size:10px">${Math.round(e.dist)} km</span></div></td>
      </tr>`;
    }).join('') : '';

  // Scenario reassignment buttons
  const scenarioCode = state.scenario.assignments[r.cp];
  const scenarioSection = state.scenario.active ? `
    <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--line)">
      <div style="font-size:9px;font-weight:800;color:#7C3AED;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">🎯 Réaffecter ce CP</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${Object.values(M.stores).map(s =>
          `<button onclick="assignScenario('${r.cp}','${s.code}')"
            style="padding:4px 9px;border-radius:5px;font-size:10px;font-weight:700;border:1.5px solid ${PMA_COLORS[s.pma]};
            background:${scenarioCode===s.code?PMA_COLORS[s.pma]:'white'};color:${scenarioCode===s.code?'white':PMA_COLORS[s.pma]};cursor:pointer">${s.pma}</button>`
        ).join('')}
        ${Object.values(M.supportStores||{}).map(s =>
          `<button onclick="assignScenario('${r.cp}','${s.code}')"
            style="padding:4px 9px;border-radius:5px;font-size:10px;font-weight:700;border:1.5px solid #6B7280;
            background:${scenarioCode===s.code?'#6B7280':'white'};color:${scenarioCode===s.code?'white':'#6B7280'};cursor:pointer">${s.code}</button>`
        ).join('')}
        ${scenarioCode ? `<button onclick="assignScenario('${r.cp}',null)"
          style="padding:4px 9px;border-radius:5px;font-size:10px;font-weight:700;border:1.5px solid #DC2626;color:#DC2626;background:white;cursor:pointer">✕</button>` : ''}
      </div>
    </div>` : '';

  return `<div class="cp-popup">
    <div class="popup-hdr" style="background:${scenarioCode?'#7C3AED':color}">
      <div class="popup-cp">${r.cp} ${scenarioCode ? '<span style="font-size:12px;opacity:.85">🔀</span>' : ''}</div>
      <div class="popup-name">${r.name || ''}${scenarioCode ? ` · → ${(allS[scenarioCode]?.name||scenarioCode).replace('IKEA ','')}` : ''}</div>
    </div>
    <div class="popup-body">
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
        <div class="popup-ta" style="background:${sourceTAColor(r.sourceTA)};margin:0">
          ${r.sourceTA} <span style="opacity:.8;font-weight:600">· source plan</span>
        </div>
        <div class="popup-ta" style="background:${tzColor};margin:0">
          Z${r.timeZone || '?'} <span style="opacity:.8;font-weight:600">· temps</span>
        </div>
        <div class="popup-ta" style="background:${CP_CATEGORY_COLORS[r.category]};margin:0">
          ${CP_CATEGORY_LABELS[r.category]} <span style="opacity:.8;font-weight:600">· affectation</span>
        </div>
      </div>
      <table class="popup-tbl">
        <tr><td>Zone source</td><td>${r.zoneName} <span style="color:var(--ink-3);font-size:10px">(${r.sourceTA})</span></td></tr>
        <tr><td>Magasin</td><td>${r.store.name.replace('IKEA ','')}</td></tr>
        <tr><td>Population</td><td>${fmt(r.population)}</td></tr>
      </table>
      ${dists ? `<div style="margin-top:9px"><div style="font-size:9px;font-weight:800;color:var(--ink-3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">Distances tous magasins</div>
        <table class="popup-tbl">${distRows}</table></div>` : ''}
      <div class="popup-flows-hdr">Tous les flux (${allFlows.length})</div>
      ${flowRows}
      ${scenarioSection}
    </div>
  </div>`;
}

// ============================================================
// UI — Left panel
// ============================================================
function renderSourceTAFilter() {
  const box = document.getElementById('ta-source-tabs');
  const tas = availableSourceTAs();

  // Reset filter if current selection no longer applies
  if (state.taSourceFilter !== 'all' && !tas.includes(state.taSourceFilter)) {
    state.taSourceFilter = 'all';
  }

  const allActive = state.taSourceFilter === 'all';
  let html = `<button class="chip ${allActive?'active':''}" data-tas="all">Toutes</button>`;
  for (const t of tas) {
    const active = state.taSourceFilter === t;
    html += `<button class="chip ${active?'active':''}" data-tas="${t}" style="${active?'':'border-color:'+sourceTAColor(t)+'66'}">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${sourceTAColor(t)};margin-right:5px;vertical-align:middle"></span>${t}
    </button>`;
  }
  box.innerHTML = html;

  box.querySelectorAll('.chip').forEach(b => {
    b.onclick = () => {
      state.taSourceFilter = b.dataset.tas;
      renderAll();
    };
  });
}

function renderCategoryFilter() {
  const box = document.getElementById('cat-filter-tabs');
  if (!box) return;
  const cats = ['all', 'propre', 'croise', 'commun'];
  const catLabels = { all: 'Tous', propre: '● Propre', croise: '◎ Croisé', commun: '◉ Commun' };
  box.innerHTML = cats.map(c => {
    const active = state.cpCategoryFilter === c;
    const col = c !== 'all' ? CP_CATEGORY_COLORS[c] : null;
    return `<button class="chip ${active ? 'active' : ''}" data-cat="${c}"
      style="${active ? '' : (col ? 'border-color:'+col+'66;color:'+col : '')}">
      ${catLabels[c]}
    </button>`;
  }).join('');
  box.querySelectorAll('.chip').forEach(b => {
    b.onclick = () => { state.cpCategoryFilter = b.dataset.cat; renderAll(); };
  });
}

function renderPMAPicker() {
  const box = document.getElementById('pma-picker');
  box.innerHTML = '';
  for (const pma of PMA_LIST) {
    const active = state.selectedPMAs.has(pma);
    const store = principalStore(pma);
    const cps = new Set();
    M.flows.filter(f => f.pma === pma).forEach(f =>
      Object.values(f.zones).forEach(z => z.cps.forEach(cp => cps.add(String(cp).trim().padStart(5,'0'))))
    );
    const flowCount = M.flows.filter(f => f.pma === pma).length;
    const chip = document.createElement('div');
    chip.className = 'pma-chip' + (active ? ' active' : '');
    chip.innerHTML = `
      <div class="pma-dot" style="background:${PMA_COLORS[pma]}"></div>
      <div class="pma-info">
        <div class="pma-name">${pma}</div>
        <div class="pma-meta">${store ? `Store ${store.code}` : ''} · ${cps.size} CP · ${flowCount} flux</div>
      </div>
      <div class="pma-check">
        <svg class="check-icon" viewBox="0 0 16 16" width="11" height="11" fill="none"
          stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 8 L7 12 L13 4"/>
        </svg>
      </div>`;
    chip.onclick = () => {
      if (active) { if (state.selectedPMAs.size > 1) state.selectedPMAs.delete(pma); }
      else state.selectedPMAs.add(pma);
      renderAll();
    };
    box.appendChild(chip);
  }
  document.getElementById('pma-count').textContent = state.selectedPMAs.size;
}

function renderFlowList() {
  const box = document.getElementById('flow-list');
  box.innerHTML = '';

  for (const pma of PMA_LIST) {
    const pmaFlows = M.flows.filter(f => f.pma === pma);
    if (!pmaFlows.length) continue;

    const group = document.createElement('div');
    group.className = 'flow-group';
    group.innerHTML = `<div class="flow-group-hdr">
      <div class="flow-group-dot" style="background:${PMA_COLORS[pma]}"></div>
      ${pma}
    </div>`;

    for (const flow of pmaFlows) {
      const enabled = state.enabledFlowIds.has(flow._id);
      const cpSet = new Set();
      Object.values(flow.zones).forEach(z =>
        z.cps.forEach(cp => cpSet.add(String(cp).trim().padStart(5,'0')))
      );
      const storeObj = M.stores[flow.storeCode];
      const storeLabel = storeObj ? `Store ${flow.storeCode}` : flow.storeCode;
      const shortName = flowShortName(flow);

      const row = document.createElement('div');
      row.className = 'flow-row' + (enabled ? '' : ' disabled');
      row.innerHTML = `
        <input type="checkbox" class="flow-cb" ${enabled ? 'checked' : ''}>
        <span class="flux-badge" style="background:${FLUX_COLORS[flow.flux]}">${flow.flux}</span>
        <div class="flow-info">
          <div class="flow-name">${shortName}</div>
          <div class="flow-store-tag">${storeLabel}</div>
        </div>
        <div class="flow-cp-count">${cpSet.size}</div>`;

      row.onclick = () => {
        if (enabled) state.enabledFlowIds.delete(flow._id);
        else state.enabledFlowIds.add(flow._id);
        const anyOn = M.flows.some(f => state.selectedPMAs.has(f.pma) && state.enabledFlowIds.has(f._id));
        if (!anyOn) state.enabledFlowIds.add(flow._id);
        renderAll();
      };
      group.appendChild(row);
    }
    box.appendChild(group);
  }
}

// ============================================================
// UI — Header summary
// ============================================================
function renderHeaderSummary(records) {
  const hdr = document.getElementById('hdr-summary');
  const unique = dedupe(records);
  if (!unique.length) {
    hdr.innerHTML = '<span style="color:var(--ink-3)">Aucune donnée — sélectionnez une PMA</span>';
    return;
  }
  const totalPop = unique.reduce((a,r) => a + r.population, 0);
  const catCount = { propre: 0, croise: 0, commun: 0 };
  unique.forEach(r => { catCount[r.category] = (catCount[r.category] || 0) + 1; });
  const badges = [...state.selectedPMAs].map(pma =>
    `<span class="hdr-pma-badge" style="border-color:${PMA_COLORS[pma]};color:${PMA_COLORS[pma]}">
      <span style="width:6px;height:6px;border-radius:50%;background:${PMA_COLORS[pma]};display:inline-block"></span>
      ${pma}
    </span>`).join('');

  hdr.innerHTML = `${badges}
    <span class="hdr-stat"><b>${unique.length}</b> CP</span>
    <span style="color:var(--ink-3)">·</span>
    <span class="hdr-stat"><b>${fmt(totalPop)}</b> hab.</span>
    <span style="color:var(--ink-3)">·</span>
    <span class="hdr-stat" title="CP exclusifs au PMA, livrés par son propre magasin" style="color:${CP_CATEGORY_COLORS.propre}"><b>${catCount.propre}</b> propres</span>
    <span style="color:var(--ink-3)">·</span>
    <span class="hdr-stat" title="CP d'une PMA livrés par un autre magasin" style="color:${CP_CATEGORY_COLORS.croise}"><b>${catCount.croise}</b> croisés</span>
    <span style="color:var(--ink-3)">·</span>
    <span class="hdr-stat" title="CP présents dans 2+ plans PMA" style="color:${CP_CATEGORY_COLORS.commun}"><b>${catCount.commun}</b> communs</span>`;
}

// ============================================================
// UI — Map overlay
// ============================================================
function renderOverlay(records) {
  const unique = dedupe(records);
  const badges = document.getElementById('overlay-badges');
  const line   = document.getElementById('overlay-line');

  if (!unique.length) {
    badges.innerHTML = '';
    line.innerHTML = 'Sélectionnez une ou plusieurs PMA';
    return;
  }
  badges.innerHTML = [...state.selectedPMAs].map(pma =>
    `<span class="overlay-badge" style="border-color:${PMA_COLORS[pma]};color:${PMA_COLORS[pma]}">
      <span class="overlay-dot" style="background:${PMA_COLORS[pma]}"></span>${pma}
    </span>`
  ).join('');

  const distAvg = unique.reduce((a,r)=>a+r.dist,0) / unique.length;
  const timeAvg = distAvg / state.speedKmh;
  const fluxSet = [...new Set(visibleFlows().map(f => f.flux))];

  line.innerHTML = `<b>${unique.length}</b> CP · <b>${fmt(unique.reduce((a,r)=>a+r.population,0))}</b> hab.
    · moy. <b>${Math.round(distAvg)} km</b> / <b>${fmtTime(timeAvg)}</b>
    · <b>${fluxSet.join(', ')}</b>`;
}

// ============================================================
// UI — Legend
// ============================================================
function renderLegend() {
  const legend = document.getElementById('legend');
  const items  = document.getElementById('legend-items');
  const title  = document.getElementById('legend-title');
  const u = state.unit;
  const lOff = state.leftOpen ? 'var(--pw)' : '0px';
  legend.style.left = `calc(${lOff} + 12px)`;

  if (u === 'ta-source') {
    const multi = state.selectedPMAs.size > 1;
    title.textContent = multi ? 'PMA × TA source' : 'TA source (plan)';
    if (multi) {
      const activePMAs = [...state.selectedPMAs];
      const taLevels = ['PRIO','TA0','TA1','TA2','TA3','TA4','TA5','TA6','TA7'];
      const visible = uniqueSourceTAs(buildRecords());
      const visibleTA = taLevels.filter(t => visible.includes(t));
      const colCount = visibleTA.length;
      const header = `<div style="display:grid;grid-template-columns:62px repeat(${colCount},1fr);gap:2px;margin-bottom:4px;font-size:8px;color:var(--ink-3);font-weight:600">
        <span></span>${visibleTA.map(t=>`<span style="text-align:center">${t}</span>`).join('')}
      </div>`;
      const rows = activePMAs.map(pma =>
        `<div style="display:grid;grid-template-columns:62px repeat(${colCount},1fr);gap:2px;align-items:center;margin-bottom:3px">
          <span style="font-size:9px;font-weight:700;color:${PMA_COLORS[pma]};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${pma}</span>
          ${visibleTA.map(t=>`<div style="height:12px;border-radius:2px;background:${pmaSourceTAColor(pma,t)}"></div>`).join('')}
        </div>`
      ).join('');
      items.innerHTML = header + rows;
    } else {
      const visible = uniqueSourceTAs(buildRecords());
      items.innerHTML = visible.map(t =>
        `<div class="legend-item"><div class="legend-sw" style="background:${sourceTAColor(t)}"></div><span>${t}</span></div>`
      ).join('') + `<div style="height:1px;background:var(--line);margin:6px 0"></div>
        <div class="legend-item"><div style="width:16px;height:10px;border-radius:3px;background:${CP_CATEGORY_COLORS.croise};opacity:.5;border:2px dashed ${CP_CATEGORY_COLORS.croise}"></div><span style="color:var(--ink-2)">Croisé (bord violet)</span></div>
        <div class="legend-item"><div style="width:16px;height:10px;border-radius:3px;background:${CP_CATEGORY_COLORS.commun};opacity:.5;border:2px solid ${CP_CATEGORY_COLORS.commun}"></div><span style="color:var(--ink-2)">Commun (bord ambre)</span></div>`;
    }
  } else if (u === 'category') {
    title.textContent = 'Affectation CP';
    items.innerHTML = `
      <div class="legend-item"><div class="legend-sw" style="background:${CP_CATEGORY_COLORS.propre}"></div><span>Propre — exclusif</span></div>
      <div class="legend-item" style="align-items:flex-start">
        <div style="width:16px;height:10px;border-radius:3px;background:${CP_CATEGORY_COLORS.croise};flex-shrink:0;margin-top:2px;border:2px dashed ${CP_CATEGORY_COLORS.croise}"></div>
        <span style="line-height:1.3">Croisé — autre magasin livre</span>
      </div>
      <div class="legend-item"><div class="legend-sw" style="background:${CP_CATEGORY_COLORS.commun}"></div><span>Commun — multi-PMA</span></div>`;
  } else if (u === 'cp' || u === 'zone') {
    const multi = state.selectedPMAs.size > 1;
    title.textContent = multi ? 'PMA × Zone temps' : 'Zone temps (calculée)';
    if (multi) {
      const zoneLabels = { '1': '≤45 min', '2': '45–60 min', '3': '60–110 min' };
      const activePMAs = [...state.selectedPMAs];
      const header = `<div style="display:grid;grid-template-columns:60px repeat(3,1fr);gap:3px;margin-bottom:4px;font-size:9px;color:var(--ink-3);font-weight:600">
        <span></span><span style="text-align:center">Z1</span><span style="text-align:center">Z2</span><span style="text-align:center">Z3</span>
      </div>`;
      const rows = activePMAs.map(pma => {
        const swatches = ['1','2','3'].map(z =>
          `<div style="width:100%;height:14px;border-radius:3px;background:${pmaZoneColor(pma,z)}"></div>`
        ).join('');
        return `<div style="display:grid;grid-template-columns:60px repeat(3,1fr);gap:3px;align-items:center;margin-bottom:3px">
          <span style="font-size:9px;font-weight:700;color:${PMA_COLORS[pma]};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${pma}</span>
          ${swatches}
        </div>`;
      }).join('');
      const zLabels = `<div style="display:grid;grid-template-columns:60px repeat(3,1fr);gap:3px;margin-top:2px;font-size:8px;color:var(--ink-3)">
        <span></span>
        ${['≤45 min','45–60 min','60–110 min'].map(l=>`<span style="text-align:center;line-height:1.2">${l}</span>`).join('')}
      </div>`;
      items.innerHTML = header + rows + zLabels;
    } else {
      items.innerHTML = `
        <div class="legend-item"><div class="legend-sw" style="background:${ZONE_COLORS['1']}"></div><span>Z1 · ≤ 45 min</span></div>
        <div class="legend-item"><div class="legend-sw" style="background:${ZONE_COLORS['2']}"></div><span>Z2 · 45–60 min</span></div>
        <div class="legend-item"><div class="legend-sw" style="background:${ZONE_COLORS['3']}"></div><span>Z3 · 60–110 min</span></div>
        <div style="height:1px;background:var(--line);margin:6px 0"></div>
        <div class="legend-item"><div class="legend-sw" style="background:#FFDB00;border:1px solid #ccc"></div><span style="color:var(--ink-2)">Doublon inter-PMAs</span></div>`;
    }
  } else if (u === 'population') {
    title.textContent = 'Population';
    items.innerHTML = gradLegend(['#C7E9F8','#0EA5E9','#0C4A6E'], ['Faible','Moyenne','Élevée']);
  } else if (u === 'distance') {
    title.textContent = 'Distance (km)';
    items.innerHTML = gradLegend(['#059669','#FFDB00','#DC2626'], ['Proche','Moyen','Loin']);
  } else if (u === 'time') {
    title.textContent = 'Temps trajet';
    items.innerHTML = gradLegend(['#059669','#FFDB00','#DC2626'], ['Rapide','Moyen','Long']);
  } else {
    // Default: single PMA = flat color; multi-PMA = PMA × zone grid
    const multi = state.selectedPMAs.size > 1;
    if (multi) {
      title.textContent = 'PMA × Zone temps';
      const activePMAs = [...state.selectedPMAs];
      const header = `<div style="display:grid;grid-template-columns:70px repeat(3,1fr);gap:3px;margin-bottom:4px;font-size:9px;color:var(--ink-3);font-weight:600">
        <span></span><span style="text-align:center">Z1 ≤45'</span><span style="text-align:center">Z2 ≤60'</span><span style="text-align:center">Z3 +60'</span>
      </div>`;
      const rows = activePMAs.map(pma => {
        const swatches = ['1','2','3'].map(z =>
          `<div style="width:100%;height:14px;border-radius:3px;background:${pmaZoneColor(pma,z)}"></div>`
        ).join('');
        return `<div style="display:grid;grid-template-columns:70px repeat(3,1fr);gap:3px;align-items:center;margin-bottom:3px">
          <span style="font-size:9px;font-weight:700;color:${PMA_COLORS[pma]};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${pma}</span>
          ${swatches}
        </div>`;
      }).join('');
      items.innerHTML = header + rows;
    } else {
      title.textContent = 'PMA';
      items.innerHTML = [...state.selectedPMAs].map(pma =>
        `<div class="legend-item"><div class="legend-sw" style="background:${PMA_COLORS[pma]}"></div><span>${pma}</span></div>`
      ).join('');
    }
  }
}

function gradLegend(colors, labels) {
  return colors.map((c,i) =>
    `<div class="legend-item"><div class="legend-sw" style="background:${c}"></div><span>${labels[i]}</span></div>`
  ).join('');
}

// ============================================================
// UI — Right panel stats
// ============================================================
function renderRightPanel(records) {
  const unique = dedupe(records);
  const totalPop = unique.reduce((a,r)=>a+r.population,0);
  const distAvg  = unique.length ? unique.reduce((a,r)=>a+r.dist,0)/unique.length : 0;
  const distMax2 = unique.reduce((a,r)=>Math.max(a,r.dist),0);
  const timeAvg  = distAvg / state.speedKmh;
  const catCount2 = { propre: 0, croise: 0, commun: 0 };
  unique.forEach(r => { catCount2[r.category] = (catCount2[r.category] || 0) + 1; });

  document.getElementById('stat-grid').innerHTML = `
    <div class="stat-card"><div class="stat-num">${unique.length}</div><div class="stat-label">Codes postaux</div></div>
    <div class="stat-card"><div class="stat-num">${fmt(totalPop)}</div><div class="stat-label">Population</div></div>
    <div class="stat-card"><div class="stat-num">${Math.round(distAvg)}<small>km</small></div><div class="stat-label">Dist. moyenne</div></div>
    <div class="stat-card"><div class="stat-num">${fmtTime(timeAvg)}</div><div class="stat-label">Temps moyen</div></div>
    <div class="stat-card"><div class="stat-num" style="color:${CP_CATEGORY_COLORS.croise}">${catCount2.croise}</div><div class="stat-label">CP croisés</div></div>
    <div class="stat-card"><div class="stat-num" style="color:${CP_CATEGORY_COLORS.commun}">${catCount2.commun}</div><div class="stat-label">CP communs</div></div>`;

  // Source-TA bars (from the actual transport plan)
  const tas = uniqueSourceTAs(unique);
  const taSrcCount = {};
  unique.forEach(r => { taSrcCount[r.sourceTA] = (taSrcCount[r.sourceTA]||0) + 1; });
  const tot = unique.length || 1;
  document.getElementById('bar-chart').innerHTML = tas.map(t => {
    const pct = (taSrcCount[t]/tot)*100;
    return `<div class="bar-row">
      <div class="bar-lbl">${t}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${sourceTAColor(t)}"></div></div>
      <div class="bar-val">${taSrcCount[t]} <span style="color:var(--ink-3);font-weight:400">${pct.toFixed(0)}%</span></div>
    </div>`;
  }).join('') || `<div style="font-size:10px;color:var(--ink-3)">Aucune donnée</div>`;

  // Time-zone bars (computed from haversine + speed) — secondary
  const tzCount = {'1':0,'2':0,'3':0,'4':0};
  unique.forEach(r => { if (r.timeZone) tzCount[r.timeZone]++; });
  const tzHTML = ['1','2','3','4'].map(z => {
    if (!tzCount[z]) return '';
    const pct = (tzCount[z]/tot)*100;
    const lbl = z==='1'?'Z1 ≤45min':z==='2'?'Z2 45–60':z==='3'?'Z3 60–110':'Z4 >110';
    return `<div class="bar-row">
      <div class="bar-lbl">${lbl}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${ZONE_COLORS[z]||'#888'}"></div></div>
      <div class="bar-val">${tzCount[z]} <span style="color:var(--ink-3);font-weight:400">${pct.toFixed(0)}%</span></div>
    </div>`;
  }).join('');
  document.getElementById('bar-chart').insertAdjacentHTML('beforeend',
    `<div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)">
       <div style="font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin-bottom:7px">Zone temps (calculée)</div>
       ${tzHTML || '<div style="font-size:10px;color:var(--ink-3)">—</div>'}
     </div>`);

  // Flux bars — per individual flow
  const fluxMap = {};
  for (const r of records) {
    const key = r.flow._id;
    if (!fluxMap[key]) fluxMap[key] = { flux: r.flow.flux, store: r.flow.storeCode, name: flowShortName(r.flow), count: 0 };
    fluxMap[key].count++;
  }
  const fluxTot = records.length || 1;
  document.getElementById('flux-chart').innerHTML = Object.values(fluxMap)
    .sort((a,b)=>b.count-a.count)
    .map(f => {
      const pct = (f.count/fluxTot)*100;
      return `<div class="bar-row">
        <div class="bar-lbl" title="${f.name}">${f.flux}·${f.store}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${FLUX_COLORS[f.flux]}"></div></div>
        <div class="bar-val">${f.count} <span style="color:var(--ink-3);font-weight:400">${pct.toFixed(0)}%</span></div>
      </div>`;
    }).join('');

  renderInsights(records, unique);
}

// ============================================================
// Insights
// ============================================================
function renderInsights(records, unique) {
  const ins = document.getElementById('insights');
  ins.innerHTML = '';

  // Toolbar: export + clear highlight
  ins.innerHTML += `<div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:8px;flex-wrap:wrap">
    ${state.highlightCPs.size > 0 ? `<button onclick="clearHighlight()" style="display:inline-flex;align-items:center;gap:5px;padding:7px 12px;border-radius:8px;font-size:11px;font-weight:700;border:1.5px solid #F97316;background:#FFF7ED;color:#C2410C;cursor:pointer;font-family:inherit">
      ✕ Effacer surbrillance (${state.highlightCPs.size} CP)
    </button>` : ''}
    <button onclick="exportOptimisationXLSX()" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;font-size:11px;font-weight:700;border:1.5px solid #0A8754;background:white;color:#0A8754;cursor:pointer;font-family:inherit;box-shadow:0 1px 4px #0001">
      📥 Exporter toutes les pistes (Excel)
    </button>
  </div>`;

  // 1. Inter-PMA cooperation matrix (from ALL flowsByCP, not filtered)
  const coopMap = {};
  for (const [cp, flows] of Object.entries(flowsByCP)) {
    const pmasPlan = new Set(flows.map(f => f.flow.pma));
    if (pmasPlan.size === 1) {
      const planPMA = [...pmasPlan][0];
      for (const f of flows) {
        const storePMA = M.stores[f.flow.storeCode]?.pma;
        if (storePMA && storePMA !== planPMA) {
          const key = `${storePMA}→${planPMA}`;
          if (!coopMap[key]) coopMap[key] = { from: storePMA, to: planPMA, cps: new Set(), fluxTypes: new Set() };
          coopMap[key].cps.add(cp);
          coopMap[key].fluxTypes.add(f.flow.flux);
        }
      }
    }
  }
  const communN = unique.filter(r => r.category === 'commun').length;
  const croiseN = unique.filter(r => r.category === 'croise').length;
  const coopEntries = Object.values(coopMap);
  if (coopEntries.length) {
    const rows = coopEntries.map(e =>
      `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;background:var(--bg);margin-bottom:4px;font-size:10px;font-weight:600">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${PMA_COLORS[e.from]||'#888'};flex-shrink:0"></span>
        <b>${e.from}</b>
        <span style="color:var(--ink-3)">aide</span>
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${PMA_COLORS[e.to]||'#888'};flex-shrink:0"></span>
        <b>${e.to}</b>
        <span style="color:var(--ink-3);margin-left:auto">${e.cps.size} CP · ${[...e.fluxTypes].join(', ')}</span>
      </div>`
    ).join('');
    ins.innerHTML += `<div class="insight-card" style="border-color:${CP_CATEGORY_COLORS.croise}22">
      <div class="insight-title"><div class="insight-icon" style="background:#EDE9FE">🤝</div>Coopération inter-PMA</div>
      ${rows}
      <div style="margin-top:7px;font-size:10px;color:var(--ink-3)">
        Vue filtrée : <b style="color:${CP_CATEGORY_COLORS.croise}">${croiseN} CP croisés</b> · <b style="color:${CP_CATEGORY_COLORS.commun}">${communN} CP communs</b>.
      </div>
    </div>`;
  }

  // 1b. Common CPs details — intentional inter-PMA support, shown as informational
  if (communN > 0) {
    const communSample = unique.filter(r => r.category === 'commun').slice(0, 5).map(r => {
      const pmas = [...new Set((flowsByCP[r.cp]||[]).map(x => x.flow.pma))];
      return `<code style="background:white;padding:1px 5px;border-radius:3px;border:1px solid var(--line);font-family:monospace;font-size:10px">${r.cp}</code> ${pmas.map(p=>`<span style="color:${PMA_COLORS[p]};font-weight:700">${p}</span>`).join(' + ')}`;
    }).join('<br>');
    const communCPsList = unique.filter(r => r.category === 'commun').map(r => r.cp);
    ins.innerHTML += `<div class="insight-card" style="border-color:${CP_CATEGORY_COLORS.commun}44">
      <div class="insight-title">
        <div class="insight-icon" style="background:#FEF9C3">🔗</div>${communN} CP en support inter-PMA (commun)
        <button onclick="${_hlBtn('commun', communCPsList, 'Support inter-PMA')}" style="margin-left:auto;padding:3px 9px;border-radius:6px;font-size:9px;font-weight:700;border:1.5px solid #F97316;background:white;color:#F97316;cursor:pointer;font-family:inherit;white-space:nowrap">🗺️ Voir sur carte</button>
      </div>
      ${communSample}${communN > 5 ? `<br><span style="color:var(--ink-3)">…et ${communN-5} autres</span>` : ''}
      <div style="margin-top:7px;font-size:10px;color:var(--ink-3)">Ces CPs sont <b>intentionnellement partagés</b> entre PMAs pour assurer le support mutuel entre unités.</div>
    </div>`;
  }

  // 2. Distance-suboptimal CPs — only for propre CPs (skip croisé/commun which are intentional)
  const stores = Object.values(M.stores);
  const misrouted = [];
  for (const r of unique) {
    if (r.category === 'croise' || r.category === 'commun') continue; // intentional cross-PMA, skip
    let best = r.store, bestD = r.dist;
    for (const s of stores) {
      if (s.code === r.store.code) continue;
      const d = haversine(s.lat, s.lng, r.lat, r.lng);
      if (d < bestD - 10) { bestD = d; best = s; }
    }
    if (best.code !== r.store.code) misrouted.push({ ...r, bestStore: best, gain: r.dist - bestD });
  }
  misrouted.sort((a,b) => b.gain - a.gain);
  if (misrouted.length) {
    const totalGain = misrouted.reduce((a,m) => a + m.gain, 0);
    const top = misrouted.slice(0,4).map(m =>
      `<code style="font-family:monospace;font-size:10px">${m.cp}</code> <span style="color:var(--ink-3)">${m.store.pma}</span> → <b>${m.bestStore.pma}</b> · +${Math.round(m.gain)} km gagné`
    ).join('<br>');
    const misroutedCPsList = misrouted.map(m => m.cp);
    ins.innerHTML += `<div class="insight-card">
      <div class="insight-title">
        <div class="insight-icon" style="background:#FEE2E2">🔀</div>${misrouted.length} CP propres plus proches d'un autre magasin
        <button onclick="${_hlBtn('misrouted', misroutedCPsList, 'Réaffectation distance')}" style="margin-left:auto;padding:3px 9px;border-radius:6px;font-size:9px;font-weight:700;border:1.5px solid #F97316;background:white;color:#F97316;cursor:pointer;font-family:inherit;white-space:nowrap">🗺️ Voir sur carte</button>
      </div>
      ${top}${misrouted.length>4?`<br><span style="color:var(--ink-3)">…et ${misrouted.length-4} autres</span>`:''}
      <div style="margin-top:7px;font-size:10px;color:var(--ink-3)">Gain potentiel : <b>${Math.round(totalGain)} km</b> / tournée. (CPs croisés/communs exclus — support inter-PMA intentionnel.)</div>
    </div>`;
  }

  // 3. Cross-PMA LCDI
  const crossLCDI = records.filter(r => {
    const sp = M.stores[r.flow.storeCode]?.pma;
    return r.flow.flux === 'LCDI' && sp !== r.flow.pma;
  });
  if (crossLCDI.length) {
    const grouped = {};
    for (const r of crossLCDI) {
      const k = `Store ${r.flow.storeCode} → PMA ${r.flow.pma}`;
      grouped[k] = (grouped[k]||0) + 1;
    }
    const lcdiCPsList = [...new Set(crossLCDI.map(r => r.cp))];
    ins.innerHTML += `<div class="insight-card">
      <div class="insight-title">
        <div class="insight-icon" style="background:#EDE9FE">🔗</div>Flux LCDI inter-PMA
        <button onclick="${_hlBtn('lcdi', lcdiCPsList, 'LCDI inter-PMA')}" style="margin-left:auto;padding:3px 9px;border-radius:6px;font-size:9px;font-weight:700;border:1.5px solid #F97316;background:white;color:#F97316;cursor:pointer;font-family:inherit;white-space:nowrap">🗺️ Voir sur carte</button>
      </div>
      ${Object.entries(grouped).map(([k,v]) => `<code style="font-family:monospace;font-size:10px">${k}</code> · ${v} CP`).join('<br>')}
      <div style="margin-top:7px;font-size:10px;color:var(--ink-3)">Vérifier pertinence vs réaffectation directe.</div>
    </div>`;
  }

  // 4. TA imbalance
  const taC = {};
  unique.forEach(r => { if (r.timeZone) taC[r.timeZone] = (taC[r.timeZone]||0)+1; });
  if (taC['3'] && taC['1'] && taC['3'] > taC['1'] * 1.5) {
    ins.innerHTML += `<div class="insight-card">
      <div class="insight-title"><div class="insight-icon" style="background:#FEF3C7">📊</div>Déséquilibre TA</div>
      TA3 (60–110 min) = <b>${taC['3']}</b> CP vs TA1 (≤45 min) = <b>${taC['1']||0}</b> CP.
      <div style="margin-top:7px;font-size:10px;color:var(--ink-3)">Revoir les fréquences ou le périmètre TA3.</div>
    </div>`;
  }

  // 5. Distance-optimal re-routing (includes support stores)
  if (Object.keys(distMatrix).length > 0) {
    const allS = allStoresForOptim();
    const optGroups = {};
    for (const r of unique) {
      const dists = distMatrix[r.cp];
      if (!dists) continue;
      let bestCode = r.store.code, bestD = r.dist;
      for (const [code, d] of Object.entries(dists)) {
        if (d < bestD - 10) { bestD = d; bestCode = code; }
      }
      if (bestCode === r.store.code) continue;
      const toStore = allS[bestCode];
      const key = `${r.store.pma}→${toStore.name || bestCode}`;
      if (!optGroups[key]) optGroups[key] = { fromPMA: r.store.pma, toStore, toCode: bestCode, cps: [], pop: 0, gain: 0 };
      optGroups[key].cps.push(r.cp);
      optGroups[key].pop += r.population;
      optGroups[key].gain += (r.dist - bestD);
    }
    const optEntries = Object.values(optGroups).sort((a,b) => b.pop - a.pop);
    if (optEntries.length) {
      const totGain = optEntries.reduce((a,e) => a + e.gain, 0);
      const totPop  = optEntries.reduce((a,e) => a + e.pop, 0);
      const rows = optEntries.map(e => {
        const fromColor = PMA_COLORS[e.fromPMA] || '#888';
        const toColor = PMA_COLORS[M.stores[e.toCode]?.pma] || '#6B7280';
        return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;background:var(--bg);margin-bottom:4px;font-size:10px;font-weight:600">
          <span style="width:8px;height:8px;border-radius:50%;background:${fromColor};flex-shrink:0"></span>
          <span style="color:${fromColor}">${e.fromPMA}</span>
          <span style="color:var(--ink-3)">→</span>
          <span style="width:8px;height:8px;border-radius:50%;background:${toColor};flex-shrink:0"></span>
          <span style="color:${toColor}">${(e.toStore.name||e.toCode).replace('IKEA ','')}</span>
          <span style="color:var(--ink-3);margin-left:auto;font-weight:500">${e.cps.length} CP · ${fmt(e.pop)} hab.</span>
        </div>`;
      }).join('');
      const allOptCPs = optEntries.flatMap(e => e.cpList.map(r => r.cp));
      ins.innerHTML += `<div class="insight-card" style="border-color:#8B5CF644">
        <div class="insight-title">
          <div class="insight-icon" style="background:#EDE9FE">🎯</div>Optimisation distance (avec magasins support)
          <button onclick="${_hlBtn('optdist', allOptCPs, 'Optimisation distance')}" style="margin-left:auto;padding:3px 9px;border-radius:6px;font-size:9px;font-weight:700;border:1.5px solid #F97316;background:white;color:#F97316;cursor:pointer;font-family:inherit;white-space:nowrap">🗺️ Voir sur carte</button>
        </div>
        <div style="margin-bottom:8px;font-size:10px;color:var(--ink-3)">Gain potentiel : <b style="color:var(--ink)">${Math.round(totGain)} km</b> · <b style="color:var(--ink)">${fmt(totPop)} hab.</b> mieux desservis</div>
        ${rows}
        <div style="margin-top:9px">
          <button onclick="toggleOptimalOverlay()" style="padding:5px 12px;border-radius:6px;font-size:10px;font-weight:700;border:1.5px solid #8B5CF6;background:${state.showOptimalOverlay?'#8B5CF6':'white'};color:${state.showOptimalOverlay?'white':'#8B5CF6'};cursor:pointer;font-family:inherit">
            ${state.showOptimalOverlay ? '✓ Plan optimal actif' : '👁 Voir plan optimal'}
          </button>
        </div>
      </div>`;
    }
  }

  // 6. Department-level cluster analysis (groups CPs by dept prefix, finds best alternative)
  if (Object.keys(distMatrix).length > 0) {
    const allS = allStoresForOptim();
    const deptMap = {};
    for (const r of unique) {
      const dept = r.cp.slice(0, 2);
      if (!deptMap[dept]) deptMap[dept] = { dept, recs: [], pop: 0, pma: r.flow.pma };
      deptMap[dept].recs.push(r);
      deptMap[dept].pop += r.population;
    }
    const clusters = Object.values(deptMap)
      .filter(d => d.pop > 50000 || d.recs.length >= 5)
      .map(d => {
        const avgDists = {};
        for (const [code] of Object.entries(allS)) {
          avgDists[code] = d.recs.reduce((a, r) => a + (distMatrix[r.cp]?.[code] || 0), 0) / d.recs.length;
        }
        const currentStore = Object.values(M.stores).find(s => s.pma === d.pma);
        const currentDist = currentStore ? avgDists[currentStore.code] : Infinity;
        let bestAlt = null, bestAltDist = currentDist;
        for (const [code, avg] of Object.entries(avgDists)) {
          if (M.stores[code]?.pma === d.pma) continue;
          if (avg < bestAltDist - 8) { bestAltDist = avg; bestAlt = allS[code]; }
        }
        return { ...d, currentDist, bestAlt, gain: currentDist - bestAltDist };
      })
      .filter(d => d.gain > 8)
      .sort((a,b) => b.pop - a.pop)
      .slice(0, 6);

    if (clusters.length) {
      const rows = clusters.map(d => {
        const fromColor = PMA_COLORS[d.pma] || '#888';
        const toColor = d.bestAlt ? (PMA_COLORS[M.stores[d.bestAlt.code]?.pma] || '#6B7280') : '#6B7280';
        return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;background:var(--bg);margin-bottom:4px;font-size:10px;font-weight:600">
          <span style="font-family:monospace;font-size:11px">Dép.<b>${d.dept}</b></span>
          <span style="color:${fromColor}">${d.pma}</span>
          ${d.bestAlt ? `<span style="color:var(--ink-3)">→</span><span style="color:${toColor}">${(d.bestAlt.name||d.bestAlt.code).replace('IKEA ','')}</span>` : ''}
          <span style="color:var(--ink-3);margin-left:auto;font-weight:500">${fmt(d.pop)} hab. · −${Math.round(d.gain)} km</span>
        </div>`;
      }).join('');
      const clusterCPsList = clusters.flatMap(d => d.recs.map(r => r.cp));
      ins.innerHTML += `<div class="insight-card" style="border-color:#06B6D444">
        <div class="insight-title">
          <div class="insight-icon" style="background:#E0F2FE">🗺️</div>Clusters départementaux à optimiser
          <button onclick="${_hlBtn('clusters', clusterCPsList, 'Clusters dép.')}" style="margin-left:auto;padding:3px 9px;border-radius:6px;font-size:9px;font-weight:700;border:1.5px solid #F97316;background:white;color:#F97316;cursor:pointer;font-family:inherit;white-space:nowrap">🗺️ Voir sur carte</button>
        </div>
        ${rows}
        <div style="margin-top:7px;font-size:10px;color:var(--ink-3)">Départements où un autre magasin est en moyenne plus proche. Activez le scénario pour simuler.</div>
      </div>`;
    }
  }

  // 7. CP Dynamism — analyst-only, visible only when URL contains ?analyst=1
  if (ANALYST_MODE) {
    const onlyCCD = [];
    const onlyLCDD = [];
    const dynamicCount = { total: 0 };
    const seenCPs = new Set();
    for (const r of unique) {
      if (seenCPs.has(r.cp)) continue;
      seenCPs.add(r.cp);
      const flows = flowsByCP[r.cp] || [];
      const fluxTypes = new Set(flows.map(f => f.flow.flux));
      const hasCCD = fluxTypes.has('CCD');
      const hasLCDD = fluxTypes.has('LCDD');
      if (hasCCD && hasLCDD) {
        dynamicCount.total++;
      } else if (hasCCD && !hasLCDD) {
        onlyCCD.push(r);
      } else if (hasLCDD && !hasCCD) {
        onlyLCDD.push(r);
      }
    }
    const nonDynamic = onlyCCD.length + onlyLCDD.length;
    const total = dynamicCount.total + nonDynamic;
    if (total > 0) {
      const pctDyn = total > 0 ? Math.round(dynamicCount.total / total * 100) : 0;
      const colorDyn = pctDyn >= 80 ? '#0A8754' : pctDyn >= 50 ? '#F59E0B' : '#E04E2C';
      // Group non-dynamic by PMA
      const byPMA = {};
      for (const r of [...onlyCCD, ...onlyLCDD]) {
        const pma = r.flow?.pma || 'Inconnu';
        if (!byPMA[pma]) byPMA[pma] = { ccd: [], lcdd: [] };
        const flows = flowsByCP[r.cp] || [];
        const fluxTypes = new Set(flows.map(f => f.flow.flux));
        if (fluxTypes.has('CCD') && !fluxTypes.has('LCDD')) byPMA[pma].ccd.push(r.cp);
        else if (!fluxTypes.has('CCD') && fluxTypes.has('LCDD')) byPMA[pma].lcdd.push(r.cp);
      }
      const pmaRows = Object.entries(byPMA).map(([pma, d]) => {
        const col = PMA_COLORS[pma] || '#888';
        const parts = [];
        if (d.ccd.length) parts.push(`<span style="color:#E04E2C;font-weight:700">${d.ccd.length} sans LCDD</span>`);
        if (d.lcdd.length) parts.push(`<span style="color:#0058A3;font-weight:700">${d.lcdd.length} sans CCD</span>`);
        const uid = `dyn-${pma.replace(/\s/g,'')}`;
        const allCPs = [
          ...d.ccd.map(cp => ({ cp, missing: 'LCDD', color: '#E04E2C' })),
          ...d.lcdd.map(cp => ({ cp, missing: 'CCD',  color: '#0058A3' })),
        ];
        const fullList = allCPs.map(({ cp, missing, color }) =>
          `<span style="display:inline-flex;align-items:center;gap:3px;margin:2px">
            <code style="font-family:monospace;font-size:10px;background:white;padding:1px 4px;border-radius:3px;border:1px solid var(--line)">${cp}</code>
            <span style="font-size:9px;color:${color};font-weight:700">−${missing}</span>
          </span>`
        ).join('');
        return `<div style="padding:5px 8px;border-radius:7px;background:var(--bg);margin-bottom:4px;font-size:10px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:4px"></span>
              <b style="color:${col}">${pma}</b> : ${parts.join(' · ')}
            </div>
            <button onclick="(function(el){el.style.display=el.style.display==='none'?'block':'none'})(document.getElementById('${uid}'))"
              style="font-size:9px;padding:2px 8px;border-radius:5px;border:1px solid var(--line);background:white;cursor:pointer;font-family:inherit;color:var(--ink-2);white-space:nowrap">
              Voir tous (${allCPs.length})
            </button>
          </div>
          <div id="${uid}" style="display:none;margin-top:6px;max-height:180px;overflow-y:auto;line-height:1.8">${fullList}</div>
        </div>`;
      }).join('');
      ins.innerHTML += `<div class="insight-card" style="border-color:${colorDyn}44">
        <div class="insight-title"><div class="insight-icon" style="background:#F0FDF4">⚡</div>Dynamisme des CPs — CCD + LCDD</div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <div style="text-align:center">
            <div style="font-size:22px;font-weight:800;color:${colorDyn}">${pctDyn}%</div>
            <div style="font-size:10px;color:var(--ink-3)">CPs dynamiques</div>
          </div>
          <div style="font-size:10px;color:var(--ink-3);flex:1">
            <b style="color:var(--ink)">${dynamicCount.total}</b> CP ont CCD + LCDD (dynamiques)<br>
            <b style="color:#E04E2C">${onlyCCD.length}</b> CP ont uniquement CCD (manque LCDD)<br>
            <b style="color:#0058A3">${onlyLCDD.length}</b> CP ont uniquement LCDD (manque CCD)
          </div>
        </div>
        ${nonDynamic > 0 ? pmaRows : '<div style="font-size:10px;color:#0A8754;font-weight:600">✓ Tous les CPs sont dynamiques !</div>'}
        ${nonDynamic > 0 ? `
        <div style="margin-top:9px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
          <span style="font-size:10px;color:var(--ink-3)">Objectif : chaque CP doit avoir <b>un flux CCD et un flux LCDD</b>.</span>
          <button onclick="exportOptimisationXLSX()" style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:7px;font-size:10px;font-weight:700;border:1.5px solid #0A8754;background:white;color:#0A8754;cursor:pointer;font-family:inherit;white-space:nowrap">
            📥 Export complet Excel
          </button>
        </div>` : ''}
      </div>`;
    }
  }

  if (!ins.innerHTML) ins.innerHTML = `<div class="insight-card" style="color:var(--ink-3);text-align:center;padding:16px">
    ✓ Aucune anomalie détectée.
  </div>`;
}

// ============================================================
// Scenario panel
// ============================================================
function renderScenarioPanel() {
  const box = document.getElementById('scenario-panel');
  if (!box) return;
  const assignments = state.scenario.assignments;
  const assignedCPs = Object.keys(assignments);
  const allS = allStoresForOptim();

  // Compute KPIs
  let assignedPop = 0, gainKm = 0;
  for (const cp of assignedCPs) {
    const d = cpData[cp]; if (!d) continue;
    assignedPop += d.population || 0;
    const toCode = assignments[cp];
    const fromFlows = flowsByCP[cp] || [];
    if (fromFlows.length && distMatrix[cp]) {
      const fromCode = fromFlows[0].flow.storeCode;
      gainKm += (distMatrix[cp][fromCode] || 0) - (distMatrix[cp][toCode] || 0);
    }
  }

  const QUICK = [
    { label: '562 support 431 · Z1+Z2', emoji: '🔵→🔴', desc: 'Lyon prend Z1+Z2 de Saint-Étienne', fn: 'quickLoadLyonSupport431' },
    { label: '562 direct · Chambéry+Voiron', emoji: '🔵→🟢', desc: 'Lyon prend 73xxx de Grenoble', fn: 'quickLoadLyonChamberysVoiron' },
    { label: 'Avignon · Valence (26xxx)', emoji: '🟡→🟢', desc: 'Avignon prend dép.26 de Grenoble', fn: 'quickLoadAvignonValence' },
    { label: 'Dijon · Bourg+Mâcon (01xxx)', emoji: '🟡→🔵', desc: 'Dijon prend dép.01 de Lyon', fn: 'quickLoadDijonBourg' },
    { label: '345 Clermont · Roanne', emoji: '🟣→🔴', desc: 'Clermont prend Roanne de Saint-Étienne', fn: 'quickLoadClermontRoanne' },
    { label: '345 Clermont · Annecy LCDI', emoji: '🟣→🟢', desc: 'Clermont prend 73/74 de Grenoble', fn: 'quickLoadClermontAnnecy' },
  ];

  const assignedList = assignedCPs.slice(0, 8).map(cp => {
    const toStore = allS[assignments[cp]];
    const toColor = PMA_COLORS[M.stores[assignments[cp]]?.pma] || '#6B7280';
    const fromFlows = flowsByCP[cp] || [];
    const fromPMA = fromFlows[0]?.flow?.pma || '?';
    const fromColor = PMA_COLORS[fromPMA] || '#888';
    return `<div style="display:flex;align-items:center;gap:5px;padding:4px 8px;border-radius:6px;background:var(--bg);margin-bottom:3px;font-size:10px">
      <code style="font-family:monospace;font-weight:700;font-size:11px">${cp}</code>
      <span style="color:${fromColor};font-size:9px">${fromPMA}</span>
      <span style="color:var(--ink-3)">→</span>
      <span style="color:${toColor};font-weight:700">${(toStore?.name||assignments[cp]).replace('IKEA ','')}</span>
      <button onclick="unassignCP('${cp}')" style="margin-left:auto;padding:1px 5px;border-radius:4px;border:1px solid #DC2626;color:#DC2626;background:white;cursor:pointer;font-size:9px;font-family:inherit">✕</button>
    </div>`;
  }).join('');

  // Compute before/after KPIs
  const allRecords = buildRecords();
  const uniqueAll  = dedupe(allRecords);
  let basePop = 0, baseDist = 0;
  for (const r of uniqueAll) { basePop += r.population; baseDist += r.dist; }
  const baseDistAvg = uniqueAll.length ? baseDist / uniqueAll.length : 0;

  const hasShared = Object.keys(state.scenario.assignments).length > 0;

  box.innerHTML = `
    <div style="background:${state.scenario.active?'#F3E8FF':'var(--bg)'};border:1.5px solid ${state.scenario.active?'#8B5CF6':'var(--line)'};border-radius:10px;padding:10px 12px;margin-bottom:10px;transition:all .2s">
      <label class="toggle-row" for="toggle-scenario" style="margin-bottom:${state.scenario.active?'6':'0'}px;cursor:pointer">
        <input type="checkbox" id="toggle-scenario" ${state.scenario.active ? 'checked' : ''} onchange="toggleScenario()">
        <span class="toggle-text">
          <b style="color:${state.scenario.active?'#6D28D9':'var(--ink)'}">🎯 Mode simulation ${state.scenario.active ? 'ACTIF' : 'inactif'}</b>
        </span>
      </label>
      ${state.scenario.active
        ? `<div style="font-size:10px;color:#6D28D9">Cliquez un CP sur la carte pour le réaffecter à une autre BU. Les CPs en violet sont réaffectés.</div>`
        : `<div style="font-size:10px;color:var(--ink-3)">Activez pour tester des réaffectations de CPs entre BUs et mesurer l'impact en km.</div>`}
    </div>

    ${state.scenario.active ? `
    <div class="sec-label" style="margin-bottom:7px">Chargement rapide — slides PMA</div>
    <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px">
      ${QUICK.map(q => `<button onclick="${q.fn}()"
        style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;border:1.5px solid var(--line);background:var(--bg);cursor:pointer;font-family:inherit;text-align:left;width:100%;transition:all .15s"
        onmouseover="this.style.background='white';this.style.borderColor='#8B5CF6'"
        onmouseout="this.style.background='';this.style.borderColor=''">
        <span style="font-size:14px">${q.emoji}</span>
        <div><div style="font-size:11px;font-weight:700;color:var(--ink)">${q.label}</div>
        <div style="font-size:10px;color:var(--ink-3)">${q.desc}</div></div>
      </button>`).join('')}
    </div>

    <div class="sec-label" style="margin-bottom:7px">Comparaison avant / après</div>
    <div style="border:1.5px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:12px;font-size:10px">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;background:var(--bg);font-weight:700;font-size:9px;text-align:center;color:var(--ink-3);padding:5px 0;border-bottom:1px solid var(--line)">
        <span>Plan actuel</span><span>Scénario</span><span>Δ</span>
      </div>
      <div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;align-items:center;padding:5px 8px;border-bottom:1px solid var(--line)">
        <span style="font-size:9px;color:var(--ink-3);grid-column:1">CP réaffectés</span>
        <span style="text-align:center;font-weight:700">—</span>
        <span style="text-align:center;font-weight:700;color:#8B5CF6">${assignedCPs.length}</span>
        <span style="text-align:center;font-weight:700;color:#8B5CF6">${assignedCPs.length > 0 ? '+'+assignedCPs.length : '—'}</span>
      </div>
      <div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;align-items:center;padding:5px 8px;border-bottom:1px solid var(--line)">
        <span style="font-size:9px;color:var(--ink-3)">Population</span>
        <span style="text-align:center;font-weight:700">${Math.round(basePop/1000)}k</span>
        <span style="text-align:center;font-weight:700;color:#8B5CF6">${Math.round((basePop)/1000)}k</span>
        <span style="text-align:center;font-weight:700;color:var(--ink-3)">—</span>
      </div>
      <div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;align-items:center;padding:5px 8px;border-bottom:1px solid var(--line)">
        <span style="font-size:9px;color:var(--ink-3)">Dist. moy.</span>
        <span style="text-align:center;font-weight:700">${Math.round(baseDistAvg)} km</span>
        <span style="text-align:center;font-weight:700;color:#8B5CF6">${Math.round(baseDistAvg - (gainKm / Math.max(assignedCPs.length,1)))} km</span>
        <span style="text-align:center;font-weight:700;color:${gainKm>=0?'#0A8754':'#DC2626'}">${gainKm>=0?'−':'+'}${Math.abs(Math.round(gainKm / Math.max(assignedCPs.length,1)))} km/CP</span>
      </div>
      <div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;align-items:center;padding:5px 8px">
        <span style="font-size:9px;color:var(--ink-3)">Gain total</span>
        <span style="text-align:center;font-weight:700">0 km</span>
        <span style="text-align:center;font-weight:700;color:${gainKm>=0?'#0A8754':'#DC2626'}">${gainKm>=0?'+':''}${Math.round(gainKm)} km</span>
        <span style="text-align:center;font-weight:700;color:${gainKm>=0?'#0A8754':'#DC2626'}">${gainKm>=0?'▲':'▼'} ${Math.abs(Math.round(gainKm))} km</span>
      </div>
    </div>

    ${assignedCPs.length > 0 ? `
      <div class="sec-label" style="margin-bottom:7px">Réaffectations (${assignedCPs.length})</div>
      ${assignedList}
      ${assignedCPs.length > 8 ? `<div style="font-size:10px;color:var(--ink-3);margin-top:3px">…et ${assignedCPs.length-8} autres</div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
        <button id="btn-share-scenario" onclick="shareScenario()" style="flex:1;min-width:100px;padding:7px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid #8B5CF6;color:#8B5CF6;background:white;cursor:pointer;font-family:inherit">🔗 Copier le lien</button>
        <button onclick="exportScenario()" style="flex:1;min-width:100px;padding:7px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid var(--blue);color:var(--blue);background:white;cursor:pointer;font-family:inherit">📥 JSON</button>
        <button onclick="undoScenario()" ${state.scenario.history.length===0?'disabled':''} style="padding:7px 10px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid var(--ink-3);color:${state.scenario.history.length?'var(--ink)':'var(--ink-3)'};background:white;cursor:${state.scenario.history.length?'pointer':'default'};font-family:inherit;opacity:${state.scenario.history.length?1:0.45}">↩</button>
        <button onclick="resetScenario()" style="padding:7px 10px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid var(--danger);color:var(--danger);background:white;cursor:pointer;font-family:inherit">✕</button>
      </div>
    ` : `<div style="font-size:11px;color:var(--ink-3)">Utilisez les boutons ci-dessus ou cliquez un CP sur la carte.</div>`}
    ` : `
    ${hasShared ? `<div style="font-size:11px;color:#8B5CF6;font-weight:600;margin-bottom:8px">📎 Scénario chargé depuis un lien partagé (${assignedCPs.length} CP). Activez le mode pour l'explorer.</div>` : ''}
    <div style="font-size:11px;color:var(--ink-3)">Activez le mode scénario pour tester des réaffectations et mesurer l'impact.</div>`}
  `;
}

// ============================================================
// Bottom table
// ============================================================
function renderDeptTables(records) {
  const panel = document.getElementById('dept-panel');
  panel.innerHTML = '';

  const byStore = {};
  for (const r of records) {
    if (!byStore[r.store.code]) byStore[r.store.code] = [];
    byStore[r.store.code].push(r);
  }
  const codes = Object.keys(byStore).sort();

  if (!codes.length) {
    panel.style.gridTemplateColumns = '1fr';
    panel.innerHTML = `<div class="empty" style="grid-column:1/-1">Aucune donnée à afficher.</div>`;
    return;
  }

  panel.style.gridTemplateColumns = `repeat(${codes.length},1fr)`;

  for (const code of codes) {
    const recs = byStore[code].sort((a,b)=>a.cp.localeCompare(b.cp));
    const store = M.stores[code];
    const uniqCPs = new Set(recs.map(r=>r.cp)).size;
    const totalPop = recs.reduce((a,r)=>a+r.population,0);

    const col = document.createElement('div');
    col.className = 'dept-col';
    col.innerHTML = `
      <div class="dept-col-hdr">
        <div class="dept-col-title">
          <div class="dept-col-dot" style="background:${PMA_COLORS[store.pma]}"></div>
          Départ ${store.pma} · ${store.code}
        </div>
        <div class="dept-col-meta">${recs.length} aff. · ${uniqCPs} CP</div>
      </div>
      <div class="dept-tbl-wrap">
        <table>
          <thead><tr>
            <th>CP</th><th>Commune</th><th>TA src</th><th>Z. tps</th>
            <th>PMA</th><th>Flux</th>
            <th style="text-align:right">Pop.</th>
            <th style="text-align:right">km</th>
            <th style="text-align:right">Temps</th>
          </tr></thead>
          <tbody>
            ${recs.map(r => `<tr data-lat="${r.lat}" data-lng="${r.lng}">
              <td><b>${r.cp}</b></td>
              <td style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.name||''}">${r.name||'—'}</td>
              <td><span class="ta-pill" style="background:${sourceTAColor(r.sourceTA)}" title="${r.zoneName}">${r.sourceTA}</span></td>
              <td><span class="ta-pill" style="background:${ZONE_COLORS[r.timeZone]||'#888'}">Z${r.timeZone||'?'}</span></td>
              <td><span class="pma-tag" style="border-color:${PMA_COLORS[r.flow.pma]};color:${PMA_COLORS[r.flow.pma]}">${r.flow.pma}</span></td>
              <td><span class="flux-tag" style="background:${FLUX_COLORS[r.flow.flux]}">${r.flow.flux}</span></td>
              <td style="text-align:right;font-variant-numeric:tabular-nums">${fmt(r.population)}</td>
              <td style="text-align:right;font-variant-numeric:tabular-nums">${Math.round(r.dist)}</td>
              <td style="text-align:right;font-variant-numeric:tabular-nums">${fmtTime(r.time)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="dept-foot">
        <span>Total</span>
        <span style="font-variant-numeric:tabular-nums">${fmt(totalPop)} hab.</span>
      </div>`;
    panel.appendChild(col);
  }

  panel.querySelectorAll('tbody tr').forEach(tr => {
    tr.onclick = () => map.flyTo([+tr.dataset.lat, +tr.dataset.lng], 12, { duration: .7 });
  });
}

// ============================================================
// Search
// ============================================================
function setupSearch() {
  const input = document.getElementById('cp-search');
  let drop;

  input.addEventListener('input', () => {
    const raw = input.value.trim();
    if (drop) { drop.remove(); drop = null; }
    if (raw.length < 2) return;
    const q = raw.toLowerCase();
    const isNumeric = /^\d+$/.test(q);

    // CP prefix matches first, then commune name matches
    const cpMatches = isNumeric
      ? Object.keys(cpData).filter(cp => cp.startsWith(q))
      : [];
    const communeMatches = Object.keys(cpData).filter(cp => {
      if (cpMatches.includes(cp)) return false;
      return (cpData[cp].name || '').toLowerCase().includes(q);
    });

    const allMatches = [...cpMatches.slice(0, 5), ...communeMatches.slice(0, 5)].slice(0, 8);
    if (!allMatches.length) return;

    drop = document.createElement('div');
    drop.className = 'cp-results';

    if (cpMatches.length && communeMatches.length) {
      const sep = document.createElement('div');
      sep.style.cssText = 'font-size:9px;font-weight:700;color:var(--ink-3);text-transform:uppercase;padding:4px 10px 2px;letter-spacing:.05em';
      sep.textContent = 'Codes postaux';
      drop.appendChild(sep);
    }

    for (const cp of allMatches) {
      if (communeMatches.length && cp === communeMatches[0] && cpMatches.length) {
        const sep2 = document.createElement('div');
        sep2.style.cssText = 'font-size:9px;font-weight:700;color:var(--ink-3);text-transform:uppercase;padding:6px 10px 2px;border-top:1px solid var(--line);letter-spacing:.05em';
        sep2.textContent = 'Communes';
        drop.appendChild(sep2);
      }
      const d = cpData[cp];
      const flows = flowsByCP[cp] || [];
      const pmas = [...new Set(flows.map(x => x.flow.pma))];
      const it = document.createElement('div');
      it.className = 'cp-result-item';
      const nameHl = communeMatches.includes(cp)
        ? (d.name || '').replace(new RegExp(`(${raw})`, 'i'), '<b style="color:var(--blue)">$1</b>')
        : (d.name || '');
      it.innerHTML = `<b>${cp}</b> · ${nameHl}<small>PMA : ${pmas.map(p=>`<span style="color:${PMA_COLORS[p]||'#888'};font-weight:700">${p}</span>`).join(', ')||'—'} · ${flows.length} flux</small>`;
      it.onclick = () => { map.flyTo([d.lat, d.lng], 12, { duration: .7 }); drop.remove(); drop = null; input.value = ''; };
      drop.appendChild(it);
    }
    document.querySelector('.search-wrap').appendChild(drop);
  });

  document.addEventListener('click', e => {
    if (drop && !drop.contains(e.target) && e.target !== input) { drop.remove(); drop = null; }
  });
}

// ============================================================
// Full optimisation export — all insight blocks → one .xlsx with 8 sheets
// ============================================================
function exportOptimisationXLSX() {
  if (typeof XLSX === 'undefined') { alert('Bibliothèque XLSX non chargée'); return; }

  const records = buildRecords();
  const unique  = dedupe(records);
  const allS    = allStoresForOptim();
  const ts      = new Date().toISOString().slice(0, 10);
  const wb      = XLSX.utils.book_new();

  // ── helpers ─────────────────────────────────────────────────
  const PMA_ARGB = { 'Lyon':'FF0058A3','Saint-Étienne':'FFE04E2C','Grenoble':'FF0A8754','Clermont':'FFBE185D' };
  const HDR_STYLE  = { font:{ bold:true, color:{ rgb:'FFFFFFFF' } }, fill:{ fgColor:{ rgb:'FF003E7E' } }, alignment:{ horizontal:'center', wrapText:true } };
  const SUBHDR     = { font:{ bold:true, color:{ rgb:'FFFFFFFF' } }, fill:{ fgColor:{ rgb:'FF1D4ED8' } }, alignment:{ horizontal:'center' } };
  const ALT        = ['FFFAFAFA','FFFFFFFF'];

  function styleSheet(ws, headers, dataRows, colWidths, rowStyleFn) {
    ws['!cols'] = colWidths.map(w => ({ wch: w }));
    for (let c = 0; c < headers.length; c++) {
      const cell = XLSX.utils.encode_cell({ r:0, c });
      if (ws[cell]) ws[cell].s = HDR_STYLE;
    }
    dataRows.forEach((_, i) => {
      const bg = ALT[i % 2];
      for (let c = 0; c < headers.length; c++) {
        const cell = XLSX.utils.encode_cell({ r: i+1, c });
        if (!ws[cell]) continue;
        ws[cell].s = rowStyleFn ? rowStyleFn(i, c, ws[cell], bg) : { fill:{ fgColor:{ rgb:bg } }, alignment:{ horizontal: c===0?'left':'center' } };
      }
    });
    return ws;
  }

  function pmaStyle(bg, pma) {
    return { fill:{ fgColor:{ rgb: PMA_ARGB[pma]||'FF888888' } }, font:{ bold:true, color:{ rgb:'FFFFFFFF' } }, alignment:{ horizontal:'center' } };
  }

  // ── Sheet 0: Récapitulatif ───────────────────────────────────
  const recapRows = [
    ['Piste d\'optimisation','Nb éléments','Gain potentiel','Remarque'],
  ];

  // cooperation
  const coopMap = {};
  for (const [cp, flows] of Object.entries(flowsByCP)) {
    const pmasPlan = new Set(flows.map(f => f.flow.pma));
    if (pmasPlan.size === 1) {
      const planPMA = [...pmasPlan][0];
      for (const f of flows) {
        const storePMA = M.stores[f.flow.storeCode]?.pma;
        if (storePMA && storePMA !== planPMA) {
          const key = `${storePMA}→${planPMA}`;
          if (!coopMap[key]) coopMap[key] = { from:storePMA, to:planPMA, cps:new Set(), fluxTypes:new Set() };
          coopMap[key].cps.add(cp);
          coopMap[key].fluxTypes.add(f.flow.flux);
        }
      }
    }
  }
  const coopEntries = Object.values(coopMap);
  recapRows.push(['Coopération inter-PMA', coopEntries.length + ' directions', '—', 'Support mutuel entre PMAs']);

  // commun CPs
  const communCPs = unique.filter(r => r.category === 'commun');
  recapRows.push(['CPs support inter-PMA (commun)', communCPs.length + ' CP', '—', 'CPs intentionnellement partagés']);

  // misrouted
  const stores = Object.values(M.stores);
  const misrouted = [];
  for (const r of unique) {
    if (r.category === 'croise' || r.category === 'commun') continue;
    let best = r.store, bestD = r.dist;
    for (const s of stores) {
      if (s.code === r.store.code) continue;
      const d = haversine(s.lat, s.lng, r.lat, r.lng);
      if (d < bestD - 10) { bestD = d; best = s; }
    }
    if (best.code !== r.store.code) misrouted.push({ ...r, bestStore:best, gain:r.dist - bestD });
  }
  misrouted.sort((a,b) => b.gain - a.gain);
  const totalMisGain = misrouted.reduce((a,m) => a+m.gain, 0);
  recapRows.push(['CPs propres sous-optimaux (distance)', misrouted.length + ' CP', Math.round(totalMisGain) + ' km/tournée', 'Réaffectation possible vers PMA plus proche']);

  // cross LCDI
  const crossLCDI = records.filter(r => { const sp = M.stores[r.flow.storeCode]?.pma; return r.flow.flux === 'LCDI' && sp !== r.flow.pma; });
  recapRows.push(['Flux LCDI inter-PMA', crossLCDI.length + ' enregistrements', '—', 'À vérifier vs réaffectation directe']);

  // dist optim with support
  const optGroups = {};
  if (Object.keys(distMatrix).length > 0) {
    for (const r of unique) {
      const dists = distMatrix[r.cp]; if (!dists) continue;
      let bestCode = r.store.code, bestD = r.dist;
      for (const [code, d] of Object.entries(dists)) { if (d < bestD - 10) { bestD = d; bestCode = code; } }
      if (bestCode === r.store.code) continue;
      const toStore = allS[bestCode];
      const key = `${r.store.pma}→${toStore.name||bestCode}`;
      if (!optGroups[key]) optGroups[key] = { fromPMA:r.store.pma, toStore, toCode:bestCode, cpList:[], pop:0, gain:0 };
      optGroups[key].cpList.push(r);
      optGroups[key].pop += r.population;
      optGroups[key].gain += (r.dist - bestD);
    }
  }
  const optEntries = Object.values(optGroups).sort((a,b) => b.pop - a.pop);
  const totOptGain = optEntries.reduce((a,e) => a+e.gain, 0);
  const totOptCPs  = optEntries.reduce((a,e) => a+e.cpList.length, 0);
  recapRows.push(['Optimisation distance (avec magasins support)', totOptCPs + ' CP', Math.round(totOptGain) + ' km/tournée', 'Inclut Avignon, Dijon']);

  // clusters
  const deptMap = {};
  for (const r of unique) {
    const dept = r.cp.slice(0,2);
    if (!deptMap[dept]) deptMap[dept] = { dept, recs:[], pop:0, pma:r.flow.pma };
    deptMap[dept].recs.push(r);
    deptMap[dept].pop += r.population;
  }
  const clusters = Object.values(deptMap).filter(d => d.pop>50000||d.recs.length>=5).map(d => {
    const avgDists = {};
    for (const [code] of Object.entries(allS)) avgDists[code] = d.recs.reduce((a,r)=>(a+(distMatrix[r.cp]?.[code]||0)),0)/d.recs.length;
    const currentStore = Object.values(M.stores).find(s => s.pma===d.pma);
    const currentDist = currentStore ? avgDists[currentStore.code] : Infinity;
    let bestAlt = null, bestAltDist = currentDist;
    for (const [code, avg] of Object.entries(avgDists)) { if (M.stores[code]?.pma===d.pma) continue; if (avg<bestAltDist-8){bestAltDist=avg;bestAlt=allS[code];} }
    return { ...d, currentDist, bestAlt, gain:currentDist-bestAltDist };
  }).filter(d=>d.gain>8).sort((a,b)=>b.pop-a.pop).slice(0,20);
  recapRows.push(['Clusters départementaux à optimiser', clusters.length + ' départements', clusters.reduce((a,c)=>a+c.gain,0).toFixed(0)+' km moy.', 'Groupes géographiques homogènes']);

  // dynamism — analyst-only
  const nonDynList = [];
  const seenCPs2 = new Set();
  let dynCount = 0;
  for (const r of unique) {
    if (seenCPs2.has(r.cp)) continue; seenCPs2.add(r.cp);
    const fluxTypes = new Set((flowsByCP[r.cp]||[]).map(f=>f.flow.flux));
    if (fluxTypes.has('CCD')&&fluxTypes.has('LCDD')) { dynCount++; continue; }
    nonDynList.push({ r, hasCCD:fluxTypes.has('CCD'), hasLCDD:fluxTypes.has('LCDD'), fluxTypes });
  }
  if (ANALYST_MODE) {
    const pctDyn = seenCPs2.size ? Math.round(dynCount/seenCPs2.size*100) : 0;
    recapRows.push(['CPs non-dynamiques (manque CCD ou LCDD)', nonDynList.length + ' CP', pctDyn + '% dynamiques', 'Objectif : 100% CPs avec CCD+LCDD']);
  }

  recapRows.push([]); // spacer
  recapRows.push(['Exporté le', ts, '', '']);

  const wsRecap = XLSX.utils.aoa_to_sheet(recapRows);
  wsRecap['!cols'] = [{wch:46},{wch:20},{wch:20},{wch:40}];
  for (let c=0;c<4;c++) { const cell=XLSX.utils.encode_cell({r:0,c}); if(wsRecap[cell]) wsRecap[cell].s=HDR_STYLE; }
  recapRows.slice(1).forEach((_,i) => {
    const bg = ALT[i%2];
    for (let c=0;c<4;c++) { const cell=XLSX.utils.encode_cell({r:i+1,c}); if(wsRecap[cell]) wsRecap[cell].s={fill:{fgColor:{rgb:bg}},alignment:{horizontal:c===0?'left':'center'}}; }
  });
  XLSX.utils.book_append_sheet(wb, wsRecap, '📋 Récapitulatif');

  // ── Sheet 1: Coopération inter-PMA (CP detail) ───────────────
  const coopHdr = ['De (PMA support)','Vers (PMA aidée)','Code Postal','Commune','Flux','Population','Distance (km)'];
  const coopData = [coopHdr];
  for (const e of coopEntries) {
    for (const cp of [...e.cps]) {
      const flows = (flowsByCP[cp]||[]).filter(f=>M.stores[f.flow.storeCode]?.pma===e.from);
      const d = cpData[cp]||{};
      coopData.push([e.from, e.to, cp, d.name||'', [...e.fluxTypes].join(', '), d.population||0, Math.round(distMatrix[cp]?.[Object.values(M.stores).find(s=>s.pma===e.from)?.code]||0)]);
    }
  }
  const ws1 = styleSheet(XLSX.utils.aoa_to_sheet(coopData), coopHdr, coopData.slice(1), [20,20,12,24,16,12,14],
    (i,c,cell,bg) => {
      if (c===0||c===1) return pmaStyle(bg, coopData[i+1][c]);
      return { fill:{fgColor:{rgb:bg}}, alignment:{horizontal:c<3?'left':'center'} };
    });
  XLSX.utils.book_append_sheet(wb, ws1, '🤝 Coopération inter-PMA');

  // ── Sheet 2: CPs communs ─────────────────────────────────────
  const commHdr = ['Code Postal','Commune','Département','PMAs partagées','Nb PMAs','Population','Distance (km)'];
  const commData = [commHdr, ...communCPs.map(r => {
    const pmas = [...new Set((flowsByCP[r.cp]||[]).map(x=>x.flow.pma))];
    return [r.cp, r.name||'', r.cp.slice(0,2), pmas.join(' + '), pmas.length, r.population, Math.round(r.dist)];
  })];
  const ws2 = styleSheet(XLSX.utils.aoa_to_sheet(commData), commHdr, commData.slice(1), [12,24,13,32,10,12,14],
    (i,c,cell,bg) => ({ fill:{fgColor:{rgb:bg}}, alignment:{horizontal:c<2?'left':'center'} }));
  XLSX.utils.book_append_sheet(wb, ws2, '🔗 CPs support commun');

  // ── Sheet 3: CPs propres sous-optimaux ──────────────────────
  const misHdr = ['Code Postal','Commune','Département','PMA actuelle','Magasin actuel','Meilleur magasin','PMA optimale','Dist. actuelle (km)','Dist. optimale (km)','Gain (km)','Population'];
  const misData = [misHdr, ...misrouted.map(m => [
    m.cp, m.name||'', m.cp.slice(0,2), m.store.pma, m.store.code, m.bestStore.code, m.bestStore.pma,
    Math.round(m.dist), Math.round(m.dist-m.gain), Math.round(m.gain), m.population
  ])];
  const ws3 = styleSheet(XLSX.utils.aoa_to_sheet(misData), misHdr, misData.slice(1),
    [12,22,13,18,14,14,18,16,16,12,12],
    (i,c,cell,bg) => {
      if (c===3) return pmaStyle(bg, misData[i+1][3]);
      if (c===6) return pmaStyle(bg, misData[i+1][6]);
      if (c===9) return { fill:{fgColor:{rgb:'FFFFF0F0'}}, font:{bold:true,color:{rgb:'FFB91C1C'}}, alignment:{horizontal:'center'} };
      return { fill:{fgColor:{rgb:bg}}, alignment:{horizontal:c<2?'left':'center'} };
    });
  XLSX.utils.book_append_sheet(wb, ws3, '🔀 CPs sous-optimaux');

  // ── Sheet 4: LCDI cross-PMA ──────────────────────────────────
  const lcdiHdr = ['Code Postal','Commune','Département','PMA plan','Store livrant','PMA store','Flux','Zone TA','Population'];
  const lcdiData = [lcdiHdr, ...crossLCDI.map(r => [
    r.cp, r.name||'', r.cp.slice(0,2), r.flow.pma, r.flow.storeCode,
    M.stores[r.flow.storeCode]?.pma||'', r.flow.flux, r.sourceTA, r.population
  ])];
  const ws4 = styleSheet(XLSX.utils.aoa_to_sheet(lcdiData), lcdiHdr, lcdiData.slice(1), [12,22,13,18,14,18,10,10,12],
    (i,c,cell,bg) => {
      if (c===3) return pmaStyle(bg, lcdiData[i+1][3]);
      if (c===5) return pmaStyle(bg, lcdiData[i+1][5]);
      return { fill:{fgColor:{rgb:bg}}, alignment:{horizontal:c<2?'left':'center'} };
    });
  XLSX.utils.book_append_sheet(wb, ws4, '🔗 LCDI cross-PMA');

  // ── Sheet 5: Optimisation distance avec magasins support ─────
  const optHdr = ['Code Postal','Commune','Département','PMA actuelle','Store actuel','Store optimal','PMA/Magasin optimal','Dist. actuelle (km)','Dist. optimale (km)','Gain (km)','Population'];
  const optRows = [];
  for (const e of optEntries) {
    for (const r of e.cpList) {
      const bestD = distMatrix[r.cp]?.[e.toCode] ?? 0;
      optRows.push([r.cp, r.name||'', r.cp.slice(0,2), e.fromPMA, r.store.code, e.toCode,
        (e.toStore.name||e.toCode).replace('IKEA ',''), Math.round(r.dist), Math.round(bestD), Math.round(r.dist-bestD), r.population]);
    }
  }
  const optData = [optHdr, ...optRows];
  const ws5 = styleSheet(XLSX.utils.aoa_to_sheet(optData), optHdr, optRows, [12,22,13,18,12,12,22,16,16,12,12],
    (i,c,cell,bg) => {
      if (c===3) return pmaStyle(bg, optRows[i][3]);
      if (c===9) return { fill:{fgColor:{rgb:'FFFFF0F0'}}, font:{bold:true,color:{rgb:'FFB91C1C'}}, alignment:{horizontal:'center'} };
      return { fill:{fgColor:{rgb:bg}}, alignment:{horizontal:c<2?'left':'center'} };
    });
  XLSX.utils.book_append_sheet(wb, ws5, '🎯 Optim. magasins support');

  // ── Sheet 6: Clusters départementaux ─────────────────────────
  const cluHdr = ['Département','PMA actuelle','Nb CPs','Population','Dist. moy. actuelle (km)','Meilleur alt. store','Gain moy. (km)'];
  const cluData = [cluHdr, ...clusters.map(d => [
    d.dept, d.pma, d.recs.length, d.pop,
    Math.round(d.currentDist), (d.bestAlt?.name||d.bestAlt?.code||'—').replace('IKEA ',''), Math.round(d.gain)
  ])];
  const ws6 = styleSheet(XLSX.utils.aoa_to_sheet(cluData), cluHdr, cluData.slice(1), [13,18,10,14,20,24,14],
    (i,c,cell,bg) => {
      if (c===1) return pmaStyle(bg, cluData[i+1][1]);
      if (c===6) return { fill:{fgColor:{rgb:'FFFFF0F0'}}, font:{bold:true,color:{rgb:'FFB91C1C'}}, alignment:{horizontal:'center'} };
      return { fill:{fgColor:{rgb:bg}}, alignment:{horizontal:c===0?'left':'center'} };
    });
  XLSX.utils.book_append_sheet(wb, ws6, '🗺️ Clusters dép.');

  // ── Sheet 7: CPs non-dynamiques — analyst-only ───────────────
  if (ANALYST_MODE) {
    const dynHdr = ['Code Postal','Commune','Département','PMA','Flux existants','Flux manquant','Population','Distance (km)'];
    const dynRows = nonDynList.sort((a,b)=>a.r.flow?.pma?.localeCompare(b.r.flow?.pma)||a.r.cp.localeCompare(b.r.cp)).map(({r,hasCCD,hasLCDD}) => [
      r.cp, r.name||'', r.cp.slice(0,2), r.flow?.pma||'',
      hasCCD&&!hasLCDD?'CCD':!hasCCD&&hasLCDD?'LCDD':'—',
      !hasCCD?'CCD':'LCDD', r.population, Math.round(r.dist)
    ]);
    const dynData = [dynHdr, ...dynRows];
    const ws7 = styleSheet(XLSX.utils.aoa_to_sheet(dynData), dynHdr, dynRows, [12,22,13,18,14,14,12,14],
      (i,c,cell,bg) => {
        if (c===3) return pmaStyle(bg, dynRows[i][3]);
        if (c===5) {
          const missing = dynRows[i][5];
          return { fill:{fgColor:{rgb:bg}}, font:{bold:true, color:{rgb:missing==='CCD'?'FFB91C1C':'FF1D4ED8'}}, alignment:{horizontal:'center'} };
        }
        return { fill:{fgColor:{rgb:bg}}, alignment:{horizontal:c<2?'left':'center'} };
      });
    XLSX.utils.book_append_sheet(wb, ws7, '⚡ CPs non-dynamiques');
  }

  XLSX.writeFile(wb, `PMA-optimisation-${ts}.xlsx`);
}

// Non-dynamic CPs Excel export (kept for backward compat — now calls full export)
// ============================================================
function exportDynamismXLSX() { exportOptimisationXLSX(); }

// CSV export
// ============================================================
function exportCSV() {
  const records = buildRecords();
  const rows = [['CP','Commune','PMA','Flux','Store','TA_source_brut','TA_source_norm','Zone_temps','Population','Distance_km','Temps_h','Lat','Lng']];
  for (const r of records) rows.push([
    r.cp, (r.name||'').replace(/[",]/g,' '),
    r.flow.pma, r.flow.flux, r.store.code, r.zoneName, r.sourceTA, r.timeZone||'',
    r.population, Math.round(r.dist), r.time.toFixed(2),
    r.lat.toFixed(5), r.lng.toFixed(5),
  ]);
  const csv = rows.map(row => row.map(c => `"${String(c).replace(/"/g,'""')}"`).join(';')).join('\n');
  const blob = new Blob(['﻿'+csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'pma-export.csv' });
  a.click(); URL.revokeObjectURL(url);
}

// ============================================================
// Panel collapse
// ============================================================
function updatePanelPositions() {
  const lp   = document.getElementById('left-panel');
  const rp   = document.getElementById('right-panel');
  const ov   = document.getElementById('map-overlay');
  const leg  = document.getElementById('legend');
  const tabL = document.getElementById('tab-left');
  const tabR = document.getElementById('tab-right');

  lp.classList.toggle('collapsed', !state.leftOpen);
  rp.classList.toggle('collapsed', !state.rightOpen);
  tabL.style.display = state.leftOpen  ? 'none' : 'flex';
  tabR.style.display = state.rightOpen ? 'none' : 'flex';

  const lOff = state.leftOpen ? 'var(--pw)' : '0px';
  ov.style.left  = `calc(${lOff} + 12px)`;
  leg.style.left = `calc(${lOff} + 12px)`;
}

// ============================================================
// Wire UI
// ============================================================
function wireUI() {
  document.querySelectorAll('#mode-bar .ctrl-btn').forEach(b => {
    b.onclick = () => {
      state.mode = b.dataset.mode;
      document.querySelectorAll('#mode-bar .ctrl-btn').forEach(x => x.classList.toggle('active', x===b));
      renderAll();
    };
  });
  document.querySelectorAll('#base-bar .ctrl-btn').forEach(b => {
    b.onclick = () => {
      setBasemap(b.dataset.base);
      document.querySelectorAll('#base-bar .ctrl-btn').forEach(x => x.classList.toggle('active', x===b));
    };
  });
  document.querySelectorAll('#zone-tabs .chip').forEach(b => {
    b.onclick = () => {
      state.zoneFilter = b.dataset.zone;
      document.querySelectorAll('#zone-tabs .chip').forEach(x => x.classList.toggle('active', x===b));
      renderAll();
    };
  });
  document.querySelectorAll('#unit-tabs .chip').forEach(b => {
    b.onclick = () => {
      state.unit = b.dataset.unit;
      document.querySelectorAll('#unit-tabs .chip').forEach(x => x.classList.toggle('active', x===b));
      renderAll();
    };
  });

  const range = document.getElementById('speed-range');
  const val   = document.getElementById('speed-val');
  range.oninput  = () => { state.speedKmh = +range.value; val.textContent = `${range.value} km/h`; };
  range.onchange = () => renderAll();

  const togLog = document.getElementById('toggle-logistics');
  if (togLog) {
    togLog.checked = state.showLogistics;
    togLog.onchange = () => { state.showLogistics = togLog.checked; renderAll(); };
  }
  const togOpt = document.getElementById('toggle-optimal');
  if (togOpt) {
    togOpt.checked = state.showOptimalOverlay;
    togOpt.onchange = () => { state.showOptimalOverlay = togOpt.checked; renderAll(); };
  }

  document.getElementById('left-close').onclick  = () => { state.leftOpen  = false; updatePanelPositions(); };
  document.getElementById('right-close').onclick = () => { state.rightOpen = false; updatePanelPositions(); };
  document.getElementById('tab-left').onclick    = () => { state.leftOpen  = true;  updatePanelPositions(); };
  document.getElementById('tab-right').onclick   = () => { state.rightOpen = true;  updatePanelPositions(); };

  document.getElementById('drawer-tab').onclick = () => {
    state.drawerOpen = !state.drawerOpen;
    document.getElementById('bottom-drawer').classList.toggle('open', state.drawerOpen);
    document.getElementById('drawer-label').textContent =
      state.drawerOpen ? 'Masquer le tableau' : 'Tableau détaillé par BU';
  };

  document.getElementById('export-csv').onclick = exportCSV;
  setupSearch();
  updatePanelPositions();

  // Auto-activate scenario if loaded from shared URL
  if (Object.keys(state.scenario.assignments).length > 0) {
    state.scenario.active = true;
  }
}

// ============================================================
// Master render
// ============================================================
function renderAll() {
  renderPMAPicker();
  renderFlowList();
  renderSourceTAFilter();
  renderCategoryFilter();
  const records = buildRecords();
  renderMap(records);
  renderHeaderSummary(records);
  renderOverlay(records);
  renderLegend();
  renderRightPanel(records);
  renderDeptTables(records);
  renderScenarioPanel();
}
