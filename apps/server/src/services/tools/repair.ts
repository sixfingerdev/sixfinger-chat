/**
 * Araç argümanı onarımı (opencode `tool-input-repair`'ından esinlenildi): küçük açık modeller sık sık sayıyı metin ("20"),
 * mantıksal değeri metin ("false"), nesneyi JSON metni olarak gönderir ya da yer tutucu (`null`, `{}`) ekler.
 * Şema açıkça destekliyorsa sessizce düzeltir; modelin tek bir hata yüzünden turu yakmasını önler.
 */
type PropSchema = { type?: string | string[] };
export interface ParamSchema {
  properties?: Record<string, PropSchema>;
  required?: string[];
}

const typesOf = (p: PropSchema | undefined): string[] => (Array.isArray(p?.type) ? p!.type : p?.type ? [p.type] : []);

export function repairArgs(schema: ParamSchema, raw: Record<string, unknown>, aliases: Record<string, string[]> = {}): Record<string, unknown> {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const out: Record<string, unknown> = { ...raw };

  // Takma adlar: `file_path` → `path` gibi (yalnızca asıl ad yoksa).
  for (const [canonical, alts] of Object.entries(aliases)) {
    if (out[canonical] === undefined) {
      for (const alt of alts) {
        if (out[alt] !== undefined) {
          out[canonical] = out[alt];
          break;
        }
      }
    }
    for (const alt of alts) if (alt !== canonical) delete out[alt];
  }

  for (const [key, value] of Object.entries(out)) {
    const types = typesOf(props[key]);
    // Yer tutucular: zorunlu olmayan alandaki null / boş nesne yok sayılır.
    if (value === null || (!required.has(key) && value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) {
      if (!required.has(key)) delete out[key];
      continue;
    }
    if (!types.length) continue;
    if (typeof value === 'string') {
      const v = value.trim();
      if ((types.includes('integer') || types.includes('number')) && !types.includes('string') && v !== '' && Number.isFinite(Number(v))) {
        out[key] = types.includes('integer') && !Number.isInteger(Number(v)) ? Math.round(Number(v)) : Number(v);
      } else if (types.includes('boolean') && !types.includes('string') && /^(true|false)$/i.test(v)) {
        out[key] = v.toLowerCase() === 'true';
      } else if ((types.includes('object') || types.includes('array')) && !types.includes('string') && /^[[{]/.test(v)) {
        try {
          out[key] = JSON.parse(v);
        } catch {
          /* doğrulama hatası olarak döner */
        }
      }
    } else if (typeof value === 'number' && types.includes('string') && !types.includes('number') && !types.includes('integer')) {
      out[key] = String(value);
    } else if (typeof value === 'boolean' && types.includes('string') && !types.includes('boolean')) {
      out[key] = String(value);
    } else if (typeof value === 'number' && types.includes('integer') && !Number.isInteger(value)) {
      out[key] = Math.round(value);
    }
  }
  return out;
}
