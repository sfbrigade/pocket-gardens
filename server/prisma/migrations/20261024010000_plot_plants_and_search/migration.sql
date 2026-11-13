CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Plant_plantName_search_idx" ON "Plant" USING GIN (lower("plantName") gin_trgm_ops);
CREATE INDEX "Plant_commonName_search_idx" ON "Plant" USING GIN (lower("commonName") gin_trgm_ops);
CREATE INDEX "Plant_latinName_search_idx" ON "Plant" USING GIN (lower("latinName") gin_trgm_ops);

CREATE TABLE "PlotPlant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plotId" UUID NOT NULL,
    "plantId" UUID NOT NULL,
    "quantity" INTEGER,
    "notes" TEXT,
    "state" TEXT NOT NULL,
    CONSTRAINT "PlotPlant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlotPlant_quantity_check" CHECK ("quantity" >= 0),
    CONSTRAINT "PlotPlant_state_check" CHECK ("state" IN ('planned', 'current'))
);

CREATE UNIQUE INDEX "PlotPlant_plotId_plantId_key" ON "PlotPlant"("plotId", "plantId");
CREATE INDEX "PlotPlant_plantId_idx" ON "PlotPlant"("plantId");
ALTER TABLE "PlotPlant" ADD CONSTRAINT "PlotPlant_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlotPlant" ADD CONSTRAINT "PlotPlant_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
