-- Melbourne historical replay replaces the Bengaluru directory + simulation demo.

-- Replayed recorded sensor history is not a simulation: rename the availability mode.
ALTER TYPE "AvailabilityMode" RENAME VALUE 'SIMULATION' TO 'REPLAY';

-- Bengaluru localities are no longer used.
ALTER TABLE "ParkingFacility" DROP CONSTRAINT "ParkingFacility_localityId_fkey";
DROP INDEX "ParkingFacility_localityId_idx";
ALTER TABLE "ParkingFacility" DROP COLUMN "localityId";
DROP TABLE "Locality";

-- CreateTable
CREATE TABLE "ZoneNeighbour" (
    "zoneId" TEXT NOT NULL,
    "neighbourId" TEXT NOT NULL,
    "distanceM" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ZoneNeighbour_pkey" PRIMARY KEY ("zoneId","neighbourId")
);

-- AddForeignKey
ALTER TABLE "ZoneNeighbour" ADD CONSTRAINT "ZoneNeighbour_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ParkingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ZoneNeighbour" ADD CONSTRAINT "ZoneNeighbour_neighbourId_fkey" FOREIGN KEY ("neighbourId") REFERENCES "ParkingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
