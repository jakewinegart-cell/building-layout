// Scratch calc for the wizard-spec worked example (Jake: 10 ft -> 8 ft shed over the 20x16 addition).
// Run: node wizard-v1/reference/shed-roof-example.mjs  (imports studLayout from the app read-only).
// Conventions: heights = top of wall plate above subfloor; run measured between footprint outside faces; overhang 12 in; rafters 24 in o.c.; studs 16 in o.c.; 1 bottom + 2 top plates.
import { studLayout } from '/workspace/layout-app/js/homeplan-derived.js';
const IN=1/12, T=5.5*IN, oc=16*IN, oh=1, rafterOc=2;
const plates=3*1.5; // in
function caseCalc(name, runFt, alongFt, hi=10, lo=8){
  const drop=hi-lo, pitch=drop/runFt*12, k=Math.sqrt(1+(pitch/12)**2);
  const horiz=runFt+2*oh, rafterLen=horiz*k;
  // stations along the high/low walls
  const A0=-oh, A1=alongFt+oh; const st=[]; for(let s=A0;s<A1-0.05;s+=rafterOc) st.push(s); st.push(A1);
  // pitch on centerlines
  const clRun=runFt-T; const pitchCl=drop/clRun*12;
  // rake walls: length = runFt (outside), studs from studLayout on L2=runFt
  const lay=studLayout(runFt, oc, []);
  const studLen=(d)=> (lo+ (hi-lo)*(1-d/runFt))*12 - plates; // high end at d=0
  const rake=lay.studs.map(d=>+studLen(d).toFixed(1));
  const tall=studLayout(alongFt,oc,[]).studs.length;
  const eaveTipLowDrop = oh*pitch/12, eaveTipHighRise=oh*pitch/12;
  const area=rafterLen*(alongFt+2*oh);
  return {name, pitch:+pitch.toFixed(3), pitchCenterlines:+pitchCl.toFixed(3), angleDeg:+(Math.atan(pitch/12)*180/Math.PI).toFixed(2),
    rafters:st.length, bearingRafters:st.length-2, rafterHorizFt:horiz, rafterLenFt:+rafterLen.toFixed(3), rafterLenPlusTrim:+(rafterLen+0.5).toFixed(2),
    rakeWallStudsEach:rake.length, rakeStudLengthsIn:rake, rakeStudLfEach:+(rake.reduce((a,b)=>a+b,0)/12).toFixed(2),
    tallWallStudPositions:tall, triangleSfEach:runFt*drop/2, roofSf:+area.toFixed(1), roofSheets:Math.ceil(area*1.1/32),
    dripEdgeLf:+(2*(alongFt+2*oh)+2*rafterLen).toFixed(2), dripPieces:Math.ceil((2*(alongFt+2*oh)+2*rafterLen)*1.1/10), squares:+(area/100).toFixed(2), eaveTipDropFt:+eaveTipLowDrop.toFixed(3)};
}
// gable baseline
const gk=Math.sqrt(1+(4/12)**2), gr=(8+1)*gk; const garea=2*gr*22;
console.log(JSON.stringify({gable:{rafterLen:+gr.toFixed(3), roofSf:+garea.toFixed(1), sheets:Math.ceil(garea*1.1/32), drip:+(44+4*gr).toFixed(2), dripPieces:Math.ceil((44+4*gr)*1.1/10), squares:+(garea/100).toFixed(2), bundles:Math.ceil(garea/100*1.1*3), rise:8*4/12}},null,1));
console.log(JSON.stringify(caseCalc('A: slope across 16 ft (high wall = a 20 ft wall)',16,20),null,1));
console.log(JSON.stringify(caseCalc('B: slope along 20 ft (high wall = a 16 ft wall)',20,16),null,1));
