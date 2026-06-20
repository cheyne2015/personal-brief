/* ═════ PARTICLE GRID SYSTEM (Theme-aware) ═════ */
(function(){
var c = document.getElementById('particleCanvas');
var ctx = c.getContext('2d');
var w, h, particles = [];
var PARTICLE_COUNT = 80;
var CONNECTION_DIST = 130;

// Read RGB components from CSS variables
var pR = 0, pG = 229, pB = 255;
function readColors() {
  var s = getComputedStyle(document.documentElement);
  var cr = parseInt(s.getPropertyValue('--particle-r').trim()) || 0;
  var cg = parseInt(s.getPropertyValue('--particle-g').trim()) || 229;
  var cb = parseInt(s.getPropertyValue('--particle-b').trim()) || 255;
  pR = cr; pG = cg; pB = cb;
}
readColors();

// Watch for theme changes
if (window.MutationObserver) {
  new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.attributeName === 'data-theme') readColors();
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

function resize() {
  w = c.width = window.innerWidth;
  h = c.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// Create particles
for (var i = 0; i < PARTICLE_COUNT; i++) {
  particles.push({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    r: Math.random() * 1.5 + 0.5,
    opacity: Math.random() * 0.5 + 0.2
  });
}

function draw() {
  ctx.clearRect(0, 0, w, h);

  for (var i = 0; i < particles.length; i++) {
    var p = particles[i];
    p.x += p.vx;
    p.y += p.vy;

    if (p.x < 0) p.x = w;
    if (p.x > w) p.x = 0;
    if (p.y < 0) p.y = h;
    if (p.y > h) p.y = 0;

    // Draw particle
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(' + pR + ',' + pG + ',' + pB + ',' + p.opacity + ')';
    ctx.fill();

    // Outer glow
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(' + pR + ',' + pG + ',' + pB + ',' + (p.opacity * 0.15) + ')';
    ctx.fill();

    // Connections
    for (var j = i + 1; j < particles.length; j++) {
      var p2 = particles[j];
      var dx = p.x - p2.x;
      var dy = p.y - p2.y;
      var dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < CONNECTION_DIST) {
        var alpha = (1 - dist / CONNECTION_DIST) * 0.12;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = 'rgba(' + pR + ',' + pG + ',' + pB + ',' + alpha + ')';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  }
  requestAnimationFrame(draw);
}

if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  c.style.display = 'none';
} else {
  draw();
}
})();

(function(){var t=["◈ NEURAL LINK ESTABLISHED ◈","◈ QUANTUM FLUX STABILIZED ◈","◈ CIPHER PROTOCOLS ENGAGED ◈","◈ DATA STREAMS CONVERGING ◈","◈ SYNTHETIC SENTIENCE ONLINE ◈","◈ GLOBAL GRID SYNCHRONIZED ◈","◈ DEEP RESONANCE ACTIVE ◈","◈ NODE CLUSTER CONNECTED ◈","◈ HYPERDRIVE CALIBRATED ◈","◈ REALITY MATRIX CONFIRMED ◈","◈ HOLOGRAPHIC INTERFACE READY ◈","◈ SIGNAL ACQUIRED · SYS OK ◈"];document.getElementById("heroSubtitle").textContent=t[Math.floor(Math.random()*t.length)];})();

/* Keep the browser-tab date current without rebuilding the page each day. */
(function updateDocumentTitle() {
var now = new Date();
var date = now.toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric'
});
document.title = 'CHEY Intelligence Brief — ' + date;
})();
