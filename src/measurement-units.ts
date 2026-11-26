export type MeasurementUnit = {
  id: string
  name: string
  isDefault: boolean
  isSystem: boolean
}

export const systemMeasurementUnits: MeasurementUnit[] = [
  { id: 'LM', name: 'متر جر', isDefault: true, isSystem: true },
  { id: 'SQM', name: 'متر مربع', isDefault: true, isSystem: true },
  { id: 'LOT', name: 'مقطوعية', isDefault: true, isSystem: true },
  { id: 'POINT', name: 'نقطة', isDefault: true, isSystem: true },
  { id: 'CBM', name: 'متر مكعب', isDefault: true, isSystem: true },
  { id: 'KG', name: 'كيلو', isDefault: true, isSystem: true },
  { id: 'GRAM', name: 'غرام', isDefault: true, isSystem: true },
]

export function normalizeMeasurementUnits(value: unknown): MeasurementUnit[] {
  const entries = Array.isArray(value) ? value : []
  const byId = new Map<string, MeasurementUnit>()
  entries.forEach((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return
    const item = entry as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 15) : ''
    if (!id || id.includes('/') || !name || byId.has(id)) return
    byId.set(id, {
      id,
      name,
      isDefault: item.isDefault === true,
      isSystem: false,
    })
  })

  const systemIds = new Set(systemMeasurementUnits.map((unit) => unit.id))
  const systemUnits = systemMeasurementUnits.map((unit) => {
    const saved = byId.get(unit.id)
    return {
      ...unit,
      name: saved?.name || unit.name,
      isDefault: saved ? saved.isDefault : true,
    }
  })
  const customUnits = [...byId.values()].filter((unit) => !systemIds.has(unit.id))
  return [...systemUnits, ...customUnits]
}
