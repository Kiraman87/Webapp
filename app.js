// PMA Mapping app — Leaflet, vanilla JS
// Loads French postal code centroids on demand, renders TAs per PMA

const PMA = window.PMA_MAPPINGS;

// Categorical palette (distinct colors per TA — high-contrast, accessible)
const PALETTE = [
  '#0058A3', // IKEA blue
  '#FFDB00', // IKEA yellow
  '#E04E2C', // red-orange
  '#0A8754', // green
  '#7B3F99', // purple
  '#00A6B4', // teal
  '#F18B00', // orange
  '#C2185B', // magenta
];

// PMA-level colors for "all" comparison view
const PMA_COLORS = {
  lyon: '#0058A3',
  saintEtienne: '#E04E2C',
  grenoble: '#0A8754',
};
const PMA_LABELS = { lyon: 'Lyon', saintEtienne: 'Saint-Étienne', grenoble: 'Grenoble' };

// State
let state = {
  pma: 'lyon',
  service: 'CCD', // for Saint-Etienne
  mode: 'markers', // markers | zones | heat
  hiddenZones: new Set(),
  showRadiusRings: true,
  theme: 'light',
};

let map;
let layers = { zones: [], markers: [], heat: null, store: null, rings: [] };
let cpCoords = {}; // "69001" -> {lat, lng, name}

// ===== Leaflet init =====
function initMap() {
  map = L.map('map', {
    zoomControl: true,
    preferCanvas: true,
  }).setView([45.6, 5.0], 8);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    pane: 'shadowPane',
    maxZoom: 19,
  }).addTo(map);
}

