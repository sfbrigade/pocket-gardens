# Preserve volunteer identities when linking platform accounts

Existing volunteer records own plot assignments and activity history, while platform accounts identify people who can sign in. Preserve the volunteer records and their relationships, and explicitly link them to platform accounts rather than replacing their identities or inferring an assignment from a typed name. This supports account-based carers and future reminders while retaining imported history.

Imported volunteers are intended to gain account links over time. The upcoming Better Auth work will determine verification and matching using email and phone; this decision does not treat unverified imported contact text as proof of account ownership or implement that authentication migration.

Staff can select multiple active registered users when submitting a plot using the current account system. Each selected account has an explicit, unique link to a volunteer record. Reuse that record when a link already exists; otherwise create an app-owned volunteer record for that account. Never automatically claim an imported record based on matching names, email, or phone. Imported records, assignments, and history remain intact until a separately verified account-linking workflow can reconcile them.

Anonymous development submissions leave carer assignment unavailable. Administrators establish assignments; typed names and community care offers do not establish assignments. The future authentication migration must preserve these explicit links and volunteer identities.
