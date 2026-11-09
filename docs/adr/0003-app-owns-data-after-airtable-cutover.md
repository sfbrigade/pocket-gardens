# The app owns data after the Airtable cutover

Airtable is a migration source and will be fully deprecated when the app starts being used. From that cutover onward, the app owns new data, carer assignments, and plot lifecycle changes. This feature does not introduce ongoing Airtable synchronization or reconciliation; imports must be completed before cutover and must not later overwrite app-owned data.
