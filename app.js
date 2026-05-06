// ============================================================
// IKEA PMA — Cartographie multi-flux
// Modèle : Store/LSC × PMA × Flux × CP × TA
// ============================================================

const M = window.PMA_MAPPINGS;
const PMA_LIST = window.PMA_LIST;
const FLUX_LIST = window.FLUX_LIST;
const PMA_COLORS = window.PMA_COLORS;
const FLUX_COLORS = window.FLUX_COLORS;
const ZONE_COLORS = window.ZONE_COLORS;

const FLUX_DESC = {
  CCD: "Central Customer Delivery — depuis CDC via LSC",
  LCDD: "Local Customer Delivery Direct — départ magasin direct",
  LCDI: "Local Customer Delivery Indirect — magasin → LSC → client",
};

// ============================================================
// État global
// ============================================================
let state = {
  selectedPMAs: new Set(["Lyon"]),
  enabledFlux: new Set(["CCD", "LCDD", "LCDI"]),
  zoneFilter: "all",
  unit: "cp",
  mode: "polygons",
  basemap: "light",
  speedKmh: 65,
};

// ============================================================
// Données runtime
// ============================================================
let map;
let baseLayers = {};
let layers = { polygons: [], markers: [], heat: null, stores: [], rings: [] };
let cpData = {};
let flowsByCP = {};

// ============================================================
// Bootstrap
// ============================================================
(async () => {
  initMap();
  wireUI();
  buildFlowsIndex();
  await loadCPGeometry();
  document.getElementById("loading").style.display = "none";
  renderAll();
})();

// ============================================================
// Index inverse CP → flux
// ============================================================
function buildFlowsIndex() {
  flowsByCP = {};
  for (const flow of M.flows) {
    for (const [zoneName, zone] of Object.entries(flow.zones)) {
      for (const cp of zone.cps) {
        const k = String(cp).trim().padStart(5, "0");
        if (!flowsByCP[k]) flowsByCP[k] = [];
        flowsByCP[k].push({ flow, zoneName, zoneLabel: zone.label });
      }
    }
  }
}

// ============================================================
// Carte
// ============================================================
function initMap() {
  map = L.map("map", { zoomControl: true, preferCanvas: false }).setView([45.6, 5.0], 8);

  baseLayers.light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains: "abcd", maxZoom: 19,
  });
  baseLayers.terrain = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenTopoMap (CC-BY-SA)", maxZoom: 17,
  });
  baseLayers.dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains: "abcd", maxZoom: 19,
  });
  baseLayers.light.addTo(map);
}

function setBasemap(name) {
  for (const k in baseLayers) map.removeLayer(baseLayers[k]);
  baseLayers[name].addTo(map);
  state.basemap = name;
}

// ============================================================
// Géométrie CP (api.geo.gouv.fr)
// ============================================================
function setLoadingMsg(msg, pct) {
  document.getElementById("loading-msg").textContent = msg;
  if (pct !== undefined) document.getElementById("loading-bar").style.width = pct + "%";
}

function gatherAllCPs() {
  const all = new Set();
  for (const flow of M.flows) {
    for (const z of Object.values(flow.zones)) {
      z.cps.forEach((cp) => all.add(String(cp).trim().padStart(5, "0")));
    }
  }
  return [...all];
}

async function loadCPGeometry() {
  const cps = gatherAllCPs();
  setLoadingMsg(`Chargement de ${cps.length} codes postaux…`, 0);

  const batchSize = 25;
  let done = 0;
  for (let i = 0; i < cps.length; i += batchSize) {
    const batch = cps.slice(i, i + batchSize);
    await Promise.all(batch.map(async (cp) => {
      try {
        const r = await fetch(
          `https://geo.api.gouv.fr/communes?codePostal=${cp}&fields=nom,code,centre,contour,population&format=json&geometry=contour`
        );
        if (!r.ok) return;
        const data = await r.json();
        if (!data.length) return;
        const polys = [];
        let lat = 0, lng = 0, n = 0, pop = 0;
        let firstName = "";
        for (const c of data) {
          if (c.contour && c.contour.coordinates) polys.push(c.contour);
          if (c.centre && c.centre.coordinates) {
            lng += c.centre.coordinates[0];
            lat += c.centre.coordinates[1];
            n++;
          }
          if (typeof c.population === "number") pop += c.population;
          if (!firstName) firstName = c.nom;
        }
        if (n) {
          cpData[cp] = {
            lat: lat / n,
            lng: lng / n,
            name: data.length > 1 ? `${firstName} (+${data.length - 1})` : firstName,
            polygons: polys,
            communes: data.map((c) => c.nom),
            population: pop,
          };
        }
      } catch (e) {}
    }));
    done += batch.length;
    setLoadingMsg(`Chargement codes postaux… ${done}/${cps.length}`, (done / cps.length) * 100);
  }
}

