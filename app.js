/* 防災ダッシュボード prototype */
'use strict';

const $ = (s) => document.querySelector(s);

const state = {
  mode: 'current',          // 'current' | spot id
  loc: null,                // {lat, lon}
  place: null,              // {pref, city, detail}
  quakes: [],
  tsunami: null,
};

const SCALE = { 10:'1', 20:'2', 30:'3', 40:'4', 45:'5弱', 50:'5強', 55:'6弱', 60:'6強', 70:'7' };
const GRADE = { MajorWarning:'大津波警報', Warning:'津波警報', Watch:'津波注意報', Unknown:'津波情報' };

/* ---------------- spots (localStorage) ---------------- */
function loadSpots() {
  let spots = [];
  try { spots = JSON.parse(localStorage.getItem('spots') || '[]'); } catch (e) {}
  const today = new Date().toISOString().slice(0, 10);
  const alive = spots.filter(s => !s.expiry || s.expiry >= today);
  if (alive.length !== spots.length) saveSpots(alive);
  return alive;
}
function saveSpots(spots) { localStorage.setItem('spots', JSON.stringify(spots)); }

/* ---------------- tabs ---------------- */
function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = '';
  const cur = document.createElement('button');
  cur.className = 'tab' + (state.mode === 'current' ? ' active' : '');
  cur.textContent = '📍 現在地';
  cur.onclick = () => selectCurrent();
  nav.appendChild(cur);
  for (const s of loadSpots()) {
    const b = document.createElement('button');
    b.className = 'tab' + (state.mode === s.id ? ' active' : '');
    b.textContent = (s.expiry ? '🧳 ' : '🏠 ') + s.label;
    b.onclick = () => selectSpot(s);
    nav.appendChild(b);
  }
  const add = document.createElement('button');
  add.className = 'tab add';
  add.textContent = '＋ 追加';
  add.onclick = openAddDialog;
  nav.appendChild(add);
}

function selectCurrent() {
  state.mode = 'current';
  renderTabs();
  $('#locname').textContent = '現在地を取得中…';
  $('#locsub').textContent = '';
  if (!navigator.geolocation) {
    $('#locname').textContent = '位置情報が利用できません';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => setLocation(pos.coords.latitude, pos.coords.longitude, null),
    (err) => {
      $('#locname').textContent = '位置情報を取得できませんでした';
      $('#locsub').textContent = '登録地点タブを選ぶか、ブラウザの位置情報許可を確認してください（' + err.message + '）';
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
  );
}

function selectSpot(s) {
  state.mode = s.id;
  renderTabs();
  setLocation(s.lat, s.lon, s.label);
}

/* ---------------- location & reverse geocode ---------------- */
let muniTable = null;
async function getMuniTable() {
  if (muniTable) return muniTable;
  muniTable = {};
  try {
    const txt = await (await fetch('https://maps.gsi.go.jp/js/muni.js')).text();
    const re = /GSI\.MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const parts = m[2].split(',');           // 例: '13,東京都,13101,千代田区'
      muniTable[m[1]] = { pref: parts[1], city: parts[3] };
    }
  } catch (e) { console.warn('muni.js load failed', e); }
  return muniTable;
}

async function reverseGeocode(lat, lon) {
  try {
    const r = await (await fetch(
      `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`
    )).json();
    if (!r.results) return null;
    const table = await getMuniTable();
    const cd = String(r.results.muniCd).replace(/^0+/, '');
    const muni = table[cd] || table[r.results.muniCd];
    if (!muni) return null;
    return { pref: muni.pref, city: muni.city.replace(/　/g, ''), detail: r.results.lv01Nm || '' };
  } catch (e) {
    console.warn('reverse geocode failed', e);
    return null;
  }
}

async function setLocation(lat, lon, label) {
  state.loc = { lat, lon };
  $('#locname').textContent = label || '現在地';
  $('#locsub').textContent = '住所を確認中…';
  map.setView([lat, lon], 14);
  locMarker.setLatLng([lat, lon]);

  const place = await reverseGeocode(lat, lon);
  state.place = place;
  if (place) {
    $('#locname').textContent = (label ? label + '｜' : '') + place.pref + place.city;
    $('#locsub').textContent = place.detail + `（${lat.toFixed(4)}, ${lon.toFixed(4)}）`;
    $('#qterm').value = place.city;
  } else {
    $('#locsub').textContent = `（${lat.toFixed(4)}, ${lon.toFixed(4)}）`;
  }
  renderSearchButtons();
  renderExtLinks();
  renderQuakes();
  refreshEvacLayer();
}

