const fs = require('fs');

const js = fs.readFileSync('public/js/app.js', 'utf8');
const css = fs.readFileSync('public/css/dashboard.css', 'utf8');

const checks = [
  { name: 'Funnel selector element present', pass: js.includes('id="live-flow-select"') && js.includes('changeLiveFlow') },
  { name: 'Funnel selection persists via localStorage', pass: js.includes("localStorage.setItem('wh_live_flow_id'") },
  { name: 'Zoom controls (+, -, 100%, Ajustar) present', pass: js.includes('id="live-zoom-level"') && js.includes('zoomLiveFlow(') && js.includes('resetLiveFlowZoom(') && js.includes('fitLiveFlowView(') },
  { name: 'Interactive mouse wheel & drag pan initialized', pass: js.includes('initLiveCanvasInteraction') && js.includes('canvasArea.onwheel') && js.includes('canvasArea.onmousedown') },
  { name: 'Slower particle speeds (0.0007)', pass: js.includes('0.0007 + (Math.random() * 0.0003)') },
  { name: 'Removed node arrival pulsing from animation frame', pass: !js.includes('triggerNodeArrivalPulse(p.toNodeId)') },
  { name: 'Disabled node-pulse-arrival animation in CSS', pass: css.includes('.node-pulse-arrival {') && css.includes('animation: none !important;') },
  { name: 'Canvas grab/grabbing cursors defined in CSS', pass: css.includes('cursor: grab;') && css.includes('cursor: grabbing;') }
];

let allPassed = true;
checks.forEach(c => {
  if (c.pass) {
    console.log('✓ PASS:', c.name);
  } else {
    console.log('✗ FAIL:', c.name);
    allPassed = false;
  }
});

if (allPassed) {
  console.log('\n🎉 TODAS AS VERIFICAÇÕES DO FLUXO AO VIVO PASSARAM!');
  process.exit(0);
} else {
  console.log('\n⚠️ Alguma verificação falhou!');
  process.exit(1);
}
