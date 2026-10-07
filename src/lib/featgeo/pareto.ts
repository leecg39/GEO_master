/**
 * NSGA-II 다목적 선택 — featgeo/geo_ad/multi_objective.py, ga_optimizer.py의 이식.
 * 목적 2개(인용 노출도, 콘텐츠 품질)는 모두 최대화한다.
 */
import type { Random } from "./rng";

export type Objectives = readonly [number, number];

export function dominates(a: Objectives, b: Objectives) {
  return a[0] >= b[0] && a[1] >= b[1] && (a[0] > b[0] || a[1] > b[1]);
}

export function nonDominatedSort(objectives: readonly Objectives[]): number[][] {
  const count = objectives.map(() => 0);
  const dominated: number[][] = objectives.map(() => []);
  for (let i = 0; i < objectives.length; i += 1) {
    for (let j = i + 1; j < objectives.length; j += 1) {
      if (dominates(objectives[i]!, objectives[j]!)) {
        dominated[i]!.push(j);
        count[j]! += 1;
      } else if (dominates(objectives[j]!, objectives[i]!)) {
        dominated[j]!.push(i);
        count[i]! += 1;
      }
    }
  }
  const fronts: number[][] = [];
  let current = objectives.map((_, index) => index).filter((index) => count[index] === 0);
  while (current.length) {
    fronts.push(current);
    const next: number[] = [];
    for (const i of current) {
      for (const j of dominated[i]!) {
        count[j]! -= 1;
        if (count[j] === 0) next.push(j);
      }
    }
    current = next;
  }
  return fronts;
}

export function crowdingDistance(objectives: readonly Objectives[], front: readonly number[]): number[] {
  if (front.length <= 2) return front.map(() => Infinity);
  const distances = front.map(() => 0);
  for (const axis of [0, 1] as const) {
    const order = front.map((_, position) => position).sort((a, b) => objectives[front[a]!]![axis] - objectives[front[b]!]![axis]);
    const min = objectives[front[order[0]!]!]![axis];
    const max = objectives[front[order.at(-1)!]!]![axis];
    distances[order[0]!] = Infinity;
    distances[order.at(-1)!] = Infinity;
    if (max - min <= 0) continue;
    for (let k = 1; k < order.length - 1; k += 1) {
      const next = objectives[front[order[k + 1]!]!]![axis];
      const previous = objectives[front[order[k - 1]!]!]![axis];
      distances[order[k]!]! += (next - previous) / (max - min);
    }
  }
  return distances;
}

export function selectByNsga2(objectives: readonly Objectives[], size: number): number[] {
  const selected: number[] = [];
  for (const front of nonDominatedSort(objectives)) {
    if (selected.length + front.length <= size) {
      selected.push(...front);
    } else {
      const distances = crowdingDistance(objectives, front);
      const ranked = front.map((index, position) => ({ index, distance: distances[position]! })).sort((a, b) => b.distance - a.distance);
      selected.push(...ranked.slice(0, size - selected.length).map((item) => item.index));
    }
    if (selected.length >= size) break;
  }
  return selected;
}

export function paretoFront(objectives: readonly Objectives[]) {
  return nonDominatedSort(objectives)[0] ?? [];
}

/** 이진 토너먼트 — 앞쪽 전선 우선, 같으면 혼잡 거리 큰 쪽 */
export function tournamentSelect(objectives: readonly Objectives[], random: Random): number {
  const rank = new Map<number, { front: number; distance: number }>();
  nonDominatedSort(objectives).forEach((front, frontIndex) => {
    const distances = crowdingDistance(objectives, front);
    front.forEach((index, position) => rank.set(index, { front: frontIndex, distance: distances[position]! }));
  });
  const a = Math.floor(random() * objectives.length);
  const b = Math.floor(random() * objectives.length);
  const ra = rank.get(a)!;
  const rb = rank.get(b)!;
  if (ra.front !== rb.front) return ra.front < rb.front ? a : b;
  return ra.distance >= rb.distance ? a : b;
}
