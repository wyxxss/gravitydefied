(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    category: 0,
    categories: [],
    currentLevel: null,
    progress: loadProgress(),
    controls: { throttle: false, brake: false, leanBack: false, leanForward: false },
    running: false,
    paused: false,
    resultShown: false,
    raf: 0,
    lastFrame: 0,
    elapsed: 0,
    sim: null,
    canvasSize: { w: 0, h: 0, dpr: 1 },
    audioOn: true,
    audioContext: null,
    lastHintAt: 0,
  };

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem('gd-remaster-progress') || '{"best":{},"completed":{},"lastLevel":null}');
    } catch (_) {
      return { best: {}, completed: {}, lastLevel: null };
    }
  }
  function saveProgress() {
    try { localStorage.setItem('gd-remaster-progress', JSON.stringify(state.progress)); } catch (_) { /* private mode */ }
  }
  function allLevels() { return state.categories.flatMap(c => c.levels); }
  function getLevelById(id) { return allLevels().find(l => l.id === id) || null; }
  function formatTime(ms) {
    const t = Math.max(0, ms) / 1000;
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const cs = Math.floor((t % 1) * 100);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
  }
  function categoryLabel(i) { return ['ЛЁГКАЯ ТРАССА','СРЕДНЯЯ ТРАССА','СЛОЖНАЯ ТРАССА'][i] || 'TRIAL TRACK'; }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  async function init() {
    try {
      const response = await fetch('./data/levels.json');
      if (!response.ok) throw new Error('Не удалось загрузить трассы');
      const data = await response.json();
      state.categories = data.categories;
      renderCategoryTabs();
      renderTrackList();
      updateContinueStrip();
      bindUI();
      if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      }
    } catch (error) {
      $('trackList').innerHTML = `<div class="empty-state">Не получилось загрузить список трасс. Открой приложение через локальный сервер или GitHub Pages.</div>`;
      console.error(error);
    }
  }

  function renderCategoryTabs() {
    document.querySelectorAll('.category-tab').forEach(btn => {
      const active = Number(btn.dataset.category) === state.category;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function terrainPreview(level) {
    const pts = level.terrain;
    if (!pts || pts.length < 2) return '';
    const minX = Math.min(...pts.map(p => p[0]));
    const maxX = Math.max(...pts.map(p => p[0]));
    const ys = pts.map(p => p[1]);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const step = Math.max(1, Math.floor(pts.length / 26));
    const sampled = pts.filter((_,i) => i === 0 || i === pts.length-1 || i % step === 0);
    const d = sampled.map((p,i) => {
      const x = 8 + ((p[0]-minX) / Math.max(1,maxX-minX))*164;
      const y = 25 - ((p[1]-minY) / Math.max(1,maxY-minY))*20;
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg viewBox="0 0 180 34" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="rgba(103,216,255,.7)" stroke-width="1.6" vector-effect="non-scaling-stroke"/><path d="${d} L172,34 L8,34 Z" fill="rgba(39,148,192,.10)"/></svg>`;
  }

  function renderTrackList() {
    const list = $('trackList');
    const query = $('trackSearch').value.trim().toLowerCase();
    const category = state.categories[state.category];
    const levels = (category?.levels || []).filter(level => !query || level.name.toLowerCase().includes(query) || String(level.number).includes(query));
    $('visibleCount').textContent = String(levels.length).padStart(3,'0');
    $('listPageText').textContent = `01 — ${String(category?.levels.length || 0).padStart(3,'0')}`;
    list.replaceChildren();
    if (!levels.length) {
      list.innerHTML = '<div class="empty-state">Ничего не нашлось. Попробуй другое название.</div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    levels.forEach(level => {
      const best = state.progress.best[level.id];
      const completed = !!state.progress.completed[level.id];
      const row = document.createElement('article');
      row.className = `track-row${completed ? ' completed' : ''}`;
      const select = document.createElement('button');
      select.className = 'track-select';
      select.type = 'button';
      select.innerHTML = `<span class="track-number">${String(level.number).padStart(2,'0')}</span><span class="track-title"><strong>${escapeHtml(level.name)}</strong><small>${level.vertices} POINTS / ORIGINAL TRACK</small></span><span class="track-preview">${terrainPreview(level)}</span>`;
      select.addEventListener('click', () => startGame(level));
      const record = document.createElement('div');
      record.className = `track-record${best ? '' : ' empty'}`;
      record.textContent = best ? formatTime(best) : 'NO RECORD';
      const status = document.createElement('div');
      status.className = 'track-status';
      status.innerHTML = `<i class="status-dot"></i><span>${completed ? 'ПРОЙДЕНА' : 'ДОСТУПНА'}</span>`;
      row.append(select, record, status);
      row.addEventListener('click', (event) => {
        if (!event.target.closest('button')) startGame(level);
      });
      fragment.append(row);
    });
    list.append(fragment);
  }

  function updateContinueStrip() {
    const level = getLevelById(state.progress.lastLevel);
    if (level) {
      $('continueStrip').hidden = false;
      $('continueName').textContent = level.name;
    } else {
      $('continueStrip').hidden = true;
    }
  }

  function bindUI() {
    document.querySelectorAll('.category-tab').forEach(btn => btn.addEventListener('click', () => {
      state.category = Number(btn.dataset.category);
      renderCategoryTabs(); renderTrackList();
    }));
    $('trackSearch').addEventListener('input', renderTrackList);
    $('jumpToTracks').addEventListener('click', () => $('tracksSection').scrollIntoView({behavior:'smooth'}));
    $('heroPlay').addEventListener('click', () => startGame(state.categories[0].levels[0]));
    $('continuePlay').addEventListener('click', () => {
      const level = getLevelById(state.progress.lastLevel);
      if (level) startGame(level);
    });
    $('homeBrand').addEventListener('click', () => showHome());
    $('backHome').addEventListener('click', () => showHome());
    $('pauseButton').addEventListener('click', pauseGame);
    $('resumeButton').addEventListener('click', resumeGame);
    $('restartFromPause').addEventListener('click', () => startGame(state.currentLevel));
    $('exitFromPause').addEventListener('click', showHome);
    $('retryButton').addEventListener('click', () => startGame(state.currentLevel));
    $('nextButton').addEventListener('click', startNextLevel);
    $('resultHomeButton').addEventListener('click', showHome);
    $('soundToggle').addEventListener('click', toggleSound);
    document.querySelectorAll('[data-control]').forEach(bindHoldControl);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearControls);
    document.addEventListener('visibilitychange', () => { if (document.hidden && state.running) pauseGame(); });
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 150));
    document.addEventListener('keydown', event => {
      if (event.key === '/' && $('homeView').hidden === false && document.activeElement !== $('trackSearch')) {
        event.preventDefault(); $('trackSearch').focus();
      }
    });
  }

  function bindHoldControl(button) {
    const name = button.dataset.control;
    const press = (event) => {
      event.preventDefault();
      if (!state.running || state.paused || state.resultShown) return;
      state.controls[name] = true;
      button.classList.add('pressed');
      try { button.setPointerCapture(event.pointerId); } catch (_) {}
    };
    const release = (event) => {
      if (event) event.preventDefault();
      state.controls[name] = false;
      button.classList.remove('pressed');
    };
    button.addEventListener('pointerdown', press);
    ['pointerup','pointercancel','lostpointercapture','pointerleave'].forEach(type => button.addEventListener(type, release));
    button.addEventListener('contextmenu', e => e.preventDefault());
  }

  function onKeyDown(event) {
    const key = event.key.toLowerCase();
    if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key)) event.preventDefault();
    if (!state.running || state.paused) {
      if (key === 'escape' && !state.paused && !state.resultShown && !$('gameView').hidden) pauseGame();
      return;
    }
    if (key === 'arrowup' || key === 'w' || key === ' ') state.controls.throttle = true;
    if (key === 'arrowdown' || key === 's') state.controls.brake = true;
    if (key === 'arrowleft' || key === 'a') state.controls.leanBack = true;
    if (key === 'arrowright' || key === 'd') state.controls.leanForward = true;
    if (key === 'escape') pauseGame();
    if (key === 'r') startGame(state.currentLevel);
  }
  function onKeyUp(event) {
    const key = event.key.toLowerCase();
    if (key === 'arrowup' || key === 'w' || key === ' ') state.controls.throttle = false;
    if (key === 'arrowdown' || key === 's') state.controls.brake = false;
    if (key === 'arrowleft' || key === 'a') state.controls.leanBack = false;
    if (key === 'arrowright' || key === 'd') state.controls.leanForward = false;
  }
  function clearControls() {
    Object.keys(state.controls).forEach(k => state.controls[k] = false);
    document.querySelectorAll('.control-button').forEach(b => b.classList.remove('pressed'));
  }

  function sampleTerrain(level, x) {
    const pts = level.terrain;
    if (x <= pts[0][0]) return pts[0][1];
    const last = pts[pts.length - 1];
    if (x >= last[0]) return last[1];
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid][0] <= x) lo = mid; else hi = mid;
    }
    const [x1,y1] = pts[lo], [x2,y2] = pts[hi];
    const span = Math.max(.001, x2 - x1);
    return y1 + (y2 - y1) * ((x - x1) / span);
  }
  function terrainSlope(level, x, dx=16) {
    return Math.atan2(sampleTerrain(level, x + dx) - sampleTerrain(level, x - dx), dx * 2);
  }

  function startGame(level) {
    if (!level) return;
    cancelAnimationFrame(state.raf);
    clearControls();
    state.currentLevel = level;
    state.elapsed = 0;
    state.running = true;
    state.paused = false;
    state.resultShown = false;
    state.lastFrame = 0;
    state.progress.lastLevel = level.id;
    saveProgress();
    const slope = terrainSlope(level, level.startX + 30);
    state.sim = {
      x: level.startX + 4, y: sampleTerrain(level,level.startX + 4) + 17,
      startX: level.startX, vx: 0, vy: 0, angle: slope, omega: 0,
      wheelbase: 78, wheelRadius: 14, wheelSpin: 0,
      grounded: true, crashed: false, cameraX: level.startX - 190, cameraY: 0,
      distance: 0, impact: 0, particles: [], shake: 0,
      startedAt: performance.now(), lastGrounded: true,
    };
    $('homeView').hidden = true;
    $('gameView').hidden = false;
    $('gameCategory').textContent = `${categoryLabel(level.category)} · ${String(level.number).padStart(3,'0')}`;
    $('gameLevelName').textContent = level.name;
    $('timeStat').textContent = '00:00.00';
    $('speedStat').textContent = '0';
    $('distanceStat').innerHTML = '0<span>%</span>';
    $('progressBar').style.width = '0%';
    $('pauseModal').hidden = true;
    $('resultModal').hidden = true;
    $('canvasHint').hidden = false;
    $('countdownOverlay').hidden = true;
    resizeCanvas();
    state.raf = requestAnimationFrame(loop);
  }

  function showHome() {
    cancelAnimationFrame(state.raf);
    state.running = false; state.paused = false; state.resultShown = false;
    clearControls();
    $('pauseModal').hidden = true; $('resultModal').hidden = true;
    $('gameView').hidden = true; $('homeView').hidden = false;
    updateContinueStrip(); renderTrackList();
    window.scrollTo({top:0,behavior:'instant'});
  }

  function pauseGame() {
    if (!state.running || state.resultShown) return;
    state.running = false; state.paused = true;
    cancelAnimationFrame(state.raf); clearControls();
    $('pauseModal').hidden = false;
  }
  function resumeGame() {
    if (!state.paused) return;
    state.paused = false; state.running = true; state.lastFrame = 0;
    $('pauseModal').hidden = true;
    state.raf = requestAnimationFrame(loop);
  }

  function resizeCanvas() {
    const canvas = $('gameCanvas');
    if (!canvas || $('gameView').hidden) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width*dpr);
    canvas.height = Math.round(rect.height*dpr);
    state.canvasSize = {w:rect.width,h:rect.height,dpr};
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    if (state.sim) drawGame(ctx, rect.width, rect.height, 0);
  }

  function loop(now) {
    if (!state.running || !state.sim) return;
    if (!state.lastFrame) state.lastFrame = now;
    const dt = Math.min(.032, Math.max(.001, (now - state.lastFrame) / 1000));
    state.lastFrame = now;
    state.elapsed += dt * 1000;
    updatePhysics(dt);
    const canvas = $('gameCanvas');
    const ctx = canvas.getContext('2d');
    const {w,h,dpr} = state.canvasSize;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    drawGame(ctx,w,h,dt);
    updateHUD();
    if (state.sim.crashed) {
      state.running = false;
      clearControls();
      state.raf = requestAnimationFrame(() => showResult(false));
      return;
    }
    if (state.sim.x >= state.currentLevel.finishX - 3) {
      state.running = false;
      clearControls();
      state.raf = requestAnimationFrame(() => showResult(true));
      return;
    }
    state.raf = requestAnimationFrame(loop);
  }

  function updatePhysics(dt) {
    const s = state.sim, l = state.currentLevel, c = state.controls;
    const oldVy = s.vy;
    const onGround = s.grounded;
    const throttle = c.throttle ? 1 : 0;
    const brake = c.brake ? 1 : 0;
    const lean = (c.leanBack ? 1 : 0) - (c.leanForward ? 1 : 0);
    const gravity = 680;
    const maxSpeed = 310;

    // Drive force is strongest while the rear wheel has traction.
    const rearX = s.x - Math.cos(s.angle) * s.wheelbase * .5;
    const rearGround = sampleTerrain(l, rearX);
    const rearWheelY = s.y - Math.sin(s.angle) * s.wheelbase * .5;
    const rearContact = rearWheelY - s.wheelRadius <= rearGround + 3;
    if (throttle) s.vx += (rearContact ? 285 : 95) * dt;
    if (brake) s.vx -= (s.vx > 0 ? 460 : 220) * dt;
    if (!throttle && !brake) s.vx *= Math.pow(onGround ? .982 : .996, dt*60);
    s.vx = Math.max(-95, Math.min(maxSpeed, s.vx));

    // Air control rotates the bike; on the ground it nudges the chassis without overpowering the slope.
    s.omega += lean * (onGround ? 2.2 : 4.9) * dt;
    s.omega *= Math.pow(onGround ? .78 : .986, dt*60);
    s.vy -= gravity * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.angle += s.omega * dt;
    s.angle = Math.max(-2.2, Math.min(2.2, s.angle));
    s.wheelSpin += s.vx * dt / s.wheelRadius;

    const half = s.wheelbase * .5;
    const cos = Math.cos(s.angle), sin = Math.sin(s.angle);
    const rear = {x:s.x-half*cos, y:s.y-half*sin};
    const front = {x:s.x+half*cos, y:s.y+half*sin};
    const rearGroundNow = sampleTerrain(l,rear.x);
    const frontGroundNow = sampleTerrain(l,front.x);
    const rearPen = rearGroundNow + s.wheelRadius - rear.y;
    const frontPen = frontGroundNow + s.wheelRadius - front.y;
    const wasGrounded = s.grounded;
    const correction = Math.max(rearPen, frontPen, 0);
    s.grounded = correction > 0;
    if (correction > 0) {
      s.y += correction + .02;
      if (s.vy < 0) s.vy = 0;
      if (!wasGrounded) s.impact = Math.max(0,-oldVy);
      const both = rearPen > -4 && frontPen > -4;
      if (both) {
        const target = Math.atan2(frontGroundNow-rearGroundNow,s.wheelbase);
        let diff = Math.atan2(Math.sin(target-s.angle),Math.cos(target-s.angle));
        s.angle += diff * Math.min(1,dt*8.5);
        s.omega *= .46;
        if (Math.abs(lean) < .1) s.omega *= .78;
      } else {
        const touchTarget = terrainSlope(l, rearPen > frontPen ? rear.x : front.x, 12);
        const diff = Math.atan2(Math.sin(touchTarget-s.angle),Math.cos(touchTarget-s.angle));
        s.omega += diff * dt * 1.25;
      }
      if (s.impact > 430 && Math.abs(s.angle) > .66) crash('landing');
      s.impact *= .8;
    } else {
      s.impact = Math.max(s.impact, Math.max(0,-oldVy));
    }

    // The rider's head and frame are vulnerable on sharp landings or steep rotations.
    const headX = s.x - 9*cos - 43*sin;
    const headY = s.y - 9*sin + 43*cos;
    const headGround = sampleTerrain(l,headX);
    if (headY - 7 < headGround - 1) crash('head');
    if (Math.abs(s.angle) > 1.42 && s.grounded) crash('angle');
    if (s.x > l.finishX + 10) s.x = l.finishX + 10;
    s.distance = Math.max(0,Math.min(1,(s.x-s.startX)/Math.max(1,(l.finishX-s.startX))));
    s.cameraX += ((s.x - 210) - s.cameraX) * Math.min(1,dt*3.6);
    const targetCamY = s.y - 30;
    s.cameraY += (targetCamY - s.cameraY) * Math.min(1,dt*2.4);
    s.shake *= .88;
  }

  function crash(reason) {
    const s = state.sim;
    if (s.crashed) return;
    s.crashed = true;
    s.crashReason = reason;
    s.shake = 10;
    tone(115, .12, 'sawtooth');
    try { if (navigator.vibrate) navigator.vibrate([35,25,55]); } catch (_) {}
  }

  function updateHUD() {
    const s = state.sim;
    $('timeStat').textContent = formatTime(state.elapsed);
    $('speedStat').textContent = String(Math.round(Math.abs(s.vx)*.36));
    const pct = Math.round(s.distance*100);
    $('distanceStat').innerHTML = `${pct}<span>%</span>`;
    $('progressBar').style.width = `${pct}%`;
    if (state.elapsed > 1700) $('canvasHint').hidden = true;
  }

  function drawGame(ctx, width, height, dt) {
    const s = state.sim, l = state.currentLevel;
    if (!s || !l || !width || !height) return;
    ctx.save();
    const shake = s.shake || 0;
    if (shake > .2) ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);
    const sky = ctx.createLinearGradient(0,0,0,height);
    sky.addColorStop(0,'#122b40'); sky.addColorStop(.48,'#1c374b'); sky.addColorStop(1,'#172735');
    ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
    const scale = Math.max(.19,Math.min(.57,width/670,height/285));
    const camX = s.cameraX;
    const camY = s.cameraY;
    const sx = x => (x-camX)*scale;
    const sy = y => height*.58-(y-camY)*scale;

    // Sun haze and far ridgelines.
    const glow=ctx.createRadialGradient(width*.78,height*.22,1,width*.78,height*.22,height*.34);
    glow.addColorStop(0,'rgba(104,203,237,.18)');glow.addColorStop(1,'rgba(104,203,237,0)');
    ctx.fillStyle=glow;ctx.fillRect(0,0,width,height*.72);
    ctx.fillStyle='rgba(61,104,126,.20)';
    ctx.beginPath();ctx.moveTo(0,height*.55);
    for(let x=0;x<=width+25;x+=25){const y=height*.46+Math.sin((x+camX*.08)*.009)*14+Math.sin((x+camX*.06)*.021)*7;ctx.lineTo(x,y)}
    ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.closePath();ctx.fill();
    // Technical grid fades toward the horizon.
    ctx.save();ctx.strokeStyle='rgba(146,204,225,.075)';ctx.lineWidth=1;
    const gridX=80*scale;const offset=((camX%80)+80)%80*scale;
    for(let x=-offset;x<width;x+=gridX){ctx.beginPath();ctx.moveTo(x,height*.28);ctx.lineTo(x,height);ctx.stroke()}
    for(let y=height*.38;y<height;y+=34){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke()}
    ctx.restore();

    // Track surface.
    const pts=l.terrain;
    const first= Math.max(0, findTerrainStart(pts, camX-150));
    ctx.beginPath();
    let started=false;
    for(let i=first;i<pts.length;i++){
      const [x,y]=pts[i];
      if(x>camX+width/scale+180) break;
      const px=sx(x),py=sy(y);
      if(!started){ctx.moveTo(px,py);started=true}else ctx.lineTo(px,py);
    }
    if(started){ctx.lineTo(width+50,height+50);ctx.lineTo(-50,height+50);ctx.closePath();
      const groundFill=ctx.createLinearGradient(0,height*.35,0,height);
      groundFill.addColorStop(0,'#243a48');groundFill.addColorStop(1,'#101a25');ctx.fillStyle=groundFill;ctx.fill();
    }
    ctx.beginPath();
    for(let i=first;i<pts.length;i++){
      const [x,y]=pts[i]; if(x>camX+width/scale+180)break;
      if(i===first)ctx.moveTo(sx(x),sy(y));else ctx.lineTo(sx(x),sy(y));
    }
    ctx.strokeStyle='#7ce0ff';ctx.lineWidth=2.3;ctx.shadowColor='rgba(92,216,255,.45)';ctx.shadowBlur=10;ctx.stroke();ctx.shadowBlur=0;
    ctx.strokeStyle='rgba(8,19,29,.8)';ctx.lineWidth=5;ctx.beginPath();
    for(let i=first;i<pts.length;i++){const [x,y]=pts[i];if(x>camX+width/scale+180)break;if(i===first)ctx.moveTo(sx(x),sy(y)+4);else ctx.lineTo(sx(x),sy(y)+4)}ctx.stroke();

    // Finish gate at the last terrain point.
    if (l.finishX > camX-100 && l.finishX < camX+width/scale+120) {
      const fx=sx(l.finishX), fy=sy(sampleTerrain(l,l.finishX));
      ctx.strokeStyle='rgba(223,239,247,.75)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(fx,fy-65*scale);ctx.lineTo(fx,fy+2);ctx.stroke();
      ctx.fillStyle='#ffb36a';ctx.beginPath();ctx.moveTo(fx,fy-65*scale);ctx.lineTo(fx+32*scale,fy-57*scale);ctx.lineTo(fx,fy-49*scale);ctx.closePath();ctx.fill();
      ctx.fillStyle='rgba(220,239,248,.65)';ctx.font='700 8px Arial';ctx.fillText('FINISH',fx-15,fy-72*scale);
    }

    drawBike(ctx,sx(s.x),sy(s.y),scale,s);
    // Minimal world telemetry.
    ctx.fillStyle='rgba(225,242,250,.55)';ctx.font='700 8px Arial';ctx.letterSpacing='1.5px';
    ctx.fillText(`X ${Math.max(0,Math.round(s.x)).toString().padStart(4,'0')} M`,width-79,18);
    ctx.restore();
  }

  function findTerrainStart(points, x) {
    let lo=0,hi=points.length-1;
    while(lo<hi){const mid=(lo+hi+1)>>1;if(points[mid][0]<x)lo=mid;else hi=mid-1}
    return Math.max(0,lo);
  }

  function drawBike(ctx,x,y,scale,s) {
    ctx.save();ctx.translate(x,y);ctx.rotate(-s.angle);ctx.scale(scale,scale);
    const r=s.wheelRadius, wb=s.wheelbase;
    // Wheels and spokes.
    function wheel(wx){
      ctx.save();ctx.translate(wx,0);
      ctx.fillStyle='#08111a';ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#a8c0cc';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(0,0,r-2,0,Math.PI*2);ctx.stroke();
      ctx.strokeStyle='#3c667e';ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(0,0,r-5,0,Math.PI*2);ctx.stroke();
      ctx.save();ctx.rotate(s.wheelSpin);
      ctx.strokeStyle='rgba(129,202,230,.55)';ctx.lineWidth=1;
      for(let i=0;i<8;i++){ctx.rotate(Math.PI/4);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(r-5,0);ctx.stroke()}
      ctx.restore();
      ctx.fillStyle='#68d9ff';ctx.beginPath();ctx.arc(0,0,3.4,0,Math.PI*2);ctx.fill();
      ctx.restore();
    }
    wheel(-wb/2);wheel(wb/2);
    // Frame, suspension and motor.
    ctx.lineCap='round';ctx.lineJoin='round';
    ctx.strokeStyle='#58c9f2';ctx.lineWidth=5;
    ctx.beginPath();ctx.moveTo(-wb/2,0);ctx.lineTo(-12,-22);ctx.lineTo(15,-5);ctx.lineTo(wb/2,0);ctx.moveTo(-12,-22);ctx.lineTo(30,-28);ctx.lineTo(15,-5);ctx.stroke();
    ctx.strokeStyle='#d3e1e9';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(30,-28);ctx.lineTo(wb/2-2,0);ctx.stroke();
    ctx.fillStyle='#142b3a';ctx.strokeStyle='#8bdffc';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(-5,-16,26,19,4);ctx.fill();ctx.stroke();
    ctx.fillStyle='#14202c';ctx.strokeStyle='#78dcff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-30,-27);ctx.lineTo(-7,-34);ctx.lineTo(16,-31);ctx.lineTo(9,-25);ctx.lineTo(-28,-23);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.strokeStyle='#f0ac66';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(34,-27);ctx.lineTo(43,-36);ctx.lineTo(51,-35);ctx.stroke();
    // Rider boots and legs.
    ctx.strokeStyle='#183e59';ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(-15,-20);ctx.lineTo(-30,-4);ctx.lineTo(-13,3);ctx.stroke();
    ctx.strokeStyle='#205d83';ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(-15,-20);ctx.lineTo(8,-7);ctx.lineTo(17,-1);ctx.stroke();
    ctx.strokeStyle='#e3a46b';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(-16,-38);ctx.lineTo(-33,-26);ctx.lineTo(-26,-18);ctx.stroke();
    ctx.strokeStyle='#e3a46b';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(-1,-38);ctx.lineTo(19,-25);ctx.lineTo(38,-27);ctx.stroke();
    // Suit and back.
    ctx.fillStyle='#167eae';ctx.strokeStyle='#9beaff';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(-18,-45);ctx.quadraticCurveTo(-11,-58,4,-54);ctx.lineTo(18,-39);ctx.lineTo(9,-21);ctx.lineTo(-12,-26);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle='#0e5e88';ctx.fillRect(-13,-39,22,5);
    // Helmet.
    ctx.fillStyle='#f3ad69';ctx.strokeStyle='#ffe0af';ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(-6,-61,13,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle='#162b3c';ctx.beginPath();ctx.ellipse(1,-63,9,5,-.18,Math.PI*1.05,Math.PI*1.92);ctx.fill();
    ctx.strokeStyle='#b4eaff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-2,-73);ctx.lineTo(7,-70);ctx.stroke();
    // Headlight.
    ctx.fillStyle='#d5f8ff';ctx.shadowColor='#8de8ff';ctx.shadowBlur=12;ctx.beginPath();ctx.arc(47,-31,3.5,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    ctx.restore();
  }

  function showResult(won) {
    if (state.resultShown) return;
    state.resultShown = true; state.running = false; state.paused = false;
    const ms = state.elapsed;
    const level = state.currentLevel;
    $('pauseModal').hidden = true;
    $('resultModal').hidden = false;
    $('canvasHint').hidden = true;
    if (won) {
      const previous = state.progress.best[level.id];
      const isBest = !previous || ms < previous;
      if (isBest) state.progress.best[level.id] = ms;
      state.progress.completed[level.id] = true;
      $('resultKicker').textContent = 'FINISH / TRACK CLEARED';
      $('resultIcon').textContent = '✦';
      $('resultTitle').innerHTML = 'ТРАССА ПРОЙДЕНА<span>!</span>';
      $('resultText').textContent = isBest ? 'Новый личный рекорд. Вот это заезд!' : 'Хороший заезд. Но рекорд всё ещё впереди.';
      $('resultBest').textContent = isBest ? 'NEW BEST' : formatTime(state.progress.best[level.id]);
      $('nextButton').hidden = false;
      tone(660,.09,'sine');setTimeout(()=>tone(880,.12,'sine'),100);
    } else {
      $('resultKicker').textContent = 'RIDE ENDED / TRY AGAIN';
      $('resultIcon').textContent = '↻';
      $('resultTitle').innerHTML = 'НЕ СЕЙЧАС<span>.</span>';
      $('resultText').textContent = 'Ничего страшного. Чуть меньше газа, чуть больше баланса.';
      $('resultBest').textContent = state.progress.best[level.id] ? formatTime(state.progress.best[level.id]) : '—';
      $('nextButton').hidden = true;
    }
    $('resultTime').textContent = formatTime(ms);
    saveProgress();
  }

  function startNextLevel() {
    const level = state.currentLevel;
    const list = state.categories[level.category].levels;
    const index = list.findIndex(l => l.id === level.id);
    startGame(list[(index+1)%list.length]);
  }

  function toggleSound() {
    state.audioOn = !state.audioOn;
    $('soundGlyph').textContent = state.audioOn ? '♫' : '♪̸';
    $('soundToggle').setAttribute('aria-label', state.audioOn ? 'Звук включён' : 'Звук выключен');
    if (state.audioOn) tone(540,.06,'sine');
  }
  function tone(freq,duration,type='sine') {
    if (!state.audioOn) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!state.audioContext) state.audioContext = new AC();
      if (state.audioContext.state === 'suspended') state.audioContext.resume();
      const osc=state.audioContext.createOscillator(), gain=state.audioContext.createGain();
      osc.type=type;osc.frequency.value=freq;gain.gain.setValueAtTime(.045,state.audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,state.audioContext.currentTime+duration);
      osc.connect(gain);gain.connect(state.audioContext.destination);osc.start();osc.stop(state.audioContext.currentTime+duration);
    } catch (_) {}
  }

  init();
})();