// ============================================================
// Helpers
// ============================================================
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatTime(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}min`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

function formatNum(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("fr-FR");
}

function principalStoreFor(pmaName) {
  return Object.values(M.stores).find((s) => s.pma === pmaName);
}

function timeZone(hours) {
  if (hours == null) return null;
  const min = hours * 60;
  if (min <= 45) return "1";
  if (min <= 60) return "2";
  if (min <= 110) return "3";
  return "4";
}

// ============================================================
// Aggregation : visible flows = sélection PMA × flux activés
// ============================================================
function visibleFlows() {
  return M.flows.filter(
    (f) => state.selectedPMAs.has(f.pma) && state.enabledFlux.has(f.flux)
  );
}

function buildVisibleCPRecords() {
  const out = [];
  for (const flow of visibleFlows()) {
    const store = M.stores[flow.storeCode];
    for (const [zoneName, zone] of Object.entries(flow.zones)) {
      for (const cp of zone.cps) {
        const k = String(cp).trim().padStart(5, "0");
        const d = cpData[k];
        if (!d) continue;
        const dist = haversine(store.lat, store.lng, d.lat, d.lng);
        const time = dist / state.speedKmh;
        const tz = timeZone(time);
        if (state.zoneFilter !== "all" && tz !== state.zoneFilter) continue;
        out.push({
          cp: k,
          name: d.name,
          lat: d.lat,
          lng: d.lng,
          population: d.population || 0,
          flow,
          zoneName,
          zoneLabel: zone.label,
          store,
          dist,
          time,
          timeZone: tz,
          polygons: d.polygons,
        });
      }
    }
  }
  return out;
}

function dedupeRecords(records) {
  const seen = new Set();
  const out = [];
  for (const r of records) {
    if (seen.has(r.cp)) continue;
    seen.add(r.cp);
    out.push(r);
  }
  return out;
}

// ============================================================
// Couleur d'un record selon l'unité affichée
// ============================================================
let popMin, popMax, distMin, distMax, timeMin, timeMax;

function computeScales(records) {
  if (!records.length) {
    popMin = 0; popMax = 1; distMin = 0; distMax = 1; timeMin = 0; timeMax = 1; return;
  }
  popMin = Math.min(...records.map((r) => r.population));
  popMax = Math.max(...records.map((r) => r.population));
  distMin = Math.min(...records.map((r) => r.dist));
  distMax = Math.max(...records.map((r) => r.dist));
  timeMin = Math.min(...records.map((r) => r.time));
  timeMax = Math.max(...records.map((r) => r.time));
}

function colorForRecord(r, unit) {
  if (unit === "cp" || unit === "zone") {
    return ZONE_COLORS[r.timeZone] || "#999";
  }
  if (unit === "population") return scaleColor(r.population, popMin, popMax, ["#FFE5C2", "#F18B00", "#7B0E00"]);
  if (unit === "distance") return scaleColor(r.dist, distMin, distMax, ["#0A8754", "#FFDB00", "#E04E2C"]);
  if (unit === "time") return scaleColor(r.time, timeMin, timeMax, ["#0A8754", "#FFDB00", "#E04E2C"]);
  return PMA_COLORS[r.flow.pma] || "#0058A3";
}

function scaleColor(v, min, max, palette) {
  if (max - min < 1e-6) return palette[0];
  const t = (v - min) / (max - min);
  if (t < 0.5) return lerpHex(palette[0], palette[1], t * 2);
  return lerpHex(palette[1], palette[2], (t - 0.5) * 2);
}

function lerpHex(a, b, t) {
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 255, ag = (ah >> 8) & 255, ab = ah & 255;
  const br = (bh >> 16) & 255, bg = (bh >> 8) & 255, bb = bh & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const b2 = Math.round(ab + (bb - ab) * t);
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b2).toString(16).slice(1);
}

// ============================================================
// Rendu carte
// ============================================================
function clearMapLayers() {
  for (const k of ["polygons", "markers", "rings", "stores"]) {
    layers[k].forEach((l) => map.removeLayer(l));
    layers[k] = [];
  }
  if (layers.heat) { map.removeLayer(layers.heat); layers.heat = null; }
}

function renderMap(records) {
  clearMapLayers();
  computeScales(records);

  const unique = dedupeRecords(records);
  const allBounds = [];

  // Stores actifs
  const activeStores = new Set();
  for (const flow of visibleFlows()) activeStores.add(flow.storeCode);
  for (const code of activeStores) {
    const s = M.stores[code];
    const color = PMA_COLORS[s.pma];
    const icon = L.divIcon({
      className: "",
      html: `<div class="store-pin" style="background:${color}"><span>${s.code}</span></div>`,
      iconSize: [38, 38], iconAnchor: [19, 38],
    });
    const marker = L.marker([s.lat, s.lng], { icon, zIndexOffset: 1000 })
      .bindPopup(`<div class="cp-popup"><b>${s.name}</b><br><small>Code ${s.code} · CP ${s.cp}</small><br><small>PMA ${s.pma}</small></div>`)
      .addTo(map);
    layers.stores.push(marker);

    [25, 50, 100].forEach((rkm) => {
      layers.rings.push(L.circle([s.lat, s.lng], {
        radius: rkm * 1000, color, weight: 1, opacity: 0.35,
        fillOpacity: 0.02, dashArray: "4 6", interactive: false,
      }).addTo(map));
    });
  }

  // CPs
  if (state.mode === "heat") {
    const pts = unique.map((r) => [r.lat, r.lng, state.unit === "population" ? Math.min(1, r.population / 50000) : 0.6]);
    if (pts.length && L.heatLayer) {
      layers.heat = L.heatLayer(pts, {
        radius: 28, blur: 28, maxZoom: 12,
        gradient: { 0.2: "#0058A3", 0.4: "#00A6B4", 0.6: "#FFDB00", 0.8: "#F18B00", 1: "#E04E2C" },
      }).addTo(map);
    }
    unique.forEach((r) => allBounds.push(L.latLng(r.lat, r.lng)));
  } else if (state.mode === "polygons") {
    for (const r of unique) {
      const color = colorForRecord(r, state.unit);
      const flowsForCP = flowsByCP[r.cp] || [];
      const pmasForCP = new Set(flowsForCP.map((x) => x.flow.pma));
      const isOverlap = pmasForCP.size > 1;
      for (const poly of r.polygons) {
        const layer = L.geoJSON(poly, {
          style: {
            color: isOverlap ? "#FFDB00" : "#FFFFFF",
            weight: isOverlap ? 2 : 0.8,
            fillColor: color,
            fillOpacity: 0.65,
          },
        })
          .bindPopup(buildPopup(r))
          .on("mouseover", (e) => e.target.setStyle({ weight: 2.5, fillOpacity: 0.85 }))
          .on("mouseout", (e) => e.target.setStyle({ weight: isOverlap ? 2 : 0.8, fillOpacity: 0.65 }))
          .addTo(map);
        layers.polygons.push(layer);
        const b = layer.getBounds();
        if (b.isValid()) allBounds.push(b);
      }
    }
  } else if (state.mode === "markers") {
    for (const r of unique) {
      const color = colorForRecord(r, state.unit);
      const radius = state.unit === "population"
        ? 4 + Math.sqrt(r.population) / 30
        : state.unit === "distance"
          ? 4 + r.dist / 20
          : 7;
      const m = L.circleMarker([r.lat, r.lng], {
        radius: Math.min(radius, 18),
        fillColor: color, color: "#fff", weight: 1.5, fillOpacity: 0.9,
      }).bindPopup(buildPopup(r)).addTo(map);
      layers.markers.push(m);
      allBounds.push(L.latLng(r.lat, r.lng));
    }
  }

  if (allBounds.length) {
    const valid = allBounds.filter((b) => b instanceof L.LatLngBounds ? b.isValid() : true);
    if (valid.length) {
      const init = valid[0] instanceof L.LatLngBounds ? valid[0] : L.latLngBounds(valid[0], valid[0]);
      const merged = valid.reduce((acc, b) => acc.extend(b), init);
      map.fitBounds(merged.pad(0.05));
    }
  }
}

function buildPopup(r) {
  const flowsForCP = flowsByCP[r.cp] || [];
  const flowList = flowsForCP.map((f) =>
    `<div style="display:flex;align-items:center;gap:6px;font-size:11px;margin-top:2px"><span style="width:8px;height:8px;border-radius:50%;background:${FLUX_COLORS[f.flow.flux]}"></span>${f.flow.flux} · ${f.flow.pma} <small style="color:var(--ink-3)">(${f.zoneName})</small></div>`
  ).join("");
  return `<div class="cp-popup">
    <b>${r.cp}</b> · ${r.name || ""}<br>
    <span class="ta-tag" style="background:${ZONE_COLORS[r.timeZone] || "#777"}">Zone TA${r.timeZone || "?"} · ${r.zoneName}</span>
    <table>
      <tr><td>Magasin</td><td>${r.store.name.replace("IKEA ", "")}</td></tr>
      <tr><td>Distance</td><td>${Math.round(r.dist)} km</td></tr>
      <tr><td>Temps trajet</td><td>${formatTime(r.time)}</td></tr>
      <tr><td>Population</td><td>${formatNum(r.population)}</td></tr>
    </table>
    <div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--line);font-weight:700;font-size:11px">Flux disponibles</div>
    ${flowList}
  </div>`;
}

// ============================================================
// UI : panneau gauche
// ============================================================
function renderPMAPicker() {
  const box = document.getElementById("pma-picker");
  box.innerHTML = "";
  for (const pma of PMA_LIST) {
    const active = state.selectedPMAs.has(pma);
    const store = principalStoreFor(pma);
    const cps = new Set();
    for (const f of M.flows) if (f.pma === pma) for (const z of Object.values(f.zones)) z.cps.forEach((c) => cps.add(String(c).trim().padStart(5, "0")));
    const row = document.createElement("div");
    row.className = "pma-chip" + (active ? " active" : "");
    row.innerHTML = `
      <div class="pma-chip-dot" style="background:${PMA_COLORS[pma]}"></div>
      <div style="flex:1;min-width:0">
        <div class="pma-chip-name">${pma}</div>
        <div class="pma-chip-meta">${store ? `Store ${store.code}` : ""} · ${cps.size} CP</div>
      </div>
      <div class="check"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8 L7 12 L13 4"/></svg></div>
    `;
    row.onclick = () => {
      if (active) state.selectedPMAs.delete(pma);
      else state.selectedPMAs.add(pma);
      if (state.selectedPMAs.size === 0) state.selectedPMAs.add(pma);
      renderAll();
    };
    box.appendChild(row);
  }
  document.getElementById("pma-count").textContent = state.selectedPMAs.size;
}

function renderFluxList() {
  const box = document.getElementById("flux-list");
  box.innerHTML = "";
  for (const flux of FLUX_LIST) {
    let cpsForFlux = new Set();
    for (const f of M.flows) {
      if (f.flux !== flux || !state.selectedPMAs.has(f.pma)) continue;
      for (const z of Object.values(f.zones)) z.cps.forEach((c) => cpsForFlux.add(String(c).trim().padStart(5, "0")));
    }
    const enabled = state.enabledFlux.has(flux);
    const row = document.createElement("div");
    row.className = "flux-row" + (enabled ? "" : " disabled");
    row.innerHTML = `
      <input type="checkbox" ${enabled ? "checked" : ""} style="accent-color:${FLUX_COLORS[flux]};width:14px;height:14px;cursor:pointer">
      <div class="flux-dot" style="background:${FLUX_COLORS[flux]}"></div>
      <div style="flex:1">
        <div class="flux-name">${flux}</div>
        <div class="flux-desc">${FLUX_DESC[flux]}</div>
      </div>
      <div class="flux-count">${cpsForFlux.size}</div>
    `;
    row.onclick = () => {
      if (enabled) state.enabledFlux.delete(flux);
      else state.enabledFlux.add(flux);
      if (state.enabledFlux.size === 0) state.enabledFlux.add(flux);
      renderAll();
    };
    box.appendChild(row);
  }
}

// ============================================================
// UI : overlay carte
// ============================================================
function renderOverlay(records) {
  const t = document.getElementById("overlay-title");
  const m = document.getElementById("overlay-meta");

  if (state.selectedPMAs.size === 0) {
    t.textContent = "Aucune PMA sélectionnée";
    m.textContent = "Cochez une ou plusieurs PMA dans le panneau de gauche";
    return;
  }
  const unique = dedupeRecords(records);
  const totalPop = unique.reduce((a, r) => a + r.population, 0);
  const overlapCount = unique.filter((r) => {
    const flowsForCP = flowsByCP[r.cp] || [];
    return new Set(flowsForCP.map((x) => x.flow.pma)).size > 1;
  }).length;
  t.textContent = `${[...state.selectedPMAs].join(" · ")}`;
  m.innerHTML = `<b>${unique.length}</b> CP · <b>${formatNum(totalPop)}</b> hab. · <b>${overlapCount}</b> en doublon inter-PMAs · ${[...state.enabledFlux].join("/")}`;
}

// ============================================================
// UI : panneau droit (synthèse)
// ============================================================
function renderRightPanel(records) {
  const grid = document.getElementById("stat-grid");
  const unique = dedupeRecords(records);
  const totalPop = unique.reduce((a, r) => a + r.population, 0);
  const distAvg = unique.length ? unique.reduce((a, r) => a + r.dist, 0) / unique.length : 0;
  const distMaxVal = unique.reduce((a, r) => Math.max(a, r.dist), 0);
  const timeAvg = distAvg / state.speedKmh;

  grid.innerHTML = `
    <div class="stat-card"><div class="stat-num">${unique.length}</div><div class="stat-label">Codes postaux</div></div>
    <div class="stat-card"><div class="stat-num">${formatNum(totalPop)}</div><div class="stat-label">Population</div></div>
    <div class="stat-card"><div class="stat-num">${Math.round(distAvg)}<small style="font-size:11px;color:var(--ink-3)"> km</small></div><div class="stat-label">Distance moy.</div></div>
    <div class="stat-card"><div class="stat-num">${formatTime(timeAvg)}</div><div class="stat-label">Temps moy.</div></div>
    <div class="stat-card"><div class="stat-num">${Math.round(distMaxVal)}<small style="font-size:11px;color:var(--ink-3)"> km</small></div><div class="stat-label">Distance max</div></div>
    <div class="stat-card"><div class="stat-num">${records.length}</div><div class="stat-label">Affectations (CP×flux)</div></div>
  `;

  // Bar chart TA
  const taCount = { 1: 0, 2: 0, 3: 0, 4: 0 };
  unique.forEach((r) => { if (r.timeZone) taCount[r.timeZone]++; });
  const total = unique.length || 1;
  const bar = document.getElementById("bar-chart");
  bar.innerHTML = "";
  for (const z of ["1", "2", "3", "4"]) {
    if (taCount[z] === 0 && z === "4") continue;
    const pct = (taCount[z] / total) * 100;
    bar.innerHTML += `<div class="bar-row">
      <div class="bar-label">TA${z}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${ZONE_COLORS[z] || "#888"}"></div></div>
      <div class="bar-val">${taCount[z]} <small style="color:var(--ink-3);font-weight:400">·${pct.toFixed(0)}%</small></div>
    </div>`;
  }

  // Bar chart flux
  const fluxCount = {};
  for (const r of records) fluxCount[r.flow.flux] = (fluxCount[r.flow.flux] || 0) + 1;
  const flux = document.getElementById("flux-chart");
  flux.innerHTML = "";
  const fluxTotal = records.length || 1;
  for (const f of FLUX_LIST) {
    const n = fluxCount[f] || 0;
    if (!n) continue;
    const pct = (n / fluxTotal) * 100;
    flux.innerHTML += `<div class="bar-row">
      <div class="bar-label">${f}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${FLUX_COLORS[f]}"></div></div>
      <div class="bar-val">${n} <small style="color:var(--ink-3);font-weight:400">·${pct.toFixed(0)}%</small></div>
    </div>`;
  }
}

function renderInsights(records) {
  const ins = document.getElementById("insights");
  ins.innerHTML = "";

  const unique = dedupeRecords(records);

  // Insight 1 : CP en doublon inter-PMAs
  const overlap = unique.filter((r) => {
    const flowsForCP = flowsByCP[r.cp] || [];
    const pmas = new Set(flowsForCP.map((x) => x.flow.pma));
    return pmas.size > 1;
  });
  if (overlap.length) {
    const sample = overlap.slice(0, 5).map((r) => {
      const pmas = [...new Set((flowsByCP[r.cp] || []).map((x) => x.flow.pma))];
      return `<code style="background:var(--panel);padding:1px 4px;border-radius:3px;border:1px solid var(--line);font-family:monospace">${r.cp}</code> ${pmas.join(" + ")}`;
    }).join("<br>");
    ins.innerHTML += `
      <div class="insight">
        <div class="insight-title"><div class="insight-dot" style="background:#FFDB00"></div>${overlap.length} CP servis par plusieurs PMAs</div>
        ${sample}${overlap.length > 5 ? "<br>…" : ""}
        <div style="margin-top:6px;font-size:10px;color:var(--ink-3)">Opportunité : rationaliser l'affectation pour éviter les heures-camion redondantes.</div>
      </div>
    `;
  }

  // Insight 2 : CP mal affectés (autre store IKEA plus proche)
  const stores = Object.values(M.stores);
  const misroutings = [];
  for (const r of unique) {
    let bestStore = r.store, bestDist = r.dist;
    for (const s of stores) {
      if (s.code === r.store.code) continue;
      const d = haversine(s.lat, s.lng, r.lat, r.lng);
      if (d < bestDist - 10) { bestDist = d; bestStore = s; }
    }
    if (bestStore.code !== r.store.code) {
      misroutings.push({ ...r, bestStore, bestDist, gain: r.dist - bestDist });
    }
  }
  misroutings.sort((a, b) => b.gain - a.gain);
  if (misroutings.length) {
    const top = misroutings.slice(0, 4).map((m) =>
      `<code>${m.cp}</code> ${m.store.pma}→<b>${m.bestStore.pma}</b> · gain ${Math.round(m.gain)} km`
    ).join("<br>");
    ins.innerHTML += `
      <div class="insight">
        <div class="insight-title"><div class="insight-dot" style="background:#E04E2C"></div>${misroutings.length} CP plus proches d'un autre magasin</div>
        ${top}${misroutings.length > 4 ? "<br>…" : ""}
        <div style="margin-top:6px;font-size:10px;color:var(--ink-3)">Total gain potentiel : <b>${Math.round(misroutings.reduce((a, m) => a + m.gain, 0))} km</b> par tournée hebdomadaire.</div>
      </div>
    `;
  }

  // Insight 3 : flux LCDI inter-PMA
  const crossPMALCDI = records.filter((r) => {
    const storePMA = M.stores[r.flow.storeCode].pma;
    return r.flow.flux === "LCDI" && storePMA !== r.flow.pma;
  });
  if (crossPMALCDI.length) {
    const grouped = {};
    for (const r of crossPMALCDI) {
      const key = `${r.flow.storeCode} → ${r.flow.pma}`;
      grouped[key] = (grouped[key] || 0) + 1;
    }
    const lines = Object.entries(grouped).map(([k, v]) => `<code>${k}</code> · ${v} CP`).join("<br>");
    ins.innerHTML += `
      <div class="insight">
        <div class="insight-title"><div class="insight-dot" style="background:#7B3F99"></div>Flux LCDI inter-PMA</div>
        ${lines}
        <div style="margin-top:6px;font-size:10px;color:var(--ink-3)">Fulfilment d'un magasin vers la zone d'un autre, via LSC en transit.</div>
      </div>
    `;
  }

  // Insight 4 : déséquilibre TA
  const taCount = {};
  unique.forEach((r) => { if (r.timeZone) taCount[r.timeZone] = (taCount[r.timeZone] || 0) + 1; });
  if (taCount["3"] && taCount["1"] && taCount["3"] > taCount["1"]) {
    ins.innerHTML += `
      <div class="insight">
        <div class="insight-title"><div class="insight-dot" style="background:#F18B00"></div>Déséquilibre TA</div>
        TA3 (60-110 min) contient <b>${taCount["3"]}</b> CP contre <b>${taCount["1"]}</b> en TA1. Le PMA pourrait avoir une couronne périphérique surdimensionnée.
      </div>
    `;
  }

  if (!ins.innerHTML) ins.innerHTML = `<div class="insight" style="color:var(--ink-3);font-size:11px">Aucune piste d'optimisation détectée pour cette sélection.</div>`;
}