/* ---------------- Yahoo realtime search buttons ---------------- */
function rtUrl(q) {
  return 'https://search.yahoo.co.jp/realtime/search?p=' + encodeURIComponent(q);
}
function renderSearchButtons() {
  const g = $('#qgrid');
  const term = $('#qterm').value.trim();
  const pref = state.place ? state.place.pref : '';
  if (!term) { g.innerHTML = '<span class="note">地点を選択するか、上の欄に地名を入力すると検索ボタンが表示されます</span>'; return; }
  const main = [
    [term + ' 避難', '🏃 避難情報'],
    [term + ' 津波', '🌊 津波'],
    [term + ' 地震', '🫨 地震'],
    [term + ' 停電', '🔌 停電'],
  ];
  const sub = [
    [term + ' 断水', '🚱 断水'],
    [term + ' 道路 通行止め', '🚧 道路'],
    [(pref || term) + ' 電車 運転見合わせ', '🚃 交通'],
    [term + ' 火事', '🔥 火災'],
  ];
  g.innerHTML = '';
  for (const [q, t] of main) {
    const a = document.createElement('a');
    a.href = rtUrl(q); a.target = '_blank'; a.rel = 'noopener'; a.textContent = t;
    g.appendChild(a);
  }
  for (const [q, t] of sub) {
    const a = document.createElement('a');
    a.href = rtUrl(q); a.target = '_blank'; a.rel = 'noopener'; a.textContent = t; a.className = 'sub';
    g.appendChild(a);
  }
}

/* ---------------- external links ---------------- */
function renderExtLinks() {
  const el = $('#extlinks');
  const { lat, lon } = state.loc || { lat: 36, lon: 138 };
  const links = [
    ['重ねるハザードマップ', `https://disaportal.gsi.go.jp/maps/index.html?ll=${lat},${lon}&z=14`],
    ['通れた道マップ（トヨタ）', 'https://www.toyota.co.jp/jp/auto/passable_route/map/'],
    ['気象庁 防災情報', 'https://www.jma.go.jp/bosai/map.html#contents=warning'],
    ['ウェザーニュース', 'https://weathernews.jp/onebox/' + lat + '/' + lon + '/'],
  ];
  el.innerHTML = '';
  for (const [t, u] of links) {
    const a = document.createElement('a');
    a.href = u; a.target = '_blank'; a.rel = 'noopener'; a.textContent = t;
    el.appendChild(a);
  }
}

