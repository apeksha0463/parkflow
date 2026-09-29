-- PostGIS must exist before geography columns are created.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ParkingType" AS ENUM ('PUBLIC', 'ON_STREET', 'OFF_STREET', 'MULTI_LEVEL', 'UNDERGROUND', 'MALL', 'HOSPITAL', 'HOTEL', 'METRO', 'RAILWAY', 'EDUCATIONAL', 'COMMERCIAL', 'PRIVATE_PUBLIC_ACCESS', 'RESIDENTIAL', 'EV_CHARGING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('LIVE_SENSOR', 'PUBLIC_API', 'PARKING_OPERATOR', 'VERIFIED_DIRECTORY', 'USER_REPORTED', 'HISTORICAL_DATA', 'SIMULATION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AvailabilityMode" AS ENUM ('NONE', 'LIVE', 'SIMULATION');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('CAR', 'TWO_WHEELER', 'BICYCLE', 'BUS', 'TRUCK');

-- CreateEnum
CREATE TYPE "ZoneKind" AS ENUM ('WHOLE_FACILITY', 'LEVEL', 'SEGMENT', 'AREA');

-- CreateEnum
CREATE TYPE "SaturationState" AS ENUM ('NORMAL', 'APPROACHING_SATURATION', 'SATURATED');

-- CreateEnum
CREATE TYPE "ModelFeatureSet" AS ENUM ('BASELINE', 'TEMPORAL', 'SPATIAL_TEMPORAL');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "url" TEXT,
    "license" TEXT,
    "description" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingFacility" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "type" "ParkingType" NOT NULL DEFAULT 'UNKNOWN',
    "address" TEXT,
    "area" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" geography(Point, 4326),
    "capacity" INTEGER,
    "vehicleTypes" "VehicleType"[],
    "evCharging" BOOLEAN,
    "pricingText" TEXT,
    "isFree" BOOLEAN,
    "operatingHours" TEXT,
    "availabilityMode" "AvailabilityMode" NOT NULL DEFAULT 'NONE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "bookingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dataSourceId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParkingFacility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingZone" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ZoneKind" NOT NULL DEFAULT 'WHOLE_FACILITY',
    "levelNumber" INTEGER,
    "capacity" INTEGER,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" geography(Point, 4326),
    "saturationState" "SaturationState" NOT NULL DEFAULT 'NORMAL',
    "replaySourceZone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParkingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OccupancySnapshot" (
    "id" BIGSERIAL NOT NULL,
    "zoneId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "occupied" INTEGER,
    "available" INTEGER,
    "capacity" INTEGER,
    "occupancy" DOUBLE PRECISION NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OccupancySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaturationEvent" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "peakOccupancy" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaturationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL,
    "featureSet" "ModelFeatureSet" NOT NULL,
    "algorithm" TEXT NOT NULL,
    "trainingDataset" TEXT NOT NULL,
    "trainedAt" TIMESTAMP(3) NOT NULL,
    "featureVersion" TEXT NOT NULL,
    "horizonsMinutes" INTEGER[],
    "metrics" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" BIGSERIAL NOT NULL,
    "zoneId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "triggerEventId" TEXT,
    "predictionTime" TIMESTAMP(3) NOT NULL,
    "horizonMinutes" INTEGER NOT NULL,
    "targetTime" TIMESTAMP(3) NOT NULL,
    "predictedOccupancy" DOUBLE PRECISION NOT NULL,
    "actualOccupancy" DOUBLE PRECISION,
    "absError" DOUBLE PRECISION,
    "evaluatedAt" TIMESTAMP(3),
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "zoneId" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "vehiclePlate" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedParking" (
    "userId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedParking_pkey" PRIMARY KEY ("userId","facilityId")
);

-- CreateTable
CREATE TABLE "RecentSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecentSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_name_key" ON "DataSource"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingFacility_externalId_key" ON "ParkingFacility"("externalId");

-- CreateIndex
CREATE INDEX "ParkingFacility_area_idx" ON "ParkingFacility"("area");

-- CreateIndex
CREATE INDEX "ParkingFacility_type_idx" ON "ParkingFacility"("type");