// ============================================================
// Tableaux par dépôt (panneau bas)
// ============================================================
function renderDeptTables(records) {
  const panel = document.getElementById("dept-panel");
  panel.innerHTML = "";

  const byStore = {};
  for (const r of records) {
    const k = r.store.code;
    if (!byStore[k]) byStore[k] = [];
    byStore[k].push(r);
  }

  const storeCodes = Object.keys(byStore);
  if (!storeCodes.length) {
    panel.innerHTML = `<div class="empty" style="grid-column:1/-1;padding:40px">Aucune affectation à afficher.</div>`;
    return;
  }

  for (const code of storeCodes.sort()) {
    const recs = byStore[code];
    const store = M.stores[code];
    const totalPop = recs.reduce((a, r) => a + r.population, 0);
    const uniqCPs = new Set(recs.map((r) => r.cp)).size;

    const col = document.createElement("div");
    col.className = "dept-col";

    const headHTML = `
      <div class="dept-header">
        <div class="dept-title">
          <div class="dept-title-dot" style="background:${PMA_COLORS[store.pma]}"></div>
          DÉPART ${store.pma.toUpperCase()} <small style="color:var(--ink-3);font-weight:600">· ${store.code}</small>
        </div>
        <div class="dept-meta">${recs.length} aff. · ${uniqCPs} CP</div>
      </div>
    `;

    recs.sort((a, b) => a.cp.localeCompare(b.cp));

    let bodyHTML = `<div class="dept-table"><table><thead><tr>
      <th>CP</th><th>Commune</th><th>TA</th><th>PMA</th><th>Flux</th>
      <th style="text-align:right">Pop.</th><th style="text-align:right">km</th><th style="text-align:right">temps</th>
    </tr></thead><tbody>`;

    for (const r of recs) {
      bodyHTML += `<tr data-cp="${r.cp}" data-lat="${r.lat}" data-lng="${r.lng}">
        <td><b>${r.cp}</b></td>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.name || ""}">${r.name || "—"}</td>
        <td><span class="ta-pill" style="background:${ZONE_COLORS[r.timeZone] || "#888"}">TA${r.timeZone || "?"}</span></td>
        <td><span class="pma-pill" style="border-color:${PMA_COLORS[r.flow.pma]};color:${PMA_COLORS[r.flow.pma]}">${r.flow.pma}</span></td>
        <td><span class="pma-pill" style="border-color:${FLUX_COLORS[r.flow.flux]};color:${FLUX_COLORS[r.flow.flux]}">${r.flow.flux}</span></td>
        <td style="text-align:right">${formatNum(r.population)}</td>
        <td style="text-align:right">${Math.round(r.dist)}</td>
        <td style="text-align:right">${formatTime(r.time)}</td>
      </tr>`;
    }
    bodyHTML += `</tbody></table></div>`;

    const footHTML = `
      <div class="dept-foot">
        <span>Total</span>
        <span>${formatNum(totalPop)} hab.</span>
      </div>
    `;

    col.innerHTML = headHTML + bodyHTML + footHTML;
    panel.appendChild(col);

    col.querySelectorAll("tbody tr").forEach((tr) => {
      tr.onclick = () => {
        const lat = parseFloat(tr.dataset.lat), lng = parseFloat(tr.dataset.lng);
        map.flyTo([lat, lng], 12, { duration: 0.6 });
      };
    });
  }

  panel.style.gridTemplateColumns = `repeat(${storeCodes.length}, 1fr)`;
}

