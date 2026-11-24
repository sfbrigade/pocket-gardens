```
$ dokku apps:create <name of app>
$ dokku postgres:create <name of app db>
$ dokku postgres:link <name of app db> <name of app>
$ dokku config:set <name of app> ENV_VAR=VALUE ...
$ dokku git:from-image <name of app> <name of image>
$ dokku letsencrypt:enable <name of app>
```

The web process runs `npm start -w server`, which applies pending Prisma migrations before starting the server. A migration failure stops startup; check the application logs and resolve it before restarting.

For Better Auth, configure `BASE_URL` with the public HTTPS origin, a private
`BETTER_AUTH_SECRET`, and working SMTP before cutover. Set `TRUSTED_PROXIES` to
the actual proxy source IP addresses/CIDRs seen by the container; leave it unset
for direct connections and do not use blanket trust. Fastify passes the trusted
client address to Better Auth for rate limits and session metadata. Forward
`/api/...` unchanged. Email links open the web screens on `BASE_URL`.

Review the [account migration and deployment steps](authentication.md#deployment-and-migration)
before applying the Better Auth migrations. Existing users are treated as verified
and sign in again using an email link, keeping their account IDs and roles. Deploy
the server/client pair together; retained legacy columns do not synchronize
post-cutover passwords or make an application-only rollback safe.

### Maintenance photo cleanup

The image includes `app.json`, which schedules maintenance photo cleanup every five minutes in a one-off container. After deploying the edit feature, use `dokku cron:list <app>` to confirm the task was registered. On staging, verify that pending erasures survive an app restart and that `dokku cron:run <app> <cron-id>` drains them once storage is available. The command exits nonzero when any erasures remain pending.
