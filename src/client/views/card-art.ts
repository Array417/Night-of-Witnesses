import type { RoleId, PlayerLocationId, SpecialLocationId } from '../../shared/rules.ts';
import { el } from '../ui/dom.ts';

export function roleArt(role: RoleId, className = 'card-art'): HTMLImageElement {
  return el('img', { src: `/art/${role}.webp`, alt: '', 'aria-hidden': 'true', class: className, draggable: 'false', decoding: 'async' });
}

export function locationArt(location: PlayerLocationId | SpecialLocationId, className = 'location-art'): HTMLImageElement {
  return el('img', { src: `/art/${location}.webp`, alt: '', 'aria-hidden': 'true', class: className, draggable: 'false', decoding: 'async' });
}
