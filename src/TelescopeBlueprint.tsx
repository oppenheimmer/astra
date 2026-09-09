import { memo, useMemo } from "react";
import * as A from "astronomy-engine";
import { RAD, wrap } from "./projection";
import type { Site, Telescope } from "./types";

export function mountAngles(telescope: Telescope, date: Date, site: Site) {
  const eq = A.EquatorFromVector(A.RotateVector(A.Rotation_EQJ_EQD(date),
    A.VectorFromSphere(new A.Spherical(telescope.dec, telescope.ra * 15, 1), date)));
  return { ra: wrap(A.SiderealTime(date) * 15 + site.lon - eq.ra * 15 + 180) - 180, dec: eq.dec };
}
type V = [number, number, number];
const add = (a: V, b: V, factor = 1): V => a.map((n, i) => n + b[i] * factor) as V;
const scale = (a: V, n: number): V => a.map(v => v * n) as V;
const cross = (a: V, b: V): V => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot = (a: V, b: V) => a.reduce((n, v, i) => n + v * b[i], 0);
const unit = (a: V): V => scale(a, 1 / Math.hypot(...a));
const camera: V = [.4330127, .75, .5];
const screen = (p: V) => ({ x: 140 + 1.32 * (.8660254 * p[0] - .5 * p[1]), y: 132 + 1.32 * (.25 * p[0] + .4330127 * p[1] - .8660254 * p[2]) });
const path = (points: V[], close = false) => points.map((p, i) => { const q = screen(p); return `${i ? "L" : "M"}${q.x.toFixed(2)},${q.y.toFixed(2)}`; }).join("") + (close ? "Z" : "");
const circle = (center: V, u: V, v: V, radius: number) => Array.from({ length: 49 }, (_, i) => add(add(center, u, radius * Math.cos(i * Math.PI / 24)), v, radius * Math.sin(i * Math.PI / 24)));
const ring = (center: V, u: V, v: V, radius: number) => path(circle(center, u, v, radius), true);
type Surface = { d: string; tone: string };
type Part = { id: string; depth: number; surfaces: Surface[] };

