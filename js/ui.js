import { TOOLS, STRUCTURES, DEFENDERS, ZOMBIES, WAVES } from './config.js';

/** Knappar, informationspanel och meddelanden. */
export class UI {
  constructor(game, view) {
    this.game = game;
    this.view = view;
    this.tool = null;
    this.speed = 1;
    this.onToolChange = () => {};

    this.el = {
      budget: document.getElementById('budget'),
      store: document.getElementById('store'),
      round: document.getElementById('round'),
      phase: document.getElementById('phase'),
      tools: document.getElementById('tools'),
      start: document.getElementById('start'),
      speed: document.getElementById('speed'),
      toolInfo: document.getElementById('tool-info'),
      cellInfo: document.getElementById('cell-info'),
      legend: document.getElementById('legend'),
      flow: document.getElementById('flow'),
      toast: document.getElementById('toast'),
      overlay: document.getElementById('overlay'),
      overlayTitle: document.getElementById('overlay-title'),
      overlayText: document.getElementById('overlay-text'),
      restart: document.getElementById('restart'),
    };

    this.buildTools();
    this.buildLegend();
    this.bindControls();

    game.on('state', () => this.refresh());
    game.on('message', (text) => this.toast(text));
    game.on('breach', () => this.flashStore());
    game.on('end', ({ won }) => this.showEnd(won));

    this.refresh();
    this.setTool(null);
  }

  toolDef(id) {
    const t = TOOLS.find((x) => x.id === id);
    const def = STRUCTURES[id] ?? DEFENDERS[id];
    return { ...t, name: def?.name ?? t.name, info: def?.info ?? t.info, cost: def?.cost };
  }

  buildTools() {
    this.buttons = new Map();
    for (const t of TOOLS) {
      const d = this.toolDef(t.id);
      const btn = document.createElement('button');
      btn.className = 'tool';
      btn.dataset.tool = t.id;
      btn.innerHTML = `<span class="key">${t.hotkey.toUpperCase()}</span><span class="name">${d.name}</span>${
        d.cost !== undefined ? `<span class="cost">${d.cost}</span>` : ''
      }`;
      btn.addEventListener('click', () => this.setTool(this.tool === t.id ? null : t.id));
      this.el.tools.appendChild(btn);
      this.buttons.set(t.id, btn);
    }
  }

  buildLegend() {
    for (const z of Object.values(ZOMBIES)) {
      const row = document.createElement('div');
      row.className = 'legend-row';
      const hex = `#${z.color.toString(16).padStart(6, '0')}`;
      row.innerHTML = `<span class="dot" style="background:${hex}"></span><span><strong>${z.name}</strong> ${z.info}</span>`;
      this.el.legend.appendChild(row);
    }
    for (const [key, z] of Object.entries(ZOMBIES)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = z.name;
      this.el.flow.appendChild(opt);
    }
  }

  bindControls() {
    this.el.start.addEventListener('click', () => this.game.startRound());
    this.el.speed.addEventListener('click', () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
      this.el.speed.textContent = `Hastighet ${this.speed}x`;
    });
    this.el.flow.addEventListener('change', () => this.view.setFlowType(this.el.flow.value));
    this.el.restart.addEventListener('click', () => window.location.reload());

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') {
        this.setTool(null);
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        this.game.startRound();
        return;
      }
      const t = TOOLS.find((x) => x.hotkey === e.key.toLowerCase());
      if (t) this.setTool(this.tool === t.id ? null : t.id);
    });
  }

  setTool(id) {
    this.tool = id;
    for (const [tid, btn] of this.buttons) btn.classList.toggle('active', tid === id);
    if (!id) {
      this.el.toolInfo.innerHTML =
        '<p>Välj ett verktyg i raden nedanför eller med siffertangenterna. Högerklick eller Esc avmarkerar.</p>';
    } else {
      const d = this.toolDef(id);
      const extra = DEFENDERS[id]
        ? `<p class="muted">Räckvidd ${DEFENDERS[id].range} rutor, ljud ${DEFENDERS[id].noise} rutor, tålighet ${DEFENDERS[id].hp}.</p>`
        : '';
      const cost = d.cost !== undefined ? ` <span class="muted">(${d.cost} poäng)</span>` : '';
      this.el.toolInfo.innerHTML = `<p><strong>${d.name}</strong>${cost}</p><p>${d.info}</p>${extra}`;
    }
    this.onToolChange();
  }

  showCell(text, check) {
    let html = text ? `<p>${text}</p>` : '<p class="muted">Peka på kartan.</p>';
    if (check && check.reason) html += `<p class="warn">${check.reason}</p>`;
    else if (check && check.ok && check.cost !== undefined) {
      html += `<p class="muted">${check.cost < 0 ? `Ger tillbaka ${-check.cost} poäng` : `Kostar ${check.cost} poäng`}</p>`;
    }
    this.el.cellInfo.innerHTML = html;
  }

  refresh() {
    const g = this.game;
    this.el.budget.textContent = g.budget;
    this.el.store.textContent = g.store;
    this.el.round.textContent = `${Math.min(g.round + 1, WAVES.length)} av ${WAVES.length}`;
    const labels = { planning: 'Planering', round: 'Anfall pågår', won: 'Seger', lost: 'Förlust' };
    this.el.phase.textContent = labels[g.phase];
    document.body.dataset.phase = g.phase;
    this.el.start.disabled = g.phase !== 'planning';
    for (const [id, btn] of this.buttons) {
      const cost = (STRUCTURES[id] ?? DEFENDERS[id])?.cost;
      btn.disabled = g.phase !== 'planning';
      btn.classList.toggle('expensive', cost !== undefined && cost > g.budget);
    }
  }

  flashStore() {
    const box = this.el.store.parentElement;
    box.classList.remove('flash');
    void box.offsetWidth;
    box.classList.add('flash');
  }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove('show'), 4000);
  }

  showEnd(won) {
    const g = this.game;
    this.el.overlayTitle.textContent = won ? 'Utposten höll' : 'Utposten föll';
    this.el.overlayText.textContent = won
      ? `Ni klarade alla ${WAVES.length} rundor. ${g.stats.killed} zombier stoppades och förrådet har ${g.store} av 20 kvar.`
      : `Förrådet tog slut i runda ${g.round + 1}. ${g.stats.killed} zombier stoppades innan dess.`;
    this.el.overlay.hidden = false;
  }
}
