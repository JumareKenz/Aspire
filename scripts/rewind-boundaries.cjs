/**
 * Rewinds GeoJSON rings to the winding order d3-geo expects.
 *
 * This is a genuine trap. RFC 7946 says exterior rings are counter-clockwise;
 * d3-geo interprets polygons *spherically* and expects the opposite —
 * exterior rings clockwise. Data that is correct by the specification therefore
 * renders as "the whole globe except this area" in d3: the shape floods the
 * canvas and drags the fitted projection scale down to world level.
 *
 * geoBoundaries ships RFC-compliant (counter-clockwise) rings, so they must be
 * reversed for d3. Doing it once here keeps the runtime free of the fix-up.
 */
const fs = require('fs');

function ringArea(ring) {
  let total = 0;
  for (let i = 0, n = ring.length; i < n; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    total += x1 * y2 - x2 * y1;
  }
  return total / 2;
}

function rewindRings(rings) {
  return rings.map((ring, index) => {
    const area = ringArea(ring);
    // d3-geo wants the exterior ring clockwise (negative planar area) and any
    // hole counter-clockwise — the reverse of the GeoJSON specification.
    const wantNegative = index === 0;
    const isNegative = area < 0;
    return isNegative === wantNegative ? ring : [...ring].reverse();
  });
}

const path = process.argv[2];
const g = JSON.parse(fs.readFileSync(path, 'utf8'));
let fixed = 0;
for (const f of g.features) {
  if (f.geometry.type === 'Polygon') {
    const before = JSON.stringify(f.geometry.coordinates);
    f.geometry.coordinates = rewindRings(f.geometry.coordinates);
    if (JSON.stringify(f.geometry.coordinates) !== before) fixed += 1;
  } else if (f.geometry.type === 'MultiPolygon') {
    const before = JSON.stringify(f.geometry.coordinates);
    f.geometry.coordinates = f.geometry.coordinates.map(rewindRings);
    if (JSON.stringify(f.geometry.coordinates) !== before) fixed += 1;
  }
}
fs.writeFileSync(path, JSON.stringify(g));
console.log(`rewound ${fixed} of ${g.features.length} features`);
