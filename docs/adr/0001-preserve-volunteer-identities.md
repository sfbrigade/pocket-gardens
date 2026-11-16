# Preserve volunteer identities when linking platform accounts

Existing volunteer records own plot assignments and activity history, while platform accounts identify people who can sign in. Preserve the volunteer records and their relationships, and explicitly link them to platform accounts rather than replacing their identities or inferring an assignment from a typed name. This supports account-based carers and future reminders while retaining imported history.

Imported volunteers are intended to gain account links over time. The upcoming Better Auth work will determine verification and matching using email and phone; this decision does not treat unverified imported contact text as proof of account ownership or implement that authentication migration.

The account-free plot-submission work can proceed independently. Production community and administrator workflows depend on the separate Better Auth migration and its settled account contract.

The anonymous development form leaves carer assignment unavailable until that integration is ready. Administrator selection will identify existing platform users; the development milestone does not introduce temporary names-only assignments. Community members can offer their own care, while administrators establish assignments.