-- CreateIndex
CREATE INDEX "ParkingFacility_location_idx" ON "ParkingFacility" USING GIST ("location");

-- CreateIndex
CREATE INDEX "ParkingZone_facilityId_idx" ON "ParkingZone"("facilityId");

-- CreateIndex
CREATE INDEX "ParkingZone_location_idx" ON "ParkingZone" USING GIST ("location");

-- CreateIndex
CREATE INDEX "OccupancySnapshot_observedAt_idx" ON "OccupancySnapshot"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OccupancySnapshot_zoneId_observedAt_key" ON "OccupancySnapshot"("zoneId", "observedAt");

-- CreateIndex
CREATE INDEX "SaturationEvent_zoneId_startedAt_idx" ON "SaturationEvent"("zoneId", "startedAt");

-- CreateIndex
CREATE INDEX "SaturationEvent_endedAt_idx" ON "SaturationEvent"("endedAt");

-- CreateIndex
CREATE INDEX "Prediction_zoneId_targetTime_idx" ON "Prediction"("zoneId", "targetTime");

-- CreateIndex
CREATE INDEX "Prediction_evaluatedAt_idx" ON "Prediction"("evaluatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Prediction_zoneId_modelVersionId_predictionTime_horizonMinu_key" ON "Prediction"("zoneId", "modelVersionId", "predictionTime", "horizonMinutes");

-- CreateIndex
CREATE INDEX "Booking_userId_startTime_idx" ON "Booking"("userId", "startTime");

-- CreateIndex
CREATE INDEX "Booking_facilityId_startTime_endTime_idx" ON "Booking"("facilityId", "startTime", "endTime");

-- CreateIndex
CREATE INDEX "RecentSearch_userId_createdAt_idx" ON "RecentSearch"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "ParkingFacility" ADD CONSTRAINT "ParkingFacility_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingZone" ADD CONSTRAINT "ParkingZone_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccupancySnapshot" ADD CONSTRAINT "OccupancySnapshot_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ParkingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaturationEvent" ADD CONSTRAINT "SaturationEvent_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ParkingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ParkingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_triggerEventId_fkey" FOREIGN KEY ("triggerEventId") REFERENCES "SaturationEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ParkingZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedParking" ADD CONSTRAINT "SavedParking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedParking" ADD CONSTRAINT "SavedParking_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentSearch" ADD CONSTRAINT "RecentSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: keep PostGIS points in sync with latitude/longitude.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION parkflow_set_location() RETURNS trigger AS $$
BEGIN
  NEW."location" := ST_SetSRID(ST_MakePoint(NEW."longitude", NEW."latitude"), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER parking_facility_location
  BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "ParkingFacility"
  FOR EACH ROW EXECUTE FUNCTION parkflow_set_location();

CREATE TRIGGER parking_zone_location
  BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "ParkingZone"
  FOR EACH ROW EXECUTE FUNCTION parkflow_set_location();

-- ---------------------------------------------------------------------------
-- Hand-written: integrity constraints Prisma cannot express.
-- ---------------------------------------------------------------------------
ALTER TABLE "ParkingFacility"
  ADD CONSTRAINT facility_lat_range CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT facility_lng_range CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT facility_capacity_nonneg CHECK ("capacity" IS NULL OR "capacity" >= 0);

ALTER TABLE "ParkingZone"
  ADD CONSTRAINT zone_lat_range CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT zone_lng_range CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT zone_capacity_nonneg CHECK ("capacity" IS NULL OR "capacity" >= 0);

ALTER TABLE "OccupancySnapshot"
  ADD CONSTRAINT snapshot_occupancy_nonneg CHECK ("occupancy" >= 0),
  ADD CONSTRAINT snapshot_counts_nonneg CHECK (("occupied" IS NULL OR "occupied" >= 0) AND ("available" IS NULL OR "available" >= 0));

ALTER TABLE "Prediction"
  ADD CONSTRAINT prediction_horizon_positive CHECK ("horizonMinutes" > 0),
  ADD CONSTRAINT prediction_occupancy_nonneg CHECK ("predictedOccupancy" >= 0);

ALTER TABLE "Booking"
  ADD CONSTRAINT booking_time_order CHECK ("endTime" > "startTime");