/* ---------------- quake / tsunami feed (P2P地震情報) ---------------- */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, d = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * d / 2) ** 2 +
    Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin((lon2 - lon1) * d / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchFeeds() {
  try {
    const [quakes, tsunamis] = await Promise.all([
      (await fetch('https://api.p2pquake.net/v2/history?codes=551&limit=15')).json(),
      (await fetch('https://api.p2pquake.net/v2/history?codes=552&limit=3')).json(),
    ]);
    state.quakes = quakes;
    const t = tsunamis[0];
    const fresh = t && (Date.now() - new Date(t.time.replace(/\//g, '-')).getTime() < 48 * 3600 * 1000);
    state.tsunami = (fresh && !t.cancelled && t.areas && t.areas.length) ? t : null;
  } catch (e) {
    console.warn('feed fetch failed', e);
    $('#quakes').textContent = '地震情報の取得に失敗しました（オフライン？）';
    return;
  }
  renderStatus();
  renderQuakes();
}

function renderStatus() {
  const st = $('#status');
  const t = state.tsunami;
  if (t) {
    const top = t.areas.some(a => a.grade === 'MajorWarning') ? 'MajorWarning'
      : t.areas.some(a => a.grade === 'Warning') ? 'Warning' : 'Watch';
    st.className = 'card ' + (top === 'Watch' ? 'warn' : 'alert');
    $('#status-headline').textContent = '🌊 ' + GRADE[top] + ' 発表中';
    const names = {};
    for (const a of t.areas) (names[GRADE[a.grade] || a.grade] = names[GRADE[a.grade] || a.grade] || []).push(a.name);
    $('#status-detail').textContent = Object.entries(names)
      .map(([g, arr]) => `【${g}】` + arr.slice(0, 12).join('、') + (arr.length > 12 ? ` ほか${arr.length - 12}区域` : ''))
      .join('\n');
  } else {
    st.className = 'card';
    $('#status-headline').textContent = '✅ 現在、津波情報は発表されていません';
    $('#status-detail').textContent = '最終確認: ' + new Date().toLocaleTimeString('ja-JP');
  }
}

function renderQuakes() {
  const el = $('#quakes');
  if (!state.quakes.length) { el.textContent = '直近の地震情報はありません'; return; }
  el.innerHTML = '';
  for (const q of state.quakes.slice(0, 10)) {
    const eq = q.earthquake || {};
    const hy = eq.hypocenter || {};
    const scale = eq.maxScale > 0 ? SCALE[eq.maxScale] || '?' : '—';
    const cls = eq.maxScale >= 70 ? 's7' : eq.maxScale >= 55 ? 's6' : eq.maxScale >= 45 ? 's5'
      : eq.maxScale >= 40 ? 's4' : eq.maxScale >= 30 ? 's3' : '';
    let dist = '';
    if (state.loc && hy.latitude > -90 && hy.longitude > -180 && hy.latitude !== 0) {
      const km = haversine(state.loc.lat, state.loc.lon, hy.latitude, hy.longitude);
      dist = km < 200 ? `<span class="near">📍 選択地点から約${Math.round(km)}km</span>` : '';
    }
    const time = (eq.time || q.time || '').slice(0, 16);
    const mag = hy.magnitude > -1 ? ` M${hy.magnitude}` : '';
    const depth = hy.depth >= 0 ? ` 深さ${hy.depth === 0 ? 'ごく浅い' : hy.depth + 'km'}` : '';
    const div = document.createElement('div');
    div.className = 'quake';
    div.innerHTML = `
      <div class="scale ${cls}">${scale}</div>
      <div class="info">
        <div class="place">${hy.name || '震源情報なし'}${mag}</div>
        <div class="meta">${time}${depth} ${eq.domesticTsunami === 'None' ? '｜津波の心配なし' : ''}</div>
        ${dist}
      </div>`;
    el.appendChild(div);
  }
}

/* ---------------- WebSocket live ---------------- */
function connectWS() {
  let ws;
  try { ws = new WebSocket('wss://api.p2pquake.net/v2/ws'); } catch (e) { return; }
  ws.onmessage = (ev) => {
    let d;
    try { d = JSON.parse(ev.data); } catch (e) { return; }
    if (d.code === 551) {
      state.quakes.unshift(d);
      renderQuakes();
      const eq = d.earthquake || {};
      if (eq.maxScale >= 45) {
        notify('🫨 地震情報', `${(eq.hypocenter || {}).name || ''} 最大震度${SCALE[eq.maxScale] || '?'}`);
      }
    } else if (d.code === 552) {
      state.tsunami = (!d.cancelled && d.areas && d.areas.length) ? d : null;
      renderStatus();
      if (state.tsunami) notify('🌊 津波情報', '津波予報が発表されました。ダッシュボードを確認してください。');
    }
  };
  ws.onclose = () => setTimeout(connectWS, 5000);
}

function notify(title, body) {
  if (Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'icon.svg' }); } catch (e) {}
  }
}

/* ---------------- map & evacuation sites ---------------- */
let map, locMarker, evacLayer;
const tileCache = new Map();

function lon2tile(lon, z) { return Math.floor((lon + 180) / 360 * 2 ** z); }
function lat2tile(lat, z) {
  return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);
}

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([36.5, 138.0], 5);
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>',
    maxZoom: 18,
  }).addTo(map);
  locMarker = L.marker([36.5, 138.0]).addTo(map);
  evacLayer = L.layerGroup().addTo(map);
  map.on('moveend', refreshEvacLayer);
  $('#evactype').addEventListener('change', () => { tileCache.clear(); refreshEvacLayer(); });
  refreshEvacLayer();
}

