// Motion helpers: scroll reveals, button ripples, count-up numbers, confetti, header shadow.
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let io: IntersectionObserver | undefined;
/** Observe `.reveal` / `.stagger` elements under root and animate them in when scrolled into view. */
export function reveal(root: ParentNode = document) {
  if (!io) io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io!.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  root.querySelectorAll('.reveal:not(.in), .stagger:not(.in)').forEach((el) => io!.observe(el));
}

/** Global click ripple on every .btn */
export function initRipples() {
  document.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest('.btn, .chip, .slip-toggle button') as HTMLElement | null;
    if (!b || reduce() || (b as HTMLButtonElement).disabled) return;
    const r = b.getBoundingClientRect(); const s = Math.max(r.width, r.height);
    const span = document.createElement('span'); span.className = 'ripple';
    span.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    b.style.overflow = 'hidden';
    b.appendChild(span); setTimeout(() => span.remove(), 650);
  });
  const bar = document.querySelector('.topbar');
  addEventListener('scroll', () => bar?.classList.toggle('scrolled', scrollY > 8), { passive: true });
}

/** Animate a number from its previous value to `to`. fmt renders the text. */
export function countUp(el: Element | null, to: number, fmt: (n: number) => string, ms = 900) {
  if (!el) return;
  const from = Number((el as HTMLElement).dataset.v ?? 0);
  (el as HTMLElement).dataset.v = String(to);
  if (reduce() || !isFinite(from)) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms); const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Celebration burst, in the side's colours. */
export function confetti(colors = ['#00e59b', '#8b5cf6', '#ec4899', '#ffb020']) {
  if (reduce()) return;
  const c = document.createElement('canvas'); c.className = 'confetti';
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  document.body.appendChild(c);
  const g = c.getContext('2d')!; g.scale(devicePixelRatio, devicePixelRatio);
  const ps = Array.from({ length: 160 }, () => ({ x: innerWidth / 2, y: innerHeight * 0.55, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 16 - 6,
    r: Math.random() * 6 + 3, c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4 }));
  let f = 0;
  const tick = () => {
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of ps) { p.vy += 0.42; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c; g.globalAlpha = Math.max(0, 1 - f / 140); g.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6); g.restore(); }
    if (++f < 140) requestAnimationFrame(tick); else c.remove();
  };
  requestAnimationFrame(tick);
}

/** Return colour for a tile/bar: green for up, red for down, intensity by magnitude. */
export function retColor(r: number | null | undefined, alpha = 1) {
  if (r == null || Math.abs(r - 1) < 1e-9) return `rgba(128,128,150,${0.22 * alpha})`; // flat / no trades: neutral
  const m = Math.min(1, Math.abs(r - 1) / 0.15);
  const base = r >= 1 ? '0,229,155' : '255,59,107';
  return `rgba(${base},${(0.18 + 0.72 * m) * alpha})`;
}