/** Orthographic assembly with opaque surfaces, ordered from back to front. */
function assembly(ra: number, dec: number, latitude: number) {
  const parts: Part[] = [];
  const cylinder = (id: string, start: V, end: V, radius: number, tone = "metal") => {
    const axis = unit(add(end, start, -1));
    const u = unit(cross(axis, Math.abs(axis[2]) < .9 ? [0,0,1] : [1,0,0])), v = cross(axis, u);
    const tangent = Math.hypot(...cross(axis, camera)) > 1e-6 ? unit(cross(axis, camera)) : u;
    const [far, near] = dot(axis, camera) > 0 ? [start, end] : [end, start];
    parts.push({ id, depth: dot(add(start, end), camera) / 2, surfaces: [
      { d: ring(far, u, v, radius), tone },
      { d: path([add(far,tangent,radius),add(near,tangent,radius),add(near,tangent,-radius),add(far,tangent,-radius)],true), tone },
      { d: ring(near, u, v, radius), tone: `${tone} cap` },
    ] });
  };
  const plate = (id: string, center: V, u: V, v: V, w: V, width: number, height: number, thickness: number, tone = "mount") => {
    const corners = [-1,1].flatMap(z => [-1,1].flatMap(y => [-1,1].map(x => add(add(add(center,u,x*width/2),v,y*height/2),w,z*thickness/2))));
    const surfaces = [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]
      .map(indices => { const points = indices.map(i => corners[i]); return { d: path(points,true), tone, depth: points.reduce((n,p) => n+dot(p,camera),0)/4 }; })
      .sort((a,b) => a.depth-b.depth);
    parts.push({ id, depth: dot(center,camera), surfaces });
  };
  const line = (id: string, points: V[], tone = "detail") => parts.push({ id, depth: points.reduce((n,p) => n+dot(p,camera),0)/points.length, surfaces: [{ d:path(points),tone }] });
  const x: V = [1,0,0], y: V = [0,1,0], z: V = [0,0,1];
  const polar: V = [0,Math.cos(latitude*RAD),Math.sin(latitude*RAD)];
  const meridian: V = [0,-Math.sin(latitude*RAD),Math.cos(latitude*RAD)];
  const equator = add(scale(meridian,Math.cos(ra*RAD)),x,-Math.sin(ra*RAD));
  const shaft = cross(polar,equator), direction = add(scale(equator,Math.cos(dec*RAD)),polar,Math.sin(dec*RAD));
  const tubeUp = cross(direction,shaft), base: V = [0,0,0], hub = add([0,0,13],polar,22);
  // Twin tripod rails, telescoping lower legs, feet and the triangular spreader.
  const feet: V[] = [];
  for (const [i, angle] of [30,150,270].entries()) {
    const radial: V = [Math.cos(angle*RAD),Math.sin(angle*RAD),0], side = cross(z,radial);
    const top = add(base,radial,7), foot = add(scale(radial,43),z,-60), middle = add(top,add(foot,top,-1),.68);
    feet.push(foot);
    for (const sign of [-1,1]) cylinder(`leg-${i}-${sign}`,add(top,side,sign*3.3),add(middle,side,sign*2.7),1.7,"leg");
    cylinder(`extension-${i}`,add(middle,z,5),foot,2.1,"metal");
    cylinder(`foot-${i}`,foot,add(foot,z,-3),2.8,"dark");
    plate(`leg-clamp-${i}`,middle,side,radial,z,9,4,4,"mount");
    cylinder(`leg-bolt-${i}`,add(middle,radial,-3),add(middle,radial,4),1,"metal");
    cylinder(`brace-${i}`,[0,0,-23],add(top,add(foot,top,-1),.49),.8,"metal");
  }
  const tray = feet.map(f => add(scale(f,.34),z,-3));
  parts.push({ id:"tray", depth:dot([0,0,-23],camera), surfaces:[{d:path(tray,true),tone:"mount"},{d:path(tray.map(p=>add(p,z,-2)),true),tone:"detail"}] });
  cylinder("tripod-head",[0,0,-2],[0,0,4],10,"mount");
  cylinder("azimuth-base",[0,0,4],[0,0,8],8,"metal");
  plate("latitude-cradle",[0,0,14],x,y,z,13,14,13);
  cylinder("latitude-bolt",[-9,0,13],[9,0,13],2.2);
  cylinder("latitude-knob",[9,0,13],[12,0,13],3,"dark");
  cylinder("ra-housing",[0,0,13],hub,7.5,"mount");
  cylinder("ra-bearing",add(hub,polar,-3),add(hub,polar,1),8.6,"metal");
  cylinder("ra-setting-circle",add(hub,polar,-6),add(hub,polar,-4),8.1,"dark");
  plate("ra-motor",add(add(hub,polar,-14),x,10),x,meridian,polar,10,12,12,"mount");
  cylinder("ra-knob",add(add(hub,polar,-14),x,15),add(add(hub,polar,-14),x,18),2.7,"dark");
  cylinder("dec-housing",add(hub,shaft,-7),add(hub,shaft,15),6.5,"mount");
  cylinder("dec-bearing",add(hub,shaft,12),add(hub,shaft,16),7.5,"metal");
  cylinder("dec-setting-circle",add(hub,shaft,-8),add(hub,shaft,-6),7,"dark");
  plate("dec-motor",add(add(hub,shaft,3),polar,-9),polar,equator,shaft,8,11,12,"mount");
  cylinder("counterweight-shaft",add(hub,shaft,-45),add(hub,shaft,-7),1.25);
  cylinder("counterweight",add(hub,shaft,-36),add(hub,shaft,-27),9,"weight");
  cylinder("counterweight-collar",add(hub,shaft,-37),add(hub,shaft,-35),3,"dark");
  cylinder("shaft-stop",add(hub,shaft,-46),add(hub,shaft,-44),2.6,"dark");
  const weightKnob = add(add(hub,shaft,-31),polar,8);
  cylinder("weight-lock",weightKnob,add(weightKnob,polar,5),1.5,"dark");
  const saddle = add(hub,shaft,19), tube = add(hub,shaft,32);
  plate("saddle",saddle,direction,tubeUp,shaft,29,11,6,"dark");
  for (const offset of [-12,12]) {
    const c = add(tube,direction,offset);
    plate(`tube-shoe-${offset}`,add(c,shaft,-11),direction,tubeUp,shaft,5,10,7,"mount");
    cylinder(`tube-ring-${offset}`,add(c,direction,-1.8),add(c,direction,1.8),12.1,"mount");
  }
  const front = add(tube,direction,29), back = add(tube,direction,-27);
  cylinder("tube",back,front,11.5,"tube");
  cylinder("rear-cell",add(back,direction,-3),add(back,direction,1),12,"dark");
  cylinder("front-cell",add(front,direction,-2),add(front,direction,2),12,"dark");
  // The corrector plate and central secondary are visible from the open end.
  if (dot(direction,camera)>0) {
    const glass = add(front,direction,2.05);
    parts.push({id:"corrector",depth:dot(glass,camera)+.1,surfaces:[
      {d:ring(glass,shaft,tubeUp,10.4),tone:"glass"},
      {d:ring(glass,shaft,tubeUp,8.8),tone:"detail"},
      {d:ring(glass,shaft,tubeUp,3.5),tone:"dark"},
      {d:ring(glass,shaft,tubeUp,1.2),tone:"metal"},
    ]});
  }
  const finder = add(tube,tubeUp,16);
  for (const offset of [-9,4]) cylinder(`finder-bracket-${offset}`,add(add(tube,tubeUp,10),direction,offset),add(finder,direction,offset),.9,"mount");
  cylinder("finder",add(finder,direction,-16),add(finder,direction,11),2.7,"tube");
  cylinder("finder-front",add(finder,direction,10),add(finder,direction,12),3.1,"dark");
  cylinder("finder-eye",add(finder,direction,-20),add(finder,direction,-16),1.8,"dark");
  const rear = add(back,direction,-9), diagonal = add(rear,tubeUp,4);
  cylinder("visual-back",back,rear,3.3,"metal");
  plate("diagonal",diagonal,direction,shaft,tubeUp,7,7,8,"mount");
  cylinder("eyepiece-barrel",diagonal,add(diagonal,tubeUp,10),2.6,"metal");
  cylinder("eyepiece-grip",add(diagonal,tubeUp,6),add(diagonal,tubeUp,13),3.4,"dark");
  cylinder("focus-knob",add(back,shaft,7),add(add(back,shaft,7),direction,-6),2,"dark");
  // Fine seams and setting-circle divisions give the housing scale and construction.
  for (let i=0;i<24;i++) {
    const radial = add(scale(x,Math.cos(i*Math.PI/12)),meridian,Math.sin(i*Math.PI/12));
    line(`ra-tick-${i}`,[add(add(hub,polar,-6.1),radial,8.3),add(add(hub,polar,-4.1),radial,8.3)]);
  }
  return { parts: parts.sort((a,b)=>a.depth-b.depth), hub, polar, shaft, feet };
}