async function refreshEvacLayer() {
  const z = 10;                                    // skhbタイルは z=10 固定
  if (map.getZoom() < 10) {
    $('#evacmsg').textContent = '地図をズームインすると指定緊急避難場所が表示されます';
    evacLayer.clearLayers();
    return;
  }
  const type = $('#evactype').value;
  const b = map.getBounds();
  const x1 = lon2tile(b.getWest(), z), x2 = lon2tile(b.getEast(), z);
  const y1 = lat2tile(b.getNorth(), z), y2 = lat2tile(b.getSouth(), z);
  if ((x2 - x1 + 1) * (y2 - y1 + 1) > 9) { $('#evacmsg').textContent = '表示範囲が広すぎます'; return; }

  const feats = [];
  for (let x = x1; x <= x2; x++) {
    for (let y = y1; y <= y2; y++) {
      const key = `${type}/${x}/${y}`;
      if (!tileCache.has(key)) {
        try {
          const r = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/${type}/${z}/${x}/${y}.geojson`);
          tileCache.set(key, r.ok ? await r.json() : { features: [] });
        } catch (e) { tileCache.set(key, { features: [] }); }
      }
      feats.push(...(tileCache.get(key).features || []));
    }
  }
  evacLayer.clearLayers();
  for (const f of feats) {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties || {};
    L.circleMarker([lat, lon], { radius: 7, color: '#188038', weight: 2, fillColor: '#34a853', fillOpacity: .85 })
      .bindPopup(`<b>${p.name || '避難場所'}</b><br>${p.address || ''}<br><a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}" target="_blank">🧭 ここへの経路</a>`)
      .addTo(evacLayer);
  }
  $('#evacmsg').textContent = feats.length
    ? `表示中: ${feats.length}件（種別: ${$('#evactype').selectedOptions[0].text}）`
    : 'この範囲に該当種別の指定緊急避難場所データがありません';
}

/* ---------------- add / manage spots ---------------- */
let pendingSpot = null;

function openAddDialog() {
  pendingSpot = null;
  $('#add-query').value = ''; $('#add-label').value = ''; $('#add-expiry').value = '';
  $('#add-results').innerHTML = ''; $('#add-save').disabled = true;
  $('#dlg-add').showModal();
}

async function searchAddress(q) {
  const res = $('#add-results');
  res.innerHTML = '検索中…';
  try {
    const list = await (await fetch(
      'https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q)
    )).json();
    res.innerHTML = '';
    if (!list.length) { res.textContent = '見つかりませんでした'; return; }
    for (const item of list.slice(0, 8)) {
      const b = document.createElement('button');
      b.textContent = item.properties.title;
      b.onclick = () => {
        pendingSpot = {
          lat: item.geometry.coordinates[1],
          lon: item.geometry.coordinates[0],
          title: item.properties.title,
        };
        for (const x of res.children) x.style.background = '#f4f5f7';
        b.style.background = '#c8e6c9';
        if (!$('#add-label').value) $('#add-label').value = item.properties.title;
        $('#add-save').disabled = false;
      };
      res.appendChild(b);
    }
  } catch (e) { res.textContent = '検索に失敗しました'; }
}

function setupDialogs() {
  let timer = null;
  $('#add-query').addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (q.length >= 2) timer = setTimeout(() => searchAddress(q), 400);
  });
  $('#add-cancel').onclick = () => $('#dlg-add').close();
  $('#add-save').onclick = () => {
    if (!pendingSpot) return;
    const spots = loadSpots();
    const spot = {
      id: 'spot' + Date.now(),
      label: $('#add-label').value.trim() || pendingSpot.title,
      lat: pendingSpot.lat,
      lon: pendingSpot.lon,
      expiry: $('#add-expiry').value || null,
    };
    spots.push(spot);
    saveSpots(spots);
    $('#dlg-add').close();
    selectSpot(spot);
  };
  $('#btn-manage').onclick = () => { renderManageList(); $('#dlg-manage').showModal(); };
  $('#manage-close').onclick = () => $('#dlg-manage').close();
  $('#btn-relocate').onclick = () => selectCurrent();
  $('#qterm').addEventListener('input', renderSearchButtons);
  $('#qterm-city').onclick = () => {
    if (state.place) { $('#qterm').value = state.place.city; renderSearchButtons(); }
  };
  $('#qterm-pref').onclick = () => {
    if (state.place) { $('#qterm').value = state.place.pref; renderSearchButtons(); }
  };
  $('#btn-notify').onclick = async () => {
    const p = await Notification.requestPermission();
    $('#btn-notify').textContent = p === 'granted' ? '🔔 通知ON' : '🔕 通知OFF';
  };
}

function renderManageList() {
  const el = $('#manage-list');
  const spots = loadSpots();
  el.innerHTML = spots.length ? '' : '<div class="note">登録地点はありません</div>';
  for (const s of spots) {
    const div = document.createElement('div');
    div.className = 'spot-item';
    div.innerHTML = `<span>${s.expiry ? '🧳' : '🏠'} ${s.label}${s.expiry ? `（〜${s.expiry}）` : ''}</span>`;
    const del = document.createElement('button');
    del.textContent = '削除';
    del.onclick = () => {
      saveSpots(loadSpots().filter(x => x.id !== s.id));
      renderManageList();
      renderTabs();
    };
    div.appendChild(del);
    el.appendChild(div);
  }
}

/* ---------------- init ---------------- */
window.addEventListener('load', () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  initMap();
  setupDialogs();
  renderTabs();
  renderExtLinks();
  fetchFeeds();
  setInterval(fetchFeeds, 120000);
  connectWS();
  if (Notification.permission === 'granted') $('#btn-notify').textContent = '🔔 通知ON';
  selectCurrent();
});