// ============================================================
// Recherche CP
// ============================================================
function setupSearch() {
  const input = document.getElementById("cp-search");
  let drop;
  input.addEventListener("input", () => {
    const q = input.value.trim();
    if (drop) { drop.remove(); drop = null; }
    if (q.length < 2) return;
    const matches = Object.keys(cpData).filter((cp) => cp.startsWith(q)).slice(0, 8);
    if (!matches.length) return;
    drop = document.createElement("div");
    drop.className = "cp-results";
    for (const cp of matches) {
      const d = cpData[cp];
      const flows = flowsByCP[cp] || [];
      const pmas = [...new Set(flows.map((x) => x.flow.pma))];
      const it = document.createElement("div");
      it.className = "cp-result-item";
      it.innerHTML = `<b>${cp}</b> · ${d.name}<small>PMA : ${pmas.join(", ") || "—"} · ${flows.length} flux</small>`;
      it.onclick = () => {
        map.flyTo([d.lat, d.lng], 12, { duration: 0.6 });
        drop.remove(); drop = null;
        input.value = "";
      };
      drop.appendChild(it);
    }
    document.querySelector(".header-tools").appendChild(drop);
  });
  document.addEventListener("click", (e) => {
    if (drop && !drop.contains(e.target) && e.target !== input) { drop.remove(); drop = null; }
  });
}

