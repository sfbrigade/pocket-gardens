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

Review the [account migration and deployment steps](authentication.md#pocket-gardens-deployment-and-migration)
before applying `20261116000000_better_auth`. Existing users sign in again using
an email link, keeping their account IDs and roles. Deploy the server/client pair
together; retained legacy columns do not synchronize post-cutover passwords or
make an application-only rollback safe.
