-- CreateTable
CREATE TABLE "Neighborhood" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "airtableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Neighborhood_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZipCode" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "airtableId" TEXT NOT NULL,
    "code" TEXT,
    "plantedPlotCount" INTEGER,
    "notYetPlantedPlotCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZipCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NeighborhoodZipCode" (
    "neighborhoodId" UUID NOT NULL,
    "zipCodeId" UUID NOT NULL,

    CONSTRAINT "NeighborhoodZipCode_pkey" PRIMARY KEY ("neighborhoodId","zipCodeId")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "airtableId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "homeZipId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonZipCode" (
    "personId" UUID NOT NULL,
    "zipCodeId" UUID NOT NULL,

    CONSTRAINT "PersonZipCode_pkey" PRIMARY KEY ("personId","zipCodeId")
);

-- CreateTable
CREATE TABLE "Plant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "airtableId" TEXT NOT NULL,
    "plantName" TEXT,
    "latinName" TEXT,
    "commonName" TEXT,
    "locations" TEXT,
    "numberPlanted" INTEGER,
    "photo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "airtableId" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT,
    "streetAddress" TEXT,
    "streetCityAddress" TEXT,
    "mapCoordinates" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "bedType" TEXT,
    "bedId" TEXT,
    "soilType" TEXT,
    "visitIntervalDays" INTEGER,
    "estAreaSqFt" DOUBLE PRECISION,
    "locationDescription" TEXT,
    "sethsNotes" TEXT,
    "geocodeCache" TEXT,
    "photo" JSONB,
    "photos" JSONB,
    "originalPlantDate" TIMESTAMP(3),
    "lastPlant" TIMESTAMP(3),
    "lastWater" TIMESTAMP(3),
    "lastWeed" TIMESTAMP(3),
    "lastMulch" TIMESTAMP(3),
    "lastVisit" TIMESTAMP(3),
    "nextVisit" TEXT,
    "alert" TEXT,
    "zipCodeId" UUID,
    "neighborhoodId" UUID,
    "lastVolunteerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlotAssignedVolunteer" (
    "plotId" UUID NOT NULL,
    "personId" UUID NOT NULL,

    CONSTRAINT "PlotAssignedVolunteer_pkey" PRIMARY KEY ("plotId","personId")
);

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "airtableId" TEXT NOT NULL,
    "airtableNumber" INTEGER,
    "date" TIMESTAMP(3),
    "activity" TEXT[],
    "notes" TEXT,
    "planting" TEXT,
    "estNextVisit" TIMESTAMP(3),
    "volunteerPhotos" JSONB,
    "plotId" UUID,
    "volunteerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRecordPlant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "maintenanceRecordId" UUID NOT NULL,
    "plantId" UUID NOT NULL,
    "slot" INTEGER NOT NULL,
    "quantity" INTEGER,

    CONSTRAINT "MaintenanceRecordPlant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Neighborhood_airtableId_key" ON "Neighborhood"("airtableId");

-- CreateIndex
CREATE UNIQUE INDEX "ZipCode_airtableId_key" ON "ZipCode"("airtableId");

-- CreateIndex
CREATE INDEX "NeighborhoodZipCode_zipCodeId_idx" ON "NeighborhoodZipCode"("zipCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_airtableId_key" ON "Person"("airtableId");

-- CreateIndex
CREATE INDEX "Person_homeZipId_idx" ON "Person"("homeZipId");

-- CreateIndex
CREATE INDEX "PersonZipCode_zipCodeId_idx" ON "PersonZipCode"("zipCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Plant_airtableId_key" ON "Plant"("airtableId");

-- CreateIndex
CREATE UNIQUE INDEX "Plot_airtableId_key" ON "Plot"("airtableId");

-- CreateIndex
CREATE INDEX "Plot_latitude_longitude_idx" ON "Plot"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Plot_zipCodeId_idx" ON "Plot"("zipCodeId");

-- CreateIndex
CREATE INDEX "Plot_neighborhoodId_idx" ON "Plot"("neighborhoodId");

-- CreateIndex
CREATE INDEX "Plot_lastVolunteerId_idx" ON "Plot"("lastVolunteerId");

-- CreateIndex
CREATE INDEX "Plot_status_idx" ON "Plot"("status");

-- CreateIndex
CREATE INDEX "PlotAssignedVolunteer_personId_idx" ON "PlotAssignedVolunteer"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceRecord_airtableId_key" ON "MaintenanceRecord"("airtableId");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_plotId_idx" ON "MaintenanceRecord"("plotId");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_volunteerId_idx" ON "MaintenanceRecord"("volunteerId");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_date_idx" ON "MaintenanceRecord"("date");

-- CreateIndex
CREATE INDEX "MaintenanceRecordPlant_plantId_idx" ON "MaintenanceRecordPlant"("plantId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceRecordPlant_maintenanceRecordId_slot_key" ON "MaintenanceRecordPlant"("maintenanceRecordId", "slot");

-- AddForeignKey
ALTER TABLE "NeighborhoodZipCode" ADD CONSTRAINT "NeighborhoodZipCode_neighborhoodId_fkey" FOREIGN KEY ("neighborhoodId") REFERENCES "Neighborhood"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NeighborhoodZipCode" ADD CONSTRAINT "NeighborhoodZipCode_zipCodeId_fkey" FOREIGN KEY ("zipCodeId") REFERENCES "ZipCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_homeZipId_fkey" FOREIGN KEY ("homeZipId") REFERENCES "ZipCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonZipCode" ADD CONSTRAINT "PersonZipCode_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonZipCode" ADD CONSTRAINT "PersonZipCode_zipCodeId_fkey" FOREIGN KEY ("zipCodeId") REFERENCES "ZipCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_zipCodeId_fkey" FOREIGN KEY ("zipCodeId") REFERENCES "ZipCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_neighborhoodId_fkey" FOREIGN KEY ("neighborhoodId") REFERENCES "Neighborhood"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_lastVolunteerId_fkey" FOREIGN KEY ("lastVolunteerId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotAssignedVolunteer" ADD CONSTRAINT "PlotAssignedVolunteer_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotAssignedVolunteer" ADD CONSTRAINT "PlotAssignedVolunteer_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_volunteerId_fkey" FOREIGN KEY ("volunteerId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecordPlant" ADD CONSTRAINT "MaintenanceRecordPlant_maintenanceRecordId_fkey" FOREIGN KEY ("maintenanceRecordId") REFERENCES "MaintenanceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecordPlant" ADD CONSTRAINT "MaintenanceRecordPlant_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
