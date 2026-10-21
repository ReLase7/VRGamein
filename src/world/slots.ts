import * as THREE from 'three';
import type { Item } from '../items/item';

export type SlotType = 'counter' | 'board' | 'pan' | 'fryer' | 'oven' | 'tray' | 'serve' | 'knife';

/** Точка «прилипания»: на неё можно поставить предмет. */
export class Slot {
  occupant: Item | null = null;
  constructor(
    readonly type: SlotType,
    readonly pos: THREE.Vector3,
    readonly rotY = 0,
  ) {}

  accepts(item: Item): boolean {
    if (this.occupant) return false;
    switch (this.type) {
      case 'counter':
        return true;
      case 'board':
        return item.isIngredient;
      case 'pan':
        return item.kind === 'patty';
      case 'fryer':
        return item.kind === 'chicken' || (item.kind === 'potato' && item.state !== 'raw');
      case 'oven':
        return item.kind === 'dough' && item.state !== 'raw';
      case 'tray':
        return item.kind === 'doner';
      case 'serve':
        return item.kind === 'plate';
      case 'knife':
        return item.kind === 'knife';
    }
  }
}

/** Горизонтальная поверхность (верх стола), на которую могут упасть предметы. */
export interface Surface {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
}

export function onSurface(s: Surface, x: number, z: number, margin = 0): boolean {
  return x >= s.minX - margin && x <= s.maxX + margin && z >= s.minZ - margin && z <= s.maxZ + margin;
}
