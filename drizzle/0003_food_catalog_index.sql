-- Unique catalog entries by name (catalog foods only; user custom foods stay separate)
CREATE UNIQUE INDEX IF NOT EXISTS "food_items_catalog_name_uidx"
  ON "food_items" (lower("name"))
  WHERE "source" = 'fittrack_catalog';
