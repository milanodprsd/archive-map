/* Archive Quest — общий отряд через Supabase.
   Без настроек в config.js приложение работает как раньше, только на телефоне. */
(function () {
  'use strict';

  const cfg = window.AQ_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const POLL_MS = 20000;          // как часто обновлять отряд, пока приложение открыто
  const SHARE_EVERY_MS = 30000;   // как часто отправлять своё место
  const FRESH_MS = 2 * 3600e3;    // показывать на карте места не старше 2 часов
  const SHARE_KEY = 'archive-quest:share-location';

  let A = null;                   // мост к app.js
  let sb = null;
  let session = null;
  let me = null;                  // моя строка profiles
  let squad = null;
  let members = [];
  let locations = [];
  let founderExists = true;
  let loadError = '';             // почему отряд не загрузился (показываем вместо вечной загрузки)
  let pollTimer = null, pushTimer = null, lastPushed = '', lastShareAt = 0;
  let squadLayer = null;

  const esc = (s) => A.esc(s);
  const sharing = () => { try { return localStorage.getItem(SHARE_KEY) === '1'; } catch (e) { return false; } };
  const setSharing = (on) => { try { localStorage.setItem(SHARE_KEY, on ? '1' : '0'); } catch (e) { /* пусто */ } };
  const ago = (iso) => {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (m < 1) return 'сейчас';
    if (m < 60) return m + ' мин назад';
    const h = Math.round(m / 60);
    return h + ' ч назад';
  };
  function errText(e) {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/founder already exists/.test(m)) return 'Основатель уже есть';
    if (/bad invite code/.test(m)) return 'Неверный код отряда';
    if (/only founder/.test(m)) return 'Только ZERO-CLASS';
    if (/Password should be/i.test(m)) return 'Пароль слишком простой (нужно от 6 символов)';
    if (/signups not allowed|Signups not allowed/i.test(m)) return 'Регистрация выключена в Supabase';
    if (/rate limit/i.test(m)) return 'Слишком часто. Подожди минуту';
    if (/relation .* does not exist|Could not find the (table|function)|schema cache/i.test(m)) return 'В Supabase нет таблиц. Запусти supabase/schema.sql';
    if (/permission denied for table/i.test(m)) return 'Нет прав на таблицы. Запусти supabase/schema.sql ещё раз';
    if (/JWT|token/i.test(m)) return 'Сессия устарела. Выйди и войди снова в «Настройках»';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Нет связи с сервером';
    return m;
  }

  // ---------- загрузка с сервера ----------
  async function refresh() {
    try { await refreshInner(); } catch (e) {
      console.warn(e);
      if (!me) { loadError = errText(e); A.onSyncChange(); }
    }
  }
  async function refreshInner() {
    if (!sb || !session) return;
    const uid = session.user.id;
    let { data: mine, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (!error && !mine) {
      // аккаунт создан раньше, чем схема в Supabase: создаём профиль сами
      const fix = await sb.rpc('ensure_profile');
      if (fix.error) console.warn(fix.error);
      ({ data: mine, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle());
    }
    if (error || !mine) {
      console.warn(error);
      loadError = error ? errText(error) : 'Профиль не найден на сервере. Запусти supabase/schema.sql ещё раз.';
      A.onSyncChange();
      return;
    }
    loadError = '';
    me = mine;
    const S = A.S();
    if (me) {
      // ранги — с сервера: основатель и приказы нельзя подделать
      S.profile.founder = !!me.is_founder;
      S.profile.grantedRank = me.granted_rank || null;
      if (!me.name && S.profile.name) pushProfile(true);
      A.save(true);
    }
    if (me && me.squad_id) {
      const [sq, mem, loc] = await Promise.all([
        sb.from('squads').select('*').eq('id', me.squad_id).maybeSingle(),
        sb.from('profiles').select('id,name,avatar,xp,granted_rank,is_founder,updated_at').eq('squad_id', me.squad_id),
        sb.from('locations').select('*').eq('squad_id', me.squad_id)
      ]);
      squad = sq.data || null;
      members = (mem.data || []).sort((a, b) => (b.is_founder - a.is_founder) || (b.xp - a.xp));
      locations = loc.data || [];
    } else {
      squad = null; members = []; locations = [];
      const fe = await sb.rpc('founder_exists');
      founderExists = fe.data !== false;
    }
    drawSquadOnMap();
    A.onSyncChange();
  }

  function memberRank(m) {
    if (m.is_founder) return A.ZERO;
    const byXP = A.rankFromXP(m.xp || 0);
    const g = m.granted_rank ? A.rankById(m.granted_rank) : null;
    return g && A.rankIndex(g.id) > A.rankIndex(byXP.id) ? g : byXP;
  }

  // ---------- отправка своего профиля ----------
  function pushProfile(now) {
    if (!sb || !session) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      const S = A.S();
      const body = { name: (S.profile.name || '').slice(0, 24), avatar: S.profile.avatar || null, xp: A.totalXP(), updated_at: new Date().toISOString() };
      const key = body.name + '|' + (body.avatar || '').length + ':' + (body.avatar || '').slice(-32) + '|' + body.xp;
      if (key === lastPushed) return;
      const { error } = await sb.from('profiles').update(body).eq('id', session.user.id);
      if (!error) lastPushed = key; else console.warn(error);
    }, now ? 0 : 1500);
  }

  // ---------- местоположение ----------
  async function shareLocation(force) {
    if (!sb || !session || !me || !me.squad_id || !sharing()) return;
    const pos = A.myPos();
    if (!pos || (!force && Date.now() - lastShareAt < SHARE_EVERY_MS)) return;
    lastShareAt = Date.now();
    const { error } = await sb.from('locations').upsert({ user_id: session.user.id, squad_id: me.squad_id, lat: pos.lat, lng: pos.lng, accuracy: pos.acc || null, updated_at: new Date().toISOString() });
    if (error) console.warn(error);
  }
  async function stopSharing() {
    setSharing(false);
    if (sb && session) await sb.from('locations').delete().eq('user_id', session.user.id);
    await refresh();
  }

  function drawSquadOnMap() {
    const map = A.map();
    if (!map) return;
    if (!squadLayer) squadLayer = window.L.layerGroup().addTo(map);
    squadLayer.clearLayers();
    if (!session || !me) return;
    const byId = Object.fromEntries(members.map((m) => [m.id, m]));
    locations.forEach((l) => {
      if (l.user_id === session.user.id) return;
      if (Date.now() - new Date(l.updated_at).getTime() > FRESH_MS) return;
      const m = byId[l.user_id];
      if (!m) return;
      const r = memberRank(m);
      const face = m.avatar ? '<img src="' + m.avatar + '" alt="">' : '<span>' + esc((m.name || '?').slice(0, 2).toUpperCase()) + '</span>';
      const html = '<div class="mate"><div class="mate-face">' + face + '</div><div class="mate-lbl"><b>' + esc(r.jp) + '</b> ' + esc((m.name || 'Без имени').toUpperCase()) + ' · ' + esc(ago(l.updated_at)) + '</div></div>';
      squadLayer.addLayer(window.L.marker([l.lat, l.lng], { icon: window.L.divIcon({ className: '', html, iconSize: [0, 0] }), interactive: false, zIndexOffset: 500 }));
    });
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      shareLocation(false);
      refresh();
    }, POLL_MS);
  }

  // ---------- интерфейс: настройки ----------
  function settingsHtml() {
    if (!enabled) return '';
    let body;
    if (!session) {
      body = `<div class="small" style="line-height:1.5">Войди, чтобы видеть отряд, аватарки друзей и где они сейчас. Первый вход по почте и паролю создаёт аккаунт.</div>
        <form id="sq-pass" style="display:flex;flex-direction:column;gap:8px">
          <input class="input" name="e" type="email" autocomplete="username" required placeholder="почта" aria-label="Почта">
          <input class="input" name="p" type="password" autocomplete="current-password" required minlength="6" placeholder="пароль (от 6 символов)" aria-label="Пароль">
          <button class="btn sm ghost" style="height:46px">ВОЙТИ / СОЗДАТЬ АККАУНТ</button>
        </form>`;
    } else {
      body = `<div class="small">Вошёл как ${esc(session.user.email || '')}${me && me.is_founder ? ' · ZERO-CLASS' : ''}</div>
        <button class="btn sm ghost" id="sq-out" type="button">ВЫЙТИ ИЗ АККАУНТА</button>`;
    }
    return `<div class="sep"></div><div class="eyebrow">ОТРЯД ОНЛАЙН / 班</div>${body}`;
  }
  function bindSettings() {
    if (!enabled) return;
    const form = document.getElementById('sq-pass');
    if (form) form.onsubmit = async (e) => {
      e.preventDefault();
      const email = e.target.e.value.trim(), password = e.target.p.value;
      const btn = form.querySelector('button'); btn.disabled = true;
      try {
        let { error } = await sb.auth.signInWithPassword({ email, password });
        if (error && /invalid login credentials/i.test(error.message)) {
          const r = await sb.auth.signUp({ email, password });
          if (r.error) {
            if (/already registered|already exists/i.test(r.error.message)) return A.toast('Неверный пароль');
            return A.toast(errText(r.error));
          }
          if (!r.data.session) return A.toast('Supabase ждёт подтверждения почты. Выключи «Confirm email» в настройках входа.');
          A.toast('Аккаунт создан');
        } else if (error) {
          if (/email not confirmed/i.test(error.message)) return A.toast('Почта не подтверждена. Выключи «Confirm email» в Supabase.');
          return A.toast(errText(error));
        } else A.toast('Вход выполнен');
      } finally { btn.disabled = false; }
    };
    const out = document.getElementById('sq-out');
    if (out) out.onclick = async () => {
      if (sharing()) await stopSharing();
      await sb.auth.signOut();
      const S = A.S(); S.profile.founder = false; S.profile.grantedRank = null; A.save(true);
      A.toast('Вышел'); A.rerender();
    };
  }

  // ---------- интерфейс: вкладка «Отряд» ----------
  function online() { return enabled && !!session; }
  function squadHtml() {
    if (!enabled) return null;
    if (!session) return `<div class="empty">Чтобы видеть друзей и их аватарки, войди в «Настройках → Отряд онлайн».</div>`;
    if (!me && loadError) return `<div class="empty">Отряд не загрузился: ${esc(loadError)}<br><br><button class="btn block" id="sq-retry">ПОВТОРИТЬ</button></div>`;
    if (!me) return `<div class="empty">Загружаю отряд…</div>`;
    if (!me.squad_id) {
      return `${!founderExists ? `<div class="card"><div class="h2">零 СТАТЬ ОСНОВАТЕЛЕМ</div><div class="mono" style="font-size:11px;line-height:1.5">Основатель один на весь мир: кто нажмёт первым, тот получит ZERO-CLASS и создаст отряд.</div><button class="btn primary block" id="sq-claim">Я ОСНОВАТЕЛЬ</button></div>` : ''}
        <div class="eyebrow">ВСТУПИТЬ В ОТРЯД</div>
        <form class="row" id="sq-join"><input class="input grow" name="c" maxlength="12" autocapitalize="characters" placeholder="Код отряда" aria-label="Код отряда" value="${esc(pendingJoin || '')}"><button class="btn sm ghost" style="height:46px">ВСТУПИТЬ</button></form>`;
    }
    const isFounder = me.is_founder;
    const locBy = Object.fromEntries(locations.map((l) => [l.user_id, l]));
    const myPos = A.myPos();
    const rows = members.map((m) => {
      const r = memberRank(m);
      const l = locBy[m.id];
      const fresh = l && Date.now() - new Date(l.updated_at).getTime() < FRESH_MS;
      const where = m.id === session.user.id ? (sharing() ? 'делишься местом' : 'место скрыто')
        : fresh ? (myPos ? A.fmtDist(A.distance(myPos, l)) + ' · ' : '') + ago(l.updated_at) : 'место скрыто';
      return `<div class="list-item" style="cursor:default">
        ${A.avatar(m.avatar, m.name || '?', 40)}
        <span class="grow"><span style="display:block;font-size:14px;font-weight:700">${esc(m.name || 'Без имени')}${m.id === session.user.id ? ' · ТЫ' : ''}</span>
        <span class="small">${esc(r.name)} · ${esc(r.jp)} · ${A.fmtNum(m.xp || 0)} XP</span>
        <span class="small" style="display:block">${fresh && m.id !== session.user.id ? '<a href="#/map" data-fly="' + m.id + '" style="color:var(--accent)">◎ ' + esc(where) + '</a>' : esc(where)}</span></span>
        ${isFounder && !m.is_founder ? '<button class="btn sm" style="border:1px solid var(--accent);color:var(--accent);background:none" data-grant="' + m.id + '">ВЫДАТЬ</button>' : ''}
      </div>`;
    }).join('');
    const invite = location.origin + location.pathname + '#/join/' + (squad ? squad.invite_code : '');
    return `<div class="between"><div><div class="eyebrow">ОТРЯД</div><div class="h2">${esc(squad ? squad.name : '')}</div></div>
        ${squad ? '<span class="tag paper">' + esc(squad.invite_code) + '</span>' : ''}</div>
      <label class="row box" style="padding:10px 12px;cursor:pointer;justify-content:space-between">
        <span><b style="display:block;font-size:14px">Показывать моё место отряду</b><span class="small">Только пока приложение открыто. Видят лишь участники отряда.</span></span>
        <input type="checkbox" id="sq-share" ${sharing() ? 'checked' : ''} style="width:24px;height:24px;accent-color:#FF3D2E;flex-shrink:0">
      </label>
      <div>${rows || '<div class="empty">В отряде пока только ты.</div>'}</div>
      ${squad ? '<button class="btn ghost block" id="sq-invite" data-url="' + esc(invite) + '">ПОЗВАТЬ В ОТРЯД</button>' : ''}
      ${!isFounder ? '<button class="btn sm ghost" id="sq-leave">ПОКИНУТЬ ОТРЯД</button>' : ''}`;
  }
  function bindSquad() {
    if (!online()) return;
    const retry = document.getElementById('sq-retry');
    if (retry) retry.onclick = () => { loadError = ''; A.onSyncChange(); refresh(); };
    const claim = document.getElementById('sq-claim');
    if (claim) claim.onclick = async () => {
      const { error } = await sb.rpc('claim_founder', { squad_name: 'ОТРЯД ' + (A.S().profile.name || '').toUpperCase() });
      if (error) return A.toast(errText(error));
      A.toast('零 Ты основатель'); await refresh();
    };
    const join = document.getElementById('sq-join');
    if (join) join.onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await sb.rpc('join_squad', { code: e.target.c.value });
      if (error) return A.toast(errText(error));
      pendingJoin = null; A.toast('Ты в отряде'); await refresh();
    };
    const share = document.getElementById('sq-share');
    if (share) share.onchange = async () => {
      if (share.checked) {
        setSharing(true); A.requestPosition(); A.toast('Отряд видит твоё место, пока приложение открыто');
        setTimeout(() => shareLocation(true).then(refresh), 1500);
      } else { await stopSharing(); A.toast('Место скрыто'); }
    };
    const inv = document.getElementById('sq-invite');
    if (inv) inv.onclick = async () => {
      const url = inv.dataset.url;
      try {
        if (navigator.share) await navigator.share({ title: 'Archive Quest', text: 'Вступай в отряд: код ' + (squad && squad.invite_code), url });
        else { await navigator.clipboard.writeText(url); A.toast('Ссылка скопирована'); }
      } catch (e) { /* отменено */ }
    };
    const leave = document.getElementById('sq-leave');
    if (leave) { let armed = false; leave.onclick = async () => {
      if (!armed) { armed = true; leave.textContent = 'ТОЧНО ПОКИНУТЬ?'; return; }
      setSharing(false); await sb.rpc('leave_squad'); A.toast('Ты вышел из отряда'); await refresh();
    }; }
    document.querySelectorAll('[data-grant]').forEach((b) => b.onclick = () => openGrant(b.dataset.grant));
    document.querySelectorAll('[data-fly]').forEach((a) => a.onclick = () => {
      const l = locations.find((x) => x.user_id === a.dataset.fly);
      if (l) setTimeout(() => A.map().setView([l.lat, l.lng], 16), 50);
    });
  }

  function openGrant(id) {
    const m = members.find((x) => x.id === id);
    if (!m) return;
    const cur = memberRank(m);
    let pick = m.granted_rank || cur.id;
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    const draw = () => {
      bg.innerHTML = `<form class="sheet" id="gr">
        <div class="between"><div class="eyebrow">ПРИКАЗ О ПРИСВОЕНИИ / 辞令</div><button type="button" class="iconbtn" data-x aria-label="Закрыть"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
        <div class="row box" style="padding:12px;gap:12px">${A.avatar(m.avatar, m.name || '?', 44)}<span class="grow"><b style="display:block;font-size:18px">${esc(m.name || 'Без имени')}</b><span class="small">сейчас: ${esc(cur.name)}</span></span></div>
        <div style="display:flex;flex-direction:column;gap:6px">${A.RANKS.map((r) => `<button type="button" class="rank-opt ${pick === r.id ? 'on' : ''}" data-r="${r.id}"><span class="jp">${r.jp}</span><b>${r.name}</b><span class="mono"></span></button>`).join('')}</div>
        <label class="field"><span>ЗА ЧТО</span><input class="input" name="why" maxlength="80" placeholder="например, закрыл линию за день"></label>
        <button class="btn primary block">ПОДПИСАТЬ ПРИКАЗ · ${esc(A.rankById(pick).name)}</button></form>`;
      bg.querySelector('[data-x]').onclick = () => bg.remove();
      bg.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { pick = b.dataset.r; const why = bg.querySelector('[name=why]').value; draw(); bg.querySelector('[name=why]').value = why; });
      bg.querySelector('#gr').onsubmit = async (e) => {
        e.preventDefault();
        const { error } = await sb.rpc('grant_rank', { target: m.id, new_rank: pick, why: e.target.why.value.trim() || null });
        if (error) return A.toast(errText(error));
        bg.remove(); A.toast('認 Приказ подписан: ' + (m.name || '') + ' → ' + A.rankById(pick).name); await refresh();
      };
    };
    draw();
    document.getElementById('app').appendChild(bg);
  }

  let pendingJoin = null;
  function handleJoinLink(code) {
    pendingJoin = (code || '').toUpperCase();
    if (!enabled) { A.toast('Сервер отряда не настроен'); location.hash = '#/profile'; return; }
    if (!session) A.toast('Войди в «Настройках → Отряд онлайн», потом нажми «Вступить»');
    A.openSquadTab();
  }

  // ---------- старт ----------
  async function init(bridge) {
    A = bridge;
    if (!enabled) return;
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    const { data } = await sb.auth.getSession();
    session = data.session;
    sb.auth.onAuthStateChange((_event, s) => {
      const was = !!session; session = s;
      if (!!s !== was) { if (s) { refresh(); startPolling(); } else { me = null; squad = null; members = []; locations = []; drawSquadOnMap(); A.onSyncChange(); } }
    });
    if (session) { await refresh(); startPolling(); shareLocation(true); }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session) { refresh(); shareLocation(true); } });
  }

  window.AQSync = {
    enabled, init, online,
    onSave: () => pushProfile(false),
    onPosition: () => shareLocation(false),
    settingsHtml, bindSettings, squadHtml, bindSquad, handleJoinLink, redraw: drawSquadOnMap
  };
})();