// ===== Postal code centroid loader =====
// Use the public datanova/laposte dataset hosted on GitHub via jsdelivr.
// Fallback approach: build coordinates from a compact lookup.
async function loadCpCoords() {
  const all = new Set();
  function collect(zones) {
    for (const z of Object.values(zones)) {
      (z.cps || []).forEach(cp => all.add(String(cp).padStart(5, '0')));
    }
  }
  collect(PMA.lyon.zones);
  collect(PMA.grenoble.zones);
  for (const svc of Object.values(PMA.saintEtienne.services)) collect(svc.zones);

  // Primary: api-adresse.data.gouv.fr (very reliable French government API)
  // Batch fetch using the search endpoint per postal code (fast in parallel)
  document.getElementById('loading').querySelector('p').textContent = `Loading ${all.size} postal code centroids…`;
  const cps = [...all];
  const batchSize = 25;
  for (let i = 0; i < cps.length; i += batchSize) {
    const batch = cps.slice(i, i + batchSize);
    await Promise.all(batch.map(async (cp) => {
      try {
        const resp = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${cp}&type=municipality&limit=1`);
        if (!resp.ok) return;
        const data = await resp.json();
        const f = data.features?.[0];
        if (f && f.geometry) {
          const [lng, lat] = f.geometry.coordinates;
          cpCoords[cp] = { lat, lng, name: f.properties.city || f.properties.label };
        }
      } catch (e) {}
    }));
    document.getElementById('loading').querySelector('p').textContent =
      `Loading postal codes… ${Math.min(i+batchSize, cps.length)}/${cps.length}`;
  }

  // Fallback for any missing codes
  if (Object.keys(cpCoords).length < all.size) {
    try {
      const resp = await fetch('data/cp-coords-fallback.json');
      if (resp.ok) {
        const data = await resp.json();
        for (const [cp, v] of Object.entries(data)) {
          if (!cpCoords[cp]) cpCoords[cp] = v;
        }
      }
    } catch (e) {}
  }

  console.log(`Loaded coords for ${Object.keys(cpCoords).length}/${all.size} postal codes`);
}

// ===== Rendering =====
function clearLayers() {
  for (const k of ['zones', 'markers', 'rings']) {
    layers[k].forEach(l => map.removeLayer(l));
    layers[k] = [];
  }
  if (layers.heat) { map.removeLayer(layers.heat); layers.heat = null; }
  if (layers.store) { map.removeLayer(layers.store); layers.store = null; }
}

function getCurrentZones() {
  if (state.pma === 'all') return null;
  if (state.pma === 'saintEtienne') {
    return PMA.saintEtienne.services[state.service].zones;
  }
  return PMA[state.pma].zones;
}

function getCurrentStore() {
  if (state.pma === 'all') return null;
  return PMA[state.pma].store;
}

function renderStore(store, color = '#0058A3', label = 'IKEA') {
  if (!store) return null;
  const icon = L.divIcon({
    className: '',
    html: `<div class="store-pin" style="background:${color}"><span>${label}</span></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
  });
  const m = L.marker([store.lat, store.lng], { icon, zIndexOffset: 1000 })
    .bindPopup(`<div class="cp-popup"><b>${store.name}</b><br><small>CP ${store.cp}</small></div>`)
    .addTo(map);
  return m;
}

function renderRings(store, color) {
  if (!state.showRadiusRings || !store) return;
  // 25km, 50km, 100km rings
  const radii = [25, 50, 100];
  const rings = radii.map((r, i) => {
    return L.circle([store.lat, store.lng], {
      radius: r * 1000,
      color: color,
      weight: 1,
      opacity: 0.35,
      fillOpacity: 0.04 - i * 0.01,
      dashArray: '4 6',
      interactive: false,
    }).addTo(map);
  });
  layers.rings.push(...rings);
}

function paletteFor(zoneNames) {
  const map = {};
  zoneNames.forEach((n, i) => map[n] = PALETTE[i % PALETTE.length]);
  return map;
}

function renderPMA() {
  clearLayers();

  if (state.pma === 'all') return renderAllPMA();

  const zones = getCurrentZones();
  const store = getCurrentStore();
  const zoneNames = Object.keys(zones);
  const colors = paletteFor(zoneNames);

  // Store + rings
  layers.store = renderStore(store);
  renderRings(store, '#0058A3');

  // Per-zone rendering
  const allPoints = [];
  for (const zoneName of zoneNames) {
    if (state.hiddenZones.has(zoneName)) continue;
    const color = colors[zoneName];
    const zone = zones[zoneName];

    const points = [];
    for (const cp of zone.cps) {
      const c = cpCoords[String(cp).padStart(5, '0')];
      if (!c) continue;
      points.push([c.lat, c.lng, cp, c.name]);
      allPoints.push([c.lat, c.lng]);
    }

    if (state.mode === 'markers') {
      for (const [lat, lng, cp, name] of points) {
        const m = L.circleMarker([lat, lng], {
          radius: 7,
          fillColor: color,
          color: '#fff',
          weight: 1.5,
          fillOpacity: 0.9,
        }).bindPopup(
          `<div class="cp-popup">
            <b>${cp}</b> ${name ? '· ' + name : ''}<br>
            <span class="ta-tag" style="background:${color}">${zone.label || zoneName}</span><br>
            <small style="color:#888">PMA: ${PMA_LABELS[state.pma]}${state.pma==='saintEtienne'?' / '+state.service:''}</small>
          </div>`
        ).addTo(map);
        layers.markers.push(m);
      }
    } else if (state.mode === 'zones') {
      // Convex hull (or simple polygon) per zone
      if (points.length >= 3) {
        const hull = convexHull(points.map(p => [p[1], p[0]])); // [lng,lat]
        const poly = L.polygon(hull.map(p => [p[1], p[0]]), {
          color: color, weight: 2, fillColor: color, fillOpacity: 0.18,
        }).bindPopup(`<div class="cp-popup"><b>${zone.label || zoneName}</b><br><small>${points.length} postal codes</small></div>`).addTo(map);
        layers.zones.push(poly);
      }
      // Also small markers for points
      for (const [lat, lng, cp] of points) {
        const m = L.circleMarker([lat, lng], {
          radius: 3, fillColor: color, color: color, fillOpacity: 0.8, weight: 0,
        }).addTo(map);
        layers.markers.push(m);
      }
    } else if (state.mode === 'heat') {
      // collect for heat layer below
    }
  }

  if (state.mode === 'heat') {
    const heatPoints = [];
    for (const zoneName of zoneNames) {
      if (state.hiddenZones.has(zoneName)) continue;
      for (const cp of zones[zoneName].cps) {
        const c = cpCoords[String(cp).padStart(5, '0')];
        if (c) heatPoints.push([c.lat, c.lng, 0.7]);
      }
    }
    if (heatPoints.length && L.heatLayer) {
      layers.heat = L.heatLayer(heatPoints, {
        radius: 25, blur: 25, maxZoom: 12,
        gradient: { 0.2: '#0058A3', 0.4: '#00A6B4', 0.6: '#FFDB00', 0.8: '#F18B00', 1: '#E04E2C' }
      }).addTo(map);
    }
  }

  // Fit bounds
  if (allPoints.length) {
    map.fitBounds(L.latLngBounds(allPoints).pad(0.1));
  }
}

function renderAllPMA() {
  // Show all 3 stores + simple per-PMA markers
  const allPoints = [];

  for (const pmaKey of ['lyon', 'saintEtienne', 'grenoble']) {
    const color = PMA_COLORS[pmaKey];
    const pma = PMA[pmaKey];
    const store = pma.store;

    // Render store
    const m = renderStore(store, color, pmaKey === 'lyon' ? 'LY' : pmaKey === 'grenoble' ? 'GR' : 'SE');

    // Render all postal codes for this PMA (use main service for SE = CCD)
    const zones = pmaKey === 'saintEtienne' ? pma.services.CCD.zones : pma.zones;
    for (const [zoneName, zone] of Object.entries(zones)) {
      for (const cp of zone.cps) {
        const c = cpCoords[String(cp).padStart(5, '0')];
        if (!c) continue;
        allPoints.push([c.lat, c.lng]);
        const dot = L.circleMarker([c.lat, c.lng], {
          radius: 5, fillColor: color, color: '#fff',
          weight: 1, fillOpacity: 0.85,
        }).bindPopup(
          `<div class="cp-popup">
            <b>${cp}</b> ${c.name ? '· ' + c.name : ''}<br>
            <span class="ta-tag" style="background:${color}">${PMA_LABELS[pmaKey]} · ${zoneName}</span>
          </div>`
        ).addTo(map);
        layers.markers.push(dot);
      }
    }
  }

  // Highlight overlap CPs (covered by 2+ PMAs)
  const overlap = computeOverlaps();
  for (const cp of Object.keys(overlap)) {
    const c = cpCoords[cp];
    if (!c) continue;
    const ring = L.circleMarker([c.lat, c.lng], {
      radius: 11, fillColor: 'transparent',
      color: '#FFDB00', weight: 3,
    }).bindPopup(
      `<div class="cp-popup">
        <b>⚠️ Overlap: ${cp}</b><br>
        Covered by: <b>${overlap[cp].join(', ')}</b><br>
        <small>Re-routing opportunity</small>
      </div>`
    ).addTo(map);
    layers.markers.push(ring);
  }

  if (allPoints.length) {
    map.fitBounds(L.latLngBounds(allPoints).pad(0.05));
  }
}

// ===== Geometry helpers =====
function convexHull(pts) {
  pts = pts.slice().sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const n = pts.length;
  if (n < 3) return pts;
  const cross = (O,A,B) => (A[0]-O[0])*(B[1]-O[1]) - (A[1]-O[1])*(B[0]-O[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = n-1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLng = (lng2-lng1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

// ===== Overlap & analytics =====
function computeOverlaps() {
  const cpToPMAs = {};
  function add(pmaName, zones) {
    for (const z of Object.values(zones)) {
      for (const cp of z.cps) {
        const key = String(cp).padStart(5,'0');
        if (!cpToPMAs[key]) cpToPMAs[key] = new Set();
        cpToPMAs[key].add(pmaName);
      }
    }
  }
  add('Lyon', PMA.lyon.zones);
  add('Saint-Étienne', PMA.saintEtienne.services.CCD.zones);
  add('Saint-Étienne', PMA.saintEtienne.services.LCD.zones);
  add('Saint-Étienne', PMA.saintEtienne.services.LCDI.zones);
  add('Grenoble', PMA.grenoble.zones);

  const overlap = {};
  for (const [cp, set] of Object.entries(cpToPMAs)) {
    if (set.size > 1) overlap[cp] = [...set];
  }
  return overlap;
}

// ===== UI rendering =====
function renderUI() {
  // PMA tabs
  document.querySelectorAll('.pma-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.pma === state.pma);
  });

  // Service section
  const serviceSection = document.getElementById('service-section');
  if (state.pma === 'saintEtienne') {
    serviceSection.style.display = '';
    const tabs = document.getElementById('service-tabs');
    tabs.innerHTML = '';
    for (const svcKey of Object.keys(PMA.saintEtienne.services)) {
      const b = document.createElement('button');
      b.className = 'service-tab' + (state.service === svcKey ? ' active' : '');
      b.textContent = svcKey;
      b.title = PMA.saintEtienne.services[svcKey].label;
      b.onclick = () => { state.service = svcKey; renderUI(); renderPMA(); };
      tabs.appendChild(b);
    }
  } else {
    serviceSection.style.display = 'none';
  }

  // Store info
  const storeBox = document.getElementById('store-info');
  if (state.pma === 'all') {
    storeBox.innerHTML = `
      <div style="font-size:13px; line-height:1.6">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="width:10px;height:10px;border-radius:50%;background:${PMA_COLORS.lyon}"></div><b>Lyon</b> <span style="color:var(--ink-3)">— Grand Parilly</span></div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="width:10px;height:10px;border-radius:50%;background:${PMA_COLORS.saintEtienne}"></div><b>Saint-Étienne</b></div>
        <div style="display:flex;align-items:center;gap:8px"><div style="width:10px;height:10px;border-radius:50%;background:${PMA_COLORS.grenoble}"></div><b>Grenoble</b> <span style="color:var(--ink-3)">— St-Martin-d'Hères</span></div>
      </div>
    `;
  } else {
    const store = getCurrentStore();
    storeBox.innerHTML = `
      <div style="font-size:14px;font-weight:700;line-height:1.4">${store.name}</div>
      <div style="font-size:12px;color:var(--ink-3);margin-top:4px">CP ${store.cp} · ${store.lat.toFixed(3)}, ${store.lng.toFixed(3)}</div>
    `;
  }

  // Zone list
  const zoneList = document.getElementById('zone-list');
  zoneList.innerHTML = '';
  if (state.pma === 'all') {
    // Show PMA color legend
    for (const pmaKey of ['lyon', 'saintEtienne', 'grenoble']) {
      const pma = PMA[pmaKey];
      const totalCps = pmaKey === 'saintEtienne'
        ? new Set(Object.values(pma.services.CCD.zones).flatMap(z => z.cps)).size
        : Object.values(pma.zones).flatMap(z => z.cps).length;
      const row = document.createElement('div');
      row.className = 'zone-row';
      row.innerHTML = `
        <div class="zone-swatch" style="background:${PMA_COLORS[pmaKey]}"></div>
        <div class="zone-name">${PMA_LABELS[pmaKey]}<small>${pmaKey === 'saintEtienne' ? 'CCD service shown' : 'all zones'}</small></div>
        <div class="zone-count">${totalCps}</div>
      `;
      zoneList.appendChild(row);
    }
  } else {
    const zones = getCurrentZones();
    const colors = paletteFor(Object.keys(zones));
    for (const [name, zone] of Object.entries(zones)) {
      const row = document.createElement('div');
      row.className = 'zone-row' + (state.hiddenZones.has(name) ? ' disabled' : '');
      row.innerHTML = `
        <div class="zone-swatch" style="background:${colors[name]}"></div>
        <div class="zone-name">${name}<small>${zone.label.replace(name + ' — ', '').replace(name, '')}</small></div>
        <div class="zone-count">${zone.cps.length}</div>
      `;
      row.onclick = () => {
        if (state.hiddenZones.has(name)) state.hiddenZones.delete(name);
        else state.hiddenZones.add(name);
        renderUI(); renderPMA();
      };
      zoneList.appendChild(row);
    }
  }

  renderOverlay();
  renderStats();
  renderInsights();
}

function renderOverlay() {
  const t = document.getElementById('overlay-title');
  const m = document.getElementById('overlay-meta');
  if (state.pma === 'all') {
    t.textContent = 'All 3 PMAs — Comparison';
    const overlap = computeOverlaps();
    m.innerHTML = `Yellow rings highlight <b>${Object.keys(overlap).length}</b> overlapping postal codes`;
  } else if (state.pma === 'saintEtienne') {
    t.textContent = `Saint-Étienne PMA — ${state.service}`;
    const zones = PMA.saintEtienne.services[state.service].zones;
    const total = Object.values(zones).reduce((a,z) => a + z.cps.length, 0);
    m.innerHTML = `${PMA.saintEtienne.services[state.service].label}<br>${total} postal codes · ${Object.keys(zones).length} TAs`;
  } else {
    t.textContent = `${PMA_LABELS[state.pma]} PMA`;
    const zones = getCurrentZones();
    const total = Object.values(zones).reduce((a,z) => a + z.cps.length, 0);
    m.innerHTML = `${total} postal codes · ${Object.keys(zones).length} Transport Areas`;
  }
}

function renderStats() {
  const snap = document.getElementById('snapshot');
  const bars = document.getElementById('bar-chart');

  if (state.pma === 'all') {
    const overlap = computeOverlaps();
    const totalCps = new Set();
    function addAll(zones) { for (const z of Object.values(zones)) z.cps.forEach(c => totalCps.add(String(c).padStart(5,'0'))); }
    addAll(PMA.lyon.zones);
    addAll(PMA.saintEtienne.services.CCD.zones);
    addAll(PMA.saintEtienne.services.LCD.zones);
    addAll(PMA.saintEtienne.services.LCDI.zones);
    addAll(PMA.grenoble.zones);
    snap.innerHTML = `
      <div class="stat-card"><div class="stat-num">${totalCps.size}</div><div class="stat-label">Unique postal codes</div></div>
      <div class="stat-card"><div class="stat-num">${Object.keys(overlap).length}</div><div class="stat-label">Overlap CPs (2+ PMAs)</div></div>
    `;
    // bar of CPs per PMA
    const counts = {
      Lyon: new Set(Object.values(PMA.lyon.zones).flatMap(z=>z.cps).map(c=>String(c).padStart(5,'0'))).size,
      'Saint-Étienne': new Set([...Object.values(PMA.saintEtienne.services.CCD.zones).flatMap(z=>z.cps), ...Object.values(PMA.saintEtienne.services.LCD.zones).flatMap(z=>z.cps), ...Object.values(PMA.saintEtienne.services.LCDI.zones).flatMap(z=>z.cps)].map(c=>String(c).padStart(5,'0'))).size,
      Grenoble: new Set(Object.values(PMA.grenoble.zones).flatMap(z=>z.cps).map(c=>String(c).padStart(5,'0'))).size,
    };
    const max = Math.max(...Object.values(counts));
    bars.innerHTML = '';
    for (const [name, n] of Object.entries(counts)) {
      const c = name === 'Lyon' ? PMA_COLORS.lyon : name === 'Grenoble' ? PMA_COLORS.grenoble : PMA_COLORS.saintEtienne;
      bars.innerHTML += `
        <div class="bar-row">
          <div class="bar-label">${name}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(n/max)*100}%;background:${c}"></div></div>
          <div class="bar-val">${n}</div>
        </div>
      `;
    }
    return;
  }

  const zones = getCurrentZones();
  const total = Object.values(zones).reduce((a,z) => a + z.cps.length, 0);
  const numTAs = Object.keys(zones).length;
  const store = getCurrentStore();

  // Compute average distance from store
  let distSum = 0, distN = 0, maxDist = 0, maxDistCp = '';
  for (const z of Object.values(zones)) {
    for (const cp of z.cps) {
      const c = cpCoords[String(cp).padStart(5,'0')];
      if (!c) continue;
      const d = haversine(store.lat, store.lng, c.lat, c.lng);
      distSum += d; distN++;
      if (d > maxDist) { maxDist = d; maxDistCp = cp; }
    }
  }
  const avg = distN ? Math.round(distSum/distN) : 0;

  snap.innerHTML = `
    <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-label">Postal codes covered</div></div>
    <div class="stat-card"><div class="stat-num">${numTAs}</div><div class="stat-label">Transport Areas</div></div>
    <div class="stat-card"><div class="stat-num">${avg} <span style="font-size:14px;color:var(--ink-3);font-weight:600">km</span></div><div class="stat-label">Avg dist. from store</div></div>
    <div class="stat-card"><div class="stat-num">${Math.round(maxDist)} <span style="font-size:14px;color:var(--ink-3);font-weight:600">km</span></div><div class="stat-label">Farthest CP — ${maxDistCp}</div></div>
  `;

  // Bar chart per zone
  const colors = paletteFor(Object.keys(zones));
  const max = Math.max(...Object.values(zones).map(z => z.cps.length));
  bars.innerHTML = '';
  for (const [name, z] of Object.entries(zones)) {
    const pct = total ? Math.round(z.cps.length/total*100) : 0;
    bars.innerHTML += `
      <div class="bar-row">
        <div class="bar-label">${name}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(z.cps.length/max)*100}%;background:${colors[name]}"></div></div>
        <div class="bar-val">${z.cps.length} <span style="color:var(--ink-3);font-weight:400">·${pct}%</span></div>
      </div>
    `;
  }
}

function renderInsights() {
  const ins = document.getElementById('insights');
  ins.innerHTML = '';

  if (state.pma === 'all') {
    const overlap = computeOverlaps();
    const overlapList = Object.entries(overlap).slice(0, 5);
    ins.innerHTML += `
      <div class="insight">
        <div class="insight-title"><div class="insight-dot" style="background:#FFDB00"></div>Postal code overlaps</div>
        <b>${Object.keys(overlap).length} postal codes</b> are covered by 2+ PMAs. Consolidating these into a single PMA's plan could reduce redundant truck-hours.
        <div style="margin-top:6px">${overlapList.map(([cp,p])=>`<code>${cp}</code> ${p.join('+')}`).join(' · ')}${Object.keys(overlap).length > 5 ? ' …' : ''}
      </div></div>
      <div class="insight">
        <div class="insight-title"><div class="insight-dot" style="background:#0058A3"></div>Service overlap (Saint-Étienne)</div>
        Saint-Étienne runs <b>3 services</b> (CCD/LCD/LCDI). LCDI covers Lyon CPs that Lyon PMA already serves — candidate for handover.
      </div>
      <div class="insight">
        <div class="insight-title"><div class="insight-dot" style="background:#0A8754"></div>Grenoble TA02 = TA04</div>
        Grenoble's source file lists <b>TA04 with the exact same CPs as TA02</b> — likely a duplicate slot in the schedule, not a separate distance band.
      </div>
    `;
    return;
  }

  // Per-PMA insights: outliers (>1.5x avg dist), zone density
  const zones = getCurrentZones();
  const store = getCurrentStore();
  const distances = [];
  for (const [zoneName, z] of Object.entries(zones)) {
    for (const cp of z.cps) {
      const c = cpCoords[String(cp).padStart(5,'0')];
      if (!c) continue;
      distances.push({ cp, zone: zoneName, dist: haversine(store.lat, store.lng, c.lat, c.lng), name: c.name });
    }
  }
  if (!distances.length) {
    ins.innerHTML = `<div class="insight">Loading geometry…</div>`;
    return;
  }
  distances.sort((a,b) => b.dist - a.dist);
  const avg = distances.reduce((a,d)=>a+d.dist,0) / distances.length;
  const outliers = distances.filter(d => d.dist > avg * 1.6).slice(0, 5);

  ins.innerHTML += `
    <div class="insight">
      <div class="insight-title"><div class="insight-dot" style="background:#E04E2C"></div>Far-out postal codes</div>
      Top distance outliers (>1.6× average of <b>${Math.round(avg)} km</b>):
      <div style="margin-top:6px">${outliers.map(o=>`<code>${o.cp}</code> ${o.zone} — ${Math.round(o.dist)} km`).join('<br>')}</div>
    </div>
  `;

  // Zone density: small zones with few CPs
  const small = Object.entries(zones).filter(([n,z]) => z.cps.length <= 3);
  if (small.length) {
    ins.innerHTML += `
      <div class="insight">
        <div class="insight-title"><div class="insight-dot" style="background:#F18B00"></div>Small TAs</div>
        ${small.map(([n,z]) => `<code>${n}</code> has only <b>${z.cps.length}</b> CPs`).join(' · ')}. Consider merging into a neighboring TA to reduce route complexity.
      </div>
    `;
  }

  // Cross-department spread — how many depts per zone (a TA spanning 4+ depts is hard to route)
  const spread = [];
  for (const [name, z] of Object.entries(zones)) {
    const depts = new Set(z.cps.map(cp => String(cp).padStart(5,'0').slice(0,2)));
    if (depts.size >= 4) spread.push({ name, depts: depts.size, list: [...depts].join(', ') });
  }
  if (spread.length) {
    ins.innerHTML += `
      <div class="insight">
        <div class="insight-title"><div class="insight-dot" style="background:#7B3F99"></div>Multi-département TAs</div>
        ${spread.map(s => `<code>${s.name}</code> spans <b>${s.depts}</b> départements (${s.list})`).join('<br>')}
      </div>
    `;
  }
}

// ===== Tweaks panel =====
function setupTweaks() {
  // Listen for activate/deactivate
  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || !data.type) return;
    if (data.type === '__activate_edit_mode') showTweaks();
    if (data.type === '__deactivate_edit_mode') hideTweaks();
  });
  window.parent.postMessage({ type: '__edit_mode_available' }, '*');
}

function showTweaks() {
  let panel = document.getElementById('tweaks-panel');
  if (panel) { panel.style.display = ''; return; }
  panel = document.createElement('div');
  panel.id = 'tweaks-panel';
  panel.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; width: 280px;
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 12px; padding: 16px; z-index: 9000;
    box-shadow: 0 8px 32px rgba(0,0,0,0.16); font-size: 13px;
  `;
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <b style="font-size:14px">Tweaks</b>
      <button id="tw-close" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--ink-3)">×</button>
    </div>
    <label style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;cursor:pointer">
      <span>Show radius rings</span>
      <input type="checkbox" id="tw-rings" ${state.showRadiusRings ? 'checked' : ''}>
    </label>
    <label style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;cursor:pointer">
      <span>Dark map theme</span>
      <input type="checkbox" id="tw-dark" ${state.theme==='dark' ? 'checked' : ''}>
    </label>
    <div style="margin:12px 0 4px;color:var(--ink-3);font-size:11px;text-transform:uppercase;letter-spacing:0.06em;font-weight:700">Render mode</div>
    <div style="display:flex;gap:4px">
      ${['markers','zones','heat'].map(m => `<button class="tw-mode" data-m="${m}" style="flex:1;padding:6px;border:1px solid var(--line);background:${state.mode===m?'var(--ikea-blue)':'var(--bg)'};color:${state.mode===m?'#fff':'var(--ink-2)'};border-radius:6px;font-size:12px;cursor:pointer;font-weight:600">${m}</button>`).join('')}
    </div>
  `;
  document.body.appendChild(panel);
  panel.querySelector('#tw-close').onclick = () => { hideTweaks(); window.parent.postMessage({type:'__edit_mode_dismissed'},'*'); };
  panel.querySelector('#tw-rings').onchange = (e) => { state.showRadiusRings = e.target.checked; renderPMA(); };
  panel.querySelector('#tw-dark').onchange = (e) => {
    state.theme = e.target.checked ? 'dark' : 'light';
    document.documentElement.dataset.theme = state.theme;
  };
  panel.querySelectorAll('.tw-mode').forEach(b => b.onclick = () => {
    state.mode = b.dataset.m;
    document.querySelectorAll('.mode-btn').forEach(x => x.classList.toggle('active', x.dataset.mode === state.mode));
    renderPMA();
    showTweaks(); // refresh button states
    document.getElementById('tweaks-panel').remove();
    showTweaks();
  });
}
function hideTweaks() {
  const p = document.getElementById('tweaks-panel');
  if (p) p.style.display = 'none';
}

// ===== Wire up =====
function wireUp() {
  document.querySelectorAll('.pma-tab').forEach(b => {
    b.onclick = () => {
      state.pma = b.dataset.pma;
      state.hiddenZones.clear();
      renderUI();
      renderPMA();
    };
  });
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.onclick = () => {
      state.mode = b.dataset.mode;
      document.querySelectorAll('.mode-btn').forEach(x => x.classList.toggle('active', x === b));
      renderPMA();
    };
  });
}

// ===== Boot =====
(async () => {
  initMap();
  wireUp();
  setupTweaks();
  await loadCpCoords();
  document.getElementById('loading').style.display = 'none';
  renderUI();
  renderPMA();
})();
