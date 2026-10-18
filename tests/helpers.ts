import { ChildProfileSchema, type ChildProfile } from "@/lib/schemas";
import { seedKnowledgeBase, DEMO_PROFILES } from "@/data/seed";

export const kb = () => seedKnowledgeBase();

export function profile(overrides: Partial<ChildProfile> = {}): ChildProfile {
  return ChildProfileSchema.parse({
    age_years: 5,
    age_months: 0,
    dietary_pattern: "non_vegetarian",
    no_known_allergies: true,
    ...overrides,
  });
}

export const demo = (key: string) => ChildProfileSchema.parse(DEMO_PROFILES.find((d) => d.key === key)!.profile);

export const NUTRIMIX_2_6 = "lj-nutrimix-2-6-chocolate-350g";

export const ownsNutrimix = {
  products: [
    {
      catalog_product_id: NUTRIMIX_2_6,
      is_external_unverified: false,
      brand: "Little Joys",
      product_name: "Nutrimix",
      variant: "Chocolate",
      follows_pack_instructions: "not_sure" as const,
      wants_help: ["using" as const],
    },
  ],
};
