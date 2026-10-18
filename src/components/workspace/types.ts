import type { recommendationsFor } from "@/lib/server/service";
import type { ChatReply } from "@/lib/ai/chat";

export type RecResponse = Awaited<ReturnType<typeof recommendationsFor>>;
export type RecCard = RecResponse["recipe_recommendations"][number];
export type MoreCard = RecResponse["more_recipes"][number];
export type OwnedInfo = RecResponse["owned_products"][number];
export type ProductInfo = RecResponse["product_information"][number];
export type { ChatReply };
