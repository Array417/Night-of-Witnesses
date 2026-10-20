import { useLayoutEffect, useRef, type RefObject } from 'react';

export function usePointerDrag(ref: RefObject<HTMLElement | null>, enabled: boolean, onDrop: (target: HTMLElement) => void, selector = '.seat.is-eligible, .guest-room-target') {
  const suppressClick = useRef(0);
  const callback = useRef(onDrop);
  callback.current = onDrop;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    let cleanup = () => {};
    const down = (event: PointerEvent) => {
      const button = (event.target as Element).closest('button');
      if (!event.isPrimary || event.button !== 0 || (button && button !== element)) return;
      const root = element.closest('.table-stage');
      if (!root) return;
      cleanup();
      const rect = element.getBoundingClientRect();
      const original = element.getAttribute('style');
      let dragging = false;
      let target: HTMLElement | null = null;
      const targets = [...root.querySelectorAll<HTMLElement>(selector)];
      const finish = (accept: boolean) => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); document.removeEventListener('keydown', key); window.removeEventListener('blur', cancel);
        element.classList.remove('is-pointer-dragging');
        if (original === null) element.removeAttribute('style'); else element.setAttribute('style', original);
        targets.forEach(candidate => candidate.classList.remove('is-drop-ready'));
        if (dragging) suppressClick.current = performance.now() + 500;
        if (accept && target) callback.current(target);
      };
      const move = (next: PointerEvent) => {
        if (next.pointerId !== event.pointerId) return;
        if (!dragging && Math.hypot(next.clientX-event.clientX, next.clientY-event.clientY) < 6) return;
        next.preventDefault(); dragging = true;
        Object.assign(element.style, { position:'fixed', width:`${rect.width}px`, height:`${rect.height}px`, left:`${rect.left+next.clientX-event.clientX}px`, top:`${rect.top+next.clientY-event.clientY}px`, zIndex:'1200', pointerEvents:'none', margin:'0', transform:'none', transition:'none', translate:'none' });
        element.classList.add('is-pointer-dragging');
        const hit = document.elementFromPoint(next.clientX, next.clientY);
        target = targets.find(candidate => candidate === hit || (hit && candidate.contains(hit))) ?? null;
        targets.forEach(candidate => candidate.classList.toggle('is-drop-ready', candidate === target));
      };
      const up = (next: PointerEvent) => { if (next.pointerId === event.pointerId) finish(dragging); };
      const cancel = () => finish(false);
      const key = (next: KeyboardEvent) => { if (next.key === 'Escape') finish(false); };
      cleanup = cancel;
      document.addEventListener('pointermove', move, {passive:false}); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel); document.addEventListener('keydown', key); window.addEventListener('blur', cancel);
    };
    element.dataset.pointerDraggable = 'true';
    element.addEventListener('pointerdown', down);
    return () => { cleanup(); delete element.dataset.pointerDraggable; element.removeEventListener('pointerdown', down); };
  }, [ref, enabled, selector]);
  return suppressClick;
}
