```
$ dokku apps:create <name of app>
$ dokku postgres:create <name of app db>
$ dokku postgres:link <name of app db> <name of app>
$ dokku config:set <name of app> ENV_VAR=VALUE ...
$ dokku git:from-image <name of app> <name of image>
$ dokku letsencrypt:enable <name of app>
```

The web process runs `npm start -w server`, which applies pending Prisma migrations before starting the server. A migration failure stops startup; check the application logs and resolve it before restarting.

For temporary photo cleanup, configure the native storage expiration rule in
[photo upload operations](../server/README.md#photo-uploads-and-temporary-retention).
No application cleanup worker needs scheduling. Storage settings are not applied
automatically by deployment.
