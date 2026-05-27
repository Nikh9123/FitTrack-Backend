import { InferModel, relations } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { dietGoal, dietMealTime, dietPlanStatus } from "./lookups";
import { gyms } from "./gyms";
import { users } from "./users";

export const foodItems = pgTable(
  "food_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    brand: text("brand"),
    category: text("category"),
    servingSizeG: numeric("serving_size_g"),
    servingDescription: text("serving_description"),
    caloriesKcal: numeric("calories_kcal"),
    proteinG: numeric("protein_g"),
    fatG: numeric("fat_g"),
    carbsG: numeric("carbs_g"),
    sodiumMg: numeric("sodium_mg"),
    fiberG: numeric("fiber_g"),
    cholesterolMg: numeric("cholesterol_mg"),
    glycemicIndex: integer("glycemic_index"),
    source: text("source"),
    locale: text("locale").notNull().default("en_IN"),
    isVerified: boolean("is_verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameIndex: index("food_items_name_idx").on(table.name),
    categoryIndex: index("food_items_category_idx").on(table.category),
  }),
);

export const foodPortions = pgTable("food_portions", {
  id: uuid("id").defaultRandom().primaryKey(),
  foodItemId: uuid("food_item_id").notNull().references(() => foodItems.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  grams: numeric("grams").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dietPlans = pgTable(
  "diet_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    assignedBy: uuid("assigned_by").references(() => users.id),
    title: text("title").notNull(),
    goal: dietGoal("goal").notNull(),
    status: dietPlanStatus("status").notNull().default("draft"),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIndex: index("diet_plans_user_id_idx").on(table.userId),
    statusIndex: index("diet_plans_status_idx").on(table.status),
  }),
);

export const dietPlanMeals = pgTable(
  "diet_plan_meals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dietPlanId: uuid("diet_plan_id").notNull().references(() => dietPlans.id, { onDelete: "cascade" }),
    mealTime: dietMealTime("meal_time").notNull(),
    name: text("name"),
    notes: text("notes"),
    orderIndex: integer("order_index").notNull(),
  },
  (table) => ({
    dietPlanIndex: index("diet_plan_meals_diet_plan_id_idx").on(table.dietPlanId),
  }),
);

export const dietPlanItems = pgTable("diet_plan_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  mealId: uuid("meal_id").notNull().references(() => dietPlanMeals.id, { onDelete: "cascade" }),
  foodItemId: uuid("food_item_id").notNull().references(() => foodItems.id),
  quantity: text("quantity").notNull(),
  portionId: uuid("portion_id").references(() => foodPortions.id),
  notes: text("notes"),
});

export const dietLogs = pgTable("diet_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gymId: uuid("gym_id").references(() => gyms.id),
  logDate: timestamp("log_date", { withTimezone: true }).notNull(),
  mealTime: dietMealTime("meal_time").notNull(),
  foodItemId: uuid("food_item_id").notNull().references(() => foodItems.id),
  quantity: text("quantity").notNull(),
  portionId: uuid("portion_id").references(() => foodPortions.id),
  caloriesKcal: numeric("calories_kcal"),
  proteinG: numeric("protein_g"),
  fatG: numeric("fat_g"),
  carbsG: numeric("carbs_g"),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
});

export const waterLogs = pgTable("water_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gymId: uuid("gym_id").references(() => gyms.id),
  logDate: timestamp("log_date", { withTimezone: true }).notNull(),
  amountMl: integer("amount_ml").notNull(),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
});

export const nutritionTargets = pgTable("nutrition_targets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gymId: uuid("gym_id").references(() => gyms.id),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }),
  dailyCalories: integer("daily_calories"),
  proteinG: numeric("protein_g"),
  fatG: numeric("fat_g"),
  carbsG: numeric("carbs_g"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const foodSearchIndex = pgTable("food_search_index", {
  id: uuid("id").defaultRandom().primaryKey(),
  foodItemId: uuid("food_item_id").notNull().references(() => foodItems.id, { onDelete: "cascade" }),
  searchVector: text("search_vector").notNull(),
});

export const dietRelations = relations(dietPlans, ({ many }) => ({
  meals: many(dietPlanMeals),
}));

export type FoodItem = InferModel<typeof foodItems>;
export type FoodPortion = InferModel<typeof foodPortions>;
export type DietPlan = InferModel<typeof dietPlans>;
export type DietPlanMeal = InferModel<typeof dietPlanMeals>;
export type DietPlanItem = InferModel<typeof dietPlanItems>;
export type DietLog = InferModel<typeof dietLogs>;
export type WaterLog = InferModel<typeof waterLogs>;
export type NutritionTarget = InferModel<typeof nutritionTargets>;
export type FoodSearchIndex = InferModel<typeof foodSearchIndex>;

export const insertFoodItemSchema = createInsertSchema(foodItems).omit({ id: true, createdAt: true });
export const insertFoodPortionSchema = createInsertSchema(foodPortions).omit({ id: true, createdAt: true });
export const insertDietPlanSchema = createInsertSchema(dietPlans).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDietPlanMealSchema = createInsertSchema(dietPlanMeals).omit({ id: true });
export const insertDietPlanItemSchema = createInsertSchema(dietPlanItems).omit({ id: true });
export const insertDietLogSchema = createInsertSchema(dietLogs).omit({ id: true, loggedAt: true });
export const insertWaterLogSchema = createInsertSchema(waterLogs).omit({ id: true, loggedAt: true });
export const insertNutritionTargetSchema = createInsertSchema(nutritionTargets).omit({ id: true, updatedAt: true });
export const insertFoodSearchIndexSchema = createInsertSchema(foodSearchIndex).omit({ id: true });
