/* Archive Quest — карта точек-квестов. Все данные хранятся локально в браузере. */
(function () {
  'use strict';

  // ---------- константы ----------
  const STORE_KEY = 'archive-quest:v1';
  const FOUNDER_HASH = '09a28ea2da4c7c9f5a8b32bfc04f5d2303d77528d34bd1572b1b49ce4569a0e2';
  const CHECKIN_RADIUS = 100; // метров
  const LINE_BONUS = 200;

  const RANKS = [
    { id: 'r3', jp: '三等', name: 'RANK 3', xp: 0, how: 'Старт. Первая точка.' },
    { id: 'r2', jp: '二等', name: 'RANK 2', xp: 500, how: '≈ 5 точек' },
    { id: 'r1', jp: '一等', name: 'RANK 1', xp: 1500, how: 'Первая квест-линия' },
    { id: 'fc', jp: '上等', name: 'FIRST CLASS', xp: 3000, how: 'Несколько линий' },
    { id: 'as', jp: '准特等', name: 'ASSOCIATE SPECIAL', xp: 6000, how: 'Долгий стрик' },
    { id: 'sc', jp: '特等', name: 'SPECIAL CLASS', xp: 12000, how: 'Точки в разных странах' }
  ];
  const ZERO = { id: 'zero', jp: '零', name: 'ZERO-CLASS', xp: Infinity, how: 'Только основатель. Один на весь мир.' };

  const BASE_CATS = [
    { id: 'arc', jp: '古着', name: 'АРХИВ / ВИНТАЖ', short: 'АРХИВ' },
    { id: 'fig', jp: '模型', name: 'АНИМЕ-ФИГУРКИ', short: 'ФИГУРКИ' },
    { id: 'tmp', jp: '寺社', name: 'ХРАМЫ', short: 'ХРАМЫ' },
    { id: 'vin', jp: '盤', name: 'ВИНИЛ / CD', short: 'ВИНИЛ' },
    { id: 'man', jp: '本', name: 'МАНГА / КНИГИ', short: 'МАНГА' },
    { id: 'caf', jp: '喫茶', name: 'КИССАТЭН / КАФЕ', short: 'КАФЕ' },
    { id: 'cam', jp: '写真', name: 'ПЛЁНКА / КАМЕРЫ', short: 'ПЛЁНКА' },
    { id: 'gam', jp: '遊', name: 'РЕТРО-ИГРЫ', short: 'ИГРЫ' },
    { id: 'art', jp: '壁', name: 'СТРИТ-АРТ', short: 'СТРИТ-АРТ' }
  ];

  const TASK_PRESETS = {
    arc: [['Отметиться на точке', 60], ['Снять бирку или ярлык', 30], ['Найти вещь 90-х (бонус)', 30]],
    fig: [['Отметиться на точке', 60], ['Найти фигурку из любимого тайтла', 30], ['Сфоткать витрину', 30]],
    tmp: [['Отметиться на точке', 60], ['Получить goshuin (печать)', 50], ['Сфоткать ворота', 20]],
    vin: [['Отметиться на точке', 60], ['Послушать пластинку на месте', 30], ['Найти редкий пресс', 30]],
    man: [['Отметиться на точке', 60], ['Найти первый том', 30], ['Сфоткать полку', 30]],
    caf: [['Отметиться на точке', 60], ['Взять фирменное', 30], ['Сфоткать интерьер', 30]],
    _: [['Отметиться на точке', 60], ['Сделать фото', 30], ['Своя задача (бонус)', 30]]
  };

  // ---------- состояние ----------
  const defaults = () => ({
    v: 1,
    profile: { name: '', founder: false, grantedRank: null, orders: [] },
    points: [],
    friends: [],
    customCats: [],
    filter: [],
    orderSeq: 0,
    lastView: null
  });

  let S = load();
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Object.assign(defaults(), JSON.parse(raw));
    } catch (e) { /* пусто */ }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
    catch (e) { toast('Не хватает места: удали пару фото у точек'); }
  }

  // ---------- утилиты ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const fmtNum = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (iso) => { const d = new Date(iso); return d.toLocaleDateString('ru-RU'); };
  const initials = (name) => (name || '?').trim().slice(0, 2).toUpperCase();

  const ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    locate: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>'
  };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function distance(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function fmtDist(m) { return m < 1000 ? Math.round(m) + ' м' : (m / 1000).toFixed(1) + ' км'; }

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const b64enc = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));

  // ---------- категории ----------
  function allCats() { return BASE_CATS.concat(S.customCats); }
  function cat(id) { return allCats().find((c) => c.id === id) || { id, jp: '点', name: 'ТОЧКА', short: 'ТОЧКА' }; }

  // ---------- XP и ранги ----------
  function pointXP(p) {
    if (!p.cleared) return 0;
    const sum = p.tasks.filter((t) => t.done).reduce((a, t) => a + t.xp, 0);
    return p.geo ? sum : Math.round(sum / 2);
  }
  function lines() {
    const map = {};
    S.points.forEach((p) => {
      const key = (p.line || '').trim();
      if (!key) return;
      (map[key] = map[key] || []).push(p);
    });
    return Object.keys(map).map((name) => {
      const pts = map[name];
      const done = pts.filter((p) => p.cleared).length;
      return { name, points: pts, done, total: pts.length, complete: pts.length > 1 && done === pts.length };
    });
  }
  function totalXP() {
    const pts = S.points.reduce((a, p) => a + pointXP(p), 0);
    const bonus = lines().filter((l) => l.complete).length * LINE_BONUS;
    return pts + bonus;
  }
  function rankFromXP(xp) {
    let r = RANKS[0];
    RANKS.forEach((x) => { if (xp >= x.xp) r = x; });
    return r;
  }
  function rankById(id) { return id === 'zero' ? ZERO : RANKS.find((r) => r.id === id) || RANKS[0]; }
  function rankIndex(id) { return RANKS.findIndex((r) => r.id === id); }
  function myRank() {
    if (S.profile.founder) return ZERO;
    const byXP = rankFromXP(totalXP());
    const g = S.profile.grantedRank ? rankById(S.profile.grantedRank) : null;
    if (g && rankIndex(g.id) > rankIndex(byXP.id)) return g;
    return byXP;
  }
  function nextRank() {
    const r = myRank();
    if (r.id === 'zero') return null;
    const i = rankIndex(r.id);
    return RANKS[i + 1] || null;
  }
  function streak() {
    const days = new Set(S.points.filter((p) => p.cleared && p.clearedAt).map((p) => p.clearedAt.slice(0, 10)));
    let n = 0;
    const d = new Date();
    if (!days.has(today())) d.setDate(d.getDate() - 1);
    while (days.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  // ---------- карта ----------
  let map, markersLayer, meMarker, myPos = null, myPosAt = 0, myAcc = 0, addMode = false;
  function initMap() {
    const last = S.lastView || { lat: 35.6702, lng: 139.7027, z: 14 }; // Харадзюку
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView([last.lat, last.lng], last.z);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, subdomains: 'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    map.on('moveend', () => { const c = map.getCenter(); S.lastView = { lat: c.lat, lng: c.lng, z: map.getZoom() }; save(); });
    map.on('click', (e) => { if (addMode) { setAddMode(false); openPointForm({ lat: e.latlng.lat, lng: e.latlng.lng }); } });
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition((pos) => {
        myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude }; myPosAt = Date.now(); myAcc = pos.coords.accuracy || 0;
        if (!meMarker) meMarker = L.marker([myPos.lat, myPos.lng], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [14, 14] }), interactive: false }).addTo(map);
        else meMarker.setLatLng([myPos.lat, myPos.lng]);
      }, () => {}, { enableHighAccuracy: true, maximumAge: 15000 });
    }
  }
  let searchQ = '';
  function visiblePoints() {
    return S.points.filter((p) => (!S.filter.length || S.filter.includes(p.cat)) && (!searchQ || (p.name + ' ' + (p.line || '') + ' ' + (p.note || '')).toLowerCase().includes(searchQ)));
  }
  function drawMarkers() {
    markersLayer.clearLayers();
    visiblePoints().forEach((p) => {
      const c = cat(p.cat);
      const html = '<div class="pin ' + (p.cleared ? 'done' : '') + '"><div class="lbl">' + (p.cleared ? '✓ ' : '') + esc(c.jp) + ' · ' + esc(p.name.toUpperCase()) + '</div><div class="stem"></div><div class="dot"></div></div>';
      const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html, iconSize: [0, 0] }), keyboard: true, title: p.name });
      m.on('click', () => { location.hash = '#/point/' + p.id; });
      markersLayer.addLayer(m);
    });
  }
  function setAddMode(on) {
    addMode = on;
    if ($('#addhint')) $('#addhint').hidden = !on;
  }
  function locate() {
    if (!navigator.geolocation) return toast('Геолокация недоступна');
    navigator.geolocation.getCurrentPosition((pos) => {
      myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude }; myPosAt = Date.now(); myAcc = pos.coords.accuracy || 0;
      map.setView([myPos.lat, myPos.lng], 16);
    }, () => toast('Разреши доступ к геолокации в настройках'), { enableHighAccuracy: true, timeout: 10000 });
  }

  // ---------- роутер ----------
  const view = () => $('#view');
  function route() {
    const h = location.hash.replace(/^#\/?/, '') || 'map';
    const [name, arg] = h.split('/');
    const tab = { map: 'map', quests: 'quests', point: 'quests', categories: 'categories', profile: 'profile', grant: 'profile', ranks: 'profile', order: 'profile' }[name] || 'map';
    document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    if (!S.profile.name && name !== 'order') return renderOnboarding();
    const r = { map: renderMap, quests: renderQuests, point: renderPoint, categories: renderCategories, profile: renderProfile, grant: renderGrant, ranks: renderRanks, order: renderOrder }[name] || renderMap;
    r(arg ? decodeURIComponent(arg) : undefined);
    if (name === 'map') setTimeout(() => map.invalidateSize(), 0);
  }
  window.addEventListener('hashchange', route);

  function screen(html) { view().innerHTML = '<section class="screen">' + html + '</section>'; view().firstChild.scrollTop = 0; }
  function backBtn(href, label) { return '<a class="iconbtn" href="' + href + '" aria-label="' + esc(label || 'Назад') + '">' + ICON.back + '</a>'; }

  // ---------- онбординг ----------
  function renderOnboarding() {
    screen(`
      <div style="flex:1"></div>
      <div class="eyebrow">ARCHIVE QUEST / 現地調査</div>
      <h1 class="h1" style="font-size:44px">ОТКРОЙ ДОСЬЕ<br>СЛЕДОВАТЕЛЯ</h1>
      <p class="small" style="line-height:1.6">Сохраняй точки по всему миру: архивные магазины, фигурки, храмы и что угодно. Закрывай их как квесты, получай XP, штампы и ранги.</p>
      <label class="field"><span>ПОЗЫВНОЙ</span><input class="input" id="ob-name" maxlength="24" autocomplete="nickname" placeholder="например, NA VZVODE"></label>
      <button class="btn primary block" id="ob-go">НАЧАТЬ С RANK 3</button>
      <p class="small">Данные хранятся только на этом телефоне. Сделай бэкап в профиле.</p>
    `);
    $('#ob-go').onclick = () => {
      const n = $('#ob-name').value.trim();
      if (!n) return toast('Введи позывной');
      S.profile.name = n; save(); location.hash = '#/map'; route();
    };
  }

  // ---------- карта (экран) ----------
  function renderMap() {
    const r = myRank();
    const cats = allCats();
    const chips = '<button class="chip ' + (S.filter.length ? '' : 'on') + '" data-f="">ВСЁ</button>' +
      cats.map((c) => '<button class="chip ' + (S.filter.includes(c.id) ? 'on' : '') + '" data-f="' + c.id + '">' + esc(c.short) + '</button>').join('');
    const active = lines().filter((l) => !l.complete).sort((a, b) => b.done - a.done)[0];
    let bottom;
    if (active) {
      const next = active.points.find((p) => !p.cleared);
      const dist = next && myPos ? ' · ' + fmtDist(distance(myPos, next)) : '';
      bottom = `<a class="card line-card" href="#/point/${next.id}">
        <div class="between"><div><div class="eyebrow" style="color:#555550">QUEST LINE</div><div class="h2">${esc(active.name.toUpperCase())}</div></div>
        <span class="tag" style="background:var(--ink);color:var(--paper);font-size:12px">${active.done} / ${active.total}</span></div>
        <div class="progress" style="--n:${active.total}">${active.points.map((p) => '<i class="' + (p.cleared ? 'on' : '') + '"></i>').join('')}</div>
        <div class="between mono" style="font-size:11px"><span>Следующая: ${esc(next.name)}${dist}</span></div></a>`;
    } else if (!S.points.length) {
      bottom = `<div class="card line-card"><div class="h2">КАРТА ПУСТА</div><div class="mono" style="font-size:11px;line-height:1.5">Нажми «+», потом коснись карты, чтобы поставить первую точку. Укажи линию (например, «Урахара»), чтобы собрать точки в квест-линию.</div></div>`;
    } else {
      bottom = `<a class="card line-card" href="#/quests"><div class="between"><div class="h2">${S.points.filter((p) => p.cleared).length} / ${S.points.length} ЗАКРЫТО</div><span class="mono" style="font-size:11px">ВСЕ КВЕСТЫ →</span></div></a>`;
    }
    view().innerHTML = `<div class="overlay">
      <div class="map-top">
        <div class="between">
          <div><div class="eyebrow">FIELD MAP / 現地調査</div><div style="font-size:22px;font-weight:900;letter-spacing:-.02em">ARCHIVE QUEST</div></div>
          <a class="rankbadge" href="#/profile" aria-label="Профиль, ранг ${esc(r.name)}"><span class="jp">${esc(r.jp)}</span><span class="mono">${esc(r.name)}</span></a>
        </div>
        <label class="row" style="background:var(--paper);color:var(--ink);height:44px;padding:0 12px">
          <span style="width:18px;height:18px;display:flex" aria-hidden="true">${ICON.search.replace('<svg', '<svg width="18" height="18" fill="none" stroke="#0A0A0A" stroke-width="2"')}</span>
          <span style="position:absolute;width:1px;height:1px;overflow:hidden">Поиск</span>
          <input id="q" type="search" value="${esc(searchQ)}" placeholder="Поиск: магазин, храм, линия…" style="flex:1;border:0;background:transparent;font-family:var(--mono);font-size:14px;color:var(--ink);outline:none;min-width:0">
        </label>
        <div class="chips">${chips}</div>
      </div>
      <div class="add-hint" id="addhint" ${addMode ? '' : 'hidden'}><span>Коснись карты, где поставить точку</span>
        <span class="row"><button class="btn sm" style="background:var(--ink);color:var(--paper)" id="add-here">СЮДА, ГДЕ Я</button>
        <button class="iconbtn" style="width:36px;height:36px;border-color:var(--ink);background:transparent;color:var(--ink)" id="add-cancel" aria-label="Отмена">${ICON.close}</button></span></div>
      <div class="fab-col">
        <button class="iconbtn light" id="fab-add" aria-label="Добавить точку">${ICON.plus}</button>
        <button class="iconbtn" id="fab-loc" aria-label="Где я" style="color:var(--paper)">${ICON.locate}</button>
      </div>
      ${bottom}
    </div>`;
    view().querySelectorAll('.chip').forEach((b) => b.onclick = () => {
      const f = b.dataset.f;
      if (!f) S.filter = [];
      else S.filter = S.filter.includes(f) ? S.filter.filter((x) => x !== f) : S.filter.concat(f);
      save(); renderMap(); drawMarkers();
    });
    $('#q').oninput = (e) => { searchQ = e.target.value.trim().toLowerCase(); drawMarkers(); };
    $('#fab-add').onclick = () => setAddMode(true);
    $('#fab-loc').onclick = locate;
    $('#add-cancel').onclick = () => setAddMode(false);
    $('#add-here').onclick = () => {
      if (!myPos) return toast('Жду геолокацию… нажми ◎');
      setAddMode(false); openPointForm({ lat: myPos.lat, lng: myPos.lng });
    };
    drawMarkers();
  }

  // ---------- форма точки ----------
  function openPointForm(base, existing) {
    const p = existing || { id: uid(), name: '', cat: S.filter[0] || 'arc', lat: base.lat, lng: base.lng, line: '', note: '', photo: null };
    const lineNames = lines().map((l) => l.name);
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<form class="sheet" id="pf">
      <div class="between"><div class="h2">${existing ? 'ПРАВКА ТОЧКИ' : 'НОВАЯ ТОЧКА'}</div><button type="button" class="iconbtn" id="pf-x" aria-label="Закрыть">${ICON.close}</button></div>
      <label class="field"><span>НАЗВАНИЕ</span><input class="input" name="name" required maxlength="40" value="${esc(p.name)}" placeholder="например, Kinji Harajuku"></label>
      <label class="field"><span>КАТЕГОРИЯ</span><select class="input" name="cat">${allCats().map((c) => '<option value="' + c.id + '"' + (c.id === p.cat ? ' selected' : '') + '>' + esc(c.jp + ' · ' + c.name) + '</option>').join('')}</select></label>
      <label class="field"><span>КВЕСТ-ЛИНИЯ (НЕОБЯЗАТЕЛЬНО)</span><input class="input" name="line" list="pf-lines" maxlength="30" value="${esc(p.line)}" placeholder="например, Урахара"><datalist id="pf-lines">${lineNames.map((n) => '<option value="' + esc(n) + '">').join('')}</datalist></label>
      <label class="field"><span>ЗАМЕТКА / АДРЕС</span><textarea class="input" name="note" maxlength="300" placeholder="часы работы, что искать…">${esc(p.note)}</textarea></label>
      <label class="field"><span>КООРДИНАТЫ ИЛИ ССЫЛКА GOOGLE MAPS</span><input class="input" name="coords" value="${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}" inputmode="text"></label>
      <label class="field"><span>ФОТО (НЕОБЯЗАТЕЛЬНО)</span><input class="input" type="file" name="photo" accept="image/*" style="padding-top:12px"></label>
      <button class="btn primary block" type="submit">${existing ? 'СОХРАНИТЬ' : 'ПОСТАВИТЬ ТОЧКУ'}</button>
      ${existing ? '<button type="button" class="btn ghost block" id="pf-del">УДАЛИТЬ ТОЧКУ</button>' : ''}
    </form>`;
    $('#app').appendChild(bg);
    const close = () => bg.remove();
    $('#pf-x', bg).onclick = close;
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    if (existing) {
      let armed = false;
      $('#pf-del', bg).onclick = (e) => {
        if (!armed) { armed = true; e.target.textContent = 'ТОЧНО УДАЛИТЬ?'; return; }
        S.points = S.points.filter((x) => x.id !== p.id); save(); close(); location.hash = '#/map';
      };
    }
    $('#pf', bg).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const ll = parseCoords(f.coords.value);
      if (!ll) return toast('Не понял координаты. Формат: 35.67, 139.70');
      const catChanged = p.cat !== f.cat.value;
      p.name = f.name.value.trim();
      p.cat = f.cat.value;
      p.line = f.line.value.trim();
      p.note = f.note.value.trim();
      p.lat = ll.lat; p.lng = ll.lng;
      if (f.photo.files[0]) p.photo = await shrinkImage(f.photo.files[0]);
      if (!existing || (catChanged && !p.cleared)) p.tasks = (TASK_PRESETS[p.cat] || TASK_PRESETS._).map(([t, xp]) => ({ t, xp, done: false }));
      if (!existing) { p.created = new Date().toISOString(); p.cleared = false; S.points.push(p); }
      save(); close();
      toast(existing ? 'Сохранено' : 'Точка поставлена');
      location.hash = '#/point/' + p.id; route();
    };
  }
  function parseCoords(s) {
    s = s.trim();
    let m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || s.match(/[?&](?:q|ll|query)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i) || s.match(/(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  }
  function shrinkImage(file) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 720 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        res(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => res(null);
      img.src = URL.createObjectURL(file);
    });
  }

  // ---------- карточка точки ----------
  function renderPoint(id) {
    const p = S.points.find((x) => x.id === id);
    if (!p) { location.hash = '#/map'; return; }
    const c = cat(p.cat);
    const line = p.line ? lines().find((l) => l.name === p.line) : null;
    const num = line ? String(line.points.indexOf(p) + 1).padStart(2, '0') + ' / ' + String(line.total).padStart(2, '0') : 'NO. ' + String(S.points.indexOf(p) + 1).padStart(3, '0');
    const dist = myPos ? fmtDist(distance(myPos, p)) : '— м';
    const potential = p.tasks.reduce((a, t) => a + (t.done ? t.xp : 0), 0);
    const appleMaps = 'https://maps.apple.com/?ll=' + p.lat + ',' + p.lng + '&q=' + encodeURIComponent(p.name);
    screen(`
      <div class="hero">
        ${p.photo ? '<img src="' + p.photo + '" alt="">' : '<div class="mono" style="font-size:11px;letter-spacing:.14em;color:#8A8A85;border:1px dashed #5A5A55;padding:8px 12px">[ НЕТ ФОТО ]</div>'}
        <a class="iconbtn light back" href="#/map" aria-label="Назад к карте">${ICON.back}</a>
        <span class="tag num" style="background:var(--ink);border:1px solid var(--paper);color:var(--paper)">${num}</span>
        <span class="tag accent cat" style="font-size:11px;padding:6px 10px">${esc(c.jp)} · ${esc(c.name)}</span>
      </div>
      <div class="between" style="align-items:flex-start;margin-top:6px">
        <div class="grow"><h1 class="h1" style="font-size:30px">${esc(p.name.toUpperCase())}</h1>
        <div class="small" style="margin-top:6px">${p.line ? 'ЛИНИЯ «' + esc(p.line.toUpperCase()) + '» · ' : ''}${dist}</div></div>
        <button class="iconbtn" id="pt-edit" aria-label="Править точку">${ICON.edit}</button>
      </div>
      ${p.note ? '<p class="mono" style="font-size:12px;line-height:1.5;margin:0;white-space:pre-line">' + esc(p.note) + '</p>' : ''}
      <div class="stats" style="--n:3">
        <div><span>НАГРАДА</span><b>+${p.tasks.reduce((a, t) => a + t.xp, 0)} XP</b></div>
        <div><span>ОТМЕЧЕНО</span><b>${potential} XP</b></div>
        <div><span>СТАТУС</span><b style="color:${p.cleared ? 'var(--accent)' : 'inherit'}">${p.cleared ? '済' : '未'}</b></div>
      </div>
      <div>
        <div class="eyebrow" style="padding-bottom:6px">ЗАДАЧИ КВЕСТА / 任務</div>
        ${p.tasks.map((t, i) => `<button class="list-item" data-t="${i}">
          <span class="check ${t.done ? 'on' : ''}">${t.done ? '✓' : ''}</span>
          <span class="grow" style="font-size:14px;font-weight:600">${esc(t.t)}</span>
          <span class="small">+${t.xp}</span></button>`).join('')}
      </div>
      ${p.cleared ? `<div class="row" style="gap:14px">
          <div class="stamp" style="width:96px;height:96px;flex-shrink:0"><span class="jp" style="font-size:30px;line-height:1">済</span><span class="mono" style="font-size:8px;letter-spacing:.1em">${p.geo ? 'CLEARED' : 'NO GEO'}</span><span class="mono" style="font-size:8px">${fmtDate(p.clearedAt)}</span></div>
          <div class="mono" style="font-size:12px;line-height:1.5">Квест закрыт. Получено <b>${pointXP(p)} XP</b>${p.geo ? '' : ' (без гео-печати — половина XP)'}.</div></div>
        <button class="btn ghost block" id="pt-reopen">ОТКРЫТЬ ЗАНОВО</button>`
      : `<div class="small" style="text-align:center">Чек-ин по геолокации: нужно быть в радиусе ${CHECKIN_RADIUS} м</div>
        <button class="btn primary block" id="pt-close">ЗАКРЫТЬ КВЕСТ</button>`}
      <a class="btn ghost block" href="${appleMaps}" target="_blank" rel="noopener">МАРШРУТ В КАРТАХ</a>
    `);
    view().querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { const t = p.tasks[+b.dataset.t]; t.done = !t.done; save(); renderPoint(id); });
    $('#pt-edit').onclick = () => openPointForm(null, p);
    if ($('#pt-reopen')) {
      let armed = false;
      $('#pt-reopen').onclick = (e) => {
        if (!armed) { armed = true; e.target.textContent = 'XP ЗА ТОЧКУ СГОРИТ. ТОЧНО?'; return; }
        p.cleared = false; p.clearedAt = null; p.geo = false; save(); renderPoint(id);
      };
    }
    if ($('#pt-close')) $('#pt-close').onclick = (e) => closeQuest(p, e.target);
  }
  function closeQuest(p, btn) {
    const before = myRank();
    const finish = (geo) => {
      p.tasks[0].done = true;
      p.cleared = true; p.geo = geo; p.clearedAt = new Date().toISOString();
      save();
      const after = myRank();
      renderPoint(p.id);
      if (after.id !== before.id) toast('Повышение! Новый ранг: ' + after.name);
      else toast('Квест закрыт · +' + pointXP(p) + ' XP');
    };
    btn.disabled = true; btn.textContent = 'ПРОВЕРЯЮ ГЕО…';
    const judge = () => {
      const d = distance(myPos, p);
      if (d <= CHECKIN_RADIUS + Math.min(myAcc, 100)) finish(true);
      else askNoGeo('До точки ' + fmtDist(d) + '.');
    };
    if (myPos && Date.now() - myPosAt < 30000) return judge();
    if (!navigator.geolocation) return askNoGeo();
    navigator.geolocation.getCurrentPosition((pos) => {
      myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude }; myPosAt = Date.now(); myAcc = pos.coords.accuracy || 0;
      judge();
    }, () => askNoGeo('Нет доступа к геолокации.'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 });
    function askNoGeo(why) {
      btn.disabled = false;
      btn.textContent = 'ЗАКРЫТЬ БЕЗ ГЕО · ½ XP';
      btn.onclick = () => finish(false);
      toast((why || '') + ' Можно закрыть без гео-печати.');
    }
  }

  // ---------- квесты ----------
  let questFilter = 'open';
  function renderQuests() {
    const ls = lines();
    const loose = S.points.filter((p) => !p.line);
    const show = (p) => questFilter === 'all' || (questFilter === 'open' ? !p.cleared : p.cleared);
    const item = (p) => `<a class="list-item" href="#/point/${p.id}">
      <span class="check ${p.cleared ? 'on' : ''}">${p.cleared ? '✓' : ''}</span>
      <span class="grow"><span style="display:block;font-size:14px;font-weight:700">${esc(p.name)}</span><span class="small">${esc(cat(p.cat).jp + ' · ' + cat(p.cat).short)}${myPos ? ' · ' + fmtDist(distance(myPos, p)) : ''}</span></span>
      <span class="small">${p.cleared ? '+' + pointXP(p) : '+' + p.tasks.reduce((a, t) => a + t.xp, 0)}</span></a>`;
    const blocks = ls.map((l) => {
      const pts = l.points.filter(show);
      if (!pts.length) return '';
      return `<div class="box" style="padding:12px;display:flex;flex-direction:column;gap:8px">
        <div class="between"><div><div class="eyebrow">QUEST LINE${l.complete ? ' · +' + LINE_BONUS + ' XP' : ''}</div><div class="h2">${esc(l.name.toUpperCase())}</div></div><span class="tag ${l.complete ? 'accent' : 'paper'}">${l.done} / ${l.total}</span></div>
        <div class="progress" style="--n:${l.total};color:var(--line-2)">${l.points.map((p) => '<i class="' + (p.cleared ? 'on' : '') + '"></i>').join('')}</div>
        <div>${pts.map(item).join('')}</div></div>`;
    }).join('');
    const looseShown = loose.filter(show);
    screen(`
      <div class="topbar"><div><div class="eyebrow">QUEST LOG / 任務帳</div><h1 class="h1">КВЕСТЫ</h1></div><span class="tag paper">${S.points.filter((p) => p.cleared).length} / ${S.points.length}</span></div>
      <div class="tabs2" style="--n:3">
        <button data-qf="open" class="${questFilter === 'open' ? 'on' : ''}">ОТКРЫТЫЕ</button>
        <button data-qf="done" class="${questFilter === 'done' ? 'on' : ''}">ЗАКРЫТЫЕ</button>
        <button data-qf="all" class="${questFilter === 'all' ? 'on' : ''}">ВСЕ</button>
      </div>
      ${blocks}
      ${looseShown.length ? '<div><div class="eyebrow" style="padding-bottom:6px">БЕЗ ЛИНИИ</div>' + looseShown.map(item).join('') + '</div>' : ''}
      ${!S.points.length ? '<div class="empty">Пока нет точек. Открой карту, нажми «+» и коснись карты.</div>' : (!blocks && !looseShown.length ? '<div class="empty">Здесь пусто.</div>' : '')}
    `);
    view().querySelectorAll('[data-qf]').forEach((b) => b.onclick = () => { questFilter = b.dataset.qf; renderQuests(); });
  }

  // ---------- категории ----------
  function renderCategories() {
    const count = (id) => S.points.filter((p) => p.cat === id).length;
    screen(`
      <div class="topbar">${backBtn('#/map', 'К карте')}<div class="eyebrow">КАТЕГОРИИ / 分類</div><span class="mono" style="font-size:11px;width:44px;text-align:right">${S.filter.length || 'ВСЕ'}</span></div>
      <div><h1 class="h1">ЧТО ОХОТИМ?</h1><div class="small" style="margin-top:6px">Выбранное останется на карте. Ничего не выбрано — видно всё.</div></div>
      <div class="cat-grid">
        ${allCats().map((c) => `<button class="cat-tile ${S.filter.includes(c.id) ? 'on' : ''}" data-c="${c.id}">
          <span class="between" style="width:100%;align-items:flex-start"><span class="jp">${esc(c.jp)}</span><span class="check ${S.filter.includes(c.id) ? 'on' : ''}" style="width:20px;height:20px;font-size:12px;border-color:currentColor">${S.filter.includes(c.id) ? '✓' : ''}</span></span>
          <span><b style="display:block">${esc(c.name)}</b><span class="mono">${count(c.id)} ТОЧЕК</span></span></button>`).join('')}
        <button class="cat-tile" id="cat-new" style="border-style:dashed"><span class="jp">＋</span><span><b style="display:block">СВОЯ КАТЕГОРИЯ</b><span class="mono">СОЗДАТЬ</span></span></button>
      </div>
      <a class="btn primary block" href="#/map">ПОКАЗАТЬ НА КАРТЕ</a>
    `);
    view().querySelectorAll('[data-c]').forEach((b) => b.onclick = () => {
      const id = b.dataset.c;
      S.filter = S.filter.includes(id) ? S.filter.filter((x) => x !== id) : S.filter.concat(id);
      save(); renderCategories();
    });
    $('#cat-new').onclick = () => {
      const bg = document.createElement('div');
      bg.className = 'sheet-bg';
      bg.innerHTML = `<form class="sheet"><div class="between"><div class="h2">СВОЯ КАТЕГОРИЯ</div><button type="button" class="iconbtn" data-x aria-label="Закрыть">${ICON.close}</button></div>
        <label class="field"><span>НАЗВАНИЕ</span><input class="input" name="n" required maxlength="20" placeholder="например, КРОССОВКИ"></label>
        <label class="field"><span>ЗНАК (1–2 СИМВОЛА, МОЖНО КАНДЗИ)</span><input class="input" name="j" required maxlength="2" placeholder="靴"></label>
        <button class="btn primary block">СОЗДАТЬ</button></form>`;
      $('#app').appendChild(bg);
      $('[data-x]', bg).onclick = () => bg.remove();
      $('form', bg).onsubmit = (e) => {
        e.preventDefault();
        const n = e.target.n.value.trim().toUpperCase(), j = e.target.j.value.trim();
        S.customCats.push({ id: 'c_' + uid(), jp: j, name: n, short: n.slice(0, 12) });
        save(); bg.remove(); renderCategories();
      };
    };
  }

  // ---------- профиль ----------
  let profileTab = 'stamps';
  function renderProfile() {
    const r = myRank();
    const xp = totalXP();
    const nx = nextRank();
    const cleared = S.points.filter((p) => p.cleared).sort((a, b) => (a.clearedAt < b.clearedAt ? -1 : 1));
    const countries = new Set(cleared.map((p) => Math.round(p.lat / 3) + ':' + Math.round(p.lng / 3))).size; // грубая оценка «регионов»
    const pct = nx ? Math.min(100, Math.round(((xp - (RANKS[rankIndex(r.id)] || { xp: 0 }).xp) / (nx.xp - (RANKS[rankIndex(r.id)] || { xp: 0 }).xp)) * 100)) : 100;
    let tabHtml = '';
    if (profileTab === 'stamps') {
      const slots = Math.max(8, Math.ceil((cleared.length + 1) / 4) * 4);
      tabHtml = '<div class="stamp-grid">' + Array.from({ length: slots }, (_, i) => {
        const p = cleared[i];
        if (!p) return '<div class="stamp empty" style="transform:rotate(' + ((i % 3) * 6 - 6) + 'deg)"><span class="jp">?</span><span class="mono">———</span></div>';
        return '<a class="stamp" href="#/point/' + p.id + '" style="transform:rotate(' + ((i % 3) * 6 - 6) + 'deg)"><span class="jp">' + esc(cat(p.cat).jp.slice(0, 1)) + '</span><span class="mono">' + esc(p.name.toUpperCase()) + '</span></a>';
      }).join('') + '</div>';
    } else if (profileTab === 'squad') {
      tabHtml = (S.profile.founder ? '' : '<div class="empty">Выдавать ранги может только ZERO-CLASS. Здесь ты ведёшь список своего отряда.</div>') +
        '<div>' + (S.friends.length ? S.friends.map((f) => `<div class="list-item" style="cursor:default">
          <span class="avatar">${esc(initials(f.name))}</span>
          <span class="grow"><span style="display:block;font-size:14px;font-weight:700">${esc(f.name)}</span><span class="small">${esc(rankById(f.rank).name)} · ${esc(rankById(f.rank).jp)}</span></span>
          ${S.profile.founder ? '<a class="btn sm" style="border:1px solid var(--accent);color:var(--accent)" href="#/grant/' + f.id + '">ВЫДАТЬ</a>' : ''}</div>`).join('') : '<div class="empty">В отряде пока никого.</div>') + '</div>' +
        '<form class="row" id="add-friend"><input class="input grow" name="n" maxlength="24" placeholder="Позывной друга" aria-label="Позывной друга"><button class="btn sm ghost" style="height:46px">ДОБАВИТЬ</button></form>';
    } else {
      tabHtml = `<div class="field"><span>ПОЗЫВНОЙ</span><div class="row"><input class="input grow" id="set-name" maxlength="24" value="${esc(S.profile.name)}" aria-label="Позывной"><button class="btn sm ghost" style="height:46px" id="set-name-save">OK</button></div></div>
        <div class="sep"></div>
        <div class="eyebrow">БЭКАП</div>
        <div class="small" style="line-height:1.5">Данные живут только в этом браузере. Сохрани файл, чтобы не потерять точки или перенести их на другой телефон.</div>
        <div class="row"><button class="btn sm ghost grow" id="exp">СКАЧАТЬ БЭКАП</button><label class="btn sm ghost grow" style="cursor:pointer">ЗАГРУЗИТЬ<input type="file" id="imp" accept="application/json,.json" hidden></label></div>
        <div class="sep"></div>
        ${S.profile.founder ? '<div class="small">Режим основателя включён на этом устройстве.</div><button class="btn sm ghost" id="founder-off">ВЫКЛЮЧИТЬ РЕЖИМ ОСНОВАТЕЛЯ</button>'
          : '<div class="eyebrow">РЕЖИМ ОСНОВАТЕЛЯ</div><form class="row" id="founder"><input class="input grow" name="c" placeholder="Код основателя" autocomplete="off" aria-label="Код основателя"><button class="btn sm ghost" style="height:46px">ВОЙТИ</button></form>'}
        <a class="btn sm ghost" href="#/ranks">ЛЕСТНИЦА РАНГОВ</a>`;
    }
    const hist = S.profile.orders.slice(-1)[0];
    screen(`
      <div class="topbar"><span style="width:44px"></span><div class="eyebrow">INVESTIGATOR FILE / 捜査官</div><a class="iconbtn" href="#/ranks" aria-label="Лестница рангов" style="font-family:var(--jp);font-weight:900">階</a></div>
      <div class="idcard">
        <div class="row" style="align-items:flex-start;gap:14px">
          <div class="photo" aria-hidden="true">${esc(r.jp.slice(0, 1))}</div>
          <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
            <div class="mono" style="font-size:9px;letter-spacing:.12em;color:#555550">${S.profile.founder ? 'ID 000-000 · ОСНОВАТЕЛЬ' : 'ID ' + esc(String(Math.abs(hash(S.profile.name)) % 1000000).padStart(6, '0').replace(/(\d{3})(\d{3})/, '$1-$2'))}</div>
            <div style="font-size:24px;font-weight:900;letter-spacing:-.02em;line-height:1;word-break:break-word">${esc(S.profile.name.toUpperCase())}</div>
            <div class="mono" style="font-size:10px;color:#3A3A36">${fmtNum(xp)} XP${hist ? ' · приказ №' + esc(hist.n) : ''}</div>
            ${S.profile.founder ? '<div class="row" style="gap:6px;flex-wrap:wrap"><span class="tag" style="background:var(--ink);color:var(--paper);font-size:9px">ВЫДАЁТ РАНГИ</span><span class="tag outline" style="font-size:9px">1 НА ВЕСЬ МИР</span></div>' : ''}
          </div>
        </div>
        <div class="rankrow">
          <div class="kanji">${esc(r.jp)}</div>
          <div class="grow"><div class="mono" style="font-size:9px;letter-spacing:.14em;color:#555550">РАНГ / 階級</div>
            <div style="font-size:24px;font-weight:900;letter-spacing:-.02em;line-height:1">${esc(r.name)}</div>
            <div class="mono" style="font-size:10px;margin-top:3px">${r.id === 'zero' ? 'выше Special Class · уникальный' : nx ? 'до ' + esc(nx.name) + ': ' + fmtNum(Math.max(0, nx.xp - xp)) + ' XP' : 'максимум по XP'}</div></div>
        </div>
        ${r.id !== 'zero' ? '<div class="progress" style="--n:1;color:#0A0A0A"><i style="background:linear-gradient(90deg,var(--accent) ' + pct + '%,transparent ' + pct + '%)"></i></div>' : ''}
        ${S.profile.founder ? '<div class="seal" aria-hidden="true">神</div>' : ''}
      </div>
      <div class="stats" style="--n:4">
        <div><b>${cleared.length}</b><span>ТОЧЕК</span></div>
        <div><b>${lines().filter((l) => l.complete).length}</b><span>ЛИНИЙ</span></div>
        <div><b style="color:var(--accent)">${streak()}д</b><span>СТРИК</span></div>
        <div><b>${countries}</b><span>РЕГИОНЫ</span></div>
      </div>
      <div class="tabs2" style="--n:3">
        <button data-pt="stamps" class="${profileTab === 'stamps' ? 'on' : ''}">ШТАМПЫ</button>
        <button data-pt="squad" class="${profileTab === 'squad' ? 'on' : ''}">ОТРЯД</button>
        <button data-pt="settings" class="${profileTab === 'settings' ? 'on' : ''}">НАСТРОЙКИ</button>
      </div>
      ${tabHtml}
    `);
    view().querySelectorAll('[data-pt]').forEach((b) => b.onclick = () => { profileTab = b.dataset.pt; renderProfile(); });
    const af = $('#add-friend');
    if (af) af.onsubmit = (e) => { e.preventDefault(); const n = e.target.n.value.trim(); if (!n) return; S.friends.push({ id: uid(), name: n, rank: 'r3', history: [] }); save(); renderProfile(); };
    if ($('#set-name-save')) $('#set-name-save').onclick = () => { const n = $('#set-name').value.trim(); if (n) { S.profile.name = n; save(); toast('Сохранено'); renderProfile(); } };
    if ($('#exp')) $('#exp').onclick = exportData;
    if ($('#imp')) $('#imp').onchange = importData;
    const fo = $('#founder');
    if (fo) fo.onsubmit = async (e) => {
      e.preventDefault();
      const code = e.target.c.value.trim().toUpperCase();
      if ((await sha256(code)) === FOUNDER_HASH) { S.profile.founder = true; save(); toast('Добро пожаловать, ZERO-CLASS'); renderProfile(); }
      else toast('Код не подошёл');
    };
    if ($('#founder-off')) $('#founder-off').onclick = () => { S.profile.founder = false; save(); renderProfile(); };
  }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  function exportData() {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'archive-quest-backup-' + today() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        if (!data || !Array.isArray(data.points)) throw new Error('bad');
        S = Object.assign(defaults(), data); save(); toast('Бэкап загружен: ' + S.points.length + ' точек'); route();
      } catch (err) { toast('Файл не похож на бэкап'); }
    };
    rd.readAsText(file);
  }

  // ---------- выдача ранга ----------
  function renderGrant(fid) {
    if (!S.profile.founder) { location.hash = '#/profile'; return; }
    const f = S.friends.find((x) => x.id === fid);
    if (!f) { location.hash = '#/profile'; return; }
    let pick = f.rank;
    const draw = (signed) => {
      screen(`
        <div class="topbar">${backBtn('#/profile', 'В профиль')}<div class="eyebrow">ПРИКАЗ О ПРИСВОЕНИИ / 辞令</div><span style="width:44px"></span></div>
        <div class="row box" style="padding:12px;gap:12px"><span class="avatar" style="width:44px;height:44px">${esc(initials(f.name))}</span>
          <span class="grow"><span style="display:block;font-size:18px;font-weight:800">${esc(f.name)}</span><span class="small">сейчас: ${esc(rankById(f.rank).name)}</span></span></div>
        <div class="eyebrow">НОВЫЙ РАНГ</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${RANKS.map((r) => `<button class="rank-opt ${pick === r.id ? 'on' : ''}" data-r="${r.id}"><span class="jp">${r.jp}</span><b>${r.name}</b><span class="mono">${r.id === f.rank ? 'ТЕКУЩИЙ' : ''}</span></button>`).join('')}
          <div class="rank-opt locked"><span class="jp">零</span><b>ZERO-CLASS</b><span class="mono">ЗАНЯТ · ТОЛЬКО ТЫ</span></div>
        </div>
        <label class="field"><span>ЗА ЧТО (ПОПАДЁТ В ДОСЬЕ)</span><input class="input" id="g-why" maxlength="80" placeholder="например, закрыл линию Шимокита за день"></label>
        ${signed ? `<div class="card row" style="gap:12px"><span class="stamp" style="width:46px;height:46px;border-width:2px;flex-shrink:0"><span class="jp" style="font-size:18px">認</span></span>
          <span class="mono" style="font-size:11px;line-height:1.45">Приказ №${esc(signed.n)} подписан. Отправь другу ссылку: открыв её, он получит ранг ${esc(rankById(signed.rank).name)}.</span></div>
          <button class="btn primary block" id="g-share">ОТПРАВИТЬ ПРИКАЗ</button>`
          : `<button class="btn primary block" id="g-sign">ПОДПИСАТЬ ПРИКАЗ · ${esc(rankById(pick).name)}</button>`}
      `);
      view().querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { pick = b.dataset.r; draw(null); });
      if ($('#g-sign')) $('#g-sign').onclick = () => {
        S.orderSeq += 1;
        const n = String(S.orderSeq).padStart(4, '0');
        const order = { n, to: f.name, rank: pick, why: $('#g-why').value.trim(), from: S.profile.name, at: new Date().toISOString() };
        f.rank = pick; f.history.push(order); save();
        draw(order);
      };
      if ($('#g-share')) $('#g-share').onclick = async () => {
        const o = f.history[f.history.length - 1];
        const url = location.origin + location.pathname + '#/order/' + b64enc(o);
        const text = 'Приказ №' + o.n + ': ' + o.to + ' → ' + rankById(o.rank).name;
        try {
          if (navigator.share) await navigator.share({ title: 'Archive Quest', text, url });
          else { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); }
        } catch (e) { /* отменено */ }
      };
    };
    draw(null);
  }

  // ---------- входящий приказ ----------
  function renderOrder(data) {
    let o;
    try { o = b64dec(data); } catch (e) { o = null; }
    if (!o || !rankById(o.rank) || o.rank === 'zero') { screen('<div class="empty">Приказ повреждён.</div><a class="btn ghost block" href="#/map">НА КАРТУ</a>'); return; }
    const r = rankById(o.rank);
    const applied = S.profile.orders.some((x) => x.n === o.n && x.from === o.from && x.at === o.at);
    screen(`
      <div style="flex:1"></div>
      <div class="eyebrow">ПРИКАЗ №${esc(o.n)} / 辞令</div>
      <div class="card" style="gap:14px;position:relative">
        <div class="mono" style="font-size:10px;letter-spacing:.12em;color:#555550">ОТ: ${esc(o.from)} · ZERO-CLASS · ${esc(fmtDate(o.at))}</div>
        <div style="font-size:15px;font-weight:700">Следователю <b>${esc(o.to)}</b> присваивается ранг</div>
        <div class="row" style="gap:14px"><div class="kanji" style="width:64px;height:64px;background:var(--ink);color:var(--accent);display:flex;align-items:center;justify-content:center;font-family:var(--jp);font-weight:900;font-size:26px">${esc(r.jp)}</div><div style="font-size:26px;font-weight:900">${esc(r.name)}</div></div>
        ${o.why ? '<div class="mono" style="font-size:12px">ЗА: ' + esc(o.why) + '</div>' : ''}
        <div class="stamp" style="position:absolute;right:14px;top:14px;width:52px;height:52px;border-width:2px"><span class="jp" style="font-size:20px">認</span></div>
      </div>
      ${applied ? '<div class="small">Этот приказ уже принят.</div><a class="btn ghost block" href="#/profile">В ПРОФИЛЬ</a>'
        : '<button class="btn primary block" id="o-accept">ПРИНЯТЬ РАНГ</button>'}
      <div style="flex:1"></div>
    `);
    if ($('#o-accept')) $('#o-accept').onclick = () => {
      if (!S.profile.name) S.profile.name = o.to;
      S.profile.grantedRank = o.rank; // действует последний приказ основателя
      S.profile.orders.push(o); save();
      toast('Ранг принят: ' + r.name);
      location.hash = '#/profile';
    };
  }

  // ---------- лестница рангов ----------
  function renderRanks() {
    const r = myRank();
    screen(`
      <div class="topbar">${backBtn('#/profile', 'В профиль')}<div class="eyebrow">RANK SYSTEM / 階級制度</div><span style="width:44px"></span></div>
      <h1 class="h1">ОТ RANK 3 ДО 零</h1>
      <div class="ladder">
        <div class="zero"><span class="jp">零</span><b>ZERO-CLASS</b><span class="mono" style="font-size:10px">ОСНОВАТЕЛЬ</span></div>
        ${RANKS.slice().reverse().map((x) => `<div class="${x.id === r.id ? 'cur' : ''}"><span class="jp">${x.jp}</span><span class="grow"><b style="display:block">${x.name}</b><span class="mono" style="font-size:10px;opacity:.75">${x.how}</span></span><span class="mono" style="font-size:11px;font-weight:600">${fmtNum(x.xp)} XP</span></div>`).join('')}
      </div>
      <div class="mono" style="font-size:11px;line-height:1.6;color:var(--muted)">
        <b style="color:var(--paper)">САМ</b> — XP за задачи точек, +${LINE_BONUS} XP за каждую закрытую линию. Без гео-печати — половина XP.<br>
        <b style="color:var(--accent)">ПРИКАЗ</b> — ZERO-CLASS выдаёт любой ранг до Special Class. Итоговый ранг — старший из двух.
      </div>
    `);
  }

  // ---------- старт ----------
  initMap();
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
