/**
 * Counters and gauges in Prometheus text format.
 *
 * Kept deliberately dependency-free and allocation-light: the point is to make
 * a self-hosted relay debuggable ("are phones being refused, and why?") without
 * dragging in a metrics framework. Label values are restricted to a fixed set
 * at the call sites so the cardinality cannot be driven by a remote peer.
 */
export type MetricLabels = Record<string, string>

function labelKey(labels: MetricLabels | undefined): string {
  if (!labels) {
    return ''
  }
  return Object.keys(labels)
    .sort()
    .map((name) => `${name}=${JSON.stringify(labels[name])}`)
    .join(',')
}

type Series = { labels: MetricLabels | undefined; value: number }

class Family {
  readonly series = new Map<string, Series>()
  constructor(
    readonly name: string,
    readonly help: string,
    readonly type: 'counter' | 'gauge'
  ) {}

  add(delta: number, labels?: MetricLabels): void {
    const key = labelKey(labels)
    const existing = this.series.get(key)
    if (existing) {
      existing.value += delta
    } else {
      this.series.set(key, { labels, value: delta })
    }
  }

  set(value: number, labels?: MetricLabels): void {
    this.series.set(labelKey(labels), { labels, value })
  }
}

export class Metrics {
  private readonly families = new Map<string, Family>()

  private family(name: string, help: string, type: 'counter' | 'gauge'): Family {
    let family = this.families.get(name)
    if (!family) {
      family = new Family(name, help, type)
      this.families.set(name, family)
    }
    return family
  }

  counter(name: string, help: string, labels?: MetricLabels, delta = 1): void {
    this.family(name, help, 'counter').add(delta, labels)
  }

  gauge(name: string, help: string, value: number, labels?: MetricLabels): void {
    this.family(name, help, 'gauge').set(value, labels)
  }

  render(): string {
    const lines: string[] = []
    for (const family of this.families.values()) {
      lines.push(`# HELP ${family.name} ${family.help}`)
      lines.push(`# TYPE ${family.name} ${family.type}`)
      for (const series of family.series.values()) {
        const labels = series.labels
          ? `{${Object.keys(series.labels)
              .sort()
              .map((name) => `${name}=${JSON.stringify(series.labels![name])}`)
              .join(',')}}`
          : ''
        lines.push(`${family.name}${labels} ${series.value}`)
      }
    }
    return `${lines.join('\n')}\n`
  }
}