// ============================================================
// Export CSV
// ============================================================
function exportCSV() {
  const records = buildVisibleCPRecords();
  const rows = [
    ["CP", "Commune", "PMA", "Flux", "Store", "Zone", "TA(temps)", "Population", "Distance_km", "Temps_h", "Lat", "Lng"]
  ];
  for (const r of records) {
    rows.push([
      r.cp,
      (r.name || "").replace(/[",]/g, " "),
      r.flow.pma,
      r.flow.flux,
      r.store.code,
      r.zoneName,
      r.timeZone || "",
      r.population,
      Math.round(r.dist),
      r.time.toFixed(2),
      r.lat.toFixed(5),
      r.lng.toFixed(5),
    ]);
  }
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pma-${[...state.selectedPMAs].join("-")}-${[...state.enabledFlux].join("-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Câblage UI
// ============================================================
function wireUI() {
  document.querySelectorAll(".mode-btn").forEach((b) => {
    b.onclick = () => {
      state.mode = b.dataset.mode;
      document.querySelectorAll(".mode-btn").forEach((x) => x.classList.toggle("active", x === b));
      renderAll();
    };
  });
  document.querySelectorAll(".basemap-btn").forEach((b) => {
    b.onclick = () => {
      setBasemap(b.dataset.base);
      document.querySelectorAll(".basemap-btn").forEach((x) => x.classList.toggle("active", x === b));
    };
  });
  document.querySelectorAll(".unit-tab").forEach((b) => {
    b.onclick = () => {
      state.unit = b.dataset.unit;
      document.querySelectorAll(".unit-tab").forEach((x) => x.classList.toggle("active", x === b));
      renderAll();
    };
  });
  document.querySelectorAll("#zone-filter-tabs .sub-tab").forEach((b) => {
    b.onclick = () => {
      state.zoneFilter = b.dataset.zone;
      document.querySelectorAll("#zone-filter-tabs .sub-tab").forEach((x) => x.classList.toggle("active", x === b));
      renderAll();
    };
  });

  document.getElementById("export-csv").onclick = exportCSV;
  setupSearch();
}

// ============================================================
// Render principal
// ============================================================
function renderAll() {
  renderPMAPicker();
  renderFluxList();
  const records = buildVisibleCPRecords();
  renderMap(records);
  renderOverlay(records);
  renderRightPanel(records);
  renderInsights(records);
  renderDeptTables(records);
}
