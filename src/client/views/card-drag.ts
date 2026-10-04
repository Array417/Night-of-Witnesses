/** Moves the original card, never a native browser drag image or a role-bearing clone. */
let activeCleanup: (() => void) | null = null;

export function disposeCardDrag(): void {
  activeCleanup?.();
  activeCleanup = null;
}

export function wireCardDrag(card: HTMLElement, root: HTMLElement, drop: (target: HTMLElement) => void): void {
  card.dataset.pointerDraggable = 'true';
  card.draggable = false;
  let suppressClickUntil = 0;
  card.addEventListener('click', event => {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  card.addEventListener('pointerdown', event => {
    // A new deliberate press must not be swallowed by the previous drag's ghost-click guard.
    suppressClickUntil = 0;
    if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest('button')) return;
    disposeCardDrag();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = card.getBoundingClientRect();
    const oldStyle = card.getAttribute('style');
    let placeholder: HTMLElement | null = null;
    let dragging = false;
    let target: HTMLElement | null = null;
    const targets = [...root.querySelectorAll<HTMLElement>('.seat.is-eligible, .guest-room-target')];
    function finish(cancelled = true): void {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel);
      if (card.hasPointerCapture(pointerId)) card.releasePointerCapture(pointerId);
      for (const candidate of targets) candidate.classList.remove('is-drop-ready');
      if (dragging) {
        suppressClickUntil = performance.now() + 500;
        placeholder?.replaceWith(card);
        if (oldStyle === null) card.removeAttribute('style'); else card.setAttribute('style', oldStyle);
        card.classList.remove('is-pointer-dragging');
      }
      activeCleanup = null;
      if (!cancelled && target && root.isConnected) drop(target);
    }
    function move(next: PointerEvent): void {
      if (next.pointerId !== pointerId) return;
      if (!dragging && Math.hypot(next.clientX - startX, next.clientY - startY) < 6) return;
      next.preventDefault();
      if (!dragging) {
        dragging = true;
        placeholder = document.createElement('div');
        placeholder.className = 'card-placeholder';
        placeholder.style.width = `${rect.width}px`;
        placeholder.style.height = `${rect.height}px`;
        card.before(placeholder);
        document.body.appendChild(card);
        card.classList.add('is-pointer-dragging');
        Object.assign(card.style, { position: 'fixed', width: `${rect.width}px`, height: `${rect.height}px`, minHeight: '0', margin: '0', zIndex: '1100', pointerEvents: 'none', transition: 'none', transform: 'none', opacity: '1' });
        card.setPointerCapture(pointerId);
      }
      card.style.left = `${rect.left + next.clientX - startX}px`;
      card.style.top = `${rect.top + next.clientY - startY}px`;
      const hit = document.elementFromPoint(next.clientX, next.clientY);
      target = targets.find(candidate => candidate === hit || (hit && candidate.contains(hit))) ?? null;
      for (const candidate of targets) candidate.classList.toggle('is-drop-ready', candidate === target);
    }
    function up(next: PointerEvent): void { if (next.pointerId === pointerId) finish(!dragging); }
    function cancel(): void { finish(); }
    function key(next: KeyboardEvent): void { if (next.key === 'Escape') { next.preventDefault(); finish(); } }
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
    activeCleanup = cancel;
  });
}
