// JSON exporter — stable, pretty, deterministic key order is not enforced (source order kept).

export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}
