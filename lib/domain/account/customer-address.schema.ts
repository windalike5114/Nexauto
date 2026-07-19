import { z } from "zod";

const max = {
  label: 60,
  recipientName: 120,
  company: 120,
  phone: 40,
  line: 160,
  suburb: 120,
  city: 120,
  region: 120,
  postcode: 12
};

const OwnershipFieldsSchema = z.object({
  customerProfileId: z.never().optional(),
  authUserId: z.never().optional(),
  userId: z.never().optional()
});

const OptionalTextSchema = (length: number) =>
  z
    .string()
    .max(length)
    .optional()
    .nullable()
    .transform((value) => normalizeOptionalText(value));

const RequiredTextSchema = (length: number, message: string) =>
  z
    .string()
    .trim()
    .min(1, message)
    .max(length)
    .transform((value) => value.trim());

const PostcodeSchema = z
  .string()
  .max(max.postcode)
  .optional()
  .nullable()
  .transform((value, ctx) => {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "Postcode is required." });
      return z.NEVER;
    }
    if (!/^\d{4}$/.test(normalized)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid 4 digit NZ postcode." });
      return z.NEVER;
    }
    return normalized;
  });

export const CustomerAddressInputSchema = z
  .object({
    label: OptionalTextSchema(max.label).transform((value) => value ?? "Home"),
    recipientName: RequiredTextSchema(max.recipientName, "Recipient name is required."),
    company: OptionalTextSchema(max.company),
    phone: OptionalTextSchema(max.phone).transform((value) => normalizePhone(value)),
    line1: RequiredTextSchema(max.line, "Address line 1 is required."),
    line2: OptionalTextSchema(max.line),
    suburb: OptionalTextSchema(max.suburb),
    city: RequiredTextSchema(max.city, "City is required."),
    region: OptionalTextSchema(max.region),
    postcode: PostcodeSchema,
    country: z
      .string()
      .optional()
      .nullable()
      .transform((value) => (normalizeOptionalText(value) ?? "NZ").toUpperCase())
      .refine((value) => value === "NZ", "Only New Zealand addresses are supported."),
    isDefaultShipping: z.boolean().optional().default(false)
  })
  .merge(OwnershipFieldsSchema)
  .strict();

export const CustomerAddressPatchSchema = CustomerAddressInputSchema.partial()
  .extend({
    isDefaultShipping: z.boolean().optional()
  })
  .merge(OwnershipFieldsSchema)
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Address update is empty.");

export const LegacyCustomerAddressSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().optional(),
    name: z.string().optional(),
    recipientName: z.string().optional(),
    company: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    line1: z.string().optional(),
    line2: z.string().optional().nullable(),
    suburb: z.string().optional().nullable(),
    city: z.string().optional(),
    region: z.string().optional().nullable(),
    postcode: z.union([z.string(), z.number()]).optional(),
    country: z.string().optional().nullable(),
    isDefault: z.boolean().optional(),
    isDefaultShipping: z.boolean().optional()
  })
  .passthrough();

export const LegacyCustomerAddressImportSchema = z.object({
  addresses: z.array(LegacyCustomerAddressSchema).max(25)
});

export function normalizeLegacyAddress(input: z.infer<typeof LegacyCustomerAddressSchema>) {
  return CustomerAddressInputSchema.safeParse({
    label: input.label,
    recipientName: input.recipientName ?? input.name,
    company: input.company,
    phone: input.phone,
    line1: input.line1,
    line2: input.line2,
    suburb: input.suburb,
    city: input.city,
    region: input.region,
    postcode: input.postcode === undefined ? undefined : String(input.postcode).padStart(4, "0"),
    country: input.country ?? "NZ",
    isDefaultShipping: input.isDefaultShipping ?? input.isDefault ?? false
  });
}

export function addressFingerprint(address: CustomerAddressInput) {
  return [
    address.recipientName,
    address.line1,
    address.line2 ?? "",
    address.suburb ?? "",
    address.city,
    address.postcode,
    address.country
  ]
    .map((value) => value.trim().toLowerCase())
    .join("|");
}

export type CustomerAddressInput = z.infer<typeof CustomerAddressInputSchema>;
export type CustomerAddressPatch = z.infer<typeof CustomerAddressPatchSchema>;

function normalizeOptionalText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizePhone(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  return normalized.replace(/\s+/g, " ");
}
