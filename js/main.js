import { GameMap } from './map.js';
import { Game } from './game.js';
import { View } from './view.js';
import { UI } from './ui.js';
import { DEFENDERS, RULES } from './config.js';

const map = new GameMap();
const game = new Game(map);
const view = new View(document.getElementById('board'), map, game);
const ui = new UI(game, view);

let hoverCell = -1;

function updateHover() {
  if (hoverCell < 0) {
    view.setHover(-1);
    ui.showCell('', null);
    return;
  }
  const tool = ui.tool;
  const check = tool ? game.checkTool(tool, hoverCell) : null;
  // Visa räckvidd och ljudradie för valt vapen eller för en försvarare man pekar på.
  const occ = map.occupant[hoverCell];
  const def = tool && DEFENDERS[tool] ? DEFENDERS[tool] : occ?.kind === 'defender' ? occ.def : null;
  view.setHover(hoverCell, check, def?.range ?? 0, def?.noise ?? 0);
  ui.showCell(game.describeCell(hoverCell), check);
}

ui.onToolChange = updateHover;
game.on('state', updateHover);

view.canvas.addEventListener('pointermove', (e) => {
  hoverCell = view.pick(e.clientX, e.clientY);
  updateHover();
});
view.canvas.addEventListener('pointerleave', () => {
  hoverCell = -1;
  updateHover();
});
view.canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 2) {
    ui.setTool(null);
    return;
  }
  if (e.button !== 0 || !ui.tool) return;
  hoverCell = view.pick(e.clientX, e.clientY);
  const result = game.apply(ui.tool, hoverCell);
  if (!result.ok && result.reason) ui.toast(result.reason);
  updateHover();
});
view.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

let last = performance.now();
function frame(now) {
  const real = Math.min(RULES.maxFrameTime, (now - last) / 1000);
  last = now;
  // Vid högre hastighet delas tiden upp i flera steg så att zombier inte hoppar över rutor.
  for (let s = 0; s < ui.speed; s++) game.update(real);
  view.render(real * ui.speed, now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Åtkomst från webbläsarens konsol vid felsökning.
window.spel = { game, view, ui, map };
