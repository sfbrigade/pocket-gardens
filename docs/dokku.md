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

For temporary photo cleanup, configure the native storage expiration rule in
[photo upload operations](../server/README.md#photo-uploads-and-temporary-retention).
No application cleanup worker needs scheduling. Storage settings are not applied
automatically by deployment.
