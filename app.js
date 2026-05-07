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

// Sort key for source TA labels (PRIO first, then numeric)
function sourceTASortKey(name) {
  if (name === 'PRIO') return -1;
  const m = name.match(/(\d+)/);
  return m ? parseInt(m[1],10) : 99;
}

// ============================================================
// State
// ============================================================
let state = {
  selectedPMAs:   new Set(['Lyon']),
  enabledFlowIds: new Set(M.flows.map(f => f._id)),  // all on by default
  zoneFilter:     'all',
  taSourceFilter: 'all',
  unit:           'ta-source',
  mode:           'polygons',
  basemap:        'light',
  speedKmh:       65,
  leftOpen:       true,
  rightOpen:      true,
  drawerOpen:     false,
};

// ============================================================
// Runtime data
// ============================================================
let map;
let baseLayers = {};
let layers     = { polygons: [], markers: [], heat: null, stores: [], rings: [] };
let cpData     = {};   // cp → { lat, lng, name, polygons, population }
let flowsByCP  = {};   // cp → [{ flow, zoneName, zoneLabel }]

// ============================================================
// Bootstrap
// ============================================================
(async () => {
  initMap();
  wireUI();
  buildFlowIndex();
  await loadCPGeometry();
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
        out.push({ cp: k, name: d.name, lat: d.lat, lng: d.lng,
          population: d.population || 0, polygons: d.polygons,
          flow, zoneName, zoneLabel: zone.label, sourceTA, store, dist, time, timeZone: tz });
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

function colorFor(r) {
  const u = state.unit;
  if (u === 'ta-source') return sourceTAColor(r.sourceTA);
  if (u === 'cp' || u === 'zone') return ZONE_COLORS[r.timeZone] || '#999';
  if (u === 'population') return scale(r.population, popMin, popMax, ['#C7E9F8','#0EA5E9','#0C4A6E']);
  if (u === 'distance')   return scale(r.dist, distMin, distMax, ['#059669','#FFDB00','#DC2626']);
  if (u === 'time')       return scale(r.time, timeMin, timeMax, ['#059669','#FFDB00','#DC2626']);
  return PMA_COLORS[r.flow.pma] || '#0058A3';
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
  ['polygons','markers','rings','stores'].forEach(k => {
    layers[k].forEach(l => map.removeLayer(l)); layers[k] = [];
  });
  if (layers.heat) { map.removeLayer(layers.heat); layers.heat = null; }
}

function renderMap(records) {
  clearLayers();
  computeScales(records);
  const unique = dedupe(records);
  const bounds = [];

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
    for (const r of unique) {
      const color = colorFor(r);
      const allFlows = flowsByCP[r.cp] || [];
      const pmasForCP = new Set(allFlows.map(x => x.flow.pma));
      const isOverlap = pmasForCP.size > 1;
      for (const poly of r.polygons) {
        const layer = L.geoJSON(poly, {
          style: {
            color: isOverlap ? '#FFDB00' : 'rgba(255,255,255,.6)',
            weight: isOverlap ? 2 : 0.7,
            fillColor: color, fillOpacity: .68,
          },
        })
          .bindPopup(buildPopup(r), { maxWidth: 280 })
          .on('mouseover', e => e.target.setStyle({ weight: 2.5, fillOpacity: .88 }))
          .on('mouseout', e => e.target.setStyle({ weight: isOverlap?2:.7, fillOpacity: .68 }))
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
  const flowRows = allFlows.map(f =>
    `<div class="popup-flow-row">
      <span style="width:8px;height:8px;border-radius:50%;background:${FLUX_COLORS[f.flow.flux]};flex-shrink:0;display:inline-block"></span>
      <b>${f.flow.flux}</b>
      <span style="color:var(--ink-3)">→</span>
      ${f.flow.pma}
      <span style="color:var(--ink-3);margin-left:auto;font-size:9px">${f.zoneName} · Store ${f.flow.storeCode}</span>
    </div>`
  ).join('');

  return `<div class="cp-popup">
    <div class="popup-hdr" style="background:${color}">
      <div class="popup-cp">${r.cp}</div>
      <div class="popup-name">${r.name || ''}</div>
    </div>
    <div class="popup-body">
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
        <div class="popup-ta" style="background:${sourceTAColor(r.sourceTA)};margin:0">
          ${r.sourceTA} <span style="opacity:.8;font-weight:600">· source plan</span>
        </div>
        <div class="popup-ta" style="background:${tzColor};margin:0">
          Z${r.timeZone || '?'} <span style="opacity:.8;font-weight:600">· temps</span>
        </div>
      </div>
      <table class="popup-tbl">
        <tr><td>Zone source</td><td>${r.zoneName} <span style="color:var(--ink-3);font-size:10px">(${r.sourceTA})</span></td></tr>
        <tr><td>Magasin</td><td>${r.store.name.replace('IKEA ','')}</td></tr>
        <tr><td>Distance</td><td>${Math.round(r.dist)} km</td></tr>
        <tr><td>Temps trajet</td><td>${fmtTime(r.time)}</td></tr>
        <tr><td>Population</td><td>${fmt(r.population)}</td></tr>
      </table>
      <div class="popup-flows-hdr">Tous les flux (${allFlows.length})</div>
      ${flowRows}
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
  const overlapN = unique.filter(r => new Set((flowsByCP[r.cp]||[]).map(x=>x.flow.pma)).size > 1).length;
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
    <span class="hdr-stat"><b>${overlapN}</b> doublons</span>`;
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
    title.textContent = 'TA source (plan)';
    const visible = uniqueSourceTAs(buildRecords());
    items.innerHTML = visible.map(t =>
      `<div class="legend-item"><div class="legend-sw" style="background:${sourceTAColor(t)}"></div><span>${t}</span></div>`
    ).join('') + `<div style="height:1px;background:var(--line);margin:6px 0"></div>
      <div class="legend-item"><div class="legend-sw" style="background:#FFDB00;border:1px solid #ccc"></div><span style="color:var(--ink-2)">Doublon inter-PMAs</span></div>`;
  } else if (u === 'cp' || u === 'zone') {
    title.textContent = 'Zone temps (calculée)';
    items.innerHTML = `
      <div class="legend-item"><div class="legend-sw" style="background:${ZONE_COLORS['1']}"></div><span>Z1 · ≤ 45 min</span></div>
      <div class="legend-item"><div class="legend-sw" style="background:${ZONE_COLORS['2']}"></div><span>Z2 · 45–60 min</span></div>
      <div class="legend-item"><div class="legend-sw" style="background:${ZONE_COLORS['3']}"></div><span>Z3 · 60–110 min</span></div>
      <div style="height:1px;background:var(--line);margin:6px 0"></div>
      <div class="legend-item"><div class="legend-sw" style="background:#FFDB00;border:1px solid #ccc"></div><span style="color:var(--ink-2)">Doublon inter-PMAs</span></div>`;
  } else if (u === 'population') {
    title.textContent = 'Population';
    items.innerHTML = gradLegend(['#C7E9F8','#0EA5E9','#0C4A6E'], ['Faible','Moyenne','Élevée']);
  } else if (u === 'distance') {
    title.textContent = 'Distance (km)';
    items.innerHTML = gradLegend(['#059669','#FFDB00','#DC2626'], ['Proche','Moyen','Loin']);
  } else if (u === 'time') {
    title.textContent = 'Temps trajet';
    items.innerHTML = gradLegend(['#059669','#FFDB00','#DC2626'], ['Rapide','Moyen','Long']);
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
  const overlapN = unique.filter(r => new Set((flowsByCP[r.cp]||[]).map(x=>x.flow.pma)).size > 1).length;

  document.getElementById('stat-grid').innerHTML = `
    <div class="stat-card"><div class="stat-num">${unique.length}</div><div class="stat-label">Codes postaux</div></div>
    <div class="stat-card"><div class="stat-num">${fmt(totalPop)}</div><div class="stat-label">Population</div></div>
    <div class="stat-card"><div class="stat-num">${Math.round(distAvg)}<small>km</small></div><div class="stat-label">Dist. moyenne</div></div>
    <div class="stat-card"><div class="stat-num">${fmtTime(timeAvg)}</div><div class="stat-label">Temps moyen</div></div>
    <div class="stat-card"><div class="stat-num">${Math.round(distMax2)}<small>km</small></div><div class="stat-label">Dist. maximale</div></div>
    <div class="stat-card"><div class="stat-num" style="color:${overlapN>0?'#F59E0B':'inherit'}">${overlapN}</div><div class="stat-label">Doublons inter-PMA</div></div>`;

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

  // 1. Overlapping CPs
  const overlap = unique.filter(r => new Set((flowsByCP[r.cp]||[]).map(x=>x.flow.pma)).size > 1);
  if (overlap.length) {
    const sample = overlap.slice(0,5).map(r => {
      const pmas = [...new Set((flowsByCP[r.cp]||[]).map(x=>x.flow.pma))];
      return `<code style="background:white;padding:1px 5px;border-radius:3px;border:1px solid var(--line);font-family:monospace;font-size:10px">${r.cp}</code> ${pmas.join(' + ')}`;
    }).join('<br>');
    ins.innerHTML += `<div class="insight-card">
      <div class="insight-title"><div class="insight-icon" style="background:#FEF9C3">⚠️</div>${overlap.length} CP servis par plusieurs PMAs</div>
      ${sample}${overlap.length>5?`<br><span style="color:var(--ink-3)">…et ${overlap.length-5} autres</span>`:''}
      <div style="margin-top:7px;font-size:10px;color:var(--ink-3)">Rationaliser l'affectation supprime les tournées redondantes.</div>
    </div>`;
  }

  // 2. Mis-routed CPs
  const stores = Object.values(M.stores);
  const misrouted = [];
  for (const r of unique) {
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
    ins.innerHTML += `<div class="insight-card">
      <div class="insight-title"><div class="insight-icon" style="background:#FEE2E2">🔀</div>${misrouted.length} CP plus proches d'un autre magasin</div>
      ${top}${misrouted.length>4?`<br><span style="color:var(--ink-3)">…et ${misrouted.length-4} autres</span>`:''}
      <div style="margin-top:7px;font-size:10px;color:var(--ink-3)">Gain potentiel : <b>${Math.round(totalGain)} km</b> / tournée.</div>
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
    ins.innerHTML += `<div class="insight-card">
      <div class="insight-title"><div class="insight-icon" style="background:#EDE9FE">🔗</div>Flux LCDI inter-PMA</div>
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

  if (!ins.innerHTML) ins.innerHTML = `<div class="insight-card" style="color:var(--ink-3);text-align:center;padding:16px">
    ✓ Aucune anomalie détectée.
  </div>`;
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
    const q = input.value.trim();
    if (drop) { drop.remove(); drop = null; }
    if (q.length < 2) return;
    const matches = Object.keys(cpData).filter(cp => cp.startsWith(q)).slice(0, 8);
    if (!matches.length) return;

    drop = document.createElement('div');
    drop.className = 'cp-results';
    for (const cp of matches) {
      const d = cpData[cp];
      const flows = flowsByCP[cp] || [];
      const pmas = [...new Set(flows.map(x=>x.flow.pma))];
      const it = document.createElement('div');
      it.className = 'cp-result-item';
      it.innerHTML = `<b>${cp}</b> · ${d.name}<small>PMA : ${pmas.join(', ')||'—'} · ${flows.length} flux</small>`;
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

  document.getElementById('left-close').onclick  = () => { state.leftOpen  = false; updatePanelPositions(); };
  document.getElementById('right-close').onclick = () => { state.rightOpen = false; updatePanelPositions(); };
  document.getElementById('tab-left').onclick    = () => { state.leftOpen  = true;  updatePanelPositions(); };
  document.getElementById('tab-right').onclick   = () => { state.rightOpen = true;  updatePanelPositions(); };

  document.getElementById('drawer-tab').onclick = () => {
    state.drawerOpen = !state.drawerOpen;
    document.getElementById('bottom-drawer').classList.toggle('open', state.drawerOpen);
    document.getElementById('drawer-label').textContent =
      state.drawerOpen ? 'Masquer le tableau' : 'Tableau détaillé par dépôt';
  };

  document.getElementById('export-csv').onclick = exportCSV;
  setupSearch();
  updatePanelPositions();
}

// ============================================================
// Master render
// ============================================================
function renderAll() {
  renderPMAPicker();
  renderFlowList();
  renderSourceTAFilter();
  const records = buildRecords();
  renderMap(records);
  renderHeaderSummary(records);
  renderOverlay(records);
  renderLegend();
  renderRightPanel(records);
  renderDeptTables(records);
}
