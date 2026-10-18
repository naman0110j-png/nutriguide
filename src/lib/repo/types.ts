import { z } from "zod";
import type { KnowledgeBase } from "../kb";
import {
  ChangeLogEntry,
  ChildProfile,
  ConcernEducationSchema,
  ConcernProductRuleSchema,
  EvidenceSourceSchema,
  Feedback,
  ProductImport,
  ProductSchema,
  RecipeProductSchema,
  RecipeSchema,
  RecommendationRuleSchema,
  SavedItem,
} from "../schemas";

export const ENTITY_SCHEMAS = {
  products: ProductSchema,
  recipes: RecipeSchema,
  recipeProducts: RecipeProductSchema,
  education: ConcernEducationSchema,
  concernProductRules: ConcernProductRuleSchema,
  recommendationRules: RecommendationRuleSchema,
  sources: EvidenceSourceSchema,
} as const;
export type EntityKind = keyof typeof ENTITY_SCHEMAS;
export const ENTITY_KINDS = Object.keys(ENTITY_SCHEMAS) as EntityKind[];
export const EntityKindSchema = z.enum(ENTITY_KINDS as [EntityKind, ...EntityKind[]]);

/** Status values each entity accepts (recipes use their own vocabulary). */
export const ENTITY_STATUSES: Record<EntityKind, readonly string[]> = {
  products: ["approved", "pending_review", "needs_rereview", "rejected"],
  recipes: ["verified", "review_required", "demo", "unavailable"],
  recipeProducts: ["approved", "pending_review", "needs_rereview", "rejected"],
  education: ["approved", "pending_review", "needs_rereview", "rejected"],
  concernProductRules: ["approved", "pending_review", "needs_rereview", "rejected"],
  recommendationRules: ["approved", "pending_review", "needs_rereview", "rejected"],
  sources: ["approved", "pending_review", "needs_rereview", "rejected"],
};

export interface StoredProfile {
  id: string;
  owner_id: string;
  profile: ChildProfile;
  created_at: string;
  updated_at: string;
}

export interface StoredSaved extends SavedItem {
  id: string;
  owner_id: string;
  created_at: string;
}

export interface StoredFeedback extends Feedback {
  id: string;
  profile_id: string | null;
  created_at: string;
}

export interface Repository {
  readonly kind: "demo" | "supabase";
  getKnowledgeBase(): Promise<KnowledgeBase>;

  // Parent data — every method is owner-scoped.
  saveProfile(ownerId: string, profile: ChildProfile, id?: string): Promise<StoredProfile>;
  getProfile(ownerId: string, id: string): Promise<StoredProfile | null>;
  listProfiles(ownerId: string): Promise<StoredProfile[]>;
  deleteProfile(ownerId: string, id: string): Promise<boolean>;
  deleteAllOwnerData(ownerId: string): Promise<{ profiles: number; saved: number }>;
  listSaved(ownerId: string): Promise<StoredSaved[]>;
  addSaved(ownerId: string, item: SavedItem): Promise<StoredSaved>;
  removeSaved(ownerId: string, id: string): Promise<boolean>;
  addFeedback(profileId: string | null, fb: Feedback): Promise<StoredFeedback>;

  // Admin.
  listFeedback(): Promise<StoredFeedback[]>;
  upsertEntity(kind: EntityKind, record: unknown, actor: string, sourceId?: string | null): Promise<{ record: unknown; changes: ChangeLogEntry[] }>;
  setEntityStatus(kind: EntityKind, id: string, status: string, actor: string): Promise<unknown>;
  listChangeLog(limit?: number): Promise<ChangeLogEntry[]>;
  appendChangeLog(entries: ChangeLogEntry[]): Promise<void>;
  listImports(): Promise<ProductImport[]>;
  saveImport(imp: ProductImport): Promise<ProductImport>;
  getImport(id: string): Promise<ProductImport | null>;
}