export default memo(function TelescopeBlueprint({ telescope: t, date, site }: { telescope: Telescope; date: Date; site: Site }) {
  const angles = useMemo(() => t.connected ? mountAngles(t,date,site) : {ra:35,dec:50},[t.ra,t.dec,t.connected,date,site]);
  const latitude = t.connected ? site.lat : 47;
  const model = useMemo(() => assembly(angles.ra,angles.dec,latitude),[angles.ra,angles.dec,latitude]);
  return <figure className="telescope-blueprint" aria-label="Simulated equatorial telescope mount, showing right ascension and declination axis angles">
    <svg className="blueprint-assembly" viewBox="0 0 280 236" role="img" aria-label="Detailed telescope assembly with optical tube, finder, focuser, equatorial motors, counterweight and tripod">
      <g className="blueprint-guide">
        <path d="M10 12h9M10 12v9M270 12h-9M270 12v9M10 225h9M10 225v-9M270 225h-9M270 225v-9"/>
        <path d={path([add(model.hub,model.polar,-43),add(model.hub,model.polar,32)])}/>
        <path d={path([add(model.hub,model.shaft,-53),add(model.hub,model.shaft,43)])}/>
        <path d={path([...model.feet,model.feet[0]])}/>
      </g>
      {model.parts.map(part => <g key={part.id} className="blueprint-part" data-axis={part.id==="tube" ? "tube" : undefined}
        data-ra={part.id==="tube" ? angles.ra.toFixed(4) : undefined} data-dec={part.id==="tube" ? angles.dec.toFixed(4) : undefined}>
        {part.surfaces.map((surface,i)=><path key={i} d={surface.d} className={`blueprint-surface ${surface.tone}`}/>)}
      </g>)}
      <text className="blueprint-view-label" x="20" y="23">EQUATORIAL</text>
      <text className="blueprint-view-label" x="260" y="217" textAnchor="end">OMC–140</text>
    </svg>
    <div className="blueprint-axis-readouts">
      {[{name:"RA",angle:angles.ra},{name:"DEC",angle:angles.dec}].map(axis=><svg viewBox="0 0 130 58" role="img" aria-label={`${axis.name} motor angle`} className="blueprint-dial" key={axis.name}>
        <circle cx="26" cy="28" r="19"/><circle className="dial-inner" cx="26" cy="28" r="15"/>
        {Array.from({length:24},(_,i)=><path key={i} transform={`rotate(${i*15} 26 28)`} d={`M26 9v${i%6===0?5:2}`}/>)}
        <g data-axis={axis.name.toLowerCase()} transform={`rotate(${axis.angle} 26 28)`}>
          <path className="motor-needle" d="M26 34V13M24 17l2-4 2 4"/><circle className="motor-hub" cx="26" cy="28" r="2.2"/>
        </g>
        <text className="axis-name" x="55" y="22">{axis.name}</text>
        <text className="axis-value" x="55" y="38">{t.connected?`${axis.angle.toFixed(1)}°`:"—"}</text>
      </svg>)}
    </div>
    <figcaption><span>SIMULATED AXES</span><span>SCHEMATIC</span></figcaption>
  </figure>;
});
