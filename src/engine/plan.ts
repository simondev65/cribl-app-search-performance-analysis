import { findRange, findSearch, renderQuery } from '../lib/suite';
import type { PlanItem, RunConfig, Side } from '../lib/types';

/** Anchor every time window on a whole minute, minus a settle lag so late data does not bias either side. */
export function anchorFor(now: number, settleLagMinutes: number): number {
  return Math.floor(now / 1000 / 60) * 60 - settleLagMinutes * 60;
}

export function buildPlan(config: RunConfig, anchorLatest: number): PlanItem[] {
  const items: PlanItem[] = [];
  const query = (side: Side, template: string, span: string) =>
    renderQuery(template, {
      dataset: side === 'A' ? config.datasetA.id : config.datasetB.id,
      fields: side === 'A' ? config.fieldMapA : config.fieldMapB,
      span,
      needle: config.needle,
    });

  if (config.warmup) {
    for (const side of ['A', 'B'] as Side[]) {
      items.push({
        key: `warmup:${side}`,
        searchId: 'warmup',
        rangeId: '15m',
        side,
        rep: 0,
        warmup: true,
        query: query(side, 'dataset="{{ds}}" | limit 10', '1m'),
        earliest: anchorLatest - 15 * 60,
        latest: anchorLatest,
      });
    }
  }

  const scored: PlanItem[] = [];
  let pairIndex = 0;
  for (const searchId of config.searchIds) {
    const search = findSearch(searchId);
    if (!search) continue;
    for (const rangeId of config.rangeIds) {
      const range = findRange(rangeId);
      if (!range) continue;
      for (let rep = 1; rep <= config.repetitions; rep += 1) {
        // Alternate who goes first so neither side always benefits from a warm coordinator.
        const sides: Side[] = pairIndex % 2 === 0 ? ['A', 'B'] : ['B', 'A'];
        pairIndex += 1;
        for (const side of sides) {
          scored.push({
            key: `${searchId}:${rangeId}:${side}:${rep}`,
            searchId,
            rangeId,
            side,
            rep,
            warmup: false,
            query: query(side, search.template, range.span),
            earliest: anchorLatest - range.seconds,
            latest: anchorLatest,
          });
        }
      }
    }
  }

  if (config.order === 'dataset') {
    items.push(...scored.filter((i) => i.side === 'A'), ...scored.filter((i) => i.side === 'B'));
  } else {
    items.push(...scored);
  }
  return items;
}

export function isFinished(item: PlanItem): boolean {
  return !!item.stats && !['pending', 'running'].includes(item.stats.status);
}
