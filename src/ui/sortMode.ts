export type SortMode = 'step-asc' | 'step-desc' | 'tok-desc' | 'tok-asc';

export const SORT_CYCLE: SortMode[] = ['step-asc', 'step-desc', 'tok-desc', 'tok-asc'];

export const SORT_LABELS: Record<SortMode, string> = {
  'step-asc': 'step ↑',
  'step-desc': 'step ↓',
  'tok-desc': 'tok ↓',
  'tok-asc': 'tok ↑',
};

export function nextSortMode(m: SortMode): SortMode {
  return SORT_CYCLE[(SORT_CYCLE.indexOf(m) + 1) % SORT_CYCLE.length];
}
