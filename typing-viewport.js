// The lesson alone owns automatic scrolling. Geometry is cached until reflow;
// typing only looks up a row and retargets one native-scroll animation.
export class TypingViewport {
  constructor(box, chars, onLayout) {
    this.box = box;
    this.chars = chars;
    this.onLayout = onLayout;
    this.cursor = 0;
    this.frame = null;
    this.manual = false;
    this.disposed = false;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.listeners = new AbortController();
    const options = { signal: this.listeners.signal };
    const manual = () => {
      this.manual = true;
      this.cancel();
    };
    box.addEventListener('wheel', manual, { ...options, passive: true });
    box.addEventListener('touchstart', manual, { ...options, passive: true });
    // Scrollbar dragging, including platform overlay scrollbars. Clicking the
    // passage also leaves its position alone until an actual typing key.
    box.addEventListener('pointerdown', manual, options);
    box.addEventListener('keydown', event => {
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) manual();
    }, options);
    this.motion.addEventListener('change', () => {
      if (this.motion.matches && this.frame !== null) {
        this.cancel();
        box.scrollTop = this.target;
      }
    }, options);
    this.resize = new ResizeObserver(() => this.reflow());
    this.resize.observe(box);
    document.fonts?.addEventListener('loadingdone', () => this.reflow(true), options);
    window.addEventListener('resize', () => this.reflow(), options);
  }

  cancel() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  dispose() {
    this.disposed = true;
    this.cancel();
    this.resize.disconnect();
    this.listeners.abort();
  }

  reflow(force = false) {
    if (this.disposed || !this.box.isConnected) return;
    const box = this.box;
    const style = getComputedStyle(box);
    const bounds = box.getBoundingClientRect();
    const scale = bounds.width / box.offsetWidth;
    const signature = [box.clientWidth, box.clientHeight, scale, style.fontSize,
      style.fontFamily, style.lineHeight, style.letterSpacing, style.wordSpacing].join(':');
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.cancel();
    const leading = box.querySelector('.typing-leading');
    const trailing = box.querySelector('.typing-trailing');
    leading.style.height = '0px';
    trailing.style.height = '0px';
    const origin = bounds.top + (box.clientTop - box.scrollTop) * scale;
    const lane = parseFloat(style.fontSize) * 1.4;
    const rows = [];
    this.lines = this.chars.map(char => {
      const top = (char.getBoundingClientRect().top - origin) / scale;
      if (!rows.length || Math.abs(top - rows.at(-1)) > 1) rows.push(top);
      return rows.length - 1;
    });
    // Even a one-line passage has a measured glyph plus its reserved pace lane.
    const rowHeight = rows.length > 1 ? rows[1] - rows[0]
      : this.chars[0].getBoundingClientRect().height / scale + lane + 3;
    const padding = parseFloat(style.paddingTop);
    this.padding = padding;
    this.bottom = box.clientHeight - parseFloat(style.paddingBottom);
    this.glyphHeight = this.chars[0].getBoundingClientRect().height / scale;
    const available = box.clientHeight - padding - parseFloat(style.paddingBottom);
    const capacity = Math.max(1, Math.floor((available + 1) / rowHeight));
    const history = capacity >= 3 ? rowHeight : 0;
    this.anchor = padding + lane + history;
    this.rows = rows.map(top => top + history);
    leading.style.height = `${history}px`;
    // Presentation-only slack makes the same anchor reachable on the last row.
    trailing.style.height = `${box.clientHeight}px`;
    this.maxScroll = box.scrollHeight - box.clientHeight;
    this.manual = false;
    this.follow(this.cursor, { immediate: true });
    this.onLayout?.();
  }

  follow(cursor, { input = false, immediate = false } = {}) {
    this.cursor = Math.min(cursor, this.chars.length - 1);
    if (this.disposed || !this.box.isConnected || !this.rows) return;
    const recovering = this.manual && input;
    if (input) this.manual = false;
    if (this.manual) return;
    const row = this.lines[this.cursor];
    const target = Math.max(0, Math.min(this.rows[row] - this.anchor,
      this.maxScroll));
    // A same-row key must neither restart nor extend the current transition.
    if (!immediate && !recovering && Math.abs(target - this.target) <= 1) return;
    this.target = target;
    this.cancel();
    if (immediate || this.motion.matches || document.body.classList.contains('no-motion') ||
        Math.abs(target - this.box.scrollTop) <= 1) {
      this.box.scrollTop = target;
      return;
    }
    // A burst can cross several rows before the browser presents a frame.
    // Catch up only as far as needed to keep the latest glyph fully readable,
    // then make one bounded transition to its anchor.
    const displayed = this.box.scrollTop;
    const from = recovering ? displayed : Math.max(
      this.rows[row] + this.glyphHeight - this.bottom,
      Math.min(this.rows[row] - this.padding, displayed));
    if (Math.abs(from - displayed) > 1) this.box.scrollTop = from;
    const started = performance.now();
    const step = now => {
      if (this.disposed || !this.box.isConnected) { this.frame = null; return; }
      // A busy frame's timestamp can precede the latest input/retarget time.
      const progress = Math.max(0, Math.min(1, (now - started) / 140));
      this.box.scrollTop = from + (target - from) * (1 - (1 - progress) ** 3);
      this.frame = progress < 1 ? requestAnimationFrame(step) : null;
    };
    this.frame = requestAnimationFrame(step);
  }
}
