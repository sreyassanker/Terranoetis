export interface EonetCategory {
  id?: unknown;
  title?: unknown;
  [key: string]: unknown;
}

export interface EonetEvent {
  categories?: unknown;
  [key: string]: unknown;
}

export interface EonetPayload {
  events?: EonetEvent[];
  [key: string]: unknown;
}

function normalizeCategory(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
}

export function readEonetCategoryFilter(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string') return undefined;

  const trimmed = candidate.trim();
  return trimmed || undefined;
}

export function filterEonetPayload<T extends EonetPayload>(payload: T, category?: string): T {
  const wanted = normalizeCategory(category);
  if (!wanted || !Array.isArray(payload.events)) return payload;

  const events = payload.events.filter((event) => {
    if (!Array.isArray(event.categories)) return false;
    return (event.categories as EonetCategory[]).some((item) =>
      normalizeCategory(item?.id) === wanted || normalizeCategory(item?.title) === wanted,
    );
  });

  return { ...payload, events };
}
