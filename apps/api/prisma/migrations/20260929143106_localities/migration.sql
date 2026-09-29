-- AlterTable
ALTER TABLE "ParkingFacility" ADD COLUMN     "localityId" TEXT,
ALTER COLUMN "name" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Locality" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "placeType" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" geography(Point, 4326),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Locality_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Locality_externalId_key" ON "Locality"("externalId");

-- CreateIndex
CREATE INDEX "Locality_name_idx" ON "Locality"("name");

-- CreateIndex
CREATE INDEX "Locality_location_idx" ON "Locality" USING GIST ("location");

-- CreateIndex
CREATE INDEX "ParkingFacility_localityId_idx" ON "ParkingFacility"("localityId");

-- AddForeignKey
ALTER TABLE "ParkingFacility" ADD CONSTRAINT "ParkingFacility_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "Locality"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: keep Locality.location in sync and support fast fuzzy name search.
CREATE TRIGGER locality_location
  BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "Locality"
  FOR EACH ROW EXECUTE FUNCTION parkflow_set_location();

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX locality_name_trgm ON "Locality" USING GIN (lower("name") gin_trgm_ops);
CREATE INDEX facility_name_trgm ON "ParkingFacility" USING GIN (lower("name") gin_trgm_ops);
