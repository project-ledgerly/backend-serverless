-- Rule 3: exactly one REMAINDER section per sibling group.
-- A sibling group is (planId, parentId); parentId is NULL for top-level
-- sections, and NULL values don't collide under a plain UNIQUE index, so
-- COALESCE onto planId gives NULL-parent groups a real, distinct key too.
CREATE UNIQUE INDEX "Section_single_remainder_per_group"
    ON "Section" (COALESCE("parentId", "planId"))
    WHERE "allocationMode" = 'REMAINDER';
