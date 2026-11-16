# Stage is the only application plot lifecycle

Use stage as the sole lifecycle field in persistence and the plot API, removing the overlapping Airtable Status contract rather than maintaining two representations and their reconciliation rules. Translate source statuses only at the import boundary; preserve existing canonical stages and require explicit per-plot decisions for unfamiliar values. Permission is independent: Residents Declined establishes that permission was not granted but does not establish a garden stage, even when historical planting dates exist.

Export source values and resolve exceptional records before the forward migration removes the old column. There is no API compatibility period; the bundled client moves to stage in the same stack.
