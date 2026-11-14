```
$ dokku apps:create <name of app>
$ dokku postgres:create <name of app db>
$ dokku postgres:link <name of app db> <name of app>
$ dokku config:set <name of app> ENV_VAR=VALUE ...
$ dokku git:from-image <name of app> <name of image>
$ dokku enter <name of app> web
# cd server
# npx prisma migrate deploy
$ dokku letsencrypt:enable <name of app>
```

Photo uploads also require the additive lifecycle migration, staging retention
configuration and a scheduled reconciliation worker. See
[photo upload operations](../server/README.md#photo-upload-retention-and-reconciliation) for dry-run, merged-policy
preparation and later rollout steps. These steps are not applied automatically.
