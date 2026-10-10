'use strict';

(function boot() {
  UI.init();
  Watch.probe();
  const params = new URLSearchParams(location.search);
  const watchId = params.get('watch');
  if (watchId === 'live') Watch.startLive();
  else if (watchId) Watch.start(watchId);
  else if (params.has('arena') || location.pathname.replace(/\/$/, '') === '/arena') Watch.openArena();
  let last = performance.now();
  let acc = 0;

  function frame(now) {
    const g = UI.game;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!UI.paused) Watch.tick(dt * ((g && g.settings.speed) || 1));
    if (g && g.terrain && !UI.paused) {
      acc += dt * (g.settings.speed || 1);
      let n = 0;
      while (acc >= PHYS.tick && n < 10) {
        g.update(PHYS.tick);
        acc -= PHYS.tick;
        n++;
      }
      if (n >= 10) acc = 0;
    }
    if (g && g.terrain && document.body.classList.contains('in-round')) {
      UI.renderer.draw(g, UI);
      UI.updateHud();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
