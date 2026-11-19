import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCamera, setFrame, toScreen, viewFrame } from '../src/render/camera.js';

// The views of the map are data since 2.9.
const VIEWS = JSON.parse(readFileSync(new URL('../data/campaign.json', import.meta.url), 'utf8')).views;
import { project } from '../src/sim/geo.js';

function cornersOnScreen(cam, view) {
  const [x0, y0] = project(view.lon[0], view.lat[0]);
  const [x1, y1] = project(view.lon[1], view.lat[1]);
  return [toScreen(cam, x0, y0), toScreen(cam, x1, y1)];
}

// I8 of the audit: with a unit sheet open, the « Angleterre » view put Dover, Manston,
// Hawkinge and Calais under the sheet.
test('a view is framed in the part of the map that the unit sheet leaves free', () => {
  const cam = createCamera();
  cam.width = 1100;
  cam.height = 800;
  const dover = project(1.31, 51.13);
  const calais = project(1.85, 50.95);

  setFrame(cam, viewFrame(cam, VIEWS.england));
  assert.ok(toScreen(cam, ...calais)[0] > 700, 'without the inset, Calais is where a sheet on the right would be');

  for (const [inset, free] of [
    [{ right: 400 }, { x0: 0, x1: 700, y0: 0, y1: 800 }],
    [{ left: 400 }, { x0: 400, x1: 1100, y0: 0, y1: 800 }],
    [{ bottom: 300 }, { x0: 0, x1: 1100, y0: 0, y1: 500 }],
  ]) {
    setFrame(cam, viewFrame(cam, VIEWS.england, 30, inset));
    const [[ax, ay], [bx, by]] = cornersOnScreen(cam, VIEWS.england);
    for (const [x, y] of [[ax, ay], [bx, by], toScreen(cam, ...dover), toScreen(cam, ...calais)]) {
      assert.ok(x >= free.x0 + 29 && x <= free.x1 - 29, `x ${x.toFixed(0)} inside the free part ${JSON.stringify(inset)}`);
      assert.ok(y >= free.y0 + 29 && y <= free.y1 - 29, `y ${y.toFixed(0)} inside the free part ${JSON.stringify(inset)}`);
    }
  }
});
