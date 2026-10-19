/**
 * 뱀파이어 서바이버 미니 - 모바일용 생존 게임
 * 조이스틱 이동, 자동 공격, 경험치 수집, 레벨업 업그레이드
 */

(function () {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // ——— 소리 (Web Audio API, 외부 파일 없음) ———
  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function playTone(freq, duration, type, volume) {
    const ax = getAudio();
    if (ax.state === 'suspended') ax.resume();
    const osc = ax.createOscillator();
    const gain = ax.createGain();
    osc.connect(gain);
    gain.connect(ax.destination);
    osc.frequency.value = freq;
    osc.type = type || 'square';
    gain.gain.setValueAtTime(volume || 0.08, ax.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ax.currentTime + duration);
    osc.start(ax.currentTime);
    osc.stop(ax.currentTime + duration);
  }
  function playNoise(duration, volume) {
    const ax = getAudio();
    if (ax.state === 'suspended') ax.resume();
    const bufSize = ax.sampleRate * duration;
    const buf = ax.createBuffer(1, bufSize, ax.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (volume || 0.1);
    const src = ax.createBufferSource();
    src.buffer = buf;
    const gain = ax.createGain();
    src.connect(gain);
    gain.connect(ax.destination);
    gain.gain.setValueAtTime(volume || 0.08, ax.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ax.currentTime + duration);
    src.start(ax.currentTime);
    src.stop(ax.currentTime + duration);
  }
  const sound = {
    shoot: function () { playTone(320, 0.04, 'square', 0.06); },
    enemyKill: function () { playNoise(0.08, 0.06); playTone(180, 0.06, 'square', 0.05); },
    xpPickup: function () { playTone(600, 0.05, 'sine', 0.04); },
    levelUp: function () { playTone(523, 0.12, 'sine', 0.1); playTone(659, 0.12, 'sine', 0.08); playTone(784, 0.15, 'sine', 0.09); },
    upgradeSelect: function () { playTone(440, 0.08, 'sine', 0.07); },
    damage: function () { playTone(120, 0.1, 'sawtooth', 0.07); playNoise(0.06, 0.05); },
    bomb: function () { playNoise(0.12, 0.08); playTone(90, 0.1, 'sawtooth', 0.06); },
    gameOver: function () { playTone(200, 0.2, 'sawtooth', 0.08); playTone(150, 0.25, 'sine', 0.06); },
    start: function () { playTone(400, 0.06, 'sine', 0.07); playTone(500, 0.1, 'sine', 0.06); },
  };
  let lastDamageSound = 0;

  // 게임 상태
  let gameRunning = false;
  let gamePaused = false; // 레벨업 선택 중
  let manualPaused = false; // 메뉴 버튼 옆 일시정지
  let gameTime = 0;
  let lastTime = 0;
  let gameOverRecorded = false;

  const RECORDS_KEY = 'vs-mini-top10-v1';
  function loadRecords() {
    try {
      const raw = localStorage.getItem(RECORDS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  function saveRecord(seconds, level) {
    const list = loadRecords();
    list.push({ seconds, level, at: Date.now() });
    list.sort((a, b) => (b.seconds - a.seconds) || (b.level - a.level));
    const top10 = list.slice(0, 10);
    localStorage.setItem(RECORDS_KEY, JSON.stringify(top10));
    return top10;
  }
  function formatTimeSec(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  function renderRecords() {
    const listEl = document.getElementById('records-list');
    if (!listEl) return;
    const list = loadRecords();
    if (!list.length) {
      listEl.innerHTML = '<li>기록이 없습니다</li>';
      return;
    }
    listEl.innerHTML = list
      .map((r, i) => `<li>#${i + 1} · ${formatTimeSec(r.seconds)} · Lv.${r.level}</li>`)
      .join('');
  }

  // 화면 크기 (고정 논리 해상도)
  const LOGIC_WIDTH = 400;
  const LOGIC_HEIGHT = 600;
  let scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0;

  // 플레이어
  const player = {
    x: LOGIC_WIDTH / 2,
    y: LOGIC_HEIGHT / 2,
    radius: 14,
    speed: 180,
    maxHp: 100,
    hp: 100,
    level: 1,
    xp: 0,
    xpToNext: 10,
    // 업그레이드 스탯
    damage: 15,
    defense: 0,
    attackRange: 80,
    attackCooldown: 0.8,
    attackTimer: 0,
    projectileCount: 1,
    moveSpeedBonus: 1,
    magnetRange: 60,
    regen: 0,
    bombCount: 3,
    maxBomb: 3,
  };

  // 입력 (조이스틱)
  let inputX = 0, inputY = 0;

  // 엔티티 풀
  let enemies = [];
  let projectiles = [];
  let xpGems = [];
  let upgradeItems = [];
  let particles = [];

  /** @type {'solo'|'host'|'guest'} */
  let netMode = 'solo';
  let mpPeer = null;
  let mpConn = null;
  let peerInput = { ix: 0, iy: 0 };
  let peerConnected = false;
  let snapshotSendAcc = 0;
  const partner = {
    x: LOGIC_WIDTH / 2 + 50,
    y: LOGIC_HEIGHT / 2,
    radius: 14,
    hp: 100,
    attackTimer: 0,
    bombCount: 3,
    maxBomb: 3,
  };

  function getSpawnAnchor() {
    if (netMode === 'host') {
      return { x: (player.x + partner.x) / 2, y: (player.y + partner.y) / 2 };
    }
    return { x: player.x, y: player.y };
  }

  function livingTargets() {
    return netMode === 'host' ? [player, partner] : [player];
  }

  // 폭탄
  const BOMB_RADIUS = 130;
  const BOMB_DAMAGE = 200;
  let bombPending = false;

  // 레벨 10의 배수에서 별 보스 1마리 스폰되도록 예약
  let bossPending = false;

  function updateBombUI() {
    const ui = document.getElementById('bomb-ui');
    const btn = document.getElementById('bomb-btn');
    const countEl = document.getElementById('bomb-count');
    if (!ui || !btn || !countEl) return;

    const actor = netMode === 'guest' ? partner : player;
    const bc = typeof actor.bombCount === 'number' ? actor.bombCount : 0;
    countEl.textContent = String(bc);

    const canUse = gameRunning && !gamePaused && bc > 0 && !(netMode === 'guest' && bombPending);
    btn.disabled = !canUse;
    ui.classList.toggle('hidden', !gameRunning);
  }

  function updateTopControlsUI() {
    const wrap = document.getElementById('top-right-controls');
    const pauseBtn = document.getElementById('pause-btn');
    if (!wrap || !pauseBtn) return;
    const show = gameRunning;
    wrap.classList.toggle('hidden', !show);
    pauseBtn.textContent = manualPaused ? '재개' : '일시정지';
  }

  function explodeAt(cx, cy) {
    sound.bomb();
    // 폭탄: 화면의 적을 전부 제거
    const killed = enemies;
    enemies = [];
    killed.forEach(e => {
      spawnXpGem(e.x, e.y, e.xpValue);
      for (let i = 0; i < 6; i++) {
        particles.push({
          x: e.x,
          y: e.y,
          vx: (Math.random() - 0.5) * 120,
          vy: (Math.random() - 0.5) * 120,
          life: 0.25,
          color: '#fb7185',
        });
      }
    });
    // 폭발 연출(중앙)
    for (let i = 0; i < 36; i++) {
      particles.push({
        x: cx,
        y: cy,
        vx: (Math.random() - 0.5) * 280,
        vy: (Math.random() - 0.5) * 280,
        life: 0.25,
        color: '#f97316',
      });
    }
  }

  function useBomb(actor) {
    if (!actor || actor.bombCount <= 0) return;
    actor.bombCount -= 1;
    explodeAt(actor.x, actor.y);
    if (netMode !== 'guest') updateBombUI();
  }

  // 업그레이드 목록 (레벨업 시 3개 중 선택)
  const UPGRADES = [
    { id: 'damage', name: '공격력 +5', desc: '데미지 증가', apply: p => { p.damage += 5; } },
    { id: 'speed', name: '이동속도 +1', desc: '이동 속도 증가', apply: p => { p.moveSpeedBonus += 1; } },
    { id: 'cooldown', name: '공격속도 +20%', desc: '공격 쿨다운 감소', apply: p => { p.attackCooldown -= 0.2; } },
    { id: 'bomb', name: '폭탄 +1', desc: '폭탄 보유량 증가', apply: p => { p.maxBomb += 1; p.bombCount = Math.min(p.bombCount + 1, p.maxBomb); } },
    { id: 'projectile', name: '투사체 +1', desc: '발사체 개수 증가', apply: p => { p.projectileCount += 1; } },
    { id: 'magnet', name: '자석 범위 +25%', desc: '경험치 끌어당김', apply: p => { p.magnetRange *= 1.25; } },
    { id: 'maxhp', name: '최대 체력 +20', desc: '체력 상한 증가', apply: p => { p.maxHp += 20; p.hp = Math.min(p.hp + 20, p.maxHp); } },
    { id: 'regen', name: '체력 재생', desc: '초당 체력 1 회복', apply: p => { p.regen += 1; } },
    { id: 'defense', name: '방어력 +5', desc: '받는 데미지 감소', apply: p => { p.defense += 5; } },
  ];

  const gameContainer = document.getElementById('game-container');

  function resize() {
    // 모바일: 실제 보이는 영역(세이프에리어 제외) 기준으로 크기 계산
    const w = gameContainer ? gameContainer.clientWidth : window.innerWidth;
    const h = gameContainer ? gameContainer.clientHeight : window.innerHeight;
    const ratio = Math.min(w / LOGIC_WIDTH, h / LOGIC_HEIGHT);
    const targetW = LOGIC_WIDTH * ratio;
    const targetH = LOGIC_HEIGHT * ratio;
    // 고해상도 디스플레이(레티나, 갤럭시, 아이폰)에서 선명하게 (최대 2배)
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(targetW * dpr);
    canvas.height = Math.floor(targetH * dpr);
    canvas.style.width = targetW + 'px';
    canvas.style.height = targetH + 'px';
    scaleX = canvas.width / LOGIC_WIDTH;
    scaleY = canvas.height / LOGIC_HEIGHT;
    offsetX = (w - targetW) / 2;
    offsetY = (h - targetH) / 2;
  }

  /** 스테이지(플레이어 레벨)별 일반 적 방어력: 레벨 2부터 매 레벨 +2, 20의 배수 레벨에서는 +3 */
  function enemyDefenseForStage(level) {
    if (level < 2) return 0;
    let d = 0;
    for (let k = 2; k <= level; k++) {
      d += k % 20 === 0 ? 3 : 2;
    }
    return d;
  }

  function spawnEnemy() {
    const anchor = getSpawnAnchor();
    const angle = Math.random() * Math.PI * 2;
    const dist = 280 + Math.random() * 120;
    const enemyLevel = Math.max(1, player.level);
    const isBoss = !!bossPending;
    if (isBoss) bossPending = false;
    const baseDefense = enemyDefenseForStage(player.level);
    const enemyDefense = baseDefense * (isBoss ? 2 : 1);

    // 원(원형) -> 삼각형(3) -> 사각형(4) -> 오각형(5) -> 육각형(6)
    // 레벨이 5를 넘어가면 모양이 다시 처음으로 돌아가도록 순환
    const sidesMap = [0, 3, 4, 5, 6];
    const shapeSides = isBoss ? 0 : sidesMap[(player.level - 1) % 5];
    const baseXpValue = Math.max(1, Math.floor(enemyLevel / 2));
    enemies.push({
      x: anchor.x + Math.cos(angle) * dist,
      y: anchor.y + Math.sin(angle) * dist,
      radius: (10 + Math.random() * 6) * (isBoss ? 1.35 : 1),
      hp: (15 + Math.floor(gameTime / 30) * 5) * (isBoss ? 7 : 1),
      maxHp: (15 + Math.floor(gameTime / 30) * 5) * (isBoss ? 7 : 1),
      defense: enemyDefense,
      isBoss,
      shapeSides,
      speed: 45 + gameTime / 20,
      xpValue: isBoss ? baseXpValue * 6 : baseXpValue,
    });
  }

  function spawnXpGem(x, y, value) {
    xpGems.push({ x, y, value, radius: 6, vy: 0 });
  }

  function spawnUpgradeItem() {
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 90;
    const x = Math.max(18, Math.min(LOGIC_WIDTH - 18, player.x + Math.cos(angle) * dist));
    const y = Math.max(18, Math.min(LOGIC_HEIGHT - 18, player.y + Math.sin(angle) * dist));
    upgradeItems.push({ x, y, radius: 10 });
  }

  function dealDamageToEnemies(cx, cy, radius, damagePerSec, dt) {
    enemies = enemies.filter(e => {
      const dx = e.x - cx, dy = e.y - cy;
      const d = Math.hypot(dx, dy);
      if (d < radius + e.radius) {
        // 고레벨에서도 최소 관통 피해가 들어가도록 보정
        const raw = (damagePerSec - (e.defense || 0)) * dt;
        const pierceFloor = damagePerSec * 0.15 * dt;
        const reducedDamage = Math.max(pierceFloor, raw);
        e.hp -= reducedDamage;
        if (e.hp <= 0) {
          sound.enemyKill();
          spawnXpGem(e.x, e.y, e.xpValue);
          for (let i = 0; i < 5; i++) {
            particles.push({
              x: e.x, y: e.y,
              vx: (Math.random() - 0.5) * 60,
              vy: (Math.random() - 0.5) * 60,
              life: 0.3,
              color: '#a78bfa',
            });
          }
          return false;
        }
        return true;
      }
      return true;
    });
  }

  function shootFrom(px, py) {
    const count = Math.max(1, Math.floor(player.projectileCount));
    const sorted = enemies
      .map(e => {
        const dx = e.x - px;
        const dy = e.y - py;
        return { e, d2: dx * dx + dy * dy };
      })
      .sort((a, b) => a.d2 - b.d2)
      .map(o => o.e);

    for (let i = 0; i < count; i++) {
      let angle;
      if (sorted.length === 0) {
        angle = (Math.PI * 2 * i) / count + (gameTime * 0.5) % (Math.PI * 2);
      } else {
        const idx = Math.min(i, sorted.length - 1);
        const target = sorted[idx];
        const dx = target.x - px;
        const dy = target.y - py;
        angle = Math.atan2(dy, dx);
        if (sorted.length === 1 && count > 1) {
          angle += (i - (count - 1) / 2) * 0.22;
        }
      }
      projectiles.push({
        x: px,
        y: py,
        vx: Math.cos(angle) * 320,
        vy: Math.sin(angle) * 320,
        radius: 8,
        damage: player.damage,
      });
    }
  }

  function shoot() {
    shootFrom(player.x, player.y);
  }

  function showLevelUpModal() {
    gamePaused = true;
    sound.levelUp();
    if (netMode === 'guest') {
      document.getElementById('guest-wait-overlay').classList.remove('hidden');
      return;
    }
    const modal = document.getElementById('levelup-modal');
    const optionsEl = document.getElementById('upgrade-options');
    optionsEl.innerHTML = '';
    const shuffled = [...UPGRADES].sort(() => Math.random() - 0.5).slice(0, 3);
    shuffled.forEach(up => {
      const btn = document.createElement('div');
      btn.className = 'upgrade-option';
      btn.innerHTML = `<div class="name">${up.name}</div><div class="desc">${up.desc}</div>`;
      btn.onclick = () => {
        sound.upgradeSelect();
        up.apply(player);
        if (netMode === 'host' && up.id === 'maxhp') {
          partner.hp = Math.min(partner.hp + 20, player.maxHp);
        }
        if (netMode === 'host' && up.id === 'bomb') {
          up.apply(partner);
        }
        modal.classList.add('hidden');
        gamePaused = false;
        updateBombUI();
      };
      optionsEl.appendChild(btn);
    });
    modal.classList.remove('hidden');
  }

  function applySnapshot(s) {
    gameTime = s.gameTime;
    gameRunning = s.gameRunning;
    gamePaused = s.gamePaused;
    Object.assign(player, s.player);
    Object.assign(partner, s.partner);
    enemies = s.enemies.map(e => ({ ...e }));
    projectiles = s.projectiles.map(p => ({ ...p }));
    xpGems = s.xpGems.map(g => ({ ...g }));
    particles = (s.particles || []).map(p => ({ ...p }));
    const mins = Math.floor(gameTime / 60);
    const secs = Math.floor(gameTime % 60);
    document.getElementById('timer').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    document.getElementById('level-display').textContent = `Lv.${player.level}`;
    document.getElementById('xp-bar').style.width = `${(player.xp / player.xpToNext) * 100}%`;
    document.getElementById('health-bar').style.width = `${(player.hp / player.maxHp) * 100}%`;
    document.getElementById('partner-health-bar').style.width = `${(partner.hp / player.maxHp) * 100}%`;
    document.getElementById('guest-wait-overlay').classList.toggle('hidden', !gamePaused);
    if (netMode === 'guest' && gameRunning) {
      document.getElementById('start-screen').classList.add('hidden');
      document.getElementById('guest-wait-start').classList.add('hidden');
    }
    if (!gameRunning) {
      document.getElementById('final-time').textContent = `생존 시간: ${mins}:${secs.toString().padStart(2, '0')}`;
      document.getElementById('final-level').textContent = `최종 레벨: ${player.level}`;
      document.getElementById('gameover-screen').classList.remove('hidden');
    } else {
      document.getElementById('gameover-screen').classList.add('hidden');
    }

    bombPending = false;
    updateBombUI();
  }

  function buildSnapshot() {
    return {
      type: 'snapshot',
      gameTime,
      gameRunning,
      gamePaused,
      player: { ...player },
      partner: { ...partner },
      enemies: enemies.map(e => ({
        x: e.x, y: e.y, radius: e.radius, hp: e.hp, maxHp: e.maxHp, defense: e.defense || 0, speed: e.speed, xpValue: e.xpValue,
        isBoss: !!e.isBoss,
        shapeSides: e.shapeSides || 0,
      })),
      projectiles: projectiles.map(p => ({
        x: p.x, y: p.y, vx: p.vx, vy: p.vy, radius: p.radius, damage: p.damage,
      })),
      xpGems: xpGems.map(g => ({ x: g.x, y: g.y, value: g.value, radius: g.radius })),
      particles: particles.slice(0, 48).map(p => ({
        x: p.x, y: p.y, vx: p.vx, vy: p.vy, life: p.life, color: p.color,
      })),
    };
  }

  function update(dt) {
    if (netMode === 'guest') {
      if (mpConn && mpConn.open) {
        mpConn.send({ type: 'input', ix: inputX, iy: inputY });
      }
      return;
    }

    if (!gameRunning || gamePaused || manualPaused) return;

    gameTime += dt;

    const mins = Math.floor(gameTime / 60);
    const secs = Math.floor(gameTime % 60);
    document.getElementById('timer').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    document.getElementById('level-display').textContent = `Lv.${player.level}`;
    document.getElementById('xp-bar').style.width = `${(player.xp / player.xpToNext) * 100}%`;
    document.getElementById('health-bar').style.width = `${(player.hp / player.maxHp) * 100}%`;
    if (netMode === 'host') {
      document.getElementById('partner-health-wrap').classList.remove('hidden');
      document.getElementById('partner-health-bar').style.width = `${(partner.hp / player.maxHp) * 100}%`;
    }

    const len = Math.hypot(inputX, inputY);
    if (len > 0.1) {
      const nx = inputX / len;
      const ny = inputY / len;
      player.x += nx * player.speed * player.moveSpeedBonus * dt;
      player.y += ny * player.speed * player.moveSpeedBonus * dt;
      player.x = Math.max(player.radius, Math.min(LOGIC_WIDTH - player.radius, player.x));
      player.y = Math.max(player.radius, Math.min(LOGIC_HEIGHT - player.radius, player.y));
    }

    if (netMode === 'host') {
      const len2 = Math.hypot(peerInput.ix, peerInput.iy);
      if (len2 > 0.1) {
        const nx = peerInput.ix / len2;
        const ny = peerInput.iy / len2;
        partner.x += nx * player.speed * player.moveSpeedBonus * dt;
        partner.y += ny * player.speed * player.moveSpeedBonus * dt;
        partner.x = Math.max(partner.radius, Math.min(LOGIC_WIDTH - partner.radius, partner.x));
        partner.y = Math.max(partner.radius, Math.min(LOGIC_HEIGHT - partner.radius, partner.y));
      }
      partner.attackTimer -= dt;
      if (partner.attackTimer <= 0) {
        partner.attackTimer = player.attackCooldown;
        shootFrom(partner.x, partner.y);
      }
    }

    if (player.regen > 0) {
      player.hp = Math.min(player.maxHp, player.hp + player.regen * dt);
      if (netMode === 'host') {
        partner.hp = Math.min(player.maxHp, partner.hp + player.regen * dt);
      }
    }

    player.attackTimer -= dt;
    if (player.attackTimer <= 0) {
      player.attackTimer = player.attackCooldown;
      shoot();
    }

    projectiles = projectiles.filter(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const r = p.radius;
      if (p.x < -r || p.x > LOGIC_WIDTH + r || p.y < -r || p.y > LOGIC_HEIGHT + r) {
        return false;
      }
      dealDamageToEnemies(p.x, p.y, p.radius, p.damage, dt);
      return true;
    });

    const targets = livingTargets();
    enemies.forEach(e => {
      let nearest = targets[0];
      let minD = Infinity;
      for (let ti = 0; ti < targets.length; ti++) {
        const t = targets[ti];
        const dd = Math.hypot(t.x - e.x, t.y - e.y);
        if (dd < minD) {
          minD = dd;
          nearest = t;
        }
      }
      const dx = nearest.x - e.x;
      const dy = nearest.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.x += (dx / d) * e.speed * dt;
      e.y += (dy / d) * e.speed * dt;
      for (let ti = 0; ti < targets.length; ti++) {
        const t = targets[ti];
        const dx2 = t.x - e.x;
        const dy2 = t.y - e.y;
        const d2 = Math.hypot(dx2, dy2);
        if (d2 < t.radius + e.radius) {
          const contactDmg = Math.max(0, 25 - player.defense) * dt;
          t.hp -= contactDmg;
          if (contactDmg > 0 && gameTime - lastDamageSound > 0.35) {
            lastDamageSound = gameTime;
            sound.damage();
          }
          e.x -= (dx2 / d2) * 30;
          e.y -= (dy2 / d2) * 30;
        }
      }
    });

    xpGems.forEach(g => {
      let best = null;
      let bestD = Infinity;
      for (let ti = 0; ti < targets.length; ti++) {
        const t = targets[ti];
        const dx = t.x - g.x;
        const dy = t.y - g.y;
        const d = Math.hypot(dx, dy);
        if (d < player.magnetRange && d < bestD) {
          bestD = d;
          best = { dx, dy, d };
        }
      }
      if (best && best.d > 0) {
        const pull = 400 * dt;
        g.x += (best.dx / best.d) * Math.min(pull, best.d);
        g.y += (best.dy / best.d) * Math.min(pull, best.d);
      }
    });
    xpGems = xpGems.filter(g => {
      for (let ti = 0; ti < targets.length; ti++) {
        const t = targets[ti];
        const d = Math.hypot(t.x - g.x, t.y - g.y);
        if (d < t.radius + g.radius) {
          player.xp += g.value;
          let leveled = false;
          while (player.level < 99 && player.xp >= player.xpToNext) {
            player.xp -= player.xpToNext;
            player.level++;
            if (player.level % 5 === 0) spawnUpgradeItem();
            if (player.level % 10 === 0) bossPending = true;
            player.xpToNext = Math.floor(player.xpToNext * 1.2) + 5;
            showLevelUpModal();
            leveled = true;
          }
          if (player.level >= 99) {
            player.xp = player.xpToNext;
          }
          if (!leveled) sound.xpPickup();
          return false;
        }
      }
      return true;
    });

    // 업그레이드 아이템: 먹으면 즉시 업그레이드 선택
    upgradeItems = upgradeItems.filter(item => {
      const d = Math.hypot(player.x - item.x, player.y - item.y);
      if (d < player.radius + item.radius) {
        showLevelUpModal();
        return false;
      }
      return true;
    });

    particles = particles.filter(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      return p.life > 0;
    });

    const spawnPerSec = Math.min(1.4, 0.16 + gameTime * 0.015);
    if (Math.random() < spawnPerSec * dt) spawnEnemy();

    const soloDead = netMode === 'solo' && player.hp <= 0;
    const hostDead = netMode === 'host' && player.hp <= 0 && partner.hp <= 0;
    if (soloDead || hostDead) {
      gameRunning = false;
      sound.gameOver();
      document.getElementById('final-time').textContent = `생존 시간: ${mins}:${secs.toString().padStart(2, '0')}`;
      document.getElementById('final-level').textContent = `최종 레벨: ${player.level}`;
      if (!gameOverRecorded) {
        gameOverRecorded = true;
        saveRecord(gameTime, player.level);
      }
      renderRecords();
      document.getElementById('gameover-screen').classList.remove('hidden');
    }

    if (netMode === 'host' && mpConn && mpConn.open) {
      snapshotSendAcc += dt;
      if (snapshotSendAcc >= 1 / 25) {
        snapshotSendAcc = 0;
        mpConn.send(buildSnapshot());
      }
    }
  }

  function draw() {
    ctx.save();
    ctx.scale(scaleX, scaleY);

    // 정다각형 경로
    function regularPolygonPath(x, y, r, sides) {
      const step = (Math.PI * 2) / sides;
      const start = -Math.PI / 2;
      ctx.moveTo(x + Math.cos(start) * r, y + Math.sin(start) * r);
      for (let i = 1; i < sides; i++) {
        const a = start + step * i;
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
    }

    // 5점 별 경로(보스)
    function starPath(x, y, outerR, points, innerRatio) {
      const innerR = outerR * innerRatio;
      const step = Math.PI / points;
      const start = -Math.PI / 2;
      ctx.moveTo(x + Math.cos(start) * outerR, y + Math.sin(start) * outerR);
      for (let i = 1; i < points * 2; i++) {
        const a = start + step * i;
        const r = (i % 2 === 0) ? outerR : innerR;
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
    }

    // 배경
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, LOGIC_WIDTH, LOGIC_HEIGHT);

    // 그리드
    ctx.strokeStyle = 'rgba(100, 80, 150, 0.15)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= LOGIC_WIDTH; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, LOGIC_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= LOGIC_HEIGHT; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(LOGIC_WIDTH, y);
      ctx.stroke();
    }

    // 경험치 젬
    xpGems.forEach(g => {
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fcd34d';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // 업그레이드 아이템
    upgradeItems.forEach(item => {
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath();
      ctx.moveTo(item.x, item.y - item.radius);
      ctx.lineTo(item.x + item.radius, item.y);
      ctx.lineTo(item.x, item.y + item.radius);
      ctx.lineTo(item.x - item.radius, item.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#67e8f9';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // 적 (모양: 원 -> 삼각형 -> 사각형 -> 오각형 -> 육각형, 레벨 10 배수는 별 보스)
    enemies.forEach(e => {
      const r = e.radius;
      const sides = e.shapeSides || 0;
      const isBoss = !!e.isBoss;

      // 바깥 색
      ctx.fillStyle = isBoss ? '#f59e0b' : '#7f1d1d';
      ctx.beginPath();
      if (isBoss) {
        starPath(e.x, e.y, r, 5, 0.45);
      } else if (sides <= 0) {
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      } else {
        regularPolygonPath(e.x, e.y, r, sides);
      }
      ctx.fill();

      // 안쪽 색(선명한 이중 테마)
      ctx.fillStyle = isBoss ? '#fde68a' : '#b91c1c';
      ctx.beginPath();
      const innerR = Math.max(3, r - 2);
      if (isBoss) {
        starPath(e.x, e.y, innerR, 5, 0.45);
      } else if (sides <= 0) {
        ctx.arc(e.x, e.y, innerR, 0, Math.PI * 2);
      } else {
        regularPolygonPath(e.x, e.y, innerR, sides);
      }
      ctx.fill();

      // HP 바
      if (e.hp < e.maxHp) {
        const barW = r * 2;
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(e.x - r, e.y - r - 8, barW, 4);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(e.x - r, e.y - r - 8, (e.hp / e.maxHp) * barW, 4);
      }
    });

    // 투사체
    projectiles.forEach(p => {
      ctx.fillStyle = '#a78bfa';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    });

    // 파티클
    particles.forEach(p => {
      ctx.globalAlpha = p.life / 0.3;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // 플레이어
    ctx.fillStyle = '#4c1d95';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#a78bfa';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius - 4, 0, Math.PI * 2);
    ctx.fill();

    if (netMode === 'host' || netMode === 'guest') {
      ctx.fillStyle = '#064e3b';
      ctx.beginPath();
      ctx.arc(partner.x, partner.y, partner.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#6ee7b7';
      ctx.beginPath();
      ctx.arc(partner.x, partner.y, partner.radius - 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function gameLoop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(gameLoop);
  }

  // 조이스틱
  const joystickBase = document.getElementById('joystick-base');
  const joystickHandle = document.getElementById('joystick-handle');
  const baseRect = () => joystickBase.getBoundingClientRect();
  const maxDist = 35;

  function setJoystick(px, py) {
    const rect = baseRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = px - cx;
    let dy = py - cy;
    const d = Math.hypot(dx, dy);
    if (d > maxDist) {
      dx = (dx / d) * maxDist;
      dy = (dy / d) * maxDist;
    }
    joystickHandle.style.transform = `translate(${dx}px, ${dy}px)`;
    inputX = dx / maxDist;
    inputY = dy / maxDist;
  }

  function resetJoystick() {
    joystickHandle.style.transform = 'translate(0, 0)';
    inputX = 0;
    inputY = 0;
  }

  joystickBase.addEventListener('touchstart', e => {
    e.preventDefault();
    setJoystick(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  joystickBase.addEventListener('touchmove', e => {
    e.preventDefault();
    setJoystick(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  joystickBase.addEventListener('touchend', e => {
    e.preventDefault();
    resetJoystick();
  }, { passive: false });

  joystickBase.addEventListener('mousedown', e => {
    e.preventDefault();
    setJoystick(e.clientX, e.clientY);
    const up = () => {
      resetJoystick();
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    const move = (e2) => setJoystick(e2.clientX, e2.clientY);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  // 시작 / 재시작
  function resetGame() {
    player.x = LOGIC_WIDTH / 2 - 40;
    player.y = LOGIC_HEIGHT / 2;
    partner.x = LOGIC_WIDTH / 2 + 40;
    partner.y = LOGIC_HEIGHT / 2;
    player.hp = player.maxHp = 100;
    partner.hp = 100;
    partner.attackTimer = 0;
    player.attackTimer = 0;
    player.level = 1;
    player.xp = 0;
    player.xpToNext = 10;
    player.damage = 15;
    player.defense = 0;
    player.attackRange = 80;
    player.attackCooldown = 0.8;
    player.projectileCount = 1;
    player.moveSpeedBonus = 1;
    player.magnetRange = 60;
    player.regen = 0;
    player.bombCount = player.maxBomb;
    partner.bombCount = partner.maxBomb;
    bombPending = false;
    gameTime = 0;
    enemies = [];
    projectiles = [];
    xpGems = [];
    upgradeItems = [];
    particles = [];
    gameRunning = true;
    gamePaused = false;
    manualPaused = false;
    gameOverRecorded = false;
    peerInput = { ix: 0, iy: 0 };
    if (netMode === 'solo') {
      document.getElementById('partner-health-wrap').classList.add('hidden');
    } else if (netMode === 'host') {
      document.getElementById('partner-health-wrap').classList.remove('hidden');
    }
    updateBombUI();
    updateTopControlsUI();
  }

  function setMpStatus(t) {
    const el = document.getElementById('mp-status');
    if (el) el.textContent = t || '';
  }

  function onPeerData(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'input' && netMode === 'host') {
      peerInput.ix = msg.ix || 0;
      peerInput.iy = msg.iy || 0;
      return;
    }
    if (msg.type === 'bomb' && netMode === 'host') {
      useBomb(partner);
      return;
    }
    if (msg.type === 'restart' && netMode === 'host') {
      document.getElementById('gameover-screen').classList.add('hidden');
      resetGame();
      if (mpConn && mpConn.open) mpConn.send({ type: 'gameStart' });
      return;
    }
    if (msg.type === 'gameStart' && netMode === 'guest') {
      document.getElementById('start-screen').classList.add('hidden');
      document.getElementById('guest-wait-start').classList.add('hidden');
      document.getElementById('gameover-screen').classList.add('hidden');
      document.getElementById('partner-health-wrap').classList.remove('hidden');
      gameRunning = true;
      gamePaused = false;
      bombPending = false;
      updateBombUI();
      return;
    }
    if (msg.type === 'snapshot' && netMode === 'guest') {
      applySnapshot(msg);
    }
  }

  function cleanupPeer() {
    if (mpConn) {
      try { mpConn.close(); } catch {}
      mpConn = null;
    }
    if (mpPeer) {
      try { mpPeer.destroy(); } catch {}
      mpPeer = null;
    }
    peerConnected = false;
  }

  function openHostPeer() {
    cleanupPeer();
    peerInput = { ix: 0, iy: 0 };
    const hostId = 'vs-mini-' + Math.random().toString(36).slice(2, 8);
    mpPeer = new window.Peer(hostId);
    setMpStatus('Peer 준비 중…');
    mpPeer.on('open', function (id) {
      document.getElementById('mp-host-id').value = id;
      setMpStatus('코드 생성됨. 상대가 참가하면 시작 가능');
    });
    mpPeer.on('connection', function (conn) {
      if (mpConn && mpConn.open) {
        conn.close();
        return;
      }
      mpConn = conn;
      conn.on('open', function () {
        peerConnected = true;
        document.getElementById('mp-start-btn').classList.remove('hidden');
        setMpStatus('상대 연결됨. 「둘이 시작」을 누르세요.');
      });
      conn.on('data', onPeerData);
      conn.on('close', function () {
        peerConnected = false;
        document.getElementById('mp-start-btn').classList.add('hidden');
        setMpStatus('상대 연결 종료');
      });
    });
    mpPeer.on('error', function () {
      setMpStatus('Peer 오류');
    });
  }

  function openGuestPeer(targetId) {
    cleanupPeer();
    mpPeer = new window.Peer();
    setMpStatus('참가 준비 중…');
    mpPeer.on('open', function () {
      const conn = mpPeer.connect(targetId, { reliable: true });
      mpConn = conn;
      conn.on('open', function () {
        netMode = 'guest';
        peerConnected = true;
        document.getElementById('guest-wait-start').classList.remove('hidden');
        setMpStatus('호스트 연결됨. 시작 대기…');
      });
      conn.on('data', onPeerData);
      conn.on('close', function () {
        peerConnected = false;
        setMpStatus('호스트 연결 종료');
      });
    });
    mpPeer.on('error', function () {
      setMpStatus('연결 실패: 코드 확인');
    });
  }

  document.getElementById('mp-host-btn').addEventListener('click', function () {
    netMode = 'host';
    document.getElementById('mp-start-btn').classList.add('hidden');
    openHostPeer();
  });

  document.getElementById('mp-guest-btn').addEventListener('click', function () {
    const targetId = document.getElementById('mp-peer-id').value.trim();
    if (!targetId) {
      setMpStatus('상대 연결 코드를 입력하세요.');
      return;
    }
    netMode = 'guest';
    openGuestPeer(targetId);
  });

  document.getElementById('mp-start-btn').addEventListener('click', function () {
    if (netMode !== 'host' || !peerConnected) {
      setMpStatus('상대가 먼저 참가해야 합니다.');
      return;
    }
    getAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    sound.start();
    document.getElementById('start-screen').classList.add('hidden');
    resetGame();
    if (mpConn && mpConn.open) mpConn.send({ type: 'gameStart' });
  });

  document.getElementById('start-btn').addEventListener('click', () => {
    cleanupPeer();
    netMode = 'solo';
    peerConnected = false;
    document.getElementById('mp-start-btn').classList.add('hidden');
    document.getElementById('guest-wait-start').classList.add('hidden');
    getAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    sound.start();
    document.getElementById('start-screen').classList.add('hidden');
    resetGame();
  });

  document.getElementById('restart-btn').addEventListener('click', () => {
    if (netMode === 'guest') {
      if (mpConn && mpConn.open) mpConn.send({ type: 'restart' });
      return;
    }
    sound.start();
    document.getElementById('gameover-screen').classList.add('hidden');
    resetGame();
    if (netMode === 'host' && mpConn && mpConn.open) mpConn.send({ type: 'gameStart' });
  });

  const pauseBtn = document.getElementById('pause-btn');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      if (!gameRunning || gamePaused) return;
      manualPaused = !manualPaused;
      updateTopControlsUI();
    });
  }

  const menuBtn = document.getElementById('menu-btn');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      gameRunning = false;
      gamePaused = false;
      manualPaused = false;
      document.getElementById('levelup-modal').classList.add('hidden');
      document.getElementById('guest-wait-overlay').classList.add('hidden');
      document.getElementById('gameover-screen').classList.add('hidden');
      document.getElementById('start-screen').classList.remove('hidden');
      document.getElementById('bomb-ui').classList.add('hidden');
      updateTopControlsUI();
      updateBombUI();
    });
  }

  const bombBtn = document.getElementById('bomb-btn');
  if (bombBtn) {
    bombBtn.addEventListener('click', () => {
      if (!gameRunning || gamePaused) return;
      if (netMode === 'guest') {
        if (bombPending) return;
        if (!mpConn || !mpConn.open) return;
        if (partner.bombCount <= 0) return;
        bombPending = true;
        updateBombUI();
        mpConn.send({ type: 'bomb' });
        return;
      }

      useBomb(player);
      bombPending = false;
      updateBombUI();
    });
  }

  window.addEventListener('resize', resize);
  // iOS/Android: 주소창·키보드 등으로 뷰포트가 바뀔 때 리사이즈
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize);
    window.visualViewport.addEventListener('scroll', resize);
  }
  resize();
  renderRecords();
  updateTopControlsUI();
  lastTime = performance.now();
  requestAnimationFrame(gameLoop);

  // 모바일: 아래로 당기기 새로고침·스크롤 방지 (게임 영역 터치 시)
  document.addEventListener('touchmove', function (e) {
    if (e.target.closest('#game-container')) e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchstart', function () {}, { passive: true });
})();
