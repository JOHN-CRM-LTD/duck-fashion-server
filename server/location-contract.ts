import { z } from "zod";

export const LOCATION_PAGE_SIZE = 50;
export const LOCATION_LIMIT = 5000;
const text = z.string().trim().max(200).nullable().default(null);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const windows = z.array(z.object({ open: time, close: time }).refine(w => w.close > w.open)).max(3)
  .refine(rows => rows.every((row, i) => i === 0 || row.open >= rows[i - 1].close), "Opening hours overlap");
export const sourceLocationSchema = z.object({
  id: z.number().int().positive().safe(),
  inventoryLocationId: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(120),
  phone: text, managerName: text, managerPhone: text,
  addressLine1: text, addressLine2: text, locality: text, region: text, postcode: text,
  country: z.string().regex(/^[A-Z]{2}$/),
  timezone: z.string().max(80).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  hours: z.object({ mon: windows.optional(), tue: windows.optional(), wed: windows.optional(), thu: windows.optional(), fri: windows.optional(), sat: windows.optional(), sun: windows.optional() }).strict(),
  isActive: z.boolean(), isDefault: z.boolean().default(false),
  capacity: z.number().int().min(1).max(50).default(1),
  acceptsReservations: z.boolean().default(false),
  slotStepMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(30),
  durationMinutesOverride: z.number().int().positive().max(1440).nullable().default(null),
}).refine(row => (row.latitude === null) === (row.longitude === null), "Provide both coordinates");
export const locationPageSchema = z.object({ locations: z.array(sourceLocationSchema).max(LOCATION_PAGE_SIZE), hasMore: z.boolean(), revision: z.string().min(1).max(200) });
export type SourceLocation = z.infer<typeof sourceLocationSchema>;
export const locationSourceSettingsSchema = z.object({
  mode: z.enum(["local", "api"]).default("local"),
  connectorId: z.number().int().positive().nullable(),
  offsetParam: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/).default("offset"),
  limitParam: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/).default("limit"),
  locationsPath: z.string().regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/).max(150).default("locations"),
  hasMorePath: z.string().regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/).max(150).default("hasMore"),
  revisionPath: z.string().regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/).max(150).default("revision"),
}).refine(value => value.offsetParam !== value.limitParam, "Paging parameters must differ");
export type LocationSourceSettings = z.infer<typeof locationSourceSettingsSchema>;
export const defaultLocationSource = (): LocationSourceSettings => locationSourceSettingsSchema.parse({ connectorId: null });

/** All-or-error: never expose a partial directory as the full set of shops. */
export async function readLocationPages(read: (offset: number, limit: number) => Promise<unknown>): Promise<SourceLocation[]> {
  const rows: SourceLocation[] = [], ids = new Set<number>(), shopIds = new Set<string>();
  let revision: string | undefined;
  while (rows.length < LOCATION_LIMIT) {
    const page = locationPageSchema.parse(await read(rows.length, LOCATION_PAGE_SIZE));
    if (revision !== undefined && page.revision !== revision) throw new Error("The location source changed between pages");
    revision = page.revision;
    if (page.hasMore && !page.locations.length) throw new Error("The location source made no paging progress");
    for (const location of page.locations) {
      if (ids.has(location.id) || shopIds.has(location.inventoryLocationId)) throw new Error("Duplicate source location ID");
      ids.add(location.id); shopIds.add(location.inventoryLocationId); rows.push(location);
    }
    if (rows.length > LOCATION_LIMIT) throw new Error("The location directory exceeds the supported limit");
    if (!page.hasMore) {
      if (rows.filter(row => row.isDefault).length > 1) throw new Error("Multiple default source locations");
      return rows;
    }
  }
  throw new Error("The location directory exceeds the supported limit");
}
